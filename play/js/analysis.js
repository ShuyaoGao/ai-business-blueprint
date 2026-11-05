/* 统计、红黄提醒、四格图、Markdown 清单。纯函数，Node 可测。
 *
 * 红黄规则（只看直接连线：数据被中间的 AI 处理过以后已经变成别的东西）：
 *   红：敏感 / 机密数据存在公有云；或者有一条线从它直接连到运行在公有云的 AI / 外部系统 / 数据，且没勾「已脱敏」。
 *   黄：机密数据放在私有云；或者敏感 / 机密数据经「已脱敏」的线上了公有云（提醒确认脱敏到位）。
 * visible（Set，可选）：观看模式只统计已经出现的方框。
 */
(function (root) {
  'use strict';
  var C = (root.ABB && root.ABB.Config) || require('./config.js');
  var M = (root.ABB && root.ABB.Model) || require('./model.js');

  function vis(visible) { return function (n) { return !visible || visible.has(n.id); }; }
  function isSens(n) { return n.level === 'sensitive' || n.level === 'secret'; }

  function risks(doc, visible) {
    var ok = vis(visible), list = [], map = { nodes: {}, edges: {} };
    function mark(kind, id, level) { if (map[kind][id] !== 'red') map[kind][id] = level; }
    doc.nodes.forEach(function (d) {
      if (d.type !== 'data' || !ok(d)) return;
      var lv = C.LEVELS[d.level].name;
      if (isSens(d) && d.loc === 'public') {
        list.push({ level: 'red', node: d.id, text: '「' + d.name + '」是' + lv + '数据，却存在公有云。', fix: '改存本地或私有云，或者只把脱敏后的版本放上云。' });
        mark('nodes', d.id, 'red');
      } else if (d.level === 'secret' && d.loc === 'private') {
        list.push({ level: 'yellow', node: d.id, text: '「' + d.name + '」是机密数据，放在私有云。', fix: '核心机密建议放本地；放私有云要确认服务商合同和访问权限。' });
        mark('nodes', d.id, 'yellow');
      }
      if (!isSens(d)) return;
      doc.edges.forEach(function (e) {
        if (e.from !== d.id) return;
        var t = M.get(doc, e.to);
        if (!t || !ok(t) || ['ai', 'ext', 'data'].indexOf(t.type) < 0 || t.loc !== 'public') return;
        var where = t.type === 'ai' ? '运行在公有云的 AI「' + t.name + '」' : t.type === 'ext' ? '公有云上的外部系统「' + t.name + '」' : '公有云上的数据「' + t.name + '」';
        if (e.masked) {
          list.push({ level: 'yellow', node: d.id, edge: e.id, text: '「' + d.name + '」（' + lv + '）脱敏后送到' + where + '。', fix: '确认脱敏到位：姓名、电话、证件号、能反推出人的组合都去掉了。' });
          mark('edges', e.id, 'yellow'); mark('nodes', d.id, 'yellow');
        } else {
          list.push({ level: 'red', node: d.id, edge: e.id, text: '「' + d.name + '」（' + lv + '）直接送进了' + where + '。', fix: '三选一：AI 改成本地 / 私有云部署；只传脱敏后的数据（勾「已脱敏」）；或者不传。' });
          mark('edges', e.id, 'red'); mark('nodes', d.id, 'red');
        }
      });
    });
    list.sort(function (a, b) { return (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1); });
    var red = list.filter(function (r) { return r.level === 'red'; }).length;
    return { list: list, map: map, red: red, yellow: list.length - red };
  }

  /** 环节的路径名：大环节 › 小环节 */
  function stagePath(doc, s) { return M.ancestors(doc, s.id).reverse().map(function (a) { return a.name; }).concat([s.name]).join(' › '); }

  /** 按画面顺序（从左到右、从上到下）展开所有环节。 */
  function stagesInOrder(doc, ok) {
    var out = [];
    function walk(pid) { M.ordered(doc.nodes.filter(function (n) { return n.type === 'stage' && n.parent === pid && ok(n); })).forEach(function (s) { out.push(s); walk(s.id); }); }
    walk(null); return out;
  }

  function stats(doc, visible) {
    var ok = vis(visible), nodes = doc.nodes.filter(ok);
    var cnt = {}; C.TYPE_ORDER.forEach(function (k) { cnt[k] = 0; }); nodes.forEach(function (n) { cnt[n.type]++; });
    var stages = stagesInOrder(doc, ok).map(function (s) {
      var d = M.descendants(doc, s.id).filter(ok), ais = d.filter(function (n) { return n.type === 'ai'; });
      var types = {}; ais.forEach(function (a) { var k = a.aiType || ''; types[k] = (types[k] || 0) + 1; });
      return { id: s.id, name: s.name, path: stagePath(doc, s), depth: M.depth(doc, s.id), ai: ais.length, human: d.filter(function (n) { return n.type === 'human'; }).length, types: types };
    });
    var aiByType = {}, unrated = 0, untyped = 0, aiLoc = { local: 0, private: 0, public: 0 };
    nodes.forEach(function (n) {
      if (n.type !== 'ai') return;
      if (n.aiType) aiByType[n.aiType] = (aiByType[n.aiType] || 0) + 1; else untyped++;
      if (!n.value || !n.effort) unrated++;
      aiLoc[n.loc]++;
    });
    var data = {}; C.LOC_ORDER.forEach(function (l) { data[l] = {}; C.LEVEL_ORDER.forEach(function (v) { data[l][v] = 0; }); });
    nodes.forEach(function (n) { if (n.type === 'data') data[n.loc][n.level]++; });
    return { counts: cnt, stages: stages, stagesWithAI: stages.filter(function (s) { return s.ai > 0; }).length,
      aiByType: aiByType, untyped: untyped, unrated: unrated, aiLoc: aiLoc, data: data, edges: doc.edges.length };
  }

  /** 四格图：每格里的 AI 方框，按画面顺序编号。 */
  function quad(doc, visible) {
    var ok = vis(visible), out = { now: [], plan: [], easy: [], skip: [], unrated: [] }, num = 0;
    aiInOrder(doc, ok).forEach(function (n) {
      var q = C.quadOf(n.value, n.effort);
      if (q) out[q].push({ id: n.id, name: n.name, value: n.value, effort: n.effort, num: ++num }); else out.unrated.push({ id: n.id, name: n.name });
    });
    return out;
  }
  function aiInOrder(doc, ok) {
    var out = [];
    stagesInOrder(doc, ok).forEach(function (s) { M.ordered(M.children(doc, s.id).filter(function (n) { return n.type === 'ai' && ok(n); })).forEach(function (n) { out.push(n); }); });
    M.ordered(doc.nodes.filter(function (n) { return n.type === 'ai' && !n.parent && ok(n); })).forEach(function (n) { out.push(n); });
    return out;
  }

  // ---------------- Markdown 清单 ----------------
  function cell(s) { return String(s == null || s === '' ? '—' : s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' '); }
  function dataUsed(doc, n, ok) {
    var seen = {}, out = [];
    doc.edges.forEach(function (e) {
      var o = e.from === n.id ? e.to : e.to === n.id ? e.from : null; if (!o || seen[o]) return;
      var d = M.get(doc, o); if (!d || d.type !== 'data' || !ok(d)) return;
      seen[o] = 1; out.push(d.name + '（' + C.LOCS[d.loc].name + '·' + C.LEVELS[d.level].name + '）');
    });
    return out.join('；');
  }
  function who(n) {
    if (n.type === 'human') return '人工' + (n.role ? '（' + n.role + '）' : '');
    if (n.type === 'ai') return 'AI：' + (n.aiType ? C.AI[n.aiType].name : '未选类型') + '（' + C.LOCS[n.loc].name + '）';
    if (n.type === 'ext') return '外部系统（' + C.LOCS[n.loc].name + '）';
    return '';
  }

  function markdown(doc, visible) {
    var ok = vis(visible), st = stats(doc, visible), rk = risks(doc, visible), q = quad(doc, visible), L = [];
    L.push('# ' + (doc.title || 'AI 业务蓝图'));
    L.push('');
    L.push('> 由「AI 业务拆解画板」导出。主表：每个环节里的每一步由谁来做、用哪类 AI、输入输出、用到的数据放在哪。');
    L.push('');
    L.push('## 概览');
    L.push('');
    L.push('- 业务环节 ' + st.stages.length + ' 个，其中 **' + st.stagesWithAI + ' 个用了 AI**');
    L.push('- AI 步骤 ' + st.counts.ai + ' 个，人工步骤 ' + st.counts.human + ' 个，数据 ' + st.counts.data + ' 份，外部系统 ' + st.counts.ext + ' 个');
    var types = C.AI_ORDER.filter(function (k) { return st.aiByType[k]; }).map(function (k) { return C.AI[k].name + ' ' + st.aiByType[k]; });
    if (st.untyped) types.push('未选类型 ' + st.untyped);
    if (types.length) L.push('- 各类 AI：' + types.join('，'));
    L.push('- 风险提醒：红 ' + rk.red + ' 条，黄 ' + rk.yellow + ' 条');
    L.push('');
    L.push('## 环节 → 用什么 AI → 数据放哪');
    L.push('');
    L.push('| 环节 | 步骤 | 谁来做 | 输入 | 输出 | 用到的数据（位置·等级） | 业务价值 | 落地难度 |');
    L.push('|---|---|---|---|---|---|---|---|');
    var rows = 0;
    function row(stageName, n) {
      L.push('| ' + [cell(stageName), cell(n.name + (n.desc ? '：' + n.desc : '')), cell(who(n)), cell(n.type === 'ai' ? n.input : ''), cell(n.type === 'ai' ? n.output : ''),
        cell(dataUsed(doc, n, ok)), cell(n.type === 'ai' ? C.HML[n.value] : ''), cell(n.type === 'ai' ? C.HML[n.effort] : '')].join(' | ') + ' |');
      rows++;
    }
    stagesInOrder(doc, ok).forEach(function (s) {
      M.ordered(M.children(doc, s.id).filter(function (n) { return ok(n) && (n.type === 'human' || n.type === 'ai' || n.type === 'ext'); })).forEach(function (n) { row(stagePath(doc, s), n); });
    });
    M.ordered(doc.nodes.filter(function (n) { return ok(n) && !n.parent && (n.type === 'human' || n.type === 'ai'); })).forEach(function (n) { row('（未归入环节）', n); });
    if (!rows) L.push('| — | — | — | — | — | — | — | — |');
    L.push('');

    L.push('## AI 落地优先级（四格图）');
    L.push('');
    ['now', 'plan', 'easy', 'skip'].forEach(function (k) {
      L.push('- **' + C.QUADS[k].name + '**（' + C.QUADS[k].tip + '）：' + (q[k].length ? q[k].map(function (x) { return x.name; }).join('、') : '—'));
    });
    if (q.unrated.length) L.push('- 还没打分：' + q.unrated.map(function (x) { return x.name; }).join('、'));
    L.push('');

    var datas = doc.nodes.filter(function (n) { return n.type === 'data' && ok(n); });
    L.push('## 数据清单');
    L.push('');
    L.push('| 数据 | 敏感等级 | 存放位置 | 流向 | 提醒 |');
    L.push('|---|---|---|---|---|');
    M.ordered(datas).forEach(function (d) {
      var to = doc.edges.filter(function (e) { return e.from === d.id; }).map(function (e) { var t = M.get(doc, e.to); return ok(t) ? t.name + (t.loc && t.type !== 'stage' && t.type !== 'human' ? '（' + C.LOCS[t.loc].name + '）' : '') + (e.masked ? '·已脱敏' : '') : null; }).filter(Boolean);
      var lv = rk.map.nodes[d.id];
      L.push('| ' + [cell(d.name), cell(C.LEVELS[d.level].name), cell(C.LOCS[d.loc].name), cell(to.join('；')), lv === 'red' ? '🔴 标红' : lv === 'yellow' ? '🟡 标黄' : '—'].join(' | ') + ' |');
    });
    if (!datas.length) L.push('| — | — | — | — | — |');
    L.push('');

    L.push('## 风险提醒');
    L.push('');
    if (!rk.list.length) L.push('没有发现敏感数据流向公有云。');
    rk.list.forEach(function (r) { L.push('- ' + (r.level === 'red' ? '🔴 ' : '🟡 ') + r.text + ' 建议：' + r.fix); });
    L.push('');
    var ext = doc.nodes.filter(function (n) { return n.type === 'ext' && ok(n); });
    if (ext.length) {
      L.push('## 外部系统');
      L.push('');
      M.ordered(ext).forEach(function (n) { L.push('- ' + n.name + '（' + C.LOCS[n.loc].name + '）' + (n.desc ? '：' + n.desc : '')); });
      L.push('');
    }
    L.push('---');
    L.push('');
    L.push('规则说明：敏感等级分公开 / 内部 / 敏感 / 机密；存放位置分本地 / 私有云 / 公有云。敏感或机密数据存在公有云，或直接流向运行在公有云的 AI / 外部系统，标红；机密数据放私有云、或脱敏后上公有云，标黄。四格图里「中」算进高的一边。');
    return L.join('\n') + '\n';
  }

  root.ABB = root.ABB || {};
  root.ABB.Analysis = { risks: risks, stats: stats, quad: quad, markdown: markdown, stagePath: stagePath, stagesInOrder: stagesInOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Analysis;
})(typeof window !== 'undefined' ? window : globalThis);
