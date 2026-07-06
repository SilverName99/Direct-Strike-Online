// Admin abilities UI (loaded only by admin/abilities.php). Lists the whole
// ability catalog with every parameter editable; the values are global
// (shared by both races) and ship inside assets/balance.json.

import { ABILITIES, ABILITY_PARAM_LABELS } from '../abilities.js';
import { resolvedAbility, resetAbility, loadBalance, saveBalance } from './balance.js';

const app = document.getElementById('ab-app');
const status = document.getElementById('status');

function render() {
  let html = '';
  for (const [id, base] of Object.entries(ABILITIES)) {
    const ab = resolvedAbility(id);
    const kindLabel = base.kind === 'aura' ? 'aură (pasivă)' : 'activă (auto-cast)';
    html += `<div class="group">
      <h3 style="color:${base.color}">${base.name}<span class="kind ${base.kind}">${kindLabel}</span></h3>
      <div class="desc">${base.desc}</div>
      <div class="fields">`;
    for (const [k, v] of Object.entries(ab.params)) {
      const label = ABILITY_PARAM_LABELS[k] || k;
      html += `<label class="fld"><span>${label}</span>
        <input type="number" step="any" data-ab="${id}" data-k="${k}" value="${v}"></label>`;
    }
    html += '</div></div>';
  }
  app.innerHTML = html;
}

function collect() {
  for (const el of app.querySelectorAll('input[data-ab]')) {
    const ab = resolvedAbility(el.dataset.ab);
    const n = Number(el.value);
    if (ab && isFinite(n)) ab.params[el.dataset.k] = Math.max(0, n);
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
  for (const id of Object.keys(ABILITIES)) resetAbility(id);
  render();
  setStatus('Resetat la valorile din cod (apasă Salvează ca să publici).');
});

// apply any previously saved overrides, then render current values
loadBalance('../assets/').then(() => render());
