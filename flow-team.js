/* =========================================================================
 * flow-team.js — the team: J.A.R.V.I.S. and the agents he manages
 *
 * What this is
 * ------------
 * One account's AI employees. Each agent is a record — a name, a role, its
 * instructions, which model it thinks with, what it is allowed to do — and
 * nothing about it lives inside a model. The model is a dial: switching it
 * changes who answers the next message and not one thing else, because the
 * identity, the thread, the shared knowledge and the agent's own memory are
 * all in the store, under the account, and are handed to whichever model is
 * chosen on every request.
 *
 * The starters — Bobby (advertising), Sarah (support), Tom (development), a
 * hiring assistant and a finance assistant — are templates that become real
 * agents the first time the team is read. They are editable; J.A.R.V.I.S.
 * is the one that cannot be removed, because he is the one the rest report
 * to. (His own conversation keeps going through /api/flow/do, which knows
 * The Flow's actions; what this file adds to him is the shared knowledge and
 * the choice of model.)
 *
 * Models and providers
 * --------------------
 * A provider is configured when its key is in the environment — Artur types
 * keys into Render himself; nothing here ever shows one. The list of models
 * is asked of the provider (its /models endpoint) and cached for an hour, so
 * the selector shows what the key can actually use, not a wish list. With
 * no key a provider is listed as "awaiting configuration" and nothing can
 * be sent to it.
 *
 * Honesty
 * -------
 * No agent here has tools yet. The system prompt says so, in words, and
 * tells the agent to say what it would do rather than claim it did. That is
 * the whole of stage one: a team that can be talked to, remembers, and can
 * be re-wired to any model — not one that pretends to have sent an email.
 *
 * Storage (all inside the account's namespace, via ctx.get/ctx.set)
 * ------------------------------------------------------------------
 *   team:agents            [{ id, name, role, avatar, instructions, manner,
 *                             provider, model, permissions, dailyCap,
 *                             builtin, archived, createdAt, updatedAt }]
 *   team:thread:<agent>    [{ role: 'user'|'assistant', text, at }]   (last 160)
 *   team:knowledge         [{ id, text, scope: 'shared'|'agent:<id>', source, at, updated }]
 *   team:usage:<day>       { <agent>: { calls, in, out } }
 *   team:log               [{ at, agent, what }]   (last 300)
 *   team:paused            true | false
 * ====================================================================== */
'use strict';

const crypto = require('crypto');

/* ---------- providers --------------------------------------------------- */
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic', env: 'ANTHROPIC_API_KEY', kind: 'anthropic',
    base: 'https://api.anthropic.com/v1',
    fallback: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    keep: (id) => /^claude-/.test(id)
  },
  openai: {
    name: 'OpenAI', env: 'OPENAI_API_KEY', kind: 'openai',
    base: 'https://api.openai.com/v1',
    fallback: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'],
    keep: (id) => /^(gpt-|o[1-9])/.test(id) && !/(audio|realtime|tts|transcri|image|embed|moderation|search|instruct|dall|preview-20|codex|vision)/.test(id)
  },
  xai: {
    name: 'xAI', env: 'XAI_API_KEY', kind: 'openai',
    base: 'https://api.x.ai/v1',
    fallback: ['grok-4', 'grok-3', 'grok-3-mini'],
    keep: (id) => /^grok/.test(id) && !/(image|vision|video)/.test(id)
  },
  deepseek: {
    name: 'DeepSeek', env: 'DEEPSEEK_API_KEY', kind: 'openai',
    base: 'https://api.deepseek.com',
    fallback: ['deepseek-chat', 'deepseek-reasoner'],
    keep: (id) => /^deepseek/.test(id)
  }
};
const PROVIDER_ORDER = ['anthropic', 'openai', 'xai', 'deepseek'];
const DEFAULT_MODEL = process.env.FLOW_CHAT_MODEL || 'claude-sonnet-4-5';
/* Tests only: FLOW_TEAM_FAKE=1 pretends Anthropic and OpenAI have keys and
   answers every call itself, so the thread, the memory and the switching
   can be proven without a provider. Never set on the real server. */
const FAKE = process.env.FLOW_TEAM_FAKE === '1';
const keyOf = (pid) => FAKE ? ((pid === 'anthropic' || pid === 'openai') ? 'test' : '') : String(process.env[(PROVIDERS[pid] || {}).env || ''] || '').trim();

/* The model lists, asked of each configured provider and kept an hour. */
const modelCache = {};   /* pid → { at, models } */
const LIST_TTL = 60 * 60 * 1000;

function fetchJSON(url, opts, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs || 20000);
  return fetch(url, Object.assign({}, opts, { signal: ac.signal }))
    .then(async (r) => { let body = null; try { body = await r.json(); } catch (e) {} return { status: r.status, body }; })
    .finally(() => clearTimeout(t));
}

async function listModels(pid) {
  const P = PROVIDERS[pid]; const key = keyOf(pid);
  if (!P || !key) return [];
  const c = modelCache[pid];
  if (c && Date.now() - c.at < LIST_TTL) return c.models;
  if (FAKE) { modelCache[pid] = { at: Date.now(), models: P.fallback.slice() }; return P.fallback.slice(); }
  let models = [];
  try {
    const headers = P.kind === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: 'Bearer ' + key };
    const r = await fetchJSON(P.base + '/models', { headers }, 12000);
    const rows = r.body && Array.isArray(r.body.data) ? r.body.data : [];
    models = rows.map((m) => String((m && m.id) || '')).filter((id) => id && P.keep(id));
    /* newest first, as the providers list them; dedupe */
    models = models.filter((id, i) => models.indexOf(id) === i).slice(0, 40);
  } catch (e) { models = []; }
  if (!models.length) models = P.fallback.slice();
  modelCache[pid] = { at: Date.now(), models };
  return models;
}
module.exports._testListModels = (pid, models) => { modelCache[pid] = { at: Date.now(), models }; };

async function providers() {
  const out = [];
  for (const pid of PROVIDER_ORDER) {
    const P = PROVIDERS[pid], configured = !!keyOf(pid);
    out.push({ id: pid, name: P.name, configured, env: P.env, models: configured ? await listModels(pid) : [] });
  }
  return out;
}

/* Which provider a model id belongs to, if it is one that can be used. */
async function resolveModel(model) {
  const id = String(model || '').trim();
  if (!id) return null;
  for (const pid of PROVIDER_ORDER) {
    if (!keyOf(pid)) continue;
    const list = await listModels(pid);
    if (list.indexOf(id) >= 0) return { provider: pid, model: id };
  }
  /* A model the provider did not list but whose name says who it is for
     (a brand-new release, or a dated alias): let the provider decide. */
  if (/^claude-/.test(id) && keyOf('anthropic')) return { provider: 'anthropic', model: id };
  if (/^(gpt-|o[1-9])/.test(id) && keyOf('openai')) return { provider: 'openai', model: id };
  if (/^grok/.test(id) && keyOf('xai')) return { provider: 'xai', model: id };
  if (/^deepseek/.test(id) && keyOf('deepseek')) return { provider: 'deepseek', model: id };
  return null;
}

/* One call, any provider: a system text, a list of {role, content} turns,
   back comes { text, usage: {in, out} } or { error, status }. */
