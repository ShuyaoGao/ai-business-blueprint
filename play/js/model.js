/* 节点图的数据模型：节点（带输入口 / 输出口，可放进业务环节）+ 连线（口对口）+ 撤销重做 + JSON 读写。纯函数，Node 可测。
 *
 * doc  = { format, version: 2, title, seq, nodes: [node], edges: [edge] }
 * node = { id, type: 节点种类（见 Config.KINDS）, parent: 环节 id 或 null, x, y（世界坐标，左上角）, w, h, name, desc, ...各种类自己的字段 }
 * edge = { id, from, fp: 输出口 id, to, tp: 输入口 id, label, masked: 已脱敏, fb: 反馈线（会形成回路，运行时不走它） }
 * 节点大小由口的数量决定（layout）；业务环节的位置和大小由里面的节点决定（fitStages）。
 */
(function (root) {
  'use strict';
  var C = root.ABB && root.ABB.Config;
  if (!C && typeof require === 'function') C = require('./config.js');

  var FORMAT = 'ai-business-blueprint', VERSION = 2;
  var COLLAPSED_W = 240, COLLAPSED_H = C.HEAD + 40, MIN_STAGE_W = 220;
  var K = C.KINDS, N = C.NODE;

  function create(title) { return { format: FORMAT, version: VERSION, title: title || '我的业务蓝图', seq: 0, nodes: [], edges: [] }; }
  function clone(doc) { return JSON.parse(JSON.stringify(doc)); }

  // 每类节点自己的字段和默认值
  var DEFAULTS = {
    stage: { name: '新环节', collapsed: false },
    src: { name: '数据源', form: 'table', labeled: true, target: '', cols: '', sys: '', loc: 'local', level: 'internal', csv: '', csvName: '' },
    newdata: { name: '新数据', form: 'table', labeled: false, target: '', cols: '', sys: '', loc: 'local', level: 'internal', csv: '', csvName: '' },
    clean: { name: '清洗', dropna: true, dedupe: true },
    feature: { name: '选字段', keep: '' },
    mask: { name: '脱敏', drop: '' },
    label: { name: '人工标注', role: '', target: '' },
    split: { name: '拆分训练 / 测试', ratio: 0.8, seed: 42 },
    join: { name: '合并' },
    train: { name: '训练模型', algo: '', target: '', k: 3, loc: 'local', value: '', effort: '' },
    model: { name: '模型', version: 'v1', loc: 'local', locked: false, trained: null, trainedAt: '' },
    evaluate: { name: '评估' },
    predict: { name: '预测', loc: 'local' },
    collect: { name: '回收真实结果', role: '', wait: '' },
    ai: { name: 'AI 服务', aiType: '', input: '', output: '', loc: 'public', value: '', effort: '' },
    human: { name: '人工步骤', role: '' },
    rule: { name: '规则判断', col: '', op: '>', val: '' },
    action: { name: '业务动作', role: '' },
    ext: { name: '外部系统', loc: 'public' },
    store: { name: '存档', loc: 'local', level: 'internal' }
  };
  var OPS = ['>', '>=', '<', '<=', '=', '!='];

  function defaults(type) {
    var d = DEFAULTS[type], o = {}; for (var k in d) o[k] = d[k]; o.desc = ''; return o;
  }

  function get(doc, id) { for (var i = 0; i < doc.nodes.length; i++) if (doc.nodes[i].id === id) return doc.nodes[i]; return null; }
  function getEdge(doc, id) { for (var i = 0; i < doc.edges.length; i++) if (doc.edges[i].id === id) return doc.edges[i]; return null; }
  function children(doc, id) { return doc.nodes.filter(function (n) { return n.parent === id; }); }
  function descendants(doc, id) {
    var out = [], stack = [id];
    while (stack.length) { var p = stack.pop(); doc.nodes.forEach(function (n) { if (n.parent === p) { out.push(n); stack.push(n.id); } }); }
    return out;
  }
  function isDescendant(doc, id, ancestorId) {
    var n = get(doc, id), guard = 0;
    while (n && n.parent && guard++ < 1000) { if (n.parent === ancestorId) return true; n = get(doc, n.parent); }
    return false;
  }
  function ancestors(doc, id) { var out = [], n = get(doc, id), g = 0; while (n && n.parent && g++ < 1000) { n = get(doc, n.parent); if (n) out.push(n); } return out; }
  function depth(doc, id) { return ancestors(doc, id).length; }
  /** 被折叠的祖先里最外层的那个；没有就是自己。 */
  function visibleId(doc, id) { var v = id; ancestors(doc, id).forEach(function (a) { if (a.collapsed) v = a.id; }); return v; }
  function isHidden(doc, id) { return visibleId(doc, id) !== id; }

  // ---------------- 口和排版 ----------------
  function copyPort(p) { return { id: p.id, name: p.name, type: p.type, req: !!p.req, multi: !!p.multi }; }
  /** 这个节点有哪些口（数据源的输出口类型跟着「形态」变，名字跟着「有没有标签」变）。 */
  function ports(n) {
    var k = K[n.type]; if (!k) return { ins: [], outs: [] };
    var ins = k.ins.map(copyPort), outs = k.outs.map(copyPort);
    if (n.type === 'src' || n.type === 'newdata') {
      var f = C.FORMS[n.form] || C.FORMS.table;
      outs[0].type = f.port;
      outs[0].name = f.port === 'table' ? (n.labeled && n.type === 'src' ? '有标签数据' : n.type === 'newdata' ? '新数据（无标签）' : '无标签数据') : f.name;
    }
    if (n.type === 'ai') {
      if (n.input) ins[0].name = n.input;
      if (n.output) outs[0].name = n.output;
    }
    if (n.type === 'human' && n.role) outs[0].name = n.role + '处理后';
    return { ins: ins, outs: outs };
  }
  function port(n, side, pid) { var ps = ports(n)[side]; for (var i = 0; i < ps.length; i++) if (ps[i].id === pid) return ps[i]; return null; }

  /** 节点的大小和每个口的位置（世界坐标）。 */
  function layout(n) {
    if (n.type === 'stage') { var r0 = rectOf(n); return { x: r0.x, y: r0.y, w: r0.w, h: r0.h, ins: [], outs: [] }; }
    var p = ports(n), rows = Math.max(p.ins.length, p.outs.length, 1), w = n.w || K[n.type].w;
    var top = n.y + N.HEAD + N.SUB + 2, h = N.HEAD + N.SUB + 2 + rows * N.ROW + N.FOOT;
    function put(list, x) { return list.map(function (q, i) { q.x = x; q.y = top + i * N.ROW + N.ROW / 2; return q; }); }
    return { x: n.x, y: n.y, w: w, h: h, ins: put(p.ins, n.x), outs: put(p.outs, n.x + w) };
  }
  function portPos(n, side, pid) {
    var L = layout(n), list = L[side];
    for (var i = 0; i < list.length; i++) if (list[i].id === pid) return list[i];
    return { x: side === 'ins' ? L.x : L.x + L.w, y: L.y + L.h / 2 };
  }

  /** 画在画布上的矩形（折叠的环节变小）。 */
  function rectOf(n) {
    if (n.type === 'stage') {
      if (n.collapsed) return { x: n.x, y: n.y, w: COLLAPSED_W, h: COLLAPSED_H };
      return { x: n.x, y: n.y, w: n.w, h: n.h };
    }
    var L = layout(n); return { x: L.x, y: L.y, w: L.w, h: L.h };
  }

  // ---------------- 增删改 ----------------
  function addNode(doc, type, x, y, props) {
    if (!K[type]) throw new Error('未知节点类型：' + type);
    var n = defaults(type);
    n.id = 'n' + (++doc.seq); n.type = type; n.parent = null;
    n.x = Math.round(x || 0); n.y = Math.round(y || 0); n.w = K[type].w; n.h = K[type].h || 0;
    if (props) for (var k in props) if (k !== 'id' && k !== 'type') n[k] = props[k];
    if (type !== 'stage') n.h = rectOf(n).h;
    doc.nodes.push(n);
    if (n.parent && !canParent(doc, n.id, n.parent)) n.parent = null;
    return n;
  }

  function moveBy(doc, id, dx, dy) {
    var n = get(doc, id); if (!n) return;
    [n].concat(descendants(doc, id)).forEach(function (m) { m.x = Math.round(m.x + dx); m.y = Math.round(m.y + dy); });
  }
  function moveTo(doc, id, x, y) { var n = get(doc, id); if (n) moveBy(doc, id, x - n.x, y - n.y); }

  function canParent(doc, id, parentId) {
    if (!parentId) return true;
    var p = get(doc, parentId);
    return !!p && p.type === 'stage' && parentId !== id && !isDescendant(doc, parentId, id);
  }
  function setParent(doc, id, parentId) {
    var n = get(doc, id); if (!n) return false;
    parentId = parentId || null;
    if (!canParent(doc, id, parentId)) return false;
    n.parent = parentId; return true;
  }

  /** 由内向外把每个有子节点的环节撑到刚好包住子节点。 */
  function fitStages(doc) {
    doc.nodes.forEach(function (n) { if (n.type !== 'stage') n.h = rectOf(n).h; });
    var stages = doc.nodes.filter(function (n) { return n.type === 'stage'; });
    stages.sort(function (a, b) { return depth(doc, b.id) - depth(doc, a.id); });
    stages.forEach(function (s) {
      var kids = children(doc, s.id);
      if (!kids.length || s.collapsed) return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      kids.forEach(function (k) { var r = rectOf(k); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
      s.x = x0 - C.PAD; s.y = y0 - C.HEAD - 12; s.w = Math.max(MIN_STAGE_W, x1 - x0 + 2 * C.PAD); s.h = y1 - s.y + C.PAD;
    });
  }

  /** 新节点放进环节里：排在现有子节点右边（节点图从左往右流）。 */
  function placeInside(doc, stageId, n) {
    var s = get(doc, stageId); if (!s) return;
    var kids = children(doc, stageId).filter(function (k) { return k.id !== n.id; });
    var x = s.x + C.PAD, y = s.y + C.HEAD + 12;
    if (kids.length) {
      var right = -Infinity, top = Infinity;
      kids.forEach(function (k) { var r = rectOf(k); right = Math.max(right, r.x + r.w); top = Math.min(top, r.y); });
      x = right + 56; y = top;
    }
    moveTo(doc, n.id, x, y); n.parent = stageId; s.collapsed = false;
    fitStages(doc);
  }

  /** 环节里的节点按连线顺序从左到右排整齐（同一层竖着排）。 */
  function arrange(doc, stageId) {
    var s = get(doc, stageId); if (!s) return;
    var kids = children(doc, stageId).filter(function (k) { return k.type !== 'stage'; });
    if (!kids.length) return;
    var ids = {}; kids.forEach(function (k) { ids[k.id] = 1; });
    var lv = {}; kids.forEach(function (k) { lv[k.id] = 0; });
    for (var it = 0; it < kids.length; it++) {
      doc.edges.forEach(function (e) { if (!e.fb && ids[e.from] && ids[e.to] && lv[e.to] < lv[e.from] + 1) lv[e.to] = lv[e.from] + 1; });
    }
    var cols = {}; kids.forEach(function (k) { (cols[lv[k.id]] = cols[lv[k.id]] || []).push(k); });
    var x = s.x + C.PAD, y0 = s.y + C.HEAD + 12;
    Object.keys(cols).map(Number).sort(function (a, b) { return a - b; }).forEach(function (c) {
      var y = y0, wmax = 0;
      cols[c].sort(function (a, b) { return a.y - b.y; }).forEach(function (k) { moveTo(doc, k.id, x, y); var r = rectOf(k); y += r.h + 28; wmax = Math.max(wmax, r.w); });
      x += wmax + 64;
    });
    fitStages(doc);
  }

  /** 移出环节：放到原来那个环节的下面，免得还压在框里。 */
  function detach(doc, id) {
    var n = get(doc, id); if (!n || !n.parent) return;
    var p = get(doc, n.parent); n.parent = null; fitStages(doc);
    var r = rectOf(p); moveTo(doc, id, n.x, r.y + r.h + 32); fitStages(doc);
  }

  function removeNode(doc, id) {
    var n = get(doc, id); if (!n) return false;
    children(doc, id).forEach(function (k) { k.parent = n.parent; });
    doc.nodes = doc.nodes.filter(function (m) { return m.id !== id; });
    doc.edges = doc.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    fitStages(doc); return true;
  }

  // ---------------- 连线 ----------------
  function edgesInto(doc, id, pid) { return doc.edges.filter(function (e) { return e.to === id && (pid == null || e.tp === pid); }); }
  function edgesOut(doc, id, pid) { return doc.edges.filter(function (e) { return e.from === id && (pid == null || e.fp === pid); }); }
  /** 接在某个输入口上的第一条（非反馈）连线。 */
  function feed(doc, id, pid) { var es = edgesInto(doc, id, pid).filter(function (e) { return !e.fb; }); return es[0] || null; }

  /** 从 a 顺着连线（不走反馈线）能不能走到 b。 */
  function reaches(doc, a, b) {
    var seen = {}, stack = [a];
    while (stack.length) {
      var x = stack.pop(); if (x === b) return true; if (seen[x]) continue; seen[x] = 1;
      doc.edges.forEach(function (e) { if (e.from === x && !e.fb) stack.push(e.to); });
    }
    return false;
  }

  /** 检查一条线能不能连；能连返回 null，不能连返回中文原因。 */
  function whyNot(doc, from, fp, to, tp) {
    var a = get(doc, from), b = get(doc, to);
    if (!a || !b) return '节点不存在';
    if (a.type === 'stage' || b.type === 'stage') return '业务环节是分组框，不用连线；连里面的节点';
    if (from === to) return '不能连到自己';
    var po = port(a, 'outs', fp), pi = port(b, 'ins', tp);
    if (!po) return '「' + a.name + '」没有这个输出口';
    if (!pi) return '「' + b.name + '」没有这个输入口';
    if (!C.compatible(po.type, pi.type)) return '类型对不上：「' + po.name + '」是' + C.PORTS[po.type].name + '，「' + pi.name + '」要的是' + C.PORTS[pi.type].name;
    if (doc.edges.some(function (e) { return e.from === from && e.fp === fp && e.to === to && e.tp === tp; })) return '这条线已经有了';
    return null;
  }

  /** 连一条线。单口（非 multi）上原来的线会被换掉。会形成回路的线自动标成「反馈线」。
   *  返回 { edge, replaced, fb } 或 { err }。 */
  function addEdge(doc, from, fp, to, tp, props) {
    var err = whyNot(doc, from, fp, to, tp); if (err) return { err: err };
    var pi = port(get(doc, to), 'ins', tp), replaced = null;
    if (!pi.multi) { var old = edgesInto(doc, to, tp); if (old.length) { replaced = old[0]; doc.edges = doc.edges.filter(function (e) { return old.indexOf(e) < 0; }); } }
    var fb = reaches(doc, to, from);
    var e = { id: 'e' + (++doc.seq), from: from, fp: fp, to: to, tp: tp, label: '', masked: false, fb: fb };
    if (props) for (var k in props) if (['id', 'from', 'fp', 'to', 'tp'].indexOf(k) < 0) e[k] = props[k];
    if (fb) e.fb = true;
    doc.edges.push(e);
    return { edge: e, replaced: replaced, fb: fb };
  }

  /** 两个节点之间自动挑一对口：同名口优先（测试集 → 测试集），空着的必填口优先。没有能接的返回 null。 */
  function pickPorts(doc, from, to, fp, tp) {
    var a = get(doc, from), b = get(doc, to); if (!a || !b || a.type === 'stage' || b.type === 'stage' || from === to) return null;
    var outs = ports(a).outs, ins = ports(b).ins, best = null, bs = -1;
    outs.forEach(function (o) {
      if (fp && o.id !== fp) return;
      ins.forEach(function (i) {
        if (tp && i.id !== tp) return;
        if (whyNot(doc, from, o.id, to, i.id)) return;
        var free = !edgesInto(doc, to, i.id).length, used = edgesOut(doc, from, o.id).length;
        var s = (o.id === i.id && o.id !== 'in' && o.id !== 'out' ? 8 : 0) + (free ? 4 : i.multi ? 3 : 0) + (i.req ? 2 : 0) + (used ? 0 : 1);
        if (C.PORTS[o.type].cat === C.PORTS[i.type].cat && C.PORTS[o.type].cat !== 'any') s += 1;
        if (s > bs) { bs = s; best = { fp: o.id, tp: i.id }; }
      });
    });
    return best;
  }
  function connect(doc, from, to, fp, props, tp) {
    var p = pickPorts(doc, from, to, fp, tp) || (tp ? pickPorts(doc, from, to, fp) : null);
    if (!p) {
      var a = get(doc, from), b = get(doc, to);
      if (a && b && !ports(a).outs.length) return { err: '「' + a.name + '」是终点，没有输出口' };
      if (a && b && !ports(b).ins.length) return { err: '「' + b.name + '」是起点，没有输入口' };
      return { err: a && b ? '「' + a.name + '」的输出接不进「' + b.name + '」：类型对不上' : '节点不存在' };
    }
    return addEdge(doc, from, p.fp, to, p.tp, props);
  }

  function removeEdge(doc, id) { var n = doc.edges.length; doc.edges = doc.edges.filter(function (e) { return e.id !== id; }); return doc.edges.length < n; }

  /** 在一条线中间插一个新节点：原来 A → B 变成 A → 新 → B。新节点接不上就返回 { err }。 */
  function insertOnEdge(doc, edgeId, type) {
    var e = getEdge(doc, edgeId); if (!e) return { err: '连线不存在' };
    var a = get(doc, e.from), b = get(doc, e.to), pa = portPos(a, 'outs', e.fp), pb = portPos(b, 'ins', e.tp);
    var probe = create(); probe.nodes = [clone(a), clone(b)]; probe.seq = doc.seq;
    var t = addNode(probe, type, 0, 0);
    if (!pickPorts(probe, a.id, t.id, e.fp) || !pickPorts(probe, t.id, b.id, null, e.tp)) return { err: '「' + K[type].name + '」放不进这条线中间：口的类型对不上' };
    removeEdge(doc, e.id);
    var n = addNode(doc, type, 0, 0);
    var r = rectOf(n);
    moveTo(doc, n.id, Math.round((pa.x + pb.x) / 2 - r.w / 2), Math.round((pa.y + pb.y) / 2 - r.h / 2));
    if (a.parent && a.parent === b.parent) n.parent = a.parent;
    var r1 = connect(doc, a.id, n.id, e.fp, { label: e.label, masked: e.masked });
    var r2 = connect(doc, n.id, b.id, null, null, e.tp);
    // 把 B（以及它右边同一行的东西）往右挪一点，给新节点腾地方
    var need = r.w + 56;
    if (pb.x - pa.x < need * 2) {
      var push = need; doc.nodes.forEach(function (m) { if (m.type !== 'stage' && m.id !== n.id && m.x >= b.x - 4 && Math.abs(m.y - b.y) < 400) m.x += push; });
    }
    fitStages(doc);
    return { node: n, e1: r1.edge, e2: r2.edge };
  }

  /** 在某个节点后面接一个新节点（放在它右边）；before = true 时接在前面（放在左边，接到第一个空着的输入口）。 */
  function addNear(doc, id, type, before) {
    var a = get(doc, id); if (!a) return { err: '节点不存在' };
    var n = addNode(doc, type, 0, 0), ra = rectOf(a), rn = rectOf(n), res;
    if (before) {
      var free = ports(a).ins.filter(function (p) { return !edgesInto(doc, id, p.id).length; })[0], pp = free ? portPos(a, 'ins', free.id) : { y: ra.y + 40 };
      moveTo(doc, n.id, ra.x - rn.w - 72, Math.round(pp.y - rn.h / 2));
      res = connect(doc, n.id, id);
    } else {
      var used = edgesOut(doc, id).length;
      moveTo(doc, n.id, ra.x + ra.w + 72, ra.y + used * 36);
      res = connect(doc, id, n.id);
    }
    if (res.err) { removeNode(doc, n.id); return res; }
    if (a.parent) n.parent = a.parent;
    // 别压在别的节点上：往下挪
    var g = 0;
    while (g++ < 30 && doc.nodes.some(function (o) { if (o.id === n.id || o.type === 'stage') return false; var q = rectOf(o), r = rectOf(n); return r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y; })) n.y += 40;
    fitStages(doc);
    return { node: n, edge: res.edge };
  }

  // ---------------- 顺着连线推数据的性质 ----------------
  /** 某个输出口出来的东西是什么：{ type: table|model|metric|text|image|audio|any, labeled: true|false|null, target, pred, task }。 */
  function info(doc, id, pid, seen) {
    seen = seen || {};
    var key = id + '.' + pid; if (seen[key]) return { type: 'any', labeled: null, target: '' }; seen[key] = 1;
    var n = get(doc, id); if (!n) return { type: 'any', labeled: null, target: '' };
    function up(p) { var e = feed(doc, id, p); return e ? info(doc, e.from, e.fp, seen) : null; }
    var u;
    switch (n.type) {
      case 'src': case 'newdata':
        var f = C.FORMS[n.form] || C.FORMS.table;
        if (f.port !== 'table') return { type: f.port, labeled: null, target: '' };
        var lab = n.type === 'src' && !!n.labeled;
        return { type: 'table', labeled: lab, target: lab ? (n.target || '') : '' };
      case 'clean': case 'feature': case 'mask': case 'split': case 'rule':
        u = up('in'); return u && u.type !== 'any' ? { type: u.type, labeled: u.labeled, target: u.target, pred: u.pred } : { type: 'table', labeled: null, target: '' };
      case 'label':
        u = up('in'); return { type: u && u.type !== 'any' ? u.type : 'table', labeled: true, target: n.target || (u && u.target) || '' };
      case 'join':
        var a = up('a'), b = up('b');
        return { type: 'table', labeled: a && b ? (a.labeled === true && b.labeled === true ? true : a.labeled === false || b.labeled === false ? false : null) : null, target: (a && a.target) || (b && b.target) || '' };
      case 'train':
        u = up('in'); var al = C.ALGOS[n.algo];
        return { type: 'model', algo: n.algo, task: al ? al.task : '', target: al && al.sup ? (n.target || (u && u.target) || '') : '' };
      case 'model':
        u = up('in');
        if (u) return u;
        if (n.trained) return { type: 'model', algo: n.trained.algo, task: n.trained.task, target: n.trained.target || '' };
        return { type: 'model', algo: '', task: '', target: '' };
      case 'evaluate': return { type: 'metric' };
      case 'predict':
        var m = up('model'); u = up('in');
        return { type: 'table', labeled: u ? u.labeled : null, target: m ? m.target : '', pred: true };
      case 'collect':
        u = up('in'); return { type: 'table', labeled: true, target: (u && u.target) || '' };
      default: return { type: 'any', labeled: null, target: '' };
    }
  }

  /** 所有看得见的节点的外框；ids 给定时只算这些。 */
  function bounds(doc, ids) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    doc.nodes.forEach(function (n) {
      if (ids && !ids.has(n.id)) return;
      if (isHidden(doc, n.id)) return;
      var r = rectOf(n); any = true;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h + 22);
    });
    return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** 从左到右、从上到下排序（清单和统计用）。 */
  function ordered(list) { return list.slice().sort(function (a, b) { return (Math.round(a.x / 60) - Math.round(b.x / 60)) || (a.y - b.y) || (a.x - b.x); }); }

  /** 按连线先后排序（拓扑序，不走反馈线）；没连线的按位置。 */
  function topo(doc) {
    var nodes = ordered(doc.nodes.filter(function (n) { return n.type !== 'stage'; })), indeg = {}, out = [];
    nodes.forEach(function (n) { indeg[n.id] = 0; });
    doc.edges.forEach(function (e) { if (!e.fb && indeg[e.to] != null && indeg[e.from] != null) indeg[e.to]++; });
    var ready = nodes.filter(function (n) { return !indeg[n.id]; }), done = {};
    while (ready.length) {
      var n = ready.shift(); if (done[n.id]) continue; done[n.id] = 1; out.push(n);
      doc.edges.forEach(function (e) { if (e.from === n.id && !e.fb && indeg[e.to] != null && --indeg[e.to] === 0) ready.push(get(doc, e.to)); });
      ready = ordered(ready);
    }
    nodes.forEach(function (n) { if (!done[n.id]) out.push(n); });
    return out;
  }

  // ---------------- JSON 读写 ----------------
  function serialize(doc) { return JSON.stringify(doc, null, 2); }

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 2000) : ''; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : d; }
  function real(v, d, lo, hi) { return typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  function pick(v, allowed, d) { return allowed.indexOf(v) >= 0 ? v : d; }

  // 第一版（方框 + 箭头）的文件：方框种类换成节点种类
  var V1 = { stage: 'stage', human: 'human', ai: 'ai', data: 'src', ext: 'ext' };
  var V1_AI = { predict: 'predict', anomaly: 'anomaly' };

  /** 读 .json：检查格式，把字段整理成合法值；第一版文件自动转换；出错时抛出中文错误。 */
  function parse(text) {
    var o;
    try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('不是有效的 JSON 文件'); }
    if (!o || typeof o !== 'object' || !Array.isArray(o.nodes)) throw new Error('文件里没有找到蓝图（缺少 nodes）');
    if (o.format && o.format !== FORMAT) throw new Error('这不是 AI 业务拆解画板的文件（format = ' + o.format + '）');
    var v1 = !(o.version >= 2);
    var doc = create(str(o.title, 200) || '打开的蓝图'), seen = {}, maxSeq = 0, HMLs = ['high', 'mid', 'low', ''];
    o.nodes.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var type = v1 ? V1[r.type] : r.type;
      if (!type || !K[type]) return;
      var id = str(r.id, 40); if (!id || seen[id]) return; seen[id] = true;
      var n = defaults(type); n.id = id; n.type = type; n.parent = str(r.parent, 40) || null;
      n.x = num(r.x, 0); n.y = num(r.y, 0); n.w = Math.max(120, Math.min(600, num(r.w, K[type].w))); n.h = Math.max(40, num(r.h, K[type].h || 80));
      if (v1 && type !== 'stage') n.w = K[type].w;
      n.name = str(r.name, 200) || n.name; n.desc = str(r.desc);
      switch (type) {
        case 'stage': n.collapsed = !!r.collapsed; break;
        case 'src': case 'newdata':
          n.form = pick(r.form, C.FORM_ORDER, 'table'); n.labeled = v1 ? false : !!r.labeled; n.target = str(r.target, 100); n.cols = str(r.cols, 2000); n.sys = str(r.sys, 200);
          n.loc = pick(r.loc, C.LOC_ORDER, 'local'); n.level = pick(r.level, C.LEVEL_ORDER, 'internal');
          n.csv = str(r.csv, 2000000); n.csvName = str(r.csvName, 200); break;
        case 'clean': n.dropna = r.dropna !== false; n.dedupe = r.dedupe !== false; break;
        case 'feature': n.keep = str(r.keep, 2000); break;
        case 'mask': n.drop = str(r.drop, 2000); break;
        case 'label': n.role = str(r.role, 200); n.target = str(r.target, 100); break;
        case 'split': n.ratio = real(r.ratio, 0.8, 0.5, 0.95); n.seed = num(r.seed, 42); break;
        case 'train': n.algo = pick(r.algo, C.ALGO_ORDER.concat(['']), ''); n.target = str(r.target, 100); n.k = Math.max(2, Math.min(10, num(r.k, 3)));
          n.loc = pick(r.loc, C.LOC_ORDER, 'local'); n.value = pick(r.value, HMLs, ''); n.effort = pick(r.effort, HMLs, ''); break;
        case 'model': n.version = str(r.version, 40) || 'v1'; n.loc = pick(r.loc, C.LOC_ORDER, 'local'); n.locked = !!r.locked;
          n.trained = r.trained && typeof r.trained === 'object' && typeof r.trained.algo === 'string' ? r.trained : null; n.trainedAt = str(r.trainedAt, 40);
          if (!n.trained) n.locked = false; break;
        case 'predict': n.loc = pick(r.loc, C.LOC_ORDER, 'local'); break;
        case 'collect': n.role = str(r.role, 200); n.wait = str(r.wait, 200); break;
        case 'ai':
          var at = r.aiType; if (v1 && V1_AI[at]) at = V1_AI[at];
          n.aiType = pick(at, C.AI_ORDER.concat(['']), ''); n.input = str(r.input, 500); n.output = str(r.output, 500);
          n.loc = pick(r.loc, C.LOC_ORDER, 'public'); n.value = pick(r.value, HMLs, ''); n.effort = pick(r.effort, HMLs, ''); break;
        case 'human': case 'action': n.role = str(r.role, 200); break;
        case 'rule': n.col = str(r.col, 100); n.op = pick(r.op, OPS, '>'); n.val = str(r.val, 100); break;
        case 'ext': n.loc = pick(r.loc, C.LOC_ORDER, 'public'); break;
        case 'store': n.loc = pick(r.loc, C.LOC_ORDER, 'local'); n.level = pick(r.level, C.LEVEL_ORDER, 'internal'); break;
      }
      var m = /^[a-z](\d+)$/.exec(id); if (m) maxSeq = Math.max(maxSeq, +m[1]);
      doc.nodes.push(n);
    });
    // 父级必须是存在的环节，且不能成环
    doc.nodes.forEach(function (n) { if (n.parent && !(get(doc, n.parent) && get(doc, n.parent).type === 'stage')) n.parent = null; });
    doc.nodes.forEach(function (n) {
      var seenP = {}, p = n; while (p && p.parent) { if (seenP[p.parent]) { n.parent = null; break; } seenP[p.parent] = 1; p = get(doc, p.parent); }
      if (n.parent === n.id) n.parent = null;
    });
    (Array.isArray(o.edges) ? o.edges : []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var id = str(r.id, 40); if (!id || seen[id]) return;
      var props = { label: str(r.label, 200), masked: !!r.masked };
      var res = v1 ? connect(doc, r.from, r.to, null, props) : addEdge(doc, r.from, str(r.fp, 40), r.to, str(r.tp, 40), props);
      if (!res || res.err) return;
      seen[id] = true; doc.seq--; res.edge.id = id;
      var m = /^[a-z](\d+)$/.exec(id); if (m) maxSeq = Math.max(maxSeq, +m[1]);
    });
    doc.seq = Math.max(num(o.seq, 0), maxSeq, doc.seq);
    fitStages(doc);
    return doc;
  }

  // ---------------- 撤销 / 重做：整份快照 ----------------
  function History(limit) { this.limit = limit || 200; this.past = []; this.future = []; }
  History.prototype.push = function (snap) { this.past.push(snap); if (this.past.length > this.limit) this.past.shift(); this.future = []; };
  History.prototype.undo = function (cur) { if (!this.past.length) return null; this.future.push(cur); return this.past.pop(); };
  History.prototype.redo = function (cur) { if (!this.future.length) return null; this.past.push(cur); return this.future.pop(); };
  History.prototype.clear = function () { this.past = []; this.future = []; };
  History.prototype.canUndo = function () { return this.past.length > 0; };
  History.prototype.canRedo = function () { return this.future.length > 0; };

  root.ABB = root.ABB || {};
  root.ABB.Model = {
    FORMAT: FORMAT, VERSION: VERSION, COLLAPSED_W: COLLAPSED_W, COLLAPSED_H: COLLAPSED_H, OPS: OPS,
    create: create, clone: clone, defaults: defaults, get: get, getEdge: getEdge, children: children, descendants: descendants,
    isDescendant: isDescendant, ancestors: ancestors, depth: depth, visibleId: visibleId, isHidden: isHidden,
    ports: ports, port: port, layout: layout, portPos: portPos, rectOf: rectOf,
    addNode: addNode, moveBy: moveBy, moveTo: moveTo, canParent: canParent, setParent: setParent, fitStages: fitStages,
    placeInside: placeInside, detach: detach, arrange: arrange, removeNode: removeNode,
    edgesInto: edgesInto, edgesOut: edgesOut, feed: feed, reaches: reaches, whyNot: whyNot, addEdge: addEdge, pickPorts: pickPorts, connect: connect,
    removeEdge: removeEdge, insertOnEdge: insertOnEdge, addNear: addNear, info: info,
    bounds: bounds, ordered: ordered, topo: topo, serialize: serialize, parse: parse, History: History
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Model;
})(typeof window !== 'undefined' ? window : globalThis);
