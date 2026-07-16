// Placement grid (UI-side only): snapping happens before commands are
// issued, so the sim stays coordinate-agnostic. Toggle with G.

import { CONFIG } from '../config.js';

// Snap a point so a cw×ch footprint lands on whole grid cells, anchored to
// the zone origin. Parity-aware: odd footprints center on a cell, even ones
// on a grid line — so buildings always tile flush against each other and the
// colored footprint cells line up with the grid. Units (cw=ch=1) snap to
// cell centers exactly as before.
export function snapToZone(zone, x, y, cw = 1, ch = 1) {
  const g = CONFIG.GRID;
  const kx = Math.round((x - zone.x0) / g - cw / 2);
  const ky = Math.round((y - zone.y0) / g - ch / 2);
  const cx = zone.x0 + (kx + cw / 2) * g;
  const cy = zone.y0 + (ky + ch / 2) * g;
  return {
    x: clamp(cx, zone.x0 + cw * g / 2, zone.x1 - cw * g / 2),
    y: clamp(cy, zone.y0 + ch * g / 2, zone.y1 - ch * g / 2),
  };
}

// All construction rectangles for a team: the base zone plus the small
// forward pocket around the mid turret.
export function buildZonesFor(team) {
  const zones = [CONFIG.CONSTRUCTION_ZONE[team]];
  if (CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[team]) zones.push(CONFIG.MID_BUILD_ZONE[team]);
  return zones;
}

// The zone a placement kind belongs to for the given team (the local player). For
// buildings, x/y (world cursor) picks the construction rect the cursor is in
// (or nearest), so both the base zone and the mid pocket snap correctly.
export function zoneFor(selected, x = null, y = null, team = 0) {
  // Any placeable building snaps to a construction rect (base zone or mid
  // pocket); everything else (units) snaps to the army zone.
  if (CONFIG.BUILDINGS[selected]) {
    const zones = buildZonesFor(team);
    if (x == null || y == null) return zones[0];
    for (const z of zones) {
      if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return z;
    }
    let best = zones[0], bd = Infinity;
    for (const z of zones) {
      const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }
  return CONFIG.ARMY_ZONE[team];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
