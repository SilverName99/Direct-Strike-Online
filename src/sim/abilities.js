// Ability engine: status effects + auras + auto-cast. Deterministic — all
// timing runs off game.time, targets are picked by stable iteration order
// (lowest id wins), no randomness.
//
// Status effects live on units as u.effects = [{kind, val, until}]. Auras
// re-apply short-lived effects every tick while the target stays in radius;
// timed effects (frost bolt) outlive their cast. Strongest value wins when
// the same kind stacks.

import { CONFIG } from '../config.js';
import { resolvedAbility } from '../ui/balance.js';
import { spawnProjectile, spawnSummon } from './entity.js';

const AURA_TICK = 0.35;    // aura effects auto-expire this fast (re-applied while inside)
export const CAST_PREPARE = 0.45; // "Prepare spell" wind-up before the release frame
export const CAST_RELEASE = 0.40; // minimum time on the release frame (instant spells)

// Abilities that go through the prepare -> release casting FSM: instant/
// projectile spells ('active') and cast-then-persist buff zones ('castaura').
// Passive 'aura' abilities are not cast.
function isCastable(ab) {
  return !!ab && (ab.kind === 'active' || ab.kind === 'castaura' || ab.kind === 'summon');
}

// Does this unit have at least one castable ability USABLE right now (not
// autocast-toggled off, base tier reached)? Only such casters run the
// prepare -> release state machine; the rest keep fighting normally.
export function hasActiveAbility(game, u, stats) {
  if (!stats.caster || !stats.abilities) return false;
  return stats.abilities.some((aid) =>
    isCastable(resolvedAbility(aid)) && game.abilityUsable(u.team, u.type, aid));
}

// A caster is a spellcaster first: while it can still afford at least one of
// its ACTIVE abilities, it holds its basic attack and waits for the cooldown
// instead of slipping an auto-attack between every spell. Aura-only casters
// (and casters out of mana) fall through and fight normally.
export function casterPrioritizesSpells(game, unit, stats) {
  if (!stats.caster || !stats.abilities) return false;
  if (stats.autoAttackBetween) return false; // admin opt-in: attack between spells
  for (const aid of stats.abilities) {
    const ab = resolvedAbility(aid);
    if (ab && (ab.kind === 'active' || ab.kind === 'summon') && unit.mana >= (ab.params.manaCost || 0) &&
        game.abilityUsable(unit.team, unit.type, aid)) return true;
  }
  return false;
}

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

// Attack-period multiplier for a unit (slow lengthens, haste shortens). The
// 'terrainatkslow' source is the invisible middle-terrain slow (no status VFX).
export function attackPeriodMult(u, time) {
  const slow = Math.max(effectVal(u, 'atkslow', time), effectVal(u, 'terrainatkslow', time));
  const haste = effectVal(u, 'haste', time);
  return (1 + slow / 100) * Math.max(0.25, 1 - haste / 100);
}

