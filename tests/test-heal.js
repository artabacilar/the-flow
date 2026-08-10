/* The situation Artur is actually in: he signed up under the broken build, so
   his namespace is empty and a claim stamp already exists. He still holds a
   valid session, so he never posts to /api/auth/login — which was the only
   thing that could re-run adoption. Loading the app must fix it by itself. */
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

(async () => {
  console.log('\n— an owner whose session predates the fix —');
  let r = await call('/api/auth/login', { method: 'POST',
    body: JSON.stringify({ email: 'artur.abacilar@abko.com.tr', password: 'a properly long password' }) }, 'artur');
  ok('signs in with the existing session', r.status === 200, r.body);

  console.log('\n— the diagnostic tells the truth without leaking values —');
  r = await call('/api/auth/diag', {}, 'artur');
  ok('owner can read it', r.status === 200, r.status);
  ok('it sees the un-namespaced originals', r.body.unNamespaced.length === 4, r.body.unNamespaced);
  ok('it reports the stale v1 claim', r.body.claimV1 === true, r.body.claimV1);
  ok('the namespace is empty despite a v2 claim', r.body.mineCount === 0, r.body.mineCount);
  const anon = await fetch(H + '/api/auth/diag').then(x => x.status);
  ok('nobody else can read it', anon === 403, anon);

  console.log('\n— simply loading the app heals it —');
  r = await call('/api/auth/me', {}, 'artur');
  ok('me reports what it rescued', r.body.healed === 4, r.body.healed);
  r = await call('/api/all', {}, 'artur');
  const keys = Object.keys(r.body || {});
  ok('every key is back', keys.length === 4, keys);
  ok('the 295 journal entries are back', JSON.parse(r.body.ld_journal).length === 295, keys);
  ok('no prefix leaks to the client', keys.every(k => !/^ld_u|^u:/.test(k)), keys);

  console.log('\n— and it is inert from then on —');
  await call('/api/set', { method: 'POST',
    body: JSON.stringify({ key: 'ld_journal', value: JSON.stringify([{ t: 'today only' }]) }) }, 'artur');
  r = await call('/api/auth/me', {}, 'artur');
  ok('a later load heals nothing', r.body.healed === 0, r.body.healed);
  r = await call('/api/all', {}, 'artur');
  ok('it did NOT overwrite the newer journal', JSON.parse(r.body.ld_journal).length === 1, r.body.ld_journal);

  console.log('\n— a family member is never healed into the owner\'s data —');
  r = await call('/api/auth/signup', { method: 'POST',
    body: JSON.stringify({ email: 'brother@example.com', password: 'another long password' }) }, 'bro');
  ok('second account created', r.status === 200, r.body);
  r = await call('/api/auth/me', {}, 'bro');
  ok('nothing is healed for a non-owner', !r.body.healed, r.body.healed);
  r = await call('/api/all', {}, 'bro');
  ok('brother still sees an empty app', Object.keys(r.body || {}).length === 0, Object.keys(r.body || {}));
  r = await call('/api/auth/diag', {}, 'bro');
  ok('and cannot read the diagnostic', r.status === 403, r.status);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
