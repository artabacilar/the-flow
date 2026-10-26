'use strict';

/* What somebody using the app is told when the assistant cannot answer.
 *
 * These used to name ANTHROPIC_API_KEY and Render. That is a note to me,
 * and it was being rendered on the Direction card and in Ask — to every
 * person using the app, and to whoever reviews it for the App Store. The
 * operator detail belongs in the server log, where I will actually see it;
 * the person gets a sentence that is true and means something to them.
 */
const ASSISTANT_OFF = 'The assistant is not switched on for this app yet.';
const ASSISTANT_UNAVAILABLE = 'The assistant could not be reached just now. Try again shortly.';

/* The detail the person must not see, kept where I will. */
function logUpstream(where, status, detail) {
  const why = (status === 401 || status === 403)
    ? 'ANTHROPIC_API_KEY was rejected'
    : status === 404
      ? 'model "' + CHAT_MODEL + '" is not available on this key — set FLOW_CHAT_MODEL'
      : 'upstream ' + status + (detail ? ' — ' + detail : '');
  console.error('[flow/assistant] ' + where + ': ' + why);
}

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

/* Text cut at a fixed length can split an emoji in half; a lone half
   (a surrogate) is not valid Unicode, and the API refuses the whole request
   with a 400. Every string sent is made whole first. */
const wellFormed = (s) => (typeof s.toWellFormed === 'function' ? s.toWellFormed()
  : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1\uFFFD'));

function postJSON(url, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload, (k, v) => (typeof v === 'string' ? wellFormed(v) : v)), 'utf8');
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
  push('Finances (budget and the first expense form)', await pick('ld_finance'));
  /* The second expense store: receipts, statement imports and the newer
     form. Without it, half the spending was invisible to Ask. */
  const exp = await pick('flow:expenses');
  if (Array.isArray(exp)) push('Expenses (newest last)', exp.slice(-60).map(x => ({ date: x.date, amount: x.amount, currency: x.currency, merchant: x.merchant, category: x.category })));
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

/** The system prompt as blocks, with the person's own data marked cacheable.
 *
 *  Every question re-sends the same twenty-odd kilobytes of record, and the
 *  model has to read all of it before it can write the first word — which is
 *  most of the wait. Marking that block cacheable means the second question
 *  in a conversation starts from a warm prompt instead of a cold one.
 *
 *  Below Anthropic's minimum cacheable size there is nothing to gain, so the
 *  marker is left off rather than sent and ignored.
 */
const CACHE_MIN_CHARS = 4000;
function systemBlocks(snapshot) {
  const data = '# The person\'s own data\n\n' + (snapshot || '(no data yet)');
  const block = { type: 'text', text: data };
  if (data.length >= CACHE_MIN_CHARS) block.cache_control = { type: 'ephemeral' };
  return [{ type: 'text', text: SYSTEM }, block];
}

const todayKey = () => 'chat:' + new Date().toISOString().slice(0, 10);

async function handleChat(p, req, res, ctx) {
  if (p !== '/api/flow/chat' || req.method !== 'POST') return false;

  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) {
    ctx.json(res, 503, { error: ASSISTANT_OFF });
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
    system: systemBlocks(snapshot),
    messages: clean
  };

  const r = await postJSON('https://api.anthropic.com/v1/messages', {
    'x-api-key': key,
    'anthropic-version': '2023-06-01'
  }, payload);

  if (r.status === 401 || r.status === 403) {
    logUpstream('chat', r.status);
    ctx.json(res, 502, { error: ASSISTANT_UNAVAILABLE });
    return true;
  }
  if (r.status === 404) {
    logUpstream('chat', r.status);
    ctx.json(res, 502, { error: ASSISTANT_UNAVAILABLE });
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


/* ==========================================================================
 * Streaming — the same answer, arriving as it is written
 * --------------------------------------------------------------------------
 * The buffered endpoint above is honest but feels broken: a question sits
 * there for eight or ten seconds with nothing on screen, and on a free
 * instance that has gone to sleep it can be twenty. The words are being
 * written the whole time; they were simply being held back until the last
 * one arrived.
 *
 * This streams them. Anthropic sends server-sent events; we forward the text
 * deltas to the browser as our own, much smaller, events. The first word
 * lands about a second after the model starts, so the wait becomes something
 * you watch rather than something you endure.
 *
 * Everything the buffered endpoint guards, this guards identically: no key,
 * no answer; over the cap, no answer; and the only data it can see is what
 * the caller-scoped reader hands it.
 * ========================================================================== */

/** Whole server-sent events out of a buffer, and whatever is left over.
 *
 *  Events are separated by a blank line, but a network chunk boundary can
 *  fall anywhere — mid-word, mid-JSON, between the two newlines that end a
 *  frame. So only complete frames are returned and the remainder is handed
 *  back to be prepended to the next chunk. Getting this wrong does not fail
 *  loudly; it drops the occasional word out of the middle of an answer.
 */
function sseFrames(buf) {
  const events = [];
  let rest = String(buf == null ? '' : buf);
  let i;
  while ((i = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, i);
    rest = rest.slice(i + 2);
    let data = '';
    for (const line of block.split('\n')) {
      if (line.indexOf('data:') === 0) data += line.slice(5).trim();
    }
    if (!data || data === '[DONE]') continue;
    try { events.push(JSON.parse(data)); } catch (e) { /* not our frame */ }
  }
  return { events, rest };
}

/** POST that hands back parsed SSE events as they arrive instead of a body. */
function postStream(url, headers, payload, onEvent, timeoutMs) {
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
      res.setEncoding('utf8');

      /* A refusal comes back as ordinary JSON, not a stream. Collect the
         little of it we need and let the caller turn it into a message. */
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let out = '';
        res.on('data', (c) => { out += c; if (out.length > 4000) res.destroy(); });
        res.on('end', () => resolve({ status: res.statusCode, raw: out }));
        return;
      }

      let buf = '';
      res.on('data', (chunk) => {
        const cut = sseFrames(buf + chunk);
        buf = cut.rest;
        for (const ev of cut.events) {
          try { onEvent(ev); } catch (e) { /* a bad frame must not kill the stream */ }
        }
      });
      res.on('end', () => resolve({ status: 200 }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs || 120000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function handleChatStream(p, req, res, ctx) {
  if (p !== '/api/flow/chat/stream' || req.method !== 'POST') return false;

  /* Once the stream is open we can no longer send a JSON error, so every
     refusal has to be decided before the first byte goes out. */
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) {
    ctx.json(res, 503, { error: ASSISTANT_OFF });
    return true;
  }
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    /* Some proxies buffer a response until it ends, which would undo the
       entire point of this endpoint. This is the header that stops nginx. */
    'X-Accel-Buffering': 'no'
  });
  const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} };

  /* Tells the client the request landed, so it can drop the "waking the
     server" note and show that it is thinking rather than connecting. */
  send({ t: 'open' });

  let any = false, stopped = false;
  req.on('close', () => { stopped = true; });

  let out;
  try {
    out = await postStream('https://api.anthropic.com/v1/messages', {
      'x-api-key': key, 'anthropic-version': '2023-06-01'
    }, {
      model: CHAT_MODEL, max_tokens: 1024, stream: true,
      system: systemBlocks(snapshot),
      messages: clean
    }, (ev) => {
      if (stopped) return;
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        any = true;
        send({ t: 'd', v: ev.delta.text });
      } else if (ev.type === 'error') {
        send({ t: 'err', v: 'The assistant stopped part-way through.' });
      }
    });
  } catch (e) {
    send({ t: 'err', v: 'Could not reach the assistant.' });
    send({ t: 'end' });
    try { res.end(); } catch (e2) {}
    return true;
  }

  if (out && out.status !== 200) {
    logUpstream('stream', out.status);
    const msg = out.status === 401 || out.status === 403
      ? ASSISTANT_UNAVAILABLE
      : out.status === 429
        ? 'Anthropic is rate-limiting this key. Try again shortly.'
        : out.status === 404
          ? ASSISTANT_UNAVAILABLE
          : 'The assistant could not answer just now (upstream ' + out.status + ').';
    send({ t: 'err', v: msg });
    send({ t: 'end' });
    try { res.end(); } catch (e) {}
    return true;
  }

  /* Only a reply that produced words costs a message. A stream that died
     before the first token should not be charged to the day's allowance. */
  if (any) {
    await ctx.counter.set(todayKey(), used + 1);
    send({ t: 'meta', used: used + 1, cap: CHAT_DAILY_CAP });
  }
  send({ t: 'end' });
  try { res.end(); } catch (e) {}
  return true;
}

/* ==========================================================================
 * Direction — the read on where this is actually going
 * --------------------------------------------------------------------------
 * The chat assistant answers questions. This answers the question nobody
 * remembers to ask: given the last two months of what you actually did,
 * where is this heading, and what would change it today?
 *
 * It is deliberately NOT a chat turn. It reads a wider, rolled-up window —
 * metric trends, the weekly plans in the person's own words, goals, journal
 * — and returns a fixed shape the app can lay out, so the answer looks the
 * same every morning and the differences between days are real differences
 * rather than the model choosing a new format.
 *
 * Three limits, for the same reasons as the assistant: it never writes, it
 * reads only the caller's own namespace, and it is capped and cached per day
 * so an app left open in a tab cannot spend the owner's credit.
 * ========================================================================== */

const DIR_DAILY_CAP = (() => {
  const n = parseInt(process.env.FLOW_DIRECTION_DAILY_CAP || '6', 10);
  return Number.isFinite(n) && n >= 0 ? n : 6;
})();

