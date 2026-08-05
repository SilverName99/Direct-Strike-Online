// Online 1v1 lockstep driver. Both clients build the SAME deterministic Game
// (shared seed from the server) and advance it strictly by the server's 30 Hz
// clock. Every command — local ones included — travels through the server,
// which stamps it with a future execute-tick; both sims then apply it on that
// exact tick, so they stay in sync with only tiny command packets on the wire.
//
// The local UI keeps calling game.issueCommand(...) exactly like single player:
// NetMatch swaps that method for a network send and applies the relayed
// commands itself (with the server-stamped team, so a client can't spoof the
// opponent's team).

const MOVE_THROTTLE_MS = 100; // drag spam guard: at most ~10 moveUnit sends/s

// Cheap deterministic checksum of the sim state, for the desync watchdog.
// Both clients run identical IEEE doubles, so rounding is stable across them.
export function hashGame(game) {
  let h = 0x9e3779b9 | 0;
  const mix = (v) => { h = (Math.imul(h ^ (v | 0), 2654435761) + 0x9e3779b9) | 0; };
  const mixf = (v) => mix(Math.round(v * 256));
  mixf(game.time); mix(game.waveCount);
  // per-PLAYER loops (2 in 1v1 — identical mixing order to the historical
  // explicit [0]/[1] pairs; team modes hash every commander's state)
  for (const m of game.money) mixf(m);
  for (const t of game.tier) mix(t);
  if (game.skelBought) for (const sk of game.skelBought) mix(sk);
  for (const tl of game.templates) mix(tl.length);
  for (const u of game.entities) { mixf(u.x); mixf(u.y); mixf(u.hp); }
  for (const s of game.structures) { mixf(s.x); mixf(s.y); mixf(s.hp); }
  return h | 0;
}

export class NetMatch {
  // net: connected NetClient · start: the server 'start' message · game: the Game
  constructor(net, start, game) {
    this.net = net;
    this.game = game;
    this.myTeam = start.youAre;
    this.hz = start.tickHz || 30;
    this.safety = 3;          // run this many ticks behind the estimated server clock
    this.serverTick = 0;      // last authoritative tick heard
    this.clockAt = performance.now();
    this.localTick = 0;       // ticks actually simulated
    this.pending = new Map(); // execTick -> [{team, cmd}]
    this.lateCmds = 0;        // commands that arrived after their tick (jitter)
    this.desynced = false;
    this.done = false;
    // Bot commanders in a lobby match. They are NOT on the wire: every client
    // runs the identical seeded AIController and steps it inside this loop, on
    // the same ticks, so all sims stay bit-identical.
    this.bots = [];
    this.onEnd = null;        // (kind: 'opp_left' | 'closed') => void

    // route local UI commands through the network (team stripped: the server
    // stamps the sender's real team on relay)
    this.apply = game.issueCommand.bind(game);
    this._moveLast = 0; this._moveQueued = null; this._moveTimer = 0;
    game.issueCommand = (cmd) => this._sendLocal(cmd);

    this._onCmd = (m) => this._recvCmd(m);
    this._onClock = (m) => {
      if (m.tick <= this.serverTick) return;
      const now = performance.now();
      // Where our free-running estimate currently sits (in ticks). Hard-setting
      // serverTick/clockAt on EVERY beat makes estTick() snap by however much the
      // beat arrived early/late (network jitter) — and that snap shows up as a
      // tiny "tik-tik" tremor on moving units. Instead, snap only on a big gap
      // (startup / stall) and otherwise nudge the clock gently toward the beat so
      // the interpolation stays smooth.
      const est = this.serverTick + ((now - this.clockAt) / 1000) * this.hz;
      const drift = m.tick - est; // + = server ahead of our estimate
      this.serverTick = m.tick;
      if (Math.abs(drift) > 6) {
        this.clockAt = now; // resync hard
      } else {
        // apply only a fraction of the correction: keep estTick(now) ≈ est + 10% drift
        const corrected = est + drift * 0.1;
        this.clockAt = now - ((corrected - m.tick) / this.hz) * 1000;
      }
    };
    this._onLeft = () => this._finish('opp_left');
    this._onDesync = () => { this.desynced = true; };
    this._onClose = () => this._finish('closed');
    net.on('cmd', this._onCmd);
    net.on('clock', this._onClock);
    net.on('opp_left', this._onLeft);
    net.on('desync', this._onDesync);
    net.on('close', this._onClose);
  }

