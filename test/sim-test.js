// Headless sanity tests: node test/sim-test.js
// Running the full sim in plain Node doubles as proof that src/sim/
// never touches the DOM.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../src/sim/game.js';
import { AIController } from '../src/sim/ai.js';
import { spawnUnit, makeStructure } from '../src/sim/entity.js';
import { UNITS, DAMAGE_MATRIX } from '../src/units.js';
import { CONFIG } from '../src/config.js';

const DT = CONFIG.FIXED_DT;
const MID_Y = CONFIG.MAIN.y; // lane center (field extends lower as a scenic apron)
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

  // never-spawned template sells for a full refund
  const beforeFull = game.money[0];
  const sellFull = game.issueCommand({ type: 'sellUnit', team: 0, index: 0 });
  check('sellUnit refunds 100% before first spawn',
    sellFull.ok && game.money[0] === beforeFull + UNITS.grunt.cost);

  // once it has spawned, selling only gives the partial refund
  game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 500, y: 700 });
  game.templates[0][game.templates[0].length - 1].spawned = true;
  const idxSpawned = game.templates[0].length - 1;
  const before = game.money[0];
  const sell = game.issueCommand({ type: 'sellUnit', team: 0, index: idxSpawned });
  const refund = Math.round(UNITS.grunt.cost * CONFIG.SELL_REFUND);
  check('sellUnit refunds 75% after spawn', sell.ok && game.money[0] === before + refund);

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
  const g1 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: 100, y: 400 });
  const g2 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: 100, y: 500 });
  check('generators build in construction zone', g1.ok && g2.ok);
  // income amounts are per 20s; each tick pays the proportional slice
  const tickShare = CONFIG.INCOME_TICK / CONFIG.INCOME_WINDOW;
  check(
    'each generator adds income',
    game.incomePerTick(0) === base + Math.round(2 * CONFIG.BUILDINGS.generator.income * tickShare)
  );

  const overlap = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 105, y: 405 });
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

// Special behaviors are blank by default now, so restore the classic roster's
// ranged/air/splash/anti-air traits before testing its counter dynamics.
{
  const { applyBalance } = await import('../src/ui/balance.js');
  const roster = {
    slinger: { ranged: true, targetsAir: true },
    lancer: { ranged: true },
    crab: { ranged: true, splash: 60, projSpeed: 300 },
    wasp: { ranged: true, isAir: true, targetsAir: true },
    archon: { ranged: true, targetsAir: true },
  };
  applyBalance({ races: { humans: { units: roster }, orcs: { units: roster } } });
}

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

