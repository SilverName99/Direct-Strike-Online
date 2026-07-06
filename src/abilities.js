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
      radius: 140,
      hps: 5,        // HP healed per second
      duration: 12,  // seconds the zone lasts after the cast
      manaCost: 30,  // mana per cast
    },
  },
  frostbolt: {
    name: 'Frost Bolt',
    kind: 'active',
    color: '#8fe3ff',
    projectile: true, // fires a projectile -> per-caster projectile image slot
    desc: 'A projectile that damages the target and slows its movement and attacks for a duration.',
    params: {
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
};

export const ABILITY_IDS = Object.keys(ABILITIES);
export const MAX_ABILITIES = 5; // per caster

// Labels for the editable params (admin "Abilities" page).
export const ABILITY_PARAM_LABELS = {
  cooldown: 'Cooldown (s)',
  manaCost: 'Mana cost (per cast)',
  range: 'Cast range',
  radius: 'Effect radius',
  immunity: 'Immunity (s)',
  atkSlow: 'Attack slow (%)',
  moveSlow: 'Move slow (%)',
  haste: 'Attack haste (%)',
  hps: 'Regen (HP/s)',
  amount: 'Heal amount (HP)',
  damage: 'Damage',
  duration: 'Effect duration (s)',
  projectileSpeed: 'Projectile speed',
};
