// Smoke test for the Molie cocoon: start a solo match, plant a cocoon next to a
// moth and let it hatch its larvae while the renderer draws them.
//   node scripts/cocoon-shot.mjs   (needs `php -S 127.0.0.1:8123 -t .` from the repo root)
import { chromium } from 'playwright-core';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-Direct-Strike-Online/2be809cb-03c7-5618-a605-1cb6d2f9ba86/scratchpad/cocoon.png';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL);
await page.waitForFunction(() => !!window.__menu);
// straight into a solo match as Undead (offline room -> start)
await page.evaluate(() => {
  const m = window.__menu;
  m.sel.player = 'undead';
  m.showLocalLobby();
  m.applyLocal({ action: 'start' });
});
await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });

const res = await page.evaluate(async () => {
  const g = window.__game;
  const { spawnUnit, spawnSummon } = await import('/src/sim/entity.js');
  const { resolvedAbility } = await import('/src/ui/balance.js');
  const ab = resolvedAbility('cocoon');
  Object.assign(ab.params, { larvae: 3, larvaInterval: 1, life: 6 });
  const moth = spawnUnit(g, 0, 'archon', 900, 520);
  const pouch = spawnSummon(g, moth, ab, ab.params, 1);
  return { pouchId: pouch.id, cocoon: pouch.cocoon === true, left: pouch.larvaLeft };
});

await page.waitForTimeout(4000);
const after = await page.evaluate(() => ({
  larvae: window.__game.entities.filter((e) => e.hp > 0 && e.summonKind === 'larva').length,
}));
await page.screenshot({ path: OUT });
console.log(JSON.stringify({ ...res, ...after, errors }, null, 2));
await browser.close();
