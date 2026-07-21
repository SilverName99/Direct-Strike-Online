// Fog of war (client-side, cosmetic — the deterministic sim is untouched). Each
// viewer sees its own fog: a coarse vision grid is lit around the viewer team's
// live units and structures. Three states per cell:
//   visible   -> in sight now (clear)
//   explored  -> seen before, not now (dim; terrain + remembered enemy buildings)
//   unseen    -> never seen (black)
// The renderer culls enemy units (need `visible`) and enemy structures (need
// `explored`), then paints this overlay on top.

const CELL = 40; // vision-grid cell size in sim units (matches the placement grid)

export class Fog {
  constructor() {
    this.cols = 0; this.rows = 0;
    this.visible = null;   // Uint8Array 0/1 — currently in sight
    this.explored = null;  // Uint8Array 0/1 — ever seen
    this.canvas = null;    // tiny cols×rows canvas holding per-cell fog alpha
    this.ctx = null;
    this.img = null;       // reusable ImageData(cols, rows)
    this._dirty = true;
  }

  // (Re)allocate for a field size and forget everything explored (new match).
  reset(fieldW, fieldH) {
    this.cols = Math.max(1, Math.ceil(fieldW / CELL));
    this.rows = Math.max(1, Math.ceil(fieldH / CELL));
    const n = this.cols * this.rows;
    this.visible = new Uint8Array(n);
    this.explored = new Uint8Array(n);
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.cols; this.canvas.height = this.rows;
      this.ctx = this.canvas.getContext('2d');
      this.img = this.ctx.createImageData(this.cols, this.rows);
    }
    this._dirty = true;
  }

  visibleAt(x, y) {
    if (!this.visible) return true;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    return this.visible[cy * this.cols + cx] === 1;
  }

  exploredAt(x, y) {
    if (!this.explored) return true;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    return this.explored[cy * this.cols + cx] === 1;
  }

  // Recompute `visible` from the viewer team's living units + structures and
  // accumulate into `explored`. Cheap: a handful of sources, a few cells each.
  update(game, team) {
    if (!this.visible) return;
    this.visible.fill(0);
    const light = (x, y, r) => {
      if (!(r > 0)) return;
      const r2 = r * r;
      const cx0 = Math.max(0, Math.floor((x - r) / CELL));
      const cx1 = Math.min(this.cols - 1, Math.floor((x + r) / CELL));
      const cy0 = Math.max(0, Math.floor((y - r) / CELL));
      const cy1 = Math.min(this.rows - 1, Math.floor((y + r) / CELL));
      for (let cy = cy0; cy <= cy1; cy++) {
        const py = cy * CELL + CELL / 2;
        for (let cx = cx0; cx <= cx1; cx++) {
          const px = cx * CELL + CELL / 2;
          const dx = px - x, dy = py - y;
          if (dx * dx + dy * dy <= r2) {
            const i = cy * this.cols + cx;
            this.visible[i] = 1; this.explored[i] = 1;
          }
        }
      }
    };
    for (const u of game.entities) {
      if (u.hp > 0 && u.team === team) light(u.x, u.y, visionOfUnit(game, u));
    }
    for (const s of game.structures) {
      if (s.hp > 0 && s.team === team) light(s.x, s.y, visionOfStructure(game, s));
    }
    this._dirty = true;
  }

  // Repaint the tiny fog canvas (only when the grid changed).
  _repaint() {
    if (!this._dirty || !this.ctx) return;
    const d = this.img.data, n = this.cols * this.rows;
    for (let i = 0; i < n; i++) {
      // clear where visible, dim where explored, black where unseen
      const a = this.visible[i] ? 0 : (this.explored[i] ? 148 : 255);
      const p = i * 4;
      d[p] = 6; d[p + 1] = 9; d[p + 2] = 16; d[p + 3] = a; // matches the dark backdrop
    }
    this.ctx.putImageData(this.img, 0, 0);
    this._dirty = false;
  }

  // Paint the overlay over the whole field (world space). Upscaling the tiny
  // canvas with smoothing gives soft, rounded fog edges for free.
  draw(ctx, fieldW, fieldH) {
    if (!this.canvas) return;
    this._repaint();
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, this.cols, this.rows, 0, 0, fieldW, fieldH);
    ctx.imageSmoothingEnabled = prev;
  }
}

// A unit's sight radius: its `vision` stat, or (0 = auto) its attack range + a
// bonus so even short-range melee can see a bit ahead.
function visionOfUnit(game, u) {
  const st = game.ustatOf ? game.ustatOf(u) : null;
  const v = st && st.vision;
  if (v && v > 0) return v;
  return ((st && st.range) || 0) + 200;
}

// Structures see a little further than they shoot (and never less than a base).
function visionOfStructure(game, s) {
  const st = game.bstat ? game.bstat(s.team, s.kind) : null;
  const v = st && st.vision;
  if (v && v > 0) return v;
  return Math.max(340, ((st && st.range) || 0) + 140);
}
