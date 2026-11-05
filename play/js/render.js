/* 把蓝图画成 SVG 字符串。画布显示和导出 PNG 用同一份代码；纯函数，Node 可测（量字宽用近似值）。
 *   Render.world(doc, opts)   画布里 <g> 的内容
 *   Render.standalone(doc, opts)  完整的 <svg>（导出用，白底、浅色）
 * opts: { pal, measure, sel: {kind,id}, risks: {nodes:{id:'red'|'yellow'}, edges:{}}, visible: Set|null,
 *         pop: Set, drop: 环节 id, top: 正在拖的方框 id, guides: [{x1,y1,x2,y2}], handles: bool, temp: {x1,y1,x2,y2},
 *         flash: id, connectFrom: id }
 */
(function (root) {
  'use strict';
  var C = (root.ABB && root.ABB.Config) || require('./config.js');
  var M = (root.ABB && root.ABB.Model) || require('./model.js');
  var FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Hiragino Sans GB",system-ui,sans-serif';

  var ICONS = {
    stage: 'M3 4h7v6H3z M14 4h7v6h-7z M8.5 16h7v5h-7z M6.5 10v3h11v-3 M12 13v3',
    human: 'M12 3.5a3.8 3.8 0 1 0 0.01 0 M4.5 21c0-4.3 3.4-7 7.5-7s7.5 2.7 7.5 7',
    ai: 'M12 2.5l2.3 6.2 6.2 2.3-6.2 2.3L12 19.5l-2.3-6.2L3.5 11l6.2-2.3z M19 17l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
    data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    ext: 'M9 2.5v5 M15 2.5v5 M6 7.5h12v4a6 6 0 0 1-12 0z M12 17.5v4'
  };

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
    // 单个很长的词也要截断
    return lines.map(function (l) { var s = l; while (s.length > 1 && measure(s, size, bold) > maxW) s = s.slice(0, -2) + '…'; return s; });
  }

  function textLines(lines, x, y0, lh, attrs) {
    return lines.map(function (l, i) { return '<text x="' + f1(x) + '" y="' + f1(y0 + i * lh) + '" ' + attrs + '>' + esc(l) + '</text>'; }).join('');
  }

  function icon(type, cx, cy, r, pal) {
    var col = pal[type].stroke, s = r * 2 * 0.62 / 24;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + col + '"/>' +
      '<path d="' + ICONS[type] + '" transform="translate(' + f1(cx - 12 * s) + ',' + f1(cy - 12 * s) + ') scale(' + f1(s * 1000) / 1000 + ')" fill="' +
      (type === 'ai' ? '#fff' : 'none') + '" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  function pill(x, y, text, color, measure, ink) {
    var w = measure(text, 11) + 12;
    return { w: w, svg: '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="17" rx="8.5" fill="' + color + '"/>' +
      '<text x="' + f1(x + w / 2) + '" y="' + f1(y + 12.5) + '" font-size="11" text-anchor="middle" fill="' + (ink || '#fff') + '">' + esc(text) + '</text>' };
  }

  function quadColor(q, pal) { return q === 'now' ? pal.loc.local : q === 'plan' ? pal.loc.private : q === 'skip' ? pal.level.secret : pal.level.open; }

  function stageSummary(doc, s) {
    var d = M.descendants(doc, s.id), ai = d.filter(function (n) { return n.type === 'ai'; }).length;
    var steps = d.filter(function (n) { return n.type !== 'stage'; }).length;
    return '含 ' + steps + ' 个方框 · ' + ai + ' 个 AI';
  }

  function nodeSvg(doc, n, o) {
    var pal = o.pal, ms = o.measure, r = M.rectOf(n), x = r.x, y = r.y, w = r.w, h = r.h, c = pal[n.type], out = [];
    var risk = o.risks && o.risks.nodes[n.id];
    var cls = 'nd t-' + n.type + (o.pop && o.pop.has(n.id) ? ' pop' : '') + (o.flash === n.id ? ' flash' : '') + (o.connectFrom === n.id ? ' cfrom' : '');
    out.push('<g class="' + cls + '" data-id="' + esc(n.id) + '">');
    if (n.type === 'stage') {
      var drop = o.drop === n.id;
      out.push('<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12" fill="' + c.fill + '" stroke="' + (drop ? pal.guide : c.stroke) + '" stroke-width="' + (drop ? 3 : 1.5) + '"' + (drop ? ' stroke-dasharray="8 5"' : '') + '/>');
      out.push('<path d="M' + (x + 1) + ' ' + (y + C.HEAD) + 'V' + (y + 12) + 'a11 11 0 0 1 11 -11H' + (x + w - 12) + 'a11 11 0 0 1 11 11V' + (y + C.HEAD) + 'z" fill="' + c.head + '"/>');
      out.push(icon('stage', x + 18, y + C.HEAD / 2, 11, pal));
      var tl = wrap(n.name, w - 80, 14, ms, 1, true);
      out.push(textLines(tl, x + 36, y + C.HEAD / 2 + 5, 18, 'font-size="14" font-weight="bold" fill="' + c.ink + '"'));
      if (!o.noButtons) {
        out.push('<g class="tog" data-act="toggle" data-id="' + esc(n.id) + '"><rect x="' + (x + w - 32) + '" y="' + (y + 5) + '" width="26" height="24" rx="6" fill="' + c.fill + '" stroke="' + c.stroke + '"/>' +
          '<text x="' + (x + w - 19) + '" y="' + (y + 22) + '" font-size="16" font-weight="bold" text-anchor="middle" fill="' + c.ink + '">' + (n.collapsed ? '+' : '−') + '</text></g>');
      }
      if (n.collapsed) out.push('<text x="' + (x + 14) + '" y="' + (y + C.HEAD + 25) + '" font-size="12" fill="' + pal.muted + '">' + esc(stageSummary(doc, n)) + '</text>');
      else if (!M.children(doc, n.id).length) out.push('<text x="' + (x + w / 2) + '" y="' + (y + C.HEAD + (h - C.HEAD) / 2 + 4) + '" font-size="12" text-anchor="middle" fill="' + pal.muted + '">把方框拖进来当小步骤</text>');
    } else {
      var stroke = risk === 'red' ? pal.red : risk === 'yellow' ? pal.yellow : c.stroke, sw = risk ? 3 : 1.5;
      if (n.type === 'data') {
        var ry = 8;
        out.push('<path class="box" d="M' + x + ' ' + (y + ry) + 'A' + (w / 2) + ' ' + ry + ' 0 0 1 ' + (x + w) + ' ' + (y + ry) + 'V' + (y + h - ry) + 'A' + (w / 2) + ' ' + ry + ' 0 0 1 ' + x + ' ' + (y + h - ry) + 'Z" fill="' + c.fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>');
        out.push('<path d="M' + x + ' ' + (y + ry) + 'A' + (w / 2) + ' ' + ry + ' 0 0 0 ' + (x + w) + ' ' + (y + ry) + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '"/>');
        out.push(icon('data', x + 20, y + 32, 11, pal));
        out.push(textLines(wrap(n.name, w - 44, 13, ms, 2, true), x + 37, y + 32, 16, 'font-size="13" font-weight="bold" fill="' + c.ink + '"'));
        var p1 = pill(x + 10, y + h - 27, C.LOCS[n.loc].name, pal.loc[n.loc], ms);
        var p2 = pill(x + 14 + p1.w, y + h - 27, C.LEVELS[n.level].name, pal.level[n.level], ms);
        out.push(p1.svg + p2.svg);
      } else {
        out.push('<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="' + c.fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + (n.type === 'ext' ? ' stroke-dasharray="6 4"' : '') + '/>');
        if (n.type === 'ai') out.push('<rect x="' + (x + 3.5) + '" y="' + (y + 3.5) + '" width="' + (w - 7) + '" height="' + (h - 7) + '" rx="7" fill="none" stroke="' + c.stroke + '" stroke-width="1" opacity=".7"/>');
        out.push(icon(n.type, x + 21, y + 22, 12, pal));
        out.push(textLines(wrap(n.name, w - 48, 13, ms, 2, true), x + 40, y + 27, 17, 'font-size="13" font-weight="bold" fill="' + c.ink + '"'));
        var sub = '';
        if (n.type === 'ai') sub = (n.aiType ? C.AI[n.aiType].name : '未选 AI 类型') + ' · ' + C.LOCS[n.loc].name;
        else if (n.type === 'ext') sub = '外部系统 · ' + C.LOCS[n.loc].name;
        else sub = n.role ? '人工 · ' + n.role : '人工';
        out.push(textLines(wrap(sub, w - 20, 11.5, ms, 1), x + 10, y + h - 10, 14, 'font-size="11.5" fill="' + pal.muted + '"'));
        if (n.type === 'ai') {
          var q = C.quadOf(n.value, n.effort);
          if (q) { var qw = ms(C.QUADS[q].name, 11) + 12; out.push(pill(x + w - qw - 6, y - 9, C.QUADS[q].name, quadColor(q, pal), ms).svg); }
        }
      }
      if (risk) {
        out.push('<circle cx="' + (x + 2) + '" cy="' + (y + 2) + '" r="9" fill="' + (risk === 'red' ? pal.red : pal.yellow) + '"/>' +
          '<text x="' + (x + 2) + '" y="' + (y + 6.5) + '" font-size="12" font-weight="bold" text-anchor="middle" fill="#fff">!</text>');
      }
    }
    if (o.sel && o.sel.kind === 'node' && o.sel.id === n.id) {
      out.push('<rect class="selbox" x="' + (x - 4) + '" y="' + (y - 4) + '" width="' + (w + 8) + '" height="' + (h + 8) + '" rx="13" fill="none" stroke="' + pal.sel + '" stroke-width="3"/>');
    }
    if (o.handles && o.handleId === n.id) {
      [['r', x + w, y + h / 2], ['b', x + w / 2, y + h], ['l', x, y + h / 2], ['t', x + w / 2, y]].forEach(function (p) {
        out.push('<g class="hdl" data-handle="' + esc(n.id) + '"><circle cx="' + p[1] + '" cy="' + p[2] + '" r="16" fill="transparent"/><circle cx="' + p[1] + '" cy="' + p[2] + '" r="6.5" fill="' + pal.bg + '" stroke="' + pal.sel + '" stroke-width="2.5"/></g>');
      });
    }
    out.push('</g>');
    return out.join('');
  }

  /** 两个矩形之间的曲线：横向距离大就从左右边出，否则从上下边出。 */
  function edgeGeom(ra, rb) {
    var ax = ra.x + ra.w / 2, ay = ra.y + ra.h / 2, bx = rb.x + rb.w / 2, by = rb.y + rb.h / 2, dx = bx - ax, dy = by - ay, p0, p3, n0, n3;
    if (Math.abs(dx) / (ra.w + rb.w) >= Math.abs(dy) / (ra.h + rb.h)) {
      var s = dx >= 0 ? 1 : -1;
      p0 = [ax + s * ra.w / 2, ay]; p3 = [bx - s * rb.w / 2, by]; n0 = [s, 0]; n3 = [-s, 0];
    } else {
      var t = dy >= 0 ? 1 : -1;
      p0 = [ax, ay + t * ra.h / 2]; p3 = [bx, by - t * rb.h / 2]; n0 = [0, t]; n3 = [0, -t];
    }
    var d = Math.max(24, Math.min(120, Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) * 0.4));
    var c1 = [p0[0] + n0[0] * d, p0[1] + n0[1] * d], c2 = [p3[0] + n3[0] * d, p3[1] + n3[1] * d];
    var mid = [(p0[0] + 3 * c1[0] + 3 * c2[0] + p3[0]) / 8, (p0[1] + 3 * c1[1] + 3 * c2[1] + p3[1]) / 8];
    return { p0: p0, c1: c1, c2: c2, p3: p3, mid: mid };
  }

  function edgeSvg(doc, e, o) {
    var a = M.get(doc, M.visibleId(doc, e.from)), b = M.get(doc, M.visibleId(doc, e.to));
    if (!a || !b || a.id === b.id) return '';
    if (o.visible && (!o.visible.has(e.from) || !o.visible.has(e.to))) return '';
    var g = edgeGeom(M.rectOf(a), M.rectOf(b)), pal = o.pal, risk = o.risks && o.risks.edges[e.id];
    var sel = o.sel && o.sel.kind === 'edge' && o.sel.id === e.id;
    var col = risk === 'red' ? pal.red : risk === 'yellow' ? pal.yellow : sel ? pal.sel : pal.edge, sw = risk || sel ? 3 : 1.8;
    // 箭头：沿终点切线方向，曲线终点往回缩一点，避免线头戳出箭头
    var tx = g.p3[0] - g.c2[0], ty = g.p3[1] - g.c2[1], tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    var L = 11, W = 5.5, bx = g.p3[0] - tx * L, by = g.p3[1] - ty * L;
    var dpath = 'M' + f1(g.p0[0]) + ' ' + f1(g.p0[1]) + 'C' + f1(g.c1[0]) + ' ' + f1(g.c1[1]) + ' ' + f1(g.c2[0]) + ' ' + f1(g.c2[1]) + ' ' + f1(bx) + ' ' + f1(by);
    var out = ['<g class="ed' + (o.pop && o.pop.has(e.id) ? ' pop' : '') + '" data-edge="' + esc(e.id) + '">'];
    out.push('<path d="' + dpath + '" fill="none" stroke="transparent" stroke-width="16"/>');
    out.push('<path class="ln" d="' + dpath + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '"' + (e.kind === 'data' ? ' stroke-dasharray="7 5"' : '') + '/>');
    out.push('<path d="M' + f1(g.p3[0]) + ' ' + f1(g.p3[1]) + 'L' + f1(bx - ty * W) + ' ' + f1(by + tx * W) + 'L' + f1(bx + ty * W) + ' ' + f1(by - tx * W) + 'Z" fill="' + col + '"/>');
    var label = (e.label || '') + (e.masked ? (e.label ? '（已脱敏）' : '已脱敏') : '');
    if (label) {
      var lw = Math.min(160, o.measure(label, 11.5) + 12), lines = wrap(label, 148, 11.5, o.measure, 1);
      out.push('<rect x="' + f1(g.mid[0] - lw / 2) + '" y="' + f1(g.mid[1] - 10) + '" width="' + f1(lw) + '" height="19" rx="5" fill="' + pal.bg + '" stroke="' + col + '" stroke-width="1" opacity=".95"/>');
      out.push('<text x="' + f1(g.mid[0]) + '" y="' + f1(g.mid[1] + 4) + '" font-size="11.5" text-anchor="middle" fill="' + (risk ? col : pal.muted) + '">' + esc(lines[0] || '') + '</text>');
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
    stages.forEach(function (n) { out.push(nodeSvg(doc, n, o)); });
    doc.edges.forEach(function (e) { out.push(edgeSvg(doc, e, o)); });
    leaves.forEach(function (n) { out.push(nodeSvg(doc, n, o)); });
    top.forEach(function (n) { out.push(nodeSvg(doc, n, o)); });
    (o.guides || []).forEach(function (g) { out.push('<line x1="' + g.x1 + '" y1="' + g.y1 + '" x2="' + g.x2 + '" y2="' + g.y2 + '" stroke="' + o.pal.guide + '" stroke-width="1" stroke-dasharray="4 3"/>'); });
    if (o.temp) out.push('<line x1="' + f1(o.temp.x1) + '" y1="' + f1(o.temp.y1) + '" x2="' + f1(o.temp.x2) + '" y2="' + f1(o.temp.y2) + '" stroke="' + o.pal.sel + '" stroke-width="2.5" stroke-dasharray="6 4"/>');
    return out.join('');
  }

  function fill(o) {
    o = o || {}; var r = {}; for (var k in o) r[k] = o[k];
    r.pal = r.pal || C.PALETTES.light; r.measure = r.measure || approxMeasure; return r;
  }

  /** 完整 SVG（导出用）：白底，标题写在左上角。 */
  function standalone(doc, o) {
    o = fill(o); o.noButtons = true; o.sel = null; o.handles = false; o.guides = null; o.temp = null; o.flash = null; o.pop = null;
    var b = M.bounds(doc, o.visible) || { x: 0, y: 0, w: 400, h: 200 }, m = 30, head = 44;
    var vx = b.x - m, vy = b.y - m - head, vw = Math.max(420, b.w + 2 * m), vh = b.h + 2 * m + head;
    var title = esc(doc.title || '');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + vw + '" height="' + vh + '" viewBox="' + vx + ' ' + vy + ' ' + vw + ' ' + vh + '" font-family=\'' + FONT + '\'>' +
      '<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vh + '" fill="' + o.pal.bg + '"/>' +
      '<text x="' + (vx + m) + '" y="' + (vy + 34) + '" font-size="20" font-weight="bold" fill="' + o.pal.ink + '">' + title + '</text>' +
      world(doc, o) + '</svg>';
  }

  root.ABB = root.ABB || {};
  root.ABB.Render = { FONT: FONT, world: world, standalone: standalone, wrap: wrap, approxMeasure: approxMeasure, edgeGeom: edgeGeom, esc: esc, ICONS: ICONS, quadColor: quadColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Render;
})(typeof window !== 'undefined' ? window : globalThis);
