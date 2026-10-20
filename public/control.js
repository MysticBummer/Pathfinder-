// GM control panel.

import {
  channel, api, putJson, assetUrl, mapKey, loadImage, debounce,
  createFogCanvas, renderFog, applyFogOp, tableScale,
  DEFAULT_PX_PER_INCH, DEFAULT_PX_PER_SQUARE,
} from './shared.js';
import { loadSound, refreshSound, handleSoundKey } from './sound.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');

// ---------- State ----------

let settings = { displays: { 'Table monitor': { pxPerInch: DEFAULT_PX_PER_INCH } }, activeDisplay: 'Table monitor' };
let campaign = null;
let mapList = [];
let mapCals = {}; // per campaign: { [mapPath]: { pxPerSquare, offX, offY } }
const docs = new Map(); // `${campaign}/${map}` -> loaded map doc

// The map the GM is looking at, and the map the players are looking at.
let selected = null;
let live = null;

let blackout = false;
let calibrating = false;
let minisDown = false;
let pending = { dx: 0, dy: 0 };
let shiftNotice = null;
let tableScreen = { w: 1920, h: 1080 };

let tool = 'brush';
let fogMode = 'reveal';
let brushSquares = 2;
let showGrid = false;

// GM camera: map pixel at canvas center, and canvas CSS px per map px.
let cam = { x: 0, y: 0, z: 1 };

function display() {
  return settings.displays[settings.activeDisplay];
}

function calFor(doc) {
  return doc.cals[doc.map] || { pxPerSquare: DEFAULT_PX_PER_SQUARE, offX: 0, offY: 0, unset: true };
}

// ---------- Saving ----------

const saveSettings = debounce(() => putJson('settings', settings).catch(console.error), 400);

function saveCals(camp, cals) {
  return putJson(`campaigns/${encodeURIComponent(camp)}/data/maps`, cals).catch(console.error);
}

function saveDoc(doc) {
  if (!doc.save) {
    doc.save = debounce(() => {
      putJson(`campaigns/${encodeURIComponent(doc.campaign)}/data/fog--${mapKey(doc.map)}`, {
        ops: doc.ops,
        view: doc.view,
      }).catch(console.error);
    }, 600);
  }
  doc.save();
}

// ---------- Talking to the player screens ----------

function stateMessage() {
  return {
    blackout,
    calibrating,
    display: display(),
    shiftNotice,
    live: live && {
      url: live.url,
      cal: calFor(live),
      fog: live.ops,
      fogVersion: live.fogVersion,
      view: live.view,
    },
  };
}

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  requestAnimationFrame(() => {
    broadcastQueued = false;
    channel.postMessage({ type: 'state', state: stateMessage() });
  });
}

channel.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'hello') {
    channel.postMessage({ type: 'state', state: stateMessage() });
  } else if (msg.type === 'screen' && msg.role === 'map') {
    tableScreen = { w: msg.w, h: msg.h };
    draw();
  }
};

// ---------- Loading ----------

async function loadCampaigns() {
  const names = await api('campaigns');
  const sel = $('campaign');
  sel.innerHTML = '';
  for (const n of names) sel.add(new Option(n, n));
  let pick = null;
  try { pick = localStorage.getItem('campaign'); } catch {}
  if (!names.includes(pick)) pick = names[0] || null;
  if (pick) {
    sel.value = pick;
    await openCampaign(pick);
  }
}

async function openCampaign(name) {
  campaign = name;
  try { localStorage.setItem('campaign', name); } catch {}
  $('campName').textContent = name;
  mapCals = (await api(`campaigns/${encodeURIComponent(name)}/data/maps`)) || {};
  await Promise.all([refreshMaps(), loadSound(name)]);
}

async function refreshMaps() {
  mapList = await api(`campaigns/${encodeURIComponent(campaign)}/maps`);
  renderMapList();
}

