// User-uploaded sprites (via /admin), organized per RACE and entity
// (units + buildings). The game fetches a manifest and preloads PNGs;
// every draw site falls back to the vector puppets / geometric shapes
// wherever an image is missing, so partial uploads are always safe.
//
// Slots per unit:     thumb, idle×2, walk×2, attack×2, die×1
// Slots per building: thumb, idle×2   (main, turret, tower, generator, wall)
//
// Art is authored facing RIGHT on transparency, "blue-team" colored; the
// red-team variant is generated here with a hue blend (grays stay gray).

import { CONFIG } from '../config.js';

const anims = new Map();  // `${race}/${ent}/${anim}` -> [entry|null, entry|null]
const thumbs = new Map(); // `${race}/${ent}` -> entry
const projectiles = new Map(); // `${race}/${ent}` -> entry (single projectile image)
const abilityProjectiles = new Map(); // `${race}/${ent}/${abilityId}` -> entry
const acidProjectiles = new Map();    // `${race}/${ent}` -> entry (Acid Spit projectile)
const fireProjectiles = new Map();    // `${race}/${ent}` -> entry (Fireball projectile)
const maxFrameH = new Map(); // `${race}/${ent}` -> tallest animation frame (px)
const backgrounds = new Map(); // race -> Image
const middleImgs = [];         // GLOBAL middle-of-map strip variants (by slot index); which one shows is chosen in the sim
const musicUrls = new Map();   // race -> url of the uploaded background track
const cursorUrls = new Map();  // race -> url of the uploaded custom mouse cursor
const uiIcons = new Map();     // GLOBAL command-card icons: 'ability-<id>' / 'upgrade-<id>' -> Image
const tabIcons = new Map();    // `${race}/units` | `${race}/buildings` -> Image (shop tab buttons)
const baseUpgIcons = new Map(); // race -> Image (base tier-upgrade slot icon, per race)
const barSkins = new Map();    // race -> url of the uploaded bottom-bar background design
const barOverlays = new Map(); // race -> url of the bottom-bar overlay (drawn over the UI)
const portraitVideos = new Map(); // `${race}/${ent}` -> url of the idle portrait clip (mp4/webm)
const mapVideoUrls = new Map();   // `${race}/${which}` -> url of a mine/worker idle clip (portrait box only)
const towerVideoUrls = new Map(); // `${race}/tier{1..3}` -> url of a tower's per-tier portrait clip
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
          // per-form thumbnails: the rider on foot / the split-off beast
          if (slots['foot-thumb']) {
            load(`${base}${race}/${ent}/foot-thumb.png?v=${man.v || 0}`, (img) => {
              thumbs.set(`${race}/${ent}/foot`, entryFor(img));
            });
          }
          if (slots['beast-thumb']) {
            load(`${base}${race}/${ent}/beast-thumb.png?v=${man.v || 0}`, (img) => {
              thumbs.set(`${race}/${ent}/beast`, entryFor(img));
            });
          }
          if (slots.projectile) {
            load(`${base}${race}/${ent}/projectile.png?v=${man.v || 0}`, (img) => {
              projectiles.set(`${race}/${ent}`, entryFor(img));
            });
          }
          // dedicated acid-spit projectile image (slot "acidproj")
          if (slots.acidproj) {
            load(`${base}${race}/${ent}/acidproj.png?v=${man.v || 0}`, (img) => {
              acidProjectiles.set(`${race}/${ent}`, entryFor(img));
            });
          }
          // dedicated fireball projectile image (slot "fireproj")
          if (slots.fireproj) {
            load(`${base}${race}/${ent}/fireproj.png?v=${man.v || 0}`, (img) => {
              fireProjectiles.set(`${race}/${ent}`, entryFor(img));
            });
          }
          // per-caster projectile image for an ability (slot "abilityproj-<id>")
          for (const slot of Object.keys(slots)) {
            if (!slot.startsWith('abilityproj-') || !slots[slot]) continue;
            const aid = slot.slice('abilityproj-'.length);
            load(`${base}${race}/${ent}/${slot}.png?v=${man.v || 0}`, (img) => {
              abilityProjectiles.set(`${race}/${ent}/${aid}`, entryFor(img));
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
      // GLOBAL middle-of-map strip variants (drawn over the seam; one random
      // variant is chosen per match)
      const midList = Array.isArray(man.middle) ? man.middle : (man.middle ? [man.middle] : []);
      midList.forEach((file, i) => {
        load(`${base}${file}?v=${man.v || 0}`, (img) => { middleImgs[i] = img; });
      });
      // per-race background music (played in-game, looping)
      for (const [race, file] of Object.entries(man.music || {})) {
        musicUrls.set(race, `${base}${race}/${file}?v=${man.v || 0}`);
      }
      // per-race custom mouse cursor image
      for (const [race, file] of Object.entries(man.cursors || {})) {
        cursorUrls.set(race, `${base}${race}/${file}?v=${man.v || 0}`);
      }
      // GLOBAL ability/upgrade thumbnails for the command card (assets/units/icons/)
      for (const [key, file] of Object.entries(man.icons || {})) {
        load(`${base}icons/${file}?v=${man.v || 0}`, (img) => uiIcons.set(key, img));
      }
      // per-race UNITS / CLĂDIRI shop-tab button art
      for (const [race, slots] of Object.entries(man.tabs || {})) {
        for (const [slot, file] of Object.entries(slots)) {
          load(`${base}${race}/${file}?v=${man.v || 0}`, (img) => tabIcons.set(`${race}/${slot}`, img));
        }
      }
      // per-race base tier-upgrade slot icon
      for (const [race, file] of Object.entries(man.baseupg || {})) {
        load(`${base}${race}/${file}?v=${man.v || 0}`, (img) => baseUpgIcons.set(race, img));
      }
      // per-race bottom-bar background design + overlay (just URLs for CSS)
      for (const [race, file] of Object.entries(man.barskins || {})) {
        barSkins.set(race, `${base}${race}/${file}?v=${man.v || 0}`);
      }
      for (const [race, file] of Object.entries(man.barovers || {})) {
        barOverlays.set(race, `${base}${race}/${file}?v=${man.v || 0}`);
      }
      // per-unit idle portrait clips (mp4/webm) — just URLs for a <video>
      // element. Value is {base, foot, beast} per form (legacy: a plain string
      // = the base form only).
      for (const [race, ents] of Object.entries(man.portraitvids || {})) {
        for (const [ent, val] of Object.entries(ents)) {
          const forms = typeof val === 'string' ? { base: val } : (val || {});
          for (const [form, file] of Object.entries(forms)) {
            const key = form === 'base' ? `${race}/${ent}` : `${race}/${ent}/${form}`;
            portraitVideos.set(key, `${base}${race}/${ent}/${file}?v=${man.v || 0}`);
          }
        }
      }
      // gold-mine / worker idle clips: remembered as URLs only, played in the
      // portrait box when the mine or a worker is clicked (never on the map)
      for (const [race, kinds] of Object.entries(man.minevids || {})) {
        for (const [which, file] of Object.entries(kinds || {})) {
          mapVideoUrls.set(`${race}/${which}`, `${base}${race}/generator/${file}?v=${man.v || 0}`);
        }
      }
      // per-tier tower clips, shown in the portrait box when a tower is selected
      for (const [race, kinds] of Object.entries(man.towervids || {})) {
        for (const [which, file] of Object.entries(kinds || {})) {
          towerVideoUrls.set(`${race}/${which}`, `${base}${race}/tower/${file}?v=${man.v || 0}`);
        }
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

// Slot indices (0-based) that currently have a loaded middle-strip image. The
// sim picks which one is active (deterministically) from this list.
export function availableMiddleSlots() {
  const out = [];
  middleImgs.forEach((img, i) => { if (img) out.push(i); });
  return out;
}

// The loaded middle-strip image for a slot index, or null.
export function getMiddleImage(i) {
  return (i >= 0 && middleImgs[i]) || null;
}

// URL of the uploaded background-music track for a race, or null.
export function getMusicUrl(race) {
  return musicUrls.get(race) || null;
}

// URL of the uploaded custom mouse-cursor image for a race, or null.
export function getCursorUrl(race) {
  return cursorUrls.get(race) || null;
}

// Uploaded command-card icon: key 'ability-<id>' or 'upgrade-<id>' (global).
export function getUiIcon(key) {
  return uiIcons.get(key) || null;
}

// Uploaded art for a race's UNITS / CLĂDIRI shop-tab button, or null.
export function getTabIcon(race, slot) {
  return tabIcons.get(`${race}/${slot}`) || null;
}

// Uploaded per-race icon for the base tier-upgrade slot, or null.
export function getBaseUpgradeIcon(race) {
  return baseUpgIcons.get(race) || null;
}

// URL of a race's uploaded bottom-bar background design, or null.
export function getBarSkin(race) {
  return barSkins.get(race) || null;
}

// URL of a race's uploaded bottom-bar overlay (drawn over the UI), or null.
export function getBarOverlay(race) {
  return barOverlays.get(race) || null;
}

// URL of a gold-mine clip (which = 'mineidle' | 'workeridle'), for the
// portrait box when the mine or a worker is selected. Null if none uploaded.
export function getMineVideoUrl(race, which) {
  return mapVideoUrls.get(`${race}/${which}`) || null;
}

// URL of a tower's per-tier portrait clip for the given base tier (1..3),
// falling back to the nearest lower tier that was uploaded. Null if none.
export function getTowerVideoUrl(race, tier) {
  const t = tier < 1 ? 1 : tier > 3 ? 3 : tier;
  for (let k = t; k >= 1; k--) {
    const u = towerVideoUrls.get(`${race}/tier${k}`);
    if (u) return u;
  }
  return null;
}

// URL of a unit's uploaded idle portrait clip (mp4/webm), or null.
// `form`: 'base' (whole unit) | 'foot' (rider on foot) | 'beast' (split
// mount); a missing form falls back to the base clip.
export function getPortraitVideoUrl(race, ent, form = 'base') {
  if (form !== 'base') {
    const v = portraitVideos.get(`${race}/${ent}/${form}`);
    if (v) return v;
  }
  return portraitVideos.get(`${race}/${ent}`) || null;
}

export function getSprite(race, ent, anim, frame) {
  const rec = anims.get(`${race}/${ent}/${anim}`);
  if (!rec) return null;
  // tolerate a missing twin frame (e.g. die has a single frame)
  return rec[frame] || rec[frame ^ 1] || null;
}

// Exact frame lookup (no twin fallback) — used for the base's per-tier images
// so tier 3 never accidentally borrows tier 2's art.
export function getFrame(race, ent, anim, frame) {
  const rec = anims.get(`${race}/${ent}/${anim}`);
  return (rec && rec[frame]) || null;
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

// `form`: 'base' (whole unit) | 'foot' (rider on foot) | 'beast' (split
// mount); a missing form falls back to the base thumbnail.
export function getThumb(race, ent, form = 'base') {
  if (form !== 'base') {
    const t = thumbs.get(`${race}/${ent}/${form}`);
    if (t) return t;
  }
  return thumbs.get(`${race}/${ent}`) || null;
}

export function getProjectile(race, ent) {
  return projectiles.get(`${race}/${ent}`) || null;
}

export function getAcidProjectile(race, ent) {
  return acidProjectiles.get(`${race}/${ent}`) || null;
}

export function getFireProjectile(race, ent) {
  return fireProjectiles.get(`${race}/${ent}`) || null;
}

export function getAbilityProjectile(race, ent, aid) {
  return abilityProjectiles.get(`${race}/${ent}/${aid}`) || null;
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
