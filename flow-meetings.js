/* Meetings, brought in on their own.
 *
 * Fathom records a call (Zoom, Google Meet, Teams — Fathom sits on all of
 * them) and a few minutes later has a summary and a list of action items.
 * Until now somebody had to open Settings and press Import. This module does
 * the pressing: every few minutes, for every account with a Fathom key, it
 * asks for anything new since it last asked and files it.
 *
 * What "files it" means
 * ---------------------
 *   · The meeting — title, when, who was there, the recording link, the
 *     summary and every action item — is kept under `ld_meetings` in the
 *     person's own namespace, so the app can show the whole meeting behind
 *     any task that came out of it.
 *   · Action items are sorted by who owns them. Yours are marked `mine` and
 *     the app turns them into Big Rocks the next time it opens (on the day
 *     the wording names, or today). Ones nobody owns go to the inbox, where
 *     they are one tap from being yours. Other people's stay in the record:
 *     what they owe you, not what you owe them.
 *   · The person is told, by notification, that notes are ready and how
 *     many items are theirs. Opening the app is what files them.
 *
 * Why the server does not write the rocks itself
 * ----------------------------------------------
 * Big Rocks live in a section the app holds in memory and writes whole.
 * A rock written here while a phone has the app open would be overwritten
 * by the phone's next save and never seen. So the server appends to a
 * section the app only reads, and the app — which knows what it holds —
 * does the adding. The one write the server makes into shared state is the
 * inbox, which already belongs to it.
 */

const { Refused } = (() => { try { return require('./flow-connect')._internals; } catch (e) { return { Refused: Error }; } })();

const CURSOR = (uid) => '__meet:cursor:' + uid;
const INBOX = (uid) => '__share:inbox:' + uid;
const INBOX_MAX = 50;
const KEEP = 60;                 /* meetings kept per person */
const FATHOM = 'https://api.fathom.ai/external/v1';

const readJSON = async (raw, key, fallback) => {
  try {
    const v = await raw.get(key);
    if (v == null || v === '') return fallback;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { return fallback; }
};
const writeJSON = (raw, key, v) => raw.set(key, JSON.stringify(v));

/* ── Fathom ──────────────────────────────────────────────────────────── */
async function fathomMeetings(key, sinceISO, fetchFn) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({ created_after: sinceISO, include_summary: 'true', include_action_items: 'true' });
    if (cursor) q.set('cursor', cursor);
    const res = await fetchFn(FATHOM + '/meetings?' + q, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Refused('Fathom did not accept that key.');
    if (res.status === 429) throw new Refused('Fathom is busy.');
    if (!res.ok) throw new Error('Fathom answered ' + res.status);
    const j = await res.json();
    for (const m of (j.items || [])) out.push(m);
    cursor = j.next_cursor || '';
    if (!cursor) break;
  }
  return out;
}

/* ── When is this due? ───────────────────────────────────────────────────
   Action items are sentences, and people put the date in the sentence:
   "send the deck by Friday", "call them tomorrow", "revert the form before
   24 Oct". Read the common ways of saying it, in English and Turkish,
   relative to the day of the meeting. Nothing found means no date, and the
   app puts the item on today. Never a date in the past: "Monday" said on a
   Wednesday is next Monday. */
const DOW = {
  mon: 1, monday: 1, pazartesi: 1, pzt: 1,
  tue: 2, tues: 2, tuesday: 2, salı: 2, sali: 2,
  wed: 3, weds: 3, wednesday: 3, çarşamba: 3, carsamba: 3, çar: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, perşembe: 4, persembe: 4, per: 4,
  fri: 5, friday: 5, cuma: 5,
  sat: 6, saturday: 6, cumartesi: 6, cmt: 6,
  sun: 0, sunday: 0, pazar: 0
};
const MON = { jan: 0, january: 0, ocak: 0, feb: 1, february: 1, şubat: 1, subat: 1, mar: 2, march: 2, mart: 2,
  apr: 3, april: 3, nisan: 3, may: 4, mayıs: 4, mayis: 4, jun: 5, june: 5, haziran: 5, jul: 6, july: 6, temmuz: 6,
  aug: 7, august: 7, ağustos: 7, agustos: 7, sep: 8, sept: 8, september: 8, eylül: 8, eylul: 8,
  oct: 9, october: 9, ekim: 9, nov: 10, november: 10, kasım: 10, kasim: 10, dec: 11, december: 11, aralık: 11, aralik: 11 };

const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const atNoon = (y, m, d) => new Date(y, m, d, 12, 0, 0);