async function getDoc(camp, map) {
  const id = camp + '/' + map;
  if (docs.has(id)) return docs.get(id);
  const url = assetUrl(camp, 'maps/' + map);
  const [img, saved] = await Promise.all([
    loadImage(url),
    api(`campaigns/${encodeURIComponent(camp)}/data/fog--${mapKey(map)}`),
  ]);
  const doc = {
    campaign: camp,
    map,
    url,
    img,
    cals: mapCals,
    ops: (saved && saved.ops) || [],
    view: (saved && saved.view) || { cx: img.naturalWidth / 2, cy: img.naturalHeight / 2, zoom: 'true' },
    fogVersion: 0,
    fog: createFogCanvas(img.naturalWidth, img.naturalHeight),
  };
  renderFog(doc.fog, doc.ops);
  docs.set(id, doc);
  return doc;
}

async function selectMap(map) {
  try {
    selected = await getDoc(campaign, map);
  } catch (err) {
    alert(err.message);
    return;
  }
  fitCamera();
  refreshUi();
}

function showSelected() {
  if (!selected || selected === live) return;
  live = selected;
  setMinis(false);
  refreshUi();
  broadcast();
}

// ---------- Fog edits ----------

function commitOp(doc, op) {
  doc.ops.push(op);
  doc.fogVersion++;
  saveDoc(doc);
  if (doc === live) broadcast();
}

function undo() {
  const doc = selected;
  if (!doc || !doc.ops.length) return;
  doc.ops.pop();
  doc.fogVersion++;
  renderFog(doc.fog, doc.ops);
  saveDoc(doc);
  if (doc === live) broadcast();
  draw();
}

function fogAll(mode) {
  if (!selected) return;
  const op = { t: 'all', m: mode };
  applyFogOp(selected.fog, op);
  commitOp(selected, op);
  draw();
}

// ---------- Table view ----------

function setMinis(on) {
  minisDown = on;
  pending = { dx: 0, dy: 0 };
  if (on && live) live.view.zoom = 'true';
  if (on && tool === 'view') setTool('brush');
  refreshUi();
  if (live) {
    saveDoc(live);
    broadcast();
  }
}

function moveTable(dxSquares, dySquares) {
  if (!live) return;
  if (minisDown) {
    pending.dx += dxSquares;
    pending.dy += dySquares;
  } else {
    const pps = calFor(live).pxPerSquare;
    live.view.cx += dxSquares * pps;
    live.view.cy += dySquares * pps;
    saveDoc(live);
    broadcast();
  }
  refreshUi();
}

function applyShift() {
  if (!live || (!pending.dx && !pending.dy)) return;
  const pps = calFor(live).pxPerSquare;
  live.view.cx += pending.dx * pps;
  live.view.cy += pending.dy * pps;
  shiftNotice = { dx: pending.dx, dy: pending.dy, at: Date.now() };
  pending = { dx: 0, dy: 0 };
  saveDoc(live);
  broadcast();
  refreshUi();
}

function setTableZoom(zoom) {
  if (!live) return;
  if (minisDown && zoom === 'fit') return;
  live.view.zoom = zoom;
  saveDoc(live);
  broadcast();
  refreshUi();
}

// Size of the table screen's visible area, in map pixels.
function tableRect(doc, dx = 0, dy = 0) {
  const mw = doc.img.naturalWidth;
  const mh = doc.img.naturalHeight;
  if (doc.view.zoom === 'fit') {
    const s = tableScale(doc.view, calFor(doc), display(), tableScreen.w, tableScreen.h, mw, mh);
    const w = tableScreen.w / s;
    const h = tableScreen.h / s;
    return { x: mw / 2 - w / 2, y: mh / 2 - h / 2, w, h };
  }
  const s = tableScale(doc.view, calFor(doc), display(), 0, 0, mw, mh);
  const pps = calFor(doc).pxPerSquare;
  const w = tableScreen.w / s;
  const h = tableScreen.h / s;
  return { x: doc.view.cx + dx * pps - w / 2, y: doc.view.cy + dy * pps - h / 2, w, h };
}

// ---------- Drawing the GM view ----------

