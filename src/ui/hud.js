// The shop / command grid moved to the bottom bar (src/ui/bottombar.js) —
// base upgrades included (click your Main Base). The Hud keeps the top bar,
// the hero badge (left edge) and the menu / game-over overlay.

import { drawThumb } from '../render/characters.js';
import { raceOf } from '../render/sprites.js';

export class Hud {
  constructor(uiState) {
    this.uiState = uiState;
    this.heroBadge = {
      root: document.getElementById('hero-badge'),
      thumb: document.getElementById('hero-badge-thumb'),
      lvl: document.getElementById('hero-badge-lvl'),
      fill: document.getElementById('hero-badge-fill'),
      key: '',      // race:type of the drawn thumb (redraw on change)
      redrawAt: 0,  // periodic redraw so late-loading sprites appear
    };
    // click -> open the hero in the selection panel (live entity if alive,
    // otherwise its template), same as clicking it on the battlefield
    if (this.heroBadge.root) {
      this.heroBadge.root.addEventListener('click', () => {
        const game = this.game;
        if (!game) return;
        const ent = game.entities.find((e) => e.team === 0 && e.hero && e.hp > 0);
        if (ent) { this.uiState.inspect = { kind: 'entity', id: ent.id }; return; }
        const idx = game.templates[0].findIndex((t) => t.hero);
        if (idx !== -1) this.uiState.inspect = { kind: 'template', index: idx };
      });
    }
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

    this.game = game; // for the badge click handler
    this.updateHeroBadge(game);
  }

  // Left-edge hero badge: visible once the hero is bought; thumb + level +
  // % progress toward the next level, live, without having to click the hero.
  updateHeroBadge(game) {
    const b = this.heroBadge;
    if (!b.root) return;
    const tpl = game ? game.heroTemplate(0) : null;
    b.root.classList.toggle('hidden', !tpl);
    if (!tpl) { b.key = ''; return; }

    const s = game.ustat(0, tpl.type);
    const level = tpl.level || 1;
    const need = (s.levelXp || [])[level - 1];
    const pct = level >= 10 || !(need > 0) ? 100 : Math.min(100, ((tpl.xp || 0) / need) * 100);
    const points = tpl.points || 0;
    const lvlText = `LVL ${level}${points > 0 ? ` (+${points})` : ''}`;
    if (b.lvl.textContent !== lvlText) b.lvl.textContent = lvlText;
    b.fill.style.width = `${pct.toFixed(1)}%`;
    b.lvl.title = level >= 10 ? 'Nivel maxim' : `${Math.floor(tpl.xp || 0)} / ${need} XP`;

    // (re)draw the thumb when the hero type/race changes, and periodically so
    // a thumb that finishes loading after match start still shows up
    const key = `${raceOf(0)}:${tpl.type}`;
    const now = performance.now();
    if (key !== b.key || now >= b.redrawAt) {
      b.key = key;
      b.redrawAt = now + 1500;
      const ctx = b.thumb.getContext('2d');
      ctx.clearRect(0, 0, 64, 64);
      ctx.save();
      ctx.translate(32, 34); // drawThumb draws centered on the origin
      const drawn = drawThumb(ctx, tpl.type, 0, 58);
      ctx.restore();
      if (!drawn) {
        // no uploaded thumb: a simple star placeholder so the badge still reads
        ctx.fillStyle = '#ffd35c';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', 32, 34);
      }
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
