// Unified character drawing: uploaded sprites (per team race) take
// priority, then the built-in vector puppets; returns false when neither
// exists so the caller can draw the plain geometric marker instead.

import { UNITS } from '../units.js';
import { PUPPETS, PALETTES, drawPuppet } from './puppets.js';
import { unitSizeOf, buildingSizeOf, statsBuilding } from '../ui/balance.js';
import {
  getSprite, getFrame, getAnySprite, hasSpriteAnim, getThumb, getProjectile, getAbilityProjectile, getAcidProjectile, getFireProjectile,
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

// The cast animation name for an ability, or null if that unit has no
// uploaded cast frames for it (renderer then keeps the normal pose).
export function castAnimOf(type, team, ability) {
  const anim = `cast-${ability}`;
  return hasSpriteAnim(raceOf(team), type, anim) ? anim : null;
}

// True when a caster has uploaded the shared "Prepare spell" wind-up frame.
export function hasPrepareAnim(type, team) {
  return hasSpriteAnim(raceOf(team), type, 'prepare');
}

// True when a dash unit has uploaded its "Dash" (charge) frame.
export function hasDashAnim(type, team) {
  return hasSpriteAnim(raceOf(team), type, 'dash');
}

// True when an acid-spit unit has uploaded its "Acid" attack frames.
export function hasAcidAnim(type, team) {
  return hasSpriteAnim(raceOf(team), type, 'acid');
}

// True when a fireball unit has uploaded its "Foc" ("fire-<which>") sprite for
// walking or attacking.
export function hasFireAnim(type, team, which) {
  return hasSpriteAnim(raceOf(team), type, `fire-${which}`);
}

// True when a unit has uploaded its "Scut" activation frame (shield upgrade).
export function hasShieldAnim(type, team) {
  return hasSpriteAnim(raceOf(team), type, 'shield');
}

// True when a dismounted unit has an uploaded on-foot ("foot-<anim>") sprite.
export function hasFootAnim(type, team, anim) {
  return hasSpriteAnim(raceOf(team), type, `foot-${anim}`);
}

// True when a summoned animal has an uploaded "<animal>-<anim>" sprite hosted
// on the caster's type (e.g. wolf-walk, eagle-attack, bear-die).
export function hasSummonAnim(type, team, animal, anim) {
  return hasSpriteAnim(raceOf(team), type, `${animal}-${anim}`);
}

// True when a split-off mount has an uploaded beast ("beast-<anim>") sprite.
export function hasBeastAnim(type, team, anim) {
  return hasSpriteAnim(raceOf(team), type, `beast-${anim}`);
}

// True when a hero has uploaded its Elemental Form ("morph-<anim>") sprite set.
export function hasMorphAnim(type, team, anim) {
  return hasSpriteAnim(raceOf(team), type, `morph-${anim}`);
}

// Uploaded projectile image for a unit type, contain-fit into a targetH
// square (caller rotates the context toward travel). False -> caller draws
// the default dot.
export function drawProjectileSprite(ctx, type, team, targetH) {
  const entry = getProjectile(raceOf(team), type);
  if (!entry) return false;
  drawSprite(ctx, entry, targetH, team);
  return true;
}

// Dedicated Acid Spit projectile image for a unit type. False -> caller
// falls back to the normal projectile image / procedural dot.
export function drawAcidProjectileSprite(ctx, type, team, targetH) {
  const entry = getAcidProjectile(raceOf(team), type);
  if (!entry) return false;
  drawSprite(ctx, entry, targetH, team);
  return true;
}

// Dedicated Fireball projectile image for a unit type. False -> caller falls
// back to the normal projectile image / procedural dot.
export function drawFireProjectileSprite(ctx, type, team, targetH) {
  const entry = getFireProjectile(raceOf(team), type);
  if (!entry) return false;
  drawSprite(ctx, entry, targetH, team);
  return true;
}

// Per-caster projectile image for an ability (e.g. one unit's Frost Bolt).
// False -> caller falls back to the ability's procedural glow.
export function drawAbilityProjectileSprite(ctx, ability, type, team, targetH) {
  const entry = getAbilityProjectile(raceOf(team), type, ability);
  if (!entry) return false;
  drawSprite(ctx, entry, targetH, team);
  return true;
}

// Uploaded shop thumbnail (units or buildings). False -> caller falls back.
// `form` picks the on-foot rider / beast thumbnail (fallback: the base one).
export function drawThumb(ctx, ent, team = 0, targetH = 34, form = 'base') {
  const t = getThumb(raceOf(team), ent, form);
  if (!t) return false;
  drawSprite(ctx, t, targetH, team);
  return true;
}

// Per-building idle frame flip rate (Hz), per race; higher = faster idle 1↔2.
function idleSpeedOf(race, kind) {
  const b = statsBuilding(race, kind);
  return (b && b.idleSpeed) || 2;
}

// Draw a building's idle frame sized to its footprint. Footprint buildings
// (wall/tower/generator, given hw/hh from their cw×ch cells) contain-fit the
// box so the art never spills outside the chenar; the per-building size
// setting scales within that (100% = fill the box). Main/turret keep their
// round radius-based scale. Size is applied HERE — callers must not also
// scale by size.
function drawBuildingScaled(ctx, race, kind, entry, hw, hh, team) {
  const size = sizeOf(race, kind);
  let scale;
  if (kind === 'main' || kind === 'turret') {
    const maxH = maxFrameHeight(race, kind);
    const base = hw * 3 * size; // hw == radius for these
    scale = maxH > 0 ? base / maxH : base / entry.img.height;
  } else {
    scale = Math.min((2 * hw * size) / entry.img.width, (2 * hh * size) / entry.img.height);
  }
  drawSpriteScaled(ctx, entry, scale, team);
}

// Building sprite (idle, 2-frame pulse at the per-building speed). False ->
// caller draws vector.
export function drawStructureSprite(ctx, kind, team, hw, hh, clock, idSeed = 0) {
  const race = raceOf(team);
  const frame = (Math.floor(clock * idleSpeedOf(race, kind)) + idSeed) % 2;
  const entry = getSprite(race, kind, 'idle', frame);
  if (!entry) return false;
  drawBuildingScaled(ctx, race, kind, entry, hw, hh, team);
  return true;
}

// Construction-site art while a building raises (buildTime): 2 uploaded
// frames per building — frame 0 shows from 30% progress, frame 1 from 60%.
// False -> caller falls back to a ghosted finished building.
export function drawConstructSprite(ctx, kind, team, hw, hh, frame) {
  const race = raceOf(team);
  const entry = getSprite(race, kind, 'construct', frame) || getSprite(race, kind, 'construct', 0);
  if (!entry) return false;
  drawBuildingScaled(ctx, race, kind, entry, hw, hh, team);
  return true;
}

// A single fixed idle frame (default frame 0 = "idle 1") for the build ghost
// on the cursor. False -> caller draws vector only.
export function drawBuildingSprite(ctx, kind, team, hw, hh, frame = 0) {
  const race = raceOf(team);
  const entry = getSprite(race, kind, 'idle', frame)
    || ((kind === 'tower' || kind === 'wall') ? getSprite(race, kind, 'tier1-idle', frame) : null);
  if (!entry) return false;
  drawBuildingScaled(ctx, race, kind, entry, hw, hh, team);
  return true;
}

// ---- Walls: an idle look per base tier (1/2/3), 2-frame pulse. A tier with no
// uploaded frame borrows the nearest lower tier; tier 1 also falls back to the
// plain idle_0/1 slots, so an existing single-look wall keeps working.
function wallEntry(race, tier, frame) {
  const t = tier < 1 ? 1 : tier > 3 ? 3 : tier;
  for (let k = t; k >= 1; k--) {
    const e = getSprite(race, 'wall', `tier${k}-idle`, frame);
    if (e) return e;
  }
  return getSprite(race, 'wall', 'idle', frame); // legacy single-look
}

// Draw a wall's idle frame for its base tier. False -> caller draws vector.
export function drawWallSprite(ctx, team, tier, hw, hh, clock, idSeed = 0) {
  const race = raceOf(team);
  const frame = (Math.floor(clock * idleSpeedOf(race, 'wall')) + idSeed) % 2;
  const entry = wallEntry(race, tier, frame);
  if (!entry) return false;
  drawBuildingScaled(ctx, race, 'wall', entry, hw, hh, team);
  return true;
}

// ---- Towers: three tiers (weak → strong), each with its own idle / attack /
// die / campfire art. A tier with no uploaded frame borrows the nearest lower
// tier's, so a partial upload still draws. `anim` ∈ idle|attack|die|camp.
function towerEntry(race, tier, anim, frame) {
  const t = tier < 1 ? 1 : tier > 3 ? 3 : tier;
  for (let k = t; k >= 1; k--) {
    const e = getSprite(race, 'tower', `tier${k}-${anim}`, frame);
    if (e) return e;
  }
  // legacy single-look tower art (pre-tier uploads) only covers idle/attack;
  // camp / camptower / die have no legacy equivalent -> null when not uploaded
  if (anim === 'idle' || anim === 'attack') return getSprite(race, 'tower', anim, frame);
  return null;
}

// True once a race has at least one uploaded tier-tower idle frame (i.e. it
// opted into the 3-tier tower art; otherwise the old single-look path runs).
export function hasTowerTierArt(team) {
  const race = raceOf(team);
  return !!(getSprite(race, 'tower', 'tier1-idle', 0)
    || getSprite(race, 'tower', 'tier2-idle', 0)
    || getSprite(race, 'tower', 'tier3-idle', 0));
}

// One shared scale for ALL of a tier's tower-BODY frames, taken from that
// tier's idle 1 frame. Every body frame (idle / attack / camptower / die) draws
// at this exact scale and centered, so switching frames only swaps the artwork
// — the tower never resizes or "teleports" (as it did when each frame was
// contain-fit to the footprint on its own). Null if there's no idle reference.
function towerBodyScale(race, tier, hw, hh) {
  const ref = towerEntry(race, tier, 'idle', 0);
  if (!ref) return null;
  const size = sizeOf(race, 'tower');
  return Math.min((2 * hw * size) / ref.img.width, (2 * hh * size) / ref.img.height);
}

// Draw a tower frame for its base tier. `anim` ∈ idle|attack|camptower|camp.
// Body frames share the tier scale (above); the campfire SOLDIERS ('camp') are
// a separate small sprite, so they fit the box the caller passes. False -> the
// caller falls back.
export function drawTowerSprite(ctx, team, tier, hw, hh, anim, frame) {
  const race = raceOf(team);
  const entry = towerEntry(race, tier, anim, frame);
  if (!entry) return false;
  if (anim === 'camp') { drawBuildingScaled(ctx, race, 'tower', entry, hw, hh, team); return true; }
  const s = towerBodyScale(race, tier, hw, hh);
  if (s != null) drawSpriteScaled(ctx, entry, s, team);
  else drawBuildingScaled(ctx, race, 'tower', entry, hw, hh, team);
  return true;
}

// The tower's per-tier "destroyed" frame, drawn as a fading rubble corpse (at
// the same shared tier scale so it lands where the tower stood).
export function drawTowerDie(ctx, team, tier, hw, hh) {
  const race = raceOf(team);
  const entry = towerEntry(race, tier, 'die', 0);
  if (!entry) return false;
  const s = towerBodyScale(race, tier, hw, hh);
  if (s != null) drawSpriteScaled(ctx, entry, s, team);
  else drawBuildingScaled(ctx, race, 'tower', entry, hw, hh, team);
  return true;
}

// True when the main base has at least one uploaded per-tier image.
export function hasMainTier(team) {
  const race = raceOf(team);
  return !!(getFrame(race, 'main', 'tier', 0) || getFrame(race, 'main', 'tier', 1) || getFrame(race, 'main', 'tier', 2));
}

// Draw the main base image for its current tier (1..3). Falls back to a lower
// tier's image if the current one isn't uploaded. False -> caller draws vector.
export function drawMainTierSprite(ctx, team, tier, hw, hh) {
  const race = raceOf(team);
  for (let t = Math.min(3, Math.max(1, tier)); t >= 1; t--) {
    const entry = getFrame(race, 'main', 'tier', t - 1);
    if (entry) { drawBuildingScaled(ctx, race, 'main', entry, hw, hh, team); return true; }
  }
  return false;
}

// True when an armed building (turret/tower) has an uploaded attack animation.
export function hasStructureAttack(kind, team) {
  return getSprite(raceOf(team), kind, 'attack', 0) != null;
}

// Draw an armed building's attack frame (used while it's firing). False ->
// caller falls back to the idle sprite / vector.
export function drawStructureAttack(ctx, kind, team, hw, hh, frame) {
  const race = raceOf(team);
  const entry = getSprite(race, kind, 'attack', frame);
  if (!entry) return false;
  drawBuildingScaled(ctx, race, kind, entry, hw, hh, team);
  return true;
}
