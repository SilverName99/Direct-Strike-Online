<?php
// Balance editor UI — admin only. Reads the shared JS data modules so the
// numbers stay a single source of truth; saving posts to save-balance.php
// (session-gated) which writes assets/balance.json. The game applies that
// file at boot.

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
  <title>Balance — Direct Strike Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #dbe4f0; font-family: "Segoe UI", system-ui, sans-serif; padding: 24px 24px 80px; }
    h1 { font-size: 20px; letter-spacing: 1px; margin-bottom: 4px; }
    h1 .accent { color: #4da6ff; }
    .sub { color: #7c8ba1; font-size: 13px; margin-bottom: 18px; }
    a { color: #4da6ff; }
    h2 { font-size: 12px; letter-spacing: 2px; color: #ffd35c; text-transform: uppercase; margin: 24px 0 8px; }
    .group {
      background: #161c26; border: 1px solid #2a3446; border-radius: 10px;
      padding: 12px 16px; margin-bottom: 12px;
    }
    .group h3 { font-size: 14px; color: #4da6ff; text-transform: capitalize; margin-bottom: 8px; }
    .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px 16px; }
    .fld { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; }
    .fld span { color: #b9c4d4; }
    .fld input, .fld select {
      width: 92px; padding: 5px 8px; background: #0a0e14; color: #dbe4f0;
      border: 1px solid #2a3446; border-radius: 6px; font-size: 13px; text-align: right;
    }
    .fld select { text-align: left; }
    .quicknav { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
    .quicknav a { font-size: 11px; color: #4da6ff; text-decoration: none; border: 1px solid #2a3446; border-radius: 20px; padding: 3px 10px; background: #10151d; }
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
  <h1>DIRECT STRIKE <span class="accent">BALANCE</span></h1>
<?php if (!$authed): ?>
  <p class="sub">Trebuie să fii logat ca admin. <a href="./">Mergi la /admin și loghează-te</a>, apoi revino aici.</p>
<?php else: ?>
  <?php $navActive = 'balance'; include __DIR__ . '/nav.php'; ?>
  <div class="sub">Reguli generale (bani, venit, interval wave, costuri tier). Statisticile fiecărei
    unități/clădiri se editează cu <b>⚙ stats</b> în pagina de sprites. Apasă <b>Salvează</b> — se scrie
    în <code>assets/balance.json</code> și devine balansul oficial. ·
    <a href="../" target="_blank">Deschide jocul ↗</a></div>
  <div id="bal-app">Se încarcă…</div>
  <div class="bar">
    <button id="save-btn">Salvează pe server</button>
    <button id="reset-btn" class="ghost">Reset la valorile din cod</button>
    <span id="status"></span>
  </div>
  <script type="module" src="../src/ui/admin-balance.js?v=<?= time() ?>"></script>
<?php endif; ?>
</body>
</html>
