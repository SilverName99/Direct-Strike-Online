// Balance data + apply/save helpers.
//
// UNIT stats are PER-RACE: each race has its own resolved unit table (stats,
// name, visual size), so tuning the Humans grunt does not touch the Orcs
// grunt. Buildings, the starting turret, main-base HP, tier costs, the
// general rules and the team-tint mode are GLOBAL (shared by both races).
//
// The admin editors mutate these in place and call saveBalance(), which
// publishes to assets/balance.json; the game applies it at boot via
// loadBalance(). The sim reads per-team stats through Game.ustat().

import { CONFIG, RACES } from '../config.js';
import { UNITS } from '../units.js';
import { RACE_UNITS } from '../race-units.js';
import { ABILITIES, ABILITY_IDS, MAX_ABILITIES } from '../abilities.js';
import { UPGRADES, UPGRADE_IDS } from '../upgrades.js';

// -------- editable field whitelists (nothing else is applied) --------
export const UNIT_NUM_FIELDS = [
  ['cost', 'Cost'],
  ['tier', 'Tier (1-3)'],
  ['hp', 'HP'],
  ['damage', 'Damage'],
  ['period', 'Attack period (s)'],
  ['range', 'Range'],
  ['speed', 'Speed'],
  // splash is a toggle (Splash checkbox), projectile speed lives in "Ranged"
];
export const UNIT_SELECT_FIELDS = {
  armor: ['light', 'armored'],
  dmgType: ['normal', 'piercing', 'explosive'],
};
export const BUILDING_FIELDS = {
  wall: [['cost', 'Cost'], ['buildTime', 'Timp construcție (s)'], ['hp', 'HP'], ['cap', 'Max pe teren'], ['chainMax', 'Stoc max wall-uri (0/1 = oprit)'], ['chainDelay', 'Secunde pentru +1 în stoc']],
  tower: [
    ['cost', 'Cost'], ['buildTime', 'Timp construcție (s)'], ['cap', 'Max buildable'], ['range', 'Range'],
    ['hp', 'HP Tier 1'], ['hp2', 'HP Tier 2'], ['hp3', 'HP Tier 3'],
    ['damage', 'Damage Tier 1'], ['damage2', 'Damage Tier 2'], ['damage3', 'Damage Tier 3'],
    ['period', 'Attack period Tier 1 (s)'], ['period2', 'Attack period Tier 2 (s)'], ['period3', 'Attack period Tier 3 (s)'],
    ['shots', 'Proiectile Tier 1'], ['shots2', 'Proiectile Tier 2'], ['shots3', 'Proiectile Tier 3'],
    ['projectileSpeed', 'Viteză proiectil'], ['attackHold', 'Durată frame Attack 2 (s)'],
    ['campfireDelay', 'Secunde inactiv → foc de tabără'],
  ],
  generator: [
    // no buildTime: mines rise instantly on their predefined plots
    ['cost', 'Cost'], ['costStep', 'Scumpire per mină (+gold la fiecare)'], ['hp', 'HP'], ['cap', 'Max buildable (nr. de locuri de mină)'],
    ['income', 'Extra gold every 20 seconds'],
    ['buildCd', 'Cooldown construire (s)'],
  ],
  bldg1: [['cost', 'Cost'], ['buildTime', 'Timp construcție (s)'], ['hp', 'HP'], ['tier', 'Tier minim (1-3)']],
  bldg2: [['cost', 'Cost'], ['buildTime', 'Timp construcție (s)'], ['hp', 'HP'], ['tier', 'Tier minim (1-3)']],
  bldg3: [['cost', 'Cost'], ['buildTime', 'Timp construcție (s)'], ['hp', 'HP'], ['tier', 'Tier minim (1-3)']],
  farm: [['cost', 'Cost'], ['buildTime', 'Timp construcție (s)'], ['hp', 'HP'], ['cap', 'Max buildable'], ['food', 'Food adăugat']],
};
// The 3 tech/unlock buildings (build one of each to unlock its assigned units).
export const TECH_BUILDINGS = ['bldg1', 'bldg2', 'bldg3'];
export const GENERAL_FIELDS = [
  ['START_MONEY', 'Starting money'],
  ['INCOME_BASE', 'Starting gold every 20 seconds'],
  ['MID_INCOME', 'Extra gold every 20s past middle'],
  ['FIRST_WAVE_INTERVAL', 'Seconds until first wave (round 1)'],
  ['WAVE_INTERVAL', 'Seconds between waves'],
  ['FOOD_CAP_BASE', 'Food de bază (fără ferme)'],
  ['HERO_UNLOCK_TIME', 'Secunde până eroii pot fi cumpărați (0 = de la start)'],
  ['SELL_REFUND', 'Unit sell refund (0-1)'],
  ['SELL_BUILDING_REFUND', 'Building sell refund (0-1)'],
];
export const TURRET_FIELDS = [
  ['hp', 'HP'], ['range', 'Range'], ['damage', 'Damage'], ['period', 'Attack period (s)'],
  ['regen', 'Regen viață (HP/s)'], ['bounty', 'Gold pentru inamic la distrugere'],
];
export const TINT_MODES = ['team', 'enemy', 'none'];
export const MIDDLE_KINDS = ['none', 'moveslow', 'atkslow', 'manaregen'];

// Resolved middle-terrain effect for a strip variant (slot index 0-2), or null.
export function middleConfig(i) {
  return (CONFIG.MIDDLES && CONFIG.MIDDLES[i]) || null;
}
export const FOOTPRINT_BUILDINGS = ['wall', 'tower', 'generator', 'bldg1', 'bldg2', 'bldg3', 'farm'];
export const BUILDING_SIZE_ENTS = ['main', 'turret', 'tower', 'generator', 'wall', 'bldg1', 'bldg2', 'bldg3', 'farm'];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : undefined);
const cleanName = (v) => String(v).replace(/[<>]/g, '').trim().slice(0, 20);
// Tooltip descriptions are longer free text (edited in admin, shown on hover).
const cleanDesc = (v) => String(v).replace(/[<>]/g, '').trim().slice(0, 300);

export const BUILDING_ENTS = ['main', 'turret', 'tower', 'generator', 'wall', 'bldg1', 'bldg2', 'bldg3', 'farm'];

// ------------ per-race resolved unit + building tables ------------
// Full clone of the base entities (so the sim can read every field) plus a
// `size` visual multiplier and `name`, one table per race. Units AND
// buildings are per-race: tuning the Humans tower does not touch the Orcs
// tower.
const resolvedUnits = {};
const resolvedBuildings = {};

