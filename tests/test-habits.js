/* Spending habits.
 *
 * The analysis reads every uploaded statement together, so the things that
 * would make it quietly wrong are: a month uploaded twice counted twice, a
 * partial month compared as if it were whole, a dollar purchase added to
 * lira, card payments and transfers counted as spending, and a subscription
 * that stopped still being called recurring. Three months are built here with
 * known answers and the page is checked against them. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

/* Three full months. Every month: rent 20,000 on the 1st, Netflix 229.99 on
   the 3rd, salary 85,000 on the 5th, a 5,000 card payment on the 20th,
   Migros 500 every Saturday, Starbucks 95 on six days. Spotify 59.99 in
   August and September only. October adds 3,000 at a restaurant and a 150
   card fee; September a 2,000 transfer out; October one $20 purchase. */
function month(ym) {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const d = (n) => ym + '-' + String(n).padStart(2, '0');
  const tx = [
    [d(1), 'Rent', -20000, 'TRY', 'Rent & Bills', 'spend'],
    [d(3), 'Netflix', -229.99, 'TRY', 'Subscriptions', 'spend'],
    [d(5), 'Salary — ABKO', 85000, 'TRY', 'Other', 'income'],
    [d(20), 'Payment to card', 5000, 'TRY', 'Other', 'card-payment']
  ];
  for (let n = 1; n <= days; n++) if (new Date(y, m - 1, n).getDay() === 6) tx.push([d(n), 'Migros', -500, 'TRY', 'Groceries', 'spend']);
  [2, 7, 9, 14, 16, 23].forEach((n) => tx.push([d(n), 'Starbucks', -95, 'TRY', 'Dining', 'spend']));
  if (ym !== '2026-10') tx.push([d(10), 'Spotify', -59.99, 'TRY', 'Subscriptions', 'spend']);
  if (ym === '2026-09') tx.push([d(12), 'Havale — Ahmet Y.', -2000, 'TRY', 'Other', 'transfer']);
  if (ym === '2026-10') {
    tx.push([d(18), 'Nusr-Et', -3000, 'TRY', 'Dining', 'spend']);
    tx.push([d(25), 'Card fee', -150, 'TRY', 'Other', 'fee']);
    tx.push([d(26), 'Amazon US', -20, 'USD', 'Shopping', 'spend']);
  }
  return { bank: 'Garanti BBVA', account: 'Bonus ••9012', currency: 'TRY', from: d(1), to: d(days),
    tx: tx.map(([date, merchant, amount, currency, category, kind]) => ({ date, merchant, amount, currency, category, kind })) };
}
const AUG = month('2026-08'), SEP = month('2026-09'), OCT = month('2026-10');
/* A card statement that runs 15 Oct – 31 Oct: every line in it is already in OCT. */
const OVERLAP = { bank: 'Garanti BBVA', account: 'Bonus ••9012', currency: 'TRY', from: '2026-10-15', to: '2026-10-31', tx: OCT.tx.filter((t) => t.date >= '2026-10-15') };
/* A half month in November, so there is a partial month on the end. */
const NOV = { bank: 'Garanti BBVA', account: 'Bonus ••9012', currency: 'TRY', from: '2026-11-01', to: '2026-11-12',
  tx: [{ date: '2026-11-01', merchant: 'Rent', amount: -20000, currency: 'TRY', category: 'Rent & Bills', kind: 'spend' },
       { date: '2026-11-03', merchant: 'Netflix', amount: -229.99, currency: 'TRY', category: 'Subscriptions', kind: 'spend' }] };

