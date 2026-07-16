// The AI opponent. It buys through the exact same issueCommand API as the
// player — no hidden pathways. Its own PRNG keeps the sim RNG untouched.
//
// Priorities each think (1/s): economy (generators) -> tier upgrades ->
// defensive reaction (towers, then a wall arc around the main base) ->
// units via the counter/composition brain, filtered by unlocked tier.

import { CONFIG } from '../config.js';
import { UNIT_IDS } from '../units.js';
import { UPGRADE_IDS } from '../upgrades.js';
import { resolvedUpgrade, TECH_BUILDINGS, resolvedHeroId, heroAbilitySlots } from '../ui/balance.js';
import { mulberry32 } from './rng.js';

// Target army-cost share per role. Tuned toward a solid frontline so the AI
// isn't a soft ranged blob that folds to a melee counter.
const CATEGORY_TARGETS = { front: 0.45, ranged: 0.25, special: 0.15, support: 0.15 };

// The AI "brain" as a set of numeric knobs. The evolutionary trainer breeds
// these; passing null keeps the exact hand-tuned behavior below. Every field is
// a scalar so a genome is trivial to mutate/crossover/serialize.
export const DEFAULT_GENOME = {
  tFront: 0.45, tRanged: 0.25, tSpecial: 0.15, tSupport: 0.15, // composition targets
  counterChance: 0.5,   // chance to buy a hard counter each think
  aggression: 0.3,      // chance to adopt the "push the middle" posture
  tier2Wave: 3,         // wave from which it saves toward tier 2
  tier3Wave: 7,         // wave from which it saves toward tier 3
  savePatience: 15,     // seconds-to-afford under which it saves for the wanted unit
  farmBuffer: 4,        // build a farm when (foodCap - foodUsed) drops below this
  maxGens: 5,           // generators to grow to in the late game
  midTowers: 2,         // towers to plant in the forward pocket by the front turret
};

export function randomGenome(rand) {
  const r = (lo, hi) => lo + rand() * (hi - lo);
  const raw = { front: r(0.15, 0.6), ranged: r(0.1, 0.45), special: r(0.05, 0.35), support: r(0.02, 0.25) };
  const sum = raw.front + raw.ranged + raw.special + raw.support;
  return {
    tFront: raw.front / sum, tRanged: raw.ranged / sum, tSpecial: raw.special / sum, tSupport: raw.support / sum,
    counterChance: r(0, 1), aggression: r(0, 0.7),
    tier2Wave: Math.round(r(1, 6)), tier3Wave: Math.round(r(5, 12)),
    savePatience: r(5, 30), farmBuffer: Math.round(r(1, 8)), maxGens: Math.round(r(3, 8)),
  };
}

// Composition category from RESOLVED stats (NOT the original slot id), so the
// AI reads a fully custom/renamed roster correctly: a melee tank counts as
// front even on the old "archon" (ranged) slot, a shooter as ranged, etc.
export function categoryOf(s) {
  if (!s) return 'front';
  if (s.heal || (s.caster && s.abilities && s.abilities.length)) return 'support';
  if (s.isAir || ((s.splash || 0) > 0 && s.ranged)) return 'special'; // fliers + artillery
  if (s.ranged) return 'ranged';
  return 'front'; // plain melee
}

// Placement bands: fraction of army-zone depth, measured from the edge
// facing the enemy (0 = frontmost, 1 = backmost).
const ROLE_BANDS = {
  front: [0.02, 0.3],
  mid: [0.35, 0.65],
  back: [0.7, 0.95],
};

// Role from RESOLVED stats (works for fully custom units): healers/casters and
// artillery sit in the back, ranged/fliers mid, everyone else up front.
function roleOf(s) {
  if (s.heal || (s.caster && s.abilities && s.abilities.length)) return 'back';
  if ((s.range || 0) >= 250) return 'back';
  if (s.isAir || (s.range || 0) >= 100) return 'mid';
  return 'front';
}

