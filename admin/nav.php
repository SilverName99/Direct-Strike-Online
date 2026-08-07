<?php
// Shared admin navigation tabs, rendered on every admin page so switching
// between Sprites / Iconițe / Balance / Abilități / Upgrades is one click.
// Set $navActive before including to highlight the current tab, one of:
//   'humans' | 'orcs' | 'icons' | 'balance' | 'abilities' | 'upgrades'
if (!defined('DS_ADMIN')) exit;
$navActive = $navActive ?? '';
$navTabs = [
  ['humans',    'index.php?race=humans', '⚔ Humans'],
  ['orcs',      'index.php?race=orcs',   '🪓 Orcs'],
  ['undead',    'index.php?race=undead', '💀 Undead'],
  ['woodelves', 'index.php?race=woodelves', '🏹 Wood Elves'],
  ['icons',     'index.php?view=icons',  '🎨 Iconițe'],
  ['balance',   'balance.php',           '⚙ Balance'],
  ['abilities', 'abilities.php',         '✨ Abilități'],
  ['upgrades',  'upgrades.php',          '🐗 Upgrades'],
  ['trainer',   'train.php',             '🧬 Antrenor AI'],
  ['team',      'team.php',              '⚔ Moduri echipă'],
];
?>
<style>
  .admin-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 20px; }
  .admin-tabs a {
    padding: 8px 20px; border-radius: 8px 8px 0 0; text-decoration: none;
    color: #7c8ba1; background: #10151d; border: 1px solid #2a3446; border-bottom: none;
    font-weight: 700; letter-spacing: 1px; font-size: 13px; text-transform: uppercase;
  }
  .admin-tabs a:hover { color: #dbe4f0; background: #131a24; }
  .admin-tabs a.active { color: #ffd35c; background: #161c26; }
</style>
<nav class="admin-tabs">
  <?php foreach ($navTabs as [$id, $href, $label]): ?>
    <a href="<?= $href ?>" class="<?= $id === $navActive ? 'active' : '' ?>"><?= $label ?></a>
  <?php endforeach; ?>
</nav>
