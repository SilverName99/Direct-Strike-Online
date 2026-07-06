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
    unit: '',   // which unit type this upgrade transforms (set in admin)
    params: {
      cost: 300,       // gold to buy from the base
      radius: 260,     // enters -> a ranged non-flying enemy triggers the charge
      dashSpeed: 720,  // charge speed toward the trigger
      dmDamage: 22,    // on-foot (dismounted) damage
      dmRange: 30,     // on-foot attack range
      dmPeriod: 0.8,   // on-foot attack period (s)
      dmSpeed: 95,     // on-foot move speed
    },
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES);

// Labels for the editable params (admin "Upgrades" page).
export const UPGRADE_PARAM_LABELS = {
  cost: 'Cost (aur, din Bază)',
  radius: 'Rază declanșare',
  dashSpeed: 'Viteză dash (charge)',
  dmDamage: 'Damage pe jos',
  dmRange: 'Rază atac pe jos',
  dmPeriod: 'Perioadă atac pe jos (s)',
  dmSpeed: 'Viteză mișcare pe jos',
};
