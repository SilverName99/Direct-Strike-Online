// Simulation state root. HARD RULE: nothing in src/sim/ may touch the
// DOM or unseeded randomness. The sim advances only via
// update(FIXED_DT) and mutates only via issueCommand() — that boundary
// is what makes lockstep multiplayer possible later.

import { CONFIG, RACES } from '../config.js';
import { statsUnit, statsBuilding, resolvedUpgrade, resolvedAbility, towerStatForTier, heroAbilitySlots } from '../ui/balance.js';
import { UPGRADE_IDS, ABILITY_UNLOCK_UPGRADE } from '../upgrades.js';
import { ABILITY_IDS } from '../abilities.js';
import { mulberry32 } from './rng.js';
import { teamLayout } from './layout.js';
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

    // ---- PLAYERS vs SIDES (team modes) --------------------------------------
    // A PLAYER is one commander: their own gold, templates, tier, upgrades and
    // buildings. A SIDE (0 = left, 1 = right) is the battlefield faction that
    // units fight for. The battlefield geometry comes from options.layout
    // (teamLayout(n)); the default reproduces the classic 1v1 EXACTLY, so with
    // no layout passed every per-player array keeps its historical [0, 1]
    // shape and nothing changes. Entities/structures carry BOTH: `team` (side,
    // drives targeting/combat) and `owner` (player, drives stats/economy).
    this.layout = options.layout || teamLayout(1);
    const optRaces = options.races || [RACES[0], RACES[0]];
    this.players = this.layout.perPlayer.map((pp, i) => ({
      side: pp.side, depth: pp.depth, role: pp.role,
      race: optRaces[i] || optRaces[pp.side] || RACES[0],
    }));
    const N = this.players.length;

    // each player plays a race; unit stats resolve per race (indexed by PLAYER)
    this.races = this.players.map((p) => p.race);

    // per-player depth zones: { army, build } rects + alive flag (a zone dies
    // with its owner's main base — the "defense in depth" collapse, phase 2)
    this.zones = this.layout.perPlayer.map((pp) => ({ army: pp.army, build: pp.build, alive: true }));
    this.midBuild = this.layout.midBuild; // forward pockets by SIDE

    this.money = this.players.map(() => CONFIG.START_MONEY);
    this.spent = this.players.map(() => 0);
    this.tier = this.players.map(() => 1);
    // Base tier upgrade in progress, per player: null when idle, else
    // { start, done, toTier } — the tier only advances (and its effects apply)
    // once game.time reaches `done`. The base stays busy meanwhile.
    this.baseUpgrade = this.players.map(() => null);
    this.upgrades = this.players.map(() => new Set()); // bought upgrade ids, per player (permanent)
    this.skelBought = this.players.map(() => 0); // Undead: skeleton-cap purchases, per player
    // Player-facing toggles (via the selection panel). Both are OFF-lists so
    // everything defaults to ON (the AI never toggles — full behavior).
    this.abilityOff = this.players.map(() => new Set()); // per player: `${unitType}/${abilityId}` autocast disabled
    // Hero ability modes (player-facing). Default AUTO = in neither set. MANUAL =
    // in abilityManual (the hero never auto-casts it; the player fires it). OFF =
    // in abilityOff (never used at all, reusing the autocast off-list above).
    this.abilityManual = this.players.map(() => new Set()); // per player: `${unitType}/${abilityId}` on manual
    // One-shot manual fire requests: a `castAbilityNow` adds a key; the sim casts
    // it that tick if ready, then this is cleared at the end of update() (so a
    // press never lingers — nothing happens if it wasn't ready, press again).
    this.abilityCastReq = this.players.map(() => new Set());
    this.upgradeOff = this.players.map(() => new Set()); // per player: upgrade id owned but deactivated
    const im = options.incomeMult || [];
    this.incomeMult = this.players.map((_, i) => (im[i] != null ? im[i] : 1));
    // commanders who left the match (online disconnect) — see activeOnSide()
    this.abandoned = this.players.map(() => false);

    // the first round can run on its own timer; every later wave uses WAVE_INTERVAL
    this.waveTimer = CONFIG.FIRST_WAVE_INTERVAL != null ? CONFIG.FIRST_WAVE_INTERVAL : CONFIG.WAVE_INTERVAL;
    this.waveCount = 0;

    this.templates = this.players.map(() => []); // per player: {type, x, y}
    this.buildReadyAt = this.players.map(() => ({})); // per player: building kind -> game.time it can be built again
    // Wall "charges": you start with 0 buildable walls; the stock refills by 1
    // every chainDelay seconds up to chainMax, and each wall built spends one.
    this.wallStock = this.players.map(() => 0);
    this.wallStockAt = this.players.map(() => 0); // game.time of the next +1 (0 = timer not running)
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
    this.pasteZones = []; // green Acid Paste puddles: {x,y,radius,amp,until,team} — amplify damage taken by enemies standing on them
    this.corpses = [];   // {x, y, until} — fresh bodies the Spirit Huntress can raise
    this.byId = new Map();
    this.events = []; // drained by the render layer

    // one MAIN per player (in their own depth zone) + one turret per SIDE.
    // 1v1 keeps the historical creation order: main0, turret0, main1, turret1.
    for (const side of [0, 1]) {
      for (const p of this.playersOnSide(side)) {
        const pp = this.layout.perPlayer[p];
        makeStructure(this, side, 'main', pp.main.x, pp.main.y, p);
      }
      // the turret guards the LANE center (MAIN.y), not the field's vertical
      // middle — the field extends lower as a scenic apron with no gameplay.
      // Its owner is the side's ANCHOR player (bounty/stats resolve per race).
      makeStructure(this, side, 'turret', this.layout.turretX[side], CONFIG.MAIN.y, this.playersOnSide(side)[0]);
    }

    // Predefined MINE plots: in CLASSIC 1v1 generators can ONLY be built on
    // these `cap` grid-aligned spots, rolled from the seeded RNG in each
    // player's construction zone (front columns stay free for walls/towers).
    // TEAM MODES have no predefined plots — mines build freely in your own
    // zones (the per-race cap still applies), so a fallen player can rebuild
    // their economy wherever their team still stands.
    this.mineSpots = this.players.map(() => []);
    if (this.players.length === 2) for (let p = 0; p < N; p++) this.generateMineSpots(p); // classic 1v1 only
  }

  // A player is BASELESS once their main fell (their zone collapsed): they can
  // no longer rebuild a main, but keep playing through their allies' zones —
  // building at the raised Y% allowance, mines included.
  isBaseless(player) {
    return this.zones[player] ? !this.zones[player].alive : false;
  }

  generateMineSpots(player) {
    const bs = this.bstat(player, 'generator');
    const n = Math.max(0, Math.round(bs.cap || 0));
    const zone = this.zones[player].build;
    const side = this.sideOf(player);
    const ext = structureExtents('generator', bs);
    const G = CONFIG.GRID;
    const reserve = 3 * G; // front columns stay free for walls/towers
    const x0 = side === 0 ? zone.x0 : zone.x0 + reserve;
    const x1 = side === 0 ? zone.x1 - reserve : zone.x1;
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
    this.mineSpots[player] = spots;
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
    // stats resolve by the OWNER's race (players on one side may differ); in
    // 1v1 owner === team, so this is the historical behavior
    const s = statsUnit(this.races[u.owner != null ? u.owner : u.team], u.type);
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

  // Which battlefield SIDE a player fights on (1v1: player index === side).
  sideOf(player) {
    const p = this.players && this.players[player];
    return p ? p.side : player;
  }

  // Player indices fighting on a side (1v1: exactly one per side).
  playersOnSide(side) {
    const out = [];
    for (let i = 0; i < this.players.length; i++) if (this.players[i].side === side) out.push(i);
    return out;
  }

  // Same, minus commanders who dropped out (an online disconnect). Their base
  // and army stay on the field, but nobody spends for them — so their side
  // counts as SHORT-HANDED for the asymmetric income bonus.
  activeOnSide(side) {
    return this.playersOnSide(side).filter((p) => !this.abandoned[p]);
  }

  // First LIVING main base on a side (falls back to a ruined one so the
  // end-screen render and old callers keep an anchor). 1v1: the one main.
  mainOf(team) {
    return this.structures.find((s) => s.team === team && s.kind === 'main' && s.hp > 0)
      || this.structures.find((s) => s.team === team && s.kind === 'main') || null;
  }

  // All living main bases on a side (team modes: one per player still standing).
  mainsOf(team) {
    return this.structures.filter((s) => s.team === team && s.kind === 'main' && s.hp > 0);
  }

  enemyStructures(team) {
    return this.structures.filter((s) => s.team !== team && s.hp > 0);
  }

  // Caps/tech/income count the PLAYER's own buildings (1v1: owner === team).
  countKind(player, kind) {
    let n = 0;
    for (const s of this.structures) {
      if ((s.owner != null ? s.owner : s.team) === player && s.kind === kind && s.hp > 0) n++;
    }
    return n;
  }

  // Does this player have a living, FINISHED building of `kind`? (unlock check
  // for units — a construction site doesn't unlock anything yet)
  hasBuilding(player, kind) {
    return this.structures.some((s) => (s.owner != null ? s.owner : s.team) === player && s.kind === kind && s.hp > 0 && !s.building);
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
  countBuilt(player, kind) {
    let n = 0;
    for (const s of this.structures) {
      if ((s.owner != null ? s.owner : s.team) === player && s.kind === kind && s.hp > 0 && !s.building) n++;
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

  // The live hero entity of a given type, or null. Matched by OWNER so two
  // allied players may field the same hero type independently (1v1 identical).
  heroEntityOf(player, type) {
    return this.entities.find((e) => (e.owner != null ? e.owner : e.team) === player && e.hero && e.type === type && e.hp > 0) || null;
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

  foodCap(player) {
    let cap = CONFIG.FOOD_CAP_BASE || 0;
    for (const s of this.structures) {
      // a farm still under construction feeds nobody yet
      if ((s.owner != null ? s.owner : s.team) === player && s.kind === 'farm' && s.hp > 0 && !s.building) cap += this.bstat(player, 'farm').food || 0;
    }
    return cap;
  }

  // A unit died: the ENEMY side's heroes earn its XP — but only while alive on
  // the field. Structures/base grant nothing. Every player on the scoring side
  // credits their own heroes (1v1: the one enemy player, as before).
  creditHeroKill(dead) {
    if (!dead || dead.isStructure || dead.isBase) return;
    const side = 1 - dead.team; // the side whose army scored the kill
    const xp = (this.ustatOf(dead).xp) || 0;
    if (xp <= 0) return;
    for (const player of this.playersOnSide(side)) {
      for (const tpl of this.heroTemplates(player)) {
        if (tpl.level >= 10) continue;
        if (!this.heroEntityOf(player, tpl.type)) continue;
        this.gainHeroXp(player, tpl, xp);
      }
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
  // Asymmetric modes (1v2 / 1v3 / 2v3): the side with FEWER players gets a
  // settable % income bonus to compensate. 0 in symmetric matchups.
  asymBonusPct(player) {
    const n0 = this.activeOnSide(0).length;
    const n1 = this.activeOnSide(1).length;
    if (n0 === n1) return 0;
    const mine = this.activeOnSide(this.sideOf(player)).length;
    if (mine !== Math.min(n0, n1)) return 0; // only the smaller side is boosted
    const key = `${Math.min(n0, n1)}v${Math.max(n0, n1)}`;
    if (key === '1v2') return CONFIG.TEAM_ASYM_1V2 || 0;
    if (key === '1v3') return CONFIG.TEAM_ASYM_1V3 || 0;
    if (key === '2v3') return CONFIG.TEAM_ASYM_2V3 || 0;
    return 0;
  }

  incomePer20s(team) {
    const gens = this.countBuilt(team, 'generator'); // sites don't pay yet
    const asym = 1 + this.asymBonusPct(team) / 100;
    return (CONFIG.INCOME_BASE + gens * this.bstat(team, 'generator').income) * this.incomeMult[team] * asym;
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
  midBonusPerTick(player) {
    // the mid is held per SIDE; EVERY player on the owning side earns the full
    // bonus ("toată echipa primește bonus"). 1v1: sideOf(p) === p, unchanged.
    if (!CONFIG.MID_INCOME || this.midOwner !== this.sideOf(player)) return 0;
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

  // Undead skeleton cap: current team-wide max living Necromancer skeletons.
  skelCapOf(team) {
    const max = CONFIG.SKEL_CAP_MAX != null ? CONFIG.SKEL_CAP_MAX : Infinity;
    return Math.min(max, (CONFIG.SKEL_CAP_BASE || 0) + (this.skelBought[team] || 0) * (CONFIG.SKEL_CAP_STEP || 0));
  }
  // Cost of the NEXT skeleton-cap upgrade step (rises with each purchase).
  skelCapCostOf(team) {
    return (CONFIG.SKEL_CAP_COST || 0) + (this.skelBought[team] || 0) * (CONFIG.SKEL_CAP_COST_STEP || 0);
  }
  // How many Necromancer skeletons (melee + ranged) this PLAYER has alive now
  // (the cap is per player — each commander runs their own bone economy).
  livingSkeletons(player) {
    let n = 0;
    for (const e of this.entities) {
      if (e.hp > 0 && (e.owner != null ? e.owner : e.team) === player && e.summon && (e.summonKind === 'skeleton' || e.summonKind === 'skeletonranged')) n++;
    }
    return n;
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
  // The player's OWN main base (team modes: one main per player). Prefers a
  // LIVING one — a fallen player's ruined main stays as scenery, and a REBUILT
  // main (at an ally's zone) must win over the ruin.
  mainOfPlayer(player) {
    const own = (s) => s.kind === 'main' && (s.owner != null ? s.owner : s.team) === player;
    return this.structures.find((s) => own(s) && s.hp > 0) || this.structures.find(own) || null;
  }

  applyTierUp(player) {
    this.tier[player]++;
    const main = this.mainOfPlayer(player);
    if (main && main.hp > 0) {
      main.maxHp = this.bstat(player, 'main').hp[this.tier[player] - 1];
      main.hp = Math.min(main.maxHp, main.hp + 1000);
    }
    // the player's towers scale with THEIR base tier: raise max HP + heal the gain
    const tbs = this.bstat(player, 'tower');
    for (const s of this.structures) {
      if ((s.owner != null ? s.owner : s.team) !== player || s.kind !== 'tower' || s.hp <= 0) continue;
      const nm = towerStatForTier(tbs, this.tier[player]).hp;
      const gain = nm - s.maxHp;
      s.maxHp = nm;
      if (gain > 0) s.hp = Math.min(nm, s.hp + gain);
    }
    this.events.push({ type: 'tierUp', team: player, tier: this.tier[player] });
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
    const { hw, hh } = this.footprintHalf(team, unitId);
    const fits = (zone) => zone && !(x - hw < zone.x0 || x + hw > zone.x1 || y - hh < zone.y0 || y + hh > zone.y1);
    // the footprint (a point for 1x1 units) must sit inside ANY living army
    // strip on the player's own side — your own or an ally's. Teammates share
    // their whole depth freely: you can send your formation to hold a line that
    // isn't yours (and a baseless player simply keeps doing it).
    let inStrip = false;
    for (const q of this.playersOnSide(this.sideOf(team))) {
      if (this.zones[q].alive && fits(this.zones[q].army)) { inStrip = true; break; }
    }
    if (!inStrip) return false;
    const min = CONFIG.TEMPLATE_MIN_DIST;
    // overlap runs against EVERY same-side player's parked templates (allies can
    // share a strip); 1v1 has one player per side, so this is the historical check
    for (const q of this.playersOnSide(this.sideOf(team))) {
      for (let i = 0; i < this.templates[q].length; i++) {
        if (q === team && i === ignoreIndex) continue;
        const tpl = this.templates[q][i];
        const t = this.footprintHalf(q, tpl.type);
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
    }
    return true;
  }

  // Buildings go in the construction zone, without overlapping structures.
  // Footprint is a cw x ch cell rectangle; the whole box must fit the zone
  // and stay clear of existing structures (both treated as boxes).
  isValidBuildPlacement(team, kind, x, y, ignoreId = null) {
    // 'main' is only buildable through the REBUILD path (a fallen player raises
    // a new base inside an ally's zone) — it's not in the regular catalog
    if (kind !== 'main' && !CONFIG.BUILDINGS[kind]) return false;
    const ext = structureExtents(kind, this.bstat(team, kind));
    const boxFits = (z) => z && x - ext.hw >= z.x0 && x + ext.hw <= z.x1 && y - ext.hh >= z.y0 && y + ext.hh <= z.y1;
    // A building may go in ANY living construction zone on the player's own side
    // — theirs or a teammate's — plus the side's forward pocket by the mid
    // turret. Allies invest freely in each other's depth; the player's own
    // global caps (checked by the build command) are the only limit.
    const side = this.sideOf(team);
    let hosted = kind !== 'main' && this.midBuild && boxFits(this.midBuild[side]);
    if (!hosted) {
      for (const q of this.playersOnSide(side)) {
        if (!this.zones[q].alive) continue;
        if (boxFits(this.zones[q].build)) { hosted = true; break; }
      }
    }
    if (!hosted) return false;
    const gap = CONFIG.BUILD_GAP;
    for (const s of this.structures) {
      if (s.hp <= 0) continue;
      if (ignoreId != null && s.id === ignoreId) continue; // a moving building ignores its own old spot
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

    // A commander dropped out (online). Relayed like any other command so every
    // client applies it on the SAME tick: their base and army fight on, but
    // their teammates now count as the smaller side (asymmetric income bonus).
    if (cmd.type === 'abandon') {
      if (this.abandoned[cmd.team]) return { ok: false, reason: 'already-gone' };
      this.abandoned[cmd.team] = true;
      this.events.push({ type: 'abandon', team: cmd.team });
      return { ok: true };
    }

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

    if (cmd.type === 'build' && cmd.kind === 'main') {
      // REBUILD THE BASE: a fallen player (zone collapsed, no living main) may
      // raise a NEW main inside an ally's living zone. It rises as a normal
      // construction site, counts toward the win condition again (the enemy
      // must break it too), and re-enables tier-ups. Repeatable if it falls.
      const live = this.mainOfPlayer(cmd.team);
      if (live && live.hp > 0) return { ok: false, reason: 'has-base' };
      if (this.zones[cmd.team] && this.zones[cmd.team].alive) return { ok: false, reason: 'zone-alive' };
      const price = CONFIG.TEAM_MAIN_REBUILD_COST != null ? CONFIG.TEAM_MAIN_REBUILD_COST : 400;
      if (this.money[cmd.team] < price) return { ok: false, reason: 'money' };
      if (!this.isValidBuildPlacement(cmd.team, 'main', cmd.x, cmd.y)) return { ok: false, reason: 'zone' };
      this.money[cmd.team] -= price;
      this.spent[cmd.team] += price;
      const s = makeStructure(this, this.sideOf(cmd.team), 'main', cmd.x, cmd.y, cmd.team);
      s.maxHp = this.bstat(cmd.team, 'main').hp[this.tier[cmd.team] - 1]; // HP at the player's tier
      const wait = CONFIG.TEAM_MAIN_REBUILD_TIME != null ? CONFIG.TEAM_MAIN_REBUILD_TIME : 30;
      if (wait > 0) {
        s.building = true;
        s.buildStart = this.time;
        s.buildDone = this.time + wait;
        s.hp = Math.max(1, Math.round(s.maxHp * 0.15));
      } else s.hp = s.maxHp;
      this.events.push({ type: 'mainRebuilt', team: this.sideOf(cmd.team), owner: cmd.team, x: cmd.x, y: cmd.y });
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
      // CLASSIC 1v1: mines rise ONLY on their predefined plots — snap the click
      // to the nearest free plot. TEAM MODES have no plots (empty list): mines
      // build freely inside the zone like any other building (cap still holds).
      if (cmd.kind === 'generator' && this.mineSpots[cmd.team].length) {
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
      makeStructure(this, this.sideOf(cmd.team), cmd.kind, bx, by, cmd.team);
      if (wallCharged) this.wallStock[cmd.team]--; // spend a charge
      return { ok: true };
    }

    if (cmd.type === 'sellBuilding') {
      const s = this.byId.get(cmd.id);
      // you may only sell YOUR OWN building (owner check; 1v1: owner === team)
      if (!s || !s.isStructure || (s.owner != null ? s.owner : s.team) !== cmd.team || s.hp <= 0)
        return { ok: false, reason: 'unknown-building' };
      if (s.kind === 'main' || s.kind === 'turret')
        return { ok: false, reason: 'not-sellable' };
      this.money[cmd.team] += Math.round(
        this.bstat(cmd.team, s.kind).cost * CONFIG.SELL_BUILDING_REFUND
      );
      this.removeStructure(s, false);
      return { ok: true };
    }

    if (cmd.type === 'moveBuilding') {
      const s = this.byId.get(cmd.id);
      // you may only move YOUR OWN building (owner check; 1v1: owner === team)
      if (!s || !s.isStructure || (s.owner != null ? s.owner : s.team) !== cmd.team || s.hp <= 0)
        return { ok: false, reason: 'unknown-building' };
      if (s.kind === 'main' || s.kind === 'turret')
        return { ok: false, reason: 'not-movable' }; // the base + starting turret stay put
      let bx = cmd.x, by = cmd.y;
      // classic 1v1: mines only move onto a free predefined plot (their own
      // current plot frees up as they leave it); team modes move freely
      if (s.kind === 'generator' && this.mineSpots[cmd.team].length) {
        const spot = this.nearestFreeMineSpot(cmd.team, cmd.x, cmd.y);
        if (!spot) return { ok: false, reason: 'no-spot' };
        bx = spot.x; by = spot.y;
      }
      // validate the new spot, ignoring this building's OWN footprint (it's moving)
      if (!this.isValidBuildPlacement(cmd.team, s.kind, bx, by, s.id))
        return { ok: false, reason: 'zone' };
      // relocate and restart construction: it's inert while it rebuilds (30s)
      s.x = bx; s.y = by; s.prevX = bx; s.prevY = by;
      const rebuild = CONFIG.MOVE_REBUILD_TIME != null ? CONFIG.MOVE_REBUILD_TIME : 30;
      s.building = true;
      s.buildStart = this.time;
      s.buildDone = this.time + rebuild;
      s.hp = Math.max(1, Math.round(s.maxHp * 0.15)); // like a fresh construction site
      this.events.push({ type: 'moveBuilding', team: cmd.team, kind: s.kind, x: bx, y: by });
      return { ok: true };
    }

    if (cmd.type === 'upgradeBase') {
      // a baseless player has no main to upgrade (the base can't be rebuilt)
      const myMain = this.mainOfPlayer(cmd.team);
      if (!myMain || myMain.hp <= 0) return { ok: false, reason: 'no-base' };
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
      // prerequisite upgrades must be owned first (e.g. Brothers Skeleton needs
      // both Melee + Ranged unlocks).
      if (Array.isArray(up.requires) && up.requires.some((r) => !this.upgrades[cmd.team].has(r))) {
        return { ok: false, reason: 'requires' };
      }
      if (this.upgrades[cmd.team].has(cmd.id)) return { ok: false, reason: 'owned' };
      const cost = up.params.cost || 0;
      if (this.money[cmd.team] < cost) return { ok: false, reason: 'money' };
      this.money[cmd.team] -= cost;
      this.spent[cmd.team] += cost;
      this.upgrades[cmd.team].add(cmd.id);
      this.events.push({ type: 'upgradeBought', team: cmd.team, id: cmd.id });
      return { ok: true };
    }

    // Undead: buy one step of the skeleton-cap base upgrade (repeatable).
    if (cmd.type === 'buySkelCap') {
      if (this.skelCapOf(cmd.team) >= (CONFIG.SKEL_CAP_MAX || 0)) return { ok: false, reason: 'max' };
      const cost = this.skelCapCostOf(cmd.team);
      if (this.money[cmd.team] < cost) return { ok: false, reason: 'money' };
      this.money[cmd.team] -= cost;
      this.spent[cmd.team] += cost;
      this.skelBought[cmd.team]++;
      this.events.push({ type: 'skelCapUp', team: cmd.team, cap: this.skelCapOf(cmd.team) });
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
    for (let t = 0; t < this.players.length; t++) this.money[t] += this.incomePerSecond(t) * dt;

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
    for (let t = 0; t < this.players.length; t++) {
      const u = this.baseUpgrade[t];
      if (u && this.time >= u.done) {
        this.baseUpgrade[t] = null;
        this.applyTierUp(t);
      }
    }

    // Wall charges: the stock of buildable walls refills by 1 every chainDelay
    // seconds, up to chainMax. It idles once full and resumes as soon as you
    // spend one (build a wall). chainMax <= 1 turns the whole system off.
    for (let t = 0; t < this.players.length; t++) {
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
    for (const req of this.abilityCastReq) req.clear();

    // Raisable corpses expire; drop the stale ones (cheap, usually short).
    if (this.corpses.length) {
      const kept = [];
      for (const c of this.corpses) if (this.time < c.until) kept.push(c);
      this.corpses = kept;
    }
  }

  removeStructure(s, destroyed) {
    const owner = s.owner != null ? s.owner : s.team;
    if (destroyed) {
      this.events.push({ type: 'structureDestroyed', x: s.x, y: s.y, team: s.team, owner, kind: s.kind, tier: this.tier[owner], hw: s.hw, hh: s.hh });
      // destroying the mid-field turret pays its bounty (the DESTROYED turret's
      // per-race stat) to the enemy SIDE — split evenly among its players
      // (1v1: the single enemy player takes it all, as before)
      if (s.kind === 'turret') {
        const bounty = this.bstat(owner, 'turret').bounty || 0;
        const foes = this.playersOnSide(1 - s.team);
        if (bounty > 0 && foes.length) {
          const share = Math.round(bounty / foes.length);
          for (const p of foes) this.money[p] += share;
        }
      }
      if (s.kind === 'main' && this.winner === null) {
        s.hp = 0;
        // a SIDE only falls once its LAST main is down (team modes have one
        // main per player; 1v1 has a single main, so this fires immediately)
        const anyLeft = this.structures.some((o) => o !== s && o.team === s.team && o.kind === 'main' && o.hp > 0);
        if (!anyLeft) {
          this.winner = 1 - s.team;
          this.events.push({ type: 'gameover', winner: this.winner });
        } else {
          this.events.push({ type: 'mainDown', team: s.team, owner: s.owner, x: s.x, y: s.y });
          // defense in depth: the fallen player's WHOLE zone collapses —
          // buildings + parked army are destroyed, every investor refunded X%
          this.collapseZone(s.owner != null ? s.owner : s.team);
        }
        return; // keep the ruined main for the end-screen render
      }
    }
    this.byId.delete(s.id);
    this.structures = this.structures.filter((x) => x !== s);
  }

  // Defense in depth: a player's main fell (and their side survives) — their
  // WHOLE zone collapses. Every structure inside the build strip and every
  // parked army template inside the army strip is destroyed, and each INVESTOR
  // gets TEAM_REFUND_PCT% of what THEY paid back (allies who built there too).
  // Units already deployed on the battlefield keep fighting. The player becomes
  // baseless: no new main, but they keep playing through the allies' zones.
  collapseZone(owner) {
    const z = this.zones[owner];
    if (!z || !z.alive) return;
    z.alive = false;
    const pct = (CONFIG.TEAM_REFUND_PCT != null ? CONFIG.TEAM_REFUND_PCT : 50) / 100;
    // structures inside the fallen BUILD strip (any allied owner) — the ruined
    // main itself stays as scenery
    for (const s of [...this.structures]) {
      if (s.hp <= 0 || s.kind === 'main' || s.kind === 'turret') continue;
      if (s.x < z.build.x0 || s.x > z.build.x1 || s.y < z.build.y0 || s.y > z.build.y1) continue;
      const o = s.owner != null ? s.owner : s.team;
      this.money[o] += Math.round((this.bstat(o, s.kind).cost || 0) * pct);
      this.removeStructure(s, true);
    }
    // parked army templates inside the fallen ARMY strip (any allied player)
    for (const q of this.playersOnSide(this.sideOf(owner))) {
      const keep = [];
      for (const tpl of this.templates[q]) {
        if (tpl.x >= z.army.x0 && tpl.x <= z.army.x1 && tpl.y >= z.army.y0 && tpl.y <= z.army.y1) {
          this.money[q] += Math.round((this.ustat(q, tpl.type).cost || 0) * pct);
        } else keep.push(tpl);
      }
      this.templates[q] = keep;
    }
    this.events.push({ type: 'zoneCollapse', owner, team: this.sideOf(owner), x: (z.build.x0 + z.build.x1) / 2, y: (z.build.y0 + z.build.y1) / 2 });
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
        if (!e.summon && !e.isStructure && !e.exploded) {
          // units bigger than 1×1 leave the larger corpse decal (if uploaded).
          // A bomber that detonated leaves nothing (it blew itself up).
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
