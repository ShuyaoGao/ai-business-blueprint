/* 浏览器里真的能跑的机器学习：读 CSV、字段编码、8 种算法（训练 / 预测 / 评估）。纯函数，Node 可测，不依赖任何库。
 *
 * 数据表 ds = { cols: [列名], rows: [[值]] }，值是数字、字符串或 null（缺数）。
 * 模型 = 普通对象，可以 JSON 存盘再读回来接着用：{ algo, task, target, features, enc, ... }
 */
(function (root) {
  'use strict';
  var MAX_ROWS = 20000, MAX_COLS = 60;

  // ---------------- CSV ----------------
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = [',', '\t', ';'].reduce(function (best, d) { return first.split(d).length > first.split(best).length ? d : best; }, ',');
    var rows = [], row = [], cell = '', q = false, i = 0, L = text.length;
    for (; i < L; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = ''; if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row); row = [];
        if (rows.length > MAX_ROWS + 1) break;
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row); }
    if (!rows.length) throw new Error('CSV 是空的');
    var cols = rows[0].map(function (c, j) { return c.trim() || ('列' + (j + 1)); }).slice(0, MAX_COLS);
    var seen = {}; cols = cols.map(function (c) { var n = c, k = 2; while (seen[n]) n = c + '_' + k++; seen[n] = 1; return n; });
    var body = rows.slice(1, MAX_ROWS + 1).map(function (r) { return cols.map(function (_, j) { var v = r[j] == null ? '' : r[j].trim(); return v === '' ? null : v; }); });
    // 整列都能读成数字的，转成数字
    cols.forEach(function (_, j) {
      var allNum = body.every(function (r) { return r[j] == null || isFinite(+r[j]); }) && body.some(function (r) { return r[j] != null; });
      if (allNum) body.forEach(function (r) { if (r[j] != null) r[j] = +r[j]; });
    });
    return { cols: cols, rows: body };
  }
  function csvCell(v) { if (v == null) return ''; var s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCSV(ds) { return [ds.cols.map(csvCell).join(',')].concat(ds.rows.map(function (r) { return r.map(csvCell).join(','); })).join('\n') + '\n'; }

  function colIndex(ds, name) { return ds.cols.indexOf(name); }
  function isNumCol(ds, j) { var any = false; for (var i = 0; i < ds.rows.length; i++) { var v = ds.rows[i][j]; if (v == null) continue; if (typeof v !== 'number') return false; any = true; } return any; }
  function colTypes(ds) { return ds.cols.map(function (_, j) { return isNumCol(ds, j) ? 'num' : 'cat'; }); }
  /** 看起来像编号、姓名、手机号的列：几乎每行都不一样，拿来训练只会让模型死记硬背。 */
  function idLike(ds, j) {
    var n = ds.rows.length, u = uniq(ds, j).length;
    if (n < 30) return false;
    if (!isNumCol(ds, j)) return u > 20 && u > 0.5 * n;
    return u > 0.9 * n && ds.rows.every(function (r) { return r[j] == null || r[j] === Math.round(r[j]); });
  }
  function uniq(ds, j) { var s = {}; ds.rows.forEach(function (r) { if (r[j] != null) s[r[j]] = 1; }); return Object.keys(s); }

  // ---------------- 随机数（可复现） ----------------
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(arr, rand) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }

  // ---------------- 数据准备 ----------------
  function select(ds, keepCols) {
    var idx = keepCols.map(function (c) { return ds.cols.indexOf(c); }).filter(function (j) { return j >= 0; });
    return { cols: idx.map(function (j) { return ds.cols[j]; }), rows: ds.rows.map(function (r) { return idx.map(function (j) { return r[j]; }); }) };
  }
  function dropCols(ds, names) { return select(ds, ds.cols.filter(function (c) { return names.indexOf(c) < 0; })); }
  function clean(ds, opt) {
    var rows = ds.rows, before = rows.length;
    if (opt.dropna) rows = rows.filter(function (r) { return r.every(function (v) { return v != null; }); });
    var na = before - rows.length, dup = 0;
    if (opt.dedupe) { var seen = {}; rows = rows.filter(function (r) { var k = JSON.stringify(r); if (seen[k]) { dup++; return false; } seen[k] = 1; return true; }); }
    return { ds: { cols: ds.cols.slice(), rows: rows }, removedNA: na, removedDup: dup };
  }
  function split(ds, ratio, seed) {
    var idx = ds.rows.map(function (_, i) { return i; }); shuffle(idx, rng(seed || 42));
    var n = Math.round(ds.rows.length * ratio);
    return { train: { cols: ds.cols.slice(), rows: idx.slice(0, n).map(function (i) { return ds.rows[i]; }) },
      test: { cols: ds.cols.slice(), rows: idx.slice(n).map(function (i) { return ds.rows[i]; }) } };
  }
  function concat(a, b) {
    if (a.cols.join('|') !== b.cols.join('|')) {
      var cols = a.cols.filter(function (c) { return b.cols.indexOf(c) >= 0; });
      if (!cols.length) throw new Error('两份数据没有相同的列，合并不了');
      a = select(a, cols); b = select(b, cols);
    }
    return { cols: a.cols.slice(), rows: a.rows.concat(b.rows) };
  }
  var OPF = { '>': function (a, b) { return a > b; }, '>=': function (a, b) { return a >= b; }, '<': function (a, b) { return a < b; }, '<=': function (a, b) { return a <= b; },
    '=': function (a, b) { return a == b; }, '!=': function (a, b) { return a != b; } }; // eslint-disable-line eqeqeq
  function filter(ds, col, op, val) {
    var j = ds.cols.indexOf(col); if (j < 0) throw new Error('数据里没有「' + col + '」这一列');
    var num = isNumCol(ds, j), v = num && val !== '' && isFinite(+val) ? +val : String(val), f = OPF[op] || OPF['='];
    var yes = [], no = [];
    ds.rows.forEach(function (r) { (r[j] != null && f(num ? r[j] : String(r[j]), v) ? yes : no).push(r); });
    return { yes: { cols: ds.cols.slice(), rows: yes }, no: { cols: ds.cols.slice(), rows: no } };
  }

  // ---------------- 字段编码：数字标准化、分类做 one-hot ----------------
  function makeEncoder(ds, feats) {
    var parts = feats.map(function (name) {
      var j = ds.cols.indexOf(name), num = isNumCol(ds, j);
      if (num) {
        var vals = ds.rows.map(function (r) { return r[j]; }).filter(function (v) { return v != null; });
        var mean = vals.reduce(function (a, b) { return a + b; }, 0) / (vals.length || 1);
        var sd = Math.sqrt(vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (vals.length || 1)) || 1;
        return { name: name, kind: 'num', mean: mean, sd: sd };
      }
      var cnt = {}; ds.rows.forEach(function (r) { if (r[j] != null) cnt[r[j]] = (cnt[r[j]] || 0) + 1; });
      var vocab = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 30);
      return { name: name, kind: 'cat', vocab: vocab };
    });
    var dims = [], owner = [];
    parts.forEach(function (p, pi) { if (p.kind === 'num') { dims.push(p.name); owner.push(pi); } else p.vocab.forEach(function (v) { dims.push(p.name + '=' + v); owner.push(pi); }); });
    return { parts: parts, dims: dims, owner: owner };
  }
  function encodeRows(enc, ds) {
    var idx = enc.parts.map(function (p) { return ds.cols.indexOf(p.name); });
    var missing = enc.parts.filter(function (p, i) { return idx[i] < 0; }).map(function (p) { return p.name; });
    if (missing.length * 2 > enc.parts.length) throw new Error('数据缺少模型要用的字段：' + missing.join('、'));
    return ds.rows.map(function (r) {
      var x = [];
      enc.parts.forEach(function (p, i) {
        var v = idx[i] < 0 ? null : r[idx[i]];
        if (p.kind === 'num') x.push(v == null || typeof v !== 'number' ? 0 : (v - p.mean) / p.sd);
        else p.vocab.forEach(function (w) { x.push(v != null && String(v) === w ? 1 : 0); });
      });
      return x;
    });
  }

  // ---------------- 线性代数 ----------------
  function solve(A, b) {
    var n = b.length, M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      if (Math.abs(M[c][c]) < 1e-12) continue;
      for (r = 0; r < n; r++) { if (r === c) continue; var f = M[r][c] / M[c][c]; if (!f) continue; for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map(function (row, i) { return Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]; });
  }

  // ---------------- 各算法 ----------------
  function fitLinreg(X, y) {
    var d = X[0].length + 1, A = [], b = [], i, j, k, lam = 1e-3 * X.length;
    for (i = 0; i < d; i++) { A.push(new Array(d).fill(0)); b.push(0); }
    X.forEach(function (x, r) {
      var z = [1].concat(x);
      for (j = 0; j < d; j++) { b[j] += z[j] * y[r]; for (k = j; k < d; k++) A[j][k] += z[j] * z[k]; }
    });
    for (j = 0; j < d; j++) { for (k = 0; k < j; k++) A[j][k] = A[k][j]; if (j) A[j][j] += lam; }
    var w = solve(A, b);
    return { b0: w[0], w: w.slice(1) };
  }
  function linregPredict(m, x) { var s = m.b0; for (var j = 0; j < x.length; j++) s += m.w[j] * x[j]; return s; }

  function softmax(z) { var mx = Math.max.apply(null, z), e = z.map(function (v) { return Math.exp(v - mx); }), s = e.reduce(function (a, b) { return a + b; }, 0); return e.map(function (v) { return v / s; }); }
  function fitLogreg(X, yi, K) {
    var d = X[0].length, W = [], n = X.length, it, lr = 0.5, lam = 1e-3;
    for (var c = 0; c < K; c++) W.push(new Array(d + 1).fill(0));
    for (it = 0; it < 300; it++) {
      var G = W.map(function () { return new Array(d + 1).fill(0); });
      for (var r = 0; r < n; r++) {
        var x = X[r], p = softmax(W.map(function (w) { var s = w[0]; for (var j = 0; j < d; j++) s += w[j + 1] * x[j]; return s; }));
        for (c = 0; c < K; c++) { var g = p[c] - (yi[r] === c ? 1 : 0); G[c][0] += g; for (var j = 0; j < d; j++) G[c][j + 1] += g * x[j]; }
      }
      for (c = 0; c < K; c++) for (var q = 0; q <= d; q++) W[c][q] -= lr * (G[c][q] / n + (q ? lam * W[c][q] : 0));
    }
    return { W: W };
  }
  function logregProba(m, x) { return softmax(m.W.map(function (w) { var s = w[0]; for (var j = 0; j < x.length; j++) s += w[j + 1] * x[j]; return s; })); }

  // 决策树（CART）：分类用 Gini，预测数字用方差；每个特征只试最多 12 个分位点，够用也够快
  function buildTree(X, y, idx, opt, imp, rand) {
    var reg = opt.reg, K = opt.K;
    function leaf(ids) {
      if (reg) { var s = 0; ids.forEach(function (i) { s += y[i]; }); return { v: s / (ids.length || 1), n: ids.length }; }
      var c = new Array(K).fill(0); ids.forEach(function (i) { c[y[i]]++; }); return { p: c.map(function (v) { return v / (ids.length || 1); }), n: ids.length };
    }
    function impurity(ids) {
      if (reg) { var s = 0, s2 = 0; ids.forEach(function (i) { s += y[i]; s2 += y[i] * y[i]; }); return s2 - s * s / (ids.length || 1); }
      var c = new Array(K).fill(0); ids.forEach(function (i) { c[y[i]]++; }); var g = 1; c.forEach(function (v) { var p = v / ids.length; g -= p * p; }); return g * ids.length;
    }
    function grow(ids, depth) {
      var base = impurity(ids);
      if (depth >= opt.maxDepth || ids.length < 2 * opt.minLeaf || base < 1e-9) return leaf(ids);
      var d = X[0].length, feats = [];
      for (var f = 0; f < d; f++) feats.push(f);
      if (opt.mtry && opt.mtry < d) feats = shuffle(feats, rand).slice(0, opt.mtry);
      var best = null;
      feats.forEach(function (f) {
        var vals = ids.map(function (i) { return X[i][f]; }).sort(function (a, b) { return a - b; });
        var cands = {}; for (var q = 1; q < 13; q++) { var v = vals[Math.floor(vals.length * q / 13)]; cands[v] = 1; }
        Object.keys(cands).forEach(function (ts) {
          var t = +ts, L = [], R = [];
          ids.forEach(function (i) { (X[i][f] <= t ? L : R).push(i); });
          if (L.length < opt.minLeaf || R.length < opt.minLeaf) return;
          var gain = base - impurity(L) - impurity(R);
          if (!best || gain > best.gain) best = { f: f, t: t, L: L, R: R, gain: gain };
        });
      });
      if (!best || best.gain <= 1e-9) return leaf(ids);
      imp[best.f] += best.gain;
      return { f: best.f, t: best.t, l: grow(best.L, depth + 1), r: grow(best.R, depth + 1), n: ids.length };
    }
    return grow(idx, 0);
  }
  function treeLeaf(node, x) { while (node.f != null) node = x[node.f] <= node.t ? node.l : node.r; return node; }
  function treeDepth(node) { return node.f == null ? 0 : 1 + Math.max(treeDepth(node.l), treeDepth(node.r)); }
  function roundTree(node) { if (node.f == null) { if (node.v != null) node.v = +node.v.toFixed(4); if (node.p) node.p = node.p.map(function (v) { return +v.toFixed(4); }); return node; } node.t = +node.t.toFixed(5); roundTree(node.l); roundTree(node.r); return node; }

  function fitKmeans(X, k, seed) {
    var rand = rng(seed || 7), n = X.length, d = X[0].length, C = [X[Math.floor(rand() * n)].slice()];
    function dist2(a, b) { var s = 0; for (var j = 0; j < d; j++) { var t = a[j] - b[j]; s += t * t; } return s; }
    while (C.length < k) { // k-means++
      var D = X.map(function (x) { return Math.min.apply(null, C.map(function (c) { return dist2(x, c); })); }), tot = D.reduce(function (a, b) { return a + b; }, 0), r = rand() * tot, i = 0;
      while (i < n - 1 && (r -= D[i]) > 0) i++;
      C.push(X[i].slice());
    }
    var lab = new Array(n).fill(0);
    for (var it = 0; it < 60; it++) {
      var moved = false;
      X.forEach(function (x, i) { var b = 0, bd = Infinity; C.forEach(function (c, ci) { var dd = dist2(x, c); if (dd < bd) { bd = dd; b = ci; } }); if (lab[i] !== b) { lab[i] = b; moved = true; } });
      C = C.map(function (c, ci) { var s = new Array(d).fill(0), m = 0; X.forEach(function (x, i) { if (lab[i] === ci) { m++; for (var j = 0; j < d; j++) s[j] += x[j]; } }); return m ? s.map(function (v) { return v / m; }) : c; });
      if (!moved && it) break;
    }
    var inertia = 0; X.forEach(function (x, i) { inertia += dist2(x, C[lab[i]]); });
    return { C: C, lab: lab, inertia: inertia };
  }
  function nearest(C, x) { var b = 0, bd = Infinity; C.forEach(function (c, ci) { var s = 0; for (var j = 0; j < x.length; j++) { var t = x[j] - c[j]; s += t * t; } if (s < bd) { bd = s; b = ci; } }); return b; }

  // ---------------- 训练入口 ----------------
  var ALGO_NAMES = { linreg: '线性回归', logreg: '逻辑回归', tree: '决策树', forest: '随机森林', knn: 'K 近邻', nb: '朴素贝叶斯', kmeans: 'K-means 聚类', anomaly: '异常检测' };
  var SUP = { linreg: 1, logreg: 1, tree: 1, forest: 1, knn: 1, nb: 1 };

  /** 训练。opt = { algo, target, k, seed, features（可选，默认除标签以外的所有列） }。 */
  function train(ds, opt) {
    var algo = opt.algo;
    if (!ALGO_NAMES[algo]) throw new Error(algo ? '这个算法浏览器里跑不了，换一个（比如随机森林）' : '还没选算法');
    if (!ds.rows.length) throw new Error('训练数据是空的');
    var sup = !!SUP[algo], target = opt.target || '', tj = target ? ds.cols.indexOf(target) : -1;
    if (sup && !target) throw new Error('监督学习要指定标签列（要预测的那一列）');
    if (sup && tj < 0) throw new Error('数据里没有标签列「' + target + '」');
    var exclude = (opt.exclude || []).concat([target]);
    var rows = sup ? ds.rows.filter(function (r) { return r[tj] != null; }) : ds.rows;
    if (rows.length < 10) throw new Error('有效数据太少（' + rows.length + ' 行），至少要 10 行');
    var data = { cols: ds.cols, rows: rows }, dropped = [];
    var feats = (opt.features && opt.features.length ? opt.features : ds.cols).filter(function (c) {
      var j = ds.cols.indexOf(c); if (j < 0 || exclude.indexOf(c) >= 0) return false;
      if (idLike(data, j)) { dropped.push(c); return false; }
      return true;
    });
    if (!feats.length) throw new Error('除了标签和编号以外没有别的字段可以用');
    var enc = makeEncoder(data, feats), X = encodeRows(enc, data);
    var m = { algo: algo, algoName: ALGO_NAMES[algo], target: sup ? target : '', features: feats, dropped: dropped, enc: enc, rows: rows.length };
    var imp = new Array(enc.dims.length).fill(0), task;
    // 线性模型的系数要乘上这一维的标准差，才能比较「这个字段影响多大」（one-hot 的维度标准差小于 1）
    var dsd = enc.dims.map(function (_, j) { var mu = 0; X.forEach(function (x) { mu += x[j] / X.length; }); var v = 0; X.forEach(function (x) { v += (x[j] - mu) * (x[j] - mu) / X.length; }); return Math.sqrt(v); });
    if (sup) {
      var numT = isNumCol(data, tj), nu = uniq(data, tj).length;
      task = algo === 'linreg' ? 'reg' : (algo === 'logreg' || algo === 'nb') ? 'clf' : (numT && nu > 10 ? 'reg' : 'clf');
      if (task === 'reg' && !numT) throw new Error('线性回归只能预测数字，「' + target + '」不是数字；换逻辑回归或决策树做分类');
      if (task === 'clf' && nu > 30) throw new Error('「' + target + '」有 ' + nu + ' 种不同的值，太多了，不像分类；它是数字的话换线性回归或随机森林');
      m.task = task;
      var y, yi, classes;
      if (task === 'reg') { y = rows.map(function (r) { return +r[tj]; }); var ym = y.reduce(function (a, b) { return a + b; }, 0) / y.length; m.yMean = ym; }
      else { classes = uniq(data, tj).sort(); m.classes = classes; yi = rows.map(function (r) { return classes.indexOf(String(r[tj])); }); }
      var rand = rng(opt.seed || 42), all = X.map(function (_, i) { return i; });
      if (algo === 'linreg') { var lr = fitLinreg(X, y); m.b0 = lr.b0; m.w = lr.w; m.w.forEach(function (w, j) { imp[j] = Math.abs(w) * dsd[j]; }); }
      else if (algo === 'logreg') { m.W = fitLogreg(X, yi, classes.length).W; for (var j = 0; j < enc.dims.length; j++) m.W.forEach(function (w) { imp[j] += Math.abs(w[j + 1]) * dsd[j]; }); }
      else if (algo === 'tree') { m.tree = roundTree(buildTree(X, task === 'reg' ? y : yi, all, { reg: task === 'reg', K: classes ? classes.length : 0, maxDepth: 6, minLeaf: 5 }, imp, rand)); m.depth = treeDepth(m.tree); }
      else if (algo === 'forest') {
        m.trees = [];
        for (var t = 0; t < 20; t++) {
          var boot = all.map(function () { return all[Math.floor(rand() * all.length)]; });
          m.trees.push(roundTree(buildTree(X, task === 'reg' ? y : yi, boot, { reg: task === 'reg', K: classes ? classes.length : 0, maxDepth: 7, minLeaf: 4, mtry: Math.max(1, Math.round(Math.sqrt(X[0].length) + 1)) }, imp, rand)));
        }
      }
      else if (algo === 'knn') {
        var keep = all.slice(); if (keep.length > 3000) keep = shuffle(keep, rand).slice(0, 3000);
        m.k = 5; m.X = keep.map(function (i) { return X[i].map(function (v) { return +v.toFixed(4); }); }); m.y = keep.map(function (i) { return task === 'reg' ? y[i] : yi[i]; });
      }
      else if (algo === 'nb') {
        var d = X[0].length;
        m.prior = []; m.mu = []; m.var = [];
        classes.forEach(function (_, c) {
          var ids = all.filter(function (i) { return yi[i] === c; }), mu = new Array(d).fill(0), va = new Array(d).fill(0);
          ids.forEach(function (i) { for (var q = 0; q < d; q++) mu[q] += X[i][q] / ids.length; });
          ids.forEach(function (i) { for (var q = 0; q < d; q++) va[q] += (X[i][q] - mu[q]) * (X[i][q] - mu[q]) / ids.length; });
          m.prior.push(ids.length / all.length); m.mu.push(mu); m.var.push(va.map(function (v) { return v + 1e-2; }));
          for (var q = 0; q < d; q++) imp[q] += Math.abs(mu[q]) * dsd[q];
        });
      }
    } else if (algo === 'kmeans') {
      m.task = 'cluster'; m.k = Math.max(2, Math.min(10, opt.k || 3));
      if (rows.length < m.k * 3) throw new Error('数据太少，分不了 ' + m.k + ' 群');
      var km = fitKmeans(X, m.k, opt.seed || 7); m.C = km.C.map(function (c) { return c.map(function (v) { return +v.toFixed(4); }); }); m.inertia = km.inertia;
      m.sizes = new Array(m.k).fill(0); km.lab.forEach(function (l) { m.sizes[l]++; });
      m.profile = profile(data, km.lab, m.k, feats);
    } else if (algo === 'anomaly') {
      m.task = 'anomaly';
      var nums = []; enc.parts.forEach(function (p, pi) { if (p.kind === 'num') nums.push(enc.owner.indexOf(pi)); });
      if (!nums.length) throw new Error('异常检测要至少一个数字字段');
      m.numDims = nums;
      var sc = X.map(function (x) { return zscore(m, x); }).sort(function (a, b) { return a - b; });
      m.threshold = +sc[Math.min(sc.length - 1, Math.floor(sc.length * 0.975))].toFixed(4);
    }
    // 字段重要性：一个原始字段可能拆成好几维（one-hot），加回到原字段上
    var byF = {}; enc.owner.forEach(function (pi, j) { var nm = enc.parts[pi].name; byF[nm] = (byF[nm] || 0) + imp[j]; });
    var tot = Object.keys(byF).reduce(function (a, k) { return a + byF[k]; }, 0);
    m.importance = tot > 0 ? Object.keys(byF).map(function (k) { return { name: k, v: +(byF[k] / tot).toFixed(3) }; }).sort(function (a, b) { return b.v - a.v; }) : [];
    return m;
  }
  function zscore(m, x) { var s = 0; m.numDims.forEach(function (j) { s += x[j] * x[j]; }); return Math.sqrt(s / m.numDims.length); }
  function profile(ds, lab, k, feats) {
    return Array.from({ length: k }, function (_, c) {
      var rows = ds.rows.filter(function (_, i) { return lab[i] === c; }), out = {};
      feats.forEach(function (f) {
        var j = ds.cols.indexOf(f);
        if (isNumCol(ds, j)) { var v = rows.map(function (r) { return r[j]; }).filter(function (x) { return x != null; }); out[f] = v.length ? +(v.reduce(function (a, b) { return a + b; }, 0) / v.length).toFixed(2) : null; }
        else { var cnt = {}; rows.forEach(function (r) { if (r[j] != null) cnt[r[j]] = (cnt[r[j]] || 0) + 1; }); var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0]; out[f] = top == null ? null : top; }
      });
      return out;
    });
  }

  // ---------------- 预测 ----------------
  /** 一行一行算：返回 [{ y（数字或类别）, p（把握 0–1，可选）}]。 */
  function predictRaw(m, ds) {
    var X = encodeRows(m.enc, ds);
    return X.map(function (x) {
      switch (m.algo) {
        case 'linreg': return { y: linregPredict(m, x) };
        case 'logreg': return cls(m, logregProba(m, x));
        case 'tree': var lf = treeLeaf(m.tree, x); return m.task === 'reg' ? { y: lf.v } : cls(m, lf.p);
        case 'forest':
          if (m.task === 'reg') { var s = 0; m.trees.forEach(function (t) { s += treeLeaf(t, x).v; }); return { y: s / m.trees.length }; }
          var acc = new Array(m.classes.length).fill(0); m.trees.forEach(function (t) { treeLeaf(t, x).p.forEach(function (v, c) { acc[c] += v / m.trees.length; }); }); return cls(m, acc);
        case 'knn':
          var dd = m.X.map(function (z, i) { var s2 = 0; for (var j = 0; j < x.length; j++) { var t2 = x[j] - z[j]; s2 += t2 * t2; } return [s2, i]; }).sort(function (a, b) { return a[0] - b[0]; }).slice(0, m.k);
          if (m.task === 'reg') return { y: dd.reduce(function (a, b) { return a + m.y[b[1]]; }, 0) / dd.length };
          var votes = new Array(m.classes.length).fill(0); dd.forEach(function (b) { votes[m.y[b[1]]] += 1 / dd.length; }); return cls(m, votes);
        case 'nb':
          var lp = m.prior.map(function (pr, c) { var s3 = Math.log(pr); for (var j = 0; j < x.length; j++) { var v = m.var[c][j], t3 = x[j] - m.mu[c][j]; s3 += -0.5 * Math.log(2 * Math.PI * v) - t3 * t3 / (2 * v); } return s3; });
          return cls(m, softmax(lp));
        case 'kmeans': return { y: '第 ' + (nearest(m.C, x) + 1) + ' 群' };
        case 'anomaly': var z = zscore(m, x); return { y: z > m.threshold ? '异常' : '正常', score: z };
      }
      throw new Error('不认识的模型');
    });
  }
  function cls(m, p) { var b = 0; p.forEach(function (v, c) { if (v > p[b]) b = c; }); return { y: m.classes[b], p: p[b] }; }
  function round(v) { return Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(2); }

  /** 把预测结果作为新列加到表的右边。 */
  function predict(m, ds) {
    var out = predictRaw(m, ds), cols = ds.cols.slice(), add;
    if (m.task === 'reg') { add = ['预测_' + m.target]; }
    else if (m.task === 'clf') { add = ['预测_' + m.target, '把握']; }
    else if (m.task === 'cluster') { add = ['分群']; }
    else { add = ['异常分数', '是否异常']; }
    return { cols: cols.concat(add), rows: ds.rows.map(function (r, i) {
      var o = out[i];
      if (m.task === 'reg') return r.concat([round(o.y)]);
      if (m.task === 'clf') return r.concat([o.y, +o.p.toFixed(2)]);
      if (m.task === 'cluster') return r.concat([o.y]);
      return r.concat([+o.score.toFixed(2), o.y]);
    }) };
  }

  // ---------------- 评估 ----------------
  function evaluate(m, ds) {
    if (m.task === 'cluster') { var lab = predictRaw(m, ds), sz = {}; lab.forEach(function (o) { sz[o.y] = (sz[o.y] || 0) + 1; }); return { task: 'cluster', n: ds.rows.length, sizes: sz, profile: m.profile }; }
    if (m.task === 'anomaly') { var an = predictRaw(m, ds).filter(function (o) { return o.y === '异常'; }).length; return { task: 'anomaly', n: ds.rows.length, flagged: an, rate: +(an / (ds.rows.length || 1)).toFixed(3) }; }
    var tj = ds.cols.indexOf(m.target);
    if (tj < 0) throw new Error('测试集里没有标签列「' + m.target + '」，没法打分');
    var rows = ds.rows.filter(function (r) { return r[tj] != null; });
    if (!rows.length) throw new Error('测试集是空的');
    var d2 = { cols: ds.cols, rows: rows }, out = predictRaw(m, d2);
    if (m.task === 'reg') {
      var y = rows.map(function (r) { return +r[tj]; }), mean = y.reduce(function (a, b) { return a + b; }, 0) / y.length, ae = 0, se = 0, st = 0;
      y.forEach(function (v, i) { var e = out[i].y - v; ae += Math.abs(e); se += e * e; st += (v - mean) * (v - mean); });
      return { task: 'reg', n: y.length, mae: +(ae / y.length).toFixed(3), rmse: +Math.sqrt(se / y.length).toFixed(3), r2: +(st ? 1 - se / st : 0).toFixed(3), mean: +mean.toFixed(3),
        sample: rows.slice(0, 8).map(function (r, i) { return { truth: y[i], pred: round(out[i].y) }; }) };
    }
    var K = m.classes, cm = K.map(function () { return K.map(function () { return 0; }); }), right = 0, cnt = {};
    rows.forEach(function (r, i) { var t = String(r[tj]), p = String(out[i].y), a = K.indexOf(t), b = K.indexOf(p); cnt[t] = (cnt[t] || 0) + 1; if (t === p) right++; if (a >= 0 && b >= 0) cm[a][b]++; });
    var major = Object.keys(cnt).reduce(function (a, k) { return Math.max(a, cnt[k]); }, 0);
    return { task: 'clf', n: rows.length, accuracy: +(right / rows.length).toFixed(3), baseline: +(major / rows.length).toFixed(3), classes: K, confusion: cm };
  }

  root.ABB = root.ABB || {};
  /** 新数据里缺了哪些模型要用的字段（缺的按平均值 / 「未知」算）。 */
  function missingFields(m, ds) { return m.features.filter(function (f) { return ds.cols.indexOf(f) < 0; }); }

  root.ABB.ML = { missingFields: missingFields, idLike: idLike, parseCSV: parseCSV, toCSV: toCSV, colTypes: colTypes, colIndex: colIndex, uniq: uniq, rng: rng, select: select, dropCols: dropCols, clean: clean, split: split, concat: concat, filter: filter,
    makeEncoder: makeEncoder, encodeRows: encodeRows, train: train, predict: predict, evaluate: evaluate, ALGO_NAMES: ALGO_NAMES, MAX_ROWS: MAX_ROWS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ABB.ML;
})(typeof window !== 'undefined' ? window : globalThis);
