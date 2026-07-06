// Shared procedural spell VFX primitives. One source of truth so the live
// game (renderer.js / effects.js) and the admin ability previews draw the
// exact same look. Every function draws at the current ctx origin and takes
// its own `now` clock (seconds), so callers translate first.

// Rotating rune circle underfoot + faint true-radius ring (auras).
export function drawAura(ctx, now, color, radius, i = 0) {
  const spin = now * 0.9 + i * 2.1;
  ctx.save();
  ctx.translate(0, 3);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.06;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 2;
  ctx.scale(1, 0.45); // flatten for a ground-plane look
  const rr = 15 + i * 4;
  for (let k = 0; k < 3; k++) {
    const a0 = spin + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(0, 0, rr, a0, a0 + 1.2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Slowed unit: a clear blue chill wash over the body, a frosty glow ring at
// the feet, and snowflakes drifting down (frost/chill look).
export function drawSlow(ctx, now, r, seed = 0) {
  ctx.save();
  // blue tint over the unit (fades out at the edges)
  const g = ctx.createRadialGradient(0, -r * 0.2, r * 0.15, 0, -r * 0.2, r * 1.2);
  g.addColorStop(0, 'rgba(120,180,255,0.55)');
  g.addColorStop(0.6, 'rgba(110,170,255,0.32)');
  g.addColorStop(1, 'rgba(120,175,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, -r * 0.2, r * 1.2, 0, Math.PI * 2);
  ctx.fill();
  // frosty glow ring hugging the ground, pulsing gently
  const pulse = 0.5 + 0.5 * Math.sin(now * 2 + seed);
  ctx.save();
  ctx.translate(0, r * 0.75);
  ctx.scale(1, 0.4);
  ctx.strokeStyle = '#bfe0ff';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.35 + 0.25 * pulse;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // falling snowflakes — more of them, clearly visible
  ctx.fillStyle = '#eaf4ff';
  for (let k = 0; k < 9; k++) {
    const ph = (now * 0.45 + k * 0.29 + seed * 0.13) % 1;
    const sx = Math.sin((k + seed) * 2.3) * r * 1.0 + Math.sin(now * 1.6 + k) * 2;
    const sy = -r - 4 + ph * (r * 2.6);
    ctx.globalAlpha = 0.8 * Math.sin(ph * Math.PI); // fade in near the top, out near the bottom
    ctx.beginPath();
    ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Golden sparks circling a hasted unit.
export function drawHasteSparks(ctx, now, r) {
  ctx.save();
  ctx.fillStyle = '#ffd35c';
  ctx.globalAlpha = 0.9;
  for (let k = 0; k < 3; k++) {
    const a = now * 5 + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * (r + 5), Math.sin(a) * (r + 5) * 0.6, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Green cross drifting upward, looping (regeneration).
export function drawRegenCross(ctx, now, r) {
  const ph = (now % 1.2) / 1.2;
  ctx.save();
  ctx.fillStyle = '#58d68d';
  ctx.globalAlpha = 0.9 * (1 - ph);
  const cy = -r - 6 - ph * 8;
  ctx.fillRect(-1.5, cy - 4, 3, 8);
  ctx.fillRect(-4, cy - 1.5, 8, 3);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// White halo around a dispell-immune unit.
export function drawImmuneHalo(ctx, r) {
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Expanding double-stroke ring (dispell / ability impact). `fade` is 1→0.
export function drawExpandingRing(ctx, x, y, rad, fade, color) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.7 * fade;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.25 * fade;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// Glowing ability projectile (frost bolt etc.).
export function drawSpellProjectile(ctx, x, y, size, color) {
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, size * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
}
