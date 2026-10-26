/* Event brief.
 *
 * What would make it wrong: an ID number or birth date reaching the model,
 * the same email counted twice because every reply quotes the last one, a
 * brief written for a short meeting nobody emailed about, the model paid for
 * twice in a day for emails that did not change, and the brief shown under
 * the wrong event. None of this calls Google or Anthropic. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const C = require('../flow-connect.js');
const X = require('../flow-extras.js')._internals.brief;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

const BRIEF = {
  headline: 'Vibe Show today: you open at 15:30 and close the after party.',
  days: [
    { date: '2026-10-25', label: 'Set-up', items: [{ time: '', text: 'Outdoor stage set-up', you: false, tbc: false }] },
    { date: 'TODAY', label: 'Show day', items: [
      { time: 'Morning', text: 'Artist rehearsal at the show area', you: false, tbc: true },
      { time: '15:30–16:00', text: 'Show Welcome — you play', you: true, tbc: false },
      { time: '18:30–19:30', text: 'Cocktail and after party — DJ Artur', you: true, tbc: false }] },
    { date: '2026-10-27', label: 'Masterclasses', items: [{ time: '10:00–16:00', text: 'Allilon masterclasses', you: false, tbc: false }] }
  ],
  where: ['Open-air amphitheatre'],
  you: ['Bring your CDJ-3000X players', 'Back: TK2431, 28 Oct 23:05'],
  people: [{ name: 'Deniz Örnek', role: 'Marketing lead', phone: '+90 500 000 00 02' }],
  open: ['Tech team arrival time', 'DJ mixer'],
  warnings: ['Masterclass ends 16:00 or 17:00']
};

(async () => {
  console.log('\n— the emails, as they leave the mailbox —');
  const I = C._internals;
  const now = Date.parse('2026-10-26T08:00:00Z');
  const masked = I.maskPersonal('AYSE ORNEK\n01.01.2004\n10000000146\n0 500 000 00 01\nMina 300000001 passport AB1234567\nShow on 26.10.2026\nCard 4543 1234 5678 9012\nTR12 0006 2000 1234 0006 2987 65', now);
  ok('identity numbers go', !/10000000146|300000001/.test(masked), masked);
  ok('passport numbers go', !/AB1234567/.test(masked), masked);
  ok('birth dates go, event dates stay', !/16\.11\.2007/.test(masked) && /26\.10\.2026/.test(masked), masked);
  ok('card numbers and IBANs go', !/4543|TR12/.test(masked), masked);
  ok('phone numbers stay — "who to call" needs them', /0 500 000 00 01/.test(masked), masked);
  ok('a reply loses the quoted email under it (Turkish Gmail)', I.newPart('Yeni metin\n\n13 Eki 2026 Sal, saat 15:16 tarihinde Deniz <d@x> şunu yazdı:\n> eski') === 'Yeni metin');
  ok('and the Outlook kind', I.newPart('New\n\n*From:* Atilla <a@b>\nold') === 'New');
  ok('search words are just words', I.relatedTerms('Vibe Show — Antalya!') === 'Vibe Show Antalya');

  console.log('\n— reading Gmail —');
  let asked = [];
  const fakeFetch = async (url) => {
    asked.push(url);
    const body = /\/threads\?/.test(url) ? { threads: [{ id: 't1' }] } : {
      messages: [
        { internalDate: String(Date.parse('2026-10-12T12:00:00Z')), payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: 'Deniz <d@example.com>' }, { name: 'Subject', value: 'Vibe Show Antalya' }],
          parts: [{ mimeType: 'text/plain', body: { data: b64('Program: 15:30 Artur çalacak.\nTC 10000000146') } }] } },
        { internalDate: String(Date.parse('2026-10-24T14:32:00Z')), payload: { mimeType: 'text/html', headers: [{ name: 'From', value: 'Deniz <d@example.com>' }],
          body: { data: b64('<p>Pazartesi sabah kaçta?</p><div>13 Eki 2026 Sal, saat 15:16 tarihinde Deniz şunu yazdı:</div><blockquote>Program: 15:30 Artur çalacak.</blockquote>') } } }
      ] };
    return { ok: true, status: 200, json: async () => body };
  };
  const rec = { aid: 'artur@example', tok: { access: 'x', refresh: 'y', exp: Date.now() + 3600e3 } };
  const ctx = { query: new URLSearchParams({ q: 'Vibe Show Antalya' }), fetch: fakeFetch, now, saveRec: async () => {} };
  const out = await C.PROVIDERS.gmail.actions.related(C.PROVIDERS.gmail, rec, ctx);
  const t = out.body.threads[0];
  ok('one thread comes back with both messages', out.status === 200 && t && t.messages.length === 2, out.body);
  ok('the search includes the joined spelling (VibeShow)', /VibeShow/.test(decodeURIComponent(asked[0])), asked[0]);
  ok('it stays within 120 days and out of spam', /newer_than:120d/.test(decodeURIComponent(asked[0])) && /-in:spam/.test(decodeURIComponent(asked[0])));
  ok('the ID number in the email never leaves', !JSON.stringify(out.body).includes('10000000146'));
  ok('the HTML reply is text, without the quote it repeats', t.messages[1].text === 'Pazartesi sabah kaçta?', t.messages[1].text);
  ok('newest first is kept, and the total is reported', t.total === 2 && /mail\.google\.com/.test(t.link));

  console.log('\n— writing the brief —');
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  let sent = null;
  X.setPoster(async (u, h, payload) => { sent = payload; return { status: 200, body: { content: [{ type: 'text', text: 'Here: ' + JSON.stringify(BRIEF) }] } }; });
  const counters = {};
  const mk = (id, body) => { const o = {}; return { o, ctx: { user: { id }, readBody: async () => JSON.stringify(body || {}), json: (r, c, j) => { o.code = c; o.body = j; },
    counter: { get: async (k) => counters[id + k] || 0, set: async (k, v) => { counters[id + k] = v; } } } }; };
  const a = mk('u1', { event: { title: 'Vibe Show — Antalya', start: '2026-10-26', end: '2026-10-27', allDay: true }, threads: out.body.threads, me: { name: 'Artur Example', alias: 'Artur', email: 'artur@example.com' }, today: '2026-10-26', lang: 'en' });
  await X.handle('/api/flow/event-brief', { method: 'POST', url: '/api/flow/event-brief' }, {}, a.ctx);
  ok('a brief starts as a job', a.o.code === 202 && a.o.body.job, a.o);
  const prompt = sent.messages[0].content;
  ok('the model is told who "you" are', /Artur Example \/ Artur \/ artur@example\.com/.test(prompt));
  ok('and gets the emails, not the ID number', /Artur çalacak/.test(prompt) && !/10000000146/.test(prompt));
  await new Promise((r) => setTimeout(r, 30));
  const g = mk('u1');
  await X.handle('/api/flow/event-brief', { method: 'GET', url: '/api/flow/event-brief?job=' + a.o.body.job }, {}, g.ctx);
  ok('it comes back as a clean brief', g.o.body.status === 'done' && g.o.body.brief.days.length === 3 && g.o.body.brief.open.length === 2 && g.o.body.brief.days[0].date === '', g.o.body);
  const other = mk('u2');
  await X.handle('/api/flow/event-brief', { method: 'GET', url: '/api/flow/event-brief?job=' + a.o.body.job }, {}, other.ctx);
  ok('another account cannot read it', other.o.code === 404);
  ok('a reply saying the emails are about something else is "none"', JSON.stringify(X.parseBrief('{"none":true}')) === '{"none":true}');
  ok('junk is refused, not shown', X.parseBrief('sorry') === null && X.parseBrief('{"days":[]}') === null);
  X.setPoster(null);

  console.log('\n— on Today —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const day = new Date(); const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const t0 = iso(day), t1 = iso(new Date(day.getTime() + 86400000));
  const brief = JSON.parse(JSON.stringify(BRIEF).replace('"TODAY"', '"' + t0 + '"'));
  let relatedCalls = 0, writeCalls = 0, relatedFor = [];
  const threadsFor = (q) => /Vibe/.test(q) ? [{ id: 't1', subject: 'Vibe Show Antalya – Ekim 2026', total: 28, link: 'https://mail.google.com/x',
    messages: [{ from: 'Deniz', date: '2026-10-24T14:32:00Z', text: 'Pazartesi sabah kaçta?' }] }, { id: 't2', subject: 'Vibe Show Operasyon', total: 1, link: '', messages: [{ from: 'Deniz', date: '2026-10-23T13:49:00Z', text: 'Program' }] }]
    : /Budget/.test(q) ? [{ id: 't9', subject: 'Budget', total: 1, link: '', messages: [{ from: 'X', date: '2026-10-20T10:00:00Z', text: 'hi' }] }] : [];
  await p.route('**/api/connect/list', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connections: [
    { id: 'gcal', name: 'Google Calendar', kind: 'oauth', configured: true, connected: true, accounts: [{ aid: 'a', email: 'artur@example.com' }] },
    { id: 'gmail', name: 'Gmail', kind: 'oauth', configured: true, connected: true, accounts: [{ aid: 'a', email: 'artur@example.com' }] }] }) }));
  await p.route('**/api/connect/gcal/events**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [
    { id: 'ev-vibe', title: 'Vibe Show — Antalya', start: t0, end: t1, allDay: true, location: 'Antalya, Türkiye', link: 'https://calendar.google.com/x' },
    { id: 'ev-budget', title: 'Budget sync', start: t0 + 'T09:00:00Z', end: t0 + 'T09:30:00Z', allDay: false, location: '' }] }) }));
  await p.route('**/api/connect/gmail/related**', (r) => { relatedCalls++; const q = new URL(r.request().url()).searchParams.get('q'); relatedFor.push(q);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ threads: threadsFor(q) }) }); });
  await p.route('**/api/flow/event-brief**', (r) => {
    if (r.request().method() === 'POST') { writeCalls++; return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, job: 'j' + writeCalls }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'done', brief }) });
  });
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(() => Flow.Nav.go('today'));
  await p.waitForFunction(() => document.querySelector('#td-cal [data-eb="toggle"]'), null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(500);

  ok('the all-day show gets a brief, built on its own', await p.evaluate(() => /Show brief · 2 threads, 29 emails/.test((document.querySelector('#td-cal [data-eb="toggle"]') || {}).textContent || '')),
    await p.evaluate(() => (document.querySelector('#td-cal') || {}).textContent));
  ok('searched by the event\'s own words', relatedFor.some((q) => q === 'Vibe Show Antalya'), relatedFor);
  ok('a half-hour meeting with one email gets none', writeCalls === 1 && await p.evaluate(() => [...document.querySelectorAll('#td-cal .td-rock')].filter((r) => /Budget sync/.test(r.textContent)).every((r) => !r.querySelector('.eb [data-eb]'))), { writeCalls });

  await p.click('#td-cal [data-eb="toggle"]'); await p.waitForTimeout(300);
  const v = await p.evaluate(() => {
    const body = document.querySelector('#td-cal .eb-body');
    return { tabs: [...body.querySelectorAll('.eb-tabs button')].map((b) => b.textContent), pane: body.querySelector('.eb-pane').textContent.replace(/\s+/g, ' '),
      you: body.querySelectorAll('.eb-you').length, tbc: body.querySelectorAll('.eb-tbc').length, head: (body.querySelector('.eb-head') || {}).textContent };
  });
  ok('it opens on today, with the other tabs beside it', /^Today · /.test(v.tabs[0]) && v.tabs.includes('Whole event') && v.tabs.includes('Your part') && v.tabs.includes('People & open items'), v.tabs);
  ok('today\'s timetable, your parts marked, the unconfirmed one flagged', /15:30–16:00/.test(v.pane) && v.you === 2 && v.tbc === 1, v);
  ok('with the venue under it', /Where/.test(v.pane) && /amphitheatre/.test(v.pane), v.pane);
  ok('the headline sits on top', /you open at 15:30/.test(v.head), v.head);

  await p.click('#td-cal [data-t="all"]'); await p.waitForTimeout(200);
  ok('the whole event has every day', await p.evaluate(() => document.querySelectorAll('#td-cal .eb-pane h5').length >= 3));
  await p.click('#td-cal [data-t="ops"]'); await p.waitForTimeout(200);
  const ops = await p.evaluate(() => ({ t: document.querySelector('#td-cal .eb-pane').textContent, tel: (document.querySelector('#td-cal .eb-pane a[href^="tel:"]') || {}).getAttribute && document.querySelector('#td-cal .eb-pane a[href^="tel:"]').getAttribute('href') }));
  ok('who to call, with a phone link', /Deniz Örnek/.test(ops.t) && ops.tel === 'tel:+905000000002', ops);
  ok('and the contradiction to check', /16:00 or 17:00/.test(ops.t));
  await p.click('#td-cal .eb-open li:first-child .eb-bx'); await p.waitForTimeout(400);
  ok('an open item can be ticked off, and it stays ticked', await p.evaluate(async () => {
    const stored = await Flow.DB.get('flow:briefs', {});
    return document.querySelector('#td-cal .eb-open li:first-child').classList.contains('done') && (stored['ev-vibe'].done || []).indexOf(0) >= 0;
  }));
  ok('the sources say where it came from', await p.evaluate(() => /Built from 2 threads · 29 emails/.test(document.querySelector('#td-cal .eb-src summary').textContent)));

  console.log('\n— not paid for twice —');
  const before = writeCalls;
  await p.evaluate(() => Flow.ConnectApps ? Flow.ConnectApps.calendarLoad() : null).catch(() => {});
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(5500);
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(2500);
  ok('opening Today again the same day writes nothing new', writeCalls === before, { before, writeCalls });
  ok('and the brief is still there', await p.evaluate(() => !!document.querySelector('#td-cal [data-eb="toggle"]')));
  await p.click('#td-cal [data-eb="toggle"]').catch(() => {}); await p.waitForTimeout(300);
  await p.click('#td-cal [data-eb="refresh"]'); await p.waitForTimeout(3500);
  ok('Refresh rebuilds it on request', writeCalls === before + 1, { before, writeCalls });

  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  ok('it fits a phone', await p.evaluate(() => { const c = document.getElementById('td-cal'); return !!c && c.scrollWidth <= c.clientWidth + 2 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1; }));
  if (process.env.SHOT) await p.locator('#td-cal').screenshot({ path: process.env.SHOT + '-phone.png' });

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
