/* =========================================================================
 * flow-whoop.js — Recovery and Strain, from the band that measures them
 *
 * What was here before
 * --------------------
 * The Sleep tab asked `http://localhost:3000/whoop-data.json` for its numbers.
 * That address means "this computer", so it could only ever answer on the one
 * laptop running a helper script — never on a phone, never for anyone else,
 * and not on the laptop either unless the helper happened to be running. The
 * panel's permanent "Helper not running" was not a bug in the helper. It was
 * the architecture saying so out loud.
 *
 * This replaces it with the ordinary arrangement: the server holds the
 * connection, WHOOP talks to the server, and every device the person signs in
 * on sees the same numbers.
 *
 * Why the server and not the page
 * -------------------------------
 * WHOOP's OAuth is the confidential-client kind — the token exchange needs a
 * client secret, and a secret in a web page is not a secret. It also has no
 * CORS headers for browsers, which is the same decision expressed twice.
 *
 * Where the tokens live, and why not with everything else
 * ------------------------------------------------------
 * The app hydrates by calling /api/all, which returns every key in the
 * signed-in account's namespace. A refresh token written through the normal
 * store would therefore be handed to the browser on every page load — a
 * long-lived credential to somebody's health record, sitting in a JSON
 * response, for no reason.
 *
 * So tokens go to the *unnamespaced* store under `whoop:tok:<uid>`. That is
 * not a hiding place; it is outside the `ld_*` pattern that all() enumerates,
 * which is what makes it structurally unreachable from the page rather than
 * merely undocumented. The readings themselves are ordinary data and go where
 * ordinary data goes.
 *
 * Configuration
 * -------------
 *   WHOOP_CLIENT_ID      from developer.whoop.com
 *   WHOOP_CLIENT_SECRET  likewise
 *   WHOOP_REDIRECT_URI   optional; derived from the request when absent, and
 *                        must match what is registered with WHOOP exactly
 *
 * Without the first two every endpoint here answers "not configured" and the
 * panel keeps its manual entry. Nothing else in the app notices.
 * ====================================================================== */

'use strict';

const crypto = require('crypto');

const AUTH_URL  = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API       = 'https://api.prod.whoop.com/developer';

/* `offline` is what makes a refresh token appear at all; without it the
   connection dies an hour after it is made and the person has to authorise
   again every time they open the app. The rest is the smallest set that
   answers the five numbers on the panel. */
const SCOPES = [
  'offline',
  'read:recovery',        /* recovery score, HRV, resting heart rate */
  'read:cycles',          /* day strain */
  'read:sleep',           /* sleep performance and stages */
  'read:workout',
  'read:profile'
].join(' ');

const CLIENT_ID     = process.env.WHOOP_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET || '';
const FIXED_REDIRECT = process.env.WHOOP_REDIRECT_URI || '';

const configured = () => !!(CLIENT_ID && CLIENT_SECRET);

/* How long a half-finished authorisation stays valid. Long enough to read a
   consent screen and find your password; short enough that an abandoned one
   is not lying around. */
const STATE_TTL_MS = 10 * 60 * 1000;

/* Refresh a little before the token actually dies, so a request never fails
   on a clock that is a few seconds out. */
const EARLY_MS = 60 * 1000;

/* ---------------------------------------------------------------------
 * Storage
 *
 * `raw` is the store as it exists before flow-auth namespaces it, so these
 * keys are addressed by uid explicitly and are invisible to /api/all.
 * ------------------------------------------------------------------ */

const TOK = (uid) => 'whoop:tok:' + uid;
const ST  = (s) => 'whoop:st:' + s;

