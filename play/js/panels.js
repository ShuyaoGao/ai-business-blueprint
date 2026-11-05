/* 右栏：属性（方框 / 连线 / 整张蓝图）、统计、四格图、清单、练习任务。
 * host 由 app.js 提供：doc() readOnly() sel() select(sel) edit(fn, key) commit(fn, msg) reveal(id) cmd(name)
 */
(function (root) {
  'use strict';
  var C = root.ABB.Config, M = root.ABB.Model, R = root.ABB.Render;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'style') e.setAttribute('style', v); else e.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c == null) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function iconSvg(type, size) {
    var pal = C.PALETTES.light;
    return '<svg class="ticon" width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="' + pal[type].stroke + '"/>' +
      '<path d="' + R.ICONS[type] + '" transform="translate(4.6 4.6) scale(.62)" fill="' + (type === 'ai' ? '#fff' : 'none') + '" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /** 分段按钮：opts = [{v, label, tip}]；再点一次已选中的可以清空（allowClear）。 */
  function seg(opts, cur, onPick, allowClear, cls) {
    var box = el('div', { class: 'segbtn ' + (cls || ''), role: 'group' });
    opts.forEach(function (o) {
      box.appendChild(el('button', { type: 'button', class: o.v === cur ? 'on' : '', title: o.tip || '', 'data-v': o.v, 'aria-pressed': o.v === cur ? 'true' : 'false',
        onclick: function () { onPick(o.v === cur && allowClear ? '' : o.v); } }, [o.label]));
    });
    return box;
  }
  function field(label, input, help) {
    return el('div', { class: 'field' }, [el('label', {}, [el('span', { class: 'flabel', text: label }), input]), help ? el('p', { class: 'fhelp', text: help }) : null]);
  }

  var P = { host: null, el: el, seg: seg, iconSvg: iconSvg };

  // ================= 属性 =================
  P.props = function (body) {
    var h = P.host, doc = h.doc(), sel = h.sel(), ro = h.readOnly();
    var wrap = el('div', { class: 'props' + (ro ? ' ro' : '') });
    if (ro) wrap.appendChild(el('p', { class: 'note', text: '观看模式只能看不能改；想动手改，点「文件 ▾ → 把这个示例复制到「我来画」」。' }));
    if (sel && sel.kind === 'node' && M.get(doc, sel.id)) nodeProps(wrap, doc, M.get(doc, sel.id), ro);
    else if (sel && sel.kind === 'edge' && M.getEdge(doc, sel.id)) edgeProps(wrap, doc, M.getEdge(doc, sel.id), ro);
    else docProps(wrap, doc, ro);
    body.appendChild(wrap);
  };

  function textInput(n, key, ro, multi, ph) {
    var inp = el(multi ? 'textarea' : 'input', { type: multi ? null : 'text', rows: multi ? 2 : null, placeholder: ph || '', disabled: ro, 'data-key': key });
    inp.value = n[key] || '';
    inp.addEventListener('input', function () { var v = inp.value; P.host.edit(function (d) { var m = M.get(d, n.id) || M.getEdge(d, n.id); if (m) m[key] = v; }, n.id + '.' + key); });
    return inp;
  }
  function pickCommit(n, key, msg) {
    return function (v) { P.host.commit(function (d) { var m = M.get(d, n.id) || M.getEdge(d, n.id); if (m) m[key] = v; }, msg); };
  }

  function nodeProps(wrap, doc, n, ro) {
    var T = C.TYPES[n.type];
    wrap.appendChild(el('div', { class: 'ptype t-' + n.type }, [el('span', { html: iconSvg(n.type) }), el('b', { text: T.name }), el('span', { class: 'hint', text: T.tip })]));
    wrap.appendChild(field('名称', textInput(n, 'name', ro, false, '这一步叫什么')));
    wrap.appendChild(field('说明', textInput(n, 'desc', ro, true, '一两句话：具体做什么')));
    if (n.type === 'human') wrap.appendChild(field('谁来做', textInput(n, 'role', ro, false, '岗位，比如：店长、质检员')));
    if (n.type === 'ai') aiFields(wrap, n, ro);
    if (n.type === 'data') {
      wrap.appendChild(field('存放位置', seg(C.LOC_ORDER.map(function (k) { return { v: k, label: C.LOCS[k].name, tip: C.LOCS[k].tip }; }), n.loc, pickCommit(n, 'loc'), false, 'loc'), C.LOCS[n.loc].tip));
      wrap.appendChild(field('敏感等级', seg(C.LEVEL_ORDER.map(function (k) { return { v: k, label: C.LEVELS[k].name, tip: C.LEVELS[k].tip }; }), n.level, pickCommit(n, 'level'), false, 'level'), C.LEVELS[n.level].tip));
    }
    if (n.type === 'ext') wrap.appendChild(field('所在位置', seg(C.LOC_ORDER.map(function (k) { return { v: k, label: C.LOCS[k].name, tip: C.LOCS[k].tip }; }), n.loc, pickCommit(n, 'loc'), false, 'loc'), C.LOCS[n.loc].tip + '（公司外的平台一般选公有云）'));
    if (root.ABB.Analysis && n.type !== 'stage') {
      var rk = root.ABB.Analysis.risks(doc).list.filter(function (r) { return r.node === n.id; });
      rk.forEach(function (r) { wrap.appendChild(el('p', { class: 'riskline ' + r.level, text: (r.level === 'red' ? '标红：' : '标黄：') + r.text })); });
    }

    // 放在哪个环节里（手机上拖不准时用这个）
    var ps = el('select', { disabled: ro, 'data-key': 'parent' });
    ps.appendChild(el('option', { value: '', text: '（不属于任何环节）' }));
    M.ordered(doc.nodes.filter(function (s) { return s.type === 'stage' && M.canParent(doc, n.id, s.id); })).forEach(function (s) {
      ps.appendChild(el('option', { value: s.id, text: new Array(M.depth(doc, s.id) + 1).join('　') + s.name }));
    });
    ps.value = n.parent || '';
    ps.addEventListener('change', function () {
      var v = ps.value || null;
      P.host.commit(function (d) { if (v) M.placeInside(d, v, M.get(d, n.id)); else M.detach(d, n.id); }, v ? '放进了环节' : '移出了环节');
    });
    wrap.appendChild(field(n.type === 'stage' ? '放在哪个大环节里' : '放在哪个环节里', ps));

    if (n.type === 'stage') {
      var kids = M.children(doc, n.id);
      wrap.appendChild(el('p', { class: 'hint', text: '里面有 ' + kids.length + ' 个方框（共 ' + M.descendants(doc, n.id).length + ' 个，含更小的环节）。把方框拖进这个大框就成了它的小步骤。' }));
      wrap.appendChild(el('div', { class: 'row' }, [
        el('button', { class: 'mini', disabled: ro, onclick: function () { P.host.toggle(n.id); } }, [n.collapsed ? '展开' : '折叠']),
        el('button', { class: 'mini', disabled: ro || !kids.length || n.collapsed, title: '把里面的方框排成整齐的一列或几列', onclick: function () { P.host.commit(function (d) { M.arrange(d, n.id); }, '排整齐了'); } }, ['里面排整齐'])
      ]));
    }

    // 连线
    var es = doc.edges.filter(function (e) { return e.from === n.id || e.to === n.id; });
    if (es.length) {
      var ul = el('ul', { class: 'elist' });
      es.forEach(function (e) {
        var out = e.from === n.id, other = M.get(doc, out ? e.to : e.from);
        ul.appendChild(el('li', {}, [el('button', { type: 'button', class: 'linkbtn', onclick: function () { P.host.select({ kind: 'edge', id: e.id }); } },
          [(out ? '→ ' : '← ') + other.name + (e.kind === 'data' ? '（数据流' + (e.masked ? '·已脱敏' : '') + '）' : '（流程）') + (e.label ? '：' + e.label : '')])]));
      });
      wrap.appendChild(el('div', { class: 'field' }, [el('span', { class: 'flabel', text: '连线（' + es.length + '）' }), ul]));
    }
    if (!ro) wrap.appendChild(el('div', { class: 'row' }, [el('button', { class: 'mini danger-o', onclick: function () { P.host.cmd('delete'); } }, ['删除这个方框'])]));
  }

  function aiFields(wrap, n, ro) {
    var s = el('select', { disabled: ro, 'data-key': 'aiType' });
    s.appendChild(el('option', { value: '', text: '— 选一类 AI —' }));
    C.AI_GROUPS.forEach(function (g) {
      var og = el('optgroup', { label: g.name });
      g.items.forEach(function (it) { og.appendChild(el('option', { value: it.id, text: it.name })); });
      s.appendChild(og);
    });
    s.value = n.aiType || '';
    s.addEventListener('change', function () { pickCommit(n, 'aiType')(s.value); });
    var info = el('div', { class: 'aiinfo' });
    var t = n.aiType && C.AI[n.aiType];
    if (t) {
      info.appendChild(el('p', {}, [el('b', { text: '擅长：' }), t.good]));
      if (t.warn) info.appendChild(el('p', {}, [el('b', { text: '要小心：' }), t.warn]));
    } else info.appendChild(el('p', { class: 'hint', text: '不确定选哪类？看下拉菜单的分组：处理文字、看图听声、算数字、按规则做决定。' }));
    wrap.appendChild(field('AI 类型', el('div', {}, [s, info])));
    wrap.appendChild(field('输入什么', textInput(n, 'input', ro, false, t ? '例：' + t.inp : '给 AI 什么数据')));
    wrap.appendChild(field('输出什么', textInput(n, 'output', ro, false, t ? '例：' + t.out : 'AI 给出什么结果')));
    wrap.appendChild(field('运行在哪', seg(C.LOC_ORDER.map(function (k) { return { v: k, label: k === 'public' ? '公有云 API' : C.LOCS[k].name, tip: C.LOCS[k].tip }; }), n.loc, pickCommit(n, 'loc'), false, 'loc'),
      '本地 = 模型装在公司自己的服务器上；公有云 API = 把数据发给外面的服务商来算。'));
    var hml = ['high', 'mid', 'low'].map(function (k) { return { v: k, label: C.HML[k] }; });
    wrap.appendChild(field('业务价值', seg(hml, n.value, pickCommit(n, 'value'), true, 'value'), C.VALUE_HELP));
    wrap.appendChild(field('落地难度', seg(hml, n.effort, pickCommit(n, 'effort'), true, 'effort'), C.EFFORT_HELP));
    var q = C.quadOf(n.value, n.effort);
    wrap.appendChild(el('p', { class: 'quadline' + (q ? ' q-' + q : '') }, q ? ['四格图里：', el('b', { text: C.QUADS[q].name }), '（' + C.QUADS[q].tip + '）'] : ['价值和难度都选了，就会出现在「四格图」里。']));
  }

  function edgeProps(wrap, doc, e, ro) {
    var a = M.get(doc, e.from), b = M.get(doc, e.to);
    wrap.appendChild(el('div', { class: 'ptype t-edge' }, [el('b', { text: '连线' }), el('span', { class: 'hint', text: '实线 = 业务流程，虚线 = 数据流' })]));
    wrap.appendChild(el('p', { class: 'eends' }, [
      el('button', { type: 'button', class: 'linkbtn', onclick: function () { P.host.select({ kind: 'node', id: a.id }); } }, [a.name]), ' → ',
      el('button', { type: 'button', class: 'linkbtn', onclick: function () { P.host.select({ kind: 'node', id: b.id }); } }, [b.name])]));
    wrap.appendChild(field('类型', seg([{ v: 'flow', label: '流程（实线）' }, { v: 'data', label: '数据流（虚线）' }], e.kind, pickCommit(e, 'kind'), false, 'kind')));
    wrap.appendChild(field('标签', textInput(e, 'label', ro, false, '传什么，比如：订单数据')));
    var ck = el('input', { type: 'checkbox', disabled: ro, 'data-key': 'masked' }); ck.checked = !!e.masked;
    ck.addEventListener('change', function () { pickCommit(e, 'masked', ck.checked ? '标成已脱敏' : '取消已脱敏')(ck.checked); });
    wrap.appendChild(el('div', { class: 'field' }, [el('label', { class: 'check' }, [ck, ' 已脱敏']),
      el('p', { class: 'fhelp', text: '传出去之前去掉了姓名、电话、身份证这类能认出人的信息，或者只传统计结果、分群标签。勾上后，敏感数据上公有云从标红变成标黄（提醒你确认脱敏到位）。' })]));
    if (root.ABB.Analysis) {
      root.ABB.Analysis.risks(doc).list.filter(function (r) { return r.edge === e.id; }).forEach(function (r) {
        wrap.appendChild(el('p', { class: 'riskline ' + r.level, text: (r.level === 'red' ? '标红：' : '标黄：') + r.text }));
      });
    }
    if (!ro) wrap.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'mini', onclick: function () { P.host.commit(function (d) { if (!M.reverseEdge(d, e.id)) throw new Error('反方向已经有一条线了'); }, '方向反过来了'); } }, ['反转方向']),
      el('button', { class: 'mini danger-o', onclick: function () { P.host.cmd('delete'); } }, ['删除这条线'])]));
  }

  function docProps(wrap, doc, ro) {
    if (!ro) {
      var t = el('input', { type: 'text', 'data-key': 'title', placeholder: '比如：我们公司的 AI 蓝图' }); t.value = doc.title || '';
      t.addEventListener('input', function () { var v = t.value; P.host.edit(function (d) { d.title = v; }, 'doc.title', true); });
      wrap.appendChild(field('蓝图名称', t));
    } else wrap.appendChild(el('h3', { text: doc.title }));
    var cnt = {}; C.TYPE_ORDER.forEach(function (k) { cnt[k] = 0; }); doc.nodes.forEach(function (n) { cnt[n.type]++; });
    wrap.appendChild(el('p', { class: 'hint', text: '共 ' + doc.nodes.length + ' 个方框、' + doc.edges.length + ' 条连线。点一个方框或连线，在这里改它的属性。' }));
    var lg = el('div', { class: 'legend' });
    C.TYPE_ORDER.forEach(function (k) {
      lg.appendChild(el('div', { class: 'lg' }, [el('span', { html: iconSvg(k) }), el('b', { text: C.TYPES[k].name + '（' + cnt[k] + '）' }), el('span', { class: 'hint', text: C.TYPES[k].tip })]));
    });
    wrap.appendChild(lg);
    wrap.appendChild(el('p', { class: 'hint', text: '颜色和形状：蓝色大框 = 业务环节；琥珀色 = 人工；紫色双边框 = AI；绿色圆柱 = 数据；灰色虚线框 = 外部系统。数据下面两个小标签是「存放位置」和「敏感等级」；AI 右上角的小标签是它在四格图里的位置。' }));
  }

  P.legend = function (box) {
    C.TYPE_ORDER.forEach(function (k) { box.appendChild(el('div', { class: 'lg' }, [el('span', { html: iconSvg(k) }), el('b', { text: C.TYPES[k].name }), el('span', { class: 'hint', text: C.TYPES[k].tip })])); });
  };

  root.ABB.Panels = P;
})(window);
