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
function connect(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [], byType: {} };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    (c.byType[m.t] ||= []).push(m);
  });
  return new Promise((res) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', name })); res(c); }));
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

// ---- 4) private room create/join ----
const h = await connect('Host');
const g = await connect('Guest');
say(h, { t: 'create' });
const room = await waitFor(h, 'room');
ok(room && typeof room.code === 'string' && room.code.length === 4, 'room code issued');
say(g, { t: 'join', code: room.code });
const hs = await waitFor(h, 'start');
const gs = await waitFor(g, 'start');
ok(hs && gs, 'room join starts a match for both');
ok(hs && gs && hs.seed === gs.seed, 'room match shares a seed');

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
