// Balance data + apply/save helpers.
//
// UNIT stats are PER-RACE: each race has its own resolved unit table (stats,
// name, visual size), so tuning the Humans grunt does not touch the Orcs
// grunt. Buildings, the starting turret, main-base HP, tier costs, the
// general rules and the team-tint mode are GLOBAL (shared by both races).
//
// The admin editors mutate these in place and call saveBalance(), which
// publishes to assets/balance.json; the game applies it at boot via
// loadBalance(). The sim reads per-team stats through Game.ustat().

import { CONFIG, RACES } from '../config.js';
import { UNITS } from '../units.js';
import { ABILITIES, ABILITY_IDS, MAX_ABILITIES } from '../abilities.js';
import { UPGRADES, UPGRADE_IDS } from '../upgrades.js';

// -------- editable field whitelists (nothing else is applied) --------
export const UNIT_NUM_FIELDS = [
  ['cost', 'Cost'],
  ['tier', 'Tier (1-3)'],
  ['hp', 'HP'],
  ['damage', 'Damage'],
  ['period', 'Attack period (s)'],
  ['range', 'Range'],
  ['speed', 'Speed'],
  // splash is a toggle (Splash checkbox), projectile speed lives in "Ranged"
];
export const UNIT_SELECT_FIELDS = {
  armor: ['light', 'armored'],
  dmgType: ['normal', 'piercing', 'explosive'],
};
export const BUILDING_FIELDS = {
  wall: [['cost', 'Cost'], ['hp', 'HP'], ['cap', 'Max buildable']],
  tower: [
    ['cost', 'Cost'], ['cap', 'Max buildable'],
    ['range', 'Range'], ['period', 'Attack period (s)'],
    ['hp', 'HP Tier 1'], ['hp2', 'HP Tier 2'], ['hp3', 'HP Tier 3'],
    ['damage', 'Damage Tier 1'], ['damage2', 'Damage Tier 2'], ['damage3', 'Damage Tier 3'],
    ['campfireDelay', 'Secunde inactiv → foc de tabără'],
  ],
  generator: [
    ['cost', 'Cost'], ['hp', 'HP'], ['cap', 'Max buildable'],
    ['income', 'Extra gold every 20 seconds'],
    ['buildCd', 'Cooldown construire (s)'],
  ],
};
export const GENERAL_FIELDS = [
  ['START_MONEY', 'Starting money'],
  ['INCOME_BASE', 'Starting gold every 20 seconds'],
  ['MID_INCOME', 'Extra gold every 20s past middle'],
  ['WAVE_INTERVAL', 'Seconds between waves'],
  ['MAX_TEMPLATES', 'Max placed units per side'],
  ['SELL_REFUND', 'Unit sell refund (0-1)'],
  ['SELL_BUILDING_REFUND', 'Building sell refund (0-1)'],
];
export const TURRET_FIELDS = [
  ['hp', 'HP'], ['range', 'Range'], ['damage', 'Damage'], ['period', 'Attack period (s)'],
  ['regen', 'Regen viață (HP/s)'], ['bounty', 'Gold pentru inamic la distrugere'],
];
export const TINT_MODES = ['team', 'enemy', 'none'];
export const MIDDLE_KINDS = ['none', 'moveslow', 'atkslow', 'manaregen'];

// Resolved middle-terrain effect for a strip variant (slot index 0-2), or null.
export function middleConfig(i) {
  return (CONFIG.MIDDLES && CONFIG.MIDDLES[i]) || null;
}
export const FOOTPRINT_BUILDINGS = ['wall', 'tower', 'generator'];
export const BUILDING_SIZE_ENTS = ['main', 'turret', 'tower', 'generator', 'wall'];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : undefined);
const cleanName = (v) => String(v).replace(/[<>]/g, '').trim().slice(0, 20);

export const BUILDING_ENTS = ['main', 'turret', 'tower', 'generator', 'wall'];

// ------------ per-race resolved unit + building tables ------------
// Full clone of the base entities (so the sim can read every field) plus a
// `size` visual multiplier and `name`, one table per race. Units AND
// buildings are per-race: tuning the Humans tower does not touch the Orcs
// tower.
const resolvedUnits = {};
const resolvedBuildings = {};

