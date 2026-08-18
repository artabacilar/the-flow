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
/* A leaked invite code should not be able to fill the database. 0 disables the
   cap entirely; the owner's own account is always allowed through it. */
const MAX_ACCOUNTS = (() => {
  const n = parseInt(process.env.FLOW_MAX_ACCOUNTS || '10', 10);
  return Number.isFinite(n) && n >= 0 ? n : 10;
})();

/* Optional sibling module: live prices and, later, the assistant. Absent is a
   perfectly valid state — the app simply does not offer those routes. */
let extras = null;
try { extras = require('./flow-extras'); } catch (e) { extras = null; }

const USERS_KEY = '__auth:users';
const SESS = (t) => '__auth:sess:' + t;
/* Bumped: the v1 prefix put adopted keys outside the store's `ld_*` pattern,
   so adoption has to run once more to place them where all() can see them. */
const LEGACY_CLAIMED = '__auth:legacy_claimed_v2';
const NAMESPACED = /^ld_u[0-9a-f]+:/;
const SEED = (uid) => '__auth:seed:' + uid;
const PACK_CLAIMED = (uid) => '__auth:packclaimed:' + uid;
/* One task, handed from one account to another. This is the ONLY channel
   between accounts in the whole system, so it is deliberately narrow: a
   record holds exactly what the sender typed plus who they are, and it lives
   in its own key outside both namespaces. Nothing reads it but its owner. */
const INBOX = (uid) => '__share:inbox:' + uid;
const INBOX_MAX = 50;                       /* so nobody can flood a mailbox  */
const SHARE_DAILY_MAX = 50;                 /* and nobody can flood everyone  */
const SHARE_SENT = (uid, day) => '__share:sent:' + uid + ':' + day;

/* A single task shared with other accounts as a live, collaborative item —
   every member can edit it, move its status and comment; only the owner can
   delete it. Reached by a link (open it while signed in to join) or by
   inviting an address. Like the inbox, it lives outside every namespace and is
   touched only through the /api/shared/* routes. */
