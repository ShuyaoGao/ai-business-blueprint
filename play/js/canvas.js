/* 画布：SVG 显示、平移缩放（滚轮 / 双指）、拖方框（吸附网格 + 对齐参考线 + 拖进环节）、拉连线、导出 PNG。
 * 用 Pointer Events 统一鼠标、手指、触控笔。
 * host 由 app.js 提供：doc() readOnly() sel() select(sel) begin() changed() connect() setConnect(c)
 *                     snap() extra() onOpen(id) onEdge(edge) onToggle(id)
 */
(function (root) {
  'use strict';
  var C = root.ABB.Config, M = root.ABB.Model, R = root.ABB.Render;

  function Canvas(wrap, svg, host) {
    var self = this;
    this.wrap = wrap; this.svg = svg; this.host = host;
    this.view = { k: 1, tx: 0, ty: 0 };
    this.g = svg.querySelector('#world');
    this.ptrs = {}; this.act = null; this.hover = null; this.guides = null; this.temp = null; this.drop = null; this.topId = null;
    this.lastTap = { t: 0, id: null };
    var mctx = document.createElement('canvas').getContext('2d'), cache = {};
    this.measure = function (text, size, bold) {
      var key = (bold ? 'b' : '') + size + '|' + text;
      if (cache[key] == null) { mctx.font = (bold ? 'bold ' : '') + size + 'px ' + R.FONT; cache[key] = mctx.measureText(text).width; }
      return cache[key];
    };
    this.mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
    if (this.mq && this.mq.addEventListener) this.mq.addEventListener('change', function () { self.draw(); });

    svg.addEventListener('pointerdown', function (e) { self.down(e); });
    svg.addEventListener('pointermove', function (e) { self.move(e); });
    svg.addEventListener('pointerup', function (e) { self.up(e); });
    svg.addEventListener('pointercancel', function (e) { self.up(e, true); });
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !self.act && self.hover) { self.hover = null; self.draw(); } });
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = self.local(e.clientX, e.clientY);
      self.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });
    if (root.ResizeObserver) new ResizeObserver(function () { self.draw(); }).observe(wrap);
  }

  Canvas.prototype.pal = function () { return this.mq && this.mq.matches ? C.PALETTES.dark : C.PALETTES.light; };
  Canvas.prototype.local = function (cx, cy) { var r = this.svg.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; };
  Canvas.prototype.toWorld = function (cx, cy) { var p = this.local(cx, cy), v = this.view; return { x: (p.x - v.tx) / v.k, y: (p.y - v.ty) / v.k }; };
  Canvas.prototype.size = function () { var r = this.svg.getBoundingClientRect(); return { w: r.width || 1, h: r.height || 1 }; };
  Canvas.prototype.center = function () { var s = this.size(), v = this.view; return { x: (s.w / 2 - v.tx) / v.k, y: (s.h / 2 - v.ty) / v.k }; };

  Canvas.prototype.zoomAt = function (px, py, f) {
    var v = this.view, k = Math.max(0.15, Math.min(3, v.k * f)); f = k / v.k;
    v.tx = px - (px - v.tx) * f; v.ty = py - (py - v.ty) * f; v.k = k; this.draw();
  };
  Canvas.prototype.zoomBy = function (f) { var s = this.size(); this.zoomAt(s.w / 2, s.h / 2, f); };

  /** 让 rect（默认整张图）铺满画布。 */
  Canvas.prototype.fit = function (rect, maxK) {
    var b = rect || M.bounds(this.host.doc(), this.host.extra().visible || null);
    var s = this.size(), m = s.w < 500 ? 16 : 36;
    if (!b) { this.view = { k: 1, tx: s.w / 2 - 200, ty: 60 }; this.draw(); return; }
    var k = Math.min((s.w - 2 * m) / Math.max(b.w, 1), (s.h - 2 * m) / Math.max(b.h + 12, 1), maxK || 1.1);
    k = Math.max(0.15, k);
    this.view = { k: k, tx: (s.w - b.w * k) / 2 - b.x * k, ty: (s.h - b.h * k) / 2 - b.y * k + 6 * k };
    this.draw();
  };
  /** 把某个方框移到画布中间（不改缩放，太小时放大到 0.8）。 */
  Canvas.prototype.reveal = function (id) {
    var doc = this.host.doc(), n = M.get(doc, M.visibleId(doc, id)); if (!n) return;
    var r = M.rectOf(n), s = this.size(), v = this.view;
    if (v.k < 0.8) v.k = 0.8;
    v.tx = s.w / 2 - (r.x + r.w / 2) * v.k; v.ty = s.h / 2 - (r.y + r.h / 2) * v.k; this.draw();
  };

  Canvas.prototype.draw = function () {
    var self = this;
    if (this.raf) return;
    this.raf = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { self.raf = 0; self.drawNow(); });
  };
  Canvas.prototype.drawNow = function () {
    var h = this.host, doc = h.doc(), v = this.view, ex = h.extra() || {}, sel = h.sel(), ro = h.readOnly();
    var hid = null;
    if (!ro) { hid = this.hover; if (!hid && sel && sel.kind === 'node') hid = sel.id; if (this.act && this.act.type !== 'link') hid = null; }
    var con = h.connect();
    var o = { pal: this.pal(), measure: this.measure, sel: sel, risks: ex.risks, visible: ex.visible, pop: ex.pop, flash: ex.flash,
      drop: this.drop, top: this.topId, guides: this.guides, temp: this.temp, handles: !!hid && !con.on, handleId: hid, connectFrom: con.on ? con.from : null };
    this.g.setAttribute('transform', 'translate(' + v.tx + ',' + v.ty + ') scale(' + v.k + ')');
    this.g.innerHTML = R.world(doc, o);
    var gs = 24 * v.k;
    this.wrap.style.backgroundSize = gs + 'px ' + gs + 'px';
    this.wrap.style.backgroundPosition = v.tx + 'px ' + v.ty + 'px';
    if (this.onDraw) this.onDraw();
  };

  /** 世界坐标下最上面的方框：小方框优先，其次更深的环节。 */
  Canvas.prototype.hitNode = function (wx, wy, exclude) {
    var doc = this.host.doc(), vis = (this.host.extra() || {}).visible, best = null, bestScore = -1;
    doc.nodes.forEach(function (n) {
      if (exclude && exclude[n.id]) return;
      if (M.isHidden(doc, n.id) || (vis && !vis.has(n.id))) return;
      var r = M.rectOf(n);
      if (wx < r.x || wx > r.x + r.w || wy < r.y || wy > r.y + r.h) return;
      var score = n.type === 'stage' ? M.depth(doc, n.id) : 1000;
      if (score > bestScore) { best = n; bestScore = score; }
    });
    return best;
  };
  Canvas.prototype.idAt = function (e) { var t = e.target.closest && e.target.closest('[data-id]'); return t ? t.getAttribute('data-id') : null; };

  Canvas.prototype.down = function (e) {
    var h = this.host;
    this.svg.focus({ preventScroll: true });
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    this.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(this.ptrs);
    if (ids.length === 2) {
      if (this.act && this.act.type === 'node' && this.act.moved) this.finishDrag();
      var a = this.ptrs[ids[0]], b = this.ptrs[ids[1]];
      this.act = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v: { k: this.view.k, tx: this.view.tx, ty: this.view.ty } };
      this.temp = null; this.guides = null; this.drop = null; this.topId = null; this.draw();
      return;
    }
    if (ids.length > 2) return;
    var t = e.target, w = this.toWorld(e.clientX, e.clientY);
    var hd = t.closest && t.closest('[data-handle]'), tog = t.closest && t.closest('[data-act="toggle"]');
    var ndEl = t.closest && t.closest('[data-id]'), edEl = t.closest && t.closest('[data-edge]');
    var ro = h.readOnly();
    if (hd && !ro) {
      var fid = hd.getAttribute('data-handle'), fn = M.get(h.doc(), fid), r = M.rectOf(fn);
      this.act = { type: 'link', from: fid, x0: r.x + r.w / 2, y0: r.y + r.h / 2 };
      this.temp = { x1: this.act.x0, y1: this.act.y0, x2: w.x, y2: w.y }; this.draw(); return;
    }
    if (tog) { this.act = { type: 'toggle', id: tog.getAttribute('data-id'), sx: e.clientX, sy: e.clientY }; return; }
    if (ndEl) {
      var id = ndEl.getAttribute('data-id'), n = M.get(h.doc(), id);
      this.act = { type: 'node', id: id, sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, ox: n.x, oy: n.y, moved: false, ro: ro };
      return;
    }
    if (edEl) { this.act = { type: 'edge', id: edEl.getAttribute('data-edge'), sx: e.clientX, sy: e.clientY }; return; }
    this.act = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: this.view.tx, ty: this.view.ty, moved: false };
    this.wrap.classList.add('panning');
  };

  Canvas.prototype.move = function (e) {
    var h = this.host;
    if (!this.ptrs[e.pointerId]) {
      if (e.pointerType === 'mouse' && !h.readOnly()) {
        var w0 = this.toWorld(e.clientX, e.clientY), n0 = this.hitNode(w0.x, w0.y), id0 = n0 ? n0.id : null;
        var onHandle = e.target.closest && e.target.closest('[data-handle]');
        if (!onHandle && id0 !== this.hover) { this.hover = id0; this.draw(); }
      }
      return;
    }
    this.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var a = this.act; if (!a) return;
    if (a.type === 'pinch') {
      var ids = Object.keys(this.ptrs); if (ids.length < 2) return;
      var p = this.ptrs[ids[0]], q = this.ptrs[ids[1]], d = Math.hypot(p.x - q.x, p.y - q.y) || 1, mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      var k = Math.max(0.15, Math.min(3, a.v.k * d / a.d)), rr = this.svg.getBoundingClientRect();
      var lx = a.mx - rr.left, ly = a.my - rr.top, wx = (lx - a.v.tx) / a.v.k, wy = (ly - a.v.ty) / a.v.k;
      this.view = { k: k, tx: mx - rr.left - wx * k, ty: my - rr.top - wy * k }; this.draw(); return;
    }
    if (a.type === 'pan') {
      if (Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) > 3) a.moved = true;
      this.view.tx = a.tx + e.clientX - a.sx; this.view.ty = a.ty + e.clientY - a.sy; this.draw(); return;
    }
    if (a.type === 'link') {
      var w = this.toWorld(e.clientX, e.clientY); this.temp = { x1: a.x0, y1: a.y0, x2: w.x, y2: w.y };
      var tn = this.hitNode(w.x, w.y); this.hover = tn ? tn.id : null; this.draw(); return;
    }
    if (a.type === 'node') {
      if (!a.moved) {
        if (Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) < 5) return;
        if (a.ro) { a.type = 'pan'; a.tx = this.view.tx; a.ty = this.view.ty; a.moved = true; return; }
        a.moved = true; h.begin();
        var doc0 = h.doc(), n0 = M.get(doc0, a.id);
        a.parent0 = n0.parent; n0.parent = null; M.fitStages(doc0);
        a.ox = n0.x; a.oy = n0.y;
        a.ex = {}; a.ex[a.id] = 1; M.descendants(doc0, a.id).forEach(function (d) { a.ex[d.id] = 1; });
        this.topId = a.id; this.hover = null;
        if (h.sel() == null || h.sel().id !== a.id) h.select({ kind: 'node', id: a.id }, true);
      }
      var doc = h.doc(), n = M.get(doc, a.id), wp = this.toWorld(e.clientX, e.clientY);
      var nx = a.ox + wp.x - a.wx, ny = a.oy + wp.y - a.wy;
      var snapped = this.snapPos(doc, n, nx, ny, a.ex);
      M.moveTo(doc, a.id, snapped.x, snapped.y);
      var st = this.hitStage(wp.x, wp.y, a.ex);
      this.drop = st ? st.id : null;
      this.draw();
    }
  };

  Canvas.prototype.hitStage = function (wx, wy, ex) {
    var doc = this.host.doc(), best = null, bd = -1;
    doc.nodes.forEach(function (s) {
      if (s.type !== 'stage' || ex[s.id] || M.isHidden(doc, s.id)) return;
      var r = M.rectOf(s);
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) { var d = M.depth(doc, s.id); if (d > bd) { bd = d; best = s; } }
    });
    return best;
  };

  /** 吸附：先找和别的方框左 / 中 / 右（上 / 中 / 下）对齐的位置，找不到就吸到 8px 网格。 */
  Canvas.prototype.snapPos = function (doc, n, x, y, ex) {
    this.guides = null;
    if (!this.host.snap()) return { x: Math.round(x), y: Math.round(y) };
    var r = M.rectOf(n), th = 6 / this.view.k, bx = null, by = null, gx = null, gy = null;
    var mine = { xs: [0, r.w / 2, r.w], ys: [0, r.h / 2, r.h] };
    doc.nodes.forEach(function (o) {
      if (ex[o.id] || M.isHidden(doc, o.id)) return;
      var q = M.rectOf(o), oxs = [q.x, q.x + q.w / 2, q.x + q.w], oys = [q.y, q.y + q.h / 2, q.y + q.h];
      mine.xs.forEach(function (dx) { oxs.forEach(function (tx) { var d = tx - (x + dx); if (Math.abs(d) < th && (bx == null || Math.abs(d) < Math.abs(bx))) { bx = d; gx = { x: tx, q: q }; } }); });
      mine.ys.forEach(function (dy) { oys.forEach(function (ty) { var d = ty - (y + dy); if (Math.abs(d) < th && (by == null || Math.abs(d) < Math.abs(by))) { by = d; gy = { y: ty, q: q }; } }); });
    });
    var g = C.GRID, nx = bx != null ? x + bx : Math.round(x / g) * g, ny = by != null ? y + by : Math.round(y / g) * g, guides = [];
    if (gx) guides.push({ x1: gx.x, x2: gx.x, y1: Math.min(ny, gx.q.y) - 10, y2: Math.max(ny + r.h, gx.q.y + gx.q.h) + 10 });
    if (gy) guides.push({ y1: gy.y, y2: gy.y, x1: Math.min(nx, gy.q.x) - 10, x2: Math.max(nx + r.w, gy.q.x + gy.q.w) + 10 });
    this.guides = guides.length ? guides : null;
    return { x: Math.round(nx), y: Math.round(ny) };
  };

  Canvas.prototype.finishDrag = function () {
    var a = this.act, h = this.host, doc = h.doc(), n = M.get(doc, a.id);
    var target = this.drop;
    if (target && M.canParent(doc, a.id, target)) { n.parent = target; var st = M.get(doc, target); if (st.collapsed) st.collapsed = false; }
    else n.parent = null;
    M.fitStages(doc);
    this.drop = null; this.guides = null; this.topId = null; this.act = null;
    h.changed(a.parent0 !== n.parent ? (n.parent ? '放进了「' + M.get(doc, n.parent).name + '」' : '移出了环节') : null);
  };

  Canvas.prototype.up = function (e, cancel) {
    var h = this.host, a = this.act;
    delete this.ptrs[e.pointerId];
    this.wrap.classList.remove('panning');
    if (!a) return;
    if (a.type === 'pinch') { if (Object.keys(this.ptrs).length === 0) this.act = null; return; }
    this.act = null;
    if (cancel) { if (a.type === 'node' && a.moved) { this.act = a; this.finishDrag(); } this.temp = null; this.draw(); return; }
    var con = h.connect();
    if (a.type === 'link') {
      var w = this.toWorld(e.clientX, e.clientY), ex = {}; ex[a.from] = 1;
      var tn = this.hitNode(w.x, w.y, ex); this.temp = null; this.hover = null;
      if (tn) this.makeEdge(a.from, tn.id); else this.draw();
      return;
    }
    if (a.type === 'toggle') {
      if (Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) < 8) h.onToggle(a.id);
      return;
    }
    if (a.type === 'node' && a.moved) { this.act = a; this.finishDrag(); return; }
    if (a.type === 'node') {
      if (con.on) {
        if (!con.from) { h.setConnect({ on: true, from: a.id }); this.draw(); }
        else if (con.from !== a.id) { var f = con.from; h.setConnect({ on: false, from: null }); this.makeEdge(f, a.id); }
        return;
      }
      var now = Date.now();
      if (this.lastTap.id === a.id && now - this.lastTap.t < 380) { this.lastTap = { t: 0, id: null }; h.select({ kind: 'node', id: a.id }); h.onOpen(a.id); return; }
      this.lastTap = { t: now, id: a.id };
      h.select({ kind: 'node', id: a.id }); return;
    }
    if (a.type === 'edge') { h.select({ kind: 'edge', id: a.id }); return; }
    if (a.type === 'pan' && !a.moved) {
      if (con.on) h.setConnect({ on: false, from: null });
      h.select(null);
    }
  };

  Canvas.prototype.makeEdge = function (from, to) {
    var h = this.host, doc = h.doc();
    if (M.isDescendant(doc, to, from) || M.isDescendant(doc, from, to)) { h.toast('环节和它里面的方框之间不用连线'); this.draw(); return; }
    if (doc.edges.some(function (x) { return x.from === from && x.to === to; })) { h.toast('这两个方框之间已经有这条线了'); this.draw(); return; }
    h.begin();
    var e = M.addEdge(doc, from, to);
    if (!e) { this.draw(); return; }
    h.select({ kind: 'edge', id: e.id }, true);
    h.changed('连好了：' + M.get(doc, from).name + ' → ' + M.get(doc, to).name);
    h.onEdge(e);
  };

  /** 导出 PNG：用浅色配色画一份完整 SVG，转成图片再画到 2 倍大小的 canvas 上。 */
  Canvas.prototype.exportPNG = function (doc, extra, done) {
    var svg = R.standalone(doc, { pal: C.PALETTES.light, measure: this.measure, risks: extra && extra.risks, visible: extra && extra.visible });
    var m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg), W = +m[1], H = +m[2], scale = Math.min(2, 8000 / Math.max(W, H));
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
      var ctx = cv.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
      try { cv.toBlob(function (b) { done(b, cv, null); }, 'image/png'); } catch (err) { done(null, null, svg); }
    };
    img.onerror = function () { done(null, null, svg); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };

  root.ABB.Canvas = Canvas;
})(window);
