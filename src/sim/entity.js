import { CONFIG } from '../config.js';
import { towerStatForTier } from '../ui/balance.js';

export function spawnUnit(game, team, type, x, y) {
  const s = game.ustat(team, type);
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
    team, type,
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
    castPhaseEnd: 0,  // game.time when the current cast phase ends
    spellHold: false, // caster is holding at range, saving up for a spell
    dashing: false,   // charging in at dashSpeed toward a target in dashRange
    dashCharge: false,// a dash is committed; its bonus lands on arrival
    dashReadyAt: 0,   // game.time when the next dash is allowed (cooldown)
    dashVel: 0,       // effective charge speed while dashing (set by combat)
    // "Dashing & Fleeing mount" upgrade: charge a ranged intruder, then fight
    // on foot with dismounted stat overrides for the rest of this life.
    // "Landing Split" reuses the same overrides for the landed rider, and
    // marks the spawned mount with `beast` (its own ov* stats + beast sprites).
    mountTargetId: null,
    splitTargetId: null, // "Landing Split": the ground unit being dived at
    dismounted: false,
    beast: false,
    ovDamage: null, ovRange: null, ovPeriod: null, ovSpeed: null, ovSize: null,
    ovRanged: null, // dismounted override: true keeps the ranged attack (split rider)
    mana: s.caster ? (s.mana || 0) : 0,    // casting resource
    manaMax: s.caster ? (s.mana || 0) : 0,
    targetId: null,
    state: 'march',
    radius,
    baseRadius: s.radius, // the drawn-body radius (pre-footprint) — for the selection ring / click size
    footprint, hw, hh, // rectangular separation for multi-cell units
    armor: s.armor,
    isAir: !!s.isAir,
  };
  game.entities.push(e);
  game.byId.set(e.id, e);
  return e;
}

// Spawn a summoned animal beside its caster. It is a normal fighting entity,
// but its stats come from the summon ability (not the roster) and its sprites
// are hosted on the CASTER's type under an "<animal>-" prefix (so its art is
// uploaded on the caster unit). Cosmetically it uses the caster's race art.
export function spawnSummon(game, caster, ab) {
  const p = ab.params;
  const animal = ab.animal || 'wolf';
  const radius = 12;
  const stats = {
    name: ab.animalName || ab.name || animal,
    hp: Math.max(1, p.hp || 1),
    damage: p.damage || 0, range: p.range || 25, period: p.period || 1,
    dmgType: 'normal', armor: p.armored ? 'armored' : 'light',
    speed: p.speed || 100, radius, shape: 'circle',
    isAir: !!p.flying, targetsAir: !!p.flying, targetsGround: true,
    projectile: !!p.projectile, ranged: !!p.projectile,
    projectileSpeed: 380, splash: p.splash || 0,
    size: (p.size != null ? p.size : 100) / 100, animSpeed: 5,
    caster: false, heal: false, cw: 1, ch: 1, tier: 1, cost: 0,
  };
  // spawn just behind/beside the caster, nudged toward its own side
  const dir = caster.team === 0 ? -1 : 1;
  const e = {
    id: game.nextId++,
    team: caster.team, type: caster.type, // type hosts the sprites; stats overridden
    x: caster.x + dir * 20, y: caster.y + 14, prevX: caster.x, prevY: caster.y,
    hp: stats.hp, maxHp: stats.hp,
    cooldown: 0, windup: 0, windupMax: 0,
    effects: [], abilityCd: {}, auraUntil: {},
    castState: null, castAbility: null, castTargetId: null, castPhaseEnd: 0, spellHold: false,
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
    despawnAt: (p.duration || 0) > 0 ? game.time + p.duration : null,
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
export function makeStructure(game, team, kind, x, y) {
  const bs = game.bstat(team, kind);
  const hp = structureHp(kind, bs, (game.tier && game.tier[team]) || 1);
  const ext = structureExtents(kind, bs);
  const s = {
    id: game.nextId++,
    team, kind,
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
  };
  game.structures.push(s);
  game.byId.set(s.id, s);
  return s;
}

export function spawnProjectile(game, source, stats, target) {
  game.projectiles.push({
    id: game.nextId++,
    team: source.team,
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