export class AIController {
  constructor(team, difficulty, seed, genome = null) {
    this.team = team;
    this.diff = CONFIG.DIFFICULTY[difficulty] || CONFIG.DIFFICULTY.normal;
    // brain knobs: a genome (from the trainer) overrides the hand-tuned values;
    // without one, mirror the exact previous behavior (incl. difficulty counter)
    this.g = { ...DEFAULT_GENOME, ...(genome || {}) };
    if (!genome) {
      this.g.counterChance = this.diff.counterChance;
      this.g.aggression = CONFIG.MID_INCOME > 0 ? 0.45 : 0.2; // preserve prior behavior
    }
    this.rng = mulberry32(seed >>> 0);
    this.timer = 0;
    this.purchases = 0;
    this.wallsPlanned = false;
    this.wallQueue = [];
    this.midWallsPlanned = false; // wall line by the front turret (planned once)
    this.midWallQueue = [];
    this.midNextTowerWave = 2;    // earliest wave to commit the next mid tower
    this.manageTick = 0; // army-management cadence (sell / rearrange)
    this.nextSellAt = 0; // game.time before which we won't sell again (anti-churn)
    this.aggro = false;  // "push the middle" posture: muster forward to grab mid
    this.aggroReroll = 0; // game.time to re-decide the posture
    this.intent = '—';   // human-readable current plan (debug overlay)
  }

  update(game, dt) {
    if (game.winner !== null) return;
    this.timer += dt;
    while (this.timer >= 1) {
      this.timer -= 1;
      this.think(game);
    }
  }

