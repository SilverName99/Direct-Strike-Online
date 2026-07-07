import { statsUnit, resolvedUpgrade } from './balance.js';
import { UPGRADE_IDS } from '../upgrades.js';
import { raceOf } from '../render/sprites.js';

// The shop / command grid moved to the bottom bar (src/ui/bottombar.js);
// the Hud keeps the top bar, the menu/game-over overlay and the base
// upgrades modal.

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
      overlay: document.getElementById('overlay'),
      overlayTitle: document.getElementById('overlay-title'),
      overlayMsg: document.getElementById('overlay-msg'),
      overlayStats: document.getElementById('overlay-stats'),
    };
    this.buildUpgradesModal();
  }

  // --- Base upgrades modal (opened by clicking your own Main Base) ----------
  buildUpgradesModal() {
    const style = document.createElement('style');
    style.textContent = `
      #upg-modal { position: fixed; inset: 0; display: none; z-index: 400;
        align-items: center; justify-content: center; background: rgba(5,8,12,0.68); backdrop-filter: blur(2px); }
      #upg-modal.on { display: flex; }
      .upg-panel { background: #131924; border: 1px solid #2a3446; border-radius: 14px;
        width: 460px; max-width: 94vw; max-height: 86vh; display: flex; flex-direction: column;
        box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
      .upg-head { display: flex; justify-content: space-between; align-items: center;
        padding: 14px 18px; border-bottom: 1px solid #2a3446; }
      .upg-head b { color: #ffb35c; font-size: 16px; }
      .upg-x { background: none; border: none; color: #7c8ba1; font-size: 17px; cursor: pointer; }
      .upg-x:hover { color: #dbe4f0; }
      .upg-body { padding: 12px 18px 16px; overflow-y: auto; }
      .upg-card { border: 1px solid #263143; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; background: #161c26; }
      .upg-card h4 { font-size: 14px; color: #ffb35c; margin-bottom: 3px; }
      .upg-card .d { font-size: 12px; color: #8393a8; line-height: 1.45; margin-bottom: 10px; }
      .upg-card .row { display: flex; align-items: center; gap: 10px; }
      .upg-card .cost { color: var(--gold, #ffcf4d); font-weight: 700; font-size: 13px; }
      .upg-buy { margin-left: auto; padding: 7px 16px; font-size: 12.5px; font-weight: 600; cursor: pointer;
        background: #1d4e89; color: #eaf1fb; border: 1px solid #4da6ff; border-radius: 8px; }
      .upg-buy:hover { background: #24609f; }
      .upg-buy:disabled { opacity: 0.4; cursor: default; }
      .upg-buy.owned { background: #1c3a24; border-color: #2f6b3e; color: #8fe0a6; }
      .upg-empty { color: #7c8ba1; font-size: 13px; padding: 10px 0; }
    `;
    document.head.appendChild(style);
    const m = document.createElement('div');
    m.id = 'upg-modal';
    m.innerHTML = `<div class="upg-panel">
      <div class="upg-head"><b>🐗 Upgrades — Bază</b><button class="upg-x">✕</button></div>
      <div class="upg-body"></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) this.closeUpgrades(); });
    m.querySelector('.upg-x').onclick = () => this.closeUpgrades();
    this.upgModal = m;
    this.upgBody = m.querySelector('.upg-body');
  }

  openUpgrades(game) {
    this.upgGame = game;
    this.renderUpgrades();
    this.upgModal.classList.add('on');
  }
  closeUpgrades() { this.upgModal.classList.remove('on'); }

  renderUpgrades() {
    const game = this.upgGame;
    if (!game) return;
    const race = raceOf(0);
    // only upgrades that target a unit of the player's race are buyable
    const buyable = UPGRADE_IDS.map((id) => ({ id, up: resolvedUpgrade(id) }))
      .filter((x) => x.up && x.up.unit && (!x.up.race || x.up.race === race));
    if (!buyable.length) {
      this.upgBody.innerHTML = '<div class="upg-empty">Niciun upgrade configurat. Setează unitatea-țintă în admin → 🐗 Upgrades.</div>';
      return;
    }
    this.upgBody.innerHTML = buyable.map(({ id, up }) => {
      const owned = game.upgrades[0].has(id);
      const cost = up.params.cost || 0;
      const afford = game.money[0] >= cost;
      const uname = (statsUnit(up.race || race, up.unit) || {}).name || up.unit;
      const btn = owned
        ? '<button class="upg-buy owned" disabled>Cumpărat ✓</button>'
        : `<button class="upg-buy" data-buy="${id}" ${afford ? '' : 'disabled'}>Cumpără</button>`;
      return `<div class="upg-card">
        <h4>${up.name}</h4>
        <div class="d">${up.desc}<br><b style="color:#b9c4d4">Unitate: ${uname}</b></div>
        <div class="row"><span class="cost">◆ ${cost}</span>${btn}</div>
      </div>`;
    }).join('');
    for (const b of this.upgBody.querySelectorAll('[data-buy]')) {
      b.onclick = () => {
        game.issueCommand({ type: 'buyUpgrade', team: 0, id: b.dataset.buy });
        this.renderUpgrades();
      };
    }
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
      // glide continuously: never slower than the true income rate, with the
      // backlog eased in exponentially (~0.7s) so income ticks never step
      const gap = real - this.displayMoney;
      const rate = game.incomePerSecond(0) + gap * 1.5;
      this.displayMoney = Math.min(real, this.displayMoney + rate * dt);
    }
    this.el.money.textContent = Math.floor(this.displayMoney);
    const mid = game.midBonusPerTick(0) > 0 ? ' · +mid' : '';
    this.el.income.textContent = `+${game.incomePerSecond(0).toFixed(1).replace(/\.0$/, '')}/s · ${gens} gen${mid}`;
    this.el.tier.textContent = `TIER ${'I'.repeat(game.tier[0])}`;
    this.el.waveNum.textContent = game.waveCount + 1;
    this.el.waveTimer.textContent = Math.ceil(game.waveTimer);

    for (const t of [0, 1]) {
      const main = game.mainOf(t);
      const ratio = main ? Math.max(0, main.hp / main.maxHp) : 0;
      this.el.baseFill[t].style.width = `${ratio * 100}%`;
      this.el.baseNum[t].textContent = main ? Math.ceil(main.hp) : 0;
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
