/* Node 单元测试：数据模型、红黄规则、统计、四格图、Markdown 清单、三个示例、SVG 绘制。
 * 运行：node tests/js/unit_tests.js（全部通过时退出码 0） */
'use strict';
const path = require('path');
const js = p => path.join(__dirname, '..', '..', 'play', 'js', p);
const C = require(js('config.js')), M = require(js('model.js')), A = require(js('analysis.js'));
const S = require(js('samples.js')), R = require(js('render.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); }
function ok(c, msg) { if (!c) throw new Error(msg || '条件不成立'); }

console.log('配置');
t('12 种 AI 类型 + 其他，都有擅长说明', () => { eq(C.AI_ORDER.length, 13); C.AI_ORDER.forEach(k => ok(C.AI[k].good, k)); });
t('敏感等级四级、位置三档', () => { eq(C.LEVEL_ORDER, ['open', 'internal', 'sensitive', 'secret']); eq(C.LOC_ORDER, ['local', 'private', 'public']); });
t('四格图：中算进高的一边', () => {
  eq(C.quadOf('high', 'low'), 'now'); eq(C.quadOf('mid', 'low'), 'now'); eq(C.quadOf('high', 'mid'), 'plan'); eq(C.quadOf('high', 'high'), 'plan');
  eq(C.quadOf('low', 'low'), 'easy'); eq(C.quadOf('low', 'mid'), 'skip'); eq(C.quadOf('', 'low'), ''); eq(C.quadOf('high', ''), '');
});

console.log('数据模型');
function small() {
  const d = M.create('t'); const s = M.addNode(d, 'stage', 0, 0, { name: '采购' });
  const a = M.addNode(d, 'ai', 0, 0, { name: '预测' }); M.placeInside(d, s.id, a);
  const h = M.addNode(d, 'human', 0, 0, { name: '确认' }); M.placeInside(d, s.id, h);
  const x = M.addNode(d, 'data', 400, 0, { name: '会员', level: 'sensitive' });
  return { d, s, a, h, x };
}
t('放进环节：父级正确，环节撑到包住子方框', () => {
  const { d, s, a, h } = small();
  eq([a.parent, h.parent], [s.id, s.id]);
  [a, h].forEach(n => ok(n.x >= s.x && n.y >= s.y + C.HEAD && n.x + n.w <= s.x + s.w && n.y + n.h <= s.y + s.h, '子方框超出环节'));
  ok(h.y >= a.y + a.h, '第二个排在第一个下面');
});
t('拖动环节时里面的方框一起动', () => { const { d, s, a } = small(); const ax = a.x; M.moveBy(d, s.id, 50, 20); eq(a.x, ax + 50); });
t('环节可以嵌套，但不能放进自己的后代', () => {
  const { d, s } = small(); const big = M.addNode(d, 'stage', -300, 0);
  ok(M.setParent(d, s.id, big.id)); M.fitStages(d);
  ok(!M.setParent(d, big.id, s.id), '成环了'); ok(!M.setParent(d, big.id, big.id));
  eq(M.depth(d, s.id), 1); ok(M.isDescendant(d, s.id, big.id));
});
t('只有环节能当父级', () => { const { d, a, x } = small(); ok(!M.setParent(d, x.id, a.id)); });
t('折叠后子方框隐藏，连线指向环节', () => {
  const { d, s, a } = small(); s.collapsed = true;
  ok(M.isHidden(d, a.id)); eq(M.visibleId(d, a.id), s.id); eq(M.rectOf(s).h, M.COLLAPSED_H);
});
t('移出环节放到环节右边', () => { const { d, s, a } = small(); M.detach(d, a.id); eq(a.parent, null); ok(a.x >= s.x + s.w); });
t('删除环节：里面的方框保留，连线删掉', () => {
  const { d, s, a, x } = small(); M.addEdge(d, x.id, a.id); M.addEdge(d, x.id, s.id);
  M.removeNode(d, s.id); eq(a.parent, null); eq(d.edges.length, 1); ok(!M.get(d, s.id));
});
t('连线：不能连自己、不能重复；连数据默认是数据流', () => {
  const { d, a, h, x } = small();
  eq(M.addEdge(d, a.id, a.id), null);
  const e = M.addEdge(d, x.id, a.id); eq(e.kind, 'data');
  eq(M.addEdge(d, x.id, a.id), null);
  eq(M.addEdge(d, a.id, h.id).kind, 'flow');
  ok(M.reverseEdge(d, e.id)); eq([e.from, e.to], [a.id, x.id]);
});
t('排整齐：两列，不重叠', () => {
  const d = M.create(); const s = M.addNode(d, 'stage', 0, 0);
  for (let i = 0; i < 5; i++) { const n = M.addNode(d, 'human', i * 7, i * 300); n.parent = s.id; }
  M.arrange(d, s.id);
  const kids = M.children(d, s.id);
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    const p = kids[i], q = kids[j]; ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, '重叠');
  }
  eq(new Set(kids.map(k => k.x)).size, 2);
});
t('JSON 往返完全一致', () => { const { d, x, a } = small(); M.addEdge(d, x.id, a.id, { label: '手机号', masked: true }); const s = M.serialize(d); eq(M.serialize(M.parse(s)), s); });
t('打开 JSON：坏文件给中文错误，坏字段被修正', () => {
  let msg = ''; try { M.parse('{oops'); } catch (e) { msg = e.message; } eq(msg, '不是有效的 JSON 文件');
  try { M.parse({ format: 'other', nodes: [] }); } catch (e) { msg = e.message; } ok(/不是 AI 业务拆解画板/.test(msg));
  const d = M.parse({ nodes: [{ id: 'n1', type: 'ai', aiType: 'magic', loc: 'moon', value: 'huge', x: 'a' }, { id: 'n2', type: 'alien' }, { id: 'n3', type: 'data', parent: 'n1' }],
    edges: [{ id: 'e9', from: 'n1', to: 'n404' }, { id: 'e10', from: 'n3', to: 'n1', kind: 'data' }] });
  eq(d.nodes.length, 2); eq(d.nodes[0].aiType, ''); eq(d.nodes[0].loc, 'public'); eq(d.nodes[0].value, ''); eq(d.nodes[0].x, 0);
  eq(d.nodes[1].parent, null); eq(d.edges.length, 1); ok(d.seq >= 10, '新 id 不能和旧的撞');
});
t('撤销 / 重做', () => {
  const h = new M.History(3); h.push('a'); h.push('b'); eq(h.undo('c'), 'b'); eq(h.redo('b'), 'c'); h.push('x'); h.push('y'); h.push('z'); eq(h.past.length, 3);
});

