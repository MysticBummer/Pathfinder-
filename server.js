// Table Rig local server. No dependencies beyond Node itself.
// Serves the app, the campaign asset folders, and saves state as JSON files.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 3210;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CAMPAIGNS_DIR = path.join(ROOT, 'campaigns');
const LIBRARY_DIR = path.join(ROOT, 'library');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
const AUDIO_EXTS = ['.mp3', '.ogg', '.oga', '.opus', '.wav', '.m4a', '.flac', '.webm'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
};

fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true });
for (const sub of ['ambient', 'music', 'sfx']) {
  fs.mkdirSync(path.join(LIBRARY_DIR, 'audio', sub), { recursive: true });
}

// Resolve a user-supplied path inside a base folder, or null if it escapes.
function safeJoin(base, ...parts) {
  const full = path.resolve(base, ...parts);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), TYPES['.json']);
}

function sendFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Audio elements ask for byte ranges so they can seek and loop.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, stat.size - 1);
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// List files under dir (one level of subfolders deep) whose extension is in exts.
function listFiles(dir, exts, prefix = '', depth = 0) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory() && depth < 2) {
      out = out.concat(listFiles(path.join(dir, e.name), exts, rel, depth + 1));
    } else if (e.isFile() && exts.includes(path.extname(e.name).toLowerCase())) {
      out.push(rel);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// Sound files from one audio folder, grouped the way the sound panel uses them.
// Music subfolders are playlists; loose music files go in a playlist called "Music".
function listAudio(audioDir, urlPrefix, into) {
  const url = (rel) => urlPrefix + rel.split('/').map(encodeURIComponent).join('/');
  const name = (rel) => rel.replace(/\.[^.]+$/, '');
  for (const rel of listFiles(path.join(audioDir, 'ambient'), AUDIO_EXTS)) {
    into.ambient.push({ name: name(rel), url: url('ambient/' + rel) });
  }
  for (const rel of listFiles(path.join(audioDir, 'sfx'), AUDIO_EXTS)) {
    into.sfx.push({ name: name(rel), url: url('sfx/' + rel) });
  }
  for (const rel of listFiles(path.join(audioDir, 'music'), AUDIO_EXTS)) {
    const slash = rel.indexOf('/');
    const list = slash === -1 ? 'Music' : rel.slice(0, slash);
    const track = slash === -1 ? rel : rel.slice(slash + 1);
    (into.music[list] = into.music[list] || []).push({ name: name(track), url: url('music/' + rel) });
  }
  return into;
}

function campaignDir(name) {
  if (!/^[\w .-]+$/.test(name)) return null;
  return safeJoin(CAMPAIGNS_DIR, name);
}

async function handleJsonFile(req, res, file, fallback) {
  if (req.method === 'GET') {
    fs.readFile(file, 'utf8', (err, text) => {
      if (err) return sendJson(res, 200, fallback);
      try {
        sendJson(res, 200, JSON.parse(text));
      } catch {
        sendJson(res, 200, fallback);
      }
    });
    return;
  }
  if (req.method === 'PUT') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Write to a temp file then rename, so a crash never leaves half a file.
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
      fs.renameSync(tmp, file);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }
  send(res, 405, 'Method not allowed');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let parts;
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return send(res, 400, 'Bad path');
  }

  // /api/...
  if (parts[0] === 'api') {
    if (parts[1] === 'settings' && parts.length === 2) {
      return handleJsonFile(req, res, SETTINGS_FILE, {});
    }

    if (parts[1] === 'campaigns' && parts.length === 2) {
      const names = fs
        .readdirSync(CAMPAIGNS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
      return sendJson(res, 200, names);
    }

    if (parts[1] === 'campaigns' && parts.length >= 4) {
      const dir = campaignDir(parts[2]);
      if (!dir || !fs.existsSync(dir)) return send(res, 404, 'No such campaign');

      if (parts[3] === 'maps' && parts.length === 4) {
        return sendJson(res, 200, listFiles(path.join(dir, 'maps'), IMAGE_EXTS));
      }

      if (parts[3] === 'audio' && parts.length === 4) {
        const found = { ambient: [], music: {}, sfx: [] };
        listAudio(path.join(LIBRARY_DIR, 'audio'), '/library/audio/', found);
        listAudio(path.join(dir, 'audio'), `/assets/${encodeURIComponent(parts[2])}/audio/`, found);
        const byName = (a, b) => a.name.localeCompare(b.name);
        found.ambient.sort(byName);
        found.sfx.sort(byName);
        return sendJson(res, 200, found);
      }

      if (parts[3] === 'data' && parts.length === 5) {
        const key = parts[4];
        if (!/^[\w-]{1,200}$/.test(key)) return send(res, 400, 'Bad key');
        return handleJsonFile(req, res, path.join(dir, 'data', key + '.json'), null);
      }
    }
    return send(res, 404, 'Unknown API route');
  }

  // /assets/<campaign>/<path inside campaign>
  if (parts[0] === 'assets' && parts.length >= 3) {
    const dir = campaignDir(parts[1]);
    if (!dir) return send(res, 404, 'Not found');
    if (parts[2] === 'data') return send(res, 403, 'Forbidden');
    const file = safeJoin(dir, ...parts.slice(2));
    if (!file) return send(res, 403, 'Forbidden');
    return sendFile(req, res, file);
  }

  // /library/<path>: sounds shared by every campaign.
  if (parts[0] === 'library' && parts.length >= 2) {
    const file = safeJoin(LIBRARY_DIR, ...parts.slice(1));
    if (!file) return send(res, 403, 'Forbidden');
    return sendFile(req, res, file);
  }

  // Static app files.
  const rel = parts.length ? parts : ['control.html'];
  const file = safeJoin(PUBLIC_DIR, ...rel);
  if (!file) return send(res, 403, 'Forbidden');
  sendFile(req, res, file);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Table Rig is running at ${url}`);
  console.log('Leave this window open while you play. Close it to stop.');
  if (process.platform === 'win32' && !process.env.NO_BROWSER) {
    exec(`start "" "${url}"`);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Table Rig may already be running: open http://localhost:${PORT}/`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
