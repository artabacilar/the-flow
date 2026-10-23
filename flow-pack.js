/* ==========================================================================
 * The Flow — Upgrade Pack v1.0.1
 * Adds: Planner tab · Settings · time-on-every-task · Apple/Google calendar
 *       export · receipt OCR + statement import · bracketed notes ·
 *       iOS Reminders sync.
 *
 * Designed as a pure add-on: it never rewrites existing markup, it only
 * decorates it. Safe to remove by deleting the <script> block.
 * ========================================================================== */
(function () {
'use strict';

if (window.__FLOW_UPGRADE__) { console.warn('[Flow] upgrade pack already loaded'); return; }
window.__FLOW_UPGRADE__ = '1.6.1';

/* =========================================================================
 * 0 · Small utilities
 * ====================================================================== */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const uid = (p) => (p || 'f') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };

function startOfWeek(d, weekStart) {
  const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0);
  const diff = (x.getDay() - (weekStart == null ? 1 : weekStart) + 7) % 7;
  x.setDate(x.getDate() - diff); return x;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (s) => { const d = parseISO(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/* Turns http(s) and www URLs in a person's own text into real anchors, and
   nothing else — the pattern cannot match javascript:, and every piece around
   the URL is escaped exactly as esc() would have escaped the whole string. It
   reads the RAW text rather than scanning escaped HTML, which is how a query
   string like "?a=1&b=2" survives with its & intact. */
function linkifyText(raw) {
  const RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  let out = '', last = 0, m;
  const src = String(raw == null ? '' : raw);
  while ((m = RE.exec(src))) {
    out += esc(src.slice(last, m.index));
    let url = m[0], tail = '';
    /* The full stop after a link belongs to the sentence, not the URL. */
    const t = url.match(/[.,!?)\]}]+$/);
    if (t) { tail = t[0]; url = url.slice(0, -tail.length); }
    if (url) {
      const href = /^www\./i.test(url) ? 'https://' + url : url;
      out += '<a class="flow-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>';
    }
    out += esc(tail);
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}
/* A row that is itself a control must not fire when the tap was for a link. */
const hitLink = (e) => !!(e && e.target && e.target.closest && e.target.closest('a'));

function debounce(fn, ms) {
  let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); };
}
/* The diet section's elements live inside Body log once the navigation is
   installed; before that they are still in their own section. Either way,
   this is the root to look under. */
function dietRoot() { return document.getElementById('fn-dietblock') || document.getElementById('tab-diet') || document; }

function download(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
}
function money(n, cur) {
  const v = Number(n) || 0;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'TRY', maximumFractionDigits: 2 }).format(v); }
  catch (e) { return v.toFixed(2) + ' ' + (cur || ''); }
}

/** Short form for tight spots — the middle of a ring, a stat tile. */
function moneyCompact(n, cur) {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: cur || 'TRY',
      notation: 'compact', maximumFractionDigits: 1
    }).format(v);
  } catch (e) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }
}

/* =========================================================================
 * 1 · Toasts
 * ====================================================================== */
function toast(msg, kind, ms) {
  let host = $('#flow-toasts');
  if (!host) { host = document.createElement('div'); host.id = 'flow-toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'flow-toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms || 2600);
}

/* =========================================================================
 * 2 · Storage — wraps the existing /api/get + /api/set key-value API,
 *     mirrors to localStorage, and queues writes made while offline.
 * ====================================================================== */
const DB = {
  _mem: new Map(),
  _lsKey: (k) => 'flowpack:' + k,

  async get(key, fallback) {
    if (DB._mem.has(key)) return DB._mem.get(key);
    let val = null;
    try {
      const r = await fetch('/api/get?key=' + encodeURIComponent(key), { credentials: 'same-origin' });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j && typeof j === 'object' && 'value' in j) val = j.value;
        else if (j !== null && j !== undefined) val = j;
      }
    } catch (e) { /* offline — fall through to localStorage */ }

    /* The host server normalises every write with
         typeof value === 'string' ? value : JSON.stringify(value)
       so anything we stored as an object or array comes back as TEXT. Parse it
       back into the shape we wrote, or Schedule.map and Settings.data end up as
       strings on any browser without our localStorage mirror. Only text that
       actually looks like JSON is parsed, so a receipt data URL — which is
       genuinely a string — is left exactly as it is. */
    if (typeof val === 'string') {
      const t = val.trim();
      if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
        try { val = JSON.parse(t); } catch (e) { /* not JSON — keep the string */ }
      }
    }

    if (val === null || val === undefined) {
      const raw = localStorage.getItem(DB._lsKey(key));
      if (raw != null) { try { val = JSON.parse(raw); } catch (e) { val = null; } }
    }
    if (val === null || val === undefined) val = (fallback === undefined ? null : fallback);
    DB._mem.set(key, val);
    return val;
  },

  /* localStorage is shared with the host app, which auto-saves there too.
     We must never be the reason one of ITS writes hits the quota, so:
       · anything big (receipt photos) is not mirrored at all — it already
         lives in the database, and an offline copy of a JPEG is not worth
         spending shared quota on;
       · on a quota error we evict our OWN mirror entries, oldest-looking
         first, and retry once. We never touch a key that is not ours. */
  MIRROR_MAX: 50000,

  _mirror(key, value) {
    let json;
    try { json = JSON.stringify(value); } catch (e) { return; }
    if (json.length > DB.MIRROR_MAX) {
      try { localStorage.removeItem(DB._lsKey(key)); } catch (e) {}
      return;
    }
    try {
      localStorage.setItem(DB._lsKey(key), json);
    } catch (e) {
      // Reclaim only our own space, then try once more.
      try {
        Object.keys(localStorage)
          .filter(k => k.indexOf('flowpack:flow:receipt:') === 0)
          .forEach(k => localStorage.removeItem(k));
        localStorage.setItem(DB._lsKey(key), json);
      } catch (e2) {
        console.warn('[Flow] local mirror skipped for', key, '— storage is full. The value is still saved to the database.');
      }
    }
  },

  async set(key, value) {
    DB._mem.set(key, value);
    DB._mirror(key, value);
    try {
      const r = await fetch('/api/set', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, value: value })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      Queue.drop(key);
      return true;
    } catch (e) {
      Queue.add(key);
      return false;
    }
  },

  /** Write-through helper that returns the value so callers can chain. */
  async update(key, fallback, mutator) {
    const cur = await DB.get(key, fallback);
    const next = mutator(cur);
    await DB.set(key, next);
    return next;
  }
};

const Queue = {
  key: 'flowpack:__queue',
  list() { try { return JSON.parse(localStorage.getItem(Queue.key) || '[]'); } catch (e) { return []; } },
  save(l) { try { localStorage.setItem(Queue.key, JSON.stringify(l)); } catch (e) {} },
  add(k) { const l = Queue.list(); if (l.indexOf(k) < 0) { l.push(k); Queue.save(l); } },
  drop(k) { Queue.save(Queue.list().filter(x => x !== k)); },
  async flush() {
    const l = Queue.list();
    if (!l.length) return;
    let ok = 0;
    for (const k of l) {
      const raw = localStorage.getItem(DB._lsKey(k));
      if (raw == null) { Queue.drop(k); continue; }
      try {
        const r = await fetch('/api/set', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: k, value: JSON.parse(raw) })
        });
        if (r.ok) { Queue.drop(k); ok++; }
      } catch (e) { break; }
    }
    if (ok) toast(`Synced ${ok} offline change${ok > 1 ? 's' : ''} ✓`);
  }
};
window.addEventListener('online', () => Queue.flush());

/* =========================================================================
 * 3 · Settings
 * ====================================================================== */
const DEFAULT_CATEGORIES = [
  'Groceries', 'Dining', 'Transport', 'Fuel', 'Health', 'Fitness', 'Supplements',
  'Rent & Bills', 'Subscriptions', 'Shopping', 'Travel', 'Business', 'Music', 'Education', 'Other'
];

/* merchant keyword → category. Turkish + English, tuned for TR receipts. */
const DEFAULT_RULES = [
  ['Groceries',     ['migros', 'bim', 'a101', 'sok market', 'şok', 'carrefour', 'macrocenter', 'metro market', 'file market', 'market', 'bakkal', 'manav', 'kasap', 'grocery', 'whole foods', 'rewe', 'aldi', 'lidl']],
  ['Dining',        ['restoran', 'restaurant', 'cafe', 'kafe', 'kahve', 'starbucks', 'burger', 'pizza', 'kebap', 'lokanta', 'bistro', 'yemeksepeti', 'getir yemek', 'trendyol yemek', 'coffee', 'bar ']],
  ['Transport',     ['uber', 'bitaksi', 'taksi', 'taxi', 'metro istanbul', 'istanbulkart', 'iett', 'bolt', 'marti', 'martı', 'parking', 'otopark', 'hgs', 'ogs', 'köprü']],
  ['Fuel',          ['shell', 'opet', 'petrol ofisi', 'bp ', 'total', 'aytemiz', 'lukoil', 'benzin', 'akaryakit', 'akaryakıt', 'fuel', 'gas station']],
  ['Health',        ['eczane', 'pharmacy', 'hastane', 'hospital', 'klinik', 'clinic', 'doktor', 'dr.', 'medical', 'laboratuvar', 'dis ', 'diş ']],
  ['Fitness',       ['gym', 'spor salonu', 'macfit', 'fitness', 'crossfit', 'pilates', 'yoga', 'sporium', 'b-fit']],
  ['Supplements',   ['supplement', 'protein', 'whey', 'creatine', 'kolajen', 'collagen', 'omega', 'vitamin', 'probiyotik', 'takviye']],
  ['Rent & Bills',  ['kira', 'rent', 'elektrik', 'dogalgaz', 'doğalgaz', 'su faturasi', 'su faturası', 'turkcell', 'vodafone', 'turk telekom', 'türk telekom', 'superonline', 'iski', 'i̇ski', 'aidat', 'utility']],
  ['Subscriptions', ['netflix', 'spotify', 'youtube premium', 'icloud', 'apple.com/bill', 'google one', 'adobe', 'microsoft', 'openai', 'anthropic', 'notion', 'figma', 'canva', 'dropbox', 'render.com', 'aws', 'godaddy', 'namecheap']],
  ['Shopping',      ['trendyol', 'hepsiburada', 'amazon', 'n11', 'zara', 'lcw', 'lc waikiki', 'defacto', 'mango', 'decathlon', 'ikea', 'koctas', 'koçtaş', 'teknosa', 'vatan', 'mediamarkt', 'apple store']],
  ['Travel',        ['thy', 'turkish airlines', 'pegasus', 'ajet', 'booking.com', 'airbnb', 'hotel', 'otel', 'rentacar', 'rent a car', 'havas', 'havaist']],
  ['Business',      ['abko', 'fatura', 'invoice', 'noter', 'muhasebe', 'consult', 'danisman', 'danışman', 'kargo', 'aras kargo', 'yurtici', 'yurtiçi', 'mng', 'ups', 'dhl', 'fedex', 'alibaba', 'fba', 'shopify', 'stripe', 'iyzico']],
  ['Music',         ['thomann', 'muzik', 'müzik', 'zuzi', 'distrokid', 'ableton', 'splice', 'native instruments', 'guitar', 'gitar', 'piano', 'piyano', 'studio', 'stüdyo']],
  ['Education',     ['udemy', 'coursera', 'kitap', 'book', 'dr kitap', 'kitapyurdu', 'course', 'kurs', 'italki', 'babbel', 'duolingo']]
];

const SETTINGS_KEY = 'flow:settings';

/* The line under "Today". It shipped as one fixed quote, the same for
   everybody, which is a strange thing for the most personal screen in the
   app to say. It is a setting now, defaulting to the line that was already
   there — so nobody who liked it has to do anything, and anybody who wants
   their own words, their coach's, or nothing at all can have that. */
const DEFAULT_QUOTE = 'I am the master of my fate, I am the captain of my soul.';
const DEFAULT_QUOTE_BY = 'William Ernest Henley, 1875';

const SETTINGS_DEFAULTS = {
  displayName: '',
  todayQuote: DEFAULT_QUOTE,
  todayQuoteBy: DEFAULT_QUOTE_BY,
  timezone: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return 'Europe/Istanbul'; } })(),
  currency: 'TRY',
  weekStart: 1,
  defaultDurationMin: 60,
  showTimeChips: true,
  chipTabs: '',                  // blank = all tabs
  gcalClientId: '',
  gcalCalendarId: 'primary',
  remindersEnabled: true,
  remindersListName: 'The Flow',
  remindersSources: { schedule: true, training: true, notes: true },
  ocrLangs: 'eng+tur',
  ocrAutoFill: true,
  bankProvider: 'none',
  statementDateFormat: 'auto',
  pushRemindRocks: true,         // reminders at a rock's own time
  hiddenTabs: [],                // sections taken out of the menu (data kept)
  sectionsV: 0,                  // which default-hiding pass has run on this account
  todayMarkets: false,           // the price strip on Today is a widget: off until asked for
  upgradeVisuals: true,
  breakdownForm: 'donut',
  categories: DEFAULT_CATEGORIES.slice(),
  merchantMemory: {},            // learned merchant → category
  budgetMonthly: 0
};

const Settings = {
  data: Object.assign({}, SETTINGS_DEFAULTS),

  /* Put a saved setting on the screen without a relaunch.
   *
   * This used to be a list of special cases inside the settings binder, and
   * the list was always one behind: people changed something, saw nothing,
   * and closed and reopened the app to make it take. A setting can touch any
   * screen, so this redraws the pack's own layers and then asks the app to
   * redraw itself. Every step is caught separately — one failure must not
   * leave the rest of the screen stale, which is the bug this replaces. */
  reflect() {
    const each = (fn) => { try { fn(); } catch (e) { console.warn('[settings] reflect', e); } };
    each(() => { if (Settings.get('upgradeVisuals')) Visuals.upgradeAll(); else Visuals.restoreAll(); });
    each(() => {
      if (Settings.get('showTimeChips')) TimeChips.scan(document);
      else {
        $$('.flow-time-chip').forEach(c => c.remove());
        $$('[data-flow-timed]').forEach(r => r.removeAttribute('data-flow-timed'));
      }
    });
    each(() => TimeChips.repaintAll());
    each(() => Planner.applyTabName());
    each(() => Journal.rerender());
    /* The Today header is built by its own render and a general repaint does
       not reach it, so it is asked for by name. */
    each(() => TodayPlus.apply());
    each(() => { if (typeof window.flowRepaintAll === 'function') window.flowRepaintAll(); });
  },
  async load() {
    const saved = await DB.get(SETTINGS_KEY, null);
    Settings.data = Object.assign({}, SETTINGS_DEFAULTS, saved || {});
    Settings.data.remindersSources = Object.assign({}, SETTINGS_DEFAULTS.remindersSources, (saved && saved.remindersSources) || {});
    return Settings.data;
  },
  get(k) { return Settings.data[k]; },
  async set(k, v) {
    Settings.data[k] = v;
    await DB.set(SETTINGS_KEY, Settings.data);
    /* The planner tab carries the display name, so renaming yourself renames
       the tab straight away rather than at the next reload. */
    if (k === 'displayName') { try { Planner.applyTabName(); } catch (e) {} }
  },
  async save() { await DB.set(SETTINGS_KEY, Settings.data); }
};

/* =========================================================================
 * 4 · Schedule store — the single source of truth for "things with a time".
 *
 *   record = { key, text, tab, date, time, dur, done, remind, note, source }
 *
 *   Rows that already exist in the app are keyed by  <tab>::<normalised text>
 *   so the schedule survives the app re-rendering its own lists.
 *   Items created inside the Planner planner are keyed  planner::<uid>
 * ====================================================================== */
const SCHEDULE_KEY = 'flow:schedule';
const Schedule = {
  map: {},
  async load() { Schedule.map = (await DB.get(SCHEDULE_KEY, {})) || {}; return Schedule.map; },
  save: debounce(() => { DB.set(SCHEDULE_KEY, Schedule.map); }, 250),
  saveNow() { return DB.set(SCHEDULE_KEY, Schedule.map); },

  keyFor(tab, text) { return tab + '::' + norm(text).toLowerCase().slice(0, 140); },
  get(key) { return Schedule.map[key] || null; },

  put(key, patch) {
    const cur = Schedule.map[key] || { key: key, created: new Date().toISOString() };
    Schedule.map[key] = Object.assign(cur, patch, { updated: new Date().toISOString() });
    Schedule.save();
    return Schedule.map[key];
  },
  remove(key) { delete Schedule.map[key]; Schedule.save(); },

  all() { return Object.keys(Schedule.map).map(k => Schedule.map[k]); },

  /** Everything that has a date, sorted chronologically. */
  scheduled() {
    return Schedule.all()
      .filter(r => r && r.date)
      .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));
  },
  onDate(d) { return Schedule.scheduled().filter(r => r.date === d); },
  between(from, to) { return Schedule.scheduled().filter(r => r.date >= from && r.date <= to); }
};

/* =========================================================================
 * 5 · iCalendar generation (VEVENT for calendars, VTODO for Reminders)
 * ====================================================================== */
const ICS = {
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  },
  fold(line) {
    // RFC 5545: fold at 75 octets, continuation lines start with a space.
    if (line.length <= 73) return line;
    const out = []; let i = 0;
    while (i < line.length) { out.push((i ? ' ' : '') + line.substr(i, i ? 72 : 73)); i += i ? 72 : 73; }
    return out.join('\r\n');
  },
  stampUTC(d) {
    d = d || new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
           pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  },
  /** Floating local date-time: "same wall clock in every client". */
  local(dateStr, timeStr) {
    const [h, m] = String(timeStr || '09:00').split(':').map(Number);
    return String(dateStr).replace(/-/g, '') + 'T' + pad(h || 0) + pad(m || 0) + '00';
  },
  plus(dateStr, timeStr, minutes) {
    const [h, m] = String(timeStr || '09:00').split(':').map(Number);
    const d = parseISO(dateStr);
    d.setHours(h || 0, m || 0, 0, 0);
    d.setMinutes(d.getMinutes() + (minutes || 60));
    return isoDate(d).replace(/-/g, '') + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
  },
  uidFor(r) { return 'flow-' + String(r.key || r.id || uid()).replace(/[^a-zA-Z0-9]/g, '-').slice(0, 60) + '@the-flow'; },

  header(name, tz) {
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Flow//Upgrade Pack 1.0//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + ICS.esc(name),
      'X-WR-TIMEZONE:' + (tz || 'Europe/Istanbul'),
      'X-APPLE-CALENDAR-COLOR:#17BB92'
    ];
  },

  event(r, opts) {
    const dur = r.dur || (opts && opts.defaultDuration) || 60;
    const L = ['BEGIN:VEVENT',
      'UID:' + ICS.uidFor(r),
      'DTSTAMP:' + ICS.stampUTC(),
      'SEQUENCE:' + Math.floor(Date.now() / 60000 % 65535),
      'DTSTART:' + ICS.local(r.date, r.time || '09:00'),
      'DTEND:' + ICS.plus(r.date, r.time || '09:00', dur),
      'SUMMARY:' + ICS.esc(r.text),
      'DESCRIPTION:' + ICS.esc((r.note ? r.note + '\n\n' : '') + 'From The Flow · ' + (r.tab || 'planner')),
      'CATEGORIES:' + ICS.esc((r.tab || 'flow').toUpperCase()),
      'STATUS:CONFIRMED', 'TRANSP:OPAQUE'
    ];
    if (r.remind) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + ICS.esc(r.text),
             'TRIGGER:-PT' + (r.remindMin || 15) + 'M', 'END:VALARM');
    }
    L.push('END:VEVENT');
    return L;
  },

  todo(r) {
    const L = ['BEGIN:VTODO',
      'UID:' + ICS.uidFor(r) + '-todo',
      'DTSTAMP:' + ICS.stampUTC(),
      'SUMMARY:' + ICS.esc(r.text),
      'STATUS:' + (r.done ? 'COMPLETED' : 'NEEDS-ACTION'),
      'PERCENT-COMPLETE:' + (r.done ? 100 : 0)
    ];
    if (r.date) L.push('DUE:' + ICS.local(r.date, r.time || '09:00'));
    if (r.note) L.push('DESCRIPTION:' + ICS.esc(r.note));
    if (r.tab) L.push('CATEGORIES:' + ICS.esc(r.tab.toUpperCase()));
    if (r.done) L.push('COMPLETED:' + ICS.stampUTC());
    if (r.date && r.time) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + ICS.esc(r.text),
             'TRIGGER;VALUE=DATE-TIME:' + ICS.local(r.date, r.time) , 'END:VALARM');
    }
    L.push('END:VTODO');
    return L;
  },

  build(records, opts) {
    opts = opts || {};
    const lines = ICS.header(opts.name || 'The Flow', opts.tz);
    records.forEach(r => {
      if (!r || !r.text) return;
      if (opts.kind === 'todo') lines.push.apply(lines, ICS.todo(r));
      else if (r.date) lines.push.apply(lines, ICS.event(r, opts));
    });
    lines.push('END:VCALENDAR');
    return lines.map(ICS.fold).join('\r\n') + '\r\n';
  }
};

/* =========================================================================
 * 6 · Google Calendar — OAuth via Google Identity Services, then an
 *     idempotent upsert so re-exporting updates instead of duplicating.
 * ====================================================================== */
const GCAL = {
  _token: null,
  _tokenExp: 0,
  _client: null,

  loadGIS() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (GCAL._gisPromise) return GCAL._gisPromise;
    GCAL._gisPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in'));
      document.head.appendChild(s);
    });
    return GCAL._gisPromise;
  },

  async token() {
    if (GCAL._token && Date.now() < GCAL._tokenExp - 60000) return GCAL._token;
    const cid = Settings.get('gcalClientId');
    if (!cid) throw new Error('Add your Google OAuth Client ID in Settings → Integrations first.');
    await GCAL.loadGIS();
    return new Promise((resolve, reject) => {
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: cid,
          scope: 'https://www.googleapis.com/auth/calendar.events',
          callback: (resp) => {
            if (resp && resp.access_token) {
              GCAL._token = resp.access_token;
              GCAL._tokenExp = Date.now() + (Number(resp.expires_in || 3600) * 1000);
              resolve(GCAL._token);
            } else reject(new Error('Google did not return an access token'));
          },
          error_callback: (err) => reject(new Error((err && err.message) || 'Google sign-in was cancelled'))
        });
        client.requestAccessToken();
      } catch (e) { reject(e); }
    });
  },

  /* Google event ids must be base32hex (0-9, a-v), 5–1024 chars. */
  idFor(key) {
    const CH = '0123456789abcdefghijklmnopqrstuv';
    let h1 = 0x811c9dc5, h2 = 0x01000193, s = String(key);
    for (let i = 0; i < s.length; i++) {
      h1 ^= s.charCodeAt(i); h1 = (h1 * 0x01000193) >>> 0;
      h2 = ((h2 << 5) - h2 + s.charCodeAt(i)) >>> 0;
    }
    let out = 'flow';
    let acc = (BigInt(h1) << 32n) | BigInt(h2 >>> 0);
    for (let i = 0; i < 16; i++) { out += CH[Number(acc & 31n)]; acc >>= 5n; }
    return out;
  },

  body(r, tz) {
    const dur = r.dur || Settings.get('defaultDurationMin') || 60;
    const startLocal = ICS.local(r.date, r.time || '09:00');
    const endLocal = ICS.plus(r.date, r.time || '09:00', dur);
    const fmt = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:00`;
    return {
      id: GCAL.idFor(r.key || r.id),
      summary: r.text,
      description: (r.note ? r.note + '\n\n' : '') + 'From The Flow · ' + (r.tab || 'planner'),
      start: { dateTime: fmt(startLocal), timeZone: tz },
      end:   { dateTime: fmt(endLocal),   timeZone: tz },
      reminders: r.remind
        ? { useDefault: false, overrides: [{ method: 'popup', minutes: r.remindMin || 15 }] }
        : { useDefault: true },
      status: 'confirmed'
    };
  },

  async push(records, onProgress) {
    const tok = await GCAL.token();
    const cal = encodeURIComponent(Settings.get('gcalCalendarId') || 'primary');
    const tz = Settings.get('timezone');
    const base = `https://www.googleapis.com/calendar/v3/calendars/${cal}/events`;
    let created = 0, updated = 0, failed = 0, i = 0;

    for (const r of records) {
      i++;
      if (!r.date) continue;
      const body = GCAL.body(r, tz);
      const headers = { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' };
      try {
        let res = await fetch(`${base}/${body.id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
        if (res.status === 404 || res.status === 400) {
          res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
          if (res.ok) created++; else if (res.status === 409) updated++; else failed++;
        } else if (res.ok) updated++;
        else failed++;
      } catch (e) { failed++; }
      if (onProgress) onProgress(i, records.length);
    }
    return { created, updated, failed, total: records.length };
  }
};

/* =========================================================================
 * 7 · iOS Reminders
 *
 *  Three routes, in order of how well they work:
 *   a) .ics with VTODO   — open on iPhone, "Add All", lands in Reminders.
 *   b) Apple Shortcuts   — a Shortcut fetches /api/flow/reminders.json and
 *                          loops "Add New Reminder". Fully automatic, and
 *                          it can post completions back.
 *   c) CalDAV to iCloud  — server-side, credentials live in Render env vars
 *                          and never touch the browser.
 * ====================================================================== */
const Reminders = {
  collect() {
    const src = Settings.get('remindersSources') || {};
    let out = [];
    if (src.schedule !== false) out = out.concat(Schedule.scheduled().filter(r => !r.done));
    if (src.notes !== false && window.Flow && Flow.Notes) out = out.concat(Flow.Notes.asReminders());
    // de-duplicate on text+date
    const seen = {};
    return out.filter(r => {
      const k = norm(r.text).toLowerCase() + '|' + (r.date || '');
      if (seen[k]) return false; seen[k] = 1; return true;
    });
  },

  exportICS(records) {
    const recs = records || Reminders.collect();
    if (!recs.length) { toast('Nothing to send — schedule something first.', 'warn'); return; }
    const ics = ICS.build(recs, { kind: 'todo', name: Settings.get('remindersListName') || 'The Flow', tz: Settings.get('timezone') });
    download(`the-flow-reminders-${today()}.ics`, ics, 'text/calendar');
    toast(`${recs.length} reminders exported — open the file on your iPhone`, null, 4200);
  },

  async publishForShortcut() {
    const recs = Reminders.collect().map(r => ({
      id: r.key, title: r.text, notes: (r.note || '') + ' · The Flow',
      list: Settings.get('remindersListName') || 'The Flow',
      dueDate: r.date && r.time ? `${r.date}T${r.time}:00` : (r.date || null),
      priority: r.tab === 'quad' ? 1 : 0, tab: r.tab || 'planner'
    }));
    await DB.set('flow:reminders:outbox', { updated: new Date().toISOString(), items: recs });
    return recs;
  },

  async caldavPush(records) {
    const recs = records || Reminders.collect();
    const res = await fetch('/api/flow/caldav/push', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listName: Settings.get('remindersListName'), items: recs })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(t || ('CalDAV push failed (HTTP ' + res.status + ')'));
    }
    return res.json();
  }
};

/* =========================================================================
 * 8 · Calendar export facade used by the UI
 * ====================================================================== */
const Calendar = {
  rangeRecords(range) {
    const now = new Date();
    const ws = startOfWeek(now, Settings.get('weekStart'));
    let from = isoDate(ws), to;
    if (range === 'today') { from = today(); to = today(); }
    else if (range === 'week') to = isoDate(addDays(ws, 6));
    else if (range === '2weeks') to = isoDate(addDays(ws, 13));
    else if (range === '4weeks') to = isoDate(addDays(ws, 27));
    else if (range === '12weeks') to = isoDate(addDays(ws, 83));
    else { from = '0000-01-01'; to = '9999-12-31'; }
    /* Anything you put a date and time on should reach your calendar, whether it
       started life as a task row or as a flagged note section. */
    const notes = (window.Flow && Flow.Notes ? Flow.Notes.asReminders() : [])
      .filter(r => r.date && r.date >= from && r.date <= to);
    return Schedule.between(from, to).concat(notes)
      .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));
  },

  exportApple(range) {
    const recs = Calendar.rangeRecords(range);
    if (!recs.length) { toast('No scheduled items in that range yet.', 'warn'); return; }
    const ics = ICS.build(recs, {
      name: 'The Flow', tz: Settings.get('timezone'),
      defaultDuration: Settings.get('defaultDurationMin')
    });
    download(`the-flow-${range}-${today()}.ics`, ics, 'text/calendar');
    toast(`${recs.length} events exported. Open the file to add them to Calendar.`, null, 4200);
  },

  async exportGoogle(range, statusEl) {
    const recs = Calendar.rangeRecords(range);
    if (!recs.length) { toast('No scheduled items in that range yet.', 'warn'); return; }
    if (statusEl) statusEl.textContent = 'Waiting for Google sign-in…';
    try {
      const res = await GCAL.push(recs, (i, n) => { if (statusEl) statusEl.textContent = `Syncing ${i}/${n}…`; });
      const msg = `Google Calendar: ${res.created} added, ${res.updated} updated` + (res.failed ? `, ${res.failed} failed` : '');
      if (statusEl) statusEl.textContent = msg;
      toast(msg, res.failed ? 'warn' : null, 4200);
    } catch (e) {
      if (statusEl) statusEl.textContent = e.message;
      toast(e.message, 'err', 5000);
    }
  },

  subscribeURL() { return location.origin + '/api/flow/feed.ics'; }
};

/* =========================================================================
 * 9 · Tab + section injection
 *    We add our own pills next to the existing ones. Our sections use the
 *    class .flow-section (our own CSS) so we never depend on how the host
 *    app shows and hides its own .section elements.
 * ====================================================================== */
const Tabs = {
  mine: {},
  hostTabsEl: null,

  init() {
    Tabs.hostTabsEl = $('.tabs') || (function () {
      const anyTab = $('[data-tab]');
      return anyTab ? anyTab.parentElement : null;
    })();

    // Any click on a host tab hides our sections again.
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest && e.target.closest('[data-tab]');
      if (!t) return;
      const name = t.getAttribute('data-tab');
      if (Tabs.mine[name]) return;             // ours — handled by its own listener
      setTimeout(() => Tabs.deactivateMine(), 0);
    }, true);
  },

  add(name, label, buildFn) {
    const host = Tabs.hostTabsEl;
    const pill = document.createElement('div');
    pill.className = 'tab';
    pill.setAttribute('data-tab', name);
    pill.textContent = label;
    pill.style.cursor = 'pointer';
    if (host) host.appendChild(pill);

    const section = document.createElement('div');
    section.id = 'tab-' + name;
    section.className = 'flow-section flow-x';

    // Place our section beside the app's own sections so page flow matches.
    const anchor = $('.section') ? $$('.section').pop() : null;
    if (anchor && anchor.parentElement) anchor.parentElement.appendChild(section);
    else document.body.appendChild(section);

    Tabs.mine[name] = { pill, section, build: buildFn, built: false };
    pill.addEventListener('click', () => Tabs.activate(name));

    /* On a phone the host hides .tabs entirely (@media max-width:760px) and
       navigates from a bottom bar plus a "More" sheet, whose grid is built
       once from a hardcoded list. Without this, every tab we add is
       unreachable on mobile. The grid is never re-rendered — syncMobileNav
       only toggles classes — so appending to it is stable. */
    Tabs.addToMobileSheet(name, label);
    return section;
  },

  /* The planner tab is named after whoever is signed in. The shipped file
     cannot hardcode a name — it is the same file for everyone — so the label
     is set once the account and settings are known, and falls back to a
     neutral word until then. */
  relabel(name, label) {
    const t = Tabs.mine[name];
    if (t && t.pill) t.pill.textContent = label;
    const grid = document.getElementById('moreGrid');
    const btn = grid && grid.querySelector('[data-flow-goto="' + name + '"]');
    if (btn) {
      const parts = String(label).trim().split(/\s+/);
      let icon = '';
      if (parts.length > 1 && !/[a-z0-9]/i.test(parts[0])) icon = parts.shift();
      const lab = btn.querySelector('.mg-label') || btn.querySelector('span:last-child');
      if (lab) lab.textContent = parts.join(' ');
      const ic = btn.querySelector('.mg-icon') || btn.querySelector('span:first-child');
      if (ic && icon) ic.textContent = icon;
      if (!lab) btn.textContent = label;
    }
  },

  addToMobileSheet(name, label) {
    const grid = document.getElementById('moreGrid');
    if (!grid || grid.querySelector('[data-flow-goto="' + name + '"]')) return;
    const parts = String(label).trim().split(/\s+/);
    let icon = '\u2022';
    if (parts.length > 1 && !/[a-z0-9]/i.test(parts[0])) icon = parts.shift();
    const btn = document.createElement('button');
    /* data-goto as well, so the host's own syncMobileNav() lights this button
       up when our tab is showing. The host attached its click handlers once at
       boot, before we existed, so it cannot double-fire on ours. */
    btn.setAttribute('data-goto', name);
    btn.setAttribute('data-flow-goto', name);
    btn.innerHTML = '<span class="mg-ico">' + esc(icon) + '</span>' +
                    '<span class="mg-lbl">' + esc(parts.join(' ') || name) + '</span>';
    btn.addEventListener('click', () => {
      Tabs.activate(name);
      const sh = document.getElementById('moreSheet');
      const bd = document.getElementById('moreBackdrop');
      if (sh) sh.classList.remove('open');
      if (bd) bd.classList.remove('open');
    });
    grid.appendChild(btn);
  },

  deactivateMine() {
    Object.keys(Tabs.mine).forEach(n => {
      Tabs.mine[n].section.classList.remove('active');
      Tabs.mine[n].pill.classList.remove('active');
    });
  },

  activate(name) {
    const entry = Tabs.mine[name];
    if (!entry) return;
    // Hide everything the host owns without touching how it does it.
    $$('[data-tab]').forEach(el => el.classList.remove('active'));
    $$('.section').forEach(el => el.classList.remove('active'));
    Tabs.deactivateMine();
    entry.pill.classList.add('active');
    entry.section.classList.add('active');
    try { entry.build(entry.section); entry.built = true; }
    catch (e) { console.error('[Flow] tab build failed', e); entry.section.innerHTML = '<div class="flow-card"><h3>Something broke rendering this tab</h3><p class="flow-sub">' + esc(e.message) + '</p></div>'; }
    try { if (typeof window.syncMobileNav === 'function') window.syncMobileNav(); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

/* =========================================================================
 * 10 · The time decorator — puts a date/time/duration control on every
 *      checkbox row that already exists anywhere in the app.
 * ====================================================================== */
const GLYPHS = /[✏️🗑️✕×→⨯⋯…]|\+\s*Rock|→\s*Rock|Q[1-4]\s*$/gu;

const TimeChips = {
  observer: null,
  busy: false,

  sectionOf(el) {
    const sec = el.closest ? el.closest('.section, .flow-section, [id^="tab-"]') : null;
    if (sec && sec.id && sec.id.indexOf('tab-') === 0) return sec.id.slice(4);
    return 'app';
  },

  rowFor(cb) {
    let el = cb.parentElement, hops = 0;
    while (el && hops < 4) {
      const t = norm(el.textContent);
      if (t.length >= 2) return el;
      el = el.parentElement; hops++;
    }
    return cb.parentElement;
  },

  textOf(row) {
    const clone = row.cloneNode(true);
    $$('.flow-time-chip, button, select, option, input', clone).forEach(n => n.remove());
    let t = norm(clone.textContent).replace(GLYPHS, '').trim();
    return t.replace(/\s{2,}/g, ' ').slice(0, 140);
  },

  scan(root) {
    if (!Settings.get('showTimeChips')) return;
    const only = norm(Settings.get('chipTabs'));
    const allow = only ? only.split(',').map(s => s.trim()).filter(Boolean) : null;

    const boxes = $$('input[type=checkbox]', root || document);
    if (!boxes.length) return;
    TimeChips.busy = true;
    try {
      boxes.forEach(cb => {
        if (cb.closest('.flow-x')) return;                 // our own UI
        /* Some checkboxes are settings, not things you do. A "🕘 time" chip
           beside "Big Rocks" in an export panel offers to schedule a filter,
           which is nonsense dressed as a feature. Anything marked opts out. */
        if (cb.closest('[data-flow-no-chip]')) return;
        const row = TimeChips.rowFor(cb);
        if (!row || row.getAttribute('data-flow-timed')) return;
        const tab = TimeChips.sectionOf(cb);
        if (allow && allow.indexOf(tab) < 0) return;
        const text = TimeChips.textOf(row);
        if (!text || text.length < 2) return;

        row.setAttribute('data-flow-timed', '1');
        const key = Schedule.keyFor(tab, text);
        const chip = TimeChips.makeChip(key, text, tab, cb);
        row.appendChild(chip);

        // keep "done" in sync so exported reminders reflect reality
        cb.addEventListener('change', () => {
          const rec = Schedule.get(key);
          if (rec) Schedule.put(key, { done: !!cb.checked });
        });
      });
    } finally { TimeChips.busy = false; }
  },

  makeChip(key, text, tab, cb) {
    const chip = document.createElement('span');
    chip.className = 'flow-time-chip';
    chip.setAttribute('data-flow-key', key);
    chip.title = 'Schedule this — adds a date, time and duration you can export to your calendar';
    TimeChips.paint(chip, Schedule.get(key));
    chip.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      Popover.open(chip, key, text, tab, cb);
    });
    return chip;
  },

  /* The label is rendered by CSS ::after from data-label, never as a text
     node. That keeps the chip out of the row's textContent, so if the host
     app ever serialises a row's text to save it, our label cannot leak into
     your data. */
  paint(chip, rec) {
    if (rec && rec.date) {
      chip.classList.add('set');
      const isToday = rec.date === today();
      chip.setAttribute('data-label', (rec.time ? rec.time : 'all-day') + (isToday ? '' : ' · ' + prettyDate(rec.date)));
    } else {
      chip.classList.remove('set');
      chip.setAttribute('data-label', '🕘 time');
    }
  },

  repaintAll() {
    $$('.flow-time-chip').forEach(chip => TimeChips.paint(chip, Schedule.get(chip.getAttribute('data-flow-key'))));
  },

  watch() {
    const rescan = debounce(() => {
      if (TimeChips.busy) return;
      TimeChips.scan(document);
      try { Visuals.upgradeAll(); } catch (e) { /* never let a repaint break the app */ }
    }, 300);
    TimeChips.observer = new MutationObserver((muts) => {
      if (TimeChips.busy) return;
      for (const m of muts) {
        if (m.type === 'childList' && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && !n.classList.contains('flow-time-chip') && !n.closest('.flow-x')) { rescan(); return; }
          }
        }
      }
    });
    TimeChips.observer.observe(document.body, { childList: true, subtree: true });
  }
};

/* ---------- the scheduling popover ---------- */
const Popover = {
  el: null,
  open(anchor, key, text, tab, cb) {
    Popover.close();
    const rec = Schedule.get(key) || {};
    const el = document.createElement('div');
    el.className = 'flow-pop flow-x';
    el.innerHTML = `
      <h4>${esc(text.slice(0, 70))}${text.length > 70 ? '…' : ''}</h4>
      <div class="g">
        <div class="flow-field"><label class="flow-label">Date</label>
          <input class="flow-in" type="date" id="fp-date" value="${esc(rec.date || today())}"></div>
        <div class="flow-field"><label class="flow-label">Time</label>
          <input class="flow-in" type="time" id="fp-time" value="${esc(rec.time || '')}"></div>
      </div>
      <div class="g">
        <div class="flow-field"><label class="flow-label">Minutes</label>
          <input class="flow-in" type="number" min="5" step="5" id="fp-dur" value="${esc(rec.dur || Settings.get('defaultDurationMin'))}"></div>
        <div class="flow-field"><label class="flow-label">Alert</label>
          <select class="flow-in" id="fp-rem">
            <option value="">none</option>
            <option value="5">5 min before</option>
            <option value="15">15 min before</option>
            <option value="30">30 min before</option>
            <option value="60">1 hour before</option>
          </select></div>
      </div>
      <div class="flow-field" style="margin-bottom:10px">
        <label class="flow-label">Note (optional)</label>
        <input class="flow-in" id="fp-note" placeholder="context, link, location…" value="${esc(rec.note || '')}">
      </div>
      <div class="flow-row">
        <button class="flow-btn primary" id="fp-save">Save</button>
        <button class="flow-btn" id="fp-ics">↓ .ics</button>
        <span class="flow-spacer"></span>
        <button class="flow-btn danger sm" id="fp-clear">Clear</button>
      </div>`;
    document.body.appendChild(el);
    Popover.el = el;

    const r = anchor.getBoundingClientRect();
    const top = window.scrollY + r.bottom + 8;
    const left = clamp(window.scrollX + r.left - 100, 8, window.scrollX + window.innerWidth - 300);
    el.style.top = top + 'px'; el.style.left = left + 'px';

    if (rec.remindMin) $('#fp-rem', el).value = String(rec.remindMin);

    $('#fp-save', el).addEventListener('click', () => {
      const date = $('#fp-date', el).value || today();
      const time = $('#fp-time', el).value || '';
      const dur = Number($('#fp-dur', el).value) || Settings.get('defaultDurationMin');
      const remMin = $('#fp-rem', el).value;
      Schedule.put(key, {
        text, tab, date, time, dur,
        remind: !!remMin, remindMin: remMin ? Number(remMin) : 0,
        note: $('#fp-note', el).value || '',
        done: cb ? !!cb.checked : false,
        source: 'row'
      });
      Schedule.saveNow();
      TimeChips.paint(anchor, Schedule.get(key));
      toast('Scheduled ✓');
      Popover.close();
    });

    $('#fp-ics', el).addEventListener('click', () => {
      const date = $('#fp-date', el).value || today();
      const time = $('#fp-time', el).value || '09:00';
      const one = { key, text, tab, date, time, dur: Number($('#fp-dur', el).value) || 60, note: $('#fp-note', el).value };
      download(`flow-${norm(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}.ics`,
        ICS.build([one], { name: 'The Flow', tz: Settings.get('timezone') }), 'text/calendar');
    });

    $('#fp-clear', el).addEventListener('click', () => {
      Schedule.remove(key); Schedule.saveNow();
      TimeChips.paint(anchor, null); toast('Schedule cleared'); Popover.close();
    });

    setTimeout(() => document.addEventListener('mousedown', Popover._outside), 0);
  },

  _outside(e) {
    if (Popover.el && !Popover.el.contains(e.target) && !(e.target.classList && e.target.classList.contains('flow-time-chip'))) Popover.close();
  },
  close() {
    document.removeEventListener('mousedown', Popover._outside);
    if (Popover.el) { Popover.el.remove(); Popover.el = null; }
  }
};

/* =========================================================================
 * 11 · Charts — single-hue magnitude bars + a trend line.
 *      Sequential encoding, thin marks, 4px rounded data-ends, 2px gaps,
 *      recessive grid, direct value labels, hover tooltip. No dual axes.
 * ====================================================================== */
const Tip = {
  el: null,
  show(x, y, html) {
    if (!Tip.el) { Tip.el = document.createElement('div'); Tip.el.className = 'flow-tip'; document.body.appendChild(Tip.el); }
    Tip.el.innerHTML = html;
    Tip.el.style.left = Math.min(x + 12, window.innerWidth - 200) + 'px';
    Tip.el.style.top = (y - 34) + 'px';
    Tip.el.style.display = 'block';
  },
  hide() { if (Tip.el) Tip.el.style.display = 'none'; }
};

const Chart = {
  /** Horizontal bars, sorted by caller. data = [{label, value, sub}] */
  bars(data, opts) {
    opts = opts || {};
    if (!data.length) return '<p class="flow-empty">Nothing to chart yet.</p>';
    const rowH = 30, gap = 2, padL = opts.labelWidth || 132, padR = 76, padT = 6;
    const w = 720, h = padT + data.length * rowH;
    const max = Math.max.apply(null, data.map(d => d.value)) || 1;
    const bw = w - padL - padR;
    const fmt = opts.format || (v => String(v));

    let svg = `<svg class="flow-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opts.title || 'bar chart')}" preserveAspectRatio="xMinYMin meet">`;
    data.forEach((d, i) => {
      const y = padT + i * rowH;
      const bh = rowH - 8 - gap;
      const len = Math.max(3, (d.value / max) * bw);
      const r = Math.min(4, len / 2);
      const x0 = padL, x1 = padL + len, yt = y + 4;
      const path = `M${x0},${yt} H${x1 - r} A${r},${r} 0 0 1 ${x1},${yt + r} V${yt + bh - r} A${r},${r} 0 0 1 ${x1 - r},${yt + bh} H${x0} Z`;
      svg += `<text class="lbl" x="${padL - 10}" y="${yt + bh / 2 + 4}" text-anchor="end">${esc(String(d.label).slice(0, 22))}</text>`;
      svg += `<path class="bar" d="${path}" data-tip="${esc(d.label + ': ' + fmt(d.value))}"></path>`;
      svg += `<text class="val" x="${x1 + 8}" y="${yt + bh / 2 + 4}">${esc(fmt(d.value))}</text>`;
    });
    svg += '</svg>';
    return svg;
  },

  /** Single-series trend. points = [{label, value}] */
  line(points, opts) {
    opts = opts || {};
    if (points.length < 2) return '<p class="flow-empty">Two or more periods needed for a trend.</p>';
    const w = 720, h = 190, padL = 54, padR = 16, padT = 14, padB = 30;
    const max = Math.max.apply(null, points.map(p => p.value)) || 1;
    const min = 0;
    const iw = w - padL - padR, ih = h - padT - padB;
    const X = i => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const Y = v => padT + ih - ((v - min) / (max - min || 1)) * ih;
    const fmt = opts.format || (v => String(v));

    let svg = `<svg class="flow-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opts.title || 'trend')}" preserveAspectRatio="xMinYMin meet">`;
    for (let g = 0; g <= 3; g++) {
      const v = min + (max - min) * (g / 3), y = Y(v);
      svg += `<line class="grid" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}"/>`;
      svg += `<text class="tick" x="${padL - 8}" y="${y + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
    }
    svg += `<line class="axis" x1="${padL}" y1="${padT + ih}" x2="${w - padR}" y2="${padT + ih}"/>`;
    svg += `<path class="line" d="${points.map((p, i) => (i ? 'L' : 'M') + X(i) + ',' + Y(p.value)).join(' ')}"/>`;
    points.forEach((p, i) => {
      svg += `<circle class="dot" cx="${X(i)}" cy="${Y(p.value)}" r="5" data-tip="${esc(p.label + ': ' + fmt(p.value))}"></circle>`;
      if (points.length <= 14 || i % 2 === 0)
        svg += `<text class="tick" x="${X(i)}" y="${h - 9}" text-anchor="middle">${esc(p.label)}</text>`;
    });
    svg += '</svg>';
    return svg;
  },

  /** A designed empty state. Never a stretched grey blob. */
  empty(msg, sub) {
    return `<div class="flow-nodata">
        <svg viewBox="0 0 120 120" width="104" height="104" aria-hidden="true">
          <circle cx="60" cy="60" r="44" fill="none" stroke="var(--f-line)" stroke-width="10" stroke-dasharray="3 9" stroke-linecap="round"/>
          <circle cx="60" cy="60" r="44" fill="none" stroke="var(--f-accent)" stroke-width="10" stroke-linecap="round"
                  stroke-dasharray="34 242" transform="rotate(-90 60 60)" opacity=".55"/>
        </svg>
        <div class="t">${esc(msg || 'Nothing here yet')}</div>
        ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
      </div>`;
  },

  /** Part-to-whole. Square by construction, so it can never be squashed.
   *  Ordered single-hue ramp (magnitude reads off the ramp, not a rainbow),
   *  2px surface gaps, rounded segment ends, direct labels, total in the hole. */
  donut(data, opts) {
    opts = opts || {};
    const fmt = opts.format || (v => String(v));
    const clean = (data || []).filter(d => Number(d.value) > 0).sort((a, b) => b.value - a.value);
    if (!clean.length) return Chart.empty(opts.emptyMsg || 'No data yet', opts.emptySub);

    /* Five slices is the ceiling: the ramp is a validated 5-step single-hue
       ordinal scale (monotone lightness, every adjacent gap ΔL ≥ 0.06, the
       dark end still clearing the surface at 2.26:1). A sixth step would
       have to be a different hue, and a neutral grey "Other" breaks the
       single-hue gate — so the tail folds into the darkest step instead. */
    let slices = clean;
    if (clean.length > 5) {
      const rest = clean.slice(4).reduce((a, d) => a + d.value, 0);
      slices = clean.slice(0, 4).concat([{ label: 'Other', value: rest, isOther: true }]);
    }
    const total = slices.reduce((a, d) => a + d.value, 0) || 1;
    const RAMP = ['--f-seq-5', '--f-seq-4', '--f-seq-3', '--f-seq-2', '--f-seq-1'];

    /* Thin marks: a 24px band on a 100px radius. A thick band plus round caps
       reads as a row of lozenges rather than a ring. */
    const S = 260, cx = S / 2, cy = S / 2, rOuter = 112, rInner = 88;
    const r = (rOuter + rInner) / 2, sw = rOuter - rInner;
    const C = 2 * Math.PI * r;
    const gapPx = slices.length > 1 ? 4 : 0;

    /* A round linecap paints an extra sw/2 beyond each end of the dash, so a
       naive dash length makes neighbouring segments overlap — which is what
       makes a ring look like the slices are sliding under each other. Shorten
       the dash by the two half-caps and shift the offset by one half-cap, and
       the painted arc lands exactly where a butt cap would, gap intact. */
    let off = 0, arcs = '';
    slices.forEach((d, i) => {
      const span = (d.value / total) * C;
      let len = span - gapPx - sw;
      let dashOff = off + gapPx / 2 + sw / 2;
      if (len <= 0.5) { len = 0.5; dashOff = off + span / 2; }   // slice thinner than the cap
      arcs += `<circle class="slice" cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="var(${RAMP[Math.min(i, RAMP.length - 1)]})" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
        stroke-dashoffset="${(-dashOff).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"
        data-tip="${esc(d.label + ': ' + fmt(d.value) + ' · ' + Math.round(d.value / total * 100) + '%')}"
        style="--i:${i}"></circle>`;
      off += span;
    });

    return `<div class="flow-donut-wrap">
        <div class="flow-donut">
          <svg viewBox="0 0 ${S} ${S}" preserveAspectRatio="xMidYMid meet" class="flow-chart"
               role="img" aria-label="${esc(opts.title || 'breakdown')}">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--f-grid)" stroke-width="${sw}"/>
            ${arcs}
          </svg>
          <div class="flow-donut-mid">
            <div class="v" title="${esc(fmt(total))}">${esc((opts.centerFormat || fmt)(total))}</div>
            <div class="l">${esc(opts.centerLabel || 'total')}</div>
          </div>
        </div>
        <ul class="flow-legend">
          ${slices.map((d, i) => `<li>
            <i style="background:var(${RAMP[Math.min(i, RAMP.length - 1)]})"></i>
            <span class="n">${esc(String(d.label).slice(0, 26))}</span>
            <span class="p">${Math.round(d.value / total * 100)}%</span>
            <span class="v">${esc(fmt(d.value))}</span>
          </li>`).join('')}
        </ul>
      </div>`;
  },

  /** Hover layer. Called after any container that holds charts is painted. */
  hydrate(root) {
    $$('[data-tip]', root).forEach(el => {
      if (el.__tipBound) return;
      el.__tipBound = true;
      el.style.cursor = 'default';
      el.addEventListener('mousemove', (e) => Tip.show(e.clientX, e.clientY, esc(el.getAttribute('data-tip'))));
      el.addEventListener('mouseleave', () => Tip.hide());
    });
  },

  /** A ratio against a limit — same-ramp track, never a two-slice pie. */
  meter(value, limit, opts) {
    opts = opts || {};
    const pct = limit > 0 ? clamp(value / limit, 0, 1.35) : 0;
    const over = value > limit && limit > 0;
    const fmt = opts.format || (v => String(v));
    return `<div style="margin-top:10px">
      <div class="flow-row between" style="margin-bottom:6px">
        <span class="flow-label">${esc(opts.label || 'Budget')}</span>
        <span style="font-size:12.5px;font-variant-numeric:tabular-nums">${esc(fmt(value))} / ${esc(fmt(limit))}</span>
      </div>
      <div style="height:8px;border-radius:999px;background:var(--f-surface-2);overflow:hidden">
        <i style="display:block;height:100%;width:${(Math.min(pct, 1) * 100).toFixed(1)}%;background:${over ? 'var(--f-critical)' : 'var(--f-accent)'}"></i>
      </div>
      <div style="margin-top:6px;font-size:11.5px;color:${over ? 'var(--f-critical)' : 'var(--f-muted)'}">
        ${over ? '⚠ Over budget by ' + esc(fmt(value - limit)) : esc((limit ? Math.round(pct * 100) : 0) + '% of budget used')}
      </div></div>`;
  }
};
/* =========================================================================
 * 12 · Finance — receipt photos + OCR, statement import, spending analysis
 * ====================================================================== */
const EXPENSE_KEY = 'flow:expenses';

function parseAmount(s) {
  if (typeof s === 'number') return s;
  let t = String(s == null ? '' : s).replace(/[^\d.,\-()]/g, '').trim();
  if (!t) return NaN;
  const neg = /^\(.*\)$/.test(String(s)) || t.indexOf('-') >= 0;
  t = t.replace(/[()\-]/g, '');
  const lastC = t.lastIndexOf(','), lastD = t.lastIndexOf('.');
  if (lastC > lastD) t = t.replace(/\./g, '').replace(',', '.');       // 1.234,56
  else if (lastD > lastC) t = t.replace(/,/g, '');                      // 1,234.56
  else t = t.replace(/[.,]/g, '');
  const v = parseFloat(t);
  if (isNaN(v)) return NaN;
  return neg ? -v : v;
}

function parseDateGuess(s, prefer) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    let d = a, mo = b;
    if (prefer === 'mdy' || (a <= 12 && b > 12)) { mo = a; d = b; }
    if (mo > 12) { const tmp = mo; mo = d; d = tmp; }
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  const d2 = new Date(t);
  return isNaN(d2.getTime()) ? null : isoDate(d2);
}

function splitCSV(text) {
  const delim = (() => {
    const head = text.split(/\r?\n/)[0] || '';
    const counts = { ',': (head.match(/,/g) || []).length, ';': (head.match(/;/g) || []).length, '\t': (head.match(/\t/g) || []).length };
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
  })();
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => norm(c)));
}

const Finance = {
  items: [],
  async load() { Finance.items = (await DB.get(EXPENSE_KEY, [])) || []; return Finance.items; },
  save() { return DB.set(EXPENSE_KEY, Finance.items); },

  categorise(merchant, note) {
    const hay = (norm(merchant) + ' ' + norm(note)).toLowerCase();
    const mem = Settings.get('merchantMemory') || {};
    for (const m in mem) if (m && hay.indexOf(m) >= 0) return mem[m];
    for (const [cat, keys] of DEFAULT_RULES) for (const k of keys) if (hay.indexOf(k) >= 0) return cat;
    return 'Other';
  },

  async learn(merchant, category) {
    const key = norm(merchant).toLowerCase().slice(0, 40);
    if (!key || !category) return;
    const mem = Object.assign({}, Settings.get('merchantMemory') || {});
    mem[key] = category;
    await Settings.set('merchantMemory', mem);
  },

  async add(rec) {
    const item = Object.assign({
      id: uid('e'), date: today(), time: '', amount: 0,
      currency: Settings.get('currency'), merchant: '', category: '',
      method: '', note: '', receiptId: null, source: 'manual',
      created: new Date().toISOString()
    }, rec);
    if (!item.category) item.category = Finance.categorise(item.merchant, item.note);
    Finance.items.push(item);
    await Finance.save();
    return item;
  },

  async remove(id) {
    const it = Finance.items.find(x => x.id === id);
    Finance.items = Finance.items.filter(x => x.id !== id);
    if (it && it.receiptId) await DB.set('flow:receipt:' + it.receiptId, null);
    await Finance.save();
  },

  inMonth(ym) { return Finance.items.filter(x => String(x.date).slice(0, 7) === ym); },

  byCategory(items) {
    const m = {};
    items.forEach(x => { const c = x.category || 'Other'; m[c] = (m[c] || 0) + Math.abs(Number(x.amount) || 0); });
    return Object.keys(m).map(k => ({ label: k, value: m[k] })).sort((a, b) => b.value - a.value);
  },

  byMonth(n) {
    const out = [], now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const total = Finance.inMonth(ym).reduce((s, x) => s + Math.abs(Number(x.amount) || 0), 0);
      out.push({ label: MON[d.getMonth()], value: Math.round(total) });
    }
    return out;
  },

  /* ---------- image handling ---------- */
  compress(file, maxPx, quality) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read that file'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not an image'));
        img.onload = () => {
          const scale = Math.min(1, (maxPx || 1400) / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality || 0.72));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  },

  /* ---------- OCR ---------- */
  loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (Finance._tess) return Finance._tess;
    Finance._tess = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
      s.onload = () => res(window.Tesseract);
      s.onerror = () => rej(new Error('Could not load the OCR engine (offline?)'));
      document.head.appendChild(s);
    });
    return Finance._tess;
  },

  async ocr(dataUrl, onProgress) {
    const T = await Finance.loadTesseract();
    const langs = Settings.get('ocrLangs') || 'eng';
    const res = await T.recognize(dataUrl, langs, {
      logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress || 0); }
    });
    return (res && res.data && res.data.text) || '';
  },

  /** Pull merchant / total / date / time / VAT out of raw receipt text. */
  parseReceipt(text) {
    const lines = String(text).split(/\r?\n/).map(l => norm(l)).filter(Boolean);
    const up = lines.map(l => l.toUpperCase());
    const out = { merchant: '', amount: NaN, date: null, time: '', vat: NaN, raw: text };

    const TOTAL_KEYS = ['GENEL TOPLAM', 'TOPLAM TUTAR', 'TOPLAM', 'TOTAL', 'AMOUNT DUE', 'TUTAR', 'ODENECEK', 'ÖDENECEK', 'GRAND TOTAL', 'SUM', 'NET TOPLAM'];
    const VAT_KEYS = ['KDV', 'VAT', 'TAX'];
    const numRe = /(-?[\d.,]{2,})/g;

    // total: prefer the LAST line that mentions a total keyword
    for (let i = up.length - 1; i >= 0 && isNaN(out.amount); i--) {
      if (!TOTAL_KEYS.some(k => up[i].indexOf(k) >= 0)) continue;
      const nums = (lines[i].match(numRe) || []).map(parseAmount).filter(n => !isNaN(n) && Math.abs(n) > 0);
      if (nums.length) out.amount = Math.abs(nums[nums.length - 1]);
      else if (lines[i + 1]) {
        const n2 = (lines[i + 1].match(numRe) || []).map(parseAmount).filter(n => !isNaN(n) && n > 0);
        if (n2.length) out.amount = Math.abs(n2[n2.length - 1]);
      }
    }
    // fallback: biggest plausible money-looking number on the receipt
    if (isNaN(out.amount)) {
      const all = [];
      lines.forEach(l => (l.match(numRe) || []).forEach(t => {
        if (!/[.,]\d{2}\b/.test(t)) return;
        const v = parseAmount(t);
        if (!isNaN(v) && v > 0 && v < 1e7) all.push(Math.abs(v));
      }));
      if (all.length) out.amount = Math.max.apply(null, all);
    }

    for (let i = 0; i < up.length && isNaN(out.vat); i++) {
      if (!VAT_KEYS.some(k => up[i].indexOf(k) >= 0)) continue;
      const nums = (lines[i].match(numRe) || []).map(parseAmount).filter(n => !isNaN(n) && n > 0);
      if (nums.length) out.vat = Math.abs(nums[nums.length - 1]);
    }

    for (const l of lines) {
      const dm = l.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})|(\d{4}-\d{2}-\d{2})/);
      if (dm && !out.date) out.date = parseDateGuess(dm[0]);
      const tm = l.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
      if (tm && !out.time) out.time = pad(+tm[1]) + ':' + tm[2];
      if (out.date && out.time) break;
    }

    for (const l of lines.slice(0, 6)) {
      const letters = (l.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
      if (letters >= 4 && l.length <= 44 && !/FIS|FİŞ|RECEIPT|TARIH|TARİH|SAAT|NO:/i.test(l)) { out.merchant = l; break; }
    }
    if (!out.merchant && lines.length) out.merchant = lines[0].slice(0, 44);
    return out;
  },

  /* ---------- statement import ---------- */
  mapColumns(header) {
    const h = header.map(x => norm(x).toLowerCase());
    const find = (cands) => {
      for (let i = 0; i < h.length; i++) for (const c of cands) if (h[i].indexOf(c) >= 0) return i;
      return -1;
    };
    return {
      date: find(['tarih', 'date', 'işlem tarihi', 'islem tarihi', 'valör', 'valor', 'booking']),
      desc: find(['açıklama', 'aciklama', 'description', 'detay', 'işlem', 'islem', 'narrative', 'merchant', 'payee', 'memo', 'title']),
      amount: find(['tutar', 'amount', 'miktar', 'işlem tutarı', 'islem tutari', 'value', 'debit/credit', 'betrag']),
      debit: find(['borç', 'borc', 'debit', 'çıkan', 'cikan', 'withdrawal', 'harcama']),
      credit: find(['alacak', 'credit', 'giren', 'deposit', 'yatan']),
      currency: find(['para birimi', 'currency', 'döviz', 'doviz', 'pb'])
    };
  },

  parseStatement(text, opts) {
    opts = opts || {};
    const rows = splitCSV(text);
    if (rows.length < 2) return { items: [], skipped: 0, header: [] };
    const header = rows[0];
    const map = opts.map || Finance.mapColumns(header);
    const out = []; let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const dateRaw = map.date >= 0 ? r[map.date] : '';
      const date = parseDateGuess(dateRaw, opts.prefer);
      if (!date) { skipped++; continue; }

      let amount = NaN;
      if (map.amount >= 0) amount = parseAmount(r[map.amount]);
      if (isNaN(amount) && map.debit >= 0) { const d = parseAmount(r[map.debit]); if (!isNaN(d) && d !== 0) amount = -Math.abs(d); }
      if (isNaN(amount) && map.credit >= 0) { const c = parseAmount(r[map.credit]); if (!isNaN(c) && c !== 0) amount = Math.abs(c); }
      if (isNaN(amount) || amount === 0) { skipped++; continue; }
      if (opts.spendOnly !== false && amount > 0) { skipped++; continue; }   // keep money going out

      const desc = map.desc >= 0 ? norm(r[map.desc]) : '';
      out.push({
        date, amount: Math.abs(amount), merchant: desc.slice(0, 80),
        currency: (map.currency >= 0 ? norm(r[map.currency]) : '') || Settings.get('currency'),
        note: 'Imported from statement', source: 'statement',
        category: Finance.categorise(desc, '')
      });
    }
    return { items: out, skipped, header, map };
  },

  async importItems(items) {
    // de-duplicate against what is already stored: date + amount + merchant
    const seen = {};
    Finance.items.forEach(x => { seen[`${x.date}|${Math.abs(x.amount).toFixed(2)}|${norm(x.merchant).toLowerCase().slice(0, 24)}`] = 1; });
    let added = 0, dupes = 0;
    for (const it of items) {
      const k = `${it.date}|${Math.abs(it.amount).toFixed(2)}|${norm(it.merchant).toLowerCase().slice(0, 24)}`;
      if (seen[k]) { dupes++; continue; }
      seen[k] = 1;
      Finance.items.push(Object.assign({ id: uid('e'), created: new Date().toISOString(), time: '', method: '', receiptId: null }, it));
      added++;
    }
    await Finance.save();
    return { added, dupes };
  }
};

/* =========================================================================
 * 13 · Notes — nested bracket sections, explicit save + autosave
 * ====================================================================== */
const NOTES_KEY = 'flow:notes';

function newBracket(title) {
  return { id: uid('b'), title: title || 'New section', content: '', collapsed: false, children: [],
           remind: false, due: '', dueTime: '', remindMin: 15 };
}
function walkBrackets(list, fn, parent) {
  (list || []).forEach(b => { fn(b, parent); walkBrackets(b.children, fn, b); });
}
function findBracket(list, id) {
  let hit = null;
  walkBrackets(list, (b) => { if (b.id === id) hit = b; });
  return hit;
}
function removeBracket(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) { list.splice(i, 1); return true; }
    if (removeBracket(list[i].children || [], id)) return true;
  }
  return false;
}

const Notes = {
  book: {},           // notebookId -> { id, title, brackets:[], updated }
  dirty: {},

  async load() { Notes.book = (await DB.get(NOTES_KEY, {})) || {}; return Notes.book; },

  get(id, title) {
    if (!Notes.book[id]) Notes.book[id] = { id, title: title || id, brackets: [newBracket('Notes')], updated: null };
    if (!Notes.book[id].brackets) Notes.book[id].brackets = [];
    return Notes.book[id];
  },

  async saveAll(silent) {
    const ok = await DB.set(NOTES_KEY, Notes.book);
    Notes.dirty = {};
    if (!silent) toast(ok ? 'Notes saved ✓' : 'Saved on this device — will sync when back online', ok ? null : 'warn');
    $$('.flow-note-status').forEach(el => {
      el.textContent = ok ? 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Saved locally (offline)';
      el.className = 'flow-note-status ' + (ok ? 'ok' : 'pending');
    });
    return ok;
  },

  autosave: debounce(() => { Notes.saveAll(true); }, 1400),

  markDirty(id) {
    Notes.dirty[id] = true;
    $$('.flow-note-status[data-book="' + id + '"]').forEach(el => {
      el.textContent = 'Unsaved changes…'; el.className = 'flow-note-status pending';
    });
    Notes.autosave();
  },

  /** Flagged sections as calendar events (VEVENT + alarm), not just to-dos. */
  exportCalendar(recs, name) {
    const ics = ICS.build(recs, {
      name: 'The Flow', tz: Settings.get('timezone'),
      defaultDuration: Settings.get('defaultDurationMin')
    });
    download('flow-' + (name || 'notes') + '-' + today() + '.ics', ics, 'text/calendar');
    toast(recs.length + (recs.length === 1 ? ' event' : ' events') + ' exported — open the file to add it to your calendar.', null, 4200);
  },

  /** Human label for a bracket's reminder, shown on the collapsed header. */
  whenLabel(b) {
    if (!b.due) return 'reminder';
    let out;
    try { const d = parseISO(b.due); out = d.getDate() + ' ' + MON[d.getMonth()]; }
    catch (e) { out = String(b.due); }
    return out + (b.dueTime ? ' ' + b.dueTime : '');
  },

  /** Brackets flagged "remind" become iOS reminders. */
  asReminders() {
    const out = [];
    Object.keys(Notes.book).forEach(id => {
      walkBrackets(Notes.book[id].brackets, (b) => {
        if (!b.remind) return;
        out.push({
          key: 'note::' + b.id, text: b.title, tab: id,
          date: b.due || today(),
          /* A VTODO/VEVENT only carries an alarm if it has a wall-clock time.
             Passing '' here was why flagged sections exported but never fired. */
          time: b.dueTime || '09:00',
          dur: 30,
          remind: true,
          remindMin: (b.remindMin == null ? 15 : Number(b.remindMin)),
          note: (b.content || '').slice(0, 400), done: false, source: 'note'
        });
      });
    });
    return out;
  },

  /* ---------- rendering ---------- */
  renderBracket(b, bookId, depth) {
    return `
      <div class="flow-bracket${b.collapsed ? ' collapsed' : ''}" data-b="${b.id}" data-book="${bookId}">
        <div class="bh">
          <button class="tw" data-act="toggle" title="Collapse / expand">${b.collapsed ? '▶' : '▼'}</button>
          <input class="bt" data-act="title" value="${esc(b.title)}" placeholder="Section title…">
          <span class="flow-chip${b.remind ? ' accent' : ''}" data-act="remind" style="cursor:pointer"
                title="${b.remind ? 'Remove the reminder' : 'Remind me about this section'}">${
                  b.remind
                    ? '🔔 ' + esc(Notes.whenLabel(b))
                    : '🔕'
                }</span>
          <button class="flow-btn ghost sm" data-act="del" title="Delete section">✕</button>
        </div>
        <div class="bb">
          <textarea data-act="content" placeholder="Write here — it saves automatically and when you press Save notes.">${esc(b.content)}</textarea>
          ${b.remind ? `<div class="flow-row" style="margin-top:8px;align-items:flex-end">
              <div class="flow-field"><label class="flow-label">Date</label>
                <input class="flow-in" type="date" data-act="due" value="${esc(b.due || today())}"></div>
              <div class="flow-field"><label class="flow-label">Time</label>
                <input class="flow-in" type="time" data-act="dueTime" value="${esc(b.dueTime || '09:00')}"></div>
              <div class="flow-field"><label class="flow-label">Alert</label>
                <select class="flow-in" data-act="remindMin">
                  ${[[0,'at the time'],[5,'5 min before'],[15,'15 min before'],[30,'30 min before'],[60,'1 hour before'],[1440,'1 day before']]
                    .map(([v,l]) => `<option value="${v}"${Number(b.remindMin == null ? 15 : b.remindMin) === v ? ' selected' : ''}>${l}</option>`).join('')}
                </select></div>
            </div>
            <div class="flow-sub" style="margin:6px 0 0">Exports with an alarm to Apple Calendar, Google Calendar and iOS Reminders.</div>` : ''}
          <div class="bactions">
            ${b.remind ? '<button class="flow-btn sm" data-act="oneCalendar" title="Download this section as a calendar event with an alarm">📅 To calendar</button>' : ''}
            ${b.remind ? '<button class="flow-btn sm" data-act="oneReminder" title="Download this section as an iOS reminder with an alarm">🔔 To reminders</button>' : ''}
            <button class="flow-btn sm" data-act="addChild">+ Sub-section</button>
            ${depth === 0 ? '<button class="flow-btn sm" data-act="addSibling">+ Section below</button>' : ''}
          </div>
          <div class="kids">${(b.children || []).map(c => Notes.renderBracket(c, bookId, depth + 1)).join('')}</div>
        </div>
      </div>`;
  },

  renderBook(bookId, title) {
    const bk = Notes.get(bookId, title);
    return `
      <div class="flow-row between" style="margin-bottom:10px">
        <span class="flow-label">${esc(bk.title)} · notes</span>
        <span class="flow-row">
          <span class="flow-note-status" data-book="${bookId}">${bk.updated ? 'Saved ' + esc(String(bk.updated).slice(11, 16)) : 'Not saved yet'}</span>
          <button class="flow-btn primary sm" data-act="save" data-book="${bookId}">💾 Save notes</button>
        </span>
      </div>
      <div data-notes-body="${bookId}">
        ${bk.brackets.map(b => Notes.renderBracket(b, bookId, 0)).join('') || '<p class="flow-empty">No sections yet.</p>'}
      </div>
      <div class="flow-row" style="margin-top:10px">
        <button class="flow-btn" data-act="addRoot" data-book="${bookId}">+ Add bracket section</button>
        <button class="flow-btn" data-act="toReminders" data-book="${bookId}">🔔 Send flagged → Reminders</button>
        <button class="flow-btn" data-act="toCalendar" data-book="${bookId}">📅 Send flagged → Calendar</button>
      </div>`;
  },

  /** One delegated handler serves every notes editor on the page. */
  bind(root) {
    if (root.__flowNotesBound) return;
    root.__flowNotesBound = true;

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const host = btn.closest('[data-b]');
      const bookId = (host && host.getAttribute('data-book')) || btn.getAttribute('data-book');
      if (!bookId) return;
      const bk = Notes.get(bookId);
      const b = host ? findBracket(bk.brackets, host.getAttribute('data-b')) : null;

      if (act === 'toggle' && b) { b.collapsed = !b.collapsed; Notes.markDirty(bookId); Notes.repaint(root, bookId); }
      else if (act === 'del' && b) {
        if (!confirm('Delete "' + b.title + '" and everything inside it?')) return;
        removeBracket(bk.brackets, b.id); Notes.markDirty(bookId); Notes.repaint(root, bookId);
      }
      else if (act === 'addChild' && b) { b.children = b.children || []; b.children.push(newBracket('Sub-section')); b.collapsed = false; Notes.markDirty(bookId); Notes.repaint(root, bookId); }
      else if (act === 'addSibling') { bk.brackets.push(newBracket('New section')); Notes.markDirty(bookId); Notes.repaint(root, bookId); }
      else if (act === 'addRoot') { bk.brackets.push(newBracket('New section')); Notes.markDirty(bookId); Notes.repaint(root, bookId); }
      else if (act === 'remind' && b) {
        b.remind = !b.remind;
        if (b.remind) { if (!b.due) b.due = today(); if (!b.dueTime) b.dueTime = '09:00'; if (b.remindMin == null) b.remindMin = 15; }
        Notes.markDirty(bookId); Notes.repaint(root, bookId);
      }
      else if (act === 'save') { bk.updated = new Date().toISOString(); await Notes.saveAll(false); }
      else if (act === 'toReminders') {
        const recs = Notes.asReminders().filter(r => r.tab === bookId);
        if (!recs.length) { toast('Flag a section with 🔕 → 🔔 first.', 'warn'); return; }
        Reminders.exportICS(recs);
      }
      else if (act === 'toCalendar') {
        const recs = Notes.asReminders().filter(r => r.tab === bookId);
        if (!recs.length) { toast('Flag a section with 🔕 → 🔔 first.', 'warn'); return; }
        Notes.exportCalendar(recs, bookId + '-reminders');
      }
      else if (act === 'oneCalendar' && b) {
        const recs = Notes.asReminders().filter(r => r.key === 'note::' + b.id);
        if (!recs.length) { toast('Turn the 🔔 on first.', 'warn'); return; }
        Notes.exportCalendar(recs, norm(b.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) || 'reminder');
      }
      else if (act === 'oneReminder' && b) {
        const recs = Notes.asReminders().filter(r => r.key === 'note::' + b.id);
        if (!recs.length) { toast('Turn the 🔔 on first.', 'warn'); return; }
        Reminders.exportICS(recs);
      }
    });

    const onEdit = (e) => {
      const f = e.target.closest('[data-act]');
      if (!f) return;
      const act = f.getAttribute('data-act');
      const host = f.closest('[data-b]');
      if (!host) return;
      const bookId = host.getAttribute('data-book');
      const bk = Notes.get(bookId);
      const b = findBracket(bk.brackets, host.getAttribute('data-b'));
      if (!b) return;
      if (act === 'title') b.title = f.value;
      else if (act === 'content') b.content = f.value;
      else if (act === 'due') b.due = f.value;
      else if (act === 'dueTime') b.dueTime = f.value;
      else if (act === 'remindMin') b.remindMin = Number(f.value);
      else return;
      bk.updated = new Date().toISOString();
      Notes.markDirty(bookId);
    };
    root.addEventListener('input', onEdit);
  },

  repaint(root, bookId) {
    const body = root.querySelector('[data-notes-body="' + bookId + '"]');
    if (!body) return;
    const bk = Notes.get(bookId);
    body.innerHTML = bk.brackets.map(b => Notes.renderBracket(b, bookId, 0)).join('') || '<p class="flow-empty">No sections yet.</p>';
  },

  /** Collapsed notes drawer appended to each of the app's own sections. */
  mountInline(section, bookId, title) {
    if (section.querySelector('[data-flow-notes-drawer]')) return;
    const wrap = document.createElement('div');
    wrap.className = 'flow-x';
    wrap.setAttribute('data-flow-notes-drawer', bookId);
    wrap.style.margin = '18px 0 6px';
    const bk = Notes.get(bookId, title);
    let count = 0; walkBrackets(bk.brackets, () => count++);

    wrap.innerHTML = `
      <button class="flow-btn" data-flow-notes-toggle style="width:100%;text-align:left;border-radius:12px">
        📝 Notes for ${esc(title)} <span class="flow-chip" style="margin-left:8px">${count} section${count === 1 ? '' : 's'}</span>
      </button>
      <div class="flow-card" data-flow-notes-panel style="display:none">${Notes.renderBook(bookId, title)}</div>`;
    section.appendChild(wrap);

    const toggle = wrap.querySelector('[data-flow-notes-toggle]');
    const panel = wrap.querySelector('[data-flow-notes-panel]');
    toggle.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      if (!open) Notes.repaint(panel, bookId);
    });
    Notes.bind(wrap);
  }
};

/* =========================================================================
 * 14 · Live roll-up of the app's own tabs (for the Planner dashboard)
 * ====================================================================== */
const Rollup = {
  sections() {
    return $$('.section').filter(s => s.id && s.id.indexOf('tab-') === 0 && !s.classList.contains('flow-section'));
  },
  labelFor(name) {
    const pill = $(`[data-tab="${name}"]`);
    return pill ? norm(pill.textContent) : name;
  },
  statsIn(section) {
    return $$('.stat', section).map(el => {
      const kids = Array.prototype.slice.call(el.children).filter(n => norm(n.textContent));
      if (kids.length >= 2) return { value: norm(kids[0].textContent), label: norm(kids[kids.length - 1].textContent) };
      const t = norm(el.textContent); const sp = t.indexOf(' ');
      return { value: sp > 0 ? t.slice(0, sp) : t, label: sp > 0 ? t.slice(sp + 1) : '' };
    }).filter(s => s.value);
  },
  checks(section) {
    const boxes = $$('input[type=checkbox]', section).filter(b => !b.closest('.flow-x'));
    return { total: boxes.length, done: boxes.filter(b => b.checked).length };
  },
  all() {
    return Rollup.sections().map(sec => {
      const name = sec.id.slice(4);
      return { name, label: Rollup.labelFor(name), stats: Rollup.statsIn(sec), checks: Rollup.checks(sec) };
    });
  },
  headline(max) {
    const picked = [];
    Rollup.all().forEach(s => s.stats.forEach(st => { if (picked.length < (max || 8)) picked.push({ tab: s.label, value: st.value, label: st.label }); }));
    return picked;
  }
};

/* =========================================================================
 * 15 · The Planner tab
 * ====================================================================== */
/* =========================================================================
 * 26 · Markets — a live price strip on Today
 *
 * The server does the fetching and the caching; this only draws. It always
 * shows the last number it was given along with how old that number is,
 * because a figure with an honest timestamp is more useful on a train than a
 * spinner that never resolves.
 * ======================================================================= */
const Markets = {
  KEY: 'flow:markets',
  DEFAULT: ['BTCUSD', 'USDTRY', 'EURTRY', 'GRAMGOLDTRY'],
  LABEL: {
    BTCUSD: ['Bitcoin', '$'], BTCTRY: ['Bitcoin', '₺'], BTCEUR: ['Bitcoin', '€'],
    USDTRY: ['Dollar', '₺'], EURTRY: ['Euro', '₺'], EURUSD: ['Euro', '$'],
    XAUUSD: ['Gold / oz', '$'], GRAMGOLDTRY: ['Gram gold', '₺']
  },
  data: null,
  watch: null,

  /* A widget, not a fixture: nothing is drawn, and nothing is fetched, until
     it is switched on in Settings. Most people never want prices on the
     screen they plan their day from; the ones who do pick which. */
  enabled() { return Settings.get('todayMarkets') === true; },

  async load() {
    if (Markets.watch === null) {
      const saved = await DB.get(Markets.KEY, null);
      Markets.watch = Array.isArray(saved) && saved.length ? saved : Markets.DEFAULT.slice();
    }
    return Markets.watch;
  },
  async setWatch(list) {
    Markets.watch = list.filter(s => Markets.LABEL[s]).slice(0, 8);
    if (!Markets.watch.length) Markets.watch = Markets.DEFAULT.slice();
    await DB.set(Markets.KEY, Markets.watch);
    Markets.paint();
  },

  /* Called when the switch in Settings moves. On: fetch and draw. Off: take
     the strip away, now, without waiting for Today to redraw itself. */
  async refresh() {
    if (!Markets.enabled()) { Markets.paint(); return; }
    await Markets.load();
    await Markets.fetch();
    Markets.paint();
  },

  fmt(sym, v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    const [, unit] = Markets.LABEL[sym] || ['', ''];
    /* Big numbers do not need decimals; a rate does. */
    const dp = v >= 1000 ? 0 : v >= 100 ? 1 : 2;
    return unit + v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  },
  ago(ms) {
    if (ms == null) return '';
    const s = Math.round(ms / 1000);
    if (s < 90) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h + (h === 1 ? ' hour ago' : ' hours ago');
  },

  async fetch(force) {
    try {
      const r = await fetch('/api/flow/prices', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      if (j && j.quotes) { Markets.data = j; return j; }
    } catch (e) { /* offline — keep whatever we drew last */ }
    return null;
  },

  async mount() {
    await Markets.load();
    if (Markets.enabled()) await Markets.fetch();
    /* Today's render replaces the whole section, strip included, so put it
       back afterwards instead of relying on having painted last. Hook it
       before the first paint, so a paint that fails cannot skip the hook. */
    if (!Markets._hooked) {
      Markets._hooked = 1;
      const hostRender = window.renderToday;
      if (typeof hostRender === 'function') {
        window.renderToday = function () {
          const r = hostRender.apply(this, arguments);
          try { Markets.paint(); } catch (e) {}
          return r;
        };
      }
    }
    Markets.paint();
    /* Refresh while the tab is actually being looked at, not in the background. */
    if (!Markets._timer) {
      Markets._timer = setInterval(async () => {
        if (document.hidden || !Markets.enabled()) return;
        await Markets.fetch();
        Markets.paint();
      }, 120000);
    }
  },

  /* The row at the foot of Today where widgets are added and taken away.
     One widget so far — prices — with its pairs as chips once it is on. */
  widgetRow() {
    const feed = document.getElementById('today-feed');
    if (!feed) return;
    let row = feed.querySelector('#td-widgets');
    if (!row) {
      row = document.createElement('div'); row.id = 'td-widgets'; row.className = 'td-widgets';
      feed.appendChild(row);
      row.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-widget]');
        const c = e.target.closest('[data-mkt-chip]');
        if (b) {
          const on = !Markets.enabled();
          await Settings.set('todayMarkets', on);
          Markets.widgetRow();
          Markets.refresh().catch(() => {});
          toast(on ? 'Prices added to Today.' : 'Prices removed from Today.', null, 1400);
        } else if (c) {
          const sym = c.getAttribute('data-mkt-chip');
          const list = (Markets.watch || Markets.DEFAULT).slice();
          const i = list.indexOf(sym);
          if (i >= 0) { if (list.length > 1) list.splice(i, 1); } else list.push(sym);
          await Markets.setWatch(list);
          Markets.widgetRow();
        }
      });
    }
    const on = Markets.enabled();
    const watch = Markets.watch || Markets.DEFAULT;
    row.innerHTML = '<span class="td-widgets-l">Widgets</span>' +
      '<button type="button" class="td-wbtn' + (on ? ' on' : '') + '" data-widget="markets">' + (on ? '✓ Prices' : '+ Prices') + '</button>' +
      (on ? Object.keys(Markets.LABEL).map((sym) => '<button type="button" class="td-wchip' + (watch.indexOf(sym) >= 0 ? ' on' : '') + '" data-mkt-chip="' + sym + '"><span data-i18n="off">' + esc(Markets.LABEL[sym][0]) + ' ' + esc(Markets.LABEL[sym][1]) + '</span></button>').join('') : '');
    if (row !== feed.lastElementChild) feed.appendChild(row);
  },

  paint() {
    const feed = $('#tab-today') || $('.section#tab-today');
    try { Markets.widgetRow(); } catch (e) {}
    if (!Markets.enabled()) {
      const old = feed && $('#flow-markets', feed);
      if (old) old.remove();
      return;
    }
    if (!feed) {
      /* Today is not on the page yet. Come back for it rather than
         dropping the paint, but give up after six seconds so a genuinely
         missing container cannot leave a timer running forever. */
      if (Markets._waits == null) Markets._waits = 0;
      if (Markets._waits++ < 40) setTimeout(Markets.paint, 150);
      return;
    }
    Markets._waits = 0;
    let strip = $('#flow-markets', feed);
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'flow-markets';
      strip.className = 'flow-td flow-mkt flow-x';
      /* Under the morning pulse — where it always sat, and where the
         Settings switch says it will be. Put at the foot of the page it
         was, correctly, never seen. */
      const pulse = $('.flow-td-pulse', feed);
      if (pulse && pulse.parentNode) pulse.parentNode.insertBefore(strip, pulse.nextSibling);
      else { const daily = $('#today-feed', feed); const wr = daily && daily.querySelector('#td-widgets'); if (wr) daily.insertBefore(strip, wr); else (daily || feed).appendChild(strip); }
    }
    const d = Markets.data;
    const q = (d && d.quotes) || {};
    const list = (Markets.watch || Markets.DEFAULT).filter(s => Markets.LABEL[s]);
    if (!d) {
      strip.innerHTML = '<div class="flow-mkt-note">Prices load when the server wakes up.</div>';
      return;
    }
    strip.innerHTML =
      '<div class="flow-mkt-row">' +
      list.map(sym => {
        const [name] = Markets.LABEL[sym] || [sym];
        const has = typeof q[sym] === 'number';
        return `<div class="flow-mkt-tile${has ? '' : ' dim'}">
                  <span class="l">${esc(name)}</span>
                  <span class="v">${esc(Markets.fmt(sym, q[sym]))}</span>
                </div>`;
      }).join('') +
      '</div>' +
      `<div class="flow-mkt-note">${d.stale ? '⚠️ ' : ''}${esc(Markets.ago(d.ageMs))}` +
      (d.fxDate ? ' · rates ' + esc(d.fxDate) : '') +
      (Object.keys(d.errors || {}).length ? ' · some sources unavailable' : '') +
      ' · gram gold is derived from the ounce price</div>';
  }
};

/* =========================================================================
 * 27 · Shared tasks — a small inbox
 *
 * Accepting is done here, in the recipient's own app, rather than on the
 * server: the server hands the task over and this decides where it belongs.
 * Nothing arrives in anyone's list without them pressing Add.
 * ======================================================================= */
const Inbox = {
  items: [],

  async load() {
    try {
      const r = await fetch('/api/share/inbox', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return [];
      const j = await r.json();
      Inbox.items = (j && j.items) || [];
    } catch (e) { Inbox.items = []; }
    return Inbox.items;
  },

  async send(email, task) {
    const r = await fetch('/api/share/send', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, task })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not share that.');
    return j;
  },

  async resolve(id, accept) {
    const r = await fetch('/api/share/' + (accept ? 'accept' : 'decline'), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'That item is gone.');
    return j.item;
  },

  /** File an accepted task as a Big Rock: on the day it is due, or today.
      Big Rocks are what the week is planned from and what Today shows, so
      an accepted task lands where it will actually be seen. */
  async file(item) {
    if (typeof cData === 'undefined' || !cData || typeof cSave !== 'function') throw new Error('Could not reach your week.');
    const todayD = new Date(); todayD.setHours(12, 0, 0, 0);
    let d = todayD;
    if (item.task.due) { const x = new Date(item.task.due + 'T12:00:00'); if (!isNaN(x) && x > todayD) d = x; }
    const wid = WeekLoop.wid(d), day = WeekLoop.dow(d);
    const who = item.from ? (item.from.via === 'inbox' ? 'via ' : 'from ') + item.from.name : '';
    (cData.rocks[wid] = cData.rocks[wid] || []).push({
      id: Date.now().toString(36) + Math.floor(Math.random() * 1e4), title: item.task.txt, role: '', day,
      time: item.task.time || '', end: '', prio: 'med',
      note: [who, item.task.note || ''].filter(Boolean).join(' — '), done: false,
      src: { k: 'inbox', id: item.id }
    });
    cSave();
    if (typeof window.renderCompass === 'function') window.renderCompass();
    if (typeof window.renderToday === 'function') window.renderToday();
  },

  /* The same card on Today, only while something is waiting. Today is the
     screen that gets opened; a card nobody sees is the same as no card. */
  paintToday() {
    const feed = document.getElementById('today-feed');
    if (!feed) return;
    let wrap = feed.querySelector('#td-inbox');
    if (!Inbox.items.length) { if (wrap) wrap.remove(); return; }
    if (wrap && wrap.getAttribute('data-n') === String(Inbox.items.length)) return;
    if (!wrap) {
      wrap = document.createElement('div'); wrap.id = 'td-inbox';
      const after = feed.querySelector('#td-weekplan');
      if (after && after.nextSibling) feed.insertBefore(wrap, after.nextSibling); else feed.insertBefore(wrap, feed.firstChild);
    }
    wrap.setAttribute('data-n', String(Inbox.items.length));
    wrap.innerHTML = '';
    Inbox.render(wrap);
  },

  render(host) {
    const n = Inbox.items.length;
    const box = document.createElement('div');
    box.className = 'flow-card flow-x';
    box.id = 'flow-inbox';
    box.innerHTML = `<h3>📥 Shared with you${n ? ' · ' + n : ''}</h3>` +
      (!n ? '<p class="flow-sub">Nothing waiting. A task somebody shares with you, or anything sent to your inbox address, appears here.</p>'
          : '<p class="flow-sub">Nothing is added to your app until you press Add.</p>' +
            Inbox.items.map(it => `
              <div class="flow-inbox-row" data-id="${esc(it.id)}">
                <div class="t">${esc(it.task.txt)}</div>
                <div class="m">${it.from && it.from.via === 'inbox' ? 'via ' : 'from '}${esc(it.from ? it.from.name : 'someone')}${it.task.due ? ' · due ' + esc(it.task.due) + (it.task.time ? ' ' + esc(it.task.time) : '') : ''}</div>
                ${it.task.note ? `<div class="n">${esc(it.task.note)}</div>` : ''}
                <div class="a">
                  <button class="flow-btn small primary" data-inbox="add">Add as a Big Rock</button>
                  <button class="flow-btn small ghost" data-inbox="no">Dismiss</button>
                </div>
              </div>`).join(''));
    host.appendChild(box);

    box.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-inbox]');
      if (!btn) return;
      const row = btn.closest('.flow-inbox-row');
      const id = row.getAttribute('data-id');
      const accept = btn.getAttribute('data-inbox') === 'add';
      btn.disabled = true;
      try {
        const item = await Inbox.resolve(id, accept);
        if (accept && item) await Inbox.file(item);
        await Inbox.load();
        const parent = box.parentElement;
        box.remove();
        if (parent && parent.id === 'td-inbox') { parent.removeAttribute('data-n'); Inbox.paintToday(); }
        else Inbox.render(parent);
      } catch (err) {
        row.querySelector('.m').textContent = err.message;
        btn.disabled = false;
      }
    });
  }
};

/* =========================================================================
 * 28 · The assistant — read-only, over your own data
 * ======================================================================= */
/* ======================================================================
 * Ask — a conversation, not a form submission
 *
 * The old version posted a question and waited for the whole answer before
 * showing anything: eight seconds of a bare ellipsis, twenty if the free
 * instance had gone to sleep, and no way to tell a slow answer from a
 * broken one. The words were being written the entire time; they were just
 * being held back until the last one arrived.
 *
 * This streams them, so the first ones land about a second in and the wait
 * becomes something you watch. Three states are visible and distinct:
 * reaching the server, thinking, and writing — because "nothing on screen"
 * is what makes software feel broken, not slowness itself.
 * ==================================================================== */

/* A small markdown renderer. The model writes lists and emphasis; rendering
   them as literal asterisks is the difference between a chat and a log file.
   Everything is escaped before any markup is introduced, so nothing the
   model returns can become live HTML. */
function askMd(src) {
  const text = String(src == null ? '' : src);
  const blocks = [];
  /* Fenced code is lifted out first so nothing inside it is treated as
     markup, then put back at the end. */
  const stripped = text.replace(/```([\s\S]*?)```/g, (m, code) => {
    blocks.push(code.replace(/^\w*\n/, ''));
    return '  CODE' + (blocks.length - 1) + '  ';
  });

  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

  const out = [];
  let list = null;                       /* 'ul' | 'ol' | null */
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };

  stripped.split('\n').forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); return; }

    const code = /^ CODE(\d+) $/.exec(line.trim());
    if (code) { closeList(); out.push('<pre><code>' + esc(blocks[+code[1]]) + '</code></pre>'); return; }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push('<h4>' + inline(h[2]) + '</h4>'); return; }

    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ul) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + inline(ul[1]) + '</li>'); return;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + inline(ol[1]) + '</li>'); return;
    }
    closeList();
    out.push('<p>' + inline(line) + '</p>');
  });
  closeList();
  return out.join('');
}

const Ask = {
  turns: [],
  busy: false,
  phase: '',            /* 'reaching' | 'thinking' | 'writing' */
  meta: '',
  loaded: false,
  held: false,          /* true once the person scrolls up to re-read */
  ctrl: null,           /* the in-flight request, so Stop can end it */
  sec: null,

  K_THREAD: 'flow:ask:thread',
  MAX_KEPT: 40,

  SUGGESTIONS: [
    'What should I focus on this week?',
    'Am I keeping up with training?',
    'How has my sleep been?',
    'Where is my money going?'
  ],

  async load() {
    if (Ask.loaded) return;
    const saved = await DB.get(Ask.K_THREAD, null);
    if (Array.isArray(saved)) {
      Ask.turns = saved.filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string');
    }
    Ask.loaded = true;
  },
  save() {
    /* A thread that grew forever would eventually be a slow read on every
       app start, so only the recent stretch is kept. */
    DB.set(Ask.K_THREAD, Ask.turns.slice(-Ask.MAX_KEPT));
  },

  async render(sec) {
    Ask.sec = sec;
    if (!Ask.loaded) {
      sec.innerHTML = '<div class="flow-card"><p class="flow-sub">Loading…</p></div>';
      try { await Ask.load(); } catch (e) { Ask.loaded = true; }
    }
    sec.innerHTML =
      '<div class="ask-shell">' +
        '<div class="ask-scroll" id="ask-scroll"><div class="ask-inner" id="ask-log"></div></div>' +
        '<div class="ask-dock">' +
          '<div class="ask-box">' +
            '<textarea id="ask-in" rows="1" placeholder="Ask about your week…" aria-label="Message"></textarea>' +
            '<button class="ask-send" id="ask-go" aria-label="Send">' +
              '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>' +
          '</div>' +
          '<div class="ask-foot"><span id="ask-meta"></span>' +
            '<button class="ask-clear" id="ask-clear">New conversation</button></div>' +
        '</div>' +
      '</div>';

    Ask.paint();
    Ask.wire();
  },

  /* ------------------------------ painting ------------------------------ */

  paint() {
    const log = document.getElementById('ask-log');
    if (!log) return;

    if (!Ask.turns.length && !Ask.busy) {
      log.innerHTML =
        '<div class="ask-empty">' +
          '<div class="ask-empty-h">Ask about your own record</div>' +
          '<p>It can see your priorities, this week, your journal, training, habits, sleep, ' +
            'metrics and spending — and answer questions about them. It cannot change anything, ' +
            'which is deliberate.</p>' +
          '<div class="ask-chips">' +
            Ask.SUGGESTIONS.map(q => '<button class="ask-chip" data-ask="' + esc(q) + '">' + esc(q) + '</button>').join('') +
          '</div>' +
        '</div>';
    } else {
      log.innerHTML = Ask.turns.map((t, i) => {
        const last = i === Ask.turns.length - 1;
        if (t.role === 'user') {
          return '<div class="ask-msg user"><div class="ask-bubble">' +
                 esc(t.content).replace(/\n/g, '<br>') + '</div></div>';
        }
        const writing = last && Ask.phase === 'writing';
        return '<div class="ask-msg bot">' +
                 '<div class="ask-body' + (writing ? ' writing' : '') + '">' + askMd(t.content) + '</div>' +
               '</div>';
      }).join('') + Ask.pending();
    }
    Ask.stick();
    Ask.paintFoot();
  },

  /* The waiting states, said in words rather than left blank. */
  pending() {
    if (Ask.phase === 'reaching') {
      return '<div class="ask-msg bot"><div class="ask-think">' + Ask.dots() +
             '<span class="ask-think-t">Reaching the server…</span></div></div>';
    }
    if (Ask.phase === 'thinking') {
      return '<div class="ask-msg bot"><div class="ask-think">' + Ask.dots() +
             '<span class="ask-think-t">Reading your week…</span></div></div>';
    }
    return '';
  },
  dots() { return '<span class="ask-dots"><i></i><i></i><i></i></span>'; },

  paintFoot() {
    const m = document.getElementById('ask-meta');
    if (m) m.textContent = Ask.meta;
    /* Nothing to clear yet — offering to is just noise. */
    const clear = document.getElementById('ask-clear');
    if (clear) clear.style.display = Ask.turns.length ? '' : 'none';
    const go = document.getElementById('ask-go');
    if (go) {
      go.classList.toggle('stop', Ask.busy);
      go.setAttribute('aria-label', Ask.busy ? 'Stop' : 'Send');
      go.innerHTML = Ask.busy
        ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    }
  },

  /* Follow the answer as it is written, but stop following the moment the
     person scrolls up to re-read something. */
  stick() {
    const sc = document.getElementById('ask-scroll');
    if (!sc || Ask.held) return;
    sc.scrollTop = sc.scrollHeight;
  },

  /* --------------------------- the conversation -------------------------- */

  async send(text) {
    const input = document.getElementById('ask-in');
    const q = String(text || (input && input.value) || '').trim();
    if (!q || Ask.busy) return;
    if (input) { input.value = ''; Ask.grow(input); }

    Ask.turns.push({ role: 'user', content: q });
    Ask.busy = true;
    Ask.phase = 'reaching';
    Ask.held = false;
    Ask.paint();

    const history = Ask.turns.slice(-12);
    let reply = '', opened = false;
    const ctrl = ('AbortController' in window) ? new AbortController() : null;
    Ask.ctrl = ctrl;

    const fail = (msg) => { Ask.turns.push({ role: 'assistant', content: msg }); Ask.finish(); };

    let r;
    try {
      r = await fetch('/api/flow/chat/stream', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      if (e && e.name === 'AbortError') { Ask.finish(); return; }
      fail('Could not reach the server. Try again in a moment.');
      return;
    }

    if (!r.ok || !r.body) {
      /* A refusal arrives as ordinary JSON; a browser too old for streams
         gets the buffered endpoint rather than an error. */
      let j = null;
      try { j = await r.json(); } catch (e) {}
      if (j && j.error) { fail(j.error); return; }
      if (!r.body) { await Ask.sendBuffered(history); return; }
      fail('That did not work.');
      return;
    }

    Ask.phase = 'thinking';
    Ask.paint();

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', painting = false;
    const repaint = () => {
      if (painting) return;
      painting = true;
      requestAnimationFrame(() => { painting = false; Ask.paint(); });
    };

    try {
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        buf += dec.decode(step.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split('\n').filter(l => l.indexOf('data:') === 0)[0];
          if (!line) continue;
          let ev = null;
          try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }

          if (ev.t === 'open') { Ask.phase = 'thinking'; repaint(); }
          else if (ev.t === 'd') {
            if (!opened) {
              opened = true;
              Ask.phase = 'writing';
              Ask.turns.push({ role: 'assistant', content: '' });
            }
            reply += ev.v;
            Ask.turns[Ask.turns.length - 1].content = reply;
            repaint();
          }
          else if (ev.t === 'meta') { Ask.meta = ev.used + ' of ' + ev.cap + ' messages today'; }
          else if (ev.t === 'err') {
            if (!opened) { Ask.turns.push({ role: 'assistant', content: ev.v }); opened = true; }
            else { Ask.turns[Ask.turns.length - 1].content = reply + '\n\n_' + ev.v + '_'; }
          }
        }
      }
    } catch (e) {
      if (!(e && e.name === 'AbortError') && !opened) {
        Ask.turns.push({ role: 'assistant', content: 'The answer was cut off. Try again?' });
        opened = true;
      }
    }

    if (!opened) Ask.turns.push({ role: 'assistant', content: 'No answer came back. Try again?' });
    Ask.finish();
  },

  /* Older browsers with no streaming body: ask the buffered endpoint rather
     than show an error for something that works perfectly well. */
  async sendBuffered(history) {
    Ask.phase = 'thinking'; Ask.paint();
    try {
      const r = await fetch('/api/flow/chat', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });
      const j = await r.json().catch(() => ({}));
      Ask.turns.push({ role: 'assistant', content: (r.ok ? (j.reply || '(no answer)') : (j.error || 'That did not work.')) });
      if (r.ok && j.used != null) Ask.meta = j.used + ' of ' + j.cap + ' messages today';
    } catch (e) {
      Ask.turns.push({ role: 'assistant', content: 'Could not reach the server.' });
    }
    Ask.finish();
  },

  finish() {
    Ask.busy = false;
    Ask.phase = '';
    Ask.ctrl = null;
    Ask.save();
    Ask.paint();
    const input = document.getElementById('ask-in');
    if (input && window.innerWidth > 760) input.focus();
  },

  stop() {
    if (Ask.ctrl) { try { Ask.ctrl.abort(); } catch (e) {} }
    Ask.busy = false; Ask.phase = ''; Ask.ctrl = null;
    Ask.save(); Ask.paint();
  },

  /* ------------------------------- wiring ------------------------------- */

  grow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  },

  wire() {
    const sec = Ask.sec;
    const input = $('#ask-in', sec);
    const go = $('#ask-go', sec);
    const sc = $('#ask-scroll', sec);

    if (input) {
      Ask.grow(input);
      input.addEventListener('input', () => Ask.grow(input));
      input.addEventListener('keydown', (e) => {
        /* Enter sends, Shift+Enter starts a line — the convention everywhere
           else a person types a message. */
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); Ask.send(); }
      });
    }
    if (go) go.addEventListener('click', () => (Ask.busy ? Ask.stop() : Ask.send()));

    if (sc) sc.addEventListener('scroll', () => {
      Ask.held = (sc.scrollHeight - sc.scrollTop - sc.clientHeight) > 90;
    });

    const clear = $('#ask-clear', sec);
    if (clear) clear.addEventListener('click', () => {
      if (Ask.busy) Ask.stop();
      Ask.turns = []; Ask.meta = ''; Ask.save(); Ask.paint();
    });

    sec.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ask]');
      if (b) Ask.send(b.getAttribute('data-ask'));
    });
  }
};

const Planner = {
  /* Which week the "Rest of the week" panel is showing. 0 = this week; negative
     steps into past weeks so overdue tasks can be found and cleared there;
     positive steps into future weeks so plans can be built and edited ahead. */
  weekOffset: 0,

  /* Key of the row currently being edited inline, or null. Only one row edits at
     a time; entering edit mode re-renders that row as a text/date/time form. */
  editing: null,

  /* First name of the signed-in account, else the display name from Settings,
     else a neutral word. Never a name baked into the file. */
  who() {
    const fromAuth = (Auth.user && Auth.user.name) || '';
    const fromSettings = (Settings.data && Settings.data.displayName) || '';
    const raw = String(fromAuth || fromSettings || '').trim();
    if (!raw) return 'Planner';
    return raw.split(/\s+/)[0].slice(0, 18);
  },
  applyTabName() {
    try { Tabs.relabel('artur', '👤 ' + Planner.who()); } catch (e) {}
    try { Nav.relabel(); } catch (e) {}
  },

  /* How many scheduled, undone items the fold's chip should show. */
  chip() {
    try {
      const n = Schedule.scheduled().filter(r => !r.done && r.date <= today()).length;
      return n ? n + ' due' : '';
    } catch (e) { return ''; }
  },

  render(section) {
    const s = Settings.data;
    const now = new Date();
    const wk = isoWeek(now);
    const off = Planner.weekOffset || 0;
    const ws = addDays(startOfWeek(now, s.weekStart), off * 7);
    const weekFrom = isoDate(ws), weekTo = isoDate(addDays(ws, 6));
    const wkOff = isoWeek(ws);
    const relWeek = off === 0 ? 'this week'
      : off < 0 ? (-off) + ' week' + (off === -1 ? '' : 's') + ' ago'
      : 'in ' + off + ' week' + (off === 1 ? '' : 's');

    const todayItems = Schedule.onDate(today());
    const weekItems = Schedule.between(weekFrom, weekTo);
    const overdue = Schedule.scheduled().filter(r => !r.done && r.date < today());

    section.innerHTML = `
      <div class="flow-row between" style="margin:6px 0 14px">
        <div>
          <div class="flow-label">${esc(DOW[now.getDay()])}, ${now.getDate()} ${esc(MON[now.getMonth()])} ${now.getFullYear()} · week ${wk.week}</div>
          <div class="flow-hero">${esc(s.displayName || Planner.who())}</div>
        </div>
        <div class="flow-row">
          <button class="flow-btn" data-a="refresh">↻ Refresh</button>
          <button class="flow-btn primary" data-a="settings">⚙ Settings</button>
        </div>
      </div>

      <div class="flow-grid c2">
        <div class="flow-card">
          <h3>⏱ Today</h3>
          <p class="flow-sub">Everything you gave a time to, from any tab. Add times with the 🕘 chip that sits on every task row.</p>
          ${Planner.timeline(todayItems)}
          <div class="flow-row" style="margin-top:12px">
            <input class="flow-in grow" id="ar-new" placeholder="Add something to today…">
            <input class="flow-in" type="time" id="ar-time" style="width:110px">
            <button class="flow-btn primary" data-a="add">Add</button>
          </div>
        </div>

        <div class="flow-card">
          <h3>📅 Rest of the week</h3>
          <p class="flow-sub">Grouped by day. Overdue items float to the top so nothing quietly rots. Edit any task with ✏️, delete with ✕, and step through past or future weeks with ← → to fix old tasks or plan ahead.</p>
          <div class="flow-row between" style="margin:0 0 12px;gap:8px">
            <div class="flow-row" style="gap:6px">
              <button class="flow-btn sm" data-a="wkprev">← Prev</button>
              <button class="flow-btn sm" data-a="wknext">Next →</button>
              ${off !== 0 ? '<button class="flow-btn ghost sm" data-a="wknow">This week</button>' : ''}
            </div>
            <span class="flow-label">Week ${wkOff.week} · ${wkOff.year} — ${esc(relWeek)}</span>
          </div>
          ${Planner.weekList(overdue, weekItems, off)}
          <div class="flow-row" style="margin-top:14px;gap:6px;flex-wrap:wrap">
            <input class="flow-in grow" id="wk-new" placeholder="Plan something for ${esc(relWeek)}…">
            <input class="flow-in" type="date" id="wk-date" value="${off === 0 ? today() : weekFrom}" min="${weekFrom}" max="${weekTo}" style="width:148px">
            <input class="flow-in" type="time" id="wk-time" style="width:104px">
            <button class="flow-btn primary" data-a="addweek">Add to week</button>
          </div>
        </div>
      </div>

      <div class="flow-card">
        <h3>📤 Send this to your calendar</h3>
        <p class="flow-sub">A standard .ics file that opens in Apple Calendar, Google Calendar or Outlook. The same task always maps to the same event, so importing again updates rather than duplicates.</p>
        <div class="flow-row">
          <span class="flow-label">Range</span>
          <select class="flow-in" id="ar-range">
            <option value="week">This week</option>
            <option value="2weeks">Next 2 weeks</option>
            <option value="4weeks" selected>Next 4 weeks</option>
            <option value="12weeks">Next 12 weeks</option>
            <option value="all">Everything</option>
          </select>
          <button class="flow-btn" data-a="ics">📆 Calendar file (.ics)</button>
          <span class="flow-spacer"></span>
          <span class="flow-note-status" id="ar-calstatus"></span>
        </div>
      </div>

      <div class="flow-card" data-artur-notes></div>`;

    // notes for the planner itself (the notebook keeps its old key)
    const nb = section.querySelector('[data-artur-notes]');
    nb.innerHTML = Notes.renderBook('artur', 'Planner');
    /* Anything somebody has shared, waiting to be accepted. */
    try { Inbox.render(section); } catch (e) {}
    Notes.bind(nb);
    Chart.hydrate(section);

    section.querySelectorAll('[data-a]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const a = btn.getAttribute('data-a');
        const range = () => (section.querySelector('#ar-range') || {}).value || '4weeks';
        const status = section.querySelector('#ar-calstatus');
        if (a === 'refresh') Planner.render(section);
        else if (a === 'wkprev') { Planner.weekOffset = (Planner.weekOffset || 0) - 1; Planner.render(section); }
        else if (a === 'wknext') { Planner.weekOffset = (Planner.weekOffset || 0) + 1; Planner.render(section); }
        else if (a === 'wknow')  { Planner.weekOffset = 0; Planner.render(section); }
        else if (a === 'settings') Tabs.activate('settings');
        else if (a === 'journal') {
          const jt = $$('[data-tab]').find(p => /journal|📓/i.test(p.textContent));
          if (jt) { jt.click(); setTimeout(() => { const b = $('#jr-body'); if (b) { b.scrollIntoView({ behavior: 'smooth', block: 'center' }); b.focus(); } }, 350); }
        }
        else if (a === 'ics') Calendar.exportApple(range());
        else if (a === 'gcal') Calendar.exportGoogle(range(), status);
        else if (a === 'rem') Reminders.exportICS();
        else if (a === 'add') {
          const t = section.querySelector('#ar-new');
          const tm = section.querySelector('#ar-time');
          const text = norm(t.value);
          if (!text) { toast('Type something first.', 'warn'); return; }
          const key = 'planner::' + uid('p');
          Schedule.put(key, { text, tab: 'planner', date: today(), time: tm.value || '', dur: Settings.get('defaultDurationMin'), done: false, source: 'planner' });
          await Schedule.saveNow();
          t.value = ''; tm.value = '';
          Planner.render(section);
          toast('Added to today ✓');
        }
        else if (a === 'addweek') {
          const t = section.querySelector('#wk-new');
          const dt = section.querySelector('#wk-date');
          const tm = section.querySelector('#wk-time');
          const text = norm(t.value);
          if (!text) { toast('Type something first.', 'warn'); return; }
          const key = 'planner::' + uid('p');
          Schedule.put(key, { text, tab: 'planner', date: dt.value || weekFrom, time: tm.value || '', dur: Settings.get('defaultDurationMin'), done: false, source: 'planner' });
          await Schedule.saveNow();
          Planner.render(section);
          toast('Added to ' + relWeek + ' ✓');
        }
      });
    });

    section.querySelectorAll('[data-done]').forEach(cb => {
      cb.addEventListener('change', async () => {
        Schedule.put(cb.getAttribute('data-done'), { done: cb.checked });
        await Schedule.saveNow();
        TimeChips.repaintAll();
        cb.closest('li') && cb.closest('li').classList.toggle('done', cb.checked);
      });
    });
    section.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async () => {
        Schedule.remove(b.getAttribute('data-del'));
        await Schedule.saveNow(); TimeChips.repaintAll(); Planner.render(section);
      });
    });
    section.querySelectorAll('[data-edit]').forEach(b => {
      b.addEventListener('click', () => {
        Planner.editing = b.getAttribute('data-edit');
        Planner.render(section);
        const inp = section.querySelector('[data-ef="text"]');
        if (inp) { inp.focus(); inp.select(); }
      });
    });
    const saveEdit = async (key, li) => {
      if (!key || !li) return;
      const text = norm((li.querySelector('[data-ef="text"]') || {}).value || '');
      if (!text) { toast('Task text can’t be empty.', 'warn'); return; }
      const date = (li.querySelector('[data-ef="date"]') || {}).value || '';
      const time = (li.querySelector('[data-ef="time"]') || {}).value || '';
      Schedule.put(key, { text, date, time });
      await Schedule.saveNow();
      Planner.editing = null;
      TimeChips.repaintAll();
      Planner.render(section);
      toast('Saved ✓');
    };
    section.querySelectorAll('[data-save]').forEach(b => {
      b.addEventListener('click', () => saveEdit(b.getAttribute('data-save'), b.closest('li')));
    });
    section.querySelectorAll('[data-cancel]').forEach(b => {
      b.addEventListener('click', () => { Planner.editing = null; Planner.render(section); });
    });
    section.querySelectorAll('[data-star]').forEach(b => {
      b.addEventListener('click', async () => {
        const k = b.getAttribute('data-star');
        const cur = Schedule.get(k) || {};
        Schedule.put(k, { priority: !cur.priority });
        await Schedule.saveNow();
        try { TodayPlus.apply(); } catch (e) {}
        Planner.render(section);
        toast(cur.priority ? 'Removed from Today priorities' : 'Pinned to Today priorities ★');
      });
    });
    section.querySelectorAll('[data-ef="text"]').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const li = inp.closest('li'); saveEdit(li.getAttribute('data-row'), li); }
        else if (e.key === 'Escape') { e.preventDefault(); Planner.editing = null; Planner.render(section); }
      });
    });
    const wkNew = section.querySelector('#wk-new');
    if (wkNew) wkNew.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const btn = section.querySelector('[data-a="addweek"]'); if (btn) btn.click(); }
    });
  },

  timeline(items) {
    if (!items.length) return '<p class="flow-empty">Nothing scheduled for today. Give a task a time with the 🕘 chip on any tab, or add one below.</p>';
    return '<ul class="flow-tl">' + items.map(r => `
      <li class="${r.done ? 'done' : ''}">
        <span class="tm ${r.time ? '' : 'none'}">${esc(r.time || '—')}</span>
        <span class="tx">${esc(r.text)}<small>${esc(Rollup.labelFor(r.tab) || r.tab)}${r.dur ? ' · ' + r.dur + ' min' : ''}</small></span>
        <span class="flow-row">
          <button class="flow-btn ghost sm" data-star="${esc(r.key)}" title="${r.priority ? 'On your Today priorities — tap to unpin' : 'Pin to your Today priorities'}"${r.priority ? ' style="color:#f5c451"' : ''}>${r.priority ? '★' : '☆'}</button>
          <input type="checkbox" data-done="${esc(r.key)}" ${r.done ? 'checked' : ''} title="Mark done">
          ${r.source === 'planner' ? `<button class="flow-btn ghost sm" data-del="${esc(r.key)}" title="Remove">✕</button>` : ''}
        </span>
      </li>`).join('') + '</ul>';
  },

  /* off = 0 shows the overdue float (relative to today) plus this week's
     upcoming days. Any other offset shows that whole week grouped by day — a
     past week surfaces old overdue tasks to clear, a future week the plans you
     are building ahead. Every row carries ✏️ to edit its text/date/time inline
     (changing the date moves it to another week) and ✕ to delete it. */
  weekList(overdue, week, off) {
    off = off || 0;
    const editing = Planner.editing;
    const del = (k) => `<button class="flow-btn ghost sm" data-del="${esc(k)}" title="Delete this task">✕</button>`;
    const ed = (k) => `<button class="flow-btn ghost sm" data-edit="${esc(k)}" title="Edit this task">✏️</button>`;
    const star = (r) => `<button class="flow-btn ghost sm" data-star="${esc(r.key)}" title="${r.priority ? 'On your Today priorities — tap to unpin' : 'Pin to your Today priorities'}"${r.priority ? ' style="color:#f5c451"' : ''}>${r.priority ? '★' : '☆'}</button>`;
    /* The row's <li> is normally a grid (time | text | actions); inline
       display:flex overrides that so the edit fields lay out on one wrapping
       line instead of being crushed into the narrow first column. */
    const editRow = (r) =>
      `<li class="editing" data-row="${esc(r.key)}" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">` +
      `<input class="flow-in" data-ef="text" value="${esc(r.text)}" placeholder="Task" style="flex:1 1 180px;min-width:150px">` +
      `<input class="flow-in" type="date" data-ef="date" value="${esc(r.date || '')}" style="flex:0 0 auto;width:150px">` +
      `<input class="flow-in" type="time" data-ef="time" value="${esc(r.time || '')}" style="flex:0 0 auto;width:112px">` +
      `<button class="flow-btn primary sm" data-save="${esc(r.key)}">Save</button>` +
      `<button class="flow-btn ghost sm" data-cancel="1">Cancel</button>` +
      `</li>`;
    const row = (r, timeText) =>
      r.key === editing ? editRow(r) :
      `<li class="${r.done ? 'done' : ''}">` +
      `<span class="tm ${r.time ? '' : 'none'}">${esc(timeText)}</span>` +
      `<span class="tx">${esc(r.text)}<small>${esc(Rollup.labelFor(r.tab) || r.tab)}</small></span>` +
      `<span class="flow-row">${star(r)}${ed(r.key)}${del(r.key)}</span></li>`;

    let html = '';
    if (off === 0 && overdue.length) {
      html += `<div class="flow-label" style="color:var(--f-critical);margin-bottom:6px">⚠ Overdue</div><ul class="flow-tl">` +
        overdue.map(r => row(r, prettyDate(r.date))).join('') + '</ul>';
    }
    const days = (off === 0) ? week.filter(r => r.date > today()) : week.slice();
    const byDay = {};
    days.forEach(r => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    Object.keys(byDay).sort().forEach(d => {
      html += `<div class="flow-label" style="margin:12px 0 4px">${esc(prettyDate(d))}</div><ul class="flow-tl">` +
        byDay[d].map(r => row(r, r.time || '—')).join('') + '</ul>';
    });
    if (!html) return off === 0
      ? '<p class="flow-empty">The rest of the week is open.</p>'
      : '<p class="flow-empty">Nothing scheduled that week.</p>';
    return html;
  }
};

/* =========================================================================
 * 16 · Finance UI — injected into the app's own Finances tab
 * ====================================================================== */
const FinanceUI = {
  state: { photo: null, parsed: null, staged: null },

  mount(section) {
    if (section.querySelector('[data-flow-finance]')) { FinanceUI.repaint(section); return; }
    const wrap = document.createElement('div');
    wrap.className = 'flow-x';
    wrap.setAttribute('data-flow-finance', '1');
    section.appendChild(wrap);
    FinanceUI.repaint(section);
  },

  repaint(section) {
    const wrap = section.querySelector('[data-flow-finance]');
    if (!wrap) return;
    const s = Settings.data;
    const now = new Date();
    const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const month = Finance.inMonth(ym);
    const total = month.reduce((a, x) => a + Math.abs(Number(x.amount) || 0), 0);
    const cats = Finance.byCategory(month);
    const trend = Finance.byMonth(6);
    const recent = Finance.items.slice().sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))).slice(0, 25);
    const budget = Number(s.budgetMonthly) || 0;

    wrap.innerHTML = `
      <div class="flow-card">
        <h3>📸 Snap a receipt</h3>
        <p class="flow-sub">Photograph an invoice or till receipt and the text is read on your device — nothing is uploaded anywhere. Merchant, total, date and time are filled in for you; correct anything that came out wrong and save.</p>
        <div class="flow-drop" data-fa="pick">
          Tap to take a photo or choose an image<br>
          <span style="font-size:11.5px">JPG · PNG · HEIC · works offline after the first run</span>
        </div>
        <input type="file" accept="image/*" capture="environment" id="fx-file" style="display:none">
        <div class="flow-prog" id="fx-prog" style="display:none"><i></i></div>
        <div id="fx-result" style="margin-top:14px"></div>
      </div>

      <div class="flow-card">
        <h3>➕ Add an expense by hand</h3>
        <div class="flow-grid c4" style="gap:10px">
          <div class="flow-field"><label class="flow-label">Date</label><input class="flow-in" type="date" id="fx-date" value="${today()}"></div>
          <div class="flow-field"><label class="flow-label">Time</label><input class="flow-in" type="time" id="fx-time"></div>
          <div class="flow-field"><label class="flow-label">Amount</label><input class="flow-in" type="number" step="0.01" id="fx-amt" placeholder="0.00"></div>
          <div class="flow-field"><label class="flow-label">Category</label>
            <select class="flow-in" id="fx-cat">${s.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        </div>
        <div class="flow-row" style="margin-top:10px">
          <input class="flow-in grow" id="fx-merch" placeholder="Merchant / description">
          <input class="flow-in" id="fx-note" placeholder="Note (optional)" style="flex:1 1 160px">
          <button class="flow-btn primary" data-fa="addManual">Add expense</button>
        </div>
      </div>

      <div class="flow-card">
        <h3>🏦 Import a bank statement</h3>
        <p class="flow-sub">Export CSV from your internet banking, drop it here, and every line is dated, categorised and de-duplicated against what you already have. Re-importing an overlapping file is safe.</p>
        <div class="flow-drop" data-fa="pickCsv">Drop a CSV here, or tap to choose one</div>
        <input type="file" accept=".csv,.txt,text/csv" id="fx-csv" style="display:none">
        <div id="fx-csvresult" style="margin-top:12px"></div>
        <details style="margin-top:12px">
          <summary style="cursor:pointer;font-size:12.5px;color:var(--f-muted)">Why not connect the bank directly?</summary>
          <p class="flow-sub" style="margin-top:8px">Direct bank connections go through an aggregator — Plaid (US/CA/UK/EU), GoCardless Bank Account Data (free, EU/UK), or Salt Edge (widest coverage, includes Turkey). All three need a signed-up account, server-side API keys and, for the EU ones, a licensed agent agreement. Turkish banks in particular are thin on aggregator coverage, which is why statement import is the path that actually works today. When you have credentials, set the provider in Settings and the server add-on will pull transactions on the same schedule.</p>
        </details>
      </div>

      <div class="flow-grid c2">
        <div class="flow-card">
          <h3>Where ${esc(MON[now.getMonth()])} went</h3>
          <p class="flow-sub">${month.length} expense${month.length === 1 ? '' : 's'} · ${esc(money(total, s.currency))} total</p>
          ${budget ? Chart.meter(total, budget, { label: 'Monthly budget', format: v => money(v, s.currency) }) : ''}
          <div style="margin-top:14px">${cats.length ? Chart.bars(cats, { format: v => money(v, s.currency), title: 'Spending by category' }) : '<p class="flow-empty">Nothing logged this month yet.</p>'}</div>
        </div>
        <div class="flow-card">
          <h3>Last 6 months</h3>
          <p class="flow-sub">Total spend per month, so a bad month is obvious before the next one starts.</p>
          ${Chart.line(trend, { format: v => money(v, s.currency).replace(/[.,]00$/, ''), title: 'Monthly spend' })}
        </div>
      </div>

      <div class="flow-card">
        <div class="flow-row between">
          <h3 style="margin:0">Recent expenses</h3>
          <span class="flow-row">
            <button class="flow-btn sm" data-fa="exportCsv">↓ Export CSV</button>
            <button class="flow-btn sm" data-fa="exportJson">↓ Backup JSON</button>
          </span>
        </div>
        <div class="flow-scroll" style="margin-top:12px">
          <table class="flow-table">
            <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>${recent.length ? recent.map(x => `
              <tr>
                <td style="white-space:nowrap">${esc(prettyDate(x.date))}${x.time ? ' <span style="color:var(--f-muted)">' + esc(x.time) + '</span>' : ''}</td>
                <td>${esc(String(x.merchant || '—').slice(0, 46))}${x.receiptId ? ' <span class="flow-chip" data-fa="viewRcpt" data-id="' + esc(x.id) + '" style="cursor:pointer">📸</span>' : ''}</td>
                <td><select class="flow-in" data-recat="${esc(x.id)}" style="padding:3px 6px;font-size:11.5px">${s.categories.map(c => `<option${c === x.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
                <td class="num">${esc(money(Math.abs(x.amount), x.currency || s.currency))}</td>
                <td><button class="flow-btn ghost sm" data-fa="del" data-id="${esc(x.id)}">✕</button></td>
              </tr>`).join('') : '<tr><td colspan="5" class="flow-empty">No expenses yet — snap a receipt or import a statement above.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    FinanceUI.bind(section, wrap);
    Chart.hydrate(wrap);
  },

  bind(section, wrap) {
    const fileEl = wrap.querySelector('#fx-file');
    const csvEl = wrap.querySelector('#fx-csv');

    wrap.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-fa]');
      if (!t) return;
      const a = t.getAttribute('data-fa');

      if (a === 'pick') fileEl.click();
      else if (a === 'pickCsv') csvEl.click();
      else if (a === 'addManual') {
        const amt = parseFloat(wrap.querySelector('#fx-amt').value);
        if (isNaN(amt) || amt === 0) { toast('Enter an amount.', 'warn'); return; }
        await Finance.add({
          date: wrap.querySelector('#fx-date').value || today(),
          time: wrap.querySelector('#fx-time').value || '',
          amount: Math.abs(amt),
          merchant: norm(wrap.querySelector('#fx-merch').value),
          category: wrap.querySelector('#fx-cat').value,
          note: norm(wrap.querySelector('#fx-note').value),
          source: 'manual'
        });
        toast('Expense added ✓');
        FinanceUI.repaint(section);
      }
      else if (a === 'del') { await Finance.remove(t.getAttribute('data-id')); toast('Deleted'); FinanceUI.repaint(section); }
      else if (a === 'viewRcpt') {
        const it = Finance.items.find(x => x.id === t.getAttribute('data-id'));
        if (!it) return;
        const img = await DB.get('flow:receipt:' + it.receiptId, null);
        if (!img) { toast('That receipt image is no longer stored.', 'warn'); return; }
        const w = window.open('', '_blank');
        if (w) w.document.write(`<title>Receipt · ${esc(it.merchant)}</title><body style="margin:0;background:#111"><img src="${img}" style="max-width:100%;display:block;margin:auto"></body>`);
      }
      else if (a === 'exportCsv') {
        const rows = [['date', 'time', 'merchant', 'category', 'amount', 'currency', 'note', 'source']]
          .concat(Finance.items.map(x => [x.date, x.time || '', x.merchant || '', x.category || '', Math.abs(x.amount), x.currency || '', (x.note || '').replace(/"/g, "'"), x.source || '']));
        download(`the-flow-expenses-${today()}.csv`,
          rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
      }
      else if (a === 'exportJson') download(`the-flow-expenses-${today()}.json`, JSON.stringify(Finance.items, null, 2), 'application/json');
      else if (a === 'saveParsed') {
        const p = FinanceUI.state.parsed || {};
        const amt = parseFloat(wrap.querySelector('#fr-amt').value);
        if (isNaN(amt) || amt === 0) { toast('Check the amount before saving.', 'warn'); return; }
        let receiptId = null;
        if (FinanceUI.state.photo) { receiptId = uid('r'); await DB.set('flow:receipt:' + receiptId, FinanceUI.state.photo); }
        const merchant = norm(wrap.querySelector('#fr-merch').value);
        const category = wrap.querySelector('#fr-cat').value;
        await Finance.add({
          date: wrap.querySelector('#fr-date').value || today(),
          time: wrap.querySelector('#fr-time').value || '',
          amount: Math.abs(amt), merchant, category,
          note: norm(wrap.querySelector('#fr-note').value), receiptId, source: 'ocr'
        });
        await Finance.learn(merchant, category);
        FinanceUI.state = { photo: null, parsed: null, staged: null };
        toast('Receipt saved ✓');
        FinanceUI.repaint(section);
      }
      else if (a === 'discard') { FinanceUI.state = { photo: null, parsed: null, staged: null }; wrap.querySelector('#fx-result').innerHTML = ''; }
      else if (a === 'rawText') {
        const box = wrap.querySelector('#fr-raw');
        if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
      }
      else if (a === 'confirmCsv') {
        const staged = FinanceUI.state.staged || [];
        const res = await Finance.importItems(staged);
        toast(`Imported ${res.added} expense${res.added === 1 ? '' : 's'}${res.dupes ? ` · ${res.dupes} duplicate${res.dupes === 1 ? '' : 's'} skipped` : ''} ✓`, null, 4200);
        FinanceUI.state.staged = null;
        FinanceUI.repaint(section);
      }
    });

    wrap.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-recat]');
      if (sel) {
        const it = Finance.items.find(x => x.id === sel.getAttribute('data-recat'));
        if (it) {
          it.category = sel.value;
          await Finance.save();
          await Finance.learn(it.merchant, sel.value);
          toast('Category updated — that merchant is remembered.');
        }
      }
    });

    if (fileEl && !fileEl.__bound) {
      fileEl.__bound = true;
      fileEl.addEventListener('change', async () => {
        const f = fileEl.files && fileEl.files[0];
        if (!f) return;
        await FinanceUI.handlePhoto(wrap, f);
        fileEl.value = '';
      });
    }
    if (csvEl && !csvEl.__bound) {
      csvEl.__bound = true;
      csvEl.addEventListener('change', () => {
        const f = csvEl.files && csvEl.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = () => { FinanceUI.handleCSV(wrap, String(fr.result)); csvEl.value = ''; };
        fr.readAsText(f, 'utf-8');
      });
    }

    // drag & drop onto either drop zone
    $$('.flow-drop', wrap).forEach(zone => {
      ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('over'); }));
      zone.addEventListener('drop', async (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        if (/image\//.test(f.type)) await FinanceUI.handlePhoto(wrap, f);
        else { const fr = new FileReader(); fr.onload = () => FinanceUI.handleCSV(wrap, String(fr.result)); fr.readAsText(f, 'utf-8'); }
      });
    });
  },

  async handlePhoto(wrap, file) {
    const prog = wrap.querySelector('#fx-prog');
    const bar = prog.querySelector('i');
    const out = wrap.querySelector('#fx-result');
    prog.style.display = 'block'; bar.style.width = '6%';
    out.innerHTML = '<p class="flow-empty">Compressing the photo…</p>';
    try {
      const dataUrl = await Finance.compress(file, 1500, 0.74);
      FinanceUI.state.photo = dataUrl;
      out.innerHTML = '<p class="flow-empty">Reading the text on your device… the first run downloads the language data, which takes a moment.</p>';
      bar.style.width = '18%';
      const text = await Finance.ocr(dataUrl, p => { bar.style.width = (18 + p * 78).toFixed(0) + '%'; });
      bar.style.width = '100%';
      const parsed = Finance.parseReceipt(text);
      FinanceUI.state.parsed = parsed;
      FinanceUI.showParsed(wrap, parsed, dataUrl);
    } catch (err) {
      out.innerHTML = `<p class="flow-empty">Could not read that image: ${esc(err.message)}<br>You can still add the expense by hand below — the photo is kept if you save one now.</p>`;
    } finally {
      setTimeout(() => { prog.style.display = 'none'; bar.style.width = '0%'; }, 700);
    }
  },

  showParsed(wrap, p, dataUrl) {
    const s = Settings.data;
    const cat = Finance.categorise(p.merchant, '');
    const conf = [];
    if (!isNaN(p.amount)) conf.push('total'); if (p.date) conf.push('date'); if (p.time) conf.push('time'); if (p.merchant) conf.push('merchant');
    wrap.querySelector('#fx-result').innerHTML = `
      <div class="flow-receipt">
        <img src="${dataUrl}" alt="Receipt photo">
        <div style="flex:1 1 320px;min-width:280px">
          <div class="flow-row between" style="margin-bottom:8px">
            <span class="flow-label">Read from the photo</span>
            <span class="flow-chip${conf.length >= 3 ? ' accent' : ''}">${conf.length}/4 fields found</span>
          </div>
          <div class="flow-grid c2" style="gap:10px">
            <div class="flow-field"><label class="flow-label">Date</label><input class="flow-in" type="date" id="fr-date" value="${esc(p.date || today())}"></div>
            <div class="flow-field"><label class="flow-label">Time</label><input class="flow-in" type="time" id="fr-time" value="${esc(p.time || '')}"></div>
            <div class="flow-field"><label class="flow-label">Total</label><input class="flow-in" type="number" step="0.01" id="fr-amt" value="${isNaN(p.amount) ? '' : p.amount.toFixed(2)}"></div>
            <div class="flow-field"><label class="flow-label">Category</label>
              <select class="flow-in" id="fr-cat">${s.categories.map(c => `<option${c === cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          </div>
          <div class="flow-field" style="margin-top:10px"><label class="flow-label">Merchant</label>
            <input class="flow-in" id="fr-merch" value="${esc(p.merchant || '')}"></div>
          <div class="flow-field" style="margin-top:10px"><label class="flow-label">Note</label>
            <input class="flow-in" id="fr-note" placeholder="${isNaN(p.vat) ? 'optional' : 'VAT ' + p.vat.toFixed(2)}"></div>
          <div class="flow-row" style="margin-top:12px">
            <button class="flow-btn primary" data-fa="saveParsed">Save expense + receipt</button>
            <button class="flow-btn" data-fa="rawText">View raw text</button>
            <button class="flow-btn ghost" data-fa="discard">Discard</button>
          </div>
          <pre class="flow-code" id="fr-raw" style="display:none;margin-top:10px;max-height:220px;overflow:auto;white-space:pre-wrap">${esc(p.raw || '')}</pre>
        </div>
      </div>`;
  },

  handleCSV(wrap, text) {
    const res = Finance.parseStatement(text, { prefer: Settings.get('statementDateFormat') === 'mdy' ? 'mdy' : 'dmy' });
    FinanceUI.state.staged = res.items;
    const box = wrap.querySelector('#fx-csvresult');
    if (!res.items.length) {
      box.innerHTML = `<p class="flow-empty">No spending rows recognised. Columns found: ${esc(res.header.join(' · ') || 'none')}.<br>
        Make sure the file has a header row with a date column and an amount (or debit) column.</p>`;
      return;
    }
    const total = res.items.reduce((a, x) => a + x.amount, 0);
    box.innerHTML = `
      <div class="flow-row between" style="margin-bottom:8px">
        <span class="flow-label">${res.items.length} rows ready · ${esc(money(total, Settings.get('currency')))}${res.skipped ? ' · ' + res.skipped + ' rows skipped' : ''}</span>
        <button class="flow-btn primary sm" data-fa="confirmCsv">Import ${res.items.length}</button>
      </div>
      <div class="flow-scroll"><table class="flow-table">
        <thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead>
        <tbody>${res.items.slice(0, 12).map(x => `<tr><td>${esc(prettyDate(x.date))}</td><td>${esc(x.merchant.slice(0, 44))}</td><td>${esc(x.category)}</td><td class="num">${esc(money(x.amount, x.currency))}</td></tr>`).join('')}</tbody>
      </table></div>
      ${res.items.length > 12 ? `<p class="flow-empty">…and ${res.items.length - 12} more.</p>` : ''}`;
  }
};

/* =========================================================================
 * 16b · Colour themes
 *
 * One <html data-flow-theme="x"> attribute reskins the whole app (the CSS
 * does the rest). Switching is instant — no reload — and the choice follows
 * the account when signed in, or stays on the device for a guest. The value
 * lives under a non-ld_ key so the privacy purge never wipes it.
 * ====================================================================== */
const Theme = {
  KEY: 'flow:theme',
  LS: 'flowTheme',
  /* `dot` is a full CSS background value, not just a colour, so a theme can
     show the two shades it actually trades in rather than one flat circle.
     `tc` is what goes into the theme-color meta, which is the strip iOS paints
     behind the status bar — get it wrong and the app has a mismatched band
     across the top of every screen. */
  LIST: [
    { id: 'signature', name: 'Signature', sub: 'the original',
      dot: 'linear-gradient(135deg,#00e88a,#0093e7)', tc: '#0a0b0d' },
    { id: 'bloom',     name: 'Bloom',     sub: 'soft light',
      dot: 'linear-gradient(135deg,#f5dfe4,#b0648a)', tc: '#fdf8f7' },
    { id: 'aurora',    name: 'Aurora',    sub: 'violet night',
      dot: 'linear-gradient(135deg,#c084fc,#5eead4)', tc: '#12101e' },
    { id: 'paper',     name: 'Paper',     sub: 'warm light',
      dot: 'linear-gradient(135deg,#f8f5ef,#2f6f5e)', tc: '#f8f5ef' },
    { id: 'calm',      name: 'Calm',      sub: 'quiet blue',
      dot: 'linear-gradient(135deg,#7fa8dd,#2a2f36)', tc: '#0c0e11' },
    { id: 'bold',      name: 'Bold',      sub: 'loud and square',
      dot: 'linear-gradient(135deg,#ffe600,#ff3b30)', tc: '#000000' },
    { id: 'operator',  name: 'Operator',  sub: 'monospaced',
      dot: 'linear-gradient(135deg,#00e08a,#06090a)', tc: '#06090a' }
  ],
  DEFAULT: 'signature',

  /* The seven themes this replaced were tints: they set an accent and a body
     gradient and left every surface where it was, so choosing one looked like
     nothing had happened. Anyone still carrying one of those ids gets moved to
     the nearest of the new ones rather than to a blank screen. */
  RETIRED: { '': 'signature', slate: 'calm', rose: 'bloom', cyber: 'aurora',
             executive: 'paper', athlete: 'bold', whoop: 'operator' },
  /* Anything unknown — a retired id, a typo, a value from a newer build —
     resolves to the default rather than to undefined. */
  resolve(id) {
    id = String(id == null ? '' : id);
    if (Theme.LIST.some(t => t.id === id)) return id;
    return Theme.RETIRED[id] || Theme.DEFAULT;
  },
  meta(id) { return Theme.LIST.find(t => t.id === Theme.resolve(id)) || Theme.LIST[0]; },
  current() { return Theme.resolve(document.documentElement.getAttribute('data-flow-theme')); },

  /* Paint it now. `save !== false` also persists it. */
  apply(id, save) {
    /* Every theme now carries a full token set, the default included, so the
       attribute is always present. Removing it used to mean "the original",
       which only worked while the original was the bare stylesheet. */
    id = Theme.resolve(id);
    const root = document.documentElement;
    root.setAttribute('data-flow-theme', id);
    const tc = Theme.meta(id).tc;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', tc);
    /* The pre-paint script writes this inline so the very first frame is the
       right colour. An inline style outranks the stylesheet, so switching
       theme has to move it too — otherwise the area behind the status bar
       keeps the colour of whichever theme the app opened in. */
    try { root.style.background = tc; } catch (e) {}
    try { localStorage.setItem(Theme.LS, id); } catch (e) {}     /* survives the ld_* purge */
    if (save !== false) { try { DB.set(Theme.KEY, id); } catch (e) {} }
  },

  /* Reconcile at boot: the account's choice wins if signed in, else whatever
     this device last used (already applied pre-paint by the inline script). */
  async init() {
    let id = null;
    try { if (window.__DB_ON) id = await DB.get(Theme.KEY, null); } catch (e) {}
    if (id == null) { try { id = localStorage.getItem(Theme.LS); } catch (e) {} }
    /* A retired id needs writing back, not just translating on the way out,
       or every future open pays for the migration again. */
    const want = Theme.resolve(id);
    Theme.apply(want, false);
    if (id != null && String(id) !== want) { try { Theme.apply(want, true); } catch (e) {} }
  }
};

/* =========================================================================
 * 16b · Language
 *
 * The translation engine lives in flow-i18n.js and boots before this file, so
 * that the sign-in screen — which renders before anybody is authenticated and
 * therefore before this file knows who they are — is already in the right
 * language. It decides from localStorage, or failing that from the device.
 *
 * This is the half that only makes sense once somebody is signed in: the
 * choice belongs to the account, not to the browser. Pick Turkish on the
 * phone and the laptop should open in Turkish too.
 *
 * The two halves disagree exactly once, on a device the person has not used
 * before: it opens in whatever the device says, then the account's answer
 * arrives a moment later and wins. That is the right way round — a wrong
 * guess for half a second beats an English flash on every single open.
 * ====================================================================== */
const Lang = {
  KEY: 'flow:lang',

  get engine() { return typeof window !== 'undefined' ? window.FlowI18n : null; },
  get current() { const e = Lang.engine; return e ? e.lang : 'en'; },
  list() { const e = Lang.engine; return e ? e.languages() : [{ code: 'en', name: 'English', native: 'English' }]; },

  /* Apply now; `save !== false` also writes it to the account. */
  async set(code, save) {
    const e = Lang.engine;
    if (!e) return;
    await e.set(code);
    if (save !== false) { try { await DB.set(Lang.KEY, code); } catch (err) {} }
  },

  /* Reconcile at boot. An account that has never chosen keeps whatever the
     device decided, and that decision is written back so the next device
     inherits it rather than guessing again. */
  async init() {
    const e = Lang.engine;
    if (!e) return;
    let want = null;
    try { if (window.__DB_ON) want = await DB.get(Lang.KEY, null); } catch (err) {}
    if (want == null) {
      try { if (window.__DB_ON) await DB.set(Lang.KEY, e.lang); } catch (err) {}
      return;
    }
    if (want !== e.lang) await e.set(want);
  }
};

/* =========================================================================
 * 17 · Settings tab
 * ====================================================================== */
const SettingsUI = {
  render(section) {
    const s = Settings.data;

    section.innerHTML = `
      <div style="margin:6px 0 2px">
        <div class="flow-label">Preferences · integrations · data</div>
        <div class="flow-hero" style="font-size:38px">Settings</div>
      </div>

      <div class="flow-card" id="lookCard">
        <h3>🎨 Appearance</h3>
        <p class="flow-sub">Pick a colour theme. It applies the instant you tap it — no reload — and is saved to your account (or kept on this device while you're just looking around).</p>
        <div class="theme-grid">
          ${Theme.LIST.map(t => `<button type="button" class="theme-swatch${Theme.current() === t.id ? ' on' : ''}" data-theme="${t.id}">
            <span class="sw-dot" style="--d:${t.dot}"></span>
            <span class="sw-tx"><span class="sw-nm" data-i18n="off">${t.name}</span><span class="sw-sub">${t.sub}</span></span>
          </button>`).join('')}
        </div>
        <div class="flow-switch" style="margin-top:14px"><div class="t"><b>Time chips on task rows</b><span>The 🕘 chip that gives a task a date, time, duration and alert. Turn off to hide them everywhere without losing anything you already scheduled.</span></div>
          <input type="checkbox" data-s="showTimeChips" data-type="bool" ${s.showTimeChips ? 'checked' : ''}></div>
        <div class="flow-switch"><div class="t"><b>Sharper breakdown charts</b><span>Cards headed “Visual breakdown” are redrawn as a crisp ring or bars. The original widget is hidden, never deleted.</span></div>
          <input type="checkbox" data-s="upgradeVisuals" data-type="bool" ${s.upgradeVisuals !== false ? 'checked' : ''}></div>
        <div class="flow-row" style="margin-top:6px">
          <span class="flow-label">Chart shape</span>
          <span class="flow-seg">
            <button class="${s.breakdownForm !== 'bars' ? 'on' : ''}" data-act2="formDonut">Ring</button>
            <button class="${s.breakdownForm === 'bars' ? 'on' : ''}" data-act2="formBars">Bars</button>
          </span>
        </div>
        <div id="voice-card" style="margin-top:14px">
          <div class="flow-label">Voice</div>
          <p class="flow-sub">A microphone appears in the corner of whatever you are writing in. Tap it, talk, tap it again — the words land where your cursor was. It listens in the language the app is set to.</p>
          <div class="vc-state" id="vc-state"><span class="vc-dot"></span><span class="vc-txt">Checking…</span></div>
          <p class="flow-sub" id="vc-note" style="margin-top:8px"></p>
          <div class="flow-row" style="margin-top:10px">
            <button type="button" class="flow-btn sm" data-voice-act="ask" hidden>Allow the microphone</button>
          </div>
        </div>
      </div>

      <div class="flow-card">
        <h3>🌐 Language</h3>
        <p class="flow-sub">The whole app, in the language you pick. It changes the moment you tap it and is saved to your account, so your other devices follow. Anything you have written stays exactly as you wrote it.</p>
        <div class="theme-grid">
          ${Lang.list().map(l => `<button type="button" class="theme-swatch${Lang.current === l.code ? ' on' : ''}" data-lang="${esc(l.code)}">
            <span class="sw-dot" style="--d:var(--f-accent)">${esc(l.code.toUpperCase())}</span>
            <span class="sw-tx"><span class="sw-nm" data-i18n="off">${esc(l.native)}</span><span class="sw-sub" data-i18n="off">${esc(l.name)}</span></span>
          </button>`).join('')}
        </div>
      </div>

      <div class="flow-card" id="todayCard">
        <h3>📅 Today</h3>
        <p class="flow-sub">The words beside the date on your Today screen. Make them yours — something you are working towards, a line from someone you trust, or your own. Leave it blank for no line at all. It is saved to your account and never translated.</p>
        <div class="flow-field"><label class="flow-label">The line</label>
          <input class="flow-in" data-s="todayQuote" maxlength="200" placeholder="Leave blank for no line" value="${esc(s.todayQuote)}"></div>
        <div class="flow-field" style="margin-top:8px"><label class="flow-label">Who said it <span style="opacity:.6">(optional)</span></label>
          <input class="flow-in" data-s="todayQuoteBy" maxlength="80" placeholder="Nobody, or you" value="${esc(s.todayQuoteBy)}"></div>
        <div class="flow-row" style="margin-top:10px">
          <button type="button" class="flow-btn sm ghost" id="quote-default">Put the original back</button>
        </div>
        <div class="flow-label" style="margin-top:18px">Widgets</div>
        <div class="flow-switch"><div class="t"><b>Prices on Today</b><span>A small strip of exchange rates, gold and Bitcoin under the morning pulse. Off unless you want it.</span></div>
          <input type="checkbox" data-s="todayMarkets" data-type="bool" ${s.todayMarkets ? 'checked' : ''}></div>
        <div class="sec-grid" id="mktPick"${s.todayMarkets ? '' : ' hidden'}>
          ${Object.keys(Markets.LABEL).map(sym => `<label class="sec-it"><input type="checkbox" data-mkt="${sym}"${(Markets.watch || Markets.DEFAULT).indexOf(sym) >= 0 ? ' checked' : ''}> <span data-i18n="off">${esc(Markets.LABEL[sym][0])} · ${esc(Markets.LABEL[sym][1])}</span></label>`).join('')}
        </div>
      </div>

      <div class="flow-card">
        <h3>🧭 Preferences</h3>
        <div class="flow-grid c2" style="gap:10px">
          <div class="flow-field"><label class="flow-label">Display name</label><input class="flow-in" data-s="displayName" value="${esc(s.displayName)}"></div>
          <div class="flow-field"><label class="flow-label">Currency</label><input class="flow-in" data-s="currency" value="${esc(s.currency)}"></div>
          <div class="flow-field"><label class="flow-label">Time zone</label><input class="flow-in" data-s="timezone" value="${esc(s.timezone)}"></div>
          <div class="flow-field"><label class="flow-label">Week starts</label>
            <select class="flow-in" data-s="weekStart" data-type="num">
              <option value="1"${s.weekStart == 1 ? ' selected' : ''}>Monday</option>
              <option value="0"${s.weekStart == 0 ? ' selected' : ''}>Sunday</option>
            </select></div>
          <div class="flow-field"><label class="flow-label">Default duration (min)</label><input class="flow-in" type="number" min="5" step="5" data-s="defaultDurationMin" data-type="num" value="${esc(s.defaultDurationMin)}"></div>
          <div class="flow-field"><label class="flow-label">Monthly budget</label><input class="flow-in" type="number" step="100" data-s="budgetMonthly" data-type="num" value="${esc(s.budgetMonthly)}"></div>
        </div>
      </div>

      <div class="flow-card" id="connCard">
        <h3>🔗 Connections</h3>
        <p class="flow-sub">Other apps you use, connected to this account. Each one asks for the least it needs, and you can disconnect it here at any time.</p>
        <div id="connList" class="conn-list"><div class="flow-sub">Loading…</div></div>
      </div>

      <div class="flow-card" id="mcp-card">
        <h3>🤖 Connect to Claude</h3>
        <p class="flow-sub">Give Claude an access token and it can read your week, add Big Rocks, tick habits and reword your own lists — working on this account and no other. It can add and change things; removing anything stays something you do here.</p>
        <div class="flow-field"><label class="flow-label">Server URL</label>
          <div class="mcp-url"><code id="mcpUrl">${esc(location.origin)}/mcp</code><button type="button" class="flow-btn sm" data-mcp="copyurl">Copy</button></div>
        </div>
        <div class="mcp-new" id="mcpNew" hidden>
          <div class="flow-label">Your new token — copy it now, it is not shown again</div>
          <div class="mcp-url"><code id="mcpSecret"></code><button type="button" class="flow-btn sm primary" data-mcp="copytok">Copy</button></div>
        </div>
        <div id="mcpConns" class="mcp-list"></div>
        <div id="mcpList" class="mcp-list"><div class="flow-sub">Loading…</div></div>
        <div class="mcp-acts">
          <input class="flow-in" id="mcpName" placeholder="What is this for? e.g. Claude on my laptop" maxlength="60">
          <button type="button" class="flow-btn primary" data-mcp="new">Create access token</button>
        </div>
        <ol class="flow-ol">
          <li>In Claude or ChatGPT, add a custom connector and give it the server URL above.</li>
          <li>It will send you here to sign in and say yes. That is all — no token to copy.</li>
          <li>Ask it "what's on my week?" to check it worked.</li>
        </ol>
        <p class="flow-sub">An access token below is the manual way in, for a client that cannot do the above, or for your own scripts.</p>
        <p class="flow-sub">A token is as good as your password for reading and adding — treat it like one. If you no longer recognise a token in the list, revoke it; anything using it stops working immediately and nothing you have saved is touched.</p>
      </div>

      <div class="flow-card" id="pushCard">
        <h3>📣 Notifications</h3>
        <p class="flow-sub">Reminders that arrive whether or not the app is open — on iPhone, Mac, Android, and in Chrome, Edge or Firefox on a computer.</p>
        <div class="flow-switch"><div class="t"><b>Allow notifications</b><span id="pushState">Checking…</span></div>
          <button class="flow-btn" id="pushBtn" disabled>…</button></div>
        <div class="flow-switch"><div class="t"><b>Remind me about Big Rocks</b><span>At the time on the rock, on the day it is planned for.</span></div>
          <input type="checkbox" data-s="pushRemindRocks" data-type="bool" ${s.pushRemindRocks !== false ? 'checked' : ''}></div>
        <div style="margin-top:10px"><button class="flow-btn" id="pushTestBtn" disabled>Send me a test notification</button>
          <span class="flow-sub" id="pushTestOut" style="margin-left:10px"></span></div>
      </div>

      <div class="flow-card">
        <h3>🏦 Bank &amp; statements</h3>
        <div class="flow-field" style="max-width:340px"><label class="flow-label">Aggregator</label>
          <select class="flow-in" data-s="bankProvider">
            <option value="none"${s.bankProvider === 'none' ? ' selected' : ''}>None — statement import only (recommended)</option>
            <option value="plaid"${s.bankProvider === 'plaid' ? ' selected' : ''}>Plaid (US · CA · UK · EU)</option>
            <option value="gocardless"${s.bankProvider === 'gocardless' ? ' selected' : ''}>GoCardless Bank Account Data (EU · UK, free tier)</option>
            <option value="saltedge"${s.bankProvider === 'saltedge' ? ' selected' : ''}>Salt Edge (widest, includes Turkey)</option>
          </select></div>
        <div class="flow-field" style="margin-top:10px;max-width:340px"><label class="flow-label">Statement date format</label>
          <select class="flow-in" data-s="statementDateFormat">
            <option value="auto"${s.statementDateFormat === 'auto' ? ' selected' : ''}>Auto / day-first (TR, EU)</option>
            <option value="mdy"${s.statementDateFormat === 'mdy' ? ' selected' : ''}>Month-first (US)</option>
          </select></div>
        <p class="flow-sub" style="margin-top:12px">Choosing an aggregator here only records the intent — the actual pull runs server-side and needs API keys as environment variables (<code>PLAID_CLIENT_ID</code>/<code>PLAID_SECRET</code>, <code>GOCARDLESS_SECRET_ID</code>/<code>GOCARDLESS_SECRET_KEY</code>, or <code>SALTEDGE_APP_ID</code>/<code>SALTEDGE_SECRET</code>). Until those exist, CSV import is the working path and it costs nothing.</p>
      </div>

      <div class="flow-card">
        <h3>🏷 Categories</h3>
        <p class="flow-sub">One per line. Changing a category on any expense also teaches the matcher that merchant, so imports get sharper over time.</p>
        <textarea data-s="categories" data-type="lines" style="min-height:150px">${esc(s.categories.join('\n'))}</textarea>
        <p class="flow-sub" style="margin-top:8px">Learned merchants: ${Object.keys(s.merchantMemory || {}).length || 'none yet'}
          ${Object.keys(s.merchantMemory || {}).length ? '<button class="flow-btn ghost sm" data-act2="forget" style="margin-left:8px">Forget all</button>' : ''}</p>
      </div>

      ${Auth.installed ? `
      <div class="flow-card">
        <h3>👤 Account</h3>
        <p class="flow-sub">Signed in as <b>${esc(Auth.user ? (Auth.user.name || Auth.user.email) : '')}</b>${Auth.user && Auth.user.email ? ' · ' + esc(Auth.user.email) : ''}${Auth.user && Auth.user.owner ? ' · owner of this server' : ''}. Your data is private to this account — nobody else signed in here can see it.</p>
        <div class="flow-row">
          <button class="flow-btn" data-act2="changepw">Change password</button>
          <button class="flow-btn" data-act2="reccodes">Recovery codes</button>
          <span class="flow-spacer"></span>
          <button class="flow-btn danger" data-act2="signout">Sign out</button>
        </div>
        <!-- Filled in after render. The moment somebody needs these codes is
             the moment they can no longer sign in to come and make them, so
             this line has to be visible before anything goes wrong. -->
        <p class="flow-sub" id="set-rcstat" style="margin-top:8px">Checking your recovery codes…</p>
        <!-- An account you can open but not close is a hostage. This removes
             everything rather than hiding it, which is why it asks twice. -->
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--f-line)">
          <div class="flow-label">Delete this account</div>
          <p class="flow-sub" style="margin:6px 0 10px">Everything goes: your journal, tasks, money, training, the lot — along with every session, access token and assistant connection. It cannot be undone and there is no copy.</p>
          <button class="flow-btn danger" data-act2="delacct">Delete my account and everything in it</button>
        </div>
      </div>` : ''}

      <div class="flow-card">
        <h3>🧩 Make it yours</h3>
        <p class="flow-sub">The dashboard ships as a template. Everything below is yours alone — changing it never touches anyone else's Flow.${Profile.isNew ? ' You are starting from the neutral template.' : ''}</p>

        <div class="flow-grid c2">
          ${(Profile.data && Profile.data.workspaces || []).map((w, i) => `
          <div class="flow-field">
            <label class="flow-label">Work board ${i + 1}</label>
            <div class="flow-row">
              <input class="flow-in" style="flex:0 0 56px;text-align:center" data-ws="${i}" data-wsf="icon" value="${esc(w.icon)}">
              <input class="flow-in grow" data-ws="${i}" data-wsf="name" value="${esc(w.name)}">
            </div>
            <input class="flow-in" data-ws="${i}" data-wsf="sub" placeholder="One line describing it" value="${esc(w.sub || '')}">
          </div>`).join('')}
        </div>

        <div class="flow-field" style="margin-top:14px">
          <label class="flow-label">Daily checklist — one per line</label>
          <textarea data-prof="dietCommon" rows="7">${esc(Profile.rowsToLines(Profile.data && Profile.data.dietCommon))}</textarea>
        </div>
        <div class="flow-field" style="margin-top:10px">
          <label class="flow-label">Extra items on training days — one per line</label>
          <textarea data-prof="dietGym" rows="3">${esc(Profile.rowsToLines(Profile.data && Profile.data.dietGym))}</textarea>
        </div>
        <div class="flow-field" style="margin-top:10px">
          <label class="flow-label">Weekly commitments (Sharpen the Blade) — one per line</label>
          <textarea data-prof="saw" rows="8">${esc(Profile.rowsToLines(Profile.data && Profile.data.saw))}</textarea>
        </div>
        <div class="flow-field" style="margin-top:10px">
          <label class="flow-label">Training week — one line per day, as <code>Day | Title | Time</code></label>
          <textarea data-prof="plan" rows="7">${esc((Profile.data && Profile.data.plan || []).map(d => [d.key, d.title, d.time || ''].join(' | ')).join('\n'))}</textarea>
        </div>

        <div class="flow-row" style="margin-top:14px">
          <button class="flow-btn primary" data-act2="profsave">Save my setup</button>
          <span class="flow-spacer"></span>
          <button class="flow-btn danger" data-act2="profreset">Reset to the blank template</button>
        </div>
      </div>`;

    /* --- persist any field with a data-s attribute --- */
    /* Restoring the original is a real need: somebody clears the line to try
       their own, decides they preferred Henley, and has no way back to words
       they never wrote down. */
    const qd = section.querySelector('#quote-default');
    if (qd) qd.addEventListener('click', async () => {
      await Settings.set('todayQuote', DEFAULT_QUOTE);
      await Settings.set('todayQuoteBy', DEFAULT_QUOTE_BY);
      const a1 = section.querySelector('[data-s="todayQuote"]');
      const a2 = section.querySelector('[data-s="todayQuoteBy"]');
      if (a1) a1.value = DEFAULT_QUOTE;
      if (a2) a2.value = DEFAULT_QUOTE_BY;
      Settings.reflect();
      toast('The original line is back.');
    });

    section.querySelectorAll('[data-s]').forEach(el => {
      const key = el.getAttribute('data-s'), type = el.getAttribute('data-type');
      const commit = async () => {
        let v;
        if (type === 'bool') v = el.checked;
        else if (type === 'num') v = Number(el.value) || 0;
        else if (type === 'lines') v = el.value.split('\n').map(x => norm(x)).filter(Boolean);
        else v = el.value;
        await Settings.set(key, v);
        if (key === 'upgradeVisuals') { if (v) Visuals.upgradeAll(); else Visuals.restoreAll(); }
        if (key === 'pushRemindRocks') Notify.syncMac();
        if (key === 'todayMarkets') {
          const pick = section.querySelector('#mktPick');
          if (pick) pick.hidden = !v;
          Markets.refresh().catch(() => {});
          try { Markets.widgetRow(); } catch (e) {}
        }
        if (key === 'showTimeChips') {
          if (v) {
            TimeChips.scan(document);
          } else {
            $$('.flow-time-chip').forEach(c => c.remove());
            $$('[data-flow-timed]').forEach(r => r.removeAttribute('data-flow-timed'));
          }
        }
        Settings.reflect();
        toast('Saved ✓', null, 1200);
      };
      el.addEventListener('change', commit);
    });

    /* Which prices the Today widget shows, when it is on at all. */
    const mktPick = section.querySelector('#mktPick');
    if (mktPick) mktPick.addEventListener('change', async () => {
      const list = Array.from(mktPick.querySelectorAll('[data-mkt]:checked')).map(c => c.getAttribute('data-mkt'));
      await Markets.setWatch(list);
      toast('Saved ✓', null, 1200);
    });

    /* ---- Connect to Claude ---- */
    SettingsUI.mcpWire(section);

    /* ---- Connections (Google, and whatever follows it) ---- */
    try { Connect.wire(section); } catch (e) { console.warn('[Flow] connections', e); }

    /* ---- recovery codes ---- */
    SettingsUI.recoveryStatus(section);

    /* Language — same shape as the theme swatches. The engine repaints the
       page itself, so nothing here needs to re-render the tab; marking the
       chosen row is all that is left to do. */
    section.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', async () => {
        section.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('on', b === btn));
        try { await Lang.set(btn.getAttribute('data-lang')); }
        catch (e) { toast('That language could not be loaded — staying in English.', 'err'); }
      });
    });

    /* Voice — what the card can honestly say depends on where it is running.
       In the iOS shell the system knows whether the microphone and speech
       recognition have been granted and we can ask for them. In a browser
       there is nothing to report until the person presses the mic, because
       that is the moment the browser itself asks. */
    SettingsUI.voiceWire(section);

    /* Colour-theme swatches — apply instantly, persist, and re-mark the row. */
    section.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        Theme.apply(btn.getAttribute('data-theme'));
        section.querySelectorAll('[data-theme]').forEach(b =>
          b.classList.toggle('on', b === btn));
      });
    });

    /* Push on iPhone, local reminders on the Mac — see Notify. */
    Notify.wire(section);
    try { Sections.wire(section); } catch (e) { console.warn('[Flow] sections', e); }
    try { Trial.wire(section); } catch (e) { console.warn('[Flow] trial', e); }
    try { InboxLink.wire(section); } catch (e) { console.warn('[Flow] inbox link', e); }
    try { DataCard.wire(section); } catch (e) { console.warn('[Flow] data card', e); }
    try { SetView.apply(section); } catch (e) { console.warn('[Flow] settings view', e); }

    section.querySelectorAll('[data-act2]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const a = btn.getAttribute('data-act2');
      if (a === 'profsave') {
        const sec = btn.closest('.flow-section') || document;
        const P = Profile.data;
        sec.querySelectorAll('[data-ws]').forEach(f => {
          const w = P.workspaces[Number(f.getAttribute('data-ws'))];
          if (w) w[f.getAttribute('data-wsf')] = f.value.trim();
        });
        const t = (k) => { const el = sec.querySelector('[data-prof="' + k + '"]'); return el ? el.value : null; };
        const dc = t('dietCommon'); if (dc != null) P.dietCommon = Profile.linesToRows(dc, 'd');
        const dg = t('dietGym');    if (dg != null) P.dietGym = Profile.linesToRows(dg, 'g');
        const sw = t('saw');        if (sw != null) P.saw = Profile.linesToRows(sw, 's');
        const pl = t('plan');
        if (pl != null) {
          P.plan = String(pl).split('\n').map(s => s.trim()).filter(Boolean).map(line => {
            const bits = line.split('|').map(x => x.trim());
            const key = (bits[0] || '').toLowerCase().slice(0, 3);
            const title = bits[1] || '';
            const time = bits[2] || '';
            return { key, title, tag: title.split(/[\s—-]/)[0] || 'Train', time, type: /rest/i.test(title) ? 'rest' : 'hyper' };
          }).filter(d => d.key);
        }
        Profile.isNew = false;
        await Profile.save();
        Profile.apply();
        await Profile.rerenderHost();
        toast('Saved — this is your setup now ✓');
        SettingsUI.render(btn.closest('.flow-section'));
        return;
      }
      if (a === 'profreset') {
        if (!confirm('Reset your training, diet, weekly commitments and board names to the blank template? Your journal, tasks and finances are not touched.')) return;
        Profile.data = JSON.parse(JSON.stringify(NEUTRAL));
        Profile.isNew = true;
        await Profile.save();
        Profile.apply();
        await Profile.rerenderHost();
        toast('Reset to the template ✓');
        SettingsUI.render(btn.closest('.flow-section'));
        return;
      }
      if (a === 'signout') {
        if (!confirm('Sign out of The Flow on this device?')) return;
        await Auth.signOut();
        return;
      }
      if (a === 'delacct') {
        /* Two questions, and the second one cannot be answered by tapping.
           The server asks for both again — this is the reminder, not the
           gate. */
        const pw = prompt('This deletes your account and everything in it, permanently.\n\nType your password to continue:');
        if (pw == null || !pw) return;
        const who = (Auth.user && Auth.user.email) || '';
        const conf = prompt('Last check. There is no undo and no backup.\n\nType your email address (' + who + ') to delete the account:');
        if (conf == null) return;
        try {
          const r = await fetch('/api/auth/account', {
            method: 'DELETE', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw, confirm: conf })
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { toast(j.error || 'That did not work.', 'err', 5000); return; }
          /* The server has already cleared the cookies; clear the device
             cache too, or the next person to open this browser sees a
             dashboard belonging to an account that no longer exists. */
          try {
            Object.keys(localStorage)
              .filter(k => k.indexOf('ld_') === 0 || k.indexOf('flowpack:') === 0 || k.indexOf('flowguest:') === 0)
              .forEach(k => localStorage.removeItem(k));
          } catch (e) {}
          location.replace('/');
        } catch (e) { toast('Could not reach the server.', 'err', 5000); }
        return;
      }
      if (a === 'reccodes') {
        if (!confirm('Make ten new recovery codes?\n\nAny codes you were given before stop working straight away. The new ones are shown once.')) return;
        try {
          const j = await Auth.post('/api/auth/recovery', {});
          Auth.showCodes(j.codes, { firstTime: false });
        } catch (e) { toast(e.message, 'err', 5000); }
        return;
      }
      if (a === 'changepw') {
        const current = prompt('Your current password:');
        if (current == null) return;
        const next = prompt('New password (at least 10 characters):');
        if (next == null) return;
        try { await Auth.post('/api/auth/password', { current, next }); toast('Password changed ✓'); }
        catch (e) { toast(e.message, 'err', 5000); }
        return;
      }
        if (a === 'formDonut' || a === 'formBars') {
          await Settings.set('breakdownForm', a === 'formBars' ? 'bars' : 'donut');
          Settings.reflect();
          $$('[data-flow-viz] .flow-viz').forEach(m => { if (m.__repaint) m.__repaint(); });
          SettingsUI.render(section);
        }
        else if (a === 'forget') { await Settings.set('merchantMemory', {}); toast('Merchant memory cleared'); SettingsUI.render(section); }
      });
    });
  },

  /* The token panel. The secret exists in this page for exactly as long as the
     person needs to copy it, and is never fetched again — the list endpoint
     cannot return it, because the server does not have it either. */
  /* ---- the home-screen widget ----
     Inside the iOS shell the widget is a separate process: it cannot see this
     page, its cookies or its storage, so the only way it ever learns a token is
     if we hand it one at the moment one is made. In a browser there is no
     bridge and this does nothing at all, quietly — a Settings panel should not
     grow a broken button just because the same page also runs in an app. */
  nativeToken(token) {
    try {
      const cap = window.Capacitor;
      const bridge = cap && cap.Plugins && cap.Plugins.FlowBridge;
      if (!bridge || !token) return;
      Promise.resolve(bridge.setToken({ token }))
        .then(() => toast('Home-screen widget connected'))
        .catch(() => {});
    } catch (e) { /* a browser, which is the normal case */ }
  },

  async mcpFetch(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}));
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((j && j.error) || ('Request failed (' + r.status + ')'));
    return j || {};
  },

  mcpRow(t) {
    const when = (ms) => {
      if (!ms) return 'never used';
      const d = new Date(ms), days = Math.floor((Date.now() - ms) / 864e5);
      if (days === 0) return 'used today';
      if (days === 1) return 'used yesterday';
      if (days < 30) return 'used ' + days + ' days ago';
      return 'last used ' + d.toLocaleDateString();
    };
    return '<div class="mcp-row" data-tokid="' + esc(t.id) + '">' +
      '<div class="mcp-meta"><b>' + esc(t.name) + '</b>' +
      '<span>' + esc(t.hint || '') + ' · ' + esc(when(t.lastUsed)) + '</span></div>' +
      '<button type="button" class="flow-btn sm danger" data-mcp="revoke" data-id="' + esc(t.id) + '">Revoke</button></div>';
  },

  /* Two ways in, shown as two lists, because they are revoked differently and
     a person should be able to see at a glance which is which: an app that
     asked and was granted, or a token somebody copied. */
  async mcpConns(section) {
    const box = section.querySelector('#mcpConns');
    if (!box) return;
    try {
      const r = await SettingsUI.mcpFetch('/api/flow/connections');
      const list = r.connections || [];
      box.innerHTML = list.length
        ? '<div class="flow-label" style="margin-bottom:2px">Connected apps</div>' + list.map(c =>
            '<div class="mcp-row"><div class="mcp-meta"><b>' + esc(c.name) + '</b>' +
            '<span>connected through sign-in</span></div>' +
            '<button type="button" class="flow-btn sm danger" data-mcp="disconnect" data-cid="' + esc(c.client_id) + '">Disconnect</button></div>').join('')
        : '';
      box.querySelectorAll('[data-mcp="disconnect"]').forEach(b => {
        b.addEventListener('click', async () => {
          const nm = (b.closest('.mcp-row').querySelector('b') || {}).textContent || 'that app';
          if (!confirm('Disconnect ' + nm + '? It stops reaching your Flow straight away. Nothing you have saved is affected.')) return;
          b.disabled = true;
          try {
            await SettingsUI.mcpFetch('/api/flow/connections/revoke', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: b.getAttribute('data-cid') })
            });
            toast('Disconnected ✓');
            SettingsUI.mcpConns(section);
          } catch (e) { b.disabled = false; toast(e.message, 'err'); }
        });
      });
    } catch (e) { box.innerHTML = ''; }
  },

  async mcpPaint(section) {
    const box = section.querySelector('#mcpList');
    if (!box) return;
    try {
      const r = await SettingsUI.mcpFetch('/api/flow/tokens');
      const list = r.tokens || [];
      box.innerHTML = list.length
        ? '<div class="flow-label" style="margin-bottom:2px">Access tokens</div>' + list.map(SettingsUI.mcpRow).join('')
        : '<div class="flow-sub">No access tokens. Nothing needs one unless a client cannot sign in for itself.</div>';
      box.querySelectorAll('[data-mcp="revoke"]').forEach(b => {
        b.addEventListener('click', async () => {
          const row = b.closest('.mcp-row');
          const name = row ? (row.querySelector('b') || {}).textContent : 'that token';
          /* Revoking is instant and cannot be undone, so it is worth one
             sentence of friction — but it destroys no data, which is why one
             sentence is all it is worth. */
          if (!confirm('Revoke "' + name + '"? Anything using it stops working straight away. Nothing you have saved is affected.')) return;
          b.disabled = true;
          try {
            await SettingsUI.mcpFetch('/api/flow/tokens/revoke', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: b.getAttribute('data-id') })
            });
            toast('Revoked ✓');
            SettingsUI.mcpPaint(section);
          } catch (e) { b.disabled = false; toast(e.message, 'err'); }
        });
      });
    } catch (e) {
      box.innerHTML = '<div class="flow-sub">Could not read your access tokens just now.</div>';
    }
  },

  /* Says how many codes are left, and admits it when there are none — an
     account made before recovery existed has none, and that is exactly the
     account that will be locked out one day. */
  async recoveryStatus(section) {
    const line = (section || document).querySelector('#set-rcstat');
    if (!line) return;
    try {
      const r = await fetch('/api/auth/recovery/status', { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) { line.textContent = ''; return; }
      if (!j.left) {
        line.innerHTML = '<b>You have no recovery codes.</b> Without them, a forgotten password means a lost account. Make a set now and keep them somewhere off this machine.';
      } else {
        const when = j.minted ? new Date(j.minted).toLocaleDateString() : null;
        line.textContent = j.left + ' recovery code' + (j.left === 1 ? '' : 's') + ' left'
          + (when ? ', made ' + when : '') + '. Making new ones cancels the old.';
      }
    } catch (e) { line.textContent = ''; }
  },

  async voiceWire(section) {
    const card = section.querySelector('#voice-card');
    if (!card) return;
    const row = card.querySelector('#vc-state');
    const dot = row.querySelector('.vc-dot');
    const txt = row.querySelector('.vc-txt');
    const note = card.querySelector('#vc-note');
    const ask = card.querySelector('[data-voice-act="ask"]');
    const V = window.FlowVoice;

    const paint = (cls, label, detail, offer) => {
      dot.className = 'vc-dot' + (cls ? ' ' + cls : '');
      txt.textContent = label;
      note.textContent = detail || '';
      ask.hidden = !offer;
    };

    if (!V || !V.available) {
      paint('no', 'Not available in this browser',
        'Chrome, Edge and Safari can do this; Firefox cannot yet. On your phone the app itself can, so it works there.');
      return;
    }

    const show = async () => {
      let st = null;
      try { st = await V.permission(); } catch (e) {}
      /* A browser: it asks on first press and there is no state to read. */
      if (!st || st.asks === 'on-use') {
        paint('ok', 'Ready',
          'Your browser will ask for the microphone the first time you press it.');
        return;
      }
      const mic = st.mic, speech = st.speech;
      if (mic === 'granted' && speech === 'granted') {
        paint('ok', 'Allowed', 'The microphone and speech recognition are both on.');
      } else if (mic === 'denied' || speech === 'denied') {
        paint('no', 'Blocked',
          'Turn the microphone and speech recognition back on for The Flow in your iPhone Settings \u2014 the app cannot ask again once they have been refused.');
      } else {
        paint('', 'Not asked yet',
          'The Flow needs the microphone to hear you, and speech recognition to turn it into words.', true);
      }
    };

    ask.addEventListener('click', async () => {
      ask.disabled = true;
      try { await V.request(); } catch (e) {}
      ask.disabled = false;
      await show();
    });

    await show();
  },

  mcpWire(section) {
    const card = section.querySelector('#mcp-card');
    if (!card) return;
    SettingsUI.mcpPaint(section);
    SettingsUI.mcpConns(section);

    const copy = async (text, btn) => {
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        /* Clipboard access is refused often enough — an insecure origin, a
           locked-down browser — that failing silently would look like a broken
           button. Select it instead so a keyboard can finish the job. */
        const el = document.createElement('textarea');
        el.value = text; document.body.appendChild(el); el.select();
        try { document.execCommand('copy'); } catch (e2) {}
        el.remove();
      }
      const was = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = was; }, 1400);
    };

    card.querySelectorAll('[data-mcp]').forEach(btn => {
      const a = btn.getAttribute('data-mcp');
      if (a === 'copyurl') btn.addEventListener('click', () => copy(location.origin + '/mcp', btn));
      if (a === 'copytok') btn.addEventListener('click', () => {
        const el = card.querySelector('#mcpSecret');
        copy((el && el.textContent) || '', btn);
      });
      if (a === 'new') btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const nameEl = card.querySelector('#mcpName');
          const r = await SettingsUI.mcpFetch('/api/flow/tokens', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: (nameEl && nameEl.value.trim()) || 'Claude' })
          });
          const box = card.querySelector('#mcpNew');
          card.querySelector('#mcpSecret').textContent = r.token;
          box.hidden = false;
          if (nameEl) nameEl.value = '';
          toast('Token created — copy it now');
          SettingsUI.nativeToken(r.token);
          SettingsUI.mcpPaint(section);
        } catch (e) { toast(e.message, 'err', 4000); }
        btn.disabled = false;
      });
    });
  },
};

/* =========================================================================
 * 17b · Visuals — find the app's own breakdown widgets and re-render them.
 *
 *  The stretched grey donut happens when an SVG or canvas is sized by CSS to
 *  a non-square box while its internal coordinate system stays square: the
 *  circle becomes an ellipse and any text inside it scales unevenly, which
 *  is what makes the label look blurry. Replacing it with a square-by-
 *  construction viewBox removes the whole class of bug.
 *
 *  Non-destructive: the original node is hidden, never removed, so if the
 *  host app writes to it later nothing throws.
 * ====================================================================== */
const BREAKDOWN_RE = /^(visual breakdown|breakdown|distribution|dağılım|dagilim|split|composition)$/i;

const Visuals = {
  upgraded: 0,

  /** Leaf elements whose entire text is a breakdown-ish heading. */
  findHeadings() {
    return $$('h1,h2,h3,h4,h5,h6,div,span,p,b,strong,label').filter(el => {
      if (el.closest('.flow-x')) return false;
      if (el.children.length) return false;
      const t = norm(el.textContent);
      return t.length < 40 && BREAKDOWN_RE.test(t);
    });
  },

  /** The card that owns a heading: nearest ancestor that also holds a chart. */
  cardFor(head) {
    let el = head.parentElement, hops = 0;
    while (el && hops < 5) {
      if (el.querySelector('svg, canvas, [class*="chart"], [class*="donut"], [class*="pie"]')) return el;
      el = el.parentElement; hops++;
    }
    return head.parentElement;
  },

  /** Try to recover the numbers the widget was supposed to be drawing. */
  harvest(card) {
    // 1 · explicit opt-in wins
    const raw = card.getAttribute('data-flow-chart');
    if (raw) { try { const d = JSON.parse(raw); if (Array.isArray(d) && d.length) return d; } catch (e) {} }

    // 2 · a table in the same card
    const rows = $$('table tbody tr', card);
    if (rows.length) {
      const out = [];
      rows.forEach(tr => {
        const cells = $$('td', tr).map(td => norm(td.textContent));
        if (cells.length < 2) return;
        const v = parseAmount(cells[cells.length - 1]);
        if (!isNaN(v) && v !== 0 && cells[0]) out.push({ label: cells[0], value: Math.abs(v) });
      });
      if (out.length) return out;
    }

    // 3 · a legend or list of "label … number" pairs
    const items = $$('li, [class*="legend"] > *, [class*="row"]', card)
      .filter(n => !n.children.length || n.children.length <= 3);
    const pairs = [];
    items.forEach(n => {
      const t = norm(n.textContent);
      const m = t.match(/^(.{1,34}?)\s*[·:\-–]?\s*([\d.,]+)\s*%?$/);
      if (!m) return;
      const v = parseAmount(m[2]);
      if (!isNaN(v) && v > 0) pairs.push({ label: norm(m[1]), value: v });
    });
    if (pairs.length >= 2) return pairs;

    return null;
  },

  /** Anything the pack itself knows about, keyed by which tab we are in. */
  fallbackFor(card) {
    const sec = card.closest('[id^="tab-"]');
    const tab = sec ? sec.id.slice(4) : '';
    const cur = Settings.get('currency');

    if (/money|financ|expense|spend/i.test(tab)) {
      const ym = new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1);
      const cats = Finance.byCategory(Finance.inMonth(ym));
      if (cats.length) return {
        data: cats, format: v => money(v, cur), centerFormat: v => moneyCompact(v, cur),
        centerLabel: 'this month', title: 'Spending by category'
      };
    }
    if (/train|workout|spor/i.test(tab) || /diet|habit|sleep/i.test(tab)) {
      const c = Rollup.checks(sec || document.body);
      if (c.total) return {
        data: [{ label: 'Done', value: c.done }, { label: 'Remaining', value: Math.max(0, c.total - c.done) }],
        format: v => String(v), centerLabel: 'items', title: 'Completion'
      };
    }
    // time actually committed per tab, from the schedule — always something real
    const mins = {};
    Schedule.all().forEach(r => { if (r.dur) mins[Rollup.labelFor(r.tab) || r.tab] = (mins[Rollup.labelFor(r.tab) || r.tab] || 0) + r.dur; });
    const md = Object.keys(mins).map(k => ({ label: k.replace(/^[^\w]+/, ''), value: mins[k] }));
    if (md.length) return { data: md, format: v => Math.round(v / 60 * 10) / 10 + ' h', centerLabel: 'scheduled', title: 'Time committed' };
    return null;
  },

  upgradeCard(card, head) {
    if (card.getAttribute('data-flow-viz')) return false;
    card.setAttribute('data-flow-viz', '1');

    // hide, never remove, whatever was drawing before
    $$('svg, canvas', card).forEach(n => {
      if (n.closest('.flow-x')) return;
      n.setAttribute('data-flow-hidden', '1');
      n.style.display = 'none';
    });
    // and any wrapper that only existed to hold it
    $$('[class*="donut"], [class*="pie"], [class*="chart"]', card).forEach(n => {
      if (n.closest('.flow-x') || n.contains(head)) return;
      if (!norm(n.textContent) || /no data/i.test(norm(n.textContent))) { n.setAttribute('data-flow-hidden', '1'); n.style.display = 'none'; }
    });

    const mount = document.createElement('div');
    mount.className = 'flow-x flow-viz';
    card.appendChild(mount);

    const paint = () => {
      const harvested = Visuals.harvest(card);
      const fb = harvested ? null : Visuals.fallbackFor(card);
      const data = harvested || (fb && fb.data);
      const form = Settings.get('breakdownForm') || 'donut';

      if (!data || !data.length) {
        mount.innerHTML = Chart.empty('No data yet',
          'This fills in as soon as there is something to break down.');
        return;
      }
      const opts = {
        format: (fb && fb.format) || (v => (Math.round(v * 100) / 100).toLocaleString()),
        centerFormat: (fb && fb.centerFormat) || (v => v >= 10000 ? moneyCompact(v, '').replace(/[^\d.,KMB]/g, '') : String(Math.round(v))),
        centerLabel: (fb && fb.centerLabel) || 'total',
        title: (fb && fb.title) || 'Breakdown'
      };
      mount.innerHTML = `
        <div class="flow-row between" style="margin-bottom:6px">
          <span class="flow-label">${esc(opts.title)}</span>
          <span class="flow-seg">
            <button class="${form === 'donut' ? 'on' : ''}" data-viz="donut">Ring</button>
            <button class="${form === 'bars' ? 'on' : ''}" data-viz="bars">Bars</button>
          </span>
        </div>
        ${form === 'donut'
          ? Chart.donut(data, opts)
          : Chart.bars(data.slice().sort((a, b) => b.value - a.value).slice(0, 8), opts)}`;
      Chart.hydrate(mount);
    };

    mount.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-viz]');
      if (!b) return;
      await Settings.set('breakdownForm', b.getAttribute('data-viz'));
      Settings.reflect();
      $$('[data-flow-viz] .flow-viz').forEach(m => { if (m.__repaint) m.__repaint(); });
    });
    mount.__repaint = paint;
    paint();
    Visuals.upgraded++;
    return true;
  },

  upgradeAll() {
    if (Settings.get('upgradeVisuals') === false) return 0;
    let n = 0;
    Visuals.findHeadings().forEach(head => {
      const card = Visuals.cardFor(head);
      if (card && Visuals.upgradeCard(card, head)) n++;
    });
    return n;
  },

  /** Put the original widgets back, for anyone who prefers them. */
  restoreAll() {
    $$('[data-flow-hidden]').forEach(n => { n.style.display = ''; n.removeAttribute('data-flow-hidden'); });
    $$('.flow-viz').forEach(n => n.remove());
    $$('[data-flow-viz]').forEach(n => n.removeAttribute('data-flow-viz'));
    Visuals.upgraded = 0;
  }
};

/* =========================================================================
 * 18 · Journal — a place to write, not a system audit trail.
 *
 *  The app's own auto-log still exists and is still useful, but it stops
 *  being the main event: it collapses behind a toggle, and the entries for
 *  a given day resurface *inside the composer* as memory joggers while you
 *  write about that day. Noise becomes raw material.
 * ====================================================================== */
const JOURNAL_KEY = 'flow:journal';
const JOURNAL_DRAFT = 'flow:journal:draft';

const MOODS = [
  { v: 1, e: '😞', l: 'rough' },
  { v: 2, e: '😕', l: 'flat' },
  { v: 3, e: '😐', l: 'ok' },
  { v: 4, e: '🙂', l: 'good' },
  { v: 5, e: '😄', l: 'great' }
];

const PROMPT_FIELDS = [
  ['wins', 'What went well'],
  ['friction', 'What got in the way'],
  ['grateful', 'Grateful for'],
  ['tomorrow', 'One thing for tomorrow']
];

const Journal = {
  entries: [],
  editingId: null,
  filter: { q: '', tag: '', from: '', to: '' },
  showPrompts: false,
  logCollapsed: true,
  sectionId: null,

  async load() {
    Journal.entries = (await DB.get(JOURNAL_KEY, [])) || [];
    const st = await DB.get('flow:journal:ui', null);
    if (st) { Journal.logCollapsed = st.logCollapsed !== false; Journal.showPrompts = !!st.showPrompts; }
    return Journal.entries;
  },
  save() { return DB.set(JOURNAL_KEY, Journal.entries); },
  saveUI() { return DB.set('flow:journal:ui', { logCollapsed: Journal.logCollapsed, showPrompts: Journal.showPrompts }); },

  words(e) {
    const t = [e.body || ''].concat(PROMPT_FIELDS.map(([k]) => (e.prompts && e.prompts[k]) || '')).join(' ');
    return (t.match(/\S+/g) || []).length;
  },
  totalWords() { return Journal.entries.reduce((a, e) => a + Journal.words(e), 0); },

  /** Consecutive days with at least one entry, counting back from today. */
  streak() {
    const days = {};
    Journal.entries.forEach(e => { days[e.date] = 1; });
    let n = 0, d = new Date();
    if (!days[isoDate(d)]) d = addDays(d, -1);        // today not written yet is not a broken streak
    while (days[isoDate(d)]) { n++; d = addDays(d, -1); }
    return n;
  },

  allTags() {
    const m = {};
    Journal.entries.forEach(e => (e.tags || []).forEach(t => { m[t] = (m[t] || 0) + 1; }));
    return Object.keys(m).sort((a, b) => m[b] - m[a]);
  },

  matching() {
    const f = Journal.filter, q = norm(f.q).toLowerCase();
    return Journal.entries
      .filter(e => {
        if (f.tag && (e.tags || []).indexOf(f.tag) < 0) return false;
        if (f.from && e.date < f.from) return false;
        if (f.to && e.date > f.to) return false;
        if (!q) return true;
        const hay = [e.title, e.body, (e.tags || []).join(' ')]
          .concat(PROMPT_FIELDS.map(([k]) => (e.prompts && e.prompts[k]) || '')).join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      })
      .sort((a, b) => (b.date + (b.created || '')).localeCompare(a.date + (a.created || '')));
  },

  /* ---- what actually happened on a given day, from every source we have -- */
  contextFor(date) {
    const out = { done: [], planned: [], spend: [], log: [] };
    Schedule.onDate(date).forEach(r => (r.done ? out.done : out.planned).push(r.text));
    Finance.items.filter(x => x.date === date).forEach(x =>
      out.spend.push(`${x.merchant || x.category} · ${money(Math.abs(x.amount), x.currency)}`));
    out.log = Journal.hostLogFor(date);
    return out;
  },

  /** Best-effort read of the app's own log rows for one date. */
  hostLogFor(date) {
    try {
      const sec = Journal.sectionId && $('#' + Journal.sectionId);
      if (!sec) return [];
      const want = parseISO(date);
      const kids = $$(':scope > *', sec).filter(n => !n.classList.contains('flow-x'));
      let current = null; const hits = [];
      kids.forEach(node => {
        const t = norm(node.textContent);
        const dm = t.match(/(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{4})/i);
        if (dm && t.length < 60) {
          const d = new Date(`${dm[1]} ${dm[2]} ${dm[3]}`);
          current = isNaN(d.getTime()) ? null : isoDate(d);
          return;
        }
        if (current === isoDate(want) && t.length > 3 && hits.length < 14) hits.push(t.slice(0, 120));
      });
      return hits;
    } catch (e) { return []; }
  },

  /* ---------------------------------------------------------------- markup */
  composer() {
    const editing = Journal.editingId ? Journal.entries.find(e => e.id === Journal.editingId) : null;
    const e = editing || Journal._draft || {};
    const date = e.date || today();
    const ctx = Journal.contextFor(date);
    const hasCtx = ctx.done.length || ctx.planned.length || ctx.spend.length || ctx.log.length;

    return `
      <div class="flow-card">
        <div class="flow-row between">
          <h3 style="margin:0">${editing ? '✎ Editing an entry' : '✍️ Write'}</h3>
          <span class="flow-row">
            <button class="flow-btn sm ${Journal.showPrompts ? 'primary' : ''}" data-j="prompts">Guided prompts</button>
            ${editing ? '<button class="flow-btn sm ghost" data-j="cancelEdit">Cancel</button>' : ''}
          </span>
        </div>

        <div class="flow-row" style="margin:12px 0 10px">
          <input class="flow-in" type="date" id="jr-date" value="${esc(date)}" style="width:150px">
          <input class="flow-in grow" id="jr-title" placeholder="Title (optional) — e.g. 'Hard session, good call'" value="${esc(e.title || '')}">
        </div>

        <textarea id="jr-body" style="min-height:170px" placeholder="How did today actually go?

Write freely — nothing here is logged automatically, and only what you type is saved.">${esc(e.body || '')}</textarea>

        ${Journal.showPrompts ? `<div class="flow-grid c2" style="margin-top:12px">
          ${PROMPT_FIELDS.map(([k, label]) => `
            <div class="flow-field"><label class="flow-label">${esc(label)}</label>
              <textarea id="jr-${k}" style="min-height:64px">${esc((e.prompts && e.prompts[k]) || '')}</textarea></div>`).join('')}
        </div>` : ''}

        <div class="flow-row" style="margin-top:12px;gap:14px">
          <span class="flow-row" style="gap:6px">
            <span class="flow-label">Mood</span>
            ${MOODS.map(m => `<button class="flow-btn sm jr-mood${e.mood === m.v ? ' primary' : ''}" data-j="mood" data-v="${m.v}" title="${m.l}">${m.e}</button>`).join('')}
          </span>
          <span class="flow-row" style="gap:6px">
            <span class="flow-label">Energy</span>
            ${[1, 2, 3, 4, 5].map(v => `<button class="flow-btn sm jr-energy${e.energy === v ? ' primary' : ''}" data-j="energy" data-v="${v}">${v}</button>`).join('')}
          </span>
        </div>

        <div class="flow-row" style="margin-top:12px">
          <input class="flow-in grow" id="jr-tags" placeholder="Tags, comma separated — e.g. training, work, music" value="${esc((e.tags || []).join(', '))}">
          <button class="flow-btn primary" data-j="save">${editing ? 'Update entry' : 'Save entry'}</button>
        </div>
        <p class="flow-sub" style="margin:10px 0 0">⌘/Ctrl + Enter saves. Drafts are kept if you navigate away mid-sentence.</p>

        ${hasCtx ? `<details style="margin-top:14px" ${editing ? '' : 'open'}>
          <summary style="cursor:pointer;font-size:12.5px;color:var(--f-muted)">What the system recorded on ${esc(prettyDate(date))} — memory joggers</summary>
          <div class="flow-grid c2" style="margin-top:10px">
            ${ctx.done.length ? `<div><div class="flow-label" style="margin-bottom:6px">✅ Done</div>${ctx.done.map(t => `<div class="flow-chip" style="margin:2px 4px 2px 0">${esc(t.slice(0, 46))}</div>`).join('')}</div>` : ''}
            ${ctx.planned.length ? `<div><div class="flow-label" style="margin-bottom:6px">◻️ Planned, not ticked</div>${ctx.planned.map(t => `<div class="flow-chip" style="margin:2px 4px 2px 0">${esc(t.slice(0, 46))}</div>`).join('')}</div>` : ''}
            ${ctx.spend.length ? `<div><div class="flow-label" style="margin-bottom:6px">💰 Spent</div>${ctx.spend.map(t => `<div class="flow-chip" style="margin:2px 4px 2px 0">${esc(t)}</div>`).join('')}</div>` : ''}
            ${ctx.log.length ? `<div><div class="flow-label" style="margin-bottom:6px">📋 Activity log</div>${ctx.log.map(t => `<div class="flow-chip" style="margin:2px 4px 2px 0">${esc(t.slice(0, 52))}</div>`).join('')}</div>` : ''}
          </div>
        </details>` : ''}
      </div>`;
  },

  entryCard(e) {
    const m = MOODS.find(x => x.v === e.mood);
    const w = Journal.words(e);
    return `
      <article class="flow-jentry" data-id="${esc(e.id)}">
        <div class="flow-row between">
          <div>
            <div class="flow-label">${esc(prettyDate(e.date))} ${e.date === today() ? '· today' : ''}</div>
            <h4 style="margin:3px 0 0;font-size:15px">${esc(e.title || 'Untitled entry')}</h4>
          </div>
          <span class="flow-row">
            ${m ? `<span class="flow-chip" title="mood: ${m.l}">${m.e}</span>` : ''}
            ${e.energy ? `<span class="flow-chip" title="energy">⚡ ${e.energy}/5</span>` : ''}
            <span class="flow-chip">${w} word${w === 1 ? '' : 's'}</span>
            <button class="flow-btn ghost sm" data-j="edit" data-id="${esc(e.id)}">Edit</button>
            <button class="flow-btn ghost sm" data-j="del" data-id="${esc(e.id)}">✕</button>
          </span>
        </div>
        ${e.body ? `<p class="flow-jbody">${esc(e.body)}</p>` : ''}
        ${PROMPT_FIELDS.filter(([k]) => e.prompts && norm(e.prompts[k])).map(([k, label]) =>
          `<div class="flow-jprompt"><b>${esc(label)}</b><span>${esc(e.prompts[k])}</span></div>`).join('')}
        ${(e.tags || []).length ? `<div style="margin-top:8px">${e.tags.map(t => `<span class="flow-chip accent" data-j="tag" data-v="${esc(t)}" style="cursor:pointer;margin-right:4px">#${esc(t)}</span>`).join('')}</div>` : ''}
      </article>`;
  },

  render(wrap) {
    const list = Journal.matching();
    const now = new Date();
    const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const thisMonth = Journal.entries.filter(e => e.date.slice(0, 7) === ym).length;
    const wroteToday = Journal.entries.some(e => e.date === today());
    const tags = Journal.allTags();

    wrap.innerHTML = `
      <div class="flow-row between" style="margin:6px 0 2px">
        <div>
          <div class="flow-label">Your words · not an activity feed</div>
          <div class="flow-hero" style="font-size:38px">📓 Journal</div>
        </div>
        <button class="flow-btn ${Journal.logCollapsed ? '' : 'primary'}" data-j="toggleLog">
          ${Journal.logCollapsed ? '📋 Show activity log' : '📋 Hide activity log'}
        </button>
      </div>

      <div class="flow-grid c4" style="margin-top:14px">
        <div class="flow-stat"><div class="v">${Journal.entries.length}</div><div class="l">Entries written</div>
          <div class="d">${wroteToday ? '✓ today is written' : 'nothing for today yet'}</div></div>
        <div class="flow-stat"><div class="v">${Journal.streak()}</div><div class="l">Day streak</div>
          <div class="d">consecutive days with an entry</div></div>
        <div class="flow-stat"><div class="v">${thisMonth}</div><div class="l">This month</div>
          <div class="d">${esc(MON[now.getMonth()])} ${now.getFullYear()}</div></div>
        <div class="flow-stat"><div class="v">${Journal.totalWords().toLocaleString()}</div><div class="l">Words</div>
          <div class="d">across every entry</div></div>
      </div>

      ${Journal.composer()}

      <div class="flow-card">
        <div class="flow-row between" style="margin-bottom:12px">
          <h3 style="margin:0">Entries</h3>
          <span class="flow-row">
            <button class="flow-btn sm" data-j="exportMd">↓ Markdown</button>
            <button class="flow-btn sm" data-j="exportJson">↓ JSON</button>
          </span>
        </div>
        <div class="flow-row" style="margin-bottom:12px">
          <input class="flow-in grow" id="jr-q" placeholder="Search your entries…" value="${esc(Journal.filter.q)}">
          <input class="flow-in" type="date" id="jr-from" value="${esc(Journal.filter.from)}" title="From">
          <input class="flow-in" type="date" id="jr-to" value="${esc(Journal.filter.to)}" title="To">
          ${Journal.filter.q || Journal.filter.tag || Journal.filter.from || Journal.filter.to
            ? '<button class="flow-btn sm ghost" data-j="clearFilter">Clear</button>' : ''}
        </div>
        ${tags.length ? `<div style="margin-bottom:12px">${tags.slice(0, 14).map(t =>
          `<span class="flow-chip${Journal.filter.tag === t ? ' accent' : ''}" data-j="tag" data-v="${esc(t)}" style="cursor:pointer;margin:0 4px 4px 0">#${esc(t)}</span>`).join('')}</div>` : ''}

        ${list.length
          ? list.map(Journal.entryCard).join('')
          : `<p class="flow-empty">${Journal.entries.length
              ? 'No entries match that search.'
              : 'Nothing written yet. The box above is the whole point — write a few lines about today and press Save entry.'}</p>`}
      </div>`;

    Journal.bind(wrap);
  },

  /* Read the composer as it stands right now. */
  collect() {
    const wrap = Journal._wrap;
    const g = (id) => wrap && wrap.querySelector('#' + id);
    const prompts = {};
    PROMPT_FIELDS.forEach(([k]) => { const el = g('jr-' + k); if (el) prompts[k] = el.value; });
    return {
      date: (g('jr-date') || {}).value || today(),
      title: norm((g('jr-title') || {}).value),
      body: (g('jr-body') || {}).value || '',
      tags: ((g('jr-tags') || {}).value || '').split(',').map(t => norm(t).toLowerCase().replace(/^#/, '')).filter(Boolean),
      prompts,
      mood: Journal._mood != null ? Journal._mood : ((Journal._draft && Journal._draft.mood) || null),
      energy: Journal._energy != null ? Journal._energy : ((Journal._draft && Journal._draft.energy) || null)
    };
  },

  keepDraft: debounce(function () {
    if (Journal.editingId || !Journal._wrap) return;
    Journal._draft = Journal.collect();
    DB.set(JOURNAL_DRAFT, Journal._draft);
  }, 900),

  async doSave() {
    const data = Journal.collect();
    const empty = !norm(data.body) && !norm(data.title) &&
      !PROMPT_FIELDS.some(([k]) => norm(data.prompts[k]));
    if (empty) { toast('Write something first.', 'warn'); return; }

    if (Journal.editingId) {
      const e = Journal.entries.find(x => x.id === Journal.editingId);
      if (e) Object.assign(e, data, { updated: new Date().toISOString() });
      Journal.editingId = null;
      toast('Entry updated ✓');
    } else {
      Journal.entries.push(Object.assign({ id: uid('j'), created: new Date().toISOString(), updated: new Date().toISOString() }, data));
      toast('Entry saved ✓');
    }
    Journal._draft = null; Journal._mood = null; Journal._energy = null;
    await DB.set(JOURNAL_DRAFT, null);
    await Journal.save();
    Journal.render(Journal._wrap);
  },

  applyFilter: debounce(function () {
    const wrap = Journal._wrap;
    if (!wrap) return;
    const g = (id) => wrap.querySelector('#' + id);
    Journal.filter.q = (g('jr-q') || {}).value || '';
    Journal.filter.from = (g('jr-from') || {}).value || '';
    Journal.filter.to = (g('jr-to') || {}).value || '';
    const focused = document.activeElement && document.activeElement.id;
    Journal.render(wrap);
    const back = focused && wrap.querySelector('#' + focused);
    if (back) { back.focus(); if (back.setSelectionRange && back.value) back.setSelectionRange(back.value.length, back.value.length); }
  }, 320),

  bind(wrap) {
    Journal._wrap = wrap;
    const g = (id) => wrap.querySelector('#' + id);

    /* Field listeners are re-attached every render, because render() replaces
       innerHTML and these are brand-new elements each time. */
    ['jr-body', 'jr-title', 'jr-tags'].forEach(id => { const el = g(id); if (el) el.addEventListener('input', Journal.keepDraft); });
    ['jr-q', 'jr-from', 'jr-to'].forEach(id => { const el = g(id); if (el) el.addEventListener('input', Journal.applyFilter); });
    const bodyEl = g('jr-body');
    if (bodyEl) {
      bodyEl.addEventListener('keydown', (ev) => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); Journal.doSave(); }
      });
    }

    /* The delegated handler lives on `wrap`, which survives every render —
       so it must be attached exactly once or every click fires N times. */
    if (wrap.__flowJournalBound) return;
    wrap.__flowJournalBound = true;

    wrap.addEventListener('click', async (ev) => {
      const t = ev.target.closest('[data-j]');
      if (!t) return;
      const a = t.getAttribute('data-j');

      if (a === 'save') Journal.doSave();
      else if (a === 'mood') {
        Journal._mood = Number(t.getAttribute('data-v'));
        $$('.jr-mood', wrap).forEach(b => b.classList.toggle('primary', Number(b.getAttribute('data-v')) === Journal._mood));
        Journal.keepDraft();
      }
      else if (a === 'energy') {
        Journal._energy = Number(t.getAttribute('data-v'));
        $$('.jr-energy', wrap).forEach(b => b.classList.toggle('primary', Number(b.getAttribute('data-v')) === Journal._energy));
        Journal.keepDraft();
      }
      else if (a === 'prompts') { Journal.showPrompts = !Journal.showPrompts; Journal._draft = Journal.collect(); await Journal.saveUI(); Journal.render(wrap); }
      else if (a === 'edit') {
        Journal.editingId = t.getAttribute('data-id');
        const e = Journal.entries.find(x => x.id === Journal.editingId);
        Journal._mood = e ? e.mood : null; Journal._energy = e ? e.energy : null;
        Journal.showPrompts = Journal.showPrompts || (e && PROMPT_FIELDS.some(([k]) => e.prompts && norm(e.prompts[k])));
        Journal.render(wrap);
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      else if (a === 'cancelEdit') { Journal.editingId = null; Journal._mood = null; Journal._energy = null; Journal.render(wrap); }
      else if (a === 'del') {
        const e = Journal.entries.find(x => x.id === t.getAttribute('data-id'));
        if (!e) return;
        if (!confirm(`Delete the entry from ${prettyDate(e.date)}?\n\nThis cannot be undone.`)) return;
        Journal.entries = Journal.entries.filter(x => x.id !== e.id);
        await Journal.save(); toast('Entry deleted'); Journal.render(wrap);
      }
      else if (a === 'tag') {
        const v = t.getAttribute('data-v');
        Journal.filter.tag = Journal.filter.tag === v ? '' : v;
        Journal.render(wrap);
      }
      else if (a === 'clearFilter') { Journal.filter = { q: '', tag: '', from: '', to: '' }; Journal.render(wrap); }
      else if (a === 'toggleLog') { Journal.logCollapsed = !Journal.logCollapsed; await Journal.saveUI(); Journal.applyLogVisibility(); Journal.render(wrap); }
      else if (a === 'exportMd') Journal.exportMarkdown();
      else if (a === 'exportJson') download(`the-flow-journal-${today()}.json`, JSON.stringify(Journal.entries, null, 2), 'application/json');
    });
  },

  exportMarkdown() {
    const list = Journal.matching().slice().reverse();
    if (!list.length) { toast('No entries to export.', 'warn'); return; }
    let md = `# Journal — The Flow\n\n_${list.length} entries · exported ${today()}_\n\n`;
    list.forEach(e => {
      const d = parseISO(e.date);
      md += `\n---\n\n## ${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}\n`;
      if (e.title) md += `### ${e.title}\n`;
      const meta = [];
      const m = MOODS.find(x => x.v === e.mood);
      if (m) meta.push(`mood ${e.mood}/5 ${m.e}`);
      if (e.energy) meta.push(`energy ${e.energy}/5`);
      if ((e.tags || []).length) meta.push(e.tags.map(t => '#' + t).join(' '));
      if (meta.length) md += `\n_${meta.join(' · ')}_\n`;
      if (e.body) md += `\n${e.body}\n`;
      PROMPT_FIELDS.forEach(([k, label]) => {
        if (e.prompts && norm(e.prompts[k])) md += `\n**${label}:** ${e.prompts[k]}\n`;
      });
    });
    download(`the-flow-journal-${today()}.md`, md, 'text/markdown');
    toast(`${list.length} entries exported as Markdown ✓`);
  },

  applyLogVisibility() {
    const sec = Journal.sectionId && $('#' + Journal.sectionId);
    if (!sec) return;
    sec.classList.toggle('flow-log-collapsed', !!Journal.logCollapsed);
  },

  async mount(section) {
    Journal.sectionId = section.id;
    if (section.querySelector('[data-flow-journal]')) { Journal.applyLogVisibility(); return; }
    Journal._draft = await DB.get(JOURNAL_DRAFT, null);
    if (Journal._draft) { Journal._mood = Journal._draft.mood; Journal._energy = Journal._draft.energy; }
    const wrap = document.createElement('div');
    wrap.className = 'flow-x';
    wrap.setAttribute('data-flow-journal', '1');
    section.insertBefore(wrap, section.firstChild);
    Journal.applyLogVisibility();
    Journal.render(wrap);
  },

  rerender() {
    const w = $('[data-flow-journal]');
    if (w) Journal.render(w);
  }
};

/* =========================================================================
 * 19 · Boot
 * ====================================================================== */
/* =========================================================================
 * 18 · Sleep chart — rebuilt
 *
 * The original drew three encodings of one series (bars + line + dots) on a
 * fixed 0–10h scale that only labelled 6–9h, so every real night was squashed
 * into the top sliver of the plot and the line always looked flat. Bar width
 * was cW/n*0.6, so at three nights each bar became a fifth of the chart. The
 * canvas also had hard 800×140 attributes stretched by CSS, which is why the
 * type looked soft.
 *
 * One series is one form: a single-hue line over a dynamic scale, on a
 * device-pixel-ratio canvas, with the 7–9h target as a quiet band behind it.
 * ====================================================================== */
/* ══════════════════════════════════════════════════════════════════════════
 * 32 · Mood & Energy chart
 *
 * Rebuilt to the same anatomy as the sleep chart. What was wrong with the old
 * one, in order of how much it hurt:
 *
 *   · the legend was drawn as a floating box inside the plot, so it sat on top
 *     of the lines and its own text was clipped by the canvas edge;
 *   · the canvas had a fixed 800×140 backing store stretched to whatever width
 *     the card happened to be, so everything was blurry and squashed;
 *   · dates read "07-15" rather than "15 Jul";
 *   · no value was ever stated — you had to read positions off a gridline;
 *   · it bailed out silently on fewer than two entries.
 *
 * Both series are the same 1–5 scale, so they share one axis. (Two scales on
 * one chart would be the single worst thing you can do here.) Identity is
 * carried three ways — legend, colour, and a direct label at the end of each
 * line — so it never rests on colour alone.
 *
 * Colours: #ff5ca8 / #dd9000. Checked with the palette validator against this
 * card's surface rather than guessed — CVD ΔE 15.0 (deuteranopia), 22.9 normal
 * vision, both over 3:1 on the surface, and matched in lightness to within
 * 0.004 OKLCH so neither line visually outranks the other.
 * ══════════════════════════════════════════════════════════════════════════ */
const MoodChart = {
  _hi: -1,
  _pts: [],
  MOOD: '#ff5ca8',
  ENERGY: '#dd9000',
  SURF: '#14161b',

  rows() {
    try {
      if (typeof mdData === 'undefined' || !Array.isArray(mdData)) return [];
      return mdData.filter(e => e && (isFinite(Number(e.mood)) || isFinite(Number(e.energy))));
    } catch (e) { return []; }
  },

  install() {
    const cv = document.getElementById('mdChart');
    if (!cv || cv.__flowMood) return;
    cv.__flowMood = 1;
    /* Let CSS own the size and give the backing store to the device pixel
       ratio, instead of stretching a fixed 800×140 bitmap. */
    cv.style.width = '100%';
    cv.style.height = '210px';
    cv.style.display = 'block';
    cv.removeAttribute('width'); cv.removeAttribute('height');

    window.renderMoodChart = MoodChart.draw;

    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(MoodChart.draw, 140); });
    cv.addEventListener('mousemove', MoodChart.hover);
    cv.addEventListener('mouseleave', () => { MoodChart._hi = -1; MoodChart.tip(null); MoodChart.draw(); });
    MoodChart.draw();
  },

  tip(html, x, y) {
    let el = document.getElementById('flow-mood-tip');
    if (!html) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'flow-mood-tip'; el.className = 'flow-tip';
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.style.left = Math.round(x + 12) + 'px';
    el.style.top = Math.round(y - 34) + 'px';
  },

  hover(e) {
    const pts = MoodChart._pts;
    if (!pts.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    let best = 0, bd = 1e9;
    pts.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < bd) { bd = d; best = i; } });
    if (bd > 40) { MoodChart._hi = -1; MoodChart.tip(null); MoodChart.draw(); return; }
    MoodChart._hi = best;
    const p = pts[best];
    const bit = (c, n, v) => v == null ? '' :
      `<span style="color:${c}">●</span> ${n} <b>${v}</b>/5`;
    MoodChart.tip(
      `${esc(p.label)}<br>${bit(MoodChart.MOOD, 'Mood', p.mood)}` +
      (p.mood != null && p.energy != null ? ' &nbsp; ' : '') +
      `${bit(MoodChart.ENERGY, 'Energy', p.energy)}`,
      r.left + p.x, r.top + p.y);
    MoodChart.draw();
  },

  draw() {
    const cv = document.getElementById('mdChart');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = Math.max(280, Math.round(cv.clientWidth || (cv.parentElement && cv.parentElement.clientWidth) || 800));
    const cssH = 210;
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const F = 'system-ui,-apple-system,"Segoe UI",sans-serif';
    const INK = '#7e8493', INK2 = '#d5dae3';
    const MOOD = MoodChart.MOOD, ENERGY = MoodChart.ENERGY;
    const rec = MoodChart.rows().slice(-14);
    const head = document.querySelector('.mood-chart-wrap h3');

    if (!rec.length) {
      ctx.fillStyle = INK; ctx.font = '13px ' + F;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Nothing logged yet — rate a day above and this fills in.', cssW / 2, cssH / 2);
      if (head) head.textContent = 'Mood & Energy';
      MoodChart._pts = [];
      return;
    }
    /* Say what is actually on screen, not a hard-coded "last 14 days". */
    if (head) head.textContent = rec.length === 1
      ? 'Mood & Energy — today'
      : 'Mood & Energy — last ' + rec.length + ' days';

    /* Right padding carries the two end labels; top padding carries the
       legend. Both used to be drawn over the plot. */
    const pad = { l: 30, r: 74, t: 34, b: 26 };
    const w = cssW - pad.l - pad.r, h = cssH - pad.t - pad.b;
    const lo = 1, hi = 5;
    const Y = v => pad.t + h - ((v - lo) / (hi - lo)) * h;
    const X = i => rec.length === 1 ? pad.l + w / 2 : pad.l + (i / (rec.length - 1)) * w;

    /* 4–5 band, behind everything. Neutral rather than either series colour,
       so it cannot be mistaken for one of the lines. */
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    const yb = Y(5), yt = Y(4);
    ctx.fillRect(pad.l, yb, w, yt - yb);

    /* hairline grid + y labels */
    ctx.lineWidth = 1; ctx.font = '10px ' + F;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = 1; v <= 5; v++) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
      ctx.fillStyle = INK; ctx.fillText(String(v), pad.l - 9, y);
    }
    ctx.textAlign = 'left'; ctx.font = '9.5px ' + F;
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillText('4–5 good', pad.l + 7, yb + 9);

    /* Legend above the plot, where no data can reach it. Text in ink; the
       swatch alone carries the colour. */
    let lx = pad.l;
    ctx.textBaseline = 'middle'; ctx.font = '11px ' + F;
    [['Mood', MOOD], ['Energy', ENERGY]].forEach(([name, col]) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(lx, pad.t - 22, 10, 10, 2); ctx.fill(); }
      else ctx.fillRect(lx, pad.t - 22, 10, 10);
      ctx.fillStyle = INK2; ctx.textAlign = 'left';
      ctx.fillText(name, lx + 15, pad.t - 17);
      lx += 15 + ctx.measureText(name).width + 16;
    });

    const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
    const pts = rec.map((e, i) => ({
      x: X(i),
      mood: num(e.mood), energy: num(e.energy),
      label: (function () {
        try { const d = parseISO(e.date); return d.getDate() + ' ' + MON[d.getMonth()]; }
        catch (x) { return String(e.date || ''); }
      })()
    }));
    MoodChart._pts = pts;

    /* One pass per series: line, then dots with a surface ring so they read
       where the two cross. No area fill — two translucent fills over each
       other turn to mud. */
    const series = [
      { key: 'mood', col: MOOD, name: 'Mood' },
      { key: 'energy', col: ENERGY, name: 'Energy' }
    ];

    series.forEach(s => {
      const seq = pts.filter(p => p[s.key] != null);
      if (seq.length > 1) {
        ctx.strokeStyle = s.col; ctx.lineWidth = 2;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        seq.forEach((p, i) => i ? ctx.lineTo(p.x, Y(p[s.key])) : ctx.moveTo(p.x, Y(p[s.key])));
        ctx.stroke();
      }
      const showDots = seq.length <= 14;
      seq.forEach((p, i) => {
        const on = pts.indexOf(p) === MoodChart._hi;
        if (!showDots && !on && i !== seq.length - 1) return;
        ctx.beginPath(); ctx.arc(p.x, Y(p[s.key]), on ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = s.col; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = MoodChart.SURF; ctx.stroke();
      });
    });

    /* Direct labels at the right end — the secondary encoding that means
       identity never depends on colour. Nudged apart when the two lines
       finish close together. */
    const ends = series.map(s => {
      const seq = pts.filter(p => p[s.key] != null);
      if (!seq.length) return null;
      const p = seq[seq.length - 1];
      return { x: p.x, y: Y(p[s.key]), v: p[s.key], col: s.col, name: s.name };
    }).filter(Boolean);

    if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 15) {
      const up = ends[0].y <= ends[1].y ? ends[0] : ends[1];
      const dn = up === ends[0] ? ends[1] : ends[0];
      up.y -= (15 - Math.abs(ends[0].y - ends[1].y)) / 2;
      dn.y += (15 - Math.abs(ends[0].y - ends[1].y)) / 2;
    }
    ends.forEach(e => {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = e.col;
      ctx.beginPath(); ctx.arc(e.x + 12, e.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '700 12px ' + F; ctx.fillStyle = INK2;
      ctx.fillText(String(e.v), e.x + 19, e.y);
      ctx.font = '10px ' + F; ctx.fillStyle = INK;
      ctx.fillText(e.name, e.x + 19 + ctx.measureText(String(e.v)).width + 12, e.y + 0.5);
    });

    /* x labels: both ends always, the rest thinned so they cannot collide */
    ctx.font = '10px ' + F; ctx.fillStyle = INK; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.ceil(pts.length / 5));
    pts.forEach((p, i) => {
      const isEnd = i === 0 || i === pts.length - 1;
      if (!isEnd && (i % step !== 0 || i > pts.length - 1 - step * 0.6)) return;
      ctx.textAlign = i === 0 ? 'left' : (i === pts.length - 1 ? 'right' : 'center');
      ctx.fillText(p.label, p.x + (i === 0 ? -4 : (i === pts.length - 1 ? 4 : 0)), pad.t + h + 8);
    });

    if (MoodChart._hi >= 0 && pts[MoodChart._hi]) {
      const p = pts[MoodChart._hi];
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(p.x) + 0.5, pad.t);
      ctx.lineTo(Math.round(p.x) + 0.5, pad.t + h);
      ctx.stroke();
    }
  }
};

const SleepChart = {
  _hi: -1,
  _pts: [],
  HUE: '#00e88a',          /* contrast 3:1+ on the card surface — validated */
  SURF: '#14161b',

  rows() {
    try {
      if (typeof slData === 'undefined' || !Array.isArray(slData)) return [];
      return slData.filter(e => e && isFinite(Number(e.hrs)) && Number(e.hrs) > 0);
    } catch (e) { return []; }
  },

  install() {
    const cv = document.getElementById('slChart');
    if (!cv || cv.__flowSleep) return;
    cv.__flowSleep = 1;
    cv.style.width = '100%';
    cv.style.height = '190px';
    cv.style.display = 'block';
    cv.removeAttribute('width'); cv.removeAttribute('height');

    window.renderSleepChart = SleepChart.draw;

    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(SleepChart.draw, 140); });
    cv.addEventListener('mousemove', SleepChart.hover);
    cv.addEventListener('mouseleave', () => { SleepChart._hi = -1; SleepChart.tip(null); SleepChart.draw(); });
    SleepChart.draw();
  },

  tip(html, x, y) {
    let el = $('#flow-sleep-tip');
    if (!html) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'flow-sleep-tip'; el.className = 'flow-tip'; document.body.appendChild(el); }
    el.innerHTML = html;
    el.style.left = Math.round(x + 12) + 'px';
    el.style.top = Math.round(y - 34) + 'px';
  },

  hover(e) {
    const pts = SleepChart._pts;
    if (!pts.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    let best = 0, bd = 1e9;
    pts.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < bd) { bd = d; best = i; } });
    if (bd > 40) { SleepChart._hi = -1; SleepChart.tip(null); SleepChart.draw(); return; }
    SleepChart._hi = best;
    const p = pts[best];
    SleepChart.tip(`<b>${p.hrs.toFixed(1)}h</b> · ${esc(p.label)}` + (p.quality ? ` · ${esc(String(p.quality))}/5` : ''),
      r.left + p.x, r.top + p.y);
    SleepChart.draw();
  },

  draw() {
    const cv = document.getElementById('slChart');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = Math.max(280, Math.round(cv.clientWidth || (cv.parentElement && cv.parentElement.clientWidth) || 800));
    const cssH = 190;
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const F = 'system-ui,-apple-system,"Segoe UI",sans-serif';
    const INK = '#7e8493', INK2 = '#d5dae3', HUE = SleepChart.HUE;
    const rec = SleepChart.rows().slice(-14);

    if (!rec.length) {
      ctx.fillStyle = INK; ctx.font = '13px ' + F; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No nights logged yet — add one above and this fills in.', cssW / 2, cssH / 2);
      const h0 = document.querySelector('.sleep-chart-wrap h3');
      if (h0) h0.textContent = 'Sleep hours';
      SleepChart._pts = []; return;
    }

    /* The heading is hard-coded to "last 14 nights"; say what is actually shown. */
    const head = document.querySelector('.sleep-chart-wrap h3');
    if (head) head.textContent = rec.length === 1
      ? 'Sleep hours — last night'
      : 'Sleep hours — last ' + rec.length + ' nights';

    const pad = { l: 36, r: 18, t: 18, b: 26 };
    const w = cssW - pad.l - pad.r, h = cssH - pad.t - pad.b;
    const vals = rec.map(e => Number(e.hrs));
    let lo = Math.floor(Math.min.apply(null, vals.concat([6.5]))) - 0.5;
    let hi = Math.ceil(Math.max.apply(null, vals.concat([8.5]))) + 0.5;
    if (hi - lo < 3) hi = lo + 3;
    const Y = v => pad.t + h - ((v - lo) / (hi - lo)) * h;
    const X = i => rec.length === 1 ? pad.l + w / 2 : pad.l + (i / (rec.length - 1)) * w;

    /* target band, behind everything */
    ctx.fillStyle = 'rgba(0,232,138,.055)';
    const yb = Math.max(pad.t, Y(9)), yt = Math.min(pad.t + h, Y(7));
    ctx.fillRect(pad.l, yb, w, yt - yb);

    /* hairline grid + y labels */
    ctx.lineWidth = 1; ctx.font = '10px ' + F; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(lo); v <= Math.floor(hi); v++) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
      ctx.fillStyle = INK; ctx.fillText(v + 'h', pad.l - 9, y);
    }
    /* Left-aligned: the latest-value label always sits at the right end, and
       the two collided there. */
    ctx.textAlign = 'left'; ctx.font = '9.5px ' + F; ctx.fillStyle = 'rgba(0,232,138,.5)';
    ctx.fillText('7–9h target', pad.l + 7, yb + 9);

    const pts = rec.map((e, i) => ({
      x: X(i), y: Y(Number(e.hrs)), hrs: Number(e.hrs), date: e.date,
      quality: e.quality,
      label: (function () { try { const d = parseISO(e.date); return d.getDate() + ' ' + MON[d.getMonth()]; } catch (x) { return String(e.date || ''); } })()
    }));
    SleepChart._pts = pts;

    if (pts.length > 1) {
      /* area under the line */
      const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
      g.addColorStop(0, 'rgba(0,232,138,.20)');
      g.addColorStop(1, 'rgba(0,232,138,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pad.t + h);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, pad.t + h); ctx.closePath(); ctx.fill();

      ctx.strokeStyle = HUE; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
    }

    /* dots: 2px surface ring so they read against the line */
    const showDots = pts.length <= 14;
    pts.forEach((p, i) => {
      const on = i === SleepChart._hi;
      if (!showDots && !on && i !== pts.length - 1) return;
      ctx.beginPath(); ctx.arc(p.x, p.y, on ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = HUE; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = SleepChart.SURF; ctx.stroke();
    });

    /* one direct label — the latest night. Never a number on every point. */
    const last = pts[pts.length - 1];
    ctx.font = '700 12px ' + F; ctx.fillStyle = INK2;
    ctx.textAlign = last.x > pad.l + w - 40 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(last.hrs.toFixed(1) + 'h', last.x + (ctx.textAlign === 'right' ? -8 : 8), last.y - 7);

    /* x labels: ends always, then thinned to avoid collisions */
    ctx.font = '10px ' + F; ctx.fillStyle = INK; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.ceil(pts.length / 5));
    pts.forEach((p, i) => {
      const isEnd = i === 0 || i === pts.length - 1;
      if (!isEnd && (i % step !== 0 || i > pts.length - 1 - step * 0.6)) return;
      ctx.textAlign = i === 0 ? 'left' : (i === pts.length - 1 ? 'right' : 'center');
      ctx.fillText(p.label, p.x + (i === 0 ? -4 : (i === pts.length - 1 ? 4 : 0)), pad.t + h + 8);
    });

    if (SleepChart._hi >= 0 && pts[SleepChart._hi]) {
      const p = pts[SleepChart._hi];
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(p.x) + 0.5, pad.t); ctx.lineTo(Math.round(p.x) + 0.5, pad.t + h); ctx.stroke();
    }
  }
};

/* =========================================================================
 * 19 · Today — collapsible groups
 *
 * The Today feed rendered every diet item and every Sharpen-the-Saw item in
 * full, so the two longest, most repetitive blocks pushed everything else off
 * the first screen. They become headers you tap: label, count, chevron.
 *
 * This wraps the app's own renderToday() instead of replacing it, so all the
 * tick handling and journal logging inside it stay exactly as they were. The
 * app re-renders Today on every tick, so the wrapper re-applies each time.
 * Open/closed state is UI, not data — it lives in localStorage under the
 * pack's own namespace and never touches the database.
 * ====================================================================== */
/* An audit nobody remembers to run is not a routine. Twice a year — and only
   twice — the screen you actually open says so, once, at the top. It is
   dismissible for the day, because a banner you cannot silence stops being
   information and becomes furniture. */
const AuditNudge = {
  LS: 'flowpack:auditSnooze',

  snoozed() { try { return localStorage.getItem(AuditNudge.LS) === today(); } catch (e) { return false; } },
  snooze()  { try { localStorage.setItem(AuditNudge.LS, today()); } catch (e) {} },

  apply() {
    const mount = document.getElementById('today-feed');
    if (!mount) return;
    const old = mount.querySelector('.td-audit');
    if (old) old.remove();
    /* Nothing is claimed before the audit's own data has loaded — a banner
       saying "due" that turns out not to be is worse than a late one. */
    if (!Audit.loaded) return;
    if (AuditNudge.snoozed()) return;
    const due = Audit.due();
    if (!due.due && !Audit.draft) return;

    const el = document.createElement('div');
    /* flow-x as well as td-audit: the pack's colours live on that class, and
       this banner is mounted inside the host's own feed where they would
       otherwise be undefined — which is how you get an invisible button on a
       card that looks fine everywhere else. */
    el.className = 'td-audit flow-x';
    el.innerHTML =
      '<div class="td-audit-body">' +
        '<span class="lbl">' + (Audit.draft ? 'Audit in progress' : 'Routine audit') + '</span>' +
        '<p>' + (Audit.draft
          ? Audit.decided() + ' of ' + Audit.total() + ' decided. Finish it while the last ' + Audit.cfg.months + ' months are still in front of you.'
          : "Six months of things you do every day are sitting in the record. Keep what's working, get rid of what isn't.") +
        '</p>' +
      '</div>' +
      '<div class="td-audit-acts">' +
        '<button type="button" class="flow-btn sm primary" data-au-go="1">' + (Audit.draft ? 'Carry on' : 'Open it') + '</button>' +
        '<button type="button" class="flow-btn sm ghost" data-au-later="1">Later</button>' +
      '</div>';
    mount.insertBefore(el, mount.firstChild);

    el.querySelector('[data-au-go]').addEventListener('click', () => {
      Fold.setOpen('audit', true);
      const pill = document.querySelector('.tab[data-tab="northstar"]');
      if (pill) pill.click();
      setTimeout(() => {
        const card = document.querySelector('[data-foldcard="audit"]');
        if (card) { card.classList.add('is-open'); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }, 400);
    });
    el.querySelector('[data-au-later]').addEventListener('click', () => { AuditNudge.snooze(); el.remove(); });
  }
};

const TodayGroups = {
  LS: 'flowpack:todayOpen',
  COLLAPSIBLE: [/^diet$/i, /^sharpen the (saw|blade)$/i],

  state() {
    try { return JSON.parse(localStorage.getItem(TodayGroups.LS) || '{}'); } catch (e) { return {}; }
  },
  setOpen(k, v) {
    const s = TodayGroups.state(); if (v) s[k] = 1; else delete s[k];
    try { localStorage.setItem(TodayGroups.LS, JSON.stringify(s)); } catch (e) {}
  },

  install() {
    if (typeof window.renderToday !== 'function' || window.renderToday.__flowWrapped) return;
    const original = window.renderToday;
    const wrapped = function () {
      const r = original.apply(this, arguments);
      try { TodayPlus.apply(); } catch (e) { console.warn('[Flow] today plus', e); }
      try { TodayGroups.apply(); } catch (e) { console.warn('[Flow] today groups', e); }
      try { AuditNudge.apply(); } catch (e) { console.warn('[Flow] audit nudge', e); }
      return r;
    };
    wrapped.__flowWrapped = 1;
    window.renderToday = wrapped;
    try { wrapped(); } catch (e) {}
  },

  apply() {
    const mount = document.getElementById('today-feed');
    if (!mount) return;
    const open = TodayGroups.state();

    $$('.td-group', mount).forEach(group => {
      const head = $('.td-group-head', group);
      if (!head || head.__flowFolded) return;
      const label = norm(($('.g-lbl', head) || {}).textContent || '');
      if (!TodayGroups.COLLAPSIBLE.some(re => re.test(label))) return;

      head.__flowFolded = 1;
      const key = label.toLowerCase();
      const isOpen = !!open[key];

      group.classList.add('flow-fold');
      group.classList.toggle('is-open', isOpen);
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      head.setAttribute('aria-label', label + ', ' + (isOpen ? 'collapse' : 'expand'));

      if (!$('.flow-fold-chev', head)) {
        const chev = document.createElement('span');
        chev.className = 'flow-fold-chev';
        chev.setAttribute('aria-hidden', 'true');
        head.appendChild(chev);
      }

      const toggle = (e) => {
        e.preventDefault(); e.stopPropagation();
        const nowOpen = !group.classList.contains('is-open');
        group.classList.toggle('is-open', nowOpen);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        head.setAttribute('aria-label', label + ', ' + (nowOpen ? 'collapse' : 'expand'));
        TodayGroups.setOpen(key, nowOpen);
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') toggle(e);
      });
    });
  }
};

/* =========================================================================
 * 20 · Today — the 7am read
 *
 * The feed answered "what are my week's rocks, and have I eaten". It never
 * touched habits, priorities, recovery or spending, all of which the app was
 * already storing. This injects four things into the app's own feed:
 *
 *   · a pulse strip under the header — recovery, priorities, habits, spend,
 *     the four questions worth answering before you are properly awake
 *   · priorities: open Q1/Q2 items plus anything scheduled that has slipped
 *   · habits: today's boxes with streaks, tappable in place
 *   · spend: today and month-to-date against budget
 *
 * Injected around the existing blocks rather than replacing renderToday, so
 * rocks, training, diet and Sharpen-the-Saw keep their original behaviour.
 * Ticking anything here writes through the app's own stores and re-renders.
 * ====================================================================== */
/* ── Focus time ──────────────────────────────────────────────────────────
 * A timer, not a monitor: start it when you sit down to one thing, pause
 * for the interruption, finish when it is done. Breaks are not counted.
 * A session you forgot to time can be added by hand. The total for today
 * is the third tile on Today; it says nothing about attention, only about
 * time you chose to log. Kept in the account, so the Mac and the phone
 * show the same number.
 * ====================================================================== */
const Focus = {
  KEY: 'flow:focus',
  data: null,     /* { sessions: [{ d, min, at }], run: { startedAt, accum, paused } | null } */
  _timer: null,

  async load() {
    if (Focus.data) return Focus.data;
    const v = await DB.get(Focus.KEY, null);
    Focus.data = (v && typeof v === 'object') ? v : { sessions: [], run: null };
    if (!Array.isArray(Focus.data.sessions)) Focus.data.sessions = [];
    Focus.tick();
    return Focus.data;
  },
  async save() { try { await DB.set(Focus.KEY, Focus.data); } catch (e) {} },

  /* Minutes logged today, finished sessions plus the one running. */
  todayMin() {
    const d = Focus.data || { sessions: [], run: null };
    const t = today();
    let min = d.sessions.filter((x) => x && x.d === t).reduce((a, x) => a + (Number(x.min) || 0), 0);
    min += Math.floor(Focus.runMs() / 60000);
    return min;
  },
  runMs() {
    const r = Focus.data && Focus.data.run;
    if (!r) return 0;
    return (r.accum || 0) + (r.paused || !r.startedAt ? 0 : Date.now() - r.startedAt);
  },
  running() { const r = Focus.data && Focus.data.run; return !!(r && !r.paused); },
  fmt(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
  },
  fmtMs(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  },

  async start() {
    await Focus.load();
    const r = Focus.data.run;
    if (r && r.paused) { r.paused = false; r.startedAt = Date.now(); }
    else if (!r) Focus.data.run = { startedAt: Date.now(), accum: 0, paused: false };
    await Focus.save(); Focus.tick(); Focus.paint();
  },
  async pause() {
    await Focus.load();
    const r = Focus.data.run;
    if (!r || r.paused) return;
    r.accum = (r.accum || 0) + (Date.now() - r.startedAt); r.paused = true; r.startedAt = null;
    await Focus.save(); Focus.tick(); Focus.paint();
  },
  async finish() {
    await Focus.load();
    const ms = Focus.runMs();
    Focus.data.run = null;
    const min = Math.round(ms / 60000);
    if (min >= 1) await Focus.add(min, 'timer');
    else { await Focus.save(); Focus.tick(); Focus.paint(); }
  },
  async add(min, how) {
    await Focus.load();
    min = Math.round(Number(min) || 0);
    if (min < 1) return;
    Focus.data.sessions.push({ d: today(), min, at: new Date().toISOString(), how: how || 'manual' });
    Focus.data.sessions = Focus.data.sessions.slice(-400);
    await Focus.save();
    try { if (typeof J === 'function') J('focus', '⏱ Focus ' + Focus.fmt(min) + (how === 'manual' ? ' (added by hand)' : '')); } catch (e) {}
    Focus.tick(); Focus.paint();
    try { toast('Focus logged: ' + Focus.fmt(min), null, 1600); } catch (e) {}
  },
  async remove(i) {
    await Focus.load();
    const mine = Focus.data.sessions.map((x, idx) => ({ x, idx })).filter((o) => o.x && o.x.d === today());
    const hit = mine[i];
    if (!hit) return;
    Focus.data.sessions.splice(hit.idx, 1);
    await Focus.save(); Focus.tick(); Focus.paint();
  },

  /* The tile on Today, and the clock in the sheet, kept current. */
  tick() {
    clearInterval(Focus._timer); Focus._timer = null;
    Focus.paintTile();
    if (Focus.running()) Focus._timer = setInterval(() => { Focus.paintTile(); Focus.paintClock(); }, 1000);
  },
  paintTile() {
    const tile = document.querySelector('.flow-td-pulse [data-jump="focus"]');
    if (!tile) return;
    const min = Focus.todayMin();
    const v = tile.querySelector('.v'), sub = tile.querySelector('.s');
    if (v) v.textContent = min ? Focus.fmt(min) : '—';
    if (sub) sub.textContent = Focus.running() ? '● running' : (min ? 'logged today' : 'Start focus');
    tile.classList.toggle('good', Focus.running());
  },
  paintClock() {
    const c = document.getElementById('fc-clock');
    if (c) c.textContent = Focus.fmtMs(Focus.runMs());
  },

  /* The sheet. */
  el: null,
  open() {
    Focus.load().then(() => {
      if (!Focus.el) Focus.build();
      Focus.paint();
      Focus.el.classList.add('on');
    });
  },
  close() { if (Focus.el) Focus.el.classList.remove('on'); },
  build() {
    const wrap = document.createElement('div');
    wrap.id = 'flow-focus'; wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-fc-close="1"></div>' +
      '<div class="fn-sheet" role="dialog" aria-label="Focus time" aria-modal="true">' +
        '<div class="fn-grab" data-fc-close="1"></div>' +
        '<button type="button" class="fn-capture-close" data-fc-close="1" aria-label="Close">×</button>' +
        '<h4>Focus time</h4>' +
        '<div class="fn-sub">Time you chose to give one thing. Breaks are not counted.</div>' +
        '<div class="fc-clock" id="fc-clock">00:00:00</div>' +
        '<div class="fc-acts">' +
          '<button type="button" class="flow-btn primary" data-fc="start">Start</button>' +
          '<button type="button" class="flow-btn" data-fc="pause">Pause</button>' +
          '<button type="button" class="flow-btn" data-fc="finish">Finish</button>' +
        '</div>' +
        '<div class="fc-manual"><span class="flow-label">Add by hand</span>' +
          '<button type="button" class="flow-btn sm" data-fc-add="25">+25 min</button>' +
          '<button type="button" class="flow-btn sm" data-fc-add="50">+50 min</button>' +
          '<button type="button" class="flow-btn sm" data-fc-add="90">+90 min</button>' +
        '</div>' +
        '<div class="fc-today" id="fc-today"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    Focus.el = wrap;
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-fc-close]')) { Focus.close(); return; }
      const b = e.target.closest('[data-fc]');
      if (b) { const a = b.getAttribute('data-fc'); if (a === 'start') Focus.start(); else if (a === 'pause') Focus.pause(); else if (a === 'finish') Focus.finish(); return; }
      const add = e.target.closest('[data-fc-add]');
      if (add) { Focus.add(Number(add.getAttribute('data-fc-add')), 'manual'); return; }
      const rm = e.target.closest('[data-fc-rm]');
      if (rm) { Focus.remove(Number(rm.getAttribute('data-fc-rm'))); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) Focus.close(); });
  },
  paint() {
    if (!Focus.el) return;
    const r = Focus.data && Focus.data.run;
    const running = Focus.running();
    Focus.paintClock();
    const st = Focus.el.querySelector('[data-fc="start"]'), pa = Focus.el.querySelector('[data-fc="pause"]'), fi = Focus.el.querySelector('[data-fc="finish"]');
    if (st) { st.textContent = r && r.paused ? 'Resume' : 'Start'; st.hidden = running; }
    if (pa) pa.hidden = !running;
    if (fi) fi.hidden = !r;
    const mine = (Focus.data.sessions || []).filter((x) => x && x.d === today());
    const box = Focus.el.querySelector('#fc-today');
    if (box) box.innerHTML = '<div class="flow-label">Today · ' + Focus.fmt(Focus.todayMin()) + '</div>' +
      (mine.length ? mine.map((x, i) => '<div class="fc-row"><span>' + Focus.fmt(x.min) + '</span><small>' + esc(new Date(x.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) + (x.how === 'manual' ? ' · by hand' : '') + '</small><button type="button" data-fc-rm="' + i + '" aria-label="Remove">×</button></div>').join('')
        : '<p class="flow-sub">No sessions yet today.</p>');
  }
};

const TodayPlus = {
  host(name) { try { return eval(name); } catch (e) { return undefined; } },

  /* ---------- data ---------- */
  recovery() {
    const w = TodayPlus.host('whoopData') || {};
    const sl = TodayPlus.host('slData') || [];
    const t = TodayPlus.host('todayStr') || today();
    let night = null;
    for (let i = sl.length - 1; i >= 0; i--) { if (sl[i] && sl[i].date <= t) { night = sl[i]; break; } }
    return {
      recovery: (w.recovery == null ? null : Number(w.recovery)),
      strain: (w.strain == null ? null : w.strain),
      hrs: night && isFinite(Number(night.hrs)) ? Number(night.hrs) : null,
      last: night ? night.date : null,
      isToday: !!(night && night.date === t)
    };
  },

  priorities() {
    const q = TodayPlus.host('qData');
    const items = (q && Array.isArray(q.items)) ? q.items : [];
    const open = items.filter(i => i && !i.done);
    const q1 = open.filter(i => i.q === 1);
    const q2 = open.filter(i => i.q === 2);
    let overdue = [], flagged = [];
    try {
      const sched = Schedule.scheduled().filter(r => r && !r.done);
      overdue = sched.filter(r => r.date < today());
      /* Anything the user starred in the Planner that hasn't slipped yet — its
         own "priority" line on Today, so a task shows up here without waiting
         to become overdue. */
      flagged = sched.filter(r => r.priority && r.date >= today());
    } catch (e) { overdue = []; flagged = []; }
    return { q1, q2, overdue, flagged, count: q1.length + overdue.length + flagged.length };
  },

  /* Today's calendar, as the tile reads it: how many, and the next one. */
  meetingsTile() {
    const ev = (typeof ConnectApps !== 'undefined' && ConnectApps.cal) || null;
    let mine = []; try { mine = ConnectApps.planned(); } catch (e) {}
    if (!ev && !mine.length) return { v: '—', sub: 'none today' };
    const now = Date.now();
    const hm = (x) => new Date(x).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const upcoming = [].concat(
      (ev || []).filter((e) => !e.allDay && Date.parse(e.end || e.start) > now).map((e) => ({ t: Date.parse(e.start), title: e.title })),
      mine.filter((r) => !r.done && r.time).map((r) => ({ t: Date.parse(today() + 'T' + r.time + ':00'), title: r.text })).filter((x) => x.t > now - 30 * 60000)
    ).sort((a, b) => a.t - b.t);
    const total = (ev || []).length + mine.length;
    if (!total) return { v: '0', sub: 'none today' };
    const next = upcoming[0];
    return { v: String(total), sub: next ? (next.t <= now ? 'now · ' : 'next ') + hm(next.t) : 'done today', tone: next && next.t <= now ? ' warn' : '' };
  },

  /* Today's Big Rocks: the ones planned for this day of this week. */
  progress() {
    try {
      const d = new Date(); d.setHours(12, 0, 0, 0);
      const wid = WeekLoop.wid(d), dow = WeekLoop.dow(d);
      const rocks = ((typeof cData !== 'undefined' && cData && cData.rocks && cData.rocks[wid]) || []).filter((r) => r && r.day === dow);
      return { total: rocks.length, done: rocks.filter((r) => r.done).length };
    } catch (e) { return { total: 0, done: 0 }; }
  },

  habits() {
    const hb = TodayPlus.host('hbData');
    if (!hb || !Array.isArray(hb.habits)) return { list: [], done: 0, total: 0 };
    const t = TodayPlus.host('todayStr') || today();
    const streakFn = TodayPlus.host('hbStreak');
    const list = hb.habits.map(h => ({
      id: h.id, name: h.name,
      done: !!(hb.completions && hb.completions[h.id] && hb.completions[h.id][t]),
      streak: (typeof streakFn === 'function' ? (function () { try { return streakFn(h.id); } catch (e) { return 0; } })() : 0)
    }));
    return { list, done: list.filter(h => h.done).length, total: list.length };
  },

  spend() {
    const fn = TodayPlus.host('fnData');
    const month = TodayPlus.host('NOW_MONTH');
    const t = TodayPlus.host('todayStr') || today();
    const cats = TodayPlus.host('FIN_CATS') || [];
    if (!fn || !fn.monthly || !month) return null;
    const rows = fn.monthly[month] || [];
    const mtd = rows.reduce((s, r) => s + (Number(r.amt) || 0), 0);
    const tod = rows.filter(r => r.date === t).reduce((s, r) => s + (Number(r.amt) || 0), 0);
    let budget = 0;
    try { cats.forEach(c => { budget += Number((fn.budgets || {})[c.id]) || 0; }); } catch (e) {}
    if (!budget) budget = Number(Settings.get('budgetMonthly')) || 0;
    return { today: tod, mtd, budget, count: rows.length };
  },

  /* Their finance UI labels every field in £, so the numbers in this store are
     pounds. Match the host rather than inventing a currency for them. */
  money(n) {
    const v = Number(n) || 0;
    return '£' + (Math.abs(v) >= 1000 ? v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : v.toFixed(v % 1 ? 2 : 0));
  },

  /* The daily entry points use the host's existing forms and save paths.
     Opening a shortcut must never clear a draft or turn an edit into a new
     item. Only a genuinely empty form gets today's date preselected. */
  focusField(id) {
    const field = document.getElementById(id);
    if (!field) return;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center', behavior:
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  },

  /* Plan today: a rock for today, written here, without leaving Today. */
  planSheet() {
    let wrap = document.getElementById('flow-plan');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'flow-plan'; wrap.className = 'fn-sheetwrap';
      wrap.innerHTML =
        '<div class="fn-scrim" data-pl-close="1"></div>' +
        '<div class="fn-sheet" role="dialog" aria-label="Plan today" aria-modal="true">' +
          '<div class="fn-grab" data-pl-close="1"></div>' +
          '<button type="button" class="fn-capture-close" data-pl-close="1" aria-label="Close">×</button>' +
          '<h4>Plan today</h4>' +
          '<div class="fn-sub">One thing that has to happen today, with its time. It goes on today\'s calendar.</div>' +
          '<input class="flow-in" id="pl-title" placeholder="What has to happen today?" maxlength="200" autocomplete="off">' +
          '<div class="pl-row"><input class="flow-in" type="time" id="pl-time"><select class="flow-in" id="pl-prio"><option value="high">Must</option><option value="med" selected>Should</option><option value="low">Could</option></select></div>' +
          '<div class="pl-acts"><button type="button" class="flow-btn primary" data-pl="add">Add to today</button><button type="button" class="flow-btn" data-pl="weekpick">Add to the week ▾</button></div>' +
          '<div class="pl-days" id="pl-days" hidden></div>' +
          '<div class="pl-list" id="pl-list"></div>' +
          '<button type="button" class="pl-link" data-pl="week">Open Week Compass</button>' +
        '</div>';
      document.body.appendChild(wrap);
      /* A thing for today, with a time: it goes on today's calendar — the
         same list the meetings are on — not into the week's Big Rocks. */
      const add = async () => {
        const inp = wrap.querySelector('#pl-title');
        const title = String(inp.value || '').trim();
        if (!title) { inp.focus(); return; }
        const key = 'today::' + uid('t');
        Schedule.put(key, { text: title, tab: 'today', date: today(), time: wrap.querySelector('#pl-time').value || '', dur: Settings.get('defaultDurationMin'), done: false, source: 'today', priority: wrap.querySelector('#pl-prio').value || 'med' });
        try { await Schedule.saveNow(); } catch (e) {}
        try { if (typeof J === 'function') J('planning', '📅 On today: ' + title); } catch (e) {}
        inp.value = ''; wrap.querySelector('#pl-time').value = ''; Typing.mark(wrap.querySelector('#pl-time'));
        try { ConnectApps.calendarPaint(); } catch (e) {}
        TodayPlus.planList();
        toast('On today ✓', null, 1400);
        inp.focus();
      };
      /* Add to the week: pick the day here, and it is a Big Rock on that
         day — the week's list, not today's calendar. */
      const addToWeek = (dow) => {
        const inp = wrap.querySelector('#pl-title');
        const title = String(inp.value || '').trim();
        if (!title) { inp.focus(); return; }
        if (typeof cData === 'undefined' || !cData || typeof cSave !== 'function') { toast('Could not reach your week.', 'err'); return; }
        const d = new Date(); d.setHours(12, 0, 0, 0);
        const wid = WeekLoop.wid(d);
        (cData.rocks[wid] = cData.rocks[wid] || []).push({
          id: Date.now().toString(36) + Math.floor(Math.random() * 1e4), title, role: '', day: dow,
          time: wrap.querySelector('#pl-time').value || '', end: '', prio: wrap.querySelector('#pl-prio').value || 'med', note: '', done: false
        });
        cSave();
        const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        try { if (typeof J === 'function') J('planning', '🪨 Big rock for ' + names[dow] + ': ' + title); } catch (e) {}
        inp.value = ''; wrap.querySelector('#pl-time').value = ''; Typing.mark(wrap.querySelector('#pl-time'));
        wrap.querySelector('#pl-days').hidden = true;
        TodayFix.redraw();
        TodayPlus.planList();
        toast('On ' + names[dow] + ' as a Big Rock ✓', null, 1600);
        inp.focus();
      };
      const paintDays = () => {
        const box = wrap.querySelector('#pl-days');
        const d = new Date(); d.setHours(12, 0, 0, 0);
        const todayDow = WeekLoop.dow(d);
        const mon = new Date(d); mon.setDate(d.getDate() - todayDow);
        box.innerHTML = '<div class="flow-label">Which day this week?</div><div class="pl-daychips">' + [0, 1, 2, 3, 4, 5, 6].map((i) => {
          const x = new Date(mon); x.setDate(mon.getDate() + i);
          return '<button type="button" data-pl-day="' + i + '" class="' + (i === todayDow ? 'today' : i < todayDow ? 'past' : '') + '"><b>' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] + '</b><small>' + x.getDate() + '</small></button>';
        }).join('') + '</div>';
      };
      wrap.addEventListener('click', async (e) => {
        if (e.target.closest('[data-pl-close]')) { wrap.classList.remove('on'); return; }
        const rm = e.target.closest('[data-pl-rm]');
        if (rm) { try { Schedule.remove(rm.getAttribute('data-pl-rm')); await Schedule.saveNow(); } catch (e2) {} try { ConnectApps.calendarPaint(); } catch (e2) {} TodayPlus.planList(); return; }
        const day = e.target.closest('[data-pl-day]');
        if (day) { addToWeek(Number(day.getAttribute('data-pl-day'))); return; }
        const b = e.target.closest('[data-pl]');
        if (!b) return;
        const a = b.getAttribute('data-pl');
        if (a === 'add') add();
        else if (a === 'weekpick') { const box = wrap.querySelector('#pl-days'); if (box.hidden) { paintDays(); box.hidden = false; } else box.hidden = true; }
        else if (a === 'week') { wrap.classList.remove('on'); TodayPlus.openPlan(false); }
      });
      wrap.querySelector('#pl-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) wrap.classList.remove('on'); });
    }
    TodayPlus.planList();
    try { wrap.querySelector('#pl-days').hidden = true; } catch (e) {}
    wrap.classList.add('on');
    setTimeout(() => { try { wrap.querySelector('#pl-title').focus(); } catch (e) {} }, 80);
  },
  planList() {
    const box = document.getElementById('pl-list');
    if (!box) return;
    let items = [];
    try { items = Schedule.onDate(today()).filter((r) => r && r.source === 'today'); } catch (e) {}
    box.innerHTML = '<div class="flow-label">Already on today · ' + items.length + '</div>' +
      (items.length ? items.map((r) => '<div class="pl-item' + (r.done ? ' done' : '') + '"><span data-i18n="off">' + esc(r.text) + '</span>' + (r.time ? '<small>' + esc(r.time) + '</small>' : '') + '<button type="button" class="pl-rm" data-pl-rm="' + esc(r.key) + '" aria-label="Remove">×</button></div>').join('') : '<p class="flow-sub">Nothing yet.</p>');
  },

  /* Review week: the scorecard, what slipped, and the two ways forward. */
  reviewSheet() {
    let wrap = document.getElementById('flow-review');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'flow-review'; wrap.className = 'fn-sheetwrap';
      wrap.innerHTML =
        '<div class="fn-scrim" data-rv-close="1"></div>' +
        '<div class="fn-sheet" role="dialog" aria-label="Review week" aria-modal="true">' +
          '<div class="fn-grab" data-rv-close="1"></div>' +
          '<button type="button" class="fn-capture-close" data-rv-close="1" aria-label="Close">×</button>' +
          '<h4>Review week</h4>' +
          '<div class="fn-sub">What happened this week, and what slipped.</div>' +
          '<div id="rv-score"></div>' +
          '<div id="rv-slipped"></div>' +
          '<div class="pl-acts"><button type="button" class="flow-btn primary" data-rv="ai">🗓 Plan next week with AI</button><button type="button" class="flow-btn ghost" data-rv="week">Open Week Compass</button></div>' +
        '</div>';
      document.body.appendChild(wrap);
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('[data-rv-close]')) { wrap.classList.remove('on'); return; }
        const b = e.target.closest('[data-rv]');
        if (!b) return;
        wrap.classList.remove('on');
        if (b.getAttribute('data-rv') === 'ai') { try { WeekPlan.open(); } catch (e2) { TodayPlus.openPlan(true); } }
        else TodayPlus.openPlan(true);
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) wrap.classList.remove('on'); });
    }
    try {
      const sc = WeekLoop.scorecard(WeekLoop.monday(new Date()));
      wrap.querySelector('#rv-score').innerHTML = WeekLoop.scoreHtml(sc);
    } catch (e) { wrap.querySelector('#rv-score').innerHTML = ''; }
    /* What slipped, week by week: this week first, then last week, then
       the weeks before — each one named, so what fell off three weeks ago
       is not mixed in with what fell off yesterday. */
    let slipped = [];
    let wid = '';
    try {
      const now = new Date(); now.setHours(12, 0, 0, 0);
      const dow = WeekLoop.dow(now); wid = WeekLoop.wid(now);
      Object.keys(cData.rocks || {}).forEach((w) => (cData.rocks[w] || []).forEach((r) => {
        if (!r || r.done) return;
        if (w < wid || (w === wid && r.day < dow)) slipped.push(Object.assign({ w }, r));
      }));
    } catch (e) {}
    slipped.sort((a, b) => (b.w > a.w ? 1 : b.w < a.w ? -1 : 0) || (b.day - a.day));
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekLabel = (w) => {
      if (w === wid) return 'This week';
      const m = /^(\d{4})-W(\d{2})$/.exec(w); if (!m) return w;
      const nowM = /^(\d{4})-W(\d{2})$/.exec(wid);
      const back = nowM && nowM[1] === m[1] ? Number(nowM[2]) - Number(m[2]) : null;
      return (back === 1 ? 'Last week' : back != null && back > 1 ? back + ' weeks ago' : 'Earlier') + ' · W' + m[2];
    };
    const groups = [];
    slipped.forEach((r) => { let g = groups[groups.length - 1]; if (!g || g.w !== r.w) { g = { w: r.w, items: [] }; groups.push(g); } g.items.push(r); });
    wrap.querySelector('#rv-slipped').innerHTML = '<div class="flow-row between" style="margin-top:12px;align-items:center"><div class="flow-label">Slipped · ' + slipped.length + (groups.length > 1 ? ' · ' + groups.length + ' weeks' : '') + '</div>' +
      (slipped.length >= 2 ? '<button type="button" class="td-dropall" data-rv-dropall="1">Drop all (' + slipped.length + ')</button>' : '') + '</div>' +
      (slipped.length ? groups.map((g) => '<div class="rv-week">' + esc(weekLabel(g.w)) + ' <span>' + g.items.length + '</span></div>' + g.items.map((r) =>
          '<div class="pl-item rv-item" data-rv-id="' + esc(String(r.id)) + '"><div class="rv-main"><span data-i18n="off">' + esc(r.title) + '</span><small>' + names[r.day] + (r.time ? ' ' + esc(r.time) : '') + '</small></div>' +
          '<div class="td-fix"><button type="button" data-rv-fix="today">Today</button><button type="button" data-rv-fix="tomorrow">Tomorrow</button><button type="button" data-rv-fix="done">Done</button><button type="button" data-rv-fix="drop" class="ghost">Drop</button></div></div>').join('')).join('')
        : '<p class="flow-sub">Nothing slipped. Good week.</p>');
    if (!wrap.__rvFix) {
      wrap.__rvFix = 1;
      wrap.addEventListener('click', (e) => {
        const all = e.target.closest('[data-rv-dropall]');
        if (all) {
          const ids = Array.from(wrap.querySelectorAll('[data-rv-id]')).map((x) => x.getAttribute('data-rv-id'));
          if (!ids.length || !confirm('Drop all ' + ids.length + ' slipped Big Rocks? They are not marked done; the journal keeps a line for each.')) return;
          ids.forEach((id) => { const hit = TodayFix.find(id); if (!hit) return; cData.rocks[hit.w] = cData.rocks[hit.w].filter((x) => x !== hit.r); if (!cData.rocks[hit.w].length) delete cData.rocks[hit.w]; try { if (typeof J === 'function') J('planning', '🗑️ Big rock dropped: ' + hit.r.title); } catch (e2) {} });
          cSave(); TodayFix.redraw(); TodayPlus.reviewSheet(); return;
        }
        const b = e.target.closest('[data-rv-fix]');
        if (!b) return;
        e.preventDefault(); e.stopPropagation();
        const id = b.closest('[data-rv-id]').getAttribute('data-rv-id');
        const what = b.getAttribute('data-rv-fix');
        const d = new Date(); d.setHours(12, 0, 0, 0);
        if (what === 'tomorrow') d.setDate(d.getDate() + 1);
        if (what === 'done') TodayFix.done(id);
        else if (what === 'drop') TodayFix.drop(id);
        else TodayFix.move(id, d);
        TodayPlus.reviewSheet();
      });
    }
    wrap.classList.add('on');
  },

  openPlan(review) {
    const title = document.getElementById('rkTitle');
    const note = document.getElementById('rkNote');
    const date = document.getElementById('rkDay');
    const hasDraft = !!TodayPlus.host('cEditRockId') ||
      !!(title && title.value.trim()) || !!(note && note.value.trim()) ||
      !!(date && date.value && date.value !== '-1');
    if (!Nav.go('compass')) return;
    const currentWeek = document.getElementById('wkToday');
    /* Unscheduled entries belong to the week on screen. Keep that context
       with a draft or edit, otherwise saving would silently move the rock. */
    if (currentWeek && !hasDraft) currentWeek.click();
    if (!review && !hasDraft && date && Array.from(date.options).some(o => o.value === today())) {
      date.value = today();
      date.dispatchEvent(new Event('change', { bubbles: true }));
    }
    TodayPlus.focusField(review ? 'wkReview' : 'rkTitle');
  },

  /* ---------- build ---------- */
  apply() {
    const feed = document.getElementById('today-feed');
    if (!feed || !feed.children.length) return;
    $$('.flow-td', feed).forEach(n => n.remove());

    /* The header showed only the ISO week. The quarter is the unit business
       planning actually runs on, so show both. */
    const wk = $('.td-wk', feed);
    if (wk) {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3) + 1;
      const week = (wk.textContent.match(/\d+/) || [''])[0];
      wk.textContent = 'Q' + q + (week ? ' · WK ' + week : '');
    }

    /* A steady line for the big "Today", set in an italic serif so it reads as
       a mantra rather than UI. On a phone it sits as its own clean block under
       the title, left-aligned with it (no indent); on a wide screen it tucks
       in beside the title. Re-added each render since the host rebuilds the
       header. */
    const title = $('.td-head .td-title', feed);
    if (title && title.parentElement) {
      const text = String(Settings.get('todayQuote') || '').trim();
      const by = String(Settings.get('todayQuoteBy') || '').trim();
      let quote = title.parentElement.querySelector('.flow-td-quote');

      /* Blank means blank. Somebody who clears the field wants no quote, not
         the default back — there would be no other way to say so. */
      if (!text) {
        if (quote) quote.remove();
      } else {
        const narrow = (window.innerWidth || 999) < 640;
        if (!narrow) { title.style.display = 'inline-block'; title.style.verticalAlign = 'baseline'; }
        if (!quote) {
          quote = document.createElement('div');
          quote.className = 'flow-td-quote';
          title.insertAdjacentElement('afterend', quote);
        }
        quote.style.cssText = narrow
          ? 'display:block;margin:12px 0 2px;max-width:560px'
          : 'display:inline-block;vertical-align:baseline;margin-left:16px;max-width:540px';
        const qs = narrow ? '14px' : '15px';
        /* data-i18n="off" throughout: this is the person's own line, and the
           translator must never rewrite what somebody wrote. */
        quote.innerHTML =
          '<span data-i18n="off" style="font-family:Georgia,serif;font-style:italic;font-size:' + qs + ';line-height:1.5;color:var(--muted)">“' + esc(text) + '”</span>' +
          (by ? '<span data-i18n="off" style="display:block;font-family:Georgia,serif;font-size:11px;letter-spacing:.4px;color:var(--muted);opacity:.7;margin-top:4px">— ' + esc(by) + '</span>' : '');
      }
    }

    const rec = TodayPlus.recovery();
    const pri = TodayPlus.priorities();
    const hab = TodayPlus.habits();
    const sp = TodayPlus.spend();

    /* — pulse strip — the four tiles, as they have always read. */
    const recTxt = rec.recovery != null ? rec.recovery + '%' : (rec.hrs != null ? rec.hrs.toFixed(1) + 'h' : '—');
    const recSub = rec.recovery != null
      ? (rec.hrs != null ? rec.hrs.toFixed(1) + 'h sleep' : 'recovery')
      : (rec.hrs != null ? (rec.isToday ? 'last night' : 'last logged') : 'nothing logged');
    const recTone = rec.recovery == null ? '' : (rec.recovery >= 67 ? ' good' : rec.recovery >= 34 ? ' warn' : ' bad');

    const strip = document.createElement('div');
    strip.className = 'flow-td flow-td-pulse flow-x';
    /* Same four places, same type, same colours; two of the names changed:
       Meetings where Priorities was, Focus where Habits was. */
    const mt = TodayPlus.meetingsTile();
    let fmin = 0, frun = false; try { fmin = Focus.todayMin(); frun = Focus.running(); } catch (e) {}
    strip.innerHTML = [
      ['recovery', 'Recovery', recTxt, recSub, recTone],
      ['meetings', 'Meetings', mt.v, mt.sub, mt.tone || ''],
      ['focus', 'Focus', fmin ? Focus.fmt(fmin) : '—', frun ? '● running' : (fmin ? 'logged today' : 'none logged'), frun ? ' good' : ''],
      ['spend', 'Spend', sp ? TodayPlus.money(sp.today) : '—', sp ? TodayPlus.money(sp.mtd) + ' this month' : 'nothing logged', '']
    ].map(([k, lbl, v, sub, tone]) =>
      `<button class="flow-td-tile${tone}" data-jump="${k}">
         <span class="l">${lbl}</span><span class="v">${esc(v)}</span><span class="s">${esc(sub)}</span>
       </button>`).join('');

    const head = $('.td-head', feed);
    if (head && head.nextSibling) feed.insertBefore(strip, head.nextSibling); else feed.insertBefore(strip, feed.firstChild);

    const actions = document.createElement('div');
    actions.className = 'flow-td flow-today-actions flow-x';
    actions.innerHTML =
      '<button type="button" class="flow-today-primary" data-flow-today-action="plan">' + Nav.svg('plus') + '<span>Plan today</span></button>' +
      '<button type="button" data-flow-today-action="capture">' + Nav.svg('plus') + '<span>Quick add</span></button>' +
      '<button type="button" data-flow-today-action="review">' + Nav.svg('compass') + '<span>Review week</span></button>';
    if (head) head.insertAdjacentElement('afterend', actions);
    else feed.insertBefore(actions, feed.firstChild);

    /* — priorities — */
    const pblock = document.createElement('div');
    pblock.className = 'flow-td flow-td-sec flow-x';
    pblock.id = 'flow-td-priorities';
    const prow = (txt, meta, cls, id) =>
      `<div class="flow-td-row${cls || ''}">${id ?
        `<button type="button" class="flow-today-check" role="checkbox" aria-checked="false" data-q="${esc(id)}" aria-label="Complete priority: ${esc(txt)}"><span class="bx" aria-hidden="true"></span></button>` : ''}
        <span class="tx" data-i18n="off">${linkifyText(txt)}</span>${meta ? `<span class="mt">${esc(meta)}</span>` : ''}</div>`;
    const pbody = [
      ...pri.overdue.slice(0, 4).map(r => prow(r.text, 'overdue · ' + prettyDate(r.date), ' od')),
      ...(pri.flagged || []).slice(0, 5).map(r => prow(r.text, 'priority · ' + (r.date === today() ? 'today' : prettyDate(r.date)), '')),
      ...pri.q1.slice(0, 4).map(i => prow(i.txt, 'Q1 · urgent', '', i.id)),
      ...pri.q2.slice(0, 3).map(i => prow(i.txt, 'Q2', '', i.id))
    ].join('');
    pblock.innerHTML =
      `<div class="flow-td-head"><span class="l">Priorities</span><span class="c">${pri.q1.length + pri.q2.length + (pri.flagged || []).length} open</span></div>` +
      (pbody || `<div class="flow-td-empty">Nothing open in Q1 or Q2. Star a Planner task or add them in 🎯 Priorities.<button type="button" class="flow-empty-action" data-flow-today-action="priority">Add a priority</button></div>`);
    const rocks = $('.td-rocks', feed);
    if (rocks && rocks.nextSibling) feed.insertBefore(pblock, rocks.nextSibling); else feed.appendChild(pblock);
    const emptyRocks = rocks && $('.td-rocks-empty', rocks);
    if (emptyRocks && !$('.flow-empty-action', emptyRocks)) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'flow-empty-action';
      add.setAttribute('data-flow-today-action', 'plan');
      add.textContent = 'Add your first Big Rock';
      emptyRocks.appendChild(add);
    }

    /* — habits — */
    const hblock = document.createElement('div');
    hblock.className = 'flow-td flow-td-sec flow-x';
    hblock.id = 'flow-td-habits';
    hblock.innerHTML =
      `<div class="flow-td-head"><span class="l">Habits</span><span class="c${hab.total && hab.done === hab.total ? ' ok' : ''}">${hab.done} / ${hab.total}</span></div>` +
      (hab.list.length
        ? hab.list.map(h =>
            `<div class="flow-td-row hb${h.done ? ' done' : ''}">
               <button type="button" class="flow-today-check" role="checkbox" aria-checked="${h.done ? 'true' : 'false'}" data-hb="${esc(h.id)}" aria-label="${h.done ? 'Uncheck habit' : 'Complete habit'}: ${esc(h.name)}"><span class="bx" aria-hidden="true">${h.done ? '✓' : ''}</span></button>
               <span class="tx" data-i18n="off">${esc(h.name)}</span>
               ${h.streak > 0 ? `<span class="mt">🔥 ${h.streak}</span>` : ''}
             </div>`).join('')
        : `<div class="flow-td-empty">No habits yet. Add them in ✅ Habits and they show up here.</div>`);

    const groups = $$('.td-group', feed);
    const trainGroup = groups.find(g => /train/i.test((($('.g-lbl', g) || {}).textContent) || ''));
    if (trainGroup && trainGroup.nextSibling) feed.insertBefore(hblock, trainGroup.nextSibling);
    else feed.appendChild(hblock);

    /* — spend — */
    if (sp) {
      const pct = sp.budget ? Math.min(100, Math.round(sp.mtd / sp.budget * 100)) : 0;
      const over = sp.budget && sp.mtd > sp.budget;
      const sblock = document.createElement('div');
      sblock.className = 'flow-td flow-td-sec flow-x';
      sblock.id = 'flow-td-spend';
      sblock.innerHTML =
        `<div class="flow-td-head"><span class="l">Spend</span><span class="c${over ? ' bad' : ''}">${esc(TodayPlus.money(sp.mtd))}${sp.budget ? ' / ' + esc(TodayPlus.money(sp.budget)) : ''}</span></div>` +
        `<div class="flow-td-row"><span class="tx">Today</span><span class="mt">${esc(TodayPlus.money(sp.today))}</span></div>` +
        (sp.budget
          ? `<div class="flow-td-bar"><i style="width:${pct}%" class="${over ? 'over' : ''}"></i></div>
             <div class="flow-td-note">${over ? 'Over budget by ' + esc(TodayPlus.money(sp.mtd - sp.budget)) : esc(TodayPlus.money(sp.budget - sp.mtd)) + ' left this month'}</div>`
          : `<div class="flow-td-note">Set category budgets in 💰 Finances to track this against a limit.</div>`);
      feed.appendChild(sblock);
    }

    TodayPlus.bind(feed);
  },

  bind(feed) {
    if (feed.__flowTdBound) return;
    feed.__flowTdBound = 1;
    feed.addEventListener('click', (e) => {
      const action = e.target.closest('[data-flow-today-action]');
      if (action) {
        const kind = action.getAttribute('data-flow-today-action');
        if (kind === 'plan') TodayPlus.planSheet();
        else if (kind === 'review') TodayPlus.reviewSheet();
        else if (kind === 'capture') Nav.openCapture();
        else if (kind === 'priority' && Nav.go('quad')) TodayPlus.focusField('qin2');
        return;
      }
      const jump = e.target.closest('[data-jump]');
      if (jump) {
        const destination = jump.getAttribute('data-jump');
        if (destination === 'recovery' || destination === 'sleep') { Nav.go('sleep'); return; }
        if (destination === 'focus') { Focus.open(); return; }
        if (destination === 'meetings') {
          const cal = feed.querySelector('#td-cal');
          if (cal) cal.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          else Nav.go('settings');
          return;
        }
        if (destination === 'progress') {
          const rocks = feed.querySelector('.td-rocks');
          if (!TodayPlus.progress().total) { TodayPlus.planSheet(); return; }
          if (rocks) rocks.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          return;
        }
        const id = { priorities: 'flow-td-priorities', habits: 'flow-td-habits', spend: 'flow-td-spend' }[destination];
        const el = id && document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        return;
      }

      const hb = e.target.closest('[data-hb]');
      if (hb) {
        const restoreFocus = document.activeElement === hb;
        const id = hb.getAttribute('data-hb');
        const data = TodayPlus.host('hbData');
        const S_ = TodayPlus.host('S');
        const t = TodayPlus.host('todayStr') || today();
        if (!data || !S_) return;
        data.completions = data.completions || {};
        data.completions[id] = data.completions[id] || {};
        const nowDone = !data.completions[id][t];
        if (nowDone) {
          data.completions[id][t] = true;
          const h = (data.habits || []).find(x => x.id === id);
          const J_ = TodayPlus.host('J');
          if (typeof J_ === 'function' && h) { try { J_('habits', '✅ ' + h.name); } catch (x) {} }
        } else delete data.completions[id][t];
        S_.set('habits', data);
        const rh = TodayPlus.host('renderHabits');
        if (typeof rh === 'function') { try { rh(); } catch (x) {} }
        if (typeof window.renderToday === 'function') window.renderToday();
        if (restoreFocus) {
          const next = Array.from(feed.querySelectorAll('button[data-hb]')).find(b => b.getAttribute('data-hb') === id);
          if (next) next.focus({ preventScroll: true });
        }
        return;
      }

      const qr = e.target.closest('[data-q]');
      if (qr && !hitLink(e)) {
        const restoreFocus = document.activeElement === qr;
        const index = Array.from(feed.querySelectorAll('button[data-q]')).indexOf(qr);
        const id = qr.getAttribute('data-q');
        const q = TodayPlus.host('qData');
        const qs = TodayPlus.host('qSave');
        if (!q || typeof qs !== 'function') return;
        const it = (q.items || []).find(x => x.id === id);
        if (!it) return;
        it.done = !it.done;
        qs();
        const rq = TodayPlus.host('renderQuad');
        if (typeof rq === 'function') { try { rq(); } catch (x) {} }
        if (typeof window.renderToday === 'function') window.renderToday();
        if (restoreFocus) {
          const remaining = Array.from(feed.querySelectorAll('button[data-q]'));
          const next = remaining[Math.min(index, remaining.length - 1)] ||
            feed.querySelector('[data-flow-today-action="priority"]') ||
            feed.querySelector('[data-flow-today-action="plan"]');
          if (next) next.focus({ preventScroll: true });
        }
      }
    });
  }
};

/* =========================================================================
 * 20b · Compass Plus — scheduled tasks on the Week Compass, and a calendar
 *       export for them.
 *
 * The host's Week Compass day cards already show training, meals and big
 * rocks. This wraps the host renderCompass() and, once it has painted #cGrid,
 * drops the pack's own Schedule entries (anything you gave a date — Planner
 * tasks and items time-blocked from any tab) onto the matching day as chips,
 * so you can see what you planned for each day and at what time. It also adds
 * a one-click "send these to my calendar" control to the host's own export
 * panel, reusing the pack's tested Calendar exporter.
 * ====================================================================== */
const CompassPlus = {
  host(name) { try { return eval(name); } catch (e) { return undefined; } },

  /* Local YYYY-MM-DD for a Date, matching the host's own localISO. */
  iso(d) {
    const f = CompassPlus.host('localISO');
    if (typeof f === 'function') { try { return f(d); } catch (e) {} }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  },

  apply() {
    const grid = document.getElementById('cGrid');
    if (!grid || !grid.children.length) return;
    grid.setAttribute('role', 'region');
    grid.setAttribute('aria-label', 'Week calendar');
    grid.setAttribute('tabindex', '0');
    let hint = document.getElementById('flow-week-scrollhint');
    if (!hint) {
      hint = document.createElement('p');
      hint.id = 'flow-week-scrollhint';
      hint.className = 'flow-week-scrollhint';
      hint.textContent = 'Scroll to see all seven days.';
      hint.hidden = true;
      grid.insertAdjacentElement('afterend', hint);
      grid.setAttribute('aria-describedby', hint.id);
    }
    const updateHint = () => { hint.hidden = grid.scrollWidth <= grid.clientWidth + 1; };
    if (!grid.__flowWeekResize) {
      grid.__flowWeekResize = true;
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateHint).observe(grid);
      else window.addEventListener('resize', updateHint);
    }
    requestAnimationFrame(updateHint);
    grid.querySelectorAll('.flow-cchip').forEach(n => n.remove());

    let dates;
    try { dates = CompassPlus.host('cWeekDates')(); } catch (e) { return; }
    if (!Array.isArray(dates) || !dates.length) return;

    const cells = Array.from(grid.children);
    dates.forEach((d, i) => {
      const cell = cells[i];
      if (!cell) return;
      const iso = CompassPlus.iso(d);
      let items = [];
      try { items = Schedule.onDate(iso); } catch (e) { items = []; }
      items
        .slice()
        .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
        .forEach(r => {
          const chip = document.createElement('div');
          chip.className = 'chip flow-cchip' + (r.done ? ' done' : '');
          chip.setAttribute('data-k', r.key);
          chip.title = (Rollup.labelFor(r.tab) || r.tab || 'task') + ' — click to toggle done';
          chip.style.cssText = 'background:#123a3d;color:#5eead4;cursor:pointer;border:1px solid transparent;' + (r.done ? 'opacity:.45;text-decoration:line-through;' : '');
          chip.textContent = '📌 ' + (r.time ? r.time + ' ' : '') + r.text;
          cell.appendChild(chip);
        });
    });

    grid.querySelectorAll('.flow-cchip').forEach(ch => {
      ch.addEventListener('click', async () => {
        const k = ch.getAttribute('data-k');
        const cur = Schedule.get(k);
        if (!cur) return;
        Schedule.put(k, { done: !cur.done });
        try { await Schedule.saveNow(); } catch (e) {}
        try { TimeChips.repaintAll(); } catch (e) {}
        const rc = CompassPlus.host('renderCompass');
        if (typeof rc === 'function') rc(); else CompassPlus.apply();
      });
    });
  },

  RANGE: { '1': 'week', '2': '2weeks', '4': '4weeks', '8': '12weeks', '12': '12weeks' },
  range() { return CompassPlus.RANGE[(document.getElementById('icsRange') || {}).value] || '4weeks'; },

  /* The pack used to bolt a whole second export row onto the host's panel —
     its own label, its own two buttons, no way to tell from the outside how
     they related to the button above them. Three buttons for one job. Now the
     scheduled tasks are simply another line in the same list, they ride along
     in the same file, and the one thing a file cannot do — push straight into
     Google over the API — is the only separate control left. */
  injectExport() {
    const list = document.getElementById('icsPick');
    if (!list || document.getElementById('icsTasks')) return;

    const label = document.createElement('label');
    label.className = 'ics-opt';
    label.innerHTML = '<input type="checkbox" id="icsTasks" checked> 📌 Scheduled tasks';
    label.title = 'Anything you gave a date and a time — Planner rows and items time-blocked from any tab';
    list.appendChild(label);

    const ticked = () => { const b = document.getElementById('icsTasks'); return !!(b && b.checked); };
    const provider = (weeks) => {
      if (!ticked()) return null;
      const key = String(weeks);
      const recs = Calendar.rangeRecords(CompassPlus.RANGE[key] || '4weeks');
      if (!recs.length) return null;
      const opts = { defaultDuration: Settings.get('defaultDurationMin') };
      return {
        text: recs.map(r => ICS.event(r, opts).join('\r\n')).join('\r\n'),
        n: recs.length, label: 'scheduled tasks', one: 'scheduled task'
      };
    };
    provider.ticked = ticked;
    window.icsExtras = window.icsExtras || [];
    window.icsExtras.push(provider);

  },

  install() {
    try { CompassPlus.injectExport(); } catch (e) {}
    if (typeof window.renderCompass === 'function' && !window.renderCompass.__flowWrapped) {
      const original = window.renderCompass;
      const wrapped = function () {
        const r = original.apply(this, arguments);
        try { CompassPlus.apply(); } catch (e) { console.warn('[Flow] compass plus', e); }
        try { CompassPlus.injectExport(); } catch (e) {}
        return r;
      };
      wrapped.__flowWrapped = 1;
      window.renderCompass = wrapped;
    }
    try { CompassPlus.apply(); } catch (e) {}
  }
};

/* =========================================================================
 * 20c · Diet Plan — make the Diet tab's "Program" block a real, editable,
 *       saved meal plan instead of a dead placeholder.
 *
 * The host ships a static "No meal plan yet" note there and never wires it to
 * anything. This replaces that block with your own plan: free text (meals,
 * timing, macros — whatever you want), stored per-account through the pack's
 * own DB so it syncs like everything else, with an inline edit/save editor.
 * ====================================================================== */
const DietPlan = {
  KEY: 'flow:dietProgram',
  text: '',
  editing: false,

  async mount() {
    const host = $('.mealcards', dietRoot());
    if (!host || host.__flowDietMounted) return;
    host.__flowDietMounted = 1;
    try {
      const v = await DB.get(DietPlan.KEY, null);
      DietPlan.text = (v && typeof v === 'object' && typeof v.text === 'string') ? v.text
        : (typeof v === 'string' ? v : '');
    } catch (e) { DietPlan.text = ''; }
    DietPlan.render(host);
  },

  render(host) {
    if (DietPlan.editing) {
      host.innerHTML =
        '<div class="flow-x">' +
        '<textarea class="flow-in" data-diet-edit style="width:100%;min-height:220px;line-height:1.7;font-size:14px;resize:vertical" ' +
        'placeholder="Write your meal plan — e.g.&#10;Öğün 1 (09:00) — 4 eggs, oats, banana&#10;Öğün 2 (13:00) — chicken, rice, salad&#10;Öğün 3 (18:00) — salmon, potatoes, greens">' +
        esc(DietPlan.text) + '</textarea>' +
        '<div class="flow-row" style="gap:8px;margin-top:10px">' +
        '<button class="flow-btn primary" data-diet-save>Save plan</button>' +
        '<button class="flow-btn ghost" data-diet-cancel>Cancel</button>' +
        '</div></div>';
      const ta = host.querySelector('[data-diet-edit]');
      if (ta) { ta.focus(); }
      host.querySelector('[data-diet-save]').addEventListener('click', async () => {
        DietPlan.text = ta ? ta.value : DietPlan.text;
        try { await DB.set(DietPlan.KEY, { text: DietPlan.text }); } catch (e) {}
        DietPlan.editing = false;
        DietPlan.render(host);
        try { toast('Meal plan saved ✓'); } catch (e) {}
      });
      host.querySelector('[data-diet-cancel]').addEventListener('click', () => {
        DietPlan.editing = false; DietPlan.render(host);
      });
      return;
    }

    const has = DietPlan.text && DietPlan.text.trim();
    host.innerHTML =
      '<div class="flow-x">' +
      (has
        ? '<div class="flow-card" style="white-space:pre-wrap;line-height:1.7;font-size:14px">' + esc(DietPlan.text) + '</div>'
        : '<div class="flow-empty" style="padding:18px 0">No meal plan yet — write your own program here (meals, timing, macros), or just use the daily checklist above.</div>') +
      '<div class="flow-row" style="margin-top:10px">' +
      '<button class="flow-btn ' + (has ? '' : 'primary') + '" data-diet-editbtn>' + (has ? '✏️ Edit plan' : '✍️ Write my meal plan') + '</button>' +
      '</div></div>';
    host.querySelector('[data-diet-editbtn]').addEventListener('click', () => {
      DietPlan.editing = true; DietPlan.render(host);
    });
  }
};

/* =========================================================================
 * 20d · Shared tasks — collaborate on individual tasks with other accounts.
 *
 * A task you share becomes a live item: a link anyone signed in can open to
 * join, plus invite-by-account-email. Every member can edit the text, move the
 * status and comment; the owner can delete, members can leave. Talks to the
 * /api/shared/* routes and shows as a panel in Work and Side Project.
 * ====================================================================== */
const Shared = {
  items: [],
  async list() {
    try {
      const r = await fetch('/api/shared/list', { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json().catch(() => null);
      Shared.items = (j && j.items) || [];
    } catch (e) { Shared.items = []; }
    return Shared.items;
  },
  async call(path, body) {
    const r = await fetch('/api/shared/' + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  },
  linkFor(token) { return location.origin + '/?shared=' + token; },
  upsert(task) {
    if (!task || !task.token) return;
    const i = Shared.items.findIndex(x => x.token === task.token);
    if (i >= 0) Shared.items[i] = task; else Shared.items.unshift(task);
  },
  drop(token) { Shared.items = Shared.items.filter(x => x.token !== token); }
};

const SharedUI = {
  mounted: [],
  STATUS: [['todo', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']],
  when(iso) { try { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } },

  async install() {
    /* Opening a share link joins the task, then cleans the URL. */
    try {
      const tok = new URLSearchParams(location.search).get('shared');
      if (tok) {
        try { const j = await Shared.call('join', { token: tok }); Shared.upsert(j.task); toast('You joined a shared task ✓'); }
        catch (e) { toast(e.message || 'Could not open that shared task.', 'warn'); }
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }
    } catch (e) {}
    if (!(window.Auth && Auth.user)) return;   /* sharing needs an account */
    await Shared.list();
    SharedUI.mountInto('tab-abko', 'abko');
    SharedUI.mountInto('tab-dtc', 'dtc');
  },

  mountInto(sectionId, ws) {
    const sec = document.getElementById(sectionId);
    if (!sec || sec.querySelector('[data-flow-shared]')) return;
    const panel = document.createElement('div');
    panel.className = 'panel flow-x';
    panel.setAttribute('data-flow-shared', ws);
    panel.style.marginTop = '18px';
    sec.appendChild(panel);
    SharedUI.mounted.push({ el: panel, ws });
    SharedUI.renderPanel(panel, ws);
  },

  renderAll() { SharedUI.mounted.forEach(m => { if (document.body.contains(m.el)) SharedUI.renderPanel(m.el, m.ws); }); },

  card(t) {
    const me = (window.Auth && Auth.user) ? Auth.user.id : null;
    const owner = t.ownerId === me;
    const ownerName = ((t.members || []).find(m => m && m.owner) || {}).name || 'someone';
    const opts = SharedUI.STATUS.map(([v, l]) => `<option value="${v}"${t.status === v ? ' selected' : ''}>${l}</option>`).join('');
    const comments = (t.comments || []).map(c =>
      `<div style="padding:6px 0;border-top:1px solid var(--border)"><b style="font-size:12px">${esc(c.byName)}</b> <span style="font-size:11px;color:var(--muted)">${esc(SharedUI.when(c.at))}</span><div style="font-size:13px;white-space:pre-wrap;margin-top:2px">${esc(c.text)}</div></div>`
    ).join('') || '<div style="font-size:12px;color:var(--muted);padding:4px 0">No comments yet.</div>';
    return `<div class="flow-shared-card" data-token="${esc(t.token)}" style="border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:12px;background:var(--card2)">
      <div class="flow-row" style="gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <input class="flow-in" data-stitle style="flex:1;min-width:150px;font-size:15px;font-weight:700" value="${esc(t.title)}">
        <select class="flow-in" data-sstatus style="width:140px">${opts}</select>
      </div>
      <div style="font-size:11px;color:var(--muted);margin:6px 0 8px">Shared by ${esc(ownerName)}${owner ? ' (you)' : ''} · ${(t.members || []).length} ${(t.members || []).length === 1 ? 'person' : 'people'} · updated ${esc(SharedUI.when(t.updatedAt))}</div>
      <textarea class="flow-in" data-snotes placeholder="Details / notes…" style="width:100%;min-height:60px;font-size:13px;line-height:1.5">${esc(t.notes || '')}</textarea>
      <div class="flow-row" style="gap:6px;flex-wrap:wrap;margin:8px 0">
        <button class="flow-btn" data-scopy>🔗 Copy link</button>
        <input class="flow-in" data-sinvite placeholder="invite by email" style="width:180px">
        <button class="flow-btn" data-sinvitesend>Invite</button>
        <span style="flex:1"></span>
        ${owner ? '<button class="flow-btn ghost" data-sdelete>Delete</button>' : '<button class="flow-btn ghost" data-sleave>Leave</button>'}
      </div>
      <div style="margin-top:6px">${comments}</div>
      <div class="flow-row" style="gap:6px;margin-top:8px">
        <input class="flow-in grow" data-scomment placeholder="Add a comment…">
        <button class="flow-btn primary" data-scommentsend>Comment</button>
      </div>
    </div>`;
  },

  renderPanel(panel, ws) {
    const mine = Shared.items.filter(t => (t.ws || 'abko') === ws);
    panel.innerHTML =
      '<h3>🤝 Shared tasks <span style="color:var(--muted);font-weight:400;font-size:12px">(collaborate by link or invite — edit, status &amp; comments)</span></h3>' +
      '<div class="flow-row" style="gap:6px;flex-wrap:wrap;margin:10px 0 14px">' +
      '<input class="flow-in grow" data-snew placeholder="Share a new task with someone…">' +
      '<button class="flow-btn primary" data-snewsend>Share task</button></div>' +
      (mine.length ? mine.map(t => SharedUI.card(t)).join('')
        : '<p class="flow-empty">Nothing shared yet. Type a task above and share it — you get a link to send, or invite by email.</p>');

    const reload = () => SharedUI.renderAll();
    const guard = async (fn) => { try { await fn(); } catch (e) { toast(e.message || 'Something went wrong.', 'err'); } };

    const newBtn = panel.querySelector('[data-snewsend]');
    if (newBtn) newBtn.addEventListener('click', () => guard(async () => {
      const inp = panel.querySelector('[data-snew]');
      const title = norm(inp.value);
      if (!title) { toast('Type a task first.', 'warn'); return; }
      const j = await Shared.call('create', { ws, title });
      Shared.upsert(j.task); inp.value = '';
      reload();
      try { await navigator.clipboard.writeText(Shared.linkFor(j.task.token)); toast('Shared ✓ link copied'); }
      catch (e) { toast('Shared ✓'); }
    }));

    panel.querySelectorAll('.flow-shared-card').forEach(card => {
      const token = card.getAttribute('data-token');
      const titleEl = card.querySelector('[data-stitle]');
      if (titleEl) titleEl.addEventListener('change', () => guard(async () => { const j = await Shared.call('update', { token, patch: { title: titleEl.value } }); Shared.upsert(j.task); }));
      const notesEl = card.querySelector('[data-snotes]');
      if (notesEl) notesEl.addEventListener('change', () => guard(async () => { const j = await Shared.call('update', { token, patch: { notes: notesEl.value } }); Shared.upsert(j.task); }));
      const statusEl = card.querySelector('[data-sstatus]');
      if (statusEl) statusEl.addEventListener('change', () => guard(async () => { const j = await Shared.call('update', { token, patch: { status: statusEl.value } }); Shared.upsert(j.task); reload(); }));
      const copyEl = card.querySelector('[data-scopy]');
      if (copyEl) copyEl.addEventListener('click', () => guard(async () => { try { await navigator.clipboard.writeText(Shared.linkFor(token)); toast('Link copied ✓'); } catch (e) { toast(Shared.linkFor(token)); } }));
      const invSend = card.querySelector('[data-sinvitesend]');
      if (invSend) invSend.addEventListener('click', () => guard(async () => {
        const inp = card.querySelector('[data-sinvite]'); const to = norm(inp.value);
        if (!to) { toast('Type an email.', 'warn'); return; }
        const j = await Shared.call('invite', { token, to }); Shared.upsert(j.task); inp.value = '';
        reload(); toast('Invited ' + j.to + ' ✓');
      }));
      const del = card.querySelector('[data-sdelete]');
      if (del) del.addEventListener('click', () => guard(async () => { await Shared.call('delete', { token }); Shared.drop(token); reload(); toast('Deleted'); }));
      const leave = card.querySelector('[data-sleave]');
      if (leave) leave.addEventListener('click', () => guard(async () => { await Shared.call('delete', { token }); Shared.drop(token); reload(); toast('Left the task'); }));
      const cSend = card.querySelector('[data-scommentsend]');
      if (cSend) cSend.addEventListener('click', () => guard(async () => {
        const inp = card.querySelector('[data-scomment]'); const text = norm(inp.value);
        if (!text) return;
        const j = await Shared.call('comment', { token, text }); Shared.upsert(j.task); inp.value = '';
        reload();
      }));
    });
  }
};

/* =========================================================================
 * 21 · Accounts
 *
 * Talks to the optional server module (flow-auth.js). If that module is not
 * installed, /api/auth/me is simply not a route — the check fails quietly and
 * the app behaves exactly as it always has. So this is safe to ship before
 * the server change, and the server change is safe to ship after it.
 * ====================================================================== */
const Auth = {
  user: null,
  seed: null,          /* 'legacy' | 'template' — decided by the server at signup */
  installed: false,
  /* Guest mode. Nothing a guest types ever reaches the database: the pack's
     DB layer is switched to a browser-only store for the session, and the
     host app's own localStorage writes were always local anyway. */
  guest: false,

  async check() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok && r.status !== 401) return null;         /* no auth module */
      const j = await r.json().catch(() => null);
      if (!j || typeof j.ok === 'undefined') return null; /* not our endpoint */
      Auth.installed = true;
      Auth.user = j.user || null;
      Auth.seed = j.seed || null;
      if (!Auth.user) Auth.screen(!!j.needsSetup);
      return Auth.user;
    } catch (e) { return null; }
  },

  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('Something went wrong (' + r.status + ')'));
    return j;
  },

  screen(firstRun) {
    if ($('#flow-auth')) return;
    const el = document.createElement('div');
    el.id = 'flow-auth';
    el.className = 'flow-x';
    el.innerHTML = `
      <div class="fa-card">
        <div class="fa-brand">The <b>Flow</b></div>
        <!-- What the app is, before anyone has used it. Not a slogan about
             the software — the idea the software exists to carry out. -->
        <blockquote class="fa-creed">
          <span>70% of our life is things we do everyday</span>
          <span>audit your routine every 6 months</span>
          <span>keep what&rsquo;s working</span>
          <span>get rid of what isn&rsquo;t</span>
          <span class="last">&hellip;watch your life change</span>
        </blockquote>
        <h2 class="fa-h" id="fa-h">${firstRun ? 'Set up your account' : 'Sign in'}</h2>
        <p class="fa-sub" id="fa-sub">${firstRun
          ? 'This is the first account on this server, so it becomes the owner — everything already in The Flow becomes yours.'
          : 'Your data is private to your account.'}</p>
        <div class="fa-err" id="fa-err" hidden></div>
        <label class="flow-label" for="fa-email">Email</label>
        <input class="flow-in" id="fa-email" type="email" autocomplete="username" placeholder="you@example.com">
        <div id="fa-namewrap" ${firstRun ? '' : 'hidden'}>
          <label class="flow-label" for="fa-name">Name</label>
          <input class="flow-in" id="fa-name" type="text" autocomplete="name" placeholder="What should it call you?">
        </div>
        <label class="flow-label" for="fa-pw">Password</label>
        <!-- A long password typed on a phone, blind, is how people end up
             choosing short ones. The toggle costs nothing and defaults to
             hidden. -->
        <div class="fa-pwwrap">
          <input class="flow-in" id="fa-pw" type="password" autocomplete="current-password" placeholder="At least 10 characters">
          <button class="fa-eye" id="fa-eye" type="button" aria-label="Show password" aria-pressed="false">Show</button>
        </div>
        <div id="fa-invwrap" hidden>
          <label class="flow-label" for="fa-inv">Invite code</label>
          <input class="flow-in" id="fa-inv" type="text" placeholder="The code you were given">
        </div>
        <div id="fa-rcwrap" hidden>
          <label class="flow-label" for="fa-rc">Recovery code</label>
          <input class="flow-in" id="fa-rc" type="text" autocomplete="one-time-code" placeholder="XXXX-XXXX-XXXX">
          <p class="fa-fine" style="margin:6px 0 0">One of the codes you were given when you signed up. Case and dashes do not matter.</p>
        </div>
        <button class="flow-btn primary fa-go" id="fa-go">${firstRun ? 'Create account' : 'Sign in'}</button>
        <button class="flow-btn ghost fa-alt" id="fa-alt">${firstRun ? '' : 'Create an account instead'}</button>
        <button class="flow-btn ghost" id="fa-forgot" ${firstRun ? 'hidden' : ''} style="margin-top:4px">Forgot your password?</button>
        <button class="flow-btn ghost" id="fa-mail" hidden style="margin-top:4px">Email me a link instead</button>
        <div class="fa-or"><span>or</span></div>
        <button class="flow-btn ghost" id="fa-guest">Have a look around first</button>
        <p class="fa-fine">No account, nothing saved to the server. You can keep your work if you sign up afterwards.</p>
      </div>`;
    document.body.appendChild(el);

    let mode = firstRun ? 'signup' : 'login';
    const err = $('#fa-err', el);
    const setMode = (m) => {
      mode = m;
      $('#fa-h', el).textContent = m === 'signup' ? 'Create your account' : 'Sign in';
      $('#fa-sub', el).textContent = m === 'signup'
        ? 'Ask whoever shared The Flow with you for the invite code.'
        : 'Your data is private to your account.';
      $('#fa-go', el).textContent = m === 'signup' ? 'Create account' : 'Sign in';
      $('#fa-alt', el).textContent = m === 'signup' ? 'I already have an account' : 'Create an account instead';
      $('#fa-namewrap', el).hidden = m !== 'signup';
      $('#fa-invwrap', el).hidden = m !== 'signup' || firstRun;
      $('#fa-pw', el).setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
      if (typeof hidePw === 'function') hidePw();
      err.hidden = true;

      /* Locked out: same form, one more field. Keeping it here rather than on
         a separate screen means the email they already typed is still there. */
      if (m === 'recover') {
        $('#fa-h', el).textContent = 'Set a new password';
        $('#fa-sub', el).textContent = 'Use one of your recovery codes. Each one works once.';
        $('#fa-go', el).textContent = 'Set new password';
        $('#fa-pw', el).setAttribute('autocomplete', 'new-password');
        $('#fa-pw', el).placeholder = 'Your new password — at least 10 characters';
      } else {
        $('#fa-pw', el).placeholder = 'At least 10 characters';
      }
      $('#fa-rcwrap', el).hidden = m !== 'recover';
      const mailb = $('#fa-mail', el);
      if (mailb) { mailb.hidden = m !== 'recover'; mailb.disabled = false;
                   mailb.textContent = 'Email me a link instead'; }
      $('#fa-alt', el).hidden = m === 'recover';
      const forgot = $('#fa-forgot', el);
      if (forgot) {
        forgot.hidden = firstRun || m === 'signup';
        forgot.textContent = m === 'recover' ? 'Back to signing in' : 'Forgot your password?';
      }
    };
    if (!firstRun) $('#fa-alt', el).addEventListener('click', () => setMode(mode === 'signup' ? 'login' : 'signup'));
    else $('#fa-alt', el).style.display = 'none';
    /* Revealing is per-tap and never sticky: it resets whenever the form
       changes what it is asking for, so a password revealed to check a typo
       cannot still be on screen after switching to another mode. */
    const wireEye = (root) => {
      const eye = $('.fa-eye', root), pw = $('#fa-pw', root);
      if (!eye || !pw) return () => {};
      const set = (show) => {
        pw.type = show ? 'text' : 'password';
        eye.textContent = show ? 'Hide' : 'Show';
        eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        eye.setAttribute('aria-pressed', show ? 'true' : 'false');
      };
      eye.addEventListener('click', () => {
        set(pw.type === 'password');
        try { pw.focus(); } catch (e) {}
      });
      return () => set(false);
    };
    const hidePw = wireEye(el);

    const forgotBtn = $('#fa-forgot', el);
    if (forgotBtn) forgotBtn.addEventListener('click', () => setMode(mode === 'recover' ? 'login' : 'recover'));

    /* The second road back in. If this Flow has no mail provider set up the
       server says so plainly and this button repeats it, because a green tick
       for an email that will never arrive is worse than no button at all. */
    const mailBtn = $('#fa-mail', el);
    if (mailBtn) mailBtn.addEventListener('click', async () => {
      const email = $('#fa-email', el).value.trim();
      if (!email) { err.textContent = 'Type your email address first.'; err.hidden = false; return; }
      mailBtn.disabled = true;
      const was = mailBtn.textContent; mailBtn.textContent = 'Sending…';
      try {
        await Auth.post('/api/auth/reset', { email });
        err.hidden = true;
        mailBtn.textContent = 'Sent — the link works once, for 30 minutes.';
      } catch (e) {
        err.textContent = e.message; err.hidden = false;
        mailBtn.disabled = false; mailBtn.textContent = was;
      }
    });

    const go = async () => {
      const btn = $('#fa-go', el);
      err.hidden = true; btn.disabled = true;
      const was = btn.textContent; btn.textContent = 'One moment…';
      try {
        const payload = {
          email: $('#fa-email', el).value.trim(),
          password: $('#fa-pw', el).value
        };
        if (mode === 'signup') {
          payload.name = $('#fa-name', el).value.trim();
          payload.invite = $('#fa-inv', el).value.trim();
        }
        if (mode === 'recover') payload.code = $('#fa-rc', el).value;
        const j = await Auth.post(
          mode === 'signup'  ? '/api/auth/signup'  :
          mode === 'recover' ? '/api/auth/recover' : '/api/auth/login', payload);
        btn.textContent = j.adopted ? 'Restoring your data…' : 'Loading…';
        /* If they were looking around as a guest first, carry that work into
           the account they just made, before the reload picks it all up. */
        if (mode === 'signup') {
          try { const n = await Auth.adoptCarried(); if (n) btn.textContent = 'Keeping your work…'; } catch (e) {}
        }
        /* This is the one moment the codes exist in plain text. Nothing stores
           them where the browser can read them again, so closing this screen
           without writing them down loses them — hence a screen rather than a
           toast, and a reload that only happens on a deliberate click. */
        if (mode === 'signup' && Array.isArray(j.recoveryCodes) && j.recoveryCodes.length) {
          Auth.showCodes(j.recoveryCodes, { firstTime: true });
          return;
        }
        /* A full reload is deliberate: the app hydrates its whole store in one
           synchronous pass at boot, so the cleanest way to pick up the account's
           data is to start again with the session in place. */
        location.reload();
      } catch (e) {
        err.textContent = e.message; err.hidden = false;
        btn.disabled = false; btn.textContent = was;
      }
    };
    const guestBtn = $('#fa-guest', el);
    if (guestBtn) guestBtn.addEventListener('click', (e) => { e.preventDefault(); Auth.startGuest(); });
    $('#fa-go', el).addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => { try { $('#fa-email', el).focus(); } catch (e) {} }, 60);
  },

  /* ---- recovery codes ------------------------------------------------
   * Shown exactly once, whether that once is straight after signup or from
   * Settings. The checkbox is not ceremony: the only failure that matters
   * here is somebody clicking past the screen, and everything else on it is
   * built to be clicked past.
   * ------------------------------------------------------------------ */
  showCodes(codes, opts) {
    const o = opts || {};
    const gone = $('#flow-codes'); if (gone) gone.remove();
    /* The sign-in screen has to go, not just fall behind: it is the same
       full-screen layer at the same depth, so leaving it up means the codes
       are drawn under a card that swallows every click aimed at them. */
    const signin = $('#flow-auth'); if (signin) signin.remove();
    const el = document.createElement('div');
    el.id = 'flow-codes';
    el.className = 'flow-x';
    el.innerHTML = `
      <div class="fa-card">
        <div class="fa-brand">The <b>Flow</b></div>
        <h2 class="fa-h">Your recovery codes</h2>
        <p class="fa-sub">These are the way back in if you ever forget your password. Each one works once. Put them somewhere that is not this browser — printed, or in a password manager alongside the password itself.</p>
        <pre class="flow-code" id="fc-list">${codes.map(c => esc(c)).join('\n')}</pre>
        <div class="flow-row" style="gap:8px;margin-top:10px">
          <button class="flow-btn" id="fc-copy">Copy</button>
          <button class="flow-btn" id="fc-save">Download</button>
        </div>
        <div class="fa-err" id="fc-warn" hidden></div>
        <label class="flow-label" style="display:flex;align-items:center;gap:8px;margin-top:14px;cursor:pointer">
          <input type="checkbox" id="fc-ack"> I have written these down somewhere safe
        </label>
        <button class="flow-btn primary fa-go" id="fc-done" disabled style="margin-top:8px">${o.firstTime ? 'Take me to The Flow' : 'Done'}</button>
      </div>`;
    document.body.appendChild(el);

    const text = codes.join('\n') + '\n';
    $('#fc-ack', el).addEventListener('change', (e) => { $('#fc-done', el).disabled = !e.target.checked; });

    $('#fc-copy', el).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); $('#fc-copy', el).textContent = 'Copied ✓'; }
      catch (e) {
        /* The clipboard is blocked in plenty of ordinary contexts. Select the
           codes so the keyboard still works, rather than leaving a button
           that silently does nothing. */
        try {
          const r = document.createRange(); r.selectNodeContents($('#fc-list', el));
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        } catch (e2) {}
        const w = $('#fc-warn', el);
        w.textContent = 'This browser would not let me use the clipboard — the codes are selected, so copy them by hand.';
        w.hidden = false;
      }
    });

    $('#fc-save', el).addEventListener('click', () => {
      try {
        const url = URL.createObjectURL(new Blob([
          'The Flow — recovery codes\nMade ' + new Date().toISOString().slice(0, 10) +
          '\n\nEach code works once. Making new codes cancels these.\n\n' + text
        ], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'flow-recovery-codes.txt';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
      } catch (e) {
        const w = $('#fc-warn', el);
        w.textContent = 'Could not start the download — copy them instead.';
        w.hidden = false;
      }
    });

    $('#fc-done', el).addEventListener('click', () => {
      if (o.firstTime) { location.reload(); return; }
      el.remove();
      try { SettingsUI.recoveryStatus(document); } catch (e) {}
    });
  },

  /* Arrived from the emailed link. Same card, one field, and it never asks
     for the old password — not having it is the whole reason they are here. */
  resetScreen(token) {
    if ($('#flow-auth')) return;
    Auth.installed = true;
    const el = document.createElement('div');
    el.id = 'flow-auth';
    el.className = 'flow-x';
    el.innerHTML = `
      <div class="fa-card">
        <div class="fa-brand">The <b>Flow</b></div>
        <h2 class="fa-h">Set a new password</h2>
        <p class="fa-sub">This link works once and stops working 30 minutes after it was sent. Setting a password here also signs you out everywhere else.</p>
        <div class="fa-err" id="fa-err" hidden></div>
        <label class="flow-label" for="fa-pw">New password</label>
        <div class="fa-pwwrap">
          <input class="flow-in" id="fa-pw" type="password" autocomplete="new-password" placeholder="At least 10 characters">
          <button class="fa-eye" id="fa-eye" type="button" aria-label="Show password" aria-pressed="false">Show</button>
        </div>
        <button class="flow-btn primary fa-go" id="fa-go">Set new password</button>
        <button class="flow-btn ghost" id="fa-back">Back to signing in</button>
      </div>`;
    document.body.appendChild(el);

    const err = $('#fa-err', el);
    (() => {
      const eye = $('.fa-eye', el), pw = $('#fa-pw', el);
      if (!eye || !pw) return;
      eye.addEventListener('click', () => {
        const show = pw.type === 'password';
        pw.type = show ? 'text' : 'password';
        eye.textContent = show ? 'Hide' : 'Show';
        eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        eye.setAttribute('aria-pressed', show ? 'true' : 'false');
        try { pw.focus(); } catch (e) {}
      });
    })();
    /* Take the token out of the address bar either way, so it is not left in
       history for whoever next uses this machine. */
    const clean = () => { try { history.replaceState(null, '', location.pathname); } catch (e) {} };
    $('#fa-back', el).addEventListener('click', () => { clean(); location.reload(); });
    const go = async () => {
      const btn = $('#fa-go', el);
      err.hidden = true; btn.disabled = true;
      const was = btn.textContent; btn.textContent = 'One moment…';
      try {
        await Auth.post('/api/auth/reset/confirm', { token, password: $('#fa-pw', el).value });
        clean();
        location.reload();
      } catch (e) {
        err.textContent = e.message; err.hidden = false;
        btn.disabled = false; btn.textContent = was;
      }
    };
    $('#fa-go', el).addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => { try { $('#fa-pw', el).focus(); } catch (e) {} }, 60);
  },

  /* ---- guest mode ----------------------------------------------------
   * The guest never gets a session, so every /api call would 401. Rather
   * than let the app fail request by request, DB is redirected at a
   * browser-only store for the rest of the visit. The server is not asked
   * for anything and is never sent anything.
   * ------------------------------------------------------------------ */
  startGuest() {
    Auth.guest = true;
    Auth.user = { email: '', name: 'Guest', owner: false, guest: true };
    Auth.seed = 'template';

    /* A guest must never inherit the previous person's board. The host purges
       the device cache on any anonymous load, but clear it here too — and drop
       the host's in-memory copy — so a guest genuinely starts from the blank
       template no matter how they arrived. */
    try { if (typeof window.__flowPurgeLocalData === 'function') window.__flowPurgeLocalData(); } catch (e) {}
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.indexOf('ld_') === 0) localStorage.removeItem(k);
      }
    } catch (e) {}
    try { if (window.jData) window.jData.length = 0; } catch (e) {}

    const LS = 'flowguest:';
    DB.get = async (key, fallback) => {
      try {
        const raw = localStorage.getItem(LS + key);
        if (raw != null) return JSON.parse(raw);
      } catch (e) {}
      return fallback === undefined ? null : fallback;
    };
    DB.set = async (key, value) => {
      try { localStorage.setItem(LS + key, JSON.stringify(value)); } catch (e) {}
      DB._mem.set(key, value);
      return value;
    };

    const el = $('#flow-auth');
    if (el) el.remove();
    document.body.classList.add('flow-is-guest');
    Auth.guestBanner();
  },

  guestBanner() {
    if ($('#flow-guestbar')) return;
    const bar = document.createElement('div');
    bar.id = 'flow-guestbar';
    bar.className = 'flow-x';
    bar.innerHTML = `<span>You are looking around as a guest — nothing here is saved to the server.</span>
      <button class="flow-btn tiny primary" id="fg-signup">Keep my work — create an account</button>`;
    document.body.appendChild(bar);
    $('#fg-signup', bar).addEventListener('click', () => Auth.convert());
  },

  /* Carry what the guest typed into the account they are about to make. */
  async convert() {
    const carried = {};
    try {
      Object.keys(localStorage)
        .filter(k => k.indexOf('flowguest:') === 0)
        .forEach(k => { carried[k.slice('flowguest:'.length)] = localStorage.getItem(k); });
    } catch (e) {}
    sessionStorage.setItem('flow:carry', JSON.stringify(carried));
    /* Host-app data lives under ld_* in localStorage already and survives a
       reload, so signing up adopts it in the normal way. */
    Auth.guest = false;
    Auth.user = null;
    const bar = $('#flow-guestbar'); if (bar) bar.remove();
    document.body.classList.remove('flow-is-guest');
    Auth.screen(false);
    const alt = $('#fa-alt'); if (alt) alt.click();
    const note = $('#fa-err');
    if (note) { note.hidden = false; note.textContent = 'Create your account and your work will be carried over.'; }
  },

  /* Called after a successful signup: replay anything the guest had typed. */
  async adoptCarried() {
    let carried = null;
    try { carried = JSON.parse(sessionStorage.getItem('flow:carry') || 'null'); } catch (e) {}
    if (!carried) return 0;
    sessionStorage.removeItem('flow:carry');
    let n = 0;
    for (const key of Object.keys(carried)) {
      try { await DB.set(key, JSON.parse(carried[key])); n++; } catch (e) {}
    }
    return n;
  },

  async signOut() {
    try { await fetch('/api/auth/logout', { credentials: 'same-origin' }); } catch (e) {}
    /* Clear the local mirror too, or the next person to open this browser sees
       the previous account's cached data behind the sign-in screen. */
    try {
      Object.keys(localStorage).filter(k => k.indexOf('ld_') === 0 || k.indexOf('flowpack:') === 0)
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {}
    location.reload();
  }
};

/* =========================================================================
 * 22 · Profile — makes the dashboard a template rather than one person's app
 *
 * A lot of what looks like "the app" is hard-coded content: QUAD_DEFAULTS,
 * SAW_ITEMS, PLAN, DIET_GYM/DIET_COMMON, and the two work boards. Ship that
 * to a second account and they get an empty journal wrapped in someone else's
 * life. This moves all of it into per-user data.
 *
 * Those constants are declared with `const`, so they cannot be reassigned —
 * but they are arrays, and arrays are mutable. Splicing them in place changes
 * what every existing render function reads, without touching that code.
 *
 * Anyone who already has data keeps exactly what they have: their profile is
 * captured FROM the current constants the first time this runs, so nothing
 * changes for them. Only genuinely new accounts get the neutral template.
 * ====================================================================== */
const PROFILE_KEY = 'flow:profile';

const NEUTRAL = {
  mission: '',
  roles: ['Work', 'Health & Body', 'Money', 'Relationships', 'Learning', 'Something creative'],
  workspaces: [
    { id: 'abko', name: 'Work', icon: '🏢', sub: 'Your job or main business — the goal you are driving, the tasks in motion, and a running log.', nsPlaceholder: 'What are you driving at work right now?' },
    { id: 'dtc',  name: 'Side Project', icon: '🚀', sub: 'Your own project — north-star goal, task pipeline, and notes.', nsPlaceholder: 'Where is this project headed?' }
  ],
  dietCommon: [
    ['water',  '💧 2–3 litres of water'],
    ['meal1',  '🍳 Breakfast'],
    ['meal2',  '🥗 Lunch'],
    ['meal3',  '🍽️ Dinner'],
    ['clean',  '🚫 No snacking between meals']
  ],
  dietGym: [
    ['train',  '🏋️ Training session'],
    ['shake',  '🥤 Post-workout protein']
  ],
  saw: [
    ['phys1', '💪 Physical — train 4× this week'],
    ['phys2', '🥗 Physical — eat to plan most days'],
    ['ment1', '📚 Mental — read or study ×3'],
    ['ment2', '🧠 Mental — learn one new thing'],
    ['soc1',  '🤝 Social — reach out to someone who matters'],
    ['soc2',  '❤️ Social — real time with people, phone away'],
    ['spir1', '🎧 Spiritual — something creative ×3'],
    ['spir2', '🪧 Spiritual — weekly review + mission check']
  ],
  quad: [
    [1, 'Something urgent and important — do it today'],
    [2, 'Something important but not urgent — this is where the wins are'],
    [3, 'Something urgent but not important — can it be delegated?'],
    [4, 'Something that is neither — be honest about it']
  ],
  /* Static page prose. It is not a constant the app reads, it is written
     straight into the markup, so it has to be captured from the DOM and put
     back the same way — otherwise shipping a generic file would silently
     delete whatever the owner had written there. */
  copy: {
    dietHeader: '🥗 Diet',
    dietSub: 'Tick off your daily basics. Edit the checklist in ⚙️ Settings → Make it yours.',
    trainNote: '(the checklist and week plan adapt to the days you train)',
    mealcards: '<div class="flow-empty" style="padding:18px 0">No meal plan yet. Write your own here later, or just use the daily checklist above.</div>',
    habits: []
  },
  plan: [
    { key: 'mon', title: 'Push — Chest, Shoulders, Triceps', tag: 'Push', type: 'hyper' },
    { key: 'tue', title: 'Pull — Back and Biceps',            tag: 'Pull', type: 'hyper' },
    { key: 'wed', title: 'Rest / Active Recovery',            tag: 'Rest', type: 'rest'  },
    { key: 'thu', title: 'Legs',                              tag: 'Legs', type: 'hyper' },
    { key: 'fri', title: 'Upper Body',                        tag: 'Upper', type: 'hyper' },
    { key: 'sat', title: 'Conditioning or a long walk',       tag: 'Cardio', type: 'hyper' },
    { key: 'sun', title: 'Rest',                              tag: 'Rest', type: 'rest'  }
  ]
};

const Profile = {
  data: null,
  isNew: false,

  host(name) { try { return eval(name); } catch (e) { return undefined; } },

  /** Read the constants as the code currently defines them. */
  capture() {
    const plan = (Profile.host('PLAN') || []).map(d => ({ key: d.key, title: d.title, tag: d.tag, type: d.type }));
    return {
      mission: Profile.host('DEFAULT_MISSION') || '',
      roles: (Profile.host('DEFAULT_ROLES') || []).slice(),
      /* Read from the page, never hardcoded — the shipped file is generic, so
         hardcoding one person's board names here would put them straight back. */
      workspaces: Profile.captureWorkspaces(),
      dietCommon: (Profile.host('DIET_COMMON') || []).map(x => x.slice()),
      dietGym: (Profile.host('DIET_GYM') || []).map(x => x.slice()),
      saw: (Profile.host('SAW_ITEMS') || []).map(x => x.slice()),
      quad: (Profile.host('QUAD_DEFAULTS') || []).map(x => x.slice()),
      copy: Profile.captureCopy(),
      plan
    };
  },

  /** Board names and blurbs as the page currently shows them. */
  captureWorkspaces() {
    const out = [];
    [['abko', '🏢'], ['dtc', '🛒']].forEach(([id, icon]) => {
      const sec = document.getElementById('tab-' + id);
      const pill = document.querySelector('.tab[data-tab="' + id + '"]');
      const name = ((pill && pill.textContent) || id).replace(/^[^A-Za-z0-9]+/, '').trim();
      const ns = document.querySelector('#ws-' + id + ' [id$="NS"], #ws-' + id + ' textarea, #ws-' + id + ' input');
      out.push({
        id, icon,
        name: name || id,
        sub: (sec && $('.section-sub', sec) ? $('.section-sub', sec).textContent.trim() : ''),
        nsPlaceholder: (ns && ns.placeholder) || ''
      });
    });
    return out;
  },

  /** Prose that lives in the markup rather than in a constant. */
  captureCopy() {
    const sec = dietRoot();
    const pick = (sel, root) => { const n = $(sel, root || document); return n ? n.textContent.trim() : ''; };
    const cards = sec ? $('.mealcards', sec) : null;
    let trainNote = '';
    if (sec) $$('h3 span', sec).forEach(sp => { if (/minimum|adapt|train/i.test(sp.textContent || '')) trainNote = sp.textContent.trim(); });
    return {
      dietHeader: sec ? pick('.section-header', sec) : '',
      dietSub: sec ? pick('.section-sub', sec) : '',
      trainNote,
      mealcards: cards ? cards.innerHTML : ''
    };
  },

  /** Put captured prose back into the page. Only ever writes what was saved. */
  applyCopy() {
    const c = (Profile.data && Profile.data.copy) || null;
    if (!c) return;
    const sec = dietRoot();
    if (sec) {
      const h = $('.section-header', sec), sub = $('.section-sub', sec);
      if (h && c.dietHeader) h.textContent = c.dietHeader;
      if (sub && c.dietSub) sub.textContent = c.dietSub;
      if (c.trainNote) $$('h3 span', sec).forEach(sp => {
        if (/minimum|adapt|train/i.test(sp.textContent || '')) sp.textContent = c.trainNote;
      });
      const cards = $('.mealcards', sec);
      if (cards && c.mealcards) cards.innerHTML = c.mealcards;
    }
  },

  /** Fallback only — used when the server has no accounts installed, i.e. the
      single-user case, where "existing" is always the right answer. */
  hasExistingData() {
    try {
      const q = Profile.host('qData');
      const j = Profile.host('jData');
      const c = Profile.host('cData');
      if (j && j.length > 3) return true;
      if (c && c.mission && String(c.mission).trim()) return true;
      if (q && q.items && q.items.some(i => i.done)) return true;
      /* A store that already holds a quad list it did not just seed. */
      const raw = localStorage.getItem('ld_quad');
      if (raw && j && j.length) return true;
      return false;
    } catch (e) { return false; }
  },

  async load() {
    let saved = null;
    try { saved = await DB.get(PROFILE_KEY, null); } catch (e) {}
    if (saved && saved.workspaces) { Profile.data = saved; return saved; }

    /* The server decides this at signup and remembers it. Guessing from the
       client is not possible: the app writes its own defaults into the store
       during boot, so a fresh account looks identical to an old one by the
       time anything here can look. */
    Profile.isNew = Auth.installed ? (Auth.seed === 'template') : !Profile.hasExistingData();
    /* Existing users keep exactly what the code gave them; only genuinely new
       accounts get the neutral template. */
    Profile.data = Profile.isNew ? JSON.parse(JSON.stringify(NEUTRAL)) : Profile.capture();
    /* A capture that found nothing means the host constants were not readable
       yet. Persisting that would bake the emptiness in permanently. */
    const captured = (Profile.data.dietCommon || []).length + (Profile.data.saw || []).length + (Profile.data.quad || []).length;
    if (!Profile.isNew && !captured) {
      console.warn('[Flow] profile capture found nothing; leaving the app as-is rather than saving an empty profile.');
      Profile.data = null;
      return null;
    }
    try { await DB.set(PROFILE_KEY, Profile.data); } catch (e) {}
    return Profile.data;
  },

  async save() { await DB.set(PROFILE_KEY, Profile.data); },

  /** Splice the profile into the host's constants, in place. */
  apply() {
    const p = Profile.data;
    if (!p || !p.workspaces) return;
    const swap = (name, rows) => {
      const arr = Profile.host(name);
      if (!Array.isArray(arr) || !Array.isArray(rows)) return;
      /* Never empty a list that currently has content. If a profile ever comes
         back empty — a bad capture, a partial save — replacing a populated
         array with nothing would look exactly like the user's diet or
         priorities vanishing. Leaving the existing content alone is always the
         safer failure. */
      if (!rows.length && arr.length) return;
      arr.length = 0;
      rows.forEach(r => arr.push(r.slice ? r.slice() : r));
    };
    swap('DIET_COMMON', p.dietCommon);
    swap('DIET_GYM', p.dietGym);
    /* The blade is edited by hand now and saved as the person's own list, so a
       template must never write over it — it only ever seeds an empty one. A
       profile that clobbered this on every boot is exactly how a rename looks
       like it saved and is gone by morning. */
    (() => {
      let own = false;
      try {
        const S_ = Profile.host('S');
        const v = S_ && S_.get('sawItems', null);
        own = Array.isArray(v) && v.length > 0;
      } catch (e) {}
      if (own) return;
      swap('SAW_ITEMS', p.saw);
      try { const save = Profile.host('sawSave'); if (typeof save === 'function') save(); } catch (e) {}
    })();
    swap('QUAD_DEFAULTS', p.quad);

    /* PLAN entries carry exercises the user may have edited, so only the
       labels are replaced — never the contents of a training day. */
    const PLAN_ = Profile.host('PLAN');
    if (Array.isArray(PLAN_) && Array.isArray(p.plan)) {
      p.plan.forEach(row => {
        const d = PLAN_.find(x => x.key === row.key);
        if (!d) return;
        if (row.title) d.title = row.title;
        if (row.tag) d.tag = row.tag;
        /* Times are per-week now and live in the training data, so a profile
           has no business handing one back. An old profile still carrying
           18:00 would otherwise refill every week's field on every boot. */
        d.time = '';
        if (row.type) { d.type = row.type; d.core = row.type !== 'rest'; }
      });
    }

    /* The shipped file no longer carries anyone's mission statement, so the
       owner's has to come back from their profile — not just a new account's
       empty one. The guard means a mission that has actually been written is
       never touched: this only fills a blank. */
    {
      const c = Profile.host('cData'), cSave = Profile.host('cSave');
      if (c && typeof cSave === 'function') {
        const dm = Profile.host('DEFAULT_MISSION');
        if (!c.mission || c.mission === dm) { c.mission = p.mission || ''; c.roles = (p.roles || []).slice(); cSave(); }
      }
    }

    /* A brand-new account was seeded with the previous owner's priorities
       before this ran; replace them with the template's. */
    if (Profile.isNew) {
      const q = Profile.host('qData'), qSave = Profile.host('qSave');
      if (q && typeof qSave === 'function') {
        q.items = p.quad.map((x, i) => ({ id: 'q' + i, q: x[0], txt: x[1], done: false }));
        qSave();
      }
    }

    Profile.paintWorkspaces();
    Profile.applyCopy();
    Profile.paintDietCopy();

    /* The host rendered every tab before this ran, so the swapped arrays are
       not on screen yet. Re-render the views that read them. */
    ['renderQuad', 'renderCompass', 'renderDiet', 'renderToday'].forEach(fn => {
      const f = Profile.host(fn);
      if (typeof f === 'function') { try { f(); } catch (e) {} }
    });
  },

  /* The Diet tab also carries hard-coded prose: a Turkish protocol line, a
     note naming the owner's 08:00 training slot, and a full bespoke meal plan
     in .mealcard blocks. None of that is data, so none of it was covered by
     swapping the arrays. */
  paintDietCopy() {
    if (!Profile.isNew) return;
    const sec = dietRoot();
    if (!sec || sec.__flowDietCopy) return;
    sec.__flowDietCopy = 1;

    const sub = $('.section-sub', sec);
    if (sub) sub.textContent = 'Tick off your daily basics. Edit the checklist in ⚙️ Settings → Make it yours.';

    $$('h3', sec).forEach(h => {
      const span = $('span', h);
      if (span && /minimum|adapt|train/i.test(span.textContent || '')) {
        span.textContent = '(the checklist and week plan adapt to the days you train)';
      }
    });

    const cards = $$('.mealcard', sec);
    if (cards.length) {
      const wrap = cards[0].parentElement;
      if (wrap) {
        wrap.innerHTML = '<div class="flow-x"><div class="flow-empty" style="padding:18px 0">'
          + 'No meal plan yet. Write your own here later, or just use the daily checklist above.'
          + '</div></div>';
      }
    }
  },

  paintWorkspaces() {
    const p = Profile.data; if (!p) return;
    (p.workspaces || []).forEach(w => {
      const pill = $('.tab[data-tab="' + w.id + '"]');
      if (pill) pill.textContent = w.icon + ' ' + w.name;
      const sec = document.getElementById('tab-' + w.id);
      if (sec) {
        const h = $('.section-header', sec);
        if (h) h.textContent = w.icon + ' ' + w.name;
        const sub = $('.section-sub', sec);
        if (sub) sub.textContent = w.sub || '';
        const ta = $('.ws-north textarea', sec);
        if (ta) ta.setAttribute('placeholder', w.nsPlaceholder || '');
      }
      /* The mobile sheet is built once from a hard-coded list. */
      const m = $('#moreGrid [data-goto="' + w.id + '"] .mg-lbl');
      if (m) m.textContent = w.name;
    });
  },

  watch() {
    ['abko', 'dtc'].forEach(id => {
      const mount = document.getElementById('ws-' + id);
      if (!mount || mount.__flowProfileWatched) return;
      mount.__flowProfileWatched = 1;
      new MutationObserver(() => { try { Profile.paintWorkspaces(); } catch (e) {} })
        .observe(mount, { childList: true });
    });
  },

  /* ---------- editing ---------- */
  linesToRows(text, prefix) {
    return String(text || '').split('\n').map(s => s.trim()).filter(Boolean)
      .map((label, i) => [prefix + (i + 1), label]);
  },
  rowsToLines(rows) { return (rows || []).map(r => r[1]).join('\n'); },

  async rerenderHost() {
    ['renderToday', 'renderCompass', 'renderDiet', 'renderQuad', 'renderTraining']
      .forEach(fn => { const f = Profile.host(fn); if (typeof f === 'function') { try { f(); } catch (e) {} } });
    Profile.paintWorkspaces();
  }
};

/* ══════════════════════════════════════════════════════════════════════════
 * 29 · Navigation
 *
 * Two interfaces over one set of sections. On a phone: a five-slot bottom bar
 * (Today · Focus · + · Body · Ask) with a segment row for the second level.
 * On a desktop: a grouped sidebar and a ⌘K palette.
 *
 * Every destination is still reached by clicking the host's own pill, so the
 * host's per-section render callbacks (renderQuad, renderDiet, syncWhoop …)
 * fire exactly as they always have. Nothing here re-implements navigation —
 * it only offers better ways in.
 * ══════════════════════════════════════════════════════════════════════════ */

const NAV_ICONS = {
  today:    '<path d="M3 5h18v16H3z"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  target:   '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  compass:  '<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2 5.6-5.6 2 2-5.6z"/>',
  work:     '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  rocket:   '<path d="M5 15l-2 6 6-2M14.5 4.5a9 9 0 0 1 5 5L11 18l-5-5z"/><circle cx="14.5" cy="9.5" r="1.5"/>',
  bulb:     '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  food:     '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10M17 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4v9"/>',
  moon:     '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  check:    '<path d="M20 6L9 17l-5-5"/>',
  heart:    '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21.4l8.8-8.7a5 5 0 0 0 0-7.1z"/>',
  note:     '<path d="M4 4h13l3 3v13H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  money:    '<path d="M12 3v18M16.5 7.5C16.5 5.8 14.5 5 12 5s-4.5.9-4.5 2.8S9.6 11 12 11.5s4.6 1.3 4.6 3.3S14.5 19 12 19s-4.5-.9-4.5-2.6"/>',
  chat:     '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  user:     '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock:     '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  out:      '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  gear:     '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  search:   '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  refresh:  '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  scale:    '<circle cx="12" cy="12" r="9"/><path d="M12 12l3.5-3.5"/>',
  star:     '<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.5-4.2 6.1-.8z"/>'
};


/* ==========================================================================
 * Connect — other apps, connected to this account (server: flow-connect.js)
 *
 * Google is the first: it gives the account its owner's name and photo, which
 * then stand in for the letter in the avatar and the person icon in the
 * sidebar. The card is written for a list, because the list is meant to grow.
 *
 * Inside the iPhone and Mac apps the sign-in has to happen in the real
 * browser — Google refuses embedded web views — and a browser will only be
 * opened by window.open() inside the tap itself, not after a fetch has
 * resolved. So in the app the start URL is fetched when the card is drawn,
 * and the tap only opens it. Coming back to the app re-reads the list.
 * ======================================================================== */
/* ── Notifications, on the two apps that can show them ─────────────────────
 *
 * iPhone: push. The server sends at the rock's time (flow-remind.js) to every
 * phone it holds a token for. The page's job is to get permission and make
 * sure the server actually holds this phone's token. Two things broke that
 * up to app 1.0.1, both invisible: the shell's bridge never exposed the push
 * methods (so the switch threw before asking anything), and the shell's own
 * registration went out without the session cookie (so the server answered
 * 401 and kept nothing). The first is worked around here by speaking to the
 * same message channel directly; the second needs app 1.0.2, which hands the
 * page its token so the page can register with its own session.
 *
 * Mac: local notifications. The Mac app has no push entitlement, but it can
 * ask macOS to show something at a time, app open or not. So this keeps the
 * Mac's queue equal to the timed, unfinished Big Rocks of the next eight days
 * — rescheduled whenever the plan changes, the app comes forward, or every
 * few minutes while it is open. Ids are `rock:<week>:<id>`, so anything
 * else in that queue is never touched.
 */
const Notify = {
  waiting: {},
  hooked: false,

  /* ── which app, if any ── */
  isIOS() {
    return window.__FLOW_NATIVE === 'ios' &&
      !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.flowBridge);
  },
  mac() {
    return (window.FlowMac && window.FlowMac.notifications) || null;
  },
  /* Everything else that can: the Android app from Google Play (this site in
     a Trusted Web Activity, which uses Chrome's push), Chromebooks, and any
     desktop browser. The server sends at the rock's time, same as iPhone. */
  web() {
    if (Notify.mac() || Notify.isIOS()) return false;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },
  platform() {
    const ua = navigator.userAgent || '';
    return /Android/i.test(ua) ? 'android' : /CrOS/.test(ua) ? 'chromeos' : 'web';
  },
  keyBytes(b64) {
    const s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
  /* Make sure this browser is subscribed with the server's key and that the
     server holds the subscription. Only ever prompts when `ask` is set. */
  async subscribeWeb(ask) {
    if (!Notify.web()) return false;
    if (Notification.permission !== 'granted') {
      if (!ask || Notification.permission === 'denied') return false;
      const p = await Notification.requestPermission();
      if (p !== 'granted') return false;
    }
    const k = await fetch('/api/push/vapid', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : {}).catch(() => ({}));
    if (!k.publicKey) return false;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    if (!reg || !reg.pushManager) return false;
    const key = Notify.keyBytes(k.publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey) {
      /* A subscription made under another key can never be delivered to. */
      const had = new Uint8Array(sub.options.applicationServerKey);
      if (had.length !== key.length || had.some((b, i) => b !== key[i])) { try { await sub.unsubscribe(); } catch (e) {} sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const r = await fetch('/api/push/register', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), platform: Notify.platform() })
    }).catch(() => null);
    return !!(r && r.ok);
  },

  /* ── iPhone bridge ──
     Prefer the shim's own method; on a build whose shim lacks it, post to the
     channel ourselves and catch the answer on its way to the shim. A method
     the build does not know is never answered, so everything has a time
     limit except the permission prompt, which waits on a person. */
  ios(method, ms) {
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FlowBridge;
    const viaShim = P && typeof P[method] === 'function';
    const ask = viaShim ? Promise.resolve().then(() => P[method]()) : new Promise((resolve) => {
      if (!Notify.hooked) {
        const prev = window.__flowBridgeResolve;
        window.__flowBridgeResolve = function (id, value) {
          const f = Notify.waiting[id];
          if (f) { delete Notify.waiting[id]; f(value || {}); return; }
          if (typeof prev === 'function') return prev(id, value);
        };
        Notify.hooked = true;
      }
      const id = 'fn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      Notify.waiting[id] = resolve;
      try { window.webkit.messageHandlers.flowBridge.postMessage({ id, method, args: {} }); }
      catch (e) { delete Notify.waiting[id]; resolve({}); }
    });
    if (!ms) return ask.catch(() => ({}));
    return Promise.race([ask.catch(() => ({})), new Promise((r) => setTimeout(() => r({}), ms))]);
  },

  async server() {
    try {
      const r = await fetch('/api/push/status', { credentials: 'same-origin' });
      return r.ok ? await r.json() : { available: false, devices: 0 };
    } catch (e) { return { available: false, devices: 0 }; }
  },

  /* Give the server this phone's token under the page's own session. */
  async registerIOS() {
    const t = await Notify.ios('pushToken', 3000);
    if (t && t.token) {
      try {
        const r = await fetch('/api/push/register', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: t.token, env: t.env || 'production', platform: 'ios' })
        });
        if (r.ok) return true;
      } catch (e) {}
    }
    const s = await Notify.ios('pushSync', 8000);
    return !!(s && s.ok);
  },

  /* ── Mac queue ── */
  weekId(d) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    return dt.getUTCFullYear() + '-W' + String(Math.ceil(((dt - y0) / 86400000 + 1) / 7)).padStart(2, '0');
  },
  /* What macOS's ISO8601DateFormatter reads: no milliseconds. */
  iso(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); },

  /* What the queue should hold right now, by id. Pure, for the tests. */
  wanted(compass, now, enabled) {
    const out = {};
    if (enabled === false) return out;
    const rocks = (compass && compass.rocks) || {};
    for (let i = 0; i < 8; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const wid = Notify.weekId(d), dow = (d.getDay() + 6) % 7;
      (rocks[wid] || []).forEach((r) => {
        if (!r || r.done || r.day !== dow) return;
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(r.time || ''));
        if (!m) return;
        const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1]), Number(m[2]), 0);
        if (at - now < 30000) return;
        out['rock:' + wid + ':' + r.id] = {
          title: String(r.title || 'Big Rock').slice(0, 120),
          body: r.note ? String(r.note).split('\n')[0].slice(0, 160) : ('It is ' + r.time + '.'),
          at: Notify.iso(at)
        };
      });
    }
    return out;
  },

  busy: null,
  async syncMac() {
    const N = Notify.mac();
    if (!N) return;
    if (Notify.busy) return Notify.busy;
    Notify.busy = (async () => {
      const st = await N.status();
      if (!st || !st.granted) return;
      let compass = {};
      try { compass = (typeof S !== 'undefined' && S.get('compass', {})) || {}; } catch (e) {}
      const want = Notify.wanted(compass, new Date(), Settings.get('pushRemindRocks'));
      const have = {};
      try { ((await N.pending()).pending || []).forEach((p) => { have[p.id] = p; }); } catch (e) {}
      for (const id of Object.keys(have)) {
        if (id.indexOf('rock:') === 0 && !want[id]) await N.cancel(id);
      }
      for (const id of Object.keys(want)) {
        const w = want[id], h = have[id];
        if (h && h.at === w.at && h.title === w.title) continue;
        await N.schedule({ notifId: id, title: w.title, body: w.body, at: w.at });
      }
    })().catch((e) => console.warn('[Flow] notify', e)).finally(() => { Notify.busy = null; });
    return Notify.busy;
  },

  soon: null,
  later() { clearTimeout(Notify.soon); Notify.soon = setTimeout(() => Notify.syncMac(), 1500); },

  boot() {
    if (Notify.mac()) {
      /* The plan is written through S.set; a change from another device
         lands through the same door. */
      try {
        if (typeof S !== 'undefined' && S && !S.__flowNotify) {
          const set = S.set.bind(S);
          S.set = function (k, v) { const r = set(k, v); if (k === 'compass') Notify.later(); return r; };
          S.__flowNotify = true;
        }
      } catch (e) {}
      document.addEventListener('visibilitychange', () => { if (!document.hidden) Notify.later(); });
      setInterval(() => Notify.syncMac(), 5 * 60 * 1000);
      Notify.later();
      return;
    }
    if (Notify.web()) {
      /* Every launch, quietly: if this browser already allows notifications,
         keep the server's copy of its subscription current. Never prompts. */
      if (Notification.permission === 'granted') Notify.subscribeWeb(false).catch(() => {});
      return;
    }
    if (Notify.isIOS()) {
      /* Every launch: if this phone already allows notifications, make sure
         the server has it. Quiet — nothing to show unless it is asked for. */
      Notify.ios('pushStatus', 4000).then(async (d) => {
        if (!d || !d.granted) return;
        const srv = await Notify.server();
        if (!srv.devices) await Notify.registerIOS();
      }).catch(() => {});
    }
  },

  /* ── The Settings card ── */
  wire(section) {
    const card = section.querySelector('#pushCard');
    if (!card) return;
    const state = card.querySelector('#pushState');
    const btn = card.querySelector('#pushBtn');
    const test = card.querySelector('#pushTestBtn');
    const out = card.querySelector('#pushTestOut');
    const mac = Notify.mac(), ios = Notify.isIOS();
    const set = (text, label, on, testOn) => {
      state.textContent = text; btn.textContent = label; btn.disabled = !on; test.disabled = !testOn;
    };

    async function paint() {
      if (mac) {
        const st = await mac.status();
        if (st && st.granted) {
          set('On for this Mac. Big Rocks with a time will remind you, app open or not.', 'Allowed', false, true);
          Notify.syncMac();
        } else if (st && st.asked) {
          set('Turned off in System Settings → Notifications → The Flow.', 'Blocked', false, false);
        } else {
          set('Not switched on yet.', 'Turn on', true, false);
        }
        return;
      }
      const srv = await Notify.server();
      if (!ios && Notify.web()) {
        const perm = Notification.permission;
        if (perm === 'denied') {
          set('Blocked for this site in your browser settings. Allow notifications for theflow.today, then open this again.', 'Blocked', false, false);
        } else if (perm === 'granted') {
          const ok = await Notify.subscribeWeb(false);
          set(ok ? 'On for this device. Big Rocks with a time will remind you, app open or not.'
            : 'Allowed here, but this device has not reached the server yet.', ok ? 'Allowed' : 'Retry', !ok, ok);
        } else {
          set('Not switched on yet.', 'Turn on', true, !!srv.devices);
        }
        return;
      }
      if (!ios) {
        set(srv.devices
          ? 'On for ' + srv.devices + ' iPhone' + (srv.devices === 1 ? '' : 's') + '. Open the iPhone or Mac app to change it.'
          : 'Open the iPhone or Mac app to switch notifications on.', 'In the app', false, !!srv.devices);
        return;
      }
      const d = await Notify.ios('pushStatus', 4000);
      if (!d || d.supported === undefined) {
        set('This version of the app cannot do notifications. Update it from the App Store.', 'Update', false, false);
        return;
      }
      if (d.denied) {
        set('Turned off in iOS Settings → Notifications → The Flow.', 'Blocked', false, false);
        return;
      }
      if (d.granted) {
        let s2 = srv;
        if (!s2.devices) { await Notify.registerIOS(); s2 = await Notify.server(); }
        if (s2.devices) {
          set(s2.available
            ? 'On. ' + s2.devices + ' device' + (s2.devices === 1 ? '' : 's') + ' registered.'
            : 'Allowed on this phone, but the server cannot send yet.', 'Allowed', false, !!s2.available);
        } else {
          set('Allowed on this phone, but it has not reached the server. Update The Flow from the App Store, then open this again.', 'Retry', true, false);
        }
        return;
      }
      set('Not switched on yet.', 'Turn on', true, false);
    }

    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '…';
      try {
        if (mac) {
          await mac.request();
          await Notify.syncMac();
        } else if (Notify.web()) {
          await Notify.subscribeWeb(true);
        } else if (ios) {
          await Notify.ios('pushRequest');
          /* The token arrives in a delegate callback a moment after the
             prompt is answered. */
          await new Promise((r) => setTimeout(r, 1500));
          await Notify.registerIOS();
        }
      } catch (e) {}
      paint();
    });

    test.addEventListener('click', async () => {
      test.disabled = true; out.textContent = 'Sending…';
      try {
        if (mac) {
          const r = await mac.schedule({
            notifId: 'flow-test', title: 'The Flow',
            body: 'Notifications are working. This is what a reminder will look like.',
            at: Notify.iso(new Date(Date.now() + 5000))
          });
          out.textContent = r && r.ok ? 'Sent. It will appear in about five seconds.' : ((r && r.error) || 'It could not be sent.');
        } else {
          const r = await fetch('/api/push/test', { method: 'POST', credentials: 'same-origin' });
          const j = await r.json();
          out.textContent = j.ok ? 'Sent. It should appear in a moment.' : (j.error || 'It could not be sent.');
        }
      } catch (e) { out.textContent = 'It could not be sent.'; }
      test.disabled = false;
    });

    paint();
  }
};

/* ── The weekly loop ─────────────────────────────────────────────────────
 *
 * The part of The Flow a chat assistant cannot be: a plan that persists, a
 * record of what actually happened against it, and a ritual that turns one
 * into the next. Three pieces:
 *
 *   WeekPlan  — the Sunday session: last week's honest scorecard, a few lines
 *               about it, what carries over, then Big Rocks suggested from
 *               all of that plus next week's meetings. Nothing is added
 *               until it is ticked; the suggestion writes nothing itself.
 *   TodayFix  — overdue rocks get "Today / Tomorrow / Done" right on Today,
 *               so the screen stops filling with red and can be trusted.
 *   Sections  — hide the parts of the app you do not use. Data stays; only
 *               the navigation changes, and it can be undone at any time.
 */
const DAY3 = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAYNAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const WeekLoop = {
  wid(d) { return (typeof weekId === 'function') ? weekId(d) : Notify.weekId(d); },
  dow(d) { return (d.getDay() + 6) % 7; },
  monday(d) { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - WeekLoop.dow(m)); return m; },
  iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  /* Saturday and Sunday plan the week ahead; Monday to Friday, this one. */
  target(now) {
    now = now || new Date();
    const m = WeekLoop.monday(now);
    if (WeekLoop.dow(now) >= 5) m.setDate(m.getDate() + 7);
    return m;
  },
  rocksOf(wid) { try { return ((typeof cData !== 'undefined' && cData.rocks) || {})[wid] || []; } catch (e) { return []; } },

  /* What a week actually was. Pure apart from reading the app's own data,
     and every number says what it is out of. */
  scorecard(monday) {
    const wid = WeekLoop.wid(monday);
    const rocks = WeekLoop.rocksOf(wid);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return WeekLoop.iso(d); });
    const today = WeekLoop.iso(new Date());
    const past = days.filter((d) => d <= today).length || 7;
    const byRole = {};
    rocks.forEach((r) => {
      const k = r.role || 'No role';
      byRole[k] = byRole[k] || { planned: 0, done: 0 };
      byRole[k].planned++; if (r.done) byRole[k].done++;
    });
    let habits = null;
    try {
      const hb = (typeof hbData !== 'undefined') ? hbData : null;
      if (hb && Array.isArray(hb.habits) && hb.habits.length) {
        let done = 0;
        hb.habits.forEach((h) => days.slice(0, past).forEach((d) => { if (hb.completions && hb.completions[h.id] && hb.completions[h.id][d]) done++; }));
        habits = { done, possible: hb.habits.length * past };
      }
    } catch (e) {}
    let training = null;
    try {
      if (typeof tData !== 'undefined' && typeof tTrackable === 'function') {
        const keys = tTrackable(wid);
        const wk = (tData.weeks || {})[wid] || { done: {} };
        if (keys.length) training = { done: keys.filter((k) => wk.done && wk.done[k]).length, planned: keys.length };
      }
    } catch (e) {}
    let journalDays = 0;
    try {
      const set = {};
      (typeof jData !== 'undefined' ? jData : []).forEach((e) => { if (e && e.t) { const d = WeekLoop.iso(new Date(e.t)); if (days.indexOf(d) >= 0) set[d] = 1; } });
      journalDays = Object.keys(set).length;
    } catch (e) {}
    let sleep = null;
    try {
      const sl = (typeof slData !== 'undefined' ? slData : []).filter((x) => x && days.indexOf(x.date) >= 0 && Number(x.hrs) > 0);
      if (sl.length) sleep = { avg: Math.round(sl.reduce((a, x) => a + Number(x.hrs), 0) / sl.length * 10) / 10, nights: sl.length };
    } catch (e) {}
    return {
      week: wid, from: days[0], to: days[6],
      rocks: { planned: rocks.length, done: rocks.filter((r) => r.done).length, byRole,
               unfinished: rocks.filter((r) => !r.done && !r.carried).map((r) => ({ id: r.id, title: r.title, role: r.role || '', day: r.day, time: r.time || '' })) },
      habits, training, journalDays, sleep
    };
  },

  pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '—'; },
  scoreHtml(sc) {
    const line = (label, val, sub) => '<div class="wp-stat"><b>' + esc(val) + '</b><span>' + esc(label) + (sub ? ' · ' + esc(sub) : '') + '</span></div>';
    let h = '<div class="wp-stats">' +
      line('Big Rocks done', sc.rocks.done + ' / ' + sc.rocks.planned, WeekLoop.pct(sc.rocks.done, sc.rocks.planned)) +
      (sc.habits ? line('Habit ticks', sc.habits.done + ' / ' + sc.habits.possible, WeekLoop.pct(sc.habits.done, sc.habits.possible)) : '') +
      (sc.training ? line('Training sessions', sc.training.done + ' / ' + sc.training.planned) : '') +
      line('Days you wrote something', sc.journalDays + ' / 7') +
      (sc.sleep ? line('Average sleep', sc.sleep.avg + ' h', sc.sleep.nights + ' nights logged') : '') +
      '</div>';
    const roles = Object.keys(sc.rocks.byRole);
    if (roles.length) {
      h += '<div class="wp-roles">' + roles.map((r) => {
        const x = sc.rocks.byRole[r];
        return '<span class="wp-role">' + esc(r) + ' <b>' + x.done + '/' + x.planned + '</b></span>';
      }).join('') + '</div>';
    }
    if (!sc.rocks.planned) h += '<p class="flow-sub">No Big Rocks were planned that week. That is the honest starting point — this session fixes it.</p>';
    return h;
  }
};

const WeekPlan = {
  st: null,
  open() {
    const target = WeekLoop.target();
    const review = new Date(target); review.setDate(review.getDate() - 7);
    WeekPlan.st = {
      step: 0, target, wid: WeekLoop.wid(target), review, rwid: WeekLoop.wid(review),
      sc: WeekLoop.scorecard(review), refl: { well: '', blocked: '', change: '' },
      carry: {}, plan: null, picks: {}, added: 0, carried: 0
    };
    WeekPlan.st.sc.rocks.unfinished.forEach((r) => { WeekPlan.st.carry[r.id] = true; });
    let el = document.getElementById('wp-modal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wp-modal';
      el.className = 'flow-x';
      el.setAttribute('data-flow-no-chip', '1');
      el.innerHTML = '<div class="wp-box" role="dialog" aria-modal="true"><button type="button" class="wp-x" aria-label="Close">×</button><div class="wp-body"></div></div>';
      document.body.appendChild(el);
      el.querySelector('.wp-x').addEventListener('click', WeekPlan.close);
      el.addEventListener('click', (e) => { if (e.target === el) WeekPlan.close(); });
    }
    el.classList.add('on');
    WeekPlan.paint();
  },
  close() { const el = document.getElementById('wp-modal'); if (el) el.classList.remove('on'); },

  range(m) {
    const e = new Date(m); e.setDate(e.getDate() + 6);
    const f = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return f(m) + ' – ' + f(e);
  },

  paint() {
    const st = WeekPlan.st, body = document.querySelector('#wp-modal .wp-body');
    if (!st || !body) return;
    const steps = ['Last week', 'Look back', 'Carry over', 'Plan', 'Done'];
    const dots = '<div class="wp-steps">' + steps.map((s, i) => '<span class="' + (i === st.step ? 'on' : (i < st.step ? 'done' : '')) + '">' + esc(s) + '</span>').join('') + '</div>';
    let h = dots;
    if (st.step === 0) {
      h += '<h2>How last week actually went</h2><p class="flow-sub">' + esc(WeekPlan.range(st.review)) + '. Planned against done, nothing rounded up.</p>' +
        WeekLoop.scoreHtml(st.sc) +
        '<div class="wp-nav"><span></span><button type="button" class="flow-btn primary" data-wp="next">Next</button></div>';
    } else if (st.step === 1) {
      const ta = (k, q) => '<label class="wp-q"><span>' + esc(q) + '</span><textarea data-refl="' + k + '" rows="2">' + esc(st.refl[k]) + '</textarea></label>';
      h += '<h2>Two minutes on it</h2><p class="flow-sub">Short is fine. This is saved as the week’s review and helps the suggestions.</p>' +
        ta('well', 'What went well?') + ta('blocked', 'What got in the way?') + ta('change', 'What will you do differently?') +
        '<div class="wp-nav"><button type="button" class="flow-btn ghost" data-wp="back">Back</button><button type="button" class="flow-btn primary" data-wp="next">Next</button></div>';
    } else if (st.step === 2) {
      const un = st.sc.rocks.unfinished;
      h += '<h2>What carries over?</h2><p class="flow-sub">Unfinished rocks from last week. Ticked ones go onto ' + esc(WeekPlan.range(st.target)) +
        ', same weekday. Unticked ones stay where they were, unfinished — that is the honest record.</p>' +
        (un.length ? '<div class="wp-list">' + un.map((r) => '<label class="wp-item"><input type="checkbox" data-carry="' + esc(r.id) + '"' + (st.carry[r.id] ? ' checked' : '') + '>' +
          '<span><b>' + esc(r.title) + '</b><small>' + esc((r.role ? r.role + ' · ' : '') + DAYNAME[r.day] + (r.time ? ' ' + r.time : '')) + '</small></span></label>').join('') + '</div>'
          : '<p>Nothing unfinished. Clean slate.</p>') +
        '<div class="wp-nav"><button type="button" class="flow-btn ghost" data-wp="back">Back</button><button type="button" class="flow-btn primary" data-wp="next">Next</button></div>';
    } else if (st.step === 3) {
      h += '<h2>The week of ' + esc(WeekPlan.range(st.target)) + '</h2>';
      const have = WeekLoop.rocksOf(st.wid);
      if (have.length) h += '<p class="flow-sub">Already on it: ' + have.map((r) => esc(r.title)).join(' · ') + '</p>';
      if (!st.plan) {
        h += '<p class="flow-sub">Suggestions use your mission and roles, last week’s numbers and notes, what you carried over, and the meetings in your connected calendars. You choose what goes in.</p>' +
          '<div class="wp-nav"><button type="button" class="flow-btn ghost" data-wp="back">Back</button><span>' +
          '<button type="button" class="flow-btn ghost" data-wp="skip">I’ll plan it myself</button> ' +
          '<button type="button" class="flow-btn primary" data-wp="suggest">Suggest my Big Rocks</button></span></div><p class="wp-err flow-sub"></p>';
      } else {
        const roles = (typeof cData !== 'undefined' && Array.isArray(cData.roles)) ? cData.roles : [];
        h += (st.plan.focus ? '<p class="wp-focus">' + esc(st.plan.focus) + '</p>' : '') +
          '<div class="wp-list">' + st.plan.rocks.map((r, i) => '<div class="wp-item wp-rock"><input type="checkbox" data-pick="' + i + '"' + (st.picks[i] !== false ? ' checked' : '') + '>' +
            '<div><input class="wp-title" data-rt="' + i + '" value="' + esc(r.title) + '">' +
            '<div class="wp-meta"><select data-rd="' + i + '">' + DAY3.map((d, j) => '<option value="' + j + '"' + (d === r.day ? ' selected' : '') + '>' + DAYNAME[j] + '</option>').join('') + '</select>' +
            '<input type="time" data-rtm="' + i + '" value="' + esc(r.time) + '">' +
            '<select data-rr="' + i + '"><option value="">No role</option>' + roles.map((x) => '<option' + (x === r.role ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
            (r.why ? '<small>' + esc(r.why) + '</small>' : '') + '</div></div>').join('') + '</div>' +
          '<div class="wp-nav"><button type="button" class="flow-btn ghost" data-wp="suggest">Suggest again</button>' +
          '<button type="button" class="flow-btn primary" data-wp="add">Add ticked to my week</button></div><p class="wp-err flow-sub"></p>';
      }
    } else {
      h += '<h2>Your week is set</h2><p>' + st.carried + ' carried over, ' + st.added + ' new Big Rock' + (st.added === 1 ? '' : 's') + ' added for ' + esc(WeekPlan.range(st.target)) + '.</p>' +
        '<p class="flow-sub">They show on Today on their day, and remind you at their time if they have one.</p>' +
        '<div class="wp-nav"><button type="button" class="flow-btn ghost" data-wp="close">Close</button><button type="button" class="flow-btn primary" data-wp="compass">Open the Week Compass</button></div>';
    }
    body.innerHTML = h;
    body.onclick = WeekPlan.onClick;
    body.oninput = WeekPlan.onInput;
    body.onchange = WeekPlan.onInput;
  },

  onInput(e) {
    const st = WeekPlan.st, t = e.target;
    if (t.matches('[data-refl]')) st.refl[t.getAttribute('data-refl')] = t.value;
    if (t.matches('[data-carry]')) st.carry[t.getAttribute('data-carry')] = t.checked;
    if (t.matches('[data-pick]')) st.picks[+t.getAttribute('data-pick')] = t.checked;
    if (t.matches('[data-rt]')) st.plan.rocks[+t.getAttribute('data-rt')].title = t.value;
    if (t.matches('[data-rd]')) st.plan.rocks[+t.getAttribute('data-rd')].day = DAY3[+t.value];
    if (t.matches('[data-rtm]')) st.plan.rocks[+t.getAttribute('data-rtm')].time = t.value;
    if (t.matches('[data-rr]')) st.plan.rocks[+t.getAttribute('data-rr')].role = t.value;
  },

  async onClick(e) {
    const b = e.target.closest('[data-wp]');
    if (!b) return;
    const st = WeekPlan.st, what = b.getAttribute('data-wp');
    if (what === 'back') { st.step--; return WeekPlan.paint(); }
    if (what === 'close') return WeekPlan.close();
    if (what === 'compass') { WeekPlan.close(); try { Nav.go('compass'); } catch (x) {} return; }
    if (what === 'next') {
      if (st.step === 1) WeekPlan.saveReview();
      if (st.step === 2) WeekPlan.doCarry();
      st.step++; return WeekPlan.paint();
    }
    if (what === 'skip') { st.step = 4; return WeekPlan.paint(); }
    if (what === 'suggest') {
      b.disabled = true; b.textContent = 'Thinking…';
      const err = document.querySelector('#wp-modal .wp-err');
      try {
        const cal = await WeekPlan.calendar();
        const r = await fetch('/api/flow/plan-week', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week: st.wid, scorecard: st.sc, reflection: st.refl,
            carried: WeekLoop.rocksOf(st.wid).map((x) => ({ title: x.title, day: DAY3[x.day], time: x.time || '' })), calendar: cal }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'No suggestion this time.');
        st.plan = { focus: j.focus || '', rocks: j.rocks || [] }; st.picks = {};
        WeekPlan.paint();
      } catch (x) {
        b.disabled = false; b.textContent = 'Suggest my Big Rocks';
        if (err) err.textContent = x.message || 'No suggestion this time.';
      }
      return;
    }
    if (what === 'add') {
      const roles = (typeof cData !== 'undefined' && Array.isArray(cData.roles)) ? cData.roles : [];
      st.plan.rocks.forEach((r, i) => {
        if (st.picks[i] === false || !String(r.title).trim()) return;
        addRock(String(r.title).trim(), r.role || roles[0] || '', Math.max(0, DAY3.indexOf(r.day)), r.time || '', st.wid, { note: r.why || '', prio: 'med' });
        st.added++;
      });
      if (st.plan.focus && typeof cData !== 'undefined') {
        cData.plans = cData.plans || {};
        if (!String(cData.plans[st.wid] || '').trim()) { cData.plans[st.wid] = st.plan.focus; cSave(); }
      }
      try { if (typeof renderToday === 'function') renderToday(); } catch (x) {}
      st.step = 4; return WeekPlan.paint();
    }
  },

  saveReview() {
    const st = WeekPlan.st, r = st.refl;
    const text = [r.well && ('Went well: ' + r.well), r.blocked && ('Got in the way: ' + r.blocked), r.change && ('Do differently: ' + r.change)].filter(Boolean).join('\n');
    if (!text || typeof cData === 'undefined') return;
    cData.reviews = cData.reviews || {};
    cData.reviews[st.rwid] = text;
    cSave();
    if (typeof J === 'function') J('planning', '📝 Weekly review (' + st.rwid + '): ' + st.sc.rocks.done + '/' + st.sc.rocks.planned + ' rocks. ' + text.replace(/\n/g, ' · '));
  },

  doCarry() {
    const st = WeekPlan.st;
    if (st._carried || typeof cData === 'undefined') return;
    st._carried = true;
    const src = WeekLoop.rocksOf(st.rwid);
    src.forEach((r) => {
      if (!st.carry[r.id] || r.done || r.carried) return;
      addRock(r.title, r.role || '', r.day, r.time || '', st.wid, { note: r.note || '', prio: r.prio || 'med', end: r.end || '' });
      r.carried = st.wid;
      st.carried++;
    });
    if (st.carried) cSave();
  },

  async calendar() {
    const st = WeekPlan.st;
    const from = new Date(st.target), to = new Date(st.target); to.setDate(to.getDate() + 7);
    const q = '?' + new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const ids = ['gcal', 'outlook'].filter((id) => ((Connect.list.find((x) => x.id === id) || {}).accounts || []).length);
    const got = await Promise.all(ids.map((id) => ConnectApps.get('/api/connect/' + id + '/events' + q).then((j) => j.events || []).catch(() => [])));
    return [].concat.apply([], got).slice(0, 60).map((e) => ({
      title: e.title, allDay: !!e.allDay,
      day: e.allDay ? String(e.start).slice(0, 10) : new Date(e.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
      from: e.allDay ? '' : new Date(e.start).toTimeString().slice(0, 5), to: e.allDay ? '' : new Date(e.end).toTimeString().slice(0, 5)
    }));
  },

  /* The invitation on Today: the weekend, and Monday, while the week has
     fewer than three Big Rocks. */
  cardHtml() {
    const now = new Date(), d = WeekLoop.dow(now);
    if (!(d >= 5 || d === 0)) return '';
    const t = WeekLoop.target(now);
    if (WeekLoop.rocksOf(WeekLoop.wid(t)).length >= 3) return '';
    return '<div class="td-plan wp-card flow-x" id="td-weekplan" data-flow-no-chip="1"><div class="td-plan-head"><span class="lbl">' +
      (d >= 5 ? 'Next week' : 'This week') + ' · not planned yet</span></div>' +
      '<div class="td-plan-body">Ten minutes: look at how last week went, carry over what matters, and set three to five Big Rocks.' +
      ' <button type="button" class="flow-btn sm primary" data-weekplan="1">Plan my week</button></div></div>';
  },
  paintCard() {
    const feed = document.getElementById('today-feed');
    if (!feed) return;
    const old = feed.querySelector('#td-weekplan');
    const html = WeekPlan.cardHtml();
    if (!html) { if (old) old.remove(); return; }
    if (old) return;
    const box = document.createElement('div'); box.innerHTML = html;
    const head = feed.querySelector('.td-head');
    if (head && head.nextSibling) feed.insertBefore(box.firstElementChild, head.nextSibling); else feed.insertBefore(box.firstElementChild, feed.firstChild);
  },

  /* In the Week Compass: the button, and this week's numbers so far. */
  paintCompass() {
    const sec = document.getElementById('tab-compass');
    if (!sec) return;
    let card = document.getElementById('wp-compass');
    if (!card) {
      card = document.createElement('div');
      card.id = 'wp-compass'; card.className = 'panel flow-x';
      card.setAttribute('data-flow-no-chip', '1');
      const sub = sec.querySelector('.section-sub');
      if (sub && sub.nextSibling) sec.insertBefore(card, sub.nextSibling); else sec.appendChild(card);
    }
    const sc = WeekLoop.scorecard(WeekLoop.monday(new Date()));
    card.innerHTML = '<div class="wp-ch"><h3>This week so far</h3><button type="button" class="flow-btn sm primary" data-weekplan="1">🗓 Plan the week with AI</button></div>' + WeekLoop.scoreHtml(sc);
  },

  boot() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-weekplan]')) { e.preventDefault(); WeekPlan.open(); }
    });
    const feed = document.getElementById('today-feed');
    if (feed && window.MutationObserver) {
      new MutationObserver(() => { if (!feed.querySelector('#td-weekplan')) WeekPlan.paintCard(); TodayFix.paint(); try { Meetings.paint(); } catch (e) {} try { Inbox.paintToday(); } catch (e) {} try { Markets.widgetRow(); } catch (e) {} })
        .observe(feed, { childList: true });
    }
    WeekPlan.paintCard(); TodayFix.paint();
    /* Reachable from outside the pack: the native shells and the tests. */
    try { window.FlowMeetings = Meetings; window.FlowRefresh = Refresh; } catch (e) {}
    try { Meetings.apply(); Meetings.paint(); } catch (e) { console.warn('[Flow] meetings', e); }
    try { WeekPlan.paintCompass(); } catch (e) {}
    try {
      if (typeof S !== 'undefined' && S && !S.__flowWeek) {
        const set = S.set.bind(S);
        S.set = function (k, v) { const r = set(k, v); if (k === 'compass' || k === 'habits' || k === 'journal') { clearTimeout(WeekPlan._t); WeekPlan._t = setTimeout(() => { try { WeekPlan.paintCompass(); } catch (e) {} }, 400); } return r; };
        S.__flowWeek = true;
      }
    } catch (e) {}
  }
};

/* Overdue rocks on Today, fixed in one tap. */
/* ── Meetings, filed on their own ────────────────────────────────────────
 *
 * The server brings every new Fathom meeting into `ld_meetings` (summary,
 * people, every action item, which ones are yours). This takes what has not
 * been filed yet and files it: the summary into the Journal, your action
 * items as Big Rocks on the day their wording names, or today. It runs on
 * every open and every refresh, so "immediately" means the next time the
 * app is looked at — and the notification the server sends is what makes
 * that soon.
 *
 * Each rock remembers which meeting and which item it came from, so Today
 * can show the whole meeting behind it, and nothing is ever filed twice.
 */
const Meetings = {
  all() { try { const v = S.get('meetings', []); return Array.isArray(v) ? v : []; } catch (e) { return []; } },
  find(mid) { return Meetings.all().find((m) => m && m.id === mid) || null; },
  applied() {
    if (typeof cData === 'undefined' || !cData) return {};
    if (!cData.meetApplied || typeof cData.meetApplied !== 'object') cData.meetApplied = {};
    return cData.meetApplied;
  },
  hasRock(mid, n) {
    const all = (typeof cData !== 'undefined' && cData.rocks) || {};
    return Object.keys(all).some((w) => (all[w] || []).some((r) => r && r.src && r.src.k === 'fathom' && r.src.mid === mid && r.src.n === n));
  },
  when(m) {
    if (!m.at) return '';
    const d = new Date(m.at);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  },
  /* Everything not yet filed. Returns what it did, for the toast and tests. */
  apply() {
    if (typeof cData === 'undefined' || !cData || typeof cSave !== 'function') return { meetings: 0, rocks: 0 };
    const done = Meetings.applied();
    const todayD = new Date(); todayD.setHours(12, 0, 0, 0);
    let meetings = 0, rocks = 0, touched = false;
    const titles = [];
    Meetings.all().forEach((m) => {
      if (!m || !m.id || done[m.id]) return;
      /* On record only: a meeting that was filed by hand before this
         existed, or one older than the day the filing started. Its notes
         sit under the rocks it already has; nothing new is made from it. */
      if (m.legacy) { done[m.id] = true; touched = true; return; }
      meetings++; titles.push(m.title);
      const when = Meetings.when(m);
      try {
        if (typeof J === 'function') J('meeting', '🎙️ ' + m.title + (when ? ' · ' + when : '') + (m.summary ? '\n\n' + m.summary : '') + (m.url ? '\n\n' + m.url : ''));
      } catch (e) {}
      (m.actions || []).forEach((a) => {
        if (!a || a.done || !a.mine || Meetings.hasRock(m.id, a.n)) return;
        let d = todayD;
        if (a.due) { const x = new Date(a.due + 'T12:00:00'); if (!isNaN(x) && x > todayD) d = x; }
        const wid = WeekLoop.wid(d), day = WeekLoop.dow(d);
        (cData.rocks[wid] = cData.rocks[wid] || []).push({
          id: Date.now().toString(36) + Math.floor(Math.random() * 1e4), title: a.text, role: '', day, time: '', end: '', prio: 'med',
          note: 'From Fathom: ' + m.title + (m.url ? ' — ' + m.url : ''), done: false,
          src: { k: 'fathom', mid: m.id, n: a.n }
        });
        rocks++; touched = true;
      });
      done[m.id] = true; touched = true;
    });
    if (Meetings.adopt()) touched = true;
    if (touched) {
      cSave();
      try { if (typeof renderCompass === 'function') renderCompass(); } catch (e) {}
      try { if (typeof renderToday === 'function') renderToday(); } catch (e) {}
    }
    if (meetings) Meetings.toast(meetings === 1 ? titles[0] : meetings + ' meetings', rocks);
    return { meetings, rocks };
  },
  /* Rocks filed from Fathom by the earlier, hand-run import carry the
     meeting only as a line of text: "From Fathom: <title> — <url>". Once
     that meeting is on record, give them the same link a filed rock has,
     so the notes fold under them too. Matched on the recording's URL, or
     failing that its title; the action by its wording. */
  adopt() {
    if (typeof cData === 'undefined' || !cData || !cData.rocks) return false;
    const all = Meetings.all();
    if (!all.length) return false;
    let changed = false;
    Object.keys(cData.rocks).forEach((w) => (cData.rocks[w] || []).forEach((r) => {
      if (!r || r.src || !/^From Fathom: /.test(r.note || '')) return;
      const note = r.note.slice(13);
      const m = all.find((x) => x && x.url && note.indexOf(x.url) >= 0) ||
                all.find((x) => x && x.title && note.indexOf(x.title) === 0);
      if (!m) return;
      const t = String(r.title || '').trim().toLowerCase();
      const a = (m.actions || []).find((x) => String(x.text || '').trim().toLowerCase() === t);
      r.src = { k: 'fathom', mid: m.id, n: a ? a.n : -1 };
      changed = true;
    }));
    return changed;
  },
  toast(what, rocks) {
    let el = document.getElementById('flow-toast');
    if (!el) { el = document.createElement('div'); el.id = 'flow-toast'; document.body.appendChild(el); }
    el.textContent = '🎙️ ' + what + ' filed' + (rocks ? ' · ' + rocks + ' action item' + (rocks === 1 ? '' : 's') + ' added as Big Rocks' : '') + '.';
    el.classList.add('on');
    clearTimeout(Meetings._t); Meetings._t = setTimeout(() => el.classList.remove('on'), 6000);
  },
  /* Ask the server to look at Fathom now, then file whatever came. */
  async pull() {
    const r = await fetch('/api/meetings/pull', { method: 'POST', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not reach the meetings.');
    if (j.added || j.recorded) {
      /* The server wrote the section; bring this device's copy up to it. */
      try {
        const r2 = await fetch('/api/get?key=ld_meetings', { credentials: 'same-origin', cache: 'no-store' });
        const g = await r2.json();
        if (g && g.value != null) { const v = typeof g.value === 'string' ? JSON.parse(g.value) : g.value; try { localStorage.setItem('ld_meetings', JSON.stringify(v)); } catch (e) {} }
      } catch (e) {}
    }
    const filed = Meetings.apply();
    return Object.assign({}, j, { filed });
  },
  /* Light markdown: headings, bullets, bold. Enough for a Fathom summary. */
  md(text) {
    return String(text || '').split('\n').map((line) => {
      const l = line.replace(/\s+$/, '');
      if (!l.trim()) return '';
      const h = /^#{1,6}\s+(.*)$/.exec(l); if (h) return '<h5>' + Meetings.inline(h[1]) + '</h5>';
      const b = /^\s*[-*•]\s+(.*)$/.exec(l); if (b) return '<li>' + Meetings.inline(b[1]) + '</li>';
      return '<p>' + Meetings.inline(l) + '</p>';
    }).join('').replace(/(<li>.*?<\/li>)+/g, (m) => '<ul>' + m + '</ul>');
  },
  /* Bold, and Fathom's [moment](url?timestamp=59.0) links, which open the
     recording at that second — the one part of the summary worth a tap. */
  inline(t) {
    return esc(t)
      .replace(/\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+)\)/g, (m, txt, url) => /^https:\/\/(www\.)?fathom\.video\//.test(url) ? '<a class="flow-link" href="' + url + '" target="_blank" rel="noopener">' + txt + '</a>' : txt)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  },
  /* The meetings live in the account; a rock filed from one on another
     device can reach this one before the meeting itself has. Fetch the
     section once when that happens, then paint again. Throttled, so a
     meeting that is genuinely gone cannot turn every paint into a request. */
  async refetch() {
    const now = Date.now();
    if (Meetings._fetching || (Meetings._fetchedAt && now - Meetings._fetchedAt < 5 * 60 * 1000)) return false;
    Meetings._fetching = true; Meetings._fetchedAt = now;
    try {
      const r = await fetch('/api/get?key=ld_meetings', { credentials: 'same-origin', cache: 'no-store' });
      const g = await r.json();
      if (g && g.value != null) {
        const v = typeof g.value === 'string' ? JSON.parse(g.value) : g.value;
        if (Array.isArray(v)) { try { localStorage.setItem('ld_meetings', JSON.stringify(v)); } catch (e) {} try { Meetings.apply(); } catch (e) {} Meetings.paint(); return true; }
      }
    } catch (e) {}
    finally { Meetings._fetching = false; }
    return false;
  },
  /* The meeting behind a rock, folded under it on Today. */
  paint() {
    const feed = document.getElementById('today-feed');
    if (!feed) return;
    let missing = false;
    feed.querySelectorAll('.td-rock[data-rockid]').forEach((row) => {
      if (row.querySelector('.td-meet')) return;
      const hit = TodayFix.find(row.getAttribute('data-rockid'));
      if (!hit || !hit.r.src || hit.r.src.k !== 'fathom') return;
      const m = Meetings.find(hit.r.src.mid);
      if (!m) { missing = true; return; }
      const note = row.querySelector('.td-rk-note');
      const box = document.createElement('div');
      box.className = 'td-meet';
      const others = (m.actions || []).filter((a) => a.n !== hit.r.src.n);
      const people = (m.people || []).map((p) => p.name || p.email).filter(Boolean);
      box.innerHTML =
        '<div class="td-meet-line">🎙️ <span data-i18n="off">' + esc(m.title) + '</span>' +
          ' · <button type="button" class="td-meet-tg">Notes ▾</button></div>' +
        '<div class="td-meet-body" hidden>' +
          '<p class="td-meet-people">' + (m.at ? esc(Meetings.when(m)) : '') + (people.length ? ' · ' + esc(people.join(', ')) : '') +
            (m.url ? ' · <a class="flow-link" href="' + esc(m.url) + '" target="_blank" rel="noopener">Open recording</a>' : '') + '</p>' +
          (m.summary ? '<div class="td-meet-sum">' + Meetings.md(m.summary) + '</div>' : '<p class="flow-sub">No summary yet.</p>') +
          (others.length ? '<p><b>Other action items</b></p><ul class="td-meet-acts">' + others.map((a) =>
            '<li' + (a.done ? ' class="done"' : '') + '>' + esc(a.text) + ' <small>' + (a.mine ? 'you' : (a.who || 'unassigned')) + (a.due ? ' · ' + esc(a.due) : '') + '</small></li>').join('') + '</ul>' : '') +
        '</div>';
      box.querySelector('.td-meet-tg').addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const b = box.querySelector('.td-meet-body'); b.hidden = !b.hidden;
        e.target.textContent = b.hidden ? 'Notes ▾' : 'Notes ▴';
      });
      if (note) note.replaceWith(box); else (row.querySelector('.rk-title') || row).appendChild(box);
    });
    if (missing) Meetings.refetch().catch(() => {});
  }
};

/* ── Refresh ─────────────────────────────────────────────────────────────
 * Nothing refreshes on its own while the app is being looked at. There
 * used to be a check every three minutes and a button in the header; the
 * check found something to apply often enough that the page kept reloading
 * under people. Now a refresh is something you ask for: pull down at the
 * top of the page (a finger on the phone, the trackpad on a Mac), and the
 * app asks Fathom for new meetings, syncs with the account, and reloads
 * only if something actually changed. Coming back to the app after a long
 * time away still syncs quietly, as it always did — but not after a short
 * one, so flicking between apps never costs a reload. */
const Refresh = {
  QUIET_MS: 10 * 60 * 1000,
  PULL_PX: 84,
  busy: false,
  async now(manual) {
    if (Refresh.busy) return;
    Refresh.busy = true;
    const ind = document.getElementById('flow-ptr');
    if (ind) ind.classList.add('spin');
    try {
      let msg = '';
      if (manual && Connect.list.some((c) => c.id === 'fathom' && c.connected)) {
        try { const r = await Meetings.pull(); if (r.added) msg = r.added + ' new meeting' + (r.added === 1 ? '' : 's') + '. '; } catch (e) {}
      }
      /* Asked for by hand: allowed through the host's reload breaker. */
      try { if (window.__flowSyncNow) window.__flowSyncNow(true); } catch (e) {}
      try { await Inbox.load(); Inbox.paintToday(); } catch (e) {}
      await new Promise((r) => setTimeout(r, 900));
      if (manual) Refresh.say(msg + 'Up to date.');
    } finally {
      Refresh.busy = false;
      if (ind) { ind.classList.remove('spin'); ind.classList.remove('on'); ind.style.transform = ''; }
    }
  },
  say(text) {
    let el = document.getElementById('flow-toast');
    if (!el) { el = document.createElement('div'); el.id = 'flow-toast'; document.body.appendChild(el); }
    el.textContent = text; el.classList.add('on');
    clearTimeout(Refresh._t); Refresh._t = setTimeout(() => el.classList.remove('on'), 2500);
  },
  /* The indicator that follows the pull. */
  indicator() {
    let el = document.getElementById('flow-ptr');
    if (!el) {
      el = document.createElement('div'); el.id = 'flow-ptr'; el.setAttribute('aria-hidden', 'true');
      el.innerHTML = Nav.svg('refresh');
      document.body.appendChild(el);
    }
    return el;
  },
  atTop() { return (window.scrollY || document.documentElement.scrollTop || 0) <= 0; },
  /* Script errors, kept in the account the same way, so a bug that only
     shows on the phone can be read from the Mac. Last twenty, no text a
     person typed — only the message, where it came from, and the device. */
  errors() {
    if (Refresh._errOn) return;
    Refresh._errOn = true;
    const buf = [];
    let t = null;
    const flush = async () => {
      t = null;
      if (!buf.length) return;
      try {
        const log = (await DB.get('flow:diag:errors', [])) || [];
        const ua = (navigator.userAgent || '').slice(0, 80), app = !!(window.Capacitor && window.Capacitor.Plugins);
        buf.splice(0).forEach((e) => log.push(Object.assign({ ua, app, at: new Date().toISOString() }, e)));
        await DB.set('flow:diag:errors', log.slice(-20));
      } catch (e) {}
    };
    const note = (e) => { buf.push(e); if (buf.length > 10) buf.length = 10; if (!t) t = setTimeout(flush, 2500); };
    window.addEventListener('error', (ev) => { try { note({ msg: String(ev.message || '').slice(0, 200), src: String(ev.filename || '').split('/').pop().slice(0, 60) + ':' + (ev.lineno || 0), tab: Nav.current && Nav.current() }); } catch (e) {} });
    window.addEventListener('unhandledrejection', (ev) => { try { const r = ev.reason; note({ msg: 'promise: ' + String(r && r.message || r).slice(0, 200), tab: Nav.current && Nav.current() }); } catch (e) {} });
  },
  /* Why the last reloads happened, kept in the account so a loop on one
     device can be read from another. The host writes the reason to
     sessionStorage just before it reloads; this picks it up after. */
  async diag() {
    let why = null;
    try { why = JSON.parse(sessionStorage.getItem('__flowReloadWhy') || 'null'); sessionStorage.removeItem('__flowReloadWhy'); } catch (e) { why = null; }
    if (!why) return;
    try {
      const log = (await DB.get('flow:diag:reloads', [])) || [];
      log.push(Object.assign({ ua: (navigator.userAgent || '').slice(0, 80), app: !!(window.Capacitor && window.Capacitor.Plugins) }, why));
      await DB.set('flow:diag:reloads', log.slice(-20));
    } catch (e) {}
    if (why.held || (window.__FLOW_SYNC && window.__FLOW_SYNC.held)) { try { Refresh.say('Changes from another device are waiting — pull down to refresh.'); } catch (e) {} }
  },
  boot() {
    /* A long time away is worth a quiet sync on return; a short one is not. */
    try { window.__FLOW_SYNC_GAP_MS = Refresh.QUIET_MS; } catch (e) {}
    try { Refresh.errors(); } catch (e) {}
    (async () => { try { if (window.__FLOW_ALL_READY) await window.__FLOW_ALL_READY; } catch (e) {} await new Promise((r) => setTimeout(r, 800)); Refresh.diag().catch(() => {}); })();
    const ind = Refresh.indicator();
    /* A finger: pull down from the top. The page does not bounce while the
       pull is being measured, so the gesture reads as one thing. */
    let y0 = null, pulling = false;
    document.addEventListener('touchstart', (e) => {
      if (Refresh.busy || !Refresh.atTop() || e.touches.length !== 1) { y0 = null; return; }
      y0 = e.touches[0].clientY; pulling = false;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy <= 0 || !Refresh.atTop()) { if (pulling) { pulling = false; ind.classList.remove('on'); ind.style.transform = ''; } return; }
      pulling = true;
      if (e.cancelable) e.preventDefault();
      const d = Math.min(dy, Refresh.PULL_PX * 1.6);
      ind.classList.add('on');
      ind.classList.toggle('ready', dy >= Refresh.PULL_PX);
      ind.style.transform = 'translate(-50%, ' + (d * 0.6) + 'px) rotate(' + (d * 2) + 'deg)';
    }, { passive: false });
    const end = (e) => {
      if (y0 == null) return;
      const was = pulling; y0 = null; pulling = false;
      if (was && ind.classList.contains('ready')) { ind.classList.remove('ready'); Refresh.now(true); }
      else { ind.classList.remove('on'); ind.classList.remove('ready'); ind.style.transform = ''; }
    };
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
    /* A trackpad or wheel: scrolling up past the top, decisively. */
    let wheel = 0, wheelT = 0;
    document.addEventListener('wheel', (e) => {
      if (Refresh.busy || !Refresh.atTop() || e.deltaY >= 0) { wheel = 0; return; }
      const now = Date.now();
      if (now - wheelT > 500) wheel = 0;
      wheelT = now; wheel += -e.deltaY;
      if (wheel > 320) { wheel = 0; ind.classList.add('on'); ind.style.transform = 'translate(-50%, 40px)'; Refresh.now(true); }
    }, { passive: true });
  }
};

/* ── Apple Health, seen from a Mac ──────────────────────────────────────
 * Health lives on the iPhone; a Mac has no Health app and no way to read
 * one. The iPhone reads it and writes what it found into the account — the
 * sleep log, HRV, resting heart rate — so the numbers are on the Mac
 * already; what was missing was the card that says so. This shows it, as a
 * record of what the iPhone read, with no buttons that could only fail. */
const HealthMirror = {
  native() { try { const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FlowBridge; return !!(p && typeof p.healthRead === 'function'); } catch (e) { return false; } },
  data() { try { const v = S.get('health', null); return v && Array.isArray(v.days) ? v : null; } catch (e) { return null; } },
  paint() {
    if (HealthMirror.native()) return;
    const panel = document.getElementById('healthPanel');
    if (!panel) return;
    const h = HealthMirror.data();
    if (!h || !h.days.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    panel.classList.add('health-mirror');
    const st = document.getElementById('healthStatus');
    if (st) { st.className = 'whoop-status live'; st.textContent = '🟢 Synced from your iPhone'; }
    const allow = document.getElementById('hAllow'), sync = document.getElementById('hSync');
    if (allow) allow.style.display = 'none';
    if (sync) sync.style.display = 'none';
    const desc = panel.querySelector('.whoop-top + div');
    if (desc) desc.textContent = 'Your iPhone reads Health and keeps what it finds in your account, so it shows here too. A Mac cannot read Health itself — open The Flow on the iPhone to read again.';
    const latest = [...h.days].reverse().find((d) => d && (d.hrv != null || d.rhr != null || d.hours != null));
    const foot = document.getElementById('healthFoot');
    if (foot) {
      const bits = [];
      if (latest) {
        if (latest.hours != null) bits.push('sleep ' + Number(latest.hours).toFixed(1) + ' h');
        if (latest.hrv != null) bits.push('HRV ' + latest.hrv + ' ms');
        if (latest.rhr != null) bits.push('resting HR ' + latest.rhr);
      }
      foot.textContent = h.days.length + ' day' + (h.days.length === 1 ? '' : 's') + ' on record' +
        (latest && latest.date ? ' · latest ' + latest.date : '') + (bits.length ? ' · ' + bits.join(' · ') : '') +
        (h.updated ? ' · read ' + new Date(h.updated).toLocaleString('en-GB') : '');
    }
  },
  boot() {
    if (HealthMirror.native()) return;
    /* The host hides the panel every time the Sleep tab is opened on a
       device without Health; paint after it has done so. */
    try {
      const orig = window.syncHealth;
      if (typeof orig === 'function' && !orig.__flowMirror) {
        const wrapped = async function () { try { await orig.apply(this, arguments); } catch (e) {} HealthMirror.paint(); };
        wrapped.__flowMirror = 1;
        window.syncHealth = wrapped;
      }
    } catch (e) {}
    HealthMirror.paint();
  }
};

const TodayFix = {
  find(id) {
    const all = (typeof cData !== 'undefined' && cData.rocks) || {};
    for (const w of Object.keys(all)) {
      const r = (all[w] || []).find((x) => String(x.id) === String(id));
      if (r) return { w, r };
    }
    return null;
  },
  move(id, date) {
    const hit = TodayFix.find(id);
    if (!hit) return;
    const to = WeekLoop.wid(date), day = WeekLoop.dow(date);
    if (to !== hit.w) {
      cData.rocks[hit.w] = cData.rocks[hit.w].filter((x) => x !== hit.r);
      if (!cData.rocks[hit.w].length) delete cData.rocks[hit.w];
      (cData.rocks[to] = cData.rocks[to] || []).push(hit.r);
    }
    hit.r.day = day;
    cSave();
    if (typeof J === 'function') J('planning', '🪨 Big rock moved to ' + WeekLoop.iso(date) + ': ' + hit.r.title);
    TodayFix.redraw();
  },
  done(id) {
    const hit = TodayFix.find(id);
    if (!hit) return;
    hit.r.done = true; cSave();
    if (typeof J === 'function') J('planning', '✅ Big rock done: ' + hit.r.title);
    TodayFix.redraw();
  },
  /* Let it go, without pretending it was done. The journal keeps the line. */
  drop(id) {
    const hit = TodayFix.find(id);
    if (!hit) return;
    cData.rocks[hit.w] = cData.rocks[hit.w].filter((x) => x !== hit.r);
    if (!cData.rocks[hit.w].length) delete cData.rocks[hit.w];
    cSave();
    if (typeof J === 'function') J('planning', '🗑️ Big rock dropped: ' + hit.r.title);
    TodayFix.redraw();
  },
  redraw() {
    try { if (typeof renderToday === 'function') renderToday(); } catch (e) {}
    try { if (typeof renderCompass === 'function') renderCompass(); } catch (e) {}
  },
  /* Every overdue rock at once. The journal keeps each line. */
  dropAllOverdue() {
    const ids = Array.from(document.querySelectorAll('#today-feed .td-rock[data-rockid]')).filter((r) => r.querySelector('.rk-late')).map((r) => r.getAttribute('data-rockid'));
    if (!ids.length) return;
    if (!confirm('Drop all ' + ids.length + ' overdue Big Rocks? They are not marked done; the journal keeps a line for each.')) return;
    ids.forEach((id) => {
      const hit = TodayFix.find(id);
      if (!hit) return;
      cData.rocks[hit.w] = cData.rocks[hit.w].filter((x) => x !== hit.r);
      if (!cData.rocks[hit.w].length) delete cData.rocks[hit.w];
      if (typeof J === 'function') J('planning', '🗑️ Big rock dropped: ' + hit.r.title);
    });
    cSave();
    TodayFix.redraw();
    toast(ids.length + ' overdue rocks dropped.', null, 2000);
  },
  paint() {
    const feed = document.getElementById('today-feed');
    if (!feed) return;
    /* One tap for the pile, at the top of the section, only while there is a pile. */
    try {
      const late = feed.querySelectorAll('.td-rock[data-rockid] .rk-late').length;
      const head = feed.querySelector('.td-rocks:not(#td-cal) .td-rocks-head');
      let b = head && head.querySelector('.td-dropall');
      if (head && late >= 2 && !b) {
        b = document.createElement('button'); b.type = 'button'; b.className = 'td-dropall';
        b.addEventListener('click', (e) => { e.preventDefault(); TodayFix.dropAllOverdue(); });
        head.insertBefore(b, head.querySelector('.cnt'));
      }
      if (b) { if (late >= 2) b.textContent = 'Drop all overdue (' + late + ')'; else b.remove(); }
    } catch (e) {}
    feed.querySelectorAll('.td-rock[data-rockid]').forEach((row) => {
      if (!row.querySelector('.rk-late') || row.querySelector('.td-fix')) return;
      const box = document.createElement('div');
      box.className = 'td-fix';
      box.innerHTML = '<button type="button" data-fix="today">Today</button><button type="button" data-fix="tomorrow">Tomorrow</button><button type="button" data-fix="done">Done</button><button type="button" data-fix="drop" class="ghost">Drop</button>';
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-fix]');
        if (!b) return;
        e.stopPropagation(); e.preventDefault();
        const id = row.getAttribute('data-rockid');
        const d = new Date(); d.setHours(12, 0, 0, 0);
        if (b.getAttribute('data-fix') === 'tomorrow') d.setDate(d.getDate() + 1);
        const what = b.getAttribute('data-fix');
        if (what === 'done') TodayFix.done(id);
        else if (what === 'drop') TodayFix.drop(id);
        else TodayFix.move(id, d);
      });
      const t = row.querySelector('.rk-title') || row;
      t.appendChild(box);
    });
  }
};

/* Hide what you do not use. */
const Sections = {
  FIXED: ['today', 'settings'],
  hidden() { const v = Settings.get('hiddenTabs'); return Array.isArray(v) ? v : []; },

  /* Fewer sections by default. A new account starts without Finances and
     Priorities in the menu; an account that already exists loses only the
     ones it has never put anything in — somebody with expenses logged keeps
     Finances exactly where it was. Runs once, and says what it did. */
  async migrate() {
    const v = Settings.get('sectionsV') || 0;
    if (v >= 4) return;
    /* Finances and Priorities were taken out of the menu for a day. They
       are back for everyone; hiding is something a person does themselves. */
    if (v >= 1 && v < 3) {
      const hid = Sections.hidden().filter((t) => t !== 'finance' && t !== 'quad');
      if (hid.length !== Sections.hidden().length) { await Settings.set('hiddenTabs', hid); Sections.apply(); }
    }
    /* The price strip became a widget, off for new accounts. An account
       that was already using the app keeps it exactly where it was — a
       thing being optional is not a reason to take it off anyone's screen. */
    if (v < 4) {
      /* "Already using the app" = the account is older than the change. An
         account with no creation time on record is older than the field
         itself, which makes it the oldest kind there is. */
      const WIDGET_DAY = Date.parse('2026-10-22T13:40:00Z');
      /* The server answers `created: null` for an account older than the
         field; a user object without the field at all is one painted from
         cache before the server answered — decide next time, not now. */
      if (!Auth.user || !('created' in Auth.user)) return;
      let existed = false;
      try { const c = Auth.user.created; existed = c === null || (!!c && Date.parse(c) < WIDGET_DAY); } catch (e) {}
      if (existed && Settings.get('todayMarkets') !== true) {
        await Settings.set('todayMarkets', true);
        Markets.refresh().catch(() => {});
      }
    }
    await Settings.set('sectionsV', 4);
  },
  apply() {
    let st = document.getElementById('fn-hide');
    if (!st) { st = document.createElement('style'); st.id = 'fn-hide'; document.head.appendChild(st); }
    st.textContent = Sections.hidden().filter((t) => /^[a-z0-9_-]+$/i.test(t))
      .map((t) => '[data-fn-side="' + t + '"],[data-fn-seg="' + t + '"]{display:none!important}').join('\n');
  },
  wire(section) {
    if (section.querySelector('#secCard')) return;
    const anchor = section.querySelector('#connCard') || section.querySelector('.flow-card');
    if (!anchor) return;
    const tabs = Nav.allTabs().filter((t) => Sections.FIXED.indexOf(t) < 0 && Nav.pill(t));
    const hid = Sections.hidden();
    const card = document.createElement('div');
    card.className = 'flow-card'; card.id = 'secCard';
    card.innerHTML = '<h3>🧹 Sections</h3><p class="flow-sub">Untick what you don’t use. It disappears from the menu; nothing is deleted, and ticking it brings it back.</p>' +
      '<div class="sec-grid">' + tabs.map((t) => '<label class="sec-it"><input type="checkbox" data-sec="' + esc(t) + '"' + (hid.indexOf(t) < 0 ? ' checked' : '') + '> ' + esc(Nav.label(t)) + '</label>').join('') + '</div>';
    anchor.parentNode.insertBefore(card, anchor);
    card.addEventListener('change', async (e) => {
      const c = e.target.closest('[data-sec]');
      if (!c) return;
      const t = c.getAttribute('data-sec');
      const now = Sections.hidden().filter((x) => x !== t);
      if (!c.checked) now.push(t);
      await Settings.set('hiddenTabs', now);
      Sections.apply();
      toast(c.checked ? 'Shown in the menu.' : 'Hidden from the menu.', null, 1400);
    });
  }
};

/* ── The trial: feedback in, and what the owner sees ─────────────────────
 * Everyone gets a two-line box to say what is confusing or missing; the
 * owner also gets who has joined and every note, newest first. Nothing about
 * anybody's own data is shown — names, dates and what they wrote here. */
const Trial = {
  wire(section) {
    if (section.querySelector('#fbCard')) return;
    const anchor = section.querySelector('#secCard') || section.querySelector('#connCard') || section.querySelector('.flow-card');
    if (!anchor) return;
    const owner = !!(Auth.user && Auth.user.owner);
    const card = document.createElement('div');
    card.className = 'flow-card'; card.id = 'fbCard';
    card.innerHTML = '<h3>💬 Feedback</h3><p class="flow-sub">What is confusing, missing or annoying? It goes straight to Artur.</p>' +
      '<textarea id="fbText" rows="3" class="fb-ta" placeholder="Say it plainly — one thing is enough."></textarea>' +
      '<div class="flow-row" style="margin-top:8px;gap:10px;align-items:center"><button type="button" class="flow-btn primary" id="fbSend">Send</button><span class="flow-sub" id="fbOut"></span></div>' +
      (owner ? '<div id="fbOwner" class="fb-owner"><p class="flow-sub">Loading the trial…</p></div>' : '');
    anchor.parentNode.insertBefore(card, anchor);
    card.querySelector('#fbSend').addEventListener('click', async () => {
      const ta = card.querySelector('#fbText'), out = card.querySelector('#fbOut');
      const text = ta.value.trim();
      if (!text) return;
      try {
        const r = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, where: 'settings' }) });
        if (!r.ok) throw new Error();
        ta.value = ''; out.textContent = 'Sent — thank you.';
        if (owner) Trial.paintOwner(card);
      } catch (e) { out.textContent = 'Could not send — try again.'; }
    });
    if (owner) Trial.paintOwner(card);
  },
  async paintOwner(card) {
    const box = card.querySelector('#fbOwner');
    if (!box) return;
    try {
      const r = await fetch('/api/feedback', { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error();
      const people = (j.people || []).filter((x) => !x.owner);
      const d = (s) => s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
      box.innerHTML = '<h4>Trial · ' + people.length + ' of ' + (j.maxAccounts || 10) + ' places used</h4>' +
        (people.length ? '<div class="fb-people">' + people.map((x) => '<span>' + esc(x.name || x.email) + ' <small>' + esc(d(x.created)) + '</small></span>').join('') + '</div>'
          : '<p class="flow-sub">Nobody has joined yet. They sign up at theflow.today or in the iPhone and Mac apps.</p>') +
        '<h4>Notes (' + (j.feedback || []).length + ')</h4>' +
        ((j.feedback || []).length ? (j.feedback || []).map((f) => '<div class="fb-note"><b>' + esc(f.name || f.email) + '</b> <small>' + esc(d(f.at)) + '</small><p>' + esc(f.text) + '</p></div>').join('')
          : '<p class="flow-sub">No notes yet.</p>');
    } catch (e) { box.innerHTML = '<p class="flow-sub">The trial view could not load.</p>'; }
  }
};

/* ── Send things in from anywhere ───────────────────────────────────────
 *
 * A private address that anything can post to: Zapier, Make, an iPhone
 * Shortcut, IFTTT, a mail rule, a script. Whatever arrives waits in the
 * same "Shared with you" box as a task from a person, and nothing lands in
 * the plan until it is pressed Add on. The URL is the whole secret: it can
 * be swapped for a new one at any time, and the old one stops at once.
 */
/* ── Where your data is, in Settings ────────────────────────────────────
 * The database pill, the save line and Backup / Restore used to sit on
 * Today and in the Journal: diagnostics on the screens meant for the day.
 * They live here now, together, and the host's updateDbIndicator() and
 * S.saved() write into these ids exactly as they did the old ones. */
/* ── Settings, in three rooms ────────────────────────────────────────────
 * Sixteen cards on one page made Settings the longest screen in the app, and
 * the things you look for once a year (password, recovery codes, a backup)
 * sat between the things you change every week. The avatar menu now opens
 * Settings in one of three views — the settings themselves, Privacy &
 * security, or Feedback — and Settings gets a row of chips to jump between
 * its own cards. Nothing moved out of the page: the cards are tagged and the
 * view decides which are shown, so every handler keeps working. */
const SetView = {
  view: 'main',
  opening: false,
  TITLE: { main: 'Settings', privacy: 'Privacy & security', help: 'Feedback' },
  SUB: { main: 'Preferences · integrations', privacy: 'Your account and your data', help: 'Straight to Artur' },

  tag(section) {
    section.querySelectorAll(':scope > .flow-card, :scope .flow-card').forEach((c) => {
      if (c.dataset.setv) return;
      if (c.querySelector('[data-act2="changepw"]')) { c.dataset.setv = 'privacy'; c.id = c.id || 'acctCard'; }
      else if (c.id === 'dataCard') c.dataset.setv = 'privacy';
      else if (c.id === 'fbCard') c.dataset.setv = 'help';
      else c.dataset.setv = 'main';
    });
  },

  apply(section) {
    section = section || document.getElementById('tab-settings');
    if (!section) return;
    SetView.tag(section);
    const v = SetView.view;
    section.setAttribute('data-setview', v);
    const hero = section.querySelector('.flow-hero');
    if (hero) {
      hero.textContent = SetView.TITLE[v] || 'Settings';
      const lab = hero.previousElementSibling;
      if (lab && lab.classList.contains('flow-label')) lab.textContent = SetView.SUB[v] || '';
    }
    let bar = section.querySelector('#set-viewbar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'set-viewbar';
      const head = hero && hero.parentElement;
      if (head && head.parentNode === section) head.after(bar); else section.prepend(bar);
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-setgo]');
        if (!b) return;
        const to = b.getAttribute('data-setgo');
        if (to === 'main') { SetView.view = 'main'; SetView.apply(section); window.scrollTo(0, 0); return; }
        const card = section.querySelector('#' + CSS.escape(to));
        if (card) { const y = card.getBoundingClientRect().top + window.scrollY - 70; window.scrollTo({ top: y, behavior: 'smooth' }); }
      });
    }
    if (v === 'main') {
      const cards = [...section.querySelectorAll('.flow-card[data-setv="main"]')];
      cards.forEach((c, i) => { if (!c.id) c.id = 'setc-' + i; });
      bar.innerHTML = '<div class="set-chips">' + cards.map((c) => {
        const h = c.querySelector('h3');
        const t = h ? h.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim() : '';
        return t ? '<button type="button" data-setgo="' + esc(c.id) + '">' + esc(t) + '</button>' : '';
      }).join('') + '</div>';
    } else {
      bar.innerHTML = '<button type="button" class="set-back" data-setgo="main">‹ Settings</button>';
    }
  },

  open(view) {
    SetView.view = SetView.TITLE[view] ? view : 'main';
    SetView.opening = true;
    try { Nav.go('settings'); } finally { SetView.opening = false; }
    SetView.apply();
    window.scrollTo(0, 0);
  },

  boot() {
    /* Any other way into Settings — the sidebar, search, a link — lands on
       the settings themselves, not on whichever room was open last. */
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('.tab[data-tab="settings"], [data-fn-side="settings"], [data-fn-seg="settings"]');
      if (t && !SetView.opening && SetView.view !== 'main') { SetView.view = 'main'; setTimeout(() => SetView.apply(), 0); }
    }, true);
  }
};

/* ── Phone typing and empty time boxes ───────────────────────────────── */
const Typing = {
  isField(el) {
    return !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable ||
      (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|color|file)$/i.test(el.type || '')));
  },
  mark(el) {
    if (!el || el.type !== 'time') return;
    if (!el.dataset.ph) el.dataset.ph = '--:--';
    el.classList.toggle('fl-empty', !el.value);
  },
  scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[type="time"]')) Typing.mark(root);
    root.querySelectorAll('input[type="time"]').forEach(Typing.mark);
  },
  boot() {
    document.addEventListener('focusin', (e) => { if (Typing.isField(e.target)) document.body.classList.add('fl-typing'); });
    document.addEventListener('focusout', () => setTimeout(() => {
      if (!Typing.isField(document.activeElement)) document.body.classList.remove('fl-typing');
    }, 60));
    const on = (e) => Typing.mark(e.target);
    document.addEventListener('input', on, true);
    document.addEventListener('change', on, true);
    Typing.scan(document);
    if (window.MutationObserver) new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) Typing.scan(n);
    }).observe(document.body, { childList: true, subtree: true });
  }
};

const DataCard = {
  /* One file for everything: the app's own sections (every ld_* key) and
     what this pack keeps beside them (settings, schedules, expenses, notes,
     the North Star, the scoreboard — every flow:* key this device has
     seen). There used to be two backups that each left half out. */
  dump() {
    const data = {}, pack = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.indexOf('ld_') === 0) data[k] = localStorage.getItem(k);
        else if (k.indexOf('flowpack:') === 0) { try { pack[k.slice(9)] = JSON.parse(localStorage.getItem(k)); } catch (e) {} }
      }
    } catch (e) {}
    /* What is in memory is newer than any mirror, and never too big. */
    try { pack[SETTINGS_KEY] = Settings.data; pack[SCHEDULE_KEY] = Schedule.map; pack[EXPENSE_KEY] = Finance.items; pack[NOTES_KEY] = Notes.book; } catch (e) {}
    return { exported: new Date().toISOString(), app: 'the-flow-dashboard-v2', version: window.__FLOW_UPGRADE__, data, pack };
  },
  backup() {
    const d = DataCard.dump();
    download('the-flow-backup-' + today() + '.json', JSON.stringify(d, null, 1), 'application/json');
    try { if (typeof J === 'function') J('planning', '💾 Backup exported (' + Object.keys(d.data).length + ' sections, ' + Object.keys(d.pack).length + ' pack keys)'); } catch (e) {}
  },
  /* The host's own restore handles the ld_* half of the same file (and the
     cloud save and the reload). This puts the pack half back first. */
  async restorePack(obj) {
    const pack = obj && obj.pack;
    if (!pack || typeof pack !== 'object') return 0;
    let n = 0;
    for (const k of Object.keys(pack)) {
      if (!/^flow:/.test(k)) continue;
      try { await DB.set(k, pack[k]); n++; } catch (e) {}
    }
    return n;
  },
  wire(section) {
    if (section.querySelector('#dataCard')) return;
    const anchor = section.querySelector('#ibCard') || section.querySelector('#fbCard') || section.querySelector('#secCard') || section.querySelector('.flow-card');
    if (!anchor) return;
    const card = document.createElement('div');
    card.className = 'flow-card'; card.id = 'dataCard';
    card.innerHTML = '<h3>💾 Your data</h3>' +
      '<p class="flow-sub">Where it is kept, when it was last saved, and a copy you can keep.</p>' +
      '<div class="data-line"><span class="dbind" id="dbInd4"></span><span class="saveind" id="saveInd4"></span></div>' +
      '<div class="flow-row" style="margin-top:10px;gap:8px;flex-wrap:wrap">' +
        '<button type="button" class="flow-btn" id="dataBackup">💾 Backup</button>' +
        '<label class="flow-btn ghost" for="jnImportFile" style="cursor:pointer">📥 Restore</label>' +
      '</div>' +
      '<p class="flow-sub" style="margin-top:8px">Backup downloads everything — every section, your settings, notes and scores — as one JSON file. Restore reads one back in and replaces what is here.</p>';
    anchor.parentNode.insertBefore(card, anchor);
    card.querySelector('#dataBackup').addEventListener('click', () => DataCard.backup());
    const rf = document.getElementById('jnImportFile');
    if (rf && !rf.__flowPack) {
      rf.__flowPack = 1;
      rf.addEventListener('change', () => {
        const f = rf.files && rf.files[0]; if (!f) return;
        const fr = new FileReader();
        fr.onload = () => { try { DataCard.restorePack(JSON.parse(String(fr.result))).catch(() => {}); } catch (e) {} };
        fr.readAsText(f);
      }, true);
    }
    try { if (typeof updateDbIndicator === 'function') updateDbIndicator(); } catch (e) {}
    try { if (typeof S !== 'undefined' && S && typeof S.saved === 'function') S.saved(); } catch (e) {}
  }
};

const InboxLink = {
  wire(section) {
    if (section.querySelector('#ibCard')) return;
    const anchor = section.querySelector('#fbCard') || section.querySelector('#secCard') || section.querySelector('.flow-card');
    if (!anchor) return;
    const card = document.createElement('div');
    card.className = 'flow-card'; card.id = 'ibCard';
    card.innerHTML = '<h3>📮 Send things in from anywhere</h3>' +
      '<p class="flow-sub">A private address for your Flow. Anything that can send a web request can drop a task here: Zapier, Make, an iPhone Shortcut, IFTTT, a script. It waits under Shared with you on Today until you press Add.</p>' +
      '<div class="ib-url"><code id="ibUrl">…</code><button type="button" class="flow-btn small" id="ibCopy">Copy</button><button type="button" class="flow-btn small ghost" id="ibRotate">New address</button></div>' +
      '<p class="flow-sub" id="ibOut"></p>' +
      '<details class="ib-how"><summary>How to use it</summary>' +
      '<p>Send a <b>POST</b> to the address with JSON like <code>{"text": "Call the accountant", "due": "2026-10-28", "time": "10:00", "note": "about Q4", "source": "Zapier"}</code>. Only <code>text</code> is required. A plain-text body works too.</p>' +
      '<ul><li><b>Zapier / Make:</b> add a <i>Webhooks → POST</i> step, paste the address, map your fields to <code>text</code>, <code>note</code>, <code>due</code>.</li>' +
      '<li><b>iPhone Shortcut:</b> <i>Get Contents of URL</i> → Method POST → Request Body JSON → add <code>text</code>. Put it in the Share Sheet and anything on your phone can become a task.</li>' +
      '<li><b>Email:</b> a Zapier or Make trigger on starred or labelled mail, then the POST step.</li></ul>' +
      '<p>Treat the address like a password. If it gets out, press <b>New address</b>.</p></details>';
    anchor.parentNode.insertBefore(card, anchor);
    const urlEl = card.querySelector('#ibUrl'), out = card.querySelector('#ibOut');
    const paint = async (rotate) => {
      try {
        const r = await fetch('/api/inbox/key' + (rotate ? '/rotate' : ''), { method: rotate ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || '');
        urlEl.textContent = j.url;
        if (rotate) out.textContent = 'New address made. The old one no longer works.';
      } catch (e) { urlEl.textContent = 'Could not load the address.'; }
    };
    card.querySelector('#ibCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(urlEl.textContent); out.textContent = 'Copied.'; }
      catch (e) { out.textContent = 'Select the address and copy it.'; }
    });
    card.querySelector('#ibRotate').addEventListener('click', () => {
      if (confirm('Make a new address? Anything using the old one will stop working.')) paint(true);
    });
    paint(false);
  }
};

const Connect = {
  list: [],
  ready: {},          /* provider id → { url, expires } prepared for an in-app tap */

  inApp() {
    return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.flowBridge);
  },

  photo() {
    const g = Connect.list.find(c => c.connected && c.photo);
    return g ? g.photo : null;
  },

  async load() {
    try {
      const r = await fetch('/api/connect/list', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return Connect.list;
      const j = await r.json();
      Connect.list = Array.isArray(j.connections) ? j.connections : [];
    } catch (e) {}
    Connect.paintFace();
    return Connect.list;
  },

  /* The photo replaces the letter in the header avatar and the person icon
     beside the account's name in the sidebar. With no photo both go back to
     what they were, so disconnecting leaves nothing half-drawn. */
  paintFace() {
    const src = Connect.photo();
    const av = document.getElementById('fn-avatar');
    if (av) {
      if (src) { av.innerHTML = '<img class="fn-face" alt="" src="' + esc(src) + '">'; av.classList.add('has-face'); }
      else { av.classList.remove('has-face'); av.textContent = Nav.initial(); }
    }
    const side = Nav.sideEl && Nav.sideEl.querySelector('[data-fn-side="artur"]');
    if (side) {
      const old = side.querySelector('svg, img.fn-face');
      if (src) {
        const img = document.createElement('img');
        img.className = 'fn-face fn-i'; img.alt = ''; img.src = src;
        if (old) old.replaceWith(img); else side.insertBefore(img, side.firstChild);
      } else if (old && old.tagName === 'IMG') {
        const tmp = document.createElement('span');
        tmp.innerHTML = Nav.svg(Nav.ICON.artur || 'user');
        old.replaceWith(tmp.firstElementChild || tmp);
      }
    }
  },

  async start(id, app) {
    const r = await fetch('/api/connect/' + id + '/start', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: !!app })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) throw new Error(j.error || 'Could not start.');
    return j;
  },

  async prepare(id) {
    const have = Connect.ready[id];
    if (have && have.expires - Date.now() > 60 * 1000) return have;
    const j = await Connect.start(id, true);
    Connect.ready[id] = { url: j.url, expires: j.expires || (Date.now() + 9 * 60 * 1000) };
    return Connect.ready[id];
  },

  row(c) {
    const face = c.photo
      ? '<img class="conn-face" alt="" src="' + esc(c.photo) + '">'
      : '<span class="conn-face conn-mark">' + esc((c.name || '?')[0]) + '</span>';
    const accts = Array.isArray(c.accounts) && c.accounts.length ? c.accounts
      : (c.connected ? [{ aid: '', email: c.email, name: c.name_on_account, broken: c.broken, target: c.target }] : []);
    const isKey = c.kind === 'key';
    const keyForm = () => '<form class="conn-keyform" data-conn-keyform="' + esc(c.id) + '" hidden>' +
      '<p class="flow-sub">' + esc(c.keyHelp || '') +
      (c.keyUrl ? ' <a href="' + esc(c.keyUrl) + '" target="_blank" rel="noopener">Open ' + esc(c.name) + ' ↗</a>' : '') + '</p>' +
      '<div class="conn-keyrow"><input type="password" autocomplete="off" spellcheck="false" placeholder="' + esc(c.keyLabel || 'Key') + '">' +
      '<button type="submit" class="flow-btn sm primary">Save</button></div></form>';
    const addBtn = (label) => '<button type="button" class="flow-btn sm ' + (accts.length ? '' : 'primary') + '" data-conn-' +
      (isKey ? 'key' : 'on') + '="' + esc(c.id) + '">' + label + '</button>';

    if (!c.configured) {
      return '<div class="conn-row" data-conn="' + esc(c.id) + '">' + face +
        '<div class="conn-t"><b>' + esc(c.name) + '</b><span>Not set up on this server yet.</span></div>' +
        '<button type="button" class="flow-btn sm" disabled>Connect</button></div>';
    }
    if (!accts.length) {
      return '<div class="conn-row" data-conn="' + esc(c.id) + '">' + face +
        '<div class="conn-t"><b>' + esc(c.name) + '</b><span>' + esc(c.blurb || '') + '</span></div>' +
        addBtn('Connect') + (isKey ? keyForm() : '') + '</div>';
    }
    /* Connected: one line per account, then what the connection does (for
       every account at once), then a way to add another. */
    const lines = accts.map((a) => {
      const who = esc(a.email || a.name || 'Connected');
      const fix = a.broken && !isKey
        ? '<button type="button" class="flow-btn sm primary" data-conn-on="' + esc(c.id) + '">Reconnect</button>' : '';
      const notion = c.id === 'notion'
        ? '<button type="button" class="flow-btn sm" data-conn-act="notion-pick" data-aid="' + esc(a.aid) + '">' +
          (a.target ? 'Page: ' + esc(a.target) : 'Choose a page') + '</button>' +
          (a.target ? '<button type="button" class="flow-btn sm" data-conn-act="notion-send" data-aid="' + esc(a.aid) + '">Send this week</button>' : '')
        : '';
      return '<div class="conn-acct" data-aid="' + esc(a.aid) + '"><span class="conn-who">' + who +
        (a.broken ? ' · <em>needs reconnecting</em>' : '') + '</span>' + notion + fix +
        '<button type="button" class="flow-btn sm ghost" data-conn-off="' + esc(c.id) + '" data-aid="' + esc(a.aid) + '">Disconnect</button></div>';
    }).join('');
    const act = {
      fathom: '<button type="button" class="flow-btn sm" data-conn-act="fathom">Check for meetings now</button>',
      gmail: '<button type="button" class="flow-btn sm" data-conn-act="gmail">Add starred emails as Big Rocks</button>',
      outlook: '<button type="button" class="flow-btn sm" data-conn-act="outlook">Add flagged emails as Big Rocks</button>',
      gcal: '<span class="flow-sub">Today’s meetings show on Today.</span>'
    }[c.id] || '';
    const many = c.id !== 'google';
    return '<div class="conn-row" data-conn="' + esc(c.id) + '">' + face +
      '<div class="conn-t"><b>' + esc(c.name) + '</b><span>' + esc(accts.length > 1 ? accts.length + ' accounts' : (c.blurb || '')) + '</span></div>' +
      '<div class="conn-accts">' + lines + '</div>' +
      '<div class="conn-acts">' + act + (many ? addBtn('+ Add another account') : '') + '<span class="conn-out flow-sub"></span></div>' +
      (isKey && many ? keyForm() : '') + '</div>';
  },

  async wire(section) {
    const box = section.querySelector('#connList');
    if (!box) return;
    const paint = async () => {
      await Connect.load();
      if (!Connect.list.length) { box.innerHTML = '<div class="flow-sub">Nothing to connect on this server yet.</div>'; return; }
      box.innerHTML = Connect.list.map(Connect.row).join('') +
        '<p class="flow-sub conn-more">Keys you paste stay on The Flow\u2019s server and are never shown again. Disconnecting deletes them.</p>';
      if (Connect.inApp()) {
        Connect.list.filter(c => c.configured && !c.connected).forEach(c =>
          Connect.prepare(c.id).catch(() => {}));
      }
    };
    box.addEventListener('submit', async (ev) => {
      const form = ev.target.closest('[data-conn-keyform]');
      if (!form) return;
      ev.preventDefault();
      const id = form.getAttribute('data-conn-keyform');
      const input = form.querySelector('input');
      const btn = form.querySelector('button');
      const key = (input.value || '').trim();
      if (!key) return;
      btn.disabled = true; btn.textContent = '…';
      try {
        const r = await fetch('/api/connect/' + id + '/key', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'That key did not work.');
        input.value = '';
        toast((Connect.list.find(c => c.id === id) || {}).name + ' connected ✓', null, 2400);
        await paint();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Save';
        toast(e.message || 'That key did not work.', 'err', 4200);
      }
    });
    box.addEventListener('click', async (ev) => {
      const keyBtn = ev.target.closest('[data-conn-key]');
      if (keyBtn) {
        const form = box.querySelector('[data-conn-keyform="' + keyBtn.getAttribute('data-conn-key') + '"]');
        if (form) { form.hidden = !form.hidden; if (!form.hidden) { const i = form.querySelector('input'); if (i) i.focus(); } }
        return;
      }
      const act = ev.target.closest('[data-conn-act]');
      if (act) {
        const row = act.closest('.conn-row');
        const out = row && row.querySelector('.conn-out');
        act.disabled = true;
        try {
          const msg = await ConnectApps.run(act.getAttribute('data-conn-act'), row, act.getAttribute('data-aid') || '');
          if (out && msg) out.textContent = msg;
          if (act.getAttribute('data-conn-act') === 'notion-pick') await paint();
        } catch (e) {
          if (out) out.textContent = '';
          toast(e.message || 'That did not work.', 'err', 4200);
        }
        act.disabled = false;
        return;
      }
      const on = ev.target.closest('[data-conn-on]');
      const off = ev.target.closest('[data-conn-off]');
      if (on) {
        const id = on.getAttribute('data-conn-on');
        if (Connect.inApp()) {
          const ready = Connect.ready[id];
          if (!ready || ready.expires < Date.now()) {
            on.disabled = true;
            try { await Connect.prepare(id); toast('Ready — tap Connect again.', null, 2400); }
            catch (e) { toast(e.message || 'Could not start.', 'err'); }
            on.disabled = false;
            return;
          }
          delete Connect.ready[id];   /* a state is good once */
          window.open(ready.url, '_blank');
          toast('Finish in your browser, then come back here.', null, 4000);
          return;
        }
        on.disabled = true;
        try { const j = await Connect.start(id, false); location.href = j.url; }
        catch (e) { on.disabled = false; toast(e.message || 'Could not start.', 'err'); }
        return;
      }
      if (off) {
        const id = off.getAttribute('data-conn-off');
        const aid = off.getAttribute('data-aid') || '';
        off.disabled = true;
        try {
          const r = await fetch('/api/connect/' + id + '/disconnect', { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aid ? { aid } : {}) });
          if (!r.ok) throw new Error();
          toast('Disconnected.', null, 1600);
        } catch (e) { toast('Could not disconnect — try again.', 'err'); }
        await paint();
      }
    });
    await paint();
    /* Back from the browser: the app was in the background while the person
       signed in there, so read the list again when it comes to the front. */
    if (!Connect._vis) {
      Connect._vis = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const live = document.getElementById('connList');
        if (live && live.isConnected) paint(); else Connect.load();
      });
    }
  },

  /* After a round trip in this same tab the server sends the page back with
     ?connect=google:connected; say so once and take it out of the address. */
  announce() {
    try {
      const q = new URLSearchParams(location.search);
      const v = q.get('connect');
      if (!v) return;
      const [id, status] = v.split(':');
      const name = (Connect.list.find(c => c.id === id) || {}).name || 'That app';
      const say = {
        connected: [name + ' connected ✓', null],
        denied: ['Permission was not given.', 'err'],
        expired: ['That took too long — try connecting again.', 'err'],
        mismatch: ['Signed in as somebody else — try again.', 'err'],
        scope: ['The permission The Flow needs was unticked — connect again and leave it ticked.', 'err']
      }[status] || ['Could not connect ' + name + '.', 'err'];
      toast(say[0], say[1], 3200);
      q.delete('connect');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    } catch (e) {}
  },

  async boot() {
    await Connect.load();
    Connect.announce();
    try { ConnectApps.calendarBoot(); } catch (e) {}
  }
};

/* ── What each connection does, once it is connected ─────────────────────
 *
 * Imports are remembered by id in the account's own data (`connSeen`), so a
 * meeting or an email becomes one Journal entry or one Big Rock however many
 * devices press the button. Everything lands through the app's own functions
 * — addRock(), J() — so it is saved and synced exactly as if typed.
 */
const ConnectApps = {
  seen() {
    let v = {};
    try { v = (typeof S !== 'undefined' && S.get('connSeen', {})) || {}; } catch (e) {}
    return v && typeof v === 'object' ? v : {};
  },
  markSeen(kind, ids) {
    const v = ConnectApps.seen();
    const list = Array.isArray(v[kind]) ? v[kind] : [];
    ids.forEach((id) => { if (list.indexOf(id) < 0) list.push(id); });
    v[kind] = list.slice(-500);
    try { S.set('connSeen', v); } catch (e) {}
  },
  async get(path) {
    const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'That did not work.');
    return j;
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'That did not work.');
    return j;
  },
  today() {
    const d = new Date();
    const wid = (typeof weekId === 'function') ? weekId(d) : Notify.weekId(d);
    return { wid, day: (d.getDay() + 6) % 7 };
  },
  rock(title, note) {
    const t = ConnectApps.today();
    if (typeof addRock !== 'function') throw new Error('Open the Week Compass once, then try again.');
    addRock(String(title).slice(0, 200), '', t.day, '', t.wid, { note: note || '', prio: 'med' });
  },

  async run(what, row, aid) {
    if (what === 'fathom') return ConnectApps.fathom();
    if (what === 'gmail') return ConnectApps.mail('gmail', 'starred', 'starred');
    if (what === 'outlook') return ConnectApps.mail('outlook', 'flagged', 'flagged');
    if (what === 'notion-pick') return ConnectApps.notionPick(row, aid);
    if (what === 'notion-send') return ConnectApps.notionSend(aid);
    return '';
  },
  /* Something went wrong with one account but not the others: say which. */
  partial(j) {
    const p = (j && j.problems) || [];
    return p.length ? ' (' + p.map((x) => x.account + ': ' + x.error).join('; ') + ')' : '';
  },

  async fathom() {
    const r = await Meetings.pull();
    const f = r.filed || {};
    if (!r.added && !f.meetings) return 'Nothing new. Meetings are brought in on their own every few minutes.' + ConnectApps.partial(r);
    const n = f.meetings || r.added;
    return n + ' meeting' + (n === 1 ? '' : 's') + ' filed' +
      (f.rocks ? ', ' + f.rocks + ' action item' + (f.rocks === 1 ? '' : 's') + ' added as Big Rocks' : '') +
      (r.queued ? ', ' + r.queued + ' unassigned in Shared with you' : '') + '.' + ConnectApps.partial(r);
  },
  async fathomLegacy() {
    const seen = ConnectApps.seen().fathom || [];
    const j = await ConnectApps.get('/api/connect/fathom/meetings');
    const meAll = String(j.me || '').toLowerCase();
    const fresh = (j.meetings || []).filter((m) => m.id && seen.indexOf(m.id) < 0)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    let rocks = 0;
    fresh.forEach((m) => {
      const when = m.at ? new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const body = '🎙️ ' + m.title + (when ? ' · ' + when : '') +
        (m.summary ? '\n\n' + m.summary : '') + (m.url ? '\n\n' + m.url : '');
      if (typeof J === 'function') J('meeting', body);
      /* Your own action items, and anybody's that nobody owns. */
      const me = String(m.me || meAll || '').toLowerCase();
      (m.actions || []).filter((a) => !a.email || !me || a.email.toLowerCase() === me).forEach((a) => {
        ConnectApps.rock(a.text, 'From Fathom: ' + m.title + (m.url ? ' — ' + m.url : ''));
        rocks++;
      });
    });
    ConnectApps.markSeen('fathom', fresh.map((m) => m.id));
    if (!fresh.length) return 'Nothing new from the last two weeks.' + ConnectApps.partial(j);
    return fresh.length + ' meeting' + (fresh.length === 1 ? '' : 's') + ' added to your Journal' +
      (rocks ? ', ' + rocks + ' action item' + (rocks === 1 ? '' : 's') + ' added as Big Rocks for today.' : '.');
  },

  async mail(id, step, word) {
    const seen = ConnectApps.seen()[id] || [];
    const j = await ConnectApps.get('/api/connect/' + id + '/' + step);
    const fresh = (j.messages || []).filter((m) => m.id && seen.indexOf(m.id) < 0);
    fresh.forEach((m) => ConnectApps.rock('\u2709\ufe0f ' + m.subject,
      (m.from ? 'From ' + m.from + ' \u2014 ' : '') + (m.account ? m.account + ' \u2014 ' : '') + m.link));
    ConnectApps.markSeen(id, fresh.map((m) => m.id));
    return (fresh.length
      ? fresh.length + ' ' + word + ' email' + (fresh.length === 1 ? '' : 's') + ' added as Big Rocks for today.'
      : 'No new ' + word + ' emails.') + ConnectApps.partial(j);
  },


  async notionPick(row, aid) {
    const q = aid ? '?aid=' + encodeURIComponent(aid) : '';
    const j = await ConnectApps.get('/api/connect/notion/pages' + q);
    const pages = j.pages || [];
    if (!pages.length) throw new Error('The Flow cannot see any pages yet. In Notion, open a page and add your integration under … → Connections.');
    const acts = (aid && [...row.querySelectorAll('.conn-acct')].find((x) => x.getAttribute('data-aid') === aid)) || row.querySelector('.conn-acts');
    const sel = document.createElement('select');
    sel.className = 'conn-pick';
    sel.innerHTML = '<option value="">Choose the page to send to…</option>' +
      pages.map((pg) => '<option value="' + esc(pg.id) + '">' + esc(pg.title) + '</option>').join('');
    acts.insertBefore(sel, acts.firstChild);
    return new Promise((resolve, reject) => {
      sel.addEventListener('change', async () => {
        const pg = pages.find((x) => x.id === sel.value);
        if (!pg) return;
        try { await ConnectApps.post('/api/connect/notion/target' + q, { id: pg.id, title: pg.title }); resolve('Sending to ' + pg.title + '.'); }
        catch (e) { reject(e); }
      });
    });
  },

  /* This week, as Notion blocks: the Big Rocks as to-dos, then what was
     written in the Journal since Monday. */
  async notionSend(aid) {
    const t = ConnectApps.today();
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let rocks = [];
    try { rocks = ((typeof cData !== 'undefined' && cData.rocks) || {})[t.wid] || []; } catch (e) {}
    const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - t.day);
    let entries = [];
    try { entries = (typeof jData !== 'undefined' ? jData : []).filter((e) => e && e.t && new Date(e.t) >= monday); } catch (e) {}
    const blocks = [{ type: 'h', text: 'Big Rocks' }];
    rocks.slice().sort((a, b) => (a.day - b.day) || String(a.time || '').localeCompare(String(b.time || '')))
      .forEach((r) => blocks.push({ type: 'todo', done: !!r.done,
        text: DAYS[r.day] + (r.time ? ' ' + r.time : '') + ' — ' + r.title + (r.note ? ' (' + String(r.note).split('\n')[0].slice(0, 200) + ')' : '') }));
    if (!rocks.length) blocks.push({ type: 'p', text: 'No Big Rocks this week.' });
    blocks.push({ type: 'h', text: 'Journal' });
    entries.slice(-60).forEach((e) => blocks.push({ type: 'li',
      text: new Date(e.t).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + String(e.txt || '') }));
    if (!entries.length) blocks.push({ type: 'p', text: 'Nothing written yet this week.' });
    const range = monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const j = await ConnectApps.post('/api/connect/notion/send' + (aid ? '?aid=' + encodeURIComponent(aid) : ''),
      { title: 'The Flow — ' + t.wid.replace('-W', ' week ') + ' (from ' + range + ')', blocks });
    if (j.url) window.open(j.url, '_blank');
    return 'Sent to Notion ✓';
  },

  /* ── Google Calendar on Today ── */
  cal: null,
  /* Every calendar from every connected account, Google and Outlook, as one
     day. The same meeting accepted in two calendars is shown once. */
  async calendarLoad() {
    const ids = ['gcal', 'outlook'].filter((id) => {
      const c = Connect.list.find((x) => x.id === id);
      return c && (c.accounts || []).some((a) => !a.broken);
    });
    if (!ids.length) { ConnectApps.cal = null; ConnectApps.calendarPaint(); return; }
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const q = '?' + new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const got = await Promise.all(ids.map((id) => ConnectApps.get('/api/connect/' + id + '/events' + q)
      .then((j) => j.events || []).catch(() => null)));
    if (got.every((x) => x === null)) { ConnectApps.cal = null; ConnectApps.calendarPaint(); return; }
    const seen = {};
    ConnectApps.cal = [].concat.apply([], got.filter(Boolean)).filter((e) => {
      const k = String(e.title).trim().toLowerCase() + '|' + (e.allDay ? String(e.start).slice(0, 10) : Date.parse(e.start));
      if (seen[k]) return false;
      seen[k] = 1; return true;
    }).sort((a, b) => (b.allDay - a.allDay) || (Date.parse(a.start) - Date.parse(b.start)));
    ConnectApps.many = ids.reduce((n, id) => n + ((Connect.list.find((x) => x.id === id) || {}).accounts || []).length, 0) > 1;
    ConnectApps.calendarPaint();
  },
  /* What "Plan today" put on the day: timed items of your own, shown on the
     same list as the meetings, in time order. */
  planned() {
    try { return Schedule.onDate(today()).filter((r) => r && r.source === 'today'); } catch (e) { return []; }
  },
  calendarHtml() {
    const ev = ConnectApps.cal;
    const mine = ConnectApps.planned();
    if (!ev && !mine.length) return '';
    const hm = (s) => new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const t0 = (x) => x.allDay ? -1 : (x.start ? Date.parse(x.start) : (x.time ? Date.parse(today() + 'T' + x.time + ':00') : 9e15));
    const all = [].concat((ev || []).map((e) => ({ kind: 'ev', e })), mine.map((r) => ({ kind: 'me', r }))).sort((a, b) => t0(a.e || a.r) - t0(b.e || b.r));
    const rows = all.length ? all.map((x) => {
      if (x.kind === 'me') {
        const r = x.r;
        return '<div class="td-rock td-plan' + (r.done ? ' done' : '') + '" data-plankey="' + esc(r.key) + '"><div class="dot ' + (r.priority === 'high' ? 'high' : r.priority === 'low' ? 'low' : 'med') + '"></div><div class="rk-title"><span data-i18n="off">' + esc(r.text) + '</span>' +
          '<div class="td-fix"><button type="button" data-plan="done">' + (r.done ? 'Undo' : 'Done') + '</button><button type="button" data-plan="drop" class="ghost">Remove</button></div></div>' +
          '<div class="rk-meta">' + (r.time ? esc(r.time) : 'today') + '</div></div>';
      }
      const e = x.e;
      const when = e.allDay ? 'All day' : hm(e.start) + '–' + hm(e.end);
      const go = e.video || e.link;
      return '<div class="td-rock"><div class="dot med"></div><div class="rk-title">' +
        (go ? '<a href="' + esc(go) + '" target="_blank" rel="noopener">' + esc(e.title) + '</a>' : esc(e.title)) +
        (e.location ? '<div class="td-rk-note">📍 ' + esc(e.location) + '</div>' : '') +
        (ConnectApps.many && e.account ? '<div class="td-rk-note">' + esc(e.account) + '</div>' : '') +
        '</div><div class="rk-meta">' + esc(when) + '</div></div>';
    }).join('') : '<div class="td-rocks-empty">No meetings today.</div>';
    return '<div class="td-rocks" id="td-cal"><div class="td-rocks-head"><span class="lbl">Today · Calendar</span><span class="cnt">' +
      all.length + '</span></div>' + rows + '</div>';
  },
  calendarPaint() {
    const feed = document.getElementById('today-feed');
    if (!feed) return;
    try {
      const tile = feed.querySelector('.flow-td-pulse [data-jump="meetings"]');
      if (tile) { const t = TodayPlus.meetingsTile(); tile.querySelector('.v').textContent = t.v; tile.querySelector('.s').textContent = t.sub; }
    } catch (e) {}
    const old = feed.querySelector('#td-cal');
    const html = ConnectApps.calendarHtml();
    if (!html) { if (old) old.remove(); return; }
    const box = document.createElement('div');
    box.innerHTML = html;
    const card = box.firstElementChild;
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-plan]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const key = b.closest('[data-plankey]').getAttribute('data-plankey');
      const rec = Schedule.map[key];
      if (!rec) return;
      if (b.getAttribute('data-plan') === 'done') { rec.done = !rec.done; try { if (rec.done && typeof J === 'function') J('planning', '✅ Done today: ' + rec.text); } catch (e2) {} }
      else Schedule.remove(key);
      try { await Schedule.saveNow(); } catch (e2) {}
      ConnectApps.calendarPaint();
    });
    if (old) { old.replaceWith(card); return; }
    const rocks = feed.querySelector('.td-rocks');
    if (rocks) rocks.parentNode.insertBefore(card, rocks); else feed.appendChild(card);
  },
  calendarBoot() {
    if (ConnectApps._calOn) return;
    ConnectApps._calOn = true;
    const feed = document.getElementById('today-feed');
    /* Today is redrawn wholesale; put the card back each time it is. */
    if (feed && window.MutationObserver) {
      new MutationObserver(() => { if ((ConnectApps.cal || ConnectApps.planned().length) && !feed.querySelector('#td-cal')) ConnectApps.calendarPaint(); })
        .observe(feed, { childList: true });
    }
    ConnectApps.calendarLoad();
    setInterval(() => ConnectApps.calendarLoad(), 10 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ConnectApps.calendarLoad(); });
  }
};

const Nav = {
  installed: false,

  /* A group is a bottom-bar slot. Its `tabs` are the host tab names it owns,
     in the order they appear in the segment row; the first is the default. */
  GROUPS: [
    { id: 'today', label: 'Today', icon: 'today', tabs: ['today'] },
    /* Focus is what you are steering by. Brainstorm and Time are not that —
       one is where thinking gets put down, the other is where hours get
       counted. Both belong with the rest of what you keep a record of. */
    { id: 'focus', label: 'Focus', icon: 'target',
      tabs: ['northstar', 'quad', 'compass', 'abko', 'dtc'] },
    /* Mood lives inside Sleep now: how you slept and how you feel are the
       same morning question, and asking it twice in two places got it
       answered in neither. */
    { id: 'body',  label: 'Body',  icon: 'dumbbell',
      tabs: ['training', 'sleep', 'habits'] },
    { id: 'record', label: 'Record', icon: 'note',
      tabs: ['ask', 'journal', 'finance'] }
  ],

  /* Sections the app no longer shows. Their data is left exactly where it
     was — in the account, in every backup — so a change of mind costs
     nothing; only the pill and the slot go. Brainstorm was a questionnaire
     answered once; Time counted hours that the Journal already records; the
     planner now lives inside North Star. */
  REMOVED: ['brainstorm', 'time'],

  /* Reachable from the avatar and from the palette, but not worth a slot. */
  MENU: ['artur', 'settings'],

  ICON: {
    today: 'today', northstar: 'star', quad: 'target', compass: 'compass', abko: 'work', dtc: 'rocket',
    training: 'dumbbell', diet: 'food',
    sleep: 'moon', habits: 'check', mood: 'heart', journal: 'note',
    finance: 'money', ask: 'chat', artur: 'user', settings: 'gear'
  },

  /* Sidebar order and headings. */
  SIDE: [
    { head: '',       tabs: ['today'] },
    { head: 'Focus',  tabs: ['northstar', 'quad', 'compass', 'abko', 'dtc'] },
    { head: 'Body',   tabs: ['training', 'sleep', 'habits'] },
    { head: 'Record', tabs: ['journal', 'finance', 'ask'] }
  ],
  SIDE_FOOT: ['artur', 'settings'],

  CAPTURE: [
    { id: 'note',    label: 'Note',    icon: 'note'     },
    /* A task is a Big Rock on a day of the week — that is where Today and
       the weekly plan read from. */
    { id: 'quad',    label: 'Task',    icon: 'target', go: 'compass' },
    { id: 'finance', label: 'Expense', icon: 'money'    },
    { id: 'training',label: 'Set',     icon: 'dumbbell' },
    { id: 'habits',  label: 'Habit',   icon: 'check'    },
    /* One page for the body's log: sleep, mood and meals are the same
       morning-and-evening question, and asking it in two places got it
       answered in neither. The Meal button lands on the diet part of it. */
    { id: 'diet',    label: 'Meal',    icon: 'food', go: 'sleep', at: '#fn-dietblock' },
    { id: 'sleep',   label: 'Sleep & mood', icon: 'moon' }
  ],

  last: { focus: 'northstar', body: 'training' },

  /* ---- primitives ------------------------------------------------------ */

  svg(name, cls) {
    return '<svg class="' + (cls || 'fn-i') + '" viewBox="0 0 24 24" aria-hidden="true">' +
           (NAV_ICONS[name] || NAV_ICONS.note) + '</svg>';
  },

  pill(tab) { return document.querySelector('.tab[data-tab="' + tab + '"]'); },

  /* Labels come from the host's own pills, so a renamed tab — the planner
     taking the signed-in person's name — is picked up for free. */
  label(tab) {
    const p = Nav.pill(tab);
    if (!p) return tab;
    const raw = (p.textContent || '').trim();
    const parts = raw.split(/\s+/);
    if (parts.length > 1 && !/[a-z0-9]/i.test(parts[0])) parts.shift();
    return parts.join(' ') || raw;
  },

  current() {
    const a = document.querySelector('.tab.active');
    return a ? a.getAttribute('data-tab') : null;
  },

  go(tab) {
    const p = Nav.pill(tab);
    if (!p) return false;
    p.click();
    /* Instant, not smooth: on iOS a smooth scroll started during a fling is
       cancelled by it, and the new tab opens halfway down. */
    window.scrollTo(0, 0);
    Nav.sync();
    return true;
  },

  groupOf(tab) {
    for (const g of Nav.GROUPS) if (g.tabs.indexOf(tab) >= 0) return g;
    return null;
  },

  /* Every tab that actually exists, in a sensible order, for the palette. */
  allTabs() {
    const seen = {}, out = [];
    Nav.SIDE.forEach(s => s.tabs.forEach(t => { seen[t] = 1; }));
    Nav.SIDE_FOOT.forEach(t => { seen[t] = 1; });
    Object.keys(seen).forEach(t => { if (Nav.pill(t)) out.push(t); });
    /* Anything the host has that we did not classify still needs to be
       reachable — never strand a section. */
    document.querySelectorAll('.tab[data-tab]').forEach(p => {
      const n = p.getAttribute('data-tab');
      if (out.indexOf(n) < 0) out.push(n);
    });
    return out;
  },

  /* ---- the phone bottom bar -------------------------------------------- */

  buildTabbar() {
    const bar = document.createElement('nav');
    bar.id = 'flow-tabbar';
    const slot = (g) =>
      '<button type="button" data-fn-group="' + g.id + '">' + Nav.svg(g.icon) +
      '<span class="fn-lb">' + esc(g.label) + '</span></button>';

    bar.innerHTML =
      slot(Nav.GROUPS[0]) + slot(Nav.GROUPS[1]) +
      '<button type="button" class="fn-cap" id="fn-capbtn" aria-label="Capture">' +
        '<span class="fn-knob">' + Nav.svg('plus') + '</span></button>' +
      slot(Nav.GROUPS[2]) + slot(Nav.GROUPS[3]);

    document.body.appendChild(bar);

    bar.querySelectorAll('[data-fn-group]').forEach(b => {
      b.addEventListener('click', () => {
        const g = Nav.GROUPS.find(x => x.id === b.getAttribute('data-fn-group'));
        if (!g) return;
        /* Returning to a group lands you where you left it — never on a
           section that has been hidden from the menu. */
        let hid = []; try { hid = Sections.hidden(); } catch (e) {}
        const ok = (t) => !!Nav.pill(t) && hid.indexOf(t) < 0;
        let want = g.tabs.length > 1 ? Nav.last[g.id] : g.tabs[0];
        if (!ok(want)) want = g.tabs.find(ok) || g.tabs[0];
        Nav.go(want);
      });
    });
    document.getElementById('fn-capbtn').addEventListener('click', () => Nav.openCapture());
  },

  /* ---- the segment row (second level) ---------------------------------- */

  buildSeg() {
    const seg = document.createElement('div');
    seg.id = 'flow-seg';
    seg.style.display = 'none';
    /* The host swipes between sections on a document-level touchstart. This
       row scrolls horizontally, so its own touches must not also page. */
    seg.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    Nav.segEl = seg;
  },

  /* The active pane, whoever owns it. Sections the pack adds are
     `.flow-section`, not the host's `.section` — matching only the latter
     left North Star, the one Focus tab we own, with no segment row at all,
     and so no way back to the rest of the group except a link inside the
     page. */
  pane() {
    return document.querySelector('.section.active, .flow-section.active');
  },

  paintSeg(cur) {
    const seg = Nav.segEl;
    if (!seg) return;
    const g = Nav.groupOf(cur);
    const host = Nav.pane();

    if (!g || g.tabs.length < 2 || !host) { seg.style.display = 'none'; return; }

    const tabs = g.tabs.filter(t => Nav.pill(t));
    seg.innerHTML = tabs.map(t =>
      '<button type="button" data-fn-seg="' + t + '" class="' + (t === cur ? 'on' : '') + '">' +
      esc(Nav.label(t)) + '</button>').join('');
    seg.querySelectorAll('[data-fn-seg]').forEach(b => {
      b.addEventListener('click', () => Nav.go(b.getAttribute('data-fn-seg')));
    });

    /* Above the pane rather than inside it: a section that repaints itself
       by rewriting its own innerHTML — North Star does, every time the
       direction lands — would otherwise delete the row out from under us. */
    const par = host.parentElement;
    if (par && (seg.parentElement !== par || seg.nextElementSibling !== host)) par.insertBefore(seg, host);
    else if (!par && seg.parentElement !== host) host.insertBefore(seg, host.firstChild);
    seg.style.display = '';
    /* A tab deep in its group used to leave the highlighted pill off-screen to
       the right — the row read as broken rather than scrollable. Center the
       active pill, and only paint the edge fade when there is actually more
       to scroll to. */
    const on = seg.querySelector('button.on');
    if (on) seg.scrollLeft = Math.max(0, on.offsetLeft - (seg.clientWidth - on.offsetWidth) / 2);
    seg.classList.toggle('fn-overflow', seg.scrollWidth > seg.clientWidth + 4);
  },

  /* ---- header tools: search and the avatar ------------------------------ */

  buildHeadTools() {
    /* Into the title line itself, not the header — the header wraps on a phone
       and the tools would land on a row of their own. The h1 is already a flex
       row, so they sit opposite the logo where an iOS avatar belongs. */
    const host = document.querySelector('.header h1') || document.querySelector('.header');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.id = 'flow-headtools';
    wrap.innerHTML =
      '<button type="button" class="fn-icobtn" id="fn-search" aria-label="Search">' + Nav.svg('search') + '</button>' +
      '<button type="button" class="fn-avatar" id="fn-avatar" aria-label="You">' + esc(Nav.initial()) + '</button>';
    host.appendChild(wrap);
    try { Refresh.boot(); } catch (e) {}
    document.getElementById('fn-search').addEventListener('click', () => Nav.openPalette());
    document.getElementById('fn-avatar').addEventListener('click', () => Nav.openMenu());
  },

  initial() {
    let n = '';
    try { n = (Auth && Auth.user && (Auth.user.name || Auth.user.email)) || ''; } catch (e) {}
    if (!n) { try { n = Settings.get('displayName') || ''; } catch (e) {} }
    return (String(n).trim()[0] || '·').toUpperCase();
  },

  buildMenu() {
    const wrap = document.createElement('div');
    wrap.id = 'flow-menu';
    wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-fn-close="1"></div>' +
      '<div class="fn-sheet" role="dialog" aria-modal="true" aria-label="You">' +
        '<div class="fn-grab" data-fn-close="1"></div>' +
        '<div class="fn-me" id="fn-me"></div>' +
        '<div class="fn-mlist" id="fn-menugrid"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.querySelectorAll('[data-fn-close]').forEach(e =>
      e.addEventListener('click', () => wrap.classList.remove('on')));
    Nav.menuEl = wrap;
  },

  /* The avatar is the person: who is signed in, their page, the settings,
     what is private, and the way out. Account and data used to sit halfway
     down a long Settings page; now they are one tap from the face. */
  openMenu() {
    const u = (typeof Auth !== 'undefined' && Auth.user) || {};
    const name = u.name || Settings.get('displayName') || '';
    const src = (() => { try { return Connect.photo(); } catch (e) { return null; } })();
    document.getElementById('fn-me').innerHTML =
      (src ? '<img class="fn-me-face" alt="" src="' + esc(src) + '">' : '<span class="fn-me-face">' + esc(Nav.initial()) + '</span>') +
      '<div class="fn-me-t"><b>' + esc(name || 'You') + '</b>' + (u.email ? '<span>' + esc(u.email) + '</span>' : '') + '</div>';
    const grid = document.getElementById('fn-menugrid');
    const row = (attr, icon, label, sub, cls) =>
      '<button type="button" ' + attr + (cls ? ' class="' + cls + '"' : '') + '>' + Nav.svg(icon) +
      '<span class="fn-m-t"><b>' + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      (cls ? '' : '<i class="fn-m-chev" aria-hidden="true">›</i>') + '</button>';
    let html = '';
    if (Nav.pill('artur')) html += row('data-fn-menu="artur"', Nav.ICON.artur || 'user', 'Profile', 'Your page — mission, roles, the long view');
    html += row('data-fn-menu="settings"', Nav.ICON.settings || 'gear', 'Settings', 'Look, Today, connections, notifications');
    if (typeof Auth !== 'undefined' && Auth.installed) html += row('data-fn-act="privacy"', 'lock', 'Privacy & security', 'Password, recovery codes, your data');
    html += row('data-fn-act="help"', 'note', 'Send feedback', 'What is confusing, missing or annoying');
    if (typeof Auth !== 'undefined' && Auth.installed) html += row('data-fn-act="signout"', 'out', 'Sign out', '', 'fn-m-danger');
    grid.innerHTML = html;
    const close = () => Nav.menuEl.classList.remove('on');
    grid.querySelectorAll('[data-fn-menu]').forEach(b => b.addEventListener('click', () => {
      close();
      if (b.getAttribute('data-fn-menu') === 'settings') { try { SetView.open('main'); return; } catch (e) {} }
      Nav.go(b.getAttribute('data-fn-menu'));
    }));
    grid.querySelectorAll('[data-fn-act]').forEach(b => b.addEventListener('click', async () => {
      const a = b.getAttribute('data-fn-act');
      close();
      if (a === 'signout') {
        if (!confirm('Sign out of The Flow on this device?')) return;
        try { await Auth.signOut(); } catch (e) {}
        return;
      }
      try { SetView.open(a); } catch (e) { Nav.go('settings'); }
    }));
    Nav.menuEl.classList.add('on');
  },

  /* ---- capture ---------------------------------------------------------- */

  buildCapture() {
    const wrap = document.createElement('div');
    wrap.id = 'flow-capture';
    wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-fn-close="1"></div>' +
      '<div class="fn-sheet" role="dialog" aria-label="Capture" aria-modal="true">' +
        '<div class="fn-grab" data-fn-close="1"></div>' +
        '<button type="button" class="fn-capture-close" data-fn-close="1" aria-label="Close">×</button>' +
        '<h4>Capture</h4>' +
        '<div class="fn-sub">A note is saved without leaving this screen.</div>' +
        '<div class="fn-grid" id="fn-capgrid"></div>' +
        '<div class="fn-note">' +
          '<textarea id="fn-noteinput" placeholder="What happened?" rows="4"></textarea>' +
          '<div class="fn-acts">' +
            '<button type="button" id="fn-notecancel">Back</button>' +
            '<button type="button" class="pri" id="fn-notesave">Save to journal</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    Nav.capEl = wrap;

    wrap.querySelectorAll('[data-fn-close]').forEach(e =>
      e.addEventListener('click', () => Nav.closeCapture()));

    Nav.paintCapture();
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fn-cap]');
      if (!b) return;
      const id = b.getAttribute('data-fn-cap');
      if (id === 'note') {
        wrap.classList.add('note');
        const ta = document.getElementById('fn-noteinput');
        ta.value = '';
        setTimeout(() => ta.focus(), 60);
        return;
      }
      /* The rest hand you to the section that owns that kind of entry. Writing
         them in place needs each section's own write path; the journal is the
         one the pack already owns end to end. */
      Nav.closeCapture(false);
      const c = Nav.CAPTURE.find(x => x.id === id) || {};
      Nav.go(c.go || id);
      if (c.at) setTimeout(() => { const el = document.querySelector(c.at); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }, 260);
    });

    document.getElementById('fn-notecancel').addEventListener('click', () => {
      wrap.classList.remove('note');
      wrap.querySelector('[data-fn-cap="note"]').focus();
    });
    document.getElementById('fn-notesave').addEventListener('click', () => Nav.saveNote());
    document.getElementById('fn-noteinput').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') Nav.saveNote();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !wrap.classList.contains('on')) return;
      const controls = Array.from(wrap.querySelectorAll('button:not([disabled]), textarea:not([disabled])'))
        .filter(el => el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  },

  /* Drawn each time it opens: a section hidden from the menu is not offered
     a capture button either — the buttons follow the menu. */
  paintCapture() {
    const grid = document.getElementById('fn-capgrid');
    if (!grid) return;
    let hid = []; try { hid = Sections.hidden(); } catch (e) {}
    grid.innerHTML = Nav.CAPTURE.filter(c => c.id === 'note' || (Nav.pill(c.go || c.id) && hid.indexOf(c.go || c.id) < 0)).map(c =>
      '<button type="button" data-fn-cap="' + c.id + '">' + Nav.svg(c.icon) +
      '<span>' + esc(c.label) + '</span></button>').join('');
  },
  openCapture() {
    Nav.capReturn = document.activeElement;
    Nav.paintCapture();
    Nav.capEl.classList.remove('note');
    Nav.capEl.classList.add('on');
    const first = Nav.capEl.querySelector('[data-fn-cap]');
    if (first) first.focus({ preventScroll: true });
  },
  closeCapture(restoreFocus) {
    Nav.capEl.classList.remove('on');
    Nav.capEl.classList.remove('note');
    if (restoreFocus !== false && Nav.capReturn && Nav.capReturn.isConnected && Nav.capReturn.getClientRects().length) {
      Nav.capReturn.focus({ preventScroll: true });
    }
    Nav.capReturn = null;
  },

  /* A real write, not a redirect: the entry lands in the journal and the
     screen you were on is still the screen you are on. */
  async saveNote() {
    const ta = document.getElementById('fn-noteinput');
    const body = String(ta.value || '').trim();
    if (!body) { toast('Write something first.', 'warn'); return; }
    const btn = document.getElementById('fn-notesave');
    btn.disabled = true;
    try {
      const now = new Date().toISOString();
      Journal.entries.push({
        id: uid('j'), created: now, updated: now,
        date: today(), title: '', body: body, tags: ['quick'],
        prompts: {}, mood: null, energy: null
      });
      await Journal.save();
      try { Journal.rerender(); } catch (e) {}
      toast('Saved to your journal ✓');
      ta.value = '';
      Nav.closeCapture();
    } catch (e) {
      console.error('[Flow] quick note', e);
      toast('Could not save that.', 'warn');
    }
    btn.disabled = false;
  },

  /* ---- the command palette ---------------------------------------------- */

  buildPalette() {
    const wrap = document.createElement('div');
    wrap.id = 'flow-pal';
    wrap.innerHTML =
      '<div class="fn-scrim" data-fn-close="1"></div>' +
      '<div class="fn-box" role="dialog" aria-label="Go to">' +
        '<div class="fn-in">' + Nav.svg('search') +
          '<input id="fn-palin" type="text" placeholder="Go to a section, or start a note…" ' +
          'autocomplete="off" autocorrect="off" spellcheck="false">' +
        '</div>' +
        '<div class="fn-list" id="fn-pallist"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    Nav.palEl = wrap;
    Nav.palIdx = 0;

    wrap.querySelector('[data-fn-close]').addEventListener('click', () => Nav.closePalette());
    const input = document.getElementById('fn-palin');
    input.addEventListener('input', () => { Nav.palIdx = 0; Nav.paintPalette(); });
    input.addEventListener('keydown', (e) => {
      const n = Nav.palRows.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); Nav.palIdx = n ? (Nav.palIdx + 1) % n : 0; Nav.paintPalette(true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); Nav.palIdx = n ? (Nav.palIdx - 1 + n) % n : 0; Nav.paintPalette(true); }
      else if (e.key === 'Enter') { e.preventDefault(); Nav.runPalette(); }
      else if (e.key === 'Escape') { e.preventDefault(); Nav.closePalette(); }
    });
  },

  palRows: [],

  paintPalette(keepQuery) {
    const q = String((document.getElementById('fn-palin') || {}).value || '').trim().toLowerCase();
    const rows = [];

    Nav.allTabs().forEach(t => {
      const lab = Nav.label(t);
      if (!q || lab.toLowerCase().indexOf(q) >= 0) {
        rows.push({ kind: 'go', tab: t, label: lab, icon: Nav.ICON[t] || 'note' });
      }
    });
    if (q) {
      rows.push({ kind: 'note', label: 'New journal note: “' + q + '”', icon: 'note' });
      if (Nav.pill('ask')) rows.push({ kind: 'ask', label: 'Ask: “' + q + '”', icon: 'chat' });
    }

    Nav.palRows = rows;
    if (Nav.palIdx >= rows.length) Nav.palIdx = 0;

    const list = document.getElementById('fn-pallist');
    if (!rows.length) { list.innerHTML = '<div class="fn-empty">Nothing matches that.</div>'; return; }

    let html = '', lastKind = null;
    rows.forEach((r, i) => {
      const kind = r.kind === 'go' ? 'Go to' : 'Do';
      if (kind !== lastKind) { html += '<div class="fn-cat">' + kind + '</div>'; lastKind = kind; }
      html += '<div class="fn-row' + (i === Nav.palIdx ? ' on' : '') + '" data-fn-i="' + i + '">' +
              Nav.svg(r.icon) + '<span>' + esc(r.label) + '</span>' +
              (i === Nav.palIdx ? '<span class="fn-hint">↵</span>' : '') + '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('[data-fn-i]').forEach(el => el.addEventListener('click', () => {
      Nav.palIdx = parseInt(el.getAttribute('data-fn-i'), 10);
      Nav.runPalette();
    }));
    const on = list.querySelector('.fn-row.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    if (!keepQuery) { /* nothing else to do — kept for readability */ }
  },

  runPalette() {
    const r = Nav.palRows[Nav.palIdx];
    if (!r) return;
    const q = String((document.getElementById('fn-palin') || {}).value || '').trim();
    Nav.closePalette();
    if (r.kind === 'go') { Nav.go(r.tab); return; }
    if (r.kind === 'note') {
      Nav.openCapture();
      Nav.capEl.classList.add('note');
      const ta = document.getElementById('fn-noteinput');
      ta.value = q;
      setTimeout(() => ta.focus(), 60);
      return;
    }
    if (r.kind === 'ask') {
      Nav.go('ask');
      setTimeout(() => {
        const box = document.getElementById('ask-in');
        if (box) { box.value = q; box.focus(); }
      }, 260);
    }
  },

  openPalette() {
    Nav.palEl.classList.add('on');
    const i = document.getElementById('fn-palin');
    i.value = ''; Nav.palIdx = 0;
    Nav.paintPalette();
    setTimeout(() => i.focus(), 40);
  },
  closePalette() { Nav.palEl.classList.remove('on'); },

  /* ---- the desktop sidebar ---------------------------------------------- */

  buildSide() {
    const side = document.createElement('aside');
    side.id = 'flow-side';

    const link = (t) =>
      '<button type="button" class="fn-link" data-fn-side="' + t + '">' +
      Nav.svg(Nav.ICON[t] || 'note') + '<span class="fn-txt">' + esc(Nav.label(t)) + '</span></button>';

    let html =
      '<div class="fn-brand"><span class="fn-mark"></span><span class="fn-nm">The Flow</span></div>' +
      '<button type="button" class="fn-k" id="fn-kbtn">' + Nav.svg('search') +
        '<span>Search</span><span class="fn-kbd">⌘K</span></button>';

    Nav.SIDE.forEach(sec => {
      const tabs = sec.tabs.filter(t => Nav.pill(t));
      if (!tabs.length) return;
      if (sec.head) html += '<div class="fn-grouplbl">' + esc(sec.head) + '</div>';
      html += tabs.map(link).join('');
    });

    html += '<div class="fn-spacer"></div>';
    html += Nav.SIDE_FOOT.filter(t => Nav.pill(t)).map(link).join('');

    side.innerHTML = html;
    document.body.appendChild(side);

    side.querySelectorAll('[data-fn-side]').forEach(b =>
      b.addEventListener('click', () => Nav.go(b.getAttribute('data-fn-side'))));
    document.getElementById('fn-kbtn').addEventListener('click', () => Nav.openPalette());

    document.body.classList.add('fn-on');
    Nav.sideEl = side;
  },

  /* Labels are resolved at build time; the planner is renamed after sign-in,
     so refresh the two places that show it. */
  relabel() {
    if (Nav.sideEl) {
      Nav.sideEl.querySelectorAll('[data-fn-side]').forEach(b => {
        const t = b.getAttribute('data-fn-side');
        const txt = b.querySelector('.fn-txt');
        if (txt) txt.textContent = Nav.label(t);
      });
    }
    const av = document.getElementById('fn-avatar');
    if (av && !av.classList.contains('has-face')) av.textContent = Nav.initial();
  },

  /* ---- keeping everything in step --------------------------------------- */

  /* `initial` is the one sync that must not record where you are: at boot the
     host has simply activated its own default section, which is not a place
     you chose to be, and treating it as one would make the first tap on a
     group land somewhere arbitrary. */
  sync(initial) {
    const cur = Nav.current();
    if (!cur) return;

    const g = Nav.groupOf(cur);
    if (g && g.tabs.length > 1 && !initial) Nav.last[g.id] = cur;

    const bar = document.getElementById('flow-tabbar');
    if (bar) bar.querySelectorAll('[data-fn-group]').forEach(b =>
      b.classList.toggle('on', !!g && b.getAttribute('data-fn-group') === g.id));

    if (Nav.sideEl) Nav.sideEl.querySelectorAll('[data-fn-side]').forEach(b =>
      b.classList.toggle('on', b.getAttribute('data-fn-side') === cur));

    Nav.paintSeg(cur);
  },

  /* Take the retired sections out of the page: the pill goes, so nothing
     here or in the host can route to it, and the section is hidden rather
     than removed, so the host's own render code still finds its elements.
     Somebody who had one of them open lands on Today. */
  retire() {
    let moved = false;
    Nav.REMOVED.forEach((t) => {
      const p = Nav.pill(t);
      if (p) { if (p.classList.contains('active')) moved = true; p.remove(); }
      const sec = document.getElementById('tab-' + t);
      if (sec) { sec.classList.remove('active'); sec.setAttribute('data-fn-retired', '1'); }
    });
    if (moved && Nav.pill('today')) Nav.pill('today').click();
    try { Nav.mergeBody(); } catch (e) { console.warn('[Flow] body log', e); }
  },

  /* Diet joins Sleep & Mood on one page, "Body log". The diet section's
     own elements move across whole — same ids, same listeners — so the
     host's renderDiet() keeps finding them; only the pill goes. */
  mergeBody() {
    const diet = document.getElementById('tab-diet'), sleep = document.getElementById('tab-sleep');
    if (!diet || !sleep || document.getElementById('fn-dietblock')) return;
    const block = document.createElement('div');
    block.id = 'fn-dietblock';
    block.className = 'fn-dietblock';
    while (diet.firstChild) block.appendChild(diet.firstChild);
    sleep.appendChild(block);
    diet.setAttribute('data-fn-retired', '1');
    const dp = Nav.pill('diet');
    const wasDiet = dp && dp.classList.contains('active');
    if (dp) dp.remove();
    const sp = Nav.pill('sleep');
    if (sp) {
      sp.textContent = '🫀 Body log';
      /* The host redraws the diet checklist when its own pill is tapped;
         that pill is gone, so do it when this one is. */
      sp.addEventListener('click', () => { try { if (typeof renderDiet === 'function') renderDiet(); } catch (e) {} });
      if (wasDiet) sp.click();
    }
  },

  install() {
    if (Nav.installed) return;
    Nav.installed = true;

    try { Nav.retire(); } catch (e) { console.warn('[Flow] retire', e); }
    Nav.buildSeg();
    Nav.buildTabbar();
    Nav.buildSide();
    Nav.buildHeadTools();
    Nav.buildCapture();
    Nav.buildMenu();
    Nav.buildPalette();

    /* The host re-syncs its own bar after every switch; piggy-back on that so
       we never miss a navigation, whoever caused it. */
    const hostSync = window.syncMobileNav;
    if (typeof hostSync === 'function') {
      window.syncMobileNav = function () {
        try { hostSync.apply(this, arguments); } catch (e) {}
        Nav.sync();
      };
    }
    /* Pack-added tabs (Ask, the planner, Settings) do not call it, so also
       watch for any click that lands on a tab. */
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest && e.target.closest('[data-tab]');
      if (t) setTimeout(() => Nav.sync(), 0);
    }, true);

    document.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault();
        Nav.palEl.classList.contains('on') ? Nav.closePalette() : Nav.openPalette(); return; }
      if (e.key === 'Escape') {
        if (Nav.palEl.classList.contains('on')) Nav.closePalette();
        if (Nav.capEl.classList.contains('on')) Nav.closeCapture();
        if (Nav.menuEl.classList.contains('on')) Nav.menuEl.classList.remove('on');
      }
    });

    Nav.sync(true);

    /* Open on the answer. The host boots into Week Compass and hides its own
       Today pill outside the installed app, so on a desktop browser Today was
       unreachable — this both fixes that and makes the first screen the one
       that needs no interaction. */
    if (Nav.pill('today') && Nav.current() !== 'today') Nav.go('today');
  }
};

/* ======================================================================
 * 20c · North Star — the operating philosophy, made daily
 *
 * The app already carries the Eisenhower matrix (the Priorities tab) and
 * Today already surfaces its urgent+important quadrant. What it lacked was a
 * home for the WHY: the one principle to steer by, the tenets to re-read, and
 * the handful of focus areas whose progress is the real scoreboard. This tab
 * is that home. It reads the live matrix for its "urgent + important right
 * now" strip but never duplicates it — one matrix, surfaced in two places.
 *
 * Named "North Star" rather than "Compass" only because the weekly planner
 * already owns the compass metaphor; this is the same idea the person asked
 * for — a fixed point to keep the day pointed the right way.
 * ==================================================================== */
const NorthStar = {
  sec: null,
  loaded: false,
  principle: '',
  tenets: [],
  goals: [],

  K_PRIN: 'flow:ns:principle',
  K_TEN:  'flow:ns:tenets',
  K_GOAL: 'flow:ns:goals',

  DEFAULT_PRINCIPLE:
    'Protect my time, focus on what creates long-term value, execute on my ' +
    'goals, build my businesses and creative abilities, improve myself ' +
    'physically and mentally, and cut out the distractions that don’t ' +
    'contribute to the person I want to become.',

  DEFAULT_TENETS: [
    'Say no more often — protect my time instead of doing everything.',
    'Prioritise myself and my goals over being pulled in every direction.',
    'Create value for others and improve the lives of people around me.',
    'Grow my business and actively chase bigger possibilities.',
    'Become my best self — physically, mentally, professionally, creatively.',
    'Feel freer mentally, without needless pressure from money or expectations.',
    'Execute on my goals — don’t just think about them.',
    'Be the best version of myself and inspire others by example.',
    'Be conscious and deliberate about how I spend my time.'
  ],

  DEFAULT_GOALS: [
    { icon: '💪', name: 'Get fit / improve health',    pct: 0 },
    { icon: '🎧', name: 'DJing — train with music', pct: 0 },
    { icon: '🎵', name: 'Produce & learn music',        pct: 0 },
    { icon: '📈', name: 'Learn more about business',     pct: 0 },
    { icon: '♟️', name: 'Play more chess',               pct: 0 },
    { icon: '💿', name: 'Produce a mixtape',             pct: 0 }
  ],

  host(name) { try { return eval(name); } catch (e) { return undefined; } },

  async load() {
    if (NorthStar.loaded) return;
    const [p, t, g] = await Promise.all([
      DB.get(NorthStar.K_PRIN, null),
      DB.get(NorthStar.K_TEN, null),
      DB.get(NorthStar.K_GOAL, null)
    ]);
    NorthStar.principle = (typeof p === 'string' && p.trim()) ? p : NorthStar.DEFAULT_PRINCIPLE;
    NorthStar.tenets = Array.isArray(t) ? t.slice() : NorthStar.DEFAULT_TENETS.slice();
    NorthStar.goals = Array.isArray(g)
      ? g.map(x => ({ id: x.id || uid('g'), icon: x.icon || '⭐', name: String(x.name || ''), pct: clamp(parseInt(x.pct, 10) || 0, 0, 100) }))
      : NorthStar.DEFAULT_GOALS.map(x => ({ id: uid('g'), icon: x.icon, name: x.name, pct: x.pct }));
    NorthStar.loaded = true;
  },

  savePrinciple() { DB.set(NorthStar.K_PRIN, NorthStar.principle); },
  saveTenets()    { DB.set(NorthStar.K_TEN, NorthStar.tenets); },
  saveGoals()     { DB.set(NorthStar.K_GOAL, NorthStar.goals); },

  async render(sec) {
    NorthStar.sec = sec;
    if (!NorthStar.loaded || !Score.loaded || !Friends.loaded || !Audit.loaded) {
      sec.innerHTML = '<div class="flow-card"><p class="flow-sub">Loading your compass…</p></div>';
      try { await Promise.all([NorthStar.load(), Score.load(), Direction.load(), Friends.load(), Audit.load()]); }
      catch (e) { console.warn('[Flow] north star load', e); NorthStar.loaded = true; Score.loaded = true; Direction.loaded = true; Friends.loaded = true; Audit.loaded = true; }
    }
    NorthStar.paint();
    /* After the paint, never before it: this is a network call and the tab
       should already be on screen when it lands. */
    Friends.maybeRefresh();
  },

  /* Live read of the matrix — never a copy of it. */
  q1() {
    const q = NorthStar.host('qData');
    if (!q || !Array.isArray(q.items)) return null;
    return q.items.filter(i => i && i.q === 1 && !i.done);
  },
  q2count() {
    const q = NorthStar.host('qData');
    if (!q || !Array.isArray(q.items)) return 0;
    return q.items.filter(i => i && i.q === 2 && !i.done).length;
  },

  paint() {
    const sec = NorthStar.sec;
    if (!sec) return;
    const avg = NorthStar.goals.length
      ? Math.round(NorthStar.goals.reduce((a, g) => a + (g.pct || 0), 0) / NorthStar.goals.length)
      : 0;

    sec.innerHTML =
      NorthStar.principleCard() +
      Direction.card() +
      NorthStar.matrixCard() +
      Score.card() +
      Friends.card() +
      Audit.card() +
      NorthStar.goalsCard(avg) +
      NorthStar.tenetsCard();

    NorthStar.wire();
    Score.wire(sec);
    Direction.wire(sec);
    Friends.wire(sec);
    Audit.wire(sec);
    Fold.wire(sec);
    /* A tap on the scoreboard changes what a friend is looking at, so the
       card follows the paint. It sends only when something actually moved. */
    Friends.publish();
  },

  principleCard() {
    return '' +
      '<div class="flow-card ns-hero">' +
        '<div class="ns-eyebrow">My North Star</div>' +
        '<blockquote class="ns-principle" id="ns-prin">' + esc(NorthStar.principle) + '</blockquote>' +
        '<div class="flow-row"><button class="flow-btn sm ghost" id="ns-prin-edit">Edit principle</button></div>' +
      '</div>';
  },

  matrixCard() {
    const q1 = NorthStar.q1();
    let body;
    if (q1 === null) {
      body = '<p class="flow-sub">Open the Priorities matrix once to start sorting what matters.</p>';
    } else if (!q1.length) {
      body = '<p class="ns-empty">Nothing urgent <em>and</em> important is open right now. ' +
             'That’s a good place to be — spend the freed time on Quadrant 2, where the real wins live.</p>';
    } else {
      body = '<ul class="ns-q1">' + q1.slice(0, 6).map(i =>
        '<li><span class="ns-dot"></span>' + esc(i.txt || '') + '</li>').join('') +
        (q1.length > 6 ? '<li class="ns-more">+' + (q1.length - 6) + ' more</li>' : '') +
        '</ul>';
    }
    const q2 = NorthStar.q2count();
    const meta = (q1 === null) ? '' :
      '<div class="ns-q-meta">' + (q1.length) + ' urgent + important' +
      (q2 ? ' · ' + q2 + ' important, not urgent' : '') + '</div>';
    return '' +
      '<div class="flow-card">' +
        '<div class="flow-row between"><h3>Right now</h3>' +
          '<button class="flow-btn sm" id="ns-open-matrix">Open the full matrix →</button></div>' +
        '<p class="flow-sub">Straight from your Eisenhower matrix — the same list your Today screen pulls from.</p>' +
        body + meta +
      '</div>';
  },

  goalsCard(avg) {
    const rows = NorthStar.goals.map(g =>
      '<div class="ns-goal" data-id="' + g.id + '">' +
        '<div class="ns-goal-top">' +
          '<span class="ns-goal-ic">' + esc(g.icon) + '</span>' +
          '<span class="ns-goal-name" data-act="rename" title="Rename">' + esc(g.name) + '</span>' +
          '<span class="ns-goal-pct">' + (g.pct || 0) + '%</span>' +
          '<button class="ns-x" data-act="del" title="Remove">×</button>' +
        '</div>' +
        '<div class="ns-bar" data-act="set" title="Tap to set progress">' +
          '<i style="width:' + (g.pct || 0) + '%"></i></div>' +
        '<div class="ns-goal-ctl">' +
          '<button class="flow-btn tiny" data-act="minus">−</button>' +
          '<button class="flow-btn tiny" data-act="plus">+</button>' +
        '</div>' +
      '</div>').join('');
    return Fold.card('goals',
      Fold.head('goals', 'Focus areas', avg + '% overall', !avg) +
      Fold.bar(avg) +
      Fold.body(
        '<p class="flow-sub">The handful of things that actually move you. Tap a bar to set where you are, ' +
          'or nudge it with − / +.</p>' +
        '<div class="ns-goals">' + rows + '</div>' +
        '<div class="flow-row ns-addrow">' +
          '<input class="flow-in grow" id="ns-goal-new" placeholder="Add a focus area…" maxlength="80">' +
          '<button class="flow-btn primary sm" id="ns-goal-add">Add</button>' +
        '</div>'));
  },

  tenetsCard() {
    const rows = NorthStar.tenets.map((t, i) =>
      '<li class="ns-tenet" data-i="' + i + '">' +
        '<span class="ns-tenet-txt" data-act="edit">' + esc(t) + '</span>' +
        '<button class="ns-x" data-act="del" title="Remove">×</button>' +
      '</li>').join('');
    const n = NorthStar.tenets.length;
    /* No progress bar here: a principle is not a thing you are part-way
       through, so a bar would be inventing a measurement. The count is the
       summary. */
    return Fold.card('tenets',
      Fold.head('tenets', 'How I operate', n + (n === 1 ? ' principle' : ' principles'), !n) +
      Fold.body(
        '<p class="flow-sub">The principles to re-read when the day tries to pull you off course.</p>' +
        '<ul class="ns-tenets">' + rows + '</ul>' +
        '<div class="flow-row ns-addrow">' +
          '<input class="flow-in grow" id="ns-tenet-new" placeholder="Add a principle…" maxlength="160">' +
          '<button class="flow-btn primary sm" id="ns-tenet-add">Add</button>' +
        '</div>'));
  },

  wire() {
    const sec = NorthStar.sec;

    /* Principle — edit in place. */
    const editBtn = $('#ns-prin-edit', sec);
    if (editBtn) editBtn.addEventListener('click', () => {
      const host = $('#ns-prin', sec);
      const cur = NorthStar.principle;
      host.outerHTML = '<textarea class="flow-in ns-prin-edit" id="ns-prin-ta" rows="4">' + esc(cur) + '</textarea>' +
        '<div class="flow-row"><button class="flow-btn primary sm" id="ns-prin-save">Save</button>' +
        '<button class="flow-btn ghost sm" id="ns-prin-cancel">Cancel</button></div>';
      editBtn.style.display = 'none';
      const ta = $('#ns-prin-ta', sec); ta.focus();
      $('#ns-prin-save', sec).addEventListener('click', () => {
        const v = ta.value.trim();
        if (v) { NorthStar.principle = v; NorthStar.savePrinciple(); }
        NorthStar.paint();
      });
      $('#ns-prin-cancel', sec).addEventListener('click', () => NorthStar.paint());
    });

    /* Matrix — jump to the real Priorities tab. */
    const open = $('#ns-open-matrix', sec);
    if (open) open.addEventListener('click', () => {
      if (!Nav.go('quad')) { const p = document.querySelector('.tab[data-tab="quad"]'); if (p) p.click(); }
    });

    /* Goals. */
    $$('.ns-goal', sec).forEach(row => {
      const id = row.getAttribute('data-id');
      const g = NorthStar.goals.find(x => x.id === id);
      if (!g) return;
      const bump = (d) => { g.pct = clamp((g.pct || 0) + d, 0, 100); NorthStar.saveGoals(); NorthStar.paint(); };
      const minus = row.querySelector('[data-act="minus"]');
      const plus = row.querySelector('[data-act="plus"]');
      if (minus) minus.addEventListener('click', () => bump(-10));
      if (plus) plus.addEventListener('click', () => bump(10));
      const bar = row.querySelector('[data-act="set"]');
      if (bar) bar.addEventListener('click', (e) => {
        const r = bar.getBoundingClientRect();
        const pct = clamp(Math.round(((e.clientX - r.left) / r.width) * 100 / 5) * 5, 0, 100);
        g.pct = pct; NorthStar.saveGoals(); NorthStar.paint();
      });
      const del = row.querySelector('[data-act="del"]');
      if (del) del.addEventListener('click', () => {
        NorthStar.goals = NorthStar.goals.filter(x => x.id !== id);
        NorthStar.saveGoals(); NorthStar.paint();
      });
      const name = row.querySelector('[data-act="rename"]');
      if (name) name.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.className = 'flow-in'; inp.value = g.name; inp.maxLength = 80;
        name.replaceWith(inp); inp.focus(); inp.select();
        const commit = () => { const v = inp.value.trim(); if (v) { g.name = v; NorthStar.saveGoals(); } NorthStar.paint(); };
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') NorthStar.paint(); });
      });
    });
    const gAdd = $('#ns-goal-add', sec), gNew = $('#ns-goal-new', sec);
    const addGoal = () => {
      const v = (gNew.value || '').trim(); if (!v) return;
      NorthStar.goals.push({ id: uid('g'), icon: '⭐', name: v, pct: 0 });
      Fold.setOpen('goals', true);
      NorthStar.saveGoals(); NorthStar.paint();
    };
    if (gAdd) gAdd.addEventListener('click', addGoal);
    if (gNew) gNew.addEventListener('keydown', (e) => { if (e.key === 'Enter') addGoal(); });

    /* Tenets. */
    $$('.ns-tenet', sec).forEach(li => {
      const i = parseInt(li.getAttribute('data-i'), 10);
      const del = li.querySelector('[data-act="del"]');
      if (del) del.addEventListener('click', () => {
        NorthStar.tenets.splice(i, 1); NorthStar.saveTenets(); NorthStar.paint();
      });
      const txt = li.querySelector('[data-act="edit"]');
      if (txt) txt.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.className = 'flow-in'; inp.value = NorthStar.tenets[i]; inp.maxLength = 160;
        txt.replaceWith(inp); inp.focus(); inp.select();
        const commit = () => { const v = inp.value.trim(); if (v) { NorthStar.tenets[i] = v; NorthStar.saveTenets(); } NorthStar.paint(); };
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') NorthStar.paint(); });
      });
    });
    const tAdd = $('#ns-tenet-add', sec), tNew = $('#ns-tenet-new', sec);
    const addTenet = () => {
      const v = (tNew.value || '').trim(); if (!v) return;
      Fold.setOpen('tenets', true);
      NorthStar.tenets.push(v); NorthStar.saveTenets(); NorthStar.paint();
    };
    if (tAdd) tAdd.addEventListener('click', addTenet);
    if (tNew) tNew.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTenet(); });
  }
};

/* ======================================================================
 * 20e · Direction — where this is going, read every morning
 *
 * The Ask tab answers questions. This answers the one nobody remembers to
 * ask. It is a single call a day, written server-side and cached there, so
 * opening the tab ten times costs nothing and the reading does not change
 * under you between two glances at the same morning.
 *
 * The star sign is voice, not evidence: the birth date is stored so the
 * server can address the reading to a Virgo or a Scorpio, and every claim
 * underneath still has to come from the record.
 * ==================================================================== */
const Direction = {
  loaded: false,
  data: null,
  birth: '',
  busy: false,
  error: '',
  asking: false,

  K_BIRTH: 'flow:ns:birth',

  async load() {
    if (Direction.loaded) return;
    Direction.birth = (await DB.get(Direction.K_BIRTH, '')) || '';
    Direction.loaded = true;
    /* Fire and forget: the panel paints its own placeholder and fills in. */
    Direction.fetch(false);
  },

  async fetch(refresh) {
    if (Direction.busy) return;
    Direction.busy = true;
    Direction.error = '';
    if (refresh) Direction.paintInto();
    try {
      const r = await fetch('/api/flow/direction', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: !!refresh })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) Direction.error = j.error || 'The direction could not be written just now.';
      else Direction.data = j;
    } catch (e) {
      Direction.error = 'Could not reach the server.';
    }
    Direction.busy = false;
    Direction.paintInto();
  },

  /* Repaint only this card. Redrawing the whole tab would throw away a
     half-typed focus area or metric name somewhere further down. */
  paintInto() {
    const host = document.getElementById('dir-card');
    if (!host) return;
    host.outerHTML = Direction.card();
    const sec = NorthStar.sec || document;
    Direction.wire(sec);
  },

  card() {
    let body;
    if (Direction.busy) {
      body = '<p class="dir-empty">Reading the last eight weeks…</p>';
    } else if (Direction.error) {
      body = '<p class="dir-empty">' + esc(Direction.error) + '</p>' +
             '<button class="flow-btn sm" id="dir-retry">Try again</button>';
    } else if (!Direction.data) {
      body = '<p class="dir-empty">Working out where this is going…</p>';
    } else {
      const d = Direction.data;
      body =
        (d.lede ? '<p class="dir-lede">' + esc(d.lede) + '</p>' : '') +
        (d.today ? '<div class="dir-block"><h4>Today</h4><p>' + esc(d.today) + '</p></div>' : '') +
        (d.trajectory ? '<div class="dir-block"><h4>Where this is going</h4><p>' + esc(d.trajectory) + '</p></div>' : '') +
        ((d.actions && d.actions.length)
          ? '<div class="dir-block"><h4>Do these</h4><ul class="dir-acts">' +
              d.actions.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul></div>' : '') +
        ((d.watch && d.watch.length)
          ? '<div class="dir-block"><h4>Slipping</h4><ul class="dir-acts">' +
              d.watch.map(a => '<li class="dir-watch">' + esc(a) + '</li>').join('') + '</ul></div>' : '') +
        '<div class="flow-row" style="margin-top:15px">' +
          '<button class="flow-btn sm ghost" id="dir-refresh">Rewrite it</button>' +
          (Direction.birth ? '<button class="flow-btn sm ghost" id="dir-birth-edit">Birth date</button>' : '') +
        '</div>';
    }

    /* Asked once, never nagged: the panel works without it, the sign just
       changes the voice. */
    const askBirth = (!Direction.birth && !Direction.asking)
      ? '<div class="dir-block"><h4>Optional</h4>' +
        '<p class="flow-sub">Give your birth date and the daily read is written for your sign. ' +
          'Everything it claims still comes from your own record.</p>' +
        '<button class="flow-btn sm" id="dir-birth-add">Add birth date</button></div>'
      : '';

    const birthForm = Direction.asking
      ? '<div class="dir-birth">' +
          '<input class="flow-in" type="date" id="dir-birth-in" value="' + esc(Direction.birth) + '" aria-label="Birth date">' +
          '<button class="flow-btn primary sm" id="dir-birth-save">Save</button>' +
          '<button class="flow-btn ghost sm" id="dir-birth-cancel">Cancel</button>' +
          (Direction.birth ? '<button class="flow-btn ghost sm danger" id="dir-birth-clear">Remove</button>' : '') +
        '</div>'
      : '';

    const when = (Direction.data && Direction.data.generatedAt)
      ? new Date(Direction.data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    return '' +
      '<div class="flow-card dir-card" id="dir-card">' +
        '<div class="dir-top">' +
          '<h3 style="margin:0">Direction</h3>' +
          (Direction.data && Direction.data.sign ? '<span class="dir-sign">' + esc(Direction.data.sign) + '</span>' : '') +
          (when ? '<span class="dir-when">written ' + when + '</span>' : '') +
        '</div>' +
        body + askBirth + birthForm +
      '</div>';
  },

  wire(sec) {
    const on = (id, fn) => { const el = $('#' + id, sec) || document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('dir-refresh', () => Direction.fetch(true));
    on('dir-retry', () => Direction.fetch(false));
    on('dir-birth-add', () => { Direction.asking = true; Direction.paintInto(); });
    on('dir-birth-edit', () => { Direction.asking = true; Direction.paintInto(); });
    on('dir-birth-cancel', () => { Direction.asking = false; Direction.paintInto(); });
    on('dir-birth-save', () => {
      const el = document.getElementById('dir-birth-in');
      const v = (el && el.value || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('Pick a date first.', 'warn'); return; }
      Direction.birth = v;
      DB.set(Direction.K_BIRTH, v);
      Direction.asking = false;
      /* A new sign means the reading is addressed to the wrong person until
         it is rewritten, so rewrite it now rather than tomorrow. */
      Direction.fetch(true);
    });
    on('dir-birth-clear', () => {
      Direction.birth = '';
      DB.set(Direction.K_BIRTH, '');
      Direction.asking = false;
      Direction.fetch(true);
    });
  }
};


/* ======================================================================
 * 20c-i · Fold — one tap-to-open section, used by every long card
 *
 * The North Star tab is four cards, three of which are long lists you
 * mostly glance at: the scoreboard, the focus areas, the principles. Left
 * open they push each other off a phone screen entirely. This is the same
 * fold the Today groups use, factored out so all three behave identically
 * and there is one place to change how any of them opens.
 *
 * A summary lives in the header — a count, a percentage — and, where there
 * is something to measure, a progress bar sits OUTSIDE the folding part.
 * Shut, those two things are the whole answer, which is what makes a folded
 * section a real state rather than a stub.
 *
 * Open or shut is UI, not data: it belongs to this device, never to the
 * account, so it lives in the pack's own localStorage namespace.
 * ==================================================================== */
const Fold = {
  LS: 'flowpack:nsOpen',
  all() { try { return JSON.parse(localStorage.getItem(Fold.LS) || '{}') || {}; } catch (e) { return {}; } },
  isOpen(key) { return !!Fold.all()[key]; },
  setOpen(key, v) {
    const s = Fold.all();
    if (v) s[key] = 1; else delete s[key];
    try { localStorage.setItem(Fold.LS, JSON.stringify(s)); } catch (e) {}
  },

  /** The header row: title, summary chip, chevron. Tap or Enter to toggle. */
  head(key, title, chip, chipZero) {
    const open = Fold.isOpen(key);
    return '<div class="fold-head" data-fold="' + key + '" role="button" tabindex="0" ' +
        'aria-expanded="' + (open ? 'true' : 'false') + '" ' +
        'aria-label="' + esc(title) + ', ' + (open ? 'collapse' : 'expand') + '">' +
        '<h3>' + esc(title) + '</h3>' +
        (chip ? '<span class="flow-chip accent' + (chipZero ? ' zero' : '') + '">' + esc(chip) + '</span>' : '') +
        '<span class="flow-fold-chev" aria-hidden="true"></span>' +
      '</div>';
  },
  /** The summary bar. Deliberately not inside the folding part. */
  bar(pct) { return '<div class="td-prog fold-prog"><div class="fill" style="width:' + clamp(pct || 0, 0, 100) + '%"></div></div>'; },

  card(key, inner) { return '<div class="flow-card fold-card' + (Fold.isOpen(key) ? ' is-open' : '') + '" data-foldcard="' + key + '">' + inner + '</div>'; },
  body(inner) { return '<div class="fold-body">' + inner + '</div>'; },

  /** One listener for every fold on the tab. */
  wire(sec) {
    $$('.fold-head', sec).forEach(head => {
      if (head.__wired) return;
      head.__wired = 1;
      const key = head.getAttribute('data-fold');
      const card = head.closest('.fold-card');
      if (!card) return;
      const title = (($('h3', head) || {}).textContent || '').trim();
      const toggle = (e) => {
        e.preventDefault(); e.stopPropagation();
        const now = !card.classList.contains('is-open');
        card.classList.toggle('is-open', now);
        head.setAttribute('aria-expanded', now ? 'true' : 'false');
        head.setAttribute('aria-label', title + ', ' + (now ? 'collapse' : 'expand'));
        Fold.setOpen(key, now);
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); });
    });
  }
};

/* ======================================================================
 * 20d · Scoreboard — the metrics that actually say whether it happened
 *
 * Focus areas are a feeling ("DJing: 40%"). This is the evidence. One tap
 * per set played, demo sent, session produced, workout done, and the week
 * either shows the work or it doesn't.
 *
 * Stored as a daily ledger — { 'YYYY-MM-DD': { metricId: n } } — rather
 * than a running total, because a total can only ever answer "how many";
 * the ledger answers "when", which is what a trajectory is made of. It is
 * also what the Direction engine reads.
 * ==================================================================== */
/* ======================================================================
 * 20d-0 · The routine audit — the maths
 *
 *   70% of our life is things we do everyday
 *   audit your routine every 6 months
 *   keep what's working
 *   get rid of what isn't
 *   ...watch your life change
 *
 * Every other part of this app is about the day. This is the twice-a-year
 * step back: every recurring thing you track, put next to what actually
 * happened, and a decision on each one. The app does not decide — it has no
 * business telling anyone which parts of their life to cut. It only refuses
 * to let the question be answered from memory, which is where a routine that
 * stopped working six months ago survives.
 *
 * Kept pure and separate from the UI so the arithmetic can be tested without
 * a browser: everything below takes data in and returns numbers out.
 * ==================================================================== */
const AuditMath = {
  /* The window: `months` back from `to`, by calendar month, so a six-month
     audit run in March covers September — not "183 days ago". */
  window(months, to) {
    const end = to ? new Date(to.getTime()) : new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime());
    start.setMonth(start.getMonth() - months);
    return { from: isoDate(start), to: isoDate(end), days: Math.round((end - start) / 86400000) };
  },

  /* Every ISO date in [from, to]. Six months is ~183 strings — small enough
     to just hold, and it makes every count below a one-liner. */
  daysIn(from, to) {
    const out = [];
    let d = parseISO(from);
    const end = parseISO(to);
    while (d <= end && out.length < 4000) { out.push(isoDate(d)); d = addDays(d, 1); }
    return out;
  },

  /* Split in two so a routine that is quietly dying can be seen dying rather
     than averaged into looking fine. */
  halves(days) {
    const mid = Math.floor(days.length / 2);
    return { first: days.slice(0, mid), second: days.slice(mid) };
  },

  /* -1 falling, 0 level, +1 rising. A tenth of the first half is the noise
     floor: below that the two halves are the same half. */
  trend(a, b) {
    const floor = Math.max(1, a * 0.1);
    if (b - a > floor) return 1;
    if (a - b > floor) return -1;
    return 0;
  },

  /* What the record says, for one thing you meant to do repeatedly.
     `hits` is the set of days it happened; `expected` is how many times the
     target implies over this window. */
  read(hits, days, expected) {
    const set = {};
    hits.forEach(h => { set[h] = (set[h] || 0) + 1; });
    const count = (list) => list.reduce((n, d) => n + (set[d] || 0), 0);
    const done = count(days);
    const h = AuditMath.halves(days);
    const first = count(h.first), second = count(h.second);
    const withIt = days.filter(d => set[d]).length;
    let last = '';
    for (let i = days.length - 1; i >= 0; i--) if (set[days[i]]) { last = days[i]; break; }
    return {
      done, expected: Math.round(expected || 0),
      rate: expected > 0 ? done / expected : (done > 0 ? 1 : 0),
      first, second, trend: AuditMath.trend(first, second),
      daysWithIt: withIt, lastDone: last,
      /* Days since it last happened — the number that says "this stopped"
         more plainly than any percentage. */
      quietFor: last ? days.length - 1 - days.indexOf(last) : days.length
    };
  },

  /* A word for the number, so the row can be read at a glance. Deliberately
     descriptive, never advisory: "not happening" is a fact, "drop this" would
     be a decision, and the decision is not the app's to make. */
  verdict(r) {
    if (!r.done) return 'never happened';
    if (r.rate >= 0.85) return 'holding';
    if (r.rate >= 0.5)  return 'most weeks';
    if (r.rate >= 0.2)  return 'patchy';
    return 'barely happened';
  },

  /* How many weeks and months the window spans, for turning a per-week or
     per-month target into "times expected across six months". */
  spans(days) {
    return { weeks: days.length / 7, months: days.length / 30.4375 };
  },

  /* When the next one falls due, and whether it already has. */
  /* Never audited is not the same as due.
     It used to be: no previous audit meant due: true, unconditionally. Which
     is right for somebody six months in and nonsense for an account created
     this morning — the banner says "six months of things you do every day are
     sitting in the record" to a person whose record is empty, and it said it
     to the first App Store reviewer who signed in. There is nothing there to
     audit and the sentence is simply false.
     So the clock starts at the first thing the record actually holds. The
     card still offers "Run one anyway" the whole time; this only governs
     whether the app brings it up unprompted. */
  due(lastAt, months, now, firstAt) {
    const n = now ? new Date(now.getTime()) : new Date();
    const from = lastAt || firstAt;
    if (!from) {
      /* Nothing recorded at all. Not due, and no date to promise either. */
      return { due: false, on: null, never: true, empty: true };
    }
    const d = parseISO(String(from).slice(0, 10));
    d.setMonth(d.getMonth() + months);
    return { due: n >= d, on: isoDate(d), never: !lastAt,
             daysAway: Math.round((d - n) / 86400000) };
  }
};

/* ======================================================================
 * 20d-i · Friends — two accounts, paired by a code that works once
 *
 * The thing that makes a scoreboard work is somebody else being able to see
 * it. This is that, and deliberately no more than that: a friend never gains
 * access to your app. Each person PUBLISHES a card — the metrics and streaks,
 * this week's plan and Big Rock count, today's one-line check-in — and the
 * only thing a friend can read is the card. There is no code path, on the
 * client or the server, that reads one account's storage for another.
 *
 * You choose what goes on the card, and you can drop any of the three at any
 * time; what is switched off is not sent at all rather than sent and hidden.
 * ==================================================================== */
const Friends = {
  loaded: false,
  list: [],
  codes: [],
  busy: false,
  error: '',
  entering: false,     /* the "enter a friend's code" box is showing */
  lastSent: '',        /* hash of the last card published, to avoid re-sending */

  K_SHARE:   'flow:friends:share',
  K_CHECKIN: 'flow:friends:checkin',

  DEFAULT_SHARE: { score: true, plan: true, checkin: true },

  share: null,
  checkin: null,       /* { day, text } — kept in your own store as well */

  isOpen() { return Fold.isOpen('friends'); },

  async api(path, body) {
    const r = await fetch('/api/friends/' + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'That did not work.');
    return j;
  },

  async load() {
    if (Friends.loaded) return;
    const [sh, ci] = await Promise.all([
      DB.get(Friends.K_SHARE, null),
      DB.get(Friends.K_CHECKIN, null)
    ]);
    Friends.share = Object.assign({}, Friends.DEFAULT_SHARE, (sh && typeof sh === 'object') ? sh : {});
    Friends.checkin = (ci && typeof ci === 'object') ? ci : null;
    Friends.loaded = true;
    Friends.refresh().catch(() => {});
  },

  saveShare()   { DB.set(Friends.K_SHARE, Friends.share); },
  saveCheckin() { DB.set(Friends.K_CHECKIN, Friends.checkin); },

  /* Today's check-in only. Yesterday's line is not something a friend should
     still be reading as if it were now. */
  todayCheckin() {
    const c = Friends.checkin;
    return (c && c.day === today() && String(c.text || '').trim()) ? c.text : '';
  },

  lastFetch: 0,

  /* Opening the tab is the moment you want to know whether anything moved on
     their side — and it is also the moment somebody who has just redeemed
     your code should stop being invisible to you. Throttled, because the tab
     is also re-entered by every tap on the segment row. */
  maybeRefresh(minMs) {
    if (!Friends.loaded) return;
    /* With nobody paired you are, by definition, waiting for somebody to
       redeem your code — so look almost every time. With friends already
       there, this is just a poll for new numbers and can be lazy. */
    const min = minMs || (Friends.list.length ? 20000 : 4000);
    if (Date.now() - Friends.lastFetch < min) return;
    Friends.refresh().catch(() => {});
  },

  async refresh() {
    Friends.lastFetch = Date.now();
    try {
      const [l, c] = await Promise.all([Friends.api('list'), Friends.api('codes')]);
      Friends.list = l.friends || [];
      Friends.codes = c.codes || [];
      Friends.error = '';
    } catch (e) {
      Friends.error = e.message || 'Could not reach the server.';
    }
    Friends.paintInto();
    /* Publishing is pointless with nobody to read it, and doing it anyway
       would put a card on the server for an account that never paired. */
    if (Friends.list.length) Friends.publish();
  },

  /* ---------------------- the card you publish ---------------------- */

  /* Built from the app's own live data, and only from the parts switched on.
     Nothing here reaches past what the person agreed to share. */
  build() {
    const card = { metrics: [], plan: null, rocks: null, checkin: null };

    if (Friends.share.score && Score.loaded) {
      card.metrics = Score.metrics.map(m => ({
        icon: m.icon, name: m.name, unit: m.unit, period: m.period,
        target: m.target, count: Score.count(m), streak: Score.streak(m)
      }));
    }

    const c = NorthStar.host('cData');
    const wid = (() => { try { return NorthStar.host('cWeekId')(); } catch (e) { return ''; } })();

    if (Friends.share.plan && c && wid) {
      const text = String((c.plans && c.plans[wid]) || '').trim();
      if (text) card.plan = { week: wid, text };
      const rocks = (c.rocks && c.rocks[wid]) || [];
      card.rocks = {
        week: wid,
        done: rocks.filter(r => r && r.done).length,
        total: rocks.length,
        items: rocks.map(r => ({ title: r.title, done: !!r.done }))
      };
    }

    if (Friends.share.checkin) {
      const t = Friends.todayCheckin();
      if (t) card.checkin = { text: t, day: today() };
    }

    return card;
  },

  /* Sent only when something actually changed. North Star repaints on every
     tap, and a card per tap would be a write per tap. */
  async publish(force) {
    let card;
    try { card = Friends.build(); } catch (e) { return; }
    const sig = JSON.stringify(card);
    if (!force && sig === Friends.lastSent) return;
    Friends.lastSent = sig;
    try { await Friends.api('card', { card }); }
    catch (e) { Friends.lastSent = ''; }    /* so the next chance tries again */
  },

  /* ---------------------------- the card ---------------------------- */

  card() {
    const n = Friends.list.length;
    const chip = Friends.error ? 'offline' : (n ? n + (n === 1 ? ' friend' : ' friends') : 'nobody yet');

    return Fold.card('friends',
      Fold.head('friends', 'Friends', chip, !n) +
      Fold.body(
        (Friends.error ? '<p class="fr-err">' + esc(Friends.error) + '</p>' : '') +
        Friends.peopleHtml() +
        Friends.checkinHtml() +
        Friends.pairHtml() +
        Friends.shareHtml()
      )
    );
  },

  peopleHtml() {
    if (!Friends.list.length) {
      return '<p class="flow-sub fr-none">Nobody is paired with you yet. Make a code below and send it ' +
             'to one person — it works once, then it is spent.</p>';
    }
    return '<div class="fr-people">' + Friends.list.map(f => Friends.personHtml(f)).join('') + '</div>';
  },

  personHtml(f) {
    const c = f.card;
    const when = (c && c.at)
      ? new Date(c.at).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';

    let body;
    if (!c) {
      body = '<p class="fr-quiet">Nothing shared yet.</p>';
    } else {
      const onTarget = (c.metrics || []).filter(m => m.target > 0 && m.count >= m.target).length;
      const withTarget = (c.metrics || []).filter(m => m.target > 0).length;

      /* Sorted by how far along each one is, so the week's actual story is at
         the top instead of buried under whichever metrics happen to be listed
         first and sitting at zero. */
      const strips = (c.metrics || [])
        .filter(m => m.target > 0 || m.count > 0)
        .map(m => Object.assign({ _p: m.target ? m.count / m.target : (m.count ? 1 : 0) }, m))
        .sort((a, b) => (b._p - a._p) || (b.count - a.count))
        .slice(0, 10).map(m => {
        const pct = m.target ? clamp(Math.round((m.count / m.target) * 100), 0, 100) : (m.count ? 100 : 0);
        return '<div class="fr-metric' + (m.target && m.count >= m.target ? ' hit' : '') + '">' +
          '<span class="fr-ic">' + esc(m.icon || '⭐') + '</span>' +
          '<span class="fr-nm">' + esc(m.name) + '</span>' +
          '<span class="fr-ct">' + m.count + (m.target ? '/' + m.target : '') + '</span>' +
          (m.streak > 1 ? '<span class="fr-st">🔥' + m.streak + '</span>' : '') +
          '<span class="fr-bar"><i style="width:' + pct + '%"></i></span>' +
        '</div>';
      }).join('');

      const rocks = c.rocks && c.rocks.total
        ? '<div class="fr-block"><h5>Big Rocks · ' + c.rocks.done + ' of ' + c.rocks.total + '</h5>' +
          '<ul class="fr-rocks">' + (c.rocks.items || []).slice(0, 8).map(r =>
            '<li class="' + (r.done ? 'done' : '') + '">' + esc(r.title) + '</li>').join('') +
          '</ul></div>'
        : '';

      const plan = c.plan && c.plan.text
        ? '<div class="fr-block"><h5>This week</h5><p class="fr-plan">' + esc(c.plan.text) + '</p></div>' : '';

      const ci = c.checkin && c.checkin.text
        ? '<div class="fr-checkin"><span class="fr-ci-lbl">Today</span>' + esc(c.checkin.text) + '</div>' : '';

      body =
        ci +
        (strips
          ? '<div class="fr-block"><h5>Scoreboard' +
            (withTarget ? ' · ' + onTarget + ' of ' + withTarget + ' on target' : '') +
            '</h5>' + strips + '</div>'
          : '') +
        rocks + plan;
    }

    return '<div class="fr-person" data-fr-person="' + esc(f.id) + '">' +
      '<div class="fr-head">' +
        '<span class="fr-av">' + esc((f.name || '?').trim()[0].toUpperCase()) + '</span>' +
        '<span class="fr-name">' + esc(f.name) + '</span>' +
        (when ? '<span class="fr-when">' + esc(when) + '</span>' : '') +
        '<button type="button" class="fr-x" data-fr-unpair="' + esc(f.id) + '" ' +
          'aria-label="Unpair from ' + esc(f.name) + '">Unpair</button>' +
      '</div>' + body +
    '</div>';
  },

  checkinHtml() {
    if (!Friends.list.length || !Friends.share.checkin) return '';
    return '<div class="fr-cibox">' +
      '<label for="fr-ci">Today, in one line</label>' +
      '<input class="flow-in" id="fr-ci" type="text" maxlength="200" ' +
        'placeholder="Two hours in the studio, gym done." value="' + esc(Friends.todayCheckin()) + '">' +
      '<span class="fr-cisaved" id="fr-cisaved"></span>' +
    '</div>';
  },

  pairHtml() {
    const codes = Friends.codes.map(c =>
      '<div class="fr-code">' +
        '<code>' + esc(c.code) + '</code>' +
        '<button type="button" class="flow-btn sm ghost" data-fr-copy="' + esc(c.code) + '">Copy</button>' +
        '<button type="button" class="flow-btn sm ghost danger" data-fr-revoke="' + esc(c.code) + '">Cancel</button>' +
      '</div>').join('');

    const enter = Friends.entering
      ? '<div class="fr-enter">' +
          '<input class="flow-in" id="fr-code-in" type="text" placeholder="ABCD-2345" ' +
            'autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" maxlength="9">' +
          '<button type="button" class="flow-btn primary sm" id="fr-redeem">Pair</button>' +
          '<button type="button" class="flow-btn ghost sm" id="fr-enter-cancel">Cancel</button>' +
        '</div>'
      : '';

    return '<div class="fr-pair">' +
      '<h5>Pair with someone</h5>' +
      (codes
        ? '<p class="flow-sub">Send one of these to one person. Each works once and expires in two weeks.</p>' + codes
        : '<p class="flow-sub">Make a code and send it to one person, or type in the code they sent you.</p>') +
      '<div class="flow-row">' +
        '<button type="button" class="flow-btn sm" id="fr-newcode"' + (Friends.busy ? ' disabled' : '') + '>Make a code</button>' +
        (Friends.entering ? '' : '<button type="button" class="flow-btn sm ghost" id="fr-enter-open">I have a code</button>') +
      '</div>' + enter +
    '</div>';
  },

  shareHtml() {
    if (!Friends.list.length) return '';
    const sw = (k, label, note) =>
      '<label class="fr-sw"><input type="checkbox" data-fr-share="' + k + '"' +
      (Friends.share[k] ? ' checked' : '') + '>' +
      '<span><b>' + esc(label) + '</b><em>' + esc(note) + '</em></span></label>';
    return '<div class="fr-share">' +
      '<h5>What they can see</h5>' +
      sw('score',   'Scoreboard',   'Your counts and streaks — the numbers, not the ledger.') +
      sw('plan',    'Week',         "This week's plan and how many Big Rocks are done.") +
      sw('checkin', 'Check-in',     'The one line you write above, for today only.') +
      '<p class="flow-sub fr-note">Switched off is not sent — it is not hidden on their screen, it never leaves here.</p>' +
    '</div>';
  },

  /* ------------------------------ wiring ---------------------------- */

  paintInto() {
    const host = document.querySelector('[data-foldcard="friends"]');
    if (!host) return;
    const open = host.classList.contains('is-open');
    host.outerHTML = Friends.card();
    const fresh = document.querySelector('[data-foldcard="friends"]');
    if (fresh && open) fresh.classList.add('is-open');
    const sec = NorthStar.sec || document;
    Friends.wire(sec);
    Fold.wire(sec);
  },

  async act(fn) {
    if (Friends.busy) return;
    Friends.busy = true;
    try { await fn(); }
    catch (e) { toast(e.message || 'That did not work.', 'warn'); }
    Friends.busy = false;
  },

  wire(sec) {
    const root = sec || document;

    const on = (sel, ev, fn) => {
      const el = root.querySelector(sel);
      if (el && !el.__frWired) { el.__frWired = 1; el.addEventListener(ev, fn); }
    };

    on('#fr-newcode', 'click', () => Friends.act(async () => {
      const r = await Friends.api('code', {});
      Friends.codes = (await Friends.api('codes')).codes || [];
      Friends.paintInto();
      Friends.copy(r.code);
      toast('Code ' + r.code + ' copied — send it to one person.');
    }));

    on('#fr-enter-open', 'click', () => { Friends.entering = true; Friends.paintInto();
      const i = document.getElementById('fr-code-in'); if (i) i.focus(); });
    on('#fr-enter-cancel', 'click', () => { Friends.entering = false; Friends.paintInto(); });

    const redeem = () => Friends.act(async () => {
      const el = document.getElementById('fr-code-in');
      const code = el ? el.value.trim() : '';
      if (!code) { toast('Type the code first.', 'warn'); return; }
      const r = await Friends.api('redeem', { code });
      Friends.entering = false;
      toast('Paired with ' + (r.friend && r.friend.name ? r.friend.name : 'your friend') + ' ✓');
      /* Publish straight away, or their side sits empty until you next open
         this tab — the first thing they do is look. */
      await Friends.refresh();
      await Friends.publish(true);
    });
    on('#fr-redeem', 'click', redeem);
    on('#fr-code-in', 'keydown', (e) => { if (e.key === 'Enter') redeem(); });

    root.querySelectorAll('[data-fr-copy]').forEach(b => {
      if (b.__frWired) return; b.__frWired = 1;
      b.addEventListener('click', () => { Friends.copy(b.getAttribute('data-fr-copy')); toast('Copied.'); });
    });

    root.querySelectorAll('[data-fr-revoke]').forEach(b => {
      if (b.__frWired) return; b.__frWired = 1;
      b.addEventListener('click', () => Friends.act(async () => {
        const r = await Friends.api('code/revoke', { code: b.getAttribute('data-fr-revoke') });
        Friends.codes = r.codes || [];
        Friends.paintInto();
        toast('Code cancelled.');
      }));
    });

    root.querySelectorAll('[data-fr-unpair]').forEach(b => {
      if (b.__frWired) return; b.__frWired = 1;
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-fr-unpair');
        const who = (Friends.list.find(f => f.id === id) || {}).name || 'them';
        /* No dialog: this is reversible with a new code, and a confirm on a
           phone is one more thing to dismiss. The toast says what happened. */
        Friends.act(async () => {
          await Friends.api('unpair', { id });
          await Friends.refresh();
          toast('No longer paired with ' + who + '.');
        });
      });
    });

    root.querySelectorAll('[data-fr-share]').forEach(cb => {
      if (cb.__frWired) return; cb.__frWired = 1;
      cb.addEventListener('change', () => {
        Friends.share[cb.getAttribute('data-fr-share')] = cb.checked;
        Friends.saveShare();
        Friends.publish(true);
        Friends.paintInto();
      });
    });

    const ci = root.querySelector('#fr-ci');
    if (ci && !ci.__frWired) {
      ci.__frWired = 1;
      let t = null;
      const commit = () => {
        const text = ci.value.trim();
        Friends.checkin = text ? { day: today(), text } : null;
        Friends.saveCheckin();
        Friends.publish(true);
        const s = document.getElementById('fr-cisaved');
        if (s) { s.textContent = 'shared'; setTimeout(() => { if (s) s.textContent = ''; }, 1600); }
      };
      ci.addEventListener('input', () => { clearTimeout(t); t = setTimeout(commit, 800); });
      ci.addEventListener('blur', () => { clearTimeout(t); commit(); });
      ci.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); commit(); ci.blur(); } });
    }
  },

  copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return; }
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    } catch (e) {}
  }
};

/* ======================================================================
 * 20d-ii · The routine audit — the review itself
 *
 * Twice a year, everything you do on repeat, next to what actually happened,
 * with one decision each: keep it, change it, or cut it. Cutting archives —
 * six months of evidence is exactly what makes the next audit worth doing,
 * so nothing is ever deleted to get a row off the screen.
 * ==================================================================== */
const Audit = {
  loaded: false,
  cfg: null,
  log: [],
  draft: null,
  view: null,          /* the collected items for the audit in progress */
  editing: '',         /* key of the metric whose target is being changed */

  K_CFG:   'flow:audit:cfg',
  K_LOG:   'flow:audit:log',
  K_DRAFT: 'flow:audit:draft',
  K_ARCH:  'flow:audit:archivedMetrics',

  DEFAULT_CFG: { months: 6 },
  KEEP_LOGS: 12,

  QUOTE: [
    '70% of our life is things we do everyday',
    'audit your routine every 6 months',
    "keep what's working",
    "get rid of what isn't",
    '…watch your life change'
  ],

  async load() {
    if (Audit.loaded) return;
    const [c, l, d] = await Promise.all([
      DB.get(Audit.K_CFG, null), DB.get(Audit.K_LOG, null), DB.get(Audit.K_DRAFT, null)
    ]);
    Audit.cfg = Object.assign({}, Audit.DEFAULT_CFG, (c && typeof c === 'object') ? c : {});
    Audit.log = Array.isArray(l) ? l : [];
    Audit.draft = (d && typeof d === 'object' && d.startedAt) ? d : null;
    Audit.loaded = true;
    if (Audit.draft) Audit.view = Audit.collect();
  },

  saveCfg()   { DB.set(Audit.K_CFG, Audit.cfg); },
  saveLog()   { DB.set(Audit.K_LOG, Audit.log.slice(-Audit.KEEP_LOGS)); },
  saveDraft() { DB.set(Audit.K_DRAFT, Audit.draft); },

  last()  { return Audit.log.length ? Audit.log[Audit.log.length - 1] : null; },
  due()   { const l = Audit.last(); return AuditMath.due(l && l.at, Audit.cfg.months, null, Audit.firstRecord()); },

  /* The earliest day this account has any record of doing anything — the
     scoreboard's daily ledger and the habit ticks, which is what the audit
     reads. Memoised: this is asked on every Today render, and the answer
     only moves when somebody backfills a date earlier than the earliest one
     they already had. */
  _first: undefined,
  firstRecord() {
    if (Audit._first !== undefined) return Audit._first;
    let earliest = null;
    const keep = (d) => {
      const s = String(d || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s) && (!earliest || s < earliest)) earliest = s;
    };
    try { Object.keys((Score && Score.log) || {}).forEach(keep); } catch (e) {}
    try {
      const S = NorthStar.host('S');
      const hb = S && S.get('habits', null);
      const comp = (hb && hb.completions) || {};
      Object.keys(comp).forEach(h => Object.keys(comp[h] || {}).forEach(keep));
    } catch (e) {}
    Audit._first = earliest;
    return earliest;
  },

  /* ---- the host's own recurring things ---------------------------------- */

  sawOff() {
    try {
      const S = NorthStar.host('S');
      const v = S && S.get('sawOff', []);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  },
  setSawOff(list) {
    try {
      const S = NorthStar.host('S');
      if (S) S.set('sawOff', list);
    } catch (e) {}
  },

  /* Everything recurring, with the record beside it. */
  collect() {
    const w = AuditMath.window(Audit.cfg.months);
    const days = AuditMath.daysIn(w.from, w.to);
    const spans = AuditMath.spans(days);
    const items = [];

    /* Scoreboard metrics — the daily ledger is exactly the evidence. */
    const log = (Score && Score.log) || {};
    ((Score && Score.metrics) || []).forEach(m => {
      const hits = [];
      days.forEach(d => {
        const n = (log[d] && log[d][m.id]) || 0;
        for (let i = 0; i < n; i++) hits.push(d);
      });
      const expected = (m.target || 0) * (m.period === 'month' ? spans.months : spans.weeks);
      items.push({
        key: 'metric:' + m.id, kind: 'metric', id: m.id,
        icon: m.icon || '⭐', name: m.name, unit: m.unit || 'times',
        every: m.period === 'month' ? 'a month' : 'a week', target: m.target || 0,
        span: 'days', read: AuditMath.read(hits, days, expected)
      });
    });

    /* Habits — doing it every day is the whole idea, so the window is the
       target and no separate number is needed. */
    const hb = NorthStar.host('hbData');
    if (hb && Array.isArray(hb.habits)) hb.habits.forEach(h => {
      const c = (hb.completions && hb.completions[h.id]) || {};
      const hits = days.filter(d => c[d]);
      items.push({
        key: 'habit:' + h.id, kind: 'habit', id: h.id,
        icon: '🔁', name: h.name, unit: 'days', every: 'a day', target: 1,
        span: 'days', read: AuditMath.read(hits, days, days.length)
      });
    });

    /* The weekly rhythm — ticked once a week, so weeks are the unit. */
    const saw = NorthStar.host('SAW_ITEMS') || [];
    const cd = NorthStar.host('cData');
    const wkId = NorthStar.host('weekId');
    if (saw.length && cd && typeof wkId === 'function') {
      const weeks = [], seen = {};
      days.forEach(d => { const id = wkId(parseISO(d)); if (!seen[id]) { seen[id] = 1; weeks.push(id); } });
      const off = Audit.sawOff();
      saw.forEach(row => {
        const k = row[0], label = String(row[1] || '');
        const hits = weeks.filter(id => cd.saw && cd.saw[id] && cd.saw[id][k]);
        const icon = (label.match(/^\S+/) || [''])[0];
        items.push({
          key: 'saw:' + k, kind: 'saw', id: k,
          icon: /[a-z0-9]/i.test(icon) ? '🪚' : icon,
          name: label.replace(/^\S+\s*/, '') || label,
          unit: 'weeks', every: 'a week', target: 1, span: 'weeks',
          off: off.indexOf(k) >= 0,
          read: AuditMath.read(hits, weeks, weeks.length)
        });
      });
    }

    return { window: w, days, items: items.filter(i => !i.off) };
  },

  /* ---- running one ------------------------------------------------------ */

  start() {
    Audit.view = Audit.collect();
    Audit.draft = {
      startedAt: new Date().toISOString(),
      from: Audit.view.window.from, to: Audit.view.window.to,
      months: Audit.cfg.months,
      decisions: {}
    };
    Audit.saveDraft();
    Audit.paintInto();
  },

  abandon() {
    Audit.draft = null; Audit.view = null; Audit.editing = '';
    DB.set(Audit.K_DRAFT, null);
    Audit.paintInto();
  },

  decide(key, decision, extra) {
    if (!Audit.draft) return;
    Audit.draft.decisions[key] = Object.assign({ decision }, extra || {});
    Audit.saveDraft();
    Audit.paintInto();
  },

  decided() { return Audit.draft ? Object.keys(Audit.draft.decisions).length : 0; },
  total()   { return Audit.view ? Audit.view.items.length : 0; },

  /* Apply what was decided, then write it down. The write happens last: if
     something below throws, the audit is still there to finish rather than
     recorded as done with half of it applied. */
  async finish() {
    if (!Audit.draft || !Audit.view) return;
    const applied = { kept: 0, changed: 0, cut: 0 };
    const record = [];

    const cutSaw = [];
    let metricsTouched = false, habitsTouched = false;

    Audit.view.items.forEach(it => {
      const d = Audit.draft.decisions[it.key];
      if (!d) return;
      record.push({
        key: it.key, kind: it.kind, name: it.name,
        decision: d.decision, target: it.target, newTarget: d.target,
        done: it.read.done, expected: it.read.expected,
        rate: Math.round(it.read.rate * 100), trend: it.read.trend
      });

      if (d.decision === 'keep') { applied.kept++; return; }

      if (d.decision === 'change' && it.kind === 'metric') {
        const m = Score.metrics.find(x => x.id === it.id);
        if (m) { m.target = Math.max(0, parseInt(d.target, 10) || 0); metricsTouched = true; }
        applied.changed++;
        return;
      }

      if (d.decision === 'cut') {
        applied.cut++;
        if (it.kind === 'metric') {
          const i = Score.metrics.findIndex(x => x.id === it.id);
          if (i >= 0) {
            /* Archived, never deleted — the ledger stays keyed by this id and
               is the whole reason the next audit is worth anything. */
            const [m] = Score.metrics.splice(i, 1);
            DB.get(Audit.K_ARCH, []).then(a => {
              const arr = Array.isArray(a) ? a : [];
              arr.push(Object.assign({ cutAt: new Date().toISOString() }, m));
              DB.set(Audit.K_ARCH, arr);
            });
            metricsTouched = true;
          }
        } else if (it.kind === 'habit') {
          const hb = NorthStar.host('hbData');
          const S = NorthStar.host('S');
          if (hb && Array.isArray(hb.habits)) {
            const i = hb.habits.findIndex(h => h.id === it.id);
            if (i >= 0) {
              const [h] = hb.habits.splice(i, 1);
              hb.archived = Array.isArray(hb.archived) ? hb.archived : [];
              hb.archived.push(Object.assign({ cutAt: new Date().toISOString() }, h));
              /* completions are left exactly where they are */
              if (S) S.set('habits', hb);
              habitsTouched = true;
            }
          }
        } else if (it.kind === 'saw') {
          cutSaw.push(it.id);
        }
      }
    });

    if (metricsTouched) Score.saveMetrics();
    if (cutSaw.length) Audit.setSawOff(Audit.sawOff().concat(cutSaw));

    Audit.log.push({
      at: new Date().toISOString(),
      from: Audit.draft.from, to: Audit.draft.to, months: Audit.draft.months,
      counts: applied, items: record
    });
    Audit.saveLog();
    Audit.draft = null; Audit.view = null; Audit.editing = '';
    await DB.set(Audit.K_DRAFT, null);

    try { if (habitsTouched) { const r = NorthStar.host('renderHabits'); if (typeof r === 'function') r(); } } catch (e) {}
    try { const r = NorthStar.host('renderToday'); if (typeof r === 'function') r(); } catch (e) {}
    try { const j = NorthStar.host('J'); if (typeof j === 'function')
      j('planning', '🔎 Routine audit — kept ' + applied.kept + ', changed ' + applied.changed + ', cut ' + applied.cut); } catch (e) {}

    toast('Audit done — kept ' + applied.kept + ', changed ' + applied.changed + ', cut ' + applied.cut);
    NorthStar.paint();
  },

  /* ---- the card --------------------------------------------------------- */

  card() {
    const due = Audit.due();
    const chip = Audit.draft ? (Audit.decided() + ' of ' + Audit.total() + ' decided')
               : due.due ? 'due now'
               : due.empty ? 'once there is a record'
               : (due.daysAway > 45 ? 'in ' + Math.round(due.daysAway / 30) + ' months' : 'in ' + due.daysAway + ' days');

    return Fold.card('audit',
      Fold.head('audit', 'Routine audit', chip, !Audit.draft && !due.due) +
      (Audit.draft ? Fold.bar(Audit.total() ? Math.round(Audit.decided() / Audit.total() * 100) : 0) : '') +
      Fold.body(Audit.draft ? Audit.runHtml() : Audit.introHtml(due))
    );
  },

  introHtml(due) {
    const last = Audit.last();
    const lines = '<blockquote class="au-quote">' +
      Audit.QUOTE.map(l => '<span>' + esc(l) + '</span>').join('') + '</blockquote>';

    const when = last
      ? '<p class="flow-sub">Last audit ' + esc(prettyDate(String(last.at).slice(0, 10))) +
        ' — kept ' + last.counts.kept + ', changed ' + last.counts.changed + ', cut ' + last.counts.cut + '. ' +
        (due.due ? 'The next one is due.' : 'Next due ' + esc(prettyDate(due.on)) + '.') + '</p>'
      : '<p class="flow-sub">You have not run one yet. It reads the last ' + Audit.cfg.months +
        ' months of your own record — nothing to fill in.' +
        (due.empty ? ' There is nothing in the record yet, so there is nothing for it to read.'
                   : (due.due ? '' : ' Worth running once ' + esc(prettyDate(due.on)) + ' has passed.')) +
        '</p>';

    const prev = (Audit.log.length > 1 || (last && last.items && last.items.length))
      ? Audit.historyHtml() : '';

    return lines + when +
      '<div class="flow-row">' +
        '<button type="button" class="flow-btn' + (due.due ? ' primary' : '') + '" id="au-start">' +
          (due.due ? 'Start the audit' : 'Run one anyway') + '</button>' +
        '<button type="button" class="flow-btn sm ghost" id="au-every">Every ' + Audit.cfg.months + ' months</button>' +
      '</div>' + prev;
  },

  historyHtml() {
    const rows = Audit.log.slice().reverse().slice(0, 4).map(a =>
      '<li><b>' + esc(prettyDate(String(a.at).slice(0, 10))) + '</b> · kept ' + a.counts.kept +
      ', changed ' + a.counts.changed + ', cut ' + a.counts.cut + '</li>').join('');
    return '<div class="au-hist"><h5>Before</h5><ul>' + rows + '</ul></div>';
  },

  runHtml() {
    const v = Audit.view;
    if (!v || !v.items.length) {
      return '<p class="flow-sub">There is nothing recurring to audit yet — add a metric to the scoreboard or a habit first.</p>' +
             '<div class="flow-row"><button type="button" class="flow-btn sm ghost" id="au-cancel">Close</button></div>';
    }
    const groups = [
      ['metric', 'Scoreboard'],
      ['habit',  'Habits'],
      ['saw',    'Weekly rhythm']
    ];
    const body = groups.map(([kind, title]) => {
      const rows = v.items.filter(i => i.kind === kind);
      if (!rows.length) return '';
      return '<div class="au-group"><h5>' + esc(title) + '</h5>' + rows.map(Audit.rowHtml).join('') + '</div>';
    }).join('');

    const left = Audit.total() - Audit.decided();
    const foot = left
      ? '<p class="flow-sub au-left">' + left + ' still to decide.</p>'
      : '<button type="button" class="flow-btn primary" id="au-finish">Finish the audit</button>';

    return '<p class="flow-sub au-range">' + esc(prettyDate(v.window.from)) + ' → ' + esc(prettyDate(v.window.to)) +
             ' · ' + v.days.length + ' days of your own record.</p>' +
           body +
           '<div class="au-foot">' + foot +
             '<button type="button" class="flow-btn sm ghost" id="au-cancel">Stop for now</button></div>';
  },

  rowHtml(it) {
    const r = it.read;
    const d = (Audit.draft && Audit.draft.decisions[it.key]) || null;
    const pct = Math.round(clamp(r.rate * 100, 0, 100));
    const arrow = r.trend > 0 ? '<span class="au-up">↑ rising</span>'
                : r.trend < 0 ? '<span class="au-down">↓ fading</span>'
                : '<span class="au-flat">→ level</span>';

    /* "1 streams a week" is the kind of small wrongness that makes a screen
       feel machine-written. Every unit here pluralises with a plain s. */
    const unit = (n, u) => (n === 1 && /s$/i.test(u)) ? u.slice(0, -1) : u;
    const numbers = it.kind === 'habit'
      ? r.done + ' of ' + r.expected + ' days'
      : r.done + ' · ' + (it.target
          ? 'aiming at ' + it.target + ' ' + esc(unit(it.target, it.unit)) + ' ' + it.every + ', so ' + r.expected + ' by now'
          : 'no target set');

    const quiet = r.lastDone
      ? (r.quietFor > 0 ? 'last ' + r.quietFor + ' ' + (it.span === 'weeks' ? (r.quietFor === 1 ? 'week' : 'weeks') : (r.quietFor === 1 ? 'day' : 'days')) + ' ago' : 'today')
      : 'not once';

    const editing = Audit.editing === it.key;
    const controls = editing
      ? '<div class="au-edit">' +
          '<label>New target</label>' +
          '<input class="flow-in" type="number" min="0" max="99" id="au-target" value="' + (it.target || 0) + '">' +
          '<span class="au-per">' + esc(it.unit) + ' ' + it.every + '</span>' +
          '<button type="button" class="flow-btn sm primary" data-au-save="' + esc(it.key) + '">Save</button>' +
          '<button type="button" class="flow-btn sm ghost" data-au-editcancel="1">Cancel</button>' +
        '</div>'
      : '<div class="au-acts">' +
          '<button type="button" class="au-btn keep' + (d && d.decision === 'keep' ? ' on' : '') + '" data-au-keep="' + esc(it.key) + '">Keep</button>' +
          (it.kind === 'metric'
            ? '<button type="button" class="au-btn change' + (d && d.decision === 'change' ? ' on' : '') + '" data-au-change="' + esc(it.key) + '">Change</button>' : '') +
          '<button type="button" class="au-btn cut' + (d && d.decision === 'cut' ? ' on' : '') + '" data-au-cut="' + esc(it.key) + '">Cut</button>' +
        '</div>';

    const said = d
      ? '<span class="au-said ' + d.decision + '">' +
        (d.decision === 'keep' ? 'keeping' : d.decision === 'cut' ? 'cutting' : 'target → ' + esc(String(d.target))) +
        '</span>' : '';

    return '<div class="au-row' + (d ? ' done' : '') + '" data-au-row="' + esc(it.key) + '">' +
      '<div class="au-top">' +
        '<span class="au-ic">' + esc(it.icon) + '</span>' +
        '<span class="au-name">' + esc(it.name) + '</span>' + said +
      '</div>' +
      '<div class="au-bar"><i style="width:' + pct + '%" class="' + (pct >= 85 ? 'good' : pct >= 50 ? 'mid' : 'low') + '"></i></div>' +
      '<div class="au-meta"><b>' + esc(AuditMath.verdict(r)) + '</b> · ' + esc(numbers) + ' · ' + arrow + ' · ' + esc(quiet) + '</div>' +
      controls +
    '</div>';
  },

  /* ---- wiring ----------------------------------------------------------- */

  paintInto() {
    const host = document.querySelector('[data-foldcard="audit"]');
    if (!host) return;
    const open = host.classList.contains('is-open');
    host.outerHTML = Audit.card();
    const fresh = document.querySelector('[data-foldcard="audit"]');
    if (fresh && open) fresh.classList.add('is-open');
    const sec = NorthStar.sec || document;
    Audit.wire(sec);
    Fold.wire(sec);
  },

  wire(sec) {
    const root = sec || document;
    const on = (sel, fn) => {
      const el = root.querySelector(sel);
      if (el && !el.__auWired) { el.__auWired = 1; el.addEventListener('click', fn); }
    };
    const each = (sel, fn) => root.querySelectorAll(sel).forEach(b => {
      if (b.__auWired) return; b.__auWired = 1;
      b.addEventListener('click', () => fn(b));
    });

    on('#au-start', () => Audit.start());
    on('#au-cancel', () => Audit.abandon());
    on('#au-finish', () => Audit.finish());
    on('#au-every', () => {
      const order = [3, 6, 12];
      Audit.cfg.months = order[(order.indexOf(Audit.cfg.months) + 1) % order.length];
      Audit.saveCfg();
      if (Audit.draft) Audit.view = Audit.collect();
      Audit.paintInto();
    });

    each('[data-au-keep]',   b => Audit.decide(b.getAttribute('data-au-keep'), 'keep'));
    each('[data-au-cut]',    b => Audit.decide(b.getAttribute('data-au-cut'), 'cut'));
    each('[data-au-change]', b => { Audit.editing = b.getAttribute('data-au-change'); Audit.paintInto();
      const i = document.getElementById('au-target'); if (i) { i.focus(); i.select(); } });
    each('[data-au-editcancel]', () => { Audit.editing = ''; Audit.paintInto(); });
    each('[data-au-save]', b => {
      const i = document.getElementById('au-target');
      const v = Math.max(0, parseInt(i ? i.value : '0', 10) || 0);
      Audit.editing = '';
      Audit.decide(b.getAttribute('data-au-save'), 'change', { target: v });
    });
  }
};

const Score = {
  sec: null,
  loaded: false,
  metrics: [],
  log: {},

  K_MET: 'flow:ns:metrics',
  K_LOG: 'flow:ns:log',

  isOpen() { return Fold.isOpen('score'); },
  setOpen(v) { Fold.setOpen('score', v); },

  KEEP_DAYS: 500,

  DEFAULTS: [
    { icon: '🎧', name: 'DJ sets',        unit: 'sets',     target: 2, period: 'week'  },
    { icon: '📤', name: 'Demos sent out', unit: 'send-outs',target: 3, period: 'week'  },
    { icon: '🎵', name: 'Music production',unit:'sessions', target: 3, period: 'week'  },
    { icon: '📡', name: 'Live streams',   unit: 'streams',  target: 1, period: 'week'  },
    { icon: '🎤', name: 'Performances',   unit: 'shows',    target: 1, period: 'month' },
    { icon: '🏋️', name: 'Workouts',       unit: 'sessions', target: 4, period: 'week'  },
    { icon: '🏢', name: 'ABKO',           unit: 'sessions', target: 5, period: 'week'  },
    { icon: '🚀', name: 'DTC business',   unit: 'sessions', target: 4, period: 'week'  }
  ],

  async load() {
    if (Score.loaded) return;
    const [m, l] = await Promise.all([DB.get(Score.K_MET, null), DB.get(Score.K_LOG, null)]);
    Score.metrics = Array.isArray(m) && m.length
      ? m.map(x => ({
          id: x.id || uid('m'),
          icon: x.icon || '⭐',
          name: String(x.name || 'Metric'),
          unit: String(x.unit || ''),
          target: Math.max(0, parseInt(x.target, 10) || 0),
          period: x.period === 'month' ? 'month' : 'week'
        }))
      : Score.DEFAULTS.map(x => Object.assign({ id: uid('m') }, x));
    Score.log = (l && typeof l === 'object' && !Array.isArray(l)) ? l : {};
    Score.loaded = true;
    /* The ledger keys every tap by metric id, so those ids have to be the same
       tomorrow as they are today. Left unsaved, the shipped defaults would be
       regenerated with fresh ids on the next load and every tap logged before
       the first edit would point at a metric that no longer exists. Write them
       down the first time we invent them. */
    if (!(Array.isArray(m) && m.length)) Score.saveMetrics();
  },

  saveMetrics() { DB.set(Score.K_MET, Score.metrics); },
  saveLog() {
    /* A ledger this app writes to for years would otherwise grow without
       bound. Five hundred days is more than a year of trend and still a
       few kilobytes. */
    const keys = Object.keys(Score.log).sort();
    if (keys.length > Score.KEEP_DAYS) {
      keys.slice(0, keys.length - Score.KEEP_DAYS).forEach(k => { delete Score.log[k]; });
    }
    DB.set(Score.K_LOG, Score.log);
  },

  /* ---- the maths, kept pure so it can be tested without a browser ---- */

  /** Every date in the period containing `ref`, as ISO strings. */
  periodDays(period, ref) {
    const d = ref ? new Date(ref.getTime()) : new Date();
    const out = [];
    if (period === 'month') {
      const y = d.getFullYear(), m = d.getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      for (let i = 1; i <= last; i++) out.push(isoDate(new Date(y, m, i)));
    } else {
      const s = startOfWeek(d, 1);                    /* weeks start Monday */
      for (let i = 0; i < 7; i++) out.push(isoDate(addDays(s, i)));
    }
    return out;
  },

  /** How many of `metricId` were logged across those days. */
  countOver(metricId, days) {
    let n = 0;
    for (const day of days) {
      const row = Score.log[day];
      if (row && row[metricId]) n += row[metricId];
    }
    return n;
  },

  count(m, ref) { return Score.countOver(m.id, Score.periodDays(m.period, ref)); },

  /** Consecutive completed periods that hit target, plus this one if it has. */
  streak(m) {
    if (!m.target) return 0;
    let n = 0;
    const step = (i) => {
      const d = new Date();
      if (m.period === 'month') d.setMonth(d.getMonth() - i);
      else d.setDate(d.getDate() - i * 7);
      return d;
    };
    for (let i = 0; i < 60; i++) {
      const hit = Score.countOver(m.id, Score.periodDays(m.period, step(i))) >= m.target;
      if (hit) n++;
      else if (i > 0) break;      /* an unfinished current period never breaks it */
    }
    return n;
  },

  bump(m, delta) {
    const day = today();
    if (!Score.log[day]) Score.log[day] = {};
    const next = Math.max(0, (Score.log[day][m.id] || 0) + delta);
    if (next) Score.log[day][m.id] = next;
    else delete Score.log[day][m.id];
    if (!Object.keys(Score.log[day]).length) delete Score.log[day];
    Score.saveLog();
    if (delta > 0) {
      /* Same activity log the rest of the app writes to, so a tap here shows
         up in the journal and in what the Direction engine reads. */
      try { const j = NorthStar.host('J'); if (typeof j === 'function') j('planning', '📊 ' + m.name + ' +1'); } catch (e) {}
    }
  },

  /** What the Direction engine reads: last 12 weeks, per metric. */
  summary() {
    return Score.metrics.map(m => {
      const now = Score.count(m);
      const prev = (() => {
        const d = new Date();
        if (m.period === 'month') d.setMonth(d.getMonth() - 1); else d.setDate(d.getDate() - 7);
        return Score.countOver(m.id, Score.periodDays(m.period, d));
      })();
      return { name: m.name, unit: m.unit, period: m.period, target: m.target,
               thisPeriod: now, lastPeriod: prev, streak: Score.streak(m) };
    });
  },

  /* ---------------------------- the card ---------------------------- */

  /* One tap-to-open section, like the Diet block on Today. Eight metrics is a
     lot of screen for something you glance at; the header and the bar under
     it carry the whole summary, so folded is a real answer and not a stub. */
  card() {
    const withTarget = Score.metrics.filter(m => m.target > 0);
    const hit = withTarget.filter(m => Score.count(m) >= m.target).length;
    const pct = withTarget.length ? Math.round((hit / withTarget.length) * 100) : 0;
    const rows = Score.metrics.map(m => Score.row(m)).join('');
    const summary = withTarget.length
      ? hit + ' of ' + withTarget.length + ' on target'
      : Score.metrics.length + ' tracked';

    return Fold.card('score',
      Fold.head('score', 'Scoreboard', summary, !hit) +
      Fold.bar(pct) +
      Fold.body(
        '<p class="flow-sub">One tap each time you do the thing. Weeks run Monday to Sunday. ' +
          'Tap the name to rename it or change the target.</p>' +
        '<div class="sc-list">' + rows + '</div>' +
        '<div class="flow-row ns-addrow">' +
          '<input class="flow-in grow" id="sc-new" placeholder="Track something else…" maxlength="60">' +
          '<button class="flow-btn primary sm" id="sc-add">Add</button>' +
        '</div>'));
  },

  row(m) {
    const days = Score.periodDays(m.period);
    const n = Score.countOver(m.id, days);
    const pct = m.target ? clamp(Math.round((n / m.target) * 100), 0, 100) : 0;
    const done = m.target && n >= m.target;
    const st = Score.streak(m);

    /* A week gets a bar per day; a month would be 31 slivers, so it gets the
       bar alone. */
    let strip = '';
    if (m.period === 'week') {
      const todayISO = today();
      strip = '<div class="sc-days">' + days.map((d, i) => {
        const c = (Score.log[d] || {})[m.id] || 0;
        return '<i class="sc-day' + (c ? ' on' : '') + (d === todayISO ? ' now' : '') + '"' +
               ' title="' + ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i] + ' — ' + c + '">' +
               (c > 1 ? c : '') + '</i>';
      }).join('') + '</div>';
    }

    const goal = m.target
      ? '<span class="sc-target">of ' + m.target + ' this ' + m.period + '</span>'
      : '<span class="sc-target">no target</span>';

    return '' +
      '<div class="sc-metric' + (done ? ' done' : '') + '" data-id="' + m.id + '">' +
        '<div class="sc-head">' +
          '<span class="sc-ic">' + esc(m.icon) + '</span>' +
          '<button class="sc-name" data-act="edit">' + esc(m.name) + '</button>' +
          (st > 1 ? '<span class="sc-streak" title="' + st + ' ' + m.period + 's in a row">🔥 ' + st + '</span>' : '') +
          '<span class="sc-count">' + n + '</span>' + goal +
        '</div>' +
        (m.target ? '<div class="sc-bar"><i style="width:' + pct + '%"></i></div>' : '') +
        /* Strip and buttons share a row: eight metrics on a phone is a long
           scroll already, and a row that only holds two buttons earns nothing. */
        '<div class="sc-foot">' +
          (strip || '<span class="sc-spacer"></span>') +
          '<button class="flow-btn tiny ghost" data-act="minus" aria-label="Undo one">−</button>' +
          '<button class="flow-btn tiny primary sc-plus" data-act="plus">+1' +
            (m.unit ? ' <span>' + esc(m.unit) + '</span>' : '') + '</button>' +
        '</div>' +
      '</div>';
  },

  wire(sec) {
    Score.sec = sec;

    $$('.sc-metric', sec).forEach(row => {
      const id = row.getAttribute('data-id');
      const m = Score.metrics.find(x => x.id === id);
      if (!m) return;
      const plus = row.querySelector('[data-act="plus"]');
      const minus = row.querySelector('[data-act="minus"]');
      /* NorthStar.paint() redraws the whole tab, and the card reads its own
         open state back out of storage — so a tap cannot close the list
         under your finger. */
      if (plus) plus.addEventListener('click', () => { Score.bump(m, +1); NorthStar.paint(); });
      if (minus) minus.addEventListener('click', () => { Score.bump(m, -1); NorthStar.paint(); });
      const name = row.querySelector('[data-act="edit"]');
      if (name) name.addEventListener('click', () => Score.editor(m));
    });
    const add = $('#sc-add', sec), inp = $('#sc-new', sec);
    const doAdd = () => {
      const v = (inp.value || '').trim(); if (!v) return;
      Score.metrics.push({ id: uid('m'), icon: '⭐', name: v, unit: '', target: 1, period: 'week' });
      Fold.setOpen('score', true);
      Score.saveMetrics(); NorthStar.paint();
    };
    if (add) add.addEventListener('click', doAdd);
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  },

  /** Rename, re-target, change cadence, or remove — in place, no dialogs. */
  editor(m) {
    const row = $('.sc-metric[data-id="' + m.id + '"]', Score.sec || document);
    if (!row) return;
    Fold.setOpen('score', true);
    row.innerHTML =
      '<div class="sc-edit">' +
        '<div class="flow-row">' +
          '<input class="flow-in sc-e-ic" id="sc-e-ic" value="' + esc(m.icon) + '" maxlength="4" aria-label="Icon">' +
          '<input class="flow-in grow" id="sc-e-name" value="' + esc(m.name) + '" maxlength="60" aria-label="Name">' +
        '</div>' +
        '<div class="flow-row">' +
          '<input class="flow-in sc-e-n" id="sc-e-target" type="number" min="0" max="999" value="' + m.target + '" aria-label="Target">' +
          '<select class="flow-in" id="sc-e-period" aria-label="Per">' +
            '<option value="week"' + (m.period === 'week' ? ' selected' : '') + '>per week</option>' +
            '<option value="month"' + (m.period === 'month' ? ' selected' : '') + '>per month</option>' +
          '</select>' +
          '<input class="flow-in grow" id="sc-e-unit" value="' + esc(m.unit) + '" maxlength="16" placeholder="unit (sets, sessions…)" aria-label="Unit">' +
        '</div>' +
        '<div class="flow-row">' +
          '<button class="flow-btn primary sm" id="sc-e-save">Save</button>' +
          '<button class="flow-btn ghost sm" id="sc-e-cancel">Cancel</button>' +
          '<button class="flow-btn ghost sm danger" id="sc-e-del">Remove</button>' +
        '</div>' +
      '</div>';
    $('#sc-e-name', row).focus();
    $('#sc-e-save', row).addEventListener('click', () => {
      const nm = ($('#sc-e-name', row).value || '').trim();
      if (nm) m.name = nm;
      m.icon = ($('#sc-e-ic', row).value || '⭐').trim() || '⭐';
      m.unit = ($('#sc-e-unit', row).value || '').trim();
      m.target = clamp(parseInt($('#sc-e-target', row).value, 10) || 0, 0, 999);
      m.period = $('#sc-e-period', row).value === 'month' ? 'month' : 'week';
      Score.saveMetrics(); NorthStar.paint();
    });
    $('#sc-e-cancel', row).addEventListener('click', () => NorthStar.paint());
    $('#sc-e-del', row).addEventListener('click', () => {
      Score.metrics = Score.metrics.filter(x => x.id !== m.id);
      Score.saveMetrics(); NorthStar.paint();
    });
  }
};

async function boot() {
  /* Before anything else: if the server has accounts installed and nobody is
     signed in, put the sign-in screen up. Everything below still runs, so the
     app is ready the moment the session exists. */
  /* An emailed reset link lands here before anything else. Nothing else in
     boot should run: they are not signed in, and the only thing on offer is
     the one field that gets them back. */
  try {
    const rt = new URLSearchParams(location.search).get('reset');
    if (rt) { Auth.resetScreen(rt); return; }
  } catch (e) {}

  try { await Auth.check(); } catch (e) {}

  /* Load the profile before anything renders, so the template swap happens
     once rather than as a visible flicker.

     Skipped entirely while the sign-in screen is up. Running it signed-out was
     a real bug: every read 401s, so it fell back to capturing the code's own
     constants and cached that to localStorage — and the freshly created
     account then found that cache and kept the previous owner's setup. */
  if (!(Auth.installed && !Auth.user)) {
    try { await Profile.load(); Profile.apply(); Profile.watch(); } catch (e) { console.warn('[Flow] profile', e); }
  }

  /* Seed DB from the payload hydrateFromDB already downloaded, using the
     same parse rules as DB.get, so the gets below are cache hits instead
     of one round-trip each.

     Waiting is the point. This used to read a variable that the host had not
     set yet — the seed was skipped without a word, and the loads below went
     and fetched eight sections one at a time, each its own trip to the server.
     The host publishes a promise now. The wait is capped, and an unreachable
     server settles it with null, so the worst case is the old behaviour rather
     than a screen that never arrives. */
  try {
    let seed = window.__FLOW_ALL;
    if (!seed && window.__FLOW_ALL_READY) {
      seed = await Promise.race([
        window.__FLOW_ALL_READY,
        new Promise(r => setTimeout(() => r(null), 3000))
      ]);
    }
    if (seed) Object.keys(seed).forEach((k) => {
      if (DB._mem.has(k)) return;
      let v = seed[k];
      if (typeof v === 'string') {
        const t = v.trim();
        if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
          try { v = JSON.parse(t); } catch (e) { /* not JSON — keep the string */ }
        }
      }
      DB._mem.set(k, v);
    });
  } catch (e) { console.warn('[Flow] seed', e); }

  try {
    await Settings.load();
    await Promise.all([Schedule.load(), Finance.load(), Notes.load(), Journal.load()]);
    Focus.load().then(() => { try { Focus.paintTile(); } catch (e) {} }).catch(() => {});
  } catch (e) { console.error('[Flow] load failed', e); }

  Tabs.init();
  Tabs.add('northstar', '⭐ North Star', (sec) => NorthStar.render(sec));
  Tabs.add('artur', '👤 Planner', (sec) => Planner.render(sec));
  Tabs.add('ask', '💬 Ask', (sec) => Ask.render(sec));
  Tabs.add('settings', '⚙️ Settings', (sec) => SettingsUI.render(sec));
  /* Settings and the account are both loaded by now, so the planner tab can
     take the signed-in person's name. */
  Planner.applyTabName();
  /* Prices and the shared-task inbox. Both are additive and both fail quietly:
     no server module, no strip, no inbox, and the rest of the app is unchanged. */
  /* Navigation first. It needs the pills, which exist by now, and nothing
     else — so it must not queue behind two network calls. */
  try { Nav.install(); } catch (e) { console.warn('[Flow] nav', e); }
  /* Not awaited: the photo arrives when it arrives, and nothing waits on it. */
  if (Auth.user && !Auth.user.guest) Connect.boot().catch(() => {});
  try { SetView.boot(); } catch (e) {}
  try { Typing.boot(); } catch (e) {}
  if (Auth.user && !Auth.user.guest) { try { Notify.boot(); } catch (e) { console.warn('[Flow] notify', e); } }
  try { Sections.apply(); } catch (e) { console.warn('[Flow] sections', e); }
  if (Auth.user && !Auth.user.guest) Sections.migrate().catch((e) => console.warn('[Flow] sections', e));
  if (Auth.user && !Auth.user.guest) { try { WeekPlan.boot(); } catch (e) { console.warn('[Flow] week', e); } }
  try { HealthMirror.boot(); } catch (e) { console.warn('[Flow] health mirror', e); }
  /* Reconcile the colour theme (account value wins over the device default the
     inline script already painted). Never blocks the veil below. */
  try { await Theme.init(); } catch (e) { console.warn('[Flow] theme', e); }
  try { await Lang.init(); } catch (e) { console.warn('[Flow] language', e); }
  /* The chrome exists — lift the boot veil. The host holds the page invisible
     until this class lands, so nobody ever sees the pre-pack layout flash by
     before the real navigation appears. (The host also lifts it on a timer,
     so a pack that dies before this line cannot leave the screen blank.) */
  try { document.documentElement.classList.add('flow-ready'); } catch (e) {}

  /* These paint into place when they arrive; nothing waits on them. */
  /* The audit is read at boot rather than when its tab is opened: its whole
     job is to appear on Today when it comes due, and it cannot do that from
     a tab nobody has visited since March. Two small reads. */
  Audit.load().then(() => { try { AuditNudge.apply(); } catch (e) {} }).catch(() => {});
  Inbox.load().then(() => { try { Inbox.paintToday(); } catch (e) {} }).catch(() => {});
  Markets.mount().catch(() => {});

  // time chips everywhere
  TimeChips.scan(document);
  TimeChips.watch();

  // finance panel into the app's own Finances tab
  const financeTab = $$('[data-tab]').find(p => /finance|money|💰/i.test(p.textContent));
  if (financeTab) {
    const sec = $('#tab-' + financeTab.getAttribute('data-tab'));
    if (sec) FinanceUI.mount(sec);
  }

  // the real journal, at the top of the app's own Journal tab
  const journalTab = $$('[data-tab]').find(p => /journal|günlük|📓/i.test(p.textContent));
  if (journalTab) {
    const sec = $('#tab-' + journalTab.getAttribute('data-tab'));
    if (sec) await Journal.mount(sec);
  }

  // notes drawer at the bottom of every existing tab — not under a retired
  // section nobody can open; the diet notebook goes with the diet block.
  Rollup.sections().forEach(sec => {
    const name = sec.id.slice(4);
    if (sec.hasAttribute('data-fn-retired')) {
      if (name === 'diet') { const host = document.getElementById('fn-dietblock'); if (host) Notes.mountInline(host, name, 'diet'); }
      return;
    }
    Notes.mountInline(sec, name, Rollup.labelFor(name).replace(/^[^\w]+/, '') || name);
  });

  // replace any broken/stretched breakdown widgets across the app
  Visuals.upgradeAll();

  Queue.flush();

  window.Flow = {
    SetView,
    version: window.__FLOW_UPGRADE__,
    DB, Settings, Schedule, Finance, Notes, Journal, Calendar, Reminders, ICS, GCAL, Chart, Visuals, Rollup, Tabs, TimeChips, Auth, Profile, Theme, Lang,
    Markets, Inbox, Ask, Planner, Nav, Sections, DataCard, Focus, MoodChart, NorthStar, Score, Direction, Fold, Friends, Audit, AuditMath,
    toast,
    refresh: () => { TimeChips.scan(document); TimeChips.repaintAll(); Visuals.upgradeAll(); Journal.rerender(); }
  };

  try { SleepChart.install(); } catch (e) { console.warn('[Flow] sleep chart', e); }
  try { MoodChart.install(); } catch (e) { console.warn('[Flow] mood chart', e); }
  try { TodayGroups.install(); } catch (e) { console.warn('[Flow] today groups', e); }
  try { CompassPlus.install(); } catch (e) { console.warn('[Flow] compass plus', e); }
  try { DietPlan.mount(); } catch (e) { console.warn('[Flow] diet plan', e); }
  try { SharedUI.install(); } catch (e) { console.warn('[Flow] shared', e); }

  console.log('%c The Flow · upgrade pack ' + window.__FLOW_UPGRADE__ + ' ready ',
    'background:#17bb92;color:#05231b;font-weight:700;border-radius:4px');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 300));
else setTimeout(boot, 300);

})();