function fitCamera() {
  if (!selected) return;
  const r = canvas.getBoundingClientRect();
  const mw = selected.img.naturalWidth;
  const mh = selected.img.naturalHeight;
  cam = { x: mw / 2, y: mh / 2, z: Math.min(r.width / mw, r.height / mh) * 0.92 };
}

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  draw();
}

function toMap(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left - r.width / 2) / cam.z + cam.x,
    y: (clientY - r.top - r.height / 2) / cam.z + cam.y,
  };
}

let mouse = null; // last pointer position in map px, for the brush cursor

function draw() {
  const dpr = devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!selected) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#777';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pick a map on the left to stage it.', r.width / 2, r.height / 2);
    return;
  }
  const doc = selected;
  const mw = doc.img.naturalWidth;
  const mh = doc.img.naturalHeight;
  const z = cam.z;

  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (r.width / 2 - cam.x * z), dpr * (r.height / 2 - cam.y * z));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(doc.img, 0, 0);

  if (showGrid) drawGrid(doc, mw, mh);

  ctx.globalAlpha = 0.6;
  ctx.drawImage(doc.fog, 0, 0, doc.fog.width, doc.fog.height, 0, 0, mw, mh);
  ctx.globalAlpha = 1;

  if (doc === live) {
    const t = tableRect(doc);
    ctx.lineWidth = 3 / z;
    ctx.strokeStyle = '#f4c430';
    ctx.setLineDash([]);
    ctx.strokeRect(t.x, t.y, t.w, t.h);
    if (pending.dx || pending.dy) {
      const p = tableRect(doc, pending.dx, pending.dy);
      ctx.setLineDash([12 / z, 8 / z]);
      ctx.strokeStyle = '#7fd3ff';
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      ctx.setLineDash([]);
    }
  }

  if (calClick) {
    ctx.fillStyle = '#ff5ad1';
    ctx.beginPath();
    ctx.arc(calClick.x, calClick.y, 5 / z, 0, Math.PI * 2);
    ctx.fill();
  }

  if (mouse && tool === 'brush' && !calMode) {
    ctx.lineWidth = 1.5 / z;
    ctx.strokeStyle = fogMode === 'reveal' ? '#ffffff' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, brushRadius(doc), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (drag && drag.kind === 'box') {
    const b = normRect(drag.start, drag.cur);
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = fogMode === 'reveal' ? '#ffffff' : '#ff6b6b';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
}

function drawGrid(doc, mw, mh) {
  const { pxPerSquare: pps, offX, offY } = calFor(doc);
  if (pps * cam.z < 4) return;
  ctx.beginPath();
  for (let x = ((offX % pps) + pps) % pps; x <= mw; x += pps) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mh);
  }
  for (let y = ((offY % pps) + pps) % pps; y <= mh; y += pps) {
    ctx.moveTo(0, y);
    ctx.lineTo(mw, y);
  }
  ctx.lineWidth = 1.5 / cam.z;
  ctx.strokeStyle = 'rgba(255, 90, 209, 0.75)';
  ctx.stroke();
}

function brushRadius(doc) {
  return (brushSquares * calFor(doc).pxPerSquare) / 2;
}

function normRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// ---------- Mouse ----------

let drag = null;
let calMode = false;
let calClick = null;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (!selected) return;
  canvas.setPointerCapture(e.pointerId);
  const p = toMap(e.clientX, e.clientY);

  if (e.button === 1 || e.button === 2) {
    drag = { kind: 'look', lastX: e.clientX, lastY: e.clientY };
    return;
  }
  if (e.button !== 0) return;

  if (calMode) {
    handleCalClick(p);
    return;
  }
  if (tool === 'brush') {
    const op = { t: 'stroke', m: fogMode, r: brushRadius(selected), pts: [[p.x, p.y]] };
    applyFogOp(selected.fog, op);
    drag = { kind: 'stroke', op };
  } else if (tool === 'box') {
    drag = { kind: 'box', start: p, cur: p };
  } else if (tool === 'view' && selected === live && !minisDown && live.view.zoom === 'true') {
    drag = { kind: 'view', last: p };
  }
  draw();
});

