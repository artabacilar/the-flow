/* =========================================================================
 * The Flow — MCP server
 *
 * Lets somebody point Claude at their own Flow: read the week, add what they
 * mean to do, and shape the app to their own words. One HTTP endpoint, JSON-RPC
 * in and out, speaking the Model Context Protocol.
 *
 * Three things are deliberately true of this file.
 *
 * It never deletes. Every write here either creates something or changes
 * something that already exists; removing a rock, a habit or a line stays a
 * human action taken in the app. An assistant misreading "clear my week" should
 * cost somebody an eyebrow, not six months of record.
 *
 * It owns no isolation logic. Authentication happens in flow-auth's gate(),
 * which resolves the bearer token to an account and puts that id into the async
 * context. By the time anything here runs, `store` is already the protected
 * store — every key it touches is that person's and no one else's. There is no
 * second copy of that rule to drift out of step with the first.
 *
 * It writes the shapes the app already reads. A rock added here is the same
 * object the Week Compass would have written, in the same week bucket, with the
 * same fields. Nothing needs a migration, and nothing looks like it came from
 * somewhere else.
 * ====================================================================== */

const PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const VERSION = '1.0.0';

/* ---------- dates: the same week arithmetic the app uses ----------------- */

/* ISO-8601 week. Must agree with weekId() in life-dashboard.html down to the
   edge cases, or a rock added through here lands in a bucket the Compass never
   looks in — saved, silent, and gone. */
function weekId(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((dt - y0) / 86400000 + 1) / 7);
  return dt.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
}
const localISO = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
                        String(d.getDate()).padStart(2, '0');
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/* Monday is 0 here, as it is everywhere in the app. */
const dayIndex = (d) => (d.getDay() + 6) % 7;

/* What somebody actually types when they say when. "tomorrow", "friday",
   "2026-09-18" — all of it has to land on one real date, because a day the
   parser shrugs at is a task that quietly goes nowhere. */
function parseDay(input, now) {
  const raw = String(input == null ? '' : input).trim().toLowerCase();
  now = now || new Date();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = Number(iso[1]), mo = Number(iso[2]), da = Number(iso[3]);
    const d = new Date(y, mo - 1, da);
    /* JavaScript rolls an impossible date forward rather than refusing it, so
       "2026-13-45" quietly becomes some day in February. A task on a date
       nobody chose is worse than one that was never added, so the only proof
       the date was real is that it survives the round trip unchanged. */
    if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
  }
  if (raw === 'today') return new Date(now);
  if (raw === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); return d; }
  if (raw === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); return d; }

  const m = raw.match(/^(?:(next|this)\s+)?(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*$/);
  if (m) {
    const want = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
      .indexOf(m[2].slice(0, 3) === 'tue' ? 'tue' : m[2].slice(0, 3));
    if (want < 0) return null;
    const d = new Date(now);
    const cur = dayIndex(d);
    let delta = want - cur;
    /* "Friday" said on a Saturday means the Friday coming, not the one gone.
       "next Friday" always means the week after this one. */
    if (m[1] === 'next') delta += 7;
    else if (delta < 0) delta += 7;
    d.setDate(d.getDate() + delta);
    return d;
  }
  return null;
}

/* 24-hour HH:MM or nothing. A half-parsed time is worse than none: it puts a
   task on the board at an hour nobody chose. */
function parseTime(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (m) {
    let h = Number(m[1]); const mi = Number(m[2] || 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    const pm = m[3].toLowerCase() === 'pm';
    if (h === 12) h = 0;
    if (pm) h += 12;
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }
  return null;
}

const PRIOS = { high: 'high', med: 'med', medium: 'med', normal: 'med', low: 'low' };
const PRIO_LABEL = { high: 'high', med: 'medium', low: 'low' };

/* ---------- the store, in the app's own shapes -------------------------- */

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

/* Every write is also a line in the journal, in the same voice the app uses
   when you do it by hand. Somebody scrolling their record a month from now
   should be able to see that this came from Claude, and what it was. */
async function journal(store, cat, txt) {
  const j = await readJSON(store, 'ld_journal', []);
  j.push({ t: new Date().toISOString(), cat: cat, txt: txt });
  await writeJSON(store, 'ld_journal', j);
}

async function compass(store) {
  const c = await readJSON(store, 'ld_compass', null) ||
            { mission: '', roles: [], rocks: {}, saw: {}, reviews: {} };
  if (!c.rocks) c.rocks = {};
  if (!c.saw) c.saw = {};
  if (!c.reviews) c.reviews = {};
  if (!Array.isArray(c.roles)) c.roles = [];
  return c;
}

/* A rock can be in any week bucket, and "move it to Thursday" may mean moving
   it between buckets. Finding one means looking everywhere. */
function findRock(c, id) {
  for (const wid of Object.keys(c.rocks || {})) {
    const list = c.rocks[wid] || [];
    const i = list.findIndex(r => r && r.id === id);
    if (i >= 0) return { wid, index: i, rock: list[i] };
  }
  return null;
}

function rockView(r, wid) {
  return {
    id: r.id,
    title: r.title,
    day: DAY_LONG[r.day] || null,
    date: null,
    time: r.time || null,
    end: r.end || null,
    priority: PRIO_LABEL[r.prio] || 'medium',
    role: r.role || null,
    note: r.note || null,
    done: !!r.done,
    week: wid
  };
}
/* The week id alone does not tell you what date a rock falls on, and a date is
   what anybody actually wants back. */
function datesOfWeek(wid) {
  const m = String(wid || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]), week = Number(m[2]);
  /* 4 January is always in ISO week 1. */
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
}

