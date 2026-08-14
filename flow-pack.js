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

function debounce(fn, ms) {
  let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); };
}
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
const SETTINGS_DEFAULTS = {
  displayName: '',
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
  upgradeVisuals: true,
  breakdownForm: 'donut',
  categories: DEFAULT_CATEGORIES.slice(),
  merchantMemory: {},            // learned merchant → category
  budgetMonthly: 0
};

const Settings = {
  data: Object.assign({}, SETTINGS_DEFAULTS),
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

  async load() {
    if (Markets.watch === null) {
      const saved = await DB.get(Markets.KEY, null);
      Markets.watch = Array.isArray(saved) && saved.length ? saved : Markets.DEFAULT.slice();
    }
    return Markets.watch;
  },
  async setWatch(list) {
    Markets.watch = list.slice(0, 8);
    await DB.set(Markets.KEY, Markets.watch);
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
    await Markets.fetch();
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
        if (document.hidden) return;
        await Markets.fetch();
        Markets.paint();
      }, 120000);
    }
  },

  paint() {
    const feed = $('#tab-today') || $('.section#tab-today');
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
      /* Put the strip in whatever parent the pulse actually has — that is
         where it was always meant to sit, and it is the only node we know
         the reference sibling belongs to. */
      const pulse = $('.flow-td-pulse', feed);
      if (pulse && pulse.parentNode) pulse.parentNode.insertBefore(strip, pulse.nextSibling);
      else feed.insertBefore(strip, feed.firstChild);
    }
    /* On the phone the database pill and the save line no longer live in the
       header — the top of the screen belongs to Today, not to diagnostics.
       They sit here instead, right under the market strip. The host's own
       updateDbIndicator()/S.saved() write into these ids exactly as they do
       the header pair, so there is one source of truth and two mounts. */
    if (!$('#flow-dbline', feed)) {
      const dbl = document.createElement('div');
      dbl.id = 'flow-dbline';
      dbl.className = 'flow-td flow-dbline';
      dbl.innerHTML = '<span class="dbind" id="dbInd3"></span><span class="saveind" id="saveInd3"></span>';
      strip.parentNode.insertBefore(dbl, strip.nextSibling);
      /* The host may have painted its indicators before this node existed —
         ask it to write them again now that there is somewhere to write. */
      try { if (typeof updateDbIndicator === 'function') updateDbIndicator(); } catch (e) {}
      try { if (typeof S !== 'undefined' && S && typeof S.saved === 'function') S.saved(); } catch (e) {}
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

  /** File an accepted task into this person's own Q1 priorities. */
  async file(item) {
    const q = Profile.host('qData'), qSave = Profile.host('qSave');
    if (!q || typeof qSave !== 'function') throw new Error('Could not reach your priorities.');
    q.items = q.items || [];
    q.items.push({
      id: 'q' + Date.now().toString(36),
      q: 1,
      txt: item.task.txt + (item.from ? '  (from ' + item.from.name + ')' : ''),
      done: false
    });
    qSave();
    if (item.task.due) {
      try {
        Schedule.put('quad::' + q.items[q.items.length - 1].id, {
          date: item.task.due, time: item.task.time || '09:00', text: item.task.txt
        });
      } catch (e) { console.warn('[Flow] schedule shared task', e); }
    }
    if (typeof window.renderQuad === 'function') window.renderQuad();
    if (typeof window.renderToday === 'function') window.renderToday();
  },

  render(host) {
    const n = Inbox.items.length;
    const box = document.createElement('div');
    box.className = 'flow-card flow-x';
    box.id = 'flow-inbox';
    box.innerHTML = `<h3>📥 Shared with you${n ? ' · ' + n : ''}</h3>` +
      (!n ? '<p class="flow-sub">Nothing waiting. When somebody shares a task with you it appears here.</p>'
          : '<p class="flow-sub">Nothing is added to your app until you press Add.</p>' +
            Inbox.items.map(it => `
              <div class="flow-inbox-row" data-id="${esc(it.id)}">
                <div class="t">${esc(it.task.txt)}</div>
                <div class="m">from ${esc(it.from ? it.from.name : 'someone')}${it.task.due ? ' · due ' + esc(it.task.due) + (it.task.time ? ' ' + esc(it.task.time) : '') : ''}</div>
                ${it.task.note ? `<div class="n">${esc(it.task.note)}</div>` : ''}
                <div class="a">
                  <button class="flow-btn small primary" data-inbox="add">Add to my priorities</button>
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
        Inbox.render(parent);
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
const Ask = {
  turns: [],
  busy: false,

  render(sec) {
    sec.innerHTML = `
      <div class="flow-hero-wrap">
        <div class="flow-eyebrow">READS YOUR FLOW · NEVER CHANGES IT</div>
        <div class="flow-hero">Ask</div>
      </div>
      <div class="flow-card">
        <p class="flow-sub">It can see your priorities, week, journal, training, habits, sleep and spending, and answer questions about them. It cannot add or edit anything — that is deliberate.</p>
        <div id="ask-log" class="flow-ask-log"></div>
        <div class="flow-row ask-compose" style="margin-top:12px">
          <textarea class="flow-in grow" id="ask-in" rows="2" placeholder="What should I focus on this week?"></textarea>
          <button class="flow-btn primary" id="ask-go">Ask</button>
        </div>
        <div class="flow-sub" id="ask-meta" style="margin-top:8px"></div>
        <div class="flow-row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
          ${['What should I focus on this week?', 'How has my sleep been?', 'Am I keeping up with training?', 'Where is my money going?']
            .map(q => `<button class="flow-btn tiny ghost" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}
        </div>
      </div>`;

    const log = $('#ask-log', sec), input = $('#ask-in', sec), meta = $('#ask-meta', sec);
    const draw = () => {
      log.innerHTML = Ask.turns.map(t =>
        `<div class="flow-ask-turn ${t.role}"><div class="who">${t.role === 'user' ? 'You' : 'Flow'}</div><div class="txt">${esc(t.content).replace(/\n/g, '<br>')}</div></div>`).join('');
      log.scrollTop = log.scrollHeight;
    };

    const ask = async (text) => {
      const q = String(text || input.value || '').trim();
      if (!q || Ask.busy) return;
      Ask.busy = true;
      input.value = '';
      Ask.turns.push({ role: 'user', content: q });
      Ask.turns.push({ role: 'assistant', content: '…' });
      draw();
      try {
        const r = await fetch('/api/flow/chat', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: Ask.turns.filter(t => t.content !== '…') })
        });
        const j = await r.json().catch(() => ({}));
        Ask.turns.pop();
        if (!r.ok) {
          Ask.turns.push({ role: 'assistant', content: j.error || 'That did not work.' });
        } else {
          Ask.turns.push({ role: 'assistant', content: j.reply || '(no answer)' });
          meta.textContent = j.used != null ? j.used + ' of ' + j.cap + ' messages used today' : '';
        }
      } catch (e) {
        Ask.turns.pop();
        Ask.turns.push({ role: 'assistant', content: 'Could not reach the server.' });
      }
      Ask.busy = false;
      draw();
    };

    $('#ask-go', sec).addEventListener('click', () => ask());
    input.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') ask();
    });
    sec.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ask]');
      if (b) ask(b.getAttribute('data-ask'));
    });
    draw();
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
    const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const monthSpend = Finance.inMonth(ym).reduce((a, x) => a + Math.abs(Number(x.amount) || 0), 0);
    const cats = Finance.byCategory(Finance.inMonth(ym));
    const rolls = Rollup.all();
    const allChecks = rolls.reduce((a, r) => ({ total: a.total + r.checks.total, done: a.done + r.checks.done }), { total: 0, done: 0 });
    const budget = Number(s.budgetMonthly) || 0;

    section.innerHTML = `
      <div class="flow-row between" style="margin:6px 0 2px">
        <div>
          <div class="flow-label">${esc(DOW[now.getDay()])}, ${now.getDate()} ${esc(MON[now.getMonth()])} ${now.getFullYear()} · week ${wk.week}</div>
          <div class="flow-hero">${esc(s.displayName || 'Your day')}</div>
        </div>
        <div class="flow-row">
          <button class="flow-btn" data-a="refresh">↻ Refresh</button>
          <button class="flow-btn primary" data-a="settings">⚙ Settings</button>
        </div>
      </div>

      <div class="flow-grid c4" style="margin-top:16px">
        <div class="flow-stat"><div class="v">${todayItems.filter(t => !t.done).length}</div><div class="l">Scheduled today</div>
          <div class="d">${todayItems.length ? esc(todayItems.filter(t => t.done).length + ' already done') : 'nothing on the clock yet'}</div></div>
        <div class="flow-stat"><div class="v">${weekItems.length}</div><div class="l">Scheduled this week</div>
          <div class="d">${esc(prettyDate(weekFrom))} → ${esc(prettyDate(weekTo))}</div></div>
        <div class="flow-stat"><div class="v" style="${overdue.length ? 'color:var(--f-critical)' : ''}">${overdue.length}</div><div class="l">Overdue</div>
          <div class="d">${overdue.length ? '⚠ needs rescheduling' : 'all clear'}</div></div>
        <div class="flow-stat"><div class="v">${allChecks.total ? Math.round(allChecks.done / allChecks.total * 100) : 0}%</div><div class="l">Checkboxes ticked</div>
          <div class="d">${allChecks.done} of ${allChecks.total} across every tab</div></div>
      </div>

      <div class="flow-grid c2">
        <div class="flow-card">
          <h3>⏱ Today</h3>
          <p class="flow-sub">Everything you gave a time to, from any tab. Add times with the 🕘 chip that now sits on every task row.</p>
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
        <p class="flow-sub">Apple downloads a standard .ics you open on your Mac or iPhone. Google writes straight into your calendar and updates the same events on every later export instead of duplicating them.</p>
        <div class="flow-row">
          <span class="flow-label">Range</span>
          <select class="flow-in" id="ar-range">
            <option value="week">This week</option>
            <option value="2weeks">Next 2 weeks</option>
            <option value="4weeks" selected>Next 4 weeks</option>
            <option value="12weeks">Next 12 weeks</option>
            <option value="all">Everything</option>
          </select>
          <button class="flow-btn" data-a="ics"> Apple Calendar (.ics)</button>
          <button class="flow-btn" data-a="gcal">📆 Google Calendar</button>
          <button class="flow-btn" data-a="rem">🔔 iOS Reminders</button>
          <span class="flow-spacer"></span>
          <span class="flow-note-status" id="ar-calstatus"></span>
        </div>
      </div>

      <div class="flow-grid c2">
        <div class="flow-card">
          <h3>💰 ${esc(MON[now.getMonth()])} spending</h3>
          <p class="flow-sub">From receipts you photograph and statements you import, in the Finances tab.</p>
          <div class="flow-hero" style="font-size:38px">${esc(money(monthSpend, s.currency))}</div>
          ${budget ? Chart.meter(monthSpend, budget, { label: 'Monthly budget', format: v => money(v, s.currency) }) : '<p class="flow-empty">Set a monthly budget in Settings to track it here.</p>'}
          ${cats.length ? `<div style="margin-top:16px">${Chart.bars(cats.slice(0, 6), { format: v => money(v, s.currency), labelWidth: 120, title: 'Spending by category' })}</div>` : '<p class="flow-empty">No expenses logged this month yet.</p>'}
        </div>

        <div class="flow-card">
          <h3>📊 Live roll-up</h3>
          <p class="flow-sub">Read straight off your existing tabs as they stand right now — no duplicate data entry.</p>
          <div class="flow-scroll"><table class="flow-table">
            <thead><tr><th>Tab</th><th class="num">Ticked</th><th>Headline</th></tr></thead>
            <tbody>${rolls.map(r => `
              <tr><td>${esc(r.label)}</td>
                  <td class="num">${r.checks.total ? r.checks.done + '/' + r.checks.total : '—'}</td>
                  <td>${r.stats.slice(0, 2).map(st => `<span class="flow-chip">${esc(st.value)} · ${esc(String(st.label).toLowerCase().slice(0, 26))}</span>`).join(' ') || '<span style="color:var(--f-muted)">—</span>'}</td></tr>`).join('')}
            </tbody></table></div>
        </div>
      </div>

      ${Journal.entries.some(e => e.date === today()) ? '' : `
      <div class="flow-card" style="border-color:rgba(23,187,146,.3)">
        <div class="flow-row between">
          <div>
            <h3 style="margin:0">📓 Today isn't written yet</h3>
            <p class="flow-sub" style="margin:4px 0 0">${Journal.streak() ? Journal.streak() + ' day streak going. ' : ''}Two minutes now beats reconstructing the week on Sunday.</p>
          </div>
          <button class="flow-btn primary" data-a="journal">Write today's entry</button>
        </div>
      </div>`}

      <div class="flow-card" data-artur-notes></div>`;

    // notes for the Planner tab itself
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
  LIST: [
    { id: '',          name: 'Flow',      sub: 'default',      dot: '#0093e7', tc: '#0a0b0d' },
    { id: 'slate',     name: 'Slate',     sub: 'masculine',    dot: '#4076f0', tc: '#07090d' },
    { id: 'rose',      name: 'Rose',      sub: 'feminine',     dot: '#ff5f95', tc: '#0a0709' },
    { id: 'cyber',     name: 'Cyber',     sub: 'tech',         dot: '#17d4ff', tc: '#05070e' },
    { id: 'executive', name: 'Executive', sub: 'entrepreneur', dot: '#d1a94e', tc: '#090806' },
    { id: 'athlete',   name: 'Athlete',   sub: 'sporty',       dot: '#ff6a2c', tc: '#0a0705' },
    { id: 'whoop',     name: 'Whoop',     sub: 'stark black',  dot: '#00e6a0', tc: '#000000' }
  ],
  meta(id) { return Theme.LIST.find(t => t.id === (id || '')) || Theme.LIST[0]; },
  current() { return document.documentElement.getAttribute('data-flow-theme') || ''; },

  /* Paint it now. `save !== false` also persists it. */
  apply(id, save) {
    id = id || '';
    const root = document.documentElement;
    if (id) root.setAttribute('data-flow-theme', id);
    else root.removeAttribute('data-flow-theme');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', Theme.meta(id).tc);
    try { localStorage.setItem(Theme.LS, id); } catch (e) {}     /* survives the ld_* purge */
    if (save !== false) { try { DB.set(Theme.KEY, id); } catch (e) {} }
  },

  /* Reconcile at boot: the account's choice wins if signed in, else whatever
     this device last used (already applied pre-paint by the inline script). */
  async init() {
    let id = null;
    try { if (window.__DB_ON) id = await DB.get(Theme.KEY, null); } catch (e) {}
    if (id == null) { try { id = localStorage.getItem(Theme.LS); } catch (e) {} }
    Theme.apply(id || '', false);
  }
};

