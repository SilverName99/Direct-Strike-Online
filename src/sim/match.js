// Headless AI-vs-AI match runner for the evolutionary trainer. Deterministic:
// same seed + genomes + balance => same result. No DOM, no rendering — just the
// sim stepped to completion, returning the winner and per-team stats.

import { Game } from './game.js';
import { AIController } from './ai.js';

const DT = 1 / 30;

// Run one match to completion (or a timeout draw). `genomeA`/`genomeB` are AI
// brains (null = the hand-tuned default). Returns the winner + stats used both
// for fitness (who won, how fast) and for balance analysis (army composition).
export function runMatch({
  seed = 1,
  races = ['humans', 'orcs'],
  genomeA = null,
  genomeB = null,
  difficulty = 'normal',
  maxSeconds = 300,
  summarize = false,
} = {}) {
  const game = new Game(seed >>> 0, { races });
  const ai0 = new AIController(0, difficulty, (seed ^ 0x9e3779b9) >>> 0, genomeA);
  const ai1 = new AIController(1, difficulty, (seed ^ 0x85ebca6b) >>> 0, genomeB);

  const maxSteps = Math.round(maxSeconds / DT);
  let steps = 0;
  // In AI-vs-AI the armies clash mid-field and rarely reach a base, so the real
  // signal is who keeps winning engagements: sample each team's LIVING army
  // value (Σ unit cost) every ~1s and integrate it over the match.
  let armyVal0 = 0;
  let armyVal1 = 0;
  let samples = 0;
  // Optional narrative timeline: milestones (tier-ups, hero recruits, first
  // base damage) with their timestamp, plus who was ahead on army value.
  const events = [];
  const prevTier = [game.tier[0], game.tier[1]];
  const prevHeroes = [0, 0];
  const baseHit = [false, false];
  let leadSamples0 = 0;
  while (game.winner === null && steps < maxSteps) {
    ai0.update(game, DT);
    ai1.update(game, DT);
    game.update(DT);
    steps++;
    if (steps % 30 === 0) {
      let v0 = 0;
      let v1 = 0;
      for (const e of game.entities) {
        if (e.hp <= 0 || e.summon) continue;
        const c = (game.ustatOf(e).cost) || 0;
        if (e.team === 0) v0 += c; else v1 += c;
      }
      armyVal0 += v0;
      armyVal1 += v1;
      samples++;
      if (summarize) {
        const tsec = Math.round(steps * DT);
        if (v0 >= v1) leadSamples0++;
        for (const team of [0, 1]) {
          if (game.tier[team] > prevTier[team]) {
            prevTier[team] = game.tier[team];
            events.push({ t: tsec, team, kind: 'tier', tier: game.tier[team] });
          }
          const hc = game.heroTemplates(team).length;
          if (hc > prevHeroes[team]) {
            prevHeroes[team] = hc;
            events.push({ t: tsec, team, kind: 'hero', n: hc });
          }
          const main = game.mainOf(team);
          if (!baseHit[team] && main && main.hp < main.maxHp * 0.98) {
            baseHit[team] = true;
            events.push({ t: tsec, team, kind: 'basehit' });
          }
        }
      }
    }
  }
  if (summarize) events.push({ t: Math.round(steps * DT), kind: 'end', winner: game.winner });
  const totVal = armyVal0 + armyVal1;
  const armyAdv = totVal > 0 ? armyVal0 / totVal : 0.5; // 0..1, 0.5 = even

  const comp = (team) => {
    const m = {};
    for (const tpl of game.templates[team]) m[tpl.type] = (m[tpl.type] || 0) + 1;
    return m;
  };
  const baseFrac = (team) => {
    const b = game.mainOf(team);
    return b && b.maxHp > 0 ? Math.max(0, b.hp) / b.maxHp : 0;
  };

  return {
    winner: game.winner,          // 0 | 1 | null (timeout / draw)
    timedOut: game.winner === null,
    seconds: Math.round(steps * DT),
    waves: game.waveCount,
    races: [...races],
    comp: [comp(0), comp(1)],     // {unitType: count} per team's final formation
    tier: [game.tier[0], game.tier[1]],
    spent: [game.spent[0], game.spent[1]],
    baseFrac: [baseFrac(0), baseFrac(1)], // remaining base HP
    armyAdv: armyAdv,                     // team 0's share of living army value
    // narrative extras (only when summarize=true)
    events: summarize ? events : undefined,
    lead0: summarize && samples ? leadSamples0 / samples : undefined, // share of match team 0 led
  };
}

// Fitness of team 0 in [0,1]: a clean base kill = 1 / loss = 0. On a timeout the
// score is driven mainly by how much MORE of the enemy base you tore down than
// they tore down yours (decisive, breakthrough play) — with living-army value
// only a secondary tiebreak. Scoring a timeout mostly by raw army value made
// evolution mass cheap tier-1 units for a value lead and never try to break
// through; rewarding base damage pushes it toward armies that actually win.
export function scoreFor0(r) {
  if (r.winner === 0) return 1;
  if (r.winner === 1) return 0;
  const baseAdv = r.baseFrac[0] - r.baseFrac[1]; // -1..1: >0 = we hurt their base more
  const armyTilt = r.armyAdv - 0.5;              // -0.5..0.5
  return Math.max(0, Math.min(1, 0.5 + baseAdv * 0.42 + armyTilt * 0.3));
}
