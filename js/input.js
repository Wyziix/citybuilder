'use strict';
// Mouse, touch and keyboard input.

class Input {
  constructor(game, renderer, ui) {
    this.g = game; this.r = renderer; this.ui = ui;
    this.keys = new Set();
    this.pointers = new Map();
    this.pan = null;
    this.drag = null;      // {x0,y0,x1,y1}
    this.pinch = null;
    this.mouse = { x: 0, y: 0 };
    const cv = renderer.cv;
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.r.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerleave', () => { if (!this.drag) { this.r.hover = null; this.ui.tooltip(null); } });
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  tileAt(e) { const [x, y] = this.r.screenToTile(e.clientX, e.clientY); return { x, y }; }

  down(e) {
    if (this.ui.modalOpen) return;
    this.r.cv.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // switch to pinch; cancel any tool drag
      this.drag = null; this.r.preview = null; this.ui.tooltip(null);
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.keys.has(' '))) {
      this.pan = { x: e.clientX, y: e.clientY, moved: 0 };
      return;
    }
    if (e.button !== 0) return;
    const t = this.tileAt(e), tool = TOOLS[this.g.tool];
    this.ui.closeSub();
    if (tool.drag === 'single') { this.click(t); return; }
    this.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y, last: null };
    if (tool.drag === 'paint') this.paint(t);
    else this.updatePreview();
  }

  move(e) {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.r.cam.x -= (cx - this.pinch.cx) / this.r.cam.zoom;
      this.r.cam.y -= (cy - this.pinch.cy) / this.r.cam.zoom;
      if (this.pinch.d > 10) this.r.zoomAt(cx, cy, d / this.pinch.d);
      this.pinch = { d, cx, cy };
      return;
    }
    if (this.pan) {
      const dx = e.clientX - this.pan.x, dy = e.clientY - this.pan.y;
      this.r.cam.x -= dx / this.r.cam.zoom; this.r.cam.y -= dy / this.r.cam.zoom;
      this.r.clampCam();
      this.pan.x = e.clientX; this.pan.y = e.clientY; this.pan.moved += Math.abs(dx) + Math.abs(dy);
      return;
    }
    const t = this.tileAt(e);
    this.r.hover = t;
    if (this.drag) {
      if (t.x !== this.drag.x1 || t.y !== this.drag.y1) {
        this.drag.x1 = t.x; this.drag.y1 = t.y;
        if (TOOLS[this.g.tool].drag === 'paint') this.paint(t);
        else this.updatePreview();
      }
    } else this.hoverTip(t);
  }

  up(e, cancel) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
    if (this.pan) { this.pan = null; return; }
    if (!this.drag) return;
    const tool = TOOLS[this.g.tool];
    if (!cancel && tool.drag !== 'paint') {
      const tiles = this.dragTiles();
      const res = this.g.useTool(this.g.tool, tiles, false);
      if (res.msg) this.ui.toast({ msg: res.msg, type: 'bad' });
    }
    this.drag = null;
    this.r.preview = null;
    this.ui.tooltip(null);
  }

  dragTiles() {
    const d = this.drag, tool = TOOLS[this.g.tool];
    return tool.drag === 'line' ? this.g.lineTiles(d.x0, d.y0, d.x1, d.y1) : this.g.rectTiles(d.x0, d.y0, d.x1, d.y1);
  }
  updatePreview() {
    const tiles = this.dragTiles();
    const res = this.g.useTool(this.g.tool, tiles, true);
    this.r.preview = { tiles, res };
    const tool = TOOLS[this.g.tool];
    let txt = `${tool.name}: ${res.count} tile${res.count === 1 ? '' : 's'}`;
    if (res.cost) txt += ` · <b style="color:${this.g.canAfford(res.cost) ? '#46d27a' : '#ff5d5d'}">${fmtMoney(res.cost)}</b>`;
    if (tool.drag === 'rect') txt += ` · ${Math.abs(this.drag.x1 - this.drag.x0) + 1}×${Math.abs(this.drag.y1 - this.drag.y0) + 1}`;
    this.ui.tooltip(txt, this.mouse.x, this.mouse.y);
  }
  paint(t) {
    const tool = TOOLS[this.g.tool];
    if (this.drag.last && this.drag.last.x === t.x && this.drag.last.y === t.y) return;
    this.drag.last = t;
    if (tool.kind === 'building') {
      const err = this.g.placeBuilding(tool.building, t.x, t.y);
      if (err && !this.drag.painted) this.ui.toast({ msg: err, type: 'bad' });
      if (!err) this.drag.painted = true;
    }
  }
  click(t) {
    const tool = TOOLS[this.g.tool], g = this.g;
    if (tool.kind === 'inspect') { this.ui.showInfo(t.x, t.y); return; }
    if (!g.world.inb(t.x, t.y)) return;
    if (tool.kind === 'building') {
      const err = g.placeBuilding(tool.building, t.x, t.y);
      if (err) this.ui.toast({ msg: err, type: 'bad' });
    } else if (tool.kind === 'disaster') {
      g.disaster(tool.disaster, t.x, t.y);
    }
  }
  hoverTip(t) {
    const tool = TOOLS[this.g.tool];
    if (tool.kind === 'building') {
      const d = BUILDINGS[tool.building];
      const [x0, y0] = this.g.footprint(tool.building, t.x, t.y);
      const err = this.g.checkPlace(tool.building, x0, y0);
      this.ui.tooltip(`${d.name} · <b style="color:${err ? '#ff5d5d' : '#46d27a'}">${fmtMoney(d.cost)}</b>${err ? `<br><span style="color:#ff9d9d">${err}</span>` : ''}`, this.mouse.x, this.mouse.y);
    } else this.ui.tooltip(null);
  }

  keydown(e) {
    const k = e.key.toLowerCase();
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); this.ui.quickSave(); return; }
    if (this.ui.modalOpen) { if (k === 'escape' && this.ui.modalClosable) this.ui.closeModal(); return; }
    this.keys.add(k);
    const map = { r: 'road', p: 'pline', b: 'bulldoze', t: 'tree', 1: 'zoneR', 2: 'zoneC', 3: 'zoneI' };
    if (k === 'escape') { this.drag = null; this.r.preview = null; this.ui.selectTool('inspect'); this.ui.closeSub(); this.ui.hideInfo(); this.ui.tooltip(null); }
    else if (k === ' ') { e.preventDefault(); this.ui.setSpeed(this.g.speed === 0 ? (this.lastSpeed || 1) : (this.lastSpeed = this.g.speed, 0)); }
    else if (map[k]) this.ui.selectTool(map[k]);
    else if (k === '+' || k === '=') this.r.zoomAt(this.r.cw / 2, this.r.ch / 2, 1.2);
    else if (k === '-' || k === '_') this.r.zoomAt(this.r.cw / 2, this.r.ch / 2, 1 / 1.2);
    else if (k === 'h' || k === '?') this.ui.showHelp();
  }

  update(dt) {
    let dx = 0, dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy--;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy++;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx--;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx++;
    if (dx || dy) {
      const sp = 700 * dt / this.r.cam.zoom;
      this.r.cam.x += dx * sp; this.r.cam.y += dy * sp;
      this.r.clampCam();
    }
  }
}
