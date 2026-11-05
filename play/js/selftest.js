/* 页面自检：打开 play/index.html?selftest=1，几秒后标签页标题变成 SELFTEST PASS / SELFTEST FAIL；
 * 详细结果在 window.__selftest。会用到「我来画」，但用一份临时蓝图，结束后切回原来的。 */
(function (root) {
  'use strict';
  var M = root.ABB.Model, A = root.ABB.Analysis, Samples = root.ABB.Samples;

  function run(app) {
    var res = { checks: [], ok: true };
    function check(name, cond, detail) { res.checks.push({ name: name, ok: !!cond, detail: detail || '' }); if (!cond) res.ok = false; }
    function done() {
      check('没有 JS 报错', !(root.__errors || []).length, (root.__errors || []).join(' | '));
      root.__selftest = res; document.title = res.ok ? 'SELFTEST PASS' : 'SELFTEST FAIL';
    }
    try {
      // 1. 三个示例
      Samples.list.forEach(function (s) {
        var b = Samples.build(s), d = b.doc, st = A.stats(d), rk = A.risks(d), q = A.quad(d);
        check(s.short + '：方框数 ≥ 15', d.nodes.length >= 15, d.nodes.length + ' 个');
        check(s.short + '：标「虚构示例」', /虚构示例/.test(s.title));
        check(s.short + '：每个环节都用了 AI', st.stagesWithAI === st.stages.length, st.stagesWithAI + '/' + st.stages.length);
        check(s.short + '：恰好一个红点', rk.red === 1, rk.red + ' 红');
        check(s.short + '：AI 都打了分', q.unrated.length === 0, q.unrated.length + ' 个没打分');
        var fixed = M.clone(d); s.steps.forEach(function (stp) { if (stp.fix) stp.fix(fixed, function (k) { return b.ids[k]; }); });
        check(s.short + '：演示改法后没有红点', A.risks(fixed).red === 0);
        check(s.short + '：有一步讲四格图', s.steps.some(function (x) { return x.tab === 'quad'; }));
      });
      // 2. 观看：走完每个示例的每一步
      app.setMode('watch'); root.ABB.Watch.stop();
      var steps = 0;
      Samples.list.forEach(function (s, i) { root.ABB.Watch.load(i); root.ABB.Watch.stop(); for (var k = 0; k < s.steps.length; k++) { root.ABB.Watch.go(k); steps++; } });
      check('观看：三个示例逐步播放', steps === Samples.list.reduce(function (a, s) { return a + s.steps.length; }, 0), steps + ' 步');
      root.ABB.Watch.load(0); root.ABB.Watch.stop();
      // 3. 我来画：临时蓝图
      app.setMode('draw');
      var keepId = app.S.docId, keepDoc = app.S.docs.draw;
      app.S.docId = 'selftest-tmp'; app.S.docs.draw = M.create('自检'); app.S.hist.draw.clear();
      app.addBox('stage'); var sid = app.S.sel.id;
      app.addBox('ai'); var aid = app.S.sel.id;
      app.addBox('human');
      var d = app.cur();
      check('选中环节时新方框放进环节', M.get(d, aid).parent === sid && M.children(d, sid).length === 2);
      app.select(null); app.addBox('data'); var did = app.S.sel.id;
      app.commit(function (x) { var n = M.get(x, did); n.level = 'secret'; n.loc = 'local'; var a = M.get(x, aid); a.aiType = 'llm'; a.loc = 'public'; a.value = 'high'; a.effort = 'low'; M.addEdge(x, did, aid); });
      check('机密数据连到公有云 AI → 标红', A.risks(app.cur()).red === 1);
      app.commit(function (x) { M.get(x, aid).loc = 'local'; });
      check('AI 改成本地 → 红点消失', A.risks(app.cur()).red === 0);
      app.undo();
      check('撤销后红点回来', A.risks(app.cur()).red === 1);
      app.redo();
      check('重做后红点又消失', A.risks(app.cur()).red === 0);
      var json = M.serialize(app.cur()), back = M.parse(json);
      check('JSON 往返不丢东西', M.serialize(back) === json);
      var md = A.markdown(app.cur());
      check('Markdown 主表有价值和难度两列', md.indexOf('| 业务价值 | 落地难度 |') > 0 && md.indexOf('| 高 | 低 |') > 0);
      check('四格图里出现这个 AI', A.quad(app.cur()).now.length === 1);
      check('页面不能横向滚动', document.documentElement.scrollWidth <= root.innerWidth + 1, document.documentElement.scrollWidth + ' > ' + root.innerWidth);
      app.canvas.exportPNG(app.cur(), null, function (blob) {
        check('导出 PNG 有内容', blob && blob.size > 5000, blob ? blob.size + ' 字节' : '没有生成');
        app.S.docId = keepId; app.S.docs.draw = keepDoc; app.S.hist.draw.clear(); root.ABB.Store.del('selftest-tmp');
        app.setMode('watch'); root.ABB.Watch.stop();
        done();
      });
    } catch (err) { check('自检没有抛异常', false, String(err && err.stack || err)); done(); }
  }
  root.ABB.Selftest = { run: run };
})(window);
