// Multi-frame animations: does a CLASSIC two-frame unit still draw exactly the
// same frames it used to? Paints throwaway art where every frame is one flat,
// unique colour, then renders a fixed set of (state, clock) samples and reports
// which colour landed on the canvas. Run it on the old code and on the new one:
// the two signatures must match character for character.
//
// A second pass uploads EIGHT walk frames and checks that all eight now play,
// which the old code could never do.
//   node scripts/frames-check.mjs   (with `php -S 127.0.0.1:8123 -t .` running)
import { chromium } from 'playwright-core';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const DIR = 'assets/units/humans/grunt';
const MAN = 'assets/units/manifest.json';
const EIGHT = process.env.EIGHT === '1'; // second pass: 8 walk frames
const FPS = process.env.FPS ? Number(process.env.FPS) : 0; // explicit walk frames/second
const SIZE = process.env.SIZE ? Number(process.env.SIZE) : 0; // explicit walk size (%)

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1);
    for (let x = 0; x < w; x++) {
      const p = o + 1 + x * 4;
      raw[p] = rgb[0]; raw[p + 1] = rgb[1]; raw[p + 2] = rgb[2]; raw[p + 3] = 255;
    }
  }
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// one unmistakable colour per frame, so a canvas scan says which frame drew
const COLORS = {
  idle_0: [255, 0, 0], idle_1: [0, 255, 0],
  walk_0: [0, 0, 255], walk_1: [255, 255, 0],
  attack_0: [255, 0, 255], attack_1: [0, 255, 255],
  die_0: [255, 255, 255], thumb: [128, 128, 128],
};
// the extra walk frames of the second pass (kept far apart in hue)
const EXTRA_WALK = [[255, 128, 0], [128, 0, 255], [0, 128, 128], [128, 128, 0], [255, 0, 128], [0, 200, 100]];