// Shop display order for units (global — both races share the roster). The
// admin reorders these PER RACE and the game's shop iterates the player race's
// order (Humans and Orcs reorder independently).
const DEFAULT_UNIT_ORDER = Object.keys(UNITS);
const unitOrder = {}; // race -> [id,...]
for (const r of RACES) unitOrder[r] = [...DEFAULT_UNIT_ORDER];

// Sanitize an order: keep only known ids (no dups), then append any missing
// ones so a newly added unit always still shows up.
function sanitizeOrder(arr) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(arr)) {
    for (const id of arr) if (UNITS[id] && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  for (const id of DEFAULT_UNIT_ORDER) if (!seen.has(id)) out.push(id);
  return out;
}
export function resolvedUnitOrder(race) {
  // heroes are bought from the Base, never listed in the normal shop / tech
  // building cards / AI pools that consume this order
  return [...(unitOrder[race] || unitOrder[RACES[0]])]
    .filter((id) => !(resolvedUnits[race] && resolvedUnits[race][id] && resolvedUnits[race][id].isHero));
}
export function setUnitOrder(race, arr) {
  if (RACES.includes(race)) unitOrder[race] = sanitizeOrder(arr);
}

// The hero unit id for a race (the one flagged isHero), or null. One per race.
export function resolvedHeroId(race) {
  const t = resolvedUnits[race] || resolvedUnits[RACES[0]];
  for (const id of Object.keys(t)) if (t[id] && t[id].isHero) return id;
  return null;
}

// The hero's 4 assigned ability slots for a race: 3 skills + 1 ultimate.
// Each entry: { id, ult }. Unassigned slots have id ''.
export function heroAbilitySlots(race) {
  const id = resolvedHeroId(race);
  const h = id ? statsUnit(race, id) : null;
  const skills = (h && h.heroAbilities) || ['', '', ''];
  const ult = (h && h.heroUltimate) || '';
  return [
    { id: skills[0] || '', ult: false },
    { id: skills[1] || '', ult: false },
    { id: skills[2] || '', ult: false },
    { id: ult, ult: true },
  ];
}

// Per-race background-music volume (0-100). The track itself is a file upload
// (assets/units/<race>/music.*, via the sprite admin); only the volume lives
// in the balance.
const DEFAULT_MUSIC_VOL = 60;
const musicVol = {};
for (const r of RACES) musicVol[r] = DEFAULT_MUSIC_VOL;
export function musicVolumeOf(race) {
  const v = musicVol[race];
  return typeof v === 'number' && isFinite(v) ? v : DEFAULT_MUSIC_VOL;
}
export function setMusicVolume(race, v) {
  if (RACES.includes(race) && isFinite(Number(v))) musicVol[race] = clamp(Number(v), 0, 100);
}

// Per-race hero default kit (3 skills + ultimate). Heroes are per-race and
// meant to differ; each race's hero starts from its own kit (empty = build it
// yourself in admin). Kept in sync with admin/index.php HERO_DEFAULT_KITS.
const HERO_DEFAULT_KITS = {
  orcs: { skills: ['warstomp', 'cleave', 'charge'], ult: 'bloodlust' },
  humans: { skills: ['holylight', 'divineshield', 'devotionaura'], ult: 'holynova' },
};

function baseUnits(race) {
  const t = {};
  // size = visual scale, projSize = projectile scale (both 1 = 100%);
  // caster + abilities come only from the admin config (empty by default);
  // mana/manaRegen only matter while caster is on
  for (const [id, u] of Object.entries(UNITS)) {
    const ps = u.projectileSpeed || CONFIG.PROJECTILE_SPEED;
    t[id] = {
      ...u, size: 1, projSize: 1,
      cw: 1, ch: 1,        // footprint in grid cells (drives the unit's physical size)
      animSpeed: 5,        // idle/walk frame flips per second (attack anim follows the Attack period)
      // Blank default: every special behavior is OFF; build any unit up from a
      // clean slate. Numeric stats (hp/damage/range/…) still come from units.js.
      ranged: false, projectile: false,
      heal: false,         // healer behavior is opt-in (admin toggle), like every other special
      building: '',        // which tech building unlocks this unit ('' = none/always available)
      slot: -1,            // fixed cell (0-8) on its building's units page (-1 = auto/sequential)
      buildingDamage: 0,   // special damage vs structures (0 = use the normal damage); always applies
      isAir: false, targetsAir: false,
      targetsGround: true, // can attack ground units (default on; turn off for air-only)
      splash: 0,
      projSpeed: ps, projectileSpeed: ps,
      bounce: false, bouncePower: 50, bounceRadius: 80, bounceMax: 3,
      dash: false, dashDamage: 30, dashSpeed: 400, dashRange: 250, dashCd: 3,
      caster: false, autoAttackBetween: false, abilities: [], mana: 100, manaRegen: 2,
      xp: 1,               // XP granted to the enemy hero when this unit dies
      food: 1,             // food/supply this unit consumes when placed
    };
    // the hero carries its own leveling config (thresholds + per-level growth)
    // plus its 3 skill abilities + 1 ultimate (assigned in admin, ranked in-game)
    if (u.isHero) {
      t[id].levelXp = [...DEFAULT_HERO_XP]; // XP needed to reach levels 2..10
      t[id].hpPerLevel = 40;
      t[id].dmgPerLevel = 4;
      t[id].manaPerLevel = 10;      // max-mana growth per level
      t[id].manaRegenPerLevel = 0.2; // mana-regen growth per level (mana/s)
      // per-race default kit (editable per race in admin)
      const kit = HERO_DEFAULT_KITS[race] || { skills: ['', '', ''], ult: '' };
      t[id].heroAbilities = [...kit.skills];
      t[id].heroUltimate = kit.ult;
    }
    // per-race roster: bake this race's distinct name + stats + role over the
    // shared base, so Orc and Human are different units even with no balance.json
    const ov = RACE_UNITS[race] && RACE_UNITS[race][id];
    if (ov) {
      Object.assign(t[id], ov);
      if ('abilities' in ov) t[id].abilities = [...ov.abilities];
      t[id].projectile = !!t[id].ranged;                       // derived flag
      t[id].projectileSpeed = t[id].projSpeed;                 // keep both in sync
    }
  }
  return t;
}

// Default XP required to reach each of levels 2..10 (9 thresholds). Editable
// per race in the hero's ⚙ stats.
const DEFAULT_HERO_XP = [10, 15, 20, 25, 30, 40, 50, 65, 80];
function baseBuildings() {
  return {
    main: {
      hp: [...CONFIG.MAIN.hp], radius: CONFIG.MAIN.radius, idleSpeed: CONFIG.MAIN.idleSpeed, name: CONFIG.MAIN.name,
      damage: CONFIG.MAIN.damage, range: CONFIG.MAIN.range, period: CONFIG.MAIN.period,
      dmgType: CONFIG.MAIN.dmgType, projectileSpeed: CONFIG.MAIN.projectileSpeed, targetsAir: CONFIG.MAIN.targetsAir,
      size: 1, projSize: 1,
    },
    turret: { ...CONFIG.TURRET, size: 1, projSize: 1 },
    wall: { ...CONFIG.BUILDINGS.wall, size: 1, projSize: 1, slot: -1 },
    tower: { ...CONFIG.BUILDINGS.tower, size: 1, projSize: 1, slot: -1 },
    generator: { ...CONFIG.BUILDINGS.generator, size: 1, projSize: 1, slot: -1 },
    bldg1: { ...CONFIG.BUILDINGS.bldg1, size: 1, projSize: 1, slot: -1 },
    bldg2: { ...CONFIG.BUILDINGS.bldg2, size: 1, projSize: 1, slot: -1 },
    bldg3: { ...CONFIG.BUILDINGS.bldg3, size: 1, projSize: 1, slot: -1 },
    farm: { ...CONFIG.BUILDINGS.farm, size: 1, projSize: 1, slot: -1 },
  };
}
// Abilities are GLOBAL (one balance shared by both races); which units carry
// them is stored per-race on the unit (caster + abilities list).
const resolvedAbilities = {};
function baseAbilities() {
  const t = {};
  for (const [id, ab] of Object.entries(ABILITIES)) t[id] = { ...ab, params: { ...ab.params } };
  return t;
}

// Upgrades are GLOBAL too (bought in-game from the base); which unit each one
// transforms is stored on the upgrade (`unit`), balanced from the admin editor.
const resolvedUpgrades = {};
function baseUpgrades() {
  const t = {};
  for (const [id, up] of Object.entries(UPGRADES)) t[id] = { ...up, slot: -1, params: { ...up.params } };
  return t;
}

function rebuildResolved() {
  for (const r of RACES) { resolvedUnits[r] = baseUnits(r); resolvedBuildings[r] = baseBuildings(); }
  Object.assign(resolvedAbilities, baseAbilities());
  Object.assign(resolvedUpgrades, baseUpgrades());
}
rebuildResolved();

export function resolvedAbility(id) {
  return resolvedAbilities[id] || null;
}
export function resolvedUpgrade(id) {
  return resolvedUpgrades[id] || null;
}

export function statsUnit(race, id) {
  return (resolvedUnits[race] || resolvedUnits[RACES[0]])[id];
}
export function unitSizeOf(race, id) {
  const u = statsUnit(race, id);
  return (u && u.size) || 1;
}
export function statsBuilding(race, kind) {
  return (resolvedBuildings[race] || resolvedBuildings[RACES[0]])[kind];
}
export function buildingSizeOf(race, kind) {
  const b = statsBuilding(race, kind);
  return (b && b.size) || 1;
}
export function buildingNameOf(race, kind) {
  const b = statsBuilding(race, kind);
  return (b && b.name) || kind;
}

// ---------------------------- snapshot ----------------------------
// Scalar building stat fields that may exist on a resolved building.
const BUILDING_SCALARS = ['cost', 'costStep', 'buildTime', 'slot', 'hp', 'cap', 'tier', 'food', 'chainMax', 'chainDelay', 'range', 'damage', 'period', 'income', 'projectileSpeed', 'regen', 'bounty', 'buildCd', 'workerSize', 'workerSpeed', 'workerCount', 'workerPause', 'workerAnimSpeed', 'hp2', 'hp3', 'damage2', 'damage3', 'period2', 'period3', 'shots', 'shots2', 'shots3', 'attackHold', 'campfireDelay', 'campSize', 'campSize2', 'campSize3', 'campSpeed'];

// Effective tower HP / damage for a base tier (1..3). Towers scale with the
// owner's Main Base tier: tier 1 = hp/damage, tier 2 = hp2/damage2, tier 3 =
// hp3/damage3 (each falling back to the lower tier if unset).
export function towerStatForTier(b, tier) {
  const t = tier < 1 ? 1 : tier > 3 ? 3 : tier;
  const hp = t >= 3 ? (b.hp3 ?? b.hp2 ?? b.hp) : t === 2 ? (b.hp2 ?? b.hp) : b.hp;
  const damage = t >= 3 ? (b.damage3 ?? b.damage2 ?? b.damage) : t === 2 ? (b.damage2 ?? b.damage) : b.damage;
  const period = t >= 3 ? (b.period3 ?? b.period2 ?? b.period) : t === 2 ? (b.period2 ?? b.period) : b.period;
  const shots = t >= 3 ? (b.shots3 ?? b.shots2 ?? b.shots) : t === 2 ? (b.shots2 ?? b.shots) : b.shots;
  return { hp, damage, period, shots };
}

function raceUnitsSnapshot(race) {
  const out = {};
  for (const [id, u] of Object.entries(resolvedUnits[race])) {
    out[id] = {
      name: u.name, size: u.size, projSize: u.projSize, cw: u.cw, ch: u.ch, animSpeed: u.animSpeed,
      ranged: !!u.ranged, projSpeed: u.projSpeed, splash: u.splash,
      heal: !!u.heal, buildingDamage: u.buildingDamage,
      isAir: !!u.isAir, targetsAir: !!u.targetsAir, targetsGround: u.targetsGround !== false,
      bounce: !!u.bounce, bouncePower: u.bouncePower, bounceRadius: u.bounceRadius, bounceMax: u.bounceMax,
      dash: !!u.dash, dashDamage: u.dashDamage, dashSpeed: u.dashSpeed, dashRange: u.dashRange, dashCd: u.dashCd,
      caster: !!u.caster, autoAttackBetween: !!u.autoAttackBetween, abilities: [...(u.abilities || [])],
      mana: u.mana, manaRegen: u.manaRegen, building: u.building || '',
      slot: Number.isInteger(u.slot) ? u.slot : -1,
      xp: u.xp, food: u.food,
      tip: u.tip || '', // hover description (admin-editable)
    };
    if (u.isHero) {
      out[id].levelXp = [...(u.levelXp || [])];
      out[id].hpPerLevel = u.hpPerLevel;
      out[id].dmgPerLevel = u.dmgPerLevel;
      out[id].manaPerLevel = u.manaPerLevel;
      out[id].manaRegenPerLevel = u.manaRegenPerLevel;
      out[id].heroAbilities = [...(u.heroAbilities || ['', '', ''])];
      out[id].heroUltimate = u.heroUltimate || '';
    }
    for (const [f] of UNIT_NUM_FIELDS) if (u[f] !== undefined) out[id][f] = u[f];
    for (const f of Object.keys(UNIT_SELECT_FIELDS)) if (u[f] !== undefined) out[id][f] = u[f];
  }
  return out;
}

function raceBuildingsSnapshot(race) {
  const out = {};
  for (const kind of BUILDING_ENTS) {
    const b = resolvedBuildings[race][kind];
    const o = { name: b.name, size: b.size, idleSpeed: b.idleSpeed, projSize: b.projSize, tip: b.tip || '' };
    if (kind === 'main') {
      o.hp = [...b.hp];
      for (const f of ['damage', 'range', 'period', 'projectileSpeed']) if (b[f] !== undefined) o[f] = b[f];
      o.dmgType = b.dmgType; o.targetsAir = !!b.targetsAir;
    } else for (const f of BUILDING_SCALARS) if (b[f] !== undefined) o[f] = b[f];
    if (b.cw !== undefined) { o.cw = b.cw; o.ch = b.ch; }
    out[kind] = o;
  }
  return out;
}

function snapshot() {
  const general = {};
  for (const [f] of GENERAL_FIELDS) general[f] = CONFIG[f];
  const races = {};
  for (const r of RACES) races[r] = { units: raceUnitsSnapshot(r), buildings: raceBuildingsSnapshot(r) };
  const abilities = {};
  for (const [id, ab] of Object.entries(resolvedAbilities)) abilities[id] = { ...ab.params, desc: ab.desc || '' };
  const upgrades = {};
  for (const [id, up] of Object.entries(resolvedUpgrades)) upgrades[id] = { race: up.race || '', unit: up.unit || '', slot: Number.isInteger(up.slot) ? up.slot : -1, desc: up.desc || '', params: { ...up.params } };
  return {
    general,
    middles: CONFIG.MIDDLES.map((m) => ({ ...m })),
    middleEmpty: CONFIG.MIDDLE_EMPTY,
    tint: CONFIG.TEAM_TINT,
    healthbarAlways: CONFIG.HEALTHBAR_ALWAYS,
    goldIcon: CONFIG.GOLD_ICON || '',
    menuLogo: CONFIG.MENU_LOGO || '',
    menuBtn: CONFIG.MENU_BTN || '',
    menuCard: CONFIG.MENU_CARD || '',
    menuBack: CONFIG.MENU_BACK || '',
    menuSlideFrame: CONFIG.MENU_SLIDE_FRAME || '',
    menuFsBtn: CONFIG.MENU_FS_BTN || '',
    menuSoundBtn: CONFIG.MENU_SOUND_BTN || '',
    menuPwf: CONFIG.MENU_PWF || '',
    menuPlay: CONFIG.MENU_PLAY || '',
    menuSetupFrame: CONFIG.MENU_SETUP_FRAME || '',
    menuOptionsFrame: CONFIG.MENU_OPTIONS_FRAME || '',
    menuBg: CONFIG.MENU_BG || '',
    tutorials: (Array.isArray(CONFIG.TUTORIALS) ? CONFIG.TUTORIALS : []).map((t) => ({ img: t.img || '', text: t.text || '' })),
    loadingBgs: (Array.isArray(CONFIG.LOADING_BGS) ? CONFIG.LOADING_BGS : []).slice(0, 3).map((s) => s || ''),
    menuMusic: CONFIG.MENU_MUSIC || '',
    loadingTips: Array.isArray(CONFIG.LOADING_TIPS) ? [...CONFIG.LOADING_TIPS] : [],
    pushMode: CONFIG.PUSH_MODE,
    pushCrossTeam: CONFIG.PUSH_CROSS_TEAM,
    pushForce: CONFIG.PUSH_FORCE,
    tierCosts: { 2: CONFIG.TIER_COSTS[2], 3: CONFIG.TIER_COSTS[3] },
    unitOrder: Object.fromEntries(RACES.map((r) => [r, [...unitOrder[r]]])),
    music: Object.fromEntries(RACES.map((r) => [r, musicVol[r]])),
    abilities,
    upgrades,
    races,
    aiGenome: aiGenome ? { ...aiGenome } : null,
  };
}

// The evolved AI brain (from the trainer). null = the hand-tuned default AI.
let aiGenome = null;
export function resolvedAIGenome() { return aiGenome ? { ...aiGenome } : null; }
export function setAIGenome(g) { aiGenome = g && typeof g === 'object' ? { ...g } : null; }

const DEFAULTS = snapshot();

// ----------------------------- apply -----------------------------
export function applyBalance(data) {
  if (!data || typeof data !== 'object') return;
  rebuildResolved(); // reset to base, then layer overrides on top
  for (const r of RACES) unitOrder[r] = [...DEFAULT_UNIT_ORDER];
  if (data.unitOrder) {
    if (Array.isArray(data.unitOrder)) for (const r of RACES) setUnitOrder(r, data.unitOrder); // legacy (global)
    else for (const r of RACES) if (data.unitOrder[r]) setUnitOrder(r, data.unitOrder[r]);
  }
  for (const r of RACES) musicVol[r] = DEFAULT_MUSIC_VOL;
  if (data.music && typeof data.music === 'object') {
    for (const r of RACES) if (num(data.music[r]) !== undefined) setMusicVolume(r, data.music[r]);
  }
  aiGenome = (data.aiGenome && typeof data.aiGenome === 'object') ? { ...data.aiGenome } : null;

  // ---- global rules (truly shared: economy, waves, tint, tier costs) ----
  for (const [f] of GENERAL_FIELDS) {
    if (data.general && num(data.general[f]) !== undefined) CONFIG[f] = data.general[f];
  }
  if (data.tierCosts && typeof data.tierCosts === 'object') {
    for (const t of [2, 3]) if (num(data.tierCosts[t]) !== undefined) CONFIG.TIER_COSTS[t] = data.tierCosts[t];
  }
  if (TINT_MODES.includes(data.tint)) CONFIG.TEAM_TINT = data.tint;
  if (typeof data.healthbarAlways === 'boolean') CONFIG.HEALTHBAR_ALWAYS = data.healthbarAlways;
  CONFIG.GOLD_ICON = typeof data.goldIcon === 'string' ? data.goldIcon : '';
  CONFIG.MENU_LOGO = typeof data.menuLogo === 'string' ? data.menuLogo : '';
  CONFIG.MENU_BTN = typeof data.menuBtn === 'string' ? data.menuBtn : '';
  CONFIG.MENU_CARD = typeof data.menuCard === 'string' ? data.menuCard : '';
  CONFIG.MENU_BACK = typeof data.menuBack === 'string' ? data.menuBack : '';
  CONFIG.MENU_SLIDE_FRAME = typeof data.menuSlideFrame === 'string' ? data.menuSlideFrame : '';
  CONFIG.MENU_FS_BTN = typeof data.menuFsBtn === 'string' ? data.menuFsBtn : '';
  CONFIG.MENU_SOUND_BTN = typeof data.menuSoundBtn === 'string' ? data.menuSoundBtn : '';
  CONFIG.MENU_PWF = typeof data.menuPwf === 'string' ? data.menuPwf : '';
  CONFIG.MENU_PLAY = typeof data.menuPlay === 'string' ? data.menuPlay : '';
  CONFIG.MENU_SETUP_FRAME = typeof data.menuSetupFrame === 'string' ? data.menuSetupFrame : '';
  CONFIG.MENU_OPTIONS_FRAME = typeof data.menuOptionsFrame === 'string' ? data.menuOptionsFrame : '';
  CONFIG.TUTORIALS = Array.isArray(data.tutorials)
    ? data.tutorials
        .filter((t) => t && typeof t === 'object')
        .map((t) => ({ img: typeof t.img === 'string' ? t.img : '', text: typeof t.text === 'string' ? t.text.slice(0, 600) : '' }))
        .filter((t) => t.img || t.text)
        .slice(0, 20)
    : [];
  CONFIG.MENU_BG = typeof data.menuBg === 'string' ? data.menuBg : '';
  // 3 loading-screen variants; migrate an old single loadingBg into slot 0
  if (Array.isArray(data.loadingBgs)) {
    CONFIG.LOADING_BGS = [0, 1, 2].map((i) => (typeof data.loadingBgs[i] === 'string' ? data.loadingBgs[i] : ''));
  } else if (typeof data.loadingBg === 'string' && data.loadingBg) {
    CONFIG.LOADING_BGS = [data.loadingBg, '', ''];
  } else {
    CONFIG.LOADING_BGS = ['', '', ''];
  }
  CONFIG.LOADING_BG = typeof data.loadingBg === 'string' ? data.loadingBg : '';
  CONFIG.MENU_MUSIC = typeof data.menuMusic === 'string' ? data.menuMusic : '';
  CONFIG.LOADING_TIPS = Array.isArray(data.loadingTips)
    ? data.loadingTips.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.slice(0, 200)).slice(0, 40)
    : [];
  if (data.pushMode === 'mass' || data.pushMode === 'equal') CONFIG.PUSH_MODE = data.pushMode;
  if (typeof data.pushCrossTeam === 'boolean') CONFIG.PUSH_CROSS_TEAM = data.pushCrossTeam;
  if (num(data.pushForce) !== undefined) CONFIG.PUSH_FORCE = clamp(data.pushForce, 0.2, 50);

  // ---- middle-of-map terrain effects (per strip variant) ----
  CONFIG.MIDDLE_EMPTY = num(data.middleEmpty) !== undefined ? clamp(data.middleEmpty, 0, 20) : DEFAULTS.middleEmpty;
  CONFIG.MIDDLES = DEFAULTS.middles.map((m) => ({ ...m })); // reset to code defaults
  if (Array.isArray(data.middles)) {
    data.middles.forEach((m, i) => {
      const dst = CONFIG.MIDDLES[i];
      if (!dst || !m || typeof m !== 'object') return;
      if (MIDDLE_KINDS.includes(m.kind)) dst.kind = m.kind;
      if (num(m.amount) !== undefined) dst.amount = clamp(m.amount, 0, 100);
      if (num(m.band) !== undefined) dst.band = clamp(m.band, 0, 4000);
      if (typeof m.air === 'boolean') dst.air = m.air;
    });
  }

  // ---- global: ability params (only known abilities / numeric params) ----
  if (data.abilities && typeof data.abilities === 'object') {
    for (const [id, vals] of Object.entries(data.abilities)) {
      const ab = resolvedAbilities[id];
      if (!ab || typeof vals !== 'object') continue;
      if (typeof vals.desc === 'string') ab.desc = cleanDesc(vals.desc); // hover description
      for (const k of Object.keys(ab.params)) {
        if (num(vals[k]) !== undefined) ab.params[k] = clamp(vals[k], 0, 100000);
      }
    }
  }

  // ---- global: upgrade params + target unit ----
  if (data.upgrades && typeof data.upgrades === 'object') {
    for (const [id, vals] of Object.entries(data.upgrades)) {
      const up = resolvedUpgrades[id];
      if (!up || typeof vals !== 'object') continue;
      if (typeof vals.race === 'string' && (vals.race === '' || RACES.includes(vals.race))) up.race = vals.race;
      if (typeof vals.unit === 'string' && (vals.unit === '' || UNITS[vals.unit])) up.unit = vals.unit;
      if (typeof vals.desc === 'string') up.desc = cleanDesc(vals.desc); // hover description
      if (num(vals.slot) !== undefined) up.slot = Math.round(clamp(vals.slot, -1, 8));
      const params = vals.params || {};
      for (const k of Object.keys(up.params)) {
        if (num(params[k]) !== undefined) up.params[k] = clamp(params[k], 0, 100000);
      }
    }
  }

  // ---- legacy global building layer (pre per-race format) -> every race ----
  applyLegacyGlobalBuildings(data);

  // ---- per-race: units + buildings (authoritative, overrides legacy) ----
  for (const r of RACES) {
    const rd = data.races && data.races[r];
    if (!rd) continue;
    if (rd.units) applyRaceUnits(r, rd.units);
    if (rd.buildings) applyRaceBuildings(r, rd.buildings);
  }
  // legacy flat units (pre per-race) -> apply the same units to every race
  if (data.units && !data.races) for (const r of RACES) applyRaceUnits(r, data.units);
}

