// Admin upgrades UI (loaded only by admin/upgrades.php). Lists the whole
// upgrade catalog: a target-unit selector + every parameter editable. Values
// are global (shared by both races) and ship inside assets/balance.json.

import { UPGRADES, UPGRADE_PARAM_LABELS } from '../upgrades.js';
import { UNITS } from '../units.js';
import { RACES } from '../config.js';
import { resolvedUpgrade, resetUpgrade, statsUnit, loadBalance, saveBalance } from './balance.js';

const app = document.getElementById('up-app');
const status = document.getElementById('status');

// One option per (race, unit) — the same type is a different unit per race
// (e.g. Humans "Giant Eagle" vs Orcs "Boar Rider" for `crab`), so the upgrade
// targets a specific race's unit. Value = "race:unit"; shows the custom name.
function unitOpts() {
  const opts = [['', '— niciuna —']];
  for (const r of RACES) {
    for (const id of Object.keys(UNITS)) {
      const name = (statsUnit(r, id) || {}).name || id;
      opts.push([`${r}:${id}`, `${name} — ${r} (${id})`]);
    }
  }
  return opts;
}

function render() {
  let html = '';
  const UNIT_OPTS = unitOpts();
  for (const [id, base] of Object.entries(UPGRADES)) {
    const up = resolvedUpgrade(id);
    const cur = up.unit ? `${up.race || RACES[0]}:${up.unit}` : '';
    const opts = UNIT_OPTS.map(([v, label]) =>
      `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`).join('');
    html += `<div class="group">
      <h3>${base.name}</h3>
      <div class="desc">${base.desc}</div>
      <div class="unit-row"><span>Se aplică unității:</span>
        <select data-up="${id}" data-unit="1">${opts}</select></div>
      <div class="fields">`;
    for (const [k, v] of Object.entries(up.params)) {
      const label = UPGRADE_PARAM_LABELS[k] || k;
      html += `<label class="fld"><span>${label}</span>
        <input type="number" step="any" data-up="${id}" data-k="${k}" value="${v}"></label>`;
    }
    html += '</div></div>';
  }
  app.innerHTML = html;
}

function collect() {
  for (const sel of app.querySelectorAll('select[data-unit]')) {
    const up = resolvedUpgrade(sel.dataset.up);
    if (!up) continue;
    const [race, unit] = sel.value ? sel.value.split(':') : ['', ''];
    up.race = race;
    up.unit = unit;
  }
  for (const el of app.querySelectorAll('input[data-up]')) {
    const up = resolvedUpgrade(el.dataset.up);
    const n = Number(el.value);
    if (up && isFinite(n)) up.params[el.dataset.k] = Math.max(0, n);
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
  for (const id of Object.keys(UPGRADES)) resetUpgrade(id);
  render();
  setStatus('Resetat la valorile din cod (apasă Salvează ca să publici).');
});

// apply any previously saved overrides, then render current values
loadBalance('../assets/').then(() => render());
