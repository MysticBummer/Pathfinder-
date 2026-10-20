// The sound panel on the right of the control panel.

import { AudioEngine } from './audio.js';
import { api, putJson, debounce } from './shared.js';

export const engine = new AudioEngine();

const $ = (id) => document.getElementById(id);
const SLOT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

let campaign = null;
let library = { ambient: [], music: {}, sfx: [] };
let config = defaultConfig();
let editingKeys = false;
let filter = '';

function defaultConfig() {
  return { volumes: { master: 0.8, music: 0.5, sfx: 0.9 }, crossfade: 4, shuffle: true, slots: {} };
}

const saveConfig = debounce(() => {
  if (!campaign) return;
  putJson(`campaigns/${encodeURIComponent(campaign)}/data/audio`, config).catch(console.error);
}, 500);

export async function loadSound(name) {
  campaign = name;
  const [found, saved] = await Promise.all([
    api(`campaigns/${encodeURIComponent(name)}/audio`),
    api(`campaigns/${encodeURIComponent(name)}/data/audio`),
  ]);
  library = found;
  config = { ...defaultConfig(), ...(saved || {}) };
  config.volumes = { ...defaultConfig().volumes, ...config.volumes };

  // First time with this campaign: put the first ten effects on the number keys.
  if (!saved) {
    library.sfx.slice(0, 10).forEach((s, i) => (config.slots[SLOT_KEYS[i]] = s.url));
  }

  Object.assign(engine.volumes, config.volumes);
  engine.crossfade = config.crossfade;
  engine.shuffle = config.shuffle;
  engine.applyVolumes();
  render();
}

export async function refreshSound() {
  if (campaign) {
    library = await api(`campaigns/${encodeURIComponent(campaign)}/audio`);
    render();
  }
}

function sfxByUrl(url) {
  return library.sfx.find((s) => s.url === url);
}

function playSlot(key) {
  const url = config.slots[key];
  if (!url) return false;
  engine.playSfx(url);
  flashSlot(key);
  return true;
}

