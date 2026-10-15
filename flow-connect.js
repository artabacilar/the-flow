/* =========================================================================
 * flow-connect.js — other apps, connected to one account
 *
 * What this is for
 * ----------------
 * The Flow is meant to be the one place somebody's week lives, which means
 * it has to be able to reach the places where the rest of it lives: a Google
 * account, a meeting recorder, a band on a wrist. Each of those is an OAuth
 * round trip that ends with the server knowing something it did not know
 * before. This file is the one shape all of them share, so adding the next
 * one is a provider entry and not a second copy of the plumbing.
 *
 * Google is the first. What it gives is small and visible: the person's
 * name, address and photo, so the account in the sidebar is theirs and looks
 * like it. Nothing else is asked for — `openid email profile` is the whole
 * scope, which is also the set Google lets an app use without a security
 * review. The Flow does not read mail, calendars or contacts through this.
 *
 * Why the round trip leaves the app on iPhone and Mac
 * ---------------------------------------------------
 * Google refuses to sign anybody in inside an embedded web view
 * (Error 403: disallowed_useragent). The iPhone and Mac apps are web views,
 * so their sign-in has to happen in Safari or the default browser — which
 * has no session cookie for this site. The state therefore carries the
 * account: it is minted by a signed-in request, it is 128 random bits, it is
 * good for ten minutes and spent on first use. When the callback arrives
 * with no session, a state minted for the app is enough on its own; a state
 * minted for the browser still demands the same session that made it, as
 * WHOOP's does.
 *
 * Coming back in a browser
 * ------------------------
 * Google posts the token back from its own site, and a session cookie is
 * SameSite=Lax, so that POST arrives without one even in the browser that
 * started it. A browser round trip therefore lands in two steps: the POST
 * is checked and parked under its state, and the page it returns sends the
 * browser on to /finish — a same-site navigation, which does carry the
 * cookie — where the parked result is attached only if the session is the
 * one that started it. An app round trip ends at the POST: the browser it
 * finishes in has no session to check.
 *
 * Where it is kept
 * ----------------
 * Outside the account's data namespace — `conn:<uid>:<provider>` — for the
 * same reason WHOOP's tokens are: /api/all mirrors every namespaced key into
 * the page, and a page that has a copy of something can write a stale copy
 * back. The photo is fetched once, server-side, and kept as a small data URL,
 * so the sidebar does not depend on Google's image host answering every time
 * it is drawn, and Google is not told every time somebody opens the app.
 * Deleting the account removes these with everything else (flow-auth.js).
 *
 * No client secret
 * ----------------
 * Google is asked for an ID token directly (response_type=id_token, posted
 * back as a form), not for a code to trade for one. Trading a code needs a
 * client secret; an ID token does not — it is checked here instead, against
 * Google's published signing keys, its audience, issuer, expiry and the
 * nonce this server put in the request. So the only configuration is a
 * client ID, which is public by nature: it is in every sign-in URL.
 *
 * Configuration
 * -------------
 *   GOOGLE_CLIENT_ID      a "Web application" OAuth client
 *   GOOGLE_REDIRECT_URI   optional; https://<host>/api/connect/google/callback
 *                         is derived from the request when absent, and must
 *                         be registered on the client exactly
 *
 * A provider without its credentials is listed as not configured and its
 * button is not shown. Nothing else notices.
 * ====================================================================== */

'use strict';

const crypto = require('crypto');

const STATE_TTL_MS = 10 * 60 * 1000;
const PHOTO_MAX = 256 * 1024;

const KEY = (uid, id) => 'conn:' + uid + ':' + id;
const ST = (s) => 'conn:st:' + s;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---------------------------------------------------------------------
 * Providers
 *
 * Each says how to start (authUrl + scope), how to finish (finish(), handed
 * the code and the state record, returning a profile), and whether this
 * server has the credentials to do either. Adding Fathom, or anything else,
 * is another entry here.
 * ------------------------------------------------------------------ */

const PROVIDERS = {
  google: {
    id: 'google',
    name: 'Google',
    blurb: 'Your name and profile photo, from your Google account.',
    clientId: () => process.env.GOOGLE_CLIENT_ID || '',
    fixedRedirect: () => process.env.GOOGLE_REDIRECT_URI || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    scope: 'openid email profile',
    /* select_account: somebody with a work and a personal Google account
       should be asked which, not silently given whichever is signed in. */
    extra: { prompt: 'select_account', response_type: 'id_token', response_mode: 'form_post' },
    finish: finishGoogle
  }
};