  think(game) {
    const t = this.team;
    const money = game.money[t];

    // Occasionally adopt a "push the middle" posture: muster the whole army on
    // the front rows so it reaches (and holds) midfield sooner. Worth chasing
    // mostly when holding the middle actually pays income; re-decided every
    // ~20-40s so a match ebbs and flows instead of one fixed style.
    if (game.time >= this.aggroReroll) {
      this.aggro = this.rng() < this.g.aggression;
      this.aggroReroll = game.time + 20 + this.rng() * 20;
    }

    // 0. Army management every 3rd think: sell dead weight or fix the
    // formation — at most ONE action, so it looks deliberate, not spastic.
    if (++this.manageTick >= 3) {
      this.manageTick = 0;
      if (this.manageArmy(game)) return;
    }

    // 1. Economy first: rush 2 generators, grow toward the target as the game
    // develops — but never past the generator's build cap, or we'd loop forever
    // trying to place an impossible 5th and hoard gold instead of spending it.
    const gens = game.countKind(t, 'generator');
    const genCap = game.bstat(t, 'generator').cap || 99;
    const wantGens = Math.min(genCap,
      game.waveCount < 1 ? 2 : game.waveCount < 4 ? 3 : Math.max(3, this.g.maxGens));
    if (gens < wantGens && game.buildCdLeft(t, 'generator') === 0) {
      const gc = game.buildCost(t, 'generator'); // mines get pricier each time
      if (money >= gc) {
        this.intent = '🏭 Generator (economie)';
        if (this.tryBuild(game, 'generator')) return; // built one — done this think
        // couldn't place it (zone full) — fall through and spend, don't stall
      } else {
        this.intent = `💰 economisește ${Math.ceil(gc)} → Generator`;
        return; // save for economy
      }
    }

    // 1.2 Food: build a farm when we're within a few food of the cap, so the
    // army can keep growing (food is the only army-size limit).
    const farmCap = game.bstat(t, 'farm').cap;
    if (game.foodCap(t) - game.foodUsed(t) < this.g.farmBuffer && game.countKind(t, 'farm') < farmCap
        && game.buildCdLeft(t, 'farm') === 0) {
      const fc = game.bstat(t, 'farm').cost;
      this.intent = money >= fc ? '🌾 Fermă (food)' : `💰 economisește ${Math.ceil(fc)} → Fermă`;
      if (money >= fc) { if (this.tryBuild(game, 'farm')) return; }
      else return; // save for the farm — nothing else to field until food frees up
    }

    // 1.4 Hero: a big power spike that also earns XP all match, so field it
    // early and spend its talent points. Handled apart from the unit brain
    // (which excludes heroes). Returns true if it bought/ranked or is saving.
    if (this.manageHero(game)) return;

    // 1.5 Upgrades configured for our race: grab them once the army exists.
    if (game.waveCount >= 2) {
      for (const id of UPGRADE_IDS) {
        if (game.upgrades[t].has(id)) continue;
        const up = resolvedUpgrade(id);
        if (!up || !up.unit || (up.race && up.race !== game.races[t])) continue;
        // only worth buying if we actually field that unit
        if (!game.templates[t].some((tpl) => tpl.type === up.unit)) continue;
        if (money >= (up.params.cost || 0) + 150) {
          this.intent = `⬆ upgrade: ${up.name || id}`;
          if (game.issueCommand({ type: 'buyUpgrade', team: t, id }).ok) return;
        }
      }
    }

    // 2. Tier up at sensible timings. (Skip entirely while a tier-up is already
    // in progress — can't queue a second one, and no point hoarding for it.)
    const upCost = game.tierUpCost(t);
    if (upCost !== null && !game.baseUpgrading(t)) {
      const due =
        (game.tier[t] === 1 && game.waveCount >= this.g.tier2Wave) ||
        (game.tier[t] === 2 && game.waveCount >= this.g.tier3Wave);
      // Flush with cash (e.g. a rich start or fat economy) → tier up NOW instead
      // of waiting for the wave gate: a higher tier unlocks stronger units and
      // heals the base. The buffer keeps enough spare to still field an army.
      const rich = money >= upCost + 250;
      if (due || rich) {
        if (money >= upCost) {
          this.intent = '🏰 Upgrade Bază (tier up)';
          if (game.issueCommand({ type: 'upgradeBase', team: t }).ok) return;
        } else {
          // Commit to saving for the tier once it's due — tiering unlocks the
          // whole higher-tier roster, so it's worth pausing unit buys. The window
          // is generous (and scales with the base cadence) so a SLOW economy can
          // still commit: a tight 20s window meant a 400g tier at ~7g/s income
          // never got saved for, stranding the AI at tier 2 all match.
          const income = Math.max(1, game.incomePerSecond(t));
          const saveWindow = Math.max(45, (CONFIG.WAVE_INTERVAL || 20) * 2);
          if ((upCost - money) / income <= saveWindow) {
            this.intent = `💰 economisește ${Math.ceil(upCost)} → tier up`;
            return; // save toward the upgrade
          }
        }
      }
    }

    // 2.5 Tech buildings unlock the roster: build the ones gating a unit that's
    // reachable at our current tier (and not already up), one per think. Without
    // this the AI could never field a building-gated unit.
    for (const bk of TECH_BUILDINGS) {
      if (game.hasBuilding(t, bk)) continue;
      if (game.tier[t] < (game.bstat(t, bk).tier || 1)) continue; // not yet unlocked by tier
      const gated = UNIT_IDS.some((id) => {
        const s = game.ustat(t, id);
        return s.building === bk && s.tier <= game.tier[t];
      });
      if (!gated || game.buildCdLeft(t, bk) !== 0) continue;
      const bc = game.bstat(t, bk).cost;
      if (money >= bc) {
        this.intent = `🏗 ${game.bstat(t, bk).name || bk} (deblochează unități)`;
        if (this.tryBuild(game, bk)) return;
      } else {
        const income = Math.max(1, game.incomePerSecond(t));
        if ((bc - money) / income <= 15) {
          this.intent = `💰 economisește ${Math.ceil(bc)} → clădire`;
          return;
        }
      }
    }

    // 2.9 Fortify the FRONT turret: every few waves, COMMIT to one tower in the
    // forward pocket (saving for it so it actually happens), then thread a wall
    // line across its enemy-facing edge. Paced + capped so it fortifies the mid
    // turret without starving the army.
    if (game.waveCount >= 2 && CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[t]) {
      const midTowers = this.countMidStructures(game, 'tower');
      const towerCost = game.bstat(t, 'tower').cost;
      if (midTowers < this.g.midTowers && game.waveCount >= this.midNextTowerWave && game.buildCdLeft(t, 'tower') === 0) {
        if (money >= towerCost) {
          this.intent = '🗼 Tower (turreta din față)';
          if (this.tryBuildMid(game, 'tower')) { this.midNextTowerWave = game.waveCount + 3; return; }
        } else if ((towerCost - money) / Math.max(1, game.incomePerSecond(t)) <= 25) {
          this.intent = '💰 economisește → Tower (turreta din față)';
          return; // save toward the mid tower
        }
      }
      // once a tower stands out there, thread a cheap wall line across its front
      if (!this.midWallsPlanned && midTowers >= 1) { this.midWallsPlanned = true; this.midWallQueue = this.midWallLine(); }
      if (this.midWallQueue && this.midWallQueue.length > 0 && money >= game.bstat(t, 'wall').cost + 60) {
        const p = this.midWallQueue.shift(); // taken-or-not, drop it
        if (game.issueCommand({ type: 'build', team: t, kind: 'wall', x: p.x, y: p.y }).ok) return;
      }
    }

    // 3. Defensive reaction: our base took damage -> towers, then (at T2+)
    // a one-time wall arc in front of the main base.
    const main = game.mainOf(t);
    const threatened =
      (main && main.hp < main.maxHp * 0.995) ||
      game.structures.some(
        (s) => s.team === t && s.kind === 'generator' && s.hp > 0 && s.hp < s.maxHp
      );
    if (threatened && game.countKind(t, 'tower') < 3) {
      if (money >= game.bstat(t, 'tower').cost) {
        this.intent = '🗼 Tower (apărare)';
        if (this.tryBuild(game, 'tower')) return;
      } else {
        this.intent = '💰 economisește → Tower (apărare)';
        return; // save for the tower
      }
    }
    if (game.tier[t] >= 2 && !this.wallsPlanned) {
      this.wallsPlanned = true;
      this.wallQueue = this.wallArc(game);
    }
    if (this.wallQueue.length > 0 && money >= game.bstat(t, 'wall').cost + 100) {
      const p = this.wallQueue.shift(); // spot may be taken — drop it either way
      if (game.issueCommand({ type: 'build', team: t, kind: 'wall', x: p.x, y: p.y }).ok) return;
    }

    // 4. Units: counter pass then composition, within the unlocked tier.
    // Guard a frontline: if melee "front" units are a thin slice of the army,
    // skip the counter pass and let composition build one — otherwise the AI
    // can spam a weak ranged counter that folds to a couple of melee units.
    let frontCost = 0;
    let armyCost = 0;
    for (const tpl of game.templates[t]) {
      const s = game.ustat(t, tpl.type);
      armyCost += s.cost;
      if (categoryOf(s) === 'front') frontCost += s.cost;
    }
    const frontThin = armyCost > 0 && frontCost / armyCost < 0.25;

    let want = null;
    if (!frontThin && this.rng() < this.g.counterChance) want = this.pickCounter(game);
    if (!want || game.ustat(t, want).tier > game.tier[t] || !this.unlocked(game, game.ustat(t, want)))
      want = this.pickComposition(game);
    if (!want) return;

    let stats = game.ustat(t, want);
    if (money < stats.cost) {
      // The ideal pick is unaffordable right now. SAVE toward it when income can
      // cover the gap soon — otherwise an expensive-but-wanted unit (e.g. a 170g
      // grunt the composition keeps asking for) would never be bought, because
      // the AI would forever spend the money on cheaper affordable units first.
      // Only fall back to the strongest affordable pick when the wanted unit is
      // far out of reach, so the army doesn't stall on an absurdly-priced unit.
      const income = Math.max(1, game.incomePerSecond(t));
      const secondsToAfford = (stats.cost - money) / income;
      if (secondsToAfford <= this.g.savePatience) {
        this.intent = `💰 economisește ${Math.ceil(stats.cost)} → ${stats.name}${this.aggro ? ' (ofensiv)' : ''}`;
        return; // save up a few ticks, then buy it
      }
      const affordable = UNIT_IDS
        .map((id) => ({ id, s: game.ustat(t, id) }))
        .filter(({ s }) => s.tier <= game.tier[t] && this.unlocked(game, s) && s.cost <= money)
        .sort((a, b) => b.s.cost - a.s.cost)[0];
      if (!affordable) { this.intent = '💰 fără bani — așteaptă venit'; return; } // genuinely broke
      want = affordable.id;
      stats = game.ustat(t, want);
    }
    const { x, y } = this.pickPlacement(game, want);
    if (game.issueCommand({ type: 'buy', team: t, unitId: want, x, y }).ok) {
      this.intent = `⚔ ${stats.name}${this.aggro ? ' (ofensiv → mijloc)' : ''}`;
      this.purchases++;
    }
  }

