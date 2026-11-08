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
const memory = require('./flow-memory');
const skills = require('./flow-skills');
const scripts = require('./flow-scripts');
const efficiency = require('./flow-efficiency');

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
    const whole = String((last && last.content) || '');
    const rd = brief.match(/\bread (https?:\/\/\S+)/i), bw = brief.match(/\bbrowse (https?:\/\/\S+)/i);
    const answered = (whole.match(/The person answered your question: "([^"]*)"/) || [])[1];
    if (answered) out.result = who + ' did: ' + brief + ' — with your answer: ' + answered;
    else if ((rd || bw) && !/THE PAGES YOU ASKED FOR/.test(whole)) text = JSON.stringify(rd ? { result: '', read: [rd[1]] } : { result: '', browse: { url: bw[1], goal: 'see what is there' } });
    else if (/THE PAGES YOU ASKED FOR/.test(whole)) out.result = who + ' read it: ' + whole.split('THE PAGES YOU ASKED FOR:')[1].replace(/\s+/g, ' ').trim().slice(0, 400);
    /* a skill in the prompt: the stand-in says which it followed, step by step, like a model should */
    const sk = system.match(/SKILL TO FOLLOW: (.+?) \(v(\d+), (\w+)\)/);
    if (sk) { const steps = (system.split(/Steps, in order:|Guidance:/)[1] || '').split('\n').slice(1).filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, '')); out.result = who + ' followed the skill "' + sk[1] + '" v' + sk[2] + ' for: ' + brief + '\n' + steps.map((s, i) => 'Step ' + (i + 1) + ' — ' + s + ': done.').join('\n'); if (/\bemail|send\b/i.test(steps.join(' ')) && /email|send/i.test(brief)) out.proposals.push({ kind: 'email', summary: 'Email drafted by the skill', to: 'customer@example.com', subject: 'From the skill', body: 'Draft per "' + sk[1] + '".' }); }
    /* a skill that uses an automation: the stand-in asks for it to run, then reports its result — like a model should */
    const auto = system.match(/AUTOMATIONS THIS SKILL USES[\s\S]*?\((sc[0-9a-f]+), v\d+\)/);
    if (auto && !/AUTOMATION "/.test(whole)) text = JSON.stringify({ result: '', run: { script: auto[1], inputs: {} } });
    else if (/AUTOMATION "/.test(whole)) out.result = who + ' used the automation: ' + whole.split('Result:\n')[1].replace(/\s+/g, ' ').trim().slice(0, 400) + (sk ? ' (skill "' + sk[1] + '" v' + sk[2] + ')' : '');
    const nosk = system.match(/SKILL REQUESTED BUT NOT FOUND: the person asked for a skill called "([^"]+)"/) || system.match(/SKILL (?:REQUESTED BUT NOT USABLE|THAT WOULD APPLY BUT CANNOT RUN HERE): "([^"]+)"[^\n]*/);
    if (nosk) out.result = who + ' could not use the skill "' + nosk[1] + '": ' + (nosk[0].split(/: "[^"]+"/)[1] || 'it does not exist').replace(/^\s*(?:\(v\d+\))?\s*/, '').slice(0, 200) + '. Did the work without it: ' + brief;
    if (/ask me/i.test(brief) && !/answered your question/.test(String((last && last.content) || ''))) { out.question = 'Which address should it go to?'; out.result = ''; }
    if (/long one/i.test(brief)) { const slow = { status: 200, body: { content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 1, output_tokens: 1 } } }; return new Promise((r) => setTimeout(() => r(slow), 4000)); }
    if (/email/i.test(brief)) out.proposals.push({ kind: 'email', summary: 'Email to the customer', to: 'customer@example.com', subject: 'About your refund', body: 'Dear customer, ' + brief });
    if (/\bfail\b/i.test(brief)) return Promise.resolve({ status: 500, body: { error: { message: 'stand-in failure' } } });
    if (!text) text = JSON.stringify(out);
  } else if (/chief of staff[\s\S]*Plan it\./.test(system)) {
    const steps = [];
    if (/sarah/i.test(said)) steps.push({ agent: 'sarah', title: 'Draft the reply', brief: 'Draft an email reply: ' + said });
    if (/bobby/i.test(said)) steps.push({ agent: 'bobby', title: 'Check the ads', brief: 'Check this week\'s ad spend: ' + said });
    if (/tom/i.test(said)) steps.push({ agent: 'tom', title: 'Look at the bug', brief: said });
    if (/command centre|checklist/i.test(said) && !steps.length) steps.push({ agent: 'tom', title: 'Build it', brief: said });
    /* a skill named in the request, found in the catalogue → on the step */
    const want = skills.invoked(said);
    if (want && steps.length) { const row = (system.split('SKILLS THE TEAM HAS')[1] || '').split('\n').find((l) => l.toLowerCase().indexOf('| ' + want.toLowerCase() + ' |') >= 0); if (row) steps[0].skill = row.split(' | ')[0].trim(); }
    const wantAuto = (said.match(/\b(?:run|use|start) the (.+?) automation/i) || [])[1];
    if (wantAuto) { const row = (system.split('AUTOMATIONS THE TEAM HAS')[1] || '').split('\n').find((l) => l.toLowerCase().indexOf('| ' + wantAuto.toLowerCase() + ' |') >= 0); if (row) { if (!steps.length) steps.push({ agent: 'jarvis', title: 'Run ' + wantAuto, brief: said }); steps[0].script = row.split(' | ')[0].trim(); } }
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
    const whole = String((last && last.content) || ''); const rd = said.match(/\bread (https?:\/\/\S+)/i);
    if (rd && !/THE PAGES YOU ASKED FOR/.test(whole)) text = JSON.stringify({ say: '', read: [rd[1]] });
    else if (/THE PAGES YOU ASKED FOR/.test(whole)) text = JSON.stringify({ say: b.model + ' read it: ' + whole.split('THE PAGES YOU ASKED FOR:')[1].replace(/\s+/g, ' ').trim().slice(0, 300), remember: [] });
    else if (/cost|price|how much/i.test(said)) {
      /* answers from the knowledge blocks exactly as a model should: current for now, superseded only for the past */
      const cur = (system.split('WHAT THE TEAM KNOWS (current facts')[1] || '').split(/RULES AND PROCEDURES|SUPERSEDED/)[0];
      const old = (system.split('SUPERSEDED (no longer true')[1] || '').split('\n\n')[0];
      const pick = (blk) => (blk.split('\n').find((l) => /\$\s?\d/.test(l) && /onboarding|service|price|cost/i.test(l)) || '').replace(/^[^|]*\|\s*/, '').trim();
      const past = /last year|before|used to|previously|old price|history/i.test(said);
      const line = past ? pick(old) : pick(cur);
      text = JSON.stringify({ say: b.model + (past ? ' on the past: ' : ' now: ') + (line || 'I have no figure for that.'), remember: [] });
    }
    else text = JSON.stringify({ say: b.model + ' says: ' + said, remember: rem });
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
    memory.section(shared.concat(mine), agent.id),
    '',
    toolsText(),
    'Permissions: ' + agent.permissions + ' (read = answer only; draft = prepare things for approval; approve = act after a yes; auto = act within an agreed policy). Right now every outside action needs a yes.',
    '',
    'Return ONLY a JSON object, no prose around it:',
    '{ "say": "your reply", "remember": [ { "scope": "shared" or "mine", "fact": "one short lasting fact" } ], "read": [] }',
    '· "read": up to three public web addresses you need to look at before you can answer properly (a page they mentioned, a product page, documentation). Leave "say" empty when you ask; you are called again with the pages. Usually an empty list.',
    '· "say": your whole reply. Plain text that reads well out loud and on screen: short paragraphs; no markdown headings, no emoji, no URLs unless they gave one. Lists are fine as short lines when there are several items. Be specific; the point first.',
    '· "remember": only something lasting worth keeping — who people are, preferences, policies, how the business works, a decision taken. "shared" when the whole team should know it (a business fact); "mine" when it only matters to your own work. Never tasks, never passwords, card numbers or codes. Usually an empty list.'
  ].join('\n');
}

/* What the agents can actually use here, said truthfully. */
let browserMod = null;
function browserLib() { if (browserMod === null) { try { browserMod = require('./flow-browser'); } catch (e) { browserMod = false; } } return browserMod || null; }
const mailReady = () => FAKE || !!String(process.env.RESEND_API_KEY || '').trim();
function toolsText() {
  const B = browserLib(); const av = B ? B.available() : { mode: 'reader' };
  return [
    'TOOLS YOU HAVE:',
    '· Web: you can read public web pages — ask for them with "read". ' + (av.mode === 'browser' ? 'In a task you may also browse (click, type, follow links) with "browse"; sign-ins, codes and payments are handed to the person.' : 'You cannot click, sign in or fill forms; only read.'),
    '· Email: ' + (mailReady() ? 'a message you propose is really sent — once, exactly as approved — after the person approves it in the app. Until then it is a draft.' : 'not connected yet; a proposal stays a draft until the connection exists.'),
    '· Nothing else: no inbox, no calendar, no accounts, no calls, no payments. When asked for those, do the thinking part — the draft, the plan, the analysis, the checklist — and say plainly what is not connected. Never claim something was sent, done, checked or changed. Never invent numbers, accounts, results or people.'
  ].join('\n');
}
const cleanReads = (v) => (Array.isArray(v) ? v : []).map((u) => str(u, 500)).filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);

function parseReply(text) {
  const s = String(text || '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j === 'object' && (typeof j.say === 'string' || Array.isArray(j.read))) {
        const rem = (Array.isArray(j.remember) ? j.remember : []).slice(0, 6)
          .map((r) => r && { scope: r.scope === 'shared' ? 'shared' : 'mine', fact: str(r.fact, 200) })
          .filter((r) => r && r.fact && !/\d[\d\s-]{9,}\d/.test(r.fact) && !/(password|passcode|pin code|şifre|parola)/i.test(r.fact));
        return { say: block(j.say, 6000), remember: rem, read: cleanReads(j.read) };
      }
    } catch (e) {}
  }
  /* A model that forgot the shape still said something: keep it. */
  return { say: block(s.replace(/^```(?:json)?|```$/g, ''), 6000), remember: [], read: [] };
}

/* The pages an agent asked for, fetched and handed back as the next turn.
   At most two rounds, so a model that keeps asking still ends. */
async function fetchPages(urls) {
  const B = browserLib(); if (!B) return 'The web is not reachable from here.';
  const out = [];
  for (const u of urls) {
    const r = await B.read(u);
    out.push('--- ' + u + (r.error ? '\n(' + r.error + ')' : '\n' + (r.title ? 'Title: ' + r.title + '\n' : '') + r.text + (r.truncated ? '\n…(cut)' : '')));
  }
  return out.join('\n\n');
}
function pagesTurn(messages, rawReply, pages) {
  return messages.concat([{ role: 'assistant', content: String(rawReply || '').slice(0, 2000) }, { role: 'user', content: 'THE PAGES YOU ASKED FOR:\n\n' + pages.slice(0, 24000) + '\n\nNow answer in the same JSON shape (no more "read").' }]);
}

