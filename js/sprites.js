'use strict';
// Procedural sprite generation. Everything is drawn with canvas paths and cached.

const Sprites = {
  cache: new Map(),
  get(key, fn) {
    let s = this.cache.get(key);
    if (!s) {
      try { s = fn(); } catch (e) {
        console.error('sprite failed: ' + key, e);
        const c = document.createElement('canvas'); c.width = c.height = 1;
        s = { c, l: null, ax: 0, ay: 0, w: 1, h: 1, meta: { smoke: [], lights: [] } };
      }
      this.cache.set(key, s);
    }
    return s;
  },
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * SS));
  c.height = Math.max(1, Math.ceil(h * SS));
  const ctx = c.getContext('2d');
  ctx.scale(SS, SS);
  return { c, ctx };
}

const LIT_COLORS = ['#ffd77a', '#ffe7a3', '#fff1c2', '#ffcf6b', '#cfe6ff'];

// ---- drawing helper for isometric primitives ----
class G {
  constructor(ctx, lctx, ox, oy, rng) {
    this.ctx = ctx; this.lctx = lctx; this.ox = ox; this.oy = oy; this.rng = rng;
    this.meta = { smoke: [], lights: [] };
    this.litUsed = false;
  }
  P(u, v, z) { return [this.ox + (u - v) * 32, this.oy + (u + v) * 16 - (z || 0)]; }
  rel(u, v, z) { return [(u - v) * 32, (u + v) * 16 - (z || 0)]; }
  path(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  poly(pts, fill, stroke, lw) {
    const c = this.ctx;
    this.path(c, pts);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 0.5; c.stroke(); }
  }
  lpoly(pts, fill) {
    if (!this.lctx) return;
    this.litUsed = true;
    this.path(this.lctx, pts);
    this.lctx.fillStyle = fill;
    this.lctx.fill();
  }
  quad(u0, v0, u1, v1, z, fill, stroke) {
    this.poly([this.P(u0, v0, z), this.P(u1, v0, z), this.P(u1, v1, z), this.P(u0, v1, z)], fill, stroke);
  }
  lot(w, h, fill) { this.quad(-0.02, -0.02, w + 0.02, h + 0.02, 0, fill); }
  box(u0, v0, u1, v1, z0, hgt, color, noEdge) {
    const z1 = z0 + hgt, P = this.P.bind(this);
    const e = noEdge ? null : 'rgba(0,0,0,0.18)';
    this.poly([P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z1), P(u0, v1, z1)], shade(color, 0.9), e);
    this.poly([P(u1, v1, z0), P(u1, v0, z0), P(u1, v0, z1), P(u1, v1, z1)], shade(color, 0.7), e);
    this.poly([P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)], shade(color, 1.1), e);
  }
  // rectangle on the left visible face (plane v = v), u range, z range
  faceL(u0, u1, v, za, zb, fill) {
    const P = this.P.bind(this);
    const pts = [P(u0, v, za), P(u1, v, za), P(u1, v, zb), P(u0, v, zb)];
    this.poly(pts, fill);
    return pts;
  }
  faceR(v0, v1, u, za, zb, fill) {
    const P = this.P.bind(this);
    const pts = [P(u, v1, za), P(u, v0, za), P(u, v0, zb), P(u, v1, zb)];
    this.poly(pts, fill);
    return pts;
  }
  windows(u0, v0, u1, v1, z0, z1, o) {
    const fh = o.fh || 8, wh = o.wh || 0.5, ww = o.ww || 0.55, cw = o.cw || 0.16;
    const lit = o.lit === undefined ? 0.5 : o.lit;
    const floors = Math.max(1, Math.floor((z1 - z0) / fh));
    const nL = Math.max(1, Math.round((u1 - u0) / cw)), nR = Math.max(1, Math.round((v1 - v0) / cw));
    const cL = o.colorL || shade(o.color, 0.95), cR = o.colorR || shade(o.color, 0.75);
    const rng = this.rng;
    for (let f = 0; f < floors; f++) {
      const za = z0 + f * fh + fh * (1 - wh) * 0.55, zb = za + fh * wh;
      const sL = (u1 - u0) / nL;
      for (let i = 0; i < nL; i++) {
        const a = u0 + i * sL + sL * (1 - ww) / 2;
        const pts = this.faceL(a, a + sL * ww, v1, za, zb, cL);
        if (rng() < lit) this.lpoly(pts, pick(rng, LIT_COLORS));
      }
      const sR = (v1 - v0) / nR;
      for (let i = 0; i < nR; i++) {
        const a = v0 + i * sR + sR * (1 - ww) / 2;
        const pts = this.faceR(a, a + sR * ww, u1, za, zb, cR);
        if (rng() < lit) this.lpoly(pts, pick(rng, LIT_COLORS));
      }
    }
  }
  // band all around the visible faces (stripes, awnings)
  band(u0, v0, u1, v1, za, zb, color) {
    this.faceL(u0, u1, v1, za, zb, shade(color, 0.92));
    this.faceR(v0, v1, u1, za, zb, shade(color, 0.72));
  }
  gable(u0, v0, u1, v1, z, rh, color, axis) {
    const P = this.P.bind(this);
    const e = 'rgba(0,0,0,0.2)';
    if (axis === 'u') {
      const vm = (v0 + v1) / 2, R0 = P(u0, vm, z + rh), R1 = P(u1, vm, z + rh);
      this.poly([P(u0, v0, z), P(u1, v0, z), R1, R0], shade(color, 0.8), e);
      this.poly([P(u1, v0, z), P(u1, v1, z), R1], shade(color, 0.62), e);
      this.poly([P(u0, v1, z), P(u1, v1, z), R1, R0], shade(color, 1.05), e);
    } else {
      const um = (u0 + u1) / 2, R0 = P(um, v0, z + rh), R1 = P(um, v1, z + rh);
      this.poly([P(u0, v0, z), P(u0, v1, z), R1, R0], shade(color, 1.0), e);
      this.poly([P(u1, v0, z), P(u1, v1, z), R1, R0], shade(color, 0.7), e);
      this.poly([P(u0, v1, z), P(u1, v1, z), R1], shade(color, 0.88), e);
    }
  }
  ellipse(u, v, r, z, fill, stroke) {
    const [x, y] = this.P(u, v, z), c = this.ctx;
    c.beginPath();
    c.ellipse(x, y, r * 45.25, r * 22.63, 0, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 0.6; c.stroke(); }
  }
  cyl(u, v, r, z0, hgt, color, stripes) {
    const c = this.ctx, [x, y0] = this.P(u, v, z0), y1 = y0 - hgt;
    const rx = r * 45.25, ry = r * 22.63;
    const grd = c.createLinearGradient(x - rx, 0, x + rx, 0);
    grd.addColorStop(0, shade(color, 1.0));
    grd.addColorStop(0.45, shade(color, 0.92));
    grd.addColorStop(1, shade(color, 0.62));
    c.beginPath();
    c.ellipse(x, y0, rx, ry, 0, 0, Math.PI);
    c.lineTo(x - rx, y1);
    c.ellipse(x, y1, rx, ry, 0, Math.PI, 0, true);
    c.closePath();
    c.fillStyle = grd; c.fill();
    if (stripes) {
      for (const [za, zb, col] of stripes) {
        const ya = y0 - za, yb = y0 - zb;
        const g2 = c.createLinearGradient(x - rx, 0, x + rx, 0);
        g2.addColorStop(0, shade(col, 1)); g2.addColorStop(1, shade(col, 0.65));
        c.beginPath();
        c.ellipse(x, ya, rx, ry, 0, 0, Math.PI);
        c.lineTo(x - rx, yb);
        c.ellipse(x, yb, rx, ry, 0, Math.PI, 0, true);
        c.closePath();
        c.fillStyle = g2; c.fill();
      }
    }
    c.beginPath();
    c.ellipse(x, y1, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = shade(color, 1.12); c.fill();
  }
  dome(u, v, r, z, hgt, color) {
    const c = this.ctx, [x, y] = this.P(u, v, z);
    const rx = r * 45.25;
    const grd = c.createRadialGradient(x - rx * 0.4, y - hgt * 0.7, 1, x, y - hgt * 0.3, rx * 1.2);
    grd.addColorStop(0, shade(color, 1.3)); grd.addColorStop(1, shade(color, 0.7));
    c.beginPath();
    c.ellipse(x, y, rx, r * 22.63, 0, 0, Math.PI);
    c.ellipse(x, y, rx, hgt, 0, Math.PI, 0);
    c.closePath();
    c.fillStyle = grd; c.fill();
  }
  tree(u, v, s, kind, col) {
    const [x, y] = this.P(u, v, 0);
    drawTree(this.ctx, x, y, s, kind, col);
  }
  smoke(u, v, z) { this.meta.smoke.push(this.rel(u, v, z)); }
  light(u, v, z, color) {
    this.meta.lights.push(this.rel(u, v, z));
    if (this.lctx) {
      this.litUsed = true;
      const [x, y] = this.P(u, v, z);
      this.lctx.fillStyle = color || '#ff4040';
      this.lctx.beginPath(); this.lctx.arc(x, y, 1.4, 0, Math.PI * 2); this.lctx.fill();
    }
  }
  line(a, b, color, w) {
    const c = this.ctx;
    c.strokeStyle = color; c.lineWidth = w || 1;
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
  }
}

