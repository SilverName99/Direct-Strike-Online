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
import { t, pickText } from '../i18n.js';
import { cellKeyLabel } from './hotkeys.js';
import { UNIT_IDS } from '../units.js';
import { UPGRADE_IDS, ABILITY_UNLOCK_UPGRADE } from '../upgrades.js';
import {
  statsUnit, statsBuilding, buildingNameOf, resolvedUnitOrder,
  resolvedAbility, resolvedUpgrade, towerStatForTier, TECH_BUILDINGS, resolvedHeroId, resolvedHeroIds, heroAbilitySlots,
} from './balance.js';
import { raceOf, sideOfPlayer, getSprite, getThumb, getUiIcon, getTabIcon, getBaseUpgradeIcon, getBarSkin, getBarOverlay, getPortraitVideoUrl, getMineVideoUrl, getTowerVideoUrl } from '../render/sprites.js';
import { hasCharacter, drawCharacter, drawThumb } from '../render/characters.js';
import { TEAM_COLORS, drawShape } from '../render/renderer.js';
import { effStats } from '../sim/combat.js';
import { usesSouls } from '../sim/entity.js';

// A hero ability the player can actively use (cast / summon), as opposed to a
// passive/aura that's always on. Only active ones get Manual mode + the
// ready-to-use highlight; passives can only be On (Auto) or Off.
function isActiveAbility(aid) {
  const ab = resolvedAbility(aid);
  return !!ab && (ab.kind === 'active' || ab.kind === 'castaura' || ab.kind === 'summon');
}

