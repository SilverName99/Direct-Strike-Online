import { CONFIG } from '../config.js';
import { DAMAGE_MATRIX } from '../units.js';
import { spawnProjectile, spawnUnit } from './entity.js';
import { attackPeriodMult, applyEffect, effectVal, casterPrioritizesSpells, hasActiveAbility, stepCaster } from './abilities.js';
import { resolvedUpgrade } from '../ui/balance.js';

// Effective stats: a dismounted "mount" unit fights on foot with its override
// damage/range/period/speed (and no projectile/splash — unless the override
// says the rider stays ranged, e.g. the Landing Split's axe thrower). A split
// beast uses the same override block with its own melee numbers.
export function effStats(u, stats) {
  if (!u.dismounted && !u.beast) return stats;
  const ranged = !!u.ovRanged;
  return {
    ...stats,
    damage: u.ovDamage != null ? u.ovDamage : stats.damage,
    range: u.ovRange != null ? u.ovRange : stats.range,
    period: u.ovPeriod != null ? u.ovPeriod : stats.period,
    speed: u.ovSpeed != null ? u.ovSpeed : stats.speed,
    projectile: ranged, ranged, splash: 0,
  };
}

export function updateCombat(game, dt) {
  for (const u of game.entities) {
    const base = game.ustat(u.team, u.type);
    let stats = effStats(u, base);
    // "Attack ground units" upgrade: grants a (normally air-only) unit the
    // ability to hit ground once its owner has bought the upgrade for its type.
    if (stats.targetsGround === false && groundUpgradeFor(game, u)) {
      stats = { ...stats, targetsGround: true };
    }
    // "Acid Spit" upgrade: the basic attack becomes a ranged acid projectile
    // that bursts for splash damage and leaves a damage-over-time acid pool.
    const acid = !u.dismounted ? acidUpgradeFor(game, u) : null;
    if (acid) {
      const p = acid.params;
      stats = {
        ...stats,
        ranged: true, projectile: true,
        range: p.range, damage: p.damage,
        splash: p.splashRadius, projectileSpeed: p.projectileSpeed,
        acid: { dot: p.dotDamage, dur: p.dotDuration, radius: p.splashRadius },
      };
      u.acidAttacker = true; // renderer -> "acid" attack frames
    } else if (u.acidAttacker) {
      u.acidAttacker = false;
    }
    // "AoE Damage" upgrade: the unit's thrown projectile bursts on impact and
    // damages every enemy — air included — in the splash radius. Applies to
    // any of its ranged forms (mounted, or a split rider still throwing).
    if (!acid && stats.projectile) {
      const aoe = aoeUpgradeFor(game, u);
      if (aoe) {
        stats = {
          ...stats,
          splash: Math.max(stats.splash || 0, aoe.params.splashRadius || 0),
          splashAir: true,
        };
      }
    }
    u.cooldown = Math.max(0, u.cooldown - dt);
    // "Landing Split" upgrade: an enemy close by makes the flyer land and
    // split into rider + beast — consumes this tick.
    if (!u.dismounted && !u.beast && trySplit(game, u)) continue;
    // Mount upgrade (e.g. boar rider): while still mounted, charge a ranged
    // intruder and dismount on arrival — takes over from normal combat.
    if (!u.dismounted && !u.beast && mountCharge(game, u)) continue;
    // A caster is defined by its active abilities and runs the prepare ->
    // release FSM before (and instead of) its basic action, whether it is a
    // healer or a fighter. It only falls through to the basic attack/heal
    // when out of mana (or the admin opted into auto-attacks between spells).
    if (hasActiveAbility(game, u, stats) && stepCasterHold(game, u, stats, dt)) continue;
    if (stats.heal) {
      updateHealer(game, u, stats);
    } else {
      updateFighter(game, u, stats, dt);
    }
  }

  // Acid / damage-over-time: units carrying an 'acid' effect lose HP each tick
  // (silent = no per-frame hit particle spam; the effect draws its own tint).
  for (const u of game.entities) {
    if (u.hp <= 0) continue;
    const dps = effectVal(u, 'acid', game.time);
    if (dps > 0) applyDamage(game, u, dps * dt, 'normal', true);
  }

  // Armed structures (starting turret + built towers) shoot the nearest
  // enemy unit in range.
  for (const s of game.structures) {
    if (s.hp <= 0) continue;
    if (s.kind === 'turret') updateTurret(game, s, game.bstat(s.team, 'turret'), dt);
    else if (s.kind === 'tower') updateTurret(game, s, game.bstat(s.team, 'tower'), dt);
  }
}

