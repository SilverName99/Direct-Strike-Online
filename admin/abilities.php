<?php
// Abilities editor UI — admin only. Lists the ability catalog (from the
// shared JS module) with every parameter editable; saving posts the whole
// balance to save-balance.php (abilities are part of assets/balance.json).

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
  <title>Abilități — Direct Strike Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #dbe4f0; font-family: "Segoe UI", system-ui, sans-serif; padding: 24px 24px 80px; }
    h1 { font-size: 20px; letter-spacing: 1px; margin-bottom: 4px; }
    h1 .accent { color: #b58cff; }
    .sub { color: #7c8ba1; font-size: 13px; margin-bottom: 18px; }
    a { color: #4da6ff; }
    .group {
      background: #161c26; border: 1px solid #2a3446; border-radius: 10px;
      padding: 12px 16px; margin-bottom: 12px;
    }
    .ab-head { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
    .ab-info { min-width: 0; }
    .ab-preview {
      flex: none; width: 168px; height: 90px; border-radius: 8px;
      background: radial-gradient(circle at 50% 60%, #131c28, #0a0e14);
      border: 1px solid #2a3446;
    }
    .group h3 { font-size: 15px; margin-bottom: 2px; }
    .group .kind { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; border-radius: 20px; padding: 2px 8px; margin-left: 8px; vertical-align: 2px; }
    .kind.aura { background: #1c2b1e; color: #58d68d; border: 1px solid #2b4a30; }
    .kind.castaura { background: #2b2a16; color: #ffd35c; border: 1px solid #4a4526; }
    .kind.active { background: #2b1e33; color: #b58cff; border: 1px solid #45325a; }
    .group .desc { color: #7c8ba1; font-size: 12px; margin-bottom: 10px; }
    .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px 16px; }
    .fld { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; }
    .fld span { color: #b9c4d4; }
    .fld input {
      width: 92px; padding: 5px 8px; background: #0a0e14; color: #dbe4f0;
      border: 1px solid #2a3446; border-radius: 6px; font-size: 13px; text-align: right;
    }
    .bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
      display: flex; gap: 10px; align-items: center;
      padding: 12px 20px; background: #10151d; border-top: 1px solid #2a3446;
    }
    button {
      padding: 9px 20px; background: #1d4e89; color: #dbe4f0;
      border: 1px solid #4da6ff; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    button:hover { background: #2563a8; }
    button.ghost { background: #161c26; border-color: #2a3446; }
    #status { font-size: 13px; color: #7c8ba1; margin-left: auto; }
    #status.ok { color: #58d68d; }
    #status.bad { color: #ff8090; }
  </style>
</head>
<body>
  <h1>DIRECT STRIKE <span class="accent">ABILITĂȚI</span></h1>
<?php if (!$authed): ?>
  <p class="sub">Trebuie să fii logat ca admin. <a href="./">Mergi la /admin și loghează-te</a>, apoi revino aici.</p>
<?php else: ?>
  <div class="sub">Catalogul de abilități — comun ambelor rase. <b>Cine</b> le folosește se setează
    per unitate din <b>⚙ stats</b> (bifa „Caster" + selecția de abilități) în pagina de
    <a href="./">sprites</a>. Apasă <b>Salvează</b> — se scrie în <code>assets/balance.json</code>. ·
    <a href="balance.php">⚙ Balance</a> · <a href="../" target="_blank">Deschide jocul ↗</a></div>
  <div id="ab-app">Se încarcă…</div>
  <div class="bar">
    <button id="save-btn">Salvează pe server</button>
    <button id="reset-btn" class="ghost">Reset la valorile din cod</button>
    <span id="status"></span>
  </div>
  <script type="module" src="../src/ui/admin-abilities.js?v=<?= time() ?>"></script>
<?php endif; ?>
</body>
</html>
