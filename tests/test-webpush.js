/* Web Push: Android (the Play Store app), Chromebooks, desktop browsers.
 *
 * Two halves. In-process: the encryption is decrypted back the way a browser
 * would, the VAPID token is verified with the public key the browser is
 * given, and sending is exercised with the network replaced. Against a real
 * server: who may register what, that a subscription never leaks into
 * /api/all, and that the server's key does not change under people.
 */
const keepCookies = require('./cookie-jar.js');
const http = require('http');
const crypto = require('crypto');

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
const post = (who, p, body) => as(who, p, { method: 'POST', body: JSON.stringify(body || {}) });

/* A browser, as far as the server can tell: a P-256 key pair and an auth secret. */
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function browser(endpoint) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { endpoint, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } } };
}
/* What the browser does on receipt (RFC 8291), written independently. */
function decrypt(b, body) {
  const salt = body.slice(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const hk = (salt2, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt2, info, len));
  const shared = b.ecdh.computeSecret(asPublic);
  const ikm = hk(b.auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), b.ecdh.getPublicKey(), asPublic]), 32);
  const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.slice(-16));
  const pt = Buffer.concat([d.update(ct.slice(0, -16)), d.final()]);
  let end = pt.length - 1; while (end >= 0 && pt[end] === 0) end--;
  return { rs, delim: pt[end], text: pt.slice(0, end).toString() };
}

function memStore() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); } };
}

