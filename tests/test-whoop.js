/* =========================================================================
 * WHOOP.
 *
 * No browser here. What is worth testing about this module is arithmetic and
 * bookkeeping — merging three collections into days, converting units,
 * deciding whether a failed refresh means "try later" or "they revoked us" —
 * and none of that is easier to see through a page.
 *
 * WHOOP itself is faked. The real API needs a client secret, a registered
 * application and somebody wearing a band, and what is being tested is what
 * this file does with the answers, not whether WHOOP can add up.
 *
 * The one that matters most
 * -------------------------
 * A refresh token is a long-lived credential to somebody's health record. The
 * app hydrates by calling /api/all, which returns every key in the account's
 * namespace, so a token written through the normal store would be handed to
 * the browser on every page load. The test at the bottom is the one that
 * would catch that coming back.
 * ====================================================================== */

process.env.WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID || 'test-client';
process.env.WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET || 'test-secret';

const W = require('../flow-whoop.js');
const { collect, accessToken, shape, hrvMs, redirectFor, TOK, ST, readJSON, writeJSON } = W._internals;

let pass = 0, fail = 0;
const ok = (n, c, d) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 240) : '')); }
};

/* A store that behaves like the real one: values in, strings out. */
function memStore() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    async all() {
      /* The Upstash backend enumerates with KEYS ld_* — anything outside that
         pattern is simply not in the answer. Modelled here because that is
         precisely the property the token storage depends on. */
      const out = {};
      for (const [k, v] of m) if (k.indexOf('ld_') === 0) out[k] = v;
      return out;
    }
  };
}

/* Stand in for WHOOP. Each entry is matched by substring against the URL. */
function fakeFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, opts: opts || {} });
    for (const key of Object.keys(routes)) {
      if (u.indexOf(key) >= 0) {
        const r = routes[key];
        const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body || {});
        return {
          ok: (r.status || 200) < 400,
          status: r.status || 200,
          async text() { return body; },
          async json() { return JSON.parse(body); }
        };
      }
    }
    throw new Error('the test did not expect a request to ' + u);
  };
  return calls;
}

