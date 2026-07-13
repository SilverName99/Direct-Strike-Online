// Simulation state root. HARD RULE: nothing in src/sim/ may touch the
// DOM or unseeded randomness. The sim advances only via
// update(FIXED_DT) and mutates only via issueCommand() — that boundary
// is what makes lockstep multiplayer possible later.

import { CONFIG, RACES } from '../config.js';
import { statsUnit, statsBuilding, resolvedUpgrade, resolvedAbility, towerStatForTier } from '../ui/balance.js';
import { UPGRADE_IDS } from '../upgrades.js';
import { ABILITY_IDS } from '../abilities.js';
import { mulberry32 } from './rng.js';
import { makeStructure, structureExtents } from './entity.js';
import { updateCombat, updateProjectiles } from './combat.js';
import { updateMovement } from './movement.js';
import { updateAbilities, applyEffect } from './abilities.js';
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

    // the first round can run on its own timer; every later wave uses WAVE_INTERVAL
    this.waveTimer = CONFIG.FIRST_WAVE_INTERVAL != null ? CONFIG.FIRST_WAVE_INTERVAL : CONFIG.WAVE_INTERVAL;
    this.waveCount = 0;

    this.templates = [[], []]; // per team: {type, x, y}
    this.buildReadyAt = [{}, {}]; // per team: building kind -> game.time it can be built again
    this.midOwner = null;      // control point: team currently holding the middle
    // Middle-of-map terrain: pick one uploaded variant (with its effect) at
    // random from the seeded RNG so it is deterministic. options.middles is a
    // list of { slot, kind, amount, band, air } for the AVAILABLE variants.
    this.middle = null;
    this.middleSlot = -1; // which image slot the renderer should draw
    if (Array.isArray(options.middles) && options.middles.length) {
      const pick = options.middles[Math.floor(this.rng() * options.middles.length)];
      this.middle = pick;
      this.middleSlot = pick.slot;
    }
    this.entities = [];
    this.projectiles = [];
    this.structures = [];
    this.fireZones = []; // burning ground left by the Fireball upgrade
    this.byId = new Map();
    this.events = []; // drained by the render layer

    for (const t of [0, 1]) {
      makeStructure(this, t, 'main', CONFIG.MAIN.x[t], CONFIG.MAIN.y);
      // the turret guards the LANE center (MAIN.y), not the field's vertical
      // middle — the field extends lower as a scenic apron with no gameplay
      makeStructure(this, t, 'turret', CONFIG.TURRET_X[t], CONFIG.MAIN.y);
    }
  }

  // Resolved unit stats for a team, per its race.
  ustat(team, type) {
    return statsUnit(this.races[team], type);
  }

  // Resolved stats for a LIVE entity: a summoned animal carries its own stat
  // block (its type points at the caster only to host sprites), everything else
  // resolves by type per its race.
  ustatOf(u) {
    return u.summonStats || statsUnit(this.races[u.team], u.type);
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

  // Does this team have a living building of `kind`? (unlock check for units)
  hasBuilding(team, kind) {
    return this.structures.some((s) => s.team === team && s.kind === kind && s.hp > 0);
  }

  // This team's hero template (persistent record: level/xp/points), or null.
  // Only one per team; it respawns each wave from this template.
  heroTemplate(team) {
    return this.templates[team].find((t) => t.hero) || null;
  }

  hasHero(team) {
    return !!this.heroTemplate(team);
  }

  // A unit died: the ENEMY team's hero earns its XP — but only while that hero
  // is alive on the field. Structures/base grant nothing.
  creditHeroKill(dead) {
    if (!dead || dead.isStructure || dead.isBase) return;
    const team = 1 - dead.team; // the team whose army scored the kill
    const tpl = this.heroTemplate(team);
    if (!tpl || tpl.level >= 10) return;
    if (!this.entities.some((e) => e.team === team && e.hero && e.hp > 0)) return;
    const xp = (this.ustatOf(dead).xp) || 0;
    if (xp > 0) this.gainHeroXp(team, tpl, xp);
  }

  // Add XP to a hero and process level-ups (1->10). Each level grants a talent
  // point and grows the live hero entity's HP.
  gainHeroXp(team, tpl, xp) {
    tpl.xp = (tpl.xp || 0) + xp;
    const s = this.ustat(team, tpl.type);
    const thresholds = s.levelXp || [];
    while (tpl.level < 10) {
      const need = thresholds[tpl.level - 1];
      if (!(need > 0) || tpl.xp < need) break;
      tpl.xp -= need;
      tpl.level++;
      tpl.points = (tpl.points || 0) + 1;
      this.events.push({ type: 'herolevel', team, level: tpl.level, unitId: tpl.type });
      const ent = this.entities.find((e) => e.team === team && e.hero && e.hp > 0);
      if (ent) {
        const oldMax = ent.maxHp;
        ent.heroLevel = tpl.level;
        ent.maxHp = s.hp + (tpl.level - 1) * (s.hpPerLevel || 0);
        ent.hp += ent.maxHp - oldMax; // gain the fresh HP chunk on ding
      }
    }
    if (tpl.level >= 10) tpl.xp = 0;
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

  // "Holding the middle": true while THIS team has one of its OWN units past
  // midfield. (Must filter by team — otherwise the enemy's units sitting on
  // their own half keep midHeld(enemy) permanently true, so the crossing
  // edge-detect never fires and the middle can never be stolen.)
  midHeld(team) {
    const mid = CONFIG.FIELD_W / 2;
    return this.entities.some((e) =>
      e.team === team && e.hp > 0 && (team === 0 ? e.x > mid : e.x < mid));
  }

  // Aggression reward: the middle is a CONTROL POINT. You keep the extra income
  // once you have captured it, and only LOSE it when the enemy owns the middle
  // outright — i.e. he has a unit past midfield and you have none on his side.
  // Killing off your push isn't enough; he must also cross to take the bonus.
  midBonusPerTick(team) {
    if (!CONFIG.MID_INCOME || this.midOwner !== team) return 0;
    return Math.round(CONFIG.MID_INCOME * (CONFIG.INCOME_TICK / CONFIG.INCOME_WINDOW));
  }

  // Ownership follows EXCLUSIVE presence past midfield: whichever team has a
  // unit past the middle while the other does not becomes (or stays) the owner.
  // If both have a unit there, or neither does, ownership persists with the
  // current holder — so you keep the bonus after your push dies until the enemy
  // actually crosses and holds the middle alone.
  updateMidControl() {
    const p0 = this.midHeld(0);
    const p1 = this.midHeld(1);
    if (p0 && !p1) this.midOwner = 0;
    else if (p1 && !p0) this.midOwner = 1;
  }

  // Middle terrain effect: units standing on the central band (|x - mid| <=
  // band) get the chosen variant's debuff, refreshed each tick so it fades a
  // beat after they step off. Ground-only unless the variant flags `air`.
  applyMiddleTerrain(dt) {
    const m = this.middle;
    if (!m || m.kind === 'none' || !(m.amount > 0) || !(m.band > 0)) return;
    const mid = CONFIG.FIELD_W / 2;
    // slows use an INVISIBLE terrain kind (no frost VFX/status chip); mana regen
    // just tops up mana each tick for casters standing on the band
    const kind = m.kind === 'atkslow' ? 'terrainatkslow' : m.kind === 'moveslow' ? 'terrainslow' : null;
    const until = this.time + 0.25;
    for (const u of this.entities) {
      if (u.hp <= 0) continue;
      if (u.isAir && !m.air) continue;
      if (Math.abs(u.x - mid) > m.band) continue;
      if (kind) applyEffect(u, kind, m.amount, until, this.time);
      else if (m.kind === 'manaregen' && u.manaMax > 0) {
        u.mana = Math.min(u.manaMax, u.mana + m.amount * dt);
      }
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
      // gated behind its tech building: must be built (alive) to buy the unit
      if (stats.building && !this.hasBuilding(cmd.team, stats.building)) return { ok: false, reason: 'no-building' };
      // only ONE hero per team
      if (stats.isHero && this.hasHero(cmd.team)) return { ok: false, reason: 'hero-cap' };
      if (this.money[cmd.team] < stats.cost) return { ok: false, reason: 'money' };
      if (this.templates[cmd.team].length >= CONFIG.MAX_TEMPLATES)
        return { ok: false, reason: 'template-cap' };
      if (!this.isValidPlacement(cmd.team, cmd.x, cmd.y, -1, cmd.unitId))
        return { ok: false, reason: 'zone' };
      this.money[cmd.team] -= stats.cost;
      this.spent[cmd.team] += stats.cost;
      const tpl = { type: cmd.unitId, x: cmd.x, y: cmd.y, spawned: false };
      if (stats.isHero) { tpl.hero = true; tpl.level = 1; tpl.xp = 0; tpl.points = 0; }
      this.templates[cmd.team].push(tpl);
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
      if (this.tier[cmd.team] < (stats.tier || 1)) return { ok: false, reason: 'tier-locked' };
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
      // towers scale with the base tier: raise their max HP and heal by the gain
      const tbs = this.bstat(cmd.team, 'tower');
      for (const s of this.structures) {
        if (s.team !== cmd.team || s.kind !== 'tower' || s.hp <= 0) continue;
        const nm = towerStatForTier(tbs, this.tier[cmd.team]).hp;
        const gain = nm - s.maxHp;
        s.maxHp = nm;
        if (gain > 0) s.hp = Math.min(nm, s.hp + gain);
      }
      this.events.push({ type: 'tierUp', team: cmd.team, tier: this.tier[cmd.team] });
      return { ok: true };
    }

    if (cmd.type === 'buyUpgrade') {
      if (!UPGRADE_IDS.includes(cmd.id)) return { ok: false, reason: 'unknown-upgrade' };
      const up = resolvedUpgrade(cmd.id);
      if (!up || !up.unit) return { ok: false, reason: 'no-unit' }; // must target a unit
      if (up.race && up.race !== this.races[cmd.team]) return { ok: false, reason: 'wrong-race' };
      // gated behind the target unit's tier: you can't buy an upgrade for a
      // tier-2 unit until your base is tier 2 (etc.)
      const upUnit = this.ustat(cmd.team, up.unit);
      if (upUnit && this.tier[cmd.team] < (upUnit.tier || 1)) return { ok: false, reason: 'tier-locked' };
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

    // Income accrues smoothly EVERY tick (same total rate as the old 2s chunks)
    // so gold climbs continuously instead of jumping and then sitting still.
    for (const t of [0, 1]) this.money[t] += this.incomePerSecond(t) * dt;

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

    this.applyMiddleTerrain(dt); // terrain effect refreshed before combat/movement read it
    updateAbilities(this, dt); // auras/status effects first, combat reads them
    updateCombat(this, dt);
    updateMovement(this, dt);
    updateProjectiles(this, dt);
    // summoned animals with a lifetime expire (play their death like any unit)
    for (const e of this.entities) {
      if (e.summon && e.despawnAt != null && e.hp > 0 && this.time >= e.despawnAt) e.hp = 0;
    }
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
      this.events.push({ type: 'structureDestroyed', x: s.x, y: s.y, team: s.team, kind: s.kind, tier: this.tier[s.team], hw: s.hw, hh: s.hh });
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
