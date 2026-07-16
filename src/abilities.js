// Ability catalog — the single source of truth for every castable ability.
// GLOBAL (shared by both races); which units *have* them is per-race unit
// config (the "Caster" checkbox + selection in the admin stats editor).
// Params are balanced from the admin "Abilities" page and stored in
// assets/balance.json under `abilities`.
//
// kind: 'aura'     — passive; while the caster lives it keeps refreshing a
//                    status effect on units inside `radius` (no cast anim).
//       'castaura' — cast on cooldown (prepare -> cast frame); the buff/heal
//                    zone then persists around the caster for `duration`
//                    seconds. Costs `manaCost` per cast; recastable only once
//                    the zone expires (cooldown = duration).
//       'active'   — auto-cast on cooldown when a valid trigger exists
//                    (plays the unit's uploaded cast frames, if any).
//       'summon'   — spawns an allied animal (its own stats) beside the caster,
//                    up to a cap, for a duration. Cast proactively (no enemy
//                    needed). The animal's sprites are hosted on the CASTER unit
//                    under an "<animal>-" prefix (wolf-/eagle-/bear-).
//
// Ability ids must stay lowercase-alphanumeric: they become sprite slot
// names (cast-<id>_0.png) and balance keys — do NOT rename existing ids or
// saved caster selections break.

