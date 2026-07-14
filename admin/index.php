<?php
// Direct Strike Online — sprite admin.
// First visit: set a password (stored as a hash in admin/config.php,
// which is gitignored so deploys never touch it).
//
// Art is organized per RACE. Each unit has: a shop thumbnail, plus
// idle×2, walk×2, attack×2 and die×1 frames. Buildings (main base,
// turret, tower, generator, wall) have: thumbnail + idle×2.
// The game picks uploads up automatically and falls back to the built-in
// vector art wherever an image is missing.

declare(strict_types=1);
session_start();

define('DS_ADMIN', 1);

const RACES = ['humans', 'orcs'];
const UNIT_LIST = ['grunt', 'slinger', 'bruiser', 'lancer', 'crab', 'mender', 'dasher', 'wasp', 'archon'];
// Heroes are units too (sprites/portrait), but live on their own admin tab and
// are NOT part of the shop order.
const HERO_LIST = ['hero'];
const BUILDING_LIST = ['main', 'turret', 'tower', 'generator', 'wall', 'bldg1', 'bldg2', 'bldg3', 'farm'];
// ranged units (projectile:true in units.js) can upload a projectile image
const PROJECTILE_UNITS = ['slinger', 'lancer', 'crab', 'wasp', 'archon'];
// armed buildings fire, so they get attack frames + a projectile image
const ARMED_BUILDINGS = ['turret', 'tower'];
// upgrades of kind 'mount' (see src/upgrades.js) transform a unit into an
// on-foot form, so ONLY these grant the extra "foot-" sprite set. Other
// upgrade kinds (e.g. 'ground' = Attack ground units) need no new sprites.
const DISMOUNT_UPGRADES = ['dashmount'];
// upgrades of kind 'acid' (Acid Spit) — grant two extra "acid" attack frames
const ACID_UPGRADES = ['acidspit'];
// upgrades of kind 'fire' (Fireball) — grant a "fire-" walk + attack set and a
// dedicated fireball projectile
const FIRE_UPGRADES = ['fireball'];
// upgrades of kind 'shield' (Scut de lumină) — grant one "shield" activation frame
const SHIELD_UPGRADES = ['lightshield'];
// upgrades of kind 'split' (Landing Split) — the unit splits into rider +
// beast, so it gets BOTH the "foot-" (rider on foot) and "beast-" sprite sets
const SPLIT_UPGRADES = ['splitmount'];
// ability catalog (mirrors src/abilities.js): id => [name, hasCastAnim, hasProjectile]
// — every aura is now cast (a "Cast X" frame, then the zone persists for its
// duration); projectile abilities also get a per-caster projectile image slot
const ABILITY_INFO = [
  'heal' => ['Heal', true, false],
  'dispell' => ['Dispel', true, false],
  'slowaura' => ['Slow Aura', true, false],
  'hasteaura' => ['Haste Aura', true, false],
  'regenaura' => ['Regeneration Aura', true, false],
  'frostbolt' => ['Frost Bolt', true, true],
  'summonwolf' => ['Invocă Lup', true, false],
  'summoneagle' => ['Invocă Vultur', true, false],
  'summonbear' => ['Invocă Urs', true, false],
  // Chieftain (Orc hero) kit
  'warstomp' => ['War Stomp', true, false],
  'bloodlust' => ['Bloodlust', true, false],
];
// summon abilities -> the animal sprite prefix hosted on the caster unit
const SUMMON_ANIMALS = ['summonwolf' => 'wolf', 'summoneagle' => 'eagle', 'summonbear' => 'bear'];
const SUMMON_LABELS = ['wolf' => 'Lup', 'eagle' => 'Vultur', 'bear' => 'Urs'];
// per-race hero default kit (kept in sync with src/ui/balance.js) — used until
// the hero's abilities are saved from admin, so the Eroi tab shows cast slots.
const HERO_DEFAULT_KITS = ['orcs' => ['warstomp', 'bloodlust'], 'humans' => []];
// upgrade catalog (mirrors src/upgrades.js): id => name
const UPGRADE_INFO = [
  'dashmount' => 'Dashing & Fleeing mount',
  'groundattack' => 'Attack ground units',
  'acidspit' => 'Acid Spit',
  'fireball' => 'Bile de foc',
  'lightshield' => 'Scut de lumină',
  'aoedamage' => 'AoE Damage',
  'splitmount' => 'Landing Split: beast & rider',
  'focusbuilding' => 'Focus building',
];
// GLOBAL command-card icon keys (assets/units/icons/<key>.png)
function iconKeys(): array {
  $keys = [];
  foreach (ABILITY_INFO as $id => $_) $keys["ability-$id"] = ABILITY_INFO[$id][0];
  foreach (UPGRADE_INFO as $id => $name) $keys["upgrade-$id"] = $name;
  // building command-card page toggle buttons (units <-> upgrades) + sell
  $keys['bldg-upgrades'] = 'Buton „Upgrade-uri" (clădire)';
  $keys['bldg-units'] = 'Buton „Unități" (clădire)';
  $keys['sell'] = 'Buton „Vinde"';
  return $keys;
}
// per-race shop tab buttons (UNITS / CLĂDIRI) — tab-<slot>.png in the race dir
const TAB_SLOTS = ['units' => 'Buton UNITS', 'buildings' => 'Buton CLĂDIRI'];

// Saved balance (cached per request) — lets the sprite page know a unit's
// caster config so it can show the matching cast / projectile slots.
function dsBalance(): array {
  static $bal = null;
  if ($bal === null) {
    $f = dirname(__DIR__) . '/assets/balance.json';
    $bal = is_file($f) ? (json_decode(file_get_contents($f), true) ?: []) : [];
  }
  return $bal;
}
// Units in this race's admin-defined shop order (falls back to roster order);
// unknown/missing ids are dropped/appended so it stays valid.
function orderedUnits(string $race): array {
  $ord = dsBalance()['unitOrder'] ?? null;
  // per-race object, or a legacy flat array applied to both races
  $saved = is_array($ord) ? ($ord[$race] ?? (isset($ord[0]) ? $ord : null)) : null;
  if (!is_array($saved)) return UNIT_LIST;
  $out = [];
  foreach ($saved as $id) if (in_array($id, UNIT_LIST, true) && !in_array($id, $out, true)) $out[] = $id;
  foreach (UNIT_LIST as $id) if (!in_array($id, $out, true)) $out[] = $id;
  return $out;
}
function unitCfg(string $race, string $ent): ?array {
  return dsBalance()['races'][$race]['units'][$ent] ?? null;
}
function unitAbilities(string $race, string $ent): array {
  $u = unitCfg($race, $ent);
  // the hero's kit = its 3 skills + ultimate (its own admin fields); falls back
  // to the code default until saved, so its cast slots show on the Eroi tab
  if (in_array($ent, HERO_LIST, true)) {
    $list = [];
    if ($u) {
      if (isset($u['heroAbilities']) && is_array($u['heroAbilities'])) $list = $u['heroAbilities'];
      if (!empty($u['heroUltimate'])) $list[] = $u['heroUltimate'];
    }
    $list = array_values(array_filter($list, fn($a) => is_string($a) && $a !== '' && isset(ABILITY_INFO[$a])));
    return $list ?: (HERO_DEFAULT_KITS[$race] ?? []);
  }
  if (!$u || empty($u['caster']) || empty($u['abilities']) || !is_array($u['abilities'])) return [];
  return array_values(array_filter($u['abilities'], fn($a) => isset(ABILITY_INFO[$a])));
}
// Ranged = explicit admin flag if set, else the unit's built-in default.
function unitIsRanged(string $race, string $ent): bool {
  $u = unitCfg($race, $ent);
  if ($u && array_key_exists('ranged', $u)) return !empty($u['ranged']);
  return in_array($ent, PROJECTILE_UNITS, true);
}
function unitIsCaster(string $race, string $ent): bool {
  if (in_array($ent, HERO_LIST, true)) return true; // heroes always cast their kit
  $u = unitCfg($race, $ent);
  return $u && !empty($u['caster']);
}
function unitHasDash(string $race, string $ent): bool {
  $u = unitCfg($race, $ent);
  return $u && !empty($u['dash']);
}
// True when some upgrade transforms THIS race's unit into an on-foot
// (dismounted) form — it then gets a second "foot-" sprite set.
function unitHasDismount(string $race, string $ent): bool {
  return unitHasUpgradeKind($race, $ent, DISMOUNT_UPGRADES);
}
// True when this race's unit is targeted by an "Acid Spit" upgrade.
function unitHasAcid(string $race, string $ent): bool {
  return unitHasUpgradeKind($race, $ent, ACID_UPGRADES);
}
// True when this race's unit is targeted by a "Bile de foc" (Fireball) upgrade.
function unitHasFire(string $race, string $ent): bool {
  return unitHasUpgradeKind($race, $ent, FIRE_UPGRADES);
}
// True when this race's unit is targeted by a "Scut de lumină" upgrade.
function unitHasShield(string $race, string $ent): bool {
  return unitHasUpgradeKind($race, $ent, SHIELD_UPGRADES);
}
// True when this race's unit is targeted by a "Landing Split" upgrade.
function unitHasSplit(string $race, string $ent): bool {
  return unitHasUpgradeKind($race, $ent, SPLIT_UPGRADES);
}
// Shared: is $ent (this race) the target of any upgrade whose id is in $ids?
function unitHasUpgradeKind(string $race, string $ent, array $ids): bool {
  $ups = dsBalance()['upgrades'] ?? [];
  if (!is_array($ups)) return false;
  foreach ($ups as $id => $up) {
    if (!in_array($id, $ids, true)) continue;
    if (!is_array($up) || ($up['unit'] ?? '') !== $ent) continue;
    $upRace = $up['race'] ?? '';
    if ($upRace === '' || $upRace === $race) return true;
  }
  return false;
}
const MAX_BYTES = 1572864; // 1.5 MB
const BG_MAX_BYTES = 5242880; // 5 MB (backgrounds may be large)
const MUSIC_MAX_BYTES = 12582912; // 12 MB (background music tracks)
const MUSIC_EXTS = ['mp3', 'ogg', 'm4a', 'mp4'];
const PORTRAIT_VID_MAX_BYTES = 12582912; // 12 MB (per-unit idle portrait clip)
const PORTRAIT_VID_EXTS = ['mp4', 'webm']; // looping video shown in the portrait box
const CURSOR_MAX_BYTES = 1048576; // 1 MB (a mouse cursor image is small)
const CURSOR_EXTS = ['png', 'gif', 'cur', 'webp'];
const BARSKIN_EXTS = ['png', 'webp', 'jpg', 'jpeg']; // bottom-bar background design

