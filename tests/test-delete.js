/* Closing the account.
 *
 * Apple requires an app that can open an account to be able to close it from
 * inside the app. That is a rule with a good reason behind it, and the reason
 * is the thing this tests: not that a row disappears, but that everything
 * attached to the person does — the entries, the sessions, the assistant
 * tokens, the OAuth grants — because a half-deleted account is worse than an
 * undeleted one. It looks gone and isn't.
 */
const keepCookies = require('./cookie-jar.js');

const H = 'http://localhost:4222';
const OWNER = 'artur.abacilar@abko.com.tr';
const PW = 'a properly long password';

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
const del = (p, body, who) => call(p, { method: 'DELETE', body: JSON.stringify(body || {}) }, who);
const rawDump = () => fetch('http://localhost:4223').then(r => r.json());

(async () => {
  console.log('\n— two accounts, both with something in them —');
  let r = await post('/api/auth/signup', { email: OWNER, password: PW, name: 'Artur' }, 'artur');
  ok('the owner signs up', r.status === 200 && r.body.ok, r.body);
  const codes = r.body.recoveryCodes || [];
  ok('and is handed recovery codes', codes.length === 10, codes.length);

  r = await post('/api/auth/signup', { email: 'sister@example.com', password: PW, name: 'Sister', invite: 'letmein' }, 'sis');
  ok('a second account signs up', r.status === 200, r.body);

  await post('/api/set', { key: 'ld_journal', value: JSON.stringify([{ t: 'x', txt: 'his' }]) }, 'artur');
  await post('/api/set', { key: 'ld_expenses', value: JSON.stringify([{ a: 1 }]) }, 'artur');
  await post('/api/set', { key: 'ld_journal', value: JSON.stringify([{ t: 'y', txt: 'hers' }]) }, 'sis');

  r = await post('/api/flow/tokens', { name: 'Claude' }, 'artur');
  ok('the owner makes an access token', r.status === 200 && !!(r.body.token || r.body.access), r.status);

  let d = await rawDump();
  const before = Object.keys(d);
  const hisUid = (JSON.parse(d['__auth:users'] || '{}')[OWNER] || {}).id;
  ok('his uid is on record before the delete', !!hisUid, hisUid);
  const hisData = before.filter(k => /^ld_u[0-9a-f]+:/.test(k));
  ok('both accounts have data on the server', hisData.length >= 3, hisData.length);
  ok('the owner has an access token stored', before.some(k => k.indexOf('__auth:pat:') === 0));
  ok('and an index listing it', before.some(k => k.indexOf('__auth:pats:') === 0));

  console.log('\n— it will not delete on a tap —');
  r = await del('/api/auth/account', { password: 'wrong one entirely', confirm: OWNER }, 'artur');
  ok('a wrong password is refused', r.status === 401, { s: r.status, b: r.body });
  r = await del('/api/auth/account', { password: PW, confirm: 'not-my-address@example.com' }, 'artur');
  ok('and so is the wrong confirmation', r.status === 400, { s: r.status, b: r.body });
  r = await del('/api/auth/account', { password: PW, confirm: OWNER }, 'nobody');
  ok('a stranger cannot delete somebody else', r.status === 401, r.status);

  r = await call('/api/auth/me', {}, 'artur');
  ok('after all that he is still signed in', r.status === 200 && !!r.body.user, r.body);

  console.log('\n— and when it does —');
  r = await del('/api/auth/account', { password: PW, confirm: OWNER.toUpperCase() }, 'artur');
  ok('the address is matched case-insensitively', r.status === 200 && r.body.ok, { s: r.status, b: r.body });
  ok('it says what it removed', r.body.deleted && r.body.deleted.data >= 2, r.body.deleted);
  ok('including the access token', r.body.deleted.tokens >= 1, r.body.deleted);

  d = await rawDump();
  const after = Object.keys(d);
  const live = (k) => k in d && d[k] !== '' && d[k] !== null;

  console.log('\n— nothing of his is left —');
  ok('his entries are gone', !after.some(k => /^ld_u[0-9a-f]+:/.test(k) && live(k) && String(d[k]).indexOf('his') >= 0),
     after.filter(k => /^ld_u/.test(k) && live(k)));
  ok('his access token is gone', !after.some(k => k.indexOf('__auth:pat:') === 0 && live(k)));
  ok('the token index is gone', !after.some(k => k.indexOf('__auth:pats:') === 0 && live(k)));
  const users = JSON.parse(d['__auth:users'] || '{}');
  ok('he is no longer in the user list', !(OWNER in users), Object.keys(users));
  /* His uid, captured before the delete, is the only way to tell his session
     records from hers now that his user row is gone. */
  const stillHis = Object.keys(d).filter(k => {
    if (k.indexOf('__auth:sess:') !== 0 || !live(k)) return false;
    try { return JSON.parse(d[k]).uid === hisUid; } catch (e) { return false; }
  });
  ok('his session records are gone, not just his cookie', stillHis.length === 0, stillHis);

  console.log('\n— his cookie is dead, and cannot be revived —');
  r = await call('/api/auth/me', {}, 'artur');
  ok('me no longer knows him', r.status === 200 && !r.body.user, r.body);
  r = await call('/api/all', {}, 'artur');
  ok('and his data cannot be read with the old cookie', r.status === 401, r.status);
  r = await post('/api/auth/login', { email: OWNER, password: PW }, 'ghost');
  ok('the old password no longer signs in', r.status === 401, r.status);
  r = await post('/api/auth/recover', { email: OWNER, code: codes[0], password: 'a brand new long password' }, 'ghost');
  ok('and neither does a recovery code he kept', r.status === 401, { s: r.status, b: r.body });

  console.log('\n— and the other account is untouched —');
  r = await call('/api/auth/me', {}, 'sis');
  ok('she is still signed in', r.status === 200 && r.body.user && r.body.user.email === 'sister@example.com', r.body);
  r = await call('/api/all', {}, 'sis');
  ok('with her journal exactly as it was', JSON.stringify(r.body || {}).indexOf('hers') >= 0, Object.keys(r.body || {}));

  console.log('\n— the address is free again —');
  r = await post('/api/auth/signup', { email: OWNER, password: 'a different long password', name: 'Artur', invite: 'letmein' }, 'again');
  ok('the same email can make a fresh account', r.status === 200 && r.body.ok, { s: r.status, b: r.body });
  r = await call('/api/all', {}, 'again');
  ok('and it starts empty, not with the old data', JSON.stringify(r.body || {}).indexOf('his') < 0, Object.keys(r.body || {}));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
