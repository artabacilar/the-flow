/* Projects, and what J.A.R.V.I.S. does with a meeting.
 *
 * Fathom records a call; flow-meetings files it (ld_meetings). This module
 * is what happens next, without being asked:
 *
 *   · J.A.R.V.I.S. reads the meeting — title, people, summary, action items
 *     — against what the team already knows and the projects already open.
 *   · What is worth remembering for the business goes into the team's
 *     knowledge (shared, current, with the meeting as its source), so every
 *     agent and every later answer can use it.
 *   · The meeting is filed under a project: an existing one when it is the
 *     same initiative, a new one when it is not. The project's state is
 *     updated — where it stands, its health, the next steps.
 *   · Work the team can do (research, drafts, analysis, plans, documents,
 *     emails prepared for approval) is delegated to the agent whose role
 *     fits and starts at once. Nothing goes out to the world without his
 *     yes: an email an agent proposes still waits in "Needs your yes".
 *   · He is told what happened, on his phone and his linked channels.
 *
 * Projects (team:projects) are also his to edit: rename, pause, finish,
 * add a note. Each one shows its meetings, its tasks and how far they are,
 * and what was learned — the command centre's Projects view.
 *
 * GET  /api/team/projects                 → { projects, meetings, settings }
 * POST /api/team/projects {op}            → process | update | note | remove | settings | rescan
 */
const crypto = require('crypto');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');
const HEALTH = ['on_track', 'at_risk', 'blocked'];
const STATUS = ['active', 'paused', 'done'];
const MAX_TASKS = 6, MAX_FACTS = 12, MAX_PROJECTS = 80;

async function projects(ctx) { const v = await ctx.get('team:projects'); return Array.isArray(v) ? v : []; }
async function saveProjects(ctx, list) { await ctx.set('team:projects', list.slice(-MAX_PROJECTS)); }
async function processed(ctx) { const v = await ctx.get('team:meetproc'); return v && typeof v === 'object' ? v : {}; }
async function settings(ctx) { const v = await ctx.get('team:projects:settings'); return Object.assign({ auto: true, delegate: true }, v && typeof v === 'object' ? v : {}); }
async function meetingsOf(ctx) { const v = await ctx.get('ld_meetings'); return Array.isArray(v) ? v : []; }

