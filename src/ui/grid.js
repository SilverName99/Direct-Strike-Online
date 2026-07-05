// Placement grid (UI-side only): snapping happens before commands are
// issued, so the sim stays coordinate-agnostic. Toggle with G.

import { CONFIG } from '../config.js';

// Snap a point to the center of its grid cell, anchored to the zone origin.
export function snapToZone(zone, x, y) {
  const g = CONFIG.GRID;
  const cx = zone.x0 + (Math.floor((x - zone.x0) / g) + 0.5) * g;
  const cy = zone.y0 + (Math.floor((y - zone.y0) / g) + 0.5) * g;
  return {
    x: clamp(cx, zone.x0 + g / 2, zone.x1 - g / 2),
    y: clamp(cy, zone.y0 + g / 2, zone.y1 - g / 2),
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
