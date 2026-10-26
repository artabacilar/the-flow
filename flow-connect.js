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
 *   GOOGLE_CLIENT_SECRET  only for Google Calendar and Gmail, which need a
 *                         token kept and refreshed (the profile does not)
 *
 *   MS_CLIENT_ID          Outlook: an Azure app registration ("personal and
 *   MS_CLIENT_SECRET      work accounts"), Web redirect
 *                         https://<host>/api/connect/outlook/callback
 *   MS_REDIRECT_URI       optional, as for Google
 *
 * Fathom and Notion need nothing here: each person pastes a key made in
 * that app, verified on the spot and kept server-side.
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
  },

  /* Calendar and Gmail need more than who somebody is: an access token, kept
     and refreshed, because they are read again later without the person
     there. That is the authorisation-code flow, and trading a code needs the
     client secret — so these two are listed but not offered until
     GOOGLE_CLIENT_SECRET is set. They come back through Google's registered
     callback (`via`), so no second redirect URI has to be added to the
     client. */
  gcal: {
    id: 'gcal',
    kind: 'oauth',
    via: 'google',
    name: 'Google Calendar',
    blurb: 'Today\u2019s meetings on your Today screen, next to your Big Rocks.',
    clientId: () => process.env.GOOGLE_CLIENT_ID || '',
    secret: () => process.env.GOOGLE_CLIENT_SECRET || '',
    fixedRedirect: () => process.env.GOOGLE_REDIRECT_URI || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
    need: 'https://www.googleapis.com/auth/calendar.readonly',
    needWhy: 'Tick the box that lets The Flow see your calendar, then try again.',
    extra: { response_type: 'code', access_type: 'offline', prompt: 'consent select_account' },
    finish: finishCode,
    actions: { events: gcalEvents }
  },
  gmail: {
    id: 'gmail',
    kind: 'oauth',
    via: 'google',
    name: 'Gmail',
    blurb: 'Emails you star become Big Rocks. For big calendar events, the emails about them are read to write a brief on Today.',
    clientId: () => process.env.GOOGLE_CLIENT_ID || '',
    secret: () => process.env.GOOGLE_CLIENT_SECRET || '',
    fixedRedirect: () => process.env.GOOGLE_REDIRECT_URI || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://www.googleapis.com/auth/gmail.readonly',
    need: 'https://www.googleapis.com/auth/gmail.readonly',
    needWhy: 'Tick the box that lets The Flow read your email, then try again.',
    extra: { response_type: 'code', access_type: 'offline', prompt: 'consent select_account' },
    finish: finishCode,
    actions: { starred: gmailStarred, related: gmailRelated }
  },

  /* Outlook and Microsoft 365, through Microsoft Graph: personal and work
     accounts alike (the "common" endpoint). One connection covers the
     calendar and flagged mail, because Microsoft asks once for both. It has
     its own registered callback, unlike Calendar and Gmail. */
  outlook: {
    id: 'outlook',
    kind: 'oauth',
    name: 'Outlook',
    blurb: 'Your Outlook calendar on Today; flagged emails as Big Rocks; a brief for big events from the emails about them.',
    clientId: () => process.env.MS_CLIENT_ID || '',
    secret: () => process.env.MS_CLIENT_SECRET || '',
    fixedRedirect: () => process.env.MS_REDIRECT_URI || '',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email profile offline_access User.Read Calendars.Read Mail.Read',
    need: ['calendars.read', 'mail.read'],
    needWhy: 'Allow The Flow to read your calendar and mail, then try again.',
    extra: { response_type: 'code', response_mode: 'query', prompt: 'select_account' },
    finish: finishCode,
    actions: { events: outlookEvents, flagged: outlookFlagged, related: outlookRelated }
  },

  /* Fathom and Notion are connected with a key the person makes in that
     app and pastes here, once. Neither offers sign-in without a secret of
     our own, and a personal key is what both document for one person's
     use. The key is kept server-side and never handed back to the page. */
  fathom: {
    id: 'fathom',
    kind: 'key',
    name: 'Fathom',
    blurb: 'Meeting summaries in your Journal; action items as Big Rocks.',
    keyLabel: 'Fathom API key',
    keyHelp: 'In Fathom: Settings \u2192 API Access \u2192 Generate API key. Copy it and paste it here.',
    keyUrl: 'https://fathom.video/customize#api-access-header',
    verify: verifyFathom,
    actions: { meetings: fathomMeetings }
  },
  notion: {
    id: 'notion',
    kind: 'key',
    name: 'Notion',
    blurb: 'Send your week \u2014 Big Rocks and journal \u2014 to a Notion page.',
    keyLabel: 'Notion integration secret',
    keyHelp: 'In Notion: Settings \u2192 Connections \u2192 Develop or manage integrations \u2192 New integration (Internal). Copy its secret and paste it here, then open the Notion page you want and add the integration under \u2026 \u2192 Connections.',
    keyUrl: 'https://www.notion.so/profile/integrations',
    verify: verifyNotion,
    actions: { pages: notionPages, target: notionTarget, send: notionSend },
    oneAccount: ['pages', 'target', 'send']
  }
};