async function readJSON(raw, key, dflt) {
  try {
    const v = await raw.get(key);
    if (v == null) return dflt;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { return dflt; }
}
const writeJSON = (raw, key, val) => raw.set(key, JSON.stringify(val));

/* ---------------------------------------------------------------------
 * Tokens
 * ------------------------------------------------------------------ */

function redirectFor(req) {
  if (FIXED_REDIRECT) return FIXED_REDIRECT;
  /* Behind Render's proxy the request is plain HTTP and the scheme only
     survives in the forwarded header. Guessing http here would produce a
     redirect URI that does not match the registered one, and WHOOP would
     refuse the exchange with a message about the redirect rather than about
     the scheme. */
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return proto + '://' + host + '/api/whoop/callback';
}

async function exchange(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  if (!res.ok || !data || !data.access_token) {
    const why = (data && (data.error_description || data.error)) || text.slice(0, 200) || ('HTTP ' + res.status);
    const err = new Error(why);
    err.status = res.status;
    throw err;
  }
  return data;
}

function shape(data, previous) {
  return {
    access: data.access_token,
    /* A refresh response does not always carry a new refresh token. Dropping
       the old one on a response that omits it is how a working connection
       silently becomes a dead one an hour later. */
    refresh: data.refresh_token || (previous && previous.refresh) || null,
    exp: Date.now() + (Number(data.expires_in || 3600) * 1000),
    scope: data.scope || (previous && previous.scope) || '',
    connectedAt: (previous && previous.connectedAt) || new Date().toISOString()
  };
}

/* Return a usable access token, refreshing if the one we hold has expired.
   Answers null when there is no connection, or when the refresh was refused
   — which is what happens after somebody revokes access from WHOOP's side,
   and is a disconnection rather than an error to retry. */
async function accessToken(raw, uid) {
  const tok = await readJSON(raw, TOK(uid), null);
  if (!tok || !tok.access) return null;
  if (Date.now() < tok.exp - EARLY_MS) return tok.access;
  if (!tok.refresh) return null;

  let fresh;
  try {
    fresh = await exchange({
      grant_type: 'refresh_token',
      refresh_token: tok.refresh,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'offline'
    });
  } catch (e) {
    /* 400 and 401 from the token endpoint mean this refresh token is no
       longer good — revoked, or already spent. Anything else (a timeout,
       a 5xx) is WHOOP having a bad minute and must not throw the connection
       away: the person would have to reconnect because of a blip. */
    if (e.status === 400 || e.status === 401) {
      await writeJSON(raw, TOK(uid), Object.assign({}, tok, {
        access: null, refresh: null, revoked: new Date().toISOString()
      }));
    }
    return null;
  }
  const next = shape(fresh, tok);
  await writeJSON(raw, TOK(uid), next);
  return next.access;
}

async function api(raw, uid, path, params) {
  const token = await accessToken(raw, uid);
  if (!token) { const e = new Error('not connected'); e.code = 'disconnected'; throw e; }
  const url = API + path + (params ? '?' + new URLSearchParams(params).toString() : '');
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401) { const e = new Error('not connected'); e.code = 'disconnected'; throw e; }
  if (res.status === 429) { const e = new Error('WHOOP is rate limiting us'); e.code = 'rate'; throw e; }
  if (!res.ok) { const e = new Error('WHOOP said ' + res.status); e.code = 'upstream'; throw e; }
  return res.json();
}

/* ---------------------------------------------------------------------
 * Reading the numbers
 *
 * Five things end up on the panel: recovery, strain, sleep performance, HRV
 * and resting heart rate. Three collections carry them, and each is asked
 * for a week so the panel can show a trend rather than only a dot.
 * ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000;
const dayOf = (iso) => String(iso || '').slice(0, 10);

/* `hrv_rmssd_milli` is RMSSD in milliseconds, despite how the name reads —
   WHOOP's own example returns 31.813562, and a healthy adult sits somewhere
   between about 20 and 120. So: round it, and refuse anything outside the
   range a human heart produces rather than putting a decimal on the panel
   and letting somebody wonder what happened to their recovery. */
