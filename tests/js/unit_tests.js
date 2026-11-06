/* Node 单元测试：节点和端口、连线规则、算法、运行引擎、检查与红黄规则、统计、Markdown、三个示例、SVG 绘制。
 * 运行：node tests/js/unit_tests.js（全部通过时退出码 0） */
'use strict';
const path = require('path');
const js = p => path.join(__dirname, '..', '..', 'play', 'js', p);
const C = require(js('config.js')), M = require(js('model.js')), ML = require(js('ml.js')), E = require(js('engine.js'));
const A = require(js('analysis.js')), D = require(js('datasets.js')), S = require(js('samples.js'));
let R = null; try { R = require(js('render.js')); } catch (e) { R = null; }

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); }
function ok(c, msg) { if (!c) throw new Error(msg || '条件不成立'); }

console.log('配置');
t('节点库：每种节点都有名字、说明、所在分组；口的类型都认识', () => {
  C.KIND_ORDER.forEach(k => { const n = C.KINDS[k]; ok(n.name && n.tip && C.GROUPS.some(g => g.id === n.group), k); n.ins.concat(n.outs).forEach(p => ok(C.PORTS[p.type], k + '.' + p.id)); });
});
t('口的类型：模型只接模型，数据表不接模型，「任意」都能接，「数据」接表格和图片', () => {
  ok(C.compatible('model', 'model')); ok(!C.compatible('table', 'model')); ok(!C.compatible('model', 'table'));
  ok(C.compatible('table', 'any')); ok(C.compatible('any', 'model')); ok(C.compatible('image', 'data')); ok(C.compatible('table', 'data')); ok(!C.compatible('image', 'table'));
});
t('算法：监督要标签、无监督不要；浏览器能跑的 8 种都在 ML 里', () => {
  eq(C.ALGO_ORDER.filter(k => !C.ALGOS[k].sup), ['kmeans', 'anomaly']);
  C.ALGO_ORDER.filter(k => C.ALGOS[k].run).forEach(k => ok(ML.ALGO_NAMES[k], k));
});
t('四格图：中算进高的一边', () => {
  eq(C.quadOf('high', 'low'), 'now'); eq(C.quadOf('mid', 'low'), 'now'); eq(C.quadOf('high', 'mid'), 'plan');
  eq(C.quadOf('low', 'low'), 'easy'); eq(C.quadOf('low', 'mid'), 'skip'); eq(C.quadOf('', 'low'), '');
});

