/* =========================================================================
 * flow-skills.js — reusable skills: how the team is taught recurring work
 *
 * A skill is an instruction document the person can read and edit, kept in
 * the account's store (team:skills), never inside a model. Two kinds:
 *   workflow  an ordered procedure with decision points — "the weekly ad
 *             report", "answer a refund request"
 *   guide     how to handle a kind of information — "how we talk about
 *             prices", "what counts as an urgent ticket"
 *
 * Every skill carries: name · purpose · when to use / when not · inputs ·
 * steps (with decision points) · tools and sources it relies on · the
 * expected output and what good looks like · exceptions, what to do when
 * information is missing, and what needs the person's yes. Facts live in
 * the team's knowledge (flow-memory.js), not in skills: a skill points at
 * the knowledge entries it relies on and the prompt shows their CURRENT
 * text, so a corrected price never has to be corrected again in a skill.
 *
 * Choosing: J.A.R.V.I.S. may name a skill per step when he plans; the
 * person may invoke one directly ("use the Weekly ad report skill"); and
 * otherwise a step is matched against the active skills its agent may use,
 * on the words of the request against the skill's name, purpose and "when"
 * — minus its "when not". A chosen skill and its version are written on
 * the step, in the activity log, and in the skill's own run history, so
 * "which procedure did you follow?" has an answer. A skill that applies but
 * cannot run here (a tool that is not connected, a disabled skill, a name
 * nobody has) is said so to the agent, who says so to the person.
 *
 * Teaching: from a description, from examples, or from a finished task
 * ("turn the workflow we just completed into a skill"): the one-time details
 * — addresses, amounts, dates, links — become inputs, and the procedure
 * stays. Improving: feedback is sorted into this-output-only (nothing
 * saved), a change to the procedure (a proposed edit to the skill, shown
 * as a diff, checked for contradictions and duplicates, applied as a new
 * version with the old kept for rollback) or a broader preference (sent to
 * the team's knowledge as a preference entry, not hidden in one skill).
 *
 * Permissions: a skill never carries a credential (anything that looks like
 * one is refused on save) and never widens what an agent may do — the
 * agent's own permission level and the approval rule apply to every step a
 * skill describes. Creating or sharing a skill authorises nothing: a test
 * run returns proposals as drafts and sends nothing.
 * ====================================================================== */
'use strict';

const crypto = require('crypto');
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');
const lines = (v, n, each) => (Array.isArray(v) ? v : String(v == null ? '' : v).split('\n')).map((x) => str(typeof x === 'string' ? x.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '') : (x && (x.text || x.label)) || '', each || 400)).filter(Boolean).slice(0, n);

const TYPES = ['workflow', 'guide'];
const STATUSES = ['active', 'disabled', 'archived'];
const TOOL_IDS = ['flow', 'web', 'browser', 'email'];
const TOOL_NAMES = { flow: 'The Flow (the person\'s record)', web: 'Web reader', browser: 'Cloud browser', email: 'Email (after approval)' };
const DOC_FIELDS = ['name', 'purpose', 'type', 'when', 'whenNot', 'inputs', 'steps', 'tools', 'sources', 'output', 'quality', 'exceptions', 'approvals'];
const MAX_SKILLS = 200;

/* Nothing that looks like a secret is ever stored in a skill. */
const SECRET = /\b(?:sk|rk|re|xox[abp]|ghp|AKIA)[-_][A-Za-z0-9_-]{12,}|\b(?:password|passcode|şifre|parola|api[ -]?key|secret|token)\b\s*[:=]\s*\S{6,}|\b\d(?:[ -]?\d){12,18}\b/i;
function secretish(doc) {
  const flat = DOC_FIELDS.map((f) => Array.isArray(doc[f]) ? doc[f].map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join('\n') : String(doc[f] || '')).join('\n');
  return SECRET.test(flat);
}

