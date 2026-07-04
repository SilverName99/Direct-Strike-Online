import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';

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
    this.view = {
      x0: cam.x,
      y0: cam.y,
      x1: cam.x + cam.viewW(),
      y1: cam.y + cam.viewH(),
    };
    ctx.save();
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);

    this.drawField(ctx);
    this.drawTemplates(ctx, game, uiState);
    this.drawBases(ctx, game);
    this.drawTurrets(ctx, game);
    this.drawUnits(ctx, game, alpha);
    this.drawProjectiles(ctx, game, alpha);
    effects.draw(ctx);
    this.drawGhost(ctx, game, uiState);

    ctx.restore();
  }

  drawField(ctx) {
    ctx.fillStyle = '#0e141d';
    ctx.fillRect(0, 0, CONFIG.FIELD_W, CONFIG.FIELD_H);

    // battle lane gets a faint distinct tone
    const laneX0 = CONFIG.BASE_X[0];
    const laneX1 = CONFIG.BASE_X[1];
    ctx.fillStyle = 'rgba(124, 139, 161, 0.04)';
    ctx.fillRect(laneX0, 0, laneX1 - laneX0, CONFIG.FIELD_H);

    // build zones: tinted boxes with dashed borders and a label
    const tints = ['rgba(77, 166, 255,', 'rgba(255, 85, 102,'];
    for (const team of [0, 1]) {
      const z = CONFIG.BUILD_ZONE[team];
      ctx.fillStyle = `${tints[team]} 0.07)`;
      ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.strokeStyle = `${tints[team]} 0.35)`;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.setLineDash([]);
      ctx.fillStyle = `${tints[team]} 0.45)`;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(team === 0 ? 'BUILD ZONE' : 'ENEMY BUILD', (z.x0 + z.x1) / 2, z.y0 + 28);
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

  drawTurrets(ctx, game) {
    for (const turret of game.turrets) {
      if (!turret || turret.hp <= 0) continue;
      const color = TEAM_COLORS[turret.team];
      const r = turret.radius;
      ctx.save();
      ctx.translate(turret.x, turret.y);
      // faint range ring
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, CONFIG.TURRET.range, 0, Math.PI * 2);
      ctx.stroke();
      // fort body: square footing + gun circle
      ctx.globalAlpha = 1;
      ctx.fillStyle = TEAM_COLORS_DARK[turret.team];
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // HP bar
      const w = r * 3;
      const ratio = Math.max(0, turret.hp / turret.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(turret.x - w / 2, turret.y - r - 14, w, 5);
      ctx.fillStyle = color;
      ctx.fillRect(turret.x - w / 2, turret.y - r - 14, w * ratio, 5);
    }
  }

  drawBases(ctx, game) {
    for (const base of game.bases) {
      const color = TEAM_COLORS[base.team];
      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      drawShape(ctx, 'hexagon', base.radius + 10);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = TEAM_COLORS_DARK[base.team];
      drawShape(ctx, 'hexagon', base.radius);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      drawShape(ctx, 'hexagon', base.radius);
      ctx.stroke();
      ctx.restore();

      // HP bar above base
      const w = 110;
      const ratio = Math.max(0, base.hp / base.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(base.x - w / 2, base.y - base.radius - 26, w, 8);
      ctx.fillStyle = color;
      ctx.fillRect(base.x - w / 2, base.y - base.radius - 26, w * ratio, 8);
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
        ctx.globalAlpha = hot ? 0.9 : 0.35;
        ctx.save();
        ctx.translate(tpl.x, tpl.y);
        if (hot) {
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(0, 0, stats.radius + 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = TEAM_COLORS[team];
        }
        ctx.rotate(rot);
        drawShape(ctx, stats.shape, stats.radius);
        ctx.stroke();
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

      ctx.save();
      ctx.translate(x, y);
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
      ctx.restore();

      if (u.hp < u.maxHp) {
        const w = stats.radius * 2.4;
        const ratio = Math.max(0, u.hp / u.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - w / 2, y - stats.radius - 9, w, 3.5);
        ctx.fillStyle = ratio > 0.5 ? '#58d68d' : ratio > 0.25 ? '#ffd35c' : '#ff5566';
        ctx.fillRect(x - w / 2, y - stats.radius - 9, w * ratio, 3.5);
      }
    }
  }

  drawProjectiles(ctx, game, alpha) {
    for (const p of game.projectiles) {
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      if (!this.visible(x, y)) continue;
      ctx.fillStyle = p.splash > 0 ? '#ffb347' : TEAM_COLORS[p.team];
      ctx.beginPath();
      ctx.arc(x, y, p.splash > 0 ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawGhost(ctx, game, uiState) {
    if (!uiState.selected || uiState.selected === 'income') return;
    if (uiState.mouseX == null) return;
    const stats = UNITS[uiState.selected];
    const valid = game.isValidPlacement(0, uiState.mouseX, uiState.mouseY);
    ctx.save();
    ctx.translate(uiState.mouseX, uiState.mouseY);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = valid ? '#58d68d' : '#ff5566';
    ctx.fillStyle = valid ? 'rgba(88, 214, 141, 0.2)' : 'rgba(255, 85, 102, 0.2)';
    ctx.lineWidth = 2;
    drawShape(ctx, stats.shape, stats.radius);
    ctx.fill();
    ctx.stroke();
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