console.log('节点和连线');
function chain() {
  const d = M.create('t');
  const s = M.addNode(d, 'src', 0, 0, { name: '流水', labeled: true, target: 'y' });
  const sp = M.addNode(d, 'split', 300, 0), tr = M.addNode(d, 'train', 600, 0, { algo: 'forest' }), mo = M.addNode(d, 'model', 900, 0);
  const ev = M.addNode(d, 'evaluate', 1200, 0), nd = M.addNode(d, 'newdata', 600, 300), pr = M.addNode(d, 'predict', 1200, 300);
  [[s, sp], [sp, tr], [tr, mo], [mo, ev], [sp, ev], [mo, pr], [nd, pr]].forEach(([a, b]) => { const r = M.connect(d, a.id, b.id); if (r.err) throw new Error(r.err); });
  return { d, s, sp, tr, mo, ev, nd, pr };
}
t('节点的口：拆分有训练集和测试集两个输出口；评估和预测都有两个输入口', () => {
  const d = M.create(); eq(M.ports(M.addNode(d, 'split')).outs.map(p => p.id), ['train', 'test']);
  eq(M.ports(M.addNode(d, 'evaluate')).ins.map(p => p.id), ['model', 'test']); eq(M.ports(M.addNode(d, 'predict')).ins.map(p => p.id), ['model', 'in']);
});
t('节点高度跟着口的数量变，口的位置在左右两边', () => {
  const d = M.create(), a = M.addNode(d, 'clean', 10, 20), b = M.addNode(d, 'evaluate', 10, 20);
  ok(M.layout(b).h > M.layout(a).h); const L = M.layout(b); eq(L.ins[0].x, 10); ok(L.ins[1].y > L.ins[0].y);
  eq(M.portPos(a, 'outs', 'out').x, 10 + a.w);
});
t('自动挑口：拆分的测试集接评估的测试集，训练集接训练', () => {
  const { d, sp, ev, tr } = chain();
  eq(M.edgesInto(d, ev.id, 'test')[0].fp, 'test'); eq(M.edgesInto(d, tr.id, 'in')[0].fp, 'train');
});
t('类型对不上连不了，给中文原因；连自己、连环节框也不行', () => {
  const { d, mo, s, tr } = chain();
  ok(/类型对不上/.test(M.connect(d, mo.id, s.id).err || M.addEdge(d, mo.id, 'out', s.id, 'in').err));
  ok(M.addEdge(d, tr.id, 'model', tr.id, 'in').err);
  const st = M.addNode(d, 'stage'); ok(/分组框/.test(M.addEdge(d, s.id, 'out', st.id, 'in').err));
});
t('单口再接一条线：换掉原来那条；多口可以接好几条', () => {
  const { d, tr, nd } = chain(); const r = M.addEdge(d, nd.id, 'out', tr.id, 'in');
  ok(r.replaced); eq(M.edgesInto(d, tr.id, 'in').length, 1);
  const h = M.addNode(d, 'human'); M.connect(d, tr.id, h.id); M.connect(d, nd.id, h.id); eq(M.edgesInto(d, h.id).length, 2);
});
t('形成回路的线自动标成反馈线，拓扑顺序不受影响', () => {
  const { d, pr, s } = chain(); const c = M.addNode(d, 'collect'); M.connect(d, pr.id, c.id);
  const r = M.connect(d, c.id, s.id); ok(r.edge && r.edge.fb, '反馈线'); const order = M.topo(d).map(n => n.id); ok(order.indexOf(s.id) < order.indexOf(c.id));
});
t('在线中间插节点：A → 新 → B，口接对', () => {
  const { d, s, sp } = chain(); const e = M.edgesOut(d, s.id)[0];
  const r = M.insertOnEdge(d, e.id, 'clean'); ok(r.node); eq(M.edgesInto(d, r.node.id)[0].from, s.id); eq(M.edgesOut(d, r.node.id)[0].to, sp.id);
  ok(M.insertOnEdge(d, M.edgesInto(d, d.nodes.find(n => n.type === 'evaluate').id, 'model')[0].id, 'clean').err, '模型线中间插清洗：接不上');
});
t('在后面接 / 在前面补：自动连线并放在右边 / 左边', () => {
  const { d, mo } = chain(); const r = M.addNear(d, mo.id, 'predict'); ok(r.node && r.node.x > mo.x); eq(r.edge.tp, 'model');
  const tr2 = M.addNode(d, 'train', 0, 600); const b = M.addNear(d, tr2.id, 'src', true); ok(b.node.x < tr2.x); eq(b.edge.to, tr2.id);
});
t('顺着连线推「有没有标签」：拆分保持、预测结果带预测、人工标注变成有标签', () => {
  const { d, sp, pr, nd } = chain();
  eq(M.info(d, sp.id, 'train').labeled, true); eq(M.info(d, sp.id, 'train').target, 'y'); eq(M.info(d, pr.id, 'out').pred, true);
  const lb = M.addNode(d, 'label', 0, 0, { target: 'y' }); M.connect(d, nd.id, lb.id); eq(M.info(d, nd.id, 'out').labeled, false); eq(M.info(d, lb.id, 'out').labeled, true);
});
t('业务环节：放进去撑开、一起拖动、排整齐按连线从左到右', () => {
  const { d, s, sp, tr } = chain(); const st = M.addNode(d, 'stage', 0, 0);
  [s, sp, tr].forEach(n => M.placeInside(d, st.id, n)); M.arrange(d, st.id);
  ok(s.x < sp.x && sp.x < tr.x, '从左到右'); [s, sp, tr].forEach(n => ok(n.x >= st.x && n.x + M.rectOf(n).w <= st.x + st.w, '在框里'));
  const x0 = s.x; M.moveBy(d, st.id, 40, 0); eq(s.x, x0 + 40);
});
t('删除节点：连线一起删；JSON 往返完全一致', () => {
  const { d, sp } = chain(); const before = d.edges.length; M.removeNode(d, sp.id); ok(d.edges.length < before);
  const s = M.serialize(d); eq(M.serialize(M.parse(s)), s);
});
t('打开 JSON：坏文件给中文错误，坏字段被修正', () => {
  let msg = ''; try { M.parse('{oops'); } catch (e) { msg = e.message; } ok(/JSON/.test(msg));
  try { M.parse({ format: 'other', nodes: [] }); } catch (e) { msg = e.message; } ok(/不是/.test(msg));
  const d = M.parse({ version: 2, nodes: [{ id: 'n1', type: 'train', algo: 'magic', loc: 'moon', k: 99 }, { id: 'n2', type: 'nope' }], edges: [{ id: 'e1', from: 'n1', fp: 'model', to: 'n9', tp: 'in' }] });
  eq(d.nodes.length, 1); eq([d.nodes[0].algo, d.nodes[0].loc, d.nodes[0].k], ['', 'local', 10]); eq(d.edges.length, 0);
});
t('第一版（方框 + 箭头）的文件能打开：数据 → 数据源，AI 方框 → AI 服务，连线自动挑口', () => {
  const v1 = { format: 'ai-business-blueprint', version: 1, nodes: [{ id: 'n1', type: 'data', name: '会员', level: 'sensitive', loc: 'private' }, { id: 'n2', type: 'ai', name: '写短信', aiType: 'llm', loc: 'public' }, { id: 'n3', type: 'stage', name: '营销' }],
    edges: [{ id: 'e4', from: 'n1', to: 'n2', kind: 'data', label: '手机号' }] };
  const d = M.parse(v1); eq(d.nodes.map(n => n.type), ['src', 'ai', 'stage']); eq(d.edges.length, 1); eq([d.edges[0].fp, d.edges[0].tp, d.edges[0].label], ['out', 'in', '手机号']);
  eq(A.risks(d).red, 1);
});
t('撤销 / 重做', () => { const h = new M.History(); h.push('a'); h.push('b'); eq(h.undo('c'), 'b'); eq(h.redo('b'), 'c'); ok(h.canUndo()); });