/* ---------- shape ----------------------------------------------------------- */
function cleanDoc(d) {
  d = d && typeof d === 'object' ? d : {};
  const sources = (Array.isArray(d.sources) ? d.sources : lines(d.sources, 20).map((s) => /^https?:\/\//i.test(s) ? { kind: 'url', url: s, label: s } : /^k[0-9a-f]{10}$/.test(s) ? { kind: 'knowledge', id: s } : { kind: 'note', label: s }))
    .map((s) => s && typeof s === 'object' ? (s.kind === 'knowledge' && /^k[0-9a-f]{6,}$/.test(String(s.id || '')) ? { kind: 'knowledge', id: String(s.id) } : s.kind === 'url' && /^https?:\/\//i.test(String(s.url || '')) ? { kind: 'url', url: str(s.url, 500), label: str(s.label, 120) || str(s.url, 120) } : str(s.label || s.text, 200) ? { kind: 'note', label: str(s.label || s.text, 200) } : null) : null)
    .filter(Boolean).slice(0, 20);
  return {
    name: str(d.name, 80), purpose: block(d.purpose, 600), type: TYPES.indexOf(d.type) >= 0 ? d.type : 'workflow',
    when: block(d.when, 600), whenNot: block(d.whenNot, 600),
    inputs: lines(d.inputs, 20, 200), steps: lines(d.steps, 30, 600),
    tools: (Array.isArray(d.tools) ? d.tools : lines(d.tools, 6)).map((t) => String(t).toLowerCase()).filter((t) => TOOL_IDS.indexOf(t) >= 0).filter((t, i, a) => a.indexOf(t) === i),
    sources, output: block(d.output, 800), quality: block(d.quality, 800), exceptions: block(d.exceptions, 800), approvals: block(d.approvals, 600)
  };
}
function docOf(s) { const o = {}; DOC_FIELDS.forEach((f) => { o[f] = s[f]; }); return cleanDoc(o); }
function norm(s) {
  if (!s || typeof s !== 'object') return null;
  Object.assign(s, docOf(s));
  s.status = STATUSES.indexOf(s.status) >= 0 ? s.status : 'active';
  s.version = Math.max(1, +s.version || 1);
  if (!Array.isArray(s.versions)) s.versions = [];
  if (!Array.isArray(s.assignedTo)) s.assignedTo = [];
  if (!Array.isArray(s.examples)) s.examples = [];
  if (!Array.isArray(s.runs)) s.runs = [];
  return s;
}
async function all(ctx) { const v = await ctx.get('team:skills'); return (Array.isArray(v) ? v : []).map(norm).filter(Boolean); }
async function save(ctx, list) { await ctx.set('team:skills', list.slice(-MAX_SKILLS)); }
async function proposals(ctx) { const v = await ctx.get('team:skillprops'); return Array.isArray(v) ? v : []; }
async function saveProposals(ctx, list) { await ctx.set('team:skillprops', list.slice(-100)); }

/* Which skills this agent may use: active, and shared or assigned to it. */
const usable = (list, agentId) => list.filter((s) => s.status === 'active' && (!s.assignedTo.length || s.assignedTo.indexOf(agentId) >= 0));

/* ---------- the document as the model reads it ------------------------------ */
function text(s, know) {
  const K = Array.isArray(know) ? know : [];
  const src = s.sources.map((x) => {
    if (x.kind === 'knowledge') { const k = K.find((e) => e.id === x.id); return k ? '· [' + k.id + '] ' + k.text + (k.status === 'superseded' ? ' (SUPERSEDED — do not use)' : '') : '· [' + x.id + '] (this knowledge entry no longer exists — ask rather than assume)'; }
    if (x.kind === 'url') return '· ' + x.label + ' — ' + x.url + ' (read it with "read")';
    return '· ' + x.label;
  });
  return [
    'SKILL TO FOLLOW: ' + s.name + ' (v' + s.version + ', ' + s.type + ')',
    'Purpose: ' + s.purpose,
    s.when ? 'Use it when: ' + s.when : '', s.whenNot ? 'Do not use it when: ' + s.whenNot : '',
    s.inputs.length ? 'Inputs needed: ' + s.inputs.join('; ') : '',
    s.steps.length ? (s.type === 'guide' ? 'Guidance:' : 'Steps, in order:') + '\n' + s.steps.map((st, i) => (i + 1) + '. ' + st).join('\n') : '',
    s.tools.length ? 'Tools it relies on: ' + s.tools.map((t) => TOOL_NAMES[t] || t).join(', ') : '',
    src.length ? 'Sources to rely on (their current text is what counts; never copy old figures from memory):\n' + src.join('\n') : '',
    s.output ? 'Expected output: ' + s.output : '', s.quality ? 'What good looks like: ' + s.quality : '',
    s.exceptions ? 'Exceptions and missing information: ' + s.exceptions : '',
    'Approvals: ' + (s.approvals || 'anything that would reach the outside world') + ' — propose, never do. This skill does not change what you are allowed to do; your permission level and the approval rule stand.',
    'If an input the skill needs is missing and you cannot proceed, ask for it (one clear question). If a step cannot be done here, say which and why, and do the rest.'
  ].filter(Boolean).join('\n');
}
function catalog(list, agentId) {
  const u = agentId ? usable(list, agentId) : list.filter((s) => s.status === 'active');
  return u.length ? 'SKILLS THE TEAM HAS (id | name | for whom | purpose | when):\n' + u.map((s) => s.id + ' | ' + s.name + ' | ' + (s.assignedTo.length ? s.assignedTo.join(', ') : 'everyone') + ' | ' + str(s.purpose, 140) + ' | ' + str(s.when, 100)).join('\n') : '';
}

/* ---------- choosing one ------------------------------------------------------ */
const STOP = new Set('the a an and or of to for in on at by with from this that these those is are was were be been it its as into about over under up down our your my their we you they i he she them us me will would should can could do does did done have has had not no yes please want need like make get go put take give use using with every each all some any one two three new old now then also just very more most'.split(' '));
function terms(t) { return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}$€£%]+/gu, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, '')); }
function score(s, brief) {
  const b = new Set(terms(brief)); if (!b.size) return 0;
  const hit = (txt, w) => { const ts = terms(txt); let n = 0; const seen = new Set(); ts.forEach((t) => { if (b.has(t) && !seen.has(t)) { seen.add(t); n++; } }); return n * w; };
  let sc = hit(s.name, 3) + hit(s.purpose, 1.5) + hit(s.when, 1.5) + hit(s.steps.join(' '), 0.4);
  sc -= hit(s.whenNot, 2.5);
  return sc;
}
const INVOKE = [/(?:use|with|apply|follow|run|using)\s+(?:the\s+)?(?:["“'])([^"”'\n]{2,80})(?:["”'])(?:\s+skill)?/i, /(?:use|with|apply|follow|run|using)\s+(?:the\s+)?skill\s*[:"“']?\s*([^"”'\n.;,]{2,80})/i, /(?:use|with|apply|follow|run|using)\s+(?:the\s+)?([^"”'\n.;,]{2,80}?)\s+skill\b/i, /(?:^|\n)\s*\/skill\s+([^\n]{2,80})/i];
function invoked(brief) {
  for (const re of INVOKE) { const m = String(brief || '').match(re); if (m) return str(m[1], 80).replace(/\s+skill$/i, ''); }
  return '';
}
/* → { skill, how: 'invoked'|'matched', score } · { missing: name, how: 'invoked' } · null */
function select(list, agentId, brief, opts) {
  const o = opts || {};
  const name = o.skill || invoked(brief);
  if (name) {
    const lc = name.toLowerCase();
    const exact = list.find((s) => s.id === name) || list.find((s) => s.name.toLowerCase() === lc) || list.find((s) => s.name.toLowerCase().indexOf(lc) >= 0 || lc.indexOf(s.name.toLowerCase()) >= 0);
    if (!exact) return { missing: name, how: 'invoked' };
    const can = usable(list, agentId).some((s) => s.id === exact.id);
    return { skill: exact, how: 'invoked', score: 99, blocked: exact.status !== 'active' ? exact.status : (!can ? 'not assigned to this agent' : '') };
  }
  let best = null, bs = 0;
  for (const s of usable(list, agentId)) { const sc = score(s, brief); if (sc > bs) { bs = sc; best = s; } }
  if (!best || bs < (o.threshold || 4)) return null;
  return { skill: best, how: 'matched', score: Math.round(bs * 10) / 10 };
}
/* Can it run here? */
function readiness(s, tools) {
  const T = Object.assign({ flow: true, web: true, browser: false, email: false }, tools || {});
  const missing = s.tools.filter((t) => !T[t]);
  return { ok: !missing.length, missing, missingNames: missing.map((t) => TOOL_NAMES[t] || t) };
}

