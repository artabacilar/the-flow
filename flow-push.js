/* Push, for the iPhone app.
 *
 * What this is
 * ------------
 * The device asks iOS for permission, iOS hands it a token, the app gives the
 * token to this server, and this server can then ask Apple to show something
 * on that device whether or not the app is running. That last part is the
 * whole point and the only reason this exists: a reminder that needs the app
 * open is not a reminder.
 *
 * It is deliberately dependency-free. APNs is an HTTP/2 request with a signed
 * header, Node has had http2 since 8 and ES256 signing since forever, and a
 * push library would be a supply-chain dependency sitting next to the one
 * credential that can send notifications to every one of these devices.
 *
 * Where the tokens live, and why not with everything else
 * -------------------------------------------------------
 * In the RAW store, under `__push:dev:<uid>`, never in the person's own
 * namespace. Everything under `ld_u<id>:` is handed to the client wholesale
 * by /api/all — that is how the app hydrates. A device token in there would
 * be mirrored into every browser that account ever signs in on, and a device
 * token is not data about the person, it is the means of reaching them. Same
 * reasoning as the WHOOP refresh tokens, same place.
 */

const http2 = require('node:http2');
const crypto = require('node:crypto');

/* What the person is told when it cannot work. The server log gets the real
   reason; the screen gets a sentence. Naming an environment variable on
   somebody's phone helps nobody and tells a stranger how the thing is
   wired. */
const PUSH_OFF = 'Notifications are not switched on for this app yet.';
const PUSH_FAILED = 'That notification could not be sent just now. Try again shortly.';

const KEY_ID = process.env.APNS_KEY_ID || '';
const TEAM_ID = process.env.APNS_TEAM_ID || '';
const PRIVATE_KEY = (process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'com.abko.theflow';
/* Sandbox tokens and production tokens are different namespaces at Apple, and
   sending one to the other host answers BadDeviceToken. A TestFlight or Xcode
   build is sandbox; the App Store build is production. The device says which
   it is at registration, so one server serves both. */
const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com'
};

function configured() { return !!(KEY_ID && TEAM_ID && PRIVATE_KEY); }

function logWhy(where, detail) {
  console.error('[flow/push] ' + where + ': ' + detail);
}

/* ── The authorisation token ──────────────────────────────────────────────
   Apple rejects a token older than one hour and rate-limits minting them, so
   it is made once and kept. Fifty minutes leaves room for a slow clock on
   either side without ever presenting a stale one. */
let cachedJwt = null, cachedAt = 0;
const JWT_TTL_MS = 50 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function authToken() {
  if (cachedJwt && Date.now() - cachedAt < JWT_TTL_MS) return cachedJwt;
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const signing = header + '.' + claims;
  /* ieee-p1363 is the r||s pair JOSE wants. The default is DER, which APNs
     rejects with a 403 that says only "InvalidProviderToken" — an hour of
     looking in the wrong place if you do not know. */
  const sig = crypto.createSign('SHA256').update(signing).sign({
    key: PRIVATE_KEY, dsaEncoding: 'ieee-p1363'
  });
  cachedJwt = signing + '.' + b64url(sig);
  cachedAt = Date.now();
  return cachedJwt;
}

/* ── The one request ──────────────────────────────────────────────────────
   Replaceable, because every test of everything above would otherwise need
   a real key and a real device. */
async function apnsPost(host, token, payload, headers) {
  return new Promise((resolve) => {
    let client;
    try { client = http2.connect(host); } catch (e) { return resolve({ status: 0, reason: 'connect' }); }
    const done = (r) => { try { client.close(); } catch (e) {} resolve(r); };
    client.on('error', () => done({ status: 0, reason: 'connect' }));
    const body = Buffer.from(JSON.stringify(payload));
    const req = client.request(Object.assign({
      ':method': 'POST',
      ':path': '/3/device/' + token,
      'content-type': 'application/json',
      'content-length': body.length
    }, headers));
    let status = 0, text = '';
    req.on('response', (h) => { status = Number(h[':status']) || 0; });
    req.on('data', (c) => { text += c; });
    req.on('error', () => done({ status: 0, reason: 'stream' }));
    req.on('end', () => {
      let reason = '';
      try { reason = (JSON.parse(text || '{}').reason) || ''; } catch (e) {}
      done({ status, reason });
    });
    req.setTimeout(10000, () => { try { req.close(); } catch (e) {} done({ status: 0, reason: 'timeout' }); });
    req.end(body);
  });
}
let sender = apnsPost;

/* ── Which devices belong to whom ─────────────────────────────────────── */

const devKey = (uid) => '__push:dev:' + uid;