console.log('算法');
t('CSV：引号、逗号、空行、数字列自动转数字', () => {
  const ds = ML.parseCSV('名字,数量,备注\n"张,三",3,\n\n李四,4.5,"说""好"""\n');
  eq(ds.cols, ['名字', '数量', '备注']); eq(ds.rows, [['张,三', 3, null], ['李四', 4.5, '说"好"']]);
  eq(ML.parseCSV(ML.toCSV(ds)).rows, ds.rows);
});
const sales = ML.parseCSV(D.get('sales')), parts = ML.parseCSV(D.get('parts')), cust = ML.parseCSV(D.get('cust'));
t('示例数据：每次生成都一样，行数对得上', () => { eq(D.get('sales'), D.get('sales')); eq([sales.rows.length, parts.rows.length, cust.rows.length], [420, 480, 450]); });
t('预测数字：线性回归和随机森林在测试集上 R² > 0.7', () => {
  const sp = ML.split(sales, 0.8, 42);
  ['linreg', 'forest'].forEach(a => { const m = ML.train(sp.train, { algo: a, target: '销量' }); const r = ML.evaluate(m, sp.test); eq(r.task, 'reg'); ok(r.r2 > 0.7, a + ' R² ' + r.r2); });
});
t('分类：随机森林比「全猜最多的那类」准', () => {
  const sp = ML.split(parts, 0.8, 42), m = ML.train(sp.train, { algo: 'forest', target: '结果' }), r = ML.evaluate(m, sp.test);
  eq(r.task, 'clf'); ok(r.accuracy > r.baseline + 0.08, r.accuracy + ' vs ' + r.baseline); eq(r.confusion.length, 2);
});
t('六种监督算法都能训练、预测，模型 JSON 往返后结果不变', () => {
  const sp = ML.split(cust, 0.8, 1);
  ['logreg', 'tree', 'forest', 'knn', 'nb'].forEach(a => {
    const m = ML.train(sp.train, { algo: a, target: '是否流失' }), m2 = JSON.parse(JSON.stringify(m));
    eq(ML.predict(m2, sp.test).rows, ML.predict(m, sp.test).rows, a);
  });
  ok(ML.train(sp.train, { algo: 'linreg', target: '月消费' }).task === 'reg');
});
t('编号、姓名、手机号这类列自动不用', () => { const m = ML.train(cust, { algo: 'tree', target: '是否流失' }); ['客户编号', '姓名', '手机号'].forEach(c => ok(m.dropped.indexOf(c) >= 0, c)); });
t('K-means 分群、异常检测：不要标签也能训练和预测', () => {
  const k = ML.train(cust, { algo: 'kmeans', k: 3, exclude: ['是否流失'] }); eq(k.sizes.length, 3); ok(k.features.indexOf('是否流失') < 0);
  const p = ML.predict(k, ML.parseCSV(D.get('cust_new'))); eq(p.cols[p.cols.length - 1], '分群');
  const an = ML.train(parts, { algo: 'anomaly', exclude: ['结果'] }); ok(an.threshold > 0); eq(ML.predict(an, ML.parseCSV(D.get('parts_new'))).cols.slice(-2), ['异常分数', '是否异常']);
});
t('出错给中文原因：没标签列、浏览器跑不了的算法、数据太少', () => {
  const msgs = []; [() => ML.train(sales, { algo: 'forest' }), () => ML.train(sales, { algo: 'nn', target: '销量' }), () => ML.train({ cols: ['a', 'y'], rows: [[1, 2]] }, { algo: 'linreg', target: 'y' }),
    () => ML.train(parts, { algo: 'linreg', target: '结果' })].forEach(f => { try { f(); msgs.push(''); } catch (e) { msgs.push(e.message); } });
  msgs.forEach(m => ok(/[一-龥]/.test(m), '应该报中文错误：' + m));
});

