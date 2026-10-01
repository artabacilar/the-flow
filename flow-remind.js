/* The thing that decides when.
 *
 * flow-push.js can reach a phone. On its own that is half a feature: nothing
 * ever asks it to. This is the other half — a minute tick that looks at what
 * each person planned for today and sends the one at 09:00 at 09:00.
 *
 * Three decisions worth stating, because each is a way this goes wrong quietly
 *
 * 1 · The clock is theirs, not the server's.
 *     Render runs in UTC. Somebody in Istanbul who writes 09:00 means 09:00
 *     where they are, and a scheduler that used the server's hour would fire
 *     at noon for them — reliably, every day, with nothing in any log looking
 *     wrong. So every comparison below happens in the timezone the person has
 *     in their own settings.
 *
 * 2 · A minute that was missed is not a minute that never mattered.
 *     Exact equality on HH:MM means a deploy, a cold start or one slow tick
 *     silently drops that reminder forever. So a rock is due if its time fell
 *     inside the last few minutes and it has not been sent. The window is
 *     small on purpose: wide enough to survive a restart, narrow enough that
 *     coming back after an outage does not deliver the whole morning at once.
 *
 * 3 · Sent is remembered, per day, in the store.
 *     Otherwise a restart re-sends everything already sent, which is the
 *     failure people actually notice and never forgive.
 */

const DEFAULT_TZ = 'Europe/Istanbul';
const WINDOW_MIN = 6;          /* how late a reminder may still be worth sending */
const SENT_KEY = (uid) => '__push:sent:' + uid;

/* ── Their clock ──────────────────────────────────────────────────────────
   Intl is the only thing in Node that knows what time it is somewhere else
   without a timezone database of our own. An unknown zone throws rather than
   guessing, so a typo in somebody's settings falls back instead of taking the
   tick down for everybody. */
function localParts(tz, now) {
  let f;
  try {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || DEFAULT_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short'
    });
  } catch (e) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: DEFAULT_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short'
    });
  }
  const p = {};
  f.formatToParts(now).forEach((x) => { p[x.type] = x.value; });
  /* 24:00 is midnight on the next formatted day in some ICU versions. */
  const hour = p.hour === '24' ? '00' : p.hour;
  const SHORT = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    date: p.year + '-' + p.month + '-' + p.day,
    hhmm: hour + ':' + p.minute,
    day: SHORT[p.weekday],
    minutes: Number(hour) * 60 + Number(p.minute)
  };
}

/* ISO week, from the parts rather than a Date, so the server's own zone can
   never shift it. Deliberately the same rule flow-mcp.js uses — a test
   asserts the two agree across a span of dates, because a disagreement would
   put a reminder in a week the app does not show. */
function weekIdFromDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((dt - y0) / 86400000 + 1) / 7);
  return dt.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
}

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/* Due = its time fell inside the window ending now. Never in the future, so a
   reminder is never early; never older than the window, so an outage does not
   deliver a backlog. */
function dueNow(rocks, nowMinutes, windowMin) {
  return rocks.filter((r) => {
    if (!r || r.done) return false;
    const t = toMinutes(r.time);
    if (t == null) return false;
    const age = nowMinutes - t;
    return age >= 0 && age < windowMin;
  });
}

const readJSON = async (raw, key, fallback) => {
  try {
    const v = await raw.get(key);
    if (v == null) return fallback;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { return fallback; }
};

/* One person, one tick. Returns what it did so the caller — and the tests —
   can see the decision rather than infer it from a side effect. */
async function tickUser(deps, uid, now) {
  const { raw, sendToUser, nsPrefix } = deps;
  const pre = nsPrefix(uid);

  const devices = await readJSON(raw, '__push:dev:' + uid, []);
  if (!Array.isArray(devices) || !devices.length) return { uid, skipped: 'no device' };

  const settings = await readJSON(raw, pre + 'flow:settings', {}) || {};
  /* Opt-out, not opt-in: somebody who has gone to the trouble of allowing
     notifications is asking to be reminded. The switch exists for the person
     who wants a test and nothing else. */
  if (settings.pushRemindRocks === false) return { uid, skipped: 'turned off' };

  const L = localParts(settings.timezone, now);
  const compass = await readJSON(raw, pre + 'ld_compass', {}) || {};
  const rocks = ((compass.rocks || {})[weekIdFromDate(L.date)] || []).filter((r) => r && r.day === L.day);

  const sent = await readJSON(raw, SENT_KEY(uid), {}) || {};
  /* A new day starts an empty list rather than growing one forever. */
  const already = sent.date === L.date && Array.isArray(sent.ids) ? sent.ids : [];

  const due = dueNow(rocks, L.minutes, WINDOW_MIN)
    .filter((r) => already.indexOf(String(r.id)) < 0);
  if (!due.length) return { uid, skipped: 'nothing due', at: L.hhmm, tz: settings.timezone || DEFAULT_TZ };

  const delivered = [];
  for (const r of due) {
    const out = await sendToUser(raw, uid, {
      title: r.title || 'Big Rock',
      body: r.note ? String(r.note).split('\n')[0].slice(0, 160) : ('It is ' + r.time + '.'),
      thread: 'rocks',
      data: { rock: String(r.id), date: L.date }
    });
    /* Recorded whatever Apple said. A send that failed for a reason of ours
       should not be retried every minute for the rest of the day — and one
       that failed because the device is gone has already been pruned. */
    delivered.push(String(r.id));
    if (!out || !out.ok) deps.log && deps.log('[flow/remind] ' + uid + ': ' + ((out && out.error) || 'send failed'));
  }
  await raw.set(SENT_KEY(uid), JSON.stringify({ date: L.date, ids: already.concat(delivered) }));
  return { uid, sent: delivered.length, at: L.hhmm, tz: settings.timezone || DEFAULT_TZ };
}

async function tick(deps, now) {
  now = now || new Date();
  let uids = [];
  try { uids = await deps.users(); } catch (e) { return []; }
  const out = [];
  for (const uid of uids) {
    try { out.push(await tickUser(deps, uid, now)); }
    catch (e) {
      /* One account's bad data must never stop the other accounts' reminders. */
      deps.log && deps.log('[flow/remind] ' + uid + ' failed: ' + e.message);
      out.push({ uid, error: e.message });
    }
  }
  return out;
}

let timer = null;
function start(deps) {
  if (timer) return timer;
  /* A minute, offset a little off the minute boundary so this is not competing
     with every other cron on the box at :00. */
  timer = setInterval(() => { tick(deps).catch(() => {}); }, 60 * 1000);
  if (timer.unref) timer.unref();
  return timer;
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = {
  tick, tickUser, start, stop,
  _internals: { localParts, weekIdFromDate, dueNow, toMinutes, WINDOW_MIN, SENT_KEY, DEFAULT_TZ }
};
