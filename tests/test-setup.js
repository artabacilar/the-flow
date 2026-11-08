/* Guided setup and the first successful workflow.
 *
 * What would make it wrong: a step marked done because a button was pressed
 * rather than because the thing happened (a model that never answered, a
 * channel whose reply never came); progress lost when the person leaves;
 * a provider shown without saying who bills and how; a tool listed that does
 * not exist here, or Gmail pretending to be connected; a first task that
 * changes something or whose result names no source; a readiness list that
 * says ready while an essential is missing; a key or channel that vanished
 * after setup going unnoticed. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const C = require('../flow-channels.js');
const S = require('../flow-setup.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 380) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body, headers) => fetch(H + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });

(async () => {
  console.log('\n— shapes —');
  ok('nine steps, in the order the brief gives them; only the inbox pass is optional', S.STEPS.join(',') === 'agent,provider,channel,delivery,tools,tour,first,inbox,ready' && S.STEPS.every((id) => S.TITLES[id]));
  ok('every provider has a billing note that says who bills, how, and where the limits are set', ['anthropic', 'openai', 'xai', 'deepseek'].every((p) => S.BILLING[p] && /account/.test(S.BILLING[p].how) && S.BILLING[p].limits && /^https:/.test(S.BILLING[p].url)));
  ok('the first-task options are read-only briefs that end with a source line; the inbox one needs Gmail', S.FIRST.length === 3 && S.FIRST.every((f) => /Change nothing/.test(f.brief) && /Source:/.test(f.brief)) && S.FIRST[0].needs === 'gmail' && S.FIRST.slice(1).every((f) => f.needs === 'flow'));
  ok('the tour covers the rooms that exist: chat, speak, team, work, memory, skills, automations, efficiency, channels, files', S.TOUR.map((t) => t.id).join(',') === 'console,speak,team,work,memory,skills,scripts,efficiency,channels,files');

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
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { const v = await fn(); if (v) return v; await wait(300); } return null; };
  await api('/api/team');
  const tgSecret = C._internals.telegramSecret();
  const sentNow = async () => (await fetch(H + '/api/channels/_sent').then((r) => r.json()).catch(() => null));
  const tg = async (chatId, text, name) => { const r = await post('/api/channels/telegram', { message: { chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: name || 'Artur' }, text } }, { 'x-telegram-bot-api-secret-token': tgSecret }); await wait(700); const s = await sentNow(); const rec = (s && s.recent) || []; return { status: r.status, text: rec.slice(-3).map((x) => String((x.body && x.body.text) || '')).join('\n---\n') }; };

  console.log('\n— nothing done yet —');
  const v0 = (await api('/api/team/setup')).j;
  ok('the setup opens at step 1 with nothing done, every step with a title and a note', v0.ok && v0.current === 'agent' && v0.progress.done === 0 && v0.progress.total === 9 && v0.steps.every((s) => s.title && typeof s.note === 'string') && !v0.completedAt, v0.progress);
  ok('the readiness list already exists and says what is missing, with the essentials apart from the soft items', v0.readyNow === false && v0.checklist.filter((c) => !c.soft).length === 5 && v0.checklist.every((c) => c.item && (c.ok || c.fix)), v0.checklist.map((c) => c.id + ':' + c.ok));
  ok('providers come with their billing notes; the two configured here have models, the other two say what to add', v0.facts.providers.length === 4 && v0.facts.providers.every((P) => P.billing && P.billing.how) && v0.facts.providers.filter((P) => P.configured).length === 2 && v0.facts.providers.filter((P) => !P.configured).every((P) => P.env && !P.models.length), v0.facts.providers.map((P) => P.id + ':' + P.configured));
  const gm = v0.facts.tools.find((t) => /gmail/i.test(t.name));
  ok('Gmail is in the tools as the essential that is not connected, honestly: needs a Google OAuth client that only the owner can create; never delete', gm && gm.essential && gm.status !== 'working' && /OAuth client/.test(gm.note) && /only you/.test(gm.note) && gm.caps.some((c) => /never delete/i.test(c)) && gm.env.indexOf('GOOGLE_CLIENT_ID') >= 0, gm);
  ok('every tool says what an agent may do with it here; nothing claims to be built that is not', v0.facts.tools.filter((t) => t.status === 'working').every((t) => t.caps && t.caps.length) && v0.facts.tools.filter((t) => t.kind === 'app' && t.id !== 'gmail').every((t) => t.status === 'not_built' || t.status === 'available'), v0.facts.tools.filter((t) => t.status === 'working').map((t) => t.id + ':' + (t.caps || []).length));
  ok('the inbox first task is offered but not runnable, with the reason; the two on the Flow record are ready', v0.facts.first[0].ready === false && /Gmail/.test(v0.facts.first[0].why) && v0.facts.first[1].ready && v0.facts.first[2].ready);

  console.log('\n— step by step, each saved as it is done —');
  const a1 = await api('/api/team/setup', { step: 'agent', name: 'Friday', role: 'chief of staff' });
  const v1 = (await api('/api/team/setup')).j;
  ok('naming the main agent saves it everywhere: the agent record, the assistant name, the step', a1.j.ok && v1.steps[0].status === 'done' && v1.facts.agent.name === 'Friday' && (await api('/api/team')).j.agents.find((a) => a.id === 'jarvis').name === 'Friday' && v1.current === 'provider', v1.steps[0]);
  const badP = await api('/api/team/setup', { step: 'provider', model: 'grok-4' });
  ok('a model from an unconfigured provider is refused with what to add, and nothing is marked done', badP.status === 400 && /xAI is not configured here: add XAI_API_KEY/.test(badP.j.error) && (await api('/api/team/setup')).j.steps[1].status === 'todo', badP.j);
  const use0 = JSON.stringify((await api('/api/team/usage')).j);
  const p1 = await api('/api/team/setup', { step: 'provider', model: 'gpt-5' });
  const v2 = (await api('/api/team/setup')).j;
  ok('a configured model is tested with a real call: the reply and the time are recorded, the agent uses it, the step is done', p1.j.ok && p1.j.test.provider === 'openai' && p1.j.test.model === 'gpt-5' && typeof p1.j.test.ms === 'number' && p1.j.test.reply && p1.j.billing && /OpenAI/.test(p1.j.billing.how) && v2.steps[1].status === 'done' && v2.facts.agent.model === 'gpt-5', p1.j);
  ok('…and the usage counted the test call', JSON.stringify((await api('/api/team/usage')).j) !== use0);
  ok('leaving and coming back: the setup is at step 3, with steps 1 and 2 still done', v2.current === 'channel' && v2.progress.done === 2);

  console.log('\n— pairing a channel, proven both ways —');
  const code = await api('/api/team/setup', { step: 'channel', op: 'code' });
  ok('a six-digit code for ten minutes', code.j.ok && /^\d{6}$/.test(code.j.code) && code.j.minutes === 10);
  const noTest = await api('/api/team/setup', { step: 'channel', op: 'test', channel: 'telegram' });
  ok('the test cannot be sent before the channel is linked', noTest.status === 400 && /not linked yet/.test(noTest.j.error));
  const r1 = await tg(77001, code.j.code);
  const v3 = (await api('/api/team/setup')).j;
  ok('the code sent from Telegram links it; the step is not done yet — linked is not the same as working both ways', r1.status === 200 && v3.facts.channels.find((c) => c.id === 'telegram').status === 'working' && v3.steps[2].status !== 'done' && /send the test/.test(v3.steps[2].note), v3.steps[2]);
  const s0 = await sentNow();
  const t1 = await api('/api/team/setup', { step: 'channel', op: 'test', channel: 'telegram' });
  const s1 = await sentNow();
  ok('the test sends one message through Telegram and waits', t1.j.ok && t1.j.waiting && t1.j.ping.channel === 'telegram' && !t1.j.ping.pong && s1.n === s0.n + 1 && /reply with anything/.test(JSON.stringify(s1.last)), { t1: t1.j, n: [s0.n, s1.n] });
  const st = await api('/api/team/setup', { step: 'channel', op: 'status' });
  ok('status says it is still waiting', st.j.ok && !st.j.done && st.j.ping && !st.j.ping.pong);
  const r2 = await tg(77001, 'ok here'); const r2t = r2.text;
  const v4 = (await api('/api/team/setup')).j;
  ok('the reply from the phone is the proof: the channel step is done with the round-trip time, and the person was told', v4.steps[2].status === 'done' && v4.steps[2].data.channel === 'telegram' && typeof v4.steps[2].data.pongMs === 'number' && v4.facts.ping.pong > 0 && /Confirmed: Telegram works both ways/.test(r2t), { st: v4.steps[2], r2t });
  const r3 = await tg(77001, '/setup'); const r3t = r3.text;
  ok('/setup in the chat shows the progress with ticks', /Setup · 3 of 9/.test(r3t) && /✓ 1\. Your main agent/.test(r3t) && /✓ 3\. Where you talk to him/.test(r3t) && /○ 4\./.test(r3t), r3t);

  console.log('\n— delivery, tools, tour —');
  const badD = await api('/api/team/setup', { step: 'delivery', where: 'whatsapp' });
  ok('a channel that is not linked cannot be the default', badD.status === 400);
  const d1 = await api('/api/team/setup', { step: 'delivery', where: 'telegram' });
  const dv = async () => { let v = (await api('/api/get?key=team:delivery')).j.value; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} } return v; };
  ok('Telegram becomes the default delivery channel', d1.j.ok && (await dv()) === 'telegram' && (await api('/api/team/setup')).j.steps[3].status === 'done');
  const r4 = await tg(77001, '/deliver'); const r4t = r4.text;
  ok('/deliver in a chat says where things go', /go to Telegram by default/.test(r4t), r4t);
  const r5 = await tg(77001, '/deliver app'); const r5t = r5.text;
  ok('/deliver app changes it and the setup step follows', /go to the app by default/.test(r5t) && (await api('/api/team/setup')).j.steps[3].data.where === 'app');
  await tg(77001, '/deliver here');
  ok('/deliver here makes this chat the default again', (await api('/api/team/setup')).j.steps[3].data.where === 'telegram');
  await api('/api/team/setup', { step: 'tools' });
  const tr1 = await api('/api/team/setup', { step: 'tour', seen: ['console', 'memory'] });
  ok('the tools are marked reviewed; a partial tour is saved but not done', (await api('/api/team/setup')).j.steps[4].status === 'done' && tr1.j.seen.length === 2 && (await api('/api/team/setup')).j.steps[5].status === 'todo' && (await api('/api/team/setup')).j.facts.tourSeen.join() === 'console,memory');
  await api('/api/team/setup', { step: 'tour' });
  ok('the whole tour marks the step done', (await api('/api/team/setup')).j.steps[5].status === 'done');

  console.log('\n— the first task: read-only, with its source —');
  const noGmail = await api('/api/team/setup', { step: 'first', which: 'inbox' });
  ok('the inbox task is refused honestly: Gmail is not connected, needs a Google OAuth client from the owner', noGmail.status === 409 && noGmail.j.needs === 'gmail' && /OAuth client/.test(noGmail.j.error) && /only you/.test(noGmail.j.error), noGmail.j);
  const n0 = (await api('/api/team')).j.approvals.length;
  const f1 = await api('/api/team/setup', { step: 'first', which: 'today', agent: 'bobby' });
  ok('the first task is created for the chosen specialist, read-only, from the setup', f1.j.ok && f1.j.task.agent === 'bobby' && f1.j.task.readOnly === true && f1.j.task.via === 'setup' && /Change nothing/.test(f1.j.task.brief), f1.j.task);
  const done1 = await until(async () => { const v = (await api('/api/team/setup')).j; return v.steps[6].status === 'done' ? v : null; }, 20000);
  ok('…it finishes; the step is done with the result, and nothing was raised for approval', done1 && done1.facts.firstTask.status === 'done' && done1.facts.firstTask.result && (await api('/api/team')).j.approvals.length === n0, done1 && done1.facts.firstTask);
  const rd = await api('/api/team/task', { agent: 'sarah', title: 'Read-only check', brief: 'Read-only: draft an email to the customer about the refund but change nothing', lang: 'en' });
  await api('/api/team/tasks'); /* no-op poll */
  const rdT = await until(async () => { const t = (await api('/api/team/tasks')).j.tasks.find((t) => t.id === rd.j.task.id); return t && /^(done|awaiting_approval)$/.test(t.status) ? t : null; });
  ok('(control) an ordinary task with an email proposal does raise an approval', rdT && (await api('/api/team')).j.approvals.length === n0 + 1, { rdT: rdT && rdT.status, n: (await api('/api/team')).j.approvals.length, n0 });
  const r6 = await tg(77001, '/setup first spend'); const r6t = r6.text;
  ok('from the paired chat, "/setup first spend" starts the spend task and says who is on it', /Started the first task: "Read this month's spend/.test(r6t) && /read-only/.test(r6t), r6t);
  const done2 = await until(async () => { const v = (await api('/api/team/setup')).j; return v.facts.firstTask && v.facts.firstTask.via === 'telegram' && v.facts.firstTask.status === 'done' ? v : null; }, 20000);
  ok('…it runs and the result goes to the default channel', done2 && done2.facts.firstTask.via === 'telegram' && (await sentNow()).n > s1.n, done2 && done2.facts.firstTask);

  console.log('\n— inbox pass and readiness —');
  const ib = await api('/api/team/setup', { step: 'inbox', op: 'run' });
  ok('the inbox workflow waits for Gmail but shows its plan: scope, rules that never delete, read-only first, the report', ib.status === 409 && ib.j.needs === 'gmail' && ib.j.plan && ib.j.plan.readOnlyFirst && ib.j.plan.rules.some((r) => /Nothing is deleted/.test(r)) && ib.j.plan.report.length === 4, ib.j);
  const v5 = (await api('/api/team/setup')).j;
  ok('before the inbox step is decided: every essential is in place, ready now, Gmail and the inbox listed as soft', v5.readyNow && v5.checklist.filter((c) => !c.soft).every((c) => c.ok) && v5.checklist.find((c) => c.id === 'gmail').ok === false && v5.checklist.find((c) => c.id === 'gmail').soft, v5.checklist);
  await api('/api/team/setup', { step: 'inbox', op: 'skip' });
  ok('the inbox pass can be skipped and brought back', (await api('/api/team/setup')).j.steps[7].status === 'skipped' && (await api('/api/team/setup', { step: 'inbox', op: 'unskip' })).j.ok && (await api('/api/team/setup')).j.steps[7].status === 'todo');
  await api('/api/team/setup', { step: 'inbox', op: 'skip' });
  const fin = await api('/api/team/setup', { step: 'ready', op: 'finish' });
  const v6 = (await api('/api/team/setup')).j;
  ok('finishing records the date; next steps name what would make it better (Gmail OAuth, a second provider, the first skill, the briefing)', fin.j.ok && v6.completedAt && v6.steps[8].status === 'done' && v6.progress.done === 9 && v6.nextSteps.some((n) => /Google OAuth/.test(n)) && v6.nextSteps.some((n) => /briefing/.test(n)), v6.nextSteps);
  ok('the log tells the story', (await api('/api/team')).j.log.some((l) => /Setup complete/.test(l.what)) && (await api('/api/team')).j.log.some((l) => /answered the test call/.test(l.what)));

  console.log('\n— recovery —');
  await p.evaluate(async () => { let L = (await Flow.DB.get('team:agents', null)); if (typeof L === 'string') L = JSON.parse(L); L.find((a) => a.id === 'jarvis').model = 'grok-4'; await Flow.DB.set('team:agents', L); });
  const v7 = (await api('/api/team/setup')).j;
  ok('the model switched to one with no key here: the provider step turns to "needs attention" with the reason and is the current step; the checklist says so', v7.steps[1].status === 'attention' && /no longer available/.test(v7.steps[1].note) && v7.current === 'provider' && v7.checklist.find((c) => c.id === 'provider').ok === false && v7.readyNow === false, v7.steps[1]);
  await api('/api/team/setup', { step: 'provider', model: 'claude-sonnet-4-5' });
  ok('choosing again and testing repairs it', (await api('/api/team/setup')).j.steps[1].status === 'done' && (await api('/api/team/setup')).j.readyNow);
  await api('/api/channels/me/unlink', { channel: 'telegram' });
  const v8 = (await api('/api/team/setup')).j;
  ok('unlinking the channel: the channel step and the delivery step both need attention, and say why', v8.steps[2].status === 'attention' && /no longer linked/.test(v8.steps[2].note) && v8.steps[3].status === 'attention' && /not linked any more/.test(v8.steps[3].note), [v8.steps[2], v8.steps[3]]);
  const code2 = (await api('/api/team/setup', { step: 'channel', op: 'code' })).j.code; await tg(77001, code2); await wait(500);
  await api('/api/team/setup', { step: 'channel', op: 'test', channel: 'telegram' }); await tg(77001, 'back'); await wait(500);
  await api('/api/team/setup', { step: 'delivery', where: 'telegram' });
  ok('linking again and replying repairs both', (await api('/api/team/setup')).j.steps[2].status === 'done' && (await api('/api/team/setup')).j.steps[3].status === 'done');
  const notFin = await api('/api/team/setup', { step: 'ready', op: 'reset' });
  const v9 = (await api('/api/team/setup')).j;
  ok('start over clears the steps and nothing else: the agent, model, channel link and tasks are all still there', notFin.j.reset && v9.progress.done === 0 && v9.facts.agent.name === 'Friday' && v9.facts.channels.find((c) => c.id === 'telegram').status === 'working' && (await api('/api/team/tasks')).j.tasks.length >= 3);
  const notReady = await api('/api/team/setup', { step: 'ready', op: 'finish' });
  ok('finish refuses while essentials are missing and names them', notReady.status === 409 && /Not yet: Main agent named/.test(notReady.j.error), notReady.j);

  console.log('\n— the workspace —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1500);
  ok('the strip has a Setup button showing the progress, and J.A.R.V.I.S.\'s view nudges to start', await p.evaluate(() => { const b = document.querySelector('#flow-hud .hud-ag[data-hud="setup"]'); return !!b && /0 of 9/.test(b.textContent) && !!document.querySelector('#flow-hud [data-k="sunudge"] [data-hud="sustep"]'); }));
  await p.click('#flow-hud [data-k="sunudge"] [data-hud="sustep"]', { timeout: 5000 }).catch(() => p.click('#flow-hud .hud-ag[data-hud="setup"]')); await p.waitForTimeout(1200);
  const ws = await p.evaluate(() => ({ title: document.querySelector('#flow-hud .hud-brand b').textContent, steps: document.querySelectorAll('#flow-hud [data-k="susteps"] .hud-mi').length, panel: (document.querySelector('#flow-hud [data-k="sustep"] .hud-ph') || {}).textContent, form: !!document.querySelector('#flow-hud form[data-team="suagent"] input[name="name"]'), prog: (document.querySelector('#flow-hud [data-k="suprog"] .hud-big') || {}).textContent }));
  ok('the Setup workspace: nine steps on the left, progress, and step 1 open with the name form', ws.title === 'Setup' && ws.steps === 9 && /1 · Your main agent/.test(ws.panel) && ws.form && /0/.test(ws.prog), ws);
  await p.fill('#flow-hud form[data-team="suagent"] input[name="name"]', 'J.A.R.V.I.S.');
  await p.click('#flow-hud form[data-team="suagent"] button[type="submit"]'); await p.waitForTimeout(1200);
  const ws2 = await p.evaluate(() => ({ panel: (document.querySelector('#flow-hud [data-k="sustep"] .hud-ph') || {}).textContent, done: document.querySelectorAll('#flow-hud [data-k="susteps"] .hud-mi.old').length, billing: /Billing:/.test(document.querySelector('#flow-hud [data-k="sustep"]').innerText), awaiting: /awaiting configuration — add XAI_API_KEY/.test(document.querySelector('#flow-hud [data-k="sustep"]').innerText), test: !!document.querySelector('#flow-hud form[data-team="suprovider"] button[type="submit"]') }));
  ok('saving the name moves to step 2: the provider list with billing notes, the unconfigured ones say what to add, and a Test button', /2 · The model/.test(ws2.panel) && ws2.done === 1 && ws2.billing && ws2.awaiting && ws2.test, ws2);
  await p.click('#flow-hud form[data-team="suprovider"] button[type="submit"]'); await p.waitForTimeout(2500);
  const ws3 = await p.evaluate(() => ({ t: document.querySelector('#flow-hud [data-k="sustep"]').innerText, old: document.querySelectorAll('#flow-hud [data-k="susteps"] .hud-mi.old').length }));
  ok('the test from the workspace records the answer time and marks the step done', /Last test: [\s\S]* answered [\s\S]* in \d+ ms/.test(ws3.t) && ws3.old === 2, ws3);
  await p.click('#flow-hud [data-hud="sustep"][data-id="channel"]'); await p.waitForTimeout(500);
  ok('the channel step shows the states and, since Telegram is linked, the Send-the-test button', await p.evaluate(() => { const t = document.querySelector('#flow-hud [data-k="sustep"]').innerText; return /States:/.test(t) && !!document.querySelector('#flow-hud [data-hud="sutest"][data-ch="telegram"]'); }));
  await p.click('#flow-hud [data-hud="sustep"][data-id="tools"]'); await p.waitForTimeout(500);
  await p.click('#flow-hud [data-hud="sutool"][data-id="gmail"]'); await p.waitForTimeout(300);
  ok('the tools step lists Gmail first as the essential, opens to what it would be allowed to do and what the server needs', await p.evaluate(() => { const c = document.querySelector('#flow-hud [data-k="sustep"] .hud-mi.open'); return !!c && /Gmail/.test(c.innerText) && /never delete/i.test(c.innerText) && /GOOGLE_CLIENT_ID/.test(c.innerText); }));
  await p.click('#flow-hud [data-hud="sustep"][data-id="first"]'); await p.waitForTimeout(500);
  ok('the first-task step offers the three tasks, the inbox one disabled with its reason, and the last run with its result', await p.evaluate(() => { const t = document.querySelector('#flow-hud [data-k="sustep"]'); const inbox = t.querySelector('input[name="which"][value="inbox"]'); return !!inbox && inbox.disabled && /Needs Gmail/.test(t.innerText) && /names its source/.test(t.innerText); }));
  await p.click('#flow-hud [data-hud="sustep"][data-id="ready"]'); await p.waitForTimeout(500);
  ok('the readiness step lists the checklist with Fix buttons, next steps and recovery, and Finish disabled while essentials are missing', await p.evaluate(() => { const t = document.querySelector('#flow-hud [data-k="sustep"]'); const fin = t.querySelector('[data-hud="sufinish"]'); return !!fin && fin.disabled && t.querySelectorAll('[data-hud="sustep"]').length >= 2 && /Next steps/.test(t.innerText) && /If something breaks later/.test(t.innerText); }));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
