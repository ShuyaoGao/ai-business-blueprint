/* 浏览器验收 + 截图：用 Playwright 驱动 Chromium，打开 file:// 下的 play/index.html。
 *   node tools/browser_check.js            跑全部尺寸 × 深浅色，写 results/browser_check.json
 *   node tools/browser_check.js --shots    另外重新生成 docs/img/ 的截图
 * 需要：Node.js + playwright（npm i playwright，再 npx playwright install chromium）。
 * 用本机已装的 Chrome / Edge：BROWSER_CHANNEL=chrome node tools/browser_check.js（只装 playwright-core 也行）。
 */
'use strict';
const path = require('path'), fs = require('fs');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const { chromium } = pw;
const ROOT = path.join(__dirname, '..');
const URL0 = 'file://' + path.join(ROOT, 'play', 'index.html').replace(/\\/g, '/');
const SHOTS = process.argv.includes('--shots');
const SIZES = [
  { name: '手机 390×844', w: 390, h: 844, touch: true, dpr: 2 },
  { name: '手机 360×780', w: 360, h: 780, touch: true, dpr: 2 },
  { name: '平板 768×1024', w: 768, h: 1024, touch: true, dpr: 2 },
  { name: '电脑 1366×768', w: 1366, h: 768, touch: false, dpr: 1 },
  { name: '电脑 1920×1080', w: 1920, h: 1080, touch: false, dpr: 1 }
];
const SCHEMES = ['light', 'dark'];

async function newPage(browser, size, scheme) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: size.touch, hasTouch: size.touch, colorScheme: scheme, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  return { ctx, page };
}

/** 页面上看得见、能点的按钮和下拉框里最小的那个（画布里的 SVG 不算）。 */
async function smallestTarget(page) {
  return page.evaluate(() => {
    let min = null;
    document.querySelectorAll('button, select, input[type=checkbox], .rowbtn').forEach(el => {
      if (el.closest('#canvas') || el.closest('.modal') || el.closest('#exited') || el.closest('#rotate-hint')) return;
      if (el.type === 'checkbox') return;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || r.bottom < 0 || r.top > innerHeight) return;
      const v = Math.min(r.width, r.height);
      if (!min || v < min.v) min = { v: Math.round(v * 10) / 10, what: (el.id || el.textContent || el.tagName).trim().slice(0, 30) };
    });
    return min;
  });
}
/** 方框在屏幕上的位置（画布随时重画，不能拿旧的元素句柄）。 */
async function boxOf(page, id, stage) {
  await page.waitForTimeout(40);
  return page.evaluate(([id, stage]) => {
    const g = document.querySelector('[data-id="' + id + '"]'); if (!g) return null;
    const el = stage ? g.querySelector(':scope > .box') : g.querySelector('.box');
    const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, [id, !!stage]);
}
async function overflow(page) { return page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight })); }

