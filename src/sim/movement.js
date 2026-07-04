import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';

// Marching + boids-lite separation. Attacking units hold position.
export function updateMovement(game, dt) {
  for (const u of game.entities) {
    if (u.state !== 'march') continue;
    const stats = UNITS[u.type];

    // Close in on our current target if we have one; otherwise march
    // toward the enemy base.
    const target = u.targetId != null ? game.byId.get(u.targetId) : null;
    if (target && target.hp > 0) {
      const dx = target.x - u.x;
      const dy = target.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const step = stats.speed * dt;
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
      continue;
    }

    const enemyBase = game.bases[1 - u.team];
    const dir = Math.sign(enemyBase.x - u.x) || 1;
    u.x += stats.speed * dt * dir;

    // Once inside the enemy half, home vertically toward their base.
    const inEnemyHalf =
      (u.team === 0 && u.x > CONFIG.ZONE_RIGHT_MIN) ||
      (u.team === 1 && u.x < CONFIG.ZONE_LEFT_MAX);
    if (inEnemyHalf) {
      const dy = enemyBase.y - u.y;
      const step = Math.min(Math.abs(dy), stats.speed * 0.6 * dt);
      u.y += Math.sign(dy) * step;
    }
  }

  separate(game);

  for (const u of game.entities) {
    u.x = clamp(u.x, 12, CONFIG.FIELD_W - 12);
    u.y = clamp(u.y, 12, CONFIG.FIELD_H - 12);
  }
}

function separate(game) {
  const ents = game.entities;
  for (let i = 0; i < ents.length; i++) {
    const a = ents[i];
    for (let j = i + 1; j < ents.length; j++) {
      const b = ents[j];
      if (a.isAir !== b.isAir) continue; // air passes over ground
      const minD = a.radius + b.radius;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2);
      if (d < 0.001) {
        // perfectly stacked: push apart deterministically by id parity
        dx = a.id < b.id ? 1 : -1;
        dy = 0;
        d = 1;
      }
      const push = Math.min((minD - d) / 2, 2);
      const nx = dx / d;
      const ny = dy / d;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
    }
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