/* Sun sign from a birth date. Pure, so the boundaries can be tested rather
   than trusted — every one of them is an off-by-one waiting to happen. */
const ZODIAC = [
  ['Capricorn',  1, 19], ['Aquarius',   2, 18], ['Pisces',    3, 20],
  ['Aries',      4, 19], ['Taurus',     5, 20], ['Gemini',    6, 20],
  ['Cancer',     7, 22], ['Leo',        8, 22], ['Virgo',     9, 22],
  ['Libra',     10, 22], ['Scorpio',   11, 21], ['Sagittarius', 12, 21],
  ['Capricorn', 12, 31]
];
function sunSign(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const mo = +m[2], da = +m[3];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  for (const [name, em, ed] of ZODIAC) {
    if (mo < em || (mo === em && da <= ed)) return name;
  }
  return 'Capricorn';
}

/* ---- metric roll-up: a ledger of days becomes a trend the model can read -- */

function isoDay(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') +
         '-' + String(d.getUTCDate()).padStart(2, '0');
}
function mondayOf(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** Weekly totals per metric, newest week last, plus target and trend. */
function rollUpMetrics(metrics, log, weeks, now) {
  if (!Array.isArray(metrics) || !metrics.length) return [];
  const ledger = (log && typeof log === 'object') ? log : {};
  const ref = now || new Date();
  const thisMon = mondayOf(ref);
  const n = weeks || 8;

  return metrics.map((m) => {
    const series = [];
    for (let w = n - 1; w >= 0; w--) {
      const start = new Date(thisMon.getTime());
      start.setUTCDate(start.getUTCDate() - w * 7);
      let total = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(start.getTime());
        d.setUTCDate(d.getUTCDate() + i);
        const row = ledger[isoDay(d)];
        if (row && row[m.id]) total += row[m.id];
      }
      series.push(total);
    }
    const cur = series[series.length - 1] || 0;
    const done = series.slice(0, -1);                 /* completed weeks only */
    const avg = done.length ? done.reduce((a, b) => a + b, 0) / done.length : 0;
    return {
      name: m.name,
      unit: m.unit || '',
      target: m.target || 0,
      per: m.period === 'month' ? 'month' : 'week',
      thisWeek: cur,
      last8Weeks: series,
      weeklyAverage: Math.round(avg * 10) / 10,
      everLogged: series.some(v => v > 0)
    };
  });
}

/** The weekly plans the person wrote, newest first, most recent few. */
function recentPlans(plans, limit) {
  if (!plans || typeof plans !== 'object') return [];
  return Object.keys(plans).sort().reverse().slice(0, limit || 4)
    .map(w => ({ week: w, plan: String(plans[w] || '').slice(0, 900) }));
}

async function buildDirectionContext(mine) {
  const pick = async (k) => { try { return await mine.get(k); } catch (e) { return null; } };
  const out = {};

  const [principle, tenets, goals, metrics, log, birth] = await Promise.all([
    pick('flow:ns:principle'), pick('flow:ns:tenets'), pick('flow:ns:goals'),
    pick('flow:ns:metrics'), pick('flow:ns:log'), pick('flow:ns:birth')
  ]);

  out.principle = typeof principle === 'string' ? principle : null;
  out.tenets = Array.isArray(tenets) ? tenets.slice(0, 12) : null;
  out.focusAreas = Array.isArray(goals)
    ? goals.map(g => ({ name: g.name, selfRatedPct: g.pct })) : null;
  out.metrics = rollUpMetrics(metrics, log, 8);

  const compass = await pick('ld_compass');
  if (compass && typeof compass === 'object') {
    out.mission = compass.mission || null;
    out.roles = compass.roles || null;
    out.weeklyPlansInTheirOwnWords = recentPlans(compass.plans, 4);
    const rocks = compass.rocks || {};
    const weeks = Object.keys(rocks).sort().reverse().slice(0, 3);
    out.recentBigRocks = weeks.map(w => ({
      week: w,
      rocks: (rocks[w] || []).map(r => ({ title: r.title, day: r.day, done: !!r.done, note: r.note || '' }))
    }));
  }

  const quad = await pick('ld_quad');
  if (quad && quad.items) {
    out.priorities = quad.items.filter(i => !i.done).map(i => ({ quadrant: i.q, text: i.txt }));
  }

  const journal = await pick('ld_journal');
  if (Array.isArray(journal)) out.activityLog = journal.slice(-70);
  const written = await pick('flow:journal');
  if (Array.isArray(written)) out.writtenEntries = written.slice(-8);

  const training = await pick('ld_training');
  if (training && training.weeks) out.trainingWeeks = training.weeks;
  out.habits = await pick('ld_habits');
  out.sleep = await pick('ld_sleep');
  out.moodAndEnergy = await pick('ld_mood');

  const sign = sunSign(birth);
  return { sign, birth: birth || null, data: out };
}

const DIR_SYSTEM = [
  'You write the daily "Direction" panel inside a personal life dashboard called The Flow.',
  'You are given ONE person\'s own record: their mission and principles, the goals they set,',
  'the metrics they tap every time they do the thing (DJ sets, demos sent, production sessions,',
  'live streams, performances, workouts, and work on their two businesses), eight weeks of those',
  'counts, the weekly plans they wrote in their own words, their priorities, and their activity log.',
  '',
  'Return ONLY a JSON object, no prose around it, with exactly these keys:',
  '  lede        — one sentence, max 30 words. The honest headline of where this is heading.',
  '  today       — 2-4 sentences. What today should be about, given the week so far and what is scheduled.',
  '  trajectory  — 3-6 sentences. Where the last eight weeks are actually pointing, with the numbers that show it.',
  '  actions     — 2-4 strings. Specific things to do, each doable this week. Name the metric or the person.',
  '  watch       — 1-3 strings. What is quietly slipping, with the evidence.',
  '',
  'How to write it:',
  '· Every claim must trace to something in the data. Quote the number. "Three weeks without a demo sent"',
  '  beats "you could send more demos".',
  '· A metric that has never been logged is not a failure, it is an unknown. Say so rather than scolding.',
  '· Compare the weekly plans they wrote against what the log shows actually happened. That gap is the',
  '  single most useful thing you can point at. Be direct about it without being harsh.',
  '· Notice trade-offs rather than only shortfalls: a training week that doubled while production went to',
  '  zero is a choice, and worth naming as one.',
  '· Write to them as "you". Plain language, no management-speak, no motivational filler.',
  '· This is read on a phone in the morning. Every sentence must earn its place.'
].join('\n');

const DIR_SIGN_NOTE = [
  '',
  'The person has given their star sign. Open the "today" section in the register of a good horoscope —',
  'the tone of a daily reading, addressed to a %SIGN% — but every claim underneath must still come from',
  'their actual data. Use the sign for voice and framing only. Never invent planetary positions, transits,',
  'cosmic events or fortunes, and never predict outcomes the data cannot support. If the sign\'s',
  'conventional traits happen to fit a real pattern in the record, you may say so; if not, ignore them.'
].join('\n');

const dirDayKey = () => 'dir:' + new Date().toISOString().slice(0, 10);
const dirCountKey = () => 'dirn:' + new Date().toISOString().slice(0, 10);

/** Pull the JSON object out of a reply, tolerating fences or stray prose. */
function parseDirection(text) {
  const t = String(text || '').trim();
  const tryParse = (s) => { try { const o = JSON.parse(s); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } };
  let o = tryParse(t);
  if (!o) {
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
    if (fence) o = tryParse(fence[1].trim());
  }
  if (!o) {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) o = tryParse(t.slice(a, b + 1));
  }
  if (!o) return { lede: '', today: t.slice(0, 1200), trajectory: '', actions: [], watch: [] };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 6) : []);
  return {
    lede: str(o.lede), today: str(o.today), trajectory: str(o.trajectory),
    actions: list(o.actions), watch: list(o.watch)
  };
}

async function handleDirection(p, req, res, ctx) {
  if (p !== '/api/flow/direction' || req.method !== 'POST') return false;

  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) {
    ctx.json(res, 503, { error: ASSISTANT_OFF });
    return true;
  }

  let body = {};
  try { body = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}

  /* Today's reading is written once and then simply re-read. Opening the tab
     ten times costs nothing; only an explicit refresh spends anything. */
  const cached = await ctx.counter.get(dirDayKey());
  if (cached && cached.lede != null && !body.refresh) {
    ctx.json(res, 200, Object.assign({ ok: true, cached: true }, cached));
    return true;
  }

  const spent = (await ctx.counter.get(dirCountKey())) || 0;
  if (DIR_DAILY_CAP > 0 && spent >= DIR_DAILY_CAP) {
    ctx.json(res, 429, {
      error: 'You have refreshed today\'s direction ' + spent + ' times. It resets at midnight UTC.',
      used: spent, cap: DIR_DAILY_CAP
    });
    return true;
  }

  const built = await buildDirectionContext(ctx.mine);
  let snapshot = JSON.stringify(built.data, null, 1);
  if (snapshot.length > CHAT_MAX_CONTEXT) snapshot = snapshot.slice(0, CHAT_MAX_CONTEXT) + '\n…(truncated)';

  const system = DIR_SYSTEM +
    (built.sign ? DIR_SIGN_NOTE.replace('%SIGN%', built.sign) : '') +
    '\n\nToday is ' + new Date().toISOString().slice(0, 10) + '.' +
    '\n\n# The person\'s own record\n\n' + snapshot;

  const r = await postJSON('https://api.anthropic.com/v1/messages', {
    'x-api-key': key, 'anthropic-version': '2023-06-01'
  }, {
    model: CHAT_MODEL,
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: 'Write today\'s direction.' }]
  });

  if (r.status === 401 || r.status === 403) {
    logUpstream('direction', r.status);
    ctx.json(res, 502, { error: ASSISTANT_UNAVAILABLE }); return true;
  }
  if (r.status === 429) {
    ctx.json(res, 429, { error: 'Anthropic is rate-limiting this key. Try again shortly.' }); return true;
  }
  if (r.status < 200 || r.status >= 300) {
    ctx.json(res, 502, { error: 'The direction could not be written just now (upstream ' + r.status + ').' }); return true;
  }

  const parts = (r.body && Array.isArray(r.body.content)) ? r.body.content : [];
  const text = parts.filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
  const out = parseDirection(text);
  out.sign = built.sign || null;
  out.generatedAt = new Date().toISOString();

  await ctx.counter.set(dirDayKey(), out);
  await ctx.counter.set(dirCountKey(), spent + 1);

  ctx.json(res, 200, Object.assign({ ok: true, cached: false, used: spent + 1, cap: DIR_DAILY_CAP }, out));
  return true;
}