function applyRaceUnits(race, unitsData) {
  for (const [id, vals] of Object.entries(unitsData)) {
    const u = resolvedUnits[race][id];
    if (!u || !vals || typeof vals !== 'object') continue; // typeof null === 'object'
    for (const [f] of UNIT_NUM_FIELDS) if (u[f] !== undefined && num(vals[f]) !== undefined) u[f] = vals[f];
    for (const [f, opts] of Object.entries(UNIT_SELECT_FIELDS)) if (u[f] !== undefined && opts.includes(vals[f])) u[f] = vals[f];
    if (typeof vals.name === 'string' && cleanName(vals.name)) u.name = cleanName(vals.name);
    if (typeof vals.tip === 'string') u.tip = cleanDesc(vals.tip); // hover description
    if (num(vals.size) !== undefined) u.size = clamp(vals.size, 0.2, 4);
    if (num(vals.projSize) !== undefined) u.projSize = clamp(vals.projSize, 0.1, 6);
    if (num(vals.cw) !== undefined) u.cw = Math.round(clamp(vals.cw, 1, 20));
    if (num(vals.ch) !== undefined) u.ch = Math.round(clamp(vals.ch, 1, 20));
    if (num(vals.animSpeed) !== undefined) u.animSpeed = clamp(vals.animSpeed, 0.2, 30);
    if (num(vals.splash) !== undefined) u.splash = clamp(vals.splash, 0, 2000);
    if (typeof vals.heal === 'boolean') u.heal = vals.heal;
    if (typeof vals.building === 'string' && (vals.building === '' || TECH_BUILDINGS.includes(vals.building))) u.building = vals.building;
    if (num(vals.slot) !== undefined) u.slot = Math.round(clamp(vals.slot, -1, 8));
    if (num(vals.xp) !== undefined) u.xp = clamp(vals.xp, 0, 100000);
    if (num(vals.food) !== undefined) u.food = clamp(vals.food, 0, 100000);
    if (u.isHero) {
      if (Array.isArray(vals.levelXp)) {
        u.levelXp = vals.levelXp.slice(0, 9).map((n) => clamp(Number(n) || 0, 0, 1000000));
      }
      if (num(vals.hpPerLevel) !== undefined) u.hpPerLevel = clamp(vals.hpPerLevel, 0, 100000);
      if (num(vals.dmgPerLevel) !== undefined) u.dmgPerLevel = clamp(vals.dmgPerLevel, 0, 100000);
      if (num(vals.manaPerLevel) !== undefined) u.manaPerLevel = clamp(vals.manaPerLevel, 0, 100000);
      if (num(vals.manaRegenPerLevel) !== undefined) u.manaRegenPerLevel = clamp(vals.manaRegenPerLevel, 0, 1000);
      if (Array.isArray(vals.heroAbilities)) {
        u.heroAbilities = [0, 1, 2].map((i) => (ABILITY_IDS.includes(vals.heroAbilities[i]) ? vals.heroAbilities[i] : ''));
      }
      if (typeof vals.heroUltimate === 'string') u.heroUltimate = ABILITY_IDS.includes(vals.heroUltimate) ? vals.heroUltimate : '';
    }
    if (num(vals.buildingDamage) !== undefined) u.buildingDamage = clamp(vals.buildingDamage, 0, 100000);
    if (typeof vals.caster === 'boolean') u.caster = vals.caster;
    if (typeof vals.autoAttackBetween === 'boolean') u.autoAttackBetween = vals.autoAttackBetween;
    if (typeof vals.isAir === 'boolean') u.isAir = vals.isAir;
    if (typeof vals.targetsAir === 'boolean') u.targetsAir = vals.targetsAir;
    if (typeof vals.targetsGround === 'boolean') u.targetsGround = vals.targetsGround;
    if (typeof vals.ranged === 'boolean') u.ranged = vals.ranged;
    else if (vals.rangedCaster && vals.caster) u.ranged = true; // legacy (pre-general Ranged)
    if (num(vals.projSpeed) !== undefined) u.projSpeed = clamp(vals.projSpeed, 20, 4000);
    if (typeof vals.bounce === 'boolean') u.bounce = vals.bounce;
    if (num(vals.bouncePower) !== undefined) u.bouncePower = clamp(vals.bouncePower, 0, 100);
    if (num(vals.bounceRadius) !== undefined) u.bounceRadius = clamp(vals.bounceRadius, 10, 600);
    if (num(vals.bounceMax) !== undefined) u.bounceMax = Math.round(clamp(vals.bounceMax, 1, 50));
    if (typeof vals.dash === 'boolean') u.dash = vals.dash;
    if (num(vals.dashDamage) !== undefined) u.dashDamage = clamp(vals.dashDamage, 0, 100000);
    if (num(vals.dashSpeed) !== undefined) u.dashSpeed = clamp(vals.dashSpeed, 20, 4000);
    if (num(vals.dashRange) !== undefined) u.dashRange = clamp(vals.dashRange, 20, 2000);
    if (num(vals.dashCd) !== undefined) u.dashCd = clamp(vals.dashCd, 0, 120);
    if (Array.isArray(vals.abilities)) {
      u.abilities = vals.abilities.filter((a) => ABILITY_IDS.includes(a)).slice(0, MAX_ABILITIES);
    }
    if (num(vals.mana) !== undefined) u.mana = clamp(vals.mana, 0, 100000);
    if (num(vals.manaRegen) !== undefined) u.manaRegen = clamp(vals.manaRegen, 0, 1000);
    // "Ranged" drives whether the basic attack fires a projectile + its speed
    u.projectile = !!u.ranged;
    u.projectileSpeed = u.projSpeed;
  }
}

