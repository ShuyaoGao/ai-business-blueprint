/* 页面外壳：三个模式、节点库、工具条、右栏、撤销重做、运行、自动保存、文件、键盘、手机菜单、说明、退出、自检。 */
(function (root) {
  'use strict';
  var C = root.ABB.Config, M = root.ABB.Model, Store = root.ABB.Store, P = root.ABB.Panels, E = root.ABB.Engine, ML = root.ABB.ML, DS = root.ABB.Datasets;
  function $(id) { return document.getElementById(id); }
  function A() { return root.ABB.Analysis; }

  var params = {}; location.search.replace(/[?&]([^=&]+)=?([^&]*)/g, function (_, k, v) { params[k] = decodeURIComponent(v); });

  var S = {
    mode: 'draw', docs: { draw: null, practice: null }, docId: null,
    hist: { draw: new M.History(100), practice: new M.History(100) },
    sel: null, connect: { on: false, from: null }, tab: 'props',
    lastEditKey: null, lastEditT: 0, flash: null, saveT: 0, exited: false,
    run: null, runT: 0, csvCache: {}
  };
  root.ABB.S = S;

  function cur() { return S.mode === 'watch' && root.ABB.Watch ? root.ABB.Watch.doc() : S.docs[S.mode]; }
  function readOnly() { return S.mode === 'watch'; }
  function isPhone() { return root.matchMedia && root.matchMedia('(max-width: 900px)').matches; }

  // ---------------- 提示 ----------------
  var toastT = 0;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600);
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
    fn(cur()); M.fitStages(cur()); save(); canvas.draw(); updateButtons(); autoRun(600);
    if (key === 'doc.title') fillDocSelect();
    if (root.ABB.Practice && S.mode === 'practice') root.ABB.Practice.check(cur());
  }
  function changed(msg) {
    var d = cur();
    if (S.sel && !(S.sel.kind === 'node' ? M.get(d, S.sel.id) : M.getEdge(d, S.sel.id))) S.sel = null;
    save(); refresh(); if (msg) toast(msg); autoRun(250);
  }
  function refresh() {
    canvas.draw(); refreshPanel(); updateButtons();
    if (root.ABB.Practice && S.mode === 'practice') root.ABB.Practice.check(cur());
  }
  function save() { clearTimeout(S.saveT); S.saveT = setTimeout(saveNow, 300); }
  function saveNow() {
    clearTimeout(S.saveT);
    if (S.docs.draw && S.docId) { if (!Store.save(S.docId, S.docs.draw) && !S.warnedFull) { S.warnedFull = true; toast('浏览器存储满了：请「下载 .json」备份，或删掉几份不用的蓝图'); } Store.setCur(S.docId); }
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

  // ---------------- 运行 ----------------
  /** 运行整张图。新训练出的模型存进模型节点（不进撤销记录）。manual = 用户点了「运行」。 */
  function runNow(manual) {
    clearTimeout(S.runT);
    var doc = cur(), r;
    try { r = E.run(doc, { cache: S.csvCache }); } catch (err) { toast('运行出错：' + (err.message || err)); return null; }
    var stamp = new Date(), ts = stamp.getFullYear() + '-' + ('0' + (stamp.getMonth() + 1)).slice(-2) + '-' + ('0' + stamp.getDate()).slice(-2) + ' ' + ('0' + stamp.getHours()).slice(-2) + ':' + ('0' + stamp.getMinutes()).slice(-2);
    Object.keys(r.trained).forEach(function (id) { var n = M.get(doc, id); if (n && !n.locked) { n.trained = r.trained[id]; n.trainedAt = ts; } });
    if (S.mode === 'watch' && root.ABB.Watch) root.ABB.Watch.applyTrained(r.trained, ts);
    S.run = r; S.runKey = runKey();
    if (!readOnly()) save();
    if (manual) {
      if (!isPhone()) S.tab = 'run';
      var c = r.counts, skip = c.skip ? '，' + c.skip + ' 个跳过（模型已锁定）' : '';
      toast(r.errors ? '运行完：' + r.errors + ' 个节点出错，点它看原因' : '运行完：' + (c.ok || 0) + ' 个节点算出了结果' + skip + '（' + r.ms + ' 毫秒）');
      var anyLocked = doc.nodes.some(function (n) { return n.type === 'model' && n.locked; });
      note(anyLocked && c.skip ? 'runlocked' : 'run');
    }
    canvas.draw(); refreshPanel(); updateButtons();
    return r;
  }
  /** 改动后自动重算（只在运行过、而且算得快的时候）。 */
  /** 运行结果属于哪张图：撤销 / 重做会换一个新对象，但还是同一张图。 */
  function runKey() { return S.mode === 'draw' ? 'draw:' + S.docId : S.mode; }
  function autoRun(ms) {
    if (!S.run || S.runKey !== runKey() || S.run.ms > 600) { if (S.run && S.runKey === runKey()) S.run.stale = true; refreshRunBtn(); return; }
    clearTimeout(S.runT); S.runT = setTimeout(function () { runNow(false); }, ms || 300);
  }
  function runResult() { return S.run && S.runKey === runKey() ? S.run : null; }
  function refreshRunBtn() { var r = runResult(); $('btn-run').classList.toggle('stale', !!(r && r.stale)); }

  // ---------------- 选择、连线 ----------------
  function select(sel) {
    S.sel = sel;
    if (sel && S.tab !== 'props' && S.tab !== 'run' && !isPhone()) S.tab = 'props';
    refreshPanel(); updateButtons(); canvas.draw();
  }
  function setConnect(c) {
    S.connect = c;
    var hint = $('connect-hint');
    if (c.on) { hint.hidden = false; hint.textContent = c.from ? '再点要接到的节点（点空白处取消）' : '连线：先点起点节点，再点终点节点（会自动挑口）'; }
    else hint.hidden = true;
    $('btn-connect').classList.toggle('on', c.on); $('mb-connect').classList.toggle('on', c.on);
    canvas.draw();
  }
  function toggleConnect() {
    if (readOnly()) return;
    if (S.connect.on) return setConnect({ on: false, from: null });
    var s = S.sel && S.sel.kind === 'node' && M.get(cur(), S.sel.id);
    setConnect({ on: true, from: s && s.type !== 'stage' ? s.id : null });
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

  // ---------------- 加节点、删除 ----------------
  function snapV(v) { return $('ck-snap').checked ? Math.round(v / C.GRID) * C.GRID : Math.round(v); }
  function overlaps(d, r, skip) {
    return d.nodes.some(function (o) { if (o.id === skip || o.type === 'stage' || M.isHidden(d, o.id)) return false; var q = M.rectOf(o); return r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y; });
  }
  function afterAdd(id, msg) {
    S.sel = { kind: 'node', id: id };
    toast(msg); refresh();
    var n = M.get(cur(), id); if (!n) return;
    var r = M.rectOf(n), s = canvas.size(), v = canvas.view, sx = r.x * v.k + v.tx, sy = r.y * v.k + v.ty;
    if (sx < 0 || sy < 0 || sx + r.w * v.k > s.w || sy + r.h * v.k > s.h) canvas.reveal(id);
    note('add');
  }
  /** 加一个节点。worldPt 给定 = 拖到画布上的位置（落在线上就插进线中间，落在环节里就归进环节）。
   *  没给位置时：选中了节点就接在它后面（能接的话），否则放在画布中间。 */
  function addNode(type, worldPt, opts) {
    if (readOnly()) return toast('观看模式不能改；切到「我来画」');
    opts = opts || {};
    var newId = null, msg = '加了一个「' + C.KINDS[type].name + '」';
    var selN = S.sel && S.sel.kind === 'node' && M.get(cur(), S.sel.id);
    commit(function (d) {
      if (worldPt) {
        var e = type !== 'stage' && !opts.from && canvas.edgeAt(worldPt.x, worldPt.y);
        if (e) {
          var ins = M.insertOnEdge(d, e.id, type);
          if (!ins.err) { newId = ins.node.id; msg += '，插在了线中间'; return; }
        }
        var n = M.addNode(d, type, 0, 0); newId = n.id;
        var r = M.rectOf(n); M.moveTo(d, n.id, snapV(worldPt.x - (opts.from ? 0 : r.w / 2)), snapV(worldPt.y - (opts.from ? 40 : r.h / 2)));
        if (opts.from) { var cr = M.connect(d, opts.from, n.id, opts.fp); if (cr.err) msg += '（' + cr.err + '）'; else msg += '，已经接上'; var fN = M.get(d, opts.from); if (fN.parent) n.parent = fN.parent; }
        else { var ex = {}; ex[n.id] = 1; var st = canvas.hitStage(worldPt.x, worldPt.y, ex); if (st && type !== 'stage') { n.parent = st.id; st.collapsed = false; msg += '，归进「' + st.name + '」'; } }
        return;
      }
      if (type === 'stage') {
        var m = M.addNode(d, 'stage', 0, 0); newId = m.id;
        var b = M.bounds(d); var c0 = canvas.center();
        M.moveTo(d, m.id, snapV(b && d.nodes.length > 1 ? b.x : c0.x - 130), snapV(b && d.nodes.length > 1 ? b.y + b.h + 60 : c0.y - 80));
        return;
      }
      if (selN && selN.type !== 'stage') {
        var near = M.addNear(d, selN.id, type, false);
        if (!near.err) { newId = near.node.id; msg += '，接在「' + selN.name + '」后面'; return; }
      }
      var n2 = M.addNode(d, type, 0, 0); newId = n2.id;
      if (selN && selN.type === 'stage') { M.placeInside(d, selN.id, n2); msg += '，放在「' + selN.name + '」里'; return; }
      var c = canvas.center(), r2 = M.rectOf(n2), x = snapV(c.x - r2.w / 2), y = snapV(c.y - r2.h / 2), i = 0;
      while (i++ < 30 && overlaps(d, { x: x, y: y, w: r2.w, h: r2.h }, n2.id)) { x += 24; y += 24; }
      M.moveTo(d, n2.id, x, y);
    }, null);
    if (newId) afterAdd(newId, msg);
    return newId;
  }
  function addNear(id, type, before) {
    var newId = null, err = null;
    commit(function (d) { var r = M.addNear(d, id, type, before); if (r.err) { err = r.err; throw new Error(r.err); } newId = r.node.id; }, null);
    if (newId) afterAdd(newId, '加了「' + C.KINDS[type].name + '」，已经接' + (before ? '在前面' : '在后面'));
  }
  function insertOn(edgeId, type) {
    var newId = null;
    commit(function (d) { var r = M.insertOnEdge(d, edgeId, type); if (r.err) throw new Error(r.err); newId = r.node.id; }, null);
    if (newId) afterAdd(newId, '在线中间插了「' + C.KINDS[type].name + '」');
  }
  function delSel() {
    if (readOnly() || !S.sel) return;
    var s = S.sel;
    commit(function (d) { if (s.kind === 'node') M.removeNode(d, s.id); else M.removeEdge(d, s.id); }, s.kind === 'node' ? '删除了节点（可撤销）' : '删除了连线');
    S.sel = null; refresh();
  }
  function toggleStage(id) {
    var n = M.get(cur(), id); if (!n) return;
    if (readOnly()) { n.collapsed = !n.collapsed; refresh(); return; }
    commit(function (d) { var m = M.get(d, id); m.collapsed = !m.collapsed; }, n.collapsed ? '展开了「' + n.name + '」' : '折叠了「' + n.name + '」');
  }

  // ---------------- 快速添加：拖线到空白处 / 双击空白处 ----------------
  function quickAdd(o) {
    if (readOnly()) return;
    var box = $('quick'), list = C.KIND_ORDER.concat(['stage']), doc = cur();
    if (o.from) list = list.filter(function (k) { if (k === 'stage') return false; var probe = M.clone(doc), n = M.addNode(probe, k, 0, 0); return !!M.pickPorts(probe, o.from, n.id, o.fp); });
    if (!list.length) { toast('这个口后面接不了别的节点'); return; }
    box.innerHTML = '';
    box.appendChild(P.el('p', { class: 'qhead', text: o.from ? '接一个什么节点？' : '在这里加一个节点' }));
    C.GROUPS.concat([{ id: 'frame', name: '分组' }]).forEach(function (g) {
      var ks = list.filter(function (k) { return C.KINDS[k].group === g.id; }); if (!ks.length) return;
      box.appendChild(P.el('p', { class: 'qgrp', text: g.name }));
      box.appendChild(P.kindButtons(ks, function (k) { closeQuick(); addNode(k, o.world, { from: o.from, fp: o.fp }); }));
    });
    box.hidden = false;
    var W = root.innerWidth, H = root.innerHeight, r = box.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(W - r.width - 8, o.client.x + 8)) + 'px';
    box.style.top = Math.max(8, Math.min(H - r.height - 8, o.client.y + 8)) + 'px';
  }
  function closeQuick() { $('quick').hidden = true; }

  // ---------------- 数据和模型文件 ----------------
  function pickFile(accept, cb) {
    var inp = $('file-any'); inp.value = ''; inp.accept = accept;
    inp.onchange = function () { var f = inp.files[0]; if (!f) return; var fr = new FileReader(); fr.onload = function () { cb(String(fr.result), f); }; fr.onerror = function () { toast('读取文件失败'); }; fr.readAsText(f, 'utf-8'); };
    inp.click();
  }
  function setData(id, csv, name, msg) {
    var ds;
    try { ds = ML.parseCSV(csv); } catch (e) { return toast('打不开：' + e.message); }
    if (csv.length > 1500000) return toast('文件太大（超过 1.5MB）：浏览器里演示请先抽样一部分行');
    commit(function (d) {
      var n = M.get(d, id); n.csv = csv; n.csvName = name; if (!n.cols) n.cols = ds.cols.join('、');
      if (n.type === 'src' && n.labeled && (!n.target || ds.cols.indexOf(n.target) < 0)) n.target = ds.cols[ds.cols.length - 1];
    }, msg || ('导入了 ' + name + '：' + ds.rows.length + ' 行 × ' + ds.cols.length + ' 列'));
    note('data'); runNow(false);
  }
  function importCSV(id) { pickFile('.csv,text/csv,text/plain', function (txt, f) { setData(id, txt, f.name); }); }
  function useDataset(id, key) { var d = DS.LIST[key]; setData(id, DS.get(key), d.name + '.csv', '用上了示例数据「' + d.name + '」（虚构）'); }
  function clearData(id) { commit(function (d) { var n = M.get(d, id); n.csv = ''; n.csvName = ''; }, '清掉了数据（只画图）'); }
  function lockModel(id, on) {
    commit(function (d) { var n = M.get(d, id); if (on && !n.trained) throw new Error('还没训练，先运行一次'); n.locked = on; }, on ? '模型锁定了：以后运行只预测，不重新训练' : '解锁了：下次运行会重新训练');
    if (on) note('lock');
  }
  function downloadModel(id) {
    var n = M.get(cur(), id); if (!n || !n.trained) return;
    var blob = new Blob([JSON.stringify({ format: 'ai-business-blueprint-model', name: n.name, version: n.version, trainedAt: n.trainedAt, model: n.trained })], { type: 'application/json' });
    download(blob, safe(n.name + '_' + (n.version || 'v1')) + '.model.json'); toast('模型下载好了：别的蓝图里用「导入模型」就能接着用');
  }
  function importModel(id) {
    pickFile('.json,application/json', function (txt, f) {
      var o; try { o = JSON.parse(txt); } catch (e) { return toast('不是有效的 JSON'); }
      var m = o && o.model; if (!m || typeof m.algo !== 'string' || !ML.ALGO_NAMES[m.algo] || !m.enc) return toast('这不是画板导出的模型文件');
      commit(function (d) { var n = M.get(d, id); n.trained = m; n.trainedAt = o.trainedAt || ''; n.version = o.version || n.version; n.locked = true; }, '导入了模型 ' + f.name + '，已锁定');
      runNow(false);
    });
  }
  function downloadCSV(ds, name) { download(new Blob(['﻿' + ML.toCSV(ds)], { type: 'text/csv;charset=utf-8' }), safe(name) + '.csv'); toast('已下载（Excel 可以直接打开）'); }
  /** 某个节点的输入口（pid）上有哪些列，或者节点自己（'self'）输出了哪些列。从最近一次运行结果里拿。 */
  function cols(id, pid) {
    var r = runResult(); if (!r) return null;
    if (pid === 'self') { var me = r.nodes[id]; return me && me.ds ? me.ds.cols : null; }
    var e = M.feed(cur(), id, pid) || M.edgesInto(cur(), id)[0]; if (!e) return null;
    var up = r.nodes[e.from], v = up && up.outs && up.outs[e.fp];
    return v && v.ds ? v.ds.cols : null;
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
    S.docId = id; S.docs.draw = d; S.hist.draw.clear(); S.sel = null; S.run = null;
  }
  function newDraw(doc, msg) {
    saveNow();
    S.docId = Store.newId(); S.docs.draw = doc || M.create('我的业务蓝图 ' + (Store.list().length + 1));
    S.hist.draw.clear(); S.sel = null; S.run = null;
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
  function safe(s) { return String(s || '蓝图').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60); }
  function fname(ext) { return safe(cur().title) + ext; }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function openFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var d;
      try { d = M.parse(String(fr.result)); } catch (e) { return toast('打不开：' + e.message); }
      if (S.mode === 'practice') { pushHist(); S.docs.practice = d; S.sel = null; S.run = null; changed('已打开 ' + file.name); canvas.fit(); }
      else newDraw(d, '已打开 ' + file.name + '（存成了一份新蓝图）');
    };
    fr.onerror = function () { toast('读取文件失败'); };
    fr.readAsText(file, 'utf-8');
  }
  function visibleNow() { return S.mode === 'watch' && root.ABB.Watch ? root.ABB.Watch.extra().visible || null : null; }
  function extraFor(doc) { var r = runResult(); return { risks: A().risks(doc, visibleNow()).map, visible: visibleNow(), run: r ? r.nodes : null }; }
  var CMDS = {
    'new': function () { newDraw(null, '新建了一份空白蓝图'); },
    'open': function () { if (readOnly()) return; $('file-open').value = ''; $('file-open').click(); },
    'save-json': function () { download(new Blob([M.serialize(cur())], { type: 'application/json' }), fname('.json')); toast('已下载 ' + fname('.json')); },
    'png': function () {
      canvas.exportPNG(cur(), extraFor(cur()), function (blob, cv, svg) {
        if (blob) { download(blob, fname('.png')); toast('已导出 PNG（' + cv.width + '×' + cv.height + '）'); }
        else { download(new Blob([svg], { type: 'image/svg+xml' }), fname('.svg')); toast('这个浏览器不允许导出 PNG，改成导出了 SVG'); }
      });
    },
    'md': function () {
      var md = A().markdown(cur(), visibleNow(), runResult());
      download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), fname('.md')); toast('已导出 Markdown 清单'); note('markdown');
    },
    'copy-sample': function () {
      var d = root.ABB.Watch ? root.ABB.Watch.fullDoc() : M.clone(cur()); d.title = d.title.replace(/（虚构示例）/, '') + '（虚构示例副本）';
      newDraw(d, '示例已复制到「我来画」，可以随便改了');
    },
    'run': function () { runNow(true); },
    'fit': function () { canvas.fit(); },
    'delete': delSel,
    'palette': function () { document.body.classList.add('pal-open'); },
    'help': function () { showHelp(true); },
    'exit': exitApp
  };
  function cmd(name) { closeMenus(); if (CMDS[name]) CMDS[name](); }
  function note(ev) { if (root.ABB.Practice && S.mode === 'practice') root.ABB.Practice.note(ev); }

  // ---------------- 右栏 ----------------
  function refreshPanel() {
    var body = $('panel-body'); if (!body) return;
    var active = document.activeElement, keep = active && body.contains(active) && active.getAttribute('data-key');
    var scroll = body.scrollTop, sameTab = body.getAttribute('data-tab') === S.tab;
    body.innerHTML = ''; body.setAttribute('data-tab', S.tab);
    document.querySelectorAll('#ptabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === S.tab); });
    var t = S.tab;
    if (t === 'tasks' && root.ABB.Practice) root.ABB.Practice.panel(body);
    else if (P[t]) P[t](body);
    else P.props(body);
    if (keep) { var f = body.querySelector('[data-key="' + keep + '"]'); if (f && f.focus) f.focus(); }
    if (sameTab) body.scrollTop = scroll;
    var rb = $('risk-badge'), rk = A().risks(cur(), visibleNow()), red = rk.red + A().checks(cur(), visibleNow()).filter(function (c) { return c.level === 'red'; }).length;
    rb.textContent = red ? red : ''; rb.className = red ? 'badge red' : '';
    var r = runResult(), eb = $('run-badge');
    eb.textContent = r && r.errors ? r.errors : r ? '✓' : ''; eb.className = r ? 'badge ' + (r.errors ? 'red' : 'ok') : '';
    refreshRunBtn();
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
    if (S.mode === 'watch' && m !== 'watch' && root.ABB.Watch) root.ABB.Watch.leave();
    saveNow(); closeQuick();
    S.mode = m; S.sel = null; S.run = null; setConnect({ on: false, from: null });
    document.body.classList.remove('m-watch', 'm-draw', 'm-practice', 'pal-open'); document.body.classList.add('m-' + m);
    document.querySelectorAll('#modes button').forEach(function (b) { var on = b.getAttribute('data-mode') === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    if (m === 'practice') {
      if (!S.docs.practice) { var raw = Store.get('abb.practice'); try { S.docs.practice = raw ? M.parse(raw) : null; } catch (e) { S.docs.practice = null; } }
      if (!S.docs.practice) S.docs.practice = M.create('练习：拆一项业务');
      S.tab = 'tasks';
      root.ABB.Practice.enter(cur());
    } else if (m === 'watch') { S.tab = 'props'; root.ABB.Watch.enter(); }
    else { S.tab = 'props'; fillDocSelect(); }
    closeSheet();
    refresh(); if (m !== 'watch') canvas.fit();
    try { history.replaceState(null, '', location.pathname + (m === 'watch' ? '' : '?mode=' + m) + location.hash); } catch (e) { /* file:// 下可能不允许 */ }
  }

  // ---------------- 说明、退出、菜单 ----------------
  function showHelp(on) {
    $('help').hidden = !on;
    if (!on) { Store.set('abb.helpSeen', '2'); if (root.ABB.Watch && S.mode === 'watch') root.ABB.Watch.autoStart(); }
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
      var d = cur(), w = S.mode === 'watch' && root.ABB.Watch ? root.ABB.Watch.extra() : {}, r = runResult();
      return { risks: A().risks(d, w.visible || null).map, visible: w.visible || null, pop: w.pop || null, flash: S.flash || w.flash || null, run: r ? r.nodes : null };
    },
    onOpen: function () {
      if (isPhone()) return openSheet('props');
      var f = $('panel-body').querySelector('[data-key="name"]'); if (f && !f.disabled) { f.focus(); f.select(); }
    },
    onEdge: function () { note('edge'); },
    onToggle: toggleStage, toast: toast, quickAdd: quickAdd
  };
  var canvas = new root.ABB.Canvas($('stage-wrap'), $('canvas'), host);
  canvas.onDraw = function () { $('zoom-badge').textContent = Math.round(canvas.view.k * 100) + '%'; };

  P.host = {
    doc: cur, readOnly: readOnly, sel: function () { return S.sel; }, select: function (s) { select(s); if (s) canvas.reveal(s.kind === 'node' ? s.id : M.getEdge(cur(), s.id).from); },
    edit: edit, commit: commit, locate: locate, visible: visibleNow, cmd: cmd, toggle: toggleStage, toast: toast, mode: function () { return S.mode; },
    run: runResult, runNow: runNow, addNear: addNear, insertOn: insertOn, importCSV: importCSV, useDataset: useDataset, clearData: clearData,
    lockModel: lockModel, downloadModel: downloadModel, importModel: importModel, downloadCSV: downloadCSV, cols: cols
  };

  // ---------------- 节点库 ----------------
  function buildPalette() {
    var pal = $('palette-list');
    C.GROUPS.concat([{ id: 'frame', name: '分组', tip: '把节点归到业务环节里' }]).forEach(function (g) {
      var kinds = C.KIND_ORDER.concat(['stage']).filter(function (k) { return C.KINDS[k].group === g.id; });
      pal.appendChild(P.el('p', { class: 'pgrp g-' + g.id, title: g.tip, text: g.name }));
      kinds.forEach(function (k) {
        var b = P.el('button', { type: 'button', class: 'pitem g-' + g.id, 'data-add': k, title: C.KINDS[k].tip + '\n点一下：接在选中节点后面（或放在画布中间）；也可以拖到画布上、拖到线上插进去。', html: P.iconSvg(k, 20) + '<span>' + R().esc(C.KINDS[k].name) + '</span>' });
        pal.appendChild(b);
        var drag = null;
        b.addEventListener('pointerdown', function (e) { if (e.button || readOnly()) return; drag = { x: e.clientX, y: e.clientY, ghost: null }; try { b.setPointerCapture(e.pointerId); } catch (err) { /* */ } });
        b.addEventListener('pointermove', function (e) {
          if (!drag) return;
          if (!drag.ghost && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 8) {
            drag.ghost = P.el('div', { class: 'drag-ghost g-' + g.id, html: P.iconSvg(k, 18) + R().esc(C.KINDS[k].name) }); document.body.appendChild(drag.ghost);
            document.body.classList.remove('pal-open');
          }
          if (drag.ghost) {
            drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
            var ok = canvas.inside(e.clientX, e.clientY), w = canvas.toWorld(e.clientX, e.clientY), ed = ok && k !== 'stage' ? canvas.edgeAt(w.x, w.y) : null;
            var id = ed ? ed.id : null; if (id !== canvas.dropEdge) { canvas.dropEdge = id; canvas.draw(); }
          }
        });
        b.addEventListener('pointerup', function (e) {
          if (!drag) return; var d = drag; drag = null;
          canvas.dropEdge = null;
          if (!d.ghost) return;
          d.ghost.remove(); b.dataset.dragged = '1';
          if (canvas.inside(e.clientX, e.clientY)) addNode(k, canvas.toWorld(e.clientX, e.clientY)); else canvas.draw();
        });
        b.addEventListener('pointercancel', function () { if (drag && drag.ghost) drag.ghost.remove(); drag = null; canvas.dropEdge = null; canvas.draw(); });
        b.addEventListener('click', function () { if (b.dataset.dragged) { delete b.dataset.dragged; return; } document.body.classList.remove('pal-open'); addNode(k); });
      });
    });
  }
  function R() { return root.ABB.Render; }

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
    $('mb-run').addEventListener('click', function () { runNow(true); openSheet('run'); });
    $('mb-add').addEventListener('click', function () { document.body.classList.add('pal-open'); });
    $('pal-close').addEventListener('click', function () { document.body.classList.remove('pal-open'); });
    $('btn-file').addEventListener('click', function (e) { e.stopPropagation(); var dd = $('grp-file'), o = dd.classList.contains('open'); closeMenus(); if (!o) dd.classList.add('open'); });
    $('menu-btn').addEventListener('click', function (e) { e.stopPropagation(); var o = $('menu').hidden; closeMenus(); $('menu').hidden = !o; $('menu-btn').setAttribute('aria-expanded', o ? 'true' : 'false'); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.dd') && !e.target.closest('#menu') && !e.target.closest('#menu-btn')) closeMenus(); });
    document.addEventListener('pointerdown', function (e) { if (!$('quick').hidden && !e.target.closest('#quick')) closeQuick(); }, true);
    $('panel-close').addEventListener('click', closeSheet);
    $('file-open').addEventListener('change', function () { var f = $('file-open').files[0]; if (f) openFile(f); });
    $('bigscreen').addEventListener('change', function () { document.body.classList.toggle('bigscreen', $('bigscreen').checked); setTimeout(function () { canvas.fit(); }, 50); });
    $('help-btn').addEventListener('click', function () { showHelp(true); });
    $('help-close').addEventListener('click', function () { showHelp(false); });
    $('exit-btn').addEventListener('click', exitApp);
    $('rot-ok').addEventListener('click', function () { $('rotate-hint').hidden = true; S.rotOk = true; });

    document.addEventListener('keydown', function (e) {
      var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Escape') {
        if (!$('help').hidden) return showHelp(false);
        if (!$('quick').hidden) return closeQuick();
        closeMenus(); document.body.classList.remove('pal-open');
        if (S.connect.on) setConnect({ on: false, from: null }); else if (!typing) select(null);
        if (typing) t.blur(); return;
      }
      if (typing || !$('help').hidden) return;
      var k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (ctrl && k === 'enter') { e.preventDefault(); runNow(true); return; }
      if (ctrl) return;
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); delSel(); return; }
      if (k === '1') return setMode('watch'); if (k === '2') return setMode('draw'); if (k === '3') return setMode('practice');
      if (k === 'h') return showHelp(true);
      if (k === 'f') return canvas.fit();
      if (k === 'l') return toggleConnect();
      if (k === 'r') return runNow(true);
      if (k === 'b') { $('bigscreen').checked = !$('bigscreen').checked; $('bigscreen').dispatchEvent(new Event('change')); return; }
      if (k === ' ' && S.mode === 'watch' && root.ABB.Watch) { e.preventDefault(); root.ABB.Watch.toggle(); return; }
      if (k.indexOf('arrow') === 0 && S.sel && S.sel.kind === 'node' && !readOnly()) {
        e.preventDefault();
        var step = e.shiftKey ? 32 : C.GRID, dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0, id = S.sel.id;
        edit(function (d) { M.moveBy(d, id, dx, dy); }, 'move.' + id);
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
    f.appendChild(P.el('span', { text: '作者 ' + c.AUTHOR + '（' + c.AUTHOR_EMAIL + '）· ' + c.UNIVERSITY_EN + ' · ' + c.UNIVERSITY_KO + ' · 代码 MIT · 文档与教学素材 CC BY 4.0 · ' + c.SERIES_NAME_ZH + ' / ' + c.SERIES_NAME_EN + ' 系列 · 示例中的公司、数据与数字均为虚构 · ' }));
    f.appendChild(P.el('a', { href: 'https://shuyaogao.github.io/', text: '← 返回 AI 教学演示总导览' }));
  }

  // ---------------- 启动 ----------------
  function init() {
    buildPalette(); P.legend($('help-legend')); footer(); bind();
    $('app-tagline').textContent = C.TAGLINE;
    loadDraw(Store.getCur());
    root.ABB.Watch.init({ S: S, canvas: canvas, refresh: refresh, setTab: setTab, toast: toast, locate: locate, cur: cur, isPhone: isPhone, openSheet: openSheet, closeSheet: closeSheet, runNow: runNow, helpOpen: function () { return !$('help').hidden; } });
    root.ABB.Practice.init({ S: S, toast: toast, refresh: refreshPanel, cur: cur, setTab: setTab, canvas: function () { return canvas; } });
    var m = params.mode || 'watch';
    if (['watch', 'draw', 'practice'].indexOf(m) < 0) m = 'draw';
    var firstVisit = Store.get('abb.helpSeen') !== '2' && !params.selftest && !params.nohelp;
    if (firstVisit) $('help').hidden = false;
    setMode(m);
    if (params.selftest && root.ABB.Selftest) root.ABB.Selftest.run(root.ABB.App);
  }
  root.ABB.App = { S: S, cur: cur, setMode: setMode, addNode: addNode, addNear: addNear, insertOn: insertOn, commit: commit, cmd: cmd, undo: undo, redo: redo, select: select, locate: locate, setTab: setTab,
    canvas: function () { return canvas; }, toast: toast, toggleConnect: toggleConnect, openSheet: openSheet, closeSheet: closeSheet, saveNow: saveNow, newDraw: newDraw,
    runNow: runNow, runResult: runResult, useDataset: useDataset, lockModel: lockModel, quickAdd: quickAdd, closeQuick: closeQuick };
  init();
})(window);
