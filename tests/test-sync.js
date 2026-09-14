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
  ok('and for anything it does not hold at all', /held\(k\)==null/.test(rec));
  /* The sections the pack keeps under its own names are not in local storage
     under those names. Without a copy of them here, a matching signature buys
     nothing and they come down again on every open — and they are most of the
     weight. This is the check that the whole saving does not quietly vanish. */
  ok('it keeps a copy of the sections it does not otherwise hold',
     /const CACHE_KEY = 'ld__cache'/.test(html) &&
     /cache=JSON\.parse\(lsGet\(CACHE_KEY\)/.test(rec));
  ok("and does not duplicate the app's own sections into it",
     /k\.indexOf\('ld_'\)!==0 && all\[k\]!=null/.test(rec));
  ok('a device with no room falls back rather than lying about it',
     /removeItem\(CACHE_KEY\); localStorage\.removeItem\(SIG_KEY\)/.test(rec));
  ok('the copy is cleared when a different account signs in here', /k!==CACHE_KEY/.test(html));
  ok('when nothing differs it sends no second request', /if\(need\.length\)\{/.test(rec));
  ok('it rebuilds the same shape the rest of the code expects',
     /all\[k\] = \(k in got\) \? got\[k\] : held\(k\)/.test(rec));
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

  console.log('\n— and the pack stops losing the race for it —');
  /* The pack seeds its own cache from what the reconcile downloads. It used to
     read a variable the host had not set yet: the seed was skipped in silence
     and it fetched eight sections one at a time instead — eight more trips to
     a server on another continent, for data already in flight. A promise ends
     the race. A capped wait, and a null on failure, keep it from becoming a
     screen that never arrives. */
  const pack = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
  ok('the host publishes the payload as something waitable',
     /window\.__FLOW_ALL_READY = new Promise/.test(html));
  ok('and the pack waits on it', /await Promise\.race\(\[\s*window\.__FLOW_ALL_READY/.test(pack));
  ok('the wait is capped', /setTimeout\(\(\) => r\(null\), 3000\)/.test(pack));
  ok('a payload already there is used without waiting at all',
     /let seed = window\.__FLOW_ALL;\s*\n\s*if \(!seed && window\.__FLOW_ALL_READY\)/.test(pack));
  /* Every way out of the reconcile has to settle it. One that does not is a
     pack sitting through its whole timeout for an answer that never comes. */
  const rec2 = html.slice(html.indexOf('(function hydrateFromDB'), html.indexOf('function dbSet'));
  ok('failing settles it', /function fail\(\)\{[\s\S]{0,240}publishAll\(/.test(rec2));
  ok('being signed out settles it', (rec2.match(/publishAll\(null\)/g) || []).length >= 2);
  ok('success settles it with the payload', /publishAll\(all\)/.test(rec2));
  ok('nothing still assigns it the old way', !/window\.__FLOW_ALL=all/.test(rec2));

  console.log('\n— and the badge stops asking the same question three times —');
  /* The sync badge's detail line went to the database on every repaint. The
     engine name cannot change while the page is open and the count beside it
     is a decoration, so three round trips to another continent bought one
     number nobody was waiting on. */
  ok('the status endpoint is reached from exactly one place',
     (html.match(/DB_API\+'\/status'/g) || []).length === 1);
  ok('and that place is behind a cache', /function withDbStatus\(paint\)\{/.test(html));
  ok('a cached answer is used without asking again', /if\(dbStat\) return paint\(dbStat\);/.test(html));
  ok('two repaints cannot both start a request',
     /dbStatAsked = Date\.now\(\);/.test(html) && /Date\.now\(\) - dbStatAsked < 60000/.test(html));
  ok('a failure is retried, not given up on forever', /60000/.test(html));
  ok('the badge still shows what it always showed',
     /'\u{1F7E2} Database \u00b7 '\+s\.engine\+' \u00b7 '\+s\.keys\+' sets'/u.test(html));

  console.log('\n— and the one number nobody could see —');
  /* Every round trip from the server to the database was the largest single
     cost in an open, and there was no way to look at it — which is how you end
     up moving the wrong thing to the wrong continent on a hunch. It says where
     the data is and what reaching it costs, and it says nothing else: the
     region label at the front of the hostname, never the rest of it, and never
     the token. */
  const d = await as('artur', '/api/diag');
  ok('it answers a signed-in person', d.status === 200, d.status);
  ok('it names the engine', typeof d.json.engine === 'string' && d.json.engine.length > 0, d.json.engine);
  /* It used to read a region out of the hostname, which was wrong: newer
     Upstash addresses are a random pair of words, and it confidently reported
     "liked" as a datacentre. Distance is not a string to be parsed. */
  ok('it does not claim to know a region it cannot know', !('dbRegion' in d.json), Object.keys(d.json));
  ok('it measures the round trip more than once',
     Array.isArray(d.json.dbRunsMs) && d.json.dbRunsMs.length >= 3, d.json.dbRunsMs);
  ok('and reports the fastest, not a busy moment',
     d.json.dbBestMs === Math.min.apply(null, d.json.dbRunsMs), [d.json.dbBestMs, d.json.dbRunsMs]);
  ok('it says in words what that distance means',
     typeof d.json.verdict === 'string' && d.json.verdict.length > 10, d.json.verdict);
  ok('and whether it was reached at all', typeof d.json.dbReached === 'boolean', d.json.dbReached);
  /* The whole reason this is safe to ship. */
  ok('the token appears nowhere in it', !/token/i.test(d.text), d.text.slice(0, 120));
  ok('nor does any credential-shaped value',
     !/[A-Za-z0-9_-]{40,}/.test(d.text), d.text.slice(0, 120));
  ok('and it is shut to anyone not signed in', (await rq('/api/diag')).status === 401);

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