// Apply one race's building overrides onto its resolved building table.
function applyRaceBuildings(race, buildingsData) {
  for (const [kind, vals] of Object.entries(buildingsData)) {
    const b = resolvedBuildings[race][kind];
    if (b && vals && typeof vals === 'object') applyBuilding(b, kind, vals);
  }
}

function applyBuilding(b, kind, vals) {
  if (!b || typeof vals !== 'object') return;
  if (typeof vals.name === 'string' && cleanName(vals.name)) b.name = cleanName(vals.name);
  if (typeof vals.tip === 'string') b.tip = cleanDesc(vals.tip); // hover description
  if (num(vals.size) !== undefined) b.size = clamp(vals.size, 0.2, 4);
  if (num(vals.idleSpeed) !== undefined) b.idleSpeed = clamp(vals.idleSpeed, 0.2, 10);
  if (num(vals.projSize) !== undefined) b.projSize = clamp(vals.projSize, 0.1, 6);
  if (kind === 'main') {
    if (Array.isArray(vals.hp)) for (let i = 0; i < 3; i++) if (num(vals.hp[i]) !== undefined) b.hp[i] = vals.hp[i];
    for (const f of ['damage', 'range', 'period', 'projectileSpeed']) if (num(vals[f]) !== undefined) b[f] = clamp(vals[f], 0, 100000);
    if (['normal', 'piercing', 'explosive'].includes(vals.dmgType)) b.dmgType = vals.dmgType;
    if (typeof vals.targetsAir === 'boolean') b.targetsAir = vals.targetsAir;
    return;
  }
  for (const f of BUILDING_SCALARS) if (b[f] !== undefined && num(vals[f]) !== undefined) b[f] = vals[f];
  if (num(vals.slot) !== undefined) b.slot = clamp(Math.round(vals.slot), -1, 8); // shop grid cell
  if (b.cw !== undefined) {
    if (num(vals.cw) !== undefined) b.cw = clamp(Math.round(vals.cw), 1, 20);
    if (num(vals.ch) !== undefined) b.ch = clamp(Math.round(vals.ch), 1, 20);
    // legacy single-radius footprint -> square cell count
    if (vals.cw === undefined && num(vals.radius) !== undefined) {
      const cells = clamp(Math.round(vals.radius * 2 / CONFIG.GRID), 1, 20);
      b.cw = cells; b.ch = cells;
    }
  }
}

