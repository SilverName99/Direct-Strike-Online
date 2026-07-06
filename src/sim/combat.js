import { CONFIG } from '../config.js';
import { DAMAGE_MATRIX } from '../units.js';
import { spawnProjectile } from './entity.js';
import { attackPeriodMult, applyEffect } from './abilities.js';

export function updateCombat(game, dt) {
  for (const u of game.entities) {
    const stats = game.ustat(u.team, u.type);
    u.cooldown = Math.max(0, u.cooldown - dt);
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

function updateFighter(game, u, stats, dt) {
  // Casting takes priority over the basic attack: while a caster is mid-cast
  // (just spent mana on an ability) it holds its swing instead of also
  // auto-attacking. Between casts / when out of mana it attacks normally.
  if (u.abilityBusy > game.time) {
    u.state = 'attack';
    u.windup = 0;
    return;
  }

  let target = game.byId.get(u.targetId) || null;
  if (target && !isValidTarget(u, stats, target, stats.range + CONFIG.AGGRO_BONUS)) {
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
  if (target && effDist(u, target) <= stats.range + rangeBonus) {
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

function acquireTarget(game, u, stats) {
  const aggro = stats.range + CONFIG.AGGRO_BONUS;
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
      impact(game, p, target);
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
  }
}
