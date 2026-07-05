// All game tunables live here (except unit stats — see units.js).

// Bumped on every release; shown in the HUD and logged at boot so a stale
// cached deploy is instantly recognizable.
export const VERSION = 'v5.1';

export const CONFIG = {
  // Simulation
  FIXED_DT: 1 / 30,

  // Battlefield (simulation units) — larger than the screen; an RTS
  // camera (edge-scroll / arrows / zoom / minimap) shows a window of it.
  FIELD_W: 3200,
  FIELD_H: 1440,

  // Classic Direct Strike layout, mirrored per team:
  // [build zone][base]   [turret]   mid   [turret]   [base][build zone]
  BUILD_ZONE: [
    { x0: 60, x1: 680, y0: 64, y1: 1376 },    // team 0 (left)
    { x0: 2520, x1: 3140, y0: 64, y1: 1376 }, // team 1 (right)
  ],
  BASE_X: [760, 2440],
  TURRET_X: [1180, 2020],

  // RTS camera (render-side only; the sim never sees it)
  CAMERA: {
    EDGE_PX: 28,       // pointer within this many px of the canvas edge scrolls
    EDGE_SPEED: 1100,  // world units per second
    KEY_SPEED: 1100,   // arrows / WASD
    ZOOM_MAX: 4,       // max zoom = fit-the-map zoom × this (close enough to enjoy the characters)
    ZOOM_STEP: 1.15,   // wheel notch multiplier
    START_ZOOM: 1.4,   // initial zoom = fit zoom × this (comfortable close-up)
  },

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
