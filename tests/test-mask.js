/* Hide the numbers.
 *
 * One button on Finances, for showing the app to someone. What matters: every
 * figure on that screen — including ones drawn after the button was pressed —
 * is unreadable, the words around them are not, the Spend tile on Today goes
 * too, and the choice survives a reload on this device and nothing else. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    await Flow.Settings.set('currency', 'TRY');
    await FlowLedger.add({ date: todayStr, amount: 412.5, merchant: 'Migros', category: 'Groceries', currency: 'TRY', source: 'manual' });
    await FlowStatement.save({ bank: 'Garanti BBVA', account: '••9012', currency: 'TRY', from: '2026-10-01', to: '2026-10-31',
      tx: [{ date: '2026-10-01', merchant: 'Rent', amount: -20000, currency: 'TRY', category: 'Rent & Bills', kind: 'spend' },
           { date: '2026-10-03', merchant: 'Netflix', amount: -229.99, currency: 'TRY', category: 'Subscriptions', kind: 'spend' }] });
    Flow.Nav.go('finance');
  });
  await p.waitForTimeout(1500);

  const blurred = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => ({ t: e.textContent.trim().slice(0, 40), f: getComputedStyle(e).filter })), sel);

  console.log('\n— the button —');
  ok('Finances has a Hide numbers button beside its title', await p.evaluate(() => { const b = document.getElementById('fl-mask-btn'); return !!b && /Hide numbers/.test(b.textContent) && b.closest('.section-header') !== null; }));
  ok('nothing is hidden until it is pressed', !(await p.evaluate(() => document.documentElement.classList.contains('fl-hide-money'))));

  await p.click('#fl-mask-btn'); await p.waitForTimeout(400);
  console.log('\n— pressed —');
  const stats = await blurred('#fnIncome, #fnSpent, #fnRemain, #fnSaved');
  ok('the four totals are blurred', stats.length === 4 && stats.every((x) => /blur/.test(x.f)), stats);
  const words = await p.evaluate(() => {
    const f = (e) => e ? getComputedStyle(e).filter : 'missing';
    const lbl = [...document.querySelectorAll('#tab-finance .stat .lbl')][1];
    return { title: f(document.querySelector('#tab-finance > .section-header')), label: f(lbl), month: f(document.getElementById('fnMonthLabel')), monthText: (document.getElementById('fnMonthLabel') || {}).textContent };
  });
  ok('the title and labels stay readable', words.title === 'none' && words.label === 'none', words);
  ok('so does the month name', words.month === 'none', words);
  const rows = await p.evaluate(() => {
    const all = [...document.querySelectorAll('#tab-finance *')].filter((e) => e.children.length === 0 && /\d/.test(e.textContent) && e.offsetParent !== null);
    const shown = all.filter((e) => getComputedStyle(e).filter === 'none' && !e.closest('[data-flm]') && !(e.closest('svg') && e.closest('[data-flm]')) && !/^(svg|text)$/i.test(e.tagName));
    return shown.map((e) => e.textContent.trim().slice(0, 50)).filter((t) => !FlowMoneyMask.DATEISH.test(t));
  });
  ok('no other figure on the Finances screen is left readable', rows.length === 0, rows.slice(0, 12));
  ok('the habits card is hidden too', await p.evaluate(() => [...document.querySelectorAll('#fx-habits .fx-tile b')].every((e) => /blur/.test(getComputedStyle(e).filter))));
  ok('the budget boxes are blanked, value or placeholder', await p.evaluate(() => [...document.querySelectorAll('#budgetInputs input')].every((i) => i.hasAttribute('data-flm') && getComputedStyle(i).color === 'rgba(0, 0, 0, 0)' && getComputedStyle(i, '::placeholder').color === 'rgba(0, 0, 0, 0)')));
  ok('the amount box blanks what you type', await p.evaluate(() => { const i = document.querySelector('#tab-finance input[type="number"]'); return !i || getComputedStyle(i).color === 'rgba(0, 0, 0, 0)'; }));

  console.log('\n— figures drawn afterwards —');
  await p.evaluate(async () => { await FlowLedger.add({ date: todayStr, amount: 77, merchant: 'Simit', category: 'Dining', currency: 'TRY', source: 'manual' }); });
  await p.waitForTimeout(700);
  const late = await blurred('#fnSpent');
  ok('a total that repaints after adding an expense stays hidden', late[0] && /blur/.test(late[0].f) && /489/.test(late[0].t), late);

  console.log('\n— Today —');
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(900);
  const tile = await blurred('.flow-td-pulse [data-jump="spend"] .v, .flow-td-pulse [data-jump="spend"] .s');
  ok('the Spend tile on Today is hidden', tile.length >= 1 && tile.filter((x) => /\d/.test(x.t)).every((x) => /blur/.test(x.f)), tile);
  ok('its label is not', await p.evaluate(() => getComputedStyle(document.querySelector('.flow-td-pulse [data-jump="spend"] .l')).filter === 'none'));
  ok('other tiles are left alone', await p.evaluate(() => { const v = document.querySelector('.flow-td-pulse [data-jump="focus"] .v'); return !v || getComputedStyle(v).filter === 'none'; }));

  console.log('\n— it stays until it is turned off —');
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(4500);
  await p.evaluate(() => Flow.Nav.go('finance')); await p.waitForTimeout(1200);
  ok('after a reload it is still hidden', (await blurred('#fnSpent')).every((x) => /blur/.test(x.f)));
  ok('and the button says Show numbers', await p.evaluate(() => /Show numbers/.test(document.getElementById('fl-mask-btn').textContent) && document.getElementById('fl-mask-btn').getAttribute('aria-pressed') === 'true'));
  ok('it is kept on this device, not in the account', await p.evaluate(() => localStorage.getItem('flow:hideMoney') === '1'));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '-on.png' });
  await p.click('#fl-mask-btn'); await p.waitForTimeout(300);
  ok('pressing again shows everything', (await blurred('#fnSpent')).every((x) => x.f === 'none'));

  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  ok('on a phone the button fits beside the title', await p.evaluate(() => { const b = document.getElementById('fl-mask-btn').getBoundingClientRect(); return b.right <= window.innerWidth && b.width > 0; }));

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
