import { CONFIG } from '../config.js';
import { UNITS, UNIT_IDS } from '../units.js';
import { hitTestTemplate } from '../render/renderer.js';

// Mouse + keyboard input. Owns uiState.selected / drag / mouse position;
// translates gestures into game commands for team 0 (the human player).
//   - shop card selected + click in build zone  -> buy (Shift = repeat)
//   - drag a placed unit                        -> moveUnit (clamped to zone)
//   - right-click a placed unit                 -> sellUnit (75% refund)
export class Input {
  constructor(canvas, renderer, uiState, getGame) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.uiState = uiState;
    this.getGame = getGame;

    canvas.addEventListener('mousemove', (e) => {
      const { x, y } = renderer.toSim(e);
      uiState.mouseX = x;
      uiState.mouseY = y;

      const game = this.getGame();
      if (game && uiState.drag) {
        const z = CONFIG.BUILD_ZONE[0];
        game.issueCommand({
          type: 'moveUnit',
          team: 0,
          index: uiState.drag.index,
          x: clamp(x, z.x0, z.x1),
          y: clamp(y, z.y0, z.y1),
        });
      }
    });

    canvas.addEventListener('mouseleave', () => {
      uiState.mouseX = null;
      uiState.mouseY = null;
    });

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

    document.addEventListener('keydown', (e) => {
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

    document.getElementById('shop').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) this.select(card.dataset.unit);
    });
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