/* ---------- the tools --------------------------------------------------- */

const TOOLS = [
  {
    name: 'get_week',
    title: 'Read a week',
    description:
      'The Big Rocks planned for a week, day by day, with times, priorities and what is already done — ' +
      'plus that week\'s Sharpen the Blade commitments. This is the plan, not the record: use it before ' +
      'adding anything, so you can see what is already there and on which day.',
    inputSchema: {
      type: 'object',
      properties: {
        week: {
          type: 'string',
          description: 'Which week: "this" (default), "next", "last", or an ISO week like "2026-W38".'
        }
      }
    }
  },
  {
    name: 'get_today',
    title: 'Read today',
    description:
      'What is on today, ordered from now forward, with anything overdue marked. The answer to ' +
      '"what should I be doing" and "what did I miss".',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_scoreboard',
    title: 'Read the scoreboard',
    description:
      'The numbers: habit streaks and this week\'s completions, training sessions done against the plan, ' +
      'sleep and mood averages. What the record says, rather than what was intended.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add_rock',
    title: 'Add a Big Rock',
    description:
      'Put something on the week. A Big Rock is The Flow\'s task: a title, a day, optionally a time and ' +
      'an end time, a priority and a note. It appears on the Week Compass and on Today. ' +
      'Links pasted into the note are clickable there, so a meeting URL belongs in the note.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What the thing is. Required.' },
        day: {
          type: 'string',
          description:
            'When: "today", "tomorrow", a weekday like "friday" or "next friday", or a date as ' +
            'YYYY-MM-DD. Defaults to today.'
        },
        time: { type: 'string', description: 'Start time, 24-hour "HH:MM" or "9am". Optional.' },
        end: { type: 'string', description: 'End time, same format. Optional.' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Defaults to medium.' },
        role: { type: 'string', description: 'Which part of life this belongs to — one of the roles on the Compass.' },
        note: { type: 'string', description: 'Detail, context, or a meeting link. Optional.' }
      },
      required: ['title']
    }
  },
  {
    name: 'update_rock',
    title: 'Change a Big Rock',
    description:
      'Change something already on the week: retitle it, move it to another day or time, change its ' +
      'priority or note, or mark it done or not done. Moving it across a week boundary moves it to the ' +
      'right week automatically. Only the fields you pass are changed. This cannot remove a rock — ' +
      'that stays something a person does in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The rock\'s id, from get_week or get_today. Required.' },
        title: { type: 'string' },
        day: { type: 'string', description: 'Same formats as add_rock.' },
        time: { type: 'string' },
        end: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        role: { type: 'string' },
        note: { type: 'string' },
        done: { type: 'boolean', description: 'Mark it done, or reopen it.' }
      },
      required: ['id']
    }
  },
  {
    name: 'add_habit',
    title: 'Add a habit',
    description:
      'Start tracking something done daily, with a streak. Use this rather than add_rock when the thing ' +
      'repeats every day — "read twenty minutes" is a habit; "read chapter four on Thursday" is a rock.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'What the habit is. Required.' } },
      required: ['name']
    }
  },
  {
    name: 'log_habit',
    title: 'Tick a habit',
    description: 'Record that a habit was done on a day — today unless you say otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        habit: { type: 'string', description: 'The habit\'s name or id. Required.' },
        day: { type: 'string', description: '"today", "yesterday", or YYYY-MM-DD. Defaults to today.' },
        done: { type: 'boolean', description: 'false unticks it. Defaults to true.' }
      },
      required: ['habit']
    }
  },
  {
    name: 'set_blade_lines',
    title: 'Rewrite the weekly commitments',
    description:
      'Replace the Sharpen the Blade list — the handful of things somebody means to do every week, ' +
      'ticked off as the week goes. This is theirs to word however they like. Read them first with ' +
      'get_week and only change what was asked for: this replaces the whole list.',
    inputSchema: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          description: 'The complete list, in order. Each item is one commitment.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The commitment, in their words. Required.' },
              area: { type: 'string', description: 'A short grouping label, e.g. "Physical" or "Mental". Optional.' }
            },
            required: ['text']
          }
        }
      },
      required: ['lines']
    }
  },
  {
    name: 'set_mission',
    title: 'Set the mission and roles',
    description:
      'The sentence at the top of the Week Compass saying what the week is for, and the roles the week ' +
      'is planned across. Pass only what you mean to change.',
    inputSchema: {
      type: 'object',
      properties: {
        mission: { type: 'string', description: 'What this is all for, in their words.' },
        roles: {
          type: 'array',
          description: 'The complete list of roles, in order. Replaces the existing roles.',
          items: { type: 'string' }
        }
      }
    }
  },
  {
    name: 'set_training_day',
    title: 'Shape a training day',
    description:
      'Rewrite one day of the training week: what it is called, its focus, its type, the exercises, and ' +
      'a note. This applies to the week you name and no other, which is how the training tab works. ' +
      'Type takes whatever word they use — Push, Pull, Legs, anything — and rest days drop out of the ' +
      'week\'s session count.',
    inputSchema: {
      type: 'object',
      properties: {
        day: { type: 'string', description: 'Which weekday: "monday", "tue", and so on. Required.' },
        week: { type: 'string', description: '"this" (default), "next", or an ISO week like "2026-W38".' },
        title: { type: 'string', description: 'What the day is, e.g. "Push — Chest, Shoulders, Triceps".' },
        focus: { type: 'string', description: 'A line under the title.' },
        type: { type: 'string', description: 'Their word for it — Push, Pull, Legs, Conditioning, anything.' },
        rest: { type: 'boolean', description: 'true makes it a rest day.' },
        exercises: {
          type: 'array',
          description: 'The complete exercise list, in order.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Required.' },
              sets: { type: 'string', description: 'Free text, e.g. "4 × 8" or "3 sets to failure".' }
            },
            required: ['name']
          }
        },
        note: { type: 'string', description: 'A reminder shown under the exercises.' }
      },
      required: ['day']
    }
  }
];

