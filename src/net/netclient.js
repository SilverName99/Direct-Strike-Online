// Browser-side networking for online 1v1. Thin wrapper over a WebSocket that
// speaks the server protocol (see server/README.md) and re-emits messages as
// events. It carries NO game logic — the lockstep loop (netmatch.js) consumes
// these events and drives the deterministic sim.
//
// Uses the global WebSocket, which exists both in browsers and in Node 22+, so
// this exact file is unit-tested headlessly against a local server.

export class NetClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.id = null;
    this.handlers = {};      // type -> [fn]
    this._name = 'Player';
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  off(type, fn) { const a = this.handlers[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  once(type, fn) { const w = (...a) => { this.off(type, w); fn(...a); }; this.on(type, w); }
  emit(type, ...a) { for (const f of (this.handlers[type] || []).slice()) { try { f(...a); } catch (e) { console.error('net handler', type, e); } } }

  // Resolves with the server's `welcome` message once connected + greeted.
  connect(name = 'Player') {
    this._name = String(name || 'Player').slice(0, 24);
    return new Promise((resolve, reject) => {
      let done = false;
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
      this.ws = ws;
      ws.onopen = () => this.send({ t: 'hello', name: this._name });
      ws.onmessage = (ev) => this._onMessage(ev.data);
      ws.onclose = () => { this.emit('close'); if (!done) { done = true; reject(new Error('closed')); } };
      ws.onerror = (e) => { this.emit('error', e); if (!done) { done = true; reject(e); } };
      this.once('welcome', (m) => { this.id = m.id; if (!done) { done = true; resolve(m); } });
    });
  }

  _onMessage(data) {
    let m;
    try { m = JSON.parse(typeof data === 'string' ? data : data.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    this.emit(m.t, m);   // typed event: 'start', 'cmd', 'clock', 'room', 'error', ...
    this.emit('*', m);   // firehose (handy for logging/tests)
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      try { this.ws.send(JSON.stringify(obj)); } catch { /* dropped */ }
    }
  }

  // ---- lobby ---- (race = the race you picked; the server puts both in `start.races`)
  quickmatch(race) { this.send({ t: 'quickmatch', race }); }
  createRoom(race) { this.send({ t: 'create', race }); }
  joinRoom(code, race) { this.send({ t: 'join', code: String(code || '').toUpperCase().trim(), race }); }
  leave() { this.send({ t: 'leave' }); }

  // ---- in match ----
  sendCmd(cmd) { this.send({ t: 'cmd', cmd }); }
  sendChecksum(tick, sum) { this.send({ t: 'checksum', tick, sum }); }

  ping() { this.send({ t: 'ping', at: Date.now() }); }
  close() { try { if (this.ws) this.ws.close(); } catch { /* ignore */ } }
}
