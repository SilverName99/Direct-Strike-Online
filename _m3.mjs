import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
await p.evaluate(async () => {
  const { CONFIG } = await import('/src/config.js');
  const wav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
  CONFIG.MENU_MUSICS = [wav, wav];
  CONFIG.MENU_MUSIC_NAMES = ['Marșul Hoardei', 'Cântecul Morților'];
  window.__menu.applyButtons();
});
await p.waitForTimeout(200);
console.log(await p.evaluate(() => {
  const t = document.getElementById('music-title').getBoundingClientRect();
  const pod = document.getElementById('menu-sound').getBoundingClientRect();
  return { titleFits: t.left >= pod.left - 1 && t.right <= pod.right + 1, text: document.getElementById('music-title').textContent };
}), errors);
await p.locator('#menu-sound').screenshot({ path: process.env.OUT });
await b.close();
