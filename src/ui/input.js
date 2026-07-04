import { UNITS, UNIT_IDS } from '../units.js';

// Mouse + keyboard input. Owns uiState.selected / mouse position;
// translates clicks into game commands for team 0 (the human player).
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
    });

    canvas.addEventListener('mouseleave', () => {
      uiState.mouseX = null;
      uiState.mouseY = null;
    });

    canvas.addEventListener('click', (e) => {
      const game = this.getGame();
      if (!game || game.winner !== null) return;
      if (!uiState.selected || uiState.selected === 'income') return;
      const { x, y } = renderer.toSim(e);
      const res = game.issueCommand({ type: 'buy', team: 0, unitId: uiState.selected, x, y });
      if (res.ok && !e.shiftKey) uiState.selected = null;
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      uiState.selected = null;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        uiState.selected = null;
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
