// Admin balance editor UI (loaded only by admin/balance.php). Renders a
// flat, full form for every unit, building and the general rules from the
// shared data modules, then saves to the server. No game runs here — it's
// pure edit + persist; the game applies assets/balance.json at boot.

import { CONFIG } from '../config.js';
import { UNITS, UNIT_IDS } from '../units.js';
import {
  UNIT_NUM_FIELDS, UNIT_SELECT_FIELDS, BUILDING_FIELDS, GENERAL_FIELDS,
  TURRET_FIELDS, loadBalance, saveBalance, resetAll,
} from './balance.js';

const app = document.getElementById('bal-app');
const status = document.getElementById('status');

function numField(scope, id, field, label, value) {
  return `<label class="fld"><span>${label}</span>
    <input type="number" step="any" data-scope="${scope}" data-id="${id}" data-field="${field}" value="${value}"></label>`;
}
function selField(scope, id, field, label, value, opts) {
  const o = opts.map((x) => `<option ${x === value ? 'selected' : ''}>${x}</option>`).join('');
  return `<label class="fld"><span>${label}</span>
    <select data-scope="${scope}" data-id="${id}" data-field="${field}">${o}</select></label>`;
}

function render() {
  let html = '';

  // General
  html += '<h2 id="general">General</h2><div class="group"><h3>Rules</h3><div class="fields">';
  for (const [f, label] of GENERAL_FIELDS) html += numField('general', '', f, label, CONFIG[f]);
  html += '</div></div>';
  html += '<div class="group"><h3>Tier upgrade costs</h3><div class="fields">';
  html += numField('tier', '2', '', 'Tier 2 cost', CONFIG.TIER_COSTS[2]);
  html += numField('tier', '3', '', 'Tier 3 cost', CONFIG.TIER_COSTS[3]);
  html += '</div></div>';
  html += '<div class="group"><h3>Main base HP (per tier)</h3><div class="fields">';
  for (let i = 0; i < 3; i++) html += numField('main', String(i), '', `Tier ${i + 1} HP`, CONFIG.MAIN.hp[i]);
  html += '</div></div>';
  html += '<div class="group"><h3>Starting turret</h3><div class="fields">';
  for (const [f, label] of TURRET_FIELDS) html += numField('turret', '', f, label, CONFIG.TURRET[f]);
  html += '</div></div>';

  // Buildings
  html += '<h2 id="buildings">Buildings</h2>';
  for (const [kind, fields] of Object.entries(BUILDING_FIELDS)) {
    html += `<div class="group" id="b-${kind}"><h3>${kind}</h3><div class="fields">`;
    for (const [f, label] of fields) html += numField('building', kind, f, label, CONFIG.BUILDINGS[kind][f]);
    html += '</div></div>';
  }

  // Units
  html += '<h2 id="units">Units</h2>';
  for (const id of UNIT_IDS) {
    const u = UNITS[id];
    html += `<div class="group" id="u-${id}"><h3>${u.name} <span style="color:#7c8ba1;font-size:11px">(${id})</span></h3><div class="fields">`;
    for (const [f, label] of UNIT_NUM_FIELDS) {
      if (u[f] !== undefined) html += numField('unit', id, f, label, u[f]);
    }
    for (const [f, opts] of Object.entries(UNIT_SELECT_FIELDS)) {
      if (u[f] !== undefined) html += selField('unit', id, f, f, u[f], opts);
    }
    html += '</div></div>';
  }

  app.innerHTML = html;

  // quick nav under the sub line
  const nav = document.createElement('div');
  nav.className = 'quicknav';
  nav.innerHTML =
    '<a href="#general">general</a><a href="#buildings">buildings</a>' +
    UNIT_IDS.map((id) => `<a href="#u-${id}">${id}</a>`).join('');
  app.prepend(nav);
}

// Write every input back into the live UNITS/CONFIG objects.
function collect() {
  for (const el of app.querySelectorAll('[data-scope]')) {
    const { scope, id, field } = el.dataset;
    const isSel = el.tagName === 'SELECT';
    const raw = isSel ? el.value : Number(el.value);
    if (!isSel && !isFinite(raw)) continue;
    if (scope === 'general') CONFIG[field] = raw;
    else if (scope === 'tier') CONFIG.TIER_COSTS[Number(id)] = raw;
    else if (scope === 'main') CONFIG.MAIN.hp[Number(id)] = raw;
    else if (scope === 'turret') CONFIG.TURRET[field] = raw;
    else if (scope === 'building') CONFIG.BUILDINGS[id][field] = raw;
    else if (scope === 'unit' && UNITS[id][field] !== undefined) UNITS[id][field] = raw;
  }
}

function setStatus(msg, cls = '') {
  status.textContent = msg;
  status.className = cls;
}

document.getElementById('save-btn').addEventListener('click', async () => {
  collect();
  setStatus('Se salvează…');
  const res = await saveBalance('save-balance.php');
  if (res === 'ok') setStatus('Salvat ✓ (activ la următoarea pornire a jocului)', 'ok');
  else if (res === 'auth') setStatus('Sesiune expirată — reloghează-te în /admin', 'bad');
  else setStatus('Salvare eșuată — verifică serverul', 'bad');
});

document.getElementById('reset-btn').addEventListener('click', () => {
  resetAll();
  render();
  setStatus('Resetat la valorile din cod (apasă Salvează ca să publici).');
});

// apply any previously saved overrides, then render current values
loadBalance('../assets/').then(() => render());
