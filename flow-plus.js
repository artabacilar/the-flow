'use strict';
/* ==========================================================================
 * flow-plus.js — the plan on the account, and the shop that sets it
 * --------------------------------------------------------------------------
 * The Flow has two tiers. Free is the planner: Today, the week, habits,
 * the journal, everything a person types in — theirs, for good. Plus is the
 * reading: Patterns every morning, Coming up's prep and reminders, Ask,
 * Direction, statements and briefs, and the connections that cost money per
 * use. The line is drawn where the server spends: every Plus feature is one
 * that calls a model or a third party on the person's behalf.
 *
 * Three things this file decides, and nothing else in the app has to:
 *
 *   1. Who is on which plan. `planOf(user)` is the only answer. The owner is
 *      Plus for good. Every account created before FLOW_PLUS_LAUNCH is Plus
 *      for good too — the people who were here before there was a price are
 *      not sent a bill. Anyone newer is Free until a shop says otherwise.
 *
 *   2. Where the plan lives. `__plus:plan:<uid>` in the raw store, beside the
 *      auth keys and deliberately outside the account's own namespace: the
 *      browser can read and write its namespace through /api/get and
 *      /api/set, and a plan a browser could write is not a plan.
 *
 *   3. What a shop may say. Stripe (web) and RevenueCat (App Store, Play)
 *      talk to this server through signed webhooks; a webhook without a
 *      valid signature changes nothing. Both shops are optional: with no
 *      keys in the environment the plan endpoint still answers, the checkout
 *      says "not switched on yet", and nothing else in the app is affected.
 *
 * Nothing here is reachable from the browser except through flow-auth.js,
 * which hands this module a signed-in user and a reader locked to that
 * account.
 * ======================================================================== */
const crypto = require('crypto');

const LAUNCH = process.env.FLOW_PLUS_LAUNCH || '2026-11-01';          /* accounts created before this: Plus for good */
const PRICE_MONTHLY = process.env.FLOW_PLUS_MONTHLY || '$9.99';
const PRICE_YEARLY = process.env.FLOW_PLUS_YEARLY || '$79.99';
const TRIAL_DAYS = Math.max(0, parseInt(process.env.FLOW_PLUS_TRIAL_DAYS || '14', 10) || 0);
const GRACE_DAYS = 3;                                                 /* a failed card is not an instant lockout */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WH = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICES = { monthly: process.env.STRIPE_PRICE_MONTHLY || '', yearly: process.env.STRIPE_PRICE_YEARLY || '' };
const RC_AUTH = process.env.REVENUECAT_WEBHOOK_AUTH || '';

const KEY = (uid) => '__plus:plan:' + uid;
const STATS = (day) => '__stats:' + day;
const TRACKED = ['app_open', 'first_run_done', 'rock_added', 'rock_done', 'replan_preview', 'replan_accepted', 'replan_undone', 'triage_done', 'review_completed', 'plus_sheet', 'checkout_started', 'share_read', 'evening_on', 'entitlement_changed', 'meal_logged', 'habit_done_here'];
const CUST = (cid) => '__plus:cust:' + cid;

/* Everything a Free account may not ask the server to do. Patterns and chat
   are not here: they have a small free allowance, handled where they live. */
const PLUS_ONLY = {
  '/api/flow/direction': 'direction',
  '/api/flow/plan-week': 'plan-week',
  '/api/flow/statement': 'statement',
  '/api/flow/event-brief': 'brief',
  '/api/flow/ahead': 'ahead'
};
/* The free allowances, per ISO week. */
const FREE = { patterns: 1, chat: 5 };

const stripeReady = () => !!(STRIPE_KEY && STRIPE_PRICES.monthly && STRIPE_PRICES.yearly);

/* ---- the plan ---------------------------------------------------------- */
function founders(user) {
  if (!user) return null;
  if (user.owner) return { tier: 'plus', source: 'founder', until: null };
  const made = String(user.created || '').slice(0, 10);
  if (made && made < LAUNCH) return { tier: 'plus', source: 'early', until: null };
  return null;
}

