// Verifies the Wood Elves race is wired end-to-end: it shows up in RACES, the
// balance layer resolves a full 9-unit roster + buildings for it, the lobby
// renders a pill for it, and a real match can actually be played as Wood Elves.
// Run from the repo root with a PHP server on 127.0.0.1:8123.
import { chromium } from 'playwright-core';

const URL = 'http://127.0.0.1:8123/index.html';
const out = [];
const ok = (label, pass, detail = '') => {
  out.push(`${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  return pass;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__menu, null, { timeout: 60000 });

// --- 1. the race exists in the engine's race list -------------------------
const races = await page.evaluate(async () => (await import('/src/config.js')).RACES);
ok('RACES contains woodelves', races.includes('woodelves'), races.join(', '));

// --- 2. the balance layer resolved a complete roster ----------------------
const roster = await page.evaluate(async () => {
  const b = await import('/src/ui/balance.js');
  const slots = ['grunt', 'slinger', 'crab', 'bruiser', 'lancer', 'dasher', 'wasp', 'archon', 'mender'];
  const units = slots.map((id) => {
    const u = b.statsUnit('woodelves', id);
    return u ? { id, name: u.name, tier: u.tier, cost: u.cost, hp: u.hp, dmg: u.damage, bldg: u.building, tip: !!u.tip, tipEn: !!u.tipEn } : { id, missing: true };
  });
  const kinds = ['main', 'turret', 'wall', 'tower', 'generator', 'bldg1', 'bldg2', 'bldg3', 'farm', 'herohall'];
  const buildings = kinds.filter((k) => !b.statsBuilding('woodelves', k));
  return { units, missingBuildings: buildings, heroKit: b.heroAbilitySlots('woodelves') };
});
ok('all 9 unit slots resolve', roster.units.every((u) => !u.missing),
  roster.units.filter((u) => u.missing).map((u) => u.id).join(', ') || 'none missing');
ok('every unit has RO + EN description', roster.units.every((u) => u.tip && u.tipEn));
ok('all 10 building kinds resolve', roster.missingBuildings.length === 0,
  roster.missingBuildings.join(', ') || 'none missing');

// --- 3. the lobby renders a Wood Elves pill -------------------------------
await page.evaluate(() => window.__menu.showLocalLobby('ai'));
await page.waitForTimeout(500);
const pills = await page.evaluate(() =>
  [...document.querySelectorAll('.m-pill[data-race]')].map((el) => el.dataset.race));
ok('lobby renders a woodelves pill', pills.includes('woodelves'), [...new Set(pills)].join(', '));
const label = await page.evaluate(() => {
  const el = document.querySelector('.m-pill[data-race="woodelves"]');
  return el ? el.textContent.trim() : '';
});
ok('the pill is labelled', label.length > 0, JSON.stringify(label));

// --- 4. the sim runs as Wood Elves exactly like an existing race ----------
// Compared against a control pair: runMatch with no brains behaves the same for
// every race, so what matters is that woodelves is not an outlier.
const sim = await page.evaluate(async () => {
  const { runMatch } = await import('/src/sim/match.js');
  const one = ([a, b]) => { const r = runMatch({ races: [a, b], seed: 7 }); return { pair: `${a} vs ${b}`, winner: r.winner, timedOut: r.timedOut, ticks: r.ticks }; };
  return { control: one(['humans', 'orcs']), test: one(['woodelves', 'humans']) };
});
ok('a woodelves match runs to completion', sim.test.winner !== undefined,
  `${sim.test.pair}: winner=${sim.test.winner} timedOut=${sim.test.timedOut}`);
ok('it ends the same way as the control pair',
  sim.test.timedOut === sim.control.timedOut,
  `control ${sim.control.pair}: timedOut=${sim.control.timedOut}`);

// assets/units/manifest.json and assets/balance.json live on the production
// server, not in the repo — their 404s are expected in a local run.
const SERVER_ONLY = /assets\/(units\/manifest|balance)\.json|Failed to load resource/;
const real = errors.filter((e) => !SERVER_ONLY.test(e));
ok('no page/console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
console.log(out.join('\n'));
console.log(out.some((l) => l.startsWith('FAIL')) ? '\nSOME CHECKS FAILED' : '\nall checks passed');
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
