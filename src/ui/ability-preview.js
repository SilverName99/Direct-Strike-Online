// Looping mini-scene previews of each ability's procedural VFX, for the
// admin "Abilități" page. Uses the SAME primitives as the live game
// (src/render/vfx.js), so what you see here is what you get in a match.

import { ABILITIES } from '../abilities.js';
import {
  drawAura, drawSlowSwirl, drawHasteSparks, drawRegenCross, drawImmuneHalo,
  drawExpandingRing, drawSpellProjectile,
} from '../render/vfx.js';

const CAST_EVERY = 1.7; // seconds between active-ability demo casts

function makeScene(canvas, id) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 150;
  const H = canvas.clientHeight || 84;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const color = (ABILITIES[id] || {}).color || '#ffffff';
  const s = { particles: [], rings: [], proj: null, castTimer: 0.6, fxUntil: 0 };

  function burst(x, y, count, c, speed, life, size, vyBias = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      s.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + vyBias, life, maxLife: life, color: c, size });
    }
  }

  function figure(x, y, c) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(x, y, 5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - 8.5, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const ally = '#8fa6c4';
  const foe = '#c47f8a';

  function stepFx(now, dt) {
    for (const p of s.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    s.particles = s.particles.filter((p) => p.life > 0);
    for (const r of s.rings) r.life -= dt;
    s.rings = s.rings.filter((r) => r.life > 0);
  }

  function drawFx() {
    for (const r of s.rings) {
      const t = 1 - r.life / r.maxLife;
      const rad = r.r0 + (r.r1 - r.r0) * t;
      drawExpandingRing(ctx, r.x, r.y, rad, 1 - t, r.color);
    }
    for (const p of s.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function marker(x, y, fn, now) {
    ctx.save();
    ctx.translate(x, y);
    fn(ctx, now, 9);
    ctx.restore();
  }

  return {
    step(now, dt) {
      ctx.clearRect(0, 0, W, H);
      stepFx(now, dt);

      if (id === 'slowaura' || id === 'hasteaura' || id === 'regenaura') {
        const cx = W / 2;
        const cy = H / 2 + 4;
        ctx.save(); ctx.translate(cx, cy); drawAura(ctx, now, color, 34, 0); ctx.restore();
        const others = id === 'slowaura' ? foe : ally;
        const xs = [cx - 34, cx + 34];
        for (const x of xs) {
          figure(x, cy, others);
          if (id === 'slowaura') marker(x, cy, drawSlowSwirl, now);
          else if (id === 'hasteaura') marker(x, cy, drawHasteSparks, now);
          else marker(x, cy, drawRegenCross, now);
        }
        if (id === 'regenaura' && Math.random() < dt * 6) burst(xs[(Math.random() * 2) | 0], cy, 1, '#58d68d', 20, 0.6, 1.6, -30);
        figure(cx, cy, color);
      } else if (id === 'heal') {
        const cx = W * 0.26, cy = H * 0.55;
        const tx = W * 0.7, ty = H * 0.5;
        s.castTimer -= dt;
        if (s.castTimer <= 0) {
          s.castTimer = 1.2;
          s.rings.push({ x: tx, y: ty, r0: 4, r1: 24, life: 0.4, maxLife: 0.4, color });
          burst(tx, ty, 8, color, 40, 0.6, 1.8, -45);
        }
        drawFx();
        figure(cx, cy, color);
        figure(tx, ty, ally);
      } else if (id === 'dispell') {
        const cx = W * 0.24, cy = H * 0.55;
        const tx = W * 0.7, ty = H * 0.5;
        s.castTimer -= dt;
        if (s.castTimer <= 0) {
          s.castTimer = CAST_EVERY;
          s.rings.push({ x: tx, y: ty, r0: 8, r1: Math.min(W, H) * 0.42, life: 0.55, maxLife: 0.55, color });
          burst(tx, ty, 10, color, 60, 0.5, 1.8, -40);
          s.fxUntil = now + 1.3;
        }
        drawFx();
        figure(cx, cy, color);
        figure(tx, ty, ally);
        if (now < s.fxUntil) marker(tx, ty, drawImmuneHalo, now);
      } else if (id === 'frostbolt') {
        const cx = W * 0.18, cy = H * 0.55;
        const tx = W * 0.82, ty = H * 0.5;
        s.castTimer -= dt;
        if (!s.proj && s.castTimer <= 0) {
          s.castTimer = CAST_EVERY;
          s.proj = { x: cx, y: cy };
          burst(cx, cy, 5, color, 60, 0.3, 1.5);
        }
        if (s.proj) {
          const dx = tx - s.proj.x, dy = ty - s.proj.y;
          const d = Math.hypot(dx, dy) || 1;
          const step = 150 * dt;
          if (d <= step) {
            s.rings.push({ x: tx, y: ty, r0: 3, r1: 22, life: 0.3, maxLife: 0.3, color });
            burst(tx, ty, 8, color, 90, 0.35, 1.6);
            s.fxUntil = now + 1.3;
            s.proj = null;
          } else {
            s.proj.x += (dx / d) * step;
            s.proj.y += (dy / d) * step;
          }
        }
        drawFx();
        figure(cx, cy, color);
        figure(tx, ty, foe);
        if (s.proj) drawSpellProjectile(ctx, s.proj.x, s.proj.y, 3.5, color);
        if (now < s.fxUntil) marker(tx, ty, drawSlowSwirl, now);
      } else {
        drawFx();
      }
    },
  };
}

export function mountAbilityPreviews(entries) {
  const scenes = entries.map(({ canvas, id }) => makeScene(canvas, id));
  let last = performance.now();
  let raf = 0;
  const frame = (t) => {
    const now = t / 1000;
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    for (const sc of scenes) sc.step(now, dt);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
