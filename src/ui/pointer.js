// Fullscreen + Pointer Lock with a virtual cursor — the standard web-game
// solution for RTS edge scrolling: while locked, the OS cursor cannot leave
// the window (crucial on multi-monitor setups), and we move our own cursor
// from raw movementX/Y, clamped to the screen edges.
//
// Under pointer lock all real mouse events hit the locked element with
// frozen clientX/Y, which would break every DOM listener (canvas, shop,
// minimap, overlay buttons). Fix: intercept trusted events at the document
// capture phase and re-dispatch synthetic clones with clientX/Y set to the
// virtual cursor position, targeted at elementFromPoint(). Existing
// listeners work unchanged; clones are isTrusted:false so they are never
// re-intercepted (no loops).
export class PointerManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.locked = false;
    this.vx = 0;
    this.vy = 0;
    this.lastTarget = null;
    this.hoverCard = null;
    // Mouse capture (pointer lock) drives a virtual cursor — needed only to keep
    // the mouse inside the window for edge-scroll on multi-monitor. It costs a
    // little cursor latency, so it is OPT-IN; by default fullscreen uses the
    // real hardware cursor (zero delay). Persisted across sessions.
    this.captureMouse = false;
    try { this.captureMouse = localStorage.getItem('ds-capture-mouse') === '1'; } catch { /* private mode */ }

    this.cursor = document.createElement('div');
    this.cursor.id = 'vcursor';
    this.defaultCursorSvg =
      '<svg width="22" height="22" viewBox="0 0 22 22">' +
      '<path d="M2 1 L2 17 L6.5 13 L9.5 20 L12.5 18.5 L9.5 12 L15 12 Z" ' +
      'fill="#f2f5fa" stroke="#0a0e14" stroke-width="1.5"/></svg>';
    this.cursor.innerHTML = this.defaultCursorSvg;
    document.body.appendChild(this.cursor);

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement != null;
      if (this.locked) {
        this.vx = window.innerWidth / 2;
        this.vy = window.innerHeight / 2;
        this.moveCursor();
        this.cursor.classList.add('visible');
      } else {
        this.cursor.classList.remove('visible');
        this.setHoverCard(null);
        // stop any edge-scroll driven by the stale virtual position
        this.canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
        this.lastTarget = null;
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        // Keyboard Lock (Chromium): a short Esc no longer drops fullscreen —
        // it is delivered to the page instead (handled below). Fully exiting
        // fullscreen then needs a long Esc press, or F / the ⛶ button.
        lockEscapeKey();
      } else {
        unlockEscapeKey();
        if (document.pointerLockElement) document.exitPointerLock();
      }
    });

    // With the Escape key locked, Esc reaches us instead of exiting
    // fullscreen. Use it to free the mouse (release pointer lock) while
    // staying fullscreen; a click on the map re-captures.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !document.fullscreenElement) return;
      if (document.pointerLockElement) {
        e.preventDefault();
        document.exitPointerLock();
      }
    });

    // Recovery: fullscreen but not captured (lock refused at start, or Esc
    // released only the lock) — the first real click on the map re-captures,
    // like native web games.
    canvas.addEventListener('mousedown', (e) => {
      if (e.isTrusted && this.captureMouse && document.fullscreenElement && !document.pointerLockElement) {
        this.requestLock();
      }
    });

    const opts = { capture: true, passive: false };
    this._routeScheduled = false;
    this._lastMove = null;
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !e.isTrusted) return;
      e.stopPropagation();
      this.vx = clamp(this.vx + e.movementX, 0, window.innerWidth - 1);
      this.vy = clamp(this.vy + e.movementY, 0, window.innerHeight - 1);
      // Keep the DRAWN cursor glued to the mouse every event — this is a cheap,
      // GPU-composited transform. The heavy work (elementFromPoint + synthetic
      // re-dispatch that drives hover/drag/edge-scroll) is throttled to one per
      // animation frame, so a busy main thread never makes the cursor trail.
      this.moveCursor();
      this._lastMove = e;
      this.scheduleRoute();
    }, opts);

    for (const type of ['mousedown', 'mouseup', 'click', 'contextmenu']) {
      document.addEventListener(type, (e) => {
        if (!this.locked || !e.isTrusted) return;
        e.stopPropagation();
        if (type === 'contextmenu') e.preventDefault();
        this.route(type, e);
      }, opts);
    }

    document.addEventListener('wheel', (e) => {
      if (!this.locked || !e.isTrusted) return;
      e.stopPropagation();
      e.preventDefault();
      const target = document.elementFromPoint(this.vx, this.vy);
      if (target) {
        target.dispatchEvent(new WheelEvent('wheel', {
          clientX: this.vx,
          clientY: this.vy,
          deltaY: e.deltaY,
          deltaX: e.deltaX,
          bubbles: true,
          cancelable: true,
        }));
      }
    }, opts);
  }

  moveCursor() {
    // translate3d forces a compositor layer so the move never repaints on the
    // main thread (paired with `will-change: transform` in the CSS)
    this.cursor.style.transform = `translate3d(${this.vx}px, ${this.vy}px, 0)`;
  }

  // Run the expensive mousemove routing at most once per frame with the latest
  // virtual position, so raw-event rate never floods the main thread.
  scheduleRoute() {
    if (this._routeScheduled) return;
    this._routeScheduled = true;
    requestAnimationFrame(() => {
      this._routeScheduled = false;
      if (this.locked && this._lastMove) this.route('mousemove', this._lastMove);
    });
  }

  // Swap the virtual cursor art for a per-race uploaded image (hotspot at the
  // top-left, like a normal cursor). Pass null/empty to restore the default
  // arrow. The image is capped at 40px so a large upload stays usable.
  setCursorImage(url) {
    if (url) {
      this.cursor.innerHTML =
        `<img src="${url}" alt="" style="max-width:40px;max-height:40px;display:block;">`;
    } else {
      this.cursor.innerHTML = this.defaultCursorSvg;
    }
    // The virtual cursor only shows under pointer lock (fullscreen). When NOT
    // fullscreen there is no lock, so drive the REAL OS cursor over the canvas
    // with a CSS cursor built from the same image (downscaled to <=40px so any
    // upload size works; hotspot top-left to match).
    this.applyOsCursor(url);
  }

  // Apply a cursor CSS value to the WHOLE page (canvas, top bar, bottom bar,
  // buttons — everything), not just the battlefield. The body.custom-cursor
  // rule in style.css forces it over per-element cursor styles (pointer etc.).
  setPageCursor(css) {
    if (css) {
      document.body.style.setProperty('--game-cursor', css);
      document.body.classList.add('custom-cursor');
      this.canvas.style.cursor = css;
    } else {
      document.body.style.removeProperty('--game-cursor');
      document.body.classList.remove('custom-cursor');
      this.canvas.style.cursor = 'crosshair';
    }
  }

  applyOsCursor(url) {
    if (!url) { this.setPageCursor(null); return; }
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 40 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * s));
      const h = Math.max(1, Math.round(img.height * s));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try {
        this.setPageCursor(`url("${c.toDataURL('image/png')}") 0 0, crosshair`);
      } catch (e) {
        this.setPageCursor(`url("${url}") 0 0, crosshair`);
      }
    };
    img.onerror = () => { this.setPageCursor(`url("${url}") 0 0, crosshair`); };
    img.src = url;
  }

  route(type, real) {
    const target = document.elementFromPoint(this.vx, this.vy);

    // Mirror mouseleave for the game canvas so edge-scroll stops when the
    // virtual cursor sits over the shop / top bar / minimap.
    if (type === 'mousemove') {
      if (this.lastTarget === this.canvas && target !== this.canvas) {
        this.canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      }
      this.lastTarget = target;
      this.setHoverCard(target ? target.closest?.('.card') : null);
    }
    if (!target) return;

    target.dispatchEvent(new MouseEvent(type, {
      clientX: this.vx,
      clientY: this.vy,
      button: real.button,
      buttons: real.buttons,
      shiftKey: real.shiftKey,
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  }

  // Synthetic events never trigger native :hover — mirror it with a class
  // so shop tooltips still appear while locked.
  setHoverCard(card) {
    if (card === this.hoverCard) return;
    if (this.hoverCard) this.hoverCard.classList.remove('hover');
    this.hoverCard = card || null;
    if (this.hoverCard) this.hoverCard.classList.add('hover');
  }

  // Both requests must fire synchronously in the SAME user gesture:
  // browsers consume the transient activation on requestFullscreen, so a
  // pointer-lock request issued after awaiting it gets rejected.
  enter() {
    // Escape-key lock is armed by the fullscreenchange handler once fullscreen
    // is actually active (calling it here too would abort that one).
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn('Fullscreen refused:', err);
        toast('Fullscreen blocked by the browser — press F to retry');
      });
    }
    // Only capture the pointer when the user opted in; otherwise fullscreen uses
    // the hardware cursor (no virtual-cursor latency).
    if (this.captureMouse) this.requestLock();
  }

  // Turn mouse capture (pointer lock) on/off, persisted. Turning it off frees
  // the pointer immediately (back to the delay-free hardware cursor); turning
  // it on captures now if already in fullscreen.
  setCaptureMouse(on) {
    this.captureMouse = !!on;
    try { localStorage.setItem('ds-capture-mouse', on ? '1' : '0'); } catch { /* private mode */ }
    if (!on && document.pointerLockElement) document.exitPointerLock();
    if (on && document.fullscreenElement && !document.pointerLockElement) this.requestLock();
    return this.captureMouse;
  }

  requestLock() {
    if (document.pointerLockElement) return;
    let p;
    try {
      p = document.body.requestPointerLock({ unadjustedMovement: true });
    } catch {
      p = Promise.reject();
    }
    Promise.resolve(p).catch(() => {
      // retry without the option (not supported everywhere)
      let q;
      try {
        q = document.body.requestPointerLock();
      } catch {
        q = Promise.reject();
      }
      Promise.resolve(q).catch((err) => {
        console.warn('Pointer lock refused:', err);
        toast('Mouse capture unavailable — fullscreen only');
      });
    });
  }

  exit() {
    if (document.pointerLockElement) document.exitPointerLock();
    if (document.fullscreenElement) document.exitFullscreen();
  }

  toggle() {
    if (document.fullscreenElement || document.pointerLockElement) this.exit();
    else this.enter();
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Keyboard Lock API (Chromium-only, needs fullscreen + secure context). When
// it works, the browser stops treating a SHORT Esc as "exit fullscreen" (it
// reaches the page instead); a LONG Esc still exits — an anti-trap rule no
// site can override. On Firefox/Safari the API is absent, so Esc always exits
// fullscreen. We log the outcome once so it's diagnosable from the console.
let escNoteShown = false;
function lockEscapeKey() {
  const kb = navigator.keyboard;
  if (!kb || !kb.lock) {
    if (!escNoteShown) {
      escNoteShown = true;
      console.info('[DS] Keyboard Lock not supported here — Esc will exit fullscreen (browser limitation; Chrome/Edge over HTTPS can suppress a short Esc).');
    }
    return;
  }
  Promise.resolve(kb.lock(['Escape']))
    .then(() => { if (!escNoteShown) { escNoteShown = true; console.info('[DS] Esc key locked — a short Esc stays in fullscreen; hold Esc (or F / ⛶) to leave.'); } })
    .catch((err) => console.warn('[DS] Keyboard lock refused:', err));
}
function unlockEscapeKey() {
  try { navigator.keyboard?.unlock?.(); } catch { /* unsupported */ }
}

let toastEl = null;
let toastTimer = 0;
export function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 4000);
}
