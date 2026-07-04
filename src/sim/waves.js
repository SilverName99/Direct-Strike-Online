import { CONFIG } from '../config.js';
import { spawnUnit } from './entity.js';

// Every wave, each team's full placed template list respawns as live units.
export function spawnWave(game) {
  game.waveCount++;
  for (const team of [0, 1]) {
    for (const tpl of game.templates[team]) {
      const jx = (game.rng() * 2 - 1) * CONFIG.SPAWN_JITTER;
      const jy = (game.rng() * 2 - 1) * CONFIG.SPAWN_JITTER;
      spawnUnit(game, team, tpl.type, tpl.x + jx, tpl.y + jy);
    }
  }
  game.events.push({ type: 'wave', n: game.waveCount });
}
