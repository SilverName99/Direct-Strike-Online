import { CONFIG } from '../config.js';
import { moveSpeedMult } from './abilities.js';

// Marching + boids-lite separation. Attacking units hold position.
export function updateMovement(game, dt) {
  // pass-start snapshot: the speed clamp below measures ONLY what this pass
  // (march + steering + separation) moved each unit
  for (const u of game.entities) { u.blkPX = u.x; u.blkPY = u.y; }
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
        // remember the ACTUAL heading (may be vertical when chasing up/down!)
        // — flowAround/separate steer perpendicular to it, whatever it is
        u.mvx = dx / d; u.mvy = dy / d; u.mvSpeed = speed;
      }
      continue;
    }

    const enemyMain = game.mainOf(1 - u.team);
    const dir = enemyMain ? Math.sign(enemyMain.x - u.x) || 1 : u.team === 0 ? 1 : -1;
    u.x += speed * dt * dir;
    u.mvx = dir; u.mvy = 0; u.mvSpeed = speed; // base-march: heading is horizontal

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

  flowAround(game, dt);
  separate(game);

  // HARD SPEED CAP: a marching unit's NET move this pass (march step + side
  // steering + all the separation pushes, which used to STACK into 2-3x bursts)
  // never exceeds its configured speed. Steering thus REDIRECTS the step, it
  // no longer adds to it. Dashes are exempt — dashSpeed is its own setting.
  // Runs BEFORE structure collision so wall ejection is never undone.
  for (const u of game.entities) {
    if (u.state !== 'march' || u.dashing) { u.blockedT = 0; continue; }
    const dx = u.x - u.blkPX;
    const dy = u.y - u.blkPY;
    const d = Math.sqrt(dx * dx + dy * dy);
    const maxStep = (u.mvSpeed || 0) * dt;
    if (maxStep > 0 && d > maxStep) {
      const s = maxStep / d;
      u.x = u.blkPX + dx * s;
      u.y = u.blkPY + dy * s;
    }
    // Stuck detection: a marcher whose net move stays far below its speed is
    // wedged behind bodies. blockedT feeds two escapes: flowAround treats it
    // as a dam (others route around it) and sidesteps harder itself, and
    // combat.js lets it retarget to any closer reachable enemy.
    if (maxStep > 0.001 && Math.min(d, maxStep) < maxStep * 0.35) {
      u.blockedT = (u.blockedT || 0) + dt;
    } else u.blockedT = 0;
  }

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
  // The unit's box half-extent ALONG the ejection direction. The old bounding
  // radius (max extent) held tall/wide units (1x2, 2x1) a whole band short of
  // the structure on their SHORT axis — a short-range melee pinned there could
  // NEVER touch the turret/base (it jittered at the ring forever instead).
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