/* =========================================================================
 * 17 · Settings tab
 * ====================================================================== */
const SettingsUI = {
  render(section) {
    const s = Settings.data;
    const shortcut = location.origin + '/api/flow/reminders.json';

    section.innerHTML = `
      <div style="margin:6px 0 2px">
        <div class="flow-label">Preferences · integrations · data</div>
        <div class="flow-hero" style="font-size:38px">Settings</div>
      </div>

      <div class="flow-card">
        <h3>🎨 Appearance</h3>
        <p class="flow-sub">Pick a colour theme. It applies the instant you tap it — no reload — and is saved to your account (or kept on this device while you're just looking around).</p>
        <div class="theme-grid">
          ${Theme.LIST.map(t => `<button type="button" class="theme-swatch${Theme.current() === t.id ? ' on' : ''}" data-theme="${t.id}">
            <span class="sw-dot" style="--d:${t.dot}"></span>
            <span class="sw-nm">${t.name}</span><span class="sw-sub">${t.sub}</span>
          </button>`).join('')}
        </div>
      </div>

      <div class="flow-grid c2">
        <div class="flow-card">
          <h3>👤 You</h3>
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

        <div class="flow-card">
          <h3>🕘 Time chips</h3>
          <p class="flow-sub">The 🕘 chip is what puts a date, time, duration and alert on tasks that never had one — it is added to every checkbox row across every tab.</p>
          <div class="flow-switch"><div class="t"><b>Show time chips on task rows</b><span>Turn off to hide them everywhere without losing anything you already scheduled.</span></div>
            <input type="checkbox" data-s="showTimeChips" data-type="bool" ${s.showTimeChips ? 'checked' : ''}></div>
          <div class="flow-field" style="margin-top:12px"><label class="flow-label">Limit to these tabs (blank = all)</label>
            <input class="flow-in" data-s="chipTabs" value="${esc(s.chipTabs)}" placeholder="e.g. compass, quad, training"></div>
          <p class="flow-sub" style="margin-top:10px">Tab names available: ${Rollup.sections().map(x => `<code>${esc(x.id.slice(4))}</code>`).join(', ') || '—'}</p>
        </div>
      </div>

      <div class="flow-card">
        <h3>📊 Visuals</h3>
        <p class="flow-sub">Any card in the app headed “Visual breakdown” (or Breakdown / Distribution) is re-rendered with a square-by-construction ring, so it can never be squashed into an ellipse or render blurry text again. The original widget is hidden, never deleted.</p>
        <div class="flow-switch"><div class="t"><b>Re-render breakdown widgets</b><span>Currently upgraded: ${Visuals.upgraded} card${Visuals.upgraded === 1 ? '' : 's'} on this page.</span></div>
          <input type="checkbox" data-s="upgradeVisuals" data-type="bool" ${s.upgradeVisuals !== false ? 'checked' : ''}></div>
        <div class="flow-row" style="margin-top:12px">
          <span class="flow-label">Default shape</span>
          <span class="flow-seg">
            <button class="${s.breakdownForm !== 'bars' ? 'on' : ''}" data-act2="formDonut">Ring</button>
            <button class="${s.breakdownForm === 'bars' ? 'on' : ''}" data-act2="formBars">Bars</button>
          </span>
          <span class="flow-spacer"></span>
          <button class="flow-btn sm ghost" data-act2="restoreViz">Restore the originals</button>
        </div>
        <p class="flow-sub" style="margin-top:10px">Bars are easier to read once there are more than about four categories, because length beats angle for comparing magnitudes. The ring caps at five slices and folds the rest into “Other” — past five, no single-hue scale keeps its steps distinguishable.</p>
      </div>

      <div class="flow-card">
        <h3>📆 Google Calendar</h3>
        <p class="flow-sub">Exports write directly into your Google calendar and are idempotent: the same task always maps to the same event, so re-exporting updates it instead of creating a duplicate.</p>
        <div class="flow-grid c2" style="gap:10px">
          <div class="flow-field"><label class="flow-label">OAuth Client ID</label><input class="flow-in" data-s="gcalClientId" value="${esc(s.gcalClientId)}" placeholder="xxxxx.apps.googleusercontent.com"></div>
          <div class="flow-field"><label class="flow-label">Calendar ID</label><input class="flow-in" data-s="gcalCalendarId" value="${esc(s.gcalCalendarId)}" placeholder="primary"></div>
        </div>
        <ol class="flow-ol">
          <li>Open <b>console.cloud.google.com</b> → create a project → APIs &amp; Services.</li>
          <li>Enable the <b>Google Calendar API</b>.</li>
          <li>OAuth consent screen → External → add yourself as a test user.</li>
          <li>Credentials → Create → <b>OAuth client ID</b> → Web application.</li>
          <li>Authorised JavaScript origins: <code>${esc(location.origin)}</code></li>
          <li>Paste the client ID above. No client secret is needed — the token never leaves your browser.</li>
        </ol>
      </div>

      <div class="flow-card">
        <h3>🔔 iOS Reminders</h3>
        <p class="flow-sub">Apple gives no public web API for Reminders, so there are three real routes. The first works immediately; the second is the one worth setting up once.</p>
        <div class="flow-switch"><div class="t"><b>Enable Reminders export</b><span>Adds the Reminders buttons to the Planner tab and note sections.</span></div>
          <input type="checkbox" data-s="remindersEnabled" data-type="bool" ${s.remindersEnabled ? 'checked' : ''}></div>
        <div class="flow-field" style="margin:12px 0"><label class="flow-label">Reminders list name</label>
          <input class="flow-in" data-s="remindersListName" value="${esc(s.remindersListName)}"></div>

        <div class="flow-grid c3" style="margin-top:6px">
          <div>
            <div class="flow-label" style="margin-bottom:6px">1 · .ics file — works now</div>
            <p class="flow-sub">Export, AirDrop or email the file to yourself, open it on the iPhone and choose Reminders. Each task carries its due date and alert.</p>
            <button class="flow-btn" data-act2="remIcs">Export reminders now</button>
          </div>
          <div>
            <div class="flow-label" style="margin-bottom:6px">2 · Apple Shortcut — automatic</div>
            <p class="flow-sub">Build this once, then run it from the Home Screen or on a schedule:</p>
            <ol class="flow-ol">
              <li>Shortcuts → new shortcut → <b>Get Contents of URL</b></li>
              <li>URL: <code>${esc(shortcut)}</code></li>
              <li><b>Get Dictionary Value</b> → <code>items</code></li>
              <li><b>Repeat with Each</b> → <b>Add New Reminder</b>, title = <code>title</code>, notes = <code>notes</code>, due = <code>dueDate</code>, list = <code>${esc(s.remindersListName)}</code></li>
              <li>Automation → run daily at 06:00</li>
            </ol>
            <button class="flow-btn" data-act2="remPublish">Publish outbox now</button>
          </div>
          <div>
            <div class="flow-label" style="margin-bottom:6px">3 · CalDAV to iCloud — hands-off</div>
            <p class="flow-sub">The server pushes straight into an iCloud Reminders list. Credentials live in Render environment variables and never touch the browser:</p>
            <pre class="flow-code">ICLOUD_USER=you@icloud.com
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
ICLOUD_REMINDER_LIST=${esc(s.remindersListName)}</pre>
            <p class="flow-sub">Generate the app-specific password at appleid.apple.com → Sign-In and Security. Never put your real Apple password there.</p>
            <button class="flow-btn" data-act2="remCaldav">Test CalDAV push</button>
          </div>
        </div>
        <div class="flow-note-status" id="set-remstatus" style="margin-top:10px"></div>
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
          <span class="flow-spacer"></span>
          <button class="flow-btn danger" data-act2="signout">Sign out</button>
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
          <label class="flow-label">Weekly commitments (Sharpen the Saw) — one per line</label>
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
      </div>

      <div class="flow-card">
        <h3>💾 Data</h3>
        <p class="flow-sub">Everything the upgrade pack stores lives under <code>flow:*</code> keys in the same database as the rest of the app, and is mirrored to this browser so it survives going offline.</p>
        <div class="flow-row">
          <button class="flow-btn" data-act2="backup">↓ Download full backup</button>
          <button class="flow-btn" data-act2="restore">↑ Restore from backup</button>
          <input type="file" accept="application/json,.json" id="set-restore" style="display:none">
          <span class="flow-spacer"></span>
          <button class="flow-btn danger" data-act2="wipe">Erase upgrade-pack data</button>
        </div>
        <p class="flow-sub" style="margin-top:10px">Stored right now: ${Schedule.all().length} scheduled items · ${Finance.items.length} expenses · ${Object.keys(Notes.book).length} notebooks · ${Queue.list().length} unsynced change${Queue.list().length === 1 ? '' : 's'}</p>
      </div>`;

    /* --- persist any field with a data-s attribute --- */
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
        if (key === 'showTimeChips') {
          if (v) {
            TimeChips.scan(document);
          } else {
            $$('.flow-time-chip').forEach(c => c.remove());
            $$('[data-flow-timed]').forEach(r => r.removeAttribute('data-flow-timed'));
          }
        }
        /* Reflect the change on the app straight away — no reload. The name
           feeds the planner tab and greetings; currency and budgets feed the
           money views; the rest is picked up by a light repaint. */
        try { Planner.applyTabName(); } catch (e) {}
        try { if (window.Flow && typeof window.Flow.refresh === 'function') window.Flow.refresh(); } catch (e) {}
        try { if (typeof window.renderToday === 'function') window.renderToday(); } catch (e) {}
        toast('Saved ✓', null, 1200);
      };
      el.addEventListener('change', commit);
    });

    /* Colour-theme swatches — apply instantly, persist, and re-mark the row. */
    section.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        Theme.apply(btn.getAttribute('data-theme'));
        section.querySelectorAll('[data-theme]').forEach(b =>
          b.classList.toggle('on', b === btn));
      });
    });

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
      if (a === 'changepw') {
        const current = prompt('Your current password:');
        if (current == null) return;
        const next = prompt('New password (at least 10 characters):');
        if (next == null) return;
        try { await Auth.post('/api/auth/password', { current, next }); toast('Password changed ✓'); }
        catch (e) { toast(e.message, 'err', 5000); }
        return;
      }
        const st = section.querySelector('#set-remstatus');
        if (a === 'remIcs') Reminders.exportICS();
        else if (a === 'remPublish') {
          const r = await Reminders.publishForShortcut();
          st.textContent = `Outbox published — ${r.length} item${r.length === 1 ? '' : 's'} ready at ${shortcut}`;
          st.className = 'flow-note-status ok';
        }
        else if (a === 'remCaldav') {
          st.textContent = 'Pushing…'; st.className = 'flow-note-status pending';
          try {
            const r = await Reminders.caldavPush();
            st.textContent = `CalDAV: ${r.pushed || 0} pushed, ${r.failed || 0} failed`;
            st.className = 'flow-note-status ok';
          } catch (e) {
            st.textContent = e.message + ' — is the server add-on installed and are the iCloud env vars set?';
            st.className = 'flow-note-status pending';
          }
        }
        else if (a === 'formDonut' || a === 'formBars') {
          await Settings.set('breakdownForm', a === 'formBars' ? 'bars' : 'donut');
          $$('[data-flow-viz] .flow-viz').forEach(m => { if (m.__repaint) m.__repaint(); });
          SettingsUI.render(section);
        }
        else if (a === 'restoreViz') { Visuals.restoreAll(); toast('Original widgets restored'); SettingsUI.render(section); }
        else if (a === 'forget') { await Settings.set('merchantMemory', {}); toast('Merchant memory cleared'); SettingsUI.render(section); }
        else if (a === 'backup') {
          const dump = {
            exportedAt: new Date().toISOString(), version: window.__FLOW_UPGRADE__,
            settings: Settings.data, schedule: Schedule.map, expenses: Finance.items, notes: Notes.book
          };
          download(`the-flow-upgrade-backup-${today()}.json`, JSON.stringify(dump, null, 2), 'application/json');
        }
        else if (a === 'restore') section.querySelector('#set-restore').click();
        else if (a === 'wipe') {
          if (!confirm('Erase everything the upgrade pack stores — schedules, expenses, receipts and notes?\n\nYour original Flow data is not touched.')) return;
          if (!confirm('Really erase? This cannot be undone.')) return;
          await DB.set(SCHEDULE_KEY, {}); await DB.set(EXPENSE_KEY, []); await DB.set(NOTES_KEY, {});
          Schedule.map = {}; Finance.items = []; Notes.book = {};
          DB._mem.clear();
          toast('Upgrade-pack data erased'); SettingsUI.render(section);
        }
      });
    });

    const rf = section.querySelector('#set-restore');
    if (rf) rf.addEventListener('change', () => {
      const f = rf.files && rf.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = async () => {
        try {
          const d = JSON.parse(String(fr.result));
          if (d.settings) { Settings.data = Object.assign({}, SETTINGS_DEFAULTS, d.settings); await Settings.save(); }
          if (d.schedule) { Schedule.map = d.schedule; await Schedule.saveNow(); }
          if (d.expenses) { Finance.items = d.expenses; await Finance.save(); }
          if (d.notes) { Notes.book = d.notes; await DB.set(NOTES_KEY, Notes.book); }
          toast('Backup restored ✓'); SettingsUI.render(section); TimeChips.repaintAll();
        } catch (e) { toast('That file could not be read: ' + e.message, 'err', 5000); }
      };
      fr.readAsText(f);
    });
  }
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
const TodayGroups = {
  LS: 'flowpack:todayOpen',
  COLLAPSIBLE: [/^diet$/i, /^sharpen the saw$/i],

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
    if (title && title.parentElement && !title.parentElement.querySelector('.flow-td-quote')) {
      const narrow = (window.innerWidth || 999) < 640;
      if (!narrow) { title.style.display = 'inline-block'; title.style.verticalAlign = 'baseline'; }
      const quote = document.createElement('div');
      quote.className = 'flow-td-quote';
      quote.style.cssText = narrow
        ? 'display:block;margin:12px 0 2px;max-width:560px'
        : 'display:inline-block;vertical-align:baseline;margin-left:16px;max-width:540px';
      const qs = narrow ? '14px' : '15px';
      quote.innerHTML =
        '<span style="font-family:Georgia,serif;font-style:italic;font-size:' + qs + ';line-height:1.5;color:var(--muted)">“I am the master of my fate, I am the captain of my soul.”</span>' +
        '<span style="display:block;font-family:Georgia,serif;font-size:11px;letter-spacing:.4px;color:var(--muted);opacity:.7;margin-top:4px">— William Ernest Henley, 1875</span>';
      title.insertAdjacentElement('afterend', quote);
    }

    const rec = TodayPlus.recovery();
    const pri = TodayPlus.priorities();
    const hab = TodayPlus.habits();
    const sp = TodayPlus.spend();

    /* — pulse strip — */
    const recTxt = rec.recovery != null ? rec.recovery + '%' : (rec.hrs != null ? rec.hrs.toFixed(1) + 'h' : '—');
    const recSub = rec.recovery != null
      ? (rec.hrs != null ? rec.hrs.toFixed(1) + 'h sleep' : 'recovery')
      : (rec.hrs != null ? (rec.isToday ? 'last night' : 'last logged') : 'nothing logged');
    const recTone = rec.recovery == null ? '' : (rec.recovery >= 67 ? ' good' : rec.recovery >= 34 ? ' warn' : ' bad');

    const strip = document.createElement('div');
    strip.className = 'flow-td flow-td-pulse flow-x';
    strip.innerHTML = [
      ['recovery', 'Recovery', recTxt, recSub, recTone],
      ['priorities', 'Priorities', String(pri.count), pri.overdue.length ? pri.overdue.length + ' overdue' : (pri.q1.length ? 'urgent open' : 'nothing urgent'), pri.overdue.length ? ' bad' : (pri.q1.length ? ' warn' : ' good')],
      ['habits', 'Habits', hab.total ? hab.done + '/' + hab.total : '—', hab.total ? (hab.done === hab.total ? 'all done' : 'to tick') : 'none set', hab.total && hab.done === hab.total ? ' good' : ''],
      ['spend', 'Spend', sp ? TodayPlus.money(sp.today) : '—', sp ? TodayPlus.money(sp.mtd) + ' this month' : 'nothing logged', '']
    ].map(([k, lbl, v, sub, tone]) =>
      `<button class="flow-td-tile${tone}" data-jump="${k}">
         <span class="l">${lbl}</span><span class="v">${esc(v)}</span><span class="s">${esc(sub)}</span>
       </button>`).join('');

    const head = $('.td-head', feed);
    if (head && head.nextSibling) feed.insertBefore(strip, head.nextSibling); else feed.insertBefore(strip, feed.firstChild);

    /* — priorities — */
    const pblock = document.createElement('div');
    pblock.className = 'flow-td flow-td-sec flow-x';
    pblock.id = 'flow-td-priorities';
    const prow = (txt, meta, cls, attr) =>
      `<div class="flow-td-row${cls || ''}" ${attr || ''}><span class="tx">${esc(txt)}</span>${meta ? `<span class="mt">${esc(meta)}</span>` : ''}</div>`;
    const pbody = [
      ...pri.overdue.slice(0, 4).map(r => prow(r.text, 'overdue · ' + prettyDate(r.date), ' od')),
      ...(pri.flagged || []).slice(0, 5).map(r => prow(r.text, 'priority · ' + (r.date === today() ? 'today' : prettyDate(r.date)), '')),
      ...pri.q1.slice(0, 4).map(i => prow(i.txt, 'Q1 · urgent', '', `data-q="${esc(i.id)}"`)),
      ...pri.q2.slice(0, 3).map(i => prow(i.txt, 'Q2', '', `data-q="${esc(i.id)}"`))
    ].join('');
    pblock.innerHTML =
      `<div class="flow-td-head"><span class="l">Priorities</span><span class="c">${pri.q1.length + pri.q2.length + (pri.flagged || []).length} open</span></div>` +
      (pbody || `<div class="flow-td-empty">Nothing open in Q1 or Q2. Star a Planner task or add them in 🎯 Priorities.</div>`);
    const rocks = $('.td-rocks', feed);
    if (rocks && rocks.nextSibling) feed.insertBefore(pblock, rocks.nextSibling); else feed.appendChild(pblock);

    /* — habits — */
    const hblock = document.createElement('div');
    hblock.className = 'flow-td flow-td-sec flow-x';
    hblock.id = 'flow-td-habits';
    hblock.innerHTML =
      `<div class="flow-td-head"><span class="l">Habits</span><span class="c${hab.total && hab.done === hab.total ? ' ok' : ''}">${hab.done} / ${hab.total}</span></div>` +
      (hab.list.length
        ? hab.list.map(h =>
            `<div class="flow-td-row hb${h.done ? ' done' : ''}" data-hb="${esc(h.id)}">
               <span class="bx">${h.done ? '✓' : ''}</span>
               <span class="tx">${esc(h.name)}</span>
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
      const jump = e.target.closest('[data-jump]');
      if (jump) {
        const id = { recovery: 'flow-td-habits', priorities: 'flow-td-priorities', habits: 'flow-td-habits', spend: 'flow-td-spend' }[jump.getAttribute('data-jump')];
        const el = id && document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const hb = e.target.closest('[data-hb]');
      if (hb) {
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
        return;
      }

      const qr = e.target.closest('[data-q]');
      if (qr) {
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

  /* A "send my scheduled tasks to the calendar" row inside the host's own
     Export-to-Calendar panel. Reuses the pack's Calendar exporter, which
     serialises every Schedule entry (and flagged notes) to a real .ics. */
  injectExport() {
    const host = document.getElementById('icsExport');
    if (!host || document.getElementById('flow-cal-tasks')) return;
    const rangeMap = { '1': 'week', '2': '2weeks', '4': '4weeks', '8': '12weeks', '12': '12weeks' };
    const pick = () => rangeMap[(document.getElementById('icsRange') || {}).value] || '4weeks';
    const row = document.createElement('div');
    row.id = 'flow-cal-tasks';
    row.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
    row.innerHTML =
      '<span style="font-size:12px;color:var(--muted)">📌 Your scheduled tasks (Planner &amp; time-blocked items):</span>' +
      '<button class="btn btn-primary" data-flowcal="apple">⬇️ Apple .ics</button>' +
      '<button class="btn" data-flowcal="google">📆 Google Calendar</button>';
    const panel = host.closest('.panel') || host.parentElement;
    panel.appendChild(row);
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-flowcal]');
      if (!b) return;
      const range = pick();
      try {
        if (b.getAttribute('data-flowcal') === 'apple') Calendar.exportApple(range);
        else Calendar.exportGoogle(range, null);
      } catch (err) { try { toast('Could not export just now.', 'err'); } catch (e2) {} }
    });
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
    const host = document.querySelector('#tab-diet .mealcards');
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
        <input class="flow-in" id="fa-pw" type="password" autocomplete="current-password" placeholder="At least 10 characters">
        <div id="fa-invwrap" hidden>
          <label class="flow-label" for="fa-inv">Invite code</label>
          <input class="flow-in" id="fa-inv" type="text" placeholder="The code you were given">
        </div>
        <button class="flow-btn primary fa-go" id="fa-go">${firstRun ? 'Create account' : 'Sign in'}</button>
        <button class="flow-btn ghost fa-alt" id="fa-alt">${firstRun ? '' : 'Create an account instead'}</button>
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
      err.hidden = true;
    };
    if (!firstRun) $('#fa-alt', el).addEventListener('click', () => setMode(mode === 'signup' ? 'login' : 'signup'));
    else $('#fa-alt', el).style.display = 'none';

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
        const j = await Auth.post(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', payload);
        btn.textContent = j.adopted ? 'Restoring your data…' : 'Loading…';
        /* If they were looking around as a guest first, carry that work into
           the account they just made, before the reload picks it all up. */
        if (mode === 'signup') {
          try { const n = await Auth.adoptCarried(); if (n) btn.textContent = 'Keeping your work…'; } catch (e) {}
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
    { key: 'mon', title: 'Push — Chest, Shoulders, Triceps', tag: 'Push', time: '18:00', type: 'hyper' },
    { key: 'tue', title: 'Pull — Back and Biceps',            tag: 'Pull', time: '18:00', type: 'hyper' },
    { key: 'wed', title: 'Rest / Active Recovery',            tag: 'Rest', time: '',      type: 'rest'  },
    { key: 'thu', title: 'Legs',                              tag: 'Legs', time: '18:00', type: 'hyper' },
    { key: 'fri', title: 'Upper Body',                        tag: 'Upper', time: '18:00', type: 'hyper' },
    { key: 'sat', title: 'Conditioning or a long walk',       tag: 'Cardio', time: '',    type: 'hyper' },
    { key: 'sun', title: 'Rest',                              tag: 'Rest', time: '',      type: 'rest'  }
  ]
};

const Profile = {
  data: null,
  isNew: false,

  host(name) { try { return eval(name); } catch (e) { return undefined; } },

  /** Read the constants as the code currently defines them. */
  capture() {
    const plan = (Profile.host('PLAN') || []).map(d => ({ key: d.key, title: d.title, tag: d.tag, time: d.time, type: d.type }));
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
    const sec = document.getElementById('tab-diet');
    const pick = (sel, root) => { const n = $(sel, root || document); return n ? n.textContent.trim() : ''; };
    const cards = sec ? $('.mealcards', sec) : null;
    let trainNote = '';
    if (sec) $$('h3 span', sec).forEach(sp => { if (/minimum|adapt|train/i.test(sp.textContent || '')) trainNote = sp.textContent.trim(); });
    return {
      dietHeader: sec ? pick('.section-header', sec) : '',
      dietSub: sec ? pick('.section-sub', sec) : '',
      trainNote,
      mealcards: cards ? cards.innerHTML : '',
      habits: $$('.habits7 .h7').map(n => n.innerHTML)
    };
  },

  /** Put captured prose back into the page. Only ever writes what was saved. */
  applyCopy() {
    const c = (Profile.data && Profile.data.copy) || null;
    if (!c) return;
    const sec = document.getElementById('tab-diet');
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
    if (c.habits && c.habits.length) {
      const hs = $$('.habits7 .h7');
      c.habits.forEach((html, i) => { if (hs[i]) hs[i].innerHTML = html; });
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
    swap('SAW_ITEMS', p.saw);
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
        d.time = row.time || '';
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
    const sec = document.getElementById('tab-diet');
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
  gear:     '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  search:   '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  scale:    '<circle cx="12" cy="12" r="9"/><path d="M12 12l3.5-3.5"/>'
};


const Nav = {
  installed: false,

  /* A group is a bottom-bar slot. Its `tabs` are the host tab names it owns,
     in the order they appear in the segment row; the first is the default. */
  GROUPS: [
    { id: 'today', label: 'Today', icon: 'today', tabs: ['today'] },
    { id: 'focus', label: 'Focus', icon: 'target',
      tabs: ['quad', 'compass', 'abko', 'dtc', 'brainstorm', 'time'] },
    { id: 'body',  label: 'Body',  icon: 'dumbbell',
      tabs: ['training', 'diet', 'sleep', 'habits', 'mood'] },
    { id: 'ask',   label: 'Ask',   icon: 'chat', tabs: ['ask'] }
  ],

  /* Reachable from the avatar and from the palette, but not worth a slot. */
  MENU: ['journal', 'finance', 'artur', 'settings'],

  ICON: {
    today: 'today', quad: 'target', compass: 'compass', abko: 'work', dtc: 'rocket',
    brainstorm: 'bulb', time: 'clock', training: 'dumbbell', diet: 'food',
    sleep: 'moon', habits: 'check', mood: 'heart', journal: 'note',
    finance: 'money', ask: 'chat', artur: 'user', settings: 'gear'
  },

  /* Sidebar order and headings. */
  SIDE: [
    { head: '',       tabs: ['today'] },
    { head: 'Focus',  tabs: ['quad', 'compass', 'abko', 'dtc', 'brainstorm', 'time'] },
    { head: 'Body',   tabs: ['training', 'diet', 'sleep', 'habits', 'mood'] },
    { head: 'Record', tabs: ['journal', 'finance', 'ask'] }
  ],
  SIDE_FOOT: ['artur', 'settings'],

  CAPTURE: [
    { id: 'note',    label: 'Note',    icon: 'note'     },
    { id: 'quad',    label: 'Task',    icon: 'target'   },
    { id: 'finance', label: 'Expense', icon: 'money'    },
    { id: 'training',label: 'Set',     icon: 'dumbbell' },
    { id: 'habits',  label: 'Habit',   icon: 'check'    },
    { id: 'mood',    label: 'Mood',    icon: 'heart'    },
    { id: 'diet',    label: 'Meal',    icon: 'food'     },
    { id: 'sleep',   label: 'Sleep',   icon: 'moon'     },
    { id: 'time',    label: 'Time',    icon: 'clock'    }
  ],

  last: { focus: 'quad', body: 'training' },

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
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
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
        /* Returning to a group lands you where you left it. */
        const want = (g.tabs.length > 1 && Nav.last[g.id]) ? Nav.last[g.id] : g.tabs[0];
        Nav.go(Nav.pill(want) ? want : g.tabs[0]);
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

  paintSeg(cur) {
    const seg = Nav.segEl;
    if (!seg) return;
    const g = Nav.groupOf(cur);
    const host = document.querySelector('.section.active');

    if (!g || g.tabs.length < 2 || !host) { seg.style.display = 'none'; return; }

    const tabs = g.tabs.filter(t => Nav.pill(t));
    seg.innerHTML = tabs.map(t =>
      '<button type="button" data-fn-seg="' + t + '" class="' + (t === cur ? 'on' : '') + '">' +
      esc(Nav.label(t)) + '</button>').join('');
    seg.querySelectorAll('[data-fn-seg]').forEach(b => {
      b.addEventListener('click', () => Nav.go(b.getAttribute('data-fn-seg')));
    });

    if (seg.parentElement !== host || host.firstChild !== seg) host.insertBefore(seg, host.firstChild);
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
      '<div class="fn-sheet" role="dialog" aria-label="You">' +
        '<div class="fn-grab" data-fn-close="1"></div>' +
        '<h4>You</h4>' +
        '<div class="fn-sub">Everything that is not part of the daily loop.</div>' +
        '<div class="fn-grid" id="fn-menugrid"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.querySelectorAll('[data-fn-close]').forEach(e =>
      e.addEventListener('click', () => wrap.classList.remove('on')));
    Nav.menuEl = wrap;
  },

  openMenu() {
    const grid = document.getElementById('fn-menugrid');
    /* Rebuilt each time: the planner's label follows the signed-in name. */
    grid.innerHTML = Nav.MENU.filter(t => Nav.pill(t)).map(t =>
      '<button type="button" data-fn-menu="' + t + '">' + Nav.svg(Nav.ICON[t] || 'note') +
      '<span>' + esc(Nav.label(t)) + '</span></button>').join('');
    grid.querySelectorAll('[data-fn-menu]').forEach(b => b.addEventListener('click', () => {
      Nav.menuEl.classList.remove('on');
      Nav.go(b.getAttribute('data-fn-menu'));
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
      '<div class="fn-sheet" role="dialog" aria-label="Capture">' +
        '<div class="fn-grab" data-fn-close="1"></div>' +
        '<h4>Capture</h4>' +
        '<div class="fn-sub">A note is saved without leaving this screen.</div>' +
        '<div class="fn-grid">' +
          Nav.CAPTURE.filter(c => c.id === 'note' || Nav.pill(c.id)).map(c =>
            '<button type="button" data-fn-cap="' + c.id + '">' + Nav.svg(c.icon) +
            '<span>' + esc(c.label) + '</span></button>').join('') +
        '</div>' +
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

    wrap.querySelectorAll('[data-fn-cap]').forEach(b => b.addEventListener('click', () => {
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
      Nav.closeCapture();
      Nav.go(id);
    }));

    document.getElementById('fn-notecancel').addEventListener('click', () => wrap.classList.remove('note'));
    document.getElementById('fn-notesave').addEventListener('click', () => Nav.saveNote());
    document.getElementById('fn-noteinput').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') Nav.saveNote();
    });
  },

  openCapture() { Nav.capEl.classList.remove('note'); Nav.capEl.classList.add('on'); },
  closeCapture() { Nav.capEl.classList.remove('on'); Nav.capEl.classList.remove('note'); },

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
    if (av) av.textContent = Nav.initial();
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

  install() {
    if (Nav.installed) return;
    Nav.installed = true;

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

async function boot() {
  /* Before anything else: if the server has accounts installed and nobody is
     signed in, put the sign-in screen up. Everything below still runs, so the
     app is ready the moment the session exists. */
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
     of one round-trip each. */
  try {
    const seed = window.__FLOW_ALL;
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
  } catch (e) { console.error('[Flow] load failed', e); }

  Tabs.init();
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
  /* Reconcile the colour theme (account value wins over the device default the
     inline script already painted). Never blocks the veil below. */
  try { await Theme.init(); } catch (e) { console.warn('[Flow] theme', e); }
  /* The chrome exists — lift the boot veil. The host holds the page invisible
     until this class lands, so nobody ever sees the pre-pack layout flash by
     before the real navigation appears. (The host also lifts it on a timer,
     so a pack that dies before this line cannot leave the screen blank.) */
  try { document.documentElement.classList.add('flow-ready'); } catch (e) {}

  /* These paint into place when they arrive; nothing waits on them. */
  Inbox.load().catch(() => {});
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

  // notes drawer at the bottom of every existing tab
  Rollup.sections().forEach(sec => {
    const name = sec.id.slice(4);
    Notes.mountInline(sec, name, Rollup.labelFor(name).replace(/^[^\w]+/, '') || name);
  });

  // replace any broken/stretched breakdown widgets across the app
  Visuals.upgradeAll();

  Queue.flush();

  window.Flow = {
    version: window.__FLOW_UPGRADE__,
    DB, Settings, Schedule, Finance, Notes, Journal, Calendar, Reminders, ICS, GCAL, Chart, Visuals, Rollup, Tabs, TimeChips, Auth, Profile,
    Markets, Inbox, Ask, Planner, Nav, MoodChart,
    toast,
    refresh: () => { TimeChips.scan(document); TimeChips.repaintAll(); Visuals.upgradeAll(); Journal.rerender(); }
  };

  try { SleepChart.install(); } catch (e) { console.warn('[Flow] sleep chart', e); }
  try { MoodChart.install(); } catch (e) { console.warn('[Flow] mood chart', e); }
  try { TodayGroups.install(); } catch (e) { console.warn('[Flow] today groups', e); }
  try { CompassPlus.install(); } catch (e) { console.warn('[Flow] compass plus', e); }
  try { DietPlan.mount(); } catch (e) { console.warn('[Flow] diet plan', e); }

  console.log('%c The Flow · upgrade pack ' + window.__FLOW_UPGRADE__ + ' ready ',
    'background:#17bb92;color:#05231b;font-weight:700;border-radius:4px');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 300));
else setTimeout(boot, 300);

})();