console.log('运行引擎');
function runnable() {
  const c = chain(); c.s.csv = D.get('sales'); c.s.target = '销量'; c.nd.csv = D.get('sales_new'); return c;
}
t('整条流水线：数据 → 拆分 → 训练 → 模型 → 评估 / 预测，全部算出来', () => {
  const { d, ev, pr, mo } = runnable(); const r = E.run(d);
  ok(r.ok, JSON.stringify(r.counts)); eq(r.nodes[ev.id].status, 'ok'); ok(r.nodes[ev.id].metric.r2 > 0.7); eq(r.nodes[pr.id].ds.rows.length, 24);
  ok(r.trained[mo.id], '模型节点拿到新训练的模型');
});
t('模型锁定后：训练整段跳过，换新数据只重新预测', () => {
  const { d, tr, mo, nd, pr } = runnable(); const r1 = E.run(d);
  mo.trained = r1.trained[mo.id]; mo.locked = true; nd.csv = D.get('sales_new2');
  const r2 = E.run(d); eq(r2.nodes[tr.id].status, 'skip'); ok(!r2.trained[mo.id], '锁定的模型不再更新'); eq(r2.nodes[pr.id].status, 'ok');
  ok(JSON.stringify(r2.nodes[pr.id].ds.rows) !== JSON.stringify(r1.nodes[pr.id].ds.rows), '新数据得到新的预测');
});
t('没导入数据：只画图（idle），不算错；下游也是 idle', () => { const { d, tr } = chain(); const r = E.run(d); ok(r.ok); eq(r.nodes[tr.id].status, 'idle'); });
t('规则节点真的筛：满足 + 不满足 = 全部', () => {
  const { d, pr } = runnable(); const ru = M.addNode(d, 'rule', 0, 0, { col: '预测_销量', op: '>', val: '150' }); M.connect(d, pr.id, ru.id);
  const r = E.run(d).nodes[ru.id]; eq(r.outs.yes.ds.rows.length + r.outs.no.ds.rows.length, 24);
});
t('标签列写错：报错并列出数据里有哪些列', () => { const { d, s } = runnable(); s.target = '销售额'; const r = E.run(d); eq(r.nodes[s.id].status, 'error'); ok(/门店类型/.test(r.nodes[s.id].msg)); });