// Old global format (data.buildings/turret/mainHp/mainIdleSpeed/buildingSizes/
// buildingNames) applied identically to every race, as a base layer.
function applyLegacyGlobalBuildings(data) {
  for (const r of RACES) {
    if (data.buildings) for (const [kind, vals] of Object.entries(data.buildings)) applyBuilding(resolvedBuildings[r][kind], kind, vals);
    if (data.turret) applyBuilding(resolvedBuildings[r].turret, 'turret', data.turret);
    if (Array.isArray(data.mainHp)) applyBuilding(resolvedBuildings[r].main, 'main', { hp: data.mainHp });
    if (num(data.mainIdleSpeed) !== undefined) resolvedBuildings[r].main.idleSpeed = clamp(data.mainIdleSpeed, 0.2, 10);
    if (data.buildingSizes) for (const k of BUILDING_ENTS) if (num(data.buildingSizes[k]) !== undefined) resolvedBuildings[r][k].size = clamp(data.buildingSizes[k], 0.2, 4);
    if (data.buildingNames) for (const k of BUILDING_ENTS) if (typeof data.buildingNames[k] === 'string' && cleanName(data.buildingNames[k])) resolvedBuildings[r][k].name = cleanName(data.buildingNames[k]);
  }
}

export function currentBalance() {
  return snapshot();
}

