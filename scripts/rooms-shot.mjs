// Smoke test for the two new entry points:
//   1) Play vs AI -> "Create room": an OFFLINE room (you + bots) that starts a
//      single-player match from the roster
//   2) Multiplayer -> "Create a room" (public/private) and "Join a room" (the
//      room browser list + join by code)
// Run from the REPO ROOT with a PHP static server + the game server up.
import { chromium } from 'playwright-core';

const WEB = process.env.WEB || 'http://127.0.0.1:8081/';
const WS = process.env.WS || 'ws://127.0.0.1:8080/ws';
const OUT = process.env.OUT || '/tmp/rooms';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript((ws) => { window.__NET_URL = ws; }, WS);

async function openTab(name) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await p.goto(WEB, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 20000 });
  await p.evaluate((n) => { window.__menu.playerName = n; document.querySelector('#menu-name-input').value = n; }, name);
  return p;
}

// ---------- 1) offline room from "Play vs AI" ----------
const solo = await openTab('Solo');
await solo.click('[data-go="format-ai"]');
await solo.click('[data-lb="local"]');
await solo.waitForSelector('.m-screen[data-screen="lobby"].solo:not(.hidden)', { timeout: 8000 });
console.log('offline room opened; chat hidden:',
  await solo.$eval('.lobby-screen .lb-chat', (e) => getComputedStyle(e).display === 'none'));
// me: move to the front of my side; add an ally bot behind me + a 2nd enemy bot
const col = (i) => solo.locator('.lb-col').nth(i);
// ↓ one depth step forward, staying on my own side
await col(0).locator('.lb-slot').nth(0).locator('[data-lb="move"][data-ts="0"][data-td="1"]').click();
await solo.waitForTimeout(150);
await col(0).locator('.lb-slot').nth(0).locator('[data-lb="slot"][data-k="bot"]').click();
await solo.waitForTimeout(150);
await col(0).locator('.lb-slot').nth(0).locator('[data-lb="slot"][data-k="bot"][data-r="orcs"]').click();
await solo.waitForTimeout(150);
await col(1).locator('.lb-slot').nth(1).locator('[data-lb="slot"][data-k="bot"]').click();
await solo.waitForTimeout(150);
await col(1).locator('.lb-slot').nth(1).locator('[data-lb="slot"][data-k="bot"][data-r="undead"]').click();
await solo.waitForTimeout(200);
const roster = await solo.evaluate(() => window.__menu.localRoster());
console.log('roster:', JSON.stringify(roster));
await solo.screenshot({ path: `${OUT}-solo-lobby.png` });
await solo.click('#lb-start');
await solo.waitForFunction(() => window.__game && window.__game.players.length === 4, null, { timeout: 15000 });
const info = await solo.evaluate(() => ({
  players: window.__game.players.length,
  sides: window.__game.players.map((p) => p.side),
  races: window.__game.races,
  me: window.__ui.myTeam,
  net: !!window.__netmatch,
}));
console.log('offline match:', JSON.stringify(info), '(me should NOT be player 0, net=false)');
await solo.waitForTimeout(9000);
await solo.screenshot({ path: `${OUT}-solo-match.png` });

// ---------- 2) the room browser ----------
const host = await openTab('Gazda');
await host.click('[data-go="format-mp"]');
await host.click('[data-go="mp-friends"]');
await host.click('[data-mp="create"]');            // PUBLIC
await host.waitForSelector('.m-screen[data-screen="lobby"]:not(.hidden)', { timeout: 8000 });
const code = (await host.textContent('#lb-code')).trim();

const secret = await openTab('Secretos');
await secret.click('[data-go="format-mp"]');
await secret.click('[data-go="mp-friends"]');
await secret.click('[data-mp="create-private"]');  // PRIVATE
await secret.waitForSelector('.m-screen[data-screen="lobby"]:not(.hidden)', { timeout: 8000 });
const secretCode = (await secret.textContent('#lb-code')).trim();

const finder = await openTab('Cautatorul');
await finder.click('[data-go="format-mp"]');
await finder.click('[data-go="mp-join"]');
await finder.waitForTimeout(600);
const listed = await finder.$$eval('.mp-room-host', (els) => els.map((e) => e.textContent));
console.log('rooms listed:', JSON.stringify(listed), '(public only — "Secretos" must NOT be there)');
await finder.screenshot({ path: `${OUT}-browser.png` });
await finder.click('.mp-room [data-mp="join-code"]');
await finder.waitForSelector('.m-screen[data-screen="lobby"]:not(.hidden)', { timeout: 8000 });
const joinedCode = (await finder.textContent('#lb-code')).trim();
console.log('joined from the list:', joinedCode, '=== host room', code, '->', joinedCode === code);
const seats = await host.evaluate(() => window.__menu.lobby.slots.flat().filter((s) => s.kind === 'player').length);
console.log('host sees seated players:', seats, '(expect 2)');
console.log('private room code (only reachable by code):', secretCode);

await browser.close();