/* ---------- the routes --------------------------------------------------- */
async function handle(p, req, res, ctx) {
  if (p.indexOf('/api/team') !== 0) return false;
  const json = ctx.json;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };

  if (await handleWork(p, req, res, ctx)) return true;
  if (await memory.handle(p, req, res, ctx, memDeps())) return true;
  if (await skills.handle(p, req, res, ctx, skillDeps())) return true;
  if (await scripts.handle(p, req, res, ctx, scriptDeps())) return true;
  if (await efficiency.handle(p, req, res, ctx, effDeps())) return true;

  if (p === '/api/team' && req.method === 'GET') {
    const [list, provs, know, use, lg] = await Promise.all([agents(ctx), providers(), knowledge(ctx), usage(ctx), ctx.get('team:log')]);
    const counts = {};
    for (const a of list) { const t = await thread(ctx, a.id); counts[a.id] = t.length; }
    const tl = await tasks(ctx), ap = await approvals(ctx);
    const attention = { tasks: tl.filter((t) => !t.seen && (t.status === 'done' || t.status === 'awaiting_approval' || t.status === 'awaiting_info' || t.status === 'failed')).length, approvals: ap.filter((x) => x.status === 'pending').length, running: tl.filter((t) => t.status === 'running' || t.status === 'queued').length };
    const B = browserLib(); const bs = await briefSettings(ctx);
    json(res, 200, { ok: true, agents: list, providers: provs, defaultModel: DEFAULT_MODEL, knowledge: know, usage: use, counts, attention, tasks: tl.slice(-40).reverse(), approvals: ap.filter((x) => x.status === 'pending' || x.status === 'send_failed').slice(-40).reverse(),
      recent: ap.filter((x) => x.status === 'executed').slice(-5).reverse(),
      paused: (await ctx.get('team:paused')) === true, log: (Array.isArray(lg) ? lg : []).slice(-60), templates: TEMPLATE_IDS.map((t) => ({ id: t, name: TEMPLATES[t].name, role: TEMPLATES[t].role })), permissions: PERMISSIONS,
      budget: await budget(ctx), brief: { on: bs.on !== false, at: bs.at || '08:00', lastAt: bs.last ? bs.last.at : 0 }, tools: { email: mailReady(), browser: B ? B.available().mode : 'none' } });
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
async function sayTo(ctx, agentId, said, lang, opts) {
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
    const shared = know.filter((k) => k.scope === 'shared' || k.scope === 'agent:' + a.id).slice(-200);
    const own = [];
    const names = list.filter((x) => !x.archived && x.id !== a.id && x.id !== 'jarvis').map((x) => x.name + ' (' + x.role.toLowerCase() + ')');
    const hist = opts && opts.dry ? [] : await thread(ctx, a.id);
    const turns = hist.slice(-16).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text || '').slice(0, 4000) }));
    /* two user turns in a row confuse some providers: fold them */
    const messages = [];
    for (const t of turns) { const last = messages[messages.length - 1]; if (last && last.role === t.role) last.content += '\n\n' + t.content; else messages.push(t); }
    if (messages.length && messages[0].role !== 'user') messages.shift();
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') last.content += '\n\n' + said; else messages.push({ role: 'user', content: said });
    const bud = await budget(ctx); if (bud.over) return { error: bud.message, status: 429, budget: bud };
    const system = agentSystem(a, ctx.user && (ctx.user.name || ctx.user.email), shared, own, b.lang === 'tr' ? 'tr' : 'en', names);
    let r = await complete({ model: which.model, system, messages, maxTokens: 1600 });
    if (r.error) return { error: r.error, status: r.status === 429 ? 429 : 502 };
    let out = parseReply(r.text); let pagesRead = [];
    for (let round = 0; round < 2 && out.read.length && !out.say; round++) {
      await bumpUsage(ctx, a.id, r.usage);
      const pages = await fetchPages(out.read); pagesRead = pagesRead.concat(out.read);
      await log(ctx, a.id, a.name + ' read ' + out.read.map((u) => u.replace(/^https?:\/\//, '').split('/')[0]).join(', '));
      r = await complete({ model: which.model, system, messages: pagesTurn(messages, r.text, pages), maxTokens: 1600 });
      if (r.error) return { error: r.error, status: r.status === 429 ? 429 : 502 };
      out = parseReply(r.text);
    }
    if (!out.say) out.say = 'I looked, but could not put an answer together. Could you say it another way?';
    const now = Date.now();
    const kb = memory.blocks(shared, a.id);
    try { await memory.record(ctx, { agent: a.id, via: (opts && opts.via) || 'app', model: which.model, said, reply: out.say, knowledge: kb.facts.concat(kb.rules), superseded: kb.old, instructions: a.instructions, pages: pagesRead, thread: turns.length }); } catch (e) {}
    if (opts && opts.dry) return { say: out.say, model: which.model, provider: which.provider, agent: a, read: pagesRead, dry: true };
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
    await bumpUsage(ctx, a.id, r.usage, which.model);
    const use2 = await usage(ctx);
    return { say: out.say, remembered, model: which.model, provider: which.provider, usage: use2[a.id], agent: a, read: pagesRead };
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

/* Per-task metrics for the efficiency review: every model call, token, retry,
   page read, question and hand-over is counted on the task itself. */
async function meter(ctx, id, patch, u, model) {
  await patchTask(ctx, id, (x) => {
    const m = x.metrics || (x.metrics = { calls: 0, in: 0, out: 0, usd: 0, retries: 0, reads: 0, browses: 0, scripts: 0, questions: 0, handoffs: 0, proposals: 0, skillUsed: 0, planCalls: 0, reviewCalls: 0 });
    Object.keys(patch || {}).forEach((k) => { m[k] = (m[k] || 0) + patch[k]; });
    if (u) { m.calls += 1; m.in += u.in || 0; m.out += u.out || 0; const c = costOf(model, u); if (c) m.usd = Math.round((m.usd + c) * 1e6) / 1e6; }
  });
}
/* One task's record, changed in place and saved: the one way a task moves. */
async function patchTask(ctx, id, fn) {
  const list = await tasks(ctx);
  const t = list.find((x) => x.id === id); if (!t) return null;
  fn(t); t.updatedAt = Date.now();
  await saveTasks(ctx, list);
  return t;
}

function stepSystem(agent, owner, shared, mine, lang, task, step, earlier, extra) {
  const base = agentSystem(agent, owner, shared, mine, lang, []);
  return base.replace(/Return ONLY a JSON object[\s\S]*$/, [
    'YOU HAVE BEEN GIVEN A PIECE OF WORK' + (task.by === 'jarvis' ? ' by J.A.R.V.I.S., for ' + str(owner, 60) : ' by ' + str(owner, 60)) + '.',
    'Task: ' + task.title,
    'Your part: ' + step.title,
    'Brief: ' + (step.brief || task.brief || ''),
    earlier.length ? 'What the others have done so far:\n' + earlier.map((e) => '· ' + e.agent + ' — ' + e.title + ':\n' + String(e.result || '').slice(0, 1500)).join('\n') : '',
    extra ? '\n' + extra + '\n' : '',
    '',
    'Do the work in full, here, in words: the draft, the analysis, the list, the plan. Be specific and complete; this is the deliverable, not a description of one.',
    'Anything that would reach the outside world — sending an email or message, posting, paying, changing a live setting — you do NOT do: you propose it, fully written out, as a proposal below, and the person approves it.',
    'If you truly cannot proceed without one fact only the person has, ask one clear question in "question" and leave "result" empty.',
    '',
    'Return ONLY a JSON object, no prose around it:',
    '{ "result": "the finished work, plain text, as long as it needs to be", "question": "", "proposals": [ { "kind": "email|message|post|spend|change|other", "summary": "one line: what would happen", "to": "", "subject": "", "body": "" } ], "remember": [ { "scope": "shared|mine", "fact": "" } ], "read": [], "browse": null, "run": null }',
    '· "result": the work itself. Plain text; short headings and dashes are fine; no markdown symbols like ** or #.',
    '· "proposals": only real outside actions, each complete enough to approve as-is (an email has to, subject and body). Usually empty.',
    '· "remember": lasting facts only; usually empty.',
    '· "read": up to three public web addresses to fetch first; leave "result" empty when you ask and you are called again with the pages.',
    '· "run": { "script": "<automation id>", "inputs": { } } when an automation named in your skill or brief does the routine part (collecting, counting, formatting); leave "result" empty and you are called again with its result. Never invent an id.',
    (browserLib() && browserLib().available().mode === 'browser' ? '· "browse": { "url": "", "goal": "" } when reading is not enough and you must click through a public site (search, compare, follow links); leave "result" empty. Sign-ins, codes and payments are handed to the person.' : '· "browse": not available here (reader only); leave it null.')
  ].join('\n'));
}

function parseStep(text) {
  const s = String(text || '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  let j = null; if (m) { try { j = JSON.parse(m[0]); } catch (e) {} }
  if (!j || typeof j !== 'object') return { result: block(s.replace(/^```(?:json)?|```$/g, ''), 12000), question: '', proposals: [], remember: [], read: [], browse: null, run: null };
  const browse = j.browse && typeof j.browse === 'object' && /^https?:\/\//i.test(String(j.browse.url || '')) ? { url: str(j.browse.url, 500), goal: str(j.browse.goal, 400) || 'Find what the task needs.' } : null;
  const props = (Array.isArray(j.proposals) ? j.proposals : []).slice(0, 6).map((p) => p && {
    kind: APPROVAL_KINDS.indexOf(p.kind) >= 0 ? p.kind : 'other', summary: str(p.summary, 200),
    to: str(p.to, 200), subject: str(p.subject, 200), body: block(p.body, 6000)
  }).filter((p) => p && (p.summary || p.body));
  const rem = (Array.isArray(j.remember) ? j.remember : []).slice(0, 4)
    .map((r) => r && { scope: r.scope === 'shared' ? 'shared' : 'mine', fact: str(r.fact, 200) })
    .filter((r) => r && r.fact && !/\d[\d\s-]{9,}\d/.test(r.fact) && !/(password|passcode|pin code|şifre|parola)/i.test(r.fact));
  const run = j.run && typeof j.run === 'object' && /^sc[0-9a-f]{6,}$/.test(String(j.run.script || '')) ? { script: String(j.run.script), inputs: j.run.inputs && typeof j.run.inputs === 'object' ? j.run.inputs : {} } : null;
  return { result: block(j.result, 12000), question: str(j.question, 400), proposals: props, remember: rem, read: cleanReads(j.read), browse, run };
}

/* J.A.R.V.I.S. decides who does what. */
function planSystem(agents, owner, shared, lang, skillList, scriptList) {
  const cat = skillList && skillList.length ? skills.catalog(skillList, null) : '';
  const auto = scriptList && scriptList.length ? 'AUTOMATIONS THE TEAM HAS (id | name | what it does — tested scripts, no model needed):\n' + scriptList.map((x) => x.id + ' | ' + x.name + ' | ' + str(x.purpose, 140)).join('\n') : '';
  return [
    'You are J.A.R.V.I.S., chief of staff to ' + str(owner, 60) + ', inside The Flow. You have just been asked for a piece of work that the team should do. Plan it.',
    'THE TEAM (id | name | role | instructions):',
    agents.filter((a) => a.id !== 'jarvis' && !a.archived).map((a) => a.id + ' | ' + a.name + ' | ' + a.role + ' | ' + str(a.instructions, 160)).join('\n') || '(nobody yet)',
    shared.length ? 'WHAT THE TEAM KNOWS (current):\n' + shared.map((k) => '· ' + k.text).join('\n') : '',
    cat, auto,
    'Language: ' + (lang === 'tr' ? 'Turkish' : 'English') + '.',
    '',
    'Return ONLY a JSON object:',
    '{ "title": "short title for the task", "say": "one or two spoken sentences: who you are putting on it and what they will deliver", "steps": [ { "agent": "<id from the team>", "title": "what this specialist delivers", "brief": "exactly what to do, with every detail from the request that matters", "skill": "<skill id when one of the team\'s skills fits this step, else empty>", "script": "<automation id when the step is exactly what a tested automation does — it then runs as a script, with no model call>" } ] }',
    '· One to ' + MAX_STEPS + ' steps, in the order they should run; a later step can build on the earlier ones. Each step goes to the one specialist whose role fits. Do not invent agents.',
    cat ? '· When a skill\'s purpose and "when" fit a step, name it in "skill" (its id) so the specialist follows the taught procedure; when the person names a skill, use that one. Never invent skills.' : '',
    auto ? '· When an automation does exactly what a step needs (a routine collection, calculation or report), name it in "script" instead of asking a specialist: it is cheaper and more consistent. Never invent automations.' : '',
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
    .map((st) => st && (ids.has(String(st.agent)) || /^sc[0-9a-f]{6,}$/.test(String(st.script || ''))) ? Object.assign({ agent: ids.has(String(st.agent)) ? String(st.agent) : 'jarvis', title: str(st.title, 140) || 'Work', brief: block(st.brief, 3000) }, /^sk[0-9a-f]{6,}$/.test(String(st.skill || '')) ? { skill: String(st.skill) } : {}, /^sc[0-9a-f]{6,}$/.test(String(st.script || '')) ? { script: String(st.script) } : {}) : null)
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
    /* a step that is a tested automation: the script runs, no model is asked */
    if (st.script) {
      await patchTask(ctx, id, (x) => { x.steps[i].status = 'running'; x.steps[i].startedAt = Date.now(); x.steps[i].attempts = (x.steps[i].attempts || 0) + 1; });
      const sc = (await scripts.all(ctx)).find((z) => z.id === st.script);
      if (!sc || sc.status !== 'active') { await patchTask(ctx, id, (x) => { x.steps[i].status = 'failed'; x.steps[i].error = sc ? 'The automation is ' + sc.status + '.' : 'No such automation.'; x.status = 'failed'; x.error = x.steps[i].title + ': ' + x.steps[i].error; }); await notify(uid, ctx, t, 'failed'); return; }
      await log(ctx, 'team', 'Running the automation "' + sc.name + '" v' + sc.version + ' for "' + st.title + '" — no model call.');
      const run = await scripts.startRun(ctx, scriptDeps(), sc, { uid, trigger: 'task ' + id, inputs: st.inputs || {} });
      if (run.status === 'awaiting_approval') { await patchTask(ctx, id, (x) => { x.steps[i].status = 'queued'; x.steps[i].run = { id: run.id, script: sc.id, name: sc.name, version: sc.version, status: run.status }; x.status = 'awaiting_approval'; x.seen = false; }); await notify(uid, ctx, t, 'approval'); return; }
      const okRun = run.status === 'ok' || run.status === 'partial';
      await patchTask(ctx, id, (x) => { x.steps[i].run = { id: run.id, script: sc.id, name: sc.name, version: sc.version, status: run.status, ms: run.metrics && run.metrics.ms, items: run.metrics && run.metrics.items, modelCalls: run.metrics && run.metrics.modelCalls }; if (okRun) { x.steps[i].status = 'done'; x.steps[i].result = (run.output || '(no output)') + (run.status === 'partial' ? '\n\nPartly done: ' + (run.error || '') : ''); x.steps[i].doneAt = Date.now(); x.steps[i].model = 'script'; } else { x.steps[i].status = 'failed'; x.steps[i].error = run.error || 'The automation did not finish.'; x.status = 'failed'; x.error = x.steps[i].title + ': ' + x.steps[i].error; } });
      if (!okRun) { await notify(uid, ctx, t, 'failed'); return; }
      await log(ctx, 'team', '"' + sc.name + '" finished for "' + st.title + '": ' + (run.metrics ? run.metrics.items + ' items in ' + run.metrics.ms + ' ms' : 'done') + '.');
      continue;
    }
    const a = list.find((x) => x.id === st.agent);
    if (!a || a.archived) { await patchTask(ctx, id, (x) => { x.steps[i].status = 'failed'; x.steps[i].error = 'No such agent any more.'; x.status = 'failed'; x.error = (x.steps[i].title) + ': the agent is gone.'; }); return; }
    const which = await resolveModel(a.model);
    if (!which) { await patchTask(ctx, id, (x) => { x.status = 'failed'; x.error = a.name + ' is set to ' + a.model + ' and that provider has no key here.'; }); await notify(uid, ctx, t, 'failed'); return; }
    await patchTask(ctx, id, (x) => { x.steps[i].status = 'running'; x.steps[i].startedAt = Date.now(); x.steps[i].attempts = (x.steps[i].attempts || 0) + 1; });
    const know = await knowledge(ctx);
    const shared = know.filter((k) => k.scope === 'shared' || k.scope === 'agent:' + a.id).slice(-200), own = [];
    const earlier = t.steps.slice(0, i).filter((s) => s.status === 'done').map((s) => ({ agent: (list.find((x) => x.id === s.agent) || {}).name || s.agent, title: s.title, result: s.result }));
    const bud = await budget(ctx);
    if (bud.over) { await patchTask(ctx, id, (x) => { x.steps[i].status = 'queued'; x.status = 'failed'; x.error = bud.message; }); await notify(uid, ctx, t, 'failed'); return; }
    /* a skill for this step: named by the plan or the person, or matched on the request */
    let skillBlock = '';
    if (!st.skillChecked) {
      let pick = null; try { pick = await skills.forStep(ctx, skillDeps(), a, st, t, know); } catch (e) { pick = null; }
      const metaS = pick ? pick.meta : null;
      await patchTask(ctx, id, (x) => { x.steps[i].skillChecked = true; if (metaS) x.steps[i].skill = metaS; else delete x.steps[i].skill; });
      if (pick) { skillBlock = pick.block; await log(ctx, a.id, a.name + ' is ' + pick.log + ' for "' + st.title + '".'); if (metaS.id && !metaS.blocked) await skills.recordRun(ctx, metaS.id, { kind: 'task', task: id, step: st.id, agent: a.id, version: metaS.version, how: metaS.how }); }
      st.skill = metaS;
    }
    else if (st.skill && !st.skill.missing) { try { const sk = (await skills.all(ctx)).find((s) => s.id === st.skill.id); if (sk && !st.skill.blocked) skillBlock = skills.text(sk, know, sk.scripts.length ? await scripts.all(ctx) : []); else if (sk && st.skill.blocked) skillBlock = 'SKILL REQUESTED BUT NOT USABLE: "' + sk.name + '" is ' + st.skill.blocked + '. Say so in your result and do the work without it.'; } catch (e) {} }
    else if (st.skill && st.skill.missing) skillBlock = 'SKILL REQUESTED BUT NOT FOUND: the person asked for a skill called "' + st.skill.missing + '", and no skill with that name exists. Say so plainly in your result, then do the work as best you can without it.';
    const system = stepSystem(a, owner, shared, own, t.lang, t, st, earlier, skillBlock);
    const user = (t.answer ? 'The person answered your question: "' + t.answer + '"\n\n' : '') + (t.handoff && t.handoff.found ? 'What you found before stopping at ' + t.handoff.url + ':\n' + t.handoff.found + '\n\n' : '') + 'Do your part now.';
    if (fakeDelay) await new Promise((r) => setTimeout(r, fakeDelay));
    let messages = [{ role: 'user', content: user }];
    let r = await complete({ model: which.model, system, messages, maxTokens: 3000, timeoutMs: 90000 });
    /* the web: pages asked for, or a browsing run, then the model again */
    let out = r.error ? null : parseStep(r.text);
    for (let round = 0; round < 2 && out && !out.result && !out.question && (out.read.length || out.browse || out.run); round++) {
      await bumpUsage(ctx, a.id, r.usage, which.model); await meter(ctx, id, { reads: out.read.length, browses: out.browse ? 1 : 0, scripts: out.run ? 1 : 0 }, r.usage, which.model);
      let pages = '';
      if (out.run) {
        const sc = (await scripts.all(ctx)).find((z) => z.id === out.run.script && z.status === 'active');
        if (!sc) pages += 'AUTOMATION ' + out.run.script + ' does not exist or is not active. Do the work yourself and say so.';
        else {
          await log(ctx, a.id, a.name + ' is running the automation "' + sc.name + '" v' + sc.version + ' (script, no model).');
          const run = await scripts.startRun(ctx, scriptDeps(), sc, { uid, trigger: 'task ' + id + ' by ' + a.id, inputs: out.run.inputs });
          await patchTask(ctx, id, (x) => { x.steps[i].run = { id: run.id, script: sc.id, name: sc.name, version: sc.version, status: run.status, ms: run.metrics && run.metrics.ms, items: run.metrics && run.metrics.items }; });
          pages += 'AUTOMATION "' + sc.name + '" v' + sc.version + ' ran: status ' + run.status + (run.error ? ' — ' + run.error : '') + (run.status === 'awaiting_approval' ? ' (its email batch waits for the person\'s yes; nothing was sent)' : '') + '\nResult:\n' + String(run.output || '(no output)').slice(0, 8000);
        }
      }
      if (out.read.length) { pages = await fetchPages(out.read); await log(ctx, a.id, a.name + ' read ' + out.read.map((u) => u.replace(/^https?:\/\//, '').split('/')[0]).join(', ')); }
      if (out.browse) {
        const B = browserLib(); const av = B ? B.available() : { mode: 'reader' };
        if (av.mode !== 'browser') pages += (pages ? '\n\n' : '') + 'BROWSING is not available here (reader only). Use "read" for public pages, or ask the person.';
        else {
          await patchTask(ctx, id, (x) => { x.steps[i].browsing = out.browse.url; });
          await log(ctx, a.id, a.name + ' is browsing ' + out.browse.url.replace(/^https?:\/\//, '').split('/')[0]);
          const br = await B.browse({ url: out.browse.url, goal: out.browse.goal, model: which.model, agentName: a.name, maxSteps: 8 }, { complete, profileDir: profileDirFor(uid, a.id), fakeAction: FAKE ? fakeBrowse : null });
          if (br.shots && br.shots.length) await saveShots(ctx, id, br.shots, a.id);
          await patchTask(ctx, id, (x) => { delete x.steps[i].browsing; x.shots = (x.shots || 0) + ((br.shots || []).length); });
          if (br.handoff) {
            await meter(ctx, id, { handoffs: 1 });
            const why = br.why || 'This page needs you.';
            await patchTask(ctx, id, (x) => { x.steps[i].status = 'queued'; x.status = 'awaiting_info'; x.question = why + ' (Stopped at ' + br.url + '.) When you have done it, or if you can tell me what I need another way, answer here and I carry on.'; x.asker = a.id; x.answer = ''; x.seen = false; x.handoff = { url: br.url, why, found: br.found || '', at: Date.now() }; });
            await log(ctx, a.id, a.name + ' needs you at ' + br.url.replace(/^https?:\/\//, '').split('/')[0]);
            await notify(uid, ctx, t, 'question');
            return;
          }
          pages += (pages ? '\n\n' : '') + 'BROWSING ' + out.browse.url + (br.error ? ' failed: ' + br.error : '') + '\nWhat was found:\n' + String(br.found || '').slice(0, 8000) + (br.log && br.log.length ? '\nSteps: ' + br.log.join(' · ').slice(0, 1200) : '');
        }
      }
      messages = pagesTurn(messages, r.text, pages).map((m, k, arr) => k === arr.length - 1 ? { role: 'user', content: m.content.replace('Now answer in the same JSON shape (no more "read").', 'Now do your part in the same JSON shape (no more "read", "browse" or "run").') } : m);
      r = await complete({ model: which.model, system, messages, maxTokens: 3000, timeoutMs: 90000 });
      out = r.error ? null : parseStep(r.text);
    }
    if (r.error) {
      const attempts = (st.attempts || 0) + 1;
      if (attempts < MAX_ATTEMPTS && r.status !== 401 && r.status !== 403) {
        await patchTask(ctx, id, (x) => { x.steps[i].status = 'queued'; x.steps[i].error = r.error; }); await meter(ctx, id, { retries: 1 });
        await new Promise((res) => setTimeout(res, fakeDelay ? 50 : 4000 * attempts));
        i--; continue;
      }
      await patchTask(ctx, id, (x) => { x.steps[i].status = 'failed'; x.steps[i].error = r.error; x.status = 'failed'; x.error = a.name + ' could not finish "' + x.steps[i].title + '": ' + r.error; });
      await log(ctx, a.id, a.name + ' could not finish: ' + st.title);
      await notify(uid, ctx, t, 'failed');
      return;
    }
    await bumpUsage(ctx, a.id, r.usage, which.model); await meter(ctx, id, { skillUsed: st.skill && st.skill.id && !st.skill.blocked ? 1 : 0 }, r.usage, which.model);
    if (out.question && !out.result) {
      await meter(ctx, id, { questions: 1 });
      await patchTask(ctx, id, (x) => { x.steps[i].status = 'queued'; x.status = 'awaiting_info'; x.question = out.question; x.asker = a.id; x.answer = ''; x.seen = false; delete x.handoff; });
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
      await saveApprovals(ctx, ap); await meter(ctx, id, { proposals: newApprovals.length });
    }
    if (out.remember.length) {
      const k2 = await knowledge(ctx); let n = 0;
      for (const rm of out.remember) { if (k2.some((k) => k.text.toLowerCase() === rm.fact.toLowerCase())) continue; k2.push({ id: 'k' + newId(), text: rm.fact, scope: rm.scope === 'shared' ? 'shared' : 'agent:' + a.id, source: 'agent:' + a.id, at: Date.now(), updated: Date.now() }); n++; }
      if (n) await ctx.set('team:knowledge', k2.slice(-400));
    }
    try { const kb = memory.blocks(shared, a.id); await memory.record(ctx, { agent: a.id, via: 'task:' + id, model: which.model, said: st.title + ' — ' + (st.brief || ''), reply: out.result, knowledge: kb.facts.concat(kb.rules), superseded: kb.old, instructions: a.instructions, pages: out.read || [] }); } catch (e) {}
    await patchTask(ctx, id, (x) => { x.steps[i].status = 'done'; x.steps[i].result = out.result; x.steps[i].model = which.model; x.steps[i].doneAt = Date.now(); x.steps[i].approvals = newApprovals; x.answer = ''; x.question = ''; delete x.handoff; });
    await log(ctx, a.id, a.name + ' finished: ' + st.title + (newApprovals.length ? ' (' + newApprovals.length + ' for approval)' : ''));
    if ((await ctx.get('team:paused')) === true) return;
  }
  /* every step done: the result */
  t = (await tasks(ctx)).find((x) => x.id === id); if (!t || t.status !== 'running') return;
  let result = '';
  const done = t.steps.filter((s) => s.status === 'done');
  const effS = await effSettings(ctx);
  if (done.length === 1 && (t.by !== 'jarvis' || effS.skipHandoverSingle)) result = done[0].result;
  else {
    const j = list.find((x) => x.id === 'jarvis');
    const which = j && await resolveModel(j.model);
    if (which) {
      const sys = 'You are J.A.R.V.I.S., chief of staff to ' + str(owner, 60) + '. The specialists have finished the task "' + t.title + '". Review their work and hand it over: a short, plain summary of what was done and what needs the person\'s yes (approvals are listed separately in the app), then each specialist\'s deliverable in full under a heading with their name. Plain text, no markdown symbols. Be exact; invent nothing. ' + (t.lang === 'tr' ? 'Write in Turkish.' : 'Write in English.');
      const body = done.map((s) => ((list.find((x) => x.id === s.agent) || {}).name || s.agent) + ' — ' + s.title + ':\n' + s.result).join('\n\n');
      const r = await complete({ model: which.model, system: sys, messages: [{ role: 'user', content: body }], maxTokens: 3500, timeoutMs: 90000 });
      if (!r.error) { result = block(r.text, 16000); await bumpUsage(ctx, 'jarvis', r.usage, which.model); await meter(ctx, id, { reviewCalls: 1 }, r.usage, which.model); }
    }
    if (!result) result = done.map((s) => ((list.find((x) => x.id === s.agent) || {}).name || s.agent) + ' — ' + s.title + '\n' + s.result).join('\n\n');
  }
  const pending = (await approvals(ctx)).filter((x) => x.task === id && x.status === 'pending').length;
  t = await patchTask(ctx, id, (x) => { x.result = result; x.status = pending ? 'awaiting_approval' : 'done'; x.doneAt = Date.now(); x.seen = false; if (x.metrics) x.metrics.ms = x.doneAt - (x.startedAt || x.createdAt); });
  await log(ctx, t.agent, '"' + t.title + '" is ' + (pending ? 'ready — ' + pending + ' approval' + (pending === 1 ? '' : 's') + ' waiting' : 'done') + '.');
  await notify(uid, ctx, t, pending ? 'approval' : 'done');
}
/* ---------- what it costs ------------------------------------------------- *
 * List prices, USD per million tokens (in, out), as published in 2026. An
 * estimate, said so on screen; a model not in the table counts tokens only.
 * The month's total is kept as it happens (team:usage:m:<yyyy-mm>), so the
 * limit is checked with one read, not thirty. */
const PRICES = [
  [/^claude-opus/, 15, 75], [/^claude-sonnet/, 3, 15], [/^claude-haiku/, 1, 5],
  [/^gpt-5-mini/, 0.25, 2], [/^gpt-5-nano/, 0.05, 0.4], [/^gpt-5/, 1.25, 10], [/^gpt-4\.1-mini/, 0.4, 1.6], [/^gpt-4\.1/, 2, 8], [/^gpt-4o-mini/, 0.15, 0.6], [/^gpt-4o/, 2.5, 10], [/^o[1-9]/, 2, 8],
  [/^grok-4/, 3, 15], [/^grok-3-mini/, 0.3, 0.5], [/^grok-3/, 3, 15], [/^grok/, 3, 15],
  [/^deepseek-reasoner/, 0.55, 2.19], [/^deepseek/, 0.27, 1.1]
];
function costOf(model, u) {
  const p = PRICES.find((row) => row[0].test(String(model || '')));
  if (!p || !u) return null;
  return ((u.in || 0) * p[1] + (u.out || 0) * p[2]) / 1e6;
}
const monthKey = (d) => 'team:usage:m:' + (d || new Date()).toISOString().slice(0, 7);
async function monthUsage(ctx) { const v = await ctx.get(monthKey()); return v && typeof v === 'object' ? v : {}; }
async function bumpUsage(ctx, agentId, u, model) {
  const use = await usage(ctx); const m = use[agentId] || { calls: 0, in: 0, out: 0 };
  use[agentId] = { calls: m.calls + 1, in: m.in + ((u && u.in) || 0), out: m.out + ((u && u.out) || 0) };
  await ctx.set(dayKey(), use);
  const mo = await monthUsage(ctx); const mm = mo[agentId] || { calls: 0, in: 0, out: 0, usd: 0, unpriced: 0 };
  const c = costOf(model, u);
  mo[agentId] = { calls: mm.calls + 1, in: mm.in + ((u && u.in) || 0), out: mm.out + ((u && u.out) || 0), usd: Math.round(((mm.usd || 0) + (c || 0)) * 1e6) / 1e6, unpriced: (mm.unpriced || 0) + (c == null && u ? 1 : 0) };
  await ctx.set(monthKey(), mo);
}
/* Orchestration settings the efficiency review may change (versioned there). */
async function effSettings(ctx) { const v = await ctx.get('team:eff:settings'); return Object.assign({ skipHandoverSingle: false, maxReadRounds: 2 }, v && typeof v === 'object' ? v : {}); }
async function limits(ctx) { const v = await ctx.get('team:limits'); return Object.assign({ monthlyUsd: 0 }, v && typeof v === 'object' ? v : {}); }
/* The month so far against the limit (0 = none). */
async function budget(ctx) {
  const [mo, lim] = await Promise.all([monthUsage(ctx), limits(ctx)]);
  const usd = Object.keys(mo).reduce((s, k) => s + ((mo[k] && mo[k].usd) || 0), 0);
  const over = lim.monthlyUsd > 0 && usd >= lim.monthlyUsd;
  return { usd: Math.round(usd * 100) / 100, limit: lim.monthlyUsd, over, message: over ? 'This month\'s budget of $' + lim.monthlyUsd + ' is used up ($' + (Math.round(usd * 100) / 100) + ' so far, estimated). Raise it under Usage in the command centre to carry on.' : '' };
}

/* ---------- what an agent saw ---------------------------------------------- */
async function saveShots(ctx, taskId, shots, agentId) {
  const v = await ctx.get('team:shots:' + taskId); const list = Array.isArray(v) ? v : [];
  for (const s of shots) list.push({ at: s.at, url: str(s.url, 300), title: str(s.title, 120), agent: agentId, img: String(s.img || '').slice(0, 120000) });
  await ctx.set('team:shots:' + taskId, list.slice(-8));
}
function profileDirFor(uid, agentId) {
  const path = require('path'), fs = require('fs');
  const base = process.env.FLOW_BROWSER_DIR || path.join(process.env.DATA_DIR || __dirname, 'team-browser');
  const dir = path.join(base, String(uid).replace(/[^\w.-]/g, '_'), String(agentId).replace(/[^\w.-]/g, '_'));
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}
/* Tests: the browsing decision without a model. A page with a password
   field hands off (flow-browser sees that itself); otherwise it is done
   with the page's text. */
function fakeBrowse(L) { return { action: 'done', found: 'Seen ' + L.title + ': ' + L.text.slice(0, 300) }; }
let channelsTo = null;   /* (uid, text, opts) => Promise — set by start() */
async function notify(uid, ctx, t0, what) {
  /* the freshest record: the caller's copy may predate the last save */
  const t = (await tasks(ctx)).find((x) => x.id === t0.id) || t0;
  if (what === 'done' && !(t.from && t.from.script)) { try { await scripts.onEvent(ctx, scriptDeps(), uid, 'task.done', { title: t.title }); } catch (e) {} }
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
  usersFn = deps.users;
  usersKey = deps.usersKey || '';
  rawGet = async (k) => { const v = await deps.raw.get(k); if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } };
  /* the morning briefing: a minute tick, in each person's own clock */
  if (!briefTimer) { briefTimer = setInterval(() => { tickBriefings().catch(() => {}); tickScripts().catch(() => {}); }, 60 * 1000); if (briefTimer.unref) briefTimer.unref(); }
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
        try { ctx.user = await userOf(uid); await scripts.resumeAll(ctx, scriptDeps()); } catch (e) {}
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
  const bud = await budget(ctx); if (bud.over) return { error: bud.message, status: 429 };
  const know = await knowledge(ctx);
  let skillList = [], scriptList = []; try { skillList = (await skills.all(ctx)).filter((s) => s.status === 'active'); scriptList = (await scripts.all(ctx)).filter((s) => s.status === 'active'); } catch (e) {}
  const r = await complete({ model: which.model, system: planSystem(list, ctx.user && (ctx.user.name || ctx.user.email), memory.current(know).filter((k) => k.scope === 'shared').slice(-60), lang, skillList, scriptList), messages: [{ role: 'user', content: text }], maxTokens: 1800, timeoutMs: 60000 });
  if (r.error) return { error: r.error, status: r.status === 429 ? 429 : 502 };
  await bumpUsage(ctx, 'jarvis', r.usage, which.model);
  const plan = parsePlan(r.text, list);
  if (!plan) return { error: 'The plan came back in a shape the app could not read. Try again.', status: 502 };
  if (!plan.steps.length) return { task: null, say: plan.say || 'That needs none of the team; I can do it myself.' };
  try {
    const t = await newTask(ctx, uid, { title: plan.title || str(text, 80), brief: text, agent: 'jarvis', by: 'jarvis', lang, steps: plan.steps, callMe: !!(opts && opts.callMe), via: (opts && opts.via) || '' });
    await meter(ctx, t.id, { planCalls: 1 }, r.usage, which.model);
    return { task: t, say: plan.say };
  } catch (e) { return { error: e.message, status: 400 }; }
}

/* A yes or a no to one approval — once. */
async function decide(ctx, id, decision, detail) {
  const ap = await approvals(ctx);
  const item = ap.find((x) => x.id === id);
  if (!item) return { error: 'No such approval.', status: 404 };
  if (decision !== 'approve' && decision !== 'reject') return { error: 'approve or reject.', status: 400 };
  const retry = item.status === 'send_failed' && decision === 'approve';
  if (item.status !== 'pending' && !retry) return { approval: item, already: true };
  if (detail && typeof detail === 'object' && !retry) { item.detail = { to: str(detail.to, 200), subject: str(detail.subject, 200), body: block(detail.body, 6000) }; item.edited = true; }
  item.decidedAt = item.decidedAt || Date.now();
  const list = await agents(ctx); const a = list.find((x) => x.id === item.agent) || { name: 'An agent', permissions: 'draft' };
  if (item.kind === 'batch') {
    /* an automation's email batch: the yes releases the script to send, once per recipient; the no cancels the run */
    item.status = decision === 'approve' ? 'executed' : 'rejected'; item.executedAt = decision === 'approve' ? Date.now() : undefined;
    item.note = decision === 'approve' ? 'Approved: the automation sends them now, once each; the run shows what went.' : 'Declined: nothing was sent and the run was cancelled.';
    await saveApprovals(ctx, ap);
    await log(ctx, 'team', (decision === 'approve' ? 'Approved: ' : 'Declined: ') + item.summary);
    let run = null; try { run = await scripts.onApproval(ctx, scriptDeps(), item, decision); } catch (e) {}
    if (run && decision === 'approve') { item.note = run.status === 'ok' ? 'Sent. ' + ((run.steps || []).find((st) => st.op === 'email.batch') || {}).note : run.status === 'partial' ? 'Partly sent: ' + (run.error || '') : 'Approved, but the run ended ' + run.status + (run.error ? ': ' + run.error : ''); await saveApprovals(ctx, ap); }
    /* a task step that was waiting on this batch carries on */
    const tl = await tasks(ctx); const waiting = tl.find((t) => t.status === 'awaiting_approval' && (t.steps || []).some((st) => st.run && st.run.id === item.run));
    if (waiting) { await patchTask(ctx, waiting.id, (x) => { const st = x.steps.find((y) => y.run && y.run.id === item.run); if (run && (run.status === 'ok' || run.status === 'partial') && st) { st.status = 'done'; st.result = run.output || ''; st.doneAt = Date.now(); st.model = 'script'; st.run.status = run.status; x.status = 'queued'; } else if (st) { st.status = 'failed'; st.error = run ? (run.error || run.status) : 'declined'; x.status = 'failed'; x.error = st.title + ': ' + st.error; } }); if (run && (run.status === 'ok' || run.status === 'partial')) kick(ctx.user && ctx.user.id, ctx); }
    return { approval: item, agent: 'Automation', run };
  }
  if (decision === 'reject') { item.status = 'rejected'; }
  else if (item.kind === 'email' && mailReady() && a.permissions !== 'read' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.detail && item.detail.to || ''))) {
    /* The one tool that exists: it goes now, once. 'sending' is saved first
       so a second click, or a restart mid-send, cannot send it twice. */
    item.status = 'sending'; item.note = '';
    await saveApprovals(ctx, ap);
    const owner = ctx.user && (ctx.user.name || ctx.user.email);
    const sent = await sendEmail({ to: item.detail.to, subject: item.detail.subject || '(no subject)', text: item.detail.body || '', agent: a.name, owner, replyTo: ctx.user && ctx.user.email, key: item.key });
    if (sent.ok) { item.status = 'executed'; item.executedAt = Date.now(); item.ref = sent.id || ''; item.note = 'Sent to ' + item.detail.to + ' from ' + sent.from + '.'; }
    else { item.status = 'send_failed'; item.error = sent.error || 'The email could not be sent.'; item.note = item.error + ' Nothing went out. Approve again to retry.'; }
  } else {
    item.status = 'awaiting_tool';
    item.note = a.permissions === 'read' ? 'Approved, but ' + a.name + ' is read-only: nothing is sent on their behalf. Raise their permissions to let it go.' : item.kind === 'email' ? 'Approved. Email is not connected yet (RESEND_API_KEY), so it has not been sent; it will go once, as approved, when the connection exists.' : 'Approved. Nothing is connected to carry this out yet, so it has not happened; it will go once, as approved, when the connection exists.';
  }
  await saveApprovals(ctx, ap);
  await log(ctx, item.agent, (decision === 'approve' ? (item.status === 'executed' ? 'Sent: ' : item.status === 'send_failed' ? 'Could not send: ' : 'Approved: ') : 'Declined: ') + item.summary + (item.status === 'awaiting_tool' ? ' (awaiting a connection)' : ''));
  const stillPending = ap.some((x) => x.task === item.task && x.status === 'pending');
  if (!stillPending) await patchTask(ctx, item.task, (x) => { if (x.status === 'awaiting_approval') x.status = 'done'; });
  if (item.status === 'executed') { try { await scripts.onEvent(ctx, scriptDeps(), ctx.user && ctx.user.id, 'approval.executed', { title: item.summary }); } catch (e) {} }
  return { approval: item, agent: a.name };
}

/* ---------- the email tool ----------------------------------------------- *
 * The same provider The Flow uses for password resets (RESEND_API_KEY), from
 * the verified address, in the agent's name and the owner's; replies go to
 * the owner. The footer says what it is: an assistant's message, approved by
 * a person. In the test stand-in nothing leaves; the call is recorded. */
const mailSent = [];
async function sendEmail(m) {
  const fromAddr = (process.env.MAIL_FROM || '').trim().replace(/^.*<|>.*$/g, '') || 'mail@theflow.today';
  const from = str(m.agent, 40) + (m.owner ? ' for ' + str(m.owner, 40) : '') + ' <' + fromAddr + '>';
  const text = String(m.text || '') + '\n\n—\n' + str(m.agent, 40) + ' is an AI assistant working for ' + str(m.owner || 'The Flow', 60) + '. This message was reviewed and approved by them before it was sent. Replies reach them directly.';
  const payload = { from, to: [m.to], subject: str(m.subject, 200), text, headers: { 'X-Entity-Ref-ID': m.key || '' } };
  if (m.replyTo && /^[^\s@]+@[^\s@]+$/.test(m.replyTo)) payload.reply_to = m.replyTo;
  if (FAKE) { mailSent.push(payload); return { ok: true, id: 'fake-' + mailSent.length, from }; }
  try {
    const r = await fetchJSON('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + String(process.env.RESEND_API_KEY || '').trim(), 'content-type': 'application/json', 'Idempotency-Key': String(m.key || '').slice(0, 64) }, body: JSON.stringify(payload) }, 20000);
    if (r.status >= 200 && r.status < 300) return { ok: true, id: r.body && r.body.id, from };
    return { ok: false, error: 'The email provider refused it (' + r.status + (r.body && r.body.message ? ': ' + str(r.body.message, 120) : '') + ').' };
  } catch (e) { return { ok: false, error: 'The email provider could not be reached.' }; }
}

/* =========================================================================
 * Stage 4 — what J.A.R.V.I.S. suggests, the morning briefing, the month's
 * cost, and the honest list of what is connected
 * -------------------------------------------------------------------------
 *   team:suggest     { date, at, items[{ id, title, why, brief, agent, status: open|started|dismissed, task }], skipped[] }
 *   team:brief       { on, at: 'HH:MM', lastDate, last: { at, text } }
 *   team:limits      { monthlyUsd }
 *   team:usage:m:<yyyy-mm>   { <agent>: { calls, in, out, usd, unpriced } }
 *   team:shots:<task>        [{ at, url, title, agent, img }]
 * ====================================================================== */
let extrasMod = null;
function extrasLib() { if (extrasMod === null) { try { extrasMod = require('./flow-extras'); } catch (e) { extrasMod = false; } } return extrasMod || null; }
let channelsLib_ = null;
function channelsLib() { if (channelsLib_ === null) { try { channelsLib_ = require('./flow-channels'); } catch (e) { channelsLib_ = false; } } return channelsLib_ || null; }
let remindLib_ = null;
function localParts(tz, now) {
  if (remindLib_ === null) { try { remindLib_ = require('./flow-remind'); } catch (e) { remindLib_ = false; } }
  if (remindLib_ && remindLib_._internals) return remindLib_._internals.localParts(tz, now);
  const d = now || new Date(); return { date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16), day: (d.getUTCDay() + 6) % 7, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
async function userTz(ctx) { try { const s = await ctx.get('flow:settings'); return (s && s.timezone) || 'Europe/Istanbul'; } catch (e) { return 'Europe/Istanbul'; } }
async function snapshotOf(ctx) {
  const X = extrasLib();
  try { if (X && X._internals && X._internals.buildContext) return String(await X._internals.buildContext({ get: ctx.get })).slice(0, 20000); } catch (e) {}
  return '';
}

/* ---- what he suggests ---------------------------------------------------- *
 * J.A.R.V.I.S. reads the person's own record — this week's rocks, the
 * mission and roles, notes, the journal, spend, habits — and proposes pieces
 * of work the team could take off their plate: a travel command centre for
 * the trip in the notes, a comparison, a follow-up, research. Each must point
 * at something that is really there; nothing is invented. Once a day unless
 * asked for more; what was dismissed is not offered again. */
const SUGGEST_SYSTEM = (owner, agents, know, tasks, skipped, snapshot, lang) => [
  'You are J.A.R.V.I.S., chief of staff to ' + str(owner, 60) + ', inside The Flow. Look at THEIR DATA below and propose three to five pieces of work your team could do for them right now — things that would make their life or business easier this week.',
  'Good suggestions are anchored in the data: a trip or booking mentioned in the notes → a travel command centre (bookings, payments, check-in, host messages, a checklist, kept apart from anything cancelled); a recurring expense → a review; a stalled rock → the preparation that unblocks it; a customer question → a drafted reply; a goal in the mission → a plan or research. Work is done in words here (drafts, plans, research, checklists, comparisons); emails go out only after their yes.',
  'THE TEAM (id | name | role): ' + agents.filter((a) => a.id !== 'jarvis' && !a.archived).map((a) => a.id + ' | ' + a.name + ' | ' + a.role).join('; '),
  know.length ? 'WHAT THE TEAM KNOWS: ' + know.map((k) => k.text).join(' · ') : '',
  tasks.length ? 'ALREADY IN HAND (do not repeat): ' + tasks.map((t) => t.title).join('; ') : '',
  skipped.length ? 'THEY SAID NO TO (do not offer again): ' + skipped.join('; ') : '',
  'Language: ' + (lang === 'tr' ? 'Turkish' : 'English') + '.',
  '',
  'Return ONLY a JSON object:',
  '{ "items": [ { "title": "short, concrete, 3–8 words", "why": "one sentence quoting the thing in their data this comes from", "brief": "the full brief the team would work from: every relevant detail from the data, what to produce, what to keep separate", "agent": "<id of the specialist best placed, or empty for J.A.R.V.I.S. to plan>" } ] }',
  '· Nothing generic ("organise your inbox"). If the data shows nothing worth doing, return fewer items, even one.',
  '',
  snapshot ? '# THEIR DATA\n' + snapshot : '# THEIR DATA\n(nothing recorded yet)'
].filter((x) => x !== '').join('\n');

function parseSuggest(text, agents) {
  const s = String(text || ''); const m = s.match(/\{[\s\S]*\}/);
  let j = null; if (m) { try { j = JSON.parse(m[0]); } catch (e) {} }
  if (!j || !Array.isArray(j.items)) return null;
  const ids = new Set(agents.filter((a) => a.id !== 'jarvis' && !a.archived).map((a) => a.id));
  return j.items.slice(0, 5).map((it) => it && str(it.title, 90) && block(it.brief, 3000) ? { id: 'g' + newId(), title: str(it.title, 90), why: str(it.why, 240), brief: block(it.brief, 3000), agent: ids.has(String(it.agent || '')) ? String(it.agent) : '', status: 'open', at: Date.now() } : null).filter(Boolean);
}
function fakeSuggest(snapshot) {
  const items = [];
  if (/dubai/i.test(snapshot)) items.push({ title: 'Dubai trip command centre', why: 'Your notes mention the Dubai apartment booking.', brief: 'Build a travel command centre for the Dubai stay: active booking vs the cancelled one, payments due, check-in and access, host messages, a pre-arrival checklist.', agent: '' });
  items.push({ title: 'Review this month\'s spend', why: 'There are expenses recorded this month.', brief: 'Go through this month\'s expenses, group them, flag anything unusual or recurring, and propose where to save.', agent: 'finance' });
  items.push({ title: 'Prepare Monday\'s priorities', why: 'This week\'s rocks are on the board.', brief: 'Turn the week\'s rocks into a prepared Monday: what needs doing first, what can be dropped, what to delegate.', agent: '' });
  return JSON.stringify({ items });
}
async function suggestions(ctx, opts) {
  const v = await ctx.get('team:suggest'); const rec = v && typeof v === 'object' ? v : { items: [], skipped: [] };
  rec.items = Array.isArray(rec.items) ? rec.items : []; rec.skipped = Array.isArray(rec.skipped) ? rec.skipped : [];
  const L = localParts(await userTz(ctx), new Date());
  const fresh = opts && opts.fresh;
  if (!fresh && rec.date === L.date && rec.items.length) return rec;
  const list = await agents(ctx);
  const j = list.find((a) => a.id === 'jarvis');
  const which = await resolveModel(j.model);
  if (!which) return Object.assign(rec, { error: 'J.A.R.V.I.S. has no model available here yet.' });
  const bud = await budget(ctx); if (bud.over) return Object.assign(rec, { error: bud.message });
  const know = memory.current(await knowledge(ctx)).filter((k) => k.scope === 'shared').slice(-40);
  const tl = (await tasks(ctx)).filter((t) => !/^(cancelled|failed)$/.test(t.status)).slice(-12);
  const snapshot = await snapshotOf(ctx);
  const open = rec.items.filter((it) => it.status === 'open').map((it) => it.title);
  const r = FAKE ? { text: fakeSuggest(snapshot), usage: { in: 1, out: 1 } } : await complete({ model: which.model, system: SUGGEST_SYSTEM(ctx.user && (ctx.user.name || ctx.user.email), list, know, tl, rec.skipped.concat(fresh ? open : []), snapshot, (opts && opts.lang) || 'en'), messages: [{ role: 'user', content: 'What could the team take off my plate' + (fresh ? ' — other ideas than before' : '') + '?' }], maxTokens: 1800, timeoutMs: 60000 });
  if (r.error) return Object.assign(rec, { error: r.error });
  await bumpUsage(ctx, 'jarvis', r.usage, which.model);
  const items = parseSuggest(r.text, list);
  if (!items) return Object.assign(rec, { error: 'The suggestions came back in a shape the app could not read.' });
  /* keep what was started today; replace the open ones */
  const keep = rec.date === L.date ? rec.items.filter((it) => it.status === 'started') : [];
  const next = { date: L.date, at: Date.now(), items: keep.concat(items.filter((it) => !rec.skipped.some((s) => s.toLowerCase() === it.title.toLowerCase()))).slice(0, 8), skipped: rec.skipped.slice(-60) };
  await ctx.set('team:suggest', next);
  if (items.length) await log(ctx, 'jarvis', 'J.A.R.V.I.S. suggested: ' + items.map((it) => it.title).join('; '));
  return next;
}
async function suggestAct(ctx, uid, id, op, lang) {
  const v = await ctx.get('team:suggest'); const rec = v && typeof v === 'object' ? v : { items: [], skipped: [] };
  const it = (rec.items || []).find((x) => x.id === id); if (!it) return { error: 'No such suggestion.', status: 404 };
  if (op === 'dismiss') { it.status = 'dismissed'; rec.skipped = (rec.skipped || []).concat([it.title]).slice(-60); await ctx.set('team:suggest', rec); return { ok: true, item: it }; }
  if (op !== 'start') return { error: 'start or dismiss.', status: 400 };
  if (it.status === 'started' && it.task) return { ok: true, item: it, already: true };
  let r;
  if (it.agent) {
    const list = await agents(ctx); const a = list.find((x) => x.id === it.agent && !x.archived);
    if (a) { try { const t = await newTask(ctx, uid, { title: it.title, brief: it.brief, agent: a.id, by: 'jarvis', lang: lang || 'en', steps: [{ agent: a.id, title: it.title, brief: it.brief }] }); r = { task: t, say: a.name + ' is on it.' }; } catch (e) { r = { error: e.message, status: 400 }; } }
  }
  if (!r) r = await delegateText(ctx, uid, it.brief, lang || 'en', { via: 'suggestion' });
  if (r.error) return r;
  if (!r.task) return { error: 'J.A.R.V.I.S. found nobody on the team for it: ' + (r.say || ''), status: 409 };
  it.status = 'started'; it.task = r.task ? r.task.id : ''; it.startedAt = Date.now();
  await ctx.set('team:suggest', rec);
  return { ok: true, item: it, task: r.task, say: r.say };
}

/* ---- the morning briefing ------------------------------------------------ *
 * At the hour they chose (08:00 by default), in their own clock: today's
 * rocks, what the team has waiting for them, and what J.A.R.V.I.S. suggests.
 * It goes to every linked channel and as a push; the text is kept so the
 * command centre can show this morning's. */
async function briefSettings(ctx) { const v = await ctx.get('team:brief'); return Object.assign({ on: true, at: '08:00', lastDate: '', last: null }, v && typeof v === 'object' ? v : {}); }
function weekIdOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1)); return dt.getUTCFullYear() + '-W' + String(Math.ceil(((dt - y0) / 86400000 + 1) / 7)).padStart(2, '0');
}
async function briefingText(ctx, L, lang) {
  const owner = ctx.user && (ctx.user.name || '');
  const tr = lang === 'tr';
  const lines = [(tr ? 'Günaydın' : 'Good morning') + (owner ? ', ' + String(owner).split(/\s+/)[0] : '') + '. ' + new Date(L.date + 'T12:00:00Z').toLocaleDateString(tr ? 'tr-TR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) + '.'];
  try {
    const compass = await ctx.get('ld_compass');
    const rocks = (((compass || {}).rocks || {})[weekIdOf(L.date)] || []).filter((r) => r && r.day === L.day && !r.done);
    if (rocks.length) lines.push('', (tr ? 'Bugün' : 'Today') + ':', rocks.slice(0, 8).map((r) => '· ' + (r.time ? r.time + ' ' : '') + str(r.title, 80)).join('\n'));
    else lines.push('', tr ? 'Bugün için planlanmış bir Büyük Taş yok.' : 'No Big Rocks planned for today.');
  } catch (e) {}
  const tl = await tasks(ctx); const ap = (await approvals(ctx)).filter((x) => x.status === 'pending');
  const running = tl.filter((t) => t.status === 'running' || t.status === 'queued'), asking = tl.filter((t) => t.status === 'awaiting_info'), ready = tl.filter((t) => !t.seen && t.status === 'done');
  const team = [];
  if (ready.length) team.push((tr ? 'Hazır' : 'Ready for you') + ': ' + ready.map((t) => t.title).join('; '));
  if (ap.length) team.push((tr ? 'Onayınızı bekleyen' : 'Needs your yes') + ': ' + ap.map((x, i) => '[' + (i + 1) + '] ' + x.summary).join('; '));
  if (asking.length) team.push((tr ? 'Soru bekleyen' : 'Waiting for an answer') + ': ' + asking.map((t) => t.title).join('; '));
  if (running.length) team.push((tr ? 'Devam eden' : 'In progress') + ': ' + running.map((t) => t.title).join('; '));
  lines.push('', (tr ? 'Ekip' : 'The team') + ': ' + (team.length ? '' : (tr ? 'bekleyen bir şey yok.' : 'nothing waiting on you.')));
  if (team.length) lines.push(team.map((t) => '· ' + t).join('\n'));
  try {
    const sg = await suggestions(ctx, { lang });
    const open = (sg.items || []).filter((it) => it.status === 'open').slice(0, 3);
    if (open.length) lines.push('', (tr ? 'Ekibin üstlenebileceği işler' : 'What the team could take off your plate') + ':', open.map((it, i) => (i + 1) + '. ' + it.title + (it.why ? ' — ' + it.why : '')).join('\n'), tr ? 'Başlatmak için "/start 1" yazın.' : 'Reply "/start 1" to put the team on one.');
  } catch (e) {}
  lines.push('', tr ? 'Buradayım, efendim.' : 'I am here, sir.');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
async function sendBriefing(uid, ctx, L, lang, how) {
  const text = await briefingText(ctx, L, lang);
  const s = await briefSettings(ctx);
  s.lastDate = L.date; s.last = { at: Date.now(), text, how: how || 'schedule' };
  try { await scripts.onEvent(ctx, scriptDeps(), uid, 'brief.sent', { title: 'morning briefing' }); } catch (e) {}
  await ctx.set('team:brief', s);
  if (pushTo) { try { await pushTo(uid, { title: lang === 'tr' ? 'Sabah özetiniz' : 'Your morning briefing', body: text.split('\n').slice(2, 4).join(' ').slice(0, 160) || 'Open the command centre.', thread: 'team', data: { team: 'brief' } }); } catch (e) {} }
  if (channelsTo) { try { await channelsTo(uid, text, { what: 'briefing' }); } catch (e) {} }
  await log(ctx, 'jarvis', 'Morning briefing ' + (how === 'now' ? 'sent on request.' : 'sent.'));
  return text;
}
const BRIEF_WINDOW = 6;
async function tickScripts(now) {
  if (!bootCtx || !usersFn) return;
  let ids = []; try { ids = await usersFn(); } catch (e) { return; }
  for (const uid of ids) { try { const ctx = bootCtx(uid); ctx.user = await userOf(uid); await scripts.tick(ctx, scriptDeps(), uid, now || new Date()); await efficiency.tick(ctx, effDeps(), uid, now || new Date()); } catch (e) {} }
}
async function tickBriefings(now) {
  if (!bootCtx || !usersFn) return [];
  now = now || new Date();
  let ids = []; try { ids = await usersFn(); } catch (e) { return []; }
  const out = [];
  for (const uid of ids) {
    try {
      const ctx = bootCtx(uid); ctx.user = await userOf(uid);
      const s = await briefSettings(ctx);
      if (s.on === false) { out.push({ uid, skipped: 'off' }); continue; }
      const L = localParts(await userTz(ctx), now);
      if (s.lastDate === L.date) { out.push({ uid, skipped: 'sent' }); continue; }
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(s.at || '08:00')); const at = m ? (+m[1]) * 60 + (+m[2]) : 8 * 60;
      if (!(L.minutes >= at && L.minutes < at + BRIEF_WINDOW)) { out.push({ uid, skipped: 'not yet' }); continue; }
      /* only where it can land: a linked channel, or a device for push */
      const C = channelsLib(); let linked = false;
      try { if (C && C.linkedCount) linked = (await C.linkedCount(uid)) > 0; } catch (e) {}
      let device = false; try { const d = await rawGet('__push:dev:' + uid); device = Array.isArray(d) && d.length > 0; } catch (e) {}
      if (!linked && !device) { s.lastDate = L.date; s.last = { at: Date.now(), text: await briefingText(ctx, L, 'en'), how: 'kept' }; await ctx.set('team:brief', s); out.push({ uid, kept: true }); continue; }
      const settings = await ctx.get('flow:settings');
      await sendBriefing(uid, ctx, L, settings && settings.lang === 'tr' ? 'tr' : 'en', 'schedule');
      out.push({ uid, sent: true });
    } catch (e) { out.push({ uid, error: e && e.message }); }
  }
  return out;
}
let usersFn = null, usersKey = '', rawGet = async () => null, briefTimer = null;
async function userOf(uid) {
  try { const users = (await rawGet(usersKey)) || {}; return Object.values(users).find((u) => u && u.id === uid) || { id: uid }; } catch (e) { return { id: uid }; }
}

/* ---- what is connected, truthfully --------------------------------------- */
const WISHLIST = [
  ['Gmail', 'Read and send from your own mailbox. Needs Google consent from you.'], ['Google Calendar', 'See and book your day. Needs Google consent.'], ['Google Drive', 'Read and write your documents. Needs Google consent.'],
  ['Notion', 'Pages and databases.'], ['Meta Ads', 'Campaign spend and results for Bobby.'], ['Instagram', 'Comments and messages.'], ['YouTube', 'Channel and comments.'],
  ['QuickBooks', 'The books, for the finance assistant.'], ['GitHub', 'Issues and pull requests, for Tom.'], ['Shopify', 'Orders and customers.'], ['HubSpot', 'Contacts and deals.'], ['Stripe', 'Payments and payouts.']
];
async function connectors(uid, ctx) {
  const out = [];
  const B = browserLib(); const av = B ? B.available() : { mode: 'reader', status: 'awaiting', env: [], note: 'The browser module is missing.' };
  out.push({ id: 'flow', kind: 'tool', name: 'The Flow', status: 'working', note: 'Your week, rocks, habits, training, spend and notes: what J.A.R.V.I.S. answers from.' });
  out.push({ id: 'web', kind: 'tool', name: 'Web reader', status: 'working', note: 'Agents read public pages when they need them (ask for a link, a product page, documentation).' });
  out.push({ id: 'browser', kind: 'tool', name: 'Cloud browser', status: av.status, env: av.env || [], note: av.note });
  out.push({ id: 'email', kind: 'tool', name: 'Email (outbound)', status: mailReady() ? 'working' : 'awaiting', env: mailReady() ? [] : ['RESEND_API_KEY'], note: mailReady() ? 'An approved email really goes, once, from ' + ((process.env.MAIL_FROM || '').trim() || 'mail@theflow.today') + ' in the agent\'s name, replies to you.' : 'Approved emails will go from The Flow\'s address once the key is in Render.' });
  for (const P of await providers()) out.push({ id: 'model:' + P.id, kind: 'model', name: P.name, status: P.configured ? 'working' : 'awaiting', env: P.configured ? [] : [P.env], note: P.configured ? P.models.length + ' models' : 'Add ' + P.env + ' in Render.' });
  const C = channelsLib();
  if (C && C.statusList) { try { for (const ch of await C.statusList(uid)) out.push({ id: 'channel:' + ch.id, kind: 'channel', name: ch.name, status: ch.status, env: ch.env, note: ch.status === 'working' ? 'Linked.' : ch.status === 'ready' ? 'Configured; link it from Channels.' : ch.status === 'not_built' ? 'Not built yet.' : 'Missing in Render: ' + ch.env.join(', ') }); } catch (e) {} }
  for (const w of WISHLIST) out.push({ id: 'wish:' + w[0].toLowerCase().replace(/\W+/g, '-'), kind: 'app', name: w[0], status: 'not_built', note: w[1] + ' Not built yet — ask for it and it goes on the list.' });
  const counts = { working: out.filter((x) => x.status === 'working').length, ready: out.filter((x) => x.status === 'ready').length, awaiting: out.filter((x) => x.status === 'awaiting').length, not_built: out.filter((x) => x.status === 'not_built').length };
  return { connectors: out, counts };
}

async function handleStage4(p, req, res, ctx) {
  const json = ctx.json;
  const uid = ctx.user && ctx.user.id;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };

  if (p === '/api/team/suggest' && req.method === 'GET') {
    const rec = await suggestions(ctx, { fresh: ctx.query.get('fresh') === '1', lang: ctx.query.get('lang') === 'tr' ? 'tr' : 'en' });
    json(res, 200, { ok: true, date: rec.date, at: rec.at, items: (rec.items || []).filter((it) => it.status !== 'dismissed'), error: rec.error || '' });
    return true;
  }
  if (p === '/api/team/suggest' && req.method === 'POST') {
    const b = await body();
    const r = await suggestAct(ctx, uid, String(b.id || ''), String(b.op || ''), b.lang === 'tr' ? 'tr' : 'en');
    if (r.error) { json(res, r.status || 502, r); return true; }
    json(res, 200, Object.assign({ ok: true }, r)); return true;
  }
  if (p === '/api/team/brief' && req.method === 'GET') {
    const s = await briefSettings(ctx);
    json(res, 200, { ok: true, on: s.on !== false, at: s.at || '08:00', last: s.last || null, tz: await userTz(ctx) }); return true;
  }
  if (p === '/api/team/brief' && req.method === 'POST') {
    const b = await body(); const s = await briefSettings(ctx);
    if (typeof b.on === 'boolean') s.on = b.on;
    if (typeof b.at === 'string' && /^\d{1,2}:\d{2}$/.test(b.at.trim())) { const [h, m] = b.at.trim().split(':').map(Number); if (h >= 0 && h < 24 && m >= 0 && m < 60) s.at = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
    await ctx.set('team:brief', s); await log(ctx, 'jarvis', 'Morning briefing: ' + (s.on === false ? 'off' : 'at ' + s.at) + '.');
    json(res, 200, { ok: true, on: s.on !== false, at: s.at }); return true;
  }
  if (p === '/api/team/brief/now' && req.method === 'POST') {
    const b = await body();
    const L = localParts(await userTz(ctx), new Date());
    const text = await sendBriefing(uid, ctx, L, b.lang === 'tr' ? 'tr' : 'en', 'now');
    json(res, 200, { ok: true, text }); return true;
  }
  if (p === '/api/team/usage' && req.method === 'GET') {
    const [mo, lim, bud, list] = await Promise.all([monthUsage(ctx), limits(ctx), budget(ctx), agents(ctx)]);
    const rows = Object.keys(mo).map((id) => Object.assign({ id, name: (list.find((a) => a.id === id) || {}).name || id }, mo[id])).sort((a, b) => (b.usd || 0) - (a.usd || 0));
    json(res, 200, { ok: true, month: new Date().toISOString().slice(0, 7), agents: rows, total: { usd: bud.usd, calls: rows.reduce((s, r) => s + (r.calls || 0), 0), tokens: rows.reduce((s, r) => s + (r.in || 0) + (r.out || 0), 0), unpriced: rows.reduce((s, r) => s + (r.unpriced || 0), 0) }, limit: lim.monthlyUsd, over: bud.over, note: 'Estimated from list prices per million tokens; the providers\' invoices are the truth.' });
    return true;
  }
  if (p === '/api/team/limits' && req.method === 'POST') {
    const b = await body(); const lim = await limits(ctx);
    if (Number.isFinite(+b.monthlyUsd)) lim.monthlyUsd = Math.max(0, Math.min(100000, Math.round(+b.monthlyUsd)));
    await ctx.set('team:limits', lim); await log(ctx, 'team', 'Monthly budget: ' + (lim.monthlyUsd ? '$' + lim.monthlyUsd : 'none') + '.');
    json(res, 200, { ok: true, limit: lim.monthlyUsd }); return true;
  }
  if (p === '/api/team/connectors' && req.method === 'GET') {
    json(res, 200, Object.assign({ ok: true }, await connectors(uid, ctx))); return true;
  }
  /* tests only: the briefing tick at a chosen moment, and what mail "went" */
  if (FAKE && p === '/api/team/_tick' && req.method === 'GET') { const at = new Date(ctx.query.get('at') || Date.now()); json(res, 200, { ok: true, out: await tickBriefings(at), scripts: await scripts.tick(ctx, scriptDeps(), ctx.user && ctx.user.id, at), efficiency: await efficiency.tick(ctx, effDeps(), ctx.user && ctx.user.id, at) }); return true; }
  if (FAKE && p === '/api/team/_mail' && req.method === 'GET') { json(res, 200, { ok: true, n: mailSent.length, last: mailSent[mailSent.length - 1] || null }); return true; }
  if (p === '/api/team/task/shots' && req.method === 'GET') {
    const id = str(ctx.query.get('id'), 40); const v = await ctx.get('team:shots:' + id);
    json(res, 200, { ok: true, id, shots: Array.isArray(v) ? v : [] }); return true;
  }
  return false;
}

/* ---- memory auditing: what flow-memory needs from here -------------------- */
function platformRules() {
  const out = [
    { id: 'approval', text: 'Every outside action — sending an email or message, posting, paying, changing a live setting — needs the person\'s yes first; agents propose, never do.', why: 'A platform rule, not a memory: it is in the system prompt of every agent and cannot be changed by a correction.' },
    { id: 'permissions', text: 'Permission levels: read = answer only; draft = prepare things for approval; approve = act after a yes; auto = act within an agreed policy. Set per agent in its room.', why: 'Permission control. A memory correction never changes it; raise or lower it in the agent\'s room if you mean to.' },
    { id: 'tools', text: toolsText(), why: 'What the tools can and cannot do here; code.' },
    { id: 'honesty', text: 'Never claim something was sent, done, checked or changed. Never invent numbers, accounts, results or people.', why: 'Platform rule.' }
  ];
  for (const t of TEMPLATE_IDS) out.push({ id: 'template:' + t, text: TEMPLATES[t].name + ' (' + TEMPLATES[t].role + ') starter instructions: ' + TEMPLATES[t].instructions, why: 'A role template: the starting instructions a new agent is given. Each agent\'s own copy is editable in its room.' });
  return out;
}
/* With a model: does each candidate really conflict, and how should it read now? */
async function judgeConflicts(ctx, correction, rows) {
  if (FAKE) return rows.map((r) => ({ conflicts: true, replacement: r.source === 'knowledge' ? '' : correction }));
  const list = await agents(ctx); const j = list.find((a) => a.id === 'jarvis'); const which = j && await resolveModel(j.model);
  if (!which) return null;
  const sys = 'You audit a team\'s memory. The person has just stated what is TRUE NOW: "' + correction + '". For each numbered passage below, say whether it conflicts with that statement (states something that is no longer true, or an older version of it), and for passages from instructions or memory write the one-sentence replacement that keeps the passage\'s purpose but states the truth. Return ONLY JSON: { "rows": [ { "n": 1, "conflicts": true, "replacement": "" } ] }. Mark "conflicts": false for passages that are compatible or about something else.';
  const body = rows.map((r, i) => (i + 1) + '. [' + r.source + (r.agent ? ' of ' + r.agent : '') + '] ' + r.content).join('\n');
  const r = await complete({ model: which.model, system: sys, messages: [{ role: 'user', content: body }], maxTokens: 1500, timeoutMs: 45000 });
  if (r.error) return null;
  await bumpUsage(ctx, 'jarvis', r.usage, which.model);
  const m = String(r.text || '').match(/\{[\s\S]*\}/); if (!m) return null;
  try { const o = JSON.parse(m[0]); const byN = {}; (o.rows || []).forEach((x) => { byN[+x.n] = x; }); return rows.map((_, i) => byN[i + 1] ? { conflicts: byN[i + 1].conflicts !== false, replacement: str(byN[i + 1].replacement, 400) } : { conflicts: true, replacement: '' }); } catch (e) { return null; }
}
function memDeps() {
  return {
    snapshot: (ctx) => snapshotOf(ctx),
    platform: platformRules,
    judge: judgeConflicts,
    ask: (ctx, agentId, text) => sayTo(ctx, agentId, text, 'en', { dry: true, via: 'verify' }),
    log: (ctx, who, what) => log(ctx, who, what)
  };
}

/* ---------- skills: what the module needs from here ------------------------ */
function skillDeps() {
  return {
    agents: (ctx) => agents(ctx), tasks: (ctx) => tasks(ctx), knowledge: (ctx) => knowledge(ctx), scripts: (ctx) => scripts.all(ctx),
    tools: () => { const B = browserLib(); return { flow: true, web: true, browser: !!(B && B.available().mode === 'browser'), email: mailReady() }; },
    log: (ctx, who, what) => log(ctx, who, what),
    addKnowledge: async (ctx, k) => { const list = await knowledge(ctx); const item = { id: 'k' + newId(), text: str(k.text, 300), scope: k.scope === 'shared' || /^agent:/.test(String(k.scope || '')) ? k.scope : 'shared', kind: k.kind || 'preference', source: 'you', at: Date.now(), updated: Date.now() }; list.push(item); await ctx.set('team:knowledge', list.slice(-400)); await log(ctx, 'team', 'Preference added from skill feedback: ' + item.text); return item; },
    draft: FAKE ? null : draftSkill, revise: FAKE ? null : reviseSkill, run: runSample
  };
}
/* ---------- efficiency: what the review needs from here -------------------- */
function effDeps() {
  const D = scriptDeps();
  return {
    tasks: (ctx) => tasks(ctx), approvals: (ctx) => approvals(ctx), knowledge: (ctx) => knowledge(ctx), agents: (ctx) => agents(ctx),
    skills: (ctx) => skills.all(ctx), scripts: (ctx) => scripts.all(ctx), scriptRuns: (ctx) => scripts.runs(ctx),
    provenance: async (ctx) => { const v = await ctx.get('team:prov'); return Array.isArray(v) ? v : []; }, memlog: async (ctx) => { const v = await ctx.get('team:memlog'); return Array.isArray(v) ? v : []; },
    overlap: memory.overlap, log: (ctx, who, what) => log(ctx, who, what), toolsReady: D.tools, userTz: (ctx) => userTz(ctx), localParts, notify: D.notify,
    supersede: (ctx, id) => memory.edit(ctx, memDeps(), { id, op: 'supersede' }), restoreEntry: (ctx, id) => memory.edit(ctx, memDeps(), { id, op: 'restore' }),
    skillStatus: (ctx, id, status) => skills.setStatus(ctx, skillDeps(), { id, status }), skillCreate: (ctx, task) => skills.create(ctx, skillDeps(), { from: 'task', task, force: true }),
    scriptCreate: (ctx, task) => scripts.create(ctx, scriptDeps(), { from: 'task', task, force: true }), scriptCreateDoc: (ctx, doc) => scripts.create(ctx, scriptDeps(), { doc, force: true }), scriptStatus: (ctx, id, status) => scripts.setStatus(ctx, scriptDeps(), { id, status }),
    appendInstructions: async (ctx, agentId, text) => { const list = await agents(ctx); const a = list.find((x) => x.id === agentId); if (!a) return { error: 'No such agent.', status: 404 }; const before = a.instructions || ''; a.instrHistory = (a.instrHistory || []).concat([{ at: Date.now(), field: 'instructions', before, by: 'you', why: 'efficiency review' }]).slice(-20); a.instructions = block(before + (before ? '\n' : '') + text, 4000); a.updatedAt = Date.now(); await saveAgents(ctx, list); return { ok: true, before, after: a.instructions }; },
    setInstructions: async (ctx, agentId, text) => { const list = await agents(ctx); const a = list.find((x) => x.id === agentId); if (!a) return { error: 'No such agent.', status: 404 }; a.instrHistory = (a.instrHistory || []).concat([{ at: Date.now(), field: 'instructions', before: a.instructions || '', by: 'you', why: 'efficiency revert' }]).slice(-20); a.instructions = block(text, 4000); a.updatedAt = Date.now(); await saveAgents(ctx, list); return { ok: true }; },
    runStep: (ctx, agentId, brief) => runStepDry(ctx, agentId, brief)
  };
}
/* One step, for real, with nothing kept: the agent's prompt as a task would
   build it (skill matched if one applies), the agent's model, no task saved,
   proposals returned as drafts. What the efficiency baseline measures. */
async function runStepDry(ctx, agentId, brief) {
  const list = await agents(ctx); const a = list.find((x) => x.id === agentId && !x.archived) || list.find((x) => x.id !== 'jarvis' && !x.archived); if (!a) return { error: 'No such agent.' };
  const which = await resolveModel(a.model); if (!which) return { error: a.name + ' has no model available here.' };
  const bud = await budget(ctx); if (bud.over) return { error: bud.message };
  const K = await knowledge(ctx); const shared = K.filter((k) => k.scope === 'shared' || k.scope === 'agent:' + a.id).slice(-200);
  const owner = ctx.user && (ctx.user.name || ctx.user.email);
  const task = { title: str(brief, 80), brief, by: 'you', lang: 'en' }; const step = { title: str(brief, 80), brief };
  let pick = null; try { pick = await skills.forStep(ctx, skillDeps(), a, step, task, K); } catch (e) {}
  const system = stepSystem(a, owner, shared, [], 'en', task, step, [], (pick && pick.block ? pick.block + '\n' : '') + 'THIS IS A MEASUREMENT RUN: do the work as you would for real; nothing you propose is sent.');
  const r = await complete({ model: which.model, system, messages: [{ role: 'user', content: 'Do your part now.' }], maxTokens: 3000, timeoutMs: 90000 });
  if (r.error) return { error: r.error };
  await bumpUsage(ctx, a.id, r.usage, which.model);
  const out = parseStep(r.text);
  return { result: out.result, question: out.question, proposals: out.proposals.map((p) => Object.assign({}, p, { status: 'draft' })), usage: r.usage, calls: 1, usd: costOf(which.model, r.usage) || 0, model: which.model, skill: pick && pick.meta && pick.meta.id && !pick.meta.blocked ? pick.meta : null };
}
/* ---------- automations: what the module needs from here ------------------ */
function scriptDeps() {
  return {
    tasks: (ctx) => tasks(ctx), agents: (ctx) => agents(ctx), monthUsage: (ctx) => monthUsage(ctx),
    userTz: (ctx) => userTz(ctx), localParts, paused: async (ctx) => (await ctx.get('team:paused')) === true,
    tools: () => { const B = browserLib(); return { flow: true, web: true, browser: !!(B && B.available().mode === 'browser'), email: mailReady() }; },
    log: (ctx, who, what) => log(ctx, who, what),
    read: async (url) => { const B = browserLib(); if (!B) throw new Error('reader not available'); const r = await B.read(url); return r; },
    notify: async (uid, ctx, text) => { let n = 0; if (pushTo) { try { await pushTo(uid, { title: 'Automation', body: String(text).slice(0, 160), thread: 'team', data: { team: 'script' } }); n++; } catch (e) {} } if (channelsTo) { try { const r = await channelsTo(uid, text, { what: 'script' }); n += typeof r === 'number' ? r : 1; } catch (e) {} } return n; },
    sendEmail: async (ctx, m) => { const owner = ctx.user && (ctx.user.name || ctx.user.email); return sendEmail({ to: m.to, subject: m.subject, text: m.text, agent: 'Automation', owner, replyTo: ctx.user && ctx.user.email, key: m.key }); },
    newTask: async (ctx, uid, f) => { const list = await agents(ctx); const a = list.find((x) => x.id === f.agent && !x.archived) || list.find((x) => x.id === 'jarvis'); if (a.id === 'jarvis') { const r = await delegateText(ctx, uid, f.brief, 'en', { via: 'script' }); if (r.task) return r.task; return await newTask(ctx, uid, { title: f.title, brief: f.brief, agent: 'jarvis', by: 'you', lang: 'en', steps: [{ agent: (list.find((x) => x.id !== 'jarvis' && !x.archived) || {}).id || 'jarvis', title: f.title, brief: f.brief }], from: f.from }); } return await newTask(ctx, uid, { title: f.title, brief: f.brief, agent: a.id, by: 'you', lang: 'en', steps: [{ agent: a.id, title: f.title, brief: f.brief }], from: f.from }); },
    askApproval: async (ctx, uid, sc, run, aw) => {
      const ap = await approvals(ctx);
      const item = { id: 'p' + newId(), task: '', step: '', run: run.id, agent: 'script', script: sc.id, kind: 'batch', summary: 'Send ' + aw.count + ' email' + (aw.count === 1 ? '' : 's') + ' from "' + sc.name + '": ' + str(aw.subject, 80), detail: { to: aw.count + ' recipient' + (aw.count === 1 ? '' : 's') + ': ' + aw.recipients.slice(0, 8).join(', ') + (aw.recipients.length > 8 ? ' … +' + (aw.recipients.length - 8) : ''), subject: aw.subject, body: 'Sample (' + aw.sample.to + '):\n' + aw.sample.body + '\n\nTemplate: ' + (aw.template && aw.template.body || ''), run: run.id, count: aw.count, recipients: aw.recipients }, status: 'pending', key: 'k' + newId(), at: Date.now() };
      ap.push(item); await saveApprovals(ctx, ap);
      await log(ctx, 'team', 'The automation "' + sc.name + '" is waiting for your yes: ' + item.summary);
      if (pushTo) { try { await pushTo(uid, { title: item.summary, body: 'Review the recipients and content in the command centre.', thread: 'team', data: { team: 'approval' } }); } catch (e) {} }
      if (channelsTo) { try { await channelsTo(uid, item.summary + '\n\n' + item.detail.to + '\n\nSubject: ' + item.detail.subject + '\n\nReply "/yes 1" to send them once, or "/no 1".', { what: 'approval' }); } catch (e) {} }
      return item;
    },
    cancelApproval: async (ctx, id) => { const ap = await approvals(ctx); const it = ap.find((x) => x.id === id); if (it && it.status === 'pending') { it.status = 'rejected'; it.decidedAt = Date.now(); it.note = 'The run was cancelled.'; await saveApprovals(ctx, ap); } },
    saveRun: null, draft: FAKE ? null : draftScript
  };
}
/* A model turns a finished task into a pipeline of the vetted operations; the
   deterministic draft is the fallback and anything outside the catalogue is
   dropped by cleanDoc. The model never writes code that runs here. */
async function draftScript(ctx, o) {
  const list = await agents(ctx); const j = list.find((a) => a.id === 'jarvis'); const which = j && await resolveModel(j.model); if (!which) return null;
  const ops = Object.keys(o.ops).map((id) => id + ' (' + o.ops[id].kind + '): ' + o.ops[id].label + (o.ops[id].params.length ? ' — params: ' + o.ops[id].params.map((p) => p.name + (p.choices ? ' [' + p.choices.join('|') + ']' : ':' + p.type)).join(', ') : '')).join('\n');
  const sys = 'You design an AUTOMATION for a team of AI employees: a pipeline of vetted operations that runs the same way every time, with no model involved except an explicit jarvis.review step for exceptions. Only these operations exist:\n' + ops + '\nValues that change (an address, a threshold, a page) are inputs ({{inputs.name}}), typed, not hard-coded. Templates may use {{item.field}}, {{count}}, {{text}}, {{totals.sum}}, {{today}}. Keep the routine, countable, formattable part in the script; leave writing, replies and judgment to the agents (jarvis.review or nothing). Return ONLY JSON: { "name": "", "purpose": "", "inputs": [ { "name": "", "label": "", "type": "text|number|date|url|email|list|choice", "default": "", "required": true } ], "steps": [ { "op": "<id>", ...params, "as": "" } ], "schedule": { "kind": "daily|weekdays|weekly|none", "at": "08:00", "day": 0 }, "stop": "conditions that should stop a run", "judgment": "what still needs a human or an agent" }';
  const body = 'The task the team completed:\nTitle: ' + o.task.title + '\nRequest: ' + (o.task.brief || '') + '\nSteps done:\n' + (o.task.steps || []).map((s) => '- ' + s.agent + ': ' + s.title + ' — ' + str(s.brief, 300) + '\n  result: ' + str(s.result, 500)).join('\n') + '\n\nA first draft to improve (keep what is right, use only the operations above):\n' + JSON.stringify(o.draft);
  const r = await complete({ model: which.model, system: sys, messages: [{ role: 'user', content: body }], maxTokens: 2500, timeoutMs: 60000 });
  if (r.error) return null; await bumpUsage(ctx, 'jarvis', r.usage, which.model);
  const m = String(r.text || '').match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}
/* A model turns a description or a finished task into the skill document; the
   deterministic draft is the fallback and the shape the model must keep. */
const SKILL_SHAPE = '{ "name": "", "type": "workflow|guide", "purpose": "", "when": "", "whenNot": "", "inputs": [""], "steps": [""], "tools": ["flow|web|browser|email"], "output": "", "quality": "", "exceptions": "", "approvals": "" }';
async function draftSkill(ctx, o) {
  const list = await agents(ctx); const j = list.find((a) => a.id === 'jarvis'); const which = j && await resolveModel(j.model); if (!which) return null;
  const sys = 'You write a reusable SKILL for a team of AI employees: an instruction document a person can read and edit. Capture the procedure, not the one-time details: addresses, amounts, dates, names and links from the example become named inputs (e.g. "the customer\'s email address"). Reference facts the team already knows rather than copying them. Steps are ordered and include decision points ("if X, then…"). Say plainly what needs the person\'s approval (anything that reaches the outside world — the skill never does it). Return ONLY JSON in this shape: ' + SKILL_SHAPE + '. Keep "tools" to those really needed.';
  const body = o.kind === 'task' ? 'The team just completed this task; turn its workflow into a skill.\nTitle: ' + o.task.title + '\nRequest: ' + (o.task.brief || '') + '\nSteps done:\n' + (o.task.steps || []).map((s) => '- ' + s.agent + ': ' + s.title + ' — ' + str(s.brief, 400) + '\n  result: ' + str(s.result, 600)).join('\n') + '\n\nA first draft to improve (keep what is right):\n' + JSON.stringify(o.draft) : 'Description from the person:\n' + o.text + (Array.isArray(o.examples) && o.examples.length ? '\n\nExamples of requests it should handle:\n' + o.examples.map((e) => '- ' + str(e.input || e, 400)).join('\n') : '') + '\n\nA first draft to improve (keep what is right):\n' + JSON.stringify(o.draft);
  const r = await complete({ model: which.model, system: sys, messages: [{ role: 'user', content: body }], maxTokens: 2500, timeoutMs: 60000 });
  if (r.error) return null; await bumpUsage(ctx, 'jarvis', r.usage, which.model);
  const m = String(r.text || '').match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}
async function reviseSkill(ctx, o) {
  const list = await agents(ctx); const j = list.find((a) => a.id === 'jarvis'); const which = j && await resolveModel(j.model); if (!which) return null;
  const sys = 'You maintain a reusable SKILL (an instruction document) for a team of AI employees. The person has given feedback that should change the procedure from now on. Make the smallest precise change that incorporates it; leave every unrelated field exactly as it is; do not add facts (those live in the team\'s knowledge); never widen what the agent may do without approval. Return ONLY the full updated document as JSON in this shape: ' + SKILL_SHAPE;
  const body = 'Current skill (v' + o.skill.version + '):\n' + JSON.stringify(skills.docOf(o.skill)) + '\n\nFeedback:\n' + o.feedback + '\n\nA mechanical draft of the change, to improve or keep:\n' + JSON.stringify(o.draft);
  const r = await complete({ model: which.model, system: sys, messages: [{ role: 'user', content: body }], maxTokens: 2500, timeoutMs: 60000 });
  if (r.error) return null; await bumpUsage(ctx, 'jarvis', r.usage, which.model);
  const m = String(r.text || '').match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}
/* A test run of a skill on one example: the real step prompt with the skill
   in it, the agent's own model, nothing saved as a task, nothing sent —
   proposals come back as drafts to look at. */
async function runSample(ctx, agentId, sk, input, know) {
  const list = await agents(ctx); const a = list.find((x) => x.id === agentId && !x.archived); if (!a) return { error: 'No such agent.' };
  if ((await ctx.get('team:paused')) === true) return { error: 'The team is paused.' };
  const which = await resolveModel(a.model); if (!which) return { error: a.name + ' has no model available here.' };
  const bud = await budget(ctx); if (bud.over) return { error: bud.message };
  const K = know || await knowledge(ctx);
  const shared = K.filter((k) => k.scope === 'shared' || k.scope === 'agent:' + a.id).slice(-200);
  const owner = ctx.user && (ctx.user.name || ctx.user.email);
  const task = { title: 'Test run of the skill "' + sk.name + '"', brief: input, by: 'you', lang: 'en' };
  const system = stepSystem(a, owner, shared, [], 'en', task, { title: 'Test run', brief: input }, [], skills.text(sk, K, sk.scripts && sk.scripts.length ? await scripts.all(ctx) : []) + '\nTHIS IS A TEST RUN of the skill: do the work exactly as you would for real, but know that nothing you propose is sent — proposals are shown to the person as drafts.');
  const r = await complete({ model: which.model, system, messages: [{ role: 'user', content: 'Do your part now.' }], maxTokens: 3000, timeoutMs: 90000 });
  if (r.error) return { error: r.error };
  await bumpUsage(ctx, a.id, r.usage, which.model);
  const out = parseStep(r.text);
  return { result: out.result, question: out.question, proposals: out.proposals.map((p) => Object.assign({}, p, { status: 'draft' })), model: which.model, permissions: a.permissions };
}

async function handleWork(p, req, res, ctx) {
  const json = ctx.json;
  const uid = ctx.user && ctx.user.id;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };

  if (await handleStage4(p, req, res, ctx)) return true;

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
module.exports.memory = memory;
module.exports.skills = skills;
module.exports.scripts = scripts;
module.exports.efficiency = efficiency;
module.exports.scriptDeps = scriptDeps;
module.exports.provenance = (ctx, p) => memory.record(ctx, p);
module.exports._work = { tasks, approvals, parseStep, parsePlan, planSystem, stepSystem, TASK_STATES, setFakeDelay: (ms) => { fakeDelay = ms; }, loops,
  tickBriefings, suggestions, suggestAct, briefingText, localParts, userTz, connectors, costOf, budget, mailSent, parseSuggest, sendEmail, toolsText, parseReply, SUGGEST_SYSTEM, PRICES };

/* For J.A.R.V.I.S.'s own engine: the shared knowledge, as lines, and the
   model he is set to (if any). flow-extras reads these. */
async function forJarvis(ctx) {
  try {
    const list = await ctx.get('team:agents'); const know = await ctx.get('team:knowledge');
    const j = Array.isArray(list) ? list.find((a) => a.id === 'jarvis') : null;
    const kb = memory.blocks(Array.isArray(know) ? know : [], 'jarvis');
    const shared = kb.facts.concat(kb.rules).slice(-80).map((k) => ({ id: k.id, text: k.text + (k.kind === 'rule' || k.kind === 'procedure' ? ' [rule]' : '') }));
    const history = kb.historyText;
    const paused = (await ctx.get('team:paused')) === true;
    return { model: j && j.model && j.model !== DEFAULT_MODEL ? j.model : '', shared, history, superseded: kb.old.map((k) => k.id), paused };
  } catch (e) { return { model: '', shared: [], paused: false }; }
}

module.exports.handle = handle;
module.exports.complete = complete;
module.exports.resolveModel = resolveModel;
module.exports.providers = providers;
module.exports.forJarvis = forJarvis;
module.exports._internals = { PROVIDERS, TEMPLATES, STARTER_IDS, TEMPLATE_IDS, MANNERS, agentSystem, parseReply, fromTemplate, setPost: (f) => { post = f; }, DEFAULT_MODEL };
