// Regression check for the placement bug: in a 2v2/3v3 room the human can sit
// on the RIGHT side (player 2 or 3). Selecting a building used to resolve the
// zone through CONFIG.CONSTRUCTION_ZONE[player] — undefined past index 1 — so
// the ghost vanished and nothing could be placed. Here we seat ourselves on
// side 1, start the offline match and actually place a tower.
import { chromium } from 'playwright-core';

const WEB = process.env.WEB || 'http://127.0.0.1:8081/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.goto(WEB, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 20000 });

let failed = 0;
const ok = (c, l) => { console.log((c ? 'ok   ' : 'FAIL ') + l); if (!c) failed++; };

await p.click('[data-go="format-ai"]');
await p.click('[data-lb="local"]');
await p.waitForSelector('.m-screen[data-screen="lobby"].solo:not(.hidden)');
// move myself to side 1 (the ⇄ button on my own slot), then fill both sides
await p.click('[data-lb="move"][data-s="0"][data-d="0"][data-ts="1"]');
await p.waitForTimeout(150);
// enemy bot on side 0 (the column I just left)
await p.locator('.lb-col').nth(0).locator('.lb-slot').nth(0)
  .locator('[data-lb="slot"][data-k="bot"]').click();
await p.waitForTimeout(150);
const roster = await p.evaluate(() => window.__menu.localRoster());
ok(roster.some((r) => !r.bot && r.side === 1), `I am on side 1 (${JSON.stringify(roster)})`);
await p.click('#lb-start');
await p.waitForFunction(() => window.__game && window.__ui, null, { timeout: 15000 });
await p.waitForTimeout(9000); // countdown + loading

const me = await p.evaluate(() => window.__ui.myTeam);
ok(me >= 1, `the human is commander ${me} (not 0)`);

// select a tower and resolve the placement zone the way the UI does
const zone = await p.evaluate(() => {
  window.__ui.selected = 'tower';
  const z = window.__game.zones[window.__ui.myTeam].build;
  // off the vertical center: the main base itself sits mid-strip
  return { mine: z, cx: (z.x0 + z.x1) / 2, cy: z.y0 + 120 };
});
const ghost = await p.evaluate(({ cx, cy }) => {
  window.__ui.mouseX = cx; window.__ui.mouseY = cy;
  return import('/src/ui/grid.js').then((g) => {
    const z = g.zoneFor('tower', cx, cy, window.__ui.myTeam);
    return z ? { x0: z.x0, x1: z.x1, y0: z.y0, y1: z.y1 } : null;
  });
}, zone);
ok(!!ghost, 'the UI resolves a build zone for me');
ok(ghost && ghost.x0 === zone.mine.x0 && ghost.x1 === zone.mine.x1,
  `and it is MY strip (${JSON.stringify(ghost)} vs ${JSON.stringify(zone.mine)})`);

// place it for real through the sim
const built = await p.evaluate(({ cx, cy }) => {
  const g = window.__game; const me = window.__ui.myTeam;
  g.money[me] = 5000;
  const r = g.issueCommand({ type: 'build', team: me, kind: 'tower', x: cx, y: cy });
  return { ok: r.ok, reason: r.reason, towers: g.structures.filter((s) => s.owner === me && s.kind === 'tower').length };
}, zone);
ok(built.ok && built.towers === 1, `tower placed in my own zone (${JSON.stringify(built)})`);

// the army strip must be mine too (drag target)
const army = await p.evaluate(() => import('/src/ui/grid.js').then((g) => {
  const z = g.armyZoneFor(window.__ui.myTeam);
  const mine = window.__game.zones[window.__ui.myTeam].army;
  return z.x0 === mine.x0 && z.x1 === mine.x1;
}));
ok(army, 'the drag/army strip resolves to mine as well');

await p.screenshot({ path: '/tmp/right-side.png' });
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nright-side placement OK');
process.exit(failed ? 1 : 0);