async function readDevices(raw, uid) {
  try {
    const v = await raw.get(devKey(uid));
    const list = typeof v === 'string' ? JSON.parse(v) : (v || []);
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
async function writeDevices(raw, uid, list) {
  await raw.set(devKey(uid), JSON.stringify(list));
}

/* ── Sending ──────────────────────────────────────────────────────────────
   Returns what happened per device rather than a bare boolean, because the
   interesting failure is "Apple says this device is gone", and the only
   correct response to it is to stop keeping the token. */
async function sendToUser(raw, uid, note) {
  if (!configured()) return { ok: false, error: PUSH_OFF, sent: 0 };
  const devices = await readDevices(raw, uid);
  if (!devices.length) return { ok: false, error: 'No device is registered for notifications.', sent: 0 };

  const payload = {
    aps: {
      alert: { title: note.title || 'The Flow', body: note.body || '' },
      sound: 'default',
      'thread-id': note.thread || 'flow'
    }
  };
  if (note.data && typeof note.data === 'object') Object.assign(payload, { flow: note.data });

  let jwt;
  try { jwt = authToken(); }
  catch (e) { logWhy('sign', 'APNS_PRIVATE_KEY is not a usable ES256 key — ' + e.message); return { ok: false, error: PUSH_OFF, sent: 0 }; }

  let sent = 0;
  const dead = [];
  for (const d of devices) {
    const host = HOSTS[d.env === 'sandbox' ? 'sandbox' : 'production'];
    const r = await sender(host, d.token, payload, {
      authorization: 'bearer ' + jwt,
      'apns-topic': BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600)
    });
    if (r.status === 200) { sent++; continue; }
    /* 410 is "this token is dead" and BadDeviceToken is "it never was".
       Keeping either means pushing into the void forever. */
    if (r.status === 410 || r.reason === 'Unregistered' || r.reason === 'BadDeviceToken') {
      dead.push(d.token);
      logWhy('send', 'dropping a device Apple no longer knows (' + (r.reason || r.status) + ')');
      continue;
    }
    logWhy('send', 'APNs answered ' + r.status + ' ' + (r.reason || ''));
  }
  if (dead.length) {
    await writeDevices(raw, uid, devices.filter((d) => dead.indexOf(d.token) < 0));
  }
  if (!sent) return { ok: false, error: PUSH_FAILED, sent: 0, dropped: dead.length };
  return { ok: true, sent, dropped: dead.length };
}

/* ── Routes ───────────────────────────────────────────────────────────── */

async function handle(req, res, ctx) {
  const { path: p, uid, raw, json, readBody } = ctx;
  if (!uid) { json(res, 401, { error: 'Sign in first.' }); return true; }

  if (p === '/api/push/status' && req.method === 'GET') {
    const devices = await readDevices(raw, uid);
    json(res, 200, {
      /* Deliberately not "why". A person cannot act on a missing server
         credential, and the log already says it plainly. */
      available: configured(),
      devices: devices.length,
      platforms: devices.map((d) => d.platform || 'ios')
    });
    return true;
  }

  if (p === '/api/push/register' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    const token = String(b.token || '').trim();
    /* An APNs token is hex. Anything else is a bug upstream or somebody
       poking, and storing it would only produce failed sends later. */
    if (!/^[0-9a-fA-F]{64,200}$/.test(token)) {
      json(res, 400, { error: 'That does not look like a device token.' });
      return true;
    }
    const env = b.env === 'sandbox' ? 'sandbox' : 'production';
    const platform = String(b.platform || 'ios').slice(0, 16);
    const devices = await readDevices(raw, uid);
    const existing = devices.find((d) => d.token === token);
    if (existing) {
      /* Re-registering is the normal case — iOS hands the app its token on
         every launch. Refresh what might have changed and nothing else. */
      existing.env = env; existing.platform = platform; existing.seen = new Date().toISOString();
    } else {
      devices.push({ token, env, platform, added: new Date().toISOString(), seen: new Date().toISOString() });
    }
    /* One person, a handful of devices. A cap stops a looping client turning
       this into an unbounded list. */
    const kept = devices.slice(-10);
    await writeDevices(raw, uid, kept);
    json(res, 200, { ok: true, devices: kept.length, available: configured() });
    return true;
  }

  if (p === '/api/push/unregister' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    const token = String(b.token || '').trim();
    const devices = await readDevices(raw, uid);
    const left = token ? devices.filter((d) => d.token !== token) : [];
    await writeDevices(raw, uid, left);
    json(res, 200, { ok: true, devices: left.length });
    return true;
  }

  if (p === '/api/push/test' && req.method === 'POST') {
    const r = await sendToUser(raw, uid, {
      title: 'The Flow',
      body: 'Notifications are working. This is what a reminder will look like.'
    });
    json(res, r.ok ? 200 : 502, r);
    return true;
  }

  return false;
}

module.exports = {
  handle,
  sendToUser,
  configured,
  _internals: {
    PUSH_OFF, PUSH_FAILED,
    readDevices, writeDevices, devKey, authToken,
    setSender(fn) { sender = fn || apnsPost; },
    resetJwt() { cachedJwt = null; cachedAt = 0; }
  }
};
