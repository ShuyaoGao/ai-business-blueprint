/* 检查、红黄提醒、统计、四格图、Markdown 清单。纯函数，Node 可测。
 *
 * checks：流程接得对不对（必填口没接、监督学习接了无标签数据、拿训练集考模型、模型没评估……）
 * risks ：敏感数据有没有流出公司。顺着连线往下走，穿过清洗、拆分、预测这类「数据还在」的节点；
 *         碰到运行在公有云的节点（训练、预测、AI 服务、外部系统、存档）就提醒：
 *         没经过「脱敏」节点、线上也没勾「已脱敏」→ 红；脱敏过 → 黄（提醒确认脱敏到位）。
 *         敏感 / 机密数据本身存在公有云 → 红；机密数据放私有云 → 黄。
 * visible（Set，可选）：观看模式只算已经出现的节点。
 */
(function (root) {
  'use strict';
  var C = (root.ABB && root.ABB.Config) || require('./config.js');
  var M = (root.ABB && root.ABB.Model) || require('./model.js');

  function vis(visible) { return function (n) { return !!n && (!visible || visible.has(n.id)); }; }
  function isSens(n) { return n.level === 'sensitive' || n.level === 'secret'; }
  function isData(n) { return n.type === 'src' || n.type === 'newdata'; }
  function nm(n) { return '「' + n.name + '」'; }
  function liveEdges(doc, ok) { return doc.edges.filter(function (e) { return ok(M.get(doc, e.from)) && ok(M.get(doc, e.to)); }); }

  // ================= 流程检查 =================
  var FEED_HINT = {
    table: '从数据源或上一步的输出口拖一条线过来',
    model: '接一个「训练模型」或「模型」节点过来',
    metric: '接一个「评估」节点过来',
    media: '接一个文字 / 图片 / 录音的数据源过来',
    any: '把上一步接过来'
  };
  function checks(doc, visible) {
    var ok = vis(visible), out = [], edges = liveEdges(doc, ok);
    function add(level, node, text, fix, edge) { out.push({ level: level, node: node, edge: edge || null, text: text, fix: fix || '' }); }
    function fed(id, pid) { return edges.filter(function (e) { return e.to === id && e.tp === pid && !e.fb; })[0] || null; }
    function outs(id) { return edges.filter(function (e) { return e.from === id; }); }
    var nodes = doc.nodes.filter(function (n) { return n.type !== 'stage' && ok(n); });
    var hasEval = nodes.some(function (n) { return n.type === 'evaluate'; });
    nodes.forEach(function (n) {
      var ps = M.ports(n);
      ps.ins.forEach(function (p) {
        if (p.req && !fed(n.id, p.id)) add('yellow', n.id, nm(n) + '的输入口「' + p.name + '」还没接上。', FEED_HINT[C.PORTS[p.type].cat]);
      });
      var e, inf;
      switch (n.type) {
        case 'src':
          if (n.form === 'table' && n.labeled && !n.target) add('yellow', n.id, nm(n) + '说有标签，但没写标签是哪一列。', '在属性里填「标签列」：就是答案那一列，比如「销量」「是否流失」。');
          if (!outs(n.id).length) add('yellow', n.id, nm(n) + '还没用上。', '从右边的输出口拖一条线到要用它的节点。');
          break;
        case 'newdata':
          if (!outs(n.id).length) add('yellow', n.id, nm(n) + '还没接到「预测」节点。', '新数据就是给模型预测用的：接到「预测」的「新数据」口。');
          break;
        case 'label':
          if (!n.target) add('yellow', n.id, nm(n) + '没写要标的是哪一列。', '在属性里填「标签列」，比如「是否缺陷」。');
          break;
        case 'train':
          var al = C.ALGOS[n.algo];
          if (!al) { add('yellow', n.id, nm(n) + '还没选算法。', '在属性里选：预测数字选随机森林 / 线性回归；分类选逻辑回归 / 决策树；不知道答案就分群（K-means）。'); break; }
          e = fed(n.id, 'in'); inf = e ? M.info(doc, e.from, e.fp) : null;
          if (al.sup && inf && inf.labeled === false) add('red', n.id, nm(n) + '用的「' + al.name + '」是监督学习，要有标签的数据；接进来的数据没有标签。', '在前面加一个「人工标注」节点补上答案；或者换成不用标签的 K-means / 异常检测。', e.id);
          else if (al.sup && inf && inf.labeled && !(n.target || inf.target)) add('yellow', n.id, nm(n) + '不知道要预测哪一列。', '在数据源里填「标签列」，或者在训练节点里填。');
          if (!outs(n.id).length) add('yellow', n.id, nm(n) + '训练出的模型没接出去。', '接一个「模型」节点存起来，再从模型接到「评估」和「预测」。');
          if (!hasEval) add('yellow', n.id, '整张图里没有「评估」：不知道' + nm(n) + '训练出的模型准不准。', '加一个「评估」节点：一边接模型，一边接测试集。');
          if (!al.run) add('info', n.id, al.name + '只画图，浏览器里不运行。', '想在课上看到结果，可以先换成随机森林。');
          break;
        case 'evaluate':
          e = fed(n.id, 'test'); inf = e ? M.info(doc, e.from, e.fp) : null;
          if (inf && inf.labeled === false) add('red', n.id, nm(n) + '的测试集没有标签，没法知道模型答对了没有。', '测试集要从有标签的数据里拆出来（「拆分训练 / 测试」的「测试集」口）。', e.id);
          if (e && e.fp === 'train' && M.get(doc, e.from).type === 'split') add('red', n.id, nm(n) + '拿训练集考模型：模型见过这些题，分数会虚高。', '改接「拆分」的「测试集」口。', e.id);
          break;
        case 'model':
          if (!outs(n.id).some(function (x) { var t = M.get(doc, x.to); return t && t.type === 'predict'; })) add('yellow', n.id, nm(n) + '还没拿去预测。', '接一个「预测」节点，再给它接上新数据：模型就是用来反复预测的。');
          break;
        case 'predict':
          if (!outs(n.id).length) add('yellow', n.id, nm(n) + '的预测结果没人用。', '接到「规则判断」「人工步骤」或「业务动作」：预测完要有人或系统据此做事。');
          break;
        case 'ai':
          if (!n.aiType) add('yellow', n.id, nm(n) + '还没选 AI 类型。', '在属性里选一类：大模型、OCR、语音、优化……');
          break;
      }
    });
    return out;
  }

  // ================= 数据安全：红黄提醒 =================
  var PASS = { clean: 1, feature: 1, split: 1, join: 1, label: 1, rule: 1, collect: 1, mask: 1, predict: 1, human: 1 };
  var SINK = { train: 1, predict: 1, ai: 1, ext: 1, store: 1 };
  function where(t) {
    if (t.type === 'ai') return '运行在公有云的 AI' + nm(t);
    if (t.type === 'train') return '在公有云上训练的' + nm(t);
    if (t.type === 'predict') return '在公有云上运行的预测' + nm(t);
    if (t.type === 'ext') return '公有云上的外部系统' + nm(t);
    return '公有云上的存档' + nm(t);
  }
  function risks(doc, visible) {
    var ok = vis(visible), list = [], map = { nodes: {}, edges: {} }, edges = liveEdges(doc, ok);
    function mark(kind, id, level) { if (map[kind][id] !== 'red') map[kind][id] = level; }
    doc.nodes.forEach(function (d) {
      if (!isData(d) || !ok(d)) return;
      var lv = C.LEVELS[d.level].name;
      if (isSens(d) && d.loc === 'public') {
        list.push({ level: 'red', node: d.id, text: nm(d) + '是' + lv + '数据，却存在公有云。', fix: '改存本地或私有云，或者只把脱敏后的版本放上云。' }); mark('nodes', d.id, 'red');
      } else if (d.level === 'secret' && d.loc === 'private') {
        list.push({ level: 'yellow', node: d.id, text: nm(d) + '是机密数据，放在私有云。', fix: '核心机密建议放本地；放私有云要确认服务商合同和访问权限。' }); mark('nodes', d.id, 'yellow');
      }
      if (!isSens(d)) return;
      // 顺着连线往下走：数据还在的节点继续走，碰到公有云就记下来
      var seen = {}, queue = [{ id: d.id, masked: false, path: [] }];
      while (queue.length) {
        var cur = queue.shift();
        edges.forEach(function (e) {
          if (e.from !== cur.id || e.fb) return;
          var t = M.get(doc, e.to), masked = cur.masked || !!e.masked || t.type === 'mask', key = t.id + (masked ? '+' : '-');
          if (seen[key]) return; seen[key] = 1;
          if (SINK[t.type] && t.loc === 'public' && !(t.type === 'predict' && e.tp === 'model')) {
            var via = cur.path.length ? '（经过' + cur.path.map(function (p) { return '「' + p + '」'; }).join('→') + '）' : '';
            if (masked) {
              list.push({ level: 'yellow', node: d.id, target: t.id, edge: e.id, text: nm(d) + '（' + lv + '）脱敏后' + via + '送到' + where(t) + '。', fix: '确认脱敏到位：姓名、电话、证件号、能反推出人的组合都去掉了。' });
              mark('edges', e.id, 'yellow'); mark('nodes', d.id, 'yellow'); mark('nodes', t.id, 'yellow');
            } else {
              list.push({ level: 'red', node: d.id, target: t.id, edge: e.id, text: nm(d) + '（' + lv + '）没脱敏' + via + '就送进了' + where(t) + '。', fix: '三选一：把' + nm(t) + '改成本地 / 私有云运行；在中间插一个「脱敏」节点（或勾「已脱敏」）；或者不传。' });
              mark('edges', e.id, 'red'); mark('nodes', d.id, 'red'); mark('nodes', t.id, 'red');
            }
          }
          if (PASS[t.type] && !(t.type === 'predict' && e.tp === 'model')) queue.push({ id: t.id, masked: masked, path: cur.path.concat([t.name]).slice(-3) });
        });
      }
    });
    list.sort(function (a, b) { return (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1); });
    var red = list.filter(function (r) { return r.level === 'red'; }).length;
    return { list: list, map: map, red: red, yellow: list.length - red };
  }

  // ================= 统计 =================
  function stagePath(doc, s) { return M.ancestors(doc, s.id).reverse().map(function (a) { return a.name; }).concat([s.name]).join(' › '); }
  function stagesInOrder(doc, ok) {
    var out = [];
    function walk(pid) { M.ordered(doc.nodes.filter(function (n) { return n.type === 'stage' && n.parent === pid && ok(n); })).forEach(function (s) { out.push(s); walk(s.id); }); }
    walk(null); return out;
  }
  function isAI(n) { return n.type === 'train' || n.type === 'predict' || n.type === 'ai'; }

  function stats(doc, visible) {
    var ok = vis(visible), nodes = doc.nodes.filter(function (n) { return n.type !== 'stage' && ok(n); }), edges = liveEdges(doc, ok);
    var byKind = {}, byGroup = {};
    nodes.forEach(function (n) { byKind[n.type] = (byKind[n.type] || 0) + 1; var g = C.KINDS[n.type].group; byGroup[g] = (byGroup[g] || 0) + 1; });
    var stages = stagesInOrder(doc, ok).map(function (s) {
      var d = M.descendants(doc, s.id).filter(function (n) { return n.type !== 'stage' && ok(n); });
      var kinds = {}; d.forEach(function (n) { kinds[n.type] = (kinds[n.type] || 0) + 1; });
      return { id: s.id, name: s.name, path: stagePath(doc, s), depth: M.depth(doc, s.id), nodes: d.length, ai: d.filter(isAI).length, kinds: kinds };
    });
    var algos = {}, aiTypes = {}, untyped = 0;
    nodes.forEach(function (n) {
      if (n.type === 'train') { if (n.algo) algos[n.algo] = (algos[n.algo] || 0) + 1; else untyped++; }
      if (n.type === 'ai') { if (n.aiType) aiTypes[n.aiType] = (aiTypes[n.aiType] || 0) + 1; else untyped++; }
    });
    // 每个模型被几个预测节点用（「训练一次，反复用」）
    var models = nodes.filter(function (n) { return n.type === 'model'; }).map(function (m) {
      var users = edges.filter(function (e) { return e.from === m.id; }).map(function (e) { return M.get(doc, e.to); }).filter(function (t) { return t.type === 'predict'; });
      var tr = edges.filter(function (e) { return e.to === m.id; }).map(function (e) { return M.get(doc, e.from); })[0];
      var ev = edges.filter(function (e) { return e.from === m.id; }).map(function (e) { return M.get(doc, e.to); }).filter(function (t) { return t.type === 'evaluate'; });
      return { id: m.id, name: m.name, version: m.version, locked: !!m.locked, trained: !!m.trained, algo: tr && tr.algo ? C.ALGOS[tr.algo].name : m.trained ? m.trained.algoName : '', uses: users.length, users: users.map(function (u) { return u.name; }), evaluated: ev.length > 0 };
    });
    var data = {}; C.LOC_ORDER.forEach(function (l) { data[l] = {}; C.LEVEL_ORDER.forEach(function (v) { data[l][v] = 0; }); });
    var labeled = 0, unlabeled = 0, withCsv = 0;
    nodes.forEach(function (n) {
      if (!isData(n)) return;
      data[n.loc][n.level]++;
      if (n.form === 'table') { if (n.type === 'src' && n.labeled) labeled++; else unlabeled++; }
      if (n.csv) withCsv++;
    });
    var aiLoc = { local: 0, private: 0, public: 0 };
    nodes.forEach(function (n) { if (isAI(n)) aiLoc[n.loc]++; });
    return { nodes: nodes.length, edges: edges.length, byKind: byKind, byGroup: byGroup, stages: stages, stagesWithAI: stages.filter(function (s) { return s.ai > 0; }).length,
      algos: algos, aiTypes: aiTypes, untyped: untyped, models: models, data: data, labeled: labeled, unlabeled: unlabeled, withCsv: withCsv, aiLoc: aiLoc,
      feedback: edges.filter(function (e) { return e.fb; }).length };
  }

  // ================= 四格图：训练节点和 AI 服务打分 =================
  function scored(doc, ok) { return M.topo(doc).filter(function (n) { return (n.type === 'train' || n.type === 'ai') && ok(n); }); }
  function quad(doc, visible) {
    var ok = vis(visible), out = { now: [], plan: [], easy: [], skip: [], unrated: [] }, num = 0;
    scored(doc, ok).forEach(function (n) {
      var q = C.quadOf(n.value, n.effort);
      if (q) out[q].push({ id: n.id, name: n.name, value: n.value, effort: n.effort, num: ++num }); else out.unrated.push({ id: n.id, name: n.name });
    });
    return out;
  }

  // ================= 节点的输入、输出、关键设置（清单和属性栏共用） =================
  function inputsOf(doc, n, ok) {
    return M.ports(n).ins.map(function (p) {
      var es = doc.edges.filter(function (e) { return e.to === n.id && e.tp === p.id && ok(M.get(doc, e.from)); });
      return { port: p, from: es.map(function (e) { var f = M.get(doc, e.from), fp = M.port(f, 'outs', e.fp); return { node: f, port: fp, edge: e }; }) };
    });
  }
  function outputsOf(doc, n, ok) {
    return M.ports(n).outs.map(function (p) {
      var es = doc.edges.filter(function (e) { return e.from === n.id && e.fp === p.id && ok(M.get(doc, e.to)); });
      return { port: p, to: es.map(function (e) { var t = M.get(doc, e.to), tp = M.port(t, 'ins', e.tp); return { node: t, port: tp, edge: e }; }) };
    });
  }
  function settings(doc, n) {
    var s = [];
    switch (n.type) {
      case 'src': case 'newdata':
        s.push(C.FORMS[n.form].name);
        if (n.form === 'table') s.push(n.type === 'src' && n.labeled ? '有标签' + (n.target ? '（标签列：' + n.target + '）' : '') : '无标签');
        s.push(C.LEVELS[n.level].name); if (n.sys) s.push('来自 ' + n.sys); if (n.cols) s.push('字段：' + n.cols); break;
      case 'clean': s.push([n.dropna ? '去缺数' : '', n.dedupe ? '去重复' : ''].filter(Boolean).join('、') || '不改动'); break;
      case 'feature': s.push(n.keep ? '保留：' + n.keep : '全部字段'); break;
      case 'mask': s.push(n.drop ? '删掉：' + n.drop : '（没填要删的列）'); break;
      case 'label': s.push('标签列：' + (n.target || '未填')); if (n.role) s.push('由' + n.role + '标'); break;
      case 'split': s.push('训练 ' + Math.round(n.ratio * 100) + '% / 测试 ' + (100 - Math.round(n.ratio * 100)) + '%'); break;
      case 'train':
        var al = C.ALGOS[n.algo]; s.push(al ? al.name + '（' + (al.sup ? '监督' : '无监督') + '·' + C.TASKS[al.task] + '）' : '未选算法');
        var inf = M.info(doc, n.id, 'model'); if (inf.target) s.push('预测：' + inf.target); if (n.algo === 'kmeans') s.push('分 ' + n.k + ' 群'); break;
      case 'model': s.push(n.version || ''); s.push(n.locked ? '已锁定（反复用，不重训）' : n.trained ? '已训练，未锁定' : '还没训练'); break;
      case 'rule': s.push((n.col || '最后一列') + ' ' + n.op + ' ' + (n.val === '' ? '？' : n.val)); break;
      case 'collect': if (n.wait) s.push(n.wait + '后回收'); if (n.role) s.push('由' + n.role + '补'); break;
      case 'ai': s.push(n.aiType ? C.AI[n.aiType].name : '未选 AI 类型'); break;
      case 'human': case 'action': if (n.role) s.push(n.role); break;
      case 'store': s.push(C.LEVELS[n.level].name); break;
    }
    return s.filter(Boolean).join('；');
  }

  // ================= Markdown 清单 =================
  function cell(s) { return String(s == null || s === '' ? '—' : s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' '); }
  function stageOf(doc, n) { var p = n.parent && M.get(doc, n.parent); return p ? stagePath(doc, p) : '（未归入环节）'; }

  function markdown(doc, visible, run) {
    var ok = vis(visible), st = stats(doc, visible), rk = risks(doc, visible), ck = checks(doc, visible), q = quad(doc, visible), L = [];
    L.push('# ' + (doc.title || 'AI 业务蓝图'));
    L.push('');
    L.push('> 由「AI 业务拆解画板」导出。主表按连线顺序列出每个节点：从哪接进来、输出到哪去、关键设置、运行在哪。');
    L.push('');
    L.push('## 概览');
    L.push('');
    L.push('- 节点 ' + st.nodes + ' 个、连线 ' + st.edges + ' 条；业务环节 ' + st.stages.length + ' 个，其中 **' + st.stagesWithAI + ' 个用了 AI**');
    L.push('- ' + C.GROUPS.map(function (g) { return g.name + ' ' + (st.byGroup[g.id] || 0); }).join('，'));
    var al = Object.keys(st.algos).map(function (k) { return C.ALGOS[k].name + (st.algos[k] > 1 ? ' ×' + st.algos[k] : ''); });
    if (al.length) L.push('- 算法：' + al.join('，'));
    var at = Object.keys(st.aiTypes).map(function (k) { return C.AI[k].name + (st.aiTypes[k] > 1 ? ' ×' + st.aiTypes[k] : ''); });
    if (at.length) L.push('- AI 服务：' + at.join('，'));
    L.push('- 数据源：有标签 ' + st.labeled + ' 份，无标签 ' + st.unlabeled + ' 份' + (st.withCsv ? '，' + st.withCsv + ' 份导入了数据可以运行' : ''));
    L.push('- 检查：红 ' + (rk.red + ck.filter(function (c) { return c.level === 'red'; }).length) + ' 条，黄 ' + (rk.yellow + ck.filter(function (c) { return c.level === 'yellow'; }).length) + ' 条');
    L.push('');

    L.push('## 节点清单（按连线顺序）');
    L.push('');
    var head = ['环节', '节点', '类型', '输入（从哪来）', '输出（到哪去）', '关键设置', '运行在哪'];
    if (run) head.push('运行结果');
    L.push('| ' + head.join(' | ') + ' |');
    L.push('|' + head.map(function () { return '---'; }).join('|') + '|');
    var rows = 0;
    M.topo(doc).filter(ok).forEach(function (n) {
      var ins = inputsOf(doc, n, ok).map(function (x) { return x.port.name + ' ← ' + (x.from.length ? x.from.map(function (f) { return f.node.name; }).join('、') : '（未接）'); }).join('；');
      var outs = outputsOf(doc, n, ok).map(function (x) { return x.port.name + ' → ' + (x.to.length ? x.to.map(function (t) { return t.node.name + (t.edge.fb ? '（反馈）' : ''); }).join('、') : '（未接）'); }).join('；');
      var r = [cell(stageOf(doc, n)), cell(n.name + (n.desc ? '：' + n.desc : '')), cell(C.KINDS[n.type].name), cell(ins || '（起点）'), cell(outs || '（终点）'), cell(settings(doc, n)), cell(C.HAS_LOC[n.type] ? C.LOCS[n.loc].name : '')];
      if (run) { var rr = run.nodes[n.id]; r.push(cell(rr ? (rr.summary || rr.msg || '') : '')); }
      L.push('| ' + r.join(' | ') + ' |'); rows++;
    });
    if (!rows) L.push('| ' + head.map(function () { return '—'; }).join(' | ') + ' |');
    L.push('');

    if (st.models.length) {
      L.push('## 模型：训练一次，反复用');
      L.push('');
      st.models.forEach(function (m) {
        L.push('- **' + m.name + '**（' + (m.algo || '算法未定') + '，' + (m.version || '') + '，' + (m.locked ? '已锁定' : m.trained ? '已训练' : '未训练') + '）：' +
          (m.evaluated ? '有评估' : '**没有评估**') + '；被 ' + m.uses + ' 个预测节点使用' + (m.users.length ? '（' + m.users.join('、') + '）' : ''));
      });
      if (run) Object.keys(run.nodes).forEach(function (id) { var n = M.get(doc, id), rr = run.nodes[id]; if (n && ok(n) && n.type === 'evaluate' && rr.status === 'ok') L.push('- 评估' + nm(n) + '：' + rr.summary); });
      L.push('');
    }

    L.push('## AI 落地优先级（四格图）');
    L.push('');
    ['now', 'plan', 'easy', 'skip'].forEach(function (k) {
      L.push('- **' + C.QUADS[k].name + '**（' + C.QUADS[k].tip + '）：' + (q[k].length ? q[k].map(function (x) { return x.name; }).join('、') : '—'));
    });
    if (q.unrated.length) L.push('- 还没打分：' + q.unrated.map(function (x) { return x.name; }).join('、'));
    L.push('');

    var datas = doc.nodes.filter(function (n) { return isData(n) && ok(n); });
    L.push('## 数据清单');
    L.push('');
    L.push('| 数据 | 形态 | 有无标签 | 敏感等级 | 存放位置 | 流向 | 提醒 |');
    L.push('|---|---|---|---|---|---|---|');
    M.ordered(datas).forEach(function (d) {
      var to = doc.edges.filter(function (e) { return e.from === d.id && ok(M.get(doc, e.to)); }).map(function (e) { return M.get(doc, e.to).name + (e.masked ? '·已脱敏' : ''); });
      var lv = rk.map.nodes[d.id];
      L.push('| ' + [cell(d.name), cell(C.FORMS[d.form].name), cell(d.form !== 'table' ? '' : d.type === 'src' && d.labeled ? '有（' + (d.target || '?') + '）' : '无'), cell(C.LEVELS[d.level].name), cell(C.LOCS[d.loc].name), cell(to.join('；')), lv === 'red' ? '🔴 标红' : lv === 'yellow' ? '🟡 标黄' : '—'].join(' | ') + ' |');
    });
    if (!datas.length) L.push('| — | — | — | — | — | — | — |');
    L.push('');

    L.push('## 检查与风险');
    L.push('');
    if (!rk.list.length && !ck.length) L.push('没有发现问题。');
    rk.list.concat(ck).forEach(function (r) { L.push('- ' + (r.level === 'red' ? '🔴 ' : r.level === 'yellow' ? '🟡 ' : 'ℹ️ ') + r.text + (r.fix ? ' 建议：' + r.fix : '')); });
    L.push('');
    L.push('---');
    L.push('');
    L.push('规则说明：敏感等级分公开 / 内部 / 敏感 / 机密；存放位置分本地 / 私有云 / 公有云。敏感或机密数据存在公有云，或没脱敏就（直接或经过清洗、拆分、预测）流到公有云上的训练、预测、AI 服务、外部系统，标红；脱敏后上公有云、机密数据放私有云，标黄。四格图里「中」算进高的一边。');
    return L.join('\n') + '\n';
  }

  root.ABB = root.ABB || {};
  root.ABB.Analysis = { checks: checks, risks: risks, stats: stats, quad: quad, markdown: markdown, stagePath: stagePath, stagesInOrder: stagesInOrder,
    inputsOf: inputsOf, outputsOf: outputsOf, settings: settings, isAI: isAI };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Analysis;
})(typeof window !== 'undefined' ? window : globalThis);
