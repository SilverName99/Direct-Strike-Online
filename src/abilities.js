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
      maxTargets: 0, // heal at most N allies (the most-wounded); 0 = everyone
    },
  },
  // Totemic Shaman "attack": instead of hitting an enemy, it empowers an ally —
  // faster attacks + damage reduction for a few seconds. Set the unit's damage
  // low/0 and give it this ability so its "attack" is pure support.
  empower: {
    name: 'Empower',
    kind: 'active',
    color: '#ffd35c',
    // this ability REPLACES the unit's basic attack: while it stands in place
    // doing its job the renderer loops the two "Cast Empower" frames (no idle
    // frame between casts), paced by frame1Time / frame2Time.
    attackReplacing: true,
    // CHANNELED: the caster commits to ONE ally for `duration`, keeping it
    // buffed and draining `manaPerSec` mana each second; it only moves on to
    // another ally once the channel ends (duration up, mana out, or ally lost).
    channeled: true,
    desc: 'Se leagă de un singur aliat câteva secunde: atac mai rapid + damage redus primit, cât ține canalizarea. Consumă mană pe secundă și abia apoi trece la alt aliat.',
    params: {
      tier: 1, cooldown: 0, manaCost: 0,
      range: 170,
      haste: 30,      // % faster attacks on the ally
      dmgReduce: 25,  // % less damage the ally takes
      duration: 5,    // seconds the channel (and buff) lasts
      manaPerSec: 5,  // mana drained each second of channel; channel ends if mana runs out
      frame1Time: 0.4, // seconds held on "Cast Empower 1" (animation loop)
      frame2Time: 0.4, // seconds held on "Cast Empower 2" (animation loop)
      castPrepare: 0, // instant
    },
  },
  // Slowing Totem: plant a stationary totem in front that slows nearby enemies
  // (attack + move) while it lives. The totem has HP (killable) and a lifetime.
  slowingtotem: {
    name: 'Slowing Totem',
    kind: 'summon',   // reuses the summon spawner (stationary totem variant)
    animal: 'totem',  // sprite prefix "totem-" hosted on the caster
    animalName: 'Totem',
    totem: true,      // stationary aura totem: no move, no attack
    color: '#7fb4ff',
    desc: 'Plantează un totem în față care încetinește inamicii din jur (atac + mișcare) cât trăiește. Are HP și un timer.',
    params: {
      tier: 1, manaCost: 40, cooldown: 12,
      cap: 1, life: 10,          // one totem at a time; 10s lifetime
      hp: 120,                   // totem HP (can be destroyed early)
      radius: 150,               // slow-aura radius
      atkSlow: 30, moveSlow: 30, // % slower attacks / movement for enemies in range
      size: 120,                 // visual size (%)
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
      hpPerRank: 60,      // extra HP per rank learned above rank 1
      damagePerRank: 8,   // extra damage per rank learned above rank 1
      animSpeed: 8,   // walk frame flips per second
      size: 90,       // visual size (%)
      splash: 0, flying: 0, projectile: 0, armored: 0,
      targetsAir: 0, targetsGround: 1, // what it can attack (set air 1 / ground 0 for air-only)
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
      hpPerRank: 45,      // extra HP per rank learned above rank 1
      damagePerRank: 7,   // extra damage per rank learned above rank 1
      animSpeed: 8,
      size: 90,
      splash: 0, flying: 1, projectile: 0, armored: 0,
      targetsAir: 1, targetsGround: 1, // what it can attack (set ground 0 for air-only)
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
      hpPerRank: 160,     // extra HP per rank learned above rank 1
      damagePerRank: 15,  // extra damage per rank learned above rank 1
      animSpeed: 5,
      size: 120,
      splash: 0, flying: 0, projectile: 0, armored: 1,
      targetsAir: 0, targetsGround: 1, // what it can attack (set air 1 / ground 0 for air-only)
    },
  },
  // ULTIMATE (Beast Spirit Shaman): the shaman himself transforms into a giant
  // Stone Colossus for a few seconds — a giant juggernaut: much more HP +
  // damage, bigger, fights melee with wide splash. The transformation plays out
  // in two poses on the hero (Prepare -> Transform) before the beast bursts out;
  // uses its own uploaded sprite set ("morph-" prefix). Gated by hero level 6
  // (ultimate), so its `tier` stays 1.
  beastform: {
    name: 'Elemental Form',
    kind: 'active',
    color: '#ff8a3c',
    // two-phase transform: cast frame 1 = Prepare (wind-up, castPrepare secs),
    // cast frame 2 = Transform (emerging, castHold secs), then the beast sprites
    castTwoPhase: true,
    desc: 'Ultimate: eroul se transformă într-un Colos de piatră câteva secunde — mult mai mult HP și damage, lovește corp la corp cu splash lat. Transformarea are un frame de pregătire și unul de ieșire, apoi apare colosul.',
    params: {
      tier: 1, cooldown: 40, manaCost: 100,
      duration: 10,   // seconds transformed
      hpBonus: 150,   // % extra MAX hp while morphed
      dmgBonus: 80,   // % extra damage while morphed
      size: 200,      // % size (visual + hitbox) while morphed
      splash: 110,    // melee splash radius while morphed
      splashPct: 60,  // % of the hit dealt to nearby enemies (splash)
      range: 35,      // melee reach while morphed
      castPrepare: 0.5, // "Prepare" pose duration (wind-up before transforming)
      castHold: 0.5,    // "Transform" pose duration (emerging out of the prepare)
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
      duration1: 0, duration2: 0, duration3: 0, // explicit per-rank duration (0 = auto)
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
  // ---- Sword Saint (Human hero 2) kit — aggressive glass-cannon ----
  backlineteleport: {
    name: 'Backline Teleport',
    kind: 'active',
    color: '#8fe3ff',
    // two-phase: cast frame 1 = prepare (wind-up), cast frame 2 = land
    castTwoPhase: true,
    desc: 'Se teleportează în față pe o distanță, sărind peste linia inamică spre casteri. Repoziționare pură (fără damage).',
    params: {
      tier: 1, cooldown: 12, manaCost: 40,
      distance: 240,    // how far it blinks (forward to engage, backward to retreat)
      retreatHp: 35,    // % HP: at or below this the blink goes BACKWARD (retreat) instead of forward (0 = always forward)
      // explicit cooldown per learned rank (0 = use the base `cooldown` above)
      cooldown1: 0, cooldown2: 0, cooldown3: 0,
      castPrepare: 0.35, // "prepare" pose before the blink
      castHold: 0.35,    // "land" pose after arriving
    },
  },
  divinebuff: {
    name: 'Divine Buff',
    kind: 'passive', // always-on while learned (read in combat, not cast)
    color: '#ffd35c',
    desc: 'Pasiv: Sword Saint atacă mai repede și lovește mai puternic. Crește cu rangul.',
    params: {
      tier: 1,
      haste: 20,        // % faster attacks
      damageBonus: 25,  // % more attack damage
      // explicit values per learned rank (0 = auto-scale via rankStep)
      haste1: 0, haste2: 0, haste3: 0,
      damageBonus1: 0, damageBonus2: 0, damageBonus3: 0,
    },
  },
  divineregen: {
    name: 'Divine Regeneration',
    kind: 'active',
    color: '#58d68d',
    desc: 'Intră într-un stance câteva secunde: se oprește pe loc și regenerează masiv viață. Durata și regen-ul cresc cu rangul.',
    params: {
      tier: 1, cooldown: 20, manaCost: 50,
      hps: 70,        // HP/s regenerated while in the stance
      duration: 5,    // seconds the stance (and regen) lasts
      threshold: 50,  // only enters the stance at or below this % HP
      // explicit values per learned rank (0 = auto/base)
      hps1: 0, hps2: 0, hps3: 0,
      cooldown1: 0, cooldown2: 0, cooldown3: 0,
      castPrepare: 0, // instant entry into the stance
    },
  },
  vortexoflight: {
    name: 'Vortex of Light',
    kind: 'active', // ultimate
    color: '#fff2b0',
    desc: 'Ultima: canalizează un vârtej de lumină câteva secunde — damage AoE masiv în jur, imun la încetiniri și stun, se mișcă printre inamici.',
    params: {
      tier: 1, cooldown: 40, manaCost: 100,
      duration: 4,    // seconds the vortex spins
      radius: 130,    // AoE radius around the Sword Saint
      dps: 120,       // damage per second to enemies caught in the vortex
      size: 150,      // % visual size while spinning (100 = no change)
      castPrepare: 0, // instant
    },
  },

  // ---- Battle Mage (human hero, female, mounted caster) --------------------
  bigfrostbolt: {
    name: 'Bigger Frost Bolt',
    kind: 'active',
    color: '#7fd8ff',
    desc: 'Un proiectil mare de gheață care explodează la impact: damage într-o zonă și încetinește TOȚI inamicii prinși. Damage-ul crește cu rangul (setabil per rang).',
    params: {
      tier: 1, cooldown: 6, manaCost: 45,
      range: 340,        // cast range (how far she can throw it)
      damage: 60, damage1: 0, damage2: 0, damage3: 0, // explicit per-rank damage (0 = auto)
      radius: 90,        // splash radius of the burst
      moveSlow: 40,      // % movement slow on everyone caught
      duration: 3,       // seconds the slow lasts
      projectileSpeed: 420,
      castPrepare: 0.3,  // wind-up on the "prepare" frame
    },
  },
  waterelemental: {
    name: 'Water Elemental',
    kind: 'summon',
    animal: 'waterelemental',
    animalName: 'Water Elemental',
    color: '#4aa3ff',
    desc: 'Invocă un elemental de apă care luptă în melee. HP-ul și damage-ul cresc cu rangul (setabile per rang).',
    params: {
      tier: 1, manaCost: 60, cooldown: 12,
      cap: 1, life: 20,
      hp: 300, damage: 28, range: 30, period: 1.1, speed: 95,
      hpPerRank: 150,     // extra HP per rank learned above rank 1
      damagePerRank: 16,  // extra damage per rank learned above rank 1
      animSpeed: 5, size: 110,
      splash: 0, flying: 0, projectile: 0, armored: 0,
      targetsAir: 0, targetsGround: 1,
      castPrepare: 0.3,
    },
  },
  manaaura: {
    name: 'Mana Regen Aura',
    kind: 'passive', // always on while she lives (like Devotion Aura) — no cast
    color: '#6f8bff',
    desc: 'Pasivă: aliații din jurul ei primesc mana regen extra, permanent. Cantitatea crește cu rangul (setabilă per rang).',
    params: {
      tier: 1,
      radius: 200,
      // mana GIVEN to allies per second, set per learned rank (not consumed —
      // it's a passive). `manaGain` is the hidden base/fallback (no editor
      // label); the player only sees & sets the per-rank manaGain1/2/3.
      manaGain: 5, manaGain1: 5, manaGain2: 8, manaGain3: 12,
    },
  },
  blizzard: {
    name: 'Blizzard',
    kind: 'active', // ultimate
    color: '#aee8ff',
    desc: 'Ultima: cheamă o furtună de gheață peste inamici — o zonă care face damage pe secundă și îi încetinește câteva secunde.',
    params: {
      tier: 1, cooldown: 60, manaCost: 120,
      radius: 160,       // storm radius
      dps: 90,           // damage/s (ultimate = a single rank)
      moveSlow: 45,      // % movement slow inside the storm
      duration: 5,       // seconds the storm lasts
      range: 500,        // how far she can drop the storm
      castPrepare: 0.4,
    },
  },

  // ---- Spirit Huntress (orc hero, female, ranger/mage) --------------------
  poisonarrow: {
    name: 'Poison Arrow',
    kind: 'passive', // always on: each arrow poisons AND costs mana per shot
    color: '#8fd04a',
    desc: 'Pasivă: cât are mana, fiecare săgeată aplică poison (damage-over-time) și consumă mana per tragere. Fără mana → săgeți normale. Puterea otrăvii crește cu rangul (setabilă per rang).',
    params: {
      tier: 1,
      manaPerShot: 6,     // mana spent per poisoned arrow (0 = free)
      dps: 12, dps1: 0, dps2: 0, dps3: 0, // poison damage/s applied on hit (per-rank)
      dotDuration: 3,     // how long each poison stack lasts on a struck target
    },
  },
  lifedrain: {
    name: 'Life Drain',
    kind: 'active',
    color: '#c94ccb',
    desc: 'Canalizează asupra unui inamic: îi fură viață în timp și se vindecă pe ea. Cât fură și cât primește cresc cu rangul (setabile per rang).',
    params: {
      tier: 1, cooldown: 10, manaCost: 20,
      range: 260,
      duration: 3,        // seconds the channel lasts
      drainPerSec: 40, drainPerSec1: 0, drainPerSec2: 0, drainPerSec3: 0, // damage/s to the target
      healPerSec: 30, healPerSec1: 0, healPerSec2: 0, healPerSec3: 0,     // HP/s she regains
      manaPerSec: 6,      // mana drained per second while channeling
      castPrepare: 0,
    },
  },
  risedead: {
    name: 'Rise Dead',
    kind: 'summon',
    animal: 'skeleton',
    animalName: 'Schelet',
    color: '#b8c0c8',
    desc: 'Ridică un schelet-luptător dintr-un cadavru din apropiere (orice unitate lasă un cadavru câteva secunde după ce moare). HP-ul, damage-ul și durata scheletului cresc cu rangul.',
    params: {
      tier: 1, manaCost: 35, cooldown: 6,
      corpseRange: 220,   // how far she can reach a corpse to raise
      corpseLife: 8,      // seconds a 1×1-unit corpse stays raisable after death
      corpseSize: 100,    // % size of the 1×1 corpse decal on the ground
      corpseOpacity: 100, // % opacity of the 1×1 corpse decal (100 = opac)
      corpseBigLife: 8,      // seconds a big-unit (>1×1) corpse stays raisable
      corpseBigSize: 130,    // % size of the big-unit corpse decal
      corpseBigOpacity: 100, // % opacity of the big-unit corpse decal
      cap: 3, life: 15,   // skeleton lifetime (scales per rank)
      hp: 120, damage: 16, range: 28, period: 1.1, speed: 95,
      hpPerRank: 60, damagePerRank: 8,
      animSpeed: 5, size: 100,
      splash: 0, flying: 0, projectile: 0, armored: 0,
      targetsAir: 0, targetsGround: 1,
      castPrepare: 0,
    },
  },
  soulharvest: {
    name: 'Soul Harvest',
    kind: 'active', // ultimate
    color: '#d14b8f',
    desc: 'Ultima: se transformă (mărime setabilă) câteva secunde — drenează toți inamicii dintr-o zonă (damage/s, care o vindecă și pe ea) și în același timp vindecă aliații din altă zonă (HP/s).',
    params: {
      tier: 1, cooldown: 70, manaCost: 120,
      duration: 6,        // seconds the form lasts
      size: 160,          // % visual size while active
      drainRadius: 220, drainDps: 60, // damage/s to enemies (also heals her) — ult = 1 rank
      healRadius: 260, healHps: 40,   // HP/s to allies
      castPrepare: 0,
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
// Per-ability rank scaling (how much each learned point boosts the "power" params):
// exposed on EVERY ability (incl. passives) so it's tunable in the balance editor.
// 0.5 = +50% per rank above rank 1 (the classic default); 0 = flat, no scaling.
for (const ab of Object.values(ABILITIES)) {
  if (ab.params.rankStep === undefined) ab.params.rankStep = 0.5;
}
// Per-rank explicit overrides: a param `X` may be pinned at each rank via
// `X1`/`X2`/`X3` (0 = keep the auto/base value). Precompute, per ability, which
// base params have such fields so abParams can apply them cheaply.
for (const ab of Object.values(ABILITIES)) {
  const bases = new Set();
  for (const k of Object.keys(ab.params)) {
    const m = /^(.+?)([123])$/.exec(k);
    if (m && ab.params[m[1]] !== undefined) bases.add(m[1]);
  }
  ab.rankOverrides = [...bases];
}

export const ABILITY_IDS = Object.keys(ABILITIES);
export const MAX_ABILITIES = 5; // per caster

// Labels for the editable params (admin "Abilities" page).
export const ABILITY_PARAM_LABELS = {
  tier: 'Tier necesar (1-3)',
  rankStep: 'Scalare per punct (0.5 = +50%/rang, 0 = fără)',
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
  maxTargets: 'Max ținte vindecate (0 = toți)',
  hpBonus: 'Elemental Form: +HP max (%)',
  dmgBonus: 'Elemental Form: +damage (%)',
  splashPct: 'Elemental Form: splash (% din lovitură)',
  healPct: 'Heal (% din HP max, auto-scalat pe rang)',
  healPct1: 'Heal rang 1 (% HP max, 0 = auto)',
  healPct2: 'Heal rang 2 (% HP max, 0 = auto)',
  healPct3: 'Heal rang 3 (% HP max, 0 = auto)',
  dmgReduce: 'Reducere damage (%)',
  distance: 'Distanță teleport',
  retreatHp: 'Prag retragere (% HP, 0 = mereu în față)',
  damageBonus: 'Damage bonus (%)',
  dps: 'Damage pe secundă (AoE)',
  // explicit per-rank values (0 = auto/base). Shown next to their base param.
  cooldown1: 'Cooldown rang 1 (s, 0 = auto)',
  cooldown2: 'Cooldown rang 2 (s, 0 = auto)',
  cooldown3: 'Cooldown rang 3 (s, 0 = auto)',
  haste1: 'Attack haste rang 1 (%, 0 = auto)',
  haste2: 'Attack haste rang 2 (%, 0 = auto)',
  haste3: 'Attack haste rang 3 (%, 0 = auto)',
  damageBonus1: 'Damage bonus rang 1 (%, 0 = auto)',
  damageBonus2: 'Damage bonus rang 2 (%, 0 = auto)',
  damageBonus3: 'Damage bonus rang 3 (%, 0 = auto)',
  hps1: 'Regen rang 1 (HP/s, 0 = auto)',
  hps2: 'Regen rang 2 (HP/s, 0 = auto)',
  hps3: 'Regen rang 3 (HP/s, 0 = auto)',
  duration1: 'Durată rang 1 (s, 0 = auto)',
  duration2: 'Durată rang 2 (s, 0 = auto)',
  duration3: 'Durată rang 3 (s, 0 = auto)',
  damage1: 'Damage rang 1 (0 = auto)',
  damage2: 'Damage rang 2 (0 = auto)',
  damage3: 'Damage rang 3 (0 = auto)',
  dps1: 'Damage/s rang 1 (0 = auto)',
  dps2: 'Damage/s rang 2 (0 = auto)',
  dps3: 'Damage/s rang 3 (0 = auto)',
  manaGain1: 'Mana regen/s rang 1 (dată aliaților)',
  manaGain2: 'Mana regen/s rang 2',
  manaGain3: 'Mana regen/s rang 3',
  // Spirit Huntress kit
  manaPerShot: 'Mana pe săgeată otrăvită',
  dotDuration: 'Durată poison pe lovitură (s)',
  drainPerSec: 'HP furat/s (de la țintă)',
  drainPerSec1: 'HP furat/s rang 1 (0 = auto)',
  drainPerSec2: 'HP furat/s rang 2 (0 = auto)',
  drainPerSec3: 'HP furat/s rang 3 (0 = auto)',
  healPerSec: 'HP primit/s (de ea)',
  healPerSec1: 'HP primit/s rang 1 (0 = auto)',
  healPerSec2: 'HP primit/s rang 2 (0 = auto)',
  healPerSec3: 'HP primit/s rang 3 (0 = auto)',
  corpseRange: 'Rază cadavru (Rise Dead)',
  corpseLife: 'Cât rămâne cadavrul 1×1 (s)',
  corpseSize: 'Mărime cadavru 1×1 (%)',
  corpseOpacity: 'Transparență cadavru 1×1 (%) — 100 = opac',
  corpseBigLife: 'Cât rămâne cadavrul mare (s)',
  corpseBigSize: 'Mărime cadavru mare (%)',
  corpseBigOpacity: 'Transparență cadavru mare (%) — 100 = opac',
  drainRadius: 'Rază dren inamici (Soul Harvest)',
  drainDps: 'Damage/s dren (o vindecă și pe ea)',
  healRadius: 'Rază heal aliați (Soul Harvest)',
  healHps: 'HP/s heal aliați',
  manaPerSec: 'Mana pe secundă (canalizare)',
  frame1Time: 'Timp pe Cast 1 (s)',
  frame2Time: 'Timp pe Cast 2 (s)',
  threshold: 'Prag HP pentru cast (%)',
  // summon params
  cap: 'Nr. maxim vii (0 = nelimitat)',
  life: 'Durată viață (s, 0 = nu dispare)',
  hp: 'HP animal',
  hpPerRank: 'HP în plus / rang (peste rang 1)',
  damagePerRank: 'Damage în plus / rang (peste rang 1)',
  period: 'Perioadă atac (s)',
  speed: 'Viteză mișcare',
  animSpeed: 'Viteză animație mers (flip/s)',
  size: 'Mărime (%)',
  splash: 'Splash (rază, 0 = fără)',
  flying: 'Zboară (1/0)',
  projectile: 'Atac la distanță (1/0)',
  armored: 'Armură grea (1/0)',
  targetsAir: 'Atacă aerul (1/0)',
  targetsGround: 'Atacă solul (1/0)',
};