async function planOf(user, deps) {
  const f = founders(user);
  if (f) return f;
  const rec = (await deps.getJSON(KEY(user.id), null)) || null;
  if (rec && rec.tier === 'plus' && (!rec.until || Date.parse(rec.until) > Date.now())) {
    return { tier: 'plus', source: rec.source || 'stripe', until: rec.until || null, ends: !!rec.ends, customer: rec.customer || null };
  }
  return { tier: 'free', source: null, until: null, lapsed: rec && rec.until ? rec.until : null, customer: (rec && rec.customer) || null };
}

const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0');
};

/* The body of every refusal, so the client can tell "needs Plus" from
   "broken" with one check. */
function refusal(feature, extra) {
  return Object.assign({ error: 'This is part of Flow Plus.', plus: true, feature }, extra || {});
}

async function countChange(uid, deps) {
  try {
    const key = STATS(new Date().toISOString().slice(0, 10));
    const rec = (await deps.getJSON(key, null)) || {};
    const slot = rec.entitlement_changed || (rec.entitlement_changed = { n: 0, s: 0, u: [] });
    const h = crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 10);
    if (slot.u.indexOf(h) < 0) { slot.u.push(h); slot.n = slot.u.length; }
    await deps.setJSON(key, rec);
  } catch (e) {}
}

/* ---- Stripe, without an SDK ------------------------------------------- */
let fetchFn = (url, opts) => fetch(url, opts);
async function stripe(path, form) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const r = await fetchFn('https://api.stripe.com/v1' + path, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('Stripe said ' + r.status));
  return j;
}

function stripeSigned(rawBody, header, secret, now) {
  if (!secret || !header) return false;
  const parts = {}; String(header).split(',').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(((now || Date.now()) / 1000) - Number(t)) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(v1)); } catch (e) { return false; }
}

const plusUntil = (unixSeconds) => unixSeconds ? new Date(unixSeconds * 1000 + GRACE_DAYS * 864e5).toISOString() : null;

async function applyStripe(ev, deps) {
  const o = (ev && ev.data && ev.data.object) || {};
  const type = String(ev && ev.type || '');
  if (type === 'checkout.session.completed') {
    const uid = o.client_reference_id || (o.metadata && o.metadata.uid);
    if (!uid || o.mode !== 'subscription') return { ignored: type };
    const prev = (await deps.getJSON(KEY(uid), null)) || {};
    await deps.setJSON(KEY(uid), Object.assign({}, prev, { tier: 'plus', source: 'stripe', customer: o.customer || prev.customer || null, subscription: o.subscription || null, plan: (o.metadata && o.metadata.plan) || prev.plan || null, until: prev.until || null, ends: false, at: new Date().toISOString() }));
    if (o.customer) await deps.setJSON(CUST(o.customer), { uid });
    return { uid, tier: 'plus' };
  }
  if (/^customer\.subscription\.(created|updated|deleted)$/.test(type)) {
    let uid = o.metadata && o.metadata.uid;
    if (!uid && o.customer) { const c = await deps.getJSON(CUST(o.customer), null); uid = c && c.uid; }
    if (!uid) return { ignored: type, reason: 'no uid' };
    const prev = (await deps.getJSON(KEY(uid), null)) || {};
    const alive = type !== 'customer.subscription.deleted' && ['trialing', 'active', 'past_due'].indexOf(o.status) >= 0;
    const rec = Object.assign({}, prev, {
      tier: alive ? 'plus' : 'free', source: 'stripe',
      customer: o.customer || prev.customer || null, subscription: o.id || prev.subscription || null,
      status: o.status || (alive ? 'active' : 'canceled'),
      until: alive ? plusUntil(o.current_period_end) : new Date().toISOString(),
      ends: !!o.cancel_at_period_end, at: new Date().toISOString()
    });
    await deps.setJSON(KEY(uid), rec);
    if (o.customer) await deps.setJSON(CUST(o.customer), { uid });
    await countChange(uid, deps);
    return { uid, tier: rec.tier };
  }
  return { ignored: type };
}

