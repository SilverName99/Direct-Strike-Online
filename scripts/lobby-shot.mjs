// Headless smoke test for the "cameră" (lobby) UI: two browser tabs, one hosts
// a room, the other joins by code, both see the slots/chat, and the screens are
// captured. Run from the REPO ROOT with a PHP static server + the game server:
//   php -S 127.0.0.1:8081 &   node server/index.js &   node scripts/lobby-shot.mjs
import { chromium } from 'playwright-core';

const WEB = process.env.WEB || 'http://127.0.0.1:8081/';
const WS = process.env.WS || 'ws://127.0.0.1:8080/ws';
const OUT = process.env.OUT || '/tmp/lobby';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
await ctx.addInitScript((ws) => { window.__NET_URL = ws; }, WS);

async function openTab(name) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] console error:`, m.text()); });
  p.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await p.goto(WEB, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 20000 });
  await p.evaluate((n) => { window.__menu.playerName = n; document.querySelector('#menu-name-input').value = n; }, name);
  return p;
}

const host = await openTab('Gazda');
const guest = await openTab('Invitatul');

const toRoomScreen = async (p) => {
  await p.click('[data-go="format-mp"]');
  await p.click('.pwf-card');
};
await toRoomScreen(host);
await host.click('[data-mp="create"]');
await host.waitForSelector('.m-screen[data-screen="lobby"]:not(.hidden)', { timeout: 8000 });
const code = (await host.textContent('#lb-code')).trim();
console.log('room code:', code);

await toRoomScreen(guest);
await guest.fill('#mp-code', code);
await guest.click('[data-mp="join"]');
await guest.waitForSelector('.m-screen[data-screen="lobby"]:not(.hidden)', { timeout: 8000 });

// host: seat two bots on the far side, chat, then both ready up
const farSlot = (i) => host.locator('.lb-col').nth(1).locator('.lb-slot').nth(i);
await farSlot(0).locator('[data-lb="slot"][data-k="bot"]').click();
await host.waitForTimeout(200);
await farSlot(1).locator('[data-lb="slot"][data-k="bot"]').click();
await host.waitForTimeout(200);
// the host owns the bots: race + difficulty, no accept needed
await farSlot(0).locator('[data-lb="slot"][data-k="bot"][data-r="undead"]').click();
await host.waitForTimeout(200);
await farSlot(0).locator('[data-lb="diff"][data-df="hard"]').click();
await host.waitForTimeout(200);
const botCfg = await host.evaluate(() => {
  const sl = window.__menu.lobby.slots[1][0];
  return { race: sl.race, difficulty: sl.difficulty };
});
console.log('bot slot after edits:', JSON.stringify(botCfg), '(expect undead/hard)');
await guest.fill('#lb-input', 'Salut! Eu iau față.');
await guest.click('[data-lb="say"]');
await guest.waitForTimeout(200);
await guest.click('[data-lb="race"][data-r="undead"]');
await guest.waitForTimeout(200);
await guest.click('#lb-ready');
await host.click('#lb-ready');
await host.waitForTimeout(400);

const startTxt = await host.textContent('#lb-start');
const startEnabled = await host.isEnabled('#lb-start');
console.log('START:', startTxt.trim(), '| enabled:', startEnabled);
const guestHasStart = await guest.$eval('#lb-start', (e) => !e.classList.contains('hidden'));
console.log('guest sees START button:', guestHasStart, '(should be false)');

await host.screenshot({ path: `${OUT}-host.png` });
await guest.screenshot({ path: `${OUT}-guest.png` });

// launch the match and let both tabs run through the countdown
await host.click('#lb-start');
await host.waitForFunction(() => window.__game && window.__game.players.length === 4, null, { timeout: 10000 });
const info = await host.evaluate(() => ({
  players: window.__game.players.length,
  sides: window.__game.players.map((p) => p.side),
  races: window.__game.races,
  me: window.__ui.myTeam,
}));
console.log('match:', JSON.stringify(info));
await host.waitForTimeout(9000); // countdown + loading
await host.screenshot({ path: `${OUT}-match-host.png` });
await guest.screenshot({ path: `${OUT}-match-guest.png` });
const sync = await Promise.all([host, guest].map((p) => p.evaluate(() => ({
  tick: window.__netmatch.localTick, desync: window.__netmatch.desynced,
  gold: window.__game.money.slice(), bots: window.__netmatch.bots.length,
}))));
console.log('sync:', JSON.stringify(sync));

// a mid-match DISCONNECT: the guest's tab dies -> the host's team fights on
// short-handed and the surviving side picks up the asymmetric income bonus
const before = await host.evaluate(() => ({ asym: window.__game.asymBonusPct(0), gone: window.__game.abandoned.slice() }));
await guest.close();
await host.waitForTimeout(2500);
const after = await host.evaluate(() => ({
  asym: window.__game.asymBonusPct(0), gone: window.__game.abandoned.slice(),
  mains: window.__game.structures.filter((s) => s.kind === 'main' && s.hp > 0).length,
  over: window.__game.winner,
}));
console.log('disconnect: before', JSON.stringify(before), '-> after', JSON.stringify(after));

await browser.close();
