/* Business context: import, source map, source-linked answers, fresh-chat
 * verification, requests, and discovery mode.
 *
 * What would make it wrong: an import that keeps nothing or keeps filler; a
 * secret imported; a fact with no record of where it came from; an answer
 * that names a source it did not use, or no source when it used one; a
 * re-import that leaves stale entries current; a "verified" that was not a
 * fresh conversation; a discovery that asks two questions at once, loses an
 * answer, or writes up things the person never said. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const C = require('../flow-channels.js');
const X = require('../flow-context.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 380) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body, headers) => fetch(H + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });

const DOC = `Abko price list — November 2026

Hello and welcome to our pricing page.
The premium plan costs $1,500 a month and includes onboarding.
The starter plan costs $400 a month.
Refunds are possible within 14 days of purchase.
Always reply to a refund request within one business day.
We never offer discounts above 20% without Artur's approval.
Our office is in Istanbul and the support line is open 09:00-18:00.
Thanks for reading!
API key: sk-test-abcdefghijklmnop1234 (internal, do not share)`;

(async () => {
  console.log('\n— shapes —');
  const ex = X.extractPlain(DOC);
  ok('the extractor keeps the sentences with numbers, names and rules, skips greetings and filler, and refuses the secret', ex.length >= 5 && ex.some((e) => /\$1,500/.test(e.fact)) && ex.some((e) => /14 days/.test(e.fact)) && !ex.some((e) => /welcome|thanks for reading/i.test(e.fact)) && !ex.some((e) => /sk-test/.test(e.fact)), ex.map((e) => e.fact));
  ok('rules are typed as rules, each entry keeps the passage it came from', ex.find((e) => /Always reply/.test(e.fact)).kind === 'rule' && ex.find((e) => /never offer/.test(e.fact)).kind === 'rule' && ex.every((e) => e.quote && e.quote.length >= e.fact.length - 2), ex.map((e) => e.kind));
  const srcs = X.sourcesFor([{ id: 'k1', text: 'a', source: 'import:s1', origin: { id: 's1', title: 'Price list', quote: 'q' } }, { id: 'k2', text: 'b', source: 'you' }, { id: 'k3', text: 'c', source: 'import:s1', origin: { id: 's1', title: 'Price list' } }], ['k1', 'k2', 'k3']);
  ok('sources are grouped by origin: an import by its title, what you said as itself; the chat footer names only imports', srcs.length === 2 && srcs.find((s) => s.id === 's1').entries.length === 2 && srcs.find((s) => s.id === 's1').kind === 'import' && X.footer(srcs) === '\n\n— From: Price list' && X.footer([srcs[1]]) === '');
  const trx = X.extractPlain('Merhaba!\nPremium plan ayda 1.500 dolar.\nMüşteriye her zaman bir iş günü içinde cevap verilmeli.\nİndirim asla %20\'yi geçmez.\nTeşekkürler.');
  ok('Turkish: the language is told apart, Turkish rules are typed as rules and the Turkish filler is skipped', X.langOf('Premium plan ayda 1.500 dolar') === 'tr' && X.langOf('The premium plan costs 1500') === 'en' && trx.length === 3 && trx[0].kind === 'fact' && trx[1].kind === 'rule' && trx[2].kind === 'rule' && !trx.some((e) => /Merhaba|Teşekkürler/.test(e.fact)), trx);
  ok('Turkish: ten questions and ten labels of their own; the source line reads Kaynak', X.QUESTIONS_TR.length === 10 && X.SPEC_FIELDS.every((f) => X.SPEC_LABELS_TR[f]) && X.footer([{ id: 's', kind: 'import', title: 'Fiyat listesi' }], 'tr') === '\n\n— Kaynak: Fiyat listesi');
  ok('ten interview questions, each about one thing; the spec has ten fields with labels', X.QUESTIONS.length === 10 && X.QUESTIONS.every((q) => (q.match(/\?/g) || []).length <= 2) && X.SPEC_FIELDS.length === 10 && X.SPEC_FIELDS.every((f) => X.SPEC_LABELS[f]));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); await Flow.Settings.set('timezone', 'UTC'); });
  await p.waitForTimeout(800);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);
  await api('/api/team');
  const tgSecret = C._internals.telegramSecret();
  const sentNow = async () => (await fetch(H + '/api/channels/_sent').then((r) => r.json()).catch(() => null));
  const tg = async (chatId, text) => { const n0 = ((await sentNow()) || {}).n || 0; const r = await post('/api/channels/telegram', { message: { chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'Artur' }, text } }, { 'x-telegram-bot-api-secret-token': tgSecret }); let s = null; for (let i = 0; i < 20; i++) { await wait(300); s = await sentNow(); if (s && s.n > n0) break; } const rec = (s && s.recent) || []; return { status: r.status, text: rec.slice(n0 - (s ? s.n : n0) || -1).map((x) => String((x.body && x.body.text) || '')).join('\n---\n') }; };

  console.log('\n— import ----');
  const bad = await api('/api/team/context/import', { text: 'hi' });
  ok('nothing to import is refused plainly', bad.status === 400 && /nothing to import/i.test(bad.j.error));
  const im = await api('/api/team/context/import', { text: DOC, title: 'Price list, Nov 2026' });
  const S1 = im.j.source;
  ok('a pasted document becomes entries, each with the passage it came from, under one source; the secret is not among them', im.j.ok && im.j.added >= 5 && S1 && S1.title === 'Price list, Nov 2026' && im.j.entries.every((k) => k.origin && k.origin.id === S1.id && k.origin.quote && k.source === 'import:' + S1.id && k.scope === 'shared') && !im.j.entries.some((k) => /sk-test/.test(k.text)), im.j);
  const mem = (await api('/api/team/memory')).j;
  ok('the entries are in Memory as current shared knowledge', mem.items.filter((it) => it.source === 'knowledge' && /\$1,500|14 days|Always reply/.test(it.text) && it.status === 'current').length >= 3, mem.items.filter((it) => it.source === 'knowledge').map((it) => it.text));
  const dup = await api('/api/team/context/import', { text: DOC, title: 'Again' });
  ok('the same text again is refused with the name it already has', dup.status === 409 && /imported before as "Price list, Nov 2026"/.test(dup.j.error));
  const ctx0 = (await api('/api/team/context')).j;
  const s0 = ctx0.sources.find((s) => s.id === S1.id);
  ok('the source map lists it: kind, when, how many current entries, read by every agent on every message', ctx0.ok && s0 && s0.kind === 'paste' && s0.counts.current === im.j.added && s0.readBy.length >= 3 && s0.entries.every((e) => e.quote), s0 && { counts: s0.counts, readBy: s0.readBy });

  console.log('\n— answers that name their source —');
  const ask = await api('/api/team/say', { agent: 'sarah', text: 'How much does the premium plan cost?', lang: 'en' });
  ok('a specialist\'s answer carries the sources it drew on: the price list, with the entry it used', ask.j.say && /1,500/.test(ask.j.say) && Array.isArray(ask.j.sources) && ask.j.sources.some((s) => s.id === S1.id && s.kind === 'import' && s.entries.some((e) => /1,500/.test(e.text))), ask.j);
  const ask2 = await api('/api/team/say', { agent: 'sarah', text: 'Tell me a joke about umbrellas.', lang: 'en' });
  ok('an answer that used no imported entry names none', ask2.j.say && !(ask2.j.sources || []).some((s) => s.kind === 'import'), ask2.j.sources);
  const ctx1 = (await api('/api/team/context')).j;
  ok('the source map counts the replies each source was used in', ctx1.sources.find((s) => s.id === S1.id).counts.usedInReplies >= 1 && ctx1.sources.find((s) => s.id === S1.id).entries.some((e) => e.used >= 1));
  const code = (await api('/api/channels/me/code', {})).j.code; await tg(88001, code);
  const r1 = await tg(88001, '/sarah What does the starter plan cost?');
  ok('in a chat, the reply ends with the source line', /400/.test(r1.text) && /— From: Price list, Nov 2026/.test(r1.text), r1.text);

  console.log('\n— fresh-chat verification —');
  const v1 = await api('/api/team/context/verify', { question: 'What does the premium plan cost?', expect: '$1,500 month', agent: 'bobby' });
  ok('a fresh conversation (no history, nothing saved) answers from what the team is shown; the expected terms are found and the source named', v1.j.ok && v1.j.fresh && v1.j.pass === true && v1.j.agentName === 'Bobby' && v1.j.sources.some((s) => s.id === S1.id) && /1,500/.test(v1.j.answer), v1.j);
  const th = (await api('/api/team/thread?agent=bobby')).j;
  ok('…and Bobby\'s thread did not grow', !th.messages || !th.messages.some((m) => /premium plan cost/i.test(m.text || '')), th);
  const v2 = await api('/api/team/context/verify', { question: 'What does the premium plan cost?', expect: 'thirty thousand', agent: 'bobby' });
  ok('an expectation the answer does not meet is reported as not as expected, not hidden', v2.j.ok && v2.j.pass === false, v2.j.hits);
  ok('verifications are kept on the context view', (await api('/api/team/context')).j.verifications.length === 2);

  console.log('\n— re-import, outdated, restore, remove —');
  const DOC2 = DOC.replace('$1,500 a month', '$1,800 a month').replace('Refunds are possible within 14 days of purchase.\n', '');
  const re = await api('/api/team/context/import', { text: DOC2, title: 'Price list, Nov 2026' });
  const kn = (await api('/api/team/memory?q=premium')).j.items;
  ok('a changed document re-imported: the new price is current, the old one and the dropped sentence are superseded with history, the rest kept', re.j.ok && re.j.added >= 1 && re.j.superseded >= 2 && kn.some((k) => /1,800/.test(k.text) && k.status === 'current') && kn.some((k) => /1,500/.test(k.text) && k.status === 'superseded'), { re: { added: re.j.added, superseded: re.j.superseded, kept: re.j.kept }, kn: kn.map((k) => k.text + ':' + k.status) });
  const ask3 = await api('/api/team/say', { agent: 'sarah', text: 'How much does the premium plan cost now?', lang: 'en' });
  ok('the next answer uses the new figure — no re-indexing, the prompt is rebuilt from the store', /1,800/.test(ask3.j.say) && !/1,500/.test(ask3.j.say), ask3.j.say);
  const srcId = (await api('/api/team/context')).j.sources[0].id;
  ok('one source still, not two: the re-import updated it', (await api('/api/team/context')).j.sources.length === 1 && srcId === S1.id);
  const sup = await api('/api/team/context/source', { op: 'supersede', id: S1.id });
  const v3 = await api('/api/team/context/verify', { question: 'How much does the premium plan cost?', expect: '1,800', agent: 'sarah' });
  ok('marking the source outdated supersedes its entries; a fresh question no longer finds the figure', sup.j.ok && sup.j.superseded >= 4 && v3.j.pass === false && !v3.j.sources.some((s) => s.id === S1.id), { sup: sup.j, v3: { pass: v3.j.pass, answer: v3.j.answer } });
  const rs = await api('/api/team/context/source', { op: 'restore', id: S1.id });
  ok('restore brings them back as current', rs.j.ok && rs.j.restored >= 4 && (await api('/api/team/context')).j.sources[0].counts.current >= 4);
  const im2 = await api('/api/team/context/import', { text: 'Our warehouse is in Gebze. Deliveries leave every Tuesday and Thursday.', title: 'Logistics note' });
  const rm = await api('/api/team/context/source', { op: 'remove', id: im2.j.source.id });
  ok('a source can be removed with its entries', im2.j.ok && rm.j.ok && rm.j.removed === im2.j.added && !(await api('/api/team/memory?q=Gebze')).j.items.some((k) => /Gebze/.test(k.text)));

  console.log('\n— requests and feedback —');
  const rq = await api('/api/team/context/request', { text: 'I want the weekly numbers every Monday at 9', kind: 'request' });
  const r2 = await tg(88001, '/feedback the refund replies are too long');
  const ctx2 = (await api('/api/team/context')).j;
  ok('requests and feedback are noted from the app and from a chat, with where they came from', rq.j.ok && /Noted — thank you/.test(r2.text) && ctx2.requests.length === 2 && ctx2.requests.some((x) => x.kind === 'feedback' && x.via === 'telegram') && ctx2.requests.some((x) => x.kind === 'request' && /Monday/.test(x.text)), ctx2.requests);
  await api('/api/team/context/request', { op: 'done', id: rq.j.item.id });
  ok('a request can be marked done and reopened', (await api('/api/team/context')).j.requests.find((x) => x.id === rq.j.item.id).status === 'done' && (await api('/api/team/context/request', { op: 'reopen', id: rq.j.item.id })).j.item.status === 'open');

  console.log('\n— discovery mode —');
  const d0 = await api('/api/team/discovery', { op: 'start', mode: 'ask', topic: 'answering refund emails' });
  ok('"Ask me questions" starts with one question, says how many, and asks about the finished result first', d0.j.ok && d0.j.n === 1 && d0.j.of === 5 && /First:/.test(d0.j.say) && /finished result/.test(d0.j.question) && (d0.j.question.match(/\?/g) || []).length <= 2, d0.j);
  const A = ['A polite reply to the customer with the refund amount and the date, sent from support', 'A refund email arriving in the inbox', 'The order number and amount from the email, our refund policy from the price list', 'Looking up the order is the same every time; deciding on a goodwill voucher needs judgment', 'Never promise a date we cannot keep; every reply needs my yes before it goes'];
  let last = null; for (const a of A) last = await api('/api/team/discovery', { op: 'answer', id: d0.j.discovery.id, text: a });
  ok('five answers later it writes the spec up from what was said — goal, trigger, inputs, steps, guardrails — and invents nothing', last.j.ok && last.j.done && last.j.spec.goal === A[0] && last.j.spec.trigger === A[1] && last.j.spec.inputs === A[2] && last.j.spec.steps === A[3] && last.j.spec.guardrails === A[4] && !last.j.spec.people && /Workflow: answering refund emails/.test(last.j.text) && /turn it into a skill/.test(last.j.say), last.j.spec);
  const mid = await api('/api/team/discovery', { op: 'start', mode: 'ask', topic: 'x' }); const m1 = await api('/api/team/discovery', { op: 'answer', id: mid.j.discovery.id, text: 'the first answer' });
  ok('each answer is kept against its question and the next question is different', m1.j.ok && !m1.j.done && m1.j.n === 2 && m1.j.discovery.qa[0].a === 'the first answer' && m1.j.discovery.qa[1].q !== m1.j.discovery.qa[0].q, m1.j.discovery.qa);
  const ab = await api('/api/team/discovery', { op: 'abandon', id: mid.j.discovery.id });
  ok('a discovery can be dropped; nothing is written up', ab.j.ok && ab.j.discovery.status === 'abandoned');
  const sk = await api('/api/team/discovery', { op: 'skill', id: d0.j.discovery.id });
  const skills = (await api('/api/team/skills')).j.items;
  ok('"turn it into a skill" makes a skill from the spec, version 1, opened for review', sk.j.ok && sk.j.skill && sk.j.skill.version === 1 && skills.some((s) => s.id === sk.j.skill.id) && (await api('/api/team/discovery')).j.list.find((d) => d.id === d0.j.discovery.id).skill === sk.j.skill.id, sk.j);
  await tg(88001, '/jarvis');
  const r3 = await tg(88001, '/interview the weekly ad report');
  const r4 = await tg(88001, 'A one-page report with spend, leads and cost per lead');
  const r5 = await tg(88001, 'Every Monday morning');
  const r6 = await tg(88001, 'done');
  ok('from a chat: /interview asks, plain replies are taken as answers, "done" writes it up', /keep asking until I have the whole picture/.test(r3.text) && /What starts it/.test(r4.text) && /information does it need/.test(r5.text) && /Workflow: the weekly ad report/.test(r6.text) && /Every Monday morning/.test(r6.text), { r3: r3.text.slice(0, 80), r6: r6.text.slice(0, 200) });
  const r7 = await tg(88001, 'turn it into a skill');
  ok('…and "turn it into a skill" from the chat makes the skill', /is a skill now, version 1/.test(r7.text), r7.text);
  const t1 = await tg(88001, '/sor haftalık reklam raporu');
  const t2 = await tg(88001, 'Harcama, lead ve lead başına maliyet içeren tek sayfalık bir rapor');
  const t3 = await tg(88001, 'bitti');
  ok('Turkish: /sor asks in Turkish, a Turkish reply is taken as the answer, "bitti" writes the spec up with Turkish labels', /Beş soru, sonra yazıya dökerim/.test(t1.text) && /İlk soru:/.test(t1.text) && /\?/.test(t2.text) && !/What starts it/.test(t2.text) && /İş akışı: haftalık reklam raporu/.test(t3.text) && /Amaç/.test(t3.text) && /Harcama, lead/.test(t3.text), { t1: t1.text, t2: t2.text, t3: t3.text });
  const t4 = await tg(88001, 'beceriye dönüştür');
  ok('…and "beceriye dönüştür" makes the skill, said in Turkish', /artık bir beceri, sürüm 1/.test(t4.text), t4.text);

  console.log('\n— the workspace —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1500);
  ok('J.A.R.V.I.S.\'s view has the Discovery panel with both ways to start', await p.evaluate(() => !!document.querySelector('#flow-hud [data-k="disc"] [data-hud="discstart"][data-mode="ask"]') && !!document.querySelector('#flow-hud [data-k="disc"] [data-hud="discstart"][data-mode="relentless"]')));
  await p.click('#flow-hud .hud-ag[data-hud="memory"]'); await p.waitForTimeout(1800);
  const ws = await p.evaluate(() => ({ imp: !!document.querySelector('#flow-hud [data-k="ctximport"] [data-hud="ctximportx"]'), map: (document.querySelector('#flow-hud [data-k="ctxmap"] .hud-ph') || {}).textContent, rows: document.querySelectorAll('#flow-hud [data-k="ctxmap"] .hud-mi').length, chk: !!document.querySelector('#flow-hud form[data-team="ctxverify"]'), req: document.querySelectorAll('#flow-hud [data-k="ctxreq"] .hud-r').length }));
  ok('Memory shows Import, the source map with the price list, the fresh-chat check and the requests', ws.imp && /1 source/.test(ws.map) && ws.rows === 1 && ws.chk && ws.req === 2, ws);
  await p.click('#flow-hud [data-k="ctxmap"] [data-hud="ctxopen"]'); await p.waitForTimeout(400);
  ok('opening the source lists its entries with the passages they came from, who reads them, and Mark outdated / Re-import / Remove', await p.evaluate(() => { const c = document.querySelector('#flow-hud [data-k="ctxmap"] .hud-mi.open'); return !!c && /Read by:/.test(c.innerText) && c.querySelectorAll('.hud-k').length >= 4 && /“/.test(c.innerText) && !!c.querySelector('[data-hud="ctxsrc"][data-op="supersede"]') && !!c.querySelector('[data-hud="ctxsrc"][data-op="reimport"]'); }));
  await p.click('#flow-hud [data-hud="ctximportx"]'); await p.waitForTimeout(300);
  await p.fill('#flow-hud form[data-team="ctximport"] input[name="title"]', 'Team hours');
  await p.fill('#flow-hud form[data-team="ctximport"] textarea[name="text"]', 'Support is staffed Monday to Friday from 09:00 to 18:00 Istanbul time. Sarah covers the morning shift and Bobby covers the afternoon.');
  await p.click('#flow-hud form[data-team="ctximport"] button[type="submit"]'); await p.waitForTimeout(1500);
  ok('importing from the workspace adds a second source and says what it did', await p.evaluate(() => document.querySelectorAll('#flow-hud [data-k="ctxmap"] .hud-mi').length === 2 && /"Team hours": \d+ new entr/.test(document.querySelector('#flow-hud [data-k="ctximport"]').innerText)));
  await p.fill('#flow-hud form[data-team="ctxverify"] input[name="question"]', 'How much does the premium plan cost?');
  await p.fill('#flow-hud form[data-team="ctxverify"] input[name="expect"]', '1,800');
  await p.click('#flow-hud form[data-team="ctxverify"] button[type="submit"]'); await p.waitForTimeout(1500);
  ok('the fresh-chat check shows the answer, the verdict and what it drew on', await p.evaluate(() => { const t = document.querySelector('#flow-hud [data-k="ctxverify"]').innerText; return /as expected/.test(t) && /Drew on:/.test(t) && /Price list/.test(t); }));
  await p.click('#flow-hud .hud-ag[data-ag="sarah"]'); await p.waitForTimeout(500);
  await p.fill('#sy-text', 'What does the starter plan cost?'); await p.click('[data-say="send"]'); await p.waitForTimeout(2500);
  ok('in the console, a specialist\'s reply shows the source it drew on', await p.evaluate(() => { const b = [...document.querySelectorAll('#flow-say .sy-b.a')].pop(); return !!b && /400/.test(b.textContent) && /From: Price list/.test(b.textContent); }));
  await p.click('#flow-hud .hud-ag[data-ag="jarvis"]').catch(() => {}); await p.evaluate(() => { FlowSay.agent = null; }); await p.waitForTimeout(300);
  await p.fill('#sy-text', 'Ask me questions about onboarding new clients'); await p.click('[data-say="send"]'); await p.waitForTimeout(2000);
  const q1 = await p.evaluate(() => (((FlowSay.history || []).slice(-1)[0] || {}).text || ''));
  ok('"Ask me questions about …" in the console starts a discovery and asks the first question', /First:/.test(q1) && /finished result/.test(q1), q1);
  await p.fill('#sy-text', 'A welcome pack and a kickoff call booked within two days'); await p.click('[data-say="send"]'); await p.waitForTimeout(2000);
  const q2 = await p.evaluate(() => (((FlowSay.history || []).slice(-1)[0] || {}).text || ''));
  ok('…the next message is taken as the answer and the second question comes back', /What starts it/.test(q2) && !/First:/.test(q2), q2);
  ok('the Discovery panel shows it running with the answers so far', await p.evaluate(() => { const t = (document.querySelector('#flow-hud [data-k="disc"]') || {}).innerText || ''; return /onboarding new clients/.test(t) && /1 answered/.test(t) && !!document.querySelector('#flow-hud [data-hud="discfinish"]'); }));

  console.log('\n— spoken Turkish names —');
  await p.evaluate(() => { const i = document.querySelector('[data-say-pref="asstNames"]'); i.value = 'Oğuz, Abko, Gebze'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  const fx = await p.evaluate(() => [FlowTeam.fixNames('call Oguz about the Apko order from Gebse'), FlowTeam.fixNames('what about the weather today'), FlowTeam.fixNames('Sarah, send the price list to Bobby'), FlowSpeech.pref('asstNames')]);
  ok('the names list is kept; what the microphone bent is put right against it, ordinary words and the team\'s own names are left alone', fx[0] === 'call Oğuz about the Abko order from Gebze' && fx[1] === 'what about the weather today' && fx[2] === 'Sarah, send the price list to Bobby' && fx[3] === 'Oğuz, Abko, Gebze', fx);
  ok('the names field sits in Voice and manners with its note', await p.evaluate(() => !!document.querySelector('#flow-say .sy-names input[data-say-pref="asstNames"]') && /Oz/.test((document.querySelector('#flow-say .sy-sub') || {}).textContent || '')));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
