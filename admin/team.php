<?php
// Team-modes (2v2 / 3v3 / asymmetric) settings UI — admin only. Edits the
// TEAM_* knobs (ally-zone %, collapse refund, base rebuild, asymmetric income
// bonuses); saving posts to save-balance.php which writes assets/balance.json.

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
  <title>Moduri echipă — Direct Strike Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #dbe4f0; font-family: "Segoe UI", system-ui, sans-serif; padding: 24px 24px 80px; }
    h1 { font-size: 20px; letter-spacing: 1px; margin-bottom: 4px; }
    h1 .accent { color: #58d68d; }
    .sub { color: #7c8ba1; font-size: 13px; margin-bottom: 18px; }
    a { color: #4da6ff; }
    .group {
      background: #161c26; border: 1px solid #2a3446; border-radius: 10px;
      padding: 12px 16px; margin-bottom: 12px;
    }
    .group h3 { font-size: 14px; color: #58d68d; margin-bottom: 8px; }
    .group .sub { margin-bottom: 10px; }
    .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px 16px; }
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
      padding: 9px 20px; background: #1d6e4a; color: #dbe4f0;
      border: 1px solid #58d68d; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    button:hover { background: #268a5d; }
    button.ghost { background: #161c26; border-color: #2a3446; }
    #status { font-size: 13px; color: #7c8ba1; margin-left: auto; }
    #status.ok { color: #58d68d; }
    #status.bad { color: #ff8090; }
  </style>
</head>
<body>
  <h1>DIRECT STRIKE <span class="accent">MODURI ECHIPĂ</span></h1>
<?php if (!$authed): ?>
  <p class="sub">Trebuie să fii logat ca admin. <a href="./">Mergi la /admin și loghează-te</a>, apoi revino aici.</p>
<?php else: ?>
  <?php $navActive = 'team'; include __DIR__ . '/nav.php'; ?>
  <div class="sub">Setările modurilor 2v2 / 3v3 / asimetrice („apărare în adâncime"): construitul în zona
    aliatului, prăbușirea zonei + refund-ul, reconstruirea bazei și compensația taberei mai mici.
    Apasă <b>Salvează</b> — se scrie în <code>assets/balance.json</code> și se aplică la următorul meci. ·
    <a href="../" target="_blank">Deschide jocul ↗</a></div>
  <div id="team-app">Se încarcă…</div>
  <div class="bar">
    <button id="save-btn">Salvează pe server</button>
    <button id="reset-btn" class="ghost">Reîncarcă valorile de pe server</button>
    <span id="status"></span>
  </div>
  <script type="module" src="../src/ui/admin-team.js?v=<?= time() ?>"></script>
<?php endif; ?>
</body>
</html>
