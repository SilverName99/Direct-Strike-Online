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
import { applyDamage } from './combat.js';

const AURA_TICK = 0.35;    // aura effects auto-expire this fast (re-applied while inside)
export const CAST_PREPARE = 0.45; // "Prepare spell" wind-up before the release frame
export const CAST_RELEASE = 0.40; // minimum time on the release frame (instant spells)

// Abilities that go through the prepare -> release casting FSM: instant/
// projectile spells ('active') and cast-then-persist buff zones ('castaura').
// Passive 'aura' abilities are not cast.
function isCastable(ab) {
  return !!ab && (ab.kind === 'active' || ab.kind === 'castaura' || ab.kind === 'summon');
}

// Hero abilities scale with their learned RANK: rank 1 = base numbers, each
// extra rank adds the ability's own `rankStep` to a multiplier on the "power"
// params below (rankStep 0.5 => rank 2 = 1.5×, rank 3 = 2×; 0 => no scaling).
// Set per ability in the balance editor. Non-hero casters always use base params.
const HERO_RANK_STEP = 0.5; // default when an ability doesn't set its own rankStep
const RANK_SCALED = ['damage', 'amount', 'hps', 'haste', 'atkSlow', 'moveSlow', 'duration', 'cap', 'hp', 'cleavePct', 'healPct', 'dmgReduce', 'damageBonus', 'dps', 'manaGain', 'drainPerSec', 'healPerSec', 'drainDps', 'healHps', 'life'];
function abParams(caster, aid, ab) {
  const rank = (caster && caster.hero && caster.heroRanks) ? (caster.heroRanks[aid] || 1) : 1;
  const overrides = ab.rankOverrides;
  if (rank <= 1 && (!overrides || !overrides.length)) return ab.params; // fast path
  const p = { ...ab.params };
  if (rank > 1) {
    // auto scaling: multiply the "power" params by the ability's rankStep
    const step = ab.params.rankStep != null ? ab.params.rankStep : HERO_RANK_STEP;
    const mult = 1 + (rank - 1) * step;
    for (const k of RANK_SCALED) if (typeof p[k] === 'number') p[k] = p[k] * mult;
  }
  // explicit per-rank overrides win over the auto scaling (0 = keep auto/base)
  if (overrides) for (const base of overrides) {
    const v = ab.params[base + rank];
    if (typeof v === 'number' && v > 0) p[base] = v;
  }
  return p;
}

// Rank-scaled params for a hero's LEARNED ability (rank >= 1), or null if the
// unit doesn't have it learned. Used by combat.js for passive attack modifiers
// (Cleave) that aren't cast through the FSM.
export function learnedAbilityParams(u, aid) {
  if (!u || !u.hero || !u.heroRanks || (u.heroRanks[aid] || 0) < 1) return null;
  // toggled OFF from the panel: passives/auras stop applying (actives already
  // stop casting via abilityUsable). Synced onto the entity by syncHeroEntity.
  if (u.disabledAbilities && u.disabledAbilities.has(aid)) return null;
  const ab = resolvedAbility(aid);
  return ab ? abParams(u, aid, ab) : null;
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
  if ((u.vortexUntil || 0) > time) return 1; // Vortex of Light: unaffected by slows
  const slow = Math.max(effectVal(u, 'atkslow', time), effectVal(u, 'terrainatkslow', time));
  const haste = effectVal(u, 'haste', time);
  return (1 + slow / 100) * Math.max(0.25, 1 - haste / 100);
}

// Movement-speed multiplier. 'terrainslow' is the invisible middle-terrain slow.
export function moveSpeedMult(u, time) {
  if ((u.vortexUntil || 0) > time) return 1; // Vortex of Light: immune to slow + stun
  if (hasEffect(u, 'stun', time)) return 0; // stunned: can't move at all
  const slow = Math.max(effectVal(u, 'moveslow', time), effectVal(u, 'terrainslow', time));
  const haste = effectVal(u, 'movehaste', time); // Bloodlust move-speed buff
  return Math.max(0.2, (1 - slow / 100) * (1 + haste / 100));
}

// A stunned unit can neither move nor attack (Charge impact). Combat checks this
// to skip the swing; movement is already zeroed via moveSpeedMult above.
export function isStunned(u, time) {
  if ((u.vortexUntil || 0) > time) return false; // Vortex of Light: immune to stun
  return hasEffect(u, 'stun', time);
}

