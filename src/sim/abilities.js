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
import { spawnProjectile, spawnSummon, spawnCloneShadow } from './entity.js';
import { applyDamage, effStats } from './combat.js';

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
const RANK_SCALED = ['damage', 'amount', 'hps', 'haste', 'atkSlow', 'moveSlow', 'duration', 'cap', 'hp', 'cleavePct', 'healPct', 'dmgReduce', 'damageBonus', 'dps', 'manaGain', 'drainPerSec', 'healPerSec', 'drainDps', 'healHps', 'life', 'threshold', 'lifestealPct', 'backstabPct', 'clonePct'];
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
    isCastable(resolvedAbility(aid)) && game.abilityUsable(u.owner != null ? u.owner : u.team, u.type, aid));
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
        game.abilityUsable(unit.owner != null ? unit.owner : unit.team, unit.type, aid)) return true;
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

// Shadow Assassin stealth: while invisible (Shadow Rush / Vanish) the unit can't
// be targeted by enemies (combat.js skips it in target acquisition) and renders
// semi-transparent. Purely time-based off u.stealthUntil.
export function isStealthed(u, time) {
  return !!u && (u.stealthUntil || 0) > time;
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

const DEBUFFS = ['atkslow', 'moveslow', 'stun', 'vulnerable'];
const BUFFS = ['haste', 'movehaste', 'regen', 'dmgReduce', 'lifesteal'];

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

// Summons whose creature only shows up when the caster FINISHES its cast
// animation (the moth's cocoon): releaseSpell queues them, this drops them on
// the tick their pose ends. Deterministic — a plain time-ordered queue. A
// caster that dies mid-pose never lays anything.
function flushPendingSummons(game) {
  if (!game.pendingSummons || !game.pendingSummons.length) return;
  const due = [];
  game.pendingSummons = game.pendingSummons.filter((p) => {
    if (game.time < p.at) return true;
    due.push(p);
    return false;
  });
  for (const p of due) {
    const caster = game.byId.get(p.casterId);
    if (!caster || caster.hp <= 0) continue; // interrupted -> nothing appears
    const ab = resolvedAbility(p.aid);
    if (!ab) continue;
    const animal = spawnSummon(game, caster, ab, abParams(caster, p.aid, ab), p.rank);
    game.events.push({ type: 'summon', x: animal.x, y: animal.y, team: caster.team });
  }
}

export function updateAbilities(game, dt) {
  const time = game.time;
  flushPendingSummons(game);

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
    // An unlock upgrade can turn a unit INTO a caster mid-match (the moth gets
    // its pool when "Cocon" is bought): units already on the field were spawned
    // without one, so open it here — empty, to be filled by regen.
    if (!u.summon && u.manaMax === 0 && (stats.mana || 0) > 0) {
      u.manaMax = stats.mana;
      u.mana = 0;
    }

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

  // Vampiric Aura (Death Knight passive): the hero + nearby allies lifesteal a %
  // of the damage they deal. Marks them with a short 'lifesteal' buff; the attack
  // code (combat.js) reads it and heals the attacker.
  for (const u of game.entities) {
    if (u.hp <= 0) continue;
    const va = learnedAbilityParams(u, 'vampiricaura');
    if (!va) continue;
    const until = time + AURA_TICK;
    for (const a of game.entities) {
      if (a.hp <= 0 || a.team !== u.team) continue;
      if (inRadius(a, u, va.radius)) applyEffect(a, 'lifesteal', va.lifestealPct || 0, until, time);
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
    // an ALLY-facing banner (Undead Flag) heals whoever stands under it...
    if (a.healHps > 0) {
      for (const e of game.entities) {
        if (e.hp <= 0 || e.team !== u.team || e.isStructure || e === u) continue;
        if (e.hp >= e.maxHp) continue;
        if (!inRadius(e, u, a.radius)) continue;
        e.hp = Math.min(e.maxHp, e.hp + a.healHps * dt);
      }
    }
    // ...while a slowing totem works on the enemies
    if (!a.atkSlow && !a.moveSlow) continue;
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

  // Shadow Assassin phase-walk (Shadow Rush / Vanish): while slipping, move on
  // foot (invisible, phasing through everything) toward the destination — an
  // enemy (Vanish, strike on arrival) or a point in the backline (Shadow Rush).
  // A safety timeout stops a hopeless chase. The cast frame must finish first.
  for (const u of game.entities) {
    if (!u.phaseUntil) continue;
    if (u.castState) continue; // hold on the cast frame until the cast FSM ends
    if (u.hp <= 0 || time >= u.phaseUntil) { u.phaseUntil = 0; u.phaseTargetId = null; continue; }
    let gx, gy, target = null;
    if (u.phaseTargetId != null) {
      target = game.byId.get(u.phaseTargetId);
      if (!target || target.hp <= 0 || target.team === u.team) { u.phaseUntil = 0; u.phaseTargetId = null; continue; }
      gx = target.x; gy = target.y;
    } else { gx = u.phaseToX; gy = u.phaseToY; }
    const dx = gx - u.x, dy = gy - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= (u.phaseReach || 20)) {
      if (target && (u.phasePct || 0) > 0) { // Vanish: single critical backstab
        const dmgBase = effStats(u, game.ustatOf(u)).damage || 0;
        applyDamage(game, target, dmgBase * u.phasePct / 100, 'normal');
        game.events.push({ type: 'execute', x: target.x, y: target.y, team: u.team });
      }
      u.stealthUntil = time + (u.phaseAfter || 0); // brief stealth after arriving
      u.phaseUntil = 0; u.phaseTargetId = null;
      continue;
    }
    const step = Math.min((u.phaseSpeed || 300) * dt, d);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
    u.mvx = dx / d; u.mvy = dy / d;
    u.state = 'march';
  }

  // Binding Blade (Loves dagger, ult): the thrown blade flies along its chain
  // (hero -> e1 -> e2 -> ... -> eN -> hero) at daggerSpeed. daggerDist tracks how
  // far it has travelled along the CURRENT-position polyline; when it has covered
  // the whole path (or a safety timeout hits) the blade has "returned" — split
  // the base + absorbed damage among the still-living hit enemies and land.
  for (const u of game.entities) {
    if (!u.daggerFlying) continue;
    u.daggerElapsed = (u.daggerElapsed || 0) + dt;
    const pts = [[u.x, u.y]];
    if (u.daggerChain) for (const id of u.daggerChain) { const e = game.byId.get(id); if (e && e.hp > 0 && e.team !== u.team) pts.push([e.x, e.y]); }
    pts.push([u.x, u.y]); // and back to the hero
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    u.daggerPrevDist = u.daggerDist || 0;
    u.daggerDist = (u.daggerDist || 0) + (u.daggerSpeed || 420) * dt;
    // hard safety cap (in addition to distance): he is invincible + held only
    // while flying, so this bounds the freeze even if the path can't be covered
    // (enemies fleeing, a pathological speed) — he can never get stuck.
    if (u.hp <= 0 || u.daggerDist >= L || u.daggerElapsed > 3) {
      const links = [];
      if (u.daggerChain) for (const id of u.daggerChain) { const e = game.byId.get(id); if (e && e.hp > 0 && e.team !== u.team) links.push(e); }
      if (links.length) {
        const total = (u.daggerBase || 0) + (u.daggerAbsorbed || 0);
        const each = total / links.length;
        for (const e of links) applyDamage(game, e, each, 'normal');
        game.events.push({ type: 'daggerreturn', unitId: u.id, team: u.team, x: u.x, y: u.y });
      }
      u.daggerFlying = false; u.daggerChain = null; u.daggerAbsorbed = 0; u.daggerBase = 0;
      u.daggerDist = 0; u.daggerPrevDist = 0;
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
    if ((c.readyAt || 0) > time) continue; // death animation still playing — not raisable yet
    const dx = c.x - caster.x, dy = c.y - caster.y, d = dx * dx + dy * dy;
    if (d <= r2 && d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// Spawn one skeleton from a specific skeleton ability's params (used by Brothers
// Skeleton, which raises a melee + a ranged one from the same corpse).
function raiseSkeleton(game, caster, aid) {
  const ab = resolvedAbility(aid);
  if (!ab) return null;
  const p = abParams(caster, aid, ab);
  return spawnSummon(game, caster, ab, p, 1);
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

  // Shadow Rush / Vanish: once the cast is done he's slipping (moved by
  // updateAbilities) — don't start a new cast until that phase-walk resolves.
  if (!caster.castState && (caster.phaseUntil || 0) > time) return false;

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
const ENGAGE_EXEMPT = new Set(['regenaura', 'heal', 'holylight', 'divineshield', 'lifedrain', 'risedead',
  // Necromancer raises skeletons from any corpse in reach — like Rise Dead, it
  // shouldn't wait for an enemy to walk into the caster's own attack range.
  'skeletonmelee', 'skeletonranged', 'skeletonbrothers',
  // Shadow Assassin: Shadow Rush dives from BEHIND the line (no enemy in his own
  // range yet) and Vanish reaches far to slip behind a target — both carry their
  // own target gate, so they don't wait to be engaged in melee.
  'shadowrush', 'vanish']);

// Abilities that a BACKLINE caster (e.g. the Totemic Shaman) casts once the
// FIGHT reaches it — not only when an enemy is in the caster's own attack range,
// but also when nearby allies are fighting / enemies are close. This lets the
// shaman empower and plant totems from behind the front line.
const ALLY_ENGAGE = new Set(['empower', 'slowingtotem', 'cocoon']);
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
  const manualSet = caster.hero ? game.abilityManual[caster.owner != null ? caster.owner : caster.team] : null;
  const reqSet = caster.hero ? game.abilityCastReq[caster.owner != null ? caster.owner : caster.team] : null;
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
      if (!game.abilityUsable(caster.owner != null ? caster.owner : caster.team, caster.type, aid)) continue; // OFF / locked
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
    if (!game.abilityUsable(caster.owner != null ? caster.owner : caster.team, caster.type, aid)) continue;
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
    if (!game.abilityUsable(caster.owner != null ? caster.owner : caster.team, caster.type, aid)) continue; // toggled off / tier-locked
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
  'divineshield', 'holynova', 'divineregen', 'backlineteleport', 'soullink',
  // Shadow Assassin self-centred actives (Vanish is enemy-targeted, so it's not
  // here — it falls through and just needs a valid target).
  'shadowrush', 'twinshadows', 'daggerthrow',
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
  // Necromancer skeleton kit: all three share the team-wide skeleton cap.
  if (aid === 'skeletonbrothers') {
    // needs a corpse in reach AND room for TWO under the cap
    if (game.livingSkeletons(caster.owner != null ? caster.owner : caster.team) + 2 > game.skelCapOf(caster.owner != null ? caster.owner : caster.team)) return null;
    return nearestCorpse(game, caster, p.corpseRange || 0, time) ? caster : null;
  }
  if (aid === 'skeletonmelee' || aid === 'skeletonranged') {
    // once Brothers is unlocked it supersedes the singles
    if (game.abilityUsable(caster.owner != null ? caster.owner : caster.team, caster.type, 'skeletonbrothers')) return null;
    if (game.livingSkeletons(caster.owner != null ? caster.owner : caster.team) + 1 > game.skelCapOf(caster.owner != null ? caster.owner : caster.team)) return null;
    if (!nearestCorpse(game, caster, p.corpseRange || 0, time)) return null;
    const meleeOn = game.abilityUsable(caster.owner != null ? caster.owner : caster.team, caster.type, 'skeletonmelee');
    const rangedOn = game.abilityUsable(caster.owner != null ? caster.owner : caster.team, caster.type, 'skeletonranged');
    if (meleeOn && rangedOn) {
      // both unlocked -> alternate toward the type we have FEWER of (ties: melee).
      // Returning null for the "wrong" type also drops it from summon-priority,
      // so the other one gets cast this tick.
      let melee = 0, ranged = 0;
      for (const e of game.entities) {
        if (e.hp <= 0 || e.team !== caster.team || !e.summon) continue;
        if (e.summonKind === 'skeleton') melee++;
        else if (e.summonKind === 'skeletonranged') ranged++;
      }
      const wantRanged = ranged < melee;
      return ((aid === 'skeletonranged') === wantRanged) ? caster : null;
    }
    return caster; // only one single unlocked -> just cast it
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
  if (aid === 'bonefield') {
    // drop it where the enemy actually IS: the nearest enemy unit in range, so
    // the bones land under the wave instead of on empty ground
    let best = null, bestD = Infinity;
    for (const u of game.entities) {
      if (u.team === caster.team || u.hp <= 0 || u.isStructure) continue;
      if (!inRadius(u, caster, p.range)) continue;
      const dx = u.x - caster.x, dy = u.y - caster.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }
  if (aid === 'acidpaste') {
    // nearest enemy GROUND unit in range (the paste sticks to the ground)
    let best = null, bestD = Infinity;
    for (const u of game.entities) {
      if (u.team === caster.team || u.hp <= 0 || u.isAir || u.isStructure) continue;
      if (!inRadius(u, caster, p.range)) continue;
      const dx = u.x - caster.x, dy = u.y - caster.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }
  if (aid === 'execute') {
    // nearest enemy unit already below the HP threshold — reaped instantly.
    // Reaps normal units, hero-summoned creatures (summons/clones/skeletons)
    // AND enemy heroes; only structures are immune.
    const th = (p.threshold || 0) / 100;
    let best = null, bestD = Infinity;
    for (const u of game.entities) {
      if (u.team === caster.team || u.hp <= 0 || u.isStructure) continue;
      if (u.hp > u.maxHp * th) continue; // still too healthy to execute
      if (!inRadius(u, caster, p.range)) continue;
      const dx = u.x - caster.x, dy = u.y - caster.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }
  if (aid === 'soullink') {
    // cast when there's at least one ally nearby to bind
    for (const a of game.entities) {
      if (a === caster || a.team !== caster.team || a.hp <= 0 || a.isStructure) continue;
      if (inRadius(a, caster, p.radius)) return caster;
    }
    return null;
  }
  if (aid === 'shadowrush') {
    // dive forward only when there ARE enemies in front of him (a line to slip
    // past). Requires at least one enemy unit ahead (toward the enemy side)
    // within reach — he won't blow it on an empty lane.
    const front = caster.team === 0 ? 1 : -1;
    for (const e of game.entities) {
      if (e.hp <= 0 || e.team === caster.team || e.isStructure) continue;
      if ((e.x - caster.x) * front > 20 && inRadius(e, caster, 700)) return caster;
    }
    return null;
  }
  if (aid === 'vanish') {
    // slip to the nearest enemy HERO in range; if there's no hero, the enemy
    // (non-structure) unit with the MOST HP in range. Deterministic tie-breaks.
    let hero = null, heroD = Infinity;
    let unit = null, unitHp = -1, unitTie = Infinity;
    for (const e of game.entities) {
      if (e.team === caster.team || e.hp <= 0 || e.isStructure) continue;
      if (!inRadius(e, caster, p.range)) continue;
      const dx = e.x - caster.x, dy = e.y - caster.y, d = dx * dx + dy * dy;
      if (e.hero) { if (d < heroD || (d === heroD && (!hero || e.id < hero.id))) { heroD = d; hero = e; } }
      else if (e.hp > unitHp || (e.hp === unitHp && d < unitTie)) { unitHp = e.hp; unitTie = d; unit = e; }
    }
    return hero || unit;
  }
  if (aid === 'twinshadows') {
    // summon clones when there's an enemy nearby to fight (avoid empty-lane casts)
    for (const e of game.entities) {
      if (e.team === caster.team || e.hp <= 0 || e.isStructure) continue;
      if (inRadius(e, caster, 360)) return caster;
    }
    return null;
  }
  if (aid === 'daggerthrow') {
    // throw when at least one enemy unit sits inside the link radius
    for (const e of game.entities) {
      if (e.team === caster.team || e.hp <= 0 || e.isStructure) continue;
      if (inRadius(e, caster, p.radius)) return caster;
    }
    return null;
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
    // Brothers Skeleton: raise a melee + a ranged skeleton (their stats come from
    // the two single abilities) from ONE corpse.
    if (aid === 'skeletonbrothers') {
      const corpse = nearestCorpse(game, caster, p.corpseRange || 0, time);
      const m = raiseSkeleton(game, caster, 'skeletonmelee');
      const r = raiseSkeleton(game, caster, 'skeletonranged');
      if (corpse) {
        m.x = m.prevX = corpse.x - 12; m.y = m.prevY = corpse.y;
        r.x = r.prevX = corpse.x + 12; r.y = r.prevY = corpse.y;
        game.corpses = game.corpses.filter((c) => c !== corpse);
      }
      const ex = corpse ? corpse.x : caster.x, ey = corpse ? corpse.y : caster.y;
      game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: ex, y: ey });
      game.events.push({ type: 'summon', x: ex, y: ey, team: caster.team });
      return hold;
    }
    // pass the caster's learned rank so the animal's HP/damage grow per-rank
    const rank = (caster.hero && caster.heroRanks) ? (caster.heroRanks[aid] || 1) : 1;
    // A cocoon isn't there the moment the spell fires: the moth has to finish
    // its laying pose first, so the pouch is queued for the end of the hold.
    if (ab.cocoon) {
      if (!game.pendingSummons) game.pendingSummons = [];
      game.pendingSummons.push({ casterId: caster.id, aid, at: time + hold, rank });
      game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
      return hold;
    }
    const animal = spawnSummon(game, caster, ab, p, rank);
    // Rise Dead / single skeletons are raised FROM a corpse: place there + consume
    if (aid === 'risedead' || aid === 'skeletonmelee' || aid === 'skeletonranged') {
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
    // absolute stats: the colossus HAS this much HP / damage / attack period.
    // 0 on any of them means "keep whatever the hero already had".
    const newMax = (p.morphHp || 0) > 0 ? Math.round(p.morphHp) : caster.maxHp;
    caster.hp = newMax > caster.maxHp
      ? Math.min(newMax, caster.hp + (newMax - caster.maxHp)) // gain the fresh chunk now
      : Math.min(caster.hp, newMax);                          // smaller form: clamp down
    caster.maxHp = newMax;
    caster.morph = {
      damage: p.morphDamage || 0,   // 0 = the hero's own damage
      period: p.morphPeriod || 0,   // 0 = the hero's own attack period
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

  if (aid === 'bonefield') {
    // the bones appear on the ground at once — no projectile to chase
    if (!game.boneFields) game.boneFields = [];
    game.boneFields.push({
      x: target.x, y: target.y,
      radius: p.radius || 0,
      atkSlow: p.atkSlow || 0, moveSlow: p.moveSlow || 0,
      until: time + (p.duration || 0),
      team: caster.team,
      // whose art the field wears: the OWNER (races are per-commander) and the
      // caster's type, so the renderer can find its uploaded effect image
      owner: caster.owner != null ? caster.owner : caster.team,
      unitType: caster.type,
      id: game.nextId++,
    });
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: target.x, y: target.y, radius: p.radius, dur: p.duration });
    return hold;
  }

  if (aid === 'acidpaste') {
    // spit a green glob at the target; where it lands it leaves a paste puddle
    // (impact() reads proj.paste and drops a pasteZone that amplifies damage).
    spawnProjectile(game, caster, {
      damage: p.damage || 0, dmgType: 'normal',
      projectileSpeed: p.projectileSpeed, projSize: 1,
    }, target);
    const proj = game.projectiles[game.projectiles.length - 1];
    proj.ability = aid; // draws the ability's own projectile sprite
    proj.paste = { radius: p.pasteRadius || 0, dur: p.pasteDuration || 0, amp: p.ampPct || 0 };
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, tx: target.x, ty: target.y });
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = p.projectileSpeed || CONFIG.PROJECTILE_SPEED;
    return Math.max(hold, speed > 0 ? dist / speed : 0);
  }

  if (aid === 'execute') {
    // reaped: only reached when the target is a below-threshold normal unit, so
    // a lethal blow finishes it (huge damage -> death event + corpse + hero XP)
    applyDamage(game, target, (target.maxHp || 1) * 100, 'normal');
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'execute', x: target.x, y: target.y, team: caster.team });
    return hold;
  }

  if (aid === 'soullink') {
    // bind up to maxLinks nearby allies. "Random" but lockstep-safe: order by a
    // deterministic hash of id + cast tick, so re-casts pick different allies.
    const stamp = Math.floor(time / CONFIG.FIXED_DT);
    const cands = [];
    for (const a of game.entities) {
      if (a === caster || a.team !== caster.team || a.hp <= 0 || a.isStructure) continue;
      if (inRadius(a, caster, p.radius)) cands.push(a);
    }
    const key = (id) => ((id * 2654435761 + stamp * 40503) >>> 0);
    cands.sort((x, y) => key(x.id) - key(y.id));
    caster.soulLinks = cands.slice(0, Math.max(1, p.maxLinks || 5)).map((a) => a.id);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'soullink', unitId: caster.id, team: caster.team });
    return hold;
  }

  if (aid === 'shadowrush') {
    // become invisible and SLIP forward on foot (phasing through enemies) to a
    // point in the backline — one-way, no teleport. updateAbilities walks him.
    const front = caster.team === 0 ? 1 : -1;
    caster.phaseTargetId = null; caster.phasePct = 0;
    caster.phaseToX = Math.max(40, Math.min(CONFIG.FIELD_W - 40, caster.x + front * (p.distance || 0)));
    caster.phaseToY = caster.y;
    caster.phaseSpeed = p.rushSpeed || 360;
    caster.phaseReach = 8;
    caster.phaseAfter = p.stealth || 0;
    caster.phaseUntil = time + 6;                       // safety timeout
    caster.stealthUntil = time + 6 + (p.stealth || 0);  // invisible for the whole slip
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    return hold;
  }

  if (aid === 'vanish') {
    // become invisible and start slipping toward the target ON FOOT — no
    // teleport. updateAbilities walks him in (phasing through enemies) and lands
    // the single critical backstab once he reaches strike range.
    const rank = (caster.hero && caster.heroRanks) ? (caster.heroRanks.vanish || 1) : 1;
    const perRank = p['backstabPct' + rank];
    const pct = (typeof perRank === 'number' && perRank > 0) ? perRank : (p.backstabPct || 0);
    caster.phaseTargetId = target.id;
    caster.phaseToX = null; caster.phaseToY = null;
    caster.phaseUntil = time + 5;               // safety timeout if the target flees
    caster.phasePct = pct;
    caster.phaseSpeed = p.approachSpeed || 300;
    caster.phaseReach = p.strikeRange || 30;
    caster.phaseAfter = p.stealth || 0;         // stealth kept briefly after the hit
    caster.stealthUntil = time + 5 + (p.stealth || 0); // invisible for the whole approach
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    return hold;
  }

  if (aid === 'twinshadows') {
    // spawn shadow clones that copy his attacks for a % of his damage. Their
    // damage snapshots his current effective damage at cast time.
    const rank = (caster.hero && caster.heroRanks) ? (caster.heroRanks.twinshadows || 1) : 1;
    const nRaw = p['clones' + rank];
    const n = Math.max(1, Math.round((typeof nRaw === 'number' && nRaw > 0) ? nRaw : (p.clones || 1)));
    const heroDmg = effStats(caster, game.ustatOf(caster)).damage || 0;
    const cloneDmg = heroDmg * (p.clonePct || 0) / 100;
    for (let i = 0; i < n; i++) spawnCloneShadow(game, caster, p, cloneDmg, i, n);
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    game.events.push({ type: 'summon', x: caster.x, y: caster.y, team: caster.team });
    return hold;
  }

  if (aid === 'daggerthrow') {
    // the channel (prepare) just ended: become INVINCIBLE and throw the blade.
    // Build the hit order as a nearest-neighbour chain — hero -> nearest enemy,
    // then from there to the next nearest not-yet-hit, ... through every enemy in
    // radius. The blade flies that chain (at daggerSpeed) then back to the hero;
    // while it flies, incoming damage is absorbed (0 HP lost) and tallied, and
    // the tally + baseDamage is split among the hit enemies when it returns.
    const pool = [];
    for (const e of game.entities) {
      if (e.team === caster.team || e.hp <= 0 || e.isStructure) continue;
      if (inRadius(e, caster, p.radius)) pool.push(e);
    }
    const chain = [];
    let cx = caster.x, cy = caster.y;
    while (pool.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const dx = pool[i].x - cx, dy = pool[i].y - cy, d = dx * dx + dy * dy;
        if (d < bd || (d === bd && pool[i].id < pool[bi].id)) { bd = d; bi = i; }
      }
      const e = pool.splice(bi, 1)[0];
      chain.push(e.id); cx = e.x; cy = e.y;
    }
    caster.daggerChain = chain;
    caster.daggerFlying = chain.length > 0;
    caster.daggerDist = 0; caster.daggerPrevDist = 0; caster.daggerElapsed = 0;
    // clamp the blade speed so a 0/tiny value in balance can't leave him frozen
    // and invincible: the blade must always visibly advance and finish.
    caster.daggerSpeed = Math.max(120, p.daggerSpeed || 420);
    caster.daggerSize = (p.daggerSize || 100) / 100;
    caster.daggerBase = p.baseDamage || 0;
    caster.daggerAbsorbed = 0;
    game.events.push({ type: 'cast', ability: aid, unitId: caster.id, team: caster.team, x: caster.x, y: caster.y, radius: p.radius });
    game.events.push({ type: 'daggerthrow', unitId: caster.id, team: caster.team, x: caster.x, y: caster.y });
    return hold; // the flight itself is driven in updateAbilities
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
