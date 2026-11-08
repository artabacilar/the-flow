/* =========================================================================
 * flow-efficiency.js — where the team wastes effort, what to change, and
 * proof that a change helped
 *
 * Reads what the other modules already record — every task's metrics
 * (model calls, tokens, estimated cost, retries, reads, questions, hand-overs,
 * plan and review calls), the knowledge store and its history, the agents'
 * instructions, skills and their runs, automations and their runs,
 * provenance (which pages and entries each reply used), approvals (edited,
 * declined) and the memory change log — and turns them into findings:
 *
 *   memory.conflict     two current entries, or an instruction and an entry,
 *                       about the same thing with different figures
 *   context.heavy       an agent's prompt carries many entries it never used
 *   skills.duplicate    two skills that look like the same procedure
 *   skills.missing      the same kind of request done by hand three times,
 *                       with no skill
 *   skills.unclear      a skill with no "when" or a single step
 *   reads.repeated      the same public page fetched again and again
 *   scripts.candidate   a routine, countable job done by a model each time
 *   calls.handover      a one-step delegation that still paid a hand-over
 *                       call
 *   calls.retries       a workflow that keeps retrying
 *   corrections.repeated  the person keeps editing the same agent's drafts,
 *                       or correcting the same fact
 *
 * Each finding carries its evidence (the records it was built from), the
 * tasks affected, a proposed change (and the exact action that applies it),
 * the expected benefit, and whether the cause is confirmed (seen in the
 * records) or a hypothesis. Nothing is applied by the review itself:
 * "recommended" and "applied" are kept apart, every applied change is
 * logged with before/after and can be reverted, and savings are stated only
 * when a baseline and a re-run were measured — the same examples, the same
 * inputs, side by side.
 *
 *   team:eff             { reviews: [...], applied: [...], findings: {key → status}, settingsHistory: [...] }
 *   team:eff:settings    orchestration switches read by flow-team
 *   team:eff:baselines   [{ id, name, examples, runs: [{ at, label, results, summary }] }]
 * ====================================================================== */
'use strict';

const crypto = require('crypto');
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');
const DAY = 86400000;
const STOP = new Set('the a an and or of to for in on at by with from this that these those is are was were be been it its as into about over under up down our your my their we you they i he she them us me will would should can could do does did done have has had not no yes please want need like make get go put take give use using every each all some any one two three new old now then also just very more most'.split(' '));
const terms = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}$€£%]+/gu, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ''));
const nums = (t) => (String(t || '').match(/\d[\d.,]*/g) || []).map((x) => x.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')).filter((x) => x !== '');
function sim(a, b) { const A = new Set(terms(a)), B = new Set(terms(b)); if (!A.size || !B.size) return 0; let n = 0; A.forEach((t) => { if (B.has(t)) n++; }); return n / Math.max(3, Math.min(A.size, B.size)); }
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

async function state(ctx) { const v = await ctx.get('team:eff'); const s = v && typeof v === 'object' ? v : {}; if (!Array.isArray(s.reviews)) s.reviews = []; if (!Array.isArray(s.applied)) s.applied = []; if (!s.findings || typeof s.findings !== 'object') s.findings = {}; if (!Array.isArray(s.settingsHistory)) s.settingsHistory = []; return s; }
async function save(ctx, s) { s.reviews = s.reviews.slice(-20); s.applied = s.applied.slice(-100); await ctx.set('team:eff', s); }
async function settings(ctx) { const v = await ctx.get('team:eff:settings'); return Object.assign({ skipHandoverSingle: false, maxReadRounds: 2, schedule: null }, v && typeof v === 'object' ? v : {}); }
async function baselines(ctx) { const v = await ctx.get('team:eff:baselines'); return Array.isArray(v) ? v : []; }
async function saveBaselines(ctx, list) { await ctx.set('team:eff:baselines', list.slice(-30)); }

/* ---------- the numbers ------------------------------------------------------ */
function workflowKey(t) { const k = (t.steps || []).map((s) => s.skill && s.skill.name).filter(Boolean)[0]; if (k) return 'skill:' + k; const sc = (t.steps || []).map((s) => s.run && s.run.name).filter(Boolean)[0]; if (sc) return 'script:' + sc; return 'task:' + terms(t.title).slice(0, 3).sort().join(' '); }
function metricsOf(tasks, scriptRuns, approvals, since) {
  const T = tasks.filter((t) => (t.createdAt || 0) >= since && /^(done|failed|awaiting_approval|cancelled)$/.test(t.status));
  const m = (t) => t.metrics || {};
  const per = (list) => {
    const done = list.filter((t) => t.status === 'done' || t.status === 'awaiting_approval'), failed = list.filter((t) => t.status === 'failed');
    const edited = approvals.filter((a) => a.edited && list.some((t) => t.id === a.task)).length, declined = approvals.filter((a) => a.status === 'rejected' && list.some((t) => t.id === a.task)).length;
    return { runs: list.length, ok: done.length, failed: failed.length, okRate: pct(done.length, list.length), calls: list.reduce((n, t) => n + (m(t).calls || 0), 0), tokens: list.reduce((n, t) => n + (m(t).in || 0) + (m(t).out || 0), 0), usd: Math.round(list.reduce((n, t) => n + (m(t).usd || 0), 0) * 1e4) / 1e4, retries: list.reduce((n, t) => n + (m(t).retries || 0), 0), reads: list.reduce((n, t) => n + (m(t).reads || 0), 0), questions: list.reduce((n, t) => n + (m(t).questions || 0), 0), handoffs: list.reduce((n, t) => n + (m(t).handoffs || 0), 0), interventions: list.reduce((n, t) => n + (m(t).questions || 0) + (m(t).handoffs || 0), 0) + edited + declined, edited, declined, avgMs: avg(list.map((t) => m(t).ms || ((t.doneAt || t.updatedAt || 0) - (t.startedAt || t.createdAt || 0))).filter((x) => x > 0)), avgCalls: avg(list.map((t) => m(t).calls || 0)), planCalls: list.reduce((n, t) => n + (m(t).planCalls || 0), 0), reviewCalls: list.reduce((n, t) => n + (m(t).reviewCalls || 0), 0), scripted: list.filter((t) => (t.steps || []).some((s) => s.model === 'script')).length, skilled: list.filter((t) => (m(t).skillUsed || 0) > 0).length };
  };
  const byAgent = {}; T.forEach((t) => { (t.steps || []).forEach((s) => { const k = s.model === 'script' ? 'script' : s.agent; (byAgent[k] = byAgent[k] || []).push(t); }); });
  const byWorkflow = {}; T.forEach((t) => { const k = workflowKey(t); (byWorkflow[k] = byWorkflow[k] || []).push(t); });
  const S = scriptRuns.filter((r) => (r.createdAt || 0) >= since && !r.dry);
  const scripts = { runs: S.length, ok: S.filter((r) => r.status === 'ok').length, partial: S.filter((r) => r.status === 'partial').length, failed: S.filter((r) => /^(failed|invalid)$/.test(r.status)).length, modelCalls: S.reduce((n, r) => n + ((r.metrics || {}).modelCalls || 0), 0), items: S.reduce((n, r) => n + ((r.metrics || {}).items || 0), 0), avgMs: avg(S.map((r) => (r.metrics || {}).ms || 0)) };
  return { since, total: per(T), byAgent: Object.keys(byAgent).reduce((o, k) => { o[k] = per(byAgent[k].filter((t, i, a) => a.indexOf(t) === i)); return o; }, {}), byWorkflow: Object.keys(byWorkflow).map((k) => Object.assign({ key: k, titles: byWorkflow[k].map((t) => t.title).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3) }, per(byWorkflow[k]))).sort((a, b) => (b.calls - a.calls) || (b.failed - a.failed)), scripts };
}

