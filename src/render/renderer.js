import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';
import { hasCharacter, drawCharacter, drawStructureSprite, drawBuildingSprite, drawProjectileSprite, drawAbilityProjectileSprite, hasStructureAttack, drawStructureAttack, drawMainTierSprite, castAnimOf, hasPrepareAnim, sizeOf } from './characters.js';
import { getBackground, raceOf } from './sprites.js';
import { snapToZone, zoneFor } from '../ui/grid.js';
import { structureExtents } from '../sim/entity.js';
import { resolvedAbility } from '../ui/balance.js';
import { drawAura, drawSlow, drawHasteSparks, drawRegenCross, drawImmuneHalo } from './vfx.js';

export const TEAM_COLORS = ['#4da6ff', '#ff5566'];
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
    const r = UNITS[tpl.type].radius + 6;
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
    this.castPose = new Map(); // unit id -> {ability, until} (uploaded cast frames)
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

  // Sim events the renderer cares about (cast pose windows). Called by
  // main.js with the same drained batch the effects layer receives.
  noteEvents(events) {
    const now = performance.now() / 1000;
    for (const e of events) {
      if (e.type === 'cast' && e.unitId != null) {
        this.castPose.set(e.unitId, { ability: e.ability, until: now + 0.6 });
      }
    }
    if (this.castPose.size > 2000) this.castPose.clear(); // bound the map
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
    this.drawGhost(ctx, game, uiState);

    ctx.restore();
  }

  drawField(ctx) {
    ctx.fillStyle = '#0e141d';
    ctx.fillRect(0, 0, CONFIG.FIELD_W, CONFIG.FIELD_H);

    // per-race background on each side's half of the field
    const mid = CONFIG.FIELD_W / 2;
    this.drawBackgroundHalf(ctx, getBackground(raceOf(0)), 0, mid);
    this.drawBackgroundHalf(ctx, getBackground(raceOf(1)), mid, mid);

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
  drawBackgroundHalf(ctx, img, rx, rw) {
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
    ctx.drawImage(img, rx + (rw - dw) / 2, (rh - dh) / 2, dw, dh);
    ctx.restore();
  }

  // Placement grid over the relevant zone while placing or dragging.
  drawGrid(ctx, uiState) {
    if (!uiState.gridOn) return;
    let zone = null;
    if (uiState.selected && uiState.selected !== 'upgrade') zone = zoneFor(uiState.selected);
    else if (uiState.drag) zone = CONFIG.ARMY_ZONE[0];
    if (!zone) return;
    const g = CONFIG.GRID;
    ctx.save();
    ctx.strokeStyle = 'rgba(219, 228, 240, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = zone.x0; x <= zone.x1 + 0.5; x += g) {
      ctx.moveTo(x, zone.y0);
      ctx.lineTo(x, zone.y1);
    }
    for (let y = zone.y0; y <= zone.y1 + 0.5; y += g) {
      ctx.moveTo(zone.x0, y);
      ctx.lineTo(zone.x1, y);
    }
    ctx.stroke();
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

      // uploaded building art (all kinds except walls); mirror for team 1.
      // The sprite helper sizes itself (footprint buildings contain-fit their
      // cw×ch box; main/turret use their radius) and applies the size setting.
      let spriteDrawn = false;
      if (s.kind !== 'wall') {
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
      } else if (s.kind === 'wall') {
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

      // HP bar (main always; others when damaged)
      if (s.kind === 'main' || s.hp < s.maxHp || CONFIG.HEALTHBAR_ALWAYS) {
        const w = s.kind === 'main' ? 110 : r * 3;
        const ratio = Math.max(0, s.hp / s.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(s.x - w / 2, s.y - r - (s.kind === 'main' ? 26 : 14), w, s.kind === 'main' ? 8 : 5);
        ctx.fillStyle = color;
        ctx.fillRect(s.x - w / 2, s.y - r - (s.kind === 'main' ? 26 : 14), w * ratio, s.kind === 'main' ? 8 : 5);
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
        ctx.save();
        ctx.translate(tpl.x, tpl.y);
        if (hot) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(0, 0, stats.radius + 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = TEAM_COLORS[team];
        }
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
        this.drawAuraRings(ctx, u, rstats, x, y);
      }

      ctx.save();
      ctx.translate(x, y);
      if (hasCharacter(u.type, u.team)) {
        // character path: side-view sprite/puppet, mirrored to face the enemy
        if (u.team === 1) ctx.scale(-1, 1);
        let anim;
        let frame;
        const isCaster = rstats.caster;
        const prep = isCaster && hasPrepareAnim(u.type, u.team);
        // hold the attack anim briefly so range-boundary jitter can't
        // flicker back-row units between attack and walk
        if (u.state === 'attack' && !u.spellHold) this.attackHold.set(u.id, this.now);
        const held = this.attackHold.get(u.id);
        const attacking = (u.state === 'attack' && !u.spellHold) || (held !== undefined && this.now - held < 0.3);
        if (attacking) {
          if (isCaster) {
            // single-frame model: shared "prepare" during the wind-up, one
            // "attack" release frame otherwise
            anim = u.windup > 0 && prep ? 'prepare' : 'attack';
            frame = 0;
          } else {
            anim = 'attack';
            frame = u.windupMax > 0 && u.windup > u.windupMax * 0.5 ? 0 : 1;
          }
        } else {
          // marching, or a caster calmly waiting to cast -> idle/walk
          anim = u.state === 'march' ? 'walk' : 'idle';
          frame = (Math.floor(this.now * 5) + u.id) % 2;
        }
        // an active cast overrides: "prepare" first, single cast-release frame
        // second (both fall back gracefully when a frame isn't uploaded)
        const cp = this.castPose.get(u.id);
        if (cp && this.now < cp.until) {
          const second = cp.until - this.now < 0.3;
          const ca = castAnimOf(u.type, u.team, cp.ability);
          if (second && ca) { anim = ca; frame = 0; }
          else if (prep) { anim = 'prepare'; frame = 0; }
          else if (ca) { anim = ca; frame = 0; }
        }
        drawCharacter(ctx, u.type, anim, frame, u.team, sizeOf(raceOf(u.team), u.type));
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

      if (u.hp < u.maxHp || CONFIG.HEALTHBAR_ALWAYS) {
        const w = stats.radius * 2.4;
        const ratio = Math.max(0, u.hp / u.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - w / 2, y - stats.radius - 9, w, 3.5);
        ctx.fillStyle = ratio > 0.5 ? '#58d68d' : ratio > 0.25 ? '#ffd35c' : '#ff5566';
        ctx.fillRect(x - w / 2, y - stats.radius - 9, w * ratio, 3.5);
      }

      // mana bar (casters only), right under the HP bar slot
      if (u.manaMax > 0) {
        const w = stats.radius * 2.4;
        const mratio = Math.max(0, Math.min(1, u.mana / u.manaMax));
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - w / 2, y - stats.radius - 5, w, 2.5);
        ctx.fillStyle = '#4da6ff';
        ctx.fillRect(x - w / 2, y - stats.radius - 5, w * mratio, 2.5);
      }

      // status-effect indicators (slow swirl, haste sparks, regen cross...)
      if (u.effects && u.effects.length) {
        this.drawEffectIndicators(ctx, u, x, y, stats.radius);
      }
    }
  }

  // Rotating rune circle at the caster's feet + a faint ring showing each
  // aura's true radius (colors come from the ability catalog).
  drawAuraRings(ctx, u, rstats, x, y) {
    let i = 0;
    for (const aid of rstats.abilities) {
      const ab = resolvedAbility(aid);
      if (!ab || ab.kind !== 'aura') continue;
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
        drawn = p.ability
          ? drawAbilityProjectileSprite(ctx, p.ability, p.srcType, p.team, size)
          : drawProjectileSprite(ctx, p.srcType, p.team, size);
        ctx.restore();
      }
      if (!drawn) {
        // ability projectiles glow in their ability color (frost = icy blue)
        const abColor = p.ability ? (resolvedAbility(p.ability) || {}).color : null;
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

    // grid snap for display, same as the click will use (buildings snap by
    // their cw×ch footprint)
    let px = uiState.mouseX;
    let py = uiState.mouseY;
    if (uiState.gridOn) {
      const bs = isBuilding ? game.bstat(0, sel) : null;
      const p = snapToZone(zoneFor(sel), px, py, bs ? bs.cw : 1, bs ? bs.ch : 1);
      px = p.x;
      py = p.y;
    }

    const valid = isBuilding
      ? game.isValidBuildPlacement(0, sel, px, py)
      : game.isValidPlacement(0, px, py);

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
    if (hasCharacter(sel)) {
      drawCharacter(ctx, sel, 'idle', 0, 0, sizeOf(raceOf(0), sel));
      ctx.beginPath();
      ctx.arc(0, 0, stats.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
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