let post = FAKE ? fakePost : fetchJSON;
function fakePost(url, opts) {
  const b = JSON.parse(opts.body || '{}');
  const msgs = Array.isArray(b.messages) ? b.messages : [];
  const system = typeof b.system === 'string' ? b.system : String((msgs[0] && msgs[0].role === 'system' && msgs[0].content) || '');
  const last = msgs.filter((m) => m.role === 'user').pop();
  const said = String((last && last.content) || '').split('\n\n').pop();
  let text;
  if (/YOU HAVE BEEN GIVEN A PIECE OF WORK/.test(system)) {
    /* a step: the brief decides what the stand-in does */
    const brief = (system.match(/Brief: ([^\n]*)/) || [])[1] || '';
    const who = (system.match(/^You are ([^,]+),/m) || [])[1] || 'Agent';
    const out = { result: who + ' did: ' + brief, question: '', proposals: [], remember: [] };
    if (/ask me/i.test(brief) && !/answered your question/.test(String((last && last.content) || ''))) { out.question = 'Which address should it go to?'; out.result = ''; }
    if (/long one/i.test(brief)) { const slow = { status: 200, body: { content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 1, output_tokens: 1 } } }; return new Promise((r) => setTimeout(() => r(slow), 4000)); }
    if (/email/i.test(brief)) out.proposals.push({ kind: 'email', summary: 'Email to the customer', to: 'customer@example.com', subject: 'About your refund', body: 'Dear customer, ' + brief });
    if (/\bfail\b/i.test(brief)) return Promise.resolve({ status: 500, body: { error: { message: 'stand-in failure' } } });
    text = JSON.stringify(out);
  } else if (/chief of staff[\s\S]*Plan it\./.test(system)) {
    const steps = [];
    if (/sarah/i.test(said)) steps.push({ agent: 'sarah', title: 'Draft the reply', brief: 'Draft an email reply: ' + said });
    if (/bobby/i.test(said)) steps.push({ agent: 'bobby', title: 'Check the ads', brief: 'Check this week\'s ad spend: ' + said });
    if (/tom/i.test(said)) steps.push({ agent: 'tom', title: 'Look at the bug', brief: said });
    text = JSON.stringify({ title: 'Team: ' + said.slice(0, 40), say: steps.length ? 'Putting ' + steps.map((x) => x.agent).join(' and ') + ' on it, sir.' : 'That needs none of the team.', steps });
  } else if (/answering a text message from them/.test(system)) {
    /* J.A.R.V.I.S. over a channel */
    const actions = [];
    if (/have \w+ draft|ask \w+ to|get the team to/i.test(said)) actions.push({ type: 'delegate', title: 'From a message', brief: said, callMe: /call me/i.test(said) });
    if (/^\s*(yes|approve)\b/i.test(said)) actions.push({ type: 'approve', n: 1 });
    text = JSON.stringify({ say: b.model + ' says: ' + said, actions });
  } else if (/hand it over/.test(system)) {
    text = 'Summary by ' + b.model + ':\n' + String((last && last.content) || '');
  } else {
    const rem = []; const m = said.match(/remember that (.+?)(?:\.|$)/i);
    if (m) rem.push({ scope: /\bteam\b|\bbusiness\b/i.test(said) ? 'shared' : 'mine', fact: m[1] });
    text = JSON.stringify({ say: b.model + ' says: ' + said, remember: rem });
  }
  if (/anthropic/.test(url)) return Promise.resolve({ status: 200, body: { content: [{ type: 'text', text }], usage: { input_tokens: 12, output_tokens: 6 } } });
  return Promise.resolve({ status: 200, body: { choices: [{ message: { content: text } }], usage: { prompt_tokens: 12, completion_tokens: 6 } } });
}
async function complete(opts) {
  const which = await resolveModel(opts.model);
  if (!which) return { error: 'That model is not available here.', status: 0 };
  const P = PROVIDERS[which.provider], key = keyOf(which.provider);
  const maxTokens = Math.max(200, Math.min(4000, opts.maxTokens || 1200));
  try {
    if (P.kind === 'anthropic') {
      const r = await post(P.base + '/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: which.model, max_tokens: maxTokens, system: opts.system, messages: opts.messages })
      }, opts.timeoutMs || 60000);
      if (r.status < 200 || r.status >= 300) return { error: upstreamError(r), status: r.status };
      const parts = (r.body && Array.isArray(r.body.content)) ? r.body.content : [];
      const u = (r.body && r.body.usage) || {};
      return { text: parts.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n'), usage: { in: u.input_tokens || 0, out: u.output_tokens || 0 }, provider: which.provider, model: which.model };
    }
    const msgs = [{ role: 'system', content: opts.system }].concat(opts.messages.map((m) => ({ role: m.role, content: m.content })));
    const payload = { model: which.model, messages: msgs };
    /* the newest OpenAI models refuse max_tokens; the others refuse the new name */
    if (which.provider === 'openai' && /^(gpt-5|o[1-9])/.test(which.model)) payload.max_completion_tokens = maxTokens; else payload.max_tokens = maxTokens;
    const r = await post(P.base + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(payload)
    }, opts.timeoutMs || 60000);
    if (r.status < 200 || r.status >= 300) return { error: upstreamError(r), status: r.status };
    const ch = r.body && Array.isArray(r.body.choices) ? r.body.choices[0] : null;
    const text = ch && ch.message ? String(ch.message.content || '') : '';
    const u = (r.body && r.body.usage) || {};
    return { text, usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 }, provider: which.provider, model: which.model };
  } catch (e) {
    return { error: e && e.name === 'AbortError' ? 'That took too long.' : 'The model could not be reached.', status: 0 };
  }
}
function upstreamError(r) {
  if (r.status === 401 || r.status === 403) return 'The key for this provider was refused.';
  if (r.status === 429) return 'This provider is rate-limiting the key. Try again in a minute.';
  if (r.status === 404) return 'This provider does not know that model.';
  const m = r.body && r.body.error && (r.body.error.message || r.body.error);
  return 'The model could not answer (upstream ' + r.status + (m ? ': ' + String(m).slice(0, 140) : '') + ').';
}

/* ---------- the starters -------------------------------------------------- */
const MANNERS = {
  butler: 'Composed, precise, courteous, quietly confident; a dry, understated wit used sparingly. No filler, no "Great question", no exclamation marks.',
  plain: 'Friendly, plain and brief. Clear sentences, no jargon.',
  loose: 'Casual, quick, funny, on their side — like a sharp friend. Swearing is allowed when it fits; never at them, never slurs, never about anyone\'s identity. When the news is bad, drop the jokes and be straight.'
};
const TEMPLATES = {
  jarvis: { name: 'J.A.R.V.I.S.', role: 'Chief of staff', avatar: 'J', manner: 'butler',
    instructions: 'You run the team. Take requests, keep the week and the record straight, delegate to the right specialist, review their work before it reaches me, and tell me plainly what is done, what is waiting and what needs my yes.' },
  bobby: { name: 'Bobby', role: 'Advertising', avatar: 'B', manner: 'plain',
    instructions: 'You look after advertising: campaign performance, spend against return, what to scale and what to cut. Numbers first, then the recommendation. Never change a budget without approval.' },
  sarah: { name: 'Sarah', role: 'Customer support', avatar: 'S', manner: 'plain',
    instructions: 'You look after customers: answer questions from approved knowledge and policy, draft replies in a warm, clear voice, and escalate anything you are unsure of or that touches money, refunds or complaints.' },
  tom: { name: 'Tom', role: 'Development', avatar: 'T', manner: 'plain',
    instructions: 'You look after the software: investigate bugs, explain what is wrong and why, propose a fix with the smallest safe change, and say what should be tested. Nothing ships to production without approval.' },
  hiring: { name: 'Hiring assistant', role: 'Hiring', avatar: 'H', manner: 'plain',
    instructions: 'You look after hiring: organise candidates against the criteria I give you, prepare short, fair summaries, draft interview questions, and keep a schedule. Never contact a candidate without approval.' },
  finance: { name: 'Finance assistant', role: 'Finance', avatar: 'F', manner: 'plain',
    instructions: 'You look after the money side: organise invoices, prepare bookkeeping, flag what is overdue, and draft reports. Exact with figures; say when a number is an estimate. No payment is ever made by you.' },
  /* for Add agent */
  general: { name: 'Assistant', role: 'General assistant', avatar: 'A', manner: 'plain', instructions: 'You help with whatever is asked, clearly and briefly, and say when something needs a tool you do not have.' },
  marketing: { name: 'Marketing', role: 'Marketing', avatar: 'M', manner: 'plain', instructions: 'You look after marketing: content, campaigns, the calendar and the brand voice. Draft; the person approves.' },
  sales: { name: 'Sales', role: 'Sales', avatar: 'S', manner: 'plain', instructions: 'You look after the pipeline: leads, follow-ups, proposals and what is stuck. Draft outreach; the person sends.' },
  research: { name: 'Research', role: 'Research', avatar: 'R', manner: 'plain', instructions: 'You research: competitors, suppliers, markets, options. Separate what you know from what you assume, and cite where a fact came from.' },
  ops: { name: 'Operations', role: 'Operations', avatar: 'O', manner: 'plain', instructions: 'You keep operations running: processes, suppliers, logistics, checklists and what is late.' }
};
const STARTER_IDS = ['jarvis', 'bobby', 'sarah', 'tom', 'hiring', 'finance'];
const TEMPLATE_IDS = ['general', 'bobby', 'sarah', 'tom', 'hiring', 'finance', 'marketing', 'sales', 'research', 'ops'];
const PERMISSIONS = ['read', 'draft', 'approve', 'auto'];

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');

