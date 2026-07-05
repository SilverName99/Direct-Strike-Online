// Per-entity stats editor for the sprite admin page (admin/index.php).
// A gear on each unit/building row opens a small modal with just that
// entity's numbers; saving writes the whole balance to the server
// (assets/balance.json) via the admin session. General rules live on the
// separate Balance page. Loads the shared JS data modules so values stay
// a single source of truth.

import { CONFIG, RACES } from '../config.js';
import {
  UNIT_NUM_FIELDS, UNIT_SELECT_FIELDS, BUILDING_FIELDS, TURRET_FIELDS,
  FOOTPRINT_BUILDINGS, statsUnit, resetRaceUnit, loadBalance, saveBalance, defaults,
} from './balance.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Unit stats are per-race; the tab's ?race= says which race we're editing.
const RACE = (() => {
  const r = new URLSearchParams(location.search).get('race');
  return RACES.includes(r) ? r : RACES[0];
})();

// ---- styles + modal DOM (injected so the page needs no extra markup) ----
const style = document.createElement('style');
style.textContent = `
  .stat-gear {
    display: inline-block; margin-top: 8px; padding: 3px 9px; font-size: 11px; cursor: pointer;
    background: #10151d; color: #ffd35c; border: 1px solid #5a4a1e; border-radius: 20px;
  }
  .stat-gear:hover { background: #241f10; }
  #stats-modal {
    position: fixed; inset: 0; display: none; z-index: 500;
    align-items: center; justify-content: center; background: rgba(5,8,12,0.7);
  }
  #stats-modal.on { display: flex; }
  .sm-panel {
    background: #161c26; border: 1px solid #2a3446; border-radius: 12px;
    width: 340px; max-height: 82vh; display: flex; flex-direction: column;
  }
  .sm-head { display: flex; justify-content: space-between; align-items: center;
    padding: 12px 16px; border-bottom: 1px solid #2a3446; font-size: 15px; text-transform: capitalize; }
  .sm-head b { color: #4da6ff; }
  .sm-x { background: none; border: none; color: #7c8ba1; font-size: 15px; cursor: pointer; }
  .sm-body { padding: 10px 16px; overflow-y: auto; }
  .sm-row { display: flex; justify-content: space-between; align-items: center;
    gap: 10px; margin: 6px 0; font-size: 13px; }
  .sm-row span { color: #b9c4d4; }
  .sm-row input, .sm-row select { width: 110px; padding: 5px 8px; background: #0a0e14;
    color: #dbe4f0; border: 1px solid #2a3446; border-radius: 6px; font-size: 13px; text-align: right; }
  .sm-row select { text-align: left; }
  .sm-foot { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #2a3446; }
  .sm-foot button { flex: 1; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
    background: #1d4e89; color: #dbe4f0; border: 1px solid #4da6ff; border-radius: 7px; }
  .sm-foot button.ghost { background: #161c26; border-color: #2a3446; }
  .sm-status { font-size: 12px; color: #7c8ba1; padding: 0 16px 12px; }
  .sm-status.ok { color: #58d68d; } .sm-status.bad { color: #ff8090; }
`;
document.head.appendChild(style);

const modal = document.createElement('div');
modal.id = 'stats-modal';
modal.innerHTML = `<div class="sm-panel">
  <div class="sm-head"><b class="sm-title"></b><button class="sm-x">✕</button></div>
  <div class="sm-body"></div>
  <div class="sm-foot">
    <button data-a="save">Salvează</button>
    <button data-a="reset" class="ghost">Reset</button>
  </div>
  <div class="sm-status"></div>
</div>`;
document.body.appendChild(modal);
modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
modal.querySelector('.sm-x').onclick = close;

const titleEl = modal.querySelector('.sm-title');
const bodyEl = modal.querySelector('.sm-body');
const statusEl = modal.querySelector('.sm-status');

let current = null; // { ent, kind, fields }

function close() { modal.classList.remove('on'); }

