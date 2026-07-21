// Admin abilities UI (loaded only by admin/abilities.php). Lists the whole
// ability catalog with every parameter editable; the values are global
// (shared by both races) and ship inside assets/balance.json.

import { ABILITIES, ABILITY_PARAM_LABELS } from '../abilities.js';
import { UNIT_IDS } from '../units.js';
import { RACES } from '../config.js';
import { resolvedAbility, resetAbility, loadBalance, saveBalance, ensureBalanceLoadedUI, statsUnit } from './balance.js';
import { mountAbilityPreviews } from './ability-preview.js';

const app = document.getElementById('ab-app');
const status = document.getElementById('status');
let stopPreviews = null;
let curFilter = 'all'; // ability id-set filter: 'all' or a character key

// Which characters use which abilities. A hero contributes its 3 skills + its
// ultimate; a plain caster contributes its ability list. Built from the live
// (balance-resolved) roster so custom hero names show up.
function characterIndex() {
  const chars = [];
  for (const race of RACES) {
    for (const id of UNIT_IDS) {
      const u = statsUnit(race, id);
      if (!u) continue;
      let aids = [];
      if (u.isHero) aids = [...(u.heroAbilities || []), u.heroUltimate];
      else if (u.caster) aids = [...(u.abilities || [])];
      aids = aids.filter((a) => a && ABILITIES[a]);
      if (!aids.length) continue;
      chars.push({ key: `${race}:${id}`, race, label: u.name || id, aids: [...new Set(aids)] });
    }
  }
  return chars;
}

// The set of ability ids the current filter allows (null = show everything).
function filterSet(chars) {
  if (curFilter === 'all') return null;
  const c = chars.find((x) => x.key === curFilter);
  return c ? new Set(c.aids) : null;
}

function renderFilterBar() {
  const chars = characterIndex();
  const bar = document.getElementById('ab-filter');
  if (!bar) return chars;
  // group the options by race so the same-named "Erou" slots stay readable
  let opts = '<option value="all">Toate abilitățile</option>';
  for (const race of RACES) {
    const inRace = chars.filter((c) => c.race === race);
    if (!inRace.length) continue;
    opts += `<optgroup label="${race}">`;
    for (const c of inRace) {
      const sel = c.key === curFilter ? ' selected' : '';
      opts += `<option value="${c.key}"${sel}>${c.label} — ${c.aids.length} abilit.</option>`;
    }
    opts += '</optgroup>';
  }
  bar.querySelector('select').innerHTML = opts;
  return chars;
}

function applyFilter(chars) {
  const set = filterSet(chars);
  let shown = 0;
  for (const g of app.querySelectorAll('.group')) {
    const on = !set || set.has(g.dataset.abgroup);
    g.style.display = on ? '' : 'none';
    if (on) shown++;
  }
  const note = document.getElementById('ab-filter-note');
  if (note) note.textContent = set ? `${shown} abilități pentru acest caracter` : '';
}

// A few param labels read differently depending on the ability kind. For a
// SUMMON, `range`/`damage` are the summoned unit's OWN stats (its attack reach
// and hit), not a casting distance — the generic "Cast range" label is
// misleading there. The real casting reach for Rise Dead is `corpseRange`.
const KIND_LABELS = {
  summon: {
    range: 'Rază atac (invocat)', damage: 'Damage (invocat)',
    size: 'Mărime invocat (%)',
  },
};
function paramLabel(base, k) {
  const byKind = KIND_LABELS[base.kind];
  return (byKind && byKind[k]) || ABILITY_PARAM_LABELS[k] || k;
}

function render() {
  let html = '';
  for (const [id, base] of Object.entries(ABILITIES)) {
    const ab = resolvedAbility(id);
    const kindLabel = base.kind === 'aura' ? 'aura (passive)'
      : base.kind === 'castaura' ? 'cast aura (buff zone)'
      : base.kind === 'passive' ? 'passive'
      : base.kind === 'summon' ? 'summon'
      : 'active (auto-cast)';
    html += `<div class="group" data-abgroup="${id}">
      <div class="ab-head">
        <div class="ab-info">
          <h3 style="color:${base.color}">${base.name}<span class="kind ${base.kind}">${kindLabel}</span></h3>
          <textarea class="desc-edit" data-abdesc="${id}" rows="2" title="Descrierea afișată la hover în joc (gol = textul din cod)" style="width:100%;box-sizing:border-box;margin-top:4px;padding:6px 8px;background:#0a0e14;color:#b9c4d4;border:1px solid #2a3446;border-radius:6px;font-size:12px;resize:vertical">${(ab.desc || base.desc || '').replace(/</g, '')}</textarea>
        </div>
        <canvas class="ab-preview" data-ab="${id}" title="Preview VFX"></canvas>
      </div>
      <div class="fields">`;
    for (const [k, v] of Object.entries(ab.params)) {
      const label = paramLabel(base, k);
      html += `<label class="fld"><span>${label}</span>
        <input type="number" step="any" data-ab="${id}" data-k="${k}" value="${v}"></label>`;
    }
    html += '</div></div>';
  }
  app.innerHTML = html;

  // start (or restart) the live VFX previews
  if (stopPreviews) stopPreviews();
  const entries = [...app.querySelectorAll('.ab-preview')].map((c) => ({ canvas: c, id: c.dataset.ab }));
  stopPreviews = mountAbilityPreviews(entries);

  // refresh the "by character" filter and re-apply the current selection
  const chars = renderFilterBar();
  applyFilter(chars);
}

function collect() {
  for (const el of app.querySelectorAll('input[data-ab]')) {
    const ab = resolvedAbility(el.dataset.ab);
    const n = Number(el.value);
    if (ab && isFinite(n)) ab.params[el.dataset.k] = Math.max(0, n);
  }
  // hover descriptions (free text, saved with the balance)
  for (const el of app.querySelectorAll('textarea[data-abdesc]')) {
    const ab = resolvedAbility(el.dataset.abdesc);
    if (ab) ab.desc = el.value.replace(/[<>]/g, '').trim().slice(0, 300);
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

// "by character" filter dropdown (wired once; options fill in on each render)
const filterSel = document.querySelector('#ab-filter select');
if (filterSel) filterSel.addEventListener('change', () => {
  curFilter = filterSel.value;
  applyFilter(characterIndex());
});

// apply any previously saved overrides, then render current values
loadBalance('../assets/').then(() => { if (ensureBalanceLoadedUI()) render(); });
