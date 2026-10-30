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
/* The device report in the shell asks this: did the pack at least run? */
try { window.__flowPackRan = true; } catch (e) {}

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
  /* narrowSymbol: ₺, $, £ — not "TRY 0.00", which is what most locales print
     for a currency that is not their own. */
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'TRY', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(v); }
  catch (e) { return v.toFixed(2) + ' ' + (cur || ''); }
}

/** Short form for tight spots — the middle of a ring, a stat tile. */
function moneyCompact(n, cur) {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: cur || 'TRY', currencyDisplay: 'narrowSymbol',
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
  /* The new look (Today, tab bar, + menu) is a preview you switch on; off
     is the design as it was before 25 October. */
  newLook: false,
  /* The assistant: premium voice (falls back to the device's), how it
     addresses you, whether it keeps listening, and its AI finish. */
  asstVoice: 'premium',
  asstCall: 'name',
  asstHands: true,
  asstSheen: true,
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
  workStart: '09:00',            // the working day, for My day changed
  workEnd: '18:00',
  bufferMin: 10,                 // room between two Big Rocks
  mealKcal: 0,                   // Meals on Today: a daily target, 0 = totals only
  mealProtein: 0,
  eveningCheck: false,           // one notification in the evening: how did today go?
  eveningCheckAt: '21:00',
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
    /* Simple or Advanced, as last chosen on any device. */
    each(() => TodayLook.applyLook());
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

  /* Every expense, from both forms — see Ledger. */
  inMonth(ym) { return Ledger.all().filter(x => String(x.date).slice(0, 7) === ym); },

  byCategory(items) {
    const m = {};
    const home = Ledger.home();
    items.forEach(x => { if (String(x.currency || home).toUpperCase() !== home) return; const c = x.category || 'Other'; m[c] = (m[c] || 0) + Math.abs(Number(x.amount) || 0); });
    return Object.keys(m).map(k => ({ label: k, value: m[k] })).sort((a, b) => b.value - a.value);
  },

  byMonth(n) {
    const out = [], now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const total = Ledger.sum(Finance.inMonth(ym)).total;
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
    /* De-duplicated against both stores, so a statement line already typed
       into the first form is not imported a second time. */
    (typeof Ledger !== 'undefined' ? Ledger.all() : Finance.items).forEach(x => { seen[`${x.date}|${Math.abs(x.amount).toFixed(2)}|${norm(x.merchant).toLowerCase().slice(0, 24)}`] = 1; });
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

/* ── Bank statements ──────────────────────────────────────────────────────
 * A statement from the bank — PDF, Excel or CSV — read by the server into
 * transactions, turned into a report here, and kept as lines (never as the
 * file). Spending is only added to the ledger when you say so, and the same
 * de-duplication as every other import applies, so a month uploaded twice,
 * or a coffee you already typed in, is not counted again.
 *
 * Reports live under one key each (flow:statement:<id>) with a small index
 * (flow:statements) so the Finances tab can list them without loading every
 * line of every month.
 * ====================================================================== */
const Statement = {
  INDEX: 'flow:statements',
  MAX: 12,
  POLL_MS: 2500,
  GIVE_UP_MS: 6 * 60 * 1000,

  async list() { const l = await DB.get(Statement.INDEX, []); return Array.isArray(l) ? l : []; },
  async get(id) { return DB.get('flow:statement:' + id, null); },

  /* Money out and in, in the statement's own currency; rows in another
     currency are counted separately rather than added to the wrong total. */
  summarise(r) {
    const cur = r.currency || Ledger.home();
    const same = (r.tx || []).filter(t => (t.currency || cur) === cur);
    const other = (r.tx || []).length - same.length;
    const spendRows = same.filter(t => t.amount < 0 && (t.kind === 'spend' || t.kind === 'fee'));
    const out = spendRows.reduce((a, t) => a - t.amount, 0);
    const inc = same.filter(t => t.amount > 0 && (t.kind === 'income' || t.kind === 'refund')).reduce((a, t) => a + t.amount, 0);
    const fees = same.filter(t => t.kind === 'fee').reduce((a, t) => a + Math.abs(t.amount), 0);
    const byCat = {}, byMerch = {};
    spendRows.forEach(t => {
      byCat[t.category || 'Other'] = (byCat[t.category || 'Other'] || 0) - t.amount;
      const k = norm(t.merchant).toLowerCase();
      const m = byMerch[k] || (byMerch[k] = { name: t.merchant, total: 0, n: 0, amounts: [] });
      m.total -= t.amount; m.n++; m.amounts.push(-t.amount);
    });
    const cats = Object.keys(byCat).map(k => ({ label: k, value: Math.round(byCat[k] * 100) / 100 })).sort((a, b) => b.value - a.value);
    const merchants = Object.values(byMerch).sort((a, b) => b.total - a.total);
    /* Recurring: the same merchant more than once at much the same price,
       or anything filed as a subscription. */
    const recurring = merchants.filter(m => {
      if (m.n >= 2) { const lo = Math.min.apply(null, m.amounts), hi = Math.max.apply(null, m.amounts); return hi <= lo * 1.15 + 1; }
      return false;
    }).concat(spendRows.filter(t => t.category === 'Subscriptions' && !(byMerch[norm(t.merchant).toLowerCase()].n >= 2))
      .map(t => ({ name: t.merchant, total: -t.amount, n: 1, amounts: [-t.amount] })))
      .slice(0, 8);
    const biggest = spendRows.slice().sort((a, b) => a.amount - b.amount).slice(0, 5);
    return { cur, out, inc, fees, cats, merchants: merchants.slice(0, 6), recurring, biggest, other, spendCount: spendRows.length };
  },

  /* What would go into the ledger: spending and fees, money out only. */
  expenses(r) {
    const label = r.bank ? r.bank + ' statement' : 'Bank statement';
    return (r.tx || []).filter(t => t.amount < 0 && (t.kind === 'spend' || t.kind === 'fee')).map(t => ({
      date: t.date, amount: Math.abs(t.amount), merchant: t.merchant, currency: t.currency || r.currency || Ledger.home(),
      category: t.category || 'Other', note: 'From ' + label, source: 'statement'
    }));
  },

  /* The same key importItems uses, so the preview and the import agree. */
  dupeCount(items) {
    const key = (x) => `${x.date}|${Math.abs(x.amount).toFixed(2)}|${norm(x.merchant).toLowerCase().slice(0, 24)}`;
    const seen = {};
    Ledger.all().forEach(x => { seen[key(x)] = 1; });
    return items.filter(x => seen[key(x)]).length;
  },

  async save(r) {
    const id = uid('st');
    const full = {
      id, at: new Date().toISOString(), bank: r.bank || '', account: r.account || '', currency: r.currency || Ledger.home(),
      from: r.from || null, to: r.to || null, opening: r.opening, closing: r.closing,
      partial: !!r.partial, tx: r.tx || [], imported: null
    };
    const s = Statement.summarise(full);
    await DB.set('flow:statement:' + id, full);
    const list = await Statement.list();
    list.unshift({ id, at: full.at, bank: full.bank, account: full.account, currency: full.currency, from: full.from, to: full.to,
      out: Math.round(s.out * 100) / 100, inc: Math.round(s.inc * 100) / 100, n: full.tx.length, imported: null });
    const drop = list.splice(Statement.MAX);
    for (const d of drop) { try { await DB.set('flow:statement:' + d.id, null); } catch (e) {} }
    await DB.set(Statement.INDEX, list);
    return full;
  },

  async markImported(id, added) {
    const full = await Statement.get(id);
    const at = new Date().toISOString();
    if (full) { full.imported = { at, added }; await DB.set('flow:statement:' + id, full); }
    const list = await Statement.list();
    const row = list.find(x => x.id === id);
    if (row) { row.imported = { at, added }; await DB.set(Statement.INDEX, list); }
  },

  async remove(id) {
    await DB.set('flow:statement:' + id, null);
    await DB.set(Statement.INDEX, (await Statement.list()).filter(x => x.id !== id));
  },

  period(r) {
    if (!r.from && !r.to) return '';
    const f = r.from ? parseISO(r.from) : null, t = r.to ? parseISO(r.to) : null;
    const d = (x, y) => x.getDate() + ' ' + MON[x.getMonth()] + (y ? ' ' + x.getFullYear() : '');
    if (f && t) return f.getFullYear() === t.getFullYear() ? d(f) + ' – ' + d(t, true) : d(f, true) + ' – ' + d(t, true);
    return d(f || t, true);
  },

  /* Send the file and wait for the reading. onTick gets seconds elapsed. */
  async read(file, onTick) {
    const buf = await file.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const r = await fetch('/api/flow/statement', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name || '', data: btoa(bin), categories: Settings.get('categories') })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.job) { const e = new Error(j.error || ('The statement could not be sent (' + r.status + ').')); e.status = r.status; throw e; }
    const t0 = Date.now();
    for (;;) {
      await new Promise(res => setTimeout(res, Statement.POLL_MS));
      if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
      let s = null;
      try {
        const g = await fetch('/api/flow/statement?job=' + encodeURIComponent(j.job), { credentials: 'same-origin' });
        s = await g.json().catch(() => null);
        if (g.status === 404) throw new Error((s && s.error) || 'That reading has expired. Upload the statement again.');
      } catch (e) { if (/expired/.test(e.message)) throw e; /* a dropped poll — try again */ }
      if (s && s.status === 'done') return s;
      if (s && s.status === 'error') throw new Error(s.error || 'The statement could not be read.');
      if (Date.now() - t0 > Statement.GIVE_UP_MS) throw new Error('Reading that statement is taking too long. Try a shorter period.');
    }
  }
};
window.FlowStatement = Statement;

/* ── Spending habits ──────────────────────────────────────────────────────
 * Every statement you have uploaded, read together: how the months compare,
 * which categories are growing, where the money goes, which weekdays cost
 * most, what repeats every month, what the small things add up to, and what
 * went out as card payments, transfers and fees.
 *
 * Worked out here, from lines already in the account — nothing is sent
 * anywhere and it costs nothing to look at. Only statement lines count:
 * a receipt typed in by hand is a different kind of record and mixing the
 * two would double-count the months a statement also covers.
 *
 * Overlapping statements (October uploaded twice, or a card statement that
 * runs 15th to 15th) are de-duplicated line by line: the same date, amount
 * and description counts as many times as it appears in any ONE statement,
 * never the sum across them.
 * ====================================================================== */
const Habits = {
  async load() {
    const list = await Statement.list();
    const out = [];
    for (const x of list) { const f = await Statement.get(x.id); if (f && Array.isArray(f.tx)) out.push(f); }
    return out;
  },

  merge(statements) {
    const best = {};
    statements.forEach((st) => {
      const cnt = {};
      (st.tx || []).forEach((t) => {
        const k = t.date + '|' + Number(t.amount).toFixed(2) + '|' + norm(t.merchant).toLowerCase().slice(0, 24) + '|' + (t.currency || st.currency || '');
        (cnt[k] = cnt[k] || []).push(Object.assign({ currency: st.currency }, t));
      });
      Object.keys(cnt).forEach((k) => { if (!best[k] || cnt[k].length > best[k].length) best[k] = cnt[k]; });
    });
    const all = [];
    Object.values(best).forEach((rows) => rows.forEach((r) => all.push(r)));
    return all.sort((a, b) => a.date.localeCompare(b.date));
  },

  /* Days of each month that some statement actually covers. */
  coverage(statements) {
    const days = {};
    statements.forEach((st) => {
      const dates = (st.tx || []).map((t) => t.date).sort();
      const from = st.from || dates[0], to = st.to || dates[dates.length - 1];
      if (!from || !to) return;
      const d = parseISO(from), end = parseISO(to);
      for (let i = 0; i < 400 && d <= end; i++, d.setDate(d.getDate() + 1)) days[Habits.iso(d)] = 1;
    });
    const per = {};
    Object.keys(days).forEach((k) => { const m = k.slice(0, 7); per[m] = (per[m] || 0) + 1; });
    return per;
  },
  iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
  monthLen(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); },
  monthName(ym, long) { const [y, m] = ym.split('-').map(Number); return MON[m - 1] + (long ? ' ' + y : ''); },
  key(t) { return norm(t.merchant).toLowerCase().replace(/\s+\d+\/\d+$/, '').slice(0, 40); },

  analyse(statements, home) {
    home = home || 'TRY';
    const all = Habits.merge(statements);
    const mine = all.filter((t) => (t.currency || home) === home);
    const other = all.length - mine.length;
    const spend = mine.filter((t) => t.amount < 0 && (t.kind === 'spend' || t.kind === 'fee'));
    if (!spend.length) return { empty: true, statements: statements.length, other };

    const cov = Habits.coverage(statements);
    const months = Object.keys(cov).sort();
    const full = months.filter((m) => cov[m] >= Habits.monthLen(m) - 3);
    const byMonth = {};
    months.forEach((m) => { byMonth[m] = { m, spend: 0, income: 0, fees: 0, cardPay: 0, transfersOut: 0, n: 0, full: full.indexOf(m) >= 0, days: cov[m] }; });
    const bucket = (t) => byMonth[t.date.slice(0, 7)] || (byMonth[t.date.slice(0, 7)] = { m: t.date.slice(0, 7), spend: 0, income: 0, fees: 0, cardPay: 0, transfersOut: 0, n: 0, full: false, days: 0 });
    mine.forEach((t) => {
      const b = bucket(t);
      if (t.amount < 0 && (t.kind === 'spend' || t.kind === 'fee')) { b.spend -= t.amount; b.n++; if (t.kind === 'fee') b.fees -= t.amount; }
      else if (t.amount > 0 && (t.kind === 'income' || t.kind === 'refund')) b.income += t.amount;
      else if (t.kind === 'card-payment') b.cardPay += Math.abs(t.amount);
      else if (t.kind === 'transfer' && t.amount < 0) b.transfersOut -= t.amount;
    });
    const series = Object.values(byMonth).sort((a, b) => a.m.localeCompare(b.m));
    const fullRows = series.filter((r) => r.full);
    const avgMonth = fullRows.length ? fullRows.reduce((a, r) => a + r.spend, 0) / fullRows.length : null;
    const totalSpend = spend.reduce((a, t) => a - t.amount, 0);
    const coveredDays = Object.values(cov).reduce((a, n) => a + n, 0) || 1;
    const perDay = totalSpend / coveredDays;
    const last = fullRows[fullRows.length - 1] || null, prev = fullRows[fullRows.length - 2] || null;

    /* Categories: the latest full month against the average of the ones before it. */
    const catMonth = {};
    spend.forEach((t) => { const m = t.date.slice(0, 7), c = t.category || 'Other'; (catMonth[c] = catMonth[c] || {})[m] = (catMonth[c][m] || 0) - t.amount; });
    const catTotals = Object.keys(catMonth).map((c) => ({ label: c, value: Object.values(catMonth[c]).reduce((a, v) => a + v, 0) })).sort((a, b) => b.value - a.value);
    const movers = [];
    if (last && fullRows.length >= 2) {
      const before = fullRows.slice(0, -1);
      Object.keys(catMonth).forEach((c) => {
        const now = catMonth[c][last.m] || 0;
        const was = before.reduce((a, r) => a + (catMonth[c][r.m] || 0), 0) / before.length;
        const diff = now - was;
        if (Math.abs(diff) >= Math.max(avgMonth * 0.03, 1) && (was === 0 || Math.abs(diff) / was >= 0.15)) movers.push({ cat: c, now, was, diff });
      });
      movers.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    }

    /* Merchants. */
    const merch = {};
    spend.forEach((t) => {
      const k = Habits.key(t);
      const m = merch[k] || (merch[k] = { name: t.merchant.replace(/\s+\d+\/\d+$/, ''), total: 0, n: 0, months: {}, amounts: [], cat: t.category, last: t.date });
      m.total -= t.amount; m.n++; m.months[t.date.slice(0, 7)] = (m.months[t.date.slice(0, 7)] || 0) - t.amount; m.amounts.push(-t.amount);
      if (t.date > m.last) m.last = t.date;
    });
    const merchants = Object.values(merch).sort((a, b) => b.total - a.total);

    /* Recurring: in two or more different months at much the same price. */
    /* "Not seen lately" is judged against the newest month a statement covers
       well — a half month at the end must not make everything look stopped. */
    const wellCovered = series.filter((r) => r.days >= 20);
    const refMonth = wellCovered.length ? wellCovered[wellCovered.length - 1].m : null;
    /* Bills and subscriptions, not habits: at most about twice a month. The
       weekly shop and the daily coffee repeat too, but they belong under
       where the money goes, not in a list of things to cancel. */
    const recurring = merchants.filter((m) => {
      const ms = Object.keys(m.months);
      if (ms.length < 2 || m.n / ms.length > 2) return false;
      const per = ms.map((k) => m.months[k]);
      const lo = Math.min.apply(null, per), hi = Math.max.apply(null, per);
      return hi <= lo * 1.25 + 1;
    }).map((m) => {
      const ms = Object.keys(m.months).sort();
      const monthly = ms.reduce((a, k) => a + m.months[k], 0) / ms.length;
      return { name: m.name, monthly, yearly: monthly * 12, months: ms.length, cat: m.cat, stopped: !!(refMonth && ms[ms.length - 1] < refMonth) };
    }).sort((a, b) => b.monthly - a.monthly);
    const recurringMonthly = recurring.filter((r) => !r.stopped).reduce((a, r) => a + r.monthly, 0);

    /* Weekdays: average spend on each weekday that was covered. */
    /* Everyday spending only: rent, bills and the few biggest charges land on
       whatever weekday the 1st happens to be, and would decide the answer. */
    const amts = spend.map((t) => -t.amount).sort((a, b) => a - b);
    const med = amts[Math.floor(amts.length / 2)] || 0;
    const everyday = spend.filter((t) => t.category !== 'Rent & Bills' && -t.amount <= Math.max(med * 10, 1));
    const everydayTotal = everyday.reduce((a, t) => a - t.amount, 0);
    const wdSum = [0, 0, 0, 0, 0, 0, 0], wdDays = [0, 0, 0, 0, 0, 0, 0];
    everyday.forEach((t) => { wdSum[parseISO(t.date).getDay()] -= t.amount; });
    const covDays = {};
    statements.forEach((st) => {
      const dates = (st.tx || []).map((t) => t.date).sort();
      const from = st.from || dates[0], to = st.to || dates[dates.length - 1];
      if (!from || !to) return;
      const d = parseISO(from), end = parseISO(to);
      for (let i = 0; i < 400 && d <= end; i++, d.setDate(d.getDate() + 1)) covDays[Habits.iso(d)] = d.getDay();
    });
    Object.values(covDays).forEach((w) => { wdDays[w]++; });
    const weekdays = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ label: DOW[w], value: wdDays[w] ? wdSum[w] / wdDays[w] : 0 }));
    const wkend = (wdSum[0] + wdSum[6]), wkendShare = everydayTotal ? wkend / everydayTotal : 0;
    const wkendDays = wdDays[0] + wdDays[6], wkDays = coveredDays - wkendDays;
    const wkendPerDay = wkendDays ? wkend / wkendDays : 0, wkPerDay = wkDays ? (everydayTotal - wkend) / wkDays : 0;

    /* Small purchases: at or under a quarter of the typical transaction. */
    const sorted = spend.map((t) => -t.amount).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const smallCap = Math.max(1, Math.round(median));
    const small = spend.filter((t) => -t.amount <= smallCap && t.kind === 'spend' && t.category !== 'Subscriptions' && t.category !== 'Rent & Bills');
    const smallTotal = small.reduce((a, t) => a - t.amount, 0);
    const smallMerch = {};
    small.forEach((t) => { const k = Habits.key(t); const m = smallMerch[k] || (smallMerch[k] = { name: t.merchant, total: 0, n: 0 }); m.total -= t.amount; m.n++; });
    const smallTop = Object.values(smallMerch).sort((a, b) => b.total - a.total).slice(0, 4);

    /* Big one-offs: the largest purchases from somewhere seen in one month
       only — not rent, not the weekly shop, not a fee. */
    const oneOffs = spend.filter((t) => t.kind === 'spend' && Object.keys((merch[Habits.key(t)] || { months: {} }).months).length === 1)
      .sort((a, b) => a.amount - b.amount).slice(0, 5);

    const fees = series.reduce((a, r) => a + r.fees, 0);
    const cardPay = series.reduce((a, r) => a + r.cardPay, 0);
    const transfersOut = series.reduce((a, r) => a + r.transfersOut, 0);
    const income = series.reduce((a, r) => a + r.income, 0);

    return {
      empty: false, home, statements: statements.length, other, lines: all.length,
      from: all[0].date, to: all[all.length - 1].date, coveredDays,
      series, fullCount: fullRows.length, avgMonth, perDay, totalSpend, income,
      last, prev, change: last && prev ? last.spend - prev.spend : null,
      catTotals, movers: movers.slice(0, 5), merchants: merchants.slice(0, 8),
      recurring, recurringMonthly,
      weekdays, wkendShare, wkendPerDay, wkPerDay,
      small: { cap: smallCap, n: small.length, total: smallTotal, perMonth: smallTotal / Math.max(1, coveredDays / 30.4), top: smallTop },
      oneOffs, fees, cardPay, transfersOut
    };
  },

  html(a) {
    if (!a) return '<p class="flow-empty">Working it out…</p>';
    if (a.empty) return `<p class="flow-empty">${a.statements ? 'The statements you uploaded have no spending in ' + esc(Ledger.home()) + ' yet.' : 'Upload a bank statement above and your spending habits appear here. Two or more months show how they change.'}</p>`;
    const m = (v) => money(v, a.home);
    const mm = (v) => moneyCompact(v, a.home);
    const signed = (v) => (v >= 0 ? '+' : '−') + m(Math.abs(v));
    const pct = (v) => (v > 0 && v < 0.01 ? (v * 100).toFixed(1) : String(Math.round(v * 100))) + '%';
    const maxMonth = Math.max.apply(null, a.series.map((r) => r.spend)) || 1;
    const maxWd = Math.max.apply(null, a.weekdays.map((w) => w.value)) || 1;
    const topWd = a.weekdays.slice().sort((x, y) => y.value - x.value)[0];
    const list = (rows, f) => rows.length ? '<ol class="fx-rlist">' + rows.map(f).join('') + '</ol>' : '<p class="flow-empty">Nothing yet.</p>';
    const span = Statement.period({ from: a.from, to: a.to });
    const wkMore = a.wkPerDay ? a.wkendPerDay / a.wkPerDay - 1 : 0;

    return `
      <p class="flow-sub" style="margin-top:0">${a.statements} statement${a.statements === 1 ? '' : 's'} · ${esc(span)} · ${a.lines} lines${a.other ? ` · ${a.other} in other currencies left out` : ''}</p>
      <div class="fx-tiles">
        <div class="fx-tile"><span>${a.avgMonth != null ? 'Average month' : 'Spent'}</span><b>${esc(m(a.avgMonth != null ? a.avgMonth : a.totalSpend))}</b></div>
        <div class="fx-tile"><span>Per day</span><b>${esc(m(a.perDay))}</b></div>
        ${a.change != null ? `<div class="fx-tile"><span>${esc(Habits.monthName(a.last.m))} vs ${esc(Habits.monthName(a.prev.m))}</span><b class="${a.change > 0 ? 'fx-neg' : 'fx-pos'}">${esc(signed(a.change))}</b></div>` : ''}
        <div class="fx-tile"><span>Repeats monthly</span><b>${esc(m(a.recurringMonthly))}</b></div>
      </div>

      <div class="hb-grid">
        <section>
          <div class="flow-label">Month by month</div>
          <div class="hb-months">${a.series.map((r) => `<div class="hb-mo${r.full ? '' : ' hb-part'}" title="${esc(Habits.monthName(r.m, true) + ': ' + m(r.spend) + (r.full ? '' : ' (part of the month)'))}">
              <b>${esc(mm(r.spend))}</b><i style="height:${Math.max(4, Math.round(r.spend / maxMonth * 100))}%"></i><span>${esc(Habits.monthName(r.m))}</span></div>`).join('')}</div>
          ${a.series.some((r) => !r.full) ? '<p class="hb-note">Paler months are only partly covered by a statement.</p>' : ''}
          ${a.fullCount < 2 ? '<p class="hb-note">Upload another month to see what is changing.</p>' : ''}
        </section>

        <section>
          <div class="flow-label">${a.movers.length ? 'What changed in ' + esc(Habits.monthName(a.last.m)) : 'Where it goes'}</div>
          ${a.movers.length
            ? list(a.movers, (x) => `<li><span>${esc(x.cat)} <small>usually ${esc(m(x.was))}</small></span><b class="${x.diff > 0 ? 'fx-neg' : 'fx-pos'}">${esc(signed(x.diff))}</b></li>`)
            : list(a.catTotals.slice(0, 6), (c) => `<li><span>${esc(c.label)}</span><b>${esc(m(c.value))} <small>${pct(c.value / a.totalSpend)}</small></b></li>`)}
        </section>

        <section>
          <div class="flow-label">Recurring payments</div>
          ${list(a.recurring.slice(0, 8), (r) => `<li><span>${esc(r.name)} <small>${r.months} months${r.stopped ? ' · not seen lately' : ''}</small></span><b>${esc(m(r.monthly))}<small>/mo</small></b></li>`)}
          ${a.recurring.length ? `<p class="hb-note">About ${esc(m(a.recurringMonthly * 12))} a year if they all carry on.</p>` : '<p class="hb-note">Needs two or more months to spot.</p>'}
        </section>

        <section>
          <div class="flow-label">Where the money goes most</div>
          ${list(a.merchants.slice(0, 6), (x) => `<li><span>${esc(x.name)} <small>×${x.n}</small></span><b>${esc(m(x.total))}</b></li>`)}
        </section>

        <section>
          <div class="flow-label">Everyday spending by day</div>
          <div class="hb-wd">${a.weekdays.map((w) => `<div><i style="height:${Math.max(3, Math.round(w.value / maxWd * 100))}%" class="${w === topWd ? 'hb-top' : ''}"></i><span>${esc(w.label.slice(0, 2))}</span></div>`).join('')}</div>
          <p class="hb-note">${esc(topWd.label)} is your most expensive day (${esc(m(topWd.value))} on average, leaving out rent, bills and the biggest charges). Weekends are ${pct(a.wkendShare)} of it${a.wkPerDay ? ` — ${wkMore >= 0 ? pct(wkMore) + ' more' : pct(-wkMore) + ' less'} per day than weekdays` : ''}.</p>
        </section>

        <section>
          <div class="flow-label">Small purchases</div>
          <p class="hb-big">${esc(m(a.small.perMonth))}<small> a month</small></p>
          <p class="hb-note">${a.small.n} purchases of ${esc(m(a.small.cap))} or less, ${esc(m(a.small.total))} in all.</p>
          ${list(a.small.top, (x) => `<li><span>${esc(x.name)} <small>×${x.n}</small></span><b>${esc(m(x.total))}</b></li>`)}
        </section>

        <section>
          <div class="flow-label">Payments, transfers &amp; fees</div>
          <ol class="fx-rlist">
            <li><span>Paid off cards</span><b>${esc(m(a.cardPay))}</b></li>
            <li><span>Transfers out</span><b>${esc(m(a.transfersOut))}</b></li>
            <li><span>Fees &amp; interest</span><b class="${a.fees ? 'fx-neg' : ''}">${esc(m(a.fees))}</b></li>
            <li><span>Money in</span><b>${esc(m(a.income))}</b></li>
          </ol>
          ${a.fees ? `<p class="hb-note">Fees and interest were ${pct(a.fees / a.totalSpend)} of what you spent.</p>` : ''}
        </section>

        <section>
          <div class="flow-label">Biggest one-offs</div>
          ${list(a.oneOffs, (t) => `<li><span>${esc(t.merchant)} <small>${esc(prettyDate(t.date))}</small></span><b>${esc(m(-t.amount))}</b></li>`)}
        </section>
      </div>`;
  },

  async paint(wrap) {
    const box = wrap.querySelector('#fx-habits');
    if (!box) return;
    let a = null;
    try { a = Habits.analyse(await Habits.load(), Ledger.home()); } catch (e) { console.warn('[Flow] habits', e); a = { empty: true, statements: 0 }; }
    Habits.last = a;
    box.innerHTML = Habits.html(a);
  }
};
window.FlowHabits = Habits;
/* Opening Finances shows the habits as they are now — statements uploaded on
   another device included — not as they were when the tab was first drawn. */
Habits.boot = function () {
  if (Habits._booted || typeof Nav === 'undefined' || typeof Nav.go !== 'function') return;
  Habits._booted = true;
  const orig = Nav.go;
  Nav.go = function (t) {
    const r = orig.apply(this, arguments);
    if (/financ/i.test(String(t))) setTimeout(() => {
      const w = document.querySelector('[data-flow-finance]');
      if (w) { try { FinanceUI.paintPast(w); } catch (e) {} Habits.paint(w); }
    }, 60);
    return r;
  };
};

/* ── Hide the numbers ─────────────────────────────────────────────────────
 * One button on Finances blurs every figure on that screen — amounts,
 * counts, percentages, the budget, the statement reports, the habits — and
 * the Spend tile on Today, so the app can be shown on a projector or across
 * a table without showing what anyone spends. Labels and dates stay
 * readable, so it still makes sense while hidden.
 *
 * It is a choice for THIS device (a laptop on a projector), not the account,
 * and it stays on until it is turned off. Screens repaint all the time, so
 * a watcher tags figures as they appear rather than relying on class names.
 * ====================================================================== */
const MoneyMask = {
  KEY: 'flow:hideMoney',
  DIGIT: /\d/,
  /* Text that is only a date or a month keeps its digits visible. */
  DATEISH: /^\s*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?(?:\s+\d{1,2})?(?:,?\s+\d{4})?\s*(?:[–—-]\s*(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)?[a-z]*\.?(?:\s+\d{1,2})?(?:,?\s+\d{4})?)?\s*(?:·\s*today)?\s*$|^\s*\d{4}-\d{2}(?:-\d{2})?\s*$|^\s*\d{1,2}[./]\d{1,2}[./]\d{2,4}\s*$/i,
  on: false,

  scopes() {
    return [document.getElementById('tab-finance'), document.querySelector('.flow-td-pulse [data-jump="spend"]')].filter(Boolean);
  },

  tag(root) {
    if (!root) return;
    root.querySelectorAll('[data-flm]').forEach((el) => { if (!MoneyMask.hides(el.textContent)) el.removeAttribute('data-flm'); });
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const t = n.nodeValue;
      if (!t || !MoneyMask.DIGIT.test(t) || !MoneyMask.hides(t)) continue;
      const el = n.parentElement;
      if (!el || el.closest('#fl-mask-btn, option, script, style')) continue;
      if (!el.hasAttribute('data-flm')) el.setAttribute('data-flm', '');
    }
    root.querySelectorAll('input[type="number"], input[inputmode="decimal"]').forEach((i) => i.setAttribute('data-flm', ''));
  },
  hides(t) { return MoneyMask.DIGIT.test(t || '') && !MoneyMask.DATEISH.test(t); },

  tagAll() { MoneyMask.scopes().forEach((r) => MoneyMask.tag(r)); },

  set(on) {
    MoneyMask.on = !!on;
    try { localStorage.setItem(MoneyMask.KEY, on ? '1' : '0'); } catch (e) {}
    if (on) MoneyMask.tagAll();
    document.documentElement.classList.toggle('fl-hide-money', MoneyMask.on);
    MoneyMask.paintBtn();
  },

  paintBtn() {
    const b = document.getElementById('fl-mask-btn');
    if (!b) return;
    b.setAttribute('aria-pressed', MoneyMask.on ? 'true' : 'false');
    b.innerHTML = (MoneyMask.on
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.4 10.4 0 0112 5c5 0 9 4.5 10 7a13.6 13.6 0 01-3.2 4.3M6.2 6.2C3.9 7.6 2.5 9.8 2 12c1 2.5 5 7 10 7a10 10 0 004.4-1"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"/><circle cx="12" cy="12" r="3"/></svg>') +
      '<span>' + (MoneyMask.on ? 'Show numbers' : 'Hide numbers') + '</span>';
    b.title = MoneyMask.on ? 'Show the numbers again' : 'Hide every number on this screen, for showing it to someone';
  },

  mountBtn() {
    const head = document.querySelector('#tab-finance > .section-header');
    if (!head || document.getElementById('fl-mask-btn')) return;
    head.classList.add('fl-mask-head');
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'fl-mask-btn'; b.className = 'fl-mask-btn';
    b.addEventListener('click', () => MoneyMask.set(!MoneyMask.on));
    head.appendChild(b);
    MoneyMask.paintBtn();
  },

  boot() {
    let saved = false;
    try { saved = localStorage.getItem(MoneyMask.KEY) === '1'; } catch (e) {}
    MoneyMask.mountBtn();
    /* Retag as screens repaint. Cheap when hidden is off: nothing to do. */
    let queued = false;
    const obs = new MutationObserver(() => {
      if (!MoneyMask.on || queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; MoneyMask.tagAll(); });
    });
    const watch = () => MoneyMask.scopes().forEach((r) => { if (!r.__flmWatched) { r.__flmWatched = true; obs.observe(r, { childList: true, subtree: true, characterData: true }); } });
    watch();
    /* The Spend tile is rebuilt with Today; keep watching whatever is current. */
    const today = document.getElementById('tab-today');
    if (today) new MutationObserver(() => { watch(); if (MoneyMask.on) MoneyMask.tagAll(); }).observe(today, { childList: true, subtree: true });
    MoneyMask.set(saved);
  }
};
window.FlowMoneyMask = MoneyMask;

/* ── One ledger ───────────────────────────────────────────────────────────
 * There were two expense stores. The first Finances form (budget, the Spend
 * tile on Today) writes `ld_finance` — amounts per month, a category id, no
 * currency. The receipt reader, statement import and "Add an expense by
 * hand" write `flow:expenses`. Each screen read only one of them, so an
 * expense showed in one place and not the other.
 *
 * Nothing is moved or deleted. Every reader now goes through here and sees
 * both, as one list: records from the first form appear with id "ld:…" and
 * `legacy: true`. New expenses from either form are written to
 * `flow:expenses` only, so the old store stops growing; what is already in it
 * keeps counting. Deleting a row deletes it from whichever store holds it.
 *
 * Currency: the first form never stored one (its "£" was template text), so
 * its rows are in the currency chosen in Preferences, as is the display
 * everywhere. A row stored in another currency is never added into a total
 * as if it were the same money — totals report it separately. */
const LEGACY_CAT = { food: 'Groceries', eating_out: 'Dining', transport: 'Transport', gym: 'Fitness',
  subscriptions: 'Subscriptions', shopping: 'Shopping', entertainment: 'Entertainment', other: 'Other' };
const CAT_TO_BUDGET = { Groceries: 'food', Dining: 'eating_out', Transport: 'transport', Fuel: 'transport',
  Health: 'gym', Fitness: 'gym', Supplements: 'gym', Subscriptions: 'subscriptions', Shopping: 'shopping',
  Entertainment: 'entertainment', Music: 'entertainment' };
const Ledger = {
  host(name) { try { return eval(name); } catch (e) { return undefined; } },
  home() { return String(Settings.get('currency') || 'TRY').toUpperCase(); },
  money(n, cur) { return money(n, cur || Ledger.home()); },
  symbol() {
    try { const p = new Intl.NumberFormat(undefined, { style: 'currency', currency: Ledger.home(), currencyDisplay: 'narrowSymbol' }).formatToParts(0); const c = p.find((x) => x.type === 'currency'); return c ? c.value : Ledger.home(); }
    catch (e) { return Ledger.home(); }
  },
  legacy() {
    const fn = Ledger.host('fnData');
    if (!fn || !fn.monthly) return [];
    const out = [];
    Object.keys(fn.monthly).forEach((ym) => (fn.monthly[ym] || []).forEach((e) => {
      if (!e) return;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) ? e.date : ym + '-01';
      out.push({ id: 'ld:' + ym + ':' + e.id, legacyId: e.id, legacyMonth: ym, legacy: true, date, time: '',
        amount: Math.abs(Number(e.amt) || 0), currency: '', merchant: e.note || '', note: '',
        category: LEGACY_CAT[e.cat] || 'Other', budgetCat: e.cat || 'other', source: 'form', receiptId: null });
    }));
    return out;
  },
  all() { return Finance.items.concat(Ledger.legacy()); },
  budgetCat(x) { return x.budgetCat || CAT_TO_BUDGET[x.category] || 'other'; },
  /* Only money in the chosen currency is added up; anything else is counted
     apart rather than silently mixed in. */
  sum(items) {
    const home = Ledger.home(); let total = 0; const other = {};
    items.forEach((x) => {
      const cur = String(x.currency || home).toUpperCase(), v = Math.abs(Number(x.amount) || 0);
      if (cur === home) total += v; else other[cur] = (other[cur] || 0) + v;
    });
    return { total, other };
  },
  otherLine(other) {
    const k = Object.keys(other || {});
    return k.length ? ' · plus ' + k.map((c) => money(other[c], c)).join(', ') + ' not counted' : '';
  },
  async add(rec) { const it = await Finance.add(rec); Ledger.changed(); return it; },
  async remove(id) {
    if (String(id).indexOf('ld:') === 0) {
      const fn = Ledger.host('fnData');
      const m = /^ld:(\d{4}-\d{2}):(.*)$/.exec(id);
      if (fn && m && fn.monthly && fn.monthly[m[1]]) {
        fn.monthly[m[1]] = fn.monthly[m[1]].filter((e) => String(e.id) !== m[2]);
        try { Ledger.host('fnSave')(); } catch (e) {}
      }
    } else await Finance.remove(id);
    Ledger.changed();
  },
  /* Both Finances screens and the Today tile repaint from the same list. */
  changed() {
    try { const r = Ledger.host('renderFinance'); if (typeof r === 'function') r(); } catch (e) {}
    try { const sec = document.querySelector('[data-flow-finance]'); if (sec) FinanceUI.repaint(sec.closest('.flow-section, .section') || sec.parentElement); } catch (e) {}
    try { TodayPlus.apply(); } catch (e) {}
  }
};
window.FlowLedger = Ledger;

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
      ' · gram gold is derived from the ounce price' +
      /* Simple keeps the chips off Today: which prices show is a setting,
         and this is the way to it. */
      '<span class="flow-mkt-editwrap"> · <button type="button" class="flow-mkt-edit" data-mkt-edit>edit</button></span></div>';
    if (!strip.__mktEdit) {
      strip.__mktEdit = true;
      strip.addEventListener('click', (e) => {
        if (!e.target.closest('[data-mkt-edit]')) return;
        try { SetView.open('main'); } catch (e2) { try { Nav.go('settings'); } catch (e3) {} }
        setTimeout(() => { const c = document.getElementById('todayCard'); if (c) window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); }, 350);
      });
    }
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
      if (j && j.plus) { Plus.refused(j, { open: true }); fail(Plus.simple() ? 'Ask is part of Flow Plus — it answers from your own record. See Plus in Settings.' : j.error); return; }
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
      if (!r.ok && j.plus) Plus.refused(j, { open: true });
      Ask.turns.push({ role: 'assistant', content: (r.ok ? (j.reply || '(no answer)') : (j.plus && Plus.simple() ? 'Ask is part of Flow Plus — it answers from your own record. See Plus in Settings.' : (j.error || 'That did not work.'))) });
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
    const sums = Ledger.sum(month);
    const total = sums.total;
    const cats = Finance.byCategory(month);
    const trend = Finance.byMonth(6);
    const recent = Ledger.all().sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))).slice(0, 25);
    const budget = Number(s.budgetMonthly) || 0;

    wrap.innerHTML = `
      <div class="flow-card">
        <h3>📸 Snap a receipt</h3>
        <p class="flow-sub">Photograph an invoice or till receipt. The text is read on your device; when you save, the photo is kept with the expense in your account so you can open it again. Merchant, total, date and time are filled in for you — correct anything that came out wrong and save.</p>
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

      <div class="flow-card" id="fx-stmt">
        <h3>🏦 Bank statements</h3>
        <p class="flow-sub">Upload the statement your bank lets you download — PDF, Excel or CSV, current account or credit card. Every transaction is read, sorted into your categories and turned into a report, and you decide whether the spending goes into your expenses. The lines are kept; the file is not.</p>
        <div class="flow-drop" data-fa="pickCsv">Drop a statement here, or tap to choose one<small class="fx-drop-sub">PDF · Excel · CSV</small></div>
        <input type="file" accept=".pdf,.xlsx,.xls,.csv,.txt,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" id="fx-csv" style="display:none">
        <div id="fx-csvresult" style="margin-top:12px"></div>
        <div id="fx-stmtpast"></div>
        <details style="margin-top:12px">
          <summary style="cursor:pointer;font-size:12.5px;color:var(--f-muted)">Why not connect the bank directly?</summary>
          <p class="flow-sub" style="margin-top:8px">In Türkiye only providers licensed by the Central Bank may pull account data on someone's behalf, so a live bank feed means partnering with one of them. Until then, the statement every bank already gives you is the reliable way in — and re-uploading an overlapping month is safe.</p>
        </details>
      </div>

      <div class="flow-card" id="fx-habitcard">
        <h3>📊 Spending habits</h3>
        <p class="flow-sub">Every statement you have uploaded, read together — worked out on this screen, nothing sent anywhere.</p>
        <div id="fx-habits"><p class="flow-empty">Working it out…</p></div>
      </div>

      <div class="flow-grid c2">
        <div class="flow-card">
          <h3>Where ${esc(MON[now.getMonth()])} went</h3>
          <p class="flow-sub">${month.length} expense${month.length === 1 ? '' : 's'} · ${esc(money(total, s.currency))} total${esc(Ledger.otherLine(sums.other))}</p>
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
    FinanceUI.paintPast(wrap);
    Habits.paint(wrap);
    if (FinanceUI.state.openStatement) {
      Statement.get(FinanceUI.state.openStatement).then(full => { if (full) FinanceUI.showStatement(wrap, full); });
    }
  },

  bind(section, wrap) {
    const fileEl = wrap.querySelector('#fx-file');
    const csvEl = wrap.querySelector('#fx-csv');

    /* repaint() re-renders inside the same wrap and calls bind() again. The
       wrap's own listeners must be added once, or every repaint stacked
       another copy and one tap on "Add expense" added it two, three times. */
    if (!wrap.__faBound) {
    wrap.__faBound = true;
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
        Ledger.changed();
      }
      else if (a === 'del') { await Ledger.remove(t.getAttribute('data-id')); toast('Deleted'); FinanceUI.repaint(section); }
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
          .concat(Ledger.all().map(x => [x.date, x.time || '', x.merchant || '', x.category || '', Math.abs(x.amount), x.currency || Ledger.home(), (x.note || '').replace(/"/g, "'"), x.source || '']));
        download(`the-flow-expenses-${today()}.csv`,
          rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
      }
      else if (a === 'exportJson') download(`the-flow-expenses-${today()}.json`, JSON.stringify(Ledger.all(), null, 2), 'application/json');
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
      else if (a === 'stmtImport') {
        const id = t.getAttribute('data-id');
        const full = await Statement.get(id);
        if (!full) { toast('That statement is no longer stored.', 'warn'); return; }
        if (full.imported || FinanceUI._importing) return;
        FinanceUI._importing = true;
        t.disabled = true;
        let res;
        try {
          res = await Finance.importItems(Statement.expenses(full));
          await Statement.markImported(id, res.added);
        } finally { FinanceUI._importing = false; }
        Ledger.changed();
        toast(`Added ${res.added} expense${res.added === 1 ? '' : 's'}${res.dupes ? ` · ${res.dupes} already there` : ''} ✓`, null, 4200);
        FinanceUI.state.openStatement = id;
        FinanceUI.repaint(section);
      }
      else if (a === 'stmtOpen') {
        const full = await Statement.get(t.getAttribute('data-id'));
        if (!full) { toast('That statement is no longer stored.', 'warn'); return; }
        FinanceUI.showStatement(wrap, full);
        const box = wrap.querySelector('#fx-csvresult');
        if (box && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      else if (a === 'stmtDel') {
        const id = t.getAttribute('data-id');
        if (!confirm('Remove this statement report? Expenses already added stay in your expenses.')) return;
        await Statement.remove(id);
        if (FinanceUI.state.openStatement === id) { FinanceUI.state.openStatement = null; const box = wrap.querySelector('#fx-csvresult'); if (box) box.innerHTML = ''; }
        FinanceUI.paintPast(wrap);
        Habits.paint(wrap);
      }
      else if (a === 'stmtClose') { FinanceUI.state.openStatement = null; const box = wrap.querySelector('#fx-csvresult'); if (box) box.innerHTML = ''; }
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
        const rid = sel.getAttribute('data-recat');
        if (String(rid).indexOf('ld:') === 0) {
          const fn = Ledger.host('fnData'); const m = /^ld:(\d{4}-\d{2}):(.*)$/.exec(rid);
          const row = fn && m && (fn.monthly[m[1]] || []).find((e) => String(e.id) === m[2]);
          if (row) { row.cat = CAT_TO_BUDGET[sel.value] || 'other'; try { Ledger.host('fnSave')(); } catch (e2) {} Ledger.changed(); toast('Category updated.'); }
          return;
        }
        const it = Finance.items.find(x => x.id === rid);
        if (it) {
          it.category = sel.value;
          await Finance.save();
          await Finance.learn(it.merchant, sel.value);
          toast('Category updated — that merchant is remembered.');
        }
      }
    });
    }

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
        csvEl.value = '';
        FinanceUI.handleStatementFile(section, wrap, f);
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
        else FinanceUI.handleStatementFile(section, wrap, f);
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

  async handleStatementFile(section, wrap, file) {
    const box = wrap.querySelector('#fx-csvresult');
    if (!box) return;
    if (file.size > 10 * 1024 * 1024) { box.innerHTML = '<p class="flow-empty">That file is over 10 MB. Download a shorter period, or the PDF rather than a scan.</p>'; return; }
    const name = String(file.name || '');
    const isText = /\.(csv|txt)$/i.test(name) || /^text\//.test(file.type || '');
    box.innerHTML = `<div class="fx-reading" role="status" aria-live="polite">
        <div class="flow-prog" style="display:block"><i style="width:8%"></i></div>
        <p class="flow-empty" id="fx-readmsg">Reading ${esc(name || 'your statement')}…</p>
      </div>`;
    const bar = box.querySelector('.flow-prog i'), msg = box.querySelector('#fx-readmsg');
    const tick = (sec) => {
      if (bar) bar.style.width = Math.min(92, 8 + sec * 1.6).toFixed(0) + '%';
      if (msg) msg.textContent = sec < 8 ? 'Reading ' + (name || 'your statement') + '…'
        : 'Reading every line — a long statement takes up to a minute or two. (' + sec + 's)';
    };
    try {
      const out = await Statement.read(file, tick);
      if (bar) bar.style.width = '100%';
      const full = await Statement.save(out);
      FinanceUI.state.openStatement = full.id;
      FinanceUI.showStatement(wrap, full);
      FinanceUI.paintPast(wrap);
      Habits.paint(wrap);
    } catch (e) {
      /* With no assistant on this Flow, a CSV can still be read the old way. */
      if (isText && (e.status === 503 || e.status === 401 || /not switched on|Sign in/i.test(e.message || ''))) {
        const fr = new FileReader();
        fr.onload = () => FinanceUI.handleCSV(wrap, String(fr.result));
        fr.readAsText(file, 'utf-8');
        return;
      }
      box.innerHTML = `<p class="flow-empty">${esc(e.message || 'The statement could not be read.')}</p>`;
    }
  },

  async paintPast(wrap) {
    const host = wrap.querySelector('#fx-stmtpast');
    if (!host) return;
    const list = await Statement.list();
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="fx-past"><div class="flow-label" style="margin:14px 0 6px">Your statements</div>
      ${list.map(x => `<div class="fx-past-row">
        <button type="button" class="fx-past-open" data-fa="stmtOpen" data-id="${esc(x.id)}">
          <b>${esc(x.bank || 'Statement')}${x.account ? ' · ' + esc(x.account) : ''}</b>
          <span>${esc(Statement.period(x) || prettyDate(String(x.at).slice(0, 10)))} · ${esc(money(x.out || 0, x.currency))} out · ${x.n} line${x.n === 1 ? '' : 's'}${x.imported ? ' · added ✓' : ''}</span>
        </button>
        <button type="button" class="flow-btn ghost sm" data-fa="stmtDel" data-id="${esc(x.id)}" aria-label="Remove this statement">×</button>
      </div>`).join('')}</div>`;
  },

  showStatement(wrap, r) {
    const box = wrap.querySelector('#fx-csvresult');
    if (!box) return;
    FinanceUI.state.openStatement = r.id;
    const s = Statement.summarise(r);
    const cur = s.cur;
    const m = (v) => money(v, cur);
    const items = Statement.expenses(r);
    const dupes = r.imported ? 0 : Statement.dupeCount(items);
    const fresh = items.length - dupes;
    const kindLbl = { spend: 'spend', income: 'in', transfer: 'transfer', fee: 'fee', refund: 'refund', 'card-payment': 'card payment' };
    const list = (rows, f) => rows.length ? '<ol class="fx-rlist">' + rows.map(f).join('') + '</ol>' : '<p class="flow-empty">None.</p>';
    box.innerHTML = `
      <div class="fx-report">
        <div class="fx-rtop">
          <div style="min-width:0;flex:1">
            <div class="fx-rh">${esc(r.bank || 'Statement')}${r.account ? ' · ' + esc(r.account) : ''}</div>
            <div class="flow-sub" style="margin:2px 0 0">${esc(Statement.period(r))}${Statement.period(r) ? ' · ' : ''}${r.tx.length} transaction${r.tx.length === 1 ? '' : 's'}</div>
          </div>
          <button type="button" class="flow-btn ghost sm" data-fa="stmtClose" aria-label="Close the report">×</button>
        </div>
        ${r.partial ? '<p class="fx-warn">Only part of this statement could be read in one go. Check the dates covered, and upload the rest as a shorter period.</p>' : ''}
        <div class="fx-tiles">
          <div class="fx-tile"><span>Money out</span><b>${esc(m(s.out))}</b></div>
          <div class="fx-tile"><span>Money in</span><b>${esc(m(s.inc))}</b></div>
          <div class="fx-tile"><span>Net</span><b class="${s.inc - s.out >= 0 ? 'fx-pos' : 'fx-neg'}">${esc(m(s.inc - s.out))}</b></div>
          ${s.fees ? `<div class="fx-tile"><span>Fees &amp; interest</span><b>${esc(m(s.fees))}</b></div>` : ''}
        </div>
        ${s.other ? `<p class="flow-sub">${s.other} line${s.other === 1 ? ' is' : 's are'} in another currency and not in these totals.</p>` : ''}

        <div class="fx-addbar">
          ${r.imported
            ? `<span>Added to your expenses ✓ <small>${r.imported.added} line${r.imported.added === 1 ? '' : 's'}, ${esc(prettyDate(String(r.imported.at).slice(0, 10)))}</small></span>`
            : fresh > 0
              ? `<span>${fresh} expense${fresh === 1 ? '' : 's'} to add${dupes ? ` <small>${dupes} already in your expenses</small>` : ''}</span>
                 <button type="button" class="flow-btn primary sm" data-fa="stmtImport" data-id="${esc(r.id)}">Add to expenses</button>`
              : `<span>Everything here is already in your expenses${items.length ? '' : ' — there was no spending to add'}.</span>`}
        </div>

        <div class="flow-grid c2" style="margin-top:12px">
          <div><div class="flow-label">Spending by category</div>
            ${s.cats.length ? '<ol class="fx-rlist fx-cats">' + s.cats.slice(0, 10).map(c => `<li><span>${esc(c.label)}</span><b>${esc(m(c.value))}</b><i style="width:${Math.max(3, Math.round(c.value / s.cats[0].value * 100))}%"></i></li>`).join('') + '</ol>' : '<p class="flow-empty">No spending in this statement.</p>'}
          </div>
          <div>
            <div class="flow-label">Where it went most</div>
            ${list(s.merchants, x => `<li><span>${esc(x.name)}${x.n > 1 ? ' <small>×' + x.n + '</small>' : ''}</span><b>${esc(m(x.total))}</b></li>`)}
          </div>
          <div>
            <div class="flow-label">Recurring</div>
            ${list(s.recurring, x => `<li><span>${esc(x.name)}${x.n > 1 ? ' <small>×' + x.n + '</small>' : ''}</span><b>${esc(m(x.total / x.n))}${x.n > 1 ? '<small> each</small>' : ''}</b></li>`)}
          </div>
          <div>
            <div class="flow-label">Biggest charges</div>
            ${list(s.biggest, t => `<li><span>${esc(t.merchant)} <small>${esc(prettyDate(t.date))}</small></span><b>${esc(m(-t.amount))}</b></li>`)}
          </div>
        </div>

        <details class="fx-all">
          <summary>Every line (${r.tx.length})</summary>
          <div class="flow-scroll"><table class="flow-table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead>
            <tbody>${r.tx.map(t => `<tr><td>${esc(prettyDate(t.date))}</td><td>${esc(t.merchant)}${t.kind !== 'spend' ? ' <span class="flow-chip">' + esc(kindLbl[t.kind] || t.kind) + '</span>' : ''}</td><td>${esc(t.category)}</td><td class="num ${t.amount > 0 ? 'fx-pos' : ''}">${esc(money(t.amount, t.currency || cur))}</td></tr>`).join('')}</tbody>
          </table></div>
        </details>
      </div>`;
    try { Chart.hydrate(box); } catch (e) {}
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
      dot: 'linear-gradient(135deg,#00e88a,#0093e7)', tc: '#0a0b0d', sdot: '#FF6B3D,#C8F26B' },
    { id: 'bloom',     name: 'Bloom',     sub: 'soft light',
      dot: 'linear-gradient(135deg,#f5dfe4,#b0648a)', tc: '#fdf8f7', sdot: '#B0648A,#F6DCE3' },
    { id: 'aurora',    name: 'Aurora',    sub: 'violet night',
      dot: 'linear-gradient(135deg,#c084fc,#5eead4)', tc: '#12101e', sdot: '#C084FC,#5EEAD4' },
    { id: 'paper',     name: 'Paper',     sub: 'warm light',
      dot: 'linear-gradient(135deg,#f8f5ef,#2f6f5e)', tc: '#f8f5ef', sdot: '#2F6F5E,#D3E6C8' },
    { id: 'calm',      name: 'Calm',      sub: 'quiet blue',
      dot: 'linear-gradient(135deg,#7fa8dd,#2a2f36)', tc: '#0c0e11', sdot: '#7FA8DD,#A9D8C8' },
    { id: 'bold',      name: 'Bold',      sub: 'loud and square',
      dot: 'linear-gradient(135deg,#ffe600,#ff3b30)', tc: '#000000', sdot: '#FF3B30,#FFE600' },
    { id: 'operator',  name: 'Operator',  sub: 'monospaced',
      dot: 'linear-gradient(135deg,#00e08a,#06090a)', tc: '#06090a', sdot: '#00E08A,#B8FF5C' }
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
  /* Every theme has a Simple version too (its --lk-* palette in the
     stylesheet). In Simple the swatch shows that version's two colours — the
     accent and the block colour — split down the middle, rather than the
     Advanced gradient, so what you tap is what you get. */
  dot(t) {
    let simple = false;
    try { simple = TodayLook.on(); } catch (e) {}
    if (!simple || !t.sdot) return t.dot;
    const [a, b] = t.sdot.split(',');
    return 'linear-gradient(135deg,' + a + ' 0 50%,' + b + ' 50% 100%)';
  },
  /* Repaint the swatches in place, for when the interface switches while
     Settings is open. */
  paintDots() {
    document.querySelectorAll('.theme-swatch[data-theme] .sw-dot').forEach((d) => {
      const t = Theme.meta(d.parentNode.getAttribute('data-theme'));
      d.style.setProperty('--d', Theme.dot(t));
    });
  },
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

      ${TodayLook.on() ? Plus.settingsHtml() : ''}
      <div class="flow-card" id="lookCard">
        <h3>🎨 Appearance</h3>
        <p class="flow-sub">Pick a colour theme. It applies the instant you tap it — no reload — and is saved to your account (or kept on this device while you're just looking around).</p>
        <div class="theme-grid">
          ${Theme.LIST.map(t => `<button type="button" class="theme-swatch${Theme.current() === t.id ? ' on' : ''}" data-theme="${t.id}">
            <span class="sw-dot" style="--d:${Theme.dot(t)}"></span>
            <span class="sw-tx"><span class="sw-nm" data-i18n="off">${t.name}</span><span class="sw-sub">${t.sub}</span></span>
          </button>`).join('')}
        </div>
        <div class="flow-switch" style="margin-top:14px" id="newLookRow"><div class="t"><b>Simple interface</b><span>The new design — every page and every function, cleaner and bigger. Off is Advanced, the classic design. Nothing you wrote changes either way.</span></div>
          <input type="checkbox" data-s="newLook" data-type="bool" ${s.newLook ? 'checked' : ''}></div>
        <div class="flow-switch"><div class="t"><b>Time chips on task rows</b><span>The 🕘 chip that gives a task a date, time, duration and alert. Turn off to hide them everywhere without losing anything you already scheduled.</span></div>
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
        <h3>🤖 Assistant connections</h3>
        <p class="flow-sub">Let Claude, ChatGPT or another assistant read your week, add Big Rocks, tick habits and reword your own lists — on this account and no other. It can add and change things; removing anything stays something you do here.</p>
        <ol class="flow-ol">
          <li>In Claude or ChatGPT, add a custom connector with this address: <code class="mcp-inline">${esc(location.origin)}/mcp</code></li>
          <li>It sends you here to sign in and say yes. That is all — nothing to copy.</li>
          <li>Ask it "what's on my week?" to check it worked.</li>
        </ol>
        <div id="mcpConns" class="mcp-list"></div>
        <details class="mcp-adv" id="mcpAdv">
          <summary>Advanced — server address and access tokens</summary>
          <div class="flow-field"><label class="flow-label">Server URL</label>
            <div class="mcp-url"><code id="mcpUrl">${esc(location.origin)}/mcp</code><button type="button" class="flow-btn sm" data-mcp="copyurl">Copy</button></div>
          </div>
          <div class="mcp-new" id="mcpNew" hidden>
            <div class="flow-label">Your new token — copy it now, it is not shown again</div>
            <div class="mcp-url"><code id="mcpSecret"></code><button type="button" class="flow-btn sm primary" data-mcp="copytok">Copy</button></div>
          </div>
          <div id="mcpList" class="mcp-list"><div class="flow-sub">Loading…</div></div>
          <div class="mcp-acts">
            <input class="flow-in" id="mcpName" placeholder="What is this for? e.g. my script" maxlength="60">
            <button type="button" class="flow-btn primary" data-mcp="new">Create access token</button>
          </div>
          <p class="flow-sub">An access token is the manual way in, for a client that cannot sign in as above, for your own scripts, or for the home-screen widget.</p>
          <p class="flow-sub">A token is as good as your password for reading and adding — treat it like one. If you no longer recognise a token in the list, revoke it; anything using it stops working immediately and nothing you have saved is touched.</p>
        </details>
      </div>

      <div class="flow-card" id="watchCard">
        <h3>⌚ Watch</h3>
        <p class="flow-sub">Today on your wrist: your Big Rocks and habits to tick, what is next, and a Big Rock or a note added by voice. Apple Watch and Wear OS.</p>
        <ol class="flow-ol">
          <li>Open The Flow on the watch. It shows a code of six letters and numbers.</li>
          <li>Type it here. The watch picks it up by itself.</li>
        </ol>
        <form class="mcp-acts" id="watchForm" autocomplete="off">
          <input class="flow-in" id="watchCode" placeholder="ABC-123" maxlength="9" autocapitalize="characters" spellcheck="false" aria-label="Code shown on the watch">
          <button type="submit" class="flow-btn primary">Link watch</button>
        </form>
        <div class="flow-sub" id="watchOut" role="status"></div>
        <div id="watchList" class="mcp-list"></div>
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
        ${Auth.user && Auth.user.owner ? `
        <div class="pw-owner" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--f-line)">
          <div class="flow-label">Someone locked out?</div>
          <p class="flow-sub" style="margin:6px 0 10px">Make a one-time link that lets them choose a new password. It works for 30 minutes and signs them out everywhere else. Send it to them yourself.</p>
          <div class="flow-row"><input class="flow-in grow" id="pw-for" type="email" placeholder="Their email address" autocomplete="off">
            <button class="flow-btn" data-act2="resetlink">Make reset link</button></div>
          <div class="mcp-url" id="pw-linkrow" hidden style="margin-top:8px"><code id="pw-link"></code><button type="button" class="flow-btn sm primary" data-act2="copyreset">Copy</button></div>
        </div>` : ''}
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
        if (key === 'newLook') { try { TodayLook.applyLook(); } catch (e) {} }
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
    try { SettingsUI.watchWire(section); } catch (e) {}
    try { Plus.settingsWire(section); } catch (e) {}

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
      if (a === 'changepw') { PwSheet.open(); return; }
      if (a === 'resetlink') {
        const who = (section.querySelector('#pw-for') || {}).value || '';
        if (!who.trim()) { toast('Type their email address first.', 'err'); return; }
        try {
          const j = await Auth.post('/api/auth/reset/link', { email: who.trim() });
          section.querySelector('#pw-link').textContent = j.link;
          section.querySelector('#pw-linkrow').hidden = false;
        } catch (e) { toast(e.message, 'err', 5000); }
        return;
      }
      if (a === 'copyreset') {
        const t = (section.querySelector('#pw-link') || {}).textContent || '';
        try { await navigator.clipboard.writeText(t); toast('Link copied ✓'); } catch (e) { toast('Select the link and copy it.', 'err'); }
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

  /* A watch is linked with the code it shows; a linked one is an access
     token named after it, listed and removed here like any other. */
  async watchPaint(section) {
    const box = section.querySelector('#watchList'); if (!box) return;
    try {
      const r = await SettingsUI.mcpFetch('/api/flow/tokens');
      const list = (r.tokens || []).filter((t) => /^(Apple Watch|Wear OS watch)/.test(t.name || ''));
      box.innerHTML = list.length ? '<div class="flow-label" style="margin-bottom:2px">Linked</div>' + list.map((t) => SettingsUI.mcpRow(t).replace('>Revoke<', '>Unlink<')).join('') : '';
      box.querySelectorAll('[data-mcp="revoke"]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Unlink this watch? It stops showing your day straight away.')) return;
        b.disabled = true;
        try {
          await SettingsUI.mcpFetch('/api/flow/tokens/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.getAttribute('data-id') }) });
          toast('Unlinked ✓'); SettingsUI.watchPaint(section); try { SettingsUI.mcpPaint(section); } catch (e) {}
        } catch (e) { b.disabled = false; toast(e.message, 'err'); }
      }));
    } catch (e) { box.innerHTML = ''; }
  },
  watchWire(section) {
    const f = section.querySelector('#watchForm'); if (!f || f.__w) return; f.__w = 1;
    const inp = section.querySelector('#watchCode'), out = section.querySelector('#watchOut');
    inp.addEventListener('input', () => {
      const v = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      const nv = v.length > 3 ? v.slice(0, 3) + '-' + v.slice(3) : v;
      if (nv !== inp.value) inp.value = nv;
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = inp.value.trim();
      if (code.replace(/[^A-Z0-9]/gi, '').length !== 6) { out.textContent = 'The code on the watch has six letters and numbers.'; inp.focus(); return; }
      const btn = f.querySelector('button'); btn.disabled = true; out.textContent = 'Linking…';
      try {
        const r = await SettingsUI.mcpFetch('/api/flow/watch/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        out.textContent = 'Linked ✓ — ' + r.name + ' will show your day in a moment.';
        inp.value = '';
        SettingsUI.watchPaint(section); try { SettingsUI.mcpPaint(section); } catch (e2) {}
      } catch (err) { out.textContent = err.message || 'That did not work.'; }
      btn.disabled = false;
    });
    SettingsUI.watchPaint(section);
    try {
      if (window.__flowGoWatch) {
        window.__flowGoWatch = false;
        setTimeout(() => { section.querySelector('#watchCard').scrollIntoView({ block: 'center' }); inp.focus(); }, 300);
      }
    } catch (e) {}
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
          const adv = card.querySelector('#mcpAdv'); if (adv) adv.open = true;
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
    Ledger.all().filter(x => x.date === date).forEach(x =>
      out.spend.push(`${x.merchant || x.category} · ${money(Math.abs(x.amount), x.currency || Ledger.home())}`));
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
  /* The Today tile reads like Recovery beside it — one short line, 4.5h —
     instead of 4h 30m breaking onto two lines. Under an hour stays minutes. */
  short(min) {
    min = Math.max(0, Math.round(min));
    if (min < 60) return min + 'm';
    const h = min / 60;
    return (h >= 10 ? String(Math.round(h)) : h.toFixed(1)) + 'h';   /* 6.0h, as Recovery writes it */
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
    if (v) v.textContent = min ? Focus.short(min) : '—';
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
    return { v: String(total), sub: next ? (next.t <= now ? 'now · ' : 'next ') + hm(next.t) : 'all finished', tone: next && next.t <= now ? ' warn' : '' };
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
    const month = TodayPlus.host('NOW_MONTH') || today().slice(0, 7);
    const t = TodayPlus.host('todayStr') || today();
    const cats = TodayPlus.host('FIN_CATS') || [];
    /* Both expense stores, one total — see Ledger. */
    const rows = Finance.inMonth(month);
    const mtd = Ledger.sum(rows).total;
    const tod = Ledger.sum(rows.filter(r => r.date === t)).total;
    let budget = 0;
    try { cats.forEach(c => { budget += Number(((fn || {}).budgets || {})[c.id]) || 0; }); } catch (e) {}
    if (!budget) budget = Number(Settings.get('budgetMonthly')) || 0;
    return { today: tod, mtd, budget, count: rows.length };
  },

  /* The currency chosen in Preferences, the same on every screen. */
  money(n) {
    const v = Number(n) || 0;
    return Math.abs(v) >= 1000 ? moneyCompact(v, Ledger.home()) : money(v, Ledger.home()).replace(/[.,]00(?=\D*$)/, '');
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
          '<div class="pl-row"><input class="flow-in" type="time" id="pl-time" data-ph="Time (optional)" aria-label="Time"><select class="flow-in" id="pl-prio"><option value="high">Must</option><option value="med" selected>Should</option><option value="low">Could</option></select></div>' +
          '<div class="pl-acts"><button type="button" class="flow-btn primary" data-pl="add">Add to today</button><button type="button" class="flow-btn" data-pl="weekpick">Add to the week ▾</button></div>' +
          '<div class="pl-days" id="pl-days" hidden></div>' +
          '<div class="pl-list" id="pl-list"></div>' +
          '<button type="button" class="flow-btn ghost pl-rocks" data-pl="week">＋ Add Big Rocks in Week Compass</button>' +
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
    try { ReviewPlus.decorate(wrap); } catch (e) { console.warn('[Flow] review evidence', e); }
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
      ['focus', 'Focus', fmin ? Focus.short(fmin) : '—', frun ? '● running' : (fmin ? 'logged today' : 'none logged'), frun ? ' good' : ''],
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
    /* Simple: an item overdue for more than two weeks is not a red row every
       morning; the old ones fold into one line that opens on a tap. */
    const simple = (() => { try { return TodayLook.on(); } catch (e) { return false; } })();
    const ago = (d) => Math.round((Date.now() - parseISO(d).getTime()) / 864e5);
    const stale = simple ? pri.overdue.filter((r) => ago(r.date) > 14) : [];
    const fresh = simple ? pri.overdue.filter((r) => ago(r.date) <= 14) : pri.overdue;
    const staleHtml = stale.length ? '<button type="button" class="flow-td-row od lk-stale" data-stale-toggle aria-expanded="false"><span class="tx">' + stale.length + ' overdue since ' + esc(MON[parseISO(stale[stale.length - 1].date).getMonth()]) + '</span><span class="mt">review ▾</span></button>' +
      '<div class="lk-stale-body" hidden>' + stale.slice(0, 12).map(r => prow(r.text, 'overdue · ' + prettyDate(r.date), ' od')).join('') + '</div>' : '';
    const pbody = [
      ...fresh.slice(0, 4).map(r => prow(r.text, 'overdue · ' + prettyDate(r.date), ' od')),
      staleHtml,
      ...(pri.flagged || []).slice(0, 5).map(r => prow(r.text, 'priority · ' + (r.date === today() ? 'today' : prettyDate(r.date)), '')),
      ...pri.q1.slice(0, 4).map(i => prow(i.txt, 'Q1 · urgent', '', i.id)),
      ...pri.q2.slice(0, 3).map(i => prow(i.txt, 'Q2', '', i.id))
    ].join('');
    pblock.innerHTML =
      /* The count is of what the card lists: overdue rows were shown under a
         header that said "0 open". */
      `<div class="flow-td-head"><span class="l">Priorities</span><span class="c${pri.overdue.length ? ' late' : ''}">${pri.q1.length + pri.q2.length + (pri.flagged || []).length + pri.overdue.length} open${pri.overdue.length ? ' · ' + pri.overdue.length + ' overdue' : ''}</span></div>` +
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

    try { Patterns.decorate(hblock); } catch (e) { console.warn('[Flow] patterns', e); }
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
      Auth.simpleDefault = !!j.simpleDefault;
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
        <p class="fa-fine" id="fa-nomail" hidden style="margin:8px 0 0">No recovery codes? Ask whoever runs this Flow for a reset link — they can make one for you in Privacy &amp; security.</p>
        <div class="fa-or"><span>or</span></div>
        <button class="flow-btn ghost" id="fa-guest">Have a look around first</button>
        <p class="fa-fine">No account, nothing saved to the server. You can keep your work if you sign up afterwards.</p>
        <p class="fa-fine fa-legal" style="margin:14px 0 0;text-align:center"><a href="/about" target="_blank" rel="noopener">About</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>
      </div>`;
    document.body.appendChild(el);

    let mode = firstRun ? 'signup' : 'login';
    /* null until the server answers; false means no mail provider here, so
       the email button is not offered and the way out is said instead. */
    let mailOk = null;
    fetch('/api/auth/reset/available', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j) { mailOk = !!j.mail; if (mode === 'recover') setMode('recover'); } })
      .catch(() => {});
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
      if (mailb) { mailb.hidden = m !== 'recover' || mailOk === false; mailb.disabled = false;
                   mailb.textContent = 'Email me a link instead'; }
      const nomail = $('#fa-nomail', el);
      if (nomail) nomail.hidden = m !== 'recover' || mailOk !== false;
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
          try { payload.lang = (typeof Lang !== 'undefined' && Lang.current) || ''; } catch (e) {}
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
    /* This device stops being this account's before the session ends — the
       unregister call needs the session. On iPhone: reminders stop coming to
       this phone and the home-screen widget forgets the day it was showing.
       In a browser: this browser's notification subscription goes. Each step
       is best effort and time-boxed; none may block signing out. */
    const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    const unreg = (body) => fetch('/api/push/unregister', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    try {
      const B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FlowBridge;
      if (B) {
        await within((async () => {
          try { const t = await B.pushToken(); if (t && t.token) await unreg({ token: t.token }); } catch (e) {}
          try { await B.clear(); } catch (e) {}
        })(), 2500);
      } else if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
        await within((async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = reg && reg.pushManager && await reg.pushManager.getSubscription();
          if (sub) { await unreg({ endpoint: sub.endpoint }); try { await sub.unsubscribe(); } catch (e) {} }
        })(), 2500);
      }
    } catch (e) {}
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
  mic:      '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  link:     '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  dots:     '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  bell:     '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
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
  star:     '<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.5-4.2 6.1-.8z"/>',
  camera:   '<path d="M4 8h3.5l1.5-2.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13.5" r="3.2"/>'
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
      /* Reminders set from Coming up, inside the same eight days. */
      try {
        if (Settings.get('pushRemindRocks') !== false) {
          const rem = (typeof Ahead !== 'undefined' && Ahead.rem) || (await DB.get('flow:reminders', [])) || [];
          const now = Date.now(), edge = now + 8 * 864e5;
          rem.forEach((r) => {
            const at = new Date(String(r.at) + ':00');
            if (!r || r.off || isNaN(at) || at - now < 30000 || at > edge) return;
            want['rem:' + r.id] = { title: String(r.title || 'Reminder').slice(0, 120), body: String(r.body || '').slice(0, 160), at: Notify.iso(at) };
          });
        }
      } catch (e) {}
      const have = {};
      try { ((await N.pending()).pending || []).forEach((p) => { have[p.id] = p; }); } catch (e) {}
      for (const id of Object.keys(have)) {
        if ((id.indexOf('rock:') === 0 || id.indexOf('rem:') === 0) && !want[id]) await N.cancel(id);
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
  /* Bold, and Fathom's [moment](url?timestamp=59.0) links. The words stay
     plain, readable text; the link becomes a small "▶ 29:22" after them that
     opens the recording at that second. A whole paragraph drawn as an
     underlined link was hard to read, and a long one (over 200 characters)
     did not match at all and showed its raw markdown and URL instead. */
  inline(t) {
    const ts = (url) => {
      const m = /[?&;]timestamp=(\d+(?:\.\d+)?)/.exec(url);   /* &amp; once escaped */
      if (!m) return 'Open';
      const sec = Math.floor(parseFloat(m[1])), h = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
      return (h ? h + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
    };
    return esc(t)
      .replace(/\[((?:[^\[\]]|\[[^\[\]]*\]){1,2000}?)\]\((https?:\/\/[^)\s]+)\)/g, (m, txt, url) =>
        /^https:\/\/(www\.)?fathom\.video\//.test(url)
          ? txt + ' <a class="td-ts" href="' + url + '" target="_blank" rel="noopener" aria-label="Play this moment">▶ ' + ts(url) + '</a>'
          : txt)
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
          ' · <button type="button" class="td-meet-tg">Show notes ▾</button></div>' +
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
        e.target.textContent = b.hidden ? 'Show notes ▾' : 'Hide notes ▴';
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
/* ── Slide a sheet down to close it ─────────────────────────────────────
 * Every phone sheet has the grab bar on top — the sign that it can be pulled
 * away — and none of them could be. Now each one follows the finger down and
 * closes past a third of its height or on a quick flick; anything less and it
 * springs back. Only from the top of the sheet's own scroll, so reading a
 * long sheet still scrolls it, and never from inside a field being typed in. */
const SheetDrag = {
  MAX_W: 760,
  overlayOpen() {
    return !!document.querySelector('.fn-sheetwrap.on, .moresheet.open, #flow-pal.on');
  },
  /* Every scroller between the finger and the sheet has to be at its top. */
  atTop(target, sheet) {
    for (let el = target; el && el !== sheet.parentNode; el = el.parentNode) {
      if (el.nodeType === 1 && el.scrollTop > 0) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll' || el === sheet) return false;
      }
    }
    return true;
  },
  close(sheet) {
    if (sheet.classList.contains('moresheet')) { const x = document.getElementById('moreBackdrop'); if (x) x.click(); return; }
    const wrap = sheet.closest('.fn-sheetwrap');
    const c = sheet.querySelector('.fn-grab, .fn-capture-close') || (wrap && wrap.querySelector('.fn-scrim'));
    if (c) c.click();
  },
  boot() {
    if (SheetDrag._on) return; SheetDrag._on = true;
    let s = null;
    document.addEventListener('touchstart', (e) => {
      s = null;
      if (innerWidth > SheetDrag.MAX_W || e.touches.length !== 1) return;
      const t = e.target;
      const sheet = t && t.closest && t.closest('.fn-sheetwrap.on .fn-sheet, .moresheet.open');
      if (!sheet) return;
      if (t.closest('input, textarea, select, [contenteditable], [contenteditable=""], .flow-scroll-x')) return;
      if (!SheetDrag.atTop(t, sheet)) return;
      s = { sheet, y0: e.touches[0].clientY, x0: e.touches[0].clientX, t0: Date.now(), dy: 0, on: false, last: e.touches[0].clientY, lt: Date.now(), v: 0 };
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!s) return;
      const y = e.touches[0].clientY, x = e.touches[0].clientX;
      const dy = y - s.y0;
      if (!s.on) {
        /* Up, or sideways first: that is a scroll or a swipe, not a pull. */
        if (dy < -4 || Math.abs(x - s.x0) > Math.abs(dy) + 6) { s = null; return; }
        if (dy < 8) return;
        s.on = true;
        s.sheet.style.transition = 'none';
        s.sheet.style.animation = 'none';
      }
      if (e.cancelable) e.preventDefault();
      const now = Date.now();
      s.v = (y - s.last) / Math.max(1, now - s.lt); s.last = y; s.lt = now;
      s.dy = Math.max(0, dy);
      s.sheet.style.transform = 'translateY(' + s.dy + 'px)';
    }, { passive: false });
    const end = () => {
      if (!s) return;
      const st = s; s = null;
      if (!st.on) return;
      const sheet = st.sheet, h = sheet.getBoundingClientRect().height || 400;
      const go = st.dy > Math.min(160, h * 0.33) || (st.v > 0.6 && st.dy > 30);
      sheet.style.transition = 'transform .22s cubic-bezier(.2,.9,.3,1)';
      if (go) {
        sheet.style.transform = 'translateY(' + (h + 40) + 'px)';
        setTimeout(() => {
          SheetDrag.close(sheet);
          setTimeout(() => { sheet.style.transform = ''; sheet.style.transition = ''; sheet.style.animation = ''; }, 60);
        }, 200);
      } else {
        sheet.style.transform = '';
        setTimeout(() => { sheet.style.transition = ''; sheet.style.animation = ''; }, 240);
      }
    };
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  }
};
window.FlowSheetDrag = SheetDrag;

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
      /* A new version deployed since this screen loaded: a pull is the
         moment to pick it up — the person asked for fresh, and nothing is
         half-typed. Data is already safe on the server. */
      if (manual) {
        try {
          const r = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
          const j = r.ok ? await r.json() : null;
          const mine = window.FLOW_PACK_V;
          if (j && j.v && mine && mine !== '__PACK_V__' && j.v !== mine && j.v !== 'missing' && j.v !== 'dev') {
            Refresh.say('Updating to the new version…');
            await Refresh.freshShell();
            location.reload();
            return;
          }
        } catch (e) {}
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
  /* ── Same version everywhere ──────────────────────────────────────────
   * A Mac app left open for days kept running the build it opened with, so
   * the phone had a feature the Mac did not. A new build is now picked up on
   * its own — but only at a moment nothing can be lost: when you come back
   * to the app, or after a minute of not touching it, with no sheet open,
   * nothing being typed in, and never twice in ten minutes. Data never
   * depends on it; it is on the server already. */
  VER_EVERY_MS: 5 * 60 * 1000,
  lastInput: Date.now(),
  async newer() {
    try {
      const r = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
      const j = r.ok ? await r.json() : null;
      const mine = window.FLOW_PACK_V;
      return !!(j && j.v && mine && mine !== '__PACK_V__' && j.v !== mine && j.v !== 'missing' && j.v !== 'dev');
    } catch (e) { return false; }
  },
  calm() {
    if (Refresh.busy || document.visibilityState !== 'visible') return false;
    if (document.querySelector('.fn-sheetwrap.on, #flow-pal.on, #flow-capture.on, dialog[open]')) return false;
    const a = document.activeElement;
    if (a && (a.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox'))) return false;
    /* anything half-typed anywhere on the page waits for you */
    const typed = [...document.querySelectorAll('textarea, input[type=text], input:not([type])')].some((e) => e.offsetParent && e.value && e.value !== e.defaultValue);
    return !typed;
  },
  async autoUpdate(why) {
    const now = Date.now();
    let last = 0; try { last = +sessionStorage.getItem('flow:autoUpd') || 0; } catch (e) {}
    if (now - last < 10 * 60 * 1000) return false;
    if (!Refresh.calm() || !(await Refresh.newer()) || !Refresh.calm()) return false;
    try { sessionStorage.setItem('flow:autoUpd', String(now)); } catch (e) {}
    Refresh.say('Updating to the new version…');
    await Refresh.freshShell();
    location.reload();
    return true;
  },
  /* The installed app answers the page from its own copy first (the
     service worker), and refreshes that copy in the background. Asking for
     the page once and giving that refresh a moment means the reload that
     follows gets the new build, not the old copy a second time. */
  async freshShell() {
    try { await fetch('/', { cache: 'no-store', credentials: 'same-origin' }); } catch (e) {}
    await new Promise((r) => setTimeout(r, 1500));
  },
  watchVersion() {
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((t) => document.addEventListener(t, () => { Refresh.lastInput = Date.now(); }, { passive: true, capture: true }));
    let away = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { away = Date.now(); return; }
      if (away && Date.now() - away > 60 * 1000) setTimeout(() => Refresh.autoUpdate('return'), 1500);
    });
    window.addEventListener('focus', () => { if (away && Date.now() - away > 60 * 1000) setTimeout(() => Refresh.autoUpdate('focus'), 1500); });
    setInterval(() => { if (Date.now() - Refresh.lastInput > 60 * 1000) Refresh.autoUpdate('idle'); }, Refresh.VER_EVERY_MS);
  },
  boot() {
    /* A long time away is worth a quiet sync on return; a short one is not. */
    try { window.__FLOW_SYNC_GAP_MS = Refresh.QUIET_MS; } catch (e) {}
    try { Refresh.watchVersion(); } catch (e) {}
    try { Refresh.errors(); } catch (e) {}
    (async () => { try { if (window.__FLOW_ALL_READY) await window.__FLOW_ALL_READY; } catch (e) {} await new Promise((r) => setTimeout(r, 800)); Refresh.diag().catch(() => {}); })();
    const ind = Refresh.indicator();
    /* A finger: pull down from the top. The page does not bounce while the
       pull is being measured, so the gesture reads as one thing. */
    let y0 = null, pulling = false;
    document.addEventListener('touchstart', (e) => {
      if (Refresh.busy || !Refresh.atTop() || e.touches.length !== 1) { y0 = null; return; }
      /* A finger on an open sheet is moving the sheet, not the page under it. */
      if (SheetDrag.overlayOpen()) { y0 = null; return; }
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
    const foot = document.getElementById('healthFoot');
    if (foot) {
      /* Each figure with the day it is from — see healthLine on the host. */
      let line = '';
      try { line = typeof healthLine === 'function' ? healthLine(h.days) : ''; } catch (e) {}
      foot.textContent = h.days.length + ' day' + (h.days.length === 1 ? '' : 's') + ' on record' +
        (line ? ' · ' + line : '') +
        (h.updated ? ' · read on your iPhone ' + new Date(h.updated).toLocaleString('en-GB') : '') +
        (h.partial ? ' · that read was cut short; earlier figures kept' : '');
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

/* ── Last night, from Apple Health ───────────────────────────────────────
 * The panel used to say how many days were on record and, in a footnote,
 * the newest sleep figure. What somebody opens it for is one question — how
 * did I sleep last night — so that is now the first thing in it: hours
 * asleep, when it started and ended, the stages if a watch or ring recorded
 * them, and how it compares with the week before.
 *
 * The iPhone only reads Health when The Flow is opened or comes back to the
 * front. An app left in the background used to sit on yesterday's read all
 * morning, so coming back after twenty minutes away reads again.
 * ====================================================================== */
const HealthNight = {
  STALE_MS: 20 * 60 * 1000,
  STAGES: [['deep', 'Deep'], ['core', 'Core'], ['rem', 'REM'], ['awake', 'Awake']],

  days() {
    try {
      const v = (typeof healthData !== 'undefined' && healthData && Array.isArray(healthData.days)) ? healthData : S.get('health', null);
      return v && Array.isArray(v.days) ? v.days : [];
    } catch (e) { return []; }
  },
  iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
  hm(h) { const m = Math.round(h * 60); return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; },
  clock(s) { try { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } },

  /* The newest night with a sleep total, and what to call it. */
  night(days) {
    const list = (days || []).filter(d => d && d.date && d.hours != null).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return null;
    const n = list[list.length - 1];
    const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    const fresh = n.date === HealthNight.iso(now);
    const before = list.filter(d => d.date < n.date).slice(-7);
    const avg = before.length >= 3 ? before.reduce((a, d) => a + Number(d.hours), 0) / before.length : null;
    let label;
    if (fresh) label = 'Last night';
    else if (n.date === HealthNight.iso(y)) label = 'The night before last';
    else { const d = parseISO(n.date); label = 'Night to ' + DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
    return { n, fresh, avg, label };
  },

  html(days, native) {
    const x = HealthNight.night(days);
    if (!x) return '';
    const n = x.n;
    const bed = n.bedAt ? HealthNight.clock(n.bedAt) : '', wake = n.sleepAt ? HealthNight.clock(n.sleepAt) : '';
    const stages = HealthNight.STAGES.map(([k, l]) => ({ k, l, m: Number(n[k + 'Min']) || 0 })).filter(s => s.m > 0);
    const total = stages.reduce((a, s) => a + s.m, 0);
    const diff = x.avg != null ? Math.round((Number(n.hours) - x.avg) * 60) : null;
    const extra = [];
    if (n.hrv != null) extra.push('HRV ' + n.hrv + ' ms');
    if (n.rhr != null) extra.push('resting HR ' + n.rhr);
    if (n.resp != null) extra.push('breathing ' + n.resp + '/min');
    return `<div class="hn-card${x.fresh ? '' : ' hn-old'}">
      <div class="hn-top">
        <div><div class="hn-lbl">${esc(x.label)}</div><div class="hn-big">${esc(HealthNight.hm(Number(n.hours)))} <small>asleep</small></div></div>
        ${bed && wake ? `<div class="hn-times"><b>${esc(bed)}</b><span>→</span><b>${esc(wake)}</b></div>` : (wake ? `<div class="hn-times"><span>woke</span><b>${esc(wake)}</b></div>` : '')}
      </div>
      ${total ? `<div class="hn-bar" role="img" aria-label="${esc(stages.map(s => s.l + ' ' + s.m + ' minutes').join(', '))}">${stages.map(s => `<i class="hn-${s.k}" style="width:${(s.m / total * 100).toFixed(1)}%"></i>`).join('')}</div>
        <div class="hn-legend">${stages.map(s => `<span><i class="hn-${s.k}"></i>${esc(s.l)} ${esc(HealthNight.hm(s.m / 60).replace(/^0h /, ''))}</span>`).join('')}</div>` : ''}
      <div class="hn-foot">${diff != null ? `<span class="${diff >= 0 ? 'hn-up' : 'hn-down'}">${diff >= 0 ? '+' : '−'}${esc(HealthNight.hm(Math.abs(diff) / 60).replace(/^0h /, ''))}</span> vs your 7-night average of ${esc(HealthNight.hm(x.avg))}` : ''}${diff != null && extra.length ? ' · ' : ''}${esc(extra.join(' · '))}</div>
      ${x.fresh ? '' : `<div class="hn-hint">${native ? 'Health has nothing for last night yet — a watch or ring may still be syncing.' : 'Last night is not in yet. Open The Flow on your iPhone after you wake up and it reads Health again.'}</div>`}
    </div>`;
  },

  paint() {
    const panel = document.getElementById('healthPanel');
    if (!panel) return;
    let box = document.getElementById('healthNight');
    const foot = document.getElementById('healthFoot');
    if (!box) {
      box = document.createElement('div');
      box.id = 'healthNight';
      if (foot) panel.insertBefore(box, foot); else panel.appendChild(box);
    }
    box.innerHTML = HealthNight.html(HealthNight.days(), HealthMirror.native());
  },

  /* Read again when the app comes back after a while — iPhone only. */
  maybeRead() {
    if (!HealthMirror.native() || document.visibilityState !== 'visible') return;
    const last = (typeof healthData !== 'undefined' && healthData && healthData.updated) ? Date.parse(healthData.updated) : 0;
    if (last && Date.now() - last < HealthNight.STALE_MS) return;
    if (HealthNight._reading) return;
    HealthNight._reading = true;
    Promise.resolve().then(() => (typeof window.syncHealth === 'function' ? window.syncHealth(true) : null))
      .catch(() => {}).then(() => { HealthNight._reading = false; HealthNight.paint(); });
  },

  boot() {
    try {
      const orig = window.syncHealth;
      if (typeof orig === 'function' && !orig.__flowNight) {
        const wrapped = async function () { try { await orig.apply(this, arguments); } finally { HealthNight.paint(); } };
        wrapped.__flowNight = 1;
        if (orig.__flowMirror) wrapped.__flowMirror = 1;
        window.syncHealth = wrapped;
      }
    } catch (e) {}
    document.addEventListener('visibilitychange', () => HealthNight.maybeRead());
    try {
      const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (App && typeof App.addListener === 'function') App.addListener('appStateChange', (s) => { if (s && s.isActive) HealthNight.maybeRead(); });
    } catch (e) {}
    HealthNight.paint();
  }
};
window.FlowHealthNight = HealthNight;

/* ── Today, the new look ──────────────────────────────────────────────────
 * Simple's Today screen: a greeting instead of a page title, the week as a
 * strip of days, one plain sentence about what is left to do, Big Rocks on a
 * solid colour card, and the numbers as bento tiles. The pieces added here
 * are small and read the same data the feed already shows. Every colour
 * theme has a Simple version (flow-pack.css, the --lk-* palettes); Advanced
 * hides these pieces and keeps the page as it was.
 *
 * The feed is redrawn whenever anything changes, so this re-adds its parts
 * after each redraw rather than holding on to nodes that no longer exist.
 * ====================================================================== */
const TodayLook = {
  /* Two interfaces, one switch. Advanced is the app as it has always been
     and stays the default. Simple is the new design. Both have every page
     and every function — Simple is how it looks and reads, never what it
     can do. The setting keeps its old name, newLook, so anyone who had the
     preview on lands in Simple. SIMPLE_HIDE stays as the one place to leave
     a page out of Simple's menu, should that ever be wanted again. */
  SIMPLE_HIDE: [],
  on() { try { return !!Settings.get('newLook'); } catch (e) { return false; } },
  hides() { return TodayLook.on() ? TodayLook.SIMPLE_HIDE.slice() : []; },
  applyLook() {
    const on = TodayLook.on();
    document.documentElement.setAttribute('data-flow-look', on ? 'new' : 'classic');
    try { Sections.apply(); } catch (e) {}
    try { SimpleSkin.sync(); } catch (e) {}
    try { Vocab.sync(); } catch (e) {}
    try { Theme.paintDots(); } catch (e) {}
    document.querySelectorAll('[data-fn-ui]').forEach((b) => {
      const mine = b.getAttribute('data-fn-ui') === (on ? 'simple' : 'advanced');
      b.classList.toggle('on', mine); b.setAttribute('aria-pressed', String(mine));
    });
    document.querySelectorAll('input[data-s="newLook"]').forEach((i) => { i.checked = on; });
    /* Switching to Simple while on a page it leaves out goes to Today. */
    try {
      const cur = document.querySelector('.tab.active[data-tab]');
      const t = cur && cur.getAttribute('data-tab');
      if (on && t && TodayLook.SIMPLE_HIDE.indexOf(t) >= 0) Nav.go('today');
    } catch (e) {}
    if (on) { try { TodayLook.paint(); } catch (e) {} }
  },
  async setSimple(v) {
    v = !!v;
    if (v === TodayLook.on()) return;
    await Settings.set('newLook', v);
    TodayLook.applyLook();
    try { toast(v ? 'Simple interface — the new design.' : 'Advanced interface — the classic design.', null, 1800); } catch (e) {}
  },
  name() {
    let n = '';
    try { n = (Auth && Auth.user && (Auth.user.name || '')) || ''; } catch (e) {}
    if (!n) { try { n = Settings.get('displayName') || ''; } catch (e) {} }
    return String(n).trim().split(/\s+/)[0] || '';
  },
  greeting(h) { return h < 5 ? 'Good night' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'; },
  wid(d) { try { return typeof weekId === 'function' ? weekId(d) : null; } catch (e) { return null; } },
  rocks() {
    try { const w = TodayLook.wid(new Date()); return (w && typeof cData !== 'undefined' && cData.rocks && cData.rocks[w]) || []; } catch (e) { return []; }
  },

  strip() {
    const now = new Date();
    const todayIdx = (now.getDay() + 6) % 7;            // 0 = Monday
    const mon = new Date(now); mon.setDate(now.getDate() - todayIdx);
    const busy = {};
    TodayLook.rocks().forEach((r) => { if (r && typeof r.day === 'number' && r.day >= 0) busy[r.day] = (busy[r.day] || 0) + (r.done ? 0 : 1); });
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon); d.setDate(mon.getDate() + i);
      const on = i === todayIdx;
      const sel = TodayLook.sel === i;
      html += `<button type="button" class="lk-day${on ? ' on' : ''}${sel ? ' sel' : ''}${i < todayIdx ? ' past' : ''}${busy[i] ? ' busy' : ''}" data-lk-day="${i}"${on ? ' aria-current="date"' : ''} aria-pressed="${sel}">
        <span>${esc(DOW[d.getDay()])}</span><b>${d.getDate()}</b><i${busy[i] ? '' : ' class="none"'}></i></button>`;
    }
    return html;
  },

  /* The card is headed "Today", so it counts today: the Big Rocks set for
     today that are still open, and the ones from earlier days that slipped.
     The rest of the week is a pill, not the headline — ten rocks across seven
     days is not ten things to do before tonight. */
  heroPick(rocks, t) {
    const open = rocks.filter((r) => r && !r.done);
    const byTime = (a, b) => (a.day - b.day) || String(a.time || '99:99').localeCompare(String(b.time || '99:99'));
    const today = open.filter((r) => r.day === t).sort(byTime);
    const late = open.filter((r) => typeof r.day === 'number' && r.day >= 0 && r.day < t).sort(byTime);
    const ahead = open.filter((r) => typeof r.day === 'number' && r.day > t).sort(byTime);
    const loose = open.filter((r) => !(typeof r.day === 'number' && r.day >= 0));
    const next = today[0] || late[0] || ahead[0] || loose[0] || null;
    const when = !next ? '' : next === today[0] ? (next.time ? 'Today ' + next.time : 'Today')
      : next === late[0] ? 'Overdue · ' + (DOW[(next.day + 1) % 7] || '')
      : next === ahead[0] ? (next.day === t + 1 ? 'Tomorrow' : (DOW[(next.day + 1) % 7] || '')) + (next.time ? ' ' + next.time : '')
      : 'No day set';
    return { open, today, late, doneToday: rocks.filter((r) => r && r.done && r.day === t).length, next, when };
  },
  heroTitle(feed, r) {
    if (!r) return '';
    const el = feed.querySelector('.td-rocks:not(#td-cal) .td-rock[data-rockid="' + String(r.id).replace(/["\\]/g, '') + '"] .rk-title');
    /* The title only: the text and inline links, not the note, the meeting
       it came from or any other line the row carries under it. */
    let t = '';
    if (el) {
      t = [...el.childNodes].map((n) => {
        if (n.nodeType === 3) return n.textContent;
        if (n.nodeType !== 1) return '';
        const d = getComputedStyle(n).display;
        return (d === 'inline' && !/note|chip|src|meet|time/.test(String(n.className))) ? n.textContent : '';
      }).join('').replace(/\s+/g, ' ').trim();
    }
    if (!t) t = String(r.title || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
    return t.length > 90 ? t.slice(0, 88).trim() + '…' : t;
  },
  hero(feed) {
    const rocks = TodayLook.rocks();
    const t = (new Date().getDay() + 6) % 7;
    const k = TodayLook.heroPick(rocks, t);
    const n = k.today.length, late = k.late.length;
    const lateEm = late ? '<em>' + late + ' overdue.</em>' : '';
    let line;
    if (!rocks.length) line = 'Nothing set for this week. <em>Pick your Big Rocks.</em>';
    else if (!k.open.length) line = 'All ' + rocks.length + ' Big Rocks done. <em>Good week.</em>';
    else if (n) line = n + ' Big Rock' + (n === 1 ? '' : 's') + ' for today' + (late ? ', ' + lateEm : '.');
    else if (late) line = 'Nothing left for today, ' + lateEm;
    else if (k.doneToday) line = 'Today\u2019s Big Rocks are done.';
    else line = 'Nothing due today.';
    const first = TodayLook.heroTitle(feed, k.next);
    const wkEl = feed.querySelector('.td-wk');
    const wk = wkEl ? wkEl.textContent.replace(/^.*WK\s*/i, '').trim() : '';
    const pct = rocks.length ? Math.round((rocks.length - k.open.length) / rocks.length * 100) : 0;
    const meetTile = document.querySelector('.flow-td-pulse [data-jump="meetings"] .v');
    const meets = meetTile && /^\d+$/.test(meetTile.textContent.trim()) ? +meetTile.textContent.trim() : 0;
    const rest = k.open.length - n - late;
    return `<div class="lk-k">Today</div><h2 class="lk-line">${line}</h2>${k.next && first ? `<div class="lk-next"><b>Next</b><span>${esc(first)}</span><small>${esc(k.when)}</small></div>` : ''}
      <div class="lk-pills">${wk ? `<span class="lk-pill hot">Week ${esc(wk)} · ${pct}%</span>` : ''}${rest > 0 ? `<span class="lk-pill">${rest} more this week</span>` : ''}${meets ? `<span class="lk-pill">${meets} meeting${meets === 1 ? '' : 's'}</span>` : ''}</div>
      ${rocks.length ? `<div class="lk-prog" role="progressbar" aria-label="Big Rocks done this week" aria-valuemin="0" aria-valuemax="${rocks.length}" aria-valuenow="${rocks.length - k.open.length}"><i style="width:${pct}%"></i></div>` : ''}`;
  },

  /* The review is not here: "Review week" is already in the row under the
     card, every day, and the same door twice is clutter. */
  actsHtml() {
    /* Overdue counts both kinds: Priorities from earlier this week, and
       Open loops past their day — the ones the old card listed in red. */
    let late = 0; try { late = Triage.count(); } catch (e) {}
    return (late ? '<button type="button" class="lk-act hot" data-lk-act="triage">Overdue · ' + late + '</button>' : '') +
      '<button type="button" class="lk-act" data-lk-act="replan">' + Nav.svg('refresh', 'lk-act-i') + 'My day changed</button>';
  },

  /* A day in the strip opens that day right here: its Big Rocks, ticked off
     or added to in place, and the way into the week. Tapping it again — or
     the × — closes it. */
  sel: null,
  dayDate(i) {
    const now = new Date(); const d = new Date(now); d.setDate(now.getDate() - ((now.getDay() + 6) % 7) + i); return d;
  },
  dayHtml(i) {
    const d = TodayLook.dayDate(i);
    const todayIdx = (new Date().getDay() + 6) % 7;
    const name = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const short = DOW[d.getDay()];
    const list = TodayLook.rocks().filter((r) => r && r.day === i)
      .sort((a, b) => (a.done - b.done) || String(a.time || '99').localeCompare(String(b.time || '99')));
    const open = list.filter((r) => !r.done).length;
    const rows = list.length ? list.map((r) => `<li class="lk-dv-row${r.done ? ' done' : ''}" data-rid="${esc(r.id)}">
        <button type="button" class="lk-dv-bx" data-dv="tick" data-dvid="${esc(r.id)}" aria-pressed="${!!r.done}" aria-label="${r.done ? 'Mark not done' : 'Mark done'}"></button>
        <span class="lk-dv-t">${esc(r.title)}${TodayLook.noteLine(r.note) ? `<small>${esc(TodayLook.noteLine(r.note))}</small>` : ''}</span>
        ${r.time ? `<span class="lk-dv-tm">${esc(r.time)}</span>` : ''}${RockActions.more(r.id, r.title)}</li>`).join('')
      : `<li class="lk-dv-empty">${i < todayIdx ? 'Nothing was planned for ' + esc(short) + '.' : 'Nothing on ' + esc(short) + ' yet.'}</li>`;
    return `<div class="lk-dv-head"><div><div class="lk-dv-k">${i === todayIdx ? 'Today' : i < todayIdx ? 'Earlier this week' : 'Coming up'}</div>
        <div class="lk-dv-n">${esc(name)}</div></div>
        <span class="lk-dv-c">${list.length ? open + ' open · ' + (list.length - open) + ' done' : 'free'}</span>
        <button type="button" class="lk-dv-x" data-dv="close" aria-label="Close">×</button></div>
      <ul class="lk-dv-list">${rows}</ul>
      <form class="lk-dv-add" data-dvday="${i}"><input type="text" maxlength="200" placeholder="Add a Big Rock to ${esc(short)}…" aria-label="Add a Big Rock to ${esc(name)}"><button type="submit">Add</button></form>
      <button type="button" class="lk-dv-week" data-dv="week">Open the whole week →</button>`;
  },
  /* The first line of a rock's note, without the link it may carry
     ("From Fathom: … — https://…") — a URL is noise in a list. */
  noteLine(note) {
    return String(note || '').split('\n')[0].replace(/https?:\/\/\S+/g, '').replace(/[\s—–-]+$/, '').replace(/^📝\s*/, '').trim().slice(0, 120);
  },
  dayAct(btn) {
    const what = btn.getAttribute('data-dv');
    if (what === 'close') { TodayLook.sel = null; TodayLook.paint(); return; }
    if (what === 'week') { try { Nav.go('compass'); } catch (e) {} return; }
    if (what === 'tick') {
      const r = TodayLook.rocks().find((x) => String(x.id) === btn.getAttribute('data-dvid'));
      if (!r) return;
      r.done = !r.done;
      try { cSave(); } catch (e) {}
      try { if (r.done && typeof J === 'function') J('planning', '🪨 Big rock done: ' + r.title); } catch (e) {}
      try { renderToday(); } catch (e) {}
      try { if (typeof renderCompass === 'function') renderCompass(); } catch (e) {}
      TodayLook.paint();
    }
  },
  /* Keys on a keyboard, in Simple: N adds, / searches, T goes to Today,
     1–7 open a day of the week, Esc closes it. Never while typing, never
     with a modifier held, so nothing the browser or a field owns is taken. */
  key(e) {
    if (!TodayLook.on() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const cap = document.getElementById('flow-capture');
    const capOpen = cap && cap.classList.contains('on');
    if (capOpen && !cap.classList.contains('note')) {
      const map = { n: 'note', t: 'quad', e: 'finance', s: 'training', h: 'habits', m: 'diet', l: 'sleep' };
      const id = map[e.key.toLowerCase()];
      const b = id && cap.querySelector('[data-fn-cap="' + id + '"]');
      if (b) { e.preventDefault(); b.click(); }
      return;
    }
    if (document.querySelector('.fn-sheetwrap.on, #flow-pal.on')) return;
    const k = e.key;
    if (k === 'n' || k === 'N') { e.preventDefault(); try { Nav.openCapture(); } catch (e2) {} return; }
    if (k === '/') { e.preventDefault(); try { Nav.openPalette(); } catch (e2) {} return; }
    if (k === 't' || k === 'T') { e.preventDefault(); try { Nav.go('today'); } catch (e2) {} return; }
    const onToday = !!document.querySelector('#tab-today.active');
    if (onToday && /^[1-7]$/.test(k)) {
      e.preventDefault();
      const i = +k - 1; TodayLook.sel = TodayLook.sel === i ? null : i; TodayLook.paint();
      const v = document.querySelector('.lk-dayview'); if (v && v.getBoundingClientRect().bottom > innerHeight) v.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (onToday && k === 'Escape' && TodayLook.sel != null) { TodayLook.sel = null; TodayLook.paint(); }
  },
  dayAdd(form) {
    const inp = form.querySelector('input');
    const title = String(inp.value || '').trim();
    if (!title) { inp.focus(); return; }
    const i = +form.getAttribute('data-dvday');
    const wid = TodayLook.wid(new Date());
    if (typeof addRock !== 'function' || !wid) { toast('Open the Week Compass once, then try again.', 'warn'); return; }
    const roles = (typeof cData !== 'undefined' && Array.isArray(cData.roles)) ? cData.roles : [];
    addRock(title.slice(0, 200), roles[0] || '', i, '', wid, { prio: 'med' });
    try { renderToday(); } catch (e) {}
    TodayLook.refocus = true;
    TodayLook.paint();
    toast('Added to ' + DOW[TodayLook.dayDate(i).getDay()] + '.', null, 1400);
  },

  paint() {
    const feed = document.getElementById('today-feed');
    if (!feed) return;
    const head = feed.querySelector('.td-head');
    if (!head) return;
    const left = head.firstElementChild;
    let hello = feed.querySelector('.lk-hello');
    if (!hello && left) {
      hello = document.createElement('div');
      hello.className = 'lk-hello';
      left.insertBefore(hello, left.firstChild);
    }
    if (hello) {
      const now = new Date(), nm = TodayLook.name();
      hello.innerHTML = `<div class="lk-date">${esc(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
        <div class="lk-greet">${esc(TodayLook.greeting(now.getHours()))}${nm ? ', ' + esc(nm) : ''}</div>`;
    }
    let strip = feed.querySelector('.lk-strip');
    if (!strip) { strip = document.createElement('div'); strip.className = 'lk-strip'; head.after(strip); }
    TodayLook.put(strip, TodayLook.strip());
    let dv = feed.querySelector('.lk-dayview');
    if (TodayLook.sel == null) { if (dv) dv.remove(); }
    else {
      const typed = dv ? (dv.querySelector('.lk-dv-add input') || {}).value || '' : '';
      const had = TodayLook.refocus || (dv && dv.contains(document.activeElement) && document.activeElement.tagName === 'INPUT');
      if (!dv) { dv = document.createElement('div'); dv.className = 'lk-dayview'; }
      if (dv.previousElementSibling !== strip) strip.after(dv);
      TodayLook.put(dv, TodayLook.dayHtml(TodayLook.sel));
      const inp = dv.querySelector('.lk-dv-add input');
      if (inp && !TodayLook.refocus) inp.value = typed;
      if (inp && had) inp.focus({ preventScroll: true });
      TodayLook.refocus = false;
    }
    /* The hero is one card: the sentence about the day, and along its foot
       the decisions that sentence calls for — the overdue list, a replan
       when the day changed. They live on the card, not loose under it, so
       the phone does not show a stray pill between the card and Plan today. */
    let hero = feed.querySelector('.lk-hero');
    if (!hero) {
      hero = document.createElement('div'); hero.className = 'lk-hero';
      hero.innerHTML = '<button type="button" class="lk-hero-main"></button><div class="lk-acts"></div>';
    }
    const above = (dv && dv.isConnected) ? dv : strip;
    if (hero.previousElementSibling !== above) above.after(hero);
    TodayLook.put(hero.querySelector('.lk-hero-main'), TodayLook.hero(feed));
    TodayLook.put(hero.querySelector('.lk-acts'), TodayLook.actsHtml());
    try { Meals.paint(); } catch (e) {}
    /* A tile with nothing in it reads as a quiet dash, not a headline. */
    feed.querySelectorAll('.flow-td-pulse .flow-td-tile').forEach((t) => {
      const v = t.querySelector('.v'); const empty = !!v && /^[—–-]?$/.test(v.textContent.trim());
      if (t.classList.contains('lk-empty') !== empty) t.classList.toggle('lk-empty', empty);
    });
  },
  /* Rewriting identical markup still costs a layout and drops focus and
     hover, and the feed's observer fires this often — so only write a part
     whose markup actually changed. */
  put(el, html) {
    if (el.__lkHtml === html) return false;
    el.__lkHtml = html; el.innerHTML = html; return true;
  },

  boot() {
    const feed = document.getElementById('today-feed');
    if (!feed) return;
    let queued = false;
    const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { TodayLook.paint(); } catch (e) { console.warn('[Flow] today look', e); } try { Ahead.paint(); } catch (e) {} try { RockActions.paint(); } catch (e) {} }); };
    new MutationObserver((muts) => {
      /* Only react to changes that are not our own. */
      if (muts.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n.nodeType !== 1 || (n.className && /\blk-/.test(String(n.className)))))) return;
      later();
    }).observe(feed, { childList: true, subtree: true });
    feed.addEventListener('click', (e) => {
      const day = e.target.closest('[data-lk-day]');
      if (day) {
        const i = +day.getAttribute('data-lk-day');
        TodayLook.sel = TodayLook.sel === i ? null : i;
        TodayLook.paint();
        const v = feed.querySelector('.lk-dayview');
        if (v && v.getBoundingClientRect().bottom > innerHeight) v.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      const dvb = e.target.closest('[data-dv]');
      if (dvb) { TodayLook.dayAct(dvb); return; }
      const st = e.target.closest('[data-stale-toggle]');
      if (st) { const body = st.nextElementSibling; if (body) { body.hidden = !body.hidden; st.setAttribute('aria-expanded', String(!body.hidden)); } return; }
      const act = e.target.closest('[data-lk-act]');
      if (act) {
        const a = act.getAttribute('data-lk-act');
        if (a === 'triage') Triage.open();
        else if (a === 'replan') Replan.open();
        else if (a === 'review') { try { TodayPlus.reviewSheet(); } catch (e2) {} }
        return;
      }
      if (e.target.closest('.lk-hero')) {
        const r = feed.querySelector('.td-rocks');
        if (!TodayLook.rocks().length) { try { Nav.go('compass'); } catch (e2) {} }
        else if (r && r.scrollIntoView) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    document.addEventListener('keydown', (e) => TodayLook.key(e));
    feed.addEventListener('submit', (e) => {
      const f = e.target.closest('.lk-dv-add');
      if (!f) return;
      e.preventDefault();
      TodayLook.dayAdd(f);
    });
    TodayLook.applyLook();
    TodayLook.paint();
    /* The greeting changes with the hour; the strip with the day. */
    setInterval(() => { if (document.visibilityState === 'visible') TodayLook.paint(); }, 5 * 60 * 1000);
  }
};
window.FlowTodayLook = TodayLook;

/* ── Simple: the same pages, without the decoration ─────────────────────
 * Every page in Simple is the page Advanced has — same markup, same
 * controls. Two things the stylesheet cannot do alone are done here:
 *
 *  - Emoji at the start of headings, labels and buttons ("💰 Finances",
 *    "📝 Notes for Today") are wrapped so Simple can hide them. A control
 *    that is only an emoji (✏️, the mood faces, the mic) is left alone, and
 *    the text itself is never changed, so Advanced looks exactly as before.
 *  - Long introductions under a page title fold to two lines; a tap opens
 *    them.
 *
 * New content is picked up as it arrives: one observer, batched to a frame,
 * looking only at the nodes that were added. */
const SimpleSkin = {
  SEL: 'h1,h2,h3,h4,h5,.section-header,.panel-title,.flow-td-head .l,.td-group-head .g-lbl,summary,label,button,.btn,a.flow-btn,.flow-btn,.td-rk-note,.flow-chip,.chip,.fn-txt,.tag,.pill,legend,th,.lbl,.g-lbl,.l',
  EMO: /^\s*(?:(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*\s*)+/u,
  on: false,
  obs: null,
  queue: new Set(),
  sync() {
    const want = TodayLook.on();
    if (want === SimpleSkin.on) return;
    SimpleSkin.on = want;
    if (!want) { if (SimpleSkin.obs) SimpleSkin.obs.disconnect(); SimpleSkin.obs = null; return; }
    SimpleSkin.clean(document.body);
    SimpleSkin.obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) SimpleSkin.queue.add(n);
      if (SimpleSkin.queue.size && !SimpleSkin.raf) SimpleSkin.raf = requestAnimationFrame(SimpleSkin.flush);
    });
    SimpleSkin.obs.observe(document.body, { childList: true, subtree: true });
  },
  flush() {
    SimpleSkin.raf = 0;
    const list = [...SimpleSkin.queue]; SimpleSkin.queue.clear();
    for (const n of list) if (n.isConnected && !(n.classList && n.classList.contains('lk-emo'))) SimpleSkin.clean(n);
  },
  clean(root) {
    const els = root.matches && root.matches(SimpleSkin.SEL) ? [root] : [];
    root.querySelectorAll && root.querySelectorAll(SimpleSkin.SEL).forEach((e) => els.push(e));
    for (const el of els) SimpleSkin.strip(el);
    root.querySelectorAll && root.querySelectorAll('.section-sub, .section > p.flow-sub, .flow-section > p.flow-sub, .flow-card > p.flow-sub, .panel > p.flow-sub').forEach((p) => {
      if (p.__lkIntro) return; p.__lkIntro = 1;
      if ((p.textContent || '').trim().length > 140) p.classList.add('lk-intro');
    });
  },
  strip(el) {
    if (el.__lkEmo || el.closest('.lk-emo, input, textarea, select, [contenteditable="true"], .lk-dayview, .eb-body')) return;
    /* the first piece of text, if it is the first thing in the element */
    let n = el.firstChild;
    while (n && ((n.nodeType === 3 && !n.textContent.trim()) || n.nodeType === 8)) n = n.nextSibling;
    if (!n || n.nodeType !== 3) return;
    const m = n.textContent.match(SimpleSkin.EMO);
    if (!m) return;
    const rest = (el.textContent || '').replace(m[0], '');
    if (!/\p{L}{2,}/u.test(rest)) return;          // an emoji-only control stays as it is
    el.__lkEmo = 1;
    const after = n.splitText(m[0].length);
    const span = document.createElement('span');
    span.className = 'lk-emo'; span.setAttribute('aria-hidden', 'true');
    n.parentNode.insertBefore(span, after);
    span.appendChild(n);
  },
  boot() {
    document.addEventListener('click', (e) => {
      const p = e.target.closest && e.target.closest('.lk-intro');
      if (p && TodayLook.on() && !e.target.closest('a,button')) p.classList.toggle('lk-open');
    });
    SimpleSkin.sync();
  }
};
window.FlowSimpleSkin = SimpleSkin;

/* ── Vocabulary: "Big Rocks" are "Priorities" in Simple ───────────────────
 * The method is Covey's; the word is what a new person understands at a
 * glance. Simple says Priorities everywhere the app speaks — labels,
 * buttons, placeholders, the assistant's lines — in English and in Turkish
 * (Öncelik, with its suffixes). Advanced keeps Big Rocks, exactly as it was.
 * Applied inside the language layer so it lands after translation, never on
 * a person's own titles or notes, and comes off again with the switch. */
const Vocab = {
  SKIP: '[data-i18n="off"], .rk-title, .td-meet-body, .jn-text, .fn-rocktitle',
  TR: { '': 'Öncelik', lar: 'Öncelikler', ı: 'Önceliği', a: 'Önceliğe', ın: 'Önceliğin', ta: 'Öncelikte', tan: 'Öncelikten', ları: 'Öncelikleri', lara: 'Önceliklere', larda: 'Önceliklerde', lardan: 'Önceliklerden', ların: 'Önceliklerin' },
  list() {
    return [
      /* The old quadrant list first, so its word is free for the week's few things. */
      { rx: /\bPriorities\b/g, to: 'Open loops' }, { rx: /Öncelikler(?![a-zçğıöşü])/g, to: 'Açık işler' }, { rx: /Complete priority:/g, to: 'Complete open loop:' },
      { rx: /\bBig Rocks\b/g, to: 'Priorities' }, { rx: /\bBig rocks\b/g, to: 'Priorities' }, { rx: /\bbig rocks\b/g, to: 'priorities' },
      { rx: /\bBig Rock\b/g, to: 'Priority' }, { rx: /\bBig rock\b/g, to: 'Priority' }, { rx: /\bbig rock\b/g, to: 'priority' },
      { rx: /Büyük [Tt]aş(lar)?(ı|a|ta|tan|ın|ları|lara|larda|lardan|ların)?(?![a-zçğıöşü])/g, to: (m, mid, suf) => Vocab.TR[(mid ? 'lar' : '') + (suf || '')] || 'Öncelik' },
      { rx: /Büyük [Kk]aya(lar)?(ı|ya|da|dan|nın|ları|lara|larda|lardan|ların)?(?![a-zçğıöşü])/g, to: (m, mid, suf) => Vocab.TR[(mid ? 'lar' : '') + ({ ya: 'a', da: 'ta', dan: 'tan', nın: 'ın' }[suf] || suf || '')] || 'Öncelik' }
    ];
  },
  sync() {
    try {
      if (typeof FlowI18n === 'undefined' || !FlowI18n.vocab) return;
      const want = TodayLook.on();
      if (want === !!FlowI18n.hasVocab()) return;
      FlowI18n.vocab(want ? Vocab.list() : null, Vocab.SKIP);
    } catch (e) { console.warn('[Flow] vocab', e); }
  }
};
window.FlowVocab = Vocab;

/* ── Flow Plus: the plan, and the one sheet that sells it ──────────────────
 * Free is the planner — everything a person types in, theirs for good. Plus
 * is the reading: Patterns every morning, Coming up's prep and reminders,
 * Ask, Direction, statements and briefs. The server decides who is on which
 * plan (flow-plus.js) and answers 402 with {plus:true} when a Free account
 * asks for a Plus feature; this is the only place the app turns that into
 * something to look at.
 *
 * Simple only. In Advanced nothing here is drawn: no card in Settings, no
 * sheet, no line under a card. A refusal there reads as the plain sentence
 * the server sent, exactly as any other error does. The owner, and every
 * account from before there was a price, are Plus for good and never see
 * any of this either. */
const Plus = {
  state: null,
  WHY: {
    patterns: ['Patterns every morning', 'One honest read of how your week is actually going, from everything in your record.'],
    ahead: ['Coming up, read for you', 'What to get ready before each thing on your calendar, and the reminders worth setting.'],
    ask: ['Ask, about your own record', 'Questions answered from your sleep, your money, your week — not from the internet.'],
    direction: ['Direction', 'Where the weeks are taking you, read from the record.'],
    'plan-week': ['The week, planned with you', 'A first draft of the week from your roles and what slipped.'],
    statement: ['Statements read into Finances', 'A bank statement becomes a month of categorised spending in one go.'],
    brief: ['Briefs before events', 'What you need to know before a meeting, from the mail and notes behind it.'],
    replan: ['My day changed — applied', 'The preview is free. Moving the Big Rocks that no longer fit, in one tap with undo, is Plus.'],
    voice: ['Say it, as much as you like', 'Fifteen spoken requests a week are free. Talking to The Flow without counting is Plus.'],
    meals: ['Meals from a photo', 'Three plates a week are free. Every meal, read into calories and protein the moment you photograph it, is Plus.']
  },
  HAS: ['Patterns every morning, with Direction', 'My day changed: a replan you approve', 'Coming up: prep lists and suggested reminders', 'Ask, answered from your own record', 'Statements read into Finances', 'Briefs before meetings and events', 'The week planned with you', 'Meals from a photo: calories and protein, logged'],
  async load() {
    try { if (typeof Auth === 'undefined' || !Auth.user || Auth.user.guest) return null; } catch (e) { return null; }
    try {
      const r = await fetch('/api/flow/plan', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      if (j && j.ok) Plus.state = j;
    } catch (e) {}
    return Plus.state;
  },
  tier() { return (Plus.state && Plus.state.tier) || 'plus'; },      /* unknown reads as Plus: never nag by mistake */
  free() { return Plus.tier() === 'free'; },
  simple() { try { return TodayLook.on(); } catch (e) { return false; } },
  /* A server reply. True when it was a Plus refusal. In Simple, and when the
     person asked for the thing themselves, the sheet opens; a refusal met
     while a card was loading on its own stays a quiet line in that card. */
  refused(j, opts) {
    if (!j || !j.plus) return false;
    if (Plus.simple() && opts && opts.open) Plus.open(j.feature);
    return true;
  },
  price(k) { return (Plus.state && Plus.state.prices && Plus.state.prices[k]) || (k === 'monthly' ? '$9.99' : '$79.99'); },
  trial() { return Plus.state && typeof Plus.state.trialDays === 'number' ? Plus.state.trialDays : 14; },
  line(feature) {
    if (!Plus.simple() || !Plus.free()) return '';
    const w = Plus.WHY[feature] || Plus.WHY.patterns;
    return '<p class="pt-wait plus-line"><b>' + esc(w[0]) + '</b> is part of Flow Plus. <button type="button" class="pt-link" data-plus-open="' + esc(feature) + '">See Plus</button></p>';
  },
  build() {
    if (Plus.el) return Plus.el;
    const wrap = document.createElement('div');
    wrap.id = 'flow-plus'; wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-plus="close"></div>' +
      '<div class="fn-sheet" role="dialog" aria-modal="true" aria-label="Flow Plus">' +
        '<div class="fn-grab" data-plus="close"></div>' +
        '<button type="button" class="fn-capture-close" data-plus="close" aria-label="Close">×</button>' +
        '<div class="plus-k">Flow Plus</div>' +
        '<h4 class="plus-h"></h4><p class="plus-why"></p>' +
        '<ul class="plus-has">' + Plus.HAS.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
        '<button type="button" class="flow-btn primary plus-buy" data-plus="yearly"></button>' +
        '<button type="button" class="flow-btn plus-buy" data-plus="monthly"></button>' +
        '<p class="plus-fine">Cancel any time. Everything you have typed in stays yours, Plus or not — and you can export it whenever you like.</p>' +
        '<button type="button" class="pt-link plus-later" data-plus="close">Not now</button>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-plus]'); if (!b) return;
      const a = b.getAttribute('data-plus');
      if (a === 'close') return Plus.close();
      if (a === 'yearly' || a === 'monthly') Plus.checkout(a);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) Plus.close(); });
    Plus.el = wrap;
    return wrap;
  },
  open(feature) {
    if (!Plus.simple()) return;
    const el = Plus.build();
    const w = Plus.WHY[feature] || ['Everything The Flow can read for you', 'Patterns, Coming up, Ask and the rest — every morning, from your own record.'];
    el.querySelector('.plus-h').textContent = w[0];
    el.querySelector('.plus-why').textContent = w[1];
    const t = Plus.trial();
    el.querySelector('[data-plus="yearly"]').innerHTML = (t ? 'Try ' + t + ' days free' : 'Plus for a year') + '<small>' + esc(Plus.price('yearly')) + ' a year after that · ' + (t ? 'cancel before it starts and pay nothing' : 'two months free against monthly') + '</small>';
    el.querySelector('[data-plus="monthly"]').innerHTML = esc(Plus.price('monthly')) + ' a month<small>No trial, no commitment</small>';
    el.classList.add('on');
    Track.hit('plus_sheet');
  },
  close() { if (Plus.el) Plus.el.classList.remove('on'); },
  async checkout(which) {
    if (Plus.state && !Plus.state.checkout) { toast('Subscriptions open soon — there is nothing to pay yet.'); return; }
    try {
      const r = await fetch('/api/flow/plan/checkout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: which, origin: location.origin }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503) { toast('Subscriptions open soon — there is nothing to pay yet.'); return; }
      if (!r.ok || !j.url) { toast(j.error || 'The checkout could not be opened.', 'warn'); return; }
      Track.hit('checkout_started');
      location.href = j.url;
    } catch (e) { toast('Could not reach the server. Try again in a moment.', 'warn'); }
  },
  async portal() {
    try {
      const r = await fetch('/api/flow/plan/portal', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: location.origin }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) { toast(j.error || 'The billing page could not be opened.', 'warn'); return; }
      location.href = j.url;
    } catch (e) { toast('Could not reach the server. Try again in a moment.', 'warn'); }
  },
  /* The card in Settings. Simple only; the caller checks. */
  settingsHtml() {
    const st = Plus.state;
    const s = (typeof Settings !== 'undefined' && Settings.data) || {};
    let status, act;
    if (!st) { status = 'Checking your plan…'; act = ''; }
    else if (st.tier === 'plus') {
      const until = st.until ? new Date(st.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      status = st.source === 'founder' ? 'Plus — the founder\'s account, for good.'
        : st.source === 'early' ? 'Plus — you were here before there was a price, so it is yours for good.'
        : (st.ends ? 'Plus until ' + until + ' — it will not renew.' : 'Plus' + (until ? ' · renews around ' + until : '') + '.');
      act = st.portal ? '<button type="button" class="flow-btn sm" data-plus-act="portal">Manage billing</button>' : (st.source === 'apple' || st.source === 'google' ? '<p class="flow-sub">Managed through the ' + (st.source === 'apple' ? 'App Store' : 'Play Store') + ' subscriptions on your phone.</p>' : '');
    } else {
      status = 'Free — the planner, all of it. ' + (st.lapsed ? 'Plus ended on ' + new Date(st.lapsed).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '.' : 'Plus adds the reading.');
      act = '<button type="button" class="flow-btn sm primary" data-plus-act="open">' + (Plus.trial() ? 'Try Plus free for ' + Plus.trial() + ' days' : 'See Plus') + '</button>';
    }
    return `
      <div class="flow-card" id="plusCard">
        <h3>✨ Flow Plus</h3>
        <p class="flow-sub plus-status" data-i18n="off">${esc(status)}</p>
        <div class="flow-row" style="margin-top:8px">${act}</div>
        <ul class="plus-has plus-has-sm">${Plus.HAS.map((x) => '<li>' + esc(x) + '</li>').join('')}</ul>
        <div class="flow-label" style="margin-top:16px">Your day</div>
        <p class="flow-sub">What “My day changed” plans inside: the working day, and the room it leaves between Big Rocks.</p>
        <div class="flow-row plus-day"><label>From <input class="flow-in" type="time" data-s="workStart" value="${esc(s.workStart || '09:00')}"></label><label>to <input class="flow-in" type="time" data-s="workEnd" value="${esc(s.workEnd || '18:00')}"></label><label>room <input class="flow-in" type="number" min="0" max="60" step="5" data-s="bufferMin" data-type="num" value="${esc(String(s.bufferMin == null ? 10 : s.bufferMin))}"> min</label></div>
        <div class="flow-label" style="margin-top:16px">Meals</div>
        <p class="flow-sub">A daily target for the Meals card on Today. Leave blank for totals only.</p>
        <div class="flow-row plus-day"><label><input class="flow-in" type="number" min="0" max="8000" step="50" data-s="mealKcal" data-type="num" value="${esc(String(s.mealKcal || ''))}" placeholder="2200"> kcal</label><label><input class="flow-in" type="number" min="0" max="500" step="5" data-s="mealProtein" data-type="num" value="${esc(String(s.mealProtein || ''))}" placeholder="120"> g protein</label></div>
        <div class="flow-label" style="margin-top:16px">Daily rhythm</div>
        <div class="flow-switch"><div class="t"><b>Evening check-in</b><span>One notification in the evening: how did today go? Tick what got done, move what did not.</span></div>
          <input type="checkbox" data-s="eveningCheck" data-type="bool" ${s.eveningCheck ? 'checked' : ''}></div>
        <div class="flow-row"><span class="flow-label">At</span><input class="flow-in" type="time" data-s="eveningCheckAt" value="${esc(s.eveningCheckAt || '21:00')}" style="max-width:130px"></div>
        <div class="flow-label" style="margin-top:16px">Your data</div>
        <p class="flow-sub">Everything you have put in, as one file. Free or Plus, it is yours.</p>
        <div class="flow-row"><a class="flow-btn sm" href="/api/flow/account/export" download="the-flow-export.json" data-plus-act="export">↓ Export everything</a></div>
      </div>`;
  },
  settingsWire(section) {
    const card = section.querySelector('#plusCard'); if (!card) return;
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-plus-act]'); if (!b) return;
      const a = b.getAttribute('data-plus-act');
      if (a === 'open') { e.preventDefault(); Plus.open(); }
      if (a === 'portal') { e.preventDefault(); Plus.portal(); }
    });
    if (!Plus.state) Plus.load().then(() => { const c = section.querySelector('#plusCard'); if (c && Plus.state) { const st = c.querySelector('.plus-status'); const tmp = document.createElement('div'); tmp.innerHTML = Plus.settingsHtml(); st.textContent = tmp.querySelector('.plus-status').textContent; c.querySelector('.flow-row').innerHTML = tmp.querySelector('.flow-row').innerHTML; } });
  },
  boot() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-plus-open]');
      if (b) { e.preventDefault(); Plus.open(b.getAttribute('data-plus-open')); }
    });
    try {
      const q = new URLSearchParams(location.search).get('plus');
      if (q === 'welcome') { toast('Welcome to Plus ✓ — the morning read starts tomorrow.', null, 4000); history.replaceState(null, '', location.pathname); }
      else if (q === 'later') history.replaceState(null, '', location.pathname);
    } catch (e) {}
    Plus.load().catch(() => {});
  }
};
window.FlowPlus = Plus;

/* ── The first run: roles, three Big Rocks, Today ───────────────────────────
 * A new account used to open onto a dashboard shaped by one person's life:
 * twelve sections, one of them named after his company. This asks two
 * questions and puts the person in Today with their own week in under two
 * minutes. Simple only, template accounts only (the server marks an account
 * that inherited an existing Flow as 'legacy' and it never sees this), once.
 * The example rocks the server seeds are taken out when the person writes
 * their own; "Skip" keeps them as the tour they were meant to be. */
const FirstRun = {
  KEY: 'flow:firstrun',
  SUGGEST: ['Work', 'Health & Body', 'Money', 'Family', 'Relationships', 'Learning', 'Side project', 'Something creative', 'Home'],
  EXAMPLES: { 'Work': 'Send the proposal to Mehmet by Thursday', 'Health & Body': 'Train three times this week', 'Money': 'Pay the October invoices by Friday', 'Family': 'One dinner together, phones away', 'Relationships': 'Call the friend I keep meaning to call', 'Learning': 'Finish chapter 3 of the course', 'Side project': 'Put the first version online', 'Something creative': 'Two hours on the new track', 'Home': 'Fix the thing I keep walking past' },
  EXAMPLES_TR: { 'Work': 'Teklifi perşembeye kadar Mehmet\'e gönder', 'Health & Body': 'Bu hafta üç antrenman', 'Money': 'Ekim faturalarını cumaya kadar öde', 'Family': 'Telefonsuz bir akşam yemeği', 'Relationships': 'Hep arayacağım dediğim arkadaşı ara', 'Learning': 'Kursun 3. bölümünü bitir', 'Side project': 'İlk sürümü yayına al', 'Something creative': 'Yeni parçaya iki saat', 'Home': 'Hep yanından geçtiğim şeyi tamir et' },
  /* An example in the language the app is showing, for a role the app knows;
     a role the person typed gets a general one. */
  example(role) {
    const tr = (typeof Lang !== 'undefined' && Lang.current === 'tr');
    const map = tr ? FirstRun.EXAMPLES_TR : FirstRun.EXAMPLES;
    return map[role] || (tr ? 'Bu hafta bitmesi gereken bir şey' : 'Something that must be finished this week');
  },
  async due() {
    try {
      if (typeof Auth === 'undefined' || !Auth.user || Auth.user.guest) return false;
      if (Auth.seed !== 'template') return false;
      if (window.__flowSkipFirstRun) return false;   /* the test replica, for suites about other things */
      if (!TodayLook.on()) return false;
      if (await DB.get(FirstRun.KEY, null)) return false;
      /* An account that already holds a week of its own — anything beyond
         the seeded examples — is not a first run, whatever the marker says. */
      const own = Object.keys((typeof cData !== 'undefined' && cData.rocks) || {}).some((w) => (cData.rocks[w] || []).some((r) => r && !/An example to get you started|Başlamak için bir örnek/.test(String(r.note || ''))));
      if (own) { try { await DB.set(FirstRun.KEY, { at: new Date().toISOString(), skipped: 'had a week' }); } catch (e) {} return false; }
      return true;
    } catch (e) { return false; }
  },
  roles() { try { return (Array.isArray(cData.roles) && cData.roles.length ? cData.roles : []).slice(); } catch (e) { return []; } },
  open() {
    if (document.getElementById('flow-fr')) return;
    const name = TodayLook.name();
    const have = FirstRun.roles();
    const all = []; have.concat(FirstRun.SUGGEST).forEach((r) => { if (all.indexOf(r) < 0) all.push(r); });
    const el = document.createElement('div');
    el.id = 'flow-fr'; el.className = 'flow-x';
    el.innerHTML =
      '<div class="fr-card" role="dialog" aria-modal="true" aria-labelledby="fr-h">' +
        '<div class="fr-step" data-step="1">' +
          '<div class="fr-k">The Flow</div>' +
          '<h2 id="fr-h" class="fr-h">' + (name ? 'Welcome, ' + esc(name) + '.' : 'Welcome.') + '</h2>' +
          '<p class="fr-sub">The Flow reads your life back to you. First, the parts of it you want to keep in view — your roles. Pick a few, or add your own.</p>' +
          '<div class="fr-chips">' + all.map((r) => '<button type="button" class="fr-chip' + (have.indexOf(r) >= 0 ? ' on' : '') + '" data-role="' + esc(r) + '" aria-pressed="' + (have.indexOf(r) >= 0) + '">' + esc(r) + '</button>').join('') + '</div>' +
          '<form class="fr-add"><input class="flow-in" maxlength="40" placeholder="Add a role of your own" aria-label="Add a role"><button type="submit" class="flow-btn sm">Add</button></form>' +
          '<div class="fr-row"><button type="button" class="pt-link" data-fr="skip">Skip for now</button><button type="button" class="flow-btn primary" data-fr="next">Continue</button></div>' +
        '</div>' +
        '<div class="fr-step" data-step="2" hidden>' +
          '<div class="fr-k">This week</div>' +
          '<h2 class="fr-h">Three Big Rocks.</h2>' +
          '<p class="fr-sub">Not a to-do list. The one, two or three things you would regret not finishing by Sunday — the kind that matter but get pushed aside by small urgent things.</p>' +
          '<ul class="fr-eg"><li>Specific: “Send the proposal to Mehmet”, not “work on sales”.</li><li>Finishable this week: something that can be ticked off by Sunday.</li><li>Yours: something you do, not something you wait for.</li></ul>' +
          '<p class="fr-sub">The grey text in each box is an example for that role. One is enough to start; the rest of the week fits around them.</p>' +
          '<div class="fr-rocks"></div>' +
          '<div class="fr-row"><button type="button" class="pt-link" data-fr="back">Back</button><button type="button" class="flow-btn primary" data-fr="done">Start my week</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    const chosen = () => [...el.querySelectorAll('.fr-chip.on')].map((b) => b.getAttribute('data-role'));
    el.addEventListener('click', (e) => {
      const chip = e.target.closest('.fr-chip');
      if (chip) { chip.classList.toggle('on'); chip.setAttribute('aria-pressed', chip.classList.contains('on')); return; }
      const b = e.target.closest('[data-fr]'); if (!b) return;
      const a = b.getAttribute('data-fr');
      if (a === 'skip') return FirstRun.finish(el, null, []);
      if (a === 'back') { el.querySelector('[data-step="2"]').hidden = true; el.querySelector('[data-step="1"]').hidden = false; return; }
      if (a === 'next') {
        const roles = chosen();
        if (!roles.length) { toast('Pick at least one role — or skip for now.', 'warn'); return; }
        const box = el.querySelector('.fr-rocks');
        box.innerHTML = [0, 1, 2].map((i) => {
          const role = roles[i % roles.length];
          const eg = FirstRun.example(role);
          return '<div class="fr-rock"><label class="fr-lbl">' + (i === 0 ? 'Priority 1 — the most important' : i === 1 ? 'Priority 2' : 'Priority 3 (optional)') + '</label><input class="flow-in" maxlength="200" placeholder="' + esc(eg) + '" aria-label="Big Rock ' + (i + 1) + '">' +
            '<select class="flow-in" aria-label="Role for Big Rock ' + (i + 1) + '">' + roles.map((r) => '<option' + (r === role ? ' selected' : '') + '>' + esc(r) + '</option>').join('') + '</select></div>';
        }).join('');
        el.querySelector('[data-step="1"]').hidden = true; el.querySelector('[data-step="2"]').hidden = false;
        setTimeout(() => { const i = box.querySelector('input'); if (i) i.focus(); }, 80);
        return;
      }
      if (a === 'done') {
        const rocks = [...el.querySelectorAll('.fr-rock')].map((r) => ({ title: r.querySelector('input').value.replace(/\s+/g, ' ').trim(), role: r.querySelector('select').value })).filter((r) => r.title);
        if (!rocks.length) { toast('Write one Big Rock to start — or go back and skip.', 'warn'); return; }
        FirstRun.finish(el, chosen(), rocks);
      }
    });
    el.querySelector('.fr-add').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = e.target.querySelector('input'); const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!v) return;
      if (![...el.querySelectorAll('.fr-chip')].some((c) => c.getAttribute('data-role').toLowerCase() === v.toLowerCase())) {
        el.querySelector('.fr-chips').insertAdjacentHTML('beforeend', '<button type="button" class="fr-chip on" data-role="' + esc(v) + '" aria-pressed="true">' + esc(v) + '</button>');
      }
      inp.value = '';
    });
  },
  async finish(el, roles, rocks) {
    try {
      if (roles && roles.length) { cData.roles = roles; }
      if (rocks && rocks.length) {
        const wid = weekId(new Date()), t = (new Date().getDay() + 6) % 7;
        /* The seeded examples make way for the real thing. */
        Object.keys(cData.rocks || {}).forEach((w) => { cData.rocks[w] = (cData.rocks[w] || []).filter((r) => !/An example to get you started|Başlamak için bir örnek/.test(String(r.note || ''))); });
        rocks.forEach((r, i) => addRock(r.title, r.role, Math.min(6, t + i), '', wid, { prio: i === 0 ? 'high' : 'med' }));
      }
      if (roles && roles.length) { cSave(); try { renderCompass(); } catch (e) {} }
      try { renderToday(); } catch (e) {}
    } catch (e) { console.warn('[Flow] first run', e); }
    try { await DB.set(FirstRun.KEY, { at: new Date().toISOString(), roles: (roles || []).length, rocks: (rocks || []).length }); } catch (e) {}
    el.remove();
    try { Nav.go('today'); } catch (e) {}
    Track.hit('first_run_done'); if (rocks && rocks.length) Track.hit('rock_added');
    if (rocks && rocks.length) toast('Your week is set. Patterns arrives after a few days of use.', null, 4000);
  },
  async boot() {
    if (!(await FirstRun.due())) return;
    setTimeout(() => { try { FirstRun.open(); } catch (e) { console.warn('[Flow] first run', e); } }, 400);
  }
};
window.FlowFirstRun = FirstRun;
window.FlowAuthState = Auth;   /* read by tests; not a way in */

/* ── Track: what people do, never what they wrote ─────────────────────────
 * A dozen named moments — the first run finished, a Big Rock added, a
 * replan accepted, a review completed, the Plus sheet opened — counted on
 * the server per day, per account, with no title, note or number attached.
 * The owner reads them back as counts. This is what tells whether people
 * come back and plan, which is the only question the growth plan asks. */
const Track = {
  EVENTS: ['app_open', 'first_run_done', 'rock_added', 'rock_done', 'replan_preview', 'replan_accepted', 'replan_undone', 'triage_done', 'review_completed', 'plus_sheet', 'checkout_started', 'share_read', 'evening_on', 'meal_logged', 'habit_done_here'],
  sent: new Set(),
  hit(ev) {
    try {
      if (Track.EVENTS.indexOf(ev) < 0) return;
      if (typeof Auth === 'undefined' || !Auth.user || Auth.user.guest) return;
      const day = new Date().toISOString().slice(0, 10);
      const k = ev + ':' + day;
      if (Track.sent.has(k)) return;          /* once a day per device is enough for a count of people */
      Track.sent.add(k);
      fetch('/api/flow/track', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e: ev, look: TodayLook.on() ? 's' : 'a' }) }).catch(() => {});
    } catch (e) {}
  },
  boot() { Track.hit('app_open'); }
};
window.FlowTrack = Track;

/* ── My day changed: a replan you approve ───────────────────────────────────
 * The day had a shape in the morning; a meeting ran over, something landed,
 * and now the open Big Rocks do not fit in what is left. This works out what
 * does fit — fixed events first, then the rocks by time and priority, each
 * with its length and a little room between — and proposes which ones move
 * to the next day with room. Nothing moves until the person says so; a
 * rock can be kept today (and something else moves instead), the lengths
 * can be changed, and the whole thing undoes in one tap. No model is asked:
 * it is arithmetic over the record, which is why it works offline and why
 * the preview is free. Applying it is Plus. Simple only. */
const Replan = {
  el: null, rows: [], keep: new Set(),
  hm(m) { const h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'; },
  mins(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; },
  prefs() {
    const s = (typeof Settings !== 'undefined' && Settings.data) || {};
    return { start: Replan.mins(s.workStart) ?? 9 * 60, end: Replan.mins(s.workEnd) ?? 18 * 60, buffer: Math.max(0, +s.bufferMin || 10), dur: Math.max(10, +s.defaultDurationMin || 60) };
  },
  duration(r) {
    if (r.time && r.end) { const a = Replan.mins(r.time), b = Replan.mins(r.end); if (a != null && b != null && b > a) return b - a; }
    return Replan.prefs().dur;
  },
  /* Minutes of calendar still ahead today, inside the working day. */
  eventsAhead(now, end) {
    let m = 0;
    try {
      const today = RockActions.iso(new Date());
      (Ahead.cal || []).forEach((e) => {
        if (e.allDay) return;
        const s0 = Date.parse(e.start), e0 = Date.parse(e.end); if (isNaN(s0) || isNaN(e0)) return;
        if (RockActions.iso(new Date(s0)) !== today) return;
        const d = new Date(s0); const sm = Math.max(now, d.getHours() * 60 + d.getMinutes()); const em = Math.min(end, sm + (e0 - s0) / 6e4);
        if (em > sm) m += em - sm;
      });
    } catch (e) {}
    return Math.round(m);
  },
  /* The arithmetic, with nothing drawn: a pure function the tests can call. */
  compute(opts) {
    opts = opts || {};
    const now = opts.now != null ? opts.now : (new Date().getHours() * 60 + new Date().getMinutes());
    const P = Object.assign(Replan.prefs(), opts.prefs || {});
    const from = Math.max(now, P.start);
    const events = opts.events != null ? opts.events : Replan.eventsAhead(from, P.end);
    const left = Math.max(0, P.end - from - events);
    const rocks = (opts.rocks || Replan.todayRocks()).map((r) => Object.assign({ dur: Replan.duration(r) }, r, opts.durs && opts.durs[r.id] ? { dur: opts.durs[r.id] } : {}));
    const rank = { high: 0, med: 1, low: 2 };
    rocks.sort((a, b) => (a.late === b.late ? 0 : a.late ? 1 : -1) || ((rank[a.prio] ?? 1) - (rank[b.prio] ?? 1)) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')));
    const keep = opts.keep || new Set();
    let used = 0; const fits = [], moves = [];
    /* kept ones first, then the rest in order */
    [...rocks.filter((r) => keep.has(String(r.id))), ...rocks.filter((r) => !keep.has(String(r.id)))].forEach((r) => {
      const need = r.dur + (fits.length ? P.buffer : 0);
      if (keep.has(String(r.id)) || used + need <= left) { fits.push(r); used += need; } else moves.push(r);
    });
    /* How far the whole day overruns: everything, kept or not, against
       the time left — not just what was squeezed in (that is never over). */
    const need = rocks.reduce((a, r, i) => a + r.dur + (i ? P.buffer : 0), 0);
    const over = Math.max(0, need - left);
    return { now, left, events, rocks, fits, moves, used, need, over, prefs: P };
  },
  todayRocks() {
    try {
      const k = TodayLook.heroPick(TodayLook.rocks(), (new Date().getDay() + 6) % 7);
      return k.today.map((r) => Object.assign({ late: false }, r)).concat(k.late.map((r) => Object.assign({ late: true }, r)));
    } catch (e) { return []; }
  },
  /* The next day with the fewest open Big Rocks, inside the next seven. */
  landing(skip) {
    const t = (new Date().getDay() + 6) % 7;
    let best = null;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i);
      const dow = (d.getDay() + 6) % 7; if (dow >= 5 && i < 6) continue;         /* not a weekend, unless there is nothing else */
      let n = 0; try { n = ((cData.rocks[weekId(d)] || []).filter((r) => r && !r.done && r.day === dow)).length; } catch (e) {}
      n += (skip || 0);
      if (!best || n < best.n) best = { d, n };
      if (n === 0) break;
    }
    return best ? best.d : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })();
  },
  build() {
    if (Replan.el) return Replan.el;
    const wrap = document.createElement('div');
    wrap.id = 'flow-replan'; wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-rp="close"></div>' +
      '<div class="fn-sheet" role="dialog" aria-modal="true" aria-label="My day changed">' +
        '<div class="fn-grab" data-rp="close"></div>' +
        '<button type="button" class="fn-capture-close" data-rp="close" aria-label="Close">×</button>' +
        '<h4>My day changed</h4><div class="fn-sub rp-sub"></div>' +
        '<div class="rp-body"></div>' +
        '<div class="ra-row ra-end rp-acts"><button type="button" class="flow-btn" data-rp="close">Not now</button><button type="button" class="flow-btn primary" data-rp="accept">Move them</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rp]'); if (!b) return;
      const a = b.getAttribute('data-rp');
      if (a === 'close') return Replan.close();
      if (a === 'keep') { const id = b.getAttribute('data-id'); if (Replan.keep.has(id)) Replan.keep.delete(id); else Replan.keep.add(id); Replan.paint(); return; }
      if (a === 'accept') return Replan.accept();
    });
    wrap.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-rp-dur]'); if (!inp) return;
      const v = Math.max(5, Math.min(600, parseInt(inp.value, 10) || 0)); Replan.durs[inp.getAttribute('data-rp-dur')] = v; Replan.paint();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) Replan.close(); });
    Replan.el = wrap;
    return wrap;
  },
  durs: {},
  open() {
    if (!Plus.simple()) return;
    Replan.build(); Replan.keep = new Set(); Replan.durs = {};
    Replan.paint();
    Replan.el.classList.add('on');
    Track.hit('replan_preview');
  },
  close() { if (Replan.el) Replan.el.classList.remove('on'); },
  paint() {
    const el = Replan.el; if (!el) return;
    const c = Replan.compute({ keep: Replan.keep, durs: Replan.durs });
    Replan.last = c;
    const land = Replan.landing(c.moves.length);
    const landL = RockActions.label(land);
    const endH = Math.floor(c.prefs.end / 60), endM = String(c.prefs.end % 60).padStart(2, '0');
    el.querySelector('.rp-sub').textContent = c.rocks.length
      ? Replan.hm(c.left) + ' left until ' + endH + ':' + endM + (c.events ? ', after ' + Replan.hm(c.events) + ' of meetings' : '') + '. ' + c.rocks.length + ' Big Rock' + (c.rocks.length === 1 ? '' : 's') + ' need' + (c.rocks.length === 1 ? 's' : '') + ' about ' + Replan.hm(c.rocks.reduce((a, r) => a + r.dur, 0)) + '.'
      : 'Nothing open today. The day is yours.';
    const row = (r, moving) => '<div class="rp-row' + (moving ? ' mv' : '') + '">' +
      '<span class="rp-t">' + esc(r.title) + (r.late ? '<small>overdue</small>' : r.time ? '<small>' + esc(r.time) + '</small>' : '') + '</span>' +
      '<label class="rp-dur"><input type="number" min="5" max="600" step="5" value="' + r.dur + '" data-rp-dur="' + esc(String(r.id)) + '" aria-label="Minutes for ' + esc(r.title) + '"><span>min</span></label>' +
      '<button type="button" class="rp-keep' + (Replan.keep.has(String(r.id)) ? ' on' : '') + '" data-rp="keep" data-id="' + esc(String(r.id)) + '" aria-pressed="' + Replan.keep.has(String(r.id)) + '">' + (moving ? 'Keep today' : (Replan.keep.has(String(r.id)) ? 'Kept' : 'Keep')) + '</button>' +
      '</div>';
    el.querySelector('.rp-body').innerHTML =
      (c.fits.length ? '<div class="ra-k">Fits today</div>' + c.fits.map((r) => row(r, false)).join('') : '') +
      (c.moves.length ? '<div class="ra-k">Moves to ' + esc(landL) + '<small>' + Replan.hm(c.over) + ' more than the day has' + (Replan.keep.size ? ' · kept ones stay' : '') + '</small></div>' + c.moves.map((r) => row(r, true)).join('') : (c.rocks.length ? '<p class="rp-ok">Everything fits. Nothing needs to move.</p>' : '')) +
      (c.moves.length && Plus.free() ? Plus.line('replan') : '');
    const acc = el.querySelector('[data-rp="accept"]');
    acc.hidden = !c.moves.length;
    acc.textContent = c.moves.length ? 'Move ' + c.moves.length + ' to ' + landL : 'Move them';
    Replan.land = land;
  },
  async accept() {
    const c = Replan.last; if (!c || !c.moves.length) return Replan.close();
    if (Plus.free()) { Plus.open('replan'); return; }
    const before = c.moves.map((r) => { const h = RockActions.find(r.id); return h ? { id: r.id, w: h.w, day: h.r.day } : null; }).filter(Boolean);
    c.moves.forEach((r) => {
      const h = RockActions.find(r.id); if (!h) return;
      const to = weekId(Replan.land), day = (Replan.land.getDay() + 6) % 7;
      cData.rocks[h.w].splice(h.i, 1);
      if (!cData.rocks[to]) cData.rocks[to] = [];
      h.r.day = day; h.r.done = false; h.r.moved = (h.r.moved || 0) + 1;
      cData.rocks[to].push(h.r);
    });
    RockActions.save('➡️ Day replanned: ' + c.moves.length + ' Big Rock' + (c.moves.length === 1 ? '' : 's') + ' moved to ' + RockActions.label(Replan.land));
    Track.hit('replan_accepted');
    Replan.close();
    RockActions.undo('Moved ' + c.moves.length + ' to ' + RockActions.label(Replan.land), () => {
      before.forEach((b) => {
        const h = RockActions.find(b.id); if (!h) return;
        cData.rocks[h.w].splice(h.i, 1);
        if (!cData.rocks[b.w]) cData.rocks[b.w] = [];
        h.r.day = b.day; h.r.moved = Math.max(0, (h.r.moved || 1) - 1); cData.rocks[b.w].push(h.r);
      });
      RockActions.save('');
      Track.hit('replan_undone');
    });
  }
};
window.FlowReplan = Replan;

/* ── Overdue: a count you can deal with, not a wall of red ──────────────────
 * Big Rocks from earlier days of the week that are still open. One sheet
 * lists them, and each has the four honest answers: done, today, tomorrow,
 * or let it go. Simple only. */
const Triage = {
  el: null,
  late() { try { return TodayLook.heroPick(TodayLook.rocks(), (new Date().getDay() + 6) % 7).late; } catch (e) { return []; } },
  /* Open loops past their day: dated tasks from the Planner, still open. */
  loops() { try { return TodayPlus.priorities().overdue.filter((r) => r && r.key); } catch (e) { return []; } },
  count() { return Triage.late().length + Triage.loops().length; },
  build() {
    if (Triage.el) return Triage.el;
    const wrap = document.createElement('div');
    wrap.id = 'flow-triage'; wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-tg="close"></div>' +
      '<div class="fn-sheet" role="dialog" aria-modal="true" aria-label="Overdue">' +
        '<div class="fn-grab" data-tg="close"></div>' +
        '<button type="button" class="fn-capture-close" data-tg="close" aria-label="Close">×</button>' +
        '<h4>Overdue</h4><div class="fn-sub tg-sub"></div>' +
        '<div class="tg-body"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tg]'); if (!b) return;
      const a = b.getAttribute('data-tg'), id = b.getAttribute('data-id');
      if (a === 'close') return Triage.close();
      const t = new Date(); t.setHours(12, 0, 0, 0);
      const key = b.getAttribute('data-key');
      if (key) {
        /* an Open loop: the record keeps its place in the Planner; only its day, or its done, changes */
        const rec = Schedule.get(key); if (!rec) return;
        if (a === 'ldone') { Schedule.put(key, { done: true }); try { J('planning', '✅ Done: ' + rec.text); } catch (e2) {} }
        else if (a === 'ltoday') Schedule.put(key, { date: RockActions.iso(t) });
        else if (a === 'ltomorrow') { t.setDate(t.getDate() + 1); Schedule.put(key, { date: RockActions.iso(t) }); }
        try { Schedule.saveNow(); } catch (e2) {}
        try { renderToday(); } catch (e2) {}
        try { TodayLook.paint(); } catch (e2) {}
        Track.hit('triage_done');
        Triage.paint();
        return;
      }
      if (a === 'done') { const h = RockActions.find(id); if (h) { h.r.done = true; RockActions.save('✅ Big rock done: ' + h.r.title); } }
      else if (a === 'today') RockActions.move(id, t);
      else if (a === 'tomorrow') { t.setDate(t.getDate() + 1); RockActions.move(id, t); }
      else if (a === 'drop') RockActions.setAside(id, 'dropped');
      Track.hit('triage_done');
      Triage.paint();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) Triage.close(); });
    Triage.el = wrap;
    return wrap;
  },
  open() { if (!Plus.simple()) return; Triage.build(); Triage.paint(); Triage.el.classList.add('on'); },
  close() { if (Triage.el) Triage.el.classList.remove('on'); },
  paint() {
    const el = Triage.el; if (!el) return;
    const late = Triage.late(), loops = Triage.loops();
    const n = late.length + loops.length;
    el.querySelector('.tg-sub').textContent = n
      ? (late.length ? late.length + ' Big Rock' + (late.length === 1 ? '' : 's') + ' from earlier this week' : '') + (late.length && loops.length ? ', ' : '') + (loops.length ? loops.length + ' Open loop' + (loops.length === 1 ? '' : 's') + ' past ' + (loops.length === 1 ? 'its' : 'their') + ' day' : '') + ', still open. Each one: done, today, tomorrow' + (late.length ? ', or let it go' : '') + '.'
      : 'Nothing overdue. Clear week.';
    const ago = (iso) => { const d = RockActions.fromIso(iso); return d ? RockActions.label(d) : ''; };
    el.querySelector('.tg-body').innerHTML =
      (late.length && loops.length ? '<div class="ra-k">Priorities</div>' : '') +
      late.map((r) => '<div class="tg-row"><span class="tg-t">' + esc(r.title) + '<small>' + esc(DOW[(r.day + 1) % 7] || '') + (r.time ? ' ' + esc(r.time) : '') + '</small></span>' +
      '<div class="tg-acts"><button type="button" class="flow-btn sm" data-tg="done" data-id="' + esc(String(r.id)) + '">Done</button><button type="button" class="flow-btn sm" data-tg="today" data-id="' + esc(String(r.id)) + '">Today</button><button type="button" class="flow-btn sm" data-tg="tomorrow" data-id="' + esc(String(r.id)) + '">Tomorrow</button><button type="button" class="flow-btn sm ra-drop" data-tg="drop" data-id="' + esc(String(r.id)) + '">Drop</button></div></div>').join('') +
      (loops.length ? (late.length ? '<div class="ra-k">Open loops</div>' : '') + loops.map((r) => '<div class="tg-row tg-loop"><span class="tg-t" data-i18n="off">' + esc(String(r.text || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')) + '<small>' + esc(ago(r.date)) + (r.time ? ' ' + esc(r.time) : '') + '</small></span>' +
      '<div class="tg-acts"><button type="button" class="flow-btn sm" data-tg="ldone" data-key="' + esc(String(r.key)) + '">Done</button><button type="button" class="flow-btn sm" data-tg="ltoday" data-key="' + esc(String(r.key)) + '">Today</button><button type="button" class="flow-btn sm" data-tg="ltomorrow" data-key="' + esc(String(r.key)) + '">Tomorrow</button></div></div>').join('') : '');
    if (!n) setTimeout(() => Triage.close(), 900);
  }
};
window.FlowTriage = Triage;

/* ── The week, reviewed with evidence ───────────────────────────────────────
 * Under the scorecard of the existing Review week sheet, in Simple only:
 * what happened (planned, done, moved, dropped, handed off), the one thing
 * that kept being carried over, one to three commitments for next week —
 * typed here, landing on the Week Compass — and one line about the week,
 * kept with the record. Nothing is scored; the counts are the counts. */
const ReviewPlus = {
  KEY: 'flow:reviews',
  counts(wid) {
    const list = (cData.rocks && cData.rocks[wid]) || [];
    const aside = RockActions.aside().filter((a) => a.wid === wid && !a.ext);
    const moved = list.filter((r) => r && (r.moved || 0) > 0);
    const most = list.filter((r) => r && !r.done && (r.moved || 0) >= 2).sort((a, b) => (b.moved || 0) - (a.moved || 0))[0] || null;
    return { planned: list.length + aside.length, done: list.filter((r) => r && r.done).length, open: list.filter((r) => r && !r.done).length, moved: moved.length, dropped: aside.filter((a) => a.status === 'dropped').length, delegated: aside.filter((a) => a.status === 'delegated').length, most };
  },
  html(wid) {
    const c = ReviewPlus.counts(wid);
    const cell = (n, l) => '<div class="rv-c"><b>' + n + '</b><span>' + l + '</span></div>';
    return '<div class="rv-ev">' +
      '<div class="ra-k">What happened</div>' +
      '<div class="rv-cells">' + cell(c.planned, 'planned') + cell(c.done, 'done') + cell(c.moved, 'moved') + cell(c.dropped, 'dropped') + cell(c.delegated, 'handed off') + '</div>' +
      (c.most ? '<p class="rv-note"><b>' + esc(c.most.title) + '</b> moved ' + c.most.moved + ' times and is still open. Smaller, or not this week?</p>' : (c.open ? '<p class="rv-note">' + c.open + ' still open. The Overdue list on Today sorts them one by one.</p>' : '')) +
      ReviewPlus.sawHtml(wid) +
      '<div class="ra-k">Next week, one to three</div>' +
      '<form class="rv-next">' + [0, 1, 2].map((i) => '<input class="flow-in" maxlength="200" placeholder="' + (i === 0 ? 'The one thing that would make next week count' : 'Optional') + '" aria-label="Big Rock for next week ' + (i + 1) + '">').join('') +
        '<label class="flow-label" for="rv-line">One line about this week</label><textarea class="flow-in" id="rv-line" rows="2" maxlength="500" placeholder="Optional. Kept with the record, never shared."></textarea>' +
        '<div class="ra-row ra-end"><button type="submit" class="flow-btn primary">Set next week</button></div></form>' +
    '</div>';
  },
  /* Sharpen the Blade is a weekly list, so in Simple it is asked here, once
     a week, instead of sitting on Today every day: eight ticks for the week. */
  saw(wid) {
    try {
      if (typeof sawActive !== 'function' || typeof cData === 'undefined') return null;
      if (!cData.saw) cData.saw = {}; if (!cData.saw[wid]) cData.saw[wid] = {};
      return { on: sawActive(), done: cData.saw[wid] };
    } catch (e) { return null; }
  },
  sawHtml(wid) {
    const s = ReviewPlus.saw(wid);
    if (!s || !s.on.length) return '';
    const n = s.on.filter(([k]) => s.done[k]).length;
    return '<div class="ra-k">Sharpen the Blade<small>' + n + ' of ' + s.on.length + ' this week</small></div>' +
      '<div class="rv-saw">' + s.on.map(([k, label]) => '<button type="button" class="' + (s.done[k] ? 'on' : '') + '" data-rv-saw="' + esc(k) + '" aria-pressed="' + !!s.done[k] + '"><i aria-hidden="true"></i>' + esc(String(label).replace(/^\s*(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D\p{Extended_Pictographic})*\s*/u, '')) + '</button>').join('') + '</div>';
  },
  sawTick(btn) {
    const wid = weekId(new Date()); const s = ReviewPlus.saw(wid); if (!s) return;
    const k = btn.getAttribute('data-rv-saw'); const row = s.on.find(([x]) => x === k); if (!row) return;
    if (s.done[k]) delete s.done[k]; else { s.done[k] = true; try { J('planning', '🪒 Sharpen the Blade: ' + row[1]); } catch (e) {} }
    try { cSave(); } catch (e) {}
    btn.classList.toggle('on', !!s.done[k]); btn.setAttribute('aria-pressed', String(!!s.done[k]));
    const k2 = btn.closest('#rv-evidence').querySelector('.ra-k small'); if (k2) k2.textContent = s.on.filter(([x]) => s.done[x]).length + ' of ' + s.on.length + ' this week';
    try { renderToday(); } catch (e) {}
  },
  async submit(form) {
    const titles = [...form.querySelectorAll('input')].map((i) => i.value.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const line = form.querySelector('#rv-line').value.trim();
    const mon = new Date(); mon.setHours(12, 0, 0, 0); mon.setDate(mon.getDate() + (7 - (mon.getDay() + 6) % 7));
    const wid = weekId(mon);
    titles.forEach((t, i) => addRock(t, (cData.roles && cData.roles[0]) || '', Math.min(4, i), '', wid, { prio: i === 0 ? 'high' : 'med' }));
    try {
      const list = (await DB.get(ReviewPlus.KEY, [])) || [];
      const thisW = weekId(new Date());
      const rec = { wid: thisW, at: new Date().toISOString(), counts: (() => { const c = ReviewPlus.counts(thisW); delete c.most; return c; })(), line, next: titles.length };
      const i = list.findIndex((x) => x && x.wid === thisW); if (i >= 0) list[i] = rec; else list.push(rec);
      await DB.set(ReviewPlus.KEY, list.slice(-60));
    } catch (e) {}
    if (line) { try { J('journal', '📝 Week ' + weekId(new Date()) + ': ' + line); } catch (e) {} }
    try { renderToday(); renderCompass(); } catch (e) {}
    Track.hit('review_completed');
    toast(titles.length ? 'Next week is set: ' + titles.length + ' Big Rock' + (titles.length === 1 ? '' : 's') + '.' : 'Week reviewed ✓');
    const w = document.getElementById('flow-review'); if (w) w.classList.remove('on');
  },
  /* Called when the Review week sheet is drawn. */
  decorate(wrap) {
    let box = wrap.querySelector('#rv-evidence');
    if (!Plus.simple()) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div'); box.id = 'rv-evidence';
      const after = wrap.querySelector('#rv-score'); if (after) after.after(box); else wrap.querySelector('.fn-sheet').appendChild(box);
      box.addEventListener('submit', (e) => { e.preventDefault(); ReviewPlus.submit(e.target); });
      box.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('[data-rv-saw]'); if (b) ReviewPlus.sawTick(b); });
    }
    box.innerHTML = ReviewPlus.html(weekId(new Date()));
  }
};
window.FlowReviewPlus = ReviewPlus;

/* ── Patterns: the habit card reads you instead of asking you ──────────────
 * The Habits card on Today opens with a short read of how you have actually
 * been living — written once a day by the assistant from what is already in
 * your account (Big Rocks, habit ticks, sleep, mood, training, journal,
 * spending, focus) — and what to do about it. The habits you tick by hand
 * are still there, folded under it, and tick exactly as before.
 *
 * Kept on the account (`flow:patterns`), so a reload, the phone and the Mac
 * all show the same read without asking again; a new one is asked for once
 * a day, or when Rewrite is pressed. */
const Patterns = {
  KEY: 'flow:patterns',
  data: null,       // { day, read: { headline, patterns[], next[], missing, generatedAt } }
  busy: false,
  error: '',
  note: '',        // said under the read, not an error (the rewrites are used up)
  off: false,       // the assistant is not set up on this server
  tried: '',
  day() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
  async load() {
    if (Patterns.data) return Patterns.data;
    const v = await DB.get(Patterns.KEY, null);
    Patterns.data = (v && v.read) ? v : null;
    return Patterns.data;
  },
  isHabit(name) {
    try { const n = String(name || '').trim().toLowerCase(); return !!n && (hbData.habits || []).some((h) => String(h.name || '').trim().toLowerCase() === n); } catch (e) { return false; }
  },
  /* The same thing the Habits page does when you add one there. */
  addHabit(name) {
    const v = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!v || typeof hbData === 'undefined') return false;
    if (Patterns.isHabit(v)) { toast('Already a habit'); return false; }
    if (!Array.isArray(hbData.habits)) hbData.habits = [];
    hbData.habits.push({ id: Date.now().toString(), name: v });
    try { if (typeof J === 'function') J('habits', '➕ New habit: ' + v); } catch (e) {}
    try { S.set('habits', hbData); } catch (e) {}
    try { if (typeof renderHabits === 'function') renderHabits(); } catch (e) {}
    try { if (typeof renderToday === 'function') renderToday(); } catch (e) {}
    Patterns.setOpen(true);
    toast('Habit added ✓ — tick it here each day');
    return true;
  },
  /* One sentence about your week, as a picture: the read's headline on the
     lime card, with the app's name under it. The phone's share sheet when
     there is one; a download otherwise. Nothing but the headline leaves the
     device — not the patterns, not the record. */
  async share() {
    const d = Patterns.data && Patterns.data.read;
    if (!d || !d.headline) { toast('Nothing to share yet.'); return; }
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#C8F26B'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#15190A';
    g.font = '700 34px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    g.fillText('THE FLOW · PATTERNS', 90, 130);
    g.font = '400 30px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    g.fillStyle = 'rgba(21,25,10,.62)';
    g.fillText(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), 90, 180);
    /* the headline, wrapped, in a size that fits */
    const words = String(d.headline).split(/\s+/);
    let size = 84, lines = [];
    for (; size >= 44; size -= 6) {
      g.font = '700 ' + size + 'px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      lines = []; let cur = '';
      words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > W - 180 && cur) { lines.push(cur); cur = w; } else cur = t; });
      if (cur) lines.push(cur);
      if (lines.length * size * 1.18 <= H - 520) break;
    }
    g.fillStyle = '#15190A';
    let y = 330;
    lines.forEach((l) => { g.fillText(l, 90, y); y += size * 1.18; });
    g.font = '400 32px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    g.fillStyle = 'rgba(21,25,10,.62)';
    g.fillText('Read from my own record by The Flow', 90, H - 150);
    g.fillStyle = '#15190A';
    g.font = '700 34px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    g.fillText('theflow.today', 90, H - 95);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    if (!blob) { toast('Could not draw the card.', 'warn'); return; }
    const file = new File([blob], 'the-flow-patterns.png', { type: 'image/png' });
    Track.hit('share_read');
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) { await navigator.share({ files: [file], title: 'My week, read by The Flow' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Saved the card as a picture.');
  },
  open() { try { return localStorage.getItem('flow:ptHabits') === '1'; } catch (e) { return false; } },
  setOpen(v) { try { localStorage.setItem('flow:ptHabits', v ? '1' : '0'); } catch (e) {} },
  extra() {
    const out = {};
    try { out.nights = HealthNight.days().filter((d) => d && d.date && d.hours != null).slice(-21).map((d) => ({ date: d.date, hours: d.hours, bedAt: d.bedAt || null, sleepAt: d.sleepAt || null })); } catch (e) {}
    try { out.meetingsToday = (ConnectApps.cal || []).length; } catch (e) {}
    return out;
  },
  /* Once a day on its own; Rewrite asks again. */
  /* force: true is Rewrite (a new, paid read). 'retry' asks again for the
     day's read — the server answers from what it already has when it can,
     so trying again after an error never costs a rewrite. */
  async ensure(force) {
    if (Patterns.busy || Patterns.off) return;
    if (typeof Auth !== 'undefined' && (!Auth.user || Auth.user.guest)) return;
    const retry = force === 'retry';
    if (retry) force = false;
    await Patterns.load();
    const today = Patterns.day();
    if (!force && !retry && Patterns.data && Patterns.data.day === today) return;
    if (!force && !retry && Patterns.tried === today) return;
    Patterns.tried = today;
    Patterns.busy = true; Patterns.error = ''; Patterns.note = ''; Patterns.repaint();
    try {
      let r = await fetch('/api/flow/patterns', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: !!force, today, lang: (typeof Lang !== 'undefined' && Lang.current) || 'en', extra: Patterns.extra() }) });
      let j = await r.json().catch(() => ({}));
      if (r.status === 503) { Patterns.off = true; throw new Error(''); }
      /* Free: the week's read is used up, or a rewrite was asked for. The
         last read, if there is one, still stands; the card says what Plus
         adds (in Simple) rather than calling it an error. */
      if (r.status === 402 && j.plus) {
        Patterns.plus = true;
        if (j.patterns && j.patterns.headline != null) { Patterns.data = { day: String(j.patterns.generatedAt || '').slice(0, 10) || today, read: j.patterns }; await DB.set(Patterns.KEY, Patterns.data); }
        if (force) Plus.refused(j, { open: true });
        throw new Error(Plus.simple() ? '' : (j.error || ''));
      }
      if (j.plus) Patterns.plus = true;
      if (!r.ok && r.status !== 202) throw new Error(j.error || 'Patterns could not be read just now.');
      if (r.status === 202 && j.job) {
        for (let i = 0; i < 60; i++) {
          await new Promise((ok) => setTimeout(ok, i < 4 ? 1500 : 2500));
          r = await fetch('/api/flow/patterns?job=' + encodeURIComponent(j.job), { credentials: 'same-origin' });
          const k = await r.json().catch(() => ({}));
          if (k.status === 'working') continue;
          if (k.status === 'done') { j = k; break; }
          throw new Error(k.error || 'Patterns could not be read just now.');
        }
      }
      if (!j.patterns) throw new Error('Patterns took too long. Try again in a minute.');
      /* A read kept from an earlier day (the rewrites are used up) keeps its
         own date, so the card says "From …" instead of passing it off as today's. */
      const own = j.capped && j.patterns.generatedAt ? String(j.patterns.generatedAt).slice(0, 10) : today;
      Patterns.data = { day: own, read: j.patterns };
      await DB.set(Patterns.KEY, Patterns.data);
      if (j.capped) Patterns.note = 'No rewrites left today — this is the last read.';
    } catch (e) {
      Patterns.error = (e && e.message) || '';
      Patterns.errAt = Date.now();
      /* Another device may have read it since this one loaded: show that
         rather than an empty card. */
      if (!Patterns.data) { try { const v = await DB.get(Patterns.KEY, null); if (v && v.read) Patterns.data = v; } catch (x) {} }
    }
    Patterns.busy = false;
    Patterns.repaint();
  },
  html() {
    const d = Patterns.data && Patterns.data.read;
    if (Patterns.busy && !d) return '<div class="pt"><p class="pt-wait"><i class="eb-spin"></i>Reading how your last few weeks actually went…</p></div>';
    if (!d) {
      if (Patterns.off) return '';
      if (Patterns.plus && Plus.simple()) return '<div class="pt">' + Plus.line('patterns') + '</div>';
      return Patterns.error ? '<div class="pt"><p class="pt-wait">' + esc(Patterns.error) + ' <button type="button" class="pt-link" data-pt="retry">Try again</button></p></div>' : '';
    }
    const when = d.generatedAt ? new Date(d.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const stale = Patterns.data.day !== Patterns.day();
    return '<div class="pt">' +
      (d.headline ? '<p class="pt-head">' + esc(d.headline) + '</p>' : '') +
      (d.patterns && d.patterns.length ? '<ul class="pt-list">' + d.patterns.map((x) =>
        '<li class="pt-' + esc(x.tone) + '"><span class="pt-area">' + esc(x.area) + '</span><span class="pt-tx">' + esc(x.text) + '</span></li>').join('') + '</ul>' : '') +
      (d.next && d.next.length ? '<div class="pt-next"><b>Do next</b><ul>' + d.next.map((x, i) => '<li><span>' + esc(x) + '</span>' +
        (Patterns.isHabit(x) ? '<span class="pt-added">✓ habit</span>' : '<button type="button" class="pt-link pt-mk" data-pt="habit" data-i="' + i + '" aria-label="Track as a habit: ' + esc(x) + '">+ habit</button>') + '</li>').join('') + '</ul></div>' : '') +
      (d.missing ? '<p class="pt-miss">' + esc(d.missing) + '</p>' : '') +
      '<p class="pt-foot">' + (stale ? 'From ' + esc(Patterns.data.day) : 'Read from your record' + (when ? ' at ' + esc(when) : '')) +
        (Patterns.plus && Plus.simple() ? ' · Plus reads every morning · <button type="button" class="pt-link" data-pt="plus">See Plus</button>'
          : ' · <button type="button" class="pt-link" data-pt="rewrite"' + (Patterns.busy ? ' disabled' : '') + '>' + (Patterns.busy ? 'Rewriting…' : 'Rewrite') + '</button>') +
        (Plus.simple() ? ' · <button type="button" class="pt-link" data-pt="share">Share</button>' : '') +
        (Patterns.error || Patterns.note ? ' <span class="pt-err">' + esc(Patterns.error || Patterns.note) + '</span>' : '') + '</p>' +
    '</div>';
  },
  /* Called each time Today draws the Habits card. */
  decorate(block) {
    if (!block) return;
    const head = block.querySelector('.flow-td-head');
    const rows = [...block.querySelectorAll('.flow-td-row.hb')];
    const empty = block.querySelector('.flow-td-empty');
    const html = Patterns.html();
    if (!html) { Patterns.later(); return; }
    block.classList.add('pt-card');
    const lbl = head && head.querySelector('.l');
    if (lbl) lbl.textContent = 'Patterns';
    const cnt = head && head.querySelector('.c');
    if (cnt) cnt.style.display = 'none';
    const box = document.createElement('div'); box.className = 'pt-box'; box.innerHTML = html;
    if (head) head.after(box); else block.prepend(box);
    /* the habits you tick yourself, folded under the read */
    const done = rows.filter((r) => r.classList.contains('done')).length;
    const fold = document.createElement('div');
    fold.className = 'pt-hb' + (Patterns.open() ? ' open' : '');
    fold.innerHTML = '<button type="button" class="pt-hb-t" data-pt="habits" aria-expanded="' + Patterns.open() + '">' +
      (rows.length ? 'Habits you tick · ' + done + ' / ' + rows.length : 'Habits you tick') + '<span class="pt-chev" aria-hidden="true">▾</span></button><div class="pt-hb-b"></div>';
    const b = fold.querySelector('.pt-hb-b');
    rows.forEach((r) => b.appendChild(r));
    if (empty) empty.remove();
    /* Adding one is right here, not a trip to another page. */
    b.insertAdjacentHTML('beforeend', (rows.length ? '' : '<p class="pt-hbnone">No habits yet. Add one, or tap “+ habit” on anything under Do next.</p>') +
      '<form class="pt-addhb" autocomplete="off"><input class="flow-in" maxlength="120" placeholder="Add a habit — e.g. Walk 20 minutes" aria-label="New habit"><button type="submit" class="flow-btn sm">Add</button></form>');
    box.after(fold);
    Patterns.later();
  },
  later() { if (!Patterns.busy && !Patterns.queued) { Patterns.queued = true; setTimeout(() => { Patterns.queued = false; Patterns.ensure(false); }, 1200); } },
  repaint() {
    const block = document.getElementById('flow-td-habits');
    if (!block) return;
    const box = block.querySelector('.pt-box');
    if (box) { const html = Patterns.html(); if (html) box.innerHTML = html; else box.remove(); return; }
    try { TodayPlus.apply(); } catch (e) {}
  },
  boot() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-pt]');
      if (!b) return;
      const what = b.getAttribute('data-pt');
      if (what === 'rewrite') { Patterns.ensure(true); return; }
      if (what === 'retry') { Patterns.ensure('retry'); return; }
      if (what === 'plus') { Plus.open('patterns'); return; }
      if (what === 'share') { Patterns.share(); return; }
      if (what === 'habit') {
        const x = Patterns.data && Patterns.data.read && (Patterns.data.read.next || [])[+b.getAttribute('data-i')];
        if (x) Patterns.addHabit(x);
        return;
      }
      if (what === 'habits') {
        const f = b.closest('.pt-hb'); const on = !f.classList.contains('open');
        f.classList.toggle('open', on); b.setAttribute('aria-expanded', String(on)); Patterns.setOpen(on);
      }
    });
    document.addEventListener('submit', (e) => {
      const f = e.target.closest && e.target.closest('.pt-addhb');
      if (!f) return;
      e.preventDefault();
      const inp = f.querySelector('input');
      if (Patterns.addHabit(inp.value)) inp.value = '';
    });
    /* An error is not the last word: coming back to the app asks again
       (from the day's read, not a new one), at most every ten minutes. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Patterns.error && !Patterns.busy && Date.now() - (Patterns.errAt || 0) > 10 * 60 * 1000) Patterns.ensure('retry');
    });
    Patterns.load().then(() => Patterns.repaint()).catch(() => {});
  }
};
window.FlowPatterns = Patterns;

/* ── Coming up: the next week, two weeks or month, with reminders ───────────
 * One list of what is ahead — calendar events for the next month, the Big
 * Rocks already placed on coming days, and dated tasks — grouped by day and
 * cut to 7, 14 or 30 days. Each item can be given a reminder (the morning
 * of, the day before, a week before, two hours before); reminders are kept
 * on the account, so the server sends them to the phone and the Mac
 * schedules them itself. Above the list, once a day, the assistant reads
 * the stretch ahead: one line, what to get ready and by when, and the
 * reminders worth setting — one tap each. */
const Ahead = {
  REM_KEY: 'flow:reminders',
  READ_KEY: 'flow:ahead',
  cal: null, calAt: 0, calBusy: false,
  rem: null,
  read: null,        // { day, sig, items:[titles], ahead:{headline,prep,watch,remind} }
  busy: false, error: '', off: false, tried: '',
  menu: null,        // item key whose reminder menu is open
  more: {},          // days whose Big Rocks are unfolded
  span() { let v = 7; try { v = +localStorage.getItem('flow:aheadSpan') || 7; } catch (e) {} return [7, 14, 30].indexOf(v) >= 0 ? v : 7; },
  setSpan(v) { try { localStorage.setItem('flow:aheadSpan', String(v)); } catch (e) {} },
  iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
  plus(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; },
  hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); },

  async load() {
    if (Ahead.rem == null) { const v = await DB.get(Ahead.REM_KEY, []); Ahead.rem = Array.isArray(v) ? v : []; }
    if (Ahead.read == null) { const v = await DB.get(Ahead.READ_KEY, null); Ahead.read = (v && v.ahead) ? v : false; }
  },
  calIds() {
    try { return ['gcal', 'outlook'].filter((id) => { const c = Connect.list.find((x) => x.id === id); return c && (c.accounts || []).some((a) => !a.broken); }); } catch (e) { return []; }
  },
  async loadCal(force) {
    const ids = Ahead.calIds();
    if (!ids.length) { Ahead.cal = null; return; }
    if (Ahead.calBusy || (!force && Ahead.cal && Date.now() - Ahead.calAt < 30 * 60 * 1000)) return;
    Ahead.calBusy = true;
    try {
      const from = Ahead.plus(0), to = Ahead.plus(31);
      const q = '?' + new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      const got = await Promise.all(ids.map((id) => ConnectApps.get('/api/connect/' + id + '/events' + q).then((j) => j.events || []).catch(() => null)));
      if (got.every((x) => x === null)) return;
      const seen = {};
      Ahead.cal = [].concat.apply([], got.filter(Boolean)).filter((e) => {
        const k = String(e.title).trim().toLowerCase() + '|' + String(e.start).slice(0, 16);
        if (seen[k]) return false; seen[k] = 1; return true;
      });
      Ahead.calAt = Date.now();
    } finally { Ahead.calBusy = false; }
  },

  /* Everything ahead, as one sorted list. */
  items() {
    const out = [];
    const today = Ahead.iso(new Date()), end = Ahead.iso(Ahead.plus(31));
    (Ahead.cal || []).forEach((e) => {
      const s0 = e.allDay ? new Date(String(e.start).slice(0, 10) + 'T00:00:00') : new Date(e.start);
      if (isNaN(s0)) return;
      const date = Ahead.iso(s0);
      if (date < today || date > end) return;
      if (!e.allDay && date === today && Date.parse(e.end) < Date.now()) return;
      const hours = e.allDay ? 24 : Math.max(0, (Date.parse(e.end) - Date.parse(e.start)) / 36e5);
      let brief = false; try { brief = !!(EventBrief.data && EventBrief.data[EventBrief.key(e)] && EventBrief.data[EventBrief.key(e)].brief); } catch (x) {}
      out.push({ key: 'ev:' + (e.id || e.title + date), kind: 'event', date, time: e.allDay ? '' : Ahead.hm(s0), allDay: !!e.allDay, hours: Math.round(hours * 10) / 10,
        title: e.title, where: e.location || '', link: e.link || '', big: !!e.allDay || hours >= 3 || brief, brief });
    });
    try {
      const all = (typeof cData !== 'undefined' && cData.rocks) || {};
      /* from tomorrow: today's Big Rocks are on the card right above */
      for (let i = 1; i <= 31; i++) {
        const d = Ahead.plus(i), wid = TodayLook.wid(d), dow = (d.getDay() + 6) % 7;
        (all[wid] || []).forEach((r) => {
          if (!r || r.done || r.day !== dow) return;
          out.push({ key: 'rk:' + r.id, kind: 'rock', date: Ahead.iso(d), time: r.time || '', title: r.title, where: '', big: r.prio === 'high', rockId: r.id });
        });
      }
    } catch (e) {}
    try {
      Schedule.between(today, end).forEach((r) => {
        if (!r || r.done || r.source === 'today' && r.date === today) return;
        out.push({ key: 'sc:' + r.key, kind: 'task', date: r.date, time: r.time || '', title: r.text || r.title || String(r.key).split('::').pop(), where: '', big: !!r.alert });
      });
    } catch (e) {}
    /* dropped or handed off from here — see RockActions.openItem */
    let shown = out;
    try { shown = out.filter((x) => !RockActions.isHidden(x.key)); } catch (e) {}
    return shown.sort((a, b) => (a.date + (a.time || (a.allDay ? '00:00' : '99:99'))).localeCompare(b.date + (b.time || (b.allDay ? '00:00' : '99:99'))));
  },
  sig(items) { return items.map((x) => x.date + (x.time || '') + x.title).join('|').length + ':' + items.length + ':' + (items[0] ? items[0].date : '') + ':' + items.slice(0, 12).map((x) => x.title.length).join('.'); },

  /* ---- reminders ---- */
  options(it) {
    const now = Date.now();
    const day = new Date(it.date + 'T00:00:00');
    const at = (d, hh, mm) => { const x = new Date(d); x.setHours(hh, mm || 0, 0, 0); return x; };
    const opts = [];
    const start = it.time ? new Date(it.date + 'T' + it.time + ':00') : at(day, 9);
    if (it.time) opts.push({ id: '2h', label: '2 hours before', at: new Date(start.getTime() - 2 * 36e5) });
    opts.push({ id: 'morning', label: 'Morning of · 08:30', at: at(day, 8, 30) });
    const prev = new Date(day); prev.setDate(prev.getDate() - 1);
    opts.push({ id: 'eve', label: 'Day before · 18:00', at: at(prev, 18) });
    const wk = new Date(day); wk.setDate(wk.getDate() - 7);
    opts.push({ id: 'week', label: 'A week before · 10:00', at: at(wk, 10) });
    return opts.filter((o) => o.at.getTime() > now + 60000 && (!it.time || o.at < start));
  },
  remFor(key) { return (Ahead.rem || []).filter((r) => r.key === key); },
  localAt(d) { return Ahead.iso(d) + 'T' + Ahead.hm(d); },
  async toggle(it, opt, why) {
    const id = it.key.replace(/[^\w:.-]/g, '').slice(0, 80) + '@' + opt.id;
    const list = (Ahead.rem || []).filter((r) => r.at >= Ahead.localAt(new Date(Date.now() - 864e5)));   // drop old ones as we go
    const i = list.findIndex((r) => r.id === id);
    if (i >= 0) list.splice(i, 1);
    else list.push({ id, key: it.key, at: Ahead.localAt(opt.at), title: it.title, when: Ahead.whenText(it), body: why || ('Coming up ' + Ahead.whenText(it) + (it.where ? ' · ' + it.where : '')) });
    Ahead.rem = list;
    await DB.set(Ahead.REM_KEY, list);
    try { Notify.later(); } catch (e) {}
    toast(i >= 0 ? 'Reminder removed.' : 'Reminder set for ' + new Date(opt.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.', null, 2000);
    Ahead.paint();
  },
  whenText(it) {
    const d = new Date(it.date + 'T00:00:00');
    const diff = Math.round((d - Ahead.plus(0)) / 864e5);
    const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return day + (it.time ? ' at ' + it.time : '');
  },

  /* ---- the assistant's read ---- */
  async ensure(force) {
    if (Ahead.busy || Ahead.off) return;
    if (typeof Auth !== 'undefined' && (!Auth.user || Auth.user.guest)) return;
    await Ahead.load();
    const items = Ahead.items().slice(0, 80);
    if (!items.length) return;
    const today = Ahead.iso(new Date()), sig = Ahead.sig(items);
    if (!force && Ahead.read && Ahead.read.day === today && Ahead.read.sig === sig) return;
    if (!force && Ahead.tried === today + sig) return;
    Ahead.tried = today + sig;
    Ahead.busy = true; Ahead.error = ''; Ahead.paint();
    try {
      const body = { refresh: !!force, today, sig, lang: (typeof Lang !== 'undefined' && Lang.current) || 'en',
        items: items.map((x) => ({ date: x.date, time: x.time, allDay: x.allDay, hours: x.hours, kind: x.kind, title: x.title, where: x.where })) };
      let r = await fetch('/api/flow/ahead', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let j = await r.json().catch(() => ({}));
      if (r.status === 503) { Ahead.off = true; throw new Error(''); }
      if (r.status === 402 && j.plus) { Ahead.needsPlus = true; if (force) Plus.refused(j, { open: true }); throw new Error(Plus.simple() ? '' : (j.error || '')); }
      if (!r.ok && r.status !== 202) throw new Error(j.error || 'Coming up could not be read just now.');
      if (r.status === 202 && j.job) {
        for (let i = 0; i < 60; i++) {
          await new Promise((ok) => setTimeout(ok, i < 4 ? 1500 : 2500));
          r = await fetch('/api/flow/ahead?job=' + encodeURIComponent(j.job), { credentials: 'same-origin' });
          const k = await r.json().catch(() => ({}));
          if (k.status === 'working') continue;
          if (k.status === 'done') { j = k; break; }
          throw new Error(k.error || 'Coming up could not be read just now.');
        }
      }
      if (!j.ahead) throw new Error('The read took too long. Try Rewrite.');
      Ahead.read = { day: today, sig, items: items.map((x) => ({ key: x.key, title: x.title, date: x.date, time: x.time, kind: x.kind, where: x.where })), ahead: j.ahead };
      await DB.set(Ahead.READ_KEY, Ahead.read);
    } catch (e) { Ahead.error = (e && e.message) || ''; }
    Ahead.busy = false;
    Ahead.paint();
  },

  /* ---- drawing ---- */
  html() {
    const span = Ahead.span();
    const all = Ahead.items();
    const until = Ahead.iso(Ahead.plus(span));
    const list = all.filter((x) => x.date <= until);
    const today = Ahead.iso(new Date()), tomorrow = Ahead.iso(Ahead.plus(1));
    const rd = Ahead.read && Ahead.read.ahead;
    const ritems = (Ahead.read && Ahead.read.items) || [];
    const byKey = {}; all.forEach((x) => { byKey[x.key] = x; });
    let readHtml = '';
    if (rd) {
      const ref = (n) => { const r = ritems[n]; return r ? (byKey[r.key] || r) : null; };
      /* The tabs cut the read as well as the list: a week shows what to
         get ready this week, in date order. */
      const inSpan = (it) => !!it && (it.date || '') <= until && !!byKey[it.key];
      const prep = (rd.prep || []).map((p) => Object.assign({ it: ref(p.ref) }, p)).filter((p) => inSpan(p.it))
        .sort((a, b) => String(a.by || a.it.date).localeCompare(String(b.by || b.it.date)));
      const untilMs = Ahead.plus(span + 1).getTime();
      const remind = (rd.remind || []).map((r, i) => Object.assign({ i, it: ref(r.ref), atD: new Date(r.at + ':00') }, r))
        .filter((r) => r.it && byKey[r.it.key] && !isNaN(r.atD) && r.atD.getTime() >= Date.now() && r.atD.getTime() < untilMs);
      readHtml = '<div class="ah-read">' + (rd.headline ? '<p class="ah-head">' + esc(rd.headline) + '</p>' : '') +
        (prep.length ? '<ul class="ah-prep">' + prep.map((p) => '<li><span class="ah-by">' + esc(new Date((p.by || p.it.date) + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })) + '</span><span class="ah-what">' + esc(p.what) + '<small>' + esc(p.it.title) + '</small></span></li>').join('') + '</ul>' : '') +
        (rd.watch && rd.watch.length ? '<ul class="ah-watch">' + rd.watch.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
        (remind.length ? '<div class="ah-sugg"><span class="ah-sk">Suggested reminders</span>' + remind.map((r) => { const it = r.it; const on = (Ahead.rem || []).some((x) => x.id.indexOf(it.key.replace(/[^\w:.-]/g, '').slice(0, 80) + '@ai' + r.i) === 0);
          /* The reminder's own day and time first, so "tomorrow" in the
             note reads from that day, not from today. */
          const when = r.atD.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + Ahead.hm(r.atD);
          return '<button type="button" class="ah-chip' + (on ? ' on' : '') + '" data-ah="sugg" data-i="' + r.i + '" aria-pressed="' + on + '"><b>' + (on ? '✓ ' : '+ ') + esc(when) + '</b> ' + esc(r.why || it.title) + '</button>'; }).join('') + '</div>' : '') +
        '<p class="ah-foot">' + (Ahead.busy ? 'Reading…' : 'Read at ' + esc(new Date((rd.generatedAt || Date.now())).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))) + ' · <button type="button" class="pt-link" data-ah="rewrite"' + (Ahead.busy ? ' disabled' : '') + '>Rewrite</button>' + (Ahead.error ? ' <span class="pt-err">' + esc(Ahead.error) + '</span>' : '') + '</p></div>';
    } else if (Ahead.busy) readHtml = '<div class="ah-read"><p class="pt-wait"><i class="eb-spin"></i>Reading the weeks ahead…</p></div>';
    else if (Ahead.needsPlus && Plus.simple()) readHtml = '<div class="ah-read">' + Plus.line('ahead') + '</div>';
    else if (Ahead.error) readHtml = '<div class="ah-read"><p class="pt-wait">' + esc(Ahead.error) + ' <button type="button" class="pt-link" data-ah="rewrite">Try again</button></p></div>';

    let rows = '', last = '', rocksToday = 0;
    /* A day with many Big Rocks shows two and folds the rest — the list is
       for seeing what is coming, not re-reading the week's plan. */
    const rockCount = {}; list.forEach((x) => { if (x.kind === 'rock') rockCount[x.date] = (rockCount[x.date] || 0) + 1; });
    list.forEach((it) => {
      if (it.date !== last) rocksToday = 0;
      if (it.kind === 'rock') {
        rocksToday++;
        const n = rockCount[it.date];
        if (n > 3 && rocksToday > 2 && !Ahead.more[it.date]) {
          if (rocksToday === 3) rows += '<li class="ah-more"><button type="button" class="pt-link" data-ah="more" data-d="' + esc(it.date) + '">+ ' + (n - 2) + ' more Big Rocks</button></li>';
          return;
        }
      }
      if (it.date !== last) {
        last = it.date;
        const d = new Date(it.date + 'T00:00:00');
        const label = it.date === today ? 'Today' : it.date === tomorrow ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
        rows += '<li class="ah-day"><span>' + esc(label) + '</span></li>';
      }
      const rem = Ahead.remFor(it.key);
      const open = Ahead.menu === it.key;
      rows += '<li class="ah-row' + (it.big ? ' big' : '') + '" data-ahk="' + esc(it.key) + '">' +
        '<span class="ah-tm">' + (it.time ? esc(it.time) : it.allDay ? 'All day' : '') + '</span>' +
        '<span class="ah-t"><span data-i18n="off">' + esc(it.title) + '</span><small>' + (it.kind === 'rock' ? 'Big Rock' : it.kind === 'task' ? 'Task' : 'Calendar') + (it.where ? ' · ' + esc(it.where) : '') + (it.brief ? ' · brief ready' : '') + '</small></span>' +
        '<button type="button" class="ah-bell' + (rem.length ? ' on' : '') + '" data-ah="menu" aria-expanded="' + open + '" aria-label="' + (rem.length ? 'Reminders set: ' + rem.length : 'Remind me') + '">' + Nav.svg('bell') + (rem.length ? '<b>' + rem.length + '</b>' : '') + '</button>' +
        '<button type="button" class="ra-more ah-ra" data-ra-item="' + esc(it.key) + '" aria-label="More for ' + esc(it.title) + '">' + Nav.svg('dots') + '</button>' +
        (open ? '<div class="ah-menu" role="menu">' + Ahead.options(it).map((o) => { const on = rem.some((r) => r.id.endsWith('@' + o.id)); return '<button type="button" role="menuitemcheckbox" aria-checked="' + on + '" data-ah="opt" data-o="' + o.id + '"' + (on ? ' class="on"' : '') + '>' + (on ? '✓ ' : '') + esc(o.label) + '</button>'; }).join('') + (Ahead.options(it).length ? '' : '<span class="ah-none">Too soon to remind.</span>') + '</div>' : '') +
      '</li>';
    });
    const count = list.length, setN = (Ahead.rem || []).filter((r) => r.at >= Ahead.localAt(new Date())).length;
    return '<div class="flow-td-head"><span class="l">Coming up</span><span class="c">' + count + (setN ? ' · ' + setN + ' reminder' + (setN === 1 ? '' : 's') : '') + '</span></div>' +
      '<div class="ah-tabs" role="tablist">' + [7, 14, 30].map((n) => { const k = all.filter((x) => x.date <= Ahead.iso(Ahead.plus(n))).length; return '<button type="button" role="tab" aria-selected="' + (n === span) + '" data-ah="span" data-n="' + n + '"' + (n === span ? ' class="on"' : '') + '>' + (n === 7 ? 'Week' : n === 14 ? '2 weeks' : 'Month') + (k ? ' <i>' + k + '</i>' : '') + '</button>'; }).join('') + '</div>' +
      readHtml +
      (count ? '<ul class="ah-list">' + rows + '</ul>' : '<p class="flow-td-empty">' + (Ahead.calIds().length ? 'Nothing in the next ' + (span === 30 ? 'month' : span + ' days') + '.' : 'Nothing planned ahead yet. Put Big Rocks on coming days, or connect your calendar in Settings.') + '</p>');
  },
  paint() {
    const feed = document.getElementById('today-feed');
    if (!feed || !feed.querySelector('.td-head')) return;
    let box = document.getElementById('flow-td-ahead');
    if (!box) {
      box = document.createElement('div');
      box.id = 'flow-td-ahead'; box.className = 'flow-td flow-td-sec flow-x lk-ahead';
    }
    /* under whichever comes last of the calendar and the Big Rocks */
    const cands = [feed.querySelector('#td-cal'), feed.querySelector('.td-rocks:not(#td-cal)')].filter(Boolean);
    const after = cands.length ? cands.reduce((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) ? y : x) : feed.querySelector('.flow-td-pulse');
    if (after && box.previousElementSibling !== after) after.after(box);
    else if (!after && !box.isConnected) feed.appendChild(box);
    TodayLook.put(box, Ahead.html());
  },
  boot() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-ah]');
      if (!b) { if (Ahead.menu && !(e.target.closest && e.target.closest('.ah-menu'))) { Ahead.menu = null; Ahead.paint(); } return; }
      const what = b.getAttribute('data-ah');
      const row = b.closest('[data-ahk]');
      const it = row && Ahead.items().find((x) => x.key === row.getAttribute('data-ahk'));
      if (what === 'span') { Ahead.setSpan(+b.getAttribute('data-n')); Ahead.paint(); return; }
      if (what === 'more') { Ahead.more[b.getAttribute('data-d')] = true; Ahead.paint(); return; }
      if (what === 'rewrite') { Ahead.ensure(true); return; }
      if (what === 'menu' && it) { Ahead.menu = Ahead.menu === it.key ? null : it.key; Ahead.paint(); return; }
      if (what === 'opt' && it) { const o = Ahead.options(it).find((x) => x.id === b.getAttribute('data-o')); if (o) Ahead.toggle(it, o); Ahead.menu = null; return; }
      if (what === 'sugg') {
        const i = +b.getAttribute('data-i'); const r = Ahead.read && Ahead.read.ahead.remind[i]; const ref = r && Ahead.read.items[r.ref];
        const live = ref && Ahead.items().find((x) => x.key === ref.key);
        if (live) Ahead.toggle(live, { id: 'ai' + i, at: new Date(r.at + ':00') }, r.why);
      }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Ahead.menu) { Ahead.menu = null; Ahead.paint(); } });
    const go = async () => {
      try { await Ahead.load(); } catch (e) {}
      Ahead.paint();
      try { await Ahead.loadCal(false); } catch (e) {}
      Ahead.paint();
      setTimeout(() => Ahead.ensure(false), 1500);
    };
    setTimeout(go, 2500);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Ahead.loadCal(false).then(() => Ahead.paint()).catch(() => {}); });
    setInterval(() => { if (document.visibilityState === 'visible') Ahead.loadCal(false).then(() => Ahead.paint()).catch(() => {}); }, 30 * 60 * 1000);
  }
};
window.FlowAhead = Ahead;
window.FlowNotifySync = () => Notify.syncMac();

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
  /* What is out of the menu right now: your own choice plus, in the Simple
     interface, the places it leaves out. */
  hiddenNow() {
    const out = Sections.hidden().slice();
    try { TodayLook.hides().forEach((t) => { if (out.indexOf(t) < 0) out.push(t); }); } catch (e) {}
    return out;
  },

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
    st.textContent = Sections.hiddenNow().filter((t) => /^[a-z0-9_-]+$/i.test(t))
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
/* ── Change password, in the app ─────────────────────────────────────────
 * It used to be two browser prompts: the password shown in plain text, no
 * second box to catch a typo, and inside the phone app a dialog that looked
 * nothing like the rest of it. A sheet with real password fields instead. */
const PwSheet = {
  open() {
    let wrap = document.getElementById('flow-pw');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'flow-pw'; wrap.className = 'fn-sheetwrap';
      wrap.setAttribute('data-flow-no-chip', '1');   /* a settings checkbox, not a task */
      wrap.innerHTML =
        '<div class="fn-scrim" data-pw-close="1"></div>' +
        '<div class="fn-sheet" role="dialog" aria-label="Change password" aria-modal="true">' +
          '<div class="fn-grab" data-pw-close="1"></div>' +
          '<button type="button" class="fn-capture-close" data-pw-close="1" aria-label="Close">×</button>' +
          '<h4>Change password</h4>' +
          '<div class="fn-sub">At least 10 characters. Other devices stay signed in.</div>' +
          '<div class="fa-err" id="pw-err" hidden></div>' +
          '<input class="flow-in" id="pw-cur" type="password" autocomplete="current-password" placeholder="Current password">' +
          '<input class="flow-in" id="pw-new" type="password" autocomplete="new-password" placeholder="New password">' +
          '<input class="flow-in" id="pw-new2" type="password" autocomplete="new-password" placeholder="New password, again">' +
          '<label class="pw-show"><input type="checkbox" id="pw-show"> Show passwords</label>' +
          '<div class="pl-acts"><button type="button" class="flow-btn primary" id="pw-go">Change password</button></div>' +
        '</div>';
      document.body.appendChild(wrap);
      const $w = (q) => wrap.querySelector(q);
      const close = () => { wrap.classList.remove('on'); ['#pw-cur', '#pw-new', '#pw-new2'].forEach((q) => { $w(q).value = ''; }); };
      wrap.querySelectorAll('[data-pw-close]').forEach((e) => e.addEventListener('click', close));
      $w('#pw-show').addEventListener('change', (e) => {
        ['#pw-cur', '#pw-new', '#pw-new2'].forEach((q) => { $w(q).type = e.target.checked ? 'text' : 'password'; });
      });
      const go = async () => {
        const err = $w('#pw-err'); err.hidden = true;
        const say = (m) => { err.textContent = m; err.hidden = false; };
        const cur = $w('#pw-cur').value, nx = $w('#pw-new').value, nx2 = $w('#pw-new2').value;
        if (!cur) return say('Type your current password.');
        if (nx.length < 10) return say('Use at least 10 characters for the new password.');
        if (nx !== nx2) return say('The two new passwords are not the same.');
        if (nx === cur) return say('That is the password you already have.');
        const btn = $w('#pw-go'); btn.disabled = true;
        try {
          await Auth.post('/api/auth/password', { current: cur, next: nx });
          close(); toast('Password changed ✓');
        } catch (e) { say(e.message); }
        finally { btn.disabled = false; }
      };
      $w('#pw-go').addEventListener('click', go);
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') close(); });
    }
    wrap.querySelector('#pw-show').checked = false;
    ['#pw-cur', '#pw-new', '#pw-new2'].forEach((q) => { wrap.querySelector(q).type = 'password'; });
    wrap.querySelector('#pw-err').hidden = true;
    wrap.classList.add('on');
    setTimeout(() => { try { wrap.querySelector('#pw-cur').focus(); } catch (e) {} }, 80);
  }
};

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

/* ── Finances: the budget form folds away once there is a budget ─────────
 * Nine number boxes stood between the totals and the spending every time the
 * tab opened, for something set once a month. With a budget saved the card
 * is one line — what is budgeted, and Edit — and opens on a tap. With none
 * saved it stays open, because then it is the first thing to do. */
const BudgetFold = {
  box() { return document.querySelector('#tab-finance .budget-setup'); },
  totals() {
    const box = BudgetFold.box(); if (!box) return null;
    const num = (el) => parseFloat(el && el.value) || 0;
    const inc = num(box.querySelector('#bi_income'));
    let budget = 0;
    box.querySelectorAll('#budgetInputs input').forEach((el) => { if (el.id !== 'bi_income') budget += num(el); });
    const lab = (box.querySelector('#budgetInputs label') || {}).textContent || '';
    const cur = (lab.match(/\(([^)]{1,3})\)/) || [])[1] || '';
    return { inc, budget, cur };
  },
  /* Whether a budget is saved is decided when the tab loads and when Save is
     pressed — never while typing, or the first digit typed into an empty
     form would fold it shut under your thumb. */
  paint(decide) {
    const box = BudgetFold.box(); if (!box) return;
    const t = BudgetFold.totals();
    if (decide) box.classList.toggle('bf-set', !!(t && (t.inc || t.budget)));
    const set = box.classList.contains('bf-set');
    const sum = box.querySelector('.bf-sum');
    const fmt = (n) => t.cur + Math.round(n).toLocaleString();
    if (sum) sum.textContent = set ? fmt(t.budget) + ' budgeted' + (t.inc ? ' · ' + fmt(t.inc) + ' income' : '') : '';
    const tog = box.querySelector('.bf-tog');
    if (tog) { tog.hidden = !set; tog.textContent = box.classList.contains('bf-open') ? 'Done' : 'Edit'; tog.setAttribute('aria-expanded', box.classList.contains('bf-open') ? 'true' : 'false'); }
  },
  boot() {
    const box = BudgetFold.box();
    if (!box || box.dataset.fold) return;
    box.dataset.fold = '1';
    const h = box.querySelector('h3');
    if (!h) return;
    const head = document.createElement('div'); head.className = 'bf-head';
    h.parentNode.insertBefore(head, h); head.appendChild(h);
    const sum = document.createElement('div'); sum.className = 'bf-sum'; head.appendChild(sum);
    const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'bf-tog'; head.appendChild(tog);
    tog.addEventListener('click', () => { box.classList.toggle('bf-open'); BudgetFold.paint(); });
    const save = box.querySelector('#fnSaveBudget');
    if (save) save.addEventListener('click', () => setTimeout(() => { box.classList.remove('bf-open'); BudgetFold.paint(true); }, 30));
    box.addEventListener('input', () => BudgetFold.paint());
    const inputs = box.querySelector('#budgetInputs');
    if (inputs && window.MutationObserver) new MutationObserver(() => BudgetFold.paint(true)).observe(inputs, { childList: true });
    BudgetFold.paint(true);
  }
};

/* ── An empty number looks empty ─────────────────────────────────────────
 * A stat with no data shows "—". Drawn at 32px in the stat's own colour, the
 * dash read as a coloured bar — a reading, not an absence. Empty values are
 * marked so they draw as a quiet grey dash with "no data yet" under it. */
const EmptyStat = {
  SEL: '.stat .num, .wm-num, .whoop-ring-num',
  mark(el) {
    const t = (el.textContent || '').trim();
    const empty = t === '' || t === '—' || t === '–' || t === '-';
    el.classList.toggle('is-empty', empty);
    if (empty && !el.hasAttribute('data-empty')) el.setAttribute('data-empty', 'no data yet');
  },
  boot() {
    document.querySelectorAll(EmptyStat.SEL).forEach(EmptyStat.mark);
    if (!window.MutationObserver) return;
    const mo = new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (el && el.matches && el.matches(EmptyStat.SEL)) EmptyStat.mark(el);
        else if (el && el.querySelectorAll) el.querySelectorAll(EmptyStat.SEL).forEach(EmptyStat.mark);
      }
    });
    document.querySelectorAll('.section, .flow-section').forEach((sec) => mo.observe(sec, { childList: true, characterData: true, subtree: true }));
  }
};

/* ── Your photo, without Google ──────────────────────────────────────────
 * The face in the corner used to appear only once Google was connected. Now
 * it can be any picture: cropped square, shrunk to 320px and kept with the
 * account (about 20 KB), so every device shows the same face. */
const Photo = {
  KEY: 'flow:photo',
  data: null,
  async load() {
    try { Photo.data = await DB.get(Photo.KEY, null); } catch (e) {}
    try { Connect.paintFace(); } catch (e) {}
  },
  shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const S = 320, side = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas'); c.width = S; c.height = S;
        const g = c.getContext('2d');
        g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this device can read.')); };
      img.src = url;
    });
  },
  pick() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      try {
        await Photo.use(await Photo.shrink(f));
        toast('Photo updated ✓');
        if (Nav.menuEl && Nav.menuEl.classList.contains('on')) Nav.openMenu();
      } catch (e) { toast(e.message || 'Could not use that picture.', 'err', 4000); }
    });
    inp.click();
  },
  async use(data) {
    await DB.set(Photo.KEY, data);
    Photo.data = data;
    Connect.paintFace();
  },
  async clear() {
    try { await DB.set(Photo.KEY, null); } catch (e) {}
    Photo.data = null;
    Connect.paintFace();
    toast('Photo removed');
    if (Nav.menuEl && Nav.menuEl.classList.contains('on')) Nav.openMenu();
  }
};

/* ── Sheets above the iPhone keyboard ────────────────────────────────────
 * iOS does not shrink the page when the keyboard opens; it slides the
 * keyboard over it. A sheet pinned to the bottom of the page ended up with
 * its Back / Save buttons underneath the keys. The visual viewport says how
 * much is really visible: the sheet's bottom is lifted by the keyboard's
 * height and its height capped to what is left. Opening and closing a sheet
 * also puts the page back where it was — focusing a field had scrolled it. */
const SheetKB = {
  y: null,
  update() {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', (kb > 60 ? kb : 0) + 'px');
    root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    root.classList.toggle('fl-kb', kb > 60);
  },
  boot() {
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', SheetKB.update); vv.addEventListener('scroll', SheetKB.update); }
    SheetKB.update();
    if (!window.MutationObserver) return;
    const anyOpen = () => !!document.querySelector('.fn-sheetwrap.on');
    let was = false;
    new MutationObserver(() => {
      const now = anyOpen();
      if (now && !was) SheetKB.y = window.scrollY;
      if (!now && was && SheetKB.y != null) { const y = SheetKB.y; SheetKB.y = null; requestAnimationFrame(() => window.scrollTo(0, y)); }
      was = now;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
};

/* ── Lead with the thing you came to do ─────────────────────────────────
 * Habits opened on four statistics; the habits themselves were below the
 * fold on a phone. The tiles now follow the list. And an unconnected WHOOP
 * panel — an empty ring, four dashes and a five-field form — took a screen
 * of the Body log before anything you could act on. With no WHOOP numbers
 * and no connection it folds to one line and an "Enter by hand" button. */
const LeadFirst = {
  habits() {
    const sec = document.getElementById('tab-habits');
    const stats = sec && sec.querySelector(':scope > .stats');
    const anchor = sec && (sec.querySelector('#hbEmpty') || sec.querySelector('#habitsList'));
    if (stats && anchor && !stats.dataset.moved) { anchor.after(stats); stats.dataset.moved = '1'; stats.classList.add('lf-after'); }
  },
  whoop() {
    const panel = document.getElementById('whoopPanel');
    if (!panel) return;
    let live = false, w = {};
    try { live = !!eval('whoopLive'); w = eval('whoopData') || {}; } catch (e) {}
    const empty = !live && ['recovery', 'strain', 'sleep', 'hrv', 'rhr'].every((k) => w[k] == null);
    panel.classList.toggle('wh-empty', empty);
    let b = panel.querySelector('.wh-hand');
    if (empty && !b) {
      b = document.createElement('button'); b.type = 'button'; b.className = 'btn wh-hand';
      b.textContent = 'Enter WHOOP numbers by hand';
      b.addEventListener('click', () => { panel.classList.toggle('wh-open'); b.textContent = panel.classList.contains('wh-open') ? 'Hide' : 'Enter WHOOP numbers by hand'; });
      const top = panel.querySelector('.whoop-top');
      (top || panel).after(b);
    }
    if (!empty && b) { b.remove(); panel.classList.remove('wh-open'); }
  },
  boot() {
    LeadFirst.habits();
    try {
      const orig = window.paintWhoop;
      if (typeof orig === 'function' && !orig.__lf) {
        const wrapped = function () { const r = orig.apply(this, arguments); try { LeadFirst.whoop(); } catch (e) {} return r; };
        wrapped.__lf = 1; window.paintWhoop = wrapped;
      }
    } catch (e) {}
    LeadFirst.whoop();
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-tab="sleep"], [data-fn-side="sleep"], [data-fn-seg="sleep"]')) setTimeout(LeadFirst.whoop, 50); }, true);
  }
};

/* ── Drop, delegate, move ─────────────────────────────────────────────────
 * Ticking was the only way to get a Big Rock off the list, so a rock you had
 * decided against looked finished, and one somebody else was doing looked
 * like yours. Each rock now has a ⋯ (and on a phone, a swipe to the left):
 *
 *   Move      tomorrow, next week, or any day — it goes with its time and note.
 *   Delegate  to a person, with a day to check back. It leaves your list and
 *             waits on Today under "Waiting on" until they have done it (tick:
 *             it counts as done in its week) or you take it back.
 *   Drop      not doing it. It leaves every list and count, and is kept under
 *             "Dropped" in the week, where it can be put back.
 *
 * Dropped and delegated rocks are moved out of the week (`cData.aside`), not
 * flagged inside it. That is the whole design: every screen that reads the
 * week — Today, the strip, Coming up, the widget, reminders, the watch, an
 * assistant — already leaves them out, without any of them having to know.
 * Nothing is deleted, and every action can be undone for a few seconds. */
const RockActions = {
  el: null, cur: null, undoT: null,
  data() { return (typeof cData !== 'undefined' && cData) ? cData : null; },
  aside() { const c = RockActions.data(); if (!c) return []; if (!Array.isArray(c.aside)) c.aside = []; return c.aside; },
  find(id) {
    const c = RockActions.data(); if (!c || !c.rocks) return null;
    for (const w of Object.keys(c.rocks)) { const i = (c.rocks[w] || []).findIndex((x) => x && String(x.id) === String(id)); if (i >= 0) return { w, i, r: c.rocks[w][i] }; }
    return null;
  },
  monday(wid) {
    const m = String(wid || '').match(/^(\d{4})-W(\d{2})$/); if (!m) return null;
    const jan4 = new Date(+m[1], 0, 4);
    const mon = new Date(jan4); mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (+m[2] - 1) * 7);
    return mon;
  },
  dateOf(wid, day) { const m = RockActions.monday(wid); if (!m) return null; const d = new Date(m); d.setDate(m.getDate() + (day >= 0 ? day : 0)); return d; },
  iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  fromIso(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; },
  label(d) {
    if (!d) return '';
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const n = Math.round((x - t) / 864e5);
    if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
    return DOW[x.getDay()] + ' ' + x.getDate() + ' ' + x.toLocaleDateString('en-GB', { month: 'short' });
  },
  save(what) {
    try { cSave(); } catch (e) {}
    try { if (what && typeof J === 'function') J('planning', what); } catch (e) {}
    RockActions.rerender();
  },
  rerender() {
    try { if (typeof renderToday === 'function') renderToday(); } catch (e) {}
    try { if (typeof renderCompass === 'function') renderCompass(); } catch (e) {}
    try { TodayLook.paint(); } catch (e) {}
    try { RockActions.paint(); } catch (e) {}
  },

  /* ---- what the ⋯ does ---- */
  move(id, date) {
    const hit = RockActions.find(id); if (!hit || !date) return;
    const c = RockActions.data();
    const before = { w: hit.w, day: hit.r.day };
    const to = weekId(date), day = (date.getDay() + 6) % 7;
    c.rocks[hit.w].splice(hit.i, 1);
    if (!c.rocks[to]) c.rocks[to] = [];
    hit.r.day = day; hit.r.done = false; hit.r.moved = (hit.r.moved || 0) + 1;   /* the review counts carry-overs */
    c.rocks[to].push(hit.r);
    RockActions.save('➡️ Big rock moved to ' + RockActions.label(date) + ': ' + hit.r.title);
    RockActions.undo('Moved to ' + RockActions.label(date), () => {
      const h2 = RockActions.find(id); if (!h2) return;
      c.rocks[h2.w].splice(h2.i, 1);
      if (!c.rocks[before.w]) c.rocks[before.w] = [];
      h2.r.day = before.day; c.rocks[before.w].push(h2.r);
      RockActions.save();
    });
  },
  setAside(id, status, extra) {
    const hit = RockActions.find(id); if (!hit) return;
    const c = RockActions.data();
    c.rocks[hit.w].splice(hit.i, 1);
    const rec = Object.assign({}, hit.r, { wid: hit.w, status, at: new Date().toISOString() }, extra || {});
    RockActions.aside().push(rec);
    RockActions.save(status === 'dropped' ? '🗑️ Big rock dropped: ' + hit.r.title : '🤝 Big rock delegated to ' + rec.to + ': ' + hit.r.title);
    RockActions.undo(status === 'dropped' ? 'Dropped' : 'Delegated to ' + rec.to, () => RockActions.putBack(id, { silent: true }));
  },
  /* Back into the week it came from — or, for one taken back from a week
     that is over, onto today, because a rock nobody is doing is yours now. */
  putBack(id, opts) {
    opts = opts || {};
    const list = RockActions.aside();
    const i = list.findIndex((x) => String(x.id) === String(id)); if (i < 0) return;
    const rec = list.splice(i, 1)[0];
    if (rec.ext) {
      /* Not a Big Rock: done means off every list; taken back means it is
         on Coming up again. */
      if (opts.done) RockActions.hidden().push({ key: rec.ext, at: new Date().toISOString(), done: true });
      RockActions.save(opts.silent ? '' : opts.done ? '✅ Done (' + (rec.to || 'someone') + '): ' + rec.title : '↩️ Back on Coming up: ' + rec.title);
      try { Ahead.paint(); } catch (e) {}
      return;
    }
    const c = RockActions.data();
    let w = rec.wid, day = rec.day;
    const now = weekId(new Date());
    if (!opts.done && !opts.silent && w < now) { w = now; day = (new Date().getDay() + 6) % 7; }
    const r = Object.assign({}, rec); ['wid', 'status', 'at', 'to', 'follow'].forEach((k) => delete r[k]);
    r.day = day; r.done = !!opts.done;
    if (!c.rocks[w]) c.rocks[w] = [];
    c.rocks[w].push(r);
    RockActions.save(opts.silent ? '' : opts.done ? '✅ Delegated Big rock done (' + (rec.to || 'someone') + '): ' + rec.title : '↩️ Big rock back on the list: ' + rec.title);
  },

  /* ---- undo ---- */
  undo(msg, fn) {
    let bar = document.getElementById('ra-undo');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'ra-undo'; bar.className = 'flow-x'; bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }
    bar.innerHTML = '<span>' + esc(msg) + '</span><button type="button">Undo</button>';
    bar.classList.add('on');
    clearTimeout(RockActions.undoT);
    const hide = () => bar.classList.remove('on');
    bar.querySelector('button').onclick = () => { clearTimeout(RockActions.undoT); hide(); try { fn(); } catch (e) {} };
    RockActions.undoT = setTimeout(hide, 6500);
  },

  /* ---- the sheet ---- */
  open(id) {
    const hit = RockActions.find(id); if (!hit) return;
    RockActions.cur = id;
    if (!RockActions.el) RockActions.build();
    const d = RockActions.dateOf(hit.w, hit.r.day);
    const el = RockActions.el;
    el.querySelector('h4').textContent = String(hit.r.title || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    el.querySelector('.fn-sub').textContent = (hit.r.day >= 0 ? RockActions.label(d) : 'No day set') + (hit.r.time ? ' · ' + hit.r.time : '') + (hit.r.done ? ' · done' : '');
    const t = new Date(); t.setDate(t.getDate() + 1);
    el.querySelector('#ra-date').value = RockActions.iso(t);
    el.querySelector('#ra-date').min = RockActions.iso(new Date());
    el.querySelector('#ra-who').value = '';
    el.querySelector('#ra-follow').value = RockActions.iso(t);
    let names = [];
    try { names = (Friends.list || []).map((f) => f && (f.name || f.byName)).filter(Boolean); } catch (e) {}
    RockActions.aside().forEach((a) => { if (a.to && names.indexOf(a.to) < 0) names.push(a.to); });
    el.querySelector('#ra-people').innerHTML = names.slice(0, 20).map((n) => '<option value="' + esc(n) + '">').join('');
    RockActions.item = null;
    el.querySelector('.ra-mv').hidden = false;
    /* Repeat is Simple's: the section shows there, the chain works everywhere. */
    const rep = el.querySelector('.ra-repwrap');
    rep.hidden = !TodayLook.on() || hit.r.day == null || hit.r.day < 0;
    rep.innerHTML = rep.hidden ? '' : Repeat.sectionHtml(hit.r, d);
    el.querySelector('.ra-dropsub').textContent = 'Not doing it. Leaves the list without counting as done';
    RockActions.notesFill(hit.r);
    RockActions.mode('main');
    el.classList.add('on');
    setTimeout(() => { const b = el.querySelector('[data-ra="tomorrow"]'); if (b && matchMedia('(hover:hover)').matches) b.focus(); }, 60);
  },

  /* ---- something in Coming up that is not a Big Rock ----
     A calendar event or a dated task lives somewhere else (the calendar, the
     planner), so it is not moved or deleted from here. Delegating it puts it
     under Waiting on with a day to check back; dropping it takes it off
     Coming up. Both can be undone, and Put back brings it back. */
  hidden() { const c = RockActions.data(); if (!c) return []; if (!Array.isArray(c.aheadHidden)) c.aheadHidden = []; return c.aheadHidden; },
  isHidden(key) {
    if (RockActions.hidden().some((h) => h && h.key === key)) return true;
    return RockActions.aside().some((a) => a && a.ext === key);
  },
  openItem(it) {
    if (!it) return;
    if (it.kind === 'rock' && it.rockId) return RockActions.open(it.rockId);
    if (!RockActions.el) RockActions.build();
    const el = RockActions.el;
    RockActions.cur = 'ext:' + it.key; RockActions.item = it;
    el.querySelector('h4').textContent = it.title;
    const d = RockActions.fromIso(it.date);
    el.querySelector('.fn-sub').textContent = RockActions.label(d) + (it.time ? ' · ' + it.time : '') + (it.kind === 'event' ? ' · Calendar' : ' · Task');
    el.querySelector('.ra-mv').hidden = true;
    el.querySelector('.ra-repwrap').hidden = true;
    RockActions.notesFill(null);
    el.querySelector('.ra-dropsub').textContent = it.kind === 'event' ? 'Not going. It stays in your calendar; Coming up stops listing it' : 'Not doing it. Coming up stops listing it';
    const t = new Date(); t.setDate(t.getDate() + 1);
    el.querySelector('#ra-who').value = '';
    el.querySelector('#ra-follow').value = it.date && it.date > RockActions.iso(new Date()) ? RockActions.iso(new Date(Math.max(t.getTime(), RockActions.fromIso(it.date).getTime() - 864e5))) : RockActions.iso(t);
    let names = [];
    try { names = (Friends.list || []).map((f) => f && (f.name || f.byName)).filter(Boolean); } catch (e) {}
    RockActions.aside().forEach((a) => { if (a.to && names.indexOf(a.to) < 0) names.push(a.to); });
    el.querySelector('#ra-people').innerHTML = names.slice(0, 20).map((n) => '<option value="' + esc(n) + '">').join('');
    RockActions.mode('main');
    el.classList.add('on');
  },
  asideItem(it, status, extra) {
    const d = RockActions.fromIso(it.date) || new Date();
    const rec = Object.assign({ id: 'x' + Date.now().toString(36), title: it.title, wid: weekId(d), day: (d.getDay() + 6) % 7, time: it.time || '', date: it.date, ext: it.key, kind: it.kind, status, at: new Date().toISOString() }, extra || {});
    RockActions.aside().push(rec);
    RockActions.save(status === 'dropped' ? '🗑️ Dropped from Coming up: ' + it.title : '🤝 Delegated to ' + rec.to + ': ' + it.title);
    RockActions.undo(status === 'dropped' ? 'Dropped' : 'Delegated to ' + rec.to, () => {
      const list = RockActions.aside(); const i = list.findIndex((x) => x.id === rec.id);
      if (i >= 0) list.splice(i, 1);
      RockActions.save();
    });
    try { Ahead.paint(); } catch (e) {}
  },
  close() {
    RockActions.noteFlush(true);
    if (RockActions.el) RockActions.el.classList.remove('on'); RockActions.cur = null; RockActions.item = null;
    /* A note saved while typing shows on the row once the sheet goes down. */
    if (RockActions.noteChanged) { RockActions.noteChanged = false; RockActions.rerender(); }
  },

  /* ---- notes and links on a Priority (Simple) ----
     The note is the rock's own `note` — the same one Advanced edits and the
     calendar export carries. Links are kept apart, in `links`, so they can be
     shown as links (blue, tappable) on the row, the way Work's tasks do. */
  notesFill(r) {
    const el = RockActions.el; if (!el) return;
    const box = el.querySelector('.ra-notes');
    box.hidden = !r || !TodayLook.on();
    clearTimeout(RockActions.noteT); RockActions.noteDirty = false;
    if (box.hidden) return;
    el.querySelector('#ra-note').value = r.note || '';
    el.querySelector('#ra-link').value = '';
    RockActions.linksPaint(r);
  },
  linksPaint(r) {
    const list = Array.isArray(r && r.links) ? r.links : [];
    RockActions.el.querySelector('.ra-links').innerHTML = list.map((u, i) =>
      '<div class="ra-lk">' + Nav.svg('link') + '<a class="flow-link ra-link" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(RockActions.linkLabel(u)) + '</a>' +
      '<button type="button" class="ra-lkx" data-ra-unlink="' + i + '" aria-label="Remove this link">×</button></div>').join('');
  },
  linkLabel(u) {
    try { const x = new URL(u); const p = (x.pathname === '/' ? '' : x.pathname) + x.search; return (x.hostname.replace(/^www\./, '') + p).slice(0, 70) + ((x.hostname + p).length > 70 ? '…' : ''); } catch (e) { return String(u).slice(0, 70); }
  },
  /* "theflow.today/x" and "www…" become https://; anything that is not a
     web address (javascript:, mailto: lookalikes, plain words) is refused. */
  linkClean(v) {
    let u = String(v || '').trim(); if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol) || !/\./.test(x.hostname)) return ''; return x.href.slice(0, 2000); } catch (e) { return ''; }
  },
  linkAdd() {
    const el = RockActions.el, id = RockActions.cur, hit = id && !RockActions.item && RockActions.find(id); if (!hit) return;
    const inp = el.querySelector('#ra-link');
    const u = RockActions.linkClean(inp.value);
    if (!u) { inp.focus(); toast('That does not look like a link.', 'warn'); return; }
    if (!Array.isArray(hit.r.links)) hit.r.links = [];
    if (hit.r.links.indexOf(u) < 0) { if (hit.r.links.length >= 20) { toast('Twenty links is the most one Priority keeps.', 'warn'); return; } hit.r.links.push(u); }
    inp.value = '';
    RockActions.noteFlush(true);
    RockActions.save();
    RockActions.linksPaint(hit.r);
  },
  linkDrop(i) {
    const id = RockActions.cur, hit = id && RockActions.find(id); if (!hit || !Array.isArray(hit.r.links)) return;
    hit.r.links.splice(i, 1); if (!hit.r.links.length) delete hit.r.links;
    RockActions.save();
    RockActions.linksPaint(hit.r);
  },
  /* Typing saves itself a moment after the last key, and on close. */
  noteFlush(quiet) {
    clearTimeout(RockActions.noteT);
    if (!RockActions.noteDirty) return;
    RockActions.noteDirty = false;
    const el = RockActions.el, id = RockActions.cur, hit = el && id && !RockActions.item && RockActions.find(id); if (!hit) return;
    const v = String(el.querySelector('#ra-note').value || '').replace(/\s+$/, '').slice(0, 4000);
    if (v === String(hit.r.note || '')) return;
    hit.r.note = v;
    if (quiet) { try { cSave(); } catch (e) {} RockActions.noteChanged = true; return; }
    RockActions.save();
  },
  mode(m) {
    const el = RockActions.el; if (!el) return;
    el.querySelector('.ra-main').hidden = m !== 'main';
    el.querySelector('.ra-del').hidden = m !== 'delegate';
    if (m === 'delegate') setTimeout(() => el.querySelector('#ra-who').focus(), 60);
  },
  build() {
    const wrap = document.createElement('div');
    wrap.id = 'flow-ra'; wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-ra="close"></div>' +
      '<div class="fn-sheet" role="dialog" aria-modal="true" aria-label="Big Rock">' +
        '<div class="fn-grab" data-ra="close"></div>' +
        '<button type="button" class="fn-capture-close" data-ra="close" aria-label="Close">×</button>' +
        '<h4></h4><div class="fn-sub"></div>' +
        '<div class="ra-main">' +
          '<div class="ra-mv"><div class="ra-k">Move</div>' +
          '<div class="ra-row">' +
            '<button type="button" class="flow-btn" data-ra="tomorrow">Tomorrow</button>' +
            '<button type="button" class="flow-btn" data-ra="nextweek">Next week</button>' +
            '<label class="ra-pick"><span>Pick a day</span><input type="date" id="ra-date" aria-label="Move to this day"></label>' +
            '<button type="button" class="flow-btn" data-ra="moveto">Move</button>' +
          '</div></div>' +
          '<div class="ra-repwrap" hidden></div>' +
          '<div class="ra-notes" hidden>' +
            '<div class="ra-k">Notes</div>' +
            '<textarea id="ra-note" class="flow-in ra-note" rows="3" maxlength="4000" placeholder="Details, context, who to ask, what done looks like…" aria-label="Notes for this Priority"></textarea>' +
            '<div class="ra-k">Links</div>' +
            '<div class="ra-links"></div>' +
            '<div class="ra-row ra-linkadd">' +
              '<input type="url" id="ra-link" class="flow-in" inputmode="url" autocomplete="off" placeholder="Paste a link" aria-label="Add a link">' +
              '<button type="button" class="flow-btn" data-ra="addlink">Add link</button>' +
            '</div>' +
          '</div>' +
          '<div class="ra-k">Hand it off</div>' +
          '<button type="button" class="flow-btn ra-wide" data-ra="delegate">Delegate…<small>Someone else does it; you check back</small></button>' +
          '<div class="ra-k">Let it go</div>' +
          '<button type="button" class="flow-btn ra-wide ra-drop" data-ra="drop">Drop it<small class="ra-dropsub">Not doing it. Leaves the list without counting as done</small></button>' +
        '</div>' +
        '<form class="ra-del" hidden>' +
          '<label class="flow-label" for="ra-who">Who is doing it?</label>' +
          '<input type="text" id="ra-who" class="flow-in" maxlength="60" list="ra-people" autocomplete="off" placeholder="A name">' +
          '<datalist id="ra-people"></datalist>' +
          '<label class="flow-label" for="ra-follow">Check back</label>' +
          '<div class="ra-row">' +
            '<button type="button" class="flow-btn sm" data-ra="f1">Tomorrow</button>' +
            '<button type="button" class="flow-btn sm" data-ra="f3">In 3 days</button>' +
            '<button type="button" class="flow-btn sm" data-ra="f7">Next week</button>' +
            '<input type="date" id="ra-follow" class="flow-in" aria-label="Check back on">' +
          '</div>' +
          '<div class="ra-row ra-end">' +
            '<button type="button" class="flow-btn" data-ra="back">Back</button>' +
            '<button type="submit" class="flow-btn primary">Delegate</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(wrap);
    RockActions.el = wrap;
    const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
    wrap.addEventListener('click', (e) => {
      const rep = e.target.closest('[data-ra-rep]');
      if (rep && RockActions.cur && !RockActions.item) {
        const id = RockActions.cur;
        Repeat.set(id, rep.getAttribute('data-ra-rep') || '');
        const h2 = RockActions.find(id);
        if (h2) wrap.querySelector('.ra-repwrap').innerHTML = Repeat.sectionHtml(h2.r, RockActions.dateOf(h2.w, h2.r.day));
        return;
      }
      const un = e.target.closest('[data-ra-unlink]');
      if (un) return RockActions.linkDrop(+un.getAttribute('data-ra-unlink'));
      const b = e.target.closest('[data-ra]'); if (!b) return;
      const a = b.getAttribute('data-ra'), id = RockActions.cur;
      if (a === 'close') return RockActions.close();
      if (a === 'addlink') return RockActions.linkAdd();
      if (a === 'back') return RockActions.mode('main');
      if (a === 'delegate') return RockActions.mode('delegate');
      if (/^f\d$/.test(a)) { wrap.querySelector('#ra-follow').value = RockActions.iso(plus(+a.slice(1))); return; }
      if (!id) return;
      if (a === 'tomorrow') { RockActions.close(); return RockActions.move(id, plus(1)); }
      if (a === 'nextweek') { const d = new Date(); d.setDate(d.getDate() + (7 - (d.getDay() + 6) % 7)); RockActions.close(); return RockActions.move(id, d); }
      if (a === 'moveto') { const d = RockActions.fromIso(wrap.querySelector('#ra-date').value); if (!d) return; RockActions.close(); return RockActions.move(id, d); }
      if (a === 'drop') { const it = RockActions.item; RockActions.close(); return it ? RockActions.asideItem(it, 'dropped') : RockActions.setAside(id, 'dropped'); }
    });
    wrap.querySelector('#ra-note').addEventListener('input', () => {
      RockActions.noteDirty = true; clearTimeout(RockActions.noteT);
      RockActions.noteT = setTimeout(() => RockActions.noteFlush(true), 600);
    });
    wrap.querySelector('#ra-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); RockActions.linkAdd(); } });
    wrap.querySelector('.ra-del').addEventListener('submit', (e) => {
      e.preventDefault();
      const who = wrap.querySelector('#ra-who').value.replace(/\s+/g, ' ').trim();
      if (!who) { wrap.querySelector('#ra-who').focus(); toast('Who is doing it?', 'warn'); return; }
      const id = RockActions.cur, it = RockActions.item; RockActions.close();
      const extra = { to: who.slice(0, 60), follow: wrap.querySelector('#ra-follow').value || '' };
      if (it) RockActions.asideItem(it, 'delegated', extra); else RockActions.setAside(id, 'delegated', extra);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) RockActions.close(); });
  },

  /* ---- the ⋯ on every rock ---- */
  more(id, label) { return '<button type="button" class="ra-more" data-ra-open="' + esc(String(id)) + '" aria-label="More for ' + esc(String(label || 'this Big Rock')) + '">' + Nav.svg('dots') + '</button>'; },
  decorate() {
    if (TodayLook.on()) { RockActions.rowLinks(); RockActions.addForm(); }
    document.querySelectorAll('#today-feed .td-rocks:not(#td-cal) .td-rock[data-rockid]').forEach((row) => {
      if (row.querySelector('.ra-more')) return;
      const t = row.querySelector('.rk-title');
      row.insertAdjacentHTML('beforeend', RockActions.more(row.getAttribute('data-rockid'), t && t.textContent.trim().slice(0, 60)));
    });
    document.querySelectorAll('#cGrid .chip.rock[data-rid]').forEach((ch) => {
      if (ch.querySelector('.ra-more')) return;
      ch.insertAdjacentHTML('beforeend', RockActions.more(ch.getAttribute('data-rid'), ch.textContent.trim().slice(0, 60)));
    });
  },

  /* A Priority's links, under its title on Today: blue, and they open. */
  rowLinks() {
    document.querySelectorAll('#today-feed .td-rocks:not(#td-cal) .td-rock[data-rockid]').forEach((row) => {
      const hit = RockActions.find(row.getAttribute('data-rockid'));
      const list = hit && Array.isArray(hit.r.links) ? hit.r.links : [];
      const sig = list.join('\n');
      let box = row.querySelector('.rk-links');
      if (box && box.getAttribute('data-sig') === sig) return;
      if (!list.length) { if (box) box.remove(); return; }
      const host = row.querySelector('.rk-title'); if (!host) return;
      if (!box) { box = document.createElement('div'); box.className = 'rk-links'; box.setAttribute('data-i18n', 'off'); host.appendChild(box); }
      box.setAttribute('data-sig', sig);
      box.innerHTML = list.map((u) => '<a class="flow-link" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + Nav.svg('link') + '<span>' + esc(RockActions.linkLabel(u)) + '</span></a>').join('');
    });
  },
  /* Add a Priority right on the card: today unless another day is picked. */
  addForm() {
    const card = document.querySelector('#today-feed .td-rocks:not(#td-cal)'); if (!card) return;
    let f = card.querySelector('.lk-rk-add');
    if (f && f === card.lastElementChild) return;
    if (!f) {
      f = document.createElement('form');
      f.className = 'lk-rk-add flow-x';
      f.setAttribute('data-flow-no-chip', '');
      const opts = [];
      for (let k = 0; k < 7; k++) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + k);
        opts.push('<option value="' + RockActions.iso(d) + '">' + (k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : esc(RockActions.label(d))) + '</option>');
      }
      f.innerHTML = '<input type="text" maxlength="200" placeholder="Add a Priority…" aria-label="Add a Priority" value="' + esc(RockActions.draft || '') + '">' +
        '<select aria-label="Which day">' + opts.join('') + '</select>' +
        '<button type="submit">Add</button>';
      f.addEventListener('input', (e) => { if (e.target.matches('input')) RockActions.draft = e.target.value; });
      f.addEventListener('submit', (e) => { e.preventDefault(); RockActions.addFromCard(f); });
    }
    card.appendChild(f);
  },
  addFromCard(f) {
    const inp = f.querySelector('input'), sel = f.querySelector('select');
    const title = String(inp.value || '').replace(/\s+/g, ' ').trim();
    if (!title) { inp.focus(); return; }
    const d = RockActions.fromIso(sel.value) || new Date();
    if (typeof addRock !== 'function') { toast('Open the Week Compass once, then try again.', 'warn'); return; }
    const roles = (typeof cData !== 'undefined' && Array.isArray(cData.roles)) ? cData.roles : [];
    addRock(title.slice(0, 200), roles[0] || '', (d.getDay() + 6) % 7, '', weekId(d), { prio: 'med' });
    RockActions.draft = '';
    inp.value = '';
    RockActions.rerender();
    const again = document.querySelector('#today-feed .lk-rk-add input');
    if (again) { try { again.focus({ preventScroll: true }); } catch (e) {} }
    toast(sel.selectedIndex === 0 ? 'Added to today.' : 'Added to ' + sel.options[sel.selectedIndex].text + '.', null, 1400);
  },

  /* ---- Waiting on (Today) and the week's set-aside list (Week Compass) ---- */
  waitingHtml() {
    const today = RockActions.iso(new Date());
    const list = RockActions.aside().filter((a) => a.status === 'delegated')
      .sort((a, b) => String(a.follow || '9').localeCompare(String(b.follow || '9')));
    if (!list.length) return '';
    const due = list.filter((a) => a.follow && a.follow <= today).length;
    return '<div class="flow-td-head"><span class="l">Waiting on</span><span class="c' + (due ? ' late' : '') + '">' + list.length + (due ? ' · ' + due + ' to check' : '') + '</span></div>' +
      list.map((a) => {
        const f = RockActions.fromIso(a.follow);
        const late = a.follow && a.follow <= today;
        return '<div class="flow-td-row ra-w' + (late ? ' od' : '') + '">' +
          '<button type="button" class="flow-today-check" role="checkbox" aria-checked="false" data-ra-done="' + esc(String(a.id)) + '" aria-label="' + esc(a.to) + ' did it: ' + esc(a.title) + '"><span class="bx" aria-hidden="true"></span></button>' +
          '<span class="tx">' + esc(String(a.title || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')) +
            '<small>' + esc(a.to) + (f ? ' · ' + (late ? 'check back ' + (a.follow === today ? 'today' : 'now') : 'check back ' + RockActions.label(f)) : '') + '</small></span>' +
          '<button type="button" class="ra-back" data-ra-back="' + esc(String(a.id)) + '">Take back</button>' +
        '</div>';
      }).join('');
  },
  paint() {
    try { Repeat.materialize(); } catch (e) { console.warn('[Flow] repeat', e); }
    try { if (TodayLook.on()) Repeat.decorate(); } catch (e) {}
    const feed = document.getElementById('today-feed');
    if (feed && feed.querySelector('.td-head')) {
      const html = RockActions.waitingHtml();
      let box = document.getElementById('flow-td-waiting');
      if (!html) { if (box) box.remove(); }
      else {
        if (!box) { box = document.createElement('div'); box.id = 'flow-td-waiting'; box.className = 'flow-td flow-td-sec flow-x'; }
        const after = document.getElementById('flow-td-ahead') || feed.querySelector('.td-rocks:not(#td-cal)') || feed.querySelector('.flow-td-pulse');
        if (after && after.parentNode === feed) { if (box.previousElementSibling !== after) after.after(box); }
        else if (!box.isConnected) feed.appendChild(box);
        TodayLook.put(box, html);
      }
    }
    RockActions.decorate();
    RockActions.paintCompass();
  },
  compassWeek() {
    try { return (typeof cOff !== 'undefined' && typeof tOffDate === 'function') ? weekId(tOffDate(cOff)) : weekId(new Date()); } catch (e) { return weekId(new Date()); }
  },
  paintCompass() {
    const grid = document.getElementById('cGrid'); if (!grid) return;
    const wid = RockActions.compassWeek();
    const list = RockActions.aside().filter((a) => a.wid === wid);
    let box = document.getElementById('ra-week');
    if (!list.length) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'ra-week'; box.className = 'flow-x ra-week'; }
    if (box.previousElementSibling !== grid) grid.after(box);
    const dropped = list.filter((a) => a.status === 'dropped'), del = list.filter((a) => a.status === 'delegated');
    const row = (a) => '<li class="' + a.status + '"><span class="ra-wt">' + esc(String(a.title || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')) + '</span>' +
      (a.status === 'delegated' ? '<span class="ra-wm">' + esc(a.to || '') + '</span>' : '') +
      '<button type="button" class="ra-back" data-ra-back="' + esc(String(a.id)) + '">' + (a.status === 'dropped' ? 'Put back' : 'Take back') + '</button></li>';
    const html = (del.length ? '<div class="ra-wh">Delegated · ' + del.length + '</div><ul>' + del.map(row).join('') + '</ul>' : '') +
      (dropped.length ? '<div class="ra-wh">Dropped · ' + dropped.length + '</div><ul>' + dropped.map(row).join('') + '</ul>' : '');
    TodayLook.put(box, html);
  },

  install() {
    if (RockActions._on) return; RockActions._on = true;
    ['renderToday', 'renderCompass'].forEach((fn) => {
      const orig = window[fn];
      if (typeof orig !== 'function' || orig.__raWrapped) return;
      const w = function () { const r = orig.apply(this, arguments); try { RockActions.paint(); } catch (e) {} return r; };
      Object.keys(orig).forEach((k) => { w[k] = orig[k]; });
      w.__raWrapped = 1;
      window[fn] = w;
    });
    /* Capture, so the ⋯ inside a row that ticks on a tap opens the sheet
       instead of ticking the rock. */
    document.addEventListener('click', (e) => {
      const ai = e.target.closest && e.target.closest('[data-ra-item]');
      if (ai) {
        e.preventDefault(); e.stopPropagation();
        const it = Ahead.items().find((x) => x.key === ai.getAttribute('data-ra-item'));
        if (it) RockActions.openItem(it);
        return;
      }
      const m = e.target.closest && e.target.closest('[data-ra-open]');
      if (m) { e.preventDefault(); e.stopPropagation(); RockActions.open(m.getAttribute('data-ra-open')); return; }
      const d = e.target.closest && e.target.closest('[data-ra-done]');
      if (d) { e.preventDefault(); e.stopPropagation(); RockActions.putBack(d.getAttribute('data-ra-done'), { done: true }); toast('Done ✓'); return; }
      const bk = e.target.closest && e.target.closest('[data-ra-back]');
      if (bk) { e.preventDefault(); e.stopPropagation(); RockActions.putBack(bk.getAttribute('data-ra-back')); }
    }, true);
    /* A phone: swipe a rock to the left. Stopped here so the same swipe does
       not also turn the page to the next section. */
    let sx = 0, sy = 0, row = null;
    document.addEventListener('touchstart', (e) => {
      row = null;
      const t = e.target.closest && e.target.closest('#today-feed .td-rocks:not(#td-cal) .td-rock[data-rockid], .lk-dv-row[data-rid]');
      if (!t || e.touches.length !== 1) return;
      row = t; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true, capture: true });
    document.addEventListener('touchend', (e) => {
      if (!row) return;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      const r = row; row = null;
      if (dx < -60 && Math.abs(dy) < 40 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        e.stopImmediatePropagation();
        RockActions.open(r.getAttribute('data-rockid') || r.getAttribute('data-rid'));
      }
    }, { capture: true });
    RockActions.paint();
  }
};
window.FlowRockActions = RockActions;

/* ── Repeat ───────────────────────────────────────────────────────────────
 * "Send the invoices to the accountant" is not one Big Rock, it is one a
 * month. A rock can repeat every week, every two weeks, or every month on
 * the same date; the ones in a chain share a `series`, and each carries the
 * rule. When the latest one is done — or its day has passed — the next one
 * is written on its day, and only the next one: a chain never has more than
 * one occurrence ahead, and a month nobody opened the app does not come back
 * as four overdue copies. Its id is the series and the date, so two devices
 * that both write it write the same rock, and nothing is written twice. */
const Repeat = {
  RULES: [['week', 'Every week'], ['2weeks', 'Every 2 weeks'], ['month', 'Every month']],
  /* Written in the page's language: the dictionary knows the sentence
     patterns; the weekday and the ordinal are made here so the Turkish
     reads "ayın 1'i", not "the 1st" with a Turkish frame around it. */
  label(rule, d) {
    const tr = (() => { try { return document.documentElement.lang === 'tr'; } catch (e) { return false; } })();
    const t = (k, v) => { try { return (window.FlowI18n && FlowI18n.t) ? FlowI18n.t(k, v) : k.replace('{}', v); } catch (e) { return k.replace('{}', v); } };
    const dow = d ? t(DOW[d.getDay()]) : '';
    if (rule === 'week') return d ? t('Every week on {}', dow) : t('Every week');
    if (rule === '2weeks') return d ? t('Every 2 weeks on {}', dow) : t('Every 2 weeks');
    if (rule === 'month') return d ? t('Every month on the {}', tr ? Repeat.ordTr(d.getDate()) : Repeat.ord(d.getDate())) : t('Every month');
    return '';
  },
  ord(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); },
  ordTr(n) { const u = { 1: "'i", 2: "'si", 3: "'ü", 4: "'ü", 5: "'i", 6: "'sı", 7: "'si", 8: "'i", 9: "'u", 10: "'u", 20: "'si", 30: "'u" }; return n + (u[n] || u[n % 10] || "'i"); },
  /* The next day after `d` the rule lands on. A month is the same date, or
     the last day of a shorter month (the 31st in April is the 30th). */
  next(d, rule) {
    const x = new Date(d); x.setHours(12, 0, 0, 0);
    if (rule === 'week') { x.setDate(x.getDate() + 7); return x; }
    if (rule === '2weeks') { x.setDate(x.getDate() + 14); return x; }
    if (rule === 'month') {
      const want = x.getDate();
      const y = new Date(x.getFullYear(), x.getMonth() + 1, 1, 12);
      const last = new Date(y.getFullYear(), y.getMonth() + 1, 0).getDate();
      y.setDate(Math.min(want, last));
      return y;
    }
    return null;
  },
  /* Every occurrence of every chain: in the weeks, and set aside. */
  members() {
    const c = RockActions.data(); if (!c || !c.rocks) return {};
    const by = {};
    const add = (r, w, where) => {
      if (!r || !r.repeat || r.day == null || r.day < 0) return;
      const d = RockActions.dateOf(w, r.day); if (!d) return;
      const s = String(r.series || r.id);
      (by[s] = by[s] || []).push({ r, w, d, where });
    };
    Object.keys(c.rocks).forEach((w) => (c.rocks[w] || []).forEach((r) => add(r, w, 'week')));
    RockActions.aside().forEach((a) => add(a, a.wid, 'aside'));
    return by;
  },
  /* Write the next occurrence of every chain whose latest one is finished
     with — done, set aside, or past its day. Catching up after a gap skips
     the days that are gone: the next one is the first on or after today. */
  busy: false,
  materialize(now) {
    if (Repeat.busy) return 0;
    const c = RockActions.data(); if (!c || !c.rocks) return 0;
    const today = new Date(now || Date.now()); today.setHours(0, 0, 0, 0);
    const by = Repeat.members();
    let wrote = 0;
    Object.keys(by).forEach((s) => {
      const list = by[s].sort((a, b) => a.d - b.d);
      const last = list[list.length - 1];
      const rule = last.r.repeat;
      if (!Repeat.RULES.some((x) => x[0] === rule)) return;
      const over = last.where === 'aside' || last.r.done || last.d < today;
      if (!over) return;
      let n = Repeat.next(last.d, rule);
      let guard = 0;
      while (n && n < today && guard++ < 400) n = Repeat.next(n, rule);
      if (!n) return;
      const id = s + '@' + RockActions.iso(n);
      if (RockActions.find(id) || RockActions.aside().some((a) => String(a.id) === id)) return;
      const w = weekId(n);
      const src = last.r;
      const r = { id, title: src.title, role: src.role || '', day: (n.getDay() + 6) % 7, time: src.time || '', end: src.end || '', prio: src.prio || 'med', note: src.note || '', done: false, repeat: rule, series: s };
      if (Array.isArray(src.links) && src.links.length) r.links = src.links.slice(0, 20);
      if (!c.rocks[w]) c.rocks[w] = [];
      c.rocks[w].push(r);
      wrote++;
    });
    if (wrote) {
      Repeat.busy = true;
      try { cSave(); } catch (e) {}
      try { RockActions.rerender(); } catch (e) {}
      Repeat.busy = false;
    }
    return wrote;
  },
  /* Set a rule on a rock (and the chain it belongs to), or take it off.
     Taking it off also removes the one ahead that was written by the rule
     and not yet touched — nobody asked for that one. */
  set(id, rule) {
    const hit = RockActions.find(id); if (!hit) return;
    const c = RockActions.data();
    const s = String(hit.r.series || hit.r.id);
    const d = RockActions.dateOf(hit.w, hit.r.day);
    if (rule) {
      hit.r.repeat = rule; hit.r.series = s;
      Object.keys(c.rocks).forEach((w) => (c.rocks[w] || []).forEach((r) => { if (r && String(r.series) === s && r !== hit.r && !r.done) r.repeat = rule; }));
      RockActions.save('🔁 Repeats, ' + Repeat.label(rule, d).toLowerCase() + ': ' + hit.r.title);
      Repeat.materialize();
      toast(Repeat.label(rule, d) + '.', null, 1800);
    } else {
      const prev = hit.r.repeat;
      const removed = [], cleared = [];
      Object.keys(c.rocks).forEach((w) => {
        c.rocks[w] = (c.rocks[w] || []).filter((r) => {
          if (!r || String(r.series) !== s) return true;
          const rd = RockActions.dateOf(w, r.day);
          if (r !== hit.r && !r.done && rd && d && rd > d && /@\d{4}-\d{2}-\d{2}$/.test(String(r.id))) { removed.push({ w, r }); return false; }
          if (r.repeat) { cleared.push(r); delete r.repeat; }
          return true;
        });
      });
      RockActions.save('🔁 No longer repeats: ' + hit.r.title);
      RockActions.undo(removed.length ? 'Stopped repeating · the next one removed' : 'Stopped repeating', () => {
        cleared.forEach((r) => { r.repeat = prev; });
        removed.forEach(({ w, r }) => { if (!c.rocks[w]) c.rocks[w] = []; c.rocks[w].push(r); });
        RockActions.save();
      });
    }
  },
  /* The Repeat section of the ⋯ sheet, for the rock that is open. */
  sectionHtml(r, d) {
    const cur = r.repeat || '';
    return '<div class="ra-k">Repeat</div><div class="ra-row ra-rep">' +
      '<button type="button" class="flow-btn sm' + (!cur ? ' on' : '') + '" data-ra-rep="" aria-pressed="' + !cur + '">Never</button>' +
      Repeat.RULES.map(([k, l]) => '<button type="button" class="flow-btn sm' + (cur === k ? ' on' : '') + '" data-ra-rep="' + k + '" aria-pressed="' + (cur === k) + '">' + l + '</button>').join('') +
      '</div>' + (cur ? '<div class="ra-repnote"><b data-i18n="off">' + esc(Repeat.label(cur, d)) + (r.time ? ' · ' + esc(r.time) : '') + '</b><span>The next one is written when this one is done.</span></div>' : '');
  },
  mark(r) { return r && r.repeat ? '<span class="rk-rep" title="' + esc(Repeat.label(r.repeat)) + '" aria-label="' + esc(Repeat.label(r.repeat)) + '">' + Nav.svg('refresh', 'rk-rep-i') + '</span>' : ''; },
  decorate() {
    document.querySelectorAll('#today-feed .td-rocks:not(#td-cal) .td-rock[data-rockid], .lk-dv-row[data-rid]').forEach((row) => {
      if (row.querySelector('.rk-rep')) return;
      const hit = RockActions.find(row.getAttribute('data-rockid') || row.getAttribute('data-rid'));
      if (!hit || !hit.r.repeat) return;
      const t = row.querySelector('.rk-title, .lk-dv-t');
      if (t) t.insertAdjacentHTML('beforeend', Repeat.mark(hit.r));
    });
  }
};
window.FlowRepeat = Repeat;

/* ── Meals: a plate, photographed, as numbers ────────────────────────────
 * The Diet checklist asked "did you have lunch?" and learned nothing. This
 * asks for a photo (or a line) and keeps what it is, the calories and the
 * protein, carbs and fat — an estimate, said so, and every number can be
 * changed before it is saved. The photo is never stored: it goes to the
 * server for one read and is forgotten; the account keeps the numbers.
 * Simple only. Free: three a week; Plus: as many as the day needs. */
const Meals = {
  KEY: 'flow:meals', data: null, el: null, img: null, est: null, busy: false,
  async load() { if (Meals.data) return Meals.data; try { Meals.data = (await DB.get(Meals.KEY, null)) || { v: 1, days: {} }; } catch (e) { Meals.data = { v: 1, days: {} }; } if (!Meals.data.days) Meals.data.days = {}; return Meals.data; },
  day(d) { const k = d || today(); const D = Meals.data || { days: {} }; return (D.days && D.days[k]) || []; },
  totals(d) { return Meals.day(d).reduce((a, m) => { a.kcal += +m.kcal || 0; a.protein += +m.protein || 0; a.carbs += +m.carbs || 0; a.fat += +m.fat || 0; a.n++; return a; }, { kcal: 0, protein: 0, carbs: 0, fat: 0, n: 0 }); },
  targets() { const s = (typeof Settings !== 'undefined' && Settings.data) || {}; return { kcal: +s.mealKcal > 0 ? +s.mealKcal : 0, protein: +s.mealProtein > 0 ? +s.mealProtein : 0 }; },
  fmt(n) { return Number(n || 0).toLocaleString('en-GB'); },
  async save() { try { await DB.set(Meals.KEY, Meals.data); } catch (e) {} Meals.paint(); },
  async add(m) {
    await Meals.load();
    const k = today(); if (!Meals.data.days[k]) Meals.data.days[k] = [];
    const now = new Date();
    const rec = { id: uid('m'), at: pad(now.getHours()) + ':' + pad(now.getMinutes()), name: m.name, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, confidence: m.confidence, items: (m.items || []).slice(0, 8) };
    Meals.data.days[k].push(rec);
    /* keep the account light: a season of days, not a lifetime */
    const keys = Object.keys(Meals.data.days).sort(); while (keys.length > 120) delete Meals.data.days[keys.shift()];
    await Meals.save();
    try { J('diet', '🍽️ ' + rec.name + ' · ' + rec.kcal + ' kcal'); } catch (e) {}
    Track.hit('meal_logged');
    return rec;
  },
  async remove(id) {
    await Meals.load();
    const k = today(); const list = Meals.data.days[k] || []; const i = list.findIndex((m) => m.id === id); if (i < 0) return;
    const [rec] = list.splice(i, 1);
    await Meals.save();
    RockActions.undo('Removed ' + rec.name, async () => { (Meals.data.days[k] = Meals.data.days[k] || []).splice(Math.min(i, Meals.data.days[k].length), 0, rec); await Meals.save(); });
  },

  /* ---- the card on Today ---- */
  cardHtml() {
    const t = Meals.totals(), T = Meals.targets(), list = Meals.day();
    const over = T.kcal && t.kcal > T.kcal;
    const head = t.n ? Meals.fmt(t.kcal) + ' kcal' + (t.protein ? ' · ' + t.protein + ' g protein' : '') : 'nothing logged';
    return '<div class="flow-td-head"><span class="l">Meals</span><span class="c' + (over ? ' late' : '') + '" data-i18n="off">' + esc(head) + '</span></div>' +
      (T.kcal ? '<div class="ml-bar' + (over ? ' over' : '') + '"><i style="width:' + Math.min(100, Math.round(t.kcal / T.kcal * 100)) + '%"></i></div><div class="ml-of" data-i18n="off">' + (over ? Meals.fmt(t.kcal - T.kcal) + ' kcal over ' + Meals.fmt(T.kcal) : Meals.fmt(Math.max(0, T.kcal - t.kcal)) + ' kcal left of ' + Meals.fmt(T.kcal)) + (T.protein ? ' · ' + (t.protein >= T.protein ? 'protein ✓' : (T.protein - t.protein) + ' g protein to go') : '') + '</div>' : '') +
      list.map((m) => '<div class="flow-td-row ml-row"><span class="tx" data-i18n="off">' + esc(m.name) + '<small>' + esc(m.at) + (m.protein ? ' · ' + m.protein + ' g protein' : '') + (m.confidence === 'low' ? ' · rough guess' : '') + '</small></span><span class="mt" data-i18n="off">' + Meals.fmt(m.kcal) + ' kcal</span><button type="button" class="ml-x" data-meal-x="' + esc(m.id) + '" aria-label="Remove ' + esc(m.name) + '">×</button></div>').join('') +
      '<button type="button" class="flow-empty-action ml-add" data-meal-open>' + Nav.svg('food') + '<span>Log a meal</span></button>';
  },
  paint() {
    const feed = document.getElementById('today-feed'); if (!feed) return;
    let box = document.getElementById('flow-td-meals');
    if (!TodayLook.on() || !Meals.data) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div'); box.id = 'flow-td-meals'; box.className = 'flow-td flow-td-sec flow-x';
      box.addEventListener('click', (e) => {
        const x = e.target.closest('[data-meal-x]'); if (x) { Meals.remove(x.getAttribute('data-meal-x')); return; }
        if (e.target.closest('[data-meal-open]')) Meals.open();
      });
    }
    /* where the Diet list was: after the day's training */
    const train = feed.querySelector('.td-group');
    const after = train || feed.querySelector('.td-rocks:not(#td-cal)');
    if (after && after.parentNode === feed) { if (box.previousElementSibling !== after) after.after(box); }
    else if (!box.isConnected) feed.appendChild(box);
    TodayLook.put(box, Meals.cardHtml());
  },

  /* ---- the sheet ---- */
  build() {
    if (Meals.el) return Meals.el;
    const wrap = document.createElement('div');
    wrap.id = 'flow-meal'; wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-ml="close"></div>' +
      '<div class="fn-sheet" role="dialog" aria-modal="true" aria-label="Log a meal">' +
        '<div class="fn-grab" data-ml="close"></div>' +
        '<button type="button" class="fn-capture-close" data-ml="close" aria-label="Close">×</button>' +
        '<h4>Log a meal</h4><div class="fn-sub">A photo, a few words, or both. The numbers are an estimate — change any of them before you save.</div>' +
        '<div class="ml-in">' +
          '<div class="ml-photo" data-ml-photo>' +
            '<div class="ml-ph-empty">' + Nav.svg('food') + '<b>Add a photo</b>' +
              /* Two doors on a phone: the camera straight away, or the library.
                 capture="environment" opens the back camera on iOS and Android;
                 a desktop has no camera to speak of and shows only the second. */
              '<div class="ml-ph-btns"><label class="ml-ph-btn ml-ph-cam"><input type="file" accept="image/*" capture="environment" id="ml-cam" aria-label="Take a photo of the meal">' + Nav.svg('camera', 'fn-i') + 'Take a photo</label>' +
              '<label class="ml-ph-btn"><input type="file" accept="image/*" id="ml-file" aria-label="Choose a photo of the meal">Choose a photo</label></div>' +
              '<small class="ml-ph-drop">or drop a picture here, or paste one</small>' +
            '</div>' +
            '<img alt="" hidden><button type="button" class="ml-ph-x" data-ml="unphoto" aria-label="Remove the photo" hidden>×</button>' +
          '</div>' +
          '<textarea class="flow-in" id="ml-text" rows="2" maxlength="300" placeholder="What is it, roughly? (optional) — e.g. menemen with two slices of bread"></textarea>' +
          '<div class="ra-row ra-end"><button type="button" class="flow-btn" data-ml="close">Not now</button><button type="button" class="flow-btn primary" data-ml="estimate">Estimate</button></div>' +
          '<div class="ml-err" hidden></div>' +
        '</div>' +
        '<div class="ml-out" hidden>' +
          '<input class="flow-in ml-name" id="ml-name" maxlength="80" aria-label="Meal">' +
          '<div class="ml-nums">' +
            '<label><input type="number" min="0" max="6000" step="10" id="ml-kcal" aria-label="Calories"><span>kcal</span></label>' +
            '<label><input type="number" min="0" max="500" id="ml-protein" aria-label="Protein"><span>protein g</span></label>' +
            '<label><input type="number" min="0" max="800" id="ml-carbs" aria-label="Carbs"><span>carbs g</span></label>' +
            '<label><input type="number" min="0" max="400" id="ml-fat" aria-label="Fat"><span>fat g</span></label>' +
          '</div>' +
          '<ul class="ml-items"></ul>' +
          '<div class="ml-conf"></div>' +
          '<div class="ra-row ra-end"><button type="button" class="flow-btn" data-ml="again">Start again</button><button type="button" class="flow-btn primary" data-ml="save">Save to today</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ml]'); if (!b) return;
      const a = b.getAttribute('data-ml');
      if (a === 'close') return Meals.close();
      if (a === 'unphoto') { e.preventDefault(); Meals.setImage(null); return; }
      if (a === 'estimate') return Meals.estimate();
      if (a === 'again') return Meals.reset();
      if (a === 'save') return Meals.commit();
    });
    ['#ml-file', '#ml-cam'].forEach((sel) => wrap.querySelector(sel).addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) Meals.pick(f); }));
    /* On a desktop a picture also arrives by dropping it on the sheet or
       pasting it (a screenshot, a photo copied from Photos). */
    const ph = wrap.querySelector('.ml-photo');
    ['dragenter', 'dragover'].forEach((ev) => wrap.addEventListener(ev, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); ph.classList.add('drop'); } }));
    ['dragleave', 'drop'].forEach((ev) => wrap.addEventListener(ev, () => ph.classList.remove('drop')));
    wrap.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files && [...e.dataTransfer.files].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); Meals.pick(f); } });
    wrap.addEventListener('paste', (e) => { const it = e.clipboardData && [...e.clipboardData.items].find((x) => /^image\//.test(x.type)); if (it) { const f = it.getAsFile(); if (f) { e.preventDefault(); Meals.pick(f); } } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) Meals.close(); });
    Meals.el = wrap;
    return wrap;
  },
  open() {
    if (!TodayLook.on()) return;
    Meals.build(); Meals.load();
    Meals.reset();
    Meals.el.classList.add('on');
    setTimeout(() => { const t = Meals.el.querySelector('#ml-text'); if (t && matchMedia('(hover:hover)').matches) t.focus(); }, 80);
  },
  close() { if (Meals.el) Meals.el.classList.remove('on'); },
  reset() {
    const el = Meals.el; if (!el) return;
    Meals.est = null; Meals.setImage(null);
    el.querySelector('#ml-text').value = '';
    el.querySelector('.ml-err').hidden = true;
    el.querySelector('.ml-in').hidden = false; el.querySelector('.ml-out').hidden = true;
    const btn = el.querySelector('[data-ml="estimate"]'); btn.disabled = false; btn.textContent = 'Estimate';
  },
  setImage(dataUrl) {
    Meals.img = dataUrl || null;
    const el = Meals.el; if (!el) return;
    const img = el.querySelector('.ml-photo img'), empty = el.querySelector('.ml-ph-empty'), x = el.querySelector('.ml-ph-x');
    if (dataUrl) { img.src = dataUrl; img.hidden = false; empty.hidden = true; x.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; empty.hidden = false; x.hidden = true; el.querySelector('#ml-file').value = ''; el.querySelector('#ml-cam').value = ''; }
  },
  /* The photo is shrunk here, on the device: a phone picture is 3–5 MB
     and the server takes 1; a thousand pixels is plenty to see a plate. */
  shrink(file, max, q) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const im = new Image();
      im.onload = () => {
        try {
          const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
          const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', q));
        } catch (e) { reject(e); }
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
      im.src = url;
    });
  },
  async pick(file) {
    try {
      let d = await Meals.shrink(file, 1024, 0.8);
      if (d.length > 850 * 1024) d = await Meals.shrink(file, 800, 0.6);
      Meals.setImage(d);
    } catch (e) { toast('That file is not a picture the app can read.', 'warn'); }
  },
  async estimate() {
    const el = Meals.el; if (!el || Meals.busy) return;
    const text = el.querySelector('#ml-text').value.trim();
    const err = el.querySelector('.ml-err'); err.hidden = true;
    if (!Meals.img && !text) { err.textContent = 'A photo, or a few words about the meal.'; err.hidden = false; return; }
    const btn = el.querySelector('[data-ml="estimate"]');
    Meals.busy = true; btn.disabled = true; btn.textContent = 'Reading the plate…';
    try {
      const r = await fetch('/api/flow/meal', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: Meals.img || undefined, text, lang: (document.documentElement.lang === 'tr' ? 'tr' : 'en') }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 402 && j.plus) { Meals.close(); Plus.open('meals'); return; }
      if (!r.ok || !j.meal) { err.textContent = j.error || 'The meal could not be read just now.'; err.hidden = false; return; }
      Meals.show(j.meal);
    } catch (e) { err.textContent = 'The meal could not be read just now.'; err.hidden = false; }
    finally { Meals.busy = false; btn.disabled = false; btn.textContent = 'Estimate'; }
  },
  show(m) {
    const el = Meals.el; Meals.est = m;
    el.querySelector('.ml-in').hidden = true; el.querySelector('.ml-out').hidden = false;
    el.querySelector('#ml-name').value = m.name || '';
    el.querySelector('#ml-kcal').value = m.kcal || 0; el.querySelector('#ml-protein').value = m.protein || 0; el.querySelector('#ml-carbs').value = m.carbs || 0; el.querySelector('#ml-fat').value = m.fat || 0;
    el.querySelector('.ml-items').innerHTML = (m.items || []).map((it) => '<li data-i18n="off"><span>' + esc(it.name) + (it.amount ? ' <small>' + esc(it.amount) + '</small>' : '') + '</span><b>' + Meals.fmt(it.kcal) + '</b></li>').join('');
    const conf = { low: 'A rough guess', medium: 'A fair estimate', high: 'A confident estimate' }[m.confidence] || 'An estimate';
    el.querySelector('.ml-conf').innerHTML = '<b>' + esc(conf) + '.</b>' + (m.note ? ' <span data-i18n="off">' + esc(m.note) + '</span>' : '');
  },
  async commit() {
    const el = Meals.el; if (!el || !Meals.est) return;
    const n = (id, max) => Math.max(0, Math.min(max, Math.round(+el.querySelector(id).value || 0)));
    const name = el.querySelector('#ml-name').value.replace(/\s+/g, ' ').trim().slice(0, 80) || Meals.est.name || 'Meal';
    const rec = await Meals.add({ name, kcal: n('#ml-kcal', 6000), protein: n('#ml-protein', 500), carbs: n('#ml-carbs', 800), fat: n('#ml-fat', 400), confidence: Meals.est.confidence, items: Meals.est.items });
    Meals.close();
    const t = Meals.totals();
    toast(rec.name + ' · ' + Meals.fmt(rec.kcal) + ' kcal. Today: ' + Meals.fmt(t.kcal) + ' kcal.', null, 2200);
  },
  boot() {
    Meals.load().then(() => Meals.paint());
  }
};
window.FlowMeals = Meals;

/* ── A habit you can do from the habit ──────────────────────────────────
 * "Write three sentences before bed" was a box to tick. Now the name is a
 * door: tap it and the thing itself is there — a place to write the three
 * sentences (saved to the journal), a timer for "Meditate 10 min", or, for
 * a habit that is just a habit, Done with an optional line. Saving ticks
 * today. Which door a habit opens is read from its name and can be changed
 * at the top of the sheet; the choice is kept with the account.
 * Simple only; Advanced ticks boxes as it always did. */
const HabitDo = {
  KEY: 'flow:habitkinds', kinds: null, el: null, cur: null, kind: 'tick', timer: null, left: 0, total: 0,
  KINDS: [['write', 'Write'], ['timer', 'Timer'], ['tick', 'Just tick']],
  async load() { if (HabitDo.kinds) return HabitDo.kinds; try { HabitDo.kinds = (await DB.get(HabitDo.KEY, null)) || {}; } catch (e) { HabitDo.kinds = {}; } return HabitDo.kinds; },
  host() { return { data: TodayPlus.host('hbData'), S: TodayPlus.host('S'), t: TodayPlus.host('todayStr') || today(), J: TodayPlus.host('J'), rh: TodayPlus.host('renderHabits') }; },
  habit(id) { const h = HabitDo.host(); return ((h.data && h.data.habits) || []).find((x) => x && x.id === id) || null; },
  done(id) { const h = HabitDo.host(); return !!(h.data && h.data.completions && h.data.completions[id] && h.data.completions[id][h.t]); },
  /* What the name says it is. */
  guess(name) {
    const n = String(name || '').toLowerCase();
    if (/\b(write|writ|journal|sentence|note|reflect|gratitude|diary)\b|yaz|günlük|cümle|not al|şükran/.test(n)) return 'write';
    if (/\b(meditat|breath|stretch|read|study|walk|run|practice|practise|yoga|min|minute)\w*|dakika|dk\b|oku|nefes|yürü|koş|meditasyon|esne|çalış/.test(n)) return 'timer';
    return 'tick';
  },
  minutes(name) { const m = /(\d{1,3})\s*(?:min|minute|dakika|dk)/i.exec(String(name || '')); const n = m ? +m[1] : 10; return Math.max(1, Math.min(180, n)); },
  kindOf(h) { const k = HabitDo.kinds && HabitDo.kinds[h.id]; return (k && HabitDo.KINDS.some(([x]) => x === k)) ? k : HabitDo.guess(h.name); },
  async setKind(id, kind) { await HabitDo.load(); HabitDo.kinds[id] = kind; try { await DB.set(HabitDo.KEY, HabitDo.kinds); } catch (e) {} },

  /* ---- the tick, the same one the box does ---- */
  tick(id, line) {
    const { data, S, t, J, rh } = HabitDo.host(); if (!data || !S) return false;
    data.completions = data.completions || {}; data.completions[id] = data.completions[id] || {};
    const was = !!data.completions[id][t];
    data.completions[id][t] = true;
    const h = HabitDo.habit(id);
    if (!was && typeof J === 'function' && h) { try { J('habits', '✅ ' + h.name + (line ? ' — ' + line : '')); } catch (e) {} }
    S.set('habits', data);
    try { if (typeof rh === 'function') rh(); } catch (e) {}
    try { if (typeof window.renderToday === 'function') window.renderToday(); } catch (e) {}
    return !was;
  },
  async journal(h, body, tags) {
    const now = new Date().toISOString();
    Journal.entries.push({ id: uid('j'), created: now, updated: now, date: today(), title: '', body, tags: ['habit'].concat(tags || []), prompts: {}, mood: null, energy: null });
    await Journal.save();
    try { Journal.rerender(); } catch (e) {}
  },

  /* ---- the sheet ---- */
  build() {
    if (HabitDo.el) return HabitDo.el;
    const wrap = document.createElement('div');
    wrap.id = 'flow-hdo'; wrap.className = 'fn-sheetwrap';
    wrap.innerHTML =
      '<div class="fn-scrim" data-hd="close"></div>' +
      '<div class="fn-sheet" role="dialog" aria-modal="true" aria-label="Habit">' +
        '<div class="fn-grab" data-hd="close"></div>' +
        '<button type="button" class="fn-capture-close" data-hd="close" aria-label="Close">×</button>' +
        '<div class="hd-k">Habit</div><h4 class="hd-name" data-i18n="off"></h4><div class="fn-sub hd-sub"></div>' +
        '<div class="hd-kinds" role="tablist"></div>' +
        '<div class="hd-body"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const k = e.target.closest('[data-hd-kind]');
      if (k) { HabitDo.kind = k.getAttribute('data-hd-kind'); HabitDo.setKind(HabitDo.cur, HabitDo.kind); HabitDo.paint(); return; }
      const b = e.target.closest('[data-hd]'); if (!b) return;
      const a = b.getAttribute('data-hd');
      if (a === 'close') return HabitDo.close();
      if (a === 'save') return HabitDo.saveWrite();
      if (a === 'start') return HabitDo.start();
      if (a === 'finish') return HabitDo.finish(true);
      if (a === 'done') return HabitDo.justDone();
    });
    wrap.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && HabitDo.kind === 'write') { e.preventDefault(); HabitDo.saveWrite(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) HabitDo.close(); });
    HabitDo.el = wrap;
    return wrap;
  },
  async open(id) {
    if (!TodayLook.on()) return;
    const h = HabitDo.habit(id); if (!h) return;
    await HabitDo.load();
    HabitDo.build();
    HabitDo.stopTimer();
    HabitDo.cur = id; HabitDo.kind = HabitDo.kindOf(h);
    HabitDo.paint();
    HabitDo.el.classList.add('on');
    setTimeout(() => { const ta = HabitDo.el.querySelector('#hd-text'); if (ta && matchMedia('(hover:hover)').matches) ta.focus(); }, 80);
  },
  close() { HabitDo.stopTimer(); if (HabitDo.el) HabitDo.el.classList.remove('on'); HabitDo.cur = null; },
  paint() {
    const el = HabitDo.el, h = HabitDo.habit(HabitDo.cur); if (!el || !h) return;
    const done = HabitDo.done(h.id);
    el.querySelector('.hd-name').textContent = h.name;
    el.querySelector('.hd-sub').textContent = done ? 'Done today. Doing it again is fine — it is still one tick.' : 'Do it here; saving ticks today.';
    el.querySelector('.hd-kinds').innerHTML = HabitDo.KINDS.map(([k, l]) => '<button type="button" role="tab" aria-selected="' + (k === HabitDo.kind) + '" class="' + (k === HabitDo.kind ? 'on' : '') + '" data-hd-kind="' + k + '">' + l + '</button>').join('');
    const body = el.querySelector('.hd-body');
    if (HabitDo.kind === 'write') {
      body.innerHTML = '<textarea class="flow-in" id="hd-text" rows="5" maxlength="2000" placeholder="Three sentences about today — how it felt, what you actually did, one thing for tomorrow."></textarea>' +
        '<div class="hd-hint">Saved to your journal, with the habit\'s name.</div>' +
        '<div class="ra-row ra-end"><button type="button" class="flow-btn" data-hd="close">Not now</button><button type="button" class="flow-btn primary" data-hd="save">Save and tick</button></div>';
    } else if (HabitDo.kind === 'timer') {
      const min = HabitDo.minutes(h.name);
      body.innerHTML = '<div class="hd-clock" data-i18n="off">' + HabitDo.clock(min * 60) + '</div>' +
        '<div class="hd-hint hd-timer-hint">' + min + ' minutes. Done ticks today either way — the clock is a help, not a judge.</div>' +
        '<div class="ra-row ra-end"><button type="button" class="flow-btn" data-hd="close">Not now</button><button type="button" class="flow-btn" data-hd="finish">Done</button><button type="button" class="flow-btn primary" data-hd="start">Start</button></div>';
    } else {
      body.innerHTML = '<input class="flow-in" id="hd-line" maxlength="200" placeholder="One line about it (optional)">' +
        '<div class="ra-row ra-end"><button type="button" class="flow-btn" data-hd="close">Not now</button><button type="button" class="flow-btn primary" data-hd="done">Done for today</button></div>';
    }
  },
  clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },

  /* ---- the three doors ---- */
  async saveWrite() {
    const el = HabitDo.el, h = HabitDo.habit(HabitDo.cur); if (!el || !h) return;
    const ta = el.querySelector('#hd-text'); const body = String(ta.value || '').trim();
    if (!body) { ta.focus(); toast('Write something first.', 'warn'); return; }
    await HabitDo.journal(h, body, [h.name]);
    HabitDo.tick(h.id);
    HabitDo.close();
    toast('Saved to your journal ✓ ' + h.name + ' ticked.', null, 2000);
    Track.hit('habit_done_here');
  },
  start() {
    const el = HabitDo.el, h = HabitDo.habit(HabitDo.cur); if (!el || !h) return;
    HabitDo.stopTimer();
    HabitDo.total = HabitDo.minutes(h.name) * 60; HabitDo.left = HabitDo.total; HabitDo.startedAt = Date.now();
    const b = el.querySelector('[data-hd="start"]'); if (b) { b.disabled = true; b.textContent = 'Running…'; }
    el.querySelector('.hd-clock').classList.add('run');
    HabitDo.timer = setInterval(() => {
      HabitDo.left = HabitDo.total - Math.round((Date.now() - HabitDo.startedAt) / 1000);
      const c = el.querySelector('.hd-clock'); if (c) c.textContent = HabitDo.clock(HabitDo.left);
      if (HabitDo.left <= 0) { HabitDo.finish(false); }
    }, 500);
  },
  stopTimer() { if (HabitDo.timer) { clearInterval(HabitDo.timer); HabitDo.timer = null; } },
  async finish(early) {
    const h = HabitDo.habit(HabitDo.cur); if (!h) return;
    const ran = HabitDo.timer ? Math.round((Date.now() - HabitDo.startedAt) / 60000) : 0;
    HabitDo.stopTimer();
    HabitDo.tick(h.id, ran ? ran + ' min' : '');
    try { if (ran >= 1) await Focus.add(ran, 'habit'); } catch (e) {}
    HabitDo.close();
    toast(h.name + ' ✓' + (ran ? ' · ' + ran + ' min' : ''), null, 1800);
    Track.hit('habit_done_here');
  },
  justDone() {
    const el = HabitDo.el, h = HabitDo.habit(HabitDo.cur); if (!el || !h) return;
    const line = String((el.querySelector('#hd-line') || {}).value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    HabitDo.tick(h.id, line);
    HabitDo.close();
    toast(h.name + ' ✓', null, 1500);
    Track.hit('habit_done_here');
  },

  /* ---- the doors on the page: the name on Today's card, and on Habits ---- */
  decorate() {
    if (!TodayLook.on()) return;
    document.querySelectorAll('#flow-td-habits .flow-td-row.hb .tx:not(.hd-door)').forEach((tx) => { tx.classList.add('hd-door'); tx.setAttribute('role', 'button'); tx.setAttribute('tabindex', '0'); });
    document.querySelectorAll('#habitsList .habit-name:not(.hd-door)').forEach((n) => { n.classList.add('hd-door'); n.setAttribute('role', 'button'); n.setAttribute('tabindex', '0'); });
  },
  boot() {
    const go = (e) => {
      if (!TodayLook.on()) return;
      const row = e.target.closest && e.target.closest('#flow-td-habits .flow-td-row.hb .tx, #habitsList .habit-name');
      if (!row) return;
      let id = null;
      const r = row.closest('.flow-td-row.hb'); if (r) { const b = r.querySelector('[data-hb]'); id = b && b.getAttribute('data-hb'); }
      if (!id) { const card = row.closest('.habit-card'); const d = card && card.querySelector('[data-hid]'); id = d && d.getAttribute('data-hid'); }
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      HabitDo.open(id);
    };
    document.addEventListener('click', go, true);
    document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('hd-door')) go(e); });
    HabitDo.load();
    let queued = false;
    const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { HabitDo.decorate(); } catch (e) {} }); };
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
    later();
  }
};
window.FlowHabitDo = HabitDo;

/* ── Say it: one place to talk to The Flow ───────────────────────────────
 * Open it and it is already listening — no second tap on a microphone. Say
 * anything in ordinary words ("tomorrow at ten call the venue, start reading
 * twenty minutes a day, tick cold shower, and note that today felt slow").
 * The words land in a box that stays editable; when the speaking stops they
 * go to /api/flow/do, which answers with proposed actions and a sentence.
 * Each comes back as a card that can be corrected — the day, the words — or
 * taken out, and nothing changes until "Do it". Then every action runs
 * through the same code the app's own buttons use (addRock, the habit box,
 * the journal, the ⋯ menu's move and done), so it saves, syncs and undoes
 * like anything typed.
 *
 * The listening is FlowVoice's: the iPhone's and the Mac app's own speech
 * recognition through the shell, and the browser's on Android and the web.
 * Where neither exists the box is simply typed into. Simple only.
 * ====================================================================== */
/* ── The assistant's voice ──────────────────────────────────────────────
 * Premium: a neural voice from the server (/api/flow/speak, ElevenLabs),
 * played through Web Audio with a light AI finish — a little presence and a
 * very short shimmer under the voice. Otherwise, or whenever that is refused,
 * the device's best British voice, so it never just goes quiet. Sound is
 * unlocked on the tap that opens the assistant — iOS allows playback only
 * after a touch. */
const Speech = {
  ac: null, src: null, premium: null, token: 0, primed: false,
  pref(k) { try { return Settings.get(k); } catch (e) { return undefined; } },
  mode() { const v = Speech.pref('asstVoice'); return v === 'device' || v === 'off' ? v : 'premium'; },
  unlock() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!Speech.ac) Speech.ac = new AC();
        if (Speech.ac.state === 'suspended') Speech.ac.resume();
        const b = Speech.ac.createBuffer(1, 1, 22050), s0 = Speech.ac.createBufferSource();
        s0.buffer = b; s0.connect(Speech.ac.destination); s0.start(0);
      }
    } catch (e) {}
    try { if (window.speechSynthesis && !Speech.primed) { Speech.primed = true; const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
  },
  async premiumOn() {
    if (Speech.premium !== null) return Speech.premium;
    try { const r = await fetch('/api/flow/speak', { credentials: 'same-origin' }); const j = await r.json(); Speech.premium = !!(r.ok && j.premium); } catch (e) { Speech.premium = false; }
    return Speech.premium;
  },
  speaking() { return !!Speech.src || !!(window.speechSynthesis && speechSynthesis.speaking); },
  stop() {
    Speech.token++;
    try { if (Speech.src) Speech.src.stop(); } catch (e) {}
    Speech.src = null;
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
  },
  /* Resolves once it has finished speaking, or could not speak at all. */
  async say(text, lang) {
    text = String(text || '').trim();
    if (!text || Speech.mode() === 'off') return;
    Speech.stop();
    const my = ++Speech.token;
    if (Speech.mode() === 'premium' && await Speech.premiumOn()) {
      try {
        const r = await fetch('/api/flow/speak', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) });
        if (my !== Speech.token) return;
        if (r.ok && /audio/.test(r.headers.get('content-type') || '')) {
          const buf = await r.arrayBuffer();
          if (my !== Speech.token) return;
          if (await Speech.play(buf, my)) return;
        }
      } catch (e) {}
      if (my !== Speech.token) return;
    }
    return Speech.device(text, lang, my);
  },
  async play(buf, my) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    if (!Speech.ac) Speech.ac = new AC();
    const ac = Speech.ac;
    try { if (ac.state === 'suspended') await ac.resume(); } catch (e) {}
    let audio;
    try { audio = await new Promise((ok, no) => { const pr = ac.decodeAudioData(buf.slice(0), ok, no); if (pr && pr.then) pr.then(ok, no); }); } catch (e) { return false; }
    if (my !== Speech.token) return true;
    const src = ac.createBufferSource(); src.buffer = audio;
    const chain = Speech.chain(ac);
    src.connect(chain.input); chain.output.connect(ac.destination);
    Speech.src = src;
    return new Promise((ok) => {
      src.onended = () => { if (Speech.src === src) Speech.src = null; ok(true); };
      try { src.start(0); } catch (e) { Speech.src = null; ok(false); }
    });
  },
  /* The AI finish: a clean low end, a little presence, gentle compression,
     and an 11 ms shimmer mixed well under the voice. Off in the settings. */
  chain(ac) {
    const input = ac.createGain(), output = ac.createGain();
    if (Speech.pref('asstSheen') === false) { input.connect(output); return { input, output }; }
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const pres = ac.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 2.5;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    const dly = ac.createDelay(0.05); dly.delayTime.value = 0.011;
    const fb = ac.createGain(); fb.gain.value = 0.28;
    const wet = ac.createGain(); wet.gain.value = 0.16;
    input.connect(hp); hp.connect(pres); pres.connect(comp); comp.connect(output);
    comp.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(output);
    return { input, output };
  },
  /* The device's best British voice: Daniel on Apple, Google UK English Male
     on Android and Chrome, Ryan on Windows. */
  voice(lang) {
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices() || [];
    if (lang === 'tr') return vs.find((v) => /^tr/i.test(v.lang)) || null;
    const gb = vs.filter((v) => /^en[-_]GB/i.test(v.lang));
    const names = ['Daniel', 'Arthur', 'Google UK English Male', 'Microsoft Ryan', 'Ryan', 'Oliver', 'George', 'Malcolm', 'Thomas'];
    for (const n of names) { const v = gb.find((x) => x.name.indexOf(n) >= 0); if (v) return v; }
    return gb[0] || vs.find((v) => /^en/i.test(v.lang)) || null;
  },
  device(text, lang, my) {
    return new Promise((ok) => {
      try {
        if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return ok();
        const u = new SpeechSynthesisUtterance(text);
        const v = Speech.voice(lang); if (v) u.voice = v;
        u.lang = v ? v.lang : (lang === 'tr' ? 'tr-TR' : 'en-GB');
        u.rate = 1; u.pitch = 0.95;
        let done = false; const fin = () => { if (!done) { done = true; ok(); } };
        u.onend = fin; u.onerror = fin;
        setTimeout(fin, 1500 + text.length * 90);  /* a voice that never reports its end */
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      } catch (e) { ok(); }
    });
  }
};
window.FlowSpeech = Speech;

const Say = {
  el: null, busy: false, waiting: false, spoken: false, plan: null, said: '',
  /* The conversation: what was said both ways, newest last, and whether a
     plan is waiting for a spoken yes. */
  history: [], confirming: false,
  lang() { return document.documentElement.lang === 'tr' ? 'tr' : 'en'; },
  /* How it addresses you: sir, ma'am, your first name, or nothing. */
  call() {
    const c = Speech.pref('asstCall') || 'name', tr = Say.lang() === 'tr';
    if (c === 'sir') return tr ? 'efendim' : 'sir';
    if (c === 'madam') return tr ? 'hanımefendi' : 'ma\'am';
    if (c === 'none') return '';
    return String(Speech.pref('displayName') || '').trim().split(/\s+/)[0].slice(0, 30);
  },
  /* A spoken "done" — said in the assistant's own manner, a little varied. */
  doneLine(n, more) {
    const c = Say.call(), tr = Say.lang() === 'tr';
    const at = c ? ', ' + c : '';
    const en = n > 1 ? ['All ' + n + ' done' + at + '.', 'Consider all ' + n + ' done' + at + '.', 'That\'s ' + n + ' things taken care of' + at + '.']
      : ['Done' + at + '.', 'Consider it done' + at + '.', 'It\'s taken care of' + at + '.', 'All in hand' + at + '.'];
    const trl = n > 1 ? [n + ' işin hepsi tamam' + at + '.', 'Hepsi halloldu' + at + '.'] : ['Tamamdır' + at + '.', 'Hallettim' + at + '.', 'İşlendi' + at + '.'];
    const list = tr ? trl : en;
    let line = list[Math.floor(Math.random() * list.length)];
    if (more) line += tr ? ' Başka bir şey?' : ' Anything else?';
    return line;
  },
  PAGE_NAMES: { today: 'Today', compass: 'Week', quad: 'Open loops', habits: 'Habits', journal: 'Journal', training: 'Training', diet: 'Diet', sleep: 'Sleep & mood', finance: 'Finances', time: 'Time', brainstorm: 'Brainstorm', settings: 'Settings' },
  host() { return { c: (typeof cData !== 'undefined' && cData) ? cData : null, hb: TodayPlus.host('hbData'), S: TodayPlus.host('S') }; },
  iso(d) { return RockActions.iso(d); },
  day(iso) { return RockActions.fromIso(iso); },
  label(iso) { const d = Say.day(iso); return d ? RockActions.label(d) : ''; },
  plusDays(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return Say.iso(d); },

  /* What the assistant needs to resolve "the insurance" or "cold shower":
     open Priorities from two weeks back to three ahead, and the habits. Ids
     and titles only — no notes, no journal. */
  context() {
    const { c, hb } = Say.host();
    const rocks = [];
    if (c && c.rocks) {
      const now = new Date();
      for (let k = -2; k <= 3; k++) {
        const d = new Date(now); d.setDate(now.getDate() + 7 * k);
        const w = weekId(d);
        (c.rocks[w] || []).forEach((r) => {
          if (!r || !r.title) return;
          const dd = RockActions.dateOf(w, r.day);
          if (k < 0 && r.done) return;
          rocks.push({ id: String(r.id), title: String(r.title).slice(0, 160), date: dd ? Say.iso(dd) : '', done: !!r.done });
        });
      }
    }
    const habits = ((hb && hb.habits) || []).filter((h) => h && h.id && h.name).map((h) => ({ id: String(h.id), name: String(h.name).slice(0, 120), done: HabitDo.done(h.id) }));
    const now = new Date();
    return { today: Say.iso(now), weekday: now.toLocaleDateString('en-GB', { weekday: 'long' }), time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'), rocks: rocks.slice(0, 80), habits: habits.slice(0, 60) };
  },
  findRock(id) { const hit = RockActions.find(id); return hit ? hit.r : null; },
  habitName(id) { const h = HabitDo.habit(id); return h ? h.name : ''; },

  /* ---- the sheet ---- */
  build() {
    if (Say.el) return Say.el;
    const wrap = document.createElement('div');
    wrap.id = 'flow-say'; wrap.className = 'fn-sheetwrap';
    /* Its one checkbox is a setting, not a task: no 🕘 time chip. The tip
       says "Big Rocks" so the Simple wording turns it into "Priorities". */
    wrap.setAttribute('data-flow-no-chip', '');
    wrap.innerHTML =
      '<div class="fn-scrim" data-say="close"></div>' +
      '<div class="fn-sheet" role="dialog" aria-modal="true" aria-label="Say it">' +
        '<div class="fn-grab" data-say="close"></div>' +
        '<button type="button" class="fn-capture-close" data-say="close" aria-label="Close">×</button>' +
        '<div class="sy-k">Assistant</div>' +
        '<div class="sy-log" aria-live="polite"></div>' +
        '<div class="sy-ask">' +
          '<div class="sy-state" aria-live="polite"></div>' +
          '<textarea id="sy-text" rows="3" placeholder="Tomorrow at 10 call the venue. Start reading 20 minutes a day. Tick cold shower. Note: today felt slow."></textarea>' +
          '<div class="sy-ex">Big Rocks, habits, ticks, notes, moving things, opening a page — in one go, in your own words.</div>' +
          '<label class="sy-own"><input type="checkbox" data-say-own> I dictate with Wispr Flow or my keyboard — don\'t listen</label>' +
          '<details class="sy-set"><summary>Voice and manners</summary>' +
            '<label class="sy-opt"><span>Voice</span><select data-say-pref="asstVoice"><option value="premium">Premium British voice</option><option value="device">This device\'s voice</option><option value="off">Silent — text only</option></select></label>' +
            '<label class="sy-opt"><span>Call me</span><select data-say-pref="asstCall"><option value="sir">Sir</option><option value="madam">Ma\'am</option><option value="name">My first name</option><option value="none">Nothing</option></select></label>' +
            '<label class="sy-own"><input type="checkbox" data-say-pref="asstHands"> Keep listening after it answers</label>' +
            '<label class="sy-own"><input type="checkbox" data-say-pref="asstSheen"> AI finish on the premium voice</label>' +
            '<div class="sy-ex sy-premium"></div>' +
          '</details>' +
          '<div class="ra-row ra-end"><button type="button" class="flow-btn sy-mic" data-say="listen"></button><button type="button" class="flow-btn primary" data-say="send">Go</button></div>' +
        '</div>' +
        '<div class="sy-plan" hidden></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-say]'); if (!b) return;
      const a = b.getAttribute('data-say');
      if (a === 'close') return Say.close();
      if (a === 'listen') return FlowVoice && FlowVoice.listening ? FlowVoice.stop() : Say.listen();
      if (a === 'send') return Say.send();
      if (a === 'again') return Say.again();
      if (a === 'do') return Say.apply();
      if (a === 'drop') { const i = +b.getAttribute('data-i'); if (Say.plan) { Say.plan.actions.splice(i, 1); Say.paintPlan(); } return; }
      if (a === 'when') { const i = +b.getAttribute('data-i'); const it = Say.plan && Say.plan.actions[i]; if (it) { it.date = b.getAttribute('data-d'); Say.paintPlan(); } return; }
    });
    wrap.addEventListener('change', (e) => {
      const pf = e.target.closest('[data-say-pref]');
      if (pf) {
        const k = pf.getAttribute('data-say-pref');
        const v = pf.type === 'checkbox' ? !!pf.checked : pf.value;
        try { Settings.set(k, v); } catch (x) {}
        if (k === 'asstVoice' && v !== 'off') { Speech.unlock(); Speech.say(Say.lang() === 'tr' ? 'Ses böyle' + (Say.call() ? ', ' + Say.call() : '') + '.' : 'At your service' + (Say.call() ? ', ' + Say.call() : '') + '.', Say.lang()); }
        if (k === 'asstCall') Speech.say(Say.lang() === 'tr' ? 'Peki' + (Say.call() ? ', ' + Say.call() : '') + '.' : 'Very good' + (Say.call() ? ', ' + Say.call() : '') + '.', Say.lang());
        return;
      }
      if (!e.target.matches('[data-say-own]')) return;
      Say.own(e.target.checked);
      if (e.target.checked) { try { if (window.FlowVoice && FlowVoice.listening) FlowVoice.cancel(); } catch (x) {} Say.waiting = false; Say.paintMic(); Say.listen(); }
    });
    wrap.addEventListener('input', (e) => {
      const f = e.target.closest('[data-sy-edit]'); if (!f || !Say.plan) return;
      const it = Say.plan.actions[+f.getAttribute('data-i')]; if (!it) return;
      it[f.getAttribute('data-sy-edit')] = f.value;
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.target.id === 'sy-text' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Say.send(); }
    });
    /* A real keystroke means typing — the answer is read, not spoken. The
       microphone writes with a synthetic event; Wispr Flow is dictation. */
    wrap.addEventListener('input', (e) => { if (e.target.id === 'sy-text' && e.isTrusted) { let own = false; try { own = Say.own(); } catch (x) {} if (!own) Say.typed = true; } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wrap.classList.contains('on')) Say.close(); });
    /* The turn ends by itself after a pause; what was said goes off then. */
    try {
      if (window.FlowVoice) FlowVoice.on((state) => {
        if (!Say.waiting) return;
        if (state === 'listening') { Say.state(Say.confirming ? (Say.lang() === 'tr' ? 'Dinliyorum — "evet" ya da "hayır".' : 'Listening — "yes" to do it, or "no".') : Say.listeningLine()); Say.paintMic(); return; }
        if (state === 'error') { Say.waiting = false; Say.paintMic(); return; }
        if (state === 'idle') {
          Say.waiting = false; Say.paintMic();
          const t = (document.getElementById('sy-text') || {}).value || '';
          if (!Say.el.classList.contains('on')) return;
          if (t.trim() && Say.plan && Say.confirming) { Say.spoken = !Say.typed; Say.confirmBy(t.trim()); }
          else if (t.trim() && !Say.plan) { Say.spoken = !Say.typed; Say.send(); }
          else if (!t.trim()) { Say.confirming = false; Say.state(Say.history.length ? (Say.lang() === 'tr' ? 'Buradayım — mikrofona dokun.' : 'I\'m here when you need me — tap the microphone.') : 'Nothing heard. Tap the microphone, or type.'); }
        }
      });
    } catch (e) {}
    Say.el = wrap;
    return wrap;
  },
  state(t) { const el = Say.el && Say.el.querySelector('.sy-state'); if (el) el.textContent = t || ''; },
  /* Wispr Flow (or any keyboard's own dictation) types into the box itself;
     the built-in microphone would only fight it. Remembered per device. */
  own(v) {
    try { if (v === undefined) return localStorage.getItem('flow:say-own') === '1'; localStorage.setItem('flow:say-own', v ? '1' : '0'); } catch (e) {}
    return !!v;
  },
  paintMic() {
    const b = Say.el && Say.el.querySelector('.sy-mic'); if (!b) return;
    const can = !!(window.FlowVoice && FlowVoice.available);
    b.hidden = !can;
    const on = can && FlowVoice.listening;
    b.classList.toggle('on', on);
    b.innerHTML = Nav.svg('mic') + '<span>' + (on ? 'Stop' : 'Talk') + '</span>';
  },
  listeningLine() {
    const c = Say.call(), tr = Say.lang() === 'tr';
    if (Say.history.length) return tr ? 'Dinliyorum…' : 'Listening…';
    return tr ? 'Dinliyorum' + (c ? ', ' + c : '') + '…' : 'Yes' + (c ? ', ' + c : '') + '? Go ahead — I\'m listening.';
  },
  open(opts) {
    if (!TodayLook.on()) return;
    Say.build();
    Speech.unlock();
    Say.plan = null; Say.spoken = false; Say.typed = false; Say.busy = false; Say.confirming = false;
    Say.history = []; Say.logPaint();
    Say.prefsPaint();
    const ta = Say.el.querySelector('#sy-text'); ta.value = (opts && opts.text) || '';
    Say.el.querySelector('.sy-ask').hidden = false;
    Say.el.querySelector('.sy-plan').hidden = true;
    Say.state('');
    Say.el.classList.add('on');
    const own = Say.el.querySelector('[data-say-own]'); if (own) own.checked = Say.own();
    Say.paintMic();
    if (opts && opts.text) { Say.send(); return; }
    /* Straight to listening, which is the point: one tap, then talk. */
    setTimeout(() => Say.listen(), 120);
  },
  close() {
    if (!Say.el) return;
    try { if (window.FlowVoice && FlowVoice.listening) FlowVoice.cancel(); } catch (e) {}
    Speech.stop();
    Say.waiting = false; Say.confirming = false;
    Say.el.classList.remove('on');
  },
  listen() {
    const ta = Say.el && Say.el.querySelector('#sy-text'); if (!ta) return;
    try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
    if (Say.own()) { Say.state('Dictate with Wispr Flow or your keyboard, then press Go.'); return; }
    if (!(window.FlowVoice && FlowVoice.available)) { Say.state('Type it here — this browser cannot listen.'); return; }
    Say.waiting = true;
    try { FlowVoice.start(ta); } catch (e) { Say.waiting = false; }
    Say.paintMic();
  },
  again() {
    Say.plan = null; Say.confirming = false; Speech.stop();
    Say.el.querySelector('.sy-plan').hidden = true;
    Say.el.querySelector('.sy-ask').hidden = false;
    const ta = Say.el.querySelector('#sy-text'); ta.value = '';
    Say.state('');
    Say.listen();
  },
  async send() {
    if (Say.busy) return;
    const ta = Say.el.querySelector('#sy-text');
    const text = String(ta.value || '').trim();
    if (!text) { Say.state('Say or type what you want first.'); return; }
    /* Sent by hand while the microphone was open: stop it without its "idle"
       sending this again or calling it spoken. */
    Say.waiting = false;
    try { if (window.FlowVoice && FlowVoice.listening) FlowVoice.stop(); } catch (e) {}
    Speech.stop();
    if (Say.typed) Say.spoken = false;
    try { if (Say.own()) Say.spoken = true; } catch (e) {}
    Say.typed = false;
    Say.busy = true; Say.said = text; Say.confirming = false;
    Say.state('Working it out…');
    const go = Say.el.querySelector('[data-say="send"]'); go.disabled = true;
    try {
      const r = await fetch('/api/flow/do', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: Say.lang(), ctx: Say.context(), history: Say.history.slice(-8), persona: 'butler', call: Say.call() }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 402 && j.plus) { Say.close(); Plus.open('voice'); return; }
      if (!r.ok) { Say.state(j.error || 'That did not work. Try again.'); return; }
      const reply = String(j.say || '');
      Say.history.push({ role: 'user', text }, { role: 'assistant', text: reply });
      Say.plan = { say: reply, actions: Array.isArray(j.actions) ? j.actions : [] };
      const acts = Say.plan.actions;
      /* Going somewhere is not a change to anything; on its own it just goes. */
      if (acts.length === 1 && acts[0].type === 'open') {
        Say.speak(reply); Say.close(); Nav.go(acts[0].page); return;
      }
      if (j.end) { Say.plan = null; Say.askView(); Say.logPaint(); Say.state(''); await Say.speak(reply); if (Say.spoken) Say.close(); return; }
      if (acts.length) {
        Say.paintPlan();
        await Say.speak(reply);
        Say.follow(true);
        return;
      }
      /* An answer: it stays a conversation — the answer in the log, the box
         empty for whatever comes next. */
      Say.plan = null; Say.askView(); Say.state('');
      Say.logPaint();
      await Say.speak(reply);
      Say.follow(false);
    } catch (e) { Say.state('That did not work — check the connection and try again.'); }
    finally { Say.busy = false; go.disabled = false; }
  },
  /* Back to the conversation: the box, empty; no plan on screen. */
  askView() {
    if (!Say.el) return;
    Say.el.querySelector('.sy-plan').hidden = true;
    Say.el.querySelector('.sy-ask').hidden = false;
    const ta = Say.el.querySelector('#sy-text'); if (ta) ta.value = '';
  },
  /* Hands-free: once it has finished speaking, it listens again — for a yes
     or no when something is waiting to be done, for the next thing if not. */
  follow(confirm) {
    if (!Say.spoken || Speech.pref('asstHands') === false || !Say.el || !Say.el.classList.contains('on')) return;
    try { if (Say.own()) return; } catch (e) {}
    Say.confirming = !!confirm;
    const ta = Say.el.querySelector('#sy-text'); if (ta) ta.value = '';
    Say.listen();
  },
  confirmBy(t) {
    const yes = /^(yes|yeah|yep|yup|sure|ok(ay)?|do it|go ahead|please( do)?|confirm(ed)?|correct|that'?s (right|it|fine)|sounds good|perfect|evet|tamam|olur|yap|onayla)\b/i;
    const no = /^(no|nope|cancel|stop|never ?mind|don'?t|leave it|scrap (it|that)|hayır|iptal|vazgeç|boş ver)\b/i;
    Say.confirming = false;
    if (yes.test(t)) { Say.apply(); return; }
    if (no.test(t)) {
      Say.plan = null;
      Say.el.querySelector('.sy-plan').hidden = true; Say.el.querySelector('.sy-ask').hidden = false;
      const line = Say.lang() === 'tr' ? 'Peki' + (Say.call() ? ', ' + Say.call() : '') + '. Hiçbir şeyi değiştirmedim.' : 'Very well' + (Say.call() ? ', ' + Say.call() : '') + '. Nothing has been changed.';
      Say.history.push({ role: 'user', text: t }, { role: 'assistant', text: line });
      Say.logPaint(); Say.state('');
      Say.speak(line).then(() => Say.follow(false));
      return;
    }
    /* Anything else is a correction or a new request; the conversation so
       far goes with it, so "make it Friday instead" works. */
    Say.plan = null;
    Say.el.querySelector('.sy-plan').hidden = true; Say.el.querySelector('.sy-ask').hidden = false;
    Say.el.querySelector('#sy-text').value = t;
    Say.send();
  },
  /* Spoken back only when it was spoken to: a typed request reads the answer. */
  speak(text) {
    if (!Say.spoken || !text) return Promise.resolve();
    return Speech.say(text, Say.lang());
  },
  logPaint() {
    const box = Say.el && Say.el.querySelector('.sy-log'); if (!box) return;
    /* While a plan is on screen its own lines say the last turn. */
    const turns = Say.plan && Say.plan.actions && Say.plan.actions.length ? Say.history.slice(0, -2) : Say.history;
    box.innerHTML = turns.slice(-6).map((t) => '<div class="sy-b ' + (t.role === 'assistant' ? 'a' : 'u') + '" data-i18n="off">' + esc(t.text) + '</div>').join('');
    box.hidden = !turns.length;
    box.scrollTop = box.scrollHeight;
  },
  prefsPaint() {
    const el = Say.el; if (!el) return;
    el.querySelectorAll('[data-say-pref]').forEach((f) => {
      const v = Speech.pref(f.getAttribute('data-say-pref'));
      if (f.type === 'checkbox') f.checked = v !== false; else if (v != null) f.value = v;
    });
    const note = el.querySelector('.sy-premium');
    if (note) Speech.premiumOn().then((on) => { note.textContent = on ? 'The premium voice is on for this account.' : 'The premium voice is not available here yet — it uses this device\'s best British voice.'; });
  },
  /* ---- the cards ---- */
  dayChips(i, iso) {
    const opts = [[Say.plusDays(0), 'Today'], [Say.plusDays(1), 'Tomorrow']];
    if (iso && opts.every(([d]) => d !== iso)) opts.push([iso, Say.label(iso)]);
    return '<div class="sy-days">' + opts.map(([d, l]) => '<button type="button" class="flow-chip' + (d === iso ? ' on' : '') + '" data-say="when" data-i="' + i + '" data-d="' + d + '">' + esc(l) + '</button>').join('') + '</div>';
  },
  card(a, i) {
    const drop = '<button type="button" class="sy-x" data-say="drop" data-i="' + i + '" aria-label="Leave this out">×</button>';
    const head = (k, t) => '<div class="sy-ch"><span class="sy-kind">' + esc(k) + '</span>' + (t ? '<span class="sy-t" data-i18n="off">' + esc(t) + '</span>' : '') + drop + '</div>';
    if (a.type === 'rock') return '<div class="sy-card">' + head('Priority' + (a.time ? ' · ' + a.time : ''), '') +
      '<input class="flow-in" data-sy-edit="title" data-i="' + i + '" value="' + esc(a.title) + '">' + Say.dayChips(i, a.date) + '</div>';
    if (a.type === 'habit') return '<div class="sy-card">' + head('New habit', '') + '<input class="flow-in" data-sy-edit="name" data-i="' + i + '" value="' + esc(a.name) + '"></div>';
    if (a.type === 'tick') return '<div class="sy-card">' + head('Tick habit' + (a.date !== Say.plusDays(0) ? ' · ' + Say.label(a.date) : ''), Say.habitName(a.habit)) + '</div>';
    if (a.type === 'journal') return '<div class="sy-card">' + head('Note → journal', '') + '<textarea class="flow-in" rows="3" data-sy-edit="text" data-i="' + i + '">' + esc(a.text) + '</textarea></div>';
    if (a.type === 'move') { const r = Say.findRock(a.rock); return '<div class="sy-card">' + head('Move', r ? r.title : '') + Say.dayChips(i, a.date) + '</div>'; }
    if (a.type === 'done') { const r = Say.findRock(a.rock); return '<div class="sy-card">' + head('Mark done', r ? r.title : '') + '</div>'; }
    if (a.type === 'open') return '<div class="sy-card">' + head('Open', Say.PAGE_NAMES[a.page] || a.page) + '</div>';
    return '';
  },
  paintPlan() {
    Say.logPaint();
    const box = Say.el.querySelector('.sy-plan');
    Say.el.querySelector('.sy-ask').hidden = true;
    box.hidden = false;
    const n = Say.plan.actions.length;
    box.innerHTML =
      '<div class="sy-heard" data-i18n="off">“' + esc(Say.said) + '”</div>' +
      (Say.plan.say ? '<div class="sy-say" data-i18n="off">' + esc(Say.plan.say) + '</div>' : '') +
      '<div class="sy-cards">' + Say.plan.actions.map((a, i) => Say.card(a, i)).join('') + '</div>' +
      (n && Say.spoken && Speech.pref('asstHands') !== false ? '<div class="sy-ex">Say “yes” to do it, “no” to leave it — or say what to change.</div>' : '') +
      '<div class="ra-row ra-end"><button type="button" class="flow-btn" data-say="again">' + Nav.svg('mic') + '<span>Say again</span></button>' +
      (n ? '<button type="button" class="flow-btn primary" data-say="do">Do it' + (n > 1 ? ' (' + n + ')' : '') + '</button>' : '<button type="button" class="flow-btn primary" data-say="close">Close</button>') + '</div>';
  },

  /* ---- doing it, through the app's own paths ---- */
  async apply() {
    if (!Say.plan || Say.busy) return;
    const { c, hb, S } = Say.host();
    const roles = (c && Array.isArray(c.roles)) ? c.roles : [];
    let open = null, did = 0, journal = false;
    Say.busy = true;
    try {
      for (const a of Say.plan.actions) {
        try {
          if (a.type === 'rock') {
            const d = Say.day(a.date) || new Date(); const title = String(a.title || '').trim(); if (!title || typeof addRock !== 'function') continue;
            addRock(title.slice(0, 200), roles[0] || '', (d.getDay() + 6) % 7, a.time || '', weekId(d), { note: a.note || '', prio: 'med' });
            did++;
          } else if (a.type === 'habit') {
            const name = String(a.name || '').trim(); if (!name || !hb || !S) continue;
            hb.habits = hb.habits || [];
            if (hb.habits.some((h) => h && String(h.name).toLowerCase() === name.toLowerCase())) continue;
            hb.habits.push({ id: Date.now().toString() + did, name });
            try { if (typeof J === 'function') J('habits', '➕ New habit: ' + name); } catch (e) {}
            S.set('habits', hb); try { if (typeof renderHabits === 'function') renderHabits(); } catch (e) {}
            did++;
          } else if (a.type === 'tick') {
            if (!hb || !S) continue;
            if (a.date === Say.plusDays(0)) HabitDo.tick(a.habit);
            else { hb.completions = hb.completions || {}; (hb.completions[a.habit] = hb.completions[a.habit] || {})[a.date] = true; S.set('habits', hb); }
            did++;
          } else if (a.type === 'journal') {
            const body = String(a.text || '').trim(); if (!body) continue;
            const now = new Date().toISOString();
            Journal.entries.push({ id: uid('j'), created: now, updated: now, date: today(), title: String(a.title || ''), body, tags: ['voice'], prompts: {}, mood: null, energy: null });
            journal = true; did++;
          } else if (a.type === 'move') {
            const d = Say.day(a.date); if (d) { TodayFix.move(a.rock, d); did++; }
          } else if (a.type === 'done') {
            TodayFix.done(a.rock); did++;
          } else if (a.type === 'open') { open = a.page; }
        } catch (e) { console.warn('[Flow] say', a.type, e); }
      }
      if (journal) { await Journal.save(); try { Journal.rerender(); } catch (e) {} }
      try { if (typeof renderToday === 'function') renderToday(); } catch (e) {}
      try { TodayLook.paint(); } catch (e) {}
    } finally { Say.busy = false; }
    /* Spoken to, it answers in kind and the conversation carries on; typed,
       the sheet goes and a toast says it. */
    if (Say.spoken && !open && Say.el.classList.contains('on')) {
      const hands = Speech.pref('asstHands') !== false;
      const line = did ? Say.doneLine(did, hands) : (Say.lang() === 'tr' ? 'Yapılacak bir şey kalmadı.' : 'Nothing there needed doing.');
      Say.plan = null; Say.confirming = false;
      Say.history.push({ role: 'assistant', text: line });
      Say.el.querySelector('.sy-plan').hidden = true; Say.el.querySelector('.sy-ask').hidden = false;
      Say.el.querySelector('#sy-text').value = '';
      Say.logPaint(); Say.state('');
      if (did) toast(did === 1 ? 'Done ✓' : did + ' things done ✓', null, 1800);
      await Say.speak(line);
      Say.follow(false);
      return;
    }
    Say.close();
    if (did) toast(did === 1 ? 'Done ✓' : did + ' things done ✓', null, 1800);
    if (open) { if (Say.spoken) Say.speak(Say.doneLine(Math.max(did, 1), false)); Nav.go(open); }
  },

  /* A "Talk" button on Today, beside the greeting. */
  decorate() {
    if (!TodayLook.on()) return;
    const hello = document.querySelector('#today-feed .lk-hello');
    if (!hello || hello.querySelector('.lk-say')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lk-say';
    b.setAttribute('aria-label', 'Say it');
    b.innerHTML = Nav.svg('mic') + '<span>Talk</span>';
    b.addEventListener('click', () => Say.open());
    hello.appendChild(b);
  },
  boot() {
    let queued = false;
    const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { Say.decorate(); } catch (e) {} }); };
    try { new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    later();
    /* ⌘/Ctrl + Shift + Space opens it from anywhere on a computer. */
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'Space' || e.key === ' ')) { if (!TodayLook.on()) return; e.preventDefault(); Say.open(); }
    });
    /* The home-screen shortcut and Siri / Assistant links land on /?say=1. */
    try { if (/[?&]say=1\b/.test(location.search)) setTimeout(() => Say.open(), 1200); } catch (e) {}
  }
};
window.FlowSay = Say;

/* ── Open one Big Rock ────────────────────────────────────────────────────
 * A reminder or a widget row names a rock; tapping it should land on that
 * rock, not just open the app. The iPhone app calls window.__flowOpen({rock})
 * when it is already running, and loads /?rock=<id> when it was not. On
 * Today the row is scrolled to and marked; a rock on another day is shown in
 * the Week Compass; one that has since been deleted says so, on Today. */
const OpenRock = {
  find(id) {
    try { const all = (typeof cData !== 'undefined' && cData.rocks) || {}; for (const w of Object.keys(all)) { const r = (all[w] || []).find((x) => String(x.id) === String(id)); if (r) return { w, r }; } } catch (e) {}
    return null;
  },
  flash(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('fl-flash');
    setTimeout(() => el.classList.remove('fl-flash'), 2600);
    return true;
  },
  open(arg) {
    const id = String((arg && arg.rock) || '');
    if (!id) return;
    const hit = OpenRock.find(id);
    if (!hit) { try { Nav.go('today'); } catch (e) {} toast('That Big Rock is no longer in your week.', 'warn', 3500); return; }
    try { Nav.go('today'); } catch (e) {}
    setTimeout(() => {
      if (OpenRock.flash(document.querySelector('#today-feed .td-rock[data-rockid="' + CSS.escape(id) + '"]'))) return;
      try { Nav.go('compass'); } catch (e) {}
      setTimeout(() => { OpenRock.flash(document.querySelector('#cGrid [data-rid="' + CSS.escape(id) + '"]')); }, 350);
    }, 350);
  },
  boot() {
    window.__flowOpen = (arg) => { try { OpenRock.open(arg || {}); } catch (e) {} };
    const q = new URLSearchParams(location.search);
    const rock = q.get('rock') || window.__flowPendingRock;
    window.__flowPendingRock = null;
    if (!rock) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    let n = 0;
    const t = setInterval(() => {
      if (document.documentElement.classList.contains('flow-ready') || ++n > 40) { clearInterval(t); OpenRock.open({ rock }); }
    }, 250);
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
    /* A photo you chose yourself wins over the one Google lends. */
    try { if (Photo.data) return Photo.data; } catch (e) {}
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
/* ── Event brief ──────────────────────────────────────────────────────────
 * Under a big event on Today — all day, three hours or more, or anything
 * with three or more related emails — a brief written from those emails:
 * the timetable by day, where, your own part, who to call and what is
 * still open. Built automatically once a day per event, rebuilt only when
 * the emails changed (or on Refresh), so an unchanged thread costs nothing.
 *
 * The emails are found through the person's own Gmail or Outlook
 * connection; only the brief is kept (flow:briefs), never the emails.
 * ====================================================================== */
const EventBrief = {
  KEY: 'flow:briefs',
  AUTO_PER_DAY: 4,
  STOP: new Set(('the a an and or of for with at in on to from by meeting call sync weekly daily standup stand up toplantı toplantısı ' +
    'görüşme ile ve ve de da bir için review catch up 1:1 one on one lunch dinner breakfast').split(' ')),
  data: null, busy: {}, open: {}, tab: {},

  async load() {
    if (EventBrief.data) return EventBrief.data;
    const v = await DB.get(EventBrief.KEY, {});
    EventBrief.data = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    return EventBrief.data;
  },
  async save() {
    /* Keep the last 40 events; a brief is for the days around an event. */
    const d = EventBrief.data || {};
    const keys = Object.keys(d).sort((a, b) => String(d[b].at || '').localeCompare(String(d[a].at || '')));
    keys.slice(40).forEach((k) => delete d[k]);
    await DB.set(EventBrief.KEY, d);
  },
  key(e) { return String(e.id || '') || (String(e.title || '').toLowerCase() + '|' + String(e.start || '').slice(0, 10)); },
  day() { return today(); },
  terms(title) {
    const words = String(title || '').normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
      .map((w) => w.trim()).filter((w) => w.length >= 3 && !EventBrief.STOP.has(w.toLocaleLowerCase('tr')));
    return words.slice(0, 4).join(' ');
  },
  hours(e) { return e.allDay ? 24 : Math.max(0, (Date.parse(e.end) - Date.parse(e.start)) / 3600000) || 0; },
  big(e) { return !!e.allDay || EventBrief.hours(e) >= 3; },
  mailIds() {
    try {
      return ['gmail', 'outlook'].filter((id) => {
        const c = (Connect.list || []).find((x) => x.id === id);
        return c && (c.accounts || []).some((a) => !a.broken);
      });
    } catch (e) { return []; }
  },
  me() {
    let u = {};
    try { u = (Auth && Auth.user) || {}; } catch (e) {}
    const name = u.name || (Settings.get && Settings.get('displayName')) || '';
    return { name, alias: String(name).split(/\s+/)[0] || '', email: u.email || '' };
  },
  sig(threads) { return threads.map((t) => t.id + ':' + t.total).sort().join(','); },

  /* Find, decide, write. force = Refresh. */
  async run(e, force) {
    const k = EventBrief.key(e);
    if (EventBrief.busy[k]) return;
    await EventBrief.load();
    const have = EventBrief.data[k];
    if (!force && have && have.day === EventBrief.day()) return;
    const terms = EventBrief.terms(e.title);
    const ids = EventBrief.mailIds();
    if (!terms || !ids.length) return;
    EventBrief.busy[k] = 'search';
    ConnectApps.calendarPaint();
    try {
      const got = await Promise.all(ids.map((id) => ConnectApps.get('/api/connect/' + id + '/related?' + new URLSearchParams({ q: terms }))
        .then((j) => j.threads || []).catch(() => [])));
      const threads = [].concat.apply([], got);
      const msgs = threads.reduce((n, t) => n + (t.total || (t.messages || []).length), 0);
      const base = { day: EventBrief.day(), at: new Date().toISOString(), title: e.title, threads: threads.length, mails: msgs,
        sources: threads.map((t) => ({ subject: t.subject, total: t.total, link: t.link,
          first: (t.messages[0] || {}).date, last: (t.messages[t.messages.length - 1] || {}).date })) };
      if (!msgs || !(EventBrief.big(e) || msgs >= 3)) {
        EventBrief.data[k] = Object.assign({}, have || {}, base, { brief: (have && have.brief) || null, skipped: true });
        await EventBrief.save(); return;
      }
      const sig = EventBrief.sig(threads);
      if (!force && have && have.brief && have.sig === sig) {
        EventBrief.data[k] = Object.assign({}, have, { day: base.day, checked: base.at });
        await EventBrief.save(); return;
      }
      if (!force) {
        const autoToday = Object.values(EventBrief.data).filter((x) => x && x.autoDay === base.day).length;
        if (autoToday >= EventBrief.AUTO_PER_DAY) return;
      }
      EventBrief.busy[k] = 'write';
      ConnectApps.calendarPaint();
      const start = await ConnectApps.post('/api/flow/event-brief', {
        event: { title: e.title, start: e.start, end: e.end, allDay: !!e.allDay, location: e.location || '' },
        threads, me: EventBrief.me(), today: base.day, lang: (typeof Lang !== 'undefined' && Lang.current) || 'en'
      });
      let res = null;
      for (let i = 0; i < 90 && !res; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const j = await ConnectApps.get('/api/flow/event-brief?job=' + encodeURIComponent(start.job)).catch(() => null);
        if (j && j.status === 'done') res = j.brief;
        else if (j && j.status === 'error') throw new Error(j.error);
      }
      if (!res) throw new Error('The brief is taking too long. Try Refresh.');
      EventBrief.data[k] = Object.assign(base, { brief: res.none ? null : res, none: !!res.none, sig, done: [],
        autoDay: force ? (have && have.autoDay) : base.day });
      await EventBrief.save();
    } catch (err) {
      EventBrief.data[k] = Object.assign({}, have || {}, { error: (err && err.message) || 'The brief could not be built.', errDay: EventBrief.day() });
      if (force) toast(EventBrief.data[k].error, 'warn');
    } finally {
      delete EventBrief.busy[k];
      ConnectApps.calendarPaint();
    }
  },

  /* After the day's events load: each one, one at a time. */
  async auto(events) {
    if (EventBrief._running || !EventBrief.mailIds().length) return;
    EventBrief._running = true;
    try { for (const e of (events || [])) await EventBrief.run(e, false); }
    finally { EventBrief._running = false; }
  },

  fmtWhen(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },

  /* The fold under an event row. */
  rowHtml(e) {
    const k = EventBrief.key(e);
    const rec = EventBrief.data && EventBrief.data[k];
    const busy = EventBrief.busy[k];
    if (busy) return '<div class="eb"><span class="eb-tg eb-busy" data-i18n="off"><i class="eb-spin"></i>' + (busy === 'write' ? 'Writing the brief from your email…' : 'Looking for related email…') + '</span></div>';
    if (!rec || !rec.brief) {
      if (rec && rec.error && rec.errDay === EventBrief.day() && EventBrief.big(e)) return '<div class="eb"><button type="button" class="eb-tg" data-eb="refresh" data-ebk="' + esc(k) + '">↻ Brief failed — try again</button></div>';
      if (!EventBrief.mailIds().length && EventBrief.big(e)) return '<div class="eb"><span class="eb-hint">Connect Gmail or Outlook in Settings to get a brief for this event from your email.</span></div>';
      return '';
    }
    const open = !!EventBrief.open[k];
    return '<div class="eb"><button type="button" class="eb-tg" data-eb="toggle" data-ebk="' + esc(k) + '" aria-expanded="' + open + '"><span class="eb-dot"></span>' +
      (open ? 'Hide brief' : 'Show brief') + ' · ' + rec.threads + ' thread' + (rec.threads === 1 ? '' : 's') + ', ' + rec.mails + ' email' + (rec.mails === 1 ? '' : 's') + ' <span class="eb-chev">▾</span></button>' +
      (open ? EventBrief.bodyHtml(k, rec) : '') + '</div>';
  },

  bodyHtml(k, rec) {
    const b = rec.brief;
    const t0 = today();
    const todayDay = b.days.find((d) => d.date === t0) || b.days.find((d) => d.date > t0) || b.days[b.days.length - 1];
    const tabs = [];
    if (todayDay) tabs.push(['day', todayDay.date === t0 ? 'Today · ' + DOW[parseISO(t0).getDay()] + ' ' + parseISO(t0).getDate() : (todayDay.label || prettyDate(todayDay.date))]);
    if (b.days.length > 1) tabs.push(['all', 'Whole event']);
    if (b.you.length) tabs.push(['you', 'Your part']);
    if (b.people.length || b.open.length || b.warnings.length) tabs.push(['ops', 'People & open items']);
    const cur = tabs.some((x) => x[0] === EventBrief.tab[k]) ? EventBrief.tab[k] : (tabs[0] || [''])[0];
    const item = (i) => '<li class="eb-t' + (i.you ? ' eb-you' : '') + '"><span class="eb-tm' + (i.tbc ? ' eb-tbc' : '') + '">' + esc(i.time || (i.tbc ? 'TBC' : '—')) + '</span><span>' + esc(i.text) +
      (i.you ? ' <b class="eb-me">You</b>' : '') + '</span></li>';
    const dayHtml = (d, head) => '<h5>' + esc(head || ((d.label ? d.label + ' — ' : '') + prettyDate(d.date))) + '</h5><ul>' + d.items.map(item).join('') + '</ul>';
    const bullets = (arr, cls) => '<ul>' + arr.map((x) => '<li' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(x) + '</li>').join('') + '</ul>';
    const done = rec.done || [];
    let pane = '';
    if (cur === 'day' && todayDay) pane = dayHtml(todayDay) + (b.where.length ? '<h5>Where</h5>' + bullets(b.where) : '');
    else if (cur === 'all') pane = b.days.map((d) => dayHtml(d)).join('') + (b.where.length ? '<h5>Where</h5>' + bullets(b.where) : '');
    else if (cur === 'you') pane = '<h5>Your part</h5>' + bullets(b.you);
    else if (cur === 'ops') pane =
      (b.warnings.length ? '<h5>Check</h5>' + bullets(b.warnings, 'eb-warn') : '') +
      (b.people.length ? '<h5>Who to call</h5><ul>' + b.people.map((p) => '<li><b>' + esc(p.name) + '</b>' + (p.role ? ' — ' + esc(p.role) : '') +
        (p.phone ? ' · <a class="flow-link" href="tel:' + esc(p.phone.replace(/[^\d+]/g, '')) + '">' + esc(p.phone) + '</a>' : '') + '</li>').join('') + '</ul>' : '') +
      (b.open.length ? '<h5>Still open</h5><ul class="eb-open">' + b.open.map((x, i) => '<li class="' + (done.indexOf(i) >= 0 ? 'done' : '') + '"><button type="button" class="eb-bx" data-eb="tick" data-ebk="' + esc(k) + '" data-i="' + i + '" aria-label="Done"></button><span>' + esc(x) + '</span></li>').join('') + '</ul>' : '');
    const newest = rec.sources.map((s) => s.last).filter(Boolean).sort().pop();
    return '<div class="eb-body">' +
      (b.headline ? '<p class="eb-head">' + esc(b.headline) + '</p>' : '') +
      '<div class="eb-meta"><span>Updated ' + esc(EventBrief.fmtWhen(rec.at)) + '</span><button type="button" data-eb="refresh" data-ebk="' + esc(k) + '">↻ Refresh</button></div>' +
      (tabs.length > 1 ? '<div class="eb-tabs">' + tabs.map(([id, l]) => '<button type="button" data-eb="tab" data-ebk="' + esc(k) + '" data-t="' + id + '" class="' + (id === cur ? 'on' : '') + '">' + esc(l) + '</button>').join('') + '</div>' : '') +
      '<div class="eb-pane">' + pane + '</div>' +
      '<details class="eb-src"><summary>Built from ' + rec.threads + ' thread' + (rec.threads === 1 ? '' : 's') + ' · ' + rec.mails + ' emails' + (newest ? ' · newest ' + esc(EventBrief.fmtWhen(newest)) : '') + '</summary><ul>' +
        rec.sources.map((s) => '<li>' + (s.link ? '<a class="flow-link" href="' + esc(s.link) + '" target="_blank" rel="noopener">' + esc(s.subject) + '</a>' : esc(s.subject)) + ' · ' + s.total + '</li>').join('') + '</ul></details>' +
      '</div>';
  },

  async click(e, el) {
    const k = el.getAttribute('data-ebk');
    const a = el.getAttribute('data-eb');
    e.preventDefault(); e.stopPropagation();
    if (a === 'toggle') { EventBrief.open[k] = !EventBrief.open[k]; ConnectApps.calendarPaint(); return; }
    if (a === 'tab') { EventBrief.tab[k] = el.getAttribute('data-t'); ConnectApps.calendarPaint(); return; }
    if (a === 'tick') {
      const rec = EventBrief.data[k]; if (!rec) return;
      const i = +el.getAttribute('data-i'); rec.done = rec.done || [];
      const at = rec.done.indexOf(i); if (at >= 0) rec.done.splice(at, 1); else rec.done.push(i);
      await EventBrief.save(); ConnectApps.calendarPaint(); return;
    }
    if (a === 'refresh') {
      const ev = (ConnectApps.cal || []).find((x) => EventBrief.key(x) === k);
      if (ev) { EventBrief.open[k] = true; await EventBrief.run(ev, true); }
    }
  }
};
window.FlowEventBrief = EventBrief;

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
    try { await EventBrief.load(); } catch (e) {}
    ConnectApps.calendarPaint();
    EventBrief.auto(ConnectApps.cal).catch(() => {});
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
    /* Simple names the account under an event only when today's events come from more than one. */
    const accountsToday = new Set((ev || []).map((e) => e.account).filter(Boolean)).size;
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
        (ConnectApps.many && e.account && !(TodayLook.on() && accountsToday <= 1) ? '<div class="td-rk-note">' + esc(e.account) + '</div>' : '') +
        EventBrief.rowHtml(e) +
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
      const eb = e.target.closest('[data-eb]');
      if (eb) { EventBrief.click(e, eb); return; }
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
    /* Labelled Plan, not Focus: the Focus tile on Today is the timer, and
       one word meaning two places sent people to the wrong one. The id stays
       'focus' so remembered positions and links keep working. */
    { id: 'focus', label: 'Plan', icon: 'compass',
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
    { head: 'Plan',   tabs: ['northstar', 'quad', 'compass', 'abko', 'dtc'] },
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
        let hid = []; try { hid = Sections.hiddenNow(); } catch (e) {}
        const ok = (t) => !!Nav.pill(t) && hid.indexOf(t) < 0;
        let want = g.tabs.length > 1 ? Nav.last[g.id] : g.tabs[0];
        if (!ok(want)) want = g.tabs.find(ok) || g.tabs[0];
        Nav.go(want);
      });
    });
    /* The + also closes the menu it opened — it turns into × while open. */
    document.getElementById('fn-capbtn').addEventListener('click', () => {
      if (Nav.capEl && Nav.capEl.classList.contains('on')) Nav.closeCapture(); else Nav.openCapture();
    });
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
    try { SheetDrag.boot(); } catch (e) {}
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
    const own = (() => { try { return !!Photo.data; } catch (e) { return false; } })();
    const me = document.getElementById('fn-me');
    me.innerHTML =
      '<button type="button" class="fn-me-pic" data-me="pick" aria-label="Change photo">' +
        (src ? '<img class="fn-me-face" alt="" src="' + esc(src) + '">' : '<span class="fn-me-face">' + esc(Nav.initial()) + '</span>') +
        '<i class="fn-me-cam" aria-hidden="true">✎</i></button>' +
      '<div class="fn-me-t"><b>' + esc(name || 'You') + '</b>' + (u.email ? '<span>' + esc(u.email) + '</span>' : '') +
        (u.guest ? '' : '<div class="fn-me-acts"><button type="button" data-me="pick">' + (src ? 'Change photo' : 'Add a photo') + '</button>' +
        (own ? '<button type="button" data-me="clear">Remove</button>' : '') + '</div>') + '</div>';
    me.querySelectorAll('[data-me]').forEach((b) => b.addEventListener('click', () => {
      if (u.guest) return;
      if (b.getAttribute('data-me') === 'clear') Photo.clear(); else Photo.pick();
    }));
    const grid = document.getElementById('fn-menugrid');
    const row = (attr, icon, label, sub, cls) =>
      '<button type="button" ' + attr + (cls ? ' class="' + cls + '"' : '') + '>' + Nav.svg(icon) +
      '<span class="fn-m-t"><b>' + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      (cls ? '' : '<i class="fn-m-chev" aria-hidden="true">›</i>') + '</button>';
    let html = '';
    if (Nav.pill('artur')) html += row('data-fn-menu="artur"', Nav.ICON.artur || 'user', 'Profile', 'Your page — mission, roles, the long view');
    html += row('data-fn-menu="settings"', Nav.ICON.settings || 'gear', 'Settings', 'Look, Today, connections, notifications');
    html += TodayLook.on()
      ? row('data-fn-act="ui-advanced"', 'compass', 'Switch to Advanced', 'Every page, as before')
      : row('data-fn-act="ui-simple"', 'today', 'Switch to Simple', 'The new design — every page, cleaner and bigger');
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
      if (a === 'ui-simple' || a === 'ui-advanced') { TodayLook.setSimple(a === 'ui-simple').catch(() => {}); return; }
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
        /* A note closed half-written is still there when Note is opened
           again; it is cleared only once it has been saved. */
        setTimeout(() => ta.focus({ preventScroll: true }), 60);
        return;
      }
      if (id === 'say') { Nav.closeCapture(false); Say.open(); return; }
      /* In Simple, Meal is the photo: the plate read into numbers, here. */
      if (id === 'diet' && TodayLook.on()) { Nav.closeCapture(false); Meals.open(); return; }
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
    grid.innerHTML = (TodayLook.on() ? '<button type="button" data-fn-cap="say">' + Nav.svg('mic') + '<span>Say it</span></button>' : '') +
      Nav.CAPTURE.filter(c => c.id === 'note' || (Nav.pill(c.go || c.id) && hid.indexOf(c.go || c.id) < 0)).map(c =>
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
      '<div class="fn-brand"><span class="fn-mark"></span><span class="fn-nm">The Flow</span>' +
        /* One click between the two interfaces, where it costs no height. */
        '<div class="fn-ui" role="group" aria-label="Interface">' +
        '<button type="button" data-fn-ui="advanced" title="Advanced interface">Advanced</button>' +
        '<button type="button" data-fn-ui="simple" title="Simple interface">Simple</button></div></div>' +
      '<button type="button" class="fn-k" id="fn-kbtn">' + Nav.svg('search') +
        '<span>Search</span><span class="fn-kbd">⌘K</span></button>' +
      '<button type="button" class="fn-sideadd" id="fn-sideadd" aria-keyshortcuts="N">' + Nav.svg('plus') + '<span>Add</span><kbd>N</kbd></button>';

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

    /* The person at the foot of the sidebar opens the same menu as the phone
       avatar — Profile, Settings, Privacy, Sign out — rather than jumping
       straight to the profile page, which left a desktop with no visible way
       to sign out. */
    side.querySelectorAll('[data-fn-side]').forEach(b => {
      const t = b.getAttribute('data-fn-side');
      if (t === 'artur') b.setAttribute('aria-haspopup', 'dialog');
      b.addEventListener('click', () => (t === 'artur' ? Nav.openMenu() : Nav.go(t)));
    });
    document.getElementById('fn-kbtn').addEventListener('click', () => Nav.openPalette());
    document.getElementById('fn-sideadd').addEventListener('click', () => {
      if (Nav.capEl && Nav.capEl.classList.contains('on')) Nav.closeCapture(); else Nav.openCapture();
    });
    side.querySelectorAll('[data-fn-ui]').forEach((b) => b.addEventListener('click', () => {
      TodayLook.setSimple(b.getAttribute('data-fn-ui') === 'simple').catch(() => {});
    }));

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
    /* Remembered for this window only, so a reload — pull to refresh, or a
       sync that found something new — comes back to the same tab, not Today. */
    if (!initial) { try { sessionStorage.setItem('fl:tab', cur); } catch (e) {} }

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
    /* A new account starts in Simple when this Flow says so (the server's
       FLOW_SIMPLE_DEFAULT). Advanced is one switch away and nothing it does
       is lost; an account that has ever chosen stays as it chose, and one
       that inherited an existing Flow is left exactly as it was. */
    try {
      if (Auth.user && !Auth.user.guest && Auth.seed === 'template' && Auth.simpleDefault) {
        const saved = await DB.get(SETTINGS_KEY, null);
        if (!saved || typeof saved.newLook === 'undefined') await Settings.set('newLook', true);
      }
    } catch (e) {}
    await Promise.all([Schedule.load(), Finance.load(), Notes.load(), Journal.load()]);
    /* The first Finances form painted before the second store was read. */
    try { const rf = Ledger.host('renderFinance'); if (typeof rf === 'function') rf(); } catch (e) {}
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
  try { Nav.reloadTab = sessionStorage.getItem('fl:tab'); } catch (e) {}
  try { Nav.install(); } catch (e) { console.warn('[Flow] nav', e); }
  /* Not awaited: the photo arrives when it arrives, and nothing waits on it. */
  if (Auth.user && !Auth.user.guest) Connect.boot().catch(() => {});
  try { SetView.boot(); } catch (e) {}
  try { Typing.boot(); } catch (e) {}
  try { SheetKB.boot(); } catch (e) {}
  try { LeadFirst.boot(); } catch (e) {}
  try { OpenRock.boot(); } catch (e) {}
  /* theflow.today/watch — what a watch tells you to open — lands on the box
     the code goes in. */
  try {
    if (new URLSearchParams(location.search).get('go') === 'watch') {
      window.__flowGoWatch = true;
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
      let n = 0; const t = setInterval(() => { if (document.documentElement.classList.contains('flow-ready') || ++n > 40) { clearInterval(t); try { Nav.go('settings'); } catch (e) {} } }, 250);
    }
  } catch (e) {}
  try { BudgetFold.boot(); } catch (e) {}
  try { EmptyStat.boot(); } catch (e) {}
  if (Auth.user && !Auth.user.guest) Photo.load();
  /* A reload puts you back where you were. Only a reload: a fresh open of
     the app still starts on Today. Read before anything paints (the first
     paint lands on Today and would overwrite it), applied once the app is up. */
  try {
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    const back = Nav.reloadTab;
    if (nav && nav.type === 'reload' && back && back !== 'today' && !/[?&](reset|rock)=/.test(location.search)) {
      let n = 0;
      const t = setInterval(() => {
        if (document.documentElement.classList.contains('flow-ready') || ++n > 40) {
          clearInterval(t);
          if (Nav.current() === 'today' && Nav.pill(back)) Nav.go(back);
        }
      }, 250);
    }
  } catch (e) {}
  if (Auth.user && !Auth.user.guest) { try { Notify.boot(); } catch (e) { console.warn('[Flow] notify', e); } }
  try { Sections.apply(); } catch (e) { console.warn('[Flow] sections', e); }
  if (Auth.user && !Auth.user.guest) Sections.migrate().catch((e) => console.warn('[Flow] sections', e));
  if (Auth.user && !Auth.user.guest) { try { WeekPlan.boot(); } catch (e) { console.warn('[Flow] week', e); } }
  try { HealthMirror.boot(); } catch (e) { console.warn('[Flow] health mirror', e); }
  try { HealthNight.boot(); } catch (e) { console.warn('[Flow] last night', e); }
  try { Habits.boot(); } catch (e) { console.warn('[Flow] habits', e); }
  try { MoneyMask.boot(); } catch (e) { console.warn('[Flow] hide numbers', e); }
  try { TodayLook.boot(); } catch (e) { console.warn('[Flow] today look', e); }
  try { Meals.boot(); } catch (e) { console.warn('[Flow] meals', e); }
  try { HabitDo.boot(); } catch (e) { console.warn('[Flow] habit do', e); }
  try { Say.boot(); } catch (e) { console.warn('[Flow] say', e); }
  try { SimpleSkin.boot(); } catch (e) { console.warn('[Flow] simple skin', e); }
  try { Plus.boot(); } catch (e) { console.warn('[Flow] plus', e); }
  try { Track.boot(); } catch (e) {}
  try { Patterns.boot(); } catch (e) { console.warn('[Flow] patterns', e); }
  FirstRun.boot().catch((e) => console.warn('[Flow] first run', e));
  try { Ahead.boot(); } catch (e) { console.warn('[Flow] ahead', e); }
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
    SetView, PwSheet, BudgetFold, Photo, OpenRock, TodayPlus,
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
  try { RockActions.install(); } catch (e) { console.warn('[Flow] rock actions', e); }
  try { DietPlan.mount(); } catch (e) { console.warn('[Flow] diet plan', e); }
  try { SharedUI.install(); } catch (e) { console.warn('[Flow] shared', e); }

  console.log('%c The Flow · upgrade pack ' + window.__FLOW_UPGRADE__ + ' ready ',
    'background:#17bb92;color:#05231b;font-weight:700;border-radius:4px');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 300));
else setTimeout(boot, 300);

})();
