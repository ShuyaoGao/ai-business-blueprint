/* 浏览器验收 + 截图：用 Playwright 驱动 Chromium，打开 file:// 下的 play/index.html。
 *   node tools/browser_check.js            跑全部尺寸 × 深浅色，写 results/browser_check.json
 *   node tools/browser_check.js --shots    另外重新生成 docs/img/ 的截图
 * 需要：Node.js + playwright（npm i playwright，再 npx playwright install chromium；或用本机已装的 Chromium）。
 */
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');

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

    // 我来画：用界面加方框
    await page.click('[data-mode=draw]'); await page.waitForTimeout(150);
    await page.evaluate(() => ABB.App.newDraw(null));
    const add = async t => {
      if (size.touch) { await page.tap('#mb-add'); await page.tap('#mb-add-menu [data-add=' + t + ']'); }
      else await page.click('#grp-add [data-add=' + t + ']');
      await page.waitForTimeout(60);
    };
    await add('stage'); const sid = await page.evaluate(() => ABB.S.sel.id);
    await add('ai'); await add('human');
    await page.evaluate(() => ABB.App.select(null)); await add('data');
    let d = await page.evaluate(() => ABB.App.cur());
    const kids = d.nodes.filter(n => n.parent === sid).length;
    ck('加方框：选中环节时放进环节里', d.nodes.length === 4 && kids === 2, d.nodes.length + ' 个，环节里 ' + kids);
    ov = await overflow(page); ck('我来画：没有横向溢出、整页不滚动', ov.x <= 0 && ov.y <= 1, JSON.stringify(ov));

    // 连线：点「连线」，再先后点两个方框
    const ids = await page.evaluate(() => { const d = ABB.App.cur(); return { data: d.nodes.find(n => n.type === 'data').id, ai: d.nodes.find(n => n.type === 'ai').id }; });
    await page.evaluate(() => ABB.App.canvas().fit());
    await page.waitForTimeout(100);
    const tapBox = async id => { const b = await boxOf(page, id); const x = b.x + b.width / 2, y = b.y + Math.min(b.height / 2, 20);
      if (size.touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await page.waitForTimeout(80); };
    await page.click(size.touch ? '#mb-connect' : '#btn-connect');
    await tapBox(ids.data); await tapBox(ids.ai);
    d = await page.evaluate(() => ABB.App.cur());
    ck('连线模式：先后点两个方框连出一条线', d.edges.length === 1 && d.edges[0].from === ids.data && d.edges[0].to === ids.ai, JSON.stringify(d.edges));

    // 拖方框（单指 / 鼠标）：把数据拖进环节
    const sb = await boxOf(page, sid, true);
    const db = await boxOf(page, ids.data);
    await page.evaluate(([x0, y0, x1, y1, touch]) => {
      const svg = document.getElementById('canvas'), t = document.elementFromPoint(x0, y0);
      const ev = (type, x, y) => new PointerEvent(type, { pointerId: 7, pointerType: touch ? 'touch' : 'mouse', clientX: x, clientY: y, bubbles: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
      t.dispatchEvent(ev('pointerdown', x0, y0));
      for (let i = 1; i <= 8; i++) svg.dispatchEvent(ev('pointermove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8));
      svg.dispatchEvent(ev('pointerup', x1, y1));
    }, [db.x + db.width / 2, db.y + 30, sb.x + sb.width / 2, sb.y + sb.height - 14, size.touch]);
    await page.waitForTimeout(100);
    const par = await page.evaluate(id => ABB.Model.get(ABB.App.cur(), id).parent, ids.data);
    ck('拖动：把方框拖进环节变成小步骤', par === sid, par);

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

    // 属性面板（手机上是全屏面板）
    await page.evaluate(id => ABB.App.select({ kind: 'node', id }), ids.ai);
    if (size.touch) await page.tap('#mb-props');
    await page.selectOption('#panel-body select[data-key=aiType]', 'llm');
    await page.click('#panel-body .segbtn.value button[data-v=high]');
    const ai = await page.evaluate(id => ABB.Model.get(ABB.App.cur(), id), ids.ai);
    ck('属性：选 AI 类型、打价值分', ai.aiType === 'llm' && ai.value === 'high', ai.aiType + ' / ' + ai.value);
    const red = await page.evaluate(() => ABB.Analysis.risks(ABB.App.cur()).red);
    ck('红黄规则：「内部」数据连到公有云 AI 不标红', red === 0, red);
    if (size.touch) {
      const m = await smallestTarget(page); ck('全屏面板：可点区域 ≥ 44px', m && m.v >= 44, m && (m.v + 'px「' + m.what + '」'));
      await page.tap('#panel-close');
      const m2 = await smallestTarget(page); ck('画布页：可点区域 ≥ 44px', m2 && m2.v >= 44, m2 && (m2.v + 'px「' + m2.what + '」'));
      await page.tap('#menu-btn'); const vis = await page.isVisible('#menu'); ck('☰ 菜单能打开', vis);
      const m3 = await smallestTarget(page); ck('☰ 菜单：可点区域 ≥ 44px', m3 && m3.v >= 44, m3 && (m3.v + 'px「' + m3.what + '」'));
      await page.tap('#menu [data-panel=quad]'); ck('☰ → 四格图打开全屏面板', await page.isVisible('.quadsvg'));
      await page.tap('#panel-close');
    }

    // 练习
    await page.click('[data-mode=practice]'); await page.waitForTimeout(150);
    ov = await overflow(page); ck('练习：没有横向溢出、整页不滚动', ov.x <= 0 && ov.y <= 1, JSON.stringify(ov));
    const tasks = await page.evaluate(() => ABB.Practice.state().total); ck('练习：9 项任务', tasks === 9, tasks);
  } catch (e) { ck('场景没有异常', false, e.message.split('\n')[0]); }
  ck('没有 JS 报错', !page.errors.length, page.errors.join(' | '));
  await ctx.close();
  return r;
}

async function shots(browser) {
  const out = path.join(ROOT, 'docs', 'img'); fs.mkdirSync(out, { recursive: true });
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
  const copy = (i, sel) => async p => {
    await p.evaluate(([i, sel]) => {
      ABB.Watch.load(i); ABB.Watch.stop(); ABB.App.cmd('copy-sample');
      const d = ABB.App.cur(); const n = d.nodes.find(n => n.name === sel); if (n) ABB.App.select({ kind: 'node', id: n.id });
    }, [i, sel]);
  };
  await shot('01-watch-1920x1080.png', D1, 'light', p => p.evaluate(() => { ABB.Watch.load(0); ABB.Watch.stop(); ABB.Watch.go(10); }));
  await shot('02-draw-1920x1080-dark.png', D1, 'dark', copy(1, '缺陷检测'));
  await shot('03-stats-1366x768.png', D2, 'light', p => p.evaluate(() => { ABB.Watch.load(2); ABB.Watch.stop(); ABB.Watch.go(10); }));
  await shot('04-quad-1366x768-dark.png', D2, 'dark', p => p.evaluate(() => { ABB.Watch.load(1); ABB.Watch.stop(); ABB.Watch.go(10); }));
  await shot('05-practice-1366x768.png', D2, 'light', async p => {
    await p.evaluate(() => {
      const M = ABB.Model; ABB.App.setMode('practice');
      ABB.App.commit(d => {
        const names = ['会员办卡', '教练排课', '续费提醒']; const st = names.map((n, i) => M.addNode(d, 'stage', i * 280, 0, { name: n }));
        const a = M.addNode(d, 'ai', 0, 0, { name: '续费可能性预测', aiType: 'predict', input: '上课频率、到期时间', output: '每位会员的续费概率', loc: 'private', value: 'high', effort: 'mid' }); M.placeInside(d, st[2].id, a);
        const h = M.addNode(d, 'human', 0, 0, { name: '前台打电话', role: '前台' }); M.placeInside(d, st[2].id, h);
        const c = M.addNode(d, 'ai', 0, 0, { name: '排课', aiType: 'optimize', value: 'mid', effort: 'low', loc: 'public' }); M.placeInside(d, st[1].id, c);
        const k = M.addNode(d, 'human', 0, 0, { name: '填表办卡', role: '前台' }); M.placeInside(d, st[0].id, k);
        const x = M.addNode(d, 'data', 300, 380, { name: '会员资料', level: 'sensitive', loc: 'local' }); M.addEdge(d, x.id, a.id, { label: '上课记录' }); M.addEdge(d, k.id, x.id);
      });
      ABB.App.setTab('tasks'); ABB.App.canvas().fit();
    });
  });
  await shot('06-mobile-watch-390x844.png', P, 'light', p => p.evaluate(() => { ABB.Watch.load(0); ABB.Watch.stop(); ABB.Watch.go(7); }));
  await shot('07-mobile-draw-390x844-dark.png', P, 'dark', async p => { await copy(2, '')(p); await p.evaluate(() => { const d = ABB.App.cur(); ABB.App.canvas().reveal(d.nodes.find(n => n.name === '通话实时转文字').id); }); });
  await shot('08-mobile-quad-390x844.png', P, 'light', async p => { await copy(0, '')(p); await p.evaluate(() => ABB.App.openSheet('quad')); });
  await shot('09-tablet-768x1024.png', T, 'light', async p => { await copy(1, '判定合格')(p); await p.evaluate(() => { ABB.App.canvas().fit(); }); });
  await shot('10-tablet-768x1024-dark.png', T, 'dark', p => p.evaluate(() => { ABB.Watch.load(2); ABB.Watch.stop(); ABB.Watch.go(5); }));
  return list;
}

(async () => {
  const browser = await chromium.launch();
  const results = { tool: 'tools/browser_check.js', browser: 'Chromium ' + browser.version() + '（Playwright，无头）', date: new Date().toISOString().slice(0, 10), selftest: null, sizes: [] };
  // 页面自检
  {
    const { ctx, page } = await newPage(browser, SIZES[3], 'light');
    await page.goto(URL0 + '?selftest=1');
    await page.waitForFunction(() => /SELFTEST/.test(document.title), null, { timeout: 20000 });
    const st = await page.evaluate(() => window.__selftest);
    results.selftest = { ok: st.ok, checks: st.checks.length, failed: st.checks.filter(c => !c.ok) };
    console.log('页面自检：' + (st.ok ? '通过' : '失败') + '（' + st.checks.length + ' 项）');
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
