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
  resolvedAbility, resolvedUpgrade, towerStatForTier, TECH_BUILDINGS, resolvedHeroId, heroAbilitySlots,
} from './balance.js';
import { raceOf, getSprite, getThumb, getUiIcon, getTabIcon, getBaseUpgradeIcon, getBarSkin, getBarOverlay, getPortraitVideoUrl, getMineVideoUrl, getTowerVideoUrl } from '../render/sprites.js';
import { hasCharacter, drawCharacter, drawThumb } from '../render/characters.js';
import { TEAM_COLORS, drawShape } from '../render/renderer.js';

const BUILDING_CARDS = [
  { id: 'wall', hotkey: 'Z', role: 'Blochează unitățile terestre',
    tip: 'Barieră ieftină — inamicii trebuie să o spargă sau să o ocolească. Zburătorii trec peste.' },
  { id: 'tower', hotkey: 'X', role: 'Turn defensiv',
    tip: 'Trage în sol și aer. Apără zona de construcție.' },
  { id: 'generator', hotkey: 'C', role: 'Clădire economică',
    tip: 'Fiecare adaugă aur în plus la fiecare 20s. Poate fi distrus — protejează-ți economia!' },
  { id: 'bldg1', hotkey: 'V', role: 'Deblochează unități',
    tip: 'Construiește-o ca să poți cumpăra unitățile ei. Click pe ea pentru unități + upgrade-uri. Distrusă = pierzi accesul.' },
  { id: 'bldg2', hotkey: 'B', role: 'Deblochează unități',
    tip: 'Construiește-o ca să poți cumpăra unitățile ei. Click pe ea pentru unități + upgrade-uri. Distrusă = pierzi accesul.' },
  { id: 'bldg3', hotkey: 'N', role: 'Deblochează unități',
    tip: 'Construiește-o ca să poți cumpăra unitățile ei. Click pe ea pentru unități + upgrade-uri. Distrusă = pierzi accesul.' },
  { id: 'farm', hotkey: 'M', role: 'Mărește food cap',
    tip: 'Fiecare fermă crește plafonul de food, ca să poți plasa mai multe unități. Distrusă = pierzi plafonul (unitățile plasate rămân).' },
];

// Lay out a building command-card page onto the 9 cells: sell fixed at slot 7,
// the units/upgrades toggle at slot 8, and the page entries in cells 0..6 —
// each at its admin-chosen `slot` (0..6) when free, otherwise auto-filling the
// first empty cell. Entries whose slot collides or is out of range auto-fill.
function layoutCardPage(entries, toggleItem) {
  const grid = new Array(9).fill(null);
  // cards claim their admin-chosen cell first (any of the 9 cells)…
  const auto = [];
  for (const it of entries) {
    const s = Number.isInteger(it.slot) ? it.slot : -1;
    if (s >= 0 && s <= 8 && grid[s] == null) grid[s] = it;
    else auto.push(it);
  }
  // …the ⬆/⬇ pages toggle takes the HIGHEST free cell (Vinde moved out of the
  // grid — it's the dedicated red button under the tabs, bottom-right), and
  // auto cards fill whatever is left, first free cell up.
  if (toggleItem) {
    for (let i = 8; i >= 0; i--) if (grid[i] == null) { grid[i] = toggleItem; break; }
  }
  for (let i = 0; i <= 8 && auto.length; i++) if (grid[i] == null) grid[i] = auto.shift();
  return grid;
}

