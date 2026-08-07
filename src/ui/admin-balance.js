// Admin general-balance UI (loaded only by admin/balance.php). Holds only
// the global rules (starting money, income, wave interval, caps, refunds,
// tier costs). Per-entity stats live behind the ⚙ gears on the sprite
// page. Saves to the server; the game applies assets/balance.json at boot.

import { CONFIG } from '../config.js';
import { GENERAL_FIELDS, TINT_MODES, MIDDLE_KINDS, loadBalance, saveBalance, resetAll, ensureBalanceLoadedUI, currentBalance, importBalance } from './balance.js';

const MIDDLE_KIND_LABELS = {
  none: 'Fără efect',
  moveslow: 'Încetinește mișcarea',
  atkslow: 'Încetinește atacul',
  manaregen: 'Regenerează mana',
};

const TINT_LABELS = {
  team: 'Ale mele albastre / inamic roșu',
  enemy: 'Doar inamicul roșu (culoarea pozei pentru mine)',
  none: 'Fără colorare (culorile pozei)',
};

const app = document.getElementById('bal-app');
const status = document.getElementById('status');

function numField(scope, id, field, label, value) {
  return `<label class="fld"><span>${label}</span>
    <input type="number" step="any" data-scope="${scope}" data-id="${id}" data-field="${field}" value="${value}"></label>`;
}

