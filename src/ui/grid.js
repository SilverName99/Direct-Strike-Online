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

// The zone a placement kind belongs to for the local player (team 0).
export function zoneFor(selected) {
  if (selected === 'wall' || selected === 'tower' || selected === 'generator') {
    return CONFIG.CONSTRUCTION_ZONE[0];
  }
  return CONFIG.ARMY_ZONE[0];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