function drawTree(ctx, x, y, s, kind, col) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(x + 2 * s, y + 0.5 * s, 6 * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(x - 0.9 * s, y - 7 * s, 1.8 * s, 7 * s);
  if (kind === 0) {
    // conifer
    const c = col || '#2f6b3a';
    for (let i = 0; i < 3; i++) {
      const by = y - 4 * s - i * 6 * s, w = (8 - i * 2) * s, ty = by - 10 * s;
      ctx.fillStyle = shade(c, 1.05 - i * 0.03);
      ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x, ty); ctx.lineTo(x, by + 1.5 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(c, 0.72);
      ctx.beginPath(); ctx.moveTo(x + w, by); ctx.lineTo(x, ty); ctx.lineTo(x, by + 1.5 * s); ctx.closePath(); ctx.fill();
    }
  } else {
    const c = col || '#4a8f3a';
    ctx.fillStyle = shade(c, 0.7);
    ctx.beginPath(); ctx.arc(x + 1 * s, y - 11 * s, 7 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x - 0.5 * s, y - 12 * s, 6.3 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(c, 1.25);
    ctx.beginPath(); ctx.arc(x - 2.5 * s, y - 14.5 * s, 3 * s, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- ground sprites (1x1 diamond, drawn at tile top corner) ----
const GROUND_PAD = 1;
function diamondPath(ctx, e) {
  const o = GROUND_PAD;
  ctx.beginPath();
  ctx.moveTo(o + 32, o - e);
  ctx.lineTo(o + 64 + e * 2, o + 16);
  ctx.lineTo(o + 32, o + 32 + e);
  ctx.lineTo(o - e * 2, o + 16);
  ctx.closePath();
}
function groundSprite(key, fn) {
  return Sprites.get(key, () => {
    const { c, ctx } = makeCanvas(TW + GROUND_PAD * 2, TH + GROUND_PAD * 2);
    fn(ctx);
    return { c, ax: -TW / 2 - GROUND_PAD, ay: -GROUND_PAD, w: TW + GROUND_PAD * 2, h: TH + GROUND_PAD * 2 };
  });
}
// edges for N(y-1), E(x+1), S(y+1), W(x-1) in tile-local coords
const EDGES = [
  [[32, 0], [64, 16]],
  [[64, 16], [32, 32]],
  [[32, 32], [0, 16]],
  [[0, 16], [32, 0]],
];
const GRASS_COLS = ['#5d9c3d', '#61a040', '#5a983b', '#64a344'];

function grassSprite(v) {
  return groundSprite('grass' + v, (ctx) => {
    diamondPath(ctx, 0.6);
    ctx.fillStyle = GRASS_COLS[v & 3];
    ctx.fill();
    ctx.save(); diamondPath(ctx, 0); ctx.clip();
    const rng = mulberry32(v * 977 + 13);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(30,70,20,0.18)' : 'rgba(190,230,120,0.14)';
      ctx.fillRect(GROUND_PAD + rng() * 64, GROUND_PAD + rng() * 32, 1.5, 1);
    }
    ctx.restore();
  });
}
function sandSprite(v) {
  return groundSprite('sand' + v, (ctx) => {
    diamondPath(ctx, 0.6);
    ctx.fillStyle = v & 1 ? '#d9c68e' : '#d4c088';
    ctx.fill();
    ctx.save(); diamondPath(ctx, 0); ctx.clip();
    const rng = mulberry32(v * 31 + 7);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = 'rgba(120,90,40,0.15)';
      ctx.fillRect(GROUND_PAD + rng() * 64, GROUND_PAD + rng() * 32, 1, 1);
    }
    ctx.restore();
  });
}
function waterSprite(mask, frame) {
  return groundSprite('water' + mask + '_' + frame, (ctx) => {
    diamondPath(ctx, 0.6);
    ctx.fillStyle = '#2e6fae';
    ctx.fill();
    ctx.save(); diamondPath(ctx, 0); ctx.clip();
    const o = GROUND_PAD;
    const rng = mulberry32(frame * 101 + 5);
    ctx.strokeStyle = 'rgba(170,215,255,0.35)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const x = o + 8 + rng() * 44, y = o + 6 + rng() * 20;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5 + rng() * 4, y + 0.5); ctx.stroke();
    }
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      const [a, b] = EDGES[d];
      ctx.strokeStyle = '#d9c68e';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(o + a[0], o + a[1]); ctx.lineTo(o + b[0], o + b[1]); ctx.stroke();
      ctx.strokeStyle = 'rgba(220,240,255,0.7)';
      ctx.lineWidth = 9;
      ctx.setLineDash([2 + frame, 3]);
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(o + a[0], o + a[1]); ctx.lineTo(o + b[0], o + b[1]); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    ctx.restore();
  });
}
function waterShimmer(frame) {
  return groundSprite('shimmer' + frame, (ctx) => {
    ctx.save(); diamondPath(ctx, 0); ctx.clip();
    const o = GROUND_PAD, rng = mulberry32(frame * 211 + 9);
    ctx.strokeStyle = 'rgba(190,225,255,0.45)';
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 3; i++) {
      const x = o + 10 + rng() * 40, y = o + 7 + rng() * 18;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5 + rng() * 4, y + 0.5); ctx.stroke();
    }
    ctx.restore();
  });
}
function roadSprite(mask, bridge) {
  return groundSprite('road' + mask + (bridge ? 'b' : ''), (ctx) => {
    const o = GROUND_PAD;
    ctx.save();
    diamondPath(ctx, bridge ? 0 : 0.6);
    if (bridge) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.save(); ctx.translate(2, 3); ctx.fill(); ctx.restore(); diamondPath(ctx, 0); }
    ctx.fillStyle = bridge ? '#5c5d61' : '#4a4d53';
    ctx.fill();
    diamondPath(ctx, 0);
    ctx.clip();
    for (let d = 0; d < 4; d++) {
      if (mask & (1 << d)) continue;
      const [a, b] = EDGES[d];
      ctx.strokeStyle = bridge ? '#8b7355' : '#a3a39b';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(o + a[0], o + a[1]); ctx.lineTo(o + b[0], o + b[1]); ctx.stroke();
      ctx.strokeStyle = bridge ? '#d8d0bc' : 'rgba(0,0,0,0.25)';
      ctx.lineWidth = bridge ? 1.5 : 0.8;
      const cx = 32, cy = 16, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, k = 0.25;
      ctx.beginPath();
      ctx.moveTo(o + a[0] + (cx - mx) * k, o + a[1] + (cy - my) * k);
      ctx.lineTo(o + b[0] + (cx - mx) * k, o + b[1] + (cy - my) * k);
      ctx.stroke();
    }
    let n = 0;
    for (let d = 0; d < 4; d++) if (mask & (1 << d)) n++;
    if (n > 0 && n <= 2) {
      ctx.strokeStyle = '#e6cd57';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue;
        const [a, b] = EDGES[d];
        ctx.beginPath(); ctx.moveTo(o + 32, o + 16); ctx.lineTo(o + (a[0] + b[0]) / 2, o + (a[1] + b[1]) / 2); ctx.stroke();
      }
      ctx.setLineDash([]);
    } else if (n > 2) {
      ctx.strokeStyle = 'rgba(240,240,240,0.85)';
      ctx.lineWidth = 3.2;
      ctx.setLineDash([1.4, 1.6]);
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue;
        const [a, b] = EDGES[d];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, k = 0.3;
        const ax = a[0] + (32 - mx) * k, ay = a[1] + (16 - my) * k, bx = b[0] + (32 - mx) * k, by = b[1] + (16 - my) * k;
        ctx.beginPath();
        ctx.moveTo(o + lerp(ax, bx, 0.22), o + lerp(ay, by, 0.22));
        ctx.lineTo(o + lerp(ax, bx, 0.78), o + lerp(ay, by, 0.78));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
  });
}
function zoneSprite(z) {
  return groundSprite('zone' + z, (ctx) => {
    const o = GROUND_PAD, k = 0.8;
    ctx.save();
    ctx.translate(o + 32, o + 16); ctx.scale(k, k); ctx.translate(-o - 32, -o - 16);
    diamondPath(ctx, 0);
    ctx.globalAlpha = 0.22; ctx.fillStyle = ZONE_COLORS[z]; ctx.fill();
    ctx.globalAlpha = 0.95; ctx.strokeStyle = ZONE_COLORS[z]; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.stroke();
    ctx.restore();
  });
}
function treeSprite(d, v) {
  return Sprites.get('tree' + d + '_' + v, () => {
    const H = 50, { c, ctx } = makeCanvas(TW, TH + H);
    const rng = mulberry32(d * 1000 + v * 37 + 1);
    const pts = [];
    const n = d === 1 ? 1 + (rng() < 0.4 ? 1 : 0) : d === 2 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const u = 0.2 + rng() * 0.6, w = 0.2 + rng() * 0.6;
      pts.push([32 + (u - w) * 32, H + (u + w) * 16]);
    }
    pts.sort((a, b) => a[1] - b[1]);
    const autumn = v === 7 && d === 1;
    for (const [x, y] of pts) {
      const kind = rng() < 0.45 ? 0 : 1;
      const col = kind === 0 ? pick(rng, ['#2f6b3a', '#2a6034', '#346f3c']) : autumn && rng() < 0.5 ? pick(rng, ['#9a7a34', '#8a5a30', '#a08a3a']) : pick(rng, ['#3f8a3a', '#4b9739', '#57923a', '#3a7f40']);
      drawTree(ctx, x, y, 0.75 + rng() * 0.45, kind, col);
    }
    return { c, ax: -TW / 2, ay: -H, w: TW, h: TH + H };
  });
}

