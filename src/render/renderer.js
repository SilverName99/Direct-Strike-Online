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

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const maxW = wrap.clientWidth;
    const maxH = wrap.clientHeight;
    const aspect = CONFIG.FIELD_W / CONFIG.FIELD_H;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = this.canvas.width / CONFIG.FIELD_W;
  }

  // Convert a mouse event to sim coordinates.
  toSim(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * CONFIG.FIELD_W;
    const y = ((evt.clientY - rect.top) / rect.height) * CONFIG.FIELD_H;
    return { x, y };
  }

  draw(game, alpha, uiState, effects) {
    const { ctx } = this;
    const s = this.scale;
    ctx.save();
    ctx.setTransform(s, 0, 0, s, 0, 0);

    this.drawField(ctx);
    this.drawTemplates(ctx, game);
    this.drawBases(ctx, game);
    this.drawUnits(ctx, game, alpha);
    this.drawProjectiles(ctx, game, alpha);
    effects.draw(ctx);
    this.drawGhost(ctx, game, uiState);

    ctx.restore();
  }

  drawField(ctx) {
    ctx.fillStyle = '#0e141d';
    ctx.fillRect(0, 0, CONFIG.FIELD_W, CONFIG.FIELD_H);

    // deployment zones
    ctx.fillStyle = 'rgba(77, 166, 255, 0.05)';
    ctx.fillRect(0, 0, CONFIG.ZONE_LEFT_MAX, CONFIG.FIELD_H);
    ctx.fillStyle = 'rgba(255, 85, 102, 0.05)';
    ctx.fillRect(CONFIG.ZONE_RIGHT_MIN, 0, CONFIG.FIELD_W - CONFIG.ZONE_RIGHT_MIN, CONFIG.FIELD_H);

    // zone borders
    ctx.strokeStyle = 'rgba(77, 166, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(CONFIG.ZONE_LEFT_MAX, 0);
    ctx.lineTo(CONFIG.ZONE_LEFT_MAX, CONFIG.FIELD_H);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 85, 102, 0.25)';
    ctx.beginPath();
    ctx.moveTo(CONFIG.ZONE_RIGHT_MIN, 0);
    ctx.lineTo(CONFIG.ZONE_RIGHT_MIN, CONFIG.FIELD_H);
    ctx.stroke();

    // midline
    ctx.strokeStyle = 'rgba(124, 139, 161, 0.15)';
    ctx.beginPath();
    ctx.moveTo(CONFIG.FIELD_W / 2, 0);
    ctx.lineTo(CONFIG.FIELD_W / 2, CONFIG.FIELD_H);
    ctx.stroke();
    ctx.setLineDash([]);
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

  drawTemplates(ctx, game) {
    ctx.save();
    for (const team of [0, 1]) {
      ctx.strokeStyle = TEAM_COLORS[team];
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.5;
      const rot = team === 0 ? 0 : Math.PI;
      for (const tpl of game.templates[team]) {
        const stats = UNITS[tpl.type];
        ctx.save();
        ctx.translate(tpl.x, tpl.y);
        ctx.rotate(rot);
        drawShape(ctx, stats.shape, stats.radius);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawUnits(ctx, game, alpha) {
    for (const u of game.entities) {
      const stats = UNITS[u.type];
      const x = u.prevX + (u.x - u.prevX) * alpha;
      const y = u.prevY + (u.y - u.prevY) * alpha;
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
