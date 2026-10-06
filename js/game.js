'use strict';
// Simulation, economy and tool logic.

const DAY_LEN = [Infinity, 0.5, 0.2, 0.07, 0.025]; // seconds per game day for each speed
const START_MONEY = 40000;

class Game {
  constructor() {
    this.world = null;
    this.speed = 1;
    this.acc = 0;
    this.netDirty = true;
    this.zonesDirty = true;
    this.mapsDirty = true;
    this.zoneList = [];
    this.roadList = [];
    this.listeners = {};
    this.stats = this.emptyStats();
  }

  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, a, b) { for (const fn of this.listeners[ev] || []) fn(a, b); }
  toast(msg, type, loc) { this.emit('toast', { msg, type: type || 'info', loc }); }

  emptyStats() {
    return { pop: 0, cJobs: 0, iJobs: 0, jobs: 0, workers: 0, unemployment: 0, zoned: 0, buildings: 0, abandoned: 0, unpowered: 0, unwatered: 0, powerCap: 0, powerUsed: 0, powerNeed: 0, waterCap: 0, waterUsed: 0, waterNeed: 0, trips: 0, roads: 0, plines: 0, counts: {} };
  }

  newGame(opts) {
    this.world = new World(opts.size || 96);
    const seed = opts.seed || Math.floor(Math.random() * 1e9);
    this.world.generate(seed, opts.mapType || 'continental');
    this.state = {
      name: opts.name || 'New City', money: START_MONEY, day: 0,
      taxR: 9, taxC: 9, taxI: 9, demand: { r: 0.6, c: 0.3, i: 0.7 },
      maxPop: 0, sandbox: !!opts.sandbox, history: [], debt: 0, seed, mapType: opts.mapType || 'continental',
      happiness: 60, report: null, advisor: {}, rank: 0,
    };
    this.afterLoad();
    if (!opts.quiet) this.toast(`Welcome to ${this.state.name}! Build a road, zone some land and connect power.`, 'good');
  }

  afterLoad() {
    this.netDirty = this.zonesDirty = this.mapsDirty = true;
    this.stats = this.emptyStats();
    this.agents = new Agents(this);
    this.refresh();
    this.emit('loaded');
  }

  refresh() {
    if (this.zonesDirty) this.rebuildLists();
    if (this.netDirty) this.recalcNetworks();
    this.recalcStats();
    this.recalcMaps();
    this.computeDemand(true);
  }

  serialize() {
    return { v: 1, state: this.state, world: this.world.serialize(), saved: Date.now() };
  }
  load(o) {
    this.world = World.deserialize(o.world);
    this.state = Object.assign({ advisor: {}, history: [], debt: 0, rank: 0 }, o.state);
    this.afterLoad();
  }

  get unlockPop() { return this.state.sandbox ? Infinity : this.state.maxPop; }
  isUnlocked(toolId) {
    const t = TOOLS[toolId];
    if (!t || t.kind !== 'building') return true;
    return BUILDINGS[t.building].unlock <= this.unlockPop;
  }
  canAfford(c) { return this.state.sandbox || this.state.money >= c; }
  spend(c) { if (!this.state.sandbox) this.state.money -= c; }

  // ---------------- time ----------------
  update(dt) {
    if (!this.world) return;
    if (this.speed > 0) {
      this.acc += dt;
      const dl = DAY_LEN[this.speed];
      let n = 0;
      while (this.acc >= dl && n < 8) { this.acc -= dl; this.dayTick(); n++; }
      if (n >= 8) this.acc = 0;
    }
  }

  dayTick() {
    const st = this.state, w = this.world;
    st.day++;
    if (this.zonesDirty) this.rebuildLists();

    const list = [...w.buildings.values()];
    for (const b of list) {
      if (!w.buildings.has(b.id)) continue;
      b.age++;
      if (b.type === 'rubble') { if (b.age > 50) { w.removeBuilding(b.id); this.netDirty = true; } continue; }
      if (b.constructing > 0) {
        b.constructing--;
        if (b.constructing <= 0) { b.constructing = 0; this.netDirty = true; }
      }
      if (b.onFire > 0) this.fireStep(b);
      else this.maybeIgnite(b);
    }

    // growth
    const zl = this.zoneList;
    if (zl.length) {
      const n = Math.min(zl.length, 2 + Math.ceil(zl.length / 40));
      for (let k = 0; k < n; k++) this.growTile(zl[(Math.random() * zl.length) | 0]);
    }

    if (this.netDirty) this.recalcNetworks();
    this.recalcStats();
    if (st.day % 4 === 0 || this.mapsDirty) this.recalcMaps();
    this.computeDemand(false);
    if (st.day % 30 === 0) this.monthTick();
  }

  rebuildLists() {
    const w = this.world, zl = [], rl = [];
    for (let i = 0; i < w.N; i++) {
      if (w.zone[i]) zl.push(i);
      if (w.road[i]) rl.push(i);
    }
    this.zoneList = zl;
    this.roadList = rl;
    this.zonesDirty = false;
  }

  // ---------------- networks ----------------
  powerUse(b) {
    if (b.type === 'rubble') return 0;
    if (b.zoned) return (b.constructing > 0 || b.abandoned) ? 0 : ZONE_POWER[b.type][b.level];
    const d = BUILDINGS[b.type];
    return d.powerUse || 0;
  }
  waterUse(b) {
    if (b.type === 'rubble') return 0;
    if (b.zoned) return (b.constructing > 0 || b.abandoned) ? 0 : ZONE_WATER[b.type][b.level];
    return BUILDINGS[b.type].waterUse || 0;
  }

  recalcNetworks() {
    const w = this.world, N = w.N, W = w.W, H = w.H, s = this.stats;
    const q = new Int32Array(N);
    const cond = (i) => w.road[i] || w.pline[i] || w.zone[i] || (w.bld[i] >= 0);

    const flood = (layer, srcKey, useFn, flag) => {
      layer.fill(0);
      let cap = 0, used = 0, need = 0, head = 0, tail = 0;
      const seen = new Set();
      for (const b of w.buildings.values()) {
        b[flag] = false;
        need += useFn(b);
        const d = b.zoned ? null : BUILDINGS[b.type];
        if (d && d[srcKey] && !b.onFire && (srcKey === 'power' || b.powered)) {
          cap += d[srcKey];
          for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) {
            const i = w.idx(xx, yy);
            if (!layer[i]) { layer[i] = 1; q[tail++] = i; }
          }
        }
      }
      while (head < tail) {
        const i = q[head++];
        const id = w.bld[i];
        if (id >= 0 && !seen.has(id)) {
          seen.add(id);
          const b = w.buildings.get(id), u = useFn(b);
          if (cap - used >= u) { used += u; b[flag] = true; }
        }
        const x = i % W, y = (i / W) | 0;
        if (x > 0 && !layer[i - 1] && cond(i - 1)) { layer[i - 1] = 1; q[tail++] = i - 1; }
        if (x < W - 1 && !layer[i + 1] && cond(i + 1)) { layer[i + 1] = 1; q[tail++] = i + 1; }
        if (y > 0 && !layer[i - W] && cond(i - W)) { layer[i - W] = 1; q[tail++] = i - W; }
        if (y < H - 1 && !layer[i + W] && cond(i + W)) { layer[i + W] = 1; q[tail++] = i + W; }
      }
      // buildings that don't need anything count as supplied
      for (const b of w.buildings.values()) if (useFn(b) === 0 && !b[flag]) b[flag] = !b.zoned || layer[w.idx(b.x, b.y)] === 1 || b.constructing > 0 || b.abandoned;
      return [cap, used, need];
    };
    [s.powerCap, s.powerUsed, s.powerNeed] = flood(w.power, 'power', (b) => this.powerUse(b), 'powered');
    [s.waterCap, s.waterUsed, s.waterNeed] = flood(w.water, 'water', (b) => this.waterUse(b), 'watered');

    // distance to the nearest road (max 4)
    let head = 0, tail = 0;
    w.roadDist.fill(9);
    for (let i = 0; i < N; i++) if (w.road[i]) { w.roadDist[i] = 0; q[tail++] = i; }
    while (head < tail) {
      const i = q[head++], d = w.roadDist[i];
      if (d >= 4) continue;
      const x = i % W, y = (i / W) | 0;
      if (x > 0 && w.roadDist[i - 1] > d + 1) { w.roadDist[i - 1] = d + 1; q[tail++] = i - 1; }
      if (x < W - 1 && w.roadDist[i + 1] > d + 1) { w.roadDist[i + 1] = d + 1; q[tail++] = i + 1; }
      if (y > 0 && w.roadDist[i - W] > d + 1) { w.roadDist[i - W] = d + 1; q[tail++] = i - W; }
      if (y < H - 1 && w.roadDist[i + W] > d + 1) { w.roadDist[i + W] = d + 1; q[tail++] = i + W; }
    }
    this.netDirty = false;
  }

  recalcStats() {
    const w = this.world, s = this.stats;
    let pop = 0, cJ = 0, iJ = 0, zoned = 0, ab = 0, unp = 0, unw = 0, nb = 0;
    const counts = {};
    for (const b of w.buildings.values()) {
      nb++;
      counts[b.type] = (counts[b.type] || 0) + 1;
      if (!b.zoned) continue;
      zoned++;
      b.pop = 0; b.jobs = 0;
      if (b.constructing > 0) continue;
      if (b.abandoned) { ab++; continue; }
      const f = 0.85 + (b.variant % 7) * 0.05;
      const cap = Math.round(ZONE_CAP[b.type][b.level] * f);
      if (b.type === 'R') { b.pop = cap; pop += cap; } else if (b.type === 'C') { b.jobs = cap; cJ += cap; } else { b.jobs = cap; iJ += cap; }
      if (!b.powered) unp++;
      if (b.level >= 2 && !b.watered) unw++;
    }
    let roads = 0, pl = 0;
    for (let i = 0; i < w.N; i++) { roads += w.road[i]; pl += w.pline[i]; }
    Object.assign(s, { pop, cJobs: cJ, iJobs: iJ, jobs: cJ + iJ, zoned, abandoned: ab, unpowered: unp, unwatered: unw, buildings: nb, counts, roads, plines: pl });
    s.workers = pop * 0.55;
    s.unemployment = s.workers > 0 ? clamp(1 - s.jobs / s.workers, 0, 1) : 0;
    const st = this.state;
    if (pop > st.maxPop) this.onNewMaxPop(st.maxPop, pop);
  }

  onNewMaxPop(oldMax, pop) {
    const st = this.state;
    st.maxPop = pop;
    if (!st.sandbox) {
      for (const k in BUILDINGS) {
        const d = BUILDINGS[k];
        if (!d.internal && d.unlock > oldMax && d.unlock <= pop) this.toast(`🔓 Unlocked: ${d.name}`, 'good');
      }
    }
    let r = 0;
    for (let i = 0; i < CITY_RANKS.length; i++) if (pop >= CITY_RANKS[i].pop) r = i;
    if (r > st.rank) {
      st.rank = r;
      this.toast(`🎉 ${st.name} is now a ${CITY_RANKS[r].title}! (${fmtNum(CITY_RANKS[r].pop)} people)`, 'good');
      this.emit('rankup', r);
    }
  }

  // ---------------- maps ----------------
  stampMax(arr, cx, cy, r) {
    const w = this.world, r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w.W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(w.H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 > r2) continue;
      const v = 1 - 0.55 * Math.sqrt(d2) / r, i = y * w.W + x;
      if (arr[i] < v) arr[i] = v;
    }
  }
  stampAdd(arr, cx, cy, r, amt) {
    const w = this.world;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w.W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(w.H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d > r) continue;
      arr[y * w.W + x] += amt * (1 - d / (r + 1));
    }
  }

  recalcMaps() {
    const w = this.world, N = w.N, W = w.W, s = this.stats, st = this.state;
    for (const k of SERVICE_TYPES) w.cov[k].fill(0);
    w.parkInf.fill(0);
    const pol = new Float32Array(N);
    let happyBonus = 0;
    this.boost = { c: 0, i: 0 };

    // traffic
    const tr = w.traffic;
    tr.fill(0);
    let trips = 0;
    for (const b of w.buildings.values()) {
      if (!b.zoned || b.abandoned || b.constructing) continue;
      const t = (b.pop + b.jobs) * 0.5;
      if (!t) continue;
      const cand = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue;
        const x = b.x + dx, y = b.y + dy;
        if (w.inb(x, y) && w.road[w.idx(x, y)]) cand.push(w.idx(x, y));
      }
      if (!cand.length) continue;
      trips += t;
      for (const j of cand) tr[j] += t / cand.length;
    }
    const tmp = new Float32Array(N);
    for (let it = 0; it < 4; it++) {
      for (const i of this.roadList) {
        let sum = tr[i], n = 1;
        const x = i % W;
        if (x > 0 && w.road[i - 1]) { sum += tr[i - 1]; n++; }
        if (x < W - 1 && w.road[i + 1]) { sum += tr[i + 1]; n++; }
        if (i - W >= 0 && w.road[i - W]) { sum += tr[i - W]; n++; }
        if (i + W < N && w.road[i + W]) { sum += tr[i + W]; n++; }
        tmp[i] = sum / n;
      }
      for (const i of this.roadList) tr[i] = tmp[i];
    }
    for (const i of this.roadList) tr[i] = tr[i] / 45;
    s.trips = trips;

    for (const b of w.buildings.values()) {
      const cx = b.x + b.w / 2 - 0.5, cy = b.y + b.h / 2 - 0.5;
      if (b.zoned) {
        if (b.type === 'I' && !b.abandoned && !b.constructing) this.stampAdd(pol, cx, cy, 3 + b.level, [0, 16, 24, 32][b.level]);
        continue;
      }
      const d = BUILDINGS[b.type];
      if (!d || b.type === 'rubble') continue;
      if (d.service && b.powered && !b.onFire) this.stampMax(w.cov[d.service], cx, cy, d.radius);
      if (d.park) this.stampAdd(w.parkInf, cx, cy, d.parkR, d.park);
      if (d.pollution) this.stampAdd(pol, cx, cy, d.pollR, d.pollution);
      if (d.happy && b.powered) happyBonus += d.happy;
      if (d.cBoost && b.powered) this.boost.c += d.cBoost;
      if (d.iBoost && b.powered) this.boost.i += d.iBoost;
    }
    for (const i of this.roadList) if (tr[i] > 0.4) this.stampAdd(pol, i % W, (i / W) | 0, 2, Math.min(tr[i], 2.5) * 5);
    for (let i = 0; i < N; i++) {
      if (w.trees[i]) { const x = i % W, y = (i / W) | 0; this.stampAdd(pol, x, y, 1, -2.5 * w.trees[i]); }
    }
    for (let i = 0; i < N; i++) w.pollution[i] = clamp(pol[i] - w.parkInf[i] * 25, 0, 100);

    // crime
    const unemp = s.unemployment;
    w.crime.fill(0);
    for (const b of w.buildings.values()) {
      if (!b.zoned || b.constructing) continue;
      const i = w.idx(b.x, b.y);
      let c = b.abandoned ? 0.55 : [0, 0.14, 0.28, 0.42][b.level] * (b.type === 'I' ? 0.6 : 1);
      c += unemp * 0.5 - w.cov.police[i] * 0.8 - w.cov.edu[i] * 0.12 - w.landValue[i] * 0.08;
      w.crime[i] = clamp(c, 0, 1);
    }

    // land value
    const needGarbage = s.pop > 800;
    for (let i = 0; i < N; i++) {
      if (w.terrain[i] === T_WATER) { w.landValue[i] = 0; continue; }
      let lv = 0.2;
      const wd = w.waterDist[i];
      if (wd > 0 && wd <= 5) lv += 0.18 * (1 - (wd - 1) / 5);
      lv += Math.min(0.4, w.parkInf[i]);
      lv += (w.cov.police[i] + w.cov.fire[i] + w.cov.health[i] + w.cov.edu[i]) * 0.085;
      lv -= w.pollution[i] / 100 * 0.65;
      lv -= w.crime[i] * 0.25;
      if (needGarbage && w.cov.garbage[i] < 0.2) lv -= 0.07;
      w.landValue[i] = clamp(lv, 0, 1);
    }

    // happiness, weighted by residents
    let wsum = 0, svc = 0, poll = 0, crime = 0, park = 0, garb = 0;
    for (const b of w.buildings.values()) {
      if (b.type !== 'R' || !b.pop) continue;
      const i = w.idx(b.x, b.y), k = b.pop;
      wsum += k;
      svc += k * (w.cov.police[i] + w.cov.fire[i] + w.cov.health[i] + w.cov.edu[i]) / 4;
      poll += k * w.pollution[i];
      crime += k * w.crime[i];
      park += k * Math.min(1, w.parkInf[i] * 2.5);
      garb += k * w.cov.garbage[i];
    }
    let h = 55;
    if (wsum > 0) {
      svc /= wsum; poll /= wsum; crime /= wsum; park /= wsum; garb /= wsum;
      h += svc * 30 + park * 10 - poll * 0.25 - crime * 20;
      if (s.pop > 1500) h += (garb - 0.5) * 10;
    }
    h -= (st.taxR - 9) * 2.5 + (st.taxC + st.taxI - 18) * 0.6;
    if (s.pop > 100) h -= unemp * 30;
    h += happyBonus;
    if (s.powerNeed > 0 && s.powerUsed < s.powerNeed) h -= (1 - s.powerUsed / s.powerNeed) * 25;
    if (s.pop > 300 && s.waterNeed > 0 && s.waterUsed < s.waterNeed) h -= (1 - s.waterUsed / s.waterNeed) * 12;
    st.happiness = lerp(st.happiness, clamp(h, 0, 100), this.mapsDirty ? 1 : 0.35);
    this.happyParts = { svc, poll, crime, park, garb, unemp, happyBonus };
    this.mapsDirty = false;
  }

  computeDemand(instant) {
    const s = this.stats, st = this.state, b = this.boost || { c: 0, i: 0 };
    const workers = s.pop * 0.55;
    let r = (s.jobs - workers * 0.85 + 60) / Math.max(80, workers * 0.35);
    r += (st.happiness - 50) / 120;
    r -= (st.taxR - 9) * 0.07;
    const cDes = s.pop * 0.24 + b.c;
    let c = (cDes - s.cJobs + 12) / Math.max(40, cDes * 0.3);
    c -= (st.taxC - 9) * 0.07;
    const iDes = s.pop * 0.26 + 40 + b.i;
    let i = (iDes - s.iJobs + 10) / Math.max(40, iDes * 0.3);
    i -= (st.taxI - 9) * 0.07;
    const k = instant ? 1 : 0.08, d = st.demand;
    d.r = lerp(d.r, clamp(r, -1, 1), k);
    d.c = lerp(d.c, clamp(c, -1, 1), k);
    d.i = lerp(d.i, clamp(i, -1, 1), k);
  }
  demandFor(z) { const d = this.state.demand; return z === Z_R ? d.r : z === Z_C ? d.c : d.i; }

  // ---------------- growth ----------------
  growTile(i) {
    const w = this.world, z = w.zone[i];
    if (!z) return;
    const id = w.bld[i], demand = this.demandFor(z);
    const x = i % w.W, y = (i / w.W) | 0;
    if (id < 0) {
      if (w.road[i] || w.terrain[i] === T_WATER) return;
      if (w.roadDist[i] > 3 || !w.power[i] || demand <= 0.02) return;
      if (Math.random() < demand * 0.35) {
        const b = w.addBuilding(ZONE_KEYS[z], x, y, { level: 1 });
        b.constructing = 5 + Math.floor(Math.random() * 6);
        this.netDirty = true;
      }
      return;
    }
    const b = w.buildings.get(id);
    if (!b || !b.zoned || b.constructing > 0 || b.onFire) return;
    const ok = b.powered && w.roadDist[i] <= 3;
    if (b.abandoned) {
      if (ok && demand > 0.1 && Math.random() < 0.2) { b.abandoned = false; b.level = 1; b.constructing = 5; this.netDirty = true; }
      return;
    }
    if (!ok) {
      b.trouble++;
      if (b.trouble > 5 && Math.random() < 0.25) { b.abandoned = true; this.netDirty = true; }
      return;
    }
    b.trouble = 0;
    const lv = w.landValue[i];
    let maxL = 1;
    if (b.watered && lv > 0.3) maxL = 2;
    if (b.watered && lv > 0.5 && this.stats.pop > 1200) maxL = 3;
    if (b.type === 'R' && w.pollution[i] > 55) maxL = 1;
    if (b.type === 'C' && maxL === 3 && w.cov.edu[i] < 0.2) maxL = 2;
    if (b.type === 'I' && maxL === 3 && w.cov.edu[i] < 0.1) maxL = 2;
    if (b.level < maxL && demand > 0.05 && Math.random() < 0.12 + demand * 0.3) {
      b.level++;
      b.variant = Math.floor(Math.random() * 60);
      b.constructing = 8 + Math.floor(Math.random() * 8);
      this.netDirty = true;
    } else if (b.level > maxL && Math.random() < 0.08) {
      b.level--;
      this.netDirty = true;
    } else if (demand < -0.45 && Math.random() < 0.04) {
      b.abandoned = true;
      this.netDirty = true;
    }
  }

  // ---------------- fire & destruction ----------------
  fireCov(b) {
    const w = this.world;
    let c = 0;
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) c = Math.max(c, w.cov.fire[w.idx(xx, yy)]);
    return c;
  }
  maybeIgnite(b) {
    if (b.constructing > 0 || b.type === 'rubble') return;
    const d = BUILDINGS[b.type];
    if (d && (d.park || b.type === 'solar' || b.type === 'wind')) return;
    let ch = b.zoned ? (b.type === 'I' ? 0.00010 : 0.00003) * b.level : 0.00002;
    if (b.abandoned) ch *= 3;
    ch *= 1 - this.fireCov(b) * 0.95;
    if (Math.random() < ch) this.ignite(b);
  }
  ignite(b, silent) {
    if (b.onFire || b.type === 'rubble') return false;
    b.onFire = 1;
    this.netDirty = true;
    if (!silent) this.toast(`🔥 Fire! ${this.bName(b)} is burning.`, 'bad', [b.x, b.y]);
    return true;
  }
  fireStep(b) {
    const w = this.world;
    b.onFire++;
    const fc = this.fireCov(b);
    if ((fc > 0.05 && Math.random() < fc * 0.22) || Math.random() < 0.04) { b.onFire = 0; this.netDirty = true; return; }
    if (b.onFire > 24) {
      // player-built buildings survive (they just stop working while burning); zoned ones burn down
      if (b.zoned) this.destroy(b);
      else { b.onFire = 0; this.netDirty = true; }
      return;
    }
    if (Math.random() < 0.07) {
      const x = b.x - 1 + Math.floor(Math.random() * (b.w + 2)), y = b.y - 1 + Math.floor(Math.random() * (b.h + 2));
      if (!w.inb(x, y)) return;
      const nb = w.buildingAt(x, y);
      if (nb && nb !== b) this.ignite(nb, nb.zoned);
      else if (!nb && w.trees[w.idx(x, y)]) w.trees[w.idx(x, y)] = 0;
    }
  }
  destroy(b) {
    const w = this.world;
    w.removeBuilding(b.id);
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) {
      const r = w.addBuilding('rubble', xx, yy, { variant: (xx * 7 + yy * 3) & 3 });
      r.powered = true;
    }
    this.netDirty = true;
    this.mapsDirty = true;
  }
  bName(b) {
    if (b.zoned) return `${['', 'Small', 'Medium', 'Large'][b.level]} ${ZONE_NAMES[ZONE_KEYS.indexOf(b.type)].toLowerCase()} building`;
    return BUILDINGS[b.type].name;
  }

  // ---------------- disasters ----------------
  disaster(kind, x, y) {
    const w = this.world;
    if (kind === 'fire') {
      const b = w.buildingAt(x, y);
      if (b && b.type !== 'rubble') this.ignite(b);
      else this.toast('Click on a building to set it on fire.', 'info');
    } else if (kind === 'meteor') {
      this.agents.spawnMeteor(x, y);
    } else if (kind === 'tornado') {
      this.agents.spawnTornado(x, y);
      this.toast('🌪️ A tornado has touched down!', 'bad', [x, y]);
    } else if (kind === 'quake') {
      this.emit('shake', 2.5);
      let hit = 0;
      for (const b of [...w.buildings.values()]) {
        if (b.type === 'rubble' || !w.buildings.has(b.id)) continue;
        const r = Math.random();
        if (r < 0.025) { this.destroy(b); hit++; } else if (r < 0.06) { this.ignite(b, true); hit++; }
      }
      this.toast(`🌋 Earthquake! ${hit} buildings damaged.`, 'bad');
    }
  }
  impact(cx, cy, r) {
    const w = this.world;
    for (let y = cy - r - 2; y <= cy + r + 2; y++) for (let x = cx - r - 2; x <= cx + r + 2; x++) {
      if (!w.inb(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy), i = w.idx(x, y);
      if (d <= r) {
        w.trees[i] = 0;
        const b = w.buildingAt(x, y);
        if (b && b.type !== 'rubble') this.destroy(b);
        if (d <= r - 0.5) { w.road[i] = 0; w.pline[i] = 0; }
        if (w.terrain[i] === T_GRASS && d < r - 0.5) w.terrain[i] = T_SAND;
        w.touch(x, y);
      } else if (d <= r + 2 && Math.random() < 0.4) {
        const b = w.buildingAt(x, y);
        if (b) this.ignite(b, true);
      }
    }
    this.netDirty = this.zonesDirty = this.mapsDirty = true;
    this.emit('shake', 1.2);
    this.toast('☄️ Meteor impact!', 'bad', [cx, cy]);
  }
  tornadoHit(x, y) {
    const w = this.world;
    if (!w.inb(x, y)) return;
    const i = w.idx(x, y);
    w.trees[i] = 0;
    const b = w.buildingAt(x, y);
    if (b && b.type !== 'rubble' && Math.random() < 0.7) this.destroy(b);
    if (Math.random() < 0.3) { w.pline[i] = 0; this.netDirty = true; }
  }

  // ---------------- monthly ----------------
  taxIncome() {
    const st = this.state, s = this.stats;
    const fill = s.jobs > 0 ? Math.min(1, s.workers / s.jobs) : 0;
    return {
      r: s.pop * st.taxR * 0.06,
      c: s.cJobs * fill * st.taxC * 0.085,
      i: s.iJobs * fill * st.taxI * 0.085,
    };
  }
  monthTick() {
    const st = this.state, s = this.stats;
    const inc = this.taxIncome();
    const exp = { services: 0, power: 0, water: 0, parks: 0, landmarks: 0, roads: s.roads * 0.5 + s.plines * 0.15, loan: 0 };
    for (const b of this.world.buildings.values()) {
      if (b.zoned || b.type === 'rubble') continue;
      const d = BUILDINGS[b.type];
      const cat = d.power ? 'power' : d.water ? 'water' : d.service ? 'services' : d.park && !d.unique ? 'parks' : 'landmarks';
      exp[cat] += d.upkeep;
    }
    if (st.debt > 0) { exp.loan = Math.min(st.debt, 250); st.debt -= exp.loan; }
    const income = inc.r + inc.c + inc.i;
    const expense = Object.values(exp).reduce((a, b) => a + b, 0);
    if (!st.sandbox) st.money += income - expense;
    st.report = { inc, exp, income, expense, net: income - expense };
    st.history.push({ d: st.day, pop: s.pop, money: Math.round(st.money), inc: Math.round(income), exp: Math.round(expense), hap: Math.round(st.happiness) });
    if (st.history.length > 360) st.history.shift();
    this.advisor();
    this.emit('month');
  }

  advise(key, msg, type, every) {
    const a = this.state.advisor, m = Math.floor(this.state.day / 30);
    if (a[key] !== undefined && m - a[key] < (every || 8)) return;
    a[key] = m;
    this.toast(msg, type || 'warn');
  }
  advisor() {
    const s = this.stats, st = this.state, w = this.world;
    if (s.zoned === 0 && st.day > 60 && st.day < 400) this.advise('nozone', '💡 Tip: drag zones next to roads. Green = homes, blue = shops, yellow = industry.', 'info', 4);
    if (s.powerCap === 0 && this.zoneList.length > 0) this.advise('nopower', '⚡ Your zones need electricity. Build a power plant and connect it with roads or power lines.', 'warn', 3);
    else if (s.powerNeed > s.powerCap) this.advise('lowpower', `⚡ Power shortage! Using ${fmtNum(s.powerNeed)} MW, only ${fmtNum(s.powerCap)} MW available.`, 'bad', 4);
    if (s.pop > 150 && s.waterCap === 0) this.advise('nowater', '💧 Buildings can\'t grow beyond small size without water. Build a water pump or tower.', 'warn', 5);
    else if (s.waterNeed > s.waterCap && s.waterCap > 0) this.advise('lowwater', '💧 Water shortage! Build more pumps or towers.', 'bad', 5);
    if (s.pop > 500 && !s.counts.police) this.advise('police', '🚓 Crime is rising. Citizens want a police station.', 'warn');
    if (s.pop > 500 && !s.counts.fire) this.advise('fire', '🚒 No fire protection! One spark and the city burns.', 'warn');
    if (s.pop > 900 && !s.counts.school && !s.counts.university) this.advise('school', '🎓 Families want a school nearby.', 'warn');
    if (s.pop > 900 && !s.counts.clinic && !s.counts.hospital) this.advise('health', '🏥 People are getting sick. Build a clinic.', 'warn');
    if (s.pop > 1200 && !s.counts.landfill && !s.counts.incinerator) this.advise('garbage', '🗑️ Garbage is piling up. Build a landfill.', 'warn');
    if (!st.sandbox && st.money < 0) this.advise('broke', '💸 We\'re in the red! Raise taxes, cut services or take a loan (Budget).', 'bad', 3);
    if (st.demand.r > 0.6 && this.emptyZones(Z_R) < 5) this.advise('needR', '🏠 People want to move in. Zone more residential!', 'info', 6);
    if (st.demand.c > 0.6 && this.emptyZones(Z_C) < 3) this.advise('needC', '🏬 Shops are in demand. Zone more commercial!', 'info', 6);
    if (st.demand.i > 0.6 && this.emptyZones(Z_I) < 3) this.advise('needI', '🏭 Industry wants space. Zone more industrial!', 'info', 6);
    if (s.unemployment > 0.25 && s.pop > 200) this.advise('unemp', `👷 ${Math.round(s.unemployment * 100)}% unemployment. Zone commercial or industrial.`, 'warn', 6);
    if (st.happiness < 30 && s.pop > 200) this.advise('unhappy', '😠 Citizens are unhappy. Check taxes, pollution, services.', 'bad', 6);
    let unconnected = 0;
    for (const i of this.zoneList) if (w.bld[i] < 0 && w.roadDist[i] > 3) unconnected++;
    if (unconnected > 10) this.advise('roadaccess', '🛣️ Some zones are too far from a road (max 3 tiles) to grow.', 'info', 10);
  }
  emptyZones(z) {
    const w = this.world;
    let n = 0;
    for (const i of this.zoneList) if (w.zone[i] === z && w.bld[i] < 0 && w.roadDist[i] <= 3) n++;
    return n;
  }

  takeLoan() {
    const st = this.state;
    if (st.debt > 60000) { this.toast('The bank refuses: too much debt already.', 'bad'); return; }
    st.money += 25000; st.debt += 30000;
    this.toast('🏦 Loan taken: +$25,000 (repaid $250/month).', 'info');
  }
  repayLoan() {
    const st = this.state, amt = Math.min(st.debt, st.money);
    if (amt <= 0) return;
    st.money -= amt; st.debt -= amt;
    this.toast(`🏦 Repaid ${fmtMoney(amt)}.`, 'good');
  }

  // ---------------- tools ----------------
  lineTiles(x0, y0, x1, y1) {
    const out = [];
    const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
      for (let x = x0; ; x += sx) { out.push([x, y0]); if (x === x1) break; }
      if (sy) for (let y = y0 + sy; ; y += sy) { out.push([x1, y]); if (y === y1) break; }
    } else {
      for (let y = y0; ; y += sy) { out.push([x0, y]); if (y === y1) break; }
      if (sx) for (let x = x0 + sx; ; x += sx) { out.push([x, y1]); if (x === x1) break; }
    }
    return out;
  }
  rectTiles(x0, y0, x1, y1) {
    const out = [];
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push([x, y]);
    return out;
  }
  footprint(type, tx, ty) {
    const d = BUILDINGS[type];
    return [tx - Math.floor((d.w - 1) / 2), ty - Math.floor((d.h - 1) / 2)];
  }

  // Evaluate (dry) or apply a tool on a list of tiles. Returns {cost, ok:[bool per tile], msg}
  useTool(toolId, tiles, dry) {
    const t = TOOLS[toolId], w = this.world;
    const res = { cost: 0, ok: [], msg: '', count: 0 };
    if (!t) return res;
    let changed = false;
    const tryTile = (cost, fn) => {
      if (!dry && !this.canAfford(res.cost + cost)) { res.msg = 'Not enough money'; return false; }
      res.cost += cost; res.count++;
      if (!dry) { fn(); w.touch(curX, curY); }
      changed = true;
      return true;
    };
    const seen = new Set();
    let curX = 0, curY = 0;
    for (const [x, y] of tiles) {
      curX = x; curY = y;
      if (!w.inb(x, y)) { res.ok.push(false); continue; }
      const i = w.idx(x, y), id = w.bld[i];
      const b = id >= 0 ? w.buildings.get(id) : null;
      let ok = false;
      switch (t.kind) {
        case 'road': {
          if (w.road[i]) { ok = true; break; }
          if (b && b.type !== 'rubble') break;
          const cost = (w.terrain[i] === T_WATER ? 50 : 10) + (w.trees[i] ? 5 : 0);
          ok = tryTile(cost, () => {
            if (b) w.removeBuilding(b.id);
            w.road[i] = 1; w.zone[i] = 0; w.trees[i] = 0;
          });
          break;
        }
        case 'pline': {
          if (w.pline[i]) { ok = true; break; }
          if (b && b.type !== 'rubble') break;
          ok = tryTile(w.terrain[i] === T_WATER ? 20 : 5, () => { if (b) w.removeBuilding(b.id); w.pline[i] = 1; w.trees[i] = 0; });
          break;
        }
        case 'zone': {
          if (w.terrain[i] === T_WATER || w.road[i]) break;
          if (b && !(b.zoned && w.zone[i] === t.zone)) break;
          if (w.zone[i] === t.zone) { ok = true; break; }
          ok = tryTile(t.cost, () => { w.zone[i] = t.zone; });
          break;
        }
        case 'dezone': {
          if (!w.zone[i]) break;
          ok = tryTile(0, () => { if (b && b.zoned) w.removeBuilding(b.id); w.zone[i] = 0; });
          break;
        }
        case 'bulldoze': {
          if (b) {
            if (seen.has(b.id)) { ok = true; break; }
            seen.add(b.id);
            const cost = b.zoned || b.type === 'rubble' ? 5 : Math.round(b.w * b.h * 10);
            ok = tryTile(cost, () => w.removeBuilding(b.id));
          } else if (w.road[i]) ok = tryTile(2, () => { w.road[i] = 0; });
          else if (w.pline[i]) ok = tryTile(2, () => { w.pline[i] = 0; });
          else if (w.trees[i]) ok = tryTile(3, () => { w.trees[i] = 0; });
          break;
        }
        case 'tree': {
          if (w.terrain[i] === T_WATER || w.road[i] || b || w.zone[i] || w.trees[i] >= 2) break;
          ok = tryTile(t.cost, () => { w.trees[i] = 2 + (Math.random() < 0.4 ? 1 : 0); });
          break;
        }
      }
      res.ok.push(ok);
    }
    if (!dry && changed) {
      this.spend(res.cost);
      this.netDirty = true; this.zonesDirty = true; this.mapsDirty = true;
      this.emit('built');
    }
    return res;
  }

  checkPlace(type, x0, y0) {
    const w = this.world, d = BUILDINGS[type];
    if (!this.isUnlocked(type)) return `Unlocks at ${fmtNum(d.unlock)} population`;
    if (d.unique && this.stats.counts[type]) return 'You can only build one';
    let nearWater = false;
    for (let y = y0; y < y0 + d.h; y++) for (let x = x0; x < x0 + d.w; x++) {
      if (!w.inb(x, y)) return 'Out of bounds';
      const i = w.idx(x, y);
      if (w.terrain[i] === T_WATER) return 'Can\'t build on water';
      if (w.road[i] || w.pline[i]) return 'Blocked by road / power line';
      const b = w.buildingAt(x, y);
      if (b && b.type !== 'rubble') return 'Blocked by a building';
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.isWater(x + dx, y + dy)) nearWater = true;
    }
    if (d.nearWater && !nearWater) return 'Must be placed next to water';
    if (!this.canAfford(d.cost)) return 'Not enough money';
    return null;
  }
  placeBuilding(type, tx, ty) {
    const [x0, y0] = this.footprint(type, tx, ty);
    const err = this.checkPlace(type, x0, y0);
    if (err) return err;
    const w = this.world, d = BUILDINGS[type];
    for (let y = y0; y < y0 + d.h; y++) for (let x = x0; x < x0 + d.w; x++) {
      const b = w.buildingAt(x, y);
      if (b) w.removeBuilding(b.id);
    }
    w.addBuilding(type, x0, y0);
    this.spend(d.cost);
    this.netDirty = this.zonesDirty = this.mapsDirty = true;
    this.recalcNetworks();
    this.recalcStats();
    this.emit('built', type);
    return null;
  }
}
