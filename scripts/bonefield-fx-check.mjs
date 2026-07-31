// Does the uploaded "Efect Bone Field (cupolă, scalat cu raza)" actually get drawn?
// Puts a throwaway magenta image in the Undead hero's abilityfx-bonefield slot,
// drops a real Bone Field on the ground and measures the painted pixels on a
// clean canvas — the dome must be as wide as the zone's diameter.
// Throwaway sprites are written and removed again (assets/units is gitignored).
//   node scripts/bonefield-fx-check.mjs   (with `php -S 127.0.0.1:8123 -t .` running)
import { chromium } from 'playwright-core';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const DIR = 'assets/units/undead/hero3';
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
for (const [name, rgb, w, h] of [
  ['thumb', [120, 90, 160], 24, 32], ['idle_0', [80, 80, 160], 24, 32], ['idle_1', [90, 90, 170], 24, 32],
  ['abilityfx-bonefield', [255, 0, 255], 200, 100], // magenta 2:1 dome, easy to find
]) writeFileSync(`${DIR}/${name}.png`, png(w, h, rgb));
writeFileSync(MAN, JSON.stringify({
  v: 1,
  races: { undead: { hero3: { thumb: true, idle: [true, true], 'abilityfx-bonefield': true } } },
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

  // Draw ONLY the bone fields on a clean canvas and measure the painted box.
  const measure = (zone) => page.evaluate((z) => {
    const g = window.__game;
    const r = window.__renderer;
    g.boneFields.length = 0;
    g.boneFields.push({ ...z, x: 200, y: 300, until: g.time + 8, team: 0, id: 1 });
    const cv = document.createElement('canvas');
    cv.width = 500; cv.height = 500;
    const ctx = cv.getContext('2d');
    const saved = r.visible;
    r.visible = () => true; // the offscreen canvas has no camera
    r.drawBoneFields(ctx, g);
    r.visible = saved;
    const d = ctx.getImageData(0, 0, 500, 500).data;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, magenta = 0, painted = 0;
    for (let y = 0; y < 500; y++) {
      for (let x = 0; x < 500; x++) {
        const i = (y * 500 + x) * 4;
        if (d[i + 3] <= 20) continue;
        painted++;
        if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) magenta++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    g.boneFields.length = 0;
    return { painted, magenta, w: painted ? maxX - minX + 1 : 0, h: painted ? maxY - minY + 1 : 0, bottom: maxY };
  }, zone);

  // the hero's own field: art is looked up from owner + unitType
  const withImg = await measure({ radius: 120, atkSlow: 30, moveSlow: 30, owner: 0, unitType: 'hero3' });
  // an unknown caster has no uploaded image -> the procedural bone patch
  const noImg = await measure({ radius: 120, atkSlow: 30, moveSlow: 30, owner: 0, unitType: 'nosuchunit' });

  console.log(JSON.stringify({ withImg, noImg, errors }, null, 2));
  const ok = withImg.magenta > 1000                        // the image really paints
    && Math.abs(withImg.w - 240) <= 2                      // width = 2 * radius
    && Math.abs(withImg.h - 120) <= 2                      // 2:1 image -> half the width
    && Math.abs(withImg.bottom - 300) <= 2                 // bottom anchored on the zone centre
    && noImg.magenta === 0 && noImg.painted > 0;           // fallback still draws
  console.log(ok ? 'OK — the uploaded Bone Field image is drawn, scaled to the radius'
                 : 'FAIL — the effect image does not reach the screen');
} finally {
  await browser.close();
  rmSync(DIR, { recursive: true, force: true });
  rmSync(MAN, { force: true });
}
