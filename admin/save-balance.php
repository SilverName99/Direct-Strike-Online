<?php
// Balance save endpoint. POST (admin session required) writes the game's
// balance overrides to assets/balance.json; the game applies that file at
// boot. GET returns the current file (the game normally reads the static
// file directly — GET here is a convenience).

declare(strict_types=1);
session_start();
define('DS_ADMIN', 1);
header('Content-Type: application/json');

$file = dirname(__DIR__) . '/assets/balance.json';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  echo is_file($file) ? file_get_contents($file) : '{}';
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo '{"error":"method"}';
  exit;
}

if (empty($_SESSION['auth'])) {
  http_response_code(401);
  echo '{"error":"auth"}';
  exit;
}

// lightweight cross-site guard: the game always sends this header
if (($_SERVER['HTTP_X_DS_BALANCE'] ?? '') !== '1') {
  http_response_code(400);
  echo '{"error":"header"}';
  exit;
}

$raw = file_get_contents('php://input', false, null, 0, 2097152);
$data = json_decode($raw, true);
if (!is_array($data)) {
  http_response_code(400);
  echo '{"error":"json"}';
  exit;
}

// keep only known top-level sections; re-encode to sanitize
$clean = array_intersect_key($data, array_flip(['buildings', 'turret', 'mainHp', 'mainIdleSpeed', 'tierCosts', 'general', 'middles', 'middleEmpty', 'buildingSizes', 'tint', 'healthbarAlways', 'goldIcon', 'unitOrder', 'music', 'abilities', 'upgrades', 'races']));
@mkdir(dirname($file), 0755, true);
if (file_put_contents($file, json_encode($clean, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)) === false) {
  http_response_code(500);
  echo '{"error":"write"}';
  exit;
}
echo '{"ok":true}';