console.log('检查与红黄规则');
t('完整的流水线没有红黄；预测结果没人用：黄', () => {
  const { d, pr } = runnable(); ok(A.checks(d).some(c => c.node === pr.id && /没人用/.test(c.text)));
  M.connect(d, pr.id, M.addNode(d, 'action').id); eq(A.checks(d).filter(c => c.level !== 'info'), []);
});
t('监督算法接了无标签数据：红，建议加人工标注', () => {
  const d = M.create(); const nd = M.addNode(d, 'src', 0, 0, { labeled: false }), tr = M.addNode(d, 'train', 0, 0, { algo: 'tree' }); M.connect(d, nd.id, tr.id);
  const c = A.checks(d).find(x => x.node === tr.id && x.level === 'red'); ok(c && /人工标注/.test(c.fix));
  tr.algo = 'kmeans'; ok(!A.checks(d).some(x => x.level === 'red'), '换成无监督就没事');
});
t('拿训练集考模型：红', () => {
  const { d, sp, ev } = runnable(); const e = M.edgesInto(d, ev.id, 'test')[0]; M.removeEdge(d, e.id); M.addEdge(d, sp.id, 'train', ev.id, 'test');
  ok(A.checks(d).some(c => c.node === ev.id && c.level === 'red' && /训练集/.test(c.text)));
});
t('必填口没接：黄；整张图没评估：黄', () => {
  const d = M.create(); const tr = M.addNode(d, 'train', 0, 0, { algo: 'forest' }); const cs = A.checks(d);
  ok(cs.some(c => /还没接上/.test(c.text))); ok(cs.some(c => /没有「评估」/.test(c.text)));
});
function riskDoc(level, dataLoc, aiLoc, via) {
  const d = M.create(), x = M.addNode(d, 'src', 0, 0, { name: '会员', level: level, loc: dataLoc }), a = M.addNode(d, 'ai', 300, 0, { loc: aiLoc });
  if (via) { const m = M.addNode(d, via, 150, 0); M.connect(d, x.id, m.id); M.connect(d, m.id, a.id); } else M.connect(d, x.id, a.id);
  return A.risks(d);
}
t('敏感数据 → 公有云 AI：红；经过「脱敏」节点：黄', () => { eq(riskDoc('sensitive', 'local', 'public').red, 1); const r = riskDoc('secret', 'local', 'public', 'mask'); eq([r.red, r.yellow], [0, 1]); });
t('经过清洗、拆分这类节点仍然追得到：红', () => { eq(riskDoc('sensitive', 'local', 'public', 'clean').red, 1); eq(riskDoc('sensitive', 'local', 'public', 'split').red, 1); });
t('本地 / 私有云：没事；内部数据上公有云：没事', () => { eq(riskDoc('sensitive', 'local', 'local').list.length, 0); eq(riskDoc('internal', 'public', 'public').list.length, 0); });
t('敏感数据存在公有云：红；机密放私有云：黄', () => { eq(riskDoc('sensitive', 'public', 'local').red, 1); const r = riskDoc('secret', 'private', 'local'); eq([r.red, r.yellow], [0, 1]); });
t('在公有云上训练也算：敏感数据 → 公有云训练节点，红', () => {
  const d = M.create(), x = M.addNode(d, 'src', 0, 0, { level: 'sensitive' }), tr = M.addNode(d, 'train', 0, 0, { loc: 'public' }); M.connect(d, x.id, tr.id); eq(A.risks(d).red, 1);
});
t('观看模式只看已经出现的节点', () => {
  const d = M.create(), x = M.addNode(d, 'src', 0, 0, { level: 'sensitive' }), a = M.addNode(d, 'ai', 0, 0, { loc: 'public' }); M.connect(d, x.id, a.id);
  eq(A.risks(d, new Set([x.id])).red, 0); eq(A.risks(d, new Set([x.id, a.id])).red, 1);
});

console.log('统计、四格图、Markdown');
t('统计：模型被几个预测节点用、有没有评估、数据有无标签', () => {
  const { d, mo } = runnable(); const p2 = M.addNode(d, 'predict'); M.connect(d, mo.id, p2.id);
  const st = A.stats(d); eq(st.models[0].uses, 2); ok(st.models[0].evaluated); eq([st.labeled, st.unlabeled, st.withCsv], [1, 1, 2]); eq(st.algos.forest, 1);
});
t('四格图：训练节点和 AI 服务都参与', () => {
  const d = M.create(); M.addNode(d, 'train', 0, 0, { value: 'high', effort: 'low' }); M.addNode(d, 'ai', 300, 0, { value: 'low', effort: 'high' }); M.addNode(d, 'ai', 600, 0);
  const q = A.quad(d); eq([q.now.length, q.skip.length, q.unrated.length], [1, 1, 1]);
});
t('Markdown：节点清单按连线顺序，写出输入从哪来、输出到哪去；竖线被转义', () => {
  const { d, s } = runnable(); s.name = 'a|b'; const md = A.markdown(d, null, E.run(d));
  ok(md.indexOf('| 环节 | 节点 | 类型 | 输入（从哪来） | 输出（到哪去） | 关键设置 | 运行在哪 | 运行结果 |') > 0);
  ok(md.indexOf('a\\|b') > 0); ok(/训练集 → 训练模型/.test(md)); ok(/R²/.test(md)); ok(/被 1 个预测节点使用/.test(md));
});

