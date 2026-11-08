/* =========================================================================
 * flow-memory.js — where the team's knowledge comes from, and how it is
 * corrected so the old version stops coming back
 *
 * The sources (everything that can shape an agent's answer here)
 * ----------------------------------------------------------------
 *   knowledge      team:knowledge — shared business facts/rules and each
 *                  agent's own notes. Editable. Each entry now carries a
 *                  kind (fact · rule · preference · procedure), a status
 *                  (current · superseded), validity dates, what it replaced
 *                  / was replaced by, and its version history.
 *   instructions   team:agents[].instructions + role/manner — the agent's
 *                  identity (the SOUL.md of this platform). Editable, with
 *                  a version history on the agent record.
 *   memory         flow:settings.asstMemory — what J.A.R.V.I.S. was told to
 *                  remember about the person (his USER.md). Editable.
 *   preferences    flow:settings (name, language, timezone, voice/manner).
 *                  Read here; changed in Settings.
 *   record         The Flow's own record (rocks, notes, journal, spend…),
 *                  read into prompts by buildContext. Changed in the app.
 *   history        team:thread:<agent>, team:chan:hist:<channel> — recent
 *                  conversation, which an agent also sees.
 *   pages          public web pages an agent asked for (per reply).
 *   platform       the system prompts, the tool rules, the permission
 *                  levels and the role templates — code. Protected: shown,
 *                  never edited from here, and a memory correction can
 *                  never widen what an agent is allowed to do.
 *
 * Every reply records which of these it was built from (team:prov), so
 * "where did that come from?" is answered from evidence, not guesswork:
 * passages that are in the record AND match the answer are confirmed; the
 * rest of the prompt is listed as present-but-unmatched; what was not in
 * the prompt (the model's own training) is named as such, not inspected.
 *
 * A correction is a proposal first (every conflicting copy, in a table),
 * then applied: the old entry is marked superseded with dates and a pointer
 * to the new one, the new one is current, instructions are edited in place
 * with history, J.A.R.V.I.S.'s memory item is replaced, and a change log
 * keeps before/after for restore. Prompts are rebuilt from the store on
 * every request, so there is no cache to refresh and no model that keeps a
 * copy: the next question, from any agent on any model, uses the current
 * entries; superseded ones are shown to the model only as history, dated.
 * Then verify() proves it from the actual prompt text, not from "saved".
 * ====================================================================== */
'use strict';

const crypto = require('crypto');
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');
const KINDS = ['fact', 'rule', 'preference', 'procedure'];
const day = (t) => { try { return new Date(t).toISOString().slice(0, 10); } catch (e) { return ''; } };

/* ---------- the shape of an entry ---------------------------------------- */
function norm(k) {
  if (!k || typeof k !== 'object') return null;
  k.kind = KINDS.indexOf(k.kind) >= 0 ? k.kind : 'fact';
  if (!k.scope) k.scope = 'shared';
  k.status = k.status === 'superseded' ? 'superseded' : 'current';
  if (!k.validFrom) k.validFrom = k.at || Date.now();
  if (!Array.isArray(k.history)) k.history = [];
  return k;
}
const current = (list) => list.map(norm).filter((k) => k && k.status === 'current');
const superseded = (list) => list.map(norm).filter((k) => k && k.status === 'superseded');

/* ---------- the prompt blocks ------------------------------------------- *
 * What every agent is shown, built the same way everywhere, so what an
 * agent "knows" is exactly what these return — and what verify() checks. */
function blocks(know, agentId, opts) {
  const o = opts || {};
  const inScope = (k) => k.scope === 'shared' || (agentId && k.scope === 'agent:' + agentId);
  const cur = current(know).filter(inScope);
  const facts = cur.filter((k) => k.kind === 'fact' || k.kind === 'preference');
  const rules = cur.filter((k) => k.kind === 'rule' || k.kind === 'procedure');
  const old = superseded(know).filter(inScope).slice(-(o.historyMax || 20));
  const line = (k) => k.id + ' | ' + k.text + (k.scope !== 'shared' ? '' : '') + ' (since ' + day(k.validFrom) + ')';
  return {
    facts, rules, old,
    factsText: facts.length ? facts.map(line).join('\n') : '(nothing yet)',
    rulesText: rules.length ? rules.map((k) => k.id + ' | ' + k.text).join('\n') : '',
    historyText: old.length ? old.map((k) => k.id + ' | ' + k.text + ' (was true until ' + day(k.validTo) + (k.supersededBy ? '; replaced by ' + k.supersededBy : '') + ')').join('\n') : ''
  };
}
/* The whole knowledge section for a specialist's prompt. */
function section(know, agentId) {
  const b = blocks(know, agentId);
  return [
    'WHAT THE TEAM KNOWS (current facts — id | fact | since):',
    b.factsText,
    b.rulesText ? 'RULES AND PROCEDURES THE TEAM FOLLOWS (id | rule):\n' + b.rulesText : '',
    b.historyText ? 'SUPERSEDED (no longer true — only for questions about the past, with its dates; never state these as current):\n' + b.historyText : ''
  ].filter(Boolean).join('\n');
}
const SOURCES = {
  knowledge: { name: 'Team knowledge', editable: true, where: 'Command centre → What the team knows / <agent> remembers' },
  instructions: { name: 'Agent instructions', editable: true, where: 'Command centre → the agent\'s room → Instructions' },
  memory: { name: 'J.A.R.V.I.S.\'s memory of you', editable: true, where: 'Say console → what he remembers (Settings → asstMemory)' },
  preferences: { name: 'Your preferences', editable: false, where: 'Settings (name, language, timezone, voice and manners)' },
  record: { name: 'Your Flow record', editable: false, where: 'The app itself: rocks, notes, journal, expenses, habits' },
  history: { name: 'Recent conversation', editable: false, where: 'The agent\'s thread / the channel history' },
  pages: { name: 'Web pages read', editable: false, where: 'Public pages the agent asked for' },
  platform: { name: 'Platform rules', editable: false, protected: true, where: 'Code: system prompts, tool rules, permission levels, role templates' }
};

