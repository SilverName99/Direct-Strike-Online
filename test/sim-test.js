// Headless sanity tests: node test/sim-test.js
// Running the full sim in plain Node doubles as proof that src/sim/
// never touches the DOM.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../src/sim/game.js';
import { AIController, categoryOf } from '../src/sim/ai.js';
import { spawnUnit, makeStructure, spawnSummon } from '../src/sim/entity.js';
import { stepCaster, updateAbilities, isStunned, learnedAbilityParams } from '../src/sim/abilities.js';
import { effStats } from '../src/sim/combat.js';
import { UNITS, DAMAGE_MATRIX } from '../src/units.js';
import { CONFIG } from '../src/config.js';
import { statsBuilding, resolvedAbility, statsUnit, resolvedHeroId, resolvedHeroIds } from '../src/ui/balance.js';

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

// ------------------------------------------------- base upgrade wait time
// The base goes "busy" for TIER_UP_TIME seconds before the new tier lands.
console.log('base tier upgrade wait');
{
  const WAIT = 12, WAIT3 = 8;
  const saved = [...(statsBuilding('humans', 'main').upgradeTime || [20, 20])];
  statsBuilding('humans', 'main').upgradeTime = [WAIT, WAIT3];
  const game = new Game(3, { races: ['humans', 'orcs'] });
  game.money[0] = 5000;
  check('duration reads per-tier (1->2)', game.baseUpgradeDuration(0) === WAIT);
  const up = game.issueCommand({ type: 'upgradeBase', team: 0 });
  check('upgradeBase accepted', up.ok);
  check('tier not advanced immediately', game.tier[0] === 1);
  check('base reports busy', game.baseUpgrading(0) === true);
  check('target tier is 2', game.baseUpgradeToTier(0) === 2);
  // a second upgrade while busy is refused
  const again = game.issueCommand({ type: 'upgradeBase', team: 0 });
  check('second upgrade refused while busy', !again.ok && again.reason === 'busy');
  run(game, WAIT - 2);
  check('still tier 1 mid-wait', game.tier[0] === 1 && game.baseUpgrading(0));
  check('progress climbs toward 1', game.baseUpgradeProgress(0) > 0.7);
  run(game, 3);
  check('tier advances after the wait', game.tier[0] === 2);
  check('no longer busy', game.baseUpgrading(0) === false);
  // the 2->3 step uses the second entry of the array
  check('duration reads per-tier (2->3)', game.baseUpgradeDuration(0) === WAIT3);
  statsBuilding('humans', 'main').upgradeTime = saved;
}

// The remaining tier-gating tests were written before the wait existed and
// assume an instant upgrade — keep them instant so they stay focused. Set the
// CONFIG template too, so any later applyBalance()/rebuild stays instant.
CONFIG.MAIN.upgradeTime = [0, 0];
for (const r of ['humans', 'orcs']) statsBuilding(r, 'main').upgradeTime = [0, 0];

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
  const maxMin = 30; // headroom: the longer middle lengthens matches
  const maxTicks = Math.ceil((maxMin * 60) / DT);
  let ticks = 0;
  while (game.winner === null && ticks < maxTicks) {
    ai0.update(game, DT);
    ai1.update(game, DT);
    game.update(DT);
    game.drainEvents();
    ticks++;
  }
  check(
    `a main base falls within ${maxMin} sim-minutes`,
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
  // per-race default rosters gate units behind tech buildings — grant the ones
  // these zone/tier/sell tests need (grunt->bldg1, bruiser->bldg3)
  for (const kind of ['bldg1', 'bldg3']) game.structures.push(makeStructure(game, 0, kind, 700, 300));
  const gruntCost = game.ustat(0, 'grunt').cost;

  const buy = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 500, y: 700 });
  check('buy inside army zone ok', buy.ok);
  const badZone = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 740, y: 700 });
  check('buy in construction zone rejected', !badZone.ok);
  const tooClose = game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 502, y: 702 });
  check('buy on top of another template rejected', !tooClose.ok);

  const locked = game.issueCommand({ type: 'buy', team: 0, unitId: 'bruiser', x: 460, y: 300 });
  check('tier-2 unit locked at tier 1', !locked.ok && locked.reason === 'tier-locked');
  const up = game.issueCommand({ type: 'upgradeBase', team: 0 });
  check('base upgrade to tier 2 ok', up.ok && game.tier[0] === 2);
  const nowOk = game.issueCommand({ type: 'buy', team: 0, unitId: 'bruiser', x: 460, y: 300 });
  check('tier-2 unit unlocked after upgrade', nowOk.ok);
  const t3 = game.issueCommand({ type: 'buy', team: 0, unitId: 'archon', x: 460, y: 400 });
  check('tier-3 unit still locked at tier 2', !t3.ok);

  // never-spawned template sells for a full refund
  const beforeFull = game.money[0];
  const sellFull = game.issueCommand({ type: 'sellUnit', team: 0, index: 0 });
  check('sellUnit refunds 100% before first spawn',
    sellFull.ok && game.money[0] === beforeFull + gruntCost);

  // once it has spawned, selling only gives the partial refund
  game.issueCommand({ type: 'buy', team: 0, unitId: 'grunt', x: 500, y: 700 });
  game.templates[0][game.templates[0].length - 1].spawned = true;
  const idxSpawned = game.templates[0].length - 1;
  const before = game.money[0];
  const sell = game.issueCommand({ type: 'sellUnit', team: 0, index: idxSpawned });
  const refund = Math.round(gruntCost * CONFIG.SELL_REFUND);
  check('sellUnit refunds 75% after spawn', sell.ok && game.money[0] === before + refund);

  const mv = game.issueCommand({ type: 'moveUnit', team: 0, index: 0, x: 400, y: 500 });
  check('moveUnit inside army zone ok', mv.ok && game.templates[0][0].x === 400);
  const badMv = game.issueCommand({ type: 'moveUnit', team: 0, index: 0, x: 740, y: 500 });
  check('moveUnit outside army zone rejected', !badMv.ok);
}

// ----------------------------------------------------------- buildings
console.log('buildings');
{
  const game = new Game(6);
  game.money[0] = 5000;

  const base = game.incomePerTick(0);
  // mines rise only on their predefined plots — clicks snap to the nearest one
  check('mine plots generated (cap of them)', game.mineSpots[0].length === CONFIG.BUILDINGS.generator.cap);
  const reserve = CONFIG.CONSTRUCTION_ZONE[0].x1 - 3 * CONFIG.GRID;
  check('plots keep the 3 front columns free', game.mineSpots[0].every((p) => p.x < reserve));
  const s1 = game.mineSpots[0][0];
  const s2 = game.mineSpots[0][1];
  const g1 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: s1.x, y: s1.y });
  const g2 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: s2.x, y: s2.y });
  check('generators build on their plots', g1.ok && g2.ok);
  const gOff = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: 850, y: 480 });
  if (gOff.ok) {
    const gLast = game.structures.filter((s) => s.kind === 'generator').pop();
    check('off-plot click snapped onto a plot', game.mineSpots[0].some((p) => p.x === gLast.x && p.y === gLast.y));
  } else {
    check('off-plot click with no near plot refuses', gOff.reason === 'no-spot');
  }
  // income amounts are per 20s; each tick pays the proportional slice
  const tickShare = CONFIG.INCOME_TICK / CONFIG.INCOME_WINDOW;
  const builtGens = game.countBuilt(0, 'generator');
  check(
    'each generator adds income',
    game.incomePerTick(0) === base + Math.round(builtGens * CONFIG.BUILDINGS.generator.income * tickShare)
  );

  const overlap = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: s1.x, y: s1.y + 5 });
  check('overlapping build rejected', !overlap.ok);
  const badZone = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 500, y: 700 });
  check('building in army zone rejected', !badZone.ok);

  const wall = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 750, y: 720 });
  check('wall builds ok', wall.ok);

  // flush-adjacent walls (edges touching, one grid cell apart) are allowed
  const wallB = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 750, y: 720 + CONFIG.GRID });
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

// --------------------------------------------------- tower / wall HP regen
console.log('structure HP regen');
{
  const savedW = statsBuilding('humans', 'wall').regen;
  const savedT = statsBuilding('humans', 'tower').regen;
  statsBuilding('humans', 'wall').regen = 10; // HP/s
  statsBuilding('humans', 'tower').regen = 0; // stays off
  const game = new Game(21, { races: ['humans', 'orcs'] });
  game.money[0] = 5000;
  const wb = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 760, y: 720 });
  check('wall builds for regen test', wb.ok);
  const wall = game.structures.filter((s) => s.kind === 'wall').pop();
  wall.hp = wall.maxHp - 100; // wound it
  run(game, 5);
  check('wall regenerates ~10 HP/s', wall.hp >= wall.maxHp - 55 && wall.hp <= wall.maxHp - 45, `hp=${Math.round(wall.hp)} of ${wall.maxHp}`);
  run(game, 20);
  check('regen never exceeds max HP', wall.hp === wall.maxHp);
  statsBuilding('humans', 'wall').regen = savedW;
  statsBuilding('humans', 'tower').regen = savedT;
}

