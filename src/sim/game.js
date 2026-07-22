// Simulation state root. HARD RULE: nothing in src/sim/ may touch the
// DOM or unseeded randomness. The sim advances only via
// update(FIXED_DT) and mutates only via issueCommand() — that boundary
// is what makes lockstep multiplayer possible later.

import { CONFIG, RACES } from '../config.js';
import { statsUnit, statsBuilding, resolvedUpgrade, resolvedAbility, towerStatForTier, heroAbilitySlots } from '../ui/balance.js';
import { UPGRADE_IDS, ABILITY_UNLOCK_UPGRADE } from '../upgrades.js';
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
    // Base tier upgrade in progress, per team: null when idle, else
    // { start, done, toTier } — the tier only advances (and its effects apply)
    // once game.time reaches `done`. The base stays busy meanwhile.
    this.baseUpgrade = [null, null];
    this.upgrades = [new Set(), new Set()]; // bought upgrade ids, per team (permanent)
    // Player-facing toggles (via the selection panel). Both are OFF-lists so
    // everything defaults to ON (the AI never toggles — full behavior).
    this.abilityOff = [new Set(), new Set()]; // per team: `${unitType}/${abilityId}` autocast disabled
    // Hero ability modes (player-facing). Default AUTO = in neither set. MANUAL =
    // in abilityManual (the hero never auto-casts it; the player fires it). OFF =
    // in abilityOff (never used at all, reusing the autocast off-list above).
    this.abilityManual = [new Set(), new Set()]; // per team: `${unitType}/${abilityId}` on manual
    // One-shot manual fire requests: a `castAbilityNow` adds a key; the sim casts
    // it that tick if ready, then this is cleared at the end of update() (so a
    // press never lingers — nothing happens if it wasn't ready, press again).
    this.abilityCastReq = [new Set(), new Set()];
    this.upgradeOff = [new Set(), new Set()]; // per team: upgrade id owned but deactivated
    this.incomeMult = options.incomeMult || [1, 1];

    // the first round can run on its own timer; every later wave uses WAVE_INTERVAL
    this.waveTimer = CONFIG.FIRST_WAVE_INTERVAL != null ? CONFIG.FIRST_WAVE_INTERVAL : CONFIG.WAVE_INTERVAL;
    this.waveCount = 0;

    this.templates = [[], []]; // per team: {type, x, y}
    this.buildReadyAt = [{}, {}]; // per team: building kind -> game.time it can be built again
    // Wall "charges": you start with 0 buildable walls; the stock refills by 1
    // every chainDelay seconds up to chainMax, and each wall built spends one.
    this.wallStock = [0, 0];
    this.wallStockAt = [0, 0];    // game.time of the next +1 (0 = timer not running)
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
    this.corpses = [];   // {x, y, until} — fresh bodies the Spirit Huntress can raise
    this.byId = new Map();
    this.events = []; // drained by the render layer

    for (const t of [0, 1]) {
      makeStructure(this, t, 'main', CONFIG.MAIN.x[t], CONFIG.MAIN.y);
      // the turret guards the LANE center (MAIN.y), not the field's vertical
      // middle — the field extends lower as a scenic apron with no gameplay
      makeStructure(this, t, 'turret', CONFIG.TURRET_X[t], CONFIG.MAIN.y);
    }

    // Predefined MINE plots: generators can ONLY be built on these. `cap`
    // grid-aligned spots are rolled from the seeded RNG in each team's
    // construction zone, keeping the 3 grid columns nearest the enemy free
    // (that's where walls and towers go). Mines rise instantly on a plot.
    this.mineSpots = [[], []];
    for (const t of [0, 1]) this.generateMineSpots(t);
  }

  generateMineSpots(team) {
    const bs = this.bstat(team, 'generator');
    const n = Math.max(0, Math.round(bs.cap || 0));
    const zone = CONFIG.CONSTRUCTION_ZONE[team];
    const ext = structureExtents('generator', bs);
    const G = CONFIG.GRID;
    const reserve = 3 * G; // front columns stay free for walls/towers
    const x0 = team === 0 ? zone.x0 : zone.x0 + reserve;
    const x1 = team === 0 ? zone.x1 - reserve : zone.x1;
    // candidate footprint centers, grid-aligned exactly like the build snap
    const cands = [];
    for (let cx = x0 + ext.hw; cx <= x1 - ext.hw + 0.01; cx += G) {
      for (let cy = zone.y0 + ext.hh; cy <= zone.y1 - ext.hh + 0.01; cy += G) {
        cands.push({ x: cx, y: cy });
      }
    }
    // seeded shuffle, then keep the first N that don't clash with anything
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }
    const spots = [];
    for (const c of cands) {
      if (spots.length >= n) break;
      let ok = true;
      for (const s of this.structures) { // clear of the main base (and anything else)
        if (s.hp <= 0) continue;
        if (Math.abs(s.x - c.x) < ext.hw + (s.hw || s.radius) &&
            Math.abs(s.y - c.y) < ext.hh + (s.hh || s.radius)) { ok = false; break; }
      }
      if (ok) {
        for (const p of spots) { // and of the other plots
          if (Math.abs(p.x - c.x) < ext.hw * 2 && Math.abs(p.y - c.y) < ext.hh * 2) { ok = false; break; }
        }
      }
      if (ok) spots.push({ x: c.x, y: c.y });
    }
    this.mineSpots[team] = spots;
  }

  // Is this mine plot free (no living structure standing on it)?
  mineSpotFree(p) {
    for (const s of this.structures) {
      if (s.hp > 0 && Math.abs(s.x - p.x) < 1 && Math.abs(s.y - p.y) < 1) return false;
    }
    return true;
  }

  // The nearest FREE mine plot within maxDist of a point, or null.
  nearestFreeMineSpot(team, x, y, maxDist = 140) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const p of this.mineSpots[team]) {
      if (!this.mineSpotFree(p)) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d <= bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // Resolved unit stats for a team, per its race.
  ustat(team, type) {
    return statsUnit(this.races[team], type);
  }

  // Resolved stats for a LIVE entity: a summoned animal carries its own stat
  // block (its type points at the caster only to host sprites), everything else
  // resolves by type per its race.
  ustatOf(u) {
    if (u.summonStats) return u.summonStats;
    const s = statsUnit(this.races[u.team], u.type);
    // the hero fights AND casts its LEARNED abilities (rank >= 1); its ability
    // list is synced onto the entity from the template's ranks.
    // autoAttackBetween: a hero is a FIGHTER first — it must swing between
    // spell cooldowns, never idle in the caster "wait for the next spell" hold
    // (that hold made heroes stand doing nothing whenever they had mana but
    // Holy Light / War Stomp was on cooldown or had no valid target).
    if (u.hero) return { ...s, caster: true, autoAttackBetween: true, abilities: u.heroAbilities || [] };
    return s;
  }

  // Resolved building stats for a team, per its race.
  bstat(team, kind) {
    return statsBuilding(this.races[team], kind);
  }

  // Can this team's unit TYPE use an ability right now? Respects the per-type
  // autocast toggle and the ability's required base tier (params.tier, min 1).
  abilityUsable(team, unitType, aid) {
    if (this.abilityOff[team].has(`${unitType}/${aid}`)) return false;
    // an ability can be gated behind a purchased unlock upgrade (e.g. Slowing
    // Totem): locked until that upgrade is owned AND active
    const unlockUp = ABILITY_UNLOCK_UPGRADE[aid];
    if (unlockUp && !this.upgradeActive(team, unlockUp)) return false;
    // heroes gate abilities by LEARNED RANK (already filtered into the hero's
    // ability list), not by the base tier
    const s = statsUnit(this.races[team], unitType);
    if (s && s.isHero) return true;
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

  // Does this team have a living, FINISHED building of `kind`? (unlock check
  // for units — a construction site doesn't unlock anything yet)
  hasBuilding(team, kind) {
    return this.structures.some((s) => s.team === team && s.kind === kind && s.hp > 0 && !s.building);
  }

  // Effective build price for a structure: mines (generator) get costStep more
  // expensive with every one you already have (⚙ stats: "Scumpire per mină").
  buildCost(team, kind) {
    const bs = this.bstat(team, kind);
    if (kind === 'generator' && (bs.costStep || 0) > 0) {
      return bs.cost + bs.costStep * this.countKind(team, 'generator');
    }
    return bs.cost;
  }

  // Living, finished structures of a kind (income; caps use countKind, which
  // includes construction sites so you can't over-queue past the cap).
  countBuilt(team, kind) {
    let n = 0;
    for (const s of this.structures) {
      if (s.team === team && s.kind === kind && s.hp > 0 && !s.building) n++;
    }
    return n;
  }

  // This team's hero templates (persistent records: level/xp/points). Up to 3,
  // each a distinct hero unit TYPE; each respawns from its own template.
  heroTemplates(team) {
    return this.templates[team].filter((t) => t.hero);
  }

  // The persistent template for a specific hero type, or null.
  heroTemplateOf(team, type) {
    return this.templates[team].find((t) => t.hero && t.type === type) || null;
  }

  // First hero template (lowest tier) — kept for single-hero callers/tests.
  heroTemplate(team) {
    return this.heroTemplates(team)[0] || null;
  }

  hasHero(team) {
    return this.heroTemplates(team).length > 0;
  }

  // Already have a hero of THIS type? The cap is one of EACH hero type per team.
  hasHeroType(team, type) {
    return !!this.heroTemplateOf(team, type);
  }

  // The live hero entity of a given type, or null.
  heroEntityOf(team, type) {
    return this.entities.find((e) => e.team === team && e.hero && e.type === type && e.hp > 0) || null;
  }

  // Push a hero template's learned abilities/ranks onto its LIVE entity so the
  // ability engine (via ustatOf) casts exactly what's been ranked up. Pass a
  // type to sync one hero; omit it to sync all of this team's heroes.
  syncHeroEntity(team, type = null) {
    if (type == null) { for (const t of this.heroTemplates(team)) this.syncHeroEntity(team, t.type); return; }
    const tpl = this.heroTemplateOf(team, type);
    const ent = this.heroEntityOf(team, type);
    if (!ent) return;
    const ranks = (tpl && tpl.ranks) || {};
    ent.heroRanks = { ...ranks };
    ent.heroAbilities = heroAbilitySlots(this.races[team], type)
      .map((s) => s.id).filter((id) => id && (ranks[id] || 0) >= 1);
    // OFF-toggled abilities for this hero type: passives/auras stop applying and
    // actives stop casting (learnedAbilityParams / abilityUsable read this).
    const pre = `${type}/`;
    ent.disabledAbilities = new Set(
      [...this.abilityOff[team]].filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length))
    );
  }

  // Food/supply: each placed template costs its unit's `food`; farms raise the
  // cap. If a farm is destroyed the cap drops (placed units stay, but you can't
  // buy more until back under the cap).
  foodUsed(team) {
    let f = 0;
    for (const tpl of this.templates[team]) f += this.ustat(team, tpl.type).food || 0;
    return f;
  }

  foodCap(team) {
    let cap = CONFIG.FOOD_CAP_BASE || 0;
    for (const s of this.structures) {
      // a farm still under construction feeds nobody yet
      if (s.team === team && s.kind === 'farm' && s.hp > 0 && !s.building) cap += this.bstat(team, 'farm').food || 0;
    }
    return cap;
  }

  // A unit died: the ENEMY team's hero earns its XP — but only while that hero
  // is alive on the field. Structures/base grant nothing.
  creditHeroKill(dead) {
    if (!dead || dead.isStructure || dead.isBase) return;
    const team = 1 - dead.team; // the team whose army scored the kill
    const xp = (this.ustatOf(dead).xp) || 0;
    if (xp <= 0) return;
    // every hero currently ALIVE on the scoring team earns the XP independently
    for (const tpl of this.heroTemplates(team)) {
      if (tpl.level >= 10) continue;
      if (!this.heroEntityOf(team, tpl.type)) continue;
      this.gainHeroXp(team, tpl, xp);
    }
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
      const ent = this.heroEntityOf(team, tpl.type);
      if (ent) {
        const oldMax = ent.maxHp;
        ent.heroLevel = tpl.level;
        ent.maxHp = s.hp + (tpl.level - 1) * (s.hpPerLevel || 0);
        ent.hp += ent.maxHp - oldMax; // gain the fresh HP chunk on ding
        // mana pool grows with the level too (regen growth is applied live)
        const oldManaMax = ent.manaMax || 0;
        ent.manaMax = (s.mana || 0) + (tpl.level - 1) * (s.manaPerLevel || 0);
        ent.mana = (ent.mana || 0) + Math.max(0, ent.manaMax - oldManaMax);
      }
    }
    if (tpl.level >= 10) tpl.xp = 0;
  }

  // Income amounts are configured per INCOME_WINDOW (20s); each INCOME_TICK
  // pays the proportional slice so gold still flows in smoothly.
  incomePer20s(team) {
    const gens = this.countBuilt(team, 'generator'); // sites don't pay yet
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

  // Seconds this base takes to upgrade OUT of its current tier (1→2 uses
  // index 0, 2→3 uses index 1). Per race, editable in ⚙ stats. 0 = instant.
  baseUpgradeDuration(team) {
    const arr = this.bstat(team, 'main').upgradeTime;
    const idx = this.tier[team] - 1;
    const v = Array.isArray(arr) ? arr[idx] : arr;
    return Math.max(0, Number(v) || 0);
  }

  // Is the base mid-upgrade? / seconds still left / 0..1 progress / target tier.
  baseUpgrading(team) {
    return this.baseUpgrade[team] != null;
  }
  baseUpgradeToTier(team) {
    const u = this.baseUpgrade[team];
    return u ? u.toTier : this.tier[team];
  }
  baseUpgradeLeft(team) {
    const u = this.baseUpgrade[team];
    return u ? Math.max(0, u.done - this.time) : 0;
  }
  baseUpgradeProgress(team) {
    const u = this.baseUpgrade[team];
    if (!u) return 0;
    const total = Math.max(0.001, u.done - u.start);
    return Math.max(0, Math.min(1, (this.time - u.start) / total));
  }

  // Actually advance the base to the next tier and apply all its effects
  // (base max HP + heal, tower scaling). Called immediately for an instant
  // upgrade, or from update() when the upgrade timer finishes.
  applyTierUp(team) {
    this.tier[team]++;
    const main = this.mainOf(team);
    if (main) {
      main.maxHp = this.bstat(team, 'main').hp[this.tier[team] - 1];
      main.hp = Math.min(main.maxHp, main.hp + 1000);
    }
    // towers scale with the base tier: raise their max HP and heal by the gain
    const tbs = this.bstat(team, 'tower');
    for (const s of this.structures) {
      if (s.team !== team || s.kind !== 'tower' || s.hp <= 0) continue;
      const nm = towerStatForTier(tbs, this.tier[team]).hp;
      const gain = nm - s.maxHp;
      s.maxHp = nm;
      if (gain > 0) s.hp = Math.min(nm, s.hp + gain);
    }
    this.events.push({ type: 'tierUp', team, tier: this.tier[team] });
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
    // free mine plots are RESERVED ground — only the mine itself may cover one
    if (kind !== 'generator' && this.mineSpots) {
      const gext = structureExtents('generator', this.bstat(team, 'generator'));
      for (const p of this.mineSpots[team]) {
        if (!this.mineSpotFree(p)) continue;
        if (Math.abs(p.x - x) < ext.hw + gext.hw && Math.abs(p.y - y) < ext.hh + gext.hh) return false;
      }
    }
    return true;
  }

  issueCommand(cmd) {
    if (this.winner !== null) return { ok: false, reason: 'game-over' };

    if (cmd.type === 'buy') {
      const stats = this.ustat(cmd.team, cmd.unitId);
      if (!stats) return { ok: false, reason: 'unknown-unit' };
      // regular units are gated by their own tier; heroes gate by COUNT below
      // (any hero can be your 1st at tier 1), so skip the per-type tier check.
      if (!stats.isHero && stats.tier > this.tier[cmd.team]) return { ok: false, reason: 'tier-locked' };
      // gated behind its tech building: must be built (alive) to buy the unit.
      // Heroes ignore this — they're gated only by the Hero Hall below (a unit
      // promoted to hero may still carry a leftover `building` field).
      if (!stats.isHero && stats.building && !this.hasBuilding(cmd.team, stats.building)) return { ok: false, reason: 'no-building' };
      // heroes are recruited ONLY from a built Hero Hall (not the Main Base)
      if (stats.isHero && !this.hasBuilding(cmd.team, 'herohall')) return { ok: false, reason: 'no-herohall' };
      // one of EACH hero type per team (can't field two of the same hero)
      if (stats.isHero && this.hasHeroType(cmd.team, cmd.unitId)) return { ok: false, reason: 'hero-cap' };
      // count gate: the N-th distinct hero needs base tier N (1st @ T1, 2nd @ T2,
      // 3rd @ T3) — you may pick ANY hero for each slot.
      if (stats.isHero && this.heroTemplates(cmd.team).length >= this.tier[cmd.team]) return { ok: false, reason: 'tier-locked' };
      // heroes can be gated behind a match timer (⚙ Balance: HERO_UNLOCK_TIME)
      if (stats.isHero && this.time < (CONFIG.HERO_UNLOCK_TIME || 0))
        return { ok: false, reason: 'hero-locked' };
      if (this.money[cmd.team] < stats.cost) return { ok: false, reason: 'money' };
      if (this.foodUsed(cmd.team) + (stats.food || 0) > this.foodCap(cmd.team))
        return { ok: false, reason: 'food' };
      if (!this.isValidPlacement(cmd.team, cmd.x, cmd.y, -1, cmd.unitId))
        return { ok: false, reason: 'zone' };
      this.money[cmd.team] -= stats.cost;
      this.spent[cmd.team] += stats.cost;
      const tpl = { type: cmd.unitId, x: cmd.x, y: cmd.y, spawned: false };
      // heroes start at level 1 WITH one talent point, so they can learn an
      // ability right away (further points come on each level-up)
      if (stats.isHero) { tpl.hero = true; tpl.level = 1; tpl.xp = 0; tpl.points = 1; }
      this.templates[cmd.team].push(tpl);
      return { ok: true };
    }

    if (cmd.type === 'rankHero') {
      // cmd.unit selects WHICH hero (multi-hero); falls back to the first hero
      const tpl = cmd.unit ? this.heroTemplateOf(cmd.team, cmd.unit) : this.heroTemplate(cmd.team);
      if (!tpl) return { ok: false, reason: 'no-hero' };
      if ((tpl.points || 0) <= 0) return { ok: false, reason: 'no-points' };
      const slot = heroAbilitySlots(this.races[cmd.team], tpl.type).find((s) => s.id === cmd.ability);
      if (!slot || !slot.id) return { ok: false, reason: 'unknown-ability' };
      if (slot.ult && (tpl.level || 1) < 6) return { ok: false, reason: 'ult-locked' };
      if (!tpl.ranks) tpl.ranks = {};
      const cur = tpl.ranks[cmd.ability] || 0;
      if (cur >= (slot.ult ? 1 : 3)) return { ok: false, reason: 'max-rank' };
      tpl.ranks[cmd.ability] = cur + 1;
      tpl.points -= 1;
      this.syncHeroEntity(cmd.team, tpl.type);
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
      const price = this.buildCost(cmd.team, cmd.kind); // mines get pricier each time
      if (this.money[cmd.team] < price) return { ok: false, reason: 'money' };
      if (this.countKind(cmd.team, cmd.kind) >= stats.cap)
        return { ok: false, reason: 'cap' };
      // Wall charges: when the charge system is on (chainMax > 1) you can only
      // build a wall if you have one in stock (it refills over time in update()).
      const wallCharged = cmd.kind === 'wall' && Math.round(stats.chainMax || 1) > 1;
      if (wallCharged && this.wallStock[cmd.team] <= 0) return { ok: false, reason: 'no-charge' };
      let bx = cmd.x;
      let by = cmd.y;
      // mines rise ONLY on their predefined plots: snap the click to the
      // nearest free plot (or refuse when none is near / all are taken)
      if (cmd.kind === 'generator') {
        const spot = this.nearestFreeMineSpot(cmd.team, cmd.x, cmd.y);
        if (!spot) return { ok: false, reason: 'no-spot' };
        bx = spot.x;
        by = spot.y;
      }
      if (!this.isValidBuildPlacement(cmd.team, cmd.kind, bx, by))
        return { ok: false, reason: 'zone' };
      this.money[cmd.team] -= price;
      this.spent[cmd.team] += price;
      if (stats.buildCd > 0) this.buildReadyAt[cmd.team][cmd.kind] = this.time + stats.buildCd;
      makeStructure(this, cmd.team, cmd.kind, bx, by);
      if (wallCharged) this.wallStock[cmd.team]--; // spend a charge
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
      if (this.baseUpgrade[cmd.team]) return { ok: false, reason: 'busy' };
      if (this.tier[cmd.team] >= CONFIG.TIER_MAX) return { ok: false, reason: 'max-tier' };
      const cost = this.tierUpCost(cmd.team);
      if (this.money[cmd.team] < cost) return { ok: false, reason: 'money' };
      this.money[cmd.team] -= cost;
      this.spent[cmd.team] += cost;
      const wait = this.baseUpgradeDuration(cmd.team);
      if (wait <= 0) {
        this.applyTierUp(cmd.team); // instant (wait disabled)
      } else {
        // base goes "busy": the tier only advances when the timer finishes
        // (in update()). No separate frames — just a radial on the base.
        this.baseUpgrade[cmd.team] = { start: this.time, done: this.time + wait, toTier: this.tier[cmd.team] + 1 };
        this.events.push({ type: 'tierUpStart', team: cmd.team, tier: this.tier[cmd.team] + 1 });
      }
      return { ok: true };
    }

    if (cmd.type === 'buyUpgrade') {
      if (!UPGRADE_IDS.includes(cmd.id)) return { ok: false, reason: 'unknown-upgrade' };
      const up = resolvedUpgrade(cmd.id);
      if (!up || !up.unit) return { ok: false, reason: 'no-unit' }; // must target a unit
      if (up.race && up.race !== this.races[cmd.team]) return { ok: false, reason: 'wrong-race' };
      // gated behind the target unit's tier: you can't buy an upgrade for a
      // tier-2 unit until your base is tier 2 (etc.) — and an upgrade can carry
      // its OWN required tier (params.tier, e.g. the Frost Bolt unlock).
      const upUnit = this.ustat(cmd.team, up.unit);
      const needTier = Math.max((upUnit && upUnit.tier) || 1, up.params.tier || 1);
      if (this.tier[cmd.team] < needTier) return { ok: false, reason: 'tier-locked' };
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

    // Hero ability mode (selection panel): 'auto' (default), 'manual', 'off'.
    // Auto = hero casts it itself; Manual = only the player fires it; Off =
    // never used. Reuses abilityOff for the OFF state so abilityUsable() blocks
    // it everywhere for free.
    if (cmd.type === 'setAbilityMode') {
      if (!ABILITY_IDS.includes(cmd.ability)) return { ok: false, reason: 'unknown-ability' };
      if (!this.ustat(cmd.team, cmd.unit)) return { ok: false, reason: 'unknown-unit' };
      const key = `${cmd.unit}/${cmd.ability}`;
      this.abilityManual[cmd.team].delete(key);
      this.abilityOff[cmd.team].delete(key);
      this.abilityCastReq[cmd.team].delete(key); // a mode change cancels any pending fire
      if (cmd.mode === 'manual') this.abilityManual[cmd.team].add(key);
      else if (cmd.mode === 'off') this.abilityOff[cmd.team].add(key);
      this.syncHeroEntity(cmd.team, cmd.unit); // reflect OFF on the live hero (passives too)
      return { ok: true };
    }

    // Fire a manual-mode hero ability NOW. One-shot: it only casts if it's ready
    // this tick (mana/cooldown/target); otherwise nothing happens — the request
    // is cleared at the end of update().
    if (cmd.type === 'castAbilityNow') {
      if (!ABILITY_IDS.includes(cmd.ability)) return { ok: false, reason: 'unknown-ability' };
      if (!this.ustat(cmd.team, cmd.unit)) return { ok: false, reason: 'unknown-unit' };
      this.abilityCastReq[cmd.team].add(`${cmd.unit}/${cmd.ability}`);
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

    // Structure HP regen (per-race stat; 0 = off). Turret, tower and wall each
    // carry their own `regen` (HP/s); a finished, damaged one heals over time.
    for (const s of this.structures) {
      if (s.hp <= 0 || s.hp >= s.maxHp || s.building) continue;
      if (s.kind !== 'turret' && s.kind !== 'tower' && s.kind !== 'wall') continue;
      const regen = this.bstat(s.team, s.kind).regen || 0;
      if (regen > 0) s.hp = Math.min(s.maxHp, s.hp + regen * dt);
    }

    // Construction sites: HP grows linearly toward full while raising (the
    // site started at 15%), then the building finishes and starts working
    for (const s of this.structures) {
      if (!s.building || s.hp <= 0) continue;
      const total = Math.max(0.01, s.buildDone - s.buildStart);
      s.hp = Math.min(s.maxHp, s.hp + (s.maxHp * 0.85 / total) * dt);
      if (this.time >= s.buildDone) {
        s.building = false;
        this.events.push({ type: 'built', team: s.team, kind: s.kind, x: s.x, y: s.y });
      }
    }

    // Base tier upgrades: while busy, the new tier lands only when the timer
    // finishes (deterministic — both lockstep clients apply it on the same tick)
    for (const t of [0, 1]) {
      const u = this.baseUpgrade[t];
      if (u && this.time >= u.done) {
        this.baseUpgrade[t] = null;
        this.applyTierUp(t);
      }
    }

    // Wall charges: the stock of buildable walls refills by 1 every chainDelay
    // seconds, up to chainMax. It idles once full and resumes as soon as you
    // spend one (build a wall). chainMax <= 1 turns the whole system off.
    for (const t of [0, 1]) {
      const wb = this.bstat(t, 'wall');
      const max = Math.round(wb.chainMax || 1);
      if (max <= 1) { this.wallStock[t] = 0; this.wallStockAt[t] = 0; continue; }
      if (this.wallStock[t] > max) this.wallStock[t] = max; // admin lowered the cap
      if (this.wallStock[t] >= max) { this.wallStockAt[t] = 0; continue; } // full: timer idle
      const delay = Math.max(0.1, wb.chainDelay || 3);
      if (this.wallStockAt[t] <= 0) this.wallStockAt[t] = this.time + delay; // (re)start the timer
      else if (this.time >= this.wallStockAt[t]) {
        this.wallStock[t]++;
        this.wallStockAt[t] = this.wallStock[t] >= max ? 0 : this.time + delay;
      }
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

    // Manual hero-cast requests are one-shot: whatever fired (or couldn't) this
    // tick, drop them so a press never lingers — nothing happens if it wasn't
    // ready, the player presses again when it is.
    this.abilityCastReq[0].clear();
    this.abilityCastReq[1].clear();

    // Raisable corpses expire; drop the stale ones (cheap, usually short).
    if (this.corpses.length) {
      const kept = [];
      for (const c of this.corpses) if (this.time < c.until) kept.push(c);
      this.corpses = kept;
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

  // Drop a raisable corpse (game.corpses) the Spirit Huntress / Necromancer can
  // raise (Rise Dead). `big` picks the larger decal + its own duration. `immediate`
  // = raisable at once (dug up by a Grave Digger); otherwise it waits out the
  // death animation (CORPSE_RAISE_DELAY) before it can be raised.
  addCorpse(x, y, big, immediate) {
    const rp = resolvedAbility('risedead')?.params || {};
    const lifeSmall = rp.corpseLife || 0;
    const lifeBig = rp.corpseBigLife != null ? rp.corpseBigLife : lifeSmall;
    const life = big ? lifeBig : lifeSmall;
    if (life <= 0) return;
    const delay = immediate ? 0 : (CONFIG.CORPSE_RAISE_DELAY || 0);
    this.corpses.push({ x, y, big: !!big, readyAt: this.time + delay, until: this.time + delay + life });
  }

  removeDead() {
    const alive = [];
    // a dead fighter leaves a corpse the Spirit Huntress can raise (Rise Dead).
    // Summons and structures leave nothing (no skeleton-from-skeleton loops).
    for (const e of this.entities) {
      if (e.hp > 0) {
        alive.push(e);
      } else {
        if (!e.summon && !e.isStructure) {
          // units bigger than 1×1 leave the larger corpse decal (if uploaded)
          const us = this.ustatOf(e);
          const big = !!(us && ((us.cw || 1) > 1 || (us.ch || 1) > 1));
          this.addCorpse(e.x, e.y, big, false);
        }
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
