<?php
// Direct Strike Online — sprite admin.
// First visit: set a password (stored as a hash in admin/config.php,
// which is gitignored so deploys never touch it). Then upload 2 PNG
// frames per unit × animation; the game picks them up automatically and
// falls back to the built-in vector puppets where images are missing.

declare(strict_types=1);
session_start();

define('DS_ADMIN', 1);

const UNITS = ['grunt', 'slinger', 'bruiser', 'lancer', 'crab', 'mender', 'dasher', 'wasp', 'archon'];
const ANIMS = ['idle', 'walk', 'attack', 'die'];
const FRAMES = [0, 1];
const MAX_BYTES = 1572864; // 1.5 MB

$configFile = __DIR__ . '/config.php';
$assetsDir = dirname(__DIR__) . '/assets/units';
$assetsUrl = '../assets/units';

$_SESSION['csrf'] = $_SESSION['csrf'] ?? bin2hex(random_bytes(16));
$csrf = $_SESSION['csrf'];
$msg = '';
$err = '';

function checkCsrf(): bool {
  return hash_equals($_SESSION['csrf'], $_POST['csrf'] ?? '');
}

function regenManifest(string $assetsDir): void {
  $units = [];
  foreach (UNITS as $u) {
    foreach (ANIMS as $a) {
      foreach (FRAMES as $f) {
        $exists = is_file("$assetsDir/$u/{$a}_{$f}.png");
        if ($exists) $units[$u][$a][$f] = true;
        if (isset($units[$u][$a])) {
          // normalize to a dense [bool, bool] array
          $units[$u][$a] = [(bool)($units[$u][$a][0] ?? false), (bool)($units[$u][$a][1] ?? false)];
        }
      }
    }
  }
  @mkdir($assetsDir, 0755, true);
  file_put_contents(
    "$assetsDir/manifest.json",
    json_encode(['v' => time(), 'units' => (object)$units], JSON_UNESCAPED_SLASHES)
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
    sleep(1); // slow down guessing
    $err = 'Parolă greșită.';
  }
}

if ($action === 'logout') {
  session_destroy();
  header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
  exit;
}

$authed = !empty($_SESSION['auth']);

if ($authed && $action === 'upload') {
  $unit = $_POST['unit'] ?? '';
  $anim = $_POST['anim'] ?? '';
  $frame = (int)($_POST['frame'] ?? -1);
  if (!checkCsrf()) {
    $err = 'Sesiune expirată — reîncearcă.';
  } elseif (!in_array($unit, UNITS, true) || !in_array($anim, ANIMS, true) || !in_array($frame, FRAMES, true)) {
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
      @mkdir("$assetsDir/$unit", 0755, true);
      if (move_uploaded_file($tmp, "$assetsDir/$unit/{$anim}_{$frame}.png")) {
        regenManifest($assetsDir);
        $msg = "Încărcat: $unit · $anim · frame " . ($frame + 1);
      } else {
        $err = 'Nu pot salva fișierul — verifică permisiunile assets/units.';
      }
    }
  }
}

if ($authed && $action === 'delete') {
  $unit = $_POST['unit'] ?? '';
  $anim = $_POST['anim'] ?? '';
  $frame = (int)($_POST['frame'] ?? -1);
  if (!checkCsrf()) {
    $err = 'Sesiune expirată — reîncearcă.';
  } elseif (in_array($unit, UNITS, true) && in_array($anim, ANIMS, true) && in_array($frame, FRAMES, true)) {
    @unlink("$assetsDir/$unit/{$anim}_{$frame}.png");
    regenManifest($assetsDir);
    $msg = "Șters: $unit · $anim · frame " . ($frame + 1);
  }
}

