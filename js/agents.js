'use strict';
// Moving things: cars, smoke and fire particles, meteors, tornadoes.

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

class Agents {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.particles = [];
    this.meteors = [];
    this.tornadoes = [];
    this.spawnAcc = 0;
  }

  get world() { return this.game.world; }

  targetCars() {
    const s = this.game.stats;
    return Math.min(450, Math.floor(s.trips / 9), Math.floor(this.game.roadList.length * 0.6));
  }

  spawnCar() {
    const w = this.world, rl = this.game.roadList;
    if (!rl.length) return;
    for (let tries = 0; tries < 8; tries++) {
      const i = rl[(Math.random() * rl.length) | 0];
      if (w.traffic[i] < 0.02 && Math.random() < 0.85) continue;
      const x = i % w.W, y = (i / w.W) | 0;
      const opts = this.roadNeighbors(x, y);
      if (!opts.length) return;
      const [nx, ny] = opts[(Math.random() * opts.length) | 0];
      this.cars.push({ x, y, px: x, py: y, nx, ny, t: Math.random(), speed: 1.4 + Math.random() * 1.2, life: 12 + Math.floor(Math.random() * 40), c: (Math.random() * CAR_COLORS.length) | 0 });
      return;
    }
  }
  roadNeighbors(x, y) {
    const w = this.world, out = [];
    for (const [dx, dy] of DIRS) {
      const xx = x + dx, yy = y + dy;
      if (w.inb(xx, yy) && w.road[w.idx(xx, yy)]) out.push([xx, yy]);
    }
    return out;
  }

  update(dt, simFactor) {
    const w = this.world;
    if (!w) return;
    // cars
    if (simFactor > 0) {
      const target = this.targetCars();
      this.spawnAcc += dt * 12;
      while (this.spawnAcc > 1) { this.spawnAcc--; if (this.cars.length < target) this.spawnCar(); }
      if (this.cars.length > target + 20) this.cars.length = target;
      const keep = [];
      for (const c of this.cars) {
        const slow = 1 / (1 + Math.max(0, w.traffic[w.idx(c.nx, c.ny)] - 0.6) * 1.5);
        c.t += dt * c.speed * simFactor * slow;
        let alive = true;
        while (c.t >= 1) {
          c.t -= 1;
          c.px = c.x; c.py = c.y; c.x = c.nx; c.y = c.ny;
          c.life--;
          if (c.life <= 0 || !w.road[w.idx(c.x, c.y)]) { alive = false; break; }
          const opts = this.roadNeighbors(c.x, c.y).filter(([a, b]) => a !== c.px || b !== c.py);
          if (!opts.length) { c.nx = c.px; c.ny = c.py; } else { const o = opts[(Math.random() * opts.length) | 0]; c.nx = o[0]; c.ny = o[1]; }
        }
        if (alive && w.road[w.idx(c.nx, c.ny)]) keep.push(c);
      }
      this.cars = keep;
    }
    // particles
    const ps = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.r += p.gr * dt;
      ps.push(p);
    }
    this.particles = ps;
    // meteors
    for (const m of this.meteors) {
      m.t += dt;
      if (Math.random() < 0.8) {
        const k = m.t / m.dur, [mx, my] = this.meteorPos(m, k);
        this.particles.push({ x: mx, y: my, vx: (Math.random() - 0.5) * 20, vy: -10, r: 4, gr: 10, life: 0.6, max: 0.6, kind: 'fire' });
      }
      if (m.t >= m.dur) {
        m.done = true;
        this.game.impact(m.tx, m.ty, 2);
        const cx = (m.tx - m.ty) * 32, cy = (m.tx + m.ty) * 16 + 16;
        for (let k = 0; k < 40; k++) {
          const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 90;
          this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5 - 40, r: 4 + Math.random() * 6, gr: 18, life: 1.5, max: 1.5, kind: Math.random() < 0.5 ? 'fire' : 'smoke' });
        }
      }
    }
    this.meteors = this.meteors.filter(m => !m.done);
    // tornadoes
    for (const t of this.tornadoes) {
      t.life -= dt;
      t.ang += (Math.random() - 0.5) * dt * 2.5;
      t.x += Math.cos(t.ang) * dt * 2.2;
      t.y += Math.sin(t.ang) * dt * 2.2;
      t.spin += dt * 12;
      const tx = Math.floor(t.x), ty = Math.floor(t.y);
      if (tx !== t.lx || ty !== t.ly) {
        t.lx = tx; t.ly = ty;
        this.game.tornadoHit(tx, ty);
        if (Math.random() < 0.5) this.game.tornadoHit(tx + (Math.random() < 0.5 ? 1 : -1), ty);
      }
      if (Math.random() < dt * 30) {
        const wx = (t.x - t.y) * 32, wy = (t.x + t.y) * 16;
        this.particles.push({ x: wx + (Math.random() - 0.5) * 30, y: wy, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40, r: 3, gr: 6, life: 1, max: 1, kind: 'dust' });
      }
      if (!w.inb(tx, ty) || t.life <= 0) t.done = true;
    }
    this.tornadoes = this.tornadoes.filter(t => !t.done);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  carWorldPos(c) {
    const dx = c.nx - c.x, dy = c.ny - c.y;
    const tx = c.x + 0.5 + dx * c.t - dy * 0.17, ty = c.y + 0.5 + dy * c.t + dx * 0.17;
    return [(tx - ty) * 32, (tx + ty) * 16, dx !== 0 ? 0 : 1];
  }

  emit(x, y, kind) {
    if (kind === 'smoke') this.particles.push({ x: x + (Math.random() - 0.5) * 2, y, vx: 6 + Math.random() * 6, vy: -14 - Math.random() * 8, r: 2.5, gr: 5, life: 3, max: 3, kind });
    else if (kind === 'steam') this.particles.push({ x: x + (Math.random() - 0.5) * 8, y, vx: 4 + Math.random() * 4, vy: -16 - Math.random() * 6, r: 6, gr: 7, life: 3.5, max: 3.5, kind });
    else if (kind === 'blacksmoke') this.particles.push({ x: x + (Math.random() - 0.5) * 10, y, vx: 5 + Math.random() * 8, vy: -20 - Math.random() * 10, r: 4, gr: 8, life: 2.5, max: 2.5, kind });
    else if (kind === 'fire') this.particles.push({ x: x + (Math.random() - 0.5) * 16, y: y - Math.random() * 6, vx: (Math.random() - 0.5) * 8, vy: -25 - Math.random() * 20, r: 3 + Math.random() * 2, gr: -1.5, life: 0.7, max: 0.7, kind });
  }

  spawnMeteor(tx, ty) { this.meteors.push({ tx, ty, t: 0, dur: 1.6 }); }
  meteorPos(m, k) {
    const ex = (m.tx - m.ty) * 32, ey = (m.tx + m.ty) * 16 + 16;
    return [ex - 700 * (1 - k), ey - 900 * (1 - k)];
  }
  spawnTornado(tx, ty) {
    this.tornadoes.push({ x: tx + 0.5, y: ty + 0.5, ang: Math.random() * Math.PI * 2, life: 14, spin: 0, lx: -1, ly: -1 });
  }
}
