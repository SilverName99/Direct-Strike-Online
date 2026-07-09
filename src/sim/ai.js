// The AI opponent. It buys through the exact same issueCommand API as the
// player — no hidden pathways. Its own PRNG keeps the sim RNG untouched.
//
// Priorities each think (1/s): economy (generators) -> tier upgrades ->
// defensive reaction (towers, then a wall arc around the main base) ->
// units via the counter/composition brain, filtered by unlocked tier.

import { CONFIG } from '../config.js';
import { UNIT_IDS } from '../units.js';
import { UPGRADE_IDS } from '../upgrades.js';
import { resolvedUpgrade } from '../ui/balance.js';
import { mulberry32 } from './rng.js';

// Target army-cost share per role. Tuned toward a solid frontline so the AI
// isn't a soft ranged blob that folds to a melee counter.
const CATEGORY_TARGETS = { front: 0.45, ranged: 0.25, special: 0.15, support: 0.15 };

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
  constructor(team, difficulty, seed) {
    this.team = team;
    this.diff = CONFIG.DIFFICULTY[difficulty] || CONFIG.DIFFICULTY.normal;
    this.rng = mulberry32(seed >>> 0);
    this.timer = 0;
    this.purchases = 0;
    this.wallsPlanned = false;
    this.wallQueue = [];
    this.manageTick = 0; // army-management cadence (sell / rearrange)
    this.nextSellAt = 0; // game.time before which we won't sell again (anti-churn)
    this.aggro = false;  // "push the middle" posture: muster forward to grab mid
    this.aggroReroll = 0; // game.time to re-decide the posture
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
      const wantMid = CONFIG.MID_INCOME > 0 ? 0.45 : 0.2;
      this.aggro = this.rng() < wantMid;
      this.aggroReroll = game.time + 20 + this.rng() * 20;
    }

    // 0. Army management every 3rd think: sell dead weight or fix the
    // formation — at most ONE action, so it looks deliberate, not spastic.
    if (++this.manageTick >= 3) {
      this.manageTick = 0;
      if (this.manageArmy(game)) return;
    }

    // 1. Economy first: rush 2 generators, grow to 5 as the game develops.
    // While the generator build-cooldown runs, don't stall — spend elsewhere.
    const gens = game.countKind(t, 'generator');
    const wantGens = game.waveCount < 1 ? 2 : game.waveCount < 4 ? 3 : 5;
    if (gens < wantGens && game.buildCdLeft(t, 'generator') === 0) {
      if (money >= game.bstat(t, 'generator').cost) this.tryBuild(game, 'generator');
      return; // save for economy
    }

    // 1.5 Upgrades configured for our race: grab them once the army exists.
    if (game.waveCount >= 2) {
      for (const id of UPGRADE_IDS) {
        if (game.upgrades[t].has(id)) continue;
        const up = resolvedUpgrade(id);
        if (!up || !up.unit || (up.race && up.race !== game.races[t])) continue;
        // only worth buying if we actually field that unit
        if (!game.templates[t].some((tpl) => tpl.type === up.unit)) continue;
        if (money >= (up.params.cost || 0) + 150) {
          if (game.issueCommand({ type: 'buyUpgrade', team: t, id }).ok) return;
        }
      }
    }

    // 2. Tier up at sensible timings.
    const upCost = game.tierUpCost(t);
    if (upCost !== null) {
      const due =
        (game.tier[t] === 1 && game.waveCount >= 3) ||
        (game.tier[t] === 2 && game.waveCount >= 7);
      if (due) {
        if (money >= upCost) {
          if (game.issueCommand({ type: 'upgradeBase', team: t }).ok) return;
        } else if (this.rng() < 0.7) {
          return; // save toward the upgrade
        }
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
        if (this.tryBuild(game, 'tower')) return;
      } else {
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
    if (!frontThin && this.rng() < this.diff.counterChance) want = this.pickCounter(game);
    if (!want || game.ustat(t, want).tier > game.tier[t]) want = this.pickComposition(game);
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
      if (secondsToAfford <= 15) return; // save up a few ticks, then buy it
      const affordable = UNIT_IDS
        .map((id) => ({ id, s: game.ustat(t, id) }))
        .filter(({ s }) => s.tier <= game.tier[t] && s.cost <= money)
        .sort((a, b) => b.s.cost - a.s.cost)[0];
      if (!affordable) return; // genuinely broke — wait for income
      want = affordable.id;
      stats = game.ustat(t, want);
    }
    const { x, y } = this.pickPlacement(game, want);
    if (game.issueCommand({ type: 'buy', team: t, unitId: want, x, y }).ok) {
      this.purchases++;
    }
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

    // B) At the template cap with money to spare: sell the cheapest unit so a
    // stronger buy can replace it (still rate-limited).
    if (canSellNow && tpls.length >= CONFIG.MAX_TEMPLATES && game.money[t] > 400) {
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

  // Try a handful of candidate spots; the sim validates zone/overlap.
  tryBuild(game, kind) {
    const zone = CONFIG.CONSTRUCTION_ZONE[this.team];
    const w = zone.x1 - zone.x0;
    for (let i = 0; i < 12; i++) {
      let x;
      let y;
      if (kind === 'generator') {
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

    // strongest own unit matching a predicate that we can afford now (falls
    // back to the cheapest match so the AI still saves toward it)
    const bestOwn = (pred) => {
      const pool = UNIT_IDS
        .map((id) => ({ id, s: game.ustat(t, id) }))
        .filter(({ s }) => s.tier <= game.tier[t] && pred(s));
      if (pool.length === 0) return null;
      pool.sort((a, b) => b.s.cost - a.s.cost);
      const affordable = pool.find(({ s }) => s.cost <= game.money[t]);
      return (affordable || pool[pool.length - 1]).id;
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
      return s.tier <= tier && categoryOf(s) === cat;
    });

    let bestCat = null;
    let bestDeficit = -Infinity;
    for (const [cat, target] of Object.entries(CATEGORY_TARGETS)) {
      if (poolFor(cat).length === 0) continue;
      const share = total > 0 ? catCost[cat] / total : 0;
      const deficit = target - share;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestCat = cat;
      }
    }
    const pool = bestCat ? poolFor(bestCat)
      : UNIT_IDS.filter((id) => game.ustat(this.team, id).tier <= tier);
    if (pool.length === 0) return 'grunt';
    return pool[Math.floor(this.rng() * pool.length)];
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
