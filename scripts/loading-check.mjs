// Entering a match on a weak connection used to drop you into a game of
// placeholder shapes: the loading screen gave up after a flat 25 s whether the
// assets were still arriving or not. This drives the real loading screen with
// the sprite downloads artificially slowed, and checks three things:
//
//   1. the bar reports what is actually downloading (N/M + the file name);
//   2. the match does NOT start until every sprite has landed;
//   3. a connection that dies mid-load still releases you (stall detection),
//      instead of hanging the menu forever.
//
//   node scripts/loading-check.mjs   (with `php -S 127.0.0.1:8123 -t .` running)
import { chromium } from 'playwright-core';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const DIR = 'assets/units/humans/grunt';
const MAN = 'assets/units/manifest.json';
const DELAY = Number(process.env.DELAY || 120); // ms added to every sprite request

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

if (existsSync(MAN)) { console.error('refusing to overwrite an existing assets/units/manifest.json'); process.exit(1); }
mkdirSync(DIR, { recursive: true });
const N = 12; // frames per animation -> ~50 images, enough to watch a bar move
writeFileSync(`${DIR}/thumb.png`, png(8, 8, [128, 128, 128]));
for (let i = 0; i < N; i++) {
  for (const a of ['idle', 'walk', 'attack', 'die']) writeFileSync(`${DIR}/${a}_${i}.png`, png(24, 32, [200, 40 + i * 10, 60]));
}
const all = new Array(N).fill(true);
writeFileSync(MAN, JSON.stringify({ v: 1, races: { humans: { grunt: { thumb: true, idle: all, walk: all, attack: all, die: all } } } }));

const run = async (mode) => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // "slow": every sprite takes DELAY ms longer.  "dead": the sprites are
  // requested and then never answered at all — the case a flat timeout exists
  // for, and the one the stall detector has to catch.
  // The delays are CHAINED, not concurrent: route handlers run in parallel by
  // default, which would just add DELAY once to the whole batch instead of
  // throttling the pipe. Serialising them is what a thin connection feels like.
  let served = 0;
  let queue = Promise.resolve();
  await page.route('**/assets/units/humans/grunt/*.png*', async (route) => {
    if (mode === 'dead' && served >= 10) return; // swallow: no response, ever
    served++;
    const turn = queue.then(() => new Promise((r) => setTimeout(r, DELAY)));
    queue = turn;
    await turn;
    await route.continue().catch(() => {});
  });

  await page.goto(URL);
  await page.waitForFunction(() => !!window.__menu);
  // the real path: lobby -> start -> 5 s countdown -> loading screen -> match
  await page.evaluate(() => {
    const m = window.__menu;
    m.sel.player = 'humans';
    m.showLocalLobby();
    m.applyLocal({ action: 'start' });
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('#menu-load');
    return el && !el.classList.contains('hidden');
  }, null, { timeout: 20000 });
  const t0 = Date.now(); // from the moment the loading screen is up

  // sample what the loading screen says while it works
  const notes = [];
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(() => {
      const n = document.querySelector('#menu-load .load-note');
      const f = document.querySelector('#menu-load .load-fill');
      const gone = document.querySelector('#menu-load')?.classList.contains('hidden');
      return { note: n ? n.textContent.trim() : null, width: f ? f.style.width : null, gone, game: !!window.__game };
    });
    if (s.note && (!notes.length || notes[notes.length - 1].note !== s.note)) notes.push(s);
    if (s.game) break;
    await page.waitForTimeout(100);
  }

  await page.waitForFunction(() => !!window.__game, null, { timeout: 40000 }).catch(() => {});
  const took = Date.now() - t0;
  const out = await page.evaluate(async () => {
    const { spritesReady, spriteProgress, getSprite } = await import('/src/render/sprites.js');
    return { ready: spritesReady(), progress: spriteProgress(), started: !!window.__game, haveArt: !!getSprite('humans', 'grunt', 'walk', 5) };
  });
  await browser.close();
  return { mode, took, notes, ...out, errors };
};

for (const mode of ['slow', 'dead']) {
  const r = await run(mode);
  console.log(`--- ${mode.toUpperCase()}  (a pornit după ${(r.took / 1000).toFixed(1)}s)`);
  console.log('    mesaje pe ecranul de încărcare:');
  for (const n of r.notes.slice(0, 6)) console.log(`      [${String(n.width).padStart(4)}] ${n.note}`);
  if (r.notes.length > 6) console.log(`      … încă ${r.notes.length - 6}`);
  console.log(`    meciul a pornit: ${r.started}   sprite-uri gata: ${r.ready}   ` +
    `încărcate ${r.progress.loaded}/${r.progress.total}   arta e pe ecran: ${r.haveArt}`);
  if (r.errors.length) console.log('    errors:', r.errors);
}

rmSync(DIR, { recursive: true, force: true });
rmSync(MAN, { force: true });
