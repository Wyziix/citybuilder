'use strict';
// The map: terrain, infrastructure, zones, buildings and simulation layers.

const T_GRASS = 0, T_WATER = 1, T_SAND = 2;

class World {
  constructor(size) {
    this.W = size; this.H = size;
    const N = this.N = size * size;
    this.terrain = new Uint8Array(N);
    this.trees = new Uint8Array(N);
    this.road = new Uint8Array(N);
    this.pline = new Uint8Array(N);
    this.zone = new Uint8Array(N);
    this.bld = new Int32Array(N).fill(-1);
    this.gvar = new Uint8Array(N);
    this.buildings = new Map();
    this.nextId = 1;
    // simulation layers
    this.power = new Uint8Array(N);
    this.water = new Uint8Array(N);
    this.roadDist = new Uint8Array(N);
    this.waterDist = new Uint8Array(N);
    this.pollution = new Float32Array(N);
    this.landValue = new Float32Array(N);
    this.crime = new Float32Array(N);
    this.traffic = new Float32Array(N);
    this.parkInf = new Float32Array(N);
    this.cov = {};
    for (const s of SERVICE_TYPES) this.cov[s] = new Float32Array(N);
    // ground chunk versions, so the renderer knows what to redraw
    this.CS = 8;
    this.cw = Math.ceil(size / this.CS);
    this.chunkVer = new Uint32Array(this.cw * this.cw);
  }

  touch(x, y) {
    const cs = this.CS, cx = (x / cs) | 0, cy = (y / cs) | 0;
    const mark = (a, b) => { if (a >= 0 && b >= 0 && a < this.cw && b < this.cw) this.chunkVer[b * this.cw + a]++; };
    mark(cx, cy);
    if (x % cs === 0) mark(cx - 1, cy);
    if (x % cs === cs - 1) mark(cx + 1, cy);
    if (y % cs === 0) mark(cx, cy - 1);
    if (y % cs === cs - 1) mark(cx, cy + 1);
  }

