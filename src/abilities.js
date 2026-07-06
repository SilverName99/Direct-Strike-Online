// Ability catalog — the single source of truth for every castable ability.
// GLOBAL (shared by both races); which units *have* them is per-race unit
// config (the "Caster" checkbox + selection in the admin stats editor).
// Params are balanced from the admin "Abilități" page and stored in
// assets/balance.json under `abilities`.
//
// kind: 'aura'   — passive; while the caster lives it keeps refreshing a
//                  status effect on units inside `radius` (no cast anim).
//       'active' — auto-cast on cooldown when a valid trigger exists
//                  (plays the unit's uploaded cast frames, if any).
//
// Ability ids must stay lowercase-alphanumeric: they become sprite slot
// names (cast-<id>_0.png) and balance keys.

export const ABILITIES = {
  dispell: {
    name: 'Dispell',
    kind: 'active',
    color: '#ffe9a8',
    desc: 'Curăță o zonă: aliații pierd efectele negative și devin imuni o vreme; inamicii pierd buff-urile și nu pot primi altele.',
    params: {
      cooldown: 8,   // seconds between casts
      manaCost: 40,  // mana per cast
      range: 180,    // how far the caster can target
      radius: 90,    // cleansed area
      immunity: 3,   // seconds of debuff-immunity (allies) / buff-block (enemies)
    },
  },
  slowaura: {
    name: 'Aură de încetinire',
    kind: 'aura',
    color: '#7fb4ff',
    desc: 'Inamicii din rază atacă mai încet (aura Shamanului).',
    params: {
      radius: 140,
      atkSlow: 30,  // % slower attacks
      manaCost: 0,  // auras drain this per second (0 = free)
    },
  },
  hasteaura: {
    name: 'Aură de grabă',
    kind: 'aura',
    color: '#ffd35c',
    desc: 'Aliații din rază atacă mai repede.',
    params: {
      radius: 140,
      haste: 25,   // % faster attacks
      manaCost: 0, // auras drain this per second (0 = free)
    },
  },
  regenaura: {
    name: 'Aură de regenerare',
    kind: 'aura',
    color: '#58d68d',
    desc: 'Aliații din rază se vindecă în timp (aura Priest-ului).',
    params: {
      radius: 140,
      hps: 5,      // HP healed per second
      manaCost: 0, // auras drain this per second (0 = free)
    },
  },
  frostbolt: {
    name: 'Săgeată de gheață',
    kind: 'active',
    color: '#8fe3ff',
    desc: 'Proiectil care rănește ținta și îi încetinește mișcarea și atacul pentru o durată.',
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

// Romanian labels for the editable params (admin "Abilități" page).
export const ABILITY_PARAM_LABELS = {
  cooldown: 'Cooldown (s)',
  manaCost: 'Cost mană (aure: /s)',
  range: 'Rază de cast',
  radius: 'Rază de efect',
  immunity: 'Imunitate (s)',
  atkSlow: 'Încetinire atac (%)',
  moveSlow: 'Încetinire mișcare (%)',
  haste: 'Grabă atac (%)',
  hps: 'Vindecare (HP/s)',
  damage: 'Damage',
  duration: 'Durată efect (s)',
  projectileSpeed: 'Viteză proiectil',
};
