'use strict';
/* ==========================================================================
 * The Flow — accounts, sessions and per-user data isolation
 * --------------------------------------------------------------------------
 * Drop this file next to life-os-server.js and make three edits there:
 *
 *   1. near the top, with the other requires:
 *        const flowAuth = require('./flow-auth');
 *
 *   2. immediately AFTER the block that assigns `store`:
 *        store = flowAuth.protect(store);
 *
 *   3. as the FIRST line inside the request handler's `try {`:
 *        if (await flowAuth.gate(req, res)) return;
 *
 * That is the whole integration. Every existing route keeps calling
 * store.get / store.set / store.all exactly as before; the protected store
 * silently scopes those calls to whoever is signed in, so no route has to
 * learn about users.
 *
 * Design notes
 *  · Passwords: PBKDF2-SHA512, 210k iterations, 16-byte random salt, compared
 *    with timingSafeEqual. No dependencies — node's crypto only.
 *  · Sessions: 32 random bytes, HttpOnly + SameSite=Lax, Secure in production,
 *    stored server-side so logging out genuinely revokes them.
 *  · Isolation: every key is written as  u:<uid>:<key>. all() lists only the
 *    signed-in user's keys and strips the prefix, so the client is unchanged.
 *  · Migration: the first account created (or FLOW_OWNER_EMAIL) adopts the
 *    existing un-namespaced keys, so today's data becomes that account's data.
 * ========================================================================== */

const crypto = require('crypto');

const ITER = 210000, KEYLEN = 32, DIGEST = 'sha512';
const SESSION_DAYS = 60;
const PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
const INVITE = process.env.FLOW_INVITE_CODE || '';
const OWNER_EMAIL = (process.env.FLOW_OWNER_EMAIL || '').trim().toLowerCase();

const USERS_KEY = '__auth:users';
const SESS = (t) => '__auth:sess:' + t;
/* Bumped: the v1 prefix put adopted keys outside the store's `ld_*` pattern,
   so adoption has to run once more to place them where all() can see them. */
const LEGACY_CLAIMED = '__auth:legacy_claimed_v2';
const NAMESPACED = /^ld_u[0-9a-f]+:/;
const SEED = (uid) => '__auth:seed:' + uid;

/* The raw, un-namespaced store. Captured by protect(). */
let raw = null;

/* Per-request user id. Set by gate(), read by the protected store. */
let als = null;
try { als = new (require('async_hooks').AsyncLocalStorage)(); } catch (e) { als = null; }

/* ---------- small helpers ------------------------------------------------ */
const readBody = (req) => new Promise((resolve) => {
  let b = ''; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 1e6) { req.destroy(); return; } b += c; });
  req.on('end', () => resolve(b));
});
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const parseJar = (header) => {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
};
const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());

async function getJSON(key, fallback) {
  const v = await raw.get(key);
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}
const setJSON = (key, val) => raw.set(key, JSON.stringify(val));

/* ---------- passwords ---------------------------------------------------- */
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, ITER, KEYLEN, DIGEST).toString('hex');
}
function verifyPassword(password, salt, expected) {
  const got = Buffer.from(hashPassword(password, salt), 'hex');
  const want = Buffer.from(String(expected || ''), 'hex');
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

/* ---------- sessions ----------------------------------------------------- */
async function newSession(uid) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await setJSON(SESS(token), { uid, created: Date.now(), expires });
  return { token, expires };
}
function sessionCookie(token, maxAgeSec) {
  const bits = [
    'flow_sid=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSec
  ];
  if (PROD) bits.push('Secure');
  return bits.join('; ');
}
async function currentUser(req) {
  const token = parseJar(req.headers && req.headers.cookie)['flow_sid'];
  if (!token) return null;
  const s = await getJSON(SESS(token), null);
  if (!s || !s.uid) return null;
  if (s.expires && Date.now() > s.expires) { await raw.set(SESS(token), ''); return null; }
  const users = await getJSON(USERS_KEY, {});
  const u = Object.values(users).find(x => x.id === s.uid);
  return u ? { id: u.id, email: u.email, name: u.name, owner: !!u.owner, token } : null;
}