  idx(x, y) { return y * this.W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  isWater(x, y) { return this.inb(x, y) && this.terrain[this.idx(x, y)] === T_WATER; }

  generate(seed, mapType) {
    const W = this.W, H = this.H;
    const n = new Noise2D(seed), n2 = new Noise2D(seed + 7919), rng = mulberry32(seed + 3);
    const hgt = new Float32Array(this.N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let h = n.fbm(x / 24, y / 24, 5);
        if (mapType === 'island') {
          const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
          const d = Math.sqrt(dx * dx + dy * dy);
          h = h * 0.55 + 0.62 - d * 0.55;
        } else if (mapType === 'coast') {
          h = h * 0.8 + 0.16 + (x / W) * 0.45;
        } else if (mapType === 'lakes') {
          h = h * 1.05 + 0.02;
        } else {
          h = h * 0.8 + 0.2;
        }
        hgt[this.idx(x, y)] = h;
      }
    }
    // keep the middle buildable
    const cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy) / (W * 0.12);
      if (d < 1) hgt[this.idx(x, y)] = Math.max(hgt[this.idx(x, y)], lerp(0.5, 0.36, d));
    }
    const WL = 0.36;
    for (let i = 0; i < this.N; i++) {
      this.terrain[i] = hgt[i] < WL ? T_WATER : hgt[i] < WL + 0.025 ? T_SAND : T_GRASS;
    }
    // river
    if (mapType !== 'island') {
      let x = W * (0.25 + rng() * 0.2), dir = rng() < 0.5 ? 1 : -1;
      const phase = rng() * 6, amp = W * (0.08 + rng() * 0.08);
      const width = 1.4 + rng() * 0.8;
      for (let y = -2; y < H + 2; y++) {
        const xx = x + Math.sin(y / (H * 0.12) + phase) * amp + (n.raw(y / 9, 3.3) - 0.5) * 6;
        for (let ox = -4; ox <= 4; ox++) {
          const tx = Math.round(xx + ox);
          for (let oy = 0; oy <= 1; oy++) {
            const ty = y + oy;
            if (!this.inb(tx, ty)) continue;
            const i = this.idx(tx, ty);
            if (Math.abs(ox) <= width) this.terrain[i] = T_WATER;
            else if (Math.abs(ox) <= width + 1.2 && this.terrain[i] !== T_WATER) this.terrain[i] = T_SAND;
          }
        }
        x += dir * 0.08;
      }
    }
    // beaches next to water
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = this.idx(x, y);
      if (this.terrain[i] !== T_GRASS) continue;
      let wn = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.isWater(x + dx, y + dy)) wn++;
      if (wn > 0 && hash2(x, y, seed) < 0.55) this.terrain[i] = T_SAND;
    }
    // forests
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = this.idx(x, y);
      this.gvar[i] = Math.floor(hash2(x, y, seed + 1) * 256);
      if (this.terrain[i] === T_WATER) continue;
      const f = n2.fbm(x / 13, y / 13, 4);
      const center = Math.hypot(x - cx, y - cy) < W * 0.08;
      if (f > 0.56 && !center) this.trees[i] = clamp(1 + Math.floor((f - 0.56) * 18), 1, 3);
      else if (rng() < 0.025) this.trees[i] = 1;
      if (this.terrain[i] === T_SAND && this.trees[i] > 1) this.trees[i] = 1;
    }
    this.computeWaterDist();
  }

  computeWaterDist() {
    const W = this.W, H = this.H, q = new Int32Array(this.N);
    let h = 0, t = 0;
    this.waterDist.fill(255);
    for (let i = 0; i < this.N; i++) if (this.terrain[i] === T_WATER) { this.waterDist[i] = 0; q[t++] = i; }
    while (h < t) {
      const i = q[h++], x = i % W, y = (i / W) | 0, d = this.waterDist[i];
      if (d >= 8) continue;
      if (x > 0 && this.waterDist[i - 1] > d + 1) { this.waterDist[i - 1] = d + 1; q[t++] = i - 1; }
      if (x < W - 1 && this.waterDist[i + 1] > d + 1) { this.waterDist[i + 1] = d + 1; q[t++] = i + 1; }
      if (y > 0 && this.waterDist[i - W] > d + 1) { this.waterDist[i - W] = d + 1; q[t++] = i - W; }
      if (y < H - 1 && this.waterDist[i + W] > d + 1) { this.waterDist[i + W] = d + 1; q[t++] = i + W; }
    }
  }

  roadMask(x, y) {
    let m = 0;
    if (y > 0 && this.road[this.idx(x, y - 1)]) m |= 1;
    if (x < this.W - 1 && this.road[this.idx(x + 1, y)]) m |= 2;
    if (y < this.H - 1 && this.road[this.idx(x, y + 1)]) m |= 4;
    if (x > 0 && this.road[this.idx(x - 1, y)]) m |= 8;
    return m;
  }
  shoreMask(x, y) {
    let m = 0;
    const land = (xx, yy) => this.inb(xx, yy) && this.terrain[this.idx(xx, yy)] !== T_WATER;
    if (land(x, y - 1)) m |= 1;
    if (land(x + 1, y)) m |= 2;
    if (land(x, y + 1)) m |= 4;
    if (land(x - 1, y)) m |= 8;
    return m;
  }

  addBuilding(type, x, y, opts) {
    opts = opts || {};
    const zoned = type === 'R' || type === 'C' || type === 'I';
    const d = zoned ? { w: 1, h: 1 } : BUILDINGS[type];
    const b = {
      id: this.nextId++, type, x, y, w: d.w, h: d.h, zoned,
      level: opts.level || 1, variant: opts.variant !== undefined ? opts.variant : Math.floor(Math.random() * 60),
      constructing: 0, abandoned: false, onFire: 0, powered: false, watered: false,
      pop: 0, jobs: 0, age: 0, trouble: 0,
    };
    for (let yy = y; yy < y + b.h; yy++) for (let xx = x; xx < x + b.w; xx++) {
      const i = this.idx(xx, yy);
      this.bld[i] = b.id;
      this.trees[i] = 0;
      this.touch(xx, yy);
      if (!zoned && type !== 'rubble') this.zone[i] = 0;
    }
    this.buildings.set(b.id, b);
    return b;
  }

  removeBuilding(id) {
    const b = this.buildings.get(id);
    if (!b) return null;
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) {
      const i = this.idx(xx, yy);
      if (this.bld[i] === id) this.bld[i] = -1;
      this.touch(xx, yy);
    }
    this.buildings.delete(id);
    return b;
  }

  buildingAt(x, y) {
    if (!this.inb(x, y)) return null;
    const id = this.bld[this.idx(x, y)];
    return id >= 0 ? this.buildings.get(id) : null;
  }

  serialize() {
    return {
      size: this.W,
      terrain: bytesToB64(this.terrain),
      trees: bytesToB64(this.trees),
      road: bytesToB64(this.road),
      pline: bytesToB64(this.pline),
      zone: bytesToB64(this.zone),
      gvar: bytesToB64(this.gvar),
      nextId: this.nextId,
      buildings: [...this.buildings.values()].map(b => [b.id, b.type, b.x, b.y, b.level, b.variant, b.constructing | 0, b.abandoned ? 1 : 0, b.onFire | 0, b.age | 0]),
    };
  }

  static deserialize(o) {
    const w = new World(o.size);
    w.terrain.set(b64ToBytes(o.terrain));
    w.trees.set(b64ToBytes(o.trees));
    w.road.set(b64ToBytes(o.road));
    w.pline.set(b64ToBytes(o.pline));
    w.zone.set(b64ToBytes(o.zone));
    w.gvar.set(b64ToBytes(o.gvar));
    for (const a of o.buildings) {
      const type = a[1], zoned = type === 'R' || type === 'C' || type === 'I';
      const d = zoned ? { w: 1, h: 1 } : BUILDINGS[type];
      if (!d) continue;
      const b = {
        id: a[0], type, x: a[2], y: a[3], w: d.w, h: d.h, zoned, level: a[4], variant: a[5],
        constructing: a[6], abandoned: !!a[7], onFire: a[8], powered: false, watered: false,
        pop: 0, jobs: 0, age: a[9], trouble: 0,
      };
      for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) w.bld[w.idx(xx, yy)] = b.id;
      w.buildings.set(b.id, b);
    }
    w.nextId = o.nextId;
    w.computeWaterDist();
    return w;
  }
}
