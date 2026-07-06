// Ability engine: status effects + auras + auto-cast. Deterministic — all
// timing runs off game.time, targets are picked by stable iteration order
// (lowest id wins), no randomness.
//
// Status effects live on units as u.effects = [{kind, val, until}]. Auras
// re-apply short-lived effects every tick while the target stays in radius;
// timed effects (frost bolt) outlive their cast. Strongest value wins when
// the same kind stacks.

import { resolvedAbility } from '../ui/balance.js';
import { spawnProjectile } from './entity.js';

const AURA_TICK = 0.35; // aura effects auto-expire this fast (re-applied while inside)
const CAST_LOCK = 0.5;  // seconds a caster holds its auto-attack after casting

// ---- status-effect helpers (read by combat/movement/renderer) ----

// Strongest active value of one effect kind, or 0.
export function effectVal(u, kind, time) {
  let best = 0;
  if (!u.effects) return 0;
  for (const e of u.effects) {
    if (e.kind === kind && e.until > time && e.val > best) best = e.val;
  }
  return best;
}

function hasEffect(u, kind, time) {
  return !!u.effects && u.effects.some((e) => e.kind === kind && e.until > time);
}

// Attack-period multiplier for a unit (slow lengthens, haste shortens).
export function attackPeriodMult(u, time) {
  const slow = effectVal(u, 'atkslow', time);
  const haste = effectVal(u, 'haste', time);
  return (1 + slow / 100) * Math.max(0.25, 1 - haste / 100);
}

// Movement-speed multiplier.
export function moveSpeedMult(u, time) {
  return Math.max(0.2, 1 - effectVal(u, 'moveslow', time) / 100);
}

const DEBUFFS = ['atkslow', 'moveslow'];
const BUFFS = ['haste', 'regen'];

// Apply an effect, honoring dispell's immunity (allies) / buff-block (enemies).
export function applyEffect(u, kind, val, until, time) {
  if (DEBUFFS.includes(kind) && hasEffect(u, 'immune', time)) return;
  if (BUFFS.includes(kind) && hasEffect(u, 'nobuff', time)) return;
  if (!u.effects) u.effects = [];
  // refresh an existing entry of the same kind+value instead of stacking rows
  for (const e of u.effects) {
    if (e.kind === kind && e.val === val) {
      if (until > e.until) e.until = until;
      return;
    }
  }
  u.effects.push({ kind, val, until });
}

// ---------------------------------------------------------------- update

export function updateAbilities(game, dt) {
  const time = game.time;

  // expire dead effects (cheap filter, bounded lists)
  for (const u of game.entities) {
    if (u.effects && u.effects.length) u.effects = u.effects.filter((e) => e.until > time);
  }

  for (const u of game.entities) {
    const stats = game.ustat(u.team, u.type);
    if (!stats.caster || !stats.abilities || stats.abilities.length === 0) continue;

    // mana regen (capped at the unit's configured pool)
    if (u.manaMax > 0 && u.mana < u.manaMax) {
      u.mana = Math.min(u.manaMax, u.mana + (stats.manaRegen || 0) * dt);
    }

    for (const aid of stats.abilities) {
      const ab = resolvedAbility(aid);
      if (!ab) continue;
      if (ab.kind === 'aura') tickAura(game, u, aid, ab, time, dt);
      else castActive(game, u, aid, ab, time);
    }
  }

  // regen effects heal their owners
  for (const u of game.entities) {
    const hps = effectVal(u, 'regen', time);
    if (hps > 0 && u.hp > 0 && u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + hps * dt);
    }
  }
}

function inRadius(a, b, r) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= r * r;
}

function tickAura(game, caster, aid, ab, time, dt) {
  const p = ab.params;
  // auras with a mana cost drain it per second and switch off when dry
  if (p.manaCost > 0) {
    if (caster.mana < p.manaCost * dt) return;
    caster.mana -= p.manaCost * dt;
  }
  const until = time + AURA_TICK;
  for (const u of game.entities) {
    if (u.hp <= 0 || !inRadius(u, caster, p.radius)) continue;
    if (aid === 'slowaura') {
      if (u.team !== caster.team) applyEffect(u, 'atkslow', p.atkSlow, until, time);
    } else if (aid === 'hasteaura') {
      if (u.team === caster.team && u !== caster) applyEffect(u, 'haste', p.haste, until, time);
    } else if (aid === 'regenaura') {
      if (u.team === caster.team) applyEffect(u, 'regen', p.hps, until, time);
    }
  }
}

