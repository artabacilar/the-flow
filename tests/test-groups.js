/* Groups, topics, members, modes, diagnostics — and what a restart keeps.
 *
 * What would make it wrong: a stranger's message in a group starting work or
 * getting an answer; a group answering before anyone attached it; a member
 * authorised by anything but their numeric id; mention-only answering a
 * message not addressed to him, or conversational staying silent; two topics
 * sharing one conversation or one sticky specialist; work started in a topic
 * reporting anywhere but that topic; a message acknowledged and then lost on
 * a restart; a reply that failed to send never sent; /diag saying something
 * the store does not. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const C = require('../flow-channels.js');
const G = require('../flow-groups.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 420) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body, headers) => fetch(H + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });

(async () => {
  console.log('\n— shapes —');
  const bot = 'flow_test_bot';
  ok('addressed: a command, @the bot, a reply to him, or his name at the start; not an aside', G.mentioned({ text: '/tasks' }, bot) && G.mentioned({ text: 'hey @flow_test_bot what is open' }, bot) && G.mentioned({ text: 'and you?', reply_to_message: { from: { is_bot: true } } }, bot) && G.mentioned({ text: 'Jarvis, what is open today' }, bot) && G.mentioned({ text: 'ok J.A.R.V.I.S. how are we' }, bot) && !G.mentioned({ text: 'lunch at one?' }, bot) && !G.mentioned({ text: 'the jarvis thing was funny' }, bot));
  ok('the mention and the name come off before he reads it', G.stripMention('@flow_test_bot what is open', bot) === 'what is open' && G.stripMention('Jarvis, what is open', bot) === 'what is open' && G.stripMention('hey J.A.R.V.I.S. draft a reply', bot) === 'draft a reply');
  ok('a workspace id is the channel, the chat and — for a topic — the thread', G.wsId('telegram', -100123, '') === 'telegram:-100123' && G.wsId('telegram', -100123, '5') === 'telegram:-100123:5' && G.toOf(-100123, '5') === '-100123:5');

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); });
  await p.waitForTimeout(800);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body]);
  await api('/api/team');
  const tgSecret = C._internals.telegramSecret();
  const sentNow = async () => (await fetch(H + '/api/channels/_sent').then((r) => r.json()).catch(() => null));
  /* one Telegram update; waits for the reply (or, when `quiet`, makes sure none comes) */
  const send = async (message, opts) => {
    opts = opts || {};
    const n0 = ((await sentNow()) || {}).n || 0;
    const r = await post('/api/channels/telegram', { message }, Object.assign({ 'x-telegram-bot-api-secret-token': tgSecret }, opts.headers || {}));
    let s = null;
    for (let i = 0; i < (opts.quiet ? 5 : 25); i++) { await wait(300); s = await sentNow(); if (s && s.n > n0) break; }
    const rec = (s && s.recent) || [];
    const mine = s && s.n > n0 ? rec.slice(-(s.n - n0)) : [];
    return { status: r.status, n: mine.length, text: mine.map((x) => String((x.body && x.body.text) || '')).join('\n---\n'), bodies: mine.map((x) => x.body) };
  };
  const OWNER = 88001, MEMBER = 77002, STRANGER = 66003, GROUP = -100123;
  const dm = (text, from) => ({ chat: { id: from || OWNER, type: 'private' }, from: { id: from || OWNER, first_name: from === MEMBER ? 'Oğuz' : 'Artur' }, text });
  const grp = (text, from, extra) => Object.assign({ chat: { id: GROUP, type: 'supergroup', title: 'Abko ops' }, from: { id: from, first_name: from === OWNER ? 'Artur' : from === MEMBER ? 'Oğuz' : 'Someone', last_name: from === MEMBER ? 'Kaya' : '' }, text }, extra || {});
  const inTopic = (text, from, thread, extra) => grp(text, from, Object.assign({ is_topic_message: true, message_thread_id: thread }, extra || {}));

  console.log('\n— before anyone attached it —');
  const code = (await api('/api/channels/me/code', {})).j.code; await send(dm(code));
  ok('the owner\'s own Telegram is linked (the private chat as before)', /Linked to/.test((await send(dm('/team'))).text) === false && /J\.A\.R\.V\.I\.S\./.test((await send(dm('/team'))).text));
  const q1 = await send(grp('lunch at one?', OWNER), { quiet: true });
  const q2 = await send(grp('@flow_test_bot what is open today', STRANGER));
  ok('a group nobody attached: silence unless he is addressed — then how to attach, and nothing else', q1.n === 0 && /not attached to a Flow/.test(q2.text) && /six-digit link code/.test(q2.text), { q1, q2 });
  const code2 = (await api('/api/channels/me/code', {})).j.code;
  const at = await send(grp(code2, OWNER));
  ok('the owner\'s link code sent in the group attaches it, mention-only, to a topic-aware reply', /attached to Artur's Flow/.test(at.text) && /mention-only/.test(at.text) && at.bodies[0].chat_id === String(GROUP) && !at.bodies[0].message_thread_id, at);
  const gv = (await api('/api/channels/me/groups')).j;
  ok('the app lists the workspace: the group, mention-only, J.A.R.V.I.S., nobody authorised yet', gv.ok && gv.workspaces.length === 1 && gv.workspaces[0].id === 'telegram:' + GROUP && gv.workspaces[0].mode === 'mention' && gv.workspaces[0].title === 'Abko ops' && gv.members.length === 0 && gv.bot === 'flow_test_bot', gv.workspaces);

  console.log('\n— members by numeric id —');
  const s1 = await send(grp('Jarvis what is open today', STRANGER));
  const s2 = await send(grp('Jarvis are you there', STRANGER), { quiet: true });
  const s3 = await send(grp('anyone seen the invoice?', STRANGER), { quiet: true });
  ok('a stranger addressing him is told, once, that only authorised members may — with their id; asides from them are ignored', /only take instructions from authorised members/.test(s1.text) && new RegExp('Your id is ' + STRANGER).test(s1.text) && s2.n === 0 && s3.n === 0, { s1: s1.text, s2, s3 });
  const who = await send(grp('/whoami', MEMBER));
  ok('/whoami gives anyone their numeric id and whether they are authorised', new RegExp('id is ' + MEMBER).test(who.text) && /not authorised yet/.test(who.text) && new RegExp('/allow ' + MEMBER).test(who.text), who.text);
  const badId = await send(grp('/allow oguz', OWNER));
  const al = await send(grp('/allow ' + MEMBER + ' Oğuz Kaya', OWNER));
  ok('the owner authorises by numeric id only — a name alone is refused', /numeric id/.test(badId.text) && /Authorised: Oğuz Kaya/.test(al.text), { badId: badId.text, al: al.text });
  const notOwner = await send(grp('/allow ' + STRANGER + ' Mallory', MEMBER));
  ok('an authorised member still cannot authorise others — only the owner', /Only the owner/.test(notOwner.text), notOwner.text);
  const m1 = await send(grp('Jarvis, what is open today', MEMBER));
  const m2 = await send(grp('nice weather', MEMBER), { quiet: true });
  ok('an authorised member addressing him gets a real answer; in mention-only his asides still get nothing', m1.n === 1 && m1.text.length > 10 && !/authorised members/.test(m1.text) && m2.n === 0, { m1: m1.text.slice(0, 120), m2 });
  const mem = await send(grp('/members', OWNER));
  ok('/members lists them with ids', /Oğuz Kaya — telegram 77002/.test(mem.text), mem.text);

  console.log('\n— modes —');
  const md0 = await send(grp('/mode', OWNER));
  const md1 = await send(grp('/mode all', OWNER));
  const m3 = await send(grp('what is open today', MEMBER));
  ok('/mode shows the mode; /mode all makes him answer everything from authorised members', /is mention-only/.test(md0.text) && /conversational/.test(md1.text) && m3.n === 1 && m3.text.length > 10, { md0: md0.text, md1: md1.text, m3: m3.text.slice(0, 100) });
  const s4 = await send(grp('what is open today', STRANGER), { quiet: true });
  ok('…but still nothing from a stranger', s4.n === 0, s4);
  const md2 = await send(grp('/mode mention', OWNER));
  const m4 = await send(grp('what is open today', MEMBER), { quiet: true });
  ok('/mode mention goes back to answering only when addressed', /mention-only/.test(md2.text) && m4.n === 0, { md2: md2.text, m4 });
  const gv2 = (await api('/api/channels/me/groups')).j;
  const ws0 = gv2.workspaces.find((w) => w.id === 'telegram:' + GROUP);
  ok('the counts are kept: answered, not addressed, unauthorised', ws0.handled >= 6 && ws0.ignored >= 2 && ws0.refused >= 3 && gv2.members.length === 1 && gv2.members[0].allowed && gv2.members[0].name === 'Oğuz Kaya', ws0);

  console.log('\n— topics: parallel workspaces —');
  const t1 = await send(inTopic('@flow_test_bot /sarah', OWNER, 5, { reply_to_message: { forum_topic_created: { name: 'Ads' } } }));
  const t2 = await send(grp('@flow_test_bot /team', OWNER));
  ok('a topic is its own workspace: Sarah is sticky there, the group itself still talks to J.A.R.V.I.S., and the reply goes into the topic', /talking to Sarah/.test(t1.text) && /here/.test(t1.text) && t1.bodies[0].message_thread_id === 5 && /▶ J\.A\.R\.V\.I\.S\./.test(t2.text) && !t2.bodies[0].message_thread_id, { t1: t1.text, t2: t2.text, b: t1.bodies[0] });
  const t3 = await send(inTopic('Jarvis how much does the premium plan cost', OWNER, 5));
  ok('in the topic a message goes to Sarah (sticky there)', t3.n === 1 && !/J\.A\.R\.V\.I\.S\. here/.test(t3.text) && t3.bodies[0].message_thread_id === 5, t3.text.slice(0, 120));
  const t4 = await send(inTopic('Jarvis /jarvis', OWNER, 5));
  const t5 = await send(inTopic('Jarvis have Sarah draft a reply to the refund complaint from Ali and keep it short', OWNER, 5));
  ok('work started in a topic is started from there', /J\.A\.R\.V\.I\.S\. here/.test(t4.text) && /Started:/.test(t5.text), { t4: t4.text, t5: t5.text });
  const tasks = (await api('/api/team')).j.tasks || [];
  const tk = tasks.slice().reverse().find((t) => /refund|Ali|reply/i.test(t.title + t.brief));
  ok('…and the task remembers where it came from: the topic, not the group', tk && tk.origin && tk.origin.channel === 'telegram' && tk.origin.to === GROUP + ':5' && tk.via === 'telegram', tk && tk.origin);
  let done = null; for (let i = 0; i < 40; i++) { await wait(500); const tl = (await api('/api/team')).j.tasks || []; done = tl.find((t) => t.id === tk.id); if (done && /^(done|awaiting_approval|failed)$/.test(done.status)) break; }
  await wait(800);
  const s5 = await sentNow();
  const back = (s5.recent || []).slice().reverse().find((x) => x.body && x.body.message_thread_id === 5 && /Sarah|done|needs your yes/i.test(x.body.text || ''));
  ok('when it is ready the result lands in that topic', !!done && !!back && back.body.chat_id === String(GROUP), { st: done && done.status, back: back && back.body });
  const gv3 = (await api('/api/channels/me/groups')).j;
  const topic = gv3.workspaces.find((w) => w.id === 'telegram:' + GROUP + ':5');
  ok('the app shows the topic under its group, named from the forum, with its own agent', !!topic && topic.topic === 'Ads' && topic.threadId === '5' && topic.agent === 'jarvis' && gv3.workspaces.length === 2, topic);
  const gl = await send(dm('/groups'));
  ok('/groups from anywhere lists the group and its topic', /"Abko ops" — mention-only/.test(gl.text) && /topic 5 "Ads"/.test(gl.text), gl.text);

  console.log('\n— diagnostics —');
  const dg = await send(inTopic('@flow_test_bot /diag', MEMBER, 5));
  ok('/diag says: server, webhook and bot, this chat and its mode, who you are, the counts, the work from here, the queues, the last error, what a restart keeps', /J\.A\.R\.V\.I\.S\. diagnostics/.test(dg.text) && /Server: up/.test(dg.text) && /bot @flow_test_bot/.test(dg.text) && /topic 5 "Ads" in "Abko ops"/.test(dg.text) && /mention-only/.test(dg.text) && new RegExp('You: id ' + MEMBER + ' \\(authorised member\\)').test(dg.text) && /Work from here: \d+ in flight/.test(dg.text) && /Queues: inbox 0 · outbox 0/.test(dg.text) && /Last delivery error: none/.test(dg.text) && /Restart: tasks resume/.test(dg.text), dg.text);
  const dg2 = await send(dm('/diag'));
  ok('from the private chat: owner, no workspace line, the whole account\'s work', /You: id 88001 \(owner\)/.test(dg2.text) && !/This chat:/.test(dg2.text) && /Workspaces: 1 group, 1 topic · members authorised: 1/.test(dg2.text), dg2.text);

  console.log('\n— what a restart keeps —');
  const n0 = ((await sentNow()) || {}).n || 0;
  const crashed = await send(grp('Jarvis what is open today', OWNER), { quiet: true, headers: { 'x-flow-test-crash': '1' } });
  ok('an update is acknowledged and written down before it is answered; the process "dies" — no reply yet', crashed.status === 200 && crashed.n === 0);
  const rp = await fetch(H + '/api/channels/_replay').then((r) => r.json());
  await wait(600);
  const s6 = await sentNow();
  ok('at the next start the unanswered message is replayed and answered', rp.replayed === 1 && s6.n > n0 && /open|Today|rock/i.test((s6.last.body || {}).text || ''), { rp, last: s6.last && s6.last.body });
  await fetch(H + '/api/channels/_failnext');
  const n1 = ((await sentNow()) || {}).n || 0;
  const failed = await send(grp('Jarvis what is open today', OWNER), { quiet: true });
  const gv4 = (await api('/api/channels/me/groups')).j;
  ok('a reply that cannot be delivered waits in the outbox, and /diag knows', failed.n === 0 && gv4.queues.outbox === 1 && /outbox 1 \(retried every minute/.test(gv4.diag) && /simulated network failure/.test(gv4.diag), { q: gv4.queues, d: gv4.diag.split('\n').filter((l) => /Queues|Last/.test(l)) });
  const rp2 = await fetch(H + '/api/channels/_replay').then((r) => r.json());
  const s7 = await sentNow();
  ok('…and is delivered on the next retry, into the right chat', rp2.delivered === 1 && s7.n === n1 + 1 && s7.last.body.chat_id === String(GROUP) && ((await api('/api/channels/me/groups')).j.queues.outbox === 0), { rp2, last: s7.last && s7.last.body });

  console.log('\n— the app —');
  const dn = await api('/api/channels/me/groups', { op: 'deny', channel: 'telegram', id: String(MEMBER) });
  const m5 = await send(grp('Jarvis what is open today', MEMBER));
  const m5b = await send(grp('Jarvis still there?', MEMBER), { quiet: true });
  ok('removing a member from the app stops them at once: told why once, then silence', dn.j.ok && m5.n === 1 && /authorised members/.test(m5.text) && m5b.n === 0, { dn: dn.j.ok, m5: m5.text, m5b });
  const al2 = await api('/api/channels/me/groups', { op: 'allow', channel: 'telegram', id: String(MEMBER), name: 'Oğuz' });
  const md3 = await api('/api/channels/me/groups', { op: 'mode', id: 'telegram:' + GROUP + ':5', mode: 'all' });
  const m6 = await send(inTopic('what is open today', MEMBER, 5));
  const m7 = await send(grp('what is open today', MEMBER), { quiet: true });
  ok('a topic\'s mode is its own: conversational in the topic, mention-only still in the group', al2.j.ok && md3.j.ok && md3.j.workspace.mode === 'all' && m6.n === 1 && m7.n === 0, { m6: m6.n, m7: m7.n });
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(2500);
  const ui = await p.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="groups"]'); if (!g) return null; return { title: g.querySelector('.hud-ph').textContent, rows: [...g.querySelectorAll('.hud-grp')].map((r) => r.querySelector('.hud-grpr span').textContent + ' | ' + r.querySelector('.hud-grpr .hud-tab').textContent), members: [...g.querySelectorAll('.hud-lg span')].map((x) => x.firstChild.textContent), form: !!g.querySelector('form[data-team="grpallow"] input[name="id"]'), foot: g.querySelector('.hud-sub').textContent }; });
  ok('Groups & members on J.A.R.V.I.S.\'s view: the group and its topic with their modes, the members, authorise-by-id, and the webhook/queue line', ui && /Groups & members · 1/.test(ui.title) && ui.rows.length === 2 && /Abko ops \| Mention-only/.test(ui.rows[0]) && /topic 5 “Ads” \| Conversational/.test(ui.rows[1]) && ui.members.join() === 'Oğuz' && ui.form && /inbox 0 · outbox 0/.test(ui.foot), ui);
  await p.click('#flow-hud [data-k="groups"] [data-hud="grpmode"][data-id="telegram:' + GROUP + '"]'); await p.waitForTimeout(1200);
  ok('one click flips a group to conversational', await p.evaluate((id) => document.querySelector('#flow-hud [data-k="groups"] [data-hud="grpmode"][data-id="' + id + '"]').textContent === 'Conversational', 'telegram:' + GROUP) && ((await api('/api/channels/me/groups')).j.workspaces.find((w) => w.id === 'telegram:' + GROUP).mode === 'all'));
  await p.fill('#flow-hud form[data-team="grpallow"] input[name="id"]', '55004'); await p.fill('#flow-hud form[data-team="grpallow"] input[name="name"]', 'Ayşe'); await p.click('#flow-hud form[data-team="grpallow"] button[type="submit"]'); await p.waitForTimeout(1200);
  const m8 = await send(grp('what is open today', 55004));
  ok('authorising from the app by id works in the group at once', m8.n === 1 && !/authorised members/.test(m8.text), m8.text.slice(0, 100));
  const dt = await send(grp('/detach', OWNER));
  const after = (await api('/api/channels/me/groups')).j;
  const q3 = await send(grp('Jarvis what is open', MEMBER));
  const q4 = await send(grp('what is open', MEMBER), { quiet: true });
  ok('/detach removes the group and its topics; the group is a stranger again — only how to attach, when addressed', /Detached/.test(dt.text) && after.workspaces.length === 0 && /not attached to a Flow/.test(q3.text) && q4.n === 0, { dt: dt.text, n: after.workspaces.length, q3: q3.text, q4 });

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
