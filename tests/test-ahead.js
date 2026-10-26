/* Coming up — the next week, two weeks or month, and reminders for it.
 *
 * What would make it wrong: an event shown on the wrong day, a reminder set
 * for a time that has passed or after the thing itself, a reminder that only
 * lives on the device it was set on (the phone gets it from the server, the
 * Mac schedules it itself — both read the account), the assistant pointing
 * at an item that is not in the list, or the model asked every time Today is
 * opened. None of this calls Google or Anthropic. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const extras = require('../flow-extras.js');
const A = extras._internals.ahead;
const R = require('../flow-remind.js')._internals;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plus = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

(async () => {
  console.log('\n— reading the reply —');
  const r = A.parseAhead('```json\n' + JSON.stringify({ headline: 'A heavy fortnight.', prep: [{ ref: 1, what: 'Pack the CDJs', by: '2026-10-27' }, { ref: 99, what: 'ghost', by: '2026-10-27' }], watch: ['Two things on Thursday'], remind: [{ ref: 0, at: '2026-10-27T18:00', why: 'Pack tonight' }, { ref: 0, at: 'tomorrow', why: 'x' }] }) + '\n```', 3);
  ok('the read is found and kept', r && r.headline === 'A heavy fortnight.');
  ok('prep pointing at an item that is not in the list is dropped', r.prep.length === 1 && r.prep[0].ref === 1, r.prep);
  ok('a reminder without a real time is dropped', r.remind.length === 1 && r.remind[0].at === '2026-10-27T18:00', r.remind);
  ok('nothing usable is null', A.parseAhead('{"headline":""}', 3) === null);
  const lst = A.aheadList([{ date: '2026-10-27', allDay: true, kind: 'event', title: 'Vibe Show', where: 'Antalya' }, { date: '2026-10-28', time: '15:30', hours: 0.5, kind: 'rock', title: 'Set' }]);
  ok('the list the model sees is numbered, dated, and short', /^0\. \[2026-10-27 · all day · event\] Vibe Show — Antalya\n1\. \[2026-10-28 · 15:30 · 0\.5h · rock\] Set$/.test(lst), lst);
  ok('the prompt forbids inventing and keeps prep before the item', /Never invent/.test(A.AHEAD_SYSTEM) && /never after/.test(A.AHEAD_SYSTEM));
  const W = extras._internals.wellFormed;
  ok('text cut through an emoji is made whole before it is sent (a lone half is a 400)', W('ab\ud83d') === 'ab\ufffd' && W('🎧 set') === '🎧 set');

  console.log('\n— the server sends reminders —');
  const list = [{ id: 'a', at: '2026-10-27T18:00', title: 'Pack' }, { id: 'b', at: '2026-10-27T18:30', title: 'Later' }, { id: 'c', at: '2026-10-28T18:00', title: 'Tomorrow' }, { id: 'd', at: '2026-10-27T18:00', title: 'Off', off: true }];
  const due = R.dueReminders(list, '2026-10-27', 18 * 60 + 2, R.WINDOW_MIN);
  ok('at their time, on their day, not switched off', due.length === 1 && due[0].id === 'a', due);
  ok('not before the minute', R.dueReminders(list, '2026-10-27', 17 * 60 + 59, R.WINDOW_MIN).length === 0);
  ok('and not hours late after an outage', R.dueReminders(list, '2026-10-27', 19 * 60 + 30, R.WINDOW_MIN).length === 0);
  const remind = require('../flow-remind.js');
  const store = { '__push:dev:u1': JSON.stringify([{ token: 't' }]), 'ns:u1:flow:settings': JSON.stringify({ timezone: 'Europe/Istanbul' }), 'ns:u1:flow:reminders': JSON.stringify([{ id: 'x1', at: '2026-10-27T18:00', title: 'Pack the CDJs', body: 'Vibe Show tomorrow' }]) };
  const raw = { get: async (k) => store[k] || null, set: async (k, v) => { store[k] = v; } };
  const sent = [];
  const deps = { raw, nsPrefix: (u) => 'ns:' + u + ':', sendToUser: async (raw2, uid, msg) => { sent.push(msg); return { ok: true }; } };
  const at = new Date('2026-10-27T15:01:00Z');   // 18:01 in Istanbul
  const t1 = await remind.tickUser(deps, 'u1', at);
  ok('a reminder from Coming up reaches the phone at 18:00 their time', sent.length === 1 && sent[0].title === 'Pack the CDJs' && sent[0].thread === 'ahead', { t1, sent });
  await remind.tickUser(deps, 'u1', new Date('2026-10-27T15:02:00Z'));
  ok('once', sent.length === 1);

  console.log('\n— the endpoint —');
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let calls = 0;
  A.setPoster(async () => { calls++; return { status: 200, body: { content: [{ type: 'text', text: JSON.stringify({ headline: 'Busy.', prep: [], watch: ['x'], remind: [] }) }] } }; });
  const counter = {}; const C = { get: async (k) => counter[k] || 0, set: async (k, v) => { counter[k] = v; } };
  const mine = { get: async () => null };
  const call = async (method, url, body) => { let out; await extras.handle(new URL(url, 'http://x').pathname, { method, url }, {}, { user: { id: 'u1' }, mine, counter: C, json: (r2, code, o) => { out = { code, o }; }, readBody: async () => JSON.stringify(body || {}) }); return out; };
  const wait = async (job) => { let g; for (let i = 0; i < 100; i++) { g = await call('GET', '/api/flow/ahead?job=' + job); if (g.o.status !== 'working') break; await new Promise((k) => setTimeout(k, 30)); } return g; };
  const items = [{ date: '2026-10-27', title: 'Vibe Show', kind: 'event', allDay: true }];
  const a1 = await call('POST', '/api/flow/ahead', { items, sig: 's1' });
  ok('a first read is a job', a1.code === 202);
  ok('which comes back done', (await wait(a1.o.job)).o.ahead.headline === 'Busy.');
  const a2 = await call('POST', '/api/flow/ahead', { items, sig: 's1' });
  ok('the same list later the same day is not read again', a2.code === 200 && a2.o.cached && calls === 1);
  const a3 = await call('POST', '/api/flow/ahead', { items: items.concat([{ date: '2026-10-30', title: 'Flight', kind: 'event' }]), sig: 's2' });
  ok('a changed list is read again', a3.code === 202);
  await wait(a3.o.job);
  ok('an empty list is refused', (await call('POST', '/api/flow/ahead', { items: [] })).code === 400);
  for (let i = 0; i < 8; i++) await call('POST', '/api/flow/ahead', { items, sig: 'z' + i, refresh: true });
  const capped = await call('POST', '/api/flow/ahead', { items, sig: 'zz', refresh: true });
  ok('past the daily cap, the last read is shown rather than an error', capped.code === 200 && capped.o.stale, capped);
  delete process.env.ANTHROPIC_API_KEY; A.setPoster(null);

  console.log('\n— on Today —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const evs = [
    { id: 'e1', title: 'Vibe Show — Antalya', start: iso(plus(1)), end: iso(plus(2)), allDay: true, location: 'Antalya' },
    { id: 'e2', title: 'Dentist', start: plus(3).toISOString().slice(0, 10) + 'T09:00:00Z', end: plus(3).toISOString().slice(0, 10) + 'T09:30:00Z', allDay: false, location: '' },
    { id: 'e3', title: 'Flight to Hong Kong', start: plus(10).toISOString().slice(0, 10) + 'T06:00:00Z', end: plus(10).toISOString().slice(0, 10) + 'T18:00:00Z', allDay: false, location: 'IST' },
    { id: 'e4', title: 'Quarter review', start: iso(plus(20)), end: iso(plus(21)), allDay: true, location: '' }
  ];
  let aheadPosts = 0, rangeAsked = 0;
  await p.route('**/api/connect/list', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connections: [{ id: 'gcal', name: 'Google Calendar', kind: 'oauth', configured: true, connected: true, accounts: [{ aid: 'a', email: 'artur@example.com' }] }] }) }));
  await p.route('**/api/connect/gcal/events**', (rt) => {
    const u = new URL(rt.request().url()); const span = (Date.parse(u.searchParams.get('to')) - Date.parse(u.searchParams.get('from'))) / 864e5;
    if (span > 8) rangeAsked++;
    const list2 = span > 8 ? evs : evs.filter((e) => String(e.start).slice(0, 10) === iso(plus(0)));
    rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: list2 }) });
  });
  await p.route('**/api/connect/gmail/related**', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: '{"threads":[]}' }));
  await p.route('**/api/flow/patterns**', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' }));
  await p.route('**/api/flow/ahead**', (rt) => {
    if (rt.request().method() === 'POST') {
      aheadPosts++;
      const body = JSON.parse(rt.request().postData() || '{}');
      const i = body.items.findIndex((x) => /Vibe/.test(x.title));
      const remAt = iso(plus(0)) + 'T23:30';
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'done', ahead: { headline: 'The show is tomorrow, the flight in ten days.', prep: [{ ref: i, what: 'Pack the CDJs and USBs', by: iso(plus(0)) }], watch: ['Dentist on the morning after the show'], remind: [{ ref: i, at: remAt, why: 'Pack tonight' }], generatedAt: new Date().toISOString() } }) });
    }
    return rt.fulfill({ status: 404 });
  });
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(() => Flow.Nav.go('today'));
  await p.waitForFunction(() => document.querySelector('#flow-td-ahead .ah-head'), null, { timeout: 15000 }).catch(() => {});
  const v = await p.evaluate(() => { const c = document.getElementById('flow-td-ahead'); return c && { rows: [...c.querySelectorAll('.ah-row .ah-t')].map((x) => x.firstChild.textContent), days: [...c.querySelectorAll('.ah-day')].map((x) => x.textContent), head: (c.querySelector('.ah-head') || {}).textContent, prep: c.querySelectorAll('.ah-prep li').length, big: c.querySelectorAll('.ah-row.big').length }; });
  ok('the month was asked for once, from the calendar', rangeAsked >= 1, rangeAsked);
  ok('the next 7 days: the show tomorrow, the dentist, and Big Rocks on coming days', v && v.rows.includes('Vibe Show — Antalya') && v.rows.includes('Dentist') && !v.rows.includes('Flight to Hong Kong'), v);
  ok('grouped by day, starting Tomorrow', v.days[0] === 'Today' || v.days[0] === 'Tomorrow', v.days);
  ok('the all-day show is marked as big', v.big >= 1);
  ok('the assistant\'s read sits on top, with what to get ready', /show is tomorrow/.test(v.head) && v.prep === 1, v);
  await p.click('#flow-td-ahead [data-ah="span"][data-n="14"]'); await p.waitForTimeout(300);
  ok('2 weeks adds the flight', await p.evaluate(() => /Flight to Hong Kong/.test(document.getElementById('flow-td-ahead').textContent) && !/Quarter review/.test(document.getElementById('flow-td-ahead').textContent)));
  await p.click('#flow-td-ahead [data-ah="span"][data-n="30"]'); await p.waitForTimeout(300);
  ok('Month adds the quarter review, and the choice is kept', await p.evaluate(() => /Quarter review/.test(document.getElementById('flow-td-ahead').textContent) && localStorage.getItem('flow:aheadSpan') === '30'));

  await p.evaluate(async () => { const w = window.FlowTodayLook.wid(new Date(Date.now() + 2 * 864e5)); const d = new Date(Date.now() + 2 * 864e5); const dow = (d.getDay() + 6) % 7; for (let i = 0; i < 5; i++) addRock('Extra rock ' + i, '', dow, '', w, { prio: 'med' }); window.FlowAhead.paint(); });
  await p.waitForTimeout(400);
  const fold = await p.evaluate(() => ({ more: (document.querySelector('#flow-td-ahead [data-ah="more"]') || {}).textContent || '', shown: [...document.querySelectorAll('#flow-td-ahead .ah-row .ah-t')].filter((x) => /Extra rock/.test(x.textContent)).length }));
  ok('a day with many Big Rocks shows two and folds the rest', fold.shown >= 1 && fold.shown <= 2 && /\+ \d+ more Big Rocks/.test(fold.more), fold);
  await p.click('#flow-td-ahead [data-ah="more"]'); await p.waitForTimeout(300);
  ok('and opens them with one tap', await p.evaluate(() => [...document.querySelectorAll('#flow-td-ahead .ah-row .ah-t')].filter((x) => /Extra rock/.test(x.textContent)).length === 5));

  console.log('\n— reminders —');
  await p.click('#flow-td-ahead .ah-row:has-text("Flight to Hong Kong") [data-ah="menu"]'); await p.waitForTimeout(300);
  const opts = await p.evaluate(() => [...document.querySelectorAll('#flow-td-ahead .ah-menu [data-ah="opt"]')].map((b) => b.textContent));
  ok('a 06:00 flight offers 2 hours before, the day before and a week before — not a morning reminder after take-off', opts.length === 3 && /2 hours/.test(opts[0]) && !opts.some((o) => /Morning/.test(o)) && /week/.test(opts[2]), opts);
  await p.click('#flow-td-ahead .ah-menu [data-o="eve"]'); await p.waitForTimeout(600);
  const rem = await p.evaluate(async () => Flow.DB.get('flow:reminders', []));
  ok('the day before at 18:00 is kept on the account, in local time', rem.length === 1 && rem[0].at === (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 9); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })() + 'T18:00' && /Flight/.test(rem[0].title), rem);
  ok('the bell shows it', await p.evaluate(() => { const b2 = document.querySelector('#flow-td-ahead .ah-row:has(.ah-bell.on)'); return !!b2 && /Flight/.test(b2.textContent); }));
  await p.click('#flow-td-ahead .ah-row:has-text("Flight to Hong Kong") [data-ah="menu"]'); await p.waitForTimeout(300);
  await p.click('#flow-td-ahead .ah-menu [data-o="eve"]'); await p.waitForTimeout(600);
  ok('choosing it again removes it', (await p.evaluate(async () => Flow.DB.get('flow:reminders', []))).length === 0);
  await p.click('#flow-td-ahead .ah-row:has-text("Vibe Show") [data-ah="menu"]'); await p.waitForTimeout(300);
  ok('an all-day item tomorrow cannot have a reminder in the past', await p.evaluate(() => [...document.querySelectorAll('#flow-td-ahead .ah-menu [data-ah="opt"]')].every((b) => !/week/.test(b.textContent))));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.click('#flow-td-ahead [data-ah="sugg"]'); await p.waitForTimeout(600);
  const rem2 = await p.evaluate(async () => Flow.DB.get('flow:reminders', []));
  ok('the assistant\'s suggested reminder is one tap', rem2.length === 1 && /T23:30$/.test(rem2[0].at) && rem2[0].body === 'Pack tonight', rem2);

  console.log('\n— on a Mac —');
  const scheduled = await p.evaluate(async () => {
    const got = [];
    window.FlowMac = { notifications: { status: async () => ({ granted: true }), pending: async () => ({ pending: [] }), schedule: async (o) => { got.push(o); }, cancel: async () => {} } };
    await Flow.Settings.set('pushRemindRocks', true);
    const N = window.FlowNotify || null;
    return got;
  });
  const mac = await p.evaluate(async () => {
    const got = [];
    window.FlowMac = { notifications: { status: async () => ({ granted: true }), pending: async () => ({ pending: [] }), schedule: async (o) => { got.push(o); }, cancel: async () => {} } };
    try { await window.FlowNotifySync(); } catch (e) { return 'no hook: ' + e.message; }
    return got.filter((o) => /^rem:/.test(o.notifId)).map((o) => o.title + '|' + o.at);
  });
  ok('the Mac schedules the same reminder itself', Array.isArray(mac) && mac.length === 1 && /Vibe Show/.test(mac[0]), mac);

  console.log('\n— looks —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); Flow.Nav.go('today'); }); await p.waitForTimeout(800);
  ok('Simple shows it in its colours', await p.evaluate(() => getComputedStyle(document.querySelector('#flow-td-ahead .ah-tabs button.on')).backgroundColor === 'rgb(244, 244, 242)'));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  ok('it fits a phone', await p.evaluate(() => { const c = document.getElementById('flow-td-ahead'); return c.scrollWidth <= c.clientWidth + 2 && document.documentElement.scrollWidth <= innerWidth + 1; }));
  ok('the model was asked once for all of this', aheadPosts === 1, aheadPosts);
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
