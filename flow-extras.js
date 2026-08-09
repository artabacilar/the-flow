'use strict';
/* ==========================================================================
 * The Flow — extras: live prices (and, later, the assistant)
 * --------------------------------------------------------------------------
 * Loaded optionally by flow-auth.js. If this file is absent the app behaves
 * exactly as before, so it is safe to deploy either file first.
 *
 * Why the prices are fetched here and not in the browser:
 *   · none of these three APIs send CORS headers we can rely on, so a direct
 *     fetch from the page is blocked in some browsers and not others;
 *   · they are free and unauthenticated, which means rate limits. One server
 *     asking once a minute is fine; fifty phones each asking on every render
 *     is how you get banned;
 *   · a phone on a train should still see this morning's number rather than a
 *     spinner, so the last good value is kept and served with its timestamp.
 * ========================================================================== */

const https = require('https');

/* ---------- tiny HTTPS GET returning parsed JSON ------------------------- */
function getJSON(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'the-flow/1.0', 'Accept': 'application/json' }
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad JSON')); }
      });
    });
    req.setTimeout(timeoutMs || 6000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/* Indirection so the suites can drive the parsers with captured payloads.
   The sandbox this was written in cannot reach these hosts, so the parsing is
   proved against real recorded responses rather than a live call. */
let fetchJSON = getJSON;

const TROY_OZ_G = 31.1034768;   /* grams in a troy ounce — gram gold is derived */

/* ---------- sources ------------------------------------------------------
 * Each returns a flat map of quote -> number. One failing source must never
 * take the others down with it, so they are gathered with allSettled.
 * ------------------------------------------------------------------------ */
const SOURCES = {
  async btc() {
    const j = await fetchJSON('https://api.coinbase.com/v2/prices/BTC-USD/spot');
    const v = parseFloat(j && j.data && j.data.amount);
    if (!isFinite(v) || v <= 0) throw new Error('no BTC price');
    return { BTCUSD: v };
  },
  async fx() {
    const j = await fetchJSON('https://api.frankfurter.dev/v1/latest?from=USD&to=TRY,EUR');
    const r = (j && j.rates) || {};
    const out = {};
    if (isFinite(r.TRY) && r.TRY > 0) out.USDTRY = r.TRY;
    if (isFinite(r.EUR) && r.EUR > 0) {
      out.USDEUR = r.EUR;
      out.EURUSD = 1 / r.EUR;
      if (out.USDTRY) out.EURTRY = out.USDTRY / r.EUR;
    }
    if (!Object.keys(out).length) throw new Error('no FX rates');
    out.__date = j.date || null;
    return out;
  },
  async gold() {
    const j = await fetchJSON('https://api.gold-api.com/price/XAU');
    const v = parseFloat(j && j.price);
    if (!isFinite(v) || v <= 0) throw new Error('no gold price');
    return { XAUUSD: v };
  }
};

/* ---------- cache --------------------------------------------------------
 * Two clocks. `soft` is how long a value is served without refetching; `hard`
 * is how old a value may get before it is labelled stale to the reader. A
 * value past `hard` is still returned — an old number with an honest
 * timestamp beats an empty box.
 * ------------------------------------------------------------------------ */
const SOFT_MS = 60 * 1000;
const HARD_MS = 30 * 60 * 1000;

const cache = { at: 0, quotes: {}, fxDate: null, errors: {}, inflight: null };

const pos = (n) => typeof n === 'number' && isFinite(n) && n > 0;

function derive(q) {
  const out = Object.assign({}, q);
  /* A zero or negative quote is a broken feed, not a price. Dropping it here
     means a bad upstream value cannot propagate into a derived figure. */
  Object.keys(out).forEach(k => { if (!pos(out[k])) delete out[k]; });
  /* Gram gold in lira: the number Turkish price sites quote. Derived rather
     than fetched, because a keyless source for it does not exist. It tracks
     the market closely; the exchanges add a small premium of their own. */
  if (pos(out.XAUUSD) && pos(out.USDTRY)) {
    out.XAUTRY = out.XAUUSD * out.USDTRY;
    out.GRAMGOLDTRY = out.XAUTRY / TROY_OZ_G;
  }
  if (pos(out.BTCUSD)) {
    if (pos(out.USDTRY)) out.BTCTRY = out.BTCUSD * out.USDTRY;
    if (pos(out.USDEUR)) out.BTCEUR = out.BTCUSD * out.USDEUR;
  }
  return out;
}

async function refresh() {
  const names = Object.keys(SOURCES);
  const settled = await Promise.allSettled(names.map(n => SOURCES[n]()));
  const quotes = {}, errors = {};
  let any = false;
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      any = true;
      Object.keys(r.value).forEach(k => {
        if (k === '__date') { cache.fxDate = r.value[k]; return; }
        quotes[k] = r.value[k];
      });
    } else {
      errors[names[i]] = String((r.reason && r.reason.message) || r.reason || 'failed');
    }
  });
  /* Keep whatever the last good run produced for the sources that failed, so
     one flaky endpoint does not blank a panel that was fine a minute ago. */
  const merged = Object.assign({}, cache.quotes, quotes);
  cache.quotes = derive(merged);
  cache.errors = errors;
  if (any) cache.at = Date.now();
  return cache;
}