canvas.addEventListener('pointermove', (e) => {
  if (!selected) return;
  const p = toMap(e.clientX, e.clientY);
  mouse = p;
  if (drag) {
    if (drag.kind === 'look') {
      cam.x -= (e.clientX - drag.lastX) / cam.z;
      cam.y -= (e.clientY - drag.lastY) / cam.z;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
    } else if (drag.kind === 'stroke') {
      const pts = drag.op.pts;
      const prev = pts[pts.length - 1];
      // Skip tiny moves so saved strokes stay small.
      if (Math.hypot(p.x - prev[0], p.y - prev[1]) > drag.op.r * 0.15) {
        pts.push([Math.round(p.x), Math.round(p.y)]);
        applyFogOp(selected.fog, { ...drag.op, pts: [prev, [p.x, p.y]] });
      }
    } else if (drag.kind === 'box') {
      drag.cur = p;
    } else if (drag.kind === 'view') {
      live.view.cx += p.x - drag.last.x;
      live.view.cy += p.y - drag.last.y;
      drag.last = p;
      broadcast();
    }
  }
  draw();
});

function endDrag() {
  if (!drag) return;
  if (drag.kind === 'stroke') {
    commitOp(selected, drag.op);
  } else if (drag.kind === 'box') {
    const b = normRect(drag.start, drag.cur);
    if (b.w > 2 && b.h > 2) {
      const op = { t: 'rect', m: fogMode, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
      applyFogOp(selected.fog, op);
      commitOp(selected, op);
    }
  } else if (drag.kind === 'view') {
    saveDoc(live);
  }
  drag = null;
  draw();
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => {
  mouse = null;
  draw();
});

canvas.addEventListener('wheel', (e) => {
  if (!selected) return;
  e.preventDefault();
  const before = toMap(e.clientX, e.clientY);
  cam.z *= Math.exp(-e.deltaY * 0.0015);
  cam.z = Math.min(8, Math.max(0.02, cam.z));
  const after = toMap(e.clientX, e.clientY);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  draw();
}, { passive: false });

// ---------- Grid calibration ----------

function startCal() {
  if (!selected) return;
  calMode = true;
  calClick = null;
  showGrid = true;
  $('showGrid').checked = true;
  refreshUi();
}

function handleCalClick(p) {
  if (!calClick) {
    calClick = p;
    refreshUi();
    return;
  }
  const n = Math.max(1, Number($('calSquares').value) || 1);
  const pps = (Math.abs(p.x - calClick.x) + Math.abs(p.y - calClick.y)) / 2 / n;
  if (pps < 5) {
    calClick = null;
    refreshUi();
    return;
  }
  const x0 = Math.min(p.x, calClick.x);
  const y0 = Math.min(p.y, calClick.y);
  selected.cals[selected.map] = { pxPerSquare: round2(pps), offX: round2(x0 % pps), offY: round2(y0 % pps) };
  saveCals(selected.campaign, selected.cals);
  calMode = false;
  calClick = null;
  if (selected === live) broadcast();
  refreshUi();
}

function nudgeGrid(delta) {
  if (!selected) return;
  const c = { ...calFor(selected) };
  delete c.unset;
  c.pxPerSquare = round2(Math.max(5, c.pxPerSquare + delta));
  selected.cals[selected.map] = c;
  saveCals(selected.campaign, selected.cals);
  if (selected === live) broadcast();
  refreshUi();
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---------- UI ----------

function setTool(t) {
  tool = t;
  calMode = false;
  calClick = null;
  refreshUi();
}

function setFogMode(m) {
  fogMode = m;
  refreshUi();
}

function renderMapList() {
  const ul = $('maps');
  ul.innerHTML = '';
  $('mapsEmpty').hidden = mapList.length > 0;
  for (const m of mapList) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = m.replace(/\.[^.]+$/, '');
    li.append(name);
    const isSel = selected && selected.campaign === campaign && selected.map === m;
    const isLive = live && live.campaign === campaign && live.map === m;
    if (isSel) li.classList.add('selected');
    if (isLive) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'ON TABLE';
      li.append(tag);
    }
    li.onclick = () => selectMap(m);
    ul.append(li);
  }
}

