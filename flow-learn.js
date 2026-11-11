/* =========================================================================
 * flow-learn.js — J.A.R.V.I.S. notices what is worth keeping
 *
 * The other modules learn when they are told to ("remember…", Teach a skill,
 * "turn this into a skill", the efficiency review). This one looks back on
 * its own, the way the self-improving agents do (Hermes Agent's review every
 * few turns), and keeps one rule they do not: it only PROPOSES. Nothing it
 * finds reaches the team's knowledge or the skills until the person says yes.
 *
 * When it looks: after every ~10 things the person says to J.A.R.V.I.S. (the
 * chats count them as they are kept), after a team task with two or more
 * steps finishes, or when asked ("Look now"). At most one review every few
 * minutes per account, one at a time.
 *
 * What it reads: the turns said since the last review (only those), the
 * tasks finished since then, and — to avoid repeating itself — what the team
 * already knows, the skills there are, and every proposal already made,
 * kept or declined.
 *
 * What it proposes:
 *   memory   a durable fact, rule or preference the person stated (not one
 *            the assistant suggested, not a passing mood, nothing secret,
 *            nothing sensitive); when it changes a figure the team already
 *            holds, it says which entry it would replace — keeping it marks
 *            the old one superseded, dated, as a correction does
 *   skill    a recurring procedure: the same kind of work done twice, or a
 *            routine the person described step by step
 * Each proposal carries the words it came from (the quote) and where they
 * were said (which chat, which task), so "why do you think that?" has an
 * answer. Keep (as is, or edited) or Not this; a declined idea is remembered
 * so it is not offered again.
 *
 *   team:learn   { on, every, turns, lastAt, mark, taskMark, pending:[],
 *                  decided:[], reviews:[] }
 * ====================================================================== */
'use strict';

const crypto = require('crypto');
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');
const KINDS = ['fact', 'rule', 'preference', 'procedure'];
const GAP_MS = 4 * 60 * 1000;
const MAX_PENDING = 30;

/* Never proposed, whatever was said: secrets, ID and card numbers, and the
   kinds of personal detail a planner has no business filing on its own. */
const SECRET = /\b(?:sk|rk|re|xox[abp]|ghp|AKIA)[-_][A-Za-z0-9_-]{12,}|\b(?:password|passcode|şifre|parola|api[ -]?key|secret|token|pin)\b\s*(?:is|:|=)\s*\S{4,}|\b\d(?:[ -]?\d){12,18}\b|\bIBAN\b|\bTR\d{2}\s?\d{4}/i;
const SENSITIVE = /\b(?:diagnos\w*|depress\w*|anxiety|therapy|therapist|medication|pills?|self[- ]harm|suicid\w*|pregnan\w*|hiv|cancer|arrest\w*|criminal|lawsuit against me|salary|maaş|borcum|debt|credit score|immigration|visa status|sexual|religio\w*|ilaç|hastalı\w*|teşhis)\b/i;

