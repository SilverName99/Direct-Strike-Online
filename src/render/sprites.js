// User-uploaded sprites (via /admin), organized per RACE and entity
// (units + buildings). The game fetches a manifest and preloads PNGs;
// every draw site falls back to the vector puppets / geometric shapes
// wherever an image is missing, so partial uploads are always safe.
//
// Slots per unit:     thumb, idle×2, walk×2, attack×2, die×1
// Slots per building: thumb, idle×2   (main, turret, tower, generator)
//
// Art is authored facing RIGHT on transparency, "blue-team" colored; the
// red-team variant is generated here with a hue blend (grays stay gray).

import { CONFIG } from '../config.js';

const anims = new Map();  // `${race}/${ent}/${anim}` -> [entry|null, entry|null]
const thumbs = new Map(); // `${race}/${ent}` -> entry
const maxFrameH = new Map(); // `${race}/${ent}` -> tallest animation frame (px)
const backgrounds = new Map(); // race -> Image
let teamRaces = ['humans', 'humans'];

export function setTeamRaces(races) {
  teamRaces = races.slice();
}

export function raceOf(team) {
  return teamRaces[team] || 'humans';
}

export function loadSprites(base = 'assets/units/', onReady = null) {
  fetch(`${base}manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((man) => {
      if (!man || !man.races) return;
      let pending = 1; // guard so done() can't fire before the loop ends
      const done = () => {
        if (--pending === 0 && onReady) onReady();
      };
      const load = (url, cb) => {
        pending++;
        const img = new Image();
        img.onload = () => {
          cb(img);
          done();
        };
        img.onerror = done;
        img.src = url;
      };
      for (const [race, ents] of Object.entries(man.races || {})) {
        for (const [ent, slots] of Object.entries(ents)) {
          if (slots.thumb) {
            load(`${base}${race}/${ent}/thumb.png?v=${man.v || 0}`, (img) => {
              thumbs.set(`${race}/${ent}`, entryFor(img));
            });
          }
          for (const [anim, frames] of Object.entries(slots)) {
            if (anim === 'thumb' || !Array.isArray(frames)) continue;
            frames.forEach((present, i) => {
              if (!present) return;
              load(`${base}${race}/${ent}/${anim}_${i}.png?v=${man.v || 0}`, (img) => {
                const key = `${race}/${ent}/${anim}`;
                let rec = anims.get(key);
                if (!rec) {
                  rec = [null, null];
                  anims.set(key, rec);
                }
                rec[i] = entryFor(img);
                // remember the tallest frame (the standing pose) so every
                // frame of this unit draws at one shared scale
                const entKey = `${race}/${ent}`;
                maxFrameH.set(entKey, Math.max(maxFrameH.get(entKey) || 0, img.height));
              });
            });
          }
        }
      }
      // per-race background image (shown on that side's half of the field)
      for (const race of Object.keys(man.backgrounds || {})) {
        load(`${base}${race}/background.png?v=${man.v || 0}`, (img) => backgrounds.set(race, img));
      }
      done();
    })
    .catch(() => { /* no manifest (static/file hosting) — fallbacks apply */ });
}

// Native + team-tinted (blue/red) variants for one image.
function entryFor(img) {
  return { img, blue: tint(img, '#3f7fe0'), red: tint(img, '#e04250') };
}

// Replace hues with a team hue while keeping lightness/saturation
// (grays — swords, metal — stay gray).
function tint(img, hex) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'hue';
  x.fillStyle = hex;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0);
  return c;
}

// Which image variant to draw for a team, per the team-tint setting.
function pickImg(entry, team) {
  const mode = CONFIG.TEAM_TINT || 'enemy';
  if (mode === 'none') return entry.img;
  if (mode === 'team') return team === 1 ? entry.red : entry.blue;
  return team === 1 ? entry.red : entry.img; // 'enemy': mine native, enemy red
}

export function getBackground(race) {
  return backgrounds.get(race) || null;
}

export function getSprite(race, ent, anim, frame) {
  const rec = anims.get(`${race}/${ent}/${anim}`);
  if (!rec) return null;
  // tolerate a missing twin frame (e.g. die has a single frame)
  return rec[frame] || rec[frame ^ 1] || null;
}

export function getAnySprite(race, ent) {
  for (const a of ['idle', 'walk', 'attack', 'die']) {
    const s = getSprite(race, ent, a, 0);
    if (s) return s;
  }
  return null;
}

export function hasSpriteAnim(race, ent, anim) {
  return getSprite(race, ent, anim, 0) != null;
}

export function getThumb(race, ent) {
  return thumbs.get(`${race}/${ent}`) || null;
}

// Tallest animation frame of a unit (the standing pose), in native px.
// 0 if none loaded yet.
export function maxFrameHeight(race, ent) {
  return maxFrameH.get(`${race}/${ent}`) || 0;
}

// Draw the whole frame at an explicit scale (world units per image pixel),
// preserving the artist's exact composition and proportions. Every frame of
// a unit shares one scale, so a wide "lying down" die frame is never resized
// on its own — it appears exactly as drawn, at its true size relative to the
// standing poses. Caller mirrors for team 1.
export function drawSpriteScaled(ctx, entry, scale, team) {
  const img = pickImg(entry, team);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
}

// Contain-fit into a targetH square (used for shop thumbnails, where each
// icon should fill its card regardless of the frame's aspect).
export function drawSprite(ctx, entry, targetH, team) {
  const img = pickImg(entry, team);
  const s = targetH / Math.max(img.width, img.height);
  drawSpriteScaled(ctx, entry, s, team);
}
