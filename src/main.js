import { CONFIG, VERSION, RACES } from './config.js';
import { Game } from './sim/game.js';
import { AIController } from './sim/ai.js';
import { Renderer } from './render/renderer.js';
import { Effects } from './render/effects.js';
import { Camera } from './ui/camera.js';
import { Minimap } from './ui/minimap.js';
import { Hud } from './ui/hud.js';
import { BottomBar } from './ui/bottombar.js';
import { Input } from './ui/input.js';
import { PointerManager, toast } from './ui/pointer.js';
import { loadSprites, setTeamRaces, getMusicUrl, getCursorUrl, availableMiddleSlots } from './render/sprites.js';
import { loadBalance, musicVolumeOf, middleConfig } from './ui/balance.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const camera = new Camera(canvas);
renderer.camera = camera;
const minimap = new Minimap(document.getElementById('minimap'), camera);
const effects = new Effects();
const uiState = {
  selected: null,
  drag: null,
  inspect: null, // selection-panel target: {kind:'template'|'entity'|'structure', ...}
  gridOn: true,
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
// WC3-style selection panel (click units/templates/structures to inspect;
// your own Main Base shows its upgrades right in the command grid)
const bottombar = new BottomBar(
  uiState,
  () => (state === 'playing' ? game : null),
  (id) => input.select(id) // shop slot clicks share the hotkey gating
);
const pointer = new PointerManager(canvas);

console.log(`Direct Strike Online ${VERSION}`);
document.getElementById('version').textContent = VERSION;

// user-uploaded unit sprites (via /admin) override the built-in art
loadSprites('assets/units/', () => bottombar.refresh());

// apply the balance published from /admin (edit it there, not in-game)
loadBalance().then((loaded) => {
  if (loaded) {
    bottombar.refresh();
    console.log('balance overrides loaded');
  }
});

document.getElementById('fs-btn').addEventListener('click', () => {
  console.log('fullscreen toggle requested');
  pointer.toggle();
});
document.getElementById('grid-btn').addEventListener('click', () => {
  uiState.gridOn = !uiState.gridOn;
  document.getElementById('grid-btn').classList.toggle('off', !uiState.gridOn);
  toast(uiState.gridOn ? 'Grid: ON (snap to cells)' : 'Grid: OFF (free placement)');
});
const captureBtn = document.getElementById('capture-btn');
function refreshCaptureBtn() { captureBtn.classList.toggle('off', !pointer.captureMouse); }
function toggleCapture() {
  const on = pointer.setCaptureMouse(!pointer.captureMouse);
  refreshCaptureBtn();
  toast(on ? 'Capturare mouse: ON — edge-scroll pe 2 monitoare' : 'Capturare mouse: OFF — cursor hardware, fără delay');
}
captureBtn.addEventListener('click', toggleCapture);
refreshCaptureBtn();
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.key === 'f' || e.key === 'F') pointer.toggle();
  if (e.key === 'c' || e.key === 'C') toggleCapture();
  if (e.key === 'g' || e.key === 'G') { // toggle the AI debug overlay
    aiDebugOn = !aiDebugOn;
    aiDebugEl.style.display = aiDebugOn ? 'block' : 'none';
  }
});

// Dev overlay (press G): the AI's gold, income and what it's currently planning.
let aiDebugOn = false;
const aiDebugEl = document.createElement('div');
aiDebugEl.id = 'ai-debug';
aiDebugEl.style.cssText =
  'position:fixed;top:8px;left:8px;z-index:9999;display:none;pointer-events:none;' +
  'font:12px/1.5 ui-monospace,monospace;color:#ffe9a8;background:rgba(10,14,20,0.82);' +
  'border:1px solid #3a4658;border-radius:8px;padding:8px 11px;max-width:280px;white-space:pre-wrap;';
document.body.appendChild(aiDebugEl);

function updateAiDebug() {
  if (!aiDebugOn || !ai || !game || state !== 'playing') return;
  const t = 1;
  const gold = Math.floor(game.money[t]);
  const inc = game.incomePerSecond(t).toFixed(1).replace(/\.0$/, '');
  const army = game.templates[t].length;
  const tier = 'I'.repeat(game.tier[t]);
  const mid = game.midOwner === t ? ' · DEȚINE MIJLOCUL' : '';
  aiDebugEl.textContent =
    `🤖 AI (${game.races[t]})  [G ascunde]\n` +
    `💰 gold: ${gold}   (+${inc}/s)\n` +
    `🏰 tier ${tier} · armată ${army}${mid}\n` +
    `postură: ${ai.aggro ? 'OFENSIV (împinge mijlocul)' : 'așezat'}\n` +
    `plan: ${ai.intent}`;
}

