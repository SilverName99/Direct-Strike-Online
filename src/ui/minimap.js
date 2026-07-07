import { CONFIG } from '../config.js';
import { TEAM_COLORS } from '../render/renderer.js';

// Corner minimap: whole world in miniature + the camera rectangle.
// Click or drag on it to move the camera there.
export class Minimap {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.ctx = canvas.getContext('2d');

    // Fixed CSS size; internal resolution matches for crispness.
    // Sized to fill the bottom-bar map panel (#bb-map), aspect preserved.
    const dpr = window.devicePixelRatio || 1;
    const w = 240;
    const h = Math.round((w * CONFIG.FIELD_H) / CONFIG.FIELD_W);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    this.scale = canvas.width / CONFIG.FIELD_W;

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

  draw(game) {
    const { ctx } = this;
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(10, 14, 20, 0.92)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // base quadrants (construction + army zones)
    const tints = ['rgba(77, 166, 255, 0.18)', 'rgba(255, 85, 102, 0.18)'];
    for (const team of [0, 1]) {
      const zonesMM = [CONFIG.CONSTRUCTION_ZONE[team], CONFIG.ARMY_ZONE[team]];
      if (CONFIG.MID_BUILD_ZONE && CONFIG.MID_BUILD_ZONE[team]) zonesMM.push(CONFIG.MID_BUILD_ZONE[team]);
      for (const z of zonesMM) {
        ctx.fillStyle = tints[team];
        ctx.fillRect(z.x0 * s, z.y0 * s, (z.x1 - z.x0) * s, (z.y1 - z.y0) * s);
      }
    }

    if (game) {
      // structures
      for (const st of game.structures) {
        if (st.hp <= 0) continue;
        ctx.fillStyle = TEAM_COLORS[st.team];
        const r = Math.max(2.5, st.radius * s * 1.6);
        ctx.fillRect(st.x * s - r / 2, st.y * s - r / 2, r, r);
      }
      // live units as dots
      for (const u of game.entities) {
        ctx.fillStyle = TEAM_COLORS[u.team];
        ctx.fillRect(u.x * s - 1, u.y * s - 1, 2.5, 2.5);
      }
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
}
