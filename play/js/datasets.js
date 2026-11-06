/* 三个示例用的虚构数据：按固定种子生成，每次都一样。只为教学，公司、门店、客户、数字全是编的。
 *   Datasets.get(id) → CSV 文本；Datasets.LIST 说明每份数据。
 */
(function (root) {
  'use strict';
  var ML = (root.ABB && root.ABB.ML) || require('./ml.js');

  function gen(seed) {
    var r = ML.rng(seed);
    return {
      u: r,
      n: function (mu, sd) { var a = r() || 1e-9, b = r(); return mu + sd * Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); },
      pick: function (arr, w) { if (!w) return arr[Math.floor(r() * arr.length)]; var s = w.reduce(function (a, b) { return a + b; }, 0), x = r() * s; for (var i = 0; i < arr.length; i++) { if ((x -= w[i]) < 0) return arr[i]; } return arr[arr.length - 1]; },
      int: function (a, b) { return a + Math.floor(r() * (b - a + 1)); }
    };
  }
  function csv(cols, rows) { return ML.toCSV({ cols: cols, rows: rows }); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function sig(x) { return 1 / (1 + Math.exp(-x)); }

  // ---------------- 连锁餐饮：每店每天卖多少份招牌套餐（预测数字） ----------------
  var DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var TYPES = ['商场', '社区', '写字楼'];
  function sales(g, withY, n, prefix) {
    var rows = [];
    for (var i = 0; i < n; i++) {
      var type = g.pick(TYPES, [4, 4, 3]), day = g.pick(DAYS), wk = day === '周六' || day === '周日', hol = g.u() < (wk ? 0.15 : 0.06) ? '是' : '否';
      var temp = Math.round(g.n(19, 8)), rain = g.u() < 0.22 ? '是' : '否';
      var y = { 商场: 175, 社区: 120, 写字楼: 150 }[type];
      if (wk) y += { 商场: 70, 社区: 25, 写字楼: -75 }[type];
      if (hol === '是') y += type === '写字楼' ? -40 : 55;
      if (rain === '是') y -= { 商场: 8, 社区: 30, 写字楼: 18 }[type];
      y -= 0.9 * Math.abs(temp - 22);
      y = Math.max(15, Math.round(y + g.n(0, 11)));
      var yest = Math.max(10, Math.round(y * (wk ? 0.82 : 0.97) + g.n(0, 18)));
      var row = [prefix + pad(g.int(1, 50), 2), type, day, hol, temp, rain, yest];
      if (withY) row.push(y);
      rows.push(row);
    }
    return rows;
  }

  // ---------------- 工厂质检：每个零件合格还是有缺陷（分类） ----------------
  function parts(g, withY, n, batch) {
    var rows = [];
    for (var i = 0; i < n; i++) {
      var sup = g.pick(['甲厂', '乙厂', '丙厂'], [5, 3, 2]), shift = g.pick(['早班', '中班', '夜班'], [4, 3, 3]);
      var temp = Math.round(g.n(850, 14)), hold = Math.round(g.n(42, 5)), len = +g.n(0, 0.035).toFixed(3), rough = +Math.max(0.4, g.n(1.25, 0.32)).toFixed(2);
      var risk = 0.3 * Math.abs(temp - 850) + 9 * Math.max(0, rough - 1.4) + (sup === '丙厂' ? 2.6 : 0) + (shift === '夜班' ? 1.8 : 0) + 160 * Math.max(0, Math.abs(len) - 0.035) + 0.2 * Math.max(0, 38 - hold) - 7.5;
      var row = [batch + '-' + pad(i + 1, 3), sup, shift, temp, hold, len, rough];
      if (withY) row.push(g.u() < sig(risk) ? '缺陷' : '合格');
      rows.push(row);
    }
    return rows;
  }

  // ---------------- 客服中心：哪些客户下个月可能不续费（分类）；也可以不看答案分群 ----------------
  var SUR = '王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗'.split(''), GIV = '伟芳娜敏静丽强磊军洋勇艳杰涛明超秀霞平刚桂英'.split('');
  function customers(g, withY, n, start) {
    var rows = [];
    for (var i = 0; i < n; i++) {
      var plan = g.pick(['基础', '标准', '高级'], [5, 3, 2]), months = g.int(1, 60), calls = Math.max(0, Math.round(g.n(1.6, 1.4))), sat = Math.max(1, Math.min(5, Math.round(g.n(3.8, 1))));
      var open = g.u() < 0.18 + 0.05 * calls ? '是' : '否', spend = Math.round({ 基础: 39, 标准: 79, 高级: 159 }[plan] + g.n(0, 12));
      var p = sig(2.2 * (-0.9 + 0.6 * calls - 0.04 * months - 0.8 * (sat - 3.5) + (open === '是' ? 1.4 : 0) + (plan === '基础' ? 0.4 : plan === '高级' ? -0.5 : 0)));
      var phone = '1' + g.pick(['38', '39', '58', '86', '37']) + pad(g.int(0, 99999999), 8);
      var row = ['K' + pad(start + i, 5), g.pick(SUR) + g.pick(GIV) + (g.u() < 0.5 ? g.pick(GIV) : ''), phone, plan, months, spend, calls, sat, open];
      if (withY) row.push(g.u() < p ? '是' : '否');
      rows.push(row);
    }
    return rows;
  }

  var C_SALES = ['门店', '门店类型', '星期', '节假日', '气温', '下雨', '昨日销量'];
  var C_PARTS = ['零件编号', '供应商', '班次', '炉温', '保温分钟', '长度偏差', '表面粗糙度'];
  var C_CUST = ['客户编号', '姓名', '手机号', '套餐', '会员月数', '月消费', '近30天来电', '上次满意度', '有未解决工单'];

  var LIST = {
    sales:      { name: '销售流水（近一年）', note: '每行 = 一家店一天。「销量」是答案（标签）。', make: function () { return csv(C_SALES.concat(['销量']), sales(gen(11), true, 420, 'A')); } },
    sales_new:  { name: '明天各门店的情况', note: '没有「销量」：正等着模型预测。', make: function () { return csv(C_SALES, sales(gen(12), false, 24, 'A')); } },
    sales_new2: { name: '后天各门店的情况', note: '换一份新数据再运行：模型不变，只重新预测。', make: function () { return csv(C_SALES, sales(gen(13), false, 24, 'A')); } },
    parts:      { name: '历史质检记录', note: '每行 = 一个零件。「结果」是答案（标签）。', make: function () { return csv(C_PARTS.concat(['结果']), parts(gen(21), true, 480, 'B0901')); } },
    parts_new:  { name: '今天这批零件', note: '刚下线，还没人工检验。', make: function () { return csv(C_PARTS, parts(gen(22), false, 30, 'B1106')); } },
    cust:       { name: '客户档案 + 是否流失', note: '每行 = 一个客户。「是否流失」是答案（标签）。姓名、手机号是编的，但演示时当真的敏感信息对待。', make: function () { return csv(C_CUST.concat(['是否流失']), customers(gen(31), true, 450, 1)); } },
    cust_new:   { name: '本月客户', note: '下个月会不会走，还不知道。', make: function () { return csv(C_CUST, customers(gen(32), false, 30, 2001)); } }
  };
  var cache = {};
  function get(id) { if (!LIST[id]) return ''; return cache[id] || (cache[id] = LIST[id].make()); }

  root.ABB = root.ABB || {};
  root.ABB.Datasets = { LIST: LIST, get: get };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.Datasets;
})(typeof window !== 'undefined' ? window : globalThis);
