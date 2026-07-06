// Simulation state root. HARD RULE: nothing in src/sim/ may touch the
// DOM or unseeded randomness. The sim advances only via
// update(FIXED_DT) and mutates only via issueCommand() — that boundary
// is what makes lockstep multiplayer possible later.

import { CONFIG, RACES } from '../config.js';
import { statsUnit, statsBuilding } from '../ui/balance.js';
import { mulberry32 } from './rng.js';
import { makeStructure, structureExtents } from './entity.js';
import { updateCombat, updateProjectiles } from './combat.js';
import { updateMovement } from './movement.js';
import { updateAbilities } from './abilities.js';
import { spawnWave } from './waves.js';

export class Game {
  constructor(seed, options = {}) {
    this.rng = mulberry32(seed);
    this.nextId = 1;
    this.time = 0;
    this.winner = null;

    // each team plays a race; unit stats resolve per race
    this.races = options.races || [RACES[0], RACES[0]];

    this.money = [CONFIG.START_MONEY, CONFIG.START_MONEY];
    this.spent = [0, 0];
    this.tier = [1, 1];
    this.incomeMult = options.incomeMult || [1, 1];
    this.incomeTimer = 0;

    this.waveTimer = CONFIG.WAVE_INTERVAL;
    this.waveCount = 0;

    this.templates = [[], []]; // per team: {type, x, y}
    this.entities = [];
    this.projectiles = [];
    this.structures = [];
    this.byId = new Map();
    this.events = []; // drained by the render layer

    for (const t of [0, 1]) {
      makeStructure(this, t, 'main', CONFIG.MAIN.x[t], CONFIG.MAIN.y);
      makeStructure(this, t, 'turret', CONFIG.TURRET_X[t], CONFIG.FIELD_H / 2);
    }
  }

  // Resolved unit stats for a team, per its race.
  ustat(team, type) {
    return statsUnit(this.races[team], type);
  }

  // Resolved building stats for a team, per its race.
  bstat(team, kind) {
    return statsBuilding(this.races[team], kind);
  }

  mainOf(team) {
    return this.structures.find((s) => s.team === team && s.kind === 'main') || null;
  }

  enemyStructures(team) {
    return this.structures.filter((s) => s.team !== team && s.hp > 0);
  }

  countKind(team, kind) {
    let n = 0;
    for (const s of this.structures) {
      if (s.team === team && s.kind === kind && s.hp > 0) n++;
    }
    return n;
  }

  incomePerTick(team) {
    const gens = this.countKind(team, 'generator');
    return Math.round(
      (CONFIG.INCOME_BASE + gens * this.bstat(team, 'generator').income) * this.incomeMult[team]
    );
  }

  incomePerSecond(team) {
    return this.incomePerTick(team) / CONFIG.INCOME_TICK;
  }

  tierUpCost(team) {
    return CONFIG.TIER_COSTS[this.tier[team] + 1] ?? null;
  }

  inZone(zone, x, y) {
    return x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1;
  }

  // Unit templates go in the army strip, spaced apart. A unit with a footprint
  // bigger than 1x1 (cw/ch grid cells) occupies that whole box: it must fit the
  // zone and not overlap another template's box. Plain 1x1 units keep the old
  // tight min-dist packing so formations stay dense.
  footprintHalf(team, unitId) {
    const g = CONFIG.GRID;
    const us = unitId ? this.ustat(team, unitId) : null;
    const cw = us && us.cw > 1 ? us.cw : 0;
    const ch = us && us.ch > 1 ? us.ch : 0;
    return { hw: cw ? (cw * g) / 2 : 0, hh: ch ? (ch * g) / 2 : 0 };
  }

  isValidPlacement(team, x, y, ignoreIndex = -1, unitId = null) {
    const zone = CONFIG.ARMY_ZONE[team];
    const { hw, hh } = this.footprintHalf(team, unitId);
    // the footprint (a point for 1x1 units) must sit inside the army zone
    if (x - hw < zone.x0 || x + hw > zone.x1 || y - hh < zone.y0 || y + hh > zone.y1) return false;
    const min = CONFIG.TEMPLATE_MIN_DIST;
    for (let i = 0; i < this.templates[team].length; i++) {
      if (i === ignoreIndex) continue;
      const tpl = this.templates[team][i];
      const t = this.footprintHalf(team, tpl.type);
      if (hw || hh || t.hw || t.hh) {
        // box separation when either unit has a real footprint (1x1 uses a
        // half-min-dist box so it can't sit on top of a big unit)
        const ahw = hw || min / 2, ahh = hh || min / 2;
        const bhw = t.hw || min / 2, bhh = t.hh || min / 2;
        if (Math.abs(tpl.x - x) < ahw + bhw && Math.abs(tpl.y - y) < ahh + bhh) return false;
      } else if ((tpl.x - x) ** 2 + (tpl.y - y) ** 2 < min * min) {
        return false; // both plain 1x1: original tight circle packing
      }
    }
    return true;
  }

