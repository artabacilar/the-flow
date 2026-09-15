/* Getting back in.
 *
 * Everything else in this suite protects data. This one protects access to
 * it — which is the failure Artur actually hit: the right password typed at
 * the right screen, refused, and no road back. So the test is not "does the
 * route return 200". It is: does the code that appeared on screen at signup,
 * typed back sloppily weeks later into a browser that has never seen this
 * account, put him back in his own Flow.
 *
 * Both roads are checked — the codes, which need foresight but no email, and
 * the emailed link, which needs no foresight but a mail provider. The second
 * one is not configured on this replica, and the test insists it says so out
 * loud rather than pretending to send.                                      */
const keepCookies = require('./cookie-jar.js');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const H = 'http://localhost:4222';
const OWNER = 'artur.abacilar@abko.com.tr';
const PW1 = 'the first long password';
const PW2 = 'a different long password';

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

const jar = {};
const call = async (p, o = {}, who = 'anon') => {
  const h = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (jar[who]) h.Cookie = jar[who];
  const r = await fetch(H + p, Object.assign({}, o, { headers: h }));
  keepCookies(jar, who, r);
  let b = null; try { b = await r.json(); } catch (e) {}
  return { status: r.status, body: b };
};
const post = (p, body, who) => call(p, { method: 'POST', body: JSON.stringify(body || {}) }, who);

