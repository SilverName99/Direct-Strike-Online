import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
const r = await p.evaluate(async (name) => {
  const { CONFIG } = await import('/src/config.js');
  const wav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
  CONFIG.MENU_MUSICS = [wav, wav];
  CONFIG.MENU_MUSIC_NAMES = [name, 'x'];
  window.__menu.applyButtons();
  await new Promise(r => setTimeout(r, 150));
  const t = document.getElementById('music-title').getBoundingClientRect();
  const s = document.getElementById('snd-range').getBoundingClientRect();
  return { dMid: Math.round((t.left + t.width/2) - (s.left + s.width/2)),
           fitsRight: t.right <= window.innerWidth - 10 };
}, process.env.NAME);
console.log(process.env.NAME, JSON.stringify(r));
await p.screenshot({ path: process.env.OUT, clip: { x: 800, y: 520, width: 400, height: 180 } });
await b.close();