function render() {
  let html = '';
  html += '<div class="group"><h3>Rules</h3><div class="fields">';
  for (const [f, label] of GENERAL_FIELDS) html += numField('general', '', f, label, CONFIG[f]);
  html += '</div></div>';
  html += '<div class="group"><h3>Tier upgrade costs</h3><div class="fields">';
  html += numField('tier', '2', '', 'Tier 2 cost', CONFIG.TIER_COSTS[2]);
  html += numField('tier', '3', '', 'Tier 3 cost', CONFIG.TIER_COSTS[3]);
  html += '<p style="color:#7c8ba1;font-size:12px;margin:8px 0 0">Timpul de upgrade al bazei (per tier) se setează la fiecare rasă în <a href="./?view=stats" style="color:#4da6ff">⚙ Stats → Bază</a>.</p>';
  html += '</div></div>';
  // middle-of-map terrain effects, one per uploaded strip variant (slots 1-3)
  html += `<div class="group"><h3>Mijloc hartă — efect pe teren</h3>
    <p style="color:#7c8ba1;font-size:12px;margin:0 0 10px">Fiecare variantă de mijloc (1-3, încărcate în <a href="./?view=icons" style="color:#4da6ff">Iconițe</a>) poate da un efect unităților de pe banda din centru. Ordinea = varianta 1/2/3. La fiecare meci se alege una la întâmplare dintre cele încărcate.</p>
    <div class="fields" style="margin-bottom:10px">${numField('middleEmpty', '', '', 'Variante GOALE în tragere (0 = mereu un mijloc)', CONFIG.MIDDLE_EMPTY)}</div>`;
  (CONFIG.MIDDLES || []).forEach((m, i) => {
    const kOpts = MIDDLE_KINDS.map((k) => `<option value="${k}" ${k === m.kind ? 'selected' : ''}>${MIDDLE_KIND_LABELS[k]}</option>`).join('');
    html += `<div class="fields" style="margin-bottom:8px;align-items:center">
      <label class="fld" style="min-width:220px"><span>Varianta ${i + 1} — efect</span>
        <select data-scope="middle" data-id="${i}" data-field="kind" style="width:auto;flex:1">${kOpts}</select></label>
      ${numField('middle', i, 'amount', 'Intensitate (% sau mană/s)', m.amount)}
      ${numField('middle', i, 'band', 'Lățime zonă (± unități)', m.band)}
      <label class="fld"><span>Afectează și zburătorii</span>
        <input type="checkbox" data-scope="middle" data-id="${i}" data-field="air" ${m.air ? 'checked' : ''}></label>
    </div>`;
  });
  html += '</div>';
  // team-coloring mode for uploaded sprites
  const opts = TINT_MODES
    .map((m) => `<option value="${m}" ${m === CONFIG.TEAM_TINT ? 'selected' : ''}>${TINT_LABELS[m]}</option>`)
    .join('');
  html += `<div class="group"><h3>Colorarea echipelor (sprite-uri)</h3>
    <label class="fld" style="width:100%"><span>Mod</span>
      <select data-scope="tint" style="width:auto;flex:1;max-width:340px">${opts}</select></label></div>`;
  // health-bar visibility
  const hbOpts = [['0', 'Doar când sunt lovite (ca acum)'], ['1', 'Mereu vizibile (chiar și full)']]
    .map(([v, l]) => `<option value="${v}" ${(!!CONFIG.HEALTHBAR_ALWAYS === (v === '1')) ? 'selected' : ''}>${l}</option>`)
    .join('');
  html += `<div class="group"><h3>Bare de viață</h3>
    <label class="fld" style="width:100%"><span>Afișare</span>
      <select data-scope="healthbar" style="width:auto;flex:1;max-width:340px">${hbOpts}</select></label></div>`;
  // fog of war
  const fogOpts = [['0', 'Oprit (vezi tot)'], ['1', 'Pornit (ceață clasică — descoperi pe unde treci)']]
    .map(([v, l]) => `<option value="${v}" ${(!!CONFIG.FOG_OF_WAR === (v === '1')) ? 'selected' : ''}>${l}</option>`)
    .join('');
  html += `<div class="group"><h3>Fog of war (ceața războiului)</h3>
    <label class="fld" style="width:100%"><span>Mod</span>
      <select data-scope="fog" style="width:auto;flex:1;max-width:340px">${fogOpts}</select></label></div>`;
  // how units behave when they try to pass one another
  const pmOpts = [['mass', 'Big units push small units'], ['equal', 'All friendly units push the same']]
    .map(([v, l]) => `<option value="${v}" ${((CONFIG.PUSH_MODE || 'mass') === v) ? 'selected' : ''}>${l}</option>`).join('');
  html += `<div class="group"><h3>Împingerea unităților</h3>
    <p style="color:#7c8ba1;font-size:12px;margin:0 0 10px">Cum se comportă unitățile când vor să treacă una de alta.</p>
    <label class="fld" style="width:100%"><span>Mod</span>
      <select data-scope="pushmode" style="width:auto;flex:1;max-width:340px">${pmOpts}</select></label>
    <label class="fld" style="width:100%;margin-top:8px"><span>Blue can't push Red (o unitate de-a mea nu împinge una inamică)</span>
      <input type="checkbox" data-scope="pushcross" ${!CONFIG.PUSH_CROSS_TEAM ? 'checked' : ''}></label>
    <div class="fields" style="margin-top:8px">${numField('pushforce', '', '', 'Push force (cât de tare se împing, ~2.5)', CONFIG.PUSH_FORCE)}</div></div>`;
  // custom HUD gold icon (uploaded here, shown next to the player's gold)
  html += `<div class="group"><h3>Iconiță aur (bara de sus)</h3>
    <p style="color:#7c8ba1;font-size:12px;margin:0 0 10px">Imaginea de lângă aurul tău, sus în HUD. Gol = rombul ◆ implicit. Recomandat: PNG/SVG mic, pătrat (~64px).</p>
    <div class="fields" style="align-items:center;gap:14px">
      <div id="gold-preview" style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:#0d1219;border:1px solid #2a3444;border-radius:8px;font-size:22px;color:#ffd35c"></div>
      <button type="button" id="gold-pick" style="padding:8px 14px;background:#1d2c42;color:#dfe8f4;border:1px solid #33507a;border-radius:8px;cursor:pointer">Alege imagine…</button>
      <button type="button" id="gold-clear" style="padding:8px 14px;background:#26140f;color:#f0d6cc;border:1px solid #5a3a2e;border-radius:8px;cursor:pointer">Fără (◆)</button>
      <input type="file" id="gold-file" accept="image/*" style="display:none">
    </div></div>`;
  // main-menu logo (shown on the entry screen)
  html += `<div class="group"><h3>Logo meniu (ecranul de intrare)</h3>
    <p style="color:#7c8ba1;font-size:12px;margin:0 0 10px">Imaginea mare de pe meniul principal. Gol = numele scris cu text. Recomandat: PNG cu fundal transparent, lat (~1000px).</p>
    <div class="fields" style="align-items:center;gap:14px">
      <div id="logo-preview" style="width:180px;height:80px;display:flex;align-items:center;justify-content:center;background:#0d1219;border:1px solid #2a3444;border-radius:8px;font-size:12px;color:#7c8ba1">gol</div>
      <button type="button" id="logo-pick" style="padding:8px 14px;background:#1d2c42;color:#dfe8f4;border:1px solid #33507a;border-radius:8px;cursor:pointer">Alege imagine…</button>
      <button type="button" id="logo-clear" style="padding:8px 14px;background:#26140f;color:#f0d6cc;border:1px solid #5a3a2e;border-radius:8px;cursor:pointer">Fără (text)</button>
      <input type="file" id="logo-file" accept="image/*" style="display:none">
    </div></div>`;
  // menu & loading-screen cosmetics
  html += `<div class="group"><h3>Meniu & Loading</h3>
    <p style="color:#7c8ba1;font-size:12px;margin:0 0 12px">Fundalul meniului, fundalul ecranului de loading, muzica de meniu și tips-urile de pe loading. Toate se salvează pe loc.</p>
    ${uploaderRow('menubg', 'Fundal meniu', 'imagine lată (~1600px)')}
    ${uploaderRow('menubtn', 'Design buton principal', 'PNG ornat (banner) — Play/Multiplayer/Options/How to play')}
    ${uploaderRow('menucard', 'Design card 1v1/2v2/3v3', 'un singur PNG, folosit la toate trei cardurile')}
    ${uploaderRow('menuback', 'Design buton „Înapoi”', 'PNG pentru butonul de întoarcere')}
    ${uploaderRow('menuslide', 'Design cutie slide (How to play)', 'ramă PNG în jurul imaginii de tutorial')}
    ${uploaderRow('menufs', 'Design buton fullscreen', 'PNG pătrat — colțul din dreapta sus + „Ecran complet”')}
    ${uploaderRow('menulangro', 'Iconiță limbă — Română', 'PNG pătrat — apare pe butonul de limbă cât timp jocul e în română')}
    ${uploaderRow('menulangen', 'Iconiță limbă — English', 'PNG pătrat — apare pe butonul de limbă cât timp jocul e în engleză')}
    ${uploaderRow('menusnd', 'Design buton sonor', 'PNG pătrat — controlul de volum din dreapta jos')}
    ${uploaderRow('menupwf', 'Design „Play with friends”', 'PNG cu textul deja inclus (ecranul Multiplayer)')}
    ${uploaderRow('menuplay', 'Design buton PLAY', 'PNG buton (ecranul de setup) — la dimensiunea imaginii')}
    ${uploaderRow('menusetup', 'Chenar rase / dificultate', 'ramă PNG în jurul zonei de alegere (setup)')}
    ${uploaderRow('menuoptions', 'Chenar Options', 'ramă PNG în jurul controalelor din Options')}
    ${uploaderRow('menuracehum', 'Chenar Humans', 'ramă PNG pentru pastila Humans (setup)')}
    ${uploaderRow('menuraceorc', 'Chenar Orcs', 'ramă PNG pentru pastila Orcs (setup)')}
    ${uploaderRow('menuraceund', 'Chenar Undead', 'ramă PNG pentru pastila Undead (setup)')}
    ${uploaderRow('menuracewe', 'Chenar Wood Elves', 'ramă PNG pentru pastila Wood Elves (setup)')}
    ${uploaderRow('loadingbg0', 'Fundal loading 1', 'variantă aleasă la întâmplare')}
    ${uploaderRow('loadingbg1', 'Fundal loading 2', 'variantă aleasă la întâmplare')}
    ${uploaderRow('loadingbg2', 'Fundal loading 3', 'variantă aleasă la întâmplare')}
    ${uploaderRow('menumusic0', 'Muzică meniu 1', 'audio (mp3/ogg), se repetă', 'audio', 0)}
    ${uploaderRow('menumusic1', 'Muzică meniu 2', 'audio (mp3/ogg) — schimbi din meniu cu săgețile', 'audio', 1)}
    ${uploaderRow('menumusic2', 'Muzică meniu 3', 'audio (mp3/ogg) — opțional', 'audio', 2)}
    ${uploaderRow('menumusic3', 'Muzică meniu 4', 'audio (mp3/ogg) — opțional', 'audio', 3)}
    ${uploaderRow('menumusic4', 'Muzică meniu 5', 'audio (mp3/ogg) — opțional', 'audio', 4)}
    ${uploaderRow('menumusicprev', 'Design săgeată „‹” (melodia anterioară)', 'PNG pătrat — apare în meniu la 2+ melodii')}
    ${uploaderRow('menumusicnext', 'Design săgeată „›” (melodia următoare)', 'PNG pătrat — apare în meniu la 2+ melodii')}
    <div class="fields" style="margin:-4px 0 8px"><label class="fld"><span>Volum start muzică meniu (0-100)</span>
      <input type="number" min="0" max="100" step="1" data-scope="menumusicvol" value="${CONFIG.MENU_MUSIC_VOL}" style="width:auto;flex:1;max-width:120px"></label></div>
    <div style="margin-top:8px">
      <div style="color:#b9c4d4;font-size:13px;margin-bottom:6px">Tips loading <span style="color:#7c8ba1">— un tip pe linie; gol = cele implicite</span></div>
      <textarea id="tips-area" rows="5" style="width:100%;background:#0a0e14;color:#dbe4f0;border:1px solid #2a3446;border-radius:8px;padding:8px 10px;font:13px/1.5 system-ui;resize:vertical" placeholder="Generatoarele sunt economia ta — protejează-le.&#10;Upgrade la Bază deblochează tieruri superioare."></textarea>
    </div></div>`;
  // "How to play" tutorial slider — a list of image + description slides
  html += `<div class="group"><h3>Tutoriale (How to play)</h3>
    <p style="color:#7c8ba1;font-size:12px;margin:0 0 12px">Slide-urile din sliderul „How to play” din meniu. Fiecare slide = o imagine + o descriere sub ea. Ordinea de aici e ordinea din slider. Gol = textul implicit „Cum se joacă”.</p>
    <div id="tut-list"></div>
    <button type="button" id="tut-add" style="margin-top:6px;padding:9px 16px;background:#123020;color:#cdeede;border:1px solid #2e6a44;border-radius:8px;cursor:pointer">➕ Adaugă slide</button>
    </div>`;
  html += '<p style="color:#7c8ba1;font-size:12px;margin-top:8px">Statisticile fiecărei unități/clădiri (nume, dimensiune, footprint, HP-ul bazei, turnul inițial) se editează cu <b>⚙ stats</b> în pagina de <a href="./" style="color:#4da6ff">sprites</a>.</p>';
  app.innerHTML = html;
  wireGoldIcon();
  wireMenuLogo();
  wireAsset('MENU_BG', 'menubg', 'image', 3 * 1024 * 1024);
  wireAsset('MENU_BTN', 'menubtn', 'image', 2 * 1024 * 1024);
  wireAsset('MENU_CARD', 'menucard', 'image', 2 * 1024 * 1024);
  wireAsset('MENU_BACK', 'menuback', 'image', 2 * 1024 * 1024);
  wireAsset('MENU_SLIDE_FRAME', 'menuslide', 'image', 3 * 1024 * 1024);
  wireAsset('MENU_FS_BTN', 'menufs', 'image', 1 * 1024 * 1024);
  wireAsset('MENU_LANG_RO', 'menulangro', 'image', 1 * 1024 * 1024);
  wireAsset('MENU_LANG_EN', 'menulangen', 'image', 1 * 1024 * 1024);
  wireAsset('MENU_SOUND_BTN', 'menusnd', 'image', 1 * 1024 * 1024);
  wireAsset('MENU_PWF', 'menupwf', 'image', 2 * 1024 * 1024);
  wireAsset('MENU_PLAY', 'menuplay', 'image', 2 * 1024 * 1024);
  wireAsset('MENU_SETUP_FRAME', 'menusetup', 'image', 3 * 1024 * 1024);
  wireAsset('MENU_OPTIONS_FRAME', 'menuoptions', 'image', 3 * 1024 * 1024);
  wireAsset('MENU_RACE_HUMANS', 'menuracehum', 'image', 2 * 1024 * 1024);
  wireAsset('MENU_RACE_ORCS', 'menuraceorc', 'image', 2 * 1024 * 1024);
  wireAsset('MENU_RACE_UNDEAD', 'menuraceund', 'image', 2 * 1024 * 1024);
  wireAsset('MENU_RACE_WOODELVES', 'menuracewe', 'image', 2 * 1024 * 1024);
  wireAsset('LOADING_BGS', 'loadingbg0', 'image', 3 * 1024 * 1024, 0);
  wireAsset('LOADING_BGS', 'loadingbg1', 'image', 3 * 1024 * 1024, 1);
  wireAsset('LOADING_BGS', 'loadingbg2', 'image', 3 * 1024 * 1024, 2);
  for (let i = 0; i < 5; i++) {
    wireAsset('MENU_MUSICS', `menumusic${i}`, 'audio', 6 * 1024 * 1024, i);
    wireTrackName(`menumusic${i}`, i);
  }
  wireAsset('MENU_MUSIC_PREV', 'menumusicprev', 'image', 1 * 1024 * 1024);
  wireAsset('MENU_MUSIC_NEXT', 'menumusicnext', 'image', 1 * 1024 * 1024);
  wireTips();
  renderTutorials();
}

