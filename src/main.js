import { CONFIG, VERSION } from './config.js';
import { Game } from './sim/game.js';
import { AIController } from './sim/ai.js';
import { Renderer } from './render/renderer.js';
import { Effects } from './render/effects.js';
import { Camera } from './ui/camera.js';
import { Minimap } from './ui/minimap.js';
import { Hud } from './ui/hud.js';
import { Input } from './ui/input.js';
import { PointerManager } from './ui/pointer.js';
import { loadSprites } from './render/sprites.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const camera = new Camera(canvas);
renderer.camera = camera;
const minimap = new Minimap(document.getElementById('minimap'), camera);
const effects = new Effects();
const uiState = {
  selected: null,
  drag: null,
  mouseX: null,
  mouseY: null,
  screenX: null,
  screenY: null,
  winX: null,
  winY: null,
};
const hud = new Hud(uiState);

let game = null;
let ai = null;
let state = 'menu'; // 'menu' | 'playing' | 'over'

const input = new Input(canvas, renderer, camera, uiState, () =>
  state === 'playing' ? game : null
);
const pointer = new PointerManager(canvas);

console.log(`Direct Strike Online ${VERSION}`);
document.getElementById('version').textContent = VERSION;

// user-uploaded unit sprites (via /admin) override the built-in art
loadSprites('assets/units/', () => hud.refreshIcons());

document.getElementById('fs-btn').addEventListener('click', () => {
  console.log('fullscreen toggle requested');
  pointer.toggle();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') pointer.toggle();
});

function newGame(difficulty) {
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const diff = CONFIG.DIFFICULTY[difficulty] || CONFIG.DIFFICULTY.normal;
  game = new Game(seed, { incomeMult: [1, diff.incomeMult] });
  ai = new AIController(1, difficulty, seed ^ 0x9e3779b9);
  effects.reset();
  uiState.selected = null;
  uiState.drag = null;
  camera.reset(CONFIG.BASE_X[0], CONFIG.FIELD_H / 2);
  state = 'playing';
  hud.hideOverlay();
}

for (const btn of document.querySelectorAll('.btn.diff')) {
  btn.addEventListener('click', () => {
    pointer.enter(); // fullscreen + mouse capture, from the same user gesture
    newGame(btn.dataset.diff);
  });
}

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
camera.reset(CONFIG.BASE_X[0], CONFIG.FIELD_H / 2);

let last = performance.now();
let accumulator = 0;

function frame(now) {
  const delta = Math.min((now - last) / 1000, 0.25);
  last = now;

  // Camera pans every frame (menu included — harmless).
  camera.update(delta, input.cameraControl());

  // The world point under the cursor shifts when the camera moves even if
  // the mouse doesn't — re-derive sim coords and keep any drag pinned.
  if (uiState.screenX != null) {
    const w = camera.screenToWorld(uiState.screenX, uiState.screenY);
    uiState.mouseX = w.x;
    uiState.mouseY = w.y;
    if (state === 'playing' && uiState.drag) input.dragTo(w.x, w.y);
  }

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
  minimap.draw(game);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
