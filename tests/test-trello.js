/* Trello — cards and checklist items on Today and Coming up, done both ways.
 *
 * What would make it wrong: the token in a URL (logs) or in anything the
 * page is handed back; a connection without the app's key on the server;
 * someone else's undated card on Today; a card on a board nobody chose; a
 * done card still showing; ticking one in The Flow not marking it done in
 * Trello, or marking the wrong thing; an id from the page reaching Trello
 * unchecked; the return page keeping the token in the address bar. None of
 * this calls Trello: its API is replaced, and the browser half mocks the
 * server's answers. */
const path = require('path');
const { chromium } = require('playwright');
const submitAuth = require('./submit-auth.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

const conn = require(path.join(__dirname, '..', 'flow-connect.js'));
const I = conn._internals;

const ME = 'a'.repeat(24), OTHER = 'b'.repeat(24);
const B1 = '1'.repeat(24), B2 = '2'.repeat(24), B3 = '3'.repeat(24);
const C1 = 'c1'.padEnd(24, '0'), C2 = 'c2'.padEnd(24, '0'), C3 = 'c3'.padEnd(24, '0'), C4 = 'c4'.padEnd(24, '0'), C5 = 'c5'.padEnd(24, '0');
const K1 = 'd1'.padEnd(24, '0'), K2 = 'd2'.padEnd(24, '0'), K3 = 'd3'.padEnd(24, '0');
const L1 = 'a'.repeat(23) + '1', L2 = 'a'.repeat(23) + '2';
const TOKEN = 'ATTAgoodtoken0123456789abcdef0123456789abcdef';

(async () => {
  console.log('\n— the server side —');
  const raw = new Map();
  const st = { get: async (k) => raw.has(k) ? raw.get(k) : null, set: async (k, v) => { raw.set(k, v); } };
  const me = { id: 'u1' };
  const calls = [];
  const fakeFetch = async (u, o) => {
    u = String(u); o = o || {};
    calls.push({ u, o });
    const auth = (o.headers || {}).Authorization || '';
    if (auth.indexOf('oauth_token="' + TOKEN + '"') < 0) return { ok: false, status: 401, json: async () => ({}) };
    const res = (j) => ({ ok: true, status: 200, json: async () => j });
    const p = new URL(u).pathname.replace(/^\/1/, '');
    if (p === '/members/me' && /email/.test(u)) return res({ fullName: 'Artur A', username: 'artur', email: 'artur@abko.com.tr' });
    if (p === '/members/me') return res({ id: ME });
    if (p === '/members/me/boards') return res([{ id: B1, name: 'ABKO Ops' }, { id: B2, name: 'Marketing' }, { id: B3, name: 'Archive' }]);
    if (p === '/members/me/cards') return res([
      { id: C1, name: 'Send the price list', due: '2026-11-10T09:00:00.000Z', dueComplete: false, closed: false, idBoard: B1, shortUrl: 'https://trello.com/c/one', idMembers: [ME] },
      { id: C2, name: 'Think about packaging', due: null, dueComplete: false, closed: false, idBoard: B1, shortUrl: 'https://trello.com/c/two', idMembers: [ME] },
      { id: C3, name: 'Archived one', due: '2026-11-09T09:00:00.000Z', dueComplete: false, closed: true, idBoard: B1, shortUrl: '', idMembers: [ME] }
    ]);
    if (p === '/boards/' + B2 + '/cards') return res([
      { id: C4, name: 'Launch post', due: '2026-11-11T14:00:00.000Z', dueComplete: false, closed: false, idBoard: B2, shortUrl: 'https://trello.com/c/four', idMembers: [OTHER] },
      { id: C5, name: 'Someone else, no date', due: null, dueComplete: false, closed: false, idBoard: B2, shortUrl: '', idMembers: [OTHER] }
    ]);
    if (p === '/boards/' + B1 + '/checklists') return res([{ id: 'x', idCard: C1, name: 'Steps', checkItems: [
      { id: K1, name: 'Get the numbers from Ali', state: 'incomplete', due: '2026-11-09T12:00:00.000Z', idMember: null },
      { id: K2, name: 'Mine, no date', state: 'incomplete', due: null, idMember: ME },
      { id: K3, name: 'Not mine, no date', state: 'incomplete', due: null, idMember: OTHER }
    ] }]);
    if (p === '/boards/' + B2 + '/checklists') return res([]);
    if (/^\/cards\//.test(p) && o.method === 'PUT') return res({ ok: true });
    if (p === '/boards/' + B1 + '/lists') return res([{ id: L1, name: 'To do' }, { id: L2, name: 'Doing' }]);
    if (p === '/cards' && o.method === 'POST') return res({ id: ('c' + calls.length).padEnd(24, '0').replace(/[^a-f0-9]/g, 'a').slice(0, 24), shortUrl: 'https://trello.com/c/new' });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const send = () => ({ status: 0, body: '', headers: {}, writeHead(s, h) { this.status = s; this.headers = h || {}; }, end(b) { this.body = b || ''; } });
  const json = (res, s, obj) => { res.status = s; res.body = JSON.stringify(obj); };
  const call = async (pth, method, body, extra, qs) => {
    const r = send();
    await conn.handle(Object.assign({ method, headers: { host: 'theflow.today', 'x-forwarded-proto': 'https' } }, extra || {}), r,
      { path: pth, query: new URLSearchParams(qs || ''), me, raw: st, json, fetch: fakeFetch, readBody: async () => JSON.stringify(body || {}) });
    let j = {}; try { j = JSON.parse(r.body || '{}'); } catch (e) {}
    return { status: r.status, j, body: r.body, headers: r.headers };
  };

  delete process.env.TRELLO_API_KEY;
  let r = await call('/api/connect/list', 'GET');
  let tr = (r.j.connections || []).find((c) => c.id === 'trello');
  ok('Trello is listed, but not offered until the server has the app\'s key', tr && tr.configured === false && !tr.keyUrl, tr);
  r = await call('/api/connect/trello/key', 'POST', { key: TOKEN });
  ok('and a token cannot be saved without it', r.status === 400 && !raw.get(I.KEY('u1', 'trello')), r);

  process.env.TRELLO_API_KEY = 'appkey123';
  r = await call('/api/connect/list', 'GET');
  tr = r.j.connections.find((c) => c.id === 'trello');
  const au = tr.keyUrl ? new URL(tr.keyUrl) : null;
  ok('with it, the link asks Trello for a never-expiring read+write token for "The Flow"', tr.configured && au && au.host === 'trello.com' &&
    au.searchParams.get('key') === 'appkey123' && au.searchParams.get('scope') === 'read,write' && au.searchParams.get('expiration') === 'never' &&
    au.searchParams.get('name') === 'The Flow' && au.searchParams.get('callback_method') === 'fragment', tr.keyUrl);
  ok('and comes back to this site\'s return page', au && au.searchParams.get('return_url') === 'https://theflow.today/api/connect/trello/return');
  ok('the button says what it does', tr.keyLink === 'Get my Trello token');

  r = await call('/api/connect/trello/key', 'POST', { key: 'ATTAwrongtoken000000000000' });
  ok('a token Trello refuses is not saved, and the person is told', r.status === 400 && /did not accept/.test(r.j.error) && !raw.get(I.KEY('u1', 'trello')), r.j);
  r = await call('/api/connect/trello/key', 'POST', { key: TOKEN });
  const rec = JSON.parse(raw.get(I.KEY('u1', 'trello'))).accounts[0];
  ok('a good token is checked with Trello and kept server-side, with whose it is', r.status === 200 && rec.key === TOKEN && rec.email === 'artur@abko.com.tr', rec);
  ok('the token travels in the OAuth header, never in a URL', calls.every((c) => c.u.indexOf(TOKEN) < 0) && calls.some((c) => /oauth_token=/.test((c.o.headers || {}).Authorization || '')));
  r = await call('/api/connect/list', 'GET');
  ok('the list never carries the token', r.body.indexOf(TOKEN) < 0 && r.j.connections.find((c) => c.id === 'trello').connected);

  r = await call('/api/connect/trello/items', 'GET');
  let items = r.j.items || [];
  const byTitle = (t) => items.find((x) => x.title === t);
  ok('your own cards come through, dated and undated', byTitle('Send the price list') && byTitle('Send the price list').due && byTitle('Think about packaging') && byTitle('Think about packaging').mine, items.map((x) => x.title));
  ok('an archived card does not', !byTitle('Archived one'));
  ok('a board nobody chose adds nothing', !byTitle('Launch post'));
  ok('a dated checklist item on your card comes through, with its card and board', byTitle('Get the numbers from Ali') && byTitle('Get the numbers from Ali').card === 'Send the price list' && byTitle('Get the numbers from Ali').board === 'ABKO Ops' && byTitle('Get the numbers from Ali').kind === 'check');
  ok('an undated checklist item is there only when it is yours', byTitle('Mine, no date') && byTitle('Mine, no date').mine && !byTitle('Not mine, no date'));
  ok('ids say what they are: c:<card>, i:<card>:<item>', byTitle('Send the price list').id === 'c:' + C1 && byTitle('Get the numbers from Ali').id === 'i:' + C1 + ':' + K1);

  r = await call('/api/connect/trello/boards', 'GET');
  ok('the board list is your open boards, none chosen yet', (r.j.boards || []).length === 3 && r.j.boards.every((b) => !b.chosen), r.j);
  r = await call('/api/connect/trello/prefs', 'GET');
  ok('choosing boards is a POST', r.status === 405);
  r = await call('/api/connect/trello/prefs', 'POST', { boards: [B2, 'not-an-id', B2, '<script>'] });
  ok('chosen boards are saved, checked and once each', r.status === 200 && r.j.boards === 1 && JSON.stringify(JSON.parse(raw.get(I.KEY('u1', 'trello'))).accounts[0].boards) === JSON.stringify([B2]), r.j);
  r = await call('/api/connect/trello/items', 'GET');
  items = r.j.items || [];
  ok('then every dated card on that board comes through, marked not yours', byTitle('Launch post') && byTitle('Launch post').mine === false && byTitle('Launch post').board === 'Marketing');
  ok('but not its undated cards that are someone else\'s', !byTitle('Someone else, no date'));
  await call('/api/connect/trello/key', 'POST', { key: TOKEN });
  ok('reconnecting keeps the chosen boards', JSON.stringify(JSON.parse(raw.get(I.KEY('u1', 'trello'))).accounts[0].boards) === JSON.stringify([B2]));

  calls.length = 0;
  r = await call('/api/connect/trello/done', 'POST', { id: 'c:' + C1, done: true });
  let put = calls.find((c) => c.o.method === 'PUT');
  ok('done on a card marks it complete in Trello', r.status === 200 && put && new URL(put.u).pathname === '/1/cards/' + C1 && new URL(put.u).searchParams.get('dueComplete') === 'true', put && put.u);
  calls.length = 0;
  r = await call('/api/connect/trello/done', 'POST', { id: 'i:' + C1 + ':' + K1, done: true });
  put = calls.find((c) => c.o.method === 'PUT');
  ok('done on a checklist item checks it', r.status === 200 && put && new URL(put.u).pathname === '/1/cards/' + C1 + '/checkItem/' + K1 && new URL(put.u).searchParams.get('state') === 'complete', put && put.u);
  calls.length = 0;
  r = await call('/api/connect/trello/done', 'POST', { id: 'c:' + C1, done: false });
  put = calls.find((c) => c.o.method === 'PUT');
  ok('undo puts it back', put && new URL(put.u).searchParams.get('dueComplete') === 'false');
  calls.length = 0;
  r = await call('/api/connect/trello/done', 'POST', { id: 'c:../../members/me' });
  ok('an id that is not a Trello id never reaches Trello', r.status === 400 && !calls.some((c) => c.o.method === 'PUT'));
  r = await call('/api/connect/trello/done', 'GET');
  ok('done is a POST', r.status === 405);

  /* new cards: from a document, a meeting, J.A.R.V.I.S. */
  r = await call('/api/connect/trello/lists', 'GET', null, null, 'board=' + B1);
  ok('the lists of a board, to choose where new cards go', r.status === 200 && r.j.lists.map((l) => l.name).join('|') === 'To do|Doing', r.j);
  r = await call('/api/connect/trello/lists', 'GET', null, null, 'board=../members');
  ok('a board that is not a Trello id is refused', r.status === 400);
  calls.length = 0;
  r = await call('/api/connect/trello/add', 'POST', { list: L1, cards: [{ name: 'Update privacy policy', due: '2026-11-21', desc: 'p. 19 · week 3' }, { name: '  ', due: '' }, { name: 'No date' }] });
  const posts = calls.filter((c) => c.o.method === 'POST' && new URL(c.u).pathname === '/1/cards');
  const q0 = posts[0] && new URL(posts[0].u).searchParams;
  ok('cards are added to the chosen list, with the day and the note; blank ones skipped', r.status === 200 && r.j.added === 2 && posts.length === 2 && q0.get('idList') === L1 && q0.get('name') === 'Update privacy policy' && q0.get('due') === '2026-11-21T12:00:00.000Z' && q0.get('desc') === 'p. 19 · week 3' && !new URL(posts[1].u).searchParams.get('due'), r.j);
  r = await call('/api/connect/trello/add', 'POST', { list: 'nope', cards: [{ name: 'x' }] });
  ok('adding needs a real list', r.status === 400);
  r = await call('/api/connect/trello/add', 'GET');
  ok('adding is a POST', r.status === 405);

  r = await call('/api/connect/trello/return', 'GET', null);
  ok('the return page needs no session, is not cached, and sends no referrer', r.status === 200 && /no-store/.test(r.headers['Cache-Control']) && r.headers['Referrer-Policy'] === 'no-referrer' && /\/api\/connect\/trello\/key/.test(r.body));
  ok('it takes the token out of the address at once', /history\.replaceState\(null,"",location\.pathname\)/.test(r.body));
  const me2 = me; me.id = 'nobody';
  r = await call('/api/connect/trello/items', 'GET');
  ok('another account sees no Trello', r.status === 409);
  me.id = 'u1';
  ok('deleting the account removes the token', (await conn.purgeUser(st, 'u1')) >= 1 && !raw.get(I.KEY('u1', 'trello')));

  console.log('\n— in the app —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const at = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  let doneCalls = [];
  const fakeItems = [
    { id: 'c:' + C1, kind: 'card', title: 'Send the price list', card: '', board: 'ABKO Ops', due: at(0, 15), done: false, url: 'https://trello.com/c/one', mine: true },
    { id: 'c:' + C4, kind: 'card', title: 'Launch post', card: '', board: 'Marketing', due: at(2, 14), done: false, url: 'https://trello.com/c/four', mine: false },
    { id: 'i:' + C1 + ':' + K1, kind: 'check', title: 'Get the numbers from Ali', card: 'Send the price list', board: 'ABKO Ops', due: at(-2, 12), done: false, url: '', mine: false },
    { id: 'c:' + C2, kind: 'card', title: 'Think about packaging', card: '', board: 'ABKO Ops', due: '', done: false, url: '', mine: true },
    { id: 'c:' + C3, kind: 'card', title: 'Already done', card: '', board: 'ABKO Ops', due: at(1, 10), done: true, url: '', mine: true }
  ];
  await p.route('**/api/connect/trello/items', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: fakeItems }) }));
  await p.route('**/api/connect/trello/done', (rt) => { doneCalls.push(JSON.parse(rt.request().postData() || '{}')); rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await p.route('**/api/connect/list', async (rt) => {
    const resp = await rt.fetch(); const j = await resp.json();
    (j.connections || []).forEach((c) => { if (c.id === 'trello') Object.assign(c, { configured: true, connected: true, accounts: [{ aid: 'artur', email: 'artur@abko.com.tr', boards: 1 }] }); });
    rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  });
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); });
  await p.waitForTimeout(800);
  await p.evaluate(async () => { await window.FlowTrello.load(true); });
  await p.waitForTimeout(600);

  const rail = await p.evaluate(() => [...document.querySelectorAll('#today-feed .lk-bt-cal .bt-ev')].map((e) => e.textContent));
  ok('today\'s Trello card shows in Today\'s calendar column, with its board', rail.some((t) => /Send the price list/.test(t) && /Trello/.test(t) && /ABKO Ops/.test(t)), rail);
  ok('an overdue checklist item shows on today, marked overdue, with its card', rail.some((t) => /Get the numbers from Ali/.test(t) && /overdue/.test(t) && /Send the price list/.test(t)), rail);
  ok('your undated card is listed under today as "Trello · no date"', await p.evaluate(() => /Trello · no date/.test(document.querySelector('#today-feed .lk-bt-cal').textContent) && /Think about packaging/.test(document.querySelector('#today-feed .lk-bt-cal').textContent)));
  ok('a card already done is not shown anywhere', await p.evaluate(() => !/Already done/.test(document.getElementById('today-feed').textContent)));
  const ahead = await p.evaluate(() => window.FlowAhead.items().filter((x) => x.kind === 'trello').map((x) => ({ t: x.title, d: x.date, late: x.late })));
  ok('Coming up has the card two days out on its day', ahead.some((x) => x.t === 'Launch post' && x.d === (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()), ahead);

  await p.click('#today-feed .lk-bt-cal .bt-ev.tr [data-bt="trdone"]');
  await p.waitForTimeout(600);
  const afterTick = await p.evaluate(() => ({ titles: [...document.querySelectorAll('#today-feed .lk-bt-cal .bt-ev b')].map((x) => x.textContent) }));
  ok('ticking one sends "done" to Trello for exactly that item', doneCalls.length === 1 && doneCalls[0].done === true && /^(c|i):/.test(doneCalls[0].id), doneCalls);
  ok('and it leaves Today at once', afterTick.titles.indexOf(fakeItems.find((x) => x.id === doneCalls[0].id).title) < 0, afterTick.titles);

  await p.evaluate(() => { Flow.Nav.go('settings'); });
  await p.waitForTimeout(1200);
  const row = await p.evaluate(() => { const r = document.querySelector('[data-conn="trello"]'); return r && { text: r.textContent, boards: !!r.querySelector('[data-conn-act="trello-boards"]'), check: !!r.querySelector('[data-conn-act="trello"]') }; });
  ok('Settings → Connections shows Trello connected, with "Boards to include (1)" and "Check now"', row && /artur@abko\.com\.tr/.test(row.text) && /Boards to include \(1\)/.test(row.text) && row.boards && row.check, row);

  await p.setViewportSize({ width: 375, height: 812 }); await p.evaluate(() => { Flow.Nav.go('today'); renderToday(); }); await p.waitForTimeout(700);
  ok('on a phone nothing spills sideways', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