// ------------------------------------------ holy light per-rank heal amount
console.log('holy light per-rank heal');
{
  // Drive one Holy Light cast from a hero at a given rank and return the heal
  // as a fraction of the ally's MAX hp. `overrides` sets ab.params for the run.
  const healFracAtRank = (rank, overrides, seed) => {
    const game = new Game(seed, { races: ['humans', 'orcs'] });
    game.abilityUsable = () => true; // focus on the heal math, not tier/learn gating
    const ab = resolvedAbility('holylight');
    const saved = { ...ab.params };
    Object.assign(ab.params, overrides);
    const caster = spawnUnit(game, 0, 'grunt', 600, 400);
    caster.hero = true; caster.heroRanks = { holylight: rank };
    caster.mana = 100; caster.abilityCd = {}; caster.castState = undefined;
    const ally = spawnUnit(game, 0, 'grunt', 640, 400);
    const start = ally.maxHp * 0.3; // low enough that even a big heal won't cap
    ally.hp = start;
    const stats = { caster: true, autoAttackBetween: true, abilities: ['holylight'] };
    for (let i = 0; i < 90 && ally.hp <= start; i++) {
      game.time += DT;
      stepCaster(game, caster, stats, DT, false);
    }
    Object.assign(ab.params, saved); // restore for the next runs / other tests
    return (ally.hp - start) / ally.maxHp;
  };
  const f2 = healFracAtRank(2, { healPct2: 40 }, 41);
  check('holy light rank 2 heals the explicit 40%', Math.abs(f2 - 0.40) < 0.01, `frac=${f2.toFixed(3)}`);
  const f3 = healFracAtRank(3, { healPct3: 55 }, 42);
  check('holy light rank 3 heals the explicit 55%', Math.abs(f3 - 0.55) < 0.01, `frac=${f3.toFixed(3)}`);
  // override 0 -> auto-scaled healPct (15% base, rank 2 = 1.5x = 22.5%)
  const fAuto = healFracAtRank(2, { healPct: 15, healPct2: 0 }, 43);
  check('holy light rank 2 auto-scales when override is 0', Math.abs(fAuto - 0.225) < 0.01, `frac=${fAuto.toFixed(3)}`);
}

// ------------------------------------------ multi-hero recruit (Hero Hall)
console.log('multi-hero recruitment');
{
  const race = 'humans';
  // three dedicated heroes ship in the roster: hero (t1), hero2 (t2), hero3 (t3)
  const ids = resolvedHeroIds(race);
  check('three heroes resolved, tier-ordered',
    ids.length === 3 && ids[0] === 'hero' && ids[1] === 'hero2' && ids[2] === 'hero3', ids.join(','));

  const game = new Game(52, { races: ['humans', 'orcs'] });
  game.money[0] = 99999;
  // recruiting refused before the Hero Hall exists
  const noHall = game.issueCommand({ type: 'buy', team: 0, unitId: 'hero', x: 300, y: 300 });
  check('hero refused without Hero Hall', !noHall.ok && noHall.reason === 'no-herohall');
  makeStructure(game, 0, 'herohall', 820, 300); // finished (buildTime 0)
  check('hero hall counts as built', game.hasBuilding(0, 'herohall'));
  // count-based gate: ANY hero can be your 1st at tier 1 — recruit hero3 directly
  const first = game.issueCommand({ type: 'buy', team: 0, unitId: 'hero3', x: 300, y: 300 });
  check('any hero allowed as the 1st at tier 1', first.ok && game.hasHeroType(0, 'hero3'), first.reason || '');
  // a fresh hero starts at level 1 WITH one talent point (learn an ability now)
  check('hero starts with 1 talent point at level 1', game.heroTemplateOf(0, 'hero3').points === 1);
  // a 2nd hero is tier-locked at tier 1 (needs tier 2), whichever one
  const second = game.issueCommand({ type: 'buy', team: 0, unitId: 'hero', x: 300, y: 600 });
  check('2nd hero tier-locked at tier 1', !second.ok && second.reason === 'tier-locked');
  // a duplicate of an owned hero hits the per-type cap
  const dup = game.issueCommand({ type: 'buy', team: 0, unitId: 'hero3', x: 300, y: 600 });
  check('duplicate hero refused (cap)', !dup.ok && dup.reason === 'hero-cap');
  // reach tier 2 -> a 2nd hero (any) is allowed
  game.tier[0] = 2;
  const r2 = game.issueCommand({ type: 'buy', team: 0, unitId: 'hero', x: 300, y: 600 });
  check('2nd hero recruited at tier 2', r2.ok && game.hasHeroType(0, 'hero'), r2.reason || '');
  check('two hero templates present', game.heroTemplates(0).length === 2);
  // a 3rd hero is still tier-locked at tier 2 (needs tier 3)
  const third = game.issueCommand({ type: 'buy', team: 0, unitId: 'hero2', x: 450, y: 600 });
  check('3rd hero tier-locked at tier 2', !third.ok && third.reason === 'tier-locked');
  // reach tier 3 -> the 3rd hero is allowed
  game.tier[0] = 3;
  const r3 = game.issueCommand({ type: 'buy', team: 0, unitId: 'hero2', x: 450, y: 600 });
  check('3rd hero recruited at tier 3', r3.ok && game.heroTemplates(0).length === 3, r3.reason || '');
  // a wave spawns the heroes as live entities (each respawns independently)
  run(game, (CONFIG.FIRST_WAVE_INTERVAL != null ? CONFIG.FIRST_WAVE_INTERVAL : CONFIG.WAVE_INTERVAL) + 0.1);
  check('heroes spawn live', !!game.heroEntityOf(0, 'hero') && !!game.heroEntityOf(0, 'hero3'));
}

// ------------------------------------------------------- Elemental Form ultimate
console.log('beast form ultimate');
{
  const game = new Game(61, { races: ['humans', 'orcs'] });
  game.abilityUsable = () => true;
  const ab = resolvedAbility('beastform');
  const saved = { ...ab.params };
  Object.assign(ab.params, { duration: 4, hpBonus: 100, dmgBonus: 100, splash: 80, splashPct: 50, range: 35, manaCost: 0, cooldown: 40, castPrepare: 0.5, castHold: 0.5 });
  const hero = spawnUnit(game, 0, 'hero', 600, 400);
  hero.hero = true; hero.heroRanks = { beastform: 1 }; hero.mana = 200;
  hero.abilityCd = {}; hero.castState = undefined;
  const baseMax = hero.maxHp;
  const baseDmg = game.ustatOf(hero).damage;
  const stats = { caster: true, autoAttackBetween: true, abilities: ['beastform'] };
  // an enemy in range so the hero is "engaged" and casts the ultimate
  spawnUnit(game, 1, 'grunt', 640, 400);
  // wind-up first: a "prepare" phase precedes the morph (castPrepare > 0)
  game.time += DT; stepCaster(game, hero, stats, DT, true);
  check('beast form: prepare phase before morph', hero.castState === 'prepare' && !hero.morph);
  for (let i = 0; i < 60 && !hero.morph; i++) { game.time += DT; stepCaster(game, hero, stats, DT, true); }
  check('beast form: morph active after cast', !!hero.morph && hero.morphUntil > game.time);
  check('beast form: max HP doubled (+100%)', Math.abs(hero.maxHp - baseMax * 2) <= 1, `${hero.maxHp} vs ${baseMax}`);
  const es = effStats(hero, game.ustatOf(hero));
  check('beast form: becomes melee (no projectile)', es.projectile === false && es.ranged === false);
  check('beast form: damage doubled (+100%)', Math.abs(es.damage - baseDmg * 2) <= 1, `${es.damage} vs ${baseDmg}`);
  check('beast form: carries melee splash', es.morphSplash === 80 && es.morphSplashPct === 0.5);
  // a grounded melee colossus can't reach fliers, even if the base hero could
  check('beast form: cannot target air', effStats({ morph: hero.morph }, { targetsAir: true, damage: 10 }).targetsAir === false);
  run(game, 5); // outlast the 4s duration
  check('beast form: reverts after duration', !hero.morph && hero.morphUntil === 0);
  check('beast form: max HP restored', hero.maxHp === baseMax);
  Object.assign(ab.params, saved);
}

