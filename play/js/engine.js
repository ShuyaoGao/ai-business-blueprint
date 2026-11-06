/* 运行整张节点图：按连线顺序把每个节点算一遍，结果挂在节点上给右栏看。纯函数，Node 可测。
 *
 *   Engine.run(doc) → { nodes: { id: 结果 }, trained: { 模型节点 id: 新训练出的模型 }, ok, err, ms }
 *   结果 = { status, msg, outs: { 口 id: 值 }, summary, model, metric, ds }
 *   status：ok 算好了 / error 出错 / idle 只画图不运行 / wait 上游没结果 / skip 模型锁定、不用重新训练 / pass 原样往下传
 *   值 = { t: 'table', ds } | { t: 'model', m } | { t: 'metric', r }
 *
 * 「模型反复用」：模型节点锁定后，它上游只为它服务的节点（训练、拆分、清洗……）整段跳过，
 * 运行时只把新数据送进预测。
 */
(function (root) {
  'use strict';
  var C = (root.ABB && root.ABB.Config) || require('./config.js');
  var M = (root.ABB && root.ABB.Model) || require('./model.js');
  var ML = (root.ABB && root.ABB.ML) || require('./ml.js');

  function list(s) { return String(s || '').split(/[,，、;；\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function pct(v) { return Math.round(v * 1000) / 10 + '%'; }
  function shape(ds) { return ds.rows.length + ' 行 × ' + ds.cols.length + ' 列'; }

  /** 只为锁定的模型服务的上游节点：运行时跳过。 */
  function skippable(doc) {
    var locked = {}, skip = {};
    doc.nodes.forEach(function (n) { if (n.type === 'model' && n.locked && n.trained) locked[n.id] = 1; });
    if (!Object.keys(locked).length) return skip;
    var nodes = M.topo(doc).reverse(), changed = true;
    while (changed) {
      changed = false;
      nodes.forEach(function (n) {
        if (skip[n.id] || locked[n.id]) return;
        var outs = doc.edges.filter(function (e) { return e.from === n.id && !e.fb; });
        if (outs.length && outs.every(function (e) { return locked[e.to] || skip[e.to]; })) { skip[n.id] = 1; changed = true; }
      });
    }
    return skip;
  }

  function summarizeModel(m) {
    var t = m.algoName + ' · ' + m.rows + ' 行训练';
    if (m.task === 'cluster') t += ' · 分成 ' + m.k + ' 群';
    if (m.task === 'anomaly') t += ' · 异常线 ' + m.threshold;
    return t;
  }
  function summarizeMetric(r) {
    if (r.task === 'reg') return '平均差 ' + r.mae + ' · R² ' + r.r2;
    if (r.task === 'clf') return '准确率 ' + pct(r.accuracy) + '（全猜最多的那类：' + pct(r.baseline) + '）';
    if (r.task === 'cluster') return r.n + ' 行分到 ' + Object.keys(r.sizes).length + ' 群';
    return r.n + ' 行里 ' + r.flagged + ' 行异常';
  }

  function run(doc, opts) {
    opts = opts || {};
    var t0 = Date.now(), res = {}, trained = {}, skip = skippable(doc), parsed = opts.cache || {};
    function input(id, pid) {
      var es = M.edgesInto(doc, id, pid).filter(function (e) { return !e.fb; });
      for (var i = 0; i < es.length; i++) { var r = res[es[i].from]; if (r && r.outs && r.outs[es[i].fp]) return r.outs[es[i].fp]; }
      return null;
    }
    function connected(id, pid) { return M.edgesInto(doc, id, pid).some(function (e) { return !e.fb; }); }
    function anyTable(id) {
      var es = M.edgesInto(doc, id).filter(function (e) { return !e.fb; });
      for (var i = 0; i < es.length; i++) { var r = res[es[i].from], v = r && r.outs && r.outs[es[i].fp]; if (v && v.t === 'table') return v; }
      return null;
    }
    function need(id, pids) {
      // 必填口：没接线 → idle；接了但上游没算出来 → wait
      for (var i = 0; i < pids.length; i++) {
        var p = M.port(M.get(doc, id), 'ins', pids[i]);
        if (!connected(id, pids[i])) return { status: 'idle', msg: '「' + p.name + '」还没接上' };
        var v = input(id, pids[i]);
        if (!v) {
          var src = M.feed(doc, id, pids[i]), ur = src && res[src.from];
          if (ur && (ur.status === 'idle' || ur.status === 'wait')) return { status: 'idle', msg: '上游「' + M.get(doc, src.from).name + '」只画图、没有数据，这一步也不运行' };
          if (ur && ur.status === 'error') return { status: 'wait', msg: '上游「' + M.get(doc, src.from).name + '」出错了，先看它' };
          return { status: 'wait', msg: '上游还没有结果（「' + p.name + '」）' };
        }
        var want = C.PORTS[p.type].cat;
        if ((want === 'table' || want === 'data') && v.t !== 'table') return { status: 'error', msg: '「' + p.name + '」要的是数据表' };
        if (want === 'model' && v.t !== 'model') return { status: 'error', msg: '「' + p.name + '」要的是模型' };
      }
      return null;
    }
    function tbl(ds) { return { t: 'table', ds: ds }; }

    M.topo(doc).forEach(function (n) {
      var id = n.id, r;
      if (skip[id]) { res[id] = { status: 'skip', msg: '下游的模型已锁定，这一步不用重新算' }; return; }
      try { r = step(n); } catch (err) { r = { status: 'error', msg: err.message || String(err) }; }
      r.outs = r.outs || {};
      res[id] = r;
    });

    function step(n) {
      var id = n.id, miss, ds, v, inf;
      switch (n.type) {
        case 'src': case 'newdata':
          if ((n.form || 'table') !== 'table') return { status: 'idle', msg: C.FORMS[n.form].name + '只画图，浏览器里不运行' };
          if (!n.csv) return { status: 'idle', msg: '还没导入数据（CSV），只画图' };
          ds = parsed[n.csv] || (parsed[n.csv] = ML.parseCSV(n.csv));
          ds = { cols: ds.cols, rows: ds.rows };
          if (n.type === 'src' && n.labeled && n.target && ds.cols.indexOf(n.target) < 0) return { status: 'error', msg: '标签列「' + n.target + '」在数据里找不到。数据里有：' + ds.cols.join('、') };
          return { status: 'ok', summary: shape(ds), ds: ds, outs: { out: tbl(ds) } };
        case 'clean':
          if ((miss = need(id, ['in']))) return miss;
          var c = ML.clean(input(id, 'in').ds, { dropna: n.dropna, dedupe: n.dedupe });
          return { status: 'ok', summary: '去掉 ' + c.removedNA + ' 行缺数、' + c.removedDup + ' 行重复，剩 ' + c.ds.rows.length + ' 行', ds: c.ds, outs: { out: tbl(c.ds) } };
        case 'feature':
          if ((miss = need(id, ['in']))) return miss;
          ds = input(id, 'in').ds; inf = M.info(doc, id, 'out');
          var keep = list(n.keep);
          if (!keep.length) return { status: 'pass', summary: '没填要保留的字段：全部保留', ds: ds, outs: { out: tbl(ds) } };
          var bad = keep.filter(function (k) { return ds.cols.indexOf(k) < 0; });
          if (bad.length) return { status: 'error', msg: '数据里没有：' + bad.join('、') + '。有的是：' + ds.cols.join('、') };
          if (inf.target && ds.cols.indexOf(inf.target) >= 0 && keep.indexOf(inf.target) < 0) keep.push(inf.target);
          ds = ML.select(ds, keep);
          return { status: 'ok', summary: '保留 ' + ds.cols.length + ' 个字段', ds: ds, outs: { out: tbl(ds) } };
        case 'mask':
          if ((miss = need(id, ['in']))) return miss;
          ds = input(id, 'in').ds;
          var drop = list(n.drop).filter(function (k) { return ds.cols.indexOf(k) >= 0; });
          ds = ML.dropCols(ds, drop);
          return { status: 'ok', summary: drop.length ? '删掉了：' + drop.join('、') : '没有要删的列（在属性里填）', ds: ds, outs: { out: tbl(ds) } };
        case 'label':
          if ((miss = need(id, ['in']))) return miss;
          ds = input(id, 'in').ds; var tg = M.info(doc, id, 'out').target;
          if (!tg) return { status: 'error', msg: '在属性里填「标签列」：人要补上的是哪一列' };
          if (ds.cols.indexOf(tg) < 0) return { status: 'error', msg: '数据里还没有「' + tg + '」这一列：真实业务里要人去标。演示时导入一份已经标好的数据' };
          return { status: 'pass', summary: '「' + tg + '」已经标好，原样往下传', ds: ds, outs: { out: tbl(ds) } };
        case 'split':
          if ((miss = need(id, ['in']))) return miss;
          var sp = ML.split(input(id, 'in').ds, n.ratio || 0.8, n.seed || 42);
          return { status: 'ok', summary: '训练 ' + sp.train.rows.length + ' 行 / 测试 ' + sp.test.rows.length + ' 行', ds: sp.train, outs: { train: tbl(sp.train), test: tbl(sp.test) } };
        case 'join':
          if ((miss = need(id, ['a', 'b']))) return miss;
          ds = ML.concat(input(id, 'a').ds, input(id, 'b').ds);
          return { status: 'ok', summary: '合并后 ' + ds.rows.length + ' 行', ds: ds, outs: { out: tbl(ds) } };
        case 'train':
          if (!n.algo) return { status: 'idle', msg: '还没选算法' };
          var al = C.ALGOS[n.algo];
          if (!al.run) return { status: 'idle', msg: al.name + '浏览器里不运行（只画图）；想看到结果，可以换成随机森林' };
          if ((miss = need(id, ['in']))) return miss;
          inf = M.info(doc, id, 'model');
          var upInf = M.feed(doc, id, 'in'); upInf = upInf ? M.info(doc, upInf.from, upInf.fp) : {};
          var m = ML.train(input(id, 'in').ds, { algo: n.algo, target: inf.target, k: n.k, exclude: al.sup ? [] : [upInf.target || ''] });
          return { status: 'ok', summary: summarizeModel(m), model: m, outs: { model: { t: 'model', m: m } },
            note: m.dropped.length ? '自动没用：' + m.dropped.join('、') + '（几乎每行都不一样，像编号或姓名）' : '' };
        case 'model':
          if (n.locked && n.trained) return { status: 'ok', summary: '已锁定 ' + (n.version || '') + '：直接用，不重新训练', model: n.trained, outs: { out: { t: 'model', m: n.trained } } };
          if (!connected(id, 'in')) {
            if (n.trained) return { status: 'ok', summary: '用存着的模型 ' + (n.version || ''), model: n.trained, outs: { out: { t: 'model', m: n.trained } } };
            return { status: 'idle', msg: '还没接上训练节点，也没有存着的模型' };
          }
          v = input(id, 'in');
          if (!v) return { status: 'idle', msg: '训练节点没有出结果（只画图，或者出错了）' };
          trained[id] = v.m;
          return { status: 'ok', summary: '刚训练好：' + summarizeModel(v.m), model: v.m, outs: { out: v } };
        case 'evaluate':
          if ((miss = need(id, ['model', 'test']))) return miss;
          var rep = ML.evaluate(input(id, 'model').m, input(id, 'test').ds);
          return { status: 'ok', summary: summarizeMetric(rep), metric: rep, outs: { out: { t: 'metric', r: rep } } };
        case 'predict':
          if ((miss = need(id, ['model', 'in']))) return miss;
          var pm = input(id, 'model').m, pin = input(id, 'in').ds, lack = ML.missingFields(pm, pin);
          ds = ML.predict(pm, pin);
          return { status: 'ok', summary: '预测了 ' + ds.rows.length + ' 行', ds: ds, outs: { out: tbl(ds) },
            note: lack.length ? '注意：新数据里没有 ' + lack.join('、') + '，按平均值 / 「未知」算了，结果会不准' : '' };
        case 'rule':
          if ((miss = need(id, ['in']))) return miss;
          ds = input(id, 'in').ds;
          var col = n.col || ds.cols[ds.cols.length - 1];
          if (n.val === '' || n.val == null) return { status: 'pass', summary: '还没填条件：全部算「满足」', ds: ds, outs: { yes: tbl(ds), no: tbl({ cols: ds.cols, rows: [] }) } };
          var f = ML.filter(ds, col, n.op || '>', n.val);
          return { status: 'ok', summary: col + ' ' + n.op + ' ' + n.val + '：满足 ' + f.yes.rows.length + ' 行，不满足 ' + f.no.rows.length + ' 行', ds: f.yes, outs: { yes: tbl(f.yes), no: tbl(f.no) } };
        case 'collect':
          return { status: 'idle', msg: '要等真实结果出来再回收，浏览器里没法模拟' };
        case 'ai':
          return { status: 'idle', msg: 'AI 服务要接真的服务（大模型、OCR……），这里只画图' };
        case 'human': case 'ext':
          v = anyTable(id);
          if (!v) return { status: 'idle', msg: n.type === 'human' ? '人来做这一步' : '外部系统' };
          return { status: 'pass', summary: (n.type === 'human' ? '人工处理后' : '经过外部系统') + '原样往下传 ' + v.ds.rows.length + ' 行', ds: v.ds, outs: { out: v } };
        case 'action':
          v = anyTable(id);
          if (!v) return { status: 'idle', msg: '最后要做的事' };
          return { status: 'ok', summary: '会对 ' + v.ds.rows.length + ' 行执行：' + n.name, ds: v.ds };
        case 'store':
          v = anyTable(id);
          if (!v) { var mt = M.edgesInto(doc, id).map(function (e) { return res[e.from] && res[e.from].outs[e.fp]; }).filter(Boolean)[0]; if (mt) return { status: 'ok', summary: '存下了' + (mt.t === 'model' ? '模型' : '评估报告'), metric: mt.r, model: mt.m }; return { status: 'idle', msg: '存档' }; }
          return { status: 'ok', summary: '存下 ' + v.ds.rows.length + ' 行', ds: v.ds };
      }
      return { status: 'idle' };
    }

    var errs = Object.keys(res).filter(function (k) { return res[k].status === 'error'; });
    return { nodes: res, trained: trained, ok: !errs.length, errors: errs.length, ms: Date.now() - t0,
      counts: Object.keys(res).reduce(function (a, k) { a[res[k].status] = (a[res[k].status] || 0) + 1; return a; }, {}) };
  }

  root.ABB = root.ABB || {};
  root.ABB.Engine = { run: run, skippable: skippable, summarizeMetric: summarizeMetric, summarizeModel: summarizeModel, list: list, pct: pct };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Engine;
})(typeof window !== 'undefined' ? window : globalThis);
