/* Reusable skills and workflow learning.
 *
 * What would make it wrong: a skill the person cannot read or edit; a
 * one-time detail (an address, an amount) baked into the procedure; a task
 * that follows a skill without saying which one and which version; a skill
 * silently ignored, or a missing one silently invented; feedback that
 * rewrites unrelated parts, or a one-off remark saved as a rule; no way back
 * to the earlier version; a skill that carries a secret or widens what an
 * agent may do; a test run that sends something; a skill that breaks when
 * the model changes. The names and amounts are test data. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const S = require('../flow-skills.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 360) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n— shapes —');
  const d = S.draftFromText('Weekly ad report\nEvery Monday pull last week\'s spend per campaign from https://ads.example.com/report and compare with the week before. Then list the three campaigns with the worst cost per lead. Flag anything over $500 a day. Ask me before pausing any campaign. If a campaign has no spend data, say so instead of guessing. Keep it short and numbers first.');
  ok('a description becomes a document: name, ordered steps, exceptions, approvals and quality in their own places', d.name === 'Weekly ad report' && d.steps.length === 3 && /List the three campaigns/.test(d.steps[1]) && /no spend data/.test(d.exceptions) && /Ask me before pausing/.test(d.approvals) && /short and numbers first/.test(d.quality), d);
  const g = S.generalise('Email ali@example.com the summary with the $1,250 total by 12/11/2026 from https://x.example.com/r');
  ok('one-time details come out as named inputs; the procedure stays', !/ali@example|1,250|12\/11\/2026|x\.example/.test(g.text) && g.inputs.indexOf('email address') >= 0 && g.inputs.indexOf('amount') >= 0 && g.inputs.indexOf('date') >= 0 && g.inputs.indexOf('web address') >= 0, g);
  const sk = Object.assign(S.cleanDoc(d), { id: 'sk1', status: 'active', version: 2, assignedTo: [], versions: [], examples: [], runs: [] });
  ok('a request about the same work matches the skill; an unrelated one matches nothing', (S.select([sk], 'bobby', 'Pull together the weekly ad report for last week') || {}).how === 'matched' && S.select([sk], 'bobby', 'Write a birthday message for my mum') === null);
  ok('a skill can be invoked by name, and a name nobody has is reported missing rather than invented', (S.select([sk], 'bobby', 'use the Weekly ad report skill') || {}).how === 'invoked' && S.select([sk], 'bobby', 'use the Refund wizard skill').missing === 'Refund wizard');
  ok('a skill assigned to one agent is not offered to another', S.select([Object.assign({}, sk, { assignedTo: ['sarah'] })], 'bobby', 'weekly ad report please') === null && (S.select([Object.assign({}, sk, { assignedTo: ['sarah'] })], 'sarah', 'weekly ad report please') || {}).how === 'matched');
  ok('readiness names the tool that is not connected', S.readiness(Object.assign({}, sk, { tools: ['browser'] }), { browser: false }).missingNames[0] === 'Cloud browser' && S.readiness(sk, { web: true }).ok);
  ok('feedback is sorted: a one-off, a change to the procedure, a general preference', S.classify('just this once make it shorter') === 'output' && S.classify('from now on always include the total spend at the top') === 'workflow' && S.classify('I prefer a formal tone in everything') === 'preference');
  ok('anything that looks like a secret is refused', S.secretish({ steps: ['log in with password: hunter22secret'] }) && S.secretish({ purpose: 'use key sk-abcdefghijklmnopqrstuvwxyz' }) && !S.secretish(d));
  const d2 = S.reviseDoc(S.cleanDoc(d), 'from now on always include the total spend at the top');
  const df = S.diff(S.cleanDoc(d), d2);
  ok('a revision is a precise diff: one field changed, the rest untouched', df.length === 1 && df[0].field === 'steps' && df[0].added.length === 1 && /total spend/.test(df[0].added[0]) && df[0].removed.length === 0, df);
  ok('a contradiction inside a skill is noticed', S.contradictions(S.cleanDoc({ name: 'x', steps: ['Always send the report by email on Monday.', 'Never send the report by email.'] }), []).length === 1);

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
  await p.waitForTimeout(1000);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { const v = await fn(); if (v) return v; await wait(300); } return null; };
  const task = async (id) => (await api('/api/team/tasks')).j.tasks.find((t) => t.id === id);
  const settled = (id) => until(async () => { const t = await task(id); return t && /^(done|awaiting_approval|awaiting_info|failed)$/.test(t.status) ? t : null; });
  await api('/api/team');
  await api('/api/team/knowledge', { op: 'add', text: 'Ad spend above $500 a day on one campaign is flagged to Artur the same day.', scope: 'shared' });

  console.log('\n— teaching —');
  const c1 = await api('/api/team/skills', { op: 'create', text: 'Weekly ad report\nEvery Monday pull last week\'s spend per campaign and compare with the week before. Then list the three campaigns with the worst cost per lead. Flag anything over $500 a day. Ask me before pausing any campaign. If a campaign has no spend data, say so instead of guessing. Keep it short and numbers first.', examples: [{ input: 'Weekly ad report for last week please', expected: 'campaigns cost per lead' }] });
  const W = c1.j.skill;
  ok('a skill is created from a description: v1, active, for everyone, readable fields', c1.j.ok && W.version === 1 && W.status === 'active' && W.assignedTo.length === 0 && W.steps.length === 3 && W.examples.length === 1 && /Ask me before pausing/.test(W.approvals), W);
  const dup = await api('/api/team/skills', { op: 'create', text: 'Weekly ad report\nSomething else entirely.' });
  ok('the same name again is refused as a duplicate (improve the existing one instead)', dup.status === 409 && dup.j.duplicates.some((x) => x.same), dup.j);
  const sec = await api('/api/team/skills', { op: 'create', text: 'Portal check\nLog in to the portal with password: hunter22secret and read the balance.' });
  ok('a skill with a secret in it is refused', sec.status === 400 && /never hold secrets/.test(sec.j.error), sec.j);
  const L1 = (await api('/api/team/skills')).j;
  ok('the workspace lists it with counts, readiness and tool names', L1.ok && L1.counts.active >= 1 && L1.items.some((s) => s.id === W.id && s.ready === true) && L1.toolNames.web, L1.counts);

  console.log('\n— using it in work —');
  const t1 = (await api('/api/team/task', { agent: 'bobby', title: 'Weekly ad report', brief: 'Pull together the weekly ad report for last week please', lang: 'en' })).j.task;
  const T1 = await settled(t1.id);
  ok('a matching request makes the specialist follow the skill — and the step records which skill and which version', T1 && T1.status === 'done' && T1.steps[0].skill && T1.steps[0].skill.id === W.id && T1.steps[0].skill.version === 1 && T1.steps[0].skill.how === 'matched', T1 && T1.steps[0]);
  ok('the result says it followed the skill, step by step', T1 && /followed the skill "Weekly ad report" v1/.test(T1.result) && /Step 1/.test(T1.result) && /Step 3/.test(T1.result), T1 && T1.result);
  const lg1 = (await api('/api/team')).j.log;
  ok('the activity log names the skill and version', lg1.some((l) => /following the skill "Weekly ad report" v1/.test(l.what)), lg1.slice(-4).map((l) => l.what));
  const W1 = (await api('/api/team/skills')).j.items.find((s) => s.id === W.id);
  ok('the skill\'s own run history has the task', W1.runs.some((r) => r.task === t1.id && r.version === 1 && r.agent === 'bobby'), W1.runs);
  const t2 = (await api('/api/team/task', { agent: 'bobby', title: 'Mum', brief: 'Write a birthday message for my mum', lang: 'en' })).j.task;
  const T2 = await settled(t2.id);
  ok('an unrelated request uses no skill', T2 && T2.status === 'done' && !T2.steps[0].skill && !/followed the skill/.test(T2.result), T2 && T2.steps[0].skill);
  const dg = await api('/api/team/delegate', { text: 'Have Bobby use the Weekly ad report skill for the last two weeks', lang: 'en' });
  const T3 = dg.j.task && await settled(dg.j.task.id);
  ok('J.A.R.V.I.S.\'s plan can name a skill for a step; the step shows it as asked-for', T3 && T3.steps[0].skill && T3.steps[0].skill.id === W.id && T3.steps[0].skill.how === 'invoked', T3 && T3.steps[0]);
  const t4 = (await api('/api/team/task', { agent: 'sarah', title: 'Refund', brief: 'Use the Refund wizard skill for this customer', lang: 'en' })).j.task;
  const T4 = await settled(t4.id);
  ok('a skill nobody has: the step says it is missing, the result explains, the work is still done — nothing invented', T4 && T4.steps[0].skill && T4.steps[0].skill.missing === 'Refund wizard' && /could not use the skill "Refund wizard"/.test(T4.result) && /Did the work without it/.test(T4.result), T4 && T4.result);

  console.log('\n— improving it from feedback —');
  const f1 = await api('/api/team/skills/feedback', { id: W.id, text: 'From now on always include the total spend at the top' });
  const P1 = f1.j.proposal;
  ok('"from now on…" becomes a proposed change to the skill, shown as a diff of one field, with the rest untouched', f1.j.ok && P1.kind === 'workflow' && P1.status === 'proposed' && P1.diff.length === 1 && P1.diff[0].field === 'steps' && P1.diff[0].added.length === 1 && P1.diff[0].removed.length === 0 && /Unrelated parts are untouched/.test(P1.explanation), P1);
  const Wv1 = (await api('/api/team/skills')).j.items.find((s) => s.id === W.id);
  ok('…and nothing changed yet', Wv1.version === 1 && Wv1.steps.length === 3);
  const a1 = await api('/api/team/skills/apply', { id: P1.id });
  ok('Apply makes v2 and keeps v1 for rollback', a1.j.ok && a1.j.skill.version === 2 && a1.j.skill.steps.length === 4 && a1.j.skill.versions.length === 1 && a1.j.skill.versions[0].v === 1 && a1.j.skill.versions[0].doc.steps.length === 3, a1.j.skill && a1.j.skill.versions);
  const f2 = await api('/api/team/skills/feedback', { id: W.id, text: 'Just this once, make it shorter' });
  ok('a one-off remark changes nothing and says so', f2.j.proposal.kind === 'output' && !f2.j.proposal.diff && /nothing is saved/.test(f2.j.proposal.explanation), f2.j.proposal);
  const f3 = await api('/api/team/skills/feedback', { id: W.id, text: 'I prefer a formal tone in everything' });
  ok('a general preference is routed to the team\'s knowledge, not hidden in the skill', f3.j.proposal.kind === 'preference' && f3.j.proposal.knowledge && f3.j.proposal.knowledge.kind === 'preference', f3.j.proposal);
  const a3 = await api('/api/team/skills/apply', { id: f3.j.proposal.id });
  const kn = (await api('/api/team')).j.knowledge;
  ok('…saved as a preference entry every agent reads', a3.j.ok && kn.some((k) => k.kind === 'preference' && /formal tone/.test(k.text)), kn.filter((k) => k.kind === 'preference'));
  const Wv2 = (await api('/api/team/skills')).j.items.find((s) => s.id === W.id);
  ok('the preference did not touch the skill', Wv2.version === 2);
  const t5 = (await api('/api/team/task', { agent: 'bobby', title: 'Weekly ad report', brief: 'Weekly ad report for last week, thanks', lang: 'en' })).j.task;
  const T5 = await settled(t5.id);
  ok('the next task follows v2 — four steps, including the new one', T5 && T5.steps[0].skill && T5.steps[0].skill.version === 2 && /Step 4/.test(T5.result) && /total spend/i.test(T5.result), T5 && T5.result);
  const ed = await api('/api/team/skills', { op: 'update', id: W.id, doc: { quality: 'Keep it short and numbers first. Name the week covered.' }, why: 'name the week' });
  ok('a direct edit is a new version with the reason kept', ed.j.ok && ed.j.skill.version === 3 && ed.j.diff.length === 1 && ed.j.diff[0].field === 'quality' && ed.j.skill.versions[1].why === 'name the week', ed.j.diff);
  const rb = await api('/api/team/skills', { op: 'rollback', id: W.id, to: 1 });
  ok('rollback restores v1\'s text as a new version (nothing is lost)', rb.j.ok && rb.j.restored === 1 && rb.j.skill.version === 4 && rb.j.skill.steps.length === 3 && rb.j.skill.versions.length === 3, rb.j.skill && rb.j.skill.steps);
  await api('/api/team/skills', { op: 'rollback', id: W.id, to: 2 });

  console.log('\n— assignment, permissions, model independence —');
  const perm0 = (await api('/api/team')).j.agents.find((a) => a.id === 'bobby').permissions;
  await api('/api/team/agent/update', { id: 'bobby', permissions: 'read' });
  const as = await api('/api/team/skills', { op: 'assign', id: W.id, agents: ['bobby'] });
  ok('assigning to one agent says what it does not do: no credentials, no new permissions', as.j.ok && as.j.skill.assignedTo[0] === 'bobby' && /no credentials travel/.test(as.j.note), as.j);
  const t6 = (await api('/api/team/task', { agent: 'sarah', title: 'Weekly ad report', brief: 'Weekly ad report for last week please', lang: 'en' })).j.task;
  const T6 = await settled(t6.id);
  ok('an agent it is not assigned to does not follow it', T6 && !T6.steps[0].skill, T6 && T6.steps[0].skill);
  const bob = (await api('/api/team')).j.agents.find((a) => a.id === 'bobby');
  ok('Bobby is still read-only after being given the skill', bob.permissions === 'read');
  await api('/api/team/agent/update', { id: 'bobby', model: 'gpt-4o-mini' });
  const t7 = (await api('/api/team/task', { agent: 'bobby', title: 'Weekly ad report', brief: 'Weekly ad report for last week please', lang: 'en' })).j.task;
  const T7 = await settled(t7.id);
  ok('switching Bobby to another provider\'s model: the same skill, same version, followed the same way', T7 && T7.steps[0].skill && T7.steps[0].skill.id === W.id && T7.steps[0].skill.version === 5 && T7.steps[0].model === 'gpt-4o-mini' && /followed the skill "Weekly ad report" v5/.test(T7.result), T7 && T7.steps[0]);
  await api('/api/team/agent/update', { id: 'bobby', model: 'claude-sonnet-4-5', permissions: perm0 });

  console.log('\n— testing it on examples —');
  await api('/api/team/skills', { op: 'example', id: W.id, input: 'Weekly ad report — ask me which account first', expectQuestion: true });
  const pend0 = (await api('/api/team')).j.approvals.length;
  const tr = await api('/api/team/skills/test', { id: W.id, agent: 'bobby' });
  ok('a test run checks: selection, tools, sources, running, steps followed, expected output, missing-info handling, drafts only, permissions', tr.j.ok && tr.j.results.length === 2 && tr.j.failed === 0 && tr.j.results[0].checks.some((c) => /Selects this skill/.test(c.name) && c.pass) && tr.j.results[0].checks.some((c) => /Matches what was expected/.test(c.name) && c.pass) && tr.j.results[1].checks.some((c) => /Asks instead of guessing/.test(c.name) && c.pass) && tr.j.results[0].checks.some((c) => /drafts for approval/.test(c.name) && c.pass) && tr.j.results[0].checks.some((c) => /Permissions untouched/.test(c.name) && c.pass), tr.j.results && tr.j.results.map((r) => r.checks.filter((c) => !c.pass).map((c) => c.name + ': ' + c.detail)));
  ok('…nothing was sent and no task was created by the test', (await api('/api/team')).j.approvals.length === pend0 && !(await api('/api/team/tasks')).j.tasks.some((t) => /Test run/.test(t.title)) && /dry run/.test(tr.j.note));
  const W6 = (await api('/api/team/skills')).j.items.find((s) => s.id === W.id);
  ok('each example remembers its last run and version', W6.examples.every((e) => e.lastRun && e.lastRun.pass && e.lastRun.version === W6.version), W6.examples.map((e) => e.lastRun));

  console.log('\n— from a finished task —');
  const t8 = (await api('/api/team/task', { agent: 'sarah', title: 'Refund reply for Ayşe', brief: 'Draft a refund email to ayse@example.com for the $240 order from 03/11/2026: apologise, confirm the refund, say it takes 5 days.', lang: 'en' })).j.task;
  const T8 = await settled(t8.id);
  const c8 = await api('/api/team/skills', { op: 'create', from: 'task', task: t8.id });
  const R = c8.j.skill;
  ok('a finished task becomes a skill: the procedure kept, the one-time details turned into inputs, the approval noted, the source task remembered', c8.j.ok && R.from.task === t8.id && !/ayse@example|\$240|03\/11\/2026/.test(JSON.stringify(S.docOf(R))) && R.inputs.indexOf('email address') >= 0 && R.inputs.indexOf('amount') >= 0 && R.tools.indexOf('email') >= 0 && /proposes to send|proposed, never done/.test(R.approvals), R);
  const t9 = (await api('/api/team/task', { agent: 'sarah', title: 'Refund', brief: 'Draft a refund email to mehmet@example.com for his $90 order: apologise and confirm the refund', lang: 'en' })).j.task;
  const T9 = await settled(t9.id);
  ok('…and the next similar request follows it', T9 && T9.steps[0].skill && T9.steps[0].skill.id === R.id, T9 && T9.steps[0].skill);

  console.log('\n— disable, archive, restore —');
  await api('/api/team/skills', { op: 'status', id: W.id, status: 'disabled' });
  const t10 = (await api('/api/team/task', { agent: 'bobby', title: 'Weekly ad report', brief: 'Use the Weekly ad report skill for last week', lang: 'en' })).j.task;
  const T10 = await settled(t10.id);
  ok('a disabled skill asked for by name: the step says it is disabled, the work is done without it', T10 && T10.steps[0].skill && T10.steps[0].skill.blocked === 'disabled' && /could not use the skill "Weekly ad report"/.test(T10.result), T10 && T10.steps[0].skill);
  await api('/api/team/skills', { op: 'status', id: W.id, status: 'archived' });
  const L2 = (await api('/api/team/skills')).j;
  ok('archived skills are counted apart and kept', L2.counts.archived === 1 && L2.items.find((s) => s.id === W.id).status === 'archived');
  const rs = await api('/api/team/skills', { op: 'status', id: W.id, status: 'active' });
  ok('restore brings it back with its versions', rs.j.skill.status === 'active' && rs.j.skill.versions.length >= 3);

  console.log('\n— the workspace —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  ok('the strip has a Skills button', await p.evaluate(() => !!document.querySelector('#flow-hud .hud-ag[data-hud="skills"]')));
  await p.click('#flow-hud .hud-ag[data-hud="skills"]'); await p.waitForTimeout(1500);
  const ws = await p.evaluate(() => ({ title: document.querySelector('#flow-hud .hud-brand b').textContent, rows: document.querySelectorAll('#flow-hud .hud-mi').length, tabs: document.querySelectorAll('#flow-hud .hud-tab').length, teach: !!document.querySelector('#flow-hud [data-hud="sknew"]') }));
  ok('the Skills workspace lists the skills with filters and a Teach button', ws.title === 'Skills' && ws.rows >= 2 && ws.tabs === 4 && ws.teach, ws);
  await p.click('#flow-hud .hud-mi .hud-mih[data-id="' + W.id + '"]'); await p.waitForTimeout(600);
  const det = await p.evaluate(() => ({ panels: [...document.querySelectorAll('#flow-hud .hud-right [data-k]')].map((x) => x.getAttribute('data-k')), steps: document.querySelectorAll('#flow-hud .hud-skdoc ol li').length, assign: document.querySelectorAll('#flow-hud form[data-team="skassign"] input[name="ag"]').length, versions: document.querySelectorAll('#flow-hud [data-k="skvers"] [data-hud="skcmp"]').length, fb: !!document.querySelector('#flow-hud form[data-team="skfeedback"]'), test: !!document.querySelector('#flow-hud form[data-team="sktestrun"]') }));
  ok('opening one shows the document, who may use it, test, feedback and versions', det.panels.indexOf('skview') >= 0 && det.steps >= 3 && det.assign >= 4 && det.versions >= 3 && det.fb && det.test, det);
  await p.click('#flow-hud [data-hud="skcmp"]'); await p.waitForTimeout(500);
  ok('Compare shows the diff with a way back', await p.evaluate(() => !!document.querySelector('#flow-hud .hud-skdiff') && !!document.querySelector('#flow-hud [data-hud="skrollback"]')));
  await p.click('#flow-hud [data-hud="skedit"]'); await p.waitForTimeout(500);
  ok('Edit opens the whole document as a form', await p.evaluate(() => !!document.querySelector('#flow-hud form[data-team="skedit"] textarea[name="steps"]') && !!document.querySelector('#flow-hud form[data-team="skedit"] input[name="name"]')));
  /* "turn that into a skill" in the console */
  const t11 = (await api('/api/team/task', { agent: 'tom', title: 'Monday standup notes', brief: 'Prepare the Monday standup notes for the dev team: yesterday, today, blockers.', lang: 'en' })).j.task;
  await settled(t11.id);
  await p.evaluate(() => { FlowTeam.openId = null; });
  await p.click('#flow-hud .hud-ag[data-ag="jarvis"]').catch(() => {}); await p.waitForTimeout(500);
  await p.fill('#sy-text', 'Turn the workflow we just completed into a reusable skill');
  await p.click('[data-say="send"]'); await p.waitForTimeout(2500);
  const said = await p.evaluate(() => ((FlowSay.history || []).slice(-1)[0] || {}).text || '');
  const L3 = (await api('/api/team/skills')).j;
  ok('"Turn the workflow we just completed into a reusable skill" writes the last finished task up as a skill and opens it for review', /is now a skill, version 1/.test(said) && L3.items.length >= 3 && await p.evaluate(() => FlowTeam.sel === 'skills' && !!document.querySelector('#flow-hud form[data-team="skedit"]')), said);
  ok('the task view shows the skill chip on the step', await p.evaluate(async (id) => { await FlowTeam.openTask(id); await new Promise((r) => setTimeout(r, 600)); return !!document.querySelector('#flow-hud .hud-step .hud-skc'); }, t5.id));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
