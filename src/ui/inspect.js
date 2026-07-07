// WC3-style selection panel ("inspect"): click a template, a live unit or a
// structure to see its portrait, stats, live HP/mana, active buffs/debuffs —
// and, for your own unit types, toggle ability autocast and owned upgrades
// on/off (per TYPE, so every unit of that kind follows the setting).
//
// Pure UI: every change goes through game.issueCommand (toggleAbility /
// toggleUpgrade / sellUnit / sellBuilding), keeping the sim deterministic.

import { CONFIG } from '../config.js';
import { resolvedAbility, resolvedUpgrade } from './balance.js';
import { UPGRADE_IDS } from '../upgrades.js';
import { raceOf, getSprite } from '../render/sprites.js';
import { hasCharacter, drawCharacter, drawThumb } from '../render/characters.js';
import { TEAM_COLORS, drawShape } from '../render/renderer.js';

const STATUS_LABELS = {
  atkslow: ['🐌', 'Atac încetinit', '#7fb4ff'],
  moveslow: ['❄', 'Mișcare încetinită', '#8fe3ff'],
  haste: ['⚡', 'Haste', '#ffd35c'],
  regen: ['✚', 'Regenerare', '#58d68d'],
  immune: ['🛡', 'Imun la debuff', '#ffe9a8'],
  nobuff: ['🚫', 'Nu primește buff-uri', '#ff8090'],
};