// ---- Tutorial slides (image + description) for the "How to play" slider ----
const TUT_IMG_MAX = 2 * 1024 * 1024;
function tutList() { if (!Array.isArray(CONFIG.TUTORIALS)) CONFIG.TUTORIALS = []; return CONFIG.TUTORIALS; }
function renderTutorials() {
  const wrap = document.getElementById('tut-list');
  if (!wrap) return;
  const list = tutList();
  if (!list.length) {
    wrap.innerHTML = '<div style="color:#7c8ba1;font-size:12px;margin-bottom:8px">Niciun slide — sliderul arată textul implicit. Apasă „Adaugă slide”.</div>';
  } else {
    wrap.innerHTML = list.map((t, i) => `
      <div class="tut-row" data-i="${i}" style="display:flex;gap:12px;align-items:flex-start;background:#0d1219;border:1px solid #2a3444;border-radius:10px;padding:10px;margin-bottom:10px">
        <div style="display:flex;flex-direction:column;gap:6px;align-items:center">
          <div id="tutimg-${i}" style="width:120px;height:78px;display:flex;align-items:center;justify-content:center;background:#070b11;border:1px solid #2a3444;border-radius:8px;font-size:11px;color:#7c8ba1;overflow:hidden">gol</div>
          <button type="button" class="tut-pick" data-i="${i}" style="padding:6px 10px;background:#1d2c42;color:#dfe8f4;border:1px solid #33507a;border-radius:8px;cursor:pointer;font-size:12px">Imagine…</button>
          <input type="file" class="tut-file" data-i="${i}" accept="image/*" style="display:none">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <textarea class="tut-text" data-i="${i}" rows="3" placeholder="Descriere pentru acest slide…" style="width:100%;background:#0a0e14;color:#dbe4f0;border:1px solid #2a3446;border-radius:8px;padding:8px 10px;font:13px/1.5 system-ui;resize:vertical"></textarea>
          <div style="display:flex;gap:6px;justify-content:flex-end">
            <button type="button" class="tut-up" data-i="${i}" title="Mută sus" style="padding:5px 10px;background:#1a2333;color:#cfe0f5;border:1px solid #33507a;border-radius:7px;cursor:pointer">▲</button>
            <button type="button" class="tut-down" data-i="${i}" title="Mută jos" style="padding:5px 10px;background:#1a2333;color:#cfe0f5;border:1px solid #33507a;border-radius:7px;cursor:pointer">▼</button>
            <button type="button" class="tut-del" data-i="${i}" style="padding:5px 12px;background:#26140f;color:#f0d6cc;border:1px solid #5a3a2e;border-radius:7px;cursor:pointer">Șterge</button>
          </div>
        </div>
      </div>`).join('');
    list.forEach((t, i) => {
      const box = document.getElementById(`tutimg-${i}`);
      if (box) tutImgPreview(box, t.img);
      const ta = wrap.querySelector(`textarea.tut-text[data-i="${i}"]`);
      if (ta) ta.value = t.text || '';
    });
  }
  wireTutorials(wrap);
}
function tutImgPreview(box, url) {
  box.textContent = '';
  if (!url) { box.textContent = 'gol'; return; }
  const img = document.createElement('img');
  img.src = url; img.style.maxWidth = '100%'; img.style.maxHeight = '100%'; img.style.objectFit = 'cover';
  box.appendChild(img);
}
function wireTutorials(wrap) {
  const add = document.getElementById('tut-add');
  if (add && !add.dataset.wired) {
    add.dataset.wired = '1';
    add.addEventListener('click', () => { tutList().push({ img: '', text: '' }); renderTutorials(); });
  }
  const list = tutList();
  wrap.querySelectorAll('.tut-pick').forEach((b) => b.addEventListener('click', () => {
    const f = wrap.querySelector(`input.tut-file[data-i="${b.dataset.i}"]`);
    if (f) f.click();
  }));
  wrap.querySelectorAll('.tut-file').forEach((inp) => inp.addEventListener('change', () => {
    const i = Number(inp.dataset.i);
    const f = inp.files && inp.files[0];
    if (!f) return;
    if (f.size > TUT_IMG_MAX) { setStatus(`Imaginea e prea mare (max ~${Math.round(TUT_IMG_MAX / 1048576)}MB).`, 'bad'); inp.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => {
      if (list[i]) list[i].img = String(rd.result || '');
      const box = document.getElementById(`tutimg-${i}`);
      if (box) tutImgPreview(box, list[i].img);
      autoSaveGoldIcon(`Slide ${i + 1} — imagine setată`);
    };
    rd.readAsDataURL(f); inp.value = '';
  }));
  wrap.querySelectorAll('.tut-text').forEach((ta) => ta.addEventListener('change', () => {
    const i = Number(ta.dataset.i);
    if (list[i]) list[i].text = ta.value.slice(0, 600);
    autoSaveGoldIcon(`Slide ${i + 1} — text salvat`);
  }));
  wrap.querySelectorAll('.tut-del').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    list.splice(i, 1); renderTutorials(); autoSaveGoldIcon('Slide șters');
  }));
  wrap.querySelectorAll('.tut-up').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; renderTutorials(); autoSaveGoldIcon('Ordine actualizată'); }
  }));
  wrap.querySelectorAll('.tut-down').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; renderTutorials(); autoSaveGoldIcon('Ordine actualizată'); }
  }));
}

