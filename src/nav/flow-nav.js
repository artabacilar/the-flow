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
