// User-uploaded unit sprites (via /admin). The game fetches a manifest and
// preloads the PNGs; every draw site falls back to the vector puppets (or
// the geometric shapes) wherever an image is missing, so partial uploads
// are always safe. Sprites are authored facing RIGHT on transparency; the
// red-team variant is generated here with a hue blend (grays stay gray).

import { UNITS } from '../units.js';

const store = new Map(); // `${type}/${anim}` -> [ {img, red} | null, ... ]

export function loadSprites(base = 'assets/units/', onReady = null) {
  fetch(`${base}manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((man) => {
      if (!man || !man.units) return;
      let pending = 0;
      const done = () => {
        pending--;
        if (pending === 0 && onReady) onReady();
      };
      for (const [unit, anims] of Object.entries(man.units)) {
        for (const [anim, frames] of Object.entries(anims)) {
          frames.forEach((present, i) => {
            if (!present) return;
            pending++;
            const img = new Image();
            img.onload = () => {
              const key = `${unit}/${anim}`;
              let rec = store.get(key);
              if (!rec) {
                rec = [null, null];
                store.set(key, rec);
              }
              rec[i] = { img, red: recolor(img) };
              done();
            };
            img.onerror = done;
            img.src = `${base}${unit}/${anim}_${i}.png?v=${man.v || 0}`;
          });
        }
      }
    })
    .catch(() => { /* no manifest (static/file hosting) — fallbacks apply */ });
}

// Replace hues with the red team hue while keeping lightness/saturation.
function recolor(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'hue';
  x.fillStyle = '#e04250';
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0);
  return c;
}

export function getSprite(type, anim, frame) {
  const rec = store.get(`${type}/${anim}`);
  if (!rec) return null;
  return rec[frame] || rec[frame ^ 1] || null; // tolerate a missing twin frame
}

export function getAnySprite(type) {
  for (const anim of ['idle', 'walk', 'attack', 'die']) {
    const s = getSprite(type, anim, 0);
    if (s) return s;
  }
  return null;
}

export function hasSpriteAnim(type, anim) {
  return getSprite(type, anim, 0) != null;
}

// Draw centered at (0,0), already mirrored by the caller for team 1.
export function drawSprite(ctx, entry, type, team, scale = 1) {
  const img = team === 1 ? entry.red : entry.img;
  const targetH = (UNITS[type].radius * 2.8 + 4) * scale;
  const w = img.width * (targetH / img.height);
  ctx.drawImage(img, -w / 2, -targetH / 2, w, targetH);
}
