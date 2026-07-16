// One-time state migration: pull the LIVE site's runtime state (uploaded images
// + published balance) into this checkout, so moving hosts keeps everything.
//
// These files are gitignored (server-side state), so they only exist on the
// host that's currently serving the game. This script downloads:
//   - assets/balance.json     (all menu cosmetics/skins/tutorials/music live
//                              here as data URLs, plus every stat tweak)
//   - assets/units/manifest.json + every sprite/audio/video it references
//     (custom unit art, backgrounds, cursors, bar skins, portrait clips, …)
//
// Run on the NEW host (has outbound internet), from the repo root:
//   node scripts/migrate-from-live.mjs https://OLD-SITE.example.com
// Optional 2nd arg = destination repo dir (default: the repo this script is in).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = (process.argv[2] || '').replace(/\/+$/, '');
if (!SRC) { console.error('usage: node scripts/migrate-from-live.mjs https://old-site …'); process.exit(1); }
const ROOT = process.argv[3] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNITS = 'assets/units/';

let okCount = 0, missCount = 0, failCount = 0, bytes = 0;

async function grab(rel, { required = false } = {}) {
  const url = `${SRC}/${rel}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) { if (required) { console.error(`  MISSING (required): ${rel} [${res.status}]`); failCount++; } else missCount++; return null; }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) { missCount++; return null; } // 404 page served as 200
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) { missCount++; return null; }
    const dest = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    okCount++; bytes += buf.length;
    console.log(`  ✓ ${rel} (${(buf.length / 1024).toFixed(1)} KB)`);
    return buf;
  } catch (e) { console.error(`  ERROR ${rel}: ${e.message}`); failCount++; return null; }
}

console.log(`Migrating from ${SRC}\n  into ${ROOT}\n`);

// 1) balance.json — the important one (all menu images/skins/tutorials/music)
console.log('• balance.json');
await grab('assets/balance.json', { required: true });

// 2) unit sprites: fetch the manifest, then reconstruct every referenced path
console.log('\n• assets/units/ (manifest + sprites)');
const manBuf = await grab(`${UNITS}manifest.json`);
if (manBuf) {
  let man = {};
  try { man = JSON.parse(manBuf.toString()); } catch { console.error('  manifest.json is not valid JSON — skipping sprites'); man = {}; }
  const jobs = [];
  const at = (rel) => jobs.push(rel);

  for (const [race, ents] of Object.entries(man.races || {})) {
    for (const [ent, slots] of Object.entries(ents || {})) {
      const dir = `${UNITS}${race}/${ent}/`;
      for (const f of ['thumb', 'foot-thumb', 'beast-thumb', 'projectile', 'acidproj', 'fireproj']) if (slots[f]) at(`${dir}${f}.png`);
      for (const slot of Object.keys(slots)) {
        if ((slot.startsWith('abilityproj-') || slot.startsWith('abilityfx-')) && slots[slot]) at(`${dir}${slot}.png`);
      }
      for (const [anim, frames] of Object.entries(slots)) {
        if (anim === 'thumb' || !Array.isArray(frames)) continue;
        frames.forEach((present, i) => { if (present) at(`${dir}${anim}_${i}.png`); });
      }
    }
  }
  for (const race of Object.keys(man.backgrounds || {})) at(`${UNITS}${race}/background.png`);
  const mids = Array.isArray(man.middle) ? man.middle : (man.middle ? [man.middle] : []);
  for (const f of mids) at(`${UNITS}${f}`);
  for (const [race, f] of Object.entries(man.music || {})) at(`${UNITS}${race}/${f}`);
  for (const [race, f] of Object.entries(man.cursors || {})) at(`${UNITS}${race}/${f}`);
  for (const [, f] of Object.entries(man.icons || {})) at(`${UNITS}icons/${f}`);
  for (const [race, slots] of Object.entries(man.tabs || {})) for (const f of Object.values(slots || {})) at(`${UNITS}${race}/${f}`);
  for (const [race, f] of Object.entries(man.baseupg || {})) at(`${UNITS}${race}/${f}`);
  for (const [race, f] of Object.entries(man.barskins || {})) at(`${UNITS}${race}/${f}`);
  for (const [race, f] of Object.entries(man.barovers || {})) at(`${UNITS}${race}/${f}`);
  for (const [race, ents] of Object.entries(man.portraitvids || {})) {
    for (const [ent, val] of Object.entries(ents || {})) {
      const forms = typeof val === 'string' ? { base: val } : (val || {});
      for (const f of Object.values(forms)) at(`${UNITS}${race}/${ent}/${f}`);
    }
  }
  for (const [race, kinds] of Object.entries(man.minevids || {})) for (const f of Object.values(kinds || {})) at(`${UNITS}${race}/generator/${f}`);
  for (const [race, kinds] of Object.entries(man.towervids || {})) for (const f of Object.values(kinds || {})) at(`${UNITS}${race}/tower/${f}`);

  console.log(`  (${jobs.length} referenced files)`);
  for (const rel of jobs) await grab(rel); // sequential = gentle on the old shared host
}

console.log(`\nDone. copied ${okCount} files (${(bytes / 1048576).toFixed(2)} MB), ${missCount} absent, ${failCount} errors.`);
if (failCount) process.exit(1);
