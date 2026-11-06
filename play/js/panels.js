/* 右栏：属性（节点 / 连线 / 整张图）、结果（运行出来的表、评估、模型）、检查、四格图、清单。
 * host 由 app.js 提供：doc() readOnly() sel() select(sel) edit(fn, key) commit(fn, msg) locate(id) visible() cmd(name) toggle(id) toast(msg) mode()
 *                     run() runNow() addNear(id, kind, before) insertOn(edgeId, kind) importCSV(id) useDataset(id, dsId) clearData(id)
 *                     lockModel(id, on) downloadModel(id) importModel(id) downloadCSV(ds, name) cols(id, pid)
 */
(function (root) {
  'use strict';
  var C = root.ABB.Config, M = root.ABB.Model, R = root.ABB.Render, E = root.ABB.Engine;

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
  function iconSvg(kind, size) {
    var pal = C.PALETTES.light, col = (pal[C.colorKey(kind)] || pal.biz).stroke;
    return '<svg class="ticon" width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="' + col + '"/>' +
      '<path d="' + (R.ICONS[kind] || R.ICONS.ext) + '" transform="translate(4.6 4.6) scale(.62)" fill="' + (R.FILLED[kind] ? '#fff' : 'none') + '" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /** 分段按钮：opts = [{v, label, tip}]；再点一次已选中的可以清空（allowClear）。 */
  function seg(opts, cur, onPick, allowClear, cls, ro) {
    var box = el('div', { class: 'segbtn ' + (cls || ''), role: 'group' });
    opts.forEach(function (o) {
      box.appendChild(el('button', { type: 'button', class: o.v === cur ? 'on' : '', title: o.tip || '', 'data-v': String(o.v), 'aria-pressed': o.v === cur ? 'true' : 'false', disabled: ro,
        onclick: function () { onPick(o.v === cur && allowClear ? '' : o.v); } }, [o.label]));
    });
    return box;
  }
  function field(label, input, help) {
    return el('div', { class: 'field' }, [el('label', {}, [el('span', { class: 'flabel', text: label }), input]), help ? el('p', { class: 'fhelp', text: help }) : null]);
  }
  function section(title, kids, cls) { return el('section', { class: 'sec ' + (cls || '') }, [el('h4', { text: title })].concat(kids)); }

  var P = { host: null, el: el, seg: seg, iconSvg: iconSvg };

  // ================= 推荐：在后面接 / 在前面补 =================
  var AFTER = {
    table: ['split', 'clean', 'feature', 'mask', 'label', 'train', 'predict', 'rule', 'join', 'collect', 'human', 'ai', 'action', 'store'],
    media: ['label', 'mask', 'train', 'predict', 'ai', 'human', 'store'],
    model: ['model', 'evaluate', 'predict', 'store'],
    metric: ['human', 'store'],
    any: ['human', 'ai', 'rule', 'action', 'ext', 'store', 'predict']
  };
  AFTER.data = AFTER.table;
  var BEFORE = { table: ['src', 'newdata', 'clean', 'feature', 'mask', 'label', 'split', 'join', 'collect', 'human'], model: ['train', 'model'], media: ['src'], any: ['src', 'human', 'ai', 'ext', 'rule'], metric: ['evaluate'] };
  BEFORE.data = BEFORE.table.concat(['src']);
  function suggest(doc, n, before) {
    var ps = M.ports(n), list, ok = [];
    if (before) {
      var free = ps.ins.filter(function (p) { return !M.edgesInto(doc, n.id, p.id).length; })[0] || ps.ins[0]; if (!free) return [];
      list = BEFORE[C.PORTS[free.type].cat] || [];
    } else {
      if (!ps.outs.length) return [];
      var seen = {}; list = [];
      ps.outs.forEach(function (o) { var info = M.info(doc, n.id, o.id), cat = C.PORTS[info.type] ? C.PORTS[info.type].cat : C.PORTS[o.type].cat; (AFTER[cat] || AFTER.any).forEach(function (k) { if (!seen[k]) { seen[k] = 1; list.push(k); } }); });
    }
    list.forEach(function (k) {
      var probe = M.clone(doc), r = M.addNear(probe, n.id, k, before);
      if (!r.err) ok.push(k);
    });
    return ok.slice(0, 10);
  }
  function kindButtons(kinds, onPick, ro) {
    return el('div', { class: 'kbtns' }, kinds.map(function (k) {
      return el('button', { type: 'button', class: 'kbtn g-' + C.KINDS[k].group, disabled: ro, title: C.KINDS[k].tip, onclick: function () { onPick(k); }, html: iconSvg(k, 16) + '<span>' + R.esc(C.KINDS[k].short) + '</span>' });
    }));
  }
  P.suggest = suggest; P.kindButtons = kindButtons;

  // ================= 属性 =================
  P.props = function (body) {
    var h = P.host, doc = h.doc(), sel = h.sel(), ro = h.readOnly();
    var wrap = el('div', { class: 'props' + (ro ? ' ro' : '') });
    if (ro) wrap.appendChild(el('p', { class: 'note', text: '观看模式只能看不能改；想动手改，点「文件 ▾ → 把这个示例复制到『我来画』」。' }));
    if (sel && sel.kind === 'node' && M.get(doc, sel.id)) nodeProps(wrap, doc, M.get(doc, sel.id), ro);
    else if (sel && sel.kind === 'edge' && M.getEdge(doc, sel.id)) edgeProps(wrap, doc, M.getEdge(doc, sel.id), ro);
    else docProps(wrap, doc, ro);
    body.appendChild(wrap);
  };

  function textInput(n, key, ro, multi, ph) {
    var inp = el(multi ? 'textarea' : 'input', { type: multi ? null : 'text', rows: multi ? 2 : null, placeholder: ph || '', disabled: ro, 'data-key': key });
    inp.value = n[key] == null ? '' : n[key];
    inp.addEventListener('input', function () { var v = inp.value; P.host.edit(function (d) { var m = M.get(d, n.id) || M.getEdge(d, n.id); if (m) m[key] = v; }, n.id + '.' + key); });
    return inp;
  }
  function pickCommit(n, key, msg) {
    return function (v) { P.host.commit(function (d) { var m = M.get(d, n.id) || M.getEdge(d, n.id); if (m) m[key] = v; }, msg); };
  }
  function check(n, key, label, ro) {
    var ck = el('input', { type: 'checkbox', disabled: ro, 'data-key': key }); ck.checked = !!n[key];
    ck.addEventListener('change', function () { pickCommit(n, key)(ck.checked); });
    return el('label', { class: 'check' }, [ck, ' ' + label]);
  }
  function locSeg(n, ro, help) {
    var api = !(n.type === 'src' || n.type === 'newdata' || n.type === 'store');
    return field(api ? '运行在哪' : '存放位置', seg(C.LOC_ORDER.map(function (k) { return { v: k, label: k === 'public' && api ? '公有云 API' : C.LOCS[k].name, tip: C.LOCS[k].tip }; }), n.loc, pickCommit(n, 'loc'), false, 'loc', ro),
      help || (api ? '本地 = 装在公司自己的服务器上；公有云 API = 把数据发给外面的服务商来算。' : C.LOCS[n.loc].tip));
  }
  function levelSeg(n, ro) { return field('敏感等级', seg(C.LEVEL_ORDER.map(function (k) { return { v: k, label: C.LEVELS[k].name, tip: C.LEVELS[k].tip }; }), n.level, pickCommit(n, 'level'), false, 'level', ro), C.LEVELS[n.level].tip); }
  function scoreFields(wrap, n, ro) {
    var hml = ['high', 'mid', 'low'].map(function (k) { return { v: k, label: C.HML[k] }; });
    wrap.appendChild(field('业务价值', seg(hml, n.value, pickCommit(n, 'value'), true, 'value', ro), C.VALUE_HELP));
    wrap.appendChild(field('落地难度', seg(hml, n.effort, pickCommit(n, 'effort'), true, 'effort', ro), C.EFFORT_HELP));
    var q = C.quadOf(n.value, n.effort);
    wrap.appendChild(el('p', { class: 'quadline' + (q ? ' q-' + q : '') }, q ? ['四格图里：', el('b', { text: C.QUADS[q].name }), '（' + C.QUADS[q].tip + '）'] : ['价值和难度都选了，就会出现在「四格图」里。']));
  }
  /** 可以点的列名小块：点一下加进 / 移出一个用逗号分隔的字段列表。 */
  function colChips(n, key, cols, ro, single) {
    if (!cols || !cols.length) return null;
    var cur = String(n[key] || '').split(/[,，、;；\s]+/).filter(Boolean);
    return el('div', { class: 'chips colchips' }, cols.map(function (c) {
      var on = cur.indexOf(c) >= 0;
      return el('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), disabled: ro, onclick: function () {
        var v = single ? (on ? '' : c) : (on ? cur.filter(function (x) { return x !== c; }) : cur.concat([c])).join(' ');
        pickCommit(n, key)(v);
      } }, [c]);
    }));
  }

  function nodeProps(wrap, doc, n, ro) {
    var K = C.KINDS[n.type], h = P.host;
    wrap.appendChild(el('div', { class: 'ptype g-' + K.group }, [el('span', { html: iconSvg(n.type) }), el('b', { text: K.name }), el('span', { class: 'hint', text: K.tip })]));
    wrap.appendChild(field('名称', textInput(n, 'name', ro, false, '这一步叫什么')));
    if (n.type !== 'stage') wrap.appendChild(field('说明', textInput(n, 'desc', ro, true, '一两句话：具体做什么、为什么')));
    var cols = n.type !== 'stage' ? h.cols(n.id, 'in') : null, inf;
    switch (n.type) {
      case 'stage': break;
      case 'src': case 'newdata':
        wrap.appendChild(field('数据是什么形态', seg(C.FORM_ORDER.map(function (k) { return { v: k, label: C.FORMS[k].name, tip: C.FORMS[k].tip }; }), n.form, pickCommit(n, 'form'), false, 'form', ro)));
        if (n.type === 'src' && n.form === 'table') {
          wrap.appendChild(field('有没有标签（答案那一列）', seg([{ v: true, label: '有标签' }, { v: false, label: '没有标签' }], !!n.labeled, pickCommit(n, 'labeled'), false, 'labeled', ro),
            '有标签 = 每行都有「答案」：实际销量、合格不合格、客户走没走。有答案才能做监督学习（预测、分类）；没有答案只能分群、找异常，或者先「人工标注」。'));
          if (n.labeled) {
            var own = h.cols(n.id, 'self');
            wrap.appendChild(field('标签列（要预测的那一列）', el('div', {}, [textInput(n, 'target', ro, false, '比如：销量、是否流失'), colChips(n, 'target', own, ro, true)])));
          }
        }
        if (n.type === 'newdata') wrap.appendChild(el('p', { class: 'hint', text: '新数据没有答案，接到「预测」的「新数据」口。字段要和训练数据一样（少几个也能算，但会不准）。' }));
        wrap.appendChild(field('有哪些字段', textInput(n, 'cols', ro, true, '比如：门店、星期、气温、销量')));
        wrap.appendChild(field('来自哪个系统', textInput(n, 'sys', ro, false, '比如：收银系统、CRM、MES')));
        wrap.appendChild(locSeg(n, ro));
        wrap.appendChild(levelSeg(n, ro));
        if (n.form === 'table') dataBlock(wrap, n, ro);
        break;
      case 'clean':
        wrap.appendChild(el('div', { class: 'field' }, [el('span', { class: 'flabel', text: '做哪些清洗' }), check(n, 'dropna', '去掉有空值的行', ro), check(n, 'dedupe', '去掉完全重复的行', ro)]));
        break;
      case 'feature':
        wrap.appendChild(field('保留哪些字段（空着 = 全部）', el('div', {}, [textInput(n, 'keep', ro, false, '用空格或逗号隔开'), colChips(n, 'keep', cols, ro)]), '标签列会自动保留。去掉编号、姓名这类「每行都不一样」的字段，以及不该用的字段（比如事后才知道的信息）。'));
        break;
      case 'mask':
        wrap.appendChild(field('删掉哪些列', el('div', {}, [textInput(n, 'drop', ro, false, '比如：姓名 手机号'), colChips(n, 'drop', cols, ro)]), '能认出人的都删：姓名、手机号、身份证号、详细地址。'));
        break;
      case 'label':
        wrap.appendChild(field('标签列（人要补的答案）', textInput(n, 'target', ro, false, '比如：是否缺陷')));
        wrap.appendChild(field('谁来标', textInput(n, 'role', ro, false, '比如：质检员、客服主管')));
        break;
      case 'split':
        wrap.appendChild(field('训练集占多少', seg([0.7, 0.8, 0.9].map(function (v) { return { v: v, label: Math.round(v * 100) + '%' }; }), n.ratio, pickCommit(n, 'ratio'), false, 'ratio', ro), '剩下的当测试集。数据少时多留一点训练，数据多时 80% 是常见选择。'));
        break;
      case 'train': trainFields(wrap, doc, n, ro); break;
      case 'model': modelFields(wrap, doc, n, ro); break;
      case 'evaluate':
        wrap.appendChild(el('p', { class: 'hint', text: '一边接模型，一边接「拆分」的「测试集」。运行后在「结果」里看：分类看准确率，预测数字看平均差多少。' }));
        break;
      case 'predict':
        inf = M.info(doc, n.id, 'out');
        wrap.appendChild(el('p', { class: 'hint', text: inf.target ? '预测的是「' + inf.target + '」。结果表最右边会多出「预测_' + inf.target + '」这一列。' : '接上模型和新数据，运行后在「结果」里看每一行的预测。' }));
        wrap.appendChild(locSeg(n, ro));
        break;
      case 'collect':
        wrap.appendChild(field('多久以后回收', textInput(n, 'wait', ro, false, '比如：第二天打烊、一个月后')));
        wrap.appendChild(field('谁来补', textInput(n, 'role', ro, false, '比如：收银系统自动、客户经理')));
        wrap.appendChild(el('p', { class: 'hint', text: '把输出接回训练用的数据源（会自动标成反馈线），就是「数据飞轮」。' }));
        break;
      case 'ai': aiFields(wrap, n, ro); break;
      case 'human': case 'action':
        wrap.appendChild(field(n.type === 'human' ? '谁来做' : '谁来执行', textInput(n, 'role', ro, false, '岗位，比如：店长、质检员')));
        break;
      case 'rule':
        wrap.appendChild(field('看哪一列', el('div', {}, [textInput(n, 'col', ro, false, '空着 = 最后一列（通常是预测结果）'), colChips(n, 'col', cols, ro, true)])));
        wrap.appendChild(field('条件', seg(M.OPS.map(function (o) { return { v: o, label: o }; }), n.op, pickCommit(n, 'op'), false, 'op', ro)));
        wrap.appendChild(field('和什么比', textInput(n, 'val', ro, false, '数字，或者一个值，比如：200、缺陷、是')));
        break;
      case 'ext': wrap.appendChild(locSeg(n, ro, '公司外的平台一般选公有云。')); break;
      case 'store': wrap.appendChild(locSeg(n, ro)); wrap.appendChild(levelSeg(n, ro)); break;
    }
    if (n.type === 'stage') stageFields(wrap, doc, n, ro);
    else ioFields(wrap, doc, n, ro);

    var A = root.ABB.Analysis;
    A.risks(doc).list.filter(function (r) { return r.node === n.id || r.target === n.id; }).concat(A.checks(doc).filter(function (r) { return r.node === n.id; })).forEach(function (r) {
      wrap.appendChild(el('p', { class: 'riskline ' + r.level }, [el('b', { text: r.level === 'red' ? '标红：' : r.level === 'yellow' ? '提醒：' : '说明：' }), r.text, r.fix ? el('br') : null, r.fix ? el('small', { text: '建议：' + r.fix }) : null]));
    });

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
    wrap.appendChild(field(n.type === 'stage' ? '放在哪个大环节里' : '放在哪个业务环节里', ps));
    if (!ro) wrap.appendChild(el('div', { class: 'row' }, [el('button', { class: 'mini danger-o', onclick: function () { P.host.cmd('delete'); } }, ['删除这个' + (n.type === 'stage' ? '环节' : '节点')])]));
  }

  function dataBlock(wrap, n, ro) {
    var h = P.host, r = h.run() && h.run().nodes[n.id], kids = [];
    if (n.csv) {
      kids.push(el('p', {}, [el('b', { text: n.csvName || '已导入的数据' }), r && r.ds ? '：' + r.ds.rows.length + ' 行 × ' + r.ds.cols.length + ' 列' : '']));
      if (r && r.ds) kids.push(table(r.ds, 5));
      if (r && r.status === 'error') kids.push(el('p', { class: 'riskline red', text: r.msg }));
    } else kids.push(el('p', { class: 'hint', text: '还没导入数据：只画图。导入一份 CSV（Excel 另存为 CSV），点「运行」就能真的训练和预测。数据只在这个浏览器里，不上传。' }));
    if (!ro) {
      var sel = el('select', { 'aria-label': '用示例数据' }); sel.appendChild(el('option', { value: '', text: '用示例数据…' }));
      Object.keys(root.ABB.Datasets.LIST).forEach(function (k) { var d = root.ABB.Datasets.LIST[k]; sel.appendChild(el('option', { value: k, text: d.name })); });
      sel.addEventListener('change', function () { if (sel.value) h.useDataset(n.id, sel.value); });
      kids.push(el('div', { class: 'row' }, [el('button', { class: 'mini primary', onclick: function () { h.importCSV(n.id); } }, ['导入 CSV']), sel,
        n.csv ? el('button', { class: 'mini', onclick: function () { h.clearData(n.id); } }, ['清掉数据']) : null]));
    }
    wrap.appendChild(section('数据', kids, 'datablk'));
  }

  function trainFields(wrap, doc, n, ro) {
    var s = el('select', { disabled: ro, 'data-key': 'algo' });
    s.appendChild(el('option', { value: '', text: '— 选一种算法 —' }));
    C.ALGO_GROUPS.forEach(function (g) {
      var og = el('optgroup', { label: g.name });
      g.items.forEach(function (it) { og.appendChild(el('option', { value: it.id, text: it.name + '（' + C.TASKS[it.task] + (it.run ? '' : '，只画图') + '）' })); });
      s.appendChild(og);
    });
    s.value = n.algo || '';
    s.addEventListener('change', function () { pickCommit(n, 'algo', '算法换成了' + (C.ALGOS[s.value] ? C.ALGOS[s.value].name : '（空）'))(s.value); });
    var info = el('div', { class: 'aiinfo' }), al = C.ALGOS[n.algo];
    if (al) {
      info.appendChild(el('p', {}, [el('b', { text: al.sup ? '监督学习：' : '无监督学习：' }), al.sup ? '要有标签的数据（每行都有答案）。' : '不用标签，自己从数据里找规律。']));
      info.appendChild(el('p', {}, [el('b', { text: '擅长：' }), al.good]));
      info.appendChild(el('p', {}, [el('b', { text: '要小心：' }), al.warn]));
      if (!al.run) info.appendChild(el('p', { class: 'hint', text: '这个算法浏览器里不运行，只画图。' }));
    } else info.appendChild(el('p', { class: 'hint', text: '怎么选：要预测一个数字（销量）→ 随机森林 / 线性回归；要分类（会不会走、合不合格）→ 逻辑回归 / 决策树 / 随机森林；没有答案，想分群 → K-means；想找出不正常的 → 异常检测。' }));
    wrap.appendChild(field('算法', el('div', {}, [s, info])));
    if (al && al.sup) {
      var e = M.feed(doc, n.id, 'in'), up = e ? M.info(doc, e.from, e.fp) : {};
      wrap.appendChild(field('要预测哪一列（标签）', el('div', {}, [textInput(n, 'target', ro, false, up.target ? '空着 = 跟数据源一样：' + up.target : '比如：销量'), colChips(n, 'target', P.host.cols(n.id, 'in'), ro, true)]),
        up.labeled === false ? '注意：接进来的数据没有标签。先加「人工标注」，或换成 K-means。' : null));
    }
    if (n.algo === 'kmeans') wrap.appendChild(field('分几群', seg([2, 3, 4, 5, 6].map(function (k) { return { v: k, label: String(k) }; }), n.k, pickCommit(n, 'k'), false, 'k', ro), '先试 3 群；分出来每群什么特点，在「结果」里看。'));
    wrap.appendChild(locSeg(n, ro, '在哪训练：本地 / 私有云 = 数据不出公司；公有云 = 用云厂商的训练服务，数据要传出去。'));
    scoreFields(wrap, n, ro);
  }

  function modelFields(wrap, doc, n, ro) {
    var h = P.host, t = n.trained;
    wrap.appendChild(field('版本', textInput(n, 'version', ro, false, 'v1')));
    var box = el('div', { class: 'modelbox' + (n.locked ? ' locked' : '') });
    if (t) {
      box.appendChild(el('p', {}, [el('b', { text: t.algoName }), ' · ' + (t.task === 'reg' ? '预测数字「' + t.target + '」' : t.task === 'clf' ? '分类「' + t.target + '」' : t.task === 'cluster' ? '分 ' + t.k + ' 群' : '找异常') + ' · ' + t.rows + ' 行训练']));
      box.appendChild(el('p', { class: 'hint', text: '用了 ' + t.features.length + ' 个字段：' + t.features.join('、') + (n.trainedAt ? ' · 训练于 ' + n.trainedAt : '') }));
      box.appendChild(el('p', {}, [n.locked ? '🔒 已锁定：运行时直接用这个模型，上游的训练会跳过。来了新数据只做预测。' : '还没锁定：每次运行都会用最新的训练结果替换它。满意了就锁定。']));
    } else box.appendChild(el('p', { class: 'hint', text: '还没训练。接上「训练模型」，导入数据后点「运行」；或者导入别人训练好的模型（.json）。' }));
    if (!ro) box.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'mini ' + (n.locked ? '' : 'primary'), disabled: !t, onclick: function () { h.lockModel(n.id, !n.locked); } }, [n.locked ? '解锁（允许重新训练）' : '🔒 锁定：以后只预测']),
      el('button', { class: 'mini', disabled: !t, onclick: function () { h.downloadModel(n.id); } }, ['下载模型']),
      el('button', { class: 'mini', onclick: function () { h.importModel(n.id); } }, ['导入模型'])]));
    wrap.appendChild(section('训练出来的模型', [box]));
    wrap.appendChild(locSeg(n, ro, '模型文件存在哪、在哪运行。'));
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
    var info = el('div', { class: 'aiinfo' }), t = n.aiType && C.AI[n.aiType];
    if (t) {
      info.appendChild(el('p', {}, [el('b', { text: '擅长：' }), t.good]));
      if (t.warn) info.appendChild(el('p', {}, [el('b', { text: '要小心：' }), t.warn]));
    } else info.appendChild(el('p', { class: 'hint', text: '自己训练模型请用「机器学习」那组节点；这里是买来就能用的 AI 服务。' }));
    wrap.appendChild(field('AI 类型', el('div', {}, [s, info])));
    wrap.appendChild(field('输入什么（会显示在左边的口上）', textInput(n, 'input', ro, false, t ? '例：' + t.inp : '给 AI 什么')));
    wrap.appendChild(field('输出什么（会显示在右边的口上）', textInput(n, 'output', ro, false, t ? '例：' + t.out : 'AI 给出什么')));
    wrap.appendChild(locSeg(n, ro));
    scoreFields(wrap, n, ro);
  }

  function stageFields(wrap, doc, n, ro) {
    var kids = M.children(doc, n.id);
    wrap.appendChild(el('p', { class: 'hint', text: '里面有 ' + kids.length + ' 个节点。把节点拖进这个框就归到这个环节。' }));
    wrap.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'mini', disabled: ro, onclick: function () { P.host.toggle(n.id); } }, [n.collapsed ? '展开' : '折叠']),
      el('button', { class: 'mini', disabled: ro || !kids.length || n.collapsed, title: '按连线先后从左到右排', onclick: function () { P.host.commit(function (d) { M.arrange(d, n.id); }, '排整齐了'); } }, ['里面排整齐'])]));
  }

  /** 输入 / 输出：每个口接的是谁，可以点过去；下面是「在后面接」「在前面补」。 */
  function ioFields(wrap, doc, n, ro) {
    var A = root.ABB.Analysis, ok = function () { return true; };
    var ins = A.inputsOf(doc, n, ok), outs = A.outputsOf(doc, n, ok), kids = [];
    function line(arrow, port, list, req) {
      var li = el('li', {}, [el('span', { class: 'pdot', style: 'background:' + R.portColor(port.type, C.PALETTES.light) }), el('b', { text: port.name }), ' ' + arrow + ' ']);
      if (!list.length) li.appendChild(el('span', { class: req ? 'miss' : 'hint', text: req ? '还没接（必须接）' : '没接' }));
      list.forEach(function (x, i) {
        if (i) li.appendChild(document.createTextNode('、'));
        li.appendChild(el('button', { type: 'button', class: 'linkbtn', onclick: function () { P.host.select({ kind: 'edge', id: x.edge.id }); } }, [x.node.name + '「' + x.port.name + '」' + (x.edge.fb ? '（反馈）' : '')]));
      });
      return li;
    }
    if (ins.length) kids.push(el('p', { class: 'iohead', text: '输入（左边的口）' }), el('ul', { class: 'elist' }, ins.map(function (x) { return line('←', x.port, x.from, x.port.req); })));
    if (outs.length) kids.push(el('p', { class: 'iohead', text: '输出（右边的口）' }), el('ul', { class: 'elist' }, outs.map(function (x) { return line('→', x.port, x.to, false); })));
    if (!ro) {
      var aft = suggest(doc, n, false), bef = suggest(doc, n, true);
      if (aft.length) kids.push(el('p', { class: 'iohead', text: '＋ 在后面接一个（自动连线）' }), kindButtons(aft, function (k) { P.host.addNear(n.id, k, false); }));
      if (bef.length) kids.push(el('p', { class: 'iohead', text: '＋ 在前面补一个' }), kindButtons(bef, function (k) { P.host.addNear(n.id, k, true); }));
    }
    wrap.appendChild(section('输入和输出', kids, 'io'));
  }

  function edgeProps(wrap, doc, e, ro) {
    var a = M.get(doc, e.from), b = M.get(doc, e.to), po = M.port(a, 'outs', e.fp), pi = M.port(b, 'ins', e.tp), inf = M.info(doc, e.from, e.fp);
    wrap.appendChild(el('div', { class: 'ptype t-edge' }, [el('b', { text: e.fb ? '反馈线' : '连线' }), el('span', { class: 'hint', text: e.fb ? '会形成回路的线：表示「下一轮」再用，运行时不走它。' : '从一个节点的输出口，接到另一个节点的输入口。' })]));
    wrap.appendChild(el('p', { class: 'eends' }, [
      el('button', { type: 'button', class: 'linkbtn', onclick: function () { P.host.select({ kind: 'node', id: a.id }); } }, [a.name + '「' + po.name + '」']), ' → ',
      el('button', { type: 'button', class: 'linkbtn', onclick: function () { P.host.select({ kind: 'node', id: b.id }); } }, [b.name + '「' + pi.name + '」'])]));
    var what = C.PORTS[inf.type] ? C.PORTS[inf.type].name : '任意';
    if (inf.type === 'table' || inf.type === 'data') what += inf.labeled === true ? '（有标签' + (inf.target ? '：' + inf.target : '') + '）' : inf.labeled === false ? '（无标签）' : '';
    if (inf.pred) what += '，带预测结果';
    wrap.appendChild(el('p', { class: 'hint', text: '这条线上传的是：' + what }));
    wrap.appendChild(field('标签', textInput(e, 'label', ro, false, '传什么，比如：订单数据')));
    var ck = el('input', { type: 'checkbox', disabled: ro, 'data-key': 'masked' }); ck.checked = !!e.masked;
    ck.addEventListener('change', function () { pickCommit(e, 'masked', ck.checked ? '标成已脱敏' : '取消已脱敏')(ck.checked); });
    wrap.appendChild(el('div', { class: 'field' }, [el('label', { class: 'check' }, [ck, ' 已脱敏']),
      el('p', { class: 'fhelp', text: '传出去之前去掉了能认出人的信息。更清楚的做法是在中间插一个「脱敏」节点，写明删掉哪些列。' })]));
    root.ABB.Analysis.risks(doc).list.filter(function (r) { return r.edge === e.id; }).forEach(function (r) {
      wrap.appendChild(el('p', { class: 'riskline ' + r.level, text: (r.level === 'red' ? '标红：' : '标黄：') + r.text }));
    });
    if (!ro) {
      var cands = C.KIND_ORDER.filter(function (k) { if (k === 'src' || k === 'newdata') return false; var probe = M.clone(doc); return !M.insertOnEdge(probe, e.id, k).err; });
      if (cands.length) wrap.appendChild(section('＋ 在中间插一个节点', [kindButtons(cands.slice(0, 12), function (k) { P.host.insertOn(e.id, k); })]));
      wrap.appendChild(el('div', { class: 'row' }, [el('button', { class: 'mini danger-o', onclick: function () { P.host.cmd('delete'); } }, ['删除这条线'])]));
    }
  }

  function docProps(wrap, doc, ro) {
    if (!ro) {
      var t = el('input', { type: 'text', 'data-key': 'title', placeholder: '比如：我们公司的 AI 蓝图' }); t.value = doc.title || '';
      t.addEventListener('input', function () { var v = t.value; P.host.edit(function (d) { d.title = v; }, 'doc.title', true); });
      wrap.appendChild(field('蓝图名称', t));
    } else wrap.appendChild(el('h3', { text: doc.title }));
    var n = doc.nodes.filter(function (x) { return x.type !== 'stage'; }).length;
    wrap.appendChild(el('p', { class: 'hint', text: '共 ' + n + ' 个节点、' + doc.edges.length + ' 条连线。点一个节点或连线，在这里看它的输入输出、改设置。' }));
    var lg = el('div', { class: 'legend' }); P.legend(lg); wrap.appendChild(lg);
  }

  // ================= 数据表预览 =================
  function fmt(v) { return v == null ? '' : typeof v === 'number' ? (Math.abs(v) >= 1000 || v === Math.round(v) ? String(v) : String(Math.round(v * 100) / 100)) : String(v); }
  function table(ds, max, hiCols) {
    var t = el('table', { class: 'dview' }), hr = el('tr');
    ds.cols.forEach(function (c) { hr.appendChild(el('th', { class: hiCols && hiCols.indexOf(c) >= 0 ? 'hi' : null, text: c })); });
    t.appendChild(el('thead', {}, [hr]));
    var tb = el('tbody');
    ds.rows.slice(0, max || 20).forEach(function (r) {
      var tr = el('tr'); r.forEach(function (v, j) { tr.appendChild(el('td', { class: hiCols && hiCols.indexOf(ds.cols[j]) >= 0 ? 'hi' : (typeof v === 'number' ? 'num' : null), text: fmt(v) })); }); tb.appendChild(tr);
    });
    t.appendChild(tb);
    var box = el('div', { class: 'dwrap' }, [t]);
    if (ds.rows.length > (max || 20)) box.appendChild(el('p', { class: 'hint', text: '只显示前 ' + (max || 20) + ' 行，共 ' + ds.rows.length + ' 行。' }));
    return box;
  }
  P.table = table;

  // ================= 结果 =================
  function tile(big, small, cls) { return el('div', { class: 'tile ' + (cls || '') }, [el('b', { text: big }), el('span', { text: small })]); }
  var STATUS_TXT = { ok: '算好了', pass: '原样往下传', error: '出错了', idle: '只画图，不运行', wait: '等上游', skip: '跳过（模型已锁定）' };

  P.run = function (body) {
    var h = P.host, doc = h.doc(), run = h.run(), sel = h.sel();
    var top = el('div', { class: 'runbar' }, [el('button', { class: 'mini primary', onclick: function () { h.runNow(true); } }, ['▶ 运行']),
      el('span', { class: 'hint', text: run ? '算了 ' + run.ms + ' 毫秒 · ' + Object.keys(run.counts).map(function (k) { return STATUS_TXT[k] + ' ' + run.counts[k]; }).join(' · ') : '还没运行过' })]);
    body.appendChild(top);
    if (!run) {
      body.appendChild(el('div', { class: 'pad' }, [el('p', { text: '点「▶ 运行」，浏览器会按连线顺序把每个节点真的算一遍：读数据、拆分、训练、评估、预测、按规则筛选。' }),
        el('p', { class: 'hint', text: '要有数据才能算：选中一个数据源，在属性里「导入 CSV」或「用示例数据」。AI 服务、图片、录音这类节点只画图、不运行。' })]));
      return;
    }
    var n = sel && sel.kind === 'node' ? M.get(doc, sel.id) : null;
    if (n && n.type !== 'stage') return nodeResult(body, doc, n, run.nodes[n.id] || { status: 'idle' });
    // 没选节点：列出每个节点的状态
    body.appendChild(el('p', { class: 'hint pad0', text: '点一个节点看它算出了什么。' }));
    var list = el('div', { class: 'runlist' });
    M.topo(doc).forEach(function (m) {
      var r = run.nodes[m.id]; if (!r) return;
      list.appendChild(el('button', { type: 'button', class: 'rowbtn st-' + r.status, onclick: function () { h.locate(m.id); } }, [
        el('span', { html: iconSvg(m.type, 18) }), el('span', { class: 'rname', text: m.name }), el('small', { text: r.status === 'error' ? '出错：' + r.msg : (r.summary || r.msg || STATUS_TXT[r.status]) })]));
    });
    body.appendChild(list);
  };

  function nodeResult(body, doc, n, r) {
    var h = P.host;
    body.appendChild(el('div', { class: 'rhead st-' + r.status }, [el('span', { html: iconSvg(n.type) }), el('b', { text: n.name }), el('span', { class: 'badge st-' + r.status, text: STATUS_TXT[r.status] || r.status })]));
    if (r.summary) body.appendChild(el('p', { class: 'rsum', text: r.summary }));
    if (r.msg) body.appendChild(el('p', { class: r.status === 'error' ? 'riskline red' : 'hint', text: r.msg }));
    if (r.note) body.appendChild(el('p', { class: 'riskline yellow', text: r.note }));
    if (r.metric) metricView(body, r.metric);
    if (r.model) modelView(body, r.model, n);
    if (r.ds) {
      var hi = r.ds.cols.filter(function (c) { return /^预测_|^把握$|^分群$|^异常分数$|^是否异常$/.test(c); });
      if (n.type === 'split') body.appendChild(el('p', { class: 'hint', text: '下面是训练集；测试集接在另一个口上。' }));
      body.appendChild(el('div', { class: 'row' }, [el('b', { text: r.ds.rows.length + ' 行 × ' + r.ds.cols.length + ' 列' }), el('button', { class: 'mini', onclick: function () { h.downloadCSV(r.ds, n.name); } }, ['下载 CSV'])]));
      body.appendChild(table(r.ds, 30, hi));
      if (hi.length) body.appendChild(el('p', { class: 'hint', text: '黄色的列是模型算出来的。' + (hi.indexOf('把握') >= 0 ? '「把握」= 模型对这个答案有几成把握（0–1）。' : '') }));
    }
  }

  function bars(items, fmtv) {
    var max = items.reduce(function (a, x) { return Math.max(a, x.v); }, 0) || 1;
    return el('div', { class: 'bars' }, items.map(function (x) {
      return el('div', { class: 'bar' }, [el('span', { class: 'bl', text: x.name }), el('span', { class: 'bt' }, [el('i', { style: 'width:' + (x.v / max * 100) + '%' })]), el('span', { class: 'bv', text: fmtv ? fmtv(x.v) : String(x.v) })]);
    }));
  }
  function metricView(body, m) {
    if (m.task === 'reg') {
      body.appendChild(el('div', { class: 'tiles' }, [tile(String(m.mae), '平均差多少（MAE）'), tile(String(m.r2), 'R²（1 = 完美，0 = 和猜平均数一样）', m.r2 > 0.7 ? 'good' : m.r2 > 0.3 ? 'warn' : 'bad'), tile(String(m.n), '测试集行数')]));
      body.appendChild(el('p', { class: 'hint', text: '测试集里真实值平均是 ' + m.mean + '，模型平均差 ' + m.mae + '。下面是几行对比：' }));
      body.appendChild(table({ cols: ['真实', '预测', '差多少'], rows: m.sample.map(function (s) { return [s.truth, s.pred, Math.round((s.pred - s.truth) * 100) / 100]; }) }, 8));
    } else if (m.task === 'clf') {
      body.appendChild(el('div', { class: 'tiles' }, [tile(E.pct(m.accuracy), '准确率', m.accuracy > m.baseline + 0.05 ? 'good' : 'bad'), tile(E.pct(m.baseline), '全猜最多的那类'), tile(String(m.n), '测试集行数')]));
      body.appendChild(el('p', { class: 'hint', text: m.accuracy > m.baseline + 0.05 ? '比「全猜最多的那类」好，模型学到了东西。' : '和「全猜最多的那类」差不多：模型没学到多少，换算法、加字段或加数据。' }));
      var rows = m.classes.map(function (c, i) { return ['真实：' + c].concat(m.confusion[i]); });
      body.appendChild(el('p', { class: 'iohead', text: '对错表（行 = 真实，列 = 模型预测）' }));
      body.appendChild(table({ cols: [''].concat(m.classes.map(function (c) { return '预测：' + c; })), rows: rows }, 20));
    } else if (m.task === 'cluster') {
      body.appendChild(el('div', { class: 'tiles' }, Object.keys(m.sizes).map(function (k) { return tile(String(m.sizes[k]), k); })));
    } else body.appendChild(el('div', { class: 'tiles' }, [tile(String(m.flagged), '行判为异常'), tile(E.pct(m.rate), '异常比例')]));
  }
  function modelView(body, m, n) {
    var kids = [el('p', {}, [el('b', { text: m.algoName }), ' · ' + m.rows + ' 行训练 · 用了 ' + m.features.length + ' 个字段'])];
    if (m.dropped && m.dropped.length) kids.push(el('p', { class: 'hint', text: '自动没用：' + m.dropped.join('、') + '（几乎每行都不一样，像编号或姓名，留着只会让模型死记硬背）。' }));
    if (m.importance && m.importance.length) { kids.push(el('p', { class: 'iohead', text: '模型最看重哪些字段' })); kids.push(bars(m.importance.slice(0, 8).map(function (x) { return { name: x.name, v: x.v }; }), function (v) { return Math.round(v * 100) + '%'; })); }
    if (m.algo === 'tree') kids.push(el('p', { class: 'hint', text: '这棵树有 ' + m.depth + ' 层问题。' }));
    if (m.algo === 'forest') kids.push(el('p', { class: 'hint', text: m.trees.length + ' 棵树一起投票。' }));
    if (m.task === 'cluster' && m.profile) {
      kids.push(el('p', { class: 'iohead', text: '每一群的特点（数字是平均值，文字是最常见的）' }));
      var feats = Object.keys(m.profile[0] || {});
      kids.push(table({ cols: ['群', '人数'].concat(feats), rows: m.profile.map(function (p, i) { return ['第 ' + (i + 1) + ' 群', m.sizes[i]].concat(feats.map(function (f) { return p[f]; })); }) }, 12));
    }
    if (m.task === 'anomaly') kids.push(el('p', { class: 'hint', text: '异常分数超过 ' + m.threshold + ' 就判为异常（训练数据里最不一样的 2.5%）。' }));
    if (n.type === 'model' || n.type === 'train') kids.push(el('p', { class: 'hint', text: n.type === 'model' ? (n.locked ? '🔒 已锁定：运行时直接用。' : '满意了就到「属性」里锁定，以后只预测、不重训。') : '模型从右边的口出去，接到「模型」节点存起来。' }));
    body.appendChild(section('模型', kids));
  }

  // ================= 检查（统计 + 问题清单） =================
  function locBtn(id, kids, cls, title) { return el('button', { type: 'button', class: 'rowbtn ' + (cls || ''), title: title || '在画布上找到它', onclick: function () { P.host.locate(id); } }, kids); }

  P.check = function (body) {
    var A = root.ABB.Analysis, doc = P.host.doc(), vis = P.host.visible(), st = A.stats(doc, vis), rk = A.risks(doc, vis), ck = A.checks(doc, vis);
    var red = rk.red + ck.filter(function (c) { return c.level === 'red'; }).length, yel = rk.yellow + ck.filter(function (c) { return c.level === 'yellow'; }).length;
    body.appendChild(el('div', { class: 'tiles' }, [
      tile(st.nodes + ' / ' + st.edges, '个节点 / 条连线'),
      tile(st.stagesWithAI + ' / ' + st.stages.length, '个业务环节用了 AI'),
      tile(String(red), '条标红' + (yel ? '，' + yel + ' 条提醒' : ''), red ? 'bad' : yel ? 'warn' : 'good')
    ]));

    var sec = section('问题清单：先看红的', []);
    if (!rk.list.length && !ck.length) sec.appendChild(el('p', { class: 'hint', text: '没发现问题：口都接上了，敏感数据没流向公有云。' }));
    rk.list.concat(ck.filter(function (c) { return c.level === 'red'; })).concat(ck.filter(function (c) { return c.level !== 'red'; })).forEach(function (r) {
      sec.appendChild(locBtn(r.edge || r.node, [el('span', { class: 'rk ' + r.level, text: r.level === 'red' ? '红' : r.level === 'yellow' ? '黄' : 'i' }), el('span', {}, [r.text, r.fix ? el('br') : null, r.fix ? el('small', { text: '建议：' + r.fix }) : null])], 'risk ' + r.level));
    });
    body.appendChild(sec);

    sec = section('模型：训练一次，反复用', []);
    if (!st.models.length) sec.appendChild(el('p', { class: 'hint', text: '还没有模型节点。机器学习的套路：数据 → 拆分 → 训练 → 模型 → 评估；新数据 + 模型 → 预测。' }));
    st.models.forEach(function (m) {
      sec.appendChild(locBtn(m.id, [el('span', { class: 'sname', text: (m.locked ? '🔒 ' : '') + m.name }), el('span', { class: 'chips' }, [
        el('span', { class: 'chip', text: m.algo || '算法未定' }), el('span', { class: 'chip', text: '被 ' + m.uses + ' 个预测用' }), el('span', { class: 'chip' + (m.evaluated ? '' : ' warnchip'), text: m.evaluated ? '有评估' : '没评估' })])]));
    });
    body.appendChild(sec);

    sec = section('每个业务环节有哪些节点', []);
    if (!st.stages.length) sec.appendChild(el('p', { class: 'hint', text: '还没有业务环节。用「业务环节」框把节点分组，看起来更清楚。' }));
    st.stages.forEach(function (s) {
      var chips = Object.keys(s.kinds).map(function (k) { return el('span', { class: 'chip', text: C.KINDS[k].short + (s.kinds[k] > 1 ? ' ×' + s.kinds[k] : '') }); });
      sec.appendChild(locBtn(s.id, [el('span', { class: 'sname', style: 'padding-left:' + s.depth * 14 + 'px', text: (s.ai ? '✓ ' : '○ ') + s.name }), el('span', { class: 'chips' }, chips.length ? chips : [el('span', { class: 'hint', text: '还是空的' })])], 'stage' + (s.ai ? ' yes' : '')));
    });
    body.appendChild(sec);

    var items = Object.keys(st.algos).map(function (k) { return { name: C.ALGOS[k].name, v: st.algos[k] }; }).concat(Object.keys(st.aiTypes).map(function (k) { return { name: C.AI[k].name, v: st.aiTypes[k] }; }));
    sec = section('用了哪些算法和 AI', [items.length ? bars(items) : el('p', { class: 'hint', text: '还没有训练节点或 AI 服务。' })]);
    sec.appendChild(el('div', { class: 'locs' }, C.LOC_ORDER.map(function (l) { return el('span', { class: 'loc-' + l }, [el('b', { text: String(st.aiLoc[l]) }), ' 个 AI 节点在' + (l === 'public' ? '公有云' : C.LOCS[l].name)]); })));
    body.appendChild(sec);

    sec = section('数据：有没有标签、放在哪', [el('p', { class: 'hint', text: '有标签 ' + st.labeled + ' 份，无标签 ' + st.unlabeled + ' 份' + (st.withCsv ? '；' + st.withCsv + ' 份导入了数据，可以运行' : '') + '。' })]);
    var tb = el('table', { class: 'dtable' }), tr = el('tr', {}, [el('th', { text: '' })]);
    C.LEVEL_ORDER.forEach(function (v) { tr.appendChild(el('th', { text: C.LEVELS[v].name })); }); tb.appendChild(tr);
    C.LOC_ORDER.forEach(function (l) {
      var r = el('tr', {}, [el('th', { text: C.LOCS[l].name })]);
      C.LEVEL_ORDER.forEach(function (v) {
        var n = st.data[l][v], bad = n && l === 'public' && (v === 'sensitive' || v === 'secret'), warn = n && l === 'private' && v === 'secret';
        r.appendChild(el('td', { class: bad ? 'bad' : warn ? 'warn' : n ? 'has' : '', text: n ? String(n) : '·' }));
      });
      tb.appendChild(r);
    });
    sec.appendChild(tb);
    body.appendChild(sec);
  };

  // ================= 四格图 =================
  var QX = { low: 0.25, mid: 0.625, high: 0.875 }, QY = { high: 0.14, mid: 0.36, low: 0.75 };
  P.quad = function (body) {
    var A = root.ABB.Analysis, doc = P.host.doc(), vis = P.host.visible(), q = A.quad(doc, vis), pal = root.ABB.App ? root.ABB.App.canvas().pal() : C.PALETTES.light;
    var W = 360, H = 300, L = 30, T = 8, PW = W - L - 6, PH = H - T - 30, svg = [];
    svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" class="quadsvg" role="img" aria-label="AI 价值与难度四格图">');
    [['now', 0, 0], ['plan', 1, 0], ['easy', 0, 1], ['skip', 1, 1]].forEach(function (c) {
      var x = L + c[1] * PW / 2, y = T + c[2] * PH / 2, col = R.quadColor(c[0], pal);
      svg.push('<rect x="' + x + '" y="' + y + '" width="' + (PW / 2 - 2) + '" height="' + (PH / 2 - 2) + '" rx="6" fill="' + col + '" fill-opacity=".10" stroke="' + col + '" stroke-opacity=".35"/>');
      svg.push('<text x="' + (x + 8) + '" y="' + (y + 18) + '" font-size="13" font-weight="bold" fill="' + col + '">' + C.QUADS[c[0]].name + '</text>');
      svg.push('<text x="' + (x + PW / 2 - 10) + '" y="' + (y + PH / 2 - 10) + '" font-size="10.5" text-anchor="end" fill="' + pal.muted + '">' + C.QUADS[c[0]].tip + '</text>');
    });
    svg.push('<text x="' + (L + PW / 2) + '" y="' + (H - 6) + '" font-size="12" text-anchor="middle" fill="' + pal.muted + '">落地难度 → （左：低 ｜ 右：中、高）</text>');
    svg.push('<text transform="translate(14 ' + (T + PH / 2) + ') rotate(-90)" font-size="12" text-anchor="middle" fill="' + pal.muted + '">业务价值 ↑（上：高、中｜下：低）</text>');
    var cells = {};
    ['now', 'plan', 'easy', 'skip'].forEach(function (k) { q[k].forEach(function (p) { var key = p.value + '|' + p.effort; (cells[key] = cells[key] || []).push(p); }); });
    Object.keys(cells).forEach(function (key) {
      var ps = cells[key], v = key.split('|')[0], e = key.split('|')[1], cx = L + QX[e] * PW, cy = T + QY[v] * PH, per = Math.min(ps.length, 5);
      ps.forEach(function (p, i) {
        var col = i % per, row = Math.floor(i / per), x = cx + (col - (per - 1) / 2) * 22, y = cy + row * 22 + (v === 'high' ? 6 : 0);
        var qc = R.quadColor(C.quadOf(p.value, p.effort), pal);
        svg.push('<g class="qpt" data-id="' + p.id + '" tabindex="0"><title>' + R.esc(p.num + '. ' + p.name + '（价值' + C.HML[p.value] + '、难度' + C.HML[p.effort] + '）') + '</title>' +
          '<circle cx="' + x + '" cy="' + y + '" r="14" fill="transparent"/><circle cx="' + x + '" cy="' + y + '" r="10" fill="' + qc + '" stroke="' + pal.bg + '" stroke-width="2"/>' +
          '<text x="' + x + '" y="' + (y + 4) + '" font-size="10.5" font-weight="bold" text-anchor="middle" fill="#fff">' + p.num + '</text></g>');
      });
    });
    svg.push('</svg>');
    var box = el('div', { class: 'quadwrap', html: svg.join('') });
    box.querySelectorAll('.qpt').forEach(function (g) {
      g.addEventListener('click', function () { P.host.locate(g.getAttribute('data-id')); });
      g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') P.host.locate(g.getAttribute('data-id')); });
    });
    body.appendChild(el('p', { class: 'hint', text: '每个点是一个「训练模型」或「AI 服务」节点（编号对应下面的清单），点一下在画布上找到它。「中」算进高的一边。' }));
    body.appendChild(box);
    ['now', 'plan', 'easy', 'skip'].forEach(function (k) {
      var sec = el('section', { class: 'sec qlist q-' + k }, [el('h4', {}, [el('span', { class: 'qdot' }), C.QUADS[k].name + '（' + q[k].length + '）', el('small', { text: ' ' + C.QUADS[k].tip })])]);
      if (!q[k].length) sec.appendChild(el('p', { class: 'hint', text: '—' }));
      q[k].forEach(function (p) { sec.appendChild(locBtn(p.id, [el('span', { class: 'num', text: String(p.num) }), p.name, el('small', { text: '　价值' + C.HML[p.value] + ' · 难度' + C.HML[p.effort] })])); });
      body.appendChild(sec);
    });
    if (q.unrated.length) {
      var sec = section('还没打分（' + q.unrated.length + '）', [el('p', { class: 'hint', text: '点一个，在属性里选「业务价值」和「落地难度」。' })]);
      q.unrated.forEach(function (p) { sec.appendChild(locBtn(p.id, [p.name])); });
      body.appendChild(sec);
    }
  };

  // ================= Markdown 清单 =================
  P.list = function (body) {
    var md = root.ABB.Analysis.markdown(P.host.doc(), P.host.visible(), P.host.run());
    var ta = el('textarea', { class: 'mdview', readonly: true, rows: 20, 'aria-label': 'Markdown 清单' }); ta.value = md;
    body.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'mini primary', onclick: function () { P.host.cmd('md'); } }, ['下载 .md']),
      el('button', { class: 'mini', onclick: function () {
        function fallback() { ta.focus(); ta.select(); try { document.execCommand('copy'); P.host.toast('已复制'); } catch (e) { P.host.toast('请手动全选复制'); } }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(md).then(function () { P.host.toast('已复制，可以粘贴到文档里'); }, fallback); else fallback();
      } }, ['复制全部'])]));
    body.appendChild(el('p', { class: 'hint', text: '主表按连线顺序：每个节点从哪接进来、输出到哪去、关键设置、运行在哪、运行结果。后面附模型、四格图、数据清单和检查。' }));
    body.appendChild(ta);
  };

  /** 说明里的图例：节点分组的颜色、口的颜色。 */
  P.legend = function (box) {
    C.GROUPS.forEach(function (g) {
      var kinds = C.KIND_ORDER.filter(function (k) { return C.KINDS[k].group === g.id; });
      box.appendChild(el('div', { class: 'lg' }, [el('span', { html: iconSvg(kinds[0]) }), el('b', { text: g.name }), el('span', { class: 'hint', text: kinds.map(function (k) { return C.KINDS[k].short; }).join('、') + '：' + g.tip })]));
    });
    var pal = C.PALETTES.light;
    box.appendChild(el('div', { class: 'lg ports' }, [el('b', { text: '口的颜色' })].concat(['table', 'model', 'metric', 'media', 'any'].map(function (cat) {
      var name = { table: '数据表', model: '模型', metric: '评估报告', media: '文字 / 图片 / 录音', any: '任意' }[cat];
      return el('span', { class: 'pchip' }, [el('i', { style: 'background:' + pal.port[cat] }), name]);
    }))));
  };

  root.ABB.Panels = P;
})(window);
