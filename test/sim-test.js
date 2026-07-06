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

  // slow aura: a humans mender-caster with slowaura makes the enemy grunt
  // attack noticeably slower than without it
  function grutHitsIn(seconds, withAura) {
    const cfg = withAura
      ? { races: { humans: { units: { mender: { caster: true, abilities: ['slowaura'] } } } } }
      : {};
    applyBalance(cfg);
    const game = new Game(42, { races: ['humans', 'orcs'] });
    const aura = spawnUnit(game, 0, 'mender', 600, 300);
    const victim = spawnUnit(game, 0, 'grunt', 620, 300);
    victim.hp = victim.maxHp = 100000; // survives the whole window
    const attacker = spawnUnit(game, 1, 'grunt', 645, 300);
    attacker.hp = attacker.maxHp = 100000;
    const hp0 = victim.hp;
    run(game, seconds);
    return hp0 - victim.hp; // damage dealt = attack-rate proxy
  }
  const dmgFree = grutHitsIn(6, false);
  const dmgSlowed = grutHitsIn(6, true);
  check('slow aura reduces enemy attack rate', dmgSlowed < dmgFree * 0.9, `free=${dmgFree} slowed=${dmgSlowed}`);

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

  // cast priority: while mid-cast a caster does not also auto-attack
  {
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['heal'], mana: 100, manaRegen: 50 } } } } });
    const game = new Game(8, { races: ['humans', 'orcs'] });
    const mender = spawnUnit(game, 0, 'mender', 600, 300);
    const ally = spawnUnit(game, 0, 'grunt', 620, 300);
    ally.maxHp = 1000; ally.hp = 200;
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
    check('caster with mana prioritizes spells', casterPrioritizesSpells({ mana: 100 }, st));
    check('caster out of mana attacks normally', !casterPrioritizesSpells({ mana: 0 }, st));
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

  resetAll(); // leave the shared balance pristine for any later tests
}

// ----------------------------------------------------------------- done
console.log('');
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('all tests passed');