/* ---------- tool implementations ---------------------------------------- */

function weekFor(spec, now) {
  const s = String(spec == null ? '' : spec).trim().toLowerCase();
  if (/^\d{4}-w\d{2}$/.test(s)) return s.toUpperCase();
  const d = new Date(now);
  if (s === 'next') d.setDate(d.getDate() + 7);
  else if (s === 'last' || s === 'previous') d.setDate(d.getDate() - 7);
  else if (s && s !== 'this' && s !== 'current') return null;
  return weekId(d);
}

const IMPL = {
  async get_week(args, ctx) {
    const wid = weekFor(args.week, ctx.now);
    if (!wid) throw new UserError('I did not understand "' + args.week + '" as a week. Use "this", "next", "last", or an ISO week like "2026-W38".');
    const c = await compass(ctx.store);
    const dates = datesOfWeek(wid) || [];
    const rocks = (c.rocks[wid] || []).slice()
      .sort((a, b) => (a.day - b.day) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')));

    const days = DAY_NAMES.map((nm, i) => ({
      day: DAY_LONG[i],
      date: dates[i] ? localISO(dates[i]) : null,
      rocks: rocks.filter(r => r.day === i).map(r => {
        const v = rockView(r, wid);
        v.date = dates[i] ? localISO(dates[i]) : null;
        return v;
      })
    }));

    const blade = await bladeLines(ctx.store);
    const ticked = c.saw[wid] || {};
    return {
      week: wid,
      is_current: wid === weekId(ctx.now),
      mission: c.mission || null,
      roles: c.roles,
      days,
      total_rocks: rocks.length,
      done: rocks.filter(r => r.done).length,
      weekly_commitments: blade.map((l, i) => ({
        area: l[0], text: l[1], done: !!ticked[String(i)]
      }))
    };
  },

  async get_today(args, ctx) {
    const now = ctx.now;
    const wid = weekId(now);
    const c = await compass(ctx.store);
    const di = dayIndex(now);
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const mine = (c.rocks[wid] || []).filter(r => r.day === di);
    const today = localISO(now);
    const view = (r) => { const v = rockView(r, wid); v.date = today; return v; };

    const withTime = mine.filter(r => r.time).sort((a, b) => a.time.localeCompare(b.time));
    const untimed = mine.filter(r => !r.time);
    const later = withTime.filter(r => r.time >= hhmm);
    const passed = withTime.filter(r => r.time < hhmm);

    return {
      date: localISO(now),
      weekday: DAY_LONG[di],
      now: hhmm,
      /* Forward from now, because that is the only order a day is ever read in.
         What has already gone comes after, marked, rather than at the top where
         it would push the next thing off the screen. */
      next: later.map(view),
      unscheduled: untimed.map(view),
      earlier: passed.map(r => { const v = view(r); v.overdue = !r.done; return v; }),
      done: mine.filter(r => r.done).length,
      total: mine.length
    };
  },

  async get_scoreboard(args, ctx) {
    const store = ctx.store, now = ctx.now;
    const hb = await readJSON(store, 'ld_habits', { habits: [], completions: {} });
    const weekDates = (() => {
      const d = new Date(now), dow = dayIndex(d);
      return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() - dow + i); return localISO(x); });
    })();
    const streakOf = (id) => {
      let n = 0; const d = new Date(now);
      /* Today not being ticked yet is not a broken streak — it is a day that is
         still going. Only a missed yesterday breaks it. */
      if (!(hb.completions[id] && hb.completions[id][localISO(d)])) d.setDate(d.getDate() - 1);
      for (;;) {
        if (hb.completions[id] && hb.completions[id][localISO(d)]) { n++; d.setDate(d.getDate() - 1); }
        else break;
      }
      return n;
    };
    const habits = (hb.habits || []).map(h => ({
      id: h.id, name: h.name,
      streak: streakOf(h.id),
      this_week: weekDates.filter(ds => hb.completions[h.id] && hb.completions[h.id][ds]).length,
      done_today: !!(hb.completions[h.id] && hb.completions[h.id][localISO(now)])
    }));

    const t = await readJSON(store, 'ld_training', { weeks: {}, plans: {} });
    const wid = weekId(now);
    const wk = (t.weeks && t.weeks[wid]) || { done: {} };
    /* A day with no override is on the shipped plan, where Wednesday and Sunday
       are rest. Counting all seven as sessions would make every week look like
       a failure against a target nobody set. */
    const DEFAULT_REST = { wed: 1, sun: 1 };
    const planned = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(k => {
      const ov = (t.plans && t.plans[wid] && t.plans[wid][k]) || null;
      return ov ? ov.type !== 'rest' : !DEFAULT_REST[k];
    });

    const md = await readJSON(store, 'ld_mood', []);
    const last7 = md.filter(e => {
      const d = new Date(e.date + 'T00:00:00');
      return (now - d) / 864e5 <= 7;
    });
    const avg = (xs) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

    const sl = await readJSON(store, 'ld_sleep', []);
    const slRecent = sl.slice(-7).map(e => Number(e.hours)).filter(n => !isNaN(n));

    return {
      date: localISO(now),
      week: wid,
      habits,
      training: {
        sessions_done: planned.filter(k => wk.done && wk.done[k]).length,
        sessions_planned: planned.length
      },
      mood_7d: avg(last7.map(e => Number(e.mood)).filter(n => !isNaN(n))),
      energy_7d: avg(last7.map(e => Number(e.energy)).filter(n => !isNaN(n))),
      sleep_hours_7d: avg(slRecent)
    };
  },

  async add_rock(args, ctx) {
    const title = String(args.title || '').trim();
    if (!title) throw new UserError('A Big Rock needs a title.');
    if (title.length > 300) throw new UserError('That title is very long — keep it under 300 characters and put the detail in the note.');

    const when = args.day == null || args.day === '' ? new Date(ctx.now) : parseDay(args.day, ctx.now);
    if (!when) throw new UserError('I could not read "' + args.day + '" as a day. Try "tomorrow", "friday", or a date like 2026-09-18.');

    const time = parseTime(args.time);
    if (time === null) throw new UserError('I could not read "' + args.time + '" as a time. Use 24-hour "14:30" or "2:30pm".');
    const end = parseTime(args.end);
    if (end === null) throw new UserError('I could not read "' + args.end + '" as an end time.');
    if (time && end && end <= time) throw new UserError('The end time is not after the start time.');

    const prio = args.priority ? PRIOS[String(args.priority).toLowerCase()] : 'med';
    if (!prio) throw new UserError('Priority is one of high, medium or low.');

    const wid = weekId(when);
    const c = await compass(ctx.store);
    if (!c.rocks[wid]) c.rocks[wid] = [];
    if (c.rocks[wid].length >= 200) throw new UserError('That week already has 200 Big Rocks, which is more than a week can hold.');

    const rock = {
      id: newId(),
      title,
      role: String(args.role || '').trim(),
      day: dayIndex(when),
      time: time || '',
      end: end || '',
      prio,
      note: String(args.note || '').trim(),
      done: false
    };
    c.rocks[wid].push(rock);
    await writeJSON(ctx.store, 'ld_compass', c);
    await journal(ctx.store, 'planning', '🪨 Big rock added via Claude (' + wid + '): ' + title);

    const v = rockView(rock, wid);
    v.date = localISO(when);
    return { added: v, week: wid, on: DAY_LONG[rock.day] + ' ' + localISO(when) };
  },

  async update_rock(args, ctx) {
    const id = String(args.id || '').trim();
    if (!id) throw new UserError('Which rock? Pass the id you got from get_week or get_today.');
    const c = await compass(ctx.store);
    const hit = findRock(c, id);
    if (!hit) throw new UserError('No Big Rock with id "' + id + '". Read the week again — it may have been changed in the app.');

    const r = hit.rock;
    const before = { title: r.title, day: r.day, time: r.time, done: !!r.done };
    const changed = [];

    if (args.title != null) {
      const t = String(args.title).trim();
      if (!t) throw new UserError('A title cannot be emptied. To get rid of a rock, remove it in the app.');
      if (t !== r.title) { r.title = t; changed.push('title'); }
    }
    if (args.time != null) {
      const t = parseTime(args.time);
      if (t === null) throw new UserError('I could not read "' + args.time + '" as a time.');
      if (t !== r.time) { r.time = t; changed.push('time'); }
    }
    if (args.end != null) {
      const t = parseTime(args.end);
      if (t === null) throw new UserError('I could not read "' + args.end + '" as an end time.');
      if (t !== r.end) { r.end = t; changed.push('end time'); }
    }
    if (r.time && r.end && r.end <= r.time) throw new UserError('That would put the end time before the start.');
    if (args.priority != null) {
      const p = PRIOS[String(args.priority).toLowerCase()];
      if (!p) throw new UserError('Priority is one of high, medium or low.');
      if (p !== r.prio) { r.prio = p; changed.push('priority'); }
    }
    if (args.role != null) { r.role = String(args.role).trim(); changed.push('role'); }
    if (args.note != null) { r.note = String(args.note).trim(); changed.push('note'); }
    if (args.done != null) {
      const d = !!args.done;
      if (d !== !!r.done) { r.done = d; changed.push(d ? 'marked done' : 'reopened'); }
    }

    let wid = hit.wid;
    let movedDate = null;
    if (args.day != null && args.day !== '') {
      const when = parseDay(args.day, ctx.now);
      if (!when) throw new UserError('I could not read "' + args.day + '" as a day.');
      const targetWid = weekId(when);
      const targetDay = dayIndex(when);
      if (targetWid !== hit.wid) {
        /* A rock is stored in its week's bucket, so moving it across a Sunday
           is a move between buckets. Leaving a copy in the old one is how a
           thing ends up done twice and planned forever. */
        c.rocks[hit.wid] = c.rocks[hit.wid].filter(x => x.id !== id);
        if (!c.rocks[hit.wid].length) delete c.rocks[hit.wid];
        if (!c.rocks[targetWid]) c.rocks[targetWid] = [];
        c.rocks[targetWid].push(r);
        wid = targetWid;
        changed.push('moved to ' + targetWid);
      }
      if (targetDay !== r.day) { changed.push('day'); }
      r.day = targetDay;
      movedDate = localISO(when);
    }

    if (!changed.length) return { unchanged: true, rock: rockView(r, wid), note: 'Nothing in that call was different from what was already there.' };

    await writeJSON(ctx.store, 'ld_compass', c);
    await journal(ctx.store, 'planning',
      (r.done && !before.done ? '✅ Big rock done via Claude: ' : '✏️ Big rock changed via Claude: ') +
      r.title + ' (' + changed.join(', ') + ')');

    const v = rockView(r, wid);
    if (movedDate) v.date = movedDate;
    return { updated: v, changed };
  },

  async add_habit(args, ctx) {
    const name = String(args.name || '').trim();
    if (!name) throw new UserError('A habit needs a name.');
    if (name.length > 120) throw new UserError('Keep a habit name under 120 characters — it has to read at a glance.');
    const hb = await readJSON(ctx.store, 'ld_habits', { habits: [], completions: {} });
    if (!Array.isArray(hb.habits)) hb.habits = [];
    if (!hb.completions) hb.completions = {};
    const dup = hb.habits.find(h => String(h.name || '').toLowerCase() === name.toLowerCase());
    /* Two habits with the same name means two streaks for one thing, and
       neither of them true. */
    if (dup) return { already_there: true, habit: { id: dup.id, name: dup.name }, note: 'That habit already exists, so nothing was added.' };
    if (hb.habits.length >= 100) throw new UserError('There are already 100 habits. That is more than anyone tracks.');

    const h = { id: Date.now().toString(), name };
    hb.habits.push(h);
    await writeJSON(ctx.store, 'ld_habits', hb);
    await journal(ctx.store, 'habits', '➕ New habit via Claude: ' + name);
    return { added: { id: h.id, name: h.name } };
  },

  async log_habit(args, ctx) {
    const q = String(args.habit || '').trim();
    if (!q) throw new UserError('Which habit?');
    const hb = await readJSON(ctx.store, 'ld_habits', { habits: [], completions: {} });
    if (!hb.completions) hb.completions = {};
    const list = hb.habits || [];
    const h = list.find(x => x.id === q) ||
              list.find(x => String(x.name || '').toLowerCase() === q.toLowerCase()) ||
              list.find(x => String(x.name || '').toLowerCase().indexOf(q.toLowerCase()) >= 0);
    if (!h) throw new UserError('No habit matching "' + q + '". The ones being tracked are: ' +
      (list.map(x => x.name).join(', ') || 'none yet') + '.');

    const when = args.day == null || args.day === '' ? new Date(ctx.now) : parseDay(args.day, ctx.now);
    if (!when) throw new UserError('I could not read "' + args.day + '" as a day.');
    if (when > ctx.now) throw new UserError('That day has not happened yet.');
    const ds = localISO(when);

    if (!hb.completions[h.id]) hb.completions[h.id] = {};
    const want = args.done == null ? true : !!args.done;
    /* Unticking a day is the one removal here, and it is a correction of
       today's own entry rather than a deletion of anything kept. */
    if (want) hb.completions[h.id][ds] = true;
    else delete hb.completions[h.id][ds];

    await writeJSON(ctx.store, 'ld_habits', hb);
    await journal(ctx.store, 'habits', (want ? '✅ ' : '↩️ ') + h.name + ' — ' + ds + ' (via Claude)');
    return { habit: h.name, date: ds, done: want };
  },

  async set_blade_lines(args, ctx) {
    const lines = Array.isArray(args.lines) ? args.lines : null;
    if (!lines || !lines.length) throw new UserError('Pass the complete list of commitments. An empty list would wipe them, which this cannot do.');
    if (lines.length > 40) throw new UserError('Forty commitments is not a week. Keep it to a handful you will actually look at.');
    const rows = [];
    for (const l of lines) {
      const text = String((l && (l.text != null ? l.text : l)) || '').trim();
      if (!text) throw new UserError('One of those lines is empty.');
      const area = String((l && l.area) || '').trim();
      rows.push([area || 'Week', text]);
    }
    const before = await bladeLines(ctx.store);
    await writeJSON(ctx.store, 'ld_sawItems', rows);
    await journal(ctx.store, 'habits', '🪒 Weekly commitments rewritten via Claude (' + before.length + ' → ' + rows.length + ' lines)');
    return { lines: rows.map(r => ({ area: r[0], text: r[1] })), replaced: before.length };
  },

  async set_mission(args, ctx) {
    if (args.mission == null && args.roles == null) throw new UserError('Pass a mission, some roles, or both.');
    const c = await compass(ctx.store);
    const changed = [];
    if (args.mission != null) {
      const m = String(args.mission).trim();
      if (m.length > 2000) throw new UserError('That is a very long mission — under 2000 characters.');
      if (m !== c.mission) { c.mission = m; changed.push('mission'); }
    }
    if (args.roles != null) {
      if (!Array.isArray(args.roles) || !args.roles.length) throw new UserError('Roles must be a list with at least one role in it.');
      const roles = args.roles.map(r => String(r || '').trim()).filter(Boolean);
      if (!roles.length) throw new UserError('Those roles were all empty.');
      if (roles.length > 20) throw new UserError('Twenty roles is not a life, it is a list. Keep it to the handful that matter.');
      c.roles = roles; changed.push('roles');
    }
    if (!changed.length) return { unchanged: true, mission: c.mission, roles: c.roles };
    await writeJSON(ctx.store, 'ld_compass', c);
    await journal(ctx.store, 'planning', '🧭 ' + changed.join(' and ') + ' updated via Claude');
    return { mission: c.mission, roles: c.roles, changed };
  },

  async set_training_day(args, ctx) {
    const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const raw = String(args.day || '').trim().toLowerCase().slice(0, 3);
    const key = KEYS.indexOf(raw) >= 0 ? raw : null;
    if (!key) throw new UserError('Which day? One of Monday to Sunday.');
    const wid = weekFor(args.week, ctx.now);
    if (!wid) throw new UserError('I did not understand "' + args.week + '" as a week.');

    const t = await readJSON(ctx.store, 'ld_training', { weeks: {}, plans: {}, workouts: {} });
    if (!t.plans) t.plans = {};
    if (!t.plans[wid]) t.plans[wid] = {};
    const cur = t.plans[wid][key] || {};

    const ov = {
      title: args.title != null ? String(args.title).trim() : (cur.title || ''),
      focus: args.focus != null ? String(args.focus).trim() : (cur.focus || ''),
      note: args.note != null ? String(args.note).trim() : (cur.note || ''),
      exercises: cur.exercises || []
    };
    if (!ov.title) throw new UserError('Give the day a title the first time you shape it.');

    const isRest = args.rest != null ? !!args.rest : (cur.type === 'rest');
    const ALIAS = { strength: 'strength', hypertrophy: 'hyper', hyper: 'hyper', conditioning: 'cond', cond: 'cond', cardio: 'cond', rest: 'rest', 'rest day': 'rest', off: 'rest' };
    const label = args.type != null ? String(args.type).trim() : (cur.tag || '');
    ov.type = isRest ? 'rest' : (ALIAS[label.toLowerCase()] || 'hyper');
    ov.tag = label || (isRest ? 'Rest' : 'Training');

    if (args.exercises != null) {
      if (!Array.isArray(args.exercises)) throw new UserError('Exercises must be a list.');
      if (args.exercises.length > 60) throw new UserError('Sixty exercises is not a session.');
      ov.exercises = args.exercises.map(e => {
        const nm = String((e && (e.name != null ? e.name : e)) || '').trim();
        if (!nm) throw new UserError('One of those exercises has no name.');
        return [nm, String((e && e.sets) || '').trim()];
      });
    }

    t.plans[wid][key] = ov;
    await writeJSON(ctx.store, 'ld_training', t);
    await journal(ctx.store, 'training', '✏️ Training plan edited via Claude — ' + key + ' (' + wid + '): ' + ov.title);
    return {
      week: wid,
      day: DAY_LONG[KEYS.indexOf(key)],
      title: ov.title,
      type: ov.tag,
      rest_day: ov.type === 'rest',
      exercises: ov.exercises.map(x => ({ name: x[0], sets: x[1] || null })),
      note: ov.note || null
    };
  }
};

