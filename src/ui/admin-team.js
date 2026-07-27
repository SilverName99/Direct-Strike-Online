// Admin "⚔ Moduri echipă" tab: every team-mode (2v2 / 3v3 / asymmetric) knob
// in one place. The values live in CONFIG (TEAM_* keys), persist inside
// balance.json's `general` block (see TEAM_FIELDS in balance.js), and apply to
// the sim on the next match.

import { CONFIG } from '../config.js';
import { TEAM_FIELDS, ensureBalanceLoadedUI, saveBalance, loadBalance } from './balance.js';

const app = document.getElementById('team-app');
const status = document.getElementById('status');

function setStatus(msg, cls = '') {
  if (status) { status.textContent = msg; status.className = cls; }
}

// group -> which TEAM_FIELDS keys it shows (order preserved from TEAM_FIELDS)
const GROUPS = [
  ['🤝 Colaborare — construit în zona aliatului', [
    'TEAM_ALLY_PCT_ANCHOR', 'TEAM_ALLY_PCT_CENTER', 'TEAM_ALLY_PCT_VANGUARD', 'TEAM_FALLEN_PCT',
  ], 'Cât la sută din plafoanele TALE normale poți construi în zona unui aliat, per rol de zonă (ex: 20% dintr-un plafon de 6 turnuri = 1 turn). „Fără bază" = procentul mărit după ce zona ta a căzut (atunci ai voie și mine la aliați).'],
  ['💥 Prăbușirea zonei & reconstrucția bazei', [
    'TEAM_REFUND_PCT', 'TEAM_MAIN_REBUILD_COST', 'TEAM_MAIN_REBUILD_TIME',
  ], 'Când baza unui jucător cade, toată zona lui (clădiri + armata parcată) se distruge și fiecare investitor primește refund-ul setat din ce a plătit EL. Jucătorul căzut își poate reconstrui baza într-o zonă vie a unui aliat — costul și durata șantierului se setează aici.'],
  ['⚖ Moduri asimetrice (1v2 / 1v3 / 2v3)', [
    'TEAM_ASYM_1V2', 'TEAM_ASYM_1V3', 'TEAM_ASYM_2V3',
  ], 'Compensația taberei cu mai puțini jucători: +% la venitul fiecărui jucător din tabăra mică, per matchup.'],
];

function labelOf(key) {
  const row = TEAM_FIELDS.find(([f]) => f === key);
  return row ? row[1] : key;
}

function render() {
  let html = '';
  for (const [title, keys, hint] of GROUPS) {
    html += `<div class="group"><h3>${title}</h3>
      <div class="sub" style="margin:2px 0 10px">${hint}</div>
      <div class="fields">`;
    for (const key of keys) {
      html += `<label class="fld"><span>${labelOf(key)}</span>
        <input type="number" step="1" data-team-field="${key}" value="${CONFIG[key] != null ? CONFIG[key] : 0}"></label>`;
    }
    html += '</div></div>';
  }
  app.innerHTML = html;
}

// pull the inputs back into CONFIG (numbers only; blanks keep the old value)
function collect() {
  for (const el of app.querySelectorAll('[data-team-field]')) {
    const v = Number(el.value);
    if (isFinite(v)) CONFIG[el.dataset.teamField] = Math.max(0, v);
  }
}

async function save() {
  collect();
  setStatus('Se salvează…');
  const res = await saveBalance('save-balance.php');
  if (res === 'ok') setStatus('Salvat ✓ (activ la următorul meci)', 'ok');
  else if (res === 'auth') setStatus('Sesiune expirată — reloghează-te în /admin', 'bad');
  else setStatus('Eroare la salvare', 'bad');
}

function wireBar() {
  const btn = document.getElementById('save-btn');
  if (btn) btn.addEventListener('click', save);
  const reset = document.getElementById('reset-btn');
  if (reset) reset.addEventListener('click', async () => {
    await loadBalance('../assets/'); // re-pull the server values, dropping unsaved edits
    render();
    setStatus('Valorile de pe server reîncărcate');
  });
}

// same boot pattern as the other admin editors: load the real config first and
// never render/save over it if the load failed (ensureBalanceLoadedUI guard)
if (app) {
  loadBalance('../assets/').then(() => {
    if (!ensureBalanceLoadedUI()) return;
    render();
    wireBar();
  });
}
