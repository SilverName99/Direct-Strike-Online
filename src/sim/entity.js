import { CONFIG } from '../config.js';

export function spawnUnit(game, team, type, x, y) {
  const s = game.ustat(team, type);
  // A footprint bigger than 1x1 (grid cells) makes the unit physically larger:
  // its collision/separation radius grows to span the cells. 1x1 keeps the
  // unit's own base radius (backwards-compatible with every existing unit).
  const cells = Math.max(s.cw || 1, s.ch || 1);
  const radius = cells > 1 ? (cells * CONFIG.GRID) / 2 : s.radius;
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
    // on foot with dismounted stat overrides for the rest of this life
    mountTargetId: null,
    dismounted: false,
    ovDamage: null, ovRange: null, ovPeriod: null, ovSpeed: null, ovSize: null,
    mana: s.caster ? (s.mana || 0) : 0,    // casting resource
    manaMax: s.caster ? (s.mana || 0) : 0,
    targetId: null,
    state: 'march',
    radius,
    armor: s.armor,
    isAir: !!s.isAir,
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

function structureHp(kind, bs) {
  if (kind === 'main') return bs.hp[0];
  return bs.hp;
}

// Generic structure factory: the main base (win objective), the starting
// turret, and player-built walls / towers / generators. Stats resolve per
// the building team's race.
export function makeStructure(game, team, kind, x, y) {
  const bs = game.bstat(team, kind);
  const hp = structureHp(kind, bs);
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
    dmgType: stats.dmgType,
    splash: stats.splash || 0,
    // "Bounce": on impact the projectile ricochets to the next nearby enemy
    // (up to bounceLeft more hops), dealing bounceDamage (bouncePower% of the
    // original) on each ricochet — you see it fly from character to character.
    bounce: !!stats.bounce,
    bounceRadius: stats.bounceRadius || 0,
    bounceLeft: stats.bounce ? (stats.bounceMax || 0) : 0,
    bounceDamage: (stats.damage || 0) * ((stats.bouncePower || 0) / 100),
  });
}
