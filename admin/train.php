<?php
// Evolutionary AI trainer UI — admin only. All the heavy lifting (headless
// matches, evolution) runs client-side in Web Workers; this page is just the
// control panel. The best evolved "brain" can be saved into balance.json and
// then drives the in-game AI.

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
  <title>Antrenor AI — Direct Strike Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #dbe4f0; font-family: "Segoe UI", system-ui, sans-serif; padding: 24px 24px 80px; }
    h1 { font-size: 20px; letter-spacing: 1px; margin-bottom: 4px; }
    h1 .accent { color: #a97bff; }
    .sub { color: #7c8ba1; font-size: 13px; margin-bottom: 14px; }
    a { color: #4da6ff; }
    h2 { font-size: 12px; letter-spacing: 2px; color: #a97bff; text-transform: uppercase; margin: 22px 0 8px; }
    .panel { background: #161c26; border: 1px solid #2a3446; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
    .row { display: flex; flex-wrap: wrap; gap: 14px 20px; align-items: center; }
    .fld { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
    .fld span { color: #b9c4d4; }
    .fld input { width: 96px; padding: 6px 8px; background: #0a0e14; color: #dbe4f0; border: 1px solid #2a3446; border-radius: 6px; font-size: 13px; }
    button { padding: 8px 16px; border-radius: 8px; border: 1px solid #3a2b6b; background: #2a1e55; color: #d9ccff; font-weight: 700; font-size: 13px; cursor: pointer; }
    button:hover { background: #35266b; }
    button.ghost { background: #10151d; color: #9fb0c8; border-color: #2a3446; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px 16px; }
    .stat { background: #10151d; border: 1px solid #2a3446; border-radius: 8px; padding: 8px 10px; }
    .stat .k { color: #7c8ba1; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
    .stat .v { font-size: 18px; font-weight: 700; color: #ffd35c; }
    canvas#chart { width: 100%; height: 200px; background: #0a0e14; border: 1px solid #2a3446; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #1d2431; }
    th { color: #7c8ba1; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
    .bar { display: inline-block; height: 8px; border-radius: 4px; vertical-align: middle; }
    #status { color: #7c8ba1; font-size: 13px; }
    #status.run { color: #a97bff; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 820px) { .two { grid-template-columns: 1fr; } }
    code { background: #0a0e14; padding: 1px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>DIRECT STRIKE <span class="accent">ANTRENOR AI</span></h1>
<?php if (!$authed): ?>
  <p class="sub">Trebuie să fii logat ca admin. <a href="./">Mergi la /admin și loghează-te</a>, apoi revino aici.</p>
<?php else: ?>
  <?php $navActive = 'trainer'; include __DIR__ . '/nav.php'; ?>
  <div class="sub">Două AI-uri se bat headless, de mii de ori, iar cele care câștigă „se împerechează" — AI-ul devine mai bun cu fiecare generație.
    Rulează în browser pe toate nucleele; lasă tab-ul deschis. Rasele sunt mixte/aleatorii. La final, <b>Aplică în joc</b> salvează creierul evoluat în <code>balance.json</code>.</div>

  <div class="panel">
    <div class="row" id="controls">
      <label class="fld"><span>Populație</span><input id="c-pop" type="number" value="24" min="6" max="120"></label>
      <label class="fld"><span>Meciuri / genom</span><input id="c-matches" type="number" value="6" min="2" max="30"></label>
      <label class="fld"><span>Durată meci (s)</span><input id="c-secs" type="number" value="140" min="40" max="400"></label>
      <label class="fld"><span>Mutație (%)</span><input id="c-mut" type="number" value="25" min="1" max="90"></label>
      <div class="row" style="gap:8px">
        <button id="b-start">▶ Start</button>
        <button id="b-pause" class="ghost" disabled>⏸ Pauză</button>
        <button id="b-stop" class="ghost" disabled>⏹ Stop</button>
      </div>
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      <button id="b-apply" class="ghost">✅ Aplică în joc (cel mai bun)</button>
      <button id="b-export" class="ghost">⬇ Export JSON</button>
      <button id="b-import" class="ghost">⬆ Import JSON</button>
      <button id="b-reset" class="ghost">♻ Reset antrenament</button>
      <span id="status">gata.</span>
    </div>
  </div>

  <h2>Progres</h2>
  <div class="panel">
    <div class="stat-grid" id="stats"></div>
    <canvas id="chart" width="900" height="200" style="margin-top:12px"></canvas>
  </div>

  <h2>Rezumat meci — se schimbă cu fiecare generație</h2>
  <div class="panel">
    <div class="sub" style="margin-bottom:8px">Cel mai bun creier al generației curente joacă un meci demonstrativ: cine a câștigat, la ce minut și ce a făcut fiecare tabără.</div>
    <div id="summary"><div style="color:#7c8ba1">Pornește antrenamentul — după prima generație apare povestea unui meci.</div></div>
  </div>

  <div class="two">
    <div>
      <h2>Cel mai bun creier</h2>
      <div class="panel"><table id="genome"><tbody></tbody></table></div>
    </div>
    <div>
      <h2>Balans — rase</h2>
      <div class="panel"><table id="race-stats"><tbody></tbody></table></div>
    </div>
  </div>

  <h2>Balans — unități (ce apare des în armatele câștigătoare)</h2>
  <div class="panel">
    <div class="sub" style="margin-bottom:8px">Win% mare + pick% mare = candidat de <b>nerf</b>. Pick% mic = unitate ignorată, candidat de <b>buff</b>.</div>
    <table id="unit-stats"><thead><tr><th>Unitate</th><th>Rasă</th><th>Pick %</th><th>Win %</th></tr></thead><tbody></tbody></table>
  </div>

  <h2>Recomandări modificări?</h2>
  <div class="panel">
    <div class="sub" style="margin-bottom:8px">Sugestii automate din statistici (după destule meciuri): <b style="color:#ff8090">🔻 nerf</b> = prea puternic + folosit des · <b style="color:#8fe3ff">🔺 buff</b> = ignorat sau subperformează. Orientative — verifică și cu ochiul tău.</div>
    <ul id="reco" style="margin:0;padding-left:18px;line-height:1.75;font-size:13px"><li style="color:#7c8ba1">Rulează antrenamentul ca să se adune date…</li></ul>
  </div>

  <script type="module" src="../src/ui/admin-train.js?v=<?= time() ?>"></script>
<?php endif; ?>
</body>
</html>
