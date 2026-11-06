/* 节点库、端口类型、算法、AI 类型、位置、敏感等级、价值 / 难度、配色。纯数据，Node 测试也会读。
 *
 * 一个节点 = 左边几个输入口 + 右边几个输出口。口有类型（数据表 / 模型 / 评估报告 / 文字图片录音 / 任意），
 * 输出口只能连到类型对得上的输入口。数据表另外带「有没有标签」，由上游推出来，在「检查」里提醒。
 */
(function (root) {
  'use strict';

  // ---------------- 端口类型 ----------------
  // cat = 连线时按它判断能不能接：table 只接 table，model 只接 model……any 什么都接
  var PORTS = {
    data:   { name: '数据', cat: 'data', tip: '表格、图片、录音都行' },
    table:  { name: '数据表', cat: 'table', tip: '一张表：每行一条记录，每列一个字段' },
    model:  { name: '模型', cat: 'model', tip: '训练出来的模型：可以反复拿来预测' },
    metric: { name: '评估报告', cat: 'metric', tip: '模型准不准：准确率、误差' },
    text:   { name: '文字', cat: 'media', tip: '一段段文字：评价、对话、邮件' },
    image:  { name: '图片 / 视频', cat: 'media', tip: '照片、监控视频' },
    audio:  { name: '录音', cat: 'media', tip: '通话录音、语音' },
    any:    { name: '任意', cat: 'any', tip: '什么都可以接' }
  };
  function compatible(outType, inType) {
    var a = PORTS[outType] ? PORTS[outType].cat : 'any', b = PORTS[inType] ? PORTS[inType].cat : 'any';
    if (a === 'any' || b === 'any' || a === b) return true;
    // 「数据」= 表格或图片录音：和这两类都能接，运行时再看
    return (a === 'data' && (b === 'table' || b === 'media')) || (b === 'data' && (a === 'table' || a === 'media'));
  }

  // 数据的形态（数据源 / 新数据）
  var FORMS = {
    table: { name: '表格', port: 'table', tip: 'Excel、CSV、数据库里的一张表' },
    text:  { name: '文字', port: 'text', tip: '评价、聊天记录、文档' },
    image: { name: '图片 / 视频', port: 'image', tip: '照片、监控视频' },
    audio: { name: '录音', port: 'audio', tip: '通话录音、语音留言' }
  };
  var FORM_ORDER = ['table', 'text', 'image', 'audio'];

  // ---------------- 节点库 ----------------
  // ins / outs: [{ id, name, type, req（必须接）, multi（可以接多条） }]
  // run: 浏览器里能不能真的算（false = 只画图，运行时原样往下传或跳过）
  var GROUPS = [
    { id: 'data', name: '数据', tip: '数据从哪来：有没有标签、放在哪、多敏感' },
    { id: 'prep', name: '数据准备', tip: '把数据整理成能喂给模型的样子' },
    { id: 'ml', name: '机器学习', tip: '训练一次得到模型，模型反复拿来预测' },
    { id: 'ai', name: '其他 AI', tip: '大模型、图像识别、语音这类现成的 AI 服务' },
    { id: 'biz', name: '业务', tip: '人、规则、动作、公司已有的系统' }
  ];

  var KINDS = {
    // ---- 数据 ----
    src: { group: 'data', name: '数据源', short: '数据源', w: 200,
      tip: '一份已有的数据。表格要说清楚：有没有标签（有没有「答案」那一列）、标签是哪一列。可以导入 CSV，运行时真的拿来训练。',
      ins: [{ id: 'in', name: '回流数据（可不接）', type: 'data', multi: true }], outs: [{ id: 'out', name: '数据', type: 'table' }] },
    newdata: { group: 'data', name: '新数据（待预测）', short: '新数据', w: 200,
      tip: '模型训练好以后，每天 / 每批新进来的数据。它没有答案，正等着模型来预测。换一份新数据再运行，就是「模型反复用」。',
      ins: [], outs: [{ id: 'out', name: '新数据', type: 'table' }] },

    // ---- 数据准备 ----
    clean: { group: 'prep', name: '清洗', short: '清洗', w: 184,
      tip: '去掉缺数的行、重复的行、明显不对的数字。数据质量决定模型上限。',
      ins: [{ id: 'in', name: '原始数据', type: 'table', req: true }], outs: [{ id: 'out', name: '干净的数据', type: 'table' }] },
    feature: { group: 'prep', name: '选字段', short: '选字段', w: 184,
      tip: '挑出给模型看的字段（特征），去掉没用的和不该用的（比如姓名、订单号）。',
      ins: [{ id: 'in', name: '数据', type: 'table', req: true }], outs: [{ id: 'out', name: '选好的字段', type: 'table' }] },
    mask: { group: 'prep', name: '脱敏', short: '脱敏', w: 184,
      tip: '删掉或打码能认出人的字段：姓名、手机号、身份证号。脱敏后再送出公司。',
      ins: [{ id: 'in', name: '含个人信息', type: 'data', req: true }], outs: [{ id: 'out', name: '脱敏后的数据', type: 'data' }] },
    label: { group: 'prep', name: '人工标注', short: '标注', w: 184,
      tip: '人来补上「答案」那一列：这张照片是不是缺陷、这个客户后来走没走。无标签数据 → 有标签数据，监督学习才能用。',
      ins: [{ id: 'in', name: '无标签数据', type: 'data', req: true }], outs: [{ id: 'out', name: '有标签数据', type: 'data' }] },
    split: { group: 'prep', name: '拆分训练 / 测试', short: '拆分', w: 200,
      tip: '把有标签的数据随机分成两份：大份用来训练，小份留着考模型（模型没见过它，考出来的分才算数）。',
      ins: [{ id: 'in', name: '有标签数据', type: 'data', req: true }], outs: [{ id: 'train', name: '训练集', type: 'data' }, { id: 'test', name: '测试集', type: 'data' }] },
    join: { group: 'prep', name: '合并', short: '合并', w: 184,
      tip: '把两份字段相同的数据上下拼在一起，比如「历史数据」+「这个月新回收的数据」。',
      ins: [{ id: 'a', name: '数据 A', type: 'table', req: true }, { id: 'b', name: '数据 B', type: 'table', req: true }], outs: [{ id: 'out', name: '合并后', type: 'table' }] },

    // ---- 机器学习 ----
    train: { group: 'ml', name: '训练模型', short: '训练', w: 208, ai: true,
      tip: '选一种算法，喂进训练数据，算出一个模型。监督学习（预测数字、分类）要有标签的数据；无监督（分群、找异常）不用标签。',
      ins: [{ id: 'in', name: '训练数据', type: 'data', req: true }], outs: [{ id: 'model', name: '模型', type: 'model' }] },
    model: { group: 'ml', name: '模型（可反复用）', short: '模型', w: 208,
      tip: '训练出来的模型本身。锁定后它就固定下来：以后来了新数据只做预测，不再重新训练。一个模型可以接给好几个预测节点。',
      ins: [{ id: 'in', name: '训练结果', type: 'model' }], outs: [{ id: 'out', name: '模型', type: 'model' }] },
    evaluate: { group: 'ml', name: '评估', short: '评估', w: 200,
      tip: '拿模型没见过的测试集考一考：分类看准确率，预测数字看平均差多少。不评估就上线，等于没考试就上岗。',
      ins: [{ id: 'model', name: '模型', type: 'model', req: true }, { id: 'test', name: '测试集（有标签）', type: 'data', req: true }], outs: [{ id: 'out', name: '评估报告', type: 'metric' }] },
    predict: { group: 'ml', name: '预测', short: '预测', w: 200, ai: true,
      tip: '模型 + 新数据 → 每一行一个预测结果。模型不变，数据换了就再跑一次。',
      ins: [{ id: 'model', name: '模型', type: 'model', req: true }, { id: 'in', name: '新数据', type: 'data', req: true }], outs: [{ id: 'out', name: '预测结果', type: 'table' }] },
    collect: { group: 'ml', name: '回收真实结果', short: '回收', w: 200,
      tip: '过一段时间，真实结果出来了（实际卖了多少、客户走没走），补回去变成新的有标签数据，下一轮训练用。这就是「数据飞轮」。',
      ins: [{ id: 'in', name: '预测结果', type: 'table', req: true }], outs: [{ id: 'out', name: '新的有标签数据', type: 'data' }] },

    // ---- 其他 AI ----
    ai: { group: 'ai', name: 'AI 服务', short: 'AI 服务', w: 208, ai: true,
      tip: '现成的 AI 能力：大模型、知识库问答、图像识别、OCR、语音、优化算法……选好类型，写清输入和输出。',
      ins: [{ id: 'in', name: '输入', type: 'any', multi: true }], outs: [{ id: 'out', name: '输出', type: 'any' }] },

    // ---- 业务 ----
    human: { group: 'biz', name: '人工步骤', short: '人工', w: 184,
      tip: '由人完成的一步：审核、确认、复检、拍板。AI 的输出往往要人看一眼再往下走。',
      ins: [{ id: 'in', name: '输入', type: 'any', multi: true }], outs: [{ id: 'out', name: '输出', type: 'any' }] },
    rule: { group: 'biz', name: '规则判断', short: '规则', w: 200,
      tip: '按写清楚的条件筛选：比如「预测销量 > 120 的门店」「流失概率 > 0.6 的客户」。运行时真的会筛。',
      ins: [{ id: 'in', name: '数据', type: 'table', req: true }], outs: [{ id: 'yes', name: '满足条件', type: 'table' }, { id: 'no', name: '不满足', type: 'table' }] },
    action: { group: 'biz', name: '业务动作', short: '动作', w: 184,
      tip: '最后真正发生的事：下订单、发短信、打电话回访、隔离零件、报警。',
      ins: [{ id: 'in', name: '对谁做', type: 'any', multi: true }], outs: [] },
    ext: { group: 'biz', name: '外部系统', short: '外部', w: 184,
      tip: '公司已有的软件，或公司外面的平台：收银系统、外卖平台、ERP、供应商平台。',
      ins: [{ id: 'in', name: '输入', type: 'any', multi: true }], outs: [{ id: 'out', name: '输出', type: 'any' }] },
    store: { group: 'biz', name: '存档 / 数据库', short: '存档', w: 184,
      tip: '把结果存起来：预测结果写回系统、评估报告留档、下一轮训练用的数据。',
      ins: [{ id: 'in', name: '存什么', type: 'any', multi: true }], outs: [] },

    // ---- 分组框 ----
    stage: { group: 'frame', name: '业务环节', short: '环节', w: 260, h: 160,
      tip: '一个大环节（分组框）。把节点拖进来归到这个环节里；可以折叠。', ins: [], outs: [] }
  };
  var KIND_ORDER = ['src', 'newdata', 'clean', 'feature', 'mask', 'label', 'split', 'join', 'train', 'model', 'evaluate', 'predict', 'collect', 'ai', 'human', 'rule', 'action', 'ext', 'store'];
  KIND_ORDER.forEach(function (k) { KINDS[k].id = k; });
  KINDS.stage.id = 'stage';

  // 每类节点在库里的颜色组
  var COLOR_OF = { data: 'data', prep: 'prep', ml: 'ml', ai: 'ai', biz: 'biz', frame: 'stage' };
  function colorKey(kind) { var k = KINDS[kind]; if (!k) return 'biz'; if (kind === 'ext') return 'ext'; return COLOR_OF[k.group]; }

  // ---------------- 算法 ----------------
  // task: reg 预测数字 / clf 分类 / both 两者都行 / cluster 分群 / anomaly 找异常；sup = 要不要标签；run = 浏览器里能不能跑
  var ALGO_GROUPS = [
    { name: '监督学习：要有标签', items: [
      { id: 'linreg', name: '线性回归', task: 'reg', sup: true, run: true, good: '预测一个数字（销量、来电量），结果好解释：每个字段加一分、结果涨多少。', warn: '只能画直线关系；字段之间关系复杂时不够准。' },
      { id: 'logreg', name: '逻辑回归', task: 'clf', sup: true, run: true, good: '分两类或几类（会不会流失、合格不合格），给出概率，好解释。', warn: '同样只能画「直线」边界。' },
      { id: 'tree', name: '决策树', task: 'both', sup: true, run: true, good: '像一串「如果……就……」的问题，老板也看得懂；数字、分类都能做。', warn: '单棵树容易死记硬背训练数据（过拟合）。' },
      { id: 'forest', name: '随机森林', task: 'both', sup: true, run: true, good: '很多棵决策树一起投票，通常比单棵树准、更稳，是表格数据的好起点。', warn: '没有单棵树好解释；模型文件更大。' },
      { id: 'knn', name: 'K 近邻', task: 'both', sup: true, run: true, good: '找历史上最像的几条记录，看它们的答案：「和它最像的 5 个客户都流失了」。', warn: '数据一多就慢；字段单位不同要先统一。' },
      { id: 'nb', name: '朴素贝叶斯', task: 'clf', sup: true, run: true, good: '分类，训练极快，数据少也能用。', warn: '假设字段之间互不相关，现实里常常不成立。' },
      { id: 'gbm', name: '梯度提升（XGBoost / LightGBM）', task: 'both', sup: true, run: false, good: '表格数据比赛里最常赢的算法，准确率高。', warn: '参数多，要专人调；浏览器里不运行，演示时可换随机森林。' },
      { id: 'nn', name: '神经网络', task: 'both', sup: true, run: false, good: '图片、语音、文字这类复杂数据的主力。', warn: '要大量数据和算力，不好解释；浏览器里不运行。' },
      { id: 'ts', name: '时间序列（ARIMA / Prophet）', task: 'reg', sup: true, run: false, good: '按时间顺序预测：下周每天的销量、来电量，会考虑季节和趋势。', warn: '要连续的历史；浏览器里不运行，演示时可把星期、节假日做成字段用随机森林。' }
    ] },
    { name: '无监督学习：不用标签', items: [
      { id: 'kmeans', name: 'K-means 聚类', task: 'cluster', sup: false, run: true, good: '把客户、门店自动分成几群，每群特点相近；不需要事先知道答案。', warn: '要自己定分几群；分出来的群是什么意思要人来解读。' },
      { id: 'anomaly', name: '异常检测（Z 分数）', task: 'anomaly', sup: false, run: true, good: '找出和大多数「不一样」的记录：异常交易、设备读数突变。', warn: '会有误报；阈值要按业务调。' }
    ] }
  ];
  var ALGOS = {}, ALGO_ORDER = [];
  ALGO_GROUPS.forEach(function (g) { g.items.forEach(function (it) { it.group = g.name; ALGOS[it.id] = it; ALGO_ORDER.push(it.id); }); });
  var TASKS = { reg: '预测数字', clf: '分类', both: '预测数字或分类', cluster: '分群', anomaly: '找异常' };

  // ---------------- AI 服务的类型（12 种 + 其他） ----------------
  var AI_GROUPS = [
    { name: '文字与对话', items: [
      { id: 'llm', name: '大模型', good: '读懂和写出文字：总结、改写、问答、归类、起草。', warn: '会一本正经地说错，重要输出要人看。', inp: '一段文字、评价、对话记录', out: '摘要、分类、草稿' },
      { id: 'rag', name: '知识库问答', good: '先翻公司自己的资料再回答，答案带出处。', warn: '资料过时它就答错，资料要有人维护。', inp: '问题 + 公司文档', out: '带出处的回答' },
      { id: 'agent', name: '智能体（Agent）', good: '自己分几步做事：查系统、填表、发通知。', warn: '能动手就可能动错，要限定权限、留记录。', inp: '一个任务 + 可用的系统', out: '办完的事情和记录' }
    ] },
    { name: '看与听', items: [
      { id: 'vision', name: '图像识别', good: '看照片和视频：找缺陷、数人数、认物体。', warn: '光线、角度一变准确率就掉，要定期抽查。', inp: '照片、视频', out: '标签、位置、数量' },
      { id: 'ocr', name: '文档识别（OCR）', good: '把单据、发票、证件变成可编辑的文字和表格。', warn: '手写、模糊的要人复核。', inp: '单据照片、扫描件', out: '结构化的字段' },
      { id: 'speech', name: '语音', good: '语音转文字、文字转语音、听出情绪。', warn: '方言和噪音影响大；录音多含个人信息。', inp: '录音、通话', out: '文字、情绪标签' },
      { id: 'imagegen', name: '图像生成', good: '按文字描述画图：海报、商品图、配图。', warn: '版权和品牌风格要人把关。', inp: '文字描述、参考图', out: '图片' }
    ] },
    { name: '数字与决策', items: [
      { id: 'recommend', name: '推荐', good: '猜这个人接下来想要什么：商品、优惠、内容。', warn: '要有用户行为数据；别过度打扰。', inp: '用户行为、商品信息', out: '推荐清单' },
      { id: 'optimize', name: '优化算法', good: '在一堆限制条件下找最省、最快的安排：排班、排产、订货、路线。', warn: '条件写错，结果就「最优地错」。', inp: '需求 + 资源 + 限制条件', out: '排班表、计划、方案' },
      { id: 'rules', name: '规则引擎', good: '按写清楚的规则自动判断，每一步都能解释。', warn: '严格说不是「学出来的」AI；规则要人写、要维护。', inp: '一条记录', out: '通过 / 不通过 + 依据' },
      { id: 'predict', name: '预测（现成服务）', good: '买来的预测服务，不自己训练。想自己训练，用「机器学习」那组节点。', warn: '别人的模型不了解你的业务，要先小范围试。', inp: '历史数据表', out: '预测数字' },
      { id: 'anomaly', name: '异常检测（现成服务）', good: '买来的监控报警服务。', warn: '会有误报，阈值要调。', inp: '传感器读数、交易流水', out: '报警' }
    ] },
    { name: '其他', items: [
      { id: 'other', name: '其他 / 自定义', good: '上面都不合适时选这个，在说明里写清楚是什么。', warn: '', inp: '', out: '' }
    ] }
  ];
  var AI = {}, AI_ORDER = [];
  AI_GROUPS.forEach(function (g) { g.items.forEach(function (it) { it.group = g.name; AI[it.id] = it; AI_ORDER.push(it.id); }); });

  var LOCS = {
    local:   { name: '本地', tip: '公司自己的机房或电脑' },
    private: { name: '私有云', tip: '只给本公司用的专属云' },
    public:  { name: '公有云', tip: '第三方云服务、外部 API' }
  };
  var LOC_ORDER = ['local', 'private', 'public'];
  // 哪些节点有「运行在哪 / 放在哪」
  var HAS_LOC = { src: 1, newdata: 1, train: 1, model: 1, predict: 1, ai: 1, ext: 1, store: 1 };

  var LEVELS = {
    open:      { name: '公开', tip: '可以对外发布' },
    internal:  { name: '内部', tip: '员工能看，泄露影响小' },
    sensitive: { name: '敏感', tip: '个人信息、经营数据，泄露有损失' },
    secret:    { name: '机密', tip: '核心配方、工艺、图纸、录音这类，泄露后果严重' }
  };
  var LEVEL_ORDER = ['open', 'internal', 'sensitive', 'secret'];

  var HML = { high: '高', mid: '中', low: '低' };
  var VALUE_HELP = '做成以后，能多赚多少、省多少、少出多少错？高 = 直接影响收入、成本或客户体验的大头；中 = 有帮助但不显著；低 = 锦上添花。问自己：做好了，月报里看得出变化吗？';
  var EFFORT_HELP = '要做成有多难？高 = 没有现成数据、要改现有系统、出错代价大、要专门团队；中 = 数据要整理，或要接一两个系统；低 = 买现成工具就能用，数据现成，出错影响小。问自己：一个小团队三个月内能做出来试用吗？';

  // 四格图：「中」算进高的一边（价值中 = 值得做，难度中 = 要规划）
  var QUADS = {
    now:   { name: '先做', tip: '价值高、难度低' },
    plan:  { name: '规划', tip: '价值高、难度高' },
    easy:  { name: '顺手做', tip: '价值低、难度低' },
    skip:  { name: '先别做', tip: '价值低、难度高' }
  };
  function quadOf(value, effort) {
    if (!value || !effort) return '';
    var v = value !== 'low', e = effort !== 'low';
    return v ? (e ? 'plan' : 'now') : (e ? 'skip' : 'easy');
  }

  // 画布配色：浅色 / 深色两套。导出 PNG 一律用浅色。
  var PALETTES = {
    light: {
      bg: '#ffffff', ink: '#1d2430', muted: '#5f6b7c', edge: '#7c8799', sel: '#ffb020', guide: '#ff3d7f', ok: '#2f9e5f', err: '#e02c2c', skip: '#8a94a6',
      stage: { fill: '#f4f7fd', head: '#e3eafb', stroke: '#8fa6d8', ink: '#1d3c8f' },
      data:  { fill: '#eefaf2', head: '#cfeedd', stroke: '#2f9e5f', ink: '#155a33' },
      prep:  { fill: '#ecf8fa', head: '#c9ebf1', stroke: '#1b8fa3', ink: '#0d5562' },
      ml:    { fill: '#f3edff', head: '#e0d3ff', stroke: '#7b4fe0', ink: '#4a2499' },
      ai:    { fill: '#fdeef7', head: '#f8d3e9', stroke: '#c43c8e', ink: '#7a1f57' },
      biz:   { fill: '#fff6e5', head: '#fde5b8', stroke: '#e09a1a', ink: '#6b4300' },
      ext:   { fill: '#f1f3f6', head: '#e0e4ea', stroke: '#7a8494', ink: '#3a4250' },
      port:  { data: '#3b6fe0', table: '#3b6fe0', model: '#7b4fe0', metric: '#1b8fa3', media: '#c43c8e', any: '#8a94a6' },
      loc: { local: '#2f9e5f', private: '#3b6fe0', public: '#e0761a' },
      level: { open: '#8a94a6', internal: '#3b6fe0', sensitive: '#e0761a', secret: '#d63b3b' },
      red: '#e02c2c', yellow: '#e0a800', badgeInk: '#ffffff'
    },
    dark: {
      bg: '#141821', ink: '#e8ecf4', muted: '#a3adbf', edge: '#8692a6', sel: '#ffc24d', guide: '#ff5c95', ok: '#45c27b', err: '#ff5b5b', skip: '#7d879a',
      stage: { fill: '#171d2b', head: '#1f2a45', stroke: '#4d64a3', ink: '#cfdcff' },
      data:  { fill: '#16291f', head: '#1d3d2c', stroke: '#45c27b', ink: '#bdf0d2' },
      prep:  { fill: '#13262b', head: '#183a42', stroke: '#3cbcd2', ink: '#bdeef6' },
      ml:    { fill: '#261f3d', head: '#36295e', stroke: '#a07cff', ink: '#e0d4ff' },
      ai:    { fill: '#2e1a28', head: '#4a2240', stroke: '#ec6cb9', ink: '#ffd3ec' },
      biz:   { fill: '#2e2616', head: '#47391b', stroke: '#e8a83a', ink: '#ffdca0' },
      ext:   { fill: '#20242c', head: '#2c323d', stroke: '#8d97a8', ink: '#d5dbe5' },
      port:  { data: '#5b86ff', table: '#5b86ff', model: '#a07cff', metric: '#3cbcd2', media: '#ec6cb9', any: '#8d97a8' },
      loc: { local: '#3cb371', private: '#5b86ff', public: '#f08a33' },
      level: { open: '#7d879a', internal: '#5b86ff', sensitive: '#f08a33', secret: '#ff5b5b' },
      red: '#ff4d4d', yellow: '#ffc61a', badgeInk: '#ffffff'
    }
  };

  root.ABB = root.ABB || {};
  root.ABB.Config = {
    APP_NAME: 'AI 业务拆解画板', TAGLINE: '把业务拆成节点：数据 → 训练 → 模型 → 预测 → 动作',
    PORTS: PORTS, compatible: compatible, FORMS: FORMS, FORM_ORDER: FORM_ORDER,
    GROUPS: GROUPS, KINDS: KINDS, KIND_ORDER: KIND_ORDER, colorKey: colorKey,
    ALGO_GROUPS: ALGO_GROUPS, ALGOS: ALGOS, ALGO_ORDER: ALGO_ORDER, TASKS: TASKS,
    AI_GROUPS: AI_GROUPS, AI: AI, AI_ORDER: AI_ORDER,
    LOCS: LOCS, LOC_ORDER: LOC_ORDER, HAS_LOC: HAS_LOC, LEVELS: LEVELS, LEVEL_ORDER: LEVEL_ORDER,
    HML: HML, VALUE_HELP: VALUE_HELP, EFFORT_HELP: EFFORT_HELP, QUADS: QUADS, quadOf: quadOf,
    PALETTES: PALETTES, GRID: 8, PAD: 18, HEAD: 34,
    // 节点内部排版
    NODE: { HEAD: 28, SUB: 22, ROW: 22, FOOT: 28 }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Config;
})(typeof window !== 'undefined' ? window : globalThis);
