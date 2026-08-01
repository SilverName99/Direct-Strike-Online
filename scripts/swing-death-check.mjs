// Two timing bugs you can only see by watching the clock:
//
//   attack — the swing was spread over 2x the WIND-UP, not over the unit's real
//            attack period, so a slow attacker played its frames in the first
//            0.8 s and then froze on the last one until the next swing;
//   die    — the corpse always lived 1.2 s and started fading at 0.5 s, while a
//            20-frame death needs 1.67 s to play, so it was cut off mid-fall and
//            was already invisible before it got there.
//
// This prints both timelines: which frame is on screen at each moment of one
// full attack period, and which die frame (plus how visible it is) at each
// moment of a corpse's life. Run before and after a change.
//
//   node scripts/swing-death-check.mjs   (with `php -S 127.0.0.1:8123 -t .` running)
import { chromium } from 'playwright-core';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const DIR = 'assets/units/humans/grunt';
const MAN = 'assets/units/manifest.json';
const N = Number(process.env.N || 20);        // frames per animation
const PERIOD = Number(process.env.PERIOD || 1.2); // seconds between swings
const DIE_FPS = Number(process.env.DIE_FPS || 0); // explicit "Moarte: cadre/s"

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1);
    for (let x = 0; x < w; x++) { const p = o + 1 + x * 4; raw[p] = rgb[0]; raw[p + 1] = rgb[1]; raw[p + 2] = rgb[2]; raw[p + 3] = 255; }
  }
  const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(ty), d]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, cr]);
  };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// one unmistakable colour per die frame, so a canvas scan names the frame
const dieColor = (i) => [20 + i * 11, 200 - i * 7, 40 + ((i * 37) % 180)];

if (existsSync(MAN)) { console.error('refusing to overwrite an existing assets/units/manifest.json'); process.exit(1); }
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/thumb.png`, png(8, 8, [128, 128, 128]));
for (let i = 0; i < N; i++) {
  writeFileSync(`${DIR}/idle_${i}.png`, png(24, 32, [255, 0, 0]));
  writeFileSync(`${DIR}/walk_${i}.png`, png(24, 32, [0, 0, 255]));
  writeFileSync(`${DIR}/attack_${i}.png`, png(24, 32, [255, 0, 255]));
  writeFileSync(`${DIR}/die_${i}.png`, png(24, 32, dieColor(i)));
}
const all = new Array(N).fill(true);
writeFileSync(MAN, JSON.stringify({
  v: 1,
  races: { humans: { grunt: {
    thumb: true, idle: all, walk: all, attack: all, die: all,
    ...(DIE_FPS > 0 ? { fps: { die: DIE_FPS } } : {}),
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
  await page.waitForTimeout(1500);

  const out = await page.evaluate(async ({ N, PERIOD, dieRGB }) => {
    const { spawnUnit } = await import('/src/sim/entity.js');
    const { applyDamage } = await import('/src/sim/combat.js');
    const g = window.__game, r = window.__renderer, fx = window.__effects;
    for (const e of [...g.entities]) e.hp = 0;
    g.removeDead(); g.drainEvents(); fx.corpses.length = 0;

    // ---- ATTACK: one whole period, exactly as the sim drives it
    // (cooldown counts down from PERIOD; windup runs for the first windupMax)
    const u = spawnUnit(g, 0, 'grunt', 1000, 500);
    const wmax = Math.min(0.4, PERIOD * 0.5);
    const swing = [];
    r.hitAt.clear();
    for (let t = 0; t < PERIOD - 1e-9; t += 0.05) {
      u.state = 'attack';
      u.windupMax = wmax;
      u.windup = t < wmax ? wmax - t : 0;
      u.cooldown = PERIOD - t;
      r.now = t;                       // the renderer's own clock
      swing.push(r.attackFrame(u));
    }
    // how long the LAST frame is held before the swing restarts
    let frozen = 0;
    for (let i = swing.length - 1; i > 0 && swing[i] === N - 1; i--) frozen++;

    // ---- DIE: the corpse, sampled over its real life
    const victim = spawnUnit(g, 0, 'grunt', 1000, 500);
    applyDamage(g, victim, 99999, 'normal');
    const ev = g.drainEvents().find((e) => e.type === 'death');
    fx.corpses.length = 0;
    if (ev) fx.spawnFromEvents([ev]);
    const names = new Map(dieRGB.map(([rgb, i]) => [rgb.join(','), i]));
    const cv = document.createElement('canvas');
    cv.width = 300; cv.height = 300;
    const cx = cv.getContext('2d');
    const death = [];
    const DT = 1 / 30;
    for (let step = 0; step < 200 && fx.corpses.length; step++) {
      const c = fx.corpses[0];
      const keep = { x: c.x, y: c.y, team: c.team };
      c.x = 150; c.y = 150; c.team = 0;
      cx.clearRect(0, 0, 300, 300);
      fx.drawCorpses(cx);
      Object.assign(c, keep);
      const d = cx.getImageData(0, 0, 300, 300).data;
      // the most common opaque-ish marker colour = the frame; its alpha = how
      // visible the corpse is right now
      const tally = new Map(); let maxA = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        if (d[i + 3] > maxA) maxA = d[i + 3];
        const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
        if (names.has(k)) tally.set(k, (tally.get(k) || 0) + 1);
      }
      let best = null, n2 = 0;
      for (const [k, v] of tally) if (v > n2) { n2 = v; best = k; }
      death.push({ t: +(step * DT).toFixed(2), frame: best != null ? names.get(best) : -1, alpha: +(maxA / 255).toFixed(2) });
      fx.update(DT, g);
    }
    fx.corpses.length = 0;
    return {
      wmax, swing, frozenSamples: frozen,
      framesUsedInSwing: new Set(swing).size,
      lastFrameReached: Math.max(...swing),
      death,
      dieLife: death.length ? +(death[death.length - 1].t + DT).toFixed(2) : 0,
      dieFramesShown: new Set(death.map((d) => d.frame)).size,
      dieLastFrame: Math.max(...death.map((d) => d.frame)),
    };
  }, { N, PERIOD, dieRGB: Array.from({ length: N }, (_, i) => [dieColor(i), i]) });

  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log(`--- ATTACK  (${N} cadre, perioadă ${PERIOD}s, windup ${out.wmax}s)`);
  console.log('frame la fiecare 0.05s:', out.swing.join(' '));
  console.log(`cadre folosite: ${out.framesUsedInSwing}/${N}   ultimul atins: ${out.lastFrameReached}` +
    `   înghețat pe ultimul cadru: ${(out.frozenSamples * 0.05).toFixed(2)}s din ${PERIOD}s`);
  console.log(`--- DIE  (${N} cadre${DIE_FPS ? `, ${DIE_FPS} cadre/s` : ', automat'})`);
  console.log('t / cadru / opacitate:', out.death.map((d) => `${d.t}:${d.frame}@${pct(d.alpha)}`).join(' '));
  console.log(`viață cadavru: ${out.dieLife}s   cadre arătate: ${out.dieFramesShown}/${N}   ultimul: ${out.dieLastFrame}`);
  if (errors.length) console.log('errors:', errors);
} finally {
  await browser.close();
  rmSync(DIR, { recursive: true, force: true });
  rmSync(MAN, { force: true });
}