/* ==========================================================================
 * Planning the week — the Sunday session
 * --------------------------------------------------------------------------
 * The page brings what only it has in hand (last week's honest numbers, what
 * the person just wrote about it, what they chose to carry over, next week's
 * meetings); this adds their mission, roles and recent record, and asks for a
 * short list of Big Rocks as JSON. Same three limits as the assistant: it
 * writes nothing (the page adds only what the person ticks), it reads only
 * this account, and it is capped per day.
 * ========================================================================== */

const PLAN_DAILY_CAP = (() => {
  const n = parseInt(process.env.FLOW_PLAN_DAILY_CAP || '6', 10);
  return Number.isFinite(n) && n >= 0 ? n : 6;
})();
const planCountKey = () => 'plan:' + new Date().toISOString().slice(0, 10);
const PLAN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const PLAN_SYSTEM = [
  'You help one person plan their coming week inside The Flow, a planner built on',
  'Stephen Covey\'s weekly compass: a mission, a few roles, and three to seven Big Rocks',
  '— the things they would regret reaching Sunday without.',
  '',
  'Rules:',
  '· Propose 3 to 7 Big Rocks for the week named below. Fewer, better ones beat a long list.',
  '· Spread them across the roles that matter; include at least one Q2 rock (important,',
  '  not urgent: health, relationships, learning, planning) — that is the point of the method.',
  '· Use what last week actually showed. If they finished little, propose less, not more.',
  '· Carried-over items are already on the week; do not repeat them.',
  '· Put each rock on a day that fits around the meetings listed; give a time only when one',
  '  is obvious. Never put two timed rocks on top of each other or on top of a meeting.',
  '· Titles are short and concrete, written the way the person writes (match their language).',
  '· "why" is one plain sentence tying the rock to their mission, a role or last week.',
  '',
  'Answer with JSON only, no prose around it:',
  '{"focus":"one sentence: what this week is for",',
  ' "rocks":[{"title":"…","role":"one of their roles, or empty","day":"mon|tue|wed|thu|fri|sat|sun",',
  '           "time":"HH:MM or empty","why":"…"}]}'
].join('\n');

/* Whatever the model wraps it in, take the JSON object and keep only what
   the page can use, in the shape it expects. Pure, for the tests. */
function parsePlan(text, roles) {
  let obj = null;
  const t = String(text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { obj = JSON.parse(t.slice(a, b + 1)); } catch (e) { obj = null; } }
  if (!obj || !Array.isArray(obj.rocks)) return null;
  const roleSet = (roles || []).map((r) => String(r).toLowerCase());
  const rocks = obj.rocks.slice(0, 7).map((r) => {
    const day = String((r && r.day) || '').toLowerCase().slice(0, 3);
    const time = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String((r && r.time) || '')) ? String(r.time).padStart(5, '0') : '';
    const role = String((r && r.role) || '').slice(0, 60);
    return {
      title: String((r && r.title) || '').trim().slice(0, 160),
      role: roleSet.indexOf(role.toLowerCase()) >= 0 ? role : '',
      day: PLAN_DAYS.indexOf(day) >= 0 ? day : 'mon',
      time,
      why: String((r && r.why) || '').trim().slice(0, 240)
    };
  }).filter((r) => r.title);
  if (!rocks.length) return null;
  return { focus: String(obj.focus || '').trim().slice(0, 240), rocks };
}

async function handlePlanWeek(p, req, res, ctx) {
  if (p !== '/api/flow/plan-week' || req.method !== 'POST') return false;
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) { ctx.json(res, 503, { error: ASSISTANT_OFF }); return true; }

  const spent = (await ctx.counter.get(planCountKey())) || 0;
  if (PLAN_DAILY_CAP > 0 && spent >= PLAN_DAILY_CAP) {
    ctx.json(res, 429, { error: 'You have asked for ' + spent + ' plans today. It resets at midnight UTC.', used: spent, cap: PLAN_DAILY_CAP });
    return true;
  }

  let body = {};
  try { body = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  const clip = (v, n) => JSON.stringify(v == null ? null : v).slice(0, n);

  const pick = async (k) => { try { return await ctx.mine.get(k); } catch (e) { return null; } };
  const compass = (await pick('ld_compass')) || {};
  const roles = Array.isArray(compass.roles) ? compass.roles.map((r) => (r && (r.name || r.title || r.role)) || r).filter((r) => typeof r === 'string') : [];
  const journal = await pick('ld_journal');
  const written = await pick('flow:journal');

  const brief = [
    '# The week to plan: ' + String(body.week || '').slice(0, 10),
    '# Mission\n' + clip(compass.mission || '', 1200),
    '# Roles\n' + clip(roles, 800),
    '# Last week, honestly (planned vs done)\n' + clip(body.scorecard, 3000),
    '# What they wrote about last week\n' + clip(body.reflection, 2000),
    '# Already carried over into this week\n' + clip(body.carried, 1500),
    '# Meetings already in their calendars this week\n' + clip(body.calendar, 3000),
    '# Recent activity (newest last)\n' + clip(Array.isArray(journal) ? journal.slice(-30) : [], 5000),
    '# Recent journal writing (newest last)\n' + clip(Array.isArray(written) ? written.slice(-5) : [], 4000)
  ].join('\n\n');

  const r = await postJSON('https://api.anthropic.com/v1/messages', {
    'x-api-key': key, 'anthropic-version': '2023-06-01'
  }, {
    model: CHAT_MODEL,
    max_tokens: 1200,
    system: PLAN_SYSTEM,
    messages: [{ role: 'user', content: brief + '\n\nPropose the week.' }]
  });
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    logUpstream('plan', r.status);
    ctx.json(res, 502, { error: ASSISTANT_UNAVAILABLE }); return true;
  }
  if (r.status === 429) { ctx.json(res, 429, { error: 'Anthropic is rate-limiting this key. Try again shortly.' }); return true; }
  if (r.status < 200 || r.status >= 300) { ctx.json(res, 502, { error: 'The plan could not be written just now (upstream ' + r.status + ').' }); return true; }

  const parts = (r.body && Array.isArray(r.body.content)) ? r.body.content : [];
  const text = parts.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  const plan = parsePlan(text, roles);
  await ctx.counter.set(planCountKey(), spent + 1);
  if (!plan) { ctx.json(res, 502, { error: 'The suggestion came back in a shape the app could not read. Try again.' }); return true; }
  ctx.json(res, 200, Object.assign({ ok: true, used: spent + 1, cap: PLAN_DAILY_CAP }, plan));
  return true;
}


/* ==========================================================================
 * Bank statements — read a PDF, Excel or CSV export into transactions
 * --------------------------------------------------------------------------
 * Turkish banks will not hand an app a live feed without a licence, but every
 * one of them lets you download a statement. This turns that file into lines
 * the ledger understands.
 *
 *   · The file is read in memory and forgotten. Nothing about it is written
 *     to the store here; the browser decides what to keep, and keeps lines,
 *     not the document.
 *   · Excel is unpacked here (an .xlsx is a zip of XML; Node's zlib is enough)
 *     and HTML-disguised .xls exports are flattened, so the model only ever
 *     sees text or a PDF.
 *   · Reading a long statement takes longer than a phone will hold a request
 *     open, so it runs as a job: POST starts it, GET asks how it is going.
 *     Jobs live in memory for twenty minutes and belong to one account.
 *   · Card numbers and IBANs are not wanted. The model is told to drop them,
 *     and anything that still looks like one is masked before it leaves.
 * ========================================================================== */

const zlib = require('zlib');
const crypto = require('crypto');

const STMT_DAILY_CAP = (() => {
  const n = parseInt(process.env.FLOW_STATEMENT_DAILY_CAP || '12', 10);
  return Number.isFinite(n) && n >= 0 ? n : 12;
})();
const STMT_MAX_BYTES = 10 * 1024 * 1024;     /* the file itself, before base64 */
const STMT_MAX_TEXT = 220000;                /* characters of spreadsheet text */
const STMT_JOB_TTL = 20 * 60 * 1000;
const stmtCountKey = () => 'stmt:' + new Date().toISOString().slice(0, 10);
const stmtJobs = new Map();
let stmtPost = (...a) => postJSON(...a);   /* swapped in tests */

const STMT_KINDS = ['spend', 'income', 'transfer', 'fee', 'refund', 'card-payment'];

