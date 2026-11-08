/* Agent efficiency and continuous improvement.
 *
 * What would make it wrong: a review that says "inefficient" without the
 * evidence, the affected tasks, the proposed change and the expected benefit;
 * a guess presented as a confirmed cause; a change applied by the review on
 * its own; a recommended change shown as if it were applied; a saving
 * claimed that was never measured; a cheaper run that lost quality and was
 * kept; a change that cannot be undone; a baseline that sends something or
 * leaves a task behind; a scheduled review that runs twice. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const E = require('../flow-efficiency.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 380) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n— shapes —');
  const now = Date.now();
  const T0 = [
    { id: 't1', title: 'Weekly numbers', status: 'done', createdAt: now - 1000, by: 'jarvis', steps: [{ agent: 'bobby', status: 'done' }], metrics: { calls: 3, in: 300, out: 60, usd: 0.01, retries: 1, reads: 2, questions: 1, handoffs: 0, planCalls: 1, reviewCalls: 1, skillUsed: 0 } },
    { id: 't2', title: 'Weekly numbers', status: 'failed', createdAt: now - 2000, by: 'you', steps: [{ agent: 'bobby', status: 'failed' }], metrics: { calls: 2, in: 100, out: 10, usd: 0.002, retries: 2 } },
    { id: 't3', title: 'Refund reply', status: 'done', createdAt: now - 3000, by: 'you', steps: [{ agent: 'sarah', status: 'done', skill: { id: 's1', name: 'Refund replies' } }], metrics: { calls: 1, in: 50, out: 20, usd: 0.001, skillUsed: 1 } },
    { id: 't4', title: 'Old one', status: 'done', createdAt: now - 40 * 86400000, steps: [{ agent: 'tom', status: 'done' }], metrics: { calls: 9 } },
    { id: 't5', title: 'Spend by category', status: 'done', createdAt: now - 4000, steps: [{ agent: 'jarvis', status: 'done', model: 'script', run: { name: 'Spend by category' } }], metrics: { calls: 0 } }
  ];
  const M = E.metricsOf(T0, [{ createdAt: now, status: 'ok', metrics: { modelCalls: 0, items: 3, ms: 50 } }, { createdAt: now, status: 'ok', dry: true }], [{ task: 't3', edited: true, status: 'approved' }, { task: 't1', status: 'rejected' }], now - 30 * 86400000);
  ok('the period\'s totals: tasks, calls, tokens, cost, retries, reads, questions, edits and declines counted as interventions; plan and hand-over calls apart; the old task left out', M.total.runs === 4 && M.total.calls === 6 && M.total.tokens === 540 && M.total.usd === 0.013 && M.total.retries === 3 && M.total.reads === 2 && M.total.interventions === 3 && M.total.edited === 1 && M.total.declined === 1 && M.total.planCalls === 1 && M.total.reviewCalls === 1 && M.total.okRate === 75 && M.total.scripted === 1 && M.total.skilled === 1, M.total);
  ok('by workflow: a skill, a script or the task\'s words name the workflow; usage and failures are per workflow', M.byWorkflow.some((w) => w.key === 'skill:Refund replies' && w.runs === 1) && M.byWorkflow.some((w) => w.key === 'script:Spend by category') && M.byWorkflow.some((w) => /^task:/.test(w.key) && w.runs === 2 && w.failed === 1 && w.retries === 3), M.byWorkflow.map((w) => w.key));
  ok('by agent, with automations as their own row; dry runs are not counted as automation runs', M.byAgent.bobby.runs === 2 && M.byAgent.sarah.runs === 1 && M.byAgent.script.runs === 1 && M.scripts.runs === 1 && M.scripts.modelCalls === 0, Object.keys(M.byAgent));
  const S = (c, cmp, cpl, i, calls, tok, ms) => ({ summary: { n: 3, ok: 3, correct: c, complete: cmp, compliant: cpl, asked: 1, interventions: i, calls, tokens: tok, ms, usd: 0 } });
  const cm = (a, b) => E.compare({ runs: [Object.assign({ label: 'baseline' }, a), Object.assign({ label: 'after' }, b)] });
  ok('the comparison keeps a change only when quality held and cost fell; a cheaper run that lost quality says restore; the same cost says no saving', /^keep/.test(cm(S(3, 3, 3, 0, 6, 900, 3000), S(3, 3, 3, 0, 4, 700, 2500)).verdict) && /^restore/.test(cm(S(3, 3, 3, 0, 6, 900, 3000), S(2, 3, 3, 0, 4, 700, 2500)).verdict) && /^no measured saving/.test(cm(S(3, 3, 3, 0, 6, 900, 3000), S(3, 3, 3, 0, 6, 900, 3000)).verdict) && /^restore/.test(cm(S(3, 3, 3, 0, 6, 900, 3000), S(3, 3, 3, 1, 4, 700, 2500)).verdict), cm(S(3, 3, 3, 0, 6, 900, 3000), S(2, 3, 3, 0, 4, 700, 2500)));
  ok('a few milliseconds less is noise, not a saving; a clear fifth less time is', /^no measured saving/.test(cm(S(3, 3, 3, 0, 6, 900, 3000), S(3, 3, 3, 0, 6, 900, 2990)).verdict) && /^keep/.test(cm(S(3, 3, 3, 0, 6, 900, 6000), S(3, 3, 3, 0, 6, 900, 4500)).verdict));
  ok('a single run compares with nothing',E.compare({ runs: [S(3, 3, 3, 0, 6, 900, 3000)] }).only && E.compare({ runs: [] }) === null);
  ok('a finding\'s id follows from its kind and subject, so it is the same across reviews', E._internals.finding('calls.handover', 'single', {}).id === E._internals.finding('calls.handover', 'single', { title: 'x' }).id && E._internals.finding('calls.handover', 'single', {}).id !== E._internals.finding('calls.retries', 'single', {}).id);

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
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); await Flow.Settings.set('timezone', 'UTC');
  });
  await p.waitForTimeout(800);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { const v = await fn(); if (v) return v; await wait(300); } return null; };
  const task = async (id) => (await api('/api/team/tasks')).j.tasks.find((t) => t.id === id);
  const settled = (id) => until(async () => { const t = await task(id); return t && /^(done|awaiting_approval|awaiting_info|failed)$/.test(t.status) ? t : null; });
  await api('/api/team');

  console.log('\n— what the team records while it works —');
  const empty = (await api('/api/team/efficiency')).j;
  ok('before anything ran: the numbers are zero, no review, nothing applied, defaults off', empty.ok && empty.metrics.total.runs === 0 && empty.review === null && empty.applied.length === 0 && empty.settings.skipHandoverSingle === false && empty.settings.schedule === null, empty.settings);
  const weekly = [];
  for (let i = 0; i < 3; i++) { const t = (await api('/api/team/task', { agent: 'bobby', title: 'Weekly numbers report', brief: 'Total this week\'s spend numbers and report them', lang: 'en' })).j.task; weekly.push(await settled(t.id)); }
  ok('a direct task records its model calls, tokens, cost and duration', weekly.every((t) => t && t.status === 'done' && t.metrics && t.metrics.calls === 1 && t.metrics.in > 0 && t.metrics.ms >= 0 && t.metrics.reviewCalls === 0), weekly[0] && weekly[0].metrics);
  const d1 = (await api('/api/team/delegate', { text: 'Ask bobby to check the ads this week', lang: 'en' })).j.task; const D1 = await settled(d1.id);
  const d2 = (await api('/api/team/delegate', { text: 'Ask bobby to check the ads this week again', lang: 'en' })).j.task; const D2 = await settled(d2.id);
  ok('a delegated one-step task records the plan call, the specialist\'s call and the hand-over call separately: 3 calls', D1 && D2 && D1.metrics.calls === 3 && D1.metrics.planCalls === 1 && D1.metrics.reviewCalls === 1 && D1.by === 'jarvis' && /^Summary by/.test(D1.result), D1 && D1.metrics);
  const k1 = (await api('/api/team/knowledge', { op: 'add', text: 'The onboarding service costs $1,000.', scope: 'shared' })).j.item;
  const k2 = (await api('/api/team/knowledge', { op: 'add', text: 'The onboarding service costs $1,200.', scope: 'shared' })).j.item;
  const s1 = (await api('/api/team/skills', { op: 'create', text: 'Refund reply\nWhen a customer asks for a refund: check the order, apologise once, state the refund amount and the days it takes, offer a voucher.', agents: ['sarah'] })).j.skill;
  const s2 = (await api('/api/team/skills', { op: 'create', text: 'Refund reply letter\nWhen a customer asks for a refund: check the order, apologise once, state the refund amount and the days it takes.', agents: ['sarah'] })).j.skill;
  ok('seeded: two current facts that disagree, two near-identical skills', k1 && k2 && s1 && s2 && s1.id !== s2.id, { k1: !!k1, k2: !!k2, s1: s1 && s1.id, s2: s2 && s2.id });

  console.log('\n— the review: evidence, not opinion —');
  const rv = await api('/api/team/efficiency/review', { days: 30 });
  const R = rv.j.review; const F = (R && R.findings) || [];
  const byKind = (k) => F.filter((f) => f.kind === k);
  ok('a review is recorded with its trigger, period, task count and a summary by kind', rv.j.ok && R.trigger === 'manual' && R.days === 30 && R.summary.tasks >= 5 && R.summary.findings === F.length && R.summary.byKind && Object.keys(R.summary.byKind).length >= 3, R && R.summary);
  ok('every finding carries evidence, a proposed change, an expected benefit, an action and a confidence', F.length >= 3 && F.every((f) => f.evidence.length >= 1 && f.proposal && f.benefit && f.action && f.action.type && /^(confirmed|hypothesis)$/.test(f.confidence) && f.status === 'recommended'), F.map((f) => [f.kind, f.evidence.length, f.confidence]));
  const fc = byKind('memory.conflict')[0];
  ok('the conflicting facts are found, both quoted with their dates, confirmed, pointing at Memory\'s correction', fc && fc.confidence === 'confirmed' && fc.evidence.length === 2 && fc.evidence.every((e) => /\$1,[02]00/.test(e) && /since \d{4}-\d{2}-\d{2}/.test(e)) && fc.action.type === 'memory.correct' && /\$1,200/.test(fc.action.text), fc);
  const fd = byKind('skills.duplicate')[0];
  ok('the two skills are flagged as the same procedure — a hypothesis, with the similarity shown and the less-used one proposed for archiving', fd && fd.confidence === 'hypothesis' && fd.evidence.some((e) => /similarity \d+%/.test(e)) && fd.action.type === 'skill.archive' && [s1.id, s2.id].indexOf(fd.action.id) >= 0 && [s1.id, s2.id].indexOf(fd.action.keep) >= 0 && fd.action.id !== fd.action.keep, fd);
  const fs = byKind('scripts.candidate').find((f) => weekly.every((t) => f.tasks.indexOf(t.id) >= 0));
  ok('three identical routine jobs done by a model are a candidate automation, with each task listed as evidence and the saving stated as "would have been", not as achieved', fs && fs.confidence === 'hypothesis' && fs.tasks.length === 3 && fs.evidence.length === 3 && fs.action.type === 'script.create' && /would have been 0/.test(fs.benefit) && /measured once/.test(fs.benefit), fs);
  const fh = byKind('calls.handover')[0];
  ok('the hand-over call on one-step delegations is a confirmed finding with the call breakdown per task and a reversible setting as the change', fh && fh.confidence === 'confirmed' && fh.tasks.indexOf(D1.id) >= 0 && fh.tasks.indexOf(D2.id) >= 0 && fh.evidence.every((e) => /plan 1 \+ work 1 \+ hand-over 1 calls/.test(e)) && fh.action.type === 'setting' && fh.action.key === 'skipHandoverSingle' && /2 over the period, measured/.test(fh.benefit) && /reversible/.test(fh.proposal), fh);
  ok('the review names what it is not sure about: costs are list-price estimates; token savings are estimates until usage moves', R.uncertainties.some((u) => /list prices/.test(u)) && R.uncertainties.some((u) => /estimated from character counts/.test(u)), R.uncertainties);
  const ov1 = (await api('/api/team/efficiency')).j;
  ok('nothing changed by the review itself: the setting is still off, both skills active, nothing applied, every finding merely recommended', ov1.settings.skipHandoverSingle === false && ov1.applied.length === 0 && ov1.review.findings.every((f) => f.status === 'recommended') && (await api('/api/team/skills')).j.items.filter((s) => [s1.id, s2.id].indexOf(s.id) >= 0 && s.status === 'active').length === 2);
  ok('the activity log records the review and its count', (await api('/api/team')).j.log.some((l) => /Efficiency review: \d+ findings? \(\d+ recommended\)/.test(l.what)));

  console.log('\n— apply, measure, revert —');
  const ap = await api('/api/team/efficiency/apply', { id: fh.id });
  ok('applying the setting records before and after and how to undo it', ap.j.ok && ap.j.applied.before.skipHandoverSingle === false && ap.j.applied.after.skipHandoverSingle === true && ap.j.applied.revert.type === 'setting' && ap.j.finding.status === 'applied' && /Setting changed/.test(ap.j.applied.note), ap.j);
  const d3 = (await api('/api/team/delegate', { text: 'Ask bobby to check the ads this week once more', lang: 'en' })).j.task; const D3 = await settled(d3.id);
  ok('…and the next one-step delegation skips the hand-over: 2 calls, the specialist\'s result is the result', D3 && D3.status === 'done' && D3.metrics.calls === 2 && D3.metrics.reviewCalls === 0 && D3.result === D3.steps[0].result && /^Bobby did/.test(D3.result), D3 && { m: D3.metrics, r: D3.result });
  const ov2 = (await api('/api/team/efficiency')).j;
  ok('the view keeps recommended and applied apart: the finding shows as applied, the change is listed with Revert, the settings history has the change', ov2.review.findings.find((f) => f.id === fh.id).status === 'applied' && ov2.applied.length === 1 && ov2.applied[0].id === ap.j.applied.id && !ov2.applied[0].reverted && ov2.settingsHistory[0].key === 'skipHandoverSingle' && ov2.settingsHistory[0].to === true, ov2.settingsHistory);
  const rv2 = (await api('/api/team/efficiency/review', { days: 30 })).j.review;
  ok('a second review does not raise the applied finding again, and carries the earlier statuses', !rv2.findings.some((f) => f.kind === 'calls.handover') && rv2.findings.find((f) => f.id === fc.id).status === 'recommended', rv2.summary.byKind);
  const rev = await api('/api/team/efficiency/revert', { id: ap.j.applied.id });
  ok('revert restores the setting; the change is marked reverted and the finding too', rev.j.ok && rev.j.applied.reverted && (await api('/api/team/efficiency')).j.settings.skipHandoverSingle === false && (await api('/api/team/efficiency')).j.applied[0].reverted > 0, rev.j);
  const d4 = (await api('/api/team/delegate', { text: 'Ask bobby to check the ads this week yet again', lang: 'en' })).j.task; const D4 = await settled(d4.id);
  ok('…and the hand-over call is back', D4 && D4.metrics.reviewCalls === 1 && /^Summary by/.test(D4.result), D4 && D4.metrics);
  ok('reverting twice is harmless', (await api('/api/team/efficiency/revert', { id: ap.j.applied.id })).j.already === true);
  const ptr = await api('/api/team/efficiency/apply', { id: fc.id });
  ok('a pointer finding (the memory conflict) is not a one-click change: Apply refuses and says where to do it', ptr.status === 400 && /not a one-click change/.test(ptr.j.error), ptr.j);
  const ds = await api('/api/team/efficiency/dismiss', { id: fd.id });
  const ov3 = (await api('/api/team/efficiency')).j;
  ok('a dismissed finding leaves the recommended list but stays on record; undo brings it back', ds.j.ok && ds.j.status === 'dismissed' && ov3.review.findings.find((f) => f.id === fd.id).status === 'dismissed' && ov3.review.summary.recommended === rv2.summary.recommended && (await api('/api/team/efficiency/dismiss', { id: fd.id, undo: true })).j.status === 'recommended');
  const apS = await api('/api/team/efficiency/apply', { id: fs.id });
  const sc = apS.j.ok && (await api('/api/team/scripts')).j.items.find((s) => s.id === apS.j.applied.after.script);
  ok('applying the automation candidate creates the automation from the last task, untested, and says to dry-run it first', apS.j.ok && sc && sc.untested && sc.status === 'active' && /untested — run a dry run/.test(apS.j.applied.note), apS.j.applied);
  const revS = await api('/api/team/efficiency/revert', { id: apS.j.applied.id });
  ok('reverting it archives the automation', revS.j.ok && (await api('/api/team/scripts')).j.items.find((s) => s.id === sc.id).status === 'archived');
  const apD = await api('/api/team/efficiency/apply', { id: fd.id });
  const skAfter = (await api('/api/team/skills')).j.items;
  ok('applying the duplicate finding archives one skill and keeps the other', apD.j.ok && skAfter.find((s) => s.id === fd.action.id).status === 'archived' && skAfter.find((s) => s.id === fd.action.keep).status === 'active', apD.j.applied && apD.j.applied.note);
  await api('/api/team/efficiency/revert', { id: apD.j.applied.id });
  ok('…and revert restores it', (await api('/api/team/skills')).j.items.find((s) => s.id === fd.action.id).status === 'active');
  const nope = await api('/api/team/efficiency/apply', { id: 'fnothing' });
  ok('an unknown finding is a 404', nope.status === 404);
  const st = await api('/api/team/efficiency/settings', { skipHandoverSingle: true });
  ok('the setting can be changed by hand too, with history', st.j.ok && st.j.settings.skipHandoverSingle === true && (await api('/api/team/efficiency')).j.settingsHistory[0].to === true);
  await api('/api/team/efficiency/settings', { skipHandoverSingle: false });

  console.log('\n— baseline, change, rerun —');
  const n0 = (await api('/api/team/tasks')).j.tasks.length; const ap0 = (await api('/api/team')).j.approvals.length;
  const bad = await api('/api/team/efficiency/baseline', { name: 'Empty', examples: [] });
  ok('a baseline needs examples', bad.status === 400 && /two or more representative examples/.test(bad.j.error));
  const bl = await api('/api/team/efficiency/baseline', { name: 'Ads and replies', examples: [{ agent: 'bobby', brief: 'Check the ads for this week and report the spend', expected: 'ads week spend' }, { agent: 'sarah', brief: 'Draft an email reply to the customer — ask me which address first', expectQuestion: true }, { agent: 'tom', brief: 'Make the build fail on purpose' }] });
  const B = bl.j.baseline, run1 = bl.j.run;
  ok('the examples run for real, once each, as a step would: correct, complete, asked-as-expected and failed are told apart; calls, tokens, cost and time are summed', bl.j.ok && B.examples.length === 3 && run1.label === 'baseline' && run1.summary.n === 3 && run1.summary.ok === 2 && run1.summary.asked === 1 && run1.summary.interventions === 1 && run1.summary.calls === 3 && run1.summary.tokens > 0 && run1.results[0].correct && run1.results[1].asked && run1.results[1].compliant && !run1.results[2].ok && /stand-in failure/.test(run1.results[2].error), run1.summary);
  ok('the baseline left nothing behind: no task, no approval, nothing sent', (await api('/api/team/tasks')).j.tasks.length === n0 && (await api('/api/team')).j.approvals.length === ap0 && (await api('/api/team')).j.log.some((l) => /ran "Ads and replies" \(baseline\).*Nothing sent\./.test(l.what)));
  ok('a first run compares with nothing yet', bl.j.comparison && bl.j.comparison.only);
  const bl2 = await api('/api/team/efficiency/baseline', { id: B.id, label: 'after the change' });
  const C = bl2.j.comparison;
  ok('a rerun under the same name compares with the first: every measure before, after and delta, and a verdict that does not claim a saving the numbers do not show', bl2.j.ok && bl2.j.baseline.runs.length === 2 && C.before === 'baseline' && C.after === 'after the change' && C.rows.correct.delta === 0 && C.rows.calls.delta === 0 && C.quality === true && C.cheaper === false && /^no measured saving/.test(C.verdict), C);
  ok('each run records the settings it ran under', bl2.j.baseline.runs.every((r) => r.settings && typeof r.settings.skipHandoverSingle === 'boolean'));

  console.log('\n— the schedule —');
  const at = new Date(); at.setUTCHours(8, 32, 0, 0); const day = (at.getUTCDay() + 6) % 7;
  const sch = await api('/api/team/efficiency/schedule', { on: true, day, at: '08:30' });
  ok('a weekly review can be scheduled (day and time in my time zone)', sch.j.ok && sch.j.schedule.kind === 'weekly' && sch.j.schedule.day === day && sch.j.schedule.at === '08:30');
  const nR = (await api('/api/team/efficiency')).j.reviews.length;
  const t1 = await api('/api/team/_tick?at=' + encodeURIComponent(at.toISOString())); const t2 = await api('/api/team/_tick?at=' + encodeURIComponent(at.toISOString()));
  const ovS = (await api('/api/team/efficiency')).j;
  ok('the minute tick runs it once in its window and not again that day; the review says it was the schedule', t1.j.efficiency === 1 && t2.j.efficiency === 0 && ovS.reviews.length === nR + 1 && ovS.reviews[0].trigger === 'schedule weekly', { t1: t1.j.efficiency, t2: t2.j.efficiency, trig: ovS.reviews.map((r) => r.trigger) });
  const off = await api('/api/team/efficiency/schedule', { on: false });
  ok('…and it can be switched off', off.j.ok && off.j.schedule === null);

  console.log('\n— the workspace —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  ok('the strip has an Efficiency button', await p.evaluate(() => !!document.querySelector('#flow-hud .hud-ag[data-hud="efficiency"]')));
  await p.click('#flow-hud .hud-ag[data-hud="efficiency"]'); await p.waitForTimeout(1800);
  const ws = await p.evaluate(() => ({ title: document.querySelector('#flow-hud .hud-brand b').textContent, kpis: document.querySelectorAll('#flow-hud .hud-kpi').length, wf: document.querySelectorAll('#flow-hud .hud-tbl5 .hud-tr-r').length, est: /estimates from list prices/.test(document.querySelector('#flow-hud [data-k="efnums"]').innerText), findings: document.querySelectorAll('#flow-hud .hud-eff').length, tabs: document.querySelectorAll('#flow-hud .hud-tab[data-hud="efkind"]').length, applied: /reverted/.test(document.querySelector('#flow-hud [data-k="efapplied"]').innerText), bl: /Ads and replies/.test(document.querySelector('#flow-hud [data-k="efbl"]').innerText) && /No saving/i.test(document.querySelector('#flow-hud [data-k="efbl"]').innerText) }));
  ok('the Efficiency workspace shows the numbers (marked as estimates), workflows by usage, the findings with tabs by kind, the applied changes with their reverts, and the baseline with its verdict', ws.title === 'Efficiency' && ws.kpis === 6 && ws.wf >= 2 && ws.est && ws.findings >= 3 && ws.tabs >= 3 && ws.applied && ws.bl, ws);
  await p.click('#flow-hud .hud-eff .hud-mih[data-id="' + fc.id + '"]'); await p.waitForTimeout(500);
  const card = await p.evaluate(() => { const c = document.querySelector('#flow-hud .hud-eff.open'); return c ? { ev: c.querySelectorAll('.hud-ev li').length, txt: c.innerText, go: !!c.querySelector('[data-hud="efgo"][data-to="memory"]'), dismiss: !!c.querySelector('[data-hud="efdismiss"]'), badge: (c.querySelector('.hud-badge') || {}).textContent } : null; });
  ok('opening a finding shows the evidence, the proposed change, the expected benefit, its confidence, and the way to act on it', card && card.ev === 2 && /Proposed change:/.test(card.txt) && /Expected benefit:/.test(card.txt) && card.badge === 'Confirmed' && card.go && card.dismiss, card);
  await p.click('#flow-hud .hud-tab[data-hud="efkind"][data-k="scripts.candidate"]'); await p.waitForTimeout(400);
  ok('a tab narrows the list to one kind, each with an Apply button', await p.evaluate(() => { const L = [...document.querySelectorAll('#flow-hud .hud-eff')]; return L.length >= 1 && L.every((c) => /Automation/.test(c.innerText)) && !!document.querySelector('#flow-hud .hud-eff .hud-mih') ; }));
  await p.click('#flow-hud .hud-tab[data-hud="efkind"][data-k="all"]'); await p.waitForTimeout(300);
  await p.click('#flow-hud [data-hud="efnewbl"]'); await p.waitForTimeout(400);
  ok('New baseline opens a form that asks for examples including one with information missing', await p.evaluate(() => { const f = document.querySelector('#flow-hud form[data-team="efbaseline"]'); return !!f && /information missing/.test(f.innerText) && !!f.querySelector('textarea[name="examples"]'); }));
  await p.click('#flow-hud [data-hud="efnewbl"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const c = document.querySelector('#flow-hud input[data-team-eff="skipHandoverSingle"]'); c.click(); }); await p.waitForTimeout(1200);
  ok('the orchestration toggle in the workspace changes the setting on the server', (await api('/api/team/efficiency')).j.settings.skipHandoverSingle === true);
  await p.evaluate(() => { const c = document.querySelector('#flow-hud input[data-team-eff="skipHandoverSingle"]'); c.click(); }); await p.waitForTimeout(1000);
  ok('…and back', (await api('/api/team/efficiency')).j.settings.skipHandoverSingle === false);

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