const configured = (pv) => !!(pv && pv.clientId());

function redirectFor(pv, req) {
  if (pv.fixedRedirect()) return pv.fixedRedirect();
  /* Behind Render's proxy the request is plain HTTP and the scheme only
     survives in the forwarded header. A guessed http:// would not match the
     registered redirect and Google would refuse it. */
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return proto + '://' + host + '/api/connect/' + pv.id + '/callback';
}

/* ---------------------------------------------------------------------
 * Google
 * ------------------------------------------------------------------ */

/* Google's signing keys, cached for as long as Google says they are good
   for (its Cache-Control), and fetched again when a token names a key we do
   not hold — which is what a key rotation looks like from here. */
let jwksCache = { at: 0, ttl: 0, keys: [] };
async function signingKey(kid, url, fetchImpl, now) {
  const fresh = () => jwksCache.keys.length && (now - jwksCache.at) < jwksCache.ttl;
  let k = fresh() ? jwksCache.keys.find((x) => x.kid === kid) : null;
  if (k) return k;
  const res = await (fetchImpl || fetch)(url);
  if (!res.ok) throw new Error('Google\'s signing keys could not be fetched');
  const body = await res.json();
  const cc = String((res.headers && res.headers.get && res.headers.get('cache-control')) || '');
  const age = Number((cc.match(/max-age=(\d+)/) || [])[1] || 3600);
  jwksCache = { at: now, ttl: Math.min(age, 86400) * 1000, keys: Array.isArray(body.keys) ? body.keys : [] };
  return jwksCache.keys.find((x) => x.kid === kid) || null;
}

const unb64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* The ID token arrives from the browser, so nothing in it is believed until
   its signature checks out against Google's own keys. Then: who it is for,
   who issued it, that it is current, and that it answers this request and no
   other (the nonce this server put in the URL). */
async function readIdToken(idToken, opts) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Google did not return an ID token');
  let header, claims;
  try {
    header = JSON.parse(unb64(parts[0]).toString('utf8'));
    claims = JSON.parse(unb64(parts[1]).toString('utf8'));
  } catch (e) { throw new Error('the ID token could not be read'); }
  if (header.alg !== 'RS256') throw new Error('the ID token is not signed the way Google signs');
  const now = opts.now || Date.now();
  const jwk = await signingKey(header.kid, opts.jwksUrl, opts.fetch, now);
  if (!jwk) throw new Error('the ID token is signed with a key Google does not publish');
  let good = false;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    good = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, unb64(parts[2]));
  } catch (e) { good = false; }
  if (!good) throw new Error('the ID token\'s signature does not check out');
  const t = Math.floor(now / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (aud.indexOf(opts.clientId) < 0) throw new Error('the ID token is for a different app');
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new Error('the ID token was not issued by Google');
  if (!(Number(claims.exp) > t - 60)) throw new Error('the ID token has expired');
  if (!opts.nonce || claims.nonce !== opts.nonce) throw new Error('the ID token answers a different request');
  return claims;
}

/* Only Google's own image host, only https. The URL comes out of a token we
   have just checked, but a server that fetches whatever URL it is handed is
   one bad day from fetching something on its own network. */
function photoUrlOk(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)googleusercontent\.com$/.test(x.hostname);
  } catch (e) { return false; }
}

/* Google's photo URLs take a size suffix: `=s96-c` is 96px, cropped square.
   Asking for 128 keeps it sharp at sidebar size on a Retina screen and small
   enough to keep as a data URL. */
function sizedPhoto(u) {
  return String(u).replace(/=s\d+(-c)?$/, '') + '=s128-c';
}

async function fetchPhoto(u, fetchImpl) {
  if (!u || !photoUrlOk(u)) return null;
  try {
    const res = await (fetchImpl || fetch)(sizedPhoto(u), { redirect: 'error' });
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > PHOTO_MAX) return null;
    return 'data:' + type + ';base64,' + buf.toString('base64');
  } catch (e) { return null; }
}

async function finishGoogle(pv, posted, rec, deps) {
  const c = await readIdToken(posted.id_token, {
    clientId: pv.clientId(), nonce: rec.nonce, jwksUrl: pv.jwksUrl, fetch: deps.fetch, now: deps.now
  });
  return {
    account: String(c.sub || ''),
    email: c.email_verified === false ? '' : String(c.email || ''),
    name: String(c.name || ''),
    photo: await fetchPhoto(c.picture, deps.fetch)
  };
}