function updateTurret(game, turret, stats, dt) {
  turret.cooldown = Math.max(0, turret.cooldown - dt);

  let target = game.byId.get(turret.targetId) || null;
  if (target && !(target.hp > 0 && effDist(turret, target) <= stats.range)) {
    target = null;
    turret.targetId = null;
  }
  if (!target) {
    let bestD = Infinity;
    for (const e of game.entities) {
      if (e.team === turret.team) continue;
      const d = effDist(turret, e);
      if (d < bestD) {
        bestD = d;
        target = e;
      }
    }
    if (!target || bestD > stats.range) return;
    turret.targetId = target.id;
  }

  if (turret.cooldown <= 0) {
    turret.cooldown = Math.max(0.1, stats.period); // floored: a 0 config must not wedge/machine-gun
    spawnProjectile(game, turret, stats, target);
    game.events.push({ type: 'shot', x: turret.x, y: turret.y, tx: target.x, ty: target.y, team: turret.team });
  }
}

// Effective attack range: a unit can always strike what it is physically
// touching. Bodies never overlap (the separation pass holds centers at
// radius+radius apart), so a configured range below the unit's own radius —
// e.g. an admin-set 0 for "melee" — would otherwise NEVER be reached and the
// unit would chase its target forever without landing a hit.
function atkRange(u, stats) {
  return Math.max(stats.range || 0, (u.radius || 0) + 4);
}

// Drive a caster's prepare -> release FSM and its between-cast hold. Returns
// true when the caster consumed this tick (mid-cast, or waiting for a spell it
// can still afford) so the caller skips the basic attack/heal. Returns false
// when the caster is out of mana (or opted into auto-attacks) and should fall
// through to its basic action.
function stepCasterHold(game, u, stats, dt) {
  u.spellHold = false;

  // Find an enemy target and whether one is within attack range. General rule:
  // a caster only casts while ENGAGED (an enemy in its attack range); the FSM
  // enforces it (Regeneration Aura is the lone exception, handled in the FSM).
  let target = game.byId.get(u.targetId) || null;
  if (target && !isValidTarget(u, stats, target, stats.range + CONFIG.AGGRO_BONUS)) {
    target = null;
    u.targetId = null;
  }
  if (!target) {
    target = acquireTarget(game, u, stats);
    u.targetId = target ? target.id : null;
  }
  const engaged = !!target && effDist(u, target) <= atkRange(u, stats) + (u.state === 'attack' ? 14 : 0);

  if (stepCaster(game, u, stats, dt, engaged)) { // preparing or releasing a spell
    u.spellHold = true;
    u.state = 'attack';
    u.windup = 0;
    return true;
  }
  if (!casterPrioritizesSpells(game, u, stats)) return false; // out of mana -> basic action

  // Still has mana for a spell but nothing castable this instant: wait for it.
  // Hold at range once engaged; otherwise march to close in (casting waits
  // until an enemy is in attack range), never slipping a basic attack in.
  u.spellHold = true;
  u.windup = 0;
  u.state = engaged ? 'attack' : 'march';
  return true;
}

