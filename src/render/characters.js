// Unified character drawing: uploaded sprites (per team race) take
// priority, then the built-in vector puppets; returns false when neither
// exists so the caller can draw the plain geometric marker instead.

import { UNITS } from '../units.js';
import { PUPPETS, PALETTES, drawPuppet } from './puppets.js';
import {
  getSprite, getAnySprite, hasSpriteAnim, getThumb, drawSprite, raceOf,
} from './sprites.js';

export { setTeamRaces } from './sprites.js';

function unitH(type, scale) {
  return (UNITS[type].radius * 2.8 + 4) * scale;
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
    drawSprite(ctx, entry, unitH(type, scale), team);
    return true;
  }
  if (PUPPETS[type]) {
    drawPuppet(ctx, type, anim, frame, PALETTES[team], scale);
    return true;
  }
  // sprite set exists but not this animation — show any frame rather than nothing
  const any = getAnySprite(race, type);
  if (any) {
    drawSprite(ctx, any, unitH(type, scale), team);
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

// Building sprite (idle, slow 2-frame pulse). False -> caller draws vector.
export function drawStructureSprite(ctx, kind, team, radius, clock, idSeed = 0) {
  const entry = getSprite(raceOf(team), kind, 'idle', (Math.floor(clock * 2) + idSeed) % 2);
  if (!entry) return false;
  drawSprite(ctx, entry, radius * 3, team);
  return true;
}
