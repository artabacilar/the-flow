/* Sales reports, reviewed by the Finance assistant.
 *
 * What would make it wrong: a report misread (customer blocks, the two code
 * columns TigerLogo swaps between blocks, subtotals counted as sales); free
 * goods, price differences or repeated lines missed; a review started with no
 * numbers in it, or by an agent who is not Finance; a file that is not a
 * sales report accepted; or the room offering no way to add one. All names
 * below are made up. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const S = require('../flow-sales.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

const T = (cells) => cells.join('\t');
const CAMP = '60 Adet Amonyaklı Boyaya 120 Adet Amonyaksız Bedelsiz';
const REPORT = [
  'Cari Hesaplara Göre Satış Dağılımı',
  T(['Malzeme(Sınıfı)Kodu', '', 'Cari Hesap Kodu', 'Malzeme(Sınıfı)Açıklaması', 'Birim Seti', 'Satış Miktarı', 'Satış Tutarı']),
  T(['-', 'Cari Hesap Unvanı : ÖRNEK KUAFÖR - AYŞE TEST', '', '', '', '', '', 'TARİH', 'TEMSİLCİ', 'KAMPANYA KODU']),
  T(['', 'CN-001', '0014 AA11', '1.0 BOYA 100 ML', 'ADET', '60', '13500', '2026-06-25', 'REP BİR', 'CNK2606-01', CAMP]),
  T(['', 'CN-002', '0014 AA11', '2.0 AMONYAKSIZ BOYA', 'ADET', '120', '0.12', '2026-06-25', 'REP BİR', 'CNK2606-01', CAMP]),
  T(['', 'Y-HİZMET.9', '0014 AA11', 'FİYAT FARKI', 'ADET', '1', '500', '2026-07-01', 'REP BİR', 'KAMPANYASIZ']),
  T(['', '', '', '', '', '', '14000.12']),
  T(['-', 'Cari Hesap Unvanı : DENEME SALON', '', '', '', '', '', 'TARİH', 'TEMSİLCİ', 'KAMPANYA KODU']),
  /* this block has the account first and the product code second */
  T(['', '0020 BB22', 'CN-001', '1.0 BOYA 100 ML', 'ADET', '10', '4500', '2026-08-02', 'REP İKİ', 'KAMPANYASIZ']),
  T(['', '0020 BB22', 'CN-001', '1.0 BOYA 100 ML', 'ADET', '10', '4500', '2026-08-02', 'REP İKİ', 'KAMPANYASIZ']),
  T(['', '0020 BB22', 'CN-009', 'POŞET', 'ADET', '5', '0.4', 'X', 'REP İKİ', 'KAMPANYASIZ']),
  T(['', '', '', '', '', '', '9999'])
].join('\n');

