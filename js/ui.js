'use strict';
// DOM user interface: top bar, toolbar, panels, modals, minimap.

const $ = (id) => document.getElementById(id);
const SAVE_PREFIX = 'citybuilder:save:';

class UI {
  constructor(game, renderer) {
    this.game = game;
    this.r = renderer;
    this.openCat = null;
    this.inspect = null;
    this.legendText = {
      power: 'Yellow = powered network · Red = building without power',
      water: 'Blue = water network · Red = building without water',
      landValue: 'Red = low value · Green = high value',
      pollution: 'Yellow = light · Brown = heavy pollution',
      crime: 'Green = safe · Red = dangerous',
      traffic: 'Green = free flow · Yellow = busy · Red = jammed',
      police: 'Darker blue = better coverage', fire: 'Darker blue = better coverage', health: 'Darker blue = better coverage',
      edu: 'Darker blue = better coverage', garbage: 'Darker blue = better coverage',
    };
  }

  init() {
    this.buildToolbar();
    this.buildOverlays();
    document.querySelectorAll('.speeds button').forEach(b => b.onclick = () => this.setSpeed(+b.dataset.speed));
    $('btnBudget').onclick = () => this.showBudget();
    $('btnStats').onclick = () => this.showStats();
    $('btnNight').onclick = () => { this.r.dayNight = !this.r.dayNight; if (!this.r.dayNight) this.r.tod = 0.5; $('btnNight').classList.toggle('active', !this.r.dayNight); this.saveSettings(); };
    $('btnSave').onclick = () => this.quickSave();
    $('btnMenu').onclick = () => this.showMenu();
    $('btnHelp').onclick = () => this.showHelp();
    $('modalBg').addEventListener('pointerdown', (e) => { if (e.target === $('modalBg') && this.modalClosable) this.closeModal(); });
    this.game.on('toast', (t) => this.toast(t));
    this.game.on('shake', (s) => { this.r.shakeT = s; });
    this.game.on('month', () => { if (this.modalKind === 'budget') this.renderBudget(); if (this.modalKind === 'stats') this.renderStats(); });
    this.game.on('loaded', () => { this.selectTool('inspect'); this.closeSub(); this.hideInfo(); this.refreshSubmenu(); });
    this.game.on('rankup', () => this.refreshSubmenu());
    const mm = $('minimap');
    const mmMove = (e) => {
      const rect = mm.getBoundingClientRect();
      const t = this.minimapToTile((e.clientX - rect.left) / rect.width * mm.width, (e.clientY - rect.top) / rect.height * mm.height);
      if (t) { this.r.centerOn(t[0], t[1]); this.r.clampCam(); }
    };
    mm.addEventListener('pointerdown', (e) => { mmMove(e); mm.setPointerCapture(e.pointerId); mm.onpointermove = mmMove; });
    mm.addEventListener('pointerup', () => { mm.onpointermove = null; });
    this.loadSettings();
    setInterval(() => this.update(), 250);
    setInterval(() => this.drawMinimap(), 700);
  }

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('citybuilder:settings') || '{}');
      if (s.dayNight === false) { this.r.dayNight = false; this.r.tod = 0.5; $('btnNight').classList.add('active'); }
    } catch (e) { /* ignore */ }
  }
  saveSettings() {
    try { localStorage.setItem('citybuilder:settings', JSON.stringify({ dayNight: this.r.dayNight })); } catch (e) { /* ignore */ }
  }

  // ---------- toolbar ----------
  buildToolbar() {
    const tb = $('toolbar');
    tb.innerHTML = '';
    for (const cat of CATEGORIES) {
      const b = document.createElement('button');
      b.textContent = cat.icon;
      b.title = cat.name;
      b.dataset.cat = cat.id;
      b.onclick = () => {
        if (cat.tool) { this.selectTool(cat.tool); this.closeSub(); return; }
        if (this.openCat === cat.id) this.closeSub(); else this.openSub(cat);
      };
      tb.appendChild(b);
    }
  }
  openSub(cat) {
    this.openCat = cat.id;
    const sm = $('submenu');
    sm.classList.remove('hidden');
    sm.innerHTML = `<h3>${cat.name}</h3>`;
    for (const id of cat.items) {
      const t = TOOLS[id];
      const el = document.createElement('div');
      el.className = 'item';
      el.dataset.tool = id;
      const unlocked = this.game.isUnlocked(id);
      if (!unlocked) el.classList.add('locked');
      if (this.game.tool === id) el.classList.add('active');
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (t.kind === 'building') thumb.appendChild(this.thumbFor(t.building));
      else thumb.textContent = t.icon || '•';
      el.appendChild(thumb);
      const d = t.kind === 'building' ? BUILDINGS[t.building] : null;
      const meta = document.createElement('div');
      meta.className = 'meta';
      let costTxt = '';
      if (d) costTxt = `${fmtMoney(d.cost)} · ${d.w}×${d.h}` + (d.upkeep ? ` · ${fmtMoney(d.upkeep)}/mo` : '');
      else if (t.cost) costTxt = `${fmtMoney(t.cost)} / tile`;
      meta.innerHTML = `<div class="name">${t.name}${t.key ? ` <span class="sub">(${t.key})</span>` : ''}</div>` +
        (costTxt ? `<div class="cost">${costTxt}</div>` : '') +
        `<div class="desc">${t.desc || ''}</div>` +
        (!unlocked ? `<div class="lock">🔒 Unlocks at ${fmtNum(d.unlock)} population</div>` : '');
      el.appendChild(meta);
      el.onclick = () => { if (!this.game.isUnlocked(id)) return; this.selectTool(id); };
      sm.appendChild(el);
    }
    document.querySelectorAll('#toolbar button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat.id || this.toolCat() === b.dataset.cat));
  }
  refreshSubmenu() {
    if (!this.openCat) return;
    const cat = CATEGORIES.find(c => c.id === this.openCat);
    if (cat) this.openSub(cat);
  }
  closeSub() {
    this.openCat = null;
    $('submenu').classList.add('hidden');
    this.markToolbar();
  }
  thumbFor(type) {
    const s = specialSprite(type);
    const c = document.createElement('canvas');
    const sc = Math.min(52 / s.w, 52 / s.h) * 2;
    c.width = Math.ceil(s.w * sc); c.height = Math.ceil(s.h * sc);
    c.style.width = (c.width / 2) + 'px'; c.style.height = (c.height / 2) + 'px';
    c.getContext('2d').drawImage(s.c, 0, 0, c.width, c.height);
    return c;
  }
  toolCat() {
    for (const c of CATEGORIES) if (c.tool === this.game.tool || (c.items && c.items.includes(this.game.tool))) return c.id;
    return null;
  }
  markToolbar() {
    const tc = this.toolCat();
    document.querySelectorAll('#toolbar button').forEach(b => b.classList.toggle('active', b.dataset.cat === tc || b.dataset.cat === this.openCat));
  }
  selectTool(id) {
    if (!TOOLS[id]) return;
    this.game.tool = id;
    this.r.preview = null;
    document.querySelectorAll('#submenu .item').forEach(e => e.classList.toggle('active', e.dataset.tool === id));
    this.markToolbar();
    const t = TOOLS[id];
    let hint = '';
    switch (t.kind) {
      case 'inspect': hint = 'Click anything to inspect it · Right-drag or WASD to move · Scroll to zoom'; break;
      case 'bulldoze': hint = 'Drag to demolish an area'; break;
      case 'road': hint = 'Drag to build road ($10/tile, bridges $50) · Zones grow up to 3 tiles from a road'; break;
      case 'pline': hint = 'Drag to build power lines. Roads, zones and buildings also carry power'; break;
      case 'zone': hint = `Drag to zone ${t.name.toLowerCase()} ($5/tile). Needs road access + power`; break;
      case 'dezone': hint = 'Drag to remove zoning'; break;
      case 'tree': hint = 'Drag to plant trees ($5/tile). They clean the air'; break;
      case 'building': hint = `Click to place ${t.name} · ${BUILDINGS[t.building].desc}`; break;
      case 'disaster': hint = `Click on the map: ${t.desc}`; break;
    }
    $('toolHint').textContent = hint;
  }

  buildOverlays() {
    const ob = $('overlaybar');
    for (const o of OVERLAYS) {
      const b = document.createElement('button');
      b.textContent = o.icon;
      b.title = o.name + ' overlay';
      b.dataset.ov = o.id;
      b.onclick = () => this.setOverlay(this.game.overlay === o.id ? 'none' : o.id);
      ob.appendChild(b);
    }
    this.setOverlay('none');
  }
  setOverlay(id) {
    this.game.overlay = id;
    document.querySelectorAll('#overlaybar button').forEach(b => b.classList.toggle('active', b.dataset.ov === id));
    const lg = $('legend');
    if (id === 'none') lg.classList.add('hidden');
    else { lg.classList.remove('hidden'); lg.textContent = `${OVERLAYS.find(o => o.id === id).name}: ${this.legendText[id] || ''}`; }
  }

  setSpeed(s) {
    this.game.speed = s;
    document.querySelectorAll('.speeds button').forEach(b => b.classList.toggle('active', +b.dataset.speed === s));
  }

  // ---------- top bar ----------
  update() {
    const g = this.game, st = g.state, s = g.stats;
    if (!st) return;
    $('cityName').textContent = st.name;
    $('cityRank').textContent = CITY_RANKS[st.rank].title + (st.sandbox ? ' · sandbox' : '');
    $('money').textContent = st.sandbox ? '∞' : fmtMoney(st.money);
    $('money').className = st.money < 0 && !st.sandbox ? 'money-neg' : '';
    if (st.report) {
      const n = st.report.net;
      $('moneyDelta').innerHTML = `<span class="${n >= 0 ? 'money-pos' : 'money-neg'}">${n >= 0 ? '+' : ''}${fmtMoney(n)}</span>/mo`;
    } else $('moneyDelta').textContent = 'first report soon';
    $('pop').textContent = fmtNum(s.pop);
    $('popSub').textContent = `${fmtNum(s.jobs)} jobs`;
    const h = Math.round(st.happiness);
    $('happy').textContent = h + '%';
    $('happyIco').textContent = h >= 75 ? '😄' : h >= 55 ? '🙂' : h >= 35 ? '😐' : '😠';
    const dd = st.day, year = 2000 + Math.floor(dd / 360), mon = Math.floor((dd % 360) / 30), dom = dd % 30 + 1;
    $('date').textContent = `${dom} ${MONTHS[mon]} ${year}`;
    const mins = Math.floor(this.r.tod * 24 * 60);
    $('clock').textContent = this.r.dayNight ? `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}` : 'always day';
    const setBar = (el, v) => {
      v = clamp(v, -1, 1);
      if (v >= 0) { el.style.top = (50 - v * 50) + '%'; el.style.bottom = '50%'; }
      else { el.style.top = '50%'; el.style.bottom = (50 + v * 50) + '%'; }
      el.style.opacity = v >= 0 ? 1 : 0.5;
    };
    setBar($('dR'), st.demand.r); setBar($('dC'), st.demand.c); setBar($('dI'), st.demand.i);
    if (this.inspect) this.renderInfo();
    const unlocked = Object.keys(TOOLS).filter(k => this.game.isUnlocked(k)).length;
    if (unlocked !== this._lastUnlocked) { this._lastUnlocked = unlocked; this.refreshSubmenu(); }
  }

  // ---------- toasts ----------
  toast(t) {
    const el = document.createElement('div');
    el.className = 'toast ' + t.type + (t.loc ? ' loc' : '');
    el.textContent = t.msg;
    if (t.loc) { el.title = 'Click to jump there'; el.onclick = () => { this.r.centerOn(t.loc[0], t.loc[1]); }; }
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, t.type === 'bad' ? 7000 : 5000);
  }

  // ---------- info panel ----------
  showInfo(x, y) {
    const w = this.game.world;
    if (!w.inb(x, y)) { this.hideInfo(); return; }
    this.inspect = { x, y };
    $('infoPanel').classList.remove('hidden');
    this.renderInfo();
  }
  hideInfo() { this.inspect = null; $('infoPanel').classList.add('hidden'); }
  meter(v, good) {
    const pct = Math.round(clamp(v, 0, 1) * 100);
    const col = good ? mixHex('#c0392b', '#2ecc71', v) : mixHex('#2ecc71', '#c0392b', v);
    return `<div class="meter"><div style="width:${pct}%;background:${col}"></div></div>`;
  }
  renderInfo() {
    const g = this.game, w = g.world, { x, y } = this.inspect, i = w.idx(x, y);
    const b = w.buildingAt(x, y);
    const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
    const yn = (v) => v ? '<span class="ok">Yes</span>' : '<span class="no">No</span>';
    let title = '', sub = '', rows = '';
    if (b) {
      title = g.bName(b);
      if (b.zoned) {
        sub = b.constructing ? '🏗️ Under construction' : b.abandoned ? '🏚️ Abandoned' : b.onFire ? '🔥 On fire!' : `Level ${b.level}`;
        if (b.type === 'R') rows += kv('Residents', fmtNum(b.pop));
        else rows += kv('Jobs', fmtNum(b.jobs));
        rows += kv('Power', yn(b.powered));
        rows += kv('Water', b.level >= 2 || b.watered ? yn(b.watered) : (b.watered ? yn(true) : '<span class="sub">needed for level 2+</span>'));
        rows += kv('Road access', yn(w.roadDist[i] <= 3));
        if (!b.abandoned && !b.constructing) {
          let why = '';
          if (b.level < 3) {
            if (!b.watered) why = 'Needs water to grow';
            else if (w.landValue[i] <= 0.3) why = 'Needs higher land value (parks, services, less pollution)';
            else if (b.level === 2 && w.landValue[i] <= 0.5) why = 'Needs land value above 50% for level 3';
            else if (b.level === 2 && g.stats.pop <= 1200) why = 'City needs 1,200+ people for towers';
            else if (b.type === 'R' && w.pollution[i] > 55) why = 'Too polluted to grow';
            else if (b.type !== 'R' && b.level === 2 && w.cov.edu[i] < 0.2) why = 'Needs education coverage';
            else why = 'Waiting for demand';
          }
          if (why) rows += kv('Growth', `<span class="sub">${why}</span>`);
        }
      } else {
        const d = BUILDINGS[b.type];
        sub = b.onFire ? '🔥 On fire!' : d.desc || '';
        if (d.power) rows += kv('Output', `${d.power} MW`);
        if (d.water) rows += kv('Output', `${d.water} water` + (b.powered ? '' : ' <span class="no">(no power)</span>'));
        if (d.service) rows += kv('Radius', `${d.radius} tiles`);
        if (g.powerUse(b) > 0) rows += kv('Power', yn(b.powered));
        if (d.upkeep) rows += kv('Upkeep', `${fmtMoney(d.upkeep)}/mo`);
      }
    } else {
      const t = w.terrain[i];
      title = w.road[i] ? (t === T_WATER ? 'Bridge' : 'Road') : w.pline[i] ? 'Power line' : w.zone[i] ? `Empty ${ZONE_NAMES[w.zone[i]]} zone` : t === T_WATER ? 'Water' : w.trees[i] ? 'Forest' : t === T_SAND ? 'Sand' : 'Grass';
      if (w.road[i]) rows += kv('Traffic', `${Math.round(w.traffic[i] * 100)}%` + this.meter(w.traffic[i], false));
      if (w.zone[i]) {
        rows += kv('Road access', yn(w.roadDist[i] <= 3));
        rows += kv('Power', yn(w.power[i]));
        const dm = g.demandFor(w.zone[i]);
        rows += kv('Demand', dm > 0 ? `<span class="ok">${Math.round(dm * 100)}%</span>` : `<span class="no">${Math.round(dm * 100)}%</span>`);
      }
    }
    if (w.terrain[i] !== T_WATER) {
      rows += `<h3 style="margin:10px 0 4px;font-size:12px;color:var(--muted)">THIS TILE</h3>`;
      rows += kv('Land value', this.meter(w.landValue[i], true));
      rows += kv('Pollution', this.meter(w.pollution[i] / 100, false));
      if (b && b.zoned) rows += kv('Crime', this.meter(w.crime[i], false));
      rows += kv('Police', this.meter(w.cov.police[i], true));
      rows += kv('Fire', this.meter(w.cov.fire[i], true));
      rows += kv('Health', this.meter(w.cov.health[i], true));
      rows += kv('Education', this.meter(w.cov.edu[i], true));
    }
    $('infoPanel').innerHTML = `<button class="close" id="infoClose">✕</button><h2>${title}</h2><div class="sub" style="margin-bottom:8px">${sub} <span class="sub">(${x}, ${y})</span></div>${rows}`;
    $('infoClose').onclick = () => this.hideInfo();
  }

  // ---------- tooltip ----------
  tooltip(text, sx, sy) {
    const t = $('tooltip');
    if (!text) { t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    t.innerHTML = text;
    t.style.left = (sx + 16) + 'px';
    t.style.top = (sy + 18) + 'px';
  }

  // ---------- modals ----------
  openModal(html, kind, closable) {
    this.modalKind = kind;
    this.modalClosable = closable !== false;
    $('modal').innerHTML = (this.modalClosable ? '<button class="close" data-close>✕</button>' : '') + html;
    $('modalBg').classList.remove('hidden');
    $('modal').querySelectorAll('[data-close]').forEach(b => b.onclick = () => this.closeModal());
  }
  closeModal() {
    $('modalBg').classList.add('hidden');
    this.modalKind = null;
    if (this.resumeSpeed !== undefined) { this.setSpeed(this.resumeSpeed); this.resumeSpeed = undefined; }
  }
  get modalOpen() { return !$('modalBg').classList.contains('hidden'); }

  showNewGame(first) {
    const saves = this.listSaves();
    const latest = saves[0];
    let mapType = 'continental';
    const types = [['continental', '🏞️', 'River valley'], ['coast', '🏖️', 'Coastline'], ['lakes', '💧', 'Lakes'], ['island', '🏝️', 'Island']];
    this.openModal(`
      <div class="title-hero"><div class="logo">🏙️</div><h1>CityBuilder</h1><div class="sub">Build roads, zone land, keep your citizens happy.</div></div>
      ${latest ? `<div class="slot"><div><b>${latest.name}</b><div class="sub">${fmtNum(latest.pop)} people · saved ${new Date(latest.saved).toLocaleString()}</div></div><div class="actions"><button class="primary" id="ngContinue">Continue</button></div></div>` : ''}
      <h3>New city</h3>
      <label>City name</label>
      <input type="text" id="ngName" value="${this.randomName()}" maxlength="28">
      <label>Terrain</label>
      <div class="maptypes">${types.map(t => `<button data-mt="${t[0]}" class="${t[0] === mapType ? 'active' : ''}"><b>${t[1]}</b>${t[2]}</button>`).join('')}</div>
      <div class="row">
        <div><label>Map size</label><select id="ngSize"><option value="64">Small (64×64)</option><option value="96" selected>Medium (96×96)</option><option value="128">Large (128×128)</option></select></div>
        <div><label>Seed (optional)</label><input type="text" id="ngSeed" placeholder="random"></div>
      </div>
      <label class="check"><input type="checkbox" id="ngSandbox"> Sandbox mode (unlimited money, everything unlocked)</label>
      <div class="actions">
        ${!first ? '<button data-close>Cancel</button>' : ''}
        ${saves.length ? '<button id="ngLoad">Load…</button>' : ''}
        <button class="primary" id="ngStart">Found city</button>
      </div>`, 'new', !first);
    $('modal').querySelectorAll('[data-mt]').forEach(b => b.onclick = () => {
      mapType = b.dataset.mt;
      $('modal').querySelectorAll('[data-mt]').forEach(x => x.classList.toggle('active', x === b));
    });
    $('ngStart').onclick = () => {
      const seedTxt = $('ngSeed').value.trim();
      const seed = seedTxt ? (/^\d+$/.test(seedTxt) ? +seedTxt : strHash(seedTxt)) : 0;
      const opts = { name: $('ngName').value.trim() || 'New City', size: +$('ngSize').value, seed, mapType, sandbox: $('ngSandbox').checked };
      this.resumeSpeed = undefined;
      this.closeModal();
      window.startNewGame(opts);
    };
    if (latest) $('ngContinue').onclick = () => { this.closeModal(); this.loadSlot(latest.key); };
    if ($('ngLoad')) $('ngLoad').onclick = () => this.showLoad(first);
  }
  randomName() {
    const a = ['New', 'Port', 'Lake', 'Green', 'Silver', 'Oak', 'Maple', 'Stone', 'River', 'Sun', 'North', 'Iron', 'Gold', 'Pine'];
    const b = ['ville', 'field', 'haven', 'ton', 'burg', ' Springs', 'wood', ' Bay', 'brook', 'ford', ' Hills', 'port', 'dale', ' City'];
    return pick(Math.random, a) + pick(Math.random, b);
  }

  pauseForModal() {
    if (this.resumeSpeed === undefined) this.resumeSpeed = this.game.speed;
    this.setSpeed(0);
  }

  showMenu() {
    this.pauseForModal();
    this.openModal(`
      <h2>Menu</h2>
      <div class="actions" style="justify-content:flex-start">
        <button class="primary" id="mSave">💾 Save game</button>
        <button id="mLoad">📂 Load game</button>
        <button id="mNew">🏙️ New city</button>
      </div>
      <h3>Backup</h3>
      <div class="actions" style="justify-content:flex-start">
        <button id="mExport">⬇️ Export to file</button>
        <button id="mImport">⬆️ Import from file</button>
        <input type="file" id="mFile" accept=".json,application/json" class="hidden">
      </div>
      <h3>City</h3>
      <label>Rename city</label>
      <div class="row"><input type="text" id="mName" value="${this.game.state.name}" maxlength="28"><button id="mRename" style="flex:0">Rename</button></div>
      <div class="actions"><button data-close>Resume</button></div>`, 'menu');
    $('mSave').onclick = () => this.showSave();
    $('mLoad').onclick = () => this.showLoad();
    $('mNew').onclick = () => this.showNewGame(false);
    $('mExport').onclick = () => this.exportFile();
    $('mImport').onclick = () => $('mFile').click();
    $('mFile').onchange = (e) => this.importFile(e.target.files[0]);
    $('mRename').onclick = () => { this.game.state.name = $('mName').value.trim() || this.game.state.name; this.toast({ msg: 'City renamed.', type: 'good' }); };
  }

  listSaves() {
    const out = [];
    try {
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k);
        if (!key.startsWith(SAVE_PREFIX)) continue;
        try {
          const meta = JSON.parse(localStorage.getItem(key + ':meta') || 'null');
          if (meta) out.push(Object.assign({ key }, meta));
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* storage blocked */ }
    return out.filter(s => !s.key.endsWith(':meta')).sort((a, b) => b.saved - a.saved);
  }
  writeSave(slot) {
    const data = this.game.serialize();
    const key = SAVE_PREFIX + slot;
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem(key + ':meta', JSON.stringify({ name: this.game.state.name, pop: this.game.stats.pop, saved: data.saved, slot }));
      return true;
    } catch (e) {
      this.toast({ msg: 'Could not save: browser storage is full or blocked. Try Export instead.', type: 'bad' });
      return false;
    }
  }
  quickSave() {
    if (this.writeSave('quick')) this.toast({ msg: '💾 Game saved.', type: 'good' });
  }
  autoSave() {
    if (this.game.world) this.writeSave('auto');
  }
  showSave() {
    const saves = this.listSaves();
    const slots = ['quick', '1', '2', '3'];
    const label = { quick: 'Quick save', auto: 'Autosave', 1: 'Slot 1', 2: 'Slot 2', 3: 'Slot 3' };
    this.openModal(`<h2>Save game</h2>${slots.map(s => {
      const m = saves.find(x => x.slot === s);
      return `<div class="slot"><div><b>${label[s]}</b><div class="sub">${m ? `${m.name} · ${fmtNum(m.pop)} people · ${new Date(m.saved).toLocaleString()}` : 'empty'}</div></div><div class="actions"><button class="primary" data-save="${s}">Save here</button></div></div>`;
    }).join('')}<div class="actions"><button id="sBack">Back</button></div>`, 'save');
    $('modal').querySelectorAll('[data-save]').forEach(b => b.onclick = () => { if (this.writeSave(b.dataset.save)) { this.toast({ msg: '💾 Saved to ' + label[b.dataset.save], type: 'good' }); this.closeModal(); } });
    $('sBack').onclick = () => this.showMenu();
  }
  showLoad(first) {
    const saves = this.listSaves();
    const label = { quick: 'Quick save', auto: 'Autosave', 1: 'Slot 1', 2: 'Slot 2', 3: 'Slot 3' };
    this.openModal(`<h2>Load game</h2>${saves.length ? saves.map(m => `<div class="slot"><div><b>${m.name}</b> <span class="sub">${label[m.slot] || m.slot}</span><div class="sub">${fmtNum(m.pop)} people · ${new Date(m.saved).toLocaleString()}</div></div><div class="actions"><button data-del="${m.key}" title="Delete">🗑️</button><button class="primary" data-load="${m.key}">Load</button></div></div>`).join('') : '<p class="sub">No saved games yet.</p>'}<div class="actions"><button id="lBack">Back</button></div>`, 'load', !first);
    $('modal').querySelectorAll('[data-load]').forEach(b => b.onclick = () => { this.resumeSpeed = undefined; this.closeModal(); this.loadSlot(b.dataset.load); });
    $('modal').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('Delete this save?')) return;
      localStorage.removeItem(b.dataset.del); localStorage.removeItem(b.dataset.del + ':meta');
      this.showLoad(first);
    });
    $('lBack').onclick = () => first ? this.showNewGame(true) : this.showMenu();
  }
  loadSlot(key) {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      window.loadGame(data);
      this.toast({ msg: `📂 Loaded ${this.game.state.name}.`, type: 'good' });
    } catch (e) {
      console.error(e);
      this.toast({ msg: 'Could not load that save.', type: 'bad' });
      this.showNewGame(true);
    }
  }
  exportFile() {
    const blob = new Blob([JSON.stringify(this.game.serialize())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.game.state.name.replace(/[^a-z0-9]+/gi, '_') + '.city.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  importFile(file) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { window.loadGame(JSON.parse(rd.result)); this.resumeSpeed = undefined; this.closeModal(); this.toast({ msg: 'City imported.', type: 'good' }); }
      catch (e) { this.toast({ msg: 'That file is not a valid city.', type: 'bad' }); }
    };
    rd.readAsText(file);
  }

  showBudget() { this.pauseForModal(); this.openModal('<div id="budgetBody"></div>', 'budget'); this.renderBudget(); }
  renderBudget() {
    const g = this.game, st = g.state, s = g.stats;
    const proj = g.taxIncome();
    const rep = st.report;
    const row = (k, v, cls) => `<tr><td>${k}</td><td class="${cls || ''}">${fmtMoney(v)}</td></tr>`;
    $('budgetBody').innerHTML = `
      <h2>Budget</h2>
      <div class="row"><div><b style="font-size:20px">${st.sandbox ? '∞' : fmtMoney(st.money)}</b><div class="sub">treasury</div></div><div><b style="font-size:20px">${fmtMoney(st.debt)}</b><div class="sub">debt</div></div></div>
      <h3>Tax rates</h3>
      ${['R', 'C', 'I'].map(k => `<div class="tax"><span>${ZONE_NAMES[ZONE_KEYS.indexOf(k)]}</span><input type="range" min="0" max="20" value="${st['tax' + k]}" data-tax="${k}"><b id="tv${k}">${st['tax' + k]}%</b></div>`).join('')}
      <div class="sub">Higher taxes = more money but lower demand and happiness. 9% is neutral.</div>
      <div class="grid2">
        <div><h3>Income ${rep ? '(last month)' : '(estimate)'}</h3><table class="rep">
          ${row('Residential', rep ? rep.inc.r : proj.r)}${row('Commercial', rep ? rep.inc.c : proj.c)}${row('Industrial', rep ? rep.inc.i : proj.i)}
          <tr><td><b>Total</b></td><td class="ok"><b>${fmtMoney(rep ? rep.income : proj.r + proj.c + proj.i)}</b></td></tr></table></div>
        <div><h3>Expenses (last month)</h3><table class="rep">
          ${rep ? Object.entries({ Services: rep.exp.services, Power: rep.exp.power, Water: rep.exp.water, Parks: rep.exp.parks, Landmarks: rep.exp.landmarks, 'Roads & lines': rep.exp.roads, 'Loan payment': rep.exp.loan }).map(([k, v]) => row(k, v)).join('') : '<tr><td class="sub">No report yet</td><td></td></tr>'}
          ${rep ? `<tr><td><b>Total</b></td><td class="no"><b>${fmtMoney(rep.expense)}</b></td></tr>` : ''}</table></div>
      </div>
      <div class="sub" style="margin-top:8px">Projected tax income this month at current rates: <b>${fmtMoney(proj.r + proj.c + proj.i)}</b></div>
      <h3>Bank</h3>
      <div class="actions" style="justify-content:flex-start">
        <button id="bLoan" ${st.sandbox ? 'disabled' : ''}>🏦 Take loan (+$25,000)</button>
        <button id="bRepay" ${st.debt <= 0 || st.sandbox ? 'disabled' : ''}>Repay debt</button>
      </div>
      <div class="actions"><button data-close>Close</button></div>`;
    $('budgetBody').querySelectorAll('[data-tax]').forEach(inp => inp.oninput = () => {
      st['tax' + inp.dataset.tax] = +inp.value;
      $('tv' + inp.dataset.tax).textContent = inp.value + '%';
    });
    $('budgetBody').querySelectorAll('[data-tax]').forEach(inp => inp.onchange = () => this.renderBudget());
    $('bLoan').onclick = () => { g.takeLoan(); this.renderBudget(); };
    $('bRepay').onclick = () => { g.repayLoan(); this.renderBudget(); };
    $('modal').querySelectorAll('[data-close]').forEach(b => b.onclick = () => this.closeModal());
  }

  showStats() { this.openModal('<div id="statsBody"></div>', 'stats'); this.renderStats(); }
  renderStats() {
    const g = this.game, s = g.stats, st = g.state, hp = g.happyParts || {};
    const pct = (v) => Math.round(v * 100) + '%';
    const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
    const lv = (n) => { let c = [0, 0, 0, 0]; for (const b of g.world.buildings.values()) if (b.type === n && !b.constructing && !b.abandoned) c[b.level]++; return `${c[1]} / ${c[2]} / ${c[3]}`; };
    $('statsBody').innerHTML = `
      <h2>City statistics</h2>
      <h3>Population</h3><canvas class="graph" id="gPop" width="1200" height="300"></canvas>
      <h3>Treasury</h3><canvas class="graph" id="gMoney" width="1200" height="300"></canvas>
      <div class="grid2">
        <div><h3>People & jobs</h3>
          ${kv('Population', fmtNum(s.pop))}${kv('Workers', fmtNum(s.workers))}${kv('Commercial jobs', fmtNum(s.cJobs))}${kv('Industrial jobs', fmtNum(s.iJobs))}${kv('Unemployment', pct(s.unemployment))}${kv('Abandoned buildings', fmtNum(s.abandoned))}
          ${kv('Homes S/M/L', lv('R'))}${kv('Shops S/M/L', lv('C'))}${kv('Factories S/M/L', lv('I'))}
        </div>
        <div><h3>Utilities</h3>
          ${kv('Power', `${fmtNum(s.powerNeed)} / ${fmtNum(s.powerCap)} MW`)}${kv('Water', `${fmtNum(s.waterNeed)} / ${fmtNum(s.waterCap)}`)}${kv('Road tiles', fmtNum(s.roads))}${kv('Cars on road', fmtNum(g.agents.cars.length))}
          <h3>Happiness factors</h3>
          ${kv('Approval', Math.round(st.happiness) + '%')}${kv('Service coverage', pct(hp.svc || 0))}${kv('Parks nearby', pct(hp.park || 0))}${kv('Avg pollution', Math.round(hp.poll || 0) + '%')}${kv('Avg crime', pct(hp.crime || 0))}${kv('Landmark bonus', '+' + (hp.happyBonus || 0))}
        </div>
      </div>
      <div class="actions"><button data-close>Close</button></div>`;
    $('modal').querySelectorAll('[data-close]').forEach(b => b.onclick = () => this.closeModal());
    this.graph($('gPop'), st.history.map(h => h.pop), '#4fb3ff');
    this.graph($('gMoney'), st.history.map(h => h.money), '#46d27a');
  }
  graph(cv, data, color) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (data.length < 2) { ctx.fillStyle = '#9fb0c4'; ctx.font = '28px system-ui'; ctx.fillText('Not enough data yet. Check back in a few months.', 30, H / 2); return; }
    let mn = Math.min(0, ...data), mx = Math.max(...data, 1);
    const pad = 40;
    const X = (k) => pad + (k / (data.length - 1)) * (W - pad * 2), Y = (v) => H - pad - (v - mn) / (mx - mn) * (H - pad * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2;
    for (let k = 0; k <= 4; k++) { const y = pad + k * (H - pad * 2) / 4; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); }
    ctx.fillStyle = '#9fb0c4'; ctx.font = '22px system-ui';
    ctx.fillText(fmtNum(mx), pad + 4, pad - 10);
    ctx.fillText(fmtNum(mn), pad + 4, H - pad + 26);
    ctx.beginPath(); ctx.moveTo(X(0), Y(data[0]));
    for (let k = 1; k < data.length; k++) ctx.lineTo(X(k), Y(data[k]));
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke();
    ctx.lineTo(X(data.length - 1), Y(mn)); ctx.lineTo(X(0), Y(mn)); ctx.closePath();
    ctx.globalAlpha = 0.15; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
  }

  showHelp() {
    this.openModal(`
      <h2>How to play</h2>
      <h3>Getting started</h3>
      <ol style="margin:0;padding-left:18px;line-height:1.6">
        <li>Build a <b>road</b> 🛣️ off the map center.</li>
        <li>Zone <b>residential</b> (green), <b>commercial</b> (blue) and <b>industrial</b> (yellow) next to it. Zones grow up to 3 tiles away from a road.</li>
        <li>Build a <b>power plant</b> ⚡ and connect it. Roads, zones, buildings and power lines all carry power.</li>
        <li>Add a <b>water pump</b> (next to water) or <b>water tower</b> 💧 so buildings can grow past small size.</li>
        <li>Add police, fire, health, schools and parks to raise land value. High value + water = skyscrapers.</li>
        <li>Watch the <b>R C I</b> demand bars in the top bar and zone what people want.</li>
      </ol>
      <h3>Controls</h3>
      <div class="keys">
        <span><kbd>Right-drag</kbd> / <kbd>Middle-drag</kbd></span><span>Move the camera</span>
        <span><kbd>W A S D</kbd> / arrows</span><span>Move the camera</span>
        <span><kbd>Mouse wheel</kbd> / <kbd>+</kbd> <kbd>-</kbd></span><span>Zoom</span>
        <span><kbd>Space</kbd></span><span>Pause / resume</span>
        <span><kbd>Esc</kbd></span><span>Inspect tool / close panels</span>
        <span><kbd>R</kbd> <kbd>P</kbd> <kbd>B</kbd> <kbd>T</kbd></span><span>Road, power line, bulldoze, trees</span>
        <span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></span><span>Residential, commercial, industrial zone</span>
        <span><kbd>Ctrl</kbd>+<kbd>S</kbd></span><span>Quick save</span>
        <span><kbd>Touch</kbd></span><span>One finger builds, two fingers pan/zoom</span>
      </div>
      <h3>Tips</h3>
      <ul style="margin:0;padding-left:18px;line-height:1.6">
        <li>Keep industry away from homes. Pollution kills land value. Trees help.</li>
        <li>Blinking ⚡ / 💧 icons mean a building has no power or no water.</li>
        <li>Use the overlays at the bottom to check coverage, pollution, traffic and more.</li>
        <li>New buildings unlock as your population grows. Check the build menus.</li>
        <li>The game autosaves every two minutes.</li>
      </ul>
      <div class="actions"><button class="primary" data-close>Got it</button></div>`, 'help');
  }

  // ---------- minimap ----------
  drawMinimap() {
    const g = this.game, w = g.world;
    if (!w) return;
    const cv = $('minimap'), ctx = cv.getContext('2d');
    if (!this.mmBuf || this.mmBuf.width !== w.W) { this.mmBuf = document.createElement('canvas'); this.mmBuf.width = w.W; this.mmBuf.height = w.H; }
    const bctx = this.mmBuf.getContext('2d'), img = bctx.createImageData(w.W, w.H), d = img.data;
    for (let i = 0; i < w.N; i++) {
      let c;
      const id = w.bld[i];
      if (id >= 0) {
        const b = w.buildings.get(id);
        c = b.zoned ? (b.type === 'R' ? [70, 180, 80] : b.type === 'C' ? [70, 130, 230] : [230, 170, 50]) : b.type === 'rubble' ? [120, 100, 80] : [200, 200, 210];
        if (b.zoned && b.level > 1) c = c.map(v => v * (1.15 - b.level * 0.12));
      } else if (w.road[i]) c = [70, 72, 78];
      else if (w.zone[i]) c = w.zone[i] === Z_R ? [120, 190, 120] : w.zone[i] === Z_C ? [130, 170, 230] : [220, 200, 120];
      else if (w.terrain[i] === T_WATER) c = [46, 111, 174];
      else if (w.terrain[i] === T_SAND) c = [215, 196, 138];
      else c = w.trees[i] ? [52, 110, 50] : [95, 156, 61];
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const s = Math.min(cv.width / (w.W + w.H), cv.height * 2 / (w.W + w.H)) * 0.98;
    this.mm = { s, ox: cv.width / 2 - (w.W - w.H) / 2 * s, oy: (cv.height - (w.W + w.H) * s / 2) / 2 };
    const m = this.mm;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(s, s / 2, -s, s / 2, m.ox, m.oy);
    ctx.drawImage(this.mmBuf, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // viewport
    const r = this.r, corners = [[0, 0], [r.cw, 0], [r.cw, r.ch], [0, r.ch]].map(([x, y]) => {
      const [wx, wy] = r.screenToWorld(x, y);
      const tx = (wx / 32 + wy / 16) / 2, ty = (wy / 16 - wx / 32) / 2;
      return [m.ox + (tx - ty) * s, m.oy + (tx + ty) * s / 2];
    });
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); corners.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
  }
  minimapToTile(px, py) {
    const m = this.mm;
    if (!m) return null;
    const a = (px - m.ox) / m.s, b = (py - m.oy) / (m.s / 2);
    return [(a + b) / 2, (b - a) / 2];
  }
}
