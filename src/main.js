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
import { Menu } from './ui/menu.js';
import { PointerManager, toast } from './ui/pointer.js';
import { loadSprites, setTeamRaces, setViewerTeam, getMusicUrl, getCursorUrl, availableMiddleSlots } from './render/sprites.js';
import { NetClient } from './net/netclient.js';
import { NetMatch } from './net/netmatch.js';
import { loadBalance, musicVolumeOf, middleConfig, resolvedAIGenome } from './ui/balance.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const camera = new Camera(canvas);
renderer.camera = camera;
const minimap = new Minimap(document.getElementById('minimap'), camera);
const effects = new Effects();
const uiState = {
  myTeam: 0, // the team this player commands (0 in single player; assigned online)
  selected: null,
  drag: null,
  pendingMove: null, // just-dropped template move held at target until it lands online
  inspect: null, // selection-panel target: {kind:'template'|'entity'|'structure', ...}
  gridOn: true,
  showRanges: false, // 🎯 debug overlay: attack reach + physical boxes for everything
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
let net = null;      // NetClient — one connection, reused across lobby visits
let netmatch = null; // NetMatch while an online game is live

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

console.log(`Fangs & Honor ${VERSION}`);
document.getElementById('version').textContent = VERSION;

// user-uploaded unit sprites (via /admin) override the built-in art. Once the
// manifest is in, the custom cursors exist too, so roll the random menu cursor.
loadSprites('assets/units/', () => { bottombar.refresh(); applyRandomMenuCursor(); });

// Boot loader: hold the golden splash (index.html #boot) until the menu is
// fully ready, then fade it out — so the logo/background/buttons don't pop in
// one at a time. A minimum on-screen time keeps it from flashing.
const bootEl = document.getElementById('boot');
const bootStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
function preload(urls, timeoutMs) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = list.length;
    const done = () => { if (--left <= 0) resolve(); };
    for (const u of list) { const img = new Image(); img.onload = done; img.onerror = done; img.src = u; }
    setTimeout(resolve, timeoutMs); // never hang on a slow/broken image
  });
}
function hideBoot() {
  if (!bootEl) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wait = Math.max(0, 700 - (now - bootStart)); // show for at least ~0.7s
  setTimeout(() => { bootEl.classList.add('done'); setTimeout(() => bootEl.remove(), 650); }, wait);
}

// apply the balance published from /admin (edit it there, not in-game)
loadBalance().then((loaded) => {
  if (loaded) {
    bottombar.refresh();
    console.log('balance overrides loaded');
  }
}).catch((e) => console.warn('balance load failed', e)).finally(() => {
  menu.applyTheme(); // logo + menu/loading backgrounds live in balance.json
  // warm the decode cache for the menu art AND buffer the menu music, then
  // reveal the finished menu (both capped so a slow asset never hangs boot)
  Promise.all([
    preload([CONFIG.MENU_BG, CONFIG.MENU_LOGO, CONFIG.MENU_BTN], 2500),
    menu.preloadMusic(3500),
  ]).then(() => {
    hideBoot();
    menu.armMusic(); // start the music now (if allowed) or on the first gesture
  });
});

