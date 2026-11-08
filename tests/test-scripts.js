/* Reliable automation with scripts.
 *
 * What would make it wrong: a model asked to launch a routine job or to word
 * a fixed notification; a script that is code the model wrote and the server
 * ran; a scheduled run that did not happen, or happened twice; a wrong input
 * that fails halfway instead of before the start; a resumed batch that sends
 * what it already sent; an email that goes before the person's yes; a
 * partial result reported as success; a run without its trigger, timezone,
 * version, inputs, counts and cost; a script that breaks when the model
 * changes; or a skill that redoes by hand what a tested script does. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const S = require('../flow-scripts.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 380) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n— shapes —');
  const v1 = S.validateInputs([{ name: 'min', type: 'number', default: 300 }, { name: 'page', type: 'url' }], { min: 'lots', page: 'nope' });
  ok('inputs are checked before anything runs, with the reason in words', v1.errors.length === 2 && /"min" must be a number/.test(v1.errors[0]) && /"page" must be a web address/.test(v1.errors[1]), v1.errors);
  ok('a default fills a missing input; a good value passes', S.validateInputs([{ name: 'min', type: 'number', default: 300 }], {}).inputs.min === 300 && S.validateInputs([{ name: 'page', type: 'url' }], { page: 'https://x.y/z' }).errors.length === 0);
  ok('values render into templates; numbers in any common format compare as numbers', S.render('{{inputs.name}}: {{item.amount}} / {{count}}', { inputs: { name: 'A' }, item: { amount: 12.345 }, count: 3 }) === 'A: 12.35 / 3' && S.cmp('$1,250', '>', 1000) && S.cmp('1.250,50', '>', 1000) && S.cmp('12,5', '<', 13));
  const ex = S.explain(S.cleanDoc({ name: 'x', steps: [{ op: 'flow.expenses', period: 'this month' }, { op: 'filter', field: 'amount', cmp: '>', value: '{{inputs.min}}' }, { op: 'email.batch', to: 'a@b.c', subject: 's', body: 'b' }, { op: 'jarvis.review', agent: 'bobby', brief: 'look' }], inputs: [{ name: 'min', type: 'number', default: 300 }] }), { email: false });
  ok('the explanation says what it does, its inputs and services, what it affects, when it stops, and what is left to judgment', /min \(number/.test(ex.inputs[0]) && ex.services.some((s) => /Email via Resend — not connected/.test(s)) && /emails leave after your yes/.test(ex.affects[0]) && ex.stops.some((s) => /waiting for your yes/.test(s)) && /bobby judges/.test(ex.judgment[0]) && /only when exceptions/.test(ex.modelCalls), ex);
  const sc = { schedule: { kind: 'daily', at: '08:00' }, status: 'active' };
  ok('a daily schedule is due once in its window and never twice on the same day', S.due(sc, { date: '2026-11-08', hhmm: '08:03', minutes: 483, day: 6 }, null) === '2026-11-08' && S.due(sc, { date: '2026-11-08', hhmm: '08:03', minutes: 483, day: 6 }, '2026-11-08') === null && S.due(sc, { date: '2026-11-08', hhmm: '09:00', minutes: 540, day: 6 }, null) === null);
  ok('weekdays skip the weekend; a paused script is never due', S.due({ schedule: { kind: 'weekdays', at: '08:00' }, status: 'active' }, { date: '2026-11-08', hhmm: '08:01', minutes: 481, day: 6 }, null) === null && S.due({ schedule: { kind: 'daily', at: '08:00' }, status: 'paused' }, { date: '2026-11-08', hhmm: '08:01', minutes: 481, day: 6 }, null) === null);
  const dr = S.draftFromTask({ title: 'Weekly spend check', brief: 'Every Monday total last week\'s spend by category from https://bank.example.com/export and tell me if anything is unusual', steps: [{ agent: 'finance', title: 'Total it', brief: 'Sum the expenses', status: 'done', result: '…' }] }, []);
  ok('a finished task is drafted into a pipeline: the routine part as steps, the changing page as an input, a schedule from "every Monday", the judgment left to an agent', dr.steps.some((s) => s.op === 'flow.expenses') && dr.steps.some((s) => s.op === 'compute') && dr.steps.some((s) => s.op === 'report') && dr.inputs.some((i) => i.name === 'page' && i.type === 'url') && dr.steps.some((s) => s.op === 'web.read' && s.url === '{{inputs.page}}') && dr.schedule && dr.schedule.kind === 'weekly' && dr.steps.some((s) => s.op === 'jarvis.review') && /judgment is handed over/.test(dr.judgment), dr);

  console.log('\n— resume without repeating (engine, in memory) —');
  const store = {}; const mctx = { get: async (k) => store[k] === undefined ? null : JSON.parse(JSON.stringify(store[k])), set: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, user: { id: 'u1', name: 'T' } };
  store['flow:expenses'] = [{ date: '2026-11-03', amount: 100, merchant: 'A' }, { date: '2026-11-05', amount: 200, merchant: 'B' }, { date: '2026-11-06', amount: 300, merchant: 'C' }].map((x) => Object.assign(x, { date: new Date().toISOString().slice(0, 8) + x.date.slice(8) }));
  const sent = []; let fails = (to) => /B@/.test(to);
  const mdeps = { userTz: async () => 'UTC', localParts: (tz, d) => ({ date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), day: (d.getUTCDay() + 6) % 7 }), tools: () => ({ web: true, email: true }), log: async () => {}, sendEmail: async (c, m) => { sent.push(m.to); return fails(m.to) ? { ok: false, error: 'bounced' } : { ok: true }; }, askApproval: async () => ({ id: 'ap1' }), paused: async () => false, tasks: async () => [], agents: async () => [] };
  const mc = await S.create(mctx, mdeps, { doc: { name: 'Batch', steps: [{ op: 'flow.expenses', period: 'this month' }, { op: 'email.batch', to: '{{item.merchant}}@example.com', subject: 'Re {{item.amount}}', body: 'hi' }, { op: 'report', template: 'done' }] } });
  const r1 = await S.startRun(mctx, mdeps, mc.script, { uid: 'u1' });
  ok('a batch stops before sending and asks for one yes with the count', r1.status === 'awaiting_approval' && r1.await.count === 3 && sent.length === 0, r1.await);
  const r2 = await S.onApproval(mctx, mdeps, { id: 'ap1' }, 'approve');
  ok('after the yes: each recipient once; one bounce makes the run partial, not "sent"', r2.status === 'partial' && sent.length === 3 && /2 sent · 1 failed/.test(r2.steps[1].note) && /Partly done/.test(r2.error), { st: r2.status, note: r2.steps[1].note });
  /* the server restarts mid-run: the step is re-run from the saved record */
  r2.status = 'running'; r2.steps[1].status = 'queued'; r2.steps[2].status = 'queued'; r2.doneKeys[Object.keys(r2.doneKeys).find((k) => r2.doneKeys[k] === 'failed')] = 'pending';
  await mctx.set('team:scriptruns', (await S.runs(mctx)).map((r) => r.id === r2.id ? r2 : r));
  const r3 = await S.resumeRun(mctx, mdeps, r2.id);
  ok('resumed: the two that went are not repeated; the one whose outcome was unknown is reported uncertain, not re-sent', sent.length === 3 && /2 already sent earlier \(not repeated\)/.test(r3.steps[1].note) && /1 uncertain \(not re-sent/.test(r3.steps[1].note), { note: r3.steps[1].note, sent });
  const r4 = await S.startRun(mctx, mdeps, mc.script, { uid: 'u1' }); const r5 = await S.onApproval(mctx, mdeps, { id: 'ap1' }, 'reject');
  ok('a no cancels the run and nothing goes', r4.status === 'awaiting_approval' && r5.status === 'cancelled' && sent.length === 3);

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  const today = new Date().toISOString().slice(0, 10), ym = today.slice(0, 8);
  await p.evaluate(async ([ym, wid]) => {
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); await Flow.Settings.set('timezone', 'UTC');
    await Flow.DB.set('flow:expenses', [{ date: ym + '03', amount: '1,250', currency: 'TRY', merchant: 'Migros', category: 'food' }, { date: ym + '05', amount: 400, currency: 'TRY', merchant: 'Shell', category: 'car' }, { date: ym + '06', amount: 90, currency: 'TRY', merchant: 'Starbucks', category: 'food' }, { date: '2025-01-01', amount: 999, currency: 'TRY', merchant: 'old', category: 'x' }]);
    const c = (await Flow.DB.get('ld_compass', null)) || { mission: '', roles: [], rocks: {}, saw: {}, reviews: {} }; c.rocks = c.rocks || {}; c.rocks[wid] = [{ id: 'rk1', title: 'Auto: send the invoices', day: 0, time: '', prio: 'med', done: false }, { id: 'rk2', title: 'Call the venue', day: 1, time: '10:00', prio: 'high', done: false }]; await Flow.DB.set('ld_compass', c);
  }, [ym, S.weekId(new Date())]);
  await p.waitForTimeout(1000);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { const v = await fn(); if (v) return v; await wait(300); } return null; };
  const task = async (id) => (await api('/api/team/tasks')).j.tasks.find((t) => t.id === id);
  const settled = (id) => until(async () => { const t = await task(id); return t && /^(done|awaiting_approval|awaiting_info|failed)$/.test(t.status) ? t : null; });
  await api('/api/team');

  console.log('\n— a scheduled data task, no model —');
  const c1 = await api('/api/team/scripts', { op: 'create', doc: { name: 'Spend by category', purpose: 'Total this month\'s expenses by category and flag the big ones', inputs: [{ name: 'min', label: 'Flag above', type: 'number', default: 300 }], steps: [{ op: 'flow.expenses', period: 'this month', as: 'all' }, { op: 'compute', field: 'amount', by: 'category' }, { op: 'format', template: '· {{item.group}}: {{item.sum}} TRY ({{item.count}})' }, { op: 'report', template: 'Spend {{today}}\n{{text}}\nTotal {{totals.sum}}' }, { op: 'filter', from: 'all', field: 'amount', cmp: '>', value: '{{inputs.min}}' }, { op: 'notify', template: '{{count}} big expenses this month', when: 'only if items' }], schedule: { kind: 'daily', at: '08:00' } } });
  const A = c1.j.script;
  ok('an automation is created: v1, active, untested, with an explanation that says it needs no model', c1.j.ok && A.version === 1 && A.status === 'active' && c1.j.explanation.modelCalls === 'none' && c1.j.explanation.services.some((s) => /linked channels/.test(s)), c1.j);
  const L0 = (await api('/api/team/scripts')).j;
  ok('the workspace lists it with its schedule in my time zone and marks it untested', L0.items.some((s) => s.id === A.id && s.untested && /every day at 08:00/.test(s.next)) && L0.tz === 'UTC', L0.items.map((s) => s.next));
  const bad = await api('/api/team/scripts', { op: 'run', id: A.id, inputs: { min: 'lots' } });
  ok('an invalid input stops it before it starts, with the reason', bad.j.ok && bad.j.run.status === 'invalid' && /Not started: "min" must be a number/.test(bad.j.run.error) && bad.j.run.steps === undefined, bad.j.run);
  const use0 = (await api('/api/team/usage')).j;
  const dry = await api('/api/team/scripts', { op: 'test', id: A.id, inputs: {} });
  ok('a test run reads and computes for real but sends nothing: each step says what it would do', dry.j.ok && dry.j.run.status === 'ok' && dry.j.run.dry && /would notify/.test(dry.j.run.steps[5].note) && /food: 1340/.test(dry.j.run.output) && !dry.j.run.metrics.external.notifications, dry.j.run.steps.map((s) => s.note));
  ok('…a passing test marks the version tested', dry.j.script.tested === 1 && (await api('/api/team/scripts')).j.items.find((s) => s.id === A.id).untested === false);
  const run = await api('/api/team/scripts', { op: 'run', id: A.id, inputs: { min: 300 } });
  const R = run.j.run;
  ok('a fixed input gives the expected transformation: food 1340 (2), car 400 (1), total 1740', R.status === 'ok' && /food: 1340 TRY \(2\)/.test(R.output) && /car: 400 TRY \(1\)/.test(R.output) && /Total 1740/.test(R.output), R.output);
  ok('the run records trigger, timezone, version, inputs, per-step counts and timings, zero model calls, and a cost line that separates AI from hosting and services', R.trigger === 'manual' && R.tz === 'UTC' && R.version === 1 && R.inputs.min === 300 && R.steps.every((s) => s.status === 'done' && typeof s.ms === 'number') && R.metrics.modelCalls === 0 && /\$0\.00 — no model call/.test(R.cost.ai) && /included/.test(R.cost.hosting) && R.cost.services.some((s) => /notification/.test(s)), { m: R.metrics, c: R.cost });
  const use1 = (await api('/api/team/usage')).j;
  ok('no agent\'s usage moved: the model was not asked', JSON.stringify(use0.agents || use0.month || use0) === JSON.stringify(use1.agents || use1.month || use1));
  const at = today + 'T08:02:00Z';
  const t1 = await api('/api/team/_tick?at=' + encodeURIComponent(at)); const t2 = await api('/api/team/_tick?at=' + encodeURIComponent(at));
  const L1 = (await api('/api/team/scripts?script=' + A.id)).j;
  ok('the minute tick runs it once at 08:00 in my time zone and not again that day; the run says it was the schedule', t1.j.scripts === 1 && t2.j.scripts === 0 && L1.runs.some((r) => /^schedule daily 08:00 UTC/.test(r.trigger) && r.status === 'ok' && r.metrics.modelCalls === 0), { t1: t1.j.scripts, t2: t2.j.scripts, trig: L1.runs.map((r) => r.trigger) });
  await api('/api/team/scripts', { op: 'status', id: A.id, status: 'paused' });
  const t3 = await api('/api/team/_tick?at=' + encodeURIComponent(today + 'T08:04:00Z'));
  ok('paused: the schedule does not fire', t3.j.scripts === 0);
  await api('/api/team/scripts', { op: 'status', id: A.id, status: 'active' });

  console.log('\n— events, judgment, records —');
  const c2 = await api('/api/team/scripts', { op: 'create', doc: { name: 'Big spend review', steps: [{ op: 'flow.expenses', period: 'this month' }, { op: 'filter', field: 'amount', cmp: '>', value: '1000' }, { op: 'jarvis.review', agent: 'bobby', brief: 'These expenses are above the threshold. Say which need a word.', when: 'only if items' }, { op: 'report', template: '{{count}} above threshold' }], triggers: [{ event: 'task.done', match: 'Weekly' }] } });
  const B = c2.j.script;
  const r2a = await api('/api/team/scripts', { op: 'run', id: B.id });
  const review = (await api('/api/team/tasks')).j.tasks.find((t) => /Review from automation: Big spend review/.test(t.title));
  ok('a combined workflow: the script collects and filters, and hands the one exception to an agent as a task — the only model call', r2a.j.run.status === 'ok' && r2a.j.run.metrics.modelCalls === 1 && review && review.agent === 'bobby' && /Migros/.test(review.brief), r2a.j.run.steps.map((s) => s.note));
  const RV = await settled(review.id);
  ok('…and the agent completes it, with the automation named as its origin', RV && RV.status === 'done' && RV.from && RV.from.script === B.id, RV && RV.from);
  const tw = (await api('/api/team/task', { agent: 'tom', title: 'Weekly numbers', brief: 'Put together the weekly numbers', lang: 'en' })).j.task;
  await settled(tw.id); await wait(800);
  const L2 = (await api('/api/team/scripts?script=' + B.id)).j;
  ok('an event trigger: a finished task whose title matches starts the automation', L2.runs.some((r) => /^event task\.done ~ Weekly/.test(r.trigger)), L2.runs.map((r) => r.trigger));
  const c3 = await api('/api/team/scripts', { op: 'create', doc: { name: 'Tick the auto rocks', steps: [{ op: 'flow.rocks', period: 'this week', only: 'open' }, { op: 'filter', field: 'title', cmp: 'contains', value: 'Auto:' }, { op: 'record.update', set: 'done' }, { op: 'report', template: '{{count}} rock(s) ticked' }] } });
  const r3a = await api('/api/team/scripts', { op: 'test', id: c3.j.script.id });
  const comp0 = (await api('/api/get?key=ld_compass')).j.value;
  ok('a dry run of a record update changes nothing', r3a.j.run.status === 'ok' && /would set done on 1 rock/.test(r3a.j.run.steps[2].note) && !(JSON.stringify(comp0).indexOf('"done":true') >= 0), r3a.j.run.steps[2].note);
  const r3b = await api('/api/team/scripts', { op: 'run', id: c3.j.script.id });
  let comp1 = (await api('/api/get?key=ld_compass')).j.value; if (typeof comp1 === 'string') { try { comp1 = JSON.parse(comp1); } catch (e) {} } const rocks = Object.values((comp1 && comp1.rocks) || {}).flat();
  ok('the real run updates exactly the rock the rule names and leaves the other alone', r3b.j.run.status === 'ok' && /1 rock set done/.test(r3b.j.run.steps[2].note) && rocks.some((r) => r.id === 'rk1' && r.done === true) && rocks.some((r) => r.id === 'rk2' && r.done === false), rocks);

  console.log('\n— a batch that waits for a yes —');
  const mail0 = (await api('/api/team/_mail')).j;
  const c4 = await api('/api/team/scripts', { op: 'create', doc: { name: 'Receipt reminders', steps: [{ op: 'flow.expenses', period: 'this month' }, { op: 'email.batch', to: '{{item.merchant}}@example.com', subject: 'Receipt for {{item.amount}} {{item.currency}}', body: 'Hello {{item.merchant}}, please send the receipt for {{item.amount}}.' }, { op: 'report', template: 'Reminders done' }] } });
  const r4a = await api('/api/team/scripts', { op: 'run', id: c4.j.script.id });
  const ap = (await api('/api/team')).j.approvals.find((x) => x.kind === 'batch');
  ok('the run parks with one approval showing recipients, content and count; nothing has gone', r4a.j.run.status === 'awaiting_approval' && ap && ap.detail.count === 3 && /3 recipients: Migros@example.com/.test(ap.detail.to) && /Hello Migros/.test(ap.detail.body) && (await api('/api/team/_mail')).j.n === mail0.n, ap);
  const yes = await api('/api/team/approve', { id: ap.id, decision: 'approve' });
  const mail1 = (await api('/api/team/_mail')).j;
  ok('the yes releases the script: three emails, once each, and the approval says so', yes.j.ok && yes.j.run && yes.j.run.status === 'ok' && mail1.n === mail0.n + 3 && /Sent\./.test(yes.j.approval.note), { note: yes.j.approval.note, st: yes.j.run && yes.j.run.status });
  const r4b = await api('/api/team/scripts', { op: 'run', id: c4.j.script.id });
  const ap2 = (await api('/api/team')).j.approvals.find((x) => x.kind === 'batch' && x.status === 'pending');
  const no = await api('/api/team/approve', { id: ap2.id, decision: 'reject' });
  ok('a no cancels the run and nothing goes', no.j.ok && no.j.run.status === 'cancelled' && (await api('/api/team/_mail')).j.n === mail1.n);
  const r4c = await api('/api/team/scripts', { op: 'run', id: c4.j.script.id });
  const cx = await api('/api/team/scripts', { op: 'cancel', id: r4c.j.run.id });
  ok('a parked run can be cancelled; its approval is withdrawn', cx.j.ok && cx.j.run.status === 'cancelled' && !(await api('/api/team')).j.approvals.some((x) => x.kind === 'batch' && x.status === 'pending'));

  console.log('\n— with the team, and without the model —');
  const dg = await api('/api/team/delegate', { text: 'Run the Spend by category automation for me', lang: 'en' });
  const T = dg.j.task && await settled(dg.j.task.id);
  ok('J.A.R.V.I.S. plans a step as a script: it runs with no model, and the step says so', T && T.status === 'done' && T.steps[0].script === A.id && T.steps[0].model === 'script' && T.steps[0].run && T.steps[0].run.status === 'ok' && /food: 1340/.test(T.result), T && T.steps[0]);
  ok('the activity log says the automation ran with no model call', (await api('/api/team')).j.log.some((l) => /Running the automation "Spend by category" v1 .* no model call/.test(l.what)));
  await api('/api/team/agent/update', { id: 'jarvis', model: 'gpt-5' });
  const run2 = await api('/api/team/scripts', { op: 'run', id: A.id, inputs: { min: 300 } });
  ok('switching J.A.R.V.I.S.\'s model changes nothing about the automation', run2.j.run.status === 'ok' && run2.j.run.output === R.output.replace(/Spend \d{4}-\d{2}-\d{2}/, 'Spend ' + today) && run2.j.run.metrics.modelCalls === 0);
  await api('/api/team/agent/update', { id: 'jarvis', model: 'claude-sonnet-4-5' });
  const sk = await api('/api/team/skills', { op: 'create', text: 'Monthly spend report\nWhen asked for the spend report: run the automation, then explain the biggest category in one paragraph. If the automation fails, say so and list what you can.', agents: ['bobby'] });
  const skUp = await api('/api/team/skills', { op: 'update', id: sk.j.skill.id, doc: { scripts: [{ id: A.id, when: 'every spend report', inputs: 'min = 300 unless told otherwise', success: 'totals per category', errors: 'say the numbers are unavailable' }] } });
  ok('a skill can reference a tested automation with when / inputs / success / errors', skUp.j.ok && skUp.j.skill.scripts.length === 1 && skUp.j.skill.scripts[0].id === A.id, skUp.j.skill && skUp.j.skill.scripts);
  const ts = (await api('/api/team/task', { agent: 'bobby', title: 'Monthly spend report', brief: 'Give me the monthly spend report please', lang: 'en' })).j.task;
  const TS = await settled(ts.id);
  ok('following that skill, the agent runs the automation instead of redoing the routine part, and reports its result', TS && TS.status === 'done' && TS.steps[0].skill && TS.steps[0].run && TS.steps[0].run.script === A.id && /used the automation: Spend/.test(TS.result), TS && { run: TS.steps[0].run, result: TS.result });

  console.log('\n— versions —');
  const up = await api('/api/team/scripts', { op: 'update', id: A.id, doc: { purpose: 'Total this month\'s expenses by category, flag the big ones, keep it short' }, why: 'wording' });
  ok('an edit is a new version, untested until a dry run passes; the old one is kept', up.j.ok && up.j.script.version === 2 && up.j.script.versions.length === 1 && (await api('/api/team/scripts')).j.items.find((s) => s.id === A.id).untested === true);
  const rb = await api('/api/team/scripts', { op: 'rollback', id: A.id, to: 1 });
  ok('rollback restores v1 as a new version', rb.j.ok && rb.j.restored === 1 && rb.j.script.version === 3 && /flag the big ones$/.test(rb.j.script.purpose));
  const fromTask = await api('/api/team/scripts', { op: 'create', from: 'task', task: tw.id });
  ok('a finished task becomes an automation with its explanation', fromTask.j.ok && fromTask.j.script.from.task === tw.id && fromTask.j.explanation && fromTask.j.explanation.does, fromTask.j);

  console.log('\n— the workspace —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  ok('the strip has an Automations button', await p.evaluate(() => !!document.querySelector('#flow-hud .hud-ag[data-hud="scripts"]')));
  await p.click('#flow-hud .hud-ag[data-hud="scripts"]'); await p.waitForTimeout(1500);
  const ws = await p.evaluate(() => ({ title: document.querySelector('#flow-hud .hud-brand b').textContent, rows: document.querySelectorAll('#flow-hud [data-k="sclist"] .hud-mi').length, runs: document.querySelectorAll('#flow-hud [data-k="scruns"] .hud-mi').length, build: !!document.querySelector('#flow-hud [data-hud="scnew"]') }));
  ok('the Automations workspace lists them with their runs and a Build button', ws.title === 'Automations' && ws.rows >= 4 && ws.runs >= 3 && ws.build, ws);
  await p.click('#flow-hud .hud-mih[data-id="' + A.id + '"]'); await p.waitForTimeout(600);
  const det = await p.evaluate(() => ({ txt: document.querySelector('#flow-hud [data-k="scview"]').innerText, steps: document.querySelectorAll('#flow-hud .hud-scsteps li').length, test: !!document.querySelector('#flow-hud form[data-team="scrun"] button[value="test"]'), run: !!document.querySelector('#flow-hud form[data-team="scrun"] button[value="run"]'), pause: !!document.querySelector('#flow-hud [data-hud="scstatus"][data-st="paused"]') }));
  ok('opening one shows what it does, inputs, services, what it affects, when it stops and what is left to judgment, the steps, Test and Run, Pause', /WHAT IT DOES/i.test(det.txt) && /STOPS WHEN/i.test(det.txt) && /JUDGMENT/i.test(det.txt) && det.steps === 6 && det.test && det.run && det.pause, det);
  await p.click('#flow-hud form[data-team="scrun"] button[value="test"]'); await p.waitForTimeout(2500);
  ok('Test from the workspace adds a run and opens it with its steps, output and cost', await p.evaluate(() => { const r = document.querySelector('#flow-hud [data-k="scruns"] .hud-mi.open'); return !!r && /test/.test(r.innerText) && /Cost:/.test(r.innerText) && document.querySelectorAll('#flow-hud [data-k="scruns"] .hud-mi.open .hud-step').length === 6; }));
  await p.click('#flow-hud [data-hud="scedit"]'); await p.waitForTimeout(500);
  ok('Edit shows every step as a form of its own fields, with add / move / remove', await p.evaluate(() => document.querySelectorAll('#flow-hud .hud-scstep').length === 6 && !!document.querySelector('#flow-hud [data-hud="scaddstep"]') && !!document.querySelector('#flow-hud select[name="skind"]')));
  await p.evaluate(() => { FlowTeam.openId = null; });
  await p.click('#flow-hud .hud-ag[data-ag="jarvis"]').catch(() => {}); await p.waitForTimeout(500);
  await p.fill('#sy-text', 'Turn the repeatable parts of this workflow into an automation');
  await p.click('[data-say="send"]'); await p.waitForTimeout(2500);
  const said = await p.evaluate(() => ((FlowSay.history || []).slice(-1)[0] || {}).text || '');
  ok('"Turn the repeatable parts of this workflow into an automation" writes the last finished task up as a script, explains it, and opens it', /is an automation now, version 1\. It /.test(said) && /Inputs:/.test(said) && /It stops when/.test(said) && await p.evaluate(() => FlowTeam.sel === 'scripts' && !!document.querySelector('#flow-hud [data-k="scview"]')), said);
  ok('the task view shows the automation chip on a script step', await p.evaluate(async (id) => { await FlowTeam.openTask(id); await new Promise((r) => setTimeout(r, 600)); return [...document.querySelectorAll('#flow-hud .hud-step .hud-skc')].some((x) => /⚙/.test(x.textContent)); }, T.id));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
