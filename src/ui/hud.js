// The shop / command grid moved to the bottom bar (src/ui/bottombar.js) —
// base upgrades included (click your Main Base). The Hud keeps the top bar
// and the menu / game-over overlay.

export class Hud {
  constructor(uiState) {
    this.uiState = uiState;
    this.el = {
      money: document.getElementById('money'),
      income: document.getElementById('income'),
      food: document.getElementById('food'),
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
    if (this.el.food) {
      const used = game.foodUsed(0);
      const cap = game.foodCap(0);
      this.el.food.textContent = `🍖 ${used}/${cap}`;
      this.el.food.classList.toggle('food-full', used >= cap);
    }
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
