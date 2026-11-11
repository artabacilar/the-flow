/* The organisation: companies, their projects, the people on them, and the
 * work the people do.
 *
 * He runs several companies (ABKO, Revelle AI, Yuum, BiovaLab…). Each one
 * is a page of its own; inside it, its projects; inside a project, its
 * people and their tasks — To do, In progress, Blocked, Done — with
 * comments and a record of who changed what.
 *
 * Who sees what: the owner sees everything. A colleague (an employee who
 * signed in with an access code) sees only the projects they are on — and
 * the companies those projects belong to — and on those projects, every
 * task, so the people on a project can see who is doing what and help.
 * They change the status of a task, comment on it, and add tasks; only the
 * owner removes a task someone else made, gives work to another person,
 * or changes who is on a project.
 *
 * J.A.R.V.I.S.: a task can be given by voice ("give Eren the Goldwell
 * login bug for Friday"); a meeting's action items for a colleague arrive
 * as proposals the owner approves; every morning a colleague with a late
 * task gets one reminder, and on Monday the owner gets each person's week.
 *
 *   team:org = { companies: [{ id, name, color, about, at }],
 *                people:    [{ id, name, email, role, uid, at }],
 *                tasks:     [{ id, title, note, company, project, person, due, status, pending, source,
 *                              by: { name, uid }, at, upd, doneAt, comments: [{ id, name, text, at }], log: [{ at, name, what }] }],
 *                nudged: { <taskId>: 'YYYY-MM-DD' }, ticks: { day, monday } }
 *   team:projects[i].company, .people — which company a project belongs to, and who is on it
 *
 * GET  /api/team/org            → what this viewer may see
 * GET  /api/team/org?mine=1     → this viewer's own open tasks (for Today)
 * POST /api/team/org { op }     → company | person | project | task | comment | pending
 */
'use strict';
const crypto = require('crypto');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = (p) => p + crypto.randomBytes(5).toString('hex');
const STATUS = ['todo', 'doing', 'blocked', 'done'];
const STATUS_NAME = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', done: 'Done' };
const COLORS = ['#3ab0ff', '#7ad6a8', '#ffb35c', '#c79bff', '#ff7a8a', '#5fe0d8', '#f2d45c'];
const MAX_TASKS = 2000, MAX_COMMENTS = 200, MAX_LOG = 60;
const PRIO = ['high', 'med', 'low'];
/* a task's checklist and links, as the Work page keeps them */
const cleanItems = (v) => (Array.isArray(v) ? v : []).slice(0, 100).map((a) => ({ text: str(a && a.text, 500), done: !!(a && a.done), note: block(a && a.note, 2000) })).filter((a) => a.text);
const cleanLinks = (v) => (Array.isArray(v) ? v : []).slice(0, 50).map((l) => str(l, 500)).filter((l) => /^https?:\/\//i.test(l));
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

async function load(ctx) {
  const v = await ctx.get('team:org');
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return { companies: Array.isArray(o.companies) ? o.companies : [], people: Array.isArray(o.people) ? o.people : [],
    tasks: Array.isArray(o.tasks) ? o.tasks : [], nudged: o.nudged && typeof o.nudged === 'object' ? o.nudged : {}, ticks: o.ticks && typeof o.ticks === 'object' ? o.ticks : {} };
}
async function save(ctx, o) {
  if (o.tasks.length > MAX_TASKS) { const keep = o.tasks.filter((t) => t.status !== 'done'); const done = o.tasks.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)); o.tasks = keep.concat(done.slice(0, Math.max(0, MAX_TASKS - keep.length))); }
  await ctx.set('team:org', o);
}
async function projectsOf(ctx) { const v = await ctx.get('team:projects'); return Array.isArray(v) ? v : []; }
async function saveProjects(ctx, list) { await ctx.set('team:projects', list); }