function slotFile(string $assetsDir, string $u, string $a, int $f): string {
  return "$assetsDir/$u/{$a}_{$f}.png";
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
    body { background: #0d1117; color: #dbe4f0; font-family: "Segoe UI", system-ui, sans-serif; padding: 28px; }
    h1 { font-size: 20px; letter-spacing: 1px; margin-bottom: 4px; }
    h1 .accent { color: #4da6ff; }
    .sub { color: #7c8ba1; font-size: 13px; margin-bottom: 22px; line-height: 1.5; }
    .flash { padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
    .flash.ok { background: #12331f; border: 1px solid #2a6b42; color: #58d68d; }
    .flash.bad { background: #3a1519; border: 1px solid #7a2a33; color: #ff8090; }
    .panel { background: #161c26; border: 1px solid #2a3446; border-radius: 12px; padding: 22px; max-width: 420px; }
    .panel.wide { max-width: none; overflow-x: auto; }
    label { display: block; font-size: 12px; color: #7c8ba1; margin: 10px 0 4px; }
    input[type=password], input[type=text] {
      width: 100%; padding: 9px 12px; background: #0a0e14; color: #dbe4f0;
      border: 1px solid #2a3446; border-radius: 7px; font-size: 14px;
    }
    button {
      margin-top: 14px; padding: 9px 20px; background: #1d4e89; color: #dbe4f0;
      border: 1px solid #4da6ff; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    button:hover { background: #2563a8; }
    button.mini { margin: 0; padding: 3px 8px; font-size: 11px; }
    button.danger { background: #5a1e26; border-color: #ff5566; }
    .topline { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #2a3446; padding: 8px; text-align: center; font-size: 12px; }
    th { background: #1c2431; color: #7c8ba1; text-transform: uppercase; letter-spacing: 1px; font-size: 10px; }
    td.unit { font-weight: 700; font-size: 13px; color: #4da6ff; text-transform: capitalize; }
    .slot { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 96px; }
    .thumb {
      width: 72px; height: 72px; background:
        repeating-conic-gradient(#141a24 0 25%, #0e141d 0 50%) 0 0 / 16px 16px;
      border: 1px solid #2a3446; border-radius: 6px;
      display: flex; align-items: center; justify-content: center; overflow: hidden;
    }
    .thumb img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
    .thumb .empty { color: #3d4c66; font-size: 22px; }
    .slot input[type=file] { display: none; }
    .slot .pick { color: #4da6ff; font-size: 11px; cursor: pointer; text-decoration: underline; }
    .hint { color: #7c8ba1; font-size: 12px; margin-top: 14px; line-height: 1.6; }
    a { color: #4da6ff; }
  </style>
</head>
<body>
  <div class="topline">
    <div>
      <h1>DIRECT STRIKE <span class="accent">ADMIN</span></h1>
      <div class="sub">Sprite-uri de unități: 2 frame-uri PNG per animație. Personajul: cu fața spre <b>dreapta</b>,
      centrat, fundal transparent (recomandat 256×256). Varianta roșie și oglindirea se generează automat în joc.</div>
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
  <div class="panel wide">
    <table>
      <tr>
        <th>Unitate</th>
        <?php foreach (ANIMS as $a): foreach (FRAMES as $f): ?>
          <th><?= $a ?> · f<?= $f + 1 ?></th>
        <?php endforeach; endforeach; ?>
      </tr>
      <?php foreach (UNITS as $u): ?>
      <tr>
        <td class="unit"><?= $u ?></td>
        <?php foreach (ANIMS as $a): foreach (FRAMES as $f):
          $file = slotFile($assetsDir, $u, $a, $f);
          $has = is_file($file);
        ?>
        <td>
          <div class="slot">
            <div class="thumb">
              <?php if ($has): ?>
                <img src="<?= $assetsUrl ?>/<?= $u ?>/<?= $a ?>_<?= $f ?>.png?t=<?= filemtime($file) ?>" alt="">
              <?php else: ?>
                <span class="empty">+</span>
              <?php endif; ?>
            </div>
            <form method="post" enctype="multipart/form-data">
              <input type="hidden" name="action" value="upload">
              <input type="hidden" name="csrf" value="<?= $csrf ?>">
              <input type="hidden" name="unit" value="<?= $u ?>">
              <input type="hidden" name="anim" value="<?= $a ?>">
              <input type="hidden" name="frame" value="<?= $f ?>">
              <label class="pick"><?= $has ? 'înlocuiește' : 'încarcă' ?><input type="file" name="image" accept="image/png" onchange="this.form.submit()"></label>
            </form>
            <?php if ($has): ?>
            <form method="post">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="csrf" value="<?= $csrf ?>">
              <input type="hidden" name="unit" value="<?= $u ?>">
              <input type="hidden" name="anim" value="<?= $a ?>">
              <input type="hidden" name="frame" value="<?= $f ?>">
              <button class="mini danger" onclick="return confirm('Ștergi acest frame?')">șterge</button>
            </form>
            <?php endif; ?>
          </div>
        </td>
        <?php endforeach; endforeach; ?>
      </tr>
      <?php endforeach; ?>
    </table>
    <div class="hint">
      • Jocul folosește automat imaginile încărcate; unde lipsesc, rămân personajele vectoriale / formele geometrice.<br>
      • Verifică rezultatul în <a href="../dev/puppet-preview.html" target="_blank">pagina de preview</a> sau direct în joc (refresh).<br>
      • Fișierele stau în <code>assets/units/</code> pe server și nu sunt atinse de <code>git pull</code>.
    </div>
  </div>
<?php endif; ?>
</body>
</html>
