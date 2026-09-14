/* What an open costs.
 *
 * The app used to pull the whole account on every single open — every journal
 * entry, every week, every habit — over the person's own connection, to
 * discover almost every time that nothing had changed. Measured from Istanbul
 * that was 922 KB and four and a half seconds, on a page that had already
 * painted itself from the device in under half of one.
 *
 * So the exchange is in two parts now: a list of signatures, and then only the
 * sections whose signature moved. The checks below are about the two ways that
 * can go wrong. It can be slow again — a manifest that carries content, or a
 * client that asks for everything anyway. Or it can be wrong — which is worse,
 * because a sync that quietly decides it is up to date when it is not loses
 * work rather than time. */
const http = require('http');
const path = require('path');
const fs = require('fs');

const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

const rq = (p, opts = {}) => new Promise((resolve) => {
  const u = new URL(H + p);
  const body = opts.body || null;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search,
    method: opts.method || 'GET', headers }, (res) => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      let j = null; try { j = JSON.parse(b); } catch (e) {}
      resolve({ status: res.statusCode, json: j, text: b, headers: res.headers });
    });
  });
  r.on('error', () => resolve({ status: 0, json: null, text: '' }));
  if (body) r.write(body);
  r.end();
});

const jar = {};
async function as(who, p, opts = {}) {
  const o = Object.assign({}, opts);
  o.headers = Object.assign({}, opts.headers || {});
  if (jar[who]) o.headers.Cookie = jar[who];
  const r = await rq(p, o);
  const sc = r.headers && r.headers['set-cookie'];
  if (sc) jar[who] = sc.map(c => c.split(';')[0]).join('; ');
  return r;
}
const signUp = (who, email, invite) => as(who, '/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email, name: who, password: 'a properly long password', invite })
});
const put = (who, key, value) => as(who, '/api/set', {
  method: 'POST', body: JSON.stringify({ key, value })
});
const some = (who, keys) => as(who, '/api/some', {
  method: 'POST', body: JSON.stringify({ keys })
});

