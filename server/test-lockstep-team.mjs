// Team lockstep end-to-end: a LOBBY match with two humans on one side and a
// BOT on the other (2v1 asymmetric). Both clients build the same Game from the
// roster, step their local copy of the bot inside the lockstep loop, and must
// stay bit-identical — bot decisions included, since no bot command ever
// travels the wire.
// Run: cd server && node test-lockstep-team.mjs
import { NetClient } from '../src/net/netclient.js';
import { NetMatch, hashGame } from '../src/net/netmatch.js';
import { Game } from '../src/sim/game.js';
import { AIController } from '../src/sim/ai.js';
import { teamLayout, applyModeLayout } from '../src/sim/layout.js';

const PORT = 8794;
process.env.PORT = String(PORT);
process.env.INPUT_DELAY = '6';
await import('./index.js');
await sleep(200);

let failed = 0;
const ok = (c, l, extra = '') => { console.log((c ? 'ok   ' : 'FAIL ') + l + (c || !extra ? '' : ` — ${extra}`)); if (!c) failed++; };
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const grab = (c, type, ms = 3000) => new Promise((res) => {
  const to = setTimeout(() => res(null), ms);
  c.once(type, (m) => { clearTimeout(to); res(m); });
});

const URL = `ws://127.0.0.1:${PORT}/ws`;
const host = new NetClient(URL);
const guest = new NetClient(URL);
await host.connect('Host');
await guest.connect('Guest');

// --- the lobby: host opens a room, guest joins, host seats a bot opposite ---
const roomMsg = grab(host, 'room');
host.createRoom('humans');
const room = await roomMsg;
ok(!!(room && room.code), 'room opened');

const joined = grab(guest, 'lobby');
guest.joinRoom(room.code, 'orcs');
const lob = await joined;
ok(!!lob && lob.room.slots[0].filter((s) => s.kind === 'player').length === 2, 'both humans seated on side 0');

host.lobbySlot(1, 0, 'bot', { difficulty: 'normal', race: 'undead' });
await sleep(120);
host.lobbyReady(true);
guest.lobbyReady(true);
await sleep(120);

const startH = grab(host, 'start'); const startG = grab(guest, 'start');
host.lobbyStart();
const sh = await startH; const sg = await startG;
ok(!!sh && !!sg && sh.seed === sg.seed, 'lobby start reached both humans with one seed');
ok(sh.roster.length === 3 && sh.roster.filter((r) => r.bot).length === 1, 'roster = 2 humans + 1 bot');
ok(sh.sides.join(',') === '0,0,1', `sides are [0,0,1] (${sh.sides})`);

// --- both clients build the identical Game from the roster (like main.js) ---
function build(start) {
  const sides = start.roster.map((r) => r.side);
  const races = start.roster.map((r) => r.race);
  const nA = sides.filter((s) => s === 0).length;
  const nB = sides.filter((s) => s === 1).length;
  applyModeLayout(nA, nB);
  const lay = teamLayout(nA, nB);
  const game = new Game(start.seed, { races, incomeMult: races.map(() => 1), middles: [], layout: lay });
  const bots = start.roster.filter((r) => r.bot).map((r) => new AIController(
    r.index, r.difficulty || 'normal', (start.seed ^ (0x9e3779b9 + r.index * 0x85ebca6b)) >>> 0));
  return { game, bots };
}
const A = build(sh); const B = build(sg);
const mA = new NetMatch(host, sh, A.game); mA.bots = A.bots;
const mB = new NetMatch(guest, sg, B.game); mB.bots = B.bots;
ok(A.game.players.length === 3 && A.game.sideOf(2) === 1, 'sim laid out as 2v1');
ok(A.game.asymBonusPct(2) > 0 && A.game.asymBonusPct(0) === 0, 'the lone bot side carries the asymmetric bonus');

let desync = false;
host.on('desync', () => { desync = true; });
guest.on('desync', () => { desync = true; });

const tickA = setInterval(() => mA.update(), 33);
const tickB = setInterval(() => mB.update(), 33);
await sleep(1200);

// each human buys through the PATCHED issueCommand (network path)
const zoneOf = (g, p) => g.zones[p].build;
const zh = zoneOf(A.game, mA.myTeam);
A.game.issueCommand({ type: 'build', kind: 'tower', x: zh.x0 + 20, y: zh.y0 + 20 });
const zg = zoneOf(B.game, mB.myTeam);
B.game.issueCommand({ type: 'build', kind: 'tower', x: zg.x0 + 20, y: zg.y0 + 20 });

await sleep(3500); // let the bot think, build and both commands execute

clearInterval(tickA); clearInterval(tickB);
// step both to the same tick before comparing (bots step with them)
const target = Math.max(mA.localTick, mB.localTick);
const stepTo = (m, g) => {
  while (m.localTick < target) {
    m.localTick++;
    const c = m.pending.get(m.localTick);
    if (c) { m.pending.delete(m.localTick); for (const x of c) m.apply({ ...x.cmd, team: x.team }); }
    m._stepBots(1 / 30);
    g.update(1 / 30);
  }
};
stepTo(mA, A.game); stepTo(mB, B.game);

ok(mA.localTick === mB.localTick, `both sims at the same tick (${mA.localTick})`);
const towers = (g, p) => g.structures.filter((s) => s.kind === 'tower' && s.owner === p).length;
ok(towers(A.game, mA.myTeam) === 1 && towers(B.game, mA.myTeam) === 1, "the host's tower exists in BOTH sims");
ok(towers(A.game, mB.myTeam) === 1 && towers(B.game, mB.myTeam) === 1, "the guest's tower exists in BOTH sims");
const botBuilt = (g) => g.structures.filter((s) => s.owner === 2).length;
ok(botBuilt(A.game) > 1, `the local bot acted (${botBuilt(A.game)} structures)`);
ok(botBuilt(A.game) === botBuilt(B.game), 'the bot built the SAME things on both clients');
const ha = hashGame(A.game); const hb = hashGame(B.game);
ok(ha === hb, `state checksums identical (${ha} vs ${hb})`);
ok(!desync, 'no desync reported by the server watchdog');

mA.dispose(); mB.dispose();
host.close(); guest.close();
await sleep(100);
applyModeLayout(1); // restore the classic geometry
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall team lockstep checks passed');
process.exit(failed ? 1 : 0);