function hrvMs(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 1 || n > 500) return null;
  return Math.round(n);
}
const round1 = (v) => { const n = Number(v); return isFinite(n) ? Math.round(n * 10) / 10 : null; };
const int = (v) => { const n = Number(v); return isFinite(n) ? Math.round(n) : null; };

async function collect(raw, uid, days) {
  const start = new Date(Date.now() - (days || 8) * DAY).toISOString();
  const range = { start: start, limit: 25 };

  /* One failure should not cost the other two: a person whose sleep is still
     being scored should still see their recovery. */
  const [rec, cyc, slp] = await Promise.all([
    api(raw, uid, '/v2/recovery', range).catch((e) => { if (e.code === 'disconnected') throw e; return null; }),
    api(raw, uid, '/v2/cycle', range).catch((e) => { if (e.code === 'disconnected') throw e; return null; }),
    api(raw, uid, '/v2/activity/sleep', range).catch((e) => { if (e.code === 'disconnected') throw e; return null; })
  ]);

  /* date → the day's numbers, merged from whichever collections had them. */
  const byDay = new Map();
  const put = (date, patch) => {
    if (!date) return;
    byDay.set(date, Object.assign({ date: date }, byDay.get(date) || {}, patch));
  };

  for (const r of ((rec && rec.records) || [])) {
    if (r.score_state !== 'SCORED' || !r.score) continue;
    put(dayOf(r.created_at), {
      recovery: int(r.score.recovery_score),
      hrv: hrvMs(r.score.hrv_rmssd_milli),
      rhr: int(r.score.resting_heart_rate),
      calibrating: !!r.score.user_calibrating
    });
  }

  for (const c of ((cyc && cyc.records) || [])) {
    if (c.score_state !== 'SCORED' || !c.score) continue;
    put(dayOf(c.start), { strain: round1(c.score.strain) });
  }

  for (const s of ((slp && slp.records) || [])) {
    if (s.nap || s.score_state !== 'SCORED' || !s.score) continue;
    const st = s.score.stage_summary || {};
    /* Time asleep, not time in bed — the number a person means by "I got
       seven hours". */
    const asleep = (st.total_in_bed_time_milli || 0) - (st.total_awake_time_milli || 0);
    put(dayOf(s.end), {
      sleep: int(s.score.sleep_performance_percentage),
      hours: asleep > 0 ? Math.round(asleep / 3600000 * 100) / 100 : null,
      sleepEnd: s.end
    });
  }

  const history = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const latest = history[history.length - 1] || {};

  return {
    recovery: latest.recovery == null ? null : latest.recovery,
    strain: latest.strain == null ? null : latest.strain,
    sleep: latest.sleep == null ? null : latest.sleep,
    hrv: latest.hrv == null ? null : latest.hrv,
    rhr: latest.rhr == null ? null : latest.rhr,
    hours: latest.hours == null ? null : latest.hours,
    date: latest.date || null,
    calibrating: !!latest.calibrating,
    source: 'whoop',
    updated: new Date().toISOString(),
    history: history.slice(-14),
    /* Said plainly so the panel does not have to infer it from a null. A
       band that has not synced since yesterday is not a broken connection. */
    partial: !rec || !cyc || !slp
  };
}

/* ---------------------------------------------------------------------
 * Routes
 *
 * Mounted under /api/whoop. Everything here runs after flow-auth's gate, so
 * `ctx.uid` is the signed-in account and `ctx.store` is already namespaced
 * to it. Returns true when it handled the request.
 * ------------------------------------------------------------------ */