// build one uploader row (image or audio) for the Meniu & Loading group
function uploaderRow(slug, label, hint, kind = 'image', nameIdx = null) {
  const box = kind === 'audio' ? 'width:120px;height:44px' : 'width:120px;height:64px';
  return `<div style="margin-bottom:12px">
    <div style="color:#b9c4d4;font-size:13px;margin-bottom:6px">${label} <span style="color:#7c8ba1">— ${hint}</span></div>
    <div class="fields" style="align-items:center;gap:14px">
      <div id="${slug}-preview" style="${box};display:flex;align-items:center;justify-content:center;background:#0d1219;border:1px solid #2a3444;border-radius:8px;font-size:12px;color:#7c8ba1;overflow:hidden">gol</div>
      <button type="button" id="${slug}-pick" style="padding:8px 14px;background:#1d2c42;color:#dfe8f4;border:1px solid #33507a;border-radius:8px;cursor:pointer">Alege…</button>
      <button type="button" id="${slug}-clear" style="padding:8px 14px;background:#26140f;color:#f0d6cc;border:1px solid #5a3a2e;border-radius:8px;cursor:pointer">Fără</button>
      <input type="file" id="${slug}-file" accept="${kind === 'audio' ? 'audio/*' : 'image/*'}" style="display:none">
      ${nameIdx == null ? '' : `<label class="fld" style="flex:1;min-width:200px"><span>Numele melodiei (apare în meniu)</span>
        <input type="text" id="${slug}-name" maxlength="48" placeholder="ex. Marșul Hoardei"></label>`}
    </div></div>`;
}
// read/write a config asset — a plain string key, or one slot of an array key
function getAsset(key, index) { return index == null ? CONFIG[key] : (CONFIG[key] || [])[index]; }
function setAsset(key, index, val) {
  if (index == null) { CONFIG[key] = val; return; }
  if (!Array.isArray(CONFIG[key])) CONFIG[key] = [];
  CONFIG[key][index] = val;
}
function assetPreview(el, key, kind, index) {
  el.textContent = '';
  const val = getAsset(key, index);
  if (!val) { el.textContent = 'gol'; return; }
  if (kind === 'audio') { el.textContent = '🎵 setat'; return; }
  const img = document.createElement('img');
  img.src = val; img.style.maxWidth = '100%'; img.style.maxHeight = '100%'; img.style.objectFit = 'cover';
  el.appendChild(img);
}
function wireAsset(key, slug, kind, max, index = null) {
  const pick = document.getElementById(slug + '-pick');
  const file = document.getElementById(slug + '-file');
  const clear = document.getElementById(slug + '-clear');
  const prev = document.getElementById(slug + '-preview');
  if (!pick || !file || !clear || !prev) return;
  assetPreview(prev, key, kind, index);
  pick.addEventListener('click', () => file.click());
  clear.addEventListener('click', () => { setAsset(key, index, ''); assetPreview(prev, key, kind, index); autoSaveGoldIcon(`${slug} eliminat`); });
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > max) { setStatus(`Fișier prea mare (max ~${Math.round(max / 1048576)}MB).`, 'bad'); file.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => { setAsset(key, index, String(rd.result || '')); assetPreview(prev, key, kind, index); autoSaveGoldIcon(`${slug} setat`); };
    rd.readAsDataURL(f); file.value = '';
  });
}
// The display name of one playlist slot — shown over the menu's music controls.
function wireTrackName(slug, index) {
  const el = document.getElementById(`${slug}-name`);
  if (!el) return;
  if (!Array.isArray(CONFIG.MENU_MUSIC_NAMES)) CONFIG.MENU_MUSIC_NAMES = [];
  el.value = CONFIG.MENU_MUSIC_NAMES[index] || '';
  el.addEventListener('change', () => {
    if (!Array.isArray(CONFIG.MENU_MUSIC_NAMES)) CONFIG.MENU_MUSIC_NAMES = [];
    CONFIG.MENU_MUSIC_NAMES[index] = el.value.trim().slice(0, 48);
    autoSaveGoldIcon('Nume melodie salvat');
  });
}