(async () => {
  console.log('\n— reading the export —');
  const p = S.parse(REPORT);
  ok('every product line is read, headings and subtotals are not', p.lines.length === 6 && p.subtotals.length === 2, p.lines && p.lines.length);
  ok('a line carries its customer from the block heading', p.lines[0].customer === 'ÖRNEK KUAFÖR - AYŞE TEST' && p.lines[3].customer === 'DENEME SALON');
  ok('the swapped code columns are put right: the product code is the code, "0020 BB22" the account', p.lines[3].code === 'CN-001' && p.lines[3].account === '0020 BB22' && p.lines[0].code === 'CN-001' && p.lines[0].account === '0014 AA11', p.lines[3]);
  ok('rep, date, campaign and its terms come along', p.lines[0].rep === 'REP BİR' && p.lines[0].date === '2026-06-25' && p.lines[0].campaign === 'CNK2606-01' && p.lines[0].campaignText === CAMP);
  const a = S.analyze(p);
  ok('totals, customers, reps and the date range', Math.round(a.total) === 23001 && a.customers === 2 && a.reps === 2 && a.from === '2026-06-25' && a.to === '2026-08-02', { total: a.total, c: a.customers, r: a.reps, from: a.from, to: a.to });
  ok('free-of-charge lines are counted, by campaign', a.free.lines === 2 && a.free.byCampaign[0].code === 'CNK2606-01' && a.free.byCampaign[0].qty === 120, a.free);
  ok('the same product at a different unit price is found', a.spread.length === 1 && a.spread[0].code === 'CN-001' && Math.round(a.spread[0].lo) === 225 && Math.round(a.spread[0].hi) === 450, a.spread);
  ok('"FİYAT FARKI" lines, missing dates and repeated lines are caught', a.priceDiff.lines === 1 && a.noDate.lines === 1 && a.dupCount === 1, { pd: a.priceDiff, nd: a.noDate, d: a.dupCount });
  ok('a subtotal that does not match its lines is caught; one that does is not', a.subtotalChecked === 2 && a.subtotalOff.length === 1 && a.subtotalOff[0].customer === 'DENEME SALON', a.subtotalOff);
  const b = S.brief(a, 'test.xlsx', 'Haziran kampanyalarına bak');
  ok('the brief carries the numbers and asks for campaign terms, discounts, reps and data quality, in Turkish', /23\.000,52 TL/.test(b) && /CNK2606-01/.test(b) && /Kampanya uyumu/.test(b) && /Veri kalitesi/.test(b) && /Haziran kampanyalarına bak/.test(b) && /Hiçbir şey dışarı gönderme/.test(b));
  ok('a CSV with ; and decimal commas is read too', (() => { const c = S.parse('Ürün Kodu;Açıklama;Miktar;Tutar;Tarih;Temsilci\nA-1;Şampuan;2;"1.250,50";2026-09-01;Rep\n'); return c.lines && c.lines[0].amount === 1250.5 && c.lines[0].qty === 2; })());
  ok('a file with no quantity or amount is refused', !!S.parse('name,email\nx,y').error);

  console.log('\n— the review starts —');
  const mem = {}; const tasks = []; const logs = [];
  const ctx = { get: async (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : null), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
  const deps = { agents: async () => [{ id: 'jarvis', name: 'J.A.R.V.I.S.', role: 'Chief of staff' }, { id: 'finance', name: 'Finance assistant', role: 'Finance' }], tasks: async () => tasks, newTask: async (c, u, f) => { const t = Object.assign({ id: 't' + (tasks.length + 1), status: 'queued' }, f); tasks.push(t); return t; }, log: async (c, w, x) => logs.push(x), decodeText: (b) => b.toString('utf8') };
  const r = await S.ingest(ctx, deps, 'u1', { name: 'test.csv', data: Buffer.from(REPORT), via: 'telegram', note: 'kontrol et' });
  ok('the Finance assistant is put on it at once, with the counted numbers as the brief', r.ok && tasks.length === 1 && tasks[0].agent === 'finance' && tasks[0].lang === 'tr' && tasks[0].via === 'sales' && /CNK2606-01/.test(tasks[0].brief) && /kontrol et/.test(tasks[0].brief), tasks[0] && { agent: tasks[0].agent, via: tasks[0].via });
  ok('the report is kept (without its lines) and listed with the review\'s status', mem['team:sales'].length === 1 && mem['team:sales'][0].task === 't1' && (await S.view(ctx, deps))[0].status === 'queued' && !r.report.analysis, mem['team:sales']);
  ok('he is told who is on it, in English and Turkish', /Finance assistant is reviewing "test\.csv": 6 lines, 2 customers/.test(r.say) && /raporunu inceliyor/.test(r.sayTr), r.say);
  const none = await S.ingest(ctx, Object.assign({}, deps, { agents: async () => [{ id: 'jarvis', name: 'J.A.R.V.I.S.', role: 'Chief of staff' }] }), 'u1', { name: 'x.csv', text: REPORT });
  ok('with no Finance assistant on the team, it says so and starts nothing', none.ok && /no Finance assistant/.test(none.say) && tasks.length === 1);
  mem['team:paused'] = true;
  const paused = await S.ingest(ctx, deps, 'u1', { name: 'y.csv', text: REPORT });
  ok('while the team is paused nothing starts', paused.ok && tasks.length === 1 && /could not start/.test(paused.say)); delete mem['team:paused'];
  ok('an old .xls is refused with what to do', /save it as \.xlsx/.test((await S.ingest(ctx, deps, 'u1', { name: 'z.xls', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) })).error || ''));

  console.log('\n— in the command centre —');
  const br = await chromium.launch();
  const bc = await br.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const pg = await bc.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(H + '/', { waitUntil: 'load' }); await pg.waitForTimeout(2500);
  await pg.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await pg.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await pg.fill('#fa-name', 'Artur'); await pg.fill('#fa-pw', 'a properly long password');
  await submitAuth(pg); await pg.waitForTimeout(4500);
  await pg.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await pg.evaluate(async () => { await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); });
  await pg.evaluate(() => FlowHud.open()); await pg.waitForTimeout(1200);
  await pg.click('#flow-hud .hud-ag[data-ag="finance"]'); await pg.waitForTimeout(1200);
  ok('the Finance assistant\'s room has Sales reports with a way to add one', await pg.evaluate(() => !!document.querySelector('#flow-hud [data-k="sales"] input[type=file][data-team-sales]')));
  await pg.click('#flow-hud .hud-ag[data-ag="sarah"]'); await pg.waitForTimeout(600);
  ok('…and other agents\' rooms do not', await pg.evaluate(() => !document.querySelector('#flow-hud [data-k="sales"]')));
  await pg.click('#flow-hud .hud-ag[data-ag="finance"]'); await pg.waitForTimeout(800);
  await pg.setInputFiles('#flow-hud input[data-team-sales]', { name: 'satis.csv', mimeType: 'text/csv', buffer: Buffer.from(REPORT) });
  await pg.waitForTimeout(2500);
  const v = await pg.evaluate(() => ({ rows: [...document.querySelectorAll('#flow-hud [data-k="sales"] .hud-pjt')].map((x) => x.textContent), tasks: (FlowTeam.data.tasks || []).filter((t) => t.via === 'sales').map((t) => t.agent) }));
  ok('adding the file lists the report and puts Finance on the review', v.rows.length === 1 && /satis\.csv/.test(v.rows[0]) && /6 lines/.test(v.rows[0]) && v.tasks[0] === 'finance', v);
  const bad = await pg.evaluate(async () => { const r = await fetch('/api/team/sales', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'n.csv', text: 'name,email\nx,y' }) }); return r.status; });
  ok('a file that is not a sales report is refused by the server', bad === 400);
  ok('no page errors', errs.length === 0, errs);
  await br.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
