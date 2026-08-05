// Two-language UI: Romanian (the original) and English.
//
// The dictionary is keyed by the ROMANIAN STRING ITSELF, not by abstract ids:
// the Romanian text stays in the code exactly where it always was, `t()` looks
// it up when the language is English, and anything missing from the dictionary
// simply shows in Romanian instead of breaking. That makes the translation a
// single file of pairs — and grepping for a string you saw on screen still
// finds the code that drew it.
//
// UI-ONLY. The sim never imports this (language is per-browser, and the sim
// must stay byte-identical between two players of a lockstep match).
//
// Parameterised strings keep `{x}` placeholders in BOTH languages:
//   t('Pornește {a}v{b}', { a: 2, b: 2 })

const KEY = 'fh-lang';

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ro' || saved === 'en') return saved;
  } catch { /* private mode */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')) || '';
  return nav.toLowerCase().startsWith('ro') ? 'ro' : 'en';
}

let lang = detect();

export function getLang() { return lang; }

// Persist + hard reload: the menu builds its DOM once at startup, so a reload
// is the one path that guarantees EVERY surface re-renders in the new language.
export function setLang(next) {
  if (next !== 'ro' && next !== 'en') return;
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  lang = next;
  if (typeof location !== 'undefined') location.reload();
}

// Which map translates INTO the active language. Half the menu was authored in
// English and half in Romanian, so the lookup has to work both ways: EN is
// keyed by the Romanian source strings, RO by the English ones. A string that
// reads the same in both languages simply isn't in either map.
function dict() { return lang === 'en' ? EN : RO; }

export function t(s, vars) {
  let out = dict()[s] || s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

// Translate STATIC markup in place: every title/placeholder/aria-label whose
// exact value is in the dictionary, and every text node whose trimmed text is.
// Keyed by the Romanian text, so running it twice (or over already-English
// nodes) changes nothing. Decorations survive because a leading run of
// non-letters ("◄ ", "⚔  ") is stripped before lookup and glued back after —
// one dictionary entry serves the plain string everywhere it appears.
export function translateDom(root) {
  if (!root) return;
  const D = dict();
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  for (const el of root.querySelectorAll('*')) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && D[v]) el.setAttribute(a, D[v]);
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const p = node.parentElement;
    if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') continue;
    const raw = node.nodeValue;
    const text = raw.trim();
    if (!text) continue;
    if (D[text]) { node.nodeValue = raw.replace(text, D[text]); continue; }
    // "◄ Înapoi" / "⚔  Caută meci" → prefix "◄ " + key "Înapoi"
    const m = text.match(/^([^\p{L}\p{N}]+)(.+)$/u);
    if (m && D[m[2]]) node.nodeValue = raw.replace(text, m[1] + D[m[2]]);
  }
}

// Admin-authored content (unit tips, ability/upgrade descriptions) is written
// in the admin in Romanian, with an OPTIONAL English field next to it. Pick
// the right one for the current language, falling back to Romanian.
export function pickText(ro, en) {
  return (lang === 'en' && en) ? en : (ro || '');
}

