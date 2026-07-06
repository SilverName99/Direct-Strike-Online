import { CONFIG } from '../config.js';
import { DAMAGE_MATRIX } from '../units.js';
import { spawnProjectile } from './entity.js';
import { attackPeriodMult, applyEffect, casterPrioritizesSpells, hasActiveAbility, stepCaster } from './abilities.js';

export function updateCombat(game, dt) {
  for (const u of game.entities) {
    const stats = game.ustat(u.team, u.type);
    u.cooldown = Math.max(0, u.cooldown - dt);
    // A caster is defined by its active abilities and runs the prepare ->
    // release FSM before (and instead of) its basic action, whether it is a
    // healer or a fighter. It only falls through to the basic attack/heal
    // when out of mana (or the admin opted into auto-attacks between spells).
    if (hasActiveAbility(stats) && stepCasterHold(game, u, stats, dt)) continue;
    if (stats.heal) {
      updateHealer(game, u, stats);
    } else {
      updateFighter(game, u, stats, dt);
    }
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
    turret.cooldown = stats.period;
    spawnProjectile(game, turret, stats, target);
    game.events.push({ type: 'shot', x: turret.x, y: turret.y, tx: target.x, ty: target.y, team: turret.team });
  }
}

// Windup (swing) time before a strike lands: the attack 1 -> attack 2
// animation plays during this, and the hit (projectile launch / melee damage)
// fires exactly when it finishes. Kept below the attack period so DPS is
// unchanged — it just shifts the hit to the end of the swing.
function windupTime(stats) {
  return Math.min(0.4, stats.period * 0.5);
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
  const engaged = !!target && effDist(u, target) <= stats.range + (u.state === 'attack' ? 14 : 0);

  if (stepCaster(game, u, stats, dt, engaged)) { // preparing or releasing a spell
    u.spellHold = true;
    u.state = 'attack';
    u.windup = 0;
    return true;
  }
  if (!casterPrioritizesSpells(u, stats)) return false; // out of mana -> basic action

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
  const inRange = !!target && effDist(u, target) <= stats.range + rangeBonus;

  // Dash (charge): while a target sits inside dashRange but out of attack
  // range, the unit commits to a dash and closes at dashSpeed (movement.js
  // reads u.dashing); on arrival it lands a one-off dashDamage burst.
  u.dashing = false;
  if (stats.dash && target) {
    const ready = game.time >= (u.dashReadyAt || 0);
    if (!inRange && ready && effDist(u, target) <= (stats.dashRange || 0)) {
      u.dashing = true;
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
      // (slow/haste auras, frost bolts) stretch or shrink the period.
      u.cooldown = stats.period * attackPeriodMult(u, game.time);
      u.windupMax = windupTime(stats);
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

  if (best && effDist(u, best) <= stats.range) {
    u.state = 'attack';
    u.targetId = best.id;
    if (u.cooldown <= 0) {
      u.cooldown = stats.period * attackPeriodMult(u, game.time);
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
  return !target.isAir || !!stats.targetsAir;
}

// Distance minus the target's radius, so melee can strike large bodies/bases.
function effDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) - (b.radius || 0);
}

export function applyDamage(game, target, damage, dmgType) {
  const mult = DAMAGE_MATRIX[dmgType][target.armor];
  target.hp -= damage * mult;
  game.events.push({ type: 'hit', x: target.x, y: target.y, big: !!target.isBase });
  if (target.hp <= 0 && !target.isBase) {
    game.events.push({
      type: 'death',
      x: target.x, y: target.y,
      team: target.team,
      radius: target.radius,
      unitType: target.type || null,
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
    game.events.push({ type: 'explosion', x: p.tx, y: p.ty, radius: p.splash });
    for (const e of game.entities) {
      if (e.team === p.team || e.isAir) continue; // splash is ground-only
      const dx = e.x - p.tx;
      const dy = e.y - p.ty;
      if (dx * dx + dy * dy <= p.splash * p.splash) {
        applyDamage(game, e, p.damage, p.dmgType);
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
