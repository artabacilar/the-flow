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
    JSON.stringify(JSON.parse(mine.ld_compass).rocks).length > 100);
  ok('and habits to tick',
    JSON.parse(mine.ld_habits).habits.length >= 3, mine.ld_habits);
  ok('the welcome line uses their name',
    /Newcomer/.test(mine.ld_journal), mine.ld_journal);
  ok('and the scoreboard is honestly at zero',
    Object.keys(JSON.parse(mine.ld_habits).completions).length === 0);

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
    JSON.parse(r.body.ld_habits).habits.length === 1, r.body.ld_habits);
  ok('and does not wipe what they logged',
    JSON.parse(r.body.ld_habits).completions.h1['2026-09-15'] === true, r.body.ld_habits);

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

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