// 🎯 debug overlay: attack reach + physical body boxes around every unit
const rangeBtn = document.getElementById('range-btn');
if (rangeBtn) rangeBtn.addEventListener('click', () => {
  uiState.showRanges = !uiState.showRanges;
  rangeBtn.classList.toggle('active', uiState.showRanges);
});
document.getElementById('fs-btn').addEventListener('click', () => {
  console.log('fullscreen toggle requested');
  pointer.toggle();
});
// Bottom-bar zoom: cycle the whole bottom interface through 1× / 2× / 3×.
const uiScaleBtn = document.getElementById('uiscale-btn');
const UI_SCALES = [1, 1.2, 1.4, 1.6];
let uiScaleIdx = 0;
try { const s = parseFloat(localStorage.getItem('ds-bb-scale')); const i = UI_SCALES.indexOf(s); if (i >= 0) uiScaleIdx = i; } catch { /* private mode */ }
function applyUiScale() {
  const s = UI_SCALES[uiScaleIdx];
  document.getElementById('bottombar').style.setProperty('--bb-scale', s);
  uiScaleBtn.textContent = `${s}×`;
  uiScaleBtn.classList.toggle('off', s === 1);
  requestAnimationFrame(() => bottombar.buildTrayBg());
}
uiScaleBtn.addEventListener('click', () => {
  uiScaleIdx = (uiScaleIdx + 1) % UI_SCALES.length;
  const s = UI_SCALES[uiScaleIdx];
  try { localStorage.setItem('ds-bb-scale', String(s)); } catch { /* private mode */ }
  applyUiScale();
  toast(`Bară de jos: ${s}×`);
});
applyUiScale();
// Mouse capture (pointer lock) keeps the OS cursor inside the window so a
// fullscreen edge-scroll can't slide onto a second monitor. It defaults ON
// (see PointerManager) and is toggleable from the menu's OPTIONS screen.
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.key === 'f' || e.key === 'F') pointer.toggle();
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
  'position:fixed;top:120px;left:8px;z-index:9999;display:none;pointer-events:none;' +
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
let musicRace = null;                 // race of the current track (to re-scale volume live)
let musicMuted = false;
let musicVol = 1;                     // player master volume 0-1 (scales the per-race admin volume)
try { musicMuted = localStorage.getItem('fh-music-muted') === '1'; } catch { /* private mode */ }
try { const v = parseFloat(localStorage.getItem('fh-music-vol')); if (isFinite(v)) musicVol = Math.max(0, Math.min(1, v)); } catch { /* private mode */ }
// Actual playback volume = player master × the race's admin-set music volume.
function effVol(race) { return musicVol * Math.min(1, Math.max(0, musicVolumeOf(race) / 100)); }
function startMusic(race) {
  stopMusic();
  const url = getMusicUrl(race);
  if (!url) return;
  musicRace = race;
  music = new Audio(url);
  music.loop = true;
  music.volume = effVol(race);
  music.muted = musicMuted;
  music.play().catch(() => { /* autoplay blocked — stay silent */ });
}
function stopMusic() {
  if (music) { music.pause(); music = null; }
}

// Top-bar sound pod: a mute toggle + a live volume slider (both remembered).
const muteBtn = document.getElementById('mute-btn');
const gameVol = document.getElementById('game-vol');
function paintVolFill() {
  if (gameVol) gameVol.style.setProperty('--fill', `${Math.round(musicVol * 100)}%`);
}
function applyMuteBtn() {
  if (muteBtn) { muteBtn.textContent = (musicMuted || musicVol === 0) ? '🔇' : '🔊'; muteBtn.classList.toggle('off', musicMuted); }
}
function setGameVol(v, persist = true) {
  musicVol = Math.max(0, Math.min(1, v));
  if (music && musicRace != null) music.volume = effVol(musicRace);
  if (gameVol && Math.round(Number(gameVol.value)) !== Math.round(musicVol * 100)) gameVol.value = String(Math.round(musicVol * 100));
  if (persist) { try { localStorage.setItem('fh-music-vol', String(musicVol)); } catch { /* private mode */ } }
  paintVolFill();
  applyMuteBtn();
}
if (gameVol) {
  gameVol.value = String(Math.round(musicVol * 100));
  gameVol.addEventListener('input', () => setGameVol(Number(gameVol.value) / 100));
}
if (muteBtn) muteBtn.addEventListener('click', () => {
  musicMuted = !musicMuted;
  if (music) music.muted = musicMuted;
  try { localStorage.setItem('fh-music-muted', musicMuted ? '1' : '0'); } catch { /* private mode */ }
  applyMuteBtn();
});
paintVolFill();
applyMuteBtn();

// Apply the player race's uploaded custom mouse cursor (falls back to the
// default arrow when none is uploaded for that race).
function applyCursor(race) {
  pointer.setCursorImage(getCursorUrl(race));
}

// First menu entry: pick a RANDOM race cursor (human/orc) — more fun than the
// plain arrow. Rolls only among races that actually have a cursor uploaded,
// and only once. Must run AFTER the sprite manifest loads (that's when the
// cursor URLs exist), so it's driven from the loadSprites callback below.
function applyRandomMenuCursor() {
  if (state !== 'menu') return;
  const withCursor = RACES.filter((r) => getCursorUrl(r));
  if (!withCursor.length) return; // no cursors uploaded — keep the default arrow
  applyCursor(withCursor[Math.floor(Math.random() * withCursor.length)]);
}