/* ---------- reading a meeting -------------------------------------------- */
function system(owner) {
  return [
    'You are J.A.R.V.I.S., chief of staff to ' + (owner || 'the owner') + ', who runs ABKO and other ventures. A meeting he recorded has just come in. Read it like a sharp chief of staff and decide what happens next — he has asked you to act on it without asking him.',
    'Return ONLY one valid JSON object (no prose, no code fence; escape any double quote inside a string as \\"):',
    '{',
    '  "summary": "two sentences: what was decided and why it matters for the business",',
    '  "projects": [ { "id": "an existing project id, or empty", "name": "short project name (only for a new one)", "goal": "one sentence (only for a new one)", "status": "where it stands after this meeting, one or two sentences", "health": "on_track | at_risk | blocked", "next": ["the next steps, short, up to 5"] } ],',
    '  "facts": [ { "text": "one self-contained sentence worth remembering for the business", "kind": "fact | rule | preference" } ],',
    '  "delegate": [ { "agent": "an agent id from TEAM", "title": "short", "brief": "everything needed to do it well: the context from the meeting, who is involved, what a good result looks like, any deadline said", "project": "the project id or name it belongs to" } ],',
    '  "ideas": [ { "title": "an improvement or opportunity for ABKO you noticed", "why": "one sentence" } ],',
    '  "mine": [ { "title": "something HE has to do himself — a call, a visit, a decision, a reply", "date": "YYYY-MM-DD when one was said, else empty", "time": "HH:MM or empty", "note": "who and why, one line" } ]',
  '  "assign": [ { "person": "a person id from PEOPLE", "title": "what they are to do, short", "date": "YYYY-MM-DD when one was said, else empty", "project": "a project id or name", "note": "the detail that matters, one line" } ],',
    '}',
    'Rules:',
    '· Projects: file the meeting under an existing project when it is the same client, deal or initiative; make a new one only for a distinct initiative. Usually one project, at most three.',
    '· Facts (at most ' + MAX_FACTS + '): who people are and their role, customers and partners, prices, terms, volumes, decisions, dates, commitments, preferences, how things are done at ABKO. Exact numbers and names. Nothing secret (passwords, card numbers). Skip what TEAM KNOWS already says.',
    '· Delegate (at most ' + MAX_TASKS + '): work the team can do now — research, competitor or market checks, drafts, proposals, follow-up emails prepared for his approval, plans, analyses, documents, CRM notes, preparing the next meeting. Not his own calls, visits or meetings (those stay his). Pick the agent whose role fits; "jarvis" only when no specialist does. A brief must stand on its own: the agent did not hear the meeting.',
    '· Ideas (at most 3): what would grow the business or fix a weak spot you can see from this meeting. When one is clearly worth doing now, also delegate it.',
    '· The meeting may be in Turkish, English or both: understand both; write briefs and facts in the language the meeting mostly used.',
    '· Mine (at most 10): only what he himself agreed or was asked to do, in the words of the meeting. Dates relative to TODAY when it says "Friday" or "next week"; empty when none was said.',
    '· It may be a recording or a video rather than a meeting with notes: then the TRANSCRIPT is what was said (speakers may be labelled "Speaker 1", "Speaker 2" — he is usually the one asking or deciding). Work from it the same way.',
    '· Assign (at most 10): an action item for one of PEOPLE (his colleagues — real people, not the AI team), only when the meeting gives it to them or it plainly falls in their role. They wait for his yes before they reach the person. Empty when PEOPLE is empty or none fit.',
    '· Never invent: if the meeting does not say it, it is not a fact.'
  ].join('\n');
}
function userMsg(m, list, agents, know, people) {
  return [
    'PEOPLE (his colleagues — id | name | role):', (people || []).length ? people.map((p) => p.id + ' | ' + p.name + ' | ' + p.role).join('\n') : '(none)',
    '', 'TEAM (id | name | role):', agents.map((a) => a.id + ' | ' + a.name + ' | ' + a.role).join('\n') || '(only jarvis)',
    '', 'PROJECTS (id | name | goal | where it stands):', list.length ? list.filter((p) => p.status !== 'done').map((p) => p.id + ' | ' + p.name + ' | ' + str(p.goal, 160) + ' | ' + str(p.state, 200)).join('\n') : '(none yet)',
    '', 'TEAM KNOWS (current, shared):', know.length ? know.slice(-60).map((k) => '- ' + str(k.text, 200)).join('\n') : '(nothing yet)',
    '', 'MEETING: ' + m.title + ' — ' + (m.at || ''),
    'People: ' + ((m.people || []).map((p) => (p.name || p.email) + (p.ext ? ' (external)' : '')).join(', ') || '(not listed)'),
    'Action items: ' + ((m.actions || []).length ? m.actions.map((a) => '- ' + a.text + (a.who ? ' [' + a.who + ']' : '') + (a.done ? ' (done)' : '')).join('\n') : '(none)'),
    'TODAY: ' + new Date().toISOString().slice(0, 10),
    m.note ? 'He said about it: ' + block(m.note, 600) : '',
    'Summary:', block(m.summary, 9000) || '(no summary)',
    m.transcript ? 'TRANSCRIPT:\n' + block(m.transcript, 60000) : ''
  ].join('\n');
}

