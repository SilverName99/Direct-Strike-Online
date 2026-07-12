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
  focusbuilding: {
    name: 'Focus building',
    desc: 'The unit ignores enemy troops entirely and attacks only STRUCTURES (walls, towers, the base) — a dedicated siege breaker (e.g. a Siege Cannon). This upgrade ONLY changes targeting; the special damage vs buildings is a per-unit stat ("Damage în clădiri") that always applies, upgrade or not. Bought once from the base; permanent for the match.',
    kind: 'focusbuild',
    race: '',   // which race's unit this targets
    unit: '',   // which unit type becomes buildings-only (set in admin)
    params: {
      cost: 200, // gold to buy from the base
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
  aoedamage: {
    name: 'AoE Damage',
    desc: 'The unit\'s thrown weapon (e.g. a Griffin Rider\'s axe) bursts on impact: the struck target takes full damage, and every OTHER enemy on the SAME plane (air target -> air units only, ground target -> ground units only) caught in the splash radius takes a percentage of it. Bought once from the base; permanent for the match.',
    kind: 'aoe',
    race: '',   // which race's unit this targets
    unit: '',   // which unit type gains the splash attack (set in admin)
    params: {
      cost: 250,        // gold to buy from the base
      splashRadius: 80, // radius of the burst around the struck target
      splashPower: 60,  // % of the damage dealt to the OTHERS in the radius
    },
  },
  splitmount: {
    name: 'Landing Split: beast & rider',
    desc: 'When a GROUND enemy enters the trigger radius, the flying rider DASHES into it (dealing the dash damage on impact — ground only) and the one unit splits into TWO: the rider fights on foot (with the on-foot numbers below, still throwing if "rider stays ranged" is 1) and the mount becomes a separate melee beast with its own HP. Both fight until they die (e.g. a Griffin Rider). Needs the extra "Dash", "Pe jos" (rider) and "Bestie" (mount) sprites on the unit.',
    kind: 'split',
    race: '',   // which race's unit this targets
    unit: '',   // which unit type splits on landing (set in admin)
    params: {
      cost: 400,       // gold to buy from the base
      radius: 240,     // a GROUND enemy this close triggers the dive
      dashSpeed: 700,  // dive speed toward the trigger
      dashDamage: 40,  // one-off impact damage on the dived ground unit
      // the rider on foot (uses the unit's "Pe jos" sprite set)
      dmDamage: 18,    // on-foot damage
      dmRange: 160,    // on-foot attack range
      dmPeriod: 1.0,   // on-foot attack period (s)
      dmSpeed: 90,     // on-foot move speed
      dmSize: 100,     // on-foot visual size (%)
      dmRanged: 1,     // 1 = the rider keeps its ranged (thrown) attack, 0 = melee
      // the beast (the mount), spawned beside the rider as its own unit
      beastHp: 220,
      beastDamage: 16,
      beastRange: 30,
      beastPeriod: 0.9,
      beastSpeed: 120,
      beastSize: 100,  // beast visual size (%)
    },
  },
  fireball: {
    name: 'Bile de foc',
    desc: 'Catapulta aruncă bile de foc în loc de proiectilul normal: lovește pentru damage (cu bonus vs clădiri) și lasă o ZONĂ de foc pe pământ care arde inamicii din ea câteva secunde (damage per secundă). Cumpărat o dată din Bază; permanent pe meci. Are nevoie de 2 frame-uri "Foc: mers", 2 "Foc: atac" și un proiectil de foc pe unitate.',
    kind: 'fire',
    race: '',   // which race's unit this targets
    unit: '',   // which unit type gains the fireball attack (set in admin)
    params: {
      cost: 350,           // gold to buy from the base
      range: 300,          // how far the fireball is thrown
      damage: 40,          // direct impact damage (splash center)
      splashRadius: 80,    // radius of the immediate impact burst
      buildingDamage: 60,  // damage vs STRUCTURES (replaces the normal damage on buildings)
      zoneRadius: 110,     // radius of the burning ground left on impact
      zoneDps: 16,         // damage per second inside the fire zone
      zoneDuration: 4,     // seconds the fire keeps burning
      projectileSpeed: 300,
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
  lightshield: {
    name: 'Scut de lumină',
    desc: 'Când viața unității scade sub un prag (%), invocă un scut de lumină și devine INVULNERABILĂ câteva secunde, apoi intră în cooldown înainte să se poată reactiva (ex. Lightblade Weaver). Scutul se pune și pe cei mai apropiați aliați (configurabil). Cumpărat o dată din Bază; permanent pe meci. Are nevoie de un frame „Scut" pe unitate (scutul de lumină propriu-zis e desenat automat).',
    kind: 'shield',
    race: '',   // which race's unit this targets
    unit: '',   // which unit type gains the shield (set in admin)
    params: {
      cost: 300,       // gold to buy from the base
      threshold: 50,   // % HP under which the shield triggers
      duration: 3,     // seconds of invulnerability
      cooldown: 12,    // seconds before it can trigger again (after it ends)
      shieldSize: 100, // size of the light dome (%, 100 = default)
      poseTime: 0.5,   // seconds the unit holds the "shield" activation pose
      allies: 1,       // how many nearby allies also get the shield (0 = none)
      allyRange: 250,  // radius to look for those allies (0 = whole field)
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
  threshold: 'Prag activare (% HP)',
  duration: 'Durată invulnerabilitate (s)',
  cooldown: 'Cooldown (s)',
  shieldSize: 'Mărime scut (%)',
  poseTime: 'Durată poză activare (s)',
  allies: 'Aliați scutați în plus',
  allyRange: 'Rază aliați (0 = tot terenul)',
  dmRanged: 'Călărețul rămâne ranged (1/0)',
  dashDamage: 'Damage la impact (dash)',
  splashPower: 'Putere splash (% din damage)',
  buildingDamage: 'Damage vs clădiri',
  zoneRadius: 'Rază zonă de foc',
  zoneDps: 'Damage zonă (pe secundă)',
  zoneDuration: 'Durată zonă de foc (s)',
  beastHp: 'HP bestie',
  beastDamage: 'Damage bestie',
  beastRange: 'Rază atac bestie',
  beastPeriod: 'Perioadă atac bestie (s)',
  beastSpeed: 'Viteză bestie',
  beastSize: 'Mărime bestie (Size %)',
};
