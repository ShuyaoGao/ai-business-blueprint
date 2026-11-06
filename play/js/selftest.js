/* 页面自检：打开 play/index.html?selftest=1，几秒后标签页标题变成 SELFTEST PASS / SELFTEST FAIL；
 * 详细结果在 window.__selftest。会用到「我来画」，但用一份临时蓝图，结束后切回原来的。 */
(function (root) {
  'use strict';
  var M = root.ABB.Model, A = root.ABB.Analysis, Samples = root.ABB.Samples, E = root.ABB.Engine;

  function run(app) {
    var res = { checks: [], ok: true };
    function check(name, cond, detail) { res.checks.push({ name: name, ok: !!cond, detail: detail || '' }); if (!cond) res.ok = false; }
    function done() {
      check('没有 JS 报错', !(root.__errors || []).length, (root.__errors || []).join(' | '));
      root.__selftest = res; document.title = res.ok ? 'SELFTEST PASS' : 'SELFTEST FAIL';
    }
    try {
      // 1. 三个示例：搭得出来、跑得通、各一个红点
      Samples.list.forEach(function (s) {
        var b = Samples.build(s), d = b.doc, r = E.run(d);
        check(s.short + '：节点 ≥ 20', d.nodes.length >= 20, d.nodes.length + ' 个');
        check(s.short + '：运行没出错', r.ok, JSON.stringify(r.counts));
        check(s.short + '：恰好一个红点', A.risks(d).red === 1, A.risks(d).red + ' 红');
      });
      // 2. 观看：走完每个示例的每一步（会真的运行）
      app.setMode('watch'); root.ABB.Watch.stop();
      var steps = 0, lockedSkip = false;
      Samples.list.forEach(function (s, i) {
        root.ABB.Watch.load(i); root.ABB.Watch.stop();
        for (var k = 0; k < s.steps.length; k++) {
          root.ABB.Watch.go(k); steps++;
          var rr = app.runResult(); if (rr && rr.counts.skip) lockedSkip = true;
        }
        check(s.short + '：演示完红点消失', A.risks(app.cur()).red === 0);
      });
      check('观看：三个示例逐步播放', steps === Samples.list.reduce(function (a, s) { return a + s.steps.length; }, 0), steps + ' 步');
      check('观看：锁定模型后再运行，训练被跳过', lockedSkip);
      root.ABB.Watch.load(0); root.ABB.Watch.stop();
      // 3. 我来画：临时蓝图，用界面上的函数搭一条流水线
      app.setMode('draw');
      var keepId = app.S.docId, keepDoc = app.S.docs.draw;
      app.S.docId = 'selftest-tmp'; app.S.docs.draw = M.create('自检'); app.S.hist.draw.clear(); app.S.run = null;
      var src = app.addNode('src');
      app.useDataset(src, 'sales');
      var d = app.cur();
      check('导入示例数据：标签列自动选最后一列', M.get(d, src).target === '销量', M.get(d, src).target);
      app.select({ kind: 'node', id: src }); var sp = app.addNode('split');
      check('选中节点时，新节点自动接在后面', d.edges.some(function (e) { return e.from === src && e.to === sp; }));
      app.select({ kind: 'node', id: sp }); var tr = app.addNode('train');
      app.commit(function (x) { M.get(x, tr).algo = 'forest'; });
      app.select({ kind: 'node', id: tr }); var mo = app.addNode('model');
      app.select({ kind: 'node', id: mo }); var ev = app.addNode('evaluate');
      app.commit(function (x) { M.connect(x, sp, ev); });
      check('拆分的测试集接到评估的测试集口', d.edges.some(function (e) { return e.from === sp && e.fp === 'test' && e.to === ev && e.tp === 'test'; }));
      app.select(null); var nd = app.addNode('newdata'); app.useDataset(nd, 'sales_new');
      app.select({ kind: 'node', id: mo }); var pr = app.addNode('predict');
      app.commit(function (x) { M.connect(x, nd, pr); });
      var r1 = app.runNow(true);
      check('运行：评估算出 R²', r1 && r1.nodes[ev] && r1.nodes[ev].metric && r1.nodes[ev].metric.r2 > 0.6, r1 && JSON.stringify(r1.nodes[ev]).slice(0, 200));
      check('运行：预测出 24 行', r1 && r1.nodes[pr].ds && r1.nodes[pr].ds.rows.length === 24);
      check('运行后模型节点存下了模型', !!M.get(app.cur(), mo).trained);
      app.lockModel(mo, true); var r2 = app.runNow(true);
      check('锁定后再运行：训练跳过', r2.nodes[tr].status === 'skip');
      app.undo(); app.redo();
      check('撤销 / 重做后模型还是锁定的', M.get(app.cur(), mo).locked);
      var json = M.serialize(app.cur()), back = M.parse(json);
      check('JSON 往返不丢东西', M.serialize(back) === json);
      var md = A.markdown(app.cur(), null, app.runResult());
      check('Markdown 清单写出输入从哪来', /训练集 → /.test(md) && /运行结果/.test(md));
      // 敏感数据 → 公有云 AI → 插「脱敏」
      app.select(null); var mem = app.addNode('src'); app.commit(function (x) { M.get(x, mem).level = 'sensitive'; });
      app.select({ kind: 'node', id: mem }); var ai = app.addNode('ai');
      check('敏感数据 → 公有云 AI：标红', A.risks(app.cur()).red === 1);
      var edge = app.cur().edges.filter(function (e) { return e.from === mem; })[0];
      app.insertOn(edge.id, 'mask');
      check('中间插「脱敏」：红变黄', A.risks(app.cur()).red === 0 && A.risks(app.cur()).yellow === 1);
      check('页面不能横向滚动', document.documentElement.scrollWidth <= root.innerWidth + 1, document.documentElement.scrollWidth + ' > ' + root.innerWidth);
      app.quickAdd({ from: pr, fp: 'out', world: { x: 0, y: 0 }, client: { x: 100, y: 100 } });
      check('拖线到空白处：弹出「接一个什么节点」', !document.getElementById('quick').hidden && document.querySelectorAll('#quick .kbtn').length >= 3);
      app.closeQuick();
      app.canvas().exportPNG(app.cur(), { run: app.runResult().nodes }, function (blob) {
        check('导出 PNG 有内容', blob && blob.size > 5000, blob ? blob.size + ' 字节' : '没有生成');
        app.S.docId = keepId; app.S.docs.draw = keepDoc; app.S.hist.draw.clear(); app.S.run = null; root.ABB.Store.del('selftest-tmp');
        app.setMode('watch'); root.ABB.Watch.stop();
        done();
      });
    } catch (err) { check('自检没有抛异常', false, String(err && err.stack || err)); done(); }
  }
  root.ABB.Selftest = { run: run };
})(window);