export class InspectPanel {
  constructor(uiState, getGame) {
    this.uiState = uiState;
    this.getGame = getGame;
    this.key = null; // identity of the last full rebuild

    const style = document.createElement('style');
    style.textContent = `
      #inspect { position: absolute; left: 244px; bottom: 12px; z-index: 5;
        width: 460px; max-width: calc(100vw - 470px);
        background: rgba(16, 21, 30, 0.94); border: 1px solid #2a3446; border-radius: 10px;
        padding: 10px 12px; color: #dbe4f0; font-size: 12px; display: none;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45); }
      #inspect.on { display: block; }
      #inspect .ip-head { display: flex; gap: 10px; align-items: flex-start; }
      #inspect .ip-portrait { width: 64px; height: 64px; flex: 0 0 64px; background: #0a0e14;
        border: 1px solid #2a3446; border-radius: 8px; overflow: hidden; }
      #inspect .ip-title { display: flex; align-items: baseline; gap: 8px; }
      #inspect .ip-name { font-weight: 700; font-size: 14px; color: #eaf1fb; }
      #inspect .ip-name.enemy { color: #ff8090; }
      #inspect .ip-sub { color: #7c8ba1; font-size: 11px; }
      #inspect .ip-x { position: absolute; top: 6px; right: 8px; background: none; border: none;
        color: #7c8ba1; font-size: 14px; cursor: pointer; }
      #inspect .ip-x:hover { color: #fff; }
      #inspect .ip-bar { height: 8px; border-radius: 4px; background: rgba(0,0,0,0.55);
        margin-top: 5px; position: relative; overflow: hidden; }
      #inspect .ip-bar > div { height: 100%; border-radius: 4px; }
      #inspect .ip-bar .hp { background: #58d68d; }
      #inspect .ip-bar .hp.enemy { background: #ff5566; }
      #inspect .ip-bar .mana { background: #4da6ff; }
      #inspect .ip-bar span { position: absolute; inset: 0; text-align: center; font-size: 8.5px;
        line-height: 9px; color: #eaf1fb; text-shadow: 0 1px 2px #000; }
      #inspect .ip-stats { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px;
        color: #b9c4d4; }
      #inspect .ip-stats b { color: #eaf1fb; font-weight: 600; }
      #inspect .ip-status { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; min-height: 0; }
      #inspect .ip-chip { border: 1px solid #2a3446; border-radius: 20px; padding: 1px 8px;
        font-size: 10.5px; background: #10151d; }
      #inspect .ip-sect { margin-top: 8px; }
      #inspect .ip-sect-t { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
        color: #7c8ba1; margin-bottom: 4px; }
      #inspect .ip-cmds { display: flex; flex-wrap: wrap; gap: 6px; }
      #inspect .ip-abil { display: flex; align-items: center; gap: 6px; padding: 4px 9px;
        border-radius: 8px; border: 1.5px solid #2a3446; background: #131924; cursor: pointer;
        font-size: 11.5px; user-select: none; }
      #inspect .ip-abil .dot { width: 7px; height: 7px; border-radius: 50%; background: #3a4356; }
      #inspect .ip-abil.on { border-color: #58d68d; }
      #inspect .ip-abil.on .dot { background: #58d68d; box-shadow: 0 0 6px #58d68d; }
      #inspect .ip-abil.off { opacity: 0.65; }
      #inspect .ip-abil.locked { opacity: 0.5; cursor: default; }
      #inspect .ip-abil .cd { color: #ffd35c; font-size: 10px; }
      #inspect .ip-abil .mc { color: #4da6ff; font-size: 10px; }
      #inspect .ip-abil.ro { cursor: default; }
      #inspect .ip-upg { display: flex; align-items: center; gap: 6px; padding: 4px 9px;
        border-radius: 8px; border: 1.5px solid #2a3446; background: #131924; cursor: pointer;
        font-size: 11.5px; user-select: none; }
      #inspect .ip-upg.owned { border-color: #ffb35c; }
      #inspect .ip-upg.owned.off { border-color: #6b5330; opacity: 0.65; }
      #inspect .ip-upg.unowned { opacity: 0.45; cursor: default; }
      #inspect .ip-upg .st { font-size: 10px; color: #7c8ba1; }
      #inspect .ip-upg.owned:not(.off) .st { color: #8fe0a6; }
      #inspect .ip-sell { margin-top: 8px; padding: 5px 14px; font-size: 11.5px; cursor: pointer;
        background: #3a1519; color: #ffb0ba; border: 1px solid #7a2a33; border-radius: 8px; }
      #inspect .ip-sell:hover { background: #4d1c22; }
      #inspect .ip-note { margin-top: 6px; color: #7c8ba1; font-size: 10.5px; }
    `;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'inspect';
    document.getElementById('canvas-wrap').appendChild(el);
    this.el = el;
    // panel clicks must never fall through to the map
    el.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // Resolve uiState.inspect to a live description, or null when stale.
  resolve(game) {
    const sel = this.uiState.inspect;
    if (!sel || !game) return null;
    if (sel.kind === 'template') {
      const tpl = game.templates[0][sel.index];
      if (!tpl) return null;
      return { kind: 'template', team: 0, type: tpl.type, tpl, index: sel.index };
    }
    if (sel.kind === 'entity') {
      const u = game.byId.get(sel.id);
      if (!u || u.hp <= 0) return null;
      return { kind: 'entity', team: u.team, type: u.type, u };
    }
    if (sel.kind === 'structure') {
      const s = game.structures.find((st) => st.id === sel.id);
      if (!s || (s.hp <= 0 && s.kind !== 'main')) return null;
      return { kind: 'structure', team: s.team, type: s.kind, s };
    }
    return null;
  }

  update(game) {
    const info = this.resolve(game);
    if (!info) {
      if (this.uiState.inspect) this.uiState.inspect = null; // stale (sold/died)
      this.el.classList.remove('on');
      this.key = null;
      return;
    }
    this.el.classList.add('on');

    // Full rebuild only when the selection identity or toggle-relevant state
    // changes; bars/status/cooldowns refresh in place every frame.
    const key = this.buildKey(game, info);
    if (key !== this.key) {
      this.key = key;
      this.rebuild(game, info);
    }
    this.refreshLive(game, info);
  }

  buildKey(game, info) {
    const sel = this.uiState.inspect;
    const toggles = info.kind !== 'structure'
      ? [...game.abilityOff[info.team]].filter((k) => k.startsWith(`${info.type}/`)).sort().join(',')
      : '';
    const upgs = [...game.upgrades[info.team]].sort().join(',') + '|' +
      [...game.upgradeOff[info.team]].sort().join(',');
    const spawned = info.kind === 'template' ? !!info.tpl.spawned : '';
    return `${info.kind}:${sel.id ?? sel.index}:${info.type}:${info.team}:${game.tier[info.team]}:${toggles}:${upgs}:${spawned}`;
  }

  rebuild(game, info) {
    const own = info.team === 0;
    const race = raceOf(info.team);
    const isStruct = info.kind === 'structure';
    const stats = isStruct ? game.bstat(info.team, info.type) : game.ustat(info.team, info.type);
    const name = stats.name || info.type;

    let sub;
    if (isStruct) {
      sub = info.type === 'main' ? `Tier ${'I'.repeat(game.tier[info.team])}` : `Clădire${stats.cost ? ` · ◆ ${stats.cost}` : ''}`;
    } else {
      sub = `Tier ${stats.tier} · ◆ ${stats.cost}` + (info.kind === 'template' ? (info.tpl.spawned ? '' : ' · nou (nespawnat)') : '');
    }

    // ---- stats line -------------------------------------------------------
    const rows = [];
    if (!isStruct) {
      const dps = stats.heal
        ? `<b>${(stats.damage / stats.period).toFixed(0)}</b> HP/s vindecare`
        : `⚔ <b>${stats.damage}</b> (${stats.dmgType}) · <b>${(stats.damage / Math.max(0.1, stats.period)).toFixed(1)}</b> DPS`;
      rows.push(dps, `🛡 <b>${stats.armor}</b>`, `➹ rază <b>${stats.range}</b>`, `🥾 viteză <b>${stats.speed}</b>`);
      if (stats.isAir) rows.push('☁ zburător');
      if (stats.targetsAir) rows.push('🎯 lovește aer');
      if (stats.targetsGround === false) rows.push('⛔ nu lovește sol');
    } else {
      if (stats.damage) rows.push(`⚔ <b>${stats.damage}</b> · <b>${(stats.damage / Math.max(0.1, stats.period || 1)).toFixed(1)}</b> DPS`, `➹ rază <b>${stats.range}</b>`);
      if (stats.income) rows.push(`◆ +<b>${stats.income}</b> aur / 20s`);
      if (info.type === 'main') rows.push('🏰 obiectivul principal');
    }

    // ---- command card: abilities ------------------------------------------
    let abilHtml = '';
    if (!isStruct && stats.caster && stats.abilities && stats.abilities.length) {
      const chips = stats.abilities.map((aid) => {
        const ab = resolvedAbility(aid);
        if (!ab) return '';
        const req = Math.max(1, ab.params.tier || 1);
        const locked = game.tier[info.team] < req;
        const off = game.abilityOff[info.team].has(`${info.type}/${aid}`);
        const cls = locked ? 'locked' : off ? 'off' : 'on';
        const ro = own ? '' : ' ro';
        const lockTag = locked ? ` 🔒T${req}` : '';
        return `<div class="ip-abil ${cls}${ro}" data-abil="${aid}" title="${ab.desc || ''}${own ? '\nClick: pornește/oprește autocast (pe tot tipul)' : ''}">
          <span class="dot"></span>
          <span style="color:${ab.color || '#dbe4f0'}">${ab.name}</span>${lockTag}
          <span class="mc">💧${ab.params.manaCost || 0}</span>
          <span class="cd" data-cd="${aid}"></span>
        </div>`;
      }).join('');
      abilHtml = `<div class="ip-sect"><div class="ip-sect-t">Abilități (autocast)</div><div class="ip-cmds">${chips}</div></div>`;
    }

    // ---- equipped upgrades (the WC3 "inventory" row) ------------------------
    let upgHtml = '';
    if (!isStruct) {
      const slots = UPGRADE_IDS.map((id) => ({ id, up: resolvedUpgrade(id) }))
        .filter(({ up }) => up && up.unit === info.type && (!up.race || up.race === race));
      if (slots.length) {
        const chips = slots.map(({ id, up }) => {
          const owned = game.upgrades[info.team].has(id);
          const off = owned && game.upgradeOff[info.team].has(id);
          const cls = owned ? (off ? 'owned off' : 'owned') : 'unowned';
          const st = owned ? (off ? 'dezactivat' : 'activ') : `◆ ${up.params.cost || 0} — din Bază`;
          return `<div class="ip-upg ${cls}" data-upg="${owned && own ? id : ''}" title="${up.desc || ''}${owned && own ? '\nClick: activează/dezactivează' : ''}">
            🐗 ${up.name} <span class="st">${st}</span>
          </div>`;
        }).join('');
        upgHtml = `<div class="ip-sect"><div class="ip-sect-t">Upgrade-uri echipate</div><div class="ip-cmds">${chips}</div></div>`;
      }
    }

    // ---- sell action --------------------------------------------------------
    let sellHtml = '';
    if (own && info.kind === 'template') {
      const full = !info.tpl.spawned;
      const refund = Math.round(stats.cost * (full ? 1 : CONFIG.SELL_REFUND));
      sellHtml = `<button class="ip-sell" data-sell="unit">Vinde ◆ ${refund}${full ? ' (100%)' : ''}</button>`;
    } else if (own && isStruct && CONFIG.BUILDINGS[info.type]) {
      const refund = Math.round(stats.cost * CONFIG.SELL_BUILDING_REFUND);
      sellHtml = `<button class="ip-sell" data-sell="building">Vinde ◆ ${refund}</button>`;
    }

    const manaBar = !isStruct && stats.caster
      ? `<div class="ip-bar"><div class="mana" data-bar="mana" style="width:100%"></div><span data-num="mana"></span></div>`
      : '';

    this.el.innerHTML = `
      <button class="ip-x" title="Închide (Esc)">✕</button>
      <div class="ip-head">
        <canvas class="ip-portrait" width="64" height="64"></canvas>
        <div style="flex:1;min-width:0">
          <div class="ip-title"><span class="ip-name ${own ? '' : 'enemy'}">${name}</span><span class="ip-sub">${sub}${own ? '' : ' · INAMIC'}</span></div>
          <div class="ip-bar"><div class="hp ${own ? '' : 'enemy'}" data-bar="hp" style="width:100%"></div><span data-num="hp"></span></div>
          ${manaBar}
          <div class="ip-stats">${rows.map((r) => `<span>${r}</span>`).join('')}</div>
          <div class="ip-status" data-status></div>
        </div>
      </div>
      ${abilHtml}${upgHtml}${sellHtml}
      ${own && info.kind !== 'entity' && (abilHtml || upgHtml) ? '<div class="ip-note">Setările se aplică la TOATE unitățile de acest tip.</div>' : ''}
    `;

    // ---- portrait -----------------------------------------------------------
    this.portrait = this.el.querySelector('.ip-portrait');
    this.drawPortrait(game, info);

    // ---- interactions -------------------------------------------------------
    this.el.querySelector('.ip-x').onclick = () => { this.uiState.inspect = null; };
    if (own) {
      for (const chip of this.el.querySelectorAll('[data-abil]')) {
        chip.onclick = () => {
          const aid = chip.dataset.abil;
          const on = game.abilityOff[0].has(`${info.type}/${aid}`); // off -> turn on
          game.issueCommand({ type: 'toggleAbility', team: 0, unit: info.type, ability: aid, on });
        };
      }
      for (const chip of this.el.querySelectorAll('[data-upg]')) {
        if (!chip.dataset.upg) continue;
        chip.onclick = () => {
          const id = chip.dataset.upg;
          const on = game.upgradeOff[0].has(id); // off -> turn on
          game.issueCommand({ type: 'toggleUpgrade', team: 0, id, on });
        };
      }
      const sell = this.el.querySelector('[data-sell]');
      if (sell) {
        sell.onclick = () => {
          if (sell.dataset.sell === 'unit') {
            game.issueCommand({ type: 'sellUnit', team: 0, index: this.uiState.inspect.index });
          } else {
            game.issueCommand({ type: 'sellBuilding', team: 0, id: this.uiState.inspect.id });
          }
          this.uiState.inspect = null;
        };
      }
    }
  }

  // Per-frame updates: HP/mana bars, status chips, ability cooldowns, portrait.
  refreshLive(game, info) {
    const isStruct = info.kind === 'structure';
    const stats = isStruct ? game.bstat(info.team, info.type) : game.ustat(info.team, info.type);
    let hp; let maxHp; let mana = 0; let manaMax = 0;
    if (info.kind === 'entity') {
      hp = info.u.hp; maxHp = info.u.maxHp; mana = info.u.mana || 0; manaMax = info.u.manaMax || 0;
    } else if (isStruct) {
      hp = info.s.hp; maxHp = info.s.maxHp;
    } else {
      hp = maxHp = stats.hp; mana = manaMax = stats.caster ? stats.mana : 0;
    }
    const hpBar = this.el.querySelector('[data-bar="hp"]');
    const hpNum = this.el.querySelector('[data-num="hp"]');
    if (hpBar) hpBar.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
    if (hpNum) hpNum.textContent = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
    const mBar = this.el.querySelector('[data-bar="mana"]');
    const mNum = this.el.querySelector('[data-num="mana"]');
    if (mBar && manaMax > 0) mBar.style.width = `${Math.max(0, (mana / manaMax) * 100)}%`;
    if (mNum) mNum.textContent = `${Math.floor(mana)} / ${manaMax}`;

    // status chips (live entities only)
    const box = this.el.querySelector('[data-status]');
    if (box) {
      let html = '';
      if (info.kind === 'entity' && info.u.effects) {
        for (const e of info.u.effects) {
          const meta = STATUS_LABELS[e.kind];
          if (!meta || e.until <= game.time) continue;
          html += `<span class="ip-chip" style="border-color:${meta[2]};color:${meta[2]}">${meta[0]} ${meta[1]} · ${Math.ceil(e.until - game.time)}s</span>`;
        }
        if (info.u.dismounted) html += '<span class="ip-chip" style="border-color:#ffb35c;color:#ffb35c">🐗 pe jos (dismount)</span>';
        const tgt = info.u.targetId != null ? game.byId.get(info.u.targetId) : null;
        if (tgt && tgt.hp > 0) {
          const ts = game.ustat(tgt.team, tgt.type);
          html += `<span class="ip-chip">🎯 țintă: ${(ts && ts.name) || tgt.type}</span>`;
        }
      }
      box.innerHTML = html;
    }

    // ability cooldowns (live entities)
    if (info.kind === 'entity' && info.u.abilityCd) {
      for (const cdEl of this.el.querySelectorAll('[data-cd]')) {
        const left = (info.u.abilityCd[cdEl.dataset.cd] || 0) - game.time;
        cdEl.textContent = left > 0 ? `⏳${left.toFixed(1)}s` : '';
      }
    }

    this.drawPortrait(game, info);
  }

  // Animated idle portrait: uploaded idle frames > thumb > vector puppet > shape.
  drawPortrait(game, info) {
    const cv = this.portrait;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    const race = raceOf(info.team);
    const frame = Math.floor(performance.now() / 500) % 2;
    const entry = getSprite(race, info.type, 'idle', frame) || getSprite(race, info.type, 'idle', 0);
    if (entry && entry.img) {
      const img = entry.img;
      const s = Math.min(58 / img.width, 58 / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      ctx.drawImage(img, (64 - dw) / 2, (64 - dh) / 2, dw, dh);
      return;
    }
    ctx.save();
    ctx.translate(32, 33);
    if (drawThumb(ctx, info.type, info.team, 54)) { ctx.restore(); return; }
    ctx.restore();
    if (info.kind !== 'structure' && hasCharacter(info.type)) {
      ctx.save();
      ctx.translate(32, 34);
      drawCharacter(ctx, info.type, 'idle', 0, 0, 1.5);
      ctx.restore();
      return;
    }
    // plain shape fallback (matches the on-map vector art)
    ctx.save();
    ctx.translate(32, 32);
    ctx.fillStyle = TEAM_COLORS[info.team];
    if (info.kind === 'structure') {
      ctx.fillStyle = '#2d3a4f';
      ctx.fillRect(-18, -18, 36, 36);
      ctx.strokeStyle = TEAM_COLORS[info.team];
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-18, -18, 36, 36);
    } else {
      const stats = game.ustat(info.team, info.type);
      drawShape(ctx, stats.shape || 'circle', 16);
      ctx.fill();
    }
    ctx.restore();
  }
}
