// Headless sanity tests: node test/sim-test.js
// Running the full sim in plain Node doubles as proof that src/sim/
// never touches the DOM.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../src/sim/game.js';
import { AIController } from '../src/sim/ai.js';
import { spawnUnit } from '../src/sim/entity.js';
import { UNITS } from '../src/units.js';
import { CONFIG } from '../src/config.js';

const DT = CONFIG.FIXED_DT;
const MID_Y = CONFIG.FIELD_H / 2;
let failures = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(game, seconds, extra = null) {
  const ticks = Math.ceil(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    if (extra) extra();
    game.update(DT);
    game.drainEvents();
    if (game.winner !== null) break;
  }
}

// ---------------------------------------------------------------- purity
console.log('sim purity audit');
{
  const simDir = join(dirname(fileURLToPath(import.meta.url)), '../src/sim');
  const banned = ['Math.random', 'document.', 'window.', 'canvas'];
  for (const file of readdirSync(simDir)) {
    const src = readFileSync(join(simDir, file), 'utf8');
    const hit = banned.find((b) => src.includes(b));
    check(`src/sim/${file} is DOM/random-free`, !hit, `found "${hit}"`);
  }
}

// ---------------------------------------------------------- determinism
console.log('determinism');
{
  function runScripted(seed) {
    const game = new Game(seed);
    const ai0 = new AIController(0, 'normal', seed ^ 0x1111);
    const ai1 = new AIController(1, 'hard', seed ^ 0x2222);
    for (let i = 0; i < 3000; i++) {
      ai0.update(game, DT);
      ai1.update(game, DT);
      game.update(DT);
      game.drainEvents();
      if (game.winner !== null) break;
    }
    return stateHash(game);
  }
  function stateHash(game) {
    return JSON.stringify({
      money: game.money,
      wave: game.waveCount,
      tier: game.tier,
      structures: game.structures.map((s) => [s.kind, s.team, Math.round(s.hp * 1000)]),
      ents: game.entities.map((e) => [
        e.type, e.team,
        Math.round(e.x * 1000), Math.round(e.y * 1000),
        Math.round(e.hp * 1000),
      ]),
    });
  }
  const a = runScripted(42);
  const b = runScripted(42);
  const c = runScripted(43);
  check('same seed → identical state after 3000 ticks', a === b);
  check('different seed → different state', a !== c);
}

// ------------------------------------------------------- AI termination
console.log('AI vs AI terminates');
{
  const game = new Game(7);
  const ai0 = new AIController(0, 'normal', 71);
  const ai1 = new AIController(1, 'normal', 72);
  const maxTicks = Math.ceil((20 * 60) / DT);
  let ticks = 0;
  while (game.winner === null && ticks < maxTicks) {
    ai0.update(game, DT);
    ai1.update(game, DT);
    game.update(DT);
    game.drainEvents();
    ticks++;
  }
  check(
    'a main base falls within 20 sim-minutes',
    game.winner !== null,
    `still running after ${Math.round((ticks * DT) / 60)}min`
  );
  if (game.winner !== null) {
    console.log(`        (winner: team ${game.winner} at wave ${game.waveCount}, ${Math.round(ticks * DT)}s)`);
  }
}