  // Field the hero and spend its talent points. One action per call; returns
  // true if it bought the hero, ranked an ability, or is deliberately saving
  // toward the hero (so the caller stops there this think).
  manageHero(game) {
    const t = this.team;
    const heroId = resolvedHeroId(game.races[t]);
    if (!heroId) return false; // no hero defined for this race
    // heroes still time-locked (⚙ Balance) — don't buy or save toward one yet
    if (game.time < (CONFIG.HERO_UNLOCK_TIME || 0) && !game.heroTemplate(t)) return false;

    const tpl = game.heroTemplate(t);
    if (tpl) {
      // Already fielded — invest any unspent talent points (one per think).
      if ((tpl.points || 0) <= 0) return false;
      const slots = heroAbilitySlots(game.races[t]).filter((s) => s.id);
      const ranks = tpl.ranks || {};
      const level = tpl.level || 1;
      // take the ultimate as soon as it's available (level 6, still unranked)…
      const ult = slots.find((s) => s.ult && level >= 6 && (ranks[s.id] || 0) < 1);
      // …otherwise pour into the lowest-ranked non-maxed skill (spread then max)
      const skills = slots.filter((s) => !s.ult && (ranks[s.id] || 0) < 3)
        .sort((a, b) => (ranks[a.id] || 0) - (ranks[b.id] || 0));
      const pick = ult || skills[0];
      if (!pick) return false;
      if (game.issueCommand({ type: 'rankHero', team: t, ability: pick.id }).ok) {
        this.intent = `⭐ Erou: învață ${pick.id}`;
        return true;
      }
      return false;
    }

    // Not fielded yet: buy it when tier/tech/food/gold allow. Save toward it if
    // it's within income reach; don't hard-block if it's far out of budget.
    const hs = game.ustat(t, heroId);
    if (!hs) return false;
    if (hs.tier > game.tier[t]) return false;                      // tier-locked
    if (hs.building && !game.hasBuilding(t, hs.building)) return false; // tech not up yet
    if (game.foodUsed(t) + (hs.food || 0) > game.foodCap(t)) return false; // no food room
    const money = game.money[t];
    if (money >= hs.cost) {
      const { x, y } = this.pickPlacement(game, heroId);
      if (game.issueCommand({ type: 'buy', team: t, unitId: heroId, x, y }).ok) {
        this.intent = `⭐ Erou: ${hs.name || heroId}`;
        return true;
      }
      return false;
    }
    const income = Math.max(1, game.incomePerSecond(t));
    if ((hs.cost - money) / income <= this.g.savePatience) {
      this.intent = `💰 economisește ${Math.ceil(hs.cost)} → Erou`;
      return true; // save a few ticks toward the hero
    }
    return false;
  }