// Movement-speed multiplier. 'terrainslow' is the invisible middle-terrain slow.
export function moveSpeedMult(u, time) {
  const slow = Math.max(effectVal(u, 'moveslow', time), effectVal(u, 'terrainslow', time));
  return Math.max(0.2, 1 - slow / 100);
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
    const stats = game.ustatOf(u);
    if (!stats.caster || !stats.abilities || stats.abilities.length === 0) continue;

    // mana regen (capped at the unit's configured pool)
    if (u.manaMax > 0 && u.mana < u.manaMax) {
      u.mana = Math.min(u.manaMax, u.mana + (stats.manaRegen || 0) * dt);
    }

    // Cast buff-zones (castaura) tick every frame while their cast is still
    // active; active spells are driven by the prepare -> release state machine
    // (stepCaster), called from combat.js.
    for (const aid of stats.abilities) {
      const ab = resolvedAbility(aid);
      if (ab && ab.kind === 'castaura') tickCastAura(game, u, aid, ab, time);
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

// A cast buff-zone: applies its effect to units in radius every frame, but
// only while the caster's cast is still live (auraUntil[aid] > time). The mana
// was paid once at cast time (see releaseSpell), so there is no per-tick drain.
function tickCastAura(game, caster, aid, ab, time) {
  if (!caster.auraUntil || (caster.auraUntil[aid] || 0) <= time) return;
  const p = ab.params;
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

// ---- active-cast state machine ---------------------------------------------
//
// A caster casts one spell at a time as a strict sequence:
//   Prepare (wind-up, "Prepare spell" frame)
//     -> Release (the "Cast X" frame; the effect fires exactly here: heal
//        lands, the frost bolt leaves the hand)
//     -> re-evaluate (scan abilities in list order, pick the first castable
//        one and start over).
// It never slips an auto-attack between spells. For a projectile spell the
// release phase runs until the bolt would land, so the caster only moves on
// to the next spell after the hit — no teleporting between frames.
//
// Called once per tick from combat.js. Returns true while the caster is busy
// preparing/releasing (combat then suppresses the basic attack and holds
// position).

function endCast(caster) {
  caster.castState = null;
  caster.castAbility = null;
  caster.castTargetId = null;
}

export function stepCaster(game, caster, stats, dt, engaged) {
  const time = game.time;
  if (!caster.abilityCd) caster.abilityCd = {};

  // advance an in-progress cast (always finish what was started)
  if (caster.castState === 'prepare') {
    if (time >= caster.castPhaseEnd) {
      const rel = releaseSpell(game, caster, time); // fires the effect
      if (rel == null) { endCast(caster); return false; } // target gone -> abort
      caster.castState = 'release';
      caster.castPhaseEnd = time + rel;
    }
    return true;
  }
  if (caster.castState === 'release') {
    if (time < caster.castPhaseEnd) return true;
    endCast(caster); // fall through and try to chain the next spell this tick
  }

  // idle: pick the first castable ability (list order) and start winding up
  const pick = pickCastable(game, caster, stats, time, engaged);
  if (!pick) return false;
  caster.castState = 'prepare';
  caster.castAbility = pick.aid;
  caster.castTargetId = pick.target.id;
  caster.castPhaseEnd = time + CAST_PREPARE;
  return true;
}

// Support abilities that fire for a wounded/needy ally even when no enemy is in
// range — they are exempt from the "cast only while engaged" rule.
const ENGAGE_EXEMPT = new Set(['regenaura', 'heal']);

// First castable ability, in the caster's configured order, that is off
// cooldown, affordable, and has a valid target right now.
//
// General rule: a caster only casts while ENGAGED (an enemy sits in its attack
// range). The exceptions are the support abilities in ENGAGE_EXEMPT (Heal and
// Regeneration Aura), which fire for wounded allies even with no enemy nearby.
function pickCastable(game, caster, stats, time, engaged) {
  for (const aid of stats.abilities) {
    const ab = resolvedAbility(aid);
    if (!isCastable(ab)) continue;
    if (!game.abilityUsable(caster.team, caster.type, aid)) continue; // toggled off / tier-locked
    if ((caster.abilityCd[aid] || 0) > time) continue;
    if ((ab.params.manaCost || 0) > caster.mana) continue;
    // summons cast proactively (build the pack); everything else needs an enemy
    // engaged, except the support spells in ENGAGE_EXEMPT
    if (!engaged && ab.kind !== 'summon' && !ENGAGE_EXEMPT.has(aid)) continue;
    const target = findAbilityTarget(game, caster, aid, ab, time);
    if (target) return { aid, ab, target };
  }
  return null;
}

// The target a given ability would act on, or null if there is none.
function findAbilityTarget(game, caster, aid, ab, time) {
  const p = ab.params;
  if (ab.kind === 'summon') {
    // castable while below the cap of this animal kept alive by this caster
    const cap = p.cap || 0;
    if (cap > 0) {
      let alive = 0;
      for (const u of game.entities) {
        if (u.hp > 0 && u.summon && u.summonOf === caster.id && u.summonKind === ab.animal) alive++;
      }
      if (alive >= cap) return null;
    }
    return caster; // self-cast: the animal appears beside the caster
  }
  if (aid === 'regenaura') {
    // self-centered zone worth raising when any ally in range is wounded
    // (the caster itself counts) — fires even when no enemy is engaged
    for (const u of game.entities) {
      if (u.hp > 0 && u.team === caster.team && u.hp < u.maxHp && inRadius(u, caster, p.radius)) return caster;
    }
    return null;
  }
  if (aid === 'hasteaura') {
    // only worth casting when at least one *other* ally is in range to buff
    for (const u of game.entities) {
      if (u.hp > 0 && u.team === caster.team && u !== caster && inRadius(u, caster, p.radius)) return caster;
    }
    return null;
  }
  if (aid === 'slowaura') {
    // only worth casting when at least one enemy is in range to slow
    for (const u of game.entities) {
      if (u.hp > 0 && u.team !== caster.team && inRadius(u, caster, p.radius)) return caster;
    }
    return null;
  }
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
    return best;
  }
  if (aid === 'dispell') {
    // an ally in range carrying a debuff, or an enemy carrying a buff
    let target = null;
    for (const u of game.entities) {
      if (u.hp <= 0 || !u.effects || !u.effects.length || !inRadius(u, caster, p.range)) continue;
      const isAlly = u.team === caster.team;
      const hit = u.effects.some((e) =>
        e.until > time && (isAlly ? DEBUFFS.includes(e.kind) : BUFFS.includes(e.kind))
      );
      if (hit && (!target || u.id < target.id)) target = u;
    }
    return target;
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
    return best;
  }
  return null;
}

// Fire the effect of caster.castAbility on the release frame. Re-picks a valid
// target (the intended one may have died/moved). Pays mana + sets cooldown.
// Returns how long the release phase should last (seconds), or null to abort.
function releaseSpell(game, caster, time) {
  const aid = caster.castAbility;
  const ab = resolvedAbility(aid);
  if (!ab) return null;
  const p = ab.params;
  const target = findAbilityTarget(game, caster, aid, ab, time);
  if (!target) return null; // nothing valid to hit -> abort with no cost

  // cast buff-zones use `duration` as their cooldown (not recastable until the
  // zone expires); instant/projectile spells use their own `cooldown`.
  caster.abilityCd[aid] = time + (p.cooldown != null ? p.cooldown : (p.duration || 0));
  caster.mana -= p.manaCost || 0;

  if (ab.kind === 'summon') {
    const animal = spawnSummon(game, caster, ab);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'summon', x: animal.x, y: animal.y, team: caster.team });
    return CAST_RELEASE;
  }

  if (ab.kind === 'castaura') {
    // raise the persistent zone around the caster; tickCastAura applies it
    if (!caster.auraUntil) caster.auraUntil = {};
    caster.auraUntil[aid] = time + (p.duration || 0);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, radius: p.radius });
    return CAST_RELEASE;
  }

  if (aid === 'heal') {
    target.hp = Math.min(target.maxHp, target.hp + p.amount);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: target.x, y: target.y });
    game.events.push({ type: 'heal', x: target.x, y: target.y });
    return CAST_RELEASE;
  }

  if (aid === 'dispell') {
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
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: target.x, y: target.y, radius: p.radius });
    return CAST_RELEASE;
  }

  if (aid === 'frostbolt') {
    spawnProjectile(game, caster, {
      damage: p.damage, dmgType: 'normal',
      projectileSpeed: p.projectileSpeed, projSize: 1,
    }, target);
    const proj = game.projectiles[game.projectiles.length - 1];
    proj.ability = aid; // impact applies the slow (see combat.js)
    proj.effectSpec = { moveSlow: p.moveSlow, atkSlow: p.atkSlow, duration: p.duration };
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, tx: target.x, ty: target.y });
    // hold the release frame until the bolt would land, so the caster only
    // re-evaluates after the hit (no snap to the next spell mid-flight)
    const dx = target.x - caster.x;
    const dy = target.y - caster.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = p.projectileSpeed || CONFIG.PROJECTILE_SPEED;
    const travel = speed > 0 ? dist / speed : 0;
    return Math.max(CAST_RELEASE, travel);
  }

  return CAST_RELEASE;
}