const spendOf = (st) => st.tx.filter((t) => t.currency === 'TRY' && t.amount < 0 && (t.kind === 'spend' || t.kind === 'fee')).reduce((a, t) => a - t.amount, 0);
const want = { aug: spendOf(AUG), sep: spendOf(SEP), oct: spendOf(OCT) };
want.avg = (want.aug + want.sep + want.oct) / 3;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);

  console.log('\n— with nothing uploaded —');
  await p.evaluate(async () => { await Flow.Settings.set('currency', 'TRY'); Flow.Nav.go('finance'); });
  await p.waitForTimeout(1200);
  ok('the card says what it needs', await p.evaluate(() => /Upload a bank statement above/.test((document.getElementById('fx-habits') || {}).textContent || '')));

  console.log('\n— the numbers —');
  const a = await p.evaluate(async (sts) => {
    for (const s of sts) await FlowStatement.save(s);
    return FlowHabits.analyse(await FlowHabits.load(), 'TRY');
  }, [AUG, SEP, OCT, OVERLAP, NOV]);
  const by = (m) => a.series.find((r) => r.m === m) || {};
  ok('an overlapping statement is not counted twice', Math.abs(by('2026-10').spend - want.oct) < 0.01, { got: by('2026-10').spend, want: want.oct });
  ok('August and September add up exactly', Math.abs(by('2026-08').spend - want.aug) < 0.01 && Math.abs(by('2026-09').spend - want.sep) < 0.01, { aug: by('2026-08').spend, sep: by('2026-09').spend, want });
  ok('half of November is marked as part of a month', by('2026-11').full === false && by('2026-10').full === true, by('2026-11'));
  ok('the average month uses whole months only', Math.abs(a.avgMonth - want.avg) < 0.01, { got: a.avgMonth, want: want.avg });
  ok('October against September', a.last.m === '2026-10' && a.prev.m === '2026-09' && Math.abs(a.change - (want.oct - want.sep)) < 0.01, { change: a.change });
  ok('the dollar purchase is left out, and said to be', a.other === 1, a.other);
  ok('card payments, transfers and income are not spending', Math.abs(a.cardPay - 15000) < 0.01 && Math.abs(a.transfersOut - 2000) < 0.01 && Math.abs(a.income - 255000) < 0.01, { cardPay: a.cardPay, transfersOut: a.transfersOut, income: a.income });
  ok('fees are their own line', Math.abs(a.fees - 150) < 0.01, a.fees);
  const dining = a.movers.find((x) => x.cat === 'Dining');
  ok('Dining jumped in October by the restaurant bill', dining && Math.abs(dining.diff - 3000) < 0.01, a.movers);
  ok('Rent, which did not change, is not called a change', !a.movers.some((x) => x.cat === 'Rent & Bills'), a.movers);
  const netflix = a.recurring.find((r) => r.name === 'Netflix'), spotify = a.recurring.find((r) => r.name === 'Spotify');
  ok('Netflix is recurring at 229.99 a month', netflix && Math.abs(netflix.monthly - 229.99) < 0.01 && !netflix.stopped, netflix);
  ok('Spotify stopped in October and says so', spotify && spotify.stopped, spotify);
  ok('the monthly total leaves out what stopped', a.recurring.filter((r) => !r.stopped).every((r) => r.name !== 'Spotify') && Math.abs(a.recurringMonthly - a.recurring.filter((r) => !r.stopped).reduce((s, r) => s + r.monthly, 0)) < 0.01);
  ok('the weekly shop is not a one-off, and neither is a fee', !a.oneOffs.some((t) => /Migros|Card fee/.test(t.merchant)), a.oneOffs.map((t) => t.merchant));
  ok('a one-off restaurant bill is not recurring', !a.recurring.some((r) => r.name === 'Nusr-Et') && a.oneOffs.some((t) => t.merchant === 'Nusr-Et'), a.oneOffs.map((t) => t.merchant));
  const sat = a.weekdays.find((w) => w.label === 'Sat');
  const topDay = a.weekdays.slice().sort((x, y) => y.value - x.value)[0];
  ok('Saturday — the Migros day — is the most expensive, once rent is left out', topDay.label === 'Sat', a.weekdays);
  ok('the weekly shop and the coffee are habits, not recurring payments', !a.recurring.some((r) => r.name === 'Migros' || r.name === 'Starbucks'), a.recurring.map((r) => r.name));
  ok('rent and Netflix are recurring payments', a.recurring.some((r) => r.name === 'Rent') && a.recurring.some((r) => r.name === 'Netflix'));
  ok('small purchases find the coffees', a.small.top.some((x) => x.name === 'Starbucks' && x.n === 18), a.small.top);
  ok('and leave subscriptions out of them', !a.small.top.some((x) => /Netflix|Spotify/.test(x.name)), a.small.top);

  console.log('\n— on the screen —');
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(400);
  await p.evaluate(() => Flow.Nav.go('finance')); await p.waitForTimeout(1500);
  const ui = await p.evaluate(() => {
    const box = document.getElementById('fx-habits');
    return { text: box ? box.textContent.replace(/\s+/g, ' ') : '', months: box ? box.querySelectorAll('.hb-mo').length : 0, part: box ? box.querySelectorAll('.hb-mo.hb-part').length : 0 };
  });
  ok('four months are drawn, the partial one paler', ui.months === 4 && ui.part === 1, ui);
  ok('it heads with the average month and October vs September', /Average month/.test(ui.text) && /Oct vs Sep/.test(ui.text), ui.text.slice(0, 300));
  ok('what changed names Dining', /What changed in Oct/.test(ui.text) && /Dining/.test(ui.text), ui.text);
  ok('recurring shows Netflix per month and Spotify as not seen lately', /Netflix/.test(ui.text) && /not seen lately/.test(ui.text), ui.text);
  ok('the day-of-week line names a day and the weekend share', /is your most expensive day/.test(ui.text) && /Weekends are \d+% of it/.test(ui.text), ui.text);
  ok('payments, transfers and fees are listed', /Paid off cards/.test(ui.text) && /Transfers out/.test(ui.text) && /Fees & interest/.test(ui.text));
  ok('the other-currency line is mentioned', /1 in other currencies left out/.test(ui.text));

  console.log('\n— it follows what you upload and remove —');
  const after = await p.evaluate(async () => {
    const list = await FlowStatement.list();
    const nov = list.find((x) => x.from === '2026-11-01');
    document.querySelector('[data-fa="stmtDel"][data-id="' + nov.id + '"]');
    window.confirm = () => true;
    document.querySelector('[data-fa="stmtDel"][data-id="' + nov.id + '"]').click();
    await new Promise((r) => setTimeout(r, 1200));
    return document.querySelectorAll('#fx-habits .hb-mo').length;
  });
  ok('removing a statement redraws the habits without it', after === 3, after);

  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  ok('it fits a phone', await p.evaluate(() => { const c = document.getElementById('fx-habitcard'); return !!c && c.scrollWidth <= c.clientWidth + 2 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1; }),
    await p.evaluate(() => { const c = document.getElementById('fx-habitcard'); return c && [c.scrollWidth, c.clientWidth, document.documentElement.scrollWidth]; }));
  if (process.env.SHOT) await p.locator('#fx-habitcard').screenshot({ path: process.env.SHOT + '-phone.png' });
  await p.setViewportSize({ width: 1280, height: 900 }); await p.waitForTimeout(500);
  if (process.env.SHOT) await p.locator('#fx-habitcard').screenshot({ path: process.env.SHOT + '-desk.png' });

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