const BUILDING_CARDS = [
  { id: 'wall', role: 'Blochează unitățile terestre',
    tip: 'Barieră ieftină — inamicii trebuie să o spargă sau să o ocolească. Zburătorii trec peste.' },
  { id: 'tower', role: 'Turn defensiv',
    tip: 'Trage în sol și aer. Apără zona de construcție.' },
  { id: 'generator', role: 'Clădire economică',
    tip: 'Fiecare adaugă aur în plus la fiecare 20s. Poate fi distrus — protejează-ți economia!' },
  { id: 'bldg1', role: 'Deblochează unități',
    tip: 'Construiește-o ca să poți cumpăra unitățile ei. Click pe ea pentru unități + upgrade-uri. Distrusă = pierzi accesul.' },
  { id: 'bldg2', role: 'Deblochează unități',
    tip: 'Construiește-o ca să poți cumpăra unitățile ei. Click pe ea pentru unități + upgrade-uri. Distrusă = pierzi accesul.' },
  { id: 'bldg3', role: 'Deblochează unități',
    tip: 'Construiește-o ca să poți cumpăra unitățile ei. Click pe ea pentru unități + upgrade-uri. Distrusă = pierzi accesul.' },
  { id: 'farm', role: 'Mărește food cap',
    tip: 'Fiecare fermă crește plafonul de food, ca să poți plasa mai multe unități. Distrusă = pierzi plafonul (unitățile plasate rămân).' },
  { id: 'herohall', role: 'Recrutează eroi',
    tip: 'Click pe ea ca să recrutezi eroi (până la 3). Al 2-lea erou se deblochează la tier 2, al 3-lea la tier 3. Distrusă = nu mai poți recruta (eroii plasați rămân).' },
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
  // food consumed, right after the damage (summoned/foodless units skip it)
  if (s.food) bits.push(`${s.food} 🍖`);
  if (s.armor) bits.push(`${s.armor} 🛡️`);
  if (s.dmgType) bits.push(`${s.dmgType} 🗡️`);
  if (s.targetsAir) bits.push(t('Hits air'));
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
    // the team this bar commands: 0 in single player, assigned online
    Object.defineProperty(this, 'team', { get: () => this.uiState.myTeam || 0 });
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
      if (slot && slot.data) this.clickSlot(slot.data, el, e.button);
    });
    // right-click is a game control (cycle a hero ability's mode), not the OS menu
    this.grid.addEventListener('contextmenu', (e) => e.preventDefault());
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
      const img = getTabIcon(raceOf(this.team), tab);
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
    const skin = getBarSkin(raceOf(this.team));
    if (skin) {
      this.bar.style.backgroundImage = `url("${skin}")`;
      this.bar.style.backgroundSize = '100% 100%';
      this.bar.classList.add('skinned');
    } else {
      this.bar.style.backgroundImage = '';
      this.bar.classList.remove('skinned');
    }
    const over = getBarOverlay(raceOf(this.team));
    const overEl = document.getElementById('bb-over');
    if (overEl) overEl.style.backgroundImage = over ? `url("${over}")` : '';
    this.bar.classList.toggle('overlaid', !!over);
    // race tag so a per-race design can nudge details/status for its own frame
    this.bar.classList.toggle('race-orcs', raceOf(this.team) === 'orcs');
    this.bar.classList.toggle('race-humans', raceOf(this.team) === 'humans');
    this.bar.classList.toggle('race-undead', raceOf(this.team) === 'undead');
  }


  // While a shop item is held for placement, if the cursor sits over the bar
  // fade it to near-transparent and make it click-through, so you can drop the
  // unit/building on the spot the bar was covering. (winX/winY track the real
  // cursor, and the virtual one under pointer lock via bubbled synthetic moves.)
  updatePlacingFade() {
    if (!this.bar) return;
    let fade = false;
    // fade while placing a NEW unit (selected) OR dragging an existing one to a
    // new spot — both need to drop where the bar might be covering.
    if (this.uiState.selected || this.uiState.drag) {
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
    this.updateMoveButton(game, info);

    const sig = this.buildSig(game, info);
    if (sig !== this.sig) {
      this.sig = sig;
      this.rebuildGrid(game, info);
      this.refreshTabs();
    }
    this.refreshGridLive(game, info);
  }

  // `team` is always the owning PLAYER (per-player stats: tier, upgrades,
  // ability toggles, hero templates, ownership) and `side` the battlefield
  // SIDE (art/race/tint). In 1v1 they coincide; in team modes an ally's
  // building is side 0 like mine but a DIFFERENT player, so the two must not
  // be conflated (that made ally buildings look like my own).
  resolveInspect(game) {
    const sel = this.uiState.inspect;
    if (!sel || !game) return null;
    const sideOf = (p) => (game.sideOf ? game.sideOf(p) : p);
    if (sel.kind === 'template') {
      // viewer's own formation by default; other players pass their index
      const team = sel.team != null ? sel.team : this.team;
      const tpl = game.templates[team] && game.templates[team][sel.index];
      if (!tpl) return null;
      return { kind: 'template', team, side: sideOf(team), type: tpl.type, tpl };
    }
    if (sel.kind === 'entity') {
      const u = game.byId.get(sel.id);
      if (!u || u.hp <= 0) return null;
      return { kind: 'entity', team: u.owner != null ? u.owner : u.team, side: u.team, type: u.type, u };
    }
    if (sel.kind === 'structure') {
      const s = game.structures.find((st) => st.id === sel.id);
      if (!s || (s.hp <= 0 && s.kind !== 'main')) return null;
      return { kind: 'structure', team: s.owner != null ? s.owner : s.team, side: s.team, type: s.kind, s };
    }
    if (sel.kind === 'worker') {
      const s = game.structures.find((st) => st.id === sel.structId);
      if (!s || s.hp <= 0) return null;
      return { kind: 'worker', team: s.owner != null ? s.owner : s.team, side: s.team, type: 'generator', s, w: sel.w };
    }
    return null;
  }

  buildSig(game, info) {
    const race = raceOf(this.team);
    let s = `${this.mode}:${race}:${resolvedUnitOrder(race).join(',')}`;
    if (!game) return s;
    s += `:t${game.tier[this.team]}`;
    // finished tech buildings gate which units the shop offers — fold them into
    // the signature so the units grid rebuilds the instant one finishes building
    // (otherwise you'd have to leave and re-enter the tab to see new units)
    if (this.mode === 'units' || this.mode === 'buildings') {
      const built = new Set();
      for (const st of game.structures)
        if (st.team === this.team && st.hp > 0 && !st.building) built.add(st.kind);
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
        if (s.what === 'unit') g.issueCommand({ type: 'sellUnit', team: this.team, index: sel.index });
        else g.issueCommand({ type: 'sellBuilding', team: this.team, id: sel.id });
        this.uiState.inspect = null;
      });
    }
    let sell = null;
    if (game && info && info.team === this.team && this.mode === 'inspect') {
      if (info.kind === 'template') {
        const stats = game.ustat(this.team, info.type);
        const full = !info.tpl.spawned;
        sell = { what: 'unit', cost: Math.round(stats.cost * (full ? 1 : CONFIG.SELL_REFUND)), full };
      } else if (info.kind === 'structure' && CONFIG.BUILDINGS[info.type]) {
        const stats = game.bstat(this.team, info.type);
        sell = { what: 'building', cost: Math.round(stats.cost * CONFIG.SELL_BUILDING_REFUND) };
      }
    }
    this.sellable = sell;
    btn.classList.toggle('hidden', !sell);
    if (sell) {
      const cost = document.getElementById('bb-sell-cost');
      if (cost) cost.textContent = `${t('Vinde')} ◆ ${sell.cost}`;
      btn.title = sell.what === 'unit'
        ? t('Vinde acest șablon de unitate — primești ◆ {n}', { n: sell.cost }) + (sell.full ? t(' (100%, nespawnat)') : '')
        : t('Vinde această clădire — primești ◆ {n}', { n: sell.cost });
    }
  }

  // Mută: the button ABOVE Vinde. Visible only while the selection is one of the
  // player's own MOVABLE buildings (everything except the base + starting
  // turret). Clicking it ARMS move-mode; the next valid ground click relocates
  // the building (input.js), which then rebuilds for 30s in its new spot.
  updateMoveButton(game, info) {
    const btn = document.getElementById('bb-move');
    if (!btn) return;
    if (!this.moveWired) {
      this.moveWired = true;
      btn.addEventListener('click', () => {
        const sel = this.uiState.inspect;
        if (!sel || sel.kind !== 'structure') return;
        // toggle: arm if not already moving THIS building, else cancel
        const cur = this.uiState.movingBuilding;
        if (cur && cur.id === sel.id) { this.uiState.movingBuilding = null; }
        else { this.uiState.movingBuilding = { id: sel.id }; this.uiState.selected = null; }
      });
    }
    let movable = false;
    if (game && info && info.team === this.team && this.mode === 'inspect' &&
        info.kind === 'structure' && CONFIG.BUILDINGS[info.type] &&
        info.type !== 'main' && info.type !== 'turret') {
      movable = true;
    }
    // drop a stale arm if the selection changed / is no longer valid
    const arming = this.uiState.movingBuilding;
    const curId = info && info.s ? info.s.id : null;
    if (arming && (!info || info.kind !== 'structure' || curId !== arming.id)) {
      this.uiState.movingBuilding = null;
    }
    const armed = !!(this.uiState.movingBuilding && curId != null && this.uiState.movingBuilding.id === curId);
    btn.classList.toggle('hidden', !movable);
    btn.classList.toggle('armed', armed);
    if (movable) {
      const label = btn.querySelector('span:last-child');
      if (label) label.textContent = armed ? t('Alege loc…') : t('Mută');
      btn.title = armed
        ? t('Click pe teren ca să muți clădirea (se reconstruiește 30s). Click din nou aici sau ESC = anulează.')
        : t('Mută clădirea în alt loc (se reconstruiește 30s).');
    }
  }

  // ------------------------------------------------------ portrait + details
  refreshPanel(game, info) {
    const ctx = this.portrait.getContext('2d');
    ctx.clearRect(0, 0, 112, 112);
    if (!info || !game) {
      this.setPortraitVideo(null);
      this.details.innerHTML = `<div class="bb-empty">${t('Selectează o unitate sau o clădire.')}</div>`;
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
      const own = info.team === this.team;
      const inc = game.bstat(info.team, 'generator').income;
      this.details.innerHTML = `
        <div class="d-title"><span class="d-name ${own ? '' : 'enemy'}">${t('Muncitor')}</span><span class="d-sub">${t('Miner')}${own ? '' : ` · ${t('INAMIC')}`}</span></div>
        <div class="d-stats"><span>${t('⛏ cară aur la bază')}</span>${inc ? `<span>${t('◆ +<b>{n}</b> aur/20s', { n: inc })}</span>` : ''}</div>`;
      return;
    }
    // an uploaded idle clip (mp4/webm) takes over the portrait box; otherwise
    // fall back to the sprite/vector portrait drawn on the canvas. A split
    // rider (on foot) / beast plays its OWN clip when one was uploaded. The
    // gold mine plays its map clip (mineidle) in the portrait too.
    const form = info.kind === 'entity' && info.u.summon && info.u.summonKind ? info.u.summonKind
      : info.kind === 'entity' && info.u.morph && info.u.morphUntil > game.time ? 'morph'
      : info.kind === 'entity' && info.u.beast ? 'beast'
      : info.kind === 'entity' && info.u.dismounted ? 'foot' : 'base';
    const vid = info.kind === 'structure' && info.type === 'generator'
      ? (getMineVideoUrl(raceOf(info.team), 'mineidle') || getPortraitVideoUrl(raceOf(info.team), info.type, form))
      : info.kind === 'structure' && info.type === 'tower'
        ? (getTowerVideoUrl(raceOf(info.team), game.tier[info.team]) || getPortraitVideoUrl(raceOf(info.team), info.type, form))
        : getPortraitVideoUrl(raceOf(info.team), info.type, form);
    this.setPortraitVideo(vid);
    if (!vid) this.drawPortrait(ctx, game, info);

    const own = info.team === this.team;
    // hostile only when on the OTHER side — an ally's stuff isn't "INAMIC"
    const foe = info.side !== (game.sideOf ? game.sideOf(this.team) : this.team);
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
          ? `${t('Clădire')} · Tier ${'I'.repeat(Math.max(1, game.tier[info.team]))}${stats.cost ? ` · ◆ ${stats.cost}` : ''}`
          : `${t('Clădire')}${stats.cost ? ` · ◆ ${stats.cost}` : ''}`;
    } else if (info.kind === 'entity' && info.u.summon) {
      sub = t('Animal invocat');
    } else {
      // units: no "Tier X · ◆ cost" subtitle — the stats sit in the emoji line
      sub = info.kind === 'template' && !info.tpl.spawned ? t('nou (100% la vânzare)') : '';
    }

    // live numbers
    // the Undead soul hero spends SOULS, not mana: same bar, its own colour and
    // label — and it is EARNED, so a template preview shows it empty too
    const soulKit = !isStruct && usesSouls(game.races[info.team], info.type);
    let hp; let maxHp; let mana = 0; let manaMax = 0;
    if (info.kind === 'entity') {
      hp = info.u.hp; maxHp = info.u.maxHp; mana = info.u.mana || 0; manaMax = info.u.manaMax || 0;
    } else if (isStruct) {
      hp = info.s.hp; maxHp = info.s.maxHp;
    } else {
      hp = maxHp = stats.hp;
      manaMax = stats.caster ? stats.mana : 0;
      mana = soulKit ? 0 : manaMax;
    }

    const rows = [];
    if (!isStruct) {
      // units: the same clean emoji line as the shop popup (cost/HP/damage/
      // armor/damage-type + Hits air / Caster) — no DPS / Tier / speed / range.
      // For a LIVE unit show its ACTUAL stats (hero per-level growth, Divine Buff,
      // mount/morph…) via effStats, not the base card values — otherwise a leveled
      // hero looks identical to level 1 and "+/nivel" seems to do nothing.
      let dispStats = stats;
      if (info.kind === 'entity' && info.u && !info.u.summon) {
        dispStats = { ...stats, ...effStats(info.u, stats), hp: info.u.maxHp };
      }
      rows.push(...unitStatBits(dispStats));
    } else {
      // towers scale their damage AND attack period with the owner's base tier
      const tst = info.type === 'tower' ? towerStatForTier(stats, game.tier[info.team]) : null;
      const dmg = tst ? tst.damage : stats.damage;
      const per = tst ? tst.period : stats.period;
      if (dmg) rows.push(`⚔ <b>${dmg}</b> · <b>${(dmg / Math.max(0.1, per || 1)).toFixed(1)}</b> DPS`, `➹ <b>${stats.range}</b>`);
      if (stats.income) rows.push(t('◆ +<b>{n}</b> aur/20s', { n: stats.income }));
      if (stats.regen) rows.push(`✚ +<b>${stats.regen}</b> HP/s`);
      if (info.type === 'main') rows.push(t('🏰 obiectivul principal'));
    }

    // status + live happenings
    let chips = '';
    if (info.kind === 'entity') {
      if (info.u.effects) {
        for (const e of info.u.effects) {
          const m = STATUS_LABELS[e.kind];
          if (!m || e.until <= game.time) continue;
          chips += `<span class="d-chip" style="border-color:${m[2]};color:${m[2]}">${m[0]} ${t(m[1])} · ${Math.ceil(e.until - game.time)}s</span>`;
        }
      }
      if (info.u.dismounted) chips += `<span class="d-chip" style="border-color:#ffb35c;color:#ffb35c">${t('🐗 pe jos')}</span>`;
      if (info.u.morph && info.u.morphUntil > game.time) chips += `<span class="d-chip" style="border-color:#ff8a3c;color:#ff8a3c">🪨 Elemental Form · ${Math.ceil(info.u.morphUntil - game.time)}s</span>`;
      if (info.u.vortexUntil > game.time) chips += `<span class="d-chip" style="border-color:#fff2b0;color:#fff2b0">🌀 Vortex of Light · ${Math.ceil(info.u.vortexUntil - game.time)}s</span>`;
      if (info.u.castState) chips += `<span class="d-chip" style="border-color:#c9a7ff;color:#c9a7ff">${t('✨ castează')}</span>`;
      const tgt = info.u.targetId != null ? game.byId.get(info.u.targetId) : null;
      if (tgt && tgt.hp > 0) {
        const ts = game.ustat(tgt.team, tgt.type);
        chips += `<span class="d-chip">🎯 ${(ts && ts.name) || tgt.type}</span>`;
      }
    }

    const soulBar = soulKit;
    const manaBar = manaMax > 0
      ? `<div class="d-bar${soulBar ? ' souls' : ''}"><div class="mana" style="width:${Math.max(0, (mana / manaMax) * 100)}%"></div><span>${soulBar ? t('Suflete ') : ''}${Math.floor(mana)} / ${manaMax}</span></div>`
      : '';
    // units with a limited lifetime (summons/totems given a "Durată viață"):
    // a depleting timer bar under the HP, matching the in-world life bar
    let lifeBar = '';
    if (info.kind === 'entity' && info.u.despawnAt != null && info.u.maxLife > 0) {
      const left = Math.max(0, info.u.despawnAt - game.time);
      const pct = Math.max(0, Math.min(1, left / info.u.maxLife)) * 100;
      lifeBar = `<div class="d-bar"><div class="mana" style="width:${pct}%;background:#7fb4ff"></div><span>⏳ ${Math.ceil(left)}s</span></div>`;
    }
    // hero: a level line + XP bar toward the next level (and unspent talent pts)
    let heroBar = '';
    if (info.kind === 'entity' && info.u.hero) {
      const tpl = game.heroTemplateOf(info.team, info.type);
      if (tpl) {
        const lvl = tpl.level || 1;
        const need = (stats.levelXp || [])[lvl - 1] || 0;
        const pct = lvl >= 10 || !need ? 100 : Math.max(0, ((tpl.xp || 0) / need) * 100);
        const label = lvl >= 10 ? 'MAX' : `${Math.floor(tpl.xp || 0)} / ${need} XP`;
        const pts = tpl.points ? `<span class="d-chip" style="border-color:#ffd35c;color:#ffd35c">★ ${tpl.points} ${tpl.points > 1 ? t('puncte') : t('punct')}</span>` : '';
        heroBar = `<div class="d-sub" style="margin:2px 0">${t('Nivel {n}', { n: lvl })}${own ? '' : ''} ${pts}</div>
          <div class="d-bar"><div class="mana" style="width:${pct}%;background:#ffd35c"></div><span>${label}</span></div>`;
      }
    }
    this.details.innerHTML = `
      <div class="d-title"><span class="d-name ${foe ? 'enemy' : ''}">${name}</span><span class="d-sub">${sub}${foe ? ` · ${t('INAMIC')}` : (own ? '' : ` · ${t('ALIAT')}`)}</span></div>
      <div class="d-bar"><div class="hp ${foe ? 'enemy' : ''}" style="width:${Math.max(0, (hp / maxHp) * 100)}%"></div><span>${Math.ceil(hp)} / ${Math.ceil(maxHp)}</span></div>
      ${lifeBar}
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
    const race = raceOf(info.team); // races are per COMMANDER (lobby picks)
    const frame = Math.floor(performance.now() / 500) % 2;
    // a split beast / rider on foot shows its own art: form idle sprite, then
    // form thumbnail, then the whole unit's idle sprite / thumb, then vectors
    const form = info.kind === 'entity' && info.u.summon && info.u.summonKind ? info.u.summonKind
      : info.kind === 'entity' && info.u.morph && info.u.morphUntil > game.time ? 'morph'
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
      drawCharacter(ctx, info.type, 'idle', 0, info.team, 2.4);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(56, 56);
    if (info.kind === 'structure') {
      ctx.fillStyle = '#2d3a4f';
      ctx.fillRect(-30, -30, 60, 60);
      ctx.strokeStyle = TEAM_COLORS[info.side];
      ctx.lineWidth = 3.5;
      ctx.strokeRect(-30, -30, 60, 60);
    } else {
      const stats = game.ustat(info.team, info.type);
      ctx.fillStyle = TEAM_COLORS[info.side];
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
      // the hotkey belongs to the CELL (positional), so the badge always
      // matches the key that fires it — whatever card happens to sit here
      const keyTxt = cellKeyLabel(i);
      if (keyTxt && keyTxt !== '—') {
        const k = document.createElement('span');
        k.className = 's-key'; k.textContent = keyTxt;
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
    const race = raceOf(this.team);
    // EVERY unit always occupies its cell. Ones whose tech building isn't up yet
    // (or that are tier-gated) just render locked (grayed, 🔒) instead of
    // vanishing — the lock clears the instant the building finishes.
    const shown = resolvedUnitOrder(race)
      .map((id) => {
        const u = statsUnit(race, id);
        return { kind: 'unit', id, cost: u.cost, building: u.building || '', slot: Number.isInteger(u.slot) ? u.slot : -1 };
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
    return grid;
  }

  buildingItems() {
    const race = raceOf(this.team);
    // the base tier upgrade now lives on the Main Base selection, not here.
    // Each building may carry an admin-chosen grid cell (slot 0-8, -1 = auto),
    // laid out exactly like the unit cards in a tech building.
    const cards = BUILDING_CARDS.map((b) => {
      const bs = statsBuilding(race, b.id);
      return { kind: 'building', id: b.id, cost: bs.cost,
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
    const own = info.team === this.team;
    const isStruct = info.kind === 'structure';
    const stats = isStruct ? game.bstat(info.team, info.type) : game.ustat(info.team, info.type);

    // your own Main Base: just the tier upgrade (heroes moved to the Hero Hall;
    // units + their upgrades live in the tech buildings)
    if (own && isStruct && info.type === 'main') {
      const grid = new Array(9).fill(null);
      grid[8] = { kind: 'upgradeBase', id: 'upgrade' }; // always the last cell
      // Undead: repeatable skeleton-cap upgrade lives at the base (raises how many
      // Necromancer skeletons the team may keep alive).
      if (raceOf(this.team) === 'undead') grid[0] = { kind: 'buySkelCap' };
      return grid;
    }

    // your own Hero Hall: recruit heroes here. Up to 3 hero cards, gated by the
    // NUMBER of heroes you field (not by which one): any hero as your 1st @ tier
    // 1, a 2nd @ tier 2, a 3rd @ tier 3. Each not-yet-owned card shows the tier
    // it needs (= current hero count + 1); owned cards show ✔.
    if (own && isStruct && info.type === 'herohall') {
      const race = raceOf(this.team);
      const owned = game.heroTemplates(this.team).length;
      const page = resolvedHeroIds(race).map((id) => {
        const h = statsUnit(race, id);
        const isOwned = game.hasHeroType(this.team, id);
        const reqTier = isOwned ? 1 : Math.min(3, owned + 1);
        return { kind: 'unit', id, cost: h.cost, tier: reqTier, isHero: true, slot: -1 };
      });
      return layoutCardPage(page, null);
    }

    // your own tech building: units and their upgrades live on SEPARATE pages
    // so they don't crowd the same grid. Default page = units; a ⬆ toggle
    // switches to the upgrades page (⬇ toggles back). A unit still needs the
    // base at its tier.
    if (own && isStruct && TECH_BUILDINGS.includes(info.type)) {
      const race = raceOf(this.team);
      const myUnits = resolvedUnitOrder(race).filter((id) => (statsUnit(race, id) || {}).building === info.type);
      const upgrades = [];
      for (const uid of myUnits) {
        for (const id of UPGRADE_IDS) {
          const up = resolvedUpgrade(id);
          if (up && up.unit === uid && (!up.race || up.race === race)) {
            const needTier = Math.max((statsUnit(race, uid) || {}).tier || 1, up.params.tier || 1);
            upgrades.push({ kind: 'buyUpgrade', id, cost: up.params.cost || 0, tier: needTier, slot: Number.isInteger(up.slot) ? up.slot : -1 });
          }
        }
      }
      const onUpg = this.bldgView === 'upgrades';
      const page = onUpg
        ? upgrades
        : myUnits.map((id) => {
            const u = statsUnit(race, id);
            // carry the tech building so the card locks (🔒, greyed) while this
            // very building is still a construction site — exactly like the shop.
            // `slot` is the unit's cell in the SHOP page; here only this
            // building's 3-4 units are shown, so honouring it would scatter them
            // (an Undead barracks left the whole first row empty). They pack from
            // the first cell instead, in the shop's own order.
            return { kind: 'unit', id, cost: u.cost, tier: u.tier, building: info.type, slot: -1 };
          });
      // Fixed cells: sell at slot 7, the ⬆/⬇ toggle at slot 8. The units /
      // upgrades occupy cells 0..6 at their admin-chosen slot (or auto-fill the
      // first free cell when slot is -1).
      const toggle = upgrades.length ? { kind: 'bldgView', to: onUpg ? 'units' : 'upgrades' } : null;
      return layoutCardPage(page, toggle);
    }

    // your own hero: its 3 skills + ultimate, each rankable with talent points
    if (!isStruct && own && stats.isHero) {
      for (const slot of heroAbilitySlots(raceOf(this.team), info.type)) {
        if (slot.id) items.push({ kind: 'heroAbility', id: slot.id, ult: slot.ult, unit: info.type });
      }
      return items;
    }

    // an ENEMY hero: show, read-only, the abilities it has LEARNED (rank ≥ 1)
    // with their live cooldowns — so you can see what it can cast and when.
    if (!isStruct && !own && stats.isHero) {
      const tpl = game && game.heroTemplateOf(info.team, info.type);
      const ranks = (tpl && tpl.ranks) || {};
      for (const slot of heroAbilitySlots(raceOf(info.team), info.type)) {
        if (slot.id && (ranks[slot.id] || 0) > 0) {
          items.push({ kind: 'ability', id: slot.id, team: info.team, unit: info.type, own: false });
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
      const race = raceOf(info.team); // upgrades filter by the owner's race
      // Ability-unlock upgrades are represented on the unit panel by the ability
      // icon itself (locked until bought) — the "buy" card belongs only on the
      // tech building's upgrades page, so skip them here (no duplicate icon).
      const unlockIds = new Set(Object.values(ABILITY_UNLOCK_UPGRADE));
      for (const id of UPGRADE_IDS) {
        if (unlockIds.has(id)) continue;
        const up = resolvedUpgrade(id);
        if (up && up.unit === info.type && (!up.race || up.race === race)) {
          items.push({ kind: 'upgrade', id, team: info.team, unit: info.type, own, cost: up.params.cost || 0 });
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
      // mirror by the SIDE I fight on (in team modes my player number is 2/3)
      if (sideOfPlayer(this.team) === 1) ctx.scale(-1, 1);
      if (drawThumb(ctx, data.id, this.team, 42)) { ctx.restore(); return; }
      ctx.restore();
      if (data.kind === 'unit' && hasCharacter(data.id)) {
        ctx.save();
        ctx.translate(23, 24);
        if (sideOfPlayer(this.team) === 1) ctx.scale(-1, 1);
        const u = statsUnit(raceOf(this.team), data.id);
        drawCharacter(ctx, data.id, 'idle', 0, this.team, Math.min(1.6, 38 / (u.radius * 2.8 + 4)));
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
        const u = statsUnit(raceOf(this.team), data.id);
        ctx.fillStyle = TEAM_COLORS[0];
        if (u.shape === 'ring') { ctx.strokeStyle = TEAM_COLORS[0]; ctx.lineWidth = 3.5; drawShape(ctx, 'ring', 16); ctx.stroke(); }
        else { drawShape(ctx, u.shape, 16); ctx.fill(); }
      }
      ctx.restore();
      return;
    }
    if (data.kind === 'upgradeBase') {
      const img = getBaseUpgradeIcon(raceOf(this.team));
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
    if (data.kind === 'buySkelCap') {
      const img = getUiIcon('upgrade-skelcap');
      if (img) {
        const s = Math.min(46 / img.width, 46 / img.height);
        ctx.drawImage(img, (46 - img.width * s) / 2, (46 - img.height * s) / 2, img.width * s, img.height * s);
        return;
      }
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💀', 23, 25);
      return;
    }
    if (data.kind === 'ability' || data.kind === 'upgrade' || data.kind === 'buyUpgrade' || data.kind === 'heroAbility') {
      const isAb = data.kind === 'ability' || data.kind === 'heroAbility';
      let img = getUiIcon(`${isAb ? 'ability' : 'upgrade'}-${data.id}`);
      // An ability-unlock upgrade (e.g. "Melee Skeleton") with no dedicated
      // upgrade icon falls back to the UNLOCKED ability's icon — so the icon you
      // uploaded to that ability appears on the buy card too, not just the unit panel.
      if (!img && data.kind === 'buyUpgrade') {
        const up = resolvedUpgrade(data.id);
        if (up && up.unlocks) img = getUiIcon(`ability-${up.unlocks}`);
      }
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
      el.classList.remove('selected', 'disabled', 'locked', 'on', 'off', 'owned-upg', 'sell', 'tog-off', 'ready');
      this.setLock(el, null); // cleared every frame; the branches below re-add it
      let cd = 0;
      let cdTotal = 0; // full cooldown length (for the radial sweep overlay)
      let tog = null;  // toggle state: true = ✔ activ, false = ✖ oprit, null = no badge
      if (d.kind === 'unit') {
        el.classList.toggle('selected', this.uiState.selected === d.id);
        if (game) {
          const u = game.ustat(this.team, d.id);
          const heroWait = d.isHero ? game.heroUnlockTime() - game.time : 0;
          const heroOwned = d.isHero && game.hasHeroType(this.team, d.id);
          // heroes gate by COUNT (the N-th distinct hero needs base tier N), not
          // by the hero's own tier — any hero can be your 1st at tier 1.
          const reqTier = d.isHero
            ? Math.min(3, game.heroTemplates(this.team).length + 1)
            : u.tier;
          if (!heroOwned && reqTier > game.tier[this.team]) { el.classList.add('locked'); this.setLockTier(el, reqTier); }
          else if (!d.isHero && d.building && !game.hasBuilding(this.team, d.building)) { el.classList.add('locked'); this.setLock(el, '🔒'); }
          // heroes come only from a FINISHED Hero Hall
          else if (d.isHero && !heroOwned && !game.hasBuilding(this.team, 'herohall')) { el.classList.add('locked'); this.setLock(el, '🔒'); }
          else if (heroWait > 0) {
            // hero still time-locked (⚙ Balance): radial countdown on the card
            el.classList.add('disabled');
            cd = heroWait;
            cdTotal = game.heroUnlockTime();
          }
          else if (heroOwned) el.classList.add('owned-upg'); // already recruited THIS hero
          else if (game.money[this.team] < u.cost) el.classList.add('disabled');
          else if (game.foodUsed(this.team) + (u.food || 0) > game.foodCap(this.team)) el.classList.add('disabled'); // over food cap
        }
      } else if (d.kind === 'building') {
        el.classList.toggle('selected', this.uiState.selected === d.id);
        if (game) {
          const bs = game.bstat(this.team, d.id);
          const price = game.buildCost(this.team, d.id); // mines get pricier each time
          const cap = bs.cap || 0;
          // walls with the charge system show their STOCK (buildable-right-now);
          // every other building shows how many more fit under its cap
          const chargeWall = d.id === 'wall' && Math.round(bs.chainMax || 1) > 1;
          const remaining = chargeWall ? (game.wallStock ? game.wallStock[this.team] : 0)
            : Math.max(0, cap - game.countKind(this.team, d.id));
          const showCounter = chargeWall || cap > 0;
          const tierLocked = game.tier[this.team] < (bs.tier || 1);
          if (tierLocked) { el.classList.add('locked'); this.setLockTier(el, bs.tier); }
          else if (remaining <= 0) el.classList.add('disabled');
          else if (cap > 0 && game.countKind(this.team, d.id) >= cap) el.classList.add('disabled');
          else if (game.money[this.team] < price) el.classList.add('disabled');
          // top-right counter: how many you can build right now
          this.setRemaining(el, showCounter && !tierLocked ? String(remaining) : null);
          cd = game.buildCdLeft(this.team, d.id);
          // charging wall: a radial (like an ability cooldown) counts down the
          // time until the next wall drops into the stock
          const max = Math.round(bs.chainMax || 1);
          if (chargeWall && !tierLocked && remaining < max && game.wallStockAt && game.wallStockAt[0] > 0) {
            cd = game.wallStockAt[0] - game.time;
            cdTotal = Math.max(0.1, bs.chainDelay || 3);
          }
          const c = el.querySelector('.s-cost');
          if (c && c.textContent !== String(price)) c.textContent = price;
        }
      } else if (d.kind === 'upgradeBase') {
        if (game) {
          const busy = game.baseUpgrading(this.team);
          const maxed = game.tier[this.team] >= CONFIG.TIER_MAX;
          const cost = maxed ? Infinity : game.tierUpCost(this.team);
          if (busy || maxed || game.money[this.team] < cost) el.classList.add('disabled');
          const c = el.querySelector('.s-cost');
          if (c) c.textContent = maxed ? 'MAX' : (busy ? '' : cost);
          // base is upgrading: radial timer over the cell (same sweep as CDs)
          if (busy) {
            cd = game.baseUpgradeLeft(this.team);
            cdTotal = Math.max(0.001, game.baseUpgradeDuration(this.team));
          }
        }
      } else if (d.kind === 'buySkelCap') {
        if (game) {
          const maxed = game.skelCapOf(this.team) >= (CONFIG.SKEL_CAP_MAX || 0);
          const cost = maxed ? Infinity : game.skelCapCostOf(this.team);
          if (maxed || game.money[this.team] < cost) el.classList.add('disabled');
          const c = el.querySelector('.s-cost');
          if (c) c.textContent = maxed ? 'MAX' : cost;
        }
      } else if (d.kind === 'ability' && game) {
        const ab = resolvedAbility(d.id);
        const req = Math.max(1, (ab && ab.params.tier) || 1);
        const unlockUp = ABILITY_UNLOCK_UPGRADE[d.id];
        if (unlockUp && !game.upgradeActive(d.team, unlockUp)) { el.classList.add('locked'); this.setLock(el, '🔒'); } // needs its unlock upgrade
        else if (game.tier[d.team] < req) { el.classList.add('locked'); this.setLockTier(el, req); }
        else tog = !game.abilityOff[d.team].has(`${d.unit}/${d.id}`); // ✔ autocast / ✖ oprit
        if (info && info.kind === 'entity' && info.u.abilityCd) {
          cd = (info.u.abilityCd[d.id] || 0) - game.time;
          cdTotal = (ab && ab.params.cooldown) || 0;
        }
      } else if (d.kind === 'upgrade' && game) {
        const owned = game.upgrades[d.team].has(d.id);
        const c = el.querySelector('.s-cost');
        if (c) {
          const want = owned ? '' : String(d.cost ?? '');
          if (c.textContent !== want) c.textContent = want;
        }
        if (owned) {
          const up = resolvedUpgrade(d.id);
          if (up && up.kind === 'hold' && d.own) {
            // "Stai pe loc": the card becomes a STOP/GO button. While the hold
            // runs, the radial counts the seconds left before they march again.
            const held = game.isHeld(d.team, d.unit);
            tog = held ? true : null;
            if (held) {
              el.classList.add('on');
              cd = game.holdLeft(d.team, d.unit);
              cdTotal = Math.max(0.1, up.params.holdDuration || 0);
            } else {
              // marched on: the button waits out its cooldown before it can stop
              // them again — greyed, with the radial counting it down
              const wait = game.holdCdLeftFor(d.team, d.unit);
              if (wait > 0) {
                el.classList.add('disabled');
                cd = wait;
                cdTotal = Math.max(0.1, up.params.holdCooldown || 0);
              }
            }
          } else {
            tog = !game.upgradeOff[d.team].has(d.id); // ✔ activ / ✖ dezactivat
          }
        } else {
          el.classList.add('disabled');
        }
      } else if (d.kind === 'buyUpgrade' && game) {
        const owned = game.upgrades[this.team].has(d.id);
        // once owned the card stops being a "for sale" item: price off, ✔/✖ on
        const c = el.querySelector('.s-cost');
        if (c) {
          const want = owned ? '' : String(d.cost);
          if (c.textContent !== want) c.textContent = want;
        }
        const up = resolvedUpgrade(d.id);
        const needMet = !up || !Array.isArray(up.requires) || up.requires.every((r) => game.upgrades[this.team].has(r));
        if (owned) {
          tog = !game.upgradeOff[this.team].has(d.id); // ✔ activ / ✖ dezactivat
        } else if (d.tier && d.tier > game.tier[this.team]) {
          el.classList.add('locked'); this.setLockTier(el, d.tier); // needs the unit's tier
        } else if (!needMet) {
          el.classList.add('locked'); this.setLock(el, '🔒'); // prerequisite upgrade(s) not owned yet
        } else if (game.money[this.team] < d.cost) {
          el.classList.add('disabled');
        }
      } else if (d.kind === 'heroAbility' && game) {
        const tpl = game.heroTemplateOf(this.team, d.unit);
        const rank = (tpl && tpl.ranks && tpl.ranks[d.id]) || 0;
        const max = d.ult ? 1 : 3;
        const pts = (tpl && tpl.points) || 0;
        const lvl = (tpl && tpl.level) || 1;
        this.setRankBadge(el, `${rank}/${max}`);
        if (d.ult && lvl < 6) el.classList.add('locked');       // ultimate needs level 6
        else if (rank >= max) el.classList.add('owned-upg');    // maxed out
        else if (pts > 0) el.classList.add('on');               // a point is available
        else el.classList.add('off');                           // learned but no point
        // cast-mode badge (top-left): A = auto, M = manual, ✖ = off. Only shown
        // once the ability is learned (rank ≥ 1) — before that it's just a talent.
        const key = `${d.unit}/${d.id}`;
        const isOff = game.abilityOff[this.team].has(key);
        if (rank > 0) {
          const isManual = game.abilityManual[this.team].has(key);
          const mode = isOff ? 'off' : (isManual ? 'manual' : 'auto');
          this.setModeBadge(el, mode);
          if (mode === 'off') el.classList.add('tog-off');
        } else {
          this.setModeBadge(el, null);
        }
        // live cooldown sweep when the inspected target is the LIVE hero
        const liveHero = info && info.kind === 'entity' && info.u.hero ? info.u : null;
        if (rank > 0 && liveHero && liveHero.abilityCd) {
          cd = (liveHero.abilityCd[d.id] || 0) - game.time;
          const ab = resolvedAbility(d.id);
          cdTotal = (ab && ab.params.cooldown) || 0;
        }
        // Usable-now feedback for an ACTIVE learned ability (off-cooldown, enough
        // mana, not mid-ultimate). Presentation depends on the cast mode:
        //  • AUTO   → the golden marching-dashes ring appears when it's ready.
        //  • MANUAL → no ring; the icon is dimmed while it can't be cast and shows
        //             full colour the moment you can press it.
        el.classList.remove('ready', 'manual-dim');
        if (rank > 0 && !isOff && liveHero && isActiveAbility(d.id)) {
          const ab = resolvedAbility(d.id);
          const manaOk = (liveHero.mana || 0) >= ((ab && ab.params.manaCost) || 0);
          const usable = cd <= 0.05 && manaOk && !((liveHero.vortexUntil || 0) > game.time);
          if (game.abilityManual[this.team].has(key)) {
            el.classList.toggle('manual-dim', !usable); // manual: dim until castable
          } else {
            el.classList.toggle('ready', usable);       // auto: marching-dashes ring
          }
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
      // explicit toggle badge (abilities autocast + owned upgrades): a green ✔
      // top-right when active, a red ✖ when switched off — clearer than the
      // old colored borders
      let togEl = el.querySelector('.s-tog');
      if (tog != null) {
        if (!togEl) {
          togEl = document.createElement('span');
          togEl.className = 's-tog';
          el.appendChild(togEl);
        }
        const txt = tog ? '✔' : '✖';
        if (togEl.textContent !== txt) togEl.textContent = txt;
        togEl.classList.toggle('ok', tog);
        togEl.classList.toggle('no', !tog);
        el.classList.toggle('tog-off', !tog);
      } else if (togEl) {
        togEl.remove();
        el.classList.remove('tog-off');
      }
    }
  }

  // text = null removes the badge (a card that just unlocked must not keep it)
  setLock(el, text) {
    let l = el.querySelector('.s-lock');
    if (text == null) { if (l) l.remove(); return; }
    if (!l) {
      l = document.createElement('span');
      l.className = 's-lock';
      el.appendChild(l);
    }
    if (l.textContent !== text) l.textContent = text;
  }

  setLockTier(el, tier) { this.setLock(el, `T${tier}`); }

  // top-right "how many more you can build" counter (null removes it)
  setRemaining(el, text) {
    let r = el.querySelector('.s-rem');
    if (text == null) { if (r) r.remove(); return; }
    if (!r) { r = document.createElement('span'); r.className = 's-rem'; el.appendChild(r); }
    if (r.textContent !== text) r.textContent = text;
  }

  setRankBadge(el, text) {
    let r = el.querySelector('.s-cost');
    if (!r) { r = document.createElement('span'); r.className = 's-cost'; el.appendChild(r); }
    r.textContent = text;
  }

  // Hero ability cast-mode badge (top-left): 'auto' → A, 'manual' → M, 'off' → ✖.
  // Pass null to remove it (ability not learned yet).
  setModeBadge(el, mode) {
    let m = el.querySelector('.s-mode');
    if (mode == null) { if (m) m.remove(); return; }
    if (!m) { m = document.createElement('span'); m.className = 's-mode'; el.appendChild(m); }
    const txt = mode === 'off' ? '✖' : (mode === 'manual' ? 'M' : 'A');
    if (m.textContent !== txt) m.textContent = txt;
    m.classList.toggle('auto', mode === 'auto');
    m.classList.toggle('manual', mode === 'manual');
    m.classList.toggle('no', mode === 'off');
  }

  // A hotkey press on command-card cell `i` (0-8): replays exactly what a click
  // on that cell does — same locks, same toggles, same commands. Silent when the
  // cell is empty.
  pressCell(i) {
    const slot = this.slots[i];
    if (!slot || !slot.data) return false;
    this.clickSlot(slot.data, slot.el, 0);
    return true;
  }

  // Sell from a hotkey: the same button the mouse would press, and only while
  // it's actually offered (hidden = nothing sellable selected).
  pressSell() {
    const btn = document.getElementById('bb-sell');
    if (!btn || btn.classList.contains('hidden')) return false;
    btn.click();
    return true;
  }

  // Switch the bottom bar's shop tab from a hotkey (same as clicking the tab).
  pressTab(tab) {
    if (!this.tabBtns[tab]) return false;
    this.tab = tab;
    this.mode = tab;
    this.uiState.inspect = null; // a tab press leaves any selection panel
    this.refreshTabs();
    // rebuild the grid NOW: the cells are what the next hotkey will press, so
    // they must not lag a frame behind the tab you just switched to
    this.update(this.getGame());
    return true;
  }

  clickSlot(d, el, button = 0) {
    const game = this.getGame();
    if (d.kind === 'unit' || d.kind === 'building') {
      if (el.classList.contains('locked')) return;
      if (d.isHero && game && game.hasHeroType(this.team, d.id)) return; // already recruited this hero
      this.onShopClick(d.id);
      return;
    }
    if (d.kind === 'upgradeBase') {
      this.onShopClick('upgrade');
      return;
    }
    if (d.kind === 'buySkelCap') {
      if (el.classList.contains('disabled')) return;
      if (game) game.issueCommand({ type: 'buySkelCap', team: this.team });
      return;
    }
    if (d.kind === 'bldgView') {
      this.bldgView = d.to;
      this.sig = null; // force the grid to rebuild for the new page
      return;
    }
    if (!game) return;
    if (d.kind === 'heroAbility') {
      const key = `${d.unit}/${d.id}`;
      const active = isActiveAbility(d.id); // passives (Cleave, Divine Buff) can only be On/Off
      // right-click cycles the cast mode. Active: Auto -> Manual -> Off -> Auto.
      // Passive: Auto -> Off -> Auto (no Manual — there's nothing to trigger).
      if (button === 2) {
        const off = game.abilityOff[this.team].has(key);
        const manual = game.abilityManual[this.team].has(key);
        let next;
        if (!active) next = off ? 'auto' : 'off';
        else next = off ? 'auto' : (manual ? 'off' : 'manual');
        game.issueCommand({ type: 'setAbilityMode', team: this.team, unit: d.unit, ability: d.id, mode: next });
        return;
      }
      // left-click: spend a talent point if one is free, otherwise (an ACTIVE
      // ability in Manual mode) fire it now.
      const tpl = game.heroTemplateOf(this.team, d.unit);
      const rank = (tpl && tpl.ranks && tpl.ranks[d.id]) || 0;
      const max = d.ult ? 1 : 3;
      const canRank = (tpl && tpl.points > 0) && rank < max && !(d.ult && (tpl.level || 1) < 6);
      if (canRank) {
        game.issueCommand({ type: 'rankHero', team: this.team, unit: d.unit, ability: d.id });
      } else if (active && rank > 0 && game.abilityManual[this.team].has(key)) {
        game.issueCommand({ type: 'castAbilityNow', team: this.team, unit: d.unit, ability: d.id });
      }
      return;
    }
    if (d.kind === 'ability' && d.own) {
      if (el.classList.contains('locked')) return; // tier- or unlock-locked: nothing to toggle
      const on = game.abilityOff[this.team].has(`${d.unit}/${d.id}`); // off -> turn on
      game.issueCommand({ type: 'toggleAbility', team: this.team, unit: d.unit, ability: d.id, on });
      return;
    }
    if (d.kind === 'upgrade' && d.own && game.upgrades[this.team].has(d.id)) {
      const up = resolvedUpgrade(d.id);
      if (up && up.kind === 'hold') { // press = stand still / march on
        // still cooling down after the last hold: the sim would refuse it anyway
        if (!game.isHeld(this.team, d.unit) && !game.holdReady(this.team, d.unit)) return;
        game.issueCommand({ type: 'holdUnits', team: this.team, unit: d.unit });
        return;
      }
      const on = game.upgradeOff[this.team].has(d.id);
      game.issueCommand({ type: 'toggleUpgrade', team: this.team, id: d.id, on });
      return;
    }
    if (d.kind === 'buyUpgrade') {
      if (game.upgrades[this.team].has(d.id)) {
        const on = game.upgradeOff[this.team].has(d.id); // owned -> toggle
        game.issueCommand({ type: 'toggleUpgrade', team: this.team, id: d.id, on });
      } else {
        if (el.classList.contains('locked')) return; // tier- or prerequisite-locked
        game.issueCommand({ type: 'buyUpgrade', team: this.team, id: d.id });
      }
      return;
    }
    if (d.kind === 'sell') {
      const sel = this.uiState.inspect;
      if (!sel) return;
      if (d.what === 'unit') game.issueCommand({ type: 'sellUnit', team: this.team, index: sel.index });
      else game.issueCommand({ type: 'sellBuilding', team: this.team, id: sel.id });
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
    const race = raceOf(this.team);
    if (d.kind === 'unit') {
      const u = statsUnit(race, d.id);
      // still-locked units spell out what they need after the name, e.g.
      // "(Requires: Barracks & Tier 2)" — drops each part as it's satisfied
      const req = [];
      if (u.building && game && !game.hasBuilding(this.team, u.building)) req.push(buildingNameOf(race, u.building));
      if (u.tier > (game ? game.tier[this.team] : 1)) req.push(`Tier ${u.tier}`);
      const reqNote = req.length ? ` <span class="p-req">(${t('Requires: {list}', { list: req.join(' & ') })})</span>` : '';
      // name → editable description → a clean emoji stat line
      return `<div class="p-title">${u.name}${reqNote}</div>
        <div>${pickText(u.tip, u.tipEn)}</div>
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
          ? `<div class="p-dim">${t('Deblochează: {names}', { names: names.join(', ') })}</div>`
          : `<div class="p-dim">${t('(nicio unitate asignată — vezi /admin)')}</div>`;
      }
      const req = s.tier || 1;
      const tierNote = req > 1
        ? (game && game.tier[this.team] < req
            ? `<div class="p-dim" style="color:#ff9a6a">${t('Se construiește de la Tier {t}', { t: 'I'.repeat(req) })}</div>`
            : `<div class="p-dim">${t('Necesită Tier {t}', { t: 'I'.repeat(req) })}</div>`)
        : '';
      // name → editable description → a clean emoji stat line (cost lives on the
      // card thumbnail badge now, not here)
      const bits = [`${s.hp} ❤️`];
      if (d.id === 'tower') bits.push(`${s.damage} ⚔️`);
      if (d.id === 'generator') bits.push(`+${s.income} ${t('aur/20s')}`);
      if (d.id === 'generator' && (s.costStep || 0) > 0) bits.push(t('+{n}/mină', { n: s.costStep }));
      if (d.id === 'farm') bits.push(`+${s.food} food`);
      return `<div class="p-title">${buildingNameOf(race, d.id)}</div>
        <div>${pickText(s.tip, s.tipEn) || (b ? t(b.tip) : '')}</div>
        ${unlocks}
        ${tierNote}
        <div class="p-dim">${bits.join(' · ')}</div>`;
    }
    if (d.kind === 'upgradeBase') {
      const maxed = game && game.tier[this.team] >= CONFIG.TIER_MAX;
      const busy = game && game.baseUpgrading(this.team);
      const cost = game ? (maxed ? 'MAX' : `◆ ${game.tierUpCost(this.team)}`) : `◆ ${CONFIG.TIER_COSTS[2]}`;
      const next = !game || game.tier[this.team] === 1
        ? t('Tier 2 deblochează unitățile de tier 2')
        : t('Tier 3 deblochează unitățile de tier 3');
      const wait = game ? game.baseUpgradeDuration(this.team) : 0;
      const timing = wait > 0 ? t('Durează {n}s (baza e ocupată în timpul upgrade-ului).', { n: wait }) : t('Instant.');
      if (busy) {
        return `<div class="p-title">${t('Upgrade Bază — în curs…')}</div>
          <div>${t('Baza se îmbunătățește. Mai sunt {n}s.', { n: Math.ceil(game.baseUpgradeLeft(this.team)) })}</div>
          <div class="p-dim">${t('Noul tier se activează când se termină timpul.')}</div>`;
      }
      return `<div class="p-title">${t('Upgrade Bază · {cost}', { cost })}</div>
        <div>${t('Deblochează următorul tier de unități și adaugă +1000 HP bazei. {timing}', { timing })}</div>
        <div class="p-dim">${maxed ? 'Toate tier-ele deblocate' : next}</div>`;
    }
    if (d.kind === 'buySkelCap') {
      const cap = game ? game.skelCapOf(this.team) : (CONFIG.SKEL_CAP_BASE || 0);
      const max = CONFIG.SKEL_CAP_MAX || 0;
      const maxed = cap >= max;
      const cost = game ? game.skelCapCostOf(this.team) : (CONFIG.SKEL_CAP_COST || 0);
      const step = CONFIG.SKEL_CAP_STEP || 0;
      const priceLine = maxed ? 'Plafon la maxim' : `◆ ${cost} — click: +${step} plafon`;
      return `<div class="p-title">💀 Plafon schelete · ${priceLine}</div>
        <div>${t('Crește câte schelete de Necromancer poate menține echipa ta vii în același timp.')}</div>
        <div class="p-dim">${t('Acum: {a}/{b}', { a: cap, b: max })}${maxed ? '' : t(' · fiecare cumpărare crește costul cu ◆ {n}', { n: CONFIG.SKEL_CAP_COST_STEP || 0 })}</div>`;
    }
    if (d.kind === 'ability') {
      const ab = resolvedAbility(d.id);
      if (!ab) return '';
      const p = ab.params;
      const req = Math.max(1, p.tier || 1);
      const bits = [`💧 ${p.manaCost || 0} mana`];
      if (p.cooldown != null) bits.push(`⏳ ${p.cooldown}s cooldown`);
      if (p.duration) bits.push(t('durată {n}s', { n: p.duration }));
      if (req > 1) bits.push(t('necesită Tier {n}', { n: req }));
      const state = game && game.abilityOff[d.team]?.has(`${d.unit}/${d.id}`) ? t('OPRIT') : t('PORNIT');
      return `<div class="p-title" style="color:${ab.color || '#ffd35c'}">${ab.name} — autocast ${state}</div>
        <div>${pickText(ab.desc, ab.descEn)}</div>
        <div class="p-dim">${bits.join(' · ')}</div>
        ${d.own ? `<div class="p-dim">${t('Click: pornește/oprește pentru TOATE unitățile de acest tip.')}</div>` : ''}`;
    }
    if (d.kind === 'upgrade' || d.kind === 'buyUpgrade') {
      const up = resolvedUpgrade(d.id);
      if (!up) return '';
      const team = d.team != null ? d.team : this.team;
      const owned = game && game.upgrades[team].has(d.id);
      const off = owned && game.upgradeOff[team].has(d.id);
      const ustats = statsUnit(up.race || race, up.unit) || {};
      const uname = ustats.name || up.unit;
      const unitTier = ustats.tier || 1;
      const tierLocked = !owned && d.kind === 'buyUpgrade' && game && unitTier > game.tier[this.team];
      // prerequisite upgrades (e.g. Brothers needs both single skeleton unlocks)
      const missing = (!owned && game && Array.isArray(up.requires))
        ? up.requires.filter((r) => !game.upgrades[team].has(r)) : [];
      const reqNames = missing.map((r) => (resolvedUpgrade(r) || {}).name || r).join(', ');
      const state = owned
        ? (off ? 'DEZACTIVAT' : 'ACTIV')
        : tierLocked
          ? t('blocat — necesită Tier {t}', { t: 'I'.repeat(unitTier) })
          : missing.length
            ? t('blocat — necesită întâi: {names}', { names: reqNames })
            : d.kind === 'buyUpgrade'
              ? t('◆ {n} — click pentru a cumpăra', { n: up.params.cost || 0 })
              : t('necumpărat — ◆ {n} din Bază', { n: up.params.cost || 0 });
      return `<div class="p-title">🐗 ${up.name} — ${state}</div>
        <div>${pickText(up.desc, up.descEn)}</div>
        <div class="p-dim">${t('Unitate')}: ${uname} (Tier ${'I'.repeat(unitTier)})</div>
        ${owned && (d.own || d.kind === 'buyUpgrade') ? `<div class="p-dim">${t('Click: activează/dezactivează.')}</div>` : ''}`;
    }
    if (d.kind === 'heroAbility') {
      const ab = resolvedAbility(d.id);
      if (!ab) return '';
      const tpl = game && game.heroTemplateOf(this.team, d.unit);
      const rank = (tpl && tpl.ranks && tpl.ranks[d.id]) || 0;
      const max = d.ult ? 1 : 3;
      const lvl = (tpl && tpl.level) || 1;
      const pts = (tpl && tpl.points) || 0;
      let status;
      if (d.ult && lvl < 6) status = t('Ultima — se deblochează la nivel 6');
      else if (rank >= max) status = t('Rang MAXIM ({a}/{b})', { a: rank, b: max });
      else if (pts > 0) status = t('Rang {a}/{b} — click-stânga pentru +1 rang ({p} pct.)', { a: rank, b: max, p: pts });
      else status = t('Rang {a}/{b} — n-ai puncte de talent', { a: rank, b: max });
      // once learned, the ability carries a cast mode you cycle with right-click
      let modeLine = '';
      if (rank > 0) {
        const key = `${d.unit}/${d.id}`;
        const isOff = game && game.abilityOff[this.team].has(key);
        const isManual = game && game.abilityManual[this.team].has(key);
        const active = isActiveAbility(d.id);
        const modeName = isOff ? t('OPRIT ✖') : (isManual ? t('MANUAL M') : t('AUTO A'));
        if (active) {
          modeLine = `<div class="p-dim">${t('Mod: <b>{m}</b> — click-dreapta ciclează Auto → Manual → Oprit.', { m: modeName })}</div>` +
            (isManual ? `<div class="p-dim">${t('Manual: click-stânga o aruncă acum (dacă e gata).')}</div>` : '');
        } else {
          // passive/aura: only On (Auto) or Off — nothing to trigger by hand
          modeLine = `<div class="p-dim">${t('Pasivă: <b>{s}</b> — click-dreapta pornește/oprește.', { s: isOff ? t('OPRITĂ ✖') : t('ACTIVĂ A') })}</div>`;
        }
      }
      return `<div class="p-title" style="color:${ab.color || '#ffd35c'}">${d.ult ? '★ ' : ''}${ab.name}</div>
        <div>${pickText(ab.desc, ab.descEn)}</div>
        <div class="p-dim">${status}</div>
        ${modeLine}
        <div class="p-dim">${t('Efectul crește cu rangul.')}</div>`;
    }
    if (d.kind === 'sell') {
      return `<div class="p-title">${t('Vinde')} — ◆ ${d.cost}${d.full ? t(' (100%, nespawnat)') : ''}</div>
        <div class="p-dim">${d.what === 'unit' ? t('Vinde acest șablon de unitate.') : t('Vinde această clădire.')}</div>`;
    }
    if (d.kind === 'bldgView') {
      return d.to === 'upgrades'
        ? `<div class="p-title">⬆ ${t('Upgrade-uri')}</div><div>${t('Arată upgrade-urile unităților acestei clădiri.')}</div>`
        : `<div class="p-title">⬇ ${t('Unități')}</div><div>${t('Înapoi la unitățile clădirii.')}</div>`;
    }
    return '';
  }
}
