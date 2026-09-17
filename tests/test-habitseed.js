/* The Habits screen on an account that has never used it.
 *
 * A server-seeded account arrives with four habits. An account that reaches
 * this screen with nothing in it used to show "No habits yet" and an empty
 * box — asking somebody who has not used the app yet to invent four habits
 * from a standing start, which is the moment most people close it.
 *
 * So the screen fills itself the same way the Sharpen-the-Blade list already
 * does. The interesting case is not that it fills — it is that it knows when
 * NOT to. Somebody who deleted their habits on purpose must not find them
 * back the next morning, and the evidence that they meant it is their
 * completion history, not the empty list itself.
 */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 240) : '')); }
  };

  const names = (p) => p.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('ld_habits') || '{}').habits || []).map(h => h.name); }
    catch (e) { return null; }
  });

  /* ── a brand-new account ─────────────────────────────────────────────── */
  const c1 = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  const p = await c1.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p);
  await p.waitForTimeout(4200);
  ok('signed in', await p.evaluate(() => !document.getElementById('flow-auth')));

  /* The server seeds this account, so empty it first: what is under test is
     the screen filling itself, not the seeder doing it. */
  console.log('\n— it does not open empty —');
  await p.evaluate(() => localStorage.setItem('ld_habits', JSON.stringify({ habits: [], completions: {} })));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(3400);
  const seeded = await names(p);
  ok('there are four habits', Array.isArray(seeded) && seeded.length === 4, seeded);
  ok('and they are the ones the server seeds too',
    JSON.stringify(seeded) === JSON.stringify([
      'Move for 30 minutes',
      'In bed by the hour you chose',
      'One block of deep work, no phone',
      'Read something that is not a screen'
    ]), seeded);
  ok('every one of them has an id', (seeded || []).length === await p.evaluate(() =>
    (JSON.parse(localStorage.getItem('ld_habits') || '{}').habits || []).filter(h => h && h.id).length));
  ok('no two share an id', await p.evaluate(() => {
    const ids = (JSON.parse(localStorage.getItem('ld_habits') || '{}').habits || []).map(h => h.id);
    return new Set(ids).size === ids.length;
  }));
  ok('nothing is ticked — a streak has to be earned', await p.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('ld_habits') || '{}').completions || {}).length === 0));
  ok('the empty-state line is turned off', await p.evaluate(() => {
    const e = document.getElementById('hbEmpty');
    return !!e && e.style.display === 'none';
  }));

  console.log('\n— it is written down, not just drawn —');
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(3400);
  const after = await names(p);
  ok('the same four come back after a reload', JSON.stringify(after) === JSON.stringify(seeded), after);
  ok('and it did not add a second set', (after || []).length === 4, after);

  console.log('\n— somebody who deleted them on purpose —');
  /* An empty list with history behind it: they used the screen, then cleared it. */
  await p.evaluate(() => {
    localStorage.setItem('ld_habits', JSON.stringify({
      habits: [], completions: { 'gone-1': { '2026-09-14': true } }
    }));
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(3400);
  const kept = await names(p);
  ok('the list stays empty', Array.isArray(kept) && kept.length === 0, kept);
  ok('their history is untouched', await p.evaluate(() =>
    !!(JSON.parse(localStorage.getItem('ld_habits') || '{}').completions || {})['gone-1']));
  ok('and the empty-state line is what they get instead', await p.evaluate(() => {
    const e = document.getElementById('hbEmpty');
    return !!e && e.style.display === 'block';
  }));

  console.log('\n— nothing broke —');
  ok('no page errors at any point', errs.length === 0, errs);

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
