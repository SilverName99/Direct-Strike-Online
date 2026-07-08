import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';
import { hasCharacter, drawCharacter, drawStructureSprite, drawBuildingSprite, drawProjectileSprite, drawAbilityProjectileSprite, drawAcidProjectileSprite, hasStructureAttack, drawStructureAttack, drawMainTierSprite, castAnimOf, hasPrepareAnim, hasDashAnim, hasAcidAnim, hasFootAnim, hasBeastAnim, sizeOf } from './characters.js';
import { getBackground, getMiddleStrip, raceOf } from './sprites.js';
import { snapToZone, zoneFor } from '../ui/grid.js';
import { structureExtents } from '../sim/entity.js';
import { resolvedAbility } from '../ui/balance.js';
import { drawAura, drawSlow, drawAcid, drawHasteSparks, drawRegenCross, drawImmuneHalo } from './vfx.js';

export const TEAM_COLORS = ['#4da6ff', '#ff5566'];

// The unit's on-screen body radius: its DRAWN-body radius scaled by the unit
// Size % (or the on-foot / beast override size). Used for both the selection
// ring and click hit-testing, so a bigger unit gets a bigger clickable circle.
// Uses the base (sprite) radius, NOT the footprint-inflated collision radius —
// a wide 2x1 unit's ring should match its sprite, not its 2-cell hitbox.
export function visualRadiusOf(u) {
  const scale = (u.dismounted || u.beast) && u.ovSize != null
    ? u.ovSize
    : sizeOf(raceOf(u.team), u.type);
  const base = u.baseRadius || u.radius || 10;
  return base * Math.max(1, scale || 1);
}
export const TEAM_COLORS_DARK = ['#2d6db3', '#b33a47'];

// Draws a unit shape centered at (0,0) in a pre-transformed context.
export function drawShape(ctx, shape, r) {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.8, -r * 0.85);
      ctx.lineTo(-r * 0.8, r * 0.85);
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'diamond':
      ctx.moveTo(r * 1.3, 0);
      ctx.lineTo(0, -r * 0.6);
      ctx.lineTo(-r * 1.3, 0);
      ctx.lineTo(0, r * 0.6);
      ctx.closePath();
      break;
    case 'pentagon':
      polygon(ctx, 5, r, -Math.PI / 2, 1.25, 0.95);
      break;
    case 'cross': {
      const w = r * 0.42;
      ctx.moveTo(-w, -r); ctx.lineTo(w, -r); ctx.lineTo(w, -w);
      ctx.lineTo(r, -w); ctx.lineTo(r, w); ctx.lineTo(w, w);
      ctx.lineTo(w, r); ctx.lineTo(-w, r); ctx.lineTo(-w, w);
      ctx.lineTo(-r, w); ctx.lineTo(-r, -w); ctx.lineTo(-w, -w);
      ctx.closePath();
      break;
    }
    case 'chevron':
      ctx.moveTo(-r * 0.7, -r);
      ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(-r * 0.7, r);
      ctx.lineTo(-r * 0.1, 0);
      ctx.closePath();
      break;
    case 'ring':
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      break;
    case 'hexagon':
      polygon(ctx, 6, r, 0, 1, 1);
      break;
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
}

// Colored grid squares under a building's footprint, centered at (0,0) in a
// pre-transformed context. Draws a filled hw x hh rectangle split into
// CONFIG.GRID cells — the "patratele de dedesubt" the player places on.
export function drawFootprintCells(ctx, hw, hh, color, alpha = 0.28) {
  const g = CONFIG.GRID;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
  ctx.globalAlpha = Math.min(1, alpha + 0.4);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = -hw; gx <= hw + 0.01; gx += g) { ctx.moveTo(gx, -hh); ctx.lineTo(gx, hh); }
  for (let gy = -hh; gy <= hh + 0.01; gy += g) { ctx.moveTo(-hw, gy); ctx.lineTo(hw, gy); }
  ctx.stroke();
  ctx.restore();
}

