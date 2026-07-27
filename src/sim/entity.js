import { CONFIG } from '../config.js';
import { towerStatForTier } from '../ui/balance.js';

// `owner` = the PLAYER the unit belongs to (stats/economy); `team` stays the
// battlefield SIDE (targeting). In 1v1 they coincide, so the default keeps
// every existing call site identical.
export function spawnUnit(game, team, type, x, y, owner = team) {
  const s = game.ustat(owner, type);
  // A footprint bigger than 1x1 (grid cells) makes the unit physically larger:
  // its collision/separation radius grows to span the cells. 1x1 keeps the
  // unit's own base radius (backwards-compatible with every existing unit).
  const cw = s.cw || 1;
  const ch = s.ch || 1;
  const cells = Math.max(cw, ch);
  const radius = cells > 1 ? (cells * CONFIG.GRID) / 2 : s.radius;
  // Per-axis half-extents so a rectangular unit (e.g. 2x1) separates as a
  // RECTANGLE, not a circle of its longest side — otherwise a column of wide
  // units thinks it overlaps vertically and shoves itself out of formation.
  const footprint = cw > 1 || ch > 1;
  const hw = footprint ? (cw * CONFIG.GRID) / 2 : s.radius;
  const hh = footprint ? (ch * CONFIG.GRID) / 2 : s.radius;
  const e = {
    id: game.nextId++,
    team, owner, type,
    x, y, prevX: x, prevY: y,
    hp: s.hp, maxHp: s.hp,
    cooldown: 0,
    windup: 0,      // >0 while a strike is winding up (attack 1 -> attack 2)
    windupMax: 0,   // total windup for the current swing (for anim progress)
    effects: [],    // active status effects [{kind, val, until}]
    abilityCd: {},    // abilityId -> game.time when it can cast again
    auraUntil: {},    // castaura id -> game.time the raised buff-zone expires
    castState: null,  // null | 'prepare' | 'release' — active-cast FSM phase
    castAbility: null,// ability id currently being cast (drives the render pose)
    castTargetId: null,
    castManual: false,// true while a player-triggered (manual) cast is in flight
    castPhaseEnd: 0,  // game.time when the current cast phase ends
    // Spirit Huntress timed states
    drainUntil: 0, drainTargetId: null, // Life Drain channel
    harvestUntil: 0, harvest: null,     // Soul Harvest form (dual-zone drain/heal)
    spellHold: false, // caster is holding at range, saving up for a spell
    dashing: false,   // charging in at dashSpeed toward a target in dashRange
    dashCharge: false,// a dash is committed; its bonus lands on arrival
    dashReadyAt: 0,   // game.time when the next dash is allowed (cooldown)
    dashVel: 0,       // effective charge speed while dashing (set by combat)
    // Grave Digger (Undead): dig timer + current grave spot + count of graves dug
    digTimer: 0, digTargetX: null, digTargetY: null, digCount: 0,
    // "Dashing & Fleeing mount" upgrade: charge a ranged intruder, then fight
    // on foot with dismounted stat overrides for the rest of this life.
    // "Landing Split" reuses the same overrides for the landed rider, and
    // marks the spawned mount with `beast` (its own ov* stats + beast sprites).
    mountTargetId: null,
    splitTargetId: null, // "Landing Split": the ground unit being dived at
    dismounted: false,
    beast: false,
    // Elemental Form (hero ultimate): while morphUntil > time the hero is a giant
    // melee beast (see effStats). maxHp is boosted at cast and restored on
    // revert, so the pre-morph values are stashed here.
    morphUntil: 0,
    morph: null,            // { dmgMul, size, splash, splashPct, range } snapshot at cast
    morphSavedMaxHp: null, morphSavedHp: null,
    // Empower channel: while empowerUntil > time this caster is locked onto ally
    // empowerTargetId, refreshing its buff and draining mana per second.
    empowerUntil: 0, empowerTargetId: null,
    // Vortex of Light (Sword Saint ult): while vortexUntil > time the hero spins,
    // dealing AoE (vortex = { radius, dps }) and immune to slow/stun.
    vortexUntil: 0, vortex: null,
    // Backline Teleport: landing x locked in at cast start (telegraphed), used
    // when the wind-up ends.
    teleportTo: null,
    ovDamage: null, ovRange: null, ovPeriod: null, ovSpeed: null, ovSize: null,
    ovRanged: null, // dismounted override: true keeps the ranged attack (split rider)
    mana: (s.caster || s.isHero) ? (s.mana || 0) : 0,    // casting resource (heroes cast too)
    manaMax: (s.caster || s.isHero) ? (s.mana || 0) : 0,
    // "Scut de lumină" upgrade state (invulnerability window)
    shieldAt: -1, shieldFrom: 0, shieldUntil: 0, shieldCd: 0, shieldScale: 1, shieldPose: 0.5, shieldPending: false,
    targetId: null,
    state: 'march',
    radius,
    baseRadius: s.radius, // the drawn-body radius (pre-footprint) — for the selection ring / click size
    footprint, hw, hh, // rectangular separation for multi-cell units
    armor: s.armor,
    isAir: !!s.isAir,
    hero: !!s.isHero,   // the special per-race hero (levels up, respawns each wave)
    heroLevel: 1,       // set from the persistent template at wave spawn
    heroAbilities: [],  // learned ability ids (rank >= 1), synced from template
    heroRanks: {},      // abilityId -> rank, for per-rank effect scaling
  };
  game.entities.push(e);
  game.byId.set(e.id, e);
  return e;
}

