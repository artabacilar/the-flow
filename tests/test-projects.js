/* Projects: what J.A.R.V.I.S. does with a meeting Fathom recorded.
 *
 * What would make it wrong: a meeting read twice and its work started twice;
 * an old meeting acted on by itself; work started while the team is paused
 * or when he has said not to; a fact kept that is a secret; an agent made
 * up; a project made anew for every meeting about the same thing; a project
 * he cannot rename, pause, finish, annotate or remove; the view not showing
 * where each project stands; or J.A.R.V.I.S. not knowing about projects when
 * he is asked "where am I with…". */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const P = require('../flow-projects.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

const AGENTS = [{ id: 'jarvis', name: 'J.A.R.V.I.S.', role: 'Chief of staff' }, { id: 'bobby', name: 'Bobby', role: 'Advertising' }, { id: 'tom', name: 'Tom', role: 'Sales' }, { id: 'old', name: 'Old', role: 'Sales', archived: true }];
function world(model) {
  const mem = {}; const tasks = []; const know = []; const logs = []; const told = [];
  const ctx = { user: { id: 'u1', name: 'Artur' }, get: async (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : null), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
  const deps = {
    fake: !model, agents: async () => AGENTS, knowledge: async () => know, tasks: async () => tasks,
    modelJson: async (c, sys, user) => (typeof model === 'function' ? model(sys, user) : model),
    newTask: async (c, uid, f) => { const t = Object.assign({ id: 't' + (tasks.length + 1), status: 'queued', updatedAt: Date.now() }, f); tasks.push(t); return t; },
    log: async (c, who, what) => logs.push(what),
    addKnowledge: async (c, items, origin) => { const ids = []; for (const it of items) { const k = { id: 'k' + (know.length + 1), text: it.text, origin, status: 'current' }; know.push(k); ids.push(k.id); } return { added: ids.length, ids }; },
    notify: async (uid, c, text) => told.push(text)
  };
  return { mem, tasks, know, logs, told, ctx, deps };
}
const today = new Date().toISOString();
const SATIS = { id: 'm-satis', title: 'ABKO SATIS TOPLANTISI', at: today, url: 'https://fathom.video/calls/1', people: [{ name: 'Burak', ext: true }],
  summary: 'Burak will send the legal documents and the reseller pricing list by Friday. The team agreed to target three hotel chains in Istanbul for the Revelle AI reseller offer.',
  actions: [{ text: 'Prepare a competitor price comparison for Revelle AI resellers' }, { text: 'Call Dad about the iPhone', mine: true }] };

(async () => {
  console.log('\n— reading a meeting —');
  const sys = P._internals.system('Artur');
  ok('he is told to act without asking, for ABKO, in Turkish or English, never inventing', /without asking him/.test(sys) && /ABKO/.test(sys) && /Turkish, English or both/.test(sys) && /Never invent/.test(sys));
  ok('his own calls and meetings stay his; only team work is handed out', /Not his own calls, visits or meetings/.test(sys));
  const um = P._internals.userMsg(SATIS, [{ id: 'pr1', name: 'Revelle reseller', goal: 'Sell Revelle', state: 'Waiting on pricing', status: 'active' }], AGENTS, [{ text: 'ABKO sells audio' }]);
  ok('he sees the team, the open projects, what is known, and the meeting', /bobby \| Bobby \| Advertising/.test(um) && /pr1 \| Revelle reseller/.test(um) && /ABKO sells audio/.test(um) && /Burak \(external\)/.test(um) && /competitor price comparison/.test(um));
  const cr = P._internals.cleanRead({ summary: 'x', projects: [{ name: 'A' }], facts: [{ text: 'The wifi password is hunter22' }, { text: 'Burak is the legal contact at Revelle' }, { text: 'card 4111111111111111 on file' }],
    delegate: [{ agent: 'nobody', title: 'Research', brief: 'Research the three hotel chains in detail' }, { agent: 'tom', title: '', brief: 'no title here at all ok' }, { agent: 'tom', title: 'Short', brief: 'tiny' }] }, ['jarvis', 'tom']);
  ok('secrets are never kept', cr.facts.length === 1 && /Burak/.test(cr.facts[0].text), cr.facts);
  ok('an agent that does not exist becomes J.A.R.V.I.S.; a task with no title or no real brief is dropped', cr.delegate.length === 1 && cr.delegate[0].agent === 'jarvis', cr.delegate);
  ok('an unreadable answer is no reading', P._internals.cleanRead(null, []) === null);

  console.log('\n— acting on it —');
  const model = { summary: 'Revelle reseller is moving; pricing due Friday.', projects: [{ name: 'Revelle AI reseller', goal: 'Resell Revelle AI to hotels', status: 'Waiting on Burak for legal documents and pricing.', health: 'at_risk', next: ['Get pricing from Burak', 'Shortlist three hotel chains'] }],
    facts: [{ text: 'Burak sends the Revelle legal documents and pricing by Friday', kind: 'fact', quote: 'by Friday' }, { text: 'Target: three hotel chains in Istanbul', kind: 'fact' }],
    delegate: [{ agent: 'tom', title: 'Shortlist hotel chains', brief: 'Find three Istanbul hotel chains that fit the Revelle AI reseller offer, with contacts.', project: 'Revelle AI reseller' }, { agent: 'bobby', title: 'Competitor prices', brief: 'Compare Revelle AI reseller pricing against two competitors in Turkey.', project: 'Revelle AI reseller' }, { agent: 'old', title: 'Archived agent work', brief: 'This should go to J.A.R.V.I.S. instead of the archived one.' }],
    ideas: [{ title: 'Bundle installation', why: 'Hotels want it done for them.' }] };
  const w = world(model);
  let r = await P.processMeeting(w.ctx, w.deps, 'u1', SATIS);
  const list = w.mem['team:projects'];
  ok('the meeting becomes a project with where it stands, its health and next steps', r.ok && list.length === 1 && list[0].name === 'Revelle AI reseller' && list[0].health === 'at_risk' && list[0].next.length === 2 && list[0].meetings[0] === 'm-satis', list);
  ok('what matters is remembered, with the meeting as its source', w.know.length === 2 && w.know[0].origin.id === 'meet:m-satis' && list[0].facts.length === 2, w.know);
  ok('the work is started at once, with the right agents, tied to the project', w.tasks.length === 3 && w.tasks[0].agent === 'tom' && w.tasks[1].agent === 'bobby' && w.tasks[0].by === 'jarvis' && w.tasks[0].project === list[0].id && w.tasks[0].from.meeting === 'm-satis' && list[0].tasks.length === 3, w.tasks.map((t) => [t.agent, t.project]));
  ok('an archived agent is never handed work', w.tasks[2].agent === 'jarvis');
  ok('ideas for the business are kept on the project', list[0].ideas && list[0].ideas[0].title === 'Bundle installation');
  ok('he is told what happened, and it is logged', w.told.length === 1 && /3 tasks started/.test(w.told[0]) && /Tom: Shortlist hotel chains/.test(w.told[0]) && w.logs.some((l) => /From "ABKO SATIS/.test(l)), w.told);
  r = await P.processMeeting(w.ctx, w.deps, 'u1', SATIS);
  ok('the same meeting is never read twice by itself', r.skipped === 'already' && w.tasks.length === 3);
  const again = { id: 'm-2', title: 'Revelle follow-up', at: today, summary: 'Pricing came in.', actions: [] };
  const w2model = Object.assign({}, model, { projects: [{ id: list[0].id, status: 'Pricing received.', health: 'on_track', next: [] }], delegate: [], facts: [] });
  w.deps.modelJson = async () => w2model;
  r = await P.processMeeting(w.ctx, w.deps, 'u1', again);
  const l2 = w.mem['team:projects'];
  ok('a later meeting about the same thing joins the same project and moves it on', l2.length === 1 && l2[0].meetings.length === 2 && l2[0].state === 'Pricing received.' && l2[0].health === 'on_track' && l2[0].next.length === 2, l2[0]);
  ok('its timeline shows both meetings', l2[0].timeline.length === 2 && l2[0].timeline[1].title === 'Revelle follow-up');

  const wp = world(model); wp.mem['team:paused'] = true;
  r = await P.processMeeting(wp.ctx, wp.deps, 'u1', SATIS);
  ok('nothing is done while the team is paused', r.status === 423 && wp.tasks.length === 0 && !wp.mem['team:meetproc']);
  const wn = world(null); wn.deps.fake = false;
  r = await P.processMeeting(wn.ctx, wn.deps, 'u1', SATIS);
  ok('with no model answer, nothing is marked read (it is tried again)', r.status === 502 && !wn.mem['team:meetproc']);
  const wd = world(model); wd.mem['team:projects:settings'] = { auto: true, delegate: false };
  r = await P.processMeeting(wd.ctx, wd.deps, 'u1', SATIS);
  ok('when he says not to hand out work, it is read and remembered but nothing starts', r.ok && wd.tasks.length === 0 && wd.know.length === 2);

  const wr = world(model); await P.processMeeting(wr.ctx, wr.deps, 'u1', SATIS); wr.mem['team:projects'] = []; delete wr.mem['team:meetproc'];
  r = await P.processMeeting(wr.ctx, wr.deps, 'u1', SATIS, { noTasks: true });
  ok('read again without new work, the work it already started is filed back under its project', r.ok && wr.tasks.length === 3 && wr.mem['team:projects'][0].tasks.length === 3, wr.mem['team:projects']);
  const wq = world(model); wq.deps.modelJson = async (c, sys, user) => { await new Promise((res) => setTimeout(res, /bar/.test(user) ? 60 : 5)); return /bar/.test(user) ? Object.assign({}, model, { projects: [{ name: 'Sales dashboard', status: 'x', next: [] }], delegate: [] }) : Object.assign({}, model, { delegate: [] }); };
  await Promise.all([P.processMeeting(wq.ctx, wq.deps, 'u1', Object.assign({}, SATIS, { id: 'q1', title: 'bar november 9' })), P.processMeeting(wq.ctx, wq.deps, 'u1', Object.assign({}, SATIS, { id: 'q2' }))]);
  ok('two meetings read at once both keep their project and their record', wq.mem['team:projects'].length === 2 && Object.keys(wq.mem['team:meetproc']).length === 2, wq.mem['team:projects'].map((x) => x.name));

  console.log('\n— on its own, as meetings arrive —');
  const wa = world(model);
  const old = { id: 'm-old', title: 'Old', at: new Date(Date.now() - 8 * 86400000).toISOString(), summary: 'long ago' };
  const legacy = { id: 'm-leg', title: 'Legacy', at: today, legacy: true };
  let out = await P.onFiled(wa.ctx, wa.deps, 'u1', [old, legacy, SATIS]);
  ok('a new meeting is read by itself; an old or legacy one is not', out.length === 1 && out[0].meeting === 'm-satis' && wa.tasks.length === 3, out);
  out = await P.onFiled(wa.ctx, wa.deps, 'u1', [SATIS]);
  ok('the next tick reads nothing twice', out.length === 0 && wa.tasks.length === 3);
  const wo = world(model); wo.mem['team:projects:settings'] = { auto: false };
  out = await P.onFiled(wo.ctx, wo.deps, 'u1', [SATIS]);
  ok('with "read by himself" off, nothing happens until he asks', out.length === 0 && wo.tasks.length === 0);
  ok('J.A.R.V.I.S. gets one line per open project for his own answers', /Revelle AI reseller \| at_risk \| Waiting on Burak/.test(await P.brief(wa.ctx)) && /next: Get pricing from Burak/.test(await P.brief(wa.ctx)));
  const fx = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-extras.js'), 'utf8');
  ok('…and is told to answer "where am I with…" from it', /PROJECTS \(id \| name \| health/.test(fx) && /where am I with/.test(fx));
  const fm = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-meetings.js'), 'utf8');
  ok('Fathom filing hands new meetings to him', /deps\.onFiled\(uid, fresh\)/.test(fm));

  console.log('\n— the routes, through the server —');
  const b = await chromium.launch();
  const bc = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await bc.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => { await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); });
  const api = (body) => p.evaluate(async (b) => { const r = await fetch('/api/team/projects', b ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : { credentials: 'same-origin' }); return { s: r.status, j: await r.json() }; }, body);
  let g = await api();
  ok('a fresh account has no projects, and reading is on by default', g.s === 200 && g.j.projects.length === 0 && g.j.settings.auto === true && g.j.settings.delegate === true, g.j);
  const file = (ms) => p.evaluate(async (ms) => { await fetch('/api/set', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ld_meetings', value: JSON.stringify(ms) }) }); }, ms);
  await file([SATIS]);
  g = await api(); const seen = g.j.meetings.length === 1;
  ok('a meeting filed in The Flow shows, not yet read', seen && g.j.meetings[0].read === false, g.j.meetings);
  ok('a meeting not in The Flow cannot be read', (await api({ op: 'process', meeting: 'nope' })).s === 404);
  r = await api({ op: 'process', meeting: 'm-satis' });
  ok('reading it starts a project and hands out the work', r.s === 200 && r.j.projects.length === 1 && r.j.tasks.length === 1 && r.j.view.projects[0].taskList.length === 1 && r.j.view.meetings[0].read, r.j);
  const pid = r.j.projects[0].id;
  r = await api({ op: 'update', id: pid, name: 'Revelle', health: 'blocked', status: 'paused' });
  ok('he can rename it, set its health and pause it', r.s === 200 && r.j.project.name === 'Revelle' && r.j.project.health === 'blocked' && r.j.project.status === 'paused');
  r = await api({ op: 'note', id: pid, text: 'Burak called — pricing next week' });
  ok('he can add a note to its timeline', r.s === 200 && r.j.project.timeline.slice(-1)[0].by === 'you');
  r = await api({ op: 'create', name: 'Goldwell distribution', goal: 'Sign Goldwell for Turkey' });
  ok('he can start one himself', r.s === 200 && r.j.project.by === 'you');
  r = await api({ op: 'settings', delegate: false });
  ok('and turn off handing out work', r.j.settings.delegate === false && r.j.settings.auto === true);
  await api({ op: 'settings', delegate: true });
  ok('a bad request is told what is possible', (await api({ op: 'create' })).s === 400 && (await api({ op: 'zap', id: pid })).s === 400 && (await api({ op: 'update', id: 'none' })).s === 404);

  console.log('\n— the Projects view —');
  await api({ op: 'update', id: pid, status: 'active', health: 'at_risk' });
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  await p.click('#flow-hud [data-hud="projects"]'); await p.waitForTimeout(1500);
  ok('Projects opens on your companies; the meetings and J.A.R.V.I.S.\'s work are one button away', await p.evaluate(() => !!document.querySelector('#flow-hud .org') && !!document.querySelector('#flow-hud [data-hud="orgclassic"]')));
  await p.click('#flow-hud [data-hud="orgclassic"]'); await p.waitForTimeout(1200);
  let v = await p.evaluate(() => ({ brand: document.querySelector('#flow-hud .hud-brand b').textContent, cards: [...document.querySelectorAll('#flow-hud .hud-pj')].map((x) => x.querySelector('.hud-pjn').textContent), sel: (document.querySelector('#flow-hud .hud-pj.sel .hud-pjn') || {}).textContent,
    health: (document.querySelector('#flow-hud .hud-pj .hud-pjh') || {}).textContent, right: (document.querySelector('#flow-hud .hud-right') || {}).textContent || '', meet: (document.querySelector('#flow-hud [data-k="pjmeet"]') || {}).textContent || '' }));
  ok('Projects opens from the rail, with each project as a card', v.brand === 'Projects' && v.cards.length === 2 && v.cards.indexOf('Revelle') >= 0, v);
  ok('a card says how it is going', /At risk|On track/.test(v.health), v.health);
  await p.click('#flow-hud .hud-pj[data-id="' + pid + '"]'); await p.waitForTimeout(500);
  v = await p.evaluate(() => ({ right: document.querySelector('#flow-hud .hud-right').textContent, tasks: document.querySelectorAll('#flow-hud .hud-pjt').length, meet: document.querySelector('#flow-hud [data-k="pjmeet"]').textContent }));
  ok('opening one shows where it stands, the work, its meetings, what he learned and its timeline', /Where it stands/.test(v.right) && v.tasks === 1 && /ABKO SATIS TOPLANTISI/.test(v.right) && /What he learned/.test(v.right) && /Burak called/.test(v.right), v.right.slice(0, 400));
  ok('the meetings panel marks it read, with the switches', /read · 1 task started/.test(v.meet) && /Read every new meeting by himself/.test(v.meet));
  await p.selectOption('#flow-hud select[data-team-pjset="health"]', 'on_track'); await p.waitForTimeout(800);
  g = await api();
  ok('changing its health in the view saves it', g.j.projects.find((x) => x.id === pid).health === 'on_track');
  await p.uncheck('#flow-hud input[data-team-pj="auto"]'); await p.waitForTimeout(800);
  g = await api();
  ok('turning off "read by himself" in the view saves it', g.j.settings.auto === false);
  await p.check('#flow-hud input[data-team-pj="auto"]'); await p.waitForTimeout(600);
  const m2 = Object.assign({}, SATIS, { id: 'm-new', title: 'Goldwell intro', summary: 'Goldwell wants exclusive distribution for Turkey. They asked for a proposal with volumes and pricing by next month.', actions: [{ text: 'Draft the Goldwell distribution proposal' }] });
  await file([SATIS, m2]);
  await p.evaluate(async () => { await FlowTeam.loadPj(true); FlowHud.paint(); }).catch(async () => { await p.click('#flow-hud [data-hud="projects"]'); });
  await p.waitForTimeout(600);
  const hasBtn = await p.evaluate(() => !!document.querySelector('#flow-hud [data-hud="pjread"][data-id="m-new"]'));
  ok('an unread meeting offers "Let him read it"', hasBtn);
  if (hasBtn) { await p.click('#flow-hud [data-hud="pjread"][data-id="m-new"]'); await p.waitForTimeout(1500); }
  v = await p.evaluate(() => ({ cards: document.querySelectorAll('#flow-hud .hud-pj').length, sel: (document.querySelector('#flow-hud .hud-pj.sel .hud-pjn') || {}).textContent }));
  ok('…and it is filed under the matching project, which opens', v.sel === 'Goldwell distribution' && v.cards === 2, v);
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  ok('no page errors', errs.length === 0, errs);
  await b.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
