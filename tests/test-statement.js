/* Bank statements.
 *
 * A statement is the most sensitive file anyone will hand the app, and the
 * one most likely to come out subtly wrong. So this proves: every format a
 * Turkish bank actually exports is opened (xlsx, HTML-as-xls, CSV in either
 * encoding, PDF), an old binary .xls is refused with a way forward, card
 * numbers and IBANs never survive, a reply that ran out of room keeps what
 * arrived whole, the job belongs to the account that started it, and in the
 * page the report adds up, the import skips what is already there, and the
 * file is not what gets kept. None of this calls the real API. */
const fs = require('fs');
const path = require('path');
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const S = require('../flow-extras.js')._internals.statement;
const H = 'http://localhost:4222';
const FX = path.join(__dirname, 'fixtures');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 260) : ''))); };

const REPLY = {
  bank: 'Garanti BBVA', account: 'Bonus card 4543123456789012', currency: 'TRY', from: '2026-10-01', to: '2026-10-31', opening: null, closing: null,
  tx: [
    ['2026-10-01', 'Migros', -412.5, 'TRY', 'Groceries', 'spend'],
    ['2026-10-03', 'Netflix', -229.99, 'TRY', 'Subscriptions', 'spend'],
    ['2026-10-05', 'Salary — ABKO', 85000, 'TRY', 'Other', 'income'],
    ['2026-10-08', 'Migros', -401.2, 'TRY', 'Groceries', 'spend'],
    ['2026-10-10', 'Havale — 4543 1234 5678 9012', -5000, 'TRY', 'Other', 'transfer'],
    ['2026-10-12', 'Card fee', -150, 'TRY', 'Other', 'fee'],
    ['2026-10-14', 'Amazon US', -20, 'USD', 'Shopping', 'spend'],
    ['2026-10-20', 'Payment to card', 3000, 'TRY', 'Other', 'card-payment']
  ]
};