/* ---------- the findings ------------------------------------------------------- */
function finding(kind, key, f) { return Object.assign({ id: 'f' + crypto.createHash('sha1').update(kind + '|' + key).digest('hex').slice(0, 10), kind, key, confidence: 'confirmed', tasks: [], evidence: [], status: 'recommended' }, f); }

async function review(ctx, deps, opts) {
  const o = opts || {}; const now = Date.now(); const since = now - (o.days || 30) * DAY;
  const [tasks, approvals, know, agents, skillList, scriptList, scriptRuns, prov, memlog, S] = await Promise.all([deps.tasks(ctx), deps.approvals(ctx), deps.knowledge(ctx), deps.agents(ctx), deps.skills ? deps.skills(ctx) : [], deps.scripts ? deps.scripts(ctx) : [], deps.scriptRuns ? deps.scriptRuns(ctx) : [], deps.provenance ? deps.provenance(ctx) : [], deps.memlog ? deps.memlog(ctx) : [], state(ctx)]);
  const active = agents.filter((a) => !a.archived); const nameOf = (id) => (agents.find((a) => a.id === id) || {}).name || id;
  const recent = tasks.filter((t) => (t.createdAt || 0) >= since);
  const F = [];

  /* 1. conflicting or outdated memories */
  const cur = know.filter((k) => k.status !== 'superseded');
  for (let i = 0; i < cur.length; i++) for (let j = i + 1; j < cur.length; j++) {
    const a = cur[i], b = cur[j]; const na = nums(a.text), nb = nums(b.text); if (!na.length || !nb.length) continue;
    if (sim(a.text.replace(/\d[\d.,]*/g, ''), b.text.replace(/\d[\d.,]*/g, '')) >= 0.6 && na.join() !== nb.join()) {
      F.push(finding('memory.conflict', a.id + '|' + b.id, { title: 'Two current facts about the same thing disagree', agent: 'team', evidence: ['Memory ' + a.id + ' (since ' + new Date(a.validFrom || a.at).toISOString().slice(0, 10) + '): "' + a.text + '"', 'Memory ' + b.id + ' (since ' + new Date(b.validFrom || b.at).toISOString().slice(0, 10) + '): "' + b.text + '"'], tasks: prov.filter((p) => (p.knowledge || []).some((k) => k === a.id || k === b.id || (k && k.id === a.id) || (k && k.id === b.id))).map((p) => p.via).filter((v) => /^task:/.test(v)).map((v) => v.slice(5)).slice(0, 5), proposal: 'Correct it in Memory: state what is true now; the older entry is superseded with its dates and every agent sees one current figure.', action: { type: 'memory.correct', text: (a.validFrom || a.at) > (b.validFrom || b.at) ? a.text : b.text, older: (a.validFrom || a.at) > (b.validFrom || b.at) ? b.id : a.id }, benefit: 'No more answers that pick either figure; fewer corrections after the fact.', confidence: 'confirmed' }));
    }
  }
  for (const a of active) {
    const ins = String(a.instructions || ''); const inNums = nums(ins); if (!inNums.length) continue;
    for (const k of cur) { const kn = nums(k.text); if (!kn.length) continue; const sent = ins.split(/(?<=[.!?])\s+/).find((s) => nums(s).length && sim(s.replace(/\d[\d.,]*/g, ''), k.text.replace(/\d[\d.,]*/g, '')) >= 0.5); if (sent && nums(sent).join() !== kn.join()) F.push(finding('memory.conflict', a.id + '|' + k.id, { title: nameOf(a.id) + '\'s instructions carry a figure that disagrees with the team\'s current fact', agent: a.id, evidence: ['Instructions (' + nameOf(a.id) + '): "' + str(sent, 160) + '"', 'Memory ' + k.id + ': "' + k.text + '"'], tasks: recent.filter((t) => (t.steps || []).some((s) => s.agent === a.id)).map((t) => t.id).slice(0, 5), proposal: 'Run "Correct something" in Memory with the true figure: the instruction passage is rewritten in place (with history) and the fact stays in one place.', action: { type: 'memory.correct', text: k.text }, benefit: 'The agent stops quoting the stale figure; one source of truth instead of two.', confidence: 'confirmed' })); }
  }
  /* 2. heavy context: entries in the prompt that no reply has used */
  const used = new Set(); prov.forEach((p) => (p.knowledge || []).forEach((id) => { const k = know.find((x) => x.id === (id && id.id ? id.id : id)); if (!k) return; const ov = deps.overlap ? deps.overlap(p.reply || '', k.text) : null; if (ov ? (ov.words.length >= 2 || ov.nums.length) : sim(p.reply || '', k.text) >= 0.3) used.add(k.id); }));
  const shared = cur.filter((k) => k.scope === 'shared');
  if (shared.length >= 25 && prov.length >= 10) { const unused = shared.filter((k) => !used.has(k.id) && (now - (k.updated || k.at || now)) > 14 * DAY); if (unused.length >= 10) F.push(finding('context.heavy', 'shared', { title: shared.length + ' shared entries go into every prompt; ' + unused.length + ' were never used by any of the last ' + prov.length + ' replies', agent: 'team', evidence: unused.slice(0, 6).map((k) => k.id + ': "' + str(k.text, 90) + '"').concat(unused.length > 6 ? ['… and ' + (unused.length - 6) + ' more'] : []), proposal: 'Mark the unused entries superseded (kept as dated history) or move agent-specific ones to that agent\'s own notes.', action: { type: 'knowledge.supersede', ids: unused.map((k) => k.id) }, benefit: 'About ' + Math.round(unused.reduce((n, k) => n + k.text.length, 0) / 4) + ' fewer tokens per call for every agent — an estimate from character counts; real savings show up in the usage figures after a week.', confidence: 'hypothesis' })); }
  /* 3. skills: duplicates, unclear, missing */
  const act = skillList.filter((s) => s.status === 'active');
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) { const a = act[i], b = act[j]; const sm = sim(a.name + ' ' + a.purpose, b.name + ' ' + b.purpose); if (sm >= 0.6 || a.name.toLowerCase() === b.name.toLowerCase()) F.push(finding('skills.duplicate', a.id + '|' + b.id, { title: 'Two skills look like the same procedure: "' + a.name + '" and "' + b.name + '"', agent: 'team', evidence: ['"' + a.name + '" v' + a.version + ': ' + str(a.purpose, 120), '"' + b.name + '" v' + b.version + ': ' + str(b.purpose, 120), 'similarity ' + Math.round(sm * 100) + '%'], proposal: 'Keep the one that is used more, fold any extra steps into it, and archive the other — matching will then be unambiguous.', action: { type: 'skill.archive', id: (a.runs || []).length >= (b.runs || []).length ? b.id : a.id, keep: (a.runs || []).length >= (b.runs || []).length ? a.id : b.id }, benefit: 'One procedure per job; no coin-flip between near-identical skills.', confidence: 'hypothesis' })); }
  for (const s of act) { if (!s.when || s.steps.length < 2) F.push(finding('skills.unclear', s.id, { title: 'Skill "' + s.name + '" is ' + (!s.when ? 'missing "when to use it"' : 'a single step'), agent: s.assignedTo.length ? s.assignedTo.join(',') : 'team', evidence: ['when: ' + (s.when || '(empty)'), 'steps: ' + s.steps.length], proposal: !s.when ? 'Say what a matching request looks like, so it is selected when it should be and not otherwise.' : 'Spell out the procedure: steps and decision points, or make it a guide.', action: { type: 'skill.open', id: s.id }, benefit: 'Fewer wrong or missed selections.', confidence: 'confirmed' })); }
  const doneT = recent.filter((t) => t.status === 'done' && !(t.steps || []).some((s) => s.skill || s.model === 'script') && !(t.from && t.from.script));
  const groups = []; for (const t of doneT) { const g = groups.find((x) => sim(x.ref, t.title + ' ' + (t.brief || '')) >= 0.55); if (g) g.tasks.push(t); else groups.push({ ref: t.title + ' ' + (t.brief || ''), tasks: [t] }); }
  for (const g of groups.filter((x) => x.tasks.length >= 3)) {
    const txt = g.tasks.map((t) => t.title + ' ' + (t.brief || '') + ' ' + (t.result || '').slice(0, 400)).join(' ');
    const routine = /\b(report|total|sum|count|list|spend|expens|weekly|daily|every|numbers|streak|summary of this week)\b/i.test(txt) && !(approvals.some((a) => g.tasks.some((t) => t.id === a.task)));
    const calls = g.tasks.reduce((n, t) => n + ((t.metrics || {}).calls || 0), 0);
    if (routine) F.push(finding('scripts.candidate', g.tasks[0].id, { title: 'The same routine job was done by a model ' + g.tasks.length + ' times: "' + str(g.tasks[0].title, 60) + '"', agent: g.tasks[0].agent, tasks: g.tasks.map((t) => t.id), evidence: g.tasks.map((t) => t.title + ' · ' + new Date(t.createdAt).toISOString().slice(0, 10) + ' · ' + ((t.metrics || {}).calls || 0) + ' call' + (((t.metrics || {}).calls || 0) === 1 ? '' : 's')), proposal: 'Turn the repeatable part into an automation (a dry run first): it collects, counts and reports with no model; an agent is involved only for exceptions.', action: { type: 'script.create', task: g.tasks[g.tasks.length - 1].id }, benefit: calls ? 'Up to ' + calls + ' model calls over the period would have been 0, with the same rules every time — measured once the automation has run.' : 'Consistent results with no model calls.', confidence: 'hypothesis' }));
    else F.push(finding('skills.missing', g.tasks[0].id, { title: 'The same kind of request was done from scratch ' + g.tasks.length + ' times with no skill: "' + str(g.tasks[0].title, 60) + '"', agent: g.tasks[0].agent, tasks: g.tasks.map((t) => t.id), evidence: g.tasks.map((t) => t.title + ' · ' + new Date(t.createdAt).toISOString().slice(0, 10)), proposal: 'Teach it once as a skill from the best of these; the next request follows the same steps and quality bar.', action: { type: 'skill.create', task: g.tasks[g.tasks.length - 1].id }, benefit: 'Consistent output and fewer corrections; measured by the intervention rate on the next runs.', confidence: 'hypothesis' }));
  }
  /* 4. repeated reads of the same page */
  const reads = {}; prov.forEach((p) => (p.pages || []).forEach((u) => { const k = String(u).replace(/[?#].*$/, ''); (reads[k] = reads[k] || []).push(p); })); recent.forEach((t) => (t.steps || []).forEach((s) => (s.read || []).forEach((u) => { const k = String(u).replace(/[?#].*$/, ''); (reads[k] = reads[k] || []).push({ via: 'task:' + t.id, at: t.createdAt }); })));
  for (const u of Object.keys(reads)) { if (reads[u].length >= 3) F.push(finding('reads.repeated', u, { title: 'The same page was fetched ' + reads[u].length + ' times: ' + u.replace(/^https?:\/\//, '').slice(0, 60), agent: 'team', tasks: reads[u].map((p) => p.via).filter((v) => /^task:/.test(v)).map((v) => v.slice(5)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6), evidence: reads[u].slice(0, 6).map((p) => (p.via || '') + ' · ' + new Date(p.at || now).toISOString().slice(0, 16).replace('T', ' ')), proposal: 'If the page is stable, record what it says as a knowledge entry (dated). If it changes, an automation with web.read + compare fetches it once a day and tells you only what changed.', action: { type: 'script.read', url: u }, benefit: reads[u].length + ' fetches and the model turns to read them would have been one scheduled fetch.', confidence: 'confirmed' })); }
  /* 5. unnecessary calls: hand-over on one-step delegations, retries */
  const S0 = await settings(ctx);
  const single = recent.filter((t) => t.by === 'jarvis' && (t.steps || []).length === 1 && (t.metrics || {}).reviewCalls > 0);
  if (single.length >= 2 && !S0.skipHandoverSingle) F.push(finding('calls.handover', 'single', { title: single.length + ' one-step delegations each paid a hand-over call that only restated the specialist\'s work', agent: 'jarvis', tasks: single.map((t) => t.id).slice(0, 8), evidence: single.slice(0, 5).map((t) => t.title + ' · plan ' + ((t.metrics || {}).planCalls || 0) + ' + work ' + Math.max(0, ((t.metrics || {}).calls || 0) - ((t.metrics || {}).planCalls || 0) - ((t.metrics || {}).reviewCalls || 0)) + ' + hand-over ' + ((t.metrics || {}).reviewCalls || 0) + ' calls'), proposal: 'Skip the hand-over when a delegated task has one step: the specialist\'s result is the result. (A setting; reversible.)', action: { type: 'setting', key: 'skipHandoverSingle', value: true }, benefit: 'One model call fewer per such task — ' + single.reduce((n, t) => n + ((t.metrics || {}).reviewCalls || 0), 0) + ' over the period, measured.', confidence: 'confirmed' }));
  const M = metricsOf(tasks, scriptRuns, approvals, since);
  for (const w of M.byWorkflow) { if (w.retries >= 3 || (w.failed >= 2 && w.runs >= 3)) F.push(finding('calls.retries', w.key, { title: '"' + (w.titles[0] || w.key) + '" ' + (w.failed >= 2 ? 'failed ' + w.failed + ' of ' + w.runs + ' times' : 'needed ' + w.retries + ' retries over ' + w.runs + ' runs'), agent: 'team', tasks: tasks.filter((t) => workflowKey(t) === w.key).map((t) => t.id).slice(0, 8), evidence: tasks.filter((t) => workflowKey(t) === w.key && (t.error || (t.metrics || {}).retries)).slice(0, 5).map((t) => t.title + ' · ' + (t.error ? str(t.error, 100) : ((t.metrics || {}).retries || 0) + ' retries')), proposal: 'Look at the errors: a provider refusing the model (change it in the agent\'s room), a brief that needs an input (make it a skill input), or a page that cannot be read (record the fact or schedule a read).', action: { type: 'tasks.open', key: w.key }, benefit: 'Each retry is a full model call; failures cost the call and your time.', confidence: 'confirmed' })); }
  /* 6. repeated corrections */
  const editedBy = {}; approvals.filter((a) => a.edited && (a.decidedAt || 0) >= since).forEach((a) => { (editedBy[a.agent] = editedBy[a.agent] || []).push(a); });
  for (const ag of Object.keys(editedBy)) { if (editedBy[ag].length >= 2) F.push(finding('corrections.repeated', 'edited:' + ag, { title: 'You edited ' + editedBy[ag].length + ' of ' + nameOf(ag) + '\'s drafts before approving', agent: ag, tasks: editedBy[ag].map((a) => a.task).filter(Boolean).slice(0, 6), evidence: editedBy[ag].slice(0, 4).map((a) => a.summary + ' · edited ' + new Date(a.decidedAt).toISOString().slice(0, 10)), proposal: 'Say what you keep changing as one line in ' + nameOf(ag) + '\'s instructions (or the skill\'s "what good looks like"), so the draft arrives the way you want it.', action: { type: 'instructions.append', agent: ag, text: '' }, benefit: 'Fewer edits per approval; measured by the edit rate afterwards.', confidence: 'hypothesis' })); }
  const corr = {}; memlog.filter((l) => (l.at || 0) >= since && !l.restoreOf).forEach((l) => { const k = terms(l.text).slice(0, 3).sort().join(' '); (corr[k] = corr[k] || []).push(l); });
  for (const k of Object.keys(corr)) { if (corr[k].length >= 2) F.push(finding('corrections.repeated', 'memory:' + k, { title: 'The same fact was corrected ' + corr[k].length + ' times', agent: 'team', evidence: corr[k].slice(0, 4).map((l) => str(l.text, 100) + ' · ' + new Date(l.at).toISOString().slice(0, 10)), proposal: 'Check where the old version keeps coming from: an instruction, a skill source or a page. "Audit an instruction" in Memory lists every copy.', action: { type: 'memory.audit', text: corr[k][corr[k].length - 1].text }, benefit: 'The correction sticks.', confidence: 'confirmed' })); }

  /* statuses carried over; applied/dismissed ones stay out of the recommended list */
  for (const f of F) { const prev = S.findings[f.id]; if (prev) f.status = prev.status; }
  const summary = { tasks: recent.length, findings: F.length, recommended: F.filter((f) => f.status === 'recommended').length, confirmed: F.filter((f) => f.confidence === 'confirmed').length, byKind: F.reduce((o, f) => { o[f.kind] = (o[f.kind] || 0) + 1; return o; }, {}) };
  const R = { id: 'rv' + newId(), at: now, days: o.days || 30, trigger: o.trigger || 'manual', findings: F, metrics: M, summary, uncertainties: [
    'Costs are estimates from list prices per token; the providers\' invoices are the truth.',
    'Token savings from a lighter prompt are estimated from character counts until the usage figures move.',
    prov.length < 10 ? 'Fewer than 10 replies recorded: "never used" judgements are weak.' : '',
    !deps.toolsReady || !deps.toolsReady().browser ? 'The cloud browser is not connected here, so hand-overs to you are counted but could not have been avoided.' : ''
  ].filter(Boolean) };
  S.reviews.push(R); F.forEach((f) => { S.findings[f.id] = { status: f.status, kind: f.kind, title: f.title, seen: now }; }); await save(ctx, S);
  if (deps.log) await deps.log(ctx, 'team', 'Efficiency review: ' + F.length + ' finding' + (F.length === 1 ? '' : 's') + ' (' + summary.recommended + ' recommended) over ' + recent.length + ' tasks.');
  return R;
}

/* ---------- apply, dismiss, revert ---------------------------------------------- */
async function apply(ctx, deps, b) {
  const S = await state(ctx); const R = S.reviews.slice().reverse().find((r) => r.findings.some((f) => f.id === b.id)); const f = R && R.findings.find((x) => x.id === b.id); if (!f) return { error: 'No such finding.', status: 404 };
  const a = f.action || {}; const rec = { id: 'ap' + newId(), at: Date.now(), finding: f.id, kind: f.kind, title: f.title, action: a, before: null, after: null, revert: null, note: '' };
  if (a.type === 'setting') { const s = await settings(ctx); rec.before = { [a.key]: s[a.key] }; s[a.key] = a.value; rec.after = { [a.key]: a.value }; rec.revert = { type: 'setting', key: a.key, value: rec.before[a.key] }; await ctx.set('team:eff:settings', s); S.settingsHistory.push({ at: rec.at, key: a.key, from: rec.before[a.key], to: a.value }); rec.note = 'Setting changed: ' + a.key + ' = ' + a.value + '.'; }
  else if (a.type === 'knowledge.supersede') { if (!deps.supersede) return { error: 'Memory is not reachable.', status: 500 }; const done = []; for (const id of a.ids || []) { try { const r = await deps.supersede(ctx, id); if (r && r.ok) done.push(id); } catch (e) {} } rec.before = { current: done }; rec.after = { superseded: done }; rec.revert = { type: 'knowledge.restore', ids: done }; rec.note = done.length + ' entries marked superseded (kept as history).'; }
  else if (a.type === 'skill.archive') { if (!deps.skillStatus) return { error: 'Skills are not reachable.', status: 500 }; const r = await deps.skillStatus(ctx, a.id, 'archived'); if (r && r.error) return r; rec.before = { status: 'active' }; rec.after = { status: 'archived' }; rec.revert = { type: 'skill.status', id: a.id, status: 'active' }; rec.note = 'Skill archived; "' + ((r.skill || {}).name || a.id) + '" can be restored.'; }
  else if (a.type === 'skill.create') { if (!deps.skillCreate) return { error: 'Skills are not reachable.', status: 500 }; const r = await deps.skillCreate(ctx, a.task); if (r && r.error) return r; rec.after = { skill: r.skill.id, name: r.skill.name }; rec.revert = { type: 'skill.status', id: r.skill.id, status: 'archived' }; rec.note = 'Skill "' + r.skill.name + '" created (v1) — review it in Skills before it is followed.'; }
  else if (a.type === 'script.create') { if (!deps.scriptCreate) return { error: 'Automations are not reachable.', status: 500 }; const r = await deps.scriptCreate(ctx, a.task); if (r && r.error) return r; rec.after = { script: r.script.id, name: r.script.name }; rec.revert = { type: 'script.status', id: r.script.id, status: 'archived' }; rec.note = 'Automation "' + r.script.name + '" created, untested — run a dry run before scheduling it.'; }
  else if (a.type === 'script.read') { if (!deps.scriptCreateDoc) return { error: 'Automations are not reachable.', status: 500 }; const host = String(a.url).replace(/^https?:\/\//, '').split('/')[0]; const r = await deps.scriptCreateDoc(ctx, { name: 'Watch ' + host, purpose: 'Read ' + a.url + ' once a day and report only what changed', inputs: [{ name: 'page', label: 'The page', type: 'url', default: a.url }], steps: [{ op: 'web.read', url: '{{inputs.page}}' }, { op: 'compare', key: 'url' }, { op: 'report', template: 'Watch {{inputs.page}} — {{today}}\n{{text}}' }, { op: 'notify', template: '{{report}}', when: 'only if items' }], schedule: { kind: 'daily', at: '08:30' } }); if (r && r.error) return r; rec.after = { script: r.script.id, name: r.script.name }; rec.revert = { type: 'script.status', id: r.script.id, status: 'archived' }; rec.note = 'Automation "' + r.script.name + '" created (daily 08:30, untested) — dry-run it first.'; }
  else if (a.type === 'instructions.append') { const text = str(b.text || a.text, 300); if (!text) return { error: 'Say what to add to the instructions.', status: 400 }; if (!deps.appendInstructions) return { error: 'Agents are not reachable.', status: 500 }; const r = await deps.appendInstructions(ctx, a.agent, text); if (r && r.error) return r; rec.before = { instructions: r.before }; rec.after = { instructions: r.after }; rec.revert = { type: 'instructions.set', agent: a.agent, text: r.before }; rec.note = 'One line added to the instructions (the earlier version is kept).'; }
  else return { error: 'This finding is a pointer, not a one-click change: follow its proposal in Memory, Skills or the task view.', status: 400 };
  f.status = 'applied'; S.findings[f.id] = Object.assign(S.findings[f.id] || {}, { status: 'applied', appliedAt: rec.at }); S.applied.push(rec); await save(ctx, S);
  if (deps.log) await deps.log(ctx, 'team', 'Efficiency: applied — ' + rec.note);
  return { ok: true, applied: rec, finding: f };
}
async function revert(ctx, deps, b) {
  const S = await state(ctx); const rec = S.applied.find((x) => x.id === String(b.id || '')); if (!rec) return { error: 'No such change.', status: 404 }; if (rec.reverted) return { ok: true, applied: rec, already: true };
  const r = rec.revert || {};
  if (r.type === 'setting') { const s = await settings(ctx); s[r.key] = r.value; await ctx.set('team:eff:settings', s); S.settingsHistory.push({ at: Date.now(), key: r.key, from: rec.after[r.key], to: r.value, revertOf: rec.id }); }
  else if (r.type === 'knowledge.restore') { for (const id of r.ids || []) { try { await deps.restoreEntry(ctx, id); } catch (e) {} } }
  else if (r.type === 'skill.status') { await deps.skillStatus(ctx, r.id, r.status); }
  else if (r.type === 'script.status') { await deps.scriptStatus(ctx, r.id, r.status); }
  else if (r.type === 'instructions.set') { await deps.setInstructions(ctx, r.agent, r.text); }
  else return { error: 'This change cannot be reverted automatically.', status: 400 };
  rec.reverted = Date.now(); const fk = S.findings[rec.finding]; if (fk) fk.status = 'reverted'; S.reviews.forEach((rv) => rv.findings.forEach((f) => { if (f.id === rec.finding) f.status = 'reverted'; })); await save(ctx, S);
  if (deps.log) await deps.log(ctx, 'team', 'Efficiency: reverted — ' + rec.note);
  return { ok: true, applied: rec };
}
async function dismiss(ctx, deps, b) { const S = await state(ctx); const st = b.undo ? 'recommended' : 'dismissed'; S.findings[String(b.id)] = Object.assign(S.findings[String(b.id)] || {}, { status: st }); S.reviews.forEach((rv) => rv.findings.forEach((f) => { if (f.id === String(b.id)) f.status = st; })); await save(ctx, S); return { ok: true, status: st }; }

/* ---------- baselines: the same examples, before and after ------------------------ */
async function runExamples(ctx, deps, examples) {
  const out = [];
  for (const ex of examples.slice(0, 8)) {
    const t0 = Date.now(); let r;
    try { r = await deps.runStep(ctx, ex.agent, ex.brief); } catch (e) { r = { error: e.message }; }
    const text = String((r && (r.result || r.question)) || '');
    const et = terms(ex.expected || ''); const hit = et.filter((t) => new Set(terms(text)).has(t)).length;
    out.push({ agent: ex.agent, brief: ex.brief, ms: Date.now() - t0, ok: !(r && r.error), error: r && r.error, correct: et.length ? hit >= Math.ceil(et.length * 0.5) : !!(r && r.result), complete: !!(r && r.result && r.result.length > 40), asked: !!(r && r.question), expectQuestion: !!ex.expectQuestion, compliant: ex.expectSkill ? !!(r && r.skill) : (ex.expectQuestion ? !!(r && r.question) : true), skill: r && r.skill || null, calls: (r && r.calls) || 1, tokens: ((r && r.usage && r.usage.in) || 0) + ((r && r.usage && r.usage.out) || 0), usd: (r && r.usd) || 0, proposals: (r && r.proposals && r.proposals.length) || 0, result: str(text, 300) });
  }
  const summary = { n: out.length, ok: out.filter((x) => x.ok).length, correct: out.filter((x) => x.correct).length, complete: out.filter((x) => x.complete).length, compliant: out.filter((x) => x.compliant).length, asked: out.filter((x) => x.asked).length, interventions: out.filter((x) => x.asked && !x.expectQuestion).length + out.filter((x) => !x.ok).length, ms: out.reduce((n, x) => n + x.ms, 0), calls: out.reduce((n, x) => n + x.calls, 0), tokens: out.reduce((n, x) => n + x.tokens, 0), usd: Math.round(out.reduce((n, x) => n + x.usd, 0) * 1e4) / 1e4 };
  return { results: out, summary };
}
async function baseline(ctx, deps, b) {
  const list = await baselines(ctx);
  let B = list.find((x) => x.id === String(b.id || ''));
  if (!B) {
    const examples = (Array.isArray(b.examples) ? b.examples : []).map((e) => ({ agent: str(e.agent, 40), brief: block(e.brief, 2000), expected: str(e.expected, 300), expectQuestion: !!e.expectQuestion, expectSkill: !!e.expectSkill })).filter((e) => e.agent && e.brief).slice(0, 8);
    if (!examples.length) return { error: 'Give two or more representative examples (agent + request), including one with information missing.', status: 400 };
    B = { id: 'bl' + newId(), name: str(b.name, 80) || 'Baseline ' + new Date().toISOString().slice(0, 10), examples, runs: [], createdAt: Date.now() }; list.push(B);
  }
  if (!deps.runStep) return { error: 'No runner here.', status: 500 };
  const label = str(b.label, 60) || (B.runs.length ? 'after change ' + B.runs.length : 'baseline');
  const r = await runExamples(ctx, deps, B.examples);
  B.runs.push({ id: 'br' + newId(), at: Date.now(), label, results: r.results, summary: r.summary, settings: await settings(ctx) });
  B.runs = B.runs.slice(-10); await saveBaselines(ctx, list);
  if (deps.log) await deps.log(ctx, 'team', 'Efficiency: ran "' + B.name + '" (' + label + '): ' + r.summary.correct + '/' + r.summary.n + ' correct, ' + r.summary.calls + ' calls, ' + r.summary.tokens + ' tokens, ' + r.summary.ms + ' ms. Nothing sent.');
  return { ok: true, baseline: B, run: B.runs[B.runs.length - 1], comparison: compare(B) };
}
function compare(B) {
  if (!B.runs.length) return null; const first = B.runs[0], last = B.runs[B.runs.length - 1]; if (first === last) return { only: first.summary };
  const d = (k) => ({ before: first.summary[k], after: last.summary[k], delta: last.summary[k] - first.summary[k] });
  const rows = { correct: d('correct'), complete: d('complete'), compliant: d('compliant'), interventions: d('interventions'), ms: d('ms'), calls: d('calls'), tokens: d('tokens'), usd: d('usd') };
  const quality = rows.correct.delta >= 0 && rows.complete.delta >= 0 && rows.compliant.delta >= 0 && rows.interventions.delta <= 0;
  /* time counts as a saving only when it is clearly not noise: at least a second and a fifth */
  const cheaper = rows.calls.delta < 0 || rows.tokens.delta < 0 || (rows.ms.delta < 0 && -rows.ms.delta >= Math.max(1000, 0.2 * (first.summary.ms || 0)));
  return { before: first.label, after: last.label, rows, verdict: quality && cheaper ? 'keep: quality held and it costs less' : quality ? 'no measured saving — quality held, cost did not fall' : 'restore: quality fell — a cheaper failed run is not an improvement', quality, cheaper };
}

/* ---------- the view ------------------------------------------------------------------- */
async function overview(ctx, deps, o) {
  const [S, tasks, approvals, scriptRuns, s, bl] = await Promise.all([state(ctx), deps.tasks(ctx), deps.approvals(ctx), deps.scriptRuns ? deps.scriptRuns(ctx) : [], settings(ctx), baselines(ctx)]);
  const days = (o && +o.days) || 30; const M = metricsOf(tasks, scriptRuns, approvals, Date.now() - days * DAY);
  const last = S.reviews[S.reviews.length - 1] || null;
  return { ok: true, days, metrics: M, review: last ? Object.assign({}, last, { findings: last.findings.map((f) => Object.assign({}, f, { status: (S.findings[f.id] || {}).status || f.status })) }) : null, reviews: S.reviews.slice(-6).reverse().map((r) => ({ id: r.id, at: r.at, trigger: r.trigger, summary: r.summary })), applied: S.applied.slice(-20).reverse(), settings: s, settingsHistory: S.settingsHistory.slice(-10).reverse(), baselines: bl.map((B) => Object.assign({}, B, { comparison: compare(B) })) };
}
async function setSchedule(ctx, deps, b) { const s = await settings(ctx); s.schedule = b.on ? { kind: 'weekly', day: Math.max(0, Math.min(6, +b.day || 0)), at: /^\d{2}:\d{2}$/.test(String(b.at || '')) ? b.at : '08:30' } : null; await ctx.set('team:eff:settings', s); return { ok: true, schedule: s.schedule }; }
async function tick(ctx, deps, uid, now) {
  const s = await settings(ctx); if (!s.schedule) return 0; const L = deps.localParts(await deps.userTz(ctx), now || new Date());
  const [hh, mm] = s.schedule.at.split(':').map(Number); if (L.day !== s.schedule.day || L.minutes < hh * 60 + mm || L.minutes > hh * 60 + mm + 6 || s.lastScheduled === L.date) return 0;
  s.lastScheduled = L.date; await ctx.set('team:eff:settings', s);
  const R = await review(ctx, deps, { trigger: 'schedule weekly', days: 30 });
  if (deps.notify) { const top = R.findings.filter((f) => f.status === 'recommended').slice(0, 3); try { await deps.notify(uid, ctx, 'Efficiency review: ' + R.summary.findings + ' finding' + (R.summary.findings === 1 ? '' : 's') + ' over ' + R.summary.tasks + ' tasks' + (top.length ? '.\n' + top.map((f, i) => (i + 1) + '. ' + f.title).join('\n') : ' — nothing to change.') + '\n\nOpen the command centre → Efficiency to see the evidence and apply or dismiss.'); } catch (e) {} }
  return 1;
}

/* ---------- routes ---------------------------------------------------------------------- */
async function handle(p, req, res, ctx, deps) {
  if (p.indexOf('/api/team/efficiency') !== 0) return false;
  const json = ctx.json; const uid = ctx.user && ctx.user.id;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };
  const out = (r) => { if (r && r.error) json(res, r.status || 400, r); else json(res, 200, r); return true; };
  if (p === '/api/team/efficiency' && req.method === 'GET') return out(await overview(ctx, deps, { days: ctx.query.get('days') }));
  if (p === '/api/team/efficiency/review' && req.method === 'POST') { const b = await body(); return out({ ok: true, review: await review(ctx, deps, { days: +b.days || 30, trigger: 'manual' }) }); }
  if (p === '/api/team/efficiency/apply' && req.method === 'POST') return out(await apply(ctx, deps, await body()));
  if (p === '/api/team/efficiency/revert' && req.method === 'POST') return out(await revert(ctx, deps, await body()));
  if (p === '/api/team/efficiency/dismiss' && req.method === 'POST') return out(await dismiss(ctx, deps, await body()));
  if (p === '/api/team/efficiency/baseline' && req.method === 'POST') return out(await baseline(ctx, deps, await body()));
  if (p === '/api/team/efficiency/schedule' && req.method === 'POST') return out(await setSchedule(ctx, deps, await body()));
  if (p === '/api/team/efficiency/settings' && req.method === 'POST') { const b = await body(); const s = await settings(ctx); const S = await state(ctx); if (typeof b.skipHandoverSingle === 'boolean') { S.settingsHistory.push({ at: Date.now(), key: 'skipHandoverSingle', from: s.skipHandoverSingle, to: b.skipHandoverSingle }); s.skipHandoverSingle = b.skipHandoverSingle; } await ctx.set('team:eff:settings', s); await save(ctx, S); return out({ ok: true, settings: s }); }
  return false;
}

module.exports = { handle, review, apply, revert, dismiss, baseline, compare, overview, metricsOf, workflowKey, settings, tick, sim, terms, nums, _internals: { runExamples, finding } };
