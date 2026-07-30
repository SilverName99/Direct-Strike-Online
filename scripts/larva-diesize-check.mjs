// Does "Larvă: mărime cadru die (%)" really change the drawn corpse?
// Kills a larva in a real match, draws ONLY the corpses onto an offscreen canvas
// and measures the painted pixels — twice, at two different die sizes.
// Throwaway sprites are written and removed again (assets/units is gitignored).
//   node scripts/larva-diesize-check.mjs   (with `php -S 127.0.0.1:8123 -t .` running)
import { chromium } from 'playwright-core';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const DIR = 'assets/units/undead/archon';
const MAN = 'assets/units/manifest.json';

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

if (existsSync(MAN)) { console.error('refusing to overwrite an existing assets/units/manifest.json'); process.exit(1); }
mkdirSync(DIR, { recursive: true });
// the moth is 24x32; the larva's die frame is 20x20 (its own art, hosted here)
for (const [name, rgb, w, h] of [
  ['thumb', [120, 90, 160], 24, 32], ['idle_0', [80, 80, 160], 24, 32], ['idle_1', [90, 90, 170], 24, 32],
  ['walk_0', [60, 120, 60], 24, 32], ['walk_1', [70, 130, 70], 24, 32],
  ['attack_0', [200, 60, 60], 24, 32], ['die_0', [40, 40, 40], 24, 32],
  ['larva-walk_0', [200, 200, 60], 20, 20], ['larva-walk_1', [210, 210, 70], 20, 20],
  ['larva-attack_0', [220, 160, 60], 20, 20], ['larva-attack_1', [230, 170, 70], 20, 20],
  ['larva-die_0', [255, 0, 255], 20, 20], // magenta: easy to find on the canvas
]) writeFileSync(`${DIR}/${name}.png`, png(w, h, rgb));
writeFileSync(MAN, JSON.stringify({
  v: 1,
  races: { undead: { archon: {
    thumb: true, idle: [true, true], walk: [true, true], attack: [true, false], die: [true],
    'larva-walk': [true, true], 'larva-attack': [true, true], 'larva-die': [true],
  } } },
}));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__menu);
  await page.evaluate(() => {
    const m = window.__menu; m.sel.player = 'undead';
    m.showLocalLobby(); m.applyLocal({ action: 'start' });
  });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  await page.waitForTimeout(1500); // sprites

  // measure the painted height of the larva corpse for a given larvaDieSize
  const measure = (dieSize) => page.evaluate(async (ds) => {
    const { spawnUnit, spawnSummon } = await import('/src/sim/entity.js');
    const { applyDamage } = await import('/src/sim/combat.js');
    const { resolvedAbility } = await import('/src/ui/balance.js');
    const g = window.__game;
    const fx = window.__effects;
    fx.corpses.length = 0;
    const ab = resolvedAbility('cocoon');
    Object.assign(ab.params, { larvae: 1, larvaInterval: 0.1, larvaSize: 80, larvaDieSize: ds, life: 30 });
    const moth = spawnUnit(g, 0, 'archon', 1800, 520);
    const pouch = spawnSummon(g, moth, ab, ab.params, 1);
    for (let i = 0; i < 10; i++) { g.update(1 / 30); g.drainEvents(); }
    const larva = g.entities.find((e) => e.hp > 0 && e.summonKind === 'larva');
    if (!larva) return { error: 'no larva hatched' };
    const ovDieSize = larva.ovDieSize;
    applyDamage(g, larva, 99999, 'normal');
    const death = g.drainEvents().find((e) => e.type === 'death' && e.summonKind === 'larva');
    if (!death) return { error: 'no death event', ovDieSize };
    fx.spawnFromEvents([death]); // the same call main.js makes each frame
    if (!fx.corpses.length) return { error: 'no corpse pushed', ovDieSize };
    // draw ONLY the corpses on a clean canvas and find the magenta pixels
    const cv = document.createElement('canvas');
    cv.width = 400; cv.height = 400;
    const ctx = cv.getContext('2d');
    const c = fx.corpses[0];
    const saved = { x: c.x, y: c.y, team: c.team };
    c.x = 200; c.y = 200; c.team = 0;
    fx.drawCorpses(ctx);
    Object.assign(c, saved);
    const d = ctx.getImageData(0, 0, 400, 400).data;
    let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9, n = 0;
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < 400; x++) {
        const i = (y * 400 + x) * 4;
        if (d[i + 3] > 20) { n++; if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      }
    }
    // clean up for the next measurement
    fx.corpses.length = 0;
    for (const e of [...g.entities]) if (e.summon || e.type === 'archon') e.hp = 0;
    g.removeDead(); g.drainEvents();
    return { ovDieSize, painted: n, h: n ? maxY - minY + 1 : 0, w: n ? maxX - minX + 1 : 0 };
  }, dieSize);

  const asLarva = await measure(0);    // 0 = same as the living larva (80%)
  const doubled = await measure(160);  // twice as big
  console.log(JSON.stringify({ asLarva, doubled, errors }, null, 2));
  const ok = asLarva.h > 0 && doubled.h > 0 && Math.abs(doubled.h / asLarva.h - 2) < 0.15;
  console.log(ok ? 'OK — the die size really changes the drawn corpse' : 'FAIL — the setting does not reach the drawing');
} finally {
  await browser.close();
  rmSync(DIR, { recursive: true, force: true });
  rmSync(MAN, { force: true });
}
