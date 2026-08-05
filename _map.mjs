import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
await p.evaluate(() => { const m = window.__menu; m.sel.player='undead'; m.showLocalLobby(); m.applyLocal({action:'start'}); });
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await p.waitForTimeout(500);
console.log(await p.evaluate(async () => {
  const { CONFIG } = await import('/src/config.js');
  const c = window.__camera;
  return { fieldH: CONFIG.FIELD_H, laneH: CONFIG.LANE_H,
           startZoom: +c.zoom.toFixed(4), fit: +c.fitZoom().toFixed(4),
           viewH: Math.round(c.viewH()) };
}));
await p.locator('#canvas-wrap').screenshot({ path: process.env.A });
// zoom all the way out to see the whole map
await p.evaluate(() => { const c = window.__camera; c.zoom = c.minZoom(); c.clamp && c.clamp(); });
await p.waitForTimeout(300);
await p.locator('#canvas-wrap').screenshot({ path: process.env.B });
await p.locator('#bb-map').screenshot({ path: process.env.C });
console.log('errors:', errors);
await b.close();