(async () => {
  const pack = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
  let codes = [];

  const browser = await chromium.launch();
  try {
    /* ---- 1 · the codes exist, once, at signup ---------------------------- */
    console.log('\n— signing up, in a real browser —');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(H + '/', { waitUntil: 'load' });
    await p.waitForTimeout(2600);

    ok('the sign-in screen is up', await p.isVisible('#flow-auth'));

    /* Typing a long password blind on a phone is how people end up choosing
       short ones. It has to default to hidden, and it must not stay revealed
       across a mode change. */
    ok('the password is hidden to start with',
       await p.getAttribute('#fa-pw', 'type') === 'password');
    await p.click('#fa-eye');
    ok('the toggle reveals it', await p.getAttribute('#fa-pw', 'type') === 'text');
    ok('and says how to put it back', (await p.textContent('#fa-eye')).trim() === 'Hide');
    await p.click('#fa-eye');
    ok('and hides it again', await p.getAttribute('#fa-pw', 'type') === 'password');
    ok('the toggle never submits the form', await p.isVisible('#flow-auth'));
    await p.fill('#fa-email', OWNER);
    await p.fill('#fa-name', 'Artur');
    await p.fill('#fa-pw', PW1);
    await p.click('#fa-go');
    await p.waitForSelector('#flow-codes', { timeout: 15000 }).catch(() => {});

    ok('the codes are shown before the app is', await p.isVisible('#flow-codes'));
    const listed = (await p.textContent('#fc-list').catch(() => '') || '')
      .split('\n').map((s) => s.trim()).filter(Boolean);
    codes = listed.slice();
    ok('ten of them', codes.length === 10, codes.length);
    ok('each one is XXXX-XXXX-XXXX', codes.every((c) => /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(c)), codes[0]);
    ok('no two the same', new Set(codes).size === 10, new Set(codes).size);
    /* I, L, O and U are left out on purpose — they are the four characters
       people mis-transcribe from a printout. */
    ok('no character that gets misread by hand', codes.every((c) => !/[ILOU]/.test(c)), codes.join(' '));

    ok('you cannot click past them by accident', await p.isDisabled('#fc-done'));
    await p.check('#fc-ack');
    ok('saying you wrote them down unlocks the way out', await p.isEnabled('#fc-done'));

    await Promise.all([p.waitForNavigation({ timeout: 15000 }).catch(() => {}), p.click('#fc-done')]);
    await p.waitForTimeout(2800);
    ok('and then the app opens, signed in', !(await p.isVisible('#flow-codes').catch(() => false))
                                        && !(await p.isVisible('#flow-auth').catch(() => false)));
    ok('no page errors along the way', errs.length === 0, errs);
    await ctx.close();

    /* ---- 2 · locked out, in a browser that has never seen this account --- */
    console.log('\n— coming back locked out, on a clean browser —');
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const q = await ctx2.newPage();
    const errs2 = []; q.on('pageerror', (e) => errs2.push(e.message));
    await q.goto(H + '/', { waitUntil: 'load' });
    await q.waitForTimeout(2600);

    ok('it asks him to sign in', await q.isVisible('#flow-auth'));
    ok('the way back is on the screen, not buried', await q.isVisible('#fa-forgot'));
    ok('and the recovery field is hidden until asked for', !(await q.isVisible('#fa-rcwrap')));

    await q.click('#fa-eye');
    ok('revealed on the sign-in form', await q.getAttribute('#fa-pw', 'type') === 'text');
    await q.click('#fa-forgot');
    await q.waitForTimeout(250);
    ok('and hidden again once the form asks for something else',
       await q.getAttribute('#fa-pw', 'type') === 'password');
    ok('asking for it shows the code field', await q.isVisible('#fa-rcwrap'));
    ok('the heading says what will happen', (await q.textContent('#fa-h')).indexOf('new password') >= 0,
       await q.textContent('#fa-h'));
    ok('the other road is offered too', await q.isVisible('#fa-mail'));

    /* Typed the way somebody reads it off a piece of paper: wrong case, a
       space where the dash is, and the two letters that look like digits. */
    const sloppy = codes[3].toLowerCase().replace(/-/g, ' ');
    await q.fill('#fa-email', OWNER.toUpperCase());
    await q.fill('#fa-rc', sloppy);
    await q.fill('#fa-pw', PW2);
    await Promise.all([q.waitForNavigation({ timeout: 15000 }).catch(() => {}), q.click('#fa-go')]);
    await q.waitForTimeout(2800);
    ok('a code read off paper gets him back in', !(await q.isVisible('#flow-auth').catch(() => false)));
    ok('no page errors along the way', errs2.length === 0, errs2);
    await ctx2.close();

    /* ---- 3 · the mail road says so when it is not set up ---------------- */
    console.log('\n— the emailed link, on a Flow with no mail provider —');
    const ctx3 = await browser.newContext();
    const m = await ctx3.newPage();
    await m.goto(H + '/', { waitUntil: 'load' });
    await m.waitForTimeout(2600);
    await m.click('#fa-forgot'); await m.waitForTimeout(200);
    await m.fill('#fa-email', OWNER);
    await m.click('#fa-mail'); await m.waitForTimeout(900);
    const said = await m.textContent('#fa-err').catch(() => '');
    ok('it admits there is no mail set up rather than faking a send',
       /not set up/i.test(said || ''), said);
    ok('and points at the codes instead', /recovery code/i.test(said || ''), said);
    await ctx3.close();
  } finally {
    await browser.close();
  }

  /* ---- 4 · the rules underneath ---------------------------------------- */
  console.log('\n— the rules, checked directly —');
  let r = await post('/api/auth/login', { email: OWNER, password: PW2 }, 'artur');
  ok('the new password works', r.status === 200 && r.body.ok, r.body);
  r = await post('/api/auth/login', { email: OWNER, password: PW1 }, 'old');
  ok('the old one does not', r.status === 401, r.status);

  r = await call('/api/auth/recovery/status', {}, 'artur');
  ok('nine codes left after using one', r.body && r.body.left === 9, r.body);
  ok('and it remembers when they were made', !!(r.body && r.body.minted), r.body);

  r = await post('/api/auth/recover', { email: OWNER, code: codes[3], password: 'yet another long one' });
  ok('the same code cannot be used twice', r.status === 401, { s: r.status, b: r.body });

  const unknown = await post('/api/auth/recover',
    { email: 'nobody-at-all@example.com', code: codes[4], password: 'yet another long one' });
  const wrongCode = await post('/api/auth/recover',
    { email: OWNER, code: 'ZZZZ-ZZZZ-ZZZZ', password: 'yet another long one' });
  ok('an address with no account answers exactly like a wrong code',
     unknown.status === wrongCode.status && unknown.body.error === wrongCode.body.error,
     { unknown: unknown.body, wrongCode: wrongCode.body });

  r = await post('/api/auth/recover', { email: OWNER, code: codes[5], password: 'short' });
  ok('a too-short new password is refused before the code is spent', r.status === 400, r.body);
  const PW3 = 'a long enough one now';
  r = await post('/api/auth/recover', { email: OWNER, code: codes[5], password: PW3 });
  ok('and that code still works afterwards', r.status === 200, { s: r.status, b: r.body });
  /* That reset moved the password. Signing back in with the old one here was
     silently failing, which is how the next test came to be written against a
     password that no longer existed. */
  r = await post('/api/auth/login', { email: OWNER, password: PW3 }, 'artur');
  ok('the owner is signed in again on the new password', r.status === 200, r.status);

  console.log('\n— grinding it is not an option —');
  const grind = 'grinder@example.com';
  let last = null;
  for (let i = 0; i < 12; i++) last = await post('/api/auth/recover',
    { email: grind, code: 'AAAA-BBBB-CCCC', password: 'a long enough password' });
  ok('guessing gets cut off for the day', last.status === 429, { s: last.status, b: last.body });
  ok('and it says when to come back', /tomorrow/i.test((last.body || {}).error || ''), last.body);

  console.log('\n— a reset really does close everyone else out —');
  /* This is the whole promise of a reset: if somebody else knew the old
     password, they are out. It was quietly broken until the store learned to
     enumerate its own keys — dropAllSessions had nothing to scan, so it
     returned 0 and the screen said it had done something it had not. */
  r = await post('/api/auth/login', { email: OWNER, password: PW3 }, 'intruder');
  ok('a second device signs in with the current password', r.status === 200, r.status);
  r = await call('/api/auth/me', {}, 'intruder');
  ok('and that session works', r.status === 200 && !!r.body.user, r.body);

  r = await post('/api/auth/recover',
    { email: OWNER, code: codes[8], password: 'the password after the reset' });
  ok('the owner resets with a recovery code', r.status === 200, { s: r.status, b: r.body });

  r = await call('/api/auth/me', {}, 'intruder');
  ok('the other device is signed out by the reset', r.status === 200 && !r.body.user, r.body);
  r = await call('/api/all', {}, 'intruder');
  ok('and can no longer read anything', r.status === 401, r.status);
  r = await post('/api/auth/login', { email: OWNER, password: 'the password after the reset' }, 'artur');
  ok('and the owner signs in on the password the reset set', r.status === 200, r.status);

  console.log('\n— minting a fresh set —');
  r = await post('/api/auth/recovery', {}, 'artur');
  ok('signed in, you can make a new set', r.status === 200 && r.body.codes.length === 10, r.status);
  const fresh = r.body.codes;
  ok('they are not the old ones', !fresh.some((c) => codes.indexOf(c) >= 0));
  r = await post('/api/auth/recover', { email: OWNER, code: codes[7], password: 'a long enough password' });
  ok('an old printout stops working the moment new codes are made', r.status === 401, r.status);
  r = await call('/api/auth/recovery/status', {}, 'artur');
  ok('and the count is back to ten', r.body.left === 10, r.body);

  /* 'nobody' has never been handed a cookie by this file — the default jar
     has, because a successful recovery signs you in, and reusing it here
     would have tested nothing at all. */
  r = await post('/api/auth/recovery', {}, 'nobody');
  ok('a stranger cannot mint codes for somebody else', r.status === 401, r.status);
  r = await call('/api/auth/recovery/status', {}, 'nobody');
  ok('nor read how many they have', r.status === 401, r.status);

  console.log('\n— the emailed link —');
  r = await post('/api/auth/reset', { email: OWNER });
  ok('says plainly that it is not set up here', r.status === 501, { s: r.status, b: r.body });
  ok('and flags that codes are the working road', r.body.recoveryAvailable === true, r.body);
  r = await post('/api/auth/reset/confirm', { token: 'made-up', password: 'a long enough password' });
  ok('an invented reset token is refused', r.status === 401, { s: r.status, b: r.body });
  r = await post('/api/auth/reset/confirm', { token: '', password: 'a long enough password' });
  ok('so is an empty one', r.status === 401, r.status);

  /* ---- 5 · the screen that shows codes can only be reached honestly ----- */
  console.log('\n— what the client is built to do —');
  ok('signup shows the codes before it reloads', pack.indexOf('Auth.showCodes(j.recoveryCodes') >= 0);
  ok('the recover screen posts to the recover route', pack.indexOf("'/api/auth/recover'") >= 0);
  ok('the emailed link is honoured at boot', pack.indexOf('Auth.resetScreen(rt)') >= 0);
  ok('and the token is taken back out of the address bar',
     pack.indexOf("history.replaceState(null, '', location.pathname)") >= 0);
  ok('settings can mint a set for an account that has none',
     pack.indexOf("a === 'reccodes'") >= 0 && pack.indexOf('/api/auth/recovery') >= 0);
  ok('settings says out loud when there are none', pack.indexOf('You have no recovery codes') >= 0);
  /* The codes must never be written anywhere the browser keeps them. */
  const codeBlock = pack.slice(pack.indexOf('showCodes(codes, opts)'), pack.indexOf('resetScreen(token)'));
  ok('the codes are never put in localStorage', codeBlock.indexOf('localStorage') < 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
