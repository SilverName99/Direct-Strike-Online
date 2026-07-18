import { CONFIG } from '../config.js';
import { UNITS } from '../units.js';
import { hasCharacter, drawCharacter, drawStructureSprite, drawBuildingSprite, drawConstructSprite, drawProjectileSprite, drawAbilityProjectileSprite, drawAcidProjectileSprite, drawFireProjectileSprite, hasStructureAttack, drawStructureAttack, drawMainTierSprite, hasTowerTierArt, drawTowerSprite, drawWallSprite, castAnimOf, hasPrepareAnim, hasDashAnim, hasAcidAnim, hasFireAnim, hasShieldAnim, hasFootAnim, hasBeastAnim, hasMorphAnim, hasSummonAnim, sizeOf } from './characters.js';
import { getBackground, getMiddleImage, getSprite, raceOf, getViewerTeam } from './sprites.js';
import { snapToZone, zoneFor } from '../ui/grid.js';
import { structureExtents } from '../sim/entity.js';
import { resolvedAbility } from '../ui/balance.js';
import { effectVal } from '../sim/abilities.js';
import { drawAura, drawSlow, drawAcid, drawHasteSparks, drawRegenCross, drawImmuneHalo, drawLightShield } from './vfx.js';

export const TEAM_COLORS = ['#4da6ff', '#ff5566'];
// viewer-relative team color: MY team is always blue, the enemy always red —
// online the local player can be team 1 and must still read as friendly
export const teamColor = (t) => TEAM_COLORS[t === getViewerTeam() ? 0 : 1];

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
export const teamColorDark = (t) => TEAM_COLORS_DARK[t === getViewerTeam() ? 0 : 1];

