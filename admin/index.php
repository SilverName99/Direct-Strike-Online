<?php
// Direct Strike Online — sprite admin.
// First visit: set a password (stored as a hash in admin/config.php,
// which is gitignored so deploys never touch it).
//
// Art is organized per RACE. Each unit has: a shop thumbnail, plus
// idle×2, walk×2, attack×2 and die×1 frames. Buildings (main base,
// turret, tower, generator — walls stay vector) have: thumbnail + idle×2.
// The game picks uploads up automatically and falls back to the built-in
// vector art wherever an image is missing.

declare(strict_types=1);
session_start();

define('DS_ADMIN', 1);

const RACES = ['humans', 'orcs'];
const UNIT_LIST = ['grunt', 'slinger', 'bruiser', 'lancer', 'crab', 'mender', 'dasher', 'wasp', 'archon'];
const BUILDING_LIST = ['main', 'turret', 'tower', 'generator'];
// ranged units (projectile:true in units.js) can upload a projectile image
const PROJECTILE_UNITS = ['slinger', 'lancer', 'crab', 'wasp', 'archon'];
// armed buildings fire, so they get attack frames + a projectile image
const ARMED_BUILDINGS = ['turret', 'tower'];
// ability catalog (mirrors src/abilities.js): id => [name, has cast animation]
// — auras are passive, so they take no cast frames
const ABILITY_INFO = [
  'heal' => ['Heal', true],
  'dispell' => ['Dispel', true],
  'slowaura' => ['Slow Aura', false],
  'hasteaura' => ['Haste Aura', false],
  'regenaura' => ['Regeneration Aura', false],
  'frostbolt' => ['Frost Bolt', true],
];

// Which abilities a unit has selected (per race) — read from the saved
// balance, so the sprite page can show its cast slots. Cached per request.
function unitAbilities(string $race, string $ent): array {
  static $bal = null;
  if ($bal === null) {
    $f = dirname(__DIR__) . '/assets/balance.json';
    $bal = is_file($f) ? (json_decode(file_get_contents($f), true) ?: []) : [];
  }
  $u = $bal['races'][$race]['units'][$ent] ?? null;
  if (!$u || empty($u['caster']) || empty($u['abilities']) || !is_array($u['abilities'])) return [];
  return array_values(array_filter($u['abilities'], fn($a) => isset(ABILITY_INFO[$a])));
}
const MAX_BYTES = 1572864; // 1.5 MB
const BG_MAX_BYTES = 5242880; // 5 MB (backgrounds may be large)