/* ---------------------------------------------------------------------
 * Storage
 * ------------------------------------------------------------------ */

async function readJSON(raw, key, dflt) {
  try {
    const v = await raw.get(key);
    if (v == null || v === '') return dflt;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { return dflt; }
}
const writeJSON = (raw, key, val) => raw.set(key, JSON.stringify(val));

/* Everything one account has connected, for deleting the account. */
async function purgeUser(raw, uid) {
  let n = 0;
  for (const id of Object.keys(PROVIDERS)) {
    const v = await raw.get(KEY(uid, id));
    if (v != null && v !== '') { await raw.set(KEY(uid, id), ''); n++; }
  }
  return n;
}

/* ---------------------------------------------------------------------
 * Pages
 * ------------------------------------------------------------------ */

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* What the browser shows when the round trip started in the iPhone or Mac
   app. There is nowhere useful to redirect it to — the app is the place the
   person is going back to, and this browser is not signed in. */
function donePage(title, body, ok) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#0a0b0d"><title>' + esc(title) + ' — The Flow</title>' +
    '<style>html,body{margin:0;height:100%;background:#0a0b0d;color:#e8eaee;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    'main{max-width:420px;margin:0 auto;padding:18vh 24px 0;text-align:center}' +
    '.mark{width:56px;height:56px;border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:28px;' +
    'background:' + (ok ? 'rgba(52,211,153,.14);color:#34d399' : 'rgba(248,113,113,.14);color:#f87171') + '}' +
    'h1{font-size:22px;margin:0 0 8px}p{color:#9aa1ad;margin:0 0 8px}</style></head><body><main>' +
    '<div class="mark">' + (ok ? '&#10003;' : '!') + '</div><h1>' + esc(title) + '</h1>' + body +
    '</main></body></html>';
}

/* ---------------------------------------------------------------------
 * Routes — mounted by flow-auth's gate() under /api/connect/
 * ------------------------------------------------------------------ */