function wireTips() {
  const ta = document.getElementById('tips-area');
  if (!ta) return;
  ta.value = (CONFIG.LOADING_TIPS || []).join('\n');
  ta.addEventListener('change', () => {
    CONFIG.LOADING_TIPS = ta.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 40);
    autoSaveGoldIcon('Tips salvate');
  });
}

// main-menu logo controls (auto-saves like the gold icon)
function updateLogoPreview() {
  const p = document.getElementById('logo-preview');
  if (!p) return;
  p.textContent = '';
  if (CONFIG.MENU_LOGO) {
    const img = document.createElement('img');
    img.src = CONFIG.MENU_LOGO;
    img.style.maxWidth = '100%'; img.style.maxHeight = '100%'; img.style.objectFit = 'contain';
    p.appendChild(img);
  } else p.textContent = 'gol';
}
function wireMenuLogo() {
  const pick = document.getElementById('logo-pick');
  const clear = document.getElementById('logo-clear');
  const file = document.getElementById('logo-file');
  if (!pick || !file || !clear) return;
  updateLogoPreview();
  pick.addEventListener('click', () => file.click());
  clear.addEventListener('click', () => { CONFIG.MENU_LOGO = ''; updateLogoPreview(); autoSaveGoldIcon('Logo meniu eliminat'); });
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setStatus('Imaginea e prea mare (max ~2MB).', 'bad'); file.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => { CONFIG.MENU_LOGO = String(rd.result || ''); updateLogoPreview(); autoSaveGoldIcon('Logo meniu setat'); };
    rd.readAsDataURL(f);
    file.value = '';
  });
}

