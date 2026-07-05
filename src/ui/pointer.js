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

    this.cursor = document.createElement('div');
    this.cursor.id = 'vcursor';
    this.cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22">' +
      '<path d="M2 1 L2 17 L6.5 13 L9.5 20 L12.5 18.5 L9.5 12 L15 12 Z" ' +
      'fill="#f2f5fa" stroke="#0a0e14" stroke-width="1.5"/></svg>';
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
      if (!document.fullscreenElement && document.pointerLockElement) {
        document.exitPointerLock();
      }
    });

    const opts = { capture: true, passive: false };
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !e.isTrusted) return;
      e.stopPropagation();
      this.vx = clamp(this.vx + e.movementX, 0, window.innerWidth - 1);
      this.vy = clamp(this.vy + e.movementY, 0, window.innerHeight - 1);
      this.moveCursor();
      this.route('mousemove', e);
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
    this.cursor.style.transform = `translate(${this.vx}px, ${this.vy}px)`;
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

  async enter() {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        // fullscreen refused — keep playing windowed, but say so
        console.warn('Fullscreen refused:', err);
        toast('Fullscreen blocked by the browser — press F to retry');
        return;
      }
    }
    try {
      await document.body.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        document.body.requestPointerLock();
      } catch (err) {
        console.warn('Pointer lock refused:', err);
        toast('Mouse capture unavailable — fullscreen only');
      }
    }
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

let toastEl = null;
let toastTimer = 0;
function toast(msg) {
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
