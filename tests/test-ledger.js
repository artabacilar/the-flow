/* One ledger.
 *
 * Two forms used to write two stores: the first Finances form (budget, the
 * Spend tile on Today) wrote ld_finance; receipts, statement import and the
 * newer form wrote flow:expenses. An expense showed on one screen and not the
 * other. This checks that every reader now sees both, that new expenses land
 * in one place, that nothing already saved moves or disappears, and that a
 * different currency is never added in as if it were the same money. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 260) : ''))); };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);

  console.log('\n— what was already saved, in both stores —');
  const r = await p.evaluate(async () => {
    await Flow.Settings.set('currency', 'TRY');
    const t = todayStr;
    fnData.monthly[NOW_MONTH] = [{ id: 'old1', date: t, cat: 'food', amt: 100, note: 'Migros (old form)' }];
    fnSave();
    await FlowLedger.add({ date: t, amount: 50, merchant: 'Starbucks', category: 'Dining', currency: 'TRY', source: 'manual' });
    await FlowLedger.add({ date: t, amount: 20, merchant: 'Amazon US', category: 'Shopping', currency: 'USD', source: 'csv' });
    renderFinance(); Flow.Nav.go('today'); await new Promise((r) => setTimeout(r, 600));
    const tile = document.querySelector('[data-tile="spend"], .flow-td-pulse [data-k="spend"]') || [...document.querySelectorAll('.flow-td-pulse > *')].find((e) => /Spend/i.test(e.textContent));
    return { spent: document.getElementById('fnSpent').textContent, tile: tile ? tile.textContent : null, n: FlowLedger.all().length };
  });
  ok('every reader sees both stores (3 rows)', r.n === 3, r);
  ok('the budget summary counts both forms, in lira, and not the dollars', /150/.test(r.spent) && !/170/.test(r.spent), r.spent);
  ok('Today\'s Spend tile is the same number', r.tile && /150/.test(r.tile) && !/170/.test(r.tile), r.tile);

  await p.evaluate(() => Flow.Nav.go('finance')); await p.waitForTimeout(900);
  const ui = await p.evaluate(() => {
    const sub = [...document.querySelectorAll('[data-flow-finance] .flow-sub')].map((e) => e.textContent).find((t) => /expenses? · /.test(t)) || '';
    const rows = [...document.querySelectorAll('[data-flow-finance] .flow-table tbody tr')].map((tr) => tr.textContent);
    return { sub, rows: rows.length, old: rows.some((t) => /Migros/.test(t)) };
  });
  ok('the charts card has the same total and says what it left out', /150/.test(ui.sub) && /not counted/.test(ui.sub) && /\$|USD/.test(ui.sub), ui.sub);
  ok('the old form\'s expense is in Recent expenses too', ui.old, ui);

  console.log('\n— new expenses go to one place —');
  const w = await p.evaluate(async () => {
    const before = (fnData.monthly[NOW_MONTH] || []).length;
    document.getElementById('fnAmt').value = '30'; document.getElementById('fnCat').value = 'transport'; document.getElementById('fnNote').value = 'Taxi';
    document.getElementById('fnAdd').click();
    await new Promise((r) => setTimeout(r, 500));
    const it = Flow.Finance.items.find((x) => x.merchant === 'Taxi');
    return { before, after: (fnData.monthly[NOW_MONTH] || []).length, it: it && { cat: it.category, b: it.budgetCat, src: it.source }, spent: document.getElementById('fnSpent').textContent };
  });
  ok('the first form now writes to the shared ledger, not the old store', w.after === w.before && w.it && w.it.cat === 'Transport' && w.it.b === 'transport', w);
  ok('and the budget summary includes it', /180/.test(w.spent), w.spent);

  console.log('\n— deleting removes it from wherever it lives —');
  const d = await p.evaluate(async () => {
    await FlowLedger.remove('ld:' + NOW_MONTH + ':old1');
    const old = (fnData.monthly[NOW_MONTH] || []).length;
    const stored = JSON.parse(localStorage.getItem('ld_finance') || '{}');
    return { old, storedOld: ((stored.monthly || {})[NOW_MONTH] || []).length, spent: document.getElementById('fnSpent').textContent, n: FlowLedger.all().length };
  });
  ok('an old-form expense is deleted from the old store', d.old === 0 && d.storedOld === 0, d);
  ok('and every total moves with it', /80/.test(d.spent) && d.n === 3, d);
  ok('the receipt card no longer claims nothing is uploaded', await p.evaluate(() => !/nothing is uploaded anywhere/.test(document.body.textContent)));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
