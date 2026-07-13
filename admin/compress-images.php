<?php
// Batch image optimizer — admin only. Walks assets/ and losslessly re-encodes
// every PNG/WEBP with GD, keeping the result ONLY when it comes out smaller.
// Runs in TIME-BUDGETED chunks: each POST processes files starting at `offset`
// for a few seconds, then returns the next offset + running totals, so the
// client can loop and show x/y progress without ever hitting a server timeout.

declare(strict_types=1);
session_start();
define('DS_ADMIN', 1);
header('Content-Type: application/json');

if (empty($_SESSION['auth'])) { http_response_code(401); echo json_encode(['error' => 'auth']); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'method']); exit; }
if (($_SERVER['HTTP_X_DS_COMPRESS'] ?? '') !== '1') { http_response_code(400); echo json_encode(['error' => 'header']); exit; }
if (!function_exists('imagecreatefromstring')) { echo json_encode(['error' => 'GD nu este disponibil pe server']); exit; }

@set_time_limit(0);
@ini_set('memory_limit', '512M');

// Re-encode one image losslessly; returns the new size (== original if it did
// not shrink / could not be optimized), or null on read/decode failure.
function optimizeImage(string $path, string $ext): ?int {
  $orig = @filesize($path);
  if ($orig === false) return null;
  $data = @file_get_contents($path);
  if ($data === false) return null;
  $img = @imagecreatefromstring($data);
  if (!$img) return null;

  $tmp = $path . '.cmp';
  $ok = false;
  if ($ext === 'png') {
    imagealphablending($img, false);
    imagesavealpha($img, true);
    $ok = @imagepng($img, $tmp, 9); // max zlib level, strips metadata — LOSSLESS
  } elseif ($ext === 'webp' && function_exists('imagewebp')) {
    imagealphablending($img, false);
    imagesavealpha($img, true);
    $q = defined('IMG_WEBP_LOSSLESS') ? IMG_WEBP_LOSSLESS : 100; // LOSSLESS webp
    $ok = @imagewebp($img, $tmp, $q);
  }
  imagedestroy($img);

  if ($ok && is_file($tmp)) {
    $new = filesize($tmp);
    if ($new > 0 && $new < $orig) { @rename($tmp, $path); return $new; }
    @unlink($tmp); // never keep a bigger (or equal) file
  }
  return $orig;
}

$assets = dirname(__DIR__) . '/assets';
$exts = ['png', 'webp']; // strictly-lossless formats only (JPG left untouched)

// Full, stable list of image paths (paths don't change across chunks — files
// are only shrunk in place — so `offset` stays valid between requests).
$files = [];
if (is_dir($assets)) {
  $it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($assets, FilesystemIterator::SKIP_DOTS)
  );
  foreach ($it as $f) {
    if ($f->isFile() && in_array(strtolower($f->getExtension()), $exts, true)) $files[] = $f->getPathname();
  }
  sort($files);
}
$total = count($files);

$offset = max(0, (int)($_POST['offset'] ?? 0));
$BUDGET = 8.0; // seconds of work per request (well under any server timeout)
$start = microtime(true);

$processed = 0; $optimized = 0; $errors = 0; $before = 0; $after = 0;
$i = $offset;
for (; $i < $total; $i++) {
  if ($i > $offset && (microtime(true) - $start) > $BUDGET) break; // budget spent (always do >=1)
  $path = $files[$i];
  $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
  $orig = @filesize($path);
  if ($orig === false) { $errors++; continue; }
  $res = optimizeImage($path, $ext);
  if ($res === null) { $errors++; continue; }
  $processed++;
  $before += $orig;
  $after += $res;
  if ($res < $orig) $optimized++;
}

$next = $i < $total ? $i : null;
echo json_encode([
  'ok' => true,
  'total' => $total,
  'next' => $next,
  'done' => $next === null,
  'processed' => $processed,
  'optimized' => $optimized,
  'errors' => $errors,
  'before' => $before,
  'after' => $after,
]);
