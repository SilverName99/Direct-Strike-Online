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

// -------- editable field whitelists (nothing else is applied) --------
export const UNIT_NUM_FIELDS = [
  ['cost', 'Cost'],
  ['tier', 'Tier (1-3)'],
  ['hp', 'HP'],
  ['damage', 'Damage / Heal'],
  ['period', 'Attack period (s)'],
  ['range', 'Range'],
  ['speed', 'Speed'],
  ['splash', 'Splash radius'],
  ['projectileSpeed', 'Projectile speed'],
];
export const UNIT_SELECT_FIELDS = {
  armor: ['light', 'armored'],
  dmgType: ['normal', 'piercing', 'explosive'],
};
export const BUILDING_FIELDS = {
  wall: [['cost', 'Cost'], ['hp', 'HP'], ['cap', 'Max buildable']],
  tower: [
    ['cost', 'Cost'], ['hp', 'HP'], ['cap', 'Max buildable'],
    ['range', 'Range'], ['damage', 'Damage'], ['period', 'Attack period (s)'],
  ],
  generator: [
    ['cost', 'Cost'], ['hp', 'HP'], ['cap', 'Max buildable'],
    ['income', 'Income / tick (2s)'],
  ],
};
export const GENERAL_FIELDS = [
  ['START_MONEY', 'Starting money'],
  ['INCOME_BASE', 'Base income / tick (2s)'],
  ['WAVE_INTERVAL', 'Seconds between waves'],
  ['MAX_TEMPLATES', 'Max placed units per side'],
  ['SELL_REFUND', 'Unit sell refund (0-1)'],
  ['SELL_BUILDING_REFUND', 'Building sell refund (0-1)'],
];
export const TURRET_FIELDS = [
  ['hp', 'HP'], ['range', 'Range'], ['damage', 'Damage'], ['period', 'Attack period (s)'],
];
export const TINT_MODES = ['team', 'enemy', 'none'];
export const FOOTPRINT_BUILDINGS = ['wall', 'tower', 'generator'];
export const BUILDING_SIZE_ENTS = ['main', 'turret', 'tower', 'generator', 'wall'];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : undefined);
const cleanName = (v) => String(v).replace(/[<>]/g, '').trim().slice(0, 20);

// ---------------- per-race resolved unit tables ----------------
// Full clone of the base units (so the sim can read every field) plus a
// `size` visual multiplier, one table per race.
const resolvedUnits = {};
function baseUnits() {
  const t = {};
  for (const [id, u] of Object.entries(UNITS)) t[id] = { ...u, size: 1 };
  return t;
}
function rebuildResolved() {
  for (const r of RACES) resolvedUnits[r] = baseUnits();
}
rebuildResolved();

export function statsUnit(race, id) {
  return (resolvedUnits[race] || resolvedUnits[RACES[0]])[id];
}
export function unitSizeOf(race, id) {
  const u = statsUnit(race, id);
  return (u && u.size) || 1;
}
export function buildingSizeOf(kind) {
  return (CONFIG.SIZES && CONFIG.SIZES[kind]) || 1;
}

// ---------------------------- snapshot ----------------------------
function raceUnitsSnapshot(race) {
  const out = {};
  for (const [id, u] of Object.entries(resolvedUnits[race])) {
    out[id] = { name: u.name, size: u.size };
    for (const [f] of UNIT_NUM_FIELDS) if (u[f] !== undefined) out[id][f] = u[f];
    for (const f of Object.keys(UNIT_SELECT_FIELDS)) if (u[f] !== undefined) out[id][f] = u[f];
  }
  return out;
}

function snapshot() {
  const buildings = {};
  for (const [kind, fields] of Object.entries(BUILDING_FIELDS)) {
    buildings[kind] = { radius: CONFIG.BUILDINGS[kind].radius };
    for (const [f] of fields) buildings[kind][f] = CONFIG.BUILDINGS[kind][f];
  }
  const turret = {};
  for (const [f] of TURRET_FIELDS) turret[f] = CONFIG.TURRET[f];
  const general = {};
  for (const [f] of GENERAL_FIELDS) general[f] = CONFIG[f];
  const buildingSizes = {};
  for (const k of BUILDING_SIZE_ENTS) buildingSizes[k] = CONFIG.SIZES[k] ?? 1;
  const races = {};
  for (const r of RACES) races[r] = { units: raceUnitsSnapshot(r) };
  return {
    general,
    tint: CONFIG.TEAM_TINT,
    buildings,
    turret,
    mainHp: [...CONFIG.MAIN.hp],
    tierCosts: { 2: CONFIG.TIER_COSTS[2], 3: CONFIG.TIER_COSTS[3] },
    buildingSizes,
    races,
  };
}

const DEFAULTS = snapshot();

// ----------------------------- apply -----------------------------
export function applyBalance(data) {
  if (!data || typeof data !== 'object') return;
  rebuildResolved(); // reset to base, then layer overrides on top

  // ---- global: buildings ----
  for (const [kind, vals] of Object.entries(data.buildings || {})) {
    const b = CONFIG.BUILDINGS[kind];
    if (!b || !BUILDING_FIELDS[kind] || typeof vals !== 'object') continue;
    for (const [f] of BUILDING_FIELDS[kind]) if (num(vals[f]) !== undefined) b[f] = vals[f];
    if (num(vals.radius) !== undefined) b.radius = clamp(vals.radius, CONFIG.GRID / 2, CONFIG.GRID * 5);
  }
  if (data.turret && typeof data.turret === 'object') {
    for (const [f] of TURRET_FIELDS) if (num(data.turret[f]) !== undefined) CONFIG.TURRET[f] = data.turret[f];
  }
  if (Array.isArray(data.mainHp)) {
    for (let i = 0; i < 3; i++) if (num(data.mainHp[i]) !== undefined) CONFIG.MAIN.hp[i] = data.mainHp[i];
  }
  if (data.tierCosts && typeof data.tierCosts === 'object') {
    for (const t of [2, 3]) if (num(data.tierCosts[t]) !== undefined) CONFIG.TIER_COSTS[t] = data.tierCosts[t];
  }
  for (const [f] of GENERAL_FIELDS) {
    if (data.general && num(data.general[f]) !== undefined) CONFIG[f] = data.general[f];
  }
  if (data.buildingSizes && typeof data.buildingSizes === 'object') {
    for (const k of BUILDING_SIZE_ENTS) {
      if (num(data.buildingSizes[k]) !== undefined) CONFIG.SIZES[k] = clamp(data.buildingSizes[k], 0.2, 4);
    }
  }
  if (TINT_MODES.includes(data.tint)) CONFIG.TEAM_TINT = data.tint;

  // ---- per-race: units ----
  for (const r of RACES) {
    const rd = data.races && data.races[r];
    if (!rd || !rd.units) continue;
    applyRaceUnits(r, rd.units);
  }
  // legacy flat format (pre per-race) -> apply the same units to every race
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
  }
}

export function currentBalance() {
  return snapshot();
}

export function resetRaceUnit(race, id) {
  resolvedUnits[race][id] = { ...UNITS[id], size: 1 };
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
