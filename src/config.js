// All game tunables live here (except unit stats — see units.js).

// Bumped on every release; shown in the HUD and logged at boot so a stale
// cached deploy is instantly recognizable.
export const VERSION = 'v9.17';

// Playable races. Cosmetic for now (art sets uploaded via /admin, same
// unit stats); stat divergence can come later. The AI plays the other one.
export const RACES = ['humans', 'orcs'];

export const CONFIG = {
  // Simulation
  FIXED_DT: 1 / 30,

  // Battlefield (simulation units) — larger than the screen; an RTS
  // camera (edge-scroll / arrows / zoom / minimap) shows a window of it.
  FIELD_W: 3200,
  FIELD_H: 1440,

  // Each side's quadrant is a real base, split in two grid-aligned parts:
  //   [construction zone: main base + buildings][army zone: unit formation]
  // then the open field, the starting turret, and midfield.
  GRID: 40, // placement cell size (UI snapping; zones are multiples of it)

  // Cosmetic overrides set from the admin balance editor:
  SIZES: {},            // entity id -> visual scale multiplier (default 1)
  TEAM_TINT: 'enemy',   // sprite coloring: 'team' | 'enemy' | 'none'
  HEALTHBAR_ALWAYS: false, // show unit/building HP bars even at full health
  CONSTRUCTION_ZONE: [
    { x0: 60, x1: 420, y0: 80, y1: 1360 },    // team 0 (left)
    { x0: 2780, x1: 3140, y0: 80, y1: 1360 }, // team 1 (right)
  ],
  ARMY_ZONE: [
    { x0: 440, x1: 680, y0: 80, y1: 1360 },
    { x0: 2520, x1: 2760, y0: 80, y1: 1360 },
  ],

  // Main base: the win objective, back-center of the construction zone.
  // HP by tier; upgrading unlocks unit tiers and heals +1000.
  MAIN: {
    x: [140, 3060],
    y: 720,
    radius: 50,
    hp: [4000, 5000, 6000],
    idleSpeed: 2, // idle frame flips per second (higher = faster idle 1↔2)
    name: 'Base',
  },
  TIER_COSTS: { 2: 400, 3: 900 },
  TIER_MAX: 3,

  // Starting defensive turret (pre-placed, not buildable, dies for good)
  TURRET_X: [1180, 2020],
  TURRET: {
    hp: 700,
    radius: 24,
    range: 260,
    damage: 30,
    period: 0.8,
    dmgType: 'normal',
    projectileSpeed: 500,
    targetsAir: true,
    idleSpeed: 2, // idle frame flips per second
    name: 'Turret',
  },

  // Buildable structures (construction zone only, fixed once built).
  // Footprint is a rectangle of cw x ch grid cells; idleSpeed sets how fast
  // the uploaded idle 1↔2 frames alternate (flips per second).
  BUILDINGS: {
    wall: { cost: 40, hp: 450, cw: 1, ch: 1, cap: 24, idleSpeed: 2, name: 'Wall' },
    tower: {
      cost: 200, hp: 350, cw: 1, ch: 1, cap: 6, idleSpeed: 2, name: 'Tower',
      range: 200, damage: 18, period: 0.9, dmgType: 'normal',
      projectileSpeed: 480, targetsAir: true,
    },
    generator: { cost: 150, hp: 200, cw: 1, ch: 1, cap: 8, income: 8, idleSpeed: 2, name: 'Generator' }, // +8/tick = +4/s each
  },
  SELL_BUILDING_REFUND: 0.6,
  BUILD_GAP: 0, // min clearance between structure edges (0 = tile flush)

  // Economy
  START_MONEY: 300,
  INCOME_TICK: 2,   // seconds between income payments
  INCOME_BASE: 20,  // money per tick (= +10/s); generators add on top
  SELL_REFUND: 0.75, // units (templates) refund

  // Waves
  WAVE_INTERVAL: 20,
  MAX_TEMPLATES: 40, // per team
  SPAWN_JITTER: 4,
  TEMPLATE_MIN_DIST: 16, // no two templates on the same spot

  // Combat
  AGGRO_BONUS: 120,       // aggro range = attack range + this
  PROJECTILE_SPEED: 420,
  PROJECTILE_HIT_DIST: 12,

  // RTS camera (render-side only; the sim never sees it)
  CAMERA: {
    EDGE_PX: 28,       // pointer within this many px of the canvas edge scrolls
    EDGE_SPEED: 1100,  // world units per second
    KEY_SPEED: 1100,   // arrows / WASD
    ZOOM_MAX: 4,       // max zoom = fit-the-map zoom × this (close enough to enjoy the characters)
    ZOOM_STEP: 1.15,   // wheel notch multiplier
    START_ZOOM: 1.4,   // initial zoom = fit zoom × this (comfortable close-up)
  },

  // AI difficulty knobs
  DIFFICULTY: {
    easy:   { incomeMult: 0.8,  counterChance: 0.3 },
    normal: { incomeMult: 1.0,  counterChance: 0.6 },
    hard:   { incomeMult: 1.15, counterChance: 0.85 },
  },
};
