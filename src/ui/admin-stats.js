// Per-entity stats editor for the sprite admin page (admin/index.php).
// A gear on each unit/building row opens a small modal with just that
// entity's numbers; saving writes the whole balance to the server
// (assets/balance.json) via the admin session. General rules live on the
// separate Balance page. Loads the shared JS data modules so values stay
// a single source of truth.

import { RACES } from '../config.js';
import { ABILITIES, ABILITY_IDS, MAX_ABILITIES } from '../abilities.js';
import {
  UNIT_NUM_FIELDS, UNIT_SELECT_FIELDS, BUILDING_FIELDS, TURRET_FIELDS,
  FOOTPRINT_BUILDINGS, statsUnit, statsBuilding, buildingNameOf,
  resetRaceUnit, resetRaceBuilding, loadBalance, saveBalance, setUnitOrder,
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
    align-items: center; justify-content: center; background: rgba(5,8,12,0.72);
    backdrop-filter: blur(2px);
  }
  #stats-modal.on { display: flex; }
  .sm-panel {
    background: #131924; border: 1px solid #2a3446; border-radius: 14px;
    width: 480px; max-width: 94vw; max-height: 88vh; display: flex; flex-direction: column;
    box-shadow: 0 24px 60px rgba(0,0,0,0.5);
  }
  .sm-head { display: flex; justify-content: space-between; align-items: center;
    padding: 14px 18px; border-bottom: 1px solid #2a3446; }
  .sm-head b { color: #4da6ff; font-size: 16px; text-transform: capitalize; }
  .sm-head .sm-sub { color: #6d7d92; font-size: 12px; margin-left: 8px; text-transform: capitalize; }
  .sm-x { background: none; border: none; color: #7c8ba1; font-size: 17px; cursor: pointer; line-height: 1; }
  .sm-x:hover { color: #dbe4f0; }
  .sm-body { padding: 6px 18px 14px; overflow-y: auto; }
  .sm-sec { margin-top: 16px; }
  .sm-sec:first-child { margin-top: 10px; }
  .sm-sec-h { font-size: 10.5px; letter-spacing: 1.2px; text-transform: uppercase; color: #7e93b2;
    font-weight: 700; padding-bottom: 6px; margin-bottom: 11px; border-bottom: 1px solid #232e40; }
  .sm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 14px; align-items: end; }
  .sm-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .sm-cell.full { grid-column: 1 / -1; }
  .sm-lbl { font-size: 11px; color: #9aa8bd; }
  .sm-cell input, .sm-cell select { width: 100%; box-sizing: border-box; padding: 6px 9px;
    background: #0a0e14; color: #dbe4f0; border: 1px solid #2a3446; border-radius: 7px; font-size: 13px; }
  .sm-cell input:focus, .sm-cell select:focus { outline: none; border-color: #4da6ff; }
  .sm-check { flex-direction: row; align-items: center; gap: 9px; cursor: pointer; padding: 3px 0; }
  .sm-check input { width: auto; accent-color: #4da6ff; }
  .sm-check span { font-size: 13px; color: #c8d3e4; }
  .sm-foot { display: flex; gap: 9px; padding: 13px 18px; border-top: 1px solid #2a3446; }
  .sm-foot button { flex: 1; padding: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
    background: #1d4e89; color: #eaf1fb; border: 1px solid #4da6ff; border-radius: 8px; }
  .sm-foot button:hover { background: #24609f; }
  .sm-foot button.ghost { background: #161c26; border-color: #2a3446; color: #b9c4d4; }
  .sm-foot button.ghost:hover { background: #1c2430; }
  .sm-status { font-size: 12px; color: #7c8ba1; padding: 0 18px 12px; }
  .sm-status.ok { color: #58d68d; } .sm-status.bad { color: #ff8090; }
  .sm-note { font-size: 11px; color: #8393a8; margin: 4px 0 0; line-height: 1.45; }
  .sm-cell select:disabled, .sm-cell input:disabled { opacity: 0.32; }
  .sm-check input:disabled + span { opacity: 0.4; }
  .ent-move { display: inline-flex; gap: 4px; margin-left: 10px; vertical-align: middle; }
  .ent-move button { width: 27px; height: 22px; padding: 0; font-size: 11px; line-height: 1; cursor: pointer;
    background: #10151d; color: #9fb4d6; border: 1px solid #2a3446; border-radius: 6px; }
  .ent-move button:hover { background: #1b2431; color: #dbe4f0; }
  @keyframes ds-saved { from { box-shadow: 0 0 0 2px #58d68d inset; } to { box-shadow: none; } }
  @keyframes ds-saveerr { from { box-shadow: 0 0 0 2px #ff8090 inset; } to { box-shadow: none; } }
  .ent.saved { animation: ds-saved 0.9s ease-out; }
  .ent.saveerr { animation: ds-saveerr 0.9s ease-out; }
`;
document.head.appendChild(style);

const modal = document.createElement('div');
modal.id = 'stats-modal';
modal.innerHTML = `<div class="sm-panel">
  <div class="sm-head"><div><b class="sm-title"></b><span class="sm-sub"></span></div><button class="sm-x">✕</button></div>
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
const subEl = modal.querySelector('.sm-sub');
const bodyEl = modal.querySelector('.sm-body');
const statusEl = modal.querySelector('.sm-status');

let current = null; // { ent, kind, fields }

function close() { modal.classList.remove('on'); }

// Field descriptors: {label, value, type:'num'|'sel'|'text', opts?, apply(v)}
function fieldsFor(ent, kind) {
  const out = [];

  if (kind === 'unit') {
    // per-race unit: grouped sections (General / Luptă / Ranged & Bounce /
    // Caster & Abilități) — all for THIS race only.
    const u = statsUnit(RACE, ent);
    const G = 'General', F = 'Luptă', R = 'Ranged & Bounce', C = 'Caster & Abilități';

    out.push({ group: G, label: 'Nume', type: 'text', value: u.name, apply: (v) => { u.name = v; } });
    out.push({
      group: G, label: 'Size (%)', type: 'num', value: Math.round((u.size || 1) * 100),
      apply: (v) => { u.size = clamp(v / 100, 0.2, 4); },
    });
    // footprint in grid cells (physical size), same idea as buildings
    out.push({
      group: G, label: 'Lățime (celule)', type: 'num', value: u.cw || 1,
      apply: (v) => { u.cw = clamp(Math.round(v), 1, 20); },
    });
    out.push({
      group: G, label: 'Înălțime (celule)', type: 'num', value: u.ch || 1,
      apply: (v) => { u.ch = clamp(Math.round(v), 1, 20); },
    });

    // Flying: the unit passes over walls/structures and can only be hit by
    // units flagged "Can hit air".
    out.push({
      group: F, label: 'Zburător (aerian)', type: 'check', value: !!u.isAir,
      apply: (v) => { u.isAir = !!v; },
    });
    // Combat numbers + select fields (armor / damage type)
    for (const [f, label] of UNIT_NUM_FIELDS) {
      if (u[f] !== undefined) out.push({ group: F, f, label, value: u[f], type: 'num', apply: (v) => { u[f] = v; } });
    }
    for (const [f, opts] of Object.entries(UNIT_SELECT_FIELDS)) {
      if (u[f] !== undefined) out.push({ group: F, f, label: f, value: u[f], type: 'sel', opts, apply: (v) => { u[f] = v; } });
    }

    // Ranged: basic attack fires a projectile; unlocks image + speed + bounce
    out.push({
      group: R, label: 'Ranged', type: 'check', cls: 'ranged-chk', value: !!u.ranged,
      apply: (v) => { u.ranged = !!v; },
    });
    // not every ranged troop can shoot flyers — this is the dedicated anti-air toggle
    out.push({
      group: R, label: 'Can hit air', type: 'check', value: !!u.targetsAir,
      apply: (v) => { u.targetsAir = !!v; },
    });
    out.push({
      group: R, label: 'Proiectil (%)', type: 'num', cls: 'ranged-field', disabled: !u.ranged,
      value: Math.round((u.projSize || 1) * 100),
      apply: (v) => { u.projSize = clamp(v / 100, 0.1, 6); },
    });
    out.push({
      group: R, label: 'Viteză proiectil', type: 'num', cls: 'ranged-field', disabled: !u.ranged,
      value: Math.round(u.projSpeed ?? 420),
      apply: (v) => { u.projSpeed = clamp(v, 20, 4000); },
    });
    // Bounce: the projectile also cleaves nearby enemies (needs Ranged).
    out.push({
      group: R, label: 'Bounce', type: 'check', cls: 'ranged-field bounce-chk', disabled: !u.ranged,
      value: !!u.bounce, apply: (v) => { u.bounce = !!v; },
    });
    out.push({
      group: R, label: 'Bounce (% putere)', type: 'num', cls: 'bounce-field', disabled: !u.ranged || !u.bounce,
      value: Math.round(u.bouncePower ?? 50),
      apply: (v) => { u.bouncePower = clamp(v, 0, 100); },
    });
    out.push({
      group: R, label: 'Bounce rază', type: 'num', cls: 'bounce-field', disabled: !u.ranged || !u.bounce,
      value: Math.round(u.bounceRadius ?? 80),
      apply: (v) => { u.bounceRadius = clamp(v, 10, 600); },
    });
    out.push({
      group: R, label: 'Bounce ținte', type: 'num', cls: 'bounce-field', disabled: !u.ranged || !u.bounce,
      value: Math.round(u.bounceMax ?? 3),
      apply: (v) => { u.bounceMax = Math.round(clamp(v, 1, 50)); },
    });

    // Caster + abilities
    out.push({
      group: C, label: 'Caster', type: 'check', cls: 'caster-chk', value: !!u.caster,
      apply: (v) => { u.caster = !!v; },
    });
    out.push({
      group: C, label: 'Auto attacks between spells', type: 'check', cls: 'ab-sel', disabled: !u.caster,
      value: !!u.autoAttackBetween,
      apply: (v) => { u.autoAttackBetween = !!v; },
    });
    out.push({
      group: C, label: 'Mana', type: 'num', cls: 'ab-sel', disabled: !u.caster, value: u.mana ?? 100,
      apply: (v) => { u.mana = clamp(v, 0, 100000); },
    });
    out.push({
      group: C, label: 'Regen mană (/s)', type: 'num', cls: 'ab-sel', disabled: !u.caster, value: u.manaRegen ?? 2,
      apply: (v) => { u.manaRegen = clamp(v, 0, 1000); },
    });
    const abSlots = [...(u.abilities || [])];
    const abOpts = [{ v: '', label: '—' }, ...ABILITY_IDS.map((a) => ({ v: a, label: ABILITIES[a].name }))];
    for (let i = 0; i < MAX_ABILITIES; i++) {
      out.push({
        group: C, label: `Abilitate ${i + 1}`, type: 'selkv', cls: 'ab-sel', disabled: !u.caster,
        value: abSlots[i] || '', opts: abOpts,
        apply: (v) => {
          abSlots[i] = v;
          const seen = new Set();
          u.abilities = abSlots.filter((x) => {
            if (!ABILITY_IDS.includes(x) || seen.has(x)) return false;
            seen.add(x);
            return true;
          }).slice(0, MAX_ABILITIES);
        },
      });
    }
    out.push({
      group: C, type: 'note',
      label: 'După Salvează + refresh: la caster, atacul devine 1 frame + un frame comun „Prepare spell", iar fiecare abilitate activă primește 1 frame „Cast …". Bifa „Ranged" adaugă slotul de imagine „Proiectil".',
    });
    return out;
  }

  // buildings are ALSO per-race now: name + size + footprint (buildable) +
  // idle speed + stats — all for THIS race only.
  const b = statsBuilding(RACE, ent);
  const G = 'General', S = 'Stats';
  out.push({ group: G, label: 'Nume', type: 'text', value: b.name, apply: (v) => { b.name = v; } });
  out.push({
    group: G, label: 'Size (%)', type: 'num', value: Math.round((b.size || 1) * 100),
    apply: (v) => { b.size = clamp(v / 100, 0.2, 4); },
  });
  if (b.range !== undefined) { // armed buildings (turret/tower) shoot projectiles
    out.push({
      group: G, label: 'Proiectil (%)', type: 'num', value: Math.round((b.projSize || 1) * 100),
      apply: (v) => { b.projSize = clamp(v / 100, 0.1, 6); },
    });
  }
  if (FOOTPRINT_BUILDINGS.includes(ent)) {
    out.push({
      group: G, label: 'Lățime (celule)', type: 'num', value: b.cw || 1,
      apply: (v) => { b.cw = clamp(Math.round(v), 1, 20); },
    });
    out.push({
      group: G, label: 'Înălțime (celule)', type: 'num', value: b.ch || 1,
      apply: (v) => { b.ch = clamp(Math.round(v), 1, 20); },
    });
  }
  // idle 1↔2 flip speed (entities with an uploaded idle animation; the main
  // base uses per-tier images instead, so no idle speed there)
  if (ent === 'turret' || ent === 'tower' || ent === 'generator') {
    out.push({
      group: G, label: 'Viteză idle (flip/s)', type: 'num', value: b.idleSpeed ?? 2,
      apply: (v) => { b.idleSpeed = clamp(v, 0.2, 10); },
    });
  }

  if (ent === 'turret') {
    for (const [f, label] of TURRET_FIELDS) {
      out.push({ group: S, f, label, value: b[f], type: 'num', apply: (v) => { b[f] = v; } });
    }
  } else if (ent === 'main') {
    ['Tier 1 HP', 'Tier 2 HP', 'Tier 3 HP'].forEach((label, i) => {
      out.push({ group: S, f: `hp${i}`, label, value: b.hp[i], type: 'num', apply: (v) => { b.hp[i] = v; } });
    });
  } else if (BUILDING_FIELDS[ent]) {
    for (const [f, label] of BUILDING_FIELDS[ent]) {
      out.push({ group: S, f, label, value: b[f], type: 'num', apply: (v) => { b[f] = v; } });
    }
  }
  return out;
}

// Render one field descriptor into a grid cell.
function cellHtml(fd, i) {
  const dis = fd.disabled ? 'disabled' : '';
  const cls = fd.cls || '';
  if (fd.type === 'note') return `<p class="sm-cell full sm-note">${fd.label}</p>`;
  if (fd.type === 'check') {
    return `<label class="sm-cell full sm-check"><input type="checkbox" class="${cls}" data-i="${i}" ${fd.value ? 'checked' : ''} ${dis}><span>${fd.label}</span></label>`;
  }
  if (fd.type === 'selkv') {
    const o = fd.opts.map((x) => `<option value="${x.v}" ${x.v === fd.value ? 'selected' : ''}>${x.label}</option>`).join('');
    return `<div class="sm-cell"><span class="sm-lbl">${fd.label}</span><select class="${cls}" data-i="${i}" ${dis}>${o}</select></div>`;
  }
  if (fd.type === 'sel') {
    const o = fd.opts.map((x) => `<option ${x === fd.value ? 'selected' : ''}>${x}</option>`).join('');
    return `<div class="sm-cell"><span class="sm-lbl">${fd.label}</span><select data-i="${i}">${o}</select></div>`;
  }
  if (fd.type === 'text') {
    return `<div class="sm-cell full"><span class="sm-lbl">${fd.label}</span><input type="text" maxlength="20" data-i="${i}" value="${String(fd.value).replace(/"/g, '&quot;')}"></div>`;
  }
  return `<div class="sm-cell"><span class="sm-lbl">${fd.label}</span><input type="number" step="any" class="${cls}" data-i="${i}" value="${fd.value}" ${dis}></div>`;
}

function open(ent, kind) {
  current = { ent, kind, fields: fieldsFor(ent, kind) };
  titleEl.textContent = statsUnit && kind === 'unit' ? (statsUnit(RACE, ent) || {}).name || ent : ent;
  subEl.textContent = ` — ${RACE}`;
  statusEl.textContent = '';
  statusEl.className = 'sm-status';
  // group fields into titled sections (preserving order)
  let html = '';
  let group = null;
  current.fields.forEach((fd, i) => {
    const g = fd.group || '';
    if (g !== group) {
      if (group !== null) html += '</div></div>';
      html += `<div class="sm-sec"><div class="sm-sec-h">${g}</div><div class="sm-grid">`;
      group = g;
    }
    html += cellHtml(fd, i);
  });
  if (group !== null) html += '</div></div>';
  bodyEl.innerHTML = html;
  // Live toggles without a re-render: "Caster" gates the mana/ability rows,
  // "Ranged" gates the projectile size/speed fields. (The projectile upload
  // slot still appears after Save + refresh.)
  const casterChk = bodyEl.querySelector('.caster-chk');
  if (casterChk) {
    casterChk.addEventListener('change', () => {
      for (const s of bodyEl.querySelectorAll('.ab-sel')) s.disabled = !casterChk.checked;
    });
  }
  const rangedChk = bodyEl.querySelector('.ranged-chk');
  const bounceChk = bodyEl.querySelector('.bounce-chk');
  // Bounce %/radius need both Ranged and Bounce checked.
  const syncBounce = () => {
    const on = !!(rangedChk && rangedChk.checked) && !!(bounceChk && bounceChk.checked);
    for (const s of bodyEl.querySelectorAll('.bounce-field')) s.disabled = !on;
  };
  if (rangedChk) {
    rangedChk.addEventListener('change', () => {
      for (const s of bodyEl.querySelectorAll('.ranged-field')) s.disabled = !rangedChk.checked;
      syncBounce();
    });
  }
  if (bounceChk) bounceChk.addEventListener('change', syncBounce);
  modal.classList.add('on');
}

function writeInputs() {
  for (const el of bodyEl.querySelectorAll('[data-i]')) {
    const fd = current.fields[Number(el.dataset.i)];
    if (fd.type === 'check') fd.apply(el.checked);
    else if (el.tagName === 'SELECT' || fd.type === 'text') fd.apply(el.value);
    else { const n = Number(el.value); if (isFinite(n)) fd.apply(n); }
  }
}

function setStatus(msg, cls = '') { statusEl.textContent = msg; statusEl.className = `sm-status ${cls}`; }

modal.querySelector('[data-a="save"]').onclick = async () => {
  writeInputs();
  setStatus('Se salvează…');
  const res = await saveBalance('save-balance.php');
  if (res === 'ok') { setStatus('Salvat ✓ (activ la pornirea jocului)', 'ok'); refreshNames(); }
  else if (res === 'auth') setStatus('Sesiune expirată — reloghează-te', 'bad');
  else setStatus('Salvare eșuată', 'bad');
};

modal.querySelector('[data-a="reset"]').onclick = () => {
  const { ent, kind } = current;
  if (kind === 'unit') resetRaceUnit(RACE, ent); // name + size + stats, this race
  else resetRaceBuilding(RACE, ent);             // name + size + footprint + stats, this race
  open(ent, kind); // re-render with defaults
  setStatus('Reset la valorile din cod — apasă Salvează ca să publici.');
};

// Show each row's custom (renamed) name for THIS race (units and buildings).
function refreshNames() {
  for (const g of document.querySelectorAll('.stat-gear')) {
    const ent = g.dataset.ent;
    const name = g.dataset.kind === 'unit'
      ? (statsUnit(RACE, ent) || {}).name
      : buildingNameOf(RACE, ent);
    const b = g.closest('.ent')?.querySelector('.title b');
    if (b && name) b.textContent = name;
  }
}

// ---- unit reorder (▲▼) — persists the shop display order to balance.json ----
function unitEnts() { return [...document.querySelectorAll('.ent[data-kind="unit"]')]; }

function persistOrder(ent) {
  setUnitOrder(unitEnts().map((e) => e.id));
  saveBalance('save-balance.php').then((res) => {
    if (!ent) return;
    ent.classList.remove('saved', 'saveerr');
    void ent.offsetWidth; // restart the flash
    ent.classList.add(res === 'ok' ? 'saved' : 'saveerr');
  });
}

function moveEnt(ent, dir) {
  const sib = dir < 0 ? ent.previousElementSibling : ent.nextElementSibling;
  if (!sib || sib.dataset.kind !== 'unit') return; // stay within the unit list
  if (dir < 0) ent.parentNode.insertBefore(ent, sib);
  else ent.parentNode.insertBefore(sib, ent);
  ent.scrollIntoView({ block: 'nearest' });
  persistOrder(ent);
}

function wireReorder() {
  for (const ent of unitEnts()) {
    const title = ent.querySelector('.title');
    if (!title || title.querySelector('.ent-move')) continue;
    const box = document.createElement('span');
    box.className = 'ent-move';
    box.innerHTML = '<button type="button" data-d="-1" title="Mută mai sus">▲</button>'
      + '<button type="button" data-d="1" title="Mută mai jos">▼</button>';
    title.appendChild(box);
    box.querySelector('[data-d="-1"]').onclick = () => moveEnt(ent, -1);
    box.querySelector('[data-d="1"]').onclick = () => moveEnt(ent, 1);
    ent.addEventListener('animationend', () => ent.classList.remove('saved', 'saveerr'));
  }
}

// Wire the gears once the saved balance is applied, so saving preserves it.
loadBalance('../assets/').then(() => {
  for (const g of document.querySelectorAll('.stat-gear')) {
    g.addEventListener('click', () => open(g.dataset.ent, g.dataset.kind));
  }
  refreshNames();
  wireReorder();
});