const kindOf = (pv) => pv.kind || 'oauth';
const configured = (pv) => {
  if (!pv) return false;
  if (kindOf(pv) === 'key') return true;
  return !!(pv.clientId() && (!pv.secret || pv.secret()));
};

function redirectFor(pv, req) {
  if (pv.fixedRedirect()) return pv.fixedRedirect();
  /* Behind Render's proxy the request is plain HTTP and the scheme only
     survives in the forwarded header. A guessed http:// would not match the
     registered redirect and Google would refuse it. */
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return proto + '://' + host + '/api/connect/' + (pv.via || pv.id) + '/callback';
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
 * Google, with a token: Calendar and Gmail
 * ------------------------------------------------------------------ */

class Refused extends Error {}

async function finishCode(pv, posted, rec, deps) {
  const f = deps.fetch || fetch;
  const res = await f(pv.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(posted.code || ''), client_id: pv.clientId(), client_secret: pv.secret(),
      redirect_uri: rec.redirect, grant_type: 'authorization_code'
    }).toString()
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('the code was not accepted (' + (j.error || res.status) + ')');
  /* Google lets people untick a permission on the consent screen. A token
     without the one this connection exists for is not a connection. */
  const granted = String(j.scope || '').toLowerCase().split(/\s+/).filter(Boolean);
  const needs = (Array.isArray(pv.need) ? pv.need : [pv.need]).map((x) => String(x).toLowerCase());
  const has = (n) => granted.some((g) => g === n || g.endsWith('/' + n));
  if (!needs.every(has)) throw new Refused(pv.needWhy);
  /* This ID token came straight from Google's token endpoint over TLS, in
     answer to our own client secret — OpenID Connect lets it be read
     without checking the signature again. Only the address is taken. */
  let claims = {};
  try { claims = JSON.parse(unb64(String(j.id_token || '').split('.')[1] || '').toString('utf8')); } catch (e) {}
  const now = deps.now || Date.now();
  /* Google says sub and email; Microsoft says oid, and the address may only
     be in preferred_username (a work sign-in name is an address). */
  const email = claims.email_verified === false ? '' :
    String(claims.email || (/@/.test(String(claims.preferred_username || '')) ? claims.preferred_username : '') || '');
  return {
    account: String(claims.oid || claims.sub || ''),
    email,
    name: String(claims.name || ''), photo: null,
    tok: { access: j.access_token, refresh: j.refresh_token || null, exp: now + (Number(j.expires_in) || 3600) * 1000 }
  };
}

/* A current access token, refreshed when it is within a minute of expiry.
   A refresh Google refuses means the person revoked access in their Google
   account: the connection is marked so the page can say "reconnect". */
async function accessToken(pv, rec, ctx) {
  const now = ctx.now || Date.now();
  const t = rec.tok || {};
  if (t.access && t.exp - now > 60 * 1000) return t.access;
  if (!t.refresh) throw new Refused('Reconnect ' + pv.name + ' in Settings.');
  const res = await (ctx.fetch || fetch)(pv.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: pv.clientId(), client_secret: pv.secret(), refresh_token: t.refresh, grant_type: 'refresh_token'
    }).toString()
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    if (j.error === 'invalid_grant') { rec.broken = true; await ctx.saveRec(rec); }
    throw new Refused('Reconnect ' + pv.name + ' in Settings.');
  }
  rec.tok = { access: j.access_token, refresh: j.refresh_token || t.refresh, exp: now + (Number(j.expires_in) || 3600) * 1000 };
  delete rec.broken;
  await ctx.saveRec(rec);
  return rec.tok.access;
}

