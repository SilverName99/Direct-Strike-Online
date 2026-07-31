import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
await p.evaluate(() => { const m = window.__menu; m.sel.player='undead'; m.showLocalLobby(); m.applyLocal({action:'start'}); });
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await p.waitForTimeout(500);
const out = await p.evaluate(async () => {
  const { ghostAlpha } = await import('/src/render/renderer.js');
  const { spawnWave } = await import('/src/sim/waves.js');
  const g = window.__game;
  g.templates[0].push({ type: 'grunt', x: 300, y: 500, spawned: false });
  const tpl = g.templates[0][0];
  const r = { parked: +ghostAlpha(g, tpl).toFixed(2) };
  spawnWave(g);
  r.justLeft = +ghostAlpha(g, tpl).toFixed(2);
  g.time += 2.5; r.halfway = +ghostAlpha(g, tpl).toFixed(2);
  g.time += 2.6; r.after5s = +ghostAlpha(g, tpl).toFixed(2);
  // and a second wave dims it again
  spawnWave(g); r.secondWave = +ghostAlpha(g, tpl).toFixed(2);
  return r;
});
console.log(JSON.stringify(out), 'errors:', errors);
const ok = out.parked === 1 && out.justLeft === 0.2 && out.halfway > 0.4 && out.halfway < 0.8
  && out.after5s === 1 && out.secondWave === 0.2;
console.log(ok ? 'OK — full while parked, 20% when it leaves, back to full in 5s' : 'FAIL');
await b.close();