export const ABILITIES = {
  heal: {
    name: 'Heal',
    kind: 'active',
    color: '#5be0a0',
    desc: 'Spends mana to instantly heal the most-wounded nearby ally.',
    params: {
      tier: 1,       // base tier required before this ability can be used
      cooldown: 3,   // seconds between casts
      manaCost: 25,  // mana per cast
      range: 160,    // how far the caster can reach an ally
      amount: 120,   // HP restored per cast
    },
  },
  dispell: {
    name: 'Dispel',
    kind: 'active',
    color: '#ffe9a8',
    desc: 'Cleanses an area: allies lose debuffs and gain brief immunity; enemies lose buffs and cannot gain new ones.',
    params: {
      tier: 1,       // base tier required before this ability can be used
      cooldown: 8,   // seconds between casts
      manaCost: 40,  // mana per cast
      range: 180,    // how far the caster can target
      radius: 90,    // cleansed area
      immunity: 3,   // seconds of debuff-immunity (allies) / buff-block (enemies)
    },
  },
  slowaura: {
    name: 'Slow Aura',
    kind: 'castaura',
    color: '#7fb4ff',
    desc: 'Cast to raise a zone that makes nearby enemies attack slower for a duration (Shaman).',
    params: {
      tier: 1,       // base tier required before this ability can be used
      radius: 140,
      atkSlow: 30,   // % slower attacks
      duration: 12,  // seconds the zone lasts after the cast
      manaCost: 30,  // mana per cast
    },
  },
  hasteaura: {
    name: 'Haste Aura',
    kind: 'castaura',
    color: '#ffd35c',
    desc: 'Cast to raise a zone that makes nearby allies attack faster for a duration.',
    params: {
      tier: 1,       // base tier required before this ability can be used
      radius: 140,
      haste: 25,     // % faster attacks
      duration: 12,  // seconds the zone lasts after the cast
      manaCost: 30,  // mana per cast
    },
  },
  regenaura: {
    name: 'Regeneration Aura',
    kind: 'castaura',
    color: '#58d68d',
    desc: 'Cast to raise a zone that regenerates nearby allies for a duration (Priest aura).',
    params: {
      tier: 1,       // base tier required before this ability can be used
      radius: 140,
      hps: 5,        // HP healed per second
      duration: 12,  // seconds the zone lasts after the cast
      manaCost: 30,  // mana per cast
    },
  },
  summonwolf: {
    name: 'Invocă Lup',
    kind: 'summon',
    animal: 'wolf', // sprite prefix hosted on the caster (wolf-walk/attack/die)
    animalName: 'Lup',
    color: '#c8d0da',
    desc: 'Invocă un lup rapid care luptă alături de shaman (deblocat la tier 1).',
    params: {
      tier: 1, manaCost: 30, cooldown: 5,
      cap: 2,         // max wolves this shaman keeps alive (0 = unlimited)
      life: 12,       // seconds the wolf lives (0 = never disappears)
      hp: 120, damage: 16, range: 25, period: 0.8, speed: 130,
      animSpeed: 8,   // walk frame flips per second
      size: 90,       // visual size (%)
      splash: 0, flying: 0, projectile: 0, armored: 0,
    },
  },
  summoneagle: {
    name: 'Invocă Vultur',
    kind: 'summon',
    animal: 'eagle',
    animalName: 'Vultur',
    color: '#ffe08a',
    desc: 'Invocă un vultur zburător (deblocat la tier 2).',
    params: {
      tier: 2, manaCost: 40, cooldown: 8,
      cap: 1, life: 12,
      hp: 90, damage: 15, range: 30, period: 0.9, speed: 150,
      animSpeed: 8,
      size: 90,
      splash: 0, flying: 1, projectile: 0, armored: 0,
    },
  },
  summonbear: {
    name: 'Invocă Urs',
    kind: 'summon',
    animal: 'bear',
    animalName: 'Urs',
    color: '#d8a86a',
    desc: 'Invocă un urs masiv și rezistent (deblocat la tier 3).',
    params: {
      tier: 3, manaCost: 60, cooldown: 10,
      cap: 1, life: 15,
      hp: 320, damage: 30, range: 30, period: 1.2, speed: 90,
      animSpeed: 5,
      size: 120,
      splash: 0, flying: 0, projectile: 0, armored: 1,
    },
  },
  // ---- Chieftain (Orc hero) kit ----
  warstomp: {
    name: 'War Stomp',
    kind: 'active',
    color: '#e8a15a',
    desc: 'Lovește pământul: damage și încetinire tuturor inamicilor din jurul eroului.',
    params: {
      tier: 1, cooldown: 8, manaCost: 40,
      radius: 150, damage: 60, moveSlow: 40, atkSlow: 30, duration: 3,
      castPrepare: 0, // Chieftain casts instantly (no wind-up frame)
    },
  },
  bloodlust: {
    name: 'Bloodlust',
    kind: 'active',
    color: '#ff6a6a',
    desc: 'Strigăt de război: TOATĂ armata ta atacă și se mișcă mai repede câteva secunde. (ultima Chieftain-ului)',
    params: {
      tier: 1, cooldown: 40, manaCost: 80,
      haste: 40, moveHaste: 30, duration: 6,
      size: 130,      // % the Chieftain grows to while raging (100 = no change)
      castPrepare: 0, // instant cast (no wind-up frame)
    },
  },
  frostbolt: {
    name: 'Frost Bolt',
    kind: 'active',
    color: '#8fe3ff',
    projectile: true, // fires a projectile -> per-caster projectile image slot
    desc: 'A projectile that damages the target and slows its movement and attacks for a duration.',
    params: {
      tier: 1,             // base tier required before this ability can be used
      cooldown: 6,
      manaCost: 30,        // mana per cast
      range: 200,
      damage: 15,
      moveSlow: 40,        // % slower movement
      atkSlow: 30,         // % slower attacks
      duration: 3,         // seconds the slow lasts
      projectileSpeed: 380,
    },
  },
  cleave: {
    name: 'Cleave',
    kind: 'passive', // not cast — modifies the hero's basic MELEE attack
    color: '#ff9a3c',
    desc: 'Pasiv: fiecare atac melee al eroului lovește și inamicii din jurul țintei (% din damage). Crește cu rangul.',
    params: {
      tier: 1,
      radius: 130,     // splash radius around the struck target
      cleavePct: 45,   // % of the hit dealt to nearby enemies (scales with rank)
    },
  },
  charge: {
    name: 'Charge',
    kind: 'passive', // proximity-triggered gap-closer (reuses the dash mechanic)
    color: '#ffca55',
    desc: 'Eroul se aruncă spre un inamic din depărtare, la viteză mare; la impact face damage și îl stun-ează scurt. Cooldown.',
    params: {
      tier: 1,
      range: 500,      // charges a target within this range (but out of melee)
      dashSpeed: 620,  // charge movement speed
      damage: 55,      // impact damage (scales with rank)
      stun: 1,         // seconds the struck target is stunned on impact
      cooldown: 9,     // seconds between charges
    },
  },
  // ---- Paladin (Human hero) kit ----
  holylight: {
    name: 'Holy Light',
    kind: 'active',
    color: '#ffe9a8',
    desc: 'Vindecă instant aliatul cel mai rănit din jur (inclusiv pe sine) cu un % din HP-ul lui maxim. % crește cu rangul.',
    params: {
      tier: 1, cooldown: 4, manaCost: 40,
      range: 180,     // how far it reaches an ally
      healPct: 15,    // % of the target's MAX hp restored (auto-scales with rank)
      // Explicit per-rank heal (% of MAX hp). 0 = use the auto-scaled healPct
      // above for that rank; set one to override the exact heal at that level.
      healPct1: 0, healPct2: 0, healPct3: 0,
    },
  },
  divineshield: {
    name: 'Divine Shield',
    kind: 'active',
    color: '#fff2b0',
    desc: 'Paladinul devine invulnerabil câteva secunde când e rănit. Durata crește cu rangul.',
    params: {
      tier: 1, cooldown: 18, manaCost: 60,
      duration: 2,    // seconds of invulnerability (scales with rank)
      threshold: 55,  // casts when the Paladin drops below this % HP
    },
  },
  devotionaura: {
    name: 'Devotion Aura',
    kind: 'passive', // always-on aura while the Paladin lives (not cast)
    color: '#9ecbff',
    desc: 'Pasiv: aliații din jurul Paladinului primesc mai puțin damage. Reducerea crește cu rangul.',
    params: {
      tier: 1,
      radius: 160,     // aura radius
      dmgReduce: 15,   // % less damage taken by allies inside (scales with rank)
    },
  },
  holynova: {
    name: 'Holy Nova',
    kind: 'active', // ultimate
    color: '#fff6cf',
    desc: 'Ultima: Paladinul devine invulnerabil și toți aliații din jur se vindecă foarte rapid câteva secunde.',
    params: {
      tier: 1, cooldown: 60, manaCost: 100,
      duration: 5,    // seconds of self-invuln + ally fast-heal
      radius: 200,    // ally heal radius
      hps: 60,        // HP/s regenerated by allies in range
    },
  },
};