async function googleGet(pv, rec, ctx, url, extraHeaders) {
  const tok = await accessToken(pv, rec, ctx);
  const res = await (ctx.fetch || fetch)(url, { headers: Object.assign({ Authorization: 'Bearer ' + tok }, extraHeaders || {}) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Refused('Reconnect ' + pv.name + ' in Settings.');
  if (!res.ok) throw new Error(pv.name + ' answered ' + res.status);
  return j;
}

const isoOk = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(s) && !isNaN(Date.parse(s));

/* The person's own day, from the page: it knows where midnight is. */
async function gcalEvents(pv, rec, ctx) {
  const from = ctx.query.get('from'), to = ctx.query.get('to');
  if (!isoOk(from) || !isoOk(to)) return { status: 400, body: { error: 'from and to are required' } };
  const span = Date.parse(to) - Date.parse(from);
  if (!(span > 0 && span <= 8 * 86400000)) return { status: 400, body: { error: 'at most eight days at a time' } };
  const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '50', timeMin: from, timeMax: to });
  const j = await googleGet(pv, rec, ctx, 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + q);
  const events = (j.items || []).filter((e) => e && e.status !== 'cancelled').map((e) => {
    const video = e.hangoutLink || (((e.conferenceData || {}).entryPoints || []).find((x) => x.entryPointType === 'video') || {}).uri || '';
    return {
      id: String(e.id || ''),
      title: String(e.summary || '(no title)').slice(0, 200),
      start: (e.start && (e.start.dateTime || e.start.date)) || '',
      end: (e.end && (e.end.dateTime || e.end.date)) || '',
      allDay: !!(e.start && e.start.date && !e.start.dateTime),
      location: String(e.location || '').slice(0, 200),
      link: String(e.htmlLink || ''),
      video: String(video)
    };
  });
  return { status: 200, body: { events } };
}

async function gmailStarred(pv, rec, ctx) {
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  const list = await googleGet(pv, rec, ctx, base + '?' + new URLSearchParams({ q: 'is:starred', maxResults: '20' }));
  const out = [];
  for (const m of (list.messages || []).slice(0, 20)) {
    const q = new URLSearchParams([['format', 'metadata'], ['metadataHeaders', 'Subject'], ['metadataHeaders', 'From'], ['metadataHeaders', 'Date']]);
    let one;
    try { one = await googleGet(pv, rec, ctx, base + '/' + encodeURIComponent(m.id) + '?' + q); }
    catch (e) { if (e instanceof Refused) throw e; continue; }
    const h = {};
    ((one.payload || {}).headers || []).forEach((x) => { h[String(x.name).toLowerCase()] = String(x.value || ''); });
    out.push({
      id: String(m.id),
      subject: (h.subject || '(no subject)').slice(0, 200),
      from: h.from ? h.from.replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '').slice(0, 120) : '',
      date: h.date || '',
      link: 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(String(one.threadId || m.threadId || m.id))
    });
  }
  return { status: 200, body: { messages: out } };
}

/* ---------------------------------------------------------------------
 * Outlook (Microsoft Graph)
 * ------------------------------------------------------------------ */

const GRAPH = 'https://graph.microsoft.com/v1.0';
/* Graph answers in whatever zone it is asked for, without an offset. Asking
   for UTC and adding the Z back makes every time unambiguous. */
const utc = (s) => s ? (/[Zz]|[+-]\d\d:\d\d$/.test(s) ? s : String(s).replace(/(\.\d{3})\d*$/, '$1') + 'Z') : '';

async function outlookEvents(pv, rec, ctx) {
  const from = ctx.query.get('from'), to = ctx.query.get('to');
  if (!isoOk(from) || !isoOk(to)) return { status: 400, body: { error: 'from and to are required' } };
  const span = Date.parse(to) - Date.parse(from);
  if (!(span > 0 && span <= 8 * 86400000)) return { status: 400, body: { error: 'at most eight days at a time' } };
  const q = new URLSearchParams({
    startDateTime: from, endDateTime: to, $top: '50', $orderby: 'start/dateTime',
    $select: 'id,subject,start,end,isAllDay,isCancelled,location,webLink,onlineMeeting'
  });
  const j = await googleGet(pv, rec, ctx, GRAPH + '/me/calendarView?' + q, { Prefer: 'outlook.timezone="UTC"' });
  const events = (j.value || []).filter((e) => e && !e.isCancelled).map((e) => ({
    id: String(e.id || ''),
    title: String(e.subject || '(no title)').slice(0, 200),
    start: e.isAllDay ? String((e.start || {}).dateTime || '').slice(0, 10) : utc((e.start || {}).dateTime),
    end: e.isAllDay ? String((e.end || {}).dateTime || '').slice(0, 10) : utc((e.end || {}).dateTime),
    allDay: !!e.isAllDay,
    location: String(((e.location || {}).displayName) || '').slice(0, 200),
    link: String(e.webLink || ''),
    video: String(((e.onlineMeeting || {}).joinUrl) || '')
  }));
  return { status: 200, body: { events } };
}

async function outlookFlagged(pv, rec, ctx) {
  const q = new URLSearchParams({
    $filter: "flag/flagStatus eq 'flagged'", $top: '20', $select: 'id,subject,from,receivedDateTime,webLink'
  });
  const j = await googleGet(pv, rec, ctx, GRAPH + '/me/messages?' + q);
  const messages = (j.value || []).map((m) => ({
    id: String(m.id || ''),
    subject: String(m.subject || '(no subject)').slice(0, 200),
    from: String((((m.from || {}).emailAddress) || {}).name || (((m.from || {}).emailAddress) || {}).address || '').slice(0, 120),
    date: String(m.receivedDateTime || ''),
    link: String(m.webLink || '')
  }));
  return { status: 200, body: { messages } };
}


