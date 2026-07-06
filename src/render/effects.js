// Transient particles fed by sim events. Render-only: uses Math.random
// freely because nothing here feeds back into the simulation.

import { TEAM_COLORS } from './renderer.js';
import { hasDeathAnim, drawCharacter, sizeOf } from './characters.js';
import { raceOf } from './sprites.js';
import { ABILITIES } from '../abilities.js';

const CORPSE_LIFE = 1.2;

export class Effects {
  constructor() {
    this.particles = [];
    this.corpses = [];
    this.rings = []; // expanding spell rings (dispell etc.)
  }

  reset() {
    this.particles = [];
    this.corpses = [];
    this.rings = [];
  }

  spawnFromEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          this.burst(e.x, e.y, e.big ? 4 : 1, '#ffffff', 60, 0.18, 2);
          break;
        case 'death':
          if (hasDeathAnim(e.unitType, e.team)) {
            // character units play their 2-frame die animation, then fade
            this.corpses.push({ type: e.unitType, team: e.team, x: e.x, y: e.y, t: 0 });
            this.burst(e.x, e.y, 4, TEAM_COLORS[e.team], 90, 0.3, 2.5);
          } else {
            this.burst(e.x, e.y, 8, TEAM_COLORS[e.team], 120, 0.45, 3);
          }
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
        case 'cast': {
          const color = (ABILITIES[e.ability] || {}).color || '#ffffff';
          if (e.ability === 'dispell') {
            // expanding holy ring over the cleansed area + rising sparks
            this.rings.push({ x: e.x, y: e.y, r0: 12, r1: e.radius || 90, life: 0.55, maxLife: 0.55, color });
            this.burst(e.x, e.y, 10, color, 70, 0.5, 2, -50);
          } else if (e.ability === 'frostbolt') {
            // icy muzzle sparkle at the caster
            this.burst(e.x, e.y, 6, color, 90, 0.3, 2);
          } else {
            this.burst(e.x, e.y, 6, color, 80, 0.4, 2);
          }
          break;
        }
        case 'abilityHit': {
          const color = (ABILITIES[e.ability] || {}).color || '#8fe3ff';
          this.rings.push({ x: e.x, y: e.y, r0: 4, r1: 26, life: 0.3, maxLife: 0.3, color });
          this.burst(e.x, e.y, 8, color, 110, 0.35, 2);
          break;
        }
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
    this.corpses = this.corpses.filter((c) => (c.t += dt) < CORPSE_LIFE);
    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
  }

  // Drawn by the renderer beneath the living units.
  drawCorpses(ctx) {
    for (const c of this.corpses) {
      const frame = c.t < 0.25 ? 0 : 1;
      ctx.save();
      ctx.globalAlpha = c.t < 0.5 ? 1 : Math.max(0, 1 - (c.t - 0.5) / (CORPSE_LIFE - 0.5));
      ctx.translate(c.x, c.y);
      if (c.team === 1) ctx.scale(-1, 1);
      drawCharacter(ctx, c.type, 'die', frame, c.team, sizeOf(raceOf(c.team), c.type));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  draw(ctx) {
    // expanding spell rings (double stroke for a soft glow)
    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      const rad = r.r0 + (r.r1 - r.r0) * t;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 0.7 * (1 - t);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.25 * (1 - t);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
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