const STMT_SYSTEM = [
  'You read bank-account and credit-card statements and return every transaction in them as JSON.',
  'Statements are usually Turkish (Garanti BBVA, Akbank, İş Bankası, Yapı Kredi, Ziraat, QNB, Enpara, DenizBank and others) but may be in any language.',
  '',
  'Reply with ONE JSON object and nothing else — no prose, no code fence:',
  '{"bank":"","account":"","currency":"TRY","from":"YYYY-MM-DD","to":"YYYY-MM-DD","opening":null,"closing":null,',
  ' "tx":[["YYYY-MM-DD","Description",-123.45,"TRY","Category","spend"]]}',
  '',
  'Rules for every row in tx:',
  '· amount is NEGATIVE for money leaving the account or charged to the card, POSITIVE for money coming in.',
  '· kind is one of: spend, income, transfer (own-account or person-to-person moves), fee (bank fees, interest, BSMV/KKDF, card fees), refund (iade), card-payment (a payment made TO a credit card).',
  '· On a credit-card statement, purchases are spend with negative amounts; the payment you made to the card is card-payment and positive.',
  '· Instalments (taksit): use the amount charged on THIS statement and keep the "3/6" marker in the description.',
  '· Dates are day-first in Turkey (01.10.2026 is 1 October). Resolve two-digit years and missing years from the statement period.',
  '· Description: the merchant or counterparty, cleaned up and readable (e.g. "Migros", "Netflix", "Havale — Ahmet Y."), at most 60 characters. Drop terminal ids, reference numbers and city suffixes.',
  '· NEVER include card numbers, IBANs or account numbers anywhere. "account" may say only the type and last four digits, e.g. "Bonus card ••1234".',
  '· category must be one of the categories given. Use "Other" when nothing fits; income, transfers and card payments may also use "Other".',
  '· currency is the ISO code of that row (TRY unless the row says otherwise).',
  '· Skip summary lines: opening/closing balances, totals, minimum payment, available limit, carried-over debt, points/bonus summaries.',
  '· Keep the statement order. Include every transaction — do not summarise or merge.',
  '',
  'opening/closing are the balances the statement states, or null. from/to is the period the statement covers.'
].join('\n');

/* ---- reading the file ---------------------------------------------------- */

function xmlText(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/* The smallest zip reader that opens an .xlsx: central directory, then each
   member inflated on its own. No streaming, no encryption, no zip64. */
function unzip(buf) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!/^xl\/(sharedStrings|styles|workbook|worksheets\/sheet\d+|_rels\/workbook)\.xml(\.rels)?$/.test(name)) continue;
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const data = buf.slice(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
  }
  return out;
}

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* Excel stores dates as day counts from 1899-12-30. Which numbers are dates
   is decided by the cell's style, so the styles are read just far enough to
   know that. */
function dateStyles(stylesXml) {
  const custom = {};
  (stylesXml.match(/<numFmt [^>]*>/g) || []).forEach(t => {
    const id = /numFmtId="(\d+)"/.exec(t), code = /formatCode="([^"]*)"/.exec(t);
    if (id && code) custom[id[1]] = xmlText(code[1]);
  });
  const isDateFmt = (id) => {
    const n = +id;
    if ((n >= 14 && n <= 22) || (n >= 45 && n <= 47)) return true;
    const c = custom[id];
    return !!(c && /[dmy]/i.test(c.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/0\.0|#/.test(c));
  };
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  return (xfs ? (xfs[1].match(/<xf [^>]*>/g) || []) : []).map(t => {
    const id = /numFmtId="(\d+)"/.exec(t);
    return !!(id && isDateFmt(id[1]));
  });
}

function serialToISO(n) {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (isNaN(d)) return String(n);
  const iso = d.toISOString();
  return d.getUTCHours() || d.getUTCMinutes() ? iso.slice(0, 16).replace('T', ' ') : iso.slice(0, 10);
}

function xlsxToText(buf) {
  const z = unzip(buf);
  const shared = [];
  const ss = z['xl/sharedStrings.xml'] || '';
  (ss.match(/<si>[\s\S]*?<\/si>/g) || []).forEach(si => {
    shared.push((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(xmlText).join(''));
  });
  const dates = dateStyles(z['xl/styles.xml'] || '');
  const sheets = Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => (+a.match(/(\d+)\.xml$/)[1]) - (+b.match(/(\d+)\.xml$/)[1]));
  const blocks = [];
  sheets.slice(0, 4).forEach(name => {
    const rows = [];
    (z[name].match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) || []).forEach(row => {
      const cells = [];
      (row.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) || []).forEach(c => {
        const head = /^<c ([^>]*)/.exec(c)[1];
        const r = /r="([A-Z]+\d+)"/.exec(head), t = /t="(\w+)"/.exec(head), s = /s="(\d+)"/.exec(head);
        const v = /<v>([\s\S]*?)<\/v>/.exec(c);
        let val = '';
        if (t && t[1] === 's') val = v ? (shared[+v[1]] || '') : '';
        else if (t && t[1] === 'inlineStr') val = (c.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(xmlText).join('');
        else if (v) {
          val = xmlText(v[1]);
          if ((!t || t[1] === 'n') && s && dates[+s[1]] && /^\d+(\.\d+)?$/.test(val)) val = serialToISO(+val);
          else if ((!t || t[1] === 'n') && /^-?\d+\.\d{6,}/.test(val)) val = String(Number(parseFloat(val).toPrecision(12)));
        }
        const i = r ? colIndex(r[1]) : cells.length;
        if (i >= 0 && i < 60) cells[i] = String(val).replace(/[\t\r\n]+/g, ' ').trim();
      });
      const line = Array.from(cells, x => x || '').join('\t').replace(/\t+$/, '');
      if (line.trim()) rows.push(line);
    });
    if (rows.length) blocks.push(rows.join('\n'));
  });
  return blocks.join('\n\n— next sheet —\n\n');
}

/* Several Turkish banks "export to Excel" by sending an HTML table with an
   .xls name. Flatten it to rows. */
function htmlTableToText(s) {
  const rows = [];
  (s.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach(tr => {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [])
      .map(td => xmlText(td.replace(/<br\s*\/?>/gi, ' ')).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    if (cells.some(Boolean)) rows.push(cells.join('\t'));
  });
  return rows.join('\n');
}

function decodeText(buf) {
  const utf8 = buf.toString('utf8');
  if (utf8.indexOf('�') < 0) return utf8.replace(/^﻿/, '');
  for (const enc of ['windows-1254', 'iso-8859-9', 'utf-16le']) {
    try { return new TextDecoder(enc).decode(buf); } catch (e) {}
  }
  return utf8;
}

/* What the model will see: a PDF as a document, everything else as text. */
function prepareStatement(buf, name) {
  const head = buf.slice(0, 8);
  if (head.slice(0, 4).toString('latin1') === '%PDF') return { kind: 'pdf', pdf: buf.toString('base64') };
  if (head[0] === 0x50 && head[1] === 0x4b) {
    let text = '';
    try { text = xlsxToText(buf); } catch (e) { return { error: 'That spreadsheet could not be opened. Save it again as .xlsx or PDF and try once more.' }; }
    if (!text.trim()) return { error: 'That spreadsheet has no rows in it.' };
    return { kind: 'xlsx', text };
  }
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    return { error: 'That is an old-style .xls file, which cannot be read here. Download the statement as PDF, or open it and save it as .xlsx.' };
  }
  const text = decodeText(buf);
  if (/<table[\s>]/i.test(text.slice(0, 200000))) {
    const t = htmlTableToText(text);
    if (t.trim()) return { kind: 'html', text: t };
  }
  if (!text.trim()) return { error: 'That file is empty.' };
  if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 2000))) return { error: 'That file type cannot be read. Use the PDF, Excel or CSV statement from your bank.' };
  return { kind: 'text', text };
}

/* ---- understanding the reply ------------------------------------------- */

const maskNumbers = (s) => String(s || '')
  .replace(/\bTR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi, 'IBAN')
  .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => '••' + m.replace(/\D/g, '').slice(-4));

function cleanRow(r, cats, fallbackCur) {
  if (!Array.isArray(r)) return null;
  const [date, desc, amount, cur, cat, kind] = r;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const a = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(',', '.'));
  if (!Number.isFinite(a) || a === 0) return null;
  const k = STMT_KINDS.indexOf(kind) >= 0 ? kind : (a < 0 ? 'spend' : 'income');
  return {
    date: String(date),
    merchant: maskNumbers(String(desc || '').replace(/\s+/g, ' ').trim()).slice(0, 80) || '—',
    amount: Math.round(a * 100) / 100,
    currency: /^[A-Z]{3}$/.test(String(cur || '')) ? String(cur) : fallbackCur,
    category: cats.indexOf(cat) >= 0 ? cat : 'Other',
    kind: k
  };
}