/* ---------------------------------------------------------------------
 * Mail about a calendar event — for the event brief on Today
 *
 * The page asks with the event's own words (?q=vibe show antalya). What
 * comes back is the text of the matching threads, newest first, with three
 * things taken out before it leaves this server: the quoted history every
 * reply drags along (it is the same email again), and anything that looks
 * like an identity number, a passport number or a date of birth — event
 * emails are full of them (flight bookings, room lists), and a brief never
 * needs them. Phone numbers stay: "who to call" is half the point.
 * ------------------------------------------------------------------ */

const RELATED_MAX_THREADS = 8;
const RELATED_MAX_MSGS = 40;
const RELATED_MSG_CHARS = 3500;
const RELATED_TOTAL_CHARS = 60000;

function relatedTerms(q) {
  return String(q || '').normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function fromB64url(s) {
  try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) { return ''; }
}

function htmlToText(h) {
  return String(h || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n');
}

/* The part of an email that is new: everything above the first quoted reply. */
function newPart(text) {
  let t = String(text || '').replace(/\r/g, '');
  const cut = t.search(/\n\s*(?:On .{4,200}wrote:|.{4,160}tarihinde .{0,160}şunu yazdı:|-{2,}\s*Original Message|_{8,}|\*?(?:From|Kimden|Gönderen):\*?\s|Le .{4,120} a écrit\s*:)/i);
  if (cut > 0) t = t.slice(0, cut);
  t = t.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/* Identity numbers, passport numbers, birth dates and card numbers out. */
function maskPersonal(text, now) {
  const year = new Date(now || Date.now()).getFullYear();
  return String(text || '')
    .replace(/\bTR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi, '[IBAN]')
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => /\s/.test(m) && m.replace(/\D/g, '').length <= 13 && /^\+?\d{2,4}\s/.test(m) ? m : '[number]')
    .replace(/\b[1-9]\d{10}\b/g, '[ID]')
    .replace(/\b\d{9,10}\b/g, '[ID]')
    .replace(/\b[A-Z]{1,2}\d{6,9}\b/g, '[ID]')
    .replace(/\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d\d)\b/g, (m, d, mo, y) => (+y <= year - 10 ? '[DOB]' : m));
}

function relatedPack(threads, now) {
  /* Newest threads first, newest messages kept when the budget runs out. */
  threads.forEach((t) => t.messages.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)));
  threads.sort((a, b) => (Date.parse((b.messages[b.messages.length - 1] || {}).date) || 0) - (Date.parse((a.messages[a.messages.length - 1] || {}).date) || 0));
  let total = 0, count = 0;
  const out = [];
  for (const t of threads) {
    const keep = [];
    for (let i = t.messages.length - 1; i >= 0; i--) {
      const m = t.messages[i];
      const text = maskPersonal(newPart(m.text), now).slice(0, RELATED_MSG_CHARS);
      if (!text) continue;
      if (total + text.length > RELATED_TOTAL_CHARS || count >= RELATED_MAX_MSGS) break;
      total += text.length; count++;
      keep.unshift({ from: String(m.from || '').slice(0, 120), date: m.date, text });
    }
    if (keep.length) out.push({ id: t.id, subject: String(t.subject || '(no subject)').slice(0, 200), link: t.link || '', total: t.messages.length, messages: keep });
  }
  return out;
}

async function gmailRelated(pv, rec, ctx) {
  const terms = relatedTerms(ctx.query.get('q'));
  if (terms.length < 3) return { status: 400, body: { error: 'q is required' } };
  const days = Math.max(7, Math.min(365, parseInt(ctx.query.get('days') || '120', 10) || 120));
  const words = terms.split(' ');
  /* "Vibe Show" is also written "VibeShow". */
  const joined = words.length >= 2 ? ' OR (' + words[0] + words[1] + (words.length > 2 ? ' ' + words.slice(2).join(' ') : '') + ')' : '';
  const q = '((' + terms + ')' + joined + ') newer_than:' + days + 'd -in:chats -in:spam -in:trash';
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me/threads';
  const list = await googleGet(pv, rec, ctx, base + '?' + new URLSearchParams({ q, maxResults: String(RELATED_MAX_THREADS) }));
  const threads = [];
  for (const t of (list.threads || []).slice(0, RELATED_MAX_THREADS)) {
    let full;
    try { full = await googleGet(pv, rec, ctx, base + '/' + encodeURIComponent(t.id) + '?format=full'); }
    catch (e) { if (e instanceof Refused) throw e; continue; }
    const messages = (full.messages || []).map((m) => {
      const h = {};
      ((m.payload || {}).headers || []).forEach((x) => { h[String(x.name).toLowerCase()] = String(x.value || ''); });
      let plain = '', html = '';
      const walk = (part) => {
        if (!part) return;
        if (part.mimeType === 'text/plain' && part.body && part.body.data && !plain) plain = fromB64url(part.body.data);
        else if (part.mimeType === 'text/html' && part.body && part.body.data && !html) html = fromB64url(part.body.data);
        (part.parts || []).forEach(walk);
      };
      walk(m.payload);
      return {
        from: (h.from || '').replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '') || h.from || '',
        date: m.internalDate ? new Date(+m.internalDate).toISOString() : (h.date || ''),
        subject: h.subject || '',
        text: plain || htmlToText(html)
      };
    });
    threads.push({ id: String(t.id), subject: (messages[0] || {}).subject || '', messages,
      link: 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(String(t.id)) });
  }
  return { status: 200, body: { threads: relatedPack(threads, ctx.now) } };
}

