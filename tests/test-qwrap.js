/* The priorities rows overflow the screen on a phone: text, ✏️, → Rock, the
   quadrant selector and × are all on one non-wrapping flex line, so the
   selector and the delete button run off the right edge and the whole card
   pushes the page wider than the viewport. Measured, not eyeballed. */
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
    : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

  /* iPhone 14-ish */
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  await p.click('#fa-alt').catch(() => {});
  await p.waitForTimeout(250);
  await p.fill('#fa-email', 'phone@example.com');
  await p.fill('#fa-name', 'Phone');
  await p.fill('#fa-pw', 'a properly long password');
  await Promise.all([p.waitForNavigation({ timeout: 15000 }).catch(() => {}), p.click('#fa-go')]);
  await p.waitForTimeout(3800);

  /* Give the rows realistic, long text — the short ones happen to fit. */
  await p.evaluate(() => {
    qData.items = [
      { id: 'a1', q: 1, txt: 'CRM lead generation campaign', done: false },
      { id: 'a2', q: 1, txt: 'Murat Ali Meşe opening party Hakkinda bakim gununu planla gulhan ile', done: false },
      { id: 'a3', q: 3, txt: 'Some emails', done: false },
      { id: 'a4', q: 4, txt: 'Vacation / travelling', done: false }
    ];
    qSave(); renderQuad();
  });
  await p.waitForTimeout(600);
  /* .tabs is display:none under 760px, so click the element directly rather
     than through the pointer — this is how the host's own nav reaches it. */
  await p.evaluate(() => document.querySelector('.tab[data-tab="quad"]').click());
  await p.waitForTimeout(900);

  console.log('\n— the page must not be wider than the phone —');
  const doc = await p.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth
  }));
  ok('no horizontal overflow on the document', doc.scrollW <= doc.clientW + 1, doc);

  console.log('\n— every control on a priority row is reachable —');
  const rows = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('#tab-quad .qitem')].map(el => {
      const r = el.getBoundingClientRect();
      const kids = [...el.children].map(c => {
        const k = c.getBoundingClientRect();
        return { tag: c.tagName.toLowerCase(), cls: c.className || '', right: Math.round(k.right), w: Math.round(k.width) };
      });
      return {
        text: (el.querySelector('.qt') || {}).textContent || '',
        rowRight: Math.round(r.right), rowW: Math.round(r.width),
        overflows: r.right > vw + 1,
        clipped: kids.filter(k => k.right > vw + 1),
        selectW: (kids.find(k => k.tag === 'select') || {}).w || 0,
        textW: Math.round((el.querySelector('.qt') || el).getBoundingClientRect().width),
        minCtrl: Math.min(...kids.filter(k => k.tag === 'button' || k.tag === 'select').map(k => k.w))
      };
    });
  });
  ok('rows were rendered', rows.length === 4, rows.length);
  const bad = rows.filter(r => r.overflows);
  ok('no row extends past the right edge', bad.length === 0, bad.map(r => [r.text.slice(0, 30), r.rowRight]));
  const clipped = rows.flatMap(r => r.clipped.map(c => [r.text.slice(0, 24), c.cls || c.tag, c.right]));
  ok('no control is cut off', clipped.length === 0, clipped);
  ok('the quadrant selector still has width', rows.every(r => r.selectW > 20), rows.map(r => r.selectW));
  ok('every row is actually visible', rows.every(r => r.rowW > 100), rows.map(r => r.rowW));
  ok('no control is squeezed to a sliver', rows.every(r => r.minCtrl >= 20), rows.map(r => [r.text.slice(0,18), r.minCtrl]));
  ok('the text gets most of the width, not the buttons',
     rows.every(r => r.textW >= r.rowW * 0.55), rows.map(r => [r.text.slice(0,18), r.textW, r.rowW]));

  console.log('\n— and the long one wraps rather than stretching —');
  const longRow = rows.find(r => /Murat/.test(r.text));
  ok('the long priority is present', !!longRow, rows.map(r => r.text.slice(0, 20)));
  ok('its row fits the viewport width', longRow && longRow.rowW <= 390, longRow && longRow.rowW);

  ok('no page errors', errs.length === 0, errs.slice(0, 2));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
