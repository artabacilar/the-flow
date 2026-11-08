/* Memory auditing and conflict resolution.
 *
 * What would make it wrong: an answer whose source cannot be named; a
 * "source" the agent never saw presented as confirmed; a correction that
 * appends a new fact and leaves the old one active; the old figure still
 * returned as current by any agent, on any model; history lost, or shown
 * as if current; an instruction or J.A.R.V.I.S.'s memory still carrying the
 * old version; a permission level or platform rule changed by a memory
 * correction; a change that cannot be seen or undone; or "fixed" claimed
 * because a file was saved rather than because a fresh question proved it.
 * The amounts are test data. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const M = require('../flow-memory.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 320) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n— shapes —');
  const know = [{ id: 'k1', text: 'The onboarding service costs $1,000.', scope: 'shared', at: 1 }, { id: 'k2', text: 'Reply within one business day.', scope: 'shared', kind: 'rule', at: 1 }, { id: 'k3', text: 'Old: offices in Izmir.', scope: 'shared', status: 'superseded', validTo: 5, supersededBy: 'k4', at: 1 }, { id: 'k4', text: 'Offices in Istanbul.', scope: 'shared', at: 2 }, { id: 'k5', text: 'Tom prefers tabs.', scope: 'agent:tom', at: 1 }];
  const sec = M.section(know, 'sarah');
  ok('a specialist\'s prompt shows current facts with dates, rules apart, and superseded entries only as dated history', /current facts/.test(sec) && /k1 \| The onboarding service costs \$1,000\. \(since/.test(sec) && /RULES AND PROCEDURES[\s\S]*k2 \| Reply within one business day/.test(sec) && /SUPERSEDED[\s\S]*k3 \| Old: offices in Izmir\. \(was true until 1970-01-01; replaced by k4\)/.test(sec) && !/k5/.test(sec) && /never state these as current/.test(sec), sec);
  ok('another agent\'s own notes are not shown to this one; its own are', !/Tom prefers tabs/.test(sec) && /Tom prefers tabs/.test(M.section(know, 'tom')));
  const ov = M.overlap('The onboarding service costs $1,500.', 'The onboarding service costs $1,000.');
  ok('two statements about the same thing with different figures overlap on words, not on the figure', ov.words.length >= 2 && ov.nums.length === 0, ov);
  ok('the same figure is matched across formats', M.overlap('it was $1,000', 'price 1000 USD').nums.length === 1);

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
    await Flow.Settings.set('asstMemory', [{ id: 'm1', text: 'The onboarding service is $1,000 for new salons.', at: new Date().toISOString() }, { id: 'm2', text: 'Artur likes short answers.', at: new Date().toISOString() }]);
  });
  await p.waitForTimeout(1200);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);

  console.log('\n— the sources —');
  await api('/api/team');   /* the team exists */
  const k1 = (await api('/api/team/knowledge', { op: 'add', text: 'The onboarding service costs $1,000.', scope: 'shared' })).j.item;
  await api('/api/team/knowledge', { op: 'add', text: 'Always reply within one business day.', scope: 'shared' });
  await api('/api/team/agent/update', { id: 'sarah', instructions: 'Be warm and brief. Quote the onboarding service at $1,000 when asked. Never promise delivery dates.' });
  const list0 = (await api('/api/team/memory')).j;
  const srcs = new Set(list0.items.map((i) => i.source));
  ok('the workspace lists every source it can read: team knowledge, J.A.R.V.I.S.\'s memory, instructions, preferences and platform rules', srcs.has('knowledge') && srcs.has('memory') && srcs.has('instructions') && srcs.has('preferences') && srcs.has('platform'), [...srcs]);
  ok('platform rules are labelled protected and not editable; knowledge and instructions are editable', list0.items.filter((i) => i.source === 'platform').every((i) => i.protected && !i.editable) && list0.items.filter((i) => i.source === 'knowledge' || i.source === 'instructions').every((i) => i.editable));
  ok('an entry carries kind, scope, status and a since-date', list0.items.some((i) => i.id === k1.id && i.kind === 'fact' && i.scope === 'shared' && i.status === 'current' && /^\d{4}-\d{2}-\d{2}$/.test(i.since)), list0.items.find((i) => i.id === k1.id));
  const srch = (await api('/api/team/memory?q=onboarding')).j;
  ok('search finds the fact, the instruction and the memory item about the same thing', srch.items.some((i) => i.source === 'knowledge' && /onboarding/.test(i.text)) && srch.items.some((i) => i.source === 'instructions') && srch.items.some((i) => i.source === 'memory' && /onboarding/.test(i.text)), srch.items.map((i) => i.source));

  console.log('\n— where did that come from? —');
  const a1 = await api('/api/team/say', { agent: 'sarah', text: 'What does the onboarding service cost?', lang: 'en' });
  ok('Sarah answers from the current fact', a1.j.ok && /\$1,000/.test(a1.j.say), a1.j.say);
  const t1 = await api('/api/team/memory/trace', { agent: 'sarah' });
  ok('the trace names the knowledge entry and the instruction passage as confirmed sources, with the matched figure', t1.j.ok && t1.j.confirmed.some((c) => c.source === 'knowledge' && c.id === k1.id && c.matched.some((m) => /1000|1,000/.test(m))) && t1.j.confirmed.some((c) => c.source === 'instructions' && /\$1,000/.test(c.passage)), t1.j.confirmed);
  ok('…says what it did not inspect (the model\'s own training) rather than pretending', t1.j.notInspected.some((n) => /model's own training/.test(n)) && /Supported by/.test(t1.j.explanation));
  ok('…and nothing the agent was not shown appears as confirmed', !t1.j.confirmed.some((c) => c.source === 'memory'), t1.j.confirmed.map((c) => c.source));
  const t2 = await api('/api/team/memory/trace', { agent: 'sarah', claim: 'We have forty staff in Ankara.' });
  ok('a claim nothing supports is reported as unsupported, with the likely origin named', t2.j.ok && t2.j.confirmed.length === 0 && /Nothing in the prompt matches/.test(t2.j.explanation), t2.j.explanation);
  const t3 = await api('/api/team/memory/trace', { agent: 'bobby' });
  ok('no recorded answer → says so, 404', t3.status === 404 && /No recorded answer/.test(t3.j.error));
  /* in the console, as a question */
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  await p.click('#flow-hud .hud-ag[data-ag="sarah"]'); await p.waitForTimeout(700);
  await p.fill('#sy-text', 'Where did that information come from?');
  await p.click('[data-say="send"]'); await p.waitForTimeout(1800);
  const said = await p.evaluate(() => ((FlowSay.history || []).slice(-1)[0] || {}).text || '');
  ok('asked in the console, the answer comes from the record — "That came from the team\'s knowledge…" — and opens Memory', /That came from the team's knowledge/.test(said) && await p.evaluate(() => FlowTeam.sel === 'memory' && !!document.querySelector('#flow-hud [data-k="trace"] .hud-src.hit')), said);

  console.log('\n— audit an instruction —');
  const au = await api('/api/team/memory/audit', { about: 'Quote the onboarding service at $1,000' });
  const rows = au.j.proposal.rows;
  ok('the audit table has every copy with source, content, why and a proposed correction', au.j.ok && rows.length >= 3 && rows.every((r) => r.source && r.content && r.why && r.proposed) && rows.some((r) => r.source === 'knowledge') && rows.some((r) => r.source === 'instructions' && r.agent === 'Sarah') && rows.some((r) => r.source === 'memory'), rows.map((r) => r.source + ':' + r.action));
  const au2 = await api('/api/team/memory/audit', { about: 'every outside action needs a yes before sending' });
  ok('a platform rule shows up protected: visible, never editable, "unchanged"', au2.j.proposal.rows.some((r) => r.source === 'platform' && r.protected && r.action === 'protected' && /Unchanged/.test(r.proposed)), au2.j.proposal.rows.filter((r) => r.source === 'platform'));

  console.log('\n— the correction —');
  const perm0 = (await api('/api/team')).j.agents.find((a) => a.id === 'sarah').permissions;
  const c1 = await api('/api/team/memory/correct', { text: 'The onboarding service costs $1,500.' });
  const pr = c1.j.proposal;
  ok('a correction is a proposal first: the old fact to supersede, Sarah\'s instruction to rewrite, his memory item to rewrite', c1.j.ok && pr.rows.some((r) => r.source === 'knowledge' && r.id === k1.id && r.action === 'supersede') && pr.rows.some((r) => r.source === 'instructions' && r.action === 'replace') && pr.rows.some((r) => r.source === 'memory' && r.action === 'replace') && !pr.applied, pr.rows.map((r) => r.source + ':' + r.action));
  ok('the unrelated rule is not in the proposal', !pr.rows.some((r) => /business day/.test(r.content)));
  ok('the summary says what will happen', /1 knowledge entry to mark superseded/.test(c1.j.summary) && /2 passages to rewrite/.test(c1.j.summary), c1.j.summary);
  const ap = await api('/api/team/memory/apply', { id: pr.id });
  ok('applied: one add, one supersede, two replacements — and a verification report', ap.j.ok && ap.j.changes.filter((c) => c.op === 'add').length === 1 && ap.j.changes.filter((c) => c.op === 'supersede').length === 1 && ap.j.changes.filter((c) => c.op === 'replace').length === 2 && ap.j.verification && ap.j.verification.failed === 0, ap.j.changes);
  const kn = (await api('/api/team')).j.knowledge;
  const oldK = kn.find((k) => k.id === k1.id), newK = kn.find((k) => k.id === ap.j.entry.id);
  ok('the old entry is superseded, dated, pointing at the new one; the new one is current and points back', oldK.status === 'superseded' && oldK.validTo && oldK.supersededBy === newK.id && newK.status === 'current' && newK.supersedes.indexOf(k1.id) >= 0 && newK.text === 'The onboarding service costs $1,500.', { oldK, newK });
  const sarah = (await api('/api/team')).j.agents.find((a) => a.id === 'sarah');
  ok('Sarah\'s instructions now carry the correction and not the old figure, with the earlier version kept', /\$1,500/.test(sarah.instructions) && !/\$1,000/.test(sarah.instructions) && /Be warm and brief/.test(sarah.instructions) && /Never promise delivery dates/.test(sarah.instructions) && sarah.instrHistory.length === 1 && /\$1,000/.test(sarah.instrHistory[0].before), sarah.instructions);
  ok('her permissions did not change', sarah.permissions === perm0);
  const mem = (await api('/api/team/memory')).j.items.filter((i) => i.source === 'memory');
  ok('J.A.R.V.I.S.\'s memory item is rewritten; the unrelated one untouched', mem.some((m) => /\$1,500/.test(m.text)) && !mem.some((m) => /\$1,000/.test(m.text)) && mem.some((m) => /short answers/.test(m.text)), mem.map((m) => m.text));
  const v = ap.j.verification;
  ok('the report checked each agent\'s actual prompt: corrected fact current, old version absent or history only, instructions clean, memory clean, history dated, model-independence, permissions', v.checks.some((c) => /Sarah is shown the corrected fact as current/.test(c.name) && c.pass) && v.checks.some((c) => /old version is not shown to Sarah/.test(c.name) && c.pass && /SUPERSEDED/.test(c.detail)) && v.checks.some((c) => /Sarah's instructions no longer/.test(c.name) && c.pass) && v.checks.some((c) => /memory of you no longer/.test(c.name) && c.pass) && v.checks.some((c) => /History is kept/.test(c.name) && c.pass) && v.checks.some((c) => /model change/.test(c.name)) && v.checks.some((c) => /Permissions unchanged/.test(c.name)), v.checks.map((c) => c.name + ':' + c.pass));
  ok('…and names what it could not check instead of claiming it', v.inaccessible.length >= 1 && /Flow record/.test(v.inaccessible[0]));

  console.log('\n— does it hold? fresh questions, through the real path —');
  const q1 = await api('/api/team/say', { agent: 'sarah', text: 'What does the onboarding service cost now?', lang: 'en' });
  ok('Sarah now answers $1,500', /\$1,500/.test(q1.j.say) && !/\$1,000/.test(q1.j.say), q1.j.say);
  const q2 = await api('/api/team/say', { agent: 'tom', text: 'How much is the onboarding service?', lang: 'en' });
  ok('so does Tom — the shared knowledge reached every specialist', /\$1,500/.test(q2.j.say) && !/\$1,000/.test(q2.j.say), q2.j.say);
  const q3 = await api('/api/team/say', { agent: 'sarah', text: 'What did the onboarding service cost last year?', lang: 'en' });
  ok('a question about the past gets the old figure with its dates — as history, not as current', /\$1,000/.test(q3.j.say) && /was true until \d{4}-\d{2}-\d{2}/.test(q3.j.say), q3.j.say);
  await api('/api/team/agent/update', { id: 'sarah', model: 'gpt-5' });
  const q4 = await api('/api/team/say', { agent: 'sarah', text: 'What is the price of the onboarding service?', lang: 'en' });
  ok('switching Sarah to another provider\'s model keeps the correction', q4.j.ok && q4.j.model === 'gpt-5' && /\$1,500/.test(q4.j.say) && !/\$1,000/.test(q4.j.say), q4.j);
  await api('/api/team/agent/update', { id: 'sarah', model: 'claude-sonnet-4-5' });
  const vv = await api('/api/team/memory/verify', { newText: 'The onboarding service costs $1,500.', oldTexts: ['The onboarding service costs $1,000.'], entryId: newK.id, ask: 'What does the onboarding service cost?', agent: 'sarah' });
  ok('verify can ask a fresh question through the retrieval path and judge the answer, without writing to the thread', vv.j.ok && vv.j.checks.some((c) => /fresh question/.test(c.name) && c.pass && /\$1,500/.test(c.detail)), vv.j.checks.filter((c) => /fresh/.test(c.name)));
  const th = (await api('/api/team/thread?agent=sarah')).j.messages;
  ok('…the verification question did not land in Sarah\'s thread', !th.some((m) => m.role === 'user' && m.text === 'What does the onboarding service cost?' && th.indexOf(m) > 6), th.length);
  const t4 = await api('/api/team/memory/trace', { agent: 'sarah' });
  ok('the trace of the new answer points at the new current entry, not the superseded one', t4.j.confirmed.some((c) => c.id === newK.id) && !t4.j.confirmed.some((c) => c.id === k1.id && c.status !== 'superseded'), t4.j.confirmed.map((c) => c.id + ':' + c.status));

  console.log('\n— history, restore, edits —');
  const hist = (await api('/api/team/memory/history?id=' + k1.id)).j;
  ok('an entry\'s versions and what replaced it are readable', hist.ok && hist.versions.length >= 1 && hist.supersededBy && hist.supersededBy.id === newK.id, hist);
  const logs = (await api('/api/team/memory')).j.log;
  ok('the change log has the correction with before/after per change', logs.length >= 1 && logs[0].changes.some((c) => c.op === 'supersede' && /1,000/.test(c.before) && /1,500/.test(c.after)), logs[0]);
  const rs = await api('/api/team/memory/restore', { id: logs[0].id });
  const kn2 = (await api('/api/team')).j.knowledge;
  const sarah2 = (await api('/api/team')).j.agents.find((a) => a.id === 'sarah');
  ok('restore undoes it all: old current again, new superseded, instructions and memory back', rs.j.ok && kn2.find((k) => k.id === k1.id).status === 'current' && kn2.find((k) => k.id === newK.id).status === 'superseded' && /\$1,000/.test(sarah2.instructions) && (await api('/api/team/memory')).j.items.some((i) => i.source === 'memory' && /\$1,000/.test(i.text)), { k1: kn2.find((k) => k.id === k1.id).status, instr: sarah2.instructions });
  const q5 = await api('/api/team/say', { agent: 'sarah', text: 'What does the onboarding service cost?', lang: 'en' });
  ok('…and the agents follow the restore too', /\$1,000/.test(q5.j.say), q5.j.say);
  /* re-apply by a fresh correction, then direct edits */
  const c2 = await api('/api/team/memory/correct', { text: 'The onboarding service costs $1,500.' });
  await api('/api/team/memory/apply', { id: c2.j.proposal.id });
  const ed = await api('/api/team/memory/edit', { id: k1.id, op: 'restore' });
  ok('an entry can be made current again by hand (a version is recorded)', ed.j.ok && ed.j.item.status === 'current' && ed.j.item.history.some((h) => /restored/.test(h.why)));
  await api('/api/team/memory/edit', { id: k1.id, op: 'supersede' });
  const ed2 = await api('/api/team/memory/edit', { id: ap.j.entry.id, op: 'edit', text: 'The onboarding service costs $1,500 (ex VAT).', kind: 'fact' });
  ok('editing keeps the earlier text as a version', ed2.j.ok && ed2.j.item.text === 'The onboarding service costs $1,500 (ex VAT).' && ed2.j.item.history.some((h) => h.text === 'The onboarding service costs $1,500.'));
  const rm = await api('/api/team/memory/edit', { id: 'nope', op: 'remove' });
  ok('removing nothing is a 404', rm.status === 404);

  console.log('\n— the workspace —');
  await p.evaluate(() => FlowHud.close()); await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  ok('the strip has a Memory button', await p.evaluate(() => !!document.querySelector('#flow-hud .hud-ag[data-hud="memory"]')));
  await p.click('#flow-hud .hud-ag[data-hud="memory"]'); await p.waitForTimeout(1500);
  const ws = await p.evaluate(() => ({ title: document.querySelector('#flow-hud .hud-brand b').textContent, list: !!document.querySelector('#flow-hud [data-k="memlist"]'), rows: document.querySelectorAll('#flow-hud .hud-mi').length, panels: [...document.querySelectorAll('#flow-hud .hud-right [data-k]')].map((x) => x.getAttribute('data-k')), tabs: document.querySelectorAll('#flow-hud .hud-tab').length }));
  ok('the Memory workspace: sources list with filters; trace, correct, audit and changes panels', ws.title === 'Memory' && ws.list && ws.rows >= 3 && ws.tabs === 4 && ws.panels.indexOf('trace') >= 0 && ws.panels.indexOf('correct') >= 0 && ws.panels.indexOf('audit') >= 0 && ws.panels.indexOf('memlog') >= 0, ws);
  await p.click('#flow-hud .hud-tab[data-f="superseded"]'); await p.waitForTimeout(400);
  ok('the Superseded tab shows the old entries struck through', await p.evaluate(() => document.querySelectorAll('#flow-hud .hud-mi.old').length >= 1 && [...document.querySelectorAll('#flow-hud .hud-mi.old .hud-badge')].every((b) => /Superseded/.test(b.textContent))));
  await p.click('#flow-hud .hud-tab[data-f="current"]'); await p.waitForTimeout(300);
  await p.fill('#flow-hud form[data-team="memcorrect"] textarea', 'Always reply within two business days.');
  await p.click('#flow-hud form[data-team="memcorrect"] button[type="submit"]'); await p.waitForTimeout(1500);
  const tbl = await p.evaluate(() => ({ rows: document.querySelectorAll('#flow-hud .hud-tbl .hud-tr-r').length, heads: [...document.querySelectorAll('#flow-hud .hud-tr-h span')].map((x) => x.textContent), ticks: document.querySelectorAll('#flow-hud [data-mem-row]').length, apply: !!document.querySelector('#flow-hud [data-hud="memapply"]') }));
  ok('a correction typed in the workspace shows the conflict table (Source · Conflicting content · Why · Proposed) with ticks and an Apply button', tbl.rows >= 1 && tbl.heads.join('|') === 'Source|Conflicting content|Why it conflicts|Proposed correction' && tbl.ticks >= 1 && tbl.apply, tbl);
  await p.click('#flow-hud [data-hud="memapply"]'); await p.waitForTimeout(2000);
  const rep = await p.evaluate(() => ({ applied: /Applied\./.test(document.querySelector('#flow-hud [data-k="correct"]').textContent), checks: document.querySelectorAll('#flow-hud .hud-ck').length, fails: document.querySelectorAll('#flow-hud .hud-ck[data-ok="0"]').length, ask: !!document.querySelector('#flow-hud form[data-team="memverify"]') }));
  ok('Apply shows the report: every check listed, none failing, and a box to prove it with a fresh question', rep.applied && rep.checks >= 6 && rep.fails === 0 && rep.ask, rep);
  const rule = (await api('/api/team')).j.knowledge.filter((k) => /business day/.test(k.text));
  ok('the rule was superseded by the new rule, as a rule', rule.some((k) => /one business day/.test(k.text) && k.status === 'superseded') && rule.some((k) => /two business days/.test(k.text) && k.status === 'current' && k.kind === 'rule'), rule.map((k) => k.text + ':' + k.status + ':' + k.kind));
  ok('the Changes panel lists it with Restore', await p.evaluate(() => [...document.querySelectorAll('#flow-hud [data-k="memlog"] .hud-lg')].some((x) => /two business days/.test(x.textContent) && x.querySelector('[data-hud="memrestore"]'))));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
