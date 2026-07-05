// In-game balance editor. A gear on every shop card opens that entity's
// stats; the topbar gear opens general rules (waves, income, tiers, the
// starting turret and main-base HP). "Apply" changes the live game
// immediately (new spawns use new numbers); "Save" publishes to the
// server through the admin session so it becomes the game's balance.

import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';
import {
  UNIT_NUM_FIELDS, UNIT_SELECT_FIELDS, BUILDING_FIELDS, GENERAL_FIELDS,
  TURRET_FIELDS, resetUnit, resetAll, defaults, saveBalance,
} from './balance.js';
import { toast } from './pointer.js';

export class Editor {
  constructor(onApplied) {
    this.onApplied = onApplied; // e.g. rebuild the shop UI
    this.root = document.createElement('div');
    this.root.id = 'editor';
    document.body.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close(); // click outside the panel
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.root.classList.contains('visible')) this.close();
    });
  }

  close() {
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }

  // ------------------------------------------------------------- panels
  openUnit(id) {
    const u = UNITS[id];
    if (!u) return;
    const rows = [];
    for (const [f, label] of UNIT_NUM_FIELDS) {
      if (u[f] !== undefined) rows.push(this.numRow(`u.${f}`, label, u[f]));
    }
    for (const [f, opts] of Object.entries(UNIT_SELECT_FIELDS)) {
      if (u[f] !== undefined) rows.push(this.selRow(`u.${f}`, f, u[f], opts));
    }
    this.show(`${u.name} — stats`, rows.join(''), () => {
      this.readInto(u, 'u');
      return { kind: 'unit', id };
    }, () => resetUnit(id));
  }

  openBuilding(kind) {
    const b = CONFIG.BUILDINGS[kind];
    if (!b || !BUILDING_FIELDS[kind]) return;
    const rows = BUILDING_FIELDS[kind]
      .map(([f, label]) => this.numRow(`b.${f}`, label, b[f]))
      .join('');
    this.show(`${kind} — stats`, rows, () => {
      this.readInto(b, 'b');
      return { kind: 'building', id: kind };
    }, () => {
      Object.assign(b, defaults().buildings[kind]);
    });
  }

  openGeneral() {
    const d = defaults();
    let html = '<h4>Rules</h4>';
    html += GENERAL_FIELDS.map(([f, label]) => this.numRow(`g.${f}`, label, CONFIG[f])).join('');
    html += '<h4>Tier upgrade costs</h4>';
    html += this.numRow('t.2', 'Tier 2 cost', CONFIG.TIER_COSTS[2]);
    html += this.numRow('t.3', 'Tier 3 cost', CONFIG.TIER_COSTS[3]);
    html += '<h4>Main base HP (per tier)</h4>';
    html += [0, 1, 2].map((i) => this.numRow(`m.${i}`, `Tier ${i + 1} HP`, CONFIG.MAIN.hp[i])).join('');
    html += '<h4>Starting turret</h4>';
    html += TURRET_FIELDS.map(([f, label]) => this.numRow(`s.${f}`, label, CONFIG.TURRET[f])).join('');
    html += '<p class="ed-note">Starting money & main HP apply on the next match; wave interval from the next wave; the rest apply live.</p>';

    this.show('General balance', html, () => {
      this.readInto(CONFIG, 'g');
      for (const t of [2, 3]) {
        const v = this.val(`t.${t}`);
        if (v !== undefined) CONFIG.TIER_COSTS[t] = v;
      }
      for (const i of [0, 1, 2]) {
        const v = this.val(`m.${i}`);
        if (v !== undefined) CONFIG.MAIN.hp[i] = v;
      }
      this.readInto(CONFIG.TURRET, 's');
      return { kind: 'general' };
    }, () => {
      resetAll();
    });
  }

  // ---------------------------------------------------------- plumbing
  numRow(key, label, value) {
    return `<label class="ed-row"><span>${label}</span>
      <input type="number" step="any" data-k="${key}" value="${value}"></label>`;
  }

  selRow(key, label, value, opts) {
    const options = opts
      .map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`)
      .join('');
    return `<label class="ed-row"><span>${label}</span>
      <select data-k="${key}">${options}</select></label>`;
  }

  val(key) {
    const el = this.root.querySelector(`[data-k="${key}"]`);
    if (!el) return undefined;
    if (el.tagName === 'SELECT') return el.value;
    const n = Number(el.value);
    return isFinite(n) ? n : undefined;
  }

  // write all inputs with prefix into the target object (whitelisted keys)
  readInto(target, prefix) {
    for (const el of this.root.querySelectorAll(`[data-k^="${prefix}."]`)) {
      const f = el.dataset.k.slice(prefix.length + 1);
      if (target[f] === undefined) continue;
      const v = el.tagName === 'SELECT' ? el.value : Number(el.value);
      if (el.tagName === 'SELECT' || isFinite(v)) target[f] = v;
    }
  }

  show(title, rowsHtml, applyFn, resetFn) {
    this.root.innerHTML = `
      <div class="ed-panel">
        <div class="ed-head"><b>${title}</b><button class="ed-x" data-act="close">✕</button></div>
        <div class="ed-body">${rowsHtml}</div>
        <div class="ed-foot">
          <button class="btn" data-act="apply">Apply (live)</button>
          <button class="btn" data-act="save">Save to server</button>
          <button class="btn" data-act="reset">Reset defaults</button>
        </div>
        <p class="ed-note">Apply = testezi imediat în meci. Save = devine balansul oficial
        (necesită login în <a href="admin/" target="_blank">/admin</a>).</p>
      </div>`;
    this.root.classList.add('visible');

    this.root.querySelector('[data-act="close"]').onclick = () => this.close();
    this.root.querySelector('[data-act="apply"]').onclick = () => {
      applyFn();
      this.onApplied();
      toast('Applied — live in the current match');
    };
    this.root.querySelector('[data-act="save"]').onclick = async () => {
      applyFn();
      this.onApplied();
      const res = await saveBalance();
      if (res === 'ok') toast('Balance saved to server ✓');
      else if (res === 'auth') toast('Not logged in — open /admin, log in, then Save again');
      else toast('Save failed — check the server');
    };
    this.root.querySelector('[data-act="reset"]').onclick = () => {
      resetFn();
      this.onApplied();
      this.close();
      toast('Reset to defaults (Apply/Save to publish)');
    };
  }
}
