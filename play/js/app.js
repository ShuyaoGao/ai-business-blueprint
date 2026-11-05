/* 页面外壳：三个模式、工具条、右栏、撤销重做、自动保存、文件、键盘、手机菜单、说明、退出、自检。 */
(function (root) {
  'use strict';
  var C = root.ABB.Config, M = root.ABB.Model, Store = root.ABB.Store, P = root.ABB.Panels;
  function $(id) { return document.getElementById(id); }
  function A() { return root.ABB.Analysis; }

  var params = {}; location.search.replace(/[?&]([^=&]+)=?([^&]*)/g, function (_, k, v) { params[k] = decodeURIComponent(v); });

  var S = {
    mode: 'draw', docs: { draw: null, practice: null }, docId: null,
    hist: { draw: new M.History(200), practice: new M.History(200) },
    sel: null, connect: { on: false, from: null }, tab: 'props',
    lastEditKey: null, lastEditT: 0, flash: null, saveT: 0, exited: false
  };
  root.ABB.S = S;

  function cur() { return S.mode === 'watch' && root.ABB.Watch ? root.ABB.Watch.doc() : S.docs[S.mode]; }
  function readOnly() { return S.mode === 'watch'; }
  function isPhone() { return root.matchMedia && root.matchMedia('(max-width: 760px)').matches; }

  // ---------------- 提示 ----------------
  var toastT = 0;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  // ---------------- 改动、撤销、保存 ----------------
  function pushHist() { if (!readOnly()) S.hist[S.mode].push(JSON.stringify(cur())); S.lastEditKey = null; }
  function commit(fn, msg) {
    if (readOnly()) return false;
    var before = JSON.stringify(cur());
    try { fn(cur()); } catch (err) { S.docs[S.mode] = JSON.parse(before); toast(err.message || String(err)); refresh(); return false; }
    S.hist[S.mode].push(before); S.lastEditKey = null;
    M.fitStages(cur());
    changed(msg); return true;
  }
  /** 文字输入：同一个字段 1.5 秒内的连续输入算一步撤销；不重建右栏（免得光标跳走）。 */
  function edit(fn, key) {
    if (readOnly()) return;
    var now = Date.now();
    if (key !== S.lastEditKey || now - S.lastEditT > 1500) S.hist[S.mode].push(JSON.stringify(cur()));
    S.lastEditKey = key; S.lastEditT = now;
    fn(cur()); save(); canvas.draw(); updateButtons();
    if (key === 'doc.title') fillDocSelect();
    if (root.ABB.Practice && S.mode === 'practice') root.ABB.Practice.check(cur());
  }
  function changed(msg) {
    var d = cur();
    if (S.sel && !(S.sel.kind === 'node' ? M.get(d, S.sel.id) : M.getEdge(d, S.sel.id))) S.sel = null;
    save(); refresh(); if (msg) toast(msg);
  }
  function refresh() {
    canvas.draw(); refreshPanel(); updateButtons();
    if (root.ABB.Practice && S.mode === 'practice') root.ABB.Practice.check(cur());
  }
  function save() {
    clearTimeout(S.saveT);
    S.saveT = setTimeout(saveNow, 250);
  }
  function saveNow() {
    clearTimeout(S.saveT);
    if (S.mode === 'draw' && S.docs.draw) { Store.save(S.docId, S.docs.draw); Store.setCur(S.docId); }
    if (S.docs.practice) Store.set('abb.practice', JSON.stringify(S.docs.practice));
  }
  function undo() {
    if (readOnly()) return;
    var st = S.hist[S.mode].undo(JSON.stringify(cur())); if (!st) return toast('没有可撤销的操作');
    S.docs[S.mode] = JSON.parse(st); S.lastEditKey = null; changed('已撤销');
    if (root.ABB.Practice && S.mode === 'practice') root.ABB.Practice.note('undo');
  }
  function redo() {
    if (readOnly()) return;
    var st = S.hist[S.mode].redo(JSON.stringify(cur())); if (!st) return toast('没有可重做的操作');
    S.docs[S.mode] = JSON.parse(st); S.lastEditKey = null; changed('已重做');
  }

  // ---------------- 选择、连线 ----------------
  function select(sel, silent) {
    S.sel = sel;
    if (sel && S.tab !== 'props' && !isPhone()) S.tab = 'props';
    refreshPanel(); updateButtons(); canvas.draw();
  }
  function setConnect(c) {
    S.connect = c;
    var hint = $('connect-hint');
    if (c.on) { hint.hidden = false; hint.textContent = c.from ? '再点终点方框（点空白处取消）' : '连线：先点起点方框'; }
    else hint.hidden = true;
    $('btn-connect').classList.toggle('on', c.on); $('mb-connect').classList.toggle('on', c.on);
    canvas.draw();
  }
  function toggleConnect() {
    if (readOnly()) return;
    if (S.connect.on) return setConnect({ on: false, from: null });
    setConnect({ on: true, from: S.sel && S.sel.kind === 'node' ? S.sel.id : null });
  }

  function locate(id) {
    var d = cur(), n = M.get(d, id), e = !n && M.getEdge(d, id);
    if (e) { S.sel = { kind: 'edge', id: id }; id = e.from; n = M.get(d, id); }
    else if (n) S.sel = { kind: 'node', id: id };
    if (!n) return;
    S.flash = M.visibleId(d, id);
    if (isPhone()) closeSheet();
    canvas.reveal(id); refreshPanel(); updateButtons();
    setTimeout(function () { S.flash = null; canvas.draw(); }, 1800);
  }

  // ---------------- 加方框、删除 ----------------
  function snapV(v) { return $('ck-snap').checked ? Math.round(v / C.GRID) * C.GRID : Math.round(v); }
  function overlaps(d, r, skip) {
    return d.nodes.some(function (o) { if (o.id === skip || o.type === 'stage' || M.isHidden(d, o.id)) return false; var q = M.rectOf(o); return r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y; });
  }
  function addBox(type, worldPt) {
    if (readOnly()) return toast('观看模式不能改；切到「我来画」');
    var newId = null, where = '';
    commit(function (d) {
      var n = M.addNode(d, type, 0, 0); newId = n.id;
      if (worldPt) {
        M.moveTo(d, n.id, snapV(worldPt.x - n.w / 2), snapV(worldPt.y - n.h / 2));
        var ex = {}; ex[n.id] = 1;
        var st = canvas.hitStage(worldPt.x, worldPt.y, ex);
        if (st) { n.parent = st.id; st.collapsed = false; where = st.name; }
        return;
      }
      if (type === 'stage') {
        // 新环节排在已有顶层环节的右边，形成一行流程；要嵌套就把它拖进别的环节
        var tops = d.nodes.filter(function (m) { return m.type === 'stage' && !m.parent && m.id !== n.id; });
        if (tops.length) {
          var right = -Infinity, top = Infinity;
          tops.forEach(function (m) { var r = M.rectOf(m); right = Math.max(right, r.x + r.w); top = Math.min(top, r.y); });
          M.moveTo(d, n.id, snapV(right + 64), snapV(top)); return;
        }
      }
      var target = null, s = type !== 'stage' && S.sel && S.sel.kind === 'node' && M.get(d, S.sel.id);
      if (s) target = s.type === 'stage' ? s : (s.parent ? M.get(d, s.parent) : null);
      if (target) { M.placeInside(d, target.id, n); where = target.name; return; }
      var c = canvas.center(), x = snapV(c.x - n.w / 2), y = snapV(c.y - n.h / 2), i = 0;
      while (i++ < 30 && overlaps(d, { x: x, y: y, w: n.w, h: n.h }, n.id)) { x += 24; y += 24; }
      M.moveTo(d, n.id, x, y);
    }, null);
    S.sel = { kind: 'node', id: newId };
    toast('加了一个「' + C.TYPES[type].name + '」' + (where ? '，放在「' + where + '」里' : ''));
    refresh();
    if (!worldPt) { var n = M.get(cur(), newId); var r = M.rectOf(n), s = canvas.size(), v = canvas.view, sx = r.x * v.k + v.tx, sy = r.y * v.k + v.ty; if (sx < 0 || sy < 0 || sx + r.w * v.k > s.w || sy + r.h * v.k > s.h) canvas.reveal(newId); }
    if (root.ABB.Practice && S.mode === 'practice') root.ABB.Practice.check(cur());
  }
  function delSel() {
    if (readOnly() || !S.sel) return;
    var s = S.sel;
    commit(function (d) { if (s.kind === 'node') M.removeNode(d, s.id); else M.removeEdge(d, s.id); }, s.kind === 'node' ? '删除了方框（可撤销）' : '删除了连线');
    S.sel = null; refresh();
  }
  function toggleStage(id) {
    var n = M.get(cur(), id); if (!n) return;
    if (readOnly()) { n.collapsed = !n.collapsed; refresh(); return; }
    commit(function (d) { var m = M.get(d, id); m.collapsed = !m.collapsed; }, n.collapsed ? '展开了「' + n.name + '」' : '折叠了「' + n.name + '」');
  }

  // ---------------- 蓝图文档（我来画） ----------------
  function fillDocSelect() {
    var s = $('doc-select'), list = Store.list(); s.innerHTML = '';
    if (!list.some(function (x) { return x.id === S.docId; })) list.unshift({ id: S.docId, title: S.docs.draw.title });
    list.forEach(function (x) { var o = document.createElement('option'); o.value = x.id; o.textContent = x.id === S.docId ? S.docs.draw.title : x.title; s.appendChild(o); });
    s.value = S.docId;
  }
  function loadDraw(id) {
    var raw = id && Store.load(id), d = null;
    if (raw) { try { d = M.parse(raw); } catch (e) { d = null; } }
    if (!d) { id = Store.newId(); d = M.create('我的业务蓝图'); }
    S.docId = id; S.docs.draw = d; S.hist.draw.clear(); S.sel = null;
  }
  function newDraw(doc, msg) {
    saveNow();
    S.docId = Store.newId(); S.docs.draw = doc || M.create('我的业务蓝图 ' + (Store.list().length + 1));
    S.hist.draw.clear(); S.sel = null;
    Store.save(S.docId, S.docs.draw); Store.setCur(S.docId);
    if (S.mode !== 'draw') setMode('draw'); else { fillDocSelect(); refresh(); canvas.fit(); }
    if (msg) toast(msg);
  }
  function delDraw() {
    if (!confirm('删除「' + S.docs.draw.title + '」？删除后不能恢复（可以先下载 .json 备份）。')) return;
    Store.del(S.docId);
    var rest = Store.list(); loadDraw(rest.length ? rest[0].id : null); Store.setCur(S.docId);
    fillDocSelect(); refresh(); canvas.fit(); toast('已删除');
  }

  // ---------------- 文件 ----------------
  function fname(ext) { return (cur().title || '蓝图').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) + ext; }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function openFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var d;
      try { d = M.parse(String(fr.result)); } catch (e) { return toast('打不开：' + e.message); }
      if (S.mode === 'practice') { pushHist(); S.docs.practice = d; S.sel = null; changed('已打开 ' + file.name); canvas.fit(); }
      else newDraw(d, '已打开 ' + file.name + '（存成了一份新蓝图）');
    };
    fr.onerror = function () { toast('读取文件失败'); };
    fr.readAsText(file, 'utf-8');
  }
  function visibleNow() { return S.mode === 'watch' && root.ABB.Watch ? root.ABB.Watch.extra().visible || null : null; }
  function extraFor(doc) { return { risks: A() ? A().risks(doc, visibleNow()).map : null, visible: visibleNow() }; }
  var CMDS = {
    'new': function () { newDraw(null, '新建了一份空白蓝图'); },
    'open': function () { if (readOnly()) return; $('file-open').value = ''; $('file-open').click(); },
    'save-json': function () { download(new Blob([M.serialize(cur())], { type: 'application/json' }), fname('.json')); toast('已下载 ' + fname('.json')); note('download'); },
    'png': function () {
      canvas.exportPNG(cur(), extraFor(cur()), function (blob, cv, svg) {
        if (blob) { download(blob, fname('.png')); toast('已导出 PNG（' + cv.width + '×' + cv.height + '）'); }
        else { download(new Blob([svg], { type: 'image/svg+xml' }), fname('.svg')); toast('这个浏览器不允许导出 PNG，改成导出了 SVG'); }
      });
    },
    'md': function () {
      if (!A()) return toast('Markdown 清单在下一段加入');
      var md = A().markdown(cur(), extraFor(cur()).visible);
      download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), fname('.md')); toast('已导出 Markdown 清单'); note('markdown');
    },
    'copy-sample': function () {
      var d = root.ABB.Watch ? root.ABB.Watch.fullDoc() : M.clone(cur()); d.title = d.title.replace(/（虚构示例）/, '') + '（虚构示例副本）';
      newDraw(d, '示例已复制到「我来画」，可以随便改了');
    },
    'fit': function () { canvas.fit(); },
    'delete': delSel,
    'help': function () { showHelp(true); },
    'exit': exitApp
  };
  function cmd(name) { closeMenus(); if (CMDS[name]) CMDS[name](); }
  function note(ev) { if (root.ABB.Practice && S.mode === 'practice') root.ABB.Practice.note(ev); }

  // ---------------- 右栏 ----------------
  function refreshPanel() {
    var body = $('panel-body'); if (!body) return;
    var active = document.activeElement, keep = active && body.contains(active) && active.getAttribute('data-key');
    body.innerHTML = '';
    document.querySelectorAll('#ptabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === S.tab); });
    var t = S.tab;
    if (t === 'props') P.props(body);
    else if (t === 'tasks' && root.ABB.Practice) root.ABB.Practice.panel(body);
    else if ((t === 'stats' || t === 'quad' || t === 'list') && P[t] && A()) P[t](body);
    else body.appendChild(P.el('p', { class: 'hint pad', text: '这一栏在下一段加入。' }));
    if (keep) { var f = body.querySelector('[data-key="' + keep + '"]'); if (f && f.focus) f.focus(); }
    var rb = $('risk-badge');
    if (rb && A()) { var rk = A().risks(cur(), visibleNow()); rb.textContent = rk.red ? rk.red : ''; rb.className = rk.red ? 'badge red' : ''; }
  }
  function setTab(t) { S.tab = t; refreshPanel(); }
  function openSheet(t) { if (t) S.tab = t; document.body.classList.add('sheet-open'); refreshPanel(); }
  function closeSheet() { document.body.classList.remove('sheet-open'); }

  function updateButtons() {
    var ro = readOnly(), h = S.hist[S.mode];
    $('btn-undo').disabled = ro || !h || !h.canUndo(); $('btn-redo').disabled = ro || !h || !h.canRedo();
    $('btn-del').disabled = ro || !S.sel; $('mb-del').disabled = ro || !S.sel; $('mb-undo').disabled = ro || !h || !h.canUndo();
    var empty = !cur().nodes.length;
    $('stage-wrap').classList.toggle('empty', empty && !ro);
  }

  // ---------------- 模式 ----------------
  function setMode(m) {
    if (m === 'watch' && !root.ABB.Watch) { toast('观看模式在第三段加入'); m = 'draw'; }
    if (S.mode === 'watch' && m !== 'watch' && root.ABB.Watch) root.ABB.Watch.leave();
    saveNow();
    S.mode = m; S.sel = null; setConnect({ on: false, from: null });
    document.body.classList.remove('m-watch', 'm-draw', 'm-practice'); document.body.classList.add('m-' + m);
    document.querySelectorAll('#modes button').forEach(function (b) { var on = b.getAttribute('data-mode') === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    if (m === 'practice') {
      if (!S.docs.practice) { var raw = Store.get('abb.practice'); try { S.docs.practice = raw ? M.parse(raw) : null; } catch (e) { S.docs.practice = null; } }
      if (!S.docs.practice) S.docs.practice = M.create('练习：拆一项业务');
      S.tab = root.ABB.Practice ? 'tasks' : 'props';
      if (root.ABB.Practice) root.ABB.Practice.enter(cur());
    } else if (m === 'watch') { S.tab = 'props'; root.ABB.Watch.enter(); }
    else { S.tab = 'props'; fillDocSelect(); }
    closeSheet();
    refresh(); canvas.fit();
    try { history.replaceState(null, '', location.pathname + (m === 'watch' ? '' : '?mode=' + m) + location.hash); } catch (e) { /* file:// 下可能不允许 */ }
  }

  // ---------------- 说明、退出、菜单 ----------------
  function showHelp(on) {
    $('help').hidden = !on;
    if (!on) { Store.set('abb.helpSeen', '1'); if (root.ABB.Watch && S.mode === 'watch') root.ABB.Watch.autoStart(); }
  }
  function exitApp() {
    if (root.ABB.Watch) root.ABB.Watch.stop();
    saveNow(); S.exited = true; $('exited').hidden = false;
    try { root.close(); } catch (e) { /* 浏览器不让关就留在提示页 */ }
  }
  function closeMenus() {
    $('menu').hidden = true; $('menu-btn').setAttribute('aria-expanded', 'false');
    document.querySelectorAll('.dd.open').forEach(function (d) { d.classList.remove('open'); });
  }

  // ---------------- 画布 ----------------
  var host = {
    doc: cur, readOnly: readOnly, sel: function () { return S.sel; }, select: select,
    begin: pushHist, changed: function (msg) { M.fitStages(cur()); changed(msg); note('move'); },
    connect: function () { return S.connect; }, setConnect: setConnect, snap: function () { return $('ck-snap').checked; },
    extra: function () {
      var d = cur(), w = S.mode === 'watch' && root.ABB.Watch ? root.ABB.Watch.extra() : {};
      return { risks: A() ? A().risks(d, w.visible || null).map : null, visible: w.visible || null, pop: w.pop || null, flash: S.flash || w.flash || null };
    },
    onOpen: function (id) {
      if (isPhone()) return openSheet('props');
      var f = $('panel-body').querySelector('[data-key="name"]'); if (f && !f.disabled) { f.focus(); f.select(); }
    },
    onEdge: function () { note('edge'); },
    onToggle: toggleStage, toast: toast
  };
  var canvas = new root.ABB.Canvas($('stage-wrap'), $('canvas'), host);
  canvas.onDraw = function () { $('zoom-badge').textContent = Math.round(canvas.view.k * 100) + '%'; };

  // 面板用的 host
  P.host = {
    doc: cur, readOnly: readOnly, sel: function () { return S.sel; }, select: function (s) { select(s); if (s) canvas.reveal(s.kind === 'node' ? s.id : M.getEdge(cur(), s.id).from); },
    edit: edit, commit: commit, locate: locate, visible: function () { return visibleNow(); }, cmd: cmd, toggle: toggleStage, toast: toast, mode: function () { return S.mode; }
  };

  // ---------------- 工具条 ----------------
  function buildAddButtons() {
    var g = $('grp-add'), mm = $('mb-add-menu');
    C.TYPE_ORDER.forEach(function (t) {
      var b = P.el('button', { class: 'mini addbtn t-' + t, 'data-add': t, title: '加一个「' + C.TYPES[t].name + '」：点一下加在画布中间（选中环节时加在环节里），或者拖到画布上' }, []);
      b.innerHTML = P.iconSvg(t, 18) + '<span>' + C.TYPES[t].short + '</span>';
      g.appendChild(b);
      var mb = P.el('button', { type: 'button', 'data-add': t }, []); mb.innerHTML = P.iconSvg(t, 22) + '<span>' + C.TYPES[t].name + '</span>';
      mb.addEventListener('click', function () { closeMenus(); addBox(t); });
      mm.appendChild(mb);
      // 拖到画布上
      var drag = null;
      b.addEventListener('pointerdown', function (e) { if (e.button) return; drag = { x: e.clientX, y: e.clientY, ghost: null, id: e.pointerId }; try { b.setPointerCapture(e.pointerId); } catch (err) { /* */ } });
      b.addEventListener('pointermove', function (e) {
        if (!drag) return;
        if (!drag.ghost && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 8) {
          drag.ghost = P.el('div', { class: 'drag-ghost t-' + t }, []); drag.ghost.innerHTML = P.iconSvg(t, 18) + C.TYPES[t].name; document.body.appendChild(drag.ghost);
        }
        if (drag.ghost) { drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px'; }
      });
      b.addEventListener('pointerup', function (e) {
        if (!drag) return; var d = drag; drag = null;
        if (!d.ghost) return;
        d.ghost.remove(); b.dataset.dragged = '1';
        var r = $('canvas').getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) addBox(t, canvas.toWorld(e.clientX, e.clientY));
      });
      b.addEventListener('pointercancel', function () { if (drag && drag.ghost) drag.ghost.remove(); drag = null; });
      b.addEventListener('click', function () { if (b.dataset.dragged) { delete b.dataset.dragged; return; } addBox(t); });
    });
  }

  function bind() {
    document.querySelectorAll('#modes button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
    document.querySelectorAll('#ptabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
    document.querySelectorAll('[data-cmd]').forEach(function (b) { b.addEventListener('click', function () { cmd(b.getAttribute('data-cmd')); }); });
    document.querySelectorAll('#menu [data-panel]').forEach(function (b) { b.addEventListener('click', function () { closeMenus(); openSheet(b.getAttribute('data-panel')); }); });
    $('btn-new').addEventListener('click', CMDS['new']);
    $('btn-del-doc').addEventListener('click', delDraw);
    $('doc-select').addEventListener('change', function () { saveNow(); loadDraw($('doc-select').value); Store.setCur(S.docId); fillDocSelect(); refresh(); canvas.fit(); });
    $('btn-connect').addEventListener('click', toggleConnect); $('mb-connect').addEventListener('click', toggleConnect);
    $('btn-undo').addEventListener('click', undo); $('mb-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);
    $('btn-del').addEventListener('click', delSel); $('mb-del').addEventListener('click', delSel);
    $('btn-fit').addEventListener('click', function () { canvas.fit(); });
    $('btn-zoom-in').addEventListener('click', function () { canvas.zoomBy(1.25); });
    $('btn-zoom-out').addEventListener('click', function () { canvas.zoomBy(0.8); });
    $('mb-props').addEventListener('click', function () { openSheet('props'); });
    $('mb-add').addEventListener('click', function (e) { e.stopPropagation(); var dd = $('mb-add-dd'), o = dd.classList.contains('open'); closeMenus(); if (!o) dd.classList.add('open'); });
    $('btn-file').addEventListener('click', function (e) { e.stopPropagation(); var dd = $('grp-file'), o = dd.classList.contains('open'); closeMenus(); if (!o) dd.classList.add('open'); });
    $('menu-btn').addEventListener('click', function (e) { e.stopPropagation(); var o = $('menu').hidden; closeMenus(); $('menu').hidden = !o; $('menu-btn').setAttribute('aria-expanded', o ? 'true' : 'false'); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.dd') && !e.target.closest('#menu') && !e.target.closest('#menu-btn')) closeMenus(); });
    $('panel-close').addEventListener('click', closeSheet);
    $('file-open').addEventListener('change', function () { var f = $('file-open').files[0]; if (f) openFile(f); });
    $('bigscreen').addEventListener('change', function () { document.body.classList.toggle('bigscreen', $('bigscreen').checked); setTimeout(function () { canvas.fit(); }, 50); });
    $('help-btn').addEventListener('click', function () { showHelp(true); });
    $('help-close').addEventListener('click', function () { showHelp(false); });
    $('exit-btn').addEventListener('click', exitApp);
    $('rot-ok').addEventListener('click', function () { $('rotate-hint').hidden = true; S.rotOk = true; });

    document.addEventListener('keydown', function (e) {
      var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Escape') { if (!$('help').hidden) return showHelp(false); closeMenus(); if (S.connect.on) setConnect({ on: false, from: null }); else if (!typing) select(null); if (typing) t.blur(); return; }
      if (typing || !$('help').hidden) return;
      var k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (ctrl) return;
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); delSel(); return; }
      if (k === '1') return setMode('watch'); if (k === '2') return setMode('draw'); if (k === '3') return setMode('practice');
      if (k === 'h') return showHelp(true);
      if (k === 'f') return canvas.fit();
      if (k === 'l') return toggleConnect();
      if (k === 'b') { $('bigscreen').checked = !$('bigscreen').checked; $('bigscreen').dispatchEvent(new Event('change')); return; }
      if (k === ' ' && S.mode === 'watch' && root.ABB.Watch) { e.preventDefault(); root.ABB.Watch.toggle(); return; }
      if (k.indexOf('arrow') === 0 && S.sel && S.sel.kind === 'node' && !readOnly()) {
        e.preventDefault();
        var step = e.shiftKey ? 32 : C.GRID, dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0, id = S.sel.id;
        edit(function (d) { M.moveBy(d, id, dx, dy); M.fitStages(d); }, 'move.' + id);
      }
    });
    function rot() {
      var land = root.innerWidth > root.innerHeight && root.innerHeight < 500 && root.matchMedia('(pointer: coarse)').matches;
      $('rotate-hint').hidden = !land || !!S.rotOk;
    }
    root.addEventListener('resize', rot); rot();
    root.addEventListener('beforeunload', saveNow);
  }

  function footer() {
    var c = root.CREDITS || {}, f = $('foot');
    f.innerHTML = '';
    f.appendChild(P.el('span', { text: '作者 ' + c.AUTHOR + '（' + c.AUTHOR_EMAIL + '）· ' + c.UNIVERSITY_EN + ' · ' + c.UNIVERSITY_KO + ' · 代码 MIT · 文档与教学素材 CC BY 4.0 · ' + c.SERIES_NAME_ZH + ' / ' + c.SERIES_NAME_EN + ' 系列 · 示例中的公司与数字均为虚构 · ' }));
    f.appendChild(P.el('a', { href: 'https://shuyaogao.github.io/', text: '← 返回 AI 教学演示总导览' }));
  }

  // ---------------- 启动 ----------------
  function init() {
    buildAddButtons(); P.legend($('help-legend')); footer(); bind();
    loadDraw(Store.getCur());
    if (root.ABB.Watch) root.ABB.Watch.init({ S: S, canvas: canvas, refresh: refresh, setTab: setTab, toast: toast, locate: locate, cur: cur, isPhone: isPhone, openSheet: openSheet, closeSheet: closeSheet, helpOpen: function () { return !$('help').hidden; } });
    if (root.ABB.Practice) root.ABB.Practice.init({ S: S, toast: toast, refresh: refreshPanel, cur: cur, setTab: setTab, canvas: function () { return canvas; } });
    var m = params.mode || (root.ABB.Watch ? 'watch' : 'draw');
    if (['watch', 'draw', 'practice'].indexOf(m) < 0) m = 'draw';
    var firstVisit = !Store.get('abb.helpSeen') && !params.selftest && !params.nohelp;
    if (firstVisit) $('help').hidden = false;
    setMode(m);
    if (params.selftest && root.ABB.Selftest) root.ABB.Selftest.run({ S: S, canvas: canvas, setMode: setMode, addBox: addBox, commit: commit, cmd: cmd, undo: undo, redo: redo, select: select, cur: cur, locate: locate, setTab: setTab });
  }
  root.ABB.App = { S: S, cur: cur, setMode: setMode, addBox: addBox, commit: commit, cmd: cmd, undo: undo, redo: redo, select: select, locate: locate, setTab: setTab, canvas: function () { return canvas; }, toast: toast, toggleConnect: toggleConnect, openSheet: openSheet, closeSheet: closeSheet, saveNow: saveNow, newDraw: newDraw };
  init();
})(window);