/* ---- RevenueCat (App Store and Play) ----------------------------------- */
async function applyRevenueCat(body, deps) {
  const ev = (body && body.event) || {};
  const uid = String(ev.app_user_id || '');
  if (!uid || /^\$RCAnonymousID/.test(uid)) return { ignored: ev.type || 'no event', reason: 'no uid' };
  const type = String(ev.type || '');
  const prev = (await deps.getJSON(KEY(uid), null)) || {};
  const store = /PLAY/i.test(String(ev.store || '')) ? 'google' : 'apple';
  const exp = ev.expiration_at_ms ? new Date(Number(ev.expiration_at_ms) + GRACE_DAYS * 864e5).toISOString() : null;
  let rec = null;
  if (['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE', 'BILLING_ISSUE', 'TRANSFER'].indexOf(type) >= 0) {
    rec = Object.assign({}, prev, { tier: 'plus', source: store, until: exp, ends: false, product: ev.product_id || prev.product || null, status: type.toLowerCase(), at: new Date().toISOString() });
  } else if (type === 'CANCELLATION') {
    /* Auto-renew switched off; the paid time still runs out on its own. */
    rec = Object.assign({}, prev, { tier: 'plus', source: store, until: exp || prev.until || null, ends: true, status: 'cancellation', at: new Date().toISOString() });
  } else if (type === 'EXPIRATION') {
    rec = Object.assign({}, prev, { tier: 'free', source: store, until: new Date().toISOString(), ends: true, status: 'expiration', at: new Date().toISOString() });
  } else {
    return { ignored: type };
  }
  await deps.setJSON(KEY(uid), rec);
  await countChange(uid, deps);
  return { uid, tier: rec.tier };
}

/* ---- the endpoints ----------------------------------------------------- */
/* Public: the shops call these. Returns true when the path was one of them. */
async function webhooks(p, req, res, deps) {
  if (p === '/api/plus/webhook/stripe') {
    if (req.method !== 'POST') { deps.json(res, 405, { error: 'POST' }); return true; }
    const body = await deps.readBody(req);
    if (!STRIPE_WH || !stripeSigned(body, req.headers['stripe-signature'], STRIPE_WH)) { deps.json(res, 400, { error: 'Bad signature.' }); return true; }
    let ev = {}; try { ev = JSON.parse(body); } catch (e) { deps.json(res, 400, { error: 'Bad JSON.' }); return true; }
    const out = await applyStripe(ev, deps);
    deps.json(res, 200, Object.assign({ received: true }, out));
    return true;
  }
  if (p === '/api/plus/webhook/revenuecat') {
    if (req.method !== 'POST') { deps.json(res, 405, { error: 'POST' }); return true; }
    const auth = String(req.headers.authorization || '');
    if (!RC_AUTH || auth !== RC_AUTH) { deps.json(res, 401, { error: 'Not authorised.' }); return true; }
    let b = {}; try { b = JSON.parse(await deps.readBody(req)); } catch (e) { deps.json(res, 400, { error: 'Bad JSON.' }); return true; }
    const out = await applyRevenueCat(b, deps);
    deps.json(res, 200, Object.assign({ received: true }, out));
    return true;
  }
  return false;
}