async function outlookRelated(pv, rec, ctx) {
  const terms = relatedTerms(ctx.query.get('q'));
  if (terms.length < 3) return { status: 400, body: { error: 'q is required' } };
  const q = new URLSearchParams({ $search: '"' + terms + '"', $top: '30', $select: 'subject,from,receivedDateTime,uniqueBody,conversationId,webLink' });
  const j = await googleGet(pv, rec, ctx, GRAPH + '/me/messages?' + q, { Prefer: 'outlook.body-content-type="text"' });
  const by = {};
  (j.value || []).forEach((m) => {
    const k = String(m.conversationId || m.id);
    const t = by[k] || (by[k] = { id: k, subject: String(m.subject || '').replace(/^(re|fw|fwd|ynt|ilt)\s*:\s*/i, ''), link: String(m.webLink || ''), messages: [] });
    t.messages.push({ from: String((((m.from || {}).emailAddress) || {}).name || ''), date: utc(m.receivedDateTime), text: String(((m.uniqueBody || {}).content) || '') });
  });
  return { status: 200, body: { threads: relatedPack(Object.values(by).slice(0, RELATED_MAX_THREADS), ctx.now) } };
}

/* ---------------------------------------------------------------------
 * Fathom
 * ------------------------------------------------------------------ */

const FATHOM = 'https://api.fathom.ai/external/v1';

