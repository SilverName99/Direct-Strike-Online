// Evolutionary AI trainer (admin only). Runs headless AI-vs-AI matches in a
// pool of Web Workers, breeds the winning "genomes", and shows live progress +
// balance stats. The best brain can be saved into balance.json (drives the
// in-game AI). Deterministic sim => reproducible; the evolution itself uses
// Math.random (no reproducibility needed for the search).

import { RACES } from '../config.js';
import { DEFAULT_GENOME, randomGenome } from '../sim/ai.js';
import { runMatch } from '../sim/match.js';
import { loadBalance, applyBalance, statsUnit, resolvedUnitOrder, setAIGenome, saveBalance } from './balance.js';
import { mulberry32 } from '../sim/rng.js';

// ---- genome shape (ranges for mutation / clamping) -------------------------
const SPEC = {
  tFront: { min: 0.02, max: 0.9 }, tRanged: { min: 0.02, max: 0.9 },
  tSpecial: { min: 0.02, max: 0.9 }, tSupport: { min: 0.02, max: 0.9 },
  counterChance: { min: 0, max: 1 }, aggression: { min: 0, max: 0.8 },
  tier2Wave: { min: 1, max: 5, int: true }, tier3Wave: { min: 3, max: 9, int: true },
  savePatience: { min: 3, max: 40 }, farmBuffer: { min: 1, max: 10, int: true },
  maxGens: { min: 2, max: 10, int: true },
  midTowers: { min: 0, max: 5, int: true },
};
const KEYS = Object.keys(SPEC);
const LABELS = {
  tFront: 'Frontline %', tRanged: 'Ranged %', tSpecial: 'Special %', tSupport: 'Support %',
  counterChance: 'Șansă counter', aggression: 'Agresivitate',
  tier2Wave: 'Wave → Tier 2', tier3Wave: 'Wave → Tier 3', savePatience: 'Răbdare economie (s)',
  farmBuffer: 'Rezervă food (ferme)', maxGens: 'Generatoare max', midTowers: 'Turnuri în față (mijloc)',
};
const clampGene = (k, v) => { const s = SPEC[k]; v = Math.max(s.min, Math.min(s.max, v)); return s.int ? Math.round(v) : v; };
const rng = mulberry32((Date.now() % 2 ** 31) >>> 0);
function mutate(g, rate) {
  const out = { ...g };
  for (const k of KEYS) if (Math.random() < rate) {
    const s = SPEC[k];
    out[k] = clampGene(k, out[k] + (Math.random() * 2 - 1) * (s.max - s.min) * 0.28);
  }
  return out;
}
const crossover = (a, b) => { const o = {}; for (const k of KEYS) o[k] = Math.random() < 0.5 ? a[k] : b[k]; return o; };
const cleanGenome = (g) => { const o = {}; for (const k of KEYS) o[k] = clampGene(k, g && k in g ? g[k] : DEFAULT_GENOME[k]); return o; };

// ---- worker pool -----------------------------------------------------------
const workers = [];
let jobQueue = [];
const pending = new Map();
let jobIdSeq = 0;
let onJobResult = null;
let matchesDone = 0;

function setupWorkers(balance) {
  const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4)));
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' });
    w.busy = false; w.ready = false;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { w.ready = true; pump(); }
      else if (m.type === 'result') {
        w.busy = false;
        const p = pending.get(m.jobId); pending.delete(m.jobId);
        if (p) { if (onJobResult) onJobResult(p.job, m.result); p.done(); }
        pump();
      }
    };
    w.postMessage({ type: 'init', balance });
    workers.push(w);
  }
  return n;
}
function pump() {
  for (const w of workers) {
    if (!w.ready || w.busy || !jobQueue.length) continue;
    const item = jobQueue.shift();
    const jobId = ++jobIdSeq;
    pending.set(jobId, item);
    w.busy = true;
    w.postMessage({ type: 'match', jobId, a: item.job.a, b: item.job.b, seed: item.job.seed, races: item.job.races, maxSeconds: item.secs });
  }
}
function runJobs(jobs, secs, onResult) {
  return new Promise((resolve) => {
    onJobResult = onResult;
    if (!jobs.length) { resolve(); return; }
    let remaining = jobs.length;
    for (const job of jobs) jobQueue.push({ job, secs, done: () => { remaining--; matchesDone++; if (remaining === 0) resolve(); } });
    pump();
  });
}