// -------------------------------------------------- units: zones & tiers
console.log('unit commands (army zone, tiers)');
{
  const game = new Game(5);
  game.money[0] = 2000;

  const buy = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 500, y: 700 });
  check('buy inside army zone ok', buy.ok);
  const badZone = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 200, y: 700 });
  check('buy in construction zone rejected', !badZone.ok);
  const tooClose = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 502, y: 702 });
  check('buy on top of another template rejected', !tooClose.ok);

  const locked = game.issueCommand({ type: 'buy', team: 0, unitId: 'bruiser', x: 560, y: 700 });
  check('tier-2 unit locked at tier 1', !locked.ok && locked.reason === 'tier-locked');
  const up = game.issueCommand({ type: 'upgradeBase', team: 0 });
  check('base upgrade to tier 2 ok', up.ok && game.tier[0] === 2);
  const nowOk = game.issueCommand({ type: 'buy', team: 0, unitId: 'bruiser', x: 560, y: 700 });
  check('tier-2 unit unlocked after upgrade', nowOk.ok);
  const t3 = game.issueCommand({ type: 'buy', team: 0, unitId: 'archon', x: 620, y: 700 });
  check('tier-3 unit still locked at tier 2', !t3.ok);

  const before = game.money[0];
  const sell = game.issueCommand({ type: 'sellUnit', team: 0, index: 0 });
  const refund = Math.round(UNITS.grunt.cost * CONFIG.SELL_REFUND);
  check('sellUnit refunds 75%', sell.ok && game.money[0] === before + refund);

  const mv = game.issueCommand({ type: 'moveUnit', team: 0, index: 0, x: 600, y: 500 });
  check('moveUnit inside army zone ok', mv.ok && game.templates[0][0].x === 600);
  const badMv = game.issueCommand({ type: 'moveUnit', team: 0, index: 0, x: 300, y: 500 });
  check('moveUnit outside army zone rejected', !badMv.ok);
}

// ----------------------------------------------------------- buildings
console.log('buildings');
{
  const game = new Game(6);
  game.money[0] = 5000;

  const base = game.incomePerTick(0);
  const g1 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: 160, y: 400 });
  const g2 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: 160, y: 500 });
  check('generators build in construction zone', g1.ok && g2.ok);
  check(
    'each generator adds income',
    game.incomePerTick(0) === base + 2 * CONFIG.BUILDINGS.generator.income
  );

  const overlap = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 165, y: 405 });
  check('overlapping build rejected', !overlap.ok);
  const badZone = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 500, y: 700 });
  check('building in army zone rejected', !badZone.ok);

  const wall = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 380, y: 720 });
  check('wall builds ok', wall.ok);

  // flush-adjacent walls (edges touching, one grid cell apart) are allowed
  const wallB = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 380, y: 720 + CONFIG.GRID });
  check('flush-adjacent wall builds ok', wallB.ok);

  const money = game.money[0];
  const wallId = game.structures.find((s) => s.kind === 'wall').id;
  const sold = game.issueCommand({ type: 'sellBuilding', team: 0, id: wallId });
  const refund = Math.round(CONFIG.BUILDINGS.wall.cost * CONFIG.SELL_BUILDING_REFUND);
  check('sellBuilding refunds 60%', sold.ok && game.money[0] === money + refund);

  const mainId = game.mainOf(0).id;
  const noSellMain = game.issueCommand({ type: 'sellBuilding', team: 0, id: mainId });
  check('main base not sellable', !noSellMain.ok);
}

// -------------------------------------------------- walls block, towers shoot
console.log('defense structures');
{
  // A wall in the enemy's path: the grunt must stop and hit it, not pass.
  const game = new Game(9);
  game.money[0] = 1000;
  game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 380, y: MID_Y });
  const wall = game.structures.find((s) => s.kind === 'wall');
  const g = spawnUnit(game, 1, 'grunt', 600, MID_Y);
  run(game, 8);
  check('grunt does not pass the wall', g.x > 350, `grunt.x=${Math.round(g.x)}`);
  check('grunt attacks the wall', wall.hp < wall.maxHp);

  // A tower kills a lone passer-by.
  const game2 = new Game(10);
  game2.money[0] = 1000;
  game2.issueCommand({ type: 'build', team: 0, kind: 'tower', x: 400, y: 400 });
  const passer = spawnUnit(game2, 1, 'grunt', 540, 400);
  run(game2, 12);
  check('tower kills a passing enemy grunt', passer.hp <= 0);

  // The starting turret still works and dies permanently.
  const game3 = new Game(11);
  const turret = game3.structures.find((s) => s.kind === 'turret' && s.team === 0);
  const v = spawnUnit(game3, 1, 'grunt', CONFIG.TURRET_X[0] + 120, MID_Y);
  run(game3, 10);
  check('starting turret kills a passing grunt', v.hp <= 0);
  turret.hp = 5;
  spawnUnit(game3, 1, 'bruiser', CONFIG.TURRET_X[0] + 60, MID_Y);
  run(game3, 6);
  check(
    'destroyed turret is removed permanently',
    !game3.structures.some((s) => s.kind === 'turret' && s.team === 0)
  );
}

