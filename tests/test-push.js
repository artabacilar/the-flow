/* A device token is the means of reaching somebody, not a fact about them.
 *
 * The app hydrates by asking for everything in its own namespace — that is
 * what /api/all is for, and it is handed verbatim to every browser the
 * account signs in on. So the question this file exists to answer is not
 * "does the notification send". It is: can a device token ever end up
 * somewhere it is handed out, and can one account's token ever be reached by
 * another. Those are the two ways this goes badly wrong, and neither would
 * announce itself.
 *
 * The APNs request is replaced throughout. Testing the real one would need a
 * real signing key and a real phone, which means in practice it would not be
 * tested at all.
 */
const keepCookies = require('./cookie-jar.js');
const http = require('http');
const path = require('path');

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
    res.on('data', (c) => b += c);
    res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json: j, text: b, headers: res.headers }); });
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
  keepCookies(jar, who, r);
  return r;
}
const signUp = (who, email, invite) => as(who, '/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email, name: who, password: 'a properly long password', invite })
});
const post = (who, p, body) => as(who, p, { method: 'POST', body: JSON.stringify(body || {}) });

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

(async () => {
  console.log('\n— it is shut to anyone not signed in —');
  ok('status needs a session', (await rq('/api/push/status')).status === 401);
  ok('register needs a session',
    (await rq('/api/push/register', { method: 'POST', body: JSON.stringify({ token: TOKEN_A }) })).status === 401);
  ok('so does a test send',
    (await rq('/api/push/test', { method: 'POST', body: '{}' })).status === 401);

  const su1 = await signUp('artur', 'artur.abacilar@abko.com.tr', 'letmein');
  const su2 = await signUp('sam', 'sam@example.com', 'letmein');
  ok('both accounts exist and are signed in',
    su1.status === 200 && su2.status === 200 && (await as('artur', '/api/auth/me')).json.ok,
    { a: su1.status, b: su2.status });

  console.log('\n— a device registers, and re-registering is not a second device —');
  let r = await post('artur', '/api/push/register', { token: TOKEN_A, env: 'sandbox' });
  ok('the first registration is accepted', r.status === 200 && r.json.ok, r.json);
  ok('and it counts one device', r.json.devices === 1, r.json);
  /* iOS hands the app its token on every single launch. If each one appended,
     a phone used daily would be in the list a hundred times by Christmas and
     every notification would be sent to it a hundred times. */
  r = await post('artur', '/api/push/register', { token: TOKEN_A, env: 'production' });
  ok('registering the same token again still counts one', r.json.devices === 1, r.json);
  r = await as('artur', '/api/push/status');
  ok('status agrees', r.json.devices === 1, r.json);

  console.log('\n— and something that is not a device token is refused —');
  for (const bad of ['', 'not-a-token', 'zz' + 'a'.repeat(62), 'a'.repeat(20)]) {
    const x = await post('artur', '/api/push/register', { token: bad });
    ok('refuses ' + JSON.stringify(bad.slice(0, 18)), x.status === 400, x.json);
  }
  ok('and none of that was stored', (await as('artur', '/api/push/status')).json.devices === 1);

  console.log('\n— the token is not in anything the client is handed —');
  /* This is the check the whole file is for. */
  const all = await as('artur', '/api/all');
  ok('/api/all does not contain it', all.text.indexOf(TOKEN_A) < 0,
     all.text.slice(0, 160));
  const man = await as('artur', '/api/manifest');
  ok('the manifest has no section for it',
     Object.keys(man.json || {}).every((k) => k.indexOf('push') < 0), Object.keys(man.json || {}));
  const exp = await as('artur', '/api/export');
  ok('a backup export does not carry it', exp.text.indexOf(TOKEN_A) < 0);

  console.log('\n— and it is not reachable from another account —');
  await post('sam', '/api/push/register', { token: TOKEN_B });
  const samAll = await as('sam', '/api/all');
  ok("Sam's own data does not contain Artur's token", samAll.text.indexOf(TOKEN_A) < 0);
  ok('each account sees only its own count',
     (await as('sam', '/api/push/status')).json.devices === 1 &&
     (await as('artur', '/api/push/status')).json.devices === 1);
  /* Unregistering is scoped too — passing somebody else's token must not
     reach into their list. */
  await post('sam', '/api/push/unregister', { token: TOKEN_A });
  ok("unregistering another account's token leaves it alone",
     (await as('artur', '/api/push/status')).json.devices === 1);

  console.log('\n— what it says when it cannot send —');
  const t = await post('artur', '/api/push/test', {});
  const msg = (t.json && t.json.error) || '';
  /* Without credentials on this test server it cannot send, and that is the
     interesting case: what does the person on the phone read? */
  ok('it fails rather than pretending', t.status !== 200, t.json);
  ok('and says something a person can understand', /notification/i.test(msg), t.json);
  ok('without naming an env var, a host or a key',
     !/APNS|apple\.com|\.p8|private key/i.test(msg), t.json);

  console.log('\n— the module itself: signing, and dead devices —');
  const push = require(path.join(__dirname, '..', 'flow-push.js'));
  const I = push._internals;

  /* A fake raw store, so the sender can be exercised without the server. */
  const mem = {};
  const raw = { get: async (k) => (k in mem ? mem[k] : null), set: async (k, v) => { mem[k] = v; } };
  await I.writeDevices(raw, 'u1', [
    { token: TOKEN_A, env: 'production' },
    { token: TOKEN_B, env: 'sandbox' }
  ]);

  const seen = [];
  I.setSender(async (host, token, payload, headers) => {
    seen.push({ host, token, payload, headers });
    /* Apple has forgotten the second one. */
    return token === TOKEN_B ? { status: 410, reason: 'Unregistered' } : { status: 200 };
  });

  /* Credentials only exist inside this block. */
  process.env.APNS_KEY_ID = 'TESTKEYID';
  process.env.APNS_TEAM_ID = 'TESTTEAMID';
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.APNS_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  delete require.cache[require.resolve(path.join(__dirname, '..', 'flow-push.js'))];
  const push2 = require(path.join(__dirname, '..', 'flow-push.js'));
  const I2 = push2._internals;
  I2.setSender(async (host, token, payload, headers) => {
    seen.push({ host, token, payload, headers });
    return token === TOKEN_B ? { status: 410, reason: 'Unregistered' } : { status: 200 };
  });

  ok('with credentials present it reports itself available', push2.configured());
  ok('and a real P-256 key is usable, not just present', push2.ready() === true);

  const out = await push2.sendToUser(raw, 'u1', { title: 'Rock', body: 'Two hours on the plan' });
  ok('it sent to the live device', out.ok && out.sent === 1, out);
  ok('and dropped the one Apple no longer knows', out.dropped === 1, out);
  ok('so the dead token is gone for good',
     (await I2.readDevices(raw, 'u1')).map((d) => d.token).indexOf(TOKEN_B) < 0,
     await I2.readDevices(raw, 'u1'));

  console.log('\n— each device goes to the host its token belongs to —');
  /* A sandbox token sent to the production host answers BadDeviceToken, and
     the mistake looks exactly like a broken key. */
  const prod = seen.find((s) => s.token === TOKEN_A);
  const sand = seen.find((s) => s.token === TOKEN_B);
  ok('production token → production host', /\/\/api\.push\.apple\.com/.test(prod.host), prod.host);
  ok('sandbox token → sandbox host', /sandbox/.test(sand.host), sand.host);

  console.log('\n— and the request is shaped the way APNs requires —');
  ok('the topic is the bundle id', prod.headers['apns-topic'] === 'com.abko.theflow', prod.headers['apns-topic']);
  ok('it is declared an alert', prod.headers['apns-push-type'] === 'alert');
  ok('the alert carries a title and a body',
     prod.payload.aps.alert.title === 'Rock' && prod.payload.aps.alert.body === 'Two hours on the plan',
     prod.payload.aps.alert);
  const jwt = String(prod.headers.authorization || '').replace(/^bearer /, '');
  const parts = jwt.split('.');
  ok('the authorization is a three-part JWT', parts.length === 3, parts.length);
  const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  ok('signed ES256 with the key id', head.alg === 'ES256' && head.kid === 'TESTKEYID', head);
  ok('issued by the team', body.iss === 'TESTTEAMID' && typeof body.iat === 'number', body);
  /* DER is the Node default and APNs rejects it with a message that names
     nothing useful. r||s is 64 bytes for P-256; DER is 70-ish and variable. */
  ok('the signature is the 64-byte JOSE pair, not DER',
     Buffer.from(parts[2], 'base64url').length === 64,
     Buffer.from(parts[2], 'base64url').length);

  console.log('\n— the signing token is reused, not minted per send —');
  const before = jwt;
  await push2.sendToUser(raw, 'u1', { title: 'Again', body: 'x' });
  const after = String(seen[seen.length - 1].headers.authorization || '').replace(/^bearer /, '');
  ok('a second send presents the same token', after === before);

  console.log('\n— a key that is there but broken —');
  /* The case configured() alone cannot see: three non-empty variables, and a
     key nothing can sign with. Before ready(), the status said "available"
     here, and nobody found out until a phone never buzzed. */
  const goodPem = process.env.APNS_PRIVATE_KEY;
  const fresh = () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'flow-push.js'))];
    return require(path.join(__dirname, '..', 'flow-push.js'));
  };
  const statusOf = async (mod) => {
    let got = null;
    await mod.handle({ method: 'GET' }, {}, { path: '/api/push/status', uid: 'u1', raw,
      json: (_r, code, body) => { got = { code, body }; }, readBody: async () => '' });
    return got;
  };
  const silence = console.error; const logged = []; console.error = (m) => logged.push(String(m));
  try {
    /* A paste that lost a line out of the middle — the commonest accident. */
    const lines = goodPem.trim().split('\n');
    process.env.APNS_PRIVATE_KEY = lines.slice(0, 2).concat(lines.slice(3)).join('\n') + '\n';
    const torn = fresh();
    ok('a key missing a line is still "configured"', torn.configured() === true);
    ok('but it is not ready', torn.ready() === false);
    const st = await statusOf(torn);
    ok('so the status no longer claims it is available', st && st.body.available === false, st);
    ok('and nothing is sent with it', (await torn.sendToUser(raw, 'u1', { title: 'x' })).ok === false);
    ok('the log says why, for whoever reads it', logged.some((m) => /not a usable APNs key/.test(m)), logged);

    /* The right shape of file, the wrong kind of key — say, a TLS key. It
       signs; APNs would refuse it with a 403 that names nothing useful. */
    const { generateKeyPairSync: gk } = require('node:crypto');
    process.env.APNS_PRIVATE_KEY = gk('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const rsa = fresh();
    ok('an RSA key is refused even though it signs', rsa.ready() === false);
    /* The point of refusing it before sending: an RSA key signs without
       complaint, so without this the server would call Apple with a token
       Apple must reject — once per device, per reminder, every time. */
    const calls = [];
    rsa._internals.setSender(async (h, t) => { calls.push(t); return { status: 403, reason: 'InvalidProviderToken' }; });
    await I.writeDevices(raw, 'u9', [{ token: TOKEN_A, env: 'production' }]);
    const r9 = await rsa.sendToUser(raw, 'u9', { title: 'x' });
    ok('and Apple is never called with it', r9.ok === false && calls.length === 0, { r9, calls: calls.length });
    process.env.APNS_PRIVATE_KEY = gk('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    ok('and so is an EC key on the wrong curve', fresh().ready() === false);

    /* Pasted as one line with literal \n — what some dashboards force. */
    process.env.APNS_PRIVATE_KEY = goodPem.trim().split('\n').join('\\n');
    const oneLine = fresh();
    ok('a key pasted as one line with \\n escapes is accepted', oneLine.ready() === true);
    const st2 = await statusOf(oneLine);
    ok('and reported available', st2 && st2.body.available === true, st2);
  } finally {
    console.error = silence;
    process.env.APNS_PRIVATE_KEY = goodPem;
    fresh();
  }

  console.log('\n— and the harness actually routes what the server routes —');
  /* tests/server-replica.js is a hand-kept copy of the server's routing, not
     the server. Everything above passed against the replica; none of it says
     anything about production unless the real server has the route too. The
     first run of this file 404ed for exactly that reason, with the module
     working perfectly and the suite proving nothing. */
  const fs = require('fs');
  const real = fs.readFileSync(path.join(__dirname, '..', 'life-os-server.js'), 'utf8');
  const replica = fs.readFileSync(path.join(__dirname, 'server-replica.js'), 'utf8');
  ok('the real server routes /api/push/', /\/api\/push\//.test(real));
  ok('and so does the replica these tests ran against', /\/api\/push\//.test(replica));
  ok('both load the module the same optional way',
     /require\('\.\/flow-push'\)/.test(real) && /require\('\.\.\/flow-push'\)/.test(replica));
  /* The raw store is the whole point of where the tokens live. A replica that
     handed the namespaced store instead would be testing a different, safer
     thing than production does. */
  ok('both hand it the raw store, not the per-account one',
     /raw:\s*rawStore/.test(real) && /raw:\s*rawStore/.test(replica));

  console.log('\n— a key that the paste damaged, and a key that was never a key —');
  /* Production said, of the first real key: "DECODER routines::unsupported".
     The usual causes are a paste that collapsed the line breaks, or carried
     quotes, or lost the header — all of which still hold the whole key, so
     they are rebuilt rather than refused. What cannot be rebuilt is reported
     by shape, so the log says WHY without anybody revealing the secret. */
  {
    const good = process.env.APNS_PRIVATE_KEY;
    const body = good.split('\n').filter((l) => l && !/-----/.test(l)).join('');
    const quiet = console.error; const said = []; console.error = (m) => said.push(String(m));
    const readyWith = (v) => { process.env.APNS_PRIVATE_KEY = v; return fresh().ready(); };
    try {
      ok('line breaks turned into spaces still works', readyWith(good.replace(/\n/g, ' ')) === true);
      ok('line breaks removed altogether still works', readyWith(good.replace(/\n/g, '')) === true);
      ok('Windows line endings still work', readyWith(good.replace(/\n/g, '\r\n')) === true);
      ok('pasted with its quotes still works', readyWith('"' + good.trim() + '"') === true);
      ok('just the body, no header or footer, still works', readyWith(body) === true);

      said.length = 0;
      ok('half a key is still refused', readyWith(good.slice(0, Math.floor(good.length / 2))) === false);
      const line = said.find((m) => /not a usable APNs key/.test(m)) || '';
      ok('and the log says what shape it was', /length \d+, lines \d+, BEGIN header yes, END footer no/.test(line), line);
      said.length = 0;
      ok('a file path instead of the file is refused', readyWith('/Users/me/Downloads/AuthKey_2FGJKZ2735.p8') === false);
      ok('and the log says it looks like a path',
         said.some((m) => /looks like a file path yes/.test(m)), said);

      /* The point of describing the shape instead of the value. */
      said.length = 0;
      readyWith(good.slice(0, Math.floor(good.length / 2)));
      const chunks = []; for (let i = 0; i + 16 <= body.length; i += 8) chunks.push(body.slice(i, i + 16));
      ok('and no part of the key ever appears in the log',
         said.length > 0 && !said.some((m) => chunks.some((c) => m.includes(c))));
    } finally {
      console.error = quiet;
      process.env.APNS_PRIVATE_KEY = good;
      fresh();
    }
  }

  console.log('\n— the phone says which host its token belongs to, correctly —');
  /* TestFlight builds are signed for distribution and use PRODUCTION APNs.
     Their purchase receipt is still called "sandboxReceipt" — that is the
     in-app-purchase sandbox — and the first version read it as the push
     environment, which would have labelled every TestFlight phone sandbox
     and had every send to one refused with BadDeviceToken. */
  const fpSrc = require('fs').readFileSync(path.join(__dirname, '..', 'ios-app', 'native', 'App', 'FlowPush.swift'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('the push environment is not guessed from the purchase receipt',
     !/appStoreReceiptURL|sandboxReceipt/.test(fpSrc));
  ok('it is read from the profile the build was signed with',
     /embedded"\s*,\s*withExtension:\s*"mobileprovision"/.test(fpSrc) && /aps-environment/.test(fpSrc));
  ok('only a development profile means sandbox',
     /==\s*"development"\s*\?\s*"sandbox"\s*:\s*"production"/.test(fpSrc));
  /* No profile is the App Store and TestFlight case. Every way out of the
     parse that is not "found development" must land on production. */
  const exits = fpSrc.match(/return\s+"(sandbox|production)"/g) || [];
  ok('and no profile — App Store, TestFlight — means production', exits.length >= 2
     && exits.every((e) => /production/.test(e)), exits);
  ok('the server comment no longer says TestFlight is sandbox',
     !/TestFlight or Xcode\s+build is sandbox/.test(require('fs').readFileSync(path.join(__dirname, '..', 'flow-push.js'), 'utf8')));

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
