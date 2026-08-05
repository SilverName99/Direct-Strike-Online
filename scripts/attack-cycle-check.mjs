// Does a CASTER with an uploaded "Attack 2" cycle its two attack frames?
// Writes throwaway sprites for undead/archon + a manifest, runs the check in a
// real browser, then removes them again (assets/units is gitignored anyway).
//   node scripts/attack-cycle-check.mjs   (with `php -S 127.0.0.1:8123 -t .` running)
import { chromium } from 'playwright-core';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const DIR = 'assets/units/undead/archon';
const MAN = 'assets/units/manifest.json';

// --- throwaway sprites (one flat colour per frame) --------------------------
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

const hadManifest = existsSync(MAN);
if (hadManifest) { console.error('refusing to overwrite an existing assets/units/manifest.json'); process.exit(1); }
mkdirSync(DIR, { recursive: true });
const frames = {
  thumb: [120, 90, 160], idle_0: [80, 80, 160], idle_1: [90, 90, 170],
  walk_0: [60, 120, 60], walk_1: [70, 130, 70],
  attack_0: [200, 60, 60], attack_1: [60, 60, 200], die_0: [40, 40, 40],
};
for (const [name, rgb] of Object.entries(frames)) writeFileSync(`${DIR}/${name}.png`, png(24, 32, rgb));
writeFileSync(MAN, JSON.stringify({
  v: 1,
  races: { undead: { archon: { thumb: true, idle: [true, true], walk: [true, true], attack: [true, true], die: [true] } } },
}));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL);
  await page.waitForFunction(() => !!window.__menu);
  await page.evaluate(() => {
    const m = window.__menu;
    m.sel.player = 'undead';
    m.showLocalLobby();
    m.applyLocal({ action: 'start' });
  });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  await page.waitForTimeout(1500); // let the manifest images load

  const res = await page.evaluate(async () => {
    const ch = await import('/src/render/characters.js');
    const bal = await import('/src/ui/balance.js');
    const { spawnUnit } = await import('/src/sim/entity.js');
    const g = window.__game;
    const st = bal.statsUnit('undead', 'archon'); // a CASTER, like the live moth
    st.caster = true; st.mana = 100; st.abilities = [];
    const moth = spawnUnit(g, 0, 'archon', 1800, 520);
    const foe = spawnUnit(g, 1, 'grunt', 1815, 520);
    foe.maxHp = foe.hp = 999999;
    const seen = new Set();
    for (let i = 0; i < 90; i++) {
      g.update(1 / 30); g.drainEvents();
      if (moth.state === 'attack') seen.add(window.__renderer.attackFrame(moth));
    }
    return { hasAttackCycle: ch.hasAttackCycle('archon', 0), caster: !!st.caster, framesSeen: [...seen] };
  });

  console.log(JSON.stringify({ ...res, errors }, null, 2));
  const ok = res.hasAttackCycle && res.framesSeen.length === 2;
  console.log(ok ? 'OK — the caster cycles Attack 1 <-> Attack 2' : 'FAIL — no cycle');
} finally {
  await browser.close();
  rmSync(DIR, { recursive: true, force: true });
  rmSync(MAN, { force: true });
}
