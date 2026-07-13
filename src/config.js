// All game tunables live here (except unit stats — see units.js).

// Bumped on every release; shown in the HUD and logged at boot so a stale
// cached deploy is instantly recognizable.
export const VERSION = 'v10.54';

// Playable races. Cosmetic for now (art sets uploaded via /admin, same
// unit stats); stat divergence can come later. The AI plays the other one.
export const RACES = ['humans', 'orcs'];

export const CONFIG = {
  // Simulation
  FIXED_DT: 1 / 30,

  // Battlefield (simulation units) — larger than the screen; an RTS
  // camera (edge-scroll / arrows / zoom / minimap) shows a window of it.
  FIELD_W: 3600,
  // Height hugs the play content (a 20-cell band + 2-cell margins): the
  // camera's fit-zoom fills the screen with map and the UI bar overlays it.
  FIELD_H: 960,

  // Each side's quadrant is a real base, split in two grid-aligned parts:
  //   [construction zone: main base + buildings][army zone: unit formation]
  // then the open field, the starting turret, and midfield.
  GRID: 40, // placement cell size (UI snapping; zones are multiples of it)

  // Middle-of-map terrain effect, one entry per uploaded strip variant (slots
  // 1-3). A random variant is picked (seeded) each match; units standing on
  // the central band get its debuff. kind: 'none' | 'moveslow' | 'atkslow';
  // amount = %, band = half-width in sim units of the affected zone, air =
  // also affects fliers (else ground-only).
  MIDDLES: [
    { kind: 'none', amount: 0, band: 200, air: false },
    { kind: 'none', amount: 0, band: 200, air: false },
    { kind: 'none', amount: 0, band: 200, air: false },
  ],
  // How many "empty" (no strip, no effect) entries join the random draw
  // alongside the uploaded variants. 0 = a middle is always shown; e.g. 2
  // uploaded + 1 empty = 1-in-3 chance of a plain middle.
  MIDDLE_EMPTY: 0,

  // Cosmetic overrides set from the admin balance editor:
  SIZES: {},            // entity id -> visual scale multiplier (default 1)
  TEAM_TINT: 'enemy',   // sprite coloring: 'team' | 'enemy' | 'none'
  HEALTHBAR_ALWAYS: false, // show unit/building HP bars even at full health
  GRID_MAJOR: 2,        // draw a grid line every N cells (the fine cell still snaps)
  // Construction (base) zone: 9 × 20 cells, same height as the army strip so
  // the whole base reads as one 20-cell-tall block.
  CONSTRUCTION_ZONE: [
    { x0: 60, x1: 420, y0: 80, y1: 880 },    // team 0 (left)
    { x0: 3180, x1: 3540, y0: 80, y1: 880 }, // team 1 (right)
  ],
  // Army formation strip: exactly 12 × 20 cells (of GRID px), centered
  // vertically; major grid lines land every GRID_MAJOR cells.
  ARMY_ZONE: [
    { x0: 440, x1: 920, y0: 80, y1: 880 },
    { x0: 2680, x1: 3160, y0: 80, y1: 880 },
  ],
  // Small forward construction pocket around each team's starting turret, so
  // you can build defenses out by the mid turret too (5 × 10 cells).
  MID_BUILD_ZONE: [
    { x0: 1220, x1: 1420, y0: 280, y1: 680 },
    { x0: 2180, x1: 2380, y0: 280, y1: 680 },
  ],

  // Main base: the win objective, back-center of the construction zone.
  // HP by tier; upgrading unlocks unit tiers and heals +1000.
  MAIN: {
    x: [200, 3400],
    y: 480,
    radius: 50,
    hp: [4000, 5000, 6000],
    idleSpeed: 2, // idle frame flips per second (higher = faster idle 1↔2)
    name: 'Base',
    // Optional base attack (damage 0 = the base doesn't shoot). Same shape as
    // the turret; set from ⚙ stats on the Base.
    damage: 0,
    range: 300,
    period: 1.5,
    dmgType: 'normal',
    projectileSpeed: 500,
    targetsAir: true,
  },
  TIER_COSTS: { 2: 400, 3: 900 },
  TIER_MAX: 3,

  // Starting defensive turret (pre-placed, not buildable, dies for good)
  TURRET_X: [1320, 2280],
  TURRET: {
    hp: 700,
    radius: 24,
    range: 260,
    damage: 30,
    period: 0.8,
    dmgType: 'normal',
    projectileSpeed: 500,
    targetsAir: true,
    regen: 0,   // HP regenerated per second (0 = none)
    bounty: 0,  // gold the ENEMY earns for destroying this turret (0 = none)
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
      // Towers scale with the OWNER's base tier (1..3). hp/damage are the tier-1
      // values; hp2/damage2 = tier 2, hp3/damage3 = tier 3 (art per tier too).
      hp2: 600, hp3: 950,
      damage2: 30, damage3: 48,
      // After this many seconds without firing, the soldiers come down and
      // light a campfire at the tower's base (purely cosmetic).
      campfireDelay: 60,
      // campfire-soldiers sprite scale per tier (1 = as big as the tower box)
      campSize: 0.8, campSize2: 0.8, campSize3: 0.8,
      campSpeed: 3,    // campfire-soldiers frame flips per second
    },
    // income = extra gold every 20s (= +4/s each); buildCd = seconds you must
    // wait after building one before you can build the next (0 = none)
    generator: {
      cost: 150, hp: 200, cw: 1, ch: 1, cap: 8, income: 80, buildCd: 0, idleSpeed: 2, name: 'Generator',
      // cosmetic gold-miners shuttling to the base (need uploaded worker art):
      workerSize: 1,     // visual scale (1 = 100%)
      workerSpeed: 100,  // world units / second
      workerCount: 2,    // how many shuttle per mine (0 = none)
      workerPause: 1.5,  // seconds a worker lingers (idle clip) at mine & at base
      workerAnimSpeed: 6, // walk-frame flips per second (1 <-> 2 while moving)
    },
    // Tech / unlock buildings: build one of each to unlock the units assigned to
    // it (admin: per-unit "Clădire"). A unit is buyable only when ITS building
    // is built AND the base is at the unit's tier. Destructible — lose it and
    // you lose access (already-placed units stay). One of each (cap 1).
    bldg1: { cost: 120, hp: 500, cw: 2, ch: 2, cap: 1, tier: 1, idleSpeed: 2, name: 'Clădire I' },
    bldg2: { cost: 160, hp: 550, cw: 2, ch: 2, cap: 1, tier: 1, idleSpeed: 2, name: 'Clădire II' },
    bldg3: { cost: 200, hp: 600, cw: 2, ch: 2, cap: 1, tier: 1, idleSpeed: 2, name: 'Clădire III' },
  },
  SELL_BUILDING_REFUND: 0.6,
  BUILD_GAP: 0, // min clearance between structure edges (0 = tile flush)

  // Economy — income amounts are expressed in GOLD PER 20 SECONDS (one wave
  // interval), because that's the natural balancing unit; payments still land
  // smoothly every INCOME_TICK seconds (scaled down accordingly).
  START_MONEY: 300,
  INCOME_TICK: 2,     // seconds between income payments (cadence only)
  INCOME_WINDOW: 20,  // seconds the income amounts below are expressed per
  INCOME_BASE: 200,   // starting gold every 20s (= +10/s); generators add on top
  MID_INCOME: 0,      // extra gold every 20s while you have units past midfield
  SELL_REFUND: 0.75, // units (templates) refund

  // Waves
  WAVE_INTERVAL: 20,
  FIRST_WAVE_INTERVAL: 20, // seconds until the very first wave (round 1 only)
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
    // (no BOTTOM_PAD / ZOOM_OUT: the camera never leaves the map — max
    // zoom-out is exactly the fit, and there is no extra space below)
  },

  // AI difficulty knobs
  DIFFICULTY: {
    easy:   { incomeMult: 0.8,  counterChance: 0.3 },
    normal: { incomeMult: 1.0,  counterChance: 0.6 },
    hard:   { incomeMult: 1.15, counterChance: 0.85 },
  },
};