  // One army-management action per call: sell a unit that can't contribute
  // against the enemy's composition, free a slot when capped, or move the
  // most out-of-position unit back into its role band. Returns true if acted.
  manageArmy(game) {
    const t = this.team;
    const et = 1 - t;
    const tpls = game.templates[t];
    if (tpls.length === 0) return false;

    // enemy air share (by cost)
    let etotal = 0;
    let eair = 0;
    for (const tpl of game.templates[et]) {
      const s = game.ustat(et, tpl.type);
      etotal += s.cost;
      if (s.isAir) eair += s.cost;
    }

    // Selling only refunds part of the cost, so churning units bleeds the
    // economy. Two guards keep it disciplined: an anti-churn cooldown (no more
    // than one sell every ~12s) and a "the trade must pay off" rule — never
    // sell unless the refund actually lets us rebuild the replacement now.
    const canSellNow = game.time >= this.nextSellAt;
    const cheapestAA = UNIT_IDS
      .map((id) => game.ustat(t, id))
      .filter((s) => s.tier <= game.tier[t] && s.targetsAir)
      .reduce((m, s) => Math.min(m, s.cost), Infinity);

    // A) Dead weight: the enemy is mostly AIR and this unit can never touch
    // air. Sell it ONLY if the refund plus our cash can immediately fund an
    // anti-air unit — otherwise a useless body still blocks better than an
    // empty slot and wasted gold.
    if (canSellNow && etotal > 0 && eair / etotal > 0.5 && cheapestAA !== Infinity) {
      const idx = tpls.findIndex((tpl) => !game.ustat(t, tpl.type).targetsAir);
      if (idx !== -1) {
        const refund = Math.round(game.ustat(t, tpls[idx].type).cost * CONFIG.SELL_REFUND);
        if (game.money[t] + refund >= cheapestAA &&
            game.issueCommand({ type: 'sellUnit', team: t, index: idx }).ok) {
          this.nextSellAt = game.time + 12;
          return true;
        }
      }
    }

    // B) At the food cap with money to spare: sell the cheapest unit so a
    // stronger buy can replace it (still rate-limited).
    if (canSellNow && game.foodUsed(t) >= game.foodCap(t) && game.money[t] > 400) {
      let cheap = 0;
      for (let i = 1; i < tpls.length; i++) {
        if (game.ustat(t, tpls[i].type).cost < game.ustat(t, tpls[cheap].type).cost) cheap = i;
      }
      if (game.issueCommand({ type: 'sellUnit', team: t, index: cheap }).ok) {
        this.nextSellAt = game.time + 12;
        return true;
      }
    }

    // C) Rearrange: move the unit farthest outside its role band back into it.
    const zone = CONFIG.ARMY_ZONE[t];
    const depth = zone.x1 - zone.x0;
    let worst = -1;
    let worstErr = 30; // ignore small offsets
    for (let i = 0; i < tpls.length; i++) {
      const band = ROLE_BANDS[roleOf(game.ustat(t, tpls[i].type))];
      const frac = t === 1 ? (tpls[i].x - zone.x0) / depth : (zone.x1 - tpls[i].x) / depth;
      const target = clamp(frac, band[0], band[1]);
      const err = Math.abs(frac - target) * depth;
      if (err > worstErr) { worstErr = err; worst = i; }
    }
    if (worst !== -1) {
      const band = ROLE_BANDS[roleOf(game.ustat(t, tpls[worst].type))];
      for (let attempt = 0; attempt < 6; attempt++) {
        const frac = band[0] + this.rng() * (band[1] - band[0]);
        const x = t === 1 ? zone.x0 + frac * depth : zone.x1 - frac * depth;
        const y = clamp(tpls[worst].y + (this.rng() * 2 - 1) * 40, zone.y0 + 16, zone.y1 - 16);
        if (game.issueCommand({ type: 'moveUnit', team: t, index: worst, x, y }).ok) return true;
      }
    }
    return false;
  }