// ---- building sprites ----
function bsprite(key, w, h, maxH, fn, lights) {
  return Sprites.get(key, () => {
    const cw = (w + h) * TW / 2 + 4, ch = (w + h) * TH / 2 + maxH + 4;
    const A = makeCanvas(cw, ch);
    const L = lights !== false ? makeCanvas(cw, ch) : null;
    const ox = h * TW / 2 + 2, oy = maxH + 2;
    const g = new G(A.ctx, L ? L.ctx : null, ox, oy, mulberry32(strHash(key)));
    fn(g, g.rng);
    return { c: A.c, l: g.litUsed ? L.c : null, ax: -ox, ay: -oy, w: cw, h: ch, meta: g.meta };
  });
}

const WALLS_HOUSE = ['#e8dcc4', '#f2efe6', '#cfe0ea', '#ead1c4', '#efe3a8', '#d9c8b0', '#c9d9c0', '#e6cfe0'];
const ROOFS = ['#a4483a', '#5a5f6a', '#4c6a8a', '#7a5a3a', '#3f6a4a', '#8a3a3a', '#6a4a6a'];
const WALLS_APT = ['#b8644a', '#c9b08a', '#d8d0c0', '#9aa7b0', '#c48a6a', '#e0c9a0', '#a8a090'];
const WALLS_TOWER = ['#c9c2b5', '#a9b4bf', '#d6cbb8', '#8f9aa6', '#b49c84', '#e3ddd2', '#7d8a96'];
const GLASS = ['#5b8fb9', '#3f6f8f', '#7fb0c8', '#2f4f6f', '#4f7f7f', '#6a8fa8'];
const SHOP_WALLS = ['#e6d3b3', '#d4dce4', '#f0e6d0', '#c9b8a8', '#dfe7d6', '#e8c8c0'];
const AWNINGS = ['#d9453b', '#2f7fd6', '#2fa65a', '#e0a020', '#9b4fc0', '#e06aa0'];
const IND_WALLS = ['#a0a4a8', '#8a7a6a', '#b0a080', '#7a8a8a', '#9a6a50', '#a89a88'];

function drawR(g, rng, L, v) {
  if (L === 1) {
    g.lot(1, 1, '#67a548');
    const wall = WALLS_HOUSE[v % WALLS_HOUSE.length], roof = ROOFS[(v * 3 + 1) % ROOFS.length];
    if (rng() < 0.6) g.tree(0.15, 0.15, 0.6, rng() < 0.5 ? 0 : 1);
    if (v % 4 === 3) g.quad(0.2, 0.08, 0.5, 0.2, 0, '#5bb6e0', '#e8e8e8');
    g.quad(0.44, 0.75, 0.56, 1.0, 0, '#c9c0a8');
    const type = v % 3;
    if (type === 0) {
      g.box(0.22, 0.25, 0.78, 0.75, 0, 11, wall);
      g.windows(0.22, 0.25, 0.78, 0.75, 1, 10, { fh: 10, cw: 0.18, color: '#4a6a8a', lit: 0.6 });
      g.faceL(0.45, 0.55, 0.75, 0, 7, '#6a4a2a');
      g.gable(0.19, 0.22, 0.81, 0.78, 11, 9, roof, v & 4 ? 'u' : 'v');
    } else if (type === 1) {
      g.box(0.18, 0.2, 0.6, 0.78, 0, 11, wall);
      g.gable(0.15, 0.17, 0.63, 0.81, 11, 8, roof, 'v');
      g.box(0.6, 0.45, 0.85, 0.78, 0, 9, wall);
      g.windows(0.6, 0.45, 0.85, 0.78, 1, 8, { fh: 8, cw: 0.15, color: '#4a6a8a', lit: 0.6 });
      g.gable(0.58, 0.43, 0.88, 0.81, 9, 6, roof, 'u');
      g.faceL(0.3, 0.4, 0.78, 0, 7, '#6a4a2a');
    } else {
      g.box(0.2, 0.22, 0.8, 0.74, 0, 19, wall);
      g.windows(0.2, 0.22, 0.8, 0.74, 1, 19, { fh: 9, cw: 0.17, color: '#4a6a8a', lit: 0.55 });
      g.box(0.6, 0.3, 0.68, 0.38, 19, 9, '#8a5a4a');
      g.gable(0.17, 0.19, 0.83, 0.77, 19, 8, roof, v & 4 ? 'v' : 'u');
    }
    if (rng() < 0.5) g.tree(0.88, 0.88, 0.45, 1);
  } else if (L === 2) {
    g.lot(1, 1, '#7a9862');
    g.quad(0, 0.88, 1, 1, 0, '#b8b4a8');
    const col = WALLS_APT[v % WALLS_APT.length];
    const floors = 3 + (v % 3), h = floors * 9 + 2;
    if (v % 2 === 0) {
      g.box(0.12, 0.14, 0.88, 0.84, 0, h, col);
      g.windows(0.12, 0.14, 0.88, 0.84, 2, h - 1, { fh: 9, cw: 0.15, color: '#3a5068', lit: 0.5 });
      g.quad(0.16, 0.18, 0.84, 0.8, h + 0.1, shade(col, 0.85));
      g.box(0.5, 0.3, 0.68, 0.48, h, 6, shade(col, 0.95));
    } else {
      const h2 = h - 9;
      g.box(0.1, 0.12, 0.52, 0.86, 0, h, col);
      g.windows(0.1, 0.12, 0.52, 0.86, 2, h - 1, { fh: 9, cw: 0.15, color: '#3a5068', lit: 0.5 });
      g.box(0.52, 0.3, 0.9, 0.86, 0, h2, WALLS_APT[(v + 2) % WALLS_APT.length]);
      g.windows(0.52, 0.3, 0.9, 0.86, 2, h2 - 1, { fh: 9, cw: 0.15, color: '#3a5068', lit: 0.5 });
      g.box(0.6, 0.4, 0.7, 0.5, h2, 4, '#8a8a8a');
    }
    if (rng() < 0.6) g.tree(0.06, 0.94, 0.5, 1);
  } else {
    g.lot(1, 1, '#8e8d86');
    g.quad(0.02, 0.02, 0.3, 0.3, 0, '#6aa048');
    const col = WALLS_TOWER[v % WALLS_TOWER.length];
    const h = 64 + (v % 4) * 14 + Math.floor(rng() * 10);
    g.box(0.06, 0.06, 0.94, 0.94, 0, 8, shade(col, 0.9));
    g.faceL(0.15, 0.85, 0.94, 1, 6, '#6f8fa8');
    g.faceR(0.15, 0.85, 0.94, 1, 6, '#5a7a90');
    if (v % 2 === 0) {
      g.box(0.18, 0.18, 0.82, 0.82, 8, h - 8, col);
      g.windows(0.18, 0.18, 0.82, 0.82, 10, h - 2, { fh: 8, cw: 0.12, color: '#34495e', lit: 0.45 });
      g.box(0.35, 0.35, 0.6, 0.6, h, 7, '#9a9a9a');
      g.box(0.65, 0.25, 0.75, 0.35, h, 10, '#7a6a5a');
    } else {
      g.box(0.15, 0.15, 0.85, 0.85, 8, h * 0.6, col);
      g.windows(0.15, 0.15, 0.85, 0.85, 10, 8 + h * 0.6 - 2, { fh: 8, cw: 0.12, color: '#34495e', lit: 0.45 });
      g.box(0.25, 0.25, 0.75, 0.75, 8 + h * 0.6, h * 0.4, shade(col, 1.05));
      g.windows(0.25, 0.25, 0.75, 0.75, 8 + h * 0.6 + 1, 8 + h - 2, { fh: 8, cw: 0.12, color: '#34495e', lit: 0.45 });
      g.light(0.5, 0.5, 8 + h + 2);
    }
  }
}

