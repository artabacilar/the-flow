/* =========================================================================
 * The first week a new account is given.
 *
 * Until this existed, a new account opened onto nothing at all: no rocks, no
 * habits, no training week, no roles. The server had answered `seed:
 * 'template'` on every new account since namespaces were introduced and
 * nothing anywhere had ever read it. The person who found this was an App
 * Store reviewer signing in with the demo account and seeing a blank page.
 *
 * Two things are being checked here, and only one of them is "does it appear".
 *
 * 1. It appears, in the right week, and the app survives it.
 *    Writing data into an account BEFORE its first load had never happened
 *    before, and it turned out the app could not do it: tRenderWeight reached
 *    for tData.weights.length, threw during boot, and took the rest of the
 *    script with it — cData and qData never got declared and the page was
 *    blank. That crash is reachable from the MCP too, and always was.
 *
 * 2. It invents nothing.
 *    Structure is a suggestion; a record is a claim. Seeding habits is
 *    saying "here is what this surface is for". Seeding a three-day streak
 *    is telling somebody they did something they did not do, and an app
 *    whose whole purpose is an honest record cannot open by lying. The
 *    scoreboard starts at zero. That is the point of the scoreboard.
 * ====================================================================== */

const keepCookies = require('./cookie-jar.js');
const { chromium } = require('playwright');
const submitAuth = require('./submit-auth.js');
const starter = require('../flow-starter.js');
const H = 'http://localhost:4222';

let pass = 0, fail = 0;
const ok = (n, c, d) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : '')); }
};

/* A section off /api/all is a JSON string or an already-parsed object,
   depending on the store underneath — Upstash deserialises, the file store
   does not. The app handles both at its own hydrate; so must this. */
const sect = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

const jar = {};
async function call(path, opts = {}, who = 'anon') {
  const h = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (jar[who]) h.Cookie = jar[who];
  const r = await fetch(H + path, Object.assign({}, opts, { headers: h }));
  keepCookies(jar, who, r);
  let b = null; try { b = await r.json(); } catch (e) {}
  return { status: r.status, body: b, headers: r.headers };
}
const signup = (email, name, who) => call('/api/auth/signup', {
  method: 'POST', body: JSON.stringify({ email, name, password: 'a properly long password', invite: 'letmein' })
}, who);

