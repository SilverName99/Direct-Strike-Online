// Entry menu: main → format (1v1 live, 2v2/3v3 + multiplayer locked) → match
// setup (races + difficulty) → 5s countdown → loading screen → the match.
// Owns the #overlay element (main menu AND the game-over screen).

import { CONFIG, RACES } from '../config.js';
import { getLoadingScreens, spritesReady } from '../render/sprites.js';

// Player name: shown top-left in the menu, carried into the lobby and matches.
// Persisted per browser; a themed default is rolled on the very first visit.
const NAME_KEY = 'fh-player-name';
const NAME_TITLES = ['Comandant', 'General', 'Warlord', 'Căpitan', 'Mareșal', 'Baron'];
export function loadPlayerName() {
  try {
    const saved = (localStorage.getItem(NAME_KEY) || '').trim();
    if (saved) return saved.slice(0, 16);
  } catch { /* private mode */ }
  const n = `${NAME_TITLES[Math.floor(Math.random() * NAME_TITLES.length)]}${100 + Math.floor(Math.random() * 900)}`;
  try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ }
  return n;
}
export function savePlayerName(name) {
  const n = String(name || '').trim().slice(0, 16) || loadPlayerName();
  try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ }
  return n;
}

// Lobby helpers: chat + names come from other players, so everything that
// lands in innerHTML goes through esc() first.
const RACE_RO = { humans: 'Oameni', orcs: 'Orci', undead: 'Undead' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TIPS = [
  'Generatoarele sunt economia ta — protejează-le cu ziduri și turnuri.',
  'Upgrade la Bază deblochează tieruri superioare de unități.',
  'Armata ta reînvie la fiecare val și mărșăluiește singură spre inamic.',
  'Fiecare unitate are un contra: uită-te la tipul de damage 🗡️ și armură 🛡️.',
  'Ține mijlocul hărții pentru un bonus de venit.',
  'Eroul urcă în nivel din kill-urile armatei — ai grijă de el.',
];

export class Menu {
  // hooks: { onRaceChange({player, enemy}), onStart({player, enemy, difficulty}), enterFullscreen() }
  constructor(overlayEl, hooks) {
    this.el = overlayEl;
    this.hooks = hooks || {};
    this.sel = { mode: 'ai', format: '1v1', player: 'humans', enemy: 'orcs', difficulty: 'normal' };
    this.timers = [];
    this.musicVol = 0.5;   // menu-music volume (0..1), driven by the Options slider
    this.musicStarted = false;
    this.musicIndex = 0;   // which track of the menu-music playlist is playing
    this.playerName = loadPlayerName();
    this.build();
    this.wireName();
    this.wireLobby();
  }

  build() {
    this.el.innerHTML = TEMPLATE;
    this.bg = this.el.querySelector('#menu-bg');
    this.root = this.el.querySelector('#menu-root');
    this.cd = this.el.querySelector('#menu-cd');
    this.load = this.el.querySelector('#menu-load');
    this.galPrev = this.el.querySelector('#menu-gallery-prev');
    this.galNext = this.el.querySelector('#menu-gallery-next');
    this.galleryIdx = 0; // 0 = the menu background; then the loading screens
    this.music = null;
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.applyTheme();
    this.reflect();
    this.go('main');
  }

  onInput(e) {
    if (e.target && (e.target.id === 'opt-music' || e.target.id === 'snd-range')) this.setMusicVol(Number(e.target.value) / 100);
    if (e.target && e.target.id === 'opt-capture' && this.hooks.onCaptureMouse) this.hooks.onCaptureMouse(e.target.checked);
  }

  onClick(e) {
    this.ensureMusic(); // first click unlocks + starts the menu music
    const gal = e.target.closest('[data-gallery]');
    if (gal) { this.cycleGallery(Number(gal.dataset.gallery)); return; }
    const t = e.target.closest('[data-go],[data-fmt],[data-race],[data-diff],[data-play],[data-tut],[data-tutgo],[data-opt-fs],[data-snd],[data-mp],[data-music],[data-lb]');
    if (!t || t.disabled) return;
    if (t.dataset.lb) { this.onLobbyClick(t); return; }
    if (t.dataset.music) { this.changeTrack(Number(t.dataset.music)); return; }
    if (t.dataset.mp === 'join-code') { // a row in the room browser
      if (this.hooks.onNet) this.hooks.onNet({ action: 'join', code: t.dataset.code, race: this.sel.player });
      return;
    }
    if (t.dataset.mp) { this.onMp(t.dataset.mp); return; }
    if (t.hasAttribute('data-opt-fs')) {
      if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen();
      else if (this.hooks.enterFullscreen) this.hooks.enterFullscreen();
      return;
    }
    if (t.hasAttribute('data-snd')) { this.toggleMute(); return; }
    if (t.dataset.tut) { this.tutStep(Number(t.dataset.tut)); return; }
    if (t.dataset.tutgo != null) { this.tutIdx = Number(t.dataset.tutgo); this.renderTut(); return; }
    if (t.dataset.go) {
      if (t.dataset.go === 'format-ai') this.sel.mode = 'ai';
      if (t.dataset.go === 'format-mp') this.sel.mode = 'mp';
      this.go(t.dataset.go);
      return;
    }
    if (t.dataset.fmt) { this.sel.format = t.dataset.fmt; this.go('setup'); return; }
    if (t.dataset.race) {
      const opt = t.closest('[data-opt]').dataset.opt; // 'player' | 'enemy'
      this.sel[opt] = t.dataset.race;
      this.reflect();
      if (this.hooks.onRaceChange) this.hooks.onRaceChange({ player: this.sel.player, enemy: this.sel.enemy });
      return;
    }
    if (t.dataset.diff) { this.sel.difficulty = t.dataset.diff; this.reflect(); return; }
    if (t.hasAttribute('data-play')) { this.play(); return; }
  }

  go(name) {
    for (const s of this.el.querySelectorAll('.m-screen')) s.classList.toggle('hidden', s.dataset.screen !== name);
    // the lobby is TALL: it drops the big logo and hugs the top instead of
    // being centered, so nothing hides behind the brand
    this.root.classList.toggle('in-lobby', name === 'lobby');
    this.cd.classList.add('hidden');
    this.load.classList.add('hidden');
    this.root.classList.remove('hidden');
    // leaving for another entry point drops the offline roster (so "Rematch"
    // only replays the room while you're still on that path)
    if (name === 'main' || name === 'setup' || name === 'format-ai' || name === 'format-mp') this.soloRoster = null;
    if (name === 'mp-join') this.requestRooms(); // fresh list every time you enter
    if (name === 'help') this.renderHelp();
    if (name === 'options') this.syncOptions();
    if (name === 'setup') this.renderSetup();
    // Back on the main menu: re-show the background gallery arrows. play() hides
    // them for the countdown/loading, and returning after a match goes through
    // go('main') (the "Meniu" button) — without this the arrows stay hidden and
    // you can't change the background anymore once you've entered a game.
    if (name === 'main') this.refreshGallery();
    if (name === 'main' && this.hooks.onMenuMain) this.hooks.onMenuMain();
  }

  // ---- multiplayer lobby (the network itself lives in main.js hooks) ----
  onMp(action) {
    if (action === 'cancel') {
      if (this.local) { this.local = false; this.lobby = null; this.go('format-ai'); return; }
      if (this.hooks.onNetCancel) this.hooks.onNetCancel();
      this.go('format-mp');
      return;
    }
    const race = this.sel.player;
    if (action === 'join') {
      const inp = this.el.querySelector('#mp-code');
      const code = (inp && inp.value ? inp.value : '').toUpperCase().trim();
      if (code.length !== 4) { if (inp) inp.focus(); return; }
      if (this.hooks.onNet) this.hooks.onNet({ action: 'join', code, race });
      return;
    }
    if (action === 'refresh') { this.requestRooms(); return; }
    if (action === 'create-private') {
      if (this.hooks.onNet) this.hooks.onNet({ action: 'create', race, private: true });
      return;
    }
    if (this.hooks.onNet) this.hooks.onNet({ action, race }); // 'quick' | 'create'
  }

  // ---- room browser ("Join a room") ----
  requestRooms() {
    const box = this.el.querySelector('#mp-rooms');
    if (box && !box.children.length) box.innerHTML = '<p class="mp-rooms-empty">Se caută camere…</p>';
    if (this.hooks.onNet) this.hooks.onNet({ action: 'rooms' });
  }
  // main.js pushes the server's list here; every row is one joinable room
  showRooms(list) {
    const box = this.el.querySelector('#mp-rooms');
    if (!box) return;
    const rooms = Array.isArray(list) ? list : [];
    if (!rooms.length) {
      box.innerHTML = '<p class="mp-rooms-empty">Nicio cameră publică deschisă. Creează tu una!</p>';
      return;
    }
    box.innerHTML = rooms.map((r) => `
      <div class="mp-room">
        <span class="mp-room-host">${esc(r.host)}</span>
        <span class="mp-room-fill">${(r.players | 0) + (r.bots | 0)}/${r.max | 0} jucători${r.bots ? ` <small>(${r.bots} 🤖)</small>` : ''}</span>
        <button class="m-btn small" data-mp="join-code" data-code="${esc(r.code)}">Intră</button>
      </div>`).join('');
  }
  // waiting screen: matchmaking / room code / connection errors
  netWaiting(title, sub = '', code = '') {
    this.go('mp-wait');
    const t = this.el.querySelector('#mp-wait-title');
    const s = this.el.querySelector('#mp-wait-sub');
    const c = this.el.querySelector('#mp-wait-code');
    if (t) t.textContent = title;
    if (s) { s.textContent = sub; s.style.color = ''; }
    if (c) { c.textContent = code; c.classList.toggle('hidden', !code); }
  }
  netError(msg) {
    this.netWaiting('Nu a mers…');
    const s = this.el.querySelector('#mp-wait-sub');
    if (s) { s.textContent = msg; s.style.color = '#ff8090'; }
  }
  // opponent found: the same countdown+loading as single player, but at the
  // end main.js reveals the ALREADY-RUNNING network match instead of starting
  // a fresh one
  startNetCountdown() { this.netPending = true; this.play(); }

  // ---- the "cameră" (WC3-style lobby) ------------------------------------
  // Pure render of the last server `lobby` state: two sides of slots (back ->
  // front), each open / closed / a BOT / a player. Every action just sends a
  // message; the server answers with a fresh state that repaints this screen.
  wireLobby() {
    const input = this.el.querySelector('#lb-input');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); this.lobbySay(); } });
  }
  showLobby(room, myId) {
    this.lobby = room;
    this.myId = myId;
    if (this.el.querySelector('.m-screen[data-screen="lobby"]').classList.contains('hidden')) this.go('lobby');
    this.renderLobby();
  }
  lobbySay() {
    const input = this.el.querySelector('#lb-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;
    if (input) input.value = '';
    if (this.hooks.onLobby) this.hooks.onLobby({ action: 'say', text });
  }
  // The SAME lobby, offline: you + bots, no server involved. Every action is
  // applied to a room object we keep locally, so the screen behaves identically.
  showLocalLobby() {
    this.local = true;
    this.myId = 'me';
    const mk = (side, depth) => ({
      side, depth, kind: 'open', id: null, name: null,
      bot: false, difficulty: this.sel.difficulty || 'normal', race: 'humans', ready: true,
    });
    this.lobby = {
      code: '', hostId: 'me', maxPerSide: 3, local: true,
      slots: [0, 1].map((s) => [0, 1, 2].map((d) => mk(s, d))), chat: [],
    };
    const mine = this.lobby.slots[0][0];
    mine.kind = 'player'; mine.id = 'me'; mine.name = this.playerName;
    mine.race = this.sel.player; mine.ready = true;
    const foe = this.lobby.slots[1][0]; // one enemy bot so it's playable at once
    foe.kind = 'bot'; foe.bot = true; foe.race = this.sel.enemy || 'orcs';
    this.go('lobby');
    this.renderLobby();
  }
  // offline equivalent of the server's lobby handlers
  applyLocal(a) {
    const r = this.lobby;
    if (!r) return;
    const at = (s, d) => r.slots[s ? 1 : 0][Math.max(0, Math.min(2, d | 0))];
    if (a.action === 'start') {
      // same countdown + loading as any other match; runLoading() hands the
      // roster to main.js at the end
      this.local = false;
      this.soloRoster = this.localRoster();
      this.play();
      return;
    }
    if (a.action === 'race') { const m = this.mySlot(); if (m) { m.race = a.race; this.sel.player = a.race; } }
    else if (a.action === 'slot') {
      const sl = at(a.side, a.depth);
      if (sl.kind === 'player') return;
      if (a.kind === 'bot') {
        sl.kind = 'bot'; sl.bot = true; sl.name = null;
        if (a.race) sl.race = a.race;
        if (a.difficulty) sl.difficulty = a.difficulty;
      } else { sl.kind = a.kind === 'closed' ? 'closed' : 'open'; sl.bot = false; }
    } else if (a.action === 'move') {
      // offline you also move YOURSELF (there's nobody to ask)
      const A = at(a.fromSide, a.fromDepth); const B = at(a.toSide, a.toDepth);
      if (A === B) return;
      const keep = { kind: A.kind, bot: A.bot, difficulty: A.difficulty, race: A.race, id: A.id, name: A.name, ready: A.ready };
      Object.assign(A, { kind: B.kind, bot: B.bot, difficulty: B.difficulty, race: B.race, id: B.id, name: B.name, ready: B.ready });
      Object.assign(B, keep);
    }
    this.renderLobby();
  }
  // the seated commanders in layout order — the shape main.js starts a match from
  localRoster() {
    const out = [];
    for (const side of [0, 1]) {
      for (const sl of this.lobby.slots[side]) {
        if (sl.kind === 'player') out.push({ side, race: sl.race, bot: false, difficulty: 'normal', name: sl.name });
        else if (sl.kind === 'bot') out.push({ side, race: sl.race, bot: true, difficulty: sl.difficulty || 'normal' });
      }
    }
    return out;
  }

  onLobbyClick(t) {
    const d = t.dataset;
    if (d.lb === 'local') { this.showLocalLobby(); return; }
    // offline rooms never touch the network
    const send = (o) => {
      if (this.local) { this.applyLocal(o); return; }
      if (this.hooks.onLobby) this.hooks.onLobby(o);
    };
    switch (d.lb) {
      case 'say': this.lobbySay(); return;
      case 'copy': this.copyCode(); return;
      case 'ready': send({ action: 'ready', ready: !this.myReady() }); return;
      case 'start': send({ action: 'start' }); return;
      case 'race': this.sel.player = d.r; send({ action: 'race', race: d.r }); return;
      case 'slot': send({ action: 'slot', side: +d.s, depth: +d.d, kind: d.k, race: d.r }); return;
      case 'diff': send({ action: 'slot', side: +d.s, depth: +d.d, kind: 'bot', difficulty: d.df, race: d.r }); return;
      case 'move': send({ action: 'move', fromSide: +d.s, fromDepth: +d.d, toSide: +d.ts, toDepth: +d.td }); return;
      case 'kick': send({ action: 'kick', id: +d.id }); return;
      case 'swap': send({ action: 'swapReq', id: +d.id }); return;
      case 'swapyes': this.hideSwapAsk(); send({ action: 'swapReply', id: +d.id, accept: true }); return;
      case 'swapno': this.hideSwapAsk(); send({ action: 'swapReply', id: +d.id, accept: false }); return;
      default: return;
    }
  }
  // one click on the code copies it (that's the whole point of the code) —
  // the badge confirms for a second, then goes back to showing the code
  copyCode() {
    const code = this.lobby && this.lobby.code;
    const el = this.el.querySelector('#lb-code');
    if (!code || !el) return;
    const done = () => {
      el.classList.add('copied');
      el.textContent = 'COPIAT ✔';
      this.later(() => { el.classList.remove('copied'); el.textContent = code; }, 1200);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => {});
      else done();
    } catch { /* no clipboard permission — the code stays readable on screen */ }
  }

  mySlot() {
    const r = this.lobby;
    if (!r) return null;
    for (const side of r.slots) for (const sl of side) if (sl.id === this.myId) return sl;
    return null;
  }
  myReady() { const s = this.mySlot(); return !!(s && s.ready); }
  isHost() { return !!(this.lobby && this.lobby.hostId === this.myId); }

  // someone asked to trade seats with me: a banner with accept / refuse
  showSwapAsk(fromId, name) {
    const box = this.el.querySelector('#lb-swap');
    if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = `<span><b>${esc(name)}</b> vrea să schimbe poziția cu tine.</span>
      <button class="m-btn small" data-lb="swapyes" data-id="${fromId | 0}">Accept</button>
      <button class="m-btn small ghost" data-lb="swapno" data-id="${fromId | 0}">Refuz</button>`;
  }
  hideSwapAsk() {
    const box = this.el.querySelector('#lb-swap');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  }

  renderLobby() {
    const r = this.lobby;
    if (!r) return;
    const solo = !!r.local;
    const screen = this.el.querySelector('.m-screen[data-screen="lobby"]');
    if (screen) screen.classList.toggle('solo', solo); // hides chat/code/ready
    const code = this.el.querySelector('#lb-code');
    if (code) code.textContent = r.code || '';
    const headT = this.el.querySelector('.lb-head-t');
    if (headT) headT.textContent = solo ? 'Cameră de antrenament' : 'Cod cameră';
    const host = this.isHost();
    const mine = this.mySlot();
    const seated = [];
    for (const side of r.slots) for (const sl of side) if (sl.kind === 'player' || sl.kind === 'bot') seated.push(sl);
    const n = [0, 1].map((s) => seated.filter((x) => x.side === s).length);

    const box = this.el.querySelector('#lb-sides');
    if (box) {
      box.innerHTML = [0, 1].map((side) => `
        <div class="lb-col ${side === (mine ? mine.side : 0) ? 'ours' : 'theirs'}">
          <div class="lb-col-h">Tabăra ${side + 1} <span class="lb-count">${n[side]}</span></div>
          ${r.slots[side].map((sl) => this.slotHtml(sl, host, mine)).join('')}
        </div>`).join('<div class="lb-vs">VS</div>');
    }

    const log = this.el.querySelector('#lb-log');
    if (log) {
      log.innerHTML = (r.chat || []).map((c) => (c.from
        ? `<div class="lb-line"><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`
        : `<div class="lb-line sys">${esc(c.text)}</div>`)).join('');
      log.scrollTop = log.scrollHeight;
    }

    const ready = this.el.querySelector('#lb-ready');
    if (ready) {
      const on = this.myReady();
      ready.classList.toggle('on', on);
      ready.innerHTML = on ? '✔&nbsp;&nbsp;Sunt gata' : '✔&nbsp;&nbsp;Gata';
    }
    // START is the host's alone, and only once every HUMAN is ready and both
    // sides have someone (bots count as always ready)
    const waiting = seated.filter((sl) => sl.kind === 'player' && !sl.ready);
    const bothSides = n[0] > 0 && n[1] > 0;
    const ok = bothSides && !waiting.length;
    const start = this.el.querySelector('#lb-start');
    if (start) {
      start.classList.toggle('hidden', !host);
      start.disabled = !(host && ok);
      start.title = ok ? `Pornește ${n[0]}v${n[1]}` : 'Toți jucătorii umani trebuie să fie GATA';
      start.innerHTML = ok ? `▶&nbsp;&nbsp;START ${n[0]}v${n[1]}` : '▶&nbsp;&nbsp;START';
    }
    // ...and say out loud what's still missing (the host can't guess otherwise)
    const hint = this.el.querySelector('#lb-hint');
    if (hint) {
      let msg = '';
      if (!bothSides) msg = `Tabăra ${n[0] ? 2 : 1} e goală — pune un bot${solo ? '.' : ' sau așteaptă un jucător.'}`;
      else if (solo) msg = `Meci de antrenament ${n[0]}v${n[1]}${n[0] !== n[1] ? ' (asimetric: tabăra mică primește bonus de venit)' : ''}.`;
      else if (waiting.length) msg = `Se așteaptă: ${waiting.map((sl) => esc(sl.name || 'Player')).join(', ')}`;
      else if (!host) msg = 'Gazda pornește meciul.';
      else msg = `Sloturile goale dispar — pornești ${n[0]}v${n[1]}${n[0] !== n[1] ? ' (asimetric: tabăra mică primește bonus de venit)' : ''}.`;
      hint.innerHTML = msg;
    }
  }

  slotHtml(sl, host, mine) {
    const DEPTHS = ['Spate', 'Mijloc', 'Față'];
    const pos = `${DEPTHS[sl.depth] || `#${sl.depth + 1}`}`;
    const isMe = sl.id != null && sl.id === this.myId;
    const s = sl.side, d = sl.depth;
    let body = '';
    let ctl = '';

    if (sl.kind === 'player') {
      const tag = [sl.id === this.lobby.hostId ? '<span class="lb-tag host">HOST</span>' : '',
        isMe ? '<span class="lb-tag me">TU</span>' : ''].join('');
      body = `<span class="lb-name">${esc(sl.name || 'Player')}</span>${tag}
        <span class="lb-ready ${sl.ready ? 'on' : ''}">${sl.ready ? '✔ gata' : '… așteaptă'}</span>`;
      // your own race is yours to pick; everyone else's is just shown
      body += isMe
        ? `<div class="lb-races">${RACES.map((rc) => `<button class="lb-race ${sl.race === rc ? 'sel' : ''}" data-lb="race" data-r="${rc}">${RACE_RO[rc] || rc}</button>`).join('')}</div>`
        : `<div class="lb-races"><span class="lb-race sel ro">${RACE_RO[sl.race] || sl.race}</span></div>`;
      // offline you shuffle your own seat freely; online you must ASK the other
      if (isMe && this.lobby.local) ctl += this.moveBtns(sl);
      if (!isMe) ctl += `<button class="lb-mini" title="Cere schimb de poziție" data-lb="swap" data-id="${sl.id}">⇄</button>`;
      if (host && !isMe) ctl += `<button class="lb-mini bad" title="Dă afară" data-lb="kick" data-id="${sl.id}">✖</button>`;
    } else if (sl.kind === 'bot') {
      // the host owns a bot completely: its race AND its difficulty
      const botRaces = host
        ? RACES.map((rc) => `<button class="lb-race ${sl.race === rc ? 'sel' : ''}" data-lb="slot" data-s="${s}" data-d="${d}" data-k="bot" data-r="${rc}">${RACE_RO[rc] || rc}</button>`).join('')
        : `<span class="lb-race sel ro">${RACE_RO[sl.race] || sl.race}</span>`;
      const botDiffs = host
        ? ['easy', 'normal', 'hard'].map((df) => `<button class="lb-diff ${sl.difficulty === df ? 'sel' : ''}" data-lb="diff" data-s="${s}" data-d="${d}" data-df="${df}" data-r="${sl.race}">${df[0].toUpperCase()}</button>`).join('')
        : `<span class="lb-diff sel">${(sl.difficulty || 'normal')[0].toUpperCase()}</span>`;
      body = `<span class="lb-name bot">🤖 BOT</span><span class="lb-ready on">✔ gata</span>
        <div class="lb-races">${botRaces}${botDiffs}</div>`;
      if (host) {
        // the host shuffles BOTS freely — no accept needed (humans must ask)
        ctl += this.moveBtns(sl);
        ctl += `<button class="lb-mini bad" title="Golește slotul" data-lb="slot" data-s="${s}" data-d="${d}" data-k="open">✖</button>`;
      }
    } else {
      const closed = sl.kind === 'closed';
      body = `<span class="lb-name empty">${closed ? '🔒 Închis' : '— Liber —'}</span>
        <span class="lb-ready">${closed ? 'nu intră nimeni' : 'așteaptă un jucător'}</span>`;
      if (host) {
        ctl += `<button class="lb-mini" title="Pune un bot" data-lb="slot" data-s="${s}" data-d="${d}" data-k="bot" data-r="${sl.race}">🤖</button>`;
        ctl += closed
          ? `<button class="lb-mini" title="Deschide slotul" data-lb="slot" data-s="${s}" data-d="${d}" data-k="open">🔓</button>`
          : `<button class="lb-mini" title="Închide slotul" data-lb="slot" data-s="${s}" data-d="${d}" data-k="closed">🔒</button>`;
      }
    }
    return `<div class="lb-slot ${sl.kind}${isMe ? ' me' : ''}">
      <span class="lb-pos">${pos}</span>
      <div class="lb-body">${body}</div>
      <div class="lb-ctl">${ctl}</div>
    </div>`;
  }

  // ↑ / ↓ move a bot one depth step; ⇄ sends it to the other side's first
  // non-player slot. Positions are fixed by slot order, so this IS the reorder.
  moveBtns(sl) {
    const max = (this.lobby.maxPerSide || 3) - 1;
    const free = (side, depth) => {
      const t = this.lobby.slots[side][depth];
      return t && t.kind !== 'player';
    };
    let out = '';
    if (sl.depth > 0 && free(sl.side, sl.depth - 1)) out += `<button class="lb-mini" title="Mai în spate" data-lb="move" data-s="${sl.side}" data-d="${sl.depth}" data-ts="${sl.side}" data-td="${sl.depth - 1}">↑</button>`;
    if (sl.depth < max && free(sl.side, sl.depth + 1)) out += `<button class="lb-mini" title="Mai în față" data-lb="move" data-s="${sl.side}" data-d="${sl.depth}" data-ts="${sl.side}" data-td="${sl.depth + 1}">↓</button>`;
    const other = sl.side ? 0 : 1;
    for (let d = 0; d <= max; d++) {
      if (free(other, d) && this.lobby.slots[other][d].kind === 'open') {
        out += `<button class="lb-mini" title="Mută în cealaltă tabără" data-lb="move" data-s="${sl.side}" data-d="${sl.depth}" data-ts="${other}" data-td="${d}">⇄</button>`;
        break;
      }
    }
    return out;
  }

  // reflect current settings in the Options screen
  syncOptions() {
    const m = this.el.querySelector('#opt-music');
    if (m) m.value = String(Math.round(this.musicVol * 100));
    const c = this.el.querySelector('#opt-capture');
    if (c && this.hooks.getCaptureMouse) c.checked = !!this.hooks.getCaptureMouse();
  }
  setMusicVol(v) {
    this.musicVol = Math.max(0, Math.min(1, v));
    if (this.music) this.music.volume = this.musicVol;
    const pct = String(Math.round(this.musicVol * 100));
    for (const id of ['opt-music', 'snd-range']) {
      const el = this.el.querySelector('#' + id);
      if (el && el.value !== pct) el.value = pct;
    }
    const icon = this.el.querySelector('#snd-btn');
    if (icon && !CONFIG.MENU_SOUND_BTN) icon.textContent = this.musicVol === 0 ? '🔇' : '🔊';
  }
  // sound button in the corner: mute / restore the last volume
  toggleMute() {
    if (this.musicVol > 0) { this.lastVol = this.musicVol; this.setMusicVol(0); }
    else { this.setMusicVol(this.lastVol || 0.5); }
  }

  // "How to play": a slider over the admin-uploaded tutorial slides, with a
  // text fallback when none are configured.
  tutorials() { return (Array.isArray(CONFIG.TUTORIALS) ? CONFIG.TUTORIALS : []).filter((t) => t && (t.img || t.text)); }
  renderHelp() {
    const slider = this.el.querySelector('#tut-slider');
    const fallback = this.el.querySelector('#help-fallback');
    if (!slider || !fallback) return;
    const has = this.tutorials().length > 0;
    slider.classList.toggle('hidden', !has);
    fallback.classList.toggle('hidden', has);
    if (has) { this.tutIdx = 0; this.renderTut(); }
  }
  tutStep(d) {
    const n = this.tutorials().length;
    if (!n) return;
    this.tutIdx = ((this.tutIdx || 0) + d + n) % n;
    this.renderTut();
  }
  renderTut() {
    const list = this.tutorials();
    if (!list.length) return;
    this.tutIdx = Math.max(0, Math.min(this.tutIdx || 0, list.length - 1));
    const cur = list[this.tutIdx];
    const img = this.el.querySelector('#tut-slider .tut-img');
    const text = this.el.querySelector('#tut-slider .tut-text');
    const dots = this.el.querySelector('#tut-slider .tut-dots');
    const nav = this.el.querySelector('#tut-slider .tut-stage');
    if (img) { img.classList.toggle('hidden', !cur.img); if (cur.img) img.src = cur.img; }
    if (text) text.textContent = cur.text || '';
    if (nav) nav.classList.toggle('single', list.length < 2); // hide arrows for a lone slide
    if (dots) dots.innerHTML = list.map((_, i) =>
      `<button class="tut-dot${i === this.tutIdx ? ' on' : ''}" data-tutgo="${i}"></button>`).join('');
  }

  // highlight the currently selected race/difficulty pills
  reflect() {
    for (const p of this.el.querySelectorAll('.m-opts [data-race]')) {
      const opt = p.closest('[data-opt]').dataset.opt;
      p.classList.toggle('on', p.dataset.race === this.sel[opt]);
    }
    for (const p of this.el.querySelectorAll('.m-opts [data-diff]'))
      p.classList.toggle('on', p.dataset.diff === this.sel.difficulty);
  }

  applyLogo() {
    const url = CONFIG.MENU_LOGO || '';
    for (const img of this.el.querySelectorAll('.menu-logo-img')) {
      img.classList.toggle('hidden', !url);
      if (url) img.src = url;
    }
    for (const txt of this.el.querySelectorAll('.menu-logo-txt')) txt.classList.toggle('hidden', !!url);
  }

  // Admin-uploaded skins (PNGs). Each one, when set, becomes the background of
  // its menu element via a CSS variable + a toggle class on the menu root.
  applyButtons() {
    if (!this.root) return;
    const skins = [
      ['MENU_BTN', 'has-btn-skin', '--menu-btn'],
      ['MENU_CARD', 'has-card-skin', '--menu-card'],
      ['MENU_BACK', 'has-back-skin', '--menu-back'],
      ['MENU_SLIDE_FRAME', 'has-slide-skin', '--menu-slide'],
      ['MENU_FS_BTN', 'has-fs-skin', '--menu-fs'],
      ['MENU_SOUND_BTN', 'has-sound-skin', '--menu-sound'],
      ['MENU_PWF', 'has-pwf-skin', '--menu-pwf'],
      ['MENU_PLAY', 'has-play-skin', '--menu-play'],
      ['MENU_SETUP_FRAME', 'has-setup-skin', '--menu-setup'],
      ['MENU_OPTIONS_FRAME', 'has-optframe-skin', '--menu-optframe'],
      ['MENU_RACE_HUMANS', 'has-racehum-skin', '--menu-racehum'],
      ['MENU_RACE_ORCS', 'has-raceorc-skin', '--menu-raceorc'],
      ['MENU_RACE_UNDEAD', 'has-raceund-skin', '--menu-raceund'],
      ['MENU_MUSIC_PREV', 'has-musicprev-skin', '--menu-musicprev'],
      ['MENU_MUSIC_NEXT', 'has-musicnext-skin', '--menu-musicnext'],
    ];
    for (const [key, cls, varName] of skins) {
      const url = CONFIG[key] || '';
      this.root.classList.toggle(cls, !!url);
      this.root.style.setProperty(varName, url ? `url("${url}")` : 'none');
    }
    // these skins keep the art's aspect ratio but are capped so a high-res
    // upload doesn't fill the screen (a small upload still shows at its size)
    this.measure('MENU_CARD', '--menu-card-w', '--menu-card-h', 172, 200); // 1v1/2v2/3v3 cards
    this.measure('MENU_PLAY', '--menu-play-w', '--menu-play-h', 360, 104);  // setup PLAY button
    // corner buttons show a glyph only when they have no uploaded skin
    const fsBtn = this.el.querySelector('#menu-fs-corner');
    if (fsBtn) fsBtn.textContent = CONFIG.MENU_FS_BTN ? '' : '⛶';
    for (const b of this.el.querySelectorAll('.fs-btn')) if (b !== fsBtn) b.textContent = CONFIG.MENU_FS_BTN ? '' : '⛶';
    const sndBtn = this.el.querySelector('#snd-btn');
    if (sndBtn) sndBtn.textContent = CONFIG.MENU_SOUND_BTN ? '' : (this.musicVol === 0 ? '🔇' : '🔊');
    // menu-music prev/next arrows: shown only with 2+ tracks; glyph unless skinned
    const multi = this.menuTracks().length >= 2;
    const prevBtn = this.el.querySelector('#music-prev');
    const nextBtn = this.el.querySelector('#music-next');
    if (prevBtn) { prevBtn.classList.toggle('hidden', !multi); prevBtn.textContent = CONFIG.MENU_MUSIC_PREV ? '' : '‹'; }
    if (nextBtn) { nextBtn.classList.toggle('hidden', !multi); nextBtn.textContent = CONFIG.MENU_MUSIC_NEXT ? '' : '›'; }
  }

  // logo + admin-uploaded backgrounds (menu / loading). Called once balance loads.
  applyTheme() {
    this.applyLogo();
    this.applyButtons();
    // starting menu-music volume comes from admin (the player can still change
    // it live via the Options slider / bottom-right control)
    const v = Number(CONFIG.MENU_MUSIC_VOL);
    if (isFinite(v)) this.setMusicVol(Math.max(0, Math.min(100, v)) / 100);
    this.galleryIdx = 0;      // always start on the "Fundal meniu" image
    this.refreshGallery();    // show slot 0 + toggle the cycle arrows
    this.setLoadingBg(this.firstLoadingBg()); // a static default until play() rolls one
  }

  // The menu image gallery: the "Fundal meniu" image first (slot 0), then every
  // race's loading screens in order (Human's, then Orcs'). Left/right arrows
  // cycle through it, wrapping around.
  galleryImages() {
    const imgs = [CONFIG.MENU_BG || ''];
    for (const r of RACES) for (const url of getLoadingScreens(r)) imgs.push(url);
    return imgs.filter(Boolean);
  }
  setMenuBg(url) {
    if (!this.bg) return;
    this.bg.style.backgroundImage = url ? `url("${url}")` : '';
    this.bg.classList.toggle('on', !!url);
  }
  // re-read the gallery (also called once sprites finish loading) and show the
  // current slot; the arrows hide when there's nothing to cycle through
  refreshGallery() {
    const imgs = this.galleryImages();
    if (this.galleryIdx >= imgs.length) this.galleryIdx = 0;
    this.setMenuBg(imgs[this.galleryIdx] || '');
    const many = imgs.length > 1;
    if (this.galPrev) this.galPrev.classList.toggle('hidden', !many);
    if (this.galNext) this.galNext.classList.toggle('hidden', !many);
  }
  cycleGallery(dir) {
    const imgs = this.galleryImages();
    if (imgs.length < 2) return;
    this.galleryIdx = (this.galleryIdx + dir + imgs.length) % imgs.length;
    this.setMenuBg(imgs[this.galleryIdx]);
  }

  // measure an uploaded image and expose its display size as CSS variables, so
  // the element skinned with it keeps the art's aspect ratio. maxW/maxH cap the
  // size (a high-res upload is scaled DOWN to fit; a small one stays natural).
  measure(key, wVar, hVar, maxW, maxH) {
    if (!this.root) return;
    if (CONFIG[key]) {
      const im = new Image();
      im.onload = () => {
        const nw = im.naturalWidth || 1, nh = im.naturalHeight || 1;
        const scale = (maxW && maxH) ? Math.min(maxW / nw, maxH / nh, 1) : 1;
        this.root.style.setProperty(wVar, Math.round(nw * scale) + 'px');
        this.root.style.setProperty(hVar, Math.round(nh * scale) + 'px');
      };
      im.src = CONFIG[key];
    } else {
      this.root.style.removeProperty(wVar);
      this.root.style.removeProperty(hVar);
    }
  }

  // Setup header: show the format card the player clicked (its art + the format
  // label) instead of the plain "1v1 · vs AI" text. Falls back to text when no
  // card art is uploaded.
  renderSetup() {
    const head = this.el.querySelector('#setup-head');
    if (!head) return;
    const fmt = (this.sel.format || '1v1').toUpperCase();
    const hasCard = !!CONFIG.MENU_CARD;
    head.classList.toggle('as-card', hasCard);
    const img = head.querySelector('.setup-card-img');
    const label = head.querySelector('.setup-card-t');
    const title = head.querySelector('.setup-title');
    if (img) { img.classList.toggle('hidden', !hasCard); if (hasCard) img.src = CONFIG.MENU_CARD; }
    if (label) label.textContent = fmt.toLowerCase();
    if (title) { title.classList.toggle('hidden', hasCard); title.textContent = fmt; }
  }

  // Prefer the CHOSEN race's uploaded loading screens (up to 5); if that race
  // has none, fall back to the GLOBAL loading backgrounds from the balance editor.
  loadingVariants() {
    const raceScreens = getLoadingScreens(this.sel && this.sel.player);
    if (raceScreens.length) return raceScreens;
    return (CONFIG.LOADING_BGS || []).filter(Boolean);
  }
  firstLoadingBg() { return this.loadingVariants()[0] || CONFIG.LOADING_BG || CONFIG.MENU_BG || ''; }
  // one of the 3 loading backgrounds, chosen at random each time we load in
  pickLoadingBg() {
    const v = this.loadingVariants();
    if (v.length) return v[Math.floor(this.mix() * v.length) % v.length];
    return CONFIG.LOADING_BG || CONFIG.MENU_BG || '';
  }
  setLoadingBg(url) {
    const tint = 'linear-gradient(rgba(6,9,14,0.62), rgba(6,9,14,0.86))';
    for (const layer of [this.cd, this.load]) {
      if (layer) layer.style.backgroundImage = url ? `${tint}, url("${url}")` : '';
    }
  }

  // Name box (top-left): edit freely; it saves on every change and on blur,
  // falling back to the stored name if you clear it.
  wireName() {
    const input = this.el.querySelector('#menu-name-input');
    if (!input) return;
    input.value = this.playerName;
    const commit = () => {
      this.playerName = savePlayerName(input.value);
      input.value = this.playerName;
      if (this.hooks.onNameChange) this.hooks.onNameChange(this.playerName);
    };
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  }

  // The menu-music playlist: every non-empty track in MENU_MUSICS, with the
  // legacy single MENU_MUSIC as a fallback so old configs still play.
  menuTracks() {
    const list = (Array.isArray(CONFIG.MENU_MUSICS) ? CONFIG.MENU_MUSICS : []).filter((s) => typeof s === 'string' && s);
    if (list.length) return list;
    return CONFIG.MENU_MUSIC ? [CONFIG.MENU_MUSIC] : [];
  }
  currentTrack() {
    const tracks = this.menuTracks();
    if (!tracks.length) return '';
    if (this.musicIndex >= tracks.length || this.musicIndex < 0) this.musicIndex = 0;
    return tracks[this.musicIndex];
  }
  // Prev/next arrows: cycle the playlist and start the newly-picked track.
  changeTrack(dir) {
    const tracks = this.menuTracks();
    if (tracks.length < 2) return;
    this.musicIndex = (this.musicIndex + dir + tracks.length) % tracks.length;
    this._musicOff = false;
    if (this.music) { try { this.music.pause(); } catch { /* ignore */ } this.music = null; }
    this.musicStarted = false;
    this.ensureMusic();
  }

  // Preload the menu music during boot (buffer it, don't play yet — autoplay
  // needs a user gesture). Resolves once enough is loaded, or on timeout so the
  // boot loader never hangs.
  preloadMusic(timeoutMs = 3500) {
    const track = this.currentTrack();
    if (!track) return Promise.resolve();
    try {
      this.music = new Audio();
      this.music.loop = true;
      this.music.volume = this.musicVol;
      this.music.preload = 'auto';
    } catch { this.music = null; return Promise.resolve(); }
    const el = this.music;
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      el.addEventListener('canplaythrough', fin, { once: true });
      el.addEventListener('loadeddata', fin, { once: true });
      el.addEventListener('error', fin, { once: true });
      setTimeout(fin, timeoutMs);
      el.src = track;
    });
  }
  ensureMusic() {
    const track = this.currentTrack();
    if (!track) return;
    // once Play is pressed the menu music is off for good (the match has its own);
    // without this, a click on the countdown/loading overlay would restart it.
    if (this._musicOff) return;
    if (!this.music) { // no preload ran (e.g. music set after boot, or a track switch)
      try { this.music = new Audio(track); this.music.loop = true; this.music.volume = this.musicVol; }
      catch { this.music = null; return; }
    } else if (this.music.src !== track && !this.music.src.endsWith(track)) {
      // a different track was selected -> point the player at it
      try { this.music.src = track; } catch { /* ignore */ }
    }
    if (this.musicStarted && !this.music.paused) return;
    this.music.play()
      .then(() => { this.musicStarted = true; if (this._disarmMusic) this._disarmMusic(); })
      .catch(() => { /* autoplay blocked — a user gesture is required (armMusic) */ });
  }
  // Try to start the music as soon as the menu is shown. Browsers forbid audio
  // autoplay before any user interaction, so if the immediate attempt is
  // blocked we start on the FIRST gesture anywhere on the page (not just a menu
  // button) — and once the browser trusts the site the eager attempt succeeds.
  armMusic() {
    if (!this.currentTrack()) return;
    this.ensureMusic(); // plays now if the browser allows it
    if (this._disarmMusic) return; // already armed
    const evs = ['pointerdown', 'keydown', 'touchstart', 'click'];
    const onGesture = () => this.ensureMusic();
    this._disarmMusic = () => { evs.forEach((e) => window.removeEventListener(e, onGesture, true)); this._disarmMusic = null; };
    evs.forEach((e) => window.addEventListener(e, onGesture, true));
  }
  stopMusic() {
    if (this.music) { this.music.pause(); this.music = null; }
    this.musicStarted = false;
    if (this._disarmMusic) this._disarmMusic();
  }

  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

  hideGalleryArrows() {
    if (this.galPrev) this.galPrev.classList.add('hidden');
    if (this.galNext) this.galNext.classList.add('hidden');
  }

  // Play → fullscreen (in the click gesture) → 5s countdown → loading → match
  play() {
    this.clearTimers();
    this.hideGalleryArrows(); // no gallery arrows over the countdown/loading
    this._musicOff = true;    // block any restart while the countdown/loading runs
    this.stopMusic(); // menu music off; the match starts its own
    this.setLoadingBg(this.pickLoadingBg()); // roll one of the 3 loading variants
    if (this.hooks.enterFullscreen) this.hooks.enterFullscreen();
    // countdown
    this.root.classList.add('hidden');
    this.load.classList.add('hidden');
    this.cd.classList.remove('hidden');
    const num = this.cd.querySelector('.cd-num');
    let n = 5;
    const tick = () => {
      num.textContent = String(n);
      num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
      if (n <= 1) { this.later(() => this.runLoading(), 1000); return; }
      n--;
      this.later(tick, 1000);
    };
    tick();
  }

  runLoading() {
    this.cd.classList.add('hidden');
    this.load.classList.remove('hidden');
    const fill = this.load.querySelector('.load-fill');
    const tip = this.load.querySelector('.load-tip');
    const tips = (Array.isArray(CONFIG.LOADING_TIPS) && CONFIG.LOADING_TIPS.length) ? CONFIG.LOADING_TIPS : TIPS;
    tip.textContent = '💡 ' + tips[Math.floor(this.mix() * tips.length) % tips.length];
    fill.style.transition = 'none'; fill.style.width = '0%';
    void fill.offsetWidth;
    fill.style.transition = 'width 1.4s cubic-bezier(.4,.5,.2,1)';
    fill.style.width = '92%'; // hold near the end until the sprites are actually ready
    const startLoad = this.nowMs();
    const MIN_MS = 1550;   // minimum time on the loading screen (feels intentional)
    const CAP_MS = 25000;  // hard cap so a stuck/failed load can't hang the menu
    const finish = () => {
      fill.style.transition = 'width 0.2s ease'; fill.style.width = '100%';
      this.later(() => {
        if (this.netPending) { this.netPending = false; if (this.hooks.onNetReveal) this.hooks.onNetReveal(); }
        // the roster is kept so "Rematch" replays the same room
        else if (this.soloRoster && this.hooks.onStartRoster) this.hooks.onStartRoster(this.soloRoster);
        else if (this.hooks.onStart) this.hooks.onStart({ ...this.sel });
        this.hide();
      }, 200);
    };
    // Wait for the sprite assets to finish loading (so a match never opens with
    // placeholder shapes when you enter fast), but keep a minimum + a safety cap.
    const step = () => {
      const elapsed = this.nowMs() - startLoad;
      const ready = spritesReady();
      if (elapsed >= CAP_MS || (elapsed >= MIN_MS && ready)) { finish(); return; }
      this.later(step, 120);
    };
    this.later(step, MIN_MS);
  }

  // wall-clock ms for the (UI-only) loading timer; falls back if performance is
  // unavailable in some embed. Never used by the deterministic sim.
  nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // tiny non-seeded shuffle just for picking a tip (UI only, never the sim)
  mix() { this._m = ((this._m || Date.now()) * 1103515245 + 12345) & 0x7fffffff; return this._m / 0x7fffffff; }

  show() { this.clearTimers(); this._musicOff = false; this.galleryIdx = 0; this.refreshGallery(); this.go('main'); this.el.classList.add('visible'); this.armMusic(); }
  hide() { this.clearTimers(); this.stopMusic(); this.el.classList.remove('visible'); }

  showGameOver(game, playerWon, team = 0, isNet = false) {
    this.clearTimers();
    const t = this.el.querySelector('#over-title');
    t.textContent = playerWon ? 'VICTORY' : 'DEFEAT';
    t.className = 'm-title ' + (playerWon ? 'victory' : 'defeat');
    this.el.querySelector('#over-stats').innerHTML =
      `Valuri: <b>${game.waveCount}</b> · Aur cheltuit: <b>${Math.floor(game.spent[team])}</b> · ` +
      `Tier atins: <b>${'I'.repeat(game.tier[team])}</b>`;
    // no instant rematch online (the opponent is gone) — back to the menu
    const rematch = this.el.querySelector('.m-screen[data-screen="over"] [data-play]');
    if (rematch) rematch.classList.toggle('hidden', !!isNet);
    this.go('over');
    this.el.classList.add('visible');
  }
}