console.log('红黄规则');
function riskDoc(level, dloc, ailoc, masked) {
  const d = M.create(); const x = M.addNode(d, 'data', 0, 0, { level, loc: dloc }); const a = M.addNode(d, 'ai', 300, 0, { loc: ailoc });
  M.addEdge(d, x.id, a.id, { masked: !!masked }); return A.risks(d);
}
t('敏感数据 → 公有云 AI：红', () => { const r = riskDoc('sensitive', 'local', 'public'); eq([r.red, r.yellow], [1, 0]); });
t('机密数据 → 公有云 AI，已脱敏：黄', () => { const r = riskDoc('secret', 'local', 'public', true); eq([r.red, r.yellow], [0, 1]); });
t('敏感数据 → 本地 / 私有云 AI：没事', () => { eq(riskDoc('sensitive', 'local', 'local').list.length, 0); eq(riskDoc('sensitive', 'local', 'private').list.length, 0); });
t('内部 / 公开数据上公有云：没事', () => { eq(riskDoc('internal', 'public', 'public').list.length, 0); eq(riskDoc('open', 'public', 'public').list.length, 0); });
t('敏感数据存在公有云：红', () => { const r = riskDoc('sensitive', 'public', 'local'); eq(r.red, 1); });
t('机密数据放私有云：黄', () => { const r = riskDoc('secret', 'private', 'local'); eq([r.red, r.yellow], [0, 1]); });
t('流向公有云外部系统也算；反方向（AI → 数据）不算', () => {
  const d = M.create(); const x = M.addNode(d, 'data', 0, 0, { level: 'sensitive' }), e = M.addNode(d, 'ext', 300, 0, { loc: 'public' }), a = M.addNode(d, 'ai', 0, 300, { loc: 'public' });
  M.addEdge(d, x.id, e.id); M.addEdge(d, a.id, x.id); const r = A.risks(d); eq(r.red, 1); ok(r.list[0].text.indexOf('外部系统') > 0);
});
t('红点同时标在数据和连线上', () => {
  const d = M.create(); const x = M.addNode(d, 'data', 0, 0, { level: 'sensitive' }), a = M.addNode(d, 'ai', 300, 0); const e = M.addEdge(d, x.id, a.id);
  const r = A.risks(d); eq(r.map.nodes[x.id], 'red'); eq(r.map.edges[e.id], 'red');
});
t('观看模式只看已经出现的方框', () => {
  const d = M.create(); const x = M.addNode(d, 'data', 0, 0, { level: 'sensitive' }), a = M.addNode(d, 'ai', 300, 0); M.addEdge(d, x.id, a.id);
  eq(A.risks(d, new Set([x.id])).red, 0); eq(A.risks(d, new Set([x.id, a.id])).red, 1);
});

