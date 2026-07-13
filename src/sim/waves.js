import { CONFIG } from '../config.js';
import { spawnUnit } from './entity.js';

// Every wave, each team's full placed template list respawns as live units.
export function spawnWave(game) {
  game.waveCount++;
  for (const team of [0, 1]) {
    for (const tpl of game.templates[team]) {
      const jx = (game.rng() * 2 - 1) * CONFIG.SPAWN_JITTER;
      const jy = (game.rng() * 2 - 1) * CONFIG.SPAWN_JITTER;
      const u = spawnUnit(game, team, tpl.type, tpl.x + jx, tpl.y + jy);
      // the hero respawns at its persisted level, with per-level HP growth baked
      // in (the damage bonus is applied live in effStats)
      if (tpl.hero) {
        const s = game.ustat(team, tpl.type);
        u.heroLevel = tpl.level || 1;
        u.maxHp += (u.heroLevel - 1) * (s.hpPerLevel || 0);
        u.hp = u.maxHp;
        game.syncHeroEntity(team); // learned abilities/ranks onto the fresh hero
      }
      tpl.spawned = true; // once spawned, selling only gives the partial refund
    }
  }
  game.events.push({ type: 'wave', n: game.waveCount });
}