// gold-icon controls (re-wired after every render since app.innerHTML resets)
function updateGoldPreview() {
  const p = document.getElementById('gold-preview');
  if (!p) return;
  p.textContent = '';
  if (CONFIG.GOLD_ICON) {
    const img = document.createElement('img');
    img.src = CONFIG.GOLD_ICON;
    img.style.maxWidth = '100%'; img.style.maxHeight = '100%'; img.style.objectFit = 'contain';
    p.appendChild(img);
  } else p.textContent = '◆';
}
function wireGoldIcon() {
  const pick = document.getElementById('gold-pick');
  const clear = document.getElementById('gold-clear');
  const file = document.getElementById('gold-file');
  if (!pick || !file || !clear) return;
  updateGoldPreview();
  pick.addEventListener('click', () => file.click());
  clear.addEventListener('click', () => { CONFIG.GOLD_ICON = ''; updateGoldPreview(); autoSaveGoldIcon('Iconiță aur eliminată'); });
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > 512 * 1024) { setStatus('Imaginea e prea mare (max ~500KB).', 'bad'); file.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => {
      CONFIG.GOLD_ICON = String(rd.result || '');
      updateGoldPreview();
      autoSaveGoldIcon('Iconiță aur setată');
    };
    rd.readAsDataURL(f);
    file.value = '';
  });
}