// The uploaded background-music file for a race (music.<ext>), or null.
function musicFileFor(string $assetsDir, string $race): ?string {
  foreach (MUSIC_EXTS as $e) if (is_file("$assetsDir/$race/music.$e")) return "music.$e";
  return null;
}

// A gold-mine idle CLIP (mp4/webm) played on the map: which ∈ {mineidle,
// workeridle} → <race>/generator/<which>.<ext>, or null.
const MINE_VID_WHICH = ['mineidle', 'workeridle'];
function mineVidFileFor(string $assetsDir, string $race, string $which): ?string {
  foreach (PORTRAIT_VID_EXTS as $e) if (is_file("$assetsDir/$race/generator/$which.$e")) return "$which.$e";
  return null;
}

// A per-tier tower CLIP (mp4/webm) shown in the portrait box when the tower is
// selected: which ∈ {tier1,tier2,tier3} → <race>/tower/<which>.<ext>, or null.
const TOWER_VID_WHICH = ['tier1', 'tier2', 'tier3'];
function towerVidFileFor(string $assetsDir, string $race, string $which): ?string {
  foreach (PORTRAIT_VID_EXTS as $e) if (is_file("$assetsDir/$race/tower/$which.$e")) return "$which.$e";
  return null;
}

// A unit's uploaded idle portrait clip (<ent>/portrait<suffix>.<ext>), or
// null. Suffix '' = the whole unit, '-foot' = the rider on foot (after a
// dismount / split), '-beast' = the split-off mount.
function portraitVidFileFor(string $assetsDir, string $race, string $ent, string $suffix = ''): ?string {
  foreach (PORTRAIT_VID_EXTS as $e) if (is_file("$assetsDir/$race/$ent/portrait$suffix.$e")) return "portrait$suffix.$e";
  return null;
}

// The portrait-clip slots this unit can have: suffix => label. The on-foot and
// beast forms exist only when an upgrade actually creates those forms.
function portraitVidVariants(string $race, string $ent): array {
  $v = ['' => 'Animație portret (mp4/webm) — apare lângă statusuri'];
  if (unitHasDismount($race, $ent) || unitHasSplit($race, $ent)) $v['-foot'] = 'Animație portret — călărețul PE JOS';
  if (unitHasSplit($race, $ent)) $v['-beast'] = 'Animație portret — BESTIA';
  // a summoned animal (Shaman) can have its own portrait clip, hosted here
  $ua = unitAbilities($race, $ent);
  foreach (SUMMON_ANIMALS as $aid => $animal) {
    if (in_array($aid, $ua, true)) $v["-$animal"] = 'Animație portret — ' . SUMMON_LABELS[$animal];
  }
  return $v;
}

// The uploaded custom-cursor file for a race (cursor.<ext>), or null.
function cursorFileFor(string $assetsDir, string $race): ?string {
  foreach (CURSOR_EXTS as $e) if (is_file("$assetsDir/$race/cursor.$e")) return "cursor.$e";
  return null;
}

// A GLOBAL command-card icon file (assets/units/icons/<key>.<ext>), or null.
function iconFileFor(string $assetsDir, string $key): ?string {
  foreach (CURSOR_EXTS as $e) if (is_file("$assetsDir/icons/$key.$e")) return "$key.$e";
  return null;
}

// A GLOBAL middle-of-map strip variant (assets/units/middle-<n>.png, n=1..3) —
// shared, not per race; drawn over the seam so the center blends. One is picked
// at random each match. Slot 1 falls back to the legacy middle.png. Null if none.
const MIDDLE_SLOTS = [1, 2, 3];
function middleFileFor(string $assetsDir, int $n): ?string {
  if (is_file("$assetsDir/middle-$n.png")) return "middle-$n.png";
  if ($n === 1 && is_file("$assetsDir/middle.png")) return 'middle.png'; // legacy single upload
  return null;
}

// A race's shop tab-button file (tab-<slot>.<ext>), or null.
function tabFileFor(string $assetsDir, string $race, string $slot): ?string {
  foreach (CURSOR_EXTS as $e) if (is_file("$assetsDir/$race/tab-$slot.$e")) return "tab-$slot.$e";
  return null;
}

// A race's base tier-upgrade icon (baseupgrade.<ext>), or null.
function baseUpgFileFor(string $assetsDir, string $race): ?string {
  foreach (CURSOR_EXTS as $e) if (is_file("$assetsDir/$race/baseupgrade.$e")) return "baseupgrade.$e";
  return null;
}

// A race's uploaded bottom-bar background design (barskin.<ext>), or null.
function barskinFileFor(string $assetsDir, string $race): ?string {
  foreach (BARSKIN_EXTS as $e) if (is_file("$assetsDir/$race/barskin.$e")) return "barskin.$e";
  return null;
}

// A race's uploaded bottom-bar OVERLAY (barover.<ext>) — drawn over the UI.
function baroverFileFor(string $assetsDir, string $race): ?string {
  foreach (BARSKIN_EXTS as $e) if (is_file("$assetsDir/$race/barover.$e")) return "barover.$e";
  return null;
}

// slot id => label; slot files are "<slot>.png". $race matters only for
// units: casters gain 2 cast frames per selected ACTIVE ability.
function slotsFor(string $ent, string $race = 'humans'): array {
  if (in_array($ent, BUILDING_LIST, true)) {
    // the main base shows a distinct image per upgrade tier (1/2/3)
    if ($ent === 'main') {
      // the base can be given an attack (⚙ stats) — allow a projectile image too
      return ['thumb' => 'Thumb', 'tier_0' => 'Tier 1', 'tier_1' => 'Tier 2', 'tier_2' => 'Tier 3', 'projectile' => 'Proiectil'];
    }
    // the tower shows a distinct look per base tier (1/2/3): each tier has its
    // own idle (2) + attack (2) + die (1) + "tower at rest" (1) + campfire
    // soldiers (2) frames. The soldiers are a SEPARATE sprite drawn beside the
    // tower's base while it's idling for a long time.
    if ($ent === 'tower') {
      $slots = ['thumb' => 'Thumb'];
      foreach ([1, 2, 3] as $t) {
        $slots["tier{$t}-idle_0"]      = "T$t Idle 1";
        $slots["tier{$t}-idle_1"]      = "T$t Idle 2";
        $slots["tier{$t}-attack_0"]    = "T$t Attack 1";
        $slots["tier{$t}-attack_1"]    = "T$t Attack 2";
        $slots["tier{$t}-die_0"]       = "T$t Die";
        $slots["tier{$t}-camptower_0"] = "T$t Turn gol (la foc)";
        $slots["tier{$t}-camp_0"]      = "T$t Soldați foc 1";
        $slots["tier{$t}-camp_1"]      = "T$t Soldați foc 2";
      }
      $slots['projectile'] = 'Proiectil';
      return $slots;
    }
    // the wall shows a distinct idle look per base tier (1/2/3), 2 frames each
    if ($ent === 'wall') {
      $slots = ['thumb' => 'Thumb'];
      foreach ([1, 2, 3] as $t) {
        $slots["tier{$t}-idle_0"] = "T$t Idle 1";
        $slots["tier{$t}-idle_1"] = "T$t Idle 2";
      }
      return $slots;
    }
    $slots = ['thumb' => 'Thumb', 'idle_0' => 'Idle 1', 'idle_1' => 'Idle 2'];
    if (in_array($ent, ARMED_BUILDINGS, true)) {
      $slots['attack_0'] = 'Attack 1';
      $slots['attack_1'] = 'Attack 2';
      $slots['projectile'] = 'Proiectil';
    }
    // the gold generator can show little workers shuttling gold to the base:
    // 2 frames walking TO the mine (empty sack) + 2 walking back (full sack)
    if ($ent === 'generator') {
      $slots['worker-empty_0'] = 'Muncitor gol 1';
      $slots['worker-empty_1'] = 'Muncitor gol 2';
      $slots['worker-full_0'] = 'Muncitor plin 1';
      $slots['worker-full_1'] = 'Muncitor plin 2';
    }
    return $slots;
  }
  $caster = unitIsCaster($race, $ent);
  $isHero = in_array($ent, HERO_LIST, true);
  $slots = ['thumb' => 'Thumb', 'idle_0' => 'Idle 1', 'idle_1' => 'Idle 2', 'walk_0' => 'Walk 1', 'walk_1' => 'Walk 2'];
  if ($caster && !$isHero) {
    // regular caster: one shared wind-up pose + one release frame per action
    $slots['prepare_0'] = 'Prepare spell';
    $slots['attack_0'] = 'Attack';
  } else {
    // fighters — and heroes, who fight melee-first — use a full 2-frame attack
    // cycle (Attack 1 while winding up, Attack 2 after the hit). Heroes cast
    // instantly (no prepare frame); their per-ability "Cast …" slots stay below.
    $slots['attack_0'] = 'Attack 1';
    $slots['attack_1'] = 'Attack 2';
  }
  $slots['die_0'] = 'Die';
  // a unit dashes if its own Dash toggle is on OR a mount/split upgrade makes
  // it charge/dive
  if (unitHasDash($race, $ent) || unitHasDismount($race, $ent) || unitHasSplit($race, $ent)) $slots['dash_0'] = 'Dash';
  // on-foot (dismounted) sprite set: a mount upgrade puts the rider on foot,
  // and the Landing Split's rider fights on foot too
  if (unitHasDismount($race, $ent) || unitHasSplit($race, $ent)) {
    $slots['foot-thumb'] = 'Pe jos: Thumb';
    $slots['foot-idle_0'] = 'Pe jos: Idle 1';
    $slots['foot-idle_1'] = 'Pe jos: Idle 2';
    $slots['foot-walk_0'] = 'Pe jos: Walk 1';
    $slots['foot-walk_1'] = 'Pe jos: Walk 2';
    $slots['foot-attack_0'] = 'Pe jos: Attack 1';
    $slots['foot-attack_1'] = 'Pe jos: Attack 2';
    $slots['foot-die_0'] = 'Pe jos: Die';
  }
  // "Landing Split": the mount becomes its own unit — a full beast sprite set
  if (unitHasSplit($race, $ent)) {
    $slots['beast-thumb'] = 'Bestie: Thumb';
    $slots['beast-idle_0'] = 'Bestie: Idle 1';
    $slots['beast-idle_1'] = 'Bestie: Idle 2';
    $slots['beast-walk_0'] = 'Bestie: Walk 1';
    $slots['beast-walk_1'] = 'Bestie: Walk 2';
    $slots['beast-attack_0'] = 'Bestie: Attack 1';
    $slots['beast-attack_1'] = 'Bestie: Attack 2';
    $slots['beast-die_0'] = 'Bestie: Die';
  }
  // "Acid Spit" upgrade: two extra frames for the acid attack animation, plus
  // a dedicated acid projectile image
  if (unitHasAcid($race, $ent)) {
    $slots['acid_0'] = 'Acid 1';
    $slots['acid_1'] = 'Acid 2';
    $slots['acidproj'] = 'Proiectil acid';
  }
  // "Bile de foc" (Fireball) upgrade: a separate walk + attack sprite set for
  // the fire-loaded form, plus a dedicated fireball projectile image
  if (unitHasFire($race, $ent)) {
    $slots['fire-walk_0'] = 'Foc: Mers 1';
    $slots['fire-walk_1'] = 'Foc: Mers 2';
    $slots['fire-attack_0'] = 'Foc: Atac 1';
    $slots['fire-attack_1'] = 'Foc: Atac 2';
    $slots['fireproj'] = 'Proiectil foc';
  }
  // "Scut de lumină" upgrade: one activation frame (the light shield itself is
  // drawn procedurally by the game)
  if (unitHasShield($race, $ent)) {
    $slots['shield_0'] = 'Scut de lumină (activare)';
  }
  if (unitIsRanged($race, $ent)) $slots['projectile'] = 'Proiectil';
  // summoned animals (Shaman): a walk + attack + die set per assigned summon
  // ability, hosted on this unit under an "<animal>-" prefix
  $ua = unitAbilities($race, $ent);
  foreach (SUMMON_ANIMALS as $aid => $animal) {
    if (!in_array($aid, $ua, true)) continue;
    $lbl = SUMMON_LABELS[$animal];
    $slots["{$animal}-walk_0"] = "$lbl: Mers 1";
    $slots["{$animal}-walk_1"] = "$lbl: Mers 2";
    $slots["{$animal}-attack_0"] = "$lbl: Atac 1";
    $slots["{$animal}-attack_1"] = "$lbl: Atac 2";
    $slots["{$animal}-die_0"] = "$lbl: Die";
  }
  // one cast-release frame + per-ability projectile for each selected ability
  foreach (unitAbilities($race, $ent) as $aid) {
    [$name, $hasCast, $hasProj] = ABILITY_INFO[$aid];
    if ($hasCast) $slots["cast-{$aid}_0"] = "Cast {$name}";
    if ($hasProj) $slots["abilityproj-{$aid}"] = "Proiectil {$name}";
  }
  return $slots;
}

