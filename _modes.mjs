import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
// a 3v3 room, to check the team layouts too
await p.evaluate(() => {
  const m = window.__menu;
  m.sel.player = 'undead';
  m.showLocalLobby();
  for (const side of [0, 1]) for (const depth of [1, 2]) {
    m.applyLocal({ action: 'slot', side, depth, kind: 'bot', race: side ? 'orcs' : 'humans', difficulty: 'normal' });
  }
  m.applyLocal({ action: 'start' });
});
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await p.waitForTimeout(600);
console.log(await p.evaluate(async () => {
  const { CONFIG } = await import('/src/config.js');
  const g = window.__game;
  const zs = g.zones.map(z => ({ y0: z.army.y0, y1: z.army.y1 }));
  return {
    players: g.players.length,
    laneUnchanged: zs.every(z => z.y0 === 80 && z.y1 === 880),
    fieldH: CONFIG.FIELD_H, laneH: CONFIG.LANE_H,
    mainY: g.structures.filter(s => s.kind === 'main').map(s => s.y),
  };
}));
await p.evaluate(() => { const c = window.__camera; c.zoom = c.minZoom(); });
await p.waitForTimeout(300);
await p.locator('#canvas-wrap').screenshot({ path: process.env.OUT });
console.log('errors:', errors);
await b.close();
