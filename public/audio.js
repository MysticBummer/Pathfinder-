// Sound engine: ambient layers, music playlists with crossfade, and one-shot effects.
// Everything plays through the laptop, routed through Web Audio gain nodes so
// volumes can fade smoothly.

const FADE = 1.5; // seconds for ambient layers to fade in and out

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.layers = new Map(); // url -> { name, url, el, gain, volume }
    this.buffers = new Map(); // url -> Promise<AudioBuffer>
    this.decks = [];
    this.deck = 0;
    this.playlist = null; // { name, tracks, order, pos }
    this.paused = false;
    this.advancing = false;
    this.failures = 0;
    this.volumes = { master: 0.8, music: 0.5, sfx: 0.9 };
    this.muted = false;
    this.crossfade = 4;
    this.shuffle = true;
    this.onchange = () => {};
  }

  // The browser only allows sound after a click or key press, so this is
  // called from every action that makes noise.
  ensure() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.ambientBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      for (const bus of [this.ambientBus, this.musicBus, this.sfxBus]) bus.connect(this.master);
      this.decks = [this.makeDeck(), this.makeDeck()];
      this.applyVolumes(0);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  ramp(param, value, seconds) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    if (seconds > 0) param.linearRampToValueAtTime(value, now + seconds);
    else param.setValueAtTime(value, now);
  }

  applyVolumes(seconds = 0.15) {
    if (!this.ctx) return;
    this.ramp(this.master.gain, this.muted ? 0 : this.volumes.master, seconds);
    this.ramp(this.musicBus.gain, this.volumes.music, seconds);
    this.ramp(this.sfxBus.gain, this.volumes.sfx, seconds);
  }

  setVolume(which, v) {
    this.volumes[which] = v;
    this.applyVolumes();
    this.onchange();
  }

  toggleMute() {
    this.ensure();
    this.muted = !this.muted;
    this.applyVolumes(0.3);
    this.onchange();
  }

  // ---------- Ambient layers ----------

  hasLayer(url) {
    return this.layers.has(url);
  }

  addLayer(track, volume = 0.7) {
    if (this.layers.has(track.url)) return;
    const ctx = this.ensure();
    const el = new Audio(track.url);
    el.loop = true;
    el.preload = 'auto';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain);
    gain.connect(this.ambientBus);
    const layer = { name: track.name, url: track.url, el, gain, volume };
    this.layers.set(track.url, layer);
    el.play().catch((err) => console.warn('Ambient failed', track.url, err));
    this.ramp(gain.gain, volume, FADE);
    this.onchange();
  }

  removeLayer(url) {
    const layer = this.layers.get(url);
    if (!layer) return;
    this.layers.delete(url);
    this.ramp(layer.gain.gain, 0, FADE);
    setTimeout(() => {
      layer.el.pause();
      layer.el.removeAttribute('src');
      layer.el.load();
      layer.gain.disconnect();
    }, FADE * 1000 + 100);
    this.onchange();
  }

  toggleLayer(track) {
    if (this.layers.has(track.url)) this.removeLayer(track.url);
    else this.addLayer(track);
  }

  setLayerVolume(url, v) {
    const layer = this.layers.get(url);
    if (!layer) return;
    layer.volume = v;
    this.ramp(layer.gain.gain, v, 0.15);
  }

  stopAmbient() {
    for (const url of [...this.layers.keys()]) this.removeLayer(url);
  }

  // Swap to exactly this set of layers, keeping ones that are already playing.
  // Used by scenes.
  setLayers(list) {
    const wanted = new Map(list.map((l) => [l.url, l]));
    for (const url of [...this.layers.keys()]) if (!wanted.has(url)) this.removeLayer(url);
    for (const l of list) {
      if (this.layers.has(l.url)) this.setLayerVolume(l.url, l.volume);
      else this.addLayer(l, l.volume);
    }
  }

  // ---------- Music ----------

  makeDeck() {
    const el = new Audio();
    el.preload = 'auto';
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(gain);
    gain.connect(this.musicBus);
    const deck = { el, gain, track: null };
    el.addEventListener('timeupdate', () => {
      if (deck !== this.decks[this.deck] || this.advancing || !el.duration) return;
      if (el.duration - el.currentTime <= this.crossfade) this.next();
    });
    el.addEventListener('ended', () => {
      if (deck === this.decks[this.deck] && !this.advancing) this.next();
    });
    el.addEventListener('error', () => {
      if (deck !== this.decks[this.deck] || !deck.track) return;
      console.warn('Music track failed', deck.track.url);
      this.failures++;
      if (this.playlist && this.failures < this.playlist.tracks.length) this.next();
    });
    el.addEventListener('playing', () => {
      if (deck === this.decks[this.deck]) this.failures = 0;
    });
    return deck;
  }

  playPlaylist(name, tracks) {
    if (!tracks || !tracks.length) return;
    this.ensure();
    const order = tracks.map((_, i) => i);
    if (this.shuffle) shuffleInPlace(order);
    this.playlist = { name, tracks, order, pos: 0 };
    this.paused = false;
    this.failures = 0;
    this.startTrack(tracks[order[0]]);
  }

  next() {
    const p = this.playlist;
    if (!p) return;
    p.pos++;
    if (p.pos >= p.order.length) {
      p.pos = 0;
      if (this.shuffle) {
        const last = p.order[p.order.length - 1];
        shuffleInPlace(p.order);
        // Don't repeat the same track back to back across a reshuffle.
        if (p.order.length > 1 && p.order[0] === last) [p.order[0], p.order[1]] = [p.order[1], p.order[0]];
      }
    }
    this.paused = false;
    this.startTrack(p.tracks[p.order[p.pos]]);
  }

  // Crossfade from whatever is playing into this track.
  startTrack(track) {
    this.ensure();
    const fade = Math.max(0.05, this.crossfade);
    const old = this.decks[this.deck];
    this.deck = 1 - this.deck;
    const fresh = this.decks[this.deck];

    this.advancing = true;
    this.ramp(old.gain.gain, 0, fade);
    const oldEl = old.el;
    setTimeout(() => {
      if (old !== this.decks[this.deck]) oldEl.pause();
    }, fade * 1000 + 100);

    fresh.track = track;
    fresh.el.src = track.url;
    fresh.el.currentTime = 0;
    fresh.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    fresh.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    fresh.el.play().catch((err) => console.warn('Music failed', track.url, err));
    this.ramp(fresh.gain.gain, 1, fade);
    // Let the crossfade settle before the next one can trigger.
    setTimeout(() => (this.advancing = false), fade * 1000 + 200);
    this.onchange();
  }

  togglePause() {
    const d = this.decks[this.deck];
    if (!this.playlist || !d) return;
    this.ensure();
    if (this.paused) {
      d.el.play();
      this.ramp(d.gain.gain, 1, 0.5);
    } else {
      this.ramp(d.gain.gain, 0, 0.5);
      setTimeout(() => this.paused && d.el.pause(), 550);
    }
    this.paused = !this.paused;
    this.onchange();
  }

  stopMusic() {
    if (!this.ctx) return;
    const fade = Math.max(0.5, this.crossfade);
    for (const d of this.decks) {
      this.ramp(d.gain.gain, 0, fade);
      const el = d.el;
      setTimeout(() => !this.playlist && el.pause(), fade * 1000 + 100);
    }
    this.playlist = null;
    this.paused = false;
    this.onchange();
  }

  nowPlaying() {
    if (!this.playlist) return null;
    return { playlist: this.playlist.name, track: this.decks[this.deck].track, paused: this.paused };
  }

  // ---------- Effects ----------

  loadBuffer(url) {
    if (!this.buffers.has(url)) {
      const p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(r.status);
          return r.arrayBuffer();
        })
        .then((data) => this.ctx.decodeAudioData(data));
      p.catch(() => this.buffers.delete(url));
      this.buffers.set(url, p);
    }
    return this.buffers.get(url);
  }

  async playSfx(url) {
    const ctx = this.ensure();
    try {
      const buffer = await this.loadBuffer(url);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.sfxBus);
      src.start();
    } catch (err) {
      console.warn('Effect failed', url, err);
    }
  }

  // Decode effects ahead of time so the first press isn't delayed.
  preload(urls) {
    if (!this.ctx) return;
    for (const u of urls) this.loadBuffer(u).catch(() => {});
  }
}

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
