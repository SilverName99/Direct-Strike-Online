// Entry menu: main → format (1v1 live, 2v2/3v3 + multiplayer locked) → match
// setup (races + difficulty) → 5s countdown → loading screen → the match.
// Owns the #overlay element (main menu AND the game-over screen).

import { CONFIG } from '../config.js';

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
    this.build();
  }

  build() {
    this.el.innerHTML = TEMPLATE;
    this.bg = this.el.querySelector('#menu-bg');
    this.root = this.el.querySelector('#menu-root');
    this.cd = this.el.querySelector('#menu-cd');
    this.load = this.el.querySelector('#menu-load');
    this.music = null;
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.applyTheme();
    this.reflect();
    this.go('main');
  }

  onInput(e) {
    if (e.target && (e.target.id === 'opt-music' || e.target.id === 'snd-range')) this.setMusicVol(Number(e.target.value) / 100);
  }

  onClick(e) {
    this.ensureMusic(); // first click unlocks + starts the menu music
    const t = e.target.closest('[data-go],[data-fmt],[data-race],[data-diff],[data-play],[data-tut],[data-tutgo],[data-opt-fs],[data-snd]');
    if (!t || t.disabled) return;
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
    this.cd.classList.add('hidden');
    this.load.classList.add('hidden');
    this.root.classList.remove('hidden');
    if (name === 'help') this.renderHelp();
    if (name === 'options') this.syncOptions();
  }

  // reflect current settings in the Options screen
  syncOptions() {
    const m = this.el.querySelector('#opt-music');
    if (m) m.value = String(Math.round(this.musicVol * 100));
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
    ];
    for (const [key, cls, varName] of skins) {
      const url = CONFIG[key] || '';
      this.root.classList.toggle(cls, !!url);
      this.root.style.setProperty(varName, url ? `url("${url}")` : 'none');
    }
    // corner buttons show a glyph only when they have no uploaded skin
    const fsBtn = this.el.querySelector('#menu-fs-corner');
    if (fsBtn) fsBtn.textContent = CONFIG.MENU_FS_BTN ? '' : '⛶';
    for (const b of this.el.querySelectorAll('.fs-btn')) if (b !== fsBtn) b.textContent = CONFIG.MENU_FS_BTN ? '' : '⛶';
    const sndBtn = this.el.querySelector('#snd-btn');
    if (sndBtn) sndBtn.textContent = CONFIG.MENU_SOUND_BTN ? '' : (this.musicVol === 0 ? '🔇' : '🔊');
  }

  // logo + admin-uploaded backgrounds (menu / loading). Called once balance loads.
  applyTheme() {
    this.applyLogo();
    this.applyButtons();
    const mb = CONFIG.MENU_BG || '';
    if (this.bg) { this.bg.style.backgroundImage = mb ? `url("${mb}")` : ''; this.bg.classList.toggle('on', !!mb); }
    this.setLoadingBg(this.firstLoadingBg()); // a static default until play() rolls one
  }

  loadingVariants() { return (CONFIG.LOADING_BGS || []).filter(Boolean); }
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

  // Preload the menu music during boot (buffer it, don't play yet — autoplay
  // needs a user gesture). Resolves once enough is loaded, or on timeout so the
  // boot loader never hangs.
  preloadMusic(timeoutMs = 3500) {
    if (!CONFIG.MENU_MUSIC) return Promise.resolve();
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
      el.src = CONFIG.MENU_MUSIC;
    });
  }
  ensureMusic() {
    if (!CONFIG.MENU_MUSIC) return;
    if (!this.music) { // no preload ran (e.g. music set after boot)
      try { this.music = new Audio(CONFIG.MENU_MUSIC); this.music.loop = true; this.music.volume = this.musicVol; }
      catch { this.music = null; return; }
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
    if (!CONFIG.MENU_MUSIC) return;
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

  // Play → fullscreen (in the click gesture) → 5s countdown → loading → match
  play() {
    this.clearTimers();
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
    fill.style.width = '100%';
    this.later(() => {
      if (this.hooks.onStart) this.hooks.onStart({ ...this.sel });
      this.hide();
    }, 1550);
  }

  // tiny non-seeded shuffle just for picking a tip (UI only, never the sim)
  mix() { this._m = ((this._m || Date.now()) * 1103515245 + 12345) & 0x7fffffff; return this._m / 0x7fffffff; }

  show() { this.clearTimers(); this.go('main'); this.el.classList.add('visible'); this.armMusic(); }
  hide() { this.clearTimers(); this.stopMusic(); this.el.classList.remove('visible'); }

  showGameOver(game, playerWon) {
    this.clearTimers();
    const t = this.el.querySelector('#over-title');
    t.textContent = playerWon ? 'VICTORY' : 'DEFEAT';
    t.className = 'm-title ' + (playerWon ? 'victory' : 'defeat');
    this.el.querySelector('#over-stats').innerHTML =
      `Valuri: <b>${game.waveCount}</b> · Aur cheltuit: <b>${game.spent[0]}</b> · ` +
      `Tier atins: <b>${'I'.repeat(game.tier[0])}</b>`;
    this.go('over');
    this.el.classList.add('visible');
  }
}

const races = (opt) => `
  <div class="m-opts" data-opt="${opt}">
    <button class="m-pill" data-race="humans">⚔ Humans</button>
    <button class="m-pill" data-race="orcs">🪓 Orcs</button>
  </div>`;

const TEMPLATE = `
<div id="menu-bg"></div>
<div id="menu-root">
  <div class="menu-brand">
    <img class="menu-logo-img hidden" alt="Fangs & Honor">
    <h1 class="menu-logo-txt">FANGS <span class="amp">&amp;</span> HONOR</h1>
  </div>

  <button id="menu-fs-corner" class="corner-btn fs-btn" title="Ecran complet" data-opt-fs>⛶</button>
  <div id="menu-sound">
    <button id="snd-btn" class="corner-btn snd-btn" title="Volum muzică (click = mute)" data-snd>🔊</button>
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
    <p class="m-hint">Alege formatul</p>
    <div class="m-cards">
      <button class="m-card" data-fmt="1v1"><span class="m-card-t">1v1</span><span class="m-card-s">Tu vs AI</span></button>
      <button class="m-card locked" disabled><span class="m-card-t">2v2</span><span class="soon">Coming soon</span></button>
      <button class="m-card locked" disabled><span class="m-card-t">3v3</span><span class="soon">Coming soon</span></button>
    </div>
    <button class="m-back" data-go="main"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="format-mp">
    <h2 class="m-title">Multiplayer</h2>
    <p class="m-hint">Jocul online e pe drum</p>
    <div class="m-cards">
      <button class="m-card locked" disabled><span class="m-card-t">1v1</span><span class="soon">Coming soon</span></button>
      <button class="m-card locked" disabled><span class="m-card-t">2v2</span><span class="soon">Coming soon</span></button>
      <button class="m-card locked" disabled><span class="m-card-t">3v3</span><span class="soon">Coming soon</span></button>
      <button class="m-card locked wide pwf-card" disabled><span class="m-card-t">👥 Play with friends</span><span class="soon">Coming soon</span></button>
    </div>
    <button class="m-back" data-go="main"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="setup">
    <h2 class="m-title">1v1 · vs AI</h2>
    <div class="m-setup">
      <div class="m-row"><span class="m-label">Rasa ta</span>${races('player')}</div>
      <div class="m-row"><span class="m-label">Rasa inamicului</span>${races('enemy')}</div>
      <div class="m-row"><span class="m-label">Dificultate</span>
        <div class="m-opts" data-opt="difficulty">
          <button class="m-pill" data-diff="easy">Easy</button>
          <button class="m-pill" data-diff="normal">Normal</button>
          <button class="m-pill" data-diff="hard">Hard</button>
        </div></div>
    </div>
    <button class="m-btn primary big" data-play>▶&nbsp;&nbsp;Play</button>
    <button class="m-back" data-go="format-ai"><span class="m-back-txt">◄ Înapoi</span></button>
  </section>

  <section class="m-screen hidden" data-screen="options">
    <h2 class="m-title">Opțiuni</h2>
    <div class="m-setup">
      <div class="m-row"><span class="m-label">Muzică</span>
        <input type="range" class="m-range" id="opt-music" min="0" max="100" value="50"></div>
      <div class="m-row"><span class="m-label">Ecran complet</span>
        <div class="m-opts"><button class="corner-btn fs-btn" title="Comută ecran complet" data-opt-fs>⛶</button></div></div>
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