$configFile = __DIR__ . '/config.php';
$assetsDir = dirname(__DIR__) . '/assets/units';
$assetsUrl = '../assets/units';

$_SESSION['csrf'] = $_SESSION['csrf'] ?? bin2hex(random_bytes(16));
$csrf = $_SESSION['csrf'];
$msg = '';
$err = '';

$race = $_GET['race'] ?? $_POST['race'] ?? 'humans';
if (!in_array($race, RACES, true)) $race = 'humans';
// which top-level view of the sprites admin: per-race sprites, or the global
// ability/upgrade icon library
$view = ($_GET['view'] ?? '') === 'icons' ? 'icons' : 'sprites';

function checkCsrf(): bool {
  return hash_equals($_SESSION['csrf'], $_POST['csrf'] ?? '');
}

function regenManifest(string $assetsDir): void {
  $races = [];
  foreach (RACES as $r) {
    foreach (array_merge(UNIT_LIST, HERO_LIST, BUILDING_LIST) as $ent) {
      $slots = slotsFor($ent, $r);
      $entData = [];
      foreach ($slots as $slot => $label) {
        $exists = is_file("$assetsDir/$r/$ent/$slot.png");
        if ($slot === 'thumb' || $slot === 'foot-thumb' || $slot === 'beast-thumb' || $slot === 'projectile' || $slot === 'acidproj' || $slot === 'fireproj' || str_starts_with($slot, 'abilityproj-')) {
          if ($exists) $entData[$slot] = true; // single-image slots
        } else {
          [$anim, $frame] = explode('_', $slot);
          if (!isset($entData[$anim])) {
            $entData[$anim] = $anim === 'die' ? [false] : ($anim === 'tier' ? [false, false, false] : [false, false]);
          }
          if ($exists) $entData[$anim][(int)$frame] = true;
        }
      }
      // keep only anims that have at least one frame
      foreach ($entData as $k => $v) {
        if (is_array($v) && !in_array(true, $v, true)) unset($entData[$k]);
      }
      if ($entData) $races[$r][$ent] = $entData;
    }
  }
  $backgrounds = [];
  $music = [];
  $cursors = [];
  $tabs = [];
  $barskins = [];
  $barovers = [];
  $baseupg = [];
  $portraitvids = [];
  $minevids = [];
  $towervids = [];
  foreach (RACES as $r) {
    if (is_file("$assetsDir/$r/background.png")) $backgrounds[$r] = true;
    $mf = musicFileFor($assetsDir, $r);
    if ($mf) $music[$r] = $mf;
    $mv = [];
    foreach (MINE_VID_WHICH as $which) {
      $vf = mineVidFileFor($assetsDir, $r, $which);
      if ($vf) $mv[$which] = $vf;
    }
    if ($mv) $minevids[$r] = (object)$mv;
    $tv = [];
    foreach (TOWER_VID_WHICH as $which) {
      $vf = towerVidFileFor($assetsDir, $r, $which);
      if ($vf) $tv[$which] = $vf;
    }
    if ($tv) $towervids[$r] = (object)$tv;
    $pv = [];
    foreach (array_merge(UNIT_LIST, HERO_LIST) as $ent) {
      $forms = [];
      // every portrait-clip form this unit can have: base, foot, beast, and any
      // summoned-animal forms (wolf/eagle/bear) — keyed by the form name
      foreach (portraitVidVariants($r, $ent) as $suffix => $_label) {
        $key = $suffix === '' ? 'base' : ltrim($suffix, '-');
        $vf = portraitVidFileFor($assetsDir, $r, $ent, $suffix);
        if ($vf) $forms[$key] = $vf;
      }
      if ($forms) $pv[$ent] = (object)$forms;
    }
    if ($pv) $portraitvids[$r] = $pv;
    $cf = cursorFileFor($assetsDir, $r);
    if ($cf) $cursors[$r] = $cf;
    $t = [];
    foreach (array_keys(TAB_SLOTS) as $slot) {
      $tf = tabFileFor($assetsDir, $r, $slot);
      if ($tf) $t[$slot] = $tf;
    }
    if ($t) $tabs[$r] = $t;
    $bsf = barskinFileFor($assetsDir, $r);
    if ($bsf) $barskins[$r] = $bsf;
    $bof = baroverFileFor($assetsDir, $r);
    if ($bof) $barovers[$r] = $bof;
    $buf = baseUpgFileFor($assetsDir, $r);
    if ($buf) $baseupg[$r] = $buf;
  }
  // GLOBAL ability/upgrade command-card icons
  $icons = [];
  foreach (array_keys(iconKeys()) as $key) {
    $if = iconFileFor($assetsDir, $key);
    if ($if) $icons[$key] = $if;
  }
  $middle = []; // GLOBAL middle-of-map strip variants (random one per match)
  foreach (MIDDLE_SLOTS as $n) {
    $mf = middleFileFor($assetsDir, $n);
    if ($mf) $middle[] = $mf;
  }
  @mkdir($assetsDir, 0755, true);
  file_put_contents(
    "$assetsDir/manifest.json",
    json_encode(['v' => time(), 'races' => (object)$races, 'backgrounds' => (object)$backgrounds, 'music' => (object)$music, 'cursors' => (object)$cursors, 'icons' => (object)$icons, 'tabs' => (object)$tabs, 'barskins' => (object)$barskins, 'barovers' => (object)$barovers, 'baseupg' => (object)$baseupg, 'portraitvids' => (object)$portraitvids, 'minevids' => (object)$minevids, 'towervids' => (object)$towervids, 'middle' => $middle], JSON_UNESCAPED_SLASHES)
  );
}

// ---------------------------------------------------------------- actions
$action = $_POST['action'] ?? '';

if ($action === 'setup' && !file_exists($configFile)) {
  $p1 = $_POST['password'] ?? '';
  $p2 = $_POST['password2'] ?? '';
  if (strlen($p1) < 8) {
    $err = 'Parola trebuie să aibă minim 8 caractere.';
  } elseif ($p1 !== $p2) {
    $err = 'Parolele nu coincid.';
  } else {
    $hash = password_hash($p1, PASSWORD_DEFAULT);
    $ok = file_put_contents(
      $configFile,
      "<?php\nif (!defined('DS_ADMIN')) exit;\nconst ADMIN_PASSWORD_HASH = " . var_export($hash, true) . ";\n"
    );
    if ($ok === false) {
      $err = 'Nu pot scrie admin/config.php — verifică permisiunile.';
    } else {
      $_SESSION['auth'] = true;
      $msg = 'Parola a fost setată. Bine ai venit!';
    }
  }
}

