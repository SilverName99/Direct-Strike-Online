// The critical end-to-end determinism test: TWO real Game sims, one per fake
// client, kept in lockstep through a local server. Player A buys a unit through
// the patched issueCommand (network path); both sims must apply it on the same
// tick and produce identical checksums — including when one client starts
// stepping late and has to catch up.
// Run: cd server && node test-lockstep.mjs
import { NetClient } from '../src/net/netclient.js';
import { NetMatch, hashGame } from '../src/net/netmatch.js';
import { Game } from '../src/sim/game.js';

const PORT = 8792;
process.env.PORT = String(PORT);
process.env.INPUT_DELAY = '6';
await import('./index.js');
await sleep(200);

let failed = 0;
const ok = (c, l) => { console.log((c ? 'ok   ' : 'FAIL ') + l); if (!c) failed++; };
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const grab = (c, type, ms = 3000) => new Promise((res) => {
  const to = setTimeout(() => res(null), ms);
  c.once(type, (m) => { clearTimeout(to); res(m); });
});

const URL = `ws://127.0.0.1:${PORT}/ws`;
const a = new NetClient(URL);
const b = new NetClient(URL);
await a.connect('A');
await b.connect('B');
const startA = grab(a, 'start'); const startB = grab(b, 'start');
a.quickmatch('humans'); b.quickmatch('orcs');
const sa = await startA; const sb = await startB;
ok(sa && sb && sa.seed === sb.seed, 'match started with shared seed');

// identical Game construction on both clients (same seed/races/options)
const mk = (s) => new Game(s.seed, { races: s.races, incomeMult: [1, 1], middles: [] });
const gameA = mk(sa); const gameB = mk(sb);
const mA = new NetMatch(a, sa, gameA);
const mB = new NetMatch(b, sb, gameB);
let desync = false;
a.on('desync', () => { desync = true; });
b.on('desync', () => { desync = true; });

// drive A every 33ms from the start; B joins the stepping 600ms LATE so its
// first update() has to catch up through the pending-command buffer
const tickA = setInterval(() => mA.update(), 33);
let tickB = null;
setTimeout(() => { tickB = setInterval(() => mB.update(), 33); }, 600);

await sleep(1500);
// A builds a tower through the PATCHED issueCommand (network path) — a 1x1
// building with no tech gate and no pre-rolled spots (generators have those).
// Both sims must apply it on the same tick.
const zone = (await import('../src/config.js')).CONFIG.CONSTRUCTION_ZONE[mA.myTeam];
const res = gameA.issueCommand({ type: 'build', kind: 'tower', x: zone.x0 + 20, y: zone.y0 + 20 });
ok(res && res.ok && res.net, 'local issueCommand routed to the network');

await sleep(2500); // let the command execute + several checksum rounds pass

clearInterval(tickA); if (tickB) clearInterval(tickB);
// step both to the same tick before comparing
const target = Math.max(mA.localTick, mB.localTick);
const stepTo = (m, g) => { while (m.localTick < target) { m.localTick++; const c = m.pending.get(m.localTick); if (c) { m.pending.delete(m.localTick); for (const x of c) m.apply({ ...x.cmd, team: x.team }); } g.update(1 / 30); } };
stepTo(mA, gameA); stepTo(mB, gameB);

ok(mA.localTick === mB.localTick, `both sims at the same tick (${mA.localTick})`);
const gens = (g) => g.structures.filter((s) => s.kind === 'tower' && s.team === mA.myTeam).length;
ok(gens(gameA) === 1, "A's tower exists in A's sim");
ok(gens(gameB) === 1, "A's tower exists in B's sim too");
ok(gameA.money[mA.myTeam] === gameB.money[mA.myTeam], 'gold matches across sims');
const ha = hashGame(gameA); const hb = hashGame(gameB);
ok(ha === hb, `state checksums identical (${ha})`);
ok(!desync, 'no desync reported by the server watchdog');
ok(mA.lateCmds === 0 && mB.lateCmds === 0, 'no command arrived after its tick');

mA.dispose(); mB.dispose();
ok(typeof gameA.issueCommand === 'function' && gameA.issueCommand({ type: 'nope' }).ok === false, 'dispose restores the direct issueCommand');
a.close(); b.close();
await sleep(100);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall lockstep checks passed');
process.exit(failed ? 1 : 0);