/* ---------- provenance: what a reply was built from ---------------------- */
const PROV_MAX = 80;
async function record(ctx, p) {
  const v = await ctx.get('team:prov'); const list = Array.isArray(v) ? v : [];
  const rec = {
    id: 'v' + newId(), at: Date.now(), agent: str(p.agent, 40), via: str(p.via || 'app', 20), model: str(p.model, 60),
    said: str(p.said, 600), reply: block(p.reply, 2500),
    knowledge: (p.knowledge || []).map((k) => k.id), history: (p.superseded || []).map((k) => k.id),
    instructions: p.instructions ? { len: String(p.instructions).length, hash: crypto.createHash('sha1').update(String(p.instructions)).digest('hex').slice(0, 10) } : null,
    memory: (p.memory || []).map((m) => m.id), pages: (p.pages || []).slice(0, 6), snapshot: !!p.snapshot, thread: p.thread | 0,
    /* the entries this reply actually drew on: a number in common, or two content words */
    used: (p.knowledge || []).filter((k) => k && k.text && (function () { const ov = overlap(p.reply || '', k.text); return ov.nums.length > 0 || ov.words.length >= 2; })()).map((k) => k.id).slice(0, 12)
  };
  list.push(rec); await ctx.set('team:prov', list.slice(-PROV_MAX));
  return rec;
}

