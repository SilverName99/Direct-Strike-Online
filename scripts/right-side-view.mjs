// Right-hand commander in a 3v3: art, mirroring and fog must all follow the
// SIDE I fight on (and the RACE of each commander), not my player number.
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

// build a 3v3 room with me on the RIGHT, at the front, playing Undead
await p.click('[data-go="format-ai"]');
await p.click('[data-lb="local"]');
await p.waitForSelector('.m-screen[data-screen="lobby"].solo:not(.hidden)');
await p.evaluate(() => {
  const m = window.__menu;
  const S = m.lobby.slots;
  const mk = (sl, race, bot = true) => { sl.kind = bot ? 'bot' : 'player'; sl.bot = bot; sl.race = race; sl.difficulty = 'normal'; };
  mk(S[0][0], 'humans'); mk(S[0][1], 'orcs'); mk(S[0][2], 'humans');
  mk(S[1][0], 'orcs'); mk(S[1][1], 'humans');
  S[1][2].kind = 'player'; S[1][2].bot = false; S[1][2].id = 'me';
  S[1][2].name = m.playerName; S[1][2].race = 'undead'; S[1][2].ready = true;
  m.renderLobby();
});
// fog is off by default in the repo's config — the live balance turns it on
await p.evaluate(async () => { const { CONFIG } = await import('/src/config.js'); CONFIG.FOG_OF_WAR = true; });
await p.click('#lb-start');
await p.waitForFunction(() => window.__game && window.__game.players.length === 6, null, { timeout: 15000 });
await p.waitForTimeout(9500); // countdown + loading

const info = await p.evaluate(() => ({
  me: window.__ui.myTeam,
  side: window.__game.players[window.__ui.myTeam].side,
  races: window.__game.races,
}));
ok(info.me === 5 && info.side === 1, `I am commander ${info.me} on side ${info.side}`);
ok(info.races[5] === 'undead', `my race travelled (${info.races.join(',')})`);

// fog: my own base + my units must be lit, and the reveal must be on MY edge
const fog = await p.evaluate(() => {
  const r = window.__renderer;
  const g = window.__game;
  const me = window.__ui.myTeam;
  const myMain = g.structures.find((s) => s.kind === 'main' && s.owner === me);
  const myZone = g.zones[me];
  const enemyMain = g.structures.find((s) => s.kind === 'main' && s.owner === 0);
  return {
    fogSide: r._fogTeam,
    mainVisible: r.fog.visibleAt(myMain.x, myMain.y),
    armyVisible: r.fog.visibleAt((myZone.army.x0 + myZone.army.x1) / 2, 480),
    buildVisible: r.fog.visibleAt((myZone.build.x0 + myZone.build.x1) / 2, 480),
    frontVisible: r.fog.visibleAt(myZone.build.x0 - 100, 480), // just ahead of my strip
    enemyBaseHidden: !r.fog.visibleAt(enemyMain.x, enemyMain.y),
  };
});
ok(fog.fogSide === 1, `fog runs on my side (${fog.fogSide})`);
ok(fog.mainVisible && fog.buildVisible && fog.armyVisible, `my whole base is lit ${JSON.stringify(fog)}`);
ok(fog.frontVisible, 'the ground just ahead of my strip is lit too');
ok(fog.enemyBaseHidden, 'the far enemy base stays dark');

// a unit of mine on the field must clear fog where it stands: buy one, fast
// forward past the first wave, then look at a live unit far from home
const unitFog = await p.evaluate(async () => {
  const g = window.__game; const me = window.__ui.myTeam;
  g.money[me] = 5000;
  const z = g.zones[me].army;
  // its tech building first, then the unit itself
  const b = g.zones[me].build;
  g.issueCommand({ type: 'build', team: me, kind: 'bldg1', x: b.x0 + 60, y: 200 });
  const site = g.structures.find((s) => s.owner === me && s.kind === 'bldg1');
  if (site) { site.building = false; site.hp = site.hpMax || site.hp; }
  const unitId = 'grunt'; // tier-1 melee, same id across races
  const buy = g.issueCommand({ type: 'buy', team: me, unitId, x: (z.x0 + z.x1) / 2, y: 300 });
  window.__buy = { unitId, buy, tpl: g.templates[me].length };
  for (let i = 0; i < 30 * 60; i++) g.update(1 / 30); // ~60s: the wave marches out
  return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const r = window.__renderer;
    const mine = g.entities.filter((u) => u.owner === me && u.hp > 0);
    if (!mine.length) { res({ none: true, buy: window.__buy }); return; }
    const u = mine.reduce((a, b) => (a.x < b.x ? a : b)); // the one furthest forward
    res({ lit: r.fog.visibleAt(u.x, u.y), x: Math.round(u.x), team: u.team, owner: u.owner, n: mine.length });
  })));
});
ok(unitFog.lit === true, `my units clear fog where they stand (${JSON.stringify(unitFog)})`);

// art: my parked templates draw with MY race, and the thumbnails mirror by side
const art = await p.evaluate(async () => {
  const s = await import('/src/render/sprites.js');
  const me = window.__ui.myTeam;
  return {
    raceOfMe: s.raceOf(me), viewerSide: s.getViewerSide(),
    ally: s.raceOf(4), allySide: s.sideOfPlayer(4),
    enemyAnchor: s.raceOf(0), enemyAnchorSide: s.sideOfPlayer(0),
  };
});
ok(art.raceOfMe === 'undead' && art.viewerSide === 1, `my art is undead on side 1 (${JSON.stringify(art)})`);
ok(art.ally === 'humans' && art.allySide === 1, 'my ally keeps its own race on my side');
ok(art.enemyAnchor === 'humans' && art.enemyAnchorSide === 0, 'the enemy anchor resolves on side 0');

await p.screenshot({ path: '/tmp/right-view.png' });
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nright-side view OK');
process.exit(failed ? 1 : 0);
