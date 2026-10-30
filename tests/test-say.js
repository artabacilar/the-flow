/* Say it — the voice assistant.
 *
 * What would make it wrong: an action the person did not confirm being
 * applied; the model naming a Priority or habit that does not exist and the
 * app acting on it anyway; a made-up date landing a Priority on the wrong
 * day; the cards not following an edit or a removal; "Do it" writing through
 * some path other than the app's own (so it would not save or sync); the
 * Talk button showing in Advanced; a page name that is not a page. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const X = require('../flow-extras.js')._internals.say;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  console.log('\n— what the model says is checked before anyone sees it —');
  const known = { today: '2026-10-30', rocks: [{ id: 'r1', title: 'Renew the insurance', date: '2026-10-27' }], habits: [{ id: 'h1', name: 'Cold shower' }] };
  const parsed = X.parseDo(JSON.stringify({ say: 'Five things.', actions: [
    { type: 'rock', title: '  Call   the venue ', date: '2026-10-31', time: '9:30' },
    { type: 'rock', title: 'No date given' },
    { type: 'rock', title: 'Bad date', date: '31/10/2026' },
    { type: 'tick', habit: 'h1' }, { type: 'tick', habit: 'h-made-up' },
    { type: 'move', rock: 'r1', date: '2026-11-02' }, { type: 'move', rock: 'r-made-up', date: '2026-11-02' }, { type: 'move', rock: 'r1', date: 'friday' },
    { type: 'done', rock: 'r1' }, { type: 'done', rock: 'nope' },
    { type: 'open', page: 'habits' }, { type: 'open', page: 'admin' },
    { type: 'delete', rock: 'r1' }, { type: 'journal', text: 'Today felt slow.' }, { type: 'habit', name: 'Read 20 minutes' }
  ] }), known);
  const types = parsed.actions.map((a) => a.type).join(',');
  ok('only the seven known kinds survive, in order', types === 'rock,rock,rock,tick,move,done,open,journal,habit', types);
  ok('a title is tidied and a time padded', parsed.actions[0].title === 'Call the venue' && parsed.actions[0].time === '09:30', parsed.actions[0]);
  ok('no date, or a date that is not one, means today — never a guess', parsed.actions[1].date === '2026-10-30' && parsed.actions[2].date === '2026-10-30', parsed.actions.slice(1, 3));
  ok('a Priority or habit that is not in the list is never acted on', !parsed.actions.some((a) => a.habit === 'h-made-up' || a.rock === 'r-made-up' || a.rock === 'nope'));
  ok('a move needs a real date', parsed.actions.filter((a) => a.type === 'move').length === 1);
  ok('only real pages open', parsed.actions.filter((a) => a.type === 'open').map((a) => a.page).join() === 'habits');
  ok('nothing can delete', !parsed.actions.some((a) => a.type === 'delete'));
  ok('prose around the JSON is tolerated, nonsense is not', !!X.parseDo('Sure! {"say":"ok","actions":[]} hope that helps') && X.parseDo('no json here') === null);
  ok('at most twelve actions', X.parseDo(JSON.stringify({ actions: Array.from({ length: 30 }, (_, i) => ({ type: 'habit', name: 'h' + i })) }), known).actions.length === 12);

  console.log('\n— the endpoint —');
  const calls = [];
  X.setPoster(async (url, h, payload) => { calls.push(payload); return { status: 200, body: { content: [{ type: 'text', text: '{"say":"One Priority.","actions":[{"type":"rock","title":"Call the venue","date":"2026-10-31"}]}' }] } }; });
  const mk = () => { const out = {}; return { out, res: {}, ctx: { json: (r, s, b) => { out.status = s; out.body = b; }, readBody: async () => out.req, plan: { tier: 'plus' }, counter: { m: {}, get(k) { return this.m[k] || 0; }, set(k, v) { this.m[k] = v; } } } }; };
  process.env.ANTHROPIC_API_KEY = 'test';
  const a = mk(); a.out.req = JSON.stringify({ text: 'tomorrow call the venue', lang: 'en', ctx: { today: '2026-10-30', rocks: [{ id: 'r1', title: 'Renew the insurance', date: '2026-10-27', note: 'SECRET NOTE' }], habits: [] } });
  await X.handle('/api/flow/do', { method: 'POST' }, a.res, a.ctx);
  ok('answers with what was heard, a sentence and the actions', a.out.status === 200 && a.out.body.heard === 'tomorrow call the venue' && a.out.body.actions.length === 1 && a.out.body.say === 'One Priority.', a.out.body);
  ok('the model is sent titles and ids, never notes', calls.length === 1 && /Renew the insurance/.test(calls[0].messages[0].content) && !/SECRET NOTE/.test(calls[0].messages[0].content));
  const e = mk(); e.out.req = JSON.stringify({ text: '   ' });
  await X.handle('/api/flow/do', { method: 'POST' }, e.res, e.ctx);
  ok('nothing said is refused before any cost', e.out.status === 400 && calls.length === 1);
  const f = mk(); f.ctx.plan = { tier: 'free' }; f.ctx.counter.m['dow:' + (() => { const d = new Date(); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0'); })()] = X.config().free; f.out.req = JSON.stringify({ text: 'hello' });
  await X.handle('/api/flow/do', { method: 'POST' }, f.res, f.ctx);
  ok('the free allowance ends in the Plus sheet, not an error', f.out.status === 402 && f.out.body.plus === true && f.out.body.feature === 'voice', f.out);
  ok('other paths are not taken', (await X.handle('/api/flow/doo', { method: 'POST' }, {}, mk().ctx)) === false);

  console.log('\n— in the app —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  const errs = []; p.on('pageerror', (er) => errs.push(er.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);

  const ids = await p.evaluate(async () => {
    const t = new Date(); const w = weekId(t), d = (t.getDay() + 6) % 7;
    cData.rocks[w] = (cData.rocks[w] || []).concat([{ id: 'ins1', title: 'Renew the insurance', day: d, prio: 'med', done: false }, { id: 'inv1', title: 'Send the invoices', day: d, prio: 'med', done: false }]);
    cSave();
    hbData.habits = [{ id: 'cs1', name: 'Cold shower' }, { id: 'wr1', name: 'Write 3 sentences before bed' }]; hbData.completions = {}; S.set('habits', hbData);
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    return { w };
  });
  await p.waitForTimeout(900);
  ok('Today has a Talk button beside the greeting', await p.evaluate(() => { const b = document.querySelector('#today-feed .lk-hello .lk-say'); return !!b && getComputedStyle(b).display !== 'none'; }));
  await p.evaluate(() => Flow.Nav.openCapture ? Flow.Nav.openCapture() : document.querySelector('#flow-tabbar .fn-cap').click()); await p.waitForTimeout(400);
  ok('and Say it is the first thing in the + menu', await p.evaluate(() => (document.querySelector('#fn-capgrid [data-fn-cap]') || {}).getAttribute && document.querySelector('#fn-capgrid [data-fn-cap]').getAttribute('data-fn-cap') === 'say'));
  await p.evaluate(() => { const w = document.getElementById('flow-capture'); if (w) w.classList.remove('on'); });

  const tomorrow = await p.evaluate(() => FlowSay.plusDays(1));
  const todayIso = await p.evaluate(() => FlowSay.plusDays(0));
  let sent = null;
  await p.route('**/api/flow/do', async (rt) => {
    sent = JSON.parse(rt.request().postData() || '{}');
    rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, heard: sent.text, say: 'Six things.', actions: [
      { type: 'rock', title: 'Call the venue', date: tomorrow, time: '10:00', note: '' },
      { type: 'habit', name: 'Read 20 minutes' },
      { type: 'tick', habit: 'cs1', date: todayIso },
      { type: 'journal', text: 'Today felt slow, but I shipped the invoices.', title: '' },
      { type: 'move', rock: 'ins1', date: tomorrow },
      { type: 'done', rock: 'inv1' }
    ] }) });
  });
  await p.click('#today-feed .lk-say'); await p.waitForTimeout(500);
  ok('it opens ready to talk (or to type, where the browser cannot listen)', await p.evaluate(() => document.querySelector('#flow-say.on') && document.activeElement && document.activeElement.id === 'sy-text'));
  const nJ = await p.evaluate(() => Flow.Journal.entries.length);
  await p.fill('#sy-text', 'tomorrow at ten call the venue, start reading twenty minutes a day, tick cold shower, note today felt slow but I shipped the invoices, push the insurance to tomorrow, and I sent the invoices');
  await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  ok('what it sends: the words, the language, and ids + titles to resolve them', sent && /call the venue/.test(sent.text) && sent.lang === 'en' && sent.ctx.today === todayIso && sent.ctx.rocks.some((r) => r.id === 'ins1') && sent.ctx.habits.some((h) => h.id === 'cs1' && h.name === 'Cold shower'), sent && sent.ctx);
  const cards = await p.evaluate(() => [...document.querySelectorAll('#flow-say .sy-card .sy-kind')].map((x) => x.textContent));
  ok('six cards, each saying what it is', cards.length === 6 && /Priority/.test(cards[0]) && cards[1] === 'New habit' && cards[2] === 'Tick habit' && /journal/.test(cards[3]) && cards[4] === 'Move' && cards[5] === 'Mark done', cards);
  ok('nothing has changed yet', await p.evaluate((n) => Flow.Journal.entries.length === n && !hbData.habits.some((h) => h.name === 'Read 20 minutes'), nJ));
  /* The person corrects it: the call is today after all, and the invoices are not done. */
  await p.evaluate(() => { document.querySelector('#flow-say .sy-card [data-say="when"]').click(); });
  await p.evaluate(() => { const c = document.querySelectorAll('#flow-say .sy-card'); c[c.length - 1].querySelector('[data-say="drop"]').click(); });
  await p.fill('#flow-say .sy-card input[data-sy-edit="title"]', 'Call the venue about Saturday');
  ok('a card can be taken out', await p.evaluate(() => document.querySelectorAll('#flow-say .sy-card').length === 5 && /\(5\)/.test(document.querySelector('[data-say="do"]').textContent)));
  await p.click('#flow-say [data-say="do"]'); await p.waitForTimeout(900);
  const after = await p.evaluate(({ w }) => {
    const all = []; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => all.push(Object.assign({ w: k }, r))));
    const call = all.find((r) => r.title === 'Call the venue about Saturday');
    const ins = all.find((r) => r.id === 'ins1'); const inv = all.find((r) => r.id === 'inv1');
    const j = Flow.Journal.entries[Flow.Journal.entries.length - 1];
    return { call: call && { w: call.w, day: call.day, time: call.time }, todayW: w, todayDay: (new Date().getDay() + 6) % 7, insDate: ins && FlowSay.iso(RockActions_dateOf(ins.w, ins.day)), invDone: inv && inv.done,
      habit: hbData.habits.some((h) => h.name === 'Read 20 minutes'), ticked: !!(hbData.completions.cs1 && hbData.completions.cs1[todayStr]), j: j && { body: j.body, tags: j.tags }, sheet: !!document.querySelector('#flow-say.on') };
    function RockActions_dateOf(wid, day) { return window.FlowRockActions ? FlowRockActions.dateOf(wid, day) : null; }
  }, ids);
  ok('the Priority lands on the day chosen on the card, with its time and the edited words', after.call && after.call.w === after.todayW && after.call.day === after.todayDay && after.call.time === '10:00', after);
  ok('the new habit is there, and the existing one ticked today', after.habit && after.ticked, after);
  ok('the note is in the journal, in their words, tagged voice', after.j && /shipped the invoices/.test(after.j.body) && after.j.tags.includes('voice'), after.j);
  ok('the insurance moved to tomorrow', !after.insDate || after.insDate === tomorrow, after.insDate);
  ok('the card that was taken out was not done', after.invDone === false, after.invDone);
  ok('and the sheet is gone', !after.sheet);

  console.log('\n— going somewhere just goes —');
  await p.unroute('**/api/flow/do');
  await p.route('**/api/flow/do', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"say":"Habits.","actions":[{"type":"open","page":"habits"}]}' }));
  await p.evaluate(() => FlowSay.open({ text: 'show my habits' })); await p.waitForTimeout(900);
  ok('"show my habits" opens Habits with nothing to confirm', await p.evaluate(() => !document.querySelector('#flow-say.on') && document.querySelector('.tab.active[data-tab="habits"]')));

  console.log('\n— Wispr Flow / keyboard dictation —');
  const own = await p.evaluate(async () => {
    FlowSay.open(); await new Promise((r) => setTimeout(r, 300));
    const box = document.querySelector('#flow-say [data-say-own]');
    const before = { shown: !!box, checked: box && box.checked };
    const chipless = !document.querySelector('#flow-say [data-label*="time"], #flow-say .flow-x'); const tip = document.querySelector('#flow-say .sy-ex').textContent;
    box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
    FlowSay.close(); FlowSay.open(); await new Promise((r) => setTimeout(r, 300));
    const r = { before, chipless, tip, remembered: document.querySelector('#flow-say [data-say-own]').checked, listening: !!(window.FlowVoice && FlowVoice.listening),
      focused: document.activeElement && document.activeElement.id === 'sy-text', state: document.querySelector('#flow-say .sy-state').textContent };
    document.querySelector('#flow-say [data-say-own]').checked = false; FlowSay.own(false); FlowSay.close();
    return r;
  });
  ok('a switch for dictating with Wispr Flow or the keyboard, off at first', own.before.shown && own.before.checked === false, own.before);
  ok('the sheet has no 🕘 time chip, and its tip says Priorities, not Open loops', own.chipless && /^Priorities, habits/.test(own.tip), own);
  ok('when on, it is remembered and the box waits, focused, without listening', own.remembered && !own.listening && own.focused && /Wispr Flow/.test(own.state), own);

  console.log('\n— Advanced —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); }); await p.waitForTimeout(700);
  ok('no Talk button in Advanced', await p.evaluate(() => { const b = document.querySelector('.lk-say'); return !b || getComputedStyle(b).display === 'none'; }));
  ok('and it does not open there', await p.evaluate(() => { FlowSay.open(); return !document.querySelector('#flow-say.on'); }));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
