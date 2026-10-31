/* The planner never loses its history to a copy that never saw it.
 *
 * 31 October 2026: a device holding a blank, default Week Compass added one
 * Priority and saved the whole planner over weeks of real ones. What would
 * make it wrong now: that save still landing; a real single deletion, a move,
 * a drop or an edit being undone by the guard; the blank save's own new
 * Priority being lost in the merge. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const G = require('../flow-guard.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

const DEF = ['Work', 'Health & Body', 'Money', 'Relationships', 'Learning', 'Something creative'];
const real = () => ({ mission: 'Build things that last.', roles: ['Entrepreneur', 'Music'], aside: [{ id: 'z1', title: 'Old idea', status: 'dropped' }],
  rocks: { '2026-W43': [{ id: 'a1', title: 'Report', day: 1 }, { id: 'a2', title: 'Call', day: 2 }], '2026-W44': [{ id: 'b1', title: 'Invoices', day: 4 }, { id: 'b2', title: 'Agent', day: 4 }, { id: 'b3', title: 'Grandfather', day: 5 }] } });
const S = (o) => JSON.stringify(o);

console.log('\n— the guard, on its own —');
{
  const blank = { mission: '', roles: DEF.slice(), rocks: { '2026-W44': [{ id: 'n1', title: 'Meet grandfather', day: 6, time: '10:00' }] } };
  const out = JSON.parse(G.guardCompass(S(real()), S(blank)));
  const ids = Object.values(out.rocks).flat().map((r) => r.id).sort();
  ok('a blank planner with one new Priority does not wipe the history: all five stay, and the new one is added', ids.join() === 'a1,a2,b1,b2,b3,n1', ids);
  ok('and the roles, the mission and the dropped list stay', out.roles.join() === 'Entrepreneur,Music' && out.mission === 'Build things that last.' && out.aside.length === 1, out);
  const one = real(); one.rocks['2026-W44'] = one.rocks['2026-W44'].filter((r) => r.id !== 'b2');
  ok('deleting one Priority goes through untouched', G.guardCompass(S(real()), S(one)) === S(one));
  const mv = real(); const r = mv.rocks['2026-W44'].shift(); (mv.rocks['2026-W45'] = []).push(Object.assign(r, { day: 0 }));
  ok('moving one to next week goes through untouched', G.guardCompass(S(real()), S(mv)) === S(mv));
  const dr = real(); const gone = dr.rocks['2026-W43'].splice(0); dr.rocks['2026-W44'].splice(0, 1).forEach((x) => gone.push(x)); dr.aside = dr.aside.concat(gone.map((x) => Object.assign({}, x, { status: 'dropped' })));
  ok('"Drop all overdue" (three at once, into the dropped list) goes through untouched', G.guardCompass(S(real()), S(dr)) === S(dr));
  const cw = real(); cw.rocks['2026-W44'] = [];
  ok('clearing one week on purpose goes through untouched', G.guardCompass(S(real()), S(cw)) === S(cw));
  const ed = real(); ed.rocks['2026-W44'][0].title = 'Invoices — sent'; ed.rocks['2026-W44'][0].done = true;
  ok('an edit goes through untouched', G.guardCompass(S(real()), S(ed)) === S(ed));
  const dbl = JSON.parse(G.guardCompass(JSON.stringify(S(real())), JSON.stringify(S(blank))));
  ok('it reads the record however it was encoded, and answers in kind', typeof dbl === 'string' && JSON.parse(dbl).rocks['2026-W43'].length === 2);
  ok('it never breaks a save it cannot read', G.guardCompass('not json', S(blank)) === S(blank) && G.guardCompass(null, S(blank)) === S(blank));
}

(async () => {
  console.log('\n— through the server —');
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  const api = (path, body) => p.evaluate(async ({ path, body }) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' }); return r.json(); }, { path, body });
  const read = async () => { const g = await api('/api/get?key=ld_compass'); let v = g.value; if (typeof v === 'string') v = JSON.parse(v); if (typeof v === 'string') v = JSON.parse(v); return v; };
  await api('/api/set', { key: 'ld_compass', value: S(real()) });
  await api('/api/set', { key: 'ld_compass', value: S({ mission: '', roles: DEF, rocks: { '2026-W44': [{ id: 'n1', title: 'Meet grandfather', day: 6 }] } }) });
  let v = await read();
  const has = (v, ids) => { const all = Object.values(v.rocks || {}).flat().map((r) => r.id); return ids.every((i) => all.indexOf(i) >= 0); };
  ok('/api/set: the blank save is merged, not stored over the planner', has(v, ['a1', 'a2', 'b1', 'b2', 'b3', 'n1']) && v.roles[0] === 'Entrepreneur', v);
  await api('/api/bulk', { data: { ld_compass: S({ mission: '', roles: DEF, rocks: {} }) } });
  v = await read();
  ok('/api/bulk: the same', has(v, ['a1', 'a2', 'b1', 'b2', 'b3', 'n1']) && v.mission === 'Build things that last.', v);
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
