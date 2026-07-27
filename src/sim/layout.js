// Battlefield layout generator for team modes ("defense in depth").
//
// A side is a stack of DEPTH ZONES from the back edge toward midfield, one per
// player: the ANCHOR (the classic 1v1 base strips), then — in team modes — a
// CENTER zone and a VANGUARD zone closer to the middle, each smaller. Every
// zone is an [army strip][construction strip] pair, exactly like 1v1.
//
// teamLayout(1) reproduces the historical 1v1 constants EXACTLY (army 100-500,
// build 560-920, midfield 2000, turret 1320, mid pocket 1220-1420), so the
// whole game — 1v1 included — can derive its geometry from one source of
// truth without any behavior change.
//
// Deterministic and DOM-free (lives in src/sim/); safe for lockstep.

import { CONFIG } from '../config.js';

// Strip widths (px) per zone role: [army strip, construction strip].
// anchor === the classic 1v1 sizes; center/vanguard shrink toward the front.
const ROLES = {
  anchor: { armyW: 400, buildW: 360 },
  center: { armyW: 240, buildW: 240 },
  vanguard: { armyW: 160, buildW: 160 },
};
const EDGE = 100;        // field edge -> first army strip (1v1: army x0 = 100)
const GAP_AB = 60;       // army -> build gap inside a zone (1v1: 500 -> 560)
const GAP_ZONE = 80;     // gap between consecutive depth zones
const OPEN_FIELD = 1080; // front-most build edge -> midfield (1v1: 920 -> 2000)
const LANE_Y0 = 80, LANE_Y1 = 880; // the playable lane band (same as 1v1 zones)
const TURRET_FROM_MID = 680;       // 1v1: mid 2000, turret 1320
const MAIN_INSET = 80;             // main base sits this far into its build strip (1v1: 560+80=640)

// roles per depth, back -> front, by players-per-side
function rolesFor(n) {
  return n === 1 ? ['anchor'] : n === 2 ? ['anchor', 'vanguard'] : ['anchor', 'center', 'vanguard'];
}

// Depth-zone strips for ONE side, built back -> front from the field edge.
// Returns the zone rects (left-side coordinates) and the front-most build edge.
function sideStrips(n) {
  const roles = rolesFor(n);
  let x = EDGE;
  const zones = [];
  for (let d = 0; d < n; d++) {
    const r = ROLES[roles[d]];
    const army = { x0: x, x1: x + r.armyW, y0: LANE_Y0, y1: LANE_Y1 };
    x += r.armyW + GAP_AB;
    const build = { x0: x, x1: x + r.buildW, y0: LANE_Y0, y1: LANE_Y1 };
    x += r.buildW;
    zones.push({ role: roles[d], army, build });
    if (d < n - 1) x += GAP_ZONE;
  }
  return { zones, front: x };
}

// teamLayout(a) = symmetric a-v-a; teamLayout(a, b) = ASYMMETRIC (side 0 has a
// players, side 1 has b). The midfield stays the field's exact center (movement
// and the mid-control bonus rely on FIELD_W / 2), so the shallower side simply
// faces a longer open field.
export function teamLayout(playersPerSide, playersRight = null) {
  const a = Math.max(1, Math.min(3, Math.round(playersPerSide || 1)));
  const b = Math.max(1, Math.min(3, Math.round(playersRight != null ? playersRight : a)));
  const left = sideStrips(a);
  const right = sideStrips(b);
  const mid = Math.max(left.front, right.front) + OPEN_FIELD;
  const fieldW = mid * 2;
  const mirror = (r) => ({ x0: fieldW - r.x1, x1: fieldW - r.x0, y0: r.y0, y1: r.y1 });

  // player order: side 0 back->front, then side 1 back->front (1v1: [left, right])
  const perPlayer = [];
  for (let d = 0; d < a; d++) {
    const z = left.zones[d];
    perPlayer.push({ side: 0, depth: d, role: z.role, army: z.army, build: z.build, main: { x: z.build.x0 + MAIN_INSET, y: CONFIG.MAIN.y } });
  }
  for (let d = 0; d < b; d++) {
    const z = right.zones[d];
    const army = mirror(z.army);
    const build = mirror(z.build);
    perPlayer.push({ side: 1, depth: d, role: z.role, army, build, main: { x: build.x1 - MAIN_INSET, y: CONFIG.MAIN.y } });
  }

  const turretX = [mid - TURRET_FROM_MID, mid + TURRET_FROM_MID];
  const midBuild = [
    { x0: turretX[0] - 100, x1: turretX[0] + 100, y0: 280, y1: 680 },
    { x0: turretX[1] - 100, x1: turretX[1] + 100, y0: 280, y1: 680 },
  ];
  return { playersPerSide: Math.max(a, b), sides: [a, b], fieldW, perPlayer, turretX, midBuild };
}

// Point the GLOBAL config (renderer / camera / minimap / UI / AI read these) at
// a mode's geometry. 1v1 restores the exact historical constants. The per-side
// CONSTRUCTION/ARMY zones are set to each side's ANCHOR zone — old consumers
// (AI, zone plates) keep a sensible rect until they learn multi-zone (later
// phases). Call before `new Game(...)` when starting a match.
export function applyModeLayout(playersPerSide, playersRight = null) {
  const lay = teamLayout(playersPerSide, playersRight);
  CONFIG.FIELD_W = lay.fieldW;
  CONFIG.TURRET_X = [...lay.turretX];
  CONFIG.MID_BUILD_ZONE = lay.midBuild.map((z) => ({ ...z }));
  const anchors = [lay.perPlayer.find((p) => p.side === 0), lay.perPlayer.find((p) => p.side === 1)];
  CONFIG.CONSTRUCTION_ZONE = anchors.map((a) => ({ ...a.build }));
  CONFIG.ARMY_ZONE = anchors.map((a) => ({ ...a.army }));
  CONFIG.MAIN.x = anchors.map((a) => a.main.x);
  return lay;
}