function newGame(playerRace, enemyRace, difficulty) {
  if (netmatch) { netmatch.dispose(); netmatch = null; } // single player: no net loop
  uiState.myTeam = 0;
  setViewerTeam(0);
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const diff = CONFIG.DIFFICULTY[difficulty] || CONFIG.DIFFICULTY.normal;
  setTeamRaces([playerRace, enemyRace]);
  bottombar.refresh(); // shop reflects the player race at match start
  // middle-of-map terrain: the available uploaded variants + their effects,
  // plus N "empty" entries so some matches roll a plain middle; the sim picks
  // one at random (seeded) and applies its effect
  const middles = availableMiddleSlots().map((slot) => ({ slot, ...(middleConfig(slot) || {}) }));
  for (let i = 0; i < (CONFIG.MIDDLE_EMPTY || 0); i++) middles.push({ slot: -1, kind: 'none' });
  game = new Game(seed, { races: [playerRace, enemyRace], incomeMult: [1, diff.incomeMult], middles });
  window.__game = game; // debug/test handle (render side only; sim never reads it)
  window.__ui = uiState; // debug/test handle (drive selection/inspect in tests)
  window.__bb = bottombar; // debug/test handle (inspect the command grid state)
  ai = new AIController(1, difficulty, seed ^ 0x9e3779b9, resolvedAIGenome());
  effects.reset();
  uiState.selected = null;
  uiState.drag = null;
  uiState.inspect = null;
  camera.reset(CONFIG.MAIN.x[0], CONFIG.MAIN.y);
  state = 'playing';
  startMusic(playerRace);
  applyCursor(playerRace);
}

// ---------------- online 1v1 (lockstep through the VPS relay) ----------------
function netUrl() {
  if (window.__NET_URL) return window.__NET_URL;          // tests override this
  if (CONFIG.NET_URL) return CONFIG.NET_URL;              // optional admin override
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return `ws://${h}:8080/ws`; // local dev
  return 'wss://play.fangs-and-honor.com/ws';
}
const NET_ERRORS = {
  'no-room': 'Camera nu există (cod greșit sau expirat).',
  'own-room': 'Acela e codul TĂU — dă-i-l prietenului.',
  'in-match': 'Ești deja într-un meci.',
};
async function ensureNet() {
  if (net && net.ws && net.ws.readyState === 1) return net;
  net = new NetClient(netUrl());
  net.on('queued', () => menu.netWaiting('Se caută adversar…', 'Ține pagina deschisă'));
  net.on('room', (m) => menu.netWaiting('Așteaptă-ți prietenul', 'Dă-i acest cod să intre:', m.code));
  net.on('error', (m) => menu.netError(NET_ERRORS[m.reason] || `Eroare: ${m.reason}`));
  net.on('start', (m) => startNetMatch(m));
  await net.connect('Player');
  return net;
}
async function netAction({ action, race, code }) {
  menu.netWaiting('Mă conectez…');
  try {
    const n = await ensureNet();
    if (action === 'quick') n.quickmatch(race);
    else if (action === 'create') n.createRoom(race);
    else if (action === 'join') n.joinRoom(code, race);
  } catch {
    menu.netError('Nu mă pot conecta la serverul de joc. Încearcă din nou.');
  }
}
// Opponent found: build the SAME deterministic Game on both clients and start
// the lockstep loop immediately (it runs behind the countdown/loading screens,
// so a player whose loading ends earlier can't get ahead).
function startNetMatch(m) {
  setTeamRaces(m.races);
  uiState.myTeam = m.youAre;
  setViewerTeam(m.youAre);
  bottombar.refresh();
  applyCursor(m.races[m.youAre]);
  const middles = availableMiddleSlots().map((slot) => ({ slot, ...(middleConfig(slot) || {}) }));
  for (let i = 0; i < (CONFIG.MIDDLE_EMPTY || 0); i++) middles.push({ slot: -1, kind: 'none' });
  game = new Game(m.seed, { races: m.races, incomeMult: [1, 1], middles });
  window.__game = game;
  window.__ui = uiState;
  window.__bb = bottombar;
  ai = null; // the opponent is a human — their commands arrive over the wire
  netmatch = new NetMatch(net, m, game);
  window.__netmatch = netmatch; // debug/test handle
  netmatch.onEnd = (kind) => {
    if (kind === 'opp_left' && game && game.winner === null && state !== 'over') {
      state = 'over';
      stopMusic();
      toast('Adversarul a părăsit meciul');
      endNetMatch();
      setTimeout(() => menu.showGameOver(game, true, uiState.myTeam, true), 600);
    } else if (kind === 'closed' && state !== 'over') {
      // dropped mid-match OR mid-countdown — back to the menu either way
      stopMusic();
      toast('Conexiune pierdută cu serverul');
      endNetMatch();
      state = 'menu';
      menu.show();
    }
  };
  effects.reset();
  uiState.selected = null;
  uiState.drag = null;
  uiState.inspect = null;
  camera.reset(CONFIG.MAIN.x[m.youAre], CONFIG.MAIN.y);
  menu.startNetCountdown(); // 5s countdown + loading, then onNetReveal below
}
function endNetMatch() {
  if (netmatch) { netmatch.dispose(); netmatch = null; }
  if (net) net.leave();
}