/* who is looking: the owner, or the person a colleague's account is */
function whoIs(ctx, o) {
  const V = ctx.viewer || {};
  if (!V.member) return { owner: true, person: null, name: (ctx.user && ctx.user.name) || 'Owner', uid: ctx.user && ctx.user.id };
  const email = String(V.email || '').toLowerCase();
  let p = o.people.find((x) => x.uid && x.uid === V.id) || (email ? o.people.find((x) => String(x.email || '').toLowerCase() === email) : null);
  return { owner: false, person: p || null, name: V.name || (p && p.name) || 'Colleague', uid: V.id, email };
}
function onProject(pr, personId) { return !!personId && Array.isArray(pr.people) && pr.people.indexOf(personId) >= 0; }
function canSeeTask(w, t, prs) {
  if (w.owner) return true;
  if (!w.person) return false;
  if (t.pending) return false;
  if (t.person === w.person.id) return true;
  const pr = t.project && prs.find((x) => x.id === t.project);
  return !!(pr && onProject(pr, w.person.id));
}
const late = (t, today) => t.status !== 'done' && isDate(t.due) && t.due < today;
function todayIn(tz) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
function counts(list, today) {
  const wk = Date.now() - 7 * 86400000;
  return { open: list.filter((t) => t.status !== 'done').length, todo: list.filter((t) => t.status === 'todo').length, doing: list.filter((t) => t.status === 'doing').length,
    blocked: list.filter((t) => t.status === 'blocked').length, done: list.filter((t) => t.status === 'done').length, doneWeek: list.filter((t) => t.status === 'done' && (t.doneAt || 0) >= wk).length,
    late: list.filter((t) => late(t, today)).length, total: list.length };
}
const pub = (t) => ({ id: t.id, title: t.title, note: t.note || '', prio: PRIO.indexOf(t.prio) >= 0 ? t.prio : 'med', items: t.items || [], links: t.links || [], ord: typeof t.ord === 'number' ? t.ord : null, company: t.company || '', project: t.project || '', person: t.person || '', due: t.due || '', status: t.status, pending: !!t.pending,
  source: t.source || null, by: t.by ? { name: t.by.name } : null, at: t.at, upd: t.upd || t.at, doneAt: t.doneAt || 0, comments: (t.comments || []).slice(-50), log: (t.log || []).slice(-20) });

async function view(ctx, opts) {
  opts = opts || {};
  const o = await load(ctx); const prs = await projectsOf(ctx); const w = whoIs(ctx, o);
  /* a colleague's account is tied to their person the first time they look */
  if (!w.owner && w.person && !w.person.uid && w.uid) { w.person.uid = w.uid; await save(ctx, o); }
  const today = todayIn(opts.tz);
  const seeP = prs.filter((p) => w.owner || (w.person && onProject(p, w.person.id)));
  const tasks = o.tasks.filter((t) => canSeeTask(w, t, prs));
  if (opts.mine) {
    const mine = w.person ? tasks.filter((t) => t.person === w.person.id && t.status !== 'done').sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1) : [];
    const pn = (id) => (prs.find((p) => p.id === id) || {}).name || '';
    const cn = (id) => (o.companies.find((c) => c.id === id) || {}).name || '';
    return { ok: true, me: w.person ? { id: w.person.id, name: w.person.name } : null, today, nudge: w.person ? (o.nudged['@' + w.person.id] || null) : null,
      mine: mine.map((t) => Object.assign(pub(t), { projectName: pn(t.project), companyName: cn(t.company), late: late(t, today) })) };
  }
  const seeC = o.companies.filter((c) => w.owner || seeP.some((p) => p.company === c.id) || tasks.some((t) => t.company === c.id));
  const peopleIds = new Set(); seeP.forEach((p) => (p.people || []).forEach((id) => peopleIds.add(id)));
  const people = o.people.filter((p) => w.owner || peopleIds.has(p.id) || (w.person && p.id === w.person.id)).map((p) => Object.assign({ id: p.id, name: p.name, role: p.role || '' },
    w.owner ? { email: p.email || '', linked: !!p.uid } : {}, { counts: counts(tasks.filter((t) => t.person === p.id && !t.pending), today) }));
  const projects = seeP.map((p) => ({ id: p.id, name: p.name, goal: p.goal || '', problem: typeof p.problem === 'string' ? p.problem : '', notes: typeof p.memo === 'string' ? p.memo : '', status: p.status || 'active', health: p.health || 'on_track', state: p.state || '', next: p.next || [],
    company: p.company || '', people: (p.people || []).filter((id) => o.people.some((x) => x.id === id)), updatedAt: p.updatedAt || 0, counts: counts(tasks.filter((t) => t.project === p.id && !t.pending), today) }));
  const companies = seeC.map((c) => ({ id: c.id, name: c.name, color: c.color, about: c.about || '', projects: projects.filter((p) => p.company === c.id).length,
    people: new Set(projects.filter((p) => p.company === c.id).flatMap((p) => p.people)).size, counts: counts(tasks.filter((t) => t.company === c.id && !t.pending), today) }));
  return { ok: true, today, me: { owner: w.owner, person: w.person ? { id: w.person.id, name: w.person.name } : null, name: w.name }, companies, projects, people,
    tasks: tasks.map((t) => Object.assign(pub(t), { late: late(t, today) })), colors: COLORS, status: STATUS_NAME };
}

