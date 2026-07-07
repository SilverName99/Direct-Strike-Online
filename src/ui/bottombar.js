// The WC3-style bottom bar: [minimap] [portrait] [details] [4x4 command grid]
// [UNITS/CLĂDIRI tabs]. The grid is context-sensitive:
//   - tab 'units'      -> unit shop (click = pick for placement)
//   - tab 'buildings'  -> building shop + base tier upgrade
//   - a selection      -> that unit's abilities (autocast toggles) + equipped
//                         upgrades (on/off) + a Sell slot
// Selecting something switches the grid to its command card; the UNITS /
// CLĂDIRI buttons bring the shop back (the selection stays in the portrait).
// Hovering any filled slot opens the wide popup (4 slots wide, 2 tall) right
// above the grid with full details.
//
// Pure UI: every mutation goes through game.issueCommand.

import { CONFIG } from '../config.js';
import { UNIT_IDS } from '../units.js';
import { UPGRADE_IDS } from '../upgrades.js';
import {
  statsUnit, statsBuilding, buildingNameOf, resolvedUnitOrder,
  resolvedAbility, resolvedUpgrade,
} from './balance.js';
import { raceOf, getSprite, getUiIcon, getTabIcon } from '../render/sprites.js';
import { hasCharacter, drawCharacter, drawThumb } from '../render/characters.js';
import { TEAM_COLORS, drawShape } from '../render/renderer.js';

const BUILDING_CARDS = [
  { id: 'wall', hotkey: 'Z', role: 'Blochează unitățile terestre',
    tip: 'Barieră ieftină — inamicii trebuie să o spargă sau să o ocolească. Zburătorii trec peste.' },
  { id: 'tower', hotkey: 'X', role: 'Turn defensiv',
    tip: 'Trage în sol și aer. Apără zona de construcție.' },
  { id: 'generator', hotkey: 'C', role: 'Clădire economică',
    tip: 'Fiecare adaugă aur în plus la fiecare 20s. Poate fi distrus — protejează-ți economia!' },
];

const STATUS_LABELS = {
  atkslow: ['🐌', 'Atac încetinit', '#7fb4ff'],
  moveslow: ['❄', 'Mișcare încetinită', '#8fe3ff'],
  haste: ['⚡', 'Haste', '#ffd35c'],
  regen: ['✚', 'Regenerare', '#58d68d'],
  immune: ['🛡', 'Imun la debuff', '#ffe9a8'],
  nobuff: ['🚫', 'Fără buff-uri', '#ff8090'],
};

export class BottomBar {
  constructor(uiState, getGame, onShopClick) {
    this.uiState = uiState;
    this.getGame = getGame;
    this.onShopClick = onShopClick; // (id) -> route through Input.select (tier gate)

    this.tab = 'units';          // last shop tab
    this.mode = 'units';         // 'units' | 'buildings' | 'inspect'
    this.lastInspectKey = null;
    this.sig = null;             // grid rebuild signature

    this.portrait = document.getElementById('portrait');
    this.details = document.getElementById('bb-details');
    this.grid = document.getElementById('bb-grid');
    this.popup = document.getElementById('bb-popup');
    this.tabBtns = {
      units: document.getElementById('tab-units'),
      buildings: document.getElementById('tab-buildings'),
    };

    // 9 fixed slots (3x3)
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const el = document.createElement('div');
      el.className = 'slot empty';
      el.dataset.i = i;
      this.grid.appendChild(el);
      this.slots.push({ el, data: null });
    }

