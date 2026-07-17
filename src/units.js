// Unit roster + damage/armor counter matrix. This is the balance file:
// every combat number in the game lives in this module.

// How much damage each damage type deals to each armor type.
export const DAMAGE_MATRIX = {
  normal:    { light: 1.0,  armored: 0.7,  structure: 0.7 },
  piercing:  { light: 0.75, armored: 1.5,  structure: 0.8 },
  explosive: { light: 1.5,  armored: 0.75, structure: 1.25 },
};

export const UNITS = {
  grunt: {
    name: 'Grunt', shape: 'circle', radius: 10,
    tier: 1, cost: 50, hp: 90, armor: 'light',
    damage: 10, period: 0.8, dmgType: 'normal', range: 25, speed: 90,
    role: 'Cheap swarm melee',
    tip: 'Dirt-cheap frontline meat. Dies to splash.',
  },
  slinger: {
    name: 'Slinger', shape: 'triangle', radius: 9,
    tier: 1, cost: 75, hp: 60, armor: 'light',
    damage: 9, period: 0.9, dmgType: 'normal', range: 180, speed: 70,
    projectile: true, targetsAir: true,
    role: 'Ranged infantry',
    tip: 'Shoots ground and air. Fragile — keep behind a frontline.',
  },
  bruiser: {
    name: 'Bruiser', shape: 'square', radius: 16,
    tier: 2, cost: 200, hp: 400, armor: 'armored',
    damage: 20, period: 1.2, dmgType: 'normal', range: 30, speed: 55,
    role: 'Armored tank',
    tip: 'Huge HP wall. Melts to piercing (Lancer).',
  },
  lancer: {
    name: 'Lancer', shape: 'diamond', radius: 10,
    tier: 2, cost: 175, hp: 110, armor: 'light',
    damage: 45, period: 1.5, dmgType: 'piercing', range: 200, speed: 65,
    projectile: true,
    role: 'Anti-armor',
    tip: 'Piercing shots — +50% vs armored. Weak vs swarms.',
  },
  crab: {
    name: 'Siege Crab', shape: 'pentagon', radius: 15,
    tier: 3, cost: 300, hp: 250, armor: 'armored',
    damage: 40, period: 2.5, dmgType: 'explosive', range: 320, speed: 40,
    projectile: true, projectileSpeed: 300, splash: 60,
    role: 'Splash artillery',
    tip: 'Long-range explosive splash — deletes clumped light units. Cannot hit air.',
  },
  mender: {
    name: 'Mender', shape: 'cross', radius: 10,
    tier: 2, cost: 150, hp: 80, armor: 'light',
    damage: 15, period: 1.0, dmgType: 'normal', range: 140, speed: 60,
    heal: true,
    role: 'Support healer',
    tip: 'Heals the most wounded nearby ally. Protect it.',
  },
  dasher: {
    name: 'Dasher', shape: 'chevron', radius: 9,
    tier: 1, cost: 100, hp: 70, armor: 'light',
    damage: 14, period: 0.7, dmgType: 'normal', range: 25, speed: 150,
    role: 'Fast flanker',
    tip: 'Very fast — dives the enemy backline (artillery, healers).',
  },
  wasp: {
    name: 'Wasp', shape: 'ring', radius: 10,
    tier: 2, cost: 150, hp: 100, armor: 'armored',
    damage: 12, period: 0.8, dmgType: 'normal', range: 150, speed: 110,
    projectile: true, isAir: true, targetsAir: true,
    role: 'Air unit',
    tip: 'Flies — melee and artillery cannot touch it. Countered by Slinger/Archon.',
  },
  archon: {
    name: 'Archon', shape: 'hexagon', radius: 13,
    tier: 3, cost: 250, hp: 150, armor: 'light',
    damage: 24, period: 1.0, dmgType: 'piercing', range: 220, speed: 60,
    projectile: true, targetsAir: true,
    role: 'Anti-air / anti-armor',
    tip: 'Piercing beams that hit air and ground. The dedicated Wasp answer.',
  },
  // Hero: one special unit per race, bought from the Base (not the shop/tech
  // buildings). Levels up 1->10 from your army's kills and learns abilities;
  // respawns each wave keeping its level. Only ONE per team.
  hero: {
    name: 'Erou', shape: 'star', radius: 15,
    tier: 1, cost: 250, hp: 600, armor: 'armored',
    damage: 40, period: 1.0, dmgType: 'normal', range: 30, speed: 85,
    isHero: true,
    role: 'Erou',
    tip: 'Unitate specială, una per rasă. Urcă în nivel din kill-urile armatei și învață abilități. Respawn la fiecare val, păstrând nivelul.',
  },
  // Two more dedicated heroes so a race can field up to 3 (recruited from the
  // Hero Hall). hero2 unlocks at base tier 2, hero3 at tier 3. Abilities, art
  // and stats are configured per race in admin — these are just the slots.
  hero2: {
    name: 'Erou II', shape: 'star', radius: 15,
    tier: 2, cost: 350, hp: 750, armor: 'armored',
    damage: 50, period: 1.0, dmgType: 'normal', range: 30, speed: 85,
    isHero: true,
    role: 'Erou',
    tip: 'Al doilea erou — se recrutează din Hero Hall după ce ajungi la tier 2.',
  },
  hero3: {
    name: 'Erou III', shape: 'star', radius: 15,
    tier: 3, cost: 450, hp: 900, armor: 'armored',
    damage: 60, period: 1.0, dmgType: 'normal', range: 30, speed: 85,
    isHero: true,
    role: 'Erou',
    tip: 'Al treilea erou — se recrutează din Hero Hall după ce ajungi la tier 3.',
  },
};

// Categories used by the AI's composition logic.
export const UNIT_CATEGORIES = {
  front: ['grunt', 'bruiser', 'dasher'],
  ranged: ['slinger', 'lancer', 'archon'],
  special: ['crab', 'wasp'],
  support: ['mender'],
};

export const UNIT_IDS = Object.keys(UNITS);
