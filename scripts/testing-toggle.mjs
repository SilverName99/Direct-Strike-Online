// Smoke test for the "Testing" switch (Options): tick it, start an offline
// match and check the sim runs on the fast numbers; untick it and the next
// match is back to normal.
//   node scripts/testing-toggle.mjs   (needs `php -S 127.0.0.1:8123 -t .` from the repo root)
import { chromium } from 'playwright-core';

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });

await page.goto(URL);
await page.waitForFunction(() => !!window.__menu);

async function startMatch() {
  await page.evaluate(() => {
    window.__game = null;
    const m = window.__menu;
    m.sel.player = 'undead';
    m.showLocalLobby();
    m.applyLocal({ action: 'start' });
  });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  return page.evaluate(() => ({
    testing: window.__game.testing,
    money: window.__game.money[0],
    wave: Math.round(window.__game.waveTimer * 100) / 100,
    badge: !!document.getElementById('testing-badge'),
  }));
}

// the switch lives on the Options screen
async function setSwitch(on) {
  await page.evaluate((v) => {
    const m = window.__menu;
    m.go('options');
    const el = document.getElementById('opt-testing');
    el.checked = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    m.go('main');
  }, on);
  return page.evaluate(() => window.__menu.testing);
}

const out = {};
out.switchedOn = await setSwitch(true);
out.on = await startMatch();
out.switchedOff = await setSwitch(false);
out.off = await startMatch();
out.errors = errors;
console.log(JSON.stringify(out, null, 2));
await browser.close();
