/* Stage 4 — what J.A.R.V.I.S. suggests, the morning briefing, the month's
 * cost and its limit, the honest list of connections, the web reader and
 * the browser with its human handoff, and the one tool that really acts:
 * an approved email.
 *
 * What would make it wrong: a suggestion not anchored in the person's own
 * record, or one offered again after "not this"; a briefing at the server's
 * hour instead of theirs, or sent twice in a day; a cost that is claimed
 * exact; a limit that does not stop the spending; "working" on something
 * that is not; an agent reading a private address; a browser typing a
 * password; an email sent twice, sent without a yes, or sent for a
 * read-only agent; a failed send that pretends to have gone. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const T = require('../flow-team.js');
const W = T._work;
const B = require('../flow-browser.js');
const I = require('../flow-channels.js')._internals;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body, headers) => fetch(H + path, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, text: await r.text() }));

(async () => {
  console.log('\n— shapes —');
  const pr = W.parseReply('{"say":"","read":["https://example.com/a","ftp://no","https://example.com/b","https://example.com/c","https://example.com/d"]}');
  ok('an agent may ask for up to three public pages before answering', pr.read.length === 3 && pr.read.every((u) => /^https:/.test(u)) && pr.say === '', pr);
  const ps = W.parseStep('{"result":"","browse":{"url":"https://example.com","goal":"compare"},"read":["http://x.test/p"]}');
  ok('a step may ask to read or to browse (a goal, a public address)', ps.browse && ps.browse.url === 'https://example.com' && ps.browse.goal === 'compare' && ps.read.length === 1 && !ps.result, ps);
  ok('a browse without a web address is dropped', W.parseStep('{"result":"x","browse":{"url":"javascript:alert(1)"}}').browse === null);
  ok('the tools text tells the truth: web reading yes, nothing invented, email only after a yes', /read public web pages/.test(W.toolsText()) && /Never claim something was sent/.test(W.toolsText()) && /after the person approves/.test(W.toolsText()));
  const c1 = W.costOf('claude-sonnet-4-5', { in: 1000000, out: 1000000 }), c2 = W.costOf('gpt-5-mini', { in: 2000000, out: 0 }), c3 = W.costOf('some-new-model', { in: 10, out: 10 });
  ok('cost is estimated from list prices per million tokens; an unknown model is not priced', c1 === 18 && c2 === 0.5 && c3 === null, [c1, c2, c3]);
  const sg = W.parseSuggest('{"items":[{"title":"Dubai trip command centre","why":"Your notes mention Dubai","brief":"Build it","agent":"sarah"},{"title":"","brief":"x"},{"title":"Ghost","brief":"y","agent":"nobody"}]}', [{ id: 'jarvis' }, { id: 'sarah' }]);
  ok('suggestions keep a title, a why and a brief; an unknown agent falls back to J.A.R.V.I.S. planning', sg.length === 2 && sg[0].agent === 'sarah' && sg[1].agent === '' && sg[0].status === 'open', sg);
  ok('the suggestion prompt anchors in their data and forbids the generic', /anchored in the data/.test(W.SUGGEST_SYSTEM('A', [], [], [], [], 'snap', 'en')) && /Nothing generic/.test(W.SUGGEST_SYSTEM('A', [], [], [], [], 'snap', 'en')) && /do not offer again/.test(W.SUGGEST_SYSTEM('A', [], [], [], ['x'], 'snap', 'en')));

  console.log('\n— the web reader —');
  ok('private and local addresses are refused (the server\'s network is not the agent\'s)', !B.allowed('http://10.0.0.1/') && !B.allowed('http://192.168.1.1/') && !B.allowed('http://169.254.169.254/latest') && !B.allowed('file:///etc/passwd') && !B.allowed('http://[::1]/') && B.allowed('https://example.com/x'));
  const ht = B.htmlToText('<html><head><title>T &amp; U</title><style>p{}</style><script>var x=1</script></head><body><h1>Hi</h1><p>One</p><p>Two &gt; three</p></body></html>');
  ok('scripts and styles are stripped and the text keeps its lines', ht.title === 'T & U' && ht.text === 'Hi\nOne\nTwo > three', ht);
  const rd = await B.read(H + '/_page/plain');
  ok('a page is read as text with its title', rd.title === 'Venue prices' && /Hall A costs 500 EUR/.test(rd.text) && !/color:red|document\.title/.test(rd.text), rd);
  const av = B.available();
  ok('this host says which mode it is in, honestly', (av.mode === 'browser' && av.status === 'working') || (av.mode === 'reader' && av.status === 'awaiting' && av.env[0] === 'BROWSER_WS_ENDPOINT'), av);

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => {
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false);
  });
  await p.waitForTimeout(1200);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);
  const until = async (fn, ms) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(400); } return null; };
  const sentNow = async () => (await fetch(H + '/api/channels/_sent').then((r) => r.json()).catch(() => null));

  console.log('\n— what he suggests —');
  /* the record: a note about Dubai */
  await api('/api/set', { key: 'flow:notes', value: { travel: { id: 'travel', title: 'Travel', brackets: [{ id: 'b1', title: 'Dubai', content: 'Dubai apartment booking: Airbnb confirmed 12–19 Dec; the other apartment was cancelled.', collapsed: false, children: [] }], updated: null } } });
  const s0 = await api('/api/team/suggest');
  ok('J.A.R.V.I.S. suggests work from the person\'s own record — the Dubai trip in the notes becomes a command centre', s0.status === 200 && s0.j.items.length === 3 && s0.j.items.some((it) => /Dubai/.test(it.title) && /notes mention/.test(it.why)), s0.j);
  const s1 = await api('/api/team/suggest');
  ok('asked again the same day, the same suggestions come back (no second model call)', JSON.stringify(s1.j.items.map((x) => x.id)) === JSON.stringify(s0.j.items.map((x) => x.id)));
  const spend = s0.j.items.find((it) => /spend/i.test(it.title));
  const dr = await api('/api/team/suggest', { op: 'dismiss', id: spend.id });
  const s2 = await api('/api/team/suggest?fresh=1');
  ok('"not this" is remembered: a dismissed suggestion is not offered again, even when asked for fresh ideas', dr.j.ok && !s2.j.items.some((it) => /spend/i.test(it.title)), s2.j.items.map((x) => x.title));
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1800);
  const sp = await p.evaluate(() => ({ there: !!document.querySelector('#flow-hud [data-k="suggest"]'), titles: [...document.querySelectorAll('#flow-hud .hud-sg b')].map((x) => x.textContent), start: !!document.querySelector('#flow-hud [data-hud="sugstart"]'), not: !!document.querySelector('#flow-hud [data-hud="sugdrop"]'), more: !!document.querySelector('#flow-hud [data-hud="sugmore"]') }));
  ok('his room shows "J.A.R.V.I.S. suggests" with Start, Not this, and Other ideas', sp.there && sp.titles.some((t) => /Dubai/.test(t)) && sp.start && sp.not && sp.more, sp);
  const dubai = s2.j.items.find((it) => /Dubai/.test(it.title));
  await p.click('#flow-hud [data-hud="sugstart"][data-id="' + dubai.id + '"]'); await p.waitForTimeout(1200);
  const s3 = await api('/api/team/suggest');
  const started = s3.j.items.find((it) => it.id === dubai.id);
  ok('Start hands it to the team as a real task and the suggestion shows as started', started && started.status === 'started' && started.task, started);
  const t1 = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === started.task); return t && /^(done|awaiting_approval)$/.test(t.status) ? t : null; }, 20000);
  ok('…and the team finishes it in the background', !!t1 && t1.by === 'jarvis', t1 && t1.status);
  const again = await api('/api/team/suggest', { op: 'start', id: dubai.id });
  ok('starting it twice does not make a second task', again.j.already === true && again.j.item.task === started.task, again.j);

  console.log('\n— the morning briefing, in their own clock —');
  /* link Telegram so the briefing has somewhere to land */
  const code = (await api('/api/channels/me/code', {})).j.code;
  const tgSecret = I.telegramSecret();
  const tg = (chatId, text) => post('/api/channels/telegram', { message: { chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'Artur' }, text } }, { 'x-telegram-bot-api-secret-token': tgSecret });
  await tg(4242, code); await wait(900);
  await api('/api/set', { key: 'flow:settings', value: { timezone: 'Europe/Istanbul', newLook: true, asstVoice: 'off', asstWake: false } });
  const br0 = await api('/api/team/brief');
  ok('the briefing is on by default at 08:00 in the person\'s own timezone', br0.j.on === true && br0.j.at === '08:00' && br0.j.tz === 'Europe/Istanbul', br0.j);
  /* 08:02 in Istanbul is 05:02 UTC */
  const at0802 = new Date('2026-11-09T05:02:00Z');
  const tick = async (iso) => (await api('/api/team/_tick?at=' + encodeURIComponent(iso))).j.out;
  const mail = async () => (await api('/api/team/_mail')).j;
  const n0 = (await sentNow()).n;
  const tk1 = await tick('2026-11-09T04:30:00Z');
  ok('at 07:30 their time nothing is sent yet', tk1.some((x) => x.skipped === 'not yet') && (await sentNow()).n === n0, tk1);
  const tk2 = await tick(at0802.toISOString());
  await wait(800);
  const s4 = await sentNow();
  ok('at 08:02 their time the briefing goes to the linked channel: the day, the team, and what they could take off the plate', tk2.some((x) => x.sent) && s4.n > n0 && /Good morning, Artur/.test(s4.last.body.text) && /The team/.test(s4.last.body.text) && /take off your plate/.test(s4.last.body.text) && /\/start 1/.test(s4.last.body.text), s4 && s4.last && s4.last.body && s4.last.body.text.slice(0, 200));
  const tk3 = await tick('2026-11-09T05:04:00Z');
  ok('two minutes later it is not sent again', tk3.some((x) => x.skipped === 'sent') && (await sentNow()).n === s4.n, tk3);
  const brs = await api('/api/team/brief', { at: '07:15', on: false });
  ok('the hour and the switch are theirs to set', brs.j.on === false && brs.j.at === '07:15', brs.j);
  const tk4 = await tick('2026-11-10T04:16:00Z');
  ok('switched off, nothing is sent', tk4.some((x) => x.skipped === 'off'), tk4);
  await api('/api/team/brief', { on: true });
  const now = await api('/api/team/brief/now', {});
  ok('"Send it now" delivers it on request, and /briefing in a chat reads the same', now.j.ok && /Good morning/.test(now.j.text) && (await sentNow()).n === s4.n + 1);
  await tg(4242, '/briefing'); await wait(700);
  ok('…', /Good morning, Artur/.test((await sentNow()).last.body.text));
  await tg(4242, '/ideas'); await wait(700);
  const ideas = (await sentNow()).last.body.text;
  ok('/ideas lists the open suggestions from a text message', /take off your plate/.test(ideas) && /\/start 1/.test(ideas), ideas);
  const bp = await p.evaluate(async () => { await FlowTeam.load(true); FlowHud.paint(); return { there: !!document.querySelector('#flow-hud [data-k="brief"]'), on: !!document.querySelector('#flow-hud [data-team-brief="on"]'), time: (document.querySelector('#flow-hud [data-team-brief="at"]') || {}).value, now: !!document.querySelector('#flow-hud [data-hud="briefnow"]') }; });
  ok('his room has the Morning briefing panel: the switch, the hour, Send it now', bp.there && bp.on && bp.time === '07:15' && bp.now, bp);

  console.log('\n— connections, counted truthfully —');
  const cn = await api('/api/team/connectors');
  const by = Object.fromEntries(cn.j.connectors.map((x) => [x.id, x.status]));
  ok('the Flow and the web reader work; email works (a key is present here); unknown apps are "not built"', by.flow === 'working' && by.web === 'working' && by.email === 'working' && by['wish:gmail'] === 'not_built' && by['wish:quickbooks'] === 'not_built', by);
  ok('channels and models are in the same list with their real status', by['channel:telegram'] === 'working' && by['channel:teams'] === 'not_built' && by['model:anthropic'] === 'working' && by['model:xai'] === 'awaiting', by);
  ok('the counts add up — a connectable MCP server is "available", never "working" — and nobody says "1000+ apps"', cn.j.counts.working + cn.j.counts.ready + cn.j.counts.awaiting + cn.j.counts.not_built + (cn.j.counts.available || 0) === cn.j.connectors.length && cn.j.connectors.filter((x) => x.status === 'available').every((x) => /Available as a plugin/.test(x.note)) && !JSON.stringify(cn.j).includes('1000'), cn.j.counts);
  const cp = await p.evaluate(() => { FlowHud.paint(); const h = document.querySelector('#flow-hud [data-k="conn"] h3, #flow-hud [data-k="conn"] .hud-ph, #flow-hud [data-k="conn"]'); return { there: !!document.querySelector('#flow-hud [data-k="conn"]'), text: h ? h.textContent : '', all: !!document.querySelector('#flow-hud [data-hud="connall"]') }; });
  ok('his room shows Connections with the honest count line', cp.there && /working/.test(cp.text) && /not built yet/.test(cp.text) && cp.all, cp);

  console.log('\n— an approved email really goes, once —');
  const t2 = await api('/api/team/task', { agent: 'sarah', title: 'Refund note', brief: 'Draft an email to the customer about the refund', lang: 'en' });
  const t2d = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t2.j.task.id); return t && t.status === 'awaiting_approval' ? t : null; }, 20000);
  ok('Sarah\'s email proposal waits for a yes', !!t2d, t2d && t2d.status);
  let ap = (await api('/api/team/tasks')).j.approvals.find((x) => x.task === t2.j.task.id && x.status === 'pending');
  const nMail = (await mail()).n;
  await p.evaluate(async () => { await FlowTeam.load(true); FlowHud.paint(); }); await p.waitForTimeout(600);
  const apUi = await p.evaluate(() => ({ btn: (document.querySelector('#flow-hud [data-hud="approve"]') || {}).textContent, line: (document.querySelector('#flow-hud .hud-ap .hud-sub:not(.hud-apfrom)') || {}).textContent }));
  ok('the card says it will really be sent, once, in Sarah\'s name, with replies to you', /Approve and send/.test(apUi.btn || '') && /sends it now/.test(apUi.line || '') && /replies to you/.test(apUi.line || ''), apUi);
  const ed = await p.evaluate((id) => ({ to: (document.querySelector('#flow-hud [data-ap-to="' + id + '"]') || {}).value, subject: (document.querySelector('#flow-hud [data-ap-subject="' + id + '"]') || {}).value }), ap.id);
  ok('the address and the subject can be changed on the card before the yes', ed.to === ap.detail.to && ed.subject === ap.detail.subject, ed);
  await p.fill('#flow-hud [data-ap-to="' + ap.id + '"]', 'Azize (address to add)'); await p.click('#flow-hud [data-hud="approve"][data-id="' + ap.id + '"]'); await p.waitForTimeout(600);
  ok('without a real address, the yes is refused on the card and nothing is sent', (await mail()).n === nMail && (await api('/api/team/tasks')).j.approvals.find((x) => x.id === ap.id).status === 'pending');
  const fromNone = await p.evaluate((id) => { const sel = document.querySelector('#flow-hud [data-ap-from="' + id + '"]'); return sel && [...sel.options].map((o) => o.value); }, ap.id);
  ok('the card has a From choice; with no account allowed to send, only The Flow\'s address, and it says how to add his', JSON.stringify(fromNone) === '["flow"]' && await p.evaluate(() => /Settings → Connections/.test((document.querySelector('#flow-hud .hud-apfrom') || {}).textContent || '')), fromNone);
  const d1 = await api('/api/team/approve', { id: ap.id, decision: 'approve', detail: Object.assign({}, ap.detail, { body: 'Dear customer, your refund is on its way.' }) });
  const m1 = await mail();
  ok('approving sends it — exactly the edited text, from the verified address, in Sarah\'s name, reply-to the owner, with the honest footer', d1.j.ok && d1.j.approval.status === 'executed' && m1.n === nMail + 1 && m1.last.text.indexOf('Dear customer, your refund is on its way.') === 0 && /^Sarah for Artur <mail@theflow\.today>$/.test(m1.last.from) && m1.last.to[0] === 'customer@example.com' && /AI assistant working for Artur/.test(m1.last.text) && /approved by them/.test(m1.last.text) && m1.last.reply_to === process.env.FLOW_OWNER_EMAIL, { st: d1.j.approval && d1.j.approval.status, mail: m1.last });
  const d2 = await api('/api/team/approve', { id: ap.id, decision: 'approve' });
  ok('approving it again sends nothing', d2.j.already === true && (await mail()).n === nMail + 1);
  const t2done = (await api('/api/team/tasks')).j.tasks.find((x) => x.id === t2.j.task.id);
  ok('the task is done and the activity log says "Sent"', t2done.status === 'done' && (await api('/api/team')).j.log.some((l) => /^Sent: /.test(l.what)));
  ok('the room lists what was sent lately', (await api('/api/team')).j.recent.some((x) => x.id === ap.id));
  /* a read-only agent's proposal is recorded, never sent */
  await api('/api/team/agent/update', { id: 'sarah', permissions: 'read' });
  const t3 = await api('/api/team/task', { agent: 'sarah', title: 'Another email', brief: 'Draft an email to the customer about delivery', lang: 'en' });
  await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t3.j.task.id); return t && t.status === 'awaiting_approval'; }, 20000);
  ap = (await api('/api/team/tasks')).j.approvals.find((x) => x.task === t3.j.task.id && x.status === 'pending');
  const d3 = await api('/api/team/approve', { id: ap.id, decision: 'approve' });
  ok('a read-only agent\'s approved email is NOT sent, and the note says so', d3.j.approval.status === 'awaiting_tool' && /read-only/.test(d3.j.approval.note) && (await mail()).n === nMail + 1, d3.j.approval);
  await api('/api/team/agent/update', { id: 'sarah', permissions: 'draft' });
  /* from one of his own accounts */
  await api('/api/team/_sender', { provider: 'gsend', email: 'artur@abko.example' });
  await api('/api/team/_sender', { provider: 'osend', email: 'artur@outlook.example' });
  const tFrom = await api('/api/team/task', { agent: 'sarah', title: 'Note from his address', brief: 'Draft an email to the customer about the invoice', lang: 'en' });
  await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === tFrom.j.task.id); return t && t.status === 'awaiting_approval'; }, 20000);
  const apFrom = (await api('/api/team/tasks')).j.approvals.find((x) => x.task === tFrom.j.task.id && x.status === 'pending');
  await p.evaluate(async () => { await FlowTeam.load(true); FlowHud.paint(); }); await p.waitForTimeout(600);
  const optsFrom = await p.evaluate((id) => [...document.querySelector('#flow-hud [data-ap-from="' + id + '"]').options].map((o) => o.value), apFrom.id);
  ok('each address he allowed to send is offered: Google and Outlook alike', optsFrom.indexOf('gsend:artur@abko.example') > 0 && optsFrom.indexOf('osend:artur@outlook.example') > 0, optsFrom);
  await p.selectOption('#flow-hud [data-ap-from="' + apFrom.id + '"]', 'gsend:artur@abko.example'); await p.waitForTimeout(200);
  ok('choosing it says the email goes from there, into its Sent folder', /Sent folder/.test(await p.evaluate((id) => document.querySelector('#flow-hud .hud-ap[data-id="' + id + '"] .hud-sub:not(.hud-apfrom)').textContent, apFrom.id)));
  const nFrom = (await mail()).n;
  await p.click('#flow-hud [data-hud="approve"][data-id="' + apFrom.id + '"]'); await p.waitForTimeout(1200);
  const mFrom = await mail(); const doneFrom = (await api('/api/team/tasks')).j.approvals.find((x) => x.id === apFrom.id);
  ok('approving sends it once, from his own address — not The Flow\'s, with no assistant footer', mFrom.n === nFrom + 1 && mFrom.last.from === 'artur@abko.example' && mFrom.last.account === 'gsend:artur@abko.example' && doneFrom.status === 'executed' && /from artur@abko\.example/.test(doneFrom.note), { last: mFrom.last, note: doneFrom.note });
  ok('the address he chose is remembered for the next one', await p.evaluate(() => localStorage.getItem('flow:mailFrom')) === 'gsend:artur@abko.example');
  /* saved addresses */
  const ct = await api('/api/team/contacts');
  ok('every address an approved email went to is saved', ct.j.contacts.some((c) => c.email === 'customer@example.com' && c.uses >= 1), ct.j.contacts);
  const addC = await api('/api/team/contacts', { name: 'Azize Sungar', email: 'azize.sungar@abko.example' });
  ok('he can save one by hand, with a name', addC.j.ok && addC.j.contacts.some((c) => c.email === 'azize.sungar@abko.example' && c.name === 'Azize Sungar'));
  ok('…and the team knows it for the next draft', (await api('/api/team')).j.knowledge.some((k) => /Azize Sungar's email address is azize\.sungar@abko\.example/.test(k.text)));
  ok('a bad address is refused', (await api('/api/team/contacts', { name: 'x', email: 'not-an-address' })).status === 400);
  await p.evaluate(async () => { await FlowTeam.load(true); FlowHud.paint(); }); await p.waitForTimeout(500);
  const ctUi = await p.evaluate(() => ({ panel: !!document.querySelector('#flow-hud [data-k="contacts"] form[data-team="ctadd"]'), list: [...document.querySelectorAll('#hud-contacts option')].map((o) => o.value), pre: FlowTeam.toFor({ to: 'Azize (e-posta adresi eklenmeli)' }) }));
  ok('his room lists them, the To field offers them, and a draft that only names Azize gets her address', ctUi.panel && ctUi.list.indexOf('azize.sungar@abko.example') >= 0 && ctUi.pre === 'azize.sungar@abko.example', ctUi);
  await api('/api/team/contacts', { op: 'remove', email: 'azize.sungar@abko.example' });
  ok('…and removes one', !(await api('/api/team/contacts')).j.contacts.some((c) => c.email === 'azize.sungar@abko.example'));
  /* approve by text */
  const t4 = await api('/api/team/task', { agent: 'sarah', title: 'Third email', brief: 'Draft an email to the customer about the invoice', lang: 'en' });
  await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t4.j.task.id); return t && t.status === 'awaiting_approval'; }, 20000);
  await tg(4242, '/yes 1'); await wait(900);
  ok('"/yes 1" from Telegram sends it and the reply says "Sent", with the address', (await mail()).n === nMail + 3 && /^Sent: /.test((await sentNow()).last.body.text) && /customer@example\.com/.test((await sentNow()).last.body.text), (await sentNow()).last.body.text);

  console.log('\n— reading the web inside work and chat —');
  const t5 = await api('/api/team/task', { agent: 'tom', title: 'Prices', brief: 'read ' + H + '/_page/plain and report the prices', lang: 'en' });
  const t5d = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t5.j.task.id); return t && t.status === 'done' ? t : null; }, 20000);
  ok('a step may fetch a public page and work from it; the activity log says what was read', !!t5d && /Hall A costs 500 EUR/.test(t5d.result) && (await api('/api/team')).j.log.some((l) => /Tom read localhost/.test(l.what)), t5d && t5d.result);
  const say = await api('/api/team/say', { agent: 'tom', text: 'read ' + H + '/_page/plain please', lang: 'en' });
  ok('in conversation too: Tom reads the page and answers from it', say.j.ok && /Hall B costs 800 EUR/.test(say.j.say) && say.j.read.length === 1, say.j);
  const t6 = await api('/api/team/task', { agent: 'tom', title: 'Private', brief: 'read http://169.254.169.254/latest/meta-data and report', lang: 'en' });
  const t6d = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t6.j.task.id); return t && t.status === 'done' ? t : null; }, 20000);
  ok('a private address is refused, and the agent is told so instead of being handed the server\'s innards', !!t6d && /cannot be read from here/.test(t6d.result), t6d && t6d.result);

  if (av.mode === 'browser') {
    console.log('\n— the browser, and the handoff —');
    const t7 = await api('/api/team/task', { agent: 'tom', title: 'Browse', brief: 'browse ' + H + '/_page/plain and tell me what is there', lang: 'en' });
    const t7d = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t7.j.task.id); return t && t.status === 'done' ? t : null; }, 40000);
    ok('an agent browses a public page in its own profile and brings back what it saw', !!t7d && /Venue prices/.test(t7d.result) && t7d.shots >= 1, t7d && { r: (t7d.result || '').slice(0, 120), shots: t7d.shots });
    const sh = await api('/api/team/task/shots?id=' + t7.j.task.id);
    ok('a screenshot of each step is kept with the task, small, for the person to see', sh.j.shots.length >= 1 && /^data:image\/jpeg;base64,/.test(sh.j.shots[0].img) && sh.j.shots[0].img.length < 120000 && sh.j.shots[0].agent === 'tom', sh.j.shots.length);
    await p.evaluate(async (id) => { await FlowTeam.load(true); await FlowTeam.openTask(id); }, t7.j.task.id); await p.waitForTimeout(1500);
    ok('the task view shows what Tom saw', await p.evaluate(() => !!document.querySelector('#flow-hud .hud-shots img')));
    const t8 = await api('/api/team/task', { agent: 'tom', title: 'Members', brief: 'browse ' + H + '/_page/login and sign in', lang: 'en' });
    const t8d = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t8.j.task.id); return t && t.status === 'awaiting_info' ? t : null; }, 40000);
    ok('a sign-in page stops the agent and hands over to the person — no password is ever typed', !!t8d && t8d.handoff && /sign-in|verification/.test(t8d.handoff.why) && /_page\/login/.test(t8d.handoff.url) && /carry on/.test(t8d.question), t8d && { q: t8d.question, h: t8d.handoff });
    await p.evaluate(async (id) => { await FlowTeam.load(true); await FlowTeam.openTask(id); }, t8.j.task.id); await p.waitForTimeout(1200);
    const hv = await p.evaluate(() => ({ hand: !!document.querySelector('#flow-hud .hud-hand'), link: (document.querySelector('#flow-hud .hud-hand a') || {}).getAttribute && document.querySelector('#flow-hud .hud-hand a').getAttribute('href'), ph: (document.querySelector('#flow-hud form[data-team="answer"] input') || {}).placeholder }));
    ok('the task view shows "Needs you" with the page to open, and asks to carry on', hv.hand && /_page\/login/.test(hv.link || '') && /carry on/.test(hv.ph || ''), hv);
    await api('/api/team/task/answer', { id: t8.j.task.id, answer: 'Done — the members area says the hall is free on Friday.' });
    const t8e = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t8.j.task.id); return t && t.status === 'done' ? t : null; }, 40000);
    ok('after the person\'s answer the step finishes with what they said', !!t8e && /members area says the hall is free/.test(t8e.result), t8e && (t8e.result || '').slice(0, 160));
  } else console.log('  (no Chromium here: the browser tests are skipped; reader mode is what this host has)');

  console.log('\n— the month\'s cost and its limit —');
  const u1 = await api('/api/team/usage');
  ok('usage is rolled up by agent for the month, with an estimated cost and a plain note that it is an estimate', u1.j.ok && u1.j.agents.length >= 2 && u1.j.total.calls > 5 && /Estimated/.test(u1.j.note) && u1.j.limit === 0, u1.j.total);
  const lim = await api('/api/team/limits', { monthlyUsd: 0.00001 });
  ok('a limit is a whole number of dollars; a silly one rounds to none', lim.j.limit === 0);
  /* a limit below what is already spent (the stand-in counts 12+6 tokens per call) — force it through the store */
  await api('/api/set', { key: 'team:limits', value: { monthlyUsd: 1 } });
  await api('/api/set', { key: 'team:usage:m:' + new Date().toISOString().slice(0, 7), value: { jarvis: { calls: 3, in: 10, out: 10, usd: 1.25, unpriced: 0 } } });
  const over = await api('/api/team/say', { agent: 'tom', text: 'hello', lang: 'en' });
  ok('once the month\'s limit is reached, the team stops and says how to carry on', over.status === 429 && /budget of \$1 is used up/.test(over.j.error) && /Raise it/.test(over.j.error), over.j);
  const dl = await api('/api/team/delegate', { text: 'have Sarah draft a note', lang: 'en' });
  ok('…delegation too', dl.status === 429, dl.status);
  const t9 = await api('/api/team/task', { agent: 'tom', title: 'Over', brief: 'anything', lang: 'en' });
  const t9d = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t9.j.task.id); return t && t.status === 'failed' ? t : null; }, 15000);
  ok('…and a task that starts over the limit fails with the reason, so it can be retried after the limit is raised', !!t9d && /budget/.test(t9d.error), t9d && t9d.error);
  await p.evaluate(async () => { FlowTeam.openId = null; await FlowTeam.select('jarvis', true); await FlowTeam.load(true); await FlowTeam.loadUsage(true); FlowHud.paint(); });
  await p.waitForTimeout(900);
  const up = await p.evaluate(() => ({ there: !!document.querySelector('#flow-hud [data-k="usage"]'), limit: !!document.querySelector('#flow-hud [data-team-limit]') }));
  const up2 = await p.evaluate(() => ({ text: (document.querySelector('#flow-hud [data-k="usage"]') || {}).textContent || '' }));
  ok('his room shows Usage this month with the limit field and the estimate note', up.there && up.limit && /\$/.test(up2.text) && /list prices/.test(up2.text), up2.text.slice(0, 200));
  await api('/api/team/limits', { monthlyUsd: 50 });
  await api('/api/team/task/retry', { id: t9.j.task.id });
  const t9e = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === t9.j.task.id); return t && t.status === 'done' ? t : null; }, 15000);
  ok('with the limit raised, Try again finishes it', !!t9e, t9e && t9e.status);

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