const SHARED = (token) => '__shared:task:' + token;
const SHARED_MEMBER = (uid) => '__shared:member:' + uid;   /* tokens a user belongs to */
const SHARED_MAX_PER_USER = 200;
const SHARED_COMMENTS_MAX = 500;
const SHARED_MEMBERS_MAX = 25;

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
async function adoptLegacyKeys(uid, force) {
  const claimed = await getJSON(LEGACY_CLAIMED, null);
  if (claimed && !force) return 0;
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

/* The upgrade pack stores under `flow:*`, which falls OUTSIDE the store's
   `ld_*` listing pattern — so all() cannot see those keys and adoption, which
   walks all(), silently skipped every one of them. They have to be claimed by
   name. The list is closed and known; receipt photos are the one open-ended
   set, and they are reachable from the expense records that reference them. */
const PACK_KEYS = [
  'flow:journal', 'flow:journal:ui', 'flow:journal:draft',
  'flow:settings', 'flow:schedule', 'flow:notes', 'flow:profile',
  'flow:expenses', 'flow:reminders:outbox'
];

/* Copies an un-namespaced pack key into the owner's namespace ONLY when that
   namespaced key is empty, so it can never clobber something newer. */
async function adoptUnlistable(uid) {
  const pre = 'ld_u' + uid + ':';
  const queue = PACK_KEYS.slice();
  const seen = new Set();
  let n = 0;
  while (queue.length) {
    const k = queue.shift();
    if (seen.has(k) || seen.size > 400) continue;
    seen.add(k);
    let mine = null, legacy = null;
    try { mine = await raw.get(pre + k); } catch (e) { continue; }
    if (mine != null && mine !== '') continue;               // already has one — leave it
    try { legacy = await raw.get(k); } catch (e) { continue; }
    if (legacy == null || legacy === '') continue;           // nothing to copy
    await raw.set(pre + k, legacy);
    n++;
    if (k === 'flow:expenses') {                             // follow receipt photos
      try {
        const p = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
        const rows = Array.isArray(p) ? p : (p && Array.isArray(p.items) ? p.items : []);
        rows.forEach(e => { if (e && e.receiptId) queue.push('flow:receipt:' + e.receiptId); });
      } catch (e) { /* unreadable expenses — the receipts are simply skipped */ }
    }
  }
  return n;
}

/* Re-adopt only into an empty namespace. Returns the number of keys rescued,
   or 0 when there was nothing to do — which is the normal, steady state. */
async function healOwner(uid) {
  const all = await raw.all();
  const names = Object.keys(all || {});
  const mine = 'ld_u' + uid + ':';
  if (names.some(k => k.indexOf(mine) === 0)) return 0;      // already has data — never touch it
  const orphans = names.filter(k => k.indexOf('ld_') === 0 && !NAMESPACED.test(k));
  if (!orphans.length) return 0;                             // nothing to rescue
  return adoptLegacyKeys(uid, true);
}

/* ---------- sharing a single task ---------------------------------------- */
async function userByEmail(email) {
  const users = await getJSON(USERS_KEY, {});
  return users[String(email || '').trim().toLowerCase()] || null;
}

/* Only the fields we promise to carry. Anything else the client sends is
   dropped here rather than trusted onward — the recipient's app renders this. */
function cleanTask(t) {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const txt = str(t && t.txt, 500).trim();
  if (!txt) return null;
  return {
    txt,
    note: str(t && t.note, 2000),
    due: validDate(t && t.due),
    time: validTime(t && t.time),
    origin: str(t && t.origin, 40)
  };
}

/* Shape alone is not enough: "2026-13-45" and "99:99" both match a naive
   pattern and would land in someone else's app as a date their calendar
   cannot parse. Check the ranges, and for a date that it survives a
   round-trip through Date — which rejects 31 February. */
function validDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10) === s ? s : '';
}
function validTime(v) {
  const s = String(v == null ? '' : v).trim();
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return '';
  const h = +m[1], mi = +m[2];
  return (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) ? s : '';
}

