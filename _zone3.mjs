import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
await p.evaluate(() => { const m = window.__menu; m.sel.player='undead'; m.showLocalLobby(); m.applyLocal({action:'start'}); });
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await p.evaluate(async () => {
  const { CONFIG } = await import('/src/config.js');
  const c = window.__camera;
  const az = CONFIG.ARMY_ZONE[0], cz = CONFIG.CONSTRUCTION_ZONE[0];
  c.zoom = c.fitZoom() * 1.6;
  c.centerOn((az.x0 + cz.x1) / 2, az.y0 + 120);
});
await p.waitForTimeout(500);
await p.locator('#canvas-wrap').screenshot({ path: process.env.OUT });
console.log('errors:', errors);
await b.close();