console.log('三个示例');
S.list.forEach(s => {
  t(s.short + '：能搭出来，节点 ≥ 20，标「虚构示例」，恰好一个红点', () => {
    const b = S.build(s), d = b.doc; ok(d.nodes.length >= 20, d.nodes.length + ''); ok(/虚构示例/.test(s.title)); eq(A.risks(d).red, 1);
    ok(!A.checks(d).some(c => c.level === 'red'), '流程检查没有红'); eq(A.quad(d).unrated.length, 0);
  });
  t(s.short + '：运行没有出错，评估和预测都有结果', () => {
    const d = S.build(s).doc, r = E.run(d); ok(r.ok, JSON.stringify(r.counts));
    const ev = d.nodes.filter(n => n.type === 'evaluate'), pr = d.nodes.filter(n => n.type === 'predict' && r.nodes[n.id].status === 'ok');
    ok(ev.every(n => r.nodes[n.id].status === 'ok')); ok(pr.length >= 1);
  });
  t(s.short + '：按解说的改法改完，红点消失；每一步都指得到节点', () => {
    const b = S.build(s), d = M.clone(b.doc), ids = Object.assign({}, b.ids), id = k => ids[k]; id.set = (k, v) => { ids[k] = v; };
    const ctx = { train: doc => { const r = E.run(doc); Object.keys(r.trained).forEach(k => { M.get(doc, k).trained = r.trained[k]; }); } };
    s.steps.forEach((st, i) => { (st.show || []).forEach(k => ok(ids[k], '第 ' + (i + 1) + ' 步：' + k)); if (st.fix) st.fix(d, id, ctx); if (st.sel) ok(ids[st.sel], '第 ' + (i + 1) + ' 步 sel：' + st.sel); });
    eq(A.risks(d).red, 0); ok(s.steps.some(x => x.tab === 'quad')); ok(s.steps.some(x => x.run));
  });
});
t('三个示例合起来：监督和无监督都有，图片和录音都有，有反馈线，有锁定模型的演示', () => {
  const docs = S.list.map(s => S.build(s).doc), all = [].concat(...docs.map(d => d.nodes));
  ok(all.some(n => n.algo === 'kmeans')); ok(all.some(n => n.form === 'image')); ok(all.some(n => n.form === 'audio')); ok(all.some(n => n.type === 'label'));
  ok(docs.some(d => d.edges.some(e => e.fb))); ok(S.list.some(s => s.steps.some(x => x.fix && /locked/.test(String(x.fix)))));
});

if (R) {
  console.log('绘制');
  t('SVG：每个节点、每个口、每条线都画出来，文字转义', () => {
    const { d, s } = runnable(); s.name = '<b>&'; const svg = R.world(d, {});
    d.nodes.forEach(n => ok(svg.indexOf('data-id="' + n.id + '"') >= 0)); d.edges.forEach(e => ok(svg.indexOf('data-edge="' + e.id + '"') >= 0));
    ok(svg.indexOf('&lt;b&gt;&amp;') >= 0); ok((svg.match(/data-port="/g) || []).length >= 14);
  });
  t('运行结果画在节点下面；导出的完整 SVG 有标题', () => {
    const { d, ev } = runnable(); const r = E.run(d); const svg = R.world(d, { run: r.nodes }); ok(svg.indexOf('R²') > 0);
    ok(/^<svg[^>]+width="\d+/.test(R.standalone(d, {})));
  });
  t('折行：超过行数加省略号', () => { const l = R.wrap('这是一段非常非常非常非常长的节点名称需要折行', 80, 13, null, 2); eq(l.length, 2); ok(/…$/.test(l[1])); });
}

console.log('\n' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