/** 某个口的圆点在屏幕上的中心。key = '节点 id|ins 或 outs|口 id'。 */
async function portAt(page, key) {
  await page.waitForTimeout(40);
  return page.evaluate(k => { const g = document.querySelector('[data-port="' + k + '"]'); if (!g) return null; const c = g.querySelectorAll('circle'); const r = c[c.length - 1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, key);
}
/** 用 Pointer Events 从 (x0,y0) 拖到 (x1,y1)。 */
async function drag(page, x0, y0, x1, y1, touch) {
  await page.evaluate(([x0, y0, x1, y1, touch]) => {
    const svg = document.getElementById('canvas'), t = document.elementFromPoint(x0, y0);
    const ev = (type, x, y) => new PointerEvent(type, { pointerId: 7, pointerType: touch ? 'touch' : 'mouse', clientX: x, clientY: y, bubbles: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
    t.dispatchEvent(ev('pointerdown', x0, y0));
    for (let i = 1; i <= 8; i++) svg.dispatchEvent(ev('pointermove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8));
    svg.dispatchEvent(ev('pointerup', x1, y1));
  }, [x0, y0, x1, y1, touch]);
  await page.waitForTimeout(100);
}

async function checkSize(browser, size, scheme) {
  const { ctx, page } = await newPage(browser, size, scheme);
  const r = { size: size.name, scheme, checks: [] };
  const ck = (name, ok, detail) => r.checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  try {
    await page.goto(URL0 + '?nohelp=1');
    await page.waitForTimeout(400);
    let st = await page.evaluate(() => ABB.Watch.state());
    ck('默认打开观看模式并自动播放', st.playing && st.idx === 0, JSON.stringify(st));
    await page.evaluate(() => ABB.Watch.stop());
    let ov = await overflow(page); ck('观看：没有横向溢出', ov.x <= 0, ov.x);
    await page.click('#pl-next'); await page.click('#pl-next');
    st = await page.evaluate(() => ABB.Watch.state()); ck('观看：「下一步」按钮', st.step === 2, st.step);
    await page.evaluate(() => { ABB.Watch.go(6); ABB.Watch.stop(); });
    const ev = await page.evaluate(() => { const r = ABB.App.runResult(); return r && Object.values(r.nodes).some(x => x.metric && x.metric.r2 > 0.6); });
    ck('观看：讲到评估时真的运行，算出 R²', ev);

    // 我来画：从节点库加节点
    await page.click('[data-mode=draw]'); await page.waitForTimeout(150);
    await page.evaluate(() => ABB.App.newDraw(null));
    const add = async k => {
      if (size.touch) { await page.tap('#mb-add'); await page.tap('#palette-list [data-add=' + k + ']'); }
      else await page.click('#palette-list [data-add=' + k + ']');
      await page.waitForTimeout(80);
      return page.evaluate(() => ABB.S.sel.id);
    };
    const src = await add('src'); const sp = await add('split');
    let d = await page.evaluate(() => ABB.App.cur());
    ck('节点库：选中节点时，新节点自动接在后面', d.edges.length === 1 && d.edges[0].from === src && d.edges[0].to === sp, JSON.stringify(d.edges));
    ov = await overflow(page); ck('我来画：没有横向溢出、整页不滚动', ov.x <= 0 && ov.y <= 1, JSON.stringify(ov));

    // 口对口拖线：拆分的「训练集」→ 训练模型的输入口
    await page.evaluate(() => ABB.App.select(null));
    const tr = await add('train');
    await page.evaluate(([sp, tr]) => { const d = ABB.App.cur(); ABB.Model.moveTo(d, tr, ABB.Model.get(d, sp).x + 300, ABB.Model.get(d, sp).y + 160); ABB.App.canvas().fit(); }, [sp, tr]);
    await page.waitForTimeout(150);
    const p0 = await portAt(page, sp + '|outs|train'), p1 = await portAt(page, tr + '|ins|in');
    await drag(page, p0.x, p0.y, p1.x, p1.y, size.touch);
    d = await page.evaluate(() => ABB.App.cur());
    ck('拖线：从输出口拖到输入口连上', d.edges.some(e => e.from === sp && e.fp === 'train' && e.to === tr && e.tp === 'in'), JSON.stringify(d.edges.map(e => e.fp + '>' + e.tp)));

    // 连线模式：点「连线」，再先后点两个节点（自动挑口）
    await page.evaluate(() => ABB.App.select(null));
    const mo = await add('model');
    await page.evaluate(([tr, mo]) => { const d = ABB.App.cur(); ABB.Model.moveTo(d, mo, ABB.Model.get(d, tr).x + 300, ABB.Model.get(d, tr).y); ABB.App.select(null); ABB.App.canvas().fit(); }, [tr, mo]);
    await page.waitForTimeout(150);
    const tapNode = async id => { const b = await boxOf(page, id); const x = b.x + b.width / 2, y = b.y + 12;
      if (size.touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await page.waitForTimeout(90); };
    await page.click(size.touch ? '#mb-connect' : '#btn-connect');
    await tapNode(tr); await tapNode(mo);
    d = await page.evaluate(() => ABB.App.cur());
    ck('连线模式：先后点两个节点，自动挑口连上', d.edges.some(e => e.from === tr && e.to === mo && e.fp === 'model'), d.edges.length);

    // 拖节点进业务环节
    await page.evaluate(() => ABB.App.select(null));
    const stg = await add('stage');
    await page.evaluate(() => ABB.App.canvas().fit()); await page.waitForTimeout(120);
    const sb = await boxOf(page, stg, true), mb = await boxOf(page, mo);
    await drag(page, mb.x + mb.width / 2, mb.y + 12, sb.x + sb.width / 2, sb.y + sb.height - 20, size.touch);
    const par = await page.evaluate(id => ABB.Model.get(ABB.App.cur(), id).parent, mo);
    ck('拖动：把节点拖进业务环节', par === stg, par);

    // 双指缩放
    const k0 = await page.evaluate(() => ABB.App.canvas().view.k);
    await page.evaluate(() => {
      const svg = document.getElementById('canvas'), r = svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ev = (type, id, x, y) => new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, buttons: 1 });
      svg.dispatchEvent(ev('pointerdown', 11, cx - 20, cy)); svg.dispatchEvent(ev('pointerdown', 12, cx + 20, cy));
      for (let i = 1; i <= 5; i++) { svg.dispatchEvent(ev('pointermove', 11, cx - 20 - i * 12, cy)); svg.dispatchEvent(ev('pointermove', 12, cx + 20 + i * 12, cy)); }
      svg.dispatchEvent(ev('pointerup', 11, cx - 80, cy)); svg.dispatchEvent(ev('pointerup', 12, cx + 80, cy));
    });
    await page.waitForTimeout(80);
    const k1 = await page.evaluate(() => ABB.App.canvas().view.k);
    ck('双指缩放', k1 > k0 * 1.5, k0.toFixed(2) + ' → ' + k1.toFixed(2));

    // 属性面板：选算法、打分；数据源用示例数据；运行
    await page.evaluate(id => ABB.App.select({ kind: 'node', id }), tr);
    if (size.touch) await page.tap('#mb-props');
    await page.selectOption('#panel-body select[data-key=algo]', 'forest');
    await page.click('#panel-body .segbtn.value button[data-v=high]');
    const t = await page.evaluate(id => ABB.Model.get(ABB.App.cur(), id), tr);
    ck('属性：选算法、打价值分', t.algo === 'forest' && t.value === 'high', t.algo + ' / ' + t.value);
    if (size.touch) {
      const m = await smallestTarget(page); ck('全屏面板：可点区域 ≥ 44px', m && m.v >= 44, m && (m.v + 'px「' + m.what + '」'));
      await page.tap('#panel-close');
    }
    await page.evaluate(id => ABB.App.select({ kind: 'node', id }), src);
    if (size.touch) await page.tap('#mb-props');
    await page.selectOption('#panel-body .datablk select', 'sales');
    await page.waitForTimeout(150);
    if (size.touch) { await page.tap('#panel-close'); await page.tap('#mb-run'); } else await page.click('#btn-run');
    await page.waitForTimeout(150);
    const run = await page.evaluate(([tr, mo]) => { const r = ABB.App.runResult(); return r && [r.nodes[tr].status, r.nodes[mo].status]; }, [tr, mo]);
    ck('运行：导入示例数据后训练出模型', run && run[0] === 'ok' && run[1] === 'ok', JSON.stringify(run));
    if (size.touch) {
      await page.tap('#panel-close');
      const m2 = await smallestTarget(page); ck('画布页：可点区域 ≥ 44px', m2 && m2.v >= 44, m2 && (m2.v + 'px「' + m2.what + '」'));
      await page.tap('#mb-add'); const m4 = await smallestTarget(page); ck('节点库：可点区域 ≥ 44px', m4 && m4.v >= 44, m4 && (m4.v + 'px「' + m4.what + '」')); await page.tap('#pal-close');
      await page.tap('#menu-btn'); const vis = await page.isVisible('#menu'); ck('☰ 菜单能打开', vis);
      const m3 = await smallestTarget(page); ck('☰ 菜单：可点区域 ≥ 44px', m3 && m3.v >= 44, m3 && (m3.v + 'px「' + m3.what + '」'));
      await page.tap('#menu [data-panel=quad]'); ck('☰ → 四格图打开全屏面板', await page.isVisible('.quadsvg'));
      await page.tap('#panel-close');
    }

    // 练习
    await page.click('[data-mode=practice]'); await page.waitForTimeout(150);
    ov = await overflow(page); ck('练习：没有横向溢出、整页不滚动', ov.x <= 0 && ov.y <= 1, JSON.stringify(ov));
    const tasks = await page.evaluate(() => ABB.Practice.state().total); ck('练习：10 项任务', tasks === 10, tasks);
  } catch (e) { ck('场景没有异常', false, e.message.split('\n')[0]); }
  ck('没有 JS 报错', !page.errors.length, page.errors.join(' | '));
  await ctx.close();
  return r;
}

async function shots(browser) {
  const out = path.join(ROOT, 'docs', 'img'); fs.mkdirSync(out, { recursive: true });
  fs.readdirSync(out).filter(f => /\.png$/.test(f)).forEach(f => fs.unlinkSync(path.join(out, f)));
  const list = [];
  async function shot(file, size, scheme, setup) {
    const { ctx, page } = await newPage(browser, size, scheme);
    await page.goto(URL0 + '?nohelp=1'); await page.waitForTimeout(300);
    await page.evaluate(() => ABB.Watch.stop());
    await setup(page); await page.waitForTimeout(900);
    await page.evaluate(() => document.getElementById('toast').classList.remove('on')); await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, file) }); list.push(file);
    await ctx.close();
  }
  const D1 = { w: 1920, h: 1080, dpr: 1 }, D2 = { w: 1366, h: 768, dpr: 1 }, P = { w: 390, h: 844, dpr: 2, touch: true }, T = { w: 768, h: 1024, dpr: 2, touch: true };
  const watch = (i, k) => p => p.evaluate(([i, k]) => { ABB.Watch.load(i); ABB.Watch.stop(); for (let j = 0; j <= k; j++) ABB.Watch.go(j); ABB.Watch.stop(); }, [i, k]);
  const copy = (i, sel, tab) => async p => {
    await p.evaluate(([i, sel, tab]) => {
      ABB.Watch.load(i); ABB.Watch.stop(); ABB.App.cmd('copy-sample'); ABB.App.runNow(false); ABB.App.canvas().fit();
      const d = ABB.App.cur(); const n = d.nodes.find(n => n.name === sel);
      if (n) { ABB.App.select({ kind: 'node', id: n.id }); ABB.App.canvas().reveal(n.id); }
      if (tab) ABB.App.setTab(tab);
    }, [i, sel, tab || '']);
  };
  await shot('01-watch-1920x1080.png', D1, 'light', watch(0, 6));
  await shot('02-draw-1920x1080-dark.png', D1, 'dark', copy(1, '训练：决策树', 'props'));
  await shot('03-run-1366x768.png', D2, 'light', copy(0, '预测明天销量', 'run'));
  await shot('04-check-1366x768-dark.png', D2, 'dark', watch(2, 7));
  await shot('05-practice-1366x768.png', D2, 'light', async p => {
    await p.evaluate(() => {
      const M = ABB.Model; ABB.App.setMode('practice');
      ABB.App.commit(d => {
        const s = M.addNode(d, 'src', 0, 0, { name: '会员上课记录', labeled: true, target: '是否续费', level: 'sensitive' });
        const sp = M.addNode(d, 'split', 290, 0), tr = M.addNode(d, 'train', 560, -40, { algo: 'logreg', value: 'high', effort: 'mid' }), mo = M.addNode(d, 'model', 860, -40, { name: '续费预测模型' });
        [[s, sp], [sp, tr], [tr, mo]].forEach(([a, b]) => M.connect(d, a.id, b.id));
      });
      ABB.App.setTab('tasks'); ABB.App.canvas().fit();
    });
  });
  await shot('06-mobile-watch-390x844.png', P, 'light', watch(0, 7));
  await shot('07-mobile-draw-390x844-dark.png', P, 'dark', copy(2, '训练：K-means 分群'));
  await shot('08-mobile-run-390x844.png', P, 'light', async p => { await copy(0, '评估：考一考')(p); await p.evaluate(() => ABB.App.openSheet('run')); });
  await shot('09-tablet-768x1024.png', T, 'light', async p => { await copy(1, '')(p); await p.evaluate(() => ABB.App.canvas().fit()); });
  await shot('10-tablet-768x1024-dark.png', T, 'dark', watch(2, 6));
  return list;
}

/** 浏览器：默认用 Playwright 自带的 Chromium；设了 BROWSER_CHANNEL（chrome / msedge）就用本机已装的。 */
async function launch() {
  const ch = process.env.BROWSER_CHANNEL;
  return ch ? chromium.launch({ channel: ch, headless: false, args: ['--headless=new'] }) : chromium.launch();
}

(async () => {
  const browser = await launch();
  const results = { tool: 'tools/browser_check.js', browser: (process.env.BROWSER_CHANNEL || 'Chromium') + ' ' + browser.version() + '（Playwright，无头）', date: new Date().toISOString().slice(0, 10), selftest: null, sizes: [] };
  {
    const { ctx, page } = await newPage(browser, SIZES[3], 'light');
    await page.goto(URL0 + '?selftest=1');
    await page.waitForFunction(() => /SELFTEST/.test(document.title), null, { timeout: 60000 });
    const st = await page.evaluate(() => window.__selftest);
    results.selftest = { ok: st.ok, checks: st.checks.length, failed: st.checks.filter(c => !c.ok) };
    console.log('页面自检：' + (st.ok ? '通过' : '失败') + '（' + st.checks.length + ' 项）');
    results.selftest.failed.forEach(c => console.log('    ✗ ' + c.name + '  ' + c.detail));
    await ctx.close();
  }
  for (const size of SIZES) for (const scheme of SCHEMES) {
    const r = await checkSize(browser, size, scheme); results.sizes.push(r);
    const bad = r.checks.filter(c => !c.ok);
    console.log((bad.length ? '✗ ' : '✓ ') + size.name + ' ' + (scheme === 'light' ? '浅色' : '深色') + '：' + (r.checks.length - bad.length) + '/' + r.checks.length);
    bad.forEach(c => console.log('    ✗ ' + c.name + '  ' + c.detail));
  }
  if (SHOTS) { results.shots = await shots(browser); console.log('截图：' + results.shots.join('、')); }
  await browser.close();
  results.ok = results.selftest.ok && results.sizes.every(r => r.checks.every(c => c.ok));
  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'results', 'browser_check.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(results.ok ? '全部通过' : '有没通过的项目');
  process.exit(results.ok ? 0 : 1);
})();