// Per-entity fields the admin hand-tunes on THIS install that an Import must
// never clobber: visual size, grid footprint, shop-grid slot, animation speeds,
// food, hero-XP bounty, and the hero's assigned ability kit. An import brings
// BALANCE numbers (cost/hp/damage/...); these stay exactly as configured here.
const IMPORT_KEEP_UNIT = ['name', 'tip', 'speed', 'size', 'projSize', 'cw', 'ch', 'slot', 'animSpeed', 'food', 'xp', 'heroAbilities', 'heroUltimate'];
const IMPORT_KEEP_BUILDING = ['name', 'tip', 'size', 'cw', 'ch', 'slot', 'idleSpeed',
  'workerSize', 'workerSpeed', 'workerCount', 'workerPause', 'workerAnimSpeed',
  'campSize', 'campSize2', 'campSize3', 'campSpeed', 'campfireDelay', 'attackHold'];

// Load a full balance object from outside the server (admin Import). Applies it,
// seeds the local cache, and clears the "not loaded" guard — so Import doubles as
// a recovery path even if the initial fetch failed. Caller then saves to server.
// Throws if `data` isn't a usable object, so the caller can report a bad file.
export function importBalance(data) {
  if (!data || typeof data !== 'object') throw new Error('balans invalid');
  // snapshot the protected fields as they are RIGHT NOW (pre-import)
  const keep = {};
  for (const race of RACES) {
    keep[race] = { units: {}, buildings: {} };
    for (const [id, u] of Object.entries(resolvedUnits[race] || {})) {
      const k = {};
      for (const f of IMPORT_KEEP_UNIT) if (u[f] !== undefined) k[f] = Array.isArray(u[f]) ? [...u[f]] : u[f];
      keep[race].units[id] = k;
    }
    for (const [kind, b] of Object.entries(resolvedBuildings[race] || {})) {
      const k = {};
      for (const f of IMPORT_KEEP_BUILDING) if (b[f] !== undefined) k[f] = b[f];
      keep[race].buildings[kind] = k;
    }
  }
  // hover descriptions on abilities/upgrades are the admin's own texts too
  const keepAbDesc = {};
  for (const [id, ab] of Object.entries(resolvedAbilities)) keepAbDesc[id] = ab.desc;
  const keepUpDesc = {};
  for (const [id, up] of Object.entries(resolvedUpgrades)) keepUpDesc[id] = up.desc;
  // the custom gold icon is this install's own cosmetic — an imported design
  // file (which won't carry one) must not wipe it
  const keepGoldIcon = CONFIG.GOLD_ICON;
  const keepMenuLogo = CONFIG.MENU_LOGO, keepMenuBtn = CONFIG.MENU_BTN;
  const keepMenuCard = CONFIG.MENU_CARD, keepMenuBack = CONFIG.MENU_BACK;
  const keepMenuSlideFrame = CONFIG.MENU_SLIDE_FRAME, keepMenuFsBtn = CONFIG.MENU_FS_BTN, keepMenuSoundBtn = CONFIG.MENU_SOUND_BTN, keepMenuPwf = CONFIG.MENU_PWF;
  const keepMenuPlay = CONFIG.MENU_PLAY, keepMenuSetupFrame = CONFIG.MENU_SETUP_FRAME, keepMenuOptionsFrame = CONFIG.MENU_OPTIONS_FRAME;
  const keepMenuBg = CONFIG.MENU_BG, keepLoadingBgs = CONFIG.LOADING_BGS;
  const keepMenuMusic = CONFIG.MENU_MUSIC, keepTips = CONFIG.LOADING_TIPS;
  const keepTutorials = CONFIG.TUTORIALS;
  applyBalance(data);
  if (typeof data.goldIcon !== 'string' || !data.goldIcon) CONFIG.GOLD_ICON = keepGoldIcon;
  if (typeof data.menuLogo !== 'string' || !data.menuLogo) CONFIG.MENU_LOGO = keepMenuLogo;
  if (typeof data.menuBtn !== 'string' || !data.menuBtn) CONFIG.MENU_BTN = keepMenuBtn;
  if (typeof data.menuCard !== 'string' || !data.menuCard) CONFIG.MENU_CARD = keepMenuCard;
  if (typeof data.menuBack !== 'string' || !data.menuBack) CONFIG.MENU_BACK = keepMenuBack;
  if (typeof data.menuSlideFrame !== 'string' || !data.menuSlideFrame) CONFIG.MENU_SLIDE_FRAME = keepMenuSlideFrame;
  if (typeof data.menuFsBtn !== 'string' || !data.menuFsBtn) CONFIG.MENU_FS_BTN = keepMenuFsBtn;
  if (typeof data.menuSoundBtn !== 'string' || !data.menuSoundBtn) CONFIG.MENU_SOUND_BTN = keepMenuSoundBtn;
  if (typeof data.menuPwf !== 'string' || !data.menuPwf) CONFIG.MENU_PWF = keepMenuPwf;
  if (typeof data.menuPlay !== 'string' || !data.menuPlay) CONFIG.MENU_PLAY = keepMenuPlay;
  if (typeof data.menuSetupFrame !== 'string' || !data.menuSetupFrame) CONFIG.MENU_SETUP_FRAME = keepMenuSetupFrame;
  if (typeof data.menuOptionsFrame !== 'string' || !data.menuOptionsFrame) CONFIG.MENU_OPTIONS_FRAME = keepMenuOptionsFrame;
  if (typeof data.menuBg !== 'string' || !data.menuBg) CONFIG.MENU_BG = keepMenuBg;
  if ((!Array.isArray(data.loadingBgs) || !data.loadingBgs.some(Boolean)) && !data.loadingBg) CONFIG.LOADING_BGS = keepLoadingBgs;
  if (typeof data.menuMusic !== 'string' || !data.menuMusic) CONFIG.MENU_MUSIC = keepMenuMusic;
  if (!Array.isArray(data.loadingTips) || !data.loadingTips.length) CONFIG.LOADING_TIPS = keepTips;
  if (!Array.isArray(data.tutorials) || !data.tutorials.length) CONFIG.TUTORIALS = keepTutorials;
  // restore them over whatever the imported file said
  for (const race of RACES) {
    for (const [id, k] of Object.entries(keep[race].units)) {
      if (resolvedUnits[race][id]) Object.assign(resolvedUnits[race][id], k);
    }
    for (const [kind, k] of Object.entries(keep[race].buildings)) {
      if (resolvedBuildings[race][kind]) Object.assign(resolvedBuildings[race][kind], k);
    }
  }
  for (const [id, d] of Object.entries(keepAbDesc)) if (resolvedAbilities[id] && d !== undefined) resolvedAbilities[id].desc = d;
  for (const [id, d] of Object.entries(keepUpDesc)) if (resolvedUpgrades[id] && d !== undefined) resolvedUpgrades[id].desc = d;
  // cache the MERGED result (what a subsequent Save writes), not the raw file
  cacheBalanceText(JSON.stringify(currentBalance()));
  balanceLoadFailed = false;
}

