import { CONFIG } from './config.js';
import { Game } from './sim/game.js';
import { AIController } from './sim/ai.js';
import { Renderer } from './render/renderer.js';
import { Effects } from './render/effects.js';
import { Hud } from './ui/hud.js';
import { Input } from './ui/input.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const effects = new Effects();
const uiState = { selected: null, drag: null, mouseX: null, mouseY: null };
const hud = new Hud(uiState);

let game = null;
let ai = null;
let state = 'menu'; // 'menu' | 'playing' | 'over'

new Input(canvas, renderer, uiState, () => (state === 'playing' ? game : null));

function newGame(difficulty) {
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const diff = CONFIG.DIFFICULTY[difficulty] || CONFIG.DIFFICULTY.normal;
  game = new Game(seed, { incomeMult: [1, diff.incomeMult] });
  ai = new AIController(1, difficulty, seed ^ 0x9e3779b9);
  effects.reset();
  uiState.selected = null;
  uiState.drag = null;
  state = 'playing';
  hud.hideOverlay();
}

for (const btn of document.querySelectorAll('.btn.diff')) {
  btn.addEventListener('click', () => newGame(btn.dataset.diff));
}

window.addEventListener('resize', () => renderer.resize());
renderer.resize();

let last = performance.now();
let accumulator = 0;

function frame(now) {
  const delta = Math.min((now - last) / 1000, 0.25);
  last = now;

  if (state === 'playing' && game) {
    accumulator += delta;
    while (accumulator >= CONFIG.FIXED_DT) {
      accumulator -= CONFIG.FIXED_DT;
      ai.update(game, CONFIG.FIXED_DT);
      game.update(CONFIG.FIXED_DT);
    }
    effects.spawnFromEvents(game.drainEvents());
    effects.update(delta);
    hud.update(game);

    if (game.winner !== null) {
      state = 'over';
      setTimeout(() => hud.showGameOver(game, game.winner === 0), 900);
    }
  } else if (state === 'over' && game) {
    // keep drawing the frozen battlefield behind the overlay
    effects.update(delta);
  }

  if (game) {
    const alpha = state === 'playing' ? accumulator / CONFIG.FIXED_DT : 1;
    renderer.draw(game, alpha, uiState, effects);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
