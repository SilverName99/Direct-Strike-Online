// Battle ambience: does the loop actually follow what the camera sees?
// Writes a throwaway .wav loop + manifest, starts a match, stages fights and
// reads back the live gain/pan out of the Web Audio graph. Cleans up after.
//   node scripts/battle-sfx-check.mjs   (with `php -S 127.0.0.1:8123 -t .` running)
import { chromium } from 'playwright-core';
import { writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const MAN = 'assets/units/manifest.json';
const WAV = 'assets/units/battle.wav';

// 1 second of quiet noise, 22 kHz mono — enough to decode and loop
function wav(seconds = 1, rate = 22050) {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  let seed = 1;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data.writeInt16LE(((seed % 2000) - 1000), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

if (existsSync(MAN)) { console.error('refusing to overwrite an existing assets/units/manifest.json'); process.exit(1); }
mkdirSync('assets/units', { recursive: true });
writeFileSync(WAV, wav());
writeFileSync(MAN, JSON.stringify({ v: 1, races: {}, battle: 'battle.wav' }));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__menu);
  await page.mouse.click(700, 400); // a real gesture: unlocks Web Audio
  await page.evaluate(() => {
    const m = window.__menu; m.sel.player = 'undead';
    m.showLocalLobby(); m.applyLocal({ action: 'start' });
  });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  await page.waitForFunction(() => !!(window.__sfx && window.__sfx.buffer), null, { timeout: 10000 })
    .catch(() => {});

  // stage a fight: `where` = 'view' (in front of the camera) or 'far' (off-screen)
  const stage = (n, where, zoom) => page.evaluate(async ([count, place, z]) => {
    const { spawnUnit } = await import('/src/sim/entity.js');
    const g = window.__game, sfx = window.__sfx, cam = window.__camera;
    for (const e of [...g.entities]) e.hp = 0;
    g.removeDead(); g.drainEvents();
    cam.zoom = cam.minZoom() + (cam.maxZoom() - cam.minZoom()) * z;
    const view = window.__renderer.view;
    const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
    // in view: to the LEFT of centre (so the pan must go negative)
    const x = place === 'view' ? cx - (view.x1 - view.x0) * 0.3 : view.x1 + 1200;
    for (let i = 0; i < count; i++) {
      const a = spawnUnit(g, 0, 'grunt', x + i * 6, cy);
      const b = spawnUnit(g, 1, 'grunt', x + i * 6 + 12, cy);
      a.state = b.state = 'attack'; // what the mixer counts
    }
    // let the smoothing settle (fast attack, slow release)
    for (let i = 0; i < 120; i++) sfx.update(g, window.__renderer, cam, 1 / 30);
    return { gain: +sfx.level.toFixed(4), pan: +sfx.panPos.toFixed(3) };
  }, [n, where, zoom]);

  const out = {
    silent: await stage(0, 'view', 1),
    twoClose: await stage(2, 'view', 1),
    manyClose: await stage(20, 'view', 1),
    manyFarZoom: await stage(20, 'view', 0),
    offScreen: await stage(20, 'far', 1),
    errors,
  };
  console.log(JSON.stringify(out, null, 2));
  const ok = out.silent.gain < 0.01
    && out.twoClose.gain > out.silent.gain
    && out.manyClose.gain > out.twoClose.gain
    && out.manyFarZoom.gain > 0 && out.manyFarZoom.gain < out.manyClose.gain * 0.5
    && out.offScreen.gain > 0 && out.offScreen.gain < out.manyClose.gain * 0.5
    && out.manyClose.pan < -0.1;
  console.log(ok ? 'OK — volume follows the fight, the zoom and the off-screen bed; it pans left' : 'FAIL');
} finally {
  await browser.close();
  rmSync(WAV, { force: true });
  rmSync(MAN, { force: true });
}
