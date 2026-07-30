// Keyboard bindings. POSITIONAL: the nine command-card cells own the keys, not
// the units — so one set of nine covers the shop, the buildings tab, a tech
// building's card, a unit's abilities and every panel added later. The key a
// cell shows is the key that fires it, always, whatever sits in it.
//
// The player rebinds them in the menu's OPTIONS screen; the choice lives in
// localStorage. Nothing here touches the simulation — a hotkey ends up calling
// the exact same code path a click does.

const KEY = 'fh-hotkeys';

// action id -> { label, def } — `def` is the stored key (see normKey)
export const HOTKEY_ACTIONS = [
  { id: 'cell0', label: 'Căsuța 1 (sus-stânga)', def: '1', group: 'Grila de comenzi' },
  { id: 'cell1', label: 'Căsuța 2 (sus-mijloc)', def: '2', group: 'Grila de comenzi' },
  { id: 'cell2', label: 'Căsuța 3 (sus-dreapta)', def: '3', group: 'Grila de comenzi' },
  { id: 'cell3', label: 'Căsuța 4 (mijloc-stânga)', def: '4', group: 'Grila de comenzi' },
  { id: 'cell4', label: 'Căsuța 5 (centru)', def: '5', group: 'Grila de comenzi' },
  { id: 'cell5', label: 'Căsuța 6 (mijloc-dreapta)', def: '6', group: 'Grila de comenzi' },
  { id: 'cell6', label: 'Căsuța 7 (jos-stânga)', def: '7', group: 'Grila de comenzi' },
  { id: 'cell7', label: 'Căsuța 8 (jos-mijloc)', def: '8', group: 'Grila de comenzi' },
  { id: 'cell8', label: 'Căsuța 9 (jos-dreapta)', def: '9', group: 'Grila de comenzi' },
  { id: 'tabUnits', label: 'Tab: Unități', def: 'q', group: 'Bara de jos' },
  { id: 'tabBuildings', label: 'Tab: Clădiri', def: 'e', group: 'Bara de jos' },
  { id: 'upgradeBase', label: 'Upgrade la bază', def: '0', group: 'Bara de jos' },
  { id: 'sell', label: 'Vinde selecția', def: '', group: 'Bara de jos' },
  { id: 'homeBase', label: 'Camera la baza mea', def: ' ', group: 'General' },
  { id: 'cancel', label: 'Anulează / deselectează', def: 'Escape', group: 'General' },
  { id: 'fullscreen', label: 'Ecran complet', def: 'f', group: 'General' },
];

export const CELL_ACTIONS = HOTKEY_ACTIONS.filter((a) => a.id.startsWith('cell')).map((a) => a.id);

// One canonical spelling per physical key: letters lowercase, everything else
// as the browser reports it (so 'Escape', 'F1', ' ' for Space).
export function normKey(k) {
  if (!k) return '';
  return k.length === 1 ? k.toLowerCase() : k;
}

// What the player sees on a card / in the options list.
export function keyLabel(k) {
  if (!k) return '—';
  if (k === ' ') return 'Space';
  if (k === 'Escape') return 'Esc';
  if (k.length === 1) return k.toUpperCase();
  return k;
}

let binds = null;

function defaults() {
  const out = {};
  for (const a of HOTKEY_ACTIONS) out[a.id] = a.def;
  return out;
}

export function loadHotkeys() {
  if (binds) return binds;
  binds = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      for (const a of HOTKEY_ACTIONS) {
        if (typeof raw[a.id] === 'string') binds[a.id] = normKey(raw[a.id]);
      }
    }
  } catch { /* private mode / corrupt entry — defaults stand */ }
  return binds;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch { /* private mode */ }
}

export function hotkeyOf(action) {
  return loadHotkeys()[action] || '';
}

// Which action a pressed key fires, or null. First match in HOTKEY_ACTIONS
// order, so a duplicate can never fire two things at once.
export function actionForKey(key) {
  const k = normKey(key);
  if (!k) return null;
  const b = loadHotkeys();
  for (const a of HOTKEY_ACTIONS) if (b[a.id] === k) return a.id;
  return null;
}

// Bind a key to an action. A key can only do ONE thing: whoever held it before
// loses it (returns the action that was cleared, so the UI can say so).
export function setHotkey(action, key) {
  const b = loadHotkeys();
  const k = normKey(key);
  let stolenFrom = null;
  if (k) {
    for (const a of HOTKEY_ACTIONS) {
      if (a.id !== action && b[a.id] === k) { b[a.id] = ''; stolenFrom = a.id; }
    }
  }
  b[action] = k;
  persist();
  return stolenFrom;
}

export function resetHotkeys() {
  binds = defaults();
  persist();
  return binds;
}

// The key label for command-card cell `i` (0-8), for the badge on the card.
export function cellKeyLabel(i) {
  const id = CELL_ACTIONS[i];
  return id ? keyLabel(hotkeyOf(id)) : '';
}

// Cell index (0-8) for a pressed key, or -1.
export function cellForKey(key) {
  const a = actionForKey(key);
  if (!a || !a.startsWith('cell')) return -1;
  return CELL_ACTIONS.indexOf(a);
}
