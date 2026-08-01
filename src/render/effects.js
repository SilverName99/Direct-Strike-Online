// Transient particles fed by sim events. Render-only: uses Math.random
// freely because nothing here feeds back into the simulation.

import { TEAM_COLORS } from './renderer.js';
import { hasDeathAnim, hasFootAnim, hasBeastAnim, hasSummonAnim, hasExplosionAnim, drawCharacter, drawTowerDie, sizeOf, animFrames, phaseFrame, animFps } from './characters.js';
import { raceOf, getAbilityFx } from './sprites.js';
import { ABILITIES } from '../abilities.js';
import { drawExpandingRing } from './vfx.js';

const CORPSE_LIFE = 1.2;
const STRUCT_CORPSE_LIFE = 1.6; // rubble lingers a touch longer than a body
const BLAST_LIFE = 0.5; // Kamikaze detonation sprite flashes briefly

export class Effects {
  constructor() {
    this.particles = [];
    this.corpses = [];
    this.structCorpses = []; // toppled towers showing their per-tier die frame
    this.blasts = []; // Kamikaze detonation frames (unit's "Explozie" sprite)
    this.rings = []; // expanding spell rings (dispell etc.)
    this.domes = []; // uploaded AoE effect images scaled to an ability's radius
    this.portals = []; // Backline Teleport landing telegraphs (golden swirl)
    this.souls = []; // green orbs flying from a corpse to the Undead soul hero
  }

  reset() {
    this.particles = [];
    this.corpses = [];
    this.structCorpses = [];
    this.blasts = [];
    this.rings = [];
    this.domes = [];
    this.portals = [];
    this.souls = [];
  }

  spawnFromEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          this.burst(e.x, e.y, e.big ? 4 : 1, '#ffffff', 60, 0.18, 2);
          break;
        case 'death': {
          // a summoned animal plays its own "<animal>-die"; otherwise the unit's
          // die frame (on-foot / beast variants for split forms)
          const art = e.owner != null ? e.owner : e.team; // whose race drew this unit
          const hasDie = e.summonKind
            ? hasSummonAnim(e.unitType, art, e.summonKind, 'die')
            : hasDeathAnim(e.unitType, art);
          if (hasDie) {
            this.corpses.push({ type: e.unitType, team: e.team, art, x: e.x, y: e.y, t: 0, dismounted: !!e.dismounted, beast: !!e.beast, summonKind: e.summonKind || null, footScale: e.footScale });
            this.burst(e.x, e.y, 4, TEAM_COLORS[e.team], 90, 0.3, 2.5);
          } else {
            this.burst(e.x, e.y, 8, TEAM_COLORS[e.team], 120, 0.45, 3);
          }
          break;
        }
        case 'soul':
          // Soul Collector: a green orb leaves the corpse and flies to the hero.
          // It stores the hero's ID (not a position), so the orb tracks him
          // while he keeps walking.
          this.souls.push({ x: e.x, y: e.y, x0: e.x, y0: e.y, heroId: e.heroId, t: 0, life: 0.65 });
          break;
        case 'explosion':
          this.burst(e.x, e.y, e.blast ? 26 : e.fire ? 20 : 14, e.acid ? '#8fd14f' : e.fire ? '#ff7a1a' : '#ffb347', e.blast ? 240 : e.fire ? 210 : 180, e.blast ? 0.5 : 0.45, e.blast ? 4.5 : e.fire ? 4 : 3.5);
          if (e.acid) this.rings.push({ x: e.x, y: e.y, r0: 4, r1: (e.radius || 90), life: 0.5, maxLife: 0.5, color: '#8fd14f' });
          if (e.fire) this.rings.push({ x: e.x, y: e.y, r0: 6, r1: (e.radius || 90), life: 0.45, maxLife: 0.45, color: '#ff9636' });
          // Kamikaze blast: a bright shockwave ring scaled to the actual radius
          if (e.blast) this.rings.push({ x: e.x, y: e.y, r0: 8, r1: (e.radius || 100), life: 0.4, maxLife: 0.4, color: '#ffd27a' });
          // ...and the unit's own "Explozie" detonation sprite, if uploaded
          if (e.blast && e.unitType && hasExplosionAnim(e.unitType, e.owner != null ? e.owner : e.team)) {
            this.blasts.push({ type: e.unitType, team: e.team, art: e.owner != null ? e.owner : e.team, x: e.x, y: e.y, t: 0 });
          }
          break;
        case 'dash': {
          // charge impact: a quick ring + a spray of chips at the target
          const c = TEAM_COLORS[e.team];
          this.rings.push({ x: e.tx, y: e.ty, r0: 4, r1: 30, life: 0.26, maxLife: 0.26, color: c });
          this.burst(e.tx, e.ty, 9, c, 160, 0.3, 2.5);
          break;
        }
        case 'teleportcharge':
          // Backline Teleport wind-up: a golden swirling portal telegraphs the
          // landing spot for the whole prepare duration
          this.portals.push({ x: e.x, y: e.y, t: 0, life: Math.max(0.12, e.dur || 0.35), acc: 0 });
          break;
        case 'teleport': {
          // Backline Teleport: a puff at departure + a bright arrival burst where
          // the portal was
          this.burst(e.x, e.y, 10, '#cfefff', 150, 0.3, 2.5);
          this.rings.push({ x: e.tx, y: e.ty, r0: 6, r1: 44, life: 0.4, maxLife: 0.4, color: '#ffe08a' });
          this.burst(e.tx, e.ty, 16, '#ffe08a', 220, 0.4, 3, -40);
          break;
        }
        case 'dismount':
          // the mount flees: a low dust puff kicked up at the rider's feet
          this.burst(e.x, e.y + 6, 10, '#b39373', 130, 0.5, 3);
          break;
        case 'dig':
          // Grave Digger throws up a small puff of dirt as a corpse comes out
          this.burst(e.x, e.y + 6, 8, '#8a6a44', 110, 0.5, 3);
          break;
        case 'structureDestroyed':
          this.burst(e.x, e.y, 26, '#ffb347', 240, 0.7, 4.5);
          this.burst(e.x, e.y, 12, TEAM_COLORS[e.team], 160, 0.9, 3);
          // a toppled tower leaves its per-tier "die" frame crumbling in place
          if (e.kind === 'tower') {
            this.structCorpses.push({ team: e.team, art: e.owner != null ? e.owner : e.team, tier: e.tier || 1, x: e.x, y: e.y, hw: e.hw || 20, hh: e.hh || 20, t: 0 });
          }
          break;
        case 'heal':
          this.burst(e.x, e.y, 2, '#58d68d', 40, 0.5, 2, -40);
          break;
        case 'shield':
          // Scut de lumină: a bright flash + expanding ring of light
          this.burst(e.x, e.y - 8, 14, '#fff6c0', 120, 0.5, 2.5, -30);
          this.rings.push({ x: e.x, y: e.y - 8, r0: 6, r1: 46, life: 0.5, maxLife: 0.5, color: '#ffe08a' });
          break;
        case 'cast': {
          const color = (ABILITIES[e.ability] || {}).color || '#ffffff';
          if (e.ability === 'holynova') {
            // holy dome: the uploaded effect image, drawn scaled to the ult's
            // heal radius, for the ult duration (falls back to a ring if no image)
            this.domes.push({
              x: e.x, y: e.y, radius: e.radius || 100,
              race: raceOf(e.team), ent: e.unitType || 'hero', ability: e.ability,
              t: 0, life: Math.max(0.6, e.dur || 1.5),
            });
            this.rings.push({ x: e.x, y: e.y, r0: 12, r1: e.radius || 100, life: 0.6, maxLife: 0.6, color });
            this.burst(e.x, e.y, 14, color, 60, 0.7, 2, -40);
          } else if (e.ability === 'dispell') {
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
    this.blasts = this.blasts.filter((b) => (b.t += dt) < BLAST_LIFE);
    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
    this.domes = this.domes.filter((d) => (d.t += dt) < d.life);
    // teleport portals: age them + keep spilling rising golden sparkles
    for (const pl of this.portals) {
      pl.t += dt; pl.acc += dt;
      while (pl.acc >= 0.03) {
        pl.acc -= 0.03;
        const a = Math.random() * Math.PI * 2;
        const rr = 24 + Math.random() * 12;
        this.particles.push({
          x: pl.x + Math.cos(a) * rr, y: pl.y + Math.sin(a) * rr * 0.4,
          vx: 0, vy: -70 - Math.random() * 90, life: 0.5, maxLife: 0.5, color: '#ffe08a', size: 2,
        });
      }
    }
    this.portals = this.portals.filter((pl) => pl.t < pl.life);
  }

  // Soul orbs: each one homes in on its hero's CURRENT position (he keeps
  // walking), easing in — slow at first, whipped in at the end — and bursts
  // into sparks when it lands. Purely cosmetic; the mana was already granted.
  updateSouls(dt, game) {
    if (!this.souls.length) return;
    const alive = [];
    for (const o of this.souls) {
      o.t += dt;
      const hero = game && game.byId ? game.byId.get(o.heroId) : null;
      if (!hero || hero.hp <= 0) continue; // he died mid-flight: the orb fades
      const k = Math.min(1, o.t / o.life);
      const ease = k * k * (3 - 2 * k) * 0.35 + k * k * k * 0.65; // slow, then whipped in
      o.x = o.x0 + (hero.x - o.x0) * ease;
      o.y = o.y0 + (hero.y - o.y0) * ease;
      // a short green trail behind it
      if (k < 0.95) {
        this.particles.push({
          x: o.x, y: o.y, vx: 0, vy: -8, life: 0.22, maxLife: 0.22, color: '#bdf24a', size: 1.6,
        });
      }
      if (k >= 1) { // arrival pop, right on the hero
        this.burst(hero.x, hero.y - 6, 7, '#bdf24a', 90, 0.3, 2, -30);
        this.rings.push({ x: hero.x, y: hero.y - 6, r0: 3, r1: 22, life: 0.28, maxLife: 0.28, color: '#bdf24a' });
        continue;
      }
      alive.push(o);
    }
    this.souls = alive;
  }

  // Drawn with the units (over the ground, under the HUD).
  drawSouls(ctx) {
    for (const o of this.souls) {
      const k = Math.min(1, o.t / o.life);
      const r = 4 + 2 * Math.sin(k * 12); // a soft pulse while it travels
      ctx.save();
      ctx.globalAlpha = 0.9;
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r * 2.4);
      g.addColorStop(0, 'rgba(238, 255, 190, 0.95)');
      g.addColorStop(0.45, 'rgba(189, 242, 74, 0.55)');
      g.addColorStop(1, 'rgba(189, 242, 74, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2ffcb';
      ctx.beginPath();
      ctx.arc(o.x, o.y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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
      drawTowerDie(ctx, c.art != null ? c.art : c.team, c.tier, c.hw, c.hh);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Drawn by the renderer beneath the living units.
  drawCorpses(ctx) {
    for (const c of this.corpses) {
      ctx.save();
      ctx.globalAlpha = c.t < 0.5 ? 1 : Math.max(0, 1 - (c.t - 0.5) / (CORPSE_LIFE - 0.5));
      ctx.translate(c.x, c.y);
      if (c.team === 1) ctx.scale(-1, 1);
      const art = c.art != null ? c.art : c.team;
      const anim = c.summonKind ? `${c.summonKind}-die`
        : c.beast && hasBeastAnim(c.type, art, 'die') ? 'beast-die'
        : c.dismounted && hasFootAnim(c.type, art, 'die') ? 'foot-die' : 'die';
      // The death PLAYS: the uploaded die frames run once and then hold the
      // last pose while the body fades. An explicit rate ("Moarte: cadre/s")
      // sets the length; without one, two frames keep the historical
      // 0.25s-then-flip timing exactly and more frames run at ~12 fps.
      const n = animFrames(c.type, art, anim);
      const fps = animFps(c.type, art, anim);
      const dur = fps > 0 ? n / fps : (n <= 2 ? 0.5 : n / 12);
      const frame = phaseFrame(c.type, art, anim, c.t / dur);
      // A corpse that carries its own scale uses it: the on-foot rider, the
      // split beast — and every SUMMON, whose sprites are hosted on the caster
      // but whose size is its own (a larva must not die at the moth's size).
      const scale = c.footScale != null ? c.footScale : sizeOf(raceOf(art), c.type);
      drawCharacter(ctx, c.type, anim, frame, art, scale);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  draw(ctx) {
    // AoE effect images (Holy Nova dome): centered on the caster, as wide as the
    // ability's radius (diameter = 2 * radius), bottom anchored at the feet.
    for (const d of this.domes) {
      const img = getAbilityFx(d.race, d.ent, d.ability);
      if (!img || !img.width) continue;
      const w = d.radius * 2;
      const h = w * (img.height / img.width);
      const fadeIn = Math.min(1, d.t / 0.2);
      const fadeOut = Math.min(1, (d.life - d.t) / 0.6);
      ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
      ctx.drawImage(img, d.x - w / 2, d.y - h, w, h);
    }
    ctx.globalAlpha = 1;
    // expanding spell rings (double stroke for a soft glow)
    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      const rad = r.r0 + (r.r1 - r.r0) * t;
      drawExpandingRing(ctx, r.x, r.y, rad, 1 - t, r.color);
    }
    // Backline Teleport telegraph: a flat golden ring on the ground with a
    // rotating highlight arc, marking where the Sword Saint will land
    for (const pl of this.portals) {
      const fade = Math.min(1, pl.t / 0.12) * Math.min(1, (pl.life - pl.t) / 0.15);
      if (fade <= 0) continue;
      ctx.save();
      ctx.translate(pl.x, pl.y);
      ctx.scale(1, 0.42); // flatten to sit on the ground
      ctx.strokeStyle = '#ffd35c';
      ctx.globalAlpha = fade * 0.85; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = fade * 0.5;
      ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.stroke();
      const rot = pl.t * 6;
      ctx.globalAlpha = fade; ctx.lineWidth = 3.5; ctx.strokeStyle = '#fff2b0';
      ctx.beginPath(); ctx.arc(0, 0, 32, rot, rot + 1.3); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Kamikaze detonation: the unit's "Explozie" sprite, flashing + expanding out
    for (const b of this.blasts) {
      const k = b.t / BLAST_LIFE;
      ctx.save();
      ctx.globalAlpha = k < 0.4 ? 1 : Math.max(0, 1 - (k - 0.4) / 0.6);
      ctx.translate(b.x, b.y);
      if (b.team === 1) ctx.scale(-1, 1);
      const bArt = b.art != null ? b.art : b.team;
      drawCharacter(ctx, b.type, 'explosion', 0, bArt, sizeOf(raceOf(bArt), b.type) * (1 + 0.18 * k));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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