/* The block a step's prompt gets, and what the task should record. */
async function forStep(ctx, deps, agent, step, task, know) {
  const list = await all(ctx);
  const pick = select(list, agent.id, (step.brief || '') + '\n' + (task.brief || '') + '\n' + (step.title || ''), { skill: step.skill && step.skill.id ? step.skill.id : (typeof step.skill === 'string' ? step.skill : '') });
  if (!pick) return null;
  if (pick.missing) return { meta: { missing: pick.missing, how: 'invoked' }, block: 'SKILL REQUESTED BUT NOT FOUND: the person asked for a skill called "' + pick.missing + '", and no skill with that name exists' + (list.length ? '. The skills that do exist: ' + list.filter((s) => s.status === 'active').map((s) => s.name).join(', ') : ' (there are no skills yet)') + '. Say so plainly in your result, then do the work as best you can without it.', log: 'asked for a skill that does not exist: "' + pick.missing + '"' };
  const s = pick.skill;
  const r = readiness(s, deps && deps.tools ? deps.tools() : null);
  const meta = { id: s.id, name: s.name, version: s.version, how: pick.how };
  if (pick.blocked) return { meta: Object.assign(meta, { blocked: pick.blocked }), block: 'SKILL REQUESTED BUT NOT USABLE: "' + s.name + '" is ' + pick.blocked + '. Say so in your result and do the work without it.', log: 'skill "' + s.name + '" is ' + pick.blocked };
  if (!r.ok) return { meta: Object.assign(meta, { blocked: 'needs ' + r.missingNames.join(', ') }), block: 'SKILL THAT WOULD APPLY BUT CANNOT RUN HERE: "' + s.name + '" (v' + s.version + ') relies on ' + r.missingNames.join(' and ') + ', which ' + (r.missing.length === 1 ? 'is' : 'are') + ' not connected. Say this in your result, do the parts that need no such tool, and leave the rest to the person.', log: 'skill "' + s.name + '" needs ' + r.missingNames.join(', ') + ' — not connected here' };
  return { meta, block: text(s, know), log: 'following the skill "' + s.name + '" v' + s.version + (pick.how === 'invoked' ? ' (asked for)' : '') };
}
async function recordRun(ctx, id, run) {
  const list = await all(ctx); const s = list.find((x) => x.id === id); if (!s) return;
  s.runs = s.runs.concat([Object.assign({ at: Date.now() }, run)]).slice(-30);
  await save(ctx, list);
}