function drawC(g, rng, L, v) {
  if (L === 1) {
    g.lot(1, 1, '#a3a39c');
    const wall = SHOP_WALLS[v % SHOP_WALLS.length], awn = AWNINGS[(v * 5 + 2) % AWNINGS.length];
    const h = 13 + (v % 2) * 8;
    g.box(0.12, 0.16, 0.88, 0.84, 0, h, wall);
    const P1 = g.faceL(0.18, 0.82, 0.84, 1.5, 8, '#8cc3e2');
    g.lpoly(P1, '#ffe7a3');
    const P2 = g.faceR(0.22, 0.78, 0.88, 1.5, 8, '#6aa0bf');
    g.lpoly(P2, '#ffd77a');
    if (h > 14) g.windows(0.12, 0.16, 0.88, 0.84, 12, h, { fh: 8, cw: 0.2, color: '#4a6a8a', lit: 0.5 });
    const P = g.P.bind(g);
    g.poly([P(0.12, 0.84, 10.5), P(0.88, 0.84, 10.5), P(0.88, 0.95, 8), P(0.12, 0.95, 8)], awn, 'rgba(0,0,0,0.2)');
    g.poly([P(0.88, 0.84, 10.5), P(0.88, 0.16, 10.5), P(0.99, 0.16, 8), P(0.99, 0.84, 8)], shade(awn, 0.75), 'rgba(0,0,0,0.2)');
    g.box(0.3, 0.7, 0.75, 0.78, h, 5, awn);
    if (rng() < 0.6) { g.box(0.6, 0.25, 0.75, 0.4, h, 3, '#bbbbbb'); }
  } else if (L === 2) {
    g.lot(1, 1, '#9c9c96');
    const glass = GLASS[v % GLASS.length], frame = pick(rng, ['#d8d8d8', '#b0b8c0', '#e8e2d6', '#6a7078', '#c8b8a0']);
    const floors = 4 + (v % 4), h = floors * 9 + 4;
    g.box(0.1, 0.1, 0.9, 0.9, 0, h, frame);
    g.windows(0.1, 0.1, 0.9, 0.9, 4, h - 2, { fh: 9, cw: 0.1, ww: 0.85, wh: 0.62, color: glass, lit: 0.55 });
    g.faceL(0.3, 0.7, 0.9, 0, 4, '#4a5a6a');
    g.box(0.2, 0.2, 0.4, 0.4, h, 4, '#aaaaaa');
    g.box(0.55, 0.5, 0.8, 0.7, h, 6, '#999999');
  } else {
    g.lot(1, 1, '#8e8e88');
    const glass = GLASS[(v + 1) % GLASS.length], stone = pick(rng, ['#c8c0b0', '#9aa0a8', '#d8d2c8', '#5a6068']);
    const h = 95 + (v % 5) * 14 + Math.floor(rng() * 12);
    g.box(0.06, 0.06, 0.94, 0.94, 0, 12, stone);
    g.faceL(0.15, 0.85, 0.94, 1, 9, '#7fa8c8');
    g.faceR(0.15, 0.85, 0.94, 1, 9, '#6a90b0');
    const h1 = Math.round(h * 0.62);
    g.box(0.14, 0.14, 0.86, 0.86, 12, h1, glass);
    g.windows(0.14, 0.14, 0.86, 0.86, 13, 12 + h1 - 1, { fh: 7, cw: 0.09, ww: 0.8, wh: 0.7, color: glass, colorL: shade(glass, 1.15), colorR: shade(glass, 0.85), lit: 0.5 });
    if (v % 2 === 0) {
      g.box(0.24, 0.24, 0.76, 0.76, 12 + h1, h - h1 - 12, glass);
      g.windows(0.24, 0.24, 0.76, 0.76, 12 + h1 + 1, h - 1, { fh: 7, cw: 0.09, ww: 0.8, wh: 0.7, color: glass, colorL: shade(glass, 1.15), colorR: shade(glass, 0.85), lit: 0.5 });
      g.box(0.4, 0.4, 0.6, 0.6, h, 8, stone);
      g.line(g.P(0.5, 0.5, h + 8), g.P(0.5, 0.5, h + 26), '#cccccc', 1);
      g.light(0.5, 0.5, h + 26);
    } else {
      g.box(0.2, 0.2, 0.8, 0.8, 12 + h1, h - h1 - 12, glass);
      g.windows(0.2, 0.2, 0.8, 0.8, 12 + h1 + 1, h - 1, { fh: 7, cw: 0.09, ww: 0.8, wh: 0.7, color: glass, colorL: shade(glass, 1.15), colorR: shade(glass, 0.85), lit: 0.5 });
      const P = g.P.bind(g);
      g.poly([P(0.2, 0.8, h), P(0.8, 0.8, h), P(0.5, 0.5, h + 22)], shade(stone, 0.9));
      g.poly([P(0.8, 0.8, h), P(0.8, 0.2, h), P(0.5, 0.5, h + 22)], shade(stone, 0.7));
      g.light(0.5, 0.5, h + 23);
    }
  }
}

