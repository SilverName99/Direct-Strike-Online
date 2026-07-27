// Verifies the browser NetClient (src/net/netclient.js) against a local server,
// using Node 22's global WebSocket — the same code path the browser will use.
import { NetClient } from '../src/net/netclient.js';

const PORT = 8791;
process.env.PORT = String(PORT);
process.env.INPUT_DELAY = '6';
await import('./index.js');
await sleep(200);

const URL = `ws://127.0.0.1:${PORT}/ws`;
let failed = 0;
const ok = (c, l) => { console.log((c ? 'ok   ' : 'FAIL ') + l); if (!c) failed++; };
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const grab = (c, type, ms = 2000) => new Promise((res) => {
  const to = setTimeout(() => res(null), ms);
  c.once(type, (m) => { clearTimeout(to); res(m); });
});

const a = new NetClient(URL);
const b = new NetClient(URL);
const wa = await a.connect('Alice');
const wb = await b.connect('Bob');
ok(wa && wa.id != null, 'NetClient A connected + got welcome');
ok(wb && wb.id != null, 'NetClient B connected + got welcome');

const startA = grab(a, 'start'); const startB = grab(b, 'start');
a.quickmatch(); b.quickmatch();
const sa = await startA; const sb = await startB;
ok(sa && sb, 'both NetClients received start');
ok(sa && sb && sa.seed === sb.seed, 'shared seed');
ok(sa && sb && sa.youAre !== sb.youAre, 'distinct teams');

const cmdB = grab(b, 'cmd');
a.sendCmd({ type: 'build', kind: 'wall', x: 640, y: 400 });
const cb = await cmdB;
ok(cb && cb.cmd && cb.cmd.type === 'build', 'sendCmd relayed to peer via NetClient');
ok(cb && cb.team === sa.youAre, 'relayed command carries sender team');

const clk = await grab(a, 'clock', 2000);
ok(clk && Number.isFinite(clk.tick), 'clock event received');

// room flow via NetClient
const h = new NetClient(URL); const g = new NetClient(URL);
await h.connect('Host'); await g.connect('Guest');
const roomP = grab(h, 'room');
h.createRoom();
const room = await roomP;
ok(room && room.code, 'createRoom returns a code event');
// joining seats you in the LOBBY (protocol v3) — the match starts only once
// every human is ready and the host presses START
const gLobby = grab(g, 'lobby');
g.joinRoom(room.code);
const lob = await gLobby;
ok(!!lob && lob.room.code === room.code, 'joinRoom lands both in the room state');
const seated = lob ? lob.room.slots.flat().filter((s) => s.kind === 'player').length : 0;
ok(seated === 2, `both players are seated (${seated})`);
// both humans land on side 0, so the host seats a bot opposite them (2v1)
const hStart = grab(h, 'start'); const gStart = grab(g, 'start');
h.lobbySlot(1, 0, 'bot', { difficulty: 'hard', race: 'undead' });
h.lobbyReady(true); g.lobbyReady(true);
await sleep(80);
h.lobbyStart();
const sh = await hStart; const sg = await gStart;
ok(!!sh && !!sg, 'ready + START launches the match for both');
ok(!!sh && sh.roster.length === 3 && sh.roster[2].bot && sh.roster[2].race === 'undead',
  'the roster carries the host-configured bot');

for (const c of [a, b, h, g]) c.close();
await sleep(100);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall NetClient checks passed');
process.exit(failed ? 1 : 0);
