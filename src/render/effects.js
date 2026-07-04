// Transient particles fed by sim events. Render-only: uses Math.random
// freely because nothing here feeds back into the simulation.

import { TEAM_COLORS } from './renderer.js';

export class Effects {
  constructor() {
    this.particles = [];
  }

  reset() {
    this.particles = [];
  }

  spawnFromEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          this.burst(e.x, e.y, e.big ? 4 : 1, '#ffffff', 60, 0.18, 2);
          break;
        case 'death':
          this.burst(e.x, e.y, 8, TEAM_COLORS[e.team], 120, 0.45, 3);
          break;
        case 'explosion':
          this.burst(e.x, e.y, 14, '#ffb347', 180, 0.4, 3.5);
          break;
        case 'structureDestroyed':
          this.burst(e.x, e.y, 26, '#ffb347', 240, 0.7, 4.5);
          this.burst(e.x, e.y, 12, TEAM_COLORS[e.team], 160, 0.9, 3);
          break;
        case 'heal':
          this.burst(e.x, e.y, 2, '#58d68d', 40, 0.5, 2, -40);
          break;
      }
    }
  }

  burst(x, y, count, color, speed, life, size, vyBias = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + vyBias,
        life, maxLife: life,
        color, size,
      });
    }
    // keep the pool bounded
    if (this.particles.length > 600) {
      this.particles.splice(0, this.particles.length - 600);
    }
  }

  update(dt) {
    const alive = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alive.push(p);
    }
    this.particles = alive;
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