// ------------------------------------------- Sword Saint (Human hero 2) kit
console.log('sword saint kit');
{
  const game = new Game(86, { races: ['humans', 'orcs'] });
  game.abilityUsable = () => true;

  // Divine Buff (passive): faster + stronger attacks
  {
    const hero = spawnUnit(game, 0, 'hero', 400, 400);
    hero.hero = true; hero.heroRanks = { divinebuff: 1 };
    const base = game.ustatOf(hero);
    const es = effStats(hero, base);
    const p = resolvedAbility('divinebuff').params;
    check('divine buff: +damage', Math.abs(es.damage - base.damage * (1 + p.damageBonus / 100)) < 0.01, `${es.damage}`);
    check('divine buff: faster attacks (shorter period)', es.period < base.period);
  }

  // Per-ability rank scaling (rankStep): configurable growth per learned point
  {
    const ab = resolvedAbility('divinebuff');
    const savedStep = ab.params.rankStep;
    const hero = spawnUnit(game, 0, 'hero', 350, 400);
    hero.hero = true; hero.heroRanks = { divinebuff: 3 };
    const b = ab.params.damageBonus;
    ab.params.rankStep = 0.5; // default: rank 3 = 2x
    check('rankStep 0.5: rank 3 doubles', Math.abs(effStats(hero, game.ustatOf(hero)).damage / game.ustatOf(hero).damage - 1 - (b * 2) / 100) < 0.01);
    ab.params.rankStep = 0; // flat: no scaling
    check('rankStep 0: rank 3 = base bonus', Math.abs(effStats(hero, game.ustatOf(hero)).damage / game.ustatOf(hero).damage - 1 - b / 100) < 0.01);
    ab.params.rankStep = savedStep;
  }

  // Explicit per-rank overrides (X1/X2/X3): exact values per learned point
  {
    const ab = resolvedAbility('divineregen');
    const saved = { ...ab.params };
    Object.assign(ab.params, { hps: 70, hps1: 40, hps2: 80, hps3: 140, cooldown: 20, cooldown1: 0, cooldown2: 12, cooldown3: 6 });
    const paramsAt = (rank) => {
      const h = spawnUnit(game, 0, 'hero', 320, 300); h.hero = true; h.heroRanks = { divineregen: rank };
      return learnedAbilityParams(h, 'divineregen');
    };
    check('per-rank hps: exact 40/80/140', paramsAt(1).hps === 40 && paramsAt(2).hps === 80 && paramsAt(3).hps === 140);
    check('per-rank cooldown: 0 keeps base, else exact', paramsAt(1).cooldown === 20 && paramsAt(2).cooldown === 12 && paramsAt(3).cooldown === 6);
    ab.params = saved;
  }

  // Backline Teleport: blinks forward by `distance`
  {
    const ab = resolvedAbility('backlineteleport');
    const saved = { ...ab.params };
    Object.assign(ab.params, { distance: 240, manaCost: 0, cooldown: 5, castPrepare: 0.1, castHold: 0.1 });
    const hero = spawnUnit(game, 0, 'hero', 600, 400);
    hero.hero = true; hero.heroRanks = { backlineteleport: 1 }; hero.mana = 100; hero.abilityCd = {};
    spawnUnit(game, 0, 'grunt', 720, 400); // a FRIENDLY ahead -> hero is behind its front, jumps past it
    spawnUnit(game, 1, 'grunt', 900, 400); // an enemy ahead to justify the blink
    const x0 = hero.x;
    const stats = { caster: true, autoAttackBetween: true, abilities: ['backlineteleport'] };
    for (let i = 0; i < 40 && Math.abs(hero.x - x0) < 1; i++) { game.time += DT; stepCaster(game, hero, stats, DT, true); }
    check('backline teleport: blinked ~240 forward (behind own front)', Math.abs(hero.x - (x0 + 240)) < 1, `${hero.x} vs ${x0}`);
    // no ally ahead -> already out front -> does NOT keep diving forward
    // (placed ahead of every friendly spawned earlier in this shared game)
    const hero3 = spawnUnit(game, 0, 'hero', 1500, 500);
    hero3.hero = true; hero3.heroRanks = { backlineteleport: 1 }; hero3.mana = 100; hero3.abilityCd = {};
    spawnUnit(game, 1, 'grunt', 1800, 500); // enemy present but NO friendly ahead
    const y0 = hero3.x;
    for (let i = 0; i < 40; i++) { game.time += DT; stepCaster(game, hero3, stats, DT, true); }
    check('backline teleport: stays when already out front', Math.abs(hero3.x - y0) < 1, `${hero3.x} vs ${y0}`);
    // low HP -> the blink RETREATS backward instead of engaging forward
    Object.assign(ab.params, { retreatHp: 35 });
    const hero2 = spawnUnit(game, 0, 'hero', 600, 700);
    hero2.hero = true; hero2.heroRanks = { backlineteleport: 1 }; hero2.mana = 100; hero2.abilityCd = {};
    hero2.hp = hero2.maxHp * 0.2; // low HP -> should retreat
    spawnUnit(game, 1, 'grunt', 900, 700);
    const rx0 = hero2.x;
    for (let i = 0; i < 40 && Math.abs(hero2.x - rx0) < 1; i++) { game.time += DT; stepCaster(game, hero2, stats, DT, true); }
    check('backline teleport: retreats backward when low HP', Math.abs(hero2.x - (rx0 - 240)) < 1, `${hero2.x} vs ${rx0}`);
    ab.params = saved;
  }

  // Divine Regeneration: strong self-regen for the duration
  {
    const ab = resolvedAbility('divineregen');
    const saved = { ...ab.params };
    Object.assign(ab.params, { hps: 80, duration: 4, manaCost: 0, cooldown: 10, castPrepare: 0 });
    const hero = spawnUnit(game, 0, 'hero', 300, 400);
    hero.hero = true; hero.heroRanks = { divineregen: 1 }; hero.mana = 100; hero.abilityCd = {};
    hero.hp = hero.maxHp * 0.4;
    const hp0 = hero.hp;
    const stats = { caster: true, autoAttackBetween: true, abilities: ['divineregen'] };
    game.time += DT; stepCaster(game, hero, stats, DT, true); // cast the stance
    check('divine regen: gains a regen effect', hero.effects.some((e) => e.kind === 'regen' && e.until > game.time));
    for (let i = 0; i < 60; i++) { game.time += DT; updateAbilities(game, DT); }
    check('divine regen: healed over the stance', hero.hp > hp0 + 100, `${hero.hp} vs ${hp0}`);
    // above the HP threshold -> does NOT enter the stance
    Object.assign(ab.params, { threshold: 50 });
    const hh = spawnUnit(game, 0, 'hero', 300, 200);
    hh.hero = true; hh.heroRanks = { divineregen: 1 }; hh.mana = 100; hh.abilityCd = {};
    hh.hp = hh.maxHp * 0.8; // above 50% -> should not cast
    for (let i = 0; i < 20; i++) { game.time += DT; stepCaster(game, hh, stats, DT, true); }
    check('divine regen: idle above HP threshold', !(hh.effects || []).some((e) => e.kind === 'regen'));
    ab.params = saved;
  }

  // Vortex of Light: timed AoE + CC immunity
  {
    const ab = resolvedAbility('vortexoflight');
    const saved = { ...ab.params };
    Object.assign(ab.params, { duration: 3, radius: 130, dps: 100, manaCost: 0, cooldown: 40, castPrepare: 0 });
    const hero = spawnUnit(game, 0, 'hero', 500, 500);
    hero.hero = true; hero.heroRanks = { vortexoflight: 1 }; hero.mana = 200; hero.abilityCd = {};
    const near = spawnUnit(game, 1, 'grunt', 560, 500); // inside the radius
    const far = spawnUnit(game, 1, 'grunt', 900, 500);  // outside
    const nearHp = near.hp; const farHp = far.hp;
    const stats = { caster: true, autoAttackBetween: true, abilities: ['vortexoflight'] };
    game.time += DT; stepCaster(game, hero, stats, DT, true);
    check('vortex: active after cast', hero.vortexUntil > game.time);
    // immune to slow/stun while spinning
    hero.effects.push({ kind: 'stun', val: 1, until: game.time + 5 });
    check('vortex: immune to stun', !isStunned(hero, game.time));
    for (let i = 0; i < 30; i++) { game.time += DT; updateAbilities(game, DT); }
    check('vortex: damages nearby enemy', near.hp < nearHp - 50, `${near.hp} vs ${nearHp}`);
    check('vortex: spares distant enemy', far.hp === farHp);
    ab.params = saved;
  }
}

// ---------------------------------- hero ability modes: auto / manual / off
console.log('hero ability auto/manual/off');
{
  const ab = resolvedAbility('vortexoflight');
  const saved = { ...ab.params };
  Object.assign(ab.params, { duration: 3, radius: 130, dps: 100, manaCost: 0, cooldown: 40, castPrepare: 0 });
  const stats = { caster: true, autoAttackBetween: true, abilities: ['vortexoflight'] };
  const mkHero = (game, x, y) => {
    const h = spawnUnit(game, 0, 'hero', x, y);
    h.hero = true; h.heroRanks = { vortexoflight: 1 }; h.mana = 200; h.abilityCd = {};
    return h;
  };

  // command handlers set the right state
  {
    const game = new Game(90, { races: ['humans', 'orcs'] });
    game.issueCommand({ type: 'setAbilityMode', team: 0, unit: 'hero', ability: 'vortexoflight', mode: 'manual' });
    check('mode manual: in abilityManual, not abilityOff',
      game.abilityManual[0].has('hero/vortexoflight') && !game.abilityOff[0].has('hero/vortexoflight'));
    game.issueCommand({ type: 'setAbilityMode', team: 0, unit: 'hero', ability: 'vortexoflight', mode: 'off' });
    check('mode off: in abilityOff, not abilityManual',
      game.abilityOff[0].has('hero/vortexoflight') && !game.abilityManual[0].has('hero/vortexoflight'));
    game.issueCommand({ type: 'setAbilityMode', team: 0, unit: 'hero', ability: 'vortexoflight', mode: 'auto' });
    check('mode auto: in neither set',
      !game.abilityOff[0].has('hero/vortexoflight') && !game.abilityManual[0].has('hero/vortexoflight'));
    // a mode change cancels a pending manual fire
    game.issueCommand({ type: 'setAbilityMode', team: 0, unit: 'hero', ability: 'vortexoflight', mode: 'manual' });
    game.issueCommand({ type: 'castAbilityNow', team: 0, unit: 'hero', ability: 'vortexoflight' });
    check('castAbilityNow queues a request', game.abilityCastReq[0].has('hero/vortexoflight'));
    game.issueCommand({ type: 'setAbilityMode', team: 0, unit: 'hero', ability: 'vortexoflight', mode: 'auto' });
    check('mode change clears the pending request', !game.abilityCastReq[0].has('hero/vortexoflight'));
  }

  // AUTO (default): the hero casts on its own
  {
    const game = new Game(91, { races: ['humans', 'orcs'] });
    const hero = mkHero(game, 500, 500);
    spawnUnit(game, 1, 'grunt', 560, 500);
    game.time += DT; stepCaster(game, hero, stats, DT, true);
    check('auto: casts by itself', hero.vortexUntil > game.time);
  }

  // MANUAL, no request: the hero does NOT cast
  {
    const game = new Game(92, { races: ['humans', 'orcs'] });
    game.abilityManual[0].add('hero/vortexoflight');
    const hero = mkHero(game, 500, 500);
    spawnUnit(game, 1, 'grunt', 560, 500);
    for (let i = 0; i < 20; i++) { game.time += DT; stepCaster(game, hero, stats, DT, true); }
    check('manual: does NOT auto-cast', !(hero.vortexUntil > game.time));
  }

  // MANUAL + request: it fires, ignoring the engage rule (no enemy near)
  {
    const game = new Game(93, { races: ['humans', 'orcs'] });
    game.abilityManual[0].add('hero/vortexoflight');
    game.abilityCastReq[0].add('hero/vortexoflight');
    const hero = mkHero(game, 500, 500); // no enemy -> engaged=false below
    game.time += DT; stepCaster(game, hero, stats, DT, false);
    check('manual: fires on request even when not engaged', hero.vortexUntil > game.time);
  }

  // OFF: never casts, even with a request pending
  {
    const game = new Game(94, { races: ['humans', 'orcs'] });
    game.abilityOff[0].add('hero/vortexoflight');
    game.abilityCastReq[0].add('hero/vortexoflight');
    const hero = mkHero(game, 500, 500);
    spawnUnit(game, 1, 'grunt', 560, 500);
    for (let i = 0; i < 20; i++) { game.time += DT; stepCaster(game, hero, stats, DT, true); }
    check('off: never casts', !(hero.vortexUntil > game.time));
  }

  // one-shot: update() clears the request each tick (press again when ready)
  {
    const game = new Game(95, { races: ['humans', 'orcs'] });
    game.abilityCastReq[0].add('hero/vortexoflight');
    game.update(DT);
    check('request is one-shot (cleared each update)', game.abilityCastReq[0].size === 0);
  }

  // OFF disables a PASSIVE too (Divine Buff / Cleave) — learnedAbilityParams
  // returns null once the ability is in the entity's disabledAbilities set.
  {
    const u = { hero: true, heroRanks: { divinebuff: 1 } };
    check('passive applies while ON', learnedAbilityParams(u, 'divinebuff') != null);
    u.disabledAbilities = new Set(['divinebuff']);
    check('passive stops applying when OFF', learnedAbilityParams(u, 'divinebuff') == null);
  }

  // setAbilityMode('off') syncs onto the live hero so the passive really stops
  {
    const game = new Game(96, { races: ['humans', 'orcs'] });
    const hero = spawnUnit(game, 0, 'hero', 300, 300); hero.hero = true;
    game.templates[0].push({ type: 'hero', hero: true, ranks: { divinebuff: 1 }, x: 300, y: 300 });
    game.issueCommand({ type: 'setAbilityMode', team: 0, unit: 'hero', ability: 'divinebuff', mode: 'off' });
    check('off syncs disabledAbilities onto the live hero', hero.disabledAbilities && hero.disabledAbilities.has('divinebuff'));
    check('live hero passive disabled', learnedAbilityParams(hero, 'divinebuff') == null);
    game.issueCommand({ type: 'setAbilityMode', team: 0, unit: 'hero', ability: 'divinebuff', mode: 'auto' });
    check('auto re-enables the passive', !hero.disabledAbilities.has('divinebuff') && learnedAbilityParams(hero, 'divinebuff') != null);
  }

  ab.params = saved;
}