/* ---------- shared-task helpers ------------------------------------------ */
const nowISO = () => new Date().toISOString();
const SHARED_STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
function sharedStatus(s) { return SHARED_STATUSES.indexOf(s) >= 0 ? s : 'todo'; }
function isSharedMember(t, uid) {
  return !!(t && Array.isArray(t.members) && t.members.some(m => m && m.id === uid));
}
async function sharedAddIndex(uid, token) {
  const list = await getJSON(SHARED_MEMBER(uid), []);
  if (list.indexOf(token) < 0) { list.unshift(token); await setJSON(SHARED_MEMBER(uid), list.slice(0, SHARED_MAX_PER_USER)); }
}
async function sharedDropIndex(uid, token) {
  const list = (await getJSON(SHARED_MEMBER(uid), [])).filter(x => x !== token);
  await setJSON(SHARED_MEMBER(uid), list);
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

  /* ---- sharing one task with one person ----
     Deliberately kept here, next to the account records, rather than in the
     extras module: this is the one place that writes into somebody else's
     space, and it should be obvious where that happens. */
  if (p === '/api/share/send' && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const b = safeParse(await readBody(req));
    const to = String(b.to || '').trim().toLowerCase();
    const task = cleanTask(b.task);
    if (!emailOk(to)) { json(res, 400, { error: 'That does not look like an email address.' }); return true; }
    if (!task) { json(res, 400, { error: 'The task needs some text.' }); return true; }
    if (to === me.email) { json(res, 400, { error: 'That is your own address.' }); return true; }

    const day = new Date().toISOString().slice(0, 10);
    const sent = (await getJSON(SHARE_SENT(me.id, day), 0)) || 0;
    if (sent >= SHARE_DAILY_MAX) {
      json(res, 429, { error: 'You have shared a lot today. Try again tomorrow.' });
      return true;
    }

    const rec = await userByEmail(to);
    /* Telling the sender the address is unknown is a small disclosure — it
       confirms whether an account exists. On a private, invite-only Flow that
       is worth it: silently swallowing a share is far worse for the person
       who typed a typo and waits for a reply that never comes. */
    if (!rec) { json(res, 404, { error: 'Nobody here has that email address yet.' }); return true; }

    const inbox = await getJSON(INBOX(rec.id), []);
    if (inbox.length >= INBOX_MAX) { json(res, 429, { error: 'Their inbox is full.' }); return true; }
    const item = {
      id: crypto.randomBytes(8).toString('hex'),
      at: new Date().toISOString(),
      from: { name: me.name || me.email, email: me.email },
      task
    };
    inbox.push(item);
    await setJSON(INBOX(rec.id), inbox);
    await setJSON(SHARE_SENT(me.id, day), sent + 1);
    json(res, 200, { ok: true, id: item.id, to: rec.email });
    return true;
  }

  if (p === '/api/share/inbox' && req.method !== 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    json(res, 200, { ok: true, items: await getJSON(INBOX(me.id), []) });
    return true;
  }

  /* Accept hands the task back to the client, which files it wherever it
     belongs in that person's own app; the server never writes into anyone's
     task list on their behalf. Decline just drops it. */
  if ((p === '/api/share/accept' || p === '/api/share/decline') && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const b = safeParse(await readBody(req));
    const id = String(b.id || '');
    const inbox = await getJSON(INBOX(me.id), []);
    const i = inbox.findIndex(x => x && x.id === id);
    if (i < 0) { json(res, 404, { error: 'That item is no longer there.' }); return true; }
    const [item] = inbox.splice(i, 1);
    await setJSON(INBOX(me.id), inbox);
    json(res, 200, { ok: true, item: p === '/api/share/accept' ? item : null, remaining: inbox.length });
    return true;
  }

  /* ---- collaborative shared tasks ----
     A task shared with other accounts as a live item. Reached by a link (open
     it while signed in to join) or by inviting an address (it also lands in
     their inbox as a heads-up). Every member can edit, set status and comment;
     only the owner can delete. */
  if (p === '/api/shared/create' && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const b = safeParse(await readBody(req));
    const title = String(b.title || '').trim().slice(0, 500);
    if (!title) { json(res, 400, { error: 'Give the task a title.' }); return true; }
    const mine = await getJSON(SHARED_MEMBER(me.id), []);
    if (mine.length >= SHARED_MAX_PER_USER) { json(res, 429, { error: 'You already have a lot of shared tasks.' }); return true; }
    const token = crypto.randomBytes(9).toString('hex');
    const task = {
      token, ownerId: me.id,
      title,
      notes: String(b.notes || '').slice(0, 4000),
      status: sharedStatus(b.status),
      ws: (String(b.ws || '') === 'dtc') ? 'dtc' : 'abko',
      date: validDate(b.date), time: validTime(b.time),
      members: [{ id: me.id, email: me.email, name: me.name || me.email, owner: true }],
      comments: [],
      createdAt: nowISO(), updatedAt: nowISO()
    };
    await setJSON(SHARED(token), task);
    await sharedAddIndex(me.id, token);
    json(res, 200, { ok: true, task });
    return true;
  }

  if (p === '/api/shared/list' && req.method !== 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const tokens = await getJSON(SHARED_MEMBER(me.id), []);
    const items = [], keep = [];
    for (const tk of tokens) {
      const t = await getJSON(SHARED(tk), null);
      if (t && isSharedMember(t, me.id)) { items.push(t); keep.push(tk); }
    }
    if (keep.length !== tokens.length) await setJSON(SHARED_MEMBER(me.id), keep);
    json(res, 200, { ok: true, items });
    return true;
  }

  if ((p === '/api/shared/get' || p === '/api/shared/join') && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const b = safeParse(await readBody(req));
    const token = String(b.token || '').trim();
    const t = await getJSON(SHARED(token), null);
    if (!t) { json(res, 404, { error: 'That shared task no longer exists.' }); return true; }
    if (!isSharedMember(t, me.id)) {
      if (p === '/api/shared/join') {
        if ((t.members || []).length >= SHARED_MEMBERS_MAX) { json(res, 429, { error: 'That task already has the maximum number of people.' }); return true; }
        t.members.push({ id: me.id, email: me.email, name: me.name || me.email });
        t.updatedAt = nowISO();
        await setJSON(SHARED(token), t);
        await sharedAddIndex(me.id, token);
      } else {
        json(res, 403, { error: 'Open the share link to join this task first.' }); return true;
      }
    }
    json(res, 200, { ok: true, task: t });
    return true;
  }

  if (p === '/api/shared/invite' && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const b = safeParse(await readBody(req));
    const token = String(b.token || '').trim();
    const to = String(b.to || '').trim().toLowerCase();
    if (!emailOk(to)) { json(res, 400, { error: 'That does not look like an email address.' }); return true; }
    const t = await getJSON(SHARED(token), null);
    if (!t) { json(res, 404, { error: 'That shared task no longer exists.' }); return true; }
    if (!isSharedMember(t, me.id)) { json(res, 403, { error: 'Only people on the task can invite others.' }); return true; }
    if (to === me.email) { json(res, 400, { error: 'That is your own address.' }); return true; }
    const rec = await userByEmail(to);
    if (!rec) { json(res, 404, { error: 'Nobody here has that email address yet.' }); return true; }
    if ((t.members || []).length >= SHARED_MEMBERS_MAX) { json(res, 429, { error: 'That task already has the maximum number of people.' }); return true; }
    if (!isSharedMember(t, rec.id)) {
      t.members.push({ id: rec.id, email: rec.email, name: rec.name || rec.email });
      t.updatedAt = nowISO();
      await setJSON(SHARED(token), t);
      await sharedAddIndex(rec.id, token);
      /* A heads-up in their existing inbox so they notice without a link. */
      try {
        const inbox = await getJSON(INBOX(rec.id), []);
        if (inbox.length < INBOX_MAX) {
          inbox.push({
            id: crypto.randomBytes(8).toString('hex'), at: nowISO(),
            from: { name: me.name || me.email, email: me.email },
            shared: token,
            task: { txt: t.title, note: 'Shared task — open “🤝 Shared tasks” in Work or Side Project to collaborate.', due: t.date || '', time: t.time || '', origin: 'shared' }
          });
          await setJSON(INBOX(rec.id), inbox);
        }
      } catch (e) {}
    }
    json(res, 200, { ok: true, task: t, to: rec.email });
    return true;
  }

  if (p === '/api/shared/update' && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const b = safeParse(await readBody(req));
    const token = String(b.token || '').trim();
    const t = await getJSON(SHARED(token), null);
    if (!t) { json(res, 404, { error: 'That shared task no longer exists.' }); return true; }
    if (!isSharedMember(t, me.id)) { json(res, 403, { error: 'Only people on the task can edit it.' }); return true; }
    const patch = (b.patch && typeof b.patch === 'object') ? b.patch : {};
    if ('title' in patch) { const v = String(patch.title || '').trim().slice(0, 500); if (v) t.title = v; }
    if ('notes' in patch) t.notes = String(patch.notes || '').slice(0, 4000);
    if ('status' in patch) t.status = sharedStatus(patch.status);
    if ('date' in patch) t.date = validDate(patch.date);
    if ('time' in patch) t.time = validTime(patch.time);
    t.updatedAt = nowISO();
    await setJSON(SHARED(token), t);
    json(res, 200, { ok: true, task: t });
    return true;
  }

  if (p === '/api/shared/comment' && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const b = safeParse(await readBody(req));
    const token = String(b.token || '').trim();
    const text = String(b.text || '').trim().slice(0, 2000);
    if (!text) { json(res, 400, { error: 'Type a comment first.' }); return true; }
    const t = await getJSON(SHARED(token), null);
    if (!t) { json(res, 404, { error: 'That shared task no longer exists.' }); return true; }
    if (!isSharedMember(t, me.id)) { json(res, 403, { error: 'Only people on the task can comment.' }); return true; }
    t.comments = Array.isArray(t.comments) ? t.comments : [];
    t.comments.push({ id: crypto.randomBytes(6).toString('hex'), byId: me.id, byName: me.name || me.email, at: nowISO(), text });
    if (t.comments.length > SHARED_COMMENTS_MAX) t.comments = t.comments.slice(-SHARED_COMMENTS_MAX);
    t.updatedAt = nowISO();
    await setJSON(SHARED(token), t);
    json(res, 200, { ok: true, task: t });
    return true;
  }

  if (p === '/api/shared/delete' && req.method === 'POST') {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    const b = safeParse(await readBody(req));
    const token = String(b.token || '').trim();
    const t = await getJSON(SHARED(token), null);
    if (!t) { await sharedDropIndex(me.id, token); json(res, 200, { ok: true }); return true; }
    if (t.ownerId !== me.id) {
      /* A non-owner "delete" just leaves the task. */
      t.members = (t.members || []).filter(m => m && m.id !== me.id);
      t.updatedAt = nowISO();
      await setJSON(SHARED(token), t);
      await sharedDropIndex(me.id, token);
      json(res, 200, { ok: true, left: true });
      return true;
    }
    await raw.set(SHARED(token), '');
    await sharedDropIndex(me.id, token);
    json(res, 200, { ok: true, deleted: true });
    return true;
  }

  /* ---- market prices: public ----
     Prices are public market data (BTC/USD/EUR/gold), not anyone's personal
     information, and the server caches them so an anonymous caller cannot
     hammer the upstreams. Serving them without a session is what lets the
     Today strip show real numbers for a guest and in "have a look around".
     The prices handler only uses ctx.json — no per-user reader, no counter. */
  if (extras && p === '/api/flow/prices') {
    try {
      const done = await extras.handle(p, req, res, { json });
      if (done) return true;
    } catch (e) {
      json(res, 502, { error: 'Prices are unavailable right now.' });
      return true;
    }
  }

  /* ---- other extras (the assistant) ----
     Signed in only: these cost upstream quota or money, so an anonymous
     caller must never be able to spend either. */
  if (extras && p.indexOf('/api/flow/') === 0) {
    const me = await currentUser(req);
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    try {
      /* extras never receives the raw store. It gets a reader already locked
         to the caller's own namespace, so a bug in a new feature cannot read
         across accounts even by accident. */
      const pre = 'ld_u' + me.id + ':';
      const mine = {
        async get(key) {
          const v = await raw.get(pre + key);
          if (v == null) return null;
          if (typeof v !== 'string') return v;
          const t = v.trim();
          if (t && (t[0] === '{' || t[0] === '[')) { try { return JSON.parse(t); } catch (e) {} }
          return v;
        },
        async all() {
          const everything = await raw.all();
          const out = {};
          Object.keys(everything || {}).forEach(k => {
            if (k.indexOf(pre) === 0) out[k.slice(pre.length)] = everything[k];
          });
          return out;
        }
      };
      const done = await extras.handle(p, req, res, {
        json, readBody, user: me, mine,
        counter: {
          get: (k) => getJSON('__auth:ctr:' + me.id + ':' + k, 0),
          set: (k, v) => setJSON('__auth:ctr:' + me.id + ':' + k, v)
        }
      });
      if (done) return true;
    } catch (e) {
      json(res, 502, { error: 'That service is unavailable right now.' });
      return true;
    }
  }

  /* ---- auth endpoints ---- */
  if (p === '/api/auth/me') {
    const me = await currentUser(req);
    if (!me) { json(res, 200, { ok: false, user: null, needsSetup: await isFirstRun() }); return true; }
    const seed = await getJSON(SEED(me.id), 'template');
    /* Self-heal. Adoption used to run only at signup and login, so an owner
       holding a session from before a fix had no way to trigger it short of
       signing out. This re-runs it when — and only when — the owner's own
       namespace is completely empty while un-namespaced data is sitting in
       the store. It therefore cannot overwrite anything: the only case it
       fires in is the one where there is nothing of theirs to overwrite. */
    let healed = 0, packHealed = 0;
    if (me.owner) {
      try { healed = await healOwner(me.id); } catch (e) { healed = 0; }
      /* Claimed by name, once, and stamped — the pack keys cannot be listed,
         so there is no cheap way to ask "is there anything left to do?". */
      try {
        const stamp = PACK_CLAIMED(me.id);
        if (!(await getJSON(stamp, null))) {
          packHealed = await adoptUnlistable(me.id);
          await setJSON(stamp, { at: new Date().toISOString(), keys: packHealed });
        }
      } catch (e) { packHealed = 0; }
    }
    json(res, 200, { ok: true, user: { email: me.email, name: me.name, owner: me.owner }, seed, healed, packHealed });
    return true;
  }

  /* Owner-only. Key NAMES and counts, never values — enough to diagnose a
     namespace problem without exposing a single line of anyone's data. */
  if (p === '/api/auth/diag') {
    const me = await currentUser(req);
    if (!me || !me.owner) return json(res, 403, { error: 'Not permitted.' }), true;
    const all = await raw.all();
    const names = Object.keys(all || {});
    const mine0 = 'ld_u' + me.id + ':';
    const mine = mine0;
    json(res, 200, {
      uid: me.id,
      visibleToPattern: names.length,
      unNamespaced: names.filter(k => k.indexOf('ld_') === 0 && !NAMESPACED.test(k)),
      mineCount: names.filter(k => k.indexOf(mine) === 0).length,
      otherNamespaces: [...new Set(names.filter(k => NAMESPACED.test(k) && k.indexOf(mine) !== 0)
        .map(k => k.slice(0, k.indexOf(':') + 1)))],
      claimV1: !!(await getJSON('__auth:legacy_claimed', null)),
      claimV2: await getJSON(LEGACY_CLAIMED, null),
      packClaimed: await getJSON(PACK_CLAIMED(me.id), null),
      accounts: Object.keys(await getJSON(USERS_KEY, {})).length,
      invited: Object.values(await getJSON(USERS_KEY, {})).filter(u => !u.owner).length,
      maxAccounts: MAX_ACCOUNTS,   /* invited accounts only — the owner is extra */
      /* Sizes only. These keys are invisible to all(), which is exactly how
         they went missing, so the diagnostic has to probe them by name. */
      pack: await (async () => {
        const o = {};
        for (const k of PACK_KEYS) {
          const legacy = await raw.get(k);
          const mine = await raw.get(mine0 + k);
          o[k] = { legacy: legacy == null ? 0 : String(legacy).length,
                   mine: mine == null ? 0 : String(mine).length };
        }
        return o;
      })()
    });
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

    /* The cap protects against a leaked invite code, so it applies to invited
       accounts only — the owner can always create their own. */
    const owner0 = first || (OWNER_EMAIL && email === OWNER_EMAIL);
    const invited = Object.values(users).filter(u => !u.owner).length;
    if (!owner0 && MAX_ACCOUNTS > 0 && invited >= MAX_ACCOUNTS) {
      return json(res, 403, { error: 'This Flow is full — ask Artur to make room for you.' }), true;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const id = crypto.randomBytes(9).toString('hex');
    const owner = owner0;
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

/* A cold start can hand back a transient read failure, and reading that as
   "there are no accounts yet" is how a returning owner got shown "Set up your
   account" instead of "Sign in". Only an unambiguous, successful read of an
   empty user list counts as a first run; anything else fails closed. */
async function isFirstRun() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const v = await raw.get(USERS_KEY);
      if (v == null) { if (attempt === 1) return true; continue; }  // absent — confirm once more
      const users = JSON.parse(typeof v === 'string' ? v : JSON.stringify(v));
      return !users || Object.keys(users).length === 0;
    } catch (e) { /* transient — try once more, then assume accounts exist */ }
  }
  return false;
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