async function quotes() {
  const age = Date.now() - cache.at;
  if (cache.at && age < SOFT_MS) return cache;
  /* One refresh at a time. Without this, a burst of phones waking together
     would each start their own round of upstream calls. */
  if (!cache.inflight) {
    cache.inflight = refresh().finally(() => { cache.inflight = null; });
  }
  try { await cache.inflight; } catch (e) { /* serve what we have */ }
  return cache;
}

/* ---------- the route ----------------------------------------------------
 * Signed-in users only: it costs upstream quota, and there is no reason for
 * an anonymous caller to be able to spend it.
 * ------------------------------------------------------------------------ */
async function handle(p, req, res, ctx) {
  if (p !== '/api/flow/prices') return false;
  const c = await quotes();
  const age = c.at ? Date.now() - c.at : null;
  ctx.json(res, 200, {
    ok: !!c.at,
    at: c.at ? new Date(c.at).toISOString() : null,
    ageMs: age,
    stale: age == null || age > HARD_MS,
    fxDate: c.fxDate,
    quotes: c.quotes,
    errors: c.errors,
    /* What the client may show. Kept here so adding a pair later needs no
       change in the page. */
    known: ['BTCUSD', 'BTCTRY', 'BTCEUR', 'USDTRY', 'EURTRY', 'EURUSD', 'XAUUSD', 'GRAMGOLDTRY']
  });
  return true;
}

module.exports = {
  handle,
  _internals: {
    quotes, refresh, derive, cache, TROY_OZ_G, SOURCES,
    setFetcher(fn) { fetchJSON = fn || getJSON; }
  }
};

/* ==========================================================================
 * The assistant — read-only, over your own data, with a spend cap
 * --------------------------------------------------------------------------
 * Three deliberate limits, because this one costs real money and reads a
 * personal journal:
 *
 *   1. It never writes. There is no code path from a model reply back into
 *      the store, so a confused answer cannot edit anyone's priorities.
 *   2. It reads only the caller's own namespace — flow-auth hands this module
 *      a reader already locked to that account, never the raw store.
 *   3. Every account has a daily message cap. A stuck client or a runaway
 *      loop cannot quietly spend the owner's API credit.
 *
 * The key is read from the environment and never leaves the server: it is not
 * sent to the browser, not logged, and not echoed in any error.
 * ========================================================================== */

const CHAT_MODEL = process.env.FLOW_CHAT_MODEL || 'claude-sonnet-4-5';
const CHAT_DAILY_CAP = (() => {
  const n = parseInt(process.env.FLOW_CHAT_DAILY_CAP || '40', 10);
  return Number.isFinite(n) && n >= 0 ? n : 40;
})();
const CHAT_MAX_CONTEXT = 24000;   /* characters of the user's own data */

