import { CONFIG } from '../config.js';
import { teamColor } from '../render/renderer.js';
import { getViewerTeam, getViewerSide } from '../render/sprites.js';

// Corner minimap: whole world in miniature + the camera rectangle.
// Click or drag on it to move the camera there.
export class Minimap {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.ctx = canvas.getContext('2d');
    this._sizedForW = 0; // FIELD_W the canvas was last sized for

    // Fixed CSS size; internal resolution matches for crispness.
    // Sized to fill the bottom-bar map panel (#bb-map), aspect preserved.
    this.resize();

    let panning = false;
    const jump = (e) => {
      const rect = canvas.getBoundingClientRect();
      const wx = ((e.clientX - rect.left) / rect.width) * CONFIG.FIELD_W;
      const wy = ((e.clientY - rect.top) / rect.height) * CONFIG.FIELD_H;
      this.camera.centerOn(wx, wy);
    };
    canvas.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      panning = true;
      jump(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (panning) jump(e);
    });
    window.addEventListener('mouseup', () => {
      panning = false;
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // Size the canvas for the CURRENT field (team modes lengthen the map, so the
  // aspect changes per match). Safe to call every newGame — no-ops if unchanged.
  resize() {
    const canvas = this.canvas;
    if (this._sizedForW === CONFIG.FIELD_W) return;
    this._sizedForW = CONFIG.FIELD_W;
    const dpr = window.devicePixelRatio || 1;
    const w = 350; // 350×(FIELD_H/FIELD_W) — fits the bottom-bar map panel
    const h = Math.round((w * CONFIG.FIELD_H) / CONFIG.FIELD_W);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    this.scale = canvas.width / CONFIG.FIELD_W;
  }

  // `fog` is the renderer's (already updated for the viewer's SIDE this frame);
  // hiding compares against that SIDE, since entities carry it in `team`.
  draw(game, fog = null) {
    const myTeam = getViewerSide();
    const { ctx } = this;
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(10, 14, 20, 0.92)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const fogOn = !!fog && game && game.winner === null;

    // base quadrants (construction + army zones)
    const tints = ['rgba(77, 166, 255, 0.18)', 'rgba(255, 85, 102, 0.18)'];
    if (game && game.zones && game.players && game.players.length > 2) {
      // team modes: every player's zone pair, tinted by side; dead zones vanish
      for (let p = 0; p < game.players.length; p++) {
        const zp = game.zones[p];
        if (!zp.alive) continue;
        ctx.fillStyle = tints[game.players[p].side === getViewerSide() ? 0 : 1];
        for (const z of [zp.build, zp.army]) {
          ctx.fillRect(z.x0 * s, z.y0 * s, (z.x1 - z.x0) * s, (z.y1 - z.y0) * s);
        }
      }
      for (const side of [0, 1]) {
        const mz = game.midBuild && game.midBuild[side];
        if (!mz) continue;
        ctx.fillStyle = tints[side === getViewerSide() ? 0 : 1];
        ctx.fillRect(mz.x0 * s, mz.y0 * s, (mz.x1 - mz.x0) * s, (mz.y1 - mz.y0) * s);
      }
    } else {
      for (const team of [0, 1]) {
        const zonesMM = [CONFIG.CONSTRUCTION_ZONE[team], CONFIG.ARMY_ZONE[team]];
        if (CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[team]) zonesMM.push(CONFIG.MID_BUILD_ZONE[team]);
        for (const z of zonesMM) {
          ctx.fillStyle = tints[team === getViewerSide() ? 0 : 1]; // my side always blue
          ctx.fillRect(z.x0 * s, z.y0 * s, (z.x1 - z.x0) * s, (z.y1 - z.y0) * s);
        }
      }
    }

    if (game) {
      // structures (enemy ones only once their spot is explored)
      for (const st of game.structures) {
        if (st.hp <= 0) continue;
        if (fogOn && st.team !== myTeam && !fog.exploredAt(st.x, st.y)) continue;
        ctx.fillStyle = teamColor(st.team);
        const r = Math.max(2.5, st.radius * s * 1.6);
        ctx.fillRect(st.x * s - r / 2, st.y * s - r / 2, r, r);
      }
      // live units as dots (enemy ones only while in your sight)
      for (const u of game.entities) {
        if (fogOn && u.team !== myTeam && !fog.visibleAt(u.x, u.y)) continue;
        ctx.fillStyle = teamColor(u.team);
        ctx.fillRect(u.x * s - 1, u.y * s - 1, 2.5, 2.5);
      }
      // dim the unexplored / out-of-sight areas on the minimap too
      if (fogOn) this.drawFogOverlay(fog, s);
    }

    // camera viewport rectangle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      this.camera.x * s,
      this.camera.y * s,
      this.camera.viewW() * s,
      this.camera.viewH() * s
    );
  }

  // Upscale the fog's tiny grid canvas over the minimap (soft edges via
  // smoothing). The renderer already repainted it this frame.
  drawFogOverlay(fog, s) {
    if (!fog.canvas) return;
    const { ctx } = this;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(fog.canvas, 0, 0, fog.cols, fog.rows, 0, 0, CONFIG.FIELD_W * s, CONFIG.FIELD_H * s);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = prev;
  }
}
