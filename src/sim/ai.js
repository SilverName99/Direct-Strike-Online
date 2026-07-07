// The AI opponent. It buys through the exact same issueCommand API as the
// player — no hidden pathways. Its own PRNG keeps the sim RNG untouched.
//
// Priorities each think (1/s): economy (generators) -> tier upgrades ->
// defensive reaction (towers, then a wall arc around the main base) ->
// units via the counter/composition brain, filtered by unlocked tier.

import { CONFIG } from '../config.js';
import { UNIT_CATEGORIES, UNIT_IDS } from '../units.js';
import { UPGRADE_IDS } from '../upgrades.js';
import { resolvedUpgrade } from '../ui/balance.js';
import { mulberry32 } from './rng.js';

const CATEGORY_TARGETS = { front: 0.35, ranged: 0.3, special: 0.2, support: 0.15 };

// Placement bands: fraction of army-zone depth, measured from the edge
// facing the enemy (0 = frontmost, 1 = backmost).
const ROLE_BANDS = {
  front: [0.02, 0.3],
  mid: [0.35, 0.65],
  back: [0.7, 0.95],
};

const UNIT_ROLE = {
  grunt: 'front', bruiser: 'front', dasher: 'front',
  slinger: 'mid', lancer: 'mid', archon: 'mid', wasp: 'mid',
  crab: 'back', mender: 'back',
};

export class AIController {
  constructor(team, difficulty, seed) {
    this.team = team;
    this.diff = CONFIG.DIFFICULTY[difficulty] || CONFIG.DIFFICULTY.normal;
    this.rng = mulberry32(seed >>> 0);
    this.timer = 0;
    this.purchases = 0;
    this.wallsPlanned = false;
    this.wallQueue = [];
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
    let want = null;
    if (this.rng() < this.diff.counterChance) want = this.pickCounter(game);
    if (!want || game.ustat(t, want).tier > game.tier[t]) want = this.pickComposition(game);
    if (!want) return;

    const stats = game.ustat(t, want);
    if (money < stats.cost) return; // save
    const { x, y } = this.pickPlacement(game, want);
    if (game.issueCommand({ type: 'buy', team: t, unitId: want, x, y }).ok) {
      this.purchases++;
    }
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
      const c = game.ustat(this.team, tpl.type).cost;
      total += c;
      for (const [cat, ids] of Object.entries(UNIT_CATEGORIES)) {
        if (ids.includes(tpl.type)) catCost[cat] += c;
      }
    }

    let bestCat = null;
    let bestDeficit = -Infinity;
    for (const [cat, target] of Object.entries(CATEGORY_TARGETS)) {
      const pool = UNIT_CATEGORIES[cat].filter((id) => game.ustat(this.team, id).tier <= tier);
      if (pool.length === 0) continue;
      const share = total > 0 ? catCost[cat] / total : 0;
      const deficit = target - share;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestCat = cat;
      }
    }
    if (!bestCat) return 'grunt';
    const pool = UNIT_CATEGORIES[bestCat].filter((id) => game.ustat(this.team, id).tier <= tier);
    return pool[Math.floor(this.rng() * pool.length)];
  }

  pickPlacement(game, unitId) {
    const zone = CONFIG.ARMY_ZONE[this.team];
    const band = ROLE_BANDS[UNIT_ROLE[unitId]];
    const frac = band[0] + this.rng() * (band[1] - band[0]);
    const depth = zone.x1 - zone.x0;
    // The edge facing the enemy: x0 for the right team, x1 for the left.
    const x =
      this.team === 1 ? zone.x0 + frac * depth : zone.x1 - frac * depth;

    // Bias y toward the enemy army's center of mass.
    const enemy = game.templates[1 - this.team];
    let avgY = CONFIG.FIELD_H / 2;
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
