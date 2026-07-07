// Upgrade catalog — the single source of truth for every buyable upgrade.
// GLOBAL (shared by both races). Upgrades are bought IN-GAME from a player's
// main base (one-off, permanent for the match) and change how a chosen unit
// type behaves. Which unit an upgrade transforms is set in the admin
// "Upgrades" editor (upgrade.unit); its numbers are balanced there too and
// ship inside assets/balance.json under `upgrades`.
//
// Upgrade ids must stay lowercase-alphanumeric: they become balance keys and
// sprite slot prefixes — do NOT rename existing ids or saved data breaks.

export const UPGRADES = {
  dashmount: {
    name: 'Dashing & Fleeing mount',
    desc: 'A mounted rider (e.g. a boar rider): when an enemy Ranged, non-flying unit enters the trigger radius, it charges that unit, the mount flees, and the rider fights on foot from then on with its dismounted stats. Bought once from the base; permanent for the match.',
    kind: 'mount',
    race: '',   // which race's unit this targets (same type differs per race)
    unit: '',   // which unit type this upgrade transforms (set in admin)
    params: {
      cost: 300,       // gold to buy from the base
      radius: 260,     // enters -> a ranged non-flying enemy triggers the charge
      dashSpeed: 720,  // charge speed toward the trigger
      dmDamage: 22,    // on-foot (dismounted) damage
      dmRange: 30,     // on-foot attack range
      dmPeriod: 0.8,   // on-foot attack period (s)
      dmSpeed: 95,     // on-foot move speed
      dmSize: 100,     // on-foot visual size (%), independent of the mounted size
    },
  },
  groundattack: {
    name: 'Attack ground units',
    desc: 'Grants a chosen unit the ability to also hit GROUND targets (for an otherwise air-only flyer such as a Giant Eagle). Bought once from the base; permanent for the match.',
    kind: 'ground',
    race: '',   // which race's unit this targets
    unit: '',   // which unit type gains ground attack (set in admin)
    params: {
      cost: 200, // gold to buy from the base
    },
  },
  acidspit: {
    name: 'Acid Spit',
    desc: 'The rider\'s dragon spits acid instead of its basic attack: a ranged projectile that bursts for SPLASH damage and leaves acid that deals damage over time to everyone caught in the blast (e.g. a Wyvern Rider). Bought once from the base; permanent for the match. Needs two extra "Acid" attack sprites on the unit.',
    kind: 'acid',
    race: '',   // which race's unit this targets
    unit: '',   // which unit type gains the acid attack (set in admin)
    params: {
      cost: 350,           // gold to buy from the base
      range: 240,          // how far the acid can be spat
      damage: 24,          // direct splash damage on impact
      splashRadius: 90,    // radius of the acid burst
      dotDamage: 12,       // extra damage per second (damage over time)
      dotDuration: 4,      // seconds the acid keeps burning
      projectileSpeed: 340,
    },
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES);

// Labels for the editable params (admin "Upgrades" page).
export const UPGRADE_PARAM_LABELS = {
  cost: 'Cost (aur, din Bază)',
  range: 'Rază atac',
  damage: 'Damage (splash)',
  projectileSpeed: 'Viteză proiectil',
  radius: 'Rază declanșare',
  dashSpeed: 'Viteză dash (charge)',
  dmDamage: 'Damage pe jos',
  dmRange: 'Rază atac pe jos',
  dmPeriod: 'Perioadă atac pe jos (s)',
  dmSpeed: 'Viteză mișcare pe jos',
  dmSize: 'Mărime pe jos (Size %)',
  splashRadius: 'Rază splash',
  dotDamage: 'Damage over time (pe secundă)',
  dotDuration: 'Durată acid (s)',
};