function postJSON(url, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const u = new URL(url);
    const req = https.request({
      method: 'POST', hostname: u.hostname, path: u.pathname + u.search,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': body.length
      }, headers)
    }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; if (out.length > 4e6) req.destroy(); });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(out); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed, raw: out.slice(0, 400) });
      });
    });
    req.setTimeout(timeoutMs || 45000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/* A compact, readable digest of the account's own data. Sending the raw store
   would be mostly noise (and mostly cost), so this picks the parts a question
   about someone's week could plausibly need, newest first, within a budget. */
async function buildContext(mine) {
  const pick = async (k) => { try { return await mine.get(k); } catch (e) { return null; } };
  const lines = [];
  const push = (label, val) => {
    if (val == null) return;
    const text = typeof val === 'string' ? val : JSON.stringify(val);
    if (!text || text === '{}' || text === '[]') return;
    lines.push('## ' + label + '\n' + text);
  };

  const compass = await pick('ld_compass');
  if (compass && typeof compass === 'object') {
    push('Mission and roles', { mission: compass.mission, roles: compass.roles });
    push('This week\'s rocks', compass.rocks);
  }
  const quad = await pick('ld_quad');
  if (quad && quad.items) push('Priorities (Q1–Q4)', quad.items.map(i => ({ q: i.q, txt: i.txt, done: !!i.done })));

  const journal = await pick('ld_journal');
  if (Array.isArray(journal)) push('Recent activity log (newest last)', journal.slice(-40));

  const written = await pick('flow:journal');
  if (Array.isArray(written)) push('Written journal entries (newest last)', written.slice(-10));

  push('Training', await pick('ld_training'));
  push('Habits', await pick('ld_habits'));
  push('Sleep', await pick('ld_sleep'));
  push('Mood and energy', await pick('ld_mood'));
  push('Finances', await pick('ld_finance'));
  push('Diet checklist', await pick('ld_diet'));
  push('Notes', await pick('flow:notes'));

  let ctx = lines.join('\n\n');
  if (ctx.length > CHAT_MAX_CONTEXT) ctx = ctx.slice(0, CHAT_MAX_CONTEXT) + '\n…(truncated)';
  return ctx;
}

const SYSTEM = [
  'You are a thinking partner inside a personal life dashboard called The Flow.',
  'You are given a snapshot of ONE person\'s own data: their mission, weekly rocks,',
  'priorities, activity log, journal, training, habits, sleep, mood, finances and notes.',
  '',
  'How to answer:',
  '· Be concrete and specific to what the data actually shows. Cite what you saw.',
  '· If the data does not support an answer, say so plainly rather than inventing detail.',
  '· Keep it short unless asked otherwise. This is read on a phone.',
  '· You cannot change anything. If the person asks you to add, edit, tick off or delete',
  '  something, explain that you can only read, and tell them exactly where in the app to do it.',
  '· Never invent entries, numbers or dates that are not in the snapshot.'
].join('\n');

const todayKey = () => 'chat:' + new Date().toISOString().slice(0, 10);

async function handleChat(p, req, res, ctx) {
  if (p !== '/api/flow/chat' || req.method !== 'POST') return false;

  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) {
    ctx.json(res, 503, { error: 'The assistant is not switched on. Add ANTHROPIC_API_KEY in Render to enable it.' });
    return true;
  }

  /* Spend cap, per account per day. */
  const used = (await ctx.counter.get(todayKey())) || 0;
  if (CHAT_DAILY_CAP > 0 && used >= CHAT_DAILY_CAP) {
    ctx.json(res, 429, { error: 'You have reached today\'s limit of ' + CHAT_DAILY_CAP + ' messages. It resets at midnight UTC.', used, cap: CHAT_DAILY_CAP });
    return true;
  }

  let body = {};
  try { body = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  const turns = Array.isArray(body.messages) ? body.messages : [];
  const clean = turns
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') {
    ctx.json(res, 400, { error: 'Say something first.' });
    return true;
  }

  const snapshot = await buildContext(ctx.mine);
  const payload = {
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: SYSTEM + '\n\n# The person\'s own data\n\n' + (snapshot || '(no data yet)'),
    messages: clean
  };

  const r = await postJSON('https://api.anthropic.com/v1/messages', {
    'x-api-key': key,
    'anthropic-version': '2023-06-01'
  }, payload);

  if (r.status === 401 || r.status === 403) {
    ctx.json(res, 502, { error: 'The API key was rejected. Check ANTHROPIC_API_KEY in Render.' });
    return true;
  }
  if (r.status === 404) {
    ctx.json(res, 502, { error: 'Model "' + CHAT_MODEL + '" is not available on this key. Set FLOW_CHAT_MODEL in Render to one that is.' });
    return true;
  }
  if (r.status === 429) {
    ctx.json(res, 429, { error: 'Anthropic is rate-limiting this key. Try again shortly.' });
    return true;
  }
  if (r.status < 200 || r.status >= 300) {
    /* Never surface the upstream body verbatim — it can echo request content. */
    ctx.json(res, 502, { error: 'The assistant could not answer just now (upstream ' + r.status + ').' });
    return true;
  }

  const parts = (r.body && Array.isArray(r.body.content)) ? r.body.content : [];
  const text = parts.filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
  await ctx.counter.set(todayKey(), used + 1);

  ctx.json(res, 200, {
    ok: true,
    reply: text || '(no answer)',
    used: used + 1,
    cap: CHAT_DAILY_CAP,
    model: CHAT_MODEL,
    contextChars: snapshot.length
  });
  return true;
}

/* Chain the two handlers. */
const _prices = module.exports.handle;
module.exports.handle = async function (p, req, res, ctx) {
  if (await _prices(p, req, res, ctx)) return true;
  if (await handleChat(p, req, res, ctx)) return true;
  return false;
};
module.exports._internals.buildContext = buildContext;
module.exports._internals.SYSTEM = SYSTEM;
module.exports._internals.chatConfig = () => ({ model: CHAT_MODEL, cap: CHAT_DAILY_CAP, maxContext: CHAT_MAX_CONTEXT });
