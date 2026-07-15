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
      // Structures are big and static: aiming at the CENTER queues everyone on
      // one line. Instead each attacker walks to its own stable spot on a ring
      // around it (id-hashed fan toward our side) so they surround the perimeter.
      // Stand distance = structure radius + the unit's box half-extent along the
      // approach + a small melee gap, so even a big 1x2/2x2 body lands in range.
      if (target.kind) {
        const h = ((u.id * 2654435761) >>> 0) / 4294967296; // deterministic per-unit
        const side = u.team === 0 ? Math.PI : 0;            // approach from our half
        const ang = side + (h - 0.5) * 3.4;                 // ±~100° fan on our side
        const ux = Math.abs(Math.cos(ang)) * (u.hw || u.radius) + Math.abs(Math.sin(ang)) * (u.hh || u.radius);
        // aim SLIGHTLY INSIDE the box-touch point so the attacker presses right
        // up against the structure (collision then rests it at effDist ~0) —
        // this keeps big bodies solidly in range even when a crowd jostles them,
        // instead of parking them at the fringe where a nudge drops the hit
        const ring = (target.radius || Math.max(target.hw || 0, target.hh || 0)) + ux - 4;
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
        u.mvx = dx / d; u.mvy = dy / d; // heading, for the "shove aside" push
      }
      continue;
    }

    const enemyMain = game.mainOf(1 - u.team);
    const dir = enemyMain ? Math.sign(enemyMain.x - u.x) || 1 : u.team === 0 ? 1 : -1;
    u.x += speed * dt * dir;
    u.mvx = dir; u.mvy = 0; // heading (base march is horizontal)

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
  let dx = u.x - s.x;
  let dy = u.y - s.y;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.001) { dx = u.team === 0 ? -1 : 1; dy = 0; d = 1; }
  const nx = dx / d;
  const ny = dy / d;
  // The unit's box half-extent ALONG the ejection direction. Using the bounding
  // radius (max extent) held tall/wide units (1x2, 2x1) a whole band short of
  // the structure on their SHORT axis — a short-range melee pinned there could
  // never touch the turret/base and jittered at the ring forever.
  const ex = Math.abs(nx) * (u.hw || u.radius) + Math.abs(ny) * (u.hh || u.radius);
  const minD = s.radius + ex;
  if (d >= minD) return;
  u.x = s.x + nx * minD;
  u.y = s.y + ny * minD;
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
      // ONLY TEAMMATES push each other. A unit passes right THROUGH enemy units
      // (a footman doesn't shove an enemy grunt) — so a hero reaches the foe
      // behind an enemy screen, and the two armies interpenetrate and fight
      // wherever they meet. Among teammates the mass split still applies, so a
      // big body shoulders small allies aside to reach the front.
      if (a.team !== b.team) continue;
      // rectangular units (2x1 etc.) separate as boxes
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
      const nx = dx / d;
      const ny = dy / d;
      // a heavy marcher shoulders a light ALLY in its path to the SIDE
      if (shoveAside(a, b)) continue;
      // MASS-BASED split: the heavier (bigger footprint) body barely moves, the
      // lighter one yields — a big unit shoulders a small one aside (and shoves
      // through a knot of small enemies to reach its target) instead of both
      // splitting 50/50 and stalling. Cap the TOTAL resolution (not each unit)
      // so the mass ratio holds even on a big first-contact overlap.
      const total = Math.min(minD - d, 2.5);
      const ma = massOf(a), mb = massOf(b);
      const pa = total * mb / (ma + mb); // a yields more when b is heavier
      const pb = total * ma / (ma + mb);
      a.x -= nx * pa; a.y -= ny * pa;
      b.x += nx * pb; b.y += ny * pb;
    }
  }
}

// A body's "mass" for separation = its box area (footprint). A 2x2 outweighs a
// 1x1 several-fold, so the small one does almost all the yielding.
function massOf(u) {
  return (u.hw || u.radius || 1) * (u.hh || u.radius || 1);
}