// Draws a unit shape centered at (0,0) in a pre-transformed context.
// Tower attack period for a base tier (mirrors balance.towerStatForTier).
function towerPeriodFor(bs, tier) {
  return (tier >= 3 ? (bs.period3 ?? bs.period2 ?? bs.period)
    : tier === 2 ? (bs.period2 ?? bs.period) : bs.period) || 1;
}

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
    case 'star': {
      const pts = 5;
      for (let i = 0; i < pts * 2; i++) {
        const rr = i % 2 === 0 ? r * 1.3 : r * 0.55;
        const a = -Math.PI / 2 + (i * Math.PI) / pts;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
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

  // Attack frame driven purely by the swing state, so it's perfectly synced and
  // never flickers: Attack 1 while winding up (raising / aiming), Attack 2 once
  // the hit/shot has fired (until the next swing). Exactly one Attack 1 ->
  // Attack 2 cycle per attack, matching the Attack period. (An earlier free-run
  // clock added stray flips during the between-shots cooldown — that's gone.)
  attackFrame(u) {
    return u.windup > 0 ? 0 : 1;
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
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    // Cap the backing store: a 4K / high-DPR display would otherwise build an
    // enormous canvas that some GPUs rasterize in tiles and present half-drawn
    // (flickering black bands in fullscreen), besides tanking the frame rate.
    // Normal displays (<=1440p) stay at full device resolution. screenToWorld
    // derives the real ratio from canvas-vs-CSS size, so input stays exact.
    const MAX_DIM = 2880;
    let dpr = window.devicePixelRatio || 1;
    const longest = Math.max(cssW, cssH) * dpr;
    if (longest > MAX_DIM) dpr *= MAX_DIM / longest;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
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

    this.drawField(ctx, game);
    this.drawGrid(ctx, uiState);
    this.drawFireZones(ctx, game); // burning ground sits on the terrain, under everything
    this.drawTemplates(ctx, game, uiState);
    this.drawMineSpots(ctx, game); // ghost plots where the player's mines can rise
    this.drawStructures(ctx, game);
    effects.drawStructureCorpses(ctx); // toppled towers crumble where they stood
    this.drawWorkers(ctx, game); // little miners shuttling gold to the base
    effects.drawCorpses(ctx); // fallen puppets lie under the living
    this.drawUnits(ctx, game, alpha);
    this.drawProjectiles(ctx, game, alpha);
    effects.draw(ctx);
    if (uiState.showRanges) this.drawRanges(ctx, game); // 🎯 debug overlay
    this.drawInspect(ctx, game, uiState, alpha);
    this.drawGhost(ctx, game, uiState);

    ctx.restore();
  }

  drawField(ctx, game) {
    ctx.fillStyle = '#0e141d';
    ctx.fillRect(0, 0, CONFIG.FIELD_W, CONFIG.FIELD_H);

    // per-race background on each side's half of the field; the enemy (right)
    // half is MIRRORED so both maps read the same way — base at the outer edge,
    // the neutral seam meeting in the middle
    const mid = CONFIG.FIELD_W / 2;
    this.drawBackgroundHalf(ctx, getBackground(raceOf(0)), 0, mid, false);
    this.drawBackgroundHalf(ctx, getBackground(raceOf(1)), mid, mid, true);
    // GLOBAL neutral strip over the seam (the variant the sim picked this match)
    this.drawMiddleStrip(ctx, getMiddleImage(game.middleSlot != null ? game.middleSlot : -1), mid);

    // per-team base quadrant: army zone (back) + construction zone (front)
    const tints0 = ['rgba(77, 166, 255,', 'rgba(255, 85, 102,'];
    const tints = [tints0[getViewerTeam() === 0 ? 0 : 1], tints0[getViewerTeam() === 0 ? 1 : 0]]; // my side always blue
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

  // Burning ground left by fireballs (Fireball upgrade): a flickering fiery
  // patch that fades out in its final moments. Read straight from sim state.
  drawFireZones(ctx, game) {
    const zones = game.fireZones;
    if (!zones || !zones.length) return;
    for (const z of zones) {
      if (!this.visible(z.x, z.y, z.radius + 40)) continue;
      const left = z.until - game.time;
      const fade = Math.max(0, Math.min(1, left / 0.6)); // ease out over the last 0.6s
      const flick = 0.72 + 0.28 * Math.sin(this.now * 9 + z.x * 0.05);
      ctx.save();
      ctx.globalAlpha = 0.34 * fade * flick;
      const g = ctx.createRadialGradient(z.x, z.y, z.radius * 0.12, z.x, z.y, z.radius);
      g.addColorStop(0, '#ffe08a');
      g.addColorStop(0.45, '#ff7a1a');
      g.addColorStop(1, 'rgba(150, 30, 8, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Ambient life: for every gold generator with uploaded "worker" sprites,
  // little miners shuttle between the mine and the owning team's base — empty
  // sacks on the way out, full sacks on the way back. Purely cosmetic (no sim
  // state), driven by the render clock and offset per generator so they don't
  // march in lockstep.
  drawWorkers(ctx, game) {
    const now = this.now;
    const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    this.workerHits = []; // world-space click targets for the inspect panel
    for (const s of game.structures) {
      if (s.kind !== 'generator' || s.hp <= 0) continue;
      if (!this.visible(s.x, s.y, 400)) continue;
      const base = game.mainOf(s.team);
      if (!base) continue;
      const race = raceOf(s.team);
      // opt-in: only if the mine has walking worker art uploaded
      const hasEmpty = !!getSprite(race, 'generator', 'worker-empty', 0);
      const hasFull = !!getSprite(race, 'generator', 'worker-full', 0);
      if (!hasEmpty && !hasFull) continue;

      // configurable size / speed / count (⚙ stats on the Generator)
      const gs = game.bstat(s.team, 'generator');
      const count = cl(Math.round(gs.workerCount ?? 2), 0, 8);
      if (count === 0) continue;
      const speed = cl(gs.workerSpeed || 100, 10, 1000);
      const scale = cl(gs.workerSize || 1, 0.2, 4);
      const animRate = cl(gs.workerAnimSpeed ?? 6, 0.2, 30); // walk-frame flips/s

      const d = Math.hypot(s.x - base.x, s.y - base.y) || 1;
      const legT = Math.max(0.6, d / speed);   // seconds for one leg
      const pauseT = cl(gs.workerPause ?? 1.5, 0, 8); // dwell at mine & at base
      const total = legT * 2 + pauseT * 2;
      const h = 26 * scale;
      for (let w = 0; w < count; w++) {
        const tt = (now + s.id * 2.7 + (w * total) / count) % total;
        // phases: out(empty) -> idle@mine -> back(full) -> idle@base
        let from; let to; let frac; let anim; let idle = false;
        if (tt < legT) { from = base; to = s; frac = tt / legT; anim = 'worker-empty'; }
        else if (tt < legT + pauseT) { from = base; to = s; frac = 1; idle = true; }
        else if (tt < legT * 2 + pauseT) { from = s; to = base; frac = (tt - legT - pauseT) / legT; anim = 'worker-full'; }
        else { from = s; to = base; frac = 1; idle = true; }

        // while it "loads/unloads", the worker steps INSIDE the mine/base and
        // vanishes — nothing drawn, nothing to click, until it comes back out
        if (idle) continue;

        const x = from.x + (to.x - from.x) * frac;
        const y = from.y + (to.y - from.y) * frac;
        // register a click target (centered on the drawn body)
        this.workerHits.push({ structId: s.id, w, team: s.team, x, y: y - h / 2 + 4, r: Math.max(14, h * 0.6) });
        ctx.save();
        ctx.translate(x, y);
        if (to.x < from.x) ctx.scale(-1, 1); // face travel direction (art faces right)
        // PNG only on the map: a 2-frame walk cycle. (mp4 clips play only in
        // the portrait box on click, never here.)
        const frame = Math.floor(now * animRate + w) % 2;
        const entry = getSprite(race, 'generator', anim, frame) || getSprite(race, 'generator', anim, 0)
          // fallbacks so a partial upload still shows something
          || getSprite(race, 'generator', 'worker-full', frame)
          || getSprite(race, 'generator', 'worker-empty', frame);
        if (entry && entry.img) {
          const img = entry.img;
          const sc = h / img.height;
          ctx.drawImage(img, (-img.width * sc) / 2, -h + 4, img.width * sc, h);
        }
        ctx.restore();
      }
    }
  }

  // Nearest shuttling worker under (x,y) in world space, from the last frame's
  // recorded positions, or null. Used to make the little miners clickable.
  hitTestWorker(x, y) {
    let best = null; let bestD = Infinity;
    for (const h of this.workerHits || []) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= h.r && d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  // Placement grid over the relevant zone while placing or dragging. Only the
  // MAJOR lines (every GRID_MAJOR cells) are drawn — placement still snaps to
  // the fine cell, whose green highlight travels with the cursor.
  drawGrid(ctx, uiState) {
    if (!uiState.gridOn) return;
    let zone = null;
    if (uiState.selected && uiState.selected !== 'upgrade') zone = zoneFor(uiState.selected, uiState.mouseX, uiState.mouseY, uiState.myTeam || 0);
    else if (uiState.drag) zone = CONFIG.ARMY_ZONE[uiState.myTeam || 0]; // MY army zone (team 1 = right)
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
      const team = sel.team != null ? sel.team : (uiState.myTeam || 0);
      const tpl = game.templates[team][sel.index];
      if (tpl) {
        const us = game.ustat(team, tpl.type);
        const r = Math.max(14, (us.radius || 10) * Math.max(1, sizeOf(raceOf(team), tpl.type) || 1) + 8);
        const pos = this.templateDrawPos(uiState, team, sel.index, tpl); // ride the drag preview
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
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
    } else if (sel.kind === 'worker') {
      // ring the specific miner at its current (last-frame) position
      const h = (this.workerHits || []).find((k) => k.structId === sel.structId && k.w === sel.w);
      if (h) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // A 3-tier tower's frame, chosen by the owner's base tier and its activity:
  // firing -> attack frames; a long lull with no target -> soldiers come down
  // and light a campfire; otherwise the idle pulse. The idle timer is purely
  // render-side (cosmetic) so it never touches the sim. Context is already
  // translated to the tower and mirrored for team 1.
  drawTower(ctx, game, s, hw, hh) {
    const tier = game.tier[s.team];
    const tgt = s.targetId != null ? game.byId.get(s.targetId) : null;
    const firing = !!(tgt && tgt.hp > 0);
    const bs = game.bstat(s.team, 'tower');

    // track seconds since this tower last had a target (reset while firing)
    this._towerIdle ||= new Map();
    if (firing || !this._towerIdle.has(s.id)) this._towerIdle.set(s.id, this.now);
    const idleFor = this.now - this._towerIdle.get(s.id);

    if (firing) {
      const period = towerPeriodFor(bs, tier);
      const sinceFire = period - s.cooldown; // 0 right after a shot
      // hold the "fire" (Attack 2) frame for a configurable beat, capped at the
      // reload so it always returns to Attack 1 before the next shot
      const flash = Math.min(Math.max(0.02, bs.attackHold ?? 0.4), period);
      const frame = sinceFire >= 0 && sinceFire < flash ? 1 : 0;
      return drawTowerSprite(ctx, s.team, tier, hw, hh, 'attack', frame);
    }
    if (idleFor >= (bs.campfireDelay ?? 60)) {
      // the tower stands empty (soldiers came down); its "at rest" frame falls
      // back to the normal idle if that art wasn't uploaded
      let drawn = drawTowerSprite(ctx, s.team, tier, hw, hh, 'camptower', 0);
      if (!drawn) drawn = drawTowerSprite(ctx, s.team, tier, hw, hh, 'idle', 0);
      // the soldiers + fire are a SEPARATE sprite, off to the tower's own-base
      // side, nudged per-tower so several towers don't line up identically
      this.drawCampfire(ctx, s, tier, hw, hh, bs);
      return drawn;
    }
    const frame = (Math.floor(this.now * (bs.idleSpeed || 2)) + s.id) % 2;
    return drawTowerSprite(ctx, s.team, tier, hw, hh, 'idle', frame);
  }

  // The campfire soldiers, drawn beside the tower base while it's idling. The
  // context is already translated to the tower and mirrored for team 1, so a
  // negative local x sits on that team's own-base side (symmetric per side).
  // Only draws if the tier's "camp" soldier art was uploaded.
  drawCampfire(ctx, s, tier, hw, hh, bs) {
    const speed = bs.campSpeed || 3;
    const frame = Math.floor(this.now * speed) % 2; // fire/soldier flicker
    // per-tier soldier size (falls back to the tier-1 value)
    const cs = tier >= 3 ? (bs.campSize3 ?? bs.campSize) : tier === 2 ? (bs.campSize2 ?? bs.campSize) : bs.campSize;
    const scale = Math.max(0.1, Math.min(4, cs ?? 0.8));
    // stable pseudo-random nudge from the tower id (no per-frame jitter)
    const j = (s.id * 2654435761) >>> 0;
    const jx = (j & 63) / 63;          // 0..1
    const jy = ((j >> 6) & 63) / 63;   // 0..1
    const dx = -(hw * 0.85 + 6 + jx * hw * 0.7); // to the left of the base
    const dy = hh * 0.35 + jy * hh * 0.35;       // a touch below center
    ctx.save();
    ctx.translate(dx, dy);
    drawTowerSprite(ctx, s.team, tier, hw * scale, hh * scale, 'camp', frame);
    ctx.restore();
  }

  // The player's free mine plots: the mine art drawn as a faded ghost (or a
  // dashed footprint + pick glyph with no art), so you always see where your
  // mines can rise. Occupied plots draw nothing — the real mine stands there.
  drawMineSpots(ctx, game) {
    if (!game.mineSpots) return;
    const my = getViewerTeam();
    const ext = structureExtents('generator', game.bstat(my, 'generator'));
    for (const p of game.mineSpots[my]) {
      if (!game.mineSpotFree(p)) continue;
      if (!this.visible(p.x, p.y, 160)) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (my === 1) ctx.scale(-1, 1);
      ctx.globalAlpha = 0.35;
      const drawn = drawBuildingSprite(ctx, 'generator', my, ext.hw, ext.hh, 0);
      if (!drawn) {
        ctx.strokeStyle = '#ffd35c';
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2;
        ctx.strokeRect(-ext.hw, -ext.hh, ext.hw * 2, ext.hh * 2);
        ctx.setLineDash([]);
        ctx.font = `${Math.round(ext.hh)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⛏', 0, 2);
      }
      ctx.restore();
    }
  }

  drawStructures(ctx, game) {
    // depth sort (painter's): draw back-to-front by each building's base Y, so a
    // structure standing IN FRONT of the mid turret (lower on screen) overlaps
    // it, while one behind it (higher up) stays under it
    const baseY = (s) => s.y + (s.hh || s.radius);
    const ordered = [...game.structures].sort((a, b) => baseY(a) - baseY(b));
    for (const s of ordered) {
      if (!this.visible(s.x, s.y, s.radius + 320)) continue;
      const color = teamColor(s.team);
      const dark = teamColorDark(s.team);
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
      // Construction site: while `building`, draw the 2 șantier frames instead
      // of the finished art (frame 1 from 30% progress, frame 2 from 60%);
      // before 30% the first frame shows faded-in. No uploaded construct art ->
      // the finished building rises as a ghost. A gold bar tracks progress.
      if (s.building) {
        const p = Math.min(1, Math.max(0, (game.time - s.buildStart) / Math.max(0.01, s.buildDone - s.buildStart)));
        ctx.save();
        if (s.team === 1) ctx.scale(-1, 1);
        ctx.globalAlpha = p < 0.3 ? 0.45 : 1;
        let cDrawn = drawConstructSprite(ctx, s.kind, s.team, hw, hh, p < 0.6 ? 0 : 1);
        if (!cDrawn) {
          ctx.globalAlpha = 0.3 + 0.5 * p;
          cDrawn = drawBuildingSprite(ctx, s.kind, s.team, hw, hh, 0);
        }
        ctx.restore();
        if (!cDrawn) { // no art at all: dashed outline so the site still reads
          ctx.strokeStyle = color;
          ctx.setLineDash([5, 4]);
          ctx.globalAlpha = 0.7;
          ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        spriteDrawn = true; // skip the normal idle/attack art paths below
        // (the construction progress bar is drawn near the HP bar below, as a
        // matching rounded pill stacked above it, so the two never overlap)
      }
      if (!s.building) {
        ctx.save();
        if (s.team === 1) ctx.scale(-1, 1);
        if (s.kind === 'main' && s.hp <= 0) ctx.globalAlpha = 0.35;
        // 3-tier tower art: idle / attack / campfire chosen by tier + activity
        if (s.kind === 'tower' && hasTowerTierArt(s.team)) {
          spriteDrawn = this.drawTower(ctx, game, s, hw, hh);
        }
        // Armed buildings (turret/tower) show their attack animation while
        // engaged: "fire" frame right after each shot, "aim" frame otherwise.
        if (!spriteDrawn && (s.kind === 'turret' || s.kind === 'tower') && hasStructureAttack(s.kind, s.team)) {
          const tgt = s.targetId != null ? game.byId.get(s.targetId) : null;
          if (tgt && tgt.hp > 0) {
            const abs = game.bstat(s.team, s.kind);
            const period = s.kind === 'tower' ? towerPeriodFor(abs, game.tier[s.team]) : (abs.period || 1);
            const sinceFire = period - s.cooldown; // 0 right after a shot
            const flash = Math.min(Math.max(0.02, abs.attackHold ?? 0.16), period);
            const frame = sinceFire >= 0 && sinceFire < flash ? 1 : 0;
            spriteDrawn = drawStructureAttack(ctx, s.kind, s.team, hw, hh, frame);
          }
        }
        if (!spriteDrawn && s.kind === 'wall') {
          // walls show a per-base-tier idle look (falls back to plain idle art)
          spriteDrawn = drawWallSprite(ctx, s.team, game.tier[s.team], hw, hh, this.now, s.id);
        }
        if (!spriteDrawn) {
          if (s.kind === 'main') {
            // While upgrading, already show the NEXT tier's art but faded, so
            // the base visibly "becomes" its upgraded self as the bar fills.
            const upgrading = game.baseUpgrading(s.team);
            const showTier = upgrading ? game.baseUpgradeToTier(s.team) : game.tier[s.team];
            if (upgrading) ctx.globalAlpha *= 0.5;
            spriteDrawn = drawMainTierSprite(ctx, s.team, showTier, hw, hh); // per-upgrade image
          } else {
            spriteDrawn = drawStructureSprite(ctx, s.kind, s.team, hw, hh, this.now, s.id);
          }
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
      } else if (!spriteDrawn && (s.kind === 'bldg1' || s.kind === 'bldg2' || s.kind === 'bldg3')) {
        // tech/unlock buildings: a box with a roof + a numeral placeholder
        ctx.fillStyle = dark;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-hw, -hh); ctx.lineTo(0, -hh - Math.min(hw, hh) * 0.6); ctx.lineTo(hw, -hh); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f2f5fa';
        ctx.font = `bold ${Math.round(Math.min(hw, hh) * 0.9)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.kind === 'bldg1' ? 'I' : s.kind === 'bldg2' ? 'II' : 'III', 0, 2);
      } else if (!spriteDrawn && s.kind === 'farm') {
        // farm placeholder: a barn box with a roof + a wheat glyph
        ctx.fillStyle = dark;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-hw, -hh); ctx.lineTo(0, -hh - Math.min(hw, hh) * 0.6); ctx.lineTo(hw, -hh); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e8c860';
        ctx.font = `${Math.round(Math.min(hw, hh) * 1.0)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🌾', 0, 2);
      } else if (!spriteDrawn && s.kind === 'herohall') {
        // hero hall placeholder: a hall box with a roof + a star glyph
        ctx.fillStyle = dark;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-hw, -hh); ctx.lineTo(0, -hh - Math.min(hw, hh) * 0.6); ctx.lineTo(hw, -hh); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffd35c';
        ctx.font = `${Math.round(Math.min(hw, hh) * 1.0)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('★', 0, 2);
      }
      ctx.restore();

      // HP bar (main always; others when damaged) — sits above the sprite's
      // real drawn height: main/turret art is r*3*size tall (centered), so
      // its top edge is 1.5*r*size above center; footprint buildings fit
      // their hh*size box. Vector fallbacks stay at the physical radius.
      if (s.kind === 'main' || s.hp < s.maxHp || CONFIG.HEALTHBAR_ALWAYS) {
        // slim rounded pill: narrower than the footprint, thin, dark inset
        // with a hairline border — reads clearly without dominating the art
        const size = Math.max(1, sizeOf(raceOf(s.team), s.kind));
        const topH = spriteDrawn
          ? (s.kind === 'main' || s.kind === 'turret' ? r * 1.5 * size : (s.hh || r) * size)
          : r;
        const w = s.kind === 'main' ? 84 : Math.max(30, r * 1.9);
        const h = s.kind === 'main' ? 6 : 4;
        const bx = s.x - w / 2;
        const by = s.y - topH - (s.kind === 'main' ? 13 : 9);
        const ratio = Math.max(0, s.hp / s.maxHp);
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, w, h, h / 2); else ctx.rect(bx, by, w, h);
        ctx.fillStyle = 'rgba(6,9,14,0.75)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.stroke();
        if (ratio > 0.01) {
          ctx.beginPath();
          const iw = Math.max(h - 2, (w - 2) * ratio);
          if (ctx.roundRect) ctx.roundRect(bx + 1, by + 1, iw, h - 2, (h - 2) / 2); else ctx.rect(bx + 1, by + 1, iw, h - 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.restore();

        // Construction progress: a matching gold pill stacked just ABOVE the
        // HP bar (never overlapping it) so both read at a glance. Shown while a
        // building is under construction AND while the base is upgrading tiers
        // (same bar — no separate frames for the base).
        const baseUpg = s.kind === 'main' && game.baseUpgrading(s.team);
        if (s.building || baseUpg) {
          const p = baseUpg
            ? game.baseUpgradeProgress(s.team)
            : Math.min(1, Math.max(0, (game.time - s.buildStart) / Math.max(0.01, s.buildDone - s.buildStart)));
          const by2 = by - h - 3;
          ctx.save();
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx, by2, w, h, h / 2); else ctx.rect(bx, by2, w, h);
          ctx.fillStyle = 'rgba(6,9,14,0.75)';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.stroke();
          if (p > 0.01) {
            ctx.beginPath();
            const iw = Math.max(h - 2, (w - 2) * p);
            if (ctx.roundRect) ctx.roundRect(bx + 1, by2 + 1, iw, h - 2, (h - 2) / 2); else ctx.rect(bx + 1, by2 + 1, iw, h - 2);
            ctx.fillStyle = '#ffd35c';
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }
  }

  // 🎯 debug overlay (the HUD button next to the tier badge): for every unit
  // its PHYSICAL body box (white) and its true attack reach — the box expanded
  // by its range with rounded corners, exactly how effDist measures (green =
  // yours, red = enemy). Armed structures show their reach dashed, and round
  // structures (main/turret) also show their collision circle — the invisible
  // wall ground units stop at.
  drawRanges(ctx, game) {
    const contour = (x, y, hw, hh, r) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - hw - r, y - hh - r, (hw + r) * 2, (hh + r) * 2, r);
      else ctx.rect(x - hw - r, y - hh - r, (hw + r) * 2, (hh + r) * 2);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineWidth = 1;
    for (const u of game.entities) {
      if (u.hp <= 0 || !this.visible(u.x, u.y)) continue;
      const s = game.ustatOf(u);
      const hw = u.hw || u.radius;
      const hh = u.hh || u.radius;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.strokeRect(u.x - hw, u.y - hh, hw * 2, hh * 2);
      const r = Math.max(s.range || 0, 4); // reach floor matches atkRange()
      ctx.strokeStyle = u.team === getViewerTeam() ? 'rgba(88,214,141,0.85)' : 'rgba(255,95,110,0.85)';
      contour(u.x, u.y, hw, hh, r);
    }
    ctx.setLineDash([6, 4]);
    for (const st of game.structures) {
      if (st.hp <= 0 || st.building) continue;
      const bs = game.bstat(st.team, st.kind);
      const hw = st.hw || st.radius;
      const hh = st.hh || st.radius;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.strokeRect(st.x - hw, st.y - hh, hw * 2, hh * 2);
      if (st.kind === 'main' || st.kind === 'turret') {
        ctx.strokeStyle = 'rgba(255,211,92,0.85)';
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      if ((bs.damage || 0) > 0 && (bs.range || 0) > 0) {
        ctx.strokeStyle = st.team === getViewerTeam() ? 'rgba(88,214,141,0.7)' : 'rgba(255,95,110,0.7)';
        contour(st.x, st.y, hw, hh, bs.range);
      }
    }
    ctx.restore();
  }

  // Slim rounded-pill bar (HP / mana): dark inset + hairline border + rounded
  // inner fill. (bx, by) is the top-left; the fill never shrinks below a dot.
  pillBar(ctx, bx, by, w, h, ratio, color) {
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, h / 2); else ctx.rect(bx, by, w, h);
    ctx.fillStyle = 'rgba(6,9,14,0.78)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    const r = Math.max(0, Math.min(1, ratio));
    if (r > 0.01) {
      ctx.beginPath();
      const iw = Math.max(h - 2, (w - 2) * r);
      if (ctx.roundRect) ctx.roundRect(bx + 1, by + 1, iw, h - 2, (h - 2) / 2); else ctx.rect(bx + 1, by + 1, iw, h - 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }

  // Where a formation template is DRAWN this frame. Normally its sim position,
  // but while the viewer drags it we follow the local preview (instant, no
  // network wait), and just after a drop we hold it at the target until the
  // network-delayed moveUnit lands (so it doesn't snap back online).
  templateDrawPos(uiState, team, i, tpl) {
    const d = uiState.drag;
    if (team === getViewerTeam() && d && i === d.index && d.x != null) return { x: d.x, y: d.y };
    const pm = uiState.pendingMove;
    if (pm && team === pm.team && i === pm.index) {
      const caught = Math.abs(tpl.x - pm.x) < 1 && Math.abs(tpl.y - pm.y) < 1;
      if (caught || performance.now() > pm.until) uiState.pendingMove = null;
      else return { x: pm.x, y: pm.y };
    }
    return { x: tpl.x, y: tpl.y };
  }

  drawTemplates(ctx, game, uiState) {
    // Which of the player's templates is hovered (for drag/sell affordance)?
    const hoverIdx = uiState.drag
      ? uiState.drag.index
      : hitTestTemplate(game, getViewerTeam(), uiState.mouseX, uiState.mouseY);

    ctx.save();
    for (const team of [0, 1]) {
      ctx.strokeStyle = teamColor(team);
      ctx.lineWidth = 1.5;
      const rot = team === 0 ? 0 : Math.PI;
      game.templates[team].forEach((tpl, i) => {
        const pos = this.templateDrawPos(uiState, team, i, tpl);
        if (!this.visible(pos.x, pos.y)) return;
        const stats = UNITS[tpl.type];
        const hot = team === getViewerTeam() && i === hoverIdx && !uiState.selected;
        const dragging = team === getViewerTeam() && uiState.drag && i === uiState.drag.index;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        if (dragging && uiState.gridOn) {
          // moving a placed unit: highlight the grid cells it will occupy
          const us = game.ustat(team, tpl.type);
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
          ctx.strokeStyle = teamColor(team);
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
      const color = teamColor(u.team);
      // visual scale: dismounted units use the upgrade's on-foot size, else the
      // unit's own Size (%)
      let vScale = (u.dismounted || u.beast || u.summon) && u.ovSize != null ? u.ovSize : sizeOf(raceOf(u.team), u.type);
      // Beast Form: the morphed hero draws at its beast size (visual only, so
      // the deterministic sim/collision stays untouched) — but keep hero size
      // while the Prepare/Transform cast frames play (u.castState set)
      if (u.morph && u.morphUntil > game.time && !u.castState) vScale *= u.morph.size;
      // temporary size buff (Bloodlust makes the Chieftain grow while raging) —
      // purely visual, so the deterministic sim/collision is untouched
      const sizeUp = effectVal(u, 'sizeup', game.time);
      if (sizeUp > 0) vScale *= sizeUp / 100;

      if (u.isAir) {
        // soft shadow under flyers — scales with the unit's drawn Size so a
        // bigger flyer casts a bigger shadow
        const sr = stats.radius * Math.max(0.2, vScale);
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(x, y + sr + 6, sr * 0.9, sr * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // casters project their aura circles beneath everyone's feet
      const rstats = game.ustatOf(u);
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
        // a caster whose "attack" IS an ability (e.g. Empower) has no basic
        // attack: while it stands in place doing its job it should loop that
        // ability's two "Cast X" frames continuously (no idle between casts).
        let replaceAb = null;
        if (isCaster && rstats.abilities) {
          for (const aid of rstats.abilities) {
            const ab = resolvedAbility(aid);
            if (ab && ab.attackReplacing && game.abilityUsable(u.team, u.type, aid)) { replaceAb = { aid, params: ab.params }; break; }
          }
        }
        // hold the attack anim briefly so range-boundary jitter can't
        // flicker back-row units between attack and walk
        if (u.state === 'attack' && !u.spellHold) this.attackHold.set(u.id, this.now);
        const held = this.attackHold.get(u.id);
        const attacking = (u.state === 'attack' && !u.spellHold) || (held !== undefined && this.now - held < 0.3);
        if (replaceAb && !u.castState && u.state !== 'march' && !u.dashing) {
          // standing in place between casts: loop Cast 1 <-> Cast 2 at the pace
          // set on the ability (frame1Time / frame2Time), never the idle frame.
          // (an ACTIVE cast — e.g. throwing a totem — is handled below so its
          // own cast frames show instead of the empower loop.)
          anim = castAnimOf(u.type, u.team, replaceAb.aid) || (prep ? 'prepare' : 'attack');
          const t0 = Math.max(0.05, replaceAb.params.frame1Time != null ? replaceAb.params.frame1Time : 0.4);
          const t1 = Math.max(0.05, replaceAb.params.frame2Time != null ? replaceAb.params.frame2Time : 0.4);
          const phase = (this.now + u.id * 0.137) % (t0 + t1);
          frame = phase < t0 ? 0 : 1;
        } else if (isCaster && u.castState) {
          // active-cast FSM drives the pose frame-accurately: "Prepare spell"
          // during the wind-up, then the single "Cast X" release frame exactly
          // when the effect fires (heal lands / bolt leaves). Both fall back
          // gracefully to attack/idle when a frame isn't uploaded.
          const castAb = resolvedAbility(u.castAbility);
          const twoPhase = !!(castAb && castAb.castTwoPhase); // Beast Form: cast 1 = prepare, cast 2 = transform
          const castA = castAnimOf(u.type, u.team, u.castAbility);
          if (u.castState === 'prepare') {
            // two-phase ability (Beast Form): the wind-up shows its OWN cast
            // frame 1 (Prepare); other casters use the shared "prepare" pose
            if (twoPhase && castA) { anim = castA; frame = 0; }
            else { anim = prep ? 'prepare' : 'attack'; frame = 0; }
          } else { // release
            anim = castA || (prep ? 'prepare' : 'attack');
            if (twoPhase) {
              // Prepare already used frame 1, so the release holds frame 2
              // (Transform) for its whole duration
              frame = 1;
            } else {
              // 2-frame cast: frame 1 for the first half of the cast, frame 2 for
              // the second half (frame 2 optional — falls back to 1 if not uploaded)
              const dur = (u.castPhaseEnd || 0) - (u.castPhaseStart || 0);
              frame = (dur > 0 && game.time - u.castPhaseStart >= dur * 0.5) ? 1 : 0;
            }
          }
        } else if (attacking) {
          if (isCaster && !rstats.isHero) {
            // regular caster auto-attacking (out of mana / between spells):
            // shared "prepare" during the wind-up, one "attack" release frame
            anim = u.windup > 0 && prep ? 'prepare' : 'attack';
            frame = 0;
          } else if (u.acidAttacker && hasAcidAnim(u.type, u.team)) {
            // Acid Spit upgrade: cycle the two "Acid" attack frames in step
            // with the unit's real attack period (one 1<->2 cycle per swing)
            anim = 'acid';
            frame = this.attackFrame(u);
          } else {
            // fighting: cycle Attack 1 <-> Attack 2 for as long as the unit
            // stays engaged, at the unit's OWN attack cadence — one full
            // cycle per swing, not the (fast) walk-flip clock
            anim = 'attack';
            frame = this.attackFrame(u);
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
        // fireball upgrade: swap walk/attack for the uploaded "Foc" sprite set
        if (u.fireAttacker && (anim === 'walk' || anim === 'attack') && hasFireAnim(u.type, u.team, anim)) {
          anim = `fire-${anim}`;
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
        // summoned animal: its art is hosted on the caster's type under an
        // "<animal>-" prefix (wolf-/eagle-/bear-). A totem is the exception —
        // it only ever stands, so it keeps its idle art; a moving summon has no
        // idle frames (it spawns into the fight), so map idle -> walk to avoid
        // falling back to the host caster's idle sprite.
        if (u.summon && u.summonKind && !u.totem && anim === 'idle') anim = 'walk';
        if (u.summon && u.summonKind && !anim.startsWith(`${u.summonKind}-`) && hasSummonAnim(u.type, u.team, u.summonKind, anim)) {
          anim = `${u.summonKind}-${anim}`;
        }
        // Beast Form (hero ultimate): swap to the uploaded "morph-" sprite set,
        // but NOT during the Prepare/Transform cast frames — the hero plays
        // those in its own form first, then the beast bursts out.
        if (u.morph && u.morphUntil > game.time && !u.castState && !anim.startsWith('morph-') && hasMorphAnim(u.type, u.team, anim)) {
          anim = `morph-${anim}`;
        }
        // Scut de lumină: show the "shield" pose only for the ACTIVATION moment
        // (configurable); after that the unit keeps fighting normally, with the
        // light dome (drawn separately) over it for the rest of the invuln
        if (u.shieldAt >= 0 && game.time < u.shieldAt + (u.shieldPose ?? 0.5) && hasShieldAnim(u.type, u.team)) {
          anim = 'shield'; frame = 0;
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

      // HP + mana as slim rounded pills (matching the building bars): dark inset
      // with a hairline border and a rounded inner fill — clean, not chunky
      // Slowing Totem: always show its HP bar + a depleting lifetime bar above
      // it (like a construction pill, but counting down).
      if (u.totem && u.despawnAt != null && u.maxLife > 0) {
        const w = Math.max(20, drawR * 2.4);
        const ratio = Math.max(0, u.hp / u.maxHp);
        const color = ratio > 0.5 ? '#58d68d' : ratio > 0.25 ? '#ffd35c' : '#ff5566';
        this.pillBar(ctx, x - w / 2, y - drawR - 10, w, 4, ratio, color);
        const tleft = Math.max(0, Math.min(1, (u.despawnAt - game.time) / u.maxLife));
        this.pillBar(ctx, x - w / 2, y - drawR - 15, w, 3, tleft, '#7fb4ff');
      } else if (u.hp < u.maxHp || CONFIG.HEALTHBAR_ALWAYS) {
        const w = Math.max(20, drawR * 2.4);
        const ratio = Math.max(0, u.hp / u.maxHp);
        const color = ratio > 0.5 ? '#58d68d' : ratio > 0.25 ? '#ffd35c' : '#ff5566';
        this.pillBar(ctx, x - w / 2, y - drawR - 10, w, 4, ratio, color);
      }
      // mana bar (casters only), right under the HP bar slot
      if (u.manaMax > 0) {
        const w = Math.max(20, drawR * 2.4);
        const mratio = Math.max(0, Math.min(1, u.mana / u.manaMax));
        this.pillBar(ctx, x - w / 2, y - drawR - 5, w, 3, mratio, '#4da6ff');
      }

      // status-effect indicators (slow swirl, haste sparks, regen cross...)
      if (u.effects && u.effects.length) {
        this.drawEffectIndicators(ctx, u, x, y, stats.radius);
      }
      // Scut de lumină: a glowing dome while invulnerable (only after the
      // activation pose finishes; fades out at the end)
      if (u.shieldUntil && game.time >= (u.shieldFrom || 0) && game.time < u.shieldUntil) {
        const fade = Math.max(0, Math.min(1, (u.shieldUntil - game.time) / 0.5));
        ctx.save();
        ctx.translate(x, y);
        drawLightShield(ctx, this.now, drawR * (u.shieldScale || 1), fade);
        ctx.restore();
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
        // Acid Spit / Fireball: their own uploaded projectile image, else the
        // unit's normal one; frost & other ability bolts use the per-ability image.
        drawn = p.acid
          ? (drawAcidProjectileSprite(ctx, p.srcType, p.team, size) || drawProjectileSprite(ctx, p.srcType, p.team, size))
          : p.fire
            ? (drawFireProjectileSprite(ctx, p.srcType, p.team, size) || drawProjectileSprite(ctx, p.srcType, p.team, size))
            : p.ability
              ? drawAbilityProjectileSprite(ctx, p.ability, p.srcType, p.team, size)
              : drawProjectileSprite(ctx, p.srcType, p.team, size);
        ctx.restore();
      }
      if (!drawn) {
        // ability projectiles glow in their ability color (frost = icy blue);
        // acid spits glow corrosive green, fireballs fiery orange
        const abColor = p.acid ? '#8fd14f' : p.fire ? '#ff7a1a' : (p.ability ? (resolvedAbility(p.ability) || {}).color : null);
        if (abColor) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = abColor;
          ctx.beginPath();
          ctx.arc(x, y, 7 * ps, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = abColor || (p.splash > 0 ? '#ffb347' : teamColor(p.team));
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
    const my = uiState.myTeam || 0;
    const us = isBuilding ? null : game.ustat(my, sel);
    const uw = us && us.cw > 1 ? us.cw : 1;
    const uh = us && us.ch > 1 ? us.ch : 1;

    // grid snap for display, same as the click will use (buildings AND
    // footprint units snap by their cw×ch box)
    let px = uiState.mouseX;
    let py = uiState.mouseY;
    if (uiState.gridOn) {
      const bs = isBuilding ? game.bstat(my, sel) : null;
      const cw = isBuilding ? bs.cw : uw;
      const ch = isBuilding ? bs.ch : uh;
      const p = snapToZone(zoneFor(sel, px, py, uiState.myTeam || 0), px, py, cw, ch);
      px = p.x;
      py = p.y;
    }
    // mines build ONLY on their plots: the cursor ghost jumps onto the plot
    // the click would land on (red when no free plot is near the cursor)
    let mineOk = true;
    if (sel === 'generator') {
      const spot = game.nearestFreeMineSpot
        ? game.nearestFreeMineSpot(my, uiState.mouseX, uiState.mouseY)
        : null;
      if (spot) { px = spot.x; py = spot.y; } else mineOk = false;
    }

    const valid = mineOk && (isBuilding
      ? game.isValidBuildPlacement(my, sel, px, py)
      : game.isValidPlacement(my, px, py, -1, sel));

    ctx.save();
    ctx.translate(px, py);
    if (my === 1) ctx.scale(-1, 1); // team 1 faces left, like the placed unit
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = valid ? '#58d68d' : '#ff5566';
    ctx.fillStyle = valid ? 'rgba(88, 214, 141, 0.2)' : 'rgba(255, 85, 102, 0.2)';
    ctx.lineWidth = 2;

    if (isBuilding) {
      const b = game.bstat(my, sel);
      const ext = structureExtents(sel, b);
      // colored footprint cells (the "patratele de dedesubt")
      drawFootprintCells(ctx, ext.hw, ext.hh, valid ? '#58d68d' : '#ff5566', 0.22);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = valid ? '#58d68d' : '#ff5566';
      ctx.strokeRect(-ext.hw, -ext.hh, ext.hw * 2, ext.hh * 2);
      // idle 1 sprite on the cursor (falls back to nothing if not uploaded)
      ctx.globalAlpha = valid ? 0.85 : 0.55;
      drawBuildingSprite(ctx, sel, my, ext.hw, ext.hh, 0);
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
      drawCharacter(ctx, sel, 'idle', 0, my, sizeOf(raceOf(my), sel));
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