/* ---------- matching: does this passage support that answer? ------------- */
const STOP = new Set('the and for with that this from have will your they them their what when where which about into over under than then there here been were was are our you his her its not but can could should would also just like only very more most some such each other into onto upon about after before while since until because ve ile için bir bu şu o da de mi mı mu mü ama fakat veya ya ki gibi kadar daha çok en olarak olan oldu olur olacak var yok değil her hiç şey ben sen biz siz onlar bana sana bize size beni seni bizi sizi benim senin bizim sizin onun onların çünkü ancak hem ise işte yani zaten hâlâ sonra önce şimdi bugün yarın dün nasıl neden niçin hangi kim nerede ne zaman bunu şunu onu bunun şunun bütün tüm bazı birkaç'.split(' '));
function terms(text) {
  const t = String(text || '').toLowerCase();
  const words = (t.match(/[\p{L}][\p{L}\-']{3,}/gu) || []).filter((w) => !STOP.has(w));
  const nums = (t.match(/[$€£₺]?\s?\d[\d.,]*\s?(?:%|usd|eur|tl|try|gbp|k)?/gi) || []).map((n) => n.replace(/[\s,]/g, '').replace(/\.00$/, '')).filter((n) => /\d/.test(n));
  return { words: Array.from(new Set(words)), nums: Array.from(new Set(nums)) };
}
function overlap(a, b) {
  const A = terms(a), B = terms(b);
  const words = A.words.filter((w) => B.words.indexOf(w) >= 0 || B.words.some((x) => x.length > 5 && w.length > 5 && (x.startsWith(w.slice(0, 6)) || w.startsWith(x.slice(0, 6)))));
  const nums = A.nums.filter((n) => B.nums.some((m) => m === n || m.replace(/\D/g, '') === n.replace(/\D/g, '')));
  return { words, nums, score: words.length + nums.length * 2 };
}
const sentences = (text) => String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8);

/* ---------- the trace: "where did that come from?" ----------------------- */
async function trace(ctx, deps, q) {
  const list = (await ctx.get('team:prov')) || [];
  let rec = null;
  if (q.id) rec = list.find((r) => r.id === q.id);
  else { const mine = list.filter((r) => !q.agent || r.agent === q.agent); rec = mine[mine.length - 1] || null; }
  if (!rec) return { error: 'No recorded answer to trace yet.' + (q.agent ? ' Ask ' + q.agent + ' something first.' : ''), status: 404 };
  const claim = str(q.claim, 600) || rec.reply;
  const know = (await ctx.get('team:knowledge')) || [];
  const agents = (await ctx.get('team:agents')) || [];
  const a = agents.find((x) => x.id === rec.agent) || {};
  const settings = (await ctx.get('flow:settings')) || {};
  const confirmed = [], present = [];
  const consider = (source, id, passage, extra) => {
    const ov = overlap(claim, passage);
    const row = Object.assign({ source, sourceName: SOURCES[source].name, id, passage: str(passage, 300), where: SOURCES[source].where, editable: !!SOURCES[source].editable, protected: !!SOURCES[source].protected }, extra || {});
    if (ov.score >= 2 || ov.nums.length) { row.matched = ov.words.slice(0, 6).concat(ov.nums); confirmed.push(row); } else present.push(row);
  };
  for (const id of rec.knowledge || []) { const k = know.find((x) => x.id === id); if (k) consider('knowledge', k.id, k.text, { scope: k.scope, kind: k.kind || 'fact', status: k.status || 'current', since: day(k.validFrom || k.at) }); }
  for (const id of rec.history || []) { const k = know.find((x) => x.id === id); if (k) consider('knowledge', k.id, k.text, { scope: k.scope, kind: k.kind || 'fact', status: 'superseded', until: day(k.validTo) }); }
  if (rec.instructions && a.instructions) for (const s of sentences(a.instructions)) consider('instructions', a.id, s, { agent: a.name });
  if (rec.memory && rec.memory.length) for (const m of (settings.asstMemory || [])) if (rec.memory.indexOf(m.id) >= 0) consider('memory', m.id, m.text);
  for (const u of rec.pages || []) present.push({ source: 'pages', sourceName: SOURCES.pages.name, id: u, passage: u, where: SOURCES.pages.where, editable: false });
  if (rec.snapshot) {
    let snap = ''; try { snap = deps.snapshot ? await deps.snapshot(ctx) : ''; } catch (e) {}
    const hits = [];
    for (const sec of String(snap).split(/\n(?=## )/)) {
      const title = (sec.match(/^## ([^\n]*)/) || [])[1] || 'record';
      for (const s of sentences(sec.replace(/^## [^\n]*\n?/, '')).slice(0, 400)) { const ov = overlap(claim, s); if (ov.nums.length || ov.score >= 3) hits.push({ title, s: str(s, 240), matched: ov.words.slice(0, 5).concat(ov.nums) }); if (hits.length >= 6) break; }
      if (hits.length >= 6) break;
    }
    if (hits.length) hits.forEach((h) => confirmed.push({ source: 'record', sourceName: SOURCES.record.name, id: h.title, passage: h.s, where: SOURCES.record.where + ' → ' + h.title, editable: false, matched: h.matched }));
    else present.push({ source: 'record', sourceName: SOURCES.record.name, id: 'record', passage: 'The person\'s own record was in the prompt; no passage matches this answer.', where: SOURCES.record.where, editable: false });
  }
  if (rec.thread) present.push({ source: 'history', sourceName: SOURCES.history.name, id: rec.agent, passage: rec.thread + ' earlier turns of this conversation were in the prompt.', where: SOURCES.history.where, editable: false });
  const notInspected = [
    'The model\'s own training (' + (rec.model || 'unknown model') + '): whatever it answered beyond the sources above came from there, not from your data. That cannot be inspected; it can only be overridden by a current fact.',
    'Platform rules (system prompt, tool rules, permissions): shape how it answers, not what it knows; they are code and were not searched for this claim.'
  ];
  let explanation = '';
  if (confirmed.length) explanation = 'Supported by ' + confirmed.length + ' passage' + (confirmed.length === 1 ? '' : 's') + ' that ' + (confirmed.length === 1 ? 'was' : 'were') + ' in the prompt: ' + confirmed.slice(0, 3).map((c) => c.sourceName + (c.status === 'superseded' ? ' (superseded!)' : '') + ' — "' + str(c.passage, 90) + '"').join('; ') + '.';
  else explanation = 'Nothing in the prompt matches this answer. ' + (present.length ? 'The prompt did contain ' + present.length + ' other source' + (present.length === 1 ? '' : 's') + ' (listed), none of which says this. ' : '') + 'The likeliest origin is the model itself — treat it as unverified and, if it is wrong, correct it so a current fact outranks it.';
  if (confirmed.some((c) => c.status === 'superseded')) explanation += ' A superseded entry matches: it is shown to the model only as history, so if the answer presented it as current, correct the current entry or ask the agent to stick to current facts.';
  return { ok: true, record: { id: rec.id, at: rec.at, agent: rec.agent, agentName: a.name || rec.agent, via: rec.via, model: rec.model, said: rec.said, reply: rec.reply }, claim, confirmed, present, notInspected, explanation };
}

/* ---------- conflicts: every copy that says something else ---------------- */
async function findConflicts(ctx, deps, correction, opts) {
  const o = opts || {};
  const know = ((await ctx.get('team:knowledge')) || []).map(norm).filter(Boolean);
  const agents = (await ctx.get('team:agents')) || [];
  const settings = (await ctx.get('flow:settings')) || {};
  const T = terms(correction);
  const rows = [];
  const hit = (passage) => { const ov = overlap(correction, passage); return (ov.words.length >= 2 || (ov.words.length >= 1 && ov.nums.length)) ? ov : null; };
  for (const k of know) {
    if (o.excludeId && k.id === o.excludeId) continue;
    const ov = hit(k.text); if (!ov) continue;
    const same = str(k.text, 300).toLowerCase() === str(correction, 300).toLowerCase();
    rows.push({ source: 'knowledge', id: k.id, scope: k.scope, kind: k.kind, status: k.status, content: k.text, since: day(k.validFrom), until: k.status === 'superseded' ? day(k.validTo) : '', matched: ov.words.slice(0, 5).concat(ov.nums), editable: true,
      why: k.status === 'superseded' ? 'Already marked superseded (history only).' : same ? 'Says the same thing.' : 'Current entry on the same subject' + (ov.nums.length ? ' with a matching figure' : '') + '; it would be shown to every agent' + (k.scope === 'shared' ? '' : ' (' + k.scope.replace('agent:', '') + ' only)') + ' as current.',
      action: k.status === 'superseded' || same ? 'none' : 'supersede' });
  }
  for (const a of agents) {
    if (a.archived) continue;
    for (const s of sentences(a.instructions || '')) { const ov = hit(s); if (!ov) continue; rows.push({ source: 'instructions', id: a.id, agent: a.name, content: s, matched: ov.words.slice(0, 5).concat(ov.nums), editable: true, why: a.name + '\'s standing instructions say this; they outrank a fact in the agent\'s own mind.', action: 'replace' }); }
    for (const s of sentences(a.role || '')) { const ov = hit(s); if (ov && ov.nums.length) rows.push({ source: 'instructions', id: a.id, agent: a.name, field: 'role', content: s, matched: ov.words.slice(0, 5).concat(ov.nums), editable: true, why: 'In ' + a.name + '\'s role line.', action: 'replace' }); }
  }
  for (const m of (settings.asstMemory || [])) { const ov = hit(m.text); if (!ov) continue; rows.push({ source: 'memory', id: m.id, content: m.text, matched: ov.words.slice(0, 5).concat(ov.nums), editable: true, why: 'J.A.R.V.I.S. remembers this about you and is shown it on every request.', action: 'replace' }); }
  /* read-only sources: named, with the passage, for manual editing */
  if (deps.snapshot) {
    let snap = ''; try { snap = await deps.snapshot(ctx); } catch (e) {}
    let n = 0;
    for (const sec of String(snap).split(/\n(?=## )/)) {
      const title = (sec.match(/^## ([^\n]*)/) || [])[1] || 'record';
      for (const s of sentences(sec.replace(/^## [^\n]*\n?/, '')).slice(0, 400)) { const ov = hit(s); if (ov && (ov.nums.length || ov.words.length >= 3)) { rows.push({ source: 'record', id: title, content: str(s, 240), matched: ov.words.slice(0, 5).concat(ov.nums), editable: false, why: 'In your own Flow record (' + title + '), read into prompts as your data.', action: 'manual', where: SOURCES.record.where + ' → ' + title }); if (++n >= 6) break; } }
      if (n >= 6) break;
    }
  }
  if (deps.platform) for (const p of deps.platform()) { const ov = hit(p.text); if (ov && ov.words.length >= 2) rows.push({ source: 'platform', id: p.id, content: str(p.text, 240), matched: ov.words.slice(0, 5).concat(ov.nums), editable: false, protected: true, why: p.why || 'A platform rule: it governs what agents may do, not what they know. Stays as it is; a memory correction never changes permissions.', action: 'protected' }); }
  for (const a of agents) {
    if (a.archived || !o.includeThreads) continue;
    const th = (await ctx.get('team:thread:' + a.id)) || [];
    for (const m of th.slice(-30)) { if (m.role !== 'assistant') continue; const ov = hit(m.text); if (ov && ov.nums.length) { rows.push({ source: 'history', id: a.id, agent: a.name, content: str(m.text, 200), at: m.at, matched: ov.words.slice(0, 4).concat(ov.nums), editable: false, why: a.name + ' said this earlier; the last turns of a thread are shown back to the agent.', action: 'manual', where: 'Clear ' + a.name + '\'s thread if it keeps echoing it' }); break; } }
  }
  return { rows, terms: T };
}

/* ---------- a correction: proposal, then apply ---------------------------- */
async function propose(ctx, deps, body) {
  const text = str(body.text, 600);
  if (!text) return { error: 'Say what is actually true.', status: 400 };
  const kind = KINDS.indexOf(body.kind) >= 0 ? body.kind : (/\b(always|never|must|should|do not|don't|policy|rule)\b/i.test(text) ? 'rule' : 'fact');
  const scope = /^agent:[\w-]+$/.test(String(body.scope || '')) ? String(body.scope) : 'shared';
  const found = await findConflicts(ctx, deps, text, { includeThreads: true });
  /* with a model: let J.A.R.V.I.S. judge which candidates really conflict and write the replacement sentences */
  let judged = null;
  if (deps.judge && found.rows.some((r) => r.editable && r.action !== 'none')) { try { judged = await deps.judge(ctx, text, found.rows.filter((r) => r.editable && r.action !== 'none')); } catch (e) { judged = null; } }
  const rows = found.rows.map((r, i) => {
    const j = judged && judged[i];
    if (j && j.conflicts === false) return Object.assign({}, r, { action: 'none', why: r.why + ' J.A.R.V.I.S. judged it compatible, not conflicting.' });
    const proposed = r.action === 'supersede' ? 'Mark superseded (true until today); the new entry below becomes current.' : r.action === 'replace' ? ((j && j.replacement) || text) : r.action === 'manual' ? 'Edit it there: "' + text + '"' : r.action === 'protected' ? 'Unchanged (platform rule).' : '—';
    return Object.assign({}, r, { proposed });
  });
  const prop = { id: 'c' + newId(), at: Date.now(), text, kind, scope, rows, newEntry: { text, kind, scope }, applied: false, mode: body.mode === 'audit' ? 'audit' : 'correct' };
  const props = (await ctx.get('team:memprop')) || [];
  props.push(prop); await ctx.set('team:memprop', props.slice(-40));
  return { ok: true, proposal: prop, summary: summarize(prop) };
}
function summarize(p) {
  const n = (a) => p.rows.filter((r) => r.action === a).length;
  const parts = [];
  if (n('supersede')) parts.push(n('supersede') + ' knowledge entr' + (n('supersede') === 1 ? 'y' : 'ies') + ' to mark superseded');
  if (n('replace')) parts.push(n('replace') + ' passage' + (n('replace') === 1 ? '' : 's') + ' to rewrite (instructions / memory)');
  if (n('manual')) parts.push(n('manual') + ' in places only you can edit');
  if (n('protected')) parts.push(n('protected') + ' platform rule' + (n('protected') === 1 ? '' : 's') + ' left as they are');
  return (parts.length ? parts.join(', ') : 'nothing conflicting found') + '; one new current entry (' + p.kind + ', ' + p.scope + ').';
}

async function apply(ctx, deps, body) {
  const props = (await ctx.get('team:memprop')) || [];
  const p = props.find((x) => x.id === String(body.id || ''));
  if (!p) return { error: 'No such proposal.', status: 404 };
  if (p.applied) return { ok: true, proposal: p, already: true };
  const only = Array.isArray(body.rows) ? new Set(body.rows.map(String)) : null;   /* which rows to apply (source:id); default all editable */
  const pick = (r) => r.editable && r.action !== 'none' && (!only || only.has(r.source + ':' + r.id));
  const now = Date.now();
  const changes = [];
  const know = ((await ctx.get('team:knowledge')) || []).map(norm).filter(Boolean);
  /* the new current entry (unless an identical current one exists) */
  let entry = know.find((k) => k.status === 'current' && k.scope === p.scope && k.text.toLowerCase() === p.text.toLowerCase());
  if (!entry) {
    entry = { id: 'k' + newId(), text: p.text, kind: p.kind, scope: p.scope, source: 'you', at: now, updated: now, validFrom: now, status: 'current', supersedes: [], history: [{ at: now, text: p.text, by: 'you', why: 'correction ' + p.id }] };
    know.push(entry); changes.push({ source: 'knowledge', id: entry.id, op: 'add', after: entry.text });
  }
  for (const r of p.rows) {
    if (!pick(r)) continue;
    if (r.source === 'knowledge' && r.action === 'supersede') {
      const k = know.find((x) => x.id === r.id); if (!k || k.status !== 'current') continue;
      k.status = 'superseded'; k.validTo = now; k.supersededBy = entry.id; k.updated = now; k.history.push({ at: now, text: k.text, by: 'you', why: 'superseded by ' + entry.id + ' (correction ' + p.id + ')' });
      entry.supersedes = (entry.supersedes || []).concat([k.id]);
      changes.push({ source: 'knowledge', id: k.id, op: 'supersede', before: k.text, after: entry.text });
    }
  }
  await ctx.set('team:knowledge', know.slice(-600));
  /* instructions, in place, with history */
  const agents = (await ctx.get('team:agents')) || [];
  let agentsChanged = false;
  for (const r of p.rows) {
    if (!pick(r) || r.source !== 'instructions' || r.action !== 'replace') continue;
    const a = agents.find((x) => x.id === r.id); if (!a) continue;
    const field = r.field === 'role' ? 'role' : 'instructions';
    const before = String(a[field] || '');
    if (before.indexOf(r.content) < 0) { changes.push({ source: 'instructions', id: a.id, op: 'skipped', why: 'The passage is no longer there as recorded.' }); continue; }
    a[field] = before.replace(r.content, r.proposed);
    a.instrHistory = (a.instrHistory || []).concat([{ at: now, field, before, by: 'you', why: 'correction ' + p.id }]).slice(-20);
    a.updatedAt = now; agentsChanged = true;
    changes.push({ source: 'instructions', id: a.id, op: 'replace', before: r.content, after: r.proposed });
  }
  if (agentsChanged) await ctx.set('team:agents', agents);
  /* J.A.R.V.I.S.'s memory of the person */
  const settings = (await ctx.get('flow:settings')) || {};
  let memChanged = false;
  for (const r of p.rows) {
    if (!pick(r) || r.source !== 'memory') continue;
    const list = Array.isArray(settings.asstMemory) ? settings.asstMemory : [];
    const m = list.find((x) => x && x.id === r.id); if (!m) continue;
    settings.asstMemoryHistory = (settings.asstMemoryHistory || []).concat([{ at: now, id: m.id, before: m.text, after: r.proposed, why: 'correction ' + p.id }]).slice(-40);
    m.text = str(r.proposed, 200); m.at = new Date(now).toISOString(); memChanged = true;
    changes.push({ source: 'memory', id: m.id, op: 'replace', before: r.content, after: m.text });
  }
  if (memChanged) await ctx.set('flow:settings', settings);
  p.applied = true; p.appliedAt = now; p.changes = changes; p.entryId = entry.id;
  await ctx.set('team:memprop', props);
  const logv = (await ctx.get('team:memlog')) || [];
  logv.push({ id: 'l' + newId(), at: now, proposal: p.id, text: p.text, changes });
  await ctx.set('team:memlog', logv.slice(-200));
  if (deps.log) await deps.log(ctx, 'team', 'Corrected: ' + str(p.text, 120) + ' (' + changes.length + ' change' + (changes.length === 1 ? '' : 's') + ')');
  const manual = p.rows.filter((r) => r.action === 'manual');
  const verification = await verify(ctx, deps, { newText: p.text, oldTexts: changes.filter((c) => c.before).map((c) => c.before), entryId: entry.id });
  return { ok: true, proposal: p, changes, entry, memory: memChanged ? settings.asstMemory : undefined, manual, verification };
}

/* ---------- restore a change ---------------------------------------------- */
async function restore(ctx, deps, body) {
  const logv = (await ctx.get('team:memlog')) || [];
  const L = logv.find((x) => x.id === String(body.id || ''));
  if (!L) return { error: 'No such change.', status: 404 };
  const now = Date.now();
  const know = ((await ctx.get('team:knowledge')) || []).map(norm).filter(Boolean);
  const agents = (await ctx.get('team:agents')) || [];
  const settings = (await ctx.get('flow:settings')) || {};
  const undone = [];
  for (const c of L.changes.slice().reverse()) {
    if (c.source === 'knowledge' && c.op === 'supersede') { const k = know.find((x) => x.id === c.id); if (k) { k.status = 'current'; delete k.validTo; delete k.supersededBy; k.history.push({ at: now, text: k.text, by: 'you', why: 'restored (' + L.id + ')' }); undone.push(c); } }
    else if (c.source === 'knowledge' && c.op === 'add') { const k = know.find((x) => x.id === c.id); if (k && k.status === 'current') { k.status = 'superseded'; k.validTo = now; k.history.push({ at: now, text: k.text, by: 'you', why: 'withdrawn (restore ' + L.id + ')' }); undone.push(c); } }
    else if (c.source === 'instructions' && c.op === 'replace') { const a = agents.find((x) => x.id === c.id); if (a) { for (const f of ['instructions', 'role']) if (String(a[f] || '').indexOf(c.after) >= 0) { a[f] = a[f].replace(c.after, c.before); a.instrHistory = (a.instrHistory || []).concat([{ at: now, field: f, before: a[f], by: 'you', why: 'restored (' + L.id + ')' }]).slice(-20); undone.push(c); break; } } }
    else if (c.source === 'memory' && c.op === 'replace') { const m = (settings.asstMemory || []).find((x) => x && x.id === c.id); if (m) { m.text = c.before; undone.push(c); } }
  }
  await ctx.set('team:knowledge', know); await ctx.set('team:agents', agents); await ctx.set('flow:settings', settings);
  logv.push({ id: 'l' + newId(), at: now, restoreOf: L.id, text: 'Restored: ' + L.text, changes: undone.map((c) => ({ source: c.source, id: c.id, op: 'restore', before: c.after, after: c.before })) });
  await ctx.set('team:memlog', logv.slice(-200));
  if (deps.log) await deps.log(ctx, 'team', 'Restored: ' + str(L.text, 120));
  return { ok: true, undone, memory: settings.asstMemory };
}

/* ---------- edit / remove one entry ---------------------------------------- */
async function edit(ctx, deps, body) {
  const know = ((await ctx.get('team:knowledge')) || []).map(norm).filter(Boolean);
  const k = know.find((x) => x.id === String(body.id || ''));
  if (!k) return { error: 'No such entry.', status: 404 };
  const now = Date.now(); const before = Object.assign({}, k);
  const op = String(body.op || 'edit');
  if (op === 'edit') {
    const text = str(body.text, 300); if (!text) return { error: 'Write the fact first.', status: 400 };
    if (text !== k.text) { k.history.push({ at: now, text: k.text, by: 'you', why: 'edited' }); k.text = text; }
    if (KINDS.indexOf(body.kind) >= 0) k.kind = body.kind;
    if (body.scope === 'shared' || /^agent:[\w-]+$/.test(String(body.scope || ''))) k.scope = body.scope;
    k.updated = now; k.source = 'you';
  } else if (op === 'supersede') { k.status = 'superseded'; k.validTo = now; k.history.push({ at: now, text: k.text, by: 'you', why: 'marked superseded' }); }
  else if (op === 'restore') { k.status = 'current'; delete k.validTo; delete k.supersededBy; k.history.push({ at: now, text: k.text, by: 'you', why: 'restored to current' }); }
  else if (op === 'remove') { const rest = know.filter((x) => x.id !== k.id); await ctx.set('team:knowledge', rest); await logChange(ctx, { source: 'knowledge', id: k.id, op: 'remove', before: k.text }, 'Removed: ' + k.text); if (deps.log) await deps.log(ctx, 'team', 'Knowledge removed: ' + str(k.text, 120)); return { ok: true, removed: k, knowledge: rest }; }
  else return { error: 'edit, supersede, restore or remove.', status: 400 };
  await ctx.set('team:knowledge', know);
  await logChange(ctx, { source: 'knowledge', id: k.id, op, before: before.text, after: k.text }, op + ': ' + k.text);
  if (deps.log) await deps.log(ctx, 'team', 'Knowledge ' + op + ': ' + str(k.text, 120));
  return { ok: true, item: k, knowledge: know };
}
async function logChange(ctx, change, text) {
  const logv = (await ctx.get('team:memlog')) || [];
  logv.push({ id: 'l' + newId(), at: Date.now(), text: str(text, 200), changes: [change] });
  await ctx.set('team:memlog', logv.slice(-200));
}

/* ---------- verify: from the prompts themselves --------------------------- */
async function verify(ctx, deps, q) {
  const newText = str(q.newText, 600); const olds = (q.oldTexts || []).map((t) => str(t, 600)).filter(Boolean);
  const know = ((await ctx.get('team:knowledge')) || []).map(norm).filter(Boolean);
  const agents = ((await ctx.get('team:agents')) || []).filter((a) => !a.archived);
  const checks = [];
  const T = terms(newText); const keyNums = T.nums; const keyWords = T.words.slice(0, 6);
  const saysNew = (text) => { const ov = overlap(newText, text); return ov.score >= Math.min(3, keyWords.length + keyNums.length * 2); };
  for (const a of agents) {
    const sec = section(know, a.id);
    const cur = sec.split('SUPERSEDED')[0];
    const hist = sec.indexOf('SUPERSEDED') >= 0 ? sec.slice(sec.indexOf('SUPERSEDED')) : '';
    const hasNew = cur.indexOf(newText) >= 0 || saysNew(cur);
    const oldInCurrent = olds.filter((o) => cur.indexOf(o) >= 0);
    const oldInHistory = olds.filter((o) => hist.indexOf(o) >= 0);
    checks.push({ name: a.name + ' is shown the corrected fact as current', pass: hasNew, detail: hasNew ? 'In the current block of ' + a.name + '\'s prompt.' : 'Not found in the current block (scope: ' + (q.scope || 'shared') + ').' });
    if (olds.length) checks.push({ name: 'The old version is not shown to ' + a.name + ' as current', pass: oldInCurrent.length === 0, detail: oldInCurrent.length ? 'Still current: ' + oldInCurrent.map((o) => '"' + str(o, 80) + '"').join(', ') : (oldInHistory.length ? 'Present only under SUPERSEDED, dated.' : 'Absent from the prompt.') });
    const instrOld = olds.filter((o) => String(a.instructions || '').indexOf(o) >= 0);
    if (olds.length) checks.push({ name: a.name + '\'s instructions no longer carry the old version', pass: instrOld.length === 0, detail: instrOld.length ? 'Still in the instructions: "' + str(instrOld[0], 80) + '"' : 'Clean.' });
  }
  const settings = (await ctx.get('flow:settings')) || {};
  const memOld = olds.filter((o) => (settings.asstMemory || []).some((m) => m && m.text === o));
  if (olds.length) checks.push({ name: 'J.A.R.V.I.S.\'s memory of you no longer carries the old version', pass: memOld.length === 0, detail: memOld.length ? 'Still remembered: "' + str(memOld[0], 80) + '"' : 'Clean.' });
  const entry = q.entryId ? know.find((k) => k.id === q.entryId) : know.find((k) => k.status === 'current' && k.text === newText);
  if (entry) {
    const sup = (entry.supersedes || []).map((id) => know.find((k) => k.id === id)).filter(Boolean);
    checks.push({ name: 'History is kept, dated', pass: sup.every((k) => k.status === 'superseded' && k.validTo), detail: sup.length ? sup.map((k) => '"' + str(k.text, 60) + '" true until ' + day(k.validTo)).join('; ') : 'Nothing was superseded by this entry.' });
  }
  checks.push({ name: 'Survives a model change', pass: true, detail: 'Prompts are rebuilt from the store on every request; the model is never the holder of a fact. The same blocks go to Anthropic, OpenAI, xAI or DeepSeek.' });
  checks.push({ name: 'Permissions unchanged', pass: true, detail: 'A memory correction cannot touch permission levels or platform rules: they are not among the editable sources.' });
  /* the real test: ask, through the actual retrieval path */
  if (q.ask && deps.ask) {
    try {
      const r = await deps.ask(ctx, q.agent || 'sarah', q.ask);
      if (r && r.say) {
        const saysOld = olds.some((o) => { const on = terms(o).nums; return on.length && on.some((n) => terms(r.say).nums.some((m) => m.replace(/\D/g, '') === n.replace(/\D/g, ''))) && !saysNew(r.say); });
        checks.push({ name: 'A fresh question gets the corrected answer', pass: saysNew(r.say) && !saysOld, detail: '"' + str(q.ask, 80) + '" → "' + str(r.say, 220) + '"' + (r.model ? ' (' + r.model + ')' : '') });
      } else checks.push({ name: 'A fresh question gets the corrected answer', pass: false, detail: (r && r.error) || 'No answer.' });
    } catch (e) { checks.push({ name: 'A fresh question gets the corrected answer', pass: false, detail: 'Could not ask: ' + (e && e.message) }); }
  }
  const inaccessible = ['Your Flow record (rocks, notes, journal, spend) — read, not edited here; edit it in the app if it carries the old version.', 'Conversation history — earlier turns may quote the old version; agents are told superseded facts are history.'];
  return { ok: true, checks, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length, inaccessible };
}

/* ---------- the workspace list -------------------------------------------- */
async function list(ctx, deps, q) {
  const know = ((await ctx.get('team:knowledge')) || []).map(norm).filter(Boolean);
  const agents = ((await ctx.get('team:agents')) || []).filter((a) => !a.archived);
  const settings = (await ctx.get('flow:settings')) || {};
  const needle = str(q.q, 200).toLowerCase();
  const match = (t) => !needle || String(t || '').toLowerCase().indexOf(needle) >= 0 || overlap(needle, t).score >= 2;
  const items = [];
  for (const k of know) if (match(k.text)) items.push({ source: 'knowledge', id: k.id, text: k.text, kind: k.kind, scope: k.scope, status: k.status, since: day(k.validFrom), until: k.status === 'superseded' ? day(k.validTo) : '', supersededBy: k.supersededBy || '', supersedes: k.supersedes || [], by: k.source, versions: (k.history || []).length, editable: true });
  for (const m of (settings.asstMemory || [])) if (m && match(m.text)) items.push({ source: 'memory', id: m.id, text: m.text, kind: 'preference', scope: 'jarvis', status: 'current', since: day(m.at), editable: true });
  for (const a of agents) if (a.instructions && match(a.instructions)) items.push({ source: 'instructions', id: a.id, text: str(a.instructions, 300), kind: 'procedure', scope: 'agent:' + a.id, agent: a.name, status: 'current', since: day(a.updatedAt), versions: (a.instrHistory || []).length, editable: true });
  const prefs = [['name', settings.name], ['language', settings.lang], ['timezone', settings.timezone], ['voice', settings.asstVoice], ['manner', settings.asstPersona || settings.asstManner]].filter((p) => p[1]);
  for (const p of prefs) if (match(p[0] + ' ' + p[1])) items.push({ source: 'preferences', id: p[0], text: p[0] + ': ' + p[1], kind: 'preference', scope: 'you', status: 'current', editable: false, where: SOURCES.preferences.where });
  if (deps.platform) for (const p of deps.platform()) if (match(p.text)) items.push({ source: 'platform', id: p.id, text: str(p.text, 240), kind: 'rule', scope: 'platform', status: 'current', editable: false, protected: true, where: SOURCES.platform.where });
  const logv = ((await ctx.get('team:memlog')) || []).slice(-30).reverse();
  const props = ((await ctx.get('team:memprop')) || []).slice(-10).reverse();
  const prov = (await ctx.get('team:prov')) || []; const lastRec = prov[prov.length - 1];
  return { ok: true, items, lastAnswer: lastRec ? { agent: lastRec.agent, at: lastRec.at } : null, counts: { current: know.filter((k) => k.status === 'current').length, superseded: know.filter((k) => k.status === 'superseded').length }, log: logv, proposals: props, sources: SOURCES };
}

async function history(ctx, deps, q) {
  const know = ((await ctx.get('team:knowledge')) || []).map(norm).filter(Boolean);
  const k = know.find((x) => x.id === String(q.id || ''));
  if (k) return { ok: true, item: k, versions: k.history, supersedes: (k.supersedes || []).map((id) => know.find((x) => x.id === id)).filter(Boolean), supersededBy: k.supersededBy ? know.find((x) => x.id === k.supersededBy) : null };
  const agents = (await ctx.get('team:agents')) || [];
  const a = agents.find((x) => x.id === String(q.id || ''));
  if (a) return { ok: true, agent: { id: a.id, name: a.name, instructions: a.instructions, role: a.role }, versions: a.instrHistory || [] };
  return { error: 'No such entry.', status: 404 };
}

/* ---------- routes ---------------------------------------------------------- */
async function handle(p, req, res, ctx, deps) {
  if (p.indexOf('/api/team/memory') !== 0) return false;
  const json = ctx.json;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };
  const out = (r) => { if (r && r.error) json(res, r.status || 400, r); else json(res, 200, r); return true; };
  if (p === '/api/team/memory' && req.method === 'GET') return out(await list(ctx, deps, { q: ctx.query.get('q') }));
  if (p === '/api/team/memory/history' && req.method === 'GET') return out(await history(ctx, deps, { id: ctx.query.get('id') }));
  if (p === '/api/team/memory/trace' && req.method === 'POST') return out(await trace(ctx, deps, await body()));
  if (p === '/api/team/memory/correct' && req.method === 'POST') return out(await propose(ctx, deps, await body()));
  if (p === '/api/team/memory/audit' && req.method === 'POST') { const b = await body(); return out(await propose(ctx, deps, Object.assign({}, b, { text: b.text || b.about, mode: 'audit' }))); }
  if (p === '/api/team/memory/apply' && req.method === 'POST') return out(await apply(ctx, deps, await body()));
  if (p === '/api/team/memory/restore' && req.method === 'POST') return out(await restore(ctx, deps, await body()));
  if (p === '/api/team/memory/edit' && req.method === 'POST') return out(await edit(ctx, deps, await body()));
  if (p === '/api/team/memory/verify' && req.method === 'POST') { const b = await body(); return out(await verify(ctx, deps, { newText: b.newText || b.text, oldTexts: b.oldTexts || (b.old ? [b.old] : []), ask: b.ask, agent: b.agent, entryId: b.entryId })); }
  return false;
}

module.exports = { handle, blocks, section, record, trace, findConflicts, propose, apply, restore, edit, verify, list, history, norm, current, superseded, terms, overlap, sentences, SOURCES, KINDS, _internals: { summarize } };