/* Signed in: the plan, the checkout, the portal, the export. */
async function handle(p, req, res, ctx) {
  const me = ctx.user;
  if (p === '/api/flow/plan' && req.method === 'GET') {
    const plan = await planOf(me, ctx);
    ctx.json(res, 200, {
      ok: true, tier: plan.tier, source: plan.source, until: plan.until, ends: !!plan.ends, lapsed: plan.lapsed || null,
      prices: { monthly: PRICE_MONTHLY, yearly: PRICE_YEARLY }, trialDays: TRIAL_DAYS,
      checkout: stripeReady(), portal: !!(plan.customer && STRIPE_KEY),
      free: FREE, launch: LAUNCH
    });
    return true;
  }
  if (p === '/api/flow/plan/checkout' && req.method === 'POST') {
    if (!stripeReady()) { ctx.json(res, 503, { error: 'Subscriptions are not switched on yet.' }); return true; }
    const plan = await planOf(me, ctx);
    if (plan.tier === 'plus') { ctx.json(res, 409, { error: 'You already have Plus.' }); return true; }
    let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
    const which = b.plan === 'monthly' ? 'monthly' : 'yearly';
    const origin = String(b.origin || '').replace(/[^\w:./-]/g, '').replace(/\/$/, '') || '';
    const form = {
      mode: 'subscription',
      'line_items[0][price]': STRIPE_PRICES[which], 'line_items[0][quantity]': '1',
      client_reference_id: me.id, customer_email: me.email,
      'metadata[uid]': me.id, 'metadata[plan]': which,
      'subscription_data[metadata][uid]': me.id, 'subscription_data[metadata][plan]': which,
      allow_promotion_codes: 'true',
      success_url: origin + '/?plus=welcome', cancel_url: origin + '/?plus=later'
    };
    if (which === 'yearly' && TRIAL_DAYS > 0 && !plan.lapsed) form['subscription_data[trial_period_days]'] = String(TRIAL_DAYS);
    if (plan.customer) { form.customer = plan.customer; delete form.customer_email; }
    try { const s = await stripe('/checkout/sessions', form); ctx.json(res, 200, { ok: true, url: s.url }); }
    catch (e) { ctx.json(res, 502, { error: 'The checkout could not be opened: ' + (e.message || 'unknown') }); }
    return true;
  }
  if (p === '/api/flow/plan/portal' && req.method === 'POST') {
    const plan = await planOf(me, ctx);
    if (!plan.customer || !STRIPE_KEY) { ctx.json(res, 404, { error: 'There is no web subscription to manage on this account.' }); return true; }
    let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
    const origin = String(b.origin || '').replace(/[^\w:./-]/g, '').replace(/\/$/, '') || '';
    try { const s = await stripe('/billing_portal/sessions', { customer: plan.customer, return_url: origin + '/?go=settings' }); ctx.json(res, 200, { ok: true, url: s.url }); }
    catch (e) { ctx.json(res, 502, { error: 'The billing page could not be opened: ' + (e.message || 'unknown') }); }
    return true;
  }
  /* ---- counts, never content ----
     A dozen named moments per day, counted once per account. The owner reads
     them back as numbers: how many people opened the app, planned, replanned,
     reviewed, looked at Plus. Nothing a person typed ever reaches here. */
  if (p === '/api/flow/track' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
    const ev = String(b.e || '');
    if (TRACKED.indexOf(ev) < 0) { ctx.json(res, 400, { error: 'Not a tracked event.' }); return true; }
    const look = b.look === 's' ? 's' : 'a';
    const day = new Date().toISOString().slice(0, 10);
    const key = STATS(day);
    const rec = (await ctx.getJSON(key, null)) || {};
    const slot = rec[ev] || (rec[ev] = { n: 0, s: 0, u: [] });
    const h = crypto.createHash('sha256').update(String(me.id)).digest('hex').slice(0, 10);
    if (slot.u.indexOf(h) < 0 && slot.u.length < 20000) { slot.u.push(h); slot.n = slot.u.length; if (look === 's') slot.s++; }
    await ctx.setJSON(key, rec);
    ctx.json(res, 200, { ok: true });
    return true;
  }
  if (p === '/api/flow/stats' && req.method === 'GET') {
    if (!me.owner) { ctx.json(res, 403, { error: 'Only the owner reads the counts.' }); return true; }
    const days = Math.min(90, Math.max(1, parseInt(new URL(req.url, 'http://x').searchParams.get('days') || '30', 10) || 30));
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const rec = (await ctx.getJSON(STATS(d), null)) || {};
      const row = { day: d };
      Object.keys(rec).forEach((k) => { row[k] = { people: rec[k].n || 0, simple: rec[k].s || 0 }; });
      out.push(row);
    }
    ctx.json(res, 200, { ok: true, events: TRACKED, days: out });
    return true;
  }
  if (p === '/api/flow/account/export' && req.method === 'GET') {
    /* Everything the account holds, as one file. Free or Plus: what people
       type in is theirs, and taking it with them must never need a plan. */
    const all = await ctx.mine.all();
    const out = {};
    Object.keys(all).forEach((k) => { let v = all[k]; if (typeof v === 'string') { const t = v.trim(); if (t && (t[0] === '{' || t[0] === '[')) { try { v = JSON.parse(t); } catch (e) {} } } out[k] = v; });
    const body = JSON.stringify({ app: 'The Flow', exported: new Date().toISOString(), account: { email: me.email, name: me.name }, data: out }, null, 1);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="the-flow-export.json"', 'Cache-Control': 'no-store' });
    res.end(body);
    return true;
  }
  return false;
}

module.exports = {
  handle, webhooks, planOf, refusal, isoWeek,
  PLUS_ONLY, FREE, LAUNCH, TRIAL_DAYS,
  _internals: { stripeSigned, applyStripe, applyRevenueCat, founders, KEY, CUST, setFetcher(fn) { fetchFn = fn || ((u, o) => fetch(u, o)); } }
};
