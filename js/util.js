'use strict';
// Shared helpers: math, randomness, noise, colors, formatting.

const TW = 64;   // tile width in world pixels (zoom 1)
const TH = 32;   // tile height in world pixels
const SS = 2;    // sprite supersampling so zooming in stays sharp

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function strHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

class Noise2D {
  constructor(seed) { this.seed = seed | 0; }
  raw(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, this.seed), b = hash2(ix + 1, iy, this.seed);
    const c = hash2(ix, iy + 1, this.seed), d = hash2(ix + 1, iy + 1, this.seed);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }
  fbm(x, y, oct) {
    let v = 0, amp = 1, f = 1, tot = 0;
    for (let i = 0; i < oct; i++) { v += this.raw(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2.03; }
    return v / tot;
  }
}

// ---- colors ----
const _rgbCache = new Map();
function hexToRgb(hex) {
  let c = _rgbCache.get(hex);
  if (c) return c;
  if (hex.startsWith('rgb')) {
    c = hex.replace(/[^\d,.]/g, '').split(',').slice(0, 3).map(Number);
    _rgbCache.set(hex, c);
    return c;
  }
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  c = [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  if (c.some(isNaN)) c = [128, 128, 128];
  _rgbCache.set(hex, c);
  return c;
}
function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${clamp(Math.round(r * f), 0, 255)},${clamp(Math.round(g * f), 0, 255)},${clamp(Math.round(b * f), 0, 255)})`;
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// ---- formatting ----
function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }
function fmtMoney(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- typed array <-> base64 (for saves) ----
function bytesToB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
