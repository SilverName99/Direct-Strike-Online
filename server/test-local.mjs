// Local smoke test for the multiplayer server — no browser, no VPS.
// Spins up the server on a test port, connects two ws clients, and verifies:
//   1. quick match pairs them (teams 0 and 1, same seed)
//   2. a command from one player is relayed to BOTH with the same execute tick
//   3. the authoritative clock ticks
//   4. private room create/join also pairs two players
// Run: cd server && npm install && npm test
import WebSocket from 'ws';

const PORT = 8790;
process.env.PORT = String(PORT);
process.env.INPUT_DELAY = '6';
await import('./index.js'); // starts listening on PORT
await sleep(200);

const URL = `ws://127.0.0.1:${PORT}/ws`;
let failed = 0;
function ok(cond, label) { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) failed++; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// a tiny client wrapper that records messages by type
// `version` = the client build; the server refuses to mix builds in one match
function connect(name, version = 'vTEST') {
  const ws = new WebSocket(URL);
  const c = { ws, name, version, msgs: [], byType: {} };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    (c.byType[m.t] ||= []).push(m);
  });
  return new Promise((res) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', name, version })); res(c); }));
}
const say = (c, obj) => c.ws.send(JSON.stringify(obj));
const waitFor = async (c, type, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (c.byType[type]?.length) return c.byType[type][c.byType[type].length - 1]; await sleep(20); }
  return null;
};

// ---- 1) quick match ----
const a = await connect('Alice');
const b = await connect('Bob');
say(a, { t: 'quickmatch', race: 'orcs' });
say(b, { t: 'quickmatch', race: 'humans' });
const sa = await waitFor(a, 'start');
const sb = await waitFor(b, 'start');
ok(sa && sb, 'both players got a start');
ok(sa && sb && sa.seed === sb.seed, 'shared seed matches');
ok(sa && sb && ((sa.youAre === 0 && sb.youAre === 1) || (sa.youAre === 1 && sb.youAre === 0)), 'teams are 0 and 1');
ok(sa && sa.inputDelay === 6 && sa.tickHz === 30, 'start carries inputDelay + tickHz');
ok(sa && Array.isArray(sa.races) && sa.races.length === 2 && JSON.stringify(sa.races) === JSON.stringify(sb.races), 'races travel in start, same on both');
ok(sa && sb && sa.races[sa.youAre] === 'orcs' && sb.races[sb.youAre] === 'humans', "each team got the race its player picked");

// ---- 2) command relay ----
a.byType.cmd = []; b.byType.cmd = [];
say(a, { t: 'cmd', cmd: { type: 'buy', unit: 'footman', x: 100, y: 200 } });
const ca = await waitFor(a, 'cmd');
const cb = await waitFor(b, 'cmd');
ok(ca && cb, 'command relayed to both players');
ok(ca && cb && ca.tick === cb.tick, 'same execute tick on both');
ok(ca && ca.team === sa.youAre, "command tagged with sender's team");
ok(ca && ca.cmd && ca.cmd.type === 'buy' && ca.cmd.unit === 'footman', 'command payload preserved');
ok(ca && ca.tick > 0, 'execute tick is in the future (tick + inputDelay)');

// ---- 3) authoritative clock ----
const clk = await waitFor(a, 'clock', 2000);
ok(clk && Number.isFinite(clk.tick), 'authoritative clock ticks');

// ---- 4) LOBBY: a room is persistent, with slots ----
const h = await connect('Host');
const g = await connect('Guest');
say(h, { t: 'create', race: 'undead' });
const room = await waitFor(h, 'room');
ok(room && typeof room.code === 'string' && room.code.length === 4, 'room code issued');
let lob = await waitFor(h, 'lobby');
ok(lob && lob.room.slots.length === 2 && lob.room.slots[0].length === 3, 'a fresh room opens as 3v3 slots');
ok(lob && lob.room.slots[0][0].kind === 'player' && lob.room.slots[0][0].name === 'Host', 'host is seated at side 0 anchor');
ok(lob && lob.room.hostId === lob.room.slots[0][0].id, 'host id matches the seated host');

// guest joins -> takes the next free slot, both see the lobby
h.byType.lobby = [];
say(g, { t: 'join', code: room.code });
const lg = await waitFor(g, 'lobby');
lob = await waitFor(h, 'lobby');
ok(lg && lob, 'both host and guest receive the lobby state');
const seats = lob.room.slots.flat().filter((sl) => sl.kind === 'player');
ok(seats.length === 2, 'two seated players after the join');

// each player picks their OWN race
h.byType.lobby = [];
say(g, { t: 'lobby_race', race: 'orcs' });
lob = await waitFor(h, 'lobby');
const guestSeat = lob.room.slots.flat().find((sl) => sl.name === 'Guest');
ok(guestSeat && guestSeat.race === 'orcs', 'a player picks their own race');
const hostSeat = lob.room.slots.flat().find((sl) => sl.name === 'Host');
ok(hostSeat && hostSeat.race === 'undead', 'allies keep DIFFERENT races');

// host adds a BOT on the enemy side
h.byType.lobby = [];
say(h, { t: 'lobby_slot', side: 1, depth: 1, kind: 'bot', difficulty: 'hard', race: 'humans' });
lob = await waitFor(h, 'lobby');
const bot = lob.room.slots[1][1];
ok(bot.kind === 'bot' && bot.difficulty === 'hard' && bot.ready === true, 'host seats a bot (always ready)');

// a non-host cannot reshape slots
h.byType.lobby = [];
say(g, { t: 'lobby_slot', side: 0, depth: 2, kind: 'closed' });
await sleep(120);
ok(!h.byType.lobby.length, 'a non-host cannot change slots');