function addLog(t, name, what) { t.log = (t.log || []).concat([{ at: Date.now(), name: str(name, 60), what: str(what, 200) }]).slice(-MAX_LOG); t.upd = Date.now(); }

/* A new task, checked. Used by the page, by J.A.R.V.I.S. and by a meeting. */
async function addTask(ctx, f, w, deps) {
  const o = await load(ctx); const prs = await projectsOf(ctx);
  const title = str(f.title, 500); if (!title) return { error: 'Give the task a title.', status: 400 };
  let pr = f.project ? prs.find((p) => p.id === String(f.project) || p.name.toLowerCase() === String(f.project).toLowerCase()) : null;
  if (f.project && !pr) return { error: 'No such project.', status: 404 };
  let person = f.person ? o.people.find((p) => p.id === String(f.person) || p.name.toLowerCase() === String(f.person).toLowerCase() || p.name.split(' ')[0].toLowerCase() === String(f.person).toLowerCase()) : null;
  if (f.person && !person) return { error: 'There is no ' + str(f.person, 40) + ' in your people yet. Add them on the Projects page first.', status: 404 };
  if (!w.owner) {
    if (!w.person) return { error: 'You are not on any project yet.', status: 403 };
    if (pr && !onProject(pr, w.person.id)) return { error: 'You are not on that project.', status: 403 };
    if (!pr || !person) person = w.person;
    if (person && person.id !== w.person.id && !(pr && onProject(pr, person.id))) return { error: 'They are not on that project.', status: 403 };
  }
  const company = pr ? (pr.company || '') : (f.company && o.companies.some((c) => c.id === f.company) ? f.company : '');
  const t = { id: newId('t'), title, note: block(f.note, 4000), prio: PRIO.indexOf(f.prio) >= 0 ? f.prio : 'med', items: cleanItems(f.items), links: cleanLinks(f.links), ord: typeof f.ord === 'number' ? f.ord : -Date.now(), company, project: pr ? pr.id : '', person: person ? person.id : '', due: isDate(f.due) ? f.due : '',
    status: STATUS.indexOf(f.status) >= 0 ? f.status : 'todo', pending: !!f.pending, source: f.source || null, by: { name: str(w.name, 60), uid: w.uid || '' }, at: Date.now(), upd: Date.now(), doneAt: 0, comments: [], log: [] };
  if (t.status === 'done') t.doneAt = Date.now();
  addLog(t, w.name, f.pending ? 'proposed' + (f.source && f.source.title ? ' from "' + str(f.source.title, 80) + '"' : '') : 'created' + (person ? ' for ' + person.name : ''));
  o.tasks.push(t); await save(ctx, o);
  if (deps && deps.log && !f.pending) { try { await deps.log(ctx, 'jarvis', 'Task "' + title + '"' + (person ? ' for ' + person.name : '') + (pr ? ' on ' + pr.name : '')); } catch (e) {} }
  if (deps && deps.tell && person && person.uid && !f.pending && (!w.person || person.id !== w.person.id)) { try { await deps.tell(person.uid, 'New task: ' + title, (pr ? pr.name + ' · ' : '') + (t.due ? 'due ' + t.due : 'from ' + w.name)); } catch (e) {} }
  return { ok: true, task: pub(t), person: person ? person.name : '', project: pr ? pr.name : '' };
}

