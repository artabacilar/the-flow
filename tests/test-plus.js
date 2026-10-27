/* Flow Plus — the plan on the account, the shops that set it, and what a
 * Free account sees.
 *
 * What would make it wrong: the owner or an account from before the price
 * ever being asked to pay; a browser able to write its own plan; a webhook
 * without a valid signature changing anything; a Free account getting a
 * paid read, or a Plus one being refused; the sheet, the Settings card or
 * the lines under cards appearing in Advanced; anyone's typed-in data
 * needing a plan to export. None of this calls Stripe, RevenueCat or Anthropic. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const crypto = require('crypto');
const plus = require('../flow-plus.js');
const extras = require('../flow-extras.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const mem = {}; const deps = { getJSON: async (k, d) => (k in mem ? mem[k] : d), setJSON: async (k, v) => { mem[k] = v; } };
const sign = (body, secret, t) => { t = t || Math.floor(Date.now() / 1000); return 't=' + t + ',v1=' + crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex'); };

(async () => {
  console.log('\n— who is on which plan —');
  const I = plus._internals;
  ok('the owner is Plus for good', (await plus.planOf({ id: 'o', owner: true }, deps)).source === 'founder');
  ok('an account from before the price is Plus for good', (await plus.planOf({ id: 'e', created: '1999-05-01T00:00:00Z' }, deps)).source === 'early');
  const fresh = await plus.planOf({ id: 'n', created: '2099-01-01T00:00:00Z' }, deps);
  ok('a new account is Free', fresh.tier === 'free' && !fresh.lapsed, fresh);
  mem[I.KEY('n')] = { tier: 'plus', source: 'stripe', until: new Date(Date.now() + 864e5).toISOString() };
  ok('a paid plan that has not run out is Plus', (await plus.planOf({ id: 'n', created: '2099-01-01T00:00:00Z' }, deps)).tier === 'plus');
  mem[I.KEY('n')] = { tier: 'plus', source: 'stripe', until: new Date(Date.now() - 864e5).toISOString() };
  const lapsed = await plus.planOf({ id: 'n', created: '2099-01-01T00:00:00Z' }, deps);
  ok('one that has run out is Free again, and remembers when it ended', lapsed.tier === 'free' && !!lapsed.lapsed, lapsed);

  console.log('\n— Stripe —');
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: 'u9', customer: 'cus_1', subscription: 'sub_1', metadata: { plan: 'yearly' } } } });
  ok('a good signature passes', I.stripeSigned(body, sign(body, 'whsec_x'), 'whsec_x'));
  ok('a wrong secret does not', !I.stripeSigned(body, sign(body, 'whsec_y'), 'whsec_x'));
  ok('a stale timestamp does not', !I.stripeSigned(body, sign(body, 'whsec_x', Math.floor(Date.now() / 1000) - 3600), 'whsec_x'));
  ok('no header does not', !I.stripeSigned(body, '', 'whsec_x'));
  await I.applyStripe(JSON.parse(body), deps);
  ok('a completed checkout makes the account Plus and remembers the customer', mem[I.KEY('u9')].tier === 'plus' && mem[I.CUST('cus_1')].uid === 'u9', mem[I.KEY('u9')]);
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  await I.applyStripe({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'trialing', current_period_end: end, cancel_at_period_end: false } } }, deps);
  ok('the subscription sets how long Plus runs, with a few days of grace', Date.parse(mem[I.KEY('u9')].until) > end * 1000 && mem[I.KEY('u9')].tier === 'plus', mem[I.KEY('u9')]);
  await I.applyStripe({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: end, cancel_at_period_end: true } } }, deps);
  ok('cancelling keeps Plus until the paid time runs out', mem[I.KEY('u9')].tier === 'plus' && mem[I.KEY('u9')].ends === true);
  await I.applyStripe({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } }, deps);
  ok('a deleted subscription is Free', mem[I.KEY('u9')].tier === 'free');
  ok('an event for an unknown customer changes nothing', (await I.applyStripe({ type: 'customer.subscription.updated', data: { object: { id: 's', customer: 'cus_nobody', status: 'active' } } }, deps)).ignored);

  console.log('\n— RevenueCat —');
  const exp = Date.now() + 365 * 864e5;
  await I.applyRevenueCat({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'u7', store: 'APP_STORE', product_id: 'plus_yearly', expiration_at_ms: exp } }, deps);
  ok('a purchase on the App Store is Plus until it expires', mem[I.KEY('u7')].tier === 'plus' && mem[I.KEY('u7')].source === 'apple' && Date.parse(mem[I.KEY('u7')].until) > exp, mem[I.KEY('u7')]);
  await I.applyRevenueCat({ event: { type: 'CANCELLATION', app_user_id: 'u7', store: 'APP_STORE', expiration_at_ms: exp } }, deps);
  ok('switching auto-renew off keeps the paid time', mem[I.KEY('u7')].tier === 'plus' && mem[I.KEY('u7')].ends);
  await I.applyRevenueCat({ event: { type: 'EXPIRATION', app_user_id: 'u7', store: 'PLAY_STORE' } }, deps);
  ok('expiry is Free', mem[I.KEY('u7')].tier === 'free');
  ok('an anonymous id is ignored', (await I.applyRevenueCat({ event: { type: 'RENEWAL', app_user_id: '$RCAnonymousID:abc' } }, deps)).reason === 'no uid');

  console.log('\n— what Free may ask the assistant —');
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let calls = 0;
  const READ = { headline: 'A good week.', patterns: [], next: [], missing: '' };
  extras._internals.patterns.setPoster(async () => { calls++; return { status: 200, body: { content: [{ type: 'text', text: JSON.stringify(READ) }] } }; });
  const counter = {}; const C = { get: async (k) => counter[k] || 0, set: async (k, v) => { counter[k] = v; } };
  const call = async (method, url, body, plan) => { let out; await extras.handle(new URL(url, 'http://x').pathname, { method, url }, {}, { user: { id: 'f1' }, mine: { get: async () => null, all: async () => ({}) }, counter: C, plan, json: (r2, code, o) => { out = { code, o }; }, readBody: async () => JSON.stringify(body || {}) }); return out; };
  const wait = async (job) => { let g; for (let i = 0; i < 100; i++) { g = await call('GET', '/api/flow/patterns?job=' + job, null, { tier: 'free' }); if (g.o.status !== 'working') break; await new Promise((k) => setTimeout(k, 30)); } return g; };
  const f1 = await call('POST', '/api/flow/patterns', {}, { tier: 'free' });
  ok('Free gets a read', f1.code === 202, f1);
  await wait(f1.o.job);
  Object.keys(counter).filter((k) => /^pat:/.test(k)).forEach((k) => delete counter[k]);   /* a new day, same week */
  const f2 = await call('POST', '/api/flow/patterns', {}, { tier: 'free' });
  ok('the next day it is the same read, marked as what Plus adds', f2.code === 200 && f2.o.capped && f2.o.plus && f2.o.patterns.headline === READ.headline && calls === 1, f2);
  const f3 = await call('POST', '/api/flow/patterns', { refresh: true }, { tier: 'free' });
  ok('a rewrite is refused, with the last read attached', f3.code === 402 && f3.o.plus && f3.o.feature === 'patterns' && f3.o.patterns.headline === READ.headline, f3);
  const p1 = await call('POST', '/api/flow/patterns', { refresh: true }, { tier: 'plus' });
  ok('Plus rewrites', p1.code === 202, p1);
  await wait(p1.o.job);
  const noPlan = await call('POST', '/api/flow/patterns', { refresh: true });
  ok('no plan in the call (an older caller) is Plus', noPlan.code === 202, noPlan);
  delete process.env.ANTHROPIC_API_KEY; extras._internals.patterns.setPoster(null);

  console.log('\n— on the server —');
  const jar = {}; const J = (who) => jar[who] || '';
  const api = async (who, method, path, body, headers) => {
    const r = await fetch(H + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: J(who) }, headers || {}), body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) jar[who] = sc.map((c) => c.split(';')[0]).join('; ');
    let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { j = { raw: t }; }
    return { status: r.status, j, headers: r.headers };
  };
  await api('owner', 'POST', '/api/auth/signup', { email: process.env.FLOW_OWNER_EMAIL, name: 'Artur', password: 'a properly long password' });
  const op = await api('owner', 'GET', '/api/flow/plan');
  ok('the owner\'s plan is Plus, founder', op.status === 200 && op.j.tier === 'plus' && op.j.source === 'founder', op.j);
  await api('friend', 'POST', '/api/auth/signup', { email: 'ali.friend@example.com', name: 'Ali', password: 'a properly long password', invite: 'letmein' });
  const fp = await api('friend', 'GET', '/api/flow/plan');
  ok('a new account is Free, and told the prices and the trial', fp.status === 200 && fp.j.tier === 'free' && fp.j.prices.monthly === '$9.99' && fp.j.prices.yearly === '$79.99' && fp.j.trialDays === 14 && fp.j.checkout === false, fp.j);
  const uid = (J('friend').match(/flow_acct=([^;]+)/) || [])[1];
  ok('the account id is known', !!uid);
  const d = await api('friend', 'POST', '/api/flow/direction', {});
  ok('Direction is refused for Free, as a Plus refusal', d.status === 402 && d.j.plus && d.j.feature === 'direction', d);
  const a = await api('friend', 'POST', '/api/flow/ahead', { items: [{ date: '2026-11-01', title: 'x' }] });
  ok('so is Coming up\'s read', a.status === 402 && a.j.plus, a);
  const co = await api('friend', 'POST', '/api/flow/plan/checkout', { plan: 'yearly', origin: H });
  ok('with no Stripe keys the checkout says so instead of failing', co.status === 503 && /not switched on/.test(co.j.error), co);
  const ex = await api('friend', 'GET', '/api/flow/account/export');
  ok('Free can take everything with them', ex.status === 200 && ex.j.app === 'The Flow' && ex.j.data && typeof ex.j.data === 'object' && /attachment/.test(ex.headers.get('content-disposition') || ''), ex.status);
  const noAuth = await api('nobody', 'GET', '/api/flow/plan');
  ok('signed out, there is no plan to read', noAuth.status === 401);
  await api('friend', 'POST', '/api/set', { key: 'flow:plan', value: JSON.stringify({ tier: 'plus' }) });
  const still = await api('friend', 'GET', '/api/flow/plan');
  ok('writing a plan into your own data changes nothing', still.j.tier === 'free');

  const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: uid, customer: 'cus_live', subscription: 'sub_live', metadata: { plan: 'yearly' } } } });
  const bad = await api('nobody', 'POST', '/api/plus/webhook/stripe', ev, { 'Stripe-Signature': sign(ev, 'whsec_wrong') });
  ok('a Stripe webhook with a bad signature is refused', bad.status === 400 && (await api('friend', 'GET', '/api/flow/plan')).j.tier === 'free');
  const good = await api('nobody', 'POST', '/api/plus/webhook/stripe', ev, { 'Stripe-Signature': sign(ev, process.env.STRIPE_WEBHOOK_SECRET) });
  const now = await api('friend', 'GET', '/api/flow/plan');
  ok('a signed one makes the account Plus', good.status === 200 && now.j.tier === 'plus' && now.j.source === 'stripe', { good: good.j, now: now.j });
  const d2 = await api('friend', 'POST', '/api/flow/direction', {});
  ok('and Direction is no longer refused for being Free', d2.status !== 402, d2.status);
  const del = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_live', customer: 'cus_live', status: 'canceled' } } });
  await api('nobody', 'POST', '/api/plus/webhook/stripe', del, { 'Stripe-Signature': sign(del, process.env.STRIPE_WEBHOOK_SECRET) });
  ok('a cancelled subscription is Free again', (await api('friend', 'GET', '/api/flow/plan')).j.tier === 'free');
  const rcBad = await api('nobody', 'POST', '/api/plus/webhook/revenuecat', { event: { type: 'INITIAL_PURCHASE', app_user_id: uid, store: 'APP_STORE', expiration_at_ms: Date.now() + 864e5 } }, { Authorization: 'nope' });
  ok('a RevenueCat webhook without the shared secret is refused', rcBad.status === 401);
  const rcGood = await api('nobody', 'POST', '/api/plus/webhook/revenuecat', { event: { type: 'INITIAL_PURCHASE', app_user_id: uid, store: 'APP_STORE', expiration_at_ms: Date.now() + 864e5 } }, { Authorization: process.env.REVENUECAT_WEBHOOK_AUTH });
  ok('with it, an App Store purchase is Plus', rcGood.status === 200 && (await api('friend', 'GET', '/api/flow/plan')).j.source === 'apple');
  await api('nobody', 'POST', '/api/plus/webhook/revenuecat', { event: { type: 'EXPIRATION', app_user_id: uid, store: 'APP_STORE' } }, { Authorization: process.env.REVENUECAT_WEBHOOK_AUTH });
  ok('and expiry is Free', (await api('friend', 'GET', '/api/flow/plan')).j.tier === 'free');

  console.log('\n— what a Free account sees, in Simple and in Advanced —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/api/flow/patterns**', (rt) => rt.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: 'This is part of Flow Plus.', plus: true, feature: 'patterns' }) }));
  await p.route('**/api/flow/ahead**', (rt) => rt.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: 'This is part of Flow Plus.', plus: true, feature: 'ahead' }) }));
  await p.route('**/api/connect/list', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: '{"connections":[]}' }));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.fill('#fa-email', 'ali.friend@example.com'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  ok('a new account opens in Simple', await p.evaluate(() => document.documentElement.getAttribute('data-flow-look') === 'new'));
  ok('the browser knows the plan', await p.evaluate(() => window.FlowPlus.state && window.FlowPlus.state.tier === 'free'));
  await p.evaluate(() => { if (document.getElementById('flow-fr')) window.FlowFirstRun.finish(document.getElementById('flow-fr'), null, []); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { window.FlowPatterns.tried = ''; Flow.Nav.go('today'); }); await p.waitForTimeout(2500);
  const td = await p.evaluate(() => { const h = document.getElementById('flow-td-habits'), a = document.getElementById('flow-td-ahead'); return { hab: h && !!h.querySelector('.plus-line [data-plus-open="patterns"]'), ahead: a ? !!a.querySelector('.plus-line [data-plus-open="ahead"]') : null, sheet: !!document.querySelector('#flow-plus.on') }; });
  ok('Simple: Patterns says what Plus adds, in a line, without opening anything by itself', td.hab && !td.sheet, td);
  await p.evaluate(() => window.FlowAhead && window.FlowAhead.ensure && window.FlowAhead.ensure(false)); await p.waitForTimeout(800);
  await p.click('#flow-td-habits [data-plus-open="patterns"]'); await p.waitForTimeout(400);
  const sh = await p.evaluate(() => { const el = document.getElementById('flow-plus'); return { on: el.classList.contains('on'), h: el.querySelector('.plus-h').textContent, y: el.querySelector('[data-plus="yearly"]').textContent, m: el.querySelector('[data-plus="monthly"]').textContent }; });
  ok('the Plus sheet opens from it with the two prices and the trial', sh.on && /Patterns every morning/.test(sh.h) && /14 days free/.test(sh.y) && /\$79\.99/.test(sh.y) && /\$9\.99 a month/.test(sh.m), sh);
  await p.click('#flow-plus [data-plus="yearly"]'); await p.waitForTimeout(600);
  ok('buying before the shop is open says so, quietly', await p.evaluate(() => /Subscriptions open soon/.test(document.body.textContent) && location.pathname === '/'));
  await p.click('#flow-plus .plus-later'); await p.waitForTimeout(300);
  ok('Not now closes it', await p.evaluate(() => !document.querySelector('#flow-plus.on')));
  await p.evaluate(() => Flow.Nav.go('settings')); await p.waitForTimeout(800);
  const st = await p.evaluate(() => { const c = document.getElementById('plusCard'); return c && { status: c.querySelector('.plus-status').textContent, btn: (c.querySelector('[data-plus-act="open"]') || {}).textContent, exp: !!c.querySelector('[data-plus-act="export"]'), eve: !!c.querySelector('[data-s="eveningCheck"]'), first: c === document.querySelector('#tab-settings .flow-card, section .flow-card') }; });
  ok('Settings opens with the plan card: Free, a trial button, export, the evening check-in', st && /Free/.test(st.status) && /Try Plus free for 14 days/.test(st.btn) && st.exp && st.eve, st);
  await p.click('#plusCard [data-plus-act="open"]'); await p.waitForTimeout(400);
  ok('the card opens the same sheet', await p.evaluate(() => !!document.querySelector('#flow-plus.on')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.click('#plusCard [data-s="eveningCheck"]'); await p.waitForTimeout(600);
  ok('the evening check-in is a setting on the account', await p.evaluate(async () => (await Flow.DB.get('flow:settings', {})).eveningCheck === true));

  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('settings'); }); await p.waitForTimeout(800);
  ok('Advanced: no plan card in Settings', await p.evaluate(() => !document.getElementById('plusCard')));
  await p.evaluate(() => { window.FlowPatterns.tried = ''; window.FlowPatterns.plus = false; Flow.Nav.go('today'); }); await p.waitForTimeout(2500);
  const adv = await p.evaluate(() => { const h = document.getElementById('flow-td-habits'); return { line: !!document.querySelector('.plus-line'), sheet: !!document.querySelector('#flow-plus.on'), habits: !!h }; });
  ok('Advanced: no line under the card, no sheet — the card is just the habits', !adv.line && !adv.sheet && adv.habits, adv);
  await p.evaluate(() => window.FlowPlus.open('patterns')); await p.waitForTimeout(200);
  ok('and the sheet cannot be opened at all', await p.evaluate(() => !document.querySelector('#flow-plus.on')));

  console.log('\n— the owner, in Simple —');
  const p2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p2.route('**/api/flow/patterns**', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' }));
  await p2.goto(H + '/', { waitUntil: 'load' }); await p2.waitForTimeout(2500);
  await p2.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p2.fill('#fa-pw', 'a properly long password');
  await submitAuth(p2); await p2.waitForTimeout(4500);
  await p2.evaluate(async () => { const fr = document.getElementById('flow-fr'); if (fr) fr.remove(); await Flow.DB.set('flow:firstrun', null); addRock('The week that was already here', 'Work', 0, '', weekId(new Date()), {}); await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('settings'); }); await p2.waitForTimeout(800);
  const own = await p2.evaluate(() => { const c = document.getElementById('plusCard'); return c && { status: c.querySelector('.plus-status').textContent, buy: !!c.querySelector('[data-plus-act="open"]') }; });
  ok('the owner\'s card says Plus for good and sells nothing', own && /founder/.test(own.status) && !own.buy, own);
  await p2.evaluate(() => window.FlowFirstRun.boot()); await p2.waitForTimeout(700);
  ok('an account that already has a week of its own never sees the first run', await p2.evaluate(() => !document.getElementById('flow-fr')));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