function refreshUi() {
  renderMapList();

  // Header status.
  const status = $('tableStatus');
  if (blackout) {
    status.textContent = 'Table: BLACKED OUT';
    status.className = 'chip dark';
  } else if (live) {
    status.textContent = 'Table: ' + live.map.replace(/\.[^.]+$/, '');
    status.className = 'chip live';
  } else {
    status.textContent = 'Table: nothing showing';
    status.className = 'chip';
  }
  $('blackout').classList.toggle('on', blackout);

  // Banner over the map.
  const banner = $('banner');
  banner.className = '';
  banner.innerHTML = '';
  if (selected) {
    if (calMode) {
      banner.className = 'warn';
      const n = Math.max(1, Number($('calSquares').value) || 1);
      banner.textContent = calClick
        ? `Now click the opposite corner, ${n} square${n === 1 ? '' : 's'} across and down.`
        : 'Click one corner of a grid square. Esc to cancel.';
    } else if (selected !== live) {
      banner.className = 'staged';
      banner.append('Staged. Players can\'t see this map. ');
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = 'Show on table (Enter)';
      b.onclick = showSelected;
      banner.append(b);
    } else {
      banner.className = 'live';
      banner.textContent = 'On the table. The yellow box is what players see.';
    }
    if (calFor(selected).unset && !calMode) {
      banner.className = 'warn';
      banner.append(' · Grid not set, so the scale will be off. Use "Set grid".');
    }
  }

  // Fog tools.
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === fogMode));
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  $('brushLabel').textContent = brushSquares + ' sq';
  $('brush').value = brushSquares;

  // Table view.
  $('minis').checked = minisDown;
  const zoom = live ? live.view.zoom : 'true';
  document.querySelectorAll('[data-zoom]').forEach((b) => {
    b.classList.toggle('on', b.dataset.zoom === zoom);
    b.disabled = !live || (minisDown && b.dataset.zoom === 'fit');
  });
  const pend = $('pending');
  if (pending.dx || pending.dy) {
    const parts = [];
    if (pending.dx) parts.push(`${Math.abs(pending.dx)} ${pending.dx > 0 ? 'east' : 'west'}`);
    if (pending.dy) parts.push(`${Math.abs(pending.dy)} ${pending.dy > 0 ? 'south' : 'north'}`);
    pend.textContent = `Move table ${parts.join(', ')}. Space to apply, Esc to cancel.`;
    pend.hidden = false;
  } else {
    pend.hidden = true;
  }

  // Grid info.
  if (selected) {
    const c = calFor(selected);
    $('gridInfo').textContent = c.unset
      ? 'Not set yet. Click "Set grid", then click two corners of a square.'
      : `${c.pxPerSquare} map pixels per square.`;
  } else {
    $('gridInfo').textContent = 'Pick a map first.';
  }
  $('showGrid').checked = showGrid;

  // Display calibration.
  const dsel = $('display');
  dsel.innerHTML = '';
  for (const name of Object.keys(settings.displays)) dsel.add(new Option(name, name));
  dsel.value = settings.activeDisplay;
  if (document.activeElement !== $('ppi')) $('ppi').value = display().pxPerInch;
  $('calibrate').checked = calibrating;

  draw();
}

function setPpi(v) {
  display().pxPerInch = round2(Math.min(400, Math.max(20, v)));
  saveSettings();
  broadcast();
  refreshUi();
}