function fromTemplate(tid, id) {
  const T = TEMPLATES[tid] || TEMPLATES.general;
  const now = Date.now();
  return { id, name: T.name, role: T.role, avatar: T.avatar, instructions: T.instructions, manner: T.manner,
    provider: 'anthropic', model: DEFAULT_MODEL, permissions: 'draft', dailyCap: 200, template: tid,
    builtin: STARTER_IDS.indexOf(tid) >= 0 && tid === id, archived: false, tools: [], channels: [], createdAt: now, updatedAt: now };
}

/* ---------- the store, per account --------------------------------------- */
async function agents(ctx) {
  let list = await ctx.get('team:agents');
  if (!Array.isArray(list) || !list.length) {
    list = STARTER_IDS.map((id) => fromTemplate(id, id));
    await ctx.set('team:agents', list);
    await log(ctx, 'jarvis', 'The team was set up: ' + list.map((a) => a.name).join(', ') + '.');
  }
  return list;
}
async function saveAgents(ctx, list) { await ctx.set('team:agents', list); }

async function knowledge(ctx) { const v = await ctx.get('team:knowledge'); return Array.isArray(v) ? v : []; }
async function thread(ctx, id) { const v = await ctx.get('team:thread:' + id); return Array.isArray(v) ? v : []; }
async function log(ctx, agent, what) {
  const v = await ctx.get('team:log'); const list = Array.isArray(v) ? v : [];
  list.push({ at: Date.now(), agent: str(agent, 40), what: str(what, 300) });
  await ctx.set('team:log', list.slice(-300));
}
const dayKey = () => 'team:usage:' + new Date().toISOString().slice(0, 10);
async function usage(ctx) { const v = await ctx.get(dayKey()); return v && typeof v === 'object' ? v : {}; }

/* ---------- what an agent is told ---------------------------------------- */
function agentSystem(agent, owner, shared, mine, lang, teamNames) {
  const manner = MANNERS[agent.manner] || MANNERS.plain;
  const who = str(owner, 60) || 'the person you work for';
  return [
    'You are ' + agent.name + ', the ' + agent.role.toLowerCase() + ' on ' + who + '\'s team inside The Flow. The team is run by J.A.R.V.I.S., the chief of staff' + (teamNames.length ? '; the others are ' + teamNames.join(', ') : '') + '. You answer to ' + who + ' directly in this conversation.',
    'You are an AI employee. You have no backstory, maker or film behind you; do not claim to be a character.',
    '',
    'YOUR INSTRUCTIONS (from ' + who + '):',
    agent.instructions || '(none yet)',
    '',
    'MANNER: ' + manner,
    'Reply in the language they write in (app language: ' + (lang === 'tr' ? 'Turkish' : 'English') + ').',
    '',
    'WHAT THE TEAM KNOWS (shared business knowledge — id | fact):',
    shared.length ? shared.map((k) => k.id + ' | ' + k.text).join('\n') : '(nothing yet)',
    'WHAT YOU REMEMBER (your own notes — id | fact):',
    mine.length ? mine.map((k) => k.id + ' | ' + k.text).join('\n') : '(nothing yet)',
    '',
    'TOOLS: none are connected yet. You cannot send email, read an inbox, open accounts, browse the web, make calls or change anything outside this conversation. When asked to do such a thing, do the thinking part — draft the message, the plan, the analysis, the checklist — and say plainly that sending or doing it is awaiting a connection under Tools. Never claim something was sent, done, checked or changed. Never invent numbers, accounts, results or people.',
    'Permissions: ' + agent.permissions + ' (read = answer only; draft = prepare things for approval; approve = act after a yes; auto = act within an agreed policy). Right now every outside action needs a yes.',
    '',
    'Return ONLY a JSON object, no prose around it:',
    '{ "say": "your reply", "remember": [ { "scope": "shared" or "mine", "fact": "one short lasting fact" } ] }',
    '· "say": your whole reply. Plain text that reads well out loud and on screen: short paragraphs; no markdown headings, no emoji, no URLs unless they gave one. Lists are fine as short lines when there are several items. Be specific; the point first.',
    '· "remember": only something lasting worth keeping — who people are, preferences, policies, how the business works, a decision taken. "shared" when the whole team should know it (a business fact); "mine" when it only matters to your own work. Never tasks, never passwords, card numbers or codes. Usually an empty list.'
  ].join('\n');
}

function parseReply(text) {
  const s = String(text || '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j === 'object' && typeof j.say === 'string') {
        const rem = (Array.isArray(j.remember) ? j.remember : []).slice(0, 6)
          .map((r) => r && { scope: r.scope === 'shared' ? 'shared' : 'mine', fact: str(r.fact, 200) })
          .filter((r) => r && r.fact && !/\d[\d\s-]{9,}\d/.test(r.fact) && !/(password|passcode|pin code|şifre|parola)/i.test(r.fact));
        return { say: block(j.say, 6000), remember: rem };
      }
    } catch (e) {}
  }
  /* A model that forgot the shape still said something: keep it. */
  return { say: block(s.replace(/^```(?:json)?|```$/g, ''), 6000), remember: [] };
}

