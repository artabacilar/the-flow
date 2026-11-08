/* Guided setup: from nothing to the first piece of work the team did for you.
 *
 * Nine steps, each saved as it is done, so the setup can be left and picked
 * up where it was: name the main agent → choose and test a model → pair a
 * messaging channel with a real two-way test → say where things should be
 * delivered by default → see the tools and what each may do → a tour of the
 * rooms → the first task (read-only, with its source named) → an optional
 * inbox-organisation workflow → the readiness checklist.
 *
 * Nothing here is marked done because a button was pressed: a provider is
 * done when a test call came back; a channel when the person's reply arrived
 * through it; the first task when its result exists. Every GET re-checks the
 * live facts, so a key that was removed, a channel that was unlinked or a
 * default delivery channel that no longer exists turns its step into "needs
 * attention" with the reason and the way back. The steps that depend on
 * something not configured here say so and name who provides it — the
 * inbox steps wait for a Gmail connection, which needs a Google OAuth client
 * only the account owner can create.
 */
const crypto = require('crypto');

const STEPS = ['agent', 'provider', 'channel', 'delivery', 'tools', 'tour', 'first', 'inbox', 'ready'];
const TITLES = { agent: 'Your main agent', provider: 'The model that thinks', channel: 'Where you talk to him', delivery: 'Where he delivers', tools: 'Tools and what each may do', tour: 'A tour of the rooms', first: 'The first task', inbox: 'Inbox organisation (optional)', ready: 'Ready' };
const OPTIONAL = { inbox: true };

/* What each provider costs and limits, said plainly. These are the facts
   that do not change with the day; current prices are on the provider's page. */
const BILLING = {
  anthropic: { who: 'Anthropic', how: 'Billed per token on your own Anthropic account; this app never sees the invoice. Set a spend limit in the Anthropic console; the monthly dollar limit in the command centre stops the team before that.', limits: 'Rate limits depend on your account tier; a 429 here means the provider said "slow down" and the task is retried, not lost.', url: 'https://www.anthropic.com/pricing' },
  openai: { who: 'OpenAI', how: 'Billed per token on your own OpenAI account (prepaid credits or monthly invoice). Hard and soft limits are set in the OpenAI dashboard.', limits: 'Rate limits rise with usage tier; a 429 is retried.', url: 'https://openai.com/api/pricing/' },
  xai: { who: 'xAI', how: 'Billed per token on your xAI account; set limits in the xAI console.', limits: 'Per-minute limits per model; a 429 is retried.', url: 'https://x.ai/api' },
  deepseek: { who: 'DeepSeek', how: 'Billed per token, prepaid, on your DeepSeek account.', limits: 'Generous per-minute limits; a 429 is retried.', url: 'https://platform.deepseek.com' }
};

/* Capabilities per tool, honestly: what an agent may do with it here. */
const CAPS = {
  flow: ['read your week, rocks, habits, training, spend and notes', 'tick a rock or habit when asked (recorded in the log)'],
  web: ['read up to three public pages per step', 'never a private or local address'],
  browser: ['open pages in an isolated browser per agent', 'hands over to you the moment a login, one-time code or CAPTCHA appears'],
  email: ['draft replies (always)', 'send an approved draft once, from the team address, with reply-to you'],
  'model:': ['think: plan, draft, summarise, answer'],
  'channel:': ['receive your messages and reply', 'deliver results, questions and approvals'],
  gmail: ['read the latest message and threads (read-only first)', 'draft replies for your yes', 'label and archive by rules you approve — never delete']
};

