// Downloadable design guide for a race's HALF-of-the-field background. It draws
// the play zones (base/construction, army/units, mid turret pocket, main base
// and starting turret) at their real sim coordinates so uploaded map art can be
// aligned to them. Exported at 2× → 3600×1920, matching the recommended
// background resolution (the half is 1800×960 sim units).
//
// All positions come straight from CONFIG (team 0 / left half), so this stays
// in sync with the actual battlefield layout.

import { CONFIG } from '../config.js';

const SCALE = 2; // half is 1800×960; 2× = 3600×1920 (the recommended bg size)

export function renderMapTemplate() {
  const W = CONFIG.FIELD_W / 2;   // 1800 — one race's half
  const H = CONFIG.FIELD_H;       // 960
  const cv = document.createElement('canvas');
  cv.width = W * SCALE;
  cv.height = H * SCALE;
  const ctx = cv.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // checkerboard so transparent areas stay visible while painting
  ctx.fillStyle = '#20262f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#252c36';
  for (let y = 0; y < H; y += 32) for (let x = 0; x < W; x += 32) {
    if (((x / 32) + (y / 32)) % 2 === 0) ctx.fillRect(x, y, 32, 32);
  }

  // faint placement grid (every cell) so decorations can snap by eye
  ctx.strokeStyle = 'rgba(190,210,235,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += CONFIG.GRID) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += CONFIG.GRID) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  const box = (x0, y0, x1, y1, color, label) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 1.5, y0 + 1.5, (x1 - x0) - 3, (y1 - y0) - 3);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = 'bold 22px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x0 + 8, y0 + 8);
    ctx.restore();
  };
  const disc = (cx, cy, r, color, label) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy - r - 8);
    ctx.restore();
  };

  const cz = CONFIG.CONSTRUCTION_ZONE[0];
  const az = CONFIG.ARMY_ZONE[0];
  const mz = CONFIG.MID_BUILD_ZONE[0];
  box(cz.x0, cz.y0, cz.x1, cz.y1, 'rgba(120,200,255,0.95)', 'ZONĂ CONSTRUCȚIE / BAZĂ');
  box(az.x0, az.y0, az.x1, az.y1, 'rgba(120,255,170,0.95)', 'ZONĂ UNITĂȚI (ARMY)');
  box(mz.x0, mz.y0, mz.x1, mz.y1, 'rgba(255,180,120,0.95)', 'CONSTRUCȚIE MIJLOC');
  disc(CONFIG.MAIN.x[0], CONFIG.MAIN.y, CONFIG.MAIN.radius, 'rgba(255,211,92,0.95)', 'BAZĂ');
  disc(CONFIG.TURRET_X[0], CONFIG.MAIN.y, (CONFIG.TURRET.radius || 24) + 4, 'rgba(255,150,150,0.95)', 'TURELĂ');

  // right edge = the middle of the whole field (meets the enemy half): keep it
  // neutral so the seam blends
  ctx.save();
  ctx.strokeStyle = 'rgba(230,230,235,0.5)';
  ctx.setLineDash([6, 10]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W - 1.5, 0);
  ctx.lineTo(W - 1.5, H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(230,230,235,0.85)';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('→ MIJLOC (ține-l neutru)', W - 10, 10);
  ctx.restore();

  ctx.fillStyle = 'rgba(255,211,92,0.95)';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Direct Strike — șablon hartă (o jumătate) · pictează SUB liniile ghid · exportă la EXACT ${W * SCALE}×${H * SCALE}px`, 10, H - 10);

  return { url: cv.toDataURL('image/png'), w: W * SCALE, h: H * SCALE };
}

export function downloadMapTemplate() {
  const { url, w, h } = renderMapTemplate();
  const a = document.createElement('a');
  a.href = url;
  a.download = `ds-harta-${w}x${h}.png`;
  a.click();
}