  // A unit is fieldable by the AI only if it's not a hero (heroes aren't wired
  // for the AI yet) and its gating tech building (if any) is standing.
  unlocked(game, s) {
    return !s.isHero && (!s.building || game.hasBuilding(this.team, s.building));
  }

  // Try a handful of candidate spots; the sim validates zone/overlap.
  tryBuild(game, kind) {
    // mines go only on their predefined plots — aim straight at a free one
    if (kind === 'generator' && game.mineSpots) {
      for (const p of game.mineSpots[this.team]) {
        if (game.issueCommand({ type: 'build', team: this.team, kind, x: p.x, y: p.y }).ok) return true;
      }
      return false;
    }
    const zone = CONFIG.CONSTRUCTION_ZONE[this.team];
    const w = zone.x1 - zone.x0;
    for (let i = 0; i < 12; i++) {
      let x;
      let y;
      if (kind === 'generator' || kind === 'farm' || TECH_BUILDINGS.includes(kind)) {
        // tucked toward the back edge, spread vertically
        const off = 30 + this.rng() * w * 0.4;
        x = this.team === 1 ? zone.x1 - off : zone.x0 + off;
        y = zone.y0 + 60 + this.rng() * (zone.y1 - zone.y0 - 120);
      } else {
        // towers guard the front edge of the construction zone
        const off = 30 + this.rng() * 90;
        x = this.team === 1 ? zone.x0 + off : zone.x1 - off;
        y = CONFIG.MAIN.y + (this.rng() * 2 - 1) * 420;
      }
      if (game.issueCommand({ type: 'build', team: this.team, kind, x, y }).ok) return true;
    }
    return false;
  }

