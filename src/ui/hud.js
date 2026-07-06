import { CONFIG } from '../config.js';
import { UNIT_IDS } from '../units.js';
import { drawShape, TEAM_COLORS } from '../render/renderer.js';
import { hasCharacter, drawCharacter, drawThumb } from '../render/characters.js';
import { statsUnit, statsBuilding, buildingNameOf, resolvedUnitOrder } from './balance.js';
import { raceOf } from '../render/sprites.js';

const BUILDING_CARDS = [
  {
    id: 'wall', name: 'Wall', hotkey: 'Z',
    role: 'Blocks ground units',
    tip: 'Cheap barrier — enemies must break or go around it. Fliers pass over.',
  },
  {
    id: 'tower', name: 'Tower', hotkey: 'X',
    role: 'Defensive tower',
    tip: 'Shoots ground and air. Guards your construction zone.',
  },
  {
    id: 'generator', name: 'Generator', hotkey: 'C',
    role: 'Economy building',
    tip: 'Each adds +4/s income. Destroyable — protect your economy!',
  },
];

export class Hud {
  constructor(uiState) {
    this.uiState = uiState;
    this.el = {
      money: document.getElementById('money'),
      income: document.getElementById('income'),
      tier: document.getElementById('tier'),
      waveNum: document.getElementById('wave-num'),
      waveTimer: document.getElementById('wave-timer'),
      baseFill: [document.getElementById('base-hp-0'), document.getElementById('base-hp-1')],
      baseNum: [document.getElementById('base-hp-0-num'), document.getElementById('base-hp-1-num')],
      shop: document.getElementById('shop'),
      overlay: document.getElementById('overlay'),
      overlayTitle: document.getElementById('overlay-title'),
      overlayMsg: document.getElementById('overlay-msg'),
      overlayStats: document.getElementById('overlay-stats'),
    };
    this.cards = new Map();
    this.buildShop();
  }

  buildShop() {
    const shop = this.el.shop;
    shop.innerHTML = '';

    // --- buildings group -------------------------------------------------
    const race = raceOf(0);
    for (const b of BUILDING_CARDS) {
      const stats = statsBuilding(race, b.id);
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.unit = b.id;
      const extra =
        b.id === 'tower'
          ? `${stats.hp} HP · ${(stats.damage / stats.period).toFixed(1)} DPS · range ${stats.range}`
          : b.id === 'generator'
            ? `${stats.hp} HP · +${stats.income / CONFIG.INCOME_TICK}/s`
            : `${stats.hp} HP`;
      card.innerHTML = `
        <span class="c-hotkey">${b.hotkey}</span>
        <canvas width="40" height="40"></canvas>
        <span class="c-name">${buildingNameOf(race, b.id)}</span>
        <span class="c-cost">◆ ${stats.cost}</span>
        <div class="c-tip">
          <div class="t-role">${b.role}</div>
          <div>${b.tip}</div>
          <div class="t-stats">${extra} · max ${stats.cap}</div>
        </div>`;
      this.drawBuildingIcon(card.querySelector('canvas'), b.id);
      shop.appendChild(card);
      this.cards.set(b.id, card);
    }

    // upgrade base card
    const up = document.createElement('div');
    up.className = 'card';
    up.dataset.unit = 'upgrade';
    up.innerHTML = `
      <span class="c-hotkey">0</span>
      <canvas width="40" height="40"></canvas>
      <span class="c-name">Base <b id="tier-label">I</b></span>
      <span class="c-cost" id="upgrade-cost">◆ ${CONFIG.TIER_COSTS[2]}</span>
      <div class="c-tip">
        <div class="t-role">Upgrade main base</div>
        <div>Unlocks the next unit tier and adds +1000 base HP. Buys instantly.</div>
        <div class="t-stats" id="upgrade-info">Tier 2 unlocks: Bruiser, Lancer, Mender, Wasp</div>
      </div>`;
    const uctx = up.querySelector('canvas').getContext('2d');
    uctx.fillStyle = '#ffd35c';
    uctx.font = 'bold 24px sans-serif';
    uctx.textAlign = 'center';
    uctx.textBaseline = 'middle';
    uctx.fillText('▲', 20, 22);
    shop.appendChild(up);
    this.cards.set('upgrade', up);

    // separator
    const sep = document.createElement('div');
    sep.className = 'shop-sep';
    shop.appendChild(sep);

    // --- units group (shows the player race's resolved stats) -------------
    // Iterate this race's admin-defined shop order (falls back to roster order).
    let hotkey = 1;
    for (const id of resolvedUnitOrder(race)) {
      const u = statsUnit(race, id);
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.unit = id;
      const dps = u.heal
        ? `${(u.damage / u.period).toFixed(0)} HP/s heal`
        : `${(u.damage / u.period).toFixed(1)} DPS (${u.dmgType})`;
      card.innerHTML = `
        <span class="c-hotkey">${hotkey <= 9 ? hotkey : ''}</span>
        <span class="c-lock">T${u.tier}</span>
        <canvas width="40" height="40"></canvas>
        <span class="c-name">${u.name}</span>
        <span class="c-cost">◆ ${u.cost}</span>
        <div class="c-tip">
          <div class="t-role">${u.role} · Tier ${u.tier}</div>
          <div>${u.tip}</div>
          <div class="t-stats">${u.hp} HP · ${u.armor} · ${dps}<br>range ${u.range} · speed ${u.speed}</div>
        </div>`;
      this.drawIcon(card.querySelector('canvas'), u, id);
      shop.appendChild(card);
      this.cards.set(id, card);
      hotkey++;
    }
  }

