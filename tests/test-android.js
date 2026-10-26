/* Android: The Flow as the Play Store app runs it — Chrome on a Pixel,
 * touch only. What would make it wrong: a sheet with a grab bar that will not
 * slide away, a pull from the top that does nothing (or fires while a sheet
 * is open), a fold that will not open to a tap, a page that will not scroll
 * back up. Both interfaces. */
const submitAuth = require('./submit-auth.js');
const { chromium, devices } = require('playwright');
const H = 'http://localhost:4222';
const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({}, devices['Pixel 7']));
  /* The Play Store app is a Trusted Web Activity: Chrome, full screen, in
     standalone display mode — which the page reads to pick its bottom bar. */
  await ctx.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => /display-mode:\s*standalone/.test(q) ? ({ matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }) : mm(q);
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  const touch = async (pts) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (let i = 1; i < pts.length; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i][0], y: pts[i][1] }] }); await p.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const drag = (x, y0, y1, n = 14) => touch(Array.from({ length: n + 1 }, (_, i) => [x, y0 + (y1 - y0) * i / n]));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  ok('it runs as the installed app', await p.evaluate(() => matchMedia('(display-mode: standalone)').matches));
  for (const look of [false, true]) {
    log('\n===== ' + (look ? 'SIMPLE' : 'ADVANCED'));
    await p.evaluate(async (v) => { await Flow.Settings.set('newLook', v); Flow.Settings.reflect(); Flow.Nav.go('today'); window.scrollTo(0, 0); }, look); await p.waitForTimeout(1500);
    await drag(200, 700, 200); await p.waitForTimeout(600);
    const y1 = await p.evaluate(() => scrollY); ok('a finger moving up scrolls the page down', y1 > 300, y1);
    await drag(200, 200, 500); await p.waitForTimeout(600);
    const y2 = await p.evaluate(() => scrollY); ok('and moving down scrolls it back up', y2 < y1 - 200, { y1, y2 });
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
    await p.evaluate(() => { window.__pulled = 0; const R = window.FlowRefresh; R.__now = R.__now || R.now; R.now = function () { window.__pulled++; }; });
    await drag(200, 160, 520, 20); await p.waitForTimeout(500);
    ok('pulling down from the top refreshes', await p.evaluate(() => window.__pulled) === 1, await p.evaluate(() => window.__pulled));
    /* folds */
    for (const sel of ['#today-feed .td-group:has([data-diet]) .td-group-head', '#today-feed .td-group:has([data-saw]) .td-group-head, #today-feed .td-group:nth-of-type(2) .td-group-head']) {
      const h = await p.$(sel); if (!h) { log('no', sel); continue; }
      await h.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
      const before = await h.evaluate((e) => e.closest('.td-group').className);
      await h.tap(); await p.waitForTimeout(700);
      const after = await p.evaluate((s) => { const e = document.querySelector(s); return e && e.closest('.td-group').className; }, sel);
      ok('a tap opens and closes the ' + (/diet/.test(sel) ? 'Diet' : 'Sharpen') + ' fold', /is-open/.test(before) !== /is-open/.test(after || ''), { before, after });
      await p.tap(sel.split(',')[0]).catch(() => {}); await p.waitForTimeout(500);
    }
    /* the + sheet: open, then slide it down */
    await p.evaluate(() => window.scrollTo(0, 0));
    const cap = await p.$('#flow-tabbar .fn-cap'); if (cap) { await cap.tap(); await p.waitForTimeout(600); }
    ok('the + opens its sheet', await p.evaluate(() => document.getElementById('flow-capture').classList.contains('on')));
    const box = () => p.evaluate(() => { const e = document.querySelector('#flow-capture .fn-sheet'); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + 8]; });
    let bx = await box();
    await p.evaluate(() => { window.__pulled = 0; });
    await drag(bx[0], bx[1], bx[1] + 50, 6); await p.waitForTimeout(500);
    ok('a short pull and it springs back, still open', await p.evaluate(() => document.getElementById('flow-capture').classList.contains('on') && !document.querySelector('#flow-capture .fn-sheet').style.transform));
    ok('and the page under it is not refreshed', await p.evaluate(() => window.__pulled) === 0);
    const g = await p.evaluate(() => { const e = document.querySelector('#flow-capture .fn-grab, #flow-capture .fn-sheet'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + 6]; });
    if (g) { await drag(g[0], g[1], g[1] + 400, 16); await p.waitForTimeout(700); }
    ok('slid down, the + sheet closes', await p.evaluate(() => !document.getElementById('flow-capture').classList.contains('on')));
    ok('and opens again where it should be', await (async () => { const c = await p.$('#flow-tabbar .fn-cap'); await c.tap(); await p.waitForTimeout(600); return p.evaluate(() => { const e = document.querySelector('#flow-capture .fn-sheet'); const r = e.getBoundingClientRect(); return document.getElementById('flow-capture').classList.contains('on') && !e.style.transform && r.bottom <= innerHeight + 2 && r.top >= 0; }); })());
    await p.evaluate(() => Flow.Nav.closeCapture && Flow.Nav.closeCapture()); await p.waitForTimeout(300);
    /* More / profile sheet */
    const av = await p.$('#fn-avatar'); if (av) { await av.tap(); await p.waitForTimeout(600); }
    const sh = await p.evaluate(() => { const w = [...document.querySelectorAll('.fn-sheetwrap.on .fn-sheet')][0]; if (!w) return null; const r = w.getBoundingClientRect(); return [r.x + r.width / 2, r.y + 10]; });
    ok('the profile sheet opens', !!sh);
    if (sh) { await drag(sh[0], sh[1], sh[1] + 420, 16); await p.waitForTimeout(700); ok('and slides away', await p.evaluate(() => !document.querySelector('.fn-sheetwrap.on'))); }
    await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('.fn-sheetwrap.on').forEach((w) => w.classList.remove('on'))); await p.waitForTimeout(300);
    /* selects and details */
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 5));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