if (existsSync(MAN)) { console.error('refusing to overwrite an existing assets/units/manifest.json'); process.exit(1); }
mkdirSync(DIR, { recursive: true });
for (const [name, rgb] of Object.entries(COLORS)) writeFileSync(`${DIR}/${name}.png`, png(24, 32, rgb));
const walkFrames = [true, true];
if (EIGHT) {
  EXTRA_WALK.forEach((rgb, i) => { writeFileSync(`${DIR}/walk_${i + 2}.png`, png(24, 32, rgb)); walkFrames.push(true); });
}
writeFileSync(MAN, JSON.stringify({
  v: 1,
  races: { humans: { grunt: {
    thumb: true, idle: [true, true], walk: walkFrames, attack: [true, true], die: [true],
    ...(FPS > 0 ? { fps: { walk: FPS } } : {}),
    ...(SIZE > 0 ? { animSize: { walk: SIZE } } : {}),
  } } },
}));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__menu);
  await page.evaluate(() => {
    const m = window.__menu; m.sel.player = 'humans';
    m.showLocalLobby(); m.applyLocal({ action: 'start' });
  });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  await page.waitForTimeout(1500); // sprites

  const out = await page.evaluate(async () => {
    const { spawnUnit } = await import('/src/sim/entity.js');
    const g = window.__game, r = window.__renderer, fx = window.__effects;
    // a clean stage: one unit of ours, nothing else alive to paint over it
    for (const e of [...g.entities]) e.hp = 0;
    g.removeDead(); g.drainEvents();
    fx.corpses.length = 0;
    const u = spawnUnit(g, 0, 'grunt', 1000, 500);
    r.camera.x = u.x - r.camera.viewW() / 2;
    r.camera.y = u.y - r.camera.viewH() / 2;

    const NAMES = {
      '255,0,0': 'idle_0', '0,255,0': 'idle_1', '0,0,255': 'walk_0', '255,255,0': 'walk_1',
      '255,0,255': 'attack_0', '0,255,255': 'attack_1', '255,255,255': 'die_0',
      '255,128,0': 'walk_2', '128,0,255': 'walk_3', '0,128,128': 'walk_4',
      '128,128,0': 'walk_5', '255,0,128': 'walk_6', '0,200,100': 'walk_7',
    };
    // Which marker colour covers the most pixels after one full draw?
    const shot = (clock, setup) => {
      setup(u);
      const real = performance.now;
      performance.now = () => clock * 1000; // deterministic render clock
      try { r.draw(g, 1, window.__ui, fx); } finally { performance.now = real; }
      const cv = r.ctx.canvas;
      const d = r.ctx.getImageData(0, 0, cv.width, cv.height).data;
      const tally = new Map();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue;
        const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
        if (NAMES[k]) tally.set(k, (tally.get(k) || 0) + 1);
      }
      let best = null, n = 0;
      for (const [k, v] of tally) if (v > n) { n = v; best = k; }
      return best ? NAMES[best] : 'none';
    };

    const idle = (x) => { x.state = 'idle'; x.windup = 0; x.spellHold = false; };
    const march = (x) => { x.state = 'march'; x.windup = 0; x.spellHold = false; };
    const swingUp = (x) => { x.state = 'attack'; x.windupMax = 0.2; x.windup = 0.2; x.spellHold = false; };
    const swingMid = (x) => { x.state = 'attack'; x.windupMax = 0.2; x.windup = 0.1; x.spellHold = false; };
    const swingHit = (x) => { x.state = 'attack'; x.windupMax = 0.2; x.windup = 0; x.spellHold = false; };

    const sig = {};
    // grunt animSpeed is 4 -> a flip every 0.25 s; sample either side of each flip
    for (const t of [0, 0.13, 0.26, 0.39, 0.52, 0.65, 0.78, 0.91]) {
      sig[`idle@${t}`] = shot(t, idle);
      sig[`walk@${t}`] = shot(t, march);
    }
    if (r.attackHold) r.attackHold.clear();
    if (r.hitAt) r.hitAt.clear(); // only exists on the new code
    sig['swing-start'] = shot(2.0, swingUp);
    sig['swing-half'] = shot(2.0, swingMid);
    sig['swing-hit'] = shot(2.0, swingHit);
    sig['swing-after'] = shot(2.4, swingHit); // 0.4 s past the hit

    // With an explicit "cadre/s" in the manifest the rate must be taken
    // LITERALLY: at 4 fps a frame lasts 0.25 s, whatever animSpeed says.
    // (the swing samples above left an attack-hold behind — clear it, or the
    // unit keeps drawing its attack pose instead of walking)
    if (r.attackHold) r.attackHold.clear();
    if (r.hitAt) r.hitAt.clear();
    const fps = {};
    for (const t of [0, 0.13, 0.26, 0.39, 0.52, 0.65]) fps[`walk@${t}`] = shot(t, march);

    // "Size cadre (%)": measure the painted height of a walk frame, so a size
    // override shows up as a real change in pixels on the canvas.
    const measure = (setup) => {
      setup(u);
      const real = performance.now;
      performance.now = () => 0;
      try { r.draw(g, 1, window.__ui, fx); } finally { performance.now = real; }
      const cv = r.ctx.canvas;
      const d = r.ctx.getImageData(0, 0, cv.width, cv.height).data;
      let minY = 1e9, maxY = -1e9;
      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (d[i + 3] <= 200) continue;
          const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
          if (!NAMES[k] || !NAMES[k].startsWith('walk')) continue;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      return maxY >= minY ? maxY - minY + 1 : 0;
    };
    const walkHeight = measure(march);
    return { sig, fps, walkHeight, errors: [] };
  });

  console.log(JSON.stringify({ eightFrames: EIGHT, walkFps: FPS, walkSize: SIZE, ...out, errors }, null, 2));
} finally {
  await browser.close();
  rmSync(DIR, { recursive: true, force: true });
  rmSync(MAN, { force: true });
}
