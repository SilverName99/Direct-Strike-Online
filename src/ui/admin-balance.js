// Admin general-balance UI (loaded only by admin/balance.php). Holds only
// the global rules (starting money, income, wave interval, caps, refunds,
// tier costs). Per-entity stats live behind the ⚙ gears on the sprite
// page. Saves to the server; the game applies assets/balance.json at boot.

import { CONFIG } from '../config.js';
import { GENERAL_FIELDS, TINT_MODES, loadBalance, saveBalance, resetAll } from './balance.js';

const TINT_LABELS = {
  team: 'Ale mele albastre / inamic roșu',
  enemy: 'Doar inamicul roșu (culoarea pozei pentru mine)',
  none: 'Fără colorare (culorile pozei)',
};

const app = document.getElementById('bal-app');
const status = document.getElementById('status');

function numField(scope, id, field, label, value) {
  return `<label class="fld"><span>${label}</span>
    <input type="number" step="any" data-scope="${scope}" data-id="${id}" data-field="${field}" value="${value}"></label>`;
}

function render() {
  let html = '';
  html += '<div class="group"><h3>Rules</h3><div class="fields">';
  for (const [f, label] of GENERAL_FIELDS) html += numField('general', '', f, label, CONFIG[f]);
  html += '</div></div>';
  html += '<div class="group"><h3>Tier upgrade costs</h3><div class="fields">';
  html += numField('tier', '2', '', 'Tier 2 cost', CONFIG.TIER_COSTS[2]);
  html += numField('tier', '3', '', 'Tier 3 cost', CONFIG.TIER_COSTS[3]);
  html += '</div></div>';
  // team-coloring mode for uploaded sprites
  const opts = TINT_MODES
    .map((m) => `<option value="${m}" ${m === CONFIG.TEAM_TINT ? 'selected' : ''}>${TINT_LABELS[m]}</option>`)
    .join('');
  html += `<div class="group"><h3>Colorarea echipelor (sprite-uri)</h3>
    <label class="fld" style="width:100%"><span>Mod</span>
      <select data-scope="tint" style="width:auto;flex:1;max-width:340px">${opts}</select></label></div>`;
  // health-bar visibility
  const hbOpts = [['0', 'Doar când sunt lovite (ca acum)'], ['1', 'Mereu vizibile (chiar și full)']]
    .map(([v, l]) => `<option value="${v}" ${(!!CONFIG.HEALTHBAR_ALWAYS === (v === '1')) ? 'selected' : ''}>${l}</option>`)
    .join('');
  html += `<div class="group"><h3>Bare de viață</h3>
    <label class="fld" style="width:100%"><span>Afișare</span>
      <select data-scope="healthbar" style="width:auto;flex:1;max-width:340px">${hbOpts}</select></label></div>`;
  html += '<p style="color:#7c8ba1;font-size:12px;margin-top:8px">Statisticile fiecărei unități/clădiri (nume, dimensiune, footprint, HP-ul bazei, turnul inițial) se editează cu <b>⚙ stats</b> în pagina de <a href="./" style="color:#4da6ff">sprites</a>.</p>';
  app.innerHTML = html;
}

// Write the general/tier inputs back into CONFIG (this page only holds
// general rules; per-entity stats are edited via gears on the sprite page).
function collect() {
  for (const el of app.querySelectorAll('[data-scope]')) {
    const { scope, id, field } = el.dataset;
    if (scope === 'tint') { CONFIG.TEAM_TINT = el.value; continue; }
    if (scope === 'healthbar') { CONFIG.HEALTHBAR_ALWAYS = el.value === '1'; continue; }
    const raw = Number(el.value);
    if (!isFinite(raw)) continue;
    if (scope === 'general') CONFIG[field] = raw;
    else if (scope === 'tier') CONFIG.TIER_COSTS[Number(id)] = raw;
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