// ------------------------------------------------------------- win path
console.log('win condition');
{
  const game = new Game(12);
  stripDefenses(game);
  for (let i = 0; i < 8; i++) {
    spawnUnit(game, 0, 'bruiser', 2900, MID_Y - 80 + i * 24);
  }
  run(game, 120);
  check('destroying the enemy main base wins', game.winner === 0, `winner=${game.winner}`);
}

// ------------------------------------------------------ counter matchups
console.log('counter matchups (equal cost)');

// Keep only the main bases (tucked in the far corners) so unit-vs-unit
// combat is isolated from turrets/towers.
function stripDefenses(game) {
  for (const s of [...game.structures]) {
    if (s.kind !== 'main') game.removeStructure(s, false);
  }
}

function battle(teamA, teamB, maxSeconds = 120) {
  const game = new Game(123);
  stripDefenses(game);
  place(game, 0, teamA, CONFIG.FIELD_W / 2 - 240, -1);
  place(game, 1, teamB, CONFIG.FIELD_W / 2 + 240, 1);
  game.waveTimer = DT / 2; // fire the wave on the first tick
  const maxTicks = Math.ceil(maxSeconds / DT);
  for (let i = 0; i < maxTicks; i++) {
    game.update(DT);
    game.drainEvents();
    if (game.waveCount >= 1) game.templates = [[], []]; // one wave only
    const a = game.entities.filter((e) => e.team === 0).length;
    const b = game.entities.filter((e) => e.team === 1).length;
    if (game.waveCount >= 1 && (a === 0 || b === 0)) return { a, b };
  }
  return {
    a: game.entities.filter((e) => e.team === 0).length,
    b: game.entities.filter((e) => e.team === 1).length,
    timeout: true,
  };
}

function place(game, team, types, frontX, dir) {
  const y0 = MID_Y - 90;
  types.forEach((type, i) => {
    game.templates[team].push({
      type,
      x: frontX + dir * Math.floor(i / 5) * 45,
      y: y0 + (i % 5) * 45,
    });
  });
}

{
  // Lancers (piercing) must beat equal-cost Bruisers (armored)
  const r = battle(
    Array(8).fill('lancer'),               // 8 × 175 = 1400
    Array(7).fill('bruiser')               // 7 × 200 = 1400
  );
  check('8 lancers beat 7 bruisers', r.a > 0 && r.b === 0, JSON.stringify(r));
}
{
  // Splash artillery + escort must beat an equal-cost grunt swarm
  const r = battle(
    ['crab', 'crab', 'slinger', 'slinger', 'grunt'], // 800
    Array(16).fill('grunt')                          // 800
  );
  check('2 crabs + escort beat 16 grunts', r.a > 0 && r.b === 0, JSON.stringify(r));
}
{
  // Air is untouchable by melee
  const r = battle(
    ['wasp', 'wasp'],        // 300
    Array(6).fill('grunt')   // 300
  );
  check('2 wasps beat 6 grunts (melee cannot hit air)', r.a > 0 && r.b === 0, JSON.stringify(r));
}
{
  // ...but anti-air shreds wasps
  const r = battle(
    Array(2).fill('archon'), // 500
    ['wasp', 'wasp', 'wasp', 'grunt']  // 500
  );
  check('2 archons beat 3 wasps + grunt', r.a > 0 && r.b === 0, JSON.stringify(r));
}

// ----------------------------------------------------------------- done
console.log('');
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('all tests passed');
