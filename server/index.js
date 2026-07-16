// Fangs & Honor — multiplayer server (v0.1, 1v1).
//
// The game sim (src/sim/*) is deterministic and command-driven: it only ever
// advances via game.update(1/30) and small command objects {type, team, ...}.
// So the server does NOT need to run the sim — it is a lockstep RELAY + CLOCK:
//
//   - matchmaking (quick match queue + private rooms by code)
//   - a shared seed + team assignment per match
//   - one authoritative 30 Hz tick counter per match
//   - every command a player sends is stamped with an executeTick a few ticks
//     in the future (input delay) and broadcast to BOTH players, so both run
//     the identical command at the identical tick and stay in sync
//   - a light desync watchdog (clients post periodic state checksums)
//
// Bandwidth is tiny (only commands + a low-rate clock heartbeat). Anti-cheat is
// limited in this relay model (each client's sim still validates every command
// the same way); a fully server-authoritative mode can layer on later by having
// the server import src/sim and run the sim itself.

import { WebSocketServer } from 'ws';
import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const TICK_HZ = 30;                 // must match CONFIG.FIXED_DT (1/30) on the client
const INPUT_DELAY = Number(process.env.INPUT_DELAY || 6); // ticks (~200ms) before a command fires
const CLOCK_EVERY = 6;              // broadcast the authoritative tick every N ticks (~5 Hz)
const PROTOCOL = 2;                 // v2: races picked in the lobby travel in matchmaking + start
const RACES = ['humans', 'orcs'];
const raceOf = (v) => (RACES.includes(v) ? v : 'humans');

let nextId = 1;
const clients = new Map();          // id -> conn
let queue = [];                     // ids waiting for a quick match
const rooms = new Map();            // code -> { hostId }
const matches = new Map();          // matchId -> Match
let nextMatchId = 1;

function now() { return Date.now(); }
function code4() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars
  let s = '';
  for (let i = 0; i < 4; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}
function seed31() { return (Math.random() * 0x7fffffff) | 0; }

function send(conn, obj) {
  if (conn && conn.ws.readyState === conn.ws.OPEN) {
    try { conn.ws.send(JSON.stringify(obj)); } catch { /* drop */ }
  }
}
function err(conn, reason) { send(conn, { t: 'error', reason }); }

// ------------------------------- Match -------------------------------
class Match {
  constructor(a, b) {
    this.id = nextMatchId++;
    this.players = [a, b];          // conn[0] = team 0, conn[1] = team 1
    this.seed = seed31();
    this.tick = 0;
    this.checks = [new Map(), new Map()]; // per player: tick -> checksum (for desync watch)
    a.match = this; a.team = 0; a.state = 'match';
    b.match = this; b.team = 1; b.state = 'match';
    this.races = [raceOf(a.race), raceOf(b.race)]; // race per team, picked in the lobby
    const startedAt = now();
    for (const p of this.players) {
      const opp = this.players[1 - p.team];
      send(p, {
        t: 'start', protocol: PROTOCOL, matchId: this.id, seed: this.seed,
        youAre: p.team, opponent: opp.name || 'Opponent', races: this.races,
        tickHz: TICK_HZ, inputDelay: INPUT_DELAY, startedAt,
      });
    }
    // authoritative clock
    this.timer = setInterval(() => this.step(), 1000 / TICK_HZ);
    log(`match ${this.id} started: ${a.name} (0) vs ${b.name} (1), seed=${this.seed}`);
  }

  step() {
    this.tick++;
    if (this.tick % CLOCK_EVERY === 0) {
      for (const p of this.players) send(p, { t: 'clock', tick: this.tick });
    }
  }

  // relay a player's command: stamp it with the execute tick and its team,
  // then broadcast to BOTH players so they apply it on the same tick.
  onCommand(from, cmd) {
    if (!cmd || typeof cmd !== 'object') return;
    const execTick = this.tick + INPUT_DELAY;
    const msg = { t: 'cmd', tick: execTick, team: from.team, cmd };
    for (const p of this.players) send(p, msg);
  }

  // desync watchdog: both clients post a checksum of their sim state at a tick;
  // if they ever disagree, tell both (the client can surface a "desync" notice).
  onChecksum(from, tick, sum) {
    this.checks[from.team].set(tick, sum);
    const other = this.checks[1 - from.team].get(tick);
    if (other !== undefined) {
      if (other !== sum) {
        for (const p of this.players) send(p, { t: 'desync', tick });
        log(`match ${this.id} DESYNC at tick ${tick}: ${sum} != ${other}`);
      }
      this.checks[0].delete(tick); this.checks[1].delete(tick);
    }
    // keep the checksum buffers from growing without bound
    for (const m of this.checks) if (m.size > 200) m.delete(m.keys().next().value);
  }