function drawI(g, rng, L, v) {
  const col = IND_WALLS[v % IND_WALLS.length];
  if (L === 1) {
    g.lot(1, 1, '#8f8a7e');
    g.box(0.1, 0.18, 0.9, 0.82, 0, 11, col);
    const P = g.P.bind(g);
    const teeth = 3, z = 11, rh = 6, roof = shade(col, 0.85);
    for (let i = 0; i < teeth; i++) {
      const a = 0.1 + i * 0.8 / teeth, b = a + 0.8 / teeth;
      g.poly([P(a, 0.18, z), P(b, 0.18, z + rh), P(b, 0.82, z + rh), P(a, 0.82, z)], roof, 'rgba(0,0,0,0.2)');
      g.poly([P(a, 0.82, z), P(b, 0.82, z), P(b, 0.82, z + rh)], shade(col, 0.9), 'rgba(0,0,0,0.2)');
      const gp = [P(b, 0.82, z), P(b, 0.18, z), P(b, 0.18, z + rh), P(b, 0.82, z + rh)];
      g.poly(gp, '#7aa0b8', 'rgba(0,0,0,0.2)');
      g.lpoly(gp, '#ffe0a0');
    }
    g.faceL(0.2, 0.4, 0.82, 0, 7, '#5a5a5a');
    g.faceL(0.5, 0.7, 0.82, 0, 7, '#5a5a5a');
    g.box(0.05, 0.88, 0.15, 0.98, 0, 4, '#a07a40');
    g.box(0.85, 0.88, 0.95, 0.98, 0, 4, '#5070a0');
  } else if (L === 2) {
    g.lot(1, 1, '#8a857a');
    g.cyl(0.22, 0.18, 0.07, 0, 46, '#b0a090', [[36, 40, '#c84030']]);
    g.smoke(0.22, 0.18, 47);
    g.box(0.08, 0.3, 0.68, 0.92, 0, 18, col);
    g.windows(0.08, 0.3, 0.68, 0.92, 3, 16, { fh: 13, cw: 0.15, color: '#6a8aa0', lit: 0.6, wh: 0.4 });
    g.cyl(0.8, 0.45, 0.11, 0, 16, '#c8c8c0');
    g.cyl(0.82, 0.8, 0.1, 0, 12, '#c0b8a0');
  } else {
    g.lot(1, 1, '#7d786e');
    g.cyl(0.18, 0.15, 0.08, 0, 58, '#a89888', [[48, 52, '#c84030']]);
    g.cyl(0.4, 0.12, 0.07, 0, 50, '#a89888', [[42, 45, '#c84030']]);
    g.smoke(0.18, 0.15, 59);
    g.smoke(0.4, 0.12, 51);
    g.box(0.05, 0.32, 0.62, 0.95, 0, 26, col);
    g.windows(0.05, 0.32, 0.62, 0.95, 4, 24, { fh: 10, cw: 0.12, color: '#6a8aa0', lit: 0.6, wh: 0.35 });
    g.box(0.1, 0.4, 0.3, 0.6, 26, 6, '#888');
    g.cyl(0.8, 0.3, 0.14, 0, 18, '#d0d0c8');
    g.dome(0.8, 0.3, 0.14, 18, 5, '#d0d0c8');
    g.cyl(0.8, 0.75, 0.14, 0, 22, '#c8c0a8');
    g.dome(0.8, 0.75, 0.14, 22, 5, '#c8c0a8');
  }
}

function zonedSprite(type, L, v, abandoned) {
  const key = type + L + '_' + v + (abandoned ? 'a' : '');
  if (abandoned) {
    return Sprites.get(key, () => {
      const base = zonedSprite(type, L, v, false);
      const c = document.createElement('canvas');
      c.width = base.c.width; c.height = base.c.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(base.c, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * 0.62;
        d[i] = lerp(d[i] * 0.55, l, 0.75) + 8; d[i + 1] = lerp(d[i + 1] * 0.55, l, 0.75) + 4; d[i + 2] = lerp(d[i + 2] * 0.55, l, 0.75);
      }
      ctx.putImageData(img, 0, 0);
      return { c, l: null, ax: base.ax, ay: base.ay, w: base.w, h: base.h, meta: { smoke: [], lights: [] } };
    });
  }
  const maxH = { R: [0, 40, 70, 150], C: [0, 40, 85, 200], I: [0, 30, 60, 75] }[type][L];
  return bsprite(key, 1, 1, maxH, (g, rng) => {
    if (type === 'R') drawR(g, rng, L, v);
    else if (type === 'C') drawC(g, rng, L, v);
    else drawI(g, rng, L, v);
  });
}

function constructionSprite(L) {
  return bsprite('cons' + L, 1, 1, 80, (g) => {
    g.lot(1, 1, '#9d7f5c');
    const h = [0, 10, 26, 52][L];
    const P = g.P.bind(g);
    g.box(0.15, 0.15, 0.85, 0.85, 0, 2.5, '#b8b2a6');
    if (L > 1) g.box(0.18, 0.18, 0.82, 0.82, 2.5, h * 0.55, '#a8a49c');
    const sc = '#c8913f';
    for (const [u, v] of [[0.15, 0.85], [0.85, 0.85], [0.85, 0.15]]) g.line(P(u, v, 0), P(u, v, h), sc, 0.8);
    for (let z = 6; z <= h; z += 7) {
      g.line(P(0.15, 0.85, z), P(0.85, 0.85, z), sc, 0.7);
      g.line(P(0.85, 0.85, z), P(0.85, 0.15, z), sc, 0.7);
    }
    if (L > 1) {
      const top = h + 18;
      g.line(P(0.9, 0.1, 0), P(0.9, 0.1, top), '#e6b422', 1.6);
      g.line(P(0.9, 0.1, top), P(0.2, 0.1, top), '#e6b422', 1.2);
      g.line(P(0.9, 0.1, top), P(1.05, 0.1, top), '#e6b422', 1.2);
      g.line(P(0.4, 0.1, top), P(0.4, 0.1, top - 12), '#444', 0.5);
      g.light(0.9, 0.1, top + 1);
    }
    g.box(0.05, 0.9, 0.2, 0.98, 0, 3, '#c07a30');
  });
}

function rubbleSprite(v) {
  return bsprite('rubble' + (v & 3), 1, 1, 14, (g, rng) => {
    g.lot(1, 1, '#7c6c5a');
    for (let i = 0; i < 9; i++) {
      const u = 0.12 + rng() * 0.66, w = 0.12 + rng() * 0.66, s = 0.06 + rng() * 0.1;
      g.box(u, w, u + s, w + s, 0, 1 + rng() * 5, pick(rng, ['#8a8580', '#9a8a78', '#6a6560', '#a09080']));
    }
  }, false);
}

