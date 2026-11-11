/* Who may use this Flow, and the organization.
 *
 * Private: with it on, the owner is the only one in. Everyone else is
 * signed out at once and can sign in again (or create an account) only with
 * an access code the owner made. A code is spent per person, can be used a
 * set number of times, and can be withdrawn. Their own data is never
 * touched; being let in again finds it where it was.
 *
 * Organization: a code can make its holder an employee of the owner's
 * organization. An employee signs in to their own account, and the
 * organization's pages — Projects & tasks, J.A.R.V.I.S. & the team, Sales &
 * finance, whichever the owner gave them — open onto the owner's workspace,
 * to see and change. What only the owner may do stays his: approving what
 * goes out (emails, tool calls), the money limit, plugins, connections and
 * the sending accounts. Everything an employee changes is logged under
 * their name.
 *
 *   __auth:access = { private, since, codes: [{ code, label, max, uses, org: { areas } | null, at, off }],
 *                     allowed: { <uid>: { at, via, label } }, members: { <uid>: { areas, at, via, name, email } } }
 *
 * Owner only:
 *   GET  /api/access
 *   POST /api/access { op: 'private', on } · { op: 'code', label, max, org: { areas } } · { op: 'withdraw', code }
 *                    { op: 'member', uid, areas } · { op: 'remove', uid }
 */
'use strict';
const crypto = require('crypto');

const KEY = '__auth:access';
const AREAS = ['projects', 'team', 'sales'];
const AREA_NAMES = { projects: 'Projects & tasks', team: 'J.A.R.V.I.S. & the team', sales: 'Sales & finance' };
/* never an employee's, whatever their areas: what goes out, what it costs, what is connected */
const OWNER_ONLY = [/^\/api\/team\/approve$/, /^\/api\/team\/limits$/, /^\/api\/team\/plugins$/, /^\/api\/team\/contacts$/, /^\/api\/team\/pause$/, /^\/api\/team\/agent(\/update)?$/, /^\/api\/team\/mail$/, /^\/api\/team\/_/];
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function mint() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = crypto.randomBytes(12); let s = '';
  for (let i = 0; i < 12; i++) s += A[b[i] % A.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
}

