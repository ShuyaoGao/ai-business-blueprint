/* 蓝图的数据模型：方框（可嵌套）+ 连线 + 撤销重做 + JSON 读写。纯函数，Node 可测。
 *
 * doc = { format, version, title, seq, nodes: [node], edges: [edge] }
 * node = { id, type: stage|human|ai|data|ext, parent: 环节 id 或 null, x, y, w, h（世界坐标，左上角）,
 *          name, desc,
 *          stage: collapsed            human: role
 *          ai:    aiType, input, output, loc, value, effort
 *          data:  loc, level           ext:   loc }
 * edge = { id, from, to, kind: flow|data, label, masked }
 * 业务环节的位置和大小由里面的方框决定（fitStages）；空环节保留自己的大小。
 */
(function (root) {
  'use strict';
  var C = root.ABB && root.ABB.Config;
  if (!C && typeof require === 'function') C = require('./config.js');

  var FORMAT = 'ai-business-blueprint', VERSION = 1;
  var COLLAPSED_W = 220, COLLAPSED_H = C.HEAD + 40, MIN_STAGE_W = 200;

  function create(title) { return { format: FORMAT, version: VERSION, title: title || '我的业务蓝图', seq: 0, nodes: [], edges: [] }; }
  function clone(doc) { return JSON.parse(JSON.stringify(doc)); }

  function defaults(type) {
    var d = { stage: { name: '新环节', collapsed: false }, human: { name: '人工步骤', role: '' },
      ai: { name: 'AI 步骤', aiType: '', input: '', output: '', loc: 'public', value: '', effort: '' },
      data: { name: '数据', loc: 'local', level: 'internal' }, ext: { name: '外部系统', loc: 'public' } }[type];
    var o = {}; for (var k in d) o[k] = d[k]; o.desc = ''; return o;
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
  /** 被折叠的祖先里最外层的那个；没有就是自己。连线和统计里"看得见的那个方框"。 */
  function visibleId(doc, id) { var v = id; ancestors(doc, id).forEach(function (a) { if (a.collapsed) v = a.id; }); return v; }
  function isHidden(doc, id) { return visibleId(doc, id) !== id; }

  /** 画在画布上的矩形（折叠的环节变小）。 */
  function rectOf(n) {
    if (n.type === 'stage' && n.collapsed) return { x: n.x, y: n.y, w: COLLAPSED_W, h: COLLAPSED_H };
    return { x: n.x, y: n.y, w: n.w, h: n.h };
  }

  function addNode(doc, type, x, y, props) {
    if (!C.TYPES[type]) throw new Error('未知方框类型：' + type);
    var n = defaults(type);
    n.id = 'n' + (++doc.seq); n.type = type; n.parent = null;
    n.x = Math.round(x || 0); n.y = Math.round(y || 0); n.w = C.TYPES[type].w; n.h = C.TYPES[type].h;
    if (props) for (var k in props) if (k !== 'id' && k !== 'type') n[k] = props[k];
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

  /** 由内向外把每个有子方框的环节撑到刚好包住子方框。 */
  function fitStages(doc) {
    var stages = doc.nodes.filter(function (n) { return n.type === 'stage'; });
    stages.sort(function (a, b) { return depth(doc, b.id) - depth(doc, a.id); });
    stages.forEach(function (s) {
      var kids = children(doc, s.id);
      if (!kids.length || s.collapsed) return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      kids.forEach(function (k) { var r = rectOf(k); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
      s.x = x0 - C.PAD; s.y = y0 - C.HEAD - 10; s.w = Math.max(MIN_STAGE_W, x1 - x0 + 2 * C.PAD); s.h = y1 - s.y + C.PAD;
    });
  }

  /** 新方框放进环节里：排在现有子方框下面。 */
  function placeInside(doc, stageId, n) {
    var s = get(doc, stageId); if (!s) return;
    var kids = children(doc, stageId).filter(function (k) { return k.id !== n.id; });
    var x = s.x + C.PAD, y = s.y + C.HEAD + 10;
    if (kids.length) {
      var bottom = -Infinity, left = Infinity;
      kids.forEach(function (k) { var r = rectOf(k); bottom = Math.max(bottom, r.y + r.h); left = Math.min(left, r.x); });
      x = left; y = bottom + 14;
    }
    moveTo(doc, n.id, x, y); n.parent = stageId; s.collapsed = false;
    fitStages(doc);
  }

  /** 环节里的子方框排整齐：1–3 个一列，4–8 个两列，再多三列。 */
  function arrange(doc, stageId) {
    var s = get(doc, stageId); if (!s) return;
    var kids = children(doc, stageId);
    if (!kids.length) return;
    kids.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    var cols = kids.length <= 3 ? 1 : kids.length <= 8 ? 2 : 3, gap = 14;
    var colW = []; kids.forEach(function (k, i) { var c = i % cols; colW[c] = Math.max(colW[c] || 0, rectOf(k).w); });
    var y = s.y + C.HEAD + 10, x0 = s.x + C.PAD;
    for (var r = 0; r * cols < kids.length; r++) {
      var rowH = 0, x = x0;
      for (var c = 0; c < cols; c++) {
        var k = kids[r * cols + c]; if (!k) break;
        moveTo(doc, k.id, x, y); rowH = Math.max(rowH, rectOf(k).h); x += colW[c] + gap;
      }
      y += rowH + gap;
    }
    fitStages(doc);
  }

  /** 移出环节：放到原来那个环节的右边，免得还压在框里。 */
  function detach(doc, id) {
    var n = get(doc, id); if (!n || !n.parent) return;
    var p = get(doc, n.parent); n.parent = null; fitStages(doc);
    var r = rectOf(p); moveTo(doc, id, r.x + r.w + 24, n.y); fitStages(doc);
  }

  function removeNode(doc, id) {
    var n = get(doc, id); if (!n) return false;
    children(doc, id).forEach(function (k) { k.parent = n.parent; });
    doc.nodes = doc.nodes.filter(function (m) { return m.id !== id; });
    doc.edges = doc.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    fitStages(doc); return true;
  }

  function defaultKind(doc, from, to) {
    var a = get(doc, from), b = get(doc, to);
    return (a && a.type === 'data') || (b && b.type === 'data') ? 'data' : 'flow';
  }
  /** 连一条线；同方向重复、连自己、端点不存在都返回 null。 */
  function addEdge(doc, from, to, props) {
    if (!from || !to || from === to || !get(doc, from) || !get(doc, to)) return null;
    if (doc.edges.some(function (e) { return e.from === from && e.to === to; })) return null;
    var e = { id: 'e' + (++doc.seq), from: from, to: to, kind: defaultKind(doc, from, to), label: '', masked: false };
    if (props) for (var k in props) if (k !== 'id' && k !== 'from' && k !== 'to') e[k] = props[k];
    doc.edges.push(e); return e;
  }
  function removeEdge(doc, id) { var n = doc.edges.length; doc.edges = doc.edges.filter(function (e) { return e.id !== id; }); return doc.edges.length < n; }
  function reverseEdge(doc, id) {
    var e = getEdge(doc, id); if (!e) return false;
    if (doc.edges.some(function (x) { return x.from === e.to && x.to === e.from; })) return false;
    var t = e.from; e.from = e.to; e.to = t; return true;
  }

  /** 所有看得见的方框的外框；ids 给定时只算这些。 */
  function bounds(doc, ids) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    doc.nodes.forEach(function (n) {
      if (ids && !ids.has(n.id)) return;
      if (isHidden(doc, n.id)) return;
      var r = rectOf(n); any = true;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** 顶层环节按从左到右、从上到下排序后的展开顺序（Markdown 清单和统计用）。 */
  function ordered(list) { return list.slice().sort(function (a, b) { return (Math.round(a.x / 40) - Math.round(b.x / 40)) || (a.y - b.y) || (a.x - b.x); }); }

  // ---------------- JSON 读写 ----------------
  function serialize(doc) { return JSON.stringify(doc, null, 2); }

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 2000) : ''; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : d; }
  function pick(v, allowed, d) { return allowed.indexOf(v) >= 0 ? v : d; }

  /** 读 .json：检查格式，把字段整理成合法值；出错时抛出中文错误。 */
  function parse(text) {
    var o;
    try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('不是有效的 JSON 文件'); }
    if (!o || typeof o !== 'object' || !Array.isArray(o.nodes)) throw new Error('文件里没有找到蓝图（缺少 nodes）');
    if (o.format && o.format !== FORMAT) throw new Error('这不是 AI 业务拆解画板的文件（format = ' + o.format + '）');
    var doc = create(str(o.title, 200) || '打开的蓝图'), seen = {}, maxSeq = 0;
    var HML = ['high', 'mid', 'low', ''];
    o.nodes.forEach(function (r) {
      if (!r || typeof r !== 'object' || !C.TYPES[r.type]) return;
      var id = str(r.id, 40); if (!id || seen[id]) return; seen[id] = true;
      var n = defaults(r.type); n.id = id; n.type = r.type; n.parent = str(r.parent, 40) || null;
      n.x = num(r.x, 0); n.y = num(r.y, 0); n.w = Math.max(60, num(r.w, C.TYPES[r.type].w)); n.h = Math.max(40, num(r.h, C.TYPES[r.type].h));
      n.name = str(r.name, 200) || n.name; n.desc = str(r.desc);
      if (r.type === 'stage') n.collapsed = !!r.collapsed;
      if (r.type === 'human') n.role = str(r.role, 200);
      if (r.type === 'ai') {
        n.aiType = pick(r.aiType, C.AI_ORDER.concat(['']), ''); n.input = str(r.input, 500); n.output = str(r.output, 500);
        n.loc = pick(r.loc, C.LOC_ORDER, 'public'); n.value = pick(r.value, HML, ''); n.effort = pick(r.effort, HML, '');
      }
      if (r.type === 'data') { n.loc = pick(r.loc, C.LOC_ORDER, 'local'); n.level = pick(r.level, C.LEVEL_ORDER, 'internal'); }
      if (r.type === 'ext') n.loc = pick(r.loc, C.LOC_ORDER, 'public');
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
      if (!get(doc, r.from) || !get(doc, r.to) || r.from === r.to) return;
      if (doc.edges.some(function (e) { return e.from === r.from && e.to === r.to; })) return;
      seen[id] = true;
      doc.edges.push({ id: id, from: r.from, to: r.to, kind: pick(r.kind, ['flow', 'data'], 'flow'), label: str(r.label, 200), masked: !!r.masked });
      var m = /^[a-z](\d+)$/.exec(id); if (m) maxSeq = Math.max(maxSeq, +m[1]);
    });
    doc.seq = Math.max(num(o.seq, 0), maxSeq);
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
    FORMAT: FORMAT, VERSION: VERSION, COLLAPSED_W: COLLAPSED_W, COLLAPSED_H: COLLAPSED_H,
    create: create, clone: clone, defaults: defaults, get: get, getEdge: getEdge, children: children, descendants: descendants,
    isDescendant: isDescendant, ancestors: ancestors, depth: depth, visibleId: visibleId, isHidden: isHidden, rectOf: rectOf,
    addNode: addNode, moveBy: moveBy, moveTo: moveTo, canParent: canParent, setParent: setParent, fitStages: fitStages,
    placeInside: placeInside, detach: detach, arrange: arrange, removeNode: removeNode, addEdge: addEdge, removeEdge: removeEdge,
    reverseEdge: reverseEdge, defaultKind: defaultKind, bounds: bounds, ordered: ordered, serialize: serialize, parse: parse, History: History
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Model;
})(typeof window !== 'undefined' ? window : globalThis);
