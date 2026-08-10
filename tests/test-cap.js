/* Two things a shared invite code needs: a ceiling, so a leaked code cannot
   fill the database; and a sign-in screen that does not mistake a sleeping
   server for an empty one — which is how the owner got shown "Set up your
   account" on a free instance that had just spun down. */
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 200) : ''))); };
const jar = {};
const call = async (p, o = {}, who = 'a') => {
  const h = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (jar[who]) h.Cookie = jar[who];
  const r = await fetch(H + p, Object.assign({}, o, { headers: h }));
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  let b = null; try { b = await r.json(); } catch (e) {}
  return { status: r.status, body: b };
};
const signup = (email, invite, who) => call('/api/auth/signup', { method: 'POST',
  body: JSON.stringify({ email, password: 'a properly long password', invite }) }, who || email);

(async () => {
  console.log('\n— the owner is never blocked by the cap —');
  let r = await signup('artur.abacilar@abko.com.tr', undefined, 'artur');
  ok('owner account created', r.status === 200 && r.body.user.owner === true, r.body);

  console.log('\n— invited accounts fill up to the cap of 3 —');
  r = await signup('a@example.com', 'letmein');
  ok('first invited account works', r.status === 200, r.body);
  r = await signup('b@example.com', 'letmein');
  ok('second works', r.status === 200, r.body);
  r = await signup('c@example.com', 'letmein');
  ok('and that is the cap reached', r.status === 200, r.body);

  console.log('\n— past it, a correct code is not enough —');
  r = await signup('d@example.com', 'letmein');
  ok('the next signup is refused', r.status === 403, r.status);
  ok('and says so plainly', /full/i.test((r.body || {}).error || ''), r.body);
  ok('without leaking who is already in', !/a@example|b@example/.test(JSON.stringify(r.body)), r.body);

  console.log('\n— a wrong code still fails first, cap or no cap —');
  r = await signup('e@example.com', 'guessing');
  ok('bad invite refused', r.status === 403 && /invite code/i.test(r.body.error), r.body);

  console.log('\n— the people already in are unaffected —');
  r = await call('/api/auth/login', { method: 'POST',
    body: JSON.stringify({ email: 'a@example.com', password: 'a properly long password' }) }, 'a2');
  ok('an existing member can still sign in', r.status === 200, r.body);
  r = await call('/api/all', {}, 'a2');
  ok('and still sees their own app', r.status === 200, r.status);

  console.log('\n— the owner can see how full it is —');
  r = await call('/api/auth/diag', {}, 'artur');
  ok('diag reports the count', r.body.accounts === 4, r.body.accounts);
  ok('and that the cap counts invited people only', r.body.invited === 3, r.body.invited);
  ok('and the ceiling', r.body.maxAccounts === 3, r.body.maxAccounts);

  console.log('\n— a sleeping store must not read as "no accounts yet" —');
  const probe = await fetch('http://localhost:4223/break', { method: 'POST' }).then(x => x.text());
  ok('store put into failing mode', probe === 'broken', probe);
  r = await call('/api/auth/me', {}, 'nobody');
  ok('me still answers', r.status === 200, r.status);
  ok('and does NOT claim this is a first run', r.body.needsSetup === false, r.body);
  await fetch('http://localhost:4223/fix', { method: 'POST' });
  r = await call('/api/auth/me', {}, 'nobody');
  ok('once healthy it is still not a first run', r.body.needsSetup === false, r.body);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
