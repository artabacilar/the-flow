/* What an open costs, on the real server against Upstash.
 *
 * Production measured 17 Nov 2026: the database is 2 ms from the server, yet
 * /api/manifest took 338 ms. Distance was never the cost. Every signed-in
 * all() asked Upstash for EVERY `ld_*` key of EVERY account, downloaded the
 * lot, then threw away everyone else's — and the manifest did that just to
 * hash it. These checks hold the real life-os-server.js, pointed at a stand-in
 * Upstash, to the cheaper exchange:
 *   · listing is by this account's prefix, never `ld_*`
 *   · the manifest takes fingerprints in the database, values never travel
 *   · those fingerprints are byte-for-byte the ones devices already hold
 *   · /api/some fetches only what was asked for
 *   · if the database cannot fingerprint, it falls back and stays right
 * Run: node tests/test-fastsync.js   (starts its own servers on 4231/4232) */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const keepCookies = require('./cookie-jar.js');

const UP = 4231, APP = 4232, H = 'http://localhost:' + APP;
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const sig = v => crypto.createHash('sha1').update(String(v)).digest('base64').slice(0, 10);

/* ── a stand-in Upstash: the REST shape, the commands the server uses ── */
const db = {};
const log = [];
let evalBroken = false;
const glob = (pat) => {
  let rx = '^';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '\\') { rx += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '*') { rx += '.*'; continue; }
    if (c === '?') { rx += '.'; continue; }
    rx += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(rx + '$');
};
function run(a) {
  const c = String(a[0]).toUpperCase();
  log.push(c === 'KEYS' ? 'KEYS ' + a[1] : c === 'EVAL' ? 'EVAL ' + a[3] : c === 'MGET' ? 'MGET ' + (a.length - 1) : c);
  if (c === 'GET') return db[a[1]] == null ? null : db[a[1]];
  if (c === 'SET') { db[a[1]] = String(a[2]); return 'OK'; }
  if (c === 'KEYS') { const r = glob(a[1]); return Object.keys(db).filter(k => r.test(k)); }
  if (c === 'MGET') return a.slice(1).map(k => db[k] == null ? null : db[k]);
  if (c === 'EVAL') {
    if (evalBroken) throw new Error('ERR unknown command');
    if (!/sha1hex/.test(a[1])) throw new Error('ERR unexpected script');
    const r = glob(a[3]), out = [];
    for (const k of Object.keys(db).filter(k => r.test(k))) {
      out.push(k, crypto.createHash('sha1').update(Buffer.from(db[k], 'utf8')).digest('hex'));
    }
    return out;
  }
  throw new Error('ERR unsupported ' + c);
}
const upstash = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    let body; try { body = JSON.parse(b); } catch (e) { res.end('{"error":"bad json"}'); return; }
    if (req.url === '/pipeline') {
      res.end(JSON.stringify(body.map(cmd => { try { return { result: run(cmd) }; } catch (e) { return { error: e.message }; } })));
      return;
    }
    try { res.end(JSON.stringify({ result: run(body) })); }
    catch (e) { res.end(JSON.stringify({ error: e.message })); }
  });
});

/* ── a client with cookies ── */
const rq = (p, opts = {}) => new Promise((resolve) => {
  const u = new URL(H + p);
  const body = opts.body || null;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search,
    method: opts.method || 'GET', headers }, (res) => {
    let b = ''; res.on('data', c => b += c);
    res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json: j, text: b, headers: res.headers }); });
  });
  r.on('error', () => resolve({ status: 0, json: null, text: '' }));
  if (body) r.write(body);
  r.end();
});
const jar = {};
async function as(who, p, opts = {}) {
  const o = Object.assign({}, opts); o.headers = Object.assign({}, opts.headers || {});
  if (jar[who]) o.headers.Cookie = jar[who];
  const r = await rq(p, o); keepCookies(jar, who, r); return r;
}
const signUp = (who, email) => as(who, '/api/auth/signup', { method: 'POST',
  body: JSON.stringify({ email, name: who, password: 'a properly long password', invite: 'letmein' }) });
const put = (who, key, value) => as(who, '/api/set', { method: 'POST', body: JSON.stringify({ key, value }) });

