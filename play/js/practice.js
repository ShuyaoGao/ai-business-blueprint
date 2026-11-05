/* 「练习」模式：一张单独的画布 + 9 项任务，看蓝图的状态自动打勾。 */
(function (root) {
  'use strict';
  var M = root.ABB.Model, A = root.ABB.Analysis, Store = root.ABB.Store;
  var KEY = 'abb.practice.flags';

  function sens(n) { return n.type === 'data' && (n.level === 'sensitive' || n.level === 'secret'); }
  var TASKS = [
    { id: 'stages', text: '建 3 个业务环节（工具条「环节」；手机：加方框 → 业务环节）', test: function (d) { return d.nodes.filter(function (n) { return n.type === 'stage'; }).length >= 3; } },
    { id: 'nest', text: '把 2 个小步骤放进同一个环节（选中环节再加方框，或把方框拖进蓝色大框）', test: function (d) { return d.nodes.some(function (s) { return s.type === 'stage' && M.children(d, s.id).length >= 2; }); } },
    { id: 'aitype', text: '加一个 AI 能力，在右边属性里选好 AI 类型', test: function (d) { return d.nodes.some(function (n) { return n.type === 'ai' && n.aiType; }); } },
    { id: 'io', text: '给这个 AI 填上「输入什么」和「输出什么」', test: function (d) { return d.nodes.some(function (n) { return n.type === 'ai' && n.input.trim() && n.output.trim(); }); } },
    { id: 'score', text: '给 AI 打分：业务价值和落地难度（然后看「四格图」）', test: function (d) { return d.nodes.some(function (n) { return n.type === 'ai' && n.value && n.effort; }); } },
    { id: 'data', text: '加一份数据，敏感等级选「敏感」或「机密」，存放位置选「本地」', test: function (d) { return d.nodes.some(function (n) { return sens(n) && n.loc === 'local'; }); } },
    { id: 'flow', text: '从数据连一条线到一个 AI（数据流，虚线）', test: function (d) { return d.edges.some(function (e) { var a = M.get(d, e.from), b = M.get(d, e.to); return a && b && a.type === 'data' && b.type === 'ai'; }); } },
    { id: 'red', text: '故意制造一个红点（敏感数据连到「公有云 API」上的 AI），再想办法消掉它', test: function (d, f) { return f.sawRed && A.risks(d).red === 0; } },
    { id: 'md', text: '导出 Markdown 清单（文件 ▾ → 导出 Markdown；手机在 ☰ 里）', test: function (d, f) { return !!f.md; } }
  ];

  var P = { app: null, flags: { sawRed: false, md: false }, done: {} };

  function loadFlags() { try { var f = JSON.parse(Store.get(KEY) || '{}'); P.flags = { sawRed: !!f.sawRed, md: !!f.md }; } catch (e) { P.flags = { sawRed: false, md: false }; } }
  function saveFlags() { Store.set(KEY, JSON.stringify(P.flags)); }

  P.init = function (app) { P.app = app; loadFlags(); };
  P.enter = function (doc) { P.done = {}; TASKS.forEach(function (t) { if (t.test(doc, P.flags)) P.done[t.id] = true; }); badge(); };
  P.note = function (ev) { if (ev === 'markdown') { P.flags.md = true; saveFlags(); } P.check(P.app.cur()); };

  /** 每次改动后调用：新完成的任务弹提示。已完成的任务不会因为后来删掉东西而取消。 */
  P.check = function (doc) {
    if (A.risks(doc).red > 0 && !P.flags.sawRed) { P.flags.sawRed = true; saveFlags(); P.app.toast('出现红点了！现在想办法消掉它：改 AI 的运行位置、勾「已脱敏」，或者删掉这条线'); }
    var newly = [];
    TASKS.forEach(function (t) { if (!P.done[t.id] && t.test(doc, P.flags)) { P.done[t.id] = true; newly.push(t); } });
    if (newly.length) {
      var n = Object.keys(P.done).length;
      P.app.toast((n === TASKS.length ? '全部完成！' : '完成：') + newly[newly.length - 1].text.split('（')[0]);
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
    body.appendChild(el('div', { class: 'brief' }, [el('b', { text: '题目：' }), '拆你自己的业务。想不出来，就拆「一家社区健身房」：会员办卡、教练排课、器械维护、续费提醒……',
      el('br'), el('span', { class: 'hint', text: '这是单独的一张练习画布，不影响「我来画」里的蓝图。' })]));
    body.appendChild(el('div', { class: 'tprog' }, [el('b', { text: n + ' / ' + TASKS.length }), n === TASKS.length ? ' 全部完成！可以导出 PNG 留作纪念。' : ' 做完一项自动打勾']));
    var ol = el('ol', { class: 'tasks' }), curSet = false;
    TASKS.forEach(function (t) {
      var cls = P.done[t.id] ? 'done' : (!curSet ? (curSet = true, 'cur') : '');
      ol.appendChild(el('li', { class: cls, 'data-task': t.id, text: t.text }));
    });
    body.appendChild(ol);
    body.appendChild(el('div', { class: 'row' }, [el('button', { class: 'mini', onclick: function () {
      if (!confirm('清空练习画布、重新开始？')) return;
      P.flags = { sawRed: false, md: false }; saveFlags(); P.done = {};
      var S = P.app.S; S.docs.practice = M.create('练习：拆一项业务'); S.hist.practice.clear(); S.sel = null;
      Store.set('abb.practice', JSON.stringify(S.docs.practice)); badge(); P.app.refresh(); P.app.canvas().fit();
    } }, ['重新开始练习'])]));
  };
  P.tasks = TASKS;
  P.state = function () { return { done: Object.keys(P.done), total: TASKS.length, flags: P.flags }; };

  root.ABB.Practice = P;
})(window);