async function fathomGet(key, path, ctx) {
  const res = await (ctx.fetch || fetch)(FATHOM + path, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new Refused('Fathom did not accept that key.');
  if (res.status === 429) throw new Refused('Fathom is busy \u2014 try again in a minute.');
  if (!res.ok) throw new Error('Fathom answered ' + res.status);
  return res.json();
}

async function verifyFathom(key, ctx) {
  const since = new Date((ctx.now || Date.now()) - 30 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const j = await fathomGet(key, '/meetings?' + new URLSearchParams({ created_after: since }), ctx);
  const first = (j.items || [])[0] || {};
  const by = first.recorded_by || {};
  return { email: String(by.email || ''), name: String(by.name || '') };
}

async function fathomMeetings(pv, rec, ctx) {
  const now = ctx.now || Date.now();
  let since = ctx.query.get('since');
  if (!isoOk(since)) since = new Date(now - 14 * 86400000).toISOString();
  since = new Date(Math.max(Date.parse(since), now - 90 * 86400000)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out = [];
  let cursor = '';
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({ created_after: since, include_summary: 'true', include_action_items: 'true' });
    if (cursor) q.set('cursor', cursor);
    const j = await fathomGet(rec.key, '/meetings?' + q, ctx);
    for (const m of (j.items || [])) {
      out.push({
        id: String(m.recording_id != null ? m.recording_id : (m.url || '')),
        me: rec.email || '',
        title: String(m.title || m.meeting_title || 'Meeting').slice(0, 200),
        url: String(m.share_url || m.url || ''),
        at: String(m.recording_start_time || m.scheduled_start_time || m.created_at || ''),
        summary: String(((m.default_summary || {}).markdown_formatted) || '').slice(0, 6000),
        actions: (m.action_items || []).filter((a) => a && !a.completed && a.description).map((a) => ({
          text: String(a.description).slice(0, 300),
          who: String(((a.assignee || {}).name) || ''),
          email: String(((a.assignee || {}).email) || '')
        }))
      });
    }
    cursor = j.next_cursor || '';
    if (!cursor) break;
  }
  return { status: 200, body: { meetings: out, me: rec.email || '' } };
}

/* ---------------------------------------------------------------------
 * Notion
 * ------------------------------------------------------------------ */

const NOTION = 'https://api.notion.com/v1';

async function notionCall(key, path, ctx, method, body) {
  const res = await (ctx.fetch || fetch)(NOTION + path, {
    method: method || 'GET',
    headers: { Authorization: 'Bearer ' + key, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Refused('Notion did not accept that secret.');
  if (res.status === 404 && path.indexOf('/pages') === 0) throw new Refused('The Flow cannot see that page. In Notion, open it and add the integration under \u2026 \u2192 Connections.');
  if (res.status === 429) throw new Refused('Notion is busy \u2014 try again in a minute.');
  if (!res.ok) throw new Error('Notion answered ' + res.status + (j.message ? ': ' + j.message : ''));
  return j;
}

async function verifyNotion(key, ctx) {
  const j = await notionCall(key, '/users/me', ctx);
  return { email: '', name: String(((j.bot || {}).workspace_name) || j.name || 'Notion') };
}

const plain = (rich) => (rich || []).map((t) => t.plain_text || '').join('');

async function notionPages(pv, rec, ctx) {
  const j = await notionCall(rec.key, '/search', ctx, 'POST', {
    filter: { property: 'object', value: 'page' }, page_size: 50,
    sort: { direction: 'descending', timestamp: 'last_edited_time' }
  });
  const pages = (j.results || []).map((pg) => {
    const props = pg.properties || {};
    const tp = Object.values(props).find((x) => x && x.type === 'title');
    return { id: String(pg.id), title: (tp ? plain(tp.title) : '') || 'Untitled' };
  });
  return { status: 200, body: { pages, target: rec.target || null } };
}

async function notionTarget(pv, rec, ctx) {
  if (ctx.req.method !== 'POST') return { status: 405, body: { error: 'POST' } };
  let b = {};
  try { b = JSON.parse((await ctx.readBody(ctx.req)) || '{}'); } catch (e) {}
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) return { status: 400, body: { error: 'Choose a page.' } };
  rec.target = { id, title: String(b.title || 'Untitled').slice(0, 200) };
  await ctx.saveRec(rec);
  return { status: 200, body: { ok: true, target: rec.target } };
}

/* The page hands over a small, closed shape — headings, paragraphs,
   bullets and to-dos — and only that becomes Notion blocks. */
function notionBlocks(list) {
  const rt = (s) => [{ type: 'text', text: { content: String(s || '').slice(0, 1900) } }];
  const out = [];
  for (const b of (Array.isArray(list) ? list : []).slice(0, 95)) {
    if (!b || !b.text) continue;
    if (b.type === 'h') out.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(b.text) } });
    else if (b.type === 'li') out.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(b.text) } });
    else if (b.type === 'todo') out.push({ object: 'block', type: 'to_do', to_do: { rich_text: rt(b.text), checked: !!b.done } });
    else out.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(b.text) } });
  }
  return out;
}

