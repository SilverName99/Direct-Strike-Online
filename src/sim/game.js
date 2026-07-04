// Simulation state root. HARD RULE: nothing in src/sim/ may touch the
// DOM or unseeded randomness. The sim advances only via
// update(FIXED_DT) and mutates only via issueCommand() — that boundary
// is what makes lockstep multiplayer possible later.

import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';
import { mulberry32 } from './rng.js';
import { makeStructure } from './entity.js';
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
      makeStructure(this, 0, 'base', CONFIG.BASE_X[0], midY, CONFIG.BASE_HP, CONFIG.BASE_RADIUS),
      makeStructure(this, 1, 'base', CONFIG.BASE_X[1], midY, CONFIG.BASE_HP, CONFIG.BASE_RADIUS),
    ];
    this.turrets = [
      makeStructure(this, 0, 'turret', CONFIG.TURRET_X[0], midY, CONFIG.TURRET.hp, CONFIG.TURRET.radius),
      makeStructure(this, 1, 'turret', CONFIG.TURRET_X[1], midY, CONFIG.TURRET.hp, CONFIG.TURRET.radius),
    ];
  }

  // Live enemy structures a unit of `team` can attack (turret first is
  // irrelevant — targeting picks by distance).
  enemyStructures(team) {
    const out = [];
    const et = 1 - team;
    if (this.turrets[et] && this.turrets[et].hp > 0) out.push(this.turrets[et]);
    if (this.bases[et].hp > 0) out.push(this.bases[et]);
    return out;
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
    const z = CONFIG.BUILD_ZONE[team];
    return x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
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

    if (cmd.type === 'moveUnit') {
      const tpl = this.templates[cmd.team][cmd.index];
      if (!tpl) return { ok: false, reason: 'unknown-template' };
      if (!this.isValidPlacement(cmd.team, cmd.x, cmd.y))
        return { ok: false, reason: 'zone' };
      tpl.x = cmd.x;
      tpl.y = cmd.y;
      return { ok: true };
    }

    if (cmd.type === 'sellUnit') {
      const tpl = this.templates[cmd.team][cmd.index];
      if (!tpl) return { ok: false, reason: 'unknown-template' };
      this.templates[cmd.team].splice(cmd.index, 1);
      this.money[cmd.team] += Math.round(UNITS[tpl.type].cost * CONFIG.SELL_REFUND);
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

    // Destroyed turrets are gone for good — a permanent hole in the defense.
    for (const t of [0, 1]) {
      const turret = this.turrets[t];
      if (turret && turret.hp <= 0) {
        this.events.push({ type: 'structureDestroyed', x: turret.x, y: turret.y, team: t });
        this.byId.delete(turret.id);
        this.turrets[t] = null;
      }
    }

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