  // Buildings go in the construction zone, without overlapping structures.
  // Footprint is a cw x ch cell rectangle; the whole box must fit the zone
  // and stay clear of existing structures (both treated as boxes).
  isValidBuildPlacement(team, kind, x, y) {
    if (!CONFIG.BUILDINGS[kind]) return false;
    const ext = structureExtents(kind, this.bstat(team, kind));
    const zone = CONFIG.CONSTRUCTION_ZONE[team];
    if (x - ext.hw < zone.x0 || x + ext.hw > zone.x1) return false;
    if (y - ext.hh < zone.y0 || y + ext.hh > zone.y1) return false;
    const gap = CONFIG.BUILD_GAP;
    for (const s of this.structures) {
      if (s.hp <= 0) continue;
      const sw = s.hw || s.radius;
      const sh = s.hh || s.radius;
      if (Math.abs(s.x - x) < ext.hw + sw + gap &&
          Math.abs(s.y - y) < ext.hh + sh + gap) return false;
    }
    return true;
  }

  issueCommand(cmd) {
    if (this.winner !== null) return { ok: false, reason: 'game-over' };

    if (cmd.type === 'buy') {
      const stats = this.ustat(cmd.team, cmd.unitId);
      if (!stats) return { ok: false, reason: 'unknown-unit' };
      if (stats.tier > this.tier[cmd.team]) return { ok: false, reason: 'tier-locked' };
      if (this.money[cmd.team] < stats.cost) return { ok: false, reason: 'money' };
      if (this.templates[cmd.team].length >= CONFIG.MAX_TEMPLATES)
        return { ok: false, reason: 'template-cap' };
      if (!this.isValidPlacement(cmd.team, cmd.x, cmd.y, -1, cmd.unitId))
        return { ok: false, reason: 'zone' };
      this.money[cmd.team] -= stats.cost;
      this.spent[cmd.team] += stats.cost;
      this.templates[cmd.team].push({ type: cmd.unitId, x: cmd.x, y: cmd.y });
      return { ok: true };
    }

    if (cmd.type === 'moveUnit') {
      const tpl = this.templates[cmd.team][cmd.index];
      if (!tpl) return { ok: false, reason: 'unknown-template' };
      if (!this.isValidPlacement(cmd.team, cmd.x, cmd.y, cmd.index, tpl.type))
        return { ok: false, reason: 'zone' };
      tpl.x = cmd.x;
      tpl.y = cmd.y;
      return { ok: true };
    }

    if (cmd.type === 'sellUnit') {
      const tpl = this.templates[cmd.team][cmd.index];
      if (!tpl) return { ok: false, reason: 'unknown-template' };
      this.templates[cmd.team].splice(cmd.index, 1);
      this.money[cmd.team] += Math.round(this.ustat(cmd.team, tpl.type).cost * CONFIG.SELL_REFUND);
      return { ok: true };
    }

    if (cmd.type === 'build') {
      if (!CONFIG.BUILDINGS[cmd.kind]) return { ok: false, reason: 'unknown-building' };
      const stats = this.bstat(cmd.team, cmd.kind);
      if (this.money[cmd.team] < stats.cost) return { ok: false, reason: 'money' };
      if (this.countKind(cmd.team, cmd.kind) >= stats.cap)
        return { ok: false, reason: 'cap' };
      if (!this.isValidBuildPlacement(cmd.team, cmd.kind, cmd.x, cmd.y))
        return { ok: false, reason: 'zone' };
      this.money[cmd.team] -= stats.cost;
      this.spent[cmd.team] += stats.cost;
      makeStructure(this, cmd.team, cmd.kind, cmd.x, cmd.y);
      return { ok: true };
    }

    if (cmd.type === 'sellBuilding') {
      const s = this.byId.get(cmd.id);
      if (!s || !s.isStructure || s.team !== cmd.team || s.hp <= 0)
        return { ok: false, reason: 'unknown-building' };
      if (s.kind === 'main' || s.kind === 'turret')
        return { ok: false, reason: 'not-sellable' };
      this.money[cmd.team] += Math.round(
        this.bstat(s.team, s.kind).cost * CONFIG.SELL_BUILDING_REFUND
      );
      this.removeStructure(s, false);
      return { ok: true };
    }

    if (cmd.type === 'upgradeBase') {
      if (this.tier[cmd.team] >= CONFIG.TIER_MAX) return { ok: false, reason: 'max-tier' };
      const cost = this.tierUpCost(cmd.team);
      if (this.money[cmd.team] < cost) return { ok: false, reason: 'money' };
      this.money[cmd.team] -= cost;
      this.spent[cmd.team] += cost;
      this.tier[cmd.team]++;
      const main = this.mainOf(cmd.team);
      if (main) {
        main.maxHp = this.bstat(cmd.team, 'main').hp[this.tier[cmd.team] - 1];
        main.hp = Math.min(main.maxHp, main.hp + 1000);
      }
      this.events.push({ type: 'tierUp', team: cmd.team, tier: this.tier[cmd.team] });
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

    updateAbilities(this, dt); // auras/status effects first, combat reads them
    updateCombat(this, dt);
    updateMovement(this, dt);
    updateProjectiles(this, dt);
    this.removeDead();

    // Destroyed structures are gone for good; losing the main base loses
    // the game.
    for (const s of [...this.structures]) {
      if (s.hp <= 0) this.removeStructure(s, true);
    }
  }

  removeStructure(s, destroyed) {
    if (destroyed) {
      this.events.push({ type: 'structureDestroyed', x: s.x, y: s.y, team: s.team, kind: s.kind });
      if (s.kind === 'main' && this.winner === null) {
        s.hp = 0;
        this.winner = 1 - s.team;
        this.events.push({ type: 'gameover', winner: this.winner });
        return; // keep the ruined main for the end-screen render
      }
    }
    this.byId.delete(s.id);
    this.structures = this.structures.filter((x) => x !== s);
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
