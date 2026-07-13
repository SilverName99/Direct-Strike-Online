import { CONFIG } from '../config.js';
import { moveSpeedMult } from './abilities.js';

// Marching + boids-lite separation. Attacking units hold position.
export function updateMovement(game, dt) {
  for (const u of game.entities) {
    if (u.state !== 'march') continue;
    const stats = game.ustatOf(u);
    // dashing units close the gap at their charge speed (basic dash or mount);
    // dismounted riders / split beasts move at their override speed
    let base;
    if (u.dashing) base = u.dashVel || stats.dashSpeed || stats.speed;
    else if ((u.dismounted || u.beast) && u.ovSpeed != null) base = u.ovSpeed;
    else base = stats.speed;
    const speed = base * moveSpeedMult(u, game.time); // frost slows

    // Close in on our current target if we have one; otherwise march
    // toward the enemy base.
    const target = u.targetId != null ? game.byId.get(u.targetId) : null;
    if (target && target.hp > 0) {
      let gx = target.x;
      let gy = target.y;
      // Structures (they have .kind; units have .type) are big and static:
      // aiming at the CENTER queues everyone on one line and they stack in
      // ugly overlapping rows. Instead each unit walks to its own stable spot
      // on the ring around the building (id-hashed fan of ±~85° toward its
      // side), so attackers surround the perimeter.
      if (target.kind) {
        const ring = (target.radius || Math.max(target.hw || 0, target.hh || 0)) + u.radius + 4;
        const h = ((u.id * 2654435761) >>> 0) / 4294967296; // deterministic per-unit
        const side = u.team === 0 ? Math.PI : 0; // approach from our half
        const ang = side + (h - 0.5) * 3.0;
        gx = target.x + Math.cos(ang) * ring;
        gy = target.y + Math.sin(ang) * ring;
      }
      const dx = gx - u.x;
      const dy = gy - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) {
        const step = Math.min(speed * dt, d);
        u.x += (dx / d) * step;
        u.y += (dy / d) * step;
      }
      continue;
    }

    const enemyMain = game.mainOf(1 - u.team);
    const dir = enemyMain ? Math.sign(enemyMain.x - u.x) || 1 : u.team === 0 ? 1 : -1;
    u.x += speed * dt * dir;

    // Once past midfield, home vertically toward the enemy main base — but
    // each unit keeps its OWN lane (stable id-hashed offset around the base),
    // otherwise the whole pack converges onto one y and marches Indian-file.
    const mid = CONFIG.FIELD_W / 2;
    const inEnemyHalf =
      (u.team === 0 && u.x > mid) || (u.team === 1 && u.x < mid);
    if (inEnemyHalf && enemyMain) {
      const h = ((u.id * 2654435761) >>> 0) / 4294967296; // deterministic per-unit
      const laneY = enemyMain.y + (h - 0.5) * 180;
      const dy = laneY - u.y;
      const step = Math.min(Math.abs(dy), speed * 0.6 * dt);
      u.y += Math.sign(dy) * step;
    }
  }

  separate(game);
  collideStructures(game);

  for (const u of game.entities) {
    u.x = clamp(u.x, 12, CONFIG.FIELD_W - 12);
    u.y = clamp(u.y, 12, CONFIG.FIELD_H - 12);
  }
}

// Ground units cannot walk through structures (walls earn their keep);
// fliers pass over everything.
//
// The main base and the mid-field turret sit in the marching lane, so they
// use CIRCULAR collision: a unit that bumps them is ejected radially, and
// the curve lets the column slide around instead of jamming flat against a
// face. Buildable footprints (wall/tower/generator) live in the build zone
// and are meant to block, so they use box collision on their cw x ch cells.
function collideStructures(game) {
  for (const u of game.entities) {
    if (u.isAir) continue;
    for (const s of game.structures) {
      if (s.hp <= 0) continue;
      // units pass THROUGH their own structures — the army now spawns behind
      // the base and marches out through its own construction zone. Enemy
      // structures (walls/towers/base) still block, so defenses keep their job.
      if (s.team === u.team) continue;
      if (s.kind === 'main' || s.kind === 'turret') collideCircle(u, s);
      else collideBox(u, s);
    }
  }
}

function collideCircle(u, s) {
  const minD = u.radius + s.radius;
  let dx = u.x - s.x;
  let dy = u.y - s.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return;
  let d = Math.sqrt(d2);
  if (d < 0.001) { dx = u.team === 0 ? -1 : 1; dy = 0; d = 1; }
  u.x = s.x + (dx / d) * minD;
  u.y = s.y + (dy / d) * minD;
}

function collideBox(u, s) {
  // Minkowski-expanded box: the unit radius inflates the structure's extents.
  const ex = (s.hw || s.radius) + u.radius;
  const ey = (s.hh || s.radius) + u.radius;
  const dx = u.x - s.x;
  const dy = u.y - s.y;
  const px = ex - Math.abs(dx); // x-overlap (positive => inside)
  const py = ey - Math.abs(dy); // y-overlap
  if (px <= 0 || py <= 0) return;
  if (px < py) u.x = s.x + (dx < 0 ? -1 : 1) * ex; // eject along smaller overlap
  else u.y = s.y + (dy < 0 ? -1 : 1) * ey;
}

function separate(game) {
  const ents = game.entities;
  for (let i = 0; i < ents.length; i++) {
    const a = ents[i];
    for (let j = i + 1; j < ents.length; j++) {
      const b = ents[j];
      if (a.isAir !== b.isAir) continue; // air passes over ground
      // rectangular units (2x1 etc.) separate as boxes so a neat formation
      // stays put instead of the wide bodies shoving apart on their long axis
      if (a.footprint || b.footprint) { separateBox(a, b); continue; }
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

// AABB separation: push the pair apart along the axis of SMALLEST overlap
// (splitting the push), using each unit's half-extents. Units placed flush on
// the grid have zero overlap and never move.
function separateBox(a, b) {
  const ex = (a.hw || a.radius) + (b.hw || b.radius);
  const ey = (a.hh || a.radius) + (b.hh || b.radius);
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const px = ex - Math.abs(dx); // x-overlap (>0 => overlapping)
  const py = ey - Math.abs(dy); // y-overlap
  if (px <= 0 || py <= 0) return;
  if (px < py) {
    if (dx === 0) dx = a.id < b.id ? 1 : -1;
    const push = Math.min(px / 2, 2) * (dx < 0 ? -1 : 1);
    a.x -= push; b.x += push;
  } else {
    if (dy === 0) dy = a.id < b.id ? 1 : -1;
    const push = Math.min(py / 2, 2) * (dy < 0 ? -1 : 1);
    a.y -= push; b.y += push;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