/* ---------- the routes --------------------------------------------------- */
async function handle(p, req, res, ctx) {
  if (p.indexOf('/api/team') !== 0) return false;
  const json = ctx.json;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };

  if (await handleWork(p, req, res, ctx)) return true;

  if (p === '/api/team' && req.method === 'GET') {
    const [list, provs, know, use, lg] = await Promise.all([agents(ctx), providers(), knowledge(ctx), usage(ctx), ctx.get('team:log')]);
    const counts = {};
    for (const a of list) { const t = await thread(ctx, a.id); counts[a.id] = t.length; }
    const tl = await tasks(ctx), ap = await approvals(ctx);
    const attention = { tasks: tl.filter((t) => !t.seen && (t.status === 'done' || t.status === 'awaiting_approval' || t.status === 'awaiting_info' || t.status === 'failed')).length, approvals: ap.filter((x) => x.status === 'pending').length, running: tl.filter((t) => t.status === 'running' || t.status === 'queued').length };
    json(res, 200, { ok: true, agents: list, providers: provs, defaultModel: DEFAULT_MODEL, knowledge: know, usage: use, counts, attention, tasks: tl.slice(-40).reverse(), approvals: ap.filter((x) => x.status === 'pending').slice(-40).reverse(),
      paused: (await ctx.get('team:paused')) === true, log: (Array.isArray(lg) ? lg : []).slice(-60), templates: TEMPLATE_IDS.map((t) => ({ id: t, name: TEMPLATES[t].name, role: TEMPLATES[t].role })), permissions: PERMISSIONS });
    return true;
  }

  if (p === '/api/team/thread' && req.method === 'GET') {
    const id = str(ctx.query.get('agent'), 40);
    json(res, 200, { ok: true, agent: id, messages: await thread(ctx, id) });
    return true;
  }

  if (p === '/api/team/agent' && req.method === 'POST') {
    const b = await body();
    const list = await agents(ctx);
    if (list.filter((a) => !a.archived).length >= 24) { json(res, 400, { error: 'That is a full house: twenty-four agents. Archive one first.' }); return true; }
    const tid = TEMPLATES[b.template] ? String(b.template) : 'general';
    const id = 'a' + newId();
    const a = fromTemplate(tid, id);
    a.name = str(b.name, 40) || a.name;
    if (b.role) a.role = str(b.role, 60);
    a.avatar = a.name.trim().charAt(0).toUpperCase() || 'A';
    a.builtin = false;
    list.push(a); await saveAgents(ctx, list);
    await log(ctx, id, a.name + ' joined the team as ' + a.role + '.');
    json(res, 200, { ok: true, agent: a });
    return true;
  }

  if (p === '/api/team/agent/update' && req.method === 'POST') {
    const b = await body();
    const list = await agents(ctx);
    const a = list.find((x) => x.id === String(b.id || ''));
    if (!a) { json(res, 404, { error: 'No such agent.' }); return true; }
    const changes = [];
    if (typeof b.name === 'string' && str(b.name, 40)) { a.name = str(b.name, 40); a.avatar = a.name.charAt(0).toUpperCase(); changes.push('name'); }
    if (typeof b.role === 'string' && str(b.role, 60)) { a.role = str(b.role, 60); changes.push('role'); }
    if (typeof b.instructions === 'string') { a.instructions = block(b.instructions, 4000); changes.push('instructions'); }
    if (MANNERS[b.manner]) { a.manner = b.manner; changes.push('manner'); }
    if (PERMISSIONS.indexOf(b.permissions) >= 0) { a.permissions = b.permissions; changes.push('permissions'); }
    if (Number.isFinite(+b.dailyCap)) { a.dailyCap = Math.max(0, Math.min(5000, Math.round(+b.dailyCap))); changes.push('daily limit'); }
    if (typeof b.model === 'string' && b.model.trim()) {
      const which = await resolveModel(b.model);
      if (!which) { json(res, 400, { error: 'That model is not available: its provider has no key here yet.' }); return true; }
      if (a.model !== which.model) changes.push('model → ' + which.model);
      a.model = which.model; a.provider = which.provider;
    }
    if (typeof b.archived === 'boolean') {
      if (a.id === 'jarvis' && b.archived) { json(res, 400, { error: 'J.A.R.V.I.S. runs the team; he stays.' }); return true; }
      a.archived = b.archived; changes.push(b.archived ? 'archived' : 'restored');
    }
    a.updatedAt = Date.now();
    await saveAgents(ctx, list);
    if (changes.length) await log(ctx, a.id, a.name + ': ' + changes.join(', ') + '.');
    json(res, 200, { ok: true, agent: a });
    return true;
  }

  if (p === '/api/team/knowledge' && req.method === 'POST') {
    const b = await body();
    const list = await knowledge(ctx);
    const op = String(b.op || 'add');
    if (op === 'add') {
      const text = str(b.text, 300); if (!text) { json(res, 400, { error: 'Write the fact first.' }); return true; }
      const scope = /^agent:[\w-]+$/.test(String(b.scope || '')) ? String(b.scope) : 'shared';
      const k = { id: 'k' + newId(), text, scope, source: 'you', at: Date.now(), updated: Date.now() };
      list.push(k); await ctx.set('team:knowledge', list.slice(-400));
      await log(ctx, scope === 'shared' ? 'team' : scope.slice(6), (scope === 'shared' ? 'Shared knowledge added: ' : 'Memory added: ') + text);
      json(res, 200, { ok: true, item: k, knowledge: list }); return true;
    }
    const k = list.find((x) => x.id === String(b.id || ''));
    if (!k) { json(res, 404, { error: 'No such entry.' }); return true; }
    if (op === 'edit') {
      const text = str(b.text, 300); if (!text) { json(res, 400, { error: 'Write the fact first.' }); return true; }
      k.text = text; k.updated = Date.now(); k.source = 'you';
      if (/^agent:[\w-]+$/.test(String(b.scope || '')) || b.scope === 'shared') k.scope = String(b.scope);
      await ctx.set('team:knowledge', list); await log(ctx, 'team', 'Knowledge edited: ' + text);
      json(res, 200, { ok: true, item: k, knowledge: list }); return true;
    }
    if (op === 'remove') {
      const rest = list.filter((x) => x.id !== k.id);
      await ctx.set('team:knowledge', rest); await log(ctx, 'team', 'Knowledge removed: ' + k.text);
      json(res, 200, { ok: true, knowledge: rest }); return true;
    }
    json(res, 400, { error: 'add, edit or remove.' }); return true;
  }

  if (p === '/api/team/pause' && req.method === 'POST') {
    const b = await body();
    await ctx.set('team:paused', b.paused === true);
    await log(ctx, 'team', b.paused === true ? 'Everything paused.' : 'Resumed.');
    json(res, 200, { ok: true, paused: b.paused === true }); return true;
  }

  if (p === '/api/team/say' && req.method === 'POST') {
    const b = await body();
    const r = await sayTo(ctx, String(b.agent || ''), block(b.text, 6000), b.lang === 'tr' ? 'tr' : 'en');
    if (r.error) { json(res, r.status || 502, r); return true; }
    json(res, 200, Object.assign({ ok: true }, r));
    return true;
  }

  return false;
}

/* One message to one specialist: their thread, their model, their memory.
   Used by the console and by every channel. */
async function sayTo(ctx, agentId, said, lang) {
  {
    const list = await agents(ctx);
    const a = list.find((x) => x.id === agentId && !x.archived);
    if (!a) return { error: 'No such agent.', status: 404 };
    if (a.id === 'jarvis') return { error: 'J.A.R.V.I.S. answers through /api/flow/do.', status: 400 };
    if (!said) return { error: 'Say something first.', status: 400 };
    if ((await ctx.get('team:paused')) === true) return { error: 'The team is paused. Resume it from the command centre.', paused: true, status: 423 };
    const use = await usage(ctx); const mine = use[a.id] || { calls: 0, in: 0, out: 0 };
    if (a.dailyCap > 0 && mine.calls >= a.dailyCap) return { error: a.name + ' has reached today\'s limit of ' + a.dailyCap + ' messages.', used: mine.calls, cap: a.dailyCap, status: 429 };
    const which = await resolveModel(a.model);
    if (!which) return { error: a.name + ' is set to ' + a.model + ', and that provider has no key here. Choose another model.', awaiting: true, status: 503 };
    const b = { lang };
    const know = await knowledge(ctx);
    const shared = know.filter((k) => k.scope === 'shared').slice(-80);
    const own = know.filter((k) => k.scope === 'agent:' + a.id).slice(-80);
    const names = list.filter((x) => !x.archived && x.id !== a.id && x.id !== 'jarvis').map((x) => x.name + ' (' + x.role.toLowerCase() + ')');
    const hist = await thread(ctx, a.id);
    const turns = hist.slice(-16).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text || '').slice(0, 4000) }));
    /* two user turns in a row confuse some providers: fold them */
    const messages = [];
    for (const t of turns) { const last = messages[messages.length - 1]; if (last && last.role === t.role) last.content += '\n\n' + t.content; else messages.push(t); }
    if (messages.length && messages[0].role !== 'user') messages.shift();
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') last.content += '\n\n' + said; else messages.push({ role: 'user', content: said });
    const system = agentSystem(a, ctx.user && (ctx.user.name || ctx.user.email), shared, own, b.lang === 'tr' ? 'tr' : 'en', names);
    const r = await complete({ model: which.model, system, messages, maxTokens: 1600 });
    if (r.error) return { error: r.error, status: r.status === 429 ? 429 : 502 };
    const out = parseReply(r.text);
    const now = Date.now();
    hist.push({ role: 'user', text: said, at: now }, { role: 'assistant', text: out.say, at: now, model: which.model });
    await ctx.set('team:thread:' + a.id, hist.slice(-160));
    const remembered = [];
    if (out.remember.length) {
      const k2 = await knowledge(ctx);
      for (const rm of out.remember) {
        const dup = k2.some((k) => k.text.toLowerCase() === rm.fact.toLowerCase());
        if (dup) continue;
        const item = { id: 'k' + newId(), text: rm.fact, scope: rm.scope === 'shared' ? 'shared' : 'agent:' + a.id, source: 'agent:' + a.id, at: now, updated: now };
        k2.push(item); remembered.push(item);
      }
      if (remembered.length) { await ctx.set('team:knowledge', k2.slice(-400)); await log(ctx, a.id, a.name + ' remembered: ' + remembered.map((k) => k.text).join('; ')); }
    }
    use[a.id] = { calls: mine.calls + 1, in: mine.in + (r.usage.in || 0), out: mine.out + (r.usage.out || 0) };
    await ctx.set(dayKey(), use);
    return { say: out.say, remembered, model: which.model, provider: which.provider, usage: use[a.id], agent: a };
  }
}