// Special buildings
const SPECIAL_DRAW = {
  wind(g) {
    g.lot(1, 1, '#64a344');
    const P = g.P.bind(g);
    const [bx, by] = P(0.5, 0.5, 0), top = 54;
    g.box(0.38, 0.38, 0.62, 0.62, 0, 2, '#b0b0a8');
    g.poly([[bx - 2.2, by], [bx + 2.2, by], [bx + 1, by - top], [bx - 1, by - top]], '#ececec', 'rgba(0,0,0,0.25)');
    g.box(0.45, 0.42, 0.58, 0.55, top - 2, 4, '#e0e0e0');
    g.meta.blades = [bx - g.ox, by - top - g.oy];
    g.light(0.52, 0.48, top + 3);
  },
  coal(g) {
    g.lot(2, 2, '#6e6a62');
    g.cyl(0.45, 0.35, 0.13, 0, 78, '#d8d4cc', [[60, 66, '#c03a2a'], [70, 76, '#c03a2a']]);
    g.cyl(0.95, 0.25, 0.12, 0, 70, '#d8d4cc', [[54, 60, '#c03a2a'], [63, 68, '#c03a2a']]);
    g.smoke(0.45, 0.35, 79); g.smoke(0.95, 0.25, 71);
    g.ellipse(1.6, 0.45, 0.32, 0, '#2a2826');
    g.dome(1.6, 0.45, 0.32, 0, 8, '#33302c');
    g.box(0.15, 0.85, 1.3, 1.85, 0, 22, '#8e8a84');
    g.windows(0.15, 0.85, 1.3, 1.85, 4, 20, { fh: 9, cw: 0.2, color: '#6a7a88', lit: 0.6, wh: 0.4 });
    g.box(1.35, 0.9, 1.85, 1.85, 0, 34, '#a39e96');
    g.box(1.45, 1.0, 1.75, 1.3, 34, 6, '#777');
  },
  solar(g) {
    g.lot(2, 2, '#7aa65a');
    const P = g.P.bind(g);
    for (let r = 0; r < 4; r++) {
      const v0 = 0.12 + r * 0.45, v1 = v0 + 0.32;
      g.poly([P(0.1, v1, 0), P(1.9, v1, 0), P(1.9, v1, 2), P(0.1, v1, 2)], '#555');
      const pts = [P(0.1, v0, 8), P(1.9, v0, 8), P(1.9, v1, 2), P(0.1, v1, 2)];
      g.poly(pts, '#2a4f86', '#8fb0d8', 0.4);
      for (let k = 1; k < 6; k++) { const u = 0.1 + k * 0.3; g.line(P(u, v0, 8), P(u, v1, 2), 'rgba(160,200,240,0.5)', 0.4); }
    }
    g.box(1.75, 1.8, 1.95, 1.97, 0, 6, '#ccc');
  },
  nuclear(g) {
    g.lot(3, 3, '#8c8a82');
    const tower = (u, v) => {
      const c = g.ctx, [x, y] = g.P(u, v, 0), h = 62;
      const rb = 0.6 * 45.25, rw = 0.4 * 45.25, rt = 0.45 * 45.25;
      const grd = c.createLinearGradient(x - rb, 0, x + rb, 0);
      grd.addColorStop(0, '#e8e6e0'); grd.addColorStop(0.5, '#d0cec8'); grd.addColorStop(1, '#9a9890');
      c.beginPath();
      c.ellipse(x, y, rb, rb / 2, 0, 0, Math.PI);
      c.quadraticCurveTo(x + rw * 0.9, y - h * 0.65, x + rt, y - h);
      c.lineTo(x - rt, y - h);
      c.quadraticCurveTo(x - rw * 0.9, y - h * 0.65, x - rb, y);
      c.closePath(); c.fillStyle = grd; c.fill();
      c.beginPath(); c.ellipse(x, y - h, rt, rt / 2, 0, 0, Math.PI * 2); c.fillStyle = '#6a6862'; c.fill();
      c.beginPath(); c.ellipse(x, y - h + 1.5, rt * 0.8, rt / 2 * 0.7, 0, 0, Math.PI * 2); c.fillStyle = '#3a3936'; c.fill();
      g.smoke(u, v, h + 2);
    };
    tower(0.75, 0.75);
    tower(2.05, 0.6);
    g.box(0.3, 1.8, 1.6, 2.8, 0, 20, '#b8b4ac');
    g.windows(0.3, 1.8, 1.6, 2.8, 3, 18, { fh: 8, cw: 0.25, color: '#6a7a88', lit: 0.6, wh: 0.4 });
    g.cyl(2.2, 2.1, 0.5, 0, 26, '#d8d4cc');
    g.dome(2.2, 2.1, 0.5, 26, 16, '#d8d4cc');
    g.light(2.2, 2.1, 43, '#ff3030');
  },
  pump(g) {
    g.lot(1, 1, '#7d9a62');
    g.box(0.2, 0.3, 0.7, 0.8, 0, 10, '#9fb4c8');
    g.gable(0.18, 0.28, 0.72, 0.82, 10, 5, '#4a6a8a', 'u');
    g.cyl(0.82, 0.3, 0.1, 0, 14, '#5a8ac0');
    g.box(0.7, 0.55, 1.0, 0.62, 2, 2, '#888');
  },
  tower(g) {
    g.lot(1, 1, '#6aa048');
    const P = g.P.bind(g);
    for (const [u, v] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]) g.line(P(u, v, 0), P(0.5 + (u - 0.5) * 0.6, 0.5 + (v - 0.5) * 0.6, 28), '#8a8a8a', 1.2);
    g.line(P(0.5, 0.5, 0), P(0.5, 0.5, 28), '#8a8a8a', 1.6);
    g.cyl(0.5, 0.5, 0.3, 28, 14, '#cfe2f0');
    g.dome(0.5, 0.5, 0.3, 42, 6, '#9fb8cc');
    g.light(0.5, 0.5, 49);
  },
  police(g) {
    g.lot(2, 2, '#9a9a96');
    for (let i = 0; i < 4; i++) g.line(g.P(0.3 + i * 0.35, 1.5, 0.1), g.P(0.3 + i * 0.35, 1.95, 0.1), '#e8e8e8', 0.6);
    g.box(0.2, 0.15, 1.8, 1.35, 0, 20, '#dfe3ea');
    g.windows(0.2, 0.15, 1.8, 1.35, 2, 13, { fh: 6, cw: 0.22, color: '#3a5a80', lit: 0.7 });
    g.band(0.2, 0.15, 1.8, 1.35, 14, 17, '#2050b0');
    g.box(0.85, 0.6, 1.15, 0.9, 20, 5, '#ccc');
    g.light(1.0, 0.75, 26, '#4080ff');
    drawCarOnLot(g, 0.5, 1.7, '#ffffff', '#1a3a8a');
    drawCarOnLot(g, 1.2, 1.7, '#ffffff', '#1a3a8a');
  },
  fire(g) {
    g.lot(2, 2, '#9a9690');
    g.box(0.15, 0.15, 0.55, 0.55, 0, 36, '#a8402f');
    g.box(0.15, 0.15, 1.85, 1.3, 0, 20, '#b5463a');
    for (let i = 0; i < 3; i++) {
      const u = 0.3 + i * 0.5;
      const pts = g.faceL(u, u + 0.38, 1.3, 0, 12, '#e8e2d8');
      g.lpoly(pts, '#ffe7a3');
    }
    g.windows(0.15, 0.15, 1.85, 1.3, 13, 20, { fh: 7, cw: 0.25, color: '#3a4a5a', lit: 0.6 });
    g.box(1.2, 1.45, 1.75, 1.75, 0, 7, '#d82a20');
    g.light(1.5, 1.6, 8, '#ff3030');
  },
  clinic(g) {
    g.lot(2, 2, '#7aa65a');
    g.quad(0.1, 1.6, 1.9, 1.95, 0, '#b8b4ac');
    g.box(0.2, 0.2, 1.8, 1.5, 0, 16, '#f2f2f2');
    g.windows(0.2, 0.2, 1.8, 1.5, 2, 15, { fh: 7, cw: 0.2, color: '#5a8ab0', lit: 0.7 });
    const z = 16.1;
    g.quad(0.85, 0.55, 1.15, 1.15, z, '#e02828');
    g.quad(0.7, 0.7, 1.3, 1.0, z, '#e02828');
  },
  hospital(g) {
    g.lot(3, 3, '#a8a8a2');
    g.quad(0.05, 0.05, 0.9, 0.9, 0, '#6aa048');
    g.box(0.3, 0.3, 2.0, 1.5, 0, 44, '#f4f4f2');
    g.windows(0.3, 0.3, 2.0, 1.5, 3, 43, { fh: 7, cw: 0.18, color: '#5a8ab0', lit: 0.6 });
    g.ellipse(1.15, 0.9, 0.4, 44.1, '#5a5a5a');
    const P = g.P.bind(g), z = 44.2;
    g.quad(0.95, 0.75, 1.03, 1.05, z, '#fff'); g.quad(1.27, 0.75, 1.35, 1.05, z, '#fff'); g.quad(1.03, 0.87, 1.27, 0.93, z, '#fff');
    g.box(0.3, 1.6, 2.7, 2.7, 0, 18, '#ececea');
    g.windows(0.3, 1.6, 2.7, 2.7, 2, 17, { fh: 8, cw: 0.2, color: '#5a8ab0', lit: 0.6 });
    g.quad(1.85, 1.95, 2.15, 2.35, 18.1, '#e02828');
    g.quad(1.75, 2.05, 2.25, 2.25, 18.1, '#e02828');
    g.light(1.15, 0.9, 46, '#ff3030');
  },
  school(g) {
    g.lot(2, 2, '#7aa65a');
    g.quad(0.15, 1.15, 1.85, 1.88, 0, '#5fa04a', '#f0f0f0');
    g.line(g.P(1.0, 1.15, 0.1), g.P(1.0, 1.88, 0.1), '#f0f0f0', 0.7);
    g.box(0.15, 0.12, 1.85, 1.0, 0, 18, '#c0704f');
    g.windows(0.15, 0.12, 1.85, 1.0, 2, 17, { fh: 8, cw: 0.2, color: '#3a5068', lit: 0.4 });
    g.gable(0.12, 0.09, 1.88, 1.03, 18, 8, '#5a5f6a', 'u');
    const P = g.P.bind(g);
    g.line(P(0.1, 1.95, 0), P(0.1, 1.95, 28), '#ddd', 0.8);
    g.poly([P(0.1, 1.95, 28), P(0.35, 1.95, 26), P(0.1, 1.95, 23)], '#d02828');
  },
  university(g) {
    g.lot(3, 3, '#6aa048');
    g.quad(1.3, 1.6, 1.7, 3, 0, '#d8cfbf');
    g.quad(0.2, 2.2, 2.8, 2.5, 0, '#d8cfbf');
    g.tree(0.4, 2.7, 0.8, 1); g.tree(2.6, 1.8, 0.8, 1);
    g.box(0.15, 0.2, 0.75, 1.9, 0, 20, '#d8ccb0');
    g.windows(0.15, 0.2, 0.75, 1.9, 2, 19, { fh: 9, cw: 0.2, color: '#3a5068', lit: 0.5 });
    g.box(2.25, 0.2, 2.85, 1.9, 0, 20, '#d8ccb0');
    g.windows(2.25, 0.2, 2.85, 1.9, 2, 19, { fh: 9, cw: 0.2, color: '#3a5068', lit: 0.5 });
    g.box(0.8, 0.3, 2.2, 1.5, 0, 26, '#ece4d0');
    for (let i = 0; i < 7; i++) { const u = 0.88 + i * 0.2; g.faceL(u, u + 0.07, 1.5, 0, 22, '#fffaf0'); }
    g.faceL(0.8, 2.2, 1.5, 22, 26, '#d8d0bc');
    g.cyl(1.5, 0.9, 0.38, 26, 8, '#ece4d0');
    g.dome(1.5, 0.9, 0.38, 34, 16, '#5a9a8a');
    g.light(1.5, 0.9, 51, '#ffe7a3');
    g.tree(2.0, 2.8, 0.7, 0);
  },
  landfill(g, rng) {
    g.lot(3, 3, '#8a7a5a');
    for (let i = 0; i < 7; i++) {
      const u = 0.5 + rng() * 2, v = 0.5 + rng() * 2, r = 0.25 + rng() * 0.3;
      g.ellipse(u, v, r, 0, '#6a5a40');
      g.dome(u, v, r, 0, 6 + rng() * 6, pick(rng, ['#7a6a50', '#6a6450', '#806a48']));
    }
    for (let i = 0; i < 60; i++) {
      const [x, y] = g.P(0.3 + rng() * 2.4, 0.3 + rng() * 2.4, rng() * 6);
      g.ctx.fillStyle = pick(rng, ['#c84a3a', '#3a7ac8', '#e8e8e0', '#e8c83a', '#4aa04a']);
      g.ctx.fillRect(x, y, 1.2, 1.2);
    }
    g.box(2.3, 2.4, 2.6, 2.6, 0, 5, '#e6b422');
  },
  incinerator(g) {
    g.lot(2, 2, '#7d786e');
    g.cyl(0.5, 0.4, 0.15, 0, 62, '#9a948c', [[50, 55, '#c84030']]);
    g.smoke(0.5, 0.4, 63);
    g.box(0.25, 0.8, 1.8, 1.8, 0, 24, '#8e8880');
    g.windows(0.25, 0.8, 1.8, 1.8, 3, 22, { fh: 10, cw: 0.25, color: '#e08a3a', lit: 0.8, wh: 0.35 });
    g.box(1.2, 0.2, 1.8, 0.75, 0, 14, '#a09a90');
  },
  park(g, rng) {
    g.lot(1, 1, '#5aac46');
    g.quad(0.45, 0, 0.55, 1, 0, '#d8cfaf');
    g.quad(0, 0.45, 1, 0.55, 0, '#d8cfaf');
    g.tree(0.22, 0.22, 0.8, 1, '#3f8a3a');
    g.tree(0.78, 0.25, 0.7, 0);
    g.box(0.15, 0.7, 0.32, 0.76, 0, 2, '#8a5a2a');
    g.tree(0.78, 0.78, 0.75, 1, '#4b9739');
  },
  plaza(g) {
    g.lot(1, 1, '#d8cfbf');
    for (let i = 1; i < 5; i++) { g.line(g.P(i * 0.2, 0, 0), g.P(i * 0.2, 1, 0), 'rgba(0,0,0,0.08)', 0.5); g.line(g.P(0, i * 0.2, 0), g.P(1, i * 0.2, 0), 'rgba(0,0,0,0.08)', 0.5); }
    g.tree(0.12, 0.12, 0.55, 1);
    g.cyl(0.5, 0.5, 0.28, 0, 3, '#bcb4a4');
    g.ellipse(0.5, 0.5, 0.23, 3.1, '#5bb0e0');
    g.cyl(0.5, 0.5, 0.05, 3, 7, '#ddd');
    g.ellipse(0.5, 0.5, 0.1, 10, 'rgba(200,235,255,0.8)');
    g.tree(0.88, 0.88, 0.55, 1);
    g.tree(0.12, 0.88, 0.5, 0);
  },
  bigpark(g, rng) {
    g.lot(2, 2, '#5aac46');
    g.quad(0, 0.9, 2, 1.05, 0, '#d8cfaf');
    g.quad(0.3, 0, 0.42, 2, 0, '#d8cfaf');
    g.ellipse(1.3, 0.45, 0.42, 0, '#3d8ac8', '#2a6a9a');
    for (let i = 0; i < 9; i++) {
      const u = rng() * 2, v = rng() * 2;
      if (Math.abs(v - 0.97) < 0.15 || Math.abs(u - 0.36) < 0.15 || Math.hypot(u - 1.3, v - 0.45) < 0.55) continue;
      g.tree(u, v, 0.7 + rng() * 0.3, rng() < 0.4 ? 0 : 1);
    }
    g.box(1.0, 1.3, 1.25, 1.36, 0, 2, '#8a5a2a');
    g.tree(1.7, 1.7, 0.9, 1);
  },
  cityhall(g) {
    g.lot(2, 2, '#d8cfbf');
    g.quad(0.05, 1.75, 1.95, 1.95, 0, '#6aa048');
    g.box(0.2, 0.25, 1.8, 1.55, 0, 22, '#ece6d8');
    g.windows(0.2, 0.25, 1.8, 1.55, 3, 20, { fh: 9, cw: 0.22, color: '#4a5a6a', lit: 0.6 });
    g.box(0.6, 1.55, 1.4, 1.75, 0, 18, '#f4efe2');
    for (let i = 0; i < 5; i++) { const u = 0.65 + i * 0.18; g.faceL(u, u + 0.06, 1.75, 0, 16, '#fffcf2'); }
    const P = g.P.bind(g);
    g.poly([P(0.6, 1.75, 18), P(1.4, 1.75, 18), P(1.0, 1.75, 26)], '#e4dccb', 'rgba(0,0,0,0.2)');
    g.cyl(1.0, 0.9, 0.35, 22, 9, '#ece6d8');
    g.dome(1.0, 0.9, 0.35, 31, 15, '#4a9a8a');
    g.line(P(1, 0.9, 46), P(1, 0.9, 58), '#ccc', 0.8);
    g.poly([P(1, 0.9, 58), P(1.25, 0.9, 56), P(1, 0.9, 53)], '#2a6ad0');
    g.light(1, 0.9, 46, '#ffe7a3');
  },
  stadium(g) {
    g.lot(3, 3, '#9a9a94');
    const c = g.ctx, [x, y] = g.P(1.5, 1.5, 0);
    g.cyl(1.5, 1.5, 1.32, 0, 18, '#c8c8c4');
    c.beginPath(); c.ellipse(x, y - 18, 1.12 * 45.25, 1.12 * 22.63, 0, 0, Math.PI * 2); c.fillStyle = '#6a6e78'; c.fill();
    for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(x, y - 18 + i * 2.5, (1.05 - i * 0.12) * 45.25, (1.05 - i * 0.12) * 22.63, 0, 0, Math.PI * 2); c.strokeStyle = i % 2 ? '#c84040' : '#4060c0'; c.lineWidth = 1.5; c.stroke(); }
    c.beginPath(); c.ellipse(x, y - 9, 0.7 * 45.25, 0.7 * 22.63, 0, 0, Math.PI * 2); c.fillStyle = '#3c9a3c'; c.fill();
    c.strokeStyle = '#e8ffe8'; c.lineWidth = 0.7;
    c.beginPath(); c.ellipse(x, y - 9, 0.2 * 45.25, 0.2 * 22.63, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(x - 0.5 * 32, y - 9 - 0.5 * 16); c.lineTo(x + 0.5 * 32, y - 9 + 0.5 * 16); c.stroke();
    const P = g.P.bind(g);
    for (const [u, v] of [[0.2, 0.2], [2.8, 0.2], [2.8, 2.8], [0.2, 2.8]]) {
      g.line(P(u, v, 0), P(u, v, 40), '#888', 1.2);
      g.box(u - 0.08, v - 0.08, u + 0.08, v + 0.08, 40, 4, '#ddd');
      g.light(u, v, 42, '#ffffe0');
    }
  },
  airport(g) {
    g.lot(4, 4, '#6aa048');
    g.quad(0.15, 2.7, 3.85, 3.4, 0, '#45474c');
    for (let i = 0; i < 9; i++) { const u = 0.4 + i * 0.38; g.quad(u, 3.03, u + 0.2, 3.07, 0.05, '#f0f0f0'); }
    g.quad(0.15, 1.6, 3.85, 2.7, 0, '#8a8c90');
    g.quad(2.7, 0.2, 3.85, 1.6, 0, '#8a8c90');
    g.box(0.3, 0.3, 2.5, 1.4, 0, 14, '#dce0e4');
    g.windows(0.3, 0.3, 2.5, 1.4, 2, 13, { fh: 11, cw: 0.15, ww: 0.9, wh: 0.7, color: '#4f7fa8', lit: 0.8 });
    g.gable(0.25, 0.25, 2.55, 1.45, 14, 5, '#b8c0c8', 'u');
    g.cyl(3.3, 0.6, 0.14, 0, 40, '#e0e0e0');
    g.cyl(3.3, 0.6, 0.26, 40, 8, '#4f7fa8');
    g.dome(3.3, 0.6, 0.26, 48, 3, '#888');
    g.light(3.3, 0.6, 52, '#ff3030');
    // plane
    const P = g.P.bind(g), z = 4;
    g.poly([P(1.0, 2.1, z), P(2.4, 2.1, z), P(2.5, 2.15, z), P(2.4, 2.2, z), P(1.0, 2.2, z)], '#f4f4f4', '#999');
    g.poly([P(1.6, 1.65, z), P(1.85, 2.12, z), P(1.85, 2.18, z), P(1.6, 2.65, z), P(1.5, 2.65, z), P(1.65, 2.18, z), P(1.65, 2.12, z), P(1.5, 1.65, z)], '#e0e4ea', '#999');
    g.poly([P(1.0, 2.15, z), P(1.08, 2.15, z + 9), P(1.18, 2.15, z + 9), P(1.15, 2.15, z)], '#2a5ab0');
  },
  monument(g) {
    g.lot(2, 2, '#d8cfbf');
    g.quad(0.1, 0.1, 0.5, 0.5, 0, '#6aa048'); g.quad(1.5, 1.5, 1.9, 1.9, 0, '#6aa048');
    g.box(0.55, 0.55, 1.45, 1.45, 0, 18, '#c8ccd2');
    g.windows(0.55, 0.55, 1.45, 1.45, 3, 16, { fh: 7, cw: 0.15, color: '#4f7fa8', lit: 0.8 });
    const c = g.ctx, [x, y] = g.P(1, 1, 18);
    const grd = c.createLinearGradient(x - 10, 0, x + 10, 0);
    grd.addColorStop(0, '#f0f2f4'); grd.addColorStop(1, '#9aa0a8');
    c.beginPath(); c.moveTo(x - 9, y); c.lineTo(x + 9, y); c.lineTo(x + 3, y - 150); c.lineTo(x - 3, y - 150); c.closePath(); c.fillStyle = grd; c.fill();
    g.cyl(1, 1, 0.32, 130, 12, '#7fb0d0');
    g.cyl(1, 1, 0.22, 142, 6, '#d8dce0');
    g.line(g.P(1, 1, 148), g.P(1, 1, 192), '#ccc', 1.2);
    g.light(1, 1, 192, '#ff3030');
    for (let i = 0; i < 6; i++) g.light(1 + Math.cos(i) * 0.28, 1 + Math.sin(i) * 0.28, 136, '#fff3c4');
  },
};
const SPECIAL_MAXH = { wind: 70, coal: 90, solar: 20, nuclear: 75, pump: 25, tower: 55, police: 35, fire: 45, clinic: 25, hospital: 55, school: 35, university: 60, landfill: 20, incinerator: 75, park: 30, plaza: 25, bigpark: 30, cityhall: 65, stadium: 50, airport: 60, monument: 200 };