console.log('统计、四格图、Markdown');
t('统计：环节用了 AI、各类 AI 次数、数据分布', () => {
  const { d, s, a } = small(); a.aiType = 'predict'; const s2 = M.addNode(d, 'stage', 600, 0);
  const st = A.stats(d); eq(st.stages.length, 2); eq(st.stagesWithAI, 1); eq(st.aiByType, { predict: 1 }); eq(st.data.local.sensitive, 1);
  eq(st.stages[0].id, s.id);
});
t('四格图分组和编号', () => {
  const d = M.create();
  [['high', 'low'], ['low', 'high'], ['mid', 'mid'], ['low', 'low'], ['', '']].forEach((v, i) => M.addNode(d, 'ai', i * 200, 0, { name: 'a' + i, value: v[0], effort: v[1] }));
  const q = A.quad(d); eq([q.now.length, q.plan.length, q.easy.length, q.skip.length, q.unrated.length], [1, 1, 1, 1, 1]);
  eq(q.now[0].num, 1);
});
t('Markdown 主表 8 列，含业务价值和落地难度；竖线被转义', () => {
  const { d, a, x } = small(); a.aiType = 'llm'; a.input = '评价|留言'; a.value = 'high'; a.effort = 'low'; M.addEdge(d, x.id, a.id);
  const md = A.markdown(d);
  ok(md.indexOf('| 环节 | 步骤 | 谁来做 | 输入 | 输出 | 用到的数据（位置·等级） | 业务价值 | 落地难度 |') >= 0);
  ok(md.indexOf('评价\\|留言') > 0); ok(md.indexOf('| 高 | 低 |') > 0); ok(md.indexOf('会员（本地·敏感）') > 0);
  ok(md.indexOf('## 风险提醒') > 0 && md.indexOf('🔴') > 0);
});

console.log('三个示例');
const allTypes = new Set();
S.list.forEach(s => {
  t(s.short + '：搭得出来，方框 15–30 个，标「虚构示例」', () => {
    const b = S.build(s); ok(b.doc.nodes.length >= 15 && b.doc.nodes.length <= 30, b.doc.nodes.length); ok(/虚构示例/.test(s.title));
    b.doc.nodes.forEach(n => { if (n.aiType) allTypes.add(n.aiType); });
  });
  t(s.short + '：每个 AI 都有类型、输入、输出、价值、难度', () => {
    S.build(s).doc.nodes.filter(n => n.type === 'ai').forEach(n => ok(n.aiType && n.input && n.output && n.value && n.effort, n.name));
  });
  t(s.short + '：方框互不重叠（同一层）', () => {
    const d = S.build(s).doc;
    const leaves = d.nodes.filter(n => n.type !== 'stage');
    for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
      const p = leaves[i], q = leaves[j]; ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, p.name + ' 和 ' + q.name + ' 重叠');
    }
  });
  t(s.short + '：一个红点，按演示的改法改完就没有红点', () => {
    const b = S.build(s); eq(A.risks(b.doc).red, 1);
    const d = M.clone(b.doc); s.steps.forEach(x => { if (x.fix) x.fix(d, k => b.ids[k]); }); eq(A.risks(d).red, 0);
  });
  t(s.short + '：观看步骤里每个方框都出现过，并有一步讲四格图', () => {
    const b = S.build(s), shown = new Set(); s.steps.forEach(x => (x.show || []).forEach(k => { ok(b.ids[k], '未知的键 ' + k); shown.add(b.ids[k]); }));
    eq(shown.size, b.doc.nodes.length); ok(s.steps.some(x => x.tab === 'quad'));
    s.steps.forEach(x => { if (x.sel) ok(b.ids[x.sel], '未知的选中 ' + x.sel); });
  });
});
t('三个示例合起来用到全部 12 种 AI 类型', () => { eq(C.AI_ORDER.filter(k => k !== 'other' && !allTypes.has(k)), []); });

console.log('绘制');
t('SVG：每个方框和连线都画出来，文字转义', () => {
  const b = S.build(S.list[0]); b.doc.nodes[1].name = '<b>&"'; const svg = R.standalone(b.doc);
  eq((svg.match(/data-id="/g) || []).length, b.doc.nodes.length); eq((svg.match(/data-edge="/g) || []).length, b.doc.edges.length);
  ok(svg.indexOf('&lt;b&gt;&amp;&quot;') > 0); ok(svg.indexOf('<b>&"') < 0);
});
t('折行：超过行数加省略号', () => { const l = R.wrap('这是一段非常非常非常非常长的方框名称需要折行', 80, 13, null, 2); eq(l.length, 2); ok(/…$/.test(l[1])); });

console.log('\n' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