  // How many living structures of `kind` we have inside the forward build
  // pocket (around the front turret).
  countMidStructures(game, kind) {
    const z = CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[this.team];
    if (!z) return 0;
    return game.structures.filter((s) => s.team === this.team && s.kind === kind && s.hp > 0
      && s.x >= z.x0 && s.x <= z.x1 && s.y >= z.y0 && s.y <= z.y1).length;
  }

  // Place a building somewhere free inside the forward pocket (a few tries).
  tryBuildMid(game, kind) {
    const z = CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[this.team];
    if (!z) return false;
    for (let i = 0; i < 14; i++) {
      const x = z.x0 + 20 + this.rng() * (z.x1 - z.x0 - 40);
      const y = z.y0 + 20 + this.rng() * (z.y1 - z.y0 - 40);
      if (game.issueCommand({ type: 'build', team: this.team, kind, x, y }).ok) return true;
    }
    return false;
  }

  // A vertical wall line along the ENEMY-facing edge of the forward pocket.
  midWallLine() {
    const z = CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[this.team];
    if (!z) return [];
    const frontX = this.team === 0 ? z.x1 - 20 : z.x0 + 20; // toward the enemy
    const pts = [];
    for (let y = z.y0 + 40; y <= z.y1 - 40; y += 40) pts.push({ x: frontX, y });
    return pts;
  }

  // Arc of wall spots shielding the main base from the enemy side.
  wallArc(game) {
    const main = game.mainOf(this.team);
    if (!main) return [];
    const dir = this.team === 0 ? 1 : -1;
    const pts = [];
    for (let deg = -70; deg <= 70; deg += 28) {
      const rad = (deg * Math.PI) / 180;
      pts.push({
        x: main.x + Math.cos(rad) * 130 * dir,
        y: main.y + Math.sin(rad) * 130,
      });
    }
    return pts;
  }

  // Counter picks read the RESOLVED stats (per-race, admin-tuned), so the AI
  // adapts to fully custom rosters: anti-air vs fliers, piercing vs armored,
  // splash vs cheap swarms — whatever units happen to carry those traits.
  pickCounter(game) {
    const t = this.team;
    const et = 1 - t;
    const enemy = game.templates[et];
    if (enemy.length === 0) return null;

    let total = 0;
    let air = 0;
    let armored = 0;
    let swarm = 0;
    for (const tpl of enemy) {
      const s = game.ustat(et, tpl.type);
      total += s.cost;
      if (s.isAir) air += s.cost;
      if (s.armor === 'armored') armored += s.cost;
      if (!s.isAir && s.cost <= 80) swarm += s.cost;
    }
    if (total === 0) return null;

    // The STRONGEST (most expensive) own unit matching a predicate. We return the
    // ideal counter regardless of affordability and let think()'s save/fallback
    // logic decide — otherwise the AI grabs the cheapest affordable counter every
    // think (e.g. spamming a 100g anti-air) and never saves for the real answer
    // (a 300g flier), which is exactly why it drowned in tier-1 units.
    const bestOwn = (pred) => {
      const pool = UNIT_IDS
        .map((id) => ({ id, s: game.ustat(t, id) }))
        .filter(({ s }) => s.tier <= game.tier[t] && this.unlocked(game, s) && pred(s));
      if (pool.length === 0) return null;
      pool.sort((a, b) => b.s.cost - a.s.cost);
      return pool[0].id;
    };

    if (air / total > 0.15) {
      const aa = bestOwn((s) => s.targetsAir);
      if (aa) return aa;
    }
    if (armored / total > 0.3) {
      const pierce = bestOwn((s) => s.dmgType === 'piercing');
      if (pierce) return pierce;
    }
    if (swarm / total > 0.4) {
      const splash = bestOwn((s) => (s.splash || 0) > 0);
      if (splash) return splash;
    }
    return null;
  }