const races = (opt) => `
  <div class="m-opts" data-opt="${opt}">
    <button class="m-pill" data-race="humans">⚔ Humans</button>
    <button class="m-pill" data-race="orcs">🪓 Orcs</button>
    <button class="m-pill" data-race="undead">💀 Undead</button>
  </div>`;

const TEMPLATE = `
<div id="menu-bg"></div>
<button id="menu-gallery-prev" class="menu-gallery-arrow left hidden" data-gallery="-1" title="Imaginea anterioară" aria-label="Anterior">‹</button>
<button id="menu-gallery-next" class="menu-gallery-arrow right hidden" data-gallery="1" title="Imaginea următoare" aria-label="Următor">›</button>
<div id="menu-root">
  <div class="menu-brand">
    <img class="menu-logo-img hidden" alt="Fangs & Honor">
    <h1 class="menu-logo-txt">FANGS <span class="amp">&amp;</span> HONOR</h1>
  </div>

  <div id="menu-name" title="Numele tău — apare în cameră și în meciuri">
    <span class="name-ico">🛡</span>
    <input id="menu-name-input" maxlength="16" spellcheck="false" autocomplete="off">
  </div>
  <button id="menu-fs-corner" class="corner-btn fs-btn" title="Ecran complet" data-opt-fs>⛶</button>
  <div id="menu-sound">
    <button id="music-prev" class="corner-btn music-arrow hidden" title="Melodia anterioară" data-music="-1">‹</button>
    <button id="snd-btn" class="corner-btn snd-btn" title="Volum muzică (click = mute)" data-snd>🔊</button>
    <button id="music-next" class="corner-btn music-arrow hidden" title="Melodia următoare" data-music="1">›</button>
    <input type="range" id="snd-range" class="m-range snd-range" min="0" max="100" value="50">
  </div>

  <section class="m-screen" data-screen="main">
    <div class="m-btns">
      <button class="m-btn primary" data-go="format-ai">⚔&nbsp;&nbsp;Play vs AI</button>
      <button class="m-btn" data-go="format-mp">🌐&nbsp;&nbsp;Multiplayer</button>
      <button class="m-btn" data-go="options">⚙&nbsp;&nbsp;Options</button>
      <button class="m-btn ghost" data-go="help">📖&nbsp;&nbsp;How to play</button>
    </div>
  </section>

  <section class="m-screen hidden" data-screen="format-ai">
    <h2 class="m-title">Play vs AI</h2>
    <div class="m-cards">
      <button class="m-card" data-fmt="1v1"><span class="m-card-t">1v1</span></button>
      <button class="m-card" data-fmt="2v2"><span class="m-card-t">2v2</span></button>
      <button class="m-card" data-fmt="3v3"><span class="m-card-t">3v3</span></button>
    </div>
    <p class="m-hint" style="margin:10px 0 4px">Asimetric — tu în tabăra mică (bonus de venit, setabil în admin):</p>
    <div class="m-cards">
      <button class="m-card" data-fmt="1v2"><span class="m-card-t">1v2</span></button>
      <button class="m-card" data-fmt="1v3"><span class="m-card-t">1v3</span></button>
      <button class="m-card" data-fmt="2v3"><span class="m-card-t">2v3</span></button>
    </div>
    <div class="m-btns">
      <button class="m-btn" data-lb="local">🛡&nbsp;&nbsp;Create room</button>
    </div>
    <p class="m-hint">Îți aranjezi singur tabăra: poziții, rase și boți, în orice format.</p>
    <button class="m-back" data-go="main"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="format-mp">
    <h2 class="m-title">Multiplayer</h2>
    <div class="m-btns">
      <button class="m-btn primary" data-go="mp-friends">➕&nbsp;&nbsp;Create a room</button>
      <button class="m-btn" data-go="mp-join">🔎&nbsp;&nbsp;Join a room</button>
    </div>
    <button class="m-btn ghost" data-go="mp-setup">⚔ Meci rapid 1v1</button>
    <button class="m-back" data-go="main"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="mp-setup">
    <h2 class="m-title">1v1 Online</h2>
    <div class="m-setup">
      <div class="m-row"><span class="m-label">Your Race</span>${races('player')}</div>
    </div>
    <button class="m-btn primary big play-btn" data-mp="quick"><span class="m-play-txt">⚔&nbsp;&nbsp;Caută meci</span></button>
    <button class="m-back" data-go="format-mp"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="mp-friends">
    <h2 class="m-title">Create a room</h2>
    <div class="m-setup">
      <div class="m-row"><span class="m-label">Your Race</span>${races('player')}</div>
    </div>
    <div class="m-btns">
      <button class="m-btn primary" data-mp="create">🌐&nbsp;&nbsp;Cameră publică</button>
      <button class="m-btn" data-mp="create-private">🔒&nbsp;&nbsp;Cameră privată</button>
    </div>
    <p class="m-hint">Publică apare în lista tuturor · Privată se intră doar cu codul.</p>
    <button class="m-back" data-go="format-mp"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="mp-join">
    <h2 class="m-title">Join a room</h2>
    <div class="m-setup">
      <div class="m-row"><span class="m-label">Your Race</span>${races('player')}</div>
    </div>
    <div id="mp-rooms" class="mp-rooms"></div>
    <button class="m-btn ghost mp-refresh" data-mp="refresh">🔄&nbsp;&nbsp;Reîmprospătează</button>
    <p class="m-hint">Ai un cod de la un prieten? Scrie-l aici:</p>
    <div class="m-row mp-join-row">
      <input id="mp-code" class="mp-code-input" maxlength="4" placeholder="COD" autocomplete="off" spellcheck="false">
      <button class="m-btn" data-mp="join">Intră</button>
    </div>
    <button class="m-back" data-go="format-mp"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden lobby-screen" data-screen="lobby">
    <div class="lb-head">
      <span class="lb-head-t">Cod cameră</span>
      <button id="lb-code" class="lb-code" data-lb="copy" title="Click ca să copiezi codul"></button>
      <span class="lb-head-s">dă-l prietenilor ca să intre</span>
    </div>
    <div id="lb-swap" class="lb-swap hidden"></div>
    <div class="lb-wrap">
      <div id="lb-sides" class="lb-sides"></div>
      <div class="lb-chat">
        <div id="lb-log" class="lb-log"></div>
        <div class="lb-say">
          <input id="lb-input" maxlength="120" placeholder="Scrie un mesaj…" autocomplete="off">
          <button class="m-btn lb-send" data-lb="say">Trimite</button>
        </div>
      </div>
    </div>
    <div class="lb-actions">
      <button class="m-btn lb-ready-btn" id="lb-ready" data-lb="ready">✔&nbsp;&nbsp;Gata</button>
      <button class="m-btn primary lb-start-btn" id="lb-start" data-lb="start">▶&nbsp;&nbsp;START</button>
    </div>
    <p class="m-hint lb-hint" id="lb-hint"></p>
    <button class="m-back" data-mp="cancel"><span class="m-back-txt">◄ Ieși din cameră</span></button>
  </section>

  <section class="m-screen hidden" data-screen="mp-wait">
    <h2 class="m-title" id="mp-wait-title">Se caută adversar…</h2>
    <p class="m-hint" id="mp-wait-sub"></p>
    <div id="mp-wait-code" class="hidden"></div>
    <button class="m-back" data-mp="cancel"><span class="m-back-txt">✖ Anulează</span></button>
  </section>

  <section class="m-screen hidden" data-screen="setup">
    <div id="setup-head" class="setup-head">
      <div class="setup-card"><img class="setup-card-img hidden" alt=""><span class="setup-card-t">1v1</span></div>
      <h2 class="m-title setup-title">1V1</h2>
    </div>
    <div class="m-setup">
      <div class="m-row"><span class="m-label">Your Race</span>${races('player')}</div>
      <div class="m-row"><span class="m-label">AI Race</span>${races('enemy')}</div>
      <div class="m-row"><span class="m-label">Difficulty</span>
        <div class="m-opts" data-opt="difficulty">
          <button class="m-pill" data-diff="easy">Easy</button>
          <button class="m-pill" data-diff="normal">Normal</button>
          <button class="m-pill" data-diff="hard">Hard</button>
        </div></div>
    </div>
    <button class="m-btn primary big play-btn" data-play><span class="m-play-txt">▶&nbsp;&nbsp;Play</span></button>
    <button class="m-back" data-go="format-ai"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="options">
    <h2 class="m-title">OPTIONS</h2>
    <div class="m-setup m-setup-opts">
      <div class="m-row"><span class="m-label">Music</span>
        <input type="range" class="m-range" id="opt-music" min="0" max="100" value="50"></div>
      <div class="m-row"><span class="m-label">Fullscreen</span>
        <div class="m-opts"><button class="corner-btn fs-btn" title="Comută ecran complet" data-opt-fs>⛶</button></div></div>
      <div class="m-row"><span class="m-label">Block the mouse<br><small class="m-sub">Recommended when using two screens</small></span>
        <label class="m-switch"><input type="checkbox" id="opt-capture"><span class="m-slider"></span></label></div>
    </div>
    <button class="m-back" data-go="main"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="help">
    <h2 class="m-title">Cum se joacă</h2>
    <div id="tut-slider" class="hidden">
      <div class="tut-stage">
        <button class="tut-nav prev" data-tut="-1" aria-label="Înapoi">‹</button>
        <div class="tut-frame"><img class="tut-img hidden" alt=""></div>
        <button class="tut-nav next" data-tut="1" aria-label="Înainte">›</button>
      </div>
      <p class="tut-text"></p>
      <div class="tut-dots"></div>
    </div>
    <p class="m-help" id="help-fallback">Construiește-ți baza — <b>ziduri, turnuri, generatoare</b> — în zona de construcție, și <b>formația de armată</b> în banda din față. La fiecare val, toată armata ta reînvie și mărșăluiește spre <b>Baza inamică</b> — distruge-o pe a lui ca să câștigi. <b>Upgrade la Baza principală</b> deblochează tieruri superioare de unități. Generatoarele sunt economia ta — protejează-le!<br><br>
    <b>Cameră:</b> mișcă mouse-ul la margini sau folosește <b>săgeți / WASD</b> · <b>rotița</b> face zoom · <b>Space</b> sare la baza ta · click pe <b>minimap</b>. Cursorul e cel real (fără delay).</p>
    <button class="m-back" data-go="main"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="over">
    <h2 class="m-title" id="over-title">VICTORY</h2>
    <div id="over-stats" class="m-help"></div>
    <div class="m-btns row">
      <button class="m-btn primary" data-play>▶ Rematch</button>
      <button class="m-btn" data-go="main">Meniu</button>
    </div>
  </section>
</div>

<div id="menu-cd" class="hidden"><div class="cd-num">5</div><div class="cd-sub">Pregătește-te de luptă</div></div>

<div id="menu-load" class="hidden">
  <div class="load-brand">
    <img class="menu-logo-img hidden" alt="Fangs & Honor">
    <span class="menu-logo-txt">FANGS &amp; HONOR</span>
  </div>
  <div class="load-bar"><div class="load-fill"></div></div>
  <div class="load-tip"></div>
</div>`;
