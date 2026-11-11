/* The organisation: companies → projects → people and their tasks.
 *
 * What would make it wrong: a colleague seeing a company or project they
 * are not on (or its tasks); a colleague giving work to someone else,
 * removing someone else's task, or changing who is on a project; a status
 * change or comment not recorded with who made it; a colleague's own open
 * tasks missing from their Today; J.A.R.V.I.S. unable to give a task, or a
 * meeting's action item reaching a colleague before the owner said yes; a
 * late task reminded twice in a day; the Monday summary missing.
 * All made-up people. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const ORG = require('../flow-org.js');
const X = require('../flow-extras.js')._internals.say;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 400) : ''))); };

function person() {
  let cookie = '';
  const call = async (path, body) => {
    const r = await fetch(H + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) { const kv = c.split(';')[0]; const k = kv.split('=')[0]; cookie = cookie.split('; ').filter((x) => x && x.split('=')[0] !== k).concat(kv).join('; '); }
    let j = {}; try { j = await r.json(); } catch (e) {}
    return { status: r.status, j };
  };
  return { call, cookie: () => cookie };
}

(async () => {
  console.log('\n— on its own: reminders and the Monday summary —');
  {
    const mem = {}; const ctx = { get: async (k) => mem[k] === undefined ? null : JSON.parse(JSON.stringify(mem[k])), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
    mem['team:projects'] = [{ id: 'prA', name: 'Shop', company: 'c1', people: ['p1'] }];
    mem['team:org'] = { companies: [{ id: 'c1', name: 'Acme' }], people: [{ id: 'p1', name: 'Deniz Aydın', uid: 'u-deniz' }],
      tasks: [{ id: 't1', title: 'Fix checkout', project: 'prA', person: 'p1', due: '2026-11-01', status: 'doing' }, { id: 't2', title: 'New banner', project: 'prA', person: 'p1', due: '2026-11-20', status: 'todo' }, { id: 't3', title: 'Old', project: 'prA', person: 'p1', status: 'done', doneAt: Date.now() - 86400000 }] };
    const told = [];
    const deps = { tell: async (uid, t, b) => told.push({ uid, t, b }), log: async () => {} };
    const r1 = await ORG.tick(ctx, 'u-owner', deps, { date: '2026-11-16', day: 0, minutes: 9 * 60 + 5 });
    ok('at nine on a Monday: one reminder to the person with a late task, and the week to the owner', r1 && r1.nudges === 1 && told.some((x) => x.uid === 'u-deniz' && /Late: Fix checkout/.test(x.t)) && told.some((x) => x.uid === 'u-owner' && /Your team this week/.test(x.t)) && /Deniz Aydın: 1 done last week, 1 in progress, 1 late/.test(r1.summary), { r1, told });
    const r2 = await ORG.tick(ctx, 'u-owner', deps, { date: '2026-11-16', day: 0, minutes: 9 * 60 + 30 });
    ok('…and not twice the same day', r2 === null && told.length === 2);
    const r3 = await ORG.tick(ctx, 'u-owner', deps, { date: '2026-11-17', day: 1, minutes: 8 * 60 });
    ok('nothing before nine', r3 === null);
  }

  console.log('\n— a meeting\'s action items wait for the owner —');
  {
    const mem = {}; const ctx = { get: async (k) => mem[k] === undefined ? null : JSON.parse(JSON.stringify(mem[k])), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
    mem['team:projects'] = [{ id: 'prA', name: 'Shop', company: 'c1', people: ['p1'] }];
    mem['team:org'] = { companies: [{ id: 'c1', name: 'Acme' }], people: [{ id: 'p1', name: 'Deniz Aydın', uid: 'u-deniz' }], tasks: [] };
    const out = await ORG.propose(ctx, [{ person: 'Deniz', title: 'Send the price list', date: '2026-11-14', project: 'Shop' }, { person: 'Nobody', title: 'x' }], { id: 'm1', title: 'Weekly sales' }, null, null);
    const t = mem['team:org'].tasks[0];
    ok('only for someone in your people, filed on the project named, and pending', out.length === 1 && t.pending === true && t.project === 'prA' && t.person === 'p1' && t.source.title === 'Weekly sales', { out, t });
    const v = await ORG.view(Object.assign({}, ctx, { viewer: { member: true, id: 'u-deniz', email: '' } }));
    ok('Deniz does not see it until it is approved', v.tasks.length === 0);
  }

  console.log('\n— J.A.R.V.I.S. can give a task —');
  const pr = X.parseDo(JSON.stringify({ say: 'Given to Eren.', actions: [{ type: 'assign', person: 'p1', title: 'Fix the Goldwell login', date: '2026-11-13', project: 'prA' }, { type: 'assign', title: 'no person' }] }), { today: '2026-11-11' });
  ok('an "assign" for a person is understood; one without a person is dropped', pr.actions.length === 1 && pr.actions[0].type === 'assign' && pr.actions[0].person === 'p1' && pr.actions[0].date === '2026-11-13', pr.actions);

  const b = await chromium.launch();
  const bc = await b.newContext({ viewport: { width: 1440, height: 920 }, locale: 'en-GB' });
  const p = await bc.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => { await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); });
  const own = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body]);

  console.log('\n— the owner sets it up —');
  const abko = (await own('/api/team/org', { op: 'company', name: 'ABKO', about: 'Salon brands' })).j.company;
  const rev = (await own('/api/team/org', { op: 'company', name: 'Revelle AI' })).j.company;
  ok('companies', abko && rev && (await own('/api/team/org')).j.companies.length === 2);
  ok('the same company twice: refused', (await own('/api/team/org', { op: 'company', name: 'abko' })).status === 409);
  const eren = (await own('/api/team/org', { op: 'person', name: 'Eren Test', email: 'eren.test@example.com', role: 'Websites, B2B apps, IT' })).j.person;
  const efe = (await own('/api/team/org', { op: 'person', name: 'Efe Test', email: 'efe.test@example.com', role: 'Social media, PR' })).j.person;
  const gw = (await own('/api/team/org', { op: 'project', name: 'Goldwell B2B app', goal: 'Salons order online', company: abko.id, people: [eren.id] })).j.project;
  const soc = (await own('/api/team/org', { op: 'project', name: 'Goldwell social', company: abko.id, people: [efe.id] })).j.project;
  const rv = (await own('/api/team/org', { op: 'project', name: 'Revelle pilot', company: rev.id, people: [efe.id] })).j.project;
  ok('people and projects, each in a company with the people on it', eren && efe && gw && soc && rv);
  const t1 = (await own('/api/team/org', { op: 'task', title: 'Fix the login', person: eren.id, project: gw.id, due: '2026-11-01' })).j.task;
  const t2 = (await own('/api/team/org', { op: 'task', title: 'Order page', person: eren.id, project: gw.id })).j.task;
  const t3 = (await own('/api/team/org', { op: 'task', title: 'Launch post', person: efe.id, project: soc.id })).j.task;
  const t4 = (await own('/api/team/org', { op: 'task', title: 'Pilot deck', person: efe.id, project: rv.id })).j.task;
  ok('tasks, given to people', t1 && t2 && t3 && t4 && t1.status === 'todo' && t1.company === abko.id);
  ok('a task for someone who is not a person yet: a plain answer', /no Zeynep/i.test((await own('/api/team/org', { op: 'task', title: 'X', person: 'Zeynep' })).j.error || ''));

  console.log('\n— Eren signs in —');
  await own('/api/access', { op: 'private', on: true });
  const code = (await own('/api/access', { op: 'code', label: 'Eren', max: 1, org: { areas: ['projects'] } })).j.code;
  const E = person();
  const su = await E.call('/api/auth/signup', { email: 'eren.test@example.com', name: 'Eren', password: 'another long password', access: code });
  ok('with his employee code', su.status === 200, su.j);
  const v = (await E.call('/api/team/org')).j;
  ok('he sees ABKO and only his project — not Efe\'s, not Revelle', v.ok && v.companies.map((c) => c.name).join() === 'ABKO' && v.projects.map((x) => x.name).join() === 'Goldwell B2B app' && v.me.person && v.me.person.id === eren.id, { c: v.companies, p: v.projects, me: v.me });
  ok('…and only that project\'s tasks', v.tasks.map((t) => t.title).sort().join() === 'Fix the login,Order page' && v.tasks.find((t) => t.title === 'Fix the login').late === true);
  ok('he cannot open a task that is not his project\'s', (await E.call('/api/team/org', { op: 'task', id: t3.id, status: 'done' })).status === 404);
  const s1 = await E.call('/api/team/org', { op: 'task', id: t1.id, status: 'doing' });
  ok('he moves his task along; it records who did it', s1.status === 200 && s1.j.task.status === 'doing' && s1.j.task.log.some((l) => l.name === 'Eren' && /To do → In progress/.test(l.what)));
  const c1 = await E.call('/api/team/org', { op: 'comment', id: t1.id, text: 'Session cookie expires too early — fixing today.' });
  ok('he comments', c1.status === 200 && c1.j.task.comments.length === 1 && c1.j.task.comments[0].name === 'Eren');
  ok('he cannot give work to someone else, or change who is on a project', (await E.call('/api/team/org', { op: 'task', id: t1.id, person: efe.id })).status === 403 && (await E.call('/api/team/org', { op: 'project', id: gw.id, add: efe.id })).status === 403);
  ok('he cannot remove a task he did not make', (await E.call('/api/team/org', { op: 'task', id: t2.id, remove: true })).status === 403);
  const a1 = await E.call('/api/team/org', { op: 'task', title: 'Test on iPad', project: gw.id });
  ok('he adds a task to his project (his, unless he gives it to someone on it) — and can remove his own', a1.status === 200 && a1.j.task.person === eren.id && (await E.call('/api/team/org', { op: 'task', id: a1.j.task.id, remove: true })).status === 200);
  ok('not to a project he is not on', (await E.call('/api/team/org', { op: 'task', title: 'Sneak', project: rv.id })).status === 403);
  ok('company, person and project settings stay the owner\'s', (await E.call('/api/team/org', { op: 'company', name: 'Mine' })).status === 403 && (await E.call('/api/team/org', { op: 'person', name: 'X' })).status === 403);
  const mine = (await E.call('/api/team/org?mine=1')).j;
  ok('his own open tasks, for his Today — with project and company', mine.mine.length === 2 && mine.mine[0].projectName === 'Goldwell B2B app' && mine.mine[0].companyName === 'ABKO', mine);
  ok('his account is now tied to his person', (await own('/api/team/org')).j.people.find((x) => x.id === eren.id).linked === true);

  console.log('\n— from a meeting: waiting for the owner —');
  const pend = (await own('/api/team/org', { op: 'task', title: 'Fix the price list', person: eren.id, project: gw.id, pending: true })).j.task;
  /* a pending task is proposed only by a meeting; here the owner made one by hand, which is not pending */
  ok('a task the owner makes is given at once', pend && pend.pending === false);

  console.log('\n— the screens —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); FlowTodayLook.applyLook(); }); await p.waitForTimeout(1500);
  await p.click('#flow-hud .hud-ri[data-hud="projects"]'); await p.waitForTimeout(1500);
  const home = await p.evaluate(() => { const h = document.getElementById('flow-hud'); const vis = (s) => { const e = h.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }; return { cos: [...h.querySelectorAll('.org-co .org-coh b')].map((x) => x.textContent), orb: vis('.hud-core'), wide: h.querySelector('.org').getBoundingClientRect().width > 900, people: h.querySelectorAll('.org-pe').length }; });
  ok('Projects is a page of companies, across the window, with your people under it', home.cos.join() === 'ABKO,Revelle AI' && !home.orb && home.wide && home.people === 2, home);
  await p.click('#flow-hud .org-co[data-company]'); await p.waitForTimeout(700);
  const co = await p.evaluate(() => ({ prs: [...document.querySelectorAll('#flow-hud .org-pr .org-coh b')].map((x) => x.textContent), crumbs: document.querySelector('#flow-hud .org-crumbs').textContent }));
  ok('a company opens onto its projects', co.prs.sort().join() === 'Goldwell B2B app,Goldwell social' && /ABKO/.test(co.crumbs), co);
  await p.click('#flow-hud .org-pr:has-text("Goldwell B2B app")'); await p.waitForTimeout(700);
  const bd = await p.evaluate(() => { const cols = {}; document.querySelectorAll('#flow-hud .org-col').forEach((c) => { cols[c.getAttribute('data-s')] = [...c.querySelectorAll('.org-t b')].map((x) => x.textContent); }); return { cols, onit: [...document.querySelectorAll('#flow-hud .org-onit .org-chip span')].map((x) => x.textContent) }; });
  ok('a project: who is on it, and its board — To do, In progress, Blocked, Done', bd.onit.join() === 'Eren Test' && bd.cols.doing.join() === 'Fix the login' && bd.cols.todo.sort().join() === 'Fix the price list,Order page', bd);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/org-project.png' });
  await p.fill('#flow-hud form[data-team="orgtask"] input[name="title"]', 'Payment test'); await p.selectOption('#flow-hud form[data-team="orgtask"] select[name="person"]', eren.id);
  await p.click('#flow-hud form[data-team="orgtask"] button[type="submit"]'); await p.waitForTimeout(900);
  ok('a task added from the board lands in To do', await p.evaluate(() => [...document.querySelectorAll('#flow-hud .org-col[data-s="todo"] .org-t b')].some((x) => x.textContent === 'Payment test')));
  await p.click('#flow-hud .org-t:has-text("Fix the login")'); await p.waitForTimeout(500);
  const det = await p.evaluate(() => { const d = document.querySelector('#org-detail'); return d && { com: d.textContent.indexOf('Session cookie') >= 0, log: /Eren — To do → In progress/.test(d.textContent) }; });
  ok('a task opens with its comments and what changed', det && det.com && det.log, det);
  await p.click('#org-detail [data-hud="orgstatus"][data-s="done"]'); await p.waitForTimeout(800);
  ok('the owner marks it done from there', await p.evaluate(() => [...document.querySelectorAll('#flow-hud .org-col[data-s="done"] .org-t b')].some((x) => x.textContent === 'Fix the login')));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/org-task.png' });

  console.log('\n— Eren\'s screens —');
  const ec = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-GB' });
  const ck = E.cookie().split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: H }; });
  await ec.addCookies(ck);
  const q = await ec.newPage(); const qe = []; q.on('pageerror', (e) => qe.push(e.message));
  await q.goto(H + '/', { waitUntil: 'load' }); await q.waitForTimeout(4000);
  await q.evaluate(async () => { await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); Flow.Nav.go('today'); try { renderToday(); } catch (e) {} await FlowOrgWork.load(); FlowOrgWork.paintToday(); }); await q.waitForTimeout(800);
  const td = await q.evaluate(() => { const w = document.querySelector('#flow-work'); return w && { rows: [...w.querySelectorAll('.ow-t b')].map((x) => x.textContent) }; });
  ok('his Today shows his open work', td && td.rows.sort().join() === 'Fix the price list,Order page,Payment test', td);
  await q.click('#flow-work .ow-row:has-text("Order page") [data-ow="done"]'); await q.waitForTimeout(900);
  ok('…and he finishes one from there', (await own('/api/team/org')).j.tasks.find((t) => t.title === 'Order page').status === 'done' && await q.evaluate(() => ![...document.querySelectorAll('#flow-work .ow-t b')].some((x) => x.textContent === 'Order page')));
  ok('no page errors', errs.length === 0 && qe.length === 0, errs.concat(qe));
  await own('/api/access', { op: 'private', on: false });
  await b.close();
  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