async function notionSend(pv, rec, ctx) {
  if (ctx.req.method !== 'POST') return { status: 405, body: { error: 'POST' } };
  if (!rec.target) return { status: 400, body: { error: 'Choose a Notion page first.' } };
  let b = {};
  try { b = JSON.parse((await ctx.readBody(ctx.req)) || '{}'); } catch (e) {}
  const title = String(b.title || 'The Flow').slice(0, 200);
  const j = await notionCall(rec.key, '/pages', ctx, 'POST', {
    parent: { page_id: rec.target.id },
    properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
    children: notionBlocks(b.blocks)
  });
  return { status: 200, body: { ok: true, url: String(j.url || '') } };
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

/* One connection can hold several accounts — a personal and a work Gmail,
   two Outlooks, two Fathoms. Stored as { v: 2, accounts: [...] }; a record
   written before that (one account, no list) is read as a list of one. Each
   account has an `aid`: who it is at the other end, so connecting the same
   account again replaces it rather than adding a twin. */
const aidOf = (r) => String((r && (r.aid || r.account || r.email || r.name)) || 'main').slice(0, 120);
async function readAccounts(raw, uid, id) {
  const v = await readJSON(raw, KEY(uid, id), null);
  if (!v) return [];
  const list = Array.isArray(v.accounts) ? v.accounts : [v];
  return list.filter(Boolean).map((r) => Object.assign({}, r, { aid: aidOf(r) }));
}
async function writeAccounts(raw, uid, id, list) {
  if (!list.length) return raw.set(KEY(uid, id), '');
  return writeJSON(raw, KEY(uid, id), { v: 2, accounts: list.slice(0, 10) });
}
async function upsertAccount(raw, uid, id, rec) {
  const list = await readAccounts(raw, uid, id);
  const aid = aidOf(rec);
  const i = list.findIndex((r) => r.aid === aid);
  /* Reconnecting keeps what the account was set up to do (Notion's page). */
  const merged = Object.assign({}, i >= 0 ? { target: list[i].target } : {}, rec, { aid });
  if (!merged.target) delete merged.target;
  if (i >= 0) list[i] = merged; else list.push(merged);
  await writeAccounts(raw, uid, id, list);
  return merged;
}

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
      const accounts = await readAccounts(raw, me.id, pv.id);
      const rec = accounts[0] || null;
      out.push({
        accounts: accounts.map((a) => ({
          aid: a.aid, email: a.email || null, name: a.name || null, photo: a.photo || null,
          since: a.since || null, broken: !!a.broken, target: (a.target && a.target.title) || null
        })),
        id: pv.id, name: pv.name, blurb: pv.blurb, kind: kindOf(pv),
        keyLabel: pv.keyLabel || null, keyHelp: pv.keyHelp || null, keyUrl: pv.keyUrl || null,
        configured: configured(pv),
        connected: !!rec,
        broken: !!(rec && rec.broken),
        target: (rec && rec.target && rec.target.title) || null,
        email: (rec && rec.email) || null,
        name_on_account: (rec && rec.name) || null,
        photo: (rec && rec.photo) || null,
        since: (rec && rec.since) || null
      });
    }
    json(res, 200, { connections: out });
    return true;
  }

  const m = p.match(/^\/api\/connect\/([a-z0-9-]+)\/([a-z-]+)$/);
  if (!m) return false;
  const pv = PROVIDERS[m[1]];
  if (!pv) return json(res, 404, { error: 'No such connection.' }), true;
  const step = m[2];

  /* ---- a key, pasted by the person ---- */
  if (step === 'key') {
    if (!me) return json(res, 401, { error: 'auth required' }), true;
    if (req.method !== 'POST') return json(res, 405, { error: 'POST' }), true;
    if (kindOf(pv) !== 'key') return json(res, 404, { error: 'No such step.' }), true;
    let body = {};
    try { body = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
    const key = String(body.key || '').trim();
    if (key.length < 10 || key.length > 400 || /\s/.test(key)) return json(res, 400, { error: 'That does not look like a ' + pv.keyLabel + '.' }), true;
    let who;
    try { who = await pv.verify(key, { fetch: ctx.fetch, now: ctx.now }); }
    catch (e) {
      if (!(e instanceof Refused)) console.error('[connect/' + pv.id + '] ' + (e && e.message));
      return json(res, e instanceof Refused ? 400 : 502, { error: e instanceof Refused ? e.message : pv.name + ' could not be reached. Try again shortly.' }), true;
    }
    /* A key is one account; which one is the person it belongs to, or, for
       a workspace key, a fingerprint of the key itself. */
    const fp = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
    await upsertAccount(raw, me.id, pv.id, { aid: who.email || (who.name ? who.name + ' \u00b7 ' + fp : fp), key,
      email: who.email || '', name: who.name || '', since: new Date(now()).toISOString() });
    json(res, 200, { ok: true });
    return true;
  }

  /* ---- what a connection is for, once it exists ---- */
  /* Reading (events, starred mail, meetings) runs over every account and
     merges, each item saying which account it came from; one account that
     fails does not hide the others. Acting on one thing (Notion's page)
     uses the account named by ?aid=, or the first. */
  if (pv.actions && pv.actions[step]) {
    if (!me) return json(res, 401, { error: 'auth required' }), true;
    const all = await readAccounts(raw, me.id, pv.id);
    if (!all.length) return json(res, 409, { error: pv.name + ' is not connected.' }), true;
    const want = ctx.query.get('aid');
    const one = (pv.oneAccount || []).indexOf(step) >= 0;
    const picked = want ? all.filter((a) => a.aid === want) : (one ? all.slice(0, 1) : all);
    if (!picked.length) return json(res, 404, { error: 'That account is not connected.' }), true;
    const results = [], problems = [];
    for (const rec of picked) {
      const actx = { req, query: ctx.query, fetch: ctx.fetch, now: ctx.now, readBody: ctx.readBody,
                     saveRec: (r) => upsertAccount(raw, me.id, pv.id, r) };
      try {
        const out = await pv.actions[step](pv, rec, actx);
        if (out.status !== 200) { json(res, out.status, out.body); return true; }
        results.push({ rec, body: out.body });
      } catch (e) {
        if (!(e instanceof Refused)) console.error('[connect/' + pv.id + '/' + step + '] ' + (e && e.message));
        problems.push({ account: rec.email || rec.name || rec.aid,
          error: e instanceof Refused ? e.message : pv.name + ' could not be reached. Try again shortly.', refused: e instanceof Refused });
      }
    }
    if (!results.length) {
      json(res, problems[0].refused ? 409 : 502, { error: problems[0].error, problems });
      return true;
    }
    const body = {};
    for (const { rec, body: b } of results) {
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k])) {
          body[k] = (body[k] || []).concat(b[k].map((x) => (x && typeof x === 'object' && !x.account)
            ? Object.assign({ account: rec.email || rec.name || '' }, x) : x));
        } else if (!(k in body)) body[k] = b[k];
      }
    }
    if (problems.length) body.problems = problems;
    json(res, 200, body);
    return true;
  }
  if (['start', 'callback', 'finish', 'disconnect'].indexOf(step) < 0) return json(res, 404, { error: 'No such step.' }), true;

  /* ---- begin ----
     A POST that answers with the URL, rather than a GET that redirects:
     the iPhone and Mac apps have to open it in the real browser, and the
     real browser has no session to start one with. */
  if (step === 'start') {
    if (!me) return json(res, 401, { error: 'auth required' }), true;
    if (req.method !== 'POST') return json(res, 405, { error: 'POST' }), true;
    if (kindOf(pv) === 'key') return json(res, 400, { error: pv.name + ' is connected with a key, not a sign-in.' }), true;
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
  const okPageFor = (P, profile) => donePage(P.name + ' connected',
    (profile.email ? '<p>' + esc(profile.email) + '</p>' : '') +
    '<p>You can close this and go back to The Flow.</p>', true);
  const saveFor = (P, uid, profile) => upsertAccount(raw, uid, P.id, Object.assign({
    account: profile.account, email: profile.email, name: profile.name,
    photo: profile.photo, since: new Date(now()).toISOString()
  }, profile.tok ? { tok: profile.tok } : {}));
  const save = (uid, profile) => saveFor(pv, uid, profile);
  const homeFor = (P, status) => { res.writeHead(302, { Location: '/?connect=' + P.id + ':' + status + '#settings', 'Cache-Control': 'no-store' }); res.end(); return true; };
  const home = (status) => homeFor(pv, status);
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
    /* Calendar and Gmail come back through Google's registered callback;
       the state says which connection this is. */
    const real = rec && PROVIDERS[rec.provider];
    const R = real || pv;
    const fail = (status, why) => viaApp ? page(400, failPage(why)) : homeFor(R, status);

    if (!rec || !real || (real.id !== pv.id && real.via !== pv.id) || now() - rec.at > STATE_TTL_MS) return fail('expired', 'That link has expired.');
    if (pick('error')) return fail('denied', 'Permission was not given.');
    const want = (real.extra || {}).response_type === 'code' ? 'code' : 'id_token';
    if (!pick(want)) return fail('incomplete', real.name + ' did not finish.');
    if (want === 'code') posted.code = pick('code');

    let profile;
    try { profile = await real.finish(real, posted, rec, deps); }
    catch (e) {
      if (e instanceof Refused) return fail('scope', e.message);
      console.error('[connect/' + real.id + '] ' + (e && e.message));
      return fail('failed', real.name + ' did not accept the sign-in. Please try again.');
    }

    if (viaApp) { await saveFor(R, rec.uid, profile); return page(200, okPageFor(R, profile)); }

    /* A browser round trip: park the result under a fresh one-time key and
       send the browser on to /finish. The page does the navigation, from
       this origin, so the session cookie goes with it. */
    const park = b64url(crypto.randomBytes(16));
    await writeJSON(raw, ST(park), { uid: rec.uid, provider: R.id, at: now(), parked: profile });
    const to = '/api/connect/' + R.id + '/finish?p=' + park;
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
    let body = {};
    try { body = JSON.parse((await ctx.readBody(req)) || '{}'); } catch (e) {}
    const all = await readAccounts(raw, me.id, pv.id);
    const aid = body && body.aid ? String(body.aid) : '';
    const gone = aid ? all.filter((a) => a.aid === aid) : all;
    await writeAccounts(raw, me.id, pv.id, aid ? all.filter((a) => a.aid !== aid) : []);
    /* Hand Google access back too, not just forget it. Best effort: the
       local record is gone either way. Microsoft has no equivalent call; its
       refresh tokens die unused, and the person can remove the app from
       their Microsoft account. */
    if (pv.id === 'google' || pv.via === 'google') {
      for (const was of gone) {
        const t = was.tok && (was.tok.refresh || was.tok.access);
        if (!t) continue;
        try { await (ctx.fetch || fetch)('https://oauth2.googleapis.com/revoke', { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t }).toString() }); } catch (e) {}
      }
    }
    json(res, 200, { ok: true, removed: gone.length });
    return true;
  }

  return false;
}

module.exports = {
  handle,
  purgeUser,
  PROVIDERS,
  _internals: { relatedTerms, newPart, maskPersonal, relatedPack, htmlToText, notionBlocks, Refused, readAccounts, upsertAccount, utc, readIdToken, photoUrlOk, sizedPhoto, fetchPhoto, redirectFor, KEY, ST, STATE_TTL_MS, donePage,
                resetKeys: () => { jwksCache = { at: 0, ttl: 0, keys: [] }; } }
};