// The clean emoji stat line shared by the shop hover popup AND the selection
// panel: cost 💰 · HP ❤️ · damage ⚔️ · armor 🛡️ · damage-type 🗡️ (+ Hits air /
// Caster tags). Cost/armor/type are skipped when absent (e.g. summoned beasts).
function unitStatBits(s) {
  // (cost lives on the card thumbnail badge now, not in the stat line)
  const bits = [`${Math.round(s.hp)} ❤️`, `${s.damage} ⚔️`];
  if (s.armor) bits.push(`${s.armor} 🛡️`);
  if (s.dmgType) bits.push(`${s.dmgType} 🗡️`);
  if (s.targetsAir) bits.push('Hits air');
  if (s.caster) bits.push('Caster');
  return bits;
}

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
    this.bldgView = 'units';     // tech-building card: 'units' | 'upgrades'
    this.lastInspectKey = null;
    this.sig = null;             // grid rebuild signature

    this.bar = document.getElementById('bottombar');
    this.bgPath = document.querySelector('#bb-bg path');
    this.portrait = document.getElementById('portrait');
    this.portraitBox = document.getElementById('bb-portrait');
    this.portraitVid = document.getElementById('bb-portrait-vid');
    this.portraitVidSrc = null;   // currently loaded clip URL (avoid reloading each frame)
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
    // hover -> wide popup above the grid. Listen at DOCUMENT level: under
    // pointer lock the grid never receives 'mouseleave' (only synthetic
    // mousemoves routed to whatever is under the virtual cursor), so a
    // grid-local listener would leave the popup stuck open forever.
    document.addEventListener('mousemove', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('#bb-grid .slot') : null;
      const slot = el ? this.slots[Number(el.dataset.i)] : null;
      this.hover(slot && slot.data ? slot.data : null);
    });

    for (const [tab, btn] of Object.entries(this.tabBtns)) {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.tab = tab;
        this.mode = tab;
        this.refreshTabs();
      });
    }
    this.refreshTabs();

    // the curved one-piece background needs real layout sizes
    requestAnimationFrame(() => this.buildTrayBg());
    window.addEventListener('resize', () => this.buildTrayBg());
  }

  // Draw the bar's background as ONE silhouette: a low tray whose top edge
  // hugs the portrait/details panels, curving up with concave fillets around
  // the taller pods (minimap, command grid, tabs) and over their rounded
  // tops — instead of a straight edge cut behind them.
  buildTrayBg() {
    if (!this.bar || !this.bgPath) return;
    const bar = this.bar.getBoundingClientRect();
    if (!bar.width) return;
    const svg = document.getElementById('bb-bg');
    svg.setAttribute('viewBox', `0 0 ${bar.width} ${bar.height}`);
    const trayTop = bar.height - 140; // tray hugs the 124px panels + padding
    const raw = ['bb-map', 'bb-grid-wrap', 'bb-tabs']
      .map((id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x0: r.left - bar.left, x1: r.right - bar.left, y: r.top - bar.top };
      })
      .filter((p) => p && p.y < trayTop - 4)
      .sort((a, b) => a.x0 - b.x0);
    // neighbouring pods (e.g. the command grid and the UNITS/CLĂDIRI buttons)
    // merge into ONE raised block — no curve dipping between them
    const pods = [];
    for (const p of raw) {
      const prev = pods[pods.length - 1];
      if (prev && p.x0 - prev.x1 < 24) {
        prev.x1 = p.x1;
        prev.y = Math.min(prev.y, p.y);
      } else {
        pods.push({ ...p });
      }
    }
    const R = 14; // tray outer corner radius
    const r = 10; // pod top corner radius
    const f = 7;  // concave fillet where a pod meets the tray edge
    const H = bar.height;
    const W = bar.width;
    let d = `M0,${H} L0,${trayTop + R} Q0,${trayTop} ${R},${trayTop}`;
    for (const p of pods) {
      d += ` L${p.x0 - f},${trayTop} Q${p.x0},${trayTop} ${p.x0},${trayTop - f}`;
      d += ` L${p.x0},${p.y + r} Q${p.x0},${p.y} ${p.x0 + r},${p.y}`;
      d += ` L${p.x1 - r},${p.y} Q${p.x1},${p.y} ${p.x1},${p.y + r}`;
      d += ` L${p.x1},${trayTop - f} Q${p.x1},${trayTop} ${p.x1 + f},${trayTop}`;
    }
    d += ` L${W - R},${trayTop} Q${W},${trayTop} ${W},${trayTop + R} L${W},${H} Z`;
    this.bgPath.setAttribute('d', d);
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
    this.buildTrayBg();
    this.applyBarSkin();
  }

  // Per-race uploaded bar art, in two layers:
  //   - BACKGROUND ("skin"): fills the whole bar behind the UI; when present it
  //     hides the default curved silhouette (the design carries its own shape).
  //   - OVERLAY: drawn ON TOP of the UI (frames/ornaments that must sit over the
  //     slots); click-through so it never blocks the controls.
  applyBarSkin() {
    if (!this.bar) return;
    const skin = getBarSkin(raceOf(0));
    if (skin) {
      this.bar.style.backgroundImage = `url("${skin}")`;
      this.bar.style.backgroundSize = '100% 100%';
      this.bar.classList.add('skinned');
    } else {
      this.bar.style.backgroundImage = '';
      this.bar.classList.remove('skinned');
    }
    const over = getBarOverlay(raceOf(0));
    const overEl = document.getElementById('bb-over');
    if (overEl) overEl.style.backgroundImage = over ? `url("${over}")` : '';
    this.bar.classList.toggle('overlaid', !!over);
    // race tag so a per-race design can nudge details/status for its own frame
    this.bar.classList.toggle('race-orcs', raceOf(0) === 'orcs');
    this.bar.classList.toggle('race-humans', raceOf(0) === 'humans');
  }


  // While a shop item is held for placement, if the cursor sits over the bar
  // fade it to near-transparent and make it click-through, so you can drop the
  // unit/building on the spot the bar was covering. (winX/winY track the real
  // cursor, and the virtual one under pointer lock via bubbled synthetic moves.)
  updatePlacingFade() {
    if (!this.bar) return;
    let fade = false;
    if (this.uiState.selected) {
      const x = this.uiState.winX;
      const y = this.uiState.winY;
      if (x != null && y != null) {
        const r = this.bar.getBoundingClientRect();
        fade = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      }
    }
    this.bar.classList.toggle('placing', fade);
  }

  // ------------------------------------------------------------------ frame
  update(game) {
    this.updatePlacingFade();
    const sel = this.uiState.inspect;
    const info = this.resolveInspect(game);

    // A fresh click always stores a NEW inspect object (even when re-selecting
    // the SAME target), so detect selection by reference: a new object => open
    // its command card. Tab buttons change `mode` without touching
    // uiState.inspect, so clicking a tab and then re-clicking the same base
    // correctly re-opens the base's upgrades.
    if (sel && sel !== this.lastInspectRef) { this.mode = 'inspect'; this.bldgView = 'units'; }
    this.lastInspectRef = sel;
    // selection gone or stale (sold / died / clicked empty): back to the shop
    if (this.mode === 'inspect' && !info) this.mode = this.tab;

    this.refreshPanel(game, info);
    this.updateSellButton(game, info);

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
      const team = sel.team || 0; // enemy formations are inspectable read-only
      const tpl = game.templates[team][sel.index];
      if (!tpl) return null;
      return { kind: 'template', team, type: tpl.type, tpl };
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
    if (sel.kind === 'worker') {
      const s = game.structures.find((st) => st.id === sel.structId);
      if (!s || s.hp <= 0) return null;
      return { kind: 'worker', team: s.team, type: 'generator', s, w: sel.w };
    }
    return null;
  }

  buildSig(game, info) {
    const race = raceOf(0);
    let s = `${this.mode}:${race}:${resolvedUnitOrder(race).join(',')}`;
    if (!game) return s;
    s += `:t${game.tier[0]}`;
    // finished tech buildings gate which units the shop offers — fold them into
    // the signature so the units grid rebuilds the instant one finishes building
    // (otherwise you'd have to leave and re-enter the tab to see new units)
    if (this.mode === 'units' || this.mode === 'buildings') {
      const built = new Set();
      for (const st of game.structures)
        if (st.team === 0 && st.hp > 0 && !st.building) built.add(st.kind);
      s += `:b${[...built].sort().join(',')}`;
    }
    if (this.mode === 'inspect' && info) {
      const toggles = [...game.abilityOff[info.team]]
        .filter((k) => k.startsWith(`${info.type}/`)).sort().join(',');
      const upgs = [...game.upgrades[info.team]].sort().join(',') + '|' +
        [...game.upgradeOff[info.team]].sort().join(',');
      const spawned = info.kind === 'template' ? !!info.tpl.spawned : '';
      s += `:${info.kind}:${info.type}:${info.team}:t${game.tier[info.team]}:${toggles}:${upgs}:${spawned}:bv${this.bldgView}`;
    }
    return s;
  }

  // Vinde: the dedicated button under the tabs (bottom-right). Visible only
  // while the selection is the player's own sellable template / building;
  // shows the refund and issues the sell command on click.
  updateSellButton(game, info) {
    const btn = document.getElementById('bb-sell');
    if (!btn) return;
    if (!this.sellWired) {
      this.sellWired = true;
      btn.addEventListener('click', () => {
        const g = this.getGame();
        const sel = this.uiState.inspect;
        const s = this.sellable;
        if (!g || !sel || !s) return;
        if (s.what === 'unit') g.issueCommand({ type: 'sellUnit', team: 0, index: sel.index });
        else g.issueCommand({ type: 'sellBuilding', team: 0, id: sel.id });
        this.uiState.inspect = null;
      });
    }
    let sell = null;
    if (game && info && info.team === 0 && this.mode === 'inspect') {
      if (info.kind === 'template') {
        const stats = game.ustat(0, info.type);
        const full = !info.tpl.spawned;
        sell = { what: 'unit', cost: Math.round(stats.cost * (full ? 1 : CONFIG.SELL_REFUND)), full };
      } else if (info.kind === 'structure' && CONFIG.BUILDINGS[info.type]) {
        const stats = game.bstat(0, info.type);
        sell = { what: 'building', cost: Math.round(stats.cost * CONFIG.SELL_BUILDING_REFUND) };
      }
    }
    this.sellable = sell;
    btn.classList.toggle('hidden', !sell);
    if (sell) {
      const cost = document.getElementById('bb-sell-cost');
      if (cost) cost.textContent = `Vinde ◆ ${sell.cost}`;
      btn.title = sell.what === 'unit'
        ? `Vinde acest șablon de unitate — primești ◆ ${sell.cost}${sell.full ? ' (100%, nespawnat)' : ''}`
        : `Vinde această clădire — primești ◆ ${sell.cost}`;
    }
  }

  // ------------------------------------------------------ portrait + details
  refreshPanel(game, info) {
    const ctx = this.portrait.getContext('2d');
    ctx.clearRect(0, 0, 112, 112);
    if (!info || !game) {
      this.setPortraitVideo(null);
      this.details.innerHTML = '<div class="bb-empty">Selectează o unitate sau o clădire.</div>';
      return;
    }
    // a selected gold-miner: its own idle clip in the portrait, a short blurb
    // in the details (workers are cosmetic — no sim stats to show)
    if (info.kind === 'worker') {
      const race = raceOf(info.team);
      const vid = getMineVideoUrl(race, 'workeridle');
      this.setPortraitVideo(vid);
      if (!vid) {
        const entry = getSprite(race, 'generator', 'worker-full', 0) || getSprite(race, 'generator', 'worker-empty', 0);
        if (entry && entry.img) {
          const im = entry.img; const s = 90 / Math.max(im.width, im.height);
          ctx.drawImage(im, 56 - (im.width * s) / 2, 56 - (im.height * s) / 2, im.width * s, im.height * s);
        }
      }
      const own = info.team === 0;
      const inc = game.bstat(info.team, 'generator').income;
      this.details.innerHTML = `
        <div class="d-title"><span class="d-name ${own ? '' : 'enemy'}">Muncitor</span><span class="d-sub">Miner${own ? '' : ' · INAMIC'}</span></div>
        <div class="d-stats"><span>⛏ cară aur la bază</span>${inc ? `<span>◆ +<b>${inc}</b> aur/20s</span>` : ''}</div>`;
      return;
    }
    // an uploaded idle clip (mp4/webm) takes over the portrait box; otherwise
    // fall back to the sprite/vector portrait drawn on the canvas. A split
    // rider (on foot) / beast plays its OWN clip when one was uploaded. The
    // gold mine plays its map clip (mineidle) in the portrait too.
    const form = info.kind === 'entity' && info.u.summon ? info.u.summonKind
      : info.kind === 'entity' && info.u.beast ? 'beast'
      : info.kind === 'entity' && info.u.dismounted ? 'foot' : 'base';
    const vid = info.kind === 'structure' && info.type === 'generator'
      ? (getMineVideoUrl(raceOf(info.team), 'mineidle') || getPortraitVideoUrl(raceOf(info.team), info.type, form))
      : info.kind === 'structure' && info.type === 'tower'
        ? (getTowerVideoUrl(raceOf(info.team), game.tier[info.team]) || getPortraitVideoUrl(raceOf(info.team), info.type, form))
        : getPortraitVideoUrl(raceOf(info.team), info.type, form);
    this.setPortraitVideo(vid);
    if (!vid) this.drawPortrait(ctx, game, info);

    const own = info.team === 0;
    const isStruct = info.kind === 'structure';
    // a summoned animal shows its OWN stats (its type only hosts sprites)
    const stats = isStruct ? game.bstat(info.team, info.type)
      : info.kind === 'entity' ? game.ustatOf(info.u)
      : game.ustat(info.team, info.type);
    const name = stats.name || info.type;
    let sub;
    if (isStruct) {
      sub = info.type === 'main'
        ? `Tier ${'I'.repeat(game.tier[info.team])}`
        : info.type === 'tower'
          ? `Clădire · Tier ${'I'.repeat(Math.max(1, game.tier[info.team]))}${stats.cost ? ` · ◆ ${stats.cost}` : ''}`
          : `Clădire${stats.cost ? ` · ◆ ${stats.cost}` : ''}`;
    } else if (info.kind === 'entity' && info.u.summon) {
      sub = 'Animal invocat';
    } else {
      // units: no "Tier X · ◆ cost" subtitle — the stats sit in the emoji line
      sub = info.kind === 'template' && !info.tpl.spawned ? 'nou (100% la vânzare)' : '';
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
      // units: the same clean emoji line as the shop popup (cost/HP/damage/
      // armor/damage-type + Hits air / Caster) — no DPS / Tier / speed / range
      rows.push(...unitStatBits(stats));
    } else {
      // towers scale their damage AND attack period with the owner's base tier
      const tst = info.type === 'tower' ? towerStatForTier(stats, game.tier[info.team]) : null;
      const dmg = tst ? tst.damage : stats.damage;
      const per = tst ? tst.period : stats.period;
      if (dmg) rows.push(`⚔ <b>${dmg}</b> · <b>${(dmg / Math.max(0.1, per || 1)).toFixed(1)}</b> DPS`, `➹ <b>${stats.range}</b>`);
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
    // hero: a level line + XP bar toward the next level (and unspent talent pts)
    let heroBar = '';
    if (info.kind === 'entity' && info.u.hero) {
      const tpl = game.heroTemplate(info.team);
      if (tpl) {
        const lvl = tpl.level || 1;
        const need = (stats.levelXp || [])[lvl - 1] || 0;
        const pct = lvl >= 10 || !need ? 100 : Math.max(0, ((tpl.xp || 0) / need) * 100);
        const label = lvl >= 10 ? 'MAX' : `${Math.floor(tpl.xp || 0)} / ${need} XP`;
        const pts = tpl.points ? `<span class="d-chip" style="border-color:#ffd35c;color:#ffd35c">★ ${tpl.points} punct${tpl.points > 1 ? 'e' : ''}</span>` : '';
        heroBar = `<div class="d-sub" style="margin:2px 0">Nivel ${lvl}${own ? '' : ''} ${pts}</div>
          <div class="d-bar"><div class="mana" style="width:${pct}%;background:#ffd35c"></div><span>${label}</span></div>`;
      }
    }
    this.details.innerHTML = `
      <div class="d-title"><span class="d-name ${own ? '' : 'enemy'}">${name}</span><span class="d-sub">${sub}${own ? '' : ' · INAMIC'}</span></div>
      <div class="d-bar"><div class="hp ${own ? '' : 'enemy'}" style="width:${Math.max(0, (hp / maxHp) * 100)}%"></div><span>${Math.ceil(hp)} / ${Math.ceil(maxHp)}</span></div>
      ${manaBar}
      ${heroBar}
      <div class="d-stats">${rows.map((r) => `<span>${r}</span>`).join('')}</div>
      <div class="d-status">${chips}</div>`;
  }

  // Show/hide the looping idle clip over the portrait canvas. Only reloads the
  // <video> when the clip URL actually changes (selection switched units).
  setPortraitVideo(url) {
    if (!this.portraitVid || !this.portraitBox) return;
    if (url === this.portraitVidSrc) return;
    this.portraitVidSrc = url;
    if (url) {
      this.portraitVid.src = url;
      this.portraitBox.classList.add('has-vid');
      const p = this.portraitVid.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      this.portraitBox.classList.remove('has-vid');
      this.portraitVid.pause();
      this.portraitVid.removeAttribute('src');
      this.portraitVid.load();
    }
  }

  drawPortrait(ctx, game, info) {
    const race = raceOf(info.team);
    const frame = Math.floor(performance.now() / 500) % 2;
    // a split beast / rider on foot shows its own art: form idle sprite, then
    // form thumbnail, then the whole unit's idle sprite / thumb, then vectors
    const form = info.kind === 'entity' && info.u.summon ? info.u.summonKind
      : info.kind === 'entity' && info.u.beast ? 'beast'
      : info.kind === 'entity' && info.u.dismounted ? 'foot' : 'base';
    // Buildings show their STATIC thumbnail in the portrait (not the flipping
    // idle 1↔2 animation). Fall through to idle/vector only if no thumb exists.
    if (info.kind === 'structure') {
      ctx.save();
      ctx.translate(56, 58);
      if (drawThumb(ctx, info.type, info.team, 96, form)) { ctx.restore(); return; }
      ctx.restore();
    }
    let entry = null;
    if (form !== 'base') {
      // form idle, then walk/attack (summoned animals have no idle frame)
      for (const a of [`${form}-idle`, `${form}-walk`, `${form}-attack`]) {
        entry = getSprite(race, info.type, a, frame) || getSprite(race, info.type, a, 0);
        if (entry) break;
      }
      if (!entry) {
        const ft = getThumb(race, info.type, form);
        if (ft && ft !== getThumb(race, info.type)) entry = ft; // the form's OWN thumb only
      }
    }
    entry = entry || getSprite(race, info.type, 'idle', frame) || getSprite(race, info.type, 'idle', 0);
    if (entry && entry.img) {
      const img = entry.img;
      const s = Math.min(102 / img.width, 102 / img.height);
      ctx.drawImage(img, (112 - img.width * s) / 2, (112 - img.height * s) / 2, img.width * s, img.height * s);
      return;
    }
    ctx.save();
    ctx.translate(56, 58);
    if (drawThumb(ctx, info.type, info.team, 96, form)) { ctx.restore(); return; }
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
    this.hover(null); // the hovered slot may no longer exist / changed meaning
    const items = this.mode === 'inspect'
      ? this.inspectItems(game, info)
      : this.mode === 'buildings'
        ? this.buildingItems()
        : this.unitItems(game);

    for (let i = 0; i < 9; i++) {
      const slot = this.slots[i];
      const data = items[i] || null;
      slot.data = data;
      slot.el.className = 'slot' + (data ? '' : ' empty');
      slot.el.innerHTML = '';
      if (!data) continue;
      // icon — supersample the backing store so icons stay crisp on high-DPR
      // screens and when the bottom bar is zoomed (1.2×–1.6×). CSS keeps it 46px.
      const SS = this.iconSS || (this.iconSS =
        Math.min(4, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 1.6))));
      const cv = document.createElement('canvas');
      cv.width = 46 * SS; cv.height = 46 * SS;
      slot.el.appendChild(cv);
      const ictx = cv.getContext('2d');
      ictx.scale(SS, SS); // drawing code stays in 46-unit space
      this.drawSlotIcon(ictx, data, game);
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

  unitItems(game) {
    const race = raceOf(0);
    // only units whose tech building is built (unassigned units always show);
    // tier-gating still shows as a lock badge in the grid
    const shown = resolvedUnitOrder(race)
      .filter((id) => {
        const b = (statsUnit(race, id) || {}).building;
        return !b || !game || game.hasBuilding(0, b);
      })
      .map((id) => {
        const u = statsUnit(race, id);
        return { kind: 'unit', id, cost: u.cost, slot: Number.isInteger(u.slot) ? u.slot : -1 };
      });
    // place each unit at its admin-chosen cell (Poziție grilă, 0-8); the rest
    // auto-fill the first free cells. Hotkey = the cell number (1-9).
    const grid = new Array(9).fill(null);
    const auto = [];
    for (const it of shown) {
      if (it.slot >= 0 && it.slot <= 8 && grid[it.slot] == null) grid[it.slot] = it;
      else auto.push(it);
    }
    for (let i = 0; i <= 8 && auto.length; i++) if (grid[i] == null) grid[i] = auto.shift();
    for (let i = 0; i < 9; i++) if (grid[i]) grid[i].hotkey = String(i + 1);
    return grid;
  }

  buildingItems() {
    const race = raceOf(0);
    // the base tier upgrade now lives on the Main Base selection, not here.
    // Each building may carry an admin-chosen grid cell (slot 0-8, -1 = auto),
    // laid out exactly like the unit cards in a tech building.
    const cards = BUILDING_CARDS.map((b) => {
      const bs = statsBuilding(race, b.id);
      return { kind: 'building', id: b.id, cost: bs.cost, hotkey: b.hotkey,
        slot: Number.isInteger(bs.slot) ? bs.slot : -1 };
    });
    const grid = new Array(9).fill(null);
    const auto = [];
    for (const it of cards) {
      if (it.slot >= 0 && it.slot <= 8 && grid[it.slot] == null) grid[it.slot] = it;
      else auto.push(it);
    }
    for (let i = 0; i <= 8 && auto.length; i++) if (grid[i] == null) grid[i] = auto.shift();
    return grid;
  }

  inspectItems(game, info) {
    if (!info || !game || info.kind === 'worker') return [];
    const items = [];
    const own = info.team === 0;
    const isStruct = info.kind === 'structure';
    const stats = isStruct ? game.bstat(info.team, info.type) : game.ustat(info.team, info.type);

    // your own Main Base: the tier upgrade + the Hero (one per team, bought here
    // and placed like a unit; units + their upgrades live in the tech buildings)
    if (own && isStruct && info.type === 'main') {
      // the tier upgrade is ALWAYS the last cell; the hero fills from the front
      const grid = new Array(9).fill(null);
      grid[8] = { kind: 'upgradeBase', id: 'upgrade' };
      const race = raceOf(0);
      const hero = resolvedHeroId(race);
      if (hero) {
        const h = statsUnit(race, hero);
        grid[0] = { kind: 'unit', id: hero, cost: h.cost, tier: h.tier, isHero: true };
      }
      return grid;
    }

    // your own tech building: units and their upgrades live on SEPARATE pages
    // so they don't crowd the same grid. Default page = units; a ⬆ toggle
    // switches to the upgrades page (⬇ toggles back). A unit still needs the
    // base at its tier.
    if (own && isStruct && TECH_BUILDINGS.includes(info.type)) {
      const race = raceOf(0);
      const myUnits = resolvedUnitOrder(race).filter((id) => (statsUnit(race, id) || {}).building === info.type);
      const upgrades = [];
      for (const uid of myUnits) {
        for (const id of UPGRADE_IDS) {
          const up = resolvedUpgrade(id);
          if (up && up.unit === uid && (!up.race || up.race === race)) {
            upgrades.push({ kind: 'buyUpgrade', id, cost: up.params.cost || 0, tier: (statsUnit(race, uid) || {}).tier || 1, slot: Number.isInteger(up.slot) ? up.slot : -1 });
          }
        }
      }
      const onUpg = this.bldgView === 'upgrades';
      const page = onUpg
        ? upgrades
        : myUnits.map((id) => {
            const u = statsUnit(race, id);
            return { kind: 'unit', id, cost: u.cost, tier: u.tier, slot: Number.isInteger(u.slot) ? u.slot : -1 };
          });
      // Fixed cells: sell at slot 7, the ⬆/⬇ toggle at slot 8. The units /
      // upgrades occupy cells 0..6 at their admin-chosen slot (or auto-fill the
      // first free cell when slot is -1).
      const toggle = upgrades.length ? { kind: 'bldgView', to: onUpg ? 'units' : 'upgrades' } : null;
      return layoutCardPage(page, toggle);
    }

    // your own hero: its 3 skills + ultimate, each rankable with talent points
    if (!isStruct && own && stats.isHero) {
      for (const slot of heroAbilitySlots(raceOf(0))) {
        if (slot.id) items.push({ kind: 'heroAbility', id: slot.id, ult: slot.ult });
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
    return items;
  }

  // small star in the corner marking the ultimate slot
  drawUltMark(ctx) {
    ctx.fillStyle = '#ffd35c';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('★', 2, 1);
  }

  drawSlotIcon(ctx, data, game) {
    ctx.clearRect(0, 0, 46, 46);
    if (data.kind === 'unit' || data.kind === 'building') {
      ctx.save();
      ctx.translate(23, 24);
      if (drawThumb(ctx, data.id, 0, 42)) { ctx.restore(); return; }
      ctx.restore();
      if (data.kind === 'unit' && hasCharacter(data.id)) {
        ctx.save();
        ctx.translate(23, 24);
        const u = statsUnit(raceOf(0), data.id);
        drawCharacter(ctx, data.id, 'idle', 0, 0, Math.min(1.6, 38 / (u.radius * 2.8 + 4)));
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.translate(23, 23);
      if (data.kind === 'building') {
        ctx.fillStyle = '#2d3a4f';
        ctx.fillRect(-15, -15, 30, 30);
        ctx.strokeStyle = TEAM_COLORS[0];
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-15, -15, 30, 30);
        if (data.id === 'tower') { ctx.fillStyle = TEAM_COLORS[0]; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); }
        if (data.id === 'generator') { ctx.fillStyle = '#ffd35c'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill(); }
        if (data.id === 'farm') { ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🌾', 0, 1); }
      } else {
        const u = statsUnit(raceOf(0), data.id);
        ctx.fillStyle = TEAM_COLORS[0];
        if (u.shape === 'ring') { ctx.strokeStyle = TEAM_COLORS[0]; ctx.lineWidth = 3.5; drawShape(ctx, 'ring', 16); ctx.stroke(); }
        else { drawShape(ctx, u.shape, 16); ctx.fill(); }
      }
      ctx.restore();
      return;
    }
    if (data.kind === 'upgradeBase') {
      const img = getBaseUpgradeIcon(raceOf(0));
      if (img) {
        const sc = Math.min(46 / img.width, 46 / img.height);
        ctx.drawImage(img, (46 - img.width * sc) / 2, (46 - img.height * sc) / 2, img.width * sc, img.height * sc);
        return;
      }
      ctx.fillStyle = '#ffd35c';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▲', 23, 24);
      return;
    }
    if (data.kind === 'ability' || data.kind === 'upgrade' || data.kind === 'buyUpgrade' || data.kind === 'heroAbility') {
      const isAb = data.kind === 'ability' || data.kind === 'heroAbility';
      const img = getUiIcon(`${isAb ? 'ability' : 'upgrade'}-${data.id}`);
      if (img) {
        const s = Math.min(46 / img.width, 46 / img.height);
        ctx.drawImage(img, (46 - img.width * s) / 2, (46 - img.height * s) / 2, img.width * s, img.height * s);
        if (data.ult) this.drawUltMark(ctx);
        return;
      }
      // fallback: colored disc + initial (ability) / boar glyph (upgrade)
      if (isAb) {
        const ab = resolvedAbility(data.id);
        ctx.fillStyle = (ab && ab.color) || '#8fa3c0';
        ctx.beginPath();
        ctx.arc(23, 23, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0a0e14';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(((ab && ab.name) || data.id)[0].toUpperCase(), 23, 24);
        if (data.ult) this.drawUltMark(ctx);
      } else {
        ctx.font = '27px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🐗', 23, 24);
      }
      return;
    }
    if (data.kind === 'sell') {
      const img = getUiIcon('sell');
      if (img) {
        const s = Math.min(46 / img.width, 46 / img.height);
        ctx.drawImage(img, (46 - img.width * s) / 2, (46 - img.height * s) / 2, img.width * s, img.height * s);
        return;
      }
      ctx.font = '25px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💰', 23, 24);
      return;
    }
    if (data.kind === 'bldgView') {
      const toUpg = data.to === 'upgrades';
      const img = getUiIcon(toUpg ? 'bldg-upgrades' : 'bldg-units');
      if (img) {
        const s = Math.min(46 / img.width, 46 / img.height);
        ctx.drawImage(img, (46 - img.width * s) / 2, (46 - img.height * s) / 2, img.width * s, img.height * s);
        return;
      }
      ctx.fillStyle = '#ffd35c';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(toUpg ? '⬆' : '⬇', 23, 15);
      ctx.fillStyle = '#cfe0f5';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(toUpg ? 'UPGRADE' : 'UNITĂȚI', 23, 36);
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
      let cdTotal = 0; // full cooldown length (for the radial sweep overlay)
      if (d.kind === 'unit') {
        el.classList.toggle('selected', this.uiState.selected === d.id);
        if (game) {
          const u = game.ustat(0, d.id);
          const heroWait = d.isHero ? (CONFIG.HERO_UNLOCK_TIME || 0) - game.time : 0;
          if (u.tier > game.tier[0]) { el.classList.add('locked'); this.setLockTier(el, u.tier); }
          else if (heroWait > 0) {
            // hero still time-locked (⚙ Balance): radial countdown on the card
            el.classList.add('disabled');
            cd = heroWait;
            cdTotal = CONFIG.HERO_UNLOCK_TIME || 0;
          }
          else if (d.isHero && game.hasHero(0)) el.classList.add('disabled'); // one hero per team
          else if (game.money[0] < u.cost) el.classList.add('disabled');
          else if (game.foodUsed(0) + (u.food || 0) > game.foodCap(0)) el.classList.add('disabled'); // over food cap
        }
      } else if (d.kind === 'building') {
        el.classList.toggle('selected', this.uiState.selected === d.id);
        if (game) {
          const bs = game.bstat(0, d.id);
          const price = game.buildCost(0, d.id); // mines get pricier each time
          if (game.tier[0] < (bs.tier || 1)) { el.classList.add('locked'); this.setLockTier(el, bs.tier); }
          else if (game.countKind(0, d.id) >= bs.cap) el.classList.add('disabled');
          else if (game.money[0] < price) el.classList.add('disabled');
          cd = game.buildCdLeft(0, d.id);
          const c = el.querySelector('.s-cost');
          if (c && c.textContent !== String(price)) c.textContent = price;
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
          cdTotal = (ab && ab.params.cooldown) || 0;
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
        } else if (d.tier && d.tier > game.tier[0]) {
          el.classList.add('locked'); this.setLockTier(el, d.tier); // needs the unit's tier
        } else if (game.money[0] < d.cost) {
          el.classList.add('disabled');
        }
      } else if (d.kind === 'heroAbility' && game) {
        const tpl = game.heroTemplate(0);
        const rank = (tpl && tpl.ranks && tpl.ranks[d.id]) || 0;
        const max = d.ult ? 1 : 3;
        const pts = (tpl && tpl.points) || 0;
        const lvl = (tpl && tpl.level) || 1;
        this.setRankBadge(el, `${rank}/${max}`);
        if (d.ult && lvl < 6) el.classList.add('locked');       // ultimate needs level 6
        else if (rank >= max) el.classList.add('owned-upg');    // maxed out
        else if (pts > 0) el.classList.add('on');               // a point is available
        else el.classList.add('off');                           // learned but no point
        // live cooldown sweep when the inspected target is the LIVE hero
        if (rank > 0 && info && info.kind === 'entity' && info.u.hero && info.u.abilityCd) {
          cd = (info.u.abilityCd[d.id] || 0) - game.time;
          const ab = resolvedAbility(d.id);
          cdTotal = (ab && ab.params.cooldown) || 0;
        }
      } else if (d.kind === 'sell') {
        el.classList.add('sell');
      }
      // cooldown overlay: WC3-style radial sweep (the dark wedge covers the
      // REMAINING fraction and unwinds clockwise) + seconds left in the middle
      let cdEl = el.querySelector('.s-cd');
      if (cd > 0.05) {
        if (!cdEl) {
          cdEl = document.createElement('span');
          cdEl.className = 's-cd';
          el.appendChild(cdEl);
        }
        cdEl.textContent = `${Math.ceil(cd)}`;
        if (cdTotal > 0) {
          const frac = Math.max(0, Math.min(1, cd / cdTotal));
          cdEl.style.background =
            `conic-gradient(rgba(0,0,0,0.68) ${(frac * 100).toFixed(1)}%, rgba(0,0,0,0.18) 0)`;
        } else {
          cdEl.style.background = 'rgba(0,0,0,0.55)';
        }
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

  setRankBadge(el, text) {
    let r = el.querySelector('.s-cost');
    if (!r) { r = document.createElement('span'); r.className = 's-cost'; el.appendChild(r); }
    r.textContent = text;
  }

  clickSlot(d, el) {
    const game = this.getGame();
    if (d.kind === 'unit' || d.kind === 'building') {
      if (el.classList.contains('locked')) return;
      if (d.isHero && game && game.hasHero(0)) return; // already have your hero
      this.onShopClick(d.id);
      return;
    }
    if (d.kind === 'upgradeBase') {
      this.onShopClick('upgrade');
      return;
    }
    if (d.kind === 'bldgView') {
      this.bldgView = d.to;
      this.sig = null; // force the grid to rebuild for the new page
      return;
    }
    if (!game) return;
    if (d.kind === 'heroAbility') {
      game.issueCommand({ type: 'rankHero', team: 0, ability: d.id });
      return;
    }
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
      // name → editable description → a clean emoji stat line
      return `<div class="p-title">${u.name}</div>
        <div>${u.tip || ''}</div>
        <div class="p-dim">${unitStatBits(u).join(' · ')}</div>`;
    }
    if (d.kind === 'building') {
      const b = BUILDING_CARDS.find((x) => x.id === d.id);
      const s = statsBuilding(race, d.id);
      let unlocks = '';
      if (TECH_BUILDINGS.includes(d.id)) {
        const names = resolvedUnitOrder(race)
          .filter((id) => (statsUnit(race, id) || {}).building === d.id)
          .map((id) => (statsUnit(race, id) || {}).name || id);
        unlocks = names.length
          ? `<div class="p-dim">Deblochează: ${names.join(', ')}</div>`
          : '<div class="p-dim">(nicio unitate asignată — vezi /admin)</div>';
      }
      const req = s.tier || 1;
      const tierNote = req > 1
        ? (game && game.tier[0] < req
            ? `<div class="p-dim" style="color:#ff9a6a">Se construiește de la Tier ${'I'.repeat(req)}</div>`
            : `<div class="p-dim">Necesită Tier ${'I'.repeat(req)}</div>`)
        : '';
      // name → editable description → a clean emoji stat line (cost lives on the
      // card thumbnail badge now, not here)
      const bits = [`${s.hp} ❤️`];
      if (d.id === 'tower') bits.push(`${s.damage} ⚔️`);
      if (d.id === 'generator') bits.push(`+${s.income} aur/20s`);
      if (d.id === 'generator' && (s.costStep || 0) > 0) bits.push(`+${s.costStep}/mină`);
      if (d.id === 'farm') bits.push(`+${s.food} food`);
      return `<div class="p-title">${buildingNameOf(race, d.id)}</div>
        <div>${s.tip || (b ? b.tip : '')}</div>
        ${unlocks}
        ${tierNote}
        <div class="p-dim">${bits.join(' · ')}</div>`;
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
      const ustats = statsUnit(up.race || race, up.unit) || {};
      const uname = ustats.name || up.unit;
      const unitTier = ustats.tier || 1;
      const tierLocked = !owned && d.kind === 'buyUpgrade' && game && unitTier > game.tier[0];
      const state = owned
        ? (off ? 'DEZACTIVAT' : 'ACTIV')
        : tierLocked
          ? `blocat — necesită Tier ${'I'.repeat(unitTier)}`
          : d.kind === 'buyUpgrade'
            ? `◆ ${up.params.cost || 0} — click pentru a cumpăra`
            : `necumpărat — ◆ ${up.params.cost || 0} din Bază`;
      return `<div class="p-title">🐗 ${up.name} — ${state}</div>
        <div>${up.desc || ''}</div>
        <div class="p-dim">Unitate: ${uname} (Tier ${'I'.repeat(unitTier)})</div>
        ${owned && (d.own || d.kind === 'buyUpgrade') ? '<div class="p-dim">Click: activează/dezactivează.</div>' : ''}`;
    }
    if (d.kind === 'heroAbility') {
      const ab = resolvedAbility(d.id);
      if (!ab) return '';
      const tpl = game && game.heroTemplate(0);
      const rank = (tpl && tpl.ranks && tpl.ranks[d.id]) || 0;
      const max = d.ult ? 1 : 3;
      const lvl = (tpl && tpl.level) || 1;
      const pts = (tpl && tpl.points) || 0;
      let status;
      if (d.ult && lvl < 6) status = 'Ultima — se deblochează la nivel 6';
      else if (rank >= max) status = `Rang MAXIM (${rank}/${max})`;
      else if (pts > 0) status = `Rang ${rank}/${max} — click pentru +1 rang (${pts} pct.)`;
      else status = `Rang ${rank}/${max} — n-ai puncte de talent`;
      return `<div class="p-title" style="color:${ab.color || '#ffd35c'}">${d.ult ? '★ ' : ''}${ab.name}</div>
        <div>${ab.desc || ''}</div>
        <div class="p-dim">${status}</div>
        <div class="p-dim">Efectul crește cu rangul.</div>`;
    }
    if (d.kind === 'sell') {
      return `<div class="p-title">Vinde — ◆ ${d.cost}${d.full ? ' (100%, nespawnat)' : ''}</div>
        <div class="p-dim">${d.what === 'unit' ? 'Vinde acest șablon de unitate.' : 'Vinde această clădire.'}</div>`;
    }
    if (d.kind === 'bldgView') {
      return d.to === 'upgrades'
        ? `<div class="p-title">⬆ Upgrade-uri</div><div>Arată upgrade-urile unităților acestei clădiri.</div>`
        : `<div class="p-title">⬇ Unități</div><div>Înapoi la unitățile clădirii.</div>`;
    }
    return '';
  }
}