/* ---------- one-time migration of today's data --------------------------- */
async function adoptLegacyKeys(uid) {
  const claimed = await getJSON(LEGACY_CLAIMED, null);
  if (claimed) return 0;
  const all = await raw.all();
  let n = 0;
  for (const k of Object.keys(all || {})) {
    if (k.indexOf('__auth:') === 0 || k.indexOf('u:') === 0 || NAMESPACED.test(k)) continue;
    await raw.set('ld_u' + uid + ':' + k, all[k]);
    n++;
  }
  await setJSON(LEGACY_CLAIMED, { uid, at: new Date().toISOString(), keys: n });
  return n;
}

/* ---------- the protected store ------------------------------------------ */
function protect(store) {
  raw = store;
  const uid = () => (als && als.getStore()) || null;
  /* The prefix MUST keep the key inside the host store's own key space. The
     Upstash backend implements all() as `KEYS ld_*`, so a namespace like
     `u:<id>:ld_journal` is written successfully but is invisible to all() —
     and the app hydrates entirely from /api/all. Prefixing INSIDE the pattern
     keeps every namespaced key discoverable. */
  const pre = () => 'ld_u' + uid() + ':';
  return {
    get engine() { return store.engine; },
    get file() { return store.file; },
    async get(key) {
      if (!uid()) return null;
      return store.get(pre() + key);
    },
    async set(key, value) {
      if (!uid()) return;
      return store.set(pre() + key, value);
    },
    async all() {
      if (!uid()) return {};
      const everything = await store.all();
      const p = pre(), out = {};
      for (const k of Object.keys(everything || {})) {
        if (k.indexOf(p) === 0) out[k.slice(p.length)] = everything[k];
      }
      return out;
    },
    async count() {
      const mine = await this.all();
      return Object.keys(mine).length;
    }
  };
}

/* ---------- the gate ------------------------------------------------------
 * Returns true when it has already answered the request.
 * ------------------------------------------------------------------------ */