// Spawn a summoned animal beside its caster. It is a normal fighting entity,
// but its stats come from the summon ability (not the roster) and its sprites
// are hosted on the CASTER's type under an "<animal>-" prefix (so its art is
// uploaded on the caster unit). Cosmetically it uses the caster's race art.
export function spawnSummon(game, caster, ab, params, rank = 1) {
  const p = params || ab.params; // hero casters pass rank-scaled params
  const base = ab.params;        // unscaled base: hp/damage grow per-rank additively
  const animal = ab.animal || 'wolf';
  const totem = !!ab.totem; // stationary aura totem (no move, no attack)
  const r = Math.max(1, rank || 1);
  // HP and damage scale by an explicit per-rank increment (set in admin), not by
  // the generic rank multiplier — rank 1 = base, each extra rank adds hpPerRank /
  // damagePerRank.
  const hp = Math.max(1, (base.hp || 1) + (r - 1) * (base.hpPerRank || 0));
  const damage = totem ? 0 : ((base.damage || 0) + (r - 1) * (base.damagePerRank || 0));
  const radius = 12;
  const stats = {
    name: ab.animalName || ab.name || animal,
    hp,
    damage, range: p.range || 25, period: p.period || 1,
    dmgType: 'normal', armor: p.armored ? 'armored' : 'light',
    speed: totem ? 0 : (p.speed || 100), radius, shape: 'circle',
    // targeting: default from `flying`, but overridable so a summon can be made
    // air-only (targetsAir 1 / targetsGround 0) or ground-only
    isAir: !!p.flying,
    targetsAir: p.targetsAir != null ? !!p.targetsAir : !!p.flying,
    targetsGround: p.targetsGround != null ? !!p.targetsGround : true,
    projectile: !!p.projectile, ranged: !!p.projectile,
    projectileSpeed: 380, splash: p.splash || 0,
    size: (p.size != null ? p.size : 100) / 100, animSpeed: p.animSpeed || 5,
    caster: false, heal: false, cw: 1, ch: 1, tier: 1, cost: 0,
  };
  // Summons appear beside the caster; a totem is PLANTED in front (toward the
  // enemy) so its slow aura covers the incoming lane.
  const dir = caster.team === 0 ? -1 : 1;
  const front = caster.team === 0 ? 1 : -1;
  const e = {
    id: game.nextId++,
    team: caster.team, owner: caster.owner != null ? caster.owner : caster.team,
    type: caster.type, // type hosts the sprites; stats overridden
    x: totem ? caster.x + front * 55 : caster.x + dir * 20, y: caster.y + (totem ? 0 : 14), prevX: caster.x, prevY: caster.y,
    hp: stats.hp, maxHp: stats.hp,
    cooldown: 0, windup: 0, windupMax: 0,
    effects: [], abilityCd: {}, auraUntil: {},
    castState: null, castAbility: null, castTargetId: null, castManual: false, castPhaseEnd: 0, spellHold: false,
    dashing: false, dashCharge: false, dashReadyAt: 0, dashVel: 0,
    mountTargetId: null, splitTargetId: null, dismounted: false, beast: false,
    ovDamage: null, ovRange: null, ovPeriod: null, ovSpeed: null, ovRanged: null,
    ovSize: stats.size, // drawn scale (renderer reuses the ov-size path for summons)
    mana: 0, manaMax: 0,
    targetId: null, state: 'march',
    radius, baseRadius: radius, footprint: false, hw: radius, hh: radius,
    armor: stats.armor, isAir: stats.isAir,
    // summon specifics
    summon: true, summonKind: animal, summonOf: caster.id, summonStats: stats,
    // stationary aura totem: no move/attack; emits a slow aura each tick and
    // shows a life bar. maxLife lets the render draw a depleting timer bar.
    totem: totem,
    totemAura: totem ? { radius: p.radius || 140, atkSlow: p.atkSlow || 0, moveSlow: p.moveSlow || 0 } : null,
    maxLife: (p.life != null ? p.life : (p.duration || 0)) || 0,
    despawnAt: (() => { const life = p.life != null ? p.life : (p.duration || 0); return life > 0 ? game.time + life : null; })(),
  };
  game.entities.push(e);
  game.byId.set(e.id, e);
  return e;
}

