import { CONFIG } from '../config.js';
import { UNITS, UNIT_IDS } from '../units.js';
import { hitTestTemplate, visualRadiusOf } from '../render/renderer.js';
import { snapToZone, zoneFor } from './grid.js';
import { toast } from './pointer.js';

const BUILDING_IDS = ['wall', 'tower', 'generator', 'bldg1', 'bldg2', 'bldg3'];

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
      if (e.button === 2) { this.handleRightClick(e); return; }
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
      // (selecting it for the inspect panel at the same time)
      const raw = this.renderer.toSim(e);
      const idx = hitTestTemplate(game, 0, raw.x, raw.y);
      if (idx !== -1) {
        this.uiState.drag = { index: idx };
        this.uiState.inspect = { kind: 'template', index: idx };
        return;
      }
      // click a LIVE unit (either team) -> inspect it
      const ent = hitTestEntity(game, raw.x, raw.y);
      if (ent) { this.uiState.inspect = { kind: 'entity', id: ent.id }; return; }
      // click a structure (either team) -> inspect it; your own Main Base
      // shows its upgrades in the command grid
      const st = hitTestStructure(game, raw.x, raw.y);
      if (st) {
        this.uiState.inspect = { kind: 'structure', id: st.id };
        return;
      }
      // click a cosmetic gold-miner -> inspect it (shows its idle clip)
      const wk = this.renderer.hitTestWorker(raw.x, raw.y);
      if (wk) {
        this.uiState.inspect = { kind: 'worker', structId: wk.structId, w: wk.w };
        return;
      }
      // clicked empty ground -> clear the selection
      this.uiState.inspect = null;
    });

    window.addEventListener('mouseup', () => {
      this.uiState.drag = null;
    });

    // The right-click LOGIC lives on mousedown (button 2) below, because under
    // pointer lock Chrome fires mousedown but not always 'contextmenu'. Here we
    // only suppress the browser menu in windowed mode.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const PAN_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'];
    document.addEventListener('keydown', (e) => {
      // typing in the balance editor must not trigger game hotkeys
      if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
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
        this.uiState.inspect = null;
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        this.uiState.gridOn = !this.uiState.gridOn;
        const btn = document.getElementById('grid-btn');
        if (btn) btn.classList.toggle('off', !this.uiState.gridOn);
        toast(this.uiState.gridOn ? 'Grid: ON (snap to cells)' : 'Grid: OFF (free placement)');
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
      } else if (e.key === 'v' || e.key === 'V') {
        this.select('bldg1');
      } else if (e.key === 'b' || e.key === 'B') {
        this.select('bldg2');
      } else if (e.key === 'n' || e.key === 'N') {
        this.select('bldg3');
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
    // shop clicks now come from the bottom bar's command grid, routed
    // through this.select() by main.js (same tier gating as hotkeys)
  }

  // Right-click: first deselect the held unit/building (the "character on the
  // mouse"); otherwise sell a placed template or an own building under the
  // cursor. Called from mousedown so it works under pointer lock too.
  handleRightClick(e) {
    if (this.uiState.selected) { this.uiState.selected = null; return; }
    if (this.uiState.drag) { this.uiState.drag = null; return; }
    const game = this.getGame();
    if (!game || game.winner !== null) return;
    const { x, y } = this.renderer.toSim(e);
    const idx = hitTestTemplate(game, 0, x, y);
    if (idx !== -1) { game.issueCommand({ type: 'sellUnit', team: 0, index: idx }); return; }
    // sell an own building under the cursor (box hit test for footprints)
    const s = game.structures.find(
      (st) =>
        st.team === 0 && st.hp > 0 &&
        Math.abs(st.x - x) <= (st.hw || st.radius) + 4 &&
        Math.abs(st.y - y) <= (st.hh || st.radius) + 4
    );
    if (s) game.issueCommand({ type: 'sellBuilding', team: 0, id: s.id });
  }

  // Snap to the appropriate zone's grid when the grid is on. Buildings snap
  // by their cw×ch footprint so multi-cell structures tile flush.
  placePoint(p, selected) {
    if (!this.uiState.gridOn) return p;
    const game = this.getGame();
    if (!game) return p;
    // snap by the footprint the ghost uses: buildings AND footprint units, so
    // the placed position matches exactly where the preview showed it
    let cw = 1, ch = 1;
    if (CONFIG.BUILDINGS[selected]) {
      const bs = game.bstat(0, selected); cw = bs.cw; ch = bs.ch;
    } else if (UNITS[selected]) {
      const us = game.ustat(0, selected);
      cw = us.cw > 1 ? us.cw : 1; ch = us.ch > 1 ? us.ch : 1;
    }
    return snapToZone(zoneFor(selected, p.x, p.y), p.x, p.y, cw, ch);
  }

  // While dragging, keep the template pinned under the cursor (snapped by its
  // footprint, clamped to the army zone).
  dragTo(x, y) {
    const game = this.getGame();
    if (!game || !this.uiState.drag) return;
    const z = CONFIG.ARMY_ZONE[0];
    const tpl = game.templates[0][this.uiState.drag.index];
    const us = tpl ? game.ustat(0, tpl.type) : null;
    const cw = us && us.cw > 1 ? us.cw : 1;
    const ch = us && us.ch > 1 ? us.ch : 1;
    let p = { x: clamp(x, z.x0, z.x1), y: clamp(y, z.y0, z.y1) };
    if (this.uiState.gridOn) p = snapToZone(z, p.x, p.y, cw, ch);
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
    // Tier lock uses the RESOLVED per-race tier (the admin can retier a unit),
    // matching the shop's lock badge and the sim's buy gate — not the static
    // UNITS[id].tier, which would wrongly block a unit retiered down to T1.
    if (UNITS[id] && game.ustat(0, id).tier > game.tier[0]) return; // tier-locked
    // gated behind its tech building — must be built to select/place it
    if (UNITS[id]) {
      const s = game.ustat(0, id);
      if (s.building && !game.hasBuilding(0, s.building)) return;
      if (s.isHero && game.hasHero(0)) return; // one hero per team
    }
    // some buildings can only be built from a given base tier
    if (BUILDING_IDS.includes(id) && game.tier[0] < (game.bstat(0, id).tier || 1)) return;
    this.uiState.selected = this.uiState.selected === id ? null : id;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Nearest LIVE unit (either team) under the cursor, or null.
function hitTestEntity(game, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const u of game.entities) {
    if (u.hp <= 0) continue;
    const dx = u.x - x;
    const dy = u.y - y;
    // hit distance measured to the DRAWN body edge, so bigger units are easier
    // to click (matches the selection ring)
    const d = Math.sqrt(dx * dx + dy * dy) - visualRadiusOf(u);
    if (d <= 8 && d < bestD) { bestD = d; best = u; }
  }
  return best;
}

// Structure (either team) under the cursor — box test for footprints.
function hitTestStructure(game, x, y) {
  for (const s of game.structures) {
    if (s.hp <= 0 && s.kind !== 'main') continue;
    if (Math.abs(s.x - x) <= (s.hw || s.radius) + 6 &&
        Math.abs(s.y - y) <= (s.hh || s.radius) + 6) return s;
  }
  return null;
}
