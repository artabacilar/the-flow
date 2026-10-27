/* Patterns — the Habits card on Today reads the record instead of asking.
 *
 * What would make it wrong: the model paid for on every visit, a read that
 * claims things the record does not hold (we can only check the shape and
 * the prompt here), the habits you tick by hand disappearing, a card that
 * stays on "Reading…" forever, or an account whose server has no assistant
 * left with a broken card. None of this calls Anthropic. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const X = require('../flow-extras.js')._internals.patterns;
const extras = require('../flow-extras.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

const READ = {
  headline: 'Your Big Rocks get done early in the week and stall after Wednesday.',
  patterns: [
    { area: 'Plans', text: '4 of your last 6 done rocks were ticked on Monday or Tuesday.', tone: 'good' },
    { area: 'sleep', text: 'You went to bed after 00:30 on 5 of the last 7 nights.', tone: 'watch' },
    { area: 'Money', text: 'Dining is 41% of spending, mostly on Fridays.', tone: 'neutral' },
    { area: 'Moon', text: 'x'.repeat(400), tone: 'loud' }
  ],
  next: ['Put Thursday\'s rock on Tuesday', 'In bed by 23:30 tonight', 'Cook on Friday'],
  missing: 'Training is not being logged, so it is left out.'
};

(async () => {
  console.log('\n— reading the reply —');
  const r = X.parsePatterns('Here you go:\n```json\n' + JSON.stringify(READ) + '\n```');
  ok('JSON is found inside fences and prose', !!r && r.headline === READ.headline);
  ok('areas are tidied to the known names', r.patterns[1].area === 'Sleep' && r.patterns[0].area === 'Plans', r.patterns.map((p) => p.area));
  ok('an unknown tone becomes neutral, long text is cut', r.patterns[3].tone === 'neutral' && r.patterns[3].text.length <= 260);
  ok('at most three things to do next', r.next.length === 3);
  ok('nothing usable is null, not a blank card', X.parsePatterns('{"headline":"","patterns":[]}') === null && X.parsePatterns('no json') === null);
  ok('the prompt asks for numbers and forbids inventing', /Quote the number/.test(X.PAT_SYSTEM) && /Do not invent/.test(X.PAT_SYSTEM));

  console.log('\n— what the model is shown —');
  const store = {
    ld_compass: { mission: 'Make music', rocks: { '2026-W44': [{ title: 'Demo', day: 0, done: true }] } },
    'flow:expenses': [{ date: new Date().toISOString().slice(0, 10), amount: 120, category: 'Dining', merchant: 'X', card: '4543123456789012' }],
    ld_finance: { monthly: { [new Date().toISOString().slice(0, 7)]: [{ id: 'a', amt: 80, cat: 'food', date: new Date().toISOString().slice(0, 10) }] } },
    'flow:journal': [{ date: '2026-10-25', body: 'Slept badly again.', mood: 2 }]
  };
  const mine = { get: async (k) => store[k] == null ? null : store[k] };
  const ctxData = await X.buildPatternContext(mine, { extra: { nights: [{ date: '2026-10-25', hours: 6.2, bedAt: '00:41' }], meetingsToday: 2 } });
  ok('spending arrives as totals by category, weekday and week', ctxData.spendingLast8Weeks && ctxData.spendingLast8Weeks.byCategory.Dining === 120 && ctxData.spendingLast8Weeks.byCategory.food === 80, ctxData.spendingLast8Weeks);
  ok('and never as card numbers or merchants', !/4543123456789012|"merchant"/.test(JSON.stringify(ctxData)));
  ok('Health nights and today\'s meetings come from the page', ctxData.healthNights.length === 1 && ctxData.meetingsToday === 2);
  ok('journal entries are short excerpts with a word count', ctxData.writtenEntries[0].words === 3);

  console.log('\n— the endpoint —');
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let calls = 0;
  X.setPoster(async () => { calls++; return { status: 200, body: { content: [{ type: 'text', text: JSON.stringify(READ) }] } }; });
  const counter = {}; const C = { get: async (k) => counter[k] || 0, set: async (k, v) => { counter[k] = v; } };
  const call = async (method, url, body) => {
    let out = null;
    const res = {};
    const ctx = { user: { id: 'u1' }, mine, counter: C, json: (r, code, o) => { out = { code, o }; }, readBody: async () => JSON.stringify(body || {}) };
    await extras.handle(new URL(url, 'http://x').pathname, { method, url }, res, ctx);
    return out;
  };
  const a = await call('POST', '/api/flow/patterns', { today: '2026-10-26' });
  ok('a first ask starts a job', a.code === 202 && !!a.o.job, a);
  let g;
  for (let i = 0; i < 100; i++) { g = await call('GET', '/api/flow/patterns?job=' + a.o.job); if (g.o.status !== 'working') break; await new Promise((ok2) => setTimeout(ok2, 30)); }
  ok('the job comes back done with the read', g.o.status === 'done' && g.o.patterns.headline === READ.headline, g);
  const b2 = await call('POST', '/api/flow/patterns', { today: '2026-10-26' });
  ok('asking again the same day is free — the day\'s read is kept', b2.code === 200 && b2.o.cached && calls === 1, { b2, calls });
  const c2 = await call('POST', '/api/flow/patterns', { refresh: true });
  ok('Rewrite asks the model again', c2.code === 202);
  for (let i = 0; i < 100 && calls < 2; i++) await new Promise((ok2) => setTimeout(ok2, 30));
  ok('and that is the second call', calls === 2);
  /* three devices opening at once on a new day */
  let slow; X.setPoster(() => new Promise((ok3) => { slow = ok3; }));
  delete counter['__nothing'];
  const dayKeys = Object.keys(counter).filter((k) => /^pat:/.test(k)); dayKeys.forEach((k) => delete counter[k]);
  const before = counter[Object.keys(counter).find((k) => /^patn:/.test(k))] || 0;
  const d1 = await call('POST', '/api/flow/patterns', {}); const d2 = await call('POST', '/api/flow/patterns', {}); const d3 = await call('POST', '/api/flow/patterns', {});
  const after = counter[Object.keys(counter).find((k) => /^patn:/.test(k))] || 0;
  ok('devices asking at the same moment share one read', d1.o.job && d2.o.job === d1.o.job && d3.o.job === d1.o.job && after === before + 1, { d1: d1.o, d2: d2.o, before, after });
  slow && slow({ status: 200, body: { content: [{ type: 'text', text: JSON.stringify(READ) }] } });
  for (let i = 0; i < 50; i++) { const g2 = await call('GET', '/api/flow/patterns?job=' + d1.o.job); if (g2.o.status !== 'working') break; await new Promise((r) => setTimeout(r, 30)); }
  X.setPoster(async () => { calls++; return { status: 200, body: { content: [{ type: 'text', text: JSON.stringify(READ) }] } }; });
  const other = await (async () => { let out; await extras.handle('/api/flow/patterns', { method: 'GET', url: '/api/flow/patterns?job=' + c2.o.job }, {}, { user: { id: 'someone-else' }, json: (r, code, o) => { out = { code, o }; } }); return out; })();
  ok('another account cannot read your job', other.code === 404);
  for (let i = 0; i < 6; i++) await call('POST', '/api/flow/patterns', { refresh: true });
  const capped = await call('POST', '/api/flow/patterns', { refresh: true });
  ok('rewrites are capped per day — and the last read still comes back', capped.code === 200 && capped.o.capped === true && capped.o.patterns.headline === READ.headline, capped);
  const fresh = { get: async () => 0, set: async () => {} };
  const noLast = await (async () => { let out; await extras.handle('/api/flow/patterns', { method: 'POST', url: '/api/flow/patterns' }, {}, { user: { id: 'u2' }, mine, counter: { get: async (k) => (/^patn:/.test(k) ? 99 : null), set: async () => {} }, json: (r, code, o) => { out = { code, o }; }, readBody: async () => '{}' }); return out; })();
  ok('with no read at all, the cap says so', noLast.code === 429, noLast);
  delete process.env.ANTHROPIC_API_KEY;
  const off = await call('POST', '/api/flow/patterns', {});
  ok('no assistant on the server says so', off.code === 503);
  X.setPoster(null);

  console.log('\n— on Today —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let posts = 0, mode = 'ok', lastBody = {};
  await p.route('**/api/flow/patterns**', (rt) => {
    if (mode === 'off') return rt.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The assistant is not switched on for this app yet.' }) });
    if (rt.request().method() === 'POST') lastBody = JSON.parse(rt.request().postData() || '{}');
    if (mode === 'fail' && rt.request().method() === 'POST') { posts++; return rt.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Patterns could not be read just now.' }) }); }
    if (mode === 'capped' && rt.request().method() === 'POST') { posts++; return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'done', cached: true, capped: true, patterns: Object.assign({}, X.parsePatterns(JSON.stringify(READ)), { generatedAt: new Date().toISOString() }) }) }); }
    if (rt.request().method() === 'POST') { posts++; return rt.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, job: 'j' + posts }) }); }
    return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'done', patterns: Object.assign({}, X.parsePatterns(JSON.stringify(READ)), { generatedAt: new Date().toISOString() }) }) });
  });
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(() => Flow.Nav.go('today'));
  await p.waitForFunction(() => document.querySelector('#flow-td-habits .pt-head'), null, { timeout: 15000 }).catch(() => {});
  const card = await p.evaluate(() => { const c = document.getElementById('flow-td-habits'); return c && { head: (c.querySelector('.pt-head') || {}).textContent, label: c.querySelector('.flow-td-head .l').textContent, rows: c.querySelectorAll('.pt-list li').length, next: c.querySelectorAll('.pt-next li').length, watch: c.querySelectorAll('.pt-watch').length, fold: !!c.querySelector('.pt-hb'), habitsHidden: getComputedStyle(c.querySelector('.pt-hb-b')).display }; });
  ok('the card opens with the read', card && card.head === READ.headline && card.label === 'Patterns', card);
  ok('patterns and what to do next are listed', card.rows === 4 && card.next === 3 && card.watch === 1, card);
  ok('the habits you tick are folded under it', card.fold && card.habitsHidden === 'none', card);
  await p.click('#flow-td-habits [data-pt="habits"]'); await p.waitForTimeout(300);
  ok('and open with one tap', await p.evaluate(() => getComputedStyle(document.querySelector('#flow-td-habits .pt-hb-b')).display === 'block'));
  await p.click('#flow-td-habits .pt-hb-b .flow-today-check'); await p.waitForTimeout(900);
  ok('ticking a habit still works', await p.evaluate(() => /Habits you tick · 1 \//.test(document.querySelector('#flow-td-habits .pt-hb-t').textContent)), await p.evaluate(() => document.querySelector('#flow-td-habits .pt-hb-t').textContent));
  ok('and the fold stays open after the card redraws', await p.evaluate(() => document.querySelector('#flow-td-habits .pt-hb').classList.contains('open')));
  ok('one ask for the day so far', posts === 1, posts);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(5500);
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(2500);
  ok('after a reload the read is shown from the account, not asked again', posts === 1 && await p.evaluate(() => !!document.querySelector('#flow-td-habits .pt-head')), posts);
  await p.click('#flow-td-habits [data-pt="rewrite"]'); await p.waitForTimeout(3000);
  ok('Rewrite asks again', posts === 2, posts);

  console.log('\n— from the read to a habit —');
  const nx = await p.evaluate(() => [...document.querySelectorAll('#flow-td-habits .pt-next li')].map((li) => ({ t: li.querySelector('span').textContent, b: (li.querySelector('[data-pt="habit"]') || {}).textContent || '' })));
  ok('everything under Do next can become a habit in one tap', nx.length === 3 && nx.every((x) => x.b === '+ habit'), nx);
  const nHb = await p.evaluate(() => hbData.habits.length);
  await p.click('#flow-td-habits .pt-next li:first-child [data-pt="habit"]'); await p.waitForTimeout(700);
  ok('tapping it adds the habit', await p.evaluate(([t, n]) => hbData.habits.length === n + 1 && hbData.habits[hbData.habits.length - 1].name === t, [nx[0].t, nHb]));
  ok('and it is ticked right there, under the read', await p.evaluate((t) => [...document.querySelectorAll('#flow-td-habits .pt-hb-b .flow-td-row.hb')].some((r) => r.textContent.includes(t)) && /✓ habit/.test(document.querySelector('#flow-td-habits .pt-next li:first-child').textContent), nx[0].t));
  await p.evaluate(() => { hbData.habits = []; renderHabits(); renderToday(); }); await p.waitForTimeout(900);
  const none = await p.evaluate(() => { const c = document.getElementById('flow-td-habits'); return { none: !!c.querySelector('.pt-hbnone'), form: !!c.querySelector('.pt-addhb input'), old: !!c.querySelector('.flow-td-empty') }; });
  ok('with no habits the card says how to add one, and has a box for it — no trip to another page', none.none && none.form && !none.old, none);
  if (!(await p.evaluate(() => document.querySelector('#flow-td-habits .pt-hb').classList.contains('open')))) await p.click('#flow-td-habits [data-pt="habits"]');
  await p.fill('#flow-td-habits .pt-addhb input', 'Walk 20 minutes'); await p.press('#flow-td-habits .pt-addhb input', 'Enter'); await p.waitForTimeout(700);
  ok('typing one in adds it', await p.evaluate(() => hbData.habits.length === 1 && hbData.habits[0].name === 'Walk 20 minutes' && !!document.querySelector('#flow-td-habits .pt-hb-b .flow-td-row.hb')));

  console.log('\n— when the rewrites run out, or the read fails —');
  mode = 'capped';
  await p.click('#flow-td-habits [data-pt="rewrite"]'); await p.waitForTimeout(1500);
  const cap = await p.evaluate(() => ({ head: !!document.querySelector('#flow-td-habits .pt-head'), err: (document.querySelector('#flow-td-habits .pt-err') || {}).textContent || '', retry: !!document.querySelector('#flow-td-habits [data-pt="retry"]') }));
  ok('out of rewrites: the read stays, with a quiet note — not an error', cap.head && /No rewrites left/.test(cap.err) && !cap.retry, cap);
  mode = 'fail';
  await p.evaluate(async () => { await Flow.DB.set('flow:patterns', null); window.FlowPatterns.data = null; window.FlowPatterns.ensure(true); }); await p.waitForTimeout(1500);
  ok('a failed read offers Try again', await p.evaluate(() => !!document.querySelector('#flow-td-habits [data-pt="retry"]')));
  mode = 'ok'; lastBody = {};
  await p.click('#flow-td-habits [data-pt="retry"]'); await p.waitForTimeout(3000);
  ok('Try again asks for the day\'s read, not a paid rewrite', lastBody.refresh === false, lastBody);
  ok('and the read is back', await p.evaluate(() => !!document.querySelector('#flow-td-habits .pt-head')));
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); Flow.Nav.go('today'); }); await p.waitForTimeout(800);
  ok('Simple shows the same card in its colours', await p.evaluate(() => { const a = document.querySelector('#flow-td-habits .pt-good .pt-area'); return !!a && getComputedStyle(a).backgroundColor === 'rgb(200, 242, 107)'; }));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  ok('it fits a phone', await p.evaluate(() => { const c = document.getElementById('flow-td-habits'); return c.scrollWidth <= c.clientWidth + 2 && document.documentElement.scrollWidth <= innerWidth + 1; }));

  console.log('\n— a server without the assistant —');
  mode = 'off';
  await p.evaluate(async () => { await Flow.DB.set('flow:patterns', null); window.FlowPatterns.data = null; window.FlowPatterns.tried = ''; window.FlowPatterns.ensure(false); });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { Flow.Nav.go('journal'); Flow.Nav.go('today'); } catch (e) {} }); await p.waitForTimeout(800);
  ok('the Habits card is just the habits again', await p.evaluate(() => { const c = document.getElementById('flow-td-habits'); return !c.querySelector('.pt-box') && /Habits/.test(c.querySelector('.flow-td-head .l').textContent) && c.querySelectorAll('.flow-today-check').length > 0; }));

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