// Marching units that catch up behind a slower / stopped unit in their path
// step to the side and flow AROUND it instead of piling up nose-to-tail. This
// matters most for wide bodies (catapults, 1x2 units): their big footprint used
// to dam the whole column behind them. Works on the unit's ACTUAL heading
// (u.mvx/mvy) — vertical chases sidestep in X exactly like horizontal marches
// sidestep in Y. Deterministic — the side is chosen from the blockers' offsets,
// ties broken by unit id.
function flowAround(game, dt) {
  const ents = game.entities;
  for (let i = 0; i < ents.length; i++) {
    const u = ents[i];
    if (u.state !== 'march' || u.isAir || u.dashing) continue;
    const mx = u.mvx ?? (u.team === 0 ? 1 : -1);
    const my = u.mvy ?? 0;
    // box half-extents projected onto the heading and its perpendicular
    // (axis-aligned boxes, so |mx|/|my| weigh the two extents)
    const uhw = u.hw || u.radius;
    const uhh = u.hh || u.radius;
    const uAlong = Math.abs(mx) * uhw + Math.abs(my) * uhh;
    const uPerp = Math.abs(my) * uhw + Math.abs(mx) * uhh;
    let side = 0;
    let blocked = false;
    for (let j = 0; j < ents.length; j++) {
      if (j === i) continue;
      const o = ents[j];
      // Only TEAMMATES that are actually standing (fighting/holding) or wedged
      // dam the lane. Enemies are targets, not obstacles (armies must press
      // into each other, and the hero must fight the foe in front — not dance
      // around it). Teammates marching along at full flow don't count either:
      // steering around a same-speed column mate made whole formations tremble.
      if (o.isAir || o.team !== u.team) continue;
      if (o.state === 'march' && (o.blockedT || 0) < 0.3) continue;
      const dx = o.x - u.x;
      const dy = o.y - u.y;
      const fwd = dx * mx + dy * my;                     // distance AHEAD along heading
      if (fwd <= 0.5) continue;
      const ohw = o.hw || o.radius;
      const ohh = o.hh || o.radius;
      const oAlong = Math.abs(mx) * ohw + Math.abs(my) * ohh;
      if (fwd > uAlong + oAlong + 8) continue;           // ...right in front
      const oPerp = Math.abs(my) * ohw + Math.abs(mx) * ohh;
      const lat = dx * -my + dy * mx;                    // offset across the heading
      if (Math.abs(lat) > uPerp + oPerp) continue;       // ...and in our corridor
      blocked = true;
      side += lat >= 0 ? -1 : 1;                         // steer away from it
    }
    if (!blocked) { u.sideUntil = 0; continue; }
    // COMMIT to a side for a while: re-picking every tick made units dither
    // left-right (the "front-back dance") instead of actually going around
    let dirS;
    if (u.sideDir && (u.sideUntil || 0) > game.time) dirS = u.sideDir;
    else {
      dirS = side !== 0 ? Math.sign(side)
        : (((u.id * 2654435761) >>> 0) & 1 ? 1 : -1);
      u.sideDir = dirS;
      u.sideUntil = game.time + 0.6;
    }
    const stats = game.ustatOf(u);
    const speed = stats.speed * moveSpeedMult(u, game.time);
    // steer onto the perpendicular (the speed cap in updateMovement blends
    // this with the forward step — total never exceeds the unit's speed)
    const k = (u.blockedT || 0) > 0.5 ? 1.0 : 0.75;
    u.x += -my * dirS * speed * dt * k;
    u.y += mx * dirS * speed * dt * k;
  }
}