// ------------------------- manual actives fire ON DEMAND (relaxed targeting)
console.log('manual cast on demand');
{
  // Backline Teleport on manual: fires with NO allies ahead and NO enemies —
  // e.g. right after the hero spawns (auto would refuse; manual obeys the player)
  {
    const ab = resolvedAbility('backlineteleport');
    const saved = { ...ab.params };
    Object.assign(ab.params, { distance: 240, manaCost: 0, cooldown: 5, castPrepare: 0.1, castHold: 0.1, retreatHp: 35 });
    const game = new Game(97, { races: ['humans', 'orcs'] });
    game.abilityManual[0].add('hero/backlineteleport');
    game.abilityCastReq[0].add('hero/backlineteleport');
    const hero = spawnUnit(game, 0, 'hero', 600, 400);
    hero.hero = true; hero.heroRanks = { backlineteleport: 1 }; hero.mana = 100; hero.abilityCd = {};
    const x0 = hero.x;
    const stats = { caster: true, autoAttackBetween: true, abilities: ['backlineteleport'] };
    for (let i = 0; i < 40 && Math.abs(hero.x - x0) < 1; i++) { game.time += DT; stepCaster(game, hero, stats, DT, false); }
    check('manual: teleport fires with no allies/enemies (on demand)', Math.abs(hero.x - x0) > 100, `${hero.x} vs ${x0}`);
    ab.params = saved;
  }
  // Divine Regen on manual: fires even at FULL HP (auto needs to be under 50%)
  {
    const ab = resolvedAbility('divineregen');
    const saved = { ...ab.params };
    Object.assign(ab.params, { hps: 80, duration: 4, manaCost: 0, cooldown: 10, castPrepare: 0, threshold: 50 });
    const game = new Game(98, { races: ['humans', 'orcs'] });
    game.abilityManual[0].add('hero/divineregen');
    game.abilityCastReq[0].add('hero/divineregen');
    const hero = spawnUnit(game, 0, 'hero', 300, 400);
    hero.hero = true; hero.heroRanks = { divineregen: 1 }; hero.mana = 100; hero.abilityCd = {};
    hero.hp = hero.maxHp; // FULL HP -> auto would NOT enter the stance
    const stats = { caster: true, autoAttackBetween: true, abilities: ['divineregen'] };
    game.time += DT; stepCaster(game, hero, stats, DT, false);
    check('manual: divine regen fires at full HP', hero.effects.some((e) => e.kind === 'regen' && e.until > game.time));
    ab.params = saved;
  }
}

// ------------------------------------------- regen aura max-targets cap
console.log('regen aura target cap');
{
  const game = new Game(71, { races: ['humans', 'orcs'] });
  const ab = resolvedAbility('regenaura');
  const saved = { ...ab.params };
  Object.assign(ab.params, { radius: 300, hps: 20, duration: 5, maxTargets: 2, manaCost: 0 });
  const caster = spawnUnit(game, 0, 'grunt', 600, 400);
  caster.auraUntil = { regenaura: game.time + 5 }; // aura already raised
  // make the caster count as a regenaura caster for updateAbilities
  const baseUstat = game.ustatOf.bind(game);
  game.ustatOf = (u) => (u === caster ? { ...baseUstat(u), caster: true, abilities: ['regenaura'] } : baseUstat(u));
  // three wounded allies (different HP) + one full-HP ally, all in range
  const a1 = spawnUnit(game, 0, 'grunt', 620, 400); a1.hp = a1.maxHp * 0.2; // most wounded
  const a2 = spawnUnit(game, 0, 'grunt', 640, 400); a2.hp = a2.maxHp * 0.4; // 2nd
  const a3 = spawnUnit(game, 0, 'grunt', 660, 400); a3.hp = a3.maxHp * 0.6; // 3rd — capped out
  const h1 = a1.hp, h2 = a2.hp, h3 = a3.hp;
  run(game, 1);
  check('regen cap: most-wounded ally healed', a1.hp > h1 + 1);
  check('regen cap: 2nd most-wounded healed', a2.hp > h2 + 1);
  check('regen cap: 3rd ally NOT healed (over cap)', Math.abs(a3.hp - h3) < 0.001, `${a3.hp} vs ${h3}`);
  ab.params = saved;
}

// ------------------------------------------------ Totemic Shaman mechanics
console.log('empower (support attack)');
{
  const game = new Game(81, { races: ['humans', 'orcs'] });
  game.abilityUsable = () => true;
  const ab = resolvedAbility('empower');
  const saved = { ...ab.params };
  Object.assign(ab.params, { range: 200, haste: 30, dmgReduce: 25, duration: 4, manaCost: 0, cooldown: 2 });
  const caster = spawnUnit(game, 0, 'grunt', 500, 400);
  caster.mana = 100; caster.abilityCd = {}; caster.castState = undefined;
  const ally = spawnUnit(game, 0, 'grunt', 560, 400);
  // empower fires once the fight is near (combatNear) even if the caster itself
  // isn't in an enemy's range -> put an enemy close by, pass engaged=false
  spawnUnit(game, 1, 'grunt', 720, 400);
  const stats = { caster: true, autoAttackBetween: true, abilities: ['empower'] };
  const hasK = (u, k) => u.effects && u.effects.some((e) => e.kind === k && e.until > game.time);
  for (let i = 0; i < 40 && !hasK(ally, 'haste'); i++) { game.time += DT; stepCaster(game, caster, stats, DT, false); }
  check('empower: fires when fight is near (not self-engaged)', hasK(ally, 'haste'));
  check('empower: ally gains damage reduction', hasK(ally, 'dmgReduce'));
  check('empower: caster does not buff itself', !hasK(caster, 'haste'));
  // negative: with NO fight anywhere near, the backline shaman stays idle
  {
    const g2 = new Game(83, { races: ['humans', 'orcs'] });
    g2.abilityUsable = () => true;
    const c2 = spawnUnit(g2, 0, 'grunt', 500, 400); c2.mana = 100; c2.abilityCd = {}; c2.castState = undefined;
    const al2 = spawnUnit(g2, 0, 'grunt', 560, 400);
    for (let i = 0; i < 20; i++) { g2.time += DT; stepCaster(g2, c2, stats, DT, false); }
    check('empower: idle when no fight is near', !(al2.effects && al2.effects.some((e) => e.kind === 'haste')));
  }
  ab.params = saved;
}

// ------------------------------- summon per-rank hp/damage + air-only targeting
console.log('summon per-rank + targeting');
{
  const game = new Game(85, { races: ['orcs', 'humans'] });
  const wolf = resolvedAbility('summonwolf');
  const saved = { ...wolf.params };
  Object.assign(wolf.params, { hp: 100, damage: 10, hpPerRank: 50, damagePerRank: 5, life: 0, targetsAir: 0, targetsGround: 1 });
  const caster = spawnUnit(game, 0, 'grunt', 400, 400);
  const w1 = spawnSummon(game, caster, wolf, wolf.params, 1);
  check('summon rank 1: base hp/damage', w1.maxHp === 100 && w1.summonStats.damage === 10, `${w1.maxHp}/${w1.summonStats.damage}`);
  const w3 = spawnSummon(game, caster, wolf, wolf.params, 3);
  check('summon rank 3: +per-rank hp/damage', w3.maxHp === 200 && w3.summonStats.damage === 20, `${w3.maxHp}/${w3.summonStats.damage}`);
  // ground-only by default, air-only when set
  check('summon default: ground not air', w1.summonStats.targetsGround === true && w1.summonStats.targetsAir === false);
  Object.assign(wolf.params, { targetsAir: 1, targetsGround: 0 });
  const wa = spawnSummon(game, caster, wolf, wolf.params, 1);
  check('summon air-only: air not ground', wa.summonStats.targetsAir === true && wa.summonStats.targetsGround === false);
  wolf.params = saved;
}