// slot id => label; slot files are "<slot>.png". $race matters only for
// units: casters gain 2 cast frames per selected ACTIVE ability.
function slotsFor(string $ent, string $race = 'humans'): array {
  if (in_array($ent, BUILDING_LIST, true)) {
    // the main base shows a distinct image per upgrade tier (1/2/3)
    if ($ent === 'main') {
      return ['thumb' => 'Thumb', 'tier_0' => 'Tier 1', 'tier_1' => 'Tier 2', 'tier_2' => 'Tier 3'];
    }
    $slots = ['thumb' => 'Thumb', 'idle_0' => 'Idle 1', 'idle_1' => 'Idle 2'];
    if (in_array($ent, ARMED_BUILDINGS, true)) {
      $slots['attack_0'] = 'Attack 1';
      $slots['attack_1'] = 'Attack 2';
      $slots['projectile'] = 'Proiectil';
    }
    return $slots;
  }
  $slots = [
    'thumb' => 'Thumb',
    'idle_0' => 'Idle 1', 'idle_1' => 'Idle 2',
    'walk_0' => 'Walk 1', 'walk_1' => 'Walk 2',
    'attack_0' => 'Attack 1', 'attack_1' => 'Attack 2',
    'die_0' => 'Die',
  ];
  if (in_array($ent, PROJECTILE_UNITS, true)) $slots['projectile'] = 'Proiectil';
  // cast frames for this unit's selected active abilities (per race)
  foreach (unitAbilities($race, $ent) as $aid) {
    if (empty(ABILITY_INFO[$aid][1])) continue; // auras have no cast anim
    $name = ABILITY_INFO[$aid][0];
    $slots["cast-{$aid}_0"] = "Cast {$name} 1";
    $slots["cast-{$aid}_1"] = "Cast {$name} 2";
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

function checkCsrf(): bool {
  return hash_equals($_SESSION['csrf'], $_POST['csrf'] ?? '');
}

function regenManifest(string $assetsDir): void {
  $races = [];
  foreach (RACES as $r) {
    foreach (array_merge(UNIT_LIST, BUILDING_LIST) as $ent) {
      $slots = slotsFor($ent, $r);
      $entData = [];
      foreach ($slots as $slot => $label) {
        $exists = is_file("$assetsDir/$r/$ent/$slot.png");
        if ($slot === 'thumb' || $slot === 'projectile') {
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
  foreach (RACES as $r) {
    if (is_file("$assetsDir/$r/background.png")) $backgrounds[$r] = true;
  }
  @mkdir($assetsDir, 0755, true);
  file_put_contents(
    "$assetsDir/manifest.json",
    json_encode(['v' => time(), 'races' => (object)$races, 'backgrounds' => (object)$backgrounds], JSON_UNESCAPED_SLASHES)
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
    && in_array($ent, array_merge(UNIT_LIST, BUILDING_LIST), true)
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
      display: flex; gap: 16px; align-items: flex-start;
    }
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

  <div class="tabs">
    <?php foreach (RACES as $r): ?>
      <a href="?race=<?= $r ?>" class="<?= $r === $race ? 'active' : '' ?>"><?= $r === 'humans' ? '⚔ Humans' : '🪓 Orcs' ?></a>
    <?php endforeach; ?>
    <a href="balance.php" style="margin-left:16px">⚙ Balance</a>
    <a href="abilities.php" style="margin-left:4px">✨ Abilități</a>
  </div>

  <?php $bgFile = "$assetsDir/$race/background.png"; $hasBg = is_file($bgFile); ?>
  <div class="ent" id="background">
    <div class="title"><b>Background</b><span><?= $hasBg ? 'setat' : 'niciunul' ?></span></div>
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
      </div>
      <div style="color:#7c8ba1;font-size:12px;padding-top:22px;max-width:360px">
        Imaginea apare pe toată jumătatea acestei rase în joc (fundal). PNG, recomandat orizontal (ex. 1600×1440), max 5 MB.
      </div>
    </div>
  </div>

  <div class="quicknav">
    <?php foreach (array_merge(UNIT_LIST, BUILDING_LIST) as $e): ?>
      <a href="#<?= $e ?>"><?= $e ?></a>
    <?php endforeach; ?>
  </div>

  <?php
  function renderEnt(string $race, string $ent, string $assetsDir, string $assetsUrl, string $csrf, string $kind): void {
    $slots = slotsFor($ent, $race);
    $done = 0;
    foreach ($slots as $slot => $label) if (is_file("$assetsDir/$race/$ent/$slot.png")) $done++;
    ?>
    <div class="ent" id="<?= $ent ?>">
      <div class="title"><b><?= $ent ?></b><span><?= $done ?> / <?= count($slots) ?> imagini</span>
        <button type="button" class="stat-gear" data-ent="<?= $ent ?>" data-kind="<?= $kind ?>" title="Editează statistici">⚙ stats</button>
      </div>
      <div class="slots">
        <?php foreach ($slots as $slot => $label):
          $file = "$assetsDir/$race/$ent/$slot.png";
          $has = is_file($file);
        ?>
        <div class="slot <?= $slot === 'thumb' ? 'thumbslot' : '' ?>">
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
    </div>
  <?php } ?>

  <h2>Unități — <?= $race ?></h2>
  <?php foreach (UNIT_LIST as $e) renderEnt($race, $e, $assetsDir, $assetsUrl, $csrf, 'unit'); ?>

  <h2>Clădiri — <?= $race ?> <span style="text-transform:none">(zidurile rămân desenate de joc)</span></h2>
  <?php foreach (BUILDING_LIST as $e) renderEnt($race, $e, $assetsDir, $assetsUrl, $csrf, 'building'); ?>

  <div class="ent" id="wall">
    <div class="title"><b>wall</b><span>fără imagini</span>
      <button type="button" class="stat-gear" data-ent="wall" data-kind="building" title="Editează statistici">⚙ stats</button>
    </div>
    <div class="slots"><span style="color:#7c8ba1;font-size:12px;padding-top:20px">Zidul e desenat de joc — doar statistici.</span></div>
  </div>

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
<?php endif; ?>
</body>
</html>