async function gate(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  /* Anything that is not an API call (the HTML, the manifest, icons) is served
     as before — the app has to load in order to show a sign-in screen. */
  if (p.indexOf('/api/') !== 0) return false;

  /* Credentialed requests cannot use a wildcard origin, and a wildcard here
     would let any website read this API. Lock it to this site. */
  const origin = req.headers && req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  /* ---- auth endpoints ---- */
  if (p === '/api/auth/me') {
    const me = await currentUser(req);
    if (!me) { json(res, 200, { ok: false, user: null, needsSetup: await isFirstRun() }); return true; }
    const seed = await getJSON(SEED(me.id), 'template');
    json(res, 200, { ok: true, user: { email: me.email, name: me.name, owner: me.owner }, seed });
    return true;
  }

  if (p === '/api/auth/signup' && req.method === 'POST') {
    const b = safeParse(await readBody(req));
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim().slice(0, 60) || email.split('@')[0];
    const pw = String(b.password || '');
    if (!emailOk(email)) return json(res, 400, { error: 'That does not look like an email address.' }), true;
    if (pw.length < 10) return json(res, 400, { error: 'Use at least 10 characters for the password.' }), true;

    const users = await getJSON(USERS_KEY, {});
    const first = Object.keys(users).length === 0;

    /* The first account becomes the owner and inherits everything already in
       the store. Between deploying this and the owner signing up there is a
       window where a stranger who knows the URL could claim it — and with a
       public repo, the URL is discoverable. When FLOW_OWNER_EMAIL is set, only
       that address can take the first account, which closes the window. */
    if (first && OWNER_EMAIL && email !== OWNER_EMAIL) {
      return json(res, 403, { error: 'This Flow is reserved for its owner. Ask them to invite you once they have set it up.' }), true;
    }
    if (!first && INVITE && String(b.invite || '') !== INVITE) {
      return json(res, 403, { error: 'That invite code is not right.' }), true;
    }
    if (users[email]) return json(res, 409, { error: 'There is already an account with that email.' }), true;

    const salt = crypto.randomBytes(16).toString('hex');
    const id = crypto.randomBytes(9).toString('hex');
    const owner = first || (OWNER_EMAIL && email === OWNER_EMAIL);
    users[email] = { id, email, name, salt, hash: hashPassword(pw, salt), owner: !!owner, created: new Date().toISOString() };
    await setJSON(USERS_KEY, users);

    let adopted = 0;
    if (owner) adopted = await adoptLegacyKeys(id);

    /* Record, once and authoritatively, whether this account inherited an
       existing Flow or is starting fresh. The browser cannot reliably work
       this out for itself — the app seeds defaults into its own store during
       boot, so by the time any client code looks, a brand-new account is
       indistinguishable from an old one. */
    await setJSON(SEED(id), adopted > 0 ? 'legacy' : 'template');

    const { token, expires } = await newSession(id);
    res.setHeader('Set-Cookie', sessionCookie(token, SESSION_DAYS * 86400));
    json(res, 200, { ok: true, user: { email, name, owner: !!owner }, adopted, seed: adopted > 0 ? 'legacy' : 'template', expires });
    return true;
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    const b = safeParse(await readBody(req));
    const email = String(b.email || '').trim().toLowerCase();
    const users = await getJSON(USERS_KEY, {});
    const rec = users[email];
    /* Same response and roughly the same work whether or not the account
       exists, so this cannot be used to discover who has an account. */
    const ok = rec ? verifyPassword(b.password, rec.salt, rec.hash)
                   : (hashPassword(String(b.password || ''), 'decoy'), false);
    if (!ok) return json(res, 401, { error: 'Wrong email or password.' }), true;

    if (rec.owner) await adoptLegacyKeys(rec.id);
    const { token, expires } = await newSession(rec.id);
    res.setHeader('Set-Cookie', sessionCookie(token, SESSION_DAYS * 86400));
    json(res, 200, { ok: true, user: { email: rec.email, name: rec.name, owner: !!rec.owner }, seed: await getJSON(SEED(rec.id), 'template'), expires });
    return true;
  }

  if (p === '/api/auth/logout') {
    const token = parseJar(req.headers && req.headers.cookie)['flow_sid'];
    if (token) await raw.set(SESS(token), '');
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    json(res, 200, { ok: true });
    return true;
  }

  if (p === '/api/auth/password' && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) return json(res, 401, { error: 'Sign in first.' }), true;
    const b = safeParse(await readBody(req));
    const users = await getJSON(USERS_KEY, {});
    const rec = users[me.email];
    if (!rec || !verifyPassword(b.current, rec.salt, rec.hash)) {
      return json(res, 403, { error: 'Current password is not right.' }), true;
    }
    if (String(b.next || '').length < 10) return json(res, 400, { error: 'Use at least 10 characters.' }), true;
    rec.salt = crypto.randomBytes(16).toString('hex');
    rec.hash = hashPassword(b.next, rec.salt);
    await setJSON(USERS_KEY, users);
    json(res, 200, { ok: true });
    return true;
  }

  /* ---- everything else under /api needs a session ---- */
  const me = await currentUser(req);
  if (!me) { json(res, 401, { error: 'auth required' }); return true; }

  /* Hand the rest of the handler a request scoped to this user. Returning
     false lets the original routes run, now reading and writing only that
     user's keys. */
  /* Record who is calling. attach() is what actually establishes the async
     context, using run() — enterWith() does not reliably survive the await
     back into the caller, which would silently drop the scope. */
  req.__flowUid = me.id;
  return false;
}

async function isFirstRun() {
  const users = await getJSON(USERS_KEY, {});
  return Object.keys(users).length === 0;
}
function safeParse(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

/* ---------- attach --------------------------------------------------------
 * Takes over the server's existing 'request' listeners and re-runs them
 * inside a per-request AsyncLocalStorage scope. Insert-only integration: the
 * original handler is not modified, wrapped at the call site, or re-indented.
 * ------------------------------------------------------------------------ */
function attach(server) {
  if (!als) throw new Error('[flow-auth] This Node build has no AsyncLocalStorage, so per-user isolation cannot be enforced. Refusing to start.');
  const originals = server.listeners('request').slice();
  if (!originals.length) throw new Error('[flow-auth] attach(server) must be called AFTER http.createServer(...).');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    Promise.resolve()
      .then(() => gate(req, res))
      .then((handled) => {
        if (handled) return;
        als.run(req.__flowUid || null, () => {
          for (const fn of originals) fn.call(server, req, res);
        });
      })
      .catch((e) => {
        try { json(res, 500, { error: String((e && e.message) || e) }); } catch (x) {}
      });
  });
  return server;
}

module.exports = { protect, gate, attach, _internals: { hashPassword, verifyPassword, parseJar } };