async function handle(req, res, ctx) {
  const p = ctx.path;
  if (p.indexOf('/api/whoop') !== 0) return false;

  const { raw, uid, store, json } = ctx;

  if (!uid) { json(res, 401, { error: 'auth required' }); return true; }

  /* ---- is this even switched on ---- */
  if (p === '/api/whoop/status') {
    const tok = await readJSON(raw, TOK(uid), null);
    const live = !!(tok && tok.access && tok.refresh);
    const data = await readJSON(store, 'whoop', null);
    json(res, 200, {
      configured: configured(),
      connected: live,
      since: (tok && tok.connectedAt) || null,
      revoked: (tok && tok.revoked) || null,
      updated: (data && data.updated) || null
    });
    return true;
  }

  if (!configured()) {
    json(res, 503, {
      error: 'not configured',
      detail: 'This server has no WHOOP application credentials, so it cannot connect to WHOOP.'
    });
    return true;
  }

  /* ---- begin ---- */
  if (p === '/api/whoop/connect') {
    const state = crypto.randomBytes(16).toString('hex');
    await writeJSON(raw, ST(state), { uid: uid, at: Date.now(), redirect: redirectFor(req) });
    const url = AUTH_URL + '?' + new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: redirectFor(req),
      scope: SCOPES,
      state: state
    }).toString();
    res.writeHead(302, { Location: url });
    res.end();
    return true;
  }

  /* ---- come back ---- */
  if (p === '/api/whoop/callback') {
    const code = ctx.query.get('code');
    const state = ctx.query.get('state');
    const denied = ctx.query.get('error');

    const back = (status) => {
      res.writeHead(302, { Location: '/?whoop=' + status + '#tab-sleep' });
      res.end();
    };

    if (denied) return back('denied'), true;
    if (!code || !state) return back('incomplete'), true;

    const rec = await readJSON(raw, ST(state), null);
    /* The state has to name an account, and it has to be this one. Without
       that second check a link could be handed to somebody else and would
       attach their band to whichever account happened to open it. */
    await raw.set(ST(state), '');
    if (!rec || !rec.uid || Date.now() - rec.at > STATE_TTL_MS) return back('expired'), true;
    if (String(rec.uid) !== String(uid)) return back('mismatch'), true;

    let data;
    try {
      data = await exchange({
        grant_type: 'authorization_code',
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: rec.redirect || redirectFor(req)
      });
    } catch (e) {
      return back('failed'), true;
    }

    await writeJSON(raw, TOK(uid), shape(data, null));

    /* Fetch once straight away. Landing on a panel that still says "—" after
       connecting reads as a connection that did not work. */
    try {
      const fresh = await collect(raw, uid, 8);
      await store.set('whoop', JSON.stringify(fresh));
    } catch (e) {}

    return back('connected'), true;
  }

  /* ---- the numbers ---- */
  if (p === '/api/whoop/data.json' || (p === '/api/whoop/sync' && req.method === 'POST')) {
    try {
      const fresh = await collect(raw, uid, 8);
      await store.set('whoop', JSON.stringify(fresh));
      json(res, 200, Object.assign({ connected: true }, fresh));
    } catch (e) {
      if (e.code === 'disconnected') { json(res, 200, { connected: false }); return true; }
      /* Anything else: say so, but hand back the last good reading rather
         than nothing. Yesterday's recovery is more use than an error. */
      const last = await readJSON(store, 'whoop', null);
      json(res, 200, Object.assign({ connected: true, stale: true, error: e.message }, last || {}));
    }
    return true;
  }

  /* ---- stop ---- */
  if (p === '/api/whoop/disconnect' && req.method === 'POST') {
    await raw.set(TOK(uid), '');
    const last = await readJSON(store, 'whoop', null);
    /* Keep the readings — they are a record of days that happened, and
       disconnecting a band is not a request to forget last week. Mark them
       as no longer live so the panel stops claiming to be synced. */
    if (last) await store.set('whoop', JSON.stringify(Object.assign({}, last, { source: 'manual' })));
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = {
  handle,
  configured,
  /* Exported for the tests, which exercise the parts that are easy to get
     subtly wrong and impossible to notice from the outside: unit conversion,
     merging three collections into days, and what happens to a refresh token
     when WHOOP declines to send a new one. */
  _internals: { collect, accessToken, shape, hrvMs, redirectFor, TOK, ST, SCOPES, readJSON, writeJSON }
};