// Twin Shadows (Shadow Assassin skill): spawn a shadow clone that copies the
// hero's attack for `cloneDmg` damage. It's a fragile, timed illusion drawn with
// the HERO's own sprites (summonKind left null so the renderer falls back to the
// hero frames), shadow-tinted via the `clone` flag. It fights like any summon.
export function spawnCloneShadow(game, caster, p, cloneDmg, index = 0, count = 1) {
  const host = game.ustatOf(caster); // the hero's own combat stats (range/period/speed/size)
  const radius = caster.baseRadius || caster.radius || 14;
  const stats = {
    name: 'Umbră',
    hp: Math.max(1, p.cloneHp || 1),
    damage: Math.max(0, cloneDmg || 0),
    range: host.range || 28, period: host.period || 1,
    dmgType: host.dmgType || 'normal', armor: 'light',
    speed: host.speed || 110, radius, shape: 'circle',
    isAir: !!host.isAir,
    targetsAir: host.targetsAir != null ? !!host.targetsAir : !!host.isAir,
    targetsGround: host.targetsGround !== false,
    projectile: !!host.projectile, ranged: !!host.projectile,
    projectileSpeed: host.projectileSpeed || CONFIG.PROJECTILE_SPEED,
    splash: 0,
    size: (host.size != null ? host.size : 1), animSpeed: host.animSpeed || 5,
    caster: false, heal: false, cw: 1, ch: 1, tier: 1, cost: 0,
  };
  // fan the clones out around the hero so they don't stack on one point
  const ang = count > 1 ? (index / count) * Math.PI * 2 : 0.6;
  const ox = Math.cos(ang) * 26, oy = Math.sin(ang) * 16;
  const life = p.life != null ? p.life : (p.duration || 0);
  const e = {
    id: game.nextId++,
    team: caster.team, owner: caster.owner != null ? caster.owner : caster.team,
    type: caster.type, // hero sprites; stats overridden
    x: caster.x + ox, y: caster.y + oy, prevX: caster.x, prevY: caster.y,
    hp: stats.hp, maxHp: stats.hp,
    cooldown: 0, windup: 0, windupMax: 0,
    effects: [], abilityCd: {}, auraUntil: {},
    castState: null, castAbility: null, castTargetId: null, castManual: false, castPhaseEnd: 0, spellHold: false,
    dashing: false, dashCharge: false, dashReadyAt: 0, dashVel: 0,
    mountTargetId: null, splitTargetId: null, dismounted: false, beast: false,
    ovDamage: null, ovRange: null, ovPeriod: null, ovSpeed: null, ovRanged: null,
    ovSize: stats.size,
    mana: 0, manaMax: 0,
    targetId: null, state: 'march',
    radius, baseRadius: radius, footprint: false, hw: radius, hh: radius,
    armor: stats.armor, isAir: stats.isAir,
    summon: true, summonKind: null, summonOf: caster.id, summonStats: stats,
    clone: true, // renderer: draw the hero sprite, shadow-tinted + semi-transparent
    totem: false, totemAura: null,
    maxLife: life > 0 ? life : 0,
    despawnAt: life > 0 ? game.time + life : null,
  };
  game.entities.push(e);
  game.byId.set(e.id, e);
  return e;
}