(async () => {
  await new Promise(r => upstash.listen(UP, r));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'life-os-server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(APP), UPSTASH_REDIS_REST_URL: 'http://localhost:' + UP, UPSTASH_REDIS_REST_TOKEN: 'test',
      FLOW_OWNER_EMAIL: 'owner@example.test', FLOW_INVITE_CODE: 'letmein', DATA_DIR: require('os').tmpdir()
    }), stdio: ['ignore', 'pipe', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => err += d);
  for (let i = 0; i < 60; i++) { const r = await rq('/healthz'); if (r.status === 200) break; await new Promise(r => setTimeout(r, 150)); }

  try {
    console.log('\n— two accounts on one database —');
    ok('owner signs up', (await signUp('artur', 'owner@example.test')).status < 300);
    ok('a second person signs up', (await signUp('sam', 'sam@example.test')).status < 300);
    const big = 'x'.repeat(200000);
    await put('artur', 'ld_journal', JSON.stringify({ note: 'çok güzel — ünicode İ ş ğ 🌊', big }));
    await put('artur', 'ld_week', JSON.stringify({ rocks: [1, 2, 3] }));
    await put('artur', 'ld_empty', '');
    await put('sam', 'ld_journal', JSON.stringify({ theirs: 'y'.repeat(300000) }));

    const all = (await as('artur', '/api/all')).json || {};
    ok('all() still returns my sections', all.ld_week && all.ld_journal && JSON.parse(all.ld_journal).note.indexOf('🌊') > 0, Object.keys(all));
    ok('and none of theirs', !JSON.stringify(all).includes('yyyy'));

    console.log('\n— the manifest —');
    log.length = 0;
    const man = (await as('artur', '/api/manifest')).json || {};
    ok('it lists my sections', man.ld_week && man.ld_journal, man);
    ok('signatures are the same bytes devices already hold (unicode too)',
       man.ld_journal === sig(all.ld_journal) && man.ld_week === sig(all.ld_week), { man, want: sig(all.ld_journal) });
    ok('an emptied section is still listed, as before', 'ld_empty' in man && man.ld_empty === sig(''), man.ld_empty);
    ok('fingerprints were taken in the database', log.some(l => /^EVAL ld_u.+:\*$/.test(l)), log);
    ok('no value was downloaded for a second manifest', await (async () => {
      log.length = 0; await as('artur', '/api/manifest'); return !log.some(l => /^MGET/.test(l));
    })(), log);
    ok('nothing asked for every account (KEYS ld_*)', !log.some(l => l === 'KEYS ld_*' || l === 'EVAL ld_*'), log);

    console.log('\n— /api/some and /api/all —');
    log.length = 0;
    const s = (await as('artur', '/api/some', { method: 'POST', body: JSON.stringify({ keys: ['ld_week', 'ld_nope', 5] }) })).json || {};
    ok('/api/some gives only what was asked', Object.keys(s).join() === 'ld_week', s);
    ok('without listing the database', !log.some(l => /^KEYS/.test(l)) && log.includes('MGET 2'), log);
    log.length = 0;
    await as('artur', '/api/all');
    ok('/api/all lists by my prefix only', log.some(l => /^KEYS ld_u.+:\*$/.test(l)) && !log.includes('KEYS ld_*'), log);
    const theirs = (await as('sam', '/api/manifest')).json || {};
    ok('the other account sees its own manifest, not mine', theirs.ld_journal && theirs.ld_journal !== man.ld_journal && !theirs.ld_week, theirs);
    const anon = await rq('/api/manifest');
    ok('signed out gets nothing', anon.status === 401 || anon.status === 302 || anon.status === 403 || !anon.json || !Object.keys(anon.json).length, anon.status);

    console.log('\n— a database that cannot fingerprint —');
    evalBroken = true;
    const man2 = (await as('artur', '/api/manifest')).json || {};
    ok('falls back and gives the same signatures', man2.ld_journal === man.ld_journal && man2.ld_week === man.ld_week, man2);
    evalBroken = false;

    console.log('\n— a change moves only its signature —');
    await put('artur', 'ld_week', JSON.stringify({ rocks: [1, 2, 3, 4] }));
    const man3 = (await as('artur', '/api/manifest')).json || {};
    ok('the changed one moved', man3.ld_week !== man.ld_week);
    ok('the others did not', man3.ld_journal === man.ld_journal);

    console.log('\n— what a device downloads —');
    await put('artur', 'team:tasks', JSON.stringify([{ id: 't1', result: 'z'.repeat(50000) }]));
    await put('artur', 'flow:receipt:abc', 'data:image/jpeg;base64,' + 'A'.repeat(40000));
    await put('artur', 'flow:settings', JSON.stringify({ newLook: true }));
    const all2 = (await as('artur', '/api/all')).json || {};
    const man4 = (await as('artur', '/api/manifest')).json || {};
    ok('the app\'s own sections still come down', all2.ld_week && all2['flow:settings'] && man4['flow:settings'], Object.keys(all2));
    ok('J.A.R.V.I.S.\'s records and receipt photos do not', !all2['team:tasks'] && !all2['flow:receipt:abc'] && !man4['team:tasks'] && !man4['flow:receipt:abc'], Object.keys(man4));
    const g = (await as('artur', '/api/get?key=team:tasks')).json || {};
    ok('but they are still there, one at a time', String(g.value).indexOf('zzzz') > 0);
    const ex = (await as('artur', '/api/export')).json || {};
    ok('and in the backup export', ex.data && ex.data['team:tasks'] && ex.data['flow:receipt:abc'] && ex.data.ld_week);

    console.log('\n— tidying the journal —');
    const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
    const jr = [
      { t: day(200), cat: 'planning', txt: '✅ Big rock done: old one' },
      { t: day(100), cat: 'planning', txt: '✏️ Big rock changed: old two' },
      { t: day(100), cat: 'training', txt: 'Legs, heavy' },
      { t: day(100), cat: 'mood', txt: 'Good day' },
      { t: day(10), cat: 'planning', txt: '✅ Big rock done: recent' }
    ];
    await put('artur', 'ld_journal', JSON.stringify(jr));
    const dry = (await as('artur', '/api/archive/tidy', { method: 'POST', body: JSON.stringify({ dryRun: true }) })).json || {};
    const still = JSON.parse(((await as('artur', '/api/get?key=ld_journal')).json || {}).value || '[]');
    ok('a dry run says what would move and moves nothing', dry.journal && dry.journal.moved === 2 && still.length === 5, dry);
    const t1 = (await as('artur', '/api/archive/tidy', { method: 'POST', body: '{}' })).json || {};
    const j2 = JSON.parse(((await as('artur', '/api/get?key=ld_journal')).json || {}).value || '[]');
    const ar = JSON.parse(((await as('artur', '/api/get?key=archive:ld_journal')).json || {}).value || '[]');
    ok('only the old automatic log moved', j2.length === 3 && j2.every(e => e.cat !== 'planning' || e.txt.indexOf('recent') > 0), j2);
    ok('your own entries stay, however old', j2.some(e => e.cat === 'training') && j2.some(e => e.cat === 'mood'));
    ok('the moved entries are in the archive', ar.length === 2 && ar[0].txt.indexOf('old one') > 0, ar);
    const bp = String(t1.backup || '').replace(/\*$/, '');
    const bj = JSON.parse(((await as('artur', '/api/get?key=' + encodeURIComponent(bp + 'ld_journal'))).json || {}).value || '[]');
    const bt = ((await as('artur', '/api/get?key=' + encodeURIComponent(bp + 'team:tasks'))).json || {}).value;
    ok('a full backup was taken first, with the journal as it was', bp && bj.length === 5 && String(bt).indexOf('zzzz') > 0, t1);
    const t2 = (await as('artur', '/api/archive/tidy', { method: 'POST', body: '{}' })).json || {};
    const ar2 = JSON.parse(((await as('artur', '/api/get?key=archive:ld_journal')).json || {}).value || '[]');
    ok('running it again duplicates nothing', t2.journal.moved === 0 && ar2.length === 2, t2);
    const man5 = (await as('artur', '/api/manifest')).json || {};
    const ex2 = (await as('artur', '/api/export')).json || {};
    ok('the archive is not downloaded on open', !Object.keys(man5).some(k => k.indexOf('archive:') === 0), Object.keys(man5));
    ok('the export keeps the archive but not a copy of every backup', ex2.data['archive:ld_journal'] && !Object.keys(ex2.data).some(k => k.indexOf('archive:backup:') === 0));
    const list = (await as('artur', '/api/archive')).json || {};
    ok('the archive can be listed', Array.isArray(list.kept) && list.kept.some(r => r.key === 'team:tasks'), list);
    const samJ = (await as('sam', '/api/get?key=archive:ld_journal')).json || {};
    ok('and it is nobody else\'s', !samJ.value);
  } finally {
    srv.kill(); upstash.close();
    if (fail && err) console.log(err.slice(-1500));
    console.log('\n' + pass + ' passing, ' + fail + ' failing');
    process.exit(fail ? 1 : 0);
  }
})();