// ---------------------------------------------------------------- dictionary
const EN = {
  // ---- boot splash + loading screen
  'pornesc jocul…': 'starting the game…',
  'setările de joc…': 'loading game settings…',
  'pregătesc meniul…': 'preparing the menu…',
  'durează mai mult ca de obicei…': 'taking longer than usual…',
  'imagini': 'images',
  'conexiune lentă…': 'slow connection…',
  'Pregătește-te de luptă': 'Prepare for battle',

  // ---- tips (loading screen + boot)
  'Generatoarele sunt economia ta — protejează-le cu ziduri și turnuri.':
    'Generators are your economy — protect them with walls and towers.',
  'Upgrade la Bază deblochează tieruri superioare de unități.':
    'Upgrading your Base unlocks higher unit tiers.',
  'Armata ta reînvie la fiecare val și mărșăluiește singură spre inamic.':
    'Your army respawns every wave and marches at the enemy on its own.',
  'Fiecare unitate are un contra: uită-te la tipul de damage 🗡️ și armură 🛡️.':
    'Every unit has a counter: watch the damage type 🗡️ and armor 🛡️.',
  'Ține mijlocul hărții pentru un bonus de venit.':
    'Hold the middle of the map for an income bonus.',
  'Eroul urcă în nivel din kill-urile armatei — ai grijă de el.':
    'Your hero levels up from your army\'s kills — keep him alive.',

  // ---- menu chrome
  'Imaginea anterioară': 'Previous image',
  'Imaginea următoare': 'Next image',
  'Anterior': 'Previous',
  'Următor': 'Next',
  'Înainte': 'Forward',
  'Numele tău — apare în cameră și în meciuri': 'Your name — shown in rooms and matches',
  'Versiunea jocului — toți jucătorii dintr-un meci trebuie s-o aibă pe aceeași':
    'Game version — every player in a match must be on the same one',
  'Ecran complet': 'Fullscreen',
  'Comută ecran complet': 'Toggle fullscreen',
  'Melodia anterioară': 'Previous track',
  'Melodia următoare': 'Next track',
  'Volum muzică (click = mute)': 'Music volume (click = mute)',
  'Înapoi': 'Back',
  'Ieși din cameră': 'Leave the room',
  'Anulează': 'Cancel',
  'Meci rapid 1v1': 'Quick 1v1 match',
  'Caută meci': 'Find a match',
  'Cameră publică': 'Public room',
  'Cameră privată': 'Private room',
  'Reîmprospătează': 'Refresh',
  'Ai un cod de la un prieten? Scrie-l aici:': 'Got a code from a friend? Type it here:',
  'COD': 'CODE',
  'Intră': 'Join',
  'Cod cameră': 'Room code',
  'Cameră de antrenament': 'Practice room',
  'Click ca să copiezi codul': 'Click to copy the code',
  'Scrie un mesaj…': 'Type a message…',
  'Trimite': 'Send',
  '✔&nbsp;&nbsp;Gata': '✔&nbsp;&nbsp;Ready',
  'Se caută adversar…': 'Searching for an opponent…',
  'Ține pagina deschisă': 'Keep this page open',
  'Taste': 'Hotkeys',
  'Resetează tastele': 'Reset hotkeys',
  'Cum se joacă': 'How to play',
  'Meniu': 'Menu',
  'Aur, construcții, tier și valuri accelerate; eroii vin cu 6 nivele. Doar în meciurile offline — se debifează și totul revine la normal.':
    'Fast gold, builds, tiers and waves; heroes start 6 levels up. Offline matches only — untick and everything is back to normal.',
  'Cele 9 căsuțe sunt pe POZIȚIE: tasta face ce e în căsuța aia, în orice panou. Click pe o tastă, apoi apasă noua tastă (Esc = renunți, Backspace = scoți tasta).':
    'The 9 cells are POSITIONAL: a key does whatever sits in that cell, in any panel. Click a key, then press the new one (Esc = cancel, Backspace = unbind).',
  'Construiește-ți baza — <b>ziduri, turnuri, generatoare</b> — în zona de construcție, și <b>formația de armată</b> în banda din față. La fiecare val, toată armata ta reînvie și mărșăluiește spre <b>Baza inamică</b> — distruge-o pe a lui ca să câștigi. <b>Upgrade la Baza principală</b> deblochează tieruri superioare de unități. Generatoarele sunt economia ta — protejează-le!':
    'Build your base — <b>walls, towers, generators</b> — in the construction zone, and your <b>army formation</b> in the front band. Every wave, your whole army respawns and marches on the <b>enemy Base</b> — destroy theirs to win. <b>Upgrading your Main Base</b> unlocks higher unit tiers. Generators are your economy — protect them!',
  '<b>Cameră:</b> mișcă mouse-ul la margini sau folosește <b>săgeți / WASD</b> · <b>rotița</b> face zoom · <b>Space</b> sare la baza ta · click pe <b>minimap</b>. Cursorul e cel real (fără delay).':
    '<b>Camera:</b> push the mouse to the edges or use <b>arrows / WASD</b> · <b>wheel</b> zooms · <b>Space</b> jumps to your base · click the <b>minimap</b>. The cursor is the real one (no delay).',

  // ---- game over
  'Valuri: <b>{w}</b> · Aur cheltuit: <b>{g}</b> · Tier atins: <b>{t}</b>':
    'Waves: <b>{w}</b> · Gold spent: <b>{g}</b> · Tier reached: <b>{t}</b>',

  // ---- lobby (dynamic)
  'Se caută camere…': 'Looking for rooms…',
  'Nicio cameră publică deschisă. Creează tu una!': 'No public room open. Create one!',
  '{n} jucători': '{n} players',
  'Serverul camerei nu cunoaște mutarea pe alt loc — rulează o versiune mai veche și trebuie repornit.':
    'The room server does not know seat moves — it runs an older build and needs a restart.',
  'Pornește {a}v{b}': 'Start {a}v{b}',
  'Toți jucătorii umani trebuie să fie GATA': 'All human players must be READY',
  'Versiuni diferite ({list}) — camera merge pe {v}. Reîmprospătați pagina cu Ctrl+Shift+R.':
    'Mismatched versions ({list}) — the room runs {v}. Refresh the page with Ctrl+Shift+R.',
  'Tabăra {n} e goală — pune un bot.': 'Side {n} is empty — add a bot.',
  'Tabăra {n} e goală — pune un bot sau așteaptă un jucător.':
    'Side {n} is empty — add a bot or wait for a player.',
  'Se așteaptă: {who}': 'Waiting for: {who}',
  'Gazda pornește meciul.': 'The host starts the match.',
  'Sloturile goale dispar — pornești {a}v{b}.': 'Empty slots vanish — you start {a}v{b}.',
  'Sloturile goale dispar — pornești {a}v{b} (asimetric: tabăra mică primește bonus de venit).':
    'Empty slots vanish — you start {a}v{b} (asymmetric: the smaller side gets an income bonus).',
  'Spate': 'Back',
  'Mijloc': 'Middle',
  'Față': 'Front',
  'Versiune diferită de a camerei ({v})': 'Different version than the room ({v})',
  '✔ gata': '✔ ready',
  '… așteaptă': '… waiting',
  'nu intră nimeni': 'closed',
  'așteaptă un jucător': 'waiting for a player',
  'Treci în tabăra asta': 'Move to this side',
  'Mută-te aici': 'Move here',
  'apasă…': 'press…',
  'Tabăra {n}': 'Side {n}',
  'TU': 'YOU',
  'Sunt gata': "I'm ready",
  'Cere schimb de poziție': 'Ask to swap seats',
  'Dă afară': 'Kick',
  'Golește slotul': 'Empty the slot',
  'Închis': 'Closed',
  'Liber': 'Open',
  'Pune un bot': 'Add a bot',
  'Deschide slotul': 'Open the slot',
  'Închide slotul': 'Close the slot',
  'Mai în spate': 'Further back',
  'Mai în față': 'Further forward',
  'Mută în cealaltă tabără': 'Move to the other side',
  'Oameni': 'Humans',
  'Orci': 'Orcs',

  // ---- options: hotkey rows
  'Grila de comenzi': 'Command grid',
  'Bara de jos': 'Bottom bar',
  'Căsuța 1 (sus-stânga)': 'Cell 1 (top-left)',
  'Căsuța 2 (sus-mijloc)': 'Cell 2 (top-middle)',
  'Căsuța 3 (sus-dreapta)': 'Cell 3 (top-right)',
  'Căsuța 4 (mijloc-stânga)': 'Cell 4 (middle-left)',
  'Căsuța 5 (centru)': 'Cell 5 (center)',
  'Căsuța 6 (mijloc-dreapta)': 'Cell 6 (middle-right)',
  'Căsuța 7 (jos-stânga)': 'Cell 7 (bottom-left)',
  'Căsuța 8 (jos-mijloc)': 'Cell 8 (bottom-middle)',
  'Căsuța 9 (jos-dreapta)': 'Cell 9 (bottom-right)',
  'Tab: Unități': 'Tab: Units',
  'Tab: Clădiri': 'Tab: Buildings',
  'Upgrade la bază': 'Base upgrade',
  'Camera la baza mea': 'Camera to my base',
  'Anulează / deselectează': 'Cancel / deselect',
  'Comandant': 'Commander', 'General': 'General', 'Warlord': 'Warlord',
  'Căpitan': 'Captain', 'Mareșal': 'Marshal', 'Baron': 'Baron',

  // ---- connection / net errors (main.js)
  'Camera nu există (cod greșit sau expirat).': 'That room does not exist (wrong or expired code).',
  'Acela e codul TĂU — dă-i-l prietenului.': 'That is YOUR code — give it to your friend.',
  'Ești deja într-un meci.': 'You are already in a match.',
  'Camera e plină.': 'The room is full.',
  'Nu toți jucătorii sunt gata.': 'Not every player is ready.',
  'Versiuni diferite de joc. Tu ai {v} — reîmprospătați pagina (Ctrl+Shift+R) ca să aveți toți aceeași versiune.':
    'Mismatched game versions. You are on {v} — refresh the page (Ctrl+Shift+R) so everyone runs the same one.',
  'Mă conectez…': 'Connecting…',
  'Se deschide camera…': 'Opening the room…',
  'Cod:': 'Code:',
  'Eroare': 'Error',
  'Nu mă pot conecta la serverul de joc. Încearcă din nou.':
    'Cannot reach the game server. Try again.',
  '⚠ Meciul s-a desincronizat — ce vedeți nu mai e identic':
    '⚠ The match desynced — you are no longer seeing the same game',
  '{name} nu vrea să schimbe poziția': '{name} does not want to swap seats',
  'Ai fost dat afară din cameră.': 'You were kicked from the room.',
  '{name} a părăsit meciul — echipa lui primește bonusul asimetric':
    '{name} left the match — their team gets the asymmetric bonus',
  'Jucătorul {n}': 'Player {n}',
  'Adversarul a părăsit meciul': 'Your opponent left the match',
  'Conexiune pierdută cu serverul': 'Lost the connection to the server',
  'Bară de jos: {s}×': 'Bottom bar: {s}×',

  // ---- in-game HUD (index.html titles + labels)
  'Aur · venit pe secundă': 'Gold · income per second',
  'Food folosit / plafon (crește-l cu Ferme)': 'Food used / cap (raise it with Farms)',
  'Schelete vii / plafon (crește plafonul de la bază)': 'Skeletons alive / cap (raise the cap at the base)',
  'Arată razele de atac + cutiile fizice (debug)': 'Show attack ranges + physical boxes (debug)',
  'următorul val în': 'next wave in',
  'urmatorul val în': 'next wave in',
  'Muzică — trage pentru volum, click pe iconiță pentru mute': 'Music — drag for volume, click the icon to mute',
  'Muzică on/off': 'Music on/off',
  'Volum muzică': 'Music volume',
  'Sunet de luptă — trage pentru volum, click pe iconiță pentru mute': 'Battle sound — drag for volume, click the icon to mute',
  'Sunet de luptă on/off': 'Battle sound on/off',
  'Volum sunet de luptă': 'Battle sound volume',
  'Mărește bara de jos (1× / 1.2× / 1.4× / 1.6×)': 'Scale the bottom bar up (1× / 1.2× / 1.4× / 1.6×)',
  'Selectează o unitate sau o clădire.': 'Select a unit or a building.',
  'Unități (cumpără)': 'Units (buy)',
  'Clădiri (construiește)': 'Buildings (build)',
  'CLĂDIRI': 'BUILDINGS',
  'Mută clădirea în alt loc (se reconstruiește 30s)': 'Move the building somewhere else (rebuilds for 30s)',
  'Mută': 'Move',
  'Vinde selecția': 'Sell the selection',

  // ---- bottom bar: structures reference (code-owned defaults)
  'Blochează unitățile terestre': 'Blocks ground units',
  'Barieră ieftină — inamicii trebuie să o spargă sau să o ocolească. Zburătorii trec peste.':
    'Cheap barrier — enemies must break it or walk around it. Flyers pass over.',
  'Trage în sol și aer. Apără zona de construcție.': 'Shoots ground and air. Defends the construction zone.',
  'Clădire economică': 'Economy building',
  'Fiecare adaugă aur în plus la fiecare 20s. Poate fi distrus — protejează-ți economia!':
    'Each one adds extra gold every 20s. It can be destroyed — protect your economy!',
  'Deblochează unități': 'Unlocks units',
  'Construiește-o ca să poți cumpăra unitățile ei. Click pe ea pentru unități + upgrade-uri. Distrusă = pierzi accesul.':
    'Build it to buy its units. Click it for units + upgrades. Destroyed = you lose access.',
  'Mărește food cap': 'Raises the food cap',
  'Fiecare fermă crește plafonul de food, ca să poți plasa mai multe unități. Distrusă = pierzi plafonul (unitățile plasate rămân).':
    'Each farm raises the food cap so you can place more units. Destroyed = you lose the cap (placed units stay).',
  'Recrutează eroi': 'Recruits heroes',
  'Click pe ea ca să recrutezi eroi (până la 3). Al 2-lea erou se deblochează la tier 2, al 3-lea la tier 3. Distrusă = nu mai poți recruta (eroii plasați rămân).':
    'Click it to recruit heroes (up to 3). The 2nd unlocks at tier 2, the 3rd at tier 3. Destroyed = no more recruiting (placed heroes stay).',

  // ---- bottom bar: selection panel
  'Atac încetinit': 'Attack slowed',
  'Mișcare încetinită': 'Movement slowed',
  'Regenerare': 'Regeneration',
  'Imun la debuff': 'Debuff immune',
  'Fără buff-uri': 'No buffs',
  'Vinde acest șablon de unitate — primești ◆ {n}': 'Sell this unit template — you get ◆ {n}',
  ' (100%, nespawnat)': ' (100%, never spawned)',
  'Vinde această clădire — primești ◆ {n}': 'Sell this building — you get ◆ {n}',
  'Alege loc…': 'Pick a spot…',
  'Click pe teren ca să muți clădirea (se reconstruiește 30s). Click din nou aici sau ESC = anulează.':
    'Click the ground to move the building (rebuilds for 30s). Click here again or ESC = cancel.',
  'Mută clădirea în alt loc (se reconstruiește 30s).': 'Move the building somewhere else (rebuilds for 30s).',
  '⛏ cară aur la bază': '⛏ hauls gold to the base',
  '◆ +<b>{n}</b> aur/20s': '◆ +<b>{n}</b> gold/20s',
  'Clădire': 'Building',
  'nou (100% la vânzare)': 'new (sells for 100%)',
  '✨ castează': '✨ casting',
  '🐗 pe jos': '🐗 on foot',
  'Suflete ': 'Souls ',
  '🏰 obiectivul principal': '🏰 the main objective',
  'Nivel {n}': 'Level {n}',
  'punct': 'point', 'puncte': 'points',
  'Deblochează: {names}': 'Unlocks: {names}',
  '(nicio unitate asignată — vezi /admin)': '(no unit assigned — see /admin)',
  'Se construiește de la Tier {t}': 'Buildable from Tier {t}',
  'Necesită Tier {t}': 'Requires Tier {t}',
  '+{n}/mină': '+{n}/mine',
  'Tier 2 deblochează unitățile de tier 2': 'Tier 2 unlocks tier 2 units',
  'Tier 3 deblochează unitățile de tier 3': 'Tier 3 unlocks tier 3 units',
  'Durează {n}s (baza e ocupată în timpul upgrade-ului).': 'Takes {n}s (the base is busy while upgrading).',
  'Instant.': 'Instant.',
  'Upgrade Bază — în curs…': 'Base Upgrade — in progress…',
  'Baza se îmbunătățește. Mai sunt {n}s.': 'The base is upgrading. {n}s left.',
  'Noul tier se activează când se termină timpul.': 'The new tier activates when the timer ends.',
  'Upgrade Bază · {cost}': 'Base Upgrade · {cost}',
  'Deblochează următorul tier de unități și adaugă +1000 HP bazei. {timing}':
    'Unlocks the next unit tier and adds +1000 HP to the base. {timing}',
  'Crește câte schelete de Necromancer poate menține echipa ta vii în același timp.':
    'Raises how many Necromancer skeletons your team can keep alive at once.',
  'Acum: {a}/{b}': 'Now: {a}/{b}',
  ' · fiecare cumpărare crește costul cu ◆ {n}': ' · every purchase raises the cost by ◆ {n}',
  'durată {n}s': 'lasts {n}s',
  'necesită Tier {n}': 'requires Tier {n}',
  'Click: pornește/oprește pentru TOATE unitățile de acest tip.': 'Click: toggles it for ALL units of this type.',
  'blocat — necesită Tier {t}': 'locked — requires Tier {t}',
  'blocat — necesită întâi: {names}': 'locked — first requires: {names}',
  '◆ {n} — click pentru a cumpăra': '◆ {n} — click to buy',
  'necumpărat — ◆ {n} din Bază': 'not bought — ◆ {n} at the Base',
  'Click: activează/dezactivează.': 'Click: toggles it on/off.',
  'Ultima — se deblochează la nivel 6': 'Ultimate — unlocks at level 6',
  'Rang {a}/{b} — click-stânga pentru +1 rang ({p} pct.)': 'Rank {a}/{b} — left-click for +1 rank ({p} pts.)',
  'Mod: <b>{m}</b> — click-dreapta ciclează Auto → Manual → Oprit.': 'Mode: <b>{m}</b> — right-click cycles Auto → Manual → Off.',
  'Manual: click-stânga o aruncă acum (dacă e gata).': 'Manual: left-click casts it now (if ready).',
  'Pasivă: <b>{s}</b> — click-dreapta pornește/oprește.': 'Passive: <b>{s}</b> — right-click toggles it.',
  'OPRITĂ ✖': 'OFF ✖', 'ACTIVĂ A': 'ACTIVE A',
  'OPRIT': 'OFF', 'PORNIT': 'ON', 'OPRIT ✖': 'OFF ✖', 'MANUAL M': 'MANUAL M', 'AUTO A': 'AUTO A',
  'Vinde': 'Sell',
  'Muncitor': 'Worker',
  'Miner': 'Miner',
  'INAMIC': 'ENEMY',
  'ALIAT': 'ALLY',
  'Animal invocat': 'Summoned animal',
  'aur/20s': 'gold/20s',
  'Turn defensiv': 'Defensive tower',
  'Rang MAXIM ({a}/{b})': 'MAX rank ({a}/{b})',
  'Rang {a}/{b} — n-ai puncte de talent': 'Rank {a}/{b} — no talent points',
  'Unitate': 'Unit',
  'Efectul crește cu rangul.': 'The effect grows with rank.',
  'Vinde acest șablon de unitate.': 'Sell this unit template.',
  'Vinde această clădire.': 'Sell this building.',
  'Upgrade-uri': 'Upgrades',
  'Unități': 'Units',
  'Arată upgrade-urile unităților acestei clădiri.': "Shows this building's unit upgrades.",
  'Înapoi la unitățile clădirii.': "Back to the building's units.",
  'Baza se îmbunătățește. Mai sunt {n}s.': 'The base is upgrading. {n}s left.',
};

// ---------------------------------------------------------- English -> Romanian
// Menu chrome, stat tags and lobby badges that were written in English in the
// source. Anything that reads identically in both languages (Multiplayer, BOT,
// START, VS, MAX, Caster, DPS, 1v1 Online) is deliberately absent.
const RO = {
  'Play vs AI': 'Joacă vs AI',
  'Options': 'Opțiuni',
  'OPTIONS': 'OPȚIUNI',
  'How to play': 'Cum se joacă',
  'Create room': 'Creează cameră',
  'Create a room': 'Creează o cameră',
  'Join a room': 'Intră într-o cameră',
  'Music': 'Muzică',
  'Fullscreen': 'Ecran complet',
  'Block the mouse': 'Blochează mouse-ul',
  'Recommended when using two screens': 'Recomandat când folosești două ecrane',
  'Testing': 'Testare',
  'Rematch': 'Revanșă',
  'VICTORY': 'VICTORIE',
  'DEFEAT': 'ÎNFRÂNGERE',
  'HOST': 'GAZDĂ',
  'Player': 'Jucător',
  'UNITS': 'UNITĂȚI',
  'Hits air': 'Lovește aerul',
  'Requires: {list}': 'Necesită: {list}',
  'Miner': 'Miner',
};
