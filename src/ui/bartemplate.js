// Downloadable design guide for the bottom bar. The layout below mirrors the
// CSS-defined bar (style.css #bottombar and children) at its base (un-skinned)
// positions, captured once — so this works BOTH from the in-game 🎨 button and
// from the admin page (which has no live bar). Exported at 3× for crisp art.
//
// If the bar's CSS layout changes, update LAYOUT here to match.

const SCALE = 3; // export multiple (bar is ~1150×190 CSS px; 3× stays crisp on high-DPI)

const LAYOUT = {
  W: 1150,
  H: 190,
  // the curved silhouette outline (one path around the whole bar)
  path: 'M0,190 L0,64 Q0,50 14,50 L831,50 Q838,50 838,43 L838,10 Q838,0 848,0 L1116,0 Q1126,0 1126,10 L1126,43 Q1126,50 1133,50 L1136,50 Q1150,50 1150,64 L1150,190 Z',
  boxes: [
    { x: 24, y: 58, w: 380, h: 124, label: 'HARTĂ' },
    { x: 414, y: 58, w: 124, h: 124, label: 'PORTRET' },
    { x: 548, y: 58, w: 280, h: 124, label: 'DETALII' },
    // 3×3 command slots
    ...[[845, 7], [902, 7], [959, 7], [845, 64], [902, 64], [959, 64], [845, 121], [902, 121], [959, 121]]
      .map(([x, y], i) => ({ x, y, w: 54, h: 54, label: `#${i + 1}` })),
    { x: 1036, y: 6, w: 84, h: 82, label: 'UNITS' },
    { x: 1036, y: 94, w: 84, h: 82, label: 'CLĂDIRI' },
  ],
};

// Build the guide as a PNG data URL (transparent-friendly checkerboard behind).
export function renderBarTemplate() {
  const { W, H } = LAYOUT;
  const cv = document.createElement('canvas');
  cv.width = W * SCALE;
  cv.height = H * SCALE;
  const ctx = cv.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // checkerboard so transparent areas are visible while editing
  ctx.fillStyle = '#20262f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#252c36';
  for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) {
    if (((x / 16) + (y / 16)) % 2 === 0) ctx.fillRect(x, y, 16, 16);
  }
  // silhouette guide
  const path = new Path2D(LAYOUT.path);
  ctx.fillStyle = 'rgba(16,21,30,0.55)';
  ctx.fill(path);
  ctx.strokeStyle = 'rgba(190,210,235,0.95)';
  ctx.lineWidth = 2;
  ctx.stroke(path);
  // labeled zone boxes
  for (const bx of LAYOUT.boxes) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,200,255,0.95)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx.x + 0.5, bx.y + 0.5, bx.w - 1, bx.h - 1);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(150,215,255,0.95)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(bx.label, bx.x + 4, bx.y + 3);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,211,92,0.95)';
  ctx.font = 'bold 12px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Direct Strike — șablon meniu jos · exportă la EXACT ${W * SCALE}×${H * SCALE}px (nu redimensiona) · pictează SUB elemente`, 8, H - 6);
  return { url: cv.toDataURL('image/png'), w: W * SCALE, h: H * SCALE };
}

// Trigger a browser download of the guide.
export function downloadBarTemplate() {
  const { url, w, h } = renderBarTemplate();
  const a = document.createElement('a');
  a.href = url;
  a.download = `ds-bara-jos-${w}x${h}.png`;
  a.click();
}
