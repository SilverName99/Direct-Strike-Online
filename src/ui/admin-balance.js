// Admin general-balance UI (loaded only by admin/balance.php). Holds only
// the global rules (starting money, income, wave interval, caps, refunds,
// tier costs). Per-entity stats live behind the ⚙ gears on the sprite
// page. Saves to the server; the game applies assets/balance.json at boot.

import { CONFIG } from '../config.js';
import { GENERAL_FIELDS, TINT_MODES, MIDDLE_KINDS, loadBalance, saveBalance, resetAll } from './balance.js';

const MIDDLE_KIND_LABELS = {
  none: 'Fără efect',
  moveslow: 'Încetinește mișcarea',
  atkslow: 'Încetinește atacul',
  manaregen: 'Regenerează mana',
};

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
  // middle-of-map terrain effects, one per uploaded strip variant (slots 1-3)
  html += `<div class="group"><h3>Mijloc hartă — efect pe teren</h3>
    <p style="color:#7c8ba1;font-size:12px;margin:0 0 10px">Fiecare variantă de mijloc (1-3, încărcate în <a href="./?view=icons" style="color:#4da6ff">Iconițe</a>) poate da un efect unităților de pe banda din centru. Ordinea = varianta 1/2/3. La fiecare meci se alege una la întâmplare dintre cele încărcate.</p>
    <div class="fields" style="margin-bottom:10px">${numField('middleEmpty', '', '', 'Variante GOALE în tragere (0 = mereu un mijloc)', CONFIG.MIDDLE_EMPTY)}</div>`;
  (CONFIG.MIDDLES || []).forEach((m, i) => {
    const kOpts = MIDDLE_KINDS.map((k) => `<option value="${k}" ${k === m.kind ? 'selected' : ''}>${MIDDLE_KIND_LABELS[k]}</option>`).join('');
    html += `<div class="fields" style="margin-bottom:8px;align-items:center">
      <label class="fld" style="min-width:220px"><span>Varianta ${i + 1} — efect</span>
        <select data-scope="middle" data-id="${i}" data-field="kind" style="width:auto;flex:1">${kOpts}</select></label>
      ${numField('middle', i, 'amount', 'Intensitate (% sau mană/s)', m.amount)}
      ${numField('middle', i, 'band', 'Lățime zonă (± unități)', m.band)}
      <label class="fld"><span>Afectează și zburătorii</span>
        <input type="checkbox" data-scope="middle" data-id="${i}" data-field="air" ${m.air ? 'checked' : ''}></label>
    </div>`;
  });
  html += '</div>';
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
    if (scope === 'middleEmpty') { if (isFinite(Number(el.value))) CONFIG.MIDDLE_EMPTY = Math.max(0, Math.round(Number(el.value))); continue; }
    if (scope === 'middle') {
      const m = CONFIG.MIDDLES[Number(id)];
      if (!m) continue;
      if (field === 'kind') m.kind = el.value;
      else if (field === 'air') m.air = el.checked;
      else if (isFinite(Number(el.value))) m[field] = Number(el.value);
      continue;
    }
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