  _sendLocal(cmd) {
    const c = { ...cmd };
    delete c.team;
    if (c.type === 'moveUnit') { // dragging fires every frame — throttle it
      const t = performance.now();
      if (t - this._moveLast < MOVE_THROTTLE_MS) {
        this._moveQueued = c; // keep only the newest; flush on a trailing timer
        if (!this._moveTimer) {
          this._moveTimer = setTimeout(() => {
            this._moveTimer = 0;
            if (this._moveQueued && !this.done) { this._moveLast = performance.now(); this.net.sendCmd(this._moveQueued); this._moveQueued = null; }
          }, MOVE_THROTTLE_MS);
        }
        return { ok: true, net: true };
      }
      this._moveLast = t;
    }
    this.net.sendCmd(c);
    return { ok: true, net: true }; // optimistic: an invalid command is simply a no-op on both sims
  }

  _recvCmd(m) {
    if (this.done || !m || !m.cmd) return;
    const entry = { team: m.team, cmd: m.cmd };
    if (m.tick <= this.localTick) {
      // arrived after its tick (heavy jitter) — apply now; the checksum
      // watchdog will tell us if the two clients ever actually diverge
      this.apply({ ...entry.cmd, team: entry.team });
      this.lateCmds++;
      return;
    }
    const arr = this.pending.get(m.tick);
    if (arr) arr.push(entry); else this.pending.set(m.tick, [entry]);
  }

  // Estimated authoritative tick right now (extrapolated between clock beats).
  estTick() {
    return this.serverTick + ((performance.now() - this.clockAt) / 1000) * this.hz;
  }

  // Advance the sim up to (estimated server tick - safety). Call every frame.
  update() {
    if (this.done) return;
    const target = Math.floor(this.estTick()) - this.safety;
    let steps = 0;
    while (this.localTick < target && steps < 900) { // cap the catch-up burst (~30s)
      this.localTick++; steps++;
      const cmds = this.pending.get(this.localTick);
      if (cmds) {
        this.pending.delete(this.localTick);
        for (const c of cmds) this.apply({ ...c.cmd, team: c.team });
      }
      this._stepBots(1 / this.hz);
      this.game.update(1 / this.hz);
      if (this.localTick % 30 === 0) this.net.sendChecksum(this.localTick, hashGame(this.game));
      if (this.game.winner !== null) break;
    }
  }

  // Bot commanders think on this exact tick, on every client. Their commands
  // must NOT travel the wire (that would relay them N times), so the direct
  // apply path is restored while they run.
  _stepBots(dt) {
    if (!this.bots || !this.bots.length) return;
    const netPath = this.game.issueCommand;
    this.game.issueCommand = this.apply;
    try { for (const b of this.bots) b.update(this.game, dt); }
    finally { this.game.issueCommand = netPath; }
  }

  // 0..1 fraction toward the next unsimulated tick (render interpolation).
  alpha() {
    const a = this.estTick() - this.safety - this.localTick;
    return Math.max(0, Math.min(1, a));
  }

  _finish(kind) {
    if (this.done) return;
    this.done = true;
    if (this.onEnd) this.onEnd(kind);
  }

  dispose() {
    this.done = true;
    if (this._moveTimer) { clearTimeout(this._moveTimer); this._moveTimer = 0; }
    this.net.off('cmd', this._onCmd);
    this.net.off('clock', this._onClock);
    this.net.off('opp_left', this._onLeft);
    this.net.off('desync', this._onDesync);
    this.net.off('close', this._onClose);
    this.game.issueCommand = this.apply; // restore the direct path
  }
}
