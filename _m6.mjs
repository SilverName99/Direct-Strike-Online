import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
await p.evaluate(async (name) => {
  const { CONFIG } = await import('/src/config.js');
  const wav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
  CONFIG.MENU_MUSICS = [wav, wav];
  CONFIG.MENU_MUSIC_NAMES = [name, 'x'];
  window.__menu.applyButtons();
}, process.env.NAME);
await p.waitForTimeout(250);
console.log(await p.evaluate(() => {
  const t = document.getElementById('music-title').getBoundingClientRect();
  const s = document.getElementById('snd-range').getBoundingClientRect();
  return { titleMid: Math.round(t.left + t.width / 2), sliderMid: Math.round(s.left + s.width / 2) };
}), errors);
await p.screenshot({ path: process.env.OUT, clip: { x: 800, y: 520, width: 400, height: 180 } });
await b.close();