const TOUR = [
  { id: 'console', name: 'Chat', what: 'The console: say or type anything to J.A.R.V.I.S.; "Have Sarah draft…" starts work.', to: 'jarvis' },
  { id: 'speak', name: 'Speak', what: 'Voice: the wake word, the premium voice, the orb that listens. Hands free.', to: 'jarvis' },
  { id: 'team', name: 'The team', what: 'Each specialist has a room: instructions, model, what they know, their tasks and approvals.', to: 'team' },
  { id: 'work', name: 'Work and approvals', what: 'Tasks run with the app closed; anything that leaves (an email) waits for your yes, exactly as shown.', to: 'jarvis' },
  { id: 'memory', name: 'Memory', what: 'What the team knows, where each fact came from, corrections with history, and "where did that come from?".', to: 'memory' },
  { id: 'skills', name: 'Skills', what: 'Recurring work taught once, followed every time, improved from your feedback.', to: 'skills' },
  { id: 'scripts', name: 'Automations', what: 'Routine jobs as scripts: scheduled, event-driven, no model, dry-run first.', to: 'scripts' },
  { id: 'efficiency', name: 'Efficiency', what: 'Where effort is wasted, with the evidence, and proof a change helped.', to: 'efficiency' },
  { id: 'channels', name: 'Channels', what: 'Telegram, WhatsApp, Slack, Discord, SMS, calls, iMessage — each with its status and a Link code.', to: 'jarvis' },
  { id: 'files', name: 'Files and browser', what: 'Pages the agents read, screenshots from the cloud browser, the activity log.', to: 'jarvis' }
];

const FIRST = [
  { id: 'inbox', title: 'Read my latest inbox email and summarise it', needs: 'gmail', brief: 'Read the most recent email in the inbox. Summarise it in five lines: who, what they want, by when, what they attached, and what you suggest. Change nothing — no reply, no label. End with the line "Source: Gmail, <sender>, <date>".' },
  { id: 'today', title: 'Read today\'s plan and summarise it', needs: 'flow', brief: 'Read today\'s Big Rocks, habits and training from the Flow record. Summarise in five lines what is planned, what is done and what is next. Change nothing. End with the line "Source: your Flow record, <today\'s date>".' },
  { id: 'spend', title: 'Read this month\'s spend and summarise it', needs: 'flow', brief: 'Read this month\'s expenses from the Flow record. Summarise the total, the three biggest categories and anything unusual. Change nothing. End with the line "Source: your Flow record, <this month>".' }
];

function providerOf(model) { const m = String(model || ''); return /^claude-/.test(m) ? 'anthropic' : /^(gpt-|o[1-9])/.test(m) ? 'openai' : /^grok/.test(m) ? 'xai' : /^deepseek/.test(m) ? 'deepseek' : ''; }
function str(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 200); }
function newId() { return crypto.randomBytes(5).toString('hex'); }

async function state(ctx) { const v = await ctx.get('team:setup'); const s = v && typeof v === 'object' ? v : {}; if (!s.steps || typeof s.steps !== 'object') s.steps = {}; return s; }
async function save(ctx, s) { s.updatedAt = Date.now(); await ctx.set('team:setup', s); }
function mark(s, id, status, data) { s.steps[id] = Object.assign({}, s.steps[id] || {}, { status, at: Date.now() }, data ? { data } : {}); if (!s.startedAt) s.startedAt = Date.now(); }