// Per-race background music: uploaded from /admin (next to the background),
// loops for the whole match at the admin-set volume. Started from the match
// button click, so autoplay policies are satisfied.
let music = null;
function startMusic(race) {
  stopMusic();
  const url = getMusicUrl(race);
  if (!url) return;
  music = new Audio(url);
  music.loop = true;
  music.volume = Math.min(1, Math.max(0, musicVolumeOf(race) / 100));
  music.play().catch(() => { /* autoplay blocked — stay silent */ });
}
function stopMusic() {
  if (music) { music.pause(); music = null; }
}

// Apply the player race's uploaded custom mouse cursor (falls back to the
// default arrow when none is uploaded for that race).
function applyCursor(race) {
  pointer.setCursorImage(getCursorUrl(race));
}

let playerRace = 'humans';
for (const btn of document.querySelectorAll('.btn.race')) {
  btn.addEventListener('click', () => {
    playerRace = btn.dataset.race;
    // update the render race NOW so the shop redraws for this race
    const aiRace = RACES.find((r) => r !== playerRace) || playerRace;
    setTeamRaces([playerRace, aiRace]);
    document.querySelectorAll('.btn.race').forEach((b) =>
      b.classList.toggle('selected', b === btn)
    );
    bottombar.refresh(); // shop stats + art follow the chosen race
    applyCursor(playerRace); // custom mouse for this race
  });
}

function newGame(difficulty) {
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const diff = CONFIG.DIFFICULTY[difficulty] || CONFIG.DIFFICULTY.normal;
  // race is a render-side art choice: the AI plays the other one
  const aiRace = RACES.find((r) => r !== playerRace) || playerRace;
  setTeamRaces([playerRace, aiRace]);
  bottombar.refresh(); // shop reflects the player race at match start
  // middle-of-map terrain: the available uploaded variants + their effects,
  // plus N "empty" entries so some matches roll a plain middle; the sim picks
  // one at random (seeded) and applies its effect
  const middles = availableMiddleSlots().map((slot) => ({ slot, ...(middleConfig(slot) || {}) }));
  for (let i = 0; i < (CONFIG.MIDDLE_EMPTY || 0); i++) middles.push({ slot: -1, kind: 'none' });
  game = new Game(seed, { races: [playerRace, aiRace], incomeMult: [1, diff.incomeMult], middles });
  ai = new AIController(1, difficulty, seed ^ 0x9e3779b9);
  effects.reset();
  uiState.selected = null;
  uiState.drag = null;
  uiState.inspect = null;
  camera.reset(CONFIG.MAIN.x[0], CONFIG.MAIN.y);
  state = 'playing';
  hud.hideOverlay();
  startMusic(playerRace);
  applyCursor(playerRace);
}

for (const btn of document.querySelectorAll('.btn.diff')) {
  btn.addEventListener('click', () => {
    pointer.enter(); // fullscreen + mouse capture, from the same user gesture
    newGame(btn.dataset.diff);
  });
}

window.addEventListener('resize', () => renderer.resize());
// entering/leaving fullscreen resizes the wrapper over a couple of frames —
// re-fit the canvas immediately AND after layout settles so the backing store
// always matches the display (no stale/black strips)
document.addEventListener('fullscreenchange', () => {
  renderer.resize();
  requestAnimationFrame(() => renderer.resize());
});
renderer.resize();
camera.reset(CONFIG.MAIN.x[0], CONFIG.MAIN.y);

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
    const events = game.drainEvents();
    effects.spawnFromEvents(events);
    effects.update(delta);
    hud.update(game, delta);
    updateAiDebug();

    if (game.winner !== null) {
      state = 'over';
      stopMusic();
      setTimeout(() => hud.showGameOver(game, game.winner === 0), 900);
    }
  } else if (state === 'over' && game) {
    // keep drawing the frozen battlefield behind the overlay
    effects.update(delta);
  }

  bottombar.update(state === 'playing' ? game : null); // grid + panel follow the selection
  if (game) {
    const alpha = state === 'playing' ? accumulator / CONFIG.FIXED_DT : 1;
    renderer.draw(game, alpha, uiState, effects);
  }
  minimap.draw(game);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