(async () => {
  /* ------------------------------------------------------------------ *
   * The template itself, with no server anywhere near it
   * ------------------------------------------------------------------ */
  console.log('\n— what the template is made of —');

  const t = starter.build('Sam', new Date('2026-09-16T09:00:00'));
  ok('it fills every section a blank app leaves empty',
    ['ld_compass', 'ld_habits', 'ld_training', 'ld_journal']
      .every(k => t[k] != null), Object.keys(t));

  /* Where the app already has a considered default, the template leaves it
     alone. Sharpen the Blade ships eight lines; the four this used to write
     over them were fewer and worse, and the MCP suite is what noticed. */
  ok('it does not overwrite the weekly commitments the app already ships',
    t.ld_sawItems === undefined, Object.keys(t));

  ok('the rocks land in the week the person is actually in',
    !!t.ld_compass.rocks['2026-W38'], Object.keys(t.ld_compass.rocks));
  ok('and there are some', t.ld_compass.rocks['2026-W38'].length >= 3);
  ok('every rock has every field the app reads',
    t.ld_compass.rocks['2026-W38'].every(r =>
      r.id && r.title && typeof r.day === 'number' && r.day >= 0 && r.day <= 6 &&
      'time' in r && 'end' in r && 'prio' in r && 'note' in r && r.done === false),
    t.ld_compass.rocks['2026-W38'][0]);
  ok('none of them is already ticked',
    t.ld_compass.rocks['2026-W38'].every(r => r.done === false));

  /* The one an App Store reviewer would have seen. Sign up on a Wednesday and
     the first version put two rocks on Monday and Tuesday of that week, which
     the app draws in red, marked OVERDUE, for work the account did not exist
     to do. Opening by telling somebody they have already failed is the same
     lie as a streak nobody earned, pointing the other way. */
  const DAYNAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let behind = [];
  for (const day of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
                     '2026-09-18', '2026-09-19', '2026-09-20']) {
    const when = new Date(day + 'T11:00:00');
    const idx = (when.getDay() + 6) % 7;
    const built = starter.build('Sam', when);
    const wk = built.ld_compass.rocks[Object.keys(built.ld_compass.rocks)[0]] || [];
    if (!wk.length) behind.push(day + ': no rocks at all');
    wk.forEach(r => { if (r.day < idx) behind.push(day + ' (' + DAYNAMES[idx] + ') -> ' + DAYNAMES[r.day]); });
  }
  ok('whatever day you sign up on, nothing is already overdue', behind.length === 0, behind);

  /* A time is a commitment, and nobody has made one yet. A rock seeded at
     09:00 on the day you sign up at 11:00 is overdue before you have read it. */
  ok('and no rock claims a time the person never chose',
    t.ld_compass.rocks['2026-W38'].every(r => r.time === '' && r.end === ''),
    t.ld_compass.rocks['2026-W38'].map(r => r.time));
  ok('each one says it is an example and can go',
    t.ld_compass.rocks['2026-W38'].every(r => r.note.indexOf(starter.TOUR) >= 0));

  /* The mission is the one box that must stay empty. Somebody else's words
     in it are worse than a blank: they are a thing to agree with rather than
     a thing to write. */
  ok('the mission is left for the person to write', t.ld_compass.mission === '');
  ok('but the roles give the rock dropdown something to hold',
    Array.isArray(t.ld_compass.roles) && t.ld_compass.roles.length >= 3, t.ld_compass.roles);

  /* The role list exists twice — as DEFAULT_ROLES in the page and as ROLES
     here — because the server cannot read a constant out of the HTML it
     serves. Two copies of one list is a thing that drifts, so this is the
     thing that notices. */
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'life-dashboard.html'), 'utf8');
  const m = html.match(/const DEFAULT_ROLES\s*=\s*(\[[^\]]*\])/);
  const appRoles = m ? JSON.parse(m[1].replace(/'/g, '"')) : null;
  ok('and they are the same roles the app itself offers',
    !!appRoles && appRoles.join('|') === starter.ROLES.join('|'), { appRoles, starter: starter.ROLES });
  ok('so every starter rock has a role the dropdown can actually show',
    t.ld_compass.rocks['2026-W38'].every(r => starter.ROLES.indexOf(r.role) >= 0),
    t.ld_compass.rocks['2026-W38'].map(r => r.role));

  console.log('\n— and what it refuses to make up —');
  ok('no habit has been ticked on any day',
    Object.keys(t.ld_habits.completions || {}).length === 0, t.ld_habits.completions);
  ok('no weight has been recorded', t.ld_training.weights.length === 0);
  ok('no training week has been marked done',
    Object.keys(t.ld_training.weeks || {}).length === 0, t.ld_training.weeks);
  ok('no mood was invented', t.ld_mood === undefined);
  ok('no night of sleep was invented', t.ld_sleep === undefined);
  /* The journal gets exactly one line, and it is true: the account was in
     fact created just now. */
  ok('the journal says only the one thing that actually happened',
    t.ld_journal.length === 1 && /Account created/.test(t.ld_journal[0].txt), t.ld_journal);
  ok('and in the shape the Journal tab reads',
    t.ld_journal.every(e => e.t && e.cat && e.txt), t.ld_journal[0]);

  console.log('\n— the training week is a plan, not a log —');
  const plans = t.ld_training.plans['2026-W38'];
  ok('all seven days are shaped', Object.keys(plans).length === 7, Object.keys(plans));
  ok('rest days are in there too',
    Object.values(plans).some(d => d.type === 'rest'), Object.values(plans).map(d => d.type));
  ok('exercises are [name, sets] pairs, as ld_training holds them',
    Object.values(plans).every(d => d.exercises.every(e => Array.isArray(e) && e.length === 2)));
  ok('and the shape carries every field the dashboard assumes exists',
    ['weeks', 'workouts', 'times', 'timesW', 'weights', 'plans'].every(k => k in t.ld_training),
    Object.keys(t.ld_training));

  /* ------------------------------------------------------------------ *
   * "Has this account got anything in it?"
   *
   * The rescue for accounts created before the template existed first asked
   * whether the NAMESPACE was empty, and that question is useless: the app
   * writes a blank section for everything it finds missing during boot, so
   * seconds after a first open every key exists and all of them are blank.
   * The demo account had been signed into once, so the rescue refused, so
   * the App Store reviewer would still have opened onto nothing — which is
   * the whole thing it was written to prevent.
   *
   * So the test looks inside. Blank is not the same as used.
   * ------------------------------------------------------------------ */
  console.log('\n— blank is not the same as used —');

  const has = starter.hasContent;
  ok('a section the account has never had is empty', has('ld_journal', null) === false);
  ok('and so is one the app wrote blank at boot',
    has('ld_compass', JSON.stringify({ mission: '', roles: ['Work'], rocks: {}, saw: {}, reviews: {} })) === false &&
    has('ld_habits', JSON.stringify({ habits: [], completions: {} })) === false &&
    has('ld_training', JSON.stringify({ weeks: {}, plans: {}, weights: [] })) === false &&
    has('ld_journal', '[]') === false);

  ok('one Big Rock counts as content',
    has('ld_compass', JSON.stringify({ rocks: { '2026-W38': [{ id: '1' }] } })) === true);
  ok('so does a mission somebody wrote',
    has('ld_compass', JSON.stringify({ mission: 'Build the thing properly', rocks: {} })) === true);
  ok('so does one habit', has('ld_habits', JSON.stringify({ habits: [{ id: 'h' }] })) === true);
  /* A ticked day with no habit left is still a record of something. */
  ok('so does a completion with no habit beside it',
    has('ld_habits', JSON.stringify({ habits: [], completions: { h: { '2026-09-15': true } } })) === true);
  ok('so does a weight, which nothing but a person can write',
    has('ld_training', JSON.stringify({ weeks: {}, plans: {}, weights: [{ w: 80 }] })) === true);
  ok('so does a shaped training week',
    has('ld_training', JSON.stringify({ plans: { '2026-W38': { mon: {} } } })) === true);
  ok('and one journal line', has('ld_journal', '[{"t":"x","txt":"mine"}]') === true);

  /* The one that must not go the convenient way: if it cannot be read, it is
     not empty. Guessing "probably blank" about bytes we failed to parse is
     how a starter week lands on top of somebody's year. */
  /* The shape that caused it. Upstash's REST API deserialises a value that
     is valid JSON, so in production these arrive as objects, not strings.
     Given an object this used to call JSON.parse on it, throw, and take the
     "unreadable, leave it alone" branch — so every section already on the
     server read as content and was skipped, and the demo account kept
     opening with no Big Rocks while the whole suite stayed green. */
  ok('a blank section that arrives already parsed is still empty',
    has('ld_compass', { mission: '', roles: ['Work'], rocks: {}, saw: {}, reviews: {} }) === false &&
    has('ld_habits', { habits: [], completions: {} }) === false &&
    has('ld_training', { weeks: {}, plans: {}, weights: [] }) === false &&
    has('ld_journal', []) === false);
  ok('and one that arrives already parsed WITH content still counts',
    has('ld_compass', { rocks: { '2026-W38': [{ id: '1' }] } }) === true &&
    has('ld_habits', { habits: [{ id: 'h' }] }) === true &&
    has('ld_journal', [{ t: 'x' }]) === true);

  /* Filling a gap is not the same as replacing a section. Somebody can have
     edited their roles and set no rocks at all — writing the template over
     the top would take the roles away, quietly, and only from people who had
     customised one thing and not another. */
  const fill = starter.fill;
  ok('a value already there is never overwritten',
    fill({ mission: '', roles: ['Mine', 'Only'], rocks: {} },
         { mission: '', roles: ['A', 'B', 'C'], rocks: { w: [1] } }).roles.join(',') === 'Mine,Only');
  ok('while the empty parts beside it are filled',
    Object.keys(fill({ roles: ['Mine'], rocks: {} }, { rocks: { w: [1] } }).rocks).length === 1);
  ok('a section that does not exist yet is taken whole',
    fill(null, { a: 1 }).a === 1);
  ok('and a journal with entries in it is left alone',
    fill([{ t: 'mine' }], [{ t: 'template' }])[0].t === 'mine');

  ok('anything unreadable counts as content and is left alone',
    has('ld_journal', 'not json at all') === true);
  ok('and so does a section this does not recognise',
    has('ld_finance', JSON.stringify({ anything: 1 })) === true);

  /* ------------------------------------------------------------------ *
   * Signing up for real
   * ------------------------------------------------------------------ */
  console.log('\n— a brand-new account —');

  let r = await signup('artur.abacilar@abko.com.tr', 'Artur', 'owner');
  ok('the owner account is created', r.status === 200 && r.body.ok, r.body);

  r = await signup('newcomer@example.com', 'Newcomer', 'new');
  ok('and an invited one', r.status === 200 && r.body.ok, r.body);

  r = await call('/api/all', {}, 'new');
  const mine = r.body || {};
  ok('it opens onto a week rather than onto nothing',
    Object.keys(mine).length >= 4, Object.keys(mine));
  ok('with Big Rocks in it',
    JSON.stringify(sect(mine.ld_compass).rocks).length > 100);
  ok('and habits to tick',
    sect(mine.ld_habits).habits.length >= 3, mine.ld_habits);
  ok('the welcome line uses their name',
    /Newcomer/.test(mine.ld_journal), mine.ld_journal);
  ok('and the scoreboard is honestly at zero',
    Object.keys(sect(mine.ld_habits).completions).length === 0);

  /* ------------------------------------------------------------------ *
   * The half that must not go wrong
   * ------------------------------------------------------------------ */
  console.log('\n— and it never runs over anything —');

  await call('/api/set', { method: 'POST', body: JSON.stringify({
    key: 'ld_habits', value: JSON.stringify({ habits: [{ id: 'h1', name: 'Mine' }], completions: { h1: { '2026-09-15': true } } })
  }) }, 'new');

  /* Every open calls /api/auth/me, which is where the rescue for older
     accounts lives. It must be a no-op from the second call onward — an
     account that has been used for a year cannot have examples pushed back
     into it because a deploy went out. */
  for (let i = 0; i < 3; i++) await call('/api/auth/me', {}, 'new');
  r = await call('/api/all', {}, 'new');
  ok('a later open does not put the examples back',
    sect(r.body.ld_habits).habits.length === 1, r.body.ld_habits);
  ok('and does not wipe what they logged',
    sect(r.body.ld_habits).completions.h1['2026-09-15'] === true, r.body.ld_habits);

  /* The owner inherits an existing Flow rather than starting one. Seeding on
     top of that is the single way this feature could destroy something. */
  r = await call('/api/all', {}, 'owner');
  const ownerKeys = Object.keys(r.body || {});
  ok('the owner has a week too', ownerKeys.length >= 4, ownerKeys);

  /* ------------------------------------------------------------------ *
   * The app has to survive being handed a full account on its first load
   * ------------------------------------------------------------------ */
  console.log('\n— and the app boots on it —');

  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2200);
  /* Accounts already exist by now, so the card opens on Sign in and the name
     and invite fields are not on screen until it is switched over. */
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.waitForTimeout(250);
  await p.fill('#fa-email', 'fresheyes@example.com');
  await p.fill('#fa-name', 'Fresh');
  await p.fill('#fa-pw', 'a properly long password');
  await p.fill('#fa-inv', 'letmein').catch(() => {});
  await submitAuth(p);
  await p.waitForTimeout(4500);

  ok('they are signed in', await p.evaluate(() => !document.getElementById('flow-auth')));
  /* This is the check the whole crash hid behind. A boot that throws leaves
     these undefined and the page blank, and every other assertion still
     "passes" because the elements it looks for were rendered before the
     throw. Ask for the variables themselves. */
  ok('the script finished — the compass exists',
    await p.evaluate(() => typeof cData === 'object' && cData !== null));
  ok('and so does everything declared after it',
    await p.evaluate(() => typeof qData === 'object' && qData !== null));
  ok('no page errors on a first load with data in the account', errs.length === 0, errs.slice(0, 4));

  ok('the starter rocks are on the screen', await p.evaluate(() => {
    const wid = (typeof cWeekId === 'function') ? cWeekId() : null;
    return !!(wid && cData.rocks[wid] && cData.rocks[wid].length >= 3);
  }));
  ok('and the habits are on the Habits tab', await p.evaluate(() => hbData.habits.length >= 3));
  ok('while nothing claims to be done', await p.evaluate(() =>
    Object.keys(hbData.completions || {}).length === 0));

  /* Nothing on the first screen may claim a past this account does not have.
     The routine-audit banner said "six months of things you do every day are
     sitting in the record" to an account minutes old, because "never audited"
     was treated as "audit due". */
  const claims = await p.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      audit: /Six months of things you do every day/i.test(t),
      overdue: /OVERDUE/i.test(t)
    };
  });
  ok('nothing tells them six months of record is waiting to be audited', claims.audit === false);
  ok('and nothing on screen is overdue on the day they signed up', claims.overdue === false);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