function updateFighter(game, u, stats, dt) {
  u.spellHold = false;

  let target = game.byId.get(u.targetId) || null;
  if (target && !isValidTarget(u, stats, target, aggroRange(stats))) {
    target = null;
    u.targetId = null;
  }
  if (!target) {
    target = acquireTarget(game, u, stats);
    u.targetId = target ? target.id : null;
  }

  // Hysteresis: once engaged, stay engaged until clearly out of range —
  // otherwise back-row units shoved across the range boundary by the
  // separation pass flicker between attack and march every tick.
  const rangeBonus = u.state === 'attack' ? 14 : 0;
  const inRange = !!target && effDist(u, target) <= atkRange(u, stats) + rangeBonus;

  // Dash (charge): while a target sits inside dashRange but out of attack
  // range, the unit commits to a dash and closes at dashSpeed (movement.js
  // reads u.dashing); on arrival it lands a one-off dashDamage burst.
  u.dashing = false;
  if (stats.dash && target) {
    const ready = game.time >= (u.dashReadyAt || 0);
    if (!inRange && ready && effDist(u, target) <= (stats.dashRange || 0)) {
      u.dashing = true;
      u.dashVel = stats.dashSpeed;
      u.dashCharge = true;
    } else if (inRange && u.dashCharge) {
      applyDamage(game, target, stats.dashDamage || 0, stats.dmgType);
      u.dashCharge = false;
      u.dashReadyAt = game.time + (stats.dashCd || 0); // cooldown before it can dash again
      game.events.push({ type: 'dash', x: u.x, y: u.y, tx: target.x, ty: target.y, team: u.team });
    }
  } else {
    u.dashCharge = false;
  }

  if (inRange) {
    u.state = 'attack';
    if (u.windup > 0) {
      // mid-swing: land the hit when the wind-up (attack 1 -> 2) completes
      u.windup -= dt;
      if (u.windup <= 0) {
        u.windup = 0;
        if (stats.projectile) {
          spawnProjectile(game, u, stats, target);
          game.events.push({ type: 'shot', x: u.x, y: u.y, tx: target.x, ty: target.y, team: u.team });
        } else {
          applyDamage(game, target, stats.damage, stats.dmgType);
        }
      }
    } else if (u.cooldown <= 0) {
      // start a new swing; the hit fires windupTime() later. Status effects
      // (slow/haste auras, frost bolts) stretch or shrink the period. The
      // period is floored so a 0 config can't wedge the swing (windup 0
      // would never cross the >0 hit branch = a unit that never strikes).
      const per = Math.max(0.1, stats.period * attackPeriodMult(u, game.time));
      u.cooldown = per;
      u.windupMax = Math.min(0.4, per * 0.5);
      u.windup = u.windupMax;
    }
  } else {
    u.state = 'march';
    u.windup = 0; // moved out of range -> the swing is interrupted
  }
}

function updateHealer(game, u, stats) {
  // Heal the most-wounded ally in range; otherwise follow the army
  // (march only while a friendly unit is ahead of us).
  let best = null;
  let bestRatio = 1;
  for (const e of game.entities) {
    if (e.team !== u.team || e === u || e.hp >= e.maxHp) continue;
    if (effDist(u, e) > stats.range + CONFIG.AGGRO_BONUS) continue;
    const ratio = e.hp / e.maxHp;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = e;
    }
  }

  if (best && effDist(u, best) <= atkRange(u, stats)) {
    u.state = 'attack';
    u.targetId = best.id;
    if (u.cooldown <= 0) {
      u.cooldown = Math.max(0.1, stats.period * attackPeriodMult(u, game.time));
      best.hp = Math.min(best.maxHp, best.hp + stats.damage);
      game.events.push({ type: 'heal', x: best.x, y: best.y });
    }
    return;
  }

  u.targetId = best ? best.id : null;
  const dir = u.team === 0 ? 1 : -1;
  const someoneAhead = game.entities.some(
    (e) => e.team === u.team && e !== u && (e.x - u.x) * dir > 0
  );
  u.state = best || someoneAhead ? 'march' : 'attack'; // 'attack' with no cooldown use = hold position
}

// ---- "Dashing & Fleeing mount" upgrade -------------------------------------
// The active mount-kind upgrade this team owns that transforms u's type, else
// null.
function mountUpgradeFor(game, u) {
  for (const id of game.upgrades[u.team]) {
    if (!game.upgradeActive(u.team, id)) continue; // owned but toggled off
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'mount' && up.unit === u.type && (!up.race || up.race === game.races[u.team])) return up;
  }
  return null;
}

// True if this team owns an "Attack ground units" (kind 'ground') upgrade that
// targets u's type — grants ground attack to an otherwise air-only unit.
function groundUpgradeFor(game, u) {
  for (const id of game.upgrades[u.team]) {
    if (!game.upgradeActive(u.team, id)) continue; // owned but toggled off
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'ground' && up.unit === u.type && (!up.race || up.race === game.races[u.team])) return true;
  }
  return false;
}

