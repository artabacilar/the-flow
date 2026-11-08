/* The email review workflow, the route ranking, and the ads-analysis example.
 *
 * What would make it wrong: two emails shown at once; a reply sent that is
 * not the exact text approved (a revised draft going out on the old yes);
 * "delivered" said before the provider's own event; a newsletter drafted; a
 * stale date, a placeholder or an invented link allowed out; a tone
 * correction forgotten by the next draft, or kept with a made-up source URL;
 * auto-send going beyond the senders, the daily limit or the expiry — or
 * not stopping the moment it is turned off; a send in flight at a restart
 * sent twice or never; the ads example pretending its numbers are live. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const C = require('../flow-channels.js');
const M = require('../flow-mail.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 460) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body, headers) => fetch(H + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });

(async () => {
  console.log('\n— shapes —');
  ok('what is actionable: a person asking something yes; a newsletter, a no-reply, an empty forward no', M.actionable({ from: 'Ali <ali@x.example>', subject: 'Refund', text: 'Could you refund order 4471 by Friday?' }).ok && !M.actionable({ from: 'noreply@shop.example', subject: 'Your receipt', text: 'Thanks for your order.' }).ok && !M.actionable({ from: 'news@x.example', subject: 'Digest', text: 'Top stories. You are receiving this because you subscribed. Unsubscribe.' }).ok && M.actionable({ from: 'Burak <b@x.example>', subject: 'Toplantı', text: 'Önümüzdeki hafta uygun bir zamanınız var mı?' }).ok);
  const past = new Date(Date.now() - 10 * 86400000), pastStr = past.getDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][past.getMonth()] + ' ' + past.getFullYear();
  const fl = M.checkDraft('We can meet on ' + pastStr + '. See [name] at https://not-in-thread.example/x', { thread: [{ text: 'hello' }] });
  ok('a draft is checked before it can go: a date already past, a placeholder, a link nobody gave', fl.some((f) => /stale date/.test(f)) && fl.some((f) => /placeholder/.test(f)) && fl.some((f) => /link not in the thread/.test(f)), fl);
  const future = new Date(Date.now() + 5 * 86400000);
  ok('a future date and a link from the thread pass', M.checkDraft('Shall we say ' + future.getDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][future.getMonth()] + ' ' + future.getFullYear() + '? Details: https://ok.example/doc', { thread: [{ text: 'see https://ok.example/doc please' }] }).length === 0);
  ok('a tone correction is recognised; an ordinary change is not', !!M.toneOf('more formal please') && !!M.toneOf('shorter') && !!M.toneOf('never start with Dear') && !!M.toneOf('daha resmi olsun') && !M.toneOf('offer Tuesday instead of Monday'));
  const pol = { enabled: true, maxPerDay: 1, senders: ['northwindtrading.example'], kinds: [], expiresAt: Date.now() + 86400000, sentToday: {} };
  const it = { from: 'Ali <ali@northwindtrading.example>', subject: 'x', why: 'asks', flags: [], draft: { needs: [] } };
  ok('the policy is bounded: sender, limit, expiry, clean draft — and off means off', M.policyAllows(pol, it).ok && !M.policyAllows(Object.assign({}, pol, { enabled: false }), it).ok && !M.policyAllows(pol, Object.assign({}, it, { from: 'x@other.example' })).ok && !M.policyAllows(Object.assign({}, pol, { sentToday: { [new Date().toISOString().slice(0, 10)]: 1 } }), it).ok && !M.policyAllows(Object.assign({}, pol, { expiresAt: Date.now() - 1 }), it).ok && !M.policyAllows(pol, Object.assign({}, it, { flags: ['stale date'] })).ok && !M.policyAllows(pol, Object.assign({}, it, { draft: { needs: ['the price'] } })).ok);
  ok('the states are the nine named ones', M.STATES.join() === 'draft,awaiting,revised,skipped,submitting,accepted,delivered,bounced,failed');

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
  const mailNow = async () => (await api('/api/team/_mail')).j;

  console.log('\n— one at a time —');
  const fx = await api('/api/team/mail', { op: 'fixtures' });
  const v0 = (await api('/api/team/mail')).j;
  ok('three demo emails in: two actionable drafted and waiting, the newsletter skipped as such; the review shows ONE', fx.j.ok && fx.j.items.length === 3 && v0.queue === 2 && v0.counts.awaiting === 2 && v0.counts.skipped === 1 && v0.current && v0.current.subject === 'Refund for order 4471' && v0.current.draft && v0.current.draft.version === 1 && v0.current.state === 'awaiting', { q: v0.queue, c: v0.counts, cur: v0.current && v0.current.subject });
  const cur = v0.current;
  ok('the review carries the sender, the subject, the whole thread and the exact reply, bound to a version and a hash', cur.from.indexOf('ali@northwindtrading.example') > 0 && cur.thread.length === 1 && /charged twice/.test(cur.thread[0].text) && cur.draft.reply.length > 40 && cur.draft.hash.length === 16 && /^Re: /.test(cur.draft.subject), { subj: cur.draft.subject, h: cur.draft.hash });
  const stale = await api('/api/team/mail', { op: 'send', id: cur.id, hash: 'notthehash0000ab' });
  ok('a yes bound to a different draft than the one on screen is refused — read it again', stale.status === 409 && /changed since you saw it/.test(stale.j.error), stale.j);
  const m0 = (await mailNow()).n;
  const rv = await api('/api/team/mail', { op: 'revise', id: cur.id, text: 'more formal, and sign as Sarah Yilmaz' });
  ok('Revise makes version 2 and keeps the correction as a rule — the skill "Email tone and style"', rv.j.ok && rv.j.item.draft.version === 2 && rv.j.item.state === 'awaiting' && rv.j.item.versions.length === 2 && rv.j.tone && rv.j.skill && rv.j.skill.name === 'Email tone and style', { v: rv.j.item.version, tone: rv.j.tone, skill: rv.j.skill && rv.j.skill.name });
  const sk = (await api('/api/team/skills')).j.items.find((s) => s.name === 'Email tone and style');
  ok('…one line per correction, no invented source URLs', sk && (sk.steps || []).some((s) => /more formal/.test(typeof s === 'string' ? s : s.text)) && !(sk.sources || []).some((x) => /https?:/.test(JSON.stringify(x))), sk && { steps: sk.steps, sources: sk.sources });
  const rv2 = await api('/api/team/mail', { op: 'revise', id: cur.id, text: 'shorter' });
  const sk2 = (await api('/api/team/skills')).j.items.find((s) => s.name === 'Email tone and style');
  ok('a second correction joins the same skill', rv2.j.ok && rv2.j.item.draft.version === 3 && sk2 && (sk2.steps || []).length === 2, sk2 && sk2.steps);
  const oldYes = await api('/api/team/mail', { op: 'send', id: cur.id, hash: cur.draft.hash });
  ok('the old yes (version 1) does not send version 3', oldYes.status === 409 && (await mailNow()).n === m0, oldYes.j.error);
  const v3 = (await api('/api/team/mail')).j.current;
  const sent = await api('/api/team/mail', { op: 'send', id: cur.id, hash: v3.draft.hash });
  const m1 = await mailNow();
  ok('Send this exact reply: submitted once, state "accepted" — the provider took it; not "delivered"', sent.j.ok && sent.j.item.state === 'accepted' && sent.j.item.approval.version === 3 && sent.j.item.approval.hash === v3.draft.hash && m1.n === m0 + 1 && m1.last.text.indexOf(v3.draft.reply) === 0 && m1.last.to[0] === 'ali@northwindtrading.example' && m1.last.headers['X-Entity-Ref-ID'] === sent.j.item.send.key, { st: sent.j.item.state, n: m1.n });
  const again = await api('/api/team/mail', { op: 'send', id: cur.id, hash: v3.draft.hash });
  ok('a second yes does nothing: it is already accepted', again.status === 400 && /accepted/.test(again.j.error) && (await mailNow()).n === m0 + 1, again.j);
  const v1 = (await api('/api/team/mail')).j;
  ok('the next email takes the screen — the Turkish one; the sent one is in Recent as accepted', v1.current && v1.current.subject === 'Toplantı için uygun zaman' && v1.queue === 1 && v1.items.find((m) => m.id === cur.id).state === 'accepted', { cur: v1.current && v1.current.subject });

  console.log('\n— delivery is the provider\'s word, not ours —');
  const pid = sent.j.item.send.providerId;
  const ev = await post('/api/mail/events', { type: 'email.delivered', data: { email_id: pid } });
  const evj = await ev.json();
  const afterEv = (await api('/api/team/mail')).j.items.find((m) => m.id === cur.id);
  ok('the provider\'s delivered event moves it to delivered — only then', evj.ok && evj.state === 'delivered' && afterEv.state === 'delivered' && afterEv.send.deliveredAt > 0, { evj, st: afterEv.state });
  const unk = await (await post('/api/mail/events', { type: 'email.delivered', data: { email_id: 'nobody' } })).json();
  const ign = await (await post('/api/mail/events', { type: 'email.sent', data: { email_id: pid } })).json();
  ok('unknown ids and other events change nothing', unk.unknown && ign.ignored);
  const cur2 = v1.current;
  const sent2 = await api('/api/team/mail', { op: 'send', id: cur2.id, hash: cur2.draft.hash });
  const bounce = await (await post('/api/mail/events', { type: 'email.bounced', data: { email_id: sent2.j.item.send.providerId, bounce: { message: 'mailbox does not exist' } } })).json();
  const afterB = (await api('/api/team/mail')).j.items.find((m) => m.id === cur2.id);
  ok('a bounce is shown as a bounce, with the reason', bounce.state === 'bounced' && afterB.state === 'bounced' && /mailbox does not exist/.test(afterB.send.bounce), afterB.send);
  const skipAcc = await api('/api/team/mail', { op: 'skip', id: cur.id });
  ok('a reply that has gone cannot be un-sent', skipAcc.status === 400 && /cannot be unsent/.test(skipAcc.j.error));

  console.log('\n— don\'t send, and what a restart does —');
  const in1 = await api('/api/team/mail', { op: 'intake', mail: { from: 'Zeynep <zeynep@customer.example>', subject: 'Invoice question', text: 'Hi, could you resend the invoice for October? Thanks.' } });
  const sk1 = await api('/api/team/mail', { op: 'skip', id: in1.j.item.id, why: 'handled by phone' });
  ok('Don\'t send marks it skipped with the reason; nothing goes out', in1.j.item.state === 'awaiting' && sk1.j.ok && sk1.j.item.state === 'skipped' && sk1.j.item.skipReason === 'handled by phone' && (await mailNow()).n === m0 + 2);
  const dupe = await api('/api/team/mail', { op: 'intake', mail: { from: 'Zeynep <zeynep@customer.example>', subject: 'Invoice question', text: 'Hi, could you resend the invoice for October? Thanks.' } });
  ok('the same email twice is one item', dupe.j.duplicate === true && dupe.j.item.id === in1.j.item.id);
  const in2 = await api('/api/team/mail', { op: 'intake', mail: { from: 'Mert <mert@customer.example>', subject: 'Price of the pro plan', text: 'What does the pro plan cost per month?' } });
  await p.evaluate(async (id) => { let L = await Flow.DB.get('team:mail', null); if (typeof L === 'string') L = JSON.parse(L); const m = L.find((x) => x.id === id); m.state = 'submitting'; m.approval = { hash: m.draft.hash, version: m.draft.version, at: Date.now(), by: 'owner', via: 'app' }; m.send = { key: 'mail-' + id + '-v' + m.draft.version, startedAt: Date.now() - 60000, attempts: 1 }; await Flow.DB.set('team:mail', L); }, in2.j.item.id);
  const rec = await api('/api/team/mail', { op: 'recover' });
  const afterR = (await api('/api/team/mail')).j.items.find((m) => m.id === in2.j.item.id);
  const m3 = await mailNow();
  ok('a send that was in flight when the process stopped is finished at the next start — once, with the same key', rec.j.finished === 1 && afterR.state === 'accepted' && m3.n === m0 + 3 && m3.last.headers['X-Entity-Ref-ID'] === 'mail-' + in2.j.item.id + '-v1', { rec: rec.j, st: afterR.state });

  console.log('\n— the bounded, revocable auto-send policy —');
  const bad = await api('/api/team/mail', { op: 'policy', enabled: true, senders: '', maxPerDay: 2 });
  ok('auto-send refuses to turn on without a sender and a limit', bad.status === 400 && /stays off/.test(bad.j.error) && bad.j.policy.enabled === false);
  const pon = await api('/api/team/mail', { op: 'policy', enabled: true, senders: 'northwindtrading.example', maxPerDay: 1, days: 7 });
  const a1 = await api('/api/team/mail', { op: 'intake', mail: { from: 'Ali Demir <ali@northwindtrading.example>', subject: 'Receipt please', text: 'Could you send the receipt for order 4471?' } });
  const m4 = await mailNow();
  ok('an email from the allowed sender with a clean draft is sent without a yes — logged as auto-sent, within the limit', pon.j.ok && pon.j.policy.enabled && a1.j.item.autoSent === true && a1.j.item.state === 'accepted' && a1.j.item.approval.by === 'auto-send policy' && m4.n === m0 + 4, { st: a1.j.item.state, auto: a1.j.item.autoSent });
  const a2 = await api('/api/team/mail', { op: 'intake', mail: { from: 'Ali Demir <ali@northwindtrading.example>', subject: 'One more thing', text: 'And could you confirm the delivery date?' } });
  const a3 = await api('/api/team/mail', { op: 'intake', mail: { from: 'Someone <x@elsewhere.example>', subject: 'Hello', text: 'Could you call me back about the project?' } });
  ok('the second one today waits for a yes (limit 1); a sender outside the policy always waits', a2.j.item.state === 'awaiting' && !a2.j.item.autoSent && a3.j.item.state === 'awaiting' && (await mailNow()).n === m0 + 4);
  const poff = await api('/api/team/mail', { op: 'policy', enabled: false });
  const polv = (await api('/api/team/mail')).j.policy;
  ok('off at once, with the log of what went under it', poff.j.ok && !polv.enabled && polv.log.length === 1 && polv.log[0].subject === 'Receipt please', polv);

  console.log('\n— the route: ranked, with reasons —');
  const r1 = (await api('/api/team/rank', { text: 'how are the ads doing this week, what should we scale' })).j.ranking;
  const r2 = (await api('/api/team/rank', { text: 'reply to the emails in the inbox' })).j.ranking;
  const r3 = (await api('/api/team/rank', { text: 'write a haiku about autumn' })).j.ranking;
  ok('ads → the ads analysis first (demo fixtures, said so); emails → the email review; anything else → J.A.R.V.I.S. plans it — each with a reason and a score', r1[0].id === 'ads-analysis' && /demo data/.test(r1[0].why) && r2[0].id === 'email-review' && r3[0].kind === 'plan' && r1.every((x) => x.why && x.score > 0 && x.rank), { r1: r1[0], r2: r2[0], r3: r3[0] });
  const dl = await api('/api/team/delegate', { text: 'have Sarah draft a reply to the complaint about the late order' });
  const tk = dl.j.task || ((await api('/api/team')).j.tasks || []).slice(-1)[0];
  ok('a delegated task keeps the ranking it was routed by', tk && Array.isArray(tk.ranking) && tk.ranking.length >= 2 && tk.ranking[0].rank === 1, tk && tk.ranking && tk.ranking.slice(0, 2));

  console.log('\n— the ads-analysis example (demo fixtures) —');
  const ex = await api('/api/team/scripts', { op: 'example', which: 'ads' });
  const run = await api('/api/team/scripts', { op: 'run', id: ex.j.script.id, inputs: { period: 'last 7 days' } });
  const out = String((run.j.run && run.j.run.output) || '');
  ok('the example automation runs on the Meta Ads + RevenueCat fixtures ($12 / $14 / $10), joins spend with revenue, gives CAC, ROAS and a verdict per product — and says in every line that it is demo data', ex.j.ok && run.j.run && run.j.run.status === 'ok' && /DEMO DATA/.test(out) && /premium_monthly \(\$12\/mo\)/.test(out) && /pro_monthly \(\$14\/mo\)/.test(out) && /starter_monthly \(\$10\/mo\)/.test(out) && /ROAS [\d.]+ → (scale|hold|cut)/.test(out) && /CAC [\d.]+/.test(out) && run.j.run.metrics.modelCalls === 0, out.slice(0, 400));
  ok('its numbers are consistent: premium $12 × paid = revenue; verdict follows ROAS', (() => { const m = out.match(/premium_monthly[^\n]*?→ (\d+) paid, revenue ([\d.]+) · CAC ([\d.]+) · ROAS ([\d.]+) → (\w+)/); if (!m) return false; const paid = +m[1], rev = +m[2], roas = +m[4]; return Math.abs(paid * 12 - rev) < 1 && ((roas >= 1.5 && m[5] === 'scale') || (roas >= 1 && roas < 1.5 && m[5] === 'hold') || (roas < 1 && m[5] === 'cut')); })(), out);
  ok('no schedule is set on the example — schedules are examples only', !ex.j.script.schedule || !ex.j.script.schedule.kind);

  console.log('\n— in a chat: /review, /send, /revise, /skip, the inbox group —');
  const tgSecret = C._internals.telegramSecret();
  const sentNow = async () => (await fetch(H + '/api/channels/_sent').then((r) => r.json()).catch(() => null));
  const send = async (message, opts) => { opts = opts || {}; const n0 = ((await sentNow()) || {}).n || 0; await post('/api/channels/telegram', { message }, { 'x-telegram-bot-api-secret-token': tgSecret }); let s = null; for (let i = 0; i < 25; i++) { await wait(300); s = await sentNow(); if (s && s.n > n0 + (opts.want || 1) - 1) break; } await wait(300); s = await sentNow(); const mine = s && s.n > n0 ? (s.recent || []).slice(-(s.n - n0)) : []; return { n: mine.length, text: mine.filter((x) => !/createForumTopic/.test(x.url)).map((x) => String((x.body && x.body.text) || '')).join('\n---\n'), all: mine }; };
  const OWNER = 88001, GROUP = -100123;
  const dm = (text) => ({ chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Artur' }, text });
  const grp = (text, extra) => Object.assign({ chat: { id: GROUP, type: 'supergroup', title: 'Abko inbox' }, from: { id: OWNER, first_name: 'Artur' }, text }, extra || {});
  const code = (await api('/api/channels/me/code', {})).j.code; await send(dm(code));
  const rvw = await send(dm('/review'));
  ok('/review shows the one email waiting: sender, subject, the thread, the exact reply and the three commands', /EMAIL TO REVIEW/.test(rvw.text) && /From: Ali Demir/.test(rvw.text) && /THE THREAD/.test(rvw.text) && /THE EXACT REPLY \(v1\)/.test(rvw.text) && /\/send — send this exact reply \(v1\)/.test(rvw.text) && /\/revise/.test(rvw.text) && /\/skip/.test(rvw.text), rvw.text.slice(0, 300));
  const rvs = await send(dm('/revise warmer please'));
  ok('/revise with a tone word: a new version, and the rule is kept', /Noted as a rule for every email from now on: "warmer please"/.test(rvs.text) && /THE EXACT REPLY \(v2\)/.test(rvs.text), rvs.text.slice(0, 200));
  const m5 = (await mailNow()).n;
  const snd = await send(dm('/send'));
  ok('/send sends exactly the version shown and says accepted, not delivered; the next email follows', /accepted by the email provider \(v2/.test(snd.text) && /delivered; that is a separate confirmation/.test(snd.text) && (await mailNow()).n === m5 + 1 && /Next:/.test(snd.text), snd.text.slice(0, 300));
  const skp = await send(dm('/skip no reply needed'));
  ok('/skip marks the next one not sent', /Not sent: "(Hello|One more thing)"/.test(skp.text), skp.text);
  await send(dm('/skip'));
  const code2 = (await api('/api/channels/me/code', {})).j.code; await send(grp(code2));
  const inb = await send(grp('/inbox here'));
  const n0 = ((await sentNow()) || {}).n;
  const newMail = await api('/api/team/mail', { op: 'intake', mail: { from: 'Can Yıldız <can@partner.example>', subject: 'Demo next week?', text: 'Merhaba, could we do a demo next week? Tuesday afternoon suits us.' } });
  await wait(1200);
  const s1 = await sentNow();
  const mine = (s1.recent || []).slice(-(s1.n - n0));
  const topicCall = mine.find((x) => /createForumTopic/.test(x.url)), posted = mine.find((x) => x.body && x.body.message_thread_id && /EMAIL TO REVIEW/.test(x.body.text || ''));
  const item = (await api('/api/team/mail')).j.items.find((m) => m.id === newMail.j.item.id);
  ok('/inbox here: the next actionable email opens as its own topic in that group — named after it — with the review inside', /every actionable email opens as a topic here/.test(inb.text) && topicCall && /Demo next week\? — Can/.test(topicCall.body.name) && posted && item.topic && item.topic.threadId && posted.body.message_thread_id === +item.topic.threadId, { inb: inb.text.slice(0, 80), name: topicCall && topicCall.body.name, t: item.topic });
  const tid = +item.topic.threadId;
  const tsend = await send(grp('/send', { is_topic_message: true, message_thread_id: tid }));
  const after = (await api('/api/team/mail')).j.items.find((m) => m.id === newMail.j.item.id);
  ok('/send inside the topic sends that email\'s reply, and the answer lands in the topic', /accepted by the email provider/.test(tsend.text) && tsend.all.some((x) => x.body.message_thread_id === tid) && after.state === 'accepted', { st: after.state });
  const asn = await send(dm('/autosend on partner.example 2 3'));
  const asv = (await api('/api/team/mail')).j.policy;
  const asoff = await send(dm('/autosend off'));
  ok('/autosend on <domain> <n> <days> sets the bounded policy; /autosend off revokes it', /Auto-send is ON for partner.example: at most 2 a day until/.test(asn.text) && asv.enabled && asv.maxPerDay === 2 && /Auto-send is OFF/.test(asoff.text) && !(await api('/api/team/mail')).j.policy.enabled, { asn: asn.text.slice(0, 120) });

  console.log('\n— the app —');
  await api('/api/team/mail', { op: 'intake', mail: { from: 'Elif <elif@client.example>', subject: 'Contract renewal', text: 'Hello, can we renew the contract for another year at the same price?' } });
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(2500);
  const ui = await p.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="mail"]'); if (!g) return null; return { title: g.querySelector('.hud-ph').textContent, subj: (g.querySelector('.hud-mhead b') || {}).textContent, thread: !!g.querySelector('.hud-mthread'), draft: !!g.querySelector('.hud-mdraft pre'), btns: [...g.querySelectorAll('.hud-mdraft .hud-row button')].map((x) => x.textContent), hash: (g.querySelector('[data-hud="mailsend"]') || {}).getAttribute && g.querySelector('[data-hud="mailsend"]').getAttribute('data-hash'), recent: g.querySelectorAll('.hud-lg').length, policy: !!g.querySelector('form[data-team="mailpolicy"]') }; });
  ok('Email review on J.A.R.V.I.S.\'s view: one email — subject, sender, the thread, the exact reply — with Send this exact reply / Revise / Don\'t send bound to the hash, the recent ones with their states, and the policy', ui && /Email review · 1 waiting/.test(ui.title) && ui.subj === 'Contract renewal' && ui.thread && ui.draft && ui.btns.join() === "Send this exact reply,Revise,Don't send" && ui.hash && ui.hash.length === 16 && ui.recent >= 3 && ui.policy, ui);
  await p.click('#flow-hud [data-k="mail"] [data-hud="mailrevise"]'); await p.waitForTimeout(300);
  await p.fill('#flow-hud form[data-team="mailrevise"] textarea', 'more concise'); await p.click('#flow-hud form[data-team="mailrevise"] button[type="submit"]'); await p.waitForTimeout(1500);
  ok('Revise from the panel makes version 2', await p.evaluate(() => /v2/.test(document.querySelector('#flow-hud [data-k="mail"] .hud-mdraft .hud-ph span').textContent)));
  const m6 = (await mailNow()).n;
  await p.click('#flow-hud [data-k="mail"] [data-hud="mailsend"]'); await p.waitForTimeout(1500);
  const afterUi = (await api('/api/team/mail')).j;
  ok('Send this exact reply from the panel: accepted, version 2, once; the panel empties', (await mailNow()).n === m6 + 1 && afterUi.items.find((m) => m.subject === 'Contract renewal').state === 'accepted' && afterUi.items.find((m) => m.subject === 'Contract renewal').approval.version === 2 && !afterUi.current);
  ok('the task view explains its route', await p.evaluate(() => { const t = document.querySelector('#flow-hud .hud-task'); if (!t) return false; t.click(); return new Promise((r) => setTimeout(() => r(!!document.querySelector('#flow-hud .hud-why') && /Why this route/.test(document.querySelector('#flow-hud .hud-why').textContent)), 600)); }));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
