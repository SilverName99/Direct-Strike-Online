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

const anims = new Map();  // `${race}/${ent}/${anim}` -> [entry|null, entry|null]
const thumbs = new Map(); // `${race}/${ent}` -> entry
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
      for (const [race, ents] of Object.entries(man.races)) {
        for (const [ent, slots] of Object.entries(ents)) {
          if (slots.thumb) {
            load(`${base}${race}/${ent}/thumb.png?v=${man.v || 0}`, (img) => {
              thumbs.set(`${race}/${ent}`, { img, red: recolor(img) });
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
                rec[i] = { img, red: recolor(img) };
              });
            });
          }
        }
      }
      done();
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

// Draw centered at (0,0), contain-fit into a targetH square; the caller
// mirrors for team 1. Fitting the dominant dimension keeps wide frames
// (e.g. a corpse lying down) at a natural size: the fallen body spans
// about the character's standing height instead of blowing up.
export function drawSprite(ctx, entry, targetH, team) {
  const img = team === 1 ? entry.red : entry.img;
  const s = targetH / Math.max(img.width, img.height);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
}