function dueFrom(text, meetingAt) {
  const t = String(text || '').toLowerCase().replace(/[’']/g, '');
  const base = meetingAt ? new Date(meetingAt) : new Date();
  if (isNaN(base)) return '';
  const b0 = atNoon(base.getFullYear(), base.getMonth(), base.getDate());
  const notPast = (d) => (d < b0 ? '' : iso(d));
  let m;

  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) return notPast(atNoon(+m[1], +m[2] - 1, +m[3]));
  /* 24 Oct, 24 October, 24 Ekim, Oct 24, October 24th */
  const monAlt = Object.keys(MON).sort((a, b) => b.length - a.length).join('|');
  if ((m = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + monAlt + ')\\b').exec(t)) ||
      (m = new RegExp('\\b(' + monAlt + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b').exec(t))) {
    const day = +(isNaN(+m[1]) ? m[2] : m[1]), mon = MON[isNaN(+m[1]) ? m[1] : m[2]];
    /* A day already gone is a reference to the past ("the Oct 5 review"),
       not an appointment next year. */
    return notPast(atNoon(base.getFullYear(), mon, day));
  }
  /* 24/10, 24.10 (day first, as this app's people write it) */
  if ((m = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/.exec(t)) && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) {
    let y = m[3] ? +m[3] : base.getFullYear(); if (y < 100) y += 2000;
    return notPast(atNoon(y, +m[2] - 1, +m[1]));
  }
  if (/\b(today|bugün|bugun)\b/.test(t)) return iso(b0);
  if (/\b(tomorrow|yarın|yarin)\b/.test(t)) { const d = new Date(b0); d.setDate(d.getDate() + 1); return iso(d); }
  if (/\b(end of (the )?week|eow|by (the )?weekend|hafta sonuna kadar|haftaya kadar|bu hafta)\b/.test(t)) {
    const d = new Date(b0); const dow = d.getDay(); d.setDate(d.getDate() + ((5 - dow + 7) % 7 || (dow === 5 ? 0 : 7))); return iso(d);
  }
  if (/\b(next week|haftaya|gelecek hafta|önümüzdeki hafta|onumuzdeki hafta)\b/.test(t)) {
    const d = new Date(b0); const dow = d.getDay(); d.setDate(d.getDate() + ((8 - dow) % 7 || 7)); return iso(d);
  }
  if (/\b(end of (the )?month|ay sonuna kadar|ay sonu)\b/.test(t)) return iso(atNoon(base.getFullYear(), base.getMonth() + 1, 0));
  const dowAlt = Object.keys(DOW).sort((a, b) => b.length - a.length).join('|');
  if ((m = new RegExp('(?:^|[^a-zçğıöşü])(' + dowAlt + ')(?:[^a-zçğıöşü]|$)').exec(t))) {
    const want = DOW[m[1]], d = new Date(b0);
    let diff = (want - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
    d.setDate(d.getDate() + diff); return iso(d);
  }
  return '';
}

/* ── One meeting, as the app keeps it ────────────────────────────────── */
function shape(m, me) {
  const mine = String(me || '').toLowerCase();
  const at = String(m.recording_start_time || m.scheduled_start_time || m.created_at || '');
  const actions = (m.action_items || []).filter((a) => a && a.description).map((a, i) => {
    const email = String(((a.assignee || {}).email) || '').toLowerCase();
    return {
      n: i,
      text: String(a.description).replace(/\s+/g, ' ').trim().slice(0, 300),
      who: String(((a.assignee || {}).name) || ''),
      email,
      done: !!a.completed,
      mine: !!(email && mine && email === mine),
      due: dueFrom(a.description, at)
    };
  });
  return {
    id: String(m.recording_id != null ? m.recording_id : (m.share_url || m.url || '')),
    source: 'fathom',
    title: String(m.title || m.meeting_title || 'Meeting').slice(0, 200),
    at,
    end: String(m.recording_end_time || m.scheduled_end_time || ''),
    url: String(m.share_url || m.url || ''),
    people: (m.calendar_invitees || []).slice(0, 30).map((p) => ({ name: String(p.name || ''), email: String(p.email || ''), ext: !!p.is_external })),
    summary: String(((m.default_summary || {}).markdown_formatted) || '').slice(0, 8000),
    actions
  };
}

/* ── One person ──────────────────────────────────────────────────────── */
async function pullUser(deps, uid, now) {
  const { raw, nsPrefix, fetch: fetchFn } = deps;
  const connect = deps.connect;
  const accounts = await connect.readAccounts(raw, uid, 'fathom');
  if (!accounts.length) return { uid, skipped: 'no fathom' };

  const pre = nsPrefix(uid);
  const cur = (await readJSON(raw, CURSOR(uid), {})) || {};
  const have = (await readJSON(raw, pre + 'ld_meetings', [])) || [];
  const haveIds = new Set(have.map((x) => x && x.id));
  /* Meetings the app imported by hand, before this existed. */
  let seen = [];
  try { seen = (((await readJSON(raw, pre + 'ld_connSeen', {})) || {}).fathom) || []; } catch (e) {}
  const seenIds = new Set(seen);

  /* The first pass for a person reaches back a month, so the meetings behind
     the rocks they already have (filed by hand, before this existed) are on
     record too — the notes can then sit under those rocks like any other.
     Everything that old is kept as a record only: no rock is made from a
     three-week-old action item on the day this starts. */
  const backfilled = !!cur.backfilled;
  const sinceMs = (cur.at && backfilled) ? Date.parse(cur.at) : (now - 30 * 86400000);
  const since = new Date(Math.max(sinceMs - 5 * 60000, now - 30 * 86400000)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const recentMs = cur.at ? Date.parse(cur.at) - 5 * 60000 : now - 3 * 86400000;

  const fresh = [];
  const records = [];
  const problems = [];
  for (const acc of accounts) {
    let list = [];
    try { list = await fathomMeetings(acc.key, since, fetchFn); }
    catch (e) { problems.push({ account: acc.email || acc.aid, error: e.message }); continue; }
    for (const m of list) {
      const s = shape(m, acc.email);
      s.me = acc.email || '';
      if (!s.id || haveIds.has(s.id)) continue;
      /* Fathom lists a meeting before its summary is written. Wait for it:
         the next tick will see it finished. */
      if (!s.summary && !s.actions.length) continue;
      haveIds.add(s.id);
      const old = s.at && Date.parse(s.at) < recentMs;
      if (seenIds.has(s.id) || (old && !backfilled)) { s.legacy = true; records.push(s); }
      else fresh.push(s);
    }
  }
  const stamp = { at: new Date(now).toISOString(), backfilled: true };
  if (!fresh.length && !records.length) {
    if (!problems.length) await writeJSON(raw, CURSOR(uid), stamp);
    return { uid, added: 0, problems };
  }

  const all = records.concat(fresh).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const next = have.concat(all).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-KEEP);
  await writeJSON(raw, pre + 'ld_meetings', next);
  await writeJSON(raw, CURSOR(uid), stamp);
  if (!fresh.length) return { uid, added: 0, recorded: records.length, problems };

  /* What nobody owns goes to the inbox: one tap from being yours. */
  let queued = 0;
  const inbox = (await readJSON(raw, INBOX(uid), [])) || [];
  for (const s of fresh) {
    for (const a of s.actions) {
      if (a.done || a.mine || a.email) continue;
      if (inbox.length >= INBOX_MAX) break;
      inbox.push({
        id: require('crypto').randomBytes(8).toString('hex'),
        at: new Date(now).toISOString(),
        from: { name: 'Fathom · ' + s.title, via: 'inbox', meeting: s.id },
        task: Object.assign({ txt: a.text, note: 'From the meeting "' + s.title + '"' + (s.url ? ' — ' + s.url : '') }, a.due ? { due: a.due } : {})
      });
      queued++;
    }
  }
  if (queued) await writeJSON(raw, INBOX(uid), inbox);

  const mine = fresh.reduce((n, s) => n + s.actions.filter((a) => a.mine && !a.done).length, 0);
  if (deps.sendToUser) {
    const one = fresh.length === 1;
    try {
      await deps.sendToUser(raw, uid, {
        title: one ? 'Meeting notes: ' + fresh[0].title : fresh.length + ' meetings have notes',
        body: (mine ? mine + ' action item' + (mine === 1 ? '' : 's') + ' for you' : 'No action items for you') +
              (queued ? ', ' + queued + ' unassigned in your inbox' : '') + '. Open The Flow to file them.',
        thread: 'meetings',
        data: { meetings: fresh.map((s) => s.id) }
      });
    } catch (e) {}
  }
  return { uid, added: fresh.length, mine, queued, problems };
}

async function tick(deps, now) {
  now = now || Date.now();
  let uids = [];
  try { uids = await deps.users(); } catch (e) { return []; }
  const out = [];
  for (const uid of uids) {
    try { out.push(await pullUser(deps, uid, now)); }
    catch (e) { deps.log && deps.log('[flow/meetings] ' + uid + ': ' + e.message); out.push({ uid, error: e.message }); }
  }
  return out;
}

let timer = null;
function start(deps) {
  if (timer) return timer;
  const every = deps.everyMs || 10 * 60 * 1000;
  timer = setInterval(() => { tick(deps).catch(() => {}); }, every);
  if (timer.unref) timer.unref();
  /* Once soon after start, so a redeploy does not cost anyone ten minutes. */
  const first = setTimeout(() => { tick(deps).catch(() => {}); }, 20 * 1000);
  if (first.unref) first.unref();
  return timer;
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

/* POST /api/meetings/pull — the Import button, and "check now". */
async function handle(req, res, ctx) {
  const { path: p, uid, json } = ctx;
  if (p !== '/api/meetings/pull' || req.method !== 'POST') return false;
  if (!uid) { json(res, 401, { error: 'Sign in first.' }); return true; }
  try {
    const r = await pullUser(ctx.deps, uid, Date.now());
    json(res, 200, Object.assign({ ok: true }, r));
  } catch (e) { json(res, 502, { error: e.message }); }
  return true;
}

module.exports = { tick, pullUser, start, stop, handle, _internals: { dueFrom, shape, fathomMeetings, CURSOR, KEEP } };