/* The blade list falls back to the shipped set when nobody has edited it, the
   same way the app does — otherwise a fresh account reads as having no
   commitments when what it really has is the default ones. */
const BLADE_SEED = [
  ['Physical', 'Train 4× this week'],
  ['Physical', 'Eat to plan most days'],
  ['Mental', 'Read or study ×3'],
  ['Mental', 'Learn one new thing'],
  ['Social', 'Reach out to someone who matters'],
  ['Social', 'Real time with people, phone away'],
  ['Spiritual', 'Something creative ×3'],
  ['Spiritual', 'Weekly review + mission check']
];
async function bladeLines(store) {
  const v = await readJSON(store, 'ld_sawItems', null);
  if (Array.isArray(v) && v.length) {
    return v.map(r => Array.isArray(r) ? [String(r[0] || ''), String(r[1] || '')] : ['Week', String(r || '')])
            .filter(r => r[1]);
  }
  return BLADE_SEED.map(r => r.slice());
}

/* ---------- errors ------------------------------------------------------- */

/* Something the caller can fix by calling differently. It comes back as a tool
   result with isError set, not as a protocol fault, because that is the one a
   model can read and act on. */
class UserError extends Error {}

/* ---------- JSON-RPC ----------------------------------------------------- */

const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message, data) => {
  const e = { code, message };
  if (data !== undefined) e.data = data;
  return { jsonrpc: '2.0', id, error: e };
};