(async () => {

  /* ------------------------------------------------------------------ *
   * Units
   * ------------------------------------------------------------------ */
  console.log('\n— the numbers mean what WHOOP says they mean —');

  ok('HRV comes through in milliseconds', hrvMs(31.813562) === 32, hrvMs(31.813562));
  ok('and a healthy adult reading survives', hrvMs(61.2) === 61, hrvMs(61.2));
  /* If WHOOP ever changed the unit under this field, a decimal would arrive
     and silently become 0. Refusing is louder than rounding. */
  ok('a value no heart produces is refused, not rounded', hrvMs(0.0821) === null, hrvMs(0.0821));
  ok('and so is nonsense', hrvMs(null) === null && hrvMs('x') === null && hrvMs(-4) === null);

  /* ------------------------------------------------------------------ *
   * Tokens
   * ------------------------------------------------------------------ */
  console.log('\n— keeping the connection alive —');

  /* WHOOP does not always send a new refresh token when it refreshes. Dropping
     the old one on a response that omits it turns a working connection into a
     dead one exactly one hour later, which is a miserable thing to debug. */
  ok('a refresh that omits a new refresh token keeps the old one',
    shape({ access_token: 'a2', expires_in: 3600 }, { refresh: 'r1', connectedAt: 'then' }).refresh === 'r1');
  ok('and a refresh that sends one uses it',
    shape({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }, { refresh: 'r1' }).refresh === 'r2');
  ok('the original connection date is not rewritten on every refresh',
    shape({ access_token: 'a2', expires_in: 3600 }, { refresh: 'r1', connectedAt: 'then' }).connectedAt === 'then');

  {
    const raw = memStore();
    await writeJSON(raw, TOK('7'), { access: 'good', refresh: 'r1', exp: Date.now() + 600000 });
    fakeFetch({});
    ok('a token that is still good is used as it is', await accessToken(raw, '7') === 'good');
  }

  {
    const raw = memStore();
    await writeJSON(raw, TOK('7'), { access: 'stale', refresh: 'r1', exp: Date.now() - 1000 });
    const calls = fakeFetch({ '/oauth2/token': { body: { access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 } } });
    const got = await accessToken(raw, '7');
    ok('an expired one is refreshed', got === 'fresh', got);
    ok('and the new pair is written back',
      (await readJSON(raw, TOK('7'), {})).refresh === 'r2');
    ok('the refresh asked for offline, or there would be no next one',
      /scope=offline/.test(calls[0].opts.body || ''), calls[0].opts.body);
  }

  {
    /* WHOOP having a bad minute must not cost somebody their connection. */
    const raw = memStore();
    await writeJSON(raw, TOK('7'), { access: 'stale', refresh: 'r1', exp: Date.now() - 1000 });
    fakeFetch({ '/oauth2/token': { status: 503, body: { error: 'upstream' } } });
    const got = await accessToken(raw, '7');
    ok('a 503 fails this attempt', got === null);
    ok('but the connection is kept, so a blip is not a disconnection',
      (await readJSON(raw, TOK('7'), {})).refresh === 'r1');
  }

  {
    /* Revoked from WHOOP's side is a different thing and has to stick. */
    const raw = memStore();
    await writeJSON(raw, TOK('7'), { access: 'stale', refresh: 'r1', exp: Date.now() - 1000 });
    fakeFetch({ '/oauth2/token': { status: 400, body: { error: 'invalid_grant' } } });
    await accessToken(raw, '7');
    const after = await readJSON(raw, TOK('7'), {});
    ok('a refused refresh clears the connection', after.refresh === null && after.access === null, after);
    ok('and records when', !!after.revoked);
  }

  /* ------------------------------------------------------------------ *
   * Reading a week
   * ------------------------------------------------------------------ */
  console.log('\n— three collections, one row per day —');

  const RECOVERY = {
    records: [
      { created_at: '2026-09-14T06:00:00Z', score_state: 'SCORED',
        score: { recovery_score: 71, hrv_rmssd_milli: 61.2, resting_heart_rate: 51, user_calibrating: false } },
      { created_at: '2026-09-15T06:00:00Z', score_state: 'SCORED',
        score: { recovery_score: 48, hrv_rmssd_milli: 38.9, resting_heart_rate: 57, user_calibrating: false } },
      /* Still being scored — must not become a day with nulls in it. */
      { created_at: '2026-09-16T06:00:00Z', score_state: 'PENDING_SCORE', score: null }
    ]
  };
  const CYCLES = {
    records: [
      { start: '2026-09-14T04:00:00Z', score_state: 'SCORED', score: { strain: 12.3456 } },
      { start: '2026-09-15T04:00:00Z', score_state: 'SCORED', score: { strain: 5.2951527 } }
    ]
  };
  const SLEEP = {
    records: [
      { end: '2026-09-14T06:00:00Z', nap: false, score_state: 'SCORED',
        score: { sleep_performance_percentage: 88,
                 stage_summary: { total_in_bed_time_milli: 28800000, total_awake_time_milli: 1800000 } } },
      /* A nap is not a night and must not overwrite one. */
      { end: '2026-09-15T14:00:00Z', nap: true, score_state: 'SCORED',
        score: { sleep_performance_percentage: 12,
                 stage_summary: { total_in_bed_time_milli: 1800000, total_awake_time_milli: 0 } } },
      { end: '2026-09-15T07:00:00Z', nap: false, score_state: 'SCORED',
        score: { sleep_performance_percentage: 64,
                 stage_summary: { total_in_bed_time_milli: 21600000, total_awake_time_milli: 3600000 } } }
    ]
  };

  {
    const raw = memStore();
    await writeJSON(raw, TOK('7'), { access: 'good', refresh: 'r1', exp: Date.now() + 600000 });
    fakeFetch({ '/v2/recovery': { body: RECOVERY }, '/v2/cycle': { body: CYCLES }, '/v2/activity/sleep': { body: SLEEP } });
    const out = await collect(raw, '7', 8);

    ok('the latest day is the one that ends up on the panel', out.date === '2026-09-15', out.date);
    ok('recovery', out.recovery === 48, out.recovery);
    ok('strain is rounded to something a person can read', out.strain === 5.3, out.strain);
    ok('sleep performance', out.sleep === 64, out.sleep);
    ok('HRV', out.hrv === 39, out.hrv);
    ok('resting heart rate', out.rhr === 57, out.rhr);
    /* 6 hours in bed minus an hour awake. Counting time in bed would tell
       somebody they slept six hours on a night they lay awake for one. */
    ok('hours are time asleep, not time in bed', out.hours === 5, out.hours);
    ok('a nap did not overwrite the night', out.sleep === 64);

    ok('a week comes back as days', out.history.length === 2, out.history.map(d => d.date));
    ok('each day carries every source that had it',
      out.history[0].recovery === 71 && out.history[0].strain === 12.3 && out.history[0].sleep === 88,
      out.history[0]);
    ok('an unscored record produces no day at all',
      !out.history.some(d => d.date === '2026-09-16'), out.history.map(d => d.date));
    ok('and it does not claim to be partial when all three answered', out.partial === false);
  }

  {
    /* One collection failing should not cost the other two. Somebody whose
       sleep is still being scored should still see their recovery. */
    const raw = memStore();
    await writeJSON(raw, TOK('7'), { access: 'good', refresh: 'r1', exp: Date.now() + 600000 });
    fakeFetch({ '/v2/recovery': { body: RECOVERY }, '/v2/cycle': { status: 500, body: {} }, '/v2/activity/sleep': { body: SLEEP } });
    const out = await collect(raw, '7', 8);
    ok('recovery survives a failed cycle call', out.recovery === 48, out.recovery);
    ok('strain is simply absent rather than wrong', out.strain === null, out.strain);
    ok('and it says the answer is incomplete', out.partial === true);
  }

  {
    const raw = memStore();
    await writeJSON(raw, TOK('7'), { access: 'gone', refresh: null, exp: Date.now() - 1000 });
    fakeFetch({});
    let code = null;
    try { await collect(raw, '7', 8); } catch (e) { code = e.code; }
    ok('a dead connection is reported as disconnected, not as an error', code === 'disconnected', code);
  }

  /* ------------------------------------------------------------------ *
   * Coming back from WHOOP
   * ------------------------------------------------------------------ */
  console.log('\n— the round trip —');

  ok('the redirect follows the proxy, not the socket', redirectFor({
    headers: { 'x-forwarded-proto': 'https', host: 'theflow.today' }, socket: {}
  }) === 'https://theflow.today/api/whoop/callback');

  ok('a forwarded list takes the first hop', redirectFor({
    headers: { 'x-forwarded-proto': 'https, http', host: 'theflow.today' }, socket: {}
  }) === 'https://theflow.today/api/whoop/callback');

  ok('and locally it is plain http', redirectFor({
    headers: { host: 'localhost:4222' }, socket: {}
  }) === 'http://localhost:4222/api/whoop/callback');

  /* Drive the handler with the smallest thing that looks like a request. */
  function fakeRes() {
    const r = { code: 0, headers: {}, body: '', ended: false };
    r.writeHead = (c, h) => { r.code = c; Object.assign(r.headers, h || {}); };
    r.end = (b) => { r.body = b || ''; r.ended = true; };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    return r;
  }
  /* The server's own helper is json(res, code, obj) — same shape here, or the
     handler's replies land in the wrong fields and the test lies. */
  const jsonOf = () => (res, code, obj) => { res.code = code; res.body = JSON.stringify(obj); res.ended = true; };

  {
    /* A state belongs to one account. Without that check, a connect link
       could be handed to somebody else and would attach their band to
       whichever account happened to open it. */
    const raw = memStore(), store = memStore();
    await writeJSON(raw, ST('s1'), { uid: '7', at: Date.now(), redirect: 'https://x/api/whoop/callback' });
    fakeFetch({});
    const res = fakeRes();
    await W.handle({ method: 'GET', headers: { host: 'x' }, socket: {} }, res, {
      path: '/api/whoop/callback',
      query: new URLSearchParams('code=c&state=s1'),
      uid: '9', raw, store, json: jsonOf()
    });
    ok('a callback for another account is refused', /whoop=mismatch/.test(res.headers.Location || ''), res.headers);
    ok('and no token is written for either of them',
      (await raw.get(TOK('9'))) === null && (await raw.get(TOK('7'))) === null);
  }

  {
    const raw = memStore(), store = memStore();
    await writeJSON(raw, ST('old'), { uid: '7', at: Date.now() - 20 * 60 * 1000 });
    fakeFetch({});
    const res = fakeRes();
    await W.handle({ method: 'GET', headers: { host: 'x' }, socket: {} }, res, {
      path: '/api/whoop/callback', query: new URLSearchParams('code=c&state=old'),
      uid: '7', raw, store, json: jsonOf()
    });
    ok('an authorisation left half-finished for too long expires',
      /whoop=expired/.test(res.headers.Location || ''), res.headers);
  }

  {
    /* A state may be spent once. Replaying one is how a stolen code gets a
       second chance. */
    const raw = memStore(), store = memStore();
    await writeJSON(raw, ST('s2'), { uid: '7', at: Date.now(), redirect: 'https://x/api/whoop/callback' });
    fakeFetch({ '/oauth2/token': { body: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600 } },
                '/v2/': { body: { records: [] } } });
    const req = { method: 'GET', headers: { host: 'x' }, socket: {} };
    const ctx = () => ({ path: '/api/whoop/callback', query: new URLSearchParams('code=c&state=s2'), uid: '7', raw, store });

    const r1 = fakeRes();
    await W.handle(req, r1, Object.assign(ctx(), { json: jsonOf() }));
    ok('a good callback connects', /whoop=connected/.test(r1.headers.Location || ''), r1.headers);
    ok('and the token is stored', !!(await readJSON(raw, TOK('7'), {})).refresh);

    const r2 = fakeRes();
    await W.handle(req, r2, Object.assign(ctx(), { json: jsonOf() }));
    ok('replaying the same state does not connect again',
      /whoop=expired/.test(r2.headers.Location || ''), r2.headers);
  }

  {
    const res = fakeRes();
    await W.handle({ method: 'GET', headers: {}, socket: {} }, res, {
      path: '/api/whoop/status', query: new URLSearchParams(''),
      uid: null, raw: memStore(), store: memStore(), json: jsonOf()
    });
    ok('nothing is answered to a request with no account', res.code === 401, res.code);
  }

  /* ------------------------------------------------------------------ *
   * The one that matters most
   * ------------------------------------------------------------------ */
  console.log('\n— a credential is not app data —');

  {
    const raw = memStore(), store = memStore();
    await writeJSON(raw, ST('s3'), { uid: '7', at: Date.now(), redirect: 'https://x/api/whoop/callback' });
    fakeFetch({ '/oauth2/token': { body: { access_token: 'SECRET-A', refresh_token: 'SECRET-R', expires_in: 3600 } },
                '/v2/': { body: { records: [] } } });
    const res = fakeRes();
    await W.handle({ method: 'GET', headers: { host: 'x' }, socket: {} }, res, {
      path: '/api/whoop/callback', query: new URLSearchParams('code=c&state=s3'),
      uid: '7', raw, store, json: jsonOf()
    });

    ok('the token key is outside the pattern /api/all enumerates',
      TOK('7').indexOf('ld_') !== 0, TOK('7'));

    const everything = JSON.stringify(await raw.all());
    ok('so the refresh token is not in what the page would be handed',
      everything.indexOf('SECRET-R') < 0, everything.slice(0, 200));
    ok('nor the access token', everything.indexOf('SECRET-A') < 0);

    /* And the same for the store the page actually reads from. */
    const mine = JSON.stringify(await store.all());
    ok('and not in the account store either',
      mine.indexOf('SECRET-R') < 0 && mine.indexOf('SECRET-A') < 0, mine.slice(0, 200));

    /* Belt and braces: every key the app store holds must be app data. */
    const keys = [...store.m.keys()];
    ok('the only thing written for the page is the readings',
      keys.every(k => k === 'whoop'), keys);
  }

  {
    /* Disconnecting stops the sync without deleting the record of days that
       actually happened. */
    const raw = memStore(), store = memStore();
    await writeJSON(raw, TOK('7'), { access: 'a', refresh: 'r', exp: Date.now() + 9e5 });
    await store.set('whoop', JSON.stringify({ recovery: 71, source: 'whoop', history: [{ date: '2026-09-14' }] }));
    const res = fakeRes();
    await W.handle({ method: 'POST', headers: {}, socket: {} }, res, {
      path: '/api/whoop/disconnect', query: new URLSearchParams(''),
      uid: '7', raw, store, json: jsonOf()
    });
    ok('disconnecting forgets the token', !(await raw.get(TOK('7'))));
    const left = await readJSON(store, 'whoop', {});
    ok('but keeps the readings', left.recovery === 71 && left.history.length === 1, left);
    ok('and stops claiming to be live', left.source === 'manual', left.source);
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