function parseStatementReply(text, cats, truncated) {
  cats = Array.isArray(cats) && cats.length ? cats : ['Other'];
  const s = String(text || '');
  let obj = null;
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  let partial = false;
  if (!obj) {
    /* A long statement can run out of room mid-reply. Keep every row that
       arrived whole, and say so, rather than throwing the lot away. */
    const rows = [];
    (s.match(/\[\s*"\d{4}-\d{2}-\d{2}"[^\[\]]*\]/g) || []).forEach(m => { try { rows.push(JSON.parse(m)); } catch (e) {} });
    if (!rows.length) return null;
    const meta = {};
    ['bank', 'account', 'currency', 'from', 'to'].forEach(k => {
      const m = new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"').exec(s);
      if (m) meta[k] = m[1];
    });
    obj = Object.assign(meta, { tx: rows });
    partial = true;
  }
  const cur = /^[A-Z]{3}$/.test(String(obj.currency || '')) ? obj.currency : 'TRY';
  const tx = (Array.isArray(obj.tx) ? obj.tx : []).map(r => cleanRow(r, cats, cur)).filter(Boolean);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const dates = tx.map(t => t.date).sort();
  return {
    bank: String(obj.bank || '').slice(0, 60),
    account: maskNumbers(String(obj.account || '')).slice(0, 60),
    currency: cur,
    from: iso(obj.from) || dates[0] || null,
    to: iso(obj.to) || dates[dates.length - 1] || null,
    opening: num(obj.opening), closing: num(obj.closing),
    tx,
    partial: partial || !!truncated
  };
}

/* ---- the job ------------------------------------------------------------ */

async function readStatementJob(job, prep, cats, key) {
  const content = [];
  if (prep.kind === 'pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: prep.pdf } });
  } else {
    let t = maskNumbers(prep.text);          /* IBANs and card numbers never need to leave */
    if (t.length > STMT_MAX_TEXT) { t = t.slice(0, STMT_MAX_TEXT); job.clipped = true; }
    content.push({ type: 'text', text: '<statement format="' + prep.kind + '">\n' + t + '\n</statement>' });
  }
  content.push({ type: 'text', text: 'Categories: ' + JSON.stringify(cats) + '\nToday is ' +
    new Date().toISOString().slice(0, 10) + '. Return the JSON for this statement.' });

  const r = await stmtPost('https://api.anthropic.com/v1/messages', {
    'x-api-key': key, 'anthropic-version': '2023-06-01'
  }, {
    model: CHAT_MODEL,
    max_tokens: 24000,
    system: STMT_SYSTEM,
    messages: [{ role: 'user', content }]
  }, 330000);

  if (r.status === 401 || r.status === 403 || r.status === 404) { logUpstream('statement', r.status); throw new Error(ASSISTANT_UNAVAILABLE); }
  if (r.status === 429) throw new Error('Anthropic is rate-limiting this key. Try again in a minute.');
  if (r.status === 413) throw new Error('That file is too large to read in one go. Try a shorter period.');
  if (r.status < 200 || r.status >= 300) {
    const msg = r.body && r.body.error && r.body.error.message;
    if (/pdf|page|document/i.test(String(msg || ''))) throw new Error('That PDF could not be read (' + String(msg).slice(0, 120) + ').');
    throw new Error('The statement could not be read just now (upstream ' + r.status + ').');
  }
  const parts = (r.body && Array.isArray(r.body.content)) ? r.body.content : [];
  const text = parts.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  const out = parseStatementReply(text, cats, r.body && r.body.stop_reason === 'max_tokens');
  if (!out || !out.tx.length) throw new Error('No transactions were found in that file. Is it a statement or an account history export?');
  if (job.clipped) out.partial = true;
  return out;
}

function sweepJobs() {
  const now = Date.now();
  for (const [id, j] of stmtJobs) if (now - j.at > STMT_JOB_TTL) stmtJobs.delete(id);
}

async function handleStatement(p, req, res, ctx) {
  if (p !== '/api/flow/statement') return false;
  sweepJobs();
  const uid = (ctx.user && ctx.user.id) || 'anon';

  if (req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const j = stmtJobs.get(String(q.get('job') || ''));
    if (!j || j.uid !== uid) { ctx.json(res, 404, { error: 'That reading has expired. Upload the statement again.' }); return true; }
    if (j.status === 'working') { ctx.json(res, 200, { ok: true, status: 'working', seconds: Math.round((Date.now() - j.at) / 1000) }); return true; }
    if (j.status === 'error') { ctx.json(res, 200, { ok: false, status: 'error', error: j.error }); return true; }
    ctx.json(res, 200, Object.assign({ ok: true, status: 'done' }, j.result));
    return true;
  }
  if (req.method !== 'POST') return false;

  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) { ctx.json(res, 503, { error: ASSISTANT_OFF }); return true; }

  const spent = (await ctx.counter.get(stmtCountKey())) || 0;
  if (STMT_DAILY_CAP > 0 && spent >= STMT_DAILY_CAP) {
    ctx.json(res, 429, { error: 'You have read ' + spent + ' statements today. It resets at midnight UTC.', used: spent, cap: STMT_DAILY_CAP });
    return true;
  }

  let body = {};
  try { body = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  const b64 = typeof body.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : '';
  if (!b64) { ctx.json(res, 400, { error: 'No file came through.' }); return true; }
  if (b64.length > Math.ceil(STMT_MAX_BYTES * 4 / 3) + 8) {
    ctx.json(res, 413, { error: 'That file is over 10 MB. Download a shorter period, or the PDF instead of a scan.' }); return true;
  }
  const buf = Buffer.from(b64, 'base64');
  const prep = prepareStatement(buf, String(body.name || ''));
  if (prep.error) { ctx.json(res, 415, { error: prep.error }); return true; }

  const cats = (Array.isArray(body.categories) ? body.categories : [])
    .map(c => String(c || '').trim().slice(0, 40)).filter(Boolean).slice(0, 40);
  if (cats.indexOf('Other') < 0) cats.push('Other');

  const id = crypto.randomBytes(12).toString('hex');
  const job = { uid, status: 'working', at: Date.now() };
  stmtJobs.set(id, job);
  await ctx.counter.set(stmtCountKey(), spent + 1);

  readStatementJob(job, prep, cats, key)
    .then(out => { job.result = Object.assign(out, { kindRead: prep.kind }); job.status = 'done'; })
    .catch(e => { job.status = 'error'; job.error = (e && e.message && e.message.length < 240) ? e.message : 'The statement could not be read just now.'; if (!(e && e.message)) console.error('[flow/statement]', e); });

  ctx.json(res, 202, { ok: true, job: id, kind: prep.kind, used: spent + 1, cap: STMT_DAILY_CAP });
  return true;
}


/* ==========================================================================
 * Event brief — the emails about a calendar event, turned into its plan
 * --------------------------------------------------------------------------
 * The page finds the emails (through the person's own mail connection, with
 * ID numbers and birth dates already taken out) and sends them here with the
 * event. This writes the brief: the timetable day by day, where, what is
 * the person's own part, who to call, and what the emails left unsettled.
 * Only the brief goes back; nothing here is stored. Like the statement
 * reader it runs as a job, because a long thread takes longer to read than
 * a phone holds a request open.
 * ========================================================================== */

const BRIEF_DAILY_CAP = (() => {
  const n = parseInt(process.env.FLOW_BRIEF_DAILY_CAP || '16', 10);
  return Number.isFinite(n) && n >= 0 ? n : 16;
})();
const briefCountKey = () => 'brief:' + new Date().toISOString().slice(0, 10);
const briefJobs = new Map();
let briefPost = (...a) => postJSON(...a);

const BRIEF_SYSTEM = [
  'You write the working brief for ONE calendar event, from the emails about it. The reader is the person whose calendar it is; they will glance at it on their phone on the day.',
  '',
  'Reply with ONE JSON object and nothing else:',
  '{"headline":"","days":[{"date":"YYYY-MM-DD","label":"","items":[{"time":"15:30–16:00","text":"","you":false,"tbc":false}]}],',
  ' "where":[""],"you":[""],"people":[{"name":"","role":"","phone":""}],"open":[""],"warnings":[""]}',
  '',
  '· days: every scheduled item the emails give, grouped by date, in time order. time is "HH:MM–HH:MM", "HH:MM", or "" when the emails give no time. tbc:true when the time or the item is not confirmed. label is a short name for the day ("Arrivals", "Show day").',
  '· you:true on an item that involves the reader personally (they appear by name, nickname or email address — you are told how they are called).',
  '· where: venue, rooms, stage and technical set-up, as short bullets.',
  '· you (the list): the reader\'s own part — what they do, what they bring, their travel and room. Empty if the emails say nothing about them.',
  '· people: organisers and coordinators only, with the phone number the emails give for them. Never list guests\', models\' or attendees\' phone numbers.',
  '· open: questions asked in the emails that no later email answers, things still waiting for approval, and anything the reader must check. Be specific.',
  '· warnings: contradictions between emails (say both versions and which is newer), and changes the reader might have missed (a flight moved, a room changed).',
  '· When information changed, the newest email wins; say what changed.',
  '· Short bullets, at most about 30 words each. Keep people\'s names as written. No ID numbers, passport numbers or birth dates, ever.',
  '· Write in the language you are told to. Dates in "days" are ISO; infer the year from the event.',
  '· If the emails are not about this event at all, reply {"none":true}.'
].join('\n');

function parseBrief(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o; try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  if (o.none) return { none: true };
  const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n || 300) : '');
  const list = (v, n) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, n || 12) : []);
  const days = (Array.isArray(o.days) ? o.days : []).map((d) => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(d && d.date)) ? d.date : '',
    label: str(d && d.label, 40),
    items: (Array.isArray(d && d.items) ? d.items : []).map((i) => ({
      time: str(i && i.time, 24), text: str(i && i.text), you: !!(i && i.you), tbc: !!(i && i.tbc)
    })).filter((i) => i.text).slice(0, 20)
  })).filter((d) => d.items.length).sort((x, y) => String(x.date).localeCompare(String(y.date))).slice(0, 10);
  const people = (Array.isArray(o.people) ? o.people : []).map((p) => ({
    name: str(p && p.name, 80), role: str(p && p.role, 120), phone: str(p && p.phone, 32)
  })).filter((p) => p.name).slice(0, 10);
  const out = { headline: str(o.headline, 160), days, where: list(o.where), you: list(o.you), people, open: list(o.open), warnings: list(o.warnings, 8) };
  if (!out.days.length && !out.where.length && !out.you.length && !out.open.length) return null;
  return out;
}