/* ---------- teaching: a draft from a description or a finished task ---------- */
function generalise(t) {
  const inputs = [];
  let out = String(t || '');
  const sub = (re, label) => { if (re.test(out)) { out = out.replace(re, '<' + label + '>'); if (inputs.indexOf(label) < 0) inputs.push(label); } };
  sub(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g, 'email address');
  sub(/https?:\/\/\S+/g, 'web address');
  sub(/(?:[$€£₺]\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|GBP|TRY|TL|dollars?|euros?|lira))/gi, 'amount');
  sub(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+\d{4})?\b/g, 'date');
  sub(/\b\+?\d[\d ()-]{8,}\d\b/g, 'phone number');
  return { text: out.replace(/\s{2,}/g, ' ').trim(), inputs };
}
function draftFromTask(task, agents, know) {
  const A = Array.isArray(agents) ? agents : [];
  const g = generalise(task.brief || task.title || '');
  let inputs = g.inputs.slice();
  const steps = (task.steps || []).filter((s) => s.status === 'done' || s.result).map((s) => {
    const a = A.find((x) => x.id === s.agent); const gs = generalise(s.brief || s.title || '');
    gs.inputs.forEach((i) => { if (inputs.indexOf(i) < 0) inputs.push(i); });
    return (a ? a.name + ': ' : '') + (s.title || 'Work') + (gs.text && gs.text !== s.title ? ' — ' + str(gs.text, 300) : '');
  });
  const kinds = []; (task.steps || []).forEach((s) => (s.approvals || []).length && kinds.push('what ' + ((A.find((x) => x.id === s.agent) || {}).name || s.agent) + ' proposes to send'));
  const tools = []; const b = (task.brief || '') + ' ' + (task.steps || []).map((s) => s.brief || '').join(' ');
  if (/\bemail|e-mail|mail\b/i.test(b) || kinds.length) tools.push('email'); if (/\bread |website|page|link|http/i.test(b)) tools.push('web'); if (/\bbrowse|sign in|log in|click/i.test(b)) tools.push('browser'); if (/\bweek|rock|habit|training|spend|note|journal/i.test(b)) tools.push('flow');
  const bt = new Set(terms(b));
  const sources = (Array.isArray(know) ? know : []).filter((k) => k.status !== 'superseded' && k.scope === 'shared').map((k) => ({ k, n: terms(k.text).filter((t) => bt.has(t)).length })).filter((x) => x.n >= 2).sort((x, y) => y.n - x.n).slice(0, 5).map((x) => ({ kind: 'knowledge', id: x.k.id }));
  return cleanDoc({
    name: str(task.title, 80).replace(/^Team:\s*/i, ''), type: 'workflow',
    purpose: 'Repeat what the team did for "' + str(task.title, 80) + '": ' + str(g.text, 300),
    when: 'A request like the one that started this: ' + str(g.text, 160), whenNot: '',
    inputs, steps: steps.length ? steps : ['Do what the request asks, in full, in words.'],
    tools, sources,
    output: task.result ? 'A deliverable like the one produced before: ' + str(generalise(task.result).text, 300) : 'The finished work, in words, ready to review.',
    quality: 'Specific and complete; the point first; nothing invented; say what is an estimate.',
    exceptions: 'If an input is missing, ask one clear question rather than guessing. If a tool is not connected, do the thinking part and say what is left.',
    approvals: kinds.length ? kinds.filter((k, i, a) => a.indexOf(k) === i).join('; ') + ' — proposed for the person\'s yes, never sent by the skill' : 'Anything that would reach the outside world is proposed, never done.'
  });
}
function draftFromText(t) {
  const raw = block(t, 6000);
  const ls = raw.split('\n').map((x) => x.trim()).filter(Boolean);
  const title = (raw.match(/^(?:skill|name)\s*:\s*(.+)$/im) || [])[1] || (ls[0] && ls[0].length <= 80 && ls.length > 1 ? ls[0] : str(raw.split(/[.:\n]/)[0], 80));
  const bullet = ls.filter((l) => /^(?:[-*•·]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^(?:[-*•·]|\d+[.)])\s+/, ''));
  const body = ls.filter((l) => l !== title && !/^(?:[-*•·]|\d+[.)])\s+/.test(l)).join(' ');
  const sentences = body.split(/(?<=[.!?])\s+|\s*;\s*|\s+then\s+|\s+after that\s+|\s+next,?\s+|\s+finally,?\s+/i).map((s) => s.trim()).filter((s) => s.length > 3);
  const whenNot = [], exceptions = [], approvals = [], quality = [], when = [], steps = bullet.slice();
  for (let s of sentences) {
    s = s.replace(/^(?:then|next|after that|finally|and then)[,\s]+/i, (m) => '').replace(/^[a-z]/, (c) => c.toUpperCase());
    if (/^(?:use (?:this|it) when|when(?:ever)? |if someone|for )/i.test(s) && !when.length) { when.push(s); continue; }
    if (/\b(?:never|don'?t|do not|not for|except|unless)\b/i.test(s) && /\b(?:use|apply|skill)\b/i.test(s)) { whenNot.push(s); continue; }
    if (/\b(?:ask me|approval|approve|before sending|my yes|check with me|sign.?off)\b/i.test(s)) { approvals.push(s); continue; }
    if (/\b(?:if .* (?:missing|unknown|unclear|not sure|no \w+ data|not available|cannot|can'?t)|when .* (?:missing|unknown)|if (?:there is|there's) no|otherwise|in case)\b/i.test(s)) { exceptions.push(s); continue; }
    if (/\b(?:always|must|should|never|keep it|tone|format|style|short|brief|formal|plain)\b/i.test(s) && !/^(?:first|step)\b/i.test(s)) { quality.push(s); continue; }
    if (!bullet.length) steps.push(s);
  }
  const g = generalise(raw);
  const tools = []; if (/\bemail|e-mail|mail\b/i.test(raw)) tools.push('email'); if (/\bwebsite|web page|page|link|http|read the/i.test(raw)) tools.push('web'); if (/\bbrowse|sign in|log in|click/i.test(raw)) tools.push('browser'); if (/\bweek|rock|habit|training|spend|note|journal|calendar/i.test(raw)) tools.push('flow');
  const isGuide = /\b(?:how we|how to talk|guide|guidance|rules? for|what counts as|definition)\b/i.test(raw) && steps.length <= 2;
  return cleanDoc({
    name: str(title, 80), type: isGuide ? 'guide' : 'workflow',
    purpose: str(sentences[0] || raw, 300), when: when.join(' ') || ('A request about ' + str(title, 60).toLowerCase() + '.'), whenNot: whenNot.join(' '),
    inputs: g.inputs, steps: steps.length ? steps : [str(raw, 400)], tools, sources: [],
    output: '', quality: quality.join(' '), exceptions: exceptions.join(' ') || 'If information the skill needs is missing, ask one clear question rather than guessing.', approvals: approvals.join(' ')
  });
}

/* ---------- versions, diffs, checks ------------------------------------------- */
function diff(before, after) {
  const out = [];
  for (const f of DOC_FIELDS) {
    const a = before[f], b = after[f];
    if (Array.isArray(a) || Array.isArray(b)) {
      const A = (a || []).map((x) => typeof x === 'string' ? x : JSON.stringify(x)), B = (b || []).map((x) => typeof x === 'string' ? x : JSON.stringify(x));
      const removed = A.filter((x) => B.indexOf(x) < 0), added = B.filter((x) => A.indexOf(x) < 0);
      if (removed.length || added.length || A.join('\n') !== B.join('\n')) out.push({ field: f, before: A, after: B, added, removed });
    } else if (String(a || '') !== String(b || '')) out.push({ field: f, before: String(a || ''), after: String(b || '') });
  }
  return out;
}
/* "never X" against "always X" in the same document, or against a team rule */
function contradictions(doc, rules) {
  /* a directive "never/do not X" against an "always/do X" sharing three or
     more content words; a conditional "if there is no data" is not a rule */
  const NEG = /\b(?:never|do not|don'?t|must not|should not|stop|no longer)\b/i;
  const ls = [].concat(doc.steps, doc.quality ? doc.quality.split(/(?<=[.!?])\s+/) : [], doc.exceptions ? doc.exceptions.split(/(?<=[.!?])\s+/) : [], doc.whenNot ? [doc.whenNot] : []).map((s) => ({ s, neg: NEG.test(s), t: new Set(terms(s)) }));
  const out = [];
  const clash = (x, y) => { if (x.neg === y.neg) return false; let n = 0; x.t.forEach((w) => { if (y.t.has(w)) n++; }); return n >= 3; };
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) if (clash(ls[i], ls[j])) out.push({ where: 'within the skill', a: ls[i].s, b: ls[j].s });
  for (const r of (Array.isArray(rules) ? rules : [])) { const R = { s: r.text, neg: NEG.test(r.text), t: new Set(terms(r.text)) }; for (const l of ls) if (clash(l, R)) out.push({ where: 'against the team rule ' + r.id, a: l.s, b: r.text }); }
  return out.slice(0, 10);
}
function duplicates(list, doc, exceptId) {
  const nt = new Set(terms(doc.name + ' ' + doc.purpose)); if (!nt.size) return [];
  return list.filter((s) => s.id !== exceptId && s.status !== 'archived').map((s) => { const st = terms(s.name + ' ' + s.purpose); let n = 0; const seen = new Set(); st.forEach((t) => { if (nt.has(t) && !seen.has(t)) { seen.add(t); n++; } }); const sim = n / Math.max(3, Math.min(nt.size, new Set(st).size)); return { id: s.id, name: s.name, sim: Math.round(sim * 100) / 100, same: s.name.toLowerCase() === doc.name.toLowerCase() }; }).filter((x) => x.same || x.sim >= 0.6).slice(0, 5);
}
function snapshot(s, why, by) { return { v: s.version, at: s.updatedAt || s.createdAt || Date.now(), why: str(why, 200), by: str(by, 40) || 'you', doc: docOf(s) }; }

/* ---------- feedback ------------------------------------------------------------ */
function classify(fb) {
  const t = String(fb || '');
  if (/\b(?:just|only) (?:this (?:time|once|one)|for this|here)\b|\bthis (?:time|one) only\b|\bone[- ]off\b|\bthis output\b|\bredo (?:this|it)\b|\bfix (?:this|it) (?:one|now)\b/i.test(t)) return 'output';
  if (/\b(?:i (?:prefer|like|want|hate|dislike)|in general|generally|my preference|as a rule|across the board|for everything|always (?:write|use|keep|address|call)|never (?:use|write) (?:emoji|exclamation|bullet)|tone|formal|informal|call me)\b/i.test(t) && !/\bstep\b/i.test(t)) return 'preference';
  if (/\b(?:always|every time|from now on|in future|whenever|each time|going forward|next time|the skill|step|add|include|before|after|instead|also|first|check|skip|remove|don'?t|never|should)\b/i.test(t)) return 'workflow';
  return 'output';
}
/* A deterministic revision when no model is available (and in tests). */
function reviseDoc(doc, fb) {
  const d = JSON.parse(JSON.stringify(doc)); const t = str(fb, 600);
  const cleaned = t.replace(/^(?:please|also|and|next time|from now on|in future|going forward|always|every time)[, ]+/i, '').replace(/[.!]+$/, '');
  if (/\b(?:don'?t|never|stop|no longer|not)\b/i.test(t) && !/\b(?:add|include|also)\b/i.test(t)) d.exceptions = (d.exceptions ? d.exceptions + ' ' : '') + (/^(?:never|do not|don'?t)/i.test(cleaned) ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Never: ' + cleaned) + '.';
  else if (/\b(?:before|first|start (?:by|with))\b/i.test(t)) d.steps = [cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + '.'].concat(d.steps);
  else if (/\b(?:step|add|include|also|then|after|end|finish|finally|check)\b/i.test(t)) d.steps = d.steps.concat([cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + '.']);
  else d.quality = (d.quality ? d.quality + ' ' : '') + cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + '.';
  return cleanDoc(d);
}

/* ---------- operations ------------------------------------------------------------ */
async function create(ctx, deps, b) {
  const list = await all(ctx);
  if (list.filter((s) => s.status !== 'archived').length >= MAX_SKILLS) return { error: 'Two hundred skills is the ceiling; archive some first.', status: 400 };
  const know = deps && deps.knowledge ? await deps.knowledge(ctx) : [];
  const agents = deps && deps.agents ? await deps.agents(ctx) : [];
  let doc = null, from = { kind: String(b.from || 'description') };
  if (from.kind === 'task') {
    const tasks = deps && deps.tasks ? await deps.tasks(ctx) : [];
    const t = tasks.find((x) => x.id === String(b.task || '')) || (b.task === 'last' ? tasks.filter((x) => x.status === 'done' || x.status === 'awaiting_approval').slice(-1)[0] : null);
    if (!t) return { error: 'No finished task to learn from.', status: 404 };
    doc = draftFromTask(t, agents, know); from.task = t.id; from.title = t.title;
    if (deps && deps.draft) { const d2 = await deps.draft(ctx, { kind: 'task', task: t, draft: doc }); if (d2) doc = cleanDoc(Object.assign({}, doc, d2)); }
  } else if (from.kind === 'doc') {
    doc = cleanDoc(b.doc || b);
  } else {
    const txt = block(b.text || b.description, 6000); if (!txt) return { error: 'Describe the skill first: what it is for and the steps.', status: 400 };
    doc = draftFromText(txt);
    if (deps && deps.draft) { const d2 = await deps.draft(ctx, { kind: 'description', text: txt, examples: b.examples, draft: doc }); if (d2) doc = cleanDoc(Object.assign({}, doc, d2)); }
  }
  if (b.name) doc.name = str(b.name, 80);
  if (!doc.name) return { error: 'The skill needs a name.', status: 400 };
  if (secretish(doc)) return { error: 'That looks like it contains a password, key or card number. Skills never hold secrets; take it out and save again.', status: 400 };
  const dups = duplicates(list, doc);
  if (dups.some((d) => d.same) && !b.force) return { error: 'A skill called "' + doc.name + '" already exists. Open it and improve it, or give this one another name.', status: 409, duplicates: dups };
  const now = Date.now();
  const s = norm(Object.assign({ id: 'sk' + newId(), status: 'active', version: 1, versions: [], assignedTo: (Array.isArray(b.agents) ? b.agents : []).map((x) => str(x, 40)).filter(Boolean), examples: (Array.isArray(b.examples) ? b.examples : []).slice(0, 20).map((e) => ({ id: 'e' + newId(), input: block(e.input || e, 2000), expected: str(e.expected, 400), expectQuestion: !!e.expectQuestion, at: now })), runs: [], from, createdAt: now, updatedAt: now }, doc));
  list.push(s); await save(ctx, list);
  if (deps && deps.log) await deps.log(ctx, 'team', 'Skill created: "' + s.name + '" v1' + (from.task ? ' (from the task "' + str(from.title, 60) + '")' : '') + '.');
  return { ok: true, skill: s, duplicates: dups, contradictions: contradictions(doc, (know || []).filter((k) => k.kind === 'rule' && k.status !== 'superseded')) };
}
async function update(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such skill.', status: 404 };
  const before = docOf(s); const after = cleanDoc(Object.assign({}, before, b.doc || b));
  if (!after.name) return { error: 'The skill needs a name.', status: 400 };
  if (secretish(after)) return { error: 'That looks like it contains a password, key or card number. Skills never hold secrets.', status: 400 };
  const d = diff(before, after); if (!d.length) return { ok: true, skill: s, diff: [], unchanged: true };
  s.versions = s.versions.concat([snapshot(s, b.why || 'edited', 'you')]).slice(-40);
  Object.assign(s, after); s.version += 1; s.updatedAt = Date.now();
  await save(ctx, list);
  if (deps && deps.log) await deps.log(ctx, 'team', 'Skill "' + s.name + '" → v' + s.version + ': ' + d.map((x) => x.field).join(', ') + '.');
  const know = deps && deps.knowledge ? await deps.knowledge(ctx) : [];
  return { ok: true, skill: s, diff: d, contradictions: contradictions(after, know.filter((k) => k.kind === 'rule' && k.status !== 'superseded')), duplicates: duplicates(list, after, s.id) };
}
async function rollback(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such skill.', status: 404 };
  const v = s.versions.find((x) => x.v === +b.to); if (!v) return { error: 'No version ' + b.to + ' to go back to.', status: 404 };
  s.versions = s.versions.concat([snapshot(s, 'before rolling back to v' + v.v, 'you')]).slice(-40);
  Object.assign(s, cleanDoc(v.doc)); s.version += 1; s.updatedAt = Date.now();
  await save(ctx, list);
  if (deps && deps.log) await deps.log(ctx, 'team', 'Skill "' + s.name + '" rolled back to v' + v.v + ' (now v' + s.version + ').');
  return { ok: true, skill: s, restored: v.v };
}
async function setStatus(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such skill.', status: 404 };
  const st = STATUSES.indexOf(b.status) >= 0 ? b.status : 'active';
  s.status = st; s.updatedAt = Date.now(); if (st === 'archived') s.archivedAt = Date.now();
  await save(ctx, list);
  if (deps && deps.log) await deps.log(ctx, 'team', 'Skill "' + s.name + '" ' + (st === 'active' ? 'is active again' : st) + '.');
  return { ok: true, skill: s };
}
async function assign(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such skill.', status: 404 };
  const agents = deps && deps.agents ? await deps.agents(ctx) : [];
  const ids = (Array.isArray(b.agents) ? b.agents : []).map((x) => str(x, 40)).filter((x) => !agents.length || agents.some((a) => a.id === x && !a.archived));
  s.assignedTo = ids; s.updatedAt = Date.now();
  await save(ctx, list);
  if (deps && deps.log) await deps.log(ctx, 'team', 'Skill "' + s.name + '" is now for ' + (ids.length ? ids.map((i) => (agents.find((a) => a.id === i) || {}).name || i).join(', ') : 'everyone') + '. Their permissions are unchanged.');
  return { ok: true, skill: s, note: 'Sharing a skill shares the procedure only: no credentials travel with it, and each agent keeps its own permission level.' };
}
async function remove(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such skill.', status: 404 };
  if (s.status !== 'archived') return { error: 'Archive it first; removal is for archived skills.', status: 400 };
  await save(ctx, list.filter((x) => x.id !== s.id));
  if (deps && deps.log) await deps.log(ctx, 'team', 'Skill "' + s.name + '" removed.');
  return { ok: true };
}
async function addExample(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such skill.', status: 404 };
  if (b.remove) { s.examples = s.examples.filter((e) => e.id !== String(b.remove)); await save(ctx, list); return { ok: true, skill: s }; }
  const input = block(b.input, 2000); if (!input) return { error: 'Write the example request.', status: 400 };
  s.examples = s.examples.concat([{ id: 'e' + newId(), input, expected: str(b.expected, 400), expectQuestion: !!b.expectQuestion, at: Date.now() }]).slice(-20);
  await save(ctx, list);
  return { ok: true, skill: s };
}

/* Feedback → a proposal: nothing changes until it is applied. */
async function feedback(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || b.skill || '')); if (!s) return { error: 'No such skill.', status: 404 };
  const fb = block(b.text, 2000); if (!fb) return { error: 'Say what should be different.', status: 400 };
  const kind = b.kind && /^(output|workflow|preference)$/.test(b.kind) ? b.kind : classify(fb);
  const now = Date.now();
  const P = { id: 'sp' + newId(), skill: s.id, skillName: s.name, version: s.version, at: now, feedback: fb, kind, status: 'proposed', task: str(b.task, 40) };
  if (kind === 'output') {
    P.explanation = 'This reads as a change to this one output only, so nothing is saved: the skill stays at v' + s.version + '. Ask the agent to redo the piece; if it should happen every time, say so ("from now on…") and it becomes a change to the skill.';
  } else if (kind === 'preference') {
    P.explanation = 'This reads as a preference about how work is done in general, not a step in this skill. It belongs in the team\'s knowledge as a preference, where every agent and every skill reads it — not hidden in one skill.';
    P.knowledge = { kind: 'preference', scope: 'shared', text: str(fb.replace(/^(?:from now on|in future|going forward|always|please)[, ]+/i, ''), 300) };
  } else {
    const before = docOf(s);
    let after = reviseDoc(before, fb);
    if (deps && deps.revise) { const d2 = await deps.revise(ctx, { skill: s, feedback: fb, draft: after }); if (d2) after = cleanDoc(Object.assign({}, before, d2)); }
    if (secretish(after)) return { error: 'The change would put something that looks like a secret into the skill. Skills never hold secrets.', status: 400 };
    P.diff = diff(before, after); P.after = after;
    const know = deps && deps.knowledge ? await deps.knowledge(ctx) : [];
    P.contradictions = contradictions(after, know.filter((k) => k.kind === 'rule' && k.status !== 'superseded'));
    P.duplicates = duplicates(list, after, s.id);
    P.explanation = P.diff.length ? 'A change to the procedure: ' + P.diff.map((d) => d.field + (d.added && d.added.length ? ' (+' + d.added.length + ')' : '') + (d.removed && d.removed.length ? ' (−' + d.removed.length + ')' : '')).join(', ') + '. Unrelated parts are untouched. Apply makes it v' + (s.version + 1) + '; v' + s.version + ' stays available to go back to.' : 'The feedback did not change the document.';
    if (P.contradictions.length) P.explanation += ' It contradicts something — see below before applying.';
  }
  const props = await proposals(ctx); props.push(P); await saveProposals(ctx, props);
  return { ok: true, proposal: P, skill: s };
}
async function applyProposal(ctx, deps, b) {
  const props = await proposals(ctx); const P = props.find((x) => x.id === String(b.id || '')); if (!P) return { error: 'No such proposal.', status: 404 };
  if (P.status !== 'proposed') return { ok: true, proposal: P, already: true };
  if (P.kind === 'workflow' && P.after) {
    const list = await all(ctx); const s = list.find((x) => x.id === P.skill); if (!s) return { error: 'The skill is gone.', status: 404 };
    if (s.version !== P.version && !b.force) return { error: 'The skill has changed since this was proposed (now v' + s.version + '). Ask for the change again.', status: 409 };
    s.versions = s.versions.concat([snapshot(s, 'feedback: ' + str(P.feedback, 120), 'you')]).slice(-40);
    Object.assign(s, cleanDoc(P.after)); s.version += 1; s.updatedAt = Date.now();
    await save(ctx, list);
    P.status = 'applied'; P.appliedAt = Date.now(); P.newVersion = s.version;
    await saveProposals(ctx, props);
    if (deps && deps.log) await deps.log(ctx, 'team', 'Skill "' + s.name + '" → v' + s.version + ' from feedback: ' + str(P.feedback, 100));
    return { ok: true, proposal: P, skill: s };
  }
  if (P.kind === 'preference' && P.knowledge) {
    if (!(deps && deps.addKnowledge)) return { error: 'Knowledge is not reachable from here.', status: 500 };
    const k = await deps.addKnowledge(ctx, P.knowledge);
    P.status = 'applied'; P.appliedAt = Date.now(); P.knowledgeId = k && k.id;
    await saveProposals(ctx, props);
    return { ok: true, proposal: P, knowledge: k };
  }
  P.status = 'noted'; await saveProposals(ctx, props);
  return { ok: true, proposal: P };
}
async function declineProposal(ctx, deps, b) {
  const props = await proposals(ctx); const P = props.find((x) => x.id === String(b.id || '')); if (!P) return { error: 'No such proposal.', status: 404 };
  P.status = 'declined'; P.declinedAt = Date.now(); await saveProposals(ctx, props);
  return { ok: true, proposal: P };
}

/* ---------- testing a skill on examples ------------------------------------------------ */
async function test(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such skill.', status: 404 };
  if (!(deps && deps.run)) return { error: 'No runner here.', status: 500 };
  const agents = deps.agents ? await deps.agents(ctx) : [];
  const agentId = str(b.agent, 40) || (s.assignedTo[0]) || (agents.find((a) => a.id !== 'jarvis' && !a.archived) || {}).id;
  const a = agents.find((x) => x.id === agentId); if (!a) return { error: 'Pick an agent to run it as.', status: 400 };
  const exs = b.input ? [{ id: 'adhoc', input: block(b.input, 2000), expected: str(b.expected, 400), expectQuestion: !!b.expectQuestion }] : (b.example ? s.examples.filter((e) => e.id === b.example) : s.examples);
  if (!exs.length) return { error: 'Add an example request first.', status: 400 };
  const know = deps.knowledge ? await deps.knowledge(ctx) : [];
  const results = [];
  for (const ex of exs.slice(0, 5)) {
    const checks = [];
    const pick = select(list, a.id, ex.input, {});
    checks.push({ name: 'Selects this skill from the request', pass: !!(pick && pick.skill && pick.skill.id === s.id), detail: pick && pick.skill ? 'chose "' + pick.skill.name + '" (' + pick.how + (pick.score ? ', score ' + pick.score : '') + ')' : 'no skill matched — say in "when" what such a request looks like, or name the skill in the request' });
    const r = readiness(s, deps.tools ? deps.tools() : null);
    checks.push({ name: 'Every tool the skill relies on is connected here', pass: r.ok, detail: r.ok ? (s.tools.length ? s.tools.map((t) => TOOL_NAMES[t]).join(', ') : 'needs no tool') : 'missing: ' + r.missingNames.join(', ') });
    const gone = s.sources.filter((x) => x.kind === 'knowledge' && !know.some((k) => k.id === x.id && k.status !== 'superseded'));
    checks.push({ name: 'Its sources exist and are current', pass: !gone.length, detail: gone.length ? gone.map((x) => x.id).join(', ') + ' missing or superseded' : (s.sources.length ? s.sources.length + ' source' + (s.sources.length === 1 ? '' : 's') : 'no sources linked') });
    const run = await deps.run(ctx, a.id, s, ex.input, know);
    if (run.error) { checks.push({ name: 'The agent could run it', pass: false, detail: run.error }); results.push({ example: ex, checks, run: null }); continue; }
    checks.push({ name: 'The agent could run it (test run — nothing sent)', pass: true, detail: a.name + ' on ' + (run.model || '') });
    const out = String(run.result || '') + ' ' + String(run.question || '');
    const stepTerms = new Set(terms(s.steps.join(' '))); const outTerms = new Set(terms(out)); let n = 0; stepTerms.forEach((t) => { if (outTerms.has(t)) n++; });
    const askedFirst = !!run.question && !run.result;
    checks.push({ name: 'The output follows the steps (shares their vocabulary)', pass: askedFirst || !stepTerms.size || n >= Math.min(3, Math.ceil(stepTerms.size * 0.15)), detail: askedFirst ? 'asked a question before starting — judged below' : n + ' of ' + stepTerms.size + ' step terms appear' });
    if (ex.expected) { const et = terms(ex.expected); const hit = et.filter((t) => outTerms.has(t)).length; checks.push({ name: 'Matches what was expected', pass: !et.length || hit >= Math.ceil(et.length * 0.5), detail: hit + ' of ' + et.length + ' expected terms present' }); }
    if (ex.expectQuestion) checks.push({ name: 'Asks instead of guessing when information is missing', pass: !!run.question, detail: run.question ? 'asked: ' + str(run.question, 120) : 'no question — it went ahead' });
    else checks.push({ name: 'Produces a result (or a fair question)', pass: !!(run.result || run.question), detail: run.result ? str(run.result, 120) : run.question ? 'asked: ' + str(run.question, 120) : 'nothing came back' });
    const props = Array.isArray(run.proposals) ? run.proposals : [];
    checks.push({ name: 'Outside actions come back as drafts for approval, not done', pass: props.every((p) => !p.sent && !p.executed) && !/\b(?:I have sent|was sent|has been sent|sent it)\b/i.test(String(run.result || '')), detail: props.length ? props.length + ' proposal' + (props.length === 1 ? '' : 's') + ' as draft' + (props.length === 1 ? '' : 's') : 'no outside action proposed' });
    checks.push({ name: 'Permissions untouched by the skill', pass: run.permissions === a.permissions, detail: a.name + ' stays "' + a.permissions + '"' });
    results.push({ example: ex, checks, run: { result: run.result, question: run.question, proposals: props, model: run.model } });
  }
  const passed = results.reduce((n, r) => n + r.checks.filter((c) => c.pass).length, 0), failed = results.reduce((n, r) => n + r.checks.filter((c) => !c.pass).length, 0);
  /* remember the outcome per saved example */
  for (const r of results) { const e = s.examples.find((x) => x.id === r.example.id); if (e) e.lastRun = { at: Date.now(), pass: r.checks.every((c) => c.pass), version: s.version, result: str(r.run && (r.run.result || r.run.question), 300) }; }
  s.runs = s.runs.concat([{ at: Date.now(), kind: 'test', agent: a.id, version: s.version, passed, failed }]).slice(-30);
  await save(ctx, list);
  if (deps.log) await deps.log(ctx, a.id, a.name + ' test-ran the skill "' + s.name + '" v' + s.version + ': ' + passed + ' passed, ' + failed + ' failed. Nothing was sent.');
  return { ok: true, skill: s, agent: a.id, passed, failed, results, note: 'A test run is a dry run: proposals are shown as drafts and nothing leaves the building.' };
}

/* ---------- listing ---------------------------------------------------------------------- */
async function list(ctx, deps, o) {
  const L = await all(ctx); const props = await proposals(ctx);
  const q = str(o && o.q, 100).toLowerCase();
  const agents = deps && deps.agents ? await deps.agents(ctx) : [];
  const tools = deps && deps.tools ? deps.tools() : null;
  const items = L.filter((s) => !q || (s.name + ' ' + s.purpose + ' ' + s.when + ' ' + s.steps.join(' ')).toLowerCase().indexOf(q) >= 0).map((s) => {
    const r = readiness(s, tools);
    return Object.assign({}, s, { ready: r.ok, missing: r.missingNames, assignedNames: s.assignedTo.map((id) => (agents.find((a) => a.id === id) || {}).name || id), lastRun: s.runs.length ? s.runs[s.runs.length - 1] : null, proposals: props.filter((p) => p.skill === s.id && p.status === 'proposed').length });
  }).sort((a, b) => (a.status === b.status ? b.updatedAt - a.updatedAt : STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)));
  return { ok: true, items, counts: { active: L.filter((s) => s.status === 'active').length, disabled: L.filter((s) => s.status === 'disabled').length, archived: L.filter((s) => s.status === 'archived').length }, proposals: props.slice(-30).reverse(), tools: tools || {}, toolNames: TOOL_NAMES };
}

/* ---------- routes ----------------------------------------------------------------------- */
async function handle(p, req, res, ctx, deps) {
  if (p.indexOf('/api/team/skills') !== 0) return false;
  const json = ctx.json;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };
  const out = (r) => { if (r && r.error) json(res, r.status || 400, r); else json(res, 200, r); return true; };
  if (p === '/api/team/skills' && req.method === 'GET') return out(await list(ctx, deps, { q: ctx.query.get('q') }));
  if (p === '/api/team/skills' && req.method === 'POST') {
    const b = await body(); const op = String(b.op || 'create');
    if (op === 'create') return out(await create(ctx, deps, b));
    if (op === 'update') return out(await update(ctx, deps, b));
    if (op === 'rollback') return out(await rollback(ctx, deps, b));
    if (op === 'status') return out(await setStatus(ctx, deps, b));
    if (op === 'assign') return out(await assign(ctx, deps, b));
    if (op === 'remove') return out(await remove(ctx, deps, b));
    if (op === 'example') return out(await addExample(ctx, deps, b));
    if (op === 'preview') { const d = b.from === 'task' ? null : draftFromText(block(b.text, 6000)); return out(d ? { ok: true, doc: d } : { error: 'preview takes a description', status: 400 }); }
    return out({ error: 'create, update, rollback, status, assign, remove, example or preview.', status: 400 });
  }
  if (p === '/api/team/skills/feedback' && req.method === 'POST') return out(await feedback(ctx, deps, await body()));
  if (p === '/api/team/skills/apply' && req.method === 'POST') return out(await applyProposal(ctx, deps, await body()));
  if (p === '/api/team/skills/decline' && req.method === 'POST') return out(await declineProposal(ctx, deps, await body()));
  if (p === '/api/team/skills/test' && req.method === 'POST') return out(await test(ctx, deps, await body()));
  return false;
}

module.exports = { handle, all, usable, text, catalog, select, invoked, readiness, forStep, recordRun, draftFromTask, draftFromText, generalise, diff, contradictions, duplicates, classify, reviseDoc, secretish, cleanDoc, docOf, create, update, rollback, setStatus, assign, feedback, applyProposal, test, list, TYPES, STATUSES, TOOL_IDS, TOOL_NAMES, DOC_FIELDS };