// Every castable ability shares two animation-timing params, defaulted here so
// balance.json files that predate them keep the old feel:
//   castPrepare — seconds of wind-up ("Prepare spell") before the effect fires.
//                 Set to 0 for an INSTANT cast with no prepare frame (heroes).
//   castHold    — seconds held on the "Cast X" frame after the effect fires.
for (const ab of Object.values(ABILITIES)) {
  if (ab.kind === 'passive') continue; // passives never cast — no timing params
  if (ab.params.castPrepare === undefined) ab.params.castPrepare = 0.45;
  if (ab.params.castHold === undefined) ab.params.castHold = 0.4;
}

export const ABILITY_IDS = Object.keys(ABILITIES);
export const MAX_ABILITIES = 5; // per caster

// Labels for the editable params (admin "Abilities" page).
export const ABILITY_PARAM_LABELS = {
  tier: 'Tier necesar (1-3)',
  cooldown: 'Cooldown (s)',
  manaCost: 'Mana cost (per cast)',
  range: 'Cast range',
  radius: 'Effect radius',
  immunity: 'Immunity (s)',
  atkSlow: 'Attack slow (%)',
  moveSlow: 'Move slow (%)',
  haste: 'Attack haste (%)',
  moveHaste: 'Move haste (%)',
  hps: 'Regen (HP/s)',
  amount: 'Heal amount (HP)',
  damage: 'Damage',
  duration: 'Effect duration (s)',
  projectileSpeed: 'Projectile speed',
  castPrepare: 'Prepare/wind-up (s, 0 = fără)',
  castHold: 'Timp pe frame-ul de cast (s)',
  cleavePct: 'Cleave (% din damage)',
  dashSpeed: 'Viteză șarjă',
  stun: 'Stun la impact (s)',
  healPct: 'Heal (% din HP max, auto-scalat pe rang)',
  healPct1: 'Heal rang 1 (% HP max, 0 = auto)',
  healPct2: 'Heal rang 2 (% HP max, 0 = auto)',
  healPct3: 'Heal rang 3 (% HP max, 0 = auto)',
  dmgReduce: 'Reducere damage (%)',
  threshold: 'Prag HP pentru cast (%)',
  // summon params
  cap: 'Nr. maxim vii (0 = nelimitat)',
  life: 'Durată viață (s, 0 = nu dispare)',
  hp: 'HP animal',
  period: 'Perioadă atac (s)',
  speed: 'Viteză mișcare',
  animSpeed: 'Viteză animație mers (flip/s)',
  size: 'Mărime (%)',
  splash: 'Splash (rază, 0 = fără)',
  flying: 'Zboară (1/0)',
  projectile: 'Atac la distanță (1/0)',
  armored: 'Armură grea (1/0)',
};