// ---- evolution state -------------------------------------------------------
let population = [];
let generation = 0;
let best = null;
let bestFitness = 0;
let history = [];
let running = false, paused = false, stopReq = false;
// cumulative balance stats
let stat = { races: {}, raceWins: {}, units: {}, unitWins: {}, matches: 0 };
// one "showcase" match played by the current best brain, refreshed each
// generation — drives the human-readable match summary.
let showcase = null;

const pickRace = () => RACES[Math.floor(Math.random() * RACES.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function accumulateStats(res) {
  const winner = res.score0 >= 0.5 ? 0 : 1;
  for (const team of [0, 1]) {
    const race = res.races[team];
    stat.races[race] = (stat.races[race] || 0) + 1;
    if (team === winner) stat.raceWins[race] = (stat.raceWins[race] || 0) + 1;
    for (const [unit, cnt] of Object.entries(res.comp[team])) {
      if (!(cnt > 0)) continue;
      const key = race + ':' + unit;
      stat.units[key] = (stat.units[key] || 0) + 1;
      if (team === winner) stat.unitWins[key] = (stat.unitWins[key] || 0) + 1;
    }
  }
  stat.matches++;
}

async function evalGeneration(pop, matchesPer, secs) {
  const acc = pop.map(() => ({ sum: 0, n: 0 }));
  const jobs = [];
  for (let i = 0; i < pop.length; i++) {
    for (let k = 0; k < matchesPer; k++) {
      let j; do { j = Math.floor(Math.random() * pop.length); } while (j === i && pop.length > 1);
      jobs.push({ i, a: pop[i], b: pop[j], races: [pickRace(), pickRace()], seed: (Math.random() * 2 ** 31) | 0 });
    }
  }
  await runJobs(jobs, secs, (job, res) => { acc[job.i].sum += res.score0; acc[job.i].n++; accumulateStats(res); });
  return acc.map((s) => (s.n ? s.sum / s.n : 0));
}

function tournament(ranked) {
  const a = ranked[Math.floor(Math.random() * ranked.length)];
  const b = ranked[Math.floor(Math.random() * ranked.length)];
  return (a.f >= b.f ? a : b).g;
}

async function evolve(cfg) {
  running = true; stopReq = false; paused = false;
  setStatus('rulează…', true);
  updateButtons(); // now that running=true, enable Pauză/Stop (start handler ran before this)
  while (running && !stopReq) {
    if (paused) { await sleep(200); continue; }
    const fitness = await evalGeneration(population, cfg.matches, cfg.secs);
    if (stopReq) break;
    const ranked = population.map((g, i) => ({ g, f: fitness[i] })).sort((a, b) => b.f - a.f);
    best = ranked[0].g; bestFitness = ranked[0].f;
    const avg = fitness.reduce((a, b) => a + b, 0) / (fitness.length || 1);
    generation++;
    history.push({ gen: generation, best: bestFitness, avg });
    if (history.length > 500) history.shift();
    // let the current best brain play ONE showcase match (main thread — it's a
    // single headless game) so we can tell the story of how this generation fights
    runShowcase(cfg.secs);
    // breed
    const elites = Math.max(1, Math.round(population.length * 0.15));
    const next = ranked.slice(0, elites).map((r) => r.g);
    while (next.length < population.length) next.push(mutate(crossover(tournament(ranked), tournament(ranked)), cfg.mut));
    population = next;
    saveCheckpoint();
    render();
    await sleep(0);
  }
  running = false;
  setStatus(stopReq ? 'oprit.' : 'în pauză.', false);
  updateButtons();
  render();
}

// ---- persistence -----------------------------------------------------------
const LS_KEY = 'ds-train-state';
function saveCheckpoint() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ population, generation, history, stat, best, showcase })); } catch { /* quota / private */ }
}
function loadCheckpoint() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (s && Array.isArray(s.population) && s.population.length) {
      population = s.population.map(cleanGenome); generation = s.generation || 0;
      history = Array.isArray(s.history) ? s.history : []; stat = s.stat || stat;
      best = s.best ? cleanGenome(s.best) : population[0];
      showcase = s.showcase || null;
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
function seedPopulation(size) {
  population = [cleanGenome(DEFAULT_GENOME)];
  while (population.length < size) population.push(randomGenome(rng));
  generation = 0; history = []; best = population[0]; bestFitness = 0;
  showcase = null;
  stat = { races: {}, raceWins: {}, units: {}, unitWins: {}, matches: 0 };
}

// ---- UI --------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const setStatus = (t, run) => { statusEl.textContent = t; statusEl.className = run ? 'run' : ''; };
let lastMatches = 0, lastTime = performance.now(), mps = 0;

function updateButtons() {
  $('b-start').disabled = running && !paused;
  $('b-pause').disabled = !running;
  $('b-pause').textContent = paused ? '▶ Reia' : '⏸ Pauză';
  $('b-stop').disabled = !running;
}

function render() {
  // speed
  const now = performance.now();
  if (now - lastTime > 500) { mps = (matchesDone - lastMatches) / ((now - lastTime) / 1000); lastMatches = matchesDone; lastTime = now; }
  // stat tiles
  $('stats').innerHTML = tile('Generație', generation) + tile('Cel mai bun scor', bestFitness.toFixed(3))
    + tile('Meciuri rulate', matchesDone.toLocaleString('ro')) + tile('Meciuri/sec', mps.toFixed(1))
    + tile('Nuclee (workers)', workers.length) + tile('Populație', population.length);
  drawChart();
  renderGenome();
  renderRaces();
  renderUnits();
  renderSummary();
  renderRecommendations();
}
const tile = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;

function renderGenome() {
  if (!best) { $('genome').querySelector('tbody').innerHTML = ''; return; }
  const rows = KEYS.map((k) => {
    let v = best[k];
    if (['tFront', 'tRanged', 'tSpecial', 'tSupport', 'counterChance', 'aggression'].includes(k)) v = (v * 100).toFixed(0) + '%';
    else if (!SPEC[k].int) v = (+v).toFixed(1);
    return `<tr><td>${LABELS[k]}</td><td style="text-align:right;color:#ffd35c;font-weight:700">${v}</td></tr>`;
  }).join('');
  $('genome').querySelector('tbody').innerHTML = rows;
}

function renderRaces() {
  const rows = RACES.map((r) => {
    const p = stat.races[r] || 0, w = stat.raceWins[r] || 0;
    const wr = p ? (w / p * 100) : 0;
    return `<tr><td>${r}</td><td>${p.toLocaleString('ro')} meciuri</td>
      <td style="width:45%"><span class="bar" style="width:${wr}%;background:${wr >= 52 ? '#ff8090' : wr <= 48 ? '#8fe3ff' : '#58d68d'}"></span>
      <b>${wr.toFixed(1)}%</b> win</td></tr>`;
  }).join('');
  $('race-stats').querySelector('tbody').innerHTML = rows || '<tr><td>—</td></tr>';
}

function renderUnits() {
  const rows = [];
  for (const key of Object.keys(stat.units)) {
    const [race, unit] = key.split(':');
    const plays = stat.units[key], wins = stat.unitWins[key] || 0;
    const racePlays = stat.races[race] || 1;
    const pick = plays / racePlays * 100;
    const win = plays ? wins / plays * 100 : 0;
    const name = (statsUnit(race, unit) || {}).name || unit;
    rows.push({ name, race, pick, win, plays });
  }
  rows.sort((a, b) => b.win * b.pick - a.win * a.pick);
  const html = rows.map((r) => `<tr><td>${r.name}</td><td style="color:#7c8ba1">${r.race}</td>
    <td><span class="bar" style="width:${Math.min(100, r.pick)}%;background:#4da6ff"></span> ${r.pick.toFixed(0)}%</td>
    <td><span class="bar" style="width:${r.win}%;background:${r.win >= 60 ? '#ff8090' : '#58d68d'}"></span> ${r.win.toFixed(0)}%</td></tr>`).join('');
  $('unit-stats').querySelector('tbody').innerHTML = html || '<tr><td colspan="4">Rulează antrenamentul ca să se adune date…</td></tr>';
}

// The showcase matchup: each side is the chosen race, or a random one when set
// to "Aleatoriu" (empty value). Training itself stays mixed/random — only this
// demo match honours the picker.
function showcaseRaces() {
  const pick = (id) => { const v = $(id) && $(id).value; return v && RACES.includes(v) ? v : pickRace(); };
  return [pick('c-raceA'), pick('c-raceB')];
}

// Let the current best brain play one headless showcase match (main thread —
// a single game is cheap) with a recorded timeline, so we can narrate it.
function runShowcase(secs) {
  if (!best) return;
  try {
    showcase = {
      gen: generation,
      res: runMatch({
        seed: (Math.random() * 2 ** 31) | 0,
        races: showcaseRaces(),
        genomeA: cleanGenome(best), genomeB: cleanGenome(best),
        maxSeconds: Math.max(40, secs || 140),
        summarize: true,
      }),
    };
  } catch { /* a bad showcase shouldn't stop training */ }
}

const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// Human-readable story of the showcase match — who won, when, and what each
// side did. Refreshes every generation as the best brain evolves.
function renderSummary() {
  const el = $('summary');
  if (!el) return;
  if (!showcase || !showcase.res) {
    el.innerHTML = '<div style="color:#7c8ba1">Pornește antrenamentul — după prima generație apare povestea unui meci jucat de cel mai bun creier.</div>';
    return;
  }
  const { gen, res } = showcase;
  const races = res.races;
  const teamName = (t) => `${races[t]} (E${t + 1})`;
  let head;
  if (res.winner === 0 || res.winner === 1) {
    const w = res.winner;
    head = `🏆 <b>${teamName(w)}</b> a distrus baza inamică la minutul <b>${fmtTime(res.seconds)}</b>, după ${res.waves} valuri.`;
  } else {
    const lead0 = res.lead0 != null ? res.lead0 : 0.5;
    const leader = lead0 >= 0.5 ? 0 : 1;
    head = `⏱ Egal la timeout (${fmtTime(res.seconds)}, ${res.waves} valuri) — <b>${teamName(leader)}</b> a condus ca valoare de armată ${(Math.max(lead0, 1 - lead0) * 100).toFixed(0)}% din meci.`;
  }
  const evs = (res.events || []).filter((e) => e.kind !== 'end');
  const compLine = (t) => {
    const m = res.comp[t] || {};
    const arr = Object.entries(m).map(([u, c]) => ({ name: (statsUnit(races[t], u) || {}).name || u, c }))
      .sort((a, b) => b.c - a.c).slice(0, 5);
    return arr.length ? arr.map((x) => `${x.c}× ${x.name}`).join(', ') : 'armată distrusă';
  };
  // one column per team: what THAT AI did (its own timeline + final army)
  const col = (t) => {
    const won = res.winner === t;
    const mine = evs.filter((e) => e.team === t).map((e) => {
      let txt;
      if (e.kind === 'tier') txt = `Tier ${e.tier}`;
      else if (e.kind === 'hero') txt = `recrutează erou${e.n > 1 ? ` (al ${e.n}-lea)` : ''}`;
      else if (e.kind === 'basehit') txt = 'baza proprie lovită prima oară';
      else txt = e.kind;
      return `<li><span style="color:#7c8ba1">${fmtTime(e.t)}</span> — ${txt}</li>`;
    });
    const side = t === 0 ? '◀ stânga' : 'dreapta ▶';
    return `<div class="stat" style="align-self:start">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-weight:700;color:${won ? '#ffd35c' : '#dbe4f0'}">${won ? '🏆 ' : ''}${teamName(t)}</span>
        <span style="font-size:10px;color:#7c8ba1;text-transform:uppercase;letter-spacing:1px">${side}</span>
      </div>
      <div style="font-size:12px;color:#7c8ba1;margin-bottom:4px">Tier ${res.tier[t]} · ${Math.round(res.spent[t])}g cheltuiți</div>
      <div style="font-size:12px;color:#dbe4f0;margin-bottom:8px"><span style="color:#7c8ba1">Armată:</span> ${compLine(t)}</div>
      <div class="k" style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#7c8ba1;margin-bottom:3px">Ce a făcut</div>
      ${mine.length ? `<ul style="margin:0;padding-left:18px;line-height:1.7;font-size:13px">${mine.join('')}</ul>` : '<div style="color:#7c8ba1;font-size:13px">puține acțiuni notabile</div>'}
    </div>`;
  };
  el.innerHTML = `
    <div style="margin-bottom:8px;color:#a97bff;font-size:11px;letter-spacing:1px;text-transform:uppercase">Generația ${gen}</div>
    <div style="margin-bottom:12px;font-size:14px">${head}</div>
    <div class="two" style="gap:12px">${col(0)}${col(1)}</div>
  `;
}

// Turn the accumulated pick/win stats into plain-language balance suggestions.
// Heuristics (need a decent sample first): a unit that wins a lot AND is picked
// a lot = nerf candidate; a nearly-unpicked unit = buff candidate; a heavily
// used unit that still loses = buff candidate. Race win% far from 50% = a
// race-wide tilt.
function renderRecommendations() {
  const el = $('reco');
  if (!el) return;
  if (stat.matches < 15) {
    el.innerHTML = '<li style="color:#7c8ba1">Mai rulează câteva meciuri ca să se adune destule date pentru recomandări…</li>';
    return;
  }
  const recos = [];
  // race-wide tilt
  for (const r of RACES) {
    const p = stat.races[r] || 0, w = stat.raceWins[r] || 0;
    if (p < 20) continue;
    const wr = w / p * 100;
    if (wr >= 55) recos.push({ sev: 2, t: `⚖ <b>Rasa ${r}</b> pare prea puternică (${wr.toFixed(0)}% win) — un nerf general ușor.` });
    else if (wr <= 45) recos.push({ sev: 2, t: `⚖ <b>Rasa ${r}</b> pare prea slabă (${wr.toFixed(0)}% win) — un buff general ușor.` });
  }
  // per-unit
  for (const key of Object.keys(stat.units)) {
    const [race, unit] = key.split(':');
    const plays = stat.units[key], wins = stat.unitWins[key] || 0;
    const racePlays = stat.races[race] || 1;
    if (racePlays < 20 || plays < 8) continue; // too little data on this unit
    const pick = plays / racePlays * 100;
    const win = plays ? wins / plays * 100 : 0;
    const name = (statsUnit(race, unit) || {}).name || unit;
    if (win >= 60 && pick >= 25) recos.push({ sev: 3, t: `🔻 <b>Nerf ${name}</b> (${race}) — ${win.toFixed(0)}% win la pick ${pick.toFixed(0)}%: prea tare și folosit des.` });
    else if (pick < 8) recos.push({ sev: 1, t: `🔺 <b>Buff ${name}</b> (${race}) — pick doar ${pick.toFixed(0)}%: aproape ignorat (prea slab sau prea scump).` });
    else if (win <= 38 && pick >= 15) recos.push({ sev: 1, t: `🔺 <b>Buff ${name}</b> (${race}) — doar ${win.toFixed(0)}% win deși e folosit des: subperformează.` });
  }
  if (!recos.length) { el.innerHTML = '<li style="color:#58d68d">Echilibrat — nicio modificare evidentă din date. 👍</li>'; return; }
  recos.sort((a, b) => b.sev - a.sev);
  el.innerHTML = recos.map((r) => `<li>${r.t}</li>`).join('');
}

function drawChart() {
  const cv = $('chart'); const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (history.length < 2) return;
  const pad = 24;
  const xs = (i) => pad + (W - 2 * pad) * (i / (history.length - 1));
  const ys = (v) => H - pad - (H - 2 * pad) * v; // fitness 0..1
  ctx.strokeStyle = '#1d2431'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) { const y = pad + (H - 2 * pad) * g / 4; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); }
  const line = (sel, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    history.forEach((h, i) => { const x = xs(i), y = ys(sel(h)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  };
  line((h) => h.avg, '#4da6ff');
  line((h) => h.best, '#ffd35c');
  ctx.fillStyle = '#7c8ba1'; ctx.font = '11px sans-serif';
  ctx.fillText('■ mediu', pad, 14); ctx.fillStyle = '#ffd35c'; ctx.fillText('■ cel mai bun', pad + 60, 14);
}

// ---- wire up ---------------------------------------------------------------
let balanceData = {};
async function init() {
  // load the user's saved balance so training uses the real, tuned units
  await loadBalance('../assets/').catch(() => {});
  try {
    const res = await fetch('save-balance.php', { headers: { 'X-DS-Balance': '1' } });
    balanceData = await res.json();
    if (balanceData && typeof balanceData === 'object') applyBalance(balanceData);
  } catch { balanceData = {}; }
  populateRaceSelects();
  const n = setupWorkers(balanceData);
  setStatus(`gata · ${n} nuclee`, false);
  if (loadCheckpoint()) setStatus(`checkpoint găsit · generația ${generation}. Apasă Start pentru a continua.`, false);
  else seedPopulation(clampInt($('c-pop').value, 24));
  render(); updateButtons();
}

// Fill the two showcase race dropdowns: "Aleatoriu" + every race.
function populateRaceSelects() {
  const opts = '<option value="">Aleatoriu</option>' + RACES.map((r) => `<option value="${r}">${r}</option>`).join('');
  for (const id of ['c-raceA', 'c-raceB']) { const s = $(id); if (s && !s.options.length) s.innerHTML = opts; }
}

const clampInt = (v, d) => { const n = parseInt(v, 10); return isFinite(n) ? n : d; };
const cfg = () => ({
  matches: Math.max(2, clampInt($('c-matches').value, 6)),
  secs: Math.max(40, clampInt($('c-secs').value, 140)),
  mut: Math.max(0.01, clampInt($('c-mut').value, 25) / 100),
});

$('b-start').addEventListener('click', () => {
  if (running && paused) { paused = false; updateButtons(); setStatus('rulează…', true); return; }
  if (running) return;
  const size = clampInt($('c-pop').value, 24);
  if (!population.length || population.length !== size) {
    if (!population.length) seedPopulation(size);
    else { while (population.length < size) population.push(randomGenome(rng)); population.length = size; }
  }
  updateButtons();
  evolve(cfg());
});
$('b-pause').addEventListener('click', () => { if (running) { paused = !paused; updateButtons(); setStatus(paused ? 'în pauză.' : 'rulează…', !paused); } });
$('b-stop').addEventListener('click', () => { stopReq = true; paused = false; });
$('b-reset').addEventListener('click', () => {
  if (!confirm('Resetezi antrenamentul (populație + statistici)?')) return;
  stopReq = true; seedPopulation(clampInt($('c-pop').value, 24)); matchesDone = 0;
  try { localStorage.removeItem(LS_KEY); } catch {}
  render(); setStatus('resetat.', false);
});
$('b-apply').addEventListener('click', async () => {
  if (!best) { setStatus('n-am încă un creier evoluat.', false); return; }
  setAIGenome(cleanGenome(best));
  setStatus('se salvează în joc…', false);
  const r = await saveBalance('save-balance.php');
  setStatus(r === 'ok' ? 'aplicat ✓ AI-ul din joc folosește creierul evoluat.' : 'salvare eșuată (' + r + ')', false);
});
// Clear the applied brain from balance.json — the in-game AI reverts to the
// hand-tuned default. (Doesn't touch the current training population.)
$('b-brain-reset').addEventListener('click', async () => {
  if (!confirm('Resetezi creierul din joc? AI-ul revine la comportamentul default (nu se șterge antrenamentul curent).')) return;
  setAIGenome(null);
  setStatus('se resetează creierul din joc…', false);
  const r = await saveBalance('save-balance.php');
  setStatus(r === 'ok' ? 'creier resetat ✓ AI-ul din joc folosește comportamentul default.' : 'salvare eșuată (' + r + ')', false);
});
$('b-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ best, population, generation, history, stat }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ds-ai-training.json'; a.click();
});
$('b-import').addEventListener('click', () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
  inp.onchange = async () => {
    try {
      const s = JSON.parse(await inp.files[0].text());
      if (Array.isArray(s.population)) population = s.population.map(cleanGenome);
      generation = s.generation || 0; history = s.history || []; stat = s.stat || stat; best = s.best ? cleanGenome(s.best) : population[0];
      saveCheckpoint(); render(); setStatus('import ok.', false);
    } catch { setStatus('fișier invalid.', false); }
  };
  inp.click();
});

init();