(async () => {
  console.log('\n— in process: the message a browser receives —');
  delete process.env.APNS_KEY_ID; delete process.env.APNS_TEAM_ID; delete process.env.APNS_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  const push = require('../flow-push.js');
  const wp = push.webpush;
  const raw = memStore();

  ok('Apple is not configured here, so APNs is not ready', !push.ready());
  ok('and nothing can send before the key exists', !push.canSend());
  await push.init(raw);
  ok('after start-up the browsers can be reached anyway', push.canSend() && wp.ready());
  const pub1 = wp.publicKey();
  ok('the public key is a 65-byte uncompressed P-256 point', unb64(pub1).length === 65 && unb64(pub1)[0] === 4);
  ok('the private half is kept in the raw store, out of any namespace',
     !!raw.m.get('__push:vapid') && /"d"/.test(raw.m.get('__push:vapid')));
  wp._internals.reset();
  await wp.ensureKeys(raw);
  ok('a restart reads the same key rather than making a new one', wp.publicKey() === pub1);

  const A = browser('https://fcm.googleapis.com/fcm/send/abc123');
  const body = wp._internals.encrypt(A.sub, JSON.stringify({ title: 'Gym', body: 'It is 07:00.' }));
  let dec = null;
  try { dec = decrypt(A, body); } catch (e) { dec = { error: e.message }; }
  ok('a browser can decrypt what is sent', dec && dec.text && JSON.parse(dec.text).title === 'Gym', dec);
  ok('it is one final record (delimiter 2, record size 4096)', dec && dec.delim === 2 && dec.rs === 4096, dec);
  const Other = browser('https://fcm.googleapis.com/fcm/send/zzz');
  let wrong = false; try { decrypt(Other, body); } catch (e) { wrong = true; }
  ok('and a different browser cannot', wrong);

  console.log('\n— in process: the server identifies itself correctly —');
  const hdr = wp._internals.vapidHeader(A.sub.endpoint);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(hdr);
  ok('the header is "vapid t=…, k=…"', !!m, hdr.slice(0, 40));
  const [h64, c64, s64] = m[1].split('.');
  const claims = JSON.parse(unb64(c64).toString());
  ok('its audience is the push service origin, not the full endpoint', claims.aud === 'https://fcm.googleapis.com', claims);
  ok('it expires within a day, as the spec requires', claims.exp - Date.now() / 1000 <= 24 * 3600 && claims.exp > Date.now() / 1000);
  ok('it names who to contact', /^(mailto:|https:)/.test(claims.sub));
  const pk = unb64(m[2]);
  const verifyKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(pk.slice(1, 33)), y: b64url(pk.slice(33)) }, format: 'jwk' });
  ok('its signature verifies with the key browsers subscribe with',
     m[2] === pub1 && crypto.verify('sha256', Buffer.from(h64 + '.' + c64), { key: verifyKey, dsaEncoding: 'ieee-p1363' }, unb64(s64)));

  console.log('\n— in process: what gets accepted —');
  ok('a Chrome/Android subscription is accepted', wp.subscriptionOk(A.sub));
  ok('Firefox, Safari and Edge push services too',
     ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QAbc', 'https://wns2-db5p.notify.windows.com/w/?token=x']
       .every((e) => wp.endpointOk(e)));
  /* The endpoint is input from a browser; posting to wherever it says would
     make this server a relay for requests to anywhere. */
  ok('any other host is refused', !wp.endpointOk('https://evil.example.com/fcm.googleapis.com'));
  ok('so is a look-alike', !wp.endpointOk('https://fcm.googleapis.com.evil.example/x'));
  ok('plain http, odd ports and internal addresses are refused',
     !wp.endpointOk('http://fcm.googleapis.com/x') && !wp.endpointOk('https://fcm.googleapis.com:8443/x')
     && !wp.endpointOk('https://127.0.0.1/x') && !wp.endpointOk('https://localhost/x'));
  ok('keys of the wrong size are refused',
     !wp.subscriptionOk({ endpoint: A.sub.endpoint, keys: { p256dh: 'AAAA', auth: A.sub.keys.auth } }));

  console.log('\n— in process: sending, without Apple —');
  const B = browser('https://updates.push.services.mozilla.com/wpush/v2/bbb');
  const uid = 'u1';
  await raw.set('__push:dev:' + uid, JSON.stringify([
    Object.assign({ kind: 'web', platform: 'android' }, A.sub),
    Object.assign({ kind: 'web', platform: 'web' }, B.sub),
    { token: 'c'.repeat(64), env: 'production', platform: 'ios' }
  ]));
  const seen = [];
  wp._internals.setSender(async (endpoint, headers, b) => {
    seen.push({ endpoint, headers, body: b });
    return { status: endpoint === B.sub.endpoint ? 410 : 201 };
  });
  const quiet = console.error; console.error = () => {};
  let r;
  try { r = await push.sendToUser(raw, uid, { title: 'Write', body: 'Chapter two', thread: 'rocks', data: { rock: '7' } }); }
  finally { console.error = quiet; }
  ok('it reaches the Android device even with no APNs key', r.ok && r.sent === 1, r);
  ok('both browsers were tried', seen.length === 2, seen.map((s) => s.endpoint));
  const toA = seen.find((s) => s.endpoint === A.sub.endpoint);
  ok('the request carries the aes128gcm encoding, a TTL and the VAPID header',
     toA && toA.headers['content-encoding'] === 'aes128gcm' && toA.headers.ttl && /^vapid t=/.test(toA.headers.authorization));
  const got = toA && JSON.parse(decrypt(A, toA.body).text);
  ok('and the phone reads the rock, its note, and which rock it was',
     got && got.title === 'Write' && got.body === 'Chapter two' && got.tag === 'rocks' && got.data.rock === '7', got);
  const left = JSON.parse(raw.m.get('__push:dev:' + uid));
  ok('a subscription the push service calls gone (410) is forgotten', !left.some((d) => d.endpoint === B.sub.endpoint), left.length);
  ok('the others are kept, the iPhone included', left.length === 2 && left.some((d) => d.token));

  seen.length = 0;
  wp._internals.setSender(async () => ({ status: 500 }));
  console.error = () => {};
  try { r = await push.sendToUser(raw, uid, { title: 'x' }); } finally { console.error = quiet; }
  ok('a push service having a bad minute is a failure, not a deletion',
     !r.ok && JSON.parse(raw.m.get('__push:dev:' + uid)).length === 2, r);
  wp._internals.setSender(null);

  console.log('\n— against the server —');
  ok('the key needs a session', (await rq('/api/push/vapid')).status === 401);
  const su = await post('artur', '/api/auth/signup', { email: 'artur.abacilar@abko.com.tr', name: 'artur', password: 'a properly long password', invite: 'letmein' });
  const su2 = await post('sam', '/api/auth/signup', { email: 'sam@example.com', name: 'sam', password: 'a properly long password', invite: 'letmein' });
  ok('two accounts', su.status === 200 && su2.status === 200, [su.status, su2.status]);

  const k1 = await as('artur', '/api/push/vapid');
  const k2 = await as('sam', '/api/push/vapid');
  ok('a signed-in browser gets the public key', k1.status === 200 && unb64(k1.json.publicKey).length === 65, k1.json);
  ok('everyone gets the same one', k1.json.publicKey === k2.json.publicKey);
  ok('and only the public half', !/"d"|private/i.test(k1.text));

  const st0 = await as('artur', '/api/push/status');
  ok('status says browsers can be reached', st0.json && st0.json.web === true, st0.json);

  const P = browser('https://fcm.googleapis.com/fcm/send/phone-of-artur');
  r = await post('artur', '/api/push/register', { subscription: P.sub, platform: 'android' });
  ok('an Android subscription registers', r.status === 200 && r.json.devices === 1, r.json);
  r = await post('artur', '/api/push/register', { subscription: P.sub, platform: 'android' });
  ok('registering it again on the next launch is still one device', r.json.devices === 1, r.json);
  r = await post('artur', '/api/push/register', { subscription: { endpoint: 'https://evil.example.com/x', keys: P.sub.keys } });
  ok('a subscription pointing anywhere else is refused', r.status === 400, r.status);
  r = await post('artur', '/api/push/register', { subscription: { endpoint: P.sub.endpoint } });
  ok('one with no keys is refused', r.status === 400, r.status);

  const st = await as('artur', '/api/push/status');
  ok('status counts it, as android', st.json.devices === 1 && st.json.platforms[0] === 'android', st.json);
  ok("the other account does not see it", (await as('sam', '/api/push/status')).json.devices === 0);

  const all = await as('artur', '/api/all');
  ok('the subscription never appears in /api/all',
     all.status === 200 && all.text.indexOf('phone-of-artur') < 0 && all.text.indexOf(P.sub.keys.auth) < 0, all.status);

  r = await post('sam', '/api/push/unregister', { endpoint: P.sub.endpoint });
  ok("another account cannot remove it", (await as('artur', '/api/push/status')).json.devices === 1);
  r = await post('artur', '/api/push/unregister', { endpoint: P.sub.endpoint });
  ok('its owner can', r.status === 200 && r.json.devices === 0, r.json);

  console.log('\n— the service worker shows what arrives —');
  /* The replica does not serve the worker; the real server writes it inline. */
  const srcAll = require('fs').readFileSync(require('path').join(__dirname, '..', 'life-os-server.js'), 'utf8');
  const sw = srcAll.slice(srcAll.indexOf('const SW = `'), srcAll.indexOf('`;', srcAll.indexOf('const SW = `')));
  ok('it listens for push', /addEventListener\('push'/.test(sw));
  ok('and always shows a notification for one', /showNotification\(/.test(sw));
  ok('tapping it opens or focuses the app', /addEventListener\('notificationclick'/.test(sw) && /openWindow\('\/'\)/.test(sw));

  console.log('\n— deleting the account takes the devices with it —');
  const authSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-auth.js'), 'utf8');
  ok('account deletion clears the device list and the sent-reminder record',
     /'__push:dev:' \+ uid/.test(authSrc) && /'__push:sent:' \+ uid/.test(authSrc));
  const srvSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'life-os-server.js'), 'utf8');
  ok('the public page that says how to delete an account is served before the sign-in gate',
     srvSrc.indexOf("p === '/delete-account'") > 0 && srvSrc.indexOf("p === '/delete-account'") < srvSrc.indexOf("p === '/support'") + 400);

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
