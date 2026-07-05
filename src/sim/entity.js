import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';

export function spawnUnit(game, team, type, x, y) {
  const s = UNITS[type];
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

// Stats for each structure kind (main base HP depends on tier).
export function structureStats(kind) {
  if (kind === 'main') return { hp: CONFIG.MAIN.hp[0], radius: CONFIG.MAIN.radius };
  if (kind === 'turret') return CONFIG.TURRET;
  return CONFIG.BUILDINGS[kind];
}

// Generic structure factory: the main base (win objective), the starting
// turret, and player-built walls / towers / generators.
export function makeStructure(game, team, kind, x, y) {
  const stats = structureStats(kind);
  const s = {
    id: game.nextId++,
    team, kind,
    x, y, prevX: x, prevY: y,
    hp: stats.hp, maxHp: stats.hp,
    radius: stats.radius,
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
