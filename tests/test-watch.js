/* The watch — Apple Watch and Wear OS read one short day and can tick it.
 *
 * What would make it wrong: "today" being the server's day rather than the
 * person's (UTC midnight is 03:00 in Istanbul), a dropped or delegated rock
 * showing up, a tick landing on the wrong habit or the wrong day, a pairing
 * code that works twice, a token handed to anyone who asks, or a watch that
 * keeps working after it was unlinked. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const W = require('../flow-watch.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const memStore = (init) => { const m = Object.assign({}, init); return { m, get: async (k) => (m[k] == null ? null : m[k]), set: async (k, v) => { m[k] = v; } }; };

(async () => {
  console.log('\n— whose day it is —');
  /* Tuesday 27 Oct 2026, 22:30 UTC = Wednesday 01:30 in Istanbul. */
  const late = new Date(Date.UTC(2026, 9, 27, 22, 30));
  const st = memStore({
    ld_compass: JSON.stringify({ rocks: { '2026-W44': [
      { id: 'a', title: 'Tuesday thing', day: 1, done: false },
      { id: 'b', title: 'Wednesday at nine', day: 2, time: '09:00', done: false },
      { id: 'c', title: 'Wednesday, [no time](https://x.y)', day: 2, done: false },
      { id: 'd', title: 'Wednesday done', day: 2, done: true },
      { id: 'e', title: 'Friday', day: 4, done: false }
    ] }, aside: [{ id: 'z', title: 'Dropped one', day: 2, wid: '2026-W44', status: 'dropped' }] }),
    ld_habits: JSON.stringify({ habits: [{ id: 'h1', name: 'Read' }, { id: 'h2', name: 'Walk' }], completions: { h1: { '2026-10-28': true } } }),
    'flow:settings': JSON.stringify({ timezone: 'Europe/Istanbul' })
  });
  const t = await W.today(st, { now: late });
  ok('at 22:30 UTC it is already Wednesday in Istanbul', t.date === '2026-10-28' && t.weekday === 'Wednesday' && t.now === '01:30', t);
  ok('the watch can say its own zone', (await W.today(st, { now: late, tz: 'Europe/London' })).date === '2026-10-27');
  ok('a zone that is not one falls back, it does not break', (await W.today(st, { now: late, tz: 'Mars/Olympus' })).date === '2026-10-28');
  ok('today\'s open rocks first, then the one that slipped, then what is done', t.rocks.map((r) => r.id).join('') === 'bcad', t.rocks.map((r) => r.id));
  ok('the slipped one is marked overdue', t.rocks.find((r) => r.id === 'a').overdue === true);
  ok('links read as their words', t.rocks.find((r) => r.id === 'c').title === 'Wednesday, no time');
  ok('a dropped rock is nowhere', !JSON.stringify(t).includes('Dropped one'));
  ok('next is the one at nine', t.next && t.next.id === 'b' && t.next.when === 'Today 09:00', t.next);
  ok('the headline is the phone\'s, in Simple\'s words', t.headline === '2 Priorities for today, 1 overdue.', t.headline);
  const tTr = await W.today(st, { now: late, lang: 'tr' });
  ok('in Turkish when the watch is: the headline, the weekday, the "when"', tTr.headline === 'Bugün için 2 öncelik, 1 gecikmiş.' && tTr.weekday === 'Çarşamba' && tTr.next.when === 'Bugün 09:00' && tTr.rocks.find((r) => r.id === 'a').day === 'Sal', { h: tTr.headline, w: tTr.weekday, n: tTr.next });
  st.m['flow:lang'] = JSON.stringify('tr');
  ok('or when the account chose Turkish in the app', (await W.today(st, { now: late })).headline.startsWith('Bugün'));
  ok('the watch\'s own language wins over the account\'s', (await W.today(st, { now: late, lang: 'en' })).headline.startsWith('2 Priorities'));
  delete st.m['flow:lang'];
  ok('habits say which are done today', t.habits.find((h) => h.id === 'h1').done === true && t.habits.find((h) => h.id === 'h2').done === false);
  ok('and which door each opens: Read and Walk are timers, ten minutes', t.habits.every((h) => h.kind === 'timer' && h.minutes === 10), t.habits);
  ok('and the rest of the week is counted', t.week.more === 1 && t.week.total === 5 && t.week.done === 1, t.week);

  console.log('\n— what a tap changes —');
  await W.act(st, { action: 'rock', id: 'b', done: true }, { now: late });
  ok('ticking a rock marks it done', JSON.parse(st.m.ld_compass).rocks['2026-W44'].find((r) => r.id === 'b').done === true);
  ok('and says so in the journal, from the watch', /done on Apple Watch: Wednesday at nine/.test(st.m.ld_journal));
  await W.act(st, { action: 'habit', id: 'h2' }, { now: late, device: 'wearos' });
  ok('a habit is ticked for the person\'s today, not the server\'s', JSON.parse(st.m.ld_habits).completions.h2['2026-10-28'] === true && !JSON.parse(st.m.ld_habits).completions.h2['2026-10-27']);
  await W.act(st, { action: 'habit', id: 'h1', done: false }, { now: late });
  ok('and can be unticked', !JSON.parse(st.m.ld_habits).completions.h1['2026-10-28']);
  await W.act(st, { action: 'add', text: '  Call   the venue  ' }, { now: late, device: 'wearos' });
  const added = JSON.parse(st.m.ld_compass).rocks['2026-W44'].find((r) => r.title === 'Call the venue');
  ok('a Big Rock said to the watch lands on today', added && added.day === 2, added);
  ok('marked as from the Wear OS watch', /added on Wear OS watch/.test(st.m.ld_journal));
  await W.act(st, { action: 'add', text: 'Pick up the suit', day: 'tomorrow' }, { now: late });
  ok('or tomorrow', JSON.parse(st.m.ld_compass).rocks['2026-W44'].find((r) => r.title === 'Pick up the suit').day === 3);
  await W.act(st, { action: 'add', text: 'Booked the photographer', done: true }, { now: late });
  const dn = JSON.parse(st.m.ld_compass).rocks['2026-W44'].find((r) => r.title === 'Booked the photographer');
  ok('"Done today" adds it to today, already done', dn && dn.day === 2 && dn.done === true, dn);
  ok('and the journal says it was added done', /added done on Apple Watch/.test(st.m.ld_journal));
  await W.act(st, { action: 'add', text: 'Not yet', day: 'tomorrow', done: true }, { now: late });
  ok('tomorrow can not be done yet', JSON.parse(st.m.ld_compass).rocks['2026-W44'].find((r) => r.title === 'Not yet').done === false);
  await W.act(st, { action: 'add', kind: 'note', text: 'The venue wants a deposit by Friday' }, { now: late });
  const j = JSON.parse(st.m['flow:journal']);
  ok('a note goes to the journal, on the person\'s date', j.length === 1 && j[0].date === '2026-10-28' && j[0].tags.includes('watch'), j[0]);
  await W.act(st, { action: 'move', id: 'a', to: 'tomorrow' }, { now: late });
  const mv = JSON.parse(st.m.ld_compass).rocks['2026-W44'].find((r) => r.id === 'a');
  ok('an overdue one moved to tomorrow from the wrist lands on Thursday, open, counted as moved', mv && mv.day === 3 && !mv.done && mv.moved === 1, mv);
  await W.act(st, { action: 'move', id: 'a', to: 'today' }, { now: late });
  ok('or today', JSON.parse(st.m.ld_compass).rocks['2026-W44'].find((r) => r.id === 'a').day === 2);
  st.m.ld_habits = JSON.stringify({ habits: [{ id: 'hw', name: 'Write 3 sentences before bed' }], completions: {} });
  ok('a writing habit says so', (await W.today(st, { now: late })).habits[0].kind === 'write');
  st.m['flow:habitkinds'] = JSON.stringify({ hw: 'tick' });
  ok('unless the person chose another door in the app', (await W.today(st, { now: late })).habits[0].kind === 'tick');
  await W.act(st, { action: 'habit', id: 'hw', done: true, text: 'Slow day. Sent the invoices. Venue first thing tomorrow.' }, { now: late });
  const jj = JSON.parse(st.m['flow:journal']); const lastJ = jj[jj.length - 1];
  ok('the sentences said to the watch go to the journal under the habit, and today is ticked', /invoices/.test(lastJ.body) && lastJ.tags.includes('Write 3 sentences before bed') && lastJ.date === '2026-10-28' && JSON.parse(st.m.ld_habits).completions.hw['2026-10-28'] === true, lastJ);

  console.log('\n— a Priority that repeats —');
  /* the invoices, monthly on the 1st; ticked on the wrist on 28 October */
  const rs = memStore({ ld_compass: JSON.stringify({ rocks: { '2026-W44': [{ id: 'inv', title: 'Send the invoices', day: 6, time: '10:00', prio: 'med', done: false, repeat: 'month', series: 'inv' }] } }) });
  await W.act(rs, { action: 'rock', id: 'inv', done: true }, { now: late });
  const rc = JSON.parse(rs.m.ld_compass);
  const nx = (rc.rocks['2026-W49'] || []).find((r) => r.id === 'inv@2026-12-01');
  ok('ticking it writes the next one: 1 December, same time and rule', nx && nx.day === 1 && nx.time === '10:00' && nx.repeat === 'month' && nx.series === 'inv' && !nx.done, Object.keys(rc.rocks));
  await W.act(rs, { action: 'rock', id: 'inv', done: false }, { now: late });
  await W.act(rs, { action: 'rock', id: 'inv', done: true }, { now: late });
  const n2 = Object.values(JSON.parse(rs.m.ld_compass).rocks).flat().filter((r) => r.series === 'inv').length;
  ok('ticking it again does not write a second one', n2 === 2, n2);
  const ps = memStore({ ld_compass: JSON.stringify({ rocks: { '2026-W40': [{ id: 'w', title: 'Water the plants', day: 0, done: false, repeat: 'week', series: 'w' }] } }) });
  await W.act(ps, { action: 'rock', id: 'w', done: true }, { now: late });
  const pw = Object.values(JSON.parse(ps.m.ld_compass).rocks).flat().filter((r) => r.series === 'w' && r.id !== 'w');
  ok('a weekly one ticked weeks late gets one next, on or after today — not a pile', pw.length === 1 && pw[0].id === 'w@2026-11-02', pw.map((r) => r.id));

  let err = null; try { await W.act(st, { action: 'rock', id: 'nope' }); } catch (e) { err = e; }
  ok('a rock that has gone says so', err && err.code === 404);
  err = null; try { await W.act(st, { action: 'delete', id: 'a' }); } catch (e) { err = e; }
  ok('and nothing can be removed from a watch', err && err.code === 400);
  ok('a Sunday-to-Monday add crosses into next week', (() => { const s2 = memStore({}); return W.act(s2, { action: 'add', text: 'x', day: 'tomorrow' }, { now: new Date(Date.UTC(2026, 10, 1, 10)) }).then(() => !!JSON.parse(s2.m.ld_compass).rocks['2026-W45']); })());

  console.log('\n— linking —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  const api = (await chromium.launch());
  const watch = await api.newPage();
  const pair = async (device, model) => (await watch.request.post(H + '/api/watch/pair', { data: { device, model } })).json();
  const poll = async (id) => watch.request.get(H + '/api/watch/pair?id=' + encodeURIComponent(id));
  const P = await pair('watchos', 'Series 9');
  ok('a watch gets a short code without signing in', /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(P.code) && P.id.length > 20 && P.expiresIn === 600, P);
  ok('and waits', (await (await poll(P.id)).json()).status === 'waiting');
  ok('a stranger asking for a watch\'s day gets nothing', (await watch.request.get(H + '/api/watch')).status() === 401);
  await p.evaluate(() => Flow.Nav.go('settings')); await p.waitForTimeout(900);
  ok('Settings has a Watch card', await p.evaluate(() => !!document.querySelector('#watchCard #watchCode')));
  await p.fill('#watchCode', 'zzz999'); await p.click('#watchForm button'); await p.waitForTimeout(700);
  ok('a wrong code is refused', /not right/.test(await p.textContent('#watchOut')), await p.textContent('#watchOut'));
  await p.fill('#watchCode', P.code.toLowerCase().replace('-', ' ')); await p.click('#watchForm button'); await p.waitForTimeout(900);
  ok('the code typed any old way links it', /Linked ✓ — Apple Watch · Series 9/.test(await p.textContent('#watchOut')), await p.textContent('#watchOut'));
  ok('and it is listed, with Unlink', await p.evaluate(() => /Apple Watch · Series 9/.test(document.getElementById('watchList').textContent) && /Unlink/.test(document.getElementById('watchList').textContent)));
  const got = await (await poll(P.id)).json();
  ok('the watch collects its token', got.status === 'linked' && /^flow_/.test(got.token) && got.who === 'Artur', got.status);
  ok('once — asking again gets nothing', (await poll(P.id)).status() === 404);
  const again = await p.evaluate(async (code) => (await fetch('/api/flow/watch/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).status, P.code);
  ok('and the code cannot be used twice', again === 404, again);
  const auth = { Authorization: 'Bearer ' + got.token, 'X-Flow-Device': 'watchOS' };
  await p.evaluate(async () => { const t = (new Date().getDay() + 6) % 7, w = weekId(new Date()); cData.rocks[w] = [{ id: 'w1', title: 'From the wrist', day: t, prio: 'med', done: false }]; cSave(); await new Promise((r) => setTimeout(r, 1500)); });
  const day = await (await watch.request.get(H + '/api/watch?tz=Europe/Istanbul', { headers: auth })).json();
  ok('with it, the watch reads the day', day.rocks && day.rocks.some((r) => r.id === 'w1') && day.headline, day.headline);
  const after = await (await watch.request.post(H + '/api/watch', { headers: auth, data: { action: 'rock', id: 'w1', done: true } })).json();
  ok('and a tick comes back as the new day in one round trip', after.rocks.find((r) => r.id === 'w1').done === true);
  const askNo = await watch.request.post(H + '/api/watch/ask', { data: { text: 'what is left today?' } });
  ok('asking the assistant from a watch needs its token', askNo.status() === 401);
  const ask = await watch.request.post(H + '/api/watch/ask', { headers: auth, data: { text: 'what is left today?', lang: 'en' } });
  const askB = await ask.json().catch(() => ({}));
  ok('with it, the question reaches the assistant (off on this test server, so it says so)', ask.status() === 503 && /assistant/i.test(askB.error || ''), { s: ask.status(), b: askB });
  const spk = await watch.request.post(H + '/api/watch/speak', { headers: auth, data: { text: 'Very good, sir.' } });
  ok('and the premium voice is asked the same way — falling back when it is not set up', spk.status() === 503 && (await spk.json()).fallback === true);
  const Q = await pair('watchos', 'Series 9');
  await p.evaluate(async (code) => fetch('/api/flow/watch/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }), Q.code);
  const got2 = await (await poll(Q.id)).json();
  ok('pairing the same watch again replaces its token', (await watch.request.get(H + '/api/watch', { headers: auth })).status() === 401 && (await watch.request.get(H + '/api/watch', { headers: { Authorization: 'Bearer ' + got2.token } })).status() === 200);
  await p.evaluate(() => Flow.Nav.go('today')); await p.evaluate(() => Flow.Nav.go('settings')); await p.waitForTimeout(900);
  p.on('dialog', (d) => d.accept());
  await p.click('#watchList [data-mcp="revoke"]'); await p.waitForTimeout(900);
  ok('Unlink stops the watch straight away', (await watch.request.get(H + '/api/watch', { headers: { Authorization: 'Bearer ' + got2.token } })).status() === 401);
  const wo = await pair('wearos', 'Pixel Watch 3');
  await p.evaluate(async (code) => fetch('/api/flow/watch/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }), wo.code);
  ok('a Wear OS watch links the same way', (await (await poll(wo.id)).json()).status === 'linked');
  const r404 = await watch.request.post(H + '/api/watch/pair', { data: {} });
  ok('codes are still handed out to a watch that asks politely', r404.status() === 200);
  let last = 200; for (let i = 0; i < 14; i++) last = (await watch.request.post(H + '/api/watch/pair', { data: {} })).status();
  ok('but not without limit', last === 429, last);
  const land = await watch.request.get(H + '/watch', { maxRedirects: 0 });
  ok('theflow.today/watch opens the app at the code box', land.status() === 302 && /go=watch/.test(land.headers().location || ''), land.status());
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await api.close(); await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