/* =========================================================================
 * Work that continues — tasks, delegation, approvals
 * -------------------------------------------------------------------------
 * A task is a record in the account's store, and it is run by this process
 * in the background, one step at a time, saving after every step. That is
 * what lets the laptop close: the request that created the task returned at
 * once; the steps run here; the result waits in the store and a push says
 * so. If the server restarts mid-task, start() finds every task that was
 * running or queued and carries on from the last saved step — a step marked
 * done is never run twice, and a step is only a model call, so running an
 * unfinished one again changes nothing outside this server.
 *
 * Delegation is flat and bounded. J.A.R.V.I.S. plans at most six steps,
 * each for one specialist; a specialist cannot delegate. No step calls
 * another step, so there is no loop to prevent, only a list to walk.
 *
 * Nothing leaves the building by itself. Anything an agent proposes that
 * would reach the outside world — an email, a message, money, a change —
 * becomes an approval: a card showing the exact action, waiting for a yes.
 * Today no tool is connected, so an approved email is marked "approved —
 * awaiting a connection to send" and is never claimed as sent. When a tool
 * exists, the approval's key makes the sending happen once and only once.
 *
 *   team:tasks       [{ id, title, brief, agent, by, status, steps[], result, question, error, createdAt, updatedAt, doneAt, seen }]
 *   team:approvals   [{ id, task, step, agent, kind, summary, detail, status, key, at, decidedAt, executedAt }]
 *   status: queued | running | awaiting_info | awaiting_approval | done | failed | cancelled
 * ====================================================================== */
const TASK_STATES = ['queued', 'running', 'awaiting_info', 'awaiting_approval', 'done', 'failed', 'cancelled'];
const APPROVAL_KINDS = ['email', 'message', 'post', 'spend', 'change', 'other'];
const MAX_STEPS = 6, MAX_ATTEMPTS = 3, MAX_TASKS = 200;

async function tasks(ctx) { const v = await ctx.get('team:tasks'); return Array.isArray(v) ? v : []; }
async function saveTasks(ctx, list) { await ctx.set('team:tasks', list.slice(-MAX_TASKS)); }
async function approvals(ctx) { const v = await ctx.get('team:approvals'); return Array.isArray(v) ? v : []; }
async function saveApprovals(ctx, list) { await ctx.set('team:approvals', list.slice(-400)); }

/* One task's record, changed in place and saved: the one way a task moves. */
async function patchTask(ctx, id, fn) {
  const list = await tasks(ctx);
  const t = list.find((x) => x.id === id); if (!t) return null;
  fn(t); t.updatedAt = Date.now();
  await saveTasks(ctx, list);
  return t;
}

function stepSystem(agent, owner, shared, mine, lang, task, step, earlier) {
  const base = agentSystem(agent, owner, shared, mine, lang, []);
  return base.replace(/Return ONLY a JSON object[\s\S]*$/, [
    'YOU HAVE BEEN GIVEN A PIECE OF WORK' + (task.by === 'jarvis' ? ' by J.A.R.V.I.S., for ' + str(owner, 60) : ' by ' + str(owner, 60)) + '.',
    'Task: ' + task.title,
    'Your part: ' + step.title,
    'Brief: ' + (step.brief || task.brief || ''),
    earlier.length ? 'What the others have done so far:\n' + earlier.map((e) => '· ' + e.agent + ' — ' + e.title + ':\n' + String(e.result || '').slice(0, 1500)).join('\n') : '',
    '',
    'Do the work in full, here, in words: the draft, the analysis, the list, the plan. Be specific and complete; this is the deliverable, not a description of one.',
    'Anything that would reach the outside world — sending an email or message, posting, paying, changing a live setting — you do NOT do: you propose it, fully written out, as a proposal below, and the person approves it.',
    'If you truly cannot proceed without one fact only the person has, ask one clear question in "question" and leave "result" empty.',
    '',
    'Return ONLY a JSON object, no prose around it:',
    '{ "result": "the finished work, plain text, as long as it needs to be", "question": "", "proposals": [ { "kind": "email|message|post|spend|change|other", "summary": "one line: what would happen", "to": "", "subject": "", "body": "" } ], "remember": [ { "scope": "shared|mine", "fact": "" } ] }',
    '· "result": the work itself. Plain text; short headings and dashes are fine; no markdown symbols like ** or #.',
    '· "proposals": only real outside actions, each complete enough to approve as-is (an email has to, subject and body). Usually empty.',
    '· "remember": lasting facts only; usually empty.'
  ].join('\n'));
}