function flashSlot(key) {
  const el = document.querySelector(`[data-slot="${key}"]`);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function matches(name) {
  return !filter || name.toLowerCase().includes(filter);
}

// ---------- Rendering ----------

function render() {
  const np = engine.nowPlaying();

  // Master.
  $('masterVol').value = engine.volumes.master;
  $('mute').classList.toggle('on', engine.muted);
  $('mute').textContent = engine.muted ? 'Muted (M)' : 'Mute (M)';

  // Ambient layers playing.
  const layers = $('layers');
  layers.innerHTML = '';
  for (const layer of engine.layers.values()) {
    const row = document.createElement('div');
    row.className = 'layer';
    const name = document.createElement('span');
    name.textContent = layer.name;
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = 0;
    vol.max = 1;
    vol.step = 0.01;
    vol.value = layer.volume;
    vol.oninput = () => engine.setLayerVolume(layer.url, Number(vol.value));
    const x = document.createElement('button');
    x.className = 'small';
    x.textContent = '×';
    x.title = 'Fade out';
    x.onclick = () => engine.removeLayer(layer.url);
    row.append(name, vol, x);
    layers.append(row);
  }
  $('layersEmpty').hidden = engine.layers.size > 0;

  // Ambient library.
  const amb = $('ambientList');
  amb.innerHTML = '';
  for (const t of library.ambient) {
    if (!matches(t.name)) continue;
    const b = document.createElement('button');
    b.className = 'pill' + (engine.hasLayer(t.url) ? ' on' : '');
    b.textContent = t.name;
    b.onclick = () => engine.toggleLayer(t);
    amb.append(b);
  }
  if (!library.ambient.length) amb.innerHTML = '<p class="note">No ambient sounds yet. Add files to <code>audio/ambient</code>.</p>';

  // Music.
  const lists = $('playlists');
  lists.innerHTML = '';
  const names = Object.keys(library.music).sort();
  for (const n of names) {
    const b = document.createElement('button');
    b.className = 'pill' + (np && np.playlist === n ? ' on' : '');
    b.textContent = `${n} (${library.music[n].length})`;
    b.onclick = () => engine.playPlaylist(n, library.music[n]);
    lists.append(b);
  }
  if (!names.length) lists.innerHTML = '<p class="note">No music yet. Each folder in <code>audio/music</code> becomes a playlist.</p>';
  $('nowPlaying').textContent = np
    ? `${np.paused ? 'Paused' : 'Playing'}: ${np.track ? np.track.name : ''} · ${np.playlist}`
    : 'Music off';
  $('musicPause').textContent = np && np.paused ? 'Play' : 'Pause';
  for (const id of ['musicPause', 'musicNext', 'musicStop']) $(id).disabled = !np;
  $('musicVol').value = engine.volumes.music;
  $('shuffle').checked = engine.shuffle;
  if (document.activeElement !== $('crossfade')) $('crossfade').value = engine.crossfade;

  // Effect slots.
  const slots = $('slots');
  slots.innerHTML = '';
  for (const key of SLOT_KEYS) {
    const url = config.slots[key];
    const s = url && sfxByUrl(url);
    const cell = document.createElement('div');
    cell.className = 'slot';
    cell.dataset.slot = key;
    if (editingKeys) {
      const sel = document.createElement('select');
      sel.add(new Option(`${key}: (empty)`, ''));
      for (const fx of library.sfx) sel.add(new Option(`${key}: ${fx.name}`, fx.url));
      sel.value = s ? url : '';
      sel.onchange = () => {
        if (sel.value) config.slots[key] = sel.value;
        else delete config.slots[key];
        saveConfig();
      };
      cell.append(sel);
    } else {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${key}</kbd>`;
      b.append(s ? s.name : '');
      b.disabled = !s;
      b.onclick = () => playSlot(key);
      cell.append(b);
    }
    slots.append(cell);
  }
  $('editKeys').classList.toggle('on', editingKeys);
  $('editKeys').textContent = editingKeys ? 'Done' : 'Change keys';

  // All effects.
  const fx = $('sfxList');
  fx.innerHTML = '';
  for (const t of library.sfx) {
    if (!matches(t.name)) continue;
    const b = document.createElement('button');
    b.className = 'pill';
    b.textContent = t.name;
    b.onclick = () => engine.playSfx(t.url);
    fx.append(b);
  }
  if (!library.sfx.length) fx.innerHTML = '<p class="note">No effects yet. Add files to <code>audio/sfx</code>.</p>';
  $('sfxVol').value = engine.volumes.sfx;
}

engine.onchange = render;

// ---------- Controls ----------

function setVol(which, v) {
  config.volumes[which] = v;
  engine.setVolume(which, v);
  saveConfig();
}

$('masterVol').oninput = (e) => setVol('master', Number(e.target.value));
$('musicVol').oninput = (e) => setVol('music', Number(e.target.value));
$('sfxVol').oninput = (e) => setVol('sfx', Number(e.target.value));
$('mute').onclick = () => engine.toggleMute();
$('stopAll').onclick = () => {
  engine.stopAmbient();
  engine.stopMusic();
};
$('musicPause').onclick = () => engine.togglePause();
$('musicNext').onclick = () => engine.next();
$('musicStop').onclick = () => engine.stopMusic();
$('shuffle').onchange = (e) => {
  engine.shuffle = config.shuffle = e.target.checked;
  saveConfig();
};
$('crossfade').onchange = (e) => {
  engine.crossfade = config.crossfade = Math.min(20, Math.max(0, Number(e.target.value) || 0));
  saveConfig();
  render();
};
$('editKeys').onclick = () => {
  editingKeys = !editingKeys;
  render();
};
$('soundFilter').oninput = (e) => {
  filter = e.target.value.trim().toLowerCase();
  render();
};

// Warm up effects on the first interaction so the first press plays instantly.
addEventListener('pointerdown', function warm() {
  engine.ensure();
  engine.preload(Object.values(config.slots));
  removeEventListener('pointerdown', warm);
});

// Returns true if the key was a sound hotkey.
export function handleSoundKey(e) {
  if (SLOT_KEYS.includes(e.key)) {
    playSlot(e.key);
    return true;
  }
  const k = e.key.toLowerCase();
  if (k === 'm') {
    engine.toggleMute();
    return true;
  }
  if (k === '-' || k === '=' || k === '+') {
    const v = Math.min(1, Math.max(0, engine.volumes.master + (k === '-' ? -0.05 : 0.05)));
    setVol('master', Math.round(v * 100) / 100);
    render();
    return true;
  }
  return false;
}

// Handy for troubleshooting from the browser console.
window.tableRigSound = engine;
