<?php
// Upgrades editor UI — admin only. Lists the upgrade catalog (from the shared
// JS module) with every parameter editable + the target unit; saving posts the
// whole balance to save-balance.php (upgrades are part of assets/balance.json).

declare(strict_types=1);
session_start();
define('DS_ADMIN', 1);
$configFile = __DIR__ . '/config.php';
if (file_exists($configFile)) require $configFile;
$authed = !empty($_SESSION['auth']);
?>
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Upgrades — Direct Strike Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #dbe4f0; font-family: "Segoe UI", system-ui, sans-serif; padding: 24px 24px 80px; }
    h1 { font-size: 20px; letter-spacing: 1px; margin-bottom: 4px; }
    h1 .accent { color: #ffb35c; }
    .sub { color: #7c8ba1; font-size: 13px; margin-bottom: 18px; }
    a { color: #4da6ff; }
    .group { background: #161c26; border: 1px solid #2a3446; border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; }
    .group h3 { font-size: 15px; margin-bottom: 2px; color: #ffb35c; }
    .group .desc { color: #7c8ba1; font-size: 12px; margin: 6px 0 10px; line-height: 1.45; }
    .unit-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13px; }
    .unit-row span { color: #b9c4d4; }
    .unit-row select { padding: 6px 10px; background: #0a0e14; color: #dbe4f0; border: 1px solid #2a3446; border-radius: 6px; font-size: 13px; min-width: 160px; }
    .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px 16px; }
    .fld { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; }
    .fld span { color: #b9c4d4; }
    .fld input { width: 92px; padding: 5px 8px; background: #0a0e14; color: #dbe4f0; border: 1px solid #2a3446; border-radius: 6px; font-size: 13px; text-align: right; }
    .bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: flex; gap: 10px; align-items: center; padding: 12px 20px; background: #10151d; border-top: 1px solid #2a3446; }
    button { padding: 9px 20px; background: #1d4e89; color: #dbe4f0; border: 1px solid #4da6ff; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; }
    button:hover { background: #2563a8; }
    button.ghost { background: #161c26; border-color: #2a3446; }
    #status { font-size: 13px; color: #7c8ba1; margin-left: auto; }
    #status.ok { color: #58d68d; }
    #status.bad { color: #ff8090; }
  </style>
</head>
<body>
  <h1>DIRECT STRIKE <span class="accent">UPGRADES</span></h1>
<?php if (!$authed): ?>
  <p class="sub">Trebuie să fii logat ca admin. <a href="./">Mergi la /admin și loghează-te</a>, apoi revino aici.</p>
<?php else: ?>
  <div class="sub">Catalogul de upgrades — comun ambelor rase. Fiecare upgrade alege <b>cărei unități</b> i se
    aplică; în meci se cumpără <b>o dată din Bază</b> (cost mai jos) și rămâne activ tot meciul. Apasă
    <b>Salvează</b> — se scrie în <code>assets/balance.json</code>. ·
    <a href="./">Sprites</a> · <a href="balance.php">⚙ Balance</a> · <a href="abilities.php">✨ Abilități</a> ·
    <a href="../" target="_blank">Deschide jocul ↗</a></div>
  <div id="up-app">Se încarcă…</div>
  <div class="bar">
    <button id="save-btn">Salvează pe server</button>
    <button id="reset-btn" class="ghost">Reset la valorile din cod</button>
    <span id="status"></span>
  </div>
  <script type="module" src="../src/ui/admin-upgrades.js?v=<?= time() ?>"></script>
<?php endif; ?>
</body>
</html>