  end(reason, exceptId) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    for (const p of this.players) {
      if (p.id !== exceptId) send(p, { t: 'opp_left', reason });
      if (p.match === this) { p.match = null; p.state = 'idle'; p.team = null; }
    }
    matches.delete(this.id);
    log(`match ${this.id} ended (${reason})`);
  }
}

// ------------------------------ matchmaking ------------------------------
function tryQuickMatch() {
  queue = queue.filter((id) => clients.has(id) && clients.get(id).state === 'queued');
  while (queue.length >= 2) {
    const a = clients.get(queue.shift());
    const b = clients.get(queue.shift());
    if (!a || !b) continue;
    const m = new Match(a, b);
    matches.set(m.id, m);
  }
}

function leaveQueueAndRooms(conn) {
  queue = queue.filter((id) => id !== conn.id);
  for (const [c, r] of rooms) if (r.hostId === conn.id) rooms.delete(c);
}

// ------------------------------ message router ------------------------------
function onMessage(conn, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;

  switch (msg.t) {
    case 'hello':
      conn.name = String(msg.name || 'Player').slice(0, 24);
      send(conn, { t: 'welcome', id: conn.id, protocol: PROTOCOL });
      return;

    case 'quickmatch':
      if (conn.state === 'match') return err(conn, 'in-match');
      leaveQueueAndRooms(conn);
      conn.race = raceOf(msg.race);
      conn.state = 'queued';
      if (!queue.includes(conn.id)) queue.push(conn.id);
      send(conn, { t: 'queued' });
      tryQuickMatch();
      return;

    case 'create': {
      if (conn.state === 'match') return err(conn, 'in-match');
      leaveQueueAndRooms(conn);
      conn.race = raceOf(msg.race);
      let c; do { c = code4(); } while (rooms.has(c));
      rooms.set(c, { hostId: conn.id });
      conn.state = 'room';
      send(conn, { t: 'room', code: c });
      return;
    }

    case 'join': {
      if (conn.state === 'match') return err(conn, 'in-match');
      conn.race = raceOf(msg.race);
      const c = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(c);
      if (!room) return err(conn, 'no-room');
      const host = clients.get(room.hostId);
      if (!host || host.state !== 'room') { rooms.delete(c); return err(conn, 'no-room'); }
      if (host.id === conn.id) return err(conn, 'own-room');
      rooms.delete(c);
      leaveQueueAndRooms(conn);
      const m = new Match(host, conn);
      matches.set(m.id, m);
      return;
    }

    case 'cmd':
      if (conn.state === 'match' && conn.match) conn.match.onCommand(conn, msg.cmd);
      return;

    case 'checksum':
      if (conn.state === 'match' && conn.match && Number.isFinite(msg.tick)) {
        conn.match.onChecksum(conn, msg.tick, msg.sum);
      }
      return;

    case 'leave':
      if (conn.match) conn.match.end('left', conn.id);
      else { leaveQueueAndRooms(conn); conn.state = 'idle'; }
      return;

    case 'ping':
      send(conn, { t: 'pong', at: msg.at });
      return;

    default:
      return;
  }
}

function onClose(conn) {
  clients.delete(conn.id);
  leaveQueueAndRooms(conn);
  if (conn.match) conn.match.end('disconnect', conn.id);
}

// ------------------------------ server bootstrap ------------------------------
// A bare HTTP server so a plain GET (health check / nginx probe) returns 200,
// and WebSocket upgrades are handled by ws on the same port.
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'fangs-and-honor', protocol: PROTOCOL, clients: clients.size, matches: matches.size }));
    return;
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws) => {
  const conn = { id: nextId++, ws, name: 'Player', state: 'idle', match: null, team: null, alive: true };
  clients.set(conn.id, conn);
  ws.on('message', (data) => onMessage(conn, data.toString()));
  ws.on('close', () => onClose(conn));
  ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
  ws.on('pong', () => { conn.alive = true; });
  send(conn, { t: 'welcome', id: conn.id, protocol: PROTOCOL });
});

// drop dead sockets (no pong within the interval)
setInterval(() => {
  for (const conn of clients.values()) {
    if (!conn.alive) { try { conn.ws.terminate(); } catch { /* ignore */ } continue; }
    conn.alive = false;
    try { conn.ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

function log(...a) { console.log(new Date().toISOString(), ...a); }

httpServer.listen(PORT, () => log(`Fangs & Honor server listening on :${PORT} (ws path /ws, protocol ${PROTOCOL})`));

export { httpServer, wss }; // for the local test harness