function polygon(ctx, sides, r, rot, sx, sy) {
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * r * sx;
    const y = Math.sin(a) * r * sy;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Index of `team`'s template under the cursor (topmost first), or -1.
export function hitTestTemplate(game, team, x, y) {
  if (x == null || y == null) return -1;
  const tpls = game.templates[team];
  for (let i = tpls.length - 1; i >= 0; i--) {
    const tpl = tpls[i];
    // scale the pick radius by the template's drawn Size, like a live unit
    const r = UNITS[tpl.type].radius * Math.max(1, sizeOf(raceOf(team), tpl.type) || 1) + 6;
    const dx = tpl.x - x;
    const dy = tpl.y - y;
    if (dx * dx + dy * dy <= r * r) return i;
  }
  return -1;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = null; // wired in main.js
    this.view = { x0: 0, y0: 0, x1: CONFIG.FIELD_W, y1: CONFIG.FIELD_H };
    this.attackHold = new Map(); // unit id -> last time seen attacking
    this.facing = new Map();     // unit id -> -1 | 1 (sticky draw direction)
  }

  // Attack frame driven by the unit's real attack rhythm: exactly ONE
  // Attack 1 -> Attack 2 cycle per attack period (Attack period governs the
  // time between attacks, so the animation matches it — no separate speed
  // knob). While winding up, the frames follow the swing precisely: raise on
  // the first half, release on the strike. Offset per unit so a pack doesn't
  // animate in perfect lockstep. Also used for the acid/spell frames.
  attackFrame(u, rstats) {
    if (u.windup > 0 && u.windupMax > 0) return u.windup > u.windupMax * 0.5 ? 0 : 1;
    const per = Math.max(0.2, rstats.period || 0.8);
    return Math.floor((this.now * 2) / per + u.id) % 2;
  }

  // Which way a character should face: its live target while fighting, its
  // horizontal movement while walking, else whatever it faced last (default:
  // toward the enemy base). Sticky so per-tick jitter can't flip it around.
  unitFacing(game, u) {
    let f = this.facing.get(u.id) || (u.team === 0 ? 1 : -1);
    const target = u.targetId != null ? game.byId.get(u.targetId) : null;
    if (target && u.state === 'attack') {
      const dx = target.x - u.x;
      if (Math.abs(dx) > 2) f = dx < 0 ? -1 : 1;
    } else {
      const dx = u.x - u.prevX;
      if (Math.abs(dx) > 0.2) f = dx < 0 ? -1 : 1;
    }
    if (this.facing.size > 4000) this.facing.clear(); // bound the map
    this.facing.set(u.id, f);
    return f;
  }

  resize() {
    // Fill the whole wrapper — the camera crops the world, so no aspect lock.
    const wrap = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${wrap.clientWidth}px`;
    this.canvas.style.height = `${wrap.clientHeight}px`;
    this.canvas.width = Math.round(wrap.clientWidth * dpr);
    this.canvas.height = Math.round(wrap.clientHeight * dpr);
    if (this.camera) this.camera.clamp();
  }

  // Convert a mouse event to sim (world) coordinates through the camera.
  toSim(evt) {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.screenToWorld(evt.clientX - rect.left, evt.clientY - rect.top);
  }

  // Is a world point (with margin) inside the visible viewport?
  visible(x, y, margin = 60) {
    const v = this.view;
    return x >= v.x0 - margin && x <= v.x1 + margin && y >= v.y0 - margin && y <= v.y1 + margin;
  }

  draw(game, alpha, uiState, effects) {
    const { ctx } = this;
    const cam = this.camera;
    const z = cam.zoom;
    this.now = performance.now() / 1000; // render clock for 2-frame anims
    if (this.attackHold.size > 4000) this.attackHold.clear(); // bound the map
    this.view = {
      x0: cam.x,
      y0: cam.y,
      x1: cam.x + cam.viewW(),
      y1: cam.y + cam.viewH(),
    };
    // full clear first: with bottom overscroll the viewport can extend past
    // the field, and that strip would smear stale pixels otherwise
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);

    this.drawField(ctx);
    this.drawGrid(ctx, uiState);
    this.drawTemplates(ctx, game, uiState);
    this.drawStructures(ctx, game);
    effects.drawCorpses(ctx); // fallen puppets lie under the living
    this.drawUnits(ctx, game, alpha);
    this.drawProjectiles(ctx, game, alpha);
    effects.draw(ctx);
    this.drawInspect(ctx, game, uiState, alpha);
    this.drawGhost(ctx, game, uiState);

    ctx.restore();
  }

  drawField(ctx) {
    ctx.fillStyle = '#0e141d';
    ctx.fillRect(0, 0, CONFIG.FIELD_W, CONFIG.FIELD_H);

    // per-race background on each side's half of the field; the enemy (right)
    // half is MIRRORED so both maps read the same way — base at the outer edge,
    // the neutral seam meeting in the middle
    const mid = CONFIG.FIELD_W / 2;
    this.drawBackgroundHalf(ctx, getBackground(raceOf(0)), 0, mid, false);
    this.drawBackgroundHalf(ctx, getBackground(raceOf(1)), mid, mid, true);
    // GLOBAL neutral strip over the seam so the center reads continuously
    this.drawMiddleStrip(ctx, getMiddleStrip(), mid);

    // per-team base quadrant: construction zone (back) + army zone (front)
    const tints = ['rgba(77, 166, 255,', 'rgba(255, 85, 102,'];
    for (const team of [0, 1]) {
      const cz = CONFIG.CONSTRUCTION_ZONE[team];
      const az = CONFIG.ARMY_ZONE[team];
      ctx.fillStyle = `${tints[team]} 0.09)`;
      ctx.fillRect(cz.x0, cz.y0, cz.x1 - cz.x0, cz.y1 - cz.y0);
      ctx.fillStyle = `${tints[team]} 0.05)`;
      ctx.fillRect(az.x0, az.y0, az.x1 - az.x0, az.y1 - az.y0);
      ctx.strokeStyle = `${tints[team]} 0.35)`;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(cz.x0, cz.y0, cz.x1 - cz.x0, cz.y1 - cz.y0);
      ctx.strokeRect(az.x0, az.y0, az.x1 - az.x0, az.y1 - az.y0);
      ctx.setLineDash([]);
      ctx.fillStyle = `${tints[team]} 0.45)`;
      ctx.font = 'bold 17px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CONSTRUCTION', (cz.x0 + cz.x1) / 2, cz.y0 + 24);
      ctx.fillText('ARMY', (az.x0 + az.x1) / 2, az.y0 + 24);

      // forward build pocket around the mid turret
      const mz = CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[team];
      if (mz) {
        ctx.fillStyle = `${tints[team]} 0.09)`;
        ctx.fillRect(mz.x0, mz.y0, mz.x1 - mz.x0, mz.y1 - mz.y0);
        ctx.strokeStyle = `${tints[team]} 0.35)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(mz.x0, mz.y0, mz.x1 - mz.x0, mz.y1 - mz.y0);
        ctx.setLineDash([]);
      }
    }

    // midline
    ctx.strokeStyle = 'rgba(124, 139, 161, 0.15)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(CONFIG.FIELD_W / 2, 0);
    ctx.lineTo(CONFIG.FIELD_W / 2, CONFIG.FIELD_H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Cover-fit a background image into a half of the field, clipped to it.
  // `flip` mirrors it horizontally (the enemy half) so both maps face the
  // same way relative to the middle.
  drawBackgroundHalf(ctx, img, rx, rw, flip = false) {
    if (!img) return;
    const rh = CONFIG.FIELD_H;
    const s = Math.max(rw / img.width, rh / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, 0, rw, rh);
    ctx.clip();
    ctx.globalAlpha = 0.85;
    if (flip) {
      // mirror about the half's center: local x grows leftward from the outer
      // edge, so the image's left side (the base) lands on the outer edge and
      // its right side (the neutral seam) meets the middle
      ctx.translate(rx + rw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, (rw - dw) / 2, (rh - dh) / 2, dw, dh);
    } else {
      ctx.drawImage(img, rx + (rw - dw) / 2, (rh - dh) / 2, dw, dh);
    }
    ctx.restore();
  }

  // Global neutral strip centered on the field's midline, over both halves, so
  // the seam blends. Fit to full field height; its drawn width follows the
  // source aspect (a 400×1920 PNG -> ~200 sim units wide).
  drawMiddleStrip(ctx, img, mid) {
    if (!img) return;
    const rh = CONFIG.FIELD_H;
    const s = rh / img.height;
    const dw = img.width * s;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, mid - dw / 2, 0, dw, rh);
    ctx.restore();
  }

  // Placement grid over the relevant zone while placing or dragging. Only the
  // MAJOR lines (every GRID_MAJOR cells) are drawn — placement still snaps to
  // the fine cell, whose green highlight travels with the cursor.
  drawGrid(ctx, uiState) {
    if (!uiState.gridOn) return;
    let zone = null;
    if (uiState.selected && uiState.selected !== 'upgrade') zone = zoneFor(uiState.selected, uiState.mouseX, uiState.mouseY);
    else if (uiState.drag) zone = CONFIG.ARMY_ZONE[0];
    if (!zone) return;
    const step = CONFIG.GRID * (CONFIG.GRID_MAJOR || 4);
    ctx.save();
    ctx.strokeStyle = 'rgba(219, 228, 240, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = zone.x0; x <= zone.x1 + 0.5; x += step) {
      ctx.moveTo(x, zone.y0);
      ctx.lineTo(x, zone.y1);
    }
    for (let y = zone.y0; y <= zone.y1 + 0.5; y += step) {
      ctx.moveTo(zone.x0, y);
      ctx.lineTo(zone.x1, y);
    }
    // close the far edges even when the zone isn't a multiple of the major step
    ctx.moveTo(zone.x1, zone.y0); ctx.lineTo(zone.x1, zone.y1);
    ctx.moveTo(zone.x0, zone.y1); ctx.lineTo(zone.x1, zone.y1);
    ctx.stroke();
    ctx.restore();
  }

  // Selection ring for the inspect panel: a WC3-style circle (units/templates)
  // or box (structures) around whatever is selected for inspection.
  drawInspect(ctx, game, uiState, alpha = 1) {
    const sel = uiState.inspect;
    if (!sel) return;
    ctx.save();
    ctx.strokeStyle = '#58d68d';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    if (sel.kind === 'template') {
      const tpl = game.templates[0][sel.index];
      if (tpl) {
        const us = game.ustat(0, tpl.type);
        const r = Math.max(14, (us.radius || 10) * Math.max(1, sizeOf(raceOf(0), tpl.type) || 1) + 8);
        ctx.beginPath();
        ctx.arc(tpl.x, tpl.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (sel.kind === 'entity') {
      const u = game.byId.get(sel.id);
      if (u && u.hp > 0) {
        // interpolate like the sprite (prevX/prevY + alpha) so the ring rides
        // with the smoothly-moving body instead of snapping at the sim rate
        const x = u.prevX + (u.x - u.prevX) * alpha;
        const y = u.prevY + (u.y - u.prevY) * alpha;
        ctx.beginPath();
        ctx.arc(x, y, visualRadiusOf(u) + 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (sel.kind === 'structure') {
      const s = game.structures.find((st) => st.id === sel.id);
      if (s) {
        const hw = (s.hw || s.radius) + 6;
        const hh = (s.hh || s.radius) + 6;
        ctx.strokeRect(s.x - hw, s.y - hh, hw * 2, hh * 2);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawStructures(ctx, game) {
    for (const s of game.structures) {
      if (!this.visible(s.x, s.y, s.radius + 320)) continue;
      const color = TEAM_COLORS[s.team];
      const dark = TEAM_COLORS_DARK[s.team];
      const r = s.radius;
      const hw = s.hw || r;
      const hh = s.hh || r;
      ctx.save();
      ctx.translate(s.x, s.y);

      // range ring first, so it sits under sprite or vector art
      if (s.kind === 'turret' || s.kind === 'tower') {
        const stats = game.bstat(s.team, s.kind);
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, stats.range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // uploaded building art (every kind, walls included); mirror for team 1.
      // The sprite helper sizes itself (footprint buildings contain-fit their
      // cw×ch box; main/turret use their radius) and applies the size setting.
      let spriteDrawn = false;
      {
        ctx.save();
        if (s.team === 1) ctx.scale(-1, 1);
        if (s.kind === 'main' && s.hp <= 0) ctx.globalAlpha = 0.35;
        // Armed buildings (turret/tower) show their attack animation while
        // engaged: "fire" frame right after each shot, "aim" frame otherwise.
        if ((s.kind === 'turret' || s.kind === 'tower') && hasStructureAttack(s.kind, s.team)) {
          const tgt = s.targetId != null ? game.byId.get(s.targetId) : null;
          if (tgt && tgt.hp > 0) {
            const period = game.bstat(s.team, s.kind).period || 1;
            const sinceFire = period - s.cooldown; // 0 right after a shot
            const frame = sinceFire >= 0 && sinceFire < 0.16 ? 1 : 0;
            spriteDrawn = drawStructureAttack(ctx, s.kind, s.team, hw, hh, frame);
          }
        }
        if (!spriteDrawn) {
          spriteDrawn = s.kind === 'main'
            ? drawMainTierSprite(ctx, s.team, game.tier[s.team], hw, hh) // per-upgrade image
            : drawStructureSprite(ctx, s.kind, s.team, hw, hh, this.now, s.id);
        }
        ctx.restore();
      }

      const size = sizeOf(raceOf(s.team), s.kind);
      if (spriteDrawn && s.kind === 'main') {
        // tier pips still shown over sprite art
        const tier = game.tier[s.team];
        ctx.fillStyle = '#ffd35c';
        for (let i = 0; i < tier; i++) {
          ctx.beginPath();
          ctx.arc(-14 + i * 14, -r - 14, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (!spriteDrawn && s.kind === 'main') {
        // round main/turret vector art scales with the size setting
        ctx.save();
        ctx.scale(size, size);
        if (s.hp <= 0) ctx.globalAlpha = 0.35; // ruined main on the end screen
        ctx.fillStyle = dark;
        drawShape(ctx, 'hexagon', r);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.5;
        drawShape(ctx, 'hexagon', r);
        ctx.stroke();
        ctx.fillStyle = color;
        drawShape(ctx, 'hexagon', r * 0.45);
        ctx.fill();
        ctx.restore();
        // tier pips (world scale)
        const tier = game.tier[s.team];
        ctx.fillStyle = '#ffd35c';
        for (let i = 0; i < tier; i++) {
          ctx.beginPath();
          ctx.arc(-14 + i * 14, -r - 14, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (!spriteDrawn && s.kind === 'turret') {
        ctx.save();
        ctx.scale(size, size);
        ctx.fillStyle = dark;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(hw, hh) * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (!spriteDrawn && s.kind === 'tower') {
        // footprint buildings: vector = the fixed cw×ch box (no size scale)
        ctx.fillStyle = dark;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(hw, hh) * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else if (!spriteDrawn && s.kind === 'wall') {
        ctx.fillStyle = dark;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      } else if (!spriteDrawn && s.kind === 'generator') {
        ctx.fillStyle = dark;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        // pulsing energy core
        const pulse = 0.6 + 0.4 * Math.sin(this.now * 4 + s.id);
        ctx.fillStyle = '#ffd35c';
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(hw, hh) * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // HP bar (main always; others when damaged) — sits above the sprite's
      // real drawn height: main/turret art is r*3*size tall (centered), so
      // its top edge is 1.5*r*size above center; footprint buildings fit
      // their hh*size box. Vector fallbacks stay at the physical radius.
      if (s.kind === 'main' || s.hp < s.maxHp || CONFIG.HEALTHBAR_ALWAYS) {
        const size = Math.max(1, sizeOf(raceOf(s.team), s.kind));
        const topH = spriteDrawn
          ? (s.kind === 'main' || s.kind === 'turret' ? r * 1.5 * size : (s.hh || r) * size)
          : r;
        const w = s.kind === 'main' ? 110 : r * 3;
        const ratio = Math.max(0, s.hp / s.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(s.x - w / 2, s.y - topH - (s.kind === 'main' ? 14 : 10), w, s.kind === 'main' ? 8 : 5);
        ctx.fillStyle = color;
        ctx.fillRect(s.x - w / 2, s.y - topH - (s.kind === 'main' ? 14 : 10), w * ratio, s.kind === 'main' ? 8 : 5);
      }
    }
  }

  drawTemplates(ctx, game, uiState) {
    // Which of the player's templates is hovered (for drag/sell affordance)?
    const hoverIdx = uiState.drag
      ? uiState.drag.index
      : hitTestTemplate(game, 0, uiState.mouseX, uiState.mouseY);

    ctx.save();
    for (const team of [0, 1]) {
      ctx.strokeStyle = TEAM_COLORS[team];
      ctx.lineWidth = 1.5;
      const rot = team === 0 ? 0 : Math.PI;
      game.templates[team].forEach((tpl, i) => {
        if (!this.visible(tpl.x, tpl.y)) return;
        const stats = UNITS[tpl.type];
        const hot = team === 0 && i === hoverIdx && !uiState.selected;
        const dragging = team === 0 && uiState.drag && i === uiState.drag.index;
        ctx.save();
        ctx.translate(tpl.x, tpl.y);
        if (dragging && uiState.gridOn) {
          // moving a placed unit: highlight the grid cells it will occupy
          const us = game.ustat(0, tpl.type);
          const cw = us && us.cw > 1 ? us.cw : 1;
          const ch = us && us.ch > 1 ? us.ch : 1;
          const g = CONFIG.GRID;
          const hw = (cw * g) / 2;
          const hh = (ch * g) / 2;
          drawFootprintCells(ctx, hw, hh, '#58d68d', 0.22);
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = '#58d68d';
          ctx.lineWidth = 2;
          ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
          ctx.strokeStyle = TEAM_COLORS[team];
          ctx.lineWidth = 1.5;
        }
        // (no white hover ring — hovering only brightens the unit below; the
        // only ring shown is the green dashed selection ring in drawInspect)
        if (hasCharacter(tpl.type, team)) {
          // ghost character breathing in the build zone
          ctx.globalAlpha = hot ? 0.95 : 0.5;
          if (team === 1) ctx.scale(-1, 1);
          drawCharacter(ctx, tpl.type, 'idle', (Math.floor(this.now * 2) + i) % 2, team, sizeOf(raceOf(team), tpl.type));
        } else {
          ctx.globalAlpha = hot ? 0.9 : 0.35;
          ctx.rotate(rot);
          drawShape(ctx, stats.shape, stats.radius);
          ctx.stroke();
        }
        ctx.restore();
      });
    }
    ctx.restore();
  }

  drawUnits(ctx, game, alpha) {
    for (const u of game.entities) {
      const stats = UNITS[u.type];
      const x = u.prevX + (u.x - u.prevX) * alpha;
      const y = u.prevY + (u.y - u.prevY) * alpha;
      if (!this.visible(x, y)) continue;
      const color = TEAM_COLORS[u.team];
      // visual scale: dismounted units use the upgrade's on-foot size, else the
      // unit's own Size (%)
      const vScale = (u.dismounted || u.beast) && u.ovSize != null ? u.ovSize : sizeOf(raceOf(u.team), u.type);

      if (u.isAir) {
        // soft shadow under flyers
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(x, y + stats.radius + 6, stats.radius * 0.9, stats.radius * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // casters project their aura circles beneath everyone's feet
      const rstats = game.ustat(u.team, u.type);
      if (rstats.caster && rstats.abilities && rstats.abilities.length) {
        this.drawAuraRings(ctx, u, rstats, x, y, game.time);
      }

      ctx.save();
      ctx.translate(x, y);
      if (hasCharacter(u.type, u.team)) {
        // character path: side-view sprite/puppet, mirrored to face where it is
        // GOING (or its target) — a unit walking back toward its own base flips
        // around instead of moonwalking. Sticky per-unit so jitter can't flap it.
        if (this.unitFacing(game, u) < 0) ctx.scale(-1, 1);
        let anim;
        let frame;
        const isCaster = rstats.caster;
        const prep = isCaster && hasPrepareAnim(u.type, u.team);
        // hold the attack anim briefly so range-boundary jitter can't
        // flicker back-row units between attack and walk
        if (u.state === 'attack' && !u.spellHold) this.attackHold.set(u.id, this.now);
        const held = this.attackHold.get(u.id);
        const attacking = (u.state === 'attack' && !u.spellHold) || (held !== undefined && this.now - held < 0.3);
        if (isCaster && u.castState) {
          // active-cast FSM drives the pose frame-accurately: "Prepare spell"
          // during the wind-up, then the single "Cast X" release frame exactly
          // when the effect fires (heal lands / bolt leaves). Both fall back
          // gracefully to attack/idle when a frame isn't uploaded.
          if (u.castState === 'prepare') {
            anim = prep ? 'prepare' : 'attack';
          } else { // release
            anim = castAnimOf(u.type, u.team, u.castAbility) || (prep ? 'prepare' : 'attack');
          }
          frame = 0;
        } else if (attacking) {
          if (isCaster) {
            // non-caster-ability fighter path (out of mana / auto-attacking):
            // shared "prepare" during the wind-up, one "attack" release frame
            anim = u.windup > 0 && prep ? 'prepare' : 'attack';
            frame = 0;
          } else if (u.acidAttacker && hasAcidAnim(u.type, u.team)) {
            // Acid Spit upgrade: cycle the two "Acid" attack frames in step
            // with the unit's real attack period (one 1<->2 cycle per swing)
            anim = 'acid';
            frame = this.attackFrame(u, rstats);
          } else {
            // fighting: cycle Attack 1 <-> Attack 2 for as long as the unit
            // stays engaged, at the unit's OWN attack cadence — one full
            // cycle per swing, not the (fast) walk-flip clock
            anim = 'attack';
            frame = this.attackFrame(u, rstats);
          }
        } else if (u.dashing) {
          // charging in: show the uploaded "Dash" frame, else fall back to walk
          anim = hasDashAnim(u.type, u.team) ? 'dash' : 'walk';
          frame = 0;
        } else {
          // marching, or a caster calmly waiting to cast -> idle/walk
          anim = u.state === 'march' ? 'walk' : 'idle';
          frame = (Math.floor(this.now * (rstats.animSpeed || 5)) + u.id) % 2;
        }
        // dismounted (mount upgrade): use the on-foot sprite set only if it was
        // uploaded, else keep the mounted sprite/puppet (which always exists)
        if (u.dismounted && !anim.startsWith('foot-') && hasFootAnim(u.type, u.team, anim)) {
          anim = `foot-${anim}`;
        }
        // split-off mount: same idea with the "Bestie" sprite set
        if (u.beast && !anim.startsWith('beast-') && hasBeastAnim(u.type, u.team, anim)) {
          anim = `beast-${anim}`;
        }
        drawCharacter(ctx, u.type, anim, frame, u.team, vScale);
      } else {
        ctx.rotate(u.team === 0 ? 0 : Math.PI);
        if (stats.shape === 'ring') {
          ctx.strokeStyle = color;
          ctx.lineWidth = 3.5;
          drawShape(ctx, 'ring', stats.radius);
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          drawShape(ctx, stats.shape, stats.radius);
          ctx.fill();
        }
      }
      ctx.restore();

      // bars sit above the *visual* height, which scales with Size (%) (or the
      // dismounted size), so a big unit doesn't overlap its own HP/mana bar
      const drawR = stats.radius * Math.max(1, vScale);

      if (u.hp < u.maxHp || CONFIG.HEALTHBAR_ALWAYS) {
        const w = drawR * 2.4;
        const ratio = Math.max(0, u.hp / u.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - w / 2, y - drawR - 9, w, 3.5);
        ctx.fillStyle = ratio > 0.5 ? '#58d68d' : ratio > 0.25 ? '#ffd35c' : '#ff5566';
        ctx.fillRect(x - w / 2, y - drawR - 9, w * ratio, 3.5);
      }

      // mana bar (casters only), right under the HP bar slot
      if (u.manaMax > 0) {
        const w = drawR * 2.4;
        const mratio = Math.max(0, Math.min(1, u.mana / u.manaMax));
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - w / 2, y - drawR - 5, w, 2.5);
        ctx.fillStyle = '#4da6ff';
        ctx.fillRect(x - w / 2, y - drawR - 5, w * mratio, 2.5);
      }

      // status-effect indicators (slow swirl, haste sparks, regen cross...)
      if (u.effects && u.effects.length) {
        this.drawEffectIndicators(ctx, u, x, y, stats.radius);
      }
    }
  }

  // Rotating rune circle at the caster's feet + a faint ring showing each
  // aura's true radius (colors come from the ability catalog).
  drawAuraRings(ctx, u, rstats, x, y, simTime) {
    let i = 0;
    for (const aid of rstats.abilities) {
      const ab = resolvedAbility(aid);
      if (!ab || ab.kind !== 'castaura') continue;
      // cast buff-zone: shown only while the raised zone is still active
      if (!u.auraUntil || (u.auraUntil[aid] || 0) <= simTime) continue;
      ctx.save();
      ctx.translate(x, y);
      drawAura(ctx, this.now, ab.color, ab.params.radius, i);
      ctx.restore();
      i++;
    }
  }

  // Small procedural markers for active status effects.
  drawEffectIndicators(ctx, u, x, y, r) {
    const has = (kind) => u.effects.some((e) => e.kind === kind);
    ctx.save();
    ctx.translate(x, y);
    if (has('atkslow') || has('moveslow')) drawSlow(ctx, this.now, r, u.id);
    if (has('acid')) drawAcid(ctx, this.now, r, u.id);
    if (has('haste')) drawHasteSparks(ctx, this.now, r);
    if (has('regen')) drawRegenCross(ctx, this.now, r);
    if (has('immune')) drawImmuneHalo(ctx, r);
    ctx.restore();
  }

  drawProjectiles(ctx, game, alpha) {
    for (const p of game.projectiles) {
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      if (!this.visible(x, y)) continue;

      // uploaded projectile art (rotated toward travel), else the default dot;
      // both scaled by the per-entity projectile size multiplier. Ability
      // projectiles (e.g. Frost Bolt) use the caster's per-ability image —
      // never the basic-attack image — so two races' casters look different.
      const ps = p.projSize || 1;
      let drawn = false;
      if (p.srcType) {
        let ang = Math.atan2(p.y - p.prevY, p.x - p.prevX);
        if (p.x === p.prevX && p.y === p.prevY) ang = Math.atan2(p.ty - y, p.tx - x);
        const size = (p.splash > 0 ? 34 : 22) * ps;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        // Acid Spit: its own uploaded projectile image, else the unit's normal
        // one; frost & other ability bolts use the per-ability image.
        drawn = p.acid
          ? (drawAcidProjectileSprite(ctx, p.srcType, p.team, size) || drawProjectileSprite(ctx, p.srcType, p.team, size))
          : p.ability
            ? drawAbilityProjectileSprite(ctx, p.ability, p.srcType, p.team, size)
            : drawProjectileSprite(ctx, p.srcType, p.team, size);
        ctx.restore();
      }
      if (!drawn) {
        // ability projectiles glow in their ability color (frost = icy blue);
        // acid spits glow corrosive green
        const abColor = p.acid ? '#8fd14f' : (p.ability ? (resolvedAbility(p.ability) || {}).color : null);
        if (abColor) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = abColor;
          ctx.beginPath();
          ctx.arc(x, y, 7 * ps, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = abColor || (p.splash > 0 ? '#ffb347' : TEAM_COLORS[p.team]);
        ctx.beginPath();
        ctx.arc(x, y, (p.splash > 0 ? 5 : 3.5) * ps, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawGhost(ctx, game, uiState) {
    const sel = uiState.selected;
    if (!sel || sel === 'upgrade') return;
    if (uiState.mouseX == null) return;

    const isBuilding = !!CONFIG.BUILDINGS[sel];
    // units also carry a cw×ch footprint (physical size in grid cells)
    const us = isBuilding ? null : game.ustat(0, sel);
    const uw = us && us.cw > 1 ? us.cw : 1;
    const uh = us && us.ch > 1 ? us.ch : 1;

    // grid snap for display, same as the click will use (buildings AND
    // footprint units snap by their cw×ch box)
    let px = uiState.mouseX;
    let py = uiState.mouseY;
    if (uiState.gridOn) {
      const bs = isBuilding ? game.bstat(0, sel) : null;
      const cw = isBuilding ? bs.cw : uw;
      const ch = isBuilding ? bs.ch : uh;
      const p = snapToZone(zoneFor(sel, px, py), px, py, cw, ch);
      px = p.x;
      py = p.y;
    }

    const valid = isBuilding
      ? game.isValidBuildPlacement(0, sel, px, py)
      : game.isValidPlacement(0, px, py, -1, sel);

    ctx.save();
    ctx.translate(px, py);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = valid ? '#58d68d' : '#ff5566';
    ctx.fillStyle = valid ? 'rgba(88, 214, 141, 0.2)' : 'rgba(255, 85, 102, 0.2)';
    ctx.lineWidth = 2;

    if (isBuilding) {
      const b = game.bstat(0, sel);
      const ext = structureExtents(sel, b);
      // colored footprint cells (the "patratele de dedesubt")
      drawFootprintCells(ctx, ext.hw, ext.hh, valid ? '#58d68d' : '#ff5566', 0.22);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = valid ? '#58d68d' : '#ff5566';
      ctx.strokeRect(-ext.hw, -ext.hh, ext.hw * 2, ext.hh * 2);
      // idle 1 sprite on the cursor (falls back to nothing if not uploaded)
      ctx.globalAlpha = valid ? 0.85 : 0.55;
      drawBuildingSprite(ctx, sel, 0, ext.hw, ext.hh, 0);
      if (b.range) {
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = valid ? '#58d68d' : '#ff5566';
        ctx.beginPath();
        ctx.arc(0, 0, b.range, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    const stats = UNITS[sel];
    const hasFootprint = uw > 1 || uh > 1;
    if (hasFootprint) {
      // colored footprint cells + box, exactly like a building's placement
      const g = CONFIG.GRID;
      const hw = (uw * g) / 2;
      const hh = (uh * g) / 2;
      drawFootprintCells(ctx, hw, hh, valid ? '#58d68d' : '#ff5566', 0.22);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = valid ? '#58d68d' : '#ff5566';
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctx.globalAlpha = valid ? 0.85 : 0.55;
    }
    if (hasCharacter(sel)) {
      drawCharacter(ctx, sel, 'idle', 0, 0, sizeOf(raceOf(0), sel));
      if (!hasFootprint) {
        ctx.beginPath();
        ctx.arc(0, 0, stats.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      drawShape(ctx, stats.shape, stats.radius);
      ctx.fill();
      ctx.stroke();
    }
    // range indicator
    if (stats.range > 40) {
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      ctx.arc(0, 0, stats.range, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