// Shop display order for units (global — both races share the roster). The
// admin reorders these PER RACE and the game's shop iterates the player race's
// order (Humans and Orcs reorder independently).
const DEFAULT_UNIT_ORDER = Object.keys(UNITS);
const unitOrder = {}; // race -> [id,...]
for (const r of RACES) unitOrder[r] = [...DEFAULT_UNIT_ORDER];

// Sanitize an order: keep only known ids (no dups), then append any missing
// ones so a newly added unit always still shows up.
function sanitizeOrder(arr) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(arr)) {
    for (const id of arr) if (UNITS[id] && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  for (const id of DEFAULT_UNIT_ORDER) if (!seen.has(id)) out.push(id);
  return out;
}
export function resolvedUnitOrder(race) {
  return [...(unitOrder[race] || unitOrder[RACES[0]])];
}
export function setUnitOrder(race, arr) {
  if (RACES.includes(race)) unitOrder[race] = sanitizeOrder(arr);
}

// Per-race background-music volume (0-100). The track itself is a file upload
// (assets/units/<race>/music.*, via the sprite admin); only the volume lives
// in the balance.
const DEFAULT_MUSIC_VOL = 60;
const musicVol = {};
for (const r of RACES) musicVol[r] = DEFAULT_MUSIC_VOL;
export function musicVolumeOf(race) {
  const v = musicVol[race];
  return typeof v === 'number' && isFinite(v) ? v : DEFAULT_MUSIC_VOL;
}
export function setMusicVolume(race, v) {
  if (RACES.includes(race) && isFinite(Number(v))) musicVol[race] = clamp(Number(v), 0, 100);
}

function baseUnits() {
  const t = {};
  // size = visual scale, projSize = projectile scale (both 1 = 100%);
  // caster + abilities come only from the admin config (empty by default);
  // mana/manaRegen only matter while caster is on
  for (const [id, u] of Object.entries(UNITS)) {
    const ps = u.projectileSpeed || CONFIG.PROJECTILE_SPEED;
    t[id] = {
      ...u, size: 1, projSize: 1,
      cw: 1, ch: 1,        // footprint in grid cells (drives the unit's physical size)
      animSpeed: 5,        // idle/walk frame flips per second (attack anim follows the Attack period)
      // Blank default: every special behavior is OFF; build any unit up from a
      // clean slate. Numeric stats (hp/damage/range/…) still come from units.js.
      ranged: false, projectile: false,
      heal: false,         // healer behavior is opt-in (admin toggle), like every other special
      buildingDamage: 0,   // special damage vs structures (0 = use the normal damage); always applies
      isAir: false, targetsAir: false,
      targetsGround: true, // can attack ground units (default on; turn off for air-only)
      splash: 0,
      projSpeed: ps, projectileSpeed: ps,
      bounce: false, bouncePower: 50, bounceRadius: 80, bounceMax: 3,
      dash: false, dashDamage: 30, dashSpeed: 400, dashRange: 250, dashCd: 3,
      caster: false, autoAttackBetween: false, abilities: [], mana: 100, manaRegen: 2,
    };
  }
  return t;
}
function baseBuildings() {
  return {
    main: {
      hp: [...CONFIG.MAIN.hp], radius: CONFIG.MAIN.radius, idleSpeed: CONFIG.MAIN.idleSpeed, name: CONFIG.MAIN.name,
      damage: CONFIG.MAIN.damage, range: CONFIG.MAIN.range, period: CONFIG.MAIN.period,
      dmgType: CONFIG.MAIN.dmgType, projectileSpeed: CONFIG.MAIN.projectileSpeed, targetsAir: CONFIG.MAIN.targetsAir,
      size: 1, projSize: 1,
    },
    turret: { ...CONFIG.TURRET, size: 1, projSize: 1 },
    wall: { ...CONFIG.BUILDINGS.wall, size: 1, projSize: 1 },
    tower: { ...CONFIG.BUILDINGS.tower, size: 1, projSize: 1 },
    generator: { ...CONFIG.BUILDINGS.generator, size: 1, projSize: 1 },
  };
}
// Abilities are GLOBAL (one balance shared by both races); which units carry
// them is stored per-race on the unit (caster + abilities list).
const resolvedAbilities = {};
function baseAbilities() {
  const t = {};
  for (const [id, ab] of Object.entries(ABILITIES)) t[id] = { ...ab, params: { ...ab.params } };
  return t;
}

// Upgrades are GLOBAL too (bought in-game from the base); which unit each one
// transforms is stored on the upgrade (`unit`), balanced from the admin editor.
const resolvedUpgrades = {};
function baseUpgrades() {
  const t = {};
  for (const [id, up] of Object.entries(UPGRADES)) t[id] = { ...up, params: { ...up.params } };
  return t;
}

function rebuildResolved() {
  for (const r of RACES) { resolvedUnits[r] = baseUnits(); resolvedBuildings[r] = baseBuildings(); }
  Object.assign(resolvedAbilities, baseAbilities());
  Object.assign(resolvedUpgrades, baseUpgrades());
}
rebuildResolved();

export function resolvedAbility(id) {
  return resolvedAbilities[id] || null;
}
export function resolvedUpgrade(id) {
  return resolvedUpgrades[id] || null;
}

export function statsUnit(race, id) {
  return (resolvedUnits[race] || resolvedUnits[RACES[0]])[id];
}
export function unitSizeOf(race, id) {
  const u = statsUnit(race, id);
  return (u && u.size) || 1;
}
export function statsBuilding(race, kind) {
  return (resolvedBuildings[race] || resolvedBuildings[RACES[0]])[kind];
}
export function buildingSizeOf(race, kind) {
  const b = statsBuilding(race, kind);
  return (b && b.size) || 1;
}
export function buildingNameOf(race, kind) {
  const b = statsBuilding(race, kind);
  return (b && b.name) || kind;
}

// ---------------------------- snapshot ----------------------------
// Scalar building stat fields that may exist on a resolved building.
const BUILDING_SCALARS = ['cost', 'hp', 'cap', 'range', 'damage', 'period', 'income', 'projectileSpeed', 'regen', 'bounty', 'buildCd', 'workerSize', 'workerSpeed', 'workerCount', 'workerPause', 'hp2', 'hp3', 'damage2', 'damage3', 'campfireDelay', 'campSize', 'campSize2', 'campSize3', 'campSpeed'];

// Effective tower HP / damage for a base tier (1..3). Towers scale with the
// owner's Main Base tier: tier 1 = hp/damage, tier 2 = hp2/damage2, tier 3 =
// hp3/damage3 (each falling back to the lower tier if unset).
export function towerStatForTier(b, tier) {
  const t = tier < 1 ? 1 : tier > 3 ? 3 : tier;
  const hp = t >= 3 ? (b.hp3 ?? b.hp2 ?? b.hp) : t === 2 ? (b.hp2 ?? b.hp) : b.hp;
  const damage = t >= 3 ? (b.damage3 ?? b.damage2 ?? b.damage) : t === 2 ? (b.damage2 ?? b.damage) : b.damage;
  return { hp, damage };
}

function raceUnitsSnapshot(race) {
  const out = {};
  for (const [id, u] of Object.entries(resolvedUnits[race])) {
    out[id] = {
      name: u.name, size: u.size, projSize: u.projSize, cw: u.cw, ch: u.ch, animSpeed: u.animSpeed,
      ranged: !!u.ranged, projSpeed: u.projSpeed, splash: u.splash,
      heal: !!u.heal, buildingDamage: u.buildingDamage,
      isAir: !!u.isAir, targetsAir: !!u.targetsAir, targetsGround: u.targetsGround !== false,
      bounce: !!u.bounce, bouncePower: u.bouncePower, bounceRadius: u.bounceRadius, bounceMax: u.bounceMax,
      dash: !!u.dash, dashDamage: u.dashDamage, dashSpeed: u.dashSpeed, dashRange: u.dashRange, dashCd: u.dashCd,
      caster: !!u.caster, autoAttackBetween: !!u.autoAttackBetween, abilities: [...(u.abilities || [])],
      mana: u.mana, manaRegen: u.manaRegen,
    };
    for (const [f] of UNIT_NUM_FIELDS) if (u[f] !== undefined) out[id][f] = u[f];
    for (const f of Object.keys(UNIT_SELECT_FIELDS)) if (u[f] !== undefined) out[id][f] = u[f];
  }
  return out;
}

function raceBuildingsSnapshot(race) {
  const out = {};
  for (const kind of BUILDING_ENTS) {
    const b = resolvedBuildings[race][kind];
    const o = { name: b.name, size: b.size, idleSpeed: b.idleSpeed, projSize: b.projSize };
    if (kind === 'main') {
      o.hp = [...b.hp];
      for (const f of ['damage', 'range', 'period', 'projectileSpeed']) if (b[f] !== undefined) o[f] = b[f];
      o.dmgType = b.dmgType; o.targetsAir = !!b.targetsAir;
    } else for (const f of BUILDING_SCALARS) if (b[f] !== undefined) o[f] = b[f];
    if (b.cw !== undefined) { o.cw = b.cw; o.ch = b.ch; }
    out[kind] = o;
  }
  return out;
}

function snapshot() {
  const general = {};
  for (const [f] of GENERAL_FIELDS) general[f] = CONFIG[f];
  const races = {};
  for (const r of RACES) races[r] = { units: raceUnitsSnapshot(r), buildings: raceBuildingsSnapshot(r) };
  const abilities = {};
  for (const [id, ab] of Object.entries(resolvedAbilities)) abilities[id] = { ...ab.params };
  const upgrades = {};
  for (const [id, up] of Object.entries(resolvedUpgrades)) upgrades[id] = { race: up.race || '', unit: up.unit || '', params: { ...up.params } };
  return {
    general,
    middles: CONFIG.MIDDLES.map((m) => ({ ...m })),
    middleEmpty: CONFIG.MIDDLE_EMPTY,
    tint: CONFIG.TEAM_TINT,
    healthbarAlways: CONFIG.HEALTHBAR_ALWAYS,
    tierCosts: { 2: CONFIG.TIER_COSTS[2], 3: CONFIG.TIER_COSTS[3] },
    unitOrder: Object.fromEntries(RACES.map((r) => [r, [...unitOrder[r]]])),
    music: Object.fromEntries(RACES.map((r) => [r, musicVol[r]])),
    abilities,
    upgrades,
    races,
  };
}

const DEFAULTS = snapshot();

// ----------------------------- apply -----------------------------
export function applyBalance(data) {
  if (!data || typeof data !== 'object') return;
  rebuildResolved(); // reset to base, then layer overrides on top
  for (const r of RACES) unitOrder[r] = [...DEFAULT_UNIT_ORDER];
  if (data.unitOrder) {
    if (Array.isArray(data.unitOrder)) for (const r of RACES) setUnitOrder(r, data.unitOrder); // legacy (global)
    else for (const r of RACES) if (data.unitOrder[r]) setUnitOrder(r, data.unitOrder[r]);
  }
  for (const r of RACES) musicVol[r] = DEFAULT_MUSIC_VOL;
  if (data.music && typeof data.music === 'object') {
    for (const r of RACES) if (num(data.music[r]) !== undefined) setMusicVolume(r, data.music[r]);
  }

  // ---- global rules (truly shared: economy, waves, tint, tier costs) ----
  for (const [f] of GENERAL_FIELDS) {
    if (data.general && num(data.general[f]) !== undefined) CONFIG[f] = data.general[f];
  }
  if (data.tierCosts && typeof data.tierCosts === 'object') {
    for (const t of [2, 3]) if (num(data.tierCosts[t]) !== undefined) CONFIG.TIER_COSTS[t] = data.tierCosts[t];
  }
  if (TINT_MODES.includes(data.tint)) CONFIG.TEAM_TINT = data.tint;
  if (typeof data.healthbarAlways === 'boolean') CONFIG.HEALTHBAR_ALWAYS = data.healthbarAlways;

  // ---- middle-of-map terrain effects (per strip variant) ----
  CONFIG.MIDDLE_EMPTY = num(data.middleEmpty) !== undefined ? clamp(data.middleEmpty, 0, 20) : DEFAULTS.middleEmpty;
  CONFIG.MIDDLES = DEFAULTS.middles.map((m) => ({ ...m })); // reset to code defaults
  if (Array.isArray(data.middles)) {
    data.middles.forEach((m, i) => {
      const dst = CONFIG.MIDDLES[i];
      if (!dst || !m || typeof m !== 'object') return;
      if (MIDDLE_KINDS.includes(m.kind)) dst.kind = m.kind;
      if (num(m.amount) !== undefined) dst.amount = clamp(m.amount, 0, 100);
      if (num(m.band) !== undefined) dst.band = clamp(m.band, 0, 4000);
      if (typeof m.air === 'boolean') dst.air = m.air;
    });
  }

  // ---- global: ability params (only known abilities / numeric params) ----
  if (data.abilities && typeof data.abilities === 'object') {
    for (const [id, vals] of Object.entries(data.abilities)) {
      const ab = resolvedAbilities[id];
      if (!ab || typeof vals !== 'object') continue;
      for (const k of Object.keys(ab.params)) {
        if (num(vals[k]) !== undefined) ab.params[k] = clamp(vals[k], 0, 100000);
      }
    }
  }

  // ---- global: upgrade params + target unit ----
  if (data.upgrades && typeof data.upgrades === 'object') {
    for (const [id, vals] of Object.entries(data.upgrades)) {
      const up = resolvedUpgrades[id];
      if (!up || typeof vals !== 'object') continue;
      if (typeof vals.race === 'string' && (vals.race === '' || RACES.includes(vals.race))) up.race = vals.race;
      if (typeof vals.unit === 'string' && (vals.unit === '' || UNITS[vals.unit])) up.unit = vals.unit;
      const params = vals.params || {};
      for (const k of Object.keys(up.params)) {
        if (num(params[k]) !== undefined) up.params[k] = clamp(params[k], 0, 100000);
      }
    }
  }

  // ---- legacy global building layer (pre per-race format) -> every race ----
  applyLegacyGlobalBuildings(data);

  // ---- per-race: units + buildings (authoritative, overrides legacy) ----
  for (const r of RACES) {
    const rd = data.races && data.races[r];
    if (!rd) continue;
    if (rd.units) applyRaceUnits(r, rd.units);
    if (rd.buildings) applyRaceBuildings(r, rd.buildings);
  }
  // legacy flat units (pre per-race) -> apply the same units to every race
  if (data.units && !data.races) for (const r of RACES) applyRaceUnits(r, data.units);
}

function applyRaceUnits(race, unitsData) {
  for (const [id, vals] of Object.entries(unitsData)) {
    const u = resolvedUnits[race][id];
    if (!u || typeof vals !== 'object') continue;
    for (const [f] of UNIT_NUM_FIELDS) if (u[f] !== undefined && num(vals[f]) !== undefined) u[f] = vals[f];
    for (const [f, opts] of Object.entries(UNIT_SELECT_FIELDS)) if (u[f] !== undefined && opts.includes(vals[f])) u[f] = vals[f];
    if (typeof vals.name === 'string' && cleanName(vals.name)) u.name = cleanName(vals.name);
    if (num(vals.size) !== undefined) u.size = clamp(vals.size, 0.2, 4);
    if (num(vals.projSize) !== undefined) u.projSize = clamp(vals.projSize, 0.1, 6);
    if (num(vals.cw) !== undefined) u.cw = Math.round(clamp(vals.cw, 1, 20));
    if (num(vals.ch) !== undefined) u.ch = Math.round(clamp(vals.ch, 1, 20));
    if (num(vals.animSpeed) !== undefined) u.animSpeed = clamp(vals.animSpeed, 0.2, 30);
    if (num(vals.splash) !== undefined) u.splash = clamp(vals.splash, 0, 2000);
    if (typeof vals.heal === 'boolean') u.heal = vals.heal;
    if (num(vals.buildingDamage) !== undefined) u.buildingDamage = clamp(vals.buildingDamage, 0, 100000);
    if (typeof vals.caster === 'boolean') u.caster = vals.caster;
    if (typeof vals.autoAttackBetween === 'boolean') u.autoAttackBetween = vals.autoAttackBetween;
    if (typeof vals.isAir === 'boolean') u.isAir = vals.isAir;
    if (typeof vals.targetsAir === 'boolean') u.targetsAir = vals.targetsAir;
    if (typeof vals.targetsGround === 'boolean') u.targetsGround = vals.targetsGround;
    if (typeof vals.ranged === 'boolean') u.ranged = vals.ranged;
    else if (vals.rangedCaster && vals.caster) u.ranged = true; // legacy (pre-general Ranged)
    if (num(vals.projSpeed) !== undefined) u.projSpeed = clamp(vals.projSpeed, 20, 4000);
    if (typeof vals.bounce === 'boolean') u.bounce = vals.bounce;
    if (num(vals.bouncePower) !== undefined) u.bouncePower = clamp(vals.bouncePower, 0, 100);
    if (num(vals.bounceRadius) !== undefined) u.bounceRadius = clamp(vals.bounceRadius, 10, 600);
    if (num(vals.bounceMax) !== undefined) u.bounceMax = Math.round(clamp(vals.bounceMax, 1, 50));
    if (typeof vals.dash === 'boolean') u.dash = vals.dash;
    if (num(vals.dashDamage) !== undefined) u.dashDamage = clamp(vals.dashDamage, 0, 100000);
    if (num(vals.dashSpeed) !== undefined) u.dashSpeed = clamp(vals.dashSpeed, 20, 4000);
    if (num(vals.dashRange) !== undefined) u.dashRange = clamp(vals.dashRange, 20, 2000);
    if (num(vals.dashCd) !== undefined) u.dashCd = clamp(vals.dashCd, 0, 120);
    if (Array.isArray(vals.abilities)) {
      u.abilities = vals.abilities.filter((a) => ABILITY_IDS.includes(a)).slice(0, MAX_ABILITIES);
    }
    if (num(vals.mana) !== undefined) u.mana = clamp(vals.mana, 0, 100000);
    if (num(vals.manaRegen) !== undefined) u.manaRegen = clamp(vals.manaRegen, 0, 1000);
    // "Ranged" drives whether the basic attack fires a projectile + its speed
    u.projectile = !!u.ranged;
    u.projectileSpeed = u.projSpeed;
  }
}

// Apply one race's building overrides onto its resolved building table.
function applyRaceBuildings(race, buildingsData) {
  for (const [kind, vals] of Object.entries(buildingsData)) {
    const b = resolvedBuildings[race][kind];
    if (b) applyBuilding(b, kind, vals);
  }
}

function applyBuilding(b, kind, vals) {
  if (!b || typeof vals !== 'object') return;
  if (typeof vals.name === 'string' && cleanName(vals.name)) b.name = cleanName(vals.name);
  if (num(vals.size) !== undefined) b.size = clamp(vals.size, 0.2, 4);
  if (num(vals.idleSpeed) !== undefined) b.idleSpeed = clamp(vals.idleSpeed, 0.2, 10);
  if (num(vals.projSize) !== undefined) b.projSize = clamp(vals.projSize, 0.1, 6);
  if (kind === 'main') {
    if (Array.isArray(vals.hp)) for (let i = 0; i < 3; i++) if (num(vals.hp[i]) !== undefined) b.hp[i] = vals.hp[i];
    for (const f of ['damage', 'range', 'period', 'projectileSpeed']) if (num(vals[f]) !== undefined) b[f] = clamp(vals[f], 0, 100000);
    if (['normal', 'piercing', 'explosive'].includes(vals.dmgType)) b.dmgType = vals.dmgType;
    if (typeof vals.targetsAir === 'boolean') b.targetsAir = vals.targetsAir;
    return;
  }
  for (const f of BUILDING_SCALARS) if (b[f] !== undefined && num(vals[f]) !== undefined) b[f] = vals[f];
  if (b.cw !== undefined) {
    if (num(vals.cw) !== undefined) b.cw = clamp(Math.round(vals.cw), 1, 20);
    if (num(vals.ch) !== undefined) b.ch = clamp(Math.round(vals.ch), 1, 20);
    // legacy single-radius footprint -> square cell count
    if (vals.cw === undefined && num(vals.radius) !== undefined) {
      const cells = clamp(Math.round(vals.radius * 2 / CONFIG.GRID), 1, 20);
      b.cw = cells; b.ch = cells;
    }
  }
}

// Old global format (data.buildings/turret/mainHp/mainIdleSpeed/buildingSizes/
// buildingNames) applied identically to every race, as a base layer.
function applyLegacyGlobalBuildings(data) {
  for (const r of RACES) {
    if (data.buildings) for (const [kind, vals] of Object.entries(data.buildings)) applyBuilding(resolvedBuildings[r][kind], kind, vals);
    if (data.turret) applyBuilding(resolvedBuildings[r].turret, 'turret', data.turret);
    if (Array.isArray(data.mainHp)) applyBuilding(resolvedBuildings[r].main, 'main', { hp: data.mainHp });
    if (num(data.mainIdleSpeed) !== undefined) resolvedBuildings[r].main.idleSpeed = clamp(data.mainIdleSpeed, 0.2, 10);
    if (data.buildingSizes) for (const k of BUILDING_ENTS) if (num(data.buildingSizes[k]) !== undefined) resolvedBuildings[r][k].size = clamp(data.buildingSizes[k], 0.2, 4);
    if (data.buildingNames) for (const k of BUILDING_ENTS) if (typeof data.buildingNames[k] === 'string' && cleanName(data.buildingNames[k])) resolvedBuildings[r][k].name = cleanName(data.buildingNames[k]);
  }
}

export function currentBalance() {
  return snapshot();
}

export function resetRaceUnit(race, id) {
  const u = UNITS[id];
  const ps = u.projectileSpeed || CONFIG.PROJECTILE_SPEED;
  resolvedUnits[race][id] = {
    ...u, size: 1, projSize: 1, cw: 1, ch: 1, animSpeed: 5,
    ranged: false, projectile: false, heal: false, buildingDamage: 0, isAir: false, targetsAir: false, targetsGround: true, splash: 0,
    projSpeed: ps, projectileSpeed: ps,
    bounce: false, bouncePower: 50, bounceRadius: 80, bounceMax: 3,
    dash: false, dashDamage: 30, dashSpeed: 400, dashRange: 250, dashCd: 3,
    caster: false, autoAttackBetween: false, abilities: [], mana: 100, manaRegen: 2,
  };
}

export function resetAbility(id) {
  if (ABILITIES[id]) resolvedAbilities[id] = { ...ABILITIES[id], params: { ...ABILITIES[id].params } };
}

export function resetUpgrade(id) {
  if (UPGRADES[id]) resolvedUpgrades[id] = { ...UPGRADES[id], params: { ...UPGRADES[id].params } };
}

export function resetRaceBuilding(race, kind) {
  resolvedBuildings[race][kind] = baseBuildings()[kind];
}

export function resetAll() {
  applyBalance(DEFAULTS);
}

export function defaults() {
  return DEFAULTS;
}

// ---------------------------------------------------------- load/save
export async function loadBalance(base = 'assets/') {
  try {
    const r = await fetch(`${base}balance.json`, { cache: 'no-cache' });
    if (!r.ok) return false;
    applyBalance(await r.json());
    return true;
  } catch {
    return false;
  }
}

// Requires an active admin session. `endpoint` is relative to the caller's
// page (the admin editors pass 'save-balance.php').
export async function saveBalance(endpoint = 'admin/save-balance.php') {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DS-Balance': '1' },
    body: JSON.stringify(currentBalance()),
  });
  if (r.status === 401) return 'auth';
  return r.ok ? 'ok' : 'error';
}
