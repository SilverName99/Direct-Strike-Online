// Unified character drawing: uploaded sprites take priority, then the
// built-in vector puppets; returns false when neither exists so the caller
// can draw the plain geometric marker instead.

import { PUPPETS, PALETTES, drawPuppet } from './puppets.js';
import { getSprite, getAnySprite, hasSpriteAnim, drawSprite } from './sprites.js';

export function hasCharacter(type) {
  return !!PUPPETS[type] || getAnySprite(type) != null;
}

// True when a death animation exists (sprite or puppet) — used for corpses.
export function hasDeathAnim(type) {
  return hasSpriteAnim(type, 'die') || !!PUPPETS[type];
}

export function drawCharacter(ctx, type, anim, frame, team, scale = 1) {
  const entry = getSprite(type, anim, frame);
  if (entry) {
    drawSprite(ctx, entry, type, team, scale);
    return true;
  }
  if (PUPPETS[type]) {
    drawPuppet(ctx, type, anim, frame, PALETTES[team], scale);
    return true;
  }
  // sprite set exists but not this animation — show any frame rather than nothing
  const any = getAnySprite(type);
  if (any) {
    drawSprite(ctx, any, type, team, scale);
    return true;
  }
  return false;
}
