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

export function makeBase(game, team, x, y, hp, radius) {
  const b = {
    id: game.nextId++,
    team,
    x, y, prevX: x, prevY: y,
    hp, maxHp: hp,
    radius,
    armor: 'structure',
    isAir: false,
    isBase: true,
  };
  game.byId.set(b.id, b);
  return b;
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