// The entry menu owns #overlay: main → format → setup → 5s countdown → loading.
const menu = new Menu(document.getElementById('overlay'), {
  // live shop / cursor preview follows the race picked in match setup
  onRaceChange: ({ player, enemy }) => {
    setTeamRaces([player, enemy]);
    bottombar.refresh();
    applyCursor(player);
  },
  onStart: ({ player, enemy, difficulty }) => newGame(player, enemy, difficulty),
  onNet: (a) => netAction(a),             // quick / create / join from the lobby
  onNetCancel: () => { if (net) net.leave(); },
  onNetReveal: () => {                    // loading done — show the live net match
    state = 'playing';
    const race = game ? game.races[uiState.myTeam] : 'humans';
    startMusic(race);
    applyCursor(race);
  },
  enterFullscreen: () => pointer.enter(), // from the Play click (a user gesture)
  // mouse capture toggle (OPTIONS): keeps the cursor inside the window on
  // fullscreen so it can't slip onto a second monitor
  onCaptureMouse: (on) => pointer.setCaptureMouse(on),
  getCaptureMouse: () => pointer.captureMouse,
  onMenuMain: () => applyRandomMenuCursor(), // re-roll the menu cursor each visit
});
window.__menu = menu; // debug/test handle (drive the entry menu in tests)
// seed the behind-the-menu preview with the default matchup
setTeamRaces(['humans', 'orcs']);
bottombar.refresh();
// try the random menu cursor now in case the sprite manifest already resolved
// (cached); otherwise the loadSprites callback above rolls it when ready.
applyRandomMenuCursor();

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

  // the online sim advances even while the countdown/loading screens still
  // cover it, so neither player's sim can fall behind the server clock
  if (netmatch && !netmatch.done && game) {
    netmatch.update();
    if (state !== 'playing') game.drainEvents(); // discard pre-reveal events
  }

  if (state === 'playing' && game) {
    if (!netmatch) {
      accumulator += delta;
      while (accumulator >= CONFIG.FIXED_DT) {
        accumulator -= CONFIG.FIXED_DT;
        ai.update(game, CONFIG.FIXED_DT);
        game.update(CONFIG.FIXED_DT);
      }
    }
    const events = game.drainEvents();
    effects.spawnFromEvents(events);
    effects.update(delta);
    hud.update(game, delta);
    updateAiDebug();

    if (game.winner !== null) {
      state = 'over';
      stopMusic();
      const won = game.winner === uiState.myTeam;
      const wasNet = !!netmatch;
      if (wasNet) endNetMatch();
      setTimeout(() => menu.showGameOver(game, won, uiState.myTeam, wasNet), 900);
    }
  } else if (state === 'over' && game) {
    // keep drawing the frozen battlefield behind the overlay
    effects.update(delta);
  }

  bottombar.update(state === 'playing' ? game : null); // grid + panel follow the selection
  if (game) {
    const alpha = state === 'playing' ? (netmatch ? netmatch.alpha() : accumulator / CONFIG.FIXED_DT) : 1;
    renderer.draw(game, alpha, uiState, effects);
  }
  minimap.draw(game);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
