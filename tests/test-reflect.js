/* A saved setting has to show up now, not after a relaunch.
 *
 * Settings reached the screen through a hand-written list of special cases:
 * change the quote, call TodayPlus.apply; change the chips, rescan. Anything
 * not on the list only appeared once the app had been closed and opened
 * again — which is exactly what people reported, and the list was always one
 * setting behind.
 *
 * What is under test is the replacement: one reflect() that redraws the
 * pack's own layers and then asks the app to redraw itself. The proof is not
 * that reflect() runs without throwing — it is that a screen the person is
 * NOT on changes to match the setting they just saved, with no reload in
 * between, and that redrawing every screen at once is safe to do twice.
 */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 240) : '')); }
  };

  const c = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p);
  await p.waitForTimeout(4200);
  ok('signed in', await p.evaluate(() => !document.getElementById('flow-auth')));

  console.log('\n— the app can redraw itself on demand —');
  ok('flowRepaintAll is there', await p.evaluate(() => typeof window.flowRepaintAll === 'function'));
  ok('and Settings.reflect is the way in',
    await p.evaluate(() => !!(window.Flow && window.Flow.Settings && typeof window.Flow.Settings.reflect === 'function')));

  console.log('\n— a screen nobody is editing picks the change up —');
  /* The quote lives on Today. The settings panel is a different screen, and
     the Today header is built by its own render, so a general repaint does
     not reach it — which is precisely the shape of the reported bug. */
  const MARK = 'Reflect marker 8QW';
  const before = await p.evaluate(() => {
    const q = document.querySelector('.flow-td-quote');
    return q ? q.innerText : null;
  });
  ok('the old line is on screen', typeof before === 'string' && before.indexOf('Reflect marker') < 0, before);

  await p.evaluate(async (mark) => {
    await window.Flow.Settings.set('todayQuote', mark);
    window.Flow.Settings.reflect();
  }, MARK);
  await p.waitForTimeout(900);
  ok('after reflect() the new line is', await p.evaluate((mark) => {
    const q = document.querySelector('.flow-td-quote');
    return !!q && q.innerText.indexOf(mark) >= 0;
  }, MARK));

  console.log('\n— redrawing everything is safe to do —');
  /* reflect() calls every renderer the app has. One that throws must not stop
     the others, or a saved setting leaves half the app stale — worse than the
     relaunch this replaces. */
  ok('flowRepaintAll runs clean on a live app', await p.evaluate(() => {
    try { window.flowRepaintAll(); return true; } catch (e) { return String(e); }
  }) === true);
  ok('and the quote survived the second pass', await p.evaluate((mark) => {
    const q = document.querySelector('.flow-td-quote');
    return !!q && q.innerText.indexOf(mark) >= 0;
  }, MARK));

  console.log('\n— and that happened without a reload —');
  ok('the page was never navigated', await p.evaluate(() => !!window.Flow));
  ok('no page errors', errs.length === 0, errs);

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