(async () => {
  console.log('\n— the manifest says what is there, and nothing more —');
  await signUp('artur', 'artur.abacilar@abko.com.tr', 'letmein');
  await signUp('sam', 'sam@example.com', 'letmein');

  const BIG = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ i, text: 'entry number ' + i + ' with some weight to it' })));
  await put('artur', 'ld_journal', BIG);
  await put('artur', 'ld_habits', '{"habits":[],"completions":{}}');
  await put('artur', 'ld_compass', '{"rocks":{},"saw":{}}');

  let m = await as('artur', '/api/manifest');
  ok('it answers', m.status === 200, m.status);
  const man = m.json;
  ok('every section this account has is listed',
     ['ld_journal', 'ld_habits', 'ld_compass'].every(k => k in man), Object.keys(man));
  ok('each entry is a short signature, not a value',
     Object.values(man).every(v => typeof v === 'string' && v.length <= 16), Object.values(man).slice(0, 3));
  /* The whole point: the big section must not be recognisable in here. */
  ok('no content leaks into it', m.text.indexOf('entry number 1') < 0);
  ok('and the whole thing is small however big the account is',
     m.text.length < 1024, m.text.length);
  ok('much smaller than what it replaces',
     m.text.length * 20 < (await as('artur', '/api/all')).text.length, [m.text.length, (await as('artur', '/api/all')).text.length]);

  console.log('\n— and you get back exactly what you asked for —');
  let r = await some('artur', ['ld_habits']);
  ok('the asked-for section comes back', r.json.ld_habits === '{"habits":[],"completions":{}}', r.json);
  ok('nothing else does', Object.keys(r.json).length === 1, Object.keys(r.json));
  ok('asking for nothing costs nothing', JSON.stringify((await some('artur', [])).json) === '{}');
  ok('a section that does not exist is simply absent, not an error',
     (await some('artur', ['ld_nothing_here'])).status === 200 &&
     !('ld_nothing_here' in (await some('artur', ['ld_nothing_here'])).json));

  console.log('\n— the two halves rebuild the whole, exactly —');
  /* This is the claim the entire change rests on: manifest + the sections that
     moved must reconstruct, byte for byte, what /api/all would have sent. */
  const all = (await as('artur', '/api/all')).json;
  const rebuilt = (await some('artur', Object.keys(man))).json;
  ok('same set of sections',
     JSON.stringify(Object.keys(all).sort()) === JSON.stringify(Object.keys(rebuilt).sort()));
  ok('same bytes in every one of them',
     Object.keys(all).every(k => all[k] === rebuilt[k]));

  console.log('\n— a signature moves when, and only when, the section does —');
  const before = (await as('artur', '/api/manifest')).json;
  await put('artur', 'ld_habits', '{"habits":[{"id":"x","name":"Read"}],"completions":{}}');
  const after = (await as('artur', '/api/manifest')).json;
  ok('the edited section has a new signature', before.ld_habits !== after.ld_habits, [before.ld_habits, after.ld_habits]);
  ok('everything untouched still reads the same',
     before.ld_journal === after.ld_journal && before.ld_compass === after.ld_compass);
  /* Writing the same bytes again is not a change, and must not look like one —
     otherwise every open re-downloads whatever the app rewrote at startup. */
  await put('artur', 'ld_compass', '{"rocks":{},"saw":{}}');
  ok('rewriting identical bytes is not a change',
     (await as('artur', '/api/manifest')).json.ld_compass === before.ld_compass);

  console.log('\n— and it is still your account and only yours —');
  const theirs = (await as('sam', '/api/manifest')).json;
  ok('someone else sees none of your sections',
     !('ld_journal' in theirs) && !('ld_compass' in theirs), Object.keys(theirs));
  const stolen = await some('sam', ['ld_journal', 'ld_compass', 'ld_habits']);
  ok('and cannot ask for them by name either',
     Object.keys(stolen.json).length === 0, stolen.json);
  ok('signed out, neither endpoint answers',
     (await rq('/api/manifest')).status === 401 &&
     (await rq('/api/some', { method: 'POST', body: '{"keys":["ld_journal"]}' })).status === 401);

  console.log('\n— the client asks the cheap question first —');
  const html = fs.readFileSync(path.join(__dirname, '..', 'life-dashboard.html'), 'utf8');
  const rec = html.slice(html.indexOf('async function reconcile'), html.indexOf('function dbSet'));
  ok('it fetches the manifest', /DB_API\+'\/manifest'/.test(rec));
  ok('and no longer pulls the whole account', !/DB_API\+'\/all'/.test(rec));
  ok('it asks only for what differs', /sigs\[k\]!==man\[k\]/.test(rec));
  /* A matching signature is worthless if this device holds nothing to match. */
  ok('and for anything it does not hold at all', /painted\[k\]==null/.test(rec));
  ok('when nothing differs it sends no second request', /if\(need\.length\)\{/.test(rec));
  ok('it rebuilds the same shape the rest of the code expects',
     /all\[k\] = \(k in got\) \? got\[k\] : painted\[k\]/.test(rec));
  /* The one failure this must never have: recording "up to date" before it is. */
  const setIdx = rec.indexOf('setItem(SIG_KEY');
  const gotIdx = rec.indexOf('got=await r2.json()');
  ok('it records the signatures only after the whole exchange succeeded',
     setIdx > gotIdx && setIdx > 0, [gotIdx, setIdx]);
  ok('a refused session is told apart from a dead network',
     (rec.match(/status===401\|\|r2?\.status===403|r2\.status===401/g) || []).length >= 1);
  /* A map left behind by the last person to use this browser would tell the
     next one they are already in sync with data they have never seen. */
  ok('the map is cleared when a different account signs in here',
     /const SIG_KEY = 'ld__sigs'/.test(html) && /k!==SIG_KEY/.test(html));

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