// ------------------------------------- Slowing Totem unlock upgrade
console.log('slowing totem unlock upgrade');
{
  const game = new Game(84, { races: ['orcs', 'humans'] });
  // Slowing Totem is locked until its unlock upgrade is bought; Empower is free
  check('totem locked without upgrade', !game.abilityUsable(0, 'dasher', 'slowingtotem'));
  check('empower not gated by the upgrade', game.abilityUsable(0, 'dasher', 'empower'));
  game.upgrades[0].add('totemtraining');
  check('totem usable after buying the upgrade', game.abilityUsable(0, 'dasher', 'slowingtotem'));
  game.upgradeOff[0].add('totemtraining'); // toggled off -> re-locked
  check('totem re-locked when upgrade toggled off', !game.abilityUsable(0, 'dasher', 'slowingtotem'));
}

// ------------------------------------- Frost Bolt unlock upgrade
console.log('frost bolt unlock upgrade');
{
  // the Priest (bruiser) carries frostbolt by default
  const game = new Game(88, { races: ['humans', 'orcs'] });
  check('frost bolt locked without the unlock', !game.abilityUsable(0, 'bruiser', 'frostbolt'));
  game.upgrades[0].add('frosttraining');
  check('frost bolt usable after buying the unlock', game.abilityUsable(0, 'bruiser', 'frostbolt'));
  game.upgradeOff[0].add('frosttraining'); // toggled off -> re-locked
  check('frost bolt re-locked when unlock toggled off', !game.abilityUsable(0, 'bruiser', 'frostbolt'));
}

// ------------------------------------- empower: skip non-attackers & no double-buff
console.log('empower target selection');
{
  const ab = resolvedAbility('empower');
  const saved = { ...ab.params };
  Object.assign(ab.params, { range: 400, haste: 30, dmgReduce: 25, duration: 4, manaCost: 0, cooldown: 2 });
  const stats = { caster: true, autoAttackBetween: true, abilities: ['empower'] };
  const hasK = (u, k) => u.effects && u.effects.some((e) => e.kind === k && e.until > game_.time);
  let game_;

  // a non-attacking ally (another shaman) further forward is SKIPPED for a real fighter
  {
    game_ = new Game(85, { races: ['orcs', 'humans'] });
    game_.abilityUsable = () => true;
    const caster = spawnUnit(game_, 0, 'grunt', 500, 400); caster.mana = 100; caster.abilityCd = {};
    const shamanAlly = spawnUnit(game_, 0, 'grunt', 600, 400); // furthest forward, but can't attack
    const fighter = spawnUnit(game_, 0, 'grunt', 560, 400);
    const base = game_.ustatOf.bind(game_);
    game_.ustatOf = (u) => (u === shamanAlly ? { ...base(u), caster: true, autoAttackBetween: false } : base(u));
    spawnUnit(game_, 1, 'grunt', 720, 400); // enemy near
    for (let i = 0; i < 40 && !hasK(fighter, 'haste') && !hasK(shamanAlly, 'haste'); i++) { game_.time += DT; stepCaster(game_, caster, stats, DT, false); }
    check('empower: buffs a fighter, not a non-attacking shaman', hasK(fighter, 'haste') && !hasK(shamanAlly, 'haste'));
  }

  // a second shaman does not pick an ally already claimed by another's channel
  {
    game_ = new Game(86, { races: ['orcs', 'humans'] });
    game_.abilityUsable = () => true;
    const c1 = spawnUnit(game_, 0, 'grunt', 480, 400);
    const c2 = spawnUnit(game_, 0, 'grunt', 500, 400); c2.mana = 100; c2.abilityCd = {};
    const allyA = spawnUnit(game_, 0, 'grunt', 600, 400); // furthest forward -> c1's pick
    const allyB = spawnUnit(game_, 0, 'grunt', 560, 400);
    spawnUnit(game_, 1, 'grunt', 720, 400);
    c1.empowerUntil = game_.time + 5; c1.empowerTargetId = allyA.id; // c1 already channels allyA
    for (let i = 0; i < 40 && !hasK(allyB, 'haste'); i++) { game_.time += DT; stepCaster(game_, c2, stats, DT, false); }
    check('empower: 2nd shaman skips the ally already claimed', hasK(allyB, 'haste') && !hasK(allyA, 'haste'));
  }
  ab.params = saved;
}

// ------------------------------------------- empower channel (drain + lock)
console.log('empower channel');
{
  const game = new Game(82, { races: ['humans', 'orcs'] });
  const ab = resolvedAbility('empower');
  const saved = { ...ab.params };
  // long duration so MANA is what ends the channel in the second phase
  Object.assign(ab.params, { range: 400, haste: 30, dmgReduce: 25, duration: 100, manaPerSec: 5 });
  const caster = spawnUnit(game, 0, 'grunt', 500, 400);
  caster.mana = 30; caster.manaMax = 200;
  const ally = spawnUnit(game, 0, 'grunt', 560, 400);
  const hasK = (u, k) => u.effects && u.effects.some((e) => e.kind === k && e.until > game.time);
  // start the channel locked on the ally
  caster.empowerUntil = game.time + 100; caster.empowerTargetId = ally.id;
  for (let i = 0; i < Math.round(2 / DT); i++) { game.time += DT; updateAbilities(game, DT); }
  check('empower channel: still committed to the same ally', caster.empowerUntil > game.time && caster.empowerTargetId === ally.id);
  check('empower channel: ally stays buffed', hasK(ally, 'haste') && hasK(ally, 'dmgReduce'));
  check('empower channel: drains ~5 mana/s', Math.abs(caster.mana - 20) < 1.5, `${caster.mana}`);
  // keep ticking: mana (30) drains 5/s -> empty at ~6s -> channel ends
  for (let i = 0; i < Math.round(5 / DT); i++) { game.time += DT; updateAbilities(game, DT); }
  check('empower channel: ends when mana runs out', caster.mana <= 0 && caster.empowerUntil === 0);
  check('empower channel: buff fades after the channel', !hasK(ally, 'haste'));
  ab.params = saved;
}

console.log('slowing totem');
{
  const game = new Game(82, { races: ['humans', 'orcs'] });
  game.abilityUsable = () => true;
  const ab = resolvedAbility('slowingtotem');
  const saved = { ...ab.params };
  Object.assign(ab.params, { cap: 1, life: 3, hp: 100, radius: 250, atkSlow: 40, moveSlow: 40, manaCost: 0, cooldown: 12 });
  const caster = spawnUnit(game, 0, 'grunt', 500, 400);
  caster.mana = 100; caster.abilityCd = {}; caster.castState = undefined;
  const enemy = spawnUnit(game, 1, 'grunt', 560, 400);
  const stats = { caster: true, autoAttackBetween: true, abilities: ['slowingtotem'] };
  let totem = null;
  for (let i = 0; i < 40 && !totem; i++) { game.time += DT; stepCaster(game, caster, stats, DT, true); totem = game.entities.find((e) => e.totem && e.hp > 0); }
  check('totem: planted with HP', !!totem && totem.hp === 100 && totem.totem === true);
  check('totem: has a lifetime timer', totem && totem.despawnAt != null && totem.maxLife === 3);
  const tx = totem.x, ty = totem.y;
  run(game, 0.5);
  check('totem: stays put (stationary)', Math.abs(totem.x - tx) < 0.01 && Math.abs(totem.y - ty) < 0.01);
  check('totem: slows nearby enemy', enemy.effects && enemy.effects.some((e) => e.kind === 'atkslow' && e.until > game.time));
  run(game, 3.2);
  check('totem: despawns after its lifetime', totem.hp <= 0);
  ab.params = saved;
}