// The gold icon has no obvious Save nearby, so persist it to the server right
// away (also folds in any other pending edits, exactly like the Save button).
async function autoSaveGoldIcon(what) {
  collect();
  setStatus(`${what} — se salvează…`);
  const res = await saveBalance('save-balance.php');
  if (res === 'ok') setStatus(`${what} ✓ (activ după reîncărcarea jocului)`, 'ok');
  else if (res === 'auth') setStatus('Sesiune expirată — reloghează-te în /admin', 'bad');
  else setStatus('Salvare eșuată — probabil imaginile sunt prea mari pentru server (încearcă poze mai mici).', 'bad');
}

// Write the general/tier inputs back into CONFIG (this page only holds
// general rules; per-entity stats are edited via gears on the sprite page).
function collect() {
  for (const el of app.querySelectorAll('[data-scope]')) {
    const { scope, id, field } = el.dataset;
    if (scope === 'tint') { CONFIG.TEAM_TINT = el.value; continue; }
    if (scope === 'healthbar') { CONFIG.HEALTHBAR_ALWAYS = el.value === '1'; continue; }
    if (scope === 'fog') { CONFIG.FOG_OF_WAR = el.value === '1'; continue; }
    if (scope === 'pushmode') { CONFIG.PUSH_MODE = el.value === 'equal' ? 'equal' : 'mass'; continue; }
    if (scope === 'pushcross') { CONFIG.PUSH_CROSS_TEAM = !el.checked; continue; } // checkbox = "Blue can't push Red"
    if (scope === 'pushforce') { const v = Number(el.value); if (isFinite(v)) CONFIG.PUSH_FORCE = Math.max(0.2, v); continue; }
    if (scope === 'menumusicvol') { const v = Number(el.value); if (isFinite(v)) CONFIG.MENU_MUSIC_VOL = Math.max(0, Math.min(100, Math.round(v))); continue; }
    if (scope === 'middleEmpty') { if (isFinite(Number(el.value))) CONFIG.MIDDLE_EMPTY = Math.max(0, Math.round(Number(el.value))); continue; }
    if (scope === 'middle') {
      const m = CONFIG.MIDDLES[Number(id)];
      if (!m) continue;
      if (field === 'kind') m.kind = el.value;
      else if (field === 'air') m.air = el.checked;
      else if (isFinite(Number(el.value))) m[field] = Number(el.value);
      continue;
    }
    const raw = Number(el.value);
    if (!isFinite(raw)) continue;
    if (scope === 'general') CONFIG[field] = raw;
    else if (scope === 'tier') CONFIG.TIER_COSTS[Number(id)] = raw;
  }
}

