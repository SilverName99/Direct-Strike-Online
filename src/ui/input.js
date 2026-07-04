import { CONFIG } from '../config.js';
import { UNITS, UNIT_IDS } from '../units.js';
import { hitTestTemplate } from '../render/renderer.js';

// Mouse + keyboard input. Owns uiState.selected / drag / mouse position;
// translates gestures into game commands for team 0 (the human player).
//   - shop card selected + click in build zone  -> buy (Shift = repeat)
//   - drag a placed unit                        -> moveUnit (clamped to zone)
//   - right-click a placed unit                 -> sellUnit (75% refund)
// Camera controls:
//   - pointer at canvas edge / arrows / WASD    -> pan
//   - mouse wheel                               -> zoom at cursor
//   - Space                                     -> jump to own base
export class Input {
  constructor(canvas, renderer, camera, uiState, getGame) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.camera = camera;
    this.uiState = uiState;
    this.getGame = getGame;
    this.keys = new Set();

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      uiState.screenX = e.clientX - rect.left;
      uiState.screenY = e.clientY - rect.top;
      const { x, y } = renderer.toSim(e);
      uiState.mouseX = x;
      uiState.mouseY = y;
      // drag also re-fires from the frame loop while the camera pans
      this.dragTo(x, y);
    });

    canvas.addEventListener('mouseleave', () => {
      uiState.screenX = null;
      uiState.screenY = null;
      uiState.mouseX = null;
      uiState.mouseY = null;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor =
        e.deltaY < 0 ? CONFIG.CAMERA.ZOOM_STEP : 1 / CONFIG.CAMERA.ZOOM_STEP;
      this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const game = this.getGame();
      if (!game || game.winner !== null) return;
      const { x, y } = renderer.toSim(e);

      if (this.uiState.selected && this.uiState.selected !== 'income') {
        const res = game.issueCommand({ type: 'buy', team: 0, unitId: this.uiState.selected, x, y });
        if (res.ok && !e.shiftKey) this.uiState.selected = null;
        return;
      }

      // no shop selection: grab a placed unit to drag it around
      const idx = hitTestTemplate(game, 0, x, y);
      if (idx !== -1) this.uiState.drag = { index: idx };
    });

    window.addEventListener('mouseup', () => {
      this.uiState.drag = null;
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const game = this.getGame();
      if (this.uiState.selected) {
        this.uiState.selected = null;
        return;
      }
      if (!game || game.winner !== null) return;
      const { x, y } = renderer.toSim(e);
      const idx = hitTestTemplate(game, 0, x, y);
      if (idx !== -1) game.issueCommand({ type: 'sellUnit', team: 0, index: idx });
    });

    const PAN_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'];
    document.addEventListener('keydown', (e) => {
      if (PAN_KEYS.includes(e.key)) {
        e.preventDefault();
        this.keys.add(e.key);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        if (document.activeElement) document.activeElement.blur();
        this.camera.centerOn(CONFIG.BASE_X[0], CONFIG.FIELD_H / 2);
        return;
      }
      if (e.key === 'Escape') {
        this.uiState.selected = null;
        this.uiState.drag = null;
        return;
      }
      // hotkeys 1-9 = units, 0 = income
      if (e.key >= '1' && e.key <= '9') {
        const id = UNIT_IDS[Number(e.key) - 1];
        if (id) this.select(id);
      } else if (e.key === '0') {
        this.select('income');
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());

    document.getElementById('shop').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) this.select(card.dataset.unit);
    });
  }

  // While dragging, keep the template pinned under the cursor (clamped to zone).
  dragTo(x, y) {
    const game = this.getGame();
    if (!game || !this.uiState.drag) return;
    const z = CONFIG.BUILD_ZONE[0];
    game.issueCommand({
      type: 'moveUnit',
      team: 0,
      index: this.uiState.drag.index,
      x: clamp(x, z.x0, z.x1),
      y: clamp(y, z.y0, z.y1),
    });
  }

  // Camera pan intent for this frame: -1 | 0 | 1 per axis.
  cameraControl() {
    const k = this.keys;
    const keyX = (k.has('ArrowRight') || k.has('d') ? 1 : 0) - (k.has('ArrowLeft') || k.has('a') ? 1 : 0);
    const keyY = (k.has('ArrowDown') || k.has('s') ? 1 : 0) - (k.has('ArrowUp') || k.has('w') ? 1 : 0);

    let edgeX = 0;
    let edgeY = 0;
    const { screenX, screenY } = this.uiState;
    if (screenX != null) {
      const rect = this.canvas.getBoundingClientRect();
      const m = CONFIG.CAMERA.EDGE_PX;
      if (screenX <= m) edgeX = -1;
      else if (screenX >= rect.width - m) edgeX = 1;
      if (screenY <= m) edgeY = -1;
      else if (screenY >= rect.height - m) edgeY = 1;
    }
    return { edgeX, edgeY, keyX, keyY };
  }

  select(id) {
    const game = this.getGame();
    if (!game || game.winner !== null) return;

    if (id === 'income') {
      game.issueCommand({ type: 'upgradeIncome', team: 0 });
      return;
    }
    if (!UNITS[id]) return;
    this.uiState.selected = this.uiState.selected === id ? null : id;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
