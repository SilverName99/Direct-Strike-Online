// All game tunables live here (except unit stats — see units.js).

export const CONFIG = {
  // Simulation
  FIXED_DT: 1 / 30,

  // Battlefield (simulation units)
  FIELD_W: 1600,
  FIELD_H: 900,
  ZONE_LEFT_MAX: 640,   // left team may place in x ∈ [MARGIN, 640]
  ZONE_RIGHT_MIN: 960,  // right team may place in x ∈ [960, FIELD_W - MARGIN]
  PLACE_MARGIN: 24,     // keep placements off the very edge

  // Bases
  BASE_HP: 3000,
  BASE_RADIUS: 55,
  BASE_X_LEFT: 60,
  BASE_X_RIGHT: 1540,

  // Economy
  START_MONEY: 250,
  INCOME_TICK: 2,          // seconds between income payments
  INCOME_BASE: 20,         // money per tick (= +10/s)
  INCOME_UPGRADE_BASE_COST: 150,
  INCOME_UPGRADE_COST_STEP: 100,
  INCOME_UPGRADE_BONUS: 8, // extra money per tick per level (= +4/s)
  INCOME_UPGRADE_MAX: 10,

  // Waves
  WAVE_INTERVAL: 20,
  MAX_TEMPLATES: 40, // per team
  SPAWN_JITTER: 4,

  // Combat
  AGGRO_BONUS: 120,       // aggro range = attack range + this
  PROJECTILE_SPEED: 420,
  PROJECTILE_HIT_DIST: 12,

  // AI difficulty knobs
  DIFFICULTY: {
    easy:   { incomeMult: 0.8,  counterChance: 0.3 },
    normal: { incomeMult: 1.0,  counterChance: 0.6 },
    hard:   { incomeMult: 1.15, counterChance: 0.85 },
  },
};
