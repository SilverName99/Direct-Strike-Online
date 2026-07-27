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
// ticks before a command fires. 2 ticks ≈ 66ms — snappy, but it must stay
// ABOVE the round-trip ping between the players or commands arrive late and the
// game stutters. Bump it back up (env INPUT_DELAY=4/6) if you see stuttering on
// higher-ping connections.
const INPUT_DELAY = Number(process.env.INPUT_DELAY || 2);
const CLOCK_EVERY = 6;              // broadcast the authoritative tick every N ticks (~5 Hz)
const PROTOCOL = 3;                 // v3: persistent lobby rooms + N-player lockstep (2v2/3v3/asymmetric)
const MAX_PER_SIDE = 3;             // slots per side in a room (a fresh room opens as 3v3)
const RACES = ['humans', 'orcs', 'undead'];
const raceOf = (v) => (RACES.includes(v) ? v : 'humans');

let nextId = 1;
const clients = new Map();          // id -> conn
let queue = [];                     // ids waiting for a quick match
const rooms = new Map();            // code -> Room (persistent lobby)
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
  // `slots` is the final roster, ordered exactly like the client's layout
  // (side 0 back->front, then side 1 back->front). Each entry:
  //   { conn|null, bot: bool, difficulty, race, side, name }
  // Humans get a player INDEX into that list; bots are simulated locally by
  // every client from the same seed, so they need no connection.
  constructor(slots) {
    this.id = nextMatchId++;
    this.slots = slots;
    this.players = slots.filter((s) => s.conn).map((s) => s.conn);
    this.seed = seed31();
    this.tick = 0;
    this.checks = new Map();        // playerIndex -> Map(tick -> checksum)
    this.races = slots.map((s) => raceOf(s.race));
    this.sides = slots.map((s) => (s.side ? 1 : 0));
    this.bots = slots.map((s) => (s.bot ? { difficulty: s.difficulty || 'normal' } : null));
    const roster = slots.map((s, i) => ({
      index: i, side: this.sides[i], race: this.races[i],
      name: s.bot ? `BOT ${i + 1}` : (s.name || 'Player'), bot: !!s.bot,
      difficulty: s.bot ? (s.difficulty || 'normal') : null,
    }));
    slots.forEach((s, i) => {
      if (!s.conn) return;
      s.conn.match = this; s.conn.team = i; s.conn.state = 'match';
      this.checks.set(i, new Map());
    });
    const startedAt = now();
    for (const s of slots) {
      if (!s.conn) continue;
      send(s.conn, {
        t: 'start', protocol: PROTOCOL, matchId: this.id, seed: this.seed,
        youAre: s.conn.team, roster, races: this.races, sides: this.sides,
        // legacy 1v1 fields so an older client still understands a 2-player game
        opponent: (roster.find((r) => r.side !== this.sides[s.conn.team]) || {}).name || 'Opponent',
        tickHz: TICK_HZ, inputDelay: INPUT_DELAY, startedAt,
      });
    }
    // authoritative clock
    this.timer = setInterval(() => this.step(), 1000 / TICK_HZ);
    log(`match ${this.id} started: ${roster.map((r) => `${r.name}[${r.side}]`).join(' ')} seed=${this.seed}`);
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
    const mine = this.checks.get(from.team);
    if (!mine) return;
    mine.set(tick, sum);
    // compare against every OTHER human that has reported this tick
    for (const [idx, m] of this.checks) {
      if (idx === from.team) continue;
      const other = m.get(tick);
      if (other === undefined) continue;
      if (other !== sum) {
        for (const p of this.players) send(p, { t: 'desync', tick });
        log(`match ${this.id} DESYNC at tick ${tick}: p${from.team}=${sum} != p${idx}=${other}`);
      }
    }
    // once every human reported this tick, drop it
    let all = true;
    for (const m of this.checks) if (!m[1].has(tick)) { all = false; break; }
    if (all) for (const [, m] of this.checks) m.delete(tick);
    for (const [, m] of this.checks) if (m.size > 300) m.delete(m.keys().next().value);
  }

  // A player dropped. In TEAM matches the game continues — their side simply
  // fights on short-handed (the client applies the asymmetric income buff);
  // only when a whole side is gone (or a 1v1 loses a player) does the match end.
  onLeave(conn, reason) {
    if (this.ended) return;
    const idx = conn.team;
    this.players = this.players.filter((p) => p !== conn);
    this.checks.delete(idx);
    if (conn.match === this) { conn.match = null; conn.state = 'idle'; conn.team = null; }
    const name = (this.slots[idx] && this.slots[idx].name) || `Player ${idx + 1}`;
    for (const p of this.players) send(p, { t: 'player_left', index: idx, name, reason });
    // ...and a DETERMINISTIC sim effect: every remaining client applies
    // `abandon` on the same tick, so their zone stands but goes uncommanded and
    // their side counts as smaller (the asymmetric income bonus kicks in).
    const drop = { t: 'cmd', tick: this.tick + INPUT_DELAY, team: idx, cmd: { type: 'abandon' } };
    for (const p of this.players) send(p, drop);
    log(`match ${this.id}: player ${idx} left (${reason})`);
    // still at least one HUMAN on each side that has any slot? otherwise end
    const humansLeft = this.players.length;
    const sidesWithHuman = new Set(this.players.map((p) => this.sides[p.team]));
    const twoPlayerGame = this.slots.filter((s) => s.conn || s.bot).length <= 2;
    if (humansLeft === 0 || twoPlayerGame || sidesWithHuman.size === 0) this.end(reason, conn.id);
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


// ------------------------------- Room (lobby) -------------------------------
// A persistent WC3-style lobby: two sides of MAX_PER_SIDE slots. A slot is
// 'open', 'closed', a BOT, or a human. The host owns slot layout; each player
// owns their own race/ready. The match format falls out of who is seated —
// empty slots simply vanish, so 3 vs 2 starts as an asymmetric 2v3.
const SLOT_OPEN = 'open';
const SLOT_CLOSED = 'closed';

class Room {
  constructor(code, host) {
    this.code = code;
    this.hostId = host.id;
    this.chat = [];
    // slots[side][depth] — depth 0 = anchor (back), last = vanguard (front)
    this.slots = [0, 1].map((side) => Array.from({ length: MAX_PER_SIDE }, (_, depth) => ({
      side, depth, kind: SLOT_OPEN, connId: null, bot: false, difficulty: 'normal',
      race: 'humans', ready: false,
    })));
    this.seat(host, 0, 0); // the host takes the first anchor seat
  }

  seat(conn, side, depth) {
    const slot = this.slots[side][depth];
    slot.kind = 'player'; slot.connId = conn.id; slot.bot = false; slot.ready = false;
    slot.race = raceOf(conn.race);
    conn.room = this; conn.state = 'room';
  }

  findSlot(connId) {
    for (const side of [0, 1]) for (const sl of this.slots[side]) if (sl.connId === connId) return sl;
    return null;
  }
  firstOpen() {
    for (const side of [0, 1]) for (const sl of this.slots[side]) if (sl.kind === SLOT_OPEN) return sl;
    return null;
  }
  conns() {
    const out = [];
    for (const side of [0, 1]) for (const sl of this.slots[side]) {
      if (sl.kind === 'player' && sl.connId) { const c = clients.get(sl.connId); if (c) out.push(c); }
    }
    return out;
  }
  // seated humans + bots, in layout order (side 0 back->front, then side 1)
  roster() {
    const out = [];
    for (const side of [0, 1]) {
      for (const sl of this.slots[side]) {
        if (sl.kind === 'player' && sl.connId) {
          const c = clients.get(sl.connId);
          out.push({ ...sl, name: c ? c.name : 'Player', conn: c || null, bot: false });
        } else if (sl.kind === 'bot') {
          out.push({ ...sl, name: null, conn: null, bot: true });
        }
      }
    }
    return out;
  }

  state() {
    return {
      code: this.code, hostId: this.hostId, maxPerSide: MAX_PER_SIDE,
      slots: this.slots.map((side) => side.map((sl) => {
        const c = sl.connId ? clients.get(sl.connId) : null;
        return {
          side: sl.side, depth: sl.depth, kind: sl.kind,
          id: sl.connId, name: c ? c.name : null,
          bot: sl.kind === 'bot', difficulty: sl.difficulty,
          race: sl.race, ready: sl.kind === 'bot' ? true : sl.ready,
        };
      })),
      chat: this.chat.slice(-40),
    };
  }
  broadcast() {
    const st = { t: 'lobby', room: this.state() };
    for (const c of this.conns()) send(c, st);
  }
  say(text, from = null) {
    this.chat.push({ from, text: String(text).slice(0, 200), at: now() });
    if (this.chat.length > 80) this.chat.shift();
  }

  // every seated human ready, and both sides have at least one participant
  canStart() {
    const r = this.roster();
    const s0 = r.filter((x) => x.side === 0).length;
    const s1 = r.filter((x) => x.side === 1).length;
    if (!s0 || !s1) return false;
    return r.every((x) => x.bot || x.ready);
  }

  start() {
    if (!this.canStart()) return false;
    const slots = this.roster().map((x) => ({
      conn: x.conn, bot: x.bot, difficulty: x.difficulty,
      race: raceOf(x.race), side: x.side, name: x.name,
    }));
    const m = new Match(slots);
    matches.set(m.id, m);
    for (const c of this.conns()) { c.room = null; }
    rooms.delete(this.code);
    return true;
  }

  removeConn(connId) {
    const sl = this.findSlot(connId);
    if (sl) { sl.kind = SLOT_OPEN; sl.connId = null; sl.ready = false; }
    const c = clients.get(connId);
    if (c) { c.room = null; if (c.state === 'room') c.state = 'idle'; }
    // host left -> hand the room to the next seated player, else close it
    if (this.hostId === connId) {
      const next = this.conns()[0];
      if (!next) { rooms.delete(this.code); return; }
      this.hostId = next.id;
      this.say(`${next.name} este noul host`);
    }
    this.broadcast();
  }
}

// ------------------------------ matchmaking ------------------------------
function tryQuickMatch() {
  queue = queue.filter((id) => clients.has(id) && clients.get(id).state === 'queued');
  while (queue.length >= 2) {
    const a = clients.get(queue.shift());
    const b = clients.get(queue.shift());
    if (!a || !b) continue;
    const m = new Match([
      { conn: a, bot: false, difficulty: 'normal', race: a.race, side: 0, name: a.name },
      { conn: b, bot: false, difficulty: 'normal', race: b.race, side: 1, name: b.name },
    ]);
    matches.set(m.id, m);
  }
}

function leaveQueueAndRooms(conn) {
  queue = queue.filter((id) => id !== conn.id);
  if (conn.room) conn.room.removeConn(conn.id);
}

// only the host may reshape the room
function isHost(conn) { return conn.room && conn.room.hostId === conn.id; }

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
      const room = new Room(c, conn);
      rooms.set(c, room);
      room.say(`${conn.name} a creat camera`);
      send(conn, { t: 'room', code: c });
      room.broadcast();
      return;
    }

    case 'join': {
      if (conn.state === 'match') return err(conn, 'in-match');
      conn.race = raceOf(msg.race);
      const c = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(c);
      if (!room) return err(conn, 'no-room');
      if (room.findSlot(conn.id)) return err(conn, 'own-room');
      const free = room.firstOpen();
      if (!free) return err(conn, 'room-full');
      leaveQueueAndRooms(conn);
      room.seat(conn, free.side, free.depth);
      room.say(`${conn.name} a intrat`);
      send(conn, { t: 'room', code: c });
      room.broadcast();
      return;
    }

    // ---- lobby actions -----------------------------------------------------
    case 'lobby_race': {           // any player: pick THEIR race
      const room = conn.room; if (!room) return;
      const sl = room.findSlot(conn.id); if (!sl) return;
      sl.race = raceOf(msg.race);
      conn.race = sl.race;
      room.broadcast();
      return;
    }

    case 'lobby_ready': {          // any player: toggle their ready flag
      const room = conn.room; if (!room) return;
      const sl = room.findSlot(conn.id); if (!sl) return;
      sl.ready = !!msg.ready;
      room.broadcast();
      return;
    }

    case 'lobby_chat': {
      const room = conn.room; if (!room) return;
      const text = String(msg.text || '').trim();
      if (!text) return;
      room.say(text, conn.name);
      room.broadcast();
      return;
    }

    case 'lobby_slot': {           // HOST: open / close / bot on a free slot
      const room = conn.room; if (!room || !isHost(conn)) return;
      const side = msg.side ? 1 : 0;
      const depth = Math.max(0, Math.min(MAX_PER_SIDE - 1, msg.depth | 0));
      const sl = room.slots[side][depth];
      if (sl.kind === 'player') return err(conn, 'slot-taken'); // kick first
      if (msg.kind === 'bot') {
        sl.kind = 'bot'; sl.bot = true; sl.connId = null;
        // difficulty/race are edited one at a time — keep whatever isn't sent
        if (['easy', 'normal', 'hard'].includes(msg.difficulty)) sl.difficulty = msg.difficulty;
        else if (!['easy', 'normal', 'hard'].includes(sl.difficulty)) sl.difficulty = 'normal';
        if (msg.race) sl.race = raceOf(msg.race);
      } else if (msg.kind === SLOT_CLOSED) {
        sl.kind = SLOT_CLOSED; sl.bot = false; sl.connId = null;
      } else {
        sl.kind = SLOT_OPEN; sl.bot = false; sl.connId = null;
      }
      room.broadcast();
      return;
    }

    case 'lobby_kick': {           // HOST: free a seat (the player returns to idle)
      const room = conn.room; if (!room || !isHost(conn)) return;
      const target = clients.get(msg.id | 0);
      if (!target || target.id === conn.id) return;
      const sl = room.findSlot(target.id); if (!sl) return;
      room.say(`${target.name} a fost dat afară`);
      send(target, { t: 'kicked' });
      room.removeConn(target.id);
      return;
    }

    case 'lobby_move': {           // HOST: move a BOT (or an empty state) around
      const room = conn.room; if (!room || !isHost(conn)) return;
      const a = room.slots[msg.fromSide ? 1 : 0][Math.max(0, Math.min(MAX_PER_SIDE - 1, msg.fromDepth | 0))];
      const b = room.slots[msg.toSide ? 1 : 0][Math.max(0, Math.min(MAX_PER_SIDE - 1, msg.toDepth | 0))];
      if (!a || !b || a === b) return;
      if (a.kind === 'player' || b.kind === 'player') return err(conn, 'ask-player'); // humans swap by request
      const keep = { kind: a.kind, bot: a.bot, difficulty: a.difficulty, race: a.race, connId: a.connId };
      a.kind = b.kind; a.bot = b.bot; a.difficulty = b.difficulty; a.race = b.race; a.connId = b.connId;
      b.kind = keep.kind; b.bot = keep.bot; b.difficulty = keep.difficulty; b.race = keep.race; b.connId = keep.connId;
      room.broadcast();
      return;
    }

    // players swap seats by ASKING each other (the target must accept)
    case 'lobby_swap_req': {
      const room = conn.room; if (!room) return;
      const target = clients.get(msg.id | 0);
      const mine = room.findSlot(conn.id);
      const theirs = target ? room.findSlot(target.id) : null;
      if (!mine || !theirs || target.id === conn.id) return;
      send(target, { t: 'swap_req', from: conn.id, name: conn.name });
      return;
    }
    case 'lobby_swap_reply': {
      const room = conn.room; if (!room) return;
      const asker = clients.get(msg.id | 0);
      if (!asker) return;
      const a = room.findSlot(asker.id);
      const b = room.findSlot(conn.id);
      if (!a || !b) return;
      if (!msg.accept) { send(asker, { t: 'swap_declined', name: conn.name }); return; }
      const keep = { connId: a.connId, race: a.race, ready: a.ready };
      a.connId = b.connId; a.race = b.race; a.ready = b.ready;
      b.connId = keep.connId; b.race = keep.race; b.ready = keep.ready;
      room.say(`${asker.name} și ${conn.name} au schimbat pozițiile`);
      room.broadcast();
      return;
    }

    case 'lobby_start': {          // HOST: launch the match
      const room = conn.room; if (!room || !isHost(conn)) return;
      if (!room.canStart()) return err(conn, 'not-ready');
      room.start();
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
      if (conn.match) conn.match.onLeave(conn, 'left');
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
  if (conn.match) conn.match.onLeave(conn, 'disconnect');
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
  const conn = { id: nextId++, ws, name: 'Player', state: 'idle', match: null, room: null, team: null, alive: true };
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
