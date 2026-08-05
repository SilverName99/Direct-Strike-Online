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
    desc: 'Consumă mană ca să vindece instant aliatul cel mai rănit din apropiere.',
    descEn: 'Spends mana to instantly heal the most-wounded nearby ally.',
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
    desc: 'Curăță o zonă: aliații scapă de debuff-uri și primesc imunitate scurtă; inamicii își pierd buff-urile și nu pot primi altele noi.',
    descEn: 'Cleanses an area: allies lose debuffs and gain brief immunity; enemies lose buffs and cannot gain new ones.',
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
    desc: 'Ridică o zonă în care inamicii din jur atacă mai încet o vreme (Shaman).',
    descEn: 'Cast to raise a zone that makes nearby enemies attack slower for a duration (Shaman).',
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
    desc: 'Ridică o zonă în care aliații din jur atacă mai repede o vreme.',
    descEn: 'Cast to raise a zone that makes nearby allies attack faster for a duration.',
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
    desc: 'Ridică o zonă care regenerează aliații din jur o vreme (aura Preotului).',
    descEn: 'Cast to raise a zone that regenerates nearby allies for a duration (Priest aura).',
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
    descEn: 'Latches onto a single ally for a few seconds: faster attacks + reduced damage taken while the channel lasts. Drains mana per second, then moves on to another ally.',
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
    descEn: 'Plants a totem up front that slows nearby enemies (attack + movement) while it stands. It has HP and a timer.',
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
    descEn: 'Summons a fast wolf that fights alongside the shaman (unlocked at tier 1).',
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
    descEn: 'Summons a flying eagle (unlocked at tier 2).',
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
    descEn: 'Summons a massive, tough bear (unlocked at tier 3).',
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
    descEn: 'Ultimate: the hero turns into a stone Colossus for a few seconds — far more HP and damage, wide melee splash. The transformation has a wind-up frame and an exit frame, then the colossus appears.',
    params: {
      tier: 1, cooldown: 40, manaCost: 100,
      duration: 10,   // seconds transformed
      // The summoned form's stats are ABSOLUTE, not bonuses — you type what the
      // colossus IS. 0 on any of them keeps the hero's own value.
      morphHp: 3000,     // max HP while morphed (0 = keep the hero's)
      morphDamage: 120,  // damage per hit while morphed (0 = keep the hero's)
      morphPeriod: 1.4,  // seconds between hits while morphed (0 = keep the hero's)
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
    descEn: 'Slams the ground: damage and a slow to every enemy around the hero.',
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
    descEn: 'War cry: your WHOLE army attacks and moves faster for a few seconds. (the Chieftain\'s ultimate)',
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
    desc: 'Un proiectil care rănește ținta și îi încetinește mișcarea și atacurile o vreme.',
    descEn: 'A projectile that damages the target and slows its movement and attacks for a duration.',
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
    descEn: 'Passive: every melee hit of the hero also strikes the enemies around his target (a % of the damage). Grows with rank.',
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
    descEn: 'The hero hurls himself at a distant enemy at high speed; on impact he deals damage and briefly stuns it. Cooldown.',
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
    descEn: 'Instantly heals the most-wounded nearby ally (himself included) for a % of its max HP. The % grows with rank.',
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
    descEn: 'The Paladin turns invulnerable for a few seconds when wounded. The duration grows with rank.',
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
    descEn: 'Passive: allies around the Paladin take less damage. The reduction grows with rank.',
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
    descEn: 'Ultimate: the Paladin turns invulnerable and every nearby ally heals very fast for a few seconds.',
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
    descEn: 'Teleports forward over a distance, jumping past the enemy line toward the casters. Pure repositioning (no damage).',
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
    descEn: 'Passive: the Sword Saint attacks faster and hits harder. Grows with rank.',
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
    descEn: 'Enters a stance for a few seconds: stands still and regenerates massive health. The duration and the regen grow with rank.',
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
    descEn: 'Ultimate: channels a vortex of light for a few seconds — massive AoE damage all around, immune to slows and stuns, walks through enemies.',
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
    descEn: 'A big ice projectile that bursts on impact: area damage, and a slow on EVERY enemy caught. The damage grows with rank (settable per rank).',
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
    name: 'Ice Chad Elemental',
    kind: 'summon',
    animal: 'waterelemental',
    animalName: 'Ice Chad Elemental',
    color: '#4aa3ff',
    desc: 'Invocă un elemental de apă care luptă în melee. HP-ul și damage-ul cresc cu rangul (setabile per rang).',
    descEn: 'Summons a water elemental that fights in melee. HP and damage grow with rank (settable per rank).',
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
    descEn: 'Passive: allies around her get extra mana regen, permanently. The amount grows with rank (settable per rank).',
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
    descEn: 'Ultimate: calls an ice storm over the enemy — a zone that deals damage per second and slows them for a few seconds.',
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
    descEn: 'Passive: while she has mana, every arrow applies poison (damage over time) and spends mana per shot. Out of mana → normal arrows. The poison strength grows with rank (settable per rank).',
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
    descEn: 'Channels onto an enemy: steals its life over time and heals herself with it. Both the steal and the heal grow with rank (settable per rank).',
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
    descEn: 'Raises a skeleton fighter from a nearby corpse (every unit leaves a corpse for a few seconds after dying). The skeleton\'s HP, damage and lifetime grow with rank.',
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
  // --- Necromancer (Undead unit 2) skeleton kit: three summon variants, each
  // unlocked by a bought upgrade. All share the team-wide skeleton cap (a
  // repeatable base upgrade). Skeletons have a limited lifetime (despawn).
  skeletonmelee: {
    name: 'Melee Skeleton',
    kind: 'summon',
    animal: 'skeleton',
    animalName: 'Schelet melee',
    color: '#cdd3da',
    desc: 'Necromancer: ridică un schelet MELEE dintr-un cadavru din apropiere. Se deblochează cu upgrade-ul „Melee Skeleton" (tier 1). Limitat de cap-ul de schelete (upgrade la Bază).',
    descEn: 'Necromancer: raises a MELEE skeleton from a nearby corpse. Unlocked by the "Melee Skeleton" upgrade (tier 1). Limited by the skeleton cap (Base upgrade).',
    params: {
      tier: 1, manaCost: 25, cooldown: 4,
      corpseRange: 220,
      life: 20,
      hp: 90, damage: 12, range: 28, period: 1.0, speed: 95,
      hpPerRank: 0, damagePerRank: 0,
      animSpeed: 5, size: 100,
      splash: 0, flying: 0, projectile: 0, armored: 0,
      targetsAir: 0, targetsGround: 1,
      castPrepare: 0,
    },
  },
  skeletonranged: {
    name: 'Ranged Skeleton',
    kind: 'summon',
    animal: 'skeletonranged',
    animalName: 'Schelet ranged',
    color: '#bcd0a8',
    desc: 'Necromancer: ridică un schelet RANGED (trage) dintr-un cadavru din apropiere. Se deblochează cu upgrade-ul „Ranged Skeleton" (tier 1). Limitat de cap-ul de schelete (upgrade la Bază).',
    descEn: 'Necromancer: raises a RANGED (shooting) skeleton from a nearby corpse. Unlocked by the "Ranged Skeleton" upgrade (tier 1). Limited by the skeleton cap (Base upgrade).',
    params: {
      tier: 1, manaCost: 30, cooldown: 4,
      corpseRange: 220,
      life: 20,
      hp: 70, damage: 11, range: 170, period: 1.2, speed: 90,
      hpPerRank: 0, damagePerRank: 0,
      animSpeed: 5, size: 100,
      splash: 0, flying: 0, projectile: 1, armored: 0,
      targetsAir: 1, targetsGround: 1,
      castPrepare: 0,
    },
  },
  skeletonbrothers: {
    name: 'Brothers Skeleton',
    kind: 'summon',
    animal: 'skeleton', // reuses the melee + ranged skeleton art (via those abilities)
    animalName: 'Frați schelete',
    color: '#e0c07a',
    desc: 'Necromancer: dintr-UN singur cadavru ridică un schelet melee ȘI unul ranged (statele lor vin din abilitățile Melee/Ranged Skeleton). Se deblochează cu upgrade-ul „Brothers Skeleton" (tier 2), doar dacă ai deja Melee + Ranged. Ocupă 2 din cap.',
    descEn: 'Necromancer: from ONE corpse raises a melee skeleton AND a ranged one (their stats come from the Melee/Ranged Skeleton abilities). Unlocked by the "Brothers Skeleton" upgrade (tier 2), only once you own Melee + Ranged. Takes 2 of the cap.',
    params: {
      tier: 2, manaCost: 45, cooldown: 6,
      corpseRange: 220,
      castPrepare: 0,
    },
  },
  // --- Molia (Undead, unitatea 10): depune un COCON care scoate larve una
  // câte una. Coconul stă pe loc, nu atacă, are HP și un cronometru: ucis nu mai
  // scoate nimic, expirat eclozează larvele rămase.
  cocoon: {
    name: 'Cocon',
    kind: 'summon',
    animal: 'cocoon',      // sprite-ul coconului stă pe molie: "cocoon-idle"
    animalName: 'Cocon',
    larva: 'larva',        // sprite-urile larvei, tot pe molie: "larva-walk/attack/die"
    cocoon: true,          // marchează ramura specială din releaseSpell
    castTwoPhase: true,    // cadrul 1 = molia se pregătește, cadrul 2 = depune coconul
    color: '#b18cff',
    desc: 'Molia depune un cocon pe loc: o pungă imobilă, cu viață proprie și cronometru, din care ies larve pe rând — câte una sau câte mai multe deodată, cum setezi. Dacă îl spargi, restul larvelor nu mai apar; dacă îl lași să expire, ultimele eclozează deodată. Larvele atacă de aproape și trăiesc puțin. Numărul total de larve, câte ies odată, intervalul dintre eclozări și viața coconului se setează mai jos.',
    descEn: 'The moth lays a cocoon in place: an immobile sac with its own health and timer, hatching larvae one by one — or several at once, as configured. Break it and the remaining larvae never appear; let it expire and the last ones hatch together. Larvae fight in melee and live briefly. Total larvae, hatch size, hatch interval and the cocoon\'s health are set below.',
    params: {
      tier: 3, manaCost: 60, cooldown: 25,
      castPrepare: 0.8,   // secunde pe cadrul 1 (molia se pregătește), înainte să apară coconul
      castHold: 0.8,      // secunde pe cadrul 2 (molia depune coconul), după ce apare
      cap: 1,             // coconi vii deodată per molie
      hp: 200,            // viața coconului
      life: 20,           // secunde până se deschide singur
      size: 100,          // mărimea coconului (%)
      larvae: 4,          // câte larve scoate în total
      larvaBatch: 1,      // câte ies DEODATĂ la fiecare eclozare (1 = una câte una)
      larvaInterval: 4,   // secunde între două eclozări
      hatchPose: 0.6,     // secunde pe frame-ul „se deschide” la fiecare larvă
      larvaLife: 12,      // cât trăiește o larvă
      larvaHp: 60, larvaDamage: 10, larvaRange: 26, larvaPeriod: 1, larvaSpeed: 95,
      larvaSize: 80, larvaDieSize: 0, larvaAnimSpeed: 6,
      larvaSplash: 0, larvaArmored: 0,
    },
  },
  // ---- Undead hero 3 (support): SOULS are his mana. The passive fills the bar,
  // every other ability spends it — he has no other source of energy.
  soulcollector: {
    name: 'Soul Collector',
    kind: 'passive',
    color: '#7ef2a8',
    desc: 'Pasiv: de fiecare dată când moare o unitate (a ta SAU a inamicului) în raza lui, un suflet zboară spre el și îi umple bara. Fără niciun punct investit ia 1 suflet per mort; fiecare punct urcă valoarea (2 / 3 / 4). Sufletele SUNT mana lui — toate celelalte abilități le consumă.',
    descEn: 'Passive: whenever a unit dies (yours OR the enemy\'s) inside his radius, a soul flies to him and fills his bar. With no points invested he takes 1 soul per death; each point raises it (2 / 3 / 4). Souls ARE his mana — every other ability spends them.',
    params: {
      radius: 550,   // morții din afara razei nu-i dau nimic
      souls1: 2, souls2: 3, souls3: 4, // per rang învățat (nelearnat = soulsBase)
      soulsBase: 1,  // cât ia doar pentru că e pe teren (fără puncte)
      heroSouls: 40, // un EROU mort valorează atât (indiferent de rang)
      summons: 1,    // 1 = și schelete/larve/lupi ucise contează (expirate — nu)
    },
  },
  undeadflag: {
    name: 'Undead Flag',
    kind: 'summon',   // stationary totem variant: a planted banner
    animal: 'flag',   // sprite prefix "flag-" hosted on the hero
    animalName: 'Steag',
    totem: true,
    color: '#a06cff',
    desc: 'Înfige stindardul în pământ: cât stă acolo, aliații din rază se VINDECĂ. Are viață proprie și cronometru — inamicul îl poate sparge. Costă suflete.',
    descEn: 'Plants the banner in the ground: while it stands, allies in its radius HEAL. It has its own health and a timer — the enemy can break it. Costs souls.',
    params: {
      tier: 1, manaCost: 35, cooldown: 20,
      cap: 1, life: 14,
      hp: 260,
      radius: 220,   // heal-aura radius
      healHps: 18,   // HP/s given to allies inside (grows per rank)
      healHps1: 0, healHps2: 0, healHps3: 0, // explicit per rank (0 = auto)
      size: 120,
      castPrepare: 0.3, castHold: 0.5,
    },
  },
  bonefield: {
    name: 'Bone Field',
    kind: 'active',
    color: '#e8e2c8',
    desc: 'Presară un câmp de oase pe pământ: inamicii care stau pe el ATACĂ mai încet și se MIȘCĂ mai încet. Nu poate fi distrus — se stinge singur. Costă suflete.',
    descEn: 'Scatters a field of bones on the ground: enemies standing on it ATTACK slower and MOVE slower. It cannot be destroyed — it fades on its own. Costs souls.',
    params: {
      tier: 1, manaCost: 45, cooldown: 16,
      range: 320,        // how far he can throw it
      radius: 200,       // the field on the ground
      duration: 8,       // seconds it stays
      atkSlow: 30,       // % slower attacks for enemies standing on it
      moveSlow: 35,      // % slower movement
      castPrepare: 0.35, castHold: 0.5,
    },
  },
  bonegiant: {
    name: 'Bone Giant',
    kind: 'summon',      // the ultimate: a huge melee construct
    animal: 'bonegiant',
    animalName: 'Gigant de oase',
    color: '#dcd6bd',
    desc: 'Ultima: ridică din oasele celor căzuți un gigant care luptă pentru tine. Mare, lent și greu de doborât. Costă un munte de suflete — apare abia după o măcelărie.',
    descEn: 'Ultimate: raises from the bones of the fallen a giant that fights for you. Big, slow and hard to bring down. Costs a mountain of souls — it appears only after a massacre.',
    params: {
      tier: 1, manaCost: 120, cooldown: 70,
      cap: 1, life: 25,
      hp: 1400, damage: 70, range: 40, period: 1.6, speed: 60,
      hpPerRank: 0, damagePerRank: 0, // ultimate = one rank
      splash: 60, armored: 1,
      size: 240, animSpeed: 2.5,
      castPrepare: 0.5, castHold: 0.8,
    },
  },
  soulharvest: {
    name: 'Soul Harvest',
    kind: 'active', // ultimate
    color: '#d14b8f',
    desc: 'Ultima: se transformă (mărime setabilă) câteva secunde — drenează toți inamicii dintr-o zonă (damage/s, care o vindecă și pe ea) și în același timp vindecă aliații din altă zonă (HP/s).',
    descEn: 'Ultimate: transforms (size settable) for a few seconds — drains every enemy in one zone (damage/s that also heals her) while healing the allies in another zone (HP/s).',
    params: {
      tier: 1, cooldown: 70, manaCost: 120,
      duration: 6,        // seconds the form lasts
      size: 160,          // % visual size while active
      drainRadius: 220, drainDps: 60, // damage/s to enemies (also heals her) — ult = 1 rank
      healRadius: 260, healHps: 40,   // HP/s to allies
      castPrepare: 0,
    },
  },
  acidpaste: {
    name: 'Acid Paste',
    kind: 'active',
    color: '#7fd44a',
    desc: 'Scuipă (consumă mană) o pastă verde care se lipește de pământ. Inamicii TERESTRI care stau pe ea primesc cu X% mai mult damage din orice sursă, cât timp sunt pe baltă (și puțin după). Se deblochează cu un upgrade — atașează abilitatea la o unitate marcată Caster.',
    descEn: 'Spits (spends mana) a green paste that sticks to the ground. GROUND enemies standing on it take X% more damage from any source while on the puddle (and briefly after). Unlocked by an upgrade — attach the ability to a unit marked Caster.',
    params: {
      tier: 1,
      manaCost: 30,
      cooldown: 6,
      range: 260,            // cast range — cea mai apropiată țintă inamică
      projectileSpeed: 340,  // viteza scuipatului
      damage: 0,             // damage direct la impact (0 = doar balta)
      pasteRadius: 90,       // raza bălții
      pasteDuration: 6,      // cât rămâne balta pe jos (s)
      ampPct: 30,            // +X% damage pentru cine stă pe ea (setabil)
      castPrepare: 0,
    },
  },
  // ---- Death Knight (Undead hero) kit ----
  execute: {
    name: 'Execute',
    kind: 'active',
    color: '#c0303a',
    desc: 'Secera un inamic sub un prag de viață: dacă ținta e sub X% HP, o execută instant. Merge pe unități normale, pe creaturile invocate de eroi (invocări/clone/schelete) ȘI pe eroii inamici — doar clădirile sunt imune. Pragul, cooldown-ul și raza sunt setabile; pragul crește pe rang.',
    descEn: 'Reaps an enemy below a health threshold: if the target is under X% HP, it dies instantly. Works on normal units, on hero creations (summons/clones/skeletons) AND on enemy heroes — only buildings are immune. Threshold, cooldown and radius are settable; the threshold grows per rank.',
    params: {
      tier: 1, manaCost: 40, cooldown: 8, range: 70,
      threshold: 15, // % HP: țintele sub acest prag pot fi executate (fallback/auto)
      threshold1: 0, threshold2: 0, threshold3: 0, // prag explicit pe rang (0 = auto)
      castPrepare: 0,
    },
  },
  reapcleave: {
    name: 'Reap Cleave',
    kind: 'passive',
    color: '#9b2d3a',
    desc: 'Pasiv: loviturile eroului taie în jur (splash %, ca la Cleave) ȘI îi dau viață înapoi — se vindecă cu X% din tot damage-ul dat. Splash-ul și X% cresc pe rang (setabile).',
    descEn: 'Passive: the hero\'s strikes cut all around (splash %, like Cleave) AND give life back — he heals for X% of all damage dealt. Splash and X% grow per rank (settable).',
    params: {
      cleavePct: 40, radius: 90,
      cleavePct1: 0, cleavePct2: 0, cleavePct3: 0, // splash explicit pe rang (0 = auto)
      lifestealPct: 15, // % din damage-ul dat, întors ca viață (crește pe rang)
      lifestealPct1: 0, lifestealPct2: 0, lifestealPct3: 0, // lifesteal explicit pe rang (0 = auto)
    },
  },
  vampiricaura: {
    name: 'Vampiric Aura',
    kind: 'passive',
    color: '#8a2e5a',
    desc: 'Aură: eroul ȘI aliații din jurul lui se vindecă cu X% din damage-ul pe care îl dau (la orice lovitură). Rază setabilă; X% crește pe rang. Se adună cu Reap Cleave.',
    descEn: 'Aura: the hero AND the allies around him heal for X% of the damage they deal (on every hit). Radius settable; X% grows per rank. Stacks with Reap Cleave.',
    params: {
      radius: 220,
      lifestealPct: 12, // % din damage-ul dat de fiecare aliat din rază (crește pe rang)
      lifestealPct1: 0, lifestealPct2: 0, lifestealPct3: 0, // lifesteal explicit pe rang (0 = auto)
    },
  },
  soullink: {
    name: 'Soul Link',
    kind: 'active', // ultimate
    color: '#6a3fb0',
    desc: 'Ultima: leagă până la N aliați aleatori din jur de erou (legături PERMANENTE, până moare aliatul). Cât e legat, damage-ul primit de erou se împarte: eroul ține doar X%, restul se împarte egal la aliații legați. Doar eroul e protejat. Re-cast alege alți N.',
    descEn: 'Ultimate: links up to N random nearby allies to the hero (PERMANENT links, until the ally dies). While linked, damage taken by the hero is split: he keeps only X%, the rest is shared equally among the linked allies. Only the hero is protected. Re-cast picks another N.',
    params: {
      tier: 1, cooldown: 45, manaCost: 100,
      radius: 260,   // zona din care alege aliați
      maxLinks: 5,   // câți aliați leagă
      heroPct: 20,   // % din damage pe care îl ține eroul (restul se împarte la aliați)
      castPrepare: 0,
    },
  },
  // ---- Shadow Assassin (Undead hero 2) kit — a half-rotten dagger assassin ----
  // Shadow Rush: cheaply become invisible + phase THROUGH the enemy line (no
  // collision) to reach the backline. One-way — he can't blink back (that's what
  // sets it apart from Backline Teleport). Untargetable while invisible.
  shadowrush: {
    name: 'Shadow Rush',
    kind: 'active',
    color: '#7a4fd0',
    // a single cast frame (the wind-up reuses the hero's shared "prepare" pose)
    desc: 'Se face invizibil și se năpustește prin inamici (fără coliziune) până în spatele liniei — un singur sens, nu se poate întoarce. Cât e invizibil nu poate fi țintit.',
    descEn: 'Turns invisible and rushes through the enemies (no collision) to behind their line — one way only, no coming back. While invisible he cannot be targeted.',
    params: {
      tier: 1, cooldown: 12, manaCost: 40,
      distance: 260,     // how far forward he slips (past the line, into the backline)
      rushSpeed: 360,    // px/s he moves while invisible (settable) — NOT a teleport
      stealth: 2.5,      // seconds invisible + untargetable after arriving
      castPrepare: 0.3, castHold: 0.3,
    },
  },
  // Vanish: become invisible and slip to the nearest enemy HERO (or, if there's
  // no hero, the enemy unit with the most HP), landing a single critical
  // backstab. One hit, then done.
  vanish: {
    name: 'Vanish',
    kind: 'active',
    color: '#5a3fa0',
    // a single cast frame (the wind-up reuses the hero's shared "prepare" pose)
    desc: 'Se face invizibil și se strecoară (mergând) spre cel mai apropiat erou inamic (dacă nu există erou, spre unitatea cu cea mai multă viață); când ajunge, dă un backstab critic — o singură lovitură. Cât e invizibil nu poate fi țintit și trece prin inamici.',
    descEn: 'Turns invisible and sneaks (walking) toward the nearest enemy hero (no hero → the unit with the most health); on arrival he lands a critical backstab — a single strike. While invisible he cannot be targeted and walks through enemies.',
    params: {
      tier: 1, cooldown: 10, manaCost: 45,
      range: 480,          // how far he can seek a target to slip toward
      approachSpeed: 300,  // move speed while slipping toward the target (invisible)
      strikeRange: 30,     // how close he gets before landing the backstab
      backstabPct: 300,    // backstab damage = X% of his attack damage (crește pe rang)
      backstabPct1: 0, backstabPct2: 0, backstabPct3: 0, // explicit per-rank (0 = auto)
      stealth: 1.5,        // seconds invisible after the strike
      castPrepare: 0.3, castHold: 0.3,
    },
  },
  // Umbre Gemene / Twin Shadows: summon 1/2/3 shadow clones (by rank) that copy
  // his attacks for a % of his damage. Timed illusions with low HP; they attack
  // the nearest enemy. (Drawn as shadowy copies of the hero — no new frames.)
  twinshadows: {
    name: 'Shadow clones',
    kind: 'active', // spawns clones (uses the hero's own sprites, shadow-tinted)
    color: '#6a4fb0',
    desc: 'Invocă clone de umbră (1/2/3 după rang) care îi copiază atacurile (% din damage-ul lui). Au viață puțină și durată limitată; atacă cel mai apropiat inamic.',
    descEn: 'Summons shadow clones (1/2/3 by rank) that copy his attacks (a % of his damage). They have little health and a limited lifetime; they attack the nearest enemy.',
    params: {
      tier: 1, cooldown: 16, manaCost: 50,
      clones: 1, clones1: 1, clones2: 2, clones3: 3, // number of clones by rank
      clonePct: 50,      // % of the hero's damage each clone deals (crește pe rang)
      clonePct1: 0, clonePct2: 0, clonePct3: 0,
      cloneHp: 60,       // clone HP (a fragile illusion; auto/fallback)
      cloneHp1: 0, cloneHp2: 0, cloneHp3: 0, // explicit per-rank clone HP (0 = auto)
      life: 12,          // seconds the clones live before fading
      castPrepare: 0, castHold: 0.4,
    },
  },
  // Ultimate — Lama Legăturilor / Binding Blade: channel X seconds, then become
  // INVINCIBLE for the rest of the duration and throw the dagger. It flies
  // through every enemy in radius, linking each with a purple tether. All the
  // damage he "absorbs" while invincible is tallied and — plus a settable base
  // damage — split among the linked enemies when the blade returns.
  daggerthrow: {
    name: 'Loves dagger',
    kind: 'active', // ultimate
    color: '#9a5fd0',
    castTwoPhase: true, // cast 1 = channel, cast 2 = throw + hold while flying
    desc: 'Ultima: canalizează, apoi devine invincibil și aruncă pumnalul. Lama pleacă de la erou și sare din inamic în inamic (cel mai apropiat pe rând) prin toți cei din rază, lăsând o sfoară mov din unitate în unitate; apoi se întoarce la erou. Tot damage-ul absorbit cât e invincibil se adună și, plus un base damage setabil, se împarte inamicilor loviți când lama se întoarce.',
    descEn: 'Ultimate: channels, then turns invincible and throws the dagger. The blade leaves the hero and leaps enemy to enemy (nearest first) through everyone in the radius, laying a purple thread from unit to unit; then it returns. All damage absorbed while invincible, plus a settable base damage, is split among the enemies struck when the blade returns.',
    params: {
      tier: 1, cooldown: 50, manaCost: 100,
      radius: 240,       // enemies inside are chained by the blade
      daggerSpeed: 420,  // px/s the blade travels along the chain (settable)
      daggerSize: 100,   // % visual size of the thrown blade (settable)
      baseDamage: 120,   // base damage split among the hit enemies (settable)
      castPrepare: 1,    // channel time (cast) before he throws & turns invincible
      castHold: 0.4,
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
  morphHp: 'HP (invocat)',
  morphDamage: 'Damage (invocat)',
  morphPeriod: 'Perioadă atac (s)',
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
  // Undead support hero (souls)
  souls1: 'Suflete per mort — rang 1',
  souls2: 'Suflete per mort — rang 2',
  souls3: 'Suflete per mort — rang 3',
  soulsBase: 'Suflete per mort fără niciun punct',
  heroSouls: 'Suflete pentru un EROU mort',
  summons: 'Numără și summon-urile ucise (1/0)',
  healHps: 'Vindecare (HP/s) pentru aliații din rază',
  healHps1: 'Vindecare rang 1 (HP/s, 0 = auto)',
  healHps2: 'Vindecare rang 2 (HP/s, 0 = auto)',
  healHps3: 'Vindecare rang 3 (HP/s, 0 = auto)',
  // Cocon (Molie): pouch + larvae
  larvae: 'Cocon: câte larve scoate în total',
  larvaBatch: 'Cocon: câte larve ies DEODATĂ (1 = una câte una)',
  larvaInterval: 'Cocon: interval între eclozări (s)',
  hatchPose: 'Cocon: timp pe frame-ul „se deschide” (s)',
  larvaLife: 'Larvă: durată viață (s, 0 = nu dispare)',
  larvaHp: 'Larvă: HP',
  larvaDamage: 'Larvă: damage',
  larvaRange: 'Larvă: rază atac (melee)',
  larvaPeriod: 'Larvă: perioadă atac (s)',
  larvaSpeed: 'Larvă: viteză mișcare',
  larvaSize: 'Larvă: mărime (%)',
  larvaDieSize: 'Larvă: mărime cadru „die" (%, 0 = ca larva vie)',
  larvaAnimSpeed: 'Larvă: viteză animație mers (flip/s)',
  larvaSplash: 'Larvă: splash (rază, 0 = fără)',
  larvaArmored: 'Larvă: armură grea (1/0)',
  // Acid Paste
  pasteRadius: 'Pastă: rază baltă',
  pasteDuration: 'Pastă: durată baltă (s)',
  ampPct: 'Pastă: +damage pe cine stă (%)',
  // Death Knight (Undead hero)
  threshold: 'Execute: prag HP (%) — de bază/auto (crește pe rang)',
  threshold1: 'Execute: prag HP rang 1 (%, 0 = auto)',
  threshold2: 'Execute: prag HP rang 2 (%, 0 = auto)',
  threshold3: 'Execute: prag HP rang 3 (%, 0 = auto)',
  cleavePct1: 'Cleave rang 1 (% din damage, 0 = auto)',
  cleavePct2: 'Cleave rang 2 (% din damage, 0 = auto)',
  cleavePct3: 'Cleave rang 3 (% din damage, 0 = auto)',
  lifestealPct1: 'Lifesteal rang 1 (%, 0 = auto)',
  lifestealPct2: 'Lifesteal rang 2 (%, 0 = auto)',
  lifestealPct3: 'Lifesteal rang 3 (%, 0 = auto)',
  lifestealPct: 'Lifesteal: % din damage-ul dat, întors ca viață (pe rang)',
  maxLinks: 'Soul Link: câți aliați leagă',
  heroPct: 'Soul Link: % damage ținut de erou (restul la aliați)',
  // Shadow Assassin (Undead hero 2)
  distance: 'Distanță (teleport/năpustire)',
  stealth: 'Invizibilitate (s)',
  backstabPct: 'Vanish: backstab (% din damage) — crește pe rang',
  backstabPct1: 'Vanish: backstab rang 1 (%, 0 = auto)',
  backstabPct2: 'Vanish: backstab rang 2 (%, 0 = auto)',
  backstabPct3: 'Vanish: backstab rang 3 (%, 0 = auto)',
  clones: 'Shadow clones: nr. clone (fallback/auto)',
  clones1: 'Shadow clones: nr. clone rang 1',
  clones2: 'Shadow clones: nr. clone rang 2',
  clones3: 'Shadow clones: nr. clone rang 3',
  clonePct: 'Shadow clones: % din damage-ul eroului (pe clonă)',
  clonePct1: 'Shadow clones: % damage rang 1 (0 = auto)',
  clonePct2: 'Shadow clones: % damage rang 2 (0 = auto)',
  clonePct3: 'Shadow clones: % damage rang 3 (0 = auto)',
  cloneHp: 'Shadow clones: HP clonă (fallback/auto)',
  cloneHp1: 'Shadow clones: HP clonă rang 1 (0 = auto)',
  cloneHp2: 'Shadow clones: HP clonă rang 2 (0 = auto)',
  cloneHp3: 'Shadow clones: HP clonă rang 3 (0 = auto)',
  approachSpeed: 'Vanish: viteză de apropiere (invizibil)',
  strikeRange: 'Vanish: rază de lovire (backstab)',
  rushSpeed: 'Shadow Rush: viteză de deplasare (invizibil)',
  daggerSpeed: 'Loves dagger: viteză pumnal (px/s)',
  daggerSize: 'Loves dagger: dimensiune pumnal (%)',
  baseDamage: 'Loves dagger: base damage (împărțit la loviți)',
};
