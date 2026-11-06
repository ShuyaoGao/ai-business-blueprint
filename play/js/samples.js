/* 三个内置示例（全部虚构）与「观看」模式的逐步解说。纯数据 + 一个搭图函数，Node 测试也会读。
 *
 * 示例 = { id, title, short, rows: [[环节 k...]...],
 *          stages: [{ k, name, desc, items: [{ k, type, ...属性 }] }],
 *          edges: [[from, to, { fp, tp, label, masked }]],
 *          steps: [{ say, show: [k...], sel: k 或 'e:a>b', tab, run: 运行一次, fix: function (doc, id, ctx) }] }
 * 布局：环节按 rows 排（同一行从左到右），环节里的节点按连线先后从左到右排。
 */
(function (root) {
  'use strict';
  var M = (root.ABB && root.ABB.Model) || require('./model.js');
  var D = (root.ABB && root.ABB.Datasets) || require('./datasets.js');

  function N(k, type, name, props) { var o = props || {}; o.k = k; o.type = type; o.name = name; return o; }

  var SAMPLES = [
    // ======================================================================
    {
      id: 'restaurant', short: '连锁餐饮', title: '连锁餐饮：50 家门店的快餐连锁（虚构示例）',
      rows: [['S1'], ['S2'], ['S3', 'S4']],
      stages: [
        { k: 'S1', name: '① 用历史数据训练「销量预测模型」', items: [
          N('d1', 'src', '销售流水（近一年）', { labeled: true, target: '销量', level: 'internal', loc: 'private', sys: '云收银系统导出', cols: '门店、门店类型、星期、节假日、气温、下雨、昨日销量、销量', csv: '@sales', csvName: '销售流水.csv', desc: '每行 = 一家店一天；「销量」这一列就是答案（标签）。' }),
          N('p1', 'feature', '选字段', { keep: '门店类型 星期 节假日 气温 下雨 昨日销量', desc: '去掉「门店」编号：它只是个代号，留着模型会死记硬背。' }),
          N('p2', 'split', '拆分训练 / 测试', { ratio: 0.8 }),
          N('t1', 'train', '训练：随机森林', { algo: 'forest', loc: 'private', value: 'high', effort: 'mid', desc: '订多了浪费，订少了断货；这是餐饮最值钱的一个预测。' }),
          N('m1', 'model', '销量预测模型', { version: 'v1', loc: 'private' }),
          N('e1', 'evaluate', '评估：考一考', {})] },
        { k: 'S2', name: '② 每天晚上：新数据 + 同一个模型 → 预测 → 订货', items: [
          N('d2', 'newdata', '明天各门店的情况', { level: 'internal', loc: 'private', sys: '门店系统 + 天气预报', csv: '@sales_new', csvName: '明天.csv', desc: '没有「销量」：正等着模型预测。' }),
          N('f1', 'predict', '预测明天销量', { loc: 'private' }),
          N('a1', 'ai', '自动生成订货单', { aiType: 'optimize', input: '每店预测销量 + 库存', output: '订货单草稿', loc: 'private', value: 'high', effort: 'mid' }),
          N('h1', 'human', '店长确认订货', { role: '店长', desc: 'AI 出草稿，人拍板：店长知道明天门口修路。' }),
          N('x1', 'ext', '供应商订货平台', { loc: 'public' }),
          N('r1', 'rule', '高峰门店', { col: '预测_销量', op: '>', val: '200' }),
          N('g1', 'action', '高峰门店加派人手', { role: '区域经理' }),
          N('c1', 'collect', '回收实际销量', { wait: '第二天打烊', role: '收银系统自动' })] },
        { k: 'S3', name: '③ 会员营销', items: [
          N('d3', 'src', '会员信息', { labeled: false, level: 'sensitive', loc: 'private', cols: '姓名、手机号、生日、消费记录', sys: '会员小程序' }),
          N('a2', 'ai', '大模型写促销短信', { aiType: 'llm', input: '会员消费记录', output: '个性化短信', loc: 'public', value: 'mid', effort: 'low' }),
          N('h2', 'human', '运营审核', { role: '运营经理', desc: 'AI 写的东西，发出去之前人要看一眼。' }),
          N('g2', 'action', '群发短信', {})] },
        { k: 'S4', name: '④ 评价分析', items: [
          N('d4', 'src', '外卖平台评价', { form: 'text', labeled: false, level: 'internal', loc: 'public', sys: '外卖平台' }),
          N('a3', 'ai', '差评归类', { aiType: 'llm', input: '评价文字', output: '问题清单（口味 / 等太久 / 漏送）', loc: 'public', value: 'high', effort: 'low' }),
          N('a4', 'ai', '新品海报', { aiType: 'imagegen', input: '新品照片 + 一句文案', output: '海报', loc: 'public', value: 'low', effort: 'low' }),
          N('s1', 'store', '每周问题清单', { level: 'internal' })] }
      ],
      edges: [
        ['d1', 'p1'], ['p1', 'p2'], ['p2', 't1', { fp: 'train' }], ['t1', 'm1'], ['m1', 'e1'], ['p2', 'e1', { fp: 'test', tp: 'test' }],
        ['m1', 'f1'], ['d2', 'f1', { tp: 'in' }], ['f1', 'a1'], ['a1', 'h1'], ['h1', 'x1', { label: '订单' }], ['f1', 'r1'], ['r1', 'g1', { fp: 'yes' }],
        ['f1', 'c1'], ['c1', 'd1', { label: '下一轮训练' }],
        ['d3', 'a2', { label: '手机号、消费记录' }], ['a2', 'h2'], ['h2', 'g2'],
        ['d4', 'a3'], ['a3', 's1']
      ],
      steps: [
        { say: '一家 50 家门店的快餐连锁（虚构）。先把业务拆成 4 个环节。每个环节里是一串节点：左边是输入口，右边是输出口，口对口连起来。', show: ['S1', 'S2', 'S3', 'S4'] },
        { say: '先看最值钱的：明天每家店卖几份。起点是「销售流水」，每行一家店一天，最后一列「销量」就是答案。有答案的数据叫「有标签」，监督学习只能用这种数据。', show: ['d1'], sel: 'd1', tab: 'props' },
        { say: '「选字段」：去掉「门店」编号，只留门店类型、星期、节假日、天气、昨日销量。编号只是个代号，留着模型会死记硬背。', show: ['p1'], sel: 'p1' },
        { say: '「拆分」：随机拿 80% 当训练集，留 20% 当测试集。测试集模型没见过，用它考出来的分才算数。', show: ['p2'], sel: 'p2' },
        { say: '「训练」：选一种算法喂进训练集。这里选随机森林：很多棵决策树一起投票，预测数字、分类都能做，是表格数据的好起点。', show: ['t1'], sel: 't1' },
        { say: '训练出来的东西是「模型」，它是一份可以存下来的文件。注意：模型训练一次，后面可以反复用。', show: ['m1'], sel: 'm1' },
        { say: '「评估」：一边接模型，一边接测试集。点了运行，浏览器真的把这 420 行数据算了一遍：看右边，平均每家店差几份、R² 多少（越接近 1 越准），还有模型最看重哪几个字段。', show: ['e1'], sel: 'e1', tab: 'run', run: true },
        { say: '每天晚上来一份新数据：「明天各门店的情况」，没有销量。新数据 + 同一个模型接进「预测」，每家店得到一个预测数字。右边就是预测结果。', show: ['S2', 'd2', 'f1'], sel: 'f1', tab: 'run', run: true },
        { say: '预测完要有人和系统接着干活：优化算法按预测生成订货单，店长确认，再发给供应商平台；规则节点筛出预测超过 200 份的高峰门店，加派人手。', show: ['a1', 'h1', 'x1', 'r1', 'g1'], sel: 'r1', tab: 'run', run: true },
        { say: '第二天打烊后，实际卖了多少就知道了。「回收实际销量」把它补回销售流水（虚线是反馈线），下一轮训练用，模型越用越准。这就是数据飞轮。', show: ['c1'], sel: 'c1', tab: 'props' },
        { say: '模型满意了就「锁定」。锁定后它固定下来，以后运行只做预测，不再重新训练。', show: [], sel: 'm1', tab: 'props', fix: function (doc, id, ctx) { var m = M.get(doc, id('m1')); if (!m.trained && ctx && ctx.train) ctx.train(doc); m.locked = !!m.trained; } },
        { say: '换一份新数据（后天）再运行：「训练」显示「跳过」，模型直接拿来用，几毫秒就出了新的预测。这就是「训练一次，反复预测」。', show: [], sel: 'f1', tab: 'run', run: true, fix: function (doc, id) { var d = M.get(doc, id('d2')); d.name = '后天各门店的情况'; d.csv = D.get('sales_new2'); d.csvName = '后天.csv'; } },
        { say: '再看会员营销：会员信息（敏感：手机号、消费记录）直接送进了运行在公有云的大模型写短信。线标红了，看「检查」。', show: ['S3', 'd3', 'a2', 'h2', 'g2'], sel: 'e:d3>a2', tab: 'check' },
        { say: '改法之一：在这条线中间插一个「脱敏」节点，只把消费记录交给大模型，姓名、手机号留在公司里。红变黄：黄是提醒你确认脱敏到位。', show: [], sel: 'mask', tab: 'check',
          fix: function (doc, id) { var r = M.insertOnEdge(doc, id('e:d3>a2'), 'mask'); if (r.node) { r.node.name = '脱敏：去掉姓名、手机号'; r.node.drop = '姓名 手机号'; id.set('mask', r.node.id); } M.get(doc, id('a2')).input = '消费记录（不含姓名、手机号）'; } },
        { say: '评价分析：评价本来就在外卖平台上，是公开的，交给公有云大模型没问题。新品海报用图像生成。打开「四格图」：每个训练节点和 AI 服务按「业务价值 × 落地难度」排出先做什么。', show: ['S4', 'd4', 'a3', 'a4', 's1'], tab: 'quad' },
        { say: '最后打开「清单」：按连线顺序列出每个节点的输入、输出、设置和运行结果，课后直接拿去写方案。想自己改，点「文件 ▾ → 把这个示例复制到『我来画』」。', show: [], tab: 'list' }
      ]
    },
    // ======================================================================
    {
      id: 'factory', short: '工厂质检', title: '工厂质检：汽车零部件厂，从来料到出货（虚构示例）',
      rows: [['F1'], ['F2'], ['F3', 'F4']],
      stages: [
        { k: 'F1', name: '① 用历史质检记录训练「缺陷预测模型」', items: [
          N('d1', 'src', '历史质检记录', { labeled: true, target: '结果', level: 'secret', loc: 'local', sys: 'MES 生产系统', cols: '零件编号、供应商、班次、炉温、保温分钟、长度偏差、表面粗糙度、结果', csv: '@parts', csvName: '质检记录.csv', desc: '炉温、保温时间是核心工艺参数：机密。' }),
          N('p1', 'clean', '清洗', { desc: '去掉传感器掉线造成的空值和重复记录。' }),
          N('p2', 'split', '拆分训练 / 测试', { ratio: 0.8 }),
          N('t1', 'train', '训练：决策树', { algo: 'tree', loc: 'local', value: 'high', effort: 'mid', desc: '决策树像一串「如果……就……」，质检主管看得懂。' }),
          N('m1', 'model', '缺陷预测模型', { version: 'v1', loc: 'local' }),
          N('e1', 'evaluate', '评估：准确率', {})] },
        { k: 'F2', name: '② 每批零件下线：预测 → 分流', items: [
          N('d2', 'newdata', '今天这批零件', { level: 'secret', loc: 'local', sys: 'MES 生产系统', csv: '@parts_new', csvName: '今天.csv' }),
          N('f1', 'predict', '预测哪些会有缺陷', { loc: 'local' }),
          N('r1', 'rule', '预测为缺陷？', { col: '预测_结果', op: '=', val: '缺陷' }),
          N('h1', 'human', '质检员重点复检', { role: '质检员' }),
          N('g1', 'action', '隔离返工', {}),
          N('g2', 'action', '抽检后出货', {})] },
        { k: 'F3', name: '③ 外观缺陷：照片 → 人工标注 → 训练', items: [
          N('d3', 'src', '产线照片', { form: 'image', labeled: false, level: 'internal', loc: 'local', sys: '工位相机' }),
          N('l1', 'label', '人工标注缺陷', { role: '质检员', target: '是否缺陷', desc: '照片本身没有答案，要人一张张标：有没有划痕、气泡。' }),
          N('t2', 'train', '训练：神经网络', { algo: 'nn', loc: 'local', value: 'high', effort: 'high' }),
          N('m2', 'model', '外观缺陷模型', { version: 'v1', loc: 'local' }),
          N('d4', 'newdata', '实时照片', { form: 'image', level: 'internal', loc: 'local', sys: '工位相机' }),
          N('f2', 'predict', '实时判外观', { loc: 'local' }),
          N('h2', 'human', '可疑件人工复看', { role: '质检员' })] },
        { k: 'F4', name: '④ 质检日报', items: [
          N('a1', 'ai', '大模型写质检日报', { aiType: 'llm', input: '当天预测和复检结果', output: '日报', loc: 'public', value: 'mid', effort: 'low' }),
          N('s1', 'store', '日报存档', { level: 'internal' })] }
      ],
      edges: [
        ['d1', 'p1'], ['p1', 'p2'], ['p2', 't1', { fp: 'train' }], ['t1', 'm1'], ['m1', 'e1'], ['p2', 'e1', { fp: 'test', tp: 'test' }],
        ['m1', 'f1'], ['d2', 'f1', { tp: 'in' }], ['f1', 'r1'], ['r1', 'h1', { fp: 'yes' }], ['h1', 'g1'], ['r1', 'g2', { fp: 'no' }],
        ['d3', 'l1'], ['l1', 't2'], ['t2', 'm2'], ['m2', 'f2'], ['d4', 'f2', { tp: 'in' }], ['f2', 'h2'],
        ['f1', 'a1', { label: '预测结果（含工艺参数）' }], ['a1', 's1']
      ],
      steps: [
        { say: '一家汽车零部件厂（虚构）。拆成 4 个环节：训练缺陷预测模型、每批零件下线时预测、外观照片检测、写质检日报。', show: ['F1', 'F2', 'F3', 'F4'] },
        { say: '起点是「历史质检记录」：每行一个零件，最后一列「结果」（合格 / 缺陷）是人检出来的答案，所以是有标签数据。炉温、保温时间是核心工艺：机密，只放本地。', show: ['d1'], sel: 'd1' },
        { say: '「清洗」去掉传感器掉线造成的空值和重复记录；「拆分」留 20% 当考题。', show: ['p1', 'p2'], sel: 'p2' },
        { say: '「训练」选决策树：它学出来的是一串「如果炉温偏离超过 X，且粗糙度大于 Y，就容易出缺陷」，质检主管看得懂。零件编号几乎每行都不一样，训练时会自动不用。', show: ['t1', 'm1'], sel: 't1' },
        { say: '运行并评估：看准确率，再和「全猜合格」比一比。模型只有比瞎猜好得多，才值得上线。右边还列出模型最看重哪几个字段。', show: ['e1'], sel: 'e1', tab: 'run', run: true },
        { say: '每批零件下线：「今天这批零件」+ 同一个模型 → 预测。规则节点按预测分流：预测为缺陷的送质检员重点复检，其余抽检后出货。', show: ['d2', 'f1', 'r1', 'h1', 'g1', 'g2'], sel: 'r1', tab: 'run', run: true },
        { say: '外观缺陷靠照片。照片本身没有答案，所以中间多了「人工标注」：质检员一张张标出有没有划痕、气泡，无标签数据就变成了有标签数据，才能训练。', show: ['d3', 'l1'], sel: 'l1', tab: 'props' },
        { say: '照片要用神经网络训练，浏览器里跑不了，这里只画图。同样是训练一次、得到模型，再对实时照片反复预测。', show: ['t2', 'm2', 'd4', 'f2', 'h2'], sel: 't2' },
        { say: '质检日报交给公有云大模型来写。但送进去的预测结果里带着今天这批零件的工艺参数（机密），检查顺着连线一路追过去，标红了。', show: ['a1', 's1'], sel: 'a1', tab: 'check' },
        { say: '改法：大模型改成本地部署（工厂自己的服务器），红点消失。另一种改法是只把「合格 / 缺陷」数量发出去，不传工艺参数。', show: [], sel: 'a1', tab: 'check', fix: function (doc, id) { M.get(doc, id('a1')).loc = 'local'; } },
        { say: '四格图：缺陷预测价值高、难度中，规划着做；日报价值中、难度低，先做。外观神经网络价值高、难度高，要专门团队。', show: [], tab: 'quad' },
        { say: '清单里是每个节点的输入、输出和设置。想动手改：文件 ▾ → 把这个示例复制到「我来画」。', show: [], tab: 'list' }
      ]
    },
    // ======================================================================
    {
      id: 'callcenter', short: '客服中心', title: '客服中心：家电品牌的电话 + 在线客服（虚构示例）',
      rows: [['K1', 'K2'], ['K3'], ['K4']],
      stages: [
        { k: 'K1', name: '① 客户数据先脱敏', items: [
          N('d1', 'src', '客户档案 + 是否流失', { labeled: true, target: '是否流失', level: 'sensitive', loc: 'private', sys: 'CRM', cols: '客户编号、姓名、手机号、套餐、会员月数、月消费、近30天来电、上次满意度、有未解决工单、是否流失', csv: '@cust', csvName: '客户档案.csv' }),
          N('k1', 'mask', '脱敏', { drop: '姓名 手机号', desc: '训练用不着姓名和手机号，先去掉。' })] },
        { k: 'K2', name: '② 有标签：流失预测（监督学习）', items: [
          N('p2', 'split', '拆分训练 / 测试', { ratio: 0.8 }),
          N('t1', 'train', '训练：逻辑回归', { algo: 'logreg', loc: 'private', value: 'high', effort: 'low', desc: '分「会走 / 不会走」两类，给出把握，好解释。' }),
          N('m1', 'model', '流失预测模型', { version: 'v1', loc: 'private' }),
          N('e1', 'evaluate', '评估：准确率', {})] },
        { k: 'K3', name: '③ 每月：本月客户 → 预测流失 + 分群', items: [
          N('d2', 'newdata', '本月客户', { level: 'sensitive', loc: 'private', sys: 'CRM', csv: '@cust_new', csvName: '本月客户.csv' }),
          N('f1', 'predict', '预测谁会走', { loc: 'private' }),
          N('r1', 'rule', '可能流失', { col: '预测_是否流失', op: '=', val: '是' }),
          N('g1', 'action', '客户经理打电话回访', { role: '客户经理' }),
          N('t2', 'train', '训练：K-means 分群', { algo: 'kmeans', k: 3, loc: 'private', value: 'mid', effort: 'low', desc: '不看答案，按行为把客户分成 3 群。' }),
          N('m2', 'model', '客户分群模型', { version: 'v1', loc: 'private' }),
          N('f2', 'predict', '给本月客户分群', { loc: 'private' }),
          N('h1', 'human', '运营按群定策略', { role: '运营' })] },
        { k: 'K4', name: '④ 通话录音', items: [
          N('d3', 'src', '通话录音', { form: 'audio', labeled: false, level: 'sensitive', loc: 'local', sys: '呼叫中心' }),
          N('a1', 'ai', '语音转文字', { aiType: 'speech', input: '通话录音', output: '通话文字', loc: 'public', value: 'high', effort: 'mid' }),
          N('a2', 'ai', '大模型写通话小结', { aiType: 'llm', input: '通话文字', output: '小结 + 情绪', loc: 'private', value: 'high', effort: 'low' }),
          N('x1', 'ext', '工单系统', { loc: 'private' })] }
      ],
      edges: [
        ['d1', 'k1'], ['k1', 'p2'], ['p2', 't1', { fp: 'train' }], ['t1', 'm1'], ['m1', 'e1'], ['p2', 'e1', { fp: 'test', tp: 'test' }],
        ['m1', 'f1'], ['d2', 'f1', { tp: 'in' }], ['f1', 'r1'], ['r1', 'g1', { fp: 'yes' }],
        ['k1', 't2'], ['t2', 'm2'], ['m2', 'f2'], ['d2', 'f2', { tp: 'in' }], ['f2', 'h1'],
        ['d3', 'a1'], ['a1', 'a2'], ['a2', 'x1']
      ],
      steps: [
        { say: '一个家电品牌的客服中心（虚构）。这次做两件机器学习的事：预测哪些客户下个月会走（要答案），把客户分群（不要答案）。外加通话录音转文字。', show: ['K1', 'K2', 'K3', 'K4'] },
        { say: '「客户档案」里有姓名、手机号（敏感），最后一列「是否流失」是答案。训练用不着姓名和手机号，第一步就「脱敏」把它们去掉。', show: ['d1', 'k1'], sel: 'k1' },
        { say: '有答案，就做监督学习：拆分 → 训练（逻辑回归：分「会走 / 不会走」两类，给出把握）→ 模型 → 评估。', show: ['p2', 't1', 'm1', 'e1'], sel: 't1' },
        { say: '运行看评估：准确率要和「全猜不会走」比。客户里本来多数不会走，瞎猜也有七成多，模型要比这个高才有用。', show: [], sel: 'e1', tab: 'run', run: true },
        { say: '每月拿「本月客户」+ 同一个模型预测：谁可能会走。规则筛出来，交给客户经理打电话回访。这次姓名、手机号留着：回访要用，而且全程在私有云里。', show: ['d2', 'f1', 'r1', 'g1'], sel: 'r1', tab: 'run', run: true },
        { say: '同一份数据，换一种问法：不看答案，让 K-means 按行为把客户自动分成 3 群。这叫无监督学习，不需要标签。', show: ['t2', 'm2'], sel: 't2', tab: 'props' },
        { say: '分群模型也一样反复用：本月客户进来，每人分到一群。右边能看到每一群的平均会员月数、来电次数，运营据此定策略。', show: ['f2', 'h1'], sel: 'f2', tab: 'run', run: true },
        { say: '通话录音（敏感：有声音、有个人信息）直接送进了公有云的语音转文字服务。标红。', show: ['d3', 'a1', 'a2', 'x1'], sel: 'e:d3>a1', tab: 'check' },
        { say: '改法：语音识别改成本地部署，录音不出公司。后面的大模型在私有云里读文字，不受影响。红点消失。', show: [], sel: 'a1', tab: 'check', fix: function (doc, id) { M.get(doc, id('a1')).loc = 'local'; } },
        { say: '四格图和清单：哪些先做，每个节点的输入输出。想动手改：文件 ▾ → 把这个示例复制到「我来画」。', show: [], tab: 'quad' },
        { say: '清单按连线顺序列出全部节点，附运行结果。', show: [], tab: 'list' }
      ]
    }
  ];

  /** 按示例搭出一张节点图，并排好位置。返回 { doc, ids: { k: 节点 id, 'e:a>b': 连线 id } }。 */
  function build(sample) {
    var doc = M.create(sample.title), ids = {}, stageOf = {};
    sample.stages.forEach(function (st) {
      var s = M.addNode(doc, 'stage', 0, 0, { name: st.name, desc: st.desc || '' }); ids[st.k] = s.id;
      st.items.forEach(function (it) {
        var props = {}; for (var key in it) if (key !== 'k' && key !== 'type') props[key] = it[key];
        if (typeof props.csv === 'string' && props.csv.charAt(0) === '@') props.csv = D.get(props.csv.slice(1));
        var n = M.addNode(doc, it.type, 0, 0, props); n.parent = s.id; ids[it.k] = n.id; stageOf[it.k] = st.k;
      });
    });
    sample.edges.forEach(function (e) {
      var o = e[2] || {}, r = M.connect(doc, ids[e[0]], ids[e[1]], o.fp || null, { label: o.label || '', masked: !!o.masked }, o.tp || null);
      if (r.err) throw new Error(sample.short + '：' + e[0] + ' → ' + e[1] + ' 连不上：' + r.err);
      ids['e:' + e[0] + '>' + e[1]] = r.edge.id;
    });
    // 排版：每个环节先在原点排好，再按 rows 放到位
    var y = 0;
    sample.rows.forEach(function (row) {
      var x = 0, rowH = 0;
      row.forEach(function (k) {
        var s = M.get(doc, ids[k]); M.moveTo(doc, s.id, 0, 0); M.arrange(doc, s.id);
        M.moveBy(doc, s.id, x - s.x, y - s.y); M.fitStages(doc);
        x = s.x + s.w + 70; rowH = Math.max(rowH, s.h);
      });
      y += rowH + 70;
    });
    return { doc: doc, ids: ids };
  }

  root.ABB = root.ABB || {};
  root.ABB.Samples = { list: SAMPLES, build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Samples;
})(typeof window !== 'undefined' ? window : globalThis);