async function dispatch(msg, ctx) {
  const id = msg && msg.id;
  const method = msg && msg.method;

  if (method === 'initialize') {
    const want = (msg.params && msg.params.protocolVersion) || PROTOCOL;
    return rpcOk(id, {
      protocolVersion: SUPPORTED.indexOf(want) >= 0 ? want : PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'the-flow', title: 'The Flow', version: VERSION },
      instructions:
        'This is one person\'s Flow — their week, their habits, their training, their record.\n\n' +
        'Read before you write. get_week shows what is already planned and on which day; get_today ' +
        'shows what is left of today; get_scoreboard shows what actually happened rather than what was ' +
        'intended. Adding a second copy of something already on the board is worse than not adding it.\n\n' +
        'A task is a Big Rock: add_rock puts it on a day of the week, and it appears on Today. Something ' +
        'that repeats every day is a habit instead, not seven rocks.\n\n' +
        'Nothing here can delete. Rocks, habits, lines and entries are removed by the person, in the app. ' +
        'If you are asked to clear or remove something, say that it has to be done there — do not ' +
        'approximate it by emptying a title or unticking a record.\n\n' +
        'The lists you can rewrite — weekly commitments, roles, a training day — replace what was there. ' +
        'Read them first and carry over everything you were not asked to change.'
    });
  }

  /* Notifications carry no id and get no reply. */
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
  if (method === 'ping') return rpcOk(id, {});

  if (method === 'tools/list') return rpcOk(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    const fn = IMPL[name];
    if (!fn) return rpcErr(id, -32602, 'No tool named "' + name + '".');
    try {
      const out = await fn(args, ctx);
      return rpcOk(id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
        isError: false
      });
    } catch (e) {
      /* A tool failing is a result, not a transport fault: the model needs to
         see what went wrong in order to try something else. */
      const msgText = e instanceof UserError ? e.message
        : 'That did not work: ' + String((e && e.message) || e);
      return rpcOk(id, { content: [{ type: 'text', text: msgText }], isError: true });
    }
  }

  if (typeof method === 'string' && method.indexOf('notifications/') === 0) return null;
  return rpcErr(id, -32601, 'This server does not implement "' + method + '".');
}