// Buttons.
$('campaign').onchange = (e) => {
  selected = null;
  openCampaign(e.target.value).then(refreshUi);
};
$('refresh').onclick = () => {
  refreshMaps();
  refreshSound();
};
$('openMap').onclick = () => window.open('/map.html', 'table-map', 'popup,width=1280,height=800');
$('blackout').onclick = () => toggleBlackout();
document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => setFogMode(b.dataset.mode)));
document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
document.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => setTableZoom(b.dataset.zoom)));
document.querySelectorAll('[data-pps]').forEach((b) => (b.onclick = () => nudgeGrid(Number(b.dataset.pps))));
document.querySelectorAll('[data-ppi]').forEach((b) => (b.onclick = () => setPpi(display().pxPerInch + Number(b.dataset.ppi))));
$('brush').oninput = (e) => {
  brushSquares = Number(e.target.value);
  refreshUi();
};
$('undo').onclick = undo;
$('revealAll').onclick = () => fogAll('reveal');
$('resetFog').onclick = () => {
  if (confirm('Cover the whole map in fog again? (Ctrl+Z can undo this.)')) fogAll('hide');
};
$('minis').onchange = (e) => setMinis(e.target.checked);
$('calGrid').onclick = startCal;
$('calSquares').oninput = refreshUi;
$('showGrid').onchange = (e) => {
  showGrid = e.target.checked;
  draw();
};
$('calibrate').onchange = (e) => {
  calibrating = e.target.checked;
  broadcast();
};
$('ppi').onchange = (e) => setPpi(Number(e.target.value) || DEFAULT_PX_PER_INCH);
$('display').onchange = (e) => {
  settings.activeDisplay = e.target.value;
  saveSettings();
  broadcast();
  refreshUi();
};
$('addDisplay').onclick = () => {
  const name = prompt('Name for this display (for example "Projector")');
  if (!name || settings.displays[name]) return;
  settings.displays[name] = { pxPerInch: DEFAULT_PX_PER_INCH };
  settings.activeDisplay = name;
  saveSettings();
  broadcast();
  refreshUi();
};
$('renameDisplay').onclick = () => {
  const old = settings.activeDisplay;
  const name = prompt('New name', old);
  if (!name || name === old || settings.displays[name]) return;
  settings.displays[name] = settings.displays[old];
  delete settings.displays[old];
  settings.activeDisplay = name;
  saveSettings();
  refreshUi();
};

function toggleBlackout() {
  blackout = !blackout;
  broadcast();
  refreshUi();
}

// ---------- Hotkeys ----------

addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range') return;
  if (t.tagName === 'SELECT') return;
  const k = e.key;

  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (handleSoundKey(e)) {
    e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
    return;
  }

  const step = e.shiftKey ? 5 : 1;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[k]) {
    e.preventDefault();
    moveTable(...arrows[k]);
    return;
  }

  switch (k.toLowerCase()) {
    case 'b': toggleBlackout(); break;
    case 'enter': e.preventDefault(); showSelected(); break;
    case ' ': e.preventDefault(); applyShift(); break;
    case 'escape':
      pending = { dx: 0, dy: 0 };
      calMode = false;
      calClick = null;
      refreshUi();
      break;
    case 'x': setFogMode(fogMode === 'reveal' ? 'hide' : 'reveal'); break;
    case 'q': setTool('brush'); break;
    case 'w': setTool('box'); break;
    case 'v': setTool('view'); break;
    case 'd': setMinis(!minisDown); break;
    case 'f': if (live) setTableZoom(live.view.zoom === 'fit' ? 'true' : 'fit'); break;
    case '[': brushSquares = Math.max(0.5, brushSquares - 0.5); refreshUi(); break;
    case ']': brushSquares = Math.min(10, brushSquares + 0.5); refreshUi(); break;
    default: return;
  }
  // Keep focus off buttons so Space and Enter don't also click them.
  if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
});

// ---------- Start ----------

async function start() {
  const saved = await api('settings');
  if (saved && saved.displays && Object.keys(saved.displays).length) {
    settings = saved;
    if (!settings.displays[settings.activeDisplay]) settings.activeDisplay = Object.keys(settings.displays)[0];
  }
  await loadCampaigns();
  new ResizeObserver(resizeCanvas).observe(canvas);
  refreshUi();
  channel.postMessage({ type: 'hello-control' });
  broadcast();
}

start().catch((err) => {
  console.error(err);
  alert('Table Rig could not start: ' + err.message);
});