  drawBuildingIcon(canvas, id) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 40, 40);
    ctx.save();
    ctx.translate(20, 20);
    if (drawThumb(ctx, id, 0, 36)) {
      ctx.restore();
      return;
    }
    const c = TEAM_COLORS[0];
    if (id === 'wall') {
      ctx.fillStyle = '#2d3a4f';
      ctx.fillRect(-13, -13, 26, 26);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-13, -13, 26, 26);
    } else if (id === 'tower') {
      ctx.fillStyle = '#2d3a4f';
      ctx.fillRect(-12, -12, 24, 24);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.strokeRect(-12, -12, 24, 24);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (id === 'generator') {
      ctx.fillStyle = '#2d3a4f';
      ctx.fillRect(-12, -12, 24, 24);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.strokeRect(-12, -12, 24, 24);
      ctx.fillStyle = '#ffd35c';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Re-render all card icons (called when sprites load or the race changes).
  refreshIcons() {
    const race = raceOf(0);
    for (const [id, card] of this.cards) {
      if (UNIT_IDS.includes(id)) this.drawIcon(card.querySelector('canvas'), statsUnit(race, id), id);
      else if (CONFIG.BUILDINGS[id]) this.drawBuildingIcon(card.querySelector('canvas'), id);
    }
  }

  drawIcon(canvas, u, id) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // uploaded thumbnail wins; then character art; then the plain shape
    ctx.save();
    ctx.translate(20, 21);
    if (drawThumb(ctx, id, 0, 36)) {
      ctx.restore();
      return;
    }
    ctx.restore();
    if (hasCharacter(id)) {
      ctx.save();
      ctx.translate(20, 21);
      drawCharacter(ctx, id, 'idle', 0, 0, Math.min(1.35, 34 / (u.radius * 2.8 + 4)));
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(20, 20);
    const r = Math.min(15, u.radius * 1.4 + 4);
    if (u.shape === 'ring') {
      ctx.strokeStyle = TEAM_COLORS[0];
      ctx.lineWidth = 3;
      drawShape(ctx, 'ring', r);
      ctx.stroke();
    } else {
      ctx.fillStyle = TEAM_COLORS[0];
      drawShape(ctx, u.shape, r);
      ctx.fill();
    }
    ctx.restore();
  }

  update(game, dt = 0) {
    const gens = game.countKind(0, 'generator');
    // Smoothly count the gold up so it climbs continuously at the income rate
    // (matching the "+X/s" label) instead of jumping in big chunks each tick.
    // Spends snap down immediately; any gap is closed within ~2s.
    const real = game.money[0];
    if (this.displayMoney == null || real <= this.displayMoney) {
      this.displayMoney = real;
    } else {
      const rate = Math.max(game.incomePerSecond(0), 10);
      const gap = real - this.displayMoney;
      this.displayMoney = Math.min(real, this.displayMoney + Math.max(rate, gap / 2) * dt);
    }
    this.el.money.textContent = Math.floor(this.displayMoney);
    this.el.income.textContent = `+${game.incomePerSecond(0)}/s · ${gens} gen`;
    this.el.tier.textContent = `TIER ${'I'.repeat(game.tier[0])}`;
    this.el.waveNum.textContent = game.waveCount + 1;
    this.el.waveTimer.textContent = Math.ceil(game.waveTimer);

    for (const t of [0, 1]) {
      const main = game.mainOf(t);
      const ratio = main ? Math.max(0, main.hp / main.maxHp) : 0;
      this.el.baseFill[t].style.width = `${ratio * 100}%`;
      this.el.baseNum[t].textContent = main ? Math.ceil(main.hp) : 0;
    }

    // card states
    for (const [id, card] of this.cards) {
      let cost;
      let locked = false;
      if (id === 'upgrade') {
        const maxed = game.tier[0] >= CONFIG.TIER_MAX;
        cost = maxed ? Infinity : game.tierUpCost(0);
        card.querySelector('#upgrade-cost').textContent = maxed ? 'MAX' : `◆ ${cost}`;
        card.querySelector('#tier-label').textContent = 'I'.repeat(game.tier[0]);
        card.querySelector('#upgrade-info').textContent = maxed
          ? 'All tiers unlocked'
          : game.tier[0] === 1
            ? 'Tier 2 unlocks: Bruiser, Lancer, Mender, Wasp'
            : 'Tier 3 unlocks: Siege Crab, Archon';
      } else if (CONFIG.BUILDINGS[id]) {
        const bs = game.bstat(0, id);
        cost = bs.cost;
        if (game.countKind(0, id) >= bs.cap) locked = true;
      } else {
        const us = game.ustat(0, id);
        cost = us.cost;
        locked = us.tier > game.tier[0];
      }
      card.classList.toggle('locked', locked);
      card.classList.toggle('disabled', !locked && game.money[0] < cost);
      card.classList.toggle('selected', this.uiState.selected === id);
    }
  }

  showMenu() {
    this.el.overlayTitle.innerHTML = 'DIRECT STRIKE <span class="accent">ONLINE</span>';
    this.el.overlayTitle.className = '';
    this.el.overlayMsg.classList.remove('hidden');
    this.el.overlayStats.classList.add('hidden');
    this.el.overlay.classList.add('visible');
  }

  showGameOver(game, playerWon) {
    this.el.overlayTitle.textContent = playerWon ? 'VICTORY' : 'DEFEAT';
    this.el.overlayTitle.className = playerWon ? 'victory' : 'defeat';
    this.el.overlayMsg.classList.add('hidden');
    this.el.overlayStats.innerHTML =
      `Waves fought: <b>${game.waveCount}</b> · ` +
      `Money spent: <b>${game.spent[0]}</b> · ` +
      `Tier reached: <b>${'I'.repeat(game.tier[0])}</b><br>` +
      `Play again — choose difficulty:`;
    this.el.overlayStats.classList.remove('hidden');
    this.el.overlay.classList.add('visible');
  }

  hideOverlay() {
    this.el.overlay.classList.remove('visible');
  }
}
