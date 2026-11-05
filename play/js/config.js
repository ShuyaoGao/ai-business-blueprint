/* 名称、方框类型、AI 类型、位置、敏感等级、价值 / 难度、配色。纯数据，Node 测试也会读。 */
(function (root) {
  'use strict';

  var TYPES = {
    stage: { name: '业务环节', short: '环节', tip: '一个大环节。可以把别的方框拖进来当小步骤，可以折叠。', w: 240, h: 140 },
    human: { name: '人工步骤', short: '人工', tip: '由人完成的一步。', w: 176, h: 72 },
    ai:    { name: 'AI 能力',  short: 'AI',   tip: '交给 AI 完成的一步。', w: 176, h: 72 },
    data:  { name: '数据 / 存储', short: '数据', tip: '一份数据：放在哪、有多敏感。', w: 168, h: 80 },
    ext:   { name: '外部系统', short: '外部', tip: '公司已有的软件，或公司外面的平台、单位。', w: 176, h: 72 }
  };
  var TYPE_ORDER = ['stage', 'human', 'ai', 'data', 'ext'];

  // 12 种 AI 类型 + 其他，按 4 组排列。good = 擅长干什么，warn = 要小心，inp / out = 输入输出的示例提示
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
    { name: '数字与预测', items: [
      { id: 'predict', name: '预测（机器学习）', good: '从历史数字里找规律，预测明天：销量、来电量、良率。', warn: '要足够的历史数据；遇到没见过的情况会失准。', inp: '历史数据表', out: '预测数字' },
      { id: 'recommend', name: '推荐', good: '猜这个人接下来想要什么：商品、优惠、内容。', warn: '要有用户行为数据；别过度打扰。', inp: '用户行为、商品信息', out: '推荐清单' },
      { id: 'anomaly', name: '异常检测', good: '发现"和平时不一样"的情况：设备故障、刷单、异常交易。', warn: '会有误报，阈值要调。', inp: '传感器读数、交易流水', out: '报警和异常分数' }
    ] },
    { name: '规则与决策', items: [
      { id: 'rules', name: '规则引擎', good: '按写清楚的规则自动判断，每一步都能解释。', warn: '严格说不是"学出来的"AI；规则要人写、要维护。', inp: '一条记录（金额、等级……）', out: '通过 / 不通过 + 依据' },
      { id: 'optimize', name: '优化算法', good: '在一堆限制条件下找最省、最快的安排：排班、排产、订货、路线。', warn: '条件写错，结果就"最优地错"。', inp: '需求 + 资源 + 限制条件', out: '排班表、计划、方案' }
    ] },
    { name: '其他', items: [
      { id: 'other', name: '其他 / 自定义', good: '上面都不合适时选这个，在说明里写清楚是什么。', warn: '', inp: '', out: '' }
    ] }
  ];
  var AI = {}; var AI_ORDER = [];
  AI_GROUPS.forEach(function (g) { g.items.forEach(function (it) { it.group = g.name; AI[it.id] = it; AI_ORDER.push(it.id); }); });

  var LOCS = {
    local:   { name: '本地', tip: '公司自己的机房或电脑' },
    private: { name: '私有云', tip: '只给本公司用的专属云' },
    public:  { name: '公有云', tip: '第三方云服务、外部 API' }
  };
  var LOC_ORDER = ['local', 'private', 'public'];

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
      bg: '#ffffff', ink: '#1d2430', muted: '#5f6b7c', edge: '#7c8799', sel: '#ffb020', guide: '#ff3d7f',
      stage: { fill: '#f2f6ff', head: '#dfe8ff', stroke: '#3b6fe0', ink: '#1d3c8f' },
      human: { fill: '#fff6e5', stroke: '#e09a1a', ink: '#6b4300' },
      ai:    { fill: '#f3edff', stroke: '#7b4fe0', ink: '#4a2499' },
      data:  { fill: '#e9f8ef', stroke: '#2f9e5f', ink: '#155a33' },
      ext:   { fill: '#f1f3f6', stroke: '#7a8494', ink: '#3a4250' },
      loc: { local: '#2f9e5f', private: '#3b6fe0', public: '#e0761a' },
      level: { open: '#8a94a6', internal: '#3b6fe0', sensitive: '#e0761a', secret: '#d63b3b' },
      red: '#e02c2c', yellow: '#e0a800', badgeInk: '#ffffff'
    },
    dark: {
      bg: '#141821', ink: '#e8ecf4', muted: '#a3adbf', edge: '#8692a6', sel: '#ffc24d', guide: '#ff5c95',
      stage: { fill: '#1a2236', head: '#22305a', stroke: '#6a93ff', ink: '#cfdcff' },
      human: { fill: '#2e2616', stroke: '#e8a83a', ink: '#ffdca0' },
      ai:    { fill: '#261f3d', stroke: '#a07cff', ink: '#e0d4ff' },
      data:  { fill: '#16291f', stroke: '#45c27b', ink: '#bdf0d2' },
      ext:   { fill: '#20242c', stroke: '#8d97a8', ink: '#d5dbe5' },
      loc: { local: '#3cb371', private: '#5b86ff', public: '#f08a33' },
      level: { open: '#7d879a', internal: '#5b86ff', sensitive: '#f08a33', secret: '#ff5b5b' },
      red: '#ff4d4d', yellow: '#ffc61a', badgeInk: '#ffffff'
    }
  };

  root.ABB = root.ABB || {};
  root.ABB.Config = {
    APP_NAME: 'AI 业务拆解画板', TAGLINE: '把业务拆成小方框：哪里用 AI、数据放哪',
    TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, AI_GROUPS: AI_GROUPS, AI: AI, AI_ORDER: AI_ORDER,
    LOCS: LOCS, LOC_ORDER: LOC_ORDER, LEVELS: LEVELS, LEVEL_ORDER: LEVEL_ORDER,
    HML: HML, VALUE_HELP: VALUE_HELP, EFFORT_HELP: EFFORT_HELP, QUADS: QUADS, quadOf: quadOf,
    PALETTES: PALETTES, GRID: 8, PAD: 16, HEAD: 34
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Config;
})(typeof window !== 'undefined' ? window : globalThis);
