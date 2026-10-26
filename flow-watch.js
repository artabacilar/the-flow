/* The Flow on a watch — Apple Watch and Wear OS.
 *
 * A watch is a glance and a tap. It gets today in one short read: the Big
 * Rocks set for today and the ones that slipped from earlier this week, what
 * is next, and today's habits. It can tick a rock or a habit, and it can add
 * a Big Rock or a note that was dictated into it. Nothing else — planning a
 * week on a 45 mm screen is not a thing anybody wants.
 *
 * Who is asking is settled before this file is reached: flow-auth's gate()
 * resolves the watch's bearer token to an account and scopes `store` to it,
 * exactly as it does for the widget and for an assistant. So everything here
 * reads and writes one person's own keys and nothing more.
 *
 * Time is the watch's, not the server's. The server runs in UTC; somebody in
 * Istanbul at 01:30 is on a different day from it. The watch sends its zone
 * (`tz`), the account's own setting is next, and Istanbul is the fallback —
 * the same order flow-remind.js uses, so a reminder and the watch never
 * disagree about what "today" is.
 */
let remind = null;
try { remind = require('./flow-remind.js'); } catch (e) { remind = null; }

const DEFAULT_TZ = 'Europe/Istanbul';
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function readJSON(store, key, fallback) {
  try {
    const v = await store.get(key);
    if (v == null || v === '') return fallback;
    if (typeof v === 'object') return v;
    return JSON.parse(v);
  } catch (e) { return fallback; }
}
const writeJSON = (store, key, val) => store.set(key, JSON.stringify(val));
const newId = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4);

function validTz(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return tz; } catch (e) { return null; }
}

/* Their clock, as parts. Borrowed from the reminder tick when it is there so
   the two can never drift; a copy of the same rule when it is not. */