// Field descriptors: {label, value, type:'num'|'sel'|'text', opts?, apply(v)}
function fieldsFor(ent, kind) {
  const out = [];

  if (kind === 'unit') {
    // per-race unit: name + visual size + stats (all for THIS race only)
    const u = statsUnit(RACE, ent);
    out.push({ label: 'Name', type: 'text', value: u.name, apply: (v) => { u.name = v; } });
    out.push({
      label: 'Size (%)', type: 'num', value: Math.round((u.size || 1) * 100),
      apply: (v) => { u.size = clamp(v / 100, 0.2, 4); },
    });
    for (const [f, label] of UNIT_NUM_FIELDS) {
      if (u[f] !== undefined) out.push({ f, label, value: u[f], type: 'num', apply: (v) => { u[f] = v; } });
    }
    for (const [f, opts] of Object.entries(UNIT_SELECT_FIELDS)) {
      if (u[f] !== undefined) out.push({ f, label: f, value: u[f], type: 'sel', opts, apply: (v) => { u[f] = v; } });
    }
    return out;
  }

  // buildings / turret / main are shared by both races: global size,
  // footprint (buildable), then stats
  out.push({
    label: 'Size (%)', type: 'num', value: Math.round((CONFIG.SIZES[ent] || 1) * 100),
    apply: (v) => { CONFIG.SIZES[ent] = clamp(v / 100, 0.2, 4); },
  });
  if (FOOTPRINT_BUILDINGS.includes(ent)) {
    const b = CONFIG.BUILDINGS[ent];
    out.push({
      label: 'Footprint (cells)', type: 'num',
      value: Math.max(1, Math.round((b.radius * 2) / CONFIG.GRID)),
      apply: (v) => { b.radius = clamp(Math.round(v), 1, 10) * CONFIG.GRID / 2; },
    });
  }

  if (ent === 'turret') {
    for (const [f, label] of TURRET_FIELDS) {
      out.push({ f, label, value: CONFIG.TURRET[f], type: 'num', apply: (v) => { CONFIG.TURRET[f] = v; } });
    }
  } else if (ent === 'main') {
    ['Tier 1 HP', 'Tier 2 HP', 'Tier 3 HP'].forEach((label, i) => {
      out.push({ f: `hp${i}`, label, value: CONFIG.MAIN.hp[i], type: 'num', apply: (v) => { CONFIG.MAIN.hp[i] = v; } });
    });
  } else if (BUILDING_FIELDS[ent]) {
    const b = CONFIG.BUILDINGS[ent];
    for (const [f, label] of BUILDING_FIELDS[ent]) {
      out.push({ f, label, value: b[f], type: 'num', apply: (v) => { b[f] = v; } });
    }
  }
  return out;
}

function open(ent, kind) {
  current = { ent, kind, fields: fieldsFor(ent, kind) };
  titleEl.textContent = kind === 'unit' ? `${ent} — ${RACE}` : `${ent} — stats (comun)`;
  statusEl.textContent = '';
  statusEl.className = 'sm-status';
  bodyEl.innerHTML = current.fields.map((fd, i) => {
    if (fd.type === 'sel') {
      const o = fd.opts.map((x) => `<option ${x === fd.value ? 'selected' : ''}>${x}</option>`).join('');
      return `<label class="sm-row"><span>${fd.label}</span><select data-i="${i}">${o}</select></label>`;
    }
    if (fd.type === 'text') {
      return `<label class="sm-row"><span>${fd.label}</span>
        <input type="text" maxlength="20" data-i="${i}" value="${String(fd.value).replace(/"/g, '&quot;')}"></label>`;
    }
    return `<label class="sm-row"><span>${fd.label}</span>
      <input type="number" step="any" data-i="${i}" value="${fd.value}"></label>`;
  }).join('');
  modal.classList.add('on');
}

function writeInputs() {
  for (const el of bodyEl.querySelectorAll('[data-i]')) {
    const fd = current.fields[Number(el.dataset.i)];
    if (el.tagName === 'SELECT' || fd.type === 'text') fd.apply(el.value);
    else { const n = Number(el.value); if (isFinite(n)) fd.apply(n); }
  }
}

function setStatus(msg, cls = '') { statusEl.textContent = msg; statusEl.className = `sm-status ${cls}`; }

modal.querySelector('[data-a="save"]').onclick = async () => {
  writeInputs();
  setStatus('Se salvează…');
  const res = await saveBalance('save-balance.php');
  if (res === 'ok') setStatus('Salvat ✓ (activ la pornirea jocului)', 'ok');
  else if (res === 'auth') setStatus('Sesiune expirată — reloghează-te', 'bad');
  else setStatus('Salvare eșuată', 'bad');
};

modal.querySelector('[data-a="reset"]').onclick = () => {
  const d = defaults();
  const { ent, kind } = current;
  if (kind === 'unit') {
    resetRaceUnit(RACE, ent); // name + size + stats, for this race only
  } else {
    if (ent === 'turret') Object.assign(CONFIG.TURRET, d.turret);
    else if (ent === 'main') CONFIG.MAIN.hp = [...d.mainHp];
    else if (d.buildings[ent]) Object.assign(CONFIG.BUILDINGS[ent], d.buildings[ent]); // includes radius
    CONFIG.SIZES[ent] = d.buildingSizes[ent]; // reset global building size
  }
  open(ent, kind); // re-render with defaults
  setStatus('Reset la valorile din cod — apasă Salvează ca să publici.');
};

// Wire the gears once the saved balance is applied, so saving preserves it.
loadBalance('../assets/').then(() => {
  for (const g of document.querySelectorAll('.stat-gear')) {
    g.addEventListener('click', () => open(g.dataset.ent, g.dataset.kind));
  }
});
