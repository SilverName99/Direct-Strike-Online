import { CONFIG } from '../config.js';

// RTS viewport over the (larger) world. Pure render/input concern —
// the simulation never knows the camera exists.
//   x, y  : top-left corner in world coordinates
//   zoom  : canvas pixels per world unit (includes devicePixelRatio)
export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
  }

  // Smallest zoom that still fills the canvas with map (no out-of-world view).
  minZoom() {
    return Math.max(
      this.canvas.width / CONFIG.FIELD_W,
      this.canvas.height / CONFIG.FIELD_H
    );
  }

  maxZoom() {
    return this.minZoom() * CONFIG.CAMERA.ZOOM_MAX;
  }

  viewW() {
    return this.canvas.width / this.zoom;
  }

  viewH() {
    return this.canvas.height / this.zoom;
  }

  clamp() {
    this.zoom = Math.min(Math.max(this.zoom, this.minZoom()), this.maxZoom());
    this.x = Math.min(Math.max(this.x, 0), CONFIG.FIELD_W - this.viewW());
    this.y = Math.min(Math.max(this.y, 0), CONFIG.FIELD_H - this.viewH());
  }

  // px/py are CSS pixels relative to the canvas element.
  screenToWorld(px, py) {
    const dpr = this.canvas.width / this.canvas.getBoundingClientRect().width;
    return {
      x: this.x + (px * dpr) / this.zoom,
      y: this.y + (py * dpr) / this.zoom,
    };
  }

  centerOn(wx, wy) {
    this.x = wx - this.viewW() / 2;
    this.y = wy - this.viewH() / 2;
    this.clamp();
  }

  // Zoom keeping the world point under the cursor fixed on screen.
  zoomAt(px, py, factor) {
    const before = this.screenToWorld(px, py);
    this.zoom *= factor;
    this.zoom = Math.min(Math.max(this.zoom, this.minZoom()), this.maxZoom());
    const after = this.screenToWorld(px, py);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  // ctrl = {edgeX, edgeY, keyX, keyY}, each component -1 | 0 | 1.
  update(dt, ctrl) {
    const pan =
      (Math.abs(ctrl.keyX) + Math.abs(ctrl.keyY) > 0
        ? CONFIG.CAMERA.KEY_SPEED
        : CONFIG.CAMERA.EDGE_SPEED) * dt;
    const dx = (ctrl.keyX || ctrl.edgeX) * pan;
    const dy = (ctrl.keyY || ctrl.edgeY) * pan;
    if (dx || dy) {
      this.x += dx;
      this.y += dy;
      this.clamp();
    }
  }

  reset(startWx, startWy) {
    this.zoom = this.minZoom() * CONFIG.CAMERA.START_ZOOM;
    this.clamp();
    this.centerOn(startWx, startWy);
  }
}