// The active "Acid Spit" (kind 'acid') upgrade transforming u's type, else null.
function acidUpgradeFor(game, u) {
  for (const id of game.upgrades[u.team]) {
    if (!game.upgradeActive(u.team, id)) continue;
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'acid' && up.unit === u.type && (!up.race || up.race === game.races[u.team])) return up;
  }
  return null;
}

// The active "AoE Damage" (kind 'aoe') upgrade transforming u's type, else null.
function aoeUpgradeFor(game, u) {
  for (const id of game.upgrades[u.team]) {
    if (!game.upgradeActive(u.team, id)) continue;
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'aoe' && up.unit === u.type && (!up.race || up.race === game.races[u.team])) return up;
  }
  return null;
}

// The active "Landing Split" (kind 'split') upgrade for u's type, else null.
function splitUpgradeFor(game, u) {
  for (const id of game.upgrades[u.team]) {
    if (!game.upgradeActive(u.team, id)) continue;
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'split' && up.unit === u.type && (!up.race || up.race === game.races[u.team])) return up;
  }
  return null;
}

// ---- "Landing Split" upgrade ------------------------------------------------
// While still whole (mounted/airborne): the first enemy inside the trigger
// radius makes the flyer LAND and split into TWO units for the rest of this
// life — `u` becomes the rider on foot (dismounted overrides + "foot-"
// sprites) and a fresh beast entity (the mount) spawns beside it with its own
// HP and melee stats ("beast-" sprites). Returns true on the split tick.
function trySplit(game, u) {
  const up = splitUpgradeFor(game, u);
  if (!up) return false;
  const p = up.params;
  let near = false;
  for (const e of game.entities) {
    if (e.team !== u.team && e.hp > 0 && effDist(u, e) <= p.radius) { near = true; break; }
  }
  if (!near) return false;

  const bs = game.ustat(u.team, u.type);
  // the rider lands and fights on foot from now on
  u.dismounted = true;
  u.isAir = false;
  u.dashing = false;
  u.ovDamage = p.dmDamage; u.ovRange = p.dmRange; u.ovPeriod = p.dmPeriod; u.ovSpeed = p.dmSpeed;
  u.ovRanged = !!p.dmRanged;
  u.ovSize = (p.dmSize != null ? p.dmSize : 100) / 100;
  u.radius = Math.max(5, (bs.radius || 10) * u.ovSize);
  u.windup = 0; u.cooldown = 0;

  // the beast lands beside the rider and fights on its own
  const b = spawnUnit(game, u.team, u.type, u.x, u.y + 26);
  b.beast = true;
  b.isAir = false;
  b.hp = b.maxHp = Math.max(1, p.beastHp || bs.hp);
  b.ovDamage = p.beastDamage; b.ovRange = p.beastRange; b.ovPeriod = p.beastPeriod; b.ovSpeed = p.beastSpeed;
  b.ovRanged = false; // the beast bites in melee
  b.ovSize = (p.beastSize != null ? p.beastSize : 100) / 100;
  b.radius = Math.max(5, (bs.radius || 10) * b.ovSize);

  game.events.push({ type: 'dismount', x: u.x, y: u.y, team: u.team });
  return true; // consumed this tick — both fight with their own stats next tick
}