function parseStep(text) {
  const s = String(text || '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  let j = null; if (m) { try { j = JSON.parse(m[0]); } catch (e) {} }
  if (!j || typeof j !== 'object') return { result: block(s.replace(/^```(?:json)?|```$/g, ''), 12000), question: '', proposals: [], remember: [] };
  const props = (Array.isArray(j.proposals) ? j.proposals : []).slice(0, 6).map((p) => p && {
    kind: APPROVAL_KINDS.indexOf(p.kind) >= 0 ? p.kind : 'other', summary: str(p.summary, 200),
    to: str(p.to, 200), subject: str(p.subject, 200), body: block(p.body, 6000)
  }).filter((p) => p && (p.summary || p.body));
  const rem = (Array.isArray(j.remember) ? j.remember : []).slice(0, 4)
    .map((r) => r && { scope: r.scope === 'shared' ? 'shared' : 'mine', fact: str(r.fact, 200) })
    .filter((r) => r && r.fact && !/\d[\d\s-]{9,}\d/.test(r.fact) && !/(password|passcode|pin code|şifre|parola)/i.test(r.fact));
  return { result: block(j.result, 12000), question: str(j.question, 400), proposals: props, remember: rem };
}

/* J.A.R.V.I.S. decides who does what. */
function planSystem(agents, owner, shared, lang) {
  return [
    'You are J.A.R.V.I.S., chief of staff to ' + str(owner, 60) + ', inside The Flow. You have just been asked for a piece of work that the team should do. Plan it.',
    'THE TEAM (id | name | role | instructions):',
    agents.filter((a) => a.id !== 'jarvis' && !a.archived).map((a) => a.id + ' | ' + a.name + ' | ' + a.role + ' | ' + str(a.instructions, 160)).join('\n') || '(nobody yet)',
    shared.length ? 'WHAT THE TEAM KNOWS:\n' + shared.map((k) => '· ' + k.text).join('\n') : '',
    'Language: ' + (lang === 'tr' ? 'Turkish' : 'English') + '.',
    '',
    'Return ONLY a JSON object:',
    '{ "title": "short title for the task", "say": "one or two spoken sentences: who you are putting on it and what they will deliver", "steps": [ { "agent": "<id from the team>", "title": "what this specialist delivers", "brief": "exactly what to do, with every detail from the request that matters" } ] }',
    '· One to ' + MAX_STEPS + ' steps, in the order they should run; a later step can build on the earlier ones. Each step goes to the one specialist whose role fits. Do not invent agents.',
    '· If the request is really one specialist\'s job, one step. If it needs no specialist at all, "steps": [] and say so in "say".',
    '· Steps are work done in words here (drafts, analysis, research, checks, plans). Nothing is sent or changed outside without approval; the specialists know this.',
    '· "say" is spoken aloud: plain, brief, no lists.'
  ].join('\n');
}
function parsePlan(text, agents) {
  const s = String(text || ''); const m = s.match(/\{[\s\S]*\}/);
  let j = null; if (m) { try { j = JSON.parse(m[0]); } catch (e) {} }
  if (!j || typeof j !== 'object') return null;
  const ids = new Set(agents.filter((a) => a.id !== 'jarvis' && !a.archived).map((a) => a.id));
  const steps = (Array.isArray(j.steps) ? j.steps : []).slice(0, MAX_STEPS)
    .map((st) => st && ids.has(String(st.agent)) ? { agent: String(st.agent), title: str(st.title, 140) || 'Work', brief: block(st.brief, 3000) } : null)
    .filter(Boolean);
  return { title: str(j.title, 120), say: str(j.say, 600), steps };
}

/* The runner: one loop per account, started when a task is queued, resumed
   at boot. It walks the steps of every task that is not finished, saving
   after each. Only one loop per account runs at a time. */
const loops = new Map();   /* uid → Promise */
let pushTo = null;         /* (uid, note) => Promise — set by start() */
let bootCtx = null;        /* (uid) => ctx — set by start() */
let fakeDelay = 0;

function kick(uid, ctx) {
  if (loops.has(uid)) return loops.get(uid);
  const p = runLoop(uid, ctx).catch((e) => { console.error('[team] runner', e && e.message ? e.message : e); }).finally(() => loops.delete(uid));
  loops.set(uid, p);
  return p;
}
async function runLoop(uid, ctx) {
  for (let guard = 0; guard < 200; guard++) {
    if ((await ctx.get('team:paused')) === true) return;
    const list = await tasks(ctx);
    const t = list.find((x) => x.status === 'queued' || x.status === 'running');
    if (!t) return;
    await runTask(uid, ctx, t.id);
  }
}
async function runTask(uid, ctx, id) {
  let t = await patchTask(ctx, id, (x) => { if (x.status === 'queued') { x.status = 'running'; x.startedAt = x.startedAt || Date.now(); } });
  if (!t) return;
  const list = await agents(ctx);
  const owner = ctx.user && (ctx.user.name || ctx.user.email);
  for (let i = 0; i < t.steps.length; i++) {
    t = (await tasks(ctx)).find((x) => x.id === id); if (!t || t.status !== 'running') return;
    const st = t.steps[i];
    if (st.status === 'done') continue;
    const a = list.find((x) => x.id === st.agent);
    if (!a || a.archived) { await patchTask(ctx, id, (x) => { x.steps[i].status = 'failed'; x.steps[i].error = 'No such agent any more.'; x.status = 'failed'; x.error = (x.steps[i].title) + ': the agent is gone.'; }); return; }
    const which = await resolveModel(a.model);
    if (!which) { await patchTask(ctx, id, (x) => { x.status = 'failed'; x.error = a.name + ' is set to ' + a.model + ' and that provider has no key here.'; }); await notify(uid, ctx, t, 'failed'); return; }
    await patchTask(ctx, id, (x) => { x.steps[i].status = 'running'; x.steps[i].startedAt = Date.now(); x.steps[i].attempts = (x.steps[i].attempts || 0) + 1; });
    const know = await knowledge(ctx);
    const shared = know.filter((k) => k.scope === 'shared').slice(-80), own = know.filter((k) => k.scope === 'agent:' + a.id).slice(-80);
    const earlier = t.steps.slice(0, i).filter((s) => s.status === 'done').map((s) => ({ agent: (list.find((x) => x.id === s.agent) || {}).name || s.agent, title: s.title, result: s.result }));
    const system = stepSystem(a, owner, shared, own, t.lang, t, st, earlier);
    const user = (t.answer ? 'The person answered your question: "' + t.answer + '"\n\n' : '') + 'Do your part now.';
    if (fakeDelay) await new Promise((r) => setTimeout(r, fakeDelay));
    const r = await complete({ model: which.model, system, messages: [{ role: 'user', content: user }], maxTokens: 3000, timeoutMs: 90000 });
    if (r.error) {
      const attempts = (st.attempts || 0) + 1;
      if (attempts < MAX_ATTEMPTS && r.status !== 401 && r.status !== 403) {
        await patchTask(ctx, id, (x) => { x.steps[i].status = 'queued'; x.steps[i].error = r.error; });
        await new Promise((res) => setTimeout(res, fakeDelay ? 50 : 4000 * attempts));
        i--; continue;
      }
      await patchTask(ctx, id, (x) => { x.steps[i].status = 'failed'; x.steps[i].error = r.error; x.status = 'failed'; x.error = a.name + ' could not finish "' + x.steps[i].title + '": ' + r.error; });
      await log(ctx, a.id, a.name + ' could not finish: ' + st.title);
      await notify(uid, ctx, t, 'failed');
      return;
    }
    const out = parseStep(r.text);
    await bumpUsage(ctx, a.id, r.usage);
    if (out.question && !out.result) {
      await patchTask(ctx, id, (x) => { x.steps[i].status = 'queued'; x.status = 'awaiting_info'; x.question = out.question; x.asker = a.id; x.answer = ''; x.seen = false; });
      await log(ctx, a.id, a.name + ' has a question on "' + t.title + '".');
      await notify(uid, ctx, t, 'question');
      return;
    }
    /* proposals → approvals, waiting */
    const newApprovals = [];
    if (out.proposals.length) {
      const ap = await approvals(ctx);
      for (const p of out.proposals) {
        const item = { id: 'p' + newId(), task: id, step: st.id, agent: a.id, kind: p.kind, summary: p.summary || (p.kind + (p.to ? ' to ' + p.to : '')), detail: { to: p.to, subject: p.subject, body: p.body }, status: 'pending', key: 'k' + newId(), at: Date.now() };
        ap.push(item); newApprovals.push(item.id);
      }
      await saveApprovals(ctx, ap);
    }
    if (out.remember.length) {
      const k2 = await knowledge(ctx); let n = 0;
      for (const rm of out.remember) { if (k2.some((k) => k.text.toLowerCase() === rm.fact.toLowerCase())) continue; k2.push({ id: 'k' + newId(), text: rm.fact, scope: rm.scope === 'shared' ? 'shared' : 'agent:' + a.id, source: 'agent:' + a.id, at: Date.now(), updated: Date.now() }); n++; }
      if (n) await ctx.set('team:knowledge', k2.slice(-400));
    }
    await patchTask(ctx, id, (x) => { x.steps[i].status = 'done'; x.steps[i].result = out.result; x.steps[i].model = which.model; x.steps[i].doneAt = Date.now(); x.steps[i].approvals = newApprovals; x.answer = ''; x.question = ''; });
    await log(ctx, a.id, a.name + ' finished: ' + st.title + (newApprovals.length ? ' (' + newApprovals.length + ' for approval)' : ''));
    if ((await ctx.get('team:paused')) === true) return;
  }
  /* every step done: the result */
  t = (await tasks(ctx)).find((x) => x.id === id); if (!t || t.status !== 'running') return;
  let result = '';
  const done = t.steps.filter((s) => s.status === 'done');
  if (done.length === 1 && t.by !== 'jarvis') result = done[0].result;
  else {
    const j = list.find((x) => x.id === 'jarvis');
    const which = j && await resolveModel(j.model);
    if (which) {
      const sys = 'You are J.A.R.V.I.S., chief of staff to ' + str(owner, 60) + '. The specialists have finished the task "' + t.title + '". Review their work and hand it over: a short, plain summary of what was done and what needs the person\'s yes (approvals are listed separately in the app), then each specialist\'s deliverable in full under a heading with their name. Plain text, no markdown symbols. Be exact; invent nothing. ' + (t.lang === 'tr' ? 'Write in Turkish.' : 'Write in English.');
      const body = done.map((s) => ((list.find((x) => x.id === s.agent) || {}).name || s.agent) + ' — ' + s.title + ':\n' + s.result).join('\n\n');
      const r = await complete({ model: which.model, system: sys, messages: [{ role: 'user', content: body }], maxTokens: 3500, timeoutMs: 90000 });
      if (!r.error) { result = block(r.text, 16000); await bumpUsage(ctx, 'jarvis', r.usage); }
    }
    if (!result) result = done.map((s) => ((list.find((x) => x.id === s.agent) || {}).name || s.agent) + ' — ' + s.title + '\n' + s.result).join('\n\n');
  }
  const pending = (await approvals(ctx)).filter((x) => x.task === id && x.status === 'pending').length;
  t = await patchTask(ctx, id, (x) => { x.result = result; x.status = pending ? 'awaiting_approval' : 'done'; x.doneAt = Date.now(); x.seen = false; });
  await log(ctx, t.agent, '"' + t.title + '" is ' + (pending ? 'ready — ' + pending + ' approval' + (pending === 1 ? '' : 's') + ' waiting' : 'done') + '.');
  await notify(uid, ctx, t, pending ? 'approval' : 'done');
}
async function bumpUsage(ctx, agentId, u) {
  const use = await usage(ctx); const m = use[agentId] || { calls: 0, in: 0, out: 0 };
  use[agentId] = { calls: m.calls + 1, in: m.in + ((u && u.in) || 0), out: m.out + ((u && u.out) || 0) };
  await ctx.set(dayKey(), use);
}
let channelsTo = null;   /* (uid, text, opts) => Promise — set by start() */
async function notify(uid, ctx, t0, what) {
  /* the freshest record: the caller's copy may predate the last save */
  const t = (await tasks(ctx)).find((x) => x.id === t0.id) || t0;
  const list = await agents(ctx); const a = list.find((x) => x.id === t.agent) || { name: 'The team' };
  const title = what === 'done' ? a.name + ' is done: ' + t.title : what === 'approval' ? t.title + ' — needs your yes' : what === 'question' ? a.name + ' has a question' : t.title + ' did not finish';
  const body = what === 'question' ? String(t.question || '').slice(0, 160) : what === 'failed' ? String(t.error || '').slice(0, 160) : 'Open the command centre to see it.';
  if (pushTo) { try { await pushTo(uid, { title, body, thread: 'team', data: { team: 'task', id: t.id } }); } catch (e) {} }
  /* The channels he is linked on get the result itself, not a pointer. */
  if (channelsTo) {
    let text = title + '\n\n';
    if (what === 'question') text += t.question + '\n\nReply with the answer, or "/answer <text>".';
    else if (what === 'failed') text += t.error;
    else {
      text += String(t.result || '').slice(0, 3000) + (String(t.result || '').length > 3000 ? '\n…' : '');
      if (what === 'approval') { const ap = (await approvals(ctx)).filter((x) => x.task === t.id && x.status === 'pending'); text += '\n\n' + ap.map((x, i) => '[' + (i + 1) + '] ' + x.summary + (x.detail && x.detail.to ? ' → ' + x.detail.to : '')).join('\n') + '\n\nReply "/yes 1" or "/no 1".'; }
    }
    try { await channelsTo(uid, text, { task: t, what, call: !!t.callMe && (what === 'done' || what === 'approval') }); } catch (e) {}
  }
}

/* Boot: every account's unfinished tasks carry on. */
function start(deps) {
  pushTo = deps.sendToUser ? (uid, note) => deps.sendToUser(deps.raw, uid, note) : null;
  channelsTo = typeof deps.channels === 'function' ? deps.channels : null;
  bootCtx = (uid) => {
    const pre = deps.nsPrefix(uid);
    const getJSON = async (k) => { const v = await deps.raw.get(pre + k); if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } };
    return { get: getJSON, set: (k, v) => deps.raw.set(pre + k, JSON.stringify(v)), user: null };
  };
  (async () => {
    try {
      const ids = await deps.users();
      for (const uid of ids) {
        const ctx = bootCtx(uid);
        const list = await tasks(ctx);
        if (list.some((t) => t.status === 'queued' || t.status === 'running')) { if (deps.log) deps.log('[team] resuming work for an account'); kick(uid, ctx); }
      }
    } catch (e) { if (deps.log) deps.log('[team] resume failed: ' + (e && e.message)); }
  })();
}