// -------------------------------------------------- walls block, towers shoot
console.log('defense structures');
{
  // A wall in the enemy's path: the grunt must stop and hit it, not pass.
  const game = new Game(9);
  game.money[0] = 1000;
  game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: 750, y: MID_Y });
  const wall = game.structures.find((s) => s.kind === 'wall');
  const g = spawnUnit(game, 1, 'grunt', 980, MID_Y);
  run(game, 8);
  check('grunt does not pass the wall', g.x > 720, `grunt.x=${Math.round(g.x)}`);
  check('grunt attacks the wall', wall.hp < wall.maxHp);

  // A tower kills a lone passer-by.
  const game2 = new Game(10);
  game2.money[0] = 1000;
  game2.issueCommand({ type: 'build', team: 0, kind: 'tower', x: 750, y: 400 });
  const passer = spawnUnit(game2, 1, 'grunt', 980, 400);
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
  // Full "classic" generic roster (per-race defaults are now distinct real
  // units, so pin explicit stats here to test the counter MECHANICS in isolation).
  const b = (o) => ({ building: '', caster: false, splash: 0, isAir: false, targetsAir: false, targetsGround: true, heal: false, ranged: false, ...o });
  const roster = {
    grunt:   b({ tier: 1, cost: 50, hp: 90, damage: 10, period: 0.8, range: 25, speed: 90, armor: 'light', dmgType: 'normal' }),
    slinger: b({ tier: 1, cost: 75, hp: 60, damage: 9, period: 0.9, range: 180, speed: 70, armor: 'light', dmgType: 'normal', ranged: true, targetsAir: true }),
    dasher:  b({ tier: 1, cost: 100, hp: 70, damage: 14, period: 0.7, range: 25, speed: 150, armor: 'light', dmgType: 'normal' }),
    lancer:  b({ tier: 2, cost: 175, hp: 110, damage: 45, period: 1.5, range: 200, speed: 65, armor: 'light', dmgType: 'piercing', ranged: true }),
    bruiser: b({ tier: 2, cost: 200, hp: 400, damage: 20, period: 1.2, range: 30, speed: 55, armor: 'armored', dmgType: 'normal' }),
    crab:    b({ tier: 3, cost: 300, hp: 250, damage: 40, period: 2.5, range: 320, speed: 40, armor: 'armored', dmgType: 'explosive', ranged: true, splash: 60, projSpeed: 300 }),
    wasp:    b({ tier: 2, cost: 150, hp: 100, damage: 12, period: 0.8, range: 150, speed: 110, armor: 'armored', dmgType: 'normal', ranged: true, isAir: true, targetsAir: true }),
    archon:  b({ tier: 3, cost: 250, hp: 150, damage: 24, period: 1.0, range: 220, speed: 60, armor: 'light', dmgType: 'piercing', ranged: true, targetsAir: true }),
    mender:  b({ tier: 2, cost: 150, hp: 80, damage: 15, period: 1.0, range: 140, speed: 60, armor: 'light', dmgType: 'normal', heal: true }),
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
    game.upgrades[0].add('frosttraining'); // Frost Bolt is unlock-gated now
    spawnUnit(game, 0, 'slinger', 600, 300);
    const runner = spawnUnit(game, 1, 'grunt', 700, 300);
    runner.hp = runner.maxHp = 100000;
    run(game, 3);
    const slowed = runner.effects && runner.effects.some((e) => e.kind === 'moveslow' && e.until > game.time);
    check('frost bolt applies a movement slow', !!slowed, JSON.stringify(runner.effects));
  }

  // ---------------------------------------- Battle Mage (Human hero 3) kit
  // NOTE: applyBalance() rebuilds ability params from defaults, so it MUST run
  // BEFORE we Object.assign per-test overrides onto the resolved ability.
  // Bigger Frost Bolt: bursts for area damage + area slow on everyone caught
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['bigfrostbolt'] } } } } });
    const ab = resolvedAbility('bigfrostbolt'); const saved = { ...ab.params };
    Object.assign(ab.params, { range: 340, damage: 50, radius: 130, moveSlow: 40, duration: 3, manaCost: 0, cooldown: 2, projectileSpeed: 600, castPrepare: 0, tier: 1 });
    const game = new Game(20, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'slinger', 600, 400); caster.hp = caster.maxHp = 100000;
    const e1 = spawnUnit(game, 1, 'grunt', 720, 400); e1.hp = e1.maxHp = 100000;
    const e2 = spawnUnit(game, 1, 'grunt', 780, 400); e2.hp = e2.maxHp = 100000; // inside e1's 130 burst
    run(game, 3);
    check('bigger frost bolt: AoE slow hits both', (e1.effects || []).some((x) => x.kind === 'moveslow') && (e2.effects || []).some((x) => x.kind === 'moveslow'));
    check('bigger frost bolt: AoE damage hits both', e1.hp < 100000 && e2.hp < 100000, `${e1.hp} ${e2.hp}`);
    ab.params = saved;
  }
  // Water Elemental: a melee summon whose HP/damage grow per rank
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['waterelemental'] } } } } });
    const ab = resolvedAbility('waterelemental'); const saved = { ...ab.params };
    Object.assign(ab.params, { hp: 200, damage: 20, hpPerRank: 100, damagePerRank: 10, cap: 1, life: 20, manaCost: 0, cooldown: 5, castPrepare: 0, tier: 1, targetsGround: 1 });
    const game = new Game(21, { races: ['humans', 'orcs'] });
    // a "hero" caster so per-rank applies; heroAbilities feeds ustatOf's ability list
    const caster = spawnUnit(game, 0, 'slinger', 600, 400); caster.hp = caster.maxHp = 100000;
    caster.hero = true; caster.heroAbilities = ['waterelemental']; caster.heroRanks = { waterelemental: 2 };
    spawnUnit(game, 1, 'grunt', 660, 400); // an enemy in range so the summon fires
    run(game, 2);
    const elem = game.entities.find((e) => e.summon && e.summonKind === 'waterelemental');
    check('water elemental: summoned', !!elem);
    check('water elemental: rank-2 HP = base+perRank (200+100)', elem && elem.maxHp === 300, elem && `${elem.maxHp}`);
    ab.params = saved;
  }
  // Mana Regen Aura (PASSIVE): nearby allies regenerate extra mana, always on
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['manaaura'], mana: 100, manaRegen: 0 } } } } });
    const ab = resolvedAbility('manaaura'); const saved = { ...ab.params };
    Object.assign(ab.params, { radius: 300, manaGain1: 30, tier: 1 }); // rank-1 value
    const game = new Game(22, { races: ['humans', 'orcs'] });
    // she's a hero with the passive learned; the aura applies while she lives
    const caster = spawnUnit(game, 0, 'slinger', 600, 400); caster.mana = caster.manaMax = 100;
    caster.hero = true; caster.heroRanks = { manaaura: 1 };
    const ally = spawnUnit(game, 0, 'slinger', 640, 400); ally.mana = 0; ally.manaMax = 100; // low mana, in range
    run(game, 1);
    check('mana aura (passive): nearby ally regenerates mana', ally.mana > 10, `${ally.mana}`);
    ab.params = saved;
  }
  // Blizzard (ult): a frost storm zone that damages AND slows enemies in it
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, abilities: ['blizzard'], mana: 200 } } } } });
    const ab = resolvedAbility('blizzard'); const saved = { ...ab.params };
    Object.assign(ab.params, { radius: 160, dps: 100, moveSlow: 45, duration: 3, range: 500, manaCost: 0, cooldown: 40, castPrepare: 0, tier: 1 });
    const game = new Game(23, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'slinger', 500, 400); caster.mana = caster.manaMax = 200;
    const near = spawnUnit(game, 1, 'grunt', 560, 400); near.hp = near.maxHp = 100000;
    run(game, 2);
    check('blizzard: damages enemy in the storm', near.hp < 100000, `${near.hp}`);
    check('blizzard: slows enemy in the storm', (near.effects || []).some((x) => x.kind === 'moveslow'));
    ab.params = saved;
  }

  // ---------------------------------------- Spirit Huntress (Orc hero 3) kit
  // Poison Arrow is now a PASSIVE: while she has mana, every arrow spends
  // manaPerShot and lands a poison (acid) DoT; out of mana -> plain arrows.
  {
    applyBalance();
    const ab = resolvedAbility('poisonarrow'); const saved = { ...ab.params };
    Object.assign(ab.params, { dps: 20, dps1: 0, dps2: 0, dps3: 0, dotDuration: 3, manaPerShot: 6, tier: 1 });
    const game = new Game(30, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'slinger', 600, 400);
    caster.hero = true; caster.heroRanks = { poisonarrow: 1 }; caster.mana = 100;
    const enemy = spawnUnit(game, 1, 'grunt', 700, 400); enemy.hp = enemy.maxHp = 100000;
    run(game, 2);
    check('poison arrow: target gains a poison (acid) DoT', (enemy.effects || []).some((x) => x.kind === 'acid'), JSON.stringify(enemy.effects));
    check('poison arrow: passive spends mana per shot', caster.mana < 100, `${caster.mana}`);
    // out of mana -> arrows go back to plain (no new poison applied)
    caster.mana = 0;
    const enemy2 = spawnUnit(game, 1, 'grunt', 640, 400); enemy2.hp = enemy2.maxHp = 100000;
    run(game, 2);
    check('poison arrow: no mana -> plain arrows (no poison)', !(enemy2.effects || []).some((x) => x.kind === 'acid'), JSON.stringify(enemy2.effects));
    ab.params = saved;
  }
  // Poison Arrow vs a building: no poison (structures can't be poisoned) and no
  // mana is spent on the shot.
  {
    applyBalance();
    const ab = resolvedAbility('poisonarrow'); const saved = { ...ab.params };
    Object.assign(ab.params, { dps: 20, dps1: 0, dps2: 0, dps3: 0, dotDuration: 3, manaPerShot: 6, tier: 1 });
    const game = new Game(30, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'slinger', 600, 400);
    caster.hero = true; caster.heroRanks = { poisonarrow: 1 }; caster.mana = 100;
    const bld = spawnUnit(game, 1, 'grunt', 700, 400); bld.hp = bld.maxHp = 100000; bld.isStructure = true;
    run(game, 2);
    check('poison arrow: no poison on a building', !(bld.effects || []).some((x) => x.kind === 'acid'), JSON.stringify(bld.effects));
    check('poison arrow: no mana spent shooting a building', caster.mana === 100, `${caster.mana}`);
    ab.params = saved;
  }
  // Life Drain: channel damages the target and heals her
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, autoAttackBetween: true, abilities: ['lifedrain'], mana: 100 } } } } });
    const ab = resolvedAbility('lifedrain'); const saved = { ...ab.params };
    Object.assign(ab.params, { range: 300, duration: 2, drainPerSec: 50, healPerSec: 40, manaPerSec: 0, manaCost: 0, cooldown: 10, castPrepare: 0, tier: 1 });
    const game = new Game(31, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'slinger', 600, 400); caster.mana = 100; caster.hp = 100; caster.maxHp = 100000;
    const enemy = spawnUnit(game, 1, 'grunt', 850, 400); enemy.hp = enemy.maxHp = 100000; // in drain range, out of melee reach
    run(game, 1);
    check('life drain: damages the target', enemy.hp < 100000, `${enemy.hp}`);
    check('life drain: heals the caster', caster.hp > 100, `${caster.hp}`);
    ab.params = saved;
  }
  // Rise Dead: raises a skeleton FROM a nearby corpse (consuming it)
  {
    // a death leaves a raisable corpse
    {
      const ab0 = resolvedAbility('risedead'); const s0 = { ...ab0.params }; Object.assign(ab0.params, { corpseLife: 10 });
      const g0 = new Game(33, { races: ['humans', 'orcs'] });
      const v = spawnUnit(g0, 1, 'grunt', 700, 400); v.hp = 0; // dead this tick
      g0.update(1 / 30);
      check('death leaves a raisable corpse', g0.corpses.length >= 1, `${g0.corpses.length}`);
      // the corpse only becomes raisable AFTER the death animation (readyAt > now)
      check('corpse not raisable until the death animation finishes', g0.corpses[0].readyAt > g0.time, `${g0.corpses[0].readyAt} vs ${g0.time}`);
      ab0.params = s0;
    }
    applyBalance({ races: { humans: { units: { slinger: { caster: true, autoAttackBetween: true, abilities: ['risedead'], mana: 100 } } } } });
    const ab = resolvedAbility('risedead'); const saved = { ...ab.params };
    Object.assign(ab.params, { corpseRange: 400, corpseLife: 20, cap: 3, life: 15, hp: 120, damage: 16, manaCost: 0, cooldown: 3, castPrepare: 0, tier: 1, targetsGround: 1 });
    const game = new Game(32, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'slinger', 600, 400); caster.mana = 100;
    game.corpses.push({ x: 850, y: 400, until: game.time + 20 }); // a corpse to raise
    run(game, 1);
    const skel = game.entities.find((e) => e.summon && e.summonKind === 'skeleton');
    check('rise dead: raised a skeleton', !!skel);
    // raised AT the corpse (~850, then it marches right) — not spawned beside her (~580)
    check('rise dead: skeleton rose from the corpse (not beside her)', skel && skel.x > 750, skel && `${skel.x}`);
    ab.params = saved;
  }
  // Grave Digger (Undead unit 3): digs corpses when an enemy is near; flees with the upgrade
  {
    applyBalance();
    const ab = resolvedAbility('risedead'); const saved = { ...ab.params };
    Object.assign(ab.params, { corpseLife: 20, corpseBigLife: 20 });
    // enemy nearby -> it digs corpses
    const g1 = new Game(41, { races: ['undead', 'orcs'] });
    const d1 = spawnUnit(g1, 0, 'dasher', 600, 400); d1.hp = d1.maxHp = 100000; // survive being hit
    const e1 = spawnUnit(g1, 1, 'grunt', 750, 400); e1.hp = e1.maxHp = 100000;
    run(g1, 10);
    check('grave digger: digs corpses when an enemy is near', g1.corpses.length >= 1, `${g1.corpses.length}`);
    // no enemy -> nothing dug
    const g2 = new Game(42, { races: ['undead', 'orcs'] });
    const d2 = spawnUnit(g2, 0, 'dasher', 300, 400); d2.hp = d2.maxHp = 100000;
    run(g2, 6);
    check('grave digger: no enemy -> no corpses', g2.corpses.length === 0, `${g2.corpses.length}`);
    // flee upgrade: runs from a close enemy
    const g3 = new Game(43, { races: ['undead', 'orcs'] });
    g3.upgrades[0].add('gravedigflee');
    const d3 = spawnUnit(g3, 0, 'dasher', 600, 400); d3.hp = d3.maxHp = 100000;
    const e3 = spawnUnit(g3, 1, 'grunt', 665, 400); e3.hp = e3.maxHp = 100000;
    run(g3, 2);
    check('grave digger: flees from a close enemy (with upgrade)', d3.x < 590, `${d3.x}`);
    ab.params = saved;
  }
  // Soul Harvest (ult): drains enemies (feeding her) AND heals allies, dual zones
  {
    applyBalance({ races: { humans: { units: { slinger: { caster: true, autoAttackBetween: true, abilities: ['soulharvest'], mana: 200 } } } } });
    const ab = resolvedAbility('soulharvest'); const saved = { ...ab.params };
    Object.assign(ab.params, { duration: 3, size: 160, drainRadius: 250, drainDps: 60, healRadius: 250, healHps: 40, manaCost: 0, cooldown: 70, castPrepare: 0, tier: 1 });
    const game = new Game(34, { races: ['humans', 'orcs'] });
    const caster = spawnUnit(game, 0, 'slinger', 600, 400); caster.mana = 200; caster.hp = 100; caster.maxHp = 100000;
    const enemy = spawnUnit(game, 1, 'grunt', 660, 400); enemy.hp = enemy.maxHp = 100000;
    const ally = spawnUnit(game, 0, 'grunt', 640, 400); ally.hp = 50; ally.maxHp = 100000;
    run(game, 1);
    check('soul harvest: drains the enemy', enemy.hp < 100000, `${enemy.hp}`);
    check('soul harvest: the drain heals her', caster.hp > 100, `${caster.hp}`);
    check('soul harvest: heals an ally in the heal zone', ally.hp > 50, `${ally.hp}`);
    ab.params = saved;
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
    game.upgrades[0].add('frosttraining'); // Frost Bolt is unlock-gated now
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
    game.upgrades[0].add('frosttraining'); // Frost Bolt is unlock-gated now
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
    spawnUnit(game, 0, 'slinger', 1600, 300);
    const a = spawnUnit(game, 1, 'grunt', 1700, 300);
    const c2 = spawnUnit(game, 1, 'grunt', 1740, 300);
    const c3 = spawnUnit(game, 1, 'grunt', 1780, 300);
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
    game.tier[1] = 3; // crab is tier 3 — the upgrade is gated behind the unit's tier
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
    // combat distance is BOX-EDGE gap now: the center-to-center distance at
    // dismount = dmRange + both bodies' extents (+ dash overshoot), not <80
    check('rider dismounts NEXT TO the enemy (on-foot range, not mounted)',
      dismountDist !== null && dismountDist < 130, `dist=${Math.round(dismountDist ?? -1)}`);
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
    game.tier[1] = 3; // crab is tier 3
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
    applyBalance({ races: { humans: { units: { grunt: { cw: 2, ch: 2, building: '' } } } } });
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
    game.upgrades[0].add('frosttraining'); // Frost Bolt is unlock-gated now
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
    game.upgrades[0].add('frosttraining'); // Frost Bolt is unlock-gated now
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
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['heal'], mana: 100, manaRegen: 0, isAir: false } } } } });
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
    // mines build only on their predefined plots
    const [p1, p2] = game.mineSpots[0];
    const b1 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: p1.x, y: p1.y });
    const b2 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: p2.x, y: p2.y });
    check('first generator builds', b1.ok);
    check('second generator blocked by build cooldown', !b2.ok && b2.reason === 'cooldown');
    run(game, 10.1);
    const b3 = game.issueCommand({ type: 'build', team: 0, kind: 'generator', x: p2.x, y: p2.y });
    check('cooldown over -> generator builds again', b3.ok, JSON.stringify(b3));
    // walls are unaffected (no buildCd on them) — placed on the front columns,
    // which mine plots never occupy
    const zone = CONFIG.CONSTRUCTION_ZONE[0];
    const wx = zone.x1 - CONFIG.GRID / 2;
    const w = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: wx, y: 200 });
    const w2 = game.issueCommand({ type: 'build', team: 0, kind: 'wall', x: wx, y: 300 });
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
    // income now accrues smoothly (a tiny fraction per tick), so allow for it
    const gained = game.money[0] - before;
    check('destroying the enemy turret pays its bounty', gained >= 250 && gained < 251, `money=${game.money[0]}`);
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
    game.templates[1].push({ type: 'mender', x: zone.x0 + 10, y: 300 }); // artillery (Orc catapult) on the front edge
    const ai = new AIController(1, 'normal', 7);
    for (let i = 0; i < 9; i++) ai.update(game, 1);
    const crab = game.templates[1][0];
    check('AI moves misplaced artillery toward the back band',
      crab.x > zone.x0 + (zone.x1 - zone.x0) * 0.45, `x=${Math.round(crab.x)}`);
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
    game.tier[1] = 2; // wasp is tier 2 — the upgrade is gated behind the unit's tier
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
    gd.tier[1] = 2;
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
    ga.tier[1] = 2;
    ga.issueCommand({ type: 'buyUpgrade', team: 1, id: 'splitmount' });
    const riderA = spawnUnit(ga, 1, 'wasp', 900, 400);
    spawnUnit(ga, 0, 'grunt', 780, 400); // flying enemy
    run(ga, 1);
    check('split: an AIR enemy does not trigger the dive/split',
      riderA.dismounted === false && ga.entities.every((e) => !e.beast));

    // no enemy nearby -> stays whole; toggled off -> never splits
    applyBalance({ upgrades: { splitmount: { race: 'orcs', unit: 'wasp', params: P } } });
    const g2 = new Game(12, { races: ['humans', 'orcs'] });
    g2.tier[1] = 2;
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

  // Rectangular (2x1) units keep their formation: placed flush on the grid they
  // don't shove each other on spawn; when they DO overlap they part along the
  // SHORT axis, not the long one.
  {
    applyBalance({ races: { humans: { units: { grunt: { cw: 2, ch: 1, speed: 0 } } } } });
    // two 2x1 units stacked one cell apart (hh=20 each -> flush, no overlap)
    const game = new Game(15, { races: ['humans', 'orcs'] });
    const a = spawnUnit(game, 0, 'grunt', 600, 400);
    const b = spawnUnit(game, 0, 'grunt', 600, 440); // exactly one 40px cell below
    const ax0 = a.x, ay0 = a.y, bx0 = b.x, by0 = b.y;
    run(game, 1);
    check('2x1 units placed flush stay put (no self-shoving)',
      Math.abs(a.x - ax0) < 0.5 && Math.abs(a.y - ay0) < 0.5 &&
      Math.abs(b.x - bx0) < 0.5 && Math.abs(b.y - by0) < 0.5,
      `a moved (${(a.x - ax0).toFixed(1)},${(a.y - ay0).toFixed(1)}) b (${(b.x - bx0).toFixed(1)},${(b.y - by0).toFixed(1)})`);

    // overlapping vertically -> they separate on Y, and barely on X (short axis)
    const g2 = new Game(15, { races: ['humans', 'orcs'] });
    const c = spawnUnit(g2, 0, 'grunt', 600, 400);
    const d = spawnUnit(g2, 0, 'grunt', 604, 415); // heavy vertical overlap, tiny x offset
    run(g2, 2);
    check('overlapping 2x1 units part along the SHORT (vertical) axis',
      Math.abs(d.y - c.y) > Math.abs(d.x - c.x),
      `dx=${(d.x - c.x).toFixed(1)} dy=${(d.y - c.y).toFixed(1)}`);
    applyBalance({});
  }

  // Middle-of-map terrain: the picked variant debuffs units on the central
  // band (ground only unless `air`), and nothing outside the band.
  {
    const { effectVal, moveSpeedMult } = await import('../src/sim/abilities.js');
    const mid = CONFIG.FIELD_W / 2;
    // one variant: -40% move speed, band ±150, ground only
    const middles = [{ slot: 0, kind: 'moveslow', amount: 40, band: 150, air: false }];
    const game = new Game(31, { races: ['humans', 'orcs'], middles });
    check('a middle variant is picked deterministically', game.middle && game.middle.slot === 0);
    const on = spawnUnit(game, 0, 'grunt', mid + 40, 400);   // on the band
    const off = spawnUnit(game, 0, 'grunt', mid + 400, 400); // well outside
    const flyer = spawnUnit(game, 0, 'wasp', mid - 20, 500); flyer.isAir = true; // on the band but airborne
    game.update(DT); game.drainEvents();
    check('unit on the middle band is slowed for real', Math.abs(moveSpeedMult(on, game.time) - 0.6) < 1e-9);
    check('the slow is INVISIBLE (no frost status shown)',
      effectVal(on, 'moveslow', game.time) === 0 && effectVal(on, 'terrainslow', game.time) === 40);
    check('unit outside the band is unaffected', moveSpeedMult(off, game.time) === 1);
    check('flier unaffected when air flag is off', moveSpeedMult(flyer, game.time) === 1);

    // air flag on -> fliers over the band are affected too
    const g2 = new Game(31, { races: ['humans', 'orcs'],
      middles: [{ slot: 0, kind: 'moveslow', amount: 25, band: 150, air: true }] });
    const f2 = spawnUnit(g2, 0, 'wasp', mid + 10, 500); f2.isAir = true;
    g2.update(DT); g2.drainEvents();
    check('flier affected when air flag is on', Math.abs(moveSpeedMult(f2, g2.time) - 0.75) < 1e-9);

    // no variants uploaded -> no middle, no effect
    const g3 = new Game(31, { races: ['humans', 'orcs'], middles: [] });
    const u3 = spawnUnit(g3, 0, 'grunt', mid, 400);
    g3.update(DT); g3.drainEvents();
    check('no middle variants -> no terrain effect', !g3.middle && moveSpeedMult(u3, g3.time) === 1);

    // mana-regen variant: tops up a caster's mana while on the band
    applyBalance({ races: { humans: { units: { mender: { caster: true, abilities: ['heal'], mana: 100, manaRegen: 0, isAir: false } } } } });
    const g4 = new Game(31, { races: ['humans', 'orcs'],
      middles: [{ slot: 0, kind: 'manaregen', amount: 30, band: 150, air: false }] });
    const caster = spawnUnit(g4, 0, 'mender', mid + 20, 400); caster.mana = 0;
    for (let t = 0; t < 1; t += DT) { g4.update(DT); g4.drainEvents(); }
    check('mana-regen middle tops up a caster on the band', caster.mana > 25 && caster.mana <= 100,
      `mana=${caster.mana.toFixed(1)} (~30/s for 1s)`);
    const away = spawnUnit(g4, 0, 'mender', mid + 400, 400); away.mana = 0;
    g4.update(DT); g4.drainEvents();
    check('mana-regen does nothing off the band', away.mana === 0);
    applyBalance({});

    // an "empty" middle entry (slot -1) draws a plain middle: no strip, no effect
    const g5 = new Game(31, { races: ['humans', 'orcs'], middles: [{ slot: -1, kind: 'none' }] });
    const u5 = spawnUnit(g5, 0, 'grunt', mid, 400);
    g5.update(DT); g5.drainEvents();
    check('empty middle -> no image slot, no effect',
      g5.middleSlot === -1 && moveSpeedMult(u5, g5.time) === 1);
  }

  // AI composition categorizes by RESOLVED stats, not the slot id — so a
  // renamed roster (e.g. the "archon" slot turned into a melee tank) is read
  // correctly and the AI doesn't over-build "ranged".
  {
    check('melee stats -> front', categoryOf({ ranged: false, range: 30 }) === 'front');
    check('ranged stats -> ranged', categoryOf({ ranged: true, range: 200 }) === 'ranged');
    check('flier -> special', categoryOf({ ranged: true, isAir: true }) === 'special');
    check('ranged splash -> special (artillery)', categoryOf({ ranged: true, splash: 60 }) === 'special');
    check('healer -> support', categoryOf({ heal: true }) === 'support');
    check('caster -> support', categoryOf({ caster: true, abilities: ['heal'] }) === 'support');
    // the old "archon" (ranged) slot made into a melee tank now counts as front
    check('renamed ranged slot, now melee -> front',
      categoryOf({ ranged: false, range: 30, armor: 'armored' }) === 'front');
  }

  resetAll(); // leave the shared balance pristine for any later tests
}