/* Tests and the stand-in: a plain reading with no model. */
function fakeRead(m, list, agents) {
  const words = (m.title || 'Meeting').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const hit = list.find((p) => p.status !== 'done' && words && p.name.toLowerCase().indexOf(words.split(/\s+/)[0].toLowerCase()) >= 0);
  const sentences = String(m.summary || m.transcript || '').replace(/[#*>_`-]/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 25);
  const pick = (re) => (agents.find((a) => re.test(a.role + ' ' + a.name)) || agents.find((a) => a.id !== 'jarvis') || { id: 'jarvis' }).id;
  return {
    summary: sentences.slice(0, 2).join(' ') || m.title,
    projects: [hit ? { id: hit.id, status: 'Discussed in "' + m.title + '".', health: 'on_track', next: (m.actions || []).slice(0, 3).map((a) => a.text) } : { name: words || 'Meeting follow-up', goal: 'Follow up "' + m.title + '".', status: 'Started from "' + m.title + '".', health: 'on_track', next: (m.actions || []).slice(0, 3).map((a) => a.text) }],
    facts: sentences.slice(0, 3).map((s) => ({ text: s, kind: 'fact', quote: s.slice(0, 120) })),
    delegate: (m.actions || []).filter((a) => !a.mine && !a.done).slice(0, 3).map((a) => ({ agent: pick(/sales|advert|market|support|customer/i), title: str(a.text, 80), brief: 'From the meeting "' + m.title + '": ' + a.text, project: hit ? hit.id : (words || 'Meeting follow-up') })),
    ideas: [],
    mine: (m.actions || []).filter((a) => a.mine && !a.done).map((a) => a.text).concat((String(m.transcript || '').match(/(?:^|\n)(?:Speaker \d+: )?(?:I will|I'll) [^.\n]+/g) || []).map((x) => x.replace(/^\n?(?:Speaker \d+: )?(?:I will|I'll) /, ''))).slice(0, 5).map((t) => ({ title: str(t.charAt(0).toUpperCase() + t.slice(1), 100), date: (t.match(/\d{4}-\d{2}-\d{2}/) || [''])[0], time: '', note: 'From "' + m.title + '"' }))
  };
}

function cleanRead(j, agentIds) {
  if (!j || typeof j !== 'object') return null;
  const out = {
    summary: str(j.summary, 600),
    projects: (Array.isArray(j.projects) ? j.projects : []).slice(0, 3).map((p) => ({ id: str(p && p.id, 40), name: str(p && p.name, 80), goal: str(p && p.goal, 300), status: str(p && p.status, 500), health: HEALTH.indexOf(p && p.health) >= 0 ? p.health : 'on_track', next: (Array.isArray(p && p.next) ? p.next : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 5) })).filter((p) => p.id || p.name),
    facts: (Array.isArray(j.facts) ? j.facts : []).map((f) => ({ text: str(f && f.text, 300), kind: ['fact', 'rule', 'preference'].indexOf(f && f.kind) >= 0 ? f.kind : 'fact', quote: str(f && f.quote, 240) })).filter((f) => f.text.length > 8 && !/password|şifre|card number|kart numarası|\b\d{13,19}\b/i.test(f.text)).slice(0, MAX_FACTS),
    delegate: (Array.isArray(j.delegate) ? j.delegate : []).map((d) => ({ agent: agentIds.indexOf(str(d && d.agent, 40)) >= 0 ? str(d.agent, 40) : 'jarvis', title: str(d && d.title, 100), brief: block(d && d.brief, 3000), project: str(d && d.project, 80) })).filter((d) => d.title && d.brief.length > 20).slice(0, MAX_TASKS),
    ideas: (Array.isArray(j.ideas) ? j.ideas : []).map((i) => ({ title: str(i && i.title, 140), why: str(i && i.why, 300) })).filter((i) => i.title).slice(0, 3),
    assign: (Array.isArray(j.assign) ? j.assign : []).map((x) => ({ person: str(x && x.person, 40), title: str(x && x.title, 160), date: /^\d{4}-\d{2}-\d{2}$/.test(String(x && x.date || '')) ? x.date : '', project: str(x && x.project, 80), note: str(x && x.note, 300) })).filter((x) => x.person && x.title).slice(0, 10),
    mine: (Array.isArray(j.mine) ? j.mine : []).map((x) => ({ title: str(x && x.title, 120), date: /^\d{4}-\d{2}-\d{2}$/.test(String(x && x.date || '')) ? x.date : '', time: /^\d{1,2}:\d{2}$/.test(String(x && x.time || '')) ? x.time : '', note: str(x && x.note, 300) })).filter((x) => x.title).slice(0, 10)
  };
  return out;
}

/* ---------- acting on it -------------------------------------------------- */
/* One meeting at a time per person: each reading rewrites the project list. */
const queues = new Map();
function processMeeting(ctx, deps, uid, m, opts) {
  const key = uid || (ctx.user && ctx.user.id) || '';
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => readMeeting(ctx, deps, uid, m, opts));
  queues.set(key, next); next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}
async function readMeeting(ctx, deps, uid, m, opts) {
  opts = opts || {};
  const done = await processed(ctx);
  if (done[m.id] && !opts.again) return { skipped: 'already', record: done[m.id] };
  if ((await ctx.get('team:paused')) === true) return { error: 'The team is paused.', status: 423 };
  const st = await settings(ctx);
  const agentList = (await deps.agents(ctx)).filter((a) => !a.archived);
  const know = (await deps.knowledge(ctx)).filter((k) => k && k.status !== 'superseded' && (k.scope || 'shared') === 'shared');
  let list = await projects(ctx);
  const owner = ctx.user && (ctx.user.name || ctx.user.email);
  let read = null;
  if (deps.fake) read = fakeRead(m, list, agentList);
  let people = []; try { if (deps.orgPeople) people = await deps.orgPeople(ctx); } catch (e) {}
  if (deps.fake) read.assign = (m.actions || []).filter((a) => a.who && !a.done && people.some((p) => p.name.split(' ')[0].toLowerCase() === String(a.who).split(' ')[0].toLowerCase())).map((a) => ({ person: a.who, title: a.text, date: '', project: '', note: '' }));
  else read = await deps.modelJson(ctx, system(owner), userMsg(m, list, agentList, know, people), 8000);
  read = cleanRead(read, agentList.map((a) => a.id));
  if (!read) { const w = ctx.lastModelError || 'no answer'; if (deps.log) await deps.log(ctx, 'jarvis', 'Could not read "' + m.title + '": ' + w); return { error: 'J.A.R.V.I.S. could not read that meeting just now: ' + w + '. Press "Let him read it" to try again.', status: 502 }; }

  const now = Date.now();
  /* 1. projects */
  const touched = [];
  for (const p of read.projects) {
    let pr = p.id && list.find((x) => x.id === p.id);
    if (!pr && p.name) pr = list.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (!pr) {
      pr = { id: 'pr' + newId(), name: p.name || m.title, goal: p.goal || '', status: 'active', health: p.health, state: '', next: [], meetings: [], tasks: [], notes: [], facts: [], createdAt: now, updatedAt: now, by: 'jarvis' };
      list.push(pr);
    }
    if (pr.status === 'done') pr.status = 'active';
    pr.state = p.status || pr.state; pr.health = p.health || pr.health;
    if (p.next.length) pr.next = p.next;
    if (pr.meetings.indexOf(m.id) < 0) pr.meetings.push(m.id);
    pr.timeline = (pr.timeline || []).concat([{ at: now, kind: 'meeting', meeting: m.id, title: m.title, text: p.status || read.summary }]).slice(-40);
    pr.updatedAt = now;
    touched.push(pr);
  }
  const home = touched[0] || null;
  const projectFor = (ref) => (ref && (list.find((x) => x.id === ref) || list.find((x) => x.name.toLowerCase() === String(ref).toLowerCase()))) || home;

  /* 2. what to remember */
  let added = 0; const factIds = [];
  if (read.facts.length && deps.addKnowledge) {
    const r = await deps.addKnowledge(ctx, read.facts.map((f) => ({ text: f.text, kind: f.kind, quote: f.quote })), { id: 'meet:' + m.id, title: 'Meeting: ' + m.title + (m.at ? ' (' + String(m.at).slice(0, 10) + ')' : ''), url: m.url || '' });
    added = r.added; factIds.push(...r.ids);
    if (home) home.facts = (home.facts || []).concat(r.ids).slice(-60);
  }

  /* 3. the work, started */
  const started = [];
  if (st.delegate !== false && !opts.noTasks) {
    for (const d of read.delegate) {
      const pr = projectFor(d.project);
      try {
        const t = await deps.newTask(ctx, uid, { title: d.title, brief: d.brief, agent: d.agent, by: 'jarvis', lang: 'en', steps: [{ agent: d.agent, title: d.title, brief: d.brief }], via: 'meeting', from: { meeting: m.id, title: m.title }, project: pr ? pr.id : '' });
        started.push({ id: t.id, agent: d.agent, title: d.title, project: pr ? pr.id : '' });
        if (pr && pr.tasks.indexOf(t.id) < 0) pr.tasks.push(t.id);
      } catch (e) { if (deps.log) await deps.log(ctx, 'jarvis', 'Could not start "' + d.title + '": ' + e.message); break; }
    }
  }
  /* read again without new work: the work this meeting already started stays filed under it */
  if (opts.noTasks && home) { try { for (const t of await deps.tasks(ctx)) if (t.from && t.from.meeting === m.id && home.tasks.indexOf(t.id) < 0) home.tasks.push(t.id); } catch (e) {} }
  /* his own action items, on his week — for recordings (a Fathom meeting's are filed by the app already) */
  const rocks = [];
  if (opts.mine && deps.addRock) {
    for (const x of read.mine) {
      try { const r = await deps.addRock(ctx, uid, { title: x.title, day: x.date || 'today', time: x.time || '', note: [x.note, 'From "' + m.title + '"'].filter(Boolean).join(' · ') }); rocks.push({ title: x.title, date: (r && r.on) || x.date || 'today' }); }
      catch (e) { if (deps.log) await deps.log(ctx, 'jarvis', 'Could not add "' + x.title + '": ' + e.message); }
    }
  }
  if (home && read.ideas.length) home.ideas = read.ideas.concat(home.ideas || []).slice(0, 8);
  await saveProjects(ctx, list);
  /* his colleagues' action items: proposals on the Projects page, for his yes */
  let proposed = [];
  if (deps.orgPropose && read.assign && read.assign.length && !opts.noTasks) { try { proposed = await deps.orgPropose(ctx, read.assign, m, home); } catch (e) {} }

  const rec = { at: now, title: m.title, meetingAt: m.at, summary: read.summary, projects: touched.map((p) => p.id), tasks: started.map((t) => t.id), facts: added, ideas: read.ideas, rocks, proposed };
  done[m.id] = rec;
  const keys = Object.keys(done); if (keys.length > 200) for (const k of keys.sort((a, b) => done[a].at - done[b].at).slice(0, keys.length - 200)) delete done[k];
  await ctx.set('team:meetproc', done);

  const names = (id) => (agentList.find((a) => a.id === id) || { name: id }).name;
  const line = 'From "' + m.title + '": ' + (started.length ? started.length + ' task' + (started.length === 1 ? '' : 's') + ' started (' + started.map((t) => names(t.agent) + ': ' + t.title).join('; ') + ')' : 'no work to hand out') +
    (rocks.length ? ', ' + rocks.length + ' on your week (' + rocks.map((r) => r.title).join('; ') + ')' : '') + (added ? ', ' + added + ' thing' + (added === 1 ? '' : 's') + ' remembered' : '') + (touched.length ? ', project ' + touched.map((p) => '"' + p.name + '"').join(' and ') + ' updated' : '') + '.';
  if (deps.log) await deps.log(ctx, 'jarvis', line);
  if (deps.notify && !opts.quiet) { try { await deps.notify(uid, ctx, line + (read.summary ? '\n\n' + read.summary : ''), { meeting: m.id }); } catch (e) {} }
  return { ok: true, meeting: m.id, summary: read.summary, projects: touched.map((p) => ({ id: p.id, name: p.name })), tasks: started, facts: added, ideas: read.ideas, rocks, say: line };
}

/* A meeting is "fresh" for J.A.R.V.I.S. when it was recorded in the last
   three days and he has not read it: older ones are history, offered in
   the view but never acted on by themselves. */
async function onFiled(ctx, deps, uid, list) {
  const st = await settings(ctx); if (!st.auto) return [];
  const done = await processed(ctx); const out = [];
  for (const m of list) {
    if (!m || !m.id || done[m.id] || m.legacy) continue;
    if (m.at && Date.now() - Date.parse(m.at) > 3 * 86400000) continue;
    try { out.push(await processMeeting(ctx, deps, uid, m)); } catch (e) { if (deps.log) await deps.log(ctx, 'jarvis', 'Meeting "' + m.title + '" not read: ' + e.message); }
  }
  return out;
}

/* ---------- the view ------------------------------------------------------ */
async function view(ctx, deps) {
  const [list, done, st, meets, tl] = await Promise.all([projects(ctx), processed(ctx), settings(ctx), meetingsOf(ctx), deps.tasks(ctx)]);
  const byId = new Map(tl.map((t) => [t.id, t]));
  const know = await deps.knowledge(ctx); const kById = new Map(know.map((k) => [k.id, k]));
  const out = list.map((p) => {
    const ts = p.tasks.map((id) => byId.get(id)).filter(Boolean).map((t) => ({ id: t.id, title: t.title, agent: t.agent, status: t.status, updatedAt: t.updatedAt, result: str(t.result, 400) }));
    const finished = ts.filter((t) => t.status === 'done').length, live = ts.filter((t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled').length;
    return Object.assign({}, p, {
      taskList: ts.reverse(), counts: { tasks: ts.length, done: finished, open: live, waiting: ts.filter((t) => t.status === 'awaiting_approval' || t.status === 'awaiting_info').length, meetings: p.meetings.length },
      progress: ts.length ? Math.round(finished / ts.length * 100) : 0,
      meetingList: p.meetings.map((id) => { const m = meets.find((x) => x.id === id); const r = done[id]; return { id, title: m ? m.title : (r ? r.title : id), at: m ? m.at : (r ? r.meetingAt : ''), url: m ? m.url : '', summary: r ? r.summary : '' }; }).reverse(),
      factList: (p.facts || []).map((id) => kById.get(id)).filter((k) => k && k.status !== 'superseded').map((k) => ({ id: k.id, text: k.text })).slice(-20)
    });
  }).sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.updatedAt - a.updatedAt);
  const meetings = meets.slice(-12).reverse().map((m) => ({ id: m.id, title: m.title, at: m.at, url: m.url, actions: (m.actions || []).length, read: !!done[m.id], readAt: done[m.id] ? done[m.id].at : 0, summary: done[m.id] ? done[m.id].summary : '', tasks: done[m.id] ? done[m.id].tasks.length : 0 }));
  return { ok: true, projects: out, meetings, settings: st };
}

/* ---------- the routes ---------------------------------------------------- */
async function handle(p, req, res, ctx, deps) {
  if (p !== '/api/team/projects') return false;
  const json = ctx.json;
  if (req.method === 'GET') { json(res, 200, await view(ctx, deps)); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'GET or POST.' }); return true; }
  let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  const uid = ctx.user && ctx.user.id;
  if (b.op === 'process') {
    const m = (await meetingsOf(ctx)).find((x) => x.id === String(b.meeting || ''));
    if (!m) { json(res, 404, { error: 'That meeting is not in The Flow yet. It arrives from Fathom within ten minutes of its notes.' }); return true; }
    const r = await processMeeting(ctx, deps, uid, m, { again: !!b.again, noTasks: !!b.noTasks });
    if (r.error) { json(res, r.status || 400, r); return true; }
    json(res, 200, Object.assign({ ok: true }, r, { view: await view(ctx, deps) })); return true;
  }
  if (b.op === 'settings') {
    const st = await settings(ctx);
    if ('auto' in b) st.auto = !!b.auto; if ('delegate' in b) st.delegate = !!b.delegate;
    await ctx.set('team:projects:settings', st); json(res, 200, { ok: true, settings: st }); return true;
  }
  const list = await projects(ctx);
  if (b.op === 'create') {
    const name = str(b.name, 80); if (!name) { json(res, 400, { error: 'Give the project a name.' }); return true; }
    const pr = { id: 'pr' + newId(), name, goal: str(b.goal, 300), status: 'active', health: 'on_track', state: '', next: [], meetings: [], tasks: [], notes: [], facts: [], createdAt: Date.now(), updatedAt: Date.now(), by: 'you' };
    list.push(pr); await saveProjects(ctx, list); json(res, 200, { ok: true, project: pr }); return true;
  }
  const pr = list.find((x) => x.id === String(b.id || ''));
  if (!pr) { json(res, 404, { error: 'No such project.' }); return true; }
  if (b.op === 'update') {
    if (b.name != null && str(b.name, 80)) pr.name = str(b.name, 80);
    if (b.goal != null) pr.goal = str(b.goal, 300);
    if (STATUS.indexOf(b.status) >= 0) pr.status = b.status;
    if (HEALTH.indexOf(b.health) >= 0) pr.health = b.health;
    pr.updatedAt = Date.now(); await saveProjects(ctx, list); json(res, 200, { ok: true, project: pr }); return true;
  }
  if (b.op === 'note') {
    const text = block(b.text, 2000); if (!text) { json(res, 400, { error: 'Write the note first.' }); return true; }
    pr.timeline = (pr.timeline || []).concat([{ at: Date.now(), kind: 'note', text, by: 'you' }]).slice(-40); pr.updatedAt = Date.now();
    await saveProjects(ctx, list); json(res, 200, { ok: true, project: pr }); return true;
  }
  if (b.op === 'remove') { await saveProjects(ctx, list.filter((x) => x.id !== pr.id)); json(res, 200, { ok: true }); return true; }
  json(res, 400, { error: 'process, create, update, note, remove or settings.' }); return true;
}

/* For J.A.R.V.I.S.'s own prompt: the open projects, one line each. */
async function brief(ctx) {
  const list = (await projects(ctx)).filter((p) => p.status !== 'done').slice(-20);
  return list.map((p) => p.id + ' | ' + p.name + ' | ' + (p.health || 'on_track') + ' | ' + str(p.state, 220) + (p.next && p.next.length ? ' | next: ' + p.next.slice(0, 3).join('; ') : '')).join('\n');
}

module.exports = { handle, processMeeting, onFiled, view, brief, projects, _internals: { system, userMsg, cleanRead, fakeRead } };