async function newTask(ctx, uid, fields) {
  const list = await tasks(ctx);
  if (list.filter((t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled').length >= 40) throw new Error('Forty tasks are already in flight. Let some finish first.');
  const t = Object.assign({ id: 't' + newId(), status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), result: '', question: '', answer: '', error: '', seen: true }, fields);
  t.steps = t.steps.map((s, i) => Object.assign({ id: 's' + i + newId(), status: 'queued', result: '', attempts: 0 }, s));
  list.push(t); await saveTasks(ctx, list);
  await log(ctx, t.agent, (t.by === 'jarvis' ? 'J.A.R.V.I.S. put the team on: ' : 'Task: ') + t.title);
  kick(uid, ctx);
  return t;
}

/* "Have Sarah draft…": J.A.R.V.I.S. plans and the team starts. Used by the
   console's card and by every channel. opts.callMe: ring when it is ready. */
async function delegateText(ctx, uid, text, lang, opts) {
  if (!text) return { error: 'Say what the team should do.', status: 400 };
  if ((await ctx.get('team:paused')) === true) return { error: 'The team is paused.', paused: true, status: 423 };
  const list = await agents(ctx);
  const j = list.find((x) => x.id === 'jarvis');
  const which = await resolveModel(j.model);
  if (!which) return { error: 'J.A.R.V.I.S. has no model available here.', status: 503 };
  const know = await knowledge(ctx);
  const r = await complete({ model: which.model, system: planSystem(list, ctx.user && (ctx.user.name || ctx.user.email), know.filter((k) => k.scope === 'shared').slice(-60), lang), messages: [{ role: 'user', content: text }], maxTokens: 1800, timeoutMs: 60000 });
  if (r.error) return { error: r.error, status: r.status === 429 ? 429 : 502 };
  await bumpUsage(ctx, 'jarvis', r.usage);
  const plan = parsePlan(r.text, list);
  if (!plan) return { error: 'The plan came back in a shape the app could not read. Try again.', status: 502 };
  if (!plan.steps.length) return { task: null, say: plan.say || 'That needs none of the team; I can do it myself.' };
  try {
    const t = await newTask(ctx, uid, { title: plan.title || str(text, 80), brief: text, agent: 'jarvis', by: 'jarvis', lang, steps: plan.steps, callMe: !!(opts && opts.callMe), via: (opts && opts.via) || '' });
    return { task: t, say: plan.say };
  } catch (e) { return { error: e.message, status: 400 }; }
}

/* A yes or a no to one approval — once. */
async function decide(ctx, id, decision, detail) {
  const ap = await approvals(ctx);
  const item = ap.find((x) => x.id === id);
  if (!item) return { error: 'No such approval.', status: 404 };
  if (decision !== 'approve' && decision !== 'reject') return { error: 'approve or reject.', status: 400 };
  if (item.status !== 'pending') return { approval: item, already: true };
  if (detail && typeof detail === 'object') { item.detail = { to: str(detail.to, 200), subject: str(detail.subject, 200), body: block(detail.body, 6000) }; item.edited = true; }
  item.decidedAt = Date.now();
  if (decision === 'reject') { item.status = 'rejected'; }
  else {
    item.status = 'awaiting_tool';
    item.note = 'Approved. Nothing is connected to carry it out yet, so it has not been sent; it will go once, as approved, when the connection exists.';
  }
  await saveApprovals(ctx, ap);
  const list = await agents(ctx); const a = list.find((x) => x.id === item.agent) || { name: 'An agent' };
  await log(ctx, item.agent, (decision === 'approve' ? 'Approved: ' : 'Declined: ') + item.summary + (decision === 'approve' ? ' (awaiting a connection)' : ''));
  const stillPending = ap.some((x) => x.task === item.task && x.status === 'pending');
  if (!stillPending) await patchTask(ctx, item.task, (x) => { if (x.status === 'awaiting_approval') x.status = 'done'; });
  return { approval: item, agent: a.name };
}

async function handleWork(p, req, res, ctx) {
  const json = ctx.json;
  const uid = ctx.user && ctx.user.id;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };

  if (p === '/api/team/tasks' && req.method === 'GET') {
    const [tl, ap] = await Promise.all([tasks(ctx), approvals(ctx)]);
    json(res, 200, { ok: true, tasks: tl.slice(-80).reverse(), approvals: ap.slice(-120).reverse(), running: loops.has(uid) });
    return true;
  }

  /* assign a piece of work to one agent */
  if (p === '/api/team/task' && req.method === 'POST') {
    const b = await body();
    const list = await agents(ctx);
    const a = list.find((x) => x.id === String(b.agent || '') && !x.archived && x.id !== 'jarvis');
    if (!a) { json(res, 404, { error: 'Pick one of the team.' }); return true; }
    const brief = block(b.brief || b.text, 4000); if (!brief) { json(res, 400, { error: 'Say what to do.' }); return true; }
    if ((await ctx.get('team:paused')) === true) { json(res, 423, { error: 'The team is paused.', paused: true }); return true; }
    try {
      const t = await newTask(ctx, uid, { title: str(b.title, 120) || str(brief, 80), brief, agent: a.id, by: 'you', lang: b.lang === 'tr' ? 'tr' : 'en', steps: [{ agent: a.id, title: str(b.title, 120) || 'The work', brief }] });
      json(res, 200, { ok: true, task: t });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  /* J.A.R.V.I.S. plans and hands out */
  if (p === '/api/team/delegate' && req.method === 'POST') {
    const b = await body();
    const r = await delegateText(ctx, uid, block(b.text, 4000), b.lang === 'tr' ? 'tr' : 'en', {});
    if (r.error) { json(res, r.status || 502, r); return true; }
    json(res, 200, Object.assign({ ok: true }, r));
    return true;
  }

  if (p === '/api/team/task/answer' && req.method === 'POST') {
    const b = await body();
    const t = await patchTask(ctx, String(b.id || ''), (x) => { if (x.status === 'awaiting_info') { x.answer = block(b.answer, 2000); x.status = 'queued'; x.seen = true; } });
    if (!t) { json(res, 404, { error: 'No such task.' }); return true; }
    kick(uid, ctx);
    json(res, 200, { ok: true, task: t }); return true;
  }

  if (p === '/api/team/task/cancel' && req.method === 'POST') {
    const b = await body();
    const t = await patchTask(ctx, String(b.id || ''), (x) => { if (x.status !== 'done' && x.status !== 'failed') { x.status = 'cancelled'; x.steps.forEach((s) => { if (s.status !== 'done') s.status = 'cancelled'; }); } });
    if (!t) { json(res, 404, { error: 'No such task.' }); return true; }
    const ap = await approvals(ctx); let n = 0; ap.forEach((x) => { if (x.task === t.id && x.status === 'pending') { x.status = 'rejected'; x.decidedAt = Date.now(); n++; } }); if (n) await saveApprovals(ctx, ap);
    await log(ctx, t.agent, 'Cancelled: ' + t.title);
    json(res, 200, { ok: true, task: t }); return true;
  }

  if (p === '/api/team/task/seen' && req.method === 'POST') {
    const b = await body();
    await patchTask(ctx, String(b.id || ''), (x) => { x.seen = true; });
    json(res, 200, { ok: true }); return true;
  }

  if (p === '/api/team/task/retry' && req.method === 'POST') {
    const b = await body();
    const t = await patchTask(ctx, String(b.id || ''), (x) => { if (x.status === 'failed') { x.status = 'queued'; x.error = ''; x.steps.forEach((s) => { if (s.status === 'failed') { s.status = 'queued'; s.attempts = 0; s.error = ''; } }); } });
    if (!t) { json(res, 404, { error: 'No such task.' }); return true; }
    kick(uid, ctx);
    json(res, 200, { ok: true, task: t }); return true;
  }

  /* approvals: the exact action, a yes or a no, and never twice */
  if (p === '/api/team/approve' && req.method === 'POST') {
    const b = await body();
    /* A change to the proposed text is a new proposal: what gets approved
       is exactly what is on screen now. */
    const r = await decide(ctx, String(b.id || ''), b.decision === 'approve' ? 'approve' : b.decision === 'reject' ? 'reject' : '', b.detail && typeof b.detail === 'object' ? b.detail : null);
    if (r.error) { json(res, r.status || 400, r); return true; }
    json(res, 200, Object.assign({ ok: true }, r)); return true;
  }

  return false;
}

module.exports.start = start;
module.exports.sayTo = sayTo;
module.exports.delegateText = delegateText;
module.exports.decide = decide;
module.exports.newTask = newTask;
module.exports.agents = agents;
module.exports.tasks = tasks;
module.exports.approvals = approvals;
module.exports.knowledge = knowledge;
module.exports.patchTask = patchTask;
module.exports.kick = kick;
module.exports.log = log;
module.exports.bumpUsage = bumpUsage;
module.exports.ctxFor = (uid) => (bootCtx ? bootCtx(uid) : null);
module.exports._work = { tasks, approvals, parseStep, parsePlan, planSystem, stepSystem, TASK_STATES, setFakeDelay: (ms) => { fakeDelay = ms; }, loops };

/* For J.A.R.V.I.S.'s own engine: the shared knowledge, as lines, and the
   model he is set to (if any). flow-extras reads these. */
async function forJarvis(ctx) {
  try {
    const list = await ctx.get('team:agents'); const know = await ctx.get('team:knowledge');
    const j = Array.isArray(list) ? list.find((a) => a.id === 'jarvis') : null;
    const shared = (Array.isArray(know) ? know : []).filter((k) => k && k.scope === 'shared').slice(-80).map((k) => ({ id: k.id, text: k.text }));
    const paused = (await ctx.get('team:paused')) === true;
    return { model: j && j.model && j.model !== DEFAULT_MODEL ? j.model : '', shared, paused };
  } catch (e) { return { model: '', shared: [], paused: false }; }
}

module.exports.handle = handle;
module.exports.complete = complete;
module.exports.resolveModel = resolveModel;
module.exports.providers = providers;
module.exports.forJarvis = forJarvis;
module.exports._internals = { PROVIDERS, TEMPLATES, STARTER_IDS, TEMPLATE_IDS, MANNERS, agentSystem, parseReply, fromTemplate, setPost: (f) => { post = f; }, DEFAULT_MODEL };