async function state(ctx) {
  const v = await ctx.get('team:learn'); const s = v && typeof v === 'object' ? v : {};
  if (typeof s.on !== 'boolean') s.on = true;
  s.every = Math.max(4, Math.min(40, +s.every || 10));
  s.turns = Math.max(0, +s.turns || 0);
  ['pending', 'decided', 'reviews'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
  s.mark = +s.mark || 0; s.taskMark = +s.taskMark || 0; s.lastAt = +s.lastAt || 0;
  return s;
}
async function save(ctx, s) { s.pending = s.pending.slice(-MAX_PENDING); s.decided = s.decided.slice(-150); s.reviews = s.reviews.slice(-20); await ctx.set('team:learn', s); }

/* ---------- reading what changed ------------------------------------------ */
async function material(ctx, deps, s, uid) {
  const out = { turns: [], tasks: [], newestAt: s.mark, newestTask: s.taskMark };
  const ch = deps.chats ? deps.chats(uid) : null;
  if (ch) {
    const idx = await ch.get('index'); const list = (Array.isArray(idx) ? idx : []).filter((x) => (x.at || 0) > s.mark).slice(0, 8);
    for (const x of list) {
      const c = await ch.get('c:' + x.id); if (!c) continue;
      const fresh = (c.messages || []).filter((m) => (m.at || 0) > s.mark);
      fresh.forEach((m) => { out.turns.push({ chat: c.id, title: c.title || 'Chat', role: m.role, text: block(m.text, 1200), at: m.at || c.at }); if ((m.at || 0) > out.newestAt) out.newestAt = m.at; });
    }
    out.turns.sort((a, b) => a.at - b.at);
    /* the last 80 turns at most, about 12k characters */
    out.turns = out.turns.slice(-80); let n = 0;
    for (let i = out.turns.length - 1; i >= 0; i--) { n += out.turns[i].text.length; if (n > 12000) { out.turns = out.turns.slice(i + 1); break; } }
  }
  const tl = deps.tasks ? await deps.tasks(ctx) : [];
  out.tasks = tl.filter((t) => t.status === 'done' && (t.doneAt || t.updatedAt || 0) > s.taskMark).slice(-6);
  out.tasks.forEach((t) => { const at = t.doneAt || t.updatedAt || 0; if (at > out.newestTask) out.newestTask = at; });
  out.allDone = tl.filter((t) => t.status === 'done');
  return out;
}

/* ---------- finding, without a model (and in tests) ---------------------- */
const REMEMBER = /^(?:please\s+)?(?:remember|note|keep in mind|don'?t forget|for the record)\s*(?:that|:|,)?\s+(.{6,300})$/i;
const REMEMBER_TR = /^(?:lütfen\s+)?(?:şunu\s+)?(?:hatırla|unutma|not al|aklında tut)\s*(?:ki|:|,)?\s+(.{6,300})$|^(.{6,300}?)[,;:]?\s+(?:bunu\s+)?(?:hatırla|unutma|aklında tut)\.?$/i;
const RULE = /\b(?:i|we)\s+(?:always|never)\b|\b(?:always|never)\s+(?:send|book|schedule|use|call|email|cc|copy|put|add|pay|order|reply|write)\b|\b(?:her zaman|asla|hiçbir zaman)\b/i;
const PREF = /\b(?:i|we)\s+(?:prefer|'d rather|would rather|like it when|don'?t like|hate it when)\b|\b(?:tercih ederim|tercihim|hoşuma gitmez|sevmem)\b/i;
const FACT = /\b(?:my|our)\s+([a-z][\w' -]{1,30}?)\s+(?:is|are|lives|works|costs|charges|starts|ends)\b|\b([A-ZÇĞİÖŞÜ][\wçğıöşü]+)\s+is\s+(?:my|our)\s+([a-z][\w' -]{1,30})\b|\b([A-ZÇĞİÖŞÜ][\wçğıöşü]+)\s+(?:benim|bizim)\s+(\S+)/;
function scanTurns(turns, ownerName) {
  const name = str(ownerName, 40) || 'the person';
  const out = [];
  for (const m of turns) {
    if (m.role !== 'user') continue;
    const t = str(m.text, 400);
    if (/\?\s*$/.test(t) && !REMEMBER.test(t)) continue;
    let text = '', kind = 'fact', why = '';
    const r1 = t.match(REMEMBER), r2 = t.match(REMEMBER_TR);
    if (r1) { text = r1[1]; why = 'You asked him to remember it.'; }
    else if (r2) { text = r2[1] || r2[2]; why = 'You asked him to remember it.'; }
    else if (RULE.test(t)) { text = t; kind = 'rule'; why = 'Said as a standing rule.'; }
    else if (PREF.test(t)) { text = t; kind = 'preference'; why = 'Said as a preference.'; }
    else if (FACT.test(t) && t.length <= 220 && !/\b(?:today|tomorrow|tonight|this (?:week|morning|evening)|yarın|bugün|bu akşam)\b/i.test(t)) { text = t; why = 'A fact about your world, said in passing.'; }
    if (!text) continue;
    text = str(text.replace(/[.!]+$/, ''), 300);
    text = text.replace(/\bI am\b/g, name + ' is').replace(/\bI'm\b/g, name + ' is').replace(/\bI\b/g, name).replace(/\bmy\b/g, name + '\'s').replace(/\bMy\b/g, name + '\'s').replace(/\bwe\b/gi, name + '\'s team').replace(/\bour\b/gi, name + '\'s team\'s');
    text = text.charAt(0).toUpperCase() + text.slice(1) + '.';
    if (RULE.test(text)) kind = 'rule';
    out.push({ kind: 'memory', mkind: kind, text, quote: str(m.text, 300), why, from: { chat: m.chat, title: m.title, at: m.at } });
  }
  return out.slice(0, 6);
}
function scanTasks(fresh, allDone, deps, skillsList) {
  const out = [];
  const terms = deps.terms || ((t) => String(t || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const sim = (a, b) => { const A = new Set(terms(a)), B = new Set(terms(b)); if (!A.size || !B.size) return 0; let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return n / Math.max(2, Math.min(A.size, B.size)); };
  for (const t of fresh) {
    const like = allDone.filter((x) => x.id !== t.id && sim(x.title + ' ' + (x.brief || ''), t.title + ' ' + (t.brief || '')) >= 0.5);
    if (!like.length) continue;
    const covered = (skillsList || []).some((s) => s.status !== 'archived' && (deps.skillScore ? deps.skillScore(s, t.title + '\n' + (t.brief || '')) >= 4 : sim(s.name + ' ' + s.purpose, t.title) >= 0.5));
    if (covered) continue;
    const doc = deps.draftFromTask ? deps.draftFromTask(t) : null; if (!doc || !doc.name) continue;
    out.push({ kind: 'skill', doc, quote: str(t.title, 200), why: 'The team has now done this kind of work ' + (like.length + 1) + ' times (“' + str(like[like.length - 1].title, 80) + '” before) and there is no skill for it yet.', from: { task: t.id, title: t.title, at: t.doneAt || t.updatedAt } });
  }
  return out.slice(0, 2);
}
function scanRoutine(turns, deps) {
  const out = [];
  for (const m of turns) {
    if (m.role !== 'user') continue;
    const t = String(m.text || '');
    const numbered = (t.match(/(?:^|\n)\s*(?:\d+[.)]|[-*•])\s+\S/g) || []).length;
    const recurring = /\b(?:every (?:week|month|monday|tuesday|wednesday|thursday|friday|day|morning)|each (?:week|month|time)|whenever|weekly|monthly|her (?:hafta|ay|gün|pazartesi|sabah)|haftalık|aylık)\b/i.test(t);
    if (numbered >= 3 && recurring && deps.draftFromText) {
      const doc = deps.draftFromText(t); if (!doc || !doc.name) continue;
      doc.name = str(doc.name.replace(/[:.\s]+$/, ''), 80);
      if (!doc.purpose || doc.purpose === doc.approvals || doc.purpose === doc.exceptions) doc.purpose = 'The routine you described: ' + doc.name.charAt(0).toLowerCase() + doc.name.slice(1) + '.';
      out.push({ kind: 'skill', doc, quote: str(t, 300), why: 'You described a recurring routine step by step.', from: { chat: m.chat, title: m.title, at: m.at } });
    }
  }
  return out.slice(0, 1);
}

/* ---------- with a model ----------------------------------------------------- */
const SYSTEM = [
  'You review a stretch of conversation between a person and their assistant J.A.R.V.I.S. (and work their AI team finished) and propose what is worth KEEPING for the future. You only propose; the person decides.',
  'Return ONLY JSON: {"memory": [{"text": one self-contained sentence in the third person naming the person (e.g. "Artur\'s lawyer is Burak."), "kind": "fact"|"rule"|"preference", "quote": the person\'s exact words it comes from, "why": one short reason}], "skills": [{"name", "purpose", "when", "steps": [ordered strings], "inputs": [strings], "approvals", "quote", "why"}]}.',
  'MEMORY: only what the PERSON stated or clearly confirmed — never something the assistant suggested that they merely did not object to. Only what will still be true and useful in a month in a different conversation: people and who they are to the person, standing rules ("always cc Oğuz"), preferences about how work is done, stable facts about the business (prices, terms, addresses of places they go). Not tasks for this week, not moods, not one-off plans, not anything already listed under ALREADY KNOWN (or saying the same thing), not anything listed under ALREADY PROPOSED.',
  'Never propose: passwords, keys, card/ID/account numbers; health, diagnoses, medication; money balances, salary, debts; religion, politics, sexuality, immigration, legal trouble.',
  'SKILLS: only a procedure that will recur — the person described a routine step by step, or the team has done the same kind of work twice — and that is not covered by an EXISTING SKILL. Steps in order, decision points included; one-time details (names, amounts, dates, links) become inputs.',
  'At most 5 memory items and 2 skills. Empty arrays are a perfectly good answer. Keep the person\'s language (Turkish stays Turkish).'
].join('\n');
async function modelFind(ctx, deps, m, s, ownerName) {
  if (!deps.modelJson) return null;
  const know = deps.knowledge ? (await deps.knowledge(ctx)).filter((k) => k.status !== 'superseded') : [];
  const skillsList = deps.skills ? await deps.skills(ctx) : [];
  const user = [
    'THE PERSON: ' + (ownerName || 'the person'),
    'ALREADY KNOWN (team knowledge):\n' + (know.length ? know.slice(-120).map((k) => '- ' + k.text).join('\n') : '(nothing)'),
    'EXISTING SKILLS: ' + (skillsList.filter((x) => x.status !== 'archived').map((x) => x.name).join('; ') || '(none)'),
    'ALREADY PROPOSED (kept or declined — do not repeat): ' + (s.pending.concat(s.decided).slice(-60).map((p) => p.text || (p.doc && p.doc.name)).filter(Boolean).join(' | ') || '(none)'),
    '',
    'CONVERSATION SINCE THE LAST REVIEW:',
    m.turns.length ? m.turns.map((t) => (t.role === 'user' ? 'Person' : 'J.A.R.V.I.S.') + ' [' + t.chat + ']: ' + t.text).join('\n') : '(none)',
    '',
    'TEAM WORK FINISHED SINCE THEN:',
    m.tasks.length ? m.tasks.map((t) => '- [' + t.id + '] ' + t.title + ': ' + str(t.brief, 300) + ' — steps: ' + (t.steps || []).map((x) => x.title).join(' → ')).join('\n') : '(none)'
  ].join('\n');
  const j = await deps.modelJson(ctx, SYSTEM, user, 2200);
  if (!j || typeof j !== 'object') return null;
  const findChat = (quote) => { const q = str(quote, 60).toLowerCase(); const hit = m.turns.find((t) => t.role === 'user' && q && t.text.toLowerCase().indexOf(q.slice(0, 40)) >= 0) || m.turns.filter((t) => t.role === 'user').slice(-1)[0]; return hit ? { chat: hit.chat, title: hit.title, at: hit.at } : {}; };
  const memory = (Array.isArray(j.memory) ? j.memory : []).slice(0, 5).map((x) => ({ kind: 'memory', mkind: KINDS.indexOf(x && x.kind) >= 0 ? x.kind : 'fact', text: str(x && x.text, 300), quote: str(x && x.quote, 300), why: str(x && x.why, 200), from: findChat(x && x.quote) })).filter((x) => x.text);
  const skills = (Array.isArray(j.skills) ? j.skills : []).slice(0, 2).map((x) => {
    const doc = deps.cleanDoc ? deps.cleanDoc({ name: x && x.name, purpose: x && x.purpose, when: x && x.when, steps: x && x.steps, inputs: x && x.inputs, approvals: x && x.approvals, type: 'workflow' }) : null;
    const t = m.tasks.find((y) => x && x.quote && y.title && String(x.quote).indexOf(y.title.slice(0, 30)) >= 0);
    return doc && doc.name ? { kind: 'skill', doc, quote: str(x.quote, 300), why: str(x.why, 200), from: t ? { task: t.id, title: t.title, at: t.doneAt || t.updatedAt } : findChat(x.quote) } : null;
  }).filter(Boolean);
  return memory.concat(skills);
}

/* ---------- filtering --------------------------------------------------------- */
function similar(deps, a, b) {
  if (deps.overlap) { const o = deps.overlap(a, b); const n = Math.max(3, Math.min(String(a).split(/\s+/).length, String(b).split(/\s+/).length) / 2); return { sim: o.words.length / n, nums: o.nums.length, o }; }
  return { sim: String(a).toLowerCase() === String(b).toLowerCase() ? 1 : 0, nums: 0 };
}
const numsOf = (t) => (String(t || '').match(/\d[\d.,]*/g) || []).map((x) => x.replace(/[.,](?=\d{3}\b)/g, ''));
async function filter(ctx, deps, found, s) {
  const know = deps.knowledge ? (await deps.knowledge(ctx)).filter((k) => k.status !== 'superseded') : [];
  const skillsList = deps.skills ? await deps.skills(ctx) : [];
  const seen = s.pending.concat(s.decided);
  const out = [];
  for (const f of found) {
    const flat = f.kind === 'memory' ? f.text : JSON.stringify(f.doc || {});
    if (SECRET.test(flat) || SECRET.test(f.quote || '')) continue;
    if (f.kind === 'memory' && (SENSITIVE.test(f.text) || SENSITIVE.test(f.quote || ''))) continue;
    if (f.kind === 'memory') {
      if (seen.some((p) => p.kind === 'memory' && similar(deps, p.text, f.text).sim >= 0.7)) continue;
      if (out.some((p) => p.kind === 'memory' && similar(deps, p.text, f.text).sim >= 0.7)) continue;
      /* the same sentence again with another number: the latest one stands */
      const shape = (t) => String(t).toLowerCase().replace(/[\d.,$€£₺%]+/g, '#').replace(/\s+/g, ' ');
      const twin = out.findIndex((p) => p.kind === 'memory' && shape(p.text) === shape(f.text));
      if (twin >= 0) out.splice(twin, 1);
      let replaces = null, dup = false;
      for (const k of know) {
        const sm = similar(deps, k.text, f.text);
        if (sm.sim < 0.5) continue;
        const A = numsOf(k.text), B = numsOf(f.text);
        const differ = A.length && B.length && A.join() !== B.join();
        if (differ && sm.sim >= 0.5) { replaces = { id: k.id, text: k.text }; break; }
        if (sm.sim >= 0.7) { dup = true; break; }
      }
      if (dup) continue;
      out.push(Object.assign({}, f, replaces ? { replaces } : {}));
    } else {
      const name = String(f.doc.name || '').toLowerCase();
      if (skillsList.some((x) => x.status !== 'archived' && x.name.toLowerCase() === name)) continue;
      if (seen.some((p) => p.kind === 'skill' && p.doc && String(p.doc.name || '').toLowerCase() === name)) continue;
      if (deps.secretish && deps.secretish(f.doc)) continue;
      out.push(f);
    }
  }
  return out;
}

/* ---------- the review ---------------------------------------------------------- */
const running = new Set();
async function review(ctx, deps, uid, why) {
  if (running.has(uid)) return { ok: true, busy: true, found: 0 };
  running.add(uid);
  try {
    const s = await state(ctx);
    const m = await material(ctx, deps, s, uid);
    const owner = ctx.user ? str((ctx.user.name || '').split(/\s+/)[0] || ctx.user.email, 40) : '';
    let found = null, how = 'rules';
    if (m.turns.length || m.tasks.length) {
      try { found = await modelFind(ctx, deps, m, s, owner); if (found) how = 'model'; } catch (e) { found = null; }
      if (!found) found = scanTurns(m.turns, owner).concat(scanRoutine(m.turns, deps), scanTasks(m.tasks, m.allDone, deps, deps.skills ? await deps.skills(ctx) : []));
    } else found = [];
    const kept = await filter(ctx, deps, found, s);
    const now = Date.now();
    const fresh = kept.map((f) => Object.assign({ id: 'lp' + newId(), at: now, status: 'pending' }, f));
    const S = await state(ctx);   /* re-read: a keep may have happened meanwhile */
    S.pending = S.pending.concat(fresh);
    S.mark = Math.max(S.mark, m.newestAt); S.taskMark = Math.max(S.taskMark, m.newestTask);
    S.turns = 0; S.lastAt = now;
    S.reviews.push({ at: now, why: str(why, 40) || 'turns', turns: m.turns.length, tasks: m.tasks.length, found: fresh.length, how });
    await save(ctx, S);
    if (fresh.length && deps.log) await deps.log(ctx, 'jarvis', 'J.A.R.V.I.S. noticed ' + fresh.length + ' thing' + (fresh.length === 1 ? '' : 's') + ' worth keeping — waiting for your yes under Memory → Worth keeping.');
    return { ok: true, found: fresh.length, items: fresh, how, read: { turns: m.turns.length, tasks: m.tasks.length } };
  } finally { running.delete(uid); }
}

/* Counted as the chats are kept; a review starts in the background when due. */
async function note(ctx, deps, uid, ev) {
  const s = await state(ctx);
  if (!s.on) return { due: false };
  if (ev && ev.kind === 'chat') s.turns += Math.max(0, +ev.userTurns || 0);
  const taskDue = ev && ev.kind === 'task' && (ev.steps || 0) >= 2;
  const due = (s.turns >= s.every || taskDue) && Date.now() - s.lastAt > GAP_MS && !running.has(uid);
  await ctx.set('team:learn', s);
  if (due) setImmediate(() => { review(ctx, deps, uid, taskDue ? 'task' : 'turns').catch(() => {}); });
  return { due, turns: s.turns };
}

/* ---------- deciding -------------------------------------------------------------- */
async function accept(ctx, deps, b) {
  const s = await state(ctx);
  const p = s.pending.find((x) => x.id === String(b.id || ''));
  if (!p) return { error: 'That idea is no longer waiting.', status: 404 };
  let result = {};
  if (p.kind === 'memory') {
    const text = str(b.text || p.text, 300); if (!text) return { error: 'Write the fact first.', status: 400 };
    if (SECRET.test(text)) return { error: 'That looks like a password, key or card number. Memory never holds those.', status: 400 };
    const kind = KINDS.indexOf(b.mkind) >= 0 ? b.mkind : p.mkind;
    const item = await deps.addKnowledge(ctx, { text, kind, scope: 'shared', source: 'learned', origin: { chat: p.from && p.from.chat, task: p.from && p.from.task, quote: p.quote } });
    if (p.replaces && b.keepOld !== true && deps.supersede) { try { await deps.supersede(ctx, p.replaces.id, item.id); } catch (e) {} }
    result = { item, replaced: p.replaces && b.keepOld !== true ? p.replaces : null };
    p.text = text; p.mkind = kind; p.knowledge = item.id;
  } else {
    const doc = b.doc && typeof b.doc === 'object' ? Object.assign({}, p.doc, b.doc) : p.doc;
    const r = await deps.createSkill(ctx, { doc, name: doc.name, origin: p.from });
    if (r.error) return r;
    result = { skill: r.skill }; p.skill = r.skill.id;
  }
  p.status = 'kept'; p.decidedAt = Date.now();
  s.pending = s.pending.filter((x) => x.id !== p.id); s.decided.push(p);
  await save(ctx, s);
  if (deps.log) await deps.log(ctx, 'jarvis', p.kind === 'memory' ? 'Kept in memory: ' + str(p.text, 140) + (result.replaced ? ' (replaces: ' + str(result.replaced.text, 80) + ')' : '') : 'Kept as a skill: "' + str(p.doc.name, 80) + '" v1.');
  return Object.assign({ ok: true, idea: p }, result);
}
async function dismiss(ctx, deps, b) {
  const s = await state(ctx);
  const p = s.pending.find((x) => x.id === String(b.id || ''));
  if (!p) return { error: 'That idea is no longer waiting.', status: 404 };
  p.status = 'declined'; p.decidedAt = Date.now();
  s.pending = s.pending.filter((x) => x.id !== p.id); s.decided.push(p);
  await save(ctx, s);
  return { ok: true, idea: p };
}
async function settings(ctx, deps, b) {
  const s = await state(ctx);
  if (typeof b.on === 'boolean') s.on = b.on;
  if (b.every != null) s.every = Math.max(4, Math.min(40, +b.every || 10));
  await save(ctx, s);
  return { ok: true, on: s.on, every: s.every };
}
async function view(ctx) {
  const s = await state(ctx);
  return { ok: true, on: s.on, every: s.every, turns: s.turns, lastAt: s.lastAt, pending: s.pending.slice().reverse(), decided: s.decided.slice(-30).reverse(), reviews: s.reviews.slice(-8).reverse(), busy: false };
}

/* A short list for a chat ("/learn"), numbered for "/keep n" and "/skipidea n". */
function chatList(v, lang) {
  const tr = lang === 'tr';
  if (!v.pending.length) return tr ? 'Şu an saklamaya değer yeni bir şey yok.' : 'Nothing new worth keeping right now.';
  return (tr ? 'Saklamaya değer bulduklarım:' : 'Worth keeping, if you agree:') + '\n' + v.pending.slice(0, 8).map((p, i) => (i + 1) + '. ' + (p.kind === 'memory' ? (tr ? 'Hafıza: ' : 'Memory: ') + p.text + (p.replaces ? (tr ? ' (yerine: ' : ' (replaces: ') + str(p.replaces.text, 60) + ')' : '') : (tr ? 'Beceri: ' : 'Skill: ') + p.doc.name)).join('\n') + '\n' + (tr ? '/keep 1 ile sakla, /skipidea 1 ile geç.' : '/keep 1 to keep, /skipidea 1 to drop.');
}

async function handle(p, req, res, ctx, deps) {
  if (p !== '/api/team/learn') return false;
  const json = ctx.json;
  const out = (r) => { if (r && r.error) json(res, r.status || 400, r); else json(res, 200, r); return true; };
  if (req.method === 'GET') return out(await view(ctx));
  if (req.method !== 'POST') return out({ error: 'GET or POST.', status: 405 });
  let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  const op = String(b.op || '');
  if (op === 'review') { const r = await review(ctx, deps, ctx.user && ctx.user.id, 'asked'); return out(Object.assign(await view(ctx), { found: r.found, how: r.how, read: r.read, busy: !!r.busy })); }
  if (op === 'accept') return out(await accept(ctx, deps, b));
  if (op === 'dismiss') return out(await dismiss(ctx, deps, b));
  if (op === 'settings') return out(await settings(ctx, deps, b));
  return out({ error: 'review, accept, dismiss or settings.', status: 400 });
}

module.exports = { handle, review, note, accept, dismiss, settings, view, state, chatList, _internals: { scanTurns, scanTasks, scanRoutine, filter, material, SYSTEM, SECRET, SENSITIVE } };