// -------------------------------------------------- Undead Necromancer kit
// The Necromancer (undead unit 2 / slinger slot) raises skeletons from corpses.
// Three purchasable abilities share a team-wide living-skeleton cap.
console.log('undead necromancer skeleton kit');
{
  const necroStats = { caster: true, autoAttackBetween: true,
    abilities: ['skeletonmelee', 'skeletonranged', 'skeletonbrothers'] };
  const mkNecro = () => {
    const game = new Game(71, { races: ['undead', 'undead'] });
    game.money[0] = 99999;
    const u = spawnUnit(game, 0, 'slinger', 600, 400);
    u.mana = 9999; u.abilityCd = {}; u.castState = undefined;
    return { game, u };
  };
  const stepNecro = (game, u, ticks) => {
    for (let i = 0; i < ticks; i++) {
      game.time += DT; stepCaster(game, u, necroStats, DT, false);
      game.update(DT); game.drainEvents();
    }
  };
  const countKind = (game, kind) =>
    game.entities.filter((e) => e.summon && e.summonKind === kind && e.hp > 0).length;

  // melee unlock -> a melee skeleton rises from the corpse (no enemy needed:
  // raising is engage-exempt like Rise Dead)
  {
    const { game, u } = mkNecro();
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonmeleeunlock' });
    game.addCorpse(620, 400, false, true);
    stepNecro(game, u, 120);
    check('necromancer raises a MELEE skeleton from a corpse', countKind(game, 'skeleton') >= 1);
  }
  // ranged unlock -> a ranged skeleton (SEPARATE summonKind) rises
  {
    const { game, u } = mkNecro();
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonrangedunlock' });
    game.addCorpse(620, 400, false, true);
    stepNecro(game, u, 120);
    check('necromancer raises a RANGED skeleton from a corpse', countKind(game, 'skeletonranged') >= 1);
  }
  // shared cap enforced: plenty of corpses, but living skeletons never exceed it
  {
    const { game, u } = mkNecro();
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonmeleeunlock' });
    for (let i = 0; i < 12; i++) game.addCorpse(590 + (i % 4) * 12, 400 + Math.floor(i / 4) * 12, false, true);
    stepNecro(game, u, 200);
    check('living skeletons never exceed the team cap',
      game.livingSkeletons(0) <= game.skelCapOf(0) && game.livingSkeletons(0) >= 1,
      `alive=${game.livingSkeletons(0)} cap=${game.skelCapOf(0)}`);
  }
  // the base skeleton-cap upgrade raises the cap by SKEL_CAP_STEP and costs gold
  {
    const { game } = mkNecro();
    const before = game.skelCapOf(0);
    const cost = game.skelCapCostOf(0);
    const money0 = game.money[0];
    const r = game.issueCommand({ type: 'buySkelCap', team: 0 });
    check('buySkelCap raises the cap by SKEL_CAP_STEP',
      r.ok && game.skelCapOf(0) === before + CONFIG.SKEL_CAP_STEP);
    check('buySkelCap deducts its cost', game.money[0] === money0 - cost);
    check('next cap step costs more', game.skelCapCostOf(0) === cost + CONFIG.SKEL_CAP_COST_STEP);
  }
  // Brothers Skeleton needs BOTH singles bought first (prerequisite gate)
  {
    const { game } = mkNecro();
    game.tier[0] = 2;
    const blocked = game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonbrothersunlock' });
    check('brothers blocked without both single unlocks', !blocked.ok && blocked.reason === 'requires');
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonmeleeunlock' });
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonrangedunlock' });
    const ok = game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonbrothersunlock' });
    check('brothers allowed once both singles are owned', ok.ok);
  }
  // Brothers raises BOTH a melee and a ranged skeleton from ONE corpse
  {
    const { game, u } = mkNecro();
    game.tier[0] = 2;
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonmeleeunlock' });
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonrangedunlock' });
    game.issueCommand({ type: 'buyUpgrade', team: 0, id: 'skeletonbrothersunlock' });
    game.addCorpse(620, 400, false, true);
    stepNecro(game, u, 120);
    check('brothers raises a melee + a ranged from one corpse',
      countKind(game, 'skeleton') >= 1 && countKind(game, 'skeletonranged') >= 1);
    check('brothers consumes the single corpse it used', game.corpses.length === 0);
  }
}

// ----------------------------------------------------------------- done
console.log('');
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('all tests passed');