export function resetRaceUnit(race, id) {
  // rebuild from the same source as the initial tables, so every field (incl.
  // xp/food/slot/building and the hero's leveling + kit) is restored correctly
  const fresh = baseUnits(race)[id];
  if (fresh) resolvedUnits[race][id] = fresh;
}

export function resetAbility(id) {
  if (ABILITIES[id]) resolvedAbilities[id] = { ...ABILITIES[id], params: { ...ABILITIES[id].params } };
}

export function resetUpgrade(id) {
  if (UPGRADES[id]) resolvedUpgrades[id] = { ...UPGRADES[id], params: { ...UPGRADES[id].params } };
}

export function resetRaceBuilding(race, kind) {
  resolvedBuildings[race][kind] = baseBuildings()[kind];
}

export function resetAll() {
  applyBalance(DEFAULTS);
}

export function defaults() {
  return DEFAULTS;
}

// ---------------------------------------------------------- load/save
// Tracks whether the saved balance FAILED to load (network/server error while
// the file may still exist). Admin editors must NOT save in that state, or a
// Save would overwrite the real config with code defaults. A missing file (404)
// is NOT a failure — it's a fresh install, safe to write the first balance.json.
let balanceLoadFailed = false;

// Last known-good balance is mirrored in localStorage. When the server serves
// balance.json fine on one page (e.g. Sprites) but hiccups on the next (e.g.
// Upgrades), the cached copy lets the editor open with the REAL config instead
// of code defaults — so an intermittent hop no longer trips the scary banner
// (and can no longer lead to a Save-over-defaults). Only a total failure with
// no cache at all still shows the banner.
const BALANCE_CACHE_KEY = 'ds-balance-cache';

