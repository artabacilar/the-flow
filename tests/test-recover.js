/* Reproduces EXACTLY what is live right now:
   the owner signed up under the old code, which wrote `u:<uid>:ld_*` keys and
   stamped `__auth:legacy_claimed`. Upstash's all() is `KEYS ld_*`, so those
   keys are invisible and /api/all returns {}. The fixed build must, on the
   owner's next LOGIN, re-adopt into `ld_u<uid>:` and hand back every key —
   without touching the originals. */
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
const rawDump = () => fetch('http://localhost:4223').then(r => r.json());

(async () => {
  console.log('\n— the broken state, as it exists on Render right now —');
  let d = await rawDump();
  const before = Object.keys(d).filter(k => k.indexOf('ld_') === 0 && !/^ld_u[0-9a-f]+:/.test(k));
  ok('the original ld_ keys are still there', before.length === 4, before);
  ok('the old u: namespace is present but unreachable',
     Object.keys(d).some(k => k.indexOf('u:') === 0), Object.keys(d).filter(k => k.indexOf('u:') === 0).length);
  ok('the old claim stamp is set', '__auth:legacy_claimed' in d);

  console.log('\n— the owner logs in against the fixed build —');
  let r = await call('/api/auth/login', { method: 'POST',
    body: JSON.stringify({ email: 'artur.abacilar@abko.com.tr', password: 'a properly long password' }) }, 'artur');
  ok('login succeeds', r.status === 200 && r.body.ok, r.body);
  ok('and is still the owner', r.body.user.owner === true, r.body.user);
  ok('seed is still legacy, so the template never overwrites him', r.body.seed === 'legacy', r.body.seed);

  r = await call('/api/all', {}, 'artur');
  const keys = Object.keys(r.body || {});
  ok('/api/all is no longer empty', keys.length === 4, keys);
  ok('the 295 journal entries are back', JSON.parse(r.body.ld_journal).length === 295, keys);
  ok('training is back', !!r.body.ld_training);
  ok('finance is back', !!r.body.ld_finance);
  ok('the client never sees a prefix', keys.every(k => k.indexOf('ld_u') !== 0 && k.indexOf('u:') !== 0), keys);

  console.log('\n— nothing was destroyed —');
  d = await rawDump();
  const after = Object.keys(d).filter(k => k.indexOf('ld_') === 0 && !/^ld_u[0-9a-f]+:/.test(k));
  ok('every original key is still present, untouched', after.length === 4 &&
     after.every(k => d[k] === (before.includes(k) ? d[k] : null)), after);
  ok('the adopted copies live inside the KEYS ld_* pattern',
     Object.keys(d).some(k => /^ld_u[0-9a-f]+:ld_journal$/.test(k)),
     Object.keys(d).filter(k => /^ld_u/.test(k)).slice(0, 3));
  ok('adoption is stamped v2 so it cannot run a third time', '__auth:legacy_claimed_v2' in d);

  console.log('\n— and it does not run again —');
  await call('/api/set', { method: 'POST',
    body: JSON.stringify({ key: 'ld_journal', value: JSON.stringify([{ t: 'brand new' }]) }) }, 'artur');
  await call('/api/auth/login', { method: 'POST',
    body: JSON.stringify({ email: 'artur.abacilar@abko.com.tr', password: 'a properly long password' }) }, 'artur2');
  r = await call('/api/all', {}, 'artur2');
  ok('a second login does not resurrect the old journal', JSON.parse(r.body.ld_journal).length === 1, r.body.ld_journal);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
