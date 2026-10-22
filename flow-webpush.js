/* Web Push, for everything that is not the iPhone app.
 *
 * Android phones and tablets (the Play Store app is this website in a Trusted
 * Web Activity), Chromebooks, and any desktop browser that has installed The
 * Flow all receive notifications the same way: the browser hands the page a
 * "subscription" (an https endpoint at the browser vendor's push service and
 * two keys), the page gives it to this server, and the server POSTs an
 * encrypted message to that endpoint. The browser wakes the service worker,
 * which shows it — with the app closed.
 *
 * Dependency-free for the same reason flow-push.js is: two standards
 * (RFC 8291 message encryption, RFC 8292 VAPID) and a handful of node:crypto
 * calls, versus a library sitting next to the key that can reach every device.
 *
 * The VAPID key
 * -------------
 * It identifies this server to the push services. It is not a secret anyone
 * needs to paste anywhere: if VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set
 * they are used, otherwise one is made on first use and kept in the raw store
 * under `__push:vapid` (never in a person's namespace, so /api/all can never
 * hand it to a browser). It must not change once people have subscribed —
 * subscriptions are bound to it — which is why it is stored, not regenerated.
 */

const crypto = require('node:crypto');
const https = require('node:https');

const VAPID_KEY = '__push:vapid';
const SUBJECT = process.env.VAPID_SUBJECT || 'https://theflow.today';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

/* ── Which endpoints we will POST to ─────────────────────────────────────
   The endpoint comes from a browser, so it is input. Sending to whatever URL
   a client registers would make this server an open relay for requests to
   anywhere — so only the real push services are accepted. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Android, Edge on Android
  /^android\.googleapis\.com$/,             // older Chrome
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,                // Safari on macOS / iOS home-screen apps
  /^[a-z0-9-]+\.notify\.windows\.com$/      // Edge on Windows
];
function endpointOk(endpoint) {
  let u;
  try { u = new URL(String(endpoint || '')); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.port) return false;
  return PUSH_HOSTS.some((re) => re.test(u.hostname));
}

function subscriptionOk(s) {
  if (!s || typeof s !== 'object' || !endpointOk(s.endpoint)) return false;
  const k = s.keys || {};
  const pub = unb64url(k.p256dh), auth = unb64url(k.auth);
  return pub.length === 65 && pub[0] === 4 && auth.length === 16;
}

/* ── The server's key ─────────────────────────────────────────────────── */

let vapid = null; // { publicKey: Buffer(65), privateKey: KeyObject, publicB64 }

function fromJwk(jwk) {
  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), unb64url(jwk.x), unb64url(jwk.y)]);
  return { privateKey, publicKey, publicB64: b64url(publicKey) };
}

function fromEnv() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  const p = unb64url(pub);
  if (p.length !== 65) return null;
  return fromJwk({ kty: 'EC', crv: 'P-256', x: b64url(p.slice(1, 33)), y: b64url(p.slice(33)), d: priv });
}

async function ensureKeys(raw) {
  if (vapid) return vapid;
  try { vapid = fromEnv(); } catch (e) { vapid = null; console.error('[flow/webpush] VAPID_* env is not a usable P-256 key: ' + e.message); }
  if (vapid) return vapid;
  let stored = null;
  try {
    const v = await raw.get(VAPID_KEY);
    stored = typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { stored = null; }
  if (!stored || !stored.d) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    stored = privateKey.export({ format: 'jwk' });
    await raw.set(VAPID_KEY, JSON.stringify(stored));
    /* Two instances starting together could both generate one. Read back so
       everyone settles on whichever landed last-but-stored. */
    try {
      const again = await raw.get(VAPID_KEY);
      const parsed = typeof again === 'string' ? JSON.parse(again) : again;
      if (parsed && parsed.d) stored = parsed;
    } catch (e) {}
  }
  vapid = fromJwk(stored);
  return vapid;
}

function ready() { return !!vapid; }

/* ── VAPID (RFC 8292) ─────────────────────────────────────────────────── */
const jwtCache = new Map(); // audience -> { token, exp }
function vapidHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  let c = jwtCache.get(aud);
  if (!c || c.exp - now < 3600) {
    const exp = now + 12 * 3600;
    const signing = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' +
      b64url(JSON.stringify({ aud, exp, sub: SUBJECT }));
    const sig = crypto.sign('sha256', Buffer.from(signing), { key: vapid.privateKey, dsaEncoding: 'ieee-p1363' });
    c = { token: signing + '.' + b64url(sig), exp };
    jwtCache.set(aud, c);
  }
  return 'vapid t=' + c.token + ', k=' + vapid.publicB64;
}

/* ── Message encryption (RFC 8291, aes128gcm) ─────────────────────────── */
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }

function encrypt(sub, plaintext, salt, ecdh) {
  const uaPublic = unb64url(sub.keys.p256dh);
  const authSecret = unb64url(sub.keys.auth);
  if (!ecdh) { ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); }
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  salt = salt || crypto.randomBytes(16);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).slice(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).slice(0, 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/* ── The one request ─────────────────────────────────────────────────── */
function httpsPost(endpoint, headers, body) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.request(endpoint, { method: 'POST', headers: Object.assign({ 'content-length': body.length }, headers), timeout: 10000 }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode || 0 }));
      });
    } catch (e) { return resolve({ status: 0 }); }
    req.on('error', () => resolve({ status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
    req.end(body);
  });
}
let sender = httpsPost;

/* Sends one notification to one subscription. `gone` means the push service
   says the subscription no longer exists — the only correct response is to
   forget it. */
async function sendOne(sub, note) {
  if (!vapid || !subscriptionOk(sub)) return { ok: false, gone: !subscriptionOk(sub) };
  const payload = JSON.stringify({
    title: note.title || 'The Flow',
    body: note.body || '',
    tag: note.thread || 'flow',
    data: note.data || {}
  });
  const r = await sender(sub.endpoint, {
    'content-type': 'application/octet-stream',
    'content-encoding': 'aes128gcm',
    ttl: '3600',
    urgency: 'high',
    authorization: vapidHeader(sub.endpoint)
  }, encrypt(sub, payload));
  if (r.status >= 200 && r.status < 300) return { ok: true };
  if (r.status === 404 || r.status === 410) return { ok: false, gone: true, status: r.status };
  return { ok: false, status: r.status };
}

module.exports = {
  ensureKeys, ready, sendOne, subscriptionOk, endpointOk,
  publicKey: () => (vapid ? vapid.publicB64 : null),
  _internals: {
    encrypt, b64url, unb64url, vapidHeader, VAPID_KEY,
    setSender(fn) { sender = fn || httpsPost; },
    reset() { vapid = null; jwtCache.clear(); }
  }
};
