/* Business context: import it, see where every fact came from, answer with
 * the source named, prove it in a fresh chat — and discovery mode, where
 * J.A.R.V.I.S. interviews the person about a workflow and writes the spec.
 *
 * An import takes a pasted document, a web page or a note and turns it into
 * atomic knowledge entries (facts, rules, preferences), each carrying the
 * quote it came from and the source it belongs to. The source map lists
 * every source with its entries and which agents are shown them (shared
 * entries go into every prompt; nothing is indexed, nothing is cached — the
 * prompt is rebuilt from the store on every request, so a re-import or a
 * supersede takes effect on the next message). Answers name their sources:
 * after a reply is recorded, the entries whose words or numbers are in it
 * are attached as `sources`; the console and the channels show them.
 *
 * Discovery mode asks one question at a time — five for "ask me questions",
 * ten for "interview me relentlessly" — and ends in a workflow spec (goal,
 * trigger, inputs, steps, judgment, guardrails, people, cadence, pitfalls,
 * success) that can become a skill in one step. With a model the questions
 * follow the answers; without one the question bank below is used in order.
 *
 *   team:sources     [{ id, title, kind, origin, at, hash, chars, entries, text }]
 *   team:knowledge   entries from an import carry source 'import:<id>' and origin { id, title, quote }
 *   team:discovery   [{ id, topic, mode, status, qa[], spec, at, doneAt, skill }]
 *   team:requests    [{ id, kind, text, at, status, via }]
 */
const crypto = require('crypto');

const MAX_IMPORT_CHARS = 60000, MAX_ENTRIES = 60, MAX_SOURCES = 40, MAX_TEXT_KEPT = 24000;
const QUESTIONS = [
  'What should this workflow produce when it is done — what does the finished result look like, and who receives it?',
  'What starts it: a message from you, a time of day, an email arriving, something changing in your record?',
  'What information does it need each time, and where does that come from (a page, an inbox, your record, a person)?',
  'Which steps are the same every time, and where is judgment needed?',
  'What must never happen, and what needs your yes before it goes out?',
  'Who else is involved — customers, colleagues, suppliers — and what do they expect to receive?',
  'How often does this happen, and how long does it take you today?',
  'What has gone wrong when you did it by hand? What do you keep correcting?',
  'How will we know it worked — what do you check, and what would make you redo it?',
  'Anything else I should know before I write it up — tone, format, a deadline, an example of a good result?'
];
const QUESTIONS_TR = [
  'Bu iş akışı bittiğinde ne üretmeli — bitmiş sonuç neye benziyor ve kime gidiyor?',
  'Ne başlatıyor: senden bir mesaj mı, günün bir saati mi, gelen bir e-posta mı, kaydında değişen bir şey mi?',
  'Her seferinde hangi bilgiye ihtiyaç duyuyor ve bu nereden geliyor (bir sayfa, gelen kutusu, kaydın, bir kişi)?',
  'Hangi adımlar her seferinde aynı, nerede karar gerekiyor?',
  'Asla ne olmamalı, ve dışarı çıkmadan önce ne senin onayını gerektiriyor?',
  'Başka kim var işin içinde — müşteriler, çalışanlar, tedarikçiler — ve onlar ne almayı bekliyor?',
  'Bu ne sıklıkla oluyor ve bugün senin ne kadar zamanını alıyor?',
  'Elle yaparken ne ters gitti? Neyi sürekli düzeltiyorsun?',
  'İşe yaradığını nasıl anlarız — neyi kontrol ediyorsun, neyi görünce baştan yaparsın?',
  'Yazmadan önce bilmem gereken başka bir şey var mı — üslup, biçim, bir son tarih, iyi bir sonuç örneği?'
];
const SPEC_LABELS_TR = { goal: 'Amaç ve çıktı', trigger: 'Tetikleyici', inputs: 'Girdiler ve kaynakları', steps: 'Adımlar (rutin / karar)', guardrails: 'Asla yapma / onay gerekir', people: 'Kimler var', cadence: 'Ne sıklıkla, bugün ne kadar sürüyor', pitfalls: 'Elle yaparken ters gidenler', success: 'Başarıyı nasıl anlarız', notes: 'Notlar' };
const SPEC_FIELDS = ['goal', 'trigger', 'inputs', 'steps', 'guardrails', 'people', 'cadence', 'pitfalls', 'success', 'notes'];
const SPEC_LABELS = { goal: 'Goal and output', trigger: 'Trigger', inputs: 'Inputs and where they come from', steps: 'Steps (routine vs judgment)', guardrails: 'Never do / needs a yes', people: 'People involved', cadence: 'How often, how long today', pitfalls: 'What goes wrong by hand', success: 'How we know it worked', notes: 'Notes' };

