import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
const out = await p.evaluate(async () => {
  const { CONFIG } = await import('/src/config.js');
  const m = window.__menu;
  // two silent tracks with names (a tiny valid wav data URL)
  const wav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
  CONFIG.MENU_MUSICS = [wav, wav];
  CONFIG.MENU_MUSIC_NAMES = ['Marșul Hoardei', 'Cântecul Morților'];
  m.applyButtons();
  const t = () => document.getElementById('music-title');
  const r = { first: t().textContent, hidden: t().classList.contains('hidden') };
  m.changeTrack(1);
  r.second = t().textContent;
  m.changeTrack(1); // wraps back
  r.wrapped = t().textContent;
  CONFIG.MENU_MUSIC_NAMES = ['', ''];   // unnamed -> nothing shown
  m.applyButtons();
  r.unnamed = { text: t().textContent, hidden: t().classList.contains('hidden') };
  CONFIG.MENU_MUSIC_NAMES = ['Marșul Hoardei', 'Cântecul Morților'];
  m.applyButtons();
  return r;
});
console.log(JSON.stringify(out, null, 2), 'errors:', errors);
await p.locator('#menu-sound').screenshot({ path: process.env.OUT });
await b.close();