// a player walks over to a FREE seat in the OTHER camp — no host, no asking
h.byType.lobby = [];
say(g, { t: 'lobby_seat', side: 1, depth: 2 });
lob = await waitFor(h, 'lobby');
const moved = lob.room.slots.flat().find((sl) => sl.name === 'Guest');
ok(moved && moved.side === 1 && moved.depth === 2, `a player moves himself to the other camp (${moved && moved.side}/${moved && moved.depth})`);
ok(lob.room.slots[0][1].kind === 'open', 'the seat he left goes free again');
ok(moved && moved.race === 'orcs', 'he keeps the race he picked');
// an occupied seat is refused (that is what the swap request is for)
g.byType.error = [];
say(g, { t: 'lobby_seat', side: 0, depth: 0 });
const seatErr = await waitFor(g, 'error');
ok(seatErr && seatErr.reason === 'slot-taken', 'a taken seat is refused');
// and back, so the rest of the test keeps its 1v1 shape
h.byType.lobby = [];
say(g, { t: 'lobby_seat', side: 0, depth: 1 });
await waitFor(h, 'lobby');

// chat reaches everyone
h.byType.lobby = [];
say(g, { t: 'lobby_chat', text: 'salut!' });
lob = await waitFor(h, 'lobby');
ok(lob.room.chat.some((m) => m.text === 'salut!' && m.from === 'Guest'), 'chat is broadcast with the sender');

// start is refused until every human is ready
h.byType.error = [];
say(h, { t: 'lobby_start' });
const ne = await waitFor(h, 'error');
ok(ne && ne.reason === 'not-ready', 'start blocked while a human is not ready');

// both ready -> the match starts with the seated roster
say(h, { t: 'lobby_ready', ready: true });
say(g, { t: 'lobby_ready', ready: true });
await sleep(80);
say(h, { t: 'lobby_start' });
const hs = await waitFor(h, 'start');
const gs = await waitFor(g, 'start');
ok(hs && gs, 'lobby start launches the match for both');
ok(hs && gs && hs.seed === gs.seed, 'lobby match shares a seed');
ok(hs && hs.roster && hs.roster.length === 3, 'roster carries 2 humans + 1 bot');
ok(hs && JSON.stringify(hs.races) === JSON.stringify(gs.races), 'per-player races agree on both clients');
ok(hs && hs.sides.filter((x) => x === 0).length === 2 && hs.sides.filter((x) => x === 1).length === 1,
   'asymmetric 2v1 falls out of who was seated');
ok(hs && hs.roster.some((r) => r.bot && r.difficulty === 'hard'), 'the bot travels with its difficulty');

// ---- 4b) the room browser: public rooms are listed, private ones are not ----
const pub = await connect('Publicu');
const priv = await connect('Secretos');
say(pub, { t: 'create', race: 'humans' });
const pubRoom = await waitFor(pub, 'room');
say(priv, { t: 'create', race: 'orcs', private: true });
const privRoom = await waitFor(priv, 'room');
const browser = await connect('Cautatorul');
say(browser, { t: 'rooms' });
const list = await waitFor(browser, 'roomlist');
const codes = (list.rooms || []).map((r) => r.code);
ok(codes.includes(pubRoom.code), 'a public room shows up in the browser');
ok(!codes.includes(privRoom.code), 'a private room stays hidden');
const row = (list.rooms || []).find((r) => r.code === pubRoom.code);
ok(row && row.host === 'Publicu' && row.players === 1 && row.max === 6,
  `the row carries host + occupancy (${row && row.host} ${row && row.players}/${row && row.max})`);
// a private room is still reachable BY CODE
say(browser, { t: 'join', code: privRoom.code });
const privLob = await waitFor(browser, 'lobby');
ok(privLob && privLob.room.code === privRoom.code, 'a private room is joinable with its code');
ok(privLob && privLob.room.public === false, 'the room reports itself as private');
// ...and once it has someone, a FULL room drops off the list
say(browser, { t: 'rooms' });
const list2 = await waitFor(browser, 'roomlist');
ok((list2.rooms || []).every((r) => r.code !== privRoom.code), 'still hidden after the join');

// ---- 4c) version guard: two builds never share a match ----
const oldCli = await connect('Veche', 'v1.0');
const newCli = await connect('Noua', 'v2.0');
say(newCli, { t: 'create', race: 'humans' });
const vRoom = await waitFor(newCli, 'room');
oldCli.byType.error = [];
say(oldCli, { t: 'join', code: vRoom.code });
const vErr = await waitFor(oldCli, 'error');
ok(vErr && vErr.reason === 'version', 'a different build is refused at the door');
const vLob = newCli.byType.lobby.at(-1);
ok(vLob && vLob.room.version === 'v2.0', `the room reports its build (${vLob && vLob.room.version})`);
// quick match only pairs identical builds
const qOld = await connect('QVeche', 'v1.0');
const qNew = await connect('QNoua', 'v2.0');
say(qOld, { t: 'quickmatch', race: 'humans' });
say(qNew, { t: 'quickmatch', race: 'orcs' });
await sleep(250);
ok(!qOld.byType.start && !qNew.byType.start, 'quick match does NOT pair two different builds');
const qSame = await connect('QVeche2', 'v1.0');
say(qSame, { t: 'quickmatch', race: 'undead' });
const qStart = await waitFor(qOld, 'start');
ok(!!qStart, 'the same build pairs normally');

// ---- 5) bad room code ----
const x = await connect('Lost');
x.byType.error = [];
say(x, { t: 'join', code: 'ZZZZ' });
const e = await waitFor(x, 'error');
ok(e && e.reason === 'no-room', 'joining a missing room errors cleanly');

for (const c of [a, b, h, g, x]) c.ws.close();
await sleep(100);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall server checks passed');
process.exit(failed ? 1 : 0);
