// Unified character drawing: uploaded sprites (per team race) take
// priority, then the built-in vector puppets; returns false when neither
// exists so the caller can draw the plain geometric marker instead.

import { UNITS } from '../units.js';
import { PUPPETS, PALETTES, drawPuppet } from './puppets.js';
import { unitSizeOf, buildingSizeOf, statsBuilding } from '../ui/balance.js';
import {
  getSprite, getAnySprite, hasSpriteAnim, getThumb,
  drawSprite, drawSpriteScaled, maxFrameHeight, raceOf,
} from './sprites.js';

export { setTeamRaces } from './sprites.js';

// Visual size multiplier: per-race for both units and buildings.
export function sizeOf(race, ent) {
  return UNITS[ent] ? unitSizeOf(race, ent) : buildingSizeOf(race, ent);
}

function unitH(type, scale) {
  return (UNITS[type].radius * 2.8 + 4) * scale;
}

// One scale per unit, calibrated so the tallest (standing) frame is unitH
// tall. Every frame then draws at this shared scale — the die frame keeps
// its true relative size instead of being fitted on its own.
function drawEntitySprite(ctx, race, ent, entry, targetH, team) {
  const maxH = maxFrameHeight(race, ent);
  if (maxH > 0) drawSpriteScaled(ctx, entry, targetH / maxH, team);
  else drawSprite(ctx, entry, targetH, team); // pre-load fallback
}

export function hasCharacter(type, team = 0) {
  return !!PUPPETS[type] || getAnySprite(raceOf(team), type) != null;
}

// True when a death animation exists (sprite or puppet) — used for corpses.
export function hasDeathAnim(type, team = 0) {
  return hasSpriteAnim(raceOf(team), type, 'die') || !!PUPPETS[type];
}

export function drawCharacter(ctx, type, anim, frame, team, scale = 1) {
  const race = raceOf(team);
  const entry = getSprite(race, type, anim, frame);
  if (entry) {
    drawEntitySprite(ctx, race, type, entry, unitH(type, scale), team);
    return true;
  }
  if (PUPPETS[type]) {
    drawPuppet(ctx, type, anim, frame, PALETTES[team], scale);
    return true;
  }
  // sprite set exists but not this animation — show any frame rather than nothing
  const any = getAnySprite(race, type);
  if (any) {
    drawEntitySprite(ctx, race, type, any, unitH(type, scale), team);
    return true;
  }
  return false;
}

// Uploaded shop thumbnail (units or buildings). False -> caller falls back.
export function drawThumb(ctx, ent, team = 0, targetH = 34) {
  const t = getThumb(raceOf(team), ent);
  if (!t) return false;
  drawSprite(ctx, t, targetH, team);
  return true;
}

// Per-building idle frame flip rate (Hz), per race; higher = faster idle 1↔2.
function idleSpeedOf(race, kind) {
  const b = statsBuilding(race, kind);
  return (b && b.idleSpeed) || 2;
}

// Building sprite (idle, 2-frame pulse at the per-building speed). False ->
// caller draws vector.
export function drawStructureSprite(ctx, kind, team, radius, clock, idSeed = 0) {
  const race = raceOf(team);
  const frame = (Math.floor(clock * idleSpeedOf(race, kind)) + idSeed) % 2;
  const entry = getSprite(race, kind, 'idle', frame);
  if (!entry) return false;
  drawEntitySprite(ctx, race, kind, entry, radius * 3 * sizeOf(race, kind), team);
  return true;
}

// A single fixed idle frame (default frame 0 = "idle 1") for the build ghost
// on the cursor. False -> caller draws vector only.
export function drawBuildingSprite(ctx, kind, team, radius, frame = 0) {
  const race = raceOf(team);
  const entry = getSprite(race, kind, 'idle', frame);
  if (!entry) return false;
  drawEntitySprite(ctx, race, kind, entry, radius * 3 * sizeOf(race, kind), team);
  return true;
}