/* The live picture: every step re-checked against what is actually there. */
async function view(ctx, deps, uid) {
  const S = await state(ctx);
  const agentsL = await deps.agents(ctx); const j = agentsL.find((a) => a.id === 'jarvis') || null;
  const provs = await deps.providers();
  const which = j ? await deps.resolveModel(j.model) : null;
  const chans = deps.channels ? await deps.channels(uid) : [];
  const linked = chans.filter((c) => c.status === 'working');
  const delivery = await ctx.get('team:delivery');
  const conn = deps.connectors ? await deps.connectors(uid, ctx) : { connectors: [], counts: {} };
  const tasks = deps.tasks ? await deps.tasks(ctx) : [];
  const first = S.steps.first && S.steps.first.data && S.steps.first.data.task ? tasks.find((t) => t.id === S.steps.first.data.task) || null : null;
  const gmail = conn.connectors.find((c) => /gmail/i.test(c.name) && c.status !== 'not_built') || null;

  const steps = STEPS.map((id) => {
    const st = S.steps[id] || {}; let status = st.status || 'todo', note = '', data = st.data || null;
    if (id === 'agent') { if (j && (st.status === 'done')) { status = 'done'; note = j.name + ' · ' + (j.role || 'chief of staff'); } else if (j) note = 'Called ' + j.name + ' for now; give him his name.'; }
    if (id === 'provider') {
      if (st.status === 'done' && !which) { status = 'attention'; note = 'The model "' + (j && j.model) + '" is no longer available here — its provider\'s key was removed or the model retired. Choose again.'; }
      else if (st.status === 'done') note = which.provider + ' · ' + which.model + (data && typeof data.ms === 'number' ? ' · test ' + data.ms + ' ms' : '');
      else note = provs.filter((p) => p.configured).length ? provs.filter((p) => p.configured).map((p) => p.name).join(', ') + ' configured here' : 'No provider key is in Render yet — add one (ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY or DEEPSEEK_API_KEY) and come back.';
    }
    if (id === 'channel') {
      const ch = data && data.channel; const lk = ch && chans.find((c) => c.id === ch && c.status === 'working');
      if (st.status === 'done' && !lk) { status = 'attention'; note = (ch || 'The channel') + ' is no longer linked. Pair it again.'; }
      else if (st.status === 'done') note = (lk.name) + ' · ' + (lk.linked && lk.linked.name ? lk.linked.name : lk.linked && lk.linked.id) + ' · replied in ' + (data.pongMs || 0) + ' ms';
      else if (linked.length && !(S.ping && S.ping.pong)) note = linked.map((c) => c.name).join(', ') + ' linked — send the test to finish.';
      else if (!chans.some((c) => c.status === 'ready' || c.status === 'working')) { note = 'No channel is configured on the server yet. Telegram is the quickest: one BotFather token (TELEGRAM_BOT_TOKEN) in Render.'; }
      else note = chans.filter((c) => c.status === 'ready').map((c) => c.name).join(', ') + ' ready to link.';
    }
    if (id === 'delivery') {
      if (st.status === 'done' && delivery && delivery !== 'app' && delivery !== 'push' && !linked.some((c) => c.id === delivery)) { status = 'attention'; note = delivery + ' is not linked any more; choose where to deliver.'; }
      else if (st.status === 'done') note = delivery === 'app' ? 'The app only' : delivery === 'push' ? 'Push notifications' : (chans.find((c) => c.id === delivery) || {}).name || delivery;
      else note = linked.length ? 'Briefings, results and approvals: ' + linked.map((c) => c.name).join(' / ') + ' or the app.' : 'The app for now; a channel once one is linked.';
    }
    if (id === 'tools') note = (conn.counts.working || 0) + ' working · ' + (conn.counts.ready || 0) + ' ready · ' + (conn.counts.awaiting || 0) + ' awaiting configuration · ' + (conn.counts.available || 0) + ' available as plugins · ' + (conn.counts.not_built || 0) + ' not built';
    if (id === 'tour') note = st.status === 'done' ? TOUR.length + ' rooms seen' : TOUR.length + ' rooms, two minutes.';
    if (id === 'first') {
      if (first) { status = first.status === 'done' ? 'done' : /^(failed|cancelled)$/.test(first.status) ? 'attention' : 'running'; note = first.title + ' · ' + first.status.replace(/_/g, ' '); data = Object.assign({}, data, { status: first.status, result: first.result ? str(first.result, 600) : '', error: first.error || '', via: first.via }); }
      else note = (gmail && gmail.status === 'working') ? 'Read-only; the result names its source.' : 'Gmail is not connected, so the inbox task waits; two read-only tasks on your own record are ready.';
    }
    if (id === 'inbox') { if (st.status === 'skipped') note = 'Skipped — available any time from here.'; else if (st.status === 'done') note = 'Done'; else note = gmail && gmail.status === 'working' ? 'A scoped pass over the inbox, read-only first, with a report.' : 'Waits for Gmail — ' + (gmail ? gmail.note : 'not built yet; needs a Google OAuth client that only you can create') + '.'; }
    return { id, title: TITLES[id], status, note, data, optional: !!OPTIONAL[id] };
  });
  const checklist = [
    { id: 'agent', item: 'Main agent named', ok: steps[0].status === 'done', fix: 'Step 1.' },
    { id: 'provider', item: 'A model answered a test call', ok: steps[1].status === 'done', fix: steps[1].status === 'attention' ? steps[1].note : 'Step 2: choose a provider and press Test.' },
    { id: 'channel', item: 'A channel paired and tested both ways', ok: steps[2].status === 'done', fix: steps[2].note, soft: true },
    { id: 'delivery', item: 'Default delivery chosen', ok: steps[3].status === 'done', fix: 'Step 4.' },
    { id: 'tools', item: 'Tools reviewed', ok: steps[4].status === 'done', fix: 'Step 5.' },
    { id: 'first', item: 'First task finished with its source named', ok: steps[6].status === 'done', fix: steps[6].status === 'running' ? 'It is running; wait for it.' : 'Step 7.' },
    { id: 'gmail', item: 'Gmail connected (for the inbox tasks)', ok: !!(gmail && gmail.status === 'working'), fix: 'Needs a Google OAuth client from you; then Connect appears under Tools.', soft: true }
  ];
  const essentials = checklist.filter((c) => !c.soft);
  const readyNow = essentials.every((c) => c.ok);
  steps[8].status = S.completedAt ? 'done' : readyNow ? 'todo' : 'todo'; steps[8].note = readyNow ? (S.completedAt ? 'Set up on ' + new Date(S.completedAt).toISOString().slice(0, 10) : 'Everything essential is in place.') : essentials.filter((c) => !c.ok).length + ' essential item' + (essentials.filter((c) => !c.ok).length === 1 ? '' : 's') + ' left.';
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const current = steps.find((s) => s.status === 'attention') || steps.find((s) => s.status === 'todo' || s.status === 'running') || steps[8];
  const nextSteps = [];
  if (!linked.length) nextSteps.push('Pair Telegram (one BotFather token in Render, then Link in Channels) so results reach you with the app closed.');
  if (!(gmail && gmail.status === 'working')) nextSteps.push('Create a Google OAuth client and add its id and secret in Render; Gmail then appears under Tools with Connect, and the inbox tasks unlock.');
  if (provs.filter((p) => p.configured).length < 2) nextSteps.push('Add a second provider key so agents can be switched between models without losing memory.');
  nextSteps.push('Teach the first skill from a task that went well ("Turn the workflow we just completed into a reusable skill").');
  nextSteps.push('Switch the morning briefing on, in J.A.R.V.I.S.\'s view.');
  return {
    ok: true, steps, current: current.id, progress: { done, total: STEPS.length }, startedAt: S.startedAt || null, completedAt: S.completedAt || null,
    facts: {
      agent: j ? { id: j.id, name: j.name, role: j.role, model: j.model, modelOk: !!which } : null,
      providers: provs.map((p) => Object.assign({ billing: BILLING[p.id] || null }, p)),
      channels: chans, delivery: delivery || null, ping: S.ping || null,
      tools: conn.connectors.filter((c) => !(gmail === null && /gmail/i.test(c.name))).map((c) => Object.assign({}, c, { caps: CAPS[c.id] || CAPS[(c.id.split(':')[0] + ':')] || [] })).concat(gmail ? [] : [{ id: 'gmail', kind: 'app', name: 'Gmail / Google Workspace', status: 'awaiting', env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], note: 'Not connected. Needs a Google OAuth client (created in your Google Cloud console — only you can do that); once its id and secret are in Render, Connect appears here. Then: read the latest email, draft replies for your yes, label and archive by approved rules. Never delete.', caps: CAPS.gmail, essential: true }]),
      counts: conn.counts, tour: TOUR, tourSeen: (S.steps.tour && S.steps.tour.data && S.steps.tour.data.seen) || [],
      first: FIRST.map((f) => Object.assign({}, f, { ready: f.needs === 'flow' || !!(f.needs === 'gmail' && gmail && gmail.status === 'working'), why: f.needs === 'gmail' && !(gmail && gmail.status === 'working') ? 'Needs Gmail — not connected yet.' : '' })),
      firstTask: first ? { id: first.id, title: first.title, status: first.status, result: first.result || '', error: first.error || '', agent: first.agent, via: first.via, steps: (first.steps || []).map((s) => ({ agent: s.agent, status: s.status })) } : null,
      specialists: agentsL.filter((a) => !a.archived && a.id !== 'jarvis').map((a) => ({ id: a.id, name: a.name, role: a.role })),
      gmail: gmail ? { status: gmail.status, note: gmail.note } : { status: 'awaiting', note: 'Needs a Google OAuth client from you.' }
    },
    checklist, readyNow, nextSteps,
    recovery: [
      'A provider key removed or rotated: step 2 turns to "needs attention"; choose the provider again and press Test.',
      'A channel unlinked (or the bot token changed): step 3 turns to "needs attention"; Link again with a fresh code and send the test.',
      'The default delivery channel gone: step 4 asks again; until then results stay in the app.',
      'Setup interrupted at any point: open it again and it continues at the first step that is not done.'
    ]
  };
}

