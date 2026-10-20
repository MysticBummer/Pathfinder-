// The table map screen. Only ever shows what the control panel tells it to.

import { channel, loadImage, createFogCanvas, renderFog, tableScale } from './shared.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const hint = document.getElementById('hint');
const notice = document.getElementById('notice');

let state = null;
let img = null;
let imgUrl = null;
let fog = null;
let fogKey = null; // map url + fog version currently rendered
let noticeTimer = null;
let lastNoticeAt = 0;

function reportSize() {
  channel.postMessage({ type: 'screen', role: 'map', w: innerWidth, h: innerHeight });
}

channel.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'state') {
    state = msg.state;
    await syncLive();
    showShiftNotice();
    draw();
  } else if (msg.type === 'hello-control') {
    // A control panel just opened; tell it we exist.
    reportSize();
  }
};

async function syncLive() {
  const live = state && state.live;
  if (!live) {
    img = null;
    imgUrl = null;
    fog = null;
    fogKey = null;
    return;
  }
  if (live.url !== imgUrl) {
    imgUrl = live.url;
    fogKey = null;
    try {
      const loaded = await loadImage(live.url);
      if (imgUrl !== live.url) return; // a newer map arrived while loading
      img = loaded;
    } catch {
      img = null;
    }
  }
  if (!img) return;
  const key = live.url + '#' + live.fogVersion;
  if (key !== fogKey) {
    fog = createFogCanvas(img.naturalWidth, img.naturalHeight);
    renderFog(fog, live.fog);
    fogKey = key;
  }
}

function showShiftNotice() {
  const n = state && state.shiftNotice;
  if (!n || n.at === lastNoticeAt) return;
  lastNoticeAt = n.at;
  const lines = [];
  if (n.dx) lines.push(`${Math.abs(n.dx)} square${Math.abs(n.dx) === 1 ? '' : 's'} ${n.dx > 0 ? '←' : '→'}`);
  if (n.dy) lines.push(`${Math.abs(n.dy)} square${Math.abs(n.dy) === 1 ? '' : 's'} ${n.dy > 0 ? '↑' : '↓'}`);
  if (!lines.length) return;
  notice.innerHTML = 'Slide every mini<br>' + lines.join('<br>') + '<small>The map just moved</small>';
  notice.classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.add('hidden'), 10000);
}

function resize() {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  reportSize();
  draw();
}

function draw() {
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (state.calibrating || state.blackout) notice.classList.add('hidden');
  if (state.calibrating) return drawCalibration();
  if (state.blackout) return;

  const live = state.live;
  if (!live || !img) return;

  const W = innerWidth;
  const H = innerHeight;
  const mw = img.naturalWidth;
  const mh = img.naturalHeight;
  const s = tableScale(live.view, live.cal, state.display, W, H, mw, mh);
  const cx = live.view.zoom === 'fit' ? mw / 2 : live.view.cx;
  const cy = live.view.zoom === 'fit' ? mh / 2 : live.view.cy;

  ctx.translate(W / 2, H / 2);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0);
  if (fog) ctx.drawImage(fog, 0, 0, fog.width, fog.height, 0, 0, mw, mh);
}

// Shows a ruler and a credit card outline so the GM can match real inches.
function drawCalibration() {
  const ppi = state.display.pxPerInch;
  const W = innerWidth;
  const H = innerHeight;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.font = '20px system-ui, sans-serif';
  ctx.textAlign = 'center';

  // Ruler: as many whole inches as fit, up to 12.
  const inches = Math.max(1, Math.min(12, Math.floor((W * 0.85) / ppi)));
  const x0 = (W - inches * ppi) / 2;
  const y0 = H * 0.25;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, inches * ppi, 40);
  for (let i = 0; i <= inches * 4; i++) {
    const x = x0 + (i * ppi) / 4;
    const len = i % 4 === 0 ? 40 : i % 2 === 0 ? 24 : 14;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + len);
    ctx.stroke();
    if (i % 4 === 0) ctx.fillText(String(i / 4), x, y0 + 66);
  }
  ctx.fillText('inches: hold a ruler against this', W / 2, y0 - 16);

  // Credit card: 3.370 x 2.125 inches.
  const cw = 3.37 * ppi;
  const ch = 2.125 * ppi;
  const cx = (W - cw) / 2;
  const cy = H * 0.55;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(cx, cy, cw, ch, 0.125 * ppi);
  ctx.stroke();
  ctx.fillText('or lay a bank card in this box', W / 2, cy + ch + 34);

  // A few 1 inch squares for checking against a mini's base.
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = 2;
    ctx.strokeRect(cx + cw + ppi * 0.5 + i * ppi, cy, ppi, ppi);
  }
}

// Hide the cursor after a couple of seconds without movement.
let idleTimer;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
}
addEventListener('mousemove', wake);
wake();

addEventListener('click', () => {
  hint.classList.add('hidden');
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) hint.classList.add('hidden');
});

addEventListener('resize', resize);
resize();
channel.postMessage({ type: 'hello', role: 'map' });