module.exports = function make(d) {
  /* d: { getJSON, setJSON, raw, USERS_KEY } */
  /* read on every request (sessions are checked against it): a few seconds in memory */
  let cache = null;
  async function state() {
    if (cache && Date.now() - cache.at < 3000) return JSON.parse(JSON.stringify(cache.s));
    const s0 = await state0(); cache = { at: Date.now(), s: s0 }; return JSON.parse(JSON.stringify(s0));
  }
  async function state0() {
    const v = await d.getJSON(KEY, null);
    const s = v && typeof v === 'object' ? v : {};
    return { private: !!s.private, since: s.since || 0, codes: Array.isArray(s.codes) ? s.codes : [], allowed: s.allowed && typeof s.allowed === 'object' ? s.allowed : {}, members: s.members && typeof s.members === 'object' ? s.members : {} };
  }
  const save = (s) => { cache = null; return d.setJSON(KEY, s); };

  function codeOf(s, given) { const n = norm(given); if (n.length < 8) return null; return s.codes.find((c) => !c.off && norm(c.code) === n && (c.max ? c.uses < c.max : true)) || null; }

  /* Before a session is made for rec: in, or the reason not. Redeems a code. */
  async function gate(rec, given) {
    const s = await state();
    if (rec.owner) return { ok: true };
    if (!s.private && !norm(given)) return { ok: true };
    if (s.allowed[rec.id] || s.members[rec.id]) return { ok: true };
    const c = codeOf(s, given);
    if (!c) return s.private ? { error: norm(given) ? 'That access code is not right, or it has been used up.' : 'This Flow is private. Enter the access code you were given.', needCode: true } : { ok: true };
    c.uses = (c.uses || 0) + 1;
    s.allowed[rec.id] = { at: Date.now(), via: c.code, label: c.label };
    if (c.org) s.members[rec.id] = { areas: (c.org.areas || []).filter((a) => AREAS.indexOf(a) >= 0), at: Date.now(), via: c.code, name: str(rec.name, 60), email: str(rec.email, 120) };
    await save(s);
    return { ok: true, member: !!c.org };
  }
  /* Signing up while private: a code is the invitation. */
  async function signupCode(given) { const s = await state(); return { private: s.private, code: codeOf(s, given) }; }

  /* An existing session: still allowed? */
  async function allowed(user) {
    if (!user || user.owner) return true;
    const s = await state();
    return !s.private || !!s.allowed[user.id] || !!s.members[user.id];
  }
  async function member(uid) { const s = await state(); return s.members[uid] || null; }

  /* An employee's /api/team request: which workspace, or no. */
  function teamScope(m, p, method) {
    if (!m) return null;
    if (OWNER_ONLY.some((re) => re.test(p)) && method !== 'GET') return { deny: 'Only the owner can do that.' };
    /* the organisation: every colleague, filtered to the projects they are on (flow-org) */
    if (p === '/api/team/org') return { ok: true };
    if (/^\/api\/team\/(projects)/.test(p)) return m.areas.indexOf('projects') >= 0 ? { ok: true } : { deny: 'Projects are not shared with you.' };
    if (/^\/api\/team\/(sales)/.test(p)) return m.areas.indexOf('sales') >= 0 ? { ok: true } : { deny: 'Sales and finance are not shared with you.' };
    if ((p === '/api/team' || p === '/api/team/connectors') && method === 'GET') return { ok: true };   /* enough to draw the room */
    if (/^\/api\/team\/(task|tasks|delegate)\b/.test(p) && m.areas.indexOf('projects') >= 0) return { ok: true };
    return m.areas.indexOf('team') >= 0 ? { ok: true } : { deny: 'J.A.R.V.I.S. and the team are not shared with you.' };
  }

  async function ownerUid() { const users = await d.getJSON(d.USERS_KEY, {}); const o = Object.values(users).find((u) => u.owner); return o ? o.id : null; }

  /* Everyone not allowed in any more: their sessions end now. */
  async function signOutOthers(s) {
    if (typeof d.raw.keys !== 'function') return 0;
    const users = await d.getJSON(d.USERS_KEY, {});
    const ownerIds = new Set(Object.values(users).filter((u) => u.owner).map((u) => u.id));
    const keys = await d.raw.keys('__auth:sess:*'); let n = 0;
    for (const k of keys || []) {
      const v = await d.getJSON(k, null);
      if (v && v.uid && !ownerIds.has(v.uid) && !s.allowed[v.uid] && !s.members[v.uid]) { await d.raw.set(k, ''); n++; }
    }
    return n;
  }
  async function dropSessionsOf(uid) {
    if (typeof d.raw.keys !== 'function') return 0;
    const keys = await d.raw.keys('__auth:sess:*'); let n = 0;
    for (const k of keys || []) { const v = await d.getJSON(k, null); if (v && v.uid === uid) { await d.raw.set(k, ''); n++; } }
    return n;
  }

  async function view() {
    const s = await state(); const users = await d.getJSON(d.USERS_KEY, {});
    const byId = {}; for (const u of Object.values(users)) byId[u.id] = u;
    const people = Object.values(users).filter((u) => !u.owner).map((u) => ({ id: u.id, name: u.name, email: u.email, allowed: !!s.allowed[u.id], member: s.members[u.id] ? { areas: s.members[u.id].areas } : null, created: u.created || null }));
    return { private: s.private, since: s.since, areas: AREAS.map((a) => ({ id: a, name: AREA_NAMES[a] })),
      codes: s.codes.filter((c) => !c.off).map((c) => ({ code: c.code, label: c.label, max: c.max, uses: c.uses || 0, org: c.org ? { areas: c.org.areas } : null, at: c.at })),
      people, counts: { people: people.length, allowed: people.filter((x) => x.allowed).length, members: people.filter((x) => x.member).length } };
  }

  async function handle(p, req, res, ctx) {
    if (p !== '/api/access') return false;
    const me = ctx.user; const json = ctx.json;
    if (!me) { json(res, 401, { error: 'Sign in first.' }); return true; }
    if (!me.owner) { json(res, 403, { error: 'Only the owner can change who uses this Flow.' }); return true; }
    if (req.method === 'GET') { json(res, 200, Object.assign({ ok: true }, await view())); return true; }
    if (req.method !== 'POST') { json(res, 405, { error: 'GET or POST.' }); return true; }
    let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
    const s = await state(); let extra = {};
    if (b.op === 'private') {
      s.private = !!b.on; if (s.private) s.since = Date.now();
      await save(s);
      if (s.private) extra.signedOut = await signOutOthers(s);
    } else if (b.op === 'code') {
      const org = b.org && typeof b.org === 'object' ? { areas: (Array.isArray(b.org.areas) ? b.org.areas : []).filter((a) => AREAS.indexOf(a) >= 0) } : null;
      if (org && !org.areas.length) { json(res, 400, { error: 'Choose at least one area to share.' }); return true; }
      const c = { code: mint(), label: str(b.label, 60) || (org ? 'Employee' : 'Guest'), max: Math.max(1, Math.min(50, Number(b.max) || 1)), uses: 0, org, at: Date.now(), off: false };
      s.codes.push(c); s.codes = s.codes.slice(-100); await save(s); extra.code = c.code;
    } else if (b.op === 'withdraw') {
      const c = s.codes.find((x) => norm(x.code) === norm(b.code)); if (c) c.off = true; await save(s);
    } else if (b.op === 'member') {
      const uid = str(b.uid, 40); const areas = (Array.isArray(b.areas) ? b.areas : []).filter((a) => AREAS.indexOf(a) >= 0);
      if (!areas.length) delete s.members[uid];
      else { const users = await d.getJSON(d.USERS_KEY, {}); const u = Object.values(users).find((x) => x.id === uid); if (!u || u.owner) { json(res, 404, { error: 'No such person.' }); return true; } s.members[uid] = Object.assign(s.members[uid] || { at: Date.now(), via: 'owner', name: u.name, email: u.email }, { areas }); s.allowed[uid] = s.allowed[uid] || { at: Date.now(), via: 'owner' }; }
      await save(s);
    } else if (b.op === 'remove') {
      const uid = str(b.uid, 40); delete s.allowed[uid]; delete s.members[uid]; await save(s);
      if (s.private) extra.signedOut = await dropSessionsOf(uid);
    } else { json(res, 400, { error: 'Unknown op.' }); return true; }
    json(res, 200, Object.assign({ ok: true }, extra, await view())); return true;
  }

  return { gate, signupCode, allowed, member, teamScope, ownerUid, handle, view, AREAS, AREA_NAMES };
};
