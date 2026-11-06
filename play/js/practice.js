/* 「练习」模式：一张单独的画布 + 10 项任务，看节点图的状态自动打勾。 */
(function (root) {
  'use strict';
  var M = root.ABB.Model, A = root.ABB.Analysis, Store = root.ABB.Store;
  var KEY = 'abb.practice.flags2';

  function has(d, f) { return d.nodes.some(f); }
  function into(d, id, pid, fromType) { return d.edges.some(function (e) { return e.to === id && (!pid || e.tp === pid) && (!fromType || (M.get(d, e.from) || {}).type === fromType); }); }
  var TASKS = [
    { id: 'src', text: '从节点库拖一个「数据源」，在属性里选「有标签」并填上标签列', test: function (d) { return has(d, function (n) { return n.type === 'src' && n.form === 'table' && n.labeled && n.target; }); } },
    { id: 'split', text: '在它后面接「拆分训练 / 测试」（点数据源 → 属性里「在后面接一个」→ 拆分）', test: function (d) { return has(d, function (n) { return n.type === 'split' && into(d, n.id, 'in'); }); } },
    { id: 'train', text: '加「训练模型」，选一种算法，把拆分的「训练集」口接进去', test: function (d) { return has(d, function (n) { return n.type === 'train' && n.algo && d.edges.some(function (e) { return e.to === n.id && e.fp === 'train'; }); }); } },
    { id: 'model', text: '训练模型后面接一个「模型」节点', test: function (d) { return has(d, function (n) { return n.type === 'model' && into(d, n.id, 'in', 'train'); }); } },
    { id: 'eval', text: '加「评估」：一个口接模型，一个口接拆分的「测试集」', test: function (d) { return has(d, function (n) { return n.type === 'evaluate' && into(d, n.id, 'model') && d.edges.some(function (e) { return e.to === n.id && e.tp === 'test' && e.fp === 'test'; }); }); } },
    { id: 'predict', text: '加「新数据」和「预测」：同一个模型接到预测的「模型」口，新数据接到「新数据」口', test: function (d) { return has(d, function (n) { return n.type === 'predict' && into(d, n.id, 'model') && into(d, n.id, 'in', 'newdata'); }); } },
    { id: 'run', text: '两个数据节点都「用示例数据」（销售流水 + 明天各门店），点「▶ 运行」，在「结果」里看预测', test: function (d, f) { return !!f.ran; } },
    { id: 'lock', text: '到模型节点的属性里「锁定」，再运行一次：训练显示「跳过」，只重新预测', test: function (d, f) { return !!f.ranLocked; } },
    { id: 'red', text: '故意制造一个红点（敏感数据接到「公有云 API」上的 AI 服务），再插一个「脱敏」或改运行位置消掉它', test: function (d, f) { return f.sawRed && A.risks(d).red === 0; } },
    { id: 'md', text: '导出 Markdown 清单（文件 ▾ → 导出 Markdown；手机在 ☰ 里）', test: function (d, f) { return !!f.md; } }
  ];

  var P = { app: null, flags: {}, done: {} };
  function loadFlags() { try { P.flags = JSON.parse(Store.get(KEY) || '{}') || {}; } catch (e) { P.flags = {}; } }
  function saveFlags() { Store.set(KEY, JSON.stringify(P.flags)); }

  P.init = function (app) { P.app = app; loadFlags(); };
  P.enter = function (doc) { P.done = {}; TASKS.forEach(function (t) { if (t.test(doc, P.flags)) P.done[t.id] = true; }); badge(); };
  P.note = function (ev) {
    var r = P.app.S.run;
    if (ev === 'markdown') P.flags.md = true;
    if ((ev === 'run' || ev === 'runlocked') && r && r.nodes && Object.keys(r.nodes).some(function (id) { var n = M.get(P.app.cur(), id); return n && n.type === 'predict' && r.nodes[id].status === 'ok'; })) {
      P.flags.ran = true; if (ev === 'runlocked') P.flags.ranLocked = true;
    }
    saveFlags(); P.check(P.app.cur());
  };

  /** 每次改动后调用：新完成的任务弹提示。已完成的任务不会因为后来删掉东西而取消。 */
  P.check = function (doc) {
    if (A.risks(doc).red > 0 && !P.flags.sawRed) { P.flags.sawRed = true; saveFlags(); P.app.toast('出现红点了！现在想办法消掉它：在线中间插「脱敏」、改 AI 的运行位置，或者删掉这条线'); }
    var newly = [];
    TASKS.forEach(function (t) { if (!P.done[t.id] && t.test(doc, P.flags)) { P.done[t.id] = true; newly.push(t); } });
    if (newly.length) {
      var n = Object.keys(P.done).length;
      setTimeout(function () { P.app.toast((n === TASKS.length ? '全部完成！' : '完成：') + newly[newly.length - 1].text.split('（')[0]); }, 400);
      if (P.app.S.tab === 'tasks') P.app.refresh();
    }
    badge();
  };
  function badge() {
    var b = document.getElementById('task-badge'), n = Object.keys(P.done).length;
    if (b) { b.textContent = n + '/' + TASKS.length; b.className = 'badge' + (n === TASKS.length ? ' ok' : ''); }
  }

  P.panel = function (body) {
    var el = root.ABB.Panels.el, n = Object.keys(P.done).length;
    body.appendChild(el('div', { class: 'brief' }, [el('b', { text: '题目：' }), '搭一条完整的机器学习流水线：历史数据 → 拆分 → 训练 → 模型 → 评估；新数据 + 同一个模型 → 预测。再真的跑一遍。',
      el('br'), el('span', { class: 'hint', text: '这是单独的一张练习画布，不影响「我来画」里的蓝图。卡住了就去「观看」看连锁餐饮的前 11 步。' })]));
    body.appendChild(el('div', { class: 'tprog' }, [el('b', { text: n + ' / ' + TASKS.length }), n === TASKS.length ? ' 全部完成！可以导出 PNG 留作纪念。' : ' 做完一项自动打勾']));
    var ol = el('ol', { class: 'tasks' }), curSet = false;
    TASKS.forEach(function (t) {
      var cls = P.done[t.id] ? 'done' : (!curSet ? (curSet = true, 'cur') : '');
      ol.appendChild(el('li', { class: cls, 'data-task': t.id, text: t.text }));
    });
    body.appendChild(ol);
    body.appendChild(el('div', { class: 'row' }, [el('button', { class: 'mini', onclick: function () {
      if (!confirm('清空练习画布、重新开始？')) return;
      P.flags = {}; saveFlags(); P.done = {};
      var S = P.app.S; S.docs.practice = M.create('练习：拆一项业务'); S.hist.practice.clear(); S.sel = null; S.run = null;
      Store.set('abb.practice', JSON.stringify(S.docs.practice)); badge(); P.app.refresh(); P.app.canvas().fit();
    } }, ['重新开始练习'])]));
  };
  P.tasks = TASKS;
  P.state = function () { return { done: Object.keys(P.done), total: TASKS.length, flags: P.flags }; };

  root.ABB.Practice = P;
})(window);