function clock(tz, now) {
  if (remind && remind._internals && remind._internals.localParts) {
    const L = remind._internals.localParts(tz, now);
    return { date: L.date, hhmm: L.hhmm, day: L.day, wid: remind._internals.weekIdFromDate(L.date) };
  }
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = {}; f.formatToParts(now).forEach((x) => { p[x.type] = x.value; });
  const date = p.year + '-' + p.month + '-' + p.day;
  const SHORT = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { date, hhmm: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute, day: SHORT[p.weekday], wid: isoWeek(date) };
}
function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dn = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dn + 3);
  const fy = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(fy, 0, 4));
  const wk = 1 + Math.round(((t - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return fy + '-W' + String(wk).padStart(2, '0');
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

async function zoneFor(store, asked) {
  const t = validTz(asked);
  if (t) return t;
  const s = await readJSON(store, 'flow:settings', {}) || {};
  return validTz(s.timezone) || DEFAULT_TZ;
}

/* ---------- today, as a watch reads it ---------------------------------- */

const clean = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();

async function today(store, opts) {
  opts = opts || {};
  const tz = await zoneFor(store, opts.tz);
  const L = clock(tz, opts.now || new Date());
  const c = await readJSON(store, 'ld_compass', {}) || {};
  const week = ((c.rocks || {})[L.wid] || []).filter((r) => r && typeof r === 'object');
  const view = (r, overdue) => ({
    id: String(r.id), title: clean(r.title).slice(0, 140) || 'Untitled',
    time: r.time || null, done: !!r.done, overdue: !!overdue,
    prio: r.prio || 'med', day: DAY_SHORT[r.day] || null
  });
  const byTime = (a, b) => (a.day - b.day) || String(a.time || '99:99').localeCompare(String(b.time || '99:99'));
  const mine = week.filter((r) => r.day === L.day).sort(byTime);
  const late = week.filter((r) => !r.done && typeof r.day === 'number' && r.day >= 0 && r.day < L.day).sort(byTime);
  const ahead = week.filter((r) => !r.done && typeof r.day === 'number' && r.day > L.day).sort(byTime);

  /* Open first — the next one at the top — then what slipped, then what is
     already done, so a finished day reads as finished at a glance. */
  const openToday = mine.filter((r) => !r.done);
  const rocks = openToday.map((r) => view(r, false))
    .concat(late.map((r) => view(r, true)))
    .concat(mine.filter((r) => r.done).map((r) => view(r, false)));

  const nextRock = openToday.find((r) => r.time && r.time >= L.hhmm) || openToday[0] || late[0] || ahead[0] || null;
  let next = null;
  if (nextRock) {
    const isToday = nextRock.day === L.day, isLate = !isToday && nextRock.day < L.day;
    next = {
      id: String(nextRock.id), title: clean(nextRock.title).slice(0, 140),
      when: isToday ? (nextRock.time ? 'Today ' + nextRock.time : 'Today')
        : isLate ? 'Overdue · ' + DAY_SHORT[nextRock.day]
        : (nextRock.day === L.day + 1 ? 'Tomorrow' : DAY_SHORT[nextRock.day]) + (nextRock.time ? ' ' + nextRock.time : '')
    };
  }

  const hb = await readJSON(store, 'ld_habits', { habits: [], completions: {} }) || {};
  const comp = hb.completions || {};
  const habits = (Array.isArray(hb.habits) ? hb.habits : []).filter((h) => h && h.id != null && h.name)
    .slice(0, 30)
    .map((h) => ({ id: String(h.id), name: clean(h.name).slice(0, 60), done: !!(comp[h.id] && comp[h.id][L.date]) }));

  return {
    date: L.date, weekday: DAY_LONG[L.day], now: L.hhmm, tz,
    counts: { today: openToday.length, todayDone: mine.length - openToday.length, overdue: late.length },
    headline: headline(openToday.length, late.length, mine.length, week),
    next, rocks, habits,
    week: { id: L.wid, done: week.filter((r) => r.done).length, total: week.length, more: ahead.length },
    updated: new Date().toISOString()
  };
}

/* The same sentence the Today card says, so the watch and the phone agree. */
function headline(n, late, todayAll, week) {
  if (!week.length) return 'Nothing set for this week.';
  if (week.every((r) => r.done)) return 'All ' + week.length + ' Big Rocks done.';
  if (n) return n + ' Big Rock' + (n === 1 ? '' : 's') + ' for today' + (late ? ', ' + late + ' overdue.' : '.');
  if (late) return 'Nothing left for today, ' + late + ' overdue.';
  if (todayAll) return 'Today’s Big Rocks are done.';
  return 'Nothing due today.';
}

/* ---------- what a watch may change -------------------------------------- */

class WatchError extends Error { constructor(msg, code) { super(msg); this.code = code || 400; } }

async function note(store, txt) {
  const j = await readJSON(store, 'ld_journal', []);
  const list = Array.isArray(j) ? j : [];
  list.push({ t: new Date().toISOString(), cat: 'planning', txt });
  await writeJSON(store, 'ld_journal', list);
}

async function act(store, b, opts) {
  opts = opts || {};
  const via = /wear/i.test(String(opts.device || '')) ? 'Wear OS watch' : 'Apple Watch';
  const tz = await zoneFor(store, b.tz || opts.tz);
  const L = clock(tz, opts.now || new Date());
  const action = String(b.action || '');

  if (action === 'rock') {
    const id = String(b.id || '');
    const c = await readJSON(store, 'ld_compass', null);
    if (!c || !c.rocks) throw new WatchError('That Big Rock is not there any more.', 404);
    let hit = null;
    for (const wid of Object.keys(c.rocks)) {
      const r = (c.rocks[wid] || []).find((x) => x && String(x.id) === id);
      if (r) { hit = r; break; }
    }
    if (!hit) throw new WatchError('That Big Rock is not there any more.', 404);
    const want = b.done == null ? !hit.done : !!b.done;
    if (!!hit.done !== want) {
      hit.done = want;
      await writeJSON(store, 'ld_compass', c);
      await note(store, (want ? '✅ Big rock done on ' : '↩️ Big rock reopened on ') + via + ': ' + hit.title);
    }
    return;
  }

  if (action === 'habit') {
    const id = String(b.id || '');
    const hb = await readJSON(store, 'ld_habits', null);
    const h = hb && Array.isArray(hb.habits) && hb.habits.find((x) => x && String(x.id) === id);
    if (!h) throw new WatchError('That habit is not there any more.', 404);
    if (!hb.completions) hb.completions = {};
    if (!hb.completions[h.id]) hb.completions[h.id] = {};
    const want = b.done == null ? !hb.completions[h.id][L.date] : !!b.done;
    if (want) hb.completions[h.id][L.date] = true; else delete hb.completions[h.id][L.date];
    await writeJSON(store, 'ld_habits', hb);
    return;
  }

  if (action === 'add') {
    const text = String(b.text || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new WatchError('Say or type something first.');
    if (text.length > 500) throw new WatchError('That is long for a watch — keep it under 500 characters.');
    if (b.kind === 'note') {
      const j = await readJSON(store, 'flow:journal', []);
      const list = Array.isArray(j) ? j : [];
      const now = new Date().toISOString();
      list.push({ id: 'j' + newId(), created: now, updated: now, date: L.date, title: '', body: text, tags: ['quick', 'watch'], prompts: {}, mood: null, energy: null });
      await writeJSON(store, 'flow:journal', list);
      return;
    }
    const date = b.day === 'tomorrow' ? addDays(L.date, 1) : L.date;
    const wid = isoWeek(date);
    const [y, m, d] = date.split('-').map(Number);
    const day = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const c = await readJSON(store, 'ld_compass', null) || { mission: '', roles: [], rocks: {}, saw: {}, reviews: {} };
    if (!c.rocks) c.rocks = {};
    if (!c.rocks[wid]) c.rocks[wid] = [];
    if (c.rocks[wid].length >= 200) throw new WatchError('That week is full.');
    const title = text.slice(0, 300);
    c.rocks[wid].push({ id: newId(), title, role: '', day, time: '', end: '', prio: 'med', note: '', done: false });
    await writeJSON(store, 'ld_compass', c);
    await note(store, '🪨 Big rock added on ' + via + ' (' + wid + '): ' + title);
    return;
  }

  throw new WatchError('A watch can tick a rock or a habit, or add one. "' + action.slice(0, 20) + '" is not one of those.');
}

/* ---------- the route ---------------------------------------------------- */

async function handle(req, res, store, ctx) {
  const u = new URL(req.url, 'http://localhost');
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const device = req.headers['x-flow-device'] || '';
  try {
    if (req.method === 'GET') return send(200, await today(store, { tz: u.searchParams.get('tz') }));
    if (req.method === 'POST') {
      let b = {};
      try { b = JSON.parse(await ctx.readBody(req) || '{}') || {}; } catch (e) { return send(400, { error: 'That was not JSON.' }); }
      await act(store, b, { device, tz: u.searchParams.get('tz') });
      return send(200, await today(store, { tz: b.tz || u.searchParams.get('tz') }));
    }
    res.setHeader('Allow', 'GET, POST');
    return send(405, { error: 'GET reads today; POST ticks or adds.' });
  } catch (e) {
    if (e instanceof WatchError) return send(e.code, { error: e.message });
    return send(500, { error: 'Something went wrong on the server.' });
  }
}

module.exports = { handle, today, act, _internals: { clock, isoWeek, addDays, headline, validTz, clean, WatchError } };
