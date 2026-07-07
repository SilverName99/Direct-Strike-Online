// Simulation state root. HARD RULE: nothing in src/sim/ may touch the
// DOM or unseeded randomness. The sim advances only via
// update(FIXED_DT) and mutates only via issueCommand() — that boundary
// is what makes lockstep multiplayer possible later.

import { CONFIG, RACES } from '../config.js';
import { statsUnit, statsBuilding, resolvedUpgrade, resolvedAbility } from '../ui/balance.js';
import { UPGRADE_IDS } from '../upgrades.js';
import { ABILITY_IDS } from '../abilities.js';
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
    this.upgrades = [new Set(), new Set()]; // bought upgrade ids, per team (permanent)
    // Player-facing toggles (via the selection panel). Both are OFF-lists so
    // everything defaults to ON (the AI never toggles — full behavior).
    this.abilityOff = [new Set(), new Set()]; // per team: `${unitType}/${abilityId}` autocast disabled
    this.upgradeOff = [new Set(), new Set()]; // per team: upgrade id owned but deactivated
    this.incomeMult = options.incomeMult || [1, 1];
    this.incomeTimer = 0;

    this.waveTimer = CONFIG.WAVE_INTERVAL;
    this.waveCount = 0;

    this.templates = [[], []]; // per team: {type, x, y}
    this.buildReadyAt = [{}, {}]; // per team: building kind -> game.time it can be built again
    this.midOwner = null;      // control point: last team to push a unit past midfield
    this.midWas = [false, false]; // had units past mid last tick (crossing edge-detect)
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

  // Can this team's unit TYPE use an ability right now? Respects the per-type
  // autocast toggle and the ability's required base tier (params.tier, min 1).
  abilityUsable(team, unitType, aid) {
    if (this.abilityOff[team].has(`${unitType}/${aid}`)) return false;
    const ab = resolvedAbility(aid);
    const req = Math.max(1, (ab && ab.params && ab.params.tier) || 1);
    return this.tier[team] >= req;
  }

  // An upgrade counts only while owned AND not deactivated from the panel.
  upgradeActive(team, id) {
    return this.upgrades[team].has(id) && !this.upgradeOff[team].has(id);
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

  // Income amounts are configured per INCOME_WINDOW (20s); each INCOME_TICK
  // pays the proportional slice so gold still flows in smoothly.
  incomePer20s(team) {
    const gens = this.countKind(team, 'generator');
    return (CONFIG.INCOME_BASE + gens * this.bstat(team, 'generator').income) * this.incomeMult[team];
  }

  incomePerTick(team) {
    return Math.round(this.incomePer20s(team) * (CONFIG.INCOME_TICK / CONFIG.INCOME_WINDOW));
  }

  // Seconds left until this team may build that kind again (build cooldown).
  buildCdLeft(team, kind) {
    return Math.max(0, (this.buildReadyAt[team][kind] || 0) - this.time);
  }

  // "Holding the middle": true while this team has a unit past midfield.
  midHeld(team) {
    const mid = CONFIG.FIELD_W / 2;
    return this.entities.some((e) => (team === 0 ? e.x > mid : e.x < mid));
  }

  // Aggression reward: the middle is a CONTROL POINT. Crossing it captures it
  // once; the owner keeps the extra income until the OTHER team pushes a unit
  // past the middle and steals it.
  midBonusPerTick(team) {
    if (!CONFIG.MID_INCOME || this.midOwner !== team) return 0;
    return Math.round(CONFIG.MID_INCOME * (CONFIG.INCOME_TICK / CONFIG.INCOME_WINDOW));
  }

  // Capture on the crossing EDGE: a team that newly gets units past midfield
  // takes ownership; ownership then persists (even with no units there) until
  // the enemy crosses in turn.
  updateMidControl() {
    for (const t of [0, 1]) {
      const has = this.midHeld(t);
      if (has && !this.midWas[t] && this.midOwner !== t) this.midOwner = t;
      this.midWas[t] = has;
    }
  }

  incomePerSecond(team) {
    return (this.incomePerTick(team) + this.midBonusPerTick(team)) / CONFIG.INCOME_TICK;
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
    // buildings may go in the base construction zone OR the small forward
    // pocket around the mid turret; the whole box must fit inside one of them
    const zones = [CONFIG.CONSTRUCTION_ZONE[team]];
    if (CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[team]) zones.push(CONFIG.MID_BUILD_ZONE[team]);
    const fits = zones.some((z) =>
      x - ext.hw >= z.x0 && x + ext.hw <= z.x1 && y - ext.hh >= z.y0 && y + ext.hh <= z.y1);
    if (!fits) return false;
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
      this.templates[cmd.team].push({ type: cmd.unitId, x: cmd.x, y: cmd.y, spawned: false });
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
      // full refund for a unit that has never spawned yet (bought this wave and
      // sold before it ever hit the field); the usual partial refund otherwise
      const refund = tpl.spawned ? CONFIG.SELL_REFUND : 1;
      this.money[cmd.team] += Math.round(this.ustat(cmd.team, tpl.type).cost * refund);
      return { ok: true };
    }

    if (cmd.type === 'build') {
      if (!CONFIG.BUILDINGS[cmd.kind]) return { ok: false, reason: 'unknown-building' };
      const stats = this.bstat(cmd.team, cmd.kind);
      if (this.buildCdLeft(cmd.team, cmd.kind) > 0) return { ok: false, reason: 'cooldown' };
      if (this.money[cmd.team] < stats.cost) return { ok: false, reason: 'money' };
      if (this.countKind(cmd.team, cmd.kind) >= stats.cap)
        return { ok: false, reason: 'cap' };
      if (!this.isValidBuildPlacement(cmd.team, cmd.kind, cmd.x, cmd.y))
        return { ok: false, reason: 'zone' };
      this.money[cmd.team] -= stats.cost;
      this.spent[cmd.team] += stats.cost;
      if (stats.buildCd > 0) this.buildReadyAt[cmd.team][cmd.kind] = this.time + stats.buildCd;
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

    if (cmd.type === 'buyUpgrade') {
      if (!UPGRADE_IDS.includes(cmd.id)) return { ok: false, reason: 'unknown-upgrade' };
      const up = resolvedUpgrade(cmd.id);
      if (!up || !up.unit) return { ok: false, reason: 'no-unit' }; // must target a unit
      if (up.race && up.race !== this.races[cmd.team]) return { ok: false, reason: 'wrong-race' };
      if (this.upgrades[cmd.team].has(cmd.id)) return { ok: false, reason: 'owned' };
      const cost = up.params.cost || 0;
      if (this.money[cmd.team] < cost) return { ok: false, reason: 'money' };
      this.money[cmd.team] -= cost;
      this.spent[cmd.team] += cost;
      this.upgrades[cmd.team].add(cmd.id);
      this.events.push({ type: 'upgradeBought', team: cmd.team, id: cmd.id });
      return { ok: true };
    }

    // Autocast on/off for one ability on one unit TYPE (selection panel).
    if (cmd.type === 'toggleAbility') {
      if (!ABILITY_IDS.includes(cmd.ability)) return { ok: false, reason: 'unknown-ability' };
      if (!this.ustat(cmd.team, cmd.unit)) return { ok: false, reason: 'unknown-unit' };
      const key = `${cmd.unit}/${cmd.ability}`;
      if (cmd.on) this.abilityOff[cmd.team].delete(key);
      else this.abilityOff[cmd.team].add(key);
      return { ok: true };
    }

    // Activate/deactivate an ALREADY-OWNED upgrade (selection panel).
    if (cmd.type === 'toggleUpgrade') {
      if (!this.upgrades[cmd.team].has(cmd.id)) return { ok: false, reason: 'not-owned' };
      if (cmd.on) this.upgradeOff[cmd.team].delete(cmd.id);
      else this.upgradeOff[cmd.team].add(cmd.id);
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
      for (const t of [0, 1]) this.money[t] += this.incomePerTick(t) + this.midBonusPerTick(t);
    }

    // Turret HP regen (per-race stat; 0 = off)
    for (const s of this.structures) {
      if (s.kind !== 'turret' || s.hp <= 0 || s.hp >= s.maxHp) continue;
      const regen = this.bstat(s.team, 'turret').regen || 0;
      if (regen > 0) s.hp = Math.min(s.maxHp, s.hp + regen * dt);
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
    this.updateMidControl();

    // Destroyed structures are gone for good; losing the main base loses
    // the game.
    for (const s of [...this.structures]) {
      if (s.hp <= 0) this.removeStructure(s, true);
    }
  }

  removeStructure(s, destroyed) {
    if (destroyed) {
      this.events.push({ type: 'structureDestroyed', x: s.x, y: s.y, team: s.team, kind: s.kind });
      // destroying the mid-field turret pays its bounty (the DESTROYED turret's
      // per-race stat) to the other team
      if (s.kind === 'turret') {
        const bounty = this.bstat(s.team, 'turret').bounty || 0;
        if (bounty > 0) this.money[1 - s.team] += bounty;
      }
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