// An enemy Ranged, non-flying unit within `radius`.
function isRangedFoe(game, u, e, radius) {
  if (e.hp <= 0 || e.team === u.team || e.isAir) return false;
  const es = game.ustat(e.team, e.type);
  if (!es || !es.ranged) return false;
  return effDist(u, e) <= radius;
}
function findRangedIntruder(game, u, radius) {
  let best = null;
  let bestD = Infinity;
  for (const e of game.entities) {
    if (!isRangedFoe(game, u, e, radius)) continue;
    const d = effDist(u, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// While still mounted: if a ranged non-flying enemy is inside the trigger
// radius, charge it at dashSpeed and dismount on arrival (the mount "flees" =
// the unit swaps to its on-foot sprite set + dismounted stats). Returns true
// while charging so normal combat is skipped that tick.
function mountCharge(game, u) {
  const up = mountUpgradeFor(game, u);
  if (!up) { u.mountTargetId = null; return false; }
  const p = up.params;
  let intruder = u.mountTargetId != null ? game.byId.get(u.mountTargetId) : null;
  if (intruder && !isRangedFoe(game, u, intruder, p.radius)) intruder = null;
  if (!intruder) intruder = findRangedIntruder(game, u, p.radius);
  if (!intruder) { u.mountTargetId = null; u.dashing = false; return false; }

  u.mountTargetId = intruder.id;
  u.targetId = intruder.id;
  // Arrival is measured with the ON-FOOT attack range (dmRange), NOT the
  // mounted one: the whole point is to charge right up to the ranged enemy and
  // fight it THERE. With the mounted range (often long) the rider would
  // "arrive" — and dismount — the instant the intruder entered the trigger
  // radius, far away, with no visible dash and a mounted-range attack slipping
  // through on the transition tick.
  const arriveR = Math.max(p.dmRange || 0, (u.radius || 0) + 4) + 14;
  if (effDist(u, intruder) <= arriveR) {
    // arrived: dismount and fight on foot from now on (rest of this life)
    u.dismounted = true;
    u.dashing = false;
    u.ovDamage = p.dmDamage; u.ovRange = p.dmRange; u.ovPeriod = p.dmPeriod; u.ovSpeed = p.dmSpeed;
    u.ovSize = (p.dmSize != null ? p.dmSize : 100) / 100; // on-foot visual scale
    // The mount is gone: the on-foot body is the unit's BASE radius (not the
    // mounted/footprint-inflated one), scaled by the on-foot size. Separation
    // and the touch-range floor both use u.radius, so keeping the mounted bulk
    // would stop the orc far from its target no matter how small dmRange is.
    const bs = game.ustat(u.team, u.type);
    u.radius = Math.max(5, (bs.radius || 10) * u.ovSize);
    u.windup = 0; u.cooldown = 0;
    game.events.push({ type: 'dismount', x: u.x, y: u.y, team: u.team });
    return true; // skip combat this tick — next tick fights with on-foot stats
  }
  // still charging in
  u.dashing = true;
  u.dashVel = p.dashSpeed;
  u.state = 'march';
  u.windup = 0;
  return true;
}

// A dash unit needs to spot targets out to dashRange so it can charge from
// there; everyone else uses the normal aggro radius.
function aggroRange(stats) {
  return Math.max(stats.range + CONFIG.AGGRO_BONUS, stats.dash ? (stats.dashRange || 0) : 0);
}

function acquireTarget(game, u, stats) {
  const aggro = aggroRange(stats);
  let best = null;
  let bestD = Infinity;
  for (const e of game.entities) {
    if (e.team === u.team) continue;
    if (!canHit(stats, e)) continue;
    const d = effDist(u, e);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  for (const s of game.enemyStructures(u.team)) {
    const d = effDist(u, s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return bestD <= aggro ? best : null;
}

function isValidTarget(u, stats, target, maxDist) {
  return target.hp > 0 && canHit(stats, target) && effDist(u, target) <= maxDist;
}

function canHit(stats, target) {
  if (target.isAir) return !!stats.targetsAir;
  return stats.targetsGround !== false; // default: can hit ground
}

// Distance minus the target's radius, so melee can strike large bodies/bases.
function effDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) - (b.radius || 0);
}

export function applyDamage(game, target, damage, dmgType, silent = false) {
  const mult = DAMAGE_MATRIX[dmgType][target.armor];
  target.hp -= damage * mult;
  if (!silent) game.events.push({ type: 'hit', x: target.x, y: target.y, big: !!target.isBase });
  if (target.hp <= 0 && !target.isBase) {
    game.events.push({
      type: 'death',
      x: target.x, y: target.y,
      team: target.team,
      radius: target.radius,
      unitType: target.type || null,
      dismounted: !!target.dismounted, // corpse uses the on-foot "foot-die" sprite
      beast: !!target.beast,           // split mount corpse -> "beast-die" sprite
      footScale: (target.dismounted || target.beast) ? (target.ovSize || 1) : null,
    });
  }
}

export function updateProjectiles(game, dt) {
  const alive = [];
  for (const p of game.projectiles) {
    p.prevX = p.x;
    p.prevY = p.y;
    const target = game.byId.get(p.targetId);
    if (target && target.hp > 0) {
      p.tx = target.x;
      p.ty = target.y;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const speed = p.speed || CONFIG.PROJECTILE_SPEED;
    const step = speed * dt;

    if (d <= Math.max(step, CONFIG.PROJECTILE_HIT_DIST)) {
      if (impact(game, p, target)) alive.push(p); // kept = it ricocheted onward
      continue;
    }
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    alive.push(p);
  }
  game.projectiles = alive;
}

function impact(game, p, target) {
  if (p.splash > 0) {
    game.events.push({ type: 'explosion', x: p.tx, y: p.ty, radius: p.splash, acid: !!p.acid });
    for (const e of game.entities) {
      if (e.team === p.team) continue;
      // ordinary splash is ground-only; acid corrodes fliers, and the AoE
      // upgrade's burst (splashAir) reaches them too
      if (e.isAir && !p.acid && !p.splashAir) continue;
      const dx = e.x - p.tx;
      const dy = e.y - p.ty;
      if (dx * dx + dy * dy <= p.splash * p.splash) {
        applyDamage(game, e, p.damage, p.dmgType);
        // acid pool: everyone caught keeps taking damage over time
        if (p.acid) applyEffect(e, 'acid', p.acid.dot, game.time + p.acid.dur, game.time);
      }
    }
    // splash also chips enemy structures caught in the blast
    for (const s of game.enemyStructures(p.team)) {
      const sdx = s.x - p.tx;
      const sdy = s.y - p.ty;
      if (Math.sqrt(sdx * sdx + sdy * sdy) <= p.splash + s.radius) {
        applyDamage(game, s, p.damage, p.dmgType);
      }
    }
  } else if (target && target.hp > 0) {
    applyDamage(game, target, p.damage, p.dmgType);
    // a splash-less acid spit still leaves the damage-over-time on its target
    if (p.acid && !target.isStructure) {
      applyEffect(target, 'acid', p.acid.dot, game.time + p.acid.dur, game.time);
      game.events.push({ type: 'explosion', x: p.tx, y: p.ty, radius: p.acid.radius || 40, acid: true });
    }
    // ability projectiles (frost bolt) attach their status effect on impact
    if (p.ability && p.effectSpec && !target.isStructure) {
      const spec = p.effectSpec;
      const until = game.time + spec.duration;
      if (spec.moveSlow) applyEffect(target, 'moveslow', spec.moveSlow, until, game.time);
      if (spec.atkSlow) applyEffect(target, 'atkslow', spec.atkSlow, until, game.time);
      game.events.push({ type: 'abilityHit', ability: p.ability, x: p.tx, y: p.ty });
    }
    // "Bounce": ricochet the projectile to the nearest not-yet-hit enemy in
    // range (same air/ground plane), so it visibly flies to the next character
    // and deals bounceDamage (bouncePower% of the original) there.
    if (p.bounce && p.bounceLeft > 0 && p.bounceRadius > 0 && p.bounceDamage > 0) {
      if (!p.bounceHit) p.bounceHit = new Set();
      p.bounceHit.add(target.id);
      const r2 = p.bounceRadius * p.bounceRadius;
      let next = null;
      let bestD = Infinity;
      for (const e of game.entities) {
        if (e.team === p.team || e.hp <= 0 || p.bounceHit.has(e.id)) continue;
        if (e.isAir !== target.isAir) continue; // ricochet stays on the target's plane
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2 && (d2 < bestD || (d2 === bestD && e.id < next.id))) { bestD = d2; next = e; }
      }
      if (next) {
        p.bounceLeft--;
        p.damage = p.bounceDamage;   // ricochets deal bouncePower% of the original
        p.targetId = next.id;
        p.tx = next.x; p.ty = next.y;
        p.x = target.x; p.y = target.y; // launch from the character just hit
        p.prevX = p.x; p.prevY = p.y;
        return true; // keep the projectile alive so it flies to `next`
      }
    }
  }
  return false;
}
