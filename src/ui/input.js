import { CONFIG } from '../config.js';
import { UNITS, UNIT_IDS } from '../units.js';
import { hitTestTemplate } from '../render/renderer.js';
import { snapToZone, zoneFor } from './grid.js';

const BUILDING_IDS = ['wall', 'tower', 'generator'];

// Mouse + keyboard input. Owns uiState.selected / drag / grid / mouse
// position; translates gestures into game commands for team 0.
//   - shop card selected + click                -> buy unit / build (Shift = repeat)
//   - drag a placed unit template               -> moveUnit (snapped, clamped)
//   - right-click a template                    -> sellUnit (75% refund)
//   - right-click an own building               -> sellBuilding (60% refund)
//   - G                                          -> toggle placement grid
// Camera: edge scroll / arrows / WASD / wheel zoom / Space (jump to base).
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

    // Window-level pointer position drives edge scrolling: real events reach
    // it while unlocked; under pointer lock only PointerManager's synthetic
    // clones bubble this far, carrying the virtual cursor position.
    window.addEventListener('mousemove', (e) => {
      uiState.winX = e.clientX;
      uiState.winY = e.clientY;
    });
    // ...but stop edge-scrolling when the cursor leaves the page entirely
    // (windowed mode) or the window loses focus, or the stale edge position
    // would pan the map forever.
    document.addEventListener('mouseleave', () => {
      uiState.winX = null;
      uiState.winY = null;
    });
    window.addEventListener('blur', () => {
      uiState.winX = null;
      uiState.winY = null;
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
      const sel = this.uiState.selected;
      const p = this.placePoint(this.renderer.toSim(e), sel);

      if (sel && BUILDING_IDS.includes(sel)) {
        const res = game.issueCommand({ type: 'build', team: 0, kind: sel, x: p.x, y: p.y });
        if (res.ok && !e.shiftKey) this.uiState.selected = null;
        return;
      }
      if (sel && sel !== 'upgrade') {
        const res = game.issueCommand({ type: 'buy', team: 0, unitId: sel, x: p.x, y: p.y });
        if (res.ok && !e.shiftKey) this.uiState.selected = null;
        return;
      }

      // no shop selection: grab a placed unit template to drag it around
      const raw = this.renderer.toSim(e);
      const idx = hitTestTemplate(game, 0, raw.x, raw.y);
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
      if (idx !== -1) {
        game.issueCommand({ type: 'sellUnit', team: 0, index: idx });
        return;
      }
      // sell an own building under the cursor
      const s = game.structures.find(
        (st) =>
          st.team === 0 && st.hp > 0 &&
          (st.x - x) ** 2 + (st.y - y) ** 2 <= (st.radius + 4) ** 2
      );
      if (s) game.issueCommand({ type: 'sellBuilding', team: 0, id: s.id });
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
        this.camera.centerOn(CONFIG.MAIN.x[0], CONFIG.MAIN.y);
        return;
      }
      if (e.key === 'Escape') {
        this.uiState.selected = null;
        this.uiState.drag = null;
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        this.uiState.gridOn = !this.uiState.gridOn;
        const btn = document.getElementById('grid-btn');
        if (btn) btn.classList.toggle('off', !this.uiState.gridOn);
        return;
      }
      // hotkeys: 1-9 units, Z/X/C buildings, 0 base upgrade
      if (e.key >= '1' && e.key <= '9') {
        const id = UNIT_IDS[Number(e.key) - 1];
        if (id) this.select(id);
      } else if (e.key === '0') {
        this.select('upgrade');
      } else if (e.key === 'z' || e.key === 'Z') {
        this.select('wall');
      } else if (e.key === 'x' || e.key === 'X') {
        this.select('tower');
      } else if (e.key === 'c' || e.key === 'C') {
        this.select('generator');
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());

    document.getElementById('shop').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card && !card.classList.contains('locked')) this.select(card.dataset.unit);
    });
  }

  // Snap to the appropriate zone's grid when the grid is on.
  placePoint(p, selected) {
    if (!this.uiState.gridOn) return p;
    return snapToZone(zoneFor(selected), p.x, p.y);
  }

  // While dragging, keep the template pinned under the cursor (snapped,
  // clamped to the army zone).
  dragTo(x, y) {
    const game = this.getGame();
    if (!game || !this.uiState.drag) return;
    const z = CONFIG.ARMY_ZONE[0];
    let p = { x: clamp(x, z.x0, z.x1), y: clamp(y, z.y0, z.y1) };
    if (this.uiState.gridOn) p = snapToZone(z, p.x, p.y);
    game.issueCommand({ type: 'moveUnit', team: 0, index: this.uiState.drag.index, x: p.x, y: p.y });
  }

  // Camera pan intent for this frame: -1 | 0 | 1 per axis.
  cameraControl() {
    const k = this.keys;
    const keyX = (k.has('ArrowRight') || k.has('d') ? 1 : 0) - (k.has('ArrowLeft') || k.has('a') ? 1 : 0);
    const keyY = (k.has('ArrowDown') || k.has('s') ? 1 : 0) - (k.has('ArrowUp') || k.has('w') ? 1 : 0);

    // Edge zones are measured against the whole window (= the whole screen
    // in fullscreen), so pushing the cursor over the HUD still scrolls —
    // classic RTS behavior.
    let edgeX = 0;
    let edgeY = 0;
    const { winX, winY } = this.uiState;
    if (winX != null) {
      const m = CONFIG.CAMERA.EDGE_PX;
      if (winX <= m) edgeX = -1;
      else if (winX >= window.innerWidth - m) edgeX = 1;
      if (winY <= m) edgeY = -1;
      else if (winY >= window.innerHeight - m) edgeY = 1;
    }
    return { edgeX, edgeY, keyX, keyY };
  }

  select(id) {
    const game = this.getGame();
    if (!game || game.winner !== null) return;

    if (id === 'upgrade') {
      game.issueCommand({ type: 'upgradeBase', team: 0 });
      return;
    }
    if (!UNITS[id] && !BUILDING_IDS.includes(id)) return;
    if (UNITS[id] && UNITS[id].tier > game.tier[0]) return; // locked
    this.uiState.selected = this.uiState.selected === id ? null : id;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