const DEBUFFS = ['atkslow', 'moveslow', 'stun'];
const BUFFS = ['haste', 'movehaste', 'regen', 'dmgReduce'];

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
    // Elemental Form wore off: restore the pre-morph max HP (clamp current HP down).
    if (u.morphUntil && time >= u.morphUntil) {
      u.morphUntil = 0;
      if (u.morphSavedMaxHp != null) {
        u.maxHp = u.morphSavedMaxHp;
        u.hp = Math.min(u.hp, u.maxHp);
        u.morphSavedMaxHp = null; u.morphSavedHp = null;
      }
      u.morph = null;
    }
  }

  for (const u of game.entities) {
    const stats = game.ustatOf(u);
    if (!stats.caster || !stats.abilities || stats.abilities.length === 0) continue;

    // mana regen (capped at the unit's configured pool); a hero's regen grows
    // with its level (manaRegenPerLevel, set in admin under Nivelare)
    if (u.manaMax > 0 && u.mana < u.manaMax) {
      let regen = stats.manaRegen || 0;
      if (u.hero && (u.heroLevel || 1) > 1) regen += (u.heroLevel - 1) * (stats.manaRegenPerLevel || 0);
      regen += effectVal(u, 'manaregen', time); // Mana Regen Aura bonus
      u.mana = Math.min(u.manaMax, u.mana + regen * dt);
    }

    // Cast buff-zones (castaura) tick every frame while their cast is still
    // active; active spells are driven by the prepare -> release state machine
    // (stepCaster), called from combat.js.
    for (const aid of stats.abilities) {
      const ab = resolvedAbility(aid);
      if (ab && ab.kind === 'castaura') tickCastAura(game, u, aid, ab, time);
    }
  }

  // Passive hero auras (Devotion Aura): always on while the Paladin lives —
  // protect every ally in range with a short, re-applied damage-reduction buff.
  for (const u of game.entities) {
    if (u.hp <= 0) continue;
    const dev = learnedAbilityParams(u, 'devotionaura');
    if (!dev) continue;
    const until = time + AURA_TICK;
    for (const a of game.entities) {
      if (a.hp <= 0 || a.team !== u.team) continue;
      if (inRadius(a, u, dev.radius)) applyEffect(a, 'dmgReduce', dev.dmgReduce, until, time);
    }
  }

  // Mana Regen Aura (Battle Mage passive): always on while she lives — allies in
  // range gain extra mana regen (the mana-regen loop above reads the effect).
  for (const u of game.entities) {
    if (u.hp <= 0) continue;
    const ma = learnedAbilityParams(u, 'manaaura');
    if (!ma) continue;
    const until = time + AURA_TICK;
    for (const a of game.entities) {
      if (a.hp <= 0 || a.team !== u.team || a.manaMax <= 0) continue;
      if (inRadius(a, u, ma.radius)) applyEffect(a, 'manaregen', ma.manaGain || 0, until, time);
    }
  }

  // Slowing Totems: each living totem slows enemies in its radius (attack +
  // movement), re-applied every tick while it stands.
  for (const u of game.entities) {
    if (u.hp <= 0 || !u.totem || !u.totemAura) continue;
    const a = u.totemAura;
    const until = time + AURA_TICK;
    for (const e of game.entities) {
      if (e.hp <= 0 || e.team === u.team || e.summon || e.isStructure) continue;
      if (!inRadius(e, u, a.radius)) continue;
      if (a.atkSlow) applyEffect(e, 'atkslow', a.atkSlow, until, time);
      if (a.moveSlow) applyEffect(e, 'moveslow', a.moveSlow, until, time);
    }
  }

  // Empower channel: while a caster is committed to an ally, keep that ally's
  // buff refreshed and drain mana per second. The channel ends when its time is
  // up, the caster runs out of mana, or the target is lost/out of range.
  for (const u of game.entities) {
    if (!u.empowerUntil) continue;
    if (u.hp <= 0 || time >= u.empowerUntil) { u.empowerUntil = 0; u.empowerTargetId = null; continue; }
    const ab = resolvedAbility('empower');
    if (!ab) { u.empowerUntil = 0; u.empowerTargetId = null; continue; }
    const p = abParams(u, 'empower', ab);
    const target = game.byId.get(u.empowerTargetId);
    if (!target || target.hp <= 0 || target.team !== u.team || !inRadius(target, u, p.range) || u.mana <= 0) {
      u.empowerUntil = 0; u.empowerTargetId = null; continue;
    }
    u.mana = Math.max(0, u.mana - (p.manaPerSec || 0) * dt);
    const until = time + AURA_TICK;
    if (p.haste) applyEffect(target, 'haste', p.haste, until, time);
    if (p.dmgReduce) applyEffect(target, 'dmgReduce', p.dmgReduce, until, time);
  }

  // Vortex of Light: while the Sword Saint spins, every enemy in radius takes
  // damage each tick (dps). Expires when vortexUntil passes.
  for (const u of game.entities) {
    if (!u.vortexUntil) continue;
    if (u.hp <= 0 || time >= u.vortexUntil) { u.vortexUntil = 0; u.vortex = null; continue; }
    const v = u.vortex; if (!v || !v.dps) continue;
    for (const e of game.entities) {
      if (e.hp <= 0 || e.team === u.team || e.summon || e.isStructure) continue;
      if (inRadius(e, u, v.radius)) applyDamage(game, e, v.dps * dt, 'normal', true);
    }
  }

  // Life Drain channel: while committed to a target, drain its HP each tick and
  // heal the caster; ends when the time is up, the target is lost/out of range,
  // or she runs out of mana.
  for (const u of game.entities) {
    if (!u.drainUntil) continue;
    if (u.hp <= 0 || time >= u.drainUntil) { u.drainUntil = 0; u.drainTargetId = null; continue; }
    const ab = resolvedAbility('lifedrain');
    if (!ab) { u.drainUntil = 0; u.drainTargetId = null; continue; }
    const p = abParams(u, 'lifedrain', ab);
    const target = game.byId.get(u.drainTargetId);
    if (!target || target.hp <= 0 || target.team === u.team || target.isStructure ||
        !inRadius(target, u, p.range) || ((p.manaPerSec || 0) > 0 && u.mana <= 0)) {
      u.drainUntil = 0; u.drainTargetId = null; continue;
    }
    if (p.manaPerSec) u.mana = Math.max(0, u.mana - p.manaPerSec * dt);
    applyDamage(game, target, (p.drainPerSec || 0) * dt, 'normal', true);
    if (u.hp > 0 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + (p.healPerSec || 0) * dt);
    game.events.push({ type: 'drain', x: u.x, y: u.y, tx: target.x, ty: target.y, team: u.team });
  }

  // Soul Harvest form: while active, drain every enemy in the drain zone (which
  // also heals her) AND heal every ally in the heal zone.
  for (const u of game.entities) {
    if (!u.harvestUntil) continue;
    if (u.hp <= 0 || time >= u.harvestUntil) { u.harvestUntil = 0; u.harvest = null; continue; }
    const h = u.harvest; if (!h) continue;
    for (const e of game.entities) {
      if (e.hp <= 0) continue;
      if (e.team !== u.team) {
        if (e.isStructure) continue;
        if (inRadius(e, u, h.drainRadius)) {
          const dmg = (h.drainDps || 0) * dt;
          applyDamage(game, e, dmg, 'normal', true);
          if (u.hp > 0 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + dmg); // the drain feeds her
        }
      } else if (e !== u && e.hp < e.maxHp && inRadius(e, u, h.healRadius)) {
        e.hp = Math.min(e.maxHp, e.hp + (h.healHps || 0) * dt);
      }
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

// The nearest raisable corpse within `radius` of the caster (or null). Corpses
// are dropped on death (game.corpses) and expire after their `until`.
function nearestCorpse(game, caster, radius, time) {
  const r2 = radius * radius;
  let best = null, bestD = Infinity;
  for (const c of game.corpses) {
    if (c.until <= time) continue;
    const dx = c.x - caster.x, dy = c.y - caster.y, d = dx * dx + dy * dy;
    if (d <= r2 && d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// A cast buff-zone: applies its effect to units in radius every frame, but
// only while the caster's cast is still live (auraUntil[aid] > time). The mana
// was paid once at cast time (see releaseSpell), so there is no per-tick drain.
function tickCastAura(game, caster, aid, ab, time) {
  if (!caster.auraUntil || (caster.auraUntil[aid] || 0) <= time) return;
  const p = abParams(caster, aid, ab);
  const until = time + AURA_TICK;
  // Regen aura with a target cap: heal only the N MOST-WOUNDED allies in range
  // (healing everyone is too strong). 0 = everyone (handled by the loop below).
  const regenCap = aid === 'regenaura' ? Math.round(p.maxTargets || 0) : 0;
  if (regenCap > 0) {
    const wounded = [];
    for (const u of game.entities) {
      if (u.hp <= 0 || u.team !== caster.team || u.hp >= u.maxHp) continue;
      if (inRadius(u, caster, p.radius)) wounded.push(u);
    }
    // most wounded first; deterministic tie-break by id (lockstep-safe)
    wounded.sort((a, b) => (a.hp / a.maxHp - b.hp / b.maxHp) || (a.id - b.id));
    for (let i = 0; i < wounded.length && i < regenCap; i++) applyEffect(wounded[i], 'regen', p.hps, until, time);
    return;
  }
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
  caster.castManual = false;
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
      caster.castPhaseStart = time;
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
  caster.castAbility = pick.aid;
  caster.castTargetId = pick.target.id;
  caster.castManual = !!pick.manual; // a player-triggered cast keeps relaxed targeting
  // per-ability wind-up: castPrepare (seconds). 0 = instant cast, no prepare
  // frame (heroes) — fire the effect right away and jump to the cast frame.
  const pab = resolvedAbility(pick.aid);
  const prep = pab && pab.params && pab.params.castPrepare != null ? pab.params.castPrepare : CAST_PREPARE;
  // Backline Teleport: lock in the landing spot NOW and telegraph it with a
  // portal for the whole wind-up; the hero blinks there when the prepare ends.
  // Direction: forward to engage, but BACKWARD (retreat) when low on HP.
  if (pick.aid === 'backlineteleport') {
    const front = caster.team === 0 ? 1 : -1;
    const rp = pab.params.retreatHp || 0;
    const retreating = rp > 0 && caster.hp <= caster.maxHp * rp / 100;
    const dir = retreating ? -front : front;
    caster.teleportTo = Math.max(40, Math.min(CONFIG.FIELD_W - 40, caster.x + dir * (pab.params.distance || 0)));
    game.events.push({ type: 'teleportcharge', team: caster.team, x: caster.teleportTo, y: caster.y, dur: Math.max(0.1, prep) });
  }
  if (prep > 0) {
    caster.castState = 'prepare';
    caster.castPhaseEnd = time + prep;
    return true;
  }
  const rel = releaseSpell(game, caster, time);
  if (rel == null) { endCast(caster); return false; }
  caster.castState = 'release';
  caster.castPhaseStart = time;
  caster.castPhaseEnd = time + rel;
  return true;
}

// Support abilities that fire for a wounded/needy ally even when no enemy is in
// range — they are exempt from the "cast only while engaged" rule.
// Life Drain / Rise Dead reach further than the caster's basic attack (their own
// range/corpse-range), and their findAbilityTarget already requires a valid
// target — so exempt them from the "enemy in attack range" engage gate.
const ENGAGE_EXEMPT = new Set(['regenaura', 'heal', 'holylight', 'divineshield', 'lifedrain', 'risedead']);

// Abilities that a BACKLINE caster (e.g. the Totemic Shaman) casts once the
// FIGHT reaches it — not only when an enemy is in the caster's own attack range,
// but also when nearby allies are fighting / enemies are close. This lets the
// shaman empower and plant totems from behind the front line.
const ALLY_ENGAGE = new Set(['empower', 'slowingtotem']);
const SUPPORT_ENGAGE_RADIUS = 320; // how far around the caster counts as "the fight"

// True when combat is happening around the caster: an enemy is within `radius`,
// or a (non-summon) ally within `radius` is currently attacking. Deterministic.
function combatNear(game, caster, radius) {
  const r2 = radius * radius;
  for (const u of game.entities) {
    if (u.hp <= 0 || u === caster) continue;
    const dx = u.x - caster.x, dy = u.y - caster.y;
    if (dx * dx + dy * dy > r2) continue;
    if (u.team !== caster.team) return true;                       // an enemy is near
    if (u.state === 'attack' && !u.summon && !u.isStructure) return true; // an ally is fighting
  }
  return false;
}

// First castable ability, in the caster's configured order, that is off
// cooldown, affordable, and has a valid target right now.
//
// General rule: a caster only casts while ENGAGED (an enemy sits in its attack
// range). The exceptions are the support abilities in ENGAGE_EXEMPT (Heal and
// Regeneration Aura), which fire for wounded allies even with no enemy nearby.
function pickCastable(game, caster, stats, time, engaged) {
  // while spinning the Vortex of Light, the Sword Saint does nothing else
  if ((caster.vortexUntil || 0) > time) return null;
  // Hero ability modes (players only; the AI leaves both sets empty, so heroes
  // it controls stay fully auto). A MANUAL ability never auto-casts; it fires
  // only when the player has queued a one-shot request for it.
  const manualSet = caster.hero ? game.abilityManual[caster.team] : null;
  const reqSet = caster.hero ? game.abilityCastReq[caster.team] : null;
  const isManual = (aid) => manualSet != null && manualSet.has(`${caster.type}/${aid}`);
  const wanted = (aid) => reqSet != null && reqSet.has(`${caster.type}/${aid}`);
  // A manual cast the player explicitly asked for fires FIRST and ignores the
  // engage rule (the player picks the timing). Cooldown / mana / a valid target
  // still gate it; if it can't fire this tick it's dropped (the request is
  // cleared at end of tick — "press again when ready").
  if (reqSet && reqSet.size) {
    for (const aid of stats.abilities) {
      if (!wanted(aid)) continue;
      const ab = resolvedAbility(aid);
      if (!isCastable(ab)) continue;
      if (!game.abilityUsable(caster.team, caster.type, aid)) continue; // OFF / locked
      if ((caster.abilityCd[aid] || 0) > time) continue;
      if ((ab.params.manaCost || 0) > caster.mana) continue;
      const target = findAbilityTarget(game, caster, aid, ab, time, true);
      if (target) return { aid, ab, target, manual: true };
    }
  }
  let combatFlag = null; // combatNear(), computed at most once per pick
  // a caster only casts while ENGAGED (an enemy sits in its attack range) —
  // summons included, so wolves/eagles/bears are conjured only when there's an
  // enemy in reach, not proactively on an empty lane. ENGAGE_EXEMPT support
  // spells (heal / regen) fire for wounded allies with no enemy near, and
  // ALLY_ENGAGE abilities (empower / totem) fire once the fight is near the
  // caster (nearby allies fighting / enemies close), so a backline shaman acts.
  const engageOk = (aid) => {
    if (engaged || ENGAGE_EXEMPT.has(aid)) return true;
    if (!ALLY_ENGAGE.has(aid)) return false;
    if (combatFlag === null) combatFlag = combatNear(game, caster, SUPPORT_ENGAGE_RADIUS);
    return combatFlag;
  };
  // Among the summons ready to cast NOW (off-cooldown, cap not full, engage-ok,
  // and affordable IF the caster saves up), the PRICIEST is the "priority": the
  // hero casts it (or saves mana for it) before any cheaper summon. Without this,
  // cheap summons (Wolf) keep draining mana so a pricier, newly-learned one (Bear)
  // is never afforded — it looks like the hero refuses to make the new animal.
  let priorityId = null; let priorityCost = -1;
  for (const aid of stats.abilities) {
    const ab = resolvedAbility(aid);
    if (!ab || ab.kind !== 'summon') continue;
    if (isManual(aid)) continue; // manual abilities never auto-cast
    if (!game.abilityUsable(caster.team, caster.type, aid)) continue;
    if ((caster.abilityCd[aid] || 0) > time) continue;
    const cost = ab.params.manaCost || 0;
    if (caster.manaMax < cost) continue;   // pool too small to ever afford -> ignore (no soft-lock)
    if (!engageOk(aid)) continue;
    if (!findAbilityTarget(game, caster, aid, ab, time)) continue; // cap reached / no target
    if (cost > priorityCost) { priorityCost = cost; priorityId = aid; }
  }
  for (const aid of stats.abilities) {
    const ab = resolvedAbility(aid);
    if (!isCastable(ab)) continue;
    if (isManual(aid)) continue; // manual abilities fire only via the request pass above
    if (!game.abilityUsable(caster.team, caster.type, aid)) continue; // toggled off / tier-locked
    if ((caster.abilityCd[aid] || 0) > time) continue;
    if ((ab.params.manaCost || 0) > caster.mana) continue;
    if (!engageOk(aid)) continue;
    // a summon casts only if it's the priority one; cheaper summons wait so mana
    // accumulates for the priciest ready summon (non-summon abilities are free to
    // cast meanwhile — e.g. the shaman keeps empowering while saving for a totem).
    if (ab.kind === 'summon' && aid !== priorityId) continue;
    const target = findAbilityTarget(game, caster, aid, ab, time);
    if (target) return { aid, ab, target };
  }
  return null;
}

// Does this unit actually swing a basic attack (so an attack buff like Empower
// is worth anything)? Excludes healers and pure casters that never auto-attack
// (e.g. another Totemic Shaman), and anything with no damage.
function canAutoAttack(game, u) {
  const st = game.ustatOf ? game.ustatOf(u) : game.ustat(u.team, u.type);
  if (!st) return false;
  if (st.heal) return false;                              // healer, not a fighter
  if (st.caster && !st.autoAttackBetween) return false;   // pure caster (e.g. Totemic Shaman)
  return (st.damage || 0) > 0;
}

// Self-centred active abilities whose auto-cast has a "smart" gate (HP
// threshold, enemy/wounded in range, ally ahead…). On a MANUAL cast that gate
// is dropped — the player fires them on demand, targeting the caster.
const SELF_MANUAL = new Set([
  'regenaura', 'hasteaura', 'slowaura', 'warstomp', 'bloodlust',
  'divineshield', 'holynova', 'divineregen', 'backlineteleport',
]);

// The target a given ability would act on, or null if there is none. `manual`
// marks a player-triggered cast: self-centred actives fire on demand (their
// "worth it" condition is skipped), so e.g. Backline Teleport works the instant
// the hero spawns. Re-cast guards (already morphed / spinning) still hold.
function findAbilityTarget(game, caster, aid, ab, time, manual) {
  const p = abParams(caster, aid, ab);
  if (manual) {
    if (aid === 'beastform') return (caster.morphUntil || 0) > time ? null : caster;
    if (aid === 'vortexoflight') return (caster.vortexUntil || 0) > time ? null : caster;
    if (aid === 'soulharvest') return (caster.harvestUntil || 0) > time ? null : caster;
    if (SELF_MANUAL.has(aid)) return caster;
    // ally/enemy-targeted actives (heal, holylight, frostbolt, summons…) fall
    // through: they still need a valid target in range — you can't heal or bolt
    // nothing — but with no other "worth it" gate they fire whenever one exists.
  }
  if (aid === 'risedead') {
    // Rise Dead needs a fresh corpse in reach AND room under the skeleton cap
    const cap = p.cap || 0;
    if (cap > 0) {
      let alive = 0;
      for (const u of game.entities) {
        if (u.hp > 0 && u.summon && u.summonOf === caster.id && u.summonKind === ab.animal) alive++;
      }
      if (alive >= cap) return null;
    }
    return nearestCorpse(game, caster, p.corpseRange || 0, time) ? caster : null;
  }
  if (ab.kind === 'summon') {
    // castable while THIS shaman keeps fewer than its cap of this animal alive
    // (counted per individual caster entity)
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
  if (aid === 'lifedrain') {
    if ((caster.drainUntil || 0) > time) return null; // already channelling
    let best = null, bestD = Infinity;
    for (const u of game.entities) {
      if (u.team === caster.team || u.hp <= 0 || u.isStructure || !inRadius(u, caster, p.range)) continue;
      const dx = u.x - caster.x, dy = u.y - caster.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }
  if (aid === 'soulharvest') {
    if ((caster.harvestUntil || 0) > time) return null; // already transformed
    for (const u of game.entities) {
      if (u.hp > 0 && u.team !== caster.team && !u.isStructure && inRadius(u, caster, p.drainRadius)) return caster;
    }
    return null;
  }
  if (aid === 'empower') {
    // already committed to an ally this channel: don't start another
    if ((caster.empowerUntil || 0) > time) return null;
    // need at least one second's worth of mana to begin channeling
    if (caster.mana < (p.manaPerSec || 0)) return null;
    // allies already claimed by ANOTHER caster's empower channel — the buff does
    // not stack, so a second Totemic Shaman must pick a different unit.
    const claimed = new Set();
    for (const o of game.entities) {
      if (o !== caster && o.hp > 0 && (o.empowerUntil || 0) > time && o.empowerTargetId != null) {
        claimed.add(o.empowerTargetId);
      }
    }
    // buff the ally standing furthest toward the enemy (the one most likely
    // fighting). Excludes self, summons, totems, structures, units that can't
    // auto-attack (empower is wasted on another shaman / a pure support), and
    // anyone already empowered by another shaman.
    let best = null, bestAdv = -Infinity;
    const front = caster.team === 0 ? 1 : -1;
    for (const u of game.entities) {
      if (u === caster || u.team !== caster.team || u.hp <= 0) continue;
      if (u.summon || u.totem || u.isStructure) continue;
      if (claimed.has(u.id)) continue;      // another shaman already buffs it
      if (!canAutoAttack(game, u)) continue; // empower only helps units that attack
      if (!inRadius(u, caster, p.range)) continue;
      const adv = u.x * front;
      if (adv > bestAdv || (adv === bestAdv && best && u.id < best.id)) { bestAdv = adv; best = u; }
    }
    return best;
  }
  if (aid === 'regenaura') {
    // self-centered zone worth raising when any ally in range is wounded
    // (the caster itself counts) — fires even when no enemy is engaged
    for (const u of game.entities) {
      if (u.hp > 0 && u.team === caster.team && u.hp < u.maxHp && inRadius(u, caster, p.radius)) return caster;
    }
    return null;
  }
  if (aid === 'holylight') {
    // heal the most-wounded ally in range (the Paladin himself counts)
    let best = null;
    let bestRatio = 1;
    for (const u of game.entities) {
      if (u.team !== caster.team || u.hp <= 0 || u.hp >= u.maxHp) continue;
      if (!inRadius(u, caster, p.range)) continue;
      const ratio = u.hp / u.maxHp;
      if (ratio < bestRatio) { bestRatio = ratio; best = u; }
    }
    return best;
  }
  if (aid === 'divineshield') {
    // pop invulnerability when the Paladin drops below the HP threshold
    return caster.maxHp > 0 && caster.hp / caster.maxHp < (p.threshold || 100) / 100 ? caster : null;
  }
  if (aid === 'holynova') {
    // The ultimate must FEEL its moment, not fire the second a fight starts on
    // a full-HP army (all that healing would be wasted). Cast only when the
    // allies inside the dome are missing at least ~a third of the total HP the
    // nova can restore (hps × duration per ally) — or when the Paladin himself
    // is in real danger.
    if (caster.maxHp > 0 && caster.hp / caster.maxHp < 0.35) return caster; // emergency
    const healPerAlly = (p.hps || 0) * (p.duration || 0);
    let missing = 0;
    let healable = 0;
    for (const u of game.entities) {
      if (u.hp <= 0 || u.team !== caster.team || !inRadius(u, caster, p.radius)) continue;
      missing += Math.min(u.maxHp - u.hp, healPerAlly);
      healable += healPerAlly;
    }
    if (healable <= 0) return null;
    return missing >= Math.max(healPerAlly, healable * 0.33) ? caster : null;
  }
  if (aid === 'hasteaura') {
    // only worth casting when at least one *other* ally is in range to buff
    for (const u of game.entities) {
      if (u.hp > 0 && u.team === caster.team && u !== caster && inRadius(u, caster, p.radius)) return caster;
    }
    return null;
  }
  if (aid === 'warstomp') {
    // worth stomping when an enemy is inside the blast radius
    for (const u of game.entities) {
      if (u.hp > 0 && u.team !== caster.team && !u.isAir && inRadius(u, caster, p.radius)) return caster;
    }
    return null;
  }
  if (aid === 'bloodlust') {
    // a war cry — always castable (self-centred, buffs the whole army); the
    // "cast only while engaged" rule keeps it from firing before contact
    return caster;
  }
  if (aid === 'beastform') {
    // self-transform; don't re-cast while already morphed
    return (caster.morphUntil || 0) > time ? null : caster;
  }
  if (aid === 'backlineteleport') {
    const rp = p.retreatHp || 0;
    const retreating = rp > 0 && caster.hp <= caster.maxHp * rp / 100;
    if (retreating) {
      // low HP: retreat whenever an enemy is near (it's in danger)
      for (const u of game.entities) if (u.hp > 0 && u.team !== caster.team) return caster;
      return null;
    }
    // forward: only while still BEHIND our own front line — i.e. a friendly unit
    // is ahead of us. That lets it jump PAST the front into the enemy backline
    // once; once it's out front (no ally ahead) it stays and fights instead of
    // teleporting again and again into the enemy tower.
    const front = caster.team === 0 ? 1 : -1;
    for (const u of game.entities) {
      if (u.hp <= 0 || u === caster || u.team !== caster.team || u.summon || u.isStructure) continue;
      if ((u.x - caster.x) * front > 40) return caster; // an ally is ahead -> we're behind the front
    }
    return null;
  }
  if (aid === 'divineregen') {
    // meditate to heal — only once HP drops to/under the threshold (% of max)
    const thr = p.threshold != null ? p.threshold : 50;
    return caster.hp <= caster.maxHp * thr / 100 ? caster : null;
  }
  if (aid === 'vortexoflight') {
    // self-channel; don't re-cast while the vortex is already spinning
    return (caster.vortexUntil || 0) > time ? null : caster;
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
  if (aid === 'blizzard') {
    // drop the storm on the nearest enemy in cast range (it centres on them)
    let best = null, bestD = Infinity;
    for (const u of game.entities) {
      if (u.team === caster.team || u.hp <= 0 || u.isAir || !inRadius(u, caster, p.range)) continue;
      const dx = u.x - caster.x, dy = u.y - caster.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }
  if (aid === 'frostbolt' || aid === 'bigfrostbolt') {
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
  const p = abParams(caster, aid, ab);
  // seconds held on the "Cast X" frame after the effect fires (per-ability)
  const hold = ab.params.castHold != null ? ab.params.castHold : CAST_RELEASE;
  const target = findAbilityTarget(game, caster, aid, ab, time, caster.castManual);
  if (!target) return null; // nothing valid to hit -> abort with no cost

  // cast buff-zones use `duration` as their cooldown (not recastable until the
  // zone expires); instant/projectile spells use their own `cooldown`.
  caster.abilityCd[aid] = time + (p.cooldown != null ? p.cooldown : (p.duration || 0));
  caster.mana -= p.manaCost || 0;

  if (ab.kind === 'summon') {
    // pass the caster's learned rank so the animal's HP/damage grow per-rank
    const rank = (caster.hero && caster.heroRanks) ? (caster.heroRanks[aid] || 1) : 1;
    const animal = spawnSummon(game, caster, ab, p, rank);
    // Rise Dead raises the skeleton FROM a corpse: place it there and consume it
    if (aid === 'risedead') {
      const corpse = nearestCorpse(game, caster, p.corpseRange || 0, time);
      if (corpse) {
        animal.x = animal.prevX = corpse.x;
        animal.y = animal.prevY = corpse.y;
        game.corpses = game.corpses.filter((c) => c !== corpse);
      }
    }
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: animal.x, y: animal.y });
    game.events.push({ type: 'summon', x: animal.x, y: animal.y, team: caster.team });
    return hold;
  }

  if (ab.kind === 'castaura') {
    // raise the persistent zone around the caster; tickCastAura applies it
    if (!caster.auraUntil) caster.auraUntil = {};
    caster.auraUntil[aid] = time + (p.duration || 0);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, radius: p.radius });
    return hold;
  }

  if (aid === 'heal') {
    target.hp = Math.min(target.maxHp, target.hp + p.amount);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: target.x, y: target.y });
    game.events.push({ type: 'heal', x: target.x, y: target.y });
    return hold;
  }

  if (aid === 'empower') {
    // begin a CHANNEL on this one ally: updateAbilities keeps the buff refreshed
    // and drains mana per second until `duration` is up (or mana/target is lost).
    // The buff is applied now too, with a short rolling window, so it's active
    // immediately and fades right after the channel stops.
    caster.empowerUntil = time + (p.duration || 0);
    caster.empowerTargetId = target.id;
    const until = time + AURA_TICK;
    if (p.haste) applyEffect(target, 'haste', p.haste, until, time);
    if (p.dmgReduce) applyEffect(target, 'dmgReduce', p.dmgReduce, until, time);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: target.x, y: target.y });
    return hold;
  }

  if (aid === 'holylight') {
    // heal a % of the target's MAX hp. If the admin set an explicit per-rank
    // heal (healPct1/2/3 > 0) use exactly that for the caster's rank; otherwise
    // fall back to the auto-scaled healPct.
    const rank = (caster.hero && caster.heroRanks) ? (caster.heroRanks.holylight || 1) : 1;
    const perRank = p['healPct' + rank];
    const pct = (typeof perRank === 'number' && perRank > 0) ? perRank : (p.healPct || 0);
    target.hp = Math.min(target.maxHp, target.hp + target.maxHp * pct / 100);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: target.x, y: target.y });
    game.events.push({ type: 'heal', x: target.x, y: target.y });
    return hold;
  }

  if (aid === 'divineshield') {
    // the Paladin becomes invulnerable for `duration` (applyDamage ignores hits
    // while game.time is in [shieldFrom, shieldUntil])
    caster.shieldFrom = time;
    caster.shieldUntil = time + (p.duration || 0);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'shield', x: caster.x, y: caster.y, team: caster.team, unitId: caster.id });
    return hold;
  }

  if (aid === 'holynova') {
    // ultimate: self-invuln + a strong regen on every ally in range
    caster.shieldFrom = time;
    caster.shieldUntil = time + (p.duration || 0);
    for (const u of game.entities) {
      if (u.hp <= 0 || u.team !== caster.team || !inRadius(u, caster, p.radius)) continue;
      applyEffect(u, 'regen', p.hps, time + (p.duration || 0), time);
    }
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, radius: p.radius, unitType: caster.type, dur: p.duration });
    game.events.push({ type: 'shield', x: caster.x, y: caster.y, team: caster.team, unitId: caster.id });
    return hold;
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
    return hold;
  }

  if (aid === 'warstomp') {
    // AoE around the Chieftain: damage + move/attack slow to enemies in radius
    for (const u of game.entities) {
      if (u.hp <= 0 || u.team === caster.team || u.isAir) continue;
      if (!inRadius(u, caster, p.radius)) continue;
      applyDamage(game, u, p.damage, 'normal');
      if (u.hp > 0) {
        if (p.moveSlow) applyEffect(u, 'moveslow', p.moveSlow, time + p.duration, time);
        if (p.atkSlow) applyEffect(u, 'atkslow', p.atkSlow, time + p.duration, time);
      }
    }
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, radius: p.radius });
    return hold;
  }

  if (aid === 'bloodlust') {
    // war cry: haste + move-speed to the WHOLE army for `duration`
    for (const u of game.entities) {
      if (u.hp <= 0 || u.team !== caster.team) continue;
      if (p.haste) applyEffect(u, 'haste', p.haste, time + p.duration, time);
      if (p.moveHaste) applyEffect(u, 'movehaste', p.moveHaste, time + p.duration, time);
    }
    // the Chieftain himself swells while raging (visual only; read by renderer)
    if (p.size && p.size !== 100) applyEffect(caster, 'sizeup', p.size, time + p.duration, time);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, radius: 200 });
    return hold;
  }

  if (aid === 'beastform') {
    // transform into a giant beast for `duration`: boost max HP (gaining the
    // fresh chunk now), stash combat overrides for effStats, and mark the timer.
    caster.morphUntil = time + (p.duration || 0);
    caster.morphSavedMaxHp = caster.maxHp;
    caster.morphSavedHp = caster.hp;
    const hpMul = 1 + (p.hpBonus || 0) / 100;
    const newMax = Math.round(caster.maxHp * hpMul);
    caster.hp = Math.min(newMax, caster.hp + (newMax - caster.maxHp)); // gain the bonus HP now
    caster.maxHp = newMax;
    caster.morph = {
      dmgMul: 1 + (p.dmgBonus || 0) / 100,
      size: (p.size || 150) / 100,
      splash: p.splash || 0,
      splashPct: (p.splashPct || 0) / 100,
      range: p.range || 35,
    };
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'morph', team: caster.team, x: caster.x, y: caster.y });
    return hold;
  }

  if (aid === 'backlineteleport') {
    // blink to the landing spot locked in at cast start (telegraphed by the
    // portal during the wind-up); fall back to a fresh forward blink if missing
    const front = caster.team === 0 ? 1 : -1;
    const fromX = caster.x;
    const toX = caster.teleportTo != null
      ? caster.teleportTo
      : Math.max(40, Math.min(CONFIG.FIELD_W - 40, caster.x + front * (p.distance || 0)));
    caster.x = toX;
    caster.prevX = caster.x; // no interpolated slide — it's a teleport
    caster.teleportTo = null;
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'teleport', team: caster.team, x: fromX, y: caster.y, tx: caster.x, ty: caster.y });
    return hold;
  }
  if (aid === 'divineregen') {
    // enter a healing stance: strong self-regen for `duration`; the release
    // frame is held for the whole duration (the hero stands still, meditating)
    const dur = p.duration || 0;
    if (p.hps) applyEffect(caster, 'regen', p.hps, time + dur, time);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    return Math.max(hold, dur);
  }
  if (aid === 'vortexoflight') {
    // spin up the vortex: a timed state (like a morph) — updateAbilities ticks
    // the AoE, movement/stun immunity is read off vortexUntil, and the renderer
    // shows the vortex frame while it lasts. The caster stays mobile.
    caster.vortexUntil = time + (p.duration || 0);
    caster.vortex = { radius: p.radius || 0, dps: p.dps || 0, size: p.size || 100 };
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, radius: p.radius });
    return hold;
  }
  if (aid === 'lifedrain') {
    // start the channel: updateAbilities drains the target and heals her; the
    // release frame is held for the whole duration (she stands and channels)
    caster.drainUntil = time + (p.duration || 0);
    caster.drainTargetId = target.id;
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'drain', x: caster.x, y: caster.y, tx: target.x, ty: target.y, team: caster.team });
    return Math.max(hold, p.duration || 0);
  }
  if (aid === 'soulharvest') {
    // transform into the harvest form: a timed dual-zone drain/heal (she stays
    // mobile). updateAbilities ticks it; the renderer reads harvestUntil/size.
    caster.harvestUntil = time + (p.duration || 0);
    caster.harvest = {
      size: p.size || 100,
      drainRadius: p.drainRadius || 0, drainDps: p.drainDps || 0,
      healRadius: p.healRadius || 0, healHps: p.healHps || 0,
    };
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'soulharvest', x: caster.x, y: caster.y, team: caster.team, drainRadius: p.drainRadius, healRadius: p.healRadius });
    return hold;
  }

  if (aid === 'frostbolt' || aid === 'bigfrostbolt') {
    spawnProjectile(game, caster, {
      damage: p.damage, dmgType: 'normal',
      projectileSpeed: p.projectileSpeed, projSize: 1,
      splash: p.radius || 0, // Bigger Frost Bolt bursts for area damage + area slow
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
    return Math.max(hold, travel);
  }

  if (aid === 'blizzard') {
    // drop a frost storm centred on the target: a zone that ticks damage AND
    // slows every enemy standing in it, for `duration` seconds (reuses fireZones)
    game.fireZones.push({
      x: target.x, y: target.y, radius: p.radius || 0, dps: p.dps || 0,
      moveSlow: p.moveSlow || 0, until: time + (p.duration || 0), team: caster.team,
      dmgType: 'normal', frost: true,
    });
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: target.x, y: target.y, radius: p.radius });
    game.events.push({ type: 'blizzard', x: target.x, y: target.y, radius: p.radius, dur: p.duration });
    return hold;
  }

  return hold;
}
