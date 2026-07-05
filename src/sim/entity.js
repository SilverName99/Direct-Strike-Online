import { CONFIG } from '../config.js';

export function spawnUnit(game, team, type, x, y) {
  const s = game.ustat(team, type);
  const e = {
    id: game.nextId++,
    team, type,
    x, y, prevX: x, prevY: y,
    hp: s.hp, maxHp: s.hp,
    cooldown: 0,
    targetId: null,
    state: 'march',
    radius: s.radius,
    armor: s.armor,
    isAir: !!s.isAir,
  };
  game.entities.push(e);
  game.byId.set(e.id, e);
  return e;
}

// Half-extents (hw, hh) of each structure kind, plus a bounding radius.
// Buildings occupy a rectangle of cw x ch grid cells; main/turret stay
// square (their `radius` is the half-extent).
export function structureExtents(kind) {
  if (kind === 'main') return { hw: CONFIG.MAIN.radius, hh: CONFIG.MAIN.radius, radius: CONFIG.MAIN.radius };
  if (kind === 'turret') return { hw: CONFIG.TURRET.radius, hh: CONFIG.TURRET.radius, radius: CONFIG.TURRET.radius };
  const b = CONFIG.BUILDINGS[kind];
  const hw = (b.cw || 1) * CONFIG.GRID / 2;
  const hh = (b.ch || 1) * CONFIG.GRID / 2;
  return { hw, hh, radius: Math.max(hw, hh) };
}

function structureHp(kind) {
  if (kind === 'main') return CONFIG.MAIN.hp[0];
  if (kind === 'turret') return CONFIG.TURRET.hp;
  return CONFIG.BUILDINGS[kind].hp;
}

// Generic structure factory: the main base (win objective), the starting
// turret, and player-built walls / towers / generators.
export function makeStructure(game, team, kind, x, y) {
  const hp = structureHp(kind);
  const ext = structureExtents(kind);
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
    x: source.x, y: source.y,
    prevX: source.x, prevY: source.y,
    speed: stats.projectileSpeed || 0, // 0 -> use CONFIG default at update time
    targetId: target.id,
    tx: target.x, ty: target.y,
    damage: stats.damage,
    dmgType: stats.dmgType,
    splash: stats.splash || 0,
  });
}
