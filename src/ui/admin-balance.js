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
    ${uploaderRow('loadingbg', 'Fundal loading', 'imagine lată (~1600px)')}
    ${uploaderRow('menumusic', 'Muzică meniu', 'audio (mp3/ogg), se repetă', 'audio')}
    <div style="margin-top:8px">
      <div style="color:#b9c4d4;font-size:13px;margin-bottom:6px">Tips loading <span style="color:#7c8ba1">— un tip pe linie; gol = cele implicite</span></div>
      <textarea id="tips-area" rows="5" style="width:100%;background:#0a0e14;color:#dbe4f0;border:1px solid #2a3446;border-radius:8px;padding:8px 10px;font:13px/1.5 system-ui;resize:vertical" placeholder="Generatoarele sunt economia ta — protejează-le.&#10;Upgrade la Bază deblochează tieruri superioare."></textarea>
    </div></div>`;
  html += '<p style="color:#7c8ba1;font-size:12px;margin-top:8px">Statisticile fiecărei unități/clădiri (nume, dimensiune, footprint, HP-ul bazei, turnul inițial) se editează cu <b>⚙ stats</b> în pagina de <a href="./" style="color:#4da6ff">sprites</a>.</p>';
  app.innerHTML = html;
  wireGoldIcon();
  wireMenuLogo();
  wireAsset('MENU_BG', 'menubg', 'image', 3 * 1024 * 1024);
  wireAsset('LOADING_BG', 'loadingbg', 'image', 3 * 1024 * 1024);
  wireAsset('MENU_MUSIC', 'menumusic', 'audio', 6 * 1024 * 1024);
  wireTips();
}

// build one uploader row (image or audio) for the Meniu & Loading group
function uploaderRow(slug, label, hint, kind = 'image') {
  const box = kind === 'audio' ? 'width:120px;height:44px' : 'width:120px;height:64px';
  return `<div style="margin-bottom:12px">
    <div style="color:#b9c4d4;font-size:13px;margin-bottom:6px">${label} <span style="color:#7c8ba1">— ${hint}</span></div>
    <div class="fields" style="align-items:center;gap:14px">
      <div id="${slug}-preview" style="${box};display:flex;align-items:center;justify-content:center;background:#0d1219;border:1px solid #2a3444;border-radius:8px;font-size:12px;color:#7c8ba1;overflow:hidden">gol</div>
      <button type="button" id="${slug}-pick" style="padding:8px 14px;background:#1d2c42;color:#dfe8f4;border:1px solid #33507a;border-radius:8px;cursor:pointer">Alege…</button>
      <button type="button" id="${slug}-clear" style="padding:8px 14px;background:#26140f;color:#f0d6cc;border:1px solid #5a3a2e;border-radius:8px;cursor:pointer">Fără</button>
      <input type="file" id="${slug}-file" accept="${kind === 'audio' ? 'audio/*' : 'image/*'}" style="display:none">
    </div></div>`;
}
function assetPreview(el, key, kind) {
  el.textContent = '';
  if (!CONFIG[key]) { el.textContent = 'gol'; return; }
  if (kind === 'audio') { el.textContent = '🎵 setat'; return; }
  const img = document.createElement('img');
  img.src = CONFIG[key]; img.style.maxWidth = '100%'; img.style.maxHeight = '100%'; img.style.objectFit = 'cover';
  el.appendChild(img);
}
function wireAsset(key, slug, kind, max) {
  const pick = document.getElementById(slug + '-pick');
  const file = document.getElementById(slug + '-file');
  const clear = document.getElementById(slug + '-clear');
  const prev = document.getElementById(slug + '-preview');
  if (!pick || !file || !clear || !prev) return;
  assetPreview(prev, key, kind);
  pick.addEventListener('click', () => file.click());
  clear.addEventListener('click', () => { CONFIG[key] = ''; assetPreview(prev, key, kind); autoSaveGoldIcon(`${key} eliminat`); });
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > max) { setStatus(`Fișier prea mare (max ~${Math.round(max / 1048576)}MB).`, 'bad'); file.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => { CONFIG[key] = String(rd.result || ''); assetPreview(prev, key, kind); autoSaveGoldIcon(`${key} setat`); };
    rd.readAsDataURL(f); file.value = '';
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
  else setStatus('Salvare eșuată — verifică serverul', 'bad');
}

// Write the general/tier inputs back into CONFIG (this page only holds
// general rules; per-entity stats are edited via gears on the sprite page).
function collect() {
  for (const el of app.querySelectorAll('[data-scope]')) {
    const { scope, id, field } = el.dataset;
    if (scope === 'tint') { CONFIG.TEAM_TINT = el.value; continue; }
    if (scope === 'healthbar') { CONFIG.HEALTHBAR_ALWAYS = el.value === '1'; continue; }
    if (scope === 'pushmode') { CONFIG.PUSH_MODE = el.value === 'equal' ? 'equal' : 'mass'; continue; }
    if (scope === 'pushcross') { CONFIG.PUSH_CROSS_TEAM = !el.checked; continue; } // checkbox = "Blue can't push Red"
    if (scope === 'pushforce') { const v = Number(el.value); if (isFinite(v)) CONFIG.PUSH_FORCE = Math.max(0.2, v); continue; }
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
