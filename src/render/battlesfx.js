// Battle ambience: ONE looping "fighting" track whose volume follows what the
// camera is looking at. Render-only — it reads the sim but never writes to it,
// so it can use Web Audio, timers and the camera freely without touching
// determinism (exactly like effects.js).
//
// The level is two independent factors multiplied:
//   intensity — how many of the units in VIEW are actually swinging (saturating:
//               2 vs 10 fighters must differ, 40 vs 60 must not)
//   proximity — the zoom, eased, never all the way to silence up top
// A battle raging OFF-screen keeps its own faint bed (capped much lower) and
// pans toward where it is, so a distant roar makes you look that way.
//
// Everything is smoothed per frame — fast up, slow down — so the track never
// pumps when the camera moves or the last two fighters die.

import { CONFIG } from '../config.js';

const pct = (v, def) => {
  const n = Number(v);
  return (isFinite(n) ? Math.max(0, n) : def) / 100;
};
const secs = (v, def) => {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : def;
};

export class BattleSfx {
  constructor() {
    this.ctx = null;      // AudioContext, created on the first user gesture
    this.buffer = null;   // decoded loop
    this.src = null;      // the looping source (runs from load to stop, gain does the work)
    this.gain = null;
    this.pan = null;
    this.url = null;
    this.loading = false;
    this.level = 0;       // smoothed gain 0..1
    this.panPos = 0;      // smoothed pan -1..1
    this.master = 1;      // the player's Effects slider
    this.muted = false;
    this.running = false; // only while a match is on screen
  }

  // The uploaded loop (admin). Changing it reloads; null silences and forgets.
  setUrl(url) {
    if (url === this.url) return;
    this.url = url || null;
    this.buffer = null;
    this.stopSource();
    if (this.url && this.ctx) this.load();
  }

  setVolume(v) { this.master = Math.max(0, Math.min(1, v)); }
  setMuted(m) { this.muted = !!m; }

  // Browsers keep audio blocked until the page has seen a real gesture, so the
  // context is created (and resumed) from a click/keypress — same deal as the
  // background music.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!this.buffer && this.url) this.load();
  }

  async load() {
    if (this.loading || !this.ctx || !this.url) return;
    this.loading = true;
    const url = this.url;
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      const bytes = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(bytes);
      if (url !== this.url) return; // swapped while decoding
      this.buffer = buf;
      if (this.running) this.startSource();
    } catch {
      this.buffer = null; // unreadable / unsupported codec — stay silent
    } finally {
      this.loading = false;
    }
  }

  startSource() {
    if (!this.ctx || !this.buffer || this.src) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    // An mp3 carries encoder padding at both ends, so looping it raw leaves a
    // audible gap/click every pass. Trimming a few ms off each end hides it
    // (inaudible on a noise bed); set to 0 for a properly seamless ogg/wav.
    const trim = Math.max(0, Number(CONFIG.BATTLE_SFX_TRIM) || 0) / 1000;
    if (trim > 0 && this.buffer.duration > trim * 3) {
      src.loopStart = trim;
      src.loopEnd = this.buffer.duration - trim;
    }
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    let out = gain;
    let pan = null;
    if (this.ctx.createStereoPanner) {
      pan = this.ctx.createStereoPanner();
      gain.connect(pan);
      out = pan;
    }
    out.connect(this.ctx.destination);
    src.connect(gain);
    try { src.start(0); } catch { /* already started */ }
    this.src = src; this.gain = gain; this.pan = pan;
    this.level = 0; this.panPos = 0;
  }

  stopSource() {
    if (this.src) {
      try { this.src.stop(); } catch { /* not started */ }
      try { this.src.disconnect(); } catch { /* already gone */ }
    }
    this.src = null; this.gain = null; this.pan = null;
    this.level = 0; this.panPos = 0;
  }

  // A match is on screen: keep the loop running (silent until there's a fight).
  start() {
    this.running = true;
    if (!this.buffer) { this.unlock(); return; }
    this.startSource();
  }

  stop() {
    this.running = false;
    this.stopSource();
  }

  // Per frame. `renderer` supplies the visible rect, `camera` the zoom range.
  update(game, renderer, camera, dt) {
    if (!this.running || !this.gain || !game) return;
    let inView = 0, offView = 0, sxIn = 0, sxOff = 0;
    for (const u of game.entities) {
      if (u.hp <= 0 || u.isStructure) continue;
      if (u.state !== 'attack') continue; // only units actually swinging count
      if (renderer.visible(u.x, u.y, 0)) { inView++; sxIn += u.x; }
      else { offView++; sxOff += u.x; }
    }

    // intensity saturates: the first few fighters carry most of the loudness
    const k = Math.max(1, Number(CONFIG.BATTLE_SFX_FIGHTERS) || 8);
    const shape = (n) => (n > 0 ? 1 - Math.exp(-n / k) : 0);

    // proximity: eased so full zoom-out is a distant roar, not silence
    const zMin = camera.minZoom(), zMax = camera.maxZoom();
    const t = zMax > zMin ? Math.max(0, Math.min(1, (camera.zoom - zMin) / (zMax - zMin))) : 1;
    const far = pct(CONFIG.BATTLE_SFX_FAR, 15);
    const prox = far + (1 - far) * t * t;

    const near = shape(inView) * prox;
    const distant = shape(offView) * pct(CONFIG.BATTLE_SFX_OFFSCREEN, 12);
    const base = pct(CONFIG.BATTLE_SFX_VOL, 70);
    const target = this.muted ? 0 : Math.max(near, distant) * base * this.master;

    // fast up / slow down, so it swells into a fight and fades out of one
    const rate = target > this.level
      ? secs(CONFIG.BATTLE_SFX_ATTACK, 0.3)
      : secs(CONFIG.BATTLE_SFX_RELEASE, 1);
    const step = 1 - Math.exp(-Math.max(0, dt) / rate);
    this.level += (target - this.level) * step;
    this.gain.gain.value = Math.max(0, Math.min(1, this.level));

    // pan toward the fighting: the on-screen crowd if there is one, else toward
    // the side the off-screen battle is on (that's the "look over there" hint)
    if (this.pan) {
      const v = renderer.view;
      const mid = (v.x0 + v.x1) / 2, half = Math.max(1, (v.x1 - v.x0) / 2);
      let want = 0;
      if (inView > 0) want = (sxIn / inView - mid) / half;
      else if (offView > 0) want = (sxOff / offView - mid) / half;
      const width = pct(CONFIG.BATTLE_SFX_PAN, 80);
      want = Math.max(-1, Math.min(1, want)) * width;
      // pans follow the camera, so ease them at the release rate (no swishing)
      this.panPos += (want - this.panPos) * (1 - Math.exp(-Math.max(0, dt) / 0.4));
      this.pan.pan.value = Math.max(-1, Math.min(1, this.panPos));
    }
  }
}