    // one grid-level click handler (works under pointer lock too)
    this.grid.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const el = e.target.closest('.slot');
      if (!el) return;
      const slot = this.slots[Number(el.dataset.i)];
      if (slot && slot.data) this.clickSlot(slot.data, el);
    });
    // hover -> wide popup above the grid
    this.grid.addEventListener('mousemove', (e) => {
      const el = e.target.closest('.slot');
      const slot = el ? this.slots[Number(el.dataset.i)] : null;
      this.hover(slot && slot.data ? slot.data : null);
    });
    this.grid.addEventListener('mouseleave', () => this.hover(null));

    for (const [tab, btn] of Object.entries(this.tabBtns)) {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.tab = tab;
        this.mode = tab;
        this.refreshTabs();
      });
    }
    this.refreshTabs();
  }

  refreshTabs() {
    for (const [tab, btn] of Object.entries(this.tabBtns)) {
      btn.classList.toggle('active', this.mode === tab);
      // per-race uploaded button art (fallback: an emoji glyph)
      const cv = btn.querySelector('canvas');
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      const img = getTabIcon(raceOf(0), tab);
      if (img) {
        const s = Math.min(cv.width / img.width, cv.height / img.height);
        ctx.drawImage(img, (cv.width - img.width * s) / 2, (cv.height - img.height * s) / 2,
          img.width * s, img.height * s);
      } else {
        ctx.font = '40px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tab === 'units' ? '⚔' : '🏰', cv.width / 2, cv.height / 2 + 2);
      }
    }
  }

  // Sprite/race/balance changed: redraw everything.
  refresh() {
    this.sig = null;
    this.refreshTabs();
  }

  // ------------------------------------------------------------------ frame
  update(game) {
    const info = this.resolveInspect(game);

    // a NEW selection flips the grid to its command card; losing the
    // selection falls back to the last shop tab
    const key = info ? `${info.kind}:${info.kind === 'template' ? this.uiState.inspect.index : this.uiState.inspect.id}` : null;
    if (key && key !== this.lastInspectKey) this.mode = 'inspect';
    if (!key && this.mode === 'inspect') this.mode = this.tab;
    this.lastInspectKey = key;
    if (this.mode === 'inspect' && !info) this.mode = this.tab;

    this.refreshPanel(game, info);

    const sig = this.buildSig(game, info);
    if (sig !== this.sig) {
      this.sig = sig;
      this.rebuildGrid(game, info);
      this.refreshTabs();
    }
    this.refreshGridLive(game, info);
  }

  resolveInspect(game) {
    const sel = this.uiState.inspect;
    if (!sel || !game) return null;
    if (sel.kind === 'template') {
      const tpl = game.templates[0][sel.index];
      if (!tpl) return null;
      return { kind: 'template', team: 0, type: tpl.type, tpl };
    }
    if (sel.kind === 'entity') {
      const u = game.byId.get(sel.id);
      if (!u || u.hp <= 0) return null;
      return { kind: 'entity', team: u.team, type: u.type, u };
    }
    if (sel.kind === 'structure') {
      const s = game.structures.find((st) => st.id === sel.id);
      if (!s || (s.hp <= 0 && s.kind !== 'main')) return null;
      return { kind: 'structure', team: s.team, type: s.kind, s };
    }
    return null;
  }

  buildSig(game, info) {
    const race = raceOf(0);
    let s = `${this.mode}:${race}:${resolvedUnitOrder(race).join(',')}`;
    if (!game) return s;
    s += `:t${game.tier[0]}`;
    if (this.mode === 'inspect' && info) {
      const toggles = [...game.abilityOff[info.team]]
        .filter((k) => k.startsWith(`${info.type}/`)).sort().join(',');
      const upgs = [...game.upgrades[info.team]].sort().join(',') + '|' +
        [...game.upgradeOff[info.team]].sort().join(',');
      const spawned = info.kind === 'template' ? !!info.tpl.spawned : '';
      s += `:${info.kind}:${info.type}:${info.team}:t${game.tier[info.team]}:${toggles}:${upgs}:${spawned}`;
    }
    return s;
  }

  // ------------------------------------------------------ portrait + details
  refreshPanel(game, info) {
    const ctx = this.portrait.getContext('2d');
    ctx.clearRect(0, 0, 112, 112);
    if (!info || !game) {
      this.details.innerHTML = '<div class="bb-empty">Selectează o unitate sau o clădire.</div>';
      return;
    }
    this.drawPortrait(ctx, game, info);

    const own = info.team === 0;
    const isStruct = info.kind === 'structure';
    const stats = isStruct ? game.bstat(info.team, info.type) : game.ustat(info.team, info.type);
    const name = stats.name || info.type;
    let sub;
    if (isStruct) {
      sub = info.type === 'main'
        ? `Tier ${'I'.repeat(game.tier[info.team])}`
        : `Clădire${stats.cost ? ` · ◆ ${stats.cost}` : ''}`;
    } else {
      sub = `Tier ${stats.tier} · ◆ ${stats.cost}` +
        (info.kind === 'template' && !info.tpl.spawned ? ' · nou (100% la vânzare)' : '');
    }

    // live numbers
    let hp; let maxHp; let mana = 0; let manaMax = 0;
    if (info.kind === 'entity') {
      hp = info.u.hp; maxHp = info.u.maxHp; mana = info.u.mana || 0; manaMax = info.u.manaMax || 0;
    } else if (isStruct) {
      hp = info.s.hp; maxHp = info.s.maxHp;
    } else {
      hp = maxHp = stats.hp; mana = manaMax = stats.caster ? stats.mana : 0;
    }

    const rows = [];
    if (!isStruct) {
      rows.push(stats.heal
        ? `✚ <b>${(stats.damage / Math.max(0.1, stats.period)).toFixed(0)}</b> HP/s vindecare`
        : `⚔ <b>${stats.damage}</b> (${stats.dmgType}) · <b>${(stats.damage / Math.max(0.1, stats.period)).toFixed(1)}</b> DPS`);
      rows.push(`🛡 <b>${stats.armor}</b>`, `➹ <b>${stats.range}</b>`, `🥾 <b>${stats.speed}</b>`);
      if (stats.isAir) rows.push('☁ zburător');
      if (stats.targetsAir) rows.push('🎯 lovește aer');
      if (stats.targetsGround === false) rows.push('⛔ nu lovește sol');
    } else {
      if (stats.damage) rows.push(`⚔ <b>${stats.damage}</b> · <b>${(stats.damage / Math.max(0.1, stats.period || 1)).toFixed(1)}</b> DPS`, `➹ <b>${stats.range}</b>`);
      if (stats.income) rows.push(`◆ +<b>${stats.income}</b> aur/20s`);
      if (info.type === 'main') rows.push('🏰 obiectivul principal');
    }

    // status + live happenings
    let chips = '';
    if (info.kind === 'entity') {
      if (info.u.effects) {
        for (const e of info.u.effects) {
          const m = STATUS_LABELS[e.kind];
          if (!m || e.until <= game.time) continue;
          chips += `<span class="d-chip" style="border-color:${m[2]};color:${m[2]}">${m[0]} ${m[1]} · ${Math.ceil(e.until - game.time)}s</span>`;
        }
      }
      if (info.u.dismounted) chips += '<span class="d-chip" style="border-color:#ffb35c;color:#ffb35c">🐗 pe jos</span>';
      if (info.u.castState) chips += '<span class="d-chip" style="border-color:#c9a7ff;color:#c9a7ff">✨ castează</span>';
      const tgt = info.u.targetId != null ? game.byId.get(info.u.targetId) : null;
      if (tgt && tgt.hp > 0) {
        const ts = game.ustat(tgt.team, tgt.type);
        chips += `<span class="d-chip">🎯 ${(ts && ts.name) || tgt.type}</span>`;
      }
    }

    const manaBar = manaMax > 0
      ? `<div class="d-bar"><div class="mana" style="width:${Math.max(0, (mana / manaMax) * 100)}%"></div><span>${Math.floor(mana)} / ${manaMax}</span></div>`
      : '';
    this.details.innerHTML = `
      <div class="d-title"><span class="d-name ${own ? '' : 'enemy'}">${name}</span><span class="d-sub">${sub}${own ? '' : ' · INAMIC'}</span></div>
      <div class="d-bar"><div class="hp ${own ? '' : 'enemy'}" style="width:${Math.max(0, (hp / maxHp) * 100)}%"></div><span>${Math.ceil(hp)} / ${Math.ceil(maxHp)}</span></div>
      ${manaBar}
      <div class="d-stats">${rows.map((r) => `<span>${r}</span>`).join('')}</div>
      <div class="d-status">${chips}</div>`;
  }

  drawPortrait(ctx, game, info) {
    const race = raceOf(info.team);
    const frame = Math.floor(performance.now() / 500) % 2;
    const entry = getSprite(race, info.type, 'idle', frame) || getSprite(race, info.type, 'idle', 0);
    if (entry && entry.img) {
      const img = entry.img;
      const s = Math.min(102 / img.width, 102 / img.height);
      ctx.drawImage(img, (112 - img.width * s) / 2, (112 - img.height * s) / 2, img.width * s, img.height * s);
      return;
    }
    ctx.save();
    ctx.translate(56, 58);
    if (drawThumb(ctx, info.type, info.team, 96)) { ctx.restore(); return; }
    ctx.restore();
    if (info.kind !== 'structure' && hasCharacter(info.type)) {
      ctx.save();
      ctx.translate(56, 60);
      drawCharacter(ctx, info.type, 'idle', 0, 0, 2.4);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(56, 56);
    if (info.kind === 'structure') {
      ctx.fillStyle = '#2d3a4f';
      ctx.fillRect(-30, -30, 60, 60);
      ctx.strokeStyle = TEAM_COLORS[info.team];
      ctx.lineWidth = 3.5;
      ctx.strokeRect(-30, -30, 60, 60);
    } else {
      const stats = game.ustat(info.team, info.type);
      ctx.fillStyle = TEAM_COLORS[info.team];
      drawShape(ctx, stats.shape || 'circle', 28);
      ctx.fill();
    }
    ctx.restore();
  }

  // --------------------------------------------------------------- the grid
  rebuildGrid(game, info) {
    const items = this.mode === 'inspect'
      ? this.inspectItems(game, info)
      : this.mode === 'buildings'
        ? this.buildingItems()
        : this.unitItems();

    for (let i = 0; i < 9; i++) {
      const slot = this.slots[i];
      const data = items[i] || null;
      slot.data = data;
      slot.el.className = 'slot' + (data ? '' : ' empty');
      slot.el.innerHTML = '';
      if (!data) continue;
      // icon
      const cv = document.createElement('canvas');
      cv.width = 34; cv.height = 34;
      slot.el.appendChild(cv);
      this.drawSlotIcon(cv.getContext('2d'), data, game);
      // overlays
      if (data.hotkey) {
        const k = document.createElement('span');
        k.className = 's-key'; k.textContent = data.hotkey;
        slot.el.appendChild(k);
      }
      if (data.cost != null) {
        const c = document.createElement('span');
        c.className = 's-cost'; c.textContent = data.cost;
        slot.el.appendChild(c);
      }
      if (data.lockTier) {
        const l = document.createElement('span');
        l.className = 's-lock'; l.textContent = `T${data.lockTier}`;
        slot.el.appendChild(l);
      }
    }
  }

  unitItems() {
    const race = raceOf(0);
    return resolvedUnitOrder(race).map((id, i) => {
      const u = statsUnit(race, id);
      return { kind: 'unit', id, cost: u.cost, hotkey: i < 9 ? String(i + 1) : '' };
    });
  }

  buildingItems() {
    const race = raceOf(0);
    const items = BUILDING_CARDS.map((b) => ({
      kind: 'building', id: b.id, cost: statsBuilding(race, b.id).cost, hotkey: b.hotkey,
    }));
    items.push({ kind: 'upgradeBase', id: 'upgrade', hotkey: '0' });
    return items;
  }

  inspectItems(game, info) {
    if (!info || !game) return [];
    const items = [];
    const own = info.team === 0;
    const isStruct = info.kind === 'structure';
    const stats = isStruct ? game.bstat(info.team, info.type) : game.ustat(info.team, info.type);

    // your own Main Base: the upgrades shop lives HERE (no more modal) —
    // unowned = click to buy, owned = click to activate/deactivate
    if (own && isStruct && info.type === 'main') {
      const race = raceOf(0);
      for (const id of UPGRADE_IDS) {
        const up = resolvedUpgrade(id);
        if (up && up.unit && (!up.race || up.race === race)) {
          items.push({ kind: 'buyUpgrade', id, cost: up.params.cost || 0 });
        }
      }
      return items;
    }

    if (!isStruct && stats.caster && stats.abilities) {
      for (const aid of stats.abilities) {
        const ab = resolvedAbility(aid);
        if (ab) items.push({ kind: 'ability', id: aid, team: info.team, unit: info.type, own });
      }
    }
    if (!isStruct) {
      const race = raceOf(info.team);
      for (const id of UPGRADE_IDS) {
        const up = resolvedUpgrade(id);
        if (up && up.unit === info.type && (!up.race || up.race === race)) {
          items.push({ kind: 'upgrade', id, team: info.team, own, cost: up.params.cost || 0 });
        }
      }
    }
    if (own && info.kind === 'template') {
      const full = !info.tpl.spawned;
      items.push({ kind: 'sell', what: 'unit', cost: Math.round(stats.cost * (full ? 1 : CONFIG.SELL_REFUND)), full });
    } else if (own && isStruct && CONFIG.BUILDINGS[info.type]) {
      items.push({ kind: 'sell', what: 'building', cost: Math.round(stats.cost * CONFIG.SELL_BUILDING_REFUND) });
    }
    return items;
  }

  drawSlotIcon(ctx, data, game) {
    ctx.clearRect(0, 0, 34, 34);
    if (data.kind === 'unit' || data.kind === 'building') {
      ctx.save();
      ctx.translate(17, 18);
      if (drawThumb(ctx, data.id, 0, 30)) { ctx.restore(); return; }
      ctx.restore();
      if (data.kind === 'unit' && hasCharacter(data.id)) {
        ctx.save();
        ctx.translate(17, 18);
        const u = statsUnit(raceOf(0), data.id);
        drawCharacter(ctx, data.id, 'idle', 0, 0, Math.min(1.2, 28 / (u.radius * 2.8 + 4)));
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.translate(17, 17);
      if (data.kind === 'building') {
        ctx.fillStyle = '#2d3a4f';
        ctx.fillRect(-11, -11, 22, 22);
        ctx.strokeStyle = TEAM_COLORS[0];
        ctx.lineWidth = 2;
        ctx.strokeRect(-11, -11, 22, 22);
        if (data.id === 'tower') { ctx.fillStyle = TEAM_COLORS[0]; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
        if (data.id === 'generator') { ctx.fillStyle = '#ffd35c'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); }
      } else {
        const u = statsUnit(raceOf(0), data.id);
        ctx.fillStyle = TEAM_COLORS[0];
        if (u.shape === 'ring') { ctx.strokeStyle = TEAM_COLORS[0]; ctx.lineWidth = 3; drawShape(ctx, 'ring', 12); ctx.stroke(); }
        else { drawShape(ctx, u.shape, 12); ctx.fill(); }
      }
      ctx.restore();
      return;
    }
    if (data.kind === 'upgradeBase') {
      ctx.fillStyle = '#ffd35c';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▲', 17, 18);
      return;
    }
    if (data.kind === 'ability' || data.kind === 'upgrade' || data.kind === 'buyUpgrade') {
      const img = getUiIcon(`${data.kind === 'ability' ? 'ability' : 'upgrade'}-${data.id}`);
      if (img) {
        const s = Math.min(34 / img.width, 34 / img.height);
        ctx.drawImage(img, (34 - img.width * s) / 2, (34 - img.height * s) / 2, img.width * s, img.height * s);
        return;
      }
      // fallback: colored disc + initial (ability) / boar glyph (upgrade)
      if (data.kind === 'ability') {
        const ab = resolvedAbility(data.id);
        ctx.fillStyle = (ab && ab.color) || '#8fa3c0';
        ctx.beginPath();
        ctx.arc(17, 17, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0a0e14';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(((ab && ab.name) || data.id)[0].toUpperCase(), 17, 18);
      } else {
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🐗', 17, 18);
      }
      return;
    }
    if (data.kind === 'sell') {
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💰', 17, 18);
    }
  }

  // Per-frame slot state: affordability, selection, toggle states, cooldowns.
  refreshGridLive(game, info) {
    for (const slot of this.slots) {
      const d = slot.data;
      if (!d) continue;
      const el = slot.el;
      el.classList.remove('selected', 'disabled', 'locked', 'on', 'off', 'owned-upg', 'sell');
      let cd = 0;
      if (d.kind === 'unit') {
        el.classList.toggle('selected', this.uiState.selected === d.id);
        if (game) {
          const u = game.ustat(0, d.id);
          if (u.tier > game.tier[0]) { el.classList.add('locked'); this.setLockTier(el, u.tier); }
          else if (game.money[0] < u.cost) el.classList.add('disabled');
        }
      } else if (d.kind === 'building') {
        el.classList.toggle('selected', this.uiState.selected === d.id);
        if (game) {
          const bs = game.bstat(0, d.id);
          if (game.countKind(0, d.id) >= bs.cap) el.classList.add('disabled');
          else if (game.money[0] < bs.cost) el.classList.add('disabled');
          cd = game.buildCdLeft(0, d.id);
        }
      } else if (d.kind === 'upgradeBase') {
        if (game) {
          const maxed = game.tier[0] >= CONFIG.TIER_MAX;
          const cost = maxed ? Infinity : game.tierUpCost(0);
          if (maxed || game.money[0] < cost) el.classList.add('disabled');
          const c = el.querySelector('.s-cost');
          if (c) c.textContent = maxed ? 'MAX' : cost;
        }
      } else if (d.kind === 'ability' && game) {
        const ab = resolvedAbility(d.id);
        const req = Math.max(1, (ab && ab.params.tier) || 1);
        if (game.tier[d.team] < req) { el.classList.add('locked'); this.setLockTier(el, req); }
        else if (game.abilityOff[d.team].has(`${d.unit}/${d.id}`)) el.classList.add('off');
        else el.classList.add('on');
        if (info && info.kind === 'entity' && info.u.abilityCd) {
          cd = (info.u.abilityCd[d.id] || 0) - game.time;
        }
      } else if (d.kind === 'upgrade' && game) {
        const owned = game.upgrades[d.team].has(d.id);
        if (owned) {
          el.classList.add('owned-upg');
          el.classList.add(game.upgradeOff[d.team].has(d.id) ? 'off' : 'on');
        } else {
          el.classList.add('disabled');
        }
      } else if (d.kind === 'buyUpgrade' && game) {
        const owned = game.upgrades[0].has(d.id);
        if (owned) {
          el.classList.add('owned-upg');
          el.classList.add(game.upgradeOff[0].has(d.id) ? 'off' : 'on');
        } else if (game.money[0] < d.cost) {
          el.classList.add('disabled');
        }
      } else if (d.kind === 'sell') {
        el.classList.add('sell');
      }
      // cooldown overlay
      let cdEl = el.querySelector('.s-cd');
      if (cd > 0.05) {
        if (!cdEl) {
          cdEl = document.createElement('span');
          cdEl.className = 's-cd';
          el.appendChild(cdEl);
        }
        cdEl.textContent = `${Math.ceil(cd)}`;
      } else if (cdEl) {
        cdEl.remove();
      }
    }
  }

  setLockTier(el, tier) {
    let l = el.querySelector('.s-lock');
    if (!l) {
      l = document.createElement('span');
      l.className = 's-lock';
      el.appendChild(l);
    }
    l.textContent = `T${tier}`;
  }

  clickSlot(d, el) {
    const game = this.getGame();
    if (d.kind === 'unit' || d.kind === 'building') {
      if (el.classList.contains('locked')) return;
      this.onShopClick(d.id);
      return;
    }
    if (d.kind === 'upgradeBase') {
      this.onShopClick('upgrade');
      return;
    }
    if (!game) return;
    if (d.kind === 'ability' && d.own) {
      const on = game.abilityOff[0].has(`${d.unit}/${d.id}`); // off -> turn on
      game.issueCommand({ type: 'toggleAbility', team: 0, unit: d.unit, ability: d.id, on });
      return;
    }
    if (d.kind === 'upgrade' && d.own && game.upgrades[0].has(d.id)) {
      const on = game.upgradeOff[0].has(d.id);
      game.issueCommand({ type: 'toggleUpgrade', team: 0, id: d.id, on });
      return;
    }
    if (d.kind === 'buyUpgrade') {
      if (game.upgrades[0].has(d.id)) {
        const on = game.upgradeOff[0].has(d.id); // owned -> toggle
        game.issueCommand({ type: 'toggleUpgrade', team: 0, id: d.id, on });
      } else {
        game.issueCommand({ type: 'buyUpgrade', team: 0, id: d.id });
      }
      return;
    }
    if (d.kind === 'sell') {
      const sel = this.uiState.inspect;
      if (!sel) return;
      if (d.what === 'unit') game.issueCommand({ type: 'sellUnit', team: 0, index: sel.index });
      else game.issueCommand({ type: 'sellBuilding', team: 0, id: sel.id });
      this.uiState.inspect = null;
    }
  }

  // ------------------------------------------------------------- hover popup
  hover(data) {
    if (!data) {
      this.popup.classList.remove('on');
      return;
    }
    this.popup.innerHTML = this.tooltipHtml(data);
    this.popup.classList.add('on');
  }

  tooltipHtml(d) {
    const game = this.getGame();
    const race = raceOf(0);
    if (d.kind === 'unit') {
      const u = statsUnit(race, d.id);
      const dps = u.heal
        ? `${(u.damage / Math.max(0.1, u.period)).toFixed(0)} HP/s vindecare`
        : `${(u.damage / Math.max(0.1, u.period)).toFixed(1)} DPS (${u.dmgType})`;
      return `<div class="p-title">${u.name} · Tier ${u.tier} · ◆ ${u.cost}</div>
        <div class="p-dim">${u.role || ''}</div>
        <div>${u.tip || ''}</div>
        <div class="p-dim">${u.hp} HP · ${u.armor} · ${dps} · rază ${u.range} · viteză ${u.speed}</div>`;
    }
    if (d.kind === 'building') {
      const b = BUILDING_CARDS.find((x) => x.id === d.id);
      const s = statsBuilding(race, d.id);
      const extra = d.id === 'tower'
        ? `${s.hp} HP · ${(s.damage / Math.max(0.1, s.period)).toFixed(1)} DPS · rază ${s.range}`
        : d.id === 'generator' ? `${s.hp} HP · +${s.income} aur/20s` : `${s.hp} HP`;
      return `<div class="p-title">${buildingNameOf(race, d.id)} · ◆ ${s.cost}</div>
        <div class="p-dim">${b ? b.role : ''}</div>
        <div>${b ? b.tip : ''}</div>
        <div class="p-dim">${extra} · max ${s.cap}</div>`;
    }
    if (d.kind === 'upgradeBase') {
      const maxed = game && game.tier[0] >= CONFIG.TIER_MAX;
      const cost = game ? (maxed ? 'MAX' : `◆ ${game.tierUpCost(0)}`) : `◆ ${CONFIG.TIER_COSTS[2]}`;
      const next = !game || game.tier[0] === 1
        ? 'Tier 2 deblochează unitățile de tier 2'
        : 'Tier 3 deblochează unitățile de tier 3';
      return `<div class="p-title">Upgrade Bază · ${cost}</div>
        <div>Deblochează următorul tier de unități și adaugă +1000 HP bazei. Instant.</div>
        <div class="p-dim">${maxed ? 'Toate tier-ele deblocate' : next}</div>`;
    }
    if (d.kind === 'ability') {
      const ab = resolvedAbility(d.id);
      if (!ab) return '';
      const p = ab.params;
      const req = Math.max(1, p.tier || 1);
      const bits = [`💧 ${p.manaCost || 0} mana`];
      if (p.cooldown != null) bits.push(`⏳ ${p.cooldown}s cooldown`);
      if (p.duration) bits.push(`durată ${p.duration}s`);
      if (req > 1) bits.push(`necesită Tier ${req}`);
      const state = game && game.abilityOff[d.team]?.has(`${d.unit}/${d.id}`) ? 'OPRIT' : 'PORNIT';
      return `<div class="p-title" style="color:${ab.color || '#ffd35c'}">${ab.name} — autocast ${state}</div>
        <div>${ab.desc || ''}</div>
        <div class="p-dim">${bits.join(' · ')}</div>
        ${d.own ? '<div class="p-dim">Click: pornește/oprește pentru TOATE unitățile de acest tip.</div>' : ''}`;
    }
    if (d.kind === 'upgrade' || d.kind === 'buyUpgrade') {
      const up = resolvedUpgrade(d.id);
      if (!up) return '';
      const team = d.team || 0;
      const owned = game && game.upgrades[team].has(d.id);
      const off = owned && game.upgradeOff[team].has(d.id);
      const uname = (statsUnit(up.race || race, up.unit) || {}).name || up.unit;
      const state = owned
        ? (off ? 'DEZACTIVAT' : 'ACTIV')
        : d.kind === 'buyUpgrade'
          ? `◆ ${up.params.cost || 0} — click pentru a cumpăra`
          : `necumpărat — ◆ ${up.params.cost || 0} din Bază`;
      return `<div class="p-title">🐗 ${up.name} — ${state}</div>
        <div>${up.desc || ''}</div>
        <div class="p-dim">Unitate: ${uname}</div>
        ${owned && (d.own || d.kind === 'buyUpgrade') ? '<div class="p-dim">Click: activează/dezactivează.</div>' : ''}`;
    }
    if (d.kind === 'sell') {
      return `<div class="p-title">Vinde — ◆ ${d.cost}${d.full ? ' (100%, nespawnat)' : ''}</div>
        <div class="p-dim">${d.what === 'unit' ? 'Vinde acest șablon de unitate.' : 'Vinde această clădire.'}</div>`;
    }
    return '';
  }
}
