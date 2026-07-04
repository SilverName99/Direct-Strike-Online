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
let failures = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
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
      bases: game.bases.map((b) => Math.round(b.hp * 1000)),
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
  const maxTicks = Math.ceil((15 * 60) / DT);
  let ticks = 0;
  while (game.winner === null && ticks < maxTicks) {
    ai0.update(game, DT);
    ai1.update(game, DT);
    game.update(DT);
    game.drainEvents();
    ticks++;
  }
  check(
    'a base falls within 15 sim-minutes',
    game.winner !== null,
    `still running after ${Math.round((ticks * DT) / 60)}min`
  );
  if (game.winner !== null) {
    console.log(`        (winner: team ${game.winner} at wave ${game.waveCount}, ${Math.round(ticks * DT)}s)`);
  }
}

// -------------------------------------------------- structures & commands
console.log('structures & commands');
{
  const game = new Game(5);
  const buy = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 100, y: 450 });
  check('buy inside build zone ok', buy.ok);

  const badBuy = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 700, y: 450 });
  check('buy outside build zone rejected', !badBuy.ok);

  const before = game.money[0];
  const sell = game.issueCommand({ type: 'sellUnit', team: 0, index: 0 });
  const refund = Math.round(UNITS.grunt.cost * CONFIG.SELL_REFUND);
  check(
    'sellUnit removes template and refunds 75%',
    sell.ok && game.templates[0].length === 0 && game.money[0] === before + refund
  );

  game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 100, y: 450 });
  const mv = game.issueCommand({ type: 'moveUnit', team: 0, index: 0, x: 200, y: 300 });
  check('moveUnit repositions inside zone', mv.ok && game.templates[0][0].x === 200);
  const badMv = game.issueCommand({ type: 'moveUnit', team: 0, index: 0, x: 800, y: 450 });
  check('moveUnit rejects positions outside zone', !badMv.ok && game.templates[0][0].x === 200);
}

console.log('turrets');
{
  // A lone enemy grunt walking into turret range dies to it.
  const game = new Game(9);
  const midY = CONFIG.FIELD_H / 2;
  const g = spawnUnit(game, 1, 'grunt', CONFIG.TURRET_X[0] + 120, midY);
  for (let i = 0; i < 300 && g.hp > 0; i++) {
    game.update(DT);
    game.drainEvents();
  }
  check('turret kills a passing enemy grunt', g.hp <= 0);

  // A destroyed turret is gone permanently (no respawn on later waves).
  game.turrets[0].hp = 5;
  spawnUnit(game, 1, 'bruiser', CONFIG.TURRET_X[0] + 60, midY);
  for (let i = 0; i < 150; i++) {
    game.update(DT);
    game.drainEvents();
  }
  check('destroyed turret is removed', game.turrets[0] === null);
  game.waveTimer = DT / 2; // force a wave through
  for (let i = 0; i < 60; i++) {
    game.update(DT);
    game.drainEvents();
  }
  check('turret stays destroyed after waves', game.turrets[0] === null);
}

// ------------------------------------------------------ counter matchups
console.log('counter matchups (equal cost)');

// Spawns one wave of each army and fights to the death (or timeout).
function battle(teamA, teamB, maxSeconds = 120) {
  const game = new Game(123);
  game.turrets = [null, null]; // isolate unit-vs-unit combat from turrets
  // symmetric around midfield, same 480-unit gap as the original matchups
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
  const y0 = CONFIG.FIELD_H / 2 - 90;
  types.forEach((type, i) => {
    game.templates[team].push({
      type,
      x: frontX + dir * Math.floor(i / 5) * 45,
      y: y0 + (i % 5) * 45,
    });
  });
}

function cost(types) {
  // avoids importing UNITS twice — battle assertions use equal-cost armies
  return types.length;
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