  pickComposition(game) {
    const tier = game.tier[this.team];
    const own = game.templates[this.team];
    let total = 0;
    const catCost = { front: 0, ranged: 0, special: 0, support: 0 };
    for (const tpl of own) {
      const s = game.ustat(this.team, tpl.type);
      total += s.cost;
      catCost[categoryOf(s)] += s.cost;
    }

    // unit ids whose RESOLVED stats fall in a category (within the unlocked tier)
    const poolFor = (cat) => UNIT_IDS.filter((id) => {
      const s = game.ustat(this.team, id);
      return s.tier <= tier && this.unlocked(game, s) && categoryOf(s) === cat;
    });

    const targets = { front: this.g.tFront, ranged: this.g.tRanged, special: this.g.tSpecial, support: this.g.tSupport };
    let bestCat = null;
    let bestDeficit = -Infinity;
    for (const [cat, target] of Object.entries(targets)) {
      if (poolFor(cat).length === 0) continue;
      const share = total > 0 ? catCost[cat] / total : 0;
      const deficit = target - share;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestCat = cat;
      }
    }
    const pool = bestCat ? poolFor(bestCat)
      : UNIT_IDS.filter((id) => {
          const s = game.ustat(this.team, id);
          return s.tier <= tier && this.unlocked(game, s);
        });
    if (pool.length === 0) return null;
    // Prefer stronger (higher-tier) units so a well-off AI stops spamming tier 1
    // once tier 2/3 is unlocked — weight each candidate by tier² (t1=1, t2=4,
    // t3=9), still leaving room for the occasional cheap filler.
    const weighted = [];
    for (const id of pool) {
      const tw = game.ustat(this.team, id).tier || 1;
      for (let k = 0; k < tw * tw; k++) weighted.push(id);
    }
    return weighted[Math.floor(this.rng() * weighted.length)];
  }

  pickPlacement(game, unitId) {
    const zone = CONFIG.ARMY_ZONE[this.team];
    // aggressive posture: muster EVERYTHING on the front rows (nearest the
    // middle) so the army pushes for the mid income sooner; otherwise place by
    // role (melee front, ranged mid, artillery/support back)
    const band = this.aggro ? ROLE_BANDS.front : ROLE_BANDS[roleOf(game.ustat(this.team, unitId))];
    const frac = band[0] + this.rng() * (band[1] - band[0]);
    const depth = zone.x1 - zone.x0;
    // The edge facing the enemy: x0 for the right team, x1 for the left.
    const x =
      this.team === 1 ? zone.x0 + frac * depth : zone.x1 - frac * depth;

    // Bias y toward the enemy army's center of mass.
    const enemy = game.templates[1 - this.team];
    let avgY = CONFIG.MAIN.y; // lane center (the field extends lower as scenery)
    if (enemy.length > 0) {
      avgY = enemy.reduce((s, tpl) => s + tpl.y, 0) / enemy.length;
    }
    const y = clamp(
      avgY + (this.rng() * 2 - 1) * 220,
      zone.y0 + 16,
      zone.y1 - 16
    );
    return { x, y };
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