if (file_exists($configFile)) require $configFile;

if ($action === 'login' && defined('ADMIN_PASSWORD_HASH')) {
  if (password_verify($_POST['password'] ?? '', ADMIN_PASSWORD_HASH)) {
    session_regenerate_id(true);
    $_SESSION['auth'] = true;
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
    $csrf = $_SESSION['csrf'];
  } else {
    sleep(1);
    $err = 'Parolă greșită.';
  }
}

if ($action === 'logout') {
  session_destroy();
  header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
  exit;
}

$authed = !empty($_SESSION['auth']);

function validTarget(string $race, string $ent, string $slot): bool {
  return in_array($race, RACES, true)
    && in_array($ent, array_merge(UNIT_LIST, HERO_LIST, BUILDING_LIST), true)
    && array_key_exists($slot, slotsFor($ent, $race));
}

if ($authed && $action === 'upload') {
  $ent = $_POST['entity'] ?? '';
  $slot = $_POST['slot'] ?? '';
  if (!checkCsrf()) {
    $err = 'Sesiune expirată — reîncearcă.';
  } elseif (!validTarget($race, $ent, $slot)) {
    $err = 'Țintă invalidă.';
  } elseif (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['image']['size'] > MAX_BYTES) {
    $err = 'Fișier prea mare (max 1.5 MB).';
  } else {
    $tmp = $_FILES['image']['tmp_name'];
    $magic = (string)file_get_contents($tmp, false, null, 0, 8);
    if (!is_uploaded_file($tmp) || substr($magic, 0, 8) !== "\x89PNG\r\n\x1a\n") {
      $err = 'Doar fișiere PNG (cu transparență).';
    } else {
      @mkdir("$assetsDir/$race/$ent", 0755, true);
      if (move_uploaded_file($tmp, "$assetsDir/$race/$ent/$slot.png")) {
        regenManifest($assetsDir);
        $msg = "Încărcat: $race · $ent · $slot";
      } else {
        $err = 'Nu pot salva fișierul — verifică permisiunile assets/units.';
      }
    }
  }
}

if ($authed && $action === 'delete') {
  $ent = $_POST['entity'] ?? '';
  $slot = $_POST['slot'] ?? '';
  if (!checkCsrf()) {
    $err = 'Sesiune expirată — reîncearcă.';
  } elseif (validTarget($race, $ent, $slot)) {
    @unlink("$assetsDir/$race/$ent/$slot.png");
    regenManifest($assetsDir);
    $msg = "Șters: $race · $ent · $slot";
  }
}

