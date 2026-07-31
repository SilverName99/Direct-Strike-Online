import { CONFIG } from '../config.js';
import { spawnUnit } from './entity.js';

// Every wave, each PLAYER's full placed template list respawns as live units
// (owner = the player, team = their battlefield side; 1v1: identical).
export function spawnWave(game) {
  game.waveCount++;
  for (let player = 0; player < game.players.length; player++) {
    const side = game.sideOf(player);
    for (const tpl of game.templates[player]) {
      // Only ONE live hero of EACH type per PLAYER: while this hero is still
      // alive, its template skips the wave instead of stacking a copy. Other
      // hero types respawn independently.
      if (tpl.hero && game.heroEntityOf(player, tpl.type)) continue;
      const jx = (game.rng() * 2 - 1) * CONFIG.SPAWN_JITTER;
      const jy = (game.rng() * 2 - 1) * CONFIG.SPAWN_JITTER;
      const u = spawnUnit(game, side, tpl.type, tpl.x + jx, tpl.y + jy, player);
      // the hero respawns at its persisted level, with per-level HP growth baked
      // in (the damage bonus is applied live in effStats)
      if (tpl.hero) {
        const s = game.ustat(player, tpl.type);
        u.heroLevel = tpl.level || 1;
        u.maxHp += (u.heroLevel - 1) * (s.hpPerLevel || 0);
        u.hp = u.maxHp;
        u.manaMax = (s.mana || 0) + (u.heroLevel - 1) * (s.manaPerLevel || 0);
        u.mana = u.manaMax; // respawns with a full pool at its level
        game.syncHeroEntity(player, tpl.type); // learned abilities/ranks onto the fresh hero
      }
      tpl.spawned = true; // once spawned, selling only gives the partial refund
      // when this cell's unit left, so the parked ghost can dim and fade back
      // in (render-only use, but it lives here to stay identical on every client)
      tpl.spawnedAt = game.time;
    }
  }
  game.events.push({ type: 'wave', n: game.waveCount });
}
