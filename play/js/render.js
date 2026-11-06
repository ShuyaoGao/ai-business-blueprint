/* 把节点图画成 SVG 字符串。画布显示和导出 PNG 用同一份代码；纯函数，Node 可测（量字宽用近似值）。
 *   Render.world(doc, opts)       画布里 <g> 的内容
 *   Render.standalone(doc, opts)  完整的 <svg>（导出用，白底、浅色）
 * opts: { pal, measure, sel: {kind,id}, risks: {nodes:{}, edges:{}}, visible: Set|null, run: { id: 运行结果 },
 *         pop: Set, drop: 环节 id, top: 正在拖的节点 id, guides, temp: {x1,y1,x2,y2}, linking: {from, fp},
 *         hoverPort: 'id|side|pid', flash: id, connectFrom: id, dropEdge: 连线 id }
 */
(function (root) {
  'use strict';
  var C = (root.ABB && root.ABB.Config) || require('./config.js');
  var M = (root.ABB && root.ABB.Model) || require('./model.js');
  var FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Hiragino Sans GB",system-ui,sans-serif';
  var NN = C.NODE;

  // 24×24 的小图标；FILLED 里的用白色填充，其余描边
  var ICONS = {
    stage: 'M3 4h7v6H3z M14 4h7v6h-7z M8.5 16h7v5h-7z M6.5 10v3h11v-3 M12 13v3',
    src: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    newdata: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3 M20 6v5 M18 15v6 M15 18h6',
    clean: 'M3 4h18l-7 8v6l-4 2v-8z',
    feature: 'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M15 10v4 M10 16v4',
    mask: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M4 4l16 16',
    label: 'M3 3h8l10 10-8 8L3 11z M7.5 7.5h.01',
    split: 'M12 3v7 M12 10l-6 6v5 M12 10l6 6v5',
    join: 'M6 3v5l6 6v7 M18 3v5l-6 6',
    train: 'M7 7h10v10H7z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4',
    model: 'M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10',
    evaluate: 'M4 4h16v16H4z M8 12l3 3 5-6',
    predict: 'M3 20h18 M5 16l4-5 4 3 6-8 M15 6h4v4',
    collect: 'M4 12a8 8 0 0 1 14-5 M20 4v5h-5 M20 12a8 8 0 0 1-14 5 M4 20v-5h5',
    ai: 'M12 2.5l2.3 6.2 6.2 2.3-6.2 2.3L12 19.5l-2.3-6.2L3.5 11l6.2-2.3z M19 17l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
    human: 'M12 3.5a3.8 3.8 0 1 0 0.01 0 M4.5 21c0-4.3 3.4-7 7.5-7s7.5 2.7 7.5 7',
    rule: 'M12 3l9 9-9 9-9-9z M12 8v5 M12 16h.01',
    action: 'M13 2L4 14h7l-1 8 9-12h-7z',
    ext: 'M9 2.5v5 M15 2.5v5 M6 7.5h12v4a6 6 0 0 1-12 0z M12 17.5v4',
    store: 'M3 4h18v5H3z M5 9v11h14V9 M10 13h4'
  };
  var FILLED = { ai: 1, action: 1 };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f1(v) { return Math.round(v * 10) / 10; }

  /** 没有浏览器时的字宽近似：中文 1 个字宽，其他 0.56。 */
  function approxMeasure(text, size) {
    var w = 0; for (var i = 0; i < text.length; i++) w += /[⺀-￿]/.test(text[i]) ? size : size * 0.56; return w;
  }

  /** 折行：中文逐字、英文按词；超过 maxLines 行用省略号。 */
  function wrap(text, maxW, size, measure, maxLines, bold) {
    measure = measure || approxMeasure; text = String(text || '').replace(/\s+/g, ' ').trim();
    var tokens = text.match(/[A-Za-z0-9_.\-%/+]+|\s|[^\sA-Za-z0-9_.\-%/+]/g) || [];
    var lines = [], cur = '';
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (measure(cur + t, size, bold) <= maxW || !cur) { cur += t; continue; }
      lines.push(cur.trim()); cur = t === ' ' ? '' : t;
    }
    if (cur.trim()) lines.push(cur.trim());
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && measure(last + '…', size, bold) > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    return lines.map(function (l) { var s = l; while (s.length > 1 && measure(s, size, bold) > maxW) s = s.slice(0, -2) + '…'; return s; });
  }
  function one(text, maxW, size, measure, bold) { return wrap(text, maxW, size, measure, 1, bold)[0] || ''; }

  function iconPath(kind) { return ICONS[kind] || ICONS.ext; }
  function icon(kind, cx, cy, r, col) {
    var s = r * 2 * 0.62 / 24;
    return '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + r + '" fill="' + col + '"/>' +
      '<path d="' + iconPath(kind) + '" transform="translate(' + f1(cx - 12 * s) + ',' + f1(cy - 12 * s) + ') scale(' + f1(s * 1000) / 1000 + ')" fill="' +
      (FILLED[kind] ? '#fff' : 'none') + '" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  function pill(x, y, text, color, measure, ink) {
    var w = measure(text, 10.5) + 12;
    return { w: w, svg: '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="17" rx="8.5" fill="' + color + '"/>' +
      '<text x="' + f1(x + w / 2) + '" y="' + f1(y + 12.3) + '" font-size="10.5" text-anchor="middle" fill="' + (ink || '#fff') + '">' + esc(text) + '</text>' };
  }

  function quadColor(q, pal) { return q === 'now' ? pal.loc.local : q === 'plan' ? pal.loc.private : q === 'skip' ? pal.level.secret : pal.level.open; }
  function portColor(type, pal) { var cat = C.PORTS[type] ? C.PORTS[type].cat : 'any'; return pal.port[cat] || pal.port.any; }
  function colors(kind, pal) { return pal[C.colorKey(kind)] || pal.biz; }

  /** 节点标题下面那一行小字。 */
  function subtitle(doc, n) {
    var inf;
    switch (n.type) {
      case 'src':
        if (n.form !== 'table') return C.FORMS[n.form].name + ' · 无标签';
        return '表格 · ' + (n.labeled ? '有标签' + (n.target ? '（' + n.target + '）' : '') : '无标签');
      case 'newdata': return C.FORMS[n.form].name + ' · 等着预测';
      case 'clean': return [n.dropna ? '去缺数' : '', n.dedupe ? '去重复' : ''].filter(Boolean).join(' · ') || '不改动';
      case 'feature': var k = String(n.keep || '').split(/[,，、;；\s]+/).filter(Boolean).length; return k ? '保留 ' + k + ' 个字段' : '全部字段';
      case 'mask': return n.drop ? '删掉：' + n.drop : '还没填要删的列';
      case 'label': return '补上答案：' + (n.target || '？');
      case 'split': return '训练 ' + Math.round(n.ratio * 100) + '% · 测试 ' + (100 - Math.round(n.ratio * 100)) + '%';
      case 'join': return '上下拼在一起';
      case 'train': var al = C.ALGOS[n.algo]; return al ? al.name + ' · ' + (al.sup ? '监督' : '无监督') : '还没选算法';
      case 'model': return (n.version || 'v1') + ' · ' + (n.locked ? '已锁定，反复用' : n.trained ? '已训练' : '还没训练');
      case 'evaluate': return '用测试集考一考';
      case 'predict': inf = M.info(doc, n.id, 'out'); return inf.target ? '预测「' + inf.target + '」' : '模型 + 新数据';
      case 'collect': return n.wait ? n.wait + '后回收' : '等真实结果出来';
      case 'ai': return n.aiType ? C.AI[n.aiType].name : '还没选 AI 类型';
      case 'human': case 'action': return n.role || C.KINDS[n.type].name;
      case 'rule': return (n.col || '最后一列') + ' ' + n.op + ' ' + (n.val === '' ? '？' : n.val);
      default: return C.KINDS[n.type].name;
    }
  }

  function stageSummary(doc, s) {
    var d = M.descendants(doc, s.id).filter(function (n) { return n.type !== 'stage'; });
    var ai = d.filter(function (n) { return n.type === 'train' || n.type === 'predict' || n.type === 'ai'; }).length;
    return '含 ' + d.length + ' 个节点 · ' + ai + ' 个 AI';
  }

  var STATUS = { ok: '✓', pass: '✓', error: '!', skip: '⤼', wait: '…' };

  function stageSvg(doc, n, o) {
    var pal = o.pal, ms = o.measure, r = M.rectOf(n), x = r.x, y = r.y, w = r.w, h = r.h, c = pal.stage, out = [];
    var drop = o.drop === n.id;
    out.push('<g class="nd t-stage' + (o.pop && o.pop.has(n.id) ? ' pop' : '') + (o.flash === n.id ? ' flash' : '') + '" data-id="' + esc(n.id) + '">');
    out.push('<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="14" fill="' + c.fill + '" stroke="' + (drop ? pal.guide : c.stroke) + '" stroke-width="' + (drop ? 3 : 1.4) + '" stroke-dasharray="' + (drop ? '8 5' : '2 0') + '"/>');
    out.push('<path d="M' + (x + 1) + ' ' + (y + C.HEAD) + 'V' + (y + 13) + 'a12 12 0 0 1 12 -12H' + (x + w - 13) + 'a12 12 0 0 1 12 12V' + (y + C.HEAD) + 'z" fill="' + c.head + '"/>');
    out.push(icon('stage', x + 19, y + C.HEAD / 2, 11, c.stroke));
    out.push('<text x="' + (x + 37) + '" y="' + (y + C.HEAD / 2 + 5) + '" font-size="14" font-weight="bold" fill="' + c.ink + '">' + esc(one(n.name, w - 84, 14, ms, true)) + '</text>');
    if (!o.noButtons) {
      out.push('<g class="tog" data-act="toggle" data-id="' + esc(n.id) + '"><rect x="' + (x + w - 32) + '" y="' + (y + 5) + '" width="26" height="24" rx="6" fill="' + c.fill + '" stroke="' + c.stroke + '"/>' +
        '<text x="' + (x + w - 19) + '" y="' + (y + 22) + '" font-size="16" font-weight="bold" text-anchor="middle" fill="' + c.ink + '">' + (n.collapsed ? '+' : '−') + '</text></g>');
    }
    if (n.collapsed) out.push('<text x="' + (x + 14) + '" y="' + (y + C.HEAD + 25) + '" font-size="12" fill="' + pal.muted + '">' + esc(stageSummary(doc, n)) + '</text>');
    else if (!M.children(doc, n.id).length) out.push('<text x="' + (x + w / 2) + '" y="' + (y + C.HEAD + (h - C.HEAD) / 2 + 4) + '" font-size="12" text-anchor="middle" fill="' + pal.muted + '">把节点拖进来，归到这个环节</text>');
    if (o.sel && o.sel.kind === 'node' && o.sel.id === n.id) out.push('<rect class="selbox" x="' + (x - 4) + '" y="' + (y - 4) + '" width="' + (w + 8) + '" height="' + (h + 8) + '" rx="16" fill="none" stroke="' + pal.sel + '" stroke-width="3"/>');
    out.push('</g>');
    return out.join('');
  }

  function nodeSvg(doc, n, o) {
    var pal = o.pal, ms = o.measure, L = M.layout(n), x = L.x, y = L.y, w = L.w, h = L.h, c = colors(n.type, pal), out = [];
    var risk = o.risks && o.risks.nodes[n.id], run = o.run && o.run[n.id];
    var cls = 'nd t-' + n.type + ' g-' + C.KINDS[n.type].group + (o.pop && o.pop.has(n.id) ? ' pop' : '') + (o.flash === n.id ? ' flash' : '') + (o.connectFrom === n.id ? ' cfrom' : '') + (run ? ' st-' + run.status : '');
    out.push('<g class="' + cls + '" data-id="' + esc(n.id) + '">');
    var stroke = risk === 'red' ? pal.red : risk === 'yellow' ? pal.yellow : c.stroke, sw = risk ? 3 : 1.5;
    out.push('<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="' + c.fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + (n.type === 'ext' ? ' stroke-dasharray="6 4"' : '') + '/>');
    // 标题栏
    out.push('<path d="M' + (x + 0.75) + ' ' + (y + NN.HEAD) + 'V' + (y + 10) + 'a9.25 9.25 0 0 1 9.25 -9.25H' + (x + w - 10) + 'a9.25 9.25 0 0 1 9.25 9.25V' + (y + NN.HEAD) + 'z" fill="' + c.head + '"/>');
    out.push(icon(n.type, x + 15, y + NN.HEAD / 2, 10, c.stroke));
    out.push('<text x="' + (x + 30) + '" y="' + (y + NN.HEAD / 2 + 4.5) + '" font-size="13" font-weight="bold" fill="' + c.ink + '">' + esc(one(n.name, w - 56, 13, ms, true)) + '</text>');
    if (run && STATUS[run.status]) {
      var sc = run.status === 'error' ? pal.err : run.status === 'ok' || run.status === 'pass' ? pal.ok : pal.skip;
      out.push('<g class="rst"><circle cx="' + (x + w - 14) + '" cy="' + (y + NN.HEAD / 2) + '" r="8" fill="' + sc + '"/><text x="' + (x + w - 14) + '" y="' + (y + NN.HEAD / 2 + 4) + '" font-size="11" font-weight="bold" text-anchor="middle" fill="#fff">' + STATUS[run.status] + '</text></g>');
    }
    // 副标题
    out.push('<text x="' + (x + 10) + '" y="' + (y + NN.HEAD + 15) + '" font-size="11.5" fill="' + pal.muted + '">' + esc(one(subtitle(doc, n), w - 20, 11.5, ms)) + '</text>');
    // 口
    var both = L.ins.length && L.outs.length, lw = both ? w / 2 - 14 : w - 30;
    var link = o.linking, hp = o.hoverPort;
    L.ins.forEach(function (p) {
      var conn = doc.edges.some(function (e) { return e.to === n.id && e.tp === p.id; }), col = portColor(p.type, pal), key = n.id + '|ins|' + p.id;
      var okLink = link && link.from !== n.id ? !M.whyNot(doc, link.from, link.fp, n.id, p.id) : null;
      out.push('<g class="pt pin' + (okLink === false ? ' dim' : '') + '" data-port="' + esc(key) + '">');
      out.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="12" fill="transparent"/>');
      if (okLink || hp === key) out.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="9.5" fill="none" stroke="' + pal.sel + '" stroke-width="2.5"/>');
      out.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="5.5" fill="' + (conn ? col : pal.bg) + '" stroke="' + col + '" stroke-width="2"' + (p.req && !conn ? ' stroke-dasharray="2.5 2"' : '') + '/>');
      out.push('<text x="' + (x + 11) + '" y="' + (p.y + 4) + '" font-size="11" fill="' + c.ink + '">' + esc(one(p.name, lw, 11, ms)) + '</text></g>');
    });
    L.outs.forEach(function (p) {
      var conn = doc.edges.some(function (e) { return e.from === n.id && e.fp === p.id; }), col = portColor(p.type, pal), key = n.id + '|outs|' + p.id;
      out.push('<g class="pt pout' + (link && link.from === n.id && link.fp === p.id ? ' active' : '') + '" data-port="' + esc(key) + '">');
      out.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="12" fill="transparent"/>');
      if (hp === key || (link && link.from === n.id && link.fp === p.id)) out.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="9.5" fill="none" stroke="' + pal.sel + '" stroke-width="2.5"/>');
      out.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="5.5" fill="' + (conn ? col : pal.bg) + '" stroke="' + col + '" stroke-width="2"/>');
      out.push('<text x="' + (x + w - 11) + '" y="' + (p.y + 4) + '" font-size="11" text-anchor="end" fill="' + c.ink + '">' + esc(one(p.name, lw, 11, ms)) + '</text></g>');
    });
    // 底部小标签：位置、敏感等级、四格图、锁定
    var px = x + 8, py = y + h - 23, pills = [];
    if (C.HAS_LOC[n.type]) pills.push([n.type === 'src' || n.type === 'newdata' || n.type === 'store' ? C.LOCS[n.loc].name : (n.loc === 'public' ? '公有云' : C.LOCS[n.loc].name), pal.loc[n.loc]]);
    if (n.level && (n.type === 'src' || n.type === 'newdata' || n.type === 'store')) pills.push([C.LEVELS[n.level].name, pal.level[n.level]]);
    if (n.type === 'model' && n.locked) pills.push(['已锁定', pal.ml.stroke]);
    if (n.type === 'train' && n.algo && !C.ALGOS[n.algo].run) pills.push(['只画图', pal.skip]);
    var q = (n.type === 'train' || n.type === 'ai') && C.quadOf(n.value, n.effort);
    if (q) pills.push([C.QUADS[q].name, quadColor(q, pal)]);
    pills.forEach(function (pp) { var pl = pill(px, py, pp[0], pp[1], ms); if (px + pl.w <= x + w - 4) { out.push(pl.svg); px += pl.w + 4; } });
    if (risk) {
      out.push('<circle cx="' + (x + 2) + '" cy="' + (y + 2) + '" r="9" fill="' + (risk === 'red' ? pal.red : pal.yellow) + '"/>' +
        '<text x="' + (x + 2) + '" y="' + (y + 6.5) + '" font-size="12" font-weight="bold" text-anchor="middle" fill="#fff">!</text>');
    }
    if (o.sel && o.sel.kind === 'node' && o.sel.id === n.id) {
      out.push('<rect class="selbox" x="' + (x - 4) + '" y="' + (y - 4) + '" width="' + (w + 8) + '" height="' + (h + 8) + '" rx="13" fill="none" stroke="' + pal.sel + '" stroke-width="3"/>');
    }
    // 运行结果：一行小字写在节点下面
    if (run && (run.summary || run.msg) && run.status !== 'idle') {
      var txt = run.status === 'error' ? '出错：' + run.msg : run.status === 'skip' ? '跳过（模型已锁定）' : run.status === 'wait' ? run.msg : run.summary;
      out.push('<text class="rsum" x="' + (x + 2) + '" y="' + (y + h + 15) + '" font-size="11.5" fill="' + (run.status === 'error' ? pal.err : run.status === 'skip' || run.status === 'wait' ? pal.skip : pal.ok) + '">' + esc(one('▸ ' + txt, w + 70, 11.5, ms)) + '</text>');
    }
    out.push('</g>');
    return out.join('');
  }

  /** 连线的两个端点：输出口 → 输入口；节点藏在折叠的环节里时，接到环节框的左右边。 */
  function ends(doc, e) {
    var a = M.get(doc, e.from), b = M.get(doc, e.to); if (!a || !b) return null;
    var va = M.get(doc, M.visibleId(doc, a.id)), vb = M.get(doc, M.visibleId(doc, b.id));
    if (va.id === vb.id && va.id !== a.id) return null;
    var p0 = va.id === a.id ? M.portPos(a, 'outs', e.fp) : (function () { var r = M.rectOf(va); return { x: r.x + r.w, y: r.y + r.h / 2 }; })();
    var p3 = vb.id === b.id ? M.portPos(b, 'ins', e.tp) : (function () { var r = M.rectOf(vb); return { x: r.x, y: r.y + r.h / 2 }; })();
    return { p0: p0, p3: p3 };
  }
  /** 口对口的曲线：从输出口往右出，进输入口时从左边进；倒着走（反馈线）时绕得大一点。 */
  function curve(p0, p3) {
    var dx = p3.x - p0.x, k = dx >= 0 ? Math.max(36, Math.min(160, dx * 0.5)) : Math.max(80, Math.min(240, -dx * 0.35 + 60));
    var c1 = { x: p0.x + k, y: p0.y }, c2 = { x: p3.x - k, y: p3.y };
    var mid = { x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8, y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8 };
    return { p0: p0, c1: c1, c2: c2, p3: p3, mid: mid, d: 'M' + f1(p0.x) + ' ' + f1(p0.y) + 'C' + f1(c1.x) + ' ' + f1(c1.y) + ' ' + f1(c2.x) + ' ' + f1(c2.y) + ' ' + f1(p3.x) + ' ' + f1(p3.y) };
  }
  /** 曲线上均匀取点（判断点没点到线用）。 */
  function samplePts(g, n) {
    var out = []; for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push({ x: u * u * u * g.p0.x + 3 * u * u * t * g.c1.x + 3 * u * t * t * g.c2.x + t * t * t * g.p3.x, y: u * u * u * g.p0.y + 3 * u * u * t * g.c1.y + 3 * u * t * t * g.c2.y + t * t * t * g.p3.y });
    }
    return out;
  }

  function edgeSvg(doc, e, o) {
    if (o.visible && (!o.visible.has(e.from) || !o.visible.has(e.to))) return '';
    var en = ends(doc, e); if (!en) return '';
    var g = curve(en.p0, en.p3), pal = o.pal, risk = o.risks && o.risks.edges[e.id];
    var sel = o.sel && o.sel.kind === 'edge' && o.sel.id === e.id, a = M.get(doc, e.from), po = M.port(a, 'outs', e.fp);
    var base = po ? portColor(po.type, pal) : pal.edge;
    var col = risk === 'red' ? pal.red : risk === 'yellow' ? pal.yellow : sel || o.dropEdge === e.id ? pal.sel : base, sw = risk || sel || o.dropEdge === e.id ? 3.2 : 2;
    var out = ['<g class="ed' + (o.pop && o.pop.has(e.id) ? ' pop' : '') + (e.fb ? ' fb' : '') + '" data-edge="' + esc(e.id) + '">'];
    out.push('<path d="' + g.d + '" fill="none" stroke="transparent" stroke-width="16"/>');
    out.push('<path class="ln" d="' + g.d + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-opacity="' + (risk || sel ? 1 : 0.85) + '"' + (e.fb ? ' stroke-dasharray="8 6"' : '') + '/>');
    // 小箭头：在线的 70% 处，指明方向
    var pts = samplePts(g, 20), pa = pts[14], pb = pts[15], tx = pb.x - pa.x, ty = pb.y - pa.y, tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    out.push('<path d="M' + f1(pb.x + tx * 5) + ' ' + f1(pb.y + ty * 5) + 'L' + f1(pb.x - tx * 4 - ty * 4.5) + ' ' + f1(pb.y - ty * 4 + tx * 4.5) + 'L' + f1(pb.x - tx * 4 + ty * 4.5) + ' ' + f1(pb.y - ty * 4 - tx * 4.5) + 'Z" fill="' + col + '"/>');
    var label = (e.fb ? '反馈' + (e.label ? '：' : '') : '') + (e.label || '') + (e.masked ? '（已脱敏）' : '');
    if (label && Math.hypot(g.p3.x - g.p0.x, g.p3.y - g.p0.y) > 90) {
      var lines = wrap(label, 150, 11, o.measure, 1), lw = Math.min(162, o.measure(lines[0] || '', 11) + 12);
      out.push('<rect x="' + f1(g.mid.x - lw / 2) + '" y="' + f1(g.mid.y - 10) + '" width="' + f1(lw) + '" height="19" rx="5" fill="' + pal.bg + '" stroke="' + col + '" stroke-width="1" opacity=".95"/>');
      out.push('<text x="' + f1(g.mid.x) + '" y="' + f1(g.mid.y + 4) + '" font-size="11" text-anchor="middle" fill="' + (risk ? col : pal.muted) + '">' + esc(lines[0] || '') + '</text>');
    }
    out.push('</g>');
    return out.join('');
  }

  function world(doc, o) {
    o = fill(o);
    var vis = function (n) { return !M.isHidden(doc, n.id) && (!o.visible || o.visible.has(n.id)); };
    var stages = doc.nodes.filter(function (n) { return n.type === 'stage' && vis(n); }).sort(function (a, b) { return M.depth(doc, a.id) - M.depth(doc, b.id); });
    var leaves = doc.nodes.filter(function (n) { return n.type !== 'stage' && vis(n); });
    var top = [];
    if (o.top) {
      var ids = {}; ids[o.top] = 1; M.descendants(doc, o.top).forEach(function (d) { ids[d.id] = 1; });
      top = stages.concat(leaves).filter(function (n) { return ids[n.id]; });
      stages = stages.filter(function (n) { return !ids[n.id]; }); leaves = leaves.filter(function (n) { return !ids[n.id]; });
    }
    var out = [];
    stages.forEach(function (n) { out.push(stageSvg(doc, n, o)); });
    doc.edges.forEach(function (e) { out.push(edgeSvg(doc, e, o)); });
    leaves.forEach(function (n) { out.push(nodeSvg(doc, n, o)); });
    top.forEach(function (n) { out.push(n.type === 'stage' ? stageSvg(doc, n, o) : nodeSvg(doc, n, o)); });
    (o.guides || []).forEach(function (g) { out.push('<line x1="' + g.x1 + '" y1="' + g.y1 + '" x2="' + g.x2 + '" y2="' + g.y2 + '" stroke="' + o.pal.guide + '" stroke-width="1" stroke-dasharray="4 3"/>'); });
    if (o.temp) {
      var g = curve({ x: o.temp.x1, y: o.temp.y1 }, { x: o.temp.x2, y: o.temp.y2 });
      out.push('<path d="' + g.d + '" fill="none" stroke="' + o.pal.sel + '" stroke-width="2.6" stroke-dasharray="7 5"/>');
      out.push('<circle cx="' + f1(o.temp.x2) + '" cy="' + f1(o.temp.y2) + '" r="5" fill="' + o.pal.sel + '"/>');
    }
    return out.join('');
  }

  function fill(o) {
    o = o || {}; var r = {}; for (var k in o) r[k] = o[k];
    r.pal = r.pal || C.PALETTES.light; r.measure = r.measure || approxMeasure; return r;
  }

  /** 完整 SVG（导出用）：白底，标题写在左上角。 */
  function standalone(doc, o) {
    o = fill(o); o.noButtons = true; o.sel = null; o.guides = null; o.temp = null; o.flash = null; o.pop = null; o.linking = null; o.hoverPort = null;
    var b = M.bounds(doc, o.visible) || { x: 0, y: 0, w: 400, h: 200 }, m = 30, head = 44;
    var vx = b.x - m, vy = b.y - m - head, vw = Math.max(420, b.w + 2 * m + 60), vh = b.h + 2 * m + head;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(vw) + '" height="' + Math.round(vh) + '" viewBox="' + vx + ' ' + vy + ' ' + vw + ' ' + vh + '" font-family=\'' + FONT + '\'>' +
      '<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vh + '" fill="' + o.pal.bg + '"/>' +
      '<text x="' + (vx + m) + '" y="' + (vy + 34) + '" font-size="20" font-weight="bold" fill="' + o.pal.ink + '">' + esc(doc.title || '') + '</text>' +
      world(doc, o) + '</svg>';
  }

  root.ABB = root.ABB || {};
  root.ABB.Render = { FONT: FONT, world: world, standalone: standalone, wrap: wrap, approxMeasure: approxMeasure, curve: curve, ends: ends, samplePts: samplePts,
    esc: esc, ICONS: ICONS, FILLED: FILLED, quadColor: quadColor, portColor: portColor, colors: colors, subtitle: subtitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Render;
})(typeof window !== 'undefined' ? window : globalThis);