async function writeBrief(job, body, key) {
  const ev = body.event || {};
  const who = body.me || {};
  const threads = (Array.isArray(body.threads) ? body.threads : []).slice(0, 10);
  let mail = '';
  for (const t of threads) {
    mail += '\n\n### Thread: ' + String(t.subject || '').slice(0, 200) + '\n';
    for (const m of (Array.isArray(t.messages) ? t.messages : []).slice(-40)) {
      mail += '\n--- ' + String(m.date || '').slice(0, 25) + ' · ' + String(m.from || '').slice(0, 120) + '\n' + String(m.text || '').slice(0, 4000) + '\n';
    }
    if (mail.length > 70000) break;
  }
  mail = mail.slice(0, 70000);
  const brief = [
    '# The event',
    'Title: ' + String(ev.title || '').slice(0, 200),
    'When: ' + String(ev.start || '').slice(0, 25) + ' → ' + String(ev.end || '').slice(0, 25) + (ev.allDay ? ' (all day)' : ''),
    'Where: ' + String(ev.location || '').slice(0, 200),
    '',
    '# The reader',
    'Called: ' + [who.name, who.alias, who.email].filter(Boolean).map((x) => String(x).slice(0, 120)).join(' / '),
    'Today is ' + String(body.today || new Date().toISOString().slice(0, 10)).slice(0, 10) + '. Write in: ' + (body.lang === 'tr' ? 'Turkish' : 'English') + '.',
    '',
    '# The emails (newest thread first; quoted history and personal numbers already removed)',
    mail
  ].join('\n');
  const r = await briefPost('https://api.anthropic.com/v1/messages', {
    'x-api-key': key, 'anthropic-version': '2023-06-01'
  }, { model: CHAT_MODEL, max_tokens: 4000, system: BRIEF_SYSTEM, messages: [{ role: 'user', content: brief }] }, 150000);
  if (r.status === 401 || r.status === 403 || r.status === 404) { logUpstream('brief', r.status); throw new Error(ASSISTANT_UNAVAILABLE); }
  if (r.status === 429) throw new Error('Anthropic is rate-limiting this key. Try again in a minute.');
  if (r.status < 200 || r.status >= 300) throw new Error('The brief could not be written just now (upstream ' + r.status + ').');
  const parts = (r.body && Array.isArray(r.body.content)) ? r.body.content : [];
  const out = parseBrief(parts.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n'));
  if (!out) throw new Error('The brief came back in a shape the app could not read. Try Refresh.');
  return out;
}

async function handleBrief(p, req, res, ctx) {
  if (p !== '/api/flow/event-brief') return false;
  const uid = (ctx.user && ctx.user.id) || 'anon';
  const now = Date.now();
  for (const [id, j] of briefJobs) if (now - j.at > 20 * 60 * 1000) briefJobs.delete(id);

  if (req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const j = briefJobs.get(String(q.get('job') || ''));
    if (!j || j.uid !== uid) { ctx.json(res, 404, { error: 'That brief has expired. Try Refresh.' }); return true; }
    if (j.status === 'working') { ctx.json(res, 200, { ok: true, status: 'working' }); return true; }
    if (j.status === 'error') { ctx.json(res, 200, { ok: false, status: 'error', error: j.error }); return true; }
    ctx.json(res, 200, { ok: true, status: 'done', brief: j.result });
    return true;
  }
  if (req.method !== 'POST') return false;
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) { ctx.json(res, 503, { error: ASSISTANT_OFF }); return true; }
  const spent = (await ctx.counter.get(briefCountKey())) || 0;
  if (BRIEF_DAILY_CAP > 0 && spent >= BRIEF_DAILY_CAP) {
    ctx.json(res, 429, { error: 'Today\'s event briefs are used up (' + spent + '). They reset at midnight UTC.', used: spent, cap: BRIEF_DAILY_CAP });
    return true;
  }
  let body = {};
  try { body = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  if (!body.event || !body.event.title) { ctx.json(res, 400, { error: 'No event came through.' }); return true; }
  if (!Array.isArray(body.threads) || !body.threads.length) { ctx.json(res, 400, { error: 'No emails to read.' }); return true; }
  const id = crypto.randomBytes(12).toString('hex');
  const job = { uid, status: 'working', at: now };
  briefJobs.set(id, job);
  await ctx.counter.set(briefCountKey(), spent + 1);
  writeBrief(job, body, key)
    .then((out) => { job.result = out; job.status = 'done'; })
    .catch((e) => { job.status = 'error'; job.error = (e && e.message && e.message.length < 240) ? e.message : 'The brief could not be written just now.'; });
  ctx.json(res, 202, { ok: true, job: id, used: spent + 1, cap: BRIEF_DAILY_CAP });
  return true;
}

/* ==========================================================================
 * Patterns — what the record says about how you actually live
 * --------------------------------------------------------------------------
 * Sits where the habit list sits on Today. Instead of asking the person to
 * tick everything by hand, it reads what is already in their account — Big
 * Rocks and when they get done, habit ticks, sleep, mood and energy,
 * training, the journal, spending, focus time — and writes a few patterns
 * with the numbers behind them, and what to do about them.
 *
 * Same limits as Direction: reads only this account, writes nothing, written
 * once a day and then re-read, capped per day. It runs as a job (POST starts
 * it, GET polls) because a phone does not hold a request open for 20s.
 * ========================================================================== */

/* The API's own reason, short, for a request it refused — so a 400 says why. */
function upstreamWhy(r) {
  try { const m = r && r.body && r.body.error && r.body.error.message; return m ? String(m).replace(/\s+/g, ' ').slice(0, 140) : ''; } catch (e) { return ''; }
}

/* The one upstream refusal the owner can fix in a minute, said plainly. */
function friendlyUpstream(e) {
  const m = (e && e.message) || '';
  if (/credit balance is too low/i.test(m)) return 'The assistant is out of credit. Add credit to the Anthropic account (console.anthropic.com → Plans & Billing), then press Rewrite.';
  return m.length < 260 ? m : '';
}

const PAT_DAILY_CAP = (() => {
  const n = parseInt(process.env.FLOW_PATTERNS_DAILY_CAP || '6', 10);
  return Number.isFinite(n) && n >= 0 ? n : 6;
})();
const patDayKey = () => 'pat:' + new Date().toISOString().slice(0, 10);
const patCountKey = () => 'patn:' + new Date().toISOString().slice(0, 10);
const patJobs = new Map();
let patPost = (...a) => postJSON(...a);

const PAT_SYSTEM = [
  'You write the "Patterns" card on the Today screen of a personal life app called The Flow.',
  'You get ONE person\'s own record, as JSON. Read it for patterns in how they actually live —',
  'not what they planned, what they did: when Big Rocks get done and which ones keep moving,',
  'which habits hold and which drop, sleep (hours, how late they go to bed), mood and energy,',
  'training, how often they write, where money goes and on which days, focus time.',
  '',
  'Return ONLY a JSON object, no prose around it:',
  '{',
  '  "headline": "one sentence, at most 22 words — the single most useful thing the record shows",',
  '  "patterns": [ { "area": "Sleep | Training | Plans | Habits | Money | Writing | Mood | Focus | Work",',
  '                  "text": "one sentence with the number that shows it",',
  '                  "tone": "good | watch | neutral" } ],      // 3 to 5',
  '  "next": [ "a concrete thing to do today or this week" ],   // 2 or 3, each under 18 words',
  '  "missing": "optional: one short line on what is not being logged and would make this better"',
  '}',
  '',
  'Rules:',
  '· Every pattern must come from the data. Quote the number: "4 of your last 6 Big Rocks got done on Tuesday".',
  '· Look across areas — a pattern that connects two of them (late nights before missed training,',
  '  spending that rises in weeks with no plan) is worth more than two separate facts.',
  '· "good" for something holding, "watch" for something slipping, "neutral" for a plain observation.',
  '· Nothing logged in an area is an unknown, not a failure. Do not invent; leave it out or mention it in "missing".',
  '· If there is almost no data, say so in the headline and make "next" about what to start logging.',
  '· Plain words, written to "you". No motivational filler, no therapy-speak, no horoscope.',
  '· Never mention identity numbers, card numbers or anyone\'s private details.'
].join('\n');

function parsePatterns(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o; try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const AREAS = ['Sleep', 'Training', 'Plans', 'Habits', 'Money', 'Writing', 'Mood', 'Focus', 'Work'];
  const patterns = (Array.isArray(o.patterns) ? o.patterns : []).map((x) => {
    const area = str(x && x.area, 20);
    const hit = AREAS.find((A) => A.toLowerCase() === area.toLowerCase());
    const tone = ['good', 'watch', 'neutral'].indexOf(x && x.tone) >= 0 ? x.tone : 'neutral';
    return { area: hit || (area ? area.charAt(0).toUpperCase() + area.slice(1, 18) : 'Pattern'), text: str(x && x.text, 260), tone };
  }).filter((x) => x.text).slice(0, 5);
  const next = (Array.isArray(o.next) ? o.next : []).map((x) => str(x, 160)).filter(Boolean).slice(0, 3);
  const out = { headline: str(o.headline, 200), patterns, next, missing: str(o.missing, 200) };
  if (!out.headline && !out.patterns.length) return null;
  return out;
}

async function buildPatternContext(mine, body) {
  const built = await buildDirectionContext(mine);
  const d = built.data || {};
  const pick = async (k) => { try { return await mine.get(k); } catch (e) { return null; } };
  const out = {
    mission: d.mission || null,
    recentBigRocks: d.recentBigRocks || null,
    weeklyPlansInTheirOwnWords: d.weeklyPlansInTheirOwnWords || null,
    priorities: d.priorities || null,
    metrics: d.metrics || null,
    habits: d.habits || null,
    sleep: d.sleep || null,
    moodAndEnergy: d.moodAndEnergy || null,
    trainingWeeks: d.trainingWeeks || null,
    activityLog: Array.isArray(d.activityLog) ? d.activityLog.slice(-60) : null,
    writtenEntries: Array.isArray(d.writtenEntries)
      ? d.writtenEntries.slice(-12).map((e) => ({ date: e.date || String(e.created || '').slice(0, 10), mood: e.mood, energy: e.energy, words: String(e.body || '').split(/\s+/).filter(Boolean).length, text: String(e.body || '').slice(0, 400) }))
      : null
  };
  /* money: totals by category, by weekday and by week — no merchants' card data */
  const exp = await pick('flow:expenses');
  const fin = await pick('ld_finance');
  const rows = [];
  if (Array.isArray(exp)) exp.forEach((x) => x && rows.push({ date: String(x.date || '').slice(0, 10), amount: Math.abs(+x.amount || 0), cat: x.category || '' }));
  /* the first Finances form: { monthly: { 'YYYY-MM': [{ amt, cat, date }] } } */
  if (fin && fin.monthly && typeof fin.monthly === 'object') Object.keys(fin.monthly).forEach((ym) => (fin.monthly[ym] || []).forEach((x) => {
    if (x) rows.push({ date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || '')) ? x.date : ym + '-01', amount: Math.abs(+x.amt || 0), cat: x.cat || '' });
  }));
  const since = new Date(Date.now() - 56 * 864e5).toISOString().slice(0, 10);
  const recent = rows.filter((r) => r.date >= since && r.amount > 0);
  if (recent.length) {
    const byCat = {}, byDow = {}, byWeek = {};
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const r of recent) {
      byCat[r.cat || 'Other'] = Math.round((byCat[r.cat || 'Other'] || 0) + r.amount);
      const dt = new Date(r.date + 'T12:00:00Z');
      if (!isNaN(dt)) {
        byDow[DOW[dt.getUTCDay()]] = Math.round((byDow[DOW[dt.getUTCDay()]] || 0) + r.amount);
        const wk = isoDay(mondayOf(dt));
        byWeek[wk] = Math.round((byWeek[wk] || 0) + r.amount);
      }
    }
    out.spendingLast8Weeks = { currency: 'TRY', count: recent.length, byCategory: byCat, byWeekday: byDow, byWeek };
  }
  const focus = await pick('flow:focus');
  if (focus) out.focus = Array.isArray(focus) ? focus.slice(-40) : focus;
  /* what only the page knows: Apple Health nights, today's calendar count */
  const extra = (body && typeof body.extra === 'object' && body.extra) || {};
  if (Array.isArray(extra.nights)) out.healthNights = extra.nights.slice(-21);
  if (typeof extra.meetingsToday === 'number') out.meetingsToday = extra.meetingsToday;
  return out;
}