function cacheBalanceText(text) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(BALANCE_CACHE_KEY, text);
  } catch { /* storage full / disabled — cache is best-effort */ }
}

function readBalanceCache() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(BALANCE_CACHE_KEY);
  } catch { /* storage disabled */ }
  return null;
}

export async function loadBalance(base = 'assets/') {
  // Retry transient hiccups (network blips, momentary 5xx) before giving up, so
  // a single flaky request doesn't trip the "not loaded" guard + warning banner.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${base}balance.json`, { cache: 'no-cache' });
      if (r.status === 404) { balanceLoadFailed = false; return false; } // fresh: no file yet
      if (!r.ok) throw new Error(`status ${r.status}`);                  // retry non-ok
      // Parse tolerantly: strip a leading UTF-8 BOM / stray whitespace that a
      // Windows editor or upload can add — the browser ignores it but the strict
      // JSON parser would otherwise throw (and trip the "not loaded" banner).
      const text = (await r.text()).replace(/^\uFEFF/, '').trim();
      applyBalance(JSON.parse(text));
      cacheBalanceText(text); // remember the good copy for next time
      balanceLoadFailed = false;
      return true;
    } catch {
      if (attempt < 2) { await new Promise((res) => setTimeout(res, 400 * (attempt + 1))); continue; }
      // Server failed after retries. Fall back to the last known-good copy so the
      // editor still opens on the real config — a single flaky request must not
      // block the admin or wipe the config with defaults.
      const cached = readBalanceCache();
      if (cached) {
        try {
          applyBalance(JSON.parse(cached));
          balanceLoadFailed = false; // we have the real config (from cache), safe to edit/save
          return true;
        } catch { /* corrupt cache — fall through to the failure path */ }
      }
      balanceLoadFailed = true; // no good copy anywhere — don't risk a Save
      return false;
    }
  }
  return false;
}

// Admin guard: call right after loadBalance in an editor. Returns true when it's
// safe to show the editor / allow saving. On a genuine load failure it drops a
// sticky warning banner and returns false, so the caller bails out and never
// saves code defaults over the real config. (Save is also blocked in saveBalance.)
export function ensureBalanceLoadedUI() {
  if (!balanceLoadFailed) return true;
  if (typeof document !== 'undefined' && document.body && !document.getElementById('ds-balance-warn')) {
    const d = document.createElement('div');
    d.id = 'ds-balance-warn';
    d.textContent = '⚠ Balance nu s-a încărcat (rețea/server). NU edita și NU salva — reîncarcă pagina, altfel suprascrii tot config-ul cu valori default.';
    d.style.cssText = 'position:sticky;top:0;z-index:99999;background:#7a1f1f;color:#fff;padding:12px 16px;font:14px/1.4 system-ui,sans-serif;font-weight:700;text-align:center';
    document.body.prepend(d);
  }
  return false;
}

// Requires an active admin session. `endpoint` is relative to the caller's
// page (the admin editors pass 'save-balance.php').
export async function saveBalance(endpoint = 'admin/save-balance.php') {
  // never overwrite the real config with defaults after a failed load
  if (balanceLoadFailed) return 'not-loaded';
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DS-Balance': '1' },
    body: JSON.stringify(currentBalance()),
  });
  if (r.status === 401) return 'auth';
  return r.ok ? 'ok' : 'error';
}