// per-race background (shown on that side's half of the field)
if ($authed && $action === 'uploadbg') {
  if (!checkCsrf() || !in_array($race, RACES, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['image']['size'] > BG_MAX_BYTES) {
    $err = 'Fișier prea mare (max 5 MB).';
  } else {
    $tmp = $_FILES['image']['tmp_name'];
    $magic = (string)file_get_contents($tmp, false, null, 0, 8);
    if (!is_uploaded_file($tmp) || substr($magic, 0, 8) !== "\x89PNG\r\n\x1a\n") {
      $err = 'Doar fișiere PNG.';
    } else {
      @mkdir("$assetsDir/$race", 0755, true);
      if (move_uploaded_file($tmp, "$assetsDir/$race/background.png")) {
        regenManifest($assetsDir);
        $msg = "Background încărcat: $race";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deletebg') {
  if (checkCsrf() && in_array($race, RACES, true)) {
    @unlink("$assetsDir/$race/background.png");
    regenManifest($assetsDir);
    $msg = "Background șters: $race";
  }
}

// per-race background music (loops in-game; volume set below and saved to balance)
if ($authed && $action === 'uploadmusic') {
  if (!checkCsrf() || !in_array($race, RACES, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['audio']) || $_FILES['audio']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['audio']['size'] > MUSIC_MAX_BYTES) {
    $err = 'Fișier prea mare (max 12 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['audio']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['audio']['tmp_name'];
    if (!in_array($ext, MUSIC_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere audio: ' . implode(', ', MUSIC_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race", 0755, true);
      foreach (MUSIC_EXTS as $e) @unlink("$assetsDir/$race/music.$e"); // one track per race
      if (move_uploaded_file($tmp, "$assetsDir/$race/music.$ext")) {
        regenManifest($assetsDir);
        $msg = "Muzică încărcată: $race";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deletemusic') {
  if (checkCsrf() && in_array($race, RACES, true)) {
    foreach (MUSIC_EXTS as $e) @unlink("$assetsDir/$race/music.$e");
    regenManifest($assetsDir);
    $msg = "Muzică ștearsă: $race";
  }
}

// per-unit idle portrait clip (mp4/webm) — loops in the portrait box in-game.
// `variant` = '' (whole unit) | '-foot' (rider on foot) | '-beast' (split mount)
if ($authed && $action === 'uploadportraitvid') {
  $ent = $_POST['entity'] ?? '';
  $suffix = $_POST['variant'] ?? '';
  $okTarget = in_array($race, RACES, true) && in_array($ent, array_merge(UNIT_LIST, HERO_LIST), true)
    && array_key_exists($suffix, portraitVidVariants($race, $ent));
  if (!checkCsrf() || !$okTarget) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['video']['size'] > PORTRAIT_VID_MAX_BYTES) {
    $err = 'Fișier prea mare (max 12 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['video']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['video']['tmp_name'];
    if (!in_array($ext, PORTRAIT_VID_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere video: ' . implode(', ', PORTRAIT_VID_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race/$ent", 0755, true);
      foreach (PORTRAIT_VID_EXTS as $e) @unlink("$assetsDir/$race/$ent/portrait$suffix.$e"); // one clip per form
      if (move_uploaded_file($tmp, "$assetsDir/$race/$ent/portrait$suffix.$ext")) {
        regenManifest($assetsDir);
        $msg = "Animație portret încărcată: $race · $ent" . ($suffix ? " ($suffix)" : '');
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deleteportraitvid') {
  $ent = $_POST['entity'] ?? '';
  $suffix = $_POST['variant'] ?? '';
  if (checkCsrf() && in_array($race, RACES, true) && in_array($ent, array_merge(UNIT_LIST, HERO_LIST), true)
      && array_key_exists($suffix, portraitVidVariants($race, $ent))) {
    foreach (PORTRAIT_VID_EXTS as $e) @unlink("$assetsDir/$race/$ent/portrait$suffix.$e");
    regenManifest($assetsDir);
    $msg = "Animație portret ștearsă: $race · $ent" . ($suffix ? " ($suffix)" : '');
  }
}

// gold-mine idle clip (mp4/webm) played on the map: mineidle | workeridle
if ($authed && $action === 'uploadminevid') {
  $which = $_POST['which'] ?? '';
  if (!checkCsrf() || !in_array($race, RACES, true) || !in_array($which, MINE_VID_WHICH, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['video']['size'] > PORTRAIT_VID_MAX_BYTES) {
    $err = 'Fișier prea mare (max 12 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['video']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['video']['tmp_name'];
    if (!in_array($ext, PORTRAIT_VID_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere video: ' . implode(', ', PORTRAIT_VID_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race/generator", 0755, true);
      foreach (PORTRAIT_VID_EXTS as $e) @unlink("$assetsDir/$race/generator/$which.$e");
      if (move_uploaded_file($tmp, "$assetsDir/$race/generator/$which.$ext")) {
        regenManifest($assetsDir);
        $msg = "Animație minieră încărcată: $race · $which";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deleteminevid') {
  $which = $_POST['which'] ?? '';
  if (checkCsrf() && in_array($race, RACES, true) && in_array($which, MINE_VID_WHICH, true)) {
    foreach (PORTRAIT_VID_EXTS as $e) @unlink("$assetsDir/$race/generator/$which.$e");
    regenManifest($assetsDir);
    $msg = "Animație minieră ștearsă: $race · $which";
  }
}
// per-tier tower clip (mp4/webm) shown in the portrait box: tier1|tier2|tier3
if ($authed && $action === 'uploadtowervid') {
  $which = $_POST['which'] ?? '';
  if (!checkCsrf() || !in_array($race, RACES, true) || !in_array($which, TOWER_VID_WHICH, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['video']['size'] > PORTRAIT_VID_MAX_BYTES) {
    $err = 'Fișier prea mare (max 12 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['video']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['video']['tmp_name'];
    if (!in_array($ext, PORTRAIT_VID_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere video: ' . implode(', ', PORTRAIT_VID_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race/tower", 0755, true);
      foreach (PORTRAIT_VID_EXTS as $e) @unlink("$assetsDir/$race/tower/$which.$e");
      if (move_uploaded_file($tmp, "$assetsDir/$race/tower/$which.$ext")) {
        regenManifest($assetsDir);
        $msg = "Animație turn încărcată: $race · $which";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deletetowervid') {
  $which = $_POST['which'] ?? '';
  if (checkCsrf() && in_array($race, RACES, true) && in_array($which, TOWER_VID_WHICH, true)) {
    foreach (PORTRAIT_VID_EXTS as $e) @unlink("$assetsDir/$race/tower/$which.$e");
    regenManifest($assetsDir);
    $msg = "Animație turn ștearsă: $race · $which";
  }
}

// per-race custom mouse cursor (shown in-game, hotspot at the top-left)
if ($authed && $action === 'uploadcursor') {
  if (!checkCsrf() || !in_array($race, RACES, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['cursor']) || $_FILES['cursor']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['cursor']['size'] > CURSOR_MAX_BYTES) {
    $err = 'Fișier prea mare (max 1 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['cursor']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['cursor']['tmp_name'];
    if (!in_array($ext, CURSOR_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere: ' . implode(', ', CURSOR_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race", 0755, true);
      foreach (CURSOR_EXTS as $e) @unlink("$assetsDir/$race/cursor.$e"); // one cursor per race
      if (move_uploaded_file($tmp, "$assetsDir/$race/cursor.$ext")) {
        regenManifest($assetsDir);
        $msg = "Cursor încărcat: $race";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deletecursor') {
  if (checkCsrf() && in_array($race, RACES, true)) {
    foreach (CURSOR_EXTS as $e) @unlink("$assetsDir/$race/cursor.$e");
    regenManifest($assetsDir);
    $msg = "Cursor șters: $race";
  }
}

// GLOBAL command-card icons (abilities + upgrades) — assets/units/icons/
if ($authed && $action === 'uploadicon') {
  $key = $_POST['key'] ?? '';
  if (!checkCsrf() || !array_key_exists($key, iconKeys())) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['icon']) || $_FILES['icon']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['icon']['size'] > CURSOR_MAX_BYTES) {
    $err = 'Fișier prea mare (max 1 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['icon']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['icon']['tmp_name'];
    if (!in_array($ext, CURSOR_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere: ' . implode(', ', CURSOR_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/icons", 0755, true);
      foreach (CURSOR_EXTS as $e) @unlink("$assetsDir/icons/$key.$e");
      if (move_uploaded_file($tmp, "$assetsDir/icons/$key.$ext")) {
        regenManifest($assetsDir);
        $msg = "Iconiță încărcată: $key";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deleteicon') {
  $key = $_POST['key'] ?? '';
  if (checkCsrf() && array_key_exists($key, iconKeys())) {
    foreach (CURSOR_EXTS as $e) @unlink("$assetsDir/icons/$key.$e");
    regenManifest($assetsDir);
    $msg = "Iconiță ștearsă: $key";
  }
}

// GLOBAL middle-of-map strip variants (shared, not per race) — middle-<n>.png
if ($authed && $action === 'uploadmiddle') {
  $slot = (int)($_POST['slot'] ?? 0);
  if (!checkCsrf() || !in_array($slot, MIDDLE_SLOTS, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['image']['size'] > BG_MAX_BYTES) {
    $err = 'Fișier prea mare (max 5 MB).';
  } else {
    $tmp = $_FILES['image']['tmp_name'];
    $magic = (string)file_get_contents($tmp, false, null, 0, 8);
    if (!is_uploaded_file($tmp) || substr($magic, 0, 8) !== "\x89PNG\r\n\x1a\n") {
      $err = 'Doar fișiere PNG.';
    } elseif (move_uploaded_file($tmp, "$assetsDir/middle-$slot.png")) {
      if ($slot === 1) @unlink("$assetsDir/middle.png"); // drop legacy single upload
      regenManifest($assetsDir);
      $msg = "Mijloc hartă $slot încărcat.";
    } else {
      $err = 'Nu pot salva fișierul.';
    }
  }
}
if ($authed && $action === 'deletemiddle') {
  $slot = (int)($_POST['slot'] ?? 0);
  if (checkCsrf() && in_array($slot, MIDDLE_SLOTS, true)) {
    @unlink("$assetsDir/middle-$slot.png");
    if ($slot === 1) @unlink("$assetsDir/middle.png");
    regenManifest($assetsDir);
    $msg = "Mijloc hartă $slot șters.";
  }
}

// per-race UNITS / CLĂDIRI shop tab buttons (tab-<slot>.<ext>)
if ($authed && $action === 'uploadtab') {
  $slot = $_POST['slot'] ?? '';
  if (!checkCsrf() || !in_array($race, RACES, true) || !array_key_exists($slot, TAB_SLOTS)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['tab']) || $_FILES['tab']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['tab']['size'] > CURSOR_MAX_BYTES) {
    $err = 'Fișier prea mare (max 1 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['tab']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['tab']['tmp_name'];
    if (!in_array($ext, CURSOR_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere: ' . implode(', ', CURSOR_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race", 0755, true);
      foreach (CURSOR_EXTS as $e) @unlink("$assetsDir/$race/tab-$slot.$e");
      if (move_uploaded_file($tmp, "$assetsDir/$race/tab-$slot.$ext")) {
        regenManifest($assetsDir);
        $msg = "Buton încărcat: $slot ($race)";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deletetab') {
  $slot = $_POST['slot'] ?? '';
  if (checkCsrf() && in_array($race, RACES, true) && array_key_exists($slot, TAB_SLOTS)) {
    foreach (CURSOR_EXTS as $e) @unlink("$assetsDir/$race/tab-$slot.$e");
    regenManifest($assetsDir);
    $msg = "Buton șters: $slot ($race)";
  }
}

// per-race base tier-upgrade icon
if ($authed && $action === 'uploadbaseupg') {
  if (!checkCsrf() || !in_array($race, RACES, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['baseupg']) || $_FILES['baseupg']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['baseupg']['size'] > CURSOR_MAX_BYTES) {
    $err = 'Fișier prea mare (max 1 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['baseupg']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['baseupg']['tmp_name'];
    if (!in_array($ext, CURSOR_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere: ' . implode(', ', CURSOR_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race", 0755, true);
      foreach (CURSOR_EXTS as $e) @unlink("$assetsDir/$race/baseupgrade.$e");
      if (move_uploaded_file($tmp, "$assetsDir/$race/baseupgrade.$ext")) {
        regenManifest($assetsDir);
        $msg = "Iconiță Upgrade Bază încărcată: $race";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deletebaseupg') {
  if (checkCsrf() && in_array($race, RACES, true)) {
    foreach (CURSOR_EXTS as $e) @unlink("$assetsDir/$race/baseupgrade.$e");
    regenManifest($assetsDir);
    $msg = "Iconiță Upgrade Bază ștearsă: $race";
  }
}

// per-race bottom-bar background design (the "skin" painted over the template)
if ($authed && $action === 'uploadbarskin') {
  if (!checkCsrf() || !in_array($race, RACES, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['barskin']) || $_FILES['barskin']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['barskin']['size'] > BG_MAX_BYTES) {
    $err = 'Fișier prea mare (max 5 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['barskin']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['barskin']['tmp_name'];
    if (!in_array($ext, BARSKIN_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere: ' . implode(', ', BARSKIN_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race", 0755, true);
      foreach (BARSKIN_EXTS as $e) @unlink("$assetsDir/$race/barskin.$e");
      if (move_uploaded_file($tmp, "$assetsDir/$race/barskin.$ext")) {
        regenManifest($assetsDir);
        $msg = "Fundal meniu încărcat: $race";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deletebarskin') {
  if (checkCsrf() && in_array($race, RACES, true)) {
    foreach (BARSKIN_EXTS as $e) @unlink("$assetsDir/$race/barskin.$e");
    regenManifest($assetsDir);
    $msg = "Fundal meniu șters: $race";
  }
}

// per-race bottom-bar OVERLAY (decorations painted OVER the UI elements)
if ($authed && $action === 'uploadbarover') {
  if (!checkCsrf() || !in_array($race, RACES, true)) {
    $err = 'Cerere invalidă.';
  } elseif (empty($_FILES['barover']) || $_FILES['barover']['error'] !== UPLOAD_ERR_OK) {
    $err = 'Upload eșuat — fișier lipsă sau prea mare.';
  } elseif ($_FILES['barover']['size'] > BG_MAX_BYTES) {
    $err = 'Fișier prea mare (max 5 MB).';
  } else {
    $ext = strtolower(pathinfo($_FILES['barover']['name'], PATHINFO_EXTENSION));
    $tmp = $_FILES['barover']['tmp_name'];
    if (!in_array($ext, BARSKIN_EXTS, true) || !is_uploaded_file($tmp)) {
      $err = 'Doar fișiere: ' . implode(', ', BARSKIN_EXTS) . '.';
    } else {
      @mkdir("$assetsDir/$race", 0755, true);
      foreach (BARSKIN_EXTS as $e) @unlink("$assetsDir/$race/barover.$e");
      if (move_uploaded_file($tmp, "$assetsDir/$race/barover.$ext")) {
        regenManifest($assetsDir);
        $msg = "Overlay meniu încărcat: $race";
      } else {
        $err = 'Nu pot salva fișierul.';
      }
    }
  }
}
if ($authed && $action === 'deletebarover') {
  if (checkCsrf() && in_array($race, RACES, true)) {
    foreach (BARSKIN_EXTS as $e) @unlink("$assetsDir/$race/barover.$e");
    regenManifest($assetsDir);
    $msg = "Overlay meniu șters: $race";
  }
}
?>
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin — Direct Strike Online</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #dbe4f0; font-family: "Segoe UI", system-ui, sans-serif; padding: 24px; }
    h1 { font-size: 20px; letter-spacing: 1px; margin-bottom: 4px; }
    h1 .accent { color: #4da6ff; }
    h2 { font-size: 13px; letter-spacing: 2px; color: #7c8ba1; text-transform: uppercase; margin: 26px 0 10px; }
    .sub { color: #7c8ba1; font-size: 13px; margin-bottom: 16px; line-height: 1.5; }
    .flash { padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 13px; }
    .flash.ok { background: #12331f; border: 1px solid #2a6b42; color: #58d68d; }
    .flash.bad { background: #3a1519; border: 1px solid #7a2a33; color: #ff8090; }
    .panel { background: #161c26; border: 1px solid #2a3446; border-radius: 12px; padding: 22px; max-width: 420px; }
    label { display: block; font-size: 12px; color: #7c8ba1; margin: 10px 0 4px; }
    input[type=password] {
      width: 100%; padding: 9px 12px; background: #0a0e14; color: #dbe4f0;
      border: 1px solid #2a3446; border-radius: 7px; font-size: 14px;
    }
    button {
      margin-top: 14px; padding: 9px 20px; background: #1d4e89; color: #dbe4f0;
      border: 1px solid #4da6ff; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    button:hover { background: #2563a8; }
    button.mini { margin: 0; padding: 2px 7px; font-size: 10px; }
    button.danger { background: #5a1e26; border-color: #ff5566; }
    .topline { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }

    /* race tabs */
    .tabs { display: flex; gap: 8px; margin-bottom: 6px; }
    .tabs a {
      padding: 8px 22px; border-radius: 8px 8px 0 0; text-decoration: none;
      color: #7c8ba1; background: #10151d; border: 1px solid #2a3446; border-bottom: none;
      font-weight: 700; letter-spacing: 1px; font-size: 13px; text-transform: uppercase;
    }
    .tabs a.active { color: #ffd35c; background: #161c26; }

    /* quick nav */
    .quicknav { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
    .quicknav a {
      font-size: 11px; color: #4da6ff; text-decoration: none;
      border: 1px solid #2a3446; border-radius: 20px; padding: 3px 10px; background: #10151d;
    }
    .quicknav a:hover { border-color: #4da6ff; }

    /* entity rows */
    .ent {
      background: #161c26; border: 1px solid #2a3446; border-radius: 12px;
      padding: 14px 16px; margin-bottom: 12px;
      display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;
    }
    .unit-tabs { display: flex; gap: 8px; margin: 18px 0 10px; }
    .unit-tabs .utab {
      padding: 8px 20px; font-size: 14px; font-weight: 700; cursor: pointer;
      background: #10151d; color: #9fb0c8; border: 1px solid #2a3446; border-radius: 20px;
    }
    .unit-tabs .utab.active { background: #1c2740; color: #ffd35c; border-color: #5a4a1e; }
    .portraitvid { flex-basis: 100%; border-top: 1px dashed #2a3446; padding-top: 10px; margin-left: 126px; }
    .portraitvid .lbl { font-size: 10px; color: #b58fff; text-transform: uppercase; letter-spacing: 1px; }
    .portraitvid .pv-row { display: flex; align-items: center; gap: 14px; margin: 6px 0 12px; }
    .portraitvid video { border: 1px solid #2a3446; border-radius: 6px; background: #0a0e14; }
    .portraitvid .pv-empty {
      width: 96px; height: 96px; border: 1px dashed #3d4c66; border-radius: 6px;
      display: flex; align-items: center; justify-content: center; color: #3d4c66; font-size: 11px;
    }
    .portraitvid input[type=file] { display: none; }
    .portraitvid .pick { color: #b58fff; font-size: 12px; cursor: pointer; text-decoration: underline; }
    .ent .title { width: 110px; padding-top: 22px; }
    .ent .title b { font-size: 14px; color: #4da6ff; text-transform: capitalize; display: block; }
    .ent .title span { font-size: 11px; color: #7c8ba1; }
    .slots { display: flex; flex-wrap: wrap; gap: 10px; }
    .slot { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .slot .lbl { font-size: 10px; color: #7c8ba1; text-transform: uppercase; letter-spacing: 1px; }
    .slot.thumbslot .lbl { color: #ffd35c; }
    .thumb {
      width: 64px; height: 64px; background:
        repeating-conic-gradient(#141a24 0 25%, #0e141d 0 50%) 0 0 / 16px 16px;
      border: 1px solid #2a3446; border-radius: 6px;
      display: flex; align-items: center; justify-content: center; overflow: hidden;
    }
    .slot.thumbslot .thumb { border-color: #5a4a1e; }
    .thumb img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
    .thumb .empty { color: #3d4c66; font-size: 20px; }
    .slot input[type=file] { display: none; }
    .slot .pick { color: #4da6ff; font-size: 10px; cursor: pointer; text-decoration: underline; }
    .hint { color: #7c8ba1; font-size: 12px; margin-top: 16px; line-height: 1.6; }
    a { color: #4da6ff; }
  </style>
</head>
<body>
  <div class="topline">
    <div>
      <h1>DIRECT STRIKE <span class="accent">ADMIN</span></h1>
      <div class="sub">PNG cu transparență, personajul cu fața spre <b>dreapta</b>, centrat (recomandat 256×256).
      <b>Thumb</b> = iconița din shop. Varianta echipei roșii și oglindirea se generează automat.</div>
    </div>
    <?php if ($authed): ?>
    <form method="post"><input type="hidden" name="action" value="logout"><button class="mini">Logout</button></form>
    <?php endif; ?>
  </div>

  <?php if ($msg): ?><div class="flash ok"><?= htmlspecialchars($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="flash bad"><?= htmlspecialchars($err) ?></div><?php endif; ?>

<?php if (!file_exists($configFile)): ?>
  <div class="panel">
    <h1 style="font-size:16px">Prima configurare</h1>
    <div class="sub" style="margin-top:6px">Setează parola de admin (minim 8 caractere).</div>
    <form method="post">
      <input type="hidden" name="action" value="setup">
      <label>Parolă</label><input type="password" name="password" required minlength="8">
      <label>Confirmă parola</label><input type="password" name="password2" required minlength="8">
      <button>Setează parola</button>
    </form>
  </div>
<?php elseif (!$authed): ?>
  <div class="panel">
    <form method="post">
      <input type="hidden" name="action" value="login">
      <label>Parolă</label><input type="password" name="password" autofocus required>
      <button>Intră</button>
    </form>
  </div>
<?php else: ?>

  <?php $navActive = $view === 'icons' ? 'icons' : $race; include __DIR__ . '/nav.php'; ?>

  <?php if ($view === 'icons'): ?>
  <?php // GLOBAL command-card icons: one per ability + upgrade (shared by both races) ?>
  <div class="ent" id="ui-icons">
    <div class="title"><b>Iconițe abilități &amp; upgrade-uri</b><span>globale — comune ambelor rase (grila de comenzi din joc)</span></div>
    <div class="slots">
      <?php foreach (iconKeys() as $key => $label): $if = iconFileFor($assetsDir, $key); $hasIcon = $if !== null; ?>
      <div class="slot">
        <span class="lbl"><?= $label ?></span>
        <div class="thumb" style="background:#0a0e14">
          <?php if ($hasIcon): ?>
            <img src="<?= $assetsUrl ?>/icons/<?= $if ?>?t=<?= filemtime("$assetsDir/icons/$if") ?>" alt="">
          <?php else: ?><span class="empty">+</span><?php endif; ?>
        </div>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadicon">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="key" value="<?= $key ?>">
          <label class="pick"><?= $hasIcon ? 'înlocuiește' : 'încarcă' ?><input type="file" name="icon" accept="image/*" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasIcon): ?>
        <form method="post">
          <input type="hidden" name="action" value="deleteicon">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="key" value="<?= $key ?>">
          <button class="mini danger" onclick="return confirm('Ștergi iconița?')">șterge</button>
        </form>
        <?php endif; ?>
      </div>
      <?php endforeach; ?>
    </div>
  </div>
  <div class="ent" id="map-middle">
    <div class="title"><b>Mijloc hartă</b><span>global — 3 variante; una aleasă la întâmplare la începutul fiecărui meci</span></div>
    <div class="slots">
      <?php foreach (MIDDLE_SLOTS as $n): $midFile = middleFileFor($assetsDir, $n); $hasMid = $midFile !== null; ?>
      <div class="slot">
        <span class="lbl" style="color:#ffd35c">Varianta <?= $n ?></span>
        <div class="thumb" style="width:60px;height:180px;background:#0a0e14">
          <?php if ($hasMid): ?>
            <img src="<?= $assetsUrl ?>/<?= $midFile ?>?t=<?= filemtime("$assetsDir/$midFile") ?>" alt="" style="width:100%;height:100%;object-fit:cover">
          <?php else: ?><span class="empty">+</span><?php endif; ?>
        </div>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadmiddle">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="slot" value="<?= $n ?>">
          <label class="pick"><?= $hasMid ? 'înlocuiește' : 'încarcă' ?><input type="file" name="image" accept="image/png" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasMid): ?>
        <form method="post">
          <input type="hidden" name="action" value="deletemiddle">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="slot" value="<?= $n ?>">
          <button class="mini danger" onclick="return confirm('Ștergi varianta <?= $n ?>?')">șterge</button>
        </form>
        <?php endif; ?>
      </div>
      <?php endforeach; ?>
      <div class="slot" style="max-width:280px">
        <div style="color:#7c8ba1;font-size:12px;line-height:1.6">
          PNG vertical, înalt (ex. <b>400×1920</b>). Se desenează centrat pe linia de mijloc, peste ambele
          jumătăți — lățimea benzii în joc = <b>lățimea PNG-ului ÷ 2</b> (400 → ~200 unități). Ține-o
          neutră, cu <b>marginile stânga/dreapta transparente (fade)</b> ca să se topească în cele două
          hărți. Încarcă 1–3 variante; jocul alege una random la fiecare meci.
        </div>
      </div>
    </div>
  </div>
  <?php else: ?>

  <?php
    $bgFile = "$assetsDir/$race/background.png"; $hasBg = is_file($bgFile);
    $musicFile = musicFileFor($assetsDir, $race); $hasMusic = $musicFile !== null;
    $cursorFile = cursorFileFor($assetsDir, $race); $hasCursor = $cursorFile !== null;
  ?>
  <div class="ent" id="background">
    <div class="title"><b>Background</b><span><?= $hasBg ? 'setat' : 'niciunul' ?> · muzică: <?= $hasMusic ? 'setată' : 'niciuna' ?> · cursor: <?= $hasCursor ? 'setat' : 'niciunul' ?></span></div>
    <div class="slots">
      <div class="slot">
        <span class="lbl" style="color:#ffd35c">Jumătatea <?= $race ?></span>
        <div class="thumb" style="width:160px;height:90px">
          <?php if ($hasBg): ?>
            <img src="<?= $assetsUrl ?>/<?= $race ?>/background.png?t=<?= filemtime($bgFile) ?>" alt="">
          <?php else: ?><span class="empty">+</span><?php endif; ?>
        </div>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadbg">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <label class="pick"><?= $hasBg ? 'înlocuiește' : 'încarcă' ?><input type="file" name="image" accept="image/png" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasBg): ?>
        <form method="post">
          <input type="hidden" name="action" value="deletebg">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <button class="mini danger" onclick="return confirm('Ștergi background-ul?')">șterge</button>
        </form>
        <?php endif; ?>
        <button type="button" id="dl-map-template" class="pick" style="cursor:pointer;margin-top:8px">⬇ Șablon zone (PNG)</button>
        <div style="color:#7c8ba1;font-size:11px;max-width:170px;margin-top:6px;line-height:1.5">
          Arată unde cad baza, zona de unități și turela — pictează decorul aliniat, exportă la <b>3600×1920</b>.
        </div>
      </div>
      <div class="slot" style="min-width:240px">
        <span class="lbl" style="color:#ffd35c">Muzică <?= $race ?> (mp3, loop)</span>
        <?php if ($hasMusic): ?>
          <audio controls preload="none" style="width:220px;height:32px;margin:6px 0"
            src="<?= $assetsUrl ?>/<?= $race ?>/<?= $musicFile ?>?t=<?= filemtime("$assetsDir/$race/$musicFile") ?>"></audio>
        <?php else: ?>
          <div class="thumb" style="width:220px;height:32px"><span class="empty">♪</span></div>
        <?php endif; ?>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadmusic">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <label class="pick"><?= $hasMusic ? 'înlocuiește' : 'încarcă' ?><input type="file" name="audio" accept=".mp3,.ogg,.m4a,.mp4,audio/*" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasMusic): ?>
        <form method="post">
          <input type="hidden" name="action" value="deletemusic">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <button class="mini danger" onclick="return confirm('Ștergi muzica?')">șterge</button>
        </form>
        <?php endif; ?>
        <div style="margin-top:8px;font-size:12px;color:#b9c4d4">
          Volum: <input type="number" id="music-vol" min="0" max="100" step="1" style="width:64px;padding:4px 6px;background:#0a0e14;color:#dbe4f0;border:1px solid #2a3446;border-radius:6px">%
          <span id="music-vol-status" style="color:#7c8ba1;margin-left:6px"></span>
        </div>
      </div>
      <div class="slot" style="min-width:200px">
        <span class="lbl" style="color:#ffd35c">Cursor mouse <?= $race ?></span>
        <div class="thumb" style="width:64px;height:64px;background:#0a0e14">
          <?php if ($hasCursor): ?>
            <img src="<?= $assetsUrl ?>/<?= $race ?>/<?= $cursorFile ?>?t=<?= filemtime("$assetsDir/$race/$cursorFile") ?>" alt="" style="max-width:40px;max-height:40px">
          <?php else: ?><span class="empty">↖</span><?php endif; ?>
        </div>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadcursor">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <label class="pick"><?= $hasCursor ? 'înlocuiește' : 'încarcă' ?><input type="file" name="cursor" accept=".png,.gif,.cur,.webp,image/*" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasCursor): ?>
        <form method="post">
          <input type="hidden" name="action" value="deletecursor">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <button class="mini danger" onclick="return confirm('Ștergi cursor-ul?')">șterge</button>
        </form>
        <?php endif; ?>
      </div>
      <?php foreach (TAB_SLOTS as $slot => $slotLabel): $tf = tabFileFor($assetsDir, $race, $slot); $hasTab = $tf !== null; ?>
      <div class="slot" style="min-width:130px">
        <span class="lbl" style="color:#ffd35c"><?= $slotLabel ?> (<?= $race ?>)</span>
        <div class="thumb" style="width:64px;height:64px;background:#0a0e14">
          <?php if ($hasTab): ?>
            <img src="<?= $assetsUrl ?>/<?= $race ?>/<?= $tf ?>?t=<?= filemtime("$assetsDir/$race/$tf") ?>" alt="" style="max-width:56px;max-height:56px">
          <?php else: ?><span class="empty"><?= $slot === 'units' ? '⚔' : '🏰' ?></span><?php endif; ?>
        </div>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadtab">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <input type="hidden" name="slot" value="<?= $slot ?>">
          <label class="pick"><?= $hasTab ? 'înlocuiește' : 'încarcă' ?><input type="file" name="tab" accept="image/*" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasTab): ?>
        <form method="post">
          <input type="hidden" name="action" value="deletetab">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <input type="hidden" name="slot" value="<?= $slot ?>">
          <button class="mini danger" onclick="return confirm('Ștergi butonul?')">șterge</button>
        </form>
        <?php endif; ?>
      </div>
      <?php endforeach; ?>
      <?php $baseUpgFile = baseUpgFileFor($assetsDir, $race); $hasBaseUpg = $baseUpgFile !== null; ?>
      <div class="slot" style="min-width:150px">
        <span class="lbl" style="color:#ffd35c">Iconiță Upgrade Bază <?= $race ?></span>
        <div class="thumb" style="width:64px;height:64px;background:#0a0e14">
          <?php if ($hasBaseUpg): ?>
            <img src="<?= $assetsUrl ?>/<?= $race ?>/<?= $baseUpgFile ?>?t=<?= filemtime("$assetsDir/$race/$baseUpgFile") ?>" alt="" style="max-width:56px;max-height:56px">
          <?php else: ?><span class="empty">▲</span><?php endif; ?>
        </div>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadbaseupg">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <label class="pick"><?= $hasBaseUpg ? 'înlocuiește' : 'încarcă' ?><input type="file" name="baseupg" accept="image/*" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasBaseUpg): ?>
        <form method="post">
          <input type="hidden" name="action" value="deletebaseupg">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <button class="mini danger" onclick="return confirm('Ștergi iconița?')">șterge</button>
        </form>
        <?php endif; ?>
      </div>
      <?php $barskinFile = barskinFileFor($assetsDir, $race); $hasBarskin = $barskinFile !== null; ?>
      <div class="slot" style="min-width:200px">
        <span class="lbl" style="color:#ffd35c">Fundal meniu jos <?= $race ?></span>
        <div class="thumb" style="width:160px;height:32px;background:#0a0e14">
          <?php if ($hasBarskin): ?>
            <img src="<?= $assetsUrl ?>/<?= $race ?>/<?= $barskinFile ?>?t=<?= filemtime("$assetsDir/$race/$barskinFile") ?>" alt="" style="max-width:158px;max-height:30px">
          <?php else: ?><span class="empty">▭</span><?php endif; ?>
        </div>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadbarskin">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <label class="pick"><?= $hasBarskin ? 'înlocuiește' : 'încarcă' ?><input type="file" name="barskin" accept=".png,.webp,.jpg,.jpeg,image/*" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasBarskin): ?>
        <form method="post">
          <input type="hidden" name="action" value="deletebarskin">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <button class="mini danger" onclick="return confirm('Ștergi fundalul meniului?')">șterge</button>
        </form>
        <?php endif; ?>
      </div>
      <?php $baroverFile = baroverFileFor($assetsDir, $race); $hasBarover = $baroverFile !== null; ?>
      <div class="slot" style="min-width:200px">
        <span class="lbl" style="color:#ffd35c">Overlay meniu jos <?= $race ?> (peste elemente)</span>
        <div class="thumb" style="width:160px;height:32px;background:#0a0e14">
          <?php if ($hasBarover): ?>
            <img src="<?= $assetsUrl ?>/<?= $race ?>/<?= $baroverFile ?>?t=<?= filemtime("$assetsDir/$race/$baroverFile") ?>" alt="" style="max-width:158px;max-height:30px">
          <?php else: ?><span class="empty">✦</span><?php endif; ?>
        </div>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="action" value="uploadbarover">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <label class="pick"><?= $hasBarover ? 'înlocuiește' : 'încarcă' ?><input type="file" name="barover" accept=".png,.webp,.jpg,.jpeg,image/*" onchange="this.form.submit()"></label>
        </form>
        <?php if ($hasBarover): ?>
        <form method="post">
          <input type="hidden" name="action" value="deletebarover">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="race" value="<?= $race ?>">
          <button class="mini danger" onclick="return confirm('Ștergi overlay-ul meniului?')">șterge</button>
        </form>
        <?php endif; ?>
      </div>
      <div class="slot" style="min-width:220px;padding-top:12px">
        <span class="lbl" style="color:#ffd35c">Șablon meniu jos</span>
        <button type="button" id="dl-bar-template" class="pick" style="cursor:pointer">⬇ Descarcă șablonul (PNG)</button>
        <div style="color:#7c8ba1;font-size:11px;max-width:230px;margin-top:8px;line-height:1.5">
          Pictează designul peste el, exportă la <b>aceeași mărime</b>, apoi încarcă mai sus:
          <b>Fundal</b> = ÎN SPATELE elementelor; <b>Overlay</b> = PESTE elemente (lasă restul transparent).
        </div>
      </div>
    </div>
  </div>
  <script type="module">
    import { downloadBarTemplate } from '../src/ui/bartemplate.js?v=<?= time() ?>';
    import { downloadMapTemplate } from '../src/ui/maptemplate.js?v=<?= time() ?>';
    document.getElementById('dl-bar-template')?.addEventListener('click', () => downloadBarTemplate());
    document.getElementById('dl-map-template')?.addEventListener('click', () => downloadMapTemplate());
  </script>

  <div class="quicknav">
    <?php foreach (array_merge(orderedUnits($race), BUILDING_LIST) as $e): ?>
      <a href="#<?= $e ?>"><?= $e ?></a>
    <?php endforeach; ?>
  </div>

  <?php
  function renderEnt(string $race, string $ent, string $assetsDir, string $assetsUrl, string $csrf, string $kind): void {
    $slots = slotsFor($ent, $race);
    $done = 0;
    foreach ($slots as $slot => $label) if (is_file("$assetsDir/$race/$ent/$slot.png")) $done++;
    ?>
    <div class="ent" id="<?= $ent ?>" data-kind="<?= $kind ?>">
      <div class="title"><b><?= $ent ?></b><span><?= $done ?> / <?= count($slots) ?> imagini</span>
        <button type="button" class="stat-gear" data-ent="<?= $ent ?>" data-kind="<?= $kind ?>" title="Editează statistici">⚙ stats</button>
      </div>
      <div class="slots">
        <?php foreach ($slots as $slot => $label):
          $file = "$assetsDir/$race/$ent/$slot.png";
          $has = is_file($file);
        ?>
        <div class="slot <?= in_array($slot, ['thumb', 'foot-thumb', 'beast-thumb'], true) ? 'thumbslot' : '' ?>">
          <span class="lbl"><?= $label ?></span>
          <div class="thumb">
            <?php if ($has): ?>
              <img src="<?= $assetsUrl ?>/<?= $race ?>/<?= $ent ?>/<?= $slot ?>.png?t=<?= filemtime($file) ?>" alt="">
            <?php else: ?>
              <span class="empty">+</span>
            <?php endif; ?>
          </div>
          <form method="post" enctype="multipart/form-data">
            <input type="hidden" name="action" value="upload">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="race" value="<?= $race ?>">
            <input type="hidden" name="entity" value="<?= $ent ?>">
            <input type="hidden" name="slot" value="<?= $slot ?>">
            <label class="pick"><?= $has ? 'înlocuiește' : 'încarcă' ?><input type="file" name="image" accept="image/png" onchange="this.form.submit()"></label>
          </form>
          <?php if ($has): ?>
          <form method="post">
            <input type="hidden" name="action" value="delete">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="race" value="<?= $race ?>">
            <input type="hidden" name="entity" value="<?= $ent ?>">
            <input type="hidden" name="slot" value="<?= $slot ?>">
            <button class="mini danger" onclick="return confirm('Ștergi această imagine?')">șterge</button>
          </form>
          <?php endif; ?>
        </div>
        <?php endforeach; ?>
      </div>
      <?php if ($kind === 'unit'): ?>
      <div class="portraitvid">
        <?php foreach (portraitVidVariants($race, $ent) as $suffix => $label):
          $vidFile = portraitVidFileFor($assetsDir, $race, $ent, $suffix);
          $hasVid = $vidFile !== null;
        ?>
        <span class="lbl"><?= $label ?></span>
        <div class="pv-row">
          <?php if ($hasVid): ?>
            <video src="<?= $assetsUrl ?>/<?= $race ?>/<?= $ent ?>/<?= $vidFile ?>?t=<?= filemtime("$assetsDir/$race/$ent/$vidFile") ?>" width="96" height="96" autoplay loop muted playsinline></video>
          <?php else: ?>
            <div class="pv-empty">fără animație</div>
          <?php endif; ?>
          <form method="post" enctype="multipart/form-data">
            <input type="hidden" name="action" value="uploadportraitvid">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="race" value="<?= $race ?>">
            <input type="hidden" name="entity" value="<?= $ent ?>">
            <input type="hidden" name="variant" value="<?= $suffix ?>">
            <label class="pick"><?= $hasVid ? 'înlocuiește' : 'încarcă' ?><input type="file" name="video" accept="video/mp4,video/webm" onchange="this.form.submit()"></label>
          </form>
          <?php if ($hasVid): ?>
          <form method="post">
            <input type="hidden" name="action" value="deleteportraitvid">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="race" value="<?= $race ?>">
            <input type="hidden" name="entity" value="<?= $ent ?>">
            <input type="hidden" name="variant" value="<?= $suffix ?>">
            <button class="mini danger" onclick="return confirm('Ștergi animația portret?')">șterge</button>
          </form>
          <?php endif; ?>
        </div>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>
      <?php if ($ent === 'generator'): ?>
      <div class="portraitvid">
        <?php foreach (['mineidle' => 'Animație mină (mp4/webm)', 'workeridle' => 'Animație muncitor idle (mp4/webm)'] as $which => $label):
          $mvf = mineVidFileFor($assetsDir, $race, $which);
          $hasMv = $mvf !== null;
        ?>
        <span class="lbl"><?= $label ?></span>
        <div class="pv-row">
          <?php if ($hasMv): ?>
            <video src="<?= $assetsUrl ?>/<?= $race ?>/generator/<?= $mvf ?>?t=<?= filemtime("$assetsDir/$race/generator/$mvf") ?>" width="96" height="96" autoplay loop muted playsinline></video>
          <?php else: ?>
            <div class="pv-empty">fără animație</div>
          <?php endif; ?>
          <form method="post" enctype="multipart/form-data">
            <input type="hidden" name="action" value="uploadminevid">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="race" value="<?= $race ?>">
            <input type="hidden" name="which" value="<?= $which ?>">
            <label class="pick"><?= $hasMv ? 'înlocuiește' : 'încarcă' ?><input type="file" name="video" accept="video/mp4,video/webm" onchange="this.form.submit()"></label>
          </form>
          <?php if ($hasMv): ?>
          <form method="post">
            <input type="hidden" name="action" value="deleteminevid">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="race" value="<?= $race ?>">
            <input type="hidden" name="which" value="<?= $which ?>">
            <button class="mini danger" onclick="return confirm('Ștergi animația?')">șterge</button>
          </form>
          <?php endif; ?>
        </div>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>
      <?php if ($ent === 'tower'): ?>
      <div class="portraitvid">
        <?php foreach (['tier1' => 'Animație turn Tier 1 (mp4/webm)', 'tier2' => 'Animație turn Tier 2 (mp4/webm)', 'tier3' => 'Animație turn Tier 3 (mp4/webm)'] as $which => $label):
          $tvf = towerVidFileFor($assetsDir, $race, $which);
          $hasTv = $tvf !== null;
        ?>
        <span class="lbl"><?= $label ?></span>
        <div class="pv-row">
          <?php if ($hasTv): ?>
            <video src="<?= $assetsUrl ?>/<?= $race ?>/tower/<?= $tvf ?>?t=<?= filemtime("$assetsDir/$race/tower/$tvf") ?>" width="96" height="96" autoplay loop muted playsinline></video>
          <?php else: ?>
            <div class="pv-empty">fără animație</div>
          <?php endif; ?>
          <form method="post" enctype="multipart/form-data">
            <input type="hidden" name="action" value="uploadtowervid">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="race" value="<?= $race ?>">
            <input type="hidden" name="which" value="<?= $which ?>">
            <label class="pick"><?= $hasTv ? 'înlocuiește' : 'încarcă' ?><input type="file" name="video" accept="video/mp4,video/webm" onchange="this.form.submit()"></label>
          </form>
          <?php if ($hasTv): ?>
          <form method="post">
            <input type="hidden" name="action" value="deletetowervid">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="race" value="<?= $race ?>">
            <input type="hidden" name="which" value="<?= $which ?>">
            <button class="mini danger" onclick="return confirm('Ștergi animația?')">șterge</button>
          </form>
          <?php endif; ?>
        </div>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>
    </div>
  <?php } ?>

  <div class="unit-tabs">
    <button type="button" class="utab active" data-tab="units">Unități</button>
    <button type="button" class="utab" data-tab="heroes">Eroi</button>
  </div>

  <div id="utab-units" class="utab-panel">
    <h2>Unități — <?= $race ?> <span style="text-transform:none;font-size:12px;color:#7c8ba1">(▲▼ reordonează — ordinea apare la fel în shop-ul din joc)</span></h2>
    <?php foreach (orderedUnits($race) as $e) renderEnt($race, $e, $assetsDir, $assetsUrl, $csrf, 'unit'); ?>
  </div>

  <div id="utab-heroes" class="utab-panel" style="display:none">
    <h2>Eroi — <?= $race ?> <span style="text-transform:none;font-size:12px;color:#7c8ba1">(Thumb, idle, walk, attack, die + animație portret · „Prepare spell" + un cadru „Cast …" per abilitate · sprite-uri pentru invocări. Abilitățile le alegi din ⚙ stats.)</span></h2>
    <?php foreach (HERO_LIST as $e) renderEnt($race, $e, $assetsDir, $assetsUrl, $csrf, 'unit'); ?>
  </div>

  <script>
    (function () {
      var btns = document.querySelectorAll('.utab');
      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          btns.forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          document.getElementById('utab-units').style.display = b.dataset.tab === 'units' ? '' : 'none';
          document.getElementById('utab-heroes').style.display = b.dataset.tab === 'heroes' ? '' : 'none';
        });
      });
    })();
  </script>

  <h2>Clădiri — <?= $race ?></h2>
  <?php foreach (BUILDING_LIST as $e) renderEnt($race, $e, $assetsDir, $assetsUrl, $csrf, 'building'); ?>

  <div class="hint">
    • <b>⚙ stats</b> pe fiecare unitate/clădire editează caracteristicile ei (cost, HP, damage…).
    Regulile generale (bani, venit, interval wave, costuri tier) sunt la <a href="balance.php">⚙ Balance</a>;
    catalogul de abilități se balansează la <a href="abilities.php">✨ Abilități</a>.<br>
    • Bifezi <b>Caster</b> în ⚙ stats la o unitate și îi alegi până la 5 abilități; după <b>Salvează</b> +
    refresh, unitatea primește aici sloturi de <b>Cast</b> (2 frame-uri) pentru fiecare abilitate activă.<br>
    • Jocul folosește automat imaginile; unde lipsesc, rămâne arta vectorială integrată.<br>
    • <b>Die</b> are un singur frame. Clădirile au doar Idle (2 frame-uri, alternate lent) + Thumb.<br>
    • Verifică rezultatul în <a href="../dev/puppet-preview.html?race=<?= $race ?>" target="_blank">pagina de preview</a> sau direct în joc (refresh).<br>
    • Fișierele stau în <code>assets/units/<?= $race ?>/…</code> pe server și nu sunt atinse de <code>git pull</code>.
  </div>
  <script type="module" src="../src/ui/admin-stats.js?v=<?= time() ?>"></script>
  <?php endif; // view ?>
<?php endif; // authed ?>
</body>
</html>
