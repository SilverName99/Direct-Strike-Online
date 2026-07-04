import { CONFIG } from '../config.js';
import { UNITS, UNIT_IDS } from '../units.js';
import { drawShape, TEAM_COLORS } from '../render/renderer.js';

export class Hud {
  constructor(uiState) {
    this.uiState = uiState;
    this.el = {
      money: document.getElementById('money'),
      income: document.getElementById('income'),
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
    let hotkey = 1;
    for (const id of UNIT_IDS) {
      const u = UNITS[id];
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.unit = id;
      const dps = u.heal
        ? `${(u.damage / u.period).toFixed(0)} HP/s heal`
        : `${(u.damage / u.period).toFixed(1)} DPS (${u.dmgType})`;
      card.innerHTML = `
        <span class="c-hotkey">${hotkey <= 9 ? hotkey : ''}</span>
        <canvas width="40" height="40"></canvas>
        <span class="c-name">${u.name}</span>
        <span class="c-cost">◆ ${u.cost}</span>
        <div class="c-tip">
          <div class="t-role">${u.role}</div>
          <div>${u.tip}</div>
          <div class="t-stats">${u.hp} HP · ${u.armor} · ${dps}<br>range ${u.range} · speed ${u.speed}</div>
        </div>`;
      this.drawIcon(card.querySelector('canvas'), u);
      shop.appendChild(card);
      this.cards.set(id, card);
      hotkey++;
    }

    // income upgrade card
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.unit = 'income';
    card.innerHTML = `
      <span class="c-hotkey">0</span>
      <canvas width="40" height="40"></canvas>
      <span class="c-name">Income</span>
      <span class="c-cost" id="income-cost">◆ ${CONFIG.INCOME_UPGRADE_BASE_COST}</span>
      <div class="c-tip">
        <div class="t-role">Economy upgrade</div>
        <div>Permanently +${CONFIG.INCOME_UPGRADE_BONUS / CONFIG.INCOME_TICK}/s income. Buys instantly.</div>
        <div class="t-stats" id="income-level">Level 0 / ${CONFIG.INCOME_UPGRADE_MAX}</div>
      </div>`;
    const ictx = card.querySelector('canvas').getContext('2d');
    ictx.fillStyle = '#ffd35c';
    ictx.font = 'bold 26px sans-serif';
    ictx.textAlign = 'center';
    ictx.textBaseline = 'middle';
    ictx.fillText('◆', 20, 22);
    this.el.shop.appendChild(card);
    this.cards.set('income', card);
  }

  drawIcon(canvas, u) {
    const ctx = canvas.getContext('2d');
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

  update(game) {
    this.el.money.textContent = Math.floor(game.money[0]);
    this.el.income.textContent = `+${game.incomePerSecond(0)}/s · income lvl ${game.incomeLevel[0]}`;
    this.el.waveNum.textContent = game.waveCount + 1;
    this.el.waveTimer.textContent = Math.ceil(game.waveTimer);

    for (const t of [0, 1]) {
      const ratio = Math.max(0, game.bases[t].hp / game.bases[t].maxHp);
      this.el.baseFill[t].style.width = `${ratio * 100}%`;
      this.el.baseNum[t].textContent = Math.ceil(game.bases[t].hp);
    }

    // card states
    for (const [id, card] of this.cards) {
      let cost;
      if (id === 'income') {
        const maxed = game.incomeLevel[0] >= CONFIG.INCOME_UPGRADE_MAX;
        cost = maxed ? Infinity : game.incomeUpgradeCost(0);
        card.querySelector('#income-cost').textContent = maxed ? 'MAX' : `◆ ${cost}`;
        card.querySelector('#income-level').textContent =
          `Level ${game.incomeLevel[0]} / ${CONFIG.INCOME_UPGRADE_MAX}`;
      } else {
        cost = UNITS[id].cost;
      }
      card.classList.toggle('disabled', game.money[0] < cost);
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
      `Army size: <b>${game.templates[0].length}</b> units<br>` +
      `Play again — choose difficulty:`;
    this.el.overlayStats.classList.remove('hidden');
    this.el.overlay.classList.add('visible');
  }

  hideOverlay() {
    this.el.overlay.classList.remove('visible');
  }
}