// ------------------------------------------------------------- abilities
console.log('abilities (casters, auras, status effects)');
{
  const { applyBalance, resetAll } = await import('../src/ui/balance.js');

  // helper: place two units near each other, far from turrets
  function duel(config, casterType, casterTeam) {
    applyBalance(config);
    const game = new Game(42, { races: ['humans', 'orcs'] });
    const a = spawnUnit(game, 0, casterType === 'a' ? 'mender' : 'grunt', 600, 300);
    const b = spawnUnit(game, 1, 'grunt', 640, 300);
    return { game, a, b };
  }

  // slow aura: cast raises a zone; enemies inside get an attack-slow effect
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['slowaura'], mana: 100, manaRegen: 0 } } } } });
    const game = new Game(42, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'slinger', 600, 300);
    const enemy = spawnUnit(game, 1, 'grunt', 660, 300);
    enemy.hp = enemy.maxHp = 100000;
    run(game, 2);
    const slowed = enemy.effects && enemy.effects.some((e) => e.kind === 'atkslow' && e.until > game.time);
    check('slow aura slows enemies in the zone', !!slowed, JSON.stringify(enemy.effects));
  }

  // frost bolt: caster slows an enemy's movement
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['frostbolt'] } } } } });
    const game = new Game(7, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'slinger', 600, 300);
    const runner = spawnUnit(game, 1, 'grunt', 700, 300);
    runner.hp = runner.maxHp = 100000;
    run(game, 3);
    const slowed = runner.effects && runner.effects.some((e) => e.kind === 'moveslow' && e.until > game.time);
    check('frost bolt applies a movement slow', !!slowed, JSON.stringify(runner.effects));
  }

  // dispell: an allied caster cleanses the frost slow
  {
    applyBalance({
      races: {
        humans: { units: { slinger: { caster: true, abilities: ['frostbolt'] } } },
        orcs: { units: { mender: { caster: true, abilities: ['dispell'] } } },
      },
    });
    const game = new Game(7, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'slinger', 600, 300);
    const cleric = spawnUnit(game, 1, 'mender', 720, 300);
    cleric.hp = cleric.maxHp = 100000;
    const runner = spawnUnit(game, 1, 'grunt', 700, 300);
    runner.hp = runner.maxHp = 100000;
    run(game, 2); // frost lands ~0.7s in; dispell follows — immunity still live
    const immune = runner.effects && runner.effects.some((e) => e.kind === 'immune' && e.until > game.time);
    check('dispell cleanses allies (immunity applied)', !!immune, JSON.stringify(runner.effects));
  }

  // heal: an active caster restores a wounded ally's HP
  {
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['heal'], mana: 100, manaRegen: 5 } } } } });
    const game = new Game(11, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'mender', 600, 300);
    const wounded = spawnUnit(game, 0, 'grunt', 630, 300);
    wounded.maxHp = 500; wounded.hp = 100; // hurt ally in range
    const foe = spawnUnit(game, 1, 'grunt', 680, 300); // enemy in range so the caster engages
    foe.hp = foe.maxHp = 100000;
    run(game, 2);
    check('heal restores a wounded ally', wounded.hp > 100, `hp=${wounded.hp}`);
  }

  // sequencing: the effect fires on the RELEASE frame, not at prepare start —
  // so a caster mid-wind-up hasn't healed yet
  {
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['heal'], mana: 100, manaRegen: 5 } } } } });
    const game = new Game(11, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'mender', 600, 300);
    const wounded = spawnUnit(game, 0, 'grunt', 630, 300);
    wounded.maxHp = 500; wounded.hp = 100;
    const foe = spawnUnit(game, 1, 'grunt', 680, 300); // enemy in range so the caster engages
    foe.hp = foe.maxHp = 100000;
    // one tick: the caster has entered 'prepare' but has NOT released yet
    game.update(DT); game.drainEvents();
    check('effect deferred to release frame (no heal during prepare)',
      caster.castState === 'prepare' && wounded.hp === 100, `state=${caster.castState} hp=${wounded.hp}`);
  }

  // sequencing: abilities cast one at a time, in list order — never two in the
  // same tick. Heal (ally hurt) fires before Frost Bolt is prepared.
  {
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['heal', 'frostbolt'], mana: 100, manaRegen: 20 } } } } });
    const game = new Game(13, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'mender', 600, 300);
    const ally = spawnUnit(game, 0, 'grunt', 630, 300);
    ally.maxHp = 500; ally.hp = 100;
    const enemy = spawnUnit(game, 1, 'grunt', 720, 300);
    enemy.hp = enemy.maxHp = 100000;
    let everTwoAtOnce = false;
    const casts = [];
    for (let i = 0; i < 90; i++) {
      game.update(DT);
      const ev = game.drainEvents().filter((e) => e.type === 'cast' && e.unitId === caster.id);
      if (ev.length > 1) everTwoAtOnce = true;
      for (const e of ev) casts.push(e.ability);
    }
    check('one spell at a time (never two casts in a tick)', !everTwoAtOnce);
    check('casts follow list order (heal before frost bolt)',
      casts.length >= 2 && casts[0] === 'heal' && casts.includes('frostbolt'), casts.join(','));
  }

  // cast aura: Haste/Regen auras are now cast (prepare -> release), the zone
  // persists for its duration, costs mana once, and is NOT recast while up —
  // a pure-aura caster attacks normally between casts
  {
    applyBalance({ races: { humans: { units: { grunt: { caster: true, abilities: ['hasteaura'], mana: 100, manaRegen: 0 } } } } });
    const game = new Game(6, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'grunt', 600, 300);
    const ally = spawnUnit(game, 0, 'grunt', 620, 300);
    game.ustat(0, 'grunt').range = 160; // engage the enemy at distance
    const enemy = spawnUnit(game, 1, 'grunt', 700, 300);
    enemy.hp = enemy.maxHp = 100000;
    run(game, 3);
    const hasted = ally.effects && ally.effects.some((e) => e.kind === 'haste' && e.until > game.time);
    check('cast aura buffs allies in the zone', !!hasted);
    check('cast aura costs mana once (no per-tick drain, no recast)', caster.mana === 70, `mana=${caster.mana}`);
    check('cast aura caster auto-attacks while the zone is up', enemy.hp < enemy.maxHp);
  }

  // Ranged flag: a melee-base unit fires a projectile on its basic attack
  {
    applyBalance({ races: { humans: { units: { grunt: { ranged: true } } } } });
    const game = new Game(5, { races: ['humans', 'orcs'] });
    const g = spawnUnit(game, 0, 'grunt', 600, 300);
    g.type; // grunt is melee by default
    const enemy = spawnUnit(game, 1, 'grunt', 700, 300);
    enemy.hp = enemy.maxHp = 100000;
    // widen grunt range so it engages at distance and shoots
    game.ustat(0, 'grunt').range = 160;
    run(game, 2);
    const shot = game.projectiles.some((p) => p.srcType === 'grunt') ||
      game.entities.some((e) => e.team === 1 && e.hp < e.maxHp); // dmg landed via projectile
    check('ranged flag fires a projectile', shot);
  }

  // Bounce: a ranged unit's projectile ricochets to a nearby enemy for
  // bouncePower% of the hit's damage (the focused target still takes full)
  {
    applyBalance({ races: { humans: { units: { slinger: { ranged: true, bounce: true, bouncePower: 50, bounceRadius: 100, bounceMax: 5 } } } } });
    const game = new Game(4, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'slinger', 600, 300);
    const focus = spawnUnit(game, 1, 'grunt', 700, 300); // nearest -> focused
    const near = spawnUnit(game, 1, 'grunt', 720, 300);  // within bounce radius of focus
    focus.hp = focus.maxHp = 100000;
    near.hp = near.maxHp = 100000;
    run(game, 2);
    const focusDmg = focus.maxHp - focus.hp;
    const nearDmg = near.maxHp - near.hp;
    check('bounce ricochets to a nearby enemy', nearDmg > 0, `near=${nearDmg}`);
    check('bounce hits the focused target harder than the ricochet', focusDmg > nearDmg, `focus=${focusDmg} near=${nearDmg}`);
  }

  // Bounce chain: with 3 enemies in a line and bounceMax 2, the projectile
  // hops focus -> next -> next (all three take damage)
  {
    applyBalance({ races: { humans: { units: { slinger: { ranged: true, bounce: true, bouncePower: 60, bounceRadius: 60, bounceMax: 2 } } } } });
    const game = new Game(4, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'slinger', 560, 300);
    const a = spawnUnit(game, 1, 'grunt', 700, 300);
    const c2 = spawnUnit(game, 1, 'grunt', 740, 300);
    const c3 = spawnUnit(game, 1, 'grunt', 780, 300);
    for (const g of [a, c2, c3]) { g.hp = g.maxHp = 100000; }
    run(game, 2);
    check('bounce chains through a line of enemies',
      a.hp < a.maxHp && c2.hp < c2.maxHp && c3.hp < c3.maxHp,
      `a=${a.maxHp - a.hp} c2=${c2.maxHp - c2.hp} c3=${c3.maxHp - c3.hp}`);
  }

  // Bounce cap: bounceMax limits how many ricochets happen (nearest first);
  // with max 1 only the closer of two in range takes ricochet damage
  {
    applyBalance({ races: { humans: { units: { slinger: { ranged: true, bounce: true, bouncePower: 50, bounceRadius: 200, bounceMax: 1 } } } } });
    const game = new Game(4, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'slinger', 560, 300);
    const focus = spawnUnit(game, 1, 'grunt', 700, 300); // nearest to shooter -> focused
    const close = spawnUnit(game, 1, 'grunt', 718, 300); // nearest to focus -> gets the single ricochet
    const far = spawnUnit(game, 1, 'grunt', 700, 460);   // also within bounce radius of focus, but farther
    for (const g of [focus, close, far]) { g.hp = g.maxHp = 100000; }
    run(game, 1.2);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    check('bounceMax caps the number of ricochets', closeDmg > 0 && farDmg === 0, `close=${closeDmg} far=${farDmg}`);
  }

  // Footprint: a unit's cw/ch (grid cells) drives its physical radius; 1x1
  // keeps the unit's base radius
  {
    applyBalance({ races: { humans: { units: { grunt: { cw: 2, ch: 2 } } } } });
    const big = spawnUnit(new Game(3, { races: ['humans', 'orcs'] }), 0, 'grunt', 600, 300);
    check('footprint > 1x1 grows the unit radius', big.radius === CONFIG.GRID, `r=${big.radius}`); // 2*40/2
    applyBalance({}); // back to defaults (1x1)
    const base = spawnUnit(new Game(3, { races: ['humans', 'orcs'] }), 0, 'grunt', 600, 300);
    check('1x1 footprint keeps the base radius', base.radius === UNITS.grunt.radius, `r=${base.radius}`);
  }

  // Air toggle: flagging a ground unit as flying makes it untouchable by plain
  // ground melee; giving another unit anti-air lets it hit flyers
  {
    applyBalance({ races: { humans: { units: { grunt: { isAir: true } } } } });
    const game = new Game(5, { races: ['humans', 'orcs'] });
    const flyer = spawnUnit(game, 0, 'grunt', 640, 300); // now airborne
    const ground = spawnUnit(game, 1, 'grunt', 660, 300); // plain melee, no anti-air
    flyer.hp = flyer.maxHp = 100000; ground.hp = ground.maxHp = 100000;
    const hp0 = flyer.hp;
    run(game, 3);
    check('flagged flyer is untouchable by ground melee', flyer.hp === hp0, `hp=${flyer.hp}`);
  }
  {
    applyBalance({ races: {
      humans: { units: { grunt: { isAir: true } } },
      orcs: { units: { grunt: { targetsAir: true } } },
    } });
    const game = new Game(5, { races: ['humans', 'orcs'] });
    const flyer = spawnUnit(game, 0, 'grunt', 640, 300);
    const aa = spawnUnit(game, 1, 'grunt', 660, 300); // ground but anti-air
    flyer.hp = flyer.maxHp = 100000; aa.hp = aa.maxHp = 100000;
    run(game, 3);
    check('anti-air unit can damage a flyer', flyer.hp < flyer.maxHp, `hp=${flyer.hp}`);
    applyBalance({});
  }

  // "Dashing & Fleeing mount" upgrade: bought from the base, a rider charges a
  // ranged non-flying enemy that enters its radius, then dismounts
  {
    const upCfg = {
      races: { orcs: { units: { slinger: { ranged: true } } } },
      upgrades: { dashmount: { unit: 'grunt', params: { cost: 100, radius: 300, dashSpeed: 800, dmDamage: 60, dmRange: 30, dmPeriod: 0.5, dmSpeed: 90 } } },
    };
    applyBalance(upCfg);
    const game = new Game(6, { races: ['humans', 'orcs'] });
    const buy = game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'dashmount' });
    const rider = spawnUnit(game, 0, 'grunt', 400, 300);
    const foe = spawnUnit(game, 1, 'slinger', 650, 300); // enemy ranged in radius
    foe.hp = foe.maxHp = 100000;
    check('upgrade bought from base', buy.ok);
    run(game, 3);
    check('rider dismounts after charging the ranged enemy', rider.dismounted === true);
    // control: without buying it, the rider never dismounts
    applyBalance(upCfg);
    const g2 = new Game(6, { races: ['humans', 'orcs'] });
    const rider2 = spawnUnit(g2, 0, 'grunt', 400, 300);
    const foe2 = spawnUnit(g2, 1, 'slinger', 650, 300); foe2.hp = foe2.maxHp = 100000;
    run(g2, 3);
    check('no upgrade bought -> rider stays mounted', rider2.dismounted === false);
    applyBalance({});
  }

  // "Attack ground units" upgrade: a unit with "Can hit ground" OFF (air-only)
  // cannot damage ground troops until the upgrade is bought for its type.
  {
    // both grunts air-only, so neither can hit ground by default
    const cfg = { races: {
      humans: { units: { grunt: { targetsGround: false } } },
      orcs: { units: { grunt: { targetsGround: false } } },
    } };
    // control: no upgrade -> the human grunt can't touch a ground enemy
    applyBalance(cfg);
    const g0 = new Game(9, { races: ['humans', 'orcs'] });
    spawnUnit(g0, 0, 'grunt', 600, 300);
    const tgt0 = spawnUnit(g0, 1, 'grunt', 650, 300); tgt0.hp = tgt0.maxHp = 100000;
    run(g0, 4);
    check('air-only unit cannot damage ground without the upgrade', tgt0.hp === tgt0.maxHp);

    // with the upgrade bought for that unit type, it now hits ground
    applyBalance({ ...cfg, upgrades: { groundattack: { race: 'humans', unit: 'grunt', params: { cost: 100 } } } });
    const g1 = new Game(9, { races: ['humans', 'orcs'] });
    const buy = g1.issueCommand({ type: 'buyUpgrade', team: 0, id: 'groundattack' });
    spawnUnit(g1, 0, 'grunt', 600, 300);
    const tgt1 = spawnUnit(g1, 1, 'grunt', 650, 300); tgt1.hp = tgt1.maxHp = 100000;
    run(g1, 4);
    check('Attack ground upgrade lets the unit damage ground', buy.ok && tgt1.hp < tgt1.maxHp);
    applyBalance({});
  }

  // A RANGED mounted rider must charge all the way IN and fight on foot at its
  // dismounted range — no dismount-at-mounted-range, no ranged shots on foot
  {
    applyBalance({
      races: {
        humans: { units: { slinger: { ranged: true } } },
        orcs: { units: { crab: { ranged: true, range: 200, period: 1.0, damage: 30 } } },
      },
      upgrades: { dashmount: { race: 'orcs', unit: 'crab', params: { cost: 100, radius: 260, dashSpeed: 720, dmDamage: 22, dmRange: 30, dmPeriod: 0.8, dmSpeed: 95, dmSize: 100 } } },
    });
    const game = new Game(11, { races: ['humans', 'orcs'] });
    game.issueCommand({ type: 'buyUpgrade', team: 1, id: 'dashmount' });
    const rider = spawnUnit(game, 1, 'crab', 950, 300);
    const archer = spawnUnit(game, 0, 'slinger', 700, 300); // in trigger radius, at mounted range
    archer.hp = archer.maxHp = 100000; rider.hp = rider.maxHp = 100000;
    let shotsOnFoot = 0;
    let dismountDist = null;
    for (let i = 0; i < 30 * 8; i++) {
      game.update(DT);
      for (const e of game.drainEvents()) {
        if (e.type === 'dismount' && dismountDist === null) {
          dismountDist = Math.hypot(rider.x - archer.x, rider.y - archer.y);
        }
        if (e.type === 'shot' && e.team === 1 && rider.dismounted) shotsOnFoot++;
      }
    }
    check('rider dismounts NEXT TO the enemy (on-foot range, not mounted)',
      dismountDist !== null && dismountDist < 80, `dist=${Math.round(dismountDist ?? -1)}`);
    check('dismounted orc never fires ranged shots', shotsOnFoot === 0, `shots=${shotsOnFoot}`);
    check('dismounted orc lands melee damage', archer.hp < archer.maxHp);
    applyBalance({});
  }

  // On dismount the mount is gone: the body shrinks from the mounted (footprint)
  // radius to the base one, so a tiny dmRange really fights at touch distance
  {
    applyBalance({
      races: {
        humans: { units: { slinger: { ranged: true } } },
        orcs: { units: { crab: { ranged: true, range: 200, cw: 2, ch: 2 } } }, // big mounted body (r=40)
      },
      upgrades: { dashmount: { race: 'orcs', unit: 'crab', params: { cost: 100, radius: 300, dashSpeed: 720, dmDamage: 22, dmRange: 5, dmPeriod: 0.8, dmSpeed: 95, dmSize: 100 } } },
    });
    const game = new Game(11, { races: ['humans', 'orcs'] });
    game.issueCommand({ type: 'buyUpgrade', team: 1, id: 'dashmount' });
    const rider = spawnUnit(game, 1, 'crab', 990, 300);
    const archer = spawnUnit(game, 0, 'slinger', 700, 300);
    archer.hp = archer.maxHp = 100000; rider.hp = rider.maxHp = 100000;
    const mountedR = rider.radius;
    let firstHitDist = null;
    let last = 0;
    for (let i = 0; i < 30 * 8; i++) {
      game.update(DT); game.drainEvents();
      const dmg = archer.maxHp - archer.hp;
      if (rider.dismounted && dmg > last && firstHitDist === null) {
        firstHitDist = Math.hypot(rider.x - archer.x, rider.y - archer.y);
      }
      last = dmg;
    }
    check('on-foot body shrinks from the mounted footprint radius',
      mountedR === 40 && rider.radius < 20, `mounted=${mountedR} foot=${rider.radius}`);
    check('tiny dmRange fights at touch distance',
      firstHitDist !== null && firstHitDist < 35, `dist=${Math.round(firstHitDist ?? -1)}`);
    applyBalance({});
  }

  // Upgrade targets a specific race's unit: an orcs-only upgrade is unbuyable by
  // humans and leaves the humans same-type unit unaffected
  {
    applyBalance({
      races: { humans: { units: { slinger: { ranged: true } } } },
      upgrades: { dashmount: { race: 'orcs', unit: 'grunt', params: { cost: 100, radius: 300, dashSpeed: 800, dmDamage: 50, dmRange: 30, dmPeriod: 0.5, dmSpeed: 90 } } },
    });
    const game = new Game(7, { races: ['humans', 'orcs'] });
    const wrong = game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'dashmount' }); // humans
    const right = game.issueCommand({ type: 'buyUpgrade', team: 1, id: 'dashmount' }); // orcs
    check('cannot buy an upgrade for another race', !wrong.ok && wrong.reason === 'wrong-race');
    check('orcs can buy its own upgrade', right.ok);
    const orcRider = spawnUnit(game, 1, 'grunt', 900, 300);   // orcs rider
    const humanSame = spawnUnit(game, 0, 'grunt', 640, 300);  // humans, SAME type
    const foe = spawnUnit(game, 0, 'slinger', 660, 300);      // humans ranged enemy near the orc rider
    for (const e of [orcRider, humanSame, foe]) { e.hp = e.maxHp = 100000; }
    run(game, 3);
    check('orcs rider dismounts', orcRider.dismounted === true);
    check('humans same-type unit is not transformed', humanSame.dismounted === false);
    applyBalance({});
  }

  // Config-proofing: a 0 range (admin "melee") or 0 attack period must not
  // produce a unit that chases forever / swings forever without ever hitting
  {
    applyBalance({ races: { humans: { units: { grunt: { range: 0 } } } } });
    const game = new Game(3, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'grunt', 620, 300);
    const foe = spawnUnit(game, 1, 'grunt', 660, 300);
    foe.hp = foe.maxHp = 100000;
    run(game, 3);
    check('range 0 still lands hits (touch range)', foe.hp < foe.maxHp, `dmg=${foe.maxHp - foe.hp}`);
  }
  {
    applyBalance({ races: { humans: { units: { grunt: { period: 0 } } } } });
    const game = new Game(3, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'grunt', 620, 300);
    const foe = spawnUnit(game, 1, 'grunt', 660, 300);
    foe.hp = foe.maxHp = 100000;
    run(game, 3);
    check('period 0 still lands hits (floored swing)', foe.hp < foe.maxHp, `dmg=${foe.maxHp - foe.hp}`);
    applyBalance({});
  }

  // Dash (charge): a dash unit closes a far target fast (dashing flag) and
  // lands a bonus dashDamage burst on arrival
  {
    applyBalance({ races: { humans: { units: { grunt: { dash: true, dashDamage: 200, dashSpeed: 800, dashRange: 300 } } } } });
    const game = new Game(5, { races: ['humans', 'orcs'] });
    const charger = spawnUnit(game, 0, 'grunt', 400, 300);
    const foe = spawnUnit(game, 1, 'grunt', 650, 300); // ~240 away: inside dashRange, outside attack range
    foe.hp = foe.maxHp = 100000;
    game.update(DT); game.drainEvents();
    check('dash unit charges (dashing flag set)', charger.dashing === true);
    run(game, 2);
    check('dash lands its bonus damage on arrival', foe.maxHp - foe.hp >= 200, `dmg=${foe.maxHp - foe.hp}`);
    applyBalance({});
  }

  // Footprint placement: a 2x2 unit occupies its box — overlapping placements
  // are rejected, clear ones accepted
  {
    applyBalance({ races: { humans: { units: { grunt: { cw: 2, ch: 2 } } } } });
    const game = new Game(3, { races: ['humans', 'orcs'] });
    const x0 = CONFIG.ARMY_ZONE[0].x0 + 40, y0 = 400; // 2x2 box fits the army zone
    const r1 = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: x0, y: y0 });
    check('2x2 unit placed', r1.ok, JSON.stringify(r1));
    const r2 = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: x0 + 50, y: y0 });
    check('2x2 unit rejects an overlapping placement', !r2.ok && r2.reason === 'zone');
    const r3 = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: x0, y: y0 + 90 });
    check('2x2 unit placed clear of the first', r3.ok, JSON.stringify(r3));
    applyBalance({});
  }

  // cast priority: while mid-cast a caster does not also auto-attack
  {
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['heal'], mana: 100, manaRegen: 50 } } } } });
    const game = new Game(8, { races: ['humans', 'orcs'] });
    const mender = spawnUnit(game, 0, 'mender', 600, 300);
    const ally = spawnUnit(game, 0, 'grunt', 620, 300);
    ally.maxHp = 1000; ally.hp = 200;
    const foe = spawnUnit(game, 1, 'grunt', 680, 300); // enemy in range so the caster engages
    foe.hp = foe.maxHp = 100000;
    // step a few ticks; while casting the mender is in a prepare/release phase
    // and holds (no auto-attack slipped in)
    let sawBusy = false;
    for (let i = 0; i < 30; i++) { game.update(DT); game.drainEvents(); if (mender.castState && mender.spellHold) sawBusy = true; }
    check('caster locks its attack while casting', sawBusy);
  }

  // spell priority: a caster prioritizes its spells over the basic attack
  {
    const { casterPrioritizesSpells } = await import('../src/sim/abilities.js');
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['frostbolt'], mana: 100, manaRegen: 0 } } } } });
    const game = new Game(4, { races: ['humans', 'orcs'] });
    const st = game.ustat(0, 'slinger');
    check('caster with mana prioritizes spells', casterPrioritizesSpells(game, { team: 0, type: 'slinger', mana: 100 }, st));
    check('caster out of mana attacks normally', !casterPrioritizesSpells(game, { team: 0, type: 'slinger', mana: 0 }, st));
    // in-game: it holds at range (no auto-attack spam) rather than swinging
    const caster = spawnUnit(game, 0, 'slinger', 640, 300);
    const enemy = spawnUnit(game, 1, 'grunt', 700, 300);
    enemy.hp = enemy.maxHp = 100000;
    let held = false;
    for (let i = 0; i < 120; i++) { game.update(DT); game.drainEvents(); if (caster.spellHold) held = true; }
    check('caster holds at range to cast (no attack spam)', held);
  }

  // mana gates casting: a caster with an empty pool never fires
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['frostbolt'], mana: 0, manaRegen: 0 } } } } });
    const game = new Game(7, { races: ['humans', 'orcs'] });
    spawnUnit(game, 0, 'slinger', 600, 300);
    const runner = spawnUnit(game, 1, 'grunt', 700, 300);
    runner.hp = runner.maxHp = 100000;
    run(game, 3);
    const slowed = runner.effects && runner.effects.some((e) => e.kind === 'moveslow');
    check('no mana -> no cast', !slowed, JSON.stringify(runner.effects));
  }

  // engagement rule: a caster does not cast while no enemy is in attack range
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['hasteaura'], mana: 100, manaRegen: 0 } } } } });
    const game = new Game(9, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'slinger', 600, 300);
    const ally = spawnUnit(game, 0, 'grunt', 620, 300); // buff target present, but no enemy near
    run(game, 2);
    const buffed = ally.effects && ally.effects.some((e) => e.kind === 'haste');
    check('no cast while not engaged (no enemy in attack range)', caster.mana === 100 && !buffed, `mana=${caster.mana}`);
  }

  // support spells (Regen Aura, Heal) are the exception: they fire for wounded
  // allies even unengaged
  {
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['regenaura'], mana: 100, manaRegen: 0 } } } } });
    const game = new Game(9, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'mender', 600, 300);
    const wounded = spawnUnit(game, 0, 'grunt', 620, 300); // wounded ally, no enemy in range
    wounded.maxHp = 500; wounded.hp = 100;
    run(game, 2);
    check('regen aura casts for wounded allies even when not engaged', caster.mana === 70, `mana=${caster.mana}`);
  }
  {
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['heal'], mana: 100, manaRegen: 0 } } } } });
    const game = new Game(9, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'mender', 600, 300);
    const wounded = spawnUnit(game, 0, 'grunt', 620, 300); // wounded ally, no enemy in range
    wounded.maxHp = 500; wounded.hp = 100;
    run(game, 2);
    check('heal casts for a wounded ally even when not engaged', wounded.hp > 100 && caster.mana < 100, `hp=${wounded.hp} mana=${caster.mana}`);
  }

  // determinism holds with casters in play
  {
    function scripted(seed) {
      applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['slowaura', 'regenaura'] } } } } });
      const game = new Game(seed, { races: ['humans', 'orcs'] });
      spawnUnit(game, 0, 'mender', 600, 300);
      spawnUnit(game, 0, 'grunt', 620, 300);
      spawnUnit(game, 1, 'grunt', 660, 300);
      run(game, 5);
      return JSON.stringify(game.entities.map((e) => [e.type, Math.round(e.x), Math.round(e.y), Math.round(e.hp)]));
    }
    check('caster sim is deterministic', scripted(99) === scripted(99));
  }

  // shop unit order: admin order applied + sanitized (unknown dropped, missing
  // appended so the roster stays complete)
  {
    const { resolvedUnitOrder } = await import('../src/ui/balance.js');
    applyBalance({ unitOrder: ['archon', 'grunt'] });
    const ord = resolvedUnitOrder();
    check('unit order: admin order comes first', ord[0] === 'archon' && ord[1] === 'grunt');
    check('unit order: missing ids appended (roster stays complete)',
      ord.length === Object.keys(UNITS).length && ord.includes('slinger'));
    applyBalance({ unitOrder: ['nope', 'grunt', 'grunt'] });
    const ord2 = resolvedUnitOrder();
    check('unit order: unknown/duplicate ids dropped',
      ord2[0] === 'grunt' && ord2.length === Object.keys(UNITS).length);
  }

  // Turret HP regen (per-race stat)
  {
    applyBalance({ races: { humans: { buildings: { turret: { regen: 50 } } } } });
    const game = new Game(3, { races: ['humans', 'orcs'] });
    const t = game.structures.find((s) => s.kind === 'turret' && s.team === 0);
    t.hp = t.maxHp - 300;
    run(game, 2);
    check('turret regenerates HP at the configured rate', t.hp > t.maxHp - 250, `hp=${Math.round(t.hp)}`);
    const t1 = game.structures.find((s) => s.kind === 'turret' && s.team === 1);
    t1.hp = t1.maxHp - 300;
    run(game, 2);
    check('other race turret (regen 0) does not regenerate', t1.hp === t1.maxHp - 300);
  }

  // Mid-field income: the middle is a CONTROL POINT — crossing captures it, and
  // you lose it ONLY when the enemy holds the middle alone (his unit past mid,
  // none of yours on his side). Just losing your own push does NOT drop it.
  {
    applyBalance({ general: { MID_INCOME: 100 } });
    const game = new Game(3, { races: ['humans', 'orcs'] });
    check('nobody crossed yet -> no mid bonus', game.midBonusPerTick(0) === 0 && game.midBonusPerTick(1) === 0);
    const scout = spawnUnit(game, 0, 'grunt', CONFIG.FIELD_W / 2 + 50, 300); // crosses
    game.update(DT); game.drainEvents();
    check('crossing captures the middle (per-20s slice)',
      game.midBonusPerTick(0) === Math.round(100 * CONFIG.INCOME_TICK / CONFIG.INCOME_WINDOW));
    check('enemy does not share the bonus', game.midBonusPerTick(1) === 0);
    // owner keeps it even after its push dies — the enemy hasn't crossed yet
    scout.hp = 0;
    game.update(DT); game.drainEvents();
    check('bonus persists after your push dies (enemy not across yet)', game.midBonusPerTick(0) > 0);
    // the enemy crossing (and you having nothing on his side) steals control
    spawnUnit(game, 1, 'grunt', CONFIG.FIELD_W / 2 - 50, 300);
    game.update(DT); game.drainEvents();
    check('enemy holding the middle alone steals it', game.midBonusPerTick(1) > 0 && game.midBonusPerTick(0) === 0);
  }

  // While BOTH sides have a unit past the middle it is contested: ownership does
  // not flip — you only lose it once the enemy is past mid and you are NOT.
  {
    applyBalance({ general: { MID_INCOME: 100 } });
    const game = new Game(7, { races: ['humans', 'orcs'] });
    const mid = CONFIG.FIELD_W / 2;
    const mine = spawnUnit(game, 0, 'grunt', mid + 60, 300); mine.hp = mine.maxHp = 1e6; // I cross first
    game.update(DT); game.drainEvents();
    check('I own the middle after crossing', game.midBonusPerTick(0) > 0);
    const foe = spawnUnit(game, 1, 'grunt', mid - 60, 320); foe.hp = foe.maxHp = 1e6;   // enemy also crosses
    game.update(DT); game.drainEvents();
    check('contested (both past mid): I keep it', game.midBonusPerTick(0) > 0 && game.midBonusPerTick(1) === 0);
    mine.hp = 0; // now only the enemy is past mid
    game.update(DT); game.drainEvents();
    check('enemy alone past mid finally steals it', game.midBonusPerTick(1) > 0 && game.midBonusPerTick(0) === 0);
  }

  // Real-match scenario: both sides keep armies on their OWN half. Those must
  // NOT count as "past the middle". (The old bug: midHeld didn't filter by
  // team, so any unit on a half counted — the enemy could never steal because
  // the player's home units kept midHeld(1) permanently true.)
  {
    applyBalance({ general: { MID_INCOME: 100 } });
    const game = new Game(4, { races: ['humans', 'orcs'] });
    const mid = CONFIG.FIELD_W / 2;
    const h = spawnUnit(game, 0, 'grunt', 700, 300); h.hp = h.maxHp = 1e6;   // home army, own half
    const e = spawnUnit(game, 1, 'grunt', 2900, 300); e.hp = e.maxHp = 1e6;  // home army, own half
    const s0 = spawnUnit(game, 0, 'grunt', mid + 60, 500); s0.hp = s0.maxHp = 1e6; // player crosses
    game.update(DT); game.drainEvents();
    check('player captures mid despite both home armies', game.midBonusPerTick(0) > 0);
    const s1 = spawnUnit(game, 1, 'grunt', mid - 60, 520); s1.hp = s1.maxHp = 1e6; // enemy crosses too
    s0.hp = 0; // player's push falls, leaving only the enemy past mid
    game.update(DT); game.drainEvents();
    check('enemy steals mid despite both home armies',
      game.midBonusPerTick(1) > 0 && game.midBonusPerTick(0) === 0);
  }

  // Generator build cooldown: after building one, the next must wait buildCd s
  {
    applyBalance({ races: { humans: { buildings: { generator: { buildCd: 10 } } } } });
    const game = new Game(3, { races: ['humans', 'orcs'] });
    game.money[0] = 5000;
    const b1 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: 100, y: 400 });
    const b2 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: 100, y: 500 });
    check('first generator builds', b1.ok);
    check('second generator blocked by build cooldown', !b2.ok && b2.reason === 'cooldown');
    run(game, 10.1);
    const b3 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: 100, y: 500 });
    check('cooldown over -> generator builds again', b3.ok, JSON.stringify(b3));
    // walls are unaffected (no buildCd on them)
    const w = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 260, y: 200 });
    const w2 = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 260, y: 300 });
    check('other buildings have no cooldown', w.ok && w2.ok);
  }

  // Turret kill bounty: destroying the mid turret pays ITS race's bounty
  {
    applyBalance({ races: { orcs: { buildings: { turret: { bounty: 250 } } } } });
    const game = new Game(3, { races: ['humans', 'orcs'] });
    const t1 = game.structures.find((s) => s.kind === 'turret' && s.team === 1); // orcs turret
    const before = game.money[0];
    t1.hp = 0;
    game.update(DT); game.drainEvents();
    check('destroying the enemy turret pays its bounty', game.money[0] === before + 250, `money=${game.money[0]}`);
  }

  // AI army management: sells units that can't touch an air-heavy enemy
  {
    const { AIController } = await import('../src/sim/ai.js');
    applyBalance({ races: {
      humans: { units: { wasp: { isAir: true } } },
      orcs: { units: { slinger: { ranged: true, targetsAir: true } } },
    } });
    const game = new Game(5, { races: ['humans', 'orcs'] });
    game.templates[0].push({ type: 'wasp', x: 500, y: 300 }, { type: 'wasp', x: 500, y: 360 });
    game.templates[1].push({ type: 'grunt', x: 2600, y: 300 }); // can't hit air
    game.money[1] = 1000; // enough (even after early generators) to rebuild the anti-air unit
    const ai = new AIController(1, 'normal', 7);
    // army management runs on the 3rd think; that's when the dead-weight sell
    // fires (later thinks may rebuy front units via composition — not the point)
    for (let i = 0; i < 3; i++) ai.update(game, 1);
    check('AI sells a unit that cannot hit an air-heavy enemy',
      !game.templates[1].some((tpl) => tpl.type === 'grunt'));
  }

  // A2 economy discipline: the AI does NOT sell dead weight it cannot afford to
  // replace (refund + cash < anti-air cost) — churning would just bleed gold.
  {
    const { AIController } = await import('../src/sim/ai.js');
    applyBalance({ races: {
      humans: { units: { wasp: { isAir: true } } },
      orcs: { units: { slinger: { ranged: true, targetsAir: true, cost: 500 } } },
    } });
    const game = new Game(5, { races: ['humans', 'orcs'] });
    game.templates[0].push({ type: 'wasp', x: 500, y: 300 }, { type: 'wasp', x: 500, y: 360 });
    game.templates[1].push({ type: 'grunt', x: 2600, y: 300 });
    game.money[1] = 0; // broke: can't afford the 500-gold anti-air unit even after a refund
    const ai = new AIController(1, 'normal', 7);
    for (let i = 0; i < 6; i++) ai.update(game, 1);
    check('AI keeps dead weight it cannot afford to replace (no wasteful sell)',
      game.templates[1].some((tpl) => tpl.type === 'grunt'));
  }

  // AI army management: moves an out-of-position unit back into its role band
  {
    const { AIController } = await import('../src/sim/ai.js');
    applyBalance({});
    const game = new Game(5, { races: ['humans', 'orcs'] });
    const zone = CONFIG.ARMY_ZONE[1];
    game.templates[1].push({ type: 'crab', x: zone.x0 + 10, y: 300 }); // artillery on the front edge
    const ai = new AIController(1, 'normal', 7);
    for (let i = 0; i < 9; i++) ai.update(game, 1);
    const crab = game.templates[1][0];
    check('AI moves misplaced artillery toward the back band',
      crab.x > zone.x0 + (zone.x1 - zone.x0) * 0.6, `x=${Math.round(crab.x)}`);
  }

  // A3: when the ideal unit pick is priced out of reach, the AI still fields
  // the strongest AFFORDABLE unit instead of saving forever and stalling.
  {
    const { AIController } = await import('../src/sim/ai.js');
    // every orc unit costs a fortune except a cheap grunt
    const pricey = {};
    for (const id of Object.keys(UNITS)) pricey[id] = { cost: 999999 };
    pricey.grunt = { cost: 40 };
    applyBalance({ races: { orcs: { units: pricey } } });
    const game = new Game(11, { races: ['humans', 'orcs'] });
    game.money[1] = 5000; // plenty to buy many cheap grunts, none of the pricey ones
    const ai = new AIController(1, 'normal', 3);
    for (let i = 0; i < 20; i++) ai.update(game, 1);
    check('AI keeps buying affordable units when the ideal pick is priced out',
      game.templates[1].length >= 3, `count=${game.templates[1].length}`);
  }

  // Autocast toggle per unit TYPE: a healer with Heal toggled off never casts;
  // toggled back on it heals again.
  {
    // slinger has NO basic heal, so any HP gain can only come from the ability
    const healerCfg = { races: { humans: { units: { slinger: {
      caster: true, abilities: ['heal'], mana: 100, manaRegen: 10,
    } } } } };
    const wounded = (g) => { const u = spawnUnit(g, 0, 'grunt', 620, 400); u.maxHp = 1000; u.hp = 300; return u; };

    applyBalance(healerCfg);
    const g0 = new Game(8, { races: ['humans', 'orcs'] });
    spawnUnit(g0, 0, 'slinger', 600, 400);
    const w0 = wounded(g0);
    run(g0, 3);
    check('heal autocast ON by default (ally healed)', w0.hp > 300, `hp=${Math.round(w0.hp)}`);

    applyBalance(healerCfg);
    const g1 = new Game(8, { races: ['humans', 'orcs'] });
    const off = g1.issueCommand({ type: 'toggleAbility', team: 0, unit: 'slinger', ability: 'heal', on: false });
    spawnUnit(g1, 0, 'slinger', 600, 400);
    const w1 = wounded(g1);
    run(g1, 3);
    check('heal toggled OFF -> never cast', off.ok && w1.hp === 300, `hp=${Math.round(w1.hp)}`);
    g1.issueCommand({ type: 'toggleAbility', team: 0, unit: 'slinger', ability: 'heal', on: true });
    run(g1, 3);
    check('heal toggled back ON -> heals again', w1.hp > 300, `hp=${Math.round(w1.hp)}`);
  }

  // Ability tier gating: an ability with `tier: 2` stays locked until the
  // base reaches tier 2.
  {
    applyBalance({
      races: { humans: { units: { slinger: { caster: true, abilities: ['heal'], mana: 100, manaRegen: 10 } } } },
      abilities: { heal: { tier: 2 } },
    });
    const g = new Game(8, { races: ['humans', 'orcs'] });
    spawnUnit(g, 0, 'slinger', 600, 400);
    const w = spawnUnit(g, 0, 'grunt', 620, 400); w.maxHp = 1000; w.hp = 300;
    run(g, 3);
    check('tier-2 ability locked at base tier 1', w.hp === 300, `hp=${Math.round(w.hp)}`);
    g.money[0] = 5000;
    g.issueCommand({ type: 'upgradeBase', team: 0 });
    run(g, 3);
    check('tier-2 ability unlocks after base upgrade', w.hp > 300, `hp=${Math.round(w.hp)}`);
  }

  // Upgrade on/off toggle: an owned "Attack ground units" can be deactivated
  // (unit loses ground attack) and reactivated.
  {
    const cfg = {
      races: {
        humans: { units: { grunt: { targetsGround: false } } },
        orcs: { units: { grunt: { targetsGround: false } } },
      },
      upgrades: { groundattack: { race: 'humans', unit: 'grunt', params: { cost: 100 } } },
    };
    applyBalance(cfg);
    const g = new Game(9, { races: ['humans', 'orcs'] });
    g.issueCommand({ type: 'buyUpgrade', team: 0, id: 'groundattack' });
    const tOff = g.issueCommand({ type: 'toggleUpgrade', team: 0, id: 'groundattack', on: false });
    spawnUnit(g, 0, 'grunt', 600, 400);
    const tgt = spawnUnit(g, 1, 'grunt', 650, 400); tgt.hp = tgt.maxHp = 100000;
    run(g, 3);
    check('owned upgrade toggled OFF -> no ground attack', tOff.ok && tgt.hp === tgt.maxHp);
    g.issueCommand({ type: 'toggleUpgrade', team: 0, id: 'groundattack', on: true });
    // fresh pair (the first attacker marched past its untouchable target)
    spawnUnit(g, 0, 'grunt', 1000, 400);
    const tgt2 = spawnUnit(g, 1, 'grunt', 1050, 400); tgt2.hp = tgt2.maxHp = 100000;
    run(g, 3);
    check('upgrade toggled back ON -> ground attack works', tgt2.hp < tgt2.maxHp);
    const notOwned = new Game(9, { races: ['humans', 'orcs'] })
      .issueCommand({ type: 'toggleUpgrade', team: 0, id: 'groundattack', on: false });
    check('toggling an unowned upgrade rejected', !notOwned.ok);
  }

  // Marching units keep their OWN lanes in the enemy half (no Indian file):
  // a pack that crossed midfield on the same y must spread vertically while
  // homing toward the enemy base.
  {
    applyBalance({});
    const game = new Game(3, { races: ['humans', 'orcs'] });
    const mid = CONFIG.FIELD_W / 2;
    for (let i = 0; i < 8; i++) {
      const g = spawnUnit(game, 0, 'grunt', mid + 60 + i * 18, CONFIG.MAIN.y);
      g.hp = g.maxHp = 100000;
    }
    run(game, 3);
    const ys = game.entities.filter((u) => u.team === 0).map((u) => u.y);
    const spread = Math.max(...ys) - Math.min(...ys);
    check('marching pack spreads into lanes (no Indian file)',
      spread > 60, `spread=${Math.round(spread)}`);
  }

  // Attackers FAN OUT around a targeted structure instead of queueing on its
  // center line: after closing in on the enemy main, the pack must spread
  // vertically (units both above and below the base's center).
  {
    applyBalance({});
    const game = new Game(3, { races: ['humans', 'orcs'] });
    const main = game.mainOf(1);
    for (let i = 0; i < 8; i++) {
      const g = spawnUnit(game, 0, 'grunt', main.x - 220, main.y - 28 + i * 8);
      g.hp = g.maxHp = 100000; // survive the base's neighborhood
    }
    run(game, 6);
    const ys = game.entities.filter((u) => u.team === 0).map((u) => u.y - main.y);
    const above = ys.filter((y) => y < -35).length;
    const below = ys.filter((y) => y > 35).length;
    check('attackers surround the base (some above, some below)',
      above >= 1 && below >= 1, `ys=${ys.map((y) => Math.round(y)).join(',')}`);
  }

  // "Acid Spit" upgrade: the unit's attack becomes a ranged acid projectile
  // that splashes AND leaves a damage-over-time acid on everyone caught.
  {
    applyBalance({
      upgrades: { acidspit: { race: 'humans', unit: 'grunt', params: {
        cost: 100, range: 260, damage: 20, splashRadius: 100,
        dotDamage: 30, dotDuration: 3, projectileSpeed: 400,
      } } },
    });
    const game = new Game(9, { races: ['humans', 'orcs'] });
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'acidspit' });
    const spitter = spawnUnit(game, 0, 'grunt', 600, 400);
    // two enemies close together -> the splash should catch BOTH
    const a = spawnUnit(game, 1, 'grunt', 700, 400); a.hp = a.maxHp = 100000;
    const b = spawnUnit(game, 1, 'grunt', 740, 420); b.hp = b.maxHp = 100000;
    run(game, 2);
    check('acid spit splashes both nearby enemies', a.hp < a.maxHp && b.hp < b.maxHp,
      `a=${Math.round(a.maxHp - a.hp)} b=${Math.round(b.maxHp - b.hp)}`);
    check('acid leaves a damage-over-time effect',
      !!a.effects && a.effects.some((e) => e.kind === 'acid' && e.until > game.time));
    // the acid keeps ticking after impact (freeze the sim's projectiles, let DoT run)
    const hpBefore = a.hp;
    run(game, 1);
    check('acid damage-over-time keeps chipping HP', a.hp < hpBefore, `dropped ${Math.round(hpBefore - a.hp)}`);

    // toggled off -> no acid attack (reverts to the grunt's melee)
    game.issueCommand({ type: 'toggleUpgrade', team: 0, id: 'acidspit', on: false });
    const g2 = new Game(9, { races: ['humans', 'orcs'] });
    g2.issueCommand({ type: 'buyUpgrade', team: 0, id: 'acidspit' });
    g2.issueCommand({ type: 'toggleUpgrade', team: 0, id: 'acidspit', on: false });
    const s2 = spawnUnit(g2, 0, 'grunt', 600, 400);
    run(g2, 1);
    check('acid upgrade toggled off -> no acid projectile fired',
      g2.projectiles.every((p) => !p.acid));

    // acid corrodes FLIERS too (ordinary splash is ground-only, acid is not)
    applyBalance({
      races: {
        humans: { units: { grunt: { targetsAir: true } } }, // spitter can aim up
        orcs: { units: { grunt: { isAir: true } } },
      },
      upgrades: { acidspit: { race: 'humans', unit: 'grunt', params: {
        cost: 100, range: 300, damage: 20, splashRadius: 120,
        dotDamage: 25, dotDuration: 3, projectileSpeed: 400,
      } } },
    });
    const g3 = new Game(9, { races: ['humans', 'orcs'] });
    g3.issueCommand({ type: 'buyUpgrade', team: 0, id: 'acidspit' });
    spawnUnit(g3, 0, 'grunt', 600, 400);           // human spitter (ground)
    const flyer = spawnUnit(g3, 1, 'grunt', 720, 400); // orc flier
    flyer.hp = flyer.maxHp = 100000;
    run(g3, 2);
    check('acid spit damages a flying enemy', flyer.hp < flyer.maxHp,
      `dropped ${Math.round(flyer.maxHp - flyer.hp)}`);
    check('acid leaves a DoT on the flier',
      !!flyer.effects && flyer.effects.some((e) => e.kind === 'acid' && e.until > g3.time));
    applyBalance({});
  }

  // "AoE Damage" upgrade: the struck target takes full damage, bystanders on
  // the SAME plane take splashPower% of it; the burst never crosses planes.
  {
    // thrower = ranged grunt; enemies get speed 0 so positions stay fixed
    const AOE = { cost: 100, splashRadius: 100, splashPower: 50 };
    applyBalance({
      races: {
        humans: { units: { grunt: { ranged: true, range: 220, targetsAir: true } } },
        orcs: { units: { grunt: { speed: 0 } } },
      },
      upgrades: { aoedamage: { race: 'humans', unit: 'grunt', params: AOE } },
    });
    const game = new Game(11, { races: ['humans', 'orcs'] });
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'aoedamage' });
    spawnUnit(game, 0, 'grunt', 600, 400);
    const a = spawnUnit(game, 1, 'grunt', 760, 400); a.hp = a.maxHp = 100000; // primary target
    const b = spawnUnit(game, 1, 'grunt', 800, 430); b.hp = b.maxHp = 100000; // only splash reaches it
    run(game, 2);
    check('AoE axe damages both clumped enemies', a.hp < a.maxHp && b.hp < b.maxHp,
      `a=${Math.round(a.maxHp - a.hp)} b=${Math.round(b.maxHp - b.hp)}`);
    check('AoE bystander takes exactly splashPower% of the target\'s damage',
      Math.abs((b.maxHp - b.hp) - 0.5 * (a.maxHp - a.hp)) < 0.001,
      `a=${a.maxHp - a.hp} b=${b.maxHp - b.hp}`);

    // toggled off -> single target: the neighbour stays untouched
    const g2 = new Game(11, { races: ['humans', 'orcs'] });
    g2.issueCommand({ type: 'buyUpgrade', team: 0, id: 'aoedamage' });
    g2.issueCommand({ type: 'toggleUpgrade', team: 0, id: 'aoedamage', on: false });
    spawnUnit(g2, 0, 'grunt', 600, 400);
    const a2 = spawnUnit(g2, 1, 'grunt', 760, 400); a2.hp = a2.maxHp = 100000;
    const b2 = spawnUnit(g2, 1, 'grunt', 800, 430); b2.hp = b2.maxHp = 100000;
    run(g2, 2);
    check('AoE toggled off -> only the primary target is hit', a2.hp < a2.maxHp && b2.hp === b2.maxHp);

    // hit an AIR target -> the burst damages ONLY air units around it
    applyBalance({
      races: {
        humans: { units: { grunt: { ranged: true, range: 220, targetsAir: true } } },
        orcs: { units: { grunt: { speed: 0, isAir: true }, bruiser: { speed: 0 } } },
      },
      upgrades: { aoedamage: { race: 'humans', unit: 'grunt', params: AOE } },
    });
    const g3 = new Game(11, { races: ['humans', 'orcs'] });
    g3.issueCommand({ type: 'buyUpgrade', team: 0, id: 'aoedamage' });
    spawnUnit(g3, 0, 'grunt', 600, 400);
    const fa = spawnUnit(g3, 1, 'grunt', 760, 400); fa.hp = fa.maxHp = 100000;   // air, primary
    const fb = spawnUnit(g3, 1, 'grunt', 800, 430); fb.hp = fb.maxHp = 100000;   // air bystander
    const gnd = spawnUnit(g3, 1, 'bruiser', 790, 400); gnd.hp = gnd.maxHp = 100000; // ground, in radius
    run(g3, 2);
    check('AoE on an AIR target splashes the other flier',
      fa.hp < fa.maxHp && fb.hp < fb.maxHp,
      `fa=${Math.round(fa.maxHp - fa.hp)} fb=${Math.round(fb.maxHp - fb.hp)}`);
    check('AoE on an AIR target leaves GROUND units untouched', gnd.hp === gnd.maxHp);

    // hit a GROUND target -> the burst leaves air units untouched
    applyBalance({
      races: {
        humans: { units: { grunt: { ranged: true, range: 220 } } }, // ground-only thrower
        orcs: { units: { grunt: { speed: 0, isAir: true }, bruiser: { speed: 0 } } },
      },
      upgrades: { aoedamage: { race: 'humans', unit: 'grunt', params: AOE } },
    });
    const g4 = new Game(11, { races: ['humans', 'orcs'] });
    g4.issueCommand({ type: 'buyUpgrade', team: 0, id: 'aoedamage' });
    spawnUnit(g4, 0, 'grunt', 600, 400);
    const ga = spawnUnit(g4, 1, 'bruiser', 760, 400); ga.hp = ga.maxHp = 100000;  // ground, primary
    const air = spawnUnit(g4, 1, 'grunt', 790, 420); air.hp = air.maxHp = 100000; // air, in radius
    run(g4, 2);
    check('AoE on a GROUND target damages it but not the flier above',
      ga.hp < ga.maxHp && air.hp === air.maxHp,
      `ga=${Math.round(ga.maxHp - ga.hp)} air=${Math.round(air.maxHp - air.hp)}`);
    applyBalance({});
  }

  // "Landing Split" upgrade: a GROUND enemy inside the trigger radius makes
  // the flyer DIVE into it (dash damage on impact, ground-only trigger), then
  // it splits into TWO units — the rider on foot (still ranged) and a melee
  // beast with its own HP. Both fight on.
  {
    const { effStats } = await import('../src/sim/combat.js');
    const P = {
      cost: 100, radius: 200, dashSpeed: 700, dashDamage: 50,
      dmDamage: 20, dmRange: 150, dmPeriod: 0.8, dmSpeed: 80, dmSize: 100, dmRanged: 1,
      beastHp: 300, beastDamage: 25, beastRange: 30, beastPeriod: 0.7, beastSpeed: 100, beastSize: 100,
    };
    applyBalance({ upgrades: { splitmount: { race: 'orcs', unit: 'wasp', params: P } } });
    const game = new Game(12, { races: ['humans', 'orcs'] });
    game.issueCommand({ type: 'buyUpgrade', team: 1, id: 'splitmount' });
    const rider = spawnUnit(game, 1, 'wasp', 900, 400);
    const foe = spawnUnit(game, 0, 'grunt', 780, 400); foe.hp = foe.maxHp = 100000;
    const before = game.entities.length;
    game.update(DT); game.drainEvents();
    check('split: the flyer DIVES first (dashing, no instant split)',
      rider.dashing === true && rider.dismounted === false);
    run(game, 1); // enough to close the gap at dashSpeed and land
    check('split: after the dive the rider lands (dismounted, no longer air)',
      rider.dismounted === true && rider.isAir === false);
    const beast = game.entities.find((e) => e.beast);
    check('split: a beast unit spawned for the same team',
      game.entities.length === before + 1 && !!beast && beast.team === 1 && !beast.isAir);
    check('split: the beast has its own HP from the upgrade', !!beast && beast.maxHp === 300);
    const rs = effStats(rider, game.ustat(1, 'wasp'));
    const bs = effStats(beast, game.ustat(1, 'wasp'));
    check('split: rider keeps a RANGED attack with on-foot numbers',
      rs.ranged === true && rs.damage === 20 && rs.range === 150);
    check('split: beast fights in MELEE with its own numbers',
      bs.ranged === false && bs.damage === 25 && bs.range === 30);
    run(game, 2);
    check('split: the pair actually hurts the enemy', foe.hp < foe.maxHp,
      `dropped ${Math.round(foe.maxHp - foe.hp)}`);

    // the impact deals EXACTLY the dash damage (attack damage zeroed out)
    applyBalance({ upgrades: { splitmount: { race: 'orcs', unit: 'wasp',
      params: { ...P, dmDamage: 0, beastDamage: 0, dmRanged: 0 } } } });
    const gd = new Game(12, { races: ['humans', 'orcs'] });
    gd.issueCommand({ type: 'buyUpgrade', team: 1, id: 'splitmount' });
    spawnUnit(gd, 1, 'wasp', 900, 400);
    const foeD = spawnUnit(gd, 0, 'grunt', 780, 400); foeD.hp = foeD.maxHp = 100000;
    run(gd, 2);
    const expected = 50 * DAMAGE_MATRIX.normal.light;
    check('split: the dive lands the one-off dash damage on the ground unit',
      Math.abs((foeD.maxHp - foeD.hp) - expected) < 0.001,
      `dropped ${foeD.maxHp - foeD.hp}, expected ${expected}`);

    // ONLY a ground unit triggers the dive: an air enemy leaves it whole
    applyBalance({
      races: { humans: { units: { grunt: { isAir: true } } } },
      upgrades: { splitmount: { race: 'orcs', unit: 'wasp', params: P } },
    });
    const ga = new Game(12, { races: ['humans', 'orcs'] });
    ga.issueCommand({ type: 'buyUpgrade', team: 1, id: 'splitmount' });
    const riderA = spawnUnit(ga, 1, 'wasp', 900, 400);
    spawnUnit(ga, 0, 'grunt', 780, 400); // flying enemy
    run(ga, 1);
    check('split: an AIR enemy does not trigger the dive/split',
      riderA.dismounted === false && ga.entities.every((e) => !e.beast));

    // no enemy nearby -> stays whole; toggled off -> never splits
    applyBalance({ upgrades: { splitmount: { race: 'orcs', unit: 'wasp', params: P } } });
    const g2 = new Game(12, { races: ['humans', 'orcs'] });
    g2.issueCommand({ type: 'buyUpgrade', team: 1, id: 'splitmount' });
    const lone = spawnUnit(g2, 1, 'wasp', 3000, 400);
    g2.update(DT); g2.drainEvents();
    check('no enemy in radius -> no split', lone.dismounted === false && g2.entities.every((e) => !e.beast));
    g2.issueCommand({ type: 'toggleUpgrade', team: 1, id: 'splitmount', on: false });
    spawnUnit(g2, 0, 'grunt', 2900, 400);
    g2.update(DT); g2.drainEvents();
    check('toggled off -> no split even with an enemy close',
      lone.dismounted === false && g2.entities.every((e) => !e.beast));
    applyBalance({});
  }

  // "Focus building" upgrade: the unit ignores enemy troops and only ever
  // attacks structures.
  {
    applyBalance({
      races: { humans: { units: { grunt: { range: 40 } } } },
      upgrades: { focusbuilding: { race: 'humans', unit: 'grunt', params: { cost: 100 } } },
    });
    const game = new Game(13, { races: ['humans', 'orcs'] });
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'focusbuilding' });
    const cannon = spawnUnit(game, 0, 'grunt', 900, 480);
    const foe = spawnUnit(game, 1, 'grunt', 940, 480); foe.hp = foe.maxHp = 100000; // right next to it
    const wall = makeStructure(game, 1, 'wall', 1100, 480); wall.hp = wall.maxHp = 100000;
    run(game, 3);
    check('focus building: ignores the adjacent enemy unit', foe.hp === foe.maxHp);
    check('focus building: marched to and attacked the structure', wall.hp < wall.maxHp,
      `wall dropped ${Math.round(wall.maxHp - wall.hp)}`);
    const t = game.byId.get(cannon.targetId);
    check('focus building: current target is a structure', !!t && !!t.isStructure);

    // toggled off -> attacks the nearby unit again
    const g2 = new Game(13, { races: ['humans', 'orcs'] });
    g2.issueCommand({ type: 'buyUpgrade', team: 0, id: 'focusbuilding' });
    g2.issueCommand({ type: 'toggleUpgrade', team: 0, id: 'focusbuilding', on: false });
    spawnUnit(g2, 0, 'grunt', 900, 480);
    const foe2 = spawnUnit(g2, 1, 'grunt', 940, 480); foe2.hp = foe2.maxHp = 100000;
    run(g2, 3);
    check('focus building toggled off -> hits the unit again', foe2.hp < foe2.maxHp);
    applyBalance({});
  }

  // Special "damage vs buildings": always applies (no upgrade needed), and only
  // to structures — enemy units still take the normal damage.
  {
    const M = DAMAGE_MATRIX.normal;
    // melee unit, normal damage 10, building damage 100 — NO upgrade bought
    applyBalance({ races: { humans: { units: { grunt: { damage: 10, dmgType: 'normal', buildingDamage: 100 } } } } });
    const game = new Game(14, { races: ['humans', 'orcs'] });
    const u = spawnUnit(game, 0, 'grunt', 1090, 480);
    const wall = makeStructure(game, 1, 'wall', 1120, 480); wall.hp = wall.maxHp = 1e6;
    run(game, 1.2);
    const perHit = 100 * M.structure;
    check('building damage applies with NO upgrade, only vs structures',
      wall.hp < wall.maxHp && Math.abs((wall.maxHp - wall.hp) % perHit) < 0.001,
      `wall dropped ${wall.maxHp - wall.hp}, per hit ${perHit}`);

    // vs a UNIT it deals the normal damage, not the building damage
    const g2 = new Game(14, { races: ['humans', 'orcs'] });
    spawnUnit(g2, 0, 'grunt', 1090, 480);
    const foe = spawnUnit(g2, 1, 'grunt', 1120, 480); foe.hp = foe.maxHp = 1e6;
    run(g2, 1.2);
    const dropped = foe.maxHp - foe.hp;
    check('building damage does NOT affect units (normal damage used)',
      dropped > 0 && dropped % (10 * M.light) < 0.001 && dropped < 100,
      `unit dropped ${dropped}`);

    // ranged: the projectile carries the building damage too
    applyBalance({ races: { humans: { units: { grunt: { ranged: true, range: 200, projSpeed: 600, damage: 5, dmgType: 'normal', buildingDamage: 80 } } } } });
    const g3 = new Game(14, { races: ['humans', 'orcs'] });
    spawnUnit(g3, 0, 'grunt', 950, 480);
    const wall3 = makeStructure(g3, 1, 'wall', 1080, 480); wall3.hp = wall3.maxHp = 1e6;
    run(g3, 1.5);
    check('ranged building damage: projectile hits the wall for the building value',
      wall3.hp < wall3.maxHp && (wall3.maxHp - wall3.hp) % (80 * M.structure) < 0.001,
      `wall dropped ${wall3.maxHp - wall3.hp}, per hit ${80 * M.structure}`);
    applyBalance({});
  }

  resetAll(); // leave the shared balance pristine for any later tests
}

// ----------------------------------------------------------------- done
console.log('');
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('all tests passed');