function drawCarOnLot(g, u, v, body, roof) {
  g.box(u - 0.14, v - 0.07, u + 0.14, v + 0.07, 0, 3.5, body);
  g.box(u - 0.06, v - 0.06, u + 0.08, v + 0.06, 3.5, 2.5, roof);
}

function specialSprite(type) {
  const d = BUILDINGS[type];
  return bsprite('sp_' + type, d.w, d.h, SPECIAL_MAXH[type] || 60, (g, rng) => SPECIAL_DRAW[type](g, rng));
}

function buildingSprite(b) {
  if (b.type === 'rubble') return rubbleSprite(b.variant);
  if (b.zoned) {
    if (b.constructing > 0) return constructionSprite(b.level);
    return zonedSprite(b.type, b.level, b.variant % 6, b.abandoned);
  }
  return specialSprite(b.type);
}

// ---- small sprites ----
const CAR_COLORS = ['#d23c3c', '#3c6ed2', '#e8e8e8', '#2a2a2a', '#e8c43c', '#3ca050', '#8a8a92', '#e07a2a', '#7a3ca0'];
function carSprite(ci, axis) {
  return Sprites.get('car' + ci + axis, () => {
    const { c, ctx } = makeCanvas(30, 24);
    const g = new G(ctx, null, 15, 15, mulberry32(ci));
    const col = CAR_COLORS[ci % CAR_COLORS.length];
    if (axis === 0) { g.box(-0.13, -0.055, 0.13, 0.055, 0, 3.2, col); g.box(-0.05, -0.05, 0.07, 0.05, 3.2, 2.2, '#3a4a5a'); }
    else { g.box(-0.055, -0.13, 0.055, 0.13, 0, 3.2, col); g.box(-0.05, -0.05, 0.05, 0.07, 3.2, 2.2, '#3a4a5a'); }
    return { c, ax: -15, ay: -15, w: 30, h: 24 };
  });
}
function iconSprite(kind) {
  return Sprites.get('icon_' + kind, () => {
    const { c, ctx } = makeCanvas(18, 18);
    ctx.fillStyle = kind === 'power' ? '#d93030' : kind === 'water' ? '#2a7ad0' : '#8a5a2a';
    ctx.beginPath(); ctx.arc(9, 9, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = kind === 'power' ? '#ffe040' : '#fff';
    ctx.beginPath();
    if (kind === 'power') { ctx.moveTo(10, 3); ctx.lineTo(5, 10); ctx.lineTo(8.5, 10); ctx.lineTo(7.5, 15); ctx.lineTo(13, 8); ctx.lineTo(9.5, 8); ctx.closePath(); }
    else if (kind === 'water') { ctx.moveTo(9, 3.5); ctx.quadraticCurveTo(14, 10, 12.5, 12); ctx.arc(9, 11.5, 3.6, 0.2, Math.PI - 0.2); ctx.quadraticCurveTo(4, 10, 9, 3.5); }
    else { ctx.rect(5, 6, 8, 7); }
    ctx.fill();
    return { c, w: 18, h: 18 };
  });
}
function glowSprite() {
  return Sprites.get('glow', () => {
    const { c, ctx } = makeCanvas(48, 24);
    const g = ctx.createRadialGradient(24, 12, 0, 24, 12, 22);
    g.addColorStop(0, 'rgba(255,220,140,0.55)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.save(); ctx.scale(1, 0.5); ctx.translate(0, 12);
    ctx.fillStyle = g; ctx.fillRect(0, -12, 48, 48);
    ctx.restore();
    return { c, w: 48, h: 24 };
  });
}