/* Turkish or English, from the text itself: Turkish letters, or the words
   that only Turkish uses. The app's language is a hint, the text decides. */
function langOf(text, hint) { const t = String(text || ''); if (/[ğışçöüĞİŞÇÖÜ]/.test(t)) return 'tr'; if (/\b(ve|için|bir|ile|olarak|değil|gibi|kadar|her|bu|şu|çok|daha|ama|veya|mı|mi|mu|mü|ne|nasıl|neden|hangi|ayda|haftada|günde|yılda|dolar|lira|fiyat|müşteri|rapor|toplantı)\b/i.test(t) && !/\b(the|and|with|for|that|this)\b/i.test(t)) return 'tr'; return hint === 'tr' ? 'tr' : 'en'; }
function str(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 200); }
function block(s, n) { return String(s == null ? '' : s).replace(/\r/g, '').trim().slice(0, n || 4000); }
function newId() { return crypto.randomBytes(5).toString('hex'); }
function hash(t) { return crypto.createHash('sha1').update(String(t)).digest('hex').slice(0, 12); }
const RULE = /\b(always|never|must|should|do not|don't|only|every|no later|at least|at most|before|after|unless|required|forbidden|allowed|her zaman|asla|hiçbir zaman|mutlaka|kesinlikle|gerekir|gereklidir|zorunlu|yasak|sadece|yalnızca|en az|en geç|en fazla|önce|sonra|olmadan|şart|izin|onay)\b|(?:malı|meli|malıdır|melidir|mamalı|memeli)\b/i;
const PREF = /\b(prefer|like|dislike|hate|love|want|keep it|tone|style|formal|informal|short|brief|casual|tercih|sever|severim|sevmem|isterim|istemem|hoşlan|üslup|ton|resmi|samimi|kısa|öz|kibar)\b/i;
const SECRET = /\b(api[_ -]?key|secret|password|passwd|token|bearer|private key)\b|sk-[A-Za-z0-9]{10,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}/i;

/* ---------- import ------------------------------------------------------------ */
function sentencesOf(text) {
  return String(text || '').replace(/\r/g, '').split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9"“(])|\n(?=[-•*\d])/).map((s) => s.replace(/^[-•*]\s*|^\d+[.)]\s*/, '').replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 16 && s.length <= 320);
}
/* Deterministic extraction: keep the sentences that carry something an agent
   can use — a number, a name, a rule, a preference — and skip the rest. */
function extractPlain(text) {
  const out = []; const seen = new Set();
  for (const s of sentencesOf(text)) {
    if (SECRET.test(s)) continue;
    const hasNum = /\d/.test(s), hasName = /\b[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}\b/.test(s.replace(/^[A-ZÇĞİÖŞÜ][a-zçğıöşü]*/, '')), isRule = RULE.test(s), isPref = PREF.test(s);
    if (!(hasNum || hasName || isRule || isPref)) continue;
    const key = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); if (seen.has(key)) continue; seen.add(key);
    out.push({ fact: s.replace(/[.;:,]$/, ''), kind: isPref && !hasNum ? 'preference' : isRule ? 'rule' : 'fact', quote: s });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
async function extract(ctx, deps, text, title) {
  let items = null;
  if (deps.extract) { try { items = await deps.extract(ctx, text, title); } catch (e) { items = null; } }
  if (!Array.isArray(items) || !items.length) items = extractPlain(text);
  return items.map((it) => ({ fact: str(it.fact || it.text, 300), kind: ['fact', 'rule', 'preference', 'procedure'].indexOf(it.kind) >= 0 ? it.kind : 'fact', quote: str(it.quote || it.fact, 300) })).filter((it) => it.fact && !SECRET.test(it.fact)).slice(0, MAX_ENTRIES);
}

async function sources(ctx) { const v = await ctx.get('team:sources'); return Array.isArray(v) ? v : []; }
async function saveSources(ctx, list) { await ctx.set('team:sources', list.slice(-MAX_SOURCES)); }
async function knowledge(ctx) { const v = await ctx.get('team:knowledge'); return Array.isArray(v) ? v : []; }

async function importContext(ctx, deps, b) {
  const kind = /^(url|file|paste|note)$/.test(String(b.kind || '')) ? b.kind : (b.url ? 'url' : 'paste');
  let text = block(b.text, MAX_IMPORT_CHARS), origin = str(b.url || b.origin || '', 300);
  let title = str(b.title, 120);
  if (kind === 'url') {
    if (!/^https?:\/\//i.test(origin)) return { error: 'Give a web address that starts with http(s)://.', status: 400 };
    if (!deps.read) return { error: 'The web reader is not available here.', status: 503 };
    try { const pg = await deps.read(origin); text = block((pg && (pg.text || pg.content)) || '', MAX_IMPORT_CHARS); if (!title) title = str((pg && pg.title) || origin.replace(/^https?:\/\//, ''), 120); } catch (e) { return { error: 'Could not read that page: ' + (e && e.message), status: 502 }; }
  }
  if (!text || text.length < 20) return { error: 'There is nothing to import: paste the text (at least a few sentences) or give a page that has some.', status: 400 };
  if (!title) title = str(text.split('\n').find((l) => l.trim().length > 3) || 'Pasted context', 80);
  const h = hash(text);
  const list = await sources(ctx);
  const same = list.find((s) => s.hash === h);
  if (same && !b.again) return { error: 'This exact text was imported before as "' + same.title + '" (' + same.entries.length + ' entries). Import it again to refresh its entries.', status: 409, source: same };
  /* the same source again (same title, or the same page): a re-import, not a second source */
  const dup = same || list.find((s) => s.title.toLowerCase() === title.toLowerCase() || (kind === 'url' && s.kind === 'url' && s.origin === origin));
  const items = await extract(ctx, deps, text, title);
  if (!items.length) return { error: 'Nothing in that text reads as a fact, rule or preference an agent could use.', status: 422 };
  const src = dup || { id: 'src' + newId(), at: Date.now() };
  Object.assign(src, { title, kind, origin, hash: h, chars: text.length, text: text.slice(0, MAX_TEXT_KEPT), updated: Date.now(), by: str(b.via || 'app', 20) });
  const know = await knowledge(ctx); const now = Date.now();
  /* a re-import supersedes the earlier entries of this source that are not in the new set */
  const mine = know.filter((k) => k.source === 'import:' + src.id && k.status !== 'superseded');
  const newTexts = new Set(items.map((it) => it.fact.toLowerCase()));
  let superseded = 0, added = 0, kept = 0; const ids = [];
  for (const k of mine) { if (!newTexts.has(String(k.text).toLowerCase())) { k.status = 'superseded'; k.validTo = now; k.history = (k.history || []).concat([{ at: now, text: k.text, by: 'you', why: 're-imported "' + title + '"' }]); superseded++; } else { kept++; ids.push(k.id); } }
  for (const it of items) {
    if (mine.some((k) => String(k.text).toLowerCase() === it.fact.toLowerCase() && k.status !== 'superseded')) continue;
    if (know.some((k) => k.status !== 'superseded' && String(k.text).toLowerCase() === it.fact.toLowerCase())) { kept++; continue; }
    const k = { id: 'k' + newId(), text: it.fact, kind: it.kind, scope: 'shared', status: 'current', source: 'import:' + src.id, origin: { id: src.id, title, quote: it.quote }, at: now, updated: now, validFrom: now, history: [] };
    know.push(k); ids.push(k.id); added++;
  }
  src.entries = ids; src.counts = { added, kept, superseded };
  if (!dup) list.push(src);
  await ctx.set('team:knowledge', know.slice(-600)); await saveSources(ctx, list);
  if (deps.log) await deps.log(ctx, 'team', 'Context imported: "' + title + '" — ' + added + ' new entr' + (added === 1 ? 'y' : 'ies') + (superseded ? ', ' + superseded + ' superseded' : '') + (kept ? ', ' + kept + ' already known' : '') + '. Every agent sees them on its next message.');
  return { ok: true, source: Object.assign({}, src, { text: undefined }), added, kept, superseded, entries: know.filter((k) => ids.indexOf(k.id) >= 0) };
}

async function sourceMap(ctx, deps) {
  const [list, know, agents] = await Promise.all([sources(ctx), knowledge(ctx), deps.agents ? deps.agents(ctx) : []]);
  const active = agents.filter((a) => !a.archived);
  const prov = deps.provenance ? await deps.provenance(ctx) : [];
  const usedCount = {}; prov.forEach((p) => (p.used || []).forEach((id) => { usedCount[id] = (usedCount[id] || 0) + 1; }));
  const items = list.map((s) => {
    const ents = know.filter((k) => k.source === 'import:' + s.id);
    const cur = ents.filter((k) => k.status !== 'superseded');
    return { id: s.id, title: s.title, kind: s.kind, origin: s.origin, at: s.at, updated: s.updated, chars: s.chars, hasText: !!s.text, counts: { current: cur.length, superseded: ents.length - cur.length, usedInReplies: cur.reduce((n, k) => n + (usedCount[k.id] || 0), 0) }, readBy: cur.length ? active.map((a) => a.name) : [], entries: ents.map((k) => ({ id: k.id, text: k.text, kind: k.kind, status: k.status, quote: k.origin && k.origin.quote, used: usedCount[k.id] || 0 })) };
  }).sort((a, b) => (b.updated || b.at) - (a.updated || a.at));
  const other = { you: know.filter((k) => k.source === 'you' && k.status !== 'superseded').length, agents: know.filter((k) => /^agent:/.test(k.source || '') && k.status !== 'superseded').length, corrections: know.filter((k) => /^correction/.test(k.source || '') && k.status !== 'superseded').length };
  return { ok: true, sources: items, other, total: know.filter((k) => k.status !== 'superseded').length };
}

async function sourceAct(ctx, deps, b) {
  const list = await sources(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such source.', status: 404 };
  const know = await knowledge(ctx); const now = Date.now();
  if (b.op === 'supersede') { let n = 0; for (const k of know) if (k.source === 'import:' + s.id && k.status !== 'superseded') { k.status = 'superseded'; k.validTo = now; k.history = (k.history || []).concat([{ at: now, text: k.text, by: 'you', why: 'source "' + s.title + '" marked outdated' }]); n++; } await ctx.set('team:knowledge', know); if (deps.log) await deps.log(ctx, 'team', 'Source "' + s.title + '": ' + n + ' entries marked superseded (kept as history).'); return { ok: true, superseded: n }; }
  if (b.op === 'restore') { let n = 0; for (const k of know) if (k.source === 'import:' + s.id && k.status === 'superseded') { k.status = 'current'; delete k.validTo; k.history = (k.history || []).concat([{ at: now, text: k.text, by: 'you', why: 'source "' + s.title + '" restored' }]); n++; } await ctx.set('team:knowledge', know); return { ok: true, restored: n }; }
  if (b.op === 'remove') { const rest = know.filter((k) => k.source !== 'import:' + s.id); await ctx.set('team:knowledge', rest); await saveSources(ctx, list.filter((x) => x.id !== s.id)); if (deps.log) await deps.log(ctx, 'team', 'Source "' + s.title + '" removed with its ' + (know.length - rest.length) + ' entries.'); return { ok: true, removed: know.length - rest.length }; }
  if (b.op === 'reimport') { if (!s.text && s.kind !== 'url') return { error: 'The text of this source was not kept; paste it again.', status: 409 }; return await importContext(ctx, deps, { text: s.text, url: s.kind === 'url' ? s.origin : '', kind: s.kind, title: s.title, again: true }); }
  return { error: 'supersede, restore, remove or reimport.', status: 400 };
}

/* ---------- answers that name their sources ---------------------------------------- */
function sourcesFor(know, usedIds) {
  const by = {};
  for (const id of usedIds || []) { const k = know.find((x) => x.id === id); if (!k) continue; const key = k.origin && k.origin.id ? k.origin.id : (k.source || 'knowledge'); const o = by[key] = by[key] || { id: key, title: k.origin && k.origin.title ? k.origin.title : (k.source === 'you' ? 'what you told the team' : /^agent:/.test(k.source || '') ? 'what ' + k.source.slice(6) + ' remembered' : /^correction/.test(k.source || '') ? 'a correction you made' : 'team knowledge'), kind: k.origin && k.origin.id ? 'import' : 'knowledge', entries: [] }; o.entries.push({ id: k.id, text: str(k.text, 160), quote: k.origin && k.origin.quote ? str(k.origin.quote, 200) : '' }); }
  return Object.values(by);
}
function footer(sources, lang) {
  const imp = (sources || []).filter((s) => s.kind === 'import');
  if (!imp.length) return '';
  return '\n\n— ' + (lang === 'tr' ? 'Kaynak' : 'From') + ': ' + imp.map((s) => s.title).join(' · ');
}

/* ---------- fresh-chat verification ------------------------------------------------- */
async function verify(ctx, deps, b) {
  const q = str(b.question, 400); if (!q) return { error: 'Ask a question.', status: 400 };
  if (!deps.ask) return { error: 'No agent can be asked here.', status: 503 };
  const agents = deps.agents ? (await deps.agents(ctx)).filter((a) => !a.archived && a.id !== 'jarvis') : [];
  const who = agents.find((a) => a.id === str(b.agent, 40)) || agents[0]; if (!who) return { error: 'There is no specialist to ask.', status: 400 };
  const expect = str(b.expect, 300);
  const r = await deps.ask(ctx, who.id, q);
  if (!r || r.error) return { error: (r && r.error) || 'No answer.', status: (r && r.status) || 502 };
  const know = await knowledge(ctx);
  const used = Array.isArray(r.used) ? r.used : [];
  const src = sourcesFor(know, used);
  const want = expect ? deps.terms(expect) : { words: [], nums: [] }; const got = deps.terms(r.say || '');
  const hitW = want.words.filter((w) => got.words.indexOf(w) >= 0), hitN = want.nums.filter((n) => got.nums.some((m) => m.replace(/\D/g, '') === n.replace(/\D/g, '')));
  const total = want.words.length + want.nums.length, hits = hitW.length + hitN.length;
  const pass = total ? hits >= Math.ceil(total * 0.5) : null;
  const rec = { at: Date.now(), agent: who.id, agentName: who.name, model: r.model || '', question: q, answer: str(r.say, 1200), expect, hits: { words: hitW, nums: hitN, of: total }, pass, sources: src, fresh: true };
  const S = (await ctx.get('team:ctxverify')) || []; S.push(rec); await ctx.set('team:ctxverify', S.slice(-20));
  if (deps.log) await deps.log(ctx, 'team', 'Fresh-chat check (' + who.name + '): "' + str(q, 60) + '" → ' + (pass === null ? 'answered' : pass ? 'as expected' : 'NOT as expected') + (src.length ? ' · from ' + src.map((s) => s.title).join(', ') : ' · no imported source matched'));
  return Object.assign({ ok: true }, rec);
}

/* ---------- requests and feedback ------------------------------------------------------ */
async function requests(ctx) { const v = await ctx.get('team:requests'); return Array.isArray(v) ? v : []; }
async function addRequest(ctx, deps, b) {
  const text = str(b.text, 600); if (!text) return { error: 'Say what you want.', status: 400 };
  const kind = b.kind === 'feedback' ? 'feedback' : 'request';
  const list = await requests(ctx); const it = { id: 'rq' + newId(), kind, text, at: Date.now(), status: 'open', via: str(b.via || 'app', 20) }; list.push(it); await ctx.set('team:requests', list.slice(-100));
  if (deps.log) await deps.log(ctx, 'team', (kind === 'feedback' ? 'Feedback' : 'Request') + ' noted: ' + str(text, 120));
  return { ok: true, item: it };
}
async function requestAct(ctx, deps, b) { const list = await requests(ctx); const it = list.find((x) => x.id === String(b.id || '')); if (!it) return { error: 'No such item.', status: 404 }; if (b.op === 'done' || b.op === 'reopen') it.status = b.op === 'done' ? 'done' : 'open'; else if (b.op === 'remove') { await ctx.set('team:requests', list.filter((x) => x.id !== it.id)); return { ok: true }; } await ctx.set('team:requests', list); return { ok: true, item: it }; }

/* ---------- discovery mode ---------------------------------------------------------------- */
async function discoveries(ctx) { const v = await ctx.get('team:discovery'); return Array.isArray(v) ? v : []; }
async function saveDiscoveries(ctx, list) { await ctx.set('team:discovery', list.slice(-20)); }
function limitOf(mode) { return mode === 'relentless' ? QUESTIONS.length : 5; }
async function nextQuestion(ctx, deps, d) {
  const n = d.qa.length;
  if (deps.question && n > 0) { try { const q = await deps.question(ctx, d); if (q && str(q, 300)) return str(q, 300); } catch (e) {} }
  const bank = d.lang === 'tr' ? QUESTIONS_TR : QUESTIONS;
  return bank[n] || bank[bank.length - 1];
}
function specFrom(d) {
  const spec = {}; SPEC_FIELDS.forEach((f, i) => { const a = d.qa[i]; spec[f] = a && a.a ? str(a.a, 600) : ''; });
  if (!spec.goal && d.topic) spec.goal = d.topic;
  return spec;
}
function specText(d) {
  const sp = d.spec || specFrom(d);
  const L = d.lang === 'tr' ? SPEC_LABELS_TR : SPEC_LABELS;
  const lines = [(d.lang === 'tr' ? 'İş akışı: ' : 'Workflow: ') + (d.topic || (d.lang === 'tr' ? 'adsız' : 'untitled'))];
  for (const f of SPEC_FIELDS) if (sp[f]) lines.push('', L[f] + ':', sp[f]);
  return lines.join('\n');
}
async function discover(ctx, deps, b) {
  const list = await discoveries(ctx); const op = String(b.op || '');
  const active = list.find((d) => d.status === 'active');
  if (op === 'start') {
    if (active) { active.status = 'abandoned'; }
    const mode = b.mode === 'relentless' ? 'relentless' : 'ask';
    const d = { id: 'dc' + newId(), topic: str(b.topic, 160), mode, lang: langOf(b.topic, b.lang), status: 'active', qa: [], at: Date.now(), via: str(b.via || 'app', 20) };
    const q = await nextQuestion(ctx, deps, d); d.qa.push({ q, a: '', at: Date.now() });
    list.push(d); await saveDiscoveries(ctx, list);
    if (deps.log) await deps.log(ctx, 'jarvis', 'Discovery started (' + (mode === 'relentless' ? 'interview' : '5 questions') + ')' + (d.topic ? ': ' + d.topic : '') + '.');
    const intro = d.lang === 'tr' ? (mode === 'relentless' ? 'Peki. Resmin tamamını görene kadar soracağım — yazmamı istediğinde "bitti" de. İlk soru: ' : 'Beş soru, sonra yazıya dökerim. İlk soru: ') : (mode === 'relentless' ? 'Right. I will keep asking until I have the whole picture — say "done" whenever you want me to write it up. First: ' : 'Five questions, then I write it up. First: ');
    return { ok: true, discovery: d, say: intro + q, question: q, n: 1, of: limitOf(mode) };
  }
  if (op === 'status') return { ok: true, discovery: active || list.slice(-1)[0] || null, list: list.slice(-6).reverse().map((d) => ({ id: d.id, topic: d.topic, mode: d.mode, status: d.status, n: d.qa.filter((x) => x.a).length, at: d.at, skill: d.skill || null })) };
  const d = list.find((x) => x.id === String(b.id || '')) || active;
  if (!d) return { error: 'No discovery is running. Say "Ask me questions" or "Interview me relentlessly".', status: 404 };
  if (op === 'answer') {
    if (d.status !== 'active') return { error: 'That discovery is finished.', status: 409 };
    const text = str(b.text, 1500); if (!text) return { error: 'Say your answer.', status: 400 };
    const open = d.qa[d.qa.length - 1]; if (open && !open.a) open.a = text; else d.qa.push({ q: '', a: text, at: Date.now() });
    if (d.qa.filter((x) => x.a).length === 1 && d.lang !== 'tr' && langOf(text) === 'tr') d.lang = 'tr';
    const answered = d.qa.filter((x) => x.a).length;
    const stopWord = /^\s*(done|enough|that'?s (all|it|enough)|finish|write it up|yeter|yeterli|bitti|bu kadar|yaz(ıya dök)?|tamam(dır)?)\b/i.test(text);
    const stop = stopWord || answered >= limitOf(d.mode);
    if (stop) { if (stopWord) { open.a = ''; d.qa.pop(); } return await finishDiscovery(ctx, deps, d, list); }
    const q = await nextQuestion(ctx, deps, d); d.qa.push({ q, a: '', at: Date.now() }); await saveDiscoveries(ctx, list);
    return { ok: true, discovery: d, say: q, question: q, n: d.qa.length, of: limitOf(d.mode) };
  }
  if (op === 'finish') return await finishDiscovery(ctx, deps, d, list);
  if (op === 'abandon') { d.status = 'abandoned'; await saveDiscoveries(ctx, list); return { ok: true, discovery: d, say: 'Dropped. Nothing was written up.' }; }
  if (op === 'skill') {
    if (!d.spec) return { error: 'Finish the discovery first.', status: 409 };
    if (!deps.skillFromText) return { error: 'Skills are not reachable.', status: 503 };
    const r = await deps.skillFromText(ctx, (d.topic || 'Workflow') + '\n' + specText(d));
    if (r && r.error) return r;
    d.skill = r.skill.id; await saveDiscoveries(ctx, list);
    return { ok: true, skill: r.skill, discovery: d, say: d.lang === 'tr' ? '"' + r.skill.name + '" artık bir beceri, sürüm 1. Biri uygulamadan önce Beceriler\'de gözden geçir.' : '"' + r.skill.name + '" is a skill now, version 1. Review it in Skills before anyone follows it.' };
  }
  return { error: 'start, answer, finish, abandon, skill or status.', status: 400 };
}
async function finishDiscovery(ctx, deps, d, list) {
  if (!d.qa.filter((x) => x.a).length) { d.status = 'abandoned'; await saveDiscoveries(ctx, list); return { ok: true, discovery: d, say: 'Nothing answered yet, so nothing to write up.', done: true }; }
  let spec = specFrom(d);
  if (deps.spec) { try { const s2 = await deps.spec(ctx, d, spec); if (s2 && typeof s2 === 'object') spec = Object.assign(spec, Object.keys(s2).reduce((o, k) => { if (SPEC_FIELDS.indexOf(k) >= 0 && s2[k]) o[k] = str(s2[k], 600); return o; }, {})); } catch (e) {} }
  d.spec = spec; d.status = 'done'; d.doneAt = Date.now(); if (!d.topic && spec.goal) d.topic = str(spec.goal, 80);
  await saveDiscoveries(ctx, list);
  if (deps.log) await deps.log(ctx, 'jarvis', 'Discovery written up: ' + (d.topic || 'workflow') + ' (' + d.qa.filter((x) => x.a).length + ' answers).');
  const tail = d.lang === 'tr' ? 'İş akışını anladığım hâliyle yazdım:\n\n' + specText(d) + '\n\n"Beceriye dönüştür" de; ekip bir sonraki istekten itibaren buna göre çalışır.' : 'Here is the workflow as I understand it:\n\n' + specText(d) + '\n\nSay "turn it into a skill" and the team follows it from the next request on.';
  return { ok: true, discovery: d, done: true, spec, text: specText(d), say: tail };
}

/* ---------- the view and the routes ----------------------------------------------------------- */
async function view(ctx, deps) {
  const [map, rq, dl, vf] = await Promise.all([sourceMap(ctx, deps), requests(ctx), discoveries(ctx), ctx.get('team:ctxverify')]);
  const active = dl.find((d) => d.status === 'active') || null;
  return Object.assign(map, { requests: rq.slice().reverse().slice(0, 30), discovery: { active, recent: dl.filter((d) => d.status !== 'active').slice(-5).reverse() }, verifications: (Array.isArray(vf) ? vf : []).slice(-5).reverse(), questions: QUESTIONS.length });
}
async function handle(p, req, res, ctx, deps) {
  if (p.indexOf('/api/team/context') !== 0 && p.indexOf('/api/team/discovery') !== 0) return false;
  const json = ctx.json;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };
  const out = (r) => { if (r && r.error) json(res, r.status || 400, r); else json(res, 200, r); return true; };
  if (p === '/api/team/context' && req.method === 'GET') return out(await view(ctx, deps));
  if (p === '/api/team/context/import' && req.method === 'POST') return out(await importContext(ctx, deps, await body()));
  if (p === '/api/team/context/source' && req.method === 'POST') return out(await sourceAct(ctx, deps, await body()));
  if (p === '/api/team/context/verify' && req.method === 'POST') return out(await verify(ctx, deps, await body()));
  if (p === '/api/team/context/request' && req.method === 'POST') { const b = await body(); return out(b.op ? await requestAct(ctx, deps, b) : await addRequest(ctx, deps, b)); }
  if (p === '/api/team/discovery' && req.method === 'GET') return out(await discover(ctx, deps, { op: 'status' }));
  if (p === '/api/team/discovery' && req.method === 'POST') return out(await discover(ctx, deps, await body()));
  return false;
}

module.exports = { handle, importContext, sourceMap, sourceAct, sourcesFor, footer, verify, addRequest, discover, view, extractPlain, specText, langOf, QUESTIONS, QUESTIONS_TR, SPEC_FIELDS, SPEC_LABELS, SPEC_LABELS_TR, _internals: { sentencesOf } };