async function handle(req, res, ctx) {
  const p = ctx.path;
  if (p.indexOf('/api/connect/') !== 0) return false;
  const { raw, me, json } = ctx;
  const deps = { fetch: ctx.fetch, now: ctx.now };
  const now = () => (ctx.now || Date.now());

  /* ---- what can be connected, and what is ---- */
  if (p === '/api/connect/list') {
    if (!me) return json(res, 401, { error: 'auth required' }), true;
    const out = [];
    for (const pv of Object.values(PROVIDERS)) {
      const rec = await readJSON(raw, KEY(me.id, pv.id), null);
      out.push({
        id: pv.id, name: pv.name, blurb: pv.blurb,
        configured: configured(pv),
        connected: !!rec,
        email: (rec && rec.email) || null,
        name_on_account: (rec && rec.name) || null,
        photo: (rec && rec.photo) || null,
        since: (rec && rec.since) || null
      });
    }
    json(res, 200, { connections: out });
    return true;
  }

  const m = p.match(/^\/api\/connect\/([a-z0-9-]+)\/(start|callback|finish|disconnect)$/);
  if (!m) return false;
  const pv = PROVIDERS[m[1]];
  if (!pv) return json(res, 404, { error: 'No such connection.' }), true;
  const step = m[2];

  /* ---- begin ----
     A POST that answers with the URL, rather than a GET that redirects:
     the iPhone and Mac apps have to open it in the real browser, and the
     real browser has no session to start one with. */
  if (step === 'start') {
    if (!me) return json(res, 401, { error: 'auth required' }), true;
    if (req.method !== 'POST') return json(res, 405, { error: 'POST' }), true;
    if (!configured(pv)) return json(res, 503, { error: pv.name + ' is not set up on this server yet.' }), true;
    let body = {};
    try { body = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
    const state = b64url(crypto.randomBytes(16));
    const nonce = b64url(crypto.randomBytes(16));
    const redirect = redirectFor(pv, req);
    await writeJSON(raw, ST(state), { uid: me.id, provider: pv.id, at: now(), app: !!body.app, nonce, redirect });
    const url = pv.authUrl + '?' + new URLSearchParams(Object.assign({
      client_id: pv.clientId(),
      redirect_uri: redirect,
      scope: pv.scope,
      state: state,
      nonce: nonce
    }, pv.extra || {})).toString();
    json(res, 200, { url: url, expires: now() + STATE_TTL_MS });
    return true;
  }

  const failPage = (why) => donePage('Not connected', '<p>' + esc(why) + '</p><p>Go back to The Flow and try again from Settings.</p>', false);
  const okPage = (profile) => donePage(pv.name + ' connected',
    (profile.email ? '<p>' + esc(profile.email) + '</p>' : '') +
    '<p>You can close this and go back to The Flow.</p>', true);
  const save = (uid, profile) => writeJSON(raw, KEY(uid, pv.id), {
    account: profile.account, email: profile.email, name: profile.name,
    photo: profile.photo, since: new Date(now()).toISOString()
  });
  const home = (status) => { res.writeHead(302, { Location: '/?connect=' + pv.id + ':' + status + '#settings', 'Cache-Control': 'no-store' }); res.end(); return true; };
  const page = (code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return true; };

  /* ---- come back ----
     Google posts the ID token here as a form (or sends an error as a
     query). There is no session on this request even in the browser that
     started it — the cookie is SameSite=Lax and this is a cross-site POST —
     so an app round trip ends here, and a browser one is parked and sent on
     to /finish, where its own cookie can be checked. */
  if (step === 'callback') {
    let posted = {};
    if (req.method === 'POST') {
      try { posted = Object.fromEntries(new URLSearchParams((await ctx.readBody(req)) || '')); } catch (e) { posted = {}; }
    }
    const pick = (k) => (posted[k] != null ? String(posted[k]) : (ctx.query.get(k) || ''));
    const state = pick('state');
    const rec = state ? await readJSON(raw, ST(state), null) : null;
    /* Spent on first sight, whatever happens next: a state is single-use or
       it is a reusable key to somebody's account. */
    if (state) await raw.set(ST(state), '');

    const viaApp = !!(rec && rec.app);
    const fail = (status, why) => viaApp ? page(400, failPage(why)) : home(status);

    if (!rec || rec.provider !== pv.id || now() - rec.at > STATE_TTL_MS) return fail('expired', 'That link has expired.');
    if (pick('error')) return fail('denied', 'Permission was not given.');
    if (!pick('id_token')) return fail('incomplete', pv.name + ' did not finish.');

    let profile;
    try { profile = await pv.finish(pv, posted, rec, deps); }
    catch (e) {
      console.error('[connect/' + pv.id + '] ' + (e && e.message));
      return fail('failed', pv.name + ' did not accept the sign-in. Please try again.');
    }

    if (viaApp) { await save(rec.uid, profile); return page(200, okPage(profile)); }

    /* A browser round trip: park the result under a fresh one-time key and
       send the browser on to /finish. The page does the navigation, from
       this origin, so the session cookie goes with it. */
    const park = b64url(crypto.randomBytes(16));
    await writeJSON(raw, ST(park), { uid: rec.uid, provider: pv.id, at: now(), parked: profile });
    const to = '/api/connect/' + pv.id + '/finish?p=' + park;
    return page(200, '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' + to + '">' +
      '<title>The Flow</title><style>body{background:#0a0b0d}</style>' +
      '<script>location.replace(' + JSON.stringify(to) + ')</script>');
  }

  /* ---- the browser's second step ---- */
  if (step === 'finish') {
    const park = ctx.query.get('p') || '';
    const rec = park ? await readJSON(raw, ST(park), null) : null;
    if (park) await raw.set(ST(park), '');
    if (!rec || !rec.parked || rec.provider !== pv.id || now() - rec.at > STATE_TTL_MS) return home('expired');
    if (!me || String(me.id) !== String(rec.uid)) return home('mismatch');
    await save(rec.uid, rec.parked);
    return home('connected');
  }

  /* ---- stop ---- */
  if (step === 'disconnect') {
    if (!me) return json(res, 401, { error: 'auth required' }), true;
    if (req.method !== 'POST') return json(res, 405, { error: 'POST' }), true;
    await raw.set(KEY(me.id, pv.id), '');
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = {
  handle,
  purgeUser,
  PROVIDERS,
  _internals: { readIdToken, photoUrlOk, sizedPhoto, fetchPhoto, redirectFor, KEY, ST, STATE_TTL_MS, donePage,
                resetKeys: () => { jwksCache = { at: 0, ttl: 0, keys: [] }; } }
};
