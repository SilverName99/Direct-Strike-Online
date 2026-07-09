// Transient particles fed by sim events. Render-only: uses Math.random
// freely because nothing here feeds back into the simulation.

import { TEAM_COLORS } from './renderer.js';
import { hasDeathAnim, hasFootAnim, hasBeastAnim, drawCharacter, drawTowerDie, sizeOf } from './characters.js';
import { raceOf } from './sprites.js';
import { ABILITIES } from '../abilities.js';
import { drawExpandingRing } from './vfx.js';

const CORPSE_LIFE = 1.2;
const STRUCT_CORPSE_LIFE = 1.6; // rubble lingers a touch longer than a body

export class Effects {
  constructor() {
    this.particles = [];
    this.corpses = [];
    this.structCorpses = []; // toppled towers showing their per-tier die frame
    this.rings = []; // expanding spell rings (dispell etc.)
  }

  reset() {
    this.particles = [];
    this.corpses = [];
    this.structCorpses = [];
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
            // character units play their die animation, then fade; a dismounted
            // unit uses its on-foot "foot-die" frame, a split mount "beast-die"
            this.corpses.push({ type: e.unitType, team: e.team, x: e.x, y: e.y, t: 0, dismounted: !!e.dismounted, beast: !!e.beast, footScale: e.footScale });
            this.burst(e.x, e.y, 4, TEAM_COLORS[e.team], 90, 0.3, 2.5);
          } else {
            this.burst(e.x, e.y, 8, TEAM_COLORS[e.team], 120, 0.45, 3);
          }
          break;
        case 'explosion':
          this.burst(e.x, e.y, 14, e.acid ? '#8fd14f' : '#ffb347', 180, 0.4, 3.5);
          if (e.acid) this.rings.push({ x: e.x, y: e.y, r0: 4, r1: (e.radius || 90), life: 0.5, maxLife: 0.5, color: '#8fd14f' });
          break;
        case 'dash': {
          // charge impact: a quick ring + a spray of chips at the target
          const c = TEAM_COLORS[e.team];
          this.rings.push({ x: e.tx, y: e.ty, r0: 4, r1: 30, life: 0.26, maxLife: 0.26, color: c });
          this.burst(e.tx, e.ty, 9, c, 160, 0.3, 2.5);
          break;
        }
        case 'dismount':
          // the mount flees: a low dust puff kicked up at the rider's feet
          this.burst(e.x, e.y + 6, 10, '#b39373', 130, 0.5, 3);
          break;
        case 'structureDestroyed':
          this.burst(e.x, e.y, 26, '#ffb347', 240, 0.7, 4.5);
          this.burst(e.x, e.y, 12, TEAM_COLORS[e.team], 160, 0.9, 3);
          // a toppled tower leaves its per-tier "die" frame crumbling in place
          if (e.kind === 'tower') {
            this.structCorpses.push({ team: e.team, tier: e.tier || 1, x: e.x, y: e.y, hw: e.hw || 20, hh: e.hh || 20, t: 0 });
          }
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
          } else if (e.ability === 'heal') {
            // green motes rising off the healed ally + a soft ring
            this.rings.push({ x: e.x, y: e.y, r0: 4, r1: 24, life: 0.4, maxLife: 0.4, color });
            this.burst(e.x, e.y, 8, color, 45, 0.6, 2, -55);
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
    this.structCorpses = this.structCorpses.filter((c) => (c.t += dt) < STRUCT_CORPSE_LIFE);
    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
  }

  // Toppled towers: their per-tier "die" frame, fading out where they fell.
  // Drawn at the structure layer (under units), mirrored for team 1 like the
  // living building was.
  drawStructureCorpses(ctx) {
    for (const c of this.structCorpses) {
      ctx.save();
      ctx.globalAlpha = c.t < 0.8 ? 1 : Math.max(0, 1 - (c.t - 0.8) / (STRUCT_CORPSE_LIFE - 0.8));
      ctx.translate(c.x, c.y);
      if (c.team === 1) ctx.scale(-1, 1);
      drawTowerDie(ctx, c.team, c.tier, c.hw, c.hh);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Drawn by the renderer beneath the living units.
  drawCorpses(ctx) {
    for (const c of this.corpses) {
      const frame = c.t < 0.25 ? 0 : 1;
      ctx.save();
      ctx.globalAlpha = c.t < 0.5 ? 1 : Math.max(0, 1 - (c.t - 0.5) / (CORPSE_LIFE - 0.5));
      ctx.translate(c.x, c.y);
      if (c.team === 1) ctx.scale(-1, 1);
      const anim = c.beast && hasBeastAnim(c.type, c.team, 'die') ? 'beast-die'
        : c.dismounted && hasFootAnim(c.type, c.team, 'die') ? 'foot-die' : 'die';
      const scale = (c.dismounted || c.beast) && c.footScale != null ? c.footScale : sizeOf(raceOf(c.team), c.type);
      drawCharacter(ctx, c.type, anim, frame, c.team, scale);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  draw(ctx) {
    // expanding spell rings (double stroke for a soft glow)
    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      const rad = r.r0 + (r.r1 - r.r0) * t;
      drawExpandingRing(ctx, r.x, r.y, rad, 1 - t, r.color);
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