async function writePatterns(body, key, mine) {
  const data = await buildPatternContext(mine, body);
  let snap = JSON.stringify(data);
  if (snap.length > 90000) snap = snap.slice(0, 90000) + '…(truncated)';
  const system = PAT_SYSTEM + '\n\nToday is ' + String(body.today || new Date().toISOString().slice(0, 10)).slice(0, 10) +
    '. Write in ' + (body.lang === 'tr' ? 'Turkish' : 'English') + '.\n\n# The record\n\n' + snap;
  const r = await patPost('https://api.anthropic.com/v1/messages', {
    'x-api-key': key, 'anthropic-version': '2023-06-01'
  }, { model: CHAT_MODEL, max_tokens: 1200, system, messages: [{ role: 'user', content: 'Write today\'s patterns.' }] }, 90000);
  if (r.status === 401 || r.status === 403 || r.status === 404) { logUpstream('patterns', r.status); throw new Error(ASSISTANT_UNAVAILABLE); }
  if (r.status === 429) throw new Error('Anthropic is rate-limiting this key. Try again in a minute.');
  if (r.status < 200 || r.status >= 300) { logUpstream('patterns', r.status, upstreamWhy(r)); throw new Error('Patterns could not be read just now (upstream ' + r.status + (upstreamWhy(r) ? ': ' + upstreamWhy(r) : '') + ').'); }
  const parts = (r.body && Array.isArray(r.body.content)) ? r.body.content : [];
  const out = parsePatterns(parts.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n'));
  if (!out) throw new Error('Patterns came back in a shape the app could not read. Try Rewrite.');
  out.generatedAt = new Date().toISOString();
  return out;
}

async function handlePatterns(p, req, res, ctx) {
  if (p !== '/api/flow/patterns') return false;
  const uid = (ctx.user && ctx.user.id) || 'anon';
  const now = Date.now();
  for (const [id, j] of patJobs) if (now - j.at > 20 * 60 * 1000) patJobs.delete(id);
  if (req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const j = patJobs.get(String(q.get('job') || ''));
    if (!j || j.uid !== uid) { ctx.json(res, 404, { error: 'That read has expired. Try Rewrite.' }); return true; }
    if (j.status === 'working') { ctx.json(res, 200, { ok: true, status: 'working' }); return true; }
    if (j.status === 'error') { ctx.json(res, 200, { ok: false, status: 'error', error: j.error }); return true; }
    ctx.json(res, 200, { ok: true, status: 'done', patterns: j.result });
    return true;
  }
  if (req.method !== 'POST') return false;
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) { ctx.json(res, 503, { error: ASSISTANT_OFF }); return true; }
  let body = {};
  try { body = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  const cached = await ctx.counter.get(patDayKey());
  if (cached && cached.patterns && !body.refresh) { ctx.json(res, 200, { ok: true, status: 'done', cached: true, patterns: cached }); return true; }
  const spent = (await ctx.counter.get(patCountKey())) || 0;
  if (PAT_DAILY_CAP > 0 && spent >= PAT_DAILY_CAP) {
    ctx.json(res, 429, { error: 'Patterns were rewritten ' + spent + ' times today. They reset at midnight UTC.', used: spent, cap: PAT_DAILY_CAP });
    return true;
  }
  const id = crypto.randomBytes(12).toString('hex');
  const job = { uid, status: 'working', at: now };
  patJobs.set(id, job);
  await ctx.counter.set(patCountKey(), spent + 1);
  const counter = ctx.counter;
  writePatterns(body, key, ctx.mine)
    .then(async (out) => { job.result = out; job.status = 'done'; try { await counter.set(patDayKey(), out); } catch (e) {} })
    .catch(async (e) => { job.status = 'error'; job.error = friendlyUpstream(e) || 'Patterns could not be read just now.';
      /* a read that failed did not cost anything, so it does not count */
      try { const n = (await counter.get(patCountKey())) || 0; if (n > 0) await counter.set(patCountKey(), n - 1); } catch (x) {} });
  ctx.json(res, 202, { ok: true, job: id, used: spent + 1, cap: PAT_DAILY_CAP });
  return true;
}

/* ==========================================================================
 * Coming up — the month ahead, read by an assistant
 * --------------------------------------------------------------------------
 * The page gathers what is ahead (calendar events for a month, Big Rocks on
 * coming days, dated tasks) and sends that list — titles, dates, places, not
 * the emails behind them. This writes one line about the stretch ahead and,
 * for the items that need it, what to get ready and by when, plus a few
 * reminders worth setting. Once a day, Rewrite asks again, capped.
 * ========================================================================== */

const AHEAD_DAILY_CAP = (() => {
  const n = parseInt(process.env.FLOW_AHEAD_DAILY_CAP || '8', 10);
  return Number.isFinite(n) && n >= 0 ? n : 8;
})();
const aheadDayKey = () => 'ahead:' + new Date().toISOString().slice(0, 10);
const aheadCountKey = () => 'aheadn:' + new Date().toISOString().slice(0, 10);
const aheadJobs = new Map();
let aheadPost = (...a) => postJSON(...a);

const AHEAD_SYSTEM = [
  'You are the personal assistant behind the "Coming up" card in a life app called The Flow.',
  'You get the person\'s next 30 days as a numbered list — calendar events, Big Rocks (their',
  'own weekly priorities, already placed on a day) and dated tasks — plus their mission and roles.',
  '',
  'Return ONLY a JSON object:',
  '{',
  '  "headline": "one sentence, at most 24 words, about the stretch ahead (busy weeks, a big event, a clash)",',
  '  "prep": [ { "ref": <number from the list>, "what": "what to get ready, under 14 words", "by": "YYYY-MM-DD" } ],  // 0 to 6',
  '  "watch": [ "a clash, a crowded day or something easy to forget, under 20 words" ],                           // 0 to 3',
  '  "remind": [ { "ref": <number>, "at": "YYYY-MM-DDTHH:MM", "why": "under 10 words" } ]                          // 0 to 5',
  '}',
  '',
  'Rules:',
  '· Only things in the list. Never invent events, people, flights or places.',
  '· prep is for items that need something done before them: travel, a performance, a deadline,',
  '  a meeting that needs material. Not for a routine call. "by" is before the item, never after.',
  '· remind times are in the person\'s local time, at a sensible hour (08:00–21:00), before the item.',
  '· Plain, short, specific. No filler, no motivational lines.'
].join('\n');

function parseAhead(text, n) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o; try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  const str = (v, k) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, k) : '');
  const refOk = (r) => Number.isInteger(r) && r >= 0 && r < (n || 0);
  const prep = (Array.isArray(o.prep) ? o.prep : []).map((x) => ({
    ref: x && +x.ref, what: str(x && x.what, 140), by: /^\d{4}-\d{2}-\d{2}$/.test(String(x && x.by)) ? x.by : ''
  })).filter((x) => refOk(x.ref) && x.what).slice(0, 6);
  const remind = (Array.isArray(o.remind) ? o.remind : []).map((x) => ({
    ref: x && +x.ref, at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(x && x.at)) ? x.at : '', why: str(x && x.why, 80)
  })).filter((x) => refOk(x.ref) && x.at).slice(0, 5);
  const out = { headline: str(o.headline, 200), prep, watch: (Array.isArray(o.watch) ? o.watch : []).map((x) => str(x, 160)).filter(Boolean).slice(0, 3), remind };
  if (!out.headline && !out.prep.length && !out.watch.length) return null;
  return out;
}

