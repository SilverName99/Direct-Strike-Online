// The shop / command grid moved to the bottom bar (src/ui/bottombar.js) —
// base upgrades included (click your Main Base). The Hud keeps the top bar,
// the hero badge (left edge) and the menu / game-over overlay.

import { CONFIG } from '../config.js';
import { raceOf, getThumb, pickImg } from '../render/sprites.js';

export class Hud {
  constructor(uiState) {
    this.uiState = uiState;
    // the team this HUD reports on: 0 in single player, assigned online
    Object.defineProperty(this, 'team', { get: () => this.uiState.myTeam || 0 });
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
        const ent = game.entities.find((e) => e.team === this.team && e.hero && e.hp > 0);
        if (ent) { this.uiState.inspect = { kind: 'entity', id: ent.id }; return; }
        const idx = game.templates[this.team].findIndex((t) => t.hero);
        if (idx !== -1) this.uiState.inspect = { kind: 'template', index: idx };
      });
    }
    this.el = {
      money: document.getElementById('money'),
      moneyIcon: document.querySelector('#chip-gold .money-icon'),
      income: document.getElementById('income'),
      food: document.getElementById('food'),
      tier: document.getElementById('tier'),
      waveNum: document.getElementById('wave-num'),
      waveTimer: document.getElementById('wave-timer'),
      baseFill: [document.getElementById('base-hp-0'), document.getElementById('base-hp-1')],
      baseNum: [document.getElementById('base-hp-0-num'), document.getElementById('base-hp-1-num')],
    };
  }

  update(game, dt = 0) {
    // Smoothly count the gold up so it climbs continuously at the income rate
    // (matching the "+X/s" label) instead of jumping in big chunks each tick.
    // Spends snap down immediately; any gap is closed within ~2s.
    const real = game.money[this.team];
    if (this.displayMoney == null || real <= this.displayMoney) {
      this.displayMoney = real;
    } else {
      // glide continuously: never slower than the true income rate, with the
      // backlog eased in exponentially (~0.7s) so income ticks never step
      const gap = real - this.displayMoney;
      const rate = game.incomePerSecond(this.team) + gap * 1.5;
      this.displayMoney = Math.min(real, this.displayMoney + rate * dt);
    }
    this.el.money.textContent = Math.floor(this.displayMoney);
    // custom gold icon (admin-uploaded data URL) replaces the ◆ glyph
    if (this.el.moneyIcon && this.goldIconKey !== CONFIG.GOLD_ICON) {
      this.goldIconKey = CONFIG.GOLD_ICON;
      this.el.moneyIcon.textContent = '';
      if (CONFIG.GOLD_ICON) {
        const img = document.createElement('img');
        img.className = 'gold-img';
        img.src = CONFIG.GOLD_ICON;
        img.alt = '';
        this.el.moneyIcon.appendChild(img);
      } else {
        this.el.moneyIcon.textContent = '◆';
      }
    }
    // income line: total per second (mid folded in) with the mid share in parens
    const fmt = (v) => v.toFixed(1).replace(/\.0$/, '');
    const total = game.incomePerSecond(this.team);
    const midPerSec = game.midBonusPerTick(this.team) / CONFIG.INCOME_TICK;
    this.el.income.textContent = midPerSec > 0
      ? `+${fmt(total)}/s (${fmt(midPerSec)}/s mid)`
      : `+${fmt(total)}/s`;
    this.el.tier.textContent = `TIER ${'I'.repeat(game.tier[this.team])}`;
    if (this.el.food) {
      const used = game.foodUsed(this.team);
      const cap = game.foodCap(this.team);
      this.el.food.textContent = `${used}/${cap}`;
      this.el.food.classList.toggle('food-full', used >= cap);
    }
    this.el.waveNum.textContent = game.waveCount + 1;
    this.el.waveTimer.textContent = Math.ceil(game.waveTimer);

    // (the top-bar base HP bars were removed — the mains show their HP over the
    // buildings in-world; guard in case the elements are still wired elsewhere)
    for (const t of [0, 1]) {
      if (!this.el.baseFill[t]) continue;
      const main = game.mainOf(t);
      const ratio = main ? Math.max(0, main.hp / main.maxHp) : 0;
      this.el.baseFill[t].style.width = `${ratio * 100}%`;
      if (this.el.baseNum[t]) this.el.baseNum[t].textContent = main ? Math.ceil(main.hp) : 0;
    }

    this.game = game; // for the badge click handler
    this.updateHeroBadge(game);
  }

  // Left-edge hero badge: visible once the hero is bought; thumb + level +
  // % progress toward the next level, live, without having to click the hero.
  updateHeroBadge(game) {
    const b = this.heroBadge;
    if (!b.root) return;
    const tpl = game ? game.heroTemplate(this.team) : null;
    b.root.classList.toggle('hidden', !tpl);
    if (!tpl) { b.key = ''; return; }

    const s = game.ustat(this.team, tpl.type);
    const level = tpl.level || 1;
    const need = (s.levelXp || [])[level - 1];
    const pct = level >= 10 || !(need > 0) ? 100 : Math.min(100, ((tpl.xp || 0) / need) * 100);
    const points = tpl.points || 0;
    const lvlText = `LVL ${level}${points > 0 ? ` (+${points})` : ''}`;
    if (b.lvl.textContent !== lvlText) b.lvl.textContent = lvlText;
    b.fill.style.width = `${pct.toFixed(1)}%`;
    b.lvl.title = level >= 10 ? 'Nivel maxim' : `${Math.floor(tpl.xp || 0)} / ${need} XP`;

    // (re)draw the thumb when the hero type/race changes, and periodically so
    // a thumb that finishes loading after match start still shows up.
    // SQUARE + SHARP: the backing store runs at the real device resolution
    // (devicePixelRatio) and the thumb image cover-fills the square (center
    // crop, biased toward the top so the head never gets cut).
    const key = `${raceOf(this.team)}:${tpl.type}`;
    const now = performance.now();
    if (key !== b.key || now >= b.redrawAt) {
      b.key = key;
      b.redrawAt = now + 1500;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const size = Math.round(64 * dpr);
      if (b.thumb.width !== size) { b.thumb.width = size; b.thumb.height = size; }
      const ctx = b.thumb.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const entry = getThumb(raceOf(this.team), tpl.type);
      const img = entry ? pickImg(entry, this.team) : null;
      if (img && img.width) {
        const scale = Math.max(size / img.width, size / img.height); // cover
        const cropW = size / scale;
        const cropH = size / scale;
        const sx = (img.width - cropW) / 2;          // center horizontally
        const sy = (img.height - cropH) * 0.25;      // bias toward the top
        ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, size, size);
      } else {
        // no uploaded thumb: a simple star placeholder so the badge still reads
        ctx.fillStyle = '#ffd35c';
        ctx.font = `bold ${Math.round(40 * dpr)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', size / 2, size / 2 + 2 * dpr);
      }
    }
  }

}