// Half-extents (hw, hh) of a structure, plus a bounding radius, from that
// kind's resolved (per-race) stats. Buildings occupy a rectangle of cw x ch
// grid cells; main/turret stay square (their `radius` is the half-extent).
export function structureExtents(kind, bs) {
  if (kind === 'main' || kind === 'turret') {
    const r = (bs && bs.radius) || CONFIG[kind === 'main' ? 'MAIN' : 'TURRET'].radius;
    return { hw: r, hh: r, radius: r };
  }
  const hw = ((bs && bs.cw) || 1) * CONFIG.GRID / 2;
  const hh = ((bs && bs.ch) || 1) * CONFIG.GRID / 2;
  return { hw, hh, radius: Math.max(hw, hh) };
}

function structureHp(kind, bs, tier) {
  if (kind === 'main') return bs.hp[0];
  if (kind === 'tower') return towerStatForTier(bs, tier || 1).hp;
  return bs.hp;
}

// Generic structure factory: the main base (win objective), the starting
// turret, and player-built walls / towers / generators. Stats resolve per
// the building team's race.
// `owner` = the PLAYER who built it (economy/refunds); `team` = the SIDE it
// fights for. Defaults keep 1v1 call sites identical (owner === team).
export function makeStructure(game, team, kind, x, y, owner = team) {
  const bs = game.bstat(owner, kind);
  const hp = structureHp(kind, bs, (game.tier && game.tier[owner]) || 1); // tier is per-PLAYER
  const ext = structureExtents(kind, bs);
  // Player-built structures can take time to raise (buildTime, admin-set;
  // 0 = instant). While `building`, the structure is INERT: towers don't
  // shoot, farms grant no food, tech unlocks nothing, MINES pay no gold and
  // send no miners — but it counts toward caps and can already be attacked.
  // Only the starting main + turret are exempt (they're placed by the sim).
  const buildTime = (kind !== 'main' && kind !== 'turret') ? (bs.buildTime || 0) : 0;
  const s = {
    id: game.nextId++,
    team, owner, kind,
    x, y, prevX: x, prevY: y,
    hp, maxHp: hp,
    radius: ext.radius,
    hw: ext.hw, hh: ext.hh,
    cooldown: 0,
    targetId: null,
    armor: 'structure',
    isAir: false,
    isStructure: true,
    isBase: kind === 'main',
    building: buildTime > 0,
    buildStart: game.time,
    buildDone: game.time + buildTime,
  };
  // A construction site starts at ~15% HP and GROWS to full as it is built
  // (game.update adds the missing 85% linearly over buildTime); damage taken
  // during construction subtracts from the same pool, so a harassed site can
  // still be destroyed before it finishes.
  if (s.building) s.hp = Math.max(1, Math.round(hp * 0.15));
  game.structures.push(s);
  game.byId.set(s.id, s);
  return s;
}

export function spawnProjectile(game, source, stats, target) {
  game.projectiles.push({
    id: game.nextId++,
    team: source.team,
    owner: source.owner != null ? source.owner : source.team, // art: shooter's race
    sourceId: source.id,                          // for lifesteal on impact
    srcType: source.type || source.kind || null, // for the projectile sprite
    projSize: stats.projSize || 1,               // projectile size multiplier
    x: source.x, y: source.y,
    prevX: source.x, prevY: source.y,
    speed: stats.projectileSpeed || 0, // 0 -> use CONFIG default at update time
    targetId: target.id,
    tx: target.x, ty: target.y,
    damage: stats.damage,
    buildingDamage: stats.buildingDamage || 0, // special damage vs structures (0 = normal)
    dmgType: stats.dmgType,
    splash: stats.splash || 0,
    // AoE upgrade: {power} -> full damage on the struck target, power% on the
    // others in the radius, and the burst stays on the target's air/ground plane
    aoe: stats.aoe || null,
    targetAir: !!target.isAir, // the struck plane (fixed at launch)
    ability: stats.projAbility || null, // basic-attack projectiles that borrow an ability's sprite (Poison Arrow)
    acid: stats.acid || null, // {dot, dur} -> damage-over-time on impact (Acid Spit)
    fire: stats.fire || null, // {dps, dur, radius} -> burning ground on impact (Fireball)
    // "Bounce": on impact the projectile ricochets to the next nearby enemy
    // (up to bounceLeft more hops), dealing bounceDamage (bouncePower% of the
    // original) on each ricochet — you see it fly from character to character.
    bounce: !!stats.bounce,
    bounceRadius: stats.bounceRadius || 0,
    bounceLeft: stats.bounce ? (stats.bounceMax || 0) : 0,
    bounceDamage: (stats.damage || 0) * ((stats.bouncePower || 0) / 100),
  });
}