function separate(game) {
  const ents = game.entities;
  for (let i = 0; i < ents.length; i++) {
    const a = ents[i];
    for (let j = i + 1; j < ents.length; j++) {
      const b = ents[j];
      if (a.isAir !== b.isAir) continue; // air passes over ground
      // A marching unit must not SHOVE a stationary TEAMMATE around (an
      // engaged artillery line was getting displaced by troops passing from
      // behind): the mover absorbs the whole correction, the stander holds.
      // The total separation is unchanged — only who moves. Enemy pairs keep
      // the mutual push (armies must be able to press into each other).
      let mover = null;
      if (a.team === b.team) {
        if (a.state === 'march' && b.state !== 'march') mover = a;
        else if (b.state === 'march' && a.state !== 'march') mover = b;
      }
      // ROOT-CAUSE FIX for "units can't get past each other": when same-team
      // units are marching, resolve their overlap SIDEWAYS (perpendicular to
      // the mover's actual heading), never nose-to-tail along it. Pushing along
      // the path just shoves the trailing unit backward, so a column — and
      // especially a WIDE body whose long axis lies across the path — can never
      // file past a slow/stopped unit ahead. Fanning them out laterally lets
      // the column flow around; this works for vertical chases too (then the
      // fan-out axis is X). Stopped/fighting pairs keep tight formation.
      const lateral = a.team === b.team && (a.state === 'march' || b.state === 'march');
      // which axis clears the pair "sideways"? perpendicular to the heading of
      // the marching unit (mover if set): mostly-horizontal travel fans out in
      // Y, mostly-vertical travel fans out in X.
      let crossAxis = null;
      if (lateral) {
        const ref = mover || (a.state === 'march' ? a : b);
        crossAxis = Math.abs(ref.mvx ?? 1) >= Math.abs(ref.mvy ?? 0) ? 'y' : 'x';
      }
      // rectangular units (2x1 etc.) separate as boxes so a neat formation
      // stays put instead of the wide bodies shoving apart on their long axis
      if (a.footprint || b.footprint) { separateBox(a, b, mover, crossAxis); continue; }
      const minD = a.radius + b.radius;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2);
      if (crossAxis) {
        // clear the overlap purely along the cross axis: fan the column out
        const along = crossAxis === 'y' ? dx : dy;   // offset along the heading
        let s = crossAxis === 'y' ? dy : dx;         // offset across it
        if (Math.abs(s) < 0.001) s = a.id < b.id ? 1 : -1;
        const dir = s < 0 ? -1 : 1;                  // side b should move to
        const need = Math.sqrt(Math.max(0.01, minD * minD - along * along));
        const gap = need - Math.abs(crossAxis === 'y' ? dy : dx);
        if (gap <= 0) continue;
        if (mover) {
          const push = Math.min(gap, 3) * dir * (mover === b ? 1 : -1);
          if (crossAxis === 'y') mover.y += push; else mover.x += push;
        } else {
          const push = Math.min(gap / 2, 3) * dir;
          if (crossAxis === 'y') { a.y -= push; b.y += push; }
          else { a.x -= push; b.x += push; }
        }
        continue;
      }
      if (d < 0.001) {
        // perfectly stacked: push apart deterministically by id parity
        dx = a.id < b.id ? 1 : -1;
        dy = 0;
        d = 1;
      }
      const nx = dx / d;
      const ny = dy / d;
      if (mover) {
        const push = Math.min(minD - d, 2.5);
        const s = mover === a ? -1 : 1;
        mover.x += s * nx * push;
        mover.y += s * ny * push;
        continue;
      }
      const push = Math.min((minD - d) / 2, 2);
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
    }
  }
}

// AABB separation: push the pair apart along the axis of SMALLEST overlap
// (splitting the push), using each unit's half-extents. Units placed flush on
// the grid have zero overlap and never move. With `mover` set (a marching unit
// against a stationary teammate) the mover absorbs the whole push — same total
// separation, but the standing formation is never displaced. `forceAxis`
// ('x' | 'y', from the marching pair's heading) pins the split to the cross
// axis so columns fan out and file past instead of shoving nose-to-tail.
function separateBox(a, b, mover = null, forceAxis = null) {
  const ex = (a.hw || a.radius) + (b.hw || b.radius);
  const ey = (a.hh || a.radius) + (b.hh || b.radius);
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const px = ex - Math.abs(dx); // x-overlap (>0 => overlapping)
  const py = ey - Math.abs(dy); // y-overlap
  if (px <= 0 || py <= 0) return;
  const capM = forceAxis ? 3.5 : 2.5; // marchers clear sideways a touch faster
  const capS = forceAxis ? 3.5 : 2;
  const useX = forceAxis ? forceAxis === 'x' : px < py;
  if (useX) {
    if (dx === 0) dx = a.id < b.id ? 1 : -1;
    const sgn = dx < 0 ? -1 : 1;
    if (mover) {
      const push = Math.min(px, capM) * sgn;
      if (mover === a) mover.x -= push; else mover.x += push;
    } else {
      const push = Math.min(px / 2, capS) * sgn;
      a.x -= push; b.x += push;
    }
  } else {
    if (dy === 0) dy = a.id < b.id ? 1 : -1;
    const sgn = dy < 0 ? -1 : 1;
    if (mover) {
      const push = Math.min(py, capM) * sgn;
      if (mover === a) mover.y -= push; else mover.y += push;
    } else {
      const push = Math.min(py / 2, capS) * sgn;
      a.y -= push; b.y += push;
    }
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