/* The two-way test: we send, the person replies through the same channel. */
async function pong(ctx, channel) {
  const S = await state(ctx); if (!S.ping || S.ping.pong || S.ping.channel !== channel) return false;
  S.ping.pong = Date.now(); S.ping.ms = S.ping.pong - S.ping.at;
  mark(S, 'channel', 'done', { channel, pongMs: S.ping.ms });
  await save(ctx, S); return true;
}

async function act(ctx, deps, uid, b) {
  const S = await state(ctx); const op = String(b.op || ''); const step = String(b.step || '');
  const list = await deps.agents(ctx); const j = list.find((a) => a.id === 'jarvis');
  if (step === 'agent') {
    const name = str(b.name, 40) || (j && j.name) || 'J.A.R.V.I.S.'; const role = str(b.role, 80) || (j && j.role) || 'chief of staff';
    if (!j) return { error: 'The main agent is missing from this account.', status: 500 };
    j.name = name; j.role = role; j.updatedAt = Date.now(); await deps.saveAgents(ctx, list);
    try { const s = (await ctx.get('flow:settings')) || {}; if (s && typeof s === 'object') { s.asstName = name; await ctx.set('flow:settings', s); } } catch (e) {}
    mark(S, 'agent', 'done', { name, role }); await save(ctx, S);
    await deps.log(ctx, 'jarvis', 'Setup: the main agent is ' + name + ', ' + role + '.');
    return { ok: true };
  }
  if (step === 'provider') {
    const model = str(b.model, 80); if (!model) return { error: 'Choose a model.', status: 400 };
    const which = await deps.resolveModel(model);
    if (!which) { const P = (await deps.providers()); const want = P.find((p) => (p.models || []).indexOf(model) >= 0) || P.find((p) => p.id === providerOf(model)); return { error: want && !want.configured ? want.name + ' is not configured here: add ' + want.env + ' in Render, then come back.' : 'That model is not available from any configured provider here.', status: 400 }; }
    const t0 = Date.now();
    const r = await deps.test(ctx, which.model);
    if (r.error) { mark(S, 'provider', 'attention', { model: which.model, provider: which.provider, error: r.error }); await save(ctx, S); return { error: 'The test call failed: ' + r.error, status: 502, test: r }; }
    j.model = which.model; j.updatedAt = Date.now(); await deps.saveAgents(ctx, list);
    const data = { model: which.model, provider: which.provider, ms: Date.now() - t0, usage: r.usage || null, reply: str(r.text, 120) };
    mark(S, 'provider', 'done', data); await save(ctx, S);
    await deps.log(ctx, 'jarvis', 'Setup: ' + which.provider + ' · ' + which.model + ' answered the test call in ' + data.ms + ' ms.');
    return { ok: true, test: data, billing: BILLING[which.provider] || null };
  }
  if (step === 'channel') {
    if (op === 'code') { if (!deps.newCode) return { error: 'Channels are not available here.', status: 503 }; const code = await deps.newCode(uid); return { ok: true, code, minutes: 10 }; }
    if (op === 'test') {
      const channel = str(b.channel, 20); const chans = await deps.channels(uid); const lk = chans.find((c) => c.id === channel && c.status === 'working');
      if (!lk) return { error: 'That channel is not linked yet — send the code from it first.', status: 400 };
      S.ping = { id: 'pg' + newId(), channel, at: Date.now(), pong: 0 }; await save(ctx, S);
      try { await deps.send(channel, lk.linked.id, 'Setup test from J.A.R.V.I.S.: reply with anything — a word is enough — and the pairing is confirmed.', ctx); } catch (e) { S.ping = null; await save(ctx, S); return { error: 'Could not send through ' + lk.name + ': ' + e.message, status: 502 }; }
      return { ok: true, ping: S.ping, waiting: true };
    }
    if (op === 'status') return { ok: true, ping: S.ping || null, done: !!(S.steps.channel && S.steps.channel.status === 'done') };
    return { error: 'code, test or status.', status: 400 };
  }
  if (step === 'delivery') {
    const where = str(b.where, 20); const chans = await deps.channels(uid);
    if (!(where === 'app' || where === 'push' || chans.some((c) => c.id === where && c.status === 'working'))) return { error: 'Choose the app, push, or a linked channel.', status: 400 };
    await ctx.set('team:delivery', where); mark(S, 'delivery', 'done', { where }); await save(ctx, S);
    await deps.log(ctx, 'jarvis', 'Setup: results and briefings go to ' + (where === 'app' ? 'the app' : where === 'push' ? 'push notifications' : where) + ' by default.');
    return { ok: true, where };
  }
  if (step === 'tools') { mark(S, 'tools', 'done', { at: Date.now() }); await save(ctx, S); return { ok: true }; }
  if (step === 'tour') {
    const seen = Array.isArray(b.seen) ? b.seen.filter((x) => TOUR.some((t) => t.id === x)) : TOUR.map((t) => t.id);
    mark(S, 'tour', seen.length >= TOUR.length ? 'done' : 'todo', { seen }); await save(ctx, S); return { ok: true, seen };
  }
  if (step === 'first') {
    const f = FIRST.find((x) => x.id === str(b.which, 20)); if (!f) return { error: 'Which first task?', status: 400 };
    const conn = await deps.connectors(uid, ctx); const gmail = conn.connectors.find((c) => /gmail/i.test(c.name) && c.status !== 'not_built');
    if (f.needs === 'gmail' && !(gmail && gmail.status === 'working')) return { error: 'Gmail is not connected, so the inbox cannot be read yet. It needs a Google OAuth client (id and secret in Render) — only you can create it. Pick one of the two tasks on your own record for now.', status: 409, needs: 'gmail' };
    const specialists = list.filter((a) => !a.archived && a.id !== 'jarvis'); const who = specialists.find((a) => a.id === str(b.agent, 40)) || specialists[0];
    if (!who) return { error: 'There is no specialist to give it to; add an agent first.', status: 400 };
    const t = await deps.newTask(ctx, uid, { title: f.title, brief: f.brief, agent: who.id, by: 'you', lang: 'en', via: str(b.via, 20) || 'setup', readOnly: true, steps: [{ agent: who.id, title: f.title, brief: f.brief }] });
    mark(S, 'first', 'running', { task: t.id, which: f.id, agent: who.id }); await save(ctx, S);
    await deps.log(ctx, 'jarvis', 'Setup: first task "' + f.title + '" given to ' + who.name + ' (read-only).');
    return { ok: true, task: t };
  }
  if (step === 'inbox') {
    if (op === 'skip') { mark(S, 'inbox', 'skipped'); await save(ctx, S); return { ok: true, skipped: true }; }
    if (op === 'unskip') { mark(S, 'inbox', 'todo'); await save(ctx, S); return { ok: true }; }
    const conn = await deps.connectors(uid, ctx); const gmail = conn.connectors.find((c) => /gmail/i.test(c.name) && c.status !== 'not_built');
    const plan = { scope: str(b.scope, 200) || 'the last 7 days of the inbox', rules: ['Newsletters and notifications → label "Later", archive', 'Receipts and invoices → label "Finance"', 'Anything that asks you for something → stays in the inbox, listed in the report', 'Nothing is deleted; nothing is replied to'], readOnlyFirst: true, report: ['how many messages were looked at', 'how many moved, by rule', 'what still needs you, one line each', 'what it was unsure about'] };
    if (!(gmail && gmail.status === 'working')) return { error: 'Gmail is not connected, so this waits. The plan is ready: it will run read-only first, show you the scope and the rules, and move nothing until you approve the list.', status: 409, needs: 'gmail', plan };
    return { error: 'The inbox workflow runs once Gmail reading is built; the plan is kept.', status: 501, plan };
  }
  if (step === 'ready') {
    if (op === 'finish') { const V = await view(ctx, deps, uid); if (!V.readyNow) return { error: 'Not yet: ' + V.checklist.filter((c) => !c.soft && !c.ok).map((c) => c.item).join('; ') + '.', status: 409, checklist: V.checklist }; S.completedAt = Date.now(); mark(S, 'ready', 'done'); await save(ctx, S); await deps.log(ctx, 'jarvis', 'Setup complete: the team is ready.'); return { ok: true, completedAt: S.completedAt }; }
    if (op === 'reset') { await ctx.set('team:setup', { steps: {} }); return { ok: true, reset: true }; }
    return { error: 'finish or reset.', status: 400 };
  }
  return { error: 'Which step?', status: 400 };
}