function setStatus(msg, cls = '') {
  status.textContent = msg;
  status.className = cls;
}

document.getElementById('save-btn').addEventListener('click', async () => {
  collect();
  setStatus('Se salvează…');
  const res = await saveBalance('save-balance.php');
  if (res === 'ok') setStatus('Salvat ✓ (activ la următoarea pornire a jocului)', 'ok');
  else if (res === 'auth') setStatus('Sesiune expirată — reloghează-te în /admin', 'bad');
  else setStatus('Salvare eșuată — verifică serverul', 'bad');
});

// Auto-save Rules & every other Balance field the moment it changes, so nothing
// is ever lost by forgetting to press Salvează (the image uploaders already
// auto-save). Debounced so committing several fields in a row sends one save.
let autoSaveTimer = 0;
app.addEventListener('change', (e) => {
  const el = e.target;
  if (!el || !el.matches || !el.matches('[data-scope]')) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => autoSaveGoldIcon('Setare salvată'), 350);
});

document.getElementById('reset-btn').addEventListener('click', () => {
  resetAll();
  render();
  setStatus('Resetat la valorile din cod (apasă Salvează ca să publici).');
});

// ---- Import / Export whole balance.json (apply a full rework in one shot) ----
const ioStatus = document.getElementById('io-status');
function setIo(msg, color = '#7c8ba1') { if (ioStatus) { ioStatus.textContent = msg; ioStatus.style.color = color; } }

const exportBtn = document.getElementById('export-btn');
if (exportBtn) exportBtn.addEventListener('click', () => {
  try {
    const blob = new Blob([JSON.stringify(currentBalance(), null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'balance.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setIo('Exportat ✓ (balance.json descărcat)', '#58d68d');
  } catch (e) { setIo('Export eșuat: ' + e.message, '#ff8090'); }
});

const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');
if (importBtn && importFile) {
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    setIo('Se citește fișierul…');
    try {
      const text = (await file.text()).replace(/^﻿/, '').trim();
      const data = JSON.parse(text);
      importBalance(data);        // apply + seed cache + clear the load-failed guard
      render();                   // reflect imported general rules in the editor
      setIo('Se salvează pe server…');
      const res = await saveBalance('save-balance.php');
      if (res === 'ok') setIo('Import + salvare ✓ — activ la următoarea pornire a jocului', '#58d68d');
      else if (res === 'auth') setIo('Aplicat local, dar sesiunea a expirat — reloghează-te în /admin și apasă Salvează', '#ff8090');
      else setIo('Aplicat local, dar salvarea a eșuat — verifică serverul și apasă Salvează', '#ff8090');
    } catch (e) {
      setIo('Fișier invalid (nu e un balance.json bun): ' + e.message, '#ff8090');
    } finally {
      importFile.value = ''; // allow re-importing the same file
    }
  });
}

// apply any previously saved overrides, then render current values
loadBalance('../assets/').then(() => { if (ensureBalanceLoadedUI()) render(); });
