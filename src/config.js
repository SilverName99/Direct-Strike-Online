// All game tunables live here (except unit stats — see units.js).

export const CONFIG = {
  // Simulation
  FIXED_DT: 1 / 30,

  // Battlefield (simulation units)
  FIELD_W: 1600,
  FIELD_H: 900,

  // Classic Direct Strike layout, mirrored per team:
  // [build zone][base]   [turret]   mid   [turret]   [base][build zone]
  BUILD_ZONE: [
    { x0: 30, x1: 340, y0: 40, y1: 860 },    // team 0 (left)
    { x0: 1260, x1: 1570, y0: 40, y1: 860 }, // team 1 (right)
  ],
  BASE_X: [380, 1220],
  TURRET_X: [590, 1010],

  // Bases
  BASE_HP: 3000,
  BASE_RADIUS: 46,

  // Turrets: strong, hit ground + air, permanently destroyed.
  TURRET: {
    hp: 700,
    radius: 24,
    range: 260,
    damage: 30,
    period: 0.8,
    dmgType: 'normal',
    projectileSpeed: 500,
    targetsAir: true,
  },

  // Economy
  START_MONEY: 250,
  INCOME_TICK: 2,          // seconds between income payments
  INCOME_BASE: 20,         // money per tick (= +10/s)
  INCOME_UPGRADE_BASE_COST: 150,
  INCOME_UPGRADE_COST_STEP: 100,
  INCOME_UPGRADE_BONUS: 8, // extra money per tick per level (= +4/s)
  INCOME_UPGRADE_MAX: 10,
  SELL_REFUND: 0.75,       // fraction of cost returned when selling a placed unit

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
