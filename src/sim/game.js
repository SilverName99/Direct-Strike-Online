// Simulation state root. HARD RULE: nothing in src/sim/ may touch the
// DOM or unseeded randomness. The sim advances only via
// update(FIXED_DT) and mutates only via issueCommand() — that boundary
// is what makes lockstep multiplayer possible later.

import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';
import { mulberry32 } from './rng.js';
import { makeBase } from './entity.js';
import { updateCombat, updateProjectiles } from './combat.js';
import { updateMovement } from './movement.js';
import { spawnWave } from './waves.js';

export class Game {
  constructor(seed, options = {}) {
    this.rng = mulberry32(seed);
    this.nextId = 1;
    this.time = 0;
    this.winner = null;

    this.money = [CONFIG.START_MONEY, CONFIG.START_MONEY];
    this.spent = [0, 0];
    this.incomeLevel = [0, 0];
    this.incomeMult = options.incomeMult || [1, 1];
    this.incomeTimer = 0;

    this.waveTimer = CONFIG.WAVE_INTERVAL;
    this.waveCount = 0;

    this.templates = [[], []]; // per team: {type, x, y}
    this.entities = [];
    this.projectiles = [];
    this.byId = new Map();
    this.events = []; // drained by the render layer

    const midY = CONFIG.FIELD_H / 2;
    this.bases = [
      makeBase(this, 0, CONFIG.BASE_X_LEFT, midY, CONFIG.BASE_HP, CONFIG.BASE_RADIUS),
      makeBase(this, 1, CONFIG.BASE_X_RIGHT, midY, CONFIG.BASE_HP, CONFIG.BASE_RADIUS),
    ];
  }

  incomePerTick(team) {
    return Math.round(
      (CONFIG.INCOME_BASE + this.incomeLevel[team] * CONFIG.INCOME_UPGRADE_BONUS) *
        this.incomeMult[team]
    );
  }

  incomePerSecond(team) {
    return this.incomePerTick(team) / CONFIG.INCOME_TICK;
  }

  incomeUpgradeCost(team) {
    return (
      CONFIG.INCOME_UPGRADE_BASE_COST +
      CONFIG.INCOME_UPGRADE_COST_STEP * this.incomeLevel[team]
    );
  }

  isValidPlacement(team, x, y) {
    const m = CONFIG.PLACE_MARGIN;
    if (y < m || y > CONFIG.FIELD_H - m) return false;
    if (team === 0) return x >= m && x <= CONFIG.ZONE_LEFT_MAX;
    return x >= CONFIG.ZONE_RIGHT_MIN && x <= CONFIG.FIELD_W - m;
  }

  issueCommand(cmd) {
    if (this.winner !== null) return { ok: false, reason: 'game-over' };

    if (cmd.type === 'buy') {
      const stats = UNITS[cmd.unitId];
      if (!stats) return { ok: false, reason: 'unknown-unit' };
      if (this.money[cmd.team] < stats.cost) return { ok: false, reason: 'money' };
      if (this.templates[cmd.team].length >= CONFIG.MAX_TEMPLATES)
        return { ok: false, reason: 'template-cap' };
      if (!this.isValidPlacement(cmd.team, cmd.x, cmd.y))
        return { ok: false, reason: 'zone' };
      this.money[cmd.team] -= stats.cost;
      this.spent[cmd.team] += stats.cost;
      this.templates[cmd.team].push({ type: cmd.unitId, x: cmd.x, y: cmd.y });
      return { ok: true };
    }

    if (cmd.type === 'upgradeIncome') {
      if (this.incomeLevel[cmd.team] >= CONFIG.INCOME_UPGRADE_MAX)
        return { ok: false, reason: 'max-level' };
      const cost = this.incomeUpgradeCost(cmd.team);
      if (this.money[cmd.team] < cost) return { ok: false, reason: 'money' };
      this.money[cmd.team] -= cost;
      this.spent[cmd.team] += cost;
      this.incomeLevel[cmd.team]++;
      return { ok: true };
    }

    return { ok: false, reason: 'unknown-command' };
  }

  update(dt) {
    if (this.winner !== null) return;
    this.time += dt;

    // Income
    this.incomeTimer += dt;
    while (this.incomeTimer >= CONFIG.INCOME_TICK) {
      this.incomeTimer -= CONFIG.INCOME_TICK;
      for (const t of [0, 1]) this.money[t] += this.incomePerTick(t);
    }

    // Waves
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer += CONFIG.WAVE_INTERVAL;
      spawnWave(this);
    }

    // Store previous positions for render interpolation
    for (const e of this.entities) {
      e.prevX = e.x;
      e.prevY = e.y;
    }

    updateCombat(this, dt);
    updateMovement(this, dt);
    updateProjectiles(this, dt);
    this.removeDead();

    for (const t of [0, 1]) {
      if (this.bases[t].hp <= 0) {
        this.bases[t].hp = 0;
        this.winner = 1 - t;
        this.events.push({ type: 'gameover', winner: this.winner });
      }
    }
  }

  removeDead() {
    const alive = [];
    for (const e of this.entities) {
      if (e.hp > 0) {
        alive.push(e);
      } else {
        this.byId.delete(e.id);
      }
    }
    this.entities = alive;
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}