// half-extent of a box projected onto a unit direction (dirx, diry)
function perpExtent(u, dirx, diry) {
  return Math.abs(dirx) * (u.hw || u.radius) + Math.abs(diry) * (u.hh || u.radius);
}

// A heavy MARCHING body shoves a lighter one that's IN ITS PATH out to the SIDE
// (perpendicular to its heading) so its route clears — instead of just shoving
// it straight forward. The light body does almost all the moving; the heavy one
// barely budges and keeps advancing. Returns true when it handled the pair.
function shoveAside(a, b) {
  let H, L;
  if (massOf(a) > massOf(b) * 1.4) { H = a; L = b; }
  else if (massOf(b) > massOf(a) * 1.4) { H = b; L = a; }
  else return false;
  // Whose path are we clearing? The MARCHING one (prefer the heavy one when both
  // march). This covers BOTH directions: a big marcher plowing through a small
  // ally, AND a small marcher slipping past a big ally standing in its way.
  const M = (H.state === 'march' && (H.mvx || H.mvy)) ? H
    : (L.state === 'march' && (L.mvx || L.mvy)) ? L : null;
  if (!M) return false;
  const mx = M.mvx || 0, my = M.mvy || 0;
  if (!mx && !my) return false;
  const other = M === H ? L : H;              // the body sitting in M's way
  if ((other.x - M.x) * mx + (other.y - M.y) * my <= 0) return false; // must be AHEAD of M
  // Always the LIGHT body (L) slides to one side of M's heading — the heavy one
  // holds. Side chosen from L's current lean, ties broken by id.
  let lat = (L.x - M.x) * -my + (L.y - M.y) * mx;
  if (Math.abs(lat) < 0.001) lat = L.id < M.id ? 1 : -1;
  const s = lat < 0 ? -1 : 1;
  const dirx = -my * s, diry = mx * s;        // unit vector toward L's side
  const latGap = Math.abs((other.x - M.x) * -my + (other.y - M.y) * mx);
  const need = perpExtent(M, dirx, diry) + perpExtent(other, dirx, diry) - latGap;
  if (need <= 0) return true;                 // already clear to the side
  const total = Math.min(need, 2.5);
  L.x += dirx * total;                        // only the light body moves aside
  L.y += diry * total;
  return true;
}

// AABB separation: push the pair apart along the axis of SMALLEST overlap
// (splitting the push), using each unit's half-extents. Units placed flush on
// the grid have zero overlap and never move. With `mover` set (a marching unit
// against a stationary teammate) the mover absorbs the whole push — same total
// separation, but the standing formation is never displaced.
function separateBox(a, b) {
  const ex = (a.hw || a.radius) + (b.hw || b.radius);
  const ey = (a.hh || a.radius) + (b.hh || b.radius);
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const px = ex - Math.abs(dx); // x-overlap (>0 => overlapping)
  const py = ey - Math.abs(dy); // y-overlap
  if (px <= 0 || py <= 0) return;
  // a heavy marcher shoulders a light ALLY in its path to the SIDE
  if (shoveAside(a, b)) return;
  // mass-based fractions: the lighter body does most of the yielding (see separate)
  const ma = massOf(a), mb = massOf(b);
  const fa = mb / (ma + mb); // a's share (bigger b => a moves more)
  const fb = ma / (ma + mb);
  if (px < py) {
    if (dx === 0) dx = a.id < b.id ? 1 : -1;
    const sgn = dx < 0 ? -1 : 1;
    const total = Math.min(px, 2.5);
    a.x -= total * fa * sgn;
    b.x += total * fb * sgn;
  } else {
    if (dy === 0) dy = a.id < b.id ? 1 : -1;
    const sgn = dy < 0 ? -1 : 1;
    const total = Math.min(py, 2.5);
    a.y -= total * fa * sgn;
    b.y += total * fb * sgn;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
