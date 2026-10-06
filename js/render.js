'use strict';
// Isometric canvas renderer.

class Renderer {
  constructor(canvas, game) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.time = 0;
    this.tod = 0.33;          // time of day 0..1 (0 = midnight)
    this.dayNight = true;
    this.shakeT = 0;
    this.hover = null;        // {x, y}
    this.preview = null;      // set by input
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = window.innerWidth; this.ch = window.innerHeight;
    this.cv.width = Math.floor(this.cw * this.dpr);
    this.cv.height = Math.floor(this.ch * this.dpr);
    this.cv.style.width = this.cw + 'px';
    this.cv.style.height = this.ch + 'px';
  }

  centerOn(tx, ty) { this.cam.x = (tx - ty) * 32; this.cam.y = (tx + ty) * 16; }
  screenToWorld(sx, sy) { return [(sx - this.cw / 2) / this.cam.zoom + this.cam.x, (sy - this.ch / 2) / this.cam.zoom + this.cam.y]; }
  screenToTile(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const a = wx / 32, b = wy / 16;
    return [Math.floor((a + b) / 2), Math.floor((b - a) / 2)];
  }
  tileToScreen(tx, ty) {
    const wx = (tx - ty) * 32, wy = (tx + ty) * 16;
    return [(wx - this.cam.x) * this.cam.zoom + this.cw / 2, (wy - this.cam.y) * this.cam.zoom + this.ch / 2];
  }
  zoomAt(sx, sy, f) {
    const [bx, by] = this.screenToWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * f, 0.25, 3.5);
    const [ax, ay] = this.screenToWorld(sx, sy);
    this.cam.x += bx - ax; this.cam.y += by - ay;
    this.clampCam();
  }
  clampCam() {
    const w = this.game.world;
    if (!w) return;
    this.cam.x = clamp(this.cam.x, -w.H * 32, w.W * 32);
    this.cam.y = clamp(this.cam.y, 0, (w.W + w.H) * 16);
  }
  nightFactor() {
    if (!this.dayNight) return 0;
    const s = Math.cos((this.tod - 0.5) * Math.PI * 2);
    return clamp((0.25 - s) / 0.55, 0, 0.78);
  }
  duskFactor() {
    if (!this.dayNight) return 0;
    const s = Math.cos((this.tod - 0.5) * Math.PI * 2);
    return clamp(1 - Math.abs(s - 0.1) / 0.35, 0, 1);
  }

  render(dt) {
    const g = this.game, w = g.world, ctx = this.ctx;
    this.time += dt;
    if (g.speed > 0 && this.dayNight) this.tod = (this.tod + dt / 150 * (g.speed > 2 ? 1.6 : 1)) % 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16324a';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!w) return;

    let sx = 0, sy = 0;
    if (this.shakeT > 0) { this.shakeT -= dt; const k = Math.min(1, this.shakeT) * 6; sx = (Math.random() - 0.5) * k; sy = (Math.random() - 0.5) * k; }
    const z = this.cam.zoom, dpr = this.dpr;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.cw / 2 - this.cam.x * z + sx), dpr * (this.ch / 2 - this.cam.y * z + sy));
    ctx.imageSmoothingEnabled = true;

    const L = this.cam.x - this.cw / 2 / z, R = this.cam.x + this.cw / 2 / z;
    const T = this.cam.y - this.ch / 2 / z, B = this.cam.y + this.ch / 2 / z;
    this.view = { L, R, T, B };
    const W = w.W, H = w.H;
    const overlay = g.overlay || 'none';

    // ---- map slab edges ----
    this.drawSlab(ctx, w);

    // ---- ground ----
    const roadsVis = [];
    const dMin = Math.max(0, Math.floor(T / 16) - 2), dMax = Math.min(W + H - 2, Math.ceil(B / 16) + 1);
    const scaleHint = z * dpr;
    const nfPre = this.nightFactor();
    if (scaleHint >= 1.5) {
      for (let d = dMin; d <= dMax; d++) {
        const xa = Math.max(0, d - H + 1, Math.ceil(((L - 40) / 32 + d) / 2)), xb = Math.min(W - 1, d, Math.floor(((R + 40) / 32 + d) / 2));
        for (let x = xa; x <= xb; x++) {
          const y = d - x, i = y * W + x;
          this.drawGroundTile(ctx, w, x, y, i, true);
          if (w.road[i]) roadsVis.push(i);
        }
      }
    } else {
      const cs = scaleHint >= 0.75 ? 1 : scaleHint >= 0.375 ? 0.5 : 0.25;
      this.drawChunks(ctx, w, cs, L, R, T, B);
      const shimmer = z >= 0.55;
      if (shimmer || nfPre > 0.05) {
        for (let d = dMin; d <= dMax; d++) {
          const xa = Math.max(0, d - H + 1, Math.ceil(((L - 40) / 32 + d) / 2)), xb = Math.min(W - 1, d, Math.floor(((R + 40) / 32 + d) / 2));
          for (let x = xa; x <= xb; x++) {
            const y = d - x, i = y * W + x;
            if (w.road[i]) { roadsVis.push(i); continue; }
            if (shimmer && w.terrain[i] === T_WATER) {
              const f = Math.floor(this.time * 1.2 + (w.gvar[i] & 7) * 0.37) % 3;
              if (f === 0) continue;
              const s = waterShimmer(f);
              ctx.drawImage(s.c, (x - y) * 32 + s.ax, d * 16 + s.ay, s.w, s.h);
            }
          }
        }
      }
    }

    // ---- data overlay ----
    if (overlay !== 'none') this.drawOverlay(ctx, w, overlay, dMin, dMax, L, R);

    // ---- cars ----
    const agents = g.agents;
    for (const c of agents.cars) {
      const [x, y, ax] = agents.carWorldPos(c);
      if (x < L - 20 || x > R + 20 || y < T - 20 || y > B + 20) continue;
      const s = carSprite(c.c, ax);
      ctx.drawImage(s.c, x + s.ax, y + s.ay, s.w, s.h);
    }

    // ---- objects ----
    const lit = [], fires = [];
    const oMax = Math.min(W + H - 2, Math.ceil((B + 220) / 16));
    const objAlpha = overlay !== 'none' ? 0.5 : 1;
    ctx.globalAlpha = objAlpha;
    const blink = (this.time % 1.2) < 0.75;
    for (let d = dMin; d <= oMax; d++) {
      const xa = Math.max(0, d - H + 1, Math.ceil(((L - 160) / 32 + d) / 2)), xb = Math.min(W - 1, d, Math.floor(((R + 160) / 32 + d) / 2));
      const wy = d * 16;
      for (let x = xa; x <= xb; x++) {
        const y = d - x, i = y * W + x, wx = (x - y) * 32;
        const id = w.bld[i];
        if (id >= 0) {
          const b = w.buildings.get(id);
          if (b && x === b.x + b.w - 1 && y === b.y + b.h - 1) this.drawBuilding(ctx, b, lit, fires, blink, dt);
        } else if (w.trees[i] && !w.road[i]) {
          const s = treeSprite(w.trees[i], w.gvar[i] & 7);
          if (wx + s.ax < R && wx + s.ax + s.w > L && wy + s.ay < B) ctx.drawImage(s.c, wx + s.ax, wy + s.ay, s.w, s.h);
        }
        if (w.pline[i]) this.drawPole(ctx, w, x, y, i);
      }
    }
    ctx.globalAlpha = 1;

    // ---- tornado ----
    for (const t of agents.tornadoes) this.drawTornado(ctx, t);

    // ---- particles below night (smoke, dust) ----
    for (const p of agents.particles) {
      if (p.kind === 'fire') continue;
      if (p.x < L - 40 || p.x > R + 40 || p.y < T - 40 || p.y > B + 40) continue;
      const a = p.life / p.max;
      ctx.fillStyle = p.kind === 'blacksmoke' ? `rgba(40,36,34,${a * 0.55})` : p.kind === 'dust' ? `rgba(130,110,90,${a * 0.5})` : p.kind === 'steam' ? `rgba(245,245,245,${a * 0.5})` : `rgba(150,150,150,${a * 0.45})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2); ctx.fill();
    }

    // ---- night ----
    const nf = this.nightFactor(), dusk = this.duskFactor();
    if (nf > 0.01 || dusk > 0.01) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      const r = 255 - nf * 205, gg = 255 - nf * 185 - dusk * 40, bb = 255 - nf * 105 - dusk * 90;
      ctx.fillStyle = `rgb(${r | 0},${gg | 0},${bb | 0})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      ctx.restore();
    }
    if (nf > 0.05) {
      ctx.globalAlpha = Math.min(1, nf * 1.5) * objAlpha;
      for (const [s, x, y] of lit) ctx.drawImage(s.l, x + s.ax, y + s.ay, s.w, s.h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, nf * 1.3);
      const gl = glowSprite();
      for (const i of roadsVis) {
        const x = i % W, y = (i / W) | 0;
        if ((x + y * 2) % 3 !== 0) continue;
        const wx = (x - y) * 32, wy = (x + y) * 16 + 16;
        ctx.drawImage(gl.c, wx - 24, wy - 12, 48, 24);
      }
      ctx.fillStyle = 'rgba(255,240,180,0.9)';
      for (const c of agents.cars) {
        const [x, y] = agents.carWorldPos(c);
        if (x < L || x > R || y < T || y > B) continue;
        ctx.fillRect(x - 1, y - 2, 2, 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // ---- fire (bright, after night) ----
    for (const [b, wx, wy] of fires) this.drawFire(ctx, b, wx, wy);
    for (const p of agents.particles) {
      if (p.kind !== 'fire') continue;
      const a = p.life / p.max;
      ctx.fillStyle = `rgba(255,${(140 + a * 100) | 0},40,${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2); ctx.fill();
    }
    for (const m of agents.meteors) this.drawMeteor(ctx, m);

    // ---- tool preview ----
    this.drawPreview(ctx, w);
  }

  drawGroundTile(ctx, w, x, y, i, animate) {
    const wx = (x - y) * 32, wy = (x + y) * 16, t = w.terrain[i];
    let s;
    if (t === T_WATER) s = waterSprite(w.shoreMask(x, y), animate ? Math.floor(this.time * 1.2 + (w.gvar[i] & 7) * 0.37) % 3 : 0);
    else if (t === T_SAND) s = sandSprite(w.gvar[i] & 1);
    else s = grassSprite(w.gvar[i] & 3);
    ctx.drawImage(s.c, wx + s.ax, wy + s.ay, s.w, s.h);
    if (w.road[i]) {
      const r = roadSprite(w.roadMask(x, y), t === T_WATER);
      ctx.drawImage(r.c, wx + r.ax, wy + r.ay, r.w, r.h);
    } else if (w.zone[i] && w.bld[i] < 0) {
      const zs = zoneSprite(w.zone[i]);
      ctx.drawImage(zs.c, wx + zs.ax, wy + zs.ay, zs.w, zs.h);
    }
  }

  // Ground is cached in 8x8 tile chunks, redrawn only when the world marks them dirty.
  drawChunks(ctx, w, scale, L, R, T, B) {
    if (this.chunkWorld !== w) { this.chunkWorld = w; this.chunks = new Map(); }
    const cs = w.CS, n = w.cw;
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
      const x0 = cx * cs, y0 = cy * cs;
      const ox = (x0 - y0 - cs) * 32 - 4, oy = (x0 + y0) * 16 - 4;
      const cwid = cs * 64 + 8, chei = cs * 32 + 8;
      if (ox > R || ox + cwid < L || oy > B || oy + chei < T) continue;
      const key = (cy * n + cx) * 4 + (scale === 1 ? 0 : scale === 0.5 ? 1 : 2);
      const ver = w.chunkVer[cy * n + cx];
      let ch = this.chunks.get(key);
      if (!ch || ch.ver !== ver) {
        if (!ch) {
          const c = document.createElement('canvas');
          c.width = Math.ceil(cwid * scale); c.height = Math.ceil(chei * scale);
          ch = { c, ver: -1 };
        }
        const g = ch.c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, ch.c.width, ch.c.height);
        g.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
        for (let y = y0; y < Math.min(w.H, y0 + cs); y++) for (let x = x0; x < Math.min(w.W, x0 + cs); x++) this.drawGroundTile(g, w, x, y, y * w.W + x, false);
        ch.ver = ver;
      }
      this.chunks.delete(key);
      this.chunks.set(key, ch);
      ctx.drawImage(ch.c, ox, oy, cwid, chei);
    }
    while (this.chunks.size > 160) this.chunks.delete(this.chunks.keys().next().value);
  }

  drawSlab(ctx, w) {
    const W = w.W, H = w.H, dep = 18;
    const p = (x, y) => [(x - y) * 32, (x + y) * 16];
    const [ax, ay] = p(0, H), [bx, by] = p(W, H), [cx, cy] = p(W, 0);
    ctx.fillStyle = '#6b4f35';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx, by + dep); ctx.lineTo(ax, ay + dep); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4f3a28';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dep); ctx.lineTo(bx, by + dep); ctx.closePath(); ctx.fill();
  }

  drawBuilding(ctx, b, lit, fires, blink, dt) {
    const g = this.game, w = g.world, v = this.view;
    const wx = (b.x - b.y) * 32, wy = (b.x + b.y) * 16;
    const s = buildingSprite(b);
    if (wx + s.ax > v.R || wx + s.ax + s.w < v.L || wy + s.ay > v.B || wy + s.ay + s.h < v.T) return;
    ctx.drawImage(s.c, wx + s.ax, wy + s.ay, s.w, s.h);
    if (s.l && !b.abandoned && b.powered) lit.push([s, wx, wy]);
    const m = s.meta;
    const active = b.powered && !b.abandoned && !b.constructing && !b.onFire;
    if (m && m.blades) {
      const hx = wx + m.blades[0], hy = wy + m.blades[1];
      const a0 = (b.powered ? this.time * 2.5 : 0) + b.id;
      ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) { const a = a0 + k * 2.094; ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 17, hy + Math.sin(a) * 17); }
      ctx.stroke();
      ctx.fillStyle = '#ccc'; ctx.beginPath(); ctx.arc(hx, hy, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    if (m && m.smoke.length && active && this.game.speed > 0) {
      const kind = b.type === 'nuclear' ? 'steam' : 'smoke';
      const rate = kind === 'steam' ? 6 : 4;
      for (const [ox, oy] of m.smoke) if (Math.random() < dt * rate) g.agents.emit(wx + ox, wy + oy, kind);
    }
    if (b.onFire) fires.push([b, wx, wy]);
    if (b.type === 'rubble' || b.constructing) return;
    let icon = null;
    const needsPower = b.zoned ? !b.abandoned : (g.powerUse(b) > 0);
    if (needsPower && !b.powered) icon = 'power';
    else if (b.zoned && b.level >= 2 && !b.watered && !b.abandoned) icon = 'water';
    if (icon && blink) {
      const ic = iconSprite(icon);
      const cx = (b.x + b.w / 2 - (b.y + b.h / 2)) * 32, cy = (b.x + b.w / 2 + b.y + b.h / 2) * 16;
      ctx.drawImage(ic.c, cx - 7, cy - 34 - b.level * 8, 14, 14);
    }
  }

  drawFire(ctx, b, wx, wy) {
    const g = this.game;
    for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) {
      const cx = wx + (xx - yy) * 32, cy = wy + (xx + yy) * 16 + 16;
      const t = this.time * 8 + xx * 3 + yy * 5 + b.id;
      for (let k = 0; k < 3; k++) {
        const fx = cx + (k - 1) * 9 + Math.sin(t + k) * 2, fh = 16 + Math.sin(t * 1.3 + k * 2) * 6 + Math.min(b.onFire, 10);
        const grd = ctx.createLinearGradient(0, cy, 0, cy - fh);
        grd.addColorStop(0, 'rgba(255,90,20,0.95)'); grd.addColorStop(0.6, 'rgba(255,190,40,0.85)'); grd.addColorStop(1, 'rgba(255,250,180,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.moveTo(fx - 6, cy); ctx.quadraticCurveTo(fx - 4, cy - fh * 0.6, fx, cy - fh); ctx.quadraticCurveTo(fx + 4, cy - fh * 0.6, fx + 6, cy); ctx.closePath(); ctx.fill();
      }
      if (g.speed > 0 && Math.random() < 0.15) g.agents.emit(cx, cy - 20, 'blacksmoke');
      if (g.speed > 0 && Math.random() < 0.1) g.agents.emit(cx, cy - 6, 'fire');
    }
  }

  drawPole(ctx, w, x, y, i) {
    const off = w.road[i] ? 0.12 : 0.5;
    const pos = (xx, yy) => {
      const o = w.road[w.idx(xx, yy)] ? 0.12 : 0.5;
      return [(xx + o - (yy + o)) * 32, (xx + o + yy + o) * 16];
    };
    const [px, py] = [(x + off - (y + off)) * 32, (x + off + y + off) * 16];
    const top = 24;
    ctx.strokeStyle = '#5a4030'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - top); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px - 5, py - top + 3); ctx.lineTo(px + 5, py - top + 3); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,30,30,0.85)'; ctx.lineWidth = 0.6;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (!w.inb(xx, yy) || !w.pline[w.idx(xx, yy)]) continue;
      const [qx, qy] = pos(xx, yy);
      for (const side of [-4, 4]) {
        ctx.beginPath();
        ctx.moveTo(px + side, py - top + 3);
        ctx.quadraticCurveTo((px + qx) / 2 + side, (py + qy) / 2 - top + 8, qx + side, qy - top + 3);
        ctx.stroke();
      }
    }
  }

  drawTornado(ctx, t) {
    const wx = (t.x - t.y) * 32, wy = (t.x + t.y) * 16;
    for (let k = 0; k < 14; k++) {
      const h = k * 9, r = 5 + k * k * 0.35, off = Math.sin(t.spin * 0.3 + k * 0.5) * k * 1.2;
      ctx.fillStyle = `rgba(110,100,95,${0.5 - k * 0.025})`;
      ctx.beginPath(); ctx.ellipse(wx + off, wy - h, r, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(70,65,60,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(wx + off, wy - h, r * 0.8, r * 0.28, 0, t.spin + k, t.spin + k + 2); ctx.stroke();
    }
  }

  drawMeteor(ctx, m) {
    const k = m.t / m.dur, [x, y] = this.game.agents.meteorPos(m, k);
    const grd = ctx.createRadialGradient(x, y, 0, x, y, 24);
    grd.addColorStop(0, 'rgba(255,255,220,1)'); grd.addColorStop(0.3, 'rgba(255,160,40,0.9)'); grd.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.fill();
    // target marker
    const tx = (m.tx - m.ty) * 32, ty = (m.tx + m.ty) * 16 + 16;
    ctx.strokeStyle = `rgba(255,60,40,${0.5 + Math.sin(this.time * 20) * 0.3})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(tx, ty, 2.5 * 45, 2.5 * 22.6, 0, 0, Math.PI * 2); ctx.stroke();
  }

  diamond(ctx, x, y, fill, stroke, w, h) {
    w = w || 1; h = h || 1;
    const p = (u, v) => [(u - v) * 32, (u + v) * 16];
    const a = p(x, y), b = p(x + w, y), c = p(x + w, y + h), d = p(x, y + h);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5 / this.cam.zoom; ctx.stroke(); }
  }

  drawOverlay(ctx, w, ov, dMin, dMax, L, R) {
    const W = w.W, H = w.H;
    let get, color;
    const ramp = (t, a, b) => mixHex(a, b, clamp(t, 0, 1));
    switch (ov) {
      case 'power': get = i => (w.power[i] && (w.road[i] || w.pline[i] || w.zone[i] || w.bld[i] >= 0)) ? 1 : -1; color = () => 'rgba(255,220,40,0.55)'; break;
      case 'water': get = i => (w.water[i] && (w.road[i] || w.zone[i] || w.bld[i] >= 0)) ? 1 : -1; color = () => 'rgba(60,160,255,0.55)'; break;
      case 'landValue': get = i => w.terrain[i] === T_WATER ? -1 : w.landValue[i]; color = t => ramp(t, '#c0392b', '#2ecc71'); break;
      case 'pollution': get = i => w.pollution[i] > 2 ? w.pollution[i] / 70 : -1; color = t => ramp(t, '#d4c84a', '#5a3a1a'); break;
      case 'crime': get = i => (w.zone[i] && w.bld[i] >= 0) ? w.crime[i] : -1; color = t => ramp(t * 1.5, '#2ecc71', '#c0392b'); break;
      case 'traffic': get = i => w.road[i] ? w.traffic[i] : -1; color = t => t < 0.5 ? ramp(t * 2, '#2ecc71', '#f1c40f') : ramp((t - 0.5) * 1.5, '#f1c40f', '#c0392b'); break;
      default: get = i => w.cov[ov][i] > 0 ? w.cov[ov][i] : -1; color = t => ramp(t, '#7fb3ff', '#1040c0'); break;
    }
    ctx.globalAlpha = 0.6;
    for (let d = dMin; d <= dMax; d++) {
      const xa = Math.max(0, d - H + 1, Math.ceil(((L - 40) / 32 + d) / 2)), xb = Math.min(W - 1, d, Math.floor(((R + 40) / 32 + d) / 2));
      for (let x = xa; x <= xb; x++) {
        const y = d - x, i = y * W + x;
        const v = get(i);
        if (v < 0) {
          if ((ov === 'power' || ov === 'water') && w.bld[i] >= 0) this.diamond(ctx, x, y, 'rgba(230,40,40,0.6)');
          continue;
        }
        this.diamond(ctx, x, y, color(v));
      }
    }
    ctx.globalAlpha = 1;
  }

  drawPreview(ctx, w) {
    const pv = this.preview, h = this.hover;
    if (!h || !w.inb(h.x, h.y) && !pv) return;
    const g = this.game, tool = TOOLS[g.tool];
    if (pv && pv.tiles) {
      const col = tool.kind === 'bulldoze' || tool.kind === 'dezone' ? 'rgba(230,60,40,0.4)' : tool.kind === 'zone' ? ZONE_COLORS[tool.zone] : tool.kind === 'pline' ? 'rgba(255,220,60,0.5)' : tool.kind === 'tree' ? 'rgba(60,180,60,0.5)' : 'rgba(255,255,255,0.4)';
      ctx.globalAlpha = tool.kind === 'zone' ? 0.45 : 1;
      for (let k = 0; k < pv.tiles.length; k++) {
        const [x, y] = pv.tiles[k];
        if (!w.inb(x, y)) continue;
        this.diamond(ctx, x, y, pv.res.ok[k] ? col : 'rgba(255,40,40,0.35)');
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (!w.inb(h.x, h.y)) return;
    if (tool.kind === 'building') {
      const d = BUILDINGS[tool.building];
      const [x0, y0] = g.footprint(tool.building, h.x, h.y);
      const err = g.checkPlace(tool.building, x0, y0);
      const s = specialSprite(tool.building);
      ctx.globalAlpha = 0.65;
      ctx.drawImage(s.c, (x0 - y0) * 32 + s.ax, (x0 + y0) * 16 + s.ay, s.w, s.h);
      ctx.globalAlpha = 1;
      this.diamond(ctx, x0, y0, err ? 'rgba(255,40,40,0.35)' : 'rgba(80,255,120,0.25)', err ? '#ff5050' : '#80ff90', d.w, d.h);
      const r = d.radius || d.parkR || d.pollR;
      if (r) {
        const cx = x0 + d.w / 2, cy = y0 + d.h / 2;
        ctx.strokeStyle = d.radius ? 'rgba(120,200,255,0.9)' : d.park ? 'rgba(120,255,140,0.9)' : 'rgba(200,160,80,0.9)';
        ctx.lineWidth = 2 / this.cam.zoom; ctx.setLineDash([8 / this.cam.zoom, 6 / this.cam.zoom]);
        ctx.beginPath(); ctx.ellipse((cx - cy) * 32, (cx + cy) * 16, r * 45.25, r * 22.63, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      return;
    }
    const col = tool.kind === 'bulldoze' ? 'rgba(255,60,40,0.35)' : tool.kind === 'disaster' ? 'rgba(255,120,0,0.35)' : 'rgba(255,255,255,0.18)';
    this.diamond(ctx, h.x, h.y, col, 'rgba(255,255,255,0.9)');
  }
}
