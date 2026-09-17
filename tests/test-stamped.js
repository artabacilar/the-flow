/* The account that was already there.
 *
 * Every other suite builds its accounts fresh, which is why every other
 * suite was green while the App Store demo account sat blank: the state
 * that mattered was one no test had ever constructed — an account created
 * before the starter week existed, opened once so the app wrote its blank
 * sections up, and then stamped "nothing to do" by a version of the rescue
 * whose question was wrong.
 *
 * This suite starts from exactly that and asks the only thing that matters:
 * when the person opens the app, do they get their week?
 */
const keepCookies = require('./cookie-jar.js');
const starter = require('../flow-starter.js');
const H = 'http://localhost:4222';

let pass = 0, fail = 0;
const ok = (n, c, d) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : '')); }
};
const sect = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

const jar = {};
async function call(path, opts = {}, who = 'demo') {
  const h = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (jar[who]) h.Cookie = jar[who];
  const r = await fetch(H + path, Object.assign({}, opts, { headers: h }));
  keepCookies(jar, who, r);
  let b = null; try { b = await r.json(); } catch (e) {}
  return { status: r.status, body: b };
}

(async () => {
  console.log('\n— an account that was already here, and already passed over —');

  let r = await call('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'demo@example.com', password: 'a properly long password' })
  });
  ok('they can sign in', r.status === 200 && r.body.ok, r.body);

  r = await call('/api/all');
  const before = r.body || {};
  ok('and their sections are all present and all blank',
    sect(before.ld_compass) && Object.keys(sect(before.ld_compass).rocks || {}).length === 0 &&
    sect(before.ld_habits).habits.length === 0, Object.keys(before));

  /* This is the call the app makes on every open. */
  r = await call('/api/auth/me');
  ok('opening the app is what fills it in', r.status === 200 && r.body.started > 0, r.body);

  r = await call('/api/all');
  const after = r.body || {};
  const compass = sect(after.ld_compass);
  const wid = Object.keys(compass.rocks || {})[0];
  const rocks = (compass.rocks || {})[wid] || [];

  ok('there are Big Rocks now', rocks.length >= 3, { wid, n: rocks.length });
  ok('in the week they are actually in', wid === starter.weekId(new Date()), { wid, want: starter.weekId(new Date()) });
  ok('none of them behind today',
    rocks.every(x => x.day >= (new Date().getDay() + 6) % 7), rocks.map(x => x.day));
  ok('and habits to tick', sect(after.ld_habits).habits.length >= 3, after.ld_habits);
  ok('with nothing claiming to be done',
    Object.keys(sect(after.ld_habits).completions || {}).length === 0);

  /* The roles the app already had are theirs, not the template's — the
     compass existed, so only its empty parts were filled. */
  ok('their own roles survived', compass.roles.join(',') === 'Work,Health & Body', compass.roles);

  console.log('\n— and opening it again changes nothing —');
  const snapshot = JSON.stringify(after.ld_compass);
  for (let i = 0; i < 3; i++) await call('/api/auth/me');
  r = await call('/api/all');
  ok('three more opens leave it exactly as it was',
    JSON.stringify(r.body.ld_compass) === snapshot);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
