// Code shared by the control panel and the player screens.

// All windows on this laptop talk over one BroadcastChannel.
export const channel = new BroadcastChannel('table-rig');

export async function api(path, options = {}) {
  const res = await fetch('/api/' + path, options);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export function putJson(path, data) {
  return api(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function assetUrl(campaign, rel) {
  return '/assets/' + [campaign, ...rel.split('/')].map(encodeURIComponent).join('/');
}

// Turn a map's file path into a key safe for a data file name.
export function mapKey(rel) {
  return rel.replace(/[^\w-]/g, '_').slice(0, 180);
}

export const DEFAULT_PX_PER_INCH = 96;
export const DEFAULT_PX_PER_SQUARE = 100;

// Fog of war.
//
// Fog is stored as a list of operations in map pixel coordinates, so undo is
// just "drop the last op" and the same list renders at any resolution.
//   { t: 'stroke', m: 'reveal' | 'hide', r: radius, pts: [[x, y], ...] }
//   { t: 'rect',   m: 'reveal' | 'hide', x, y, w, h }
//   { t: 'all',    m: 'reveal' | 'hide' }

const FOG_MAX_SIZE = 2048;

export function createFogCanvas(mapW, mapH) {
  const scale = Math.min(1, FOG_MAX_SIZE / Math.max(mapW, mapH));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(mapW * scale));
  c.height = Math.max(1, Math.round(mapH * scale));
  c.fogScale = scale;
  return c;
}

export function renderFog(canvas, ops) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const op of ops) applyFogOp(canvas, op);
}

export function applyFogOp(canvas, op) {
  const ctx = canvas.getContext('2d');
  const s = canvas.fogScale;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.globalCompositeOperation = op.m === 'reveal' ? 'destination-out' : 'source-over';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  if (op.t === 'all') {
    ctx.fillRect(0, 0, canvas.width / s, canvas.height / s);
  } else if (op.t === 'rect') {
    ctx.fillRect(op.x, op.y, op.w, op.h);
  } else if (op.t === 'stroke' && op.pts.length) {
    ctx.lineWidth = op.r * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const [x0, y0] = op.pts[0];
    ctx.moveTo(x0, y0);
    if (op.pts.length === 1) ctx.lineTo(x0 + 0.01, y0);
    for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i][0], op.pts[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + url));
    img.src = url;
  });
}

// How many CSS pixels on the table screen one map pixel takes up.
export function tableScale(view, mapCal, display, screenW, screenH, mapW, mapH) {
  if (view.zoom === 'fit') return Math.min(screenW / mapW, screenH / mapH);
  return display.pxPerInch / mapCal.pxPerSquare;
}

// Debounce helper for saving.
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
