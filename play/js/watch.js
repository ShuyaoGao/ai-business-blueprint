/* 「观看」模式：示例业务按步骤出现，每步一句解说；讲到训练、预测时真的运行一次给你看结果；
 * 倒数几步打开检查、四格图，演示红点怎么消掉。 */
(function (root) {
  'use strict';
  var M = root.ABB.Model, Samples = root.ABB.Samples, E = root.ABB.Engine;
  function $(id) { return document.getElementById(id); }
  var SPEED = { slow: 1.6, normal: 1, fast: 0.45 };

  var W = { app: null, idx: 0, step: 0, playing: false, timer: 0, speed: 'normal', built: null, ids: null, cur: null, visible: null, pop: null };

  function sample() { return Samples.list[W.idx]; }
  function idFn() { var f = function (k) { return W.ids[k]; }; f.set = function (k, v) { W.ids[k] = v; }; return f; }
  var ctx = { train: function (doc) { var r = E.run(doc); Object.keys(r.trained).forEach(function (k) { M.get(doc, k).trained = r.trained[k]; var b = M.get(W.built.doc, k); if (b) b.trained = r.trained[k]; }); } };

  function load(i) {
    W.idx = Math.max(0, Math.min(Samples.list.length - 1, i));
    W.built = Samples.build(sample()); W.ids = {}; for (var k in W.built.ids) W.ids[k] = W.built.ids[k];
    $('sample-select').value = String(W.idx);
    try { root.ABB.Store.set('abb.watchSample', String(W.idx)); } catch (e) { /* */ }
  }

  function go(k, refit) {
    var steps = sample().steps;
    k = Math.max(0, Math.min(steps.length - 1, k));
    var prevVis = W.visible, doc = M.clone(W.built.doc), vis = new Set(), pop = new Set(), id = idFn();
    for (var j = 0; j <= k; j++) {
      (steps[j].show || []).forEach(function (key) { vis.add(W.ids[key]); if (j === k) pop.add(W.ids[key]); });
      if (steps[j].fix) {
        var before = {}; doc.nodes.forEach(function (n) { before[n.id] = 1; });
        steps[j].fix(doc, id, ctx);
        // 改法里新加的节点（比如插进去的「脱敏」）也要看得见
        doc.nodes.forEach(function (n) { if (!before[n.id]) { vis.add(n.id); if (j === k) pop.add(n.id); } });
      }
    }
    if (k > 0 && prevVis && W.step === k - 1) doc.edges.forEach(function (e) { if (vis.has(e.from) && vis.has(e.to) && !(prevVis.has(e.from) && prevVis.has(e.to))) pop.add(e.id); });
    doc.nodes.forEach(function (n) { if (n.type === 'stage') n.collapsed = false; });
    W.cur = doc; W.visible = vis; W.pop = pop; W.step = k;
    clearTimeout(W.popT); W.popT = setTimeout(function () { W.pop = null; }, 700);
    var st = steps[k], S = W.app.S;
    if (st.sel && W.ids[st.sel]) S.sel = st.sel.indexOf('e:') === 0 ? { kind: 'edge', id: W.ids[st.sel] } : { kind: 'node', id: W.ids[st.sel] };
    else S.sel = null;
    S.tab = st.tab || 'props';
    var say = $('watch-say');
    say.innerHTML = '';
    var b = document.createElement('b'); b.textContent = sample().short + '（虚构示例）· 第 ' + (k + 1) + ' / ' + steps.length + ' 步'; say.appendChild(b);
    say.appendChild(document.createTextNode(st.say));
    $('pl-count').textContent = (k + 1) + ' / ' + steps.length;
    $('pl-bar').style.width = ((k + 1) / steps.length * 100) + '%';
    $('pl-prev').disabled = k === 0; $('pl-next').disabled = k === steps.length - 1;
    // 讲到运行以后，每一步都重新算一遍（几十毫秒），结果始终和画面一致
    if (steps.slice(0, k + 1).some(function (x) { return x.run; })) W.app.runNow(false); else S.run = null;
    camera(doc, st, refit);
    W.app.refresh();
    if (W.playing) schedule();
  }

  /** 镜头：整张图太大看不清时，跟着这一步新出现的节点走。 */
  function camera(doc, st, refit) {
    var cv = W.app.canvas, all = M.bounds(W.built.doc), s = cv.size();
    var kAll = all ? Math.min(s.w / (all.w + 100), s.h / (all.h + 40)) : 1;
    var focus = new Set(), S = W.app.S;
    (st.show || []).forEach(function (key) { var n = M.get(doc, W.ids[key]); if (n && n.type !== 'stage') focus.add(n.id); });
    if (S.sel && S.sel.kind === 'node') focus.add(S.sel.id);
    if (S.sel && S.sel.kind === 'edge') { var e = M.getEdge(doc, S.sel.id); if (e) { focus.add(e.from); focus.add(e.to); } }
    var onlyStages = (st.show || []).length && (st.show || []).every(function (key) { var n = M.get(doc, W.ids[key]); return n && n.type === 'stage'; });
    if ((kAll < 0.55 || W.app.isPhone()) && focus.size && !onlyStages && (st.show || []).length < 7) {
      // 带上直接相连、已经出现的节点，看得出前后关系
      if (!W.app.isPhone()) Array.from(focus).forEach(function (id) { doc.edges.forEach(function (e) { if (e.fb) return; var o = e.from === id ? e.to : e.to === id ? e.from : null; if (o && W.visible.has(o)) focus.add(o); }); });
      var r = M.bounds(doc, focus), pad = 50;
      if (r) return cv.fit({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, W.app.isPhone() ? 1 : 0.9);
    }
    if (refit || onlyStages || kAll < 0.55 || W.app.isPhone()) cv.fit(all, 1);
  }

  function schedule() {
    clearTimeout(W.timer);
    var st = sample().steps[W.step];
    var ms = (2000 + st.say.length * 100) * SPEED[W.speed];
    W.timer = setTimeout(function () {
      if (W.step < sample().steps.length - 1) go(W.step + 1); else stop();
    }, ms);
  }
  function play() {
    if (W.app.S.mode !== 'watch') return;
    if (W.step >= sample().steps.length - 1) go(0, true);
    W.playing = true; $('pl-play').textContent = '暂停'; $('pl-play').classList.add('on'); schedule();
  }
  function stop() { W.playing = false; clearTimeout(W.timer); $('pl-play').textContent = '播放'; $('pl-play').classList.remove('on'); }

  W.init = function (app) {
    W.app = app;
    var sel = $('sample-select');
    Samples.list.forEach(function (s, i) { var o = document.createElement('option'); o.value = String(i); o.textContent = s.title.replace('（虚构示例）', ''); sel.appendChild(o); });
    sel.addEventListener('change', function () { stop(); load(+sel.value); go(0, true); play(); });
    $('pl-play').addEventListener('click', function () { if (W.playing) stop(); else play(); });
    $('pl-prev').addEventListener('click', function () { stop(); go(W.step - 1); });
    $('pl-next').addEventListener('click', function () { stop(); go(W.step + 1); });
    $('pl-restart').addEventListener('click', function () { go(0, true); play(); });
    document.querySelectorAll('#pl-speed button').forEach(function (b) {
      b.addEventListener('click', function () {
        W.speed = b.getAttribute('data-speed');
        document.querySelectorAll('#pl-speed button').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (W.playing) schedule();
      });
    });
    var saved = 0; try { saved = +(root.ABB.Store.get('abb.watchSample') || 0) || 0; } catch (e) { /* */ }
    load(saved);
  };
  W.enter = function () { go(0, true); setTimeout(function () { W.app.canvas.fit(M.bounds(W.built.doc), 1); if (!W.app.helpOpen()) W.autoStart(); }, 0); };
  W.leave = function () { stop(); };
  W.autoStart = function () { if (W.app.S.mode === 'watch' && !W.playing && W.step === 0) play(); };
  W.toggle = function () { if (W.playing) stop(); else play(); };
  W.stop = stop;
  W.go = function (k) { go(k); };
  W.load = function (i) { stop(); load(i); go(0, true); };
  W.doc = function () { return W.cur || (W.built && W.built.doc) || M.create(''); };
  /** 复制到「我来画」：带上已经训练好的模型。 */
  W.fullDoc = function () { var d = M.clone(W.built.doc); return d; };
  W.applyTrained = function (map, ts) {
    Object.keys(map).forEach(function (id) { [W.cur, W.built.doc].forEach(function (d) { var n = d && M.get(d, id); if (n && !n.locked) { n.trained = map[id]; n.trainedAt = ts; } }); });
  };
  W.extra = function () { return { visible: W.visible, pop: W.pop }; };
  W.state = function () { return { idx: W.idx, step: W.step, steps: sample().steps.length, playing: W.playing }; };

  root.ABB.Watch = W;
})(window);
