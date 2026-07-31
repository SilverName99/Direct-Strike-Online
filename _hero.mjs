import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
await p.evaluate(() => { const m = window.__menu; m.sel.player='undead'; m.showLocalLobby(); m.applyLocal({action:'start'}); });
await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
const out = await p.evaluate(async () => {
  const { spawnUnit } = await import('/src/sim/entity.js');
  const { applyDamage } = await import('/src/sim/combat.js');
  const { statsUnit, resolvedHeroIds } = await import('/src/ui/balance.js');
  const g = window.__game, v = window.__renderer.view;
  const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
  const id = resolvedHeroIds('undead')[2];
  const st = statsUnit('undead', id);
  st.heroAbilities = ['soulcollector', 'undeadflag', 'bonefield'];
  st.heroUltimate = 'bonegiant'; st.mana = 180; st.manaRegen = 0;
  const h = spawnUnit(g, 0, id, cx, cy);
  h.hero = true; h.heroLevel = 6; h.mana = 0; h.manaMax = 180; h.heroRanks = { soulcollector: 2 }; h.disabledAbilities = new Set();
  // a few kills around him -> souls fly in
  for (let i = 0; i < 6; i++) {
    const foe = spawnUnit(g, 1, 'grunt', cx + 90 + i * 30, cy + (i % 2 ? 60 : -60));
    applyDamage(g, foe, 99999, 'normal');
  }
  // and a bone field on the ground
  g.boneFields.push({ x: cx - 160, y: cy + 40, radius: 190, atkSlow: 30, moveSlow: 35, until: g.time + 8, team: 0, id: 7 });
  return { mana: h.mana, souls: 'queued' };
});
await p.waitForTimeout(120);
await p.locator('#canvas-wrap').screenshot({ path: process.env.A });
await p.waitForTimeout(400);
await p.locator('#canvas-wrap').screenshot({ path: process.env.B });
console.log(JSON.stringify(out), 'errors:', errors);
await b.close();