async function handle(p, req, res, ctx, deps) {
  if (p !== '/api/team/org') return false;
  const json = ctx.json; deps = deps || {};
  if (req.method === 'GET') {
    const q = ctx.query; let tz = ''; try { tz = deps.userTz ? await deps.userTz(ctx) : ''; } catch (e) {}
    json(res, 200, await view(ctx, { mine: q && q.get('mine') === '1', tz })); return true;
  }
  if (req.method !== 'POST') { json(res, 405, { error: 'GET or POST.' }); return true; }
  let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  const o = await load(ctx); const prs = await projectsOf(ctx); const w = whoIs(ctx, o);
  const ownerOnly = () => { if (w.owner) return false; json(res, 403, { error: 'Only the owner can do that.' }); return true; };
  const done = async (extra) => json(res, 200, Object.assign({ ok: true }, extra || {}, { view: await view(ctx) }));

  if (b.op === 'company') {
    if (ownerOnly()) return true;
    let c = b.id ? o.companies.find((x) => x.id === b.id) : null;
    if (b.remove) { if (!c) { json(res, 404, { error: 'No such company.' }); return true; } o.companies = o.companies.filter((x) => x !== c); prs.forEach((x) => { if (x.company === c.id) x.company = ''; }); o.tasks.forEach((t) => { if (t.company === c.id) t.company = ''; }); await saveProjects(ctx, prs); await save(ctx, o); await done(); return true; }
    const name = str(b.name, 60);
    if (!c) { if (!name) { json(res, 400, { error: 'Give the company a name.' }); return true; } if (o.companies.some((x) => x.name.toLowerCase() === name.toLowerCase())) { json(res, 409, { error: name + ' is already there.' }); return true; } c = { id: newId('c'), name, color: COLORS[o.companies.length % COLORS.length], about: '', at: Date.now() }; o.companies.push(c); }
    if (name) c.name = name; if (b.about != null) c.about = str(b.about, 300); if (/^#[0-9a-f]{6}$/i.test(String(b.color || ''))) c.color = b.color;
    await save(ctx, o); await done({ company: c }); return true;
  }
  if (b.op === 'person') {
    if (ownerOnly()) return true;
    let x = b.id ? o.people.find((y) => y.id === b.id) : null;
    if (b.remove) { if (!x) { json(res, 404, { error: 'No such person.' }); return true; } o.people = o.people.filter((y) => y !== x); prs.forEach((pr) => { if (Array.isArray(pr.people)) pr.people = pr.people.filter((id) => id !== x.id); }); o.tasks.forEach((t) => { if (t.person === x.id) t.person = ''; }); await saveProjects(ctx, prs); await save(ctx, o); await done(); return true; }
    const name = str(b.name, 60), email = str(b.email, 120).toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { json(res, 400, { error: 'That email does not look right.' }); return true; }
    if (!x) { if (!name) { json(res, 400, { error: 'Give the person a name.' }); return true; } if (email && o.people.some((y) => y.email === email)) { json(res, 409, { error: 'Someone with that email is already there.' }); return true; } x = { id: newId('p'), name, email, role: '', uid: '', at: Date.now() }; o.people.push(x); }
    if (name) x.name = name; if (b.email != null) { if (x.email !== email) x.uid = ''; x.email = email; } if (b.role != null) x.role = str(b.role, 300);
    await save(ctx, o); await done({ person: x }); return true;
  }
  if (b.op === 'project' && !w.owner && b.id) {
    /* the people on a project write its goal, the problem and the running notes with him */
    const pr = prs.find((x) => x.id === b.id);
    if (!pr || !w.person || !onProject(pr, w.person.id)) { json(res, 403, { error: 'Only the owner can do that.' }); return true; }
    const keys = Object.keys(b).filter((k) => ['op', 'id', 'goal', 'problem', 'notes'].indexOf(k) < 0);
    if (keys.length) { json(res, 403, { error: 'Only the owner can do that.' }); return true; }
    if (b.goal != null) pr.goal = str(b.goal, 600); if (b.problem != null) pr.problem = str(b.problem, 600); if (b.notes != null) pr.memo = block(b.notes, 20000);
    pr.updatedAt = Date.now(); await saveProjects(ctx, prs); await done({ project: { id: pr.id, name: pr.name } }); return true;
  }
  if (b.op === 'order') {
    /* the board's order, as dragged: every task on the project, top to bottom */
    const pr = prs.find((x) => x.id === b.project);
    if (!pr || !(w.owner || (w.person && onProject(pr, w.person.id)))) { json(res, 403, { error: 'Not your project.' }); return true; }
    (Array.isArray(b.ids) ? b.ids : []).forEach((id, i) => { const t = o.tasks.find((x) => x.id === id && x.project === pr.id); if (t) t.ord = i; });
    await save(ctx, o); json(res, 200, { ok: true }); return true;
  }
  if (b.op === 'project') {
    if (ownerOnly()) return true;
    let pr = b.id ? prs.find((x) => x.id === b.id) : null;
    if (!pr) {
      const name = str(b.name, 80); if (!name) { json(res, 400, { error: 'Give the project a name.' }); return true; }
      pr = { id: 'pr' + crypto.randomBytes(5).toString('hex'), name, goal: str(b.goal, 300), status: 'active', health: 'on_track', state: '', next: [], meetings: [], tasks: [], notes: [], facts: [], createdAt: Date.now(), updatedAt: Date.now(), by: 'you', company: '', people: [] };
      prs.push(pr);
    }
    if (b.name != null && str(b.name, 80)) pr.name = str(b.name, 80);
    if (b.goal != null) pr.goal = str(b.goal, 600);
    if (b.problem != null) pr.problem = str(b.problem, 600);
    if (b.notes != null) pr.memo = block(b.notes, 20000);
    if (b.company != null) { const c = o.companies.find((x) => x.id === b.company); pr.company = c ? c.id : ''; o.tasks.forEach((t) => { if (t.project === pr.id) t.company = pr.company; }); }
    if (Array.isArray(b.people)) pr.people = b.people.map(String).filter((id, i, a) => o.people.some((x) => x.id === id) && a.indexOf(id) === i);
    if (b.add) { const id = String(b.add); if (o.people.some((x) => x.id === id)) pr.people = (pr.people || []).filter((y) => y !== id).concat([id]); }
    if (b.drop) pr.people = (pr.people || []).filter((y) => y !== String(b.drop));
    pr.updatedAt = Date.now(); await saveProjects(ctx, prs); await save(ctx, o); await done({ project: { id: pr.id, name: pr.name } }); return true;
  }
  if (b.op === 'task' && !b.id) {
    const r = await addTask(ctx, Object.assign({}, b, { pending: false, source: null }), w, deps);
    if (r.error) { json(res, r.status || 400, { error: r.error }); return true; }
    await done(r); return true;
  }
  const t = b.id ? o.tasks.find((x) => x.id === b.id) : null;
  if (!t || !canSeeTask(w, t, prs) && !(w.owner)) { json(res, 404, { error: 'No such task.' }); return true; }
  const mineOrMade = w.owner || (w.person && (t.person === w.person.id)) || (t.by && t.by.uid && t.by.uid === w.uid);
  if (b.op === 'task') {
    if (b.remove) { if (!(w.owner || (t.by && t.by.uid && t.by.uid === w.uid))) { json(res, 403, { error: 'Only the owner, or whoever made it, can remove a task.' }); return true; } o.tasks = o.tasks.filter((x) => x !== t); await save(ctx, o); await done(); return true; }
    const was = t.status;
    if (STATUS.indexOf(b.status) >= 0 && b.status !== t.status) { t.status = b.status; t.doneAt = b.status === 'done' ? Date.now() : 0; addLog(t, w.name, STATUS_NAME[was] + ' → ' + STATUS_NAME[b.status]); if (b.status === 'done') delete o.nudged[t.id]; }
    if (b.title != null && str(b.title, 500) && str(b.title, 500) !== t.title) { if (!mineOrMade) { json(res, 403, { error: 'Only the owner, the person it is for, or whoever made it can rename it.' }); return true; } t.title = str(b.title, 500); addLog(t, w.name, 'renamed'); }
    if (b.note != null && block(b.note, 4000) !== (t.note || '')) { t.note = block(b.note, 4000); addLog(t, w.name, 'changed the note'); }
    if (PRIO.indexOf(b.prio) >= 0 && b.prio !== t.prio) { t.prio = b.prio; addLog(t, w.name, 'priority ' + b.prio); }
    if (b.items != null) { const it = cleanItems(b.items); const was = (t.items || []).filter((a) => a.done).length, now = it.filter((a) => a.done).length; t.items = it; if (now !== was) addLog(t, w.name, 'action items ' + now + '/' + it.length); }
    if (b.links != null) t.links = cleanLinks(b.links);
    if (b.due != null && (isDate(b.due) || b.due === '') && b.due !== t.due) { t.due = b.due; delete o.nudged[t.id]; addLog(t, w.name, b.due ? 'due ' + b.due : 'no due date'); }
    if (b.person != null && String(b.person) !== (t.person || '')) {
      if (!w.owner) { json(res, 403, { error: 'Only the owner gives work to someone else.' }); return true; }
      const x = o.people.find((y) => y.id === String(b.person)); t.person = x ? x.id : ''; addLog(t, w.name, x ? 'given to ' + x.name : 'unassigned');
      if (x && x.uid && deps.tell) { try { await deps.tell(x.uid, 'New task: ' + t.title, t.due ? 'due ' + t.due : 'from ' + w.name); } catch (e) {} }
    }
    if (b.project != null && w.owner && String(b.project) !== (t.project || '')) { const pr = prs.find((x) => x.id === String(b.project)); t.project = pr ? pr.id : ''; t.company = pr ? (pr.company || '') : t.company; addLog(t, w.name, pr ? 'moved to ' + pr.name : 'taken off its project'); }
    t.upd = Date.now(); await save(ctx, o);
    if (deps.log && was !== t.status) { try { await deps.log(ctx, 'jarvis', '"' + t.title + '": ' + STATUS_NAME[t.status]); } catch (e) {} }
    await done({ task: pub(t) }); return true;
  }
  if (b.op === 'comment') {
    const text = block(b.text, 1500); if (!text) { json(res, 400, { error: 'Write something first.' }); return true; }
    t.comments = (t.comments || []).concat([{ id: newId('m'), name: str(w.name, 60), text, at: Date.now() }]).slice(-MAX_COMMENTS); t.upd = Date.now();
    await save(ctx, o);
    /* the person it is for hears about it, unless they wrote it */
    const x = o.people.find((y) => y.id === t.person);
    if (x && x.uid && x.uid !== w.uid && deps.tell) { try { await deps.tell(x.uid, w.name + ' on "' + t.title + '"', text.slice(0, 150)); } catch (e) {} }
    await done({ task: pub(t) }); return true;
  }
  if (b.op === 'pending') {
    if (ownerOnly()) return true;
    if (!t.pending) { json(res, 409, { error: 'That task is already on the board.' }); return true; }
    if (b.yes) {
      t.pending = false; if (b.person != null) { const x = o.people.find((y) => y.id === String(b.person)); if (x) t.person = x.id; } addLog(t, w.name, 'approved');
      await save(ctx, o);
      const x = o.people.find((y) => y.id === t.person);
      if (x && x.uid && deps.tell) { try { await deps.tell(x.uid, 'New task: ' + t.title, t.source && t.source.title ? 'from "' + t.source.title + '"' : 'from ' + w.name); } catch (e) {} }
    } else { o.tasks = o.tasks.filter((y) => y !== t); await save(ctx, o); }
    await done(); return true;
  }
  json(res, 400, { error: 'company, person, project, task, comment or pending.' }); return true;
}

/* For J.A.R.V.I.S.'s prompt: the companies, the people, and the open work. */
async function brief(ctx) {
  const o = await load(ctx); if (!o.people.length && !o.companies.length) return '';
  const prs = await projectsOf(ctx); const today = todayIn();
  const cn = (id) => (o.companies.find((c) => c.id === id) || {}).name || '';
  const lines = [];
  if (o.companies.length) lines.push('Companies: ' + o.companies.map((c) => c.name).join(', '));
  for (const p of o.people) {
    const ts = o.tasks.filter((t) => t.person === p.id && !t.pending);
    const c = counts(ts, today);
    const on = prs.filter((x) => onProject(x, p.id)).map((x) => x.id + ' ' + x.name + (x.company ? ' (' + cn(x.company) + ')' : ''));
    lines.push(p.id + ' | ' + p.name + ' | ' + (p.role || '') + ' | on: ' + (on.join('; ') || '-') + ' | ' + c.doing + ' in progress, ' + c.todo + ' to do, ' + c.blocked + ' blocked, ' + c.late + ' late, ' + c.doneWeek + ' done this week' +
      (ts.filter((t) => t.status !== 'done').length ? ' | open: ' + ts.filter((t) => t.status !== 'done').slice(0, 8).map((t) => t.title + ' [' + STATUS_NAME[t.status] + (t.due ? ', due ' + t.due : '') + ']').join('; ') : ''));
  }
  return lines.join('\n');
}

/* A meeting's action items for colleagues: proposals, waiting for his yes. */
async function propose(ctx, items, meeting, home, deps) {
  const o = await load(ctx); if (!o.people.length) return [];
  const out = [];
  for (const it of (items || []).slice(0, 10)) {
    const person = o.people.find((p) => p.id === it.person) || o.people.find((p) => p.name.toLowerCase() === String(it.person || '').toLowerCase() || p.name.split(' ')[0].toLowerCase() === String(it.person || '').toLowerCase());
    if (!person || !str(it.title, 160)) continue;
    const prs = await projectsOf(ctx);
    const pr = (it.project && (prs.find((x) => x.id === it.project) || prs.find((x) => x.name.toLowerCase() === String(it.project).toLowerCase()))) || (home && prs.find((x) => x.id === home.id)) || null;
    const r = await addTask(ctx, { title: it.title, note: it.note, person: person.id, project: pr ? pr.id : '', due: it.date, pending: true, source: { meeting: meeting.id, title: meeting.title } }, { owner: true, name: 'J.A.R.V.I.S.', uid: '' }, null).catch(() => null);
    if (r && r.ok) out.push({ id: r.task.id, title: r.task.title, person: person.name });
  }
  if (out.length && deps && deps.log) { try { await deps.log(ctx, 'jarvis', 'From "' + meeting.title + '": ' + out.length + ' task' + (out.length === 1 ? '' : 's') + ' for the team waiting for your yes (' + out.map((x) => x.person + ': ' + x.title).join('; ') + ')'); } catch (e) {} }
  return out;
}

/* Every morning (from 09:00 his time): one reminder to a colleague for each
   late task (once a day, not more); Monday: each person's week, to him. */
async function tick(ctx, uid, deps, L) {
  const o = await load(ctx); if (!o.people.length) return null;
  if (!(L.minutes >= 9 * 60 && L.minutes < 10 * 60)) return null;
  if (o.ticks.day === L.date) return null;
  o.ticks.day = L.date;
  const today = L.date; let nudges = 0;
  for (const p of o.people) {
    const lateOnes = o.tasks.filter((t) => t.person === p.id && !t.pending && late(t, today) && o.nudged[t.id] !== today);
    if (!lateOnes.length) continue;
    lateOnes.forEach((t) => { o.nudged[t.id] = today; });
    o.nudged['@' + p.id] = { at: Date.now(), date: today, tasks: lateOnes.map((t) => ({ id: t.id, title: t.title, due: t.due })) };
    if (p.uid && deps.tell) { try { await deps.tell(p.uid, lateOnes.length === 1 ? 'Late: ' + lateOnes[0].title : lateOnes.length + ' tasks are late', lateOnes.length === 1 ? 'It was due ' + lateOnes[0].due + '. Move it on, or tell why in a comment.' : lateOnes.slice(0, 3).map((t) => t.title).join(' · ')); nudges++; } catch (e) {} }
  }
  let summary = '';
  if (L.day === 0 && o.ticks.monday !== today) {
    o.ticks.monday = today;
    const prs = await projectsOf(ctx); const pn = (id) => (prs.find((x) => x.id === id) || {}).name || '';
    const parts = o.people.map((p) => {
      const ts = o.tasks.filter((t) => t.person === p.id && !t.pending); const c = counts(ts, today); if (!c.total) return '';
      const lt = ts.filter((t) => late(t, today)).slice(0, 2).map((t) => '"' + t.title + '"' + (pn(t.project) ? ' (' + pn(t.project) + ')' : ''));
      return p.name + ': ' + c.doneWeek + ' done last week, ' + c.doing + ' in progress' + (c.blocked ? ', ' + c.blocked + ' blocked' : '') + (c.late ? ', ' + c.late + ' late — ' + lt.join(', ') : '');
    }).filter(Boolean);
    const pend = o.tasks.filter((t) => t.pending).length;
    if (parts.length || pend) summary = 'Your team this week.\n' + parts.join('\n') + (pend ? '\n' + pend + ' task' + (pend === 1 ? '' : 's') + ' from meetings waiting for your yes.' : '');
  }
  await save(ctx, o);
  if (summary) {
    if (deps.log) { try { await deps.log(ctx, 'jarvis', summary.replace(/\n/g, ' · ')); } catch (e) {} }
    if (deps.tell) { try { await deps.tell(uid, 'Your team this week', summary.split('\n').slice(1, 4).join(' · ').slice(0, 170)); } catch (e) {} }
    if (deps.channels) { try { await deps.channels(uid, summary); } catch (e) {} }
  }
  return { nudges, summary };
}

module.exports = { handle, view, brief, propose, tick, addTask, load, _internals: { whoIs, canSeeTask, counts, STATUS } };