/* ---------- HTTP --------------------------------------------------------- */

const readBody = (req) => new Promise((resolve, reject) => {
  let b = '', size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 1e6) { req.destroy(); reject(new Error('body too large')); return; }
    b += c;
  });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});

async function handle(req, res, store, opts) {
  opts = opts || {};
  const send = (code, obj) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    });
    res.end(obj === null ? '' : JSON.stringify(obj));
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  /* Some clients open a GET stream first. This server has nothing to push, so
     it says so plainly rather than holding a socket open forever. */
  if (req.method === 'GET') return send(405, { error: 'This endpoint takes POST. It has no server-initiated stream.' });
  if (req.method !== 'POST') return send(405, { error: 'POST only.' });

  let body;
  try { body = await readBody(req); }
  catch (e) { return send(413, rpcErr(null, -32600, 'That request was too large.')); }

  let msg;
  try { msg = JSON.parse(body || 'null'); }
  catch (e) { return send(200, rpcErr(null, -32700, 'That was not valid JSON.')); }
  if (!msg) return send(200, rpcErr(null, -32600, 'Empty request.'));

  const ctx = { store, now: new Date() };

  /* A batch is a list. Notifications inside it produce nothing, and a batch of
     nothing but notifications gets 202 and an empty body. */
  if (Array.isArray(msg)) {
    if (!msg.length) return send(200, rpcErr(null, -32600, 'Empty batch.'));
    const out = [];
    for (const m of msg) {
      try { const r = await dispatch(m, ctx); if (r) out.push(r); }
      catch (e) { out.push(rpcErr(m && m.id, -32603, String((e && e.message) || e))); }
    }
    if (!out.length) { res.writeHead(202, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }
    return send(200, out);
  }

  let reply;
  try { reply = await dispatch(msg, ctx); }
  catch (e) { return send(200, rpcErr(msg.id, -32603, String((e && e.message) || e))); }
  if (!reply) { res.writeHead(202, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }
  return send(200, reply);
}

/* ---------- the home-screen widget ----------------------------------------
 * A widget is not a small app. It gets a few hundred bytes, it is redrawn by
 * the system on its own schedule, and nobody scrolls it. So this returns one
 * short list in the order a day is actually read — what is next, then what has
 * no time on it, then what has already gone and is still not done — and it
 * counts rather than lists anything that would not fit.
 *
 * It reads. There is deliberately no way to tick a rock from here: a widget
 * tap that silently writes to the week is how a day gets marked done by a coat
 * pocket.
 * ------------------------------------------------------------------------ */
async function widgetToday(store, now) {
  now = now || new Date();
  const t = await IMPL.get_today({}, { store, now });
  const LIMIT = 4;

  const line = (r, overdue) => ({
    title: r.title,
    time: r.time || null,
    done: !!r.done,
    overdue: !!overdue
  });

  /* Order matters more than completeness here. Something at 18:00 that has not
     happened yet belongs above something at 09:00 that was missed, because the
     first is a decision still to be made and the second is only a fact. */
  const all = []
    .concat(t.next.map(r => line(r, false)))
    .concat(t.unscheduled.map(r => line(r, false)))
    .concat(t.earlier.filter(r => !r.done).map(r => line(r, true)));

  const wid = weekId(now);
  const c = await compass(store);
  const weekRocks = c.rocks[wid] || [];

  return {
    date: t.date,
    weekday: t.weekday,
    now: t.now,
    done: t.done,
    total: t.total,
    lines: all.slice(0, LIMIT),
    /* Said plainly so the widget never has to do arithmetic to decide whether
       to draw a "+2 more" row. */
    more: Math.max(0, all.length - LIMIT),
    week: { id: wid, done: weekRocks.filter(r => r.done).length, total: weekRocks.length },
    updated: new Date(now).toISOString()
  };
}

module.exports = {
  handle,
  widgetToday,
  TOOLS,
  /* Exported for the tests, which check the parts that are easy to get subtly
     wrong and impossible to notice: week arithmetic and what people type. */
  _internals: { weekId, parseDay, parseTime, datesOfWeek, dayIndex, localISO, dispatch, IMPL, bladeLines, UserError, widgetToday }
};