function castActive(game, caster, aid, ab, time) {
  if (!caster.abilityCd) caster.abilityCd = {};
  if ((caster.abilityCd[aid] || 0) > time) return;
  const p = ab.params;
  if (p.manaCost > 0 && caster.mana < p.manaCost) return; // not enough mana

  if (aid === 'heal') {
    // most-wounded ally in range (excluding self), stable iteration order
    let best = null;
    let bestRatio = 1;
    for (const u of game.entities) {
      if (u === caster || u.team !== caster.team || u.hp <= 0) continue;
      if (u.hp >= u.maxHp || !inRadius(u, caster, p.range)) continue;
      const ratio = u.hp / u.maxHp;
      if (ratio < bestRatio) { bestRatio = ratio; best = u; }
    }
    if (!best) return;
    best.hp = Math.min(best.maxHp, best.hp + p.amount);
    caster.abilityCd[aid] = time + p.cooldown;
    caster.mana -= p.manaCost || 0;
    caster.abilityBusy = time + CAST_LOCK;
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: best.x, y: best.y });
    game.events.push({ type: 'heal', x: best.x, y: best.y });
    return;
  }

  if (aid === 'dispell') {
    // trigger: an ally in range carries a debuff, or an enemy carries a buff
    let target = null;
    for (const u of game.entities) {
      if (u.hp <= 0 || !u.effects || !u.effects.length || !inRadius(u, caster, p.range)) continue;
      const isAlly = u.team === caster.team;
      const hit = u.effects.some((e) =>
        e.until > time && (isAlly ? DEBUFFS.includes(e.kind) : BUFFS.includes(e.kind))
      );
      if (hit && (!target || u.id < target.id)) target = u;
    }
    if (!target) return;
    // cleanse everyone in the blast radius around the target
    for (const u of game.entities) {
      if (u.hp <= 0 || !inRadius(u, target, p.radius)) continue;
      if (!u.effects) u.effects = [];
      if (u.team === caster.team) {
        u.effects = u.effects.filter((e) => !DEBUFFS.includes(e.kind));
        applyEffect(u, 'immune', 1, time + p.immunity, time);
      } else {
        u.effects = u.effects.filter((e) => !BUFFS.includes(e.kind));
        applyEffect(u, 'nobuff', 1, time + p.immunity, time);
      }
    }
    caster.abilityCd[aid] = time + p.cooldown;
    caster.mana -= p.manaCost || 0;
    caster.abilityBusy = time + CAST_LOCK;
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: target.x, y: target.y, radius: p.radius });
    return;
  }

  if (aid === 'frostbolt') {
    // nearest enemy in range, preferring ones not already slowed
    let best = null;
    let bestKey = Infinity;
    for (const u of game.entities) {
      if (u.team === caster.team || u.hp <= 0 || !inRadius(u, caster, p.range)) continue;
      const dx = u.x - caster.x;
      const dy = u.y - caster.y;
      const slowed = hasEffect(u, 'moveslow', time) ? 1 : 0;
      const key = slowed * 1e9 + dx * dx + dy * dy; // unslowed first, then nearest
      if (key < bestKey) { bestKey = key; best = u; }
    }
    if (!best) return;
    spawnProjectile(game, caster, {
      damage: p.damage, dmgType: 'normal',
      projectileSpeed: p.projectileSpeed, projSize: 1,
    }, best);
    const proj = game.projectiles[game.projectiles.length - 1];
    proj.ability = aid; // impact applies the slow (see combat.js)
    proj.effectSpec = { moveSlow: p.moveSlow, atkSlow: p.atkSlow, duration: p.duration };
    caster.abilityCd[aid] = time + p.cooldown;
    caster.mana -= p.manaCost || 0;
    caster.abilityBusy = time + CAST_LOCK;
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, tx: best.x, ty: best.y });
  }
}
