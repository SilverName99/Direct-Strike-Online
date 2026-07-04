// The AI opponent. It buys through the exact same issueCommand API as the
// player — no hidden pathways. Its own PRNG keeps the sim RNG untouched.

import { CONFIG } from '../config.js';
import { UNITS, UNIT_CATEGORIES } from '../units.js';
import { mulberry32 } from './rng.js';

const CATEGORY_TARGETS = { front: 0.35, ranged: 0.3, special: 0.2, support: 0.15 };

// Placement bands: fraction of build-zone depth, measured from the edge
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

    // Income pass: every 3rd purchase intent, in the early game.
    if (
      this.purchases > 0 &&
      this.purchases % 3 === 0 &&
      game.waveCount < 8 &&
      game.incomeLevel[t] < CONFIG.INCOME_UPGRADE_MAX
    ) {
      const cost = game.incomeUpgradeCost(t);
      if (game.money[t] >= cost) {
        if (game.issueCommand({ type: 'upgradeIncome', team: t }).ok) this.purchases++;
      }
      return; // save up for the upgrade
    }

    let want = null;
    if (this.rng() < this.diff.counterChance) want = this.pickCounter(game);
    if (!want) want = this.pickComposition(game);

    const stats = UNITS[want];
    if (game.money[t] < stats.cost) return; // save

    const { x, y } = this.pickPlacement(game, want);
    if (game.issueCommand({ type: 'buy', team: t, unitId: want, x, y }).ok) {
      this.purchases++;
    }
  }

  pickCounter(game) {
    const enemy = game.templates[1 - this.team];
    if (enemy.length === 0) return null;

    let total = 0;
    const cost = {};
    for (const tpl of enemy) {
      const c = UNITS[tpl.type].cost;
      total += c;
      cost[tpl.type] = (cost[tpl.type] || 0) + c;
    }
    const share = (ids) => ids.reduce((s, id) => s + (cost[id] || 0), 0) / total;

    if (share(['wasp']) > 0.15)
      return game.money[this.team] >= UNITS.archon.cost ? 'archon' : 'slinger';
    if (share(['bruiser', 'crab']) > 0.3) return 'lancer';
    if (share(['grunt', 'dasher']) > 0.4) return 'crab';
    if ((cost.crab || cost.mender || cost.lancer) && this.rng() < 0.5) return 'dasher';
    return null;
  }

  pickComposition(game) {
    const own = game.templates[this.team];
    let total = 0;
    const catCost = { front: 0, ranged: 0, special: 0, support: 0 };
    for (const tpl of own) {
      const c = UNITS[tpl.type].cost;
      total += c;
      for (const [cat, ids] of Object.entries(UNIT_CATEGORIES)) {
        if (ids.includes(tpl.type)) catCost[cat] += c;
      }
    }

    let bestCat = 'front';
    let bestDeficit = -Infinity;
    for (const [cat, target] of Object.entries(CATEGORY_TARGETS)) {
      const share = total > 0 ? catCost[cat] / total : 0;
      const deficit = target - share;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestCat = cat;
      }
    }
    const pool = UNIT_CATEGORIES[bestCat];
    return pool[Math.floor(this.rng() * pool.length)];
  }

  pickPlacement(game, unitId) {
    const zone = CONFIG.BUILD_ZONE[this.team];
    const band = ROLE_BANDS[UNIT_ROLE[unitId]];
    const frac = band[0] + this.rng() * (band[1] - band[0]);
    const depth = zone.x1 - zone.x0;
    // The edge facing the enemy: x1 for the left team, x0 for the right.
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