(async () => {
  console.log('\n— every export a bank gives you is opened —');
  const x = S.prepareStatement(fs.readFileSync(path.join(FX, 'statement-sample.xlsx')));
  ok('an .xlsx becomes rows of text', x.kind === 'xlsx' && /MIGROS KADIKOY/.test(x.text), x);
  ok('its dates come out as dates, not Excel day numbers', /2026-10-01\tMIGROS/.test(x.text), x.text);
  ok('and a balance is not left as 94770.00999999', /94770\.01/.test(x.text) && !/0099999/.test(x.text));
  const h = S.prepareStatement(fs.readFileSync(path.join(FX, 'statement-sample-html.xls')));
  ok('an HTML table saved as .xls is flattened', h.kind === 'html' && h.text === 'İşlem Tarihi\tAçıklama\tTutar\n01.10.2026\tMİGROS & CO\t-412,50', h);
  const old = S.prepareStatement(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  ok('an old binary .xls is refused, with what to do instead', /old-style/.test(old.error || '') && /PDF|xlsx/.test(old.error), old);
  ok('a PDF is passed on as a document', S.prepareStatement(Buffer.from('%PDF-1.7\n...')).kind === 'pdf');
  const w1254 = Buffer.from([0x54, 0x61, 0x72, 0x69, 0x68, 0x3b, 0x41, 0xe7, 0xfd, 0x6b, 0x6c, 0x61, 0x6d, 0x61, 0x0a]);  /* "Tarih;Açıklama" in Windows-1254 */
  ok('a CSV in the Turkish Windows code page is decoded', S.decodeText(w1254).indexOf('Açıklama') > 0, S.decodeText(w1254));
  ok('a binary that is not a statement is refused', /cannot be read/.test(S.prepareStatement(Buffer.from([1, 2, 3, 0, 5, 6, 7, 8, 9, 10])).error || ''));

  console.log('\n— card numbers and IBANs do not survive —');
  const masked = S.maskNumbers('Card 4543 1234 5678 9012, IBAN TR12 0006 2000 1234 0006 2987 65, on 2026-10-01 for 94770.01');
  ok('a card number keeps only its last four', /••9012,/.test(masked) && !/4543/.test(masked), masked);
  ok('an IBAN is removed', !/TR12/.test(masked) && /IBAN/.test(masked), masked);
  ok('dates and amounts are left alone', /2026-10-01/.test(masked) && /94770\.01/.test(masked), masked);

  console.log('\n— the reply —');
  const cats = ['Groceries', 'Subscriptions', 'Shopping', 'Other'];
  const r = S.parseStatementReply('Sure — ' + JSON.stringify(REPLY) + ' hope that helps', cats);
  ok('prose around the JSON is ignored', r && r.tx.length === 8, r && r.tx.length);
  ok('the account keeps only the last four digits', r.account === 'Bonus card ••9012', r.account);
  ok('a card number inside a description is masked too', r.tx[4].merchant === 'Havale — ••9012', r.tx[4].merchant);
  ok('signs and kinds are kept', r.tx[0].amount === -412.5 && r.tx[2].kind === 'income' && r.tx[7].kind === 'card-payment');
  const odd = S.parseStatementReply(JSON.stringify({ tx: [['2026-10-01', 'X', -5, 'TRY', 'Made up', 'whatever'], ['nope', 'Y', 1], ['2026-10-02', 'Z', 0, 'TRY']] }), cats);
  ok('an unknown category becomes Other and an unknown kind is inferred', odd.tx.length === 1 && odd.tx[0].category === 'Other' && odd.tx[0].kind === 'spend', odd);
  ok('the period falls back to the dates seen', odd.from === '2026-10-01' && odd.to === '2026-10-01', odd);
  const cut = S.parseStatementReply('{"bank":"Akbank","currency":"TRY","tx":[["2026-10-01","A",-1,"TRY","Other","spend"],["2026-10-02","B",-2,"TRY","Other","spend"],["2026-10-0', cats, true);
  ok('a reply that ran out of room keeps every whole row and says it is partial', cut.tx.length === 2 && cut.partial && cut.bank === 'Akbank', cut);
  ok('a reply with nothing in it is nothing', S.parseStatementReply('I could not read that.', cats) === null);

  console.log('\n— the job belongs to whoever started it —');
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  let sent = null;
  S.setPoster(async (url, headers, payload) => { sent = payload; return { status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(REPLY) }] } }; });
  const counters = {};
  const ctxFor = (id, body) => {
    const out = {};
    return {
      out,
      ctx: {
        user: { id }, readBody: async () => JSON.stringify(body || {}),
        json: (res, code, obj) => { out.code = code; out.body = obj; },
        counter: { get: async (k) => counters[id + k] || 0, set: async (k, v) => { counters[id + k] = v; } }
      }
    };
  };
  const csv = Buffer.from('Tarih,Açıklama,Tutar\n01.10.2026,MIGROS 4543 1234 5678 9012,-412.50\n').toString('base64');
  const a = ctxFor('u1', { name: 'x.csv', data: csv, categories: cats });
  await S.handle('/api/flow/statement', { method: 'POST', url: '/api/flow/statement' }, {}, a.ctx);
  ok('a statement starts a job straight away', a.out.code === 202 && a.out.body.job, a.out);
  ok('the card number was masked before it was sent', sent && !/4543 1234/.test(JSON.stringify(sent.messages)) && /••9012/.test(JSON.stringify(sent.messages)));
  ok('the categories travel with it', /Subscriptions/.test(JSON.stringify(sent.messages)));
  await new Promise((res) => setTimeout(res, 50));
  const g = ctxFor('u1');
  await S.handle('/api/flow/statement', { method: 'GET', url: '/api/flow/statement?job=' + a.out.body.job }, {}, g.ctx);
  ok('asking again gives the transactions', g.out.body.status === 'done' && g.out.body.tx.length === 8, g.out.body);
  const other = ctxFor('u2');
  await S.handle('/api/flow/statement', { method: 'GET', url: '/api/flow/statement?job=' + a.out.body.job }, {}, other.ctx);
  ok('another account cannot read it', other.out.code === 404, other.out);
  const pdfJob = ctxFor('u1', { name: 's.pdf', data: Buffer.from('%PDF-1.4 fake').toString('base64') });
  await S.handle('/api/flow/statement', { method: 'POST', url: '/api/flow/statement' }, {}, pdfJob.ctx);
  ok('a PDF goes as a document block', sent.messages[0].content[0].type === 'document' && sent.messages[0].content[0].source.media_type === 'application/pdf');
  const bad = ctxFor('u1', { name: 'old.xls', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]).toString('base64') });
  const before = counters['u1' + 'stmt:' + new Date().toISOString().slice(0, 10)];
  await S.handle('/api/flow/statement', { method: 'POST', url: '/api/flow/statement' }, {}, bad.ctx);
  ok('a refused file is refused at once, and does not count against the day', bad.out.code === 415 && counters['u1' + 'stmt:' + new Date().toISOString().slice(0, 10)] === before, bad.out);
  S.setPoster(async () => ({ status: 200, body: { content: [{ type: 'text', text: 'There are no transactions here.' }] } }));
  const empty = ctxFor('u1', { name: 'x.csv', data: csv });
  await S.handle('/api/flow/statement', { method: 'POST', url: '/api/flow/statement' }, {}, empty.ctx);
  await new Promise((res) => setTimeout(res, 50));
  const eg = ctxFor('u1');
  await S.handle('/api/flow/statement', { method: 'GET', url: '/api/flow/statement?job=' + empty.out.body.job }, {}, eg.ctx);
  ok('a file with no transactions says so plainly', eg.out.body.status === 'error' && /No transactions/.test(eg.out.body.error), eg.out.body);
  S.setPoster(null);

  console.log('\n— in the app —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let posted = null, polls = 0;
  await p.route('**/api/flow/statement**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      posted = JSON.parse(req.postData() || '{}');
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, job: 'j1', kind: 'xlsx' }) });
    }
    polls++;
    if (polls < 2) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'working', seconds: 3 }) });
    const reply = S.parseStatementReply(JSON.stringify(REPLY), ['Groceries', 'Dining', 'Subscriptions', 'Shopping', 'Other']);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({ ok: true, status: 'done' }, reply)) });
  });
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    await Flow.Settings.set('currency', 'TRY');
    /* Already typed in by hand — the import must not count it twice. */
    await FlowLedger.add({ date: '2026-10-01', amount: 412.5, merchant: 'Migros', category: 'Groceries', currency: 'TRY', source: 'manual' });
    Flow.Nav.go('finance');
  });
  await p.waitForTimeout(900);
  ok('the card asks for PDF, Excel or CSV', await p.evaluate(() => {
    const i = document.getElementById('fx-csv');
    return !!i && /\.pdf/.test(i.accept) && /\.xlsx/.test(i.accept) && /\.csv/.test(i.accept);
  }));
  await p.setInputFiles('#fx-csv', path.join(FX, 'statement-sample.xlsx'));
  await p.waitForSelector('.fx-report', { timeout: 15000 }).catch(() => {});
  ok('the file went up as base64 with its name and your categories', posted && posted.name === 'statement-sample.xlsx' && posted.data.length > 100 && Array.isArray(posted.categories), posted && { name: posted.name, n: (posted.data || '').length });
  ok('it waited while the statement was being read', polls >= 2, polls);
  const rep = await p.evaluate(() => {
    const t = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
    const tiles = [...document.querySelectorAll('.fx-tile')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
    return { head: t('.fx-rh'), tiles, add: t('.fx-addbar'), recur: [...document.querySelectorAll('.fx-rlist')].map((e) => e.textContent.replace(/\s+/g, ' ')), all: t('.fx-all summary'), other: t('.fx-report .flow-sub + .flow-sub') || document.querySelector('.fx-report').textContent };
  });
  ok('the report names the bank and only the last four digits', /Garanti BBVA/.test(rep.head) && /••9012/.test(rep.head) && !/4543/.test(rep.head), rep.head);
  /* out = 412.50 + 229.99 + 401.20 + 150 fee = 1,193.69; in = 85,000 (the card payment and the transfer are neither). */
  ok('money out counts spending and fees, not transfers or the dollar line', rep.tiles.some((x) => /Money out/.test(x) && /1[.,]193[.,]69/.test(x)), rep.tiles);
  ok('money in is the salary, not the card payment', rep.tiles.some((x) => /Money in/.test(x) && /85[.,]000/.test(x)), rep.tiles);
  ok('fees are shown on their own', rep.tiles.some((x) => /Fees/.test(x) && /150/.test(x)), rep.tiles);
  ok('the dollar line is mentioned, not added in', /another currency/.test(rep.other));
  ok('Migros twice at much the same price is recurring, and Netflix as a subscription', rep.recur[1] && /Migros/.test(rep.recur[1]) && /Netflix/.test(rep.recur[1]), rep.recur);
  ok('the expense you typed already is spotted before importing', /4 expenses to add/.test(rep.add) && /1 already/.test(rep.add), rep.add);
  ok('every line can be checked', /Every line \(8\)/.test(rep.all), rep.all);

  const kept = await p.evaluate(async () => {
    const list = await FlowStatement.list();
    const full = list[0] ? await FlowStatement.get(list[0].id) : null;
    return { n: list.length, lines: full && full.tx.length, hasFile: !!(full && JSON.stringify(full).match(/UEsDB|base64|data:/)) };
  });
  ok('the report is kept, as lines', kept.n === 1 && kept.lines === 8, kept);
  ok('and the file itself is not', kept.hasFile === false, kept);

  if (process.env.SHOT) await p.locator('.fx-report').screenshot({ path: process.env.SHOT + '-desk.png' });
  const n0 = await p.evaluate(() => FlowLedger.all().length);
  await p.click('[data-fa="stmtImport"]'); await p.waitForTimeout(1200);
  const after = await p.evaluate(() => ({
    n: FlowLedger.all().length,
    rows: FlowLedger.all().filter((x) => x.source === 'statement').map((x) => x.merchant + ':' + x.amount + ':' + x.currency),
    add: (document.querySelector('.fx-addbar') || {}).textContent || ''
  }));
  ok('importing adds the four new expenses, not the one already there', after.n - n0 === 4, after);
  ok('spending and the fee, never income, transfers or the card payment', after.rows.length === 4 && !after.rows.some((r) => /Salary|Havale|Payment/.test(r)), after.rows);
  ok('the dollar purchase keeps its own currency', after.rows.some((r) => /Amazon US:20:USD/.test(r)), after.rows);
  ok('the report then says it was added', /Added to your expenses/.test(after.add), after.add);
  const m0 = await p.evaluate(() => FlowLedger.all().length);
  await p.fill('#fx-amt', '12'); await p.fill('#fx-merch', 'Simit');
  await p.click('[data-fa="addManual"]'); await p.waitForTimeout(800);
  ok('after the screen repaints, Add expense still adds exactly one', await p.evaluate(() => FlowLedger.all().length) - m0 === 1, await p.evaluate(() => FlowLedger.all().length) - m0);
  ok('and the statement is listed for later', await p.evaluate(() => /Garanti BBVA/.test((document.getElementById('fx-stmtpast') || {}).textContent || '') && /added ✓/.test(document.getElementById('fx-stmtpast').textContent)));

  console.log('\n— a phone can use it —');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  ok('the report fits a phone without sideways scrolling', await p.evaluate(() => {
    const r = document.querySelector('.fx-report'); return !!r && r.scrollWidth <= r.clientWidth + 2 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
  }), await p.evaluate(() => { const r = document.querySelector('.fx-report'); return r && [r.scrollWidth, r.clientWidth, document.documentElement.scrollWidth]; }));

  if (process.env.SHOT) await p.locator('#fx-stmt').screenshot({ path: process.env.SHOT + '-phone.png' });
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
