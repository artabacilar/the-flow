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
  const last = msgs.filter((m) => m.role === 'user').pop();
  const said = String((last && last.content) || '').split('\n\n').pop();
  const rem = []; const m = said.match(/remember that (.+?)(?:\.|$)/i);
  if (m) rem.push({ scope: /\bteam\b|\bbusiness\b/i.test(said) ? 'shared' : 'mine', fact: m[1] });
  const text = JSON.stringify({ say: b.model + ' says: ' + said, remember: rem });
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

  if (p === '/api/team' && req.method === 'GET') {
    const [list, provs, know, use, lg] = await Promise.all([agents(ctx), providers(), knowledge(ctx), usage(ctx), ctx.get('team:log')]);
    const counts = {};
    for (const a of list) { const t = await thread(ctx, a.id); counts[a.id] = t.length; }
    json(res, 200, { ok: true, agents: list, providers: provs, defaultModel: DEFAULT_MODEL, knowledge: know, usage: use, counts,
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
    const list = await agents(ctx);
    const a = list.find((x) => x.id === String(b.agent || '') && !x.archived);
    if (!a) { json(res, 404, { error: 'No such agent.' }); return true; }
    if (a.id === 'jarvis') { json(res, 400, { error: 'J.A.R.V.I.S. answers through /api/flow/do.' }); return true; }
    const said = block(b.text, 6000); if (!said) { json(res, 400, { error: 'Say something first.' }); return true; }
    if ((await ctx.get('team:paused')) === true) { json(res, 423, { error: 'The team is paused. Resume it from the command centre.', paused: true }); return true; }
    const use = await usage(ctx); const mine = use[a.id] || { calls: 0, in: 0, out: 0 };
    if (a.dailyCap > 0 && mine.calls >= a.dailyCap) { json(res, 429, { error: a.name + ' has reached today\'s limit of ' + a.dailyCap + ' messages.', used: mine.calls, cap: a.dailyCap }); return true; }
    const which = await resolveModel(a.model);
    if (!which) { json(res, 503, { error: a.name + ' is set to ' + a.model + ', and that provider has no key here. Choose another model.', awaiting: true }); return true; }
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
    if (r.error) { json(res, r.status === 429 ? 429 : 502, { error: r.error }); return true; }
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
    json(res, 200, { ok: true, say: out.say, remembered, model: which.model, provider: which.provider, usage: use[a.id] });
    return true;
  }

  return false;
}

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