/* For the channels: progress in a few lines, and the first task from a chat. */
async function text(ctx, deps, uid) {
  const V = await view(ctx, deps, uid);
  const mark_ = (s) => s.status === 'done' ? '✓' : s.status === 'skipped' ? '–' : s.status === 'attention' ? '!' : s.status === 'running' ? '…' : '○';
  return 'Setup · ' + V.progress.done + ' of ' + V.progress.total + '\n' + V.steps.map((s, i) => mark_(s) + ' ' + (i + 1) + '. ' + s.title + (s.status !== 'done' && s.note ? ' — ' + str(s.note, 90) : '')).join('\n') + (V.completedAt ? '\nReady.' : '\nContinue in the command centre → Setup. "/setup first" runs the first task from here.');
}

async function handle(p, req, res, ctx, deps) {
  if (p.indexOf('/api/team/setup') !== 0) return false;
  const json = ctx.json; const uid = ctx.user && ctx.user.id;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };
  const out = (r) => { if (r && r.error) json(res, r.status || 400, r); else json(res, 200, r); return true; };
  if (p === '/api/team/setup' && req.method === 'GET') return out(await view(ctx, deps, uid));
  if (p === '/api/team/setup' && req.method === 'POST') return out(await act(ctx, deps, uid, await body()));
  return false;
}

module.exports = { handle, view, act, pong, text, STEPS, TITLES, TOUR, FIRST, BILLING, CAPS };
