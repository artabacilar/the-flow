/* A private Flow and the organization.
 *
 * What would make it wrong: someone else still signed in after it is made
 * private; a way back in without a code; a code that works for two people
 * when it was made for one; an employee seeing an area not shared with
 * them, or approving what goes out; an employee's change not showing who
 * made it; anyone but the owner able to change any of this; someone's data
 * lost by being shut out. All made-up people. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 360) : ''))); };

/* a person with their own cookie jar, by plain HTTP */
function person() {
  let cookie = '';
  const call = async (path, body, method) => {
    const r = await fetch(H + path, { method: method || (body ? 'POST' : 'GET'), headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) { const kv = c.split(';')[0]; const k = kv.split('=')[0]; cookie = cookie.split('; ').filter((x) => x && x.split('=')[0] !== k).concat(kv).join('; '); }
    let j = {}; try { j = await r.json(); } catch (e) {}
    return { status: r.status, j };
  };
  return { call };
}

(async () => {
  const b = await chromium.launch();
  const bc = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await bc.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); });
  const own = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body]);
  await own('/api/team');

  console.log('\n— open, as before —');
  const eda = person(), mo = person(), zed = person();
  const s1 = await eda.call('/api/auth/signup', { email: 'eda.yilmaz@example.com', name: 'Eda', password: 'another long password', invite: 'letmein' });
  ok('while open, someone with the invite code can make an account', s1.status === 200, s1.j);
  await eda.call('/api/set', { key: 'ld_journal', value: [{ t: 'Eda\'s own note' }] });
  ok('…and is signed in', (await eda.call('/api/auth/me')).j.user && (await eda.call('/api/auth/me')).j.user.email === 'eda.yilmaz@example.com');
  ok('only the owner can see or change who uses the Flow', (await eda.call('/api/access')).status === 403 && (await eda.call('/api/access', { op: 'private', on: false })).status === 403);

  console.log('\n— made private —');
  const pv = await own('/api/access', { op: 'private', on: true });
  ok('making it private signs everyone else out at once', pv.j.ok && pv.j.private === true && pv.j.signedOut >= 1, pv.j.signedOut);
  ok('Eda\'s session is over', (await eda.call('/api/auth/me')).j.user === null && (await eda.call('/api/team')).status === 401);
  ok('the owner is still in', (await own('/api/auth/me')).j.user.owner === true);
  const l0 = await eda.call('/api/auth/login', { email: 'eda.yilmaz@example.com', password: 'another long password' });
  ok('signing in again without a code: refused, asking for the code', l0.status === 403 && l0.j.needCode && /private/i.test(l0.j.error), l0.j);
  ok('a wrong code: refused', (await eda.call('/api/auth/login', { email: 'eda.yilmaz@example.com', password: 'another long password', access: 'AAAA-BBBB-CCCC' })).status === 403);
  ok('a new account without a code: refused, even with the old invite code', (await zed.call('/api/auth/signup', { email: 'zed@example.com', name: 'Zed', password: 'another long password', invite: 'letmein' })).j.needCode === true);

  console.log('\n— an employee —');
  const c1 = await own('/api/access', { op: 'code', label: 'Eda', max: 1, org: { areas: ['projects', 'sales'] } });
  ok('the owner makes a one-person employee code for Projects and Sales', c1.j.ok && /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c1.j.code), c1.j);
  const l1 = await eda.call('/api/auth/login', { email: 'eda.yilmaz@example.com', password: 'another long password', access: c1.j.code.toLowerCase().replace(/-/g, ' ') });
  ok('Eda signs in with it (however she types it)', l1.status === 200, l1.j);
  const me = (await eda.call('/api/auth/me')).j.user;
  ok('she is an employee, with exactly the areas given', me && me.member && me.member.areas.join() === 'projects,sales', me);
  const t = await eda.call('/api/team');
  ok('her command centre is the organization\'s: Artur\'s team, and she is shown as an employee', t.status === 200 && t.j.viewer && t.j.viewer.member && t.j.viewer.org === 'Artur' && t.j.agents.some((a) => a.id === 'jarvis'), t.j.viewer);
  ok('Projects open onto the organization\'s', (await eda.call('/api/team/projects')).status === 200);
  ok('J.A.R.V.I.S. & the team, not shared with her, are closed', (await eda.call('/api/team/say', { agent: 'jarvis', text: 'hello' })).status === 403);
  ok('what goes out stays the owner\'s: she cannot approve, change the limit or plugins', (await eda.call('/api/team/approve', { id: 'x', decision: 'approve' })).status === 403 && (await eda.call('/api/team/limits', { monthlyUsd: 1 })).status === 403 && (await eda.call('/api/team/plugins', { op: 'add', url: 'https://x.example' })).status === 403);
  ok('her own data was kept all along', JSON.stringify((await eda.call('/api/get?key=ld_journal')).j.value || '').indexOf('Eda\'s own note') >= 0);
  ok('the same code does not let a second person in', (await mo.call('/api/auth/signup', { email: 'mo@example.com', name: 'Mo', password: 'another long password', access: c1.j.code })).status === 403);

  console.log('\n— the owner changes what she sees —');
  const people = (await own('/api/access')).j.people; const ed = people.find((x) => x.email === 'eda.yilmaz@example.com');
  await own('/api/access', { op: 'member', uid: ed.id, areas: ['projects', 'sales', 'team'] });
  const k = await eda.call('/api/team/knowledge', { op: 'add', text: 'Salon visits are charged per kilometre' });
  ok('given the team too, she can add to what the team knows — in the organization\'s workspace', k.status === 200 && (await own('/api/team')).j.knowledge.some((x) => /per kilometre/.test(x.text)), k.status);
  ok('…and the log shows it was her', ((await own('/api/team')).j.log || []).some((l) => /per kilometre — Eda$/.test(l.what)));

  console.log('\n— a guest, and taking someone out —');
  const c2 = await own('/api/access', { op: 'code', label: 'Mo', max: 1 });
  const s2 = await mo.call('/api/auth/signup', { email: 'mo@example.com', name: 'Mo', password: 'another long password', access: c2.j.code });
  ok('a guest code lets a new person make their own account', s2.status === 200, s2.j);
  ok('…their own Flow, not the organization\'s', !(await mo.call('/api/auth/me')).j.user.member && !((await mo.call('/api/team')).j.viewer || {}).member);
  await own('/api/access', { op: 'remove', uid: ed.id });
  ok('removing Eda signs her out, and she needs a new code', (await eda.call('/api/auth/me')).j.user === null && (await eda.call('/api/auth/login', { email: 'eda.yilmaz@example.com', password: 'another long password' })).status === 403);

  console.log('\n— the screens —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(2500);
  await p.evaluate(async () => { await FlowTeam.loadAcc(); FlowHud.paint(); }); await p.waitForTimeout(400);
  const ui = await p.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="access"]'); return g && { priv: /Private — only you/.test(g.textContent), open: !!g.querySelector('[data-hud="accpriv"][data-on="0"]'), form: !!g.querySelector('form[data-team="acccode"]'), areas: g.querySelectorAll('form[data-team="acccode"] input[name="area"]').length, people: /Mo/.test(g.textContent) }; });
  ok('the owner\'s Access & organization panel: private, a code maker with the three areas, the people', ui && ui.priv && ui.open && ui.form && ui.areas === 3 && ui.people, ui);
  const g = await b.newContext({ viewport: { width: 420, height: 860 }, locale: 'en-GB' }); const q = await g.newPage();
  await q.goto(H + '/', { waitUntil: 'load' }); await q.waitForTimeout(2500);
  await q.fill('#fa-email', 'eda.yilmaz@example.com'); await q.fill('#fa-pw', 'another long password'); await q.click('#fa-go'); await q.waitForTimeout(1500);
  const lf = await q.evaluate(() => ({ field: !document.getElementById('fa-acwrap').hidden, err: document.getElementById('fa-err').textContent }));
  ok('on the sign-in screen, a refused sign-in brings up the access-code field', lf.field && /private/i.test(lf.err), lf);
  /* an employee's own screen */
  const c3 = await own('/api/access', { op: 'code', label: 'Eda again', max: 1, org: { areas: ['projects', 'sales'] } });
  await q.fill('#fa-ac', c3.j.code); await submitAuth(q); await q.waitForTimeout(4000);
  const qe = []; q.on('pageerror', (e) => qe.push(e.message));
  await q.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); FlowHud.open(); }); await q.waitForTimeout(3000);
  const mh = await q.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="org"]'); return { org: g && g.textContent, access: !!document.querySelector('#flow-hud [data-k="access"]'), approvals: !!document.querySelector('#flow-hud [data-k="approvals"]'), plugins: !!document.querySelector('#flow-hud [data-k="plugins"]'), proj: !!(g && g.querySelector('[data-hud="projects"]')) }; });
  ok('an employee\'s command centre: the organization, what is shared, Open Projects — none of the owner\'s own panels', mh.org && /Artur/.test(mh.org) && /Projects & tasks, Sales & finance/.test(mh.org) && mh.proj && !mh.access && !mh.approvals && !mh.plugins && qe.length === 0, { mh, qe });
  await own('/api/access', { op: 'private', on: false });
  ok('opened again, the owner\'s setting holds', (await own('/api/access')).j.private === false);
  ok('no page errors', errs.length === 0, errs);
  await b.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
