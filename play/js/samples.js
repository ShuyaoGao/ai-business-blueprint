/* 三个内置示例（全部虚构）与「观看」模式的逐步解说。纯数据 + 一个搭图函数，Node 测试也会读。
 *
 * 示例 = { id, title, short, stages: [{ k, name, desc, items: [{ k, type, name, ...属性 }] }], data: [...], edges: [[from, to, {label, kind}]],
 *          steps: [{ say, show: [k...], tab, sel, fix: function (doc, id) }] }
 * 布局：环节从左到右排成一行，环节里的方框竖着排；数据排在下面一行。
 */
(function (root) {
  'use strict';
  var M = (root.ABB && root.ABB.Model) || require('./model.js');
  var C = (root.ABB && root.ABB.Config) || require('./config.js');

  function ai(k, name, aiType, input, output, loc, value, effort, desc) { return { k: k, type: 'ai', name: name, aiType: aiType, input: input, output: output, loc: loc, value: value, effort: effort, desc: desc || '' }; }
  function hu(k, name, role, desc) { return { k: k, type: 'human', name: name, role: role, desc: desc || '' }; }
  function ex(k, name, loc, desc) { return { k: k, type: 'ext', name: name, loc: loc, desc: desc || '' }; }
  function da(k, name, level, loc, desc) { return { k: k, type: 'data', name: name, level: level, loc: loc, desc: desc || '' }; }

  var SAMPLES = [
    // ======================================================================
    {
      id: 'restaurant', short: '连锁餐饮', title: '连锁餐饮：50 家门店的快餐连锁（虚构示例）',
      stages: [
        { k: 'S1', name: '备货采购', desc: '每天晚上给每家店订明天的食材', items: [
          ai('f1', '明日销量预测', 'predict', '近两年每店每道菜的销量、天气、节假日', '每店每道菜明天卖几份', 'private', 'high', 'mid', '订多了浪费，订少了断货；这是餐饮最值钱的一个预测。'),
          ai('f2', '自动生成订货单', 'optimize', '预测份数、库存、保质期、起订量', '每家店的订货单', 'private', 'high', 'mid'),
          hu('f3', '店长确认订货', '店长', 'AI 出草稿，人拍板：店长知道明天门口修路。'),
          ex('f4', '供应商订货平台', 'public')] },
        { k: 'S2', name: '排班', desc: '按客流安排每家店的人手', items: [
          ai('b1', '自动排班', 'optimize', '客流预测、员工可上班时间、工时规定', '下周排班表', 'private', 'mid', 'low'),
          hu('b2', '店长微调排班', '店长')] },
        { k: 'S3', name: '点餐收银', desc: '堂食、外卖两条入口', items: [
          ex('c1', '外卖平台', 'public'),
          ex('c2', '收银系统', 'public', '租用的云收银（SaaS）'),
          ai('c3', '加购推荐', 'recommend', '本单菜品、会员历史订单', '推荐一样饮料或小吃', 'private', 'mid', 'mid')] },
        { k: 'S4', name: '后厨出品', desc: '按单做菜、出餐', items: [
          hu('k1', '厨师按单制作', '厨师'),
          ai('k2', '出餐拍照核对', 'vision', '出餐口照片', '漏菜、份量异常提醒', 'local', 'low', 'high', '看起来很酷，但漏菜靠出餐单和人工核对已经能解决。')] },
        { k: 'S5', name: '评价与营销', desc: '听顾客怎么说，再把新品卖出去', items: [
          ai('m1', '差评归类', 'llm', '外卖平台上的评价', '每周问题清单（口味 / 等太久 / 漏送）', 'public', 'high', 'low'),
          ai('m2', '会员短信文案', 'llm', '会员信息（手机号、消费记录）', '个性化促销短信', 'public', 'mid', 'low'),
          ai('m3', '新品海报', 'imagegen', '新品照片、一句文案', '海报图片', 'public', 'low', 'low'),
          hu('m4', '运营经理审核发布', '运营经理', 'AI 写的东西，发出去之前人要看一眼。')] }
      ],
      data: [
        da('d1', '销售流水', 'internal', 'private', '每单卖了什么、几点卖的'),
        da('d2', '会员信息', 'sensitive', 'private', '手机号、生日、消费记录'),
        da('d3', '员工信息', 'sensitive', 'local', '姓名、电话、可上班时间'),
        da('d4', '核心配方', 'secret', 'local', '酱料配方和工艺：店的命根子')
      ],
      edges: [
        ['d1', 'f1', { label: '历史销量' }], ['f1', 'f2', { label: '预测份数' }], ['f2', 'f3'], ['f3', 'f4', { label: '订单' }],
        ['f1', 'b1', { label: '客流预测' }], ['d3', 'b1', { label: '可上班时间' }], ['b1', 'b2'],
        ['c2', 'd1', { label: '销售记录' }], ['d2', 'c3', { label: '会员历史' }], ['c3', 'c2', { label: '推荐' }],
        ['c1', 'k1', { label: '外卖单' }], ['c2', 'k1', { label: '堂食单' }], ['d4', 'k1', { label: '配方' }], ['k1', 'k2'], ['f4', 'k1', { label: '送货' }],
        ['c1', 'm1', { label: '评价', kind: 'data' }], ['d2', 'm2', { label: '手机号、消费记录' }],
        ['m1', 'm4', { label: '问题清单' }], ['m2', 'm4'], ['m3', 'm4']
      ],
      steps: [
        { say: '一家 50 家门店的快餐连锁（虚构）。第一步不碰 AI，先把业务拆成 5 个大环节：备货采购、排班、点餐收银、后厨出品、评价与营销。', show: ['S1', 'S2', 'S3', 'S4', 'S5'] },
        { say: '备货采购：最值钱的是「明天每道菜卖几份」——这是预测（机器学习）的活儿，吃的是近两年的销量、天气和节假日。', show: ['f1'], sel: 'f1' },
        { say: '有了预测，订多少由优化算法算：在库存、保质期、起订量这些限制下，找最省的订法。', show: ['f2'], sel: 'f2' },
        { say: 'AI 只出草稿，店长拍板——明天门口修路这种事，AI 不知道。订单最后发到供应商的平台（外部系统，在公有云）。', show: ['f3', 'f4'] },
        { say: '排班也是优化问题：按客流预测和员工可上班时间排；店长再微调。', show: ['b1', 'b2'], sel: 'b1' },
        { say: '点餐收银：外卖平台和云收银系统都是现成的外部系统；AI 只做一件事——加购推荐，猜你还想要一杯饮料。', show: ['c1', 'c2', 'c3'], sel: 'c3' },
        { say: '后厨出品：做菜靠人。「出餐拍照核对」用图像识别，看着很酷——等会儿四格图里看它值不值得做。', show: ['k1', 'k2'], sel: 'k2' },
        { say: '评价与营销是大模型的主场：把几千条外卖评价归成问题清单；写会员短信；图像生成画新品海报。发出去之前，运营经理要看一眼。', show: ['m1', 'm2', 'm3', 'm4'], sel: 'm1' },
        { say: '再画数据：存在哪（本地 / 私有云 / 公有云）、多敏感（公开 / 内部 / 敏感 / 机密）。核心配方是机密，只放本地。虚线就是数据往哪流。', show: ['d1', 'd2', 'd3', 'd4'], sel: 'd4' },
        { say: '一键统计：5 个环节全都用上了 AI，AI 步骤和人工步骤大约 2 : 1；用得最多的是大模型和优化算法。', tab: 'stats' },
        { say: '四格图：按「业务价值 × 落地难度」排队。差评归类、会员短信、自动排班「先做」；销量预测、自动订货、加购推荐价值高但要花功夫，「规划」；新品海报「顺手做」；出餐拍照核对价值低、难度高——「先别做」。', tab: 'quad' },
        { say: '标红了：会员的手机号和消费记录，被直接送进了公有云上的大模型去写短信。这是敏感个人信息出公司。', tab: 'stats', sel: 'e:d2>m2' },
        { say: '改法：只把「会员分群标签」（比如"爱吃辣、周末来"）传给大模型，勾上「已脱敏」。红变黄——黄色是提醒你找 IT 和法务确认脱敏到位。', tab: 'stats', sel: 'e:d2>m2',
          fix: function (doc, id) { var e = M.getEdge(doc, id('e:d2>m2')); e.masked = true; e.label = '只传会员分群标签'; var n = M.get(doc, id('m2')); n.input = '会员分群标签（不含手机号）'; } },
        { say: '最后导出 Markdown 清单：每个环节用什么 AI、输入输出、数据放哪、先做什么——学员课后直接拿去写方案。', tab: 'list' }
      ]
    },
    // ======================================================================
    {
      id: 'factory', short: '工厂质检', title: '工厂质检：汽车零部件厂，从来料到出货（虚构示例）',
      stages: [
        { k: 'S1', name: '来料检验', desc: '供应商送来的料，先查再用', items: [
          ex('i1', '供应商', 'public', '送货单、出厂检验报告'),
          ai('i2', '识别送货单和检验报告', 'ocr', '送货单、检验报告的照片或 PDF', '批号、数量、关键指标', 'public', 'mid', 'low'),
          ai('i3', '是否免检', 'rules', '供应商等级、近 3 批检验结果', '免检 / 抽检 + 依据', 'local', 'mid', 'low', '规则：A 级供应商且近 3 批都合格 → 免检。'),
          hu('i4', '抽检员抽检', '来料检验员')] },
        { k: 'S2', name: '生产', desc: '排产、开机、设备维护', items: [
          ex('p0', 'ERP', 'local', '订单、库存、出货都记在这里'),
          ai('p1', '排产', 'optimize', '订单、设备产能、换模时间', '每台设备的生产顺序', 'local', 'high', 'high'),
          ai('p2', '设备故障预警', 'anomaly', '振动、温度、电流读数', '异常报警', 'local', 'high', 'mid'),
          hu('p3', '维修工检修', '设备维修工')] },
        { k: 'S3', name: '外观质检', desc: '拆得最细的一段：每个零件拍照、判定、复判', items: [
          ai('q1', '缺陷检测', 'vision', '工位相机拍的产品照片', '缺陷类型、位置、把握有多大', 'local', 'high', 'high'),
          ai('q2', '判定合格', 'rules', '缺陷尺寸和位置、客户标准', '合格 / 不合格 + 依据', 'local', 'high', 'low'),
          hu('q3', '把握不大的交人复判', '质检员'),
          ai('q4', '良率预测', 'predict', '工艺参数、历史良率', '下一批良率，提前调参', 'local', 'low', 'high', '历史数据还不够多时，先别做。')] },
        { k: 'S4', name: '报告与出货', desc: '写报告、签字、发给客户', items: [
          ai('r1', '生成质检日报', 'llm', '当天检验结果、工艺参数', '质检日报文字', 'public', 'low', 'low'),
          hu('r2', '质量经理签字', '质量经理'),
          ex('r3', '客户质量系统', 'public')] }
      ],
      data: [
        da('x1', '设备传感器数据', 'internal', 'local'),
        da('x2', '产品照片与缺陷样本库', 'internal', 'local', '训练缺陷检测模型用'),
        da('x3', '工艺参数', 'secret', 'local', '温度、压力、配比：工厂的核心技术'),
        da('x4', '客户图纸与标准', 'secret', 'local', '客户给的，合同里写明不能外传')
      ],
      edges: [
        ['i1', 'i2', { label: '送货单、报告', kind: 'data' }], ['i2', 'i3', { label: '批号、指标' }], ['i3', 'i4', { label: '要抽检的批次' }],
        ['p0', 'p1', { label: '订单', kind: 'data' }], ['x1', 'p2', { label: '传感器读数' }], ['p2', 'p3', { label: '报警' }],
        ['x2', 'q1', { label: '照片' }], ['q1', 'q2', { label: '缺陷' }], ['q2', 'q3', { label: '把握不大的' }], ['x4', 'q2', { label: '客户标准' }], ['x3', 'q4', { label: '工艺参数' }],
        ['q2', 'r1', { label: '检验结果', kind: 'data' }], ['x3', 'r1', { label: '工艺参数' }], ['r1', 'r2'], ['r2', 'r3', { label: '质检报告' }], ['r2', 'p0', { label: '放行' }]
      ],
      steps: [
        { say: '一家汽车零部件厂（虚构）：从来料到出货拆成 4 个环节。外观质检拆得最细，因为钱和风险都在这里。', show: ['S1', 'S2', 'S3', 'S4'] },
        { say: '来料检验：供应商送来的单据五花八门，文档识别（OCR）把它们变成批号、数量、指标。', show: ['i1', 'i2'], sel: 'i2' },
        { say: '要不要抽检？规则引擎按写清楚的规则判断：A 级供应商、近 3 批都合格就免检。每一步都能解释，审计时说得清。', show: ['i3', 'i4'], sel: 'i3' },
        { say: '生产：排产是优化算法——订单、产能、换模时间一起算。设备故障预警是异常检测：读数和平时不一样就报警，维修工去看。', show: ['p0', 'p1', 'p2', 'p3'], sel: 'p2' },
        { say: '外观质检第一步：图像识别看照片，找缺陷，还要报告「把握有多大」。', show: ['q1'], sel: 'q1' },
        { say: '合格不合格不让 AI 自由发挥：用规则引擎按客户标准判，把握不大的交给质检员复判。AI + 规则 + 人，各干各擅长的。', show: ['q2', 'q3'], sel: 'q3' },
        { say: '良率预测听起来很好，但这家厂历史数据不够、工艺常改——放进四格图看看。', show: ['q4'], sel: 'q4' },
        { say: '报告与出货：大模型把当天结果写成日报，质量经理签字后发给客户的质量系统，再在 ERP 里放行。', show: ['r1', 'r2', 'r3'], sel: 'r1' },
        { say: '数据：工艺参数和客户图纸都是机密，放本地。产品照片也在本地——缺陷检测模型就装在厂里。', show: ['x1', 'x2', 'x3', 'x4'], sel: 'x3' },
        { say: '统计：4 个环节都用上了 AI；用到规则引擎 2 次——很多"自动化"规则就够，不一定要大模型。', tab: 'stats' },
        { say: '四格图：判定合格、单据识别、免检规则「先做」；缺陷检测和排产价值高但难，「规划」；良率预测「先别做」。', tab: 'quad' },
        { say: '标红：机密的工艺参数被直接送进了公有云上的大模型，只为了写一份日报。', tab: 'stats', sel: 'e:x3>r1' },
        { say: '改法：写日报的大模型改成本地部署（或者只传统计数字）。改完，红点消失。', tab: 'stats', sel: 'r1',
          fix: function (doc, id) { M.get(doc, id('r1')).loc = 'local'; } },
        { say: '导出 Markdown 清单，就是一份工厂 AI 落地的初稿。', tab: 'list' }
      ]
    },
    // ======================================================================
    {
      id: 'callcenter', short: '客服中心', title: '客服中心：家电品牌的电话 + 在线客服（虚构示例）',
      stages: [
        { k: 'S1', name: '接入与分流', desc: '电话和 APP 两个入口', items: [
          ex('a1', '呼叫中心平台', 'public'),
          ex('a2', 'APP 在线客服', 'public'),
          ai('a3', '通话实时转文字', 'speech', '通话录音', '文字记录', 'public', 'high', 'low'),
          ai('a4', '判断来意并分流', 'llm', '客户的第一句话（文字）', '查物流 / 报修 / 投诉，转机器人或人工', 'private', 'high', 'mid')] },
        { k: 'S2', name: '机器人自助', desc: '能自助的不占用坐席', items: [
          ai('b1', '按手册和保修政策回答', 'rag', '客户问题 + 产品手册、保修政策', '带出处的回答', 'private', 'high', 'mid'),
          ai('b2', '查订单、约上门维修', 'agent', '客户请求', '查到的物流、约好的上门时间', 'private', 'mid', 'high', '智能体能动手改系统，权限只开查询和预约。'),
          ex('b3', '订单与派工系统', 'private')] },
        { k: 'S3', name: '人工坐席', desc: '复杂问题和投诉', items: [
          hu('c1', '坐席处理复杂问题', '客服坐席'),
          ai('c2', '实时推荐回复话术', 'llm', '对话文字 + 知识库', '建议回复', 'private', 'mid', 'mid'),
          ai('c3', '情绪识别', 'speech', '通话语音', '情绪激动提醒', 'private', 'low', 'low'),
          ai('c4', '退款审批', 'rules', '订单金额、退款原因', '200 元以下自动通过，其余转班长', 'private', 'mid', 'low'),
          hu('c5', '班长处理升级投诉', '班长')] },
        { k: 'S4', name: '事后分析', desc: '复盘和排班', items: [
          ai('d1', '通话摘要、自动填工单', 'llm', '通话文字', '摘要和工单字段', 'private', 'high', 'low'),
          ai('d2', '全量通话质检', 'llm', '全部通话文字', '违规承诺、服务问题清单', 'private', 'mid', 'low'),
          ai('d3', '来电量预测', 'predict', '历史来电量、促销日历', '下周每小时来电量', 'private', 'mid', 'mid'),
          ai('d4', '坐席排班', 'optimize', '来电量预测、坐席可上班时间', '排班表', 'private', 'mid', 'low')] }
      ],
      data: [
        da('y1', '通话录音', 'sensitive', 'local', '里面有姓名、地址、电话'),
        da('y2', '客户档案与订单', 'sensitive', 'private'),
        da('y3', '产品手册与保修政策', 'open', 'public', '本来就公开在官网上')
      ],
      edges: [
        ['a1', 'y1', { label: '录音', kind: 'data' }], ['y1', 'a3', { label: '通话录音' }], ['a3', 'a4', { label: '文字' }], ['a2', 'a4', { label: '文字消息' }],
        ['a4', 'b1', { label: '一般问题' }], ['a4', 'b2', { label: '查单 / 报修' }], ['a4', 'c1', { label: '投诉 / 复杂问题' }],
        ['y3', 'b1', { label: '手册' }], ['b2', 'b3', { label: '查询、预约', kind: 'data' }], ['y2', 'b2', { label: '客户档案' }],
        ['c2', 'c1', { label: '建议回复' }], ['c3', 'c5', { label: '情绪提醒' }], ['c1', 'c4', { label: '退款申请' }], ['c4', 'c5', { label: '200 元以上' }],
        ['a3', 'd1', { label: '通话文字', kind: 'data' }], ['a3', 'd2', { label: '通话文字', kind: 'data' }], ['d1', 'y2', { label: '工单' }], ['d3', 'd4', { label: '来电量预测' }]
      ],
      steps: [
        { say: '一个家电品牌的客服中心（虚构）：电话 + APP，拆成 4 个环节。客服是几乎每家公司都有的部门。', show: ['S1', 'S2', 'S3', 'S4'] },
        { say: '接入：电话进呼叫中心平台，语音识别把通话实时转成文字——后面所有 AI 都靠这份文字。', show: ['a1', 'a2', 'a3'], sel: 'a3' },
        { say: '大模型听第一句话判断来意：查物流、报修、还是投诉？分给机器人或人工。', show: ['a4'], sel: 'a4' },
        { say: '机器人自助：知识库问答先翻产品手册和保修政策再回答，答案带出处，不瞎编。', show: ['b1'], sel: 'b1' },
        { say: '智能体（Agent）能动手：查订单、约上门维修。能动手就可能动错，所以只给查询和预约的权限。', show: ['b2', 'b3'], sel: 'b2' },
        { say: '人工坐席：AI 不替人，而是帮人——实时推荐话术、听出客户情绪；200 元以下的退款由规则引擎直接批。', show: ['c1', 'c2', 'c3', 'c4', 'c5'], sel: 'c4' },
        { say: '事后分析：每通电话自动写摘要、填工单；100% 质检；预测下周来电量，再用优化算法排班。', show: ['d1', 'd2', 'd3', 'd4'], sel: 'd1' },
        { say: '数据：通话录音里有姓名、地址、电话——敏感，存本地；产品手册本来就公开。', show: ['y1', 'y2', 'y3'], sel: 'y1' },
        { say: '统计：4 个环节全用上了 AI，一共 11 个 AI 步骤，其中大模型 4 个——客服是大模型落地最快的地方。', tab: 'stats' },
        { say: '四格图：通话转文字、摘要填工单、退款规则「先做」；知识库问答、智能体价值高但要花功夫，「规划」；情绪识别「顺手做」。', tab: 'quad' },
        { say: '标红：通话录音被直接送进了公有云上的语音识别。录音一出公司，就收不回来了。', tab: 'stats', sel: 'e:y1>a3' },
        { say: '改法：语音识别改成本地部署，录音不出公司。改完，红点消失。', tab: 'stats', sel: 'a3',
          fix: function (doc, id) { M.get(doc, id('a3')).loc = 'local'; } },
        { say: '导出 Markdown 清单：客服中心的 AI 方案初稿就有了。', tab: 'list' }
      ]
    }
  ];

  var COL_GAP = 72, ROW_GAP = 96, ITEM_GAP = 16;

  /** 搭出示例蓝图；返回 { doc, ids: { 键: 方框 / 连线 id } }。连线的键是 'e:起点>终点'。 */
  function build(sample) {
    var doc = M.create(sample.title), ids = {}, x = 0, bottom = 0;
    sample.stages.forEach(function (st) {
      var s = M.addNode(doc, 'stage', x, 0, { name: st.name, desc: st.desc || '' }); ids[st.k] = s.id;
      var y = C.HEAD + 10;
      st.items.forEach(function (it) {
        var props = {}; for (var k in it) if (k !== 'k' && k !== 'type') props[k] = it[k];
        var n = M.addNode(doc, it.type, x + C.PAD, y, props); n.parent = s.id; ids[it.k] = n.id; y += n.h + ITEM_GAP;
      });
      M.fitStages(doc);
      x = s.x + s.w + COL_GAP; bottom = Math.max(bottom, s.y + s.h);
    });
    var totalW = x - COL_GAP, nd = sample.data.length, dw = C.TYPES.data.w, gap = Math.max(40, (totalW - nd * dw) / Math.max(1, nd - 1));
    var startX = nd > 1 ? 0 : (totalW - dw) / 2;
    if (nd > 1 && gap > 220) { gap = 220; startX = (totalW - (nd * dw + (nd - 1) * gap)) / 2; }
    sample.data.forEach(function (it, i) {
      var props = {}; for (var k in it) if (k !== 'k' && k !== 'type') props[k] = it[k];
      var n = M.addNode(doc, 'data', Math.round(startX + i * (dw + gap)), bottom + ROW_GAP, props); ids[it.k] = n.id;
    });
    sample.edges.forEach(function (e) {
      var props = {}; if (e[2]) for (var k in e[2]) props[k] = e[2][k];
      var made = M.addEdge(doc, ids[e[0]], ids[e[1]], props);
      if (!made) throw new Error('示例连线有误：' + e[0] + ' → ' + e[1]);
      ids['e:' + e[0] + '>' + e[1]] = made.id;
    });
    return { doc: doc, ids: ids };
  }

  root.ABB = root.ABB || {};
  root.ABB.Samples = { list: SAMPLES, build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Samples;
})(typeof window !== 'undefined' ? window : globalThis);
