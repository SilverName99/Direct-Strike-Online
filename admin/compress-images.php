<?php
// Batch image optimizer — admin only. Walks assets/ and losslessly re-encodes
// every raster image (PNG/JPG/WEBP) with GD, keeping the result ONLY when it
// comes out smaller. PNG/WEBP keep full alpha; nothing is quantized, so quality
// is preserved. Triggered by a button on the Balance page.

declare(strict_types=1);
session_start();
define('DS_ADMIN', 1);
header('Content-Type: application/json');

if (empty($_SESSION['auth'])) { http_response_code(401); echo json_encode(['error' => 'auth']); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'method']); exit; }
// lightweight cross-site guard (same idea as save-balance.php)
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
    $ok = @imagepng($img, $tmp, 9); // max zlib level, strips metadata (lossless)
  } elseif ($ext === 'jpg' || $ext === 'jpeg') {
    $ok = @imagejpeg($img, $tmp, 90);
  } elseif ($ext === 'webp' && function_exists('imagewebp')) {
    imagealphablending($img, false);
    imagesavealpha($img, true);
    $ok = @imagewebp($img, $tmp, 90);
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
$exts = ['png', 'jpg', 'jpeg', 'webp'];
$processed = 0; $optimized = 0; $errors = 0; $before = 0; $after = 0;

if (is_dir($assets)) {
  $it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($assets, FilesystemIterator::SKIP_DOTS)
  );
  foreach ($it as $f) {
    if (!$f->isFile()) continue;
    $ext = strtolower($f->getExtension());
    if (!in_array($ext, $exts, true)) continue;
    $path = $f->getPathname();
    $orig = @filesize($path);
    if ($orig === false) { $errors++; continue; }
    $res = optimizeImage($path, $ext);
    if ($res === null) { $errors++; continue; }
    $processed++;
    $before += $orig;
    $after += $res;
    if ($res < $orig) $optimized++;
  }
}

echo json_encode([
  'ok' => true,
  'processed' => $processed,
  'optimized' => $optimized,
  'errors' => $errors,
  'before' => $before,
  'after' => $after,
]);
