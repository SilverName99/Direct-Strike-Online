// Balance data + apply/save helpers. The admin balance editor
// (admin/balance.php + admin-balance.js) mutates UNITS/CONFIG in place and
// calls saveBalance(), which publishes the current values to
// assets/balance.json through the admin-authenticated endpoint. The game
// calls loadBalance() at boot to apply that file.

import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';

// Editable fields (whitelists — nothing else is applied from the server).
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

// ------------------------------------------------------------ defaults
const DEFAULTS = snapshot();

function snapshot() {
  const units = {};
  for (const [id, u] of Object.entries(UNITS)) {
    units[id] = {};
    for (const [f] of UNIT_NUM_FIELDS) if (u[f] !== undefined) units[id][f] = u[f];
    for (const f of Object.keys(UNIT_SELECT_FIELDS)) if (u[f] !== undefined) units[id][f] = u[f];
  }
  const buildings = {};
  for (const [kind, fields] of Object.entries(BUILDING_FIELDS)) {
    buildings[kind] = {};
    for (const [f] of fields) buildings[kind][f] = CONFIG.BUILDINGS[kind][f];
  }
  const turret = {};
  for (const [f] of TURRET_FIELDS) turret[f] = CONFIG.TURRET[f];
  const general = {};
  for (const [f] of GENERAL_FIELDS) general[f] = CONFIG[f];
  return {
    units,
    buildings,
    turret,
    mainHp: [...CONFIG.MAIN.hp],
    tierCosts: { 2: CONFIG.TIER_COSTS[2], 3: CONFIG.TIER_COSTS[3] },
    general,
  };
}

// -------------------------------------------------------------- apply
export function applyBalance(data) {
  if (!data || typeof data !== 'object') return;
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : undefined);

  for (const [id, vals] of Object.entries(data.units || {})) {
    const u = UNITS[id];
    if (!u || typeof vals !== 'object') continue;
    for (const [f] of UNIT_NUM_FIELDS) {
      if (u[f] !== undefined && num(vals[f]) !== undefined) u[f] = vals[f];
    }
    for (const [f, opts] of Object.entries(UNIT_SELECT_FIELDS)) {
      if (u[f] !== undefined && opts.includes(vals[f])) u[f] = vals[f];
    }
  }
  for (const [kind, vals] of Object.entries(data.buildings || {})) {
    const b = CONFIG.BUILDINGS[kind];
    if (!b || !BUILDING_FIELDS[kind] || typeof vals !== 'object') continue;
    for (const [f] of BUILDING_FIELDS[kind]) {
      if (num(vals[f]) !== undefined) b[f] = vals[f];
    }
  }
  if (data.turret && typeof data.turret === 'object') {
    for (const [f] of TURRET_FIELDS) {
      if (num(data.turret[f]) !== undefined) CONFIG.TURRET[f] = data.turret[f];
    }
  }
  if (Array.isArray(data.mainHp)) {
    for (let i = 0; i < 3; i++) {
      if (num(data.mainHp[i]) !== undefined) CONFIG.MAIN.hp[i] = data.mainHp[i];
    }
  }
  if (data.tierCosts && typeof data.tierCosts === 'object') {
    for (const t of [2, 3]) {
      if (num(data.tierCosts[t]) !== undefined) CONFIG.TIER_COSTS[t] = data.tierCosts[t];
    }
  }
  for (const [f] of GENERAL_FIELDS) {
    if (data.general && num(data.general[f]) !== undefined) CONFIG[f] = data.general[f];
  }
}

// Current effective values (what "Save" publishes).
export function currentBalance() {
  return snapshot();
}

export function resetUnit(id) {
  if (DEFAULTS.units[id]) applyBalance({ units: { [id]: DEFAULTS.units[id] } });
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
// page (the admin balance editor passes 'save-balance.php').
export async function saveBalance(endpoint = 'admin/save-balance.php') {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DS-Balance': '1' },
    body: JSON.stringify(currentBalance()),
  });
  if (r.status === 401) return 'auth';
  return r.ok ? 'ok' : 'error';
}
