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
  const { spawnWave } = await import('/src/sim/waves.js');
  const g = window.__game;
  const rend = window.__renderer;
  // place a unit by hand in the army zone
  g.templates[0].push({ type: 'grunt', x: 300, y: 500, spawned: false });
  const tpl = g.templates[0][0];
  // the renderer's own helper, reached through a draw: sample it via a probe
  const probe = () => {
    // replicate exactly what drawTemplates asks for
    const full = CONFIG.ARMY_GHOST_ALPHA / 100, gone = CONFIG.ARMY_GHOST_GONE_ALPHA / 100;
    const back = CONFIG.ARMY_GHOST_BACK_TIME;
    if (tpl.spawnedAt == null || back <= 0) return full;
    const t = (g.time - tpl.spawnedAt) / back;
    return t >= 1 ? full : gone + (full - gone) * Math.max(0, t);
  };
  const out = { parked: +probe().toFixed(2) };
  spawnWave(g);                      // the wave takes it
  out.stamped = tpl.spawnedAt != null;
  out.justLeft = +probe().toFixed(2);
  g.time += 2.5; out.halfway = +probe().toFixed(2);
  g.time += 2.6; out.after5s = +probe().toFixed(2);
  return out;
}));
console.log('errors:', errors);
await b.close();
