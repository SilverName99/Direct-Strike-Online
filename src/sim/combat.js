import { CONFIG } from '../config.js';
import { DAMAGE_MATRIX } from '../units.js';
import { spawnProjectile, spawnUnit } from './entity.js';
import { attackPeriodMult, applyEffect, effectVal, casterPrioritizesSpells, hasActiveAbility, stepCaster, learnedAbilityParams, isStunned } from './abilities.js';
import { resolvedUpgrade, towerStatForTier } from '../ui/balance.js';

// Effective stats: a dismounted "mount" unit fights on foot with its override
// damage/range/period/speed (and no projectile/splash — unless the override
// says the rider stays ranged, e.g. the Landing Split's axe thrower). A split
// beast uses the same override block with its own melee numbers.
export function effStats(u, stats) {
  // the hero gains flat damage per level (HP growth is baked in at spawn)
  if (u.hero && u.heroLevel > 1 && (stats.dmgPerLevel || 0) > 0) {
    stats = { ...stats, damage: stats.damage + (u.heroLevel - 1) * stats.dmgPerLevel };
  }
  // Hero "Charge" ability: drive the existing dash mechanic (long-range aggro +
  // charge-in) with its own params; the impact also stuns (chargeStun).
  const charge = u.hero ? learnedAbilityParams(u, 'charge') : null;
  if (charge) {
    stats = {
      ...stats, dash: true, dashRange: charge.range, dashSpeed: charge.dashSpeed,
      dashDamage: charge.damage, dashCd: charge.cooldown, chargeStun: charge.stun,
    };
  }
  // "Divine Buff" passive (Sword Saint): permanently faster + stronger attacks.
  // haste shortens the period; damageBonus scales the damage. Both grow per rank.
  const dbuff = u.hero ? learnedAbilityParams(u, 'divinebuff') : null;
  if (dbuff) {
    stats = {
      ...stats,
      damage: stats.damage * (1 + (dbuff.damageBonus || 0) / 100),
      period: stats.period * Math.max(0.25, 1 - (dbuff.haste || 0) / 100),
    };
  }
  // Elemental Form (hero ultimate): a giant MELEE beast — +damage, short reach, and
  // a splash applied in the melee branch (morphSplash/morphSplashPct). Being a
  // grounded melee colossus, it can no longer reach fliers (targetsAir off) even
  // if the base hero could hit air.
  if (u.morph) {
    return {
      ...stats,
      damage: stats.damage * u.morph.dmgMul,
      range: u.morph.range,
      projectile: false, ranged: false, splash: 0, targetsAir: false,
      morphSplash: u.morph.splash, morphSplashPct: u.morph.splashPct,
    };
  }
  // Bat "Aterizare": the LANDED form is a ground melee tank. Base stats are the
  // AIR form (flyer, air-only melee), so landing overrides to ground melee and
  // flips targeting (can't reach fliers while grounded; hits ground only).
  if (u.landed) {
    return {
      ...stats,
      damage: u.ovLandDamage != null ? u.ovLandDamage : stats.damage,
      range: u.ovLandRange != null ? u.ovLandRange : stats.range,
      period: u.ovLandPeriod != null ? u.ovLandPeriod : stats.period,
      speed: u.ovLandSpeed != null ? u.ovLandSpeed : stats.speed,
      projectile: false, ranged: false, splash: 0,
      isAir: false, targetsAir: false, targetsGround: true,
    };
  }
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
    // Scut de lumină: the activation pose has finished -> the shield "appears"
    // now (bright flash + ring), matching when invulnerability actually starts.
    if (u.shieldPending && game.time >= u.shieldFrom) {
      u.shieldPending = false;
      game.events.push({ type: 'shield', x: u.x, y: u.y, team: u.team, unitId: u.id });
    }
    const base = game.ustatOf(u);
    let stats = effStats(u, base);
    // Summoned animals are plain fighters with their own stats — they never
    // inherit the caster's upgrades or cast abilities.
    if (u.summon) {
      // a totem just stands there emitting its aura (see updateAbilities) —
      // no movement, no attack, no targeting.
      if (u.totem) { u.state = 'idle'; continue; }
      u.cooldown = Math.max(0, u.cooldown - dt);
      updateFighter(game, u, stats, dt);
      continue;
    }
    // "Scut de lumină" upgrade: below the HP threshold -> brief invulnerability
    maybeShield(game, u);
    // "Attack ground units" upgrade: grants a (normally air-only) unit the
    // ability to hit ground once its owner has bought the upgrade for its type.
    if (stats.targetsGround === false && groundUpgradeFor(game, u)) {
      stats = { ...stats, targetsGround: true };
    }
    // "Focus building" upgrade: the unit ignores enemy troops and only ever
    // targets structures (a siege breaker).
    if (focusBuildUpgradeFor(game, u)) {
      stats = { ...stats, buildingsOnly: true };
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
    // "Fireball" upgrade: the catapult lobs a fireball — direct/splash damage
    // (with a bonus vs buildings) that leaves a burning-ground zone dealing
    // damage over time to enemies standing in it.
    const fire = !acid && !u.dismounted ? fireUpgradeFor(game, u) : null;
    if (fire) {
      const p = fire.params;
      stats = {
        ...stats,
        heal: false, ranged: true, projectile: true,
        range: p.range, damage: p.damage,
        splash: p.splashRadius, projectileSpeed: p.projectileSpeed,
        buildingDamage: p.buildingDamage || 0,
        fire: { dps: p.zoneDps, dur: p.zoneDuration, radius: p.zoneRadius },
      };
      u.fireAttacker = true; // renderer -> "fire" walk/attack frames + fireball
    } else if (u.fireAttacker) {
      u.fireAttacker = false;
    }
    // "AoE Damage" upgrade: the unit's thrown projectile bursts on impact —
    // the struck target takes full damage, everyone else on the SAME plane
    // (air/ground) in the radius takes splashPower% of it. Applies to any of
    // its ranged forms (mounted, or a split rider still throwing).
    if (!acid && !fire && stats.projectile) {
      const aoe = aoeUpgradeFor(game, u);
      if (aoe) {
        stats = {
          ...stats,
          splash: Math.max(stats.splash || 0, aoe.params.splashRadius || 0),
          aoe: { power: (aoe.params.splashPower != null ? aoe.params.splashPower : 100) / 100 },
        };
      }
    }
    u.cooldown = Math.max(0, u.cooldown - dt);
    // "Landing Split" upgrade: a ground enemy close by makes the flyer dive
    // into it (dash damage on impact) and split into rider + beast — takes
    // over from normal combat while diving.
    if (!u.dismounted && !u.beast && trySplit(game, u)) continue;
    // Mount upgrade (e.g. boar rider): while still mounted, charge a ranged
    // intruder and dismount on arrival — takes over from normal combat.
    if (!u.dismounted && !u.beast && mountCharge(game, u)) continue;
    // Bat "Aterizare" upgrade: auto-toggle between the flying air form and the
    // grounded melee form (form flip only — the unit still fights this tick).
    const batUp = batLandUpgradeFor(game, u);
    if (batUp) updateBatLand(game, u, batUp);
    else if (u.landed) setBatLanded(game, u, false); // upgrade gone -> back to flying
    // A caster is defined by its active abilities and runs the prepare ->
    // release FSM before (and instead of) its basic action, whether it is a
    // healer or a fighter. It only falls through to the basic attack/heal
    // when out of mana (or the admin opted into auto-attacks between spells).
    if (hasActiveAbility(game, u, stats) && stepCasterHold(game, u, stats, dt)) continue;
    if (stats.gravedig) {
      updateGraveDigger(game, u, stats, dt);
    } else if (stats.heal) {
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

  // Burning ground (Fireball upgrade): each fire zone scorches enemy GROUND
  // units standing in it every tick, until it burns out.
  if (game.fireZones.length) {
    const kept = [];
    for (const z of game.fireZones) {
      if (game.time >= z.until) continue; // burned out -> dropped
      for (const e of game.entities) {
        if (e.team === z.team || e.hp <= 0 || e.isAir) continue;
        const dx = e.x - z.x; const dy = e.y - z.y;
        if (dx * dx + dy * dy <= z.radius * z.radius) {
          applyDamage(game, e, z.dps * dt, z.dmgType || 'normal', true);
          // Blizzard: the frost storm also slows everyone standing in it
          if (z.moveSlow) applyEffect(e, 'moveslow', z.moveSlow, game.time + 0.4, game.time);
        }
      }
      kept.push(z);
    }
    game.fireZones = kept;
  }

  // Armed structures (starting turret + built towers) shoot the nearest
  // enemy unit in range. A tower still under construction can't shoot yet.
  for (const s of game.structures) {
    if (s.hp <= 0 || s.building) continue;
    if (s.kind === 'turret') updateTurret(game, s, game.bstat(s.team, 'turret'), dt);
    else if (s.kind === 'tower') {
      // towers scale their HP / damage / period / projectile-count with the
      // owner's base tier (arrows per tier are configurable, default 1/2/3)
      const bs = game.bstat(s.team, 'tower');
      const tn = Math.max(1, Math.min(3, game.tier[s.team]));
      const st = towerStatForTier(bs, tn);
      updateTurret(game, s, { ...bs, hp: st.hp, damage: st.damage, period: st.period }, dt, Math.max(1, Math.round(st.shots || 1)));
    }
    // the main base only shoots if given an attack (damage > 0) in ⚙ stats
    else if (s.kind === 'main') {
      const ms = game.bstat(s.team, 'main');
      if (ms.damage > 0) updateTurret(game, s, ms, dt);
    }
  }
}

// The `shots` nearest enemies to the turret that are in range and targetable,
// closest first (used by multi-arrow towers).
function nearestEnemies(game, turret, stats, canTarget, n) {
  const cands = [];
  for (const e of game.entities) {
    if (e.team === turret.team || e.hp <= 0 || !canTarget(e)) continue;
    const d = effDist(turret, e);
    if (d <= stats.range) cands.push({ e, d });
  }
  cands.sort((a, b) => a.d - b.d);
  const out = [];
  for (let i = 0; i < Math.min(n, cands.length); i++) out.push(cands[i].e);
  return out;
}

function updateTurret(game, turret, stats, dt, shots = 1) {
  turret.cooldown = Math.max(0, turret.cooldown - dt);
  // a structure with targetsAir:false can't shoot fliers (turret/tower default on)
  const canTarget = (e) => !(e.isAir && stats.targetsAir === false);

  let target = game.byId.get(turret.targetId) || null;
  if (target && !(target.hp > 0 && canTarget(target) && effDist(turret, target) <= stats.range)) {
    target = null;
    turret.targetId = null;
  }
  if (!target) {
    let bestD = Infinity;
    for (const e of game.entities) {
      if (e.team === turret.team || !canTarget(e)) continue;
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
    // one arrow per shot; multi-shot towers spread across the nearest enemies
    // (extra arrows round-robin back onto them when fewer enemies are in range)
    const n = Math.max(1, shots);
    const list = n > 1 ? nearestEnemies(game, turret, stats, canTarget, n) : null;
    const targets = list && list.length ? list : [target];
    for (let i = 0; i < n; i++) {
      const tg = targets[i % targets.length];
      if (!tg || tg.hp <= 0) continue;
      spawnProjectile(game, turret, stats, tg);
      game.events.push({ type: 'shot', x: turret.x, y: turret.y, tx: tg.x, ty: tg.y, team: turret.team });
    }
  }
}

// Effective attack range: a unit can always strike what it is physically
// Attack reach, compared against effDist (a box-edge GAP): the configured
// range is the honest edge-to-edge reach. The +4 floor lets an admin-set
// "0 range" melee unit still land hits while the separation pass holds the
// bodies apart (they can touch but never overlap).
function atkRange(u, stats) {
  return Math.max(stats.range || 0, 4);
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

  // No offensive spell targets a building — a caster/hero engaged with a
  // structure (tower/base) that couldn't cast this tick must NOT idle waiting;
  // fall through and just basic-attack it.
  if (target && target.isStructure) return false;

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
  // Stunned (Charge impact): can neither move (moveSpeedMult=0) nor act
  if (isStunned(u, game.time)) { u.windup = 0; u.dashing = false; u.dashCharge = false; return; }
  // Vortex of Light: the Sword Saint keeps marching THROUGH the enemies while it
  // spins — no normal attack (the AoE in updateAbilities does the damage).
  if ((u.vortexUntil || 0) > game.time) {
    const t = acquireTarget(game, u, stats);
    u.targetId = t ? t.id : null;
    u.state = 'march'; u.windup = 0; u.dashing = false; u.dashCharge = false;
    return;
  }

  let target = game.byId.get(u.targetId) || null;
  if (target && !isValidTarget(u, stats, target, aggroRange(stats))) {
    target = null;
    u.targetId = null;
  }
  // Focus discipline: once ENGAGED (target inside attack range) stay on that
  // target; while approaching, chase the nearest enemy — but with hysteresis:
  // switch only for a CLEARLY closer foe, and never mid-swing. Without the
  // margin, two foes at near-equal distance (constantly shoved around by the
  // separation pass) swap "nearest" every tick — the unit trembles between
  // them and every wind-up is cancelled before the projectile ever leaves.
  if (!target) {
    target = acquireTarget(game, u, stats);
    u.targetId = target ? target.id : null;
  } else if (u.windup <= 0 && effDist(u, target) > atkRange(u, stats) + 14) {
    const nearest = acquireTarget(game, u, stats);
    if (nearest && nearest !== target && effDist(u, nearest) < effDist(u, target) - 24) {
      target = nearest;
      u.targetId = target.id;
    }
  }

  // Hysteresis: once engaged, stay engaged until clearly out of range —
  // otherwise back-row units shoved across the range boundary by the
  // separation pass flicker between attack and march every tick.
  const rangeBonus = u.state === 'attack' ? 14 : 0;
  // Structures are big, static objectives crowded by many attackers. Give a
  // melee reach bonus vs a structure so a unit stuck one body-row back (behind
  // teammates packed on the perimeter) still connects instead of idling at the
  // fringe of its range. Doesn't affect unit-vs-unit combat.
  const structBonus = target && target.isStructure ? 18 : 0;
  const inRange = !!target && effDist(u, target) <= atkRange(u, stats) + rangeBonus + structBonus;

  // Dash (charge): while a target sits inside dashRange but out of attack
  // range, the unit commits to a dash and closes at dashSpeed (movement.js
  // reads u.dashing); on arrival it lands a one-off dashDamage burst.
  // NEVER at a structure: charging a tower/base yanked the hero past the
  // building it was hitting and left it stranded (it stopped attacking).
  u.dashing = false;
  if (stats.dash && target && !target.isStructure) {
    const ready = game.time >= (u.dashReadyAt || 0);
    if (!inRange && ready && effDist(u, target) <= (stats.dashRange || 0)) {
      u.dashing = true;
      u.dashVel = stats.dashSpeed;
      u.dashCharge = true;
    } else if (inRange && u.dashCharge) {
      applyDamage(game, target, stats.dashDamage || 0, stats.dmgType);
      // Charge (hero): a brief stun on impact
      if ((stats.chargeStun || 0) > 0 && target.hp > 0) {
        applyEffect(target, 'stun', 1, game.time + stats.chargeStun, game.time);
      }
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
          // Poison Arrow (Spirit Huntress passive): while she has mana, every
          // arrow spends manaPerShot and lands a poison damage-over-time, using
          // the Poison Arrow sprite. Out of mana -> plain arrows.
          let shotStats = stats;
          // structures can't be poisoned -> she fires a plain arrow and spends
          // no mana when the target is a building
          const pa = (u.hero && !target.isStructure) ? learnedAbilityParams(u, 'poisonarrow') : null;
          if (pa) {
            const cost = pa.manaPerShot || 0;
            if ((u.mana || 0) >= cost) {
              u.mana = (u.mana || 0) - cost;
              shotStats = { ...stats, acid: { dot: pa.dps || 0, dur: pa.dotDuration || 0 }, projAbility: 'poisonarrow' };
            }
          }
          // Ranged skeleton (Necromancer summon): its arrow uses the dedicated
          // "Proiectil Ranged Skeleton" sprite hosted on the Necromancer, so it
          // looks different from the Necromancer's own shot.
          if (u.summon && u.summonKind === 'skeletonranged') {
            shotStats = { ...shotStats, projAbility: 'skeletonranged' };
          }
          spawnProjectile(game, u, shotStats, target);
          game.events.push({ type: 'shot', x: u.x, y: u.y, tx: target.x, ty: target.y, team: u.team });
        } else {
          const dmg = dmgVsTarget(stats.damage, stats.buildingDamage, target);
          applyDamage(game, target, dmg, stats.dmgType);
          // Cleave (hero passive): splash a % of the melee hit to other ground
          // enemies around the struck target
          const cl = learnedAbilityParams(u, 'cleave');
          if (cl) {
            const r = cl.radius || 0;
            const cd = dmg * (cl.cleavePct || 0) / 100;
            if (r > 0 && cd > 0) {
              for (const e of game.entities) {
                if (e === target || e.team === u.team || e.hp <= 0 || e.isAir || e.isStructure) continue;
                const dx = e.x - target.x;
                const dy = e.y - target.y;
                if (dx * dx + dy * dy <= r * r) applyDamage(game, e, cd, stats.dmgType);
              }
            }
          }
          // Elemental Form: the giant beast's melee hit splashes nearby enemies
          if (stats.morphSplash > 0 && stats.morphSplashPct > 0) {
            const r = stats.morphSplash;
            const sd = dmg * stats.morphSplashPct;
            for (const e of game.entities) {
              if (e === target || e.team === u.team || e.hp <= 0 || e.isStructure) continue;
              const dx = e.x - target.x;
              const dy = e.y - target.y;
              if (dx * dx + dy * dy <= r * r) applyDamage(game, e, sd, stats.dmgType);
            }
          }
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

// Grave Digger (Undead): a non-combat unit. It marches with the army; when an
// enemy comes within digRange it stops and digs corpses out of the ground (one
// every digInterval, hopping to a fresh spot each time); with the flee upgrade,
// an enemy inside fleeRange makes it run for home. Its movement is fully handled
// here (movement.js skips grave diggers), so `state` is only a render pose.
function updateGraveDigger(game, u, stats, dt) {
  u.windup = 0; u.dashing = false; u.dashCharge = false; u.targetId = null;
  // nearest living enemy UNIT (structures don't trigger it)
  let nd2 = Infinity, nx = 0, ny = 0;
  for (const e of game.entities) {
    if (e.team === u.team || e.hp <= 0 || e.isStructure) continue;
    const dx = e.x - u.x, dy = e.y - u.y, d2 = dx * dx + dy * dy;
    if (d2 < nd2) { nd2 = d2; nx = e.x; ny = e.y; }
  }
  const nd = Math.sqrt(nd2);
  const digRange = stats.digRange || 0;
  const fleeRange = stats.fleeRange || 0;
  const fleeOn = game.upgradeActive(u.team, 'gravedigflee');

  // 1) FLEE (upgrade only): a threat is dangerously close -> run away, toward home.
  if (fleeOn && nd <= fleeRange) {
    u.digTimer = 0; u.digTargetX = null;
    const home = game.mainOf(u.team);
    let ax = u.x - nx, ay = u.y - ny; // away from the enemy
    if (home) { ax += (home.x - u.x) * 0.5; ay += (home.y - u.y) * 0.5; } // biased home
    const al = Math.hypot(ax, ay) || 1;
    const sp = stats.fleeSpeed || stats.speed || 100;
    u.x += (ax / al) * sp * dt; u.y += (ay / al) * sp * dt;
    u.mvx = ax / al; u.mvy = ay / al; u.state = 'march';
    return;
  }

  // 2) DIG: an enemy is within reach -> dig here, then hop to a fresh grave.
  if (digRange > 0 && nd <= digRange) {
    if (u.digTargetX == null) { u.digTargetX = u.x; u.digTargetY = u.y; }
    const dx = u.digTargetX - u.x, dy = u.digTargetY - u.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 6) { // walk to the grave spot
      const step = Math.min((stats.speed || 70) * dt, dist);
      u.x += (dx / dist) * step; u.y += (dy / dist) * step;
      u.mvx = dx / dist; u.mvy = dy / dist; u.state = 'march';
    } else { // at the spot: dig
      u.state = 'attack'; // "digging" pose
      u.digTimer = (u.digTimer || 0) + dt;
      if (u.digTimer >= (stats.digInterval || 4)) {
        u.digTimer = 0;
        game.addCorpse(u.x, u.y, !!stats.digBig, true);
        game.events.push({ type: 'dig', x: u.x, y: u.y, team: u.team });
        u.digCount = (u.digCount || 0) + 1;
        // next grave within hopRadius (deterministic hash -> angle + distance)
        const hop = stats.hopRadius || 0;
        const h1 = ((u.id * 2654435761 + u.digCount * 40503) >>> 0) / 4294967296;
        const h2 = ((u.id * 40503 + (u.digCount + 7) * 2654435761) >>> 0) / 4294967296;
        const ang = h1 * Math.PI * 2, r = hop * (0.4 + 0.6 * h2);
        u.digTargetX = u.x + Math.cos(ang) * r; u.digTargetY = u.y + Math.sin(ang) * r;
      }
    }
    return;
  }

  // 3) Nobody near -> advance WITH the army. It marches as long as it isn't the
  //    FRONT-MOST unit: an ally that's alongside or ahead (i.e. not clearly
  //    behind it) counts as support, so it moves off with the pack from spawn
  //    instead of waiting for someone to pull past it. Only when every ally is
  //    well behind it (it would lead the charge alone) does it hold — a
  //    non-combat unit shouldn't walk into the enemy by itself.
  u.digTimer = 0; u.digTargetX = null;
  const enemyMain = game.mainOf(1 - u.team);
  const dir = enemyMain ? (Math.sign(enemyMain.x - u.x) || 1) : (u.team === 0 ? 1 : -1);
  let allyAhead = false;
  for (const a of game.entities) {
    if (a === u || a.team !== u.team || a.hp <= 0 || a.isStructure) continue;
    if ((a.x - u.x) * dir > -25) { allyAhead = true; break; } // alongside or ahead
  }
  if (allyAhead) {
    u.x += (stats.speed || 70) * dt * dir;
    u.mvx = dir; u.mvy = 0; u.state = 'march';
  } else {
    u.state = 'idle'; u.mvx = 0; u.mvy = 0;
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
  // hold position, but as 'hold' (not 'attack') so the renderer shows a calm
  // idle instead of a healer frozen mid-heal pose
  u.state = best || someoneAhead ? 'march' : 'hold';
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

// True if this team owns an active "Focus building" (kind 'focusbuild')
// upgrade for u's type — the unit then attacks only structures.
function focusBuildUpgradeFor(game, u) {
  for (const id of game.upgrades[u.team]) {
    if (!game.upgradeActive(u.team, id)) continue; // owned but toggled off
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'focusbuild' && up.unit === u.type && (!up.race || up.race === game.races[u.team])) return true;
  }
  return false;
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

// The active "Aterizare" (kind 'batland') upgrade for u's type, else null.
function batLandUpgradeFor(game, u) {
  for (const id of game.upgrades[u.team]) {
    if (!game.upgradeActive(u.team, id)) continue;
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'batland' && up.unit === u.type && (!up.race || up.race === game.races[u.team])) return up;
  }
  return null;
}

// Flip the bat between its AIR form (base stats: flyer, air-only melee) and its
// grounded melee form. Landing stashes the ground overrides read by effStats and
// clears isAir so it collides/renders/gets-hit as a ground unit; taking off
// restores the flyer. Armor while landed comes from the unit's `landArmor`.
function setBatLanded(game, u, landed) {
  if (!!u.landed === !!landed) return;
  if (landed) {
    const up = batLandUpgradeFor(game, u);
    const p = (up && up.params) || {};
    u.landed = true;
    u.isAir = false;
    u.ovLandDamage = (p.groundDamage || 0) > 0 ? p.groundDamage : null;
    u.ovLandRange = (p.groundRange || 0) > 0 ? p.groundRange : null;
    u.ovLandPeriod = (p.groundPeriod || 0) > 0 ? p.groundPeriod : null;
    u.ovLandSpeed = (p.groundSpeed || 0) > 0 ? p.groundSpeed : null;
    const base = game.ustatOf(u);
    if (base && base.landArmor) { u.armorSaved = u.armor; u.armor = base.landArmor; }
    game.events.push({ type: 'land', team: u.team, x: u.x, y: u.y, unitId: u.id });
  } else {
    u.landed = false;
    u.isAir = true;
    u.ovLandDamage = u.ovLandRange = u.ovLandPeriod = u.ovLandSpeed = null;
    if (u.armorSaved != null) { u.armor = u.armorSaved; u.armorSaved = null; }
    game.events.push({ type: 'takeoff', team: u.team, x: u.x, y: u.y, unitId: u.id });
  }
}

// Auto land/take-off decision, once the bat owns the Aterizare upgrade: land when
// a ground enemy (or enemy building) is within `radius` and nothing to bite up
// high; return to flying as soon as the ground is clear. A short cooldown between
// flips prevents thrash at the range boundary.
function updateBatLand(game, u, up) {
  if ((u.batCd || 0) > game.time) return;
  const r = up.params.radius || 0, r2 = r * r;
  let groundEnemy = false, airEnemy = false;
  for (const e of game.entities) {
    if (e.hp <= 0 || e.team === u.team || e.isStructure) continue;
    const dx = e.x - u.x, dy = e.y - u.y;
    if (dx * dx + dy * dy > r2) continue;
    if (e.isAir) airEnemy = true; else groundEnemy = true;
  }
  if (!groundEnemy) {
    for (const s of game.structures) {
      if (s.hp <= 0 || s.team === u.team) continue;
      const dx = s.x - u.x, dy = s.y - u.y;
      if (dx * dx + dy * dy <= r2) { groundEnemy = true; break; }
    }
  }
  // desired form: airborne -> land only vs a ground threat with no air target;
  // landed -> stay down while a ground threat remains, else take off.
  const wantLanded = u.landed ? groundEnemy : (groundEnemy && !airEnemy);
  if (wantLanded !== !!u.landed) {
    setBatLanded(game, u, wantLanded);
    u.batCd = game.time + 2; // anti-thrash cooldown between flips
  }
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

// The active "Scut de lumină" (kind 'shield') upgrade for u's type, else null.
// The active 'shield' upgrade for this team (whatever unit it's attached to),
// or null. The upgrade's `unit` is the SOURCE (e.g. the Lightblade Weaver) that
// projects the shield onto itself and onto nearby allies.
function teamShieldUpgrade(game, team) {
  for (const id of game.upgrades[team]) {
    if (!game.upgradeActive(team, id)) continue;
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'shield' && (!up.race || up.race === game.races[team])) return up;
  }
  return null;
}

// Grant the light shield to a unit. The unit first holds an activation pose for
// `poseTime`; the invulnerability + dome (and the light flash) only kick in
// AFTER the pose finishes, and last `duration`, then a cooldown before it can be
// shielded again.
function applyShield(game, u, p, now) {
  const pose = Math.max(0, p.poseTime != null ? p.poseTime : 0.5);
  u.shieldAt = now;               // pose starts now
  u.shieldFrom = now + pose;      // invulnerability + dome begin here
  u.shieldUntil = u.shieldFrom + (p.duration || 3);
  u.shieldCd = u.shieldUntil + (p.cooldown || 0);
  u.shieldScale = Math.max(0.2, Math.min(6, (p.shieldSize || 100) / 100));
  u.shieldPose = pose;
  u.shieldPending = true;         // the light flash fires when the pose ends
}

// Trigger the shield the instant a unit drops below its HP threshold (and isn't
// already shielded / on cooldown). While shielded, applyDamage ignores hits.
// The SOURCE unit (the upgrade's `unit`, e.g. the Weaver) always shields
// itself; in addition, up to `allies` nearby allies get the same shield —
// whoever drops below the threshold first claims a slot until it frees up.
function maybeShield(game, u) {
  const up = teamShieldUpgrade(game, u.team);
  if (!up) return;
  const now = game.time;
  if ((u.shieldUntil && now < u.shieldUntil) || (u.shieldCd && now < u.shieldCd)) return;
  const p = up.params;
  const thresh = Math.max(1, Math.min(99, p.threshold || 50)) / 100;
  if (!(u.hp > 0 && u.hp < u.maxHp * thresh)) return;

  // the source unit always protects itself
  if (u.type === up.unit) { applyShield(game, u, p, now); return; }

  // ally path: needs a living source (Weaver) in range and a free ally slot
  const cap = Math.max(0, Math.round(p.allies != null ? p.allies : 1));
  if (cap <= 0) return;
  const range = p.allyRange || 0; // 0 = whole field
  let sourceNear = false;
  let shieldedAllies = 0;
  for (const e of game.entities) {
    if (e.team !== u.team || e.hp <= 0) continue;
    if (e.type === up.unit) {
      if (!sourceNear && (range <= 0 ||
          (e.x - u.x) ** 2 + (e.y - u.y) ** 2 <= range * range)) sourceNear = true;
    } else if (e !== u && e.shieldUntil && now < e.shieldUntil) {
      shieldedAllies++;
    }
  }
  if (sourceNear && shieldedAllies < cap) applyShield(game, u, p, now);
}

// The active "Fireball" (kind 'fire') upgrade transforming u's type, else null.
function fireUpgradeFor(game, u) {
  for (const id of game.upgrades[u.team]) {
    if (!game.upgradeActive(u.team, id)) continue;
    const up = resolvedUpgrade(id);
    if (up && up.kind === 'fire' && up.unit === u.type && (!up.race || up.race === game.races[u.team])) return up;
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
// A GROUND enemy unit within `radius`, alive.
function isGroundFoe(game, u, e, radius) {
  if (e.hp <= 0 || e.team === u.team || e.isAir) return false;
  return effDist(u, e) <= radius;
}
function findGroundIntruder(game, u, radius) {
  let best = null;
  let bestD = Infinity;
  for (const e of game.entities) {
    if (!isGroundFoe(game, u, e, radius)) continue;
    const d = effDist(u, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// While still whole (mounted/airborne): the first GROUND enemy inside the
// trigger radius makes the flyer DIVE at it (dash — shows the "Dash" frame);
// on impact it deals the one-off dash damage to that ground unit, LANDS and
// splits into TWO units for the rest of this life — `u` becomes the rider on
// foot (dismounted overrides + "foot-" sprites) and a fresh beast entity (the
// mount) spawns beside it with its own HP and melee stats ("beast-" sprites).
// Returns true while diving and on the split tick, so normal combat is
// skipped.
function trySplit(game, u) {
  const up = splitUpgradeFor(game, u);
  if (!up) { u.splitTargetId = null; return false; }
  const p = up.params;
  let target = u.splitTargetId != null ? game.byId.get(u.splitTargetId) : null;
  if (target && !isGroundFoe(game, u, target, p.radius)) target = null;
  if (!target) target = findGroundIntruder(game, u, p.radius);
  if (!target) { u.splitTargetId = null; u.dashing = false; return false; }

  u.splitTargetId = target.id;
  u.targetId = target.id;
  // arrival = physical contact with the dived unit (the impact is a body slam,
  // regardless of how far the rider can throw)
  const arriveR = (u.radius || 0) + 4 + 14;
  if (effDist(u, target) > arriveR) {
    // still diving in
    u.dashing = true;
    u.dashVel = p.dashSpeed;
    u.state = 'march';
    u.windup = 0;
    return true;
  }

  // impact: the dash damage lands on the ground unit that triggered the dive
  applyDamage(game, target, p.dashDamage || 0, game.ustat(u.team, u.type).dmgType);
  game.events.push({ type: 'dash', x: u.x, y: u.y, tx: target.x, ty: target.y, team: u.team });

  const bs = game.ustat(u.team, u.type);
  // the rider lands and fights on foot from now on
  u.dismounted = true;
  u.isAir = false;
  u.dashing = false;
  u.splitTargetId = null;
  u.ovDamage = p.dmDamage; u.ovRange = p.dmRange; u.ovPeriod = p.dmPeriod; u.ovSpeed = p.dmSpeed;
  u.ovRanged = !!p.dmRanged;
  u.ovSize = (p.dmSize != null ? p.dmSize : 100) / 100;
  u.radius = Math.max(5, (bs.radius || 10) * u.ovSize);
  u.footprint = false; u.hw = u.hh = u.radius; // on-foot/beast bodies are round
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
  b.footprint = false; b.hw = b.hh = b.radius;

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
  // The whole point of the boar rider is to dive PAST the front line and land on
  // the squishy ranged backline. Among the ranged foes inside the trigger
  // radius, pick the one standing DEEPEST in enemy territory (furthest forward
  // from our side), not the nearest — otherwise it just charges a front-row
  // archer and wastes the leap.
  const dir = u.team === 0 ? 1 : -1; // our forward direction (deeper enemy = further this way)
  let best = null;
  let bestDepth = -Infinity;
  for (const e of game.entities) {
    if (!isRangedFoe(game, u, e, radius)) continue;
    const depth = e.x * dir;
    if (depth > bestDepth) { bestDepth = depth; best = e; }
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
  u.footprint = false; u.hw = u.hh = u.radius; // on-foot/beast bodies are round
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
  // "Focus building": skip enemy troops entirely, only structures count
  if (!stats.buildingsOnly) {
    for (const e of game.entities) {
      if (e.team === u.team) continue;
      if (!canHit(stats, e)) continue;
      const d = effDist(u, e);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
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
  if (stats.buildingsOnly && !target.isStructure) return false; // Focus building
  return target.hp > 0 && canHit(stats, target) && effDist(u, target) <= maxDist;
}

function canHit(stats, target) {
  if (target.isAir) return !!stats.targetsAir;
  return stats.targetsGround !== false; // default: can hit ground
}

// The damage a unit deals to THIS target: a special "building damage" (when set
// > 0) replaces the normal damage against structures; everyone else takes the
// normal damage. Applies always — the "Focus building" upgrade only changes
// WHO gets targeted, not this modifier.
function dmgVsTarget(dmg, buildingDmg, target) {
  return target.isStructure && buildingDmg > 0 ? buildingDmg : dmg;
}

// Distance minus the target's radius, so melee can strike large bodies/bases.
// Gap between two bodies' BOXES (units carry hw/hh footprint half-extents;
// 1x1 units and round structures fall back to their radius). The old
// center-minus-one-radius model spanned a tall unit's LARGEST dimension in
// every direction — a 1x2 hero "reached" 40 units sideways with a 20-wide
// body, so two range-25 melee heroes stood a full cell apart. The box gap is
// honest on both axes and both bodies count.
function effDist(a, b) {
  const ax = a.hw ?? a.radius ?? 0;
  const ay = a.hh ?? a.radius ?? 0;
  const bx = b.hw ?? b.radius ?? 0;
  const by = b.hh ?? b.radius ?? 0;
  const dx = Math.max(0, Math.abs(a.x - b.x) - ax - bx);
  const dy = Math.max(0, Math.abs(a.y - b.y) - ay - by);
  return Math.sqrt(dx * dx + dy * dy);
}

export function applyDamage(game, target, damage, dmgType, silent = false) {
  // "Scut de lumină" upgrade: a shielded unit takes no damage at all — but only
  // once the activation pose has finished (game.time in [shieldFrom, shieldUntil]).
  if (target.shieldUntil && game.time >= (target.shieldFrom || 0) && game.time < target.shieldUntil) return;
  // tolerate a unit with no configured damage type (e.g. one flipped from
  // healer to fighter in the admin) — fall back to plain 'normal' damage
  const row = DAMAGE_MATRIX[dmgType] || DAMAGE_MATRIX.normal;
  const mult = row[target.armor];
  let dmg = damage * mult;
  // Devotion Aura: allies inside the Paladin's aura take less damage
  const reduce = effectVal(target, 'dmgReduce', game.time);
  if (reduce > 0) dmg *= 1 - Math.min(reduce, 90) / 100;
  target.hp -= dmg;
  if (!silent) game.events.push({ type: 'hit', x: target.x, y: target.y, big: !!target.isBase });
  if (target.hp <= 0 && !target.isBase) {
    game.creditHeroKill(target); // your hero earns XP when your army kills a unit
    game.events.push({
      type: 'death',
      x: target.x, y: target.y,
      team: target.team,
      radius: target.radius,
      unitType: target.type || null,
      dismounted: !!target.dismounted, // corpse uses the on-foot "foot-die" sprite
      beast: !!target.beast,           // split mount corpse -> "beast-die" sprite
      summonKind: target.summon ? target.summonKind : null, // -> "<animal>-die"
      footScale: (target.dismounted || target.beast || target.summon) ? (target.ovSize || 1) : null,
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
  // Fireball: drop a burning-ground zone where it lands (damages enemies over
  // time). The direct/splash hit below still applies normally.
  if (p.fire) {
    game.fireZones.push({ x: p.tx, y: p.ty, radius: p.fire.radius, dps: p.fire.dps, until: game.time + p.fire.dur, team: p.team, dmgType: p.dmgType });
    game.events.push({ type: 'explosion', x: p.tx, y: p.ty, radius: p.fire.radius, fire: true });
  }
  if (p.splash > 0) {
    game.events.push({ type: 'explosion', x: p.tx, y: p.ty, radius: p.splash, acid: !!p.acid });
    for (const e of game.entities) {
      if (e.team === p.team) continue;
      if (p.aoe) {
        // AoE upgrade: the burst stays on the struck target's plane —
        // hit an air unit -> air-only splash, hit a ground unit -> ground-only
        if (e.isAir !== p.targetAir) continue;
      } else if (e.isAir && !p.acid) {
        continue; // ordinary splash is ground-only; acid corrodes fliers too
      }
      const dx = e.x - p.tx;
      const dy = e.y - p.ty;
      if (dx * dx + dy * dy <= p.splash * p.splash) {
        // AoE: the struck target takes FULL damage, bystanders splashPower%
        const dmg = p.aoe && e.id !== p.targetId ? p.damage * p.aoe.power : p.damage;
        applyDamage(game, e, dmg, p.dmgType);
        // acid pool: everyone caught keeps taking damage over time
        if (p.acid) applyEffect(e, 'acid', p.acid.dot, game.time + p.acid.dur, game.time);
        // ability splash (Bigger Frost Bolt): the slow lands on EVERYONE caught
        if (p.ability && p.effectSpec && !e.isStructure) {
          const spec = p.effectSpec; const until = game.time + spec.duration;
          if (spec.moveSlow) applyEffect(e, 'moveslow', spec.moveSlow, until, game.time);
          if (spec.atkSlow) applyEffect(e, 'atkslow', spec.atkSlow, until, game.time);
        }
      }
    }
    // splash also chips enemy structures caught in the blast (an AoE burst on
    // the AIR plane never touches buildings)
    if (!p.aoe || !p.targetAir) {
      for (const s of game.enemyStructures(p.team)) {
        const sdx = s.x - p.tx;
        const sdy = s.y - p.ty;
        if (Math.sqrt(sdx * sdx + sdy * sdy) <= p.splash + s.radius) {
          const base = dmgVsTarget(p.damage, p.buildingDamage, s);
          const dmg = p.aoe && s.id !== p.targetId ? base * p.aoe.power : base;
          applyDamage(game, s, dmg, p.dmgType);
        }
      }
    }
  } else if (target && target.hp > 0) {
    applyDamage(game, target, dmgVsTarget(p.damage, p.buildingDamage, target), p.dmgType);
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
