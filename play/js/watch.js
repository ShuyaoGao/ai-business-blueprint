/* 「观看」模式：示例业务按步骤出现，每步一句解说；倒数几步自动打开统计、四格图，演示红点怎么消掉。 */
(function (root) {
  'use strict';
  var M = root.ABB.Model, Samples = root.ABB.Samples;
  function $(id) { return document.getElementById(id); }
  var SPEED = { slow: 1.6, normal: 1, fast: 0.45 };

  var W = { app: null, idx: 0, step: 0, playing: false, timer: 0, speed: 'normal', built: null, cur: null, visible: null, pop: null };

  function sample() { return Samples.list[W.idx]; }
  function idOf(k) { return W.built.ids[k]; }

  function load(i) {
    W.idx = Math.max(0, Math.min(Samples.list.length - 1, i));
    W.built = Samples.build(sample());
    $('sample-select').value = String(W.idx);
    try { root.ABB.Store.set('abb.watchSample', String(W.idx)); } catch (e) { /* */ }
  }

  function go(k, refit) {
    var steps = sample().steps;
    k = Math.max(0, Math.min(steps.length - 1, k));
    var prevVis = W.visible, doc = M.clone(W.built.doc), vis = new Set(), pop = new Set();
    for (var j = 0; j <= k; j++) {
      (steps[j].show || []).forEach(function (key) { vis.add(idOf(key)); if (j === k) pop.add(idOf(key)); });
      if (steps[j].fix) steps[j].fix(doc, idOf);
    }
    if (k > 0 && prevVis && W.step === k - 1) doc.edges.forEach(function (e) { if (vis.has(e.from) && vis.has(e.to) && !(prevVis.has(e.from) && prevVis.has(e.to))) pop.add(e.id); });
    // 观看时环节一直保持展开
    doc.nodes.forEach(function (n) { if (n.type === 'stage') n.collapsed = false; });
    W.cur = doc; W.visible = vis; W.pop = pop; W.step = k;
    clearTimeout(W.popT); W.popT = setTimeout(function () { W.pop = null; }, 700);
    var st = steps[k], S = W.app.S;
    if (st.sel) { var id = idOf(st.sel); S.sel = st.sel.indexOf('e:') === 0 ? { kind: 'edge', id: id } : { kind: 'node', id: id }; }
    else S.sel = null;
    S.tab = st.tab || 'props';
    var say = $('watch-say');
    say.innerHTML = '';
    var b = document.createElement('b'); b.textContent = sample().short + '（虚构示例）· 第 ' + (k + 1) + ' / ' + steps.length + ' 步'; say.appendChild(b);
    say.appendChild(document.createTextNode(st.say));
    $('pl-count').textContent = (k + 1) + ' / ' + steps.length;
    $('pl-bar').style.width = ((k + 1) / steps.length * 100) + '%';
    $('pl-prev').disabled = k === 0; $('pl-next').disabled = k === steps.length - 1;
    if (W.app.isPhone()) {
      // 手机屏幕窄：镜头跟着这一步新出现的方框走；只换右栏的步骤看全图
      var focus = new Set(); (st.show || []).forEach(function (key) { focus.add(idOf(key)); });
      if (S.sel && S.sel.kind === 'node') focus.add(S.sel.id);
      if (S.sel && S.sel.kind === 'edge') { var e = M.getEdge(doc, S.sel.id); if (e) { focus.add(e.from); focus.add(e.to); } }
      focus.forEach(function (id) { var n = M.get(doc, id); if (n && n.parent && n.type !== 'data') focus.add(n.parent); });
      var r = focus.size && (st.show || []).length < 5 ? M.bounds(doc, focus) : null;
      if (r) { var pad = 30; W.app.canvas.fit({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, 1); }
      else W.app.canvas.fit(M.bounds(W.built.doc), 1);
    } else if (refit) W.app.canvas.fit(M.bounds(W.built.doc), 1);
    W.app.refresh();
    if (W.playing) schedule();
  }

  function schedule() {
    clearTimeout(W.timer);
    var st = sample().steps[W.step];
    var ms = (1800 + st.say.length * 95) * SPEED[W.speed];
    W.timer = setTimeout(function () {
      if (W.step < sample().steps.length - 1) go(W.step + 1); else stop();
    }, ms);
  }
  function play() {
    if (W.app.S.mode !== 'watch') return;
    if (W.step >= sample().steps.length - 1) go(0);
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
  W.enter = function () { go(0, false); setTimeout(function () { if (!W.app.isPhone()) W.app.canvas.fit(M.bounds(W.built.doc), 1); if (!W.app.helpOpen()) W.autoStart(); }, 0); };
  W.leave = function () { stop(); };
  W.autoStart = function () { if (W.app.S.mode === 'watch' && !W.playing && W.step === 0) play(); };
  W.toggle = function () { if (W.playing) stop(); else play(); };
  W.stop = stop;
  W.go = function (k) { go(k); };
  W.load = function (i) { stop(); load(i); go(0, true); };
  W.doc = function () { return W.cur || (W.built && W.built.doc) || M.create(''); };
  W.fullDoc = function () { return M.clone(W.built.doc); };
  W.extra = function () { return { visible: W.visible, pop: W.pop }; };
  W.state = function () { return { idx: W.idx, step: W.step, steps: sample().steps.length, playing: W.playing }; };

  root.ABB.Watch = W;
})(window);
