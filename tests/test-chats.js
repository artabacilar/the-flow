/* Conversations with J.A.R.V.I.S. that are kept, and a J.A.R.V.I.S. who acts.
 *
 * What would make it wrong: a turn that is lost on reload or on another
 * device; a chat written into the namespace the app hydrates from; a chat
 * list in the wrong order, with a made-up title, or that grows without end;
 * a deleted chat that comes back; what he is told to do not done until a
 * button is pressed; a list of errands not grouped by person; an unclear
 * request guessed at instead of asked; what is said not appearing in the
 * chat as it is said. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const X = require('../flow-extras.js')._internals;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  console.log('\n— the store —');
  const mem = {};
  const st = { get: async (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : null), set: async (k, v) => { if (v == null) delete mem[k]; else mem[k] = JSON.parse(JSON.stringify(v)); } };
  const call = async (method, url, body) => {
    const out = {};
    const ctx = { chats: st, json: (r, s, b) => { out.s = s; out.b = b; }, readBody: async () => JSON.stringify(body || {}) };
    const hit = await X.chats.handle('/api/flow/chats', { method, url }, {}, ctx);
    return Object.assign(out, { hit });
  };
  let r = await call('POST', '/api/flow/chats', { op: 'append', messages: [{ role: 'user', text: 'I need to call my father about selling the iPhone' }, { role: 'assistant', text: 'Done.', did: ['Added: Call Dad — today'] }] });
  ok('a first turn starts a chat, titled from what he said', r.s === 200 && /^c[a-z0-9]+$/.test(r.b.id) && /call my father about selling/.test(r.b.title), r.b);
  const id1 = r.b.id;
  r = await call('POST', '/api/flow/chats', { op: 'append', id: id1, messages: [{ role: 'user', text: 'and Burak owes me the pricing list' }, { role: 'assistant', text: '' }, { role: 'robot', text: 'x' }] });
  ok('later turns join the same chat; empty or unknown messages are not kept', r.b.id === id1 && r.b.n === 3, r.b);
  r = await call('POST', '/api/flow/chats', { op: 'append', messages: [{ role: 'user', text: 'What is left today?' }] });
  const id2 = r.b.id;
  r = await call('GET', '/api/flow/chats');
  ok('the list is newest first, with titles and counts', r.b.chats.length === 2 && r.b.chats[0].id === id2 && r.b.chats[1].id === id1 && r.b.chats[1].n === 3, r.b.chats);
  r = await call('GET', '/api/flow/chats?id=' + id1);
  ok('a chat comes back whole, with what he did', r.b.chat.messages.length === 3 && r.b.chat.messages[1].did[0] === 'Added: Call Dad — today', r.b.chat);
  await call('POST', '/api/flow/chats', { op: 'rename', id: id1, title: 'Dad, Revelle and Burak' });
  await call('POST', '/api/flow/chats', { op: 'append', id: id1, messages: [{ role: 'user', text: 'something else entirely' }] });
  r = await call('GET', '/api/flow/chats');
  ok('a name he gave stays, even as the chat goes on (and it moves to the top)', r.b.chats[0].id === id1 && r.b.chats[0].title === 'Dad, Revelle and Burak', r.b.chats[0]);
  await call('POST', '/api/flow/chats', { op: 'delete', id: id2 });
  r = await call('GET', '/api/flow/chats?id=' + id2);
  const l2 = await call('GET', '/api/flow/chats');
  ok('a deleted chat is gone from the list and the store', r.s === 404 && l2.b.chats.length === 1 && !mem['c:' + id2]);
  ok('nothing to keep is refused, and other paths are not taken', (await call('POST', '/api/flow/chats', { op: 'append', messages: [] })).s === 400 && (await X.chats.handle('/api/flow/chatz', { method: 'GET' }, {}, {})) === false);
  ok('a long first message makes a short title', X.chats.title([{ role: 'user', text: 'word '.repeat(40) }]).length <= 61);
  const auth = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-auth.js'), 'utf8');
  ok('kept outside the namespace the app hydrates from', /'__chat:' \+ me\.id/.test(auth));

  console.log('\n— he acts, and connects the dots —');
  const S = X.say.DO_SYSTEM;
  ok('he is told his actions are carried out at once', /carries your actions out at once/.test(S) && !/You never act yourself/.test(S));
  ok('telling him what you have to do IS the request', /IS the request/.test(S));
  ok('two things for one person are one call', /Two things to raise with the same person in one call are ONE Priority/.test(S));
  ok('waiting on someone, and a meeting to organise, become their own Priorities, linked', /Waiting on someone is a follow-up Priority/.test(S) && /Link what depends on what/.test(S));
  ok('he asks only when it matters, and then does nothing', /Ask only when it matters/.test(S) && /"ask": true/.test(S));
  ok('"say" says what was done, not what will be', /in the past tense/.test(S));
  const q = X.say.parseDo('{"say":"Which day?","ask":true,"actions":[]}', {});
  const q2 = X.say.parseDo('{"say":"Done.","ask":true,"actions":[{"type":"rock","title":"Call Dad","date":"2026-11-09"}]}', { today: '2026-11-09' });
  ok('a question comes back as a question; one with actions is not a question', q.ask === true && q2.ask === false && q2.actions.length === 1, { q, q2 });
  ok('the conversation he sees is twice as long as before', X.say.doHistory({ history: Array.from({ length: 30 }, (_, i) => ({ role: 'user', text: 't' + i })) }).length === 16);

  console.log('\n— in the app —');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    const t = new Date(), w = weekId(t);
    cData.rocks = {}; cData.rocks[w] = []; cSave();
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    await Flow.Settings.set('asstWake', false); await Flow.Settings.set('asstVoice', 'off');
  });
  const todayIso = await p.evaluate(() => FlowSay.plusDays(0));
  let sent = null;
  await p.route('**/api/flow/do', (rt) => {
    sent = JSON.parse(rt.request().postData() || '{}');
    rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, say: 'Done — one call to your father about both, a chase for Burak, and the meeting to set up.', actions: [
      { type: 'rock', title: 'Call Dad — selling the iPhone, and Revelle AI as a reseller', date: todayIso, note: '' },
      { type: 'rock', title: 'Chase Burak for the legal documents and the pricing list', date: todayIso, note: 'Needed before the meeting' },
      { type: 'rock', title: 'Set up a meeting with Dad and Burak about Revelle AI', date: todayIso, note: 'Once Burak’s documents are in' },
      { type: 'remember', fact: 'Burak sends the legal documents and pricing for Revelle AI' }
    ] }) });
  });
  await p.evaluate(() => FlowSay.open({ idle: true })); await p.waitForTimeout(500);
  await p.evaluate(() => FlowSay.liveBubble('I need to call my father'));
  const live = await p.evaluate(() => (document.querySelector('#flow-say .sy-log .sy-b.u.live') || {}).textContent);
  ok('while he speaks, his words appear in the chat as his message', live === 'I need to call my father', live);
  await p.fill('#sy-text', 'I need to call my father about selling the iPhone. I also need to call him about selling Revelle AI as a reseller. I am waiting for legal documents and a pricing list from Burak, and to organise a meeting with all of us.');
  await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const done = await p.evaluate(() => {
    const all = []; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => all.push(r.title)));
    return { rocks: all, cards: document.querySelectorAll('#flow-say .sy-card').length, did: [...document.querySelectorAll('#flow-say .sy-did li')].map((x) => x.textContent),
      log: [...document.querySelectorAll('#flow-say .sy-log .sy-b')].map((x) => x.className.replace('sy-b ', '')), mem: (Flow.Settings.get('asstMemory') || []).map((m) => m.text) };
  });
  ok('said like that, it is done — three Priorities and a fact, no "Do it"', done.rocks.length === 3 && done.cards === 0 && done.mem.some((m) => /Burak/.test(m)), done);
  ok('the chat shows his message, the answer, and what was done', done.log.length === 2 && done.log[0] === 'u' && done.did.length === 4, done);
  await p.waitForTimeout(800);
  const listed = await p.evaluate(async () => (await (await fetch('/api/flow/chats', { credentials: 'same-origin' })).json()).chats);
  ok('the turn is on the server at once, titled from what he said', listed.length === 1 && /call my father/.test(listed[0].title) && listed[0].n === 2, listed);

  console.log('\n— it does not go away —');
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(4500);
  await p.evaluate(() => { try { localStorage.removeItem('flowChatId'); } catch (e) {} });
  await p.evaluate(() => { try { localStorage.setItem('flowChatId', arguments[0]); } catch (e) {} });
  await p.evaluate((id) => { localStorage.setItem('flowChatId', id); FlowSay.chatId = null; FlowSay.open({ idle: true }); }, listed[0].id); await p.waitForTimeout(1200);
  const back = await p.evaluate(() => ({ n: FlowSay.history.length, log: document.querySelectorAll('#flow-say .sy-log .sy-b').length, first: (FlowSay.history[0] || {}).text, did: (FlowSay.history[1] || {}).did }));
  ok('after a reload the conversation is still there', back.n === 2 && back.log === 2 && /call my father/.test(back.first) && back.did && back.did.length === 4, back);
  await p.click('#flow-say [data-say="newchat"]'); await p.waitForTimeout(300);
  ok('New chat starts empty', await p.evaluate(() => FlowSay.history.length === 0 && !FlowSay.chatId && !document.querySelectorAll('#flow-say .sy-log .sy-b').length));
  await p.unroute('**/api/flow/do');
  await p.route('**/api/flow/do', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, say: 'Three things are open today.', actions: [] }) }));
  await p.fill('#sy-text', 'what is left today?'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  await p.click('#flow-say [data-say="chats"]'); await p.waitForTimeout(800);
  const list = await p.evaluate(() => [...document.querySelectorAll('#flow-say .sy-chl li')].map((li) => li.querySelector('b').textContent + (li.classList.contains('on') ? ' *' : '')));
  ok('Chats lists both, newest first, the open one marked', list.length === 2 && /what is left today\? \*$/.test(list[0]) && /call my father/.test(list[1]), list);
  await p.evaluate(() => document.querySelectorAll('#flow-say .sy-chl [data-say="chatopen"]')[1].click()); await p.waitForTimeout(900);
  const opened = await p.evaluate(() => ({ first: (FlowSay.history[0] || {}).text, hidden: document.querySelector('#flow-say .sy-chats').hidden }));
  ok('an older chat opens where it was left', /call my father/.test(opened.first) && opened.hidden, opened);
  ok('and carries on from there: the next request goes with that conversation', await (async () => { await p.fill('#sy-text', 'and remind me tomorrow too'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200); return true; })());
  const sent2 = await p.evaluate(async () => (await (await fetch('/api/flow/chats?id=' + FlowSay.chatId, { credentials: 'same-origin' })).json()).chat.messages.length);
  ok('the new turn joined that chat', sent2 === 4, sent2);

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
