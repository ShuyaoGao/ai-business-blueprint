/* 画布：SVG 显示、平移缩放（滚轮 / 双指）、拖节点（吸附网格 + 对齐参考线 + 拖进环节）、口对口拉线、导出 PNG。
 * 用 Pointer Events 统一鼠标、手指、触控笔。
 * 拉线：从右边的输出口拖到左边的输入口（或者直接拖到节点上，自动挑口）；拖到空白处松手 → 弹出「接一个什么节点」。
 *       从已经接了线的输入口往外拖 = 把这条线拔下来，改接到别处。
 * host 由 app.js 提供：doc() readOnly() sel() select(sel) begin() changed() connect() setConnect(c) snap() extra()
 *                     onOpen(id) onEdge(edge) onToggle(id) quickAdd(opts) toast(msg)
 */
(function (root) {
  'use strict';
  var C = root.ABB.Config, M = root.ABB.Model, R = root.ABB.Render;

  function Canvas(wrap, svg, host) {
    var self = this;
    this.wrap = wrap; this.svg = svg; this.host = host;
    this.view = { k: 1, tx: 0, ty: 0 };
    this.g = svg.querySelector('#world');
    this.ptrs = {}; this.act = null; this.guides = null; this.temp = null; this.drop = null; this.topId = null;
    this.linking = null; this.hoverPort = null; this.dropEdge = null;
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
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !self.act && self.hoverPort) { self.hoverPort = null; self.draw(); } });
    svg.addEventListener('dblclick', function (e) {
      if (host.readOnly() || e.target.closest('[data-id]') || e.target.closest('[data-edge]')) return;
      var w = self.toWorld(e.clientX, e.clientY); host.quickAdd({ world: w, client: { x: e.clientX, y: e.clientY } });
    });
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
  Canvas.prototype.toClient = function (wx, wy) { var r = this.svg.getBoundingClientRect(), v = this.view; return { x: r.left + wx * v.k + v.tx, y: r.top + wy * v.k + v.ty }; };
  Canvas.prototype.size = function () { var r = this.svg.getBoundingClientRect(); return { w: r.width || 1, h: r.height || 1 }; };
  Canvas.prototype.center = function () { var s = this.size(), v = this.view; return { x: (s.w / 2 - v.tx) / v.k, y: (s.h / 2 - v.ty) / v.k }; };
  Canvas.prototype.inside = function (cx, cy) { var r = this.svg.getBoundingClientRect(); return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom; };

  Canvas.prototype.zoomAt = function (px, py, f) {
    var v = this.view, k = Math.max(0.12, Math.min(3, v.k * f)); f = k / v.k;
    v.tx = px - (px - v.tx) * f; v.ty = py - (py - v.ty) * f; v.k = k; this.draw();
  };
  Canvas.prototype.zoomBy = function (f) { var s = this.size(); this.zoomAt(s.w / 2, s.h / 2, f); };

  /** 让 rect（默认整张图）铺满画布。 */
  Canvas.prototype.fit = function (rect, maxK) {
    var b = rect || M.bounds(this.host.doc(), this.host.extra().visible || null);
    var s = this.size(), m = s.w < 500 ? 14 : 30;
    if (!b) { this.view = { k: 1, tx: s.w / 2 - 200, ty: 60 }; this.draw(); return; }
    var k = Math.min((s.w - 2 * m) / Math.max(b.w + 40, 1), (s.h - 2 * m) / Math.max(b.h + 12, 1), maxK || 1.1);
    k = Math.max(0.12, k);
    this.view = { k: k, tx: (s.w - (b.w + 40) * k) / 2 - b.x * k, ty: (s.h - b.h * k) / 2 - b.y * k + 6 * k };
    this.draw();
  };
  /** 把某个节点移到画布中间（不改缩放，太小时放大到 0.8）。 */
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
    var h = this.host, doc = h.doc(), v = this.view, ex = h.extra() || {}, con = h.connect();
    var o = { pal: this.pal(), measure: this.measure, sel: h.sel(), risks: ex.risks, visible: ex.visible, pop: ex.pop, flash: ex.flash, run: ex.run,
      drop: this.drop, top: this.topId, guides: this.guides, temp: this.temp, linking: this.linking, hoverPort: this.hoverPort, dropEdge: this.dropEdge,
      connectFrom: con.on ? con.from : null };
    this.g.setAttribute('transform', 'translate(' + v.tx + ',' + v.ty + ') scale(' + v.k + ')');
    this.g.innerHTML = R.world(doc, o);
    var gs = 24 * v.k;
    this.wrap.style.backgroundSize = gs + 'px ' + gs + 'px';
    this.wrap.style.backgroundPosition = v.tx + 'px ' + v.ty + 'px';
    this.wrap.classList.toggle('linking', !!this.linking);
    if (this.onDraw) this.onDraw();
  };

  function visibleNodes(self) {
    var doc = self.host.doc(), vis = (self.host.extra() || {}).visible;
    return doc.nodes.filter(function (n) { return !M.isHidden(doc, n.id) && (!vis || vis.has(n.id)); });
  }

  /** 世界坐标下最上面的节点：普通节点优先，其次更深的环节。 */
  Canvas.prototype.hitNode = function (wx, wy, exclude) {
    var doc = this.host.doc(), best = null, bestScore = -1;
    visibleNodes(this).forEach(function (n) {
      if (exclude && exclude[n.id]) return;
      var r = M.rectOf(n);
      if (wx < r.x || wx > r.x + r.w || wy < r.y || wy > r.y + r.h) return;
      var score = n.type === 'stage' ? M.depth(doc, n.id) : 1000;
      if (score > bestScore) { best = n; bestScore = score; }
    });
    return best;
  };
  /** 离指针最近的口（side = 'ins' / 'outs'），在 18 个屏幕像素以内。 */
  Canvas.prototype.hitPort = function (wx, wy, side, exclude) {
    var best = null, bd = Math.max(10, 18 / this.view.k);
    visibleNodes(this).forEach(function (n) {
      if (n.type === 'stage' || (exclude && exclude === n.id)) return;
      M.layout(n)[side].forEach(function (p) { var d = Math.hypot(p.x - wx, p.y - wy); if (d < bd) { bd = d; best = { id: n.id, side: side, pid: p.id, x: p.x, y: p.y }; } });
    });
    return best;
  };
  /** 指针下面的连线（往线上放新节点用）。 */
  Canvas.prototype.edgeAt = function (wx, wy) {
    var doc = this.host.doc(), vis = (this.host.extra() || {}).visible, best = null, bd = Math.max(8, 12 / this.view.k);
    doc.edges.forEach(function (e) {
      if (vis && (!vis.has(e.from) || !vis.has(e.to))) return;
      var en = R.ends(doc, e); if (!en) return;
      R.samplePts(R.curve(en.p0, en.p3), 28).forEach(function (p) { var d = Math.hypot(p.x - wx, p.y - wy); if (d < bd) { bd = d; best = e; } });
    });
    return best;
  };
  Canvas.prototype.hitStage = function (wx, wy, ex) {
    var doc = this.host.doc(), best = null, bd = -1;
    doc.nodes.forEach(function (s) {
      if (s.type !== 'stage' || (ex && ex[s.id]) || M.isHidden(doc, s.id)) return;
      var r = M.rectOf(s);
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) { var d = M.depth(doc, s.id); if (d > bd) { bd = d; best = s; } }
    });
    return best;
  };

  Canvas.prototype.startLink = function (from, fp, w) {
    var p = M.portPos(M.get(this.host.doc(), from), 'outs', fp);
    this.act = { type: 'link', from: from, fp: fp, x0: p.x, y0: p.y };
    this.linking = { from: from, fp: fp };
    this.temp = { x1: p.x, y1: p.y, x2: w.x, y2: w.y };
    this.draw();
  };

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
      this.temp = null; this.linking = null; this.guides = null; this.drop = null; this.topId = null; this.draw();
      return;
    }
    if (ids.length > 2) return;
    var t = e.target, w = this.toWorld(e.clientX, e.clientY), ro = h.readOnly();
    var ptEl = t.closest && t.closest('[data-port]'), tog = t.closest && t.closest('[data-act="toggle"]');
    var ndEl = t.closest && t.closest('[data-id]'), edEl = t.closest && t.closest('[data-edge]');
    if (ptEl && !ro && !h.connect().on) {
      var parts = ptEl.getAttribute('data-port').split('|'), doc = h.doc();
      if (parts[1] === 'outs') { this.startLink(parts[0], parts[2], w); return; }
      // 输入口：已经接了线的话，按下并拖动 = 把线拔下来改接
      var es = M.edgesInto(doc, parts[0], parts[2]);
      if (es.length) { this.act = { type: 'unplug', edge: es[es.length - 1], sx: e.clientX, sy: e.clientY, w: w, id: parts[0] }; return; }
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
        var w0 = this.toWorld(e.clientX, e.clientY), hp = this.hitPort(w0.x, w0.y, 'outs') || this.hitPort(w0.x, w0.y, 'ins'), key = hp ? hp.id + '|' + hp.side + '|' + hp.pid : null;
        if (key !== this.hoverPort) { this.hoverPort = key; this.draw(); }
      }
      return;
    }
    this.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var a = this.act; if (!a) return;
    if (a.type === 'pinch') {
      var ids = Object.keys(this.ptrs); if (ids.length < 2) return;
      var p = this.ptrs[ids[0]], q = this.ptrs[ids[1]], d = Math.hypot(p.x - q.x, p.y - q.y) || 1, mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      var k = Math.max(0.12, Math.min(3, a.v.k * d / a.d)), rr = this.svg.getBoundingClientRect();
      var lx = a.mx - rr.left, ly = a.my - rr.top, wx = (lx - a.v.tx) / a.v.k, wy = (ly - a.v.ty) / a.v.k;
      this.view = { k: k, tx: mx - rr.left - wx * k, ty: my - rr.top - wy * k }; this.draw(); return;
    }
    if (a.type === 'pan') {
      if (Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) > 3) a.moved = true;
      this.view.tx = a.tx + e.clientX - a.sx; this.view.ty = a.ty + e.clientY - a.sy; this.draw(); return;
    }
    if (a.type === 'unplug') {
      if (Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) < 6) return;
      h.begin(); var doc0 = h.doc(); M.removeEdge(doc0, a.edge.id);
      this.startLink(a.edge.from, a.edge.fp, this.toWorld(e.clientX, e.clientY)); this.act.unplugged = a.edge; return;
    }
    if (a.type === 'link') {
      var w = this.toWorld(e.clientX, e.clientY), hit = this.hitPort(w.x, w.y, 'ins', a.from);
      this.temp = { x1: a.x0, y1: a.y0, x2: hit ? hit.x : w.x, y2: hit ? hit.y : w.y };
      this.hoverPort = hit ? hit.id + '|ins|' + hit.pid : null;
      this.draw(); return;
    }
    if (a.type === 'node') {
      if (!a.moved) {
        if (Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) < 5) return;
        if (a.ro) { a.type = 'pan'; a.tx = this.view.tx; a.ty = this.view.ty; a.moved = true; return; }
        a.moved = true; h.begin();
        var doc1 = h.doc(), n0 = M.get(doc1, a.id);
        a.parent0 = n0.parent; n0.parent = null; M.fitStages(doc1);
        a.ox = n0.x; a.oy = n0.y;
        a.ex = {}; a.ex[a.id] = 1; M.descendants(doc1, a.id).forEach(function (dd) { a.ex[dd.id] = 1; });
        this.topId = a.id; this.hoverPort = null;
        if (h.sel() == null || h.sel().id !== a.id) h.select({ kind: 'node', id: a.id }, true);
      }
      var doc = h.doc(), n = M.get(doc, a.id), wp = this.toWorld(e.clientX, e.clientY);
      var snapped = this.snapPos(doc, n, a.ox + wp.x - a.wx, a.oy + wp.y - a.wy, a.ex);
      M.moveTo(doc, a.id, snapped.x, snapped.y);
      var st = this.hitStage(wp.x, wp.y, a.ex);
      this.drop = st ? st.id : null;
      this.draw();
    }
  };

  /** 吸附：先找和别的节点左 / 中 / 右（上 / 中 / 下）对齐的位置，找不到就吸到 8px 网格。 */
  Canvas.prototype.snapPos = function (doc, n, x, y, ex) {
    this.guides = null;
    if (!this.host.snap()) return { x: Math.round(x), y: Math.round(y) };
    var r = M.rectOf(n), th = 6 / this.view.k, bx = null, by = null, gx = null, gy = null;
    var mine = { xs: [0, r.w / 2, r.w], ys: [0, r.h / 2, r.h] };
    doc.nodes.forEach(function (o) {
      if (ex[o.id] || M.isHidden(doc, o.id) || o.type === 'stage') return;
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

  Canvas.prototype.endLink = function (e) {
    var a = this.act, h = this.host, doc = h.doc(), w = this.toWorld(e.clientX, e.clientY);
    var hit = this.hitPort(w.x, w.y, 'ins', a.from), ex = {}; ex[a.from] = 1;
    var tn = hit ? null : this.hitNode(w.x, w.y, ex);
    this.temp = null; this.linking = null; this.hoverPort = null; this.act = null;
    if (hit) return this.makeEdge(a.from, a.fp, hit.id, hit.pid, a.unplugged);
    if (tn && tn.type !== 'stage') return this.makeEdge(a.from, a.fp, tn.id, null, a.unplugged);
    if (a.unplugged) { h.changed('线拔掉了（可撤销）'); return; }
    this.draw();
    // 拖到空白处：问要接一个什么节点
    h.quickAdd({ from: a.from, fp: a.fp, world: w, client: { x: e.clientX, y: e.clientY } });
  };

  Canvas.prototype.up = function (e, cancel) {
    var h = this.host, a = this.act;
    delete this.ptrs[e.pointerId];
    this.wrap.classList.remove('panning');
    if (!a) return;
    if (a.type === 'pinch') { if (Object.keys(this.ptrs).length === 0) this.act = null; return; }
    if (cancel) {
      this.act = null;
      if (a.type === 'node' && a.moved) { this.act = a; this.finishDrag(); }
      if (a.type === 'link' && a.unplugged) h.changed(null);
      this.temp = null; this.linking = null; this.draw(); return;
    }
    if (a.type === 'link') return this.endLink(e);
    this.act = null;
    var con = h.connect();
    if (a.type === 'unplug') { a.type = 'node'; a.moved = false; }
    if (a.type === 'toggle') {
      if (Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) < 8) h.onToggle(a.id);
      return;
    }
    if (a.type === 'node' && a.moved) { this.act = a; this.finishDrag(); return; }
    if (a.type === 'node') {
      if (con.on) {
        var n = M.get(h.doc(), a.id);
        if (!con.from) { if (n.type === 'stage') return h.toast('业务环节是分组框，点里面的节点'); h.setConnect({ on: true, from: a.id }); this.draw(); }
        else if (con.from !== a.id) { var f = con.from; h.setConnect({ on: false, from: null }); this.makeEdge(f, null, a.id, null); }
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

  /** 连线：tp 为空时自动挑口。unplugged = 刚拔下来的线（这时已经记过撤销点）。 */
  Canvas.prototype.makeEdge = function (from, fp, to, tp, unplugged) {
    var h = this.host, doc = h.doc();
    var why = tp ? M.whyNot(doc, from, fp, to, tp) : (M.pickPorts(doc, from, to, fp) ? null : M.connect(M.clone(doc), from, to, fp).err);
    if (why) { if (unplugged) h.changed('线拔掉了（可撤销）'); h.toast(why); this.draw(); return; }
    if (!unplugged) h.begin();
    var r = tp ? M.addEdge(doc, from, fp, to, tp) : M.connect(doc, from, to, fp);
    if (!r.edge) { h.changed(null); h.toast(r.err || '连不上'); return; }
    var a = M.get(doc, from), b = M.get(doc, to), po = M.port(a, 'outs', r.edge.fp), pi = M.port(b, 'ins', r.edge.tp);
    h.select({ kind: 'edge', id: r.edge.id }, true);
    h.changed('连好了：' + a.name + '「' + po.name + '」→ ' + b.name + '「' + pi.name + '」' + (r.replaced ? '（换掉了原来那条）' : '') + (r.edge.fb ? '（形成回路，标成反馈线）' : ''));
    h.onEdge(r.edge);
  };

  /** 导出 PNG：用浅色配色画一份完整 SVG，转成图片再画到 2 倍大小的 canvas 上。 */
  Canvas.prototype.exportPNG = function (doc, extra, done) {
    var svg = R.standalone(doc, { pal: C.PALETTES.light, measure: this.measure, risks: extra && extra.risks, visible: extra && extra.visible, run: extra && extra.run });
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
