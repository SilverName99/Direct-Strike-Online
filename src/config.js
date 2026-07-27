// All game tunables live here (except unit stats — see units.js).

// Bumped on every release; shown in the HUD and logged at boot so a stale
// cached deploy is instantly recognizable.
export const VERSION = 'v16.2';

// Playable races. Cosmetic for now (art sets uploaded via /admin, same
// unit stats); stat divergence can come later. The AI plays the other one.
export const RACES = ['humans', 'orcs', 'undead'];

export const CONFIG = {
  // Simulation
  FIXED_DT: 1 / 30,

  // Battlefield (simulation units) — larger than the screen; an RTS
  // camera (edge-scroll / arrows / zoom / minimap) shows a window of it.
  FIELD_W: 4000,
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
  FOG_OF_WAR: false,    // classic fog: reveal around your units; enemy units hidden in the dark, terrain/buildings remembered dim
  CORPSE_RAISE_DELAY: 1.2, // seconds after a unit dies before its corpse becomes raisable (Rise Dead) — lets the death animation fully play out first
  // Undead skeleton cap (team-wide max living Necromancer skeletons). Starts at
  // SKEL_CAP_BASE; a repeatable base upgrade raises it by SKEL_CAP_STEP up to
  // SKEL_CAP_MAX; each purchase costs SKEL_CAP_COST + (bought)·SKEL_CAP_COST_STEP.
  SKEL_CAP_BASE: 3,
  SKEL_CAP_STEP: 1,
  SKEL_CAP_MAX: 12,
  SKEL_CAP_COST: 100,
  SKEL_CAP_COST_STEP: 60,
  BLIGHT_GROW_TIME: 4, // seconds the corruption pool takes to spread to full size after a building is placed
  BLIGHT_START_RADIUS: 40, // the pool appears at this radius, then grows to each building's blightRadius
  BLIGHT_TIER2_PCT: 60,  // at Tier 2, every building's blight radius grows by this % (0 = no change)
  BLIGHT_TIER3_PCT: 140, // at Tier 3, every building's blight radius grows by this % (over the base)
  BLIGHT_FADE_TIME: 3,   // seconds the pool takes to fade in from BLIGHT_START_OPACITY to 100% (0 = instant, full opacity)
  BLIGHT_START_OPACITY: 0, // % opacity the pool appears at (then fades to 100% over BLIGHT_FADE_TIME)
  BLIGHT_WOBBLE_MIN: 14, // fewest undulations (edge vertices) a corruption pool's outline can have
  BLIGHT_WOBBLE_MAX: 24, // most undulations — each pool picks a count in [min,max] from its own seed

  // ---- Team modes (2v2 / 3v3 / asymmetric) — "defense in depth" ------------
  TEAM_REFUND_PCT: 50,       // X% refunded to each investor when a zone collapses (buildings + parked army)
  TEAM_ALLY_PCT_ANCHOR: 20,  // % of your normal caps you may build inside an ALLY's anchor zone
  TEAM_ALLY_PCT_CENTER: 20,  // ... inside an ally's center zone
  TEAM_ALLY_PCT_VANGUARD: 20,// ... inside an ally's vanguard zone
  TEAM_FALLEN_PCT: 50,       // Y% allowance once YOUR zone fell (replaces the X% above; mines allowed too)
  TEAM_MAIN_REBUILD_COST: 400, // gold a fallen player pays to rebuild their main base at an ally's zone
  TEAM_MAIN_REBUILD_TIME: 30,  // seconds the rebuilt base takes to raise (construction site; 0 = instant)
  TEAM_ASYM_1V2: 50,         // % income bonus for the smaller side in a 1v2
  TEAM_ASYM_1V3: 100,        // ... in a 1v3
  TEAM_ASYM_2V3: 30,         // ... in a 2v3

  GOLD_ICON: '',        // custom HUD gold icon (data URL, set in admin); '' = ◆ glyph
  MENU_LOGO: '',        // main-menu logo image (data URL, set in admin); '' = text fallback
  MENU_BTN: '',         // main-menu button skin (ornate banner PNG, data URL); '' = plain buttons
  MENU_CARD: '',        // format cards skin (1v1/2v2/3v3, all three share it); '' = plain
  MENU_BACK: '',        // "Înapoi" back-button skin; '' = plain text button
  MENU_SLIDE_FRAME: '', // frame around the tutorial slide image (the slide box); '' = plain
  MENU_FS_BTN: '',      // fullscreen button skin (top-right corner + Options toggle); '' = ⛶ glyph
  MENU_SOUND_BTN: '',   // sound/volume button skin (bottom-right control); '' = 🔊 glyph
  MENU_PWF: '',         // "Play with friends" card skin (text baked into the art); '' = plain card
  MENU_PLAY: '',        // setup-screen PLAY button skin (natural image size); '' = gold button
  MENU_SETUP_FRAME: '', // frame around the race/difficulty picker on the setup screen; '' = none
  MENU_OPTIONS_FRAME: '', // frame around the Options controls; '' = none
  MENU_RACE_HUMANS: '', // frame skin for the Humans race pill; '' = plain pill
  MENU_RACE_ORCS: '',   // frame skin for the Orcs race pill; '' = plain pill
  MENU_RACE_UNDEAD: '', // frame skin for the Undead race pill; '' = plain pill
  MENU_BG: '',          // main-menu background image (data URL); '' = plain dark
  TUTORIALS: [],        // "How to play" slider: array of { img, text } slides (set in admin)
  LOADING_BGS: ['', '', ''], // up to 3 loading-screen backgrounds; one is picked at random each load
  LOADING_BG: '',       // legacy single loading bg (migrated into LOADING_BGS[0])
  MENU_MUSIC: '',       // legacy single main-menu track (migrated into MENU_MUSICS[0])
  MENU_MUSICS: [],      // main-menu music playlist (data URLs, loop each); prev/next arrows switch
  MENU_MUSIC_PREV: '',  // skin for the menu-music "previous track" arrow; '' = ‹ glyph
  MENU_MUSIC_NEXT: '',  // skin for the menu-music "next track" arrow; '' = › glyph
  MENU_MUSIC_VOL: 50,   // starting volume of the menu music (0-100); the player can change it live
  NET_URL: '',          // multiplayer server WebSocket URL; '' = auto (play.fangs-and-honor.com, or localhost in dev)
  LOADING_TIPS: [],     // custom loading-screen tips (strings); empty = built-in tips
  // How units behave when they try to pass one another (⚙ Balance):
  PUSH_MODE: 'mass',    // 'mass' = big units push small units; 'equal' = all friendly units push the same
  PUSH_CROSS_TEAM: false, // false = "Blue can't push Red" (a unit passes THROUGH enemy units)
  PUSH_FORCE: 2.5,      // how hard units push apart per tick (separation strength)
  GRID_MAJOR: 2,        // draw a grid line every N cells (the fine cell still snaps)
  // Layout (back -> front, toward the enemy):
  //   [army formation][construction: base + buildings][open field]
  // The army now sits BEHIND the base, so units march THROUGH their own
  // construction zone (they pass through friendly structures) to reach the
  // field. Enemy structures (walls) still block them.
  // Construction (base) zone: 9 × 20 cells, in FRONT of the army strip.
  CONSTRUCTION_ZONE: [
    { x0: 560, x1: 920, y0: 80, y1: 880 },    // team 0 (left)
    { x0: 3080, x1: 3440, y0: 80, y1: 880 },  // team 1 (right, +400 for the longer middle)
  ],
  // Army formation strip (12 × 18 cells) at the BACK of each side. 2 rows
  // shorter than the construction zone, kept vertically centered.
  ARMY_ZONE: [
    { x0: 100, x1: 500, y0: 80, y1: 880 },
    { x0: 3500, x1: 3900, y0: 80, y1: 880 },
  ],
  // Small forward construction pocket around each team's starting turret, so
  // you can build defenses out by the mid turret too (5 × 10 cells).
  MID_BUILD_ZONE: [
    { x0: 1220, x1: 1420, y0: 280, y1: 680 },
    { x0: 2580, x1: 2780, y0: 280, y1: 680 },
  ],

  // Main base: the win objective, back-center of the construction zone.
  // HP by tier; upgrading unlocks unit tiers and heals +1000.
  MAIN: {
    x: [640, 3360],
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
    // Seconds the base is "busy" upgrading before the new tier takes effect,
    // per tier step: [0] = tier 1→2, [1] = tier 2→3. Like a building's
    // buildTime but with no separate șantier frames — the base already shows
    // the NEXT tier's art (faded) with a construction bar. 0 = instant.
    // Resolved per race, editable per base in ⚙ stats.
    upgradeTime: [20, 20],
  },
  TIER_COSTS: { 2: 400, 3: 900 },
  TIER_MAX: 3,

  // Starting defensive turret (pre-placed, not buildable, dies for good)
  TURRET_X: [1320, 2680],
  TURRET: {
    hp: 700,
    radius: 26.4, // hitbox +10% (was 24)
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
    wall: { cost: 40, buildTime: 0, hp: 450, cw: 1, ch: 1, cap: 24, idleSpeed: 2, chainMax: 1, chainDelay: 3, regen: 0, name: 'Wall' },
    tower: {
      cost: 200, buildTime: 0, hp: 350, cw: 1, ch: 1, cap: 6, idleSpeed: 2, regen: 0, name: 'Tower',
      range: 200, damage: 18, period: 0.9, dmgType: 'normal',
      projectileSpeed: 480, targetsAir: true,
      // Towers scale with the OWNER's base tier (1..3). hp/damage are the tier-1
      // values; hp2/damage2 = tier 2, hp3/damage3 = tier 3 (art per tier too).
      hp2: 600, hp3: 950,
      damage2: 30, damage3: 48,
      period2: 0.9, period3: 0.9, // attack period per tier (falls back to tier 1)
      // projectiles fired per tier (default 1/2/3 — the classic multi-arrow
      // tower). Set all to 1 for a single-shot tower (e.g. a lone Orc archer).
      shots: 1, shots2: 2, shots3: 3,
      attackHold: 0.4, // seconds the "Attack 2" (fire) frame is held per shot
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
      cost: 150, buildTime: 0, hp: 200, cw: 1, ch: 1, cap: 8, income: 80, buildCd: 0, idleSpeed: 2, name: 'Generator',
      costStep: 0,       // each NEXT mine costs this much more than the last (0 = flat price)
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
    bldg1: { cost: 120, buildTime: 0, hp: 500, cw: 2, ch: 2, cap: 1, tier: 1, idleSpeed: 2, name: 'Clădire I' },
    bldg2: { cost: 160, buildTime: 0, hp: 550, cw: 2, ch: 2, cap: 1, tier: 1, idleSpeed: 2, name: 'Clădire II' },
    bldg3: { cost: 200, buildTime: 0, hp: 600, cw: 2, ch: 2, cap: 1, tier: 1, idleSpeed: 2, name: 'Clădire III' },
    // Farm: raises your FOOD cap so you can field more units. Destructible —
    // if destroyed you keep placed units but can't buy more until under cap.
    farm: { cost: 100, buildTime: 0, hp: 300, cw: 2, ch: 2, cap: 12, food: 10, idleSpeed: 2, name: 'Fermă' },
    // Hero Hall: recruit heroes here (up to 3, each gated by its own base tier).
    // Heroes come ONLY from this building — not the Main Base. Destructible;
    // lose it and you can't recruit more (placed heroes stay). One (cap 1).
    herohall: { cost: 150, buildTime: 0, hp: 600, cw: 2, ch: 2, cap: 1, tier: 1, idleSpeed: 2, name: 'Hero Hall' },
  },
  SELL_BUILDING_REFUND: 0.6,
  MOVE_REBUILD_TIME: 30, // seconds a moved building is inert while it rebuilds in the new spot
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

  // Food/supply cap: each placed unit costs `food`; farms raise the cap. You
  // can't place a unit if it would put you over the cap. This is the only army
  // size limit (no hard template cap).
  FOOD_CAP_BASE: 20,  // starting food capacity before any farm

  // Seconds into the match before HEROES can be bought (0 = from the start).
  // Applies to both the player and the AI; editable in ⚙ Balance.
  HERO_UNLOCK_TIME: 0,

  // Waves
  WAVE_INTERVAL: 20,
  FIRST_WAVE_INTERVAL: 20, // seconds until the very first wave (round 1 only)
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