function aheadList(items) {
  return (Array.isArray(items) ? items : []).slice(0, 80).map((x, i) => {
    const bits = [String(x.date || '').slice(0, 10)];
    if (x.time) bits.push(String(x.time).slice(0, 5));
    else if (x.allDay) bits.push('all day');
    if (x.hours) bits.push(Math.round(+x.hours * 10) / 10 + 'h');
    bits.push(String(x.kind || 'event').slice(0, 10));
    return i + '. [' + bits.join(' · ') + '] ' + String(x.title || '').slice(0, 160) + (x.where ? ' — ' + String(x.where).slice(0, 100) : '');
  }).join('\n');
}

async function writeAhead(body, key, mine) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 80) : [];
  let mission = null, roles = null;
  try { const c = await mine.get('ld_compass'); if (c && typeof c === 'object') { mission = c.mission || null; roles = c.roles || null; } } catch (e) {}
  const system = AHEAD_SYSTEM + '\n\nToday is ' + String(body.today || new Date().toISOString().slice(0, 10)).slice(0, 10) +
    '. Write in ' + (body.lang === 'tr' ? 'Turkish' : 'English') + '.' +
    (mission ? '\n\n# Their mission\n' + String(mission).slice(0, 1200) : '') +
    (roles ? '\n\n# Their roles\n' + JSON.stringify(roles).slice(0, 600) : '');
  const r = await aheadPost('https://api.anthropic.com/v1/messages', {
    'x-api-key': key, 'anthropic-version': '2023-06-01'
  }, { model: CHAT_MODEL, max_tokens: 1200, system, messages: [{ role: 'user', content: '# The next 30 days\n\n' + aheadList(items) }] }, 90000);
  if (r.status === 401 || r.status === 403 || r.status === 404) { logUpstream('ahead', r.status); throw new Error(ASSISTANT_UNAVAILABLE); }
  if (r.status === 429) throw new Error('Anthropic is rate-limiting this key. Try again in a minute.');
  if (r.status < 200 || r.status >= 300) { logUpstream('ahead', r.status, upstreamWhy(r)); throw new Error('Coming up could not be read just now (upstream ' + r.status + (upstreamWhy(r) ? ': ' + upstreamWhy(r) : '') + ').'); }
  const parts = (r.body && Array.isArray(r.body.content)) ? r.body.content : [];
  const out = parseAhead(parts.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n'), items.length);
  if (!out) throw new Error('The read came back in a shape the app could not use. Try Rewrite.');
  out.generatedAt = new Date().toISOString();
  out.sig = String(body.sig || '').slice(0, 200);
  return out;
}

async function handleAhead(p, req, res, ctx) {
  if (p !== '/api/flow/ahead') return false;
  const uid = (ctx.user && ctx.user.id) || 'anon';
  const now = Date.now();
  for (const [id, j] of aheadJobs) if (now - j.at > 20 * 60 * 1000) aheadJobs.delete(id);
  if (req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const j = aheadJobs.get(String(q.get('job') || ''));
    if (!j || j.uid !== uid) { ctx.json(res, 404, { error: 'That read has expired. Try Rewrite.' }); return true; }
    if (j.status === 'working') { ctx.json(res, 200, { ok: true, status: 'working' }); return true; }
    if (j.status === 'error') { ctx.json(res, 200, { ok: false, status: 'error', error: j.error }); return true; }
    ctx.json(res, 200, { ok: true, status: 'done', ahead: j.result });
    return true;
  }
  if (req.method !== 'POST') return false;
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) { ctx.json(res, 503, { error: ASSISTANT_OFF }); return true; }
  let body = {};
  try { body = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
  if (!Array.isArray(body.items) || !body.items.length) { ctx.json(res, 400, { error: 'Nothing coming up to read.' }); return true; }
  /* The day's read is kept — unless what is ahead changed since (sig). */
  const cached = await ctx.counter.get(aheadDayKey());
  if (cached && cached.headline != null && !body.refresh && cached.sig === String(body.sig || '').slice(0, 200)) {
    ctx.json(res, 200, { ok: true, status: 'done', cached: true, ahead: cached }); return true;
  }
  const spent = (await ctx.counter.get(aheadCountKey())) || 0;
  if (AHEAD_DAILY_CAP > 0 && spent >= AHEAD_DAILY_CAP) {
    if (cached && cached.headline != null) { ctx.json(res, 200, { ok: true, status: 'done', cached: true, stale: true, ahead: cached }); return true; }
    ctx.json(res, 429, { error: 'Coming up was read ' + spent + ' times today. It resets at midnight UTC.', used: spent, cap: AHEAD_DAILY_CAP });
    return true;
  }
  const id = crypto.randomBytes(12).toString('hex');
  const job = { uid, status: 'working', at: now };
  aheadJobs.set(id, job);
  await ctx.counter.set(aheadCountKey(), spent + 1);
  const counter = ctx.counter;
  writeAhead(body, key, ctx.mine)
    .then(async (out) => { job.result = out; job.status = 'done'; try { await counter.set(aheadDayKey(), out); } catch (e) {} })
    .catch(async (e) => { job.status = 'error'; job.error = friendlyUpstream(e) || 'Coming up could not be read just now.';
      try { const n = (await counter.get(aheadCountKey())) || 0; if (n > 0) await counter.set(aheadCountKey(), n - 1); } catch (x) {} });
  ctx.json(res, 202, { ok: true, job: id, used: spent + 1, cap: AHEAD_DAILY_CAP });
  return true;
}

/* Chain the handlers. */
const _prices = module.exports.handle;
module.exports.handle = async function (p, req, res, ctx) {
  if (await _prices(p, req, res, ctx)) return true;
  if (await handleChat(p, req, res, ctx)) return true;
  if (await handleChatStream(p, req, res, ctx)) return true;
  if (await handleDirection(p, req, res, ctx)) return true;
  if (await handlePlanWeek(p, req, res, ctx)) return true;
  if (await handleStatement(p, req, res, ctx)) return true;
  if (await handleBrief(p, req, res, ctx)) return true;
  if (await handlePatterns(p, req, res, ctx)) return true;
  if (await handleAhead(p, req, res, ctx)) return true;
  return false;
};
module.exports._internals.parsePlan = parsePlan;
module.exports._internals.PLAN_SYSTEM = PLAN_SYSTEM;
module.exports._internals.buildContext = buildContext;
module.exports._internals.SYSTEM = SYSTEM;
module.exports._internals.chatConfig = () => ({ model: CHAT_MODEL, cap: CHAT_DAILY_CAP, maxContext: CHAT_MAX_CONTEXT });
module.exports._internals.sunSign = sunSign;
module.exports._internals.rollUpMetrics = rollUpMetrics;
module.exports._internals.recentPlans = recentPlans;
module.exports._internals.parseDirection = parseDirection;
module.exports._internals.buildDirectionContext = buildDirectionContext;
module.exports._internals.directionConfig = () => ({ cap: DIR_DAILY_CAP });
module.exports._internals.postStream = postStream;
module.exports._internals.sseFrames = sseFrames;
module.exports._internals.systemBlocks = systemBlocks;
module.exports._internals.statement = {
  prepareStatement, xlsxToText, htmlTableToText, parseStatementReply, maskNumbers, decodeText,
  jobs: stmtJobs, config: () => ({ cap: STMT_DAILY_CAP, maxBytes: STMT_MAX_BYTES }),
  handle: handleStatement, STMT_SYSTEM,
  setPoster(fn) { stmtPost = fn || ((...a) => postJSON(...a)); }
};
module.exports._internals.brief = {
  parseBrief, handle: handleBrief, BRIEF_SYSTEM, jobs: briefJobs,
  setPoster(fn) { briefPost = fn || ((...a) => postJSON(...a)); }
};
module.exports._internals.patterns = {
  parsePatterns, buildPatternContext, PAT_SYSTEM, jobs: patJobs,
  setPoster(fn) { patPost = fn || ((...a) => postJSON(...a)); }
};
module.exports._internals.ahead = {
  parseAhead, aheadList, AHEAD_SYSTEM, jobs: aheadJobs,
  setPoster(fn) { aheadPost = fn || ((...a) => postJSON(...a)); }
};
module.exports._internals.wellFormed = wellFormed;
