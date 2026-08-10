"""Rebuild life-dashboard.html from what was on main, plus one pass of edits.

This is a record, not a general build system. It reads the file that was on
`main` at the sha pinned below, applies this pass's edits, and writes the
result — and it refuses to run against any other base, so it does not re-run
once its own output is deployed. By then these edits are in the file.

What is worth keeping is the reasoning: every edit below carries a comment
saying what was wrong and why the fix is shaped the way it is.

Every anchor is asserted to match exactly once. A silently-missed anchor is how
a half-applied edit ships, and a half-applied edit in a file this size is very
hard to see.

    python3 src/build.py        # writes src/out/life-dashboard.html
"""
import hashlib, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get('BASE') or os.path.join(ROOT, 'base/life-dashboard.html')
BASE_SHA = 'ca9912fdc8da05e786497e2a1c9d34e19f7117c7d9d1ce11b315136250a3e3d4'

src = open(BASE, encoding='utf-8').read()
got = hashlib.sha256(src.encode('utf-8')).hexdigest()
if got != BASE_SHA:
    sys.exit('base is not the version on main:\n  want %s\n  got  %s' % (BASE_SHA, got))


def once(s, a, b, why):
    n = s.count(a)
    if n != 1:
        sys.exit('anchor for %s appears %d times: %r' % (why, n, a[:70]))
    return s.replace(a, b, 1)


# ── Breakpoints ───────────────────────────────────────────────────────────
#
# Ten of the app's media queries did one job: drop a grid to fewer columns on a
# narrow *viewport*. That was fine when the content column was the viewport.
# It is not any more — the sidebar takes 236px and the rail 296px, so at a
# 1500px viewport the content column is about 900px while every one of these
# queries still believes it has 1500. `.cgrid` is the clearest case: it kept
# seven columns inside a 900px column because 1500 > 1000.
#
# Intrinsic grids fix the cause rather than the symptom. auto-fit + minmax lets
# each grid count its own columns from the space it actually has, so it is
# correct at every width, inside any container, with no query at all — and the
# ten queries simply disappear.
#
# The minmax values are chosen to reproduce each grid's existing behaviour: the
# width at which it used to collapse, minus padding and gaps, divided by the
# column count it used to have.
GRIDS = [
    # (base rule to replace,                                        new columns,   old queries to delete)
    ('.calendar{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-bottom:28px;}',
     '.calendar{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:28px;}',
     ['@media(max-width:900px){.calendar{grid-template-columns:repeat(2,1fr);}}',
      '@media(max-width:520px){.calendar{grid-template-columns:1fr;}}']),

    ('.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;}',
     '.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;margin-bottom:28px;}',
     ['@media(max-width:800px){.grid2{grid-template-columns:1fr;}}']),

    ('.ngrid{display:grid;grid-template-columns:1.1fr 1fr;gap:18px;margin-top:18px;}',
     '.ngrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px;margin-top:18px;}',
     ['@media(max-width:800px){.ngrid{grid-template-columns:1fr;}}']),

    ('.sleep-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;}',
     '.sleep-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:24px;}',
     ['@media(max-width:700px){.sleep-grid{grid-template-columns:1fr;}}']),

    ('.mood-sliders{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px;}',
     '.mood-sliders{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px;margin-bottom:16px;}',
     ['@media(max-width:600px){.mood-sliders{grid-template-columns:1fr;}}']),

    ('.time-breakdown{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}',
     '.time-breakdown{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:20px;}',
     ['@media(max-width:700px){.time-breakdown{grid-template-columns:1fr;}}']),

    ('.fin-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-bottom:24px;}',
     '.fin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;margin-bottom:24px;}',
     ['@media(max-width:800px){.fin-grid{grid-template-columns:1fr;}}']),

    ('.cgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:24px;}',
     '.cgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:24px;}',
     ['@media(max-width:1000px){.cgrid{grid-template-columns:repeat(2,1fr);}}',
      '@media(max-width:520px){.cgrid{grid-template-columns:1fr;}}']),

    ('.qwrap{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;}',
     '.qwrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-bottom:20px;}',
     ['@media(max-width:800px){.qwrap{grid-template-columns:1fr;}}']),

    ('.ws-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}',
     '.ws-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;}',
     ['@media(max-width:860px){.ws-cols{grid-template-columns:1fr;}}']),
]

removed = 0
for old, new, queries in GRIDS:
    src = once(src, old, new, 'grid rule ' + old.split('{')[0])
    for q in queries:
        src = once(src, q, '', 'query ' + q[:44])
        removed += 1

# The pack's own three-column helper had the same viewport assumption.
src = once(src,
    '@media (max-width: 900px){ .flow-grid.c2,.flow-grid.c3,.flow-grid.c4{ grid-template-columns: 1fr; } }',
    '', 'flow-grid query')
removed += 1
src = once(src,
    '.flow-grid.c2 { grid-template-columns: repeat(2, minmax(0,1fr)); }',
    '.flow-grid.c2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }', 'flow-grid c2')
src = once(src,
    '.flow-grid.c3 { grid-template-columns: repeat(3, minmax(0,1fr)); }',
    '.flow-grid.c3 { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }', 'flow-grid c3')
src = once(src,
    '.flow-grid.c4 { grid-template-columns: repeat(4, minmax(0,1fr)); }',
    '.flow-grid.c4 { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }', 'flow-grid c4')

# Today had its own pair of one-off widths for the same reason.
src = once(src,
    '@media(min-width:640px){\n  #tab-today{padding-top:8px;}\n}',
    '#tab-today{padding-top:8px;}', 'today padding query')
removed += 1
src = once(src,
    '@media(max-width:600px){\n  #tab-today{max-width:100%;}\n  .td-head .td-title{font-size:34px;}\n}',
    '@media(max-width:760px){\n  #tab-today{max-width:100%;}\n  .td-head .td-title{font-size:34px;}\n}',
    'today mobile query')

# ── The duplicate icon ────────────────────────────────────────────────────
# 🧠 was the icon for both Brainstorm and Mood & Energy, so it identified
# neither. Brainstorm takes the bulb, matching its icon in the new sidebar.
src = once(src, '<div class="section-header">🧠 Brainstorm — Business Fundamentals</div>',
                '<div class="section-header">💡 Brainstorm — Business Fundamentals</div>',
                'brainstorm header')

# ── Removing the context rail ─────────────────────────────────────────────
#
# The rail was built to stop you losing your place on desktop. In use it did
# something else: it showed the same Q1 items and the same market strip that
# Today already shows, so on Today it was a duplicate of the screen next to it,
# and everywhere else it was a 296px column plus 28px of padding taken off the
# content for a summary you could reach with one tap. On a 1500px window that
# is 324px — more than a fifth of the width — spent on repetition.
#
# It also had a real bug: `.fn-rlab:first-of-type{margin-top:0}` put the TODAY
# label flush against the capture button above it, so the first heading looked
# like it was sitting on the button.
#
# Rather than fix the spacing and keep paying the width, the whole section
# comes out — CSS, module, and its three call sites. Nothing else references
# it, so removal is subtraction only; no behaviour moves anywhere else.


def cut(s, mark, end, why):
    """Delete from the comment banner that owns `mark` up to `end`."""
    for m in (mark, end):
        if s.count(m) != 1:
            sys.exit('cut anchor for %s appears %d times: %r' % (why, s.count(m), m[:60]))
    i = s.rindex('/*', 0, s.index(mark))
    j = s.index(end)
    if j <= i:
        sys.exit('cut range for %s runs backwards' % why)
    return s[:i] + s[j:]


# The stylesheet: section 30 entire, up to the start of section 31.
src = cut(src, ' * The most common desktop complaint about this app',
               '/* ══════════════════════════════════════════════════════════════════════════\n'
               ' * 31 · The system pass  (phase 4)', 'rail stylesheet')

# The module: its banner through the end of the object, stopping at Nav.
src = cut(src, ' * Read-only and derived: it renders from the same modules',
               'const Nav = {\n  installed: false,', 'rail module')

src = once(src, '    Nav.paintSeg(cur);\n    try { Rail.paint(); } catch (e) {}\n',
                '    Nav.paintSeg(cur);\n', 'rail repaint on navigation')
src = once(src, "      toast('Saved to your journal ✓');\n      try { Rail.paint(); } catch (e) {}\n",
                "      toast('Saved to your journal ✓');\n", 'rail repaint after a note')
src = once(src, '    Nav.buildPalette();\n    Rail.build();\n',
                '    Nav.buildPalette();\n', 'rail construction')
src = once(src, '    Markets, Inbox, Ask, Planner, Nav, Rail,',
                '    Markets, Inbox, Ask, Planner, Nav,', 'rail export')

if 'Rail' in src or 'flow-rail' in src or 'fn-rlab' in src:
    sys.exit('the rail is not fully gone')

# ── The Mood & Energy chart ───────────────────────────────────────────────
mood = open(os.path.join(ROOT, 'nav/flow-mood.js'), encoding='utf-8').read()
src = once(src, 'const SleepChart = {', mood + '\nconst SleepChart = {', 'mood chart module')
src = once(src,
    "  try { SleepChart.install(); } catch (e) { console.warn('[Flow] sleep chart', e); }",
    "  try { SleepChart.install(); } catch (e) { console.warn('[Flow] sleep chart', e); }\n"
    "  try { MoodChart.install(); } catch (e) { console.warn('[Flow] mood chart', e); }",
    'mood chart install')
src = once(src, '    Markets, Inbox, Ask, Planner, Nav,',
                '    Markets, Inbox, Ask, Planner, Nav, MoodChart,', 'mood chart export')

# ── Cold-open performance ─────────────────────────────────────────────────
#
# Measured on the live app: the navigation did not appear until 11.4s after
# navigation start. Three separate causes, fixed here.

# 1. The navigation was installed last, behind `await Inbox.load()` and
#    `await Markets.mount()` — two network round-trips it does not depend on.
#    Since the pack's stylesheet hides the host's own pill row and bottom bar
#    immediately, that left the app with *no navigation at all* until both
#    calls returned. Install it as soon as the pills exist, and let the inbox
#    and the price strip fill themselves in afterwards without blocking.
src = once(src,
    "  try { await Inbox.load(); } catch (e) {}\n"
    "  try { await Markets.mount(); } catch (e) {}\n\n"
    "  /* Navigation last: every pill it decorates has to exist first. */\n"
    "  try { Nav.install(); } catch (e) { console.warn('[Flow] nav', e); }",
    "  /* Navigation first. It needs the pills, which exist by now, and nothing\n"
    "     else — so it must not queue behind two network calls. */\n"
    "  try { Nav.install(); } catch (e) { console.warn('[Flow] nav', e); }\n\n"
    "  /* These paint into place when they arrive; nothing waits on them. */\n"
    "  Inbox.load().catch(() => {});\n"
    "  Markets.mount().catch(() => {});",
    'nav install ordering')

#    Taking the inbox out of the way had one consequence worth naming. The
#    price strip paints into #tab-today, and it used to reach that point only
#    after the inbox round-trip had finished — by which time the host had
#    always rendered Today. Now it can win the race and find no home, and the
#    old code answered that by returning: the strip simply never appeared.
#    Waiting for its container is the honest fix; the ordering was never a
#    guarantee, it was luck.
src = once(src,
    "  paint() {\n"
    "    const feed = $('#tab-today') || $('.section#tab-today');\n"
    "    if (!feed) return;",
    "  paint() {\n"
    "    const feed = $('#tab-today') || $('.section#tab-today');\n"
    "    if (!feed) {\n"
    "      /* Today is not on the page yet. Come back for it rather than\n"
    "         dropping the paint, but give up after six seconds so a genuinely\n"
    "         missing container cannot leave a timer running forever. */\n"
    "      if (Markets._waits == null) Markets._waits = 0;\n"
    "      if (Markets._waits++ < 40) setTimeout(Markets.paint, 150);\n"
    "      return;\n"
    "    }\n"
    "    Markets._waits = 0;",
    'market strip waits for Today')

#    And the same luck ran the other way. The host rebuilds #tab-today's
#    innerHTML on every Today render, which erases anything painted into it.
#    The strip survived only because mount() used to finish after the last
#    render of the boot; now that it can finish first, the render wipes it.
#    Re-paint after each render so the strip belongs there by construction
#    rather than by timing.
src = once(src,
    "    await Markets.fetch();\n"
    "    Markets.paint();\n"
    "    /* Refresh while the tab is actually being looked at, not in the background. */",
    "    await Markets.fetch();\n"
    "    /* Today's render replaces the whole section, strip included, so put it\n"
    "       back afterwards instead of relying on having painted last. Hook it\n"
    "       before the first paint, so a paint that fails cannot skip the hook. */\n"
    "    if (!Markets._hooked) {\n"
    "      Markets._hooked = 1;\n"
    "      const hostRender = window.renderToday;\n"
    "      if (typeof hostRender === 'function') {\n"
    "        window.renderToday = function () {\n"
    "          const r = hostRender.apply(this, arguments);\n"
    "          try { Markets.paint(); } catch (e) {}\n"
    "          return r;\n"
    "        };\n"
    "      }\n"
    "    }\n"
    "    Markets.paint();\n"
    "    /* Refresh while the tab is actually being looked at, not in the background. */",
    'market strip survives a Today render')

#    The insertion itself was wrong, and only survived because it never ran.
#    The pulse strip lives inside #today-feed, a *descendant* of #tab-today —
#    so its siblings are not children of the feed Markets holds, and inserting
#    against them throws. It threw straight through mount()'s catch, which is
#    why the strip vanished rather than misplacing itself.
src = once(src,
    "      const pulse = $('.flow-td-pulse', feed);\n"
    "      if (pulse && pulse.nextSibling) feed.insertBefore(strip, pulse.nextSibling);\n"
    "      else if (pulse) feed.appendChild(strip);\n"
    "      else feed.insertBefore(strip, feed.firstChild);",
    "      /* Put the strip in whatever parent the pulse actually has — that is\n"
    "         where it was always meant to sit, and it is the only node we know\n"
    "         the reference sibling belongs to. */\n"
    "      const pulse = $('.flow-td-pulse', feed);\n"
    "      if (pulse && pulse.parentNode) pulse.parentNode.insertBefore(strip, pulse.nextSibling);\n"
    "      else feed.insertBefore(strip, feed.firstChild);",
    'market strip insertion point')

# 2. hydrateFromDB already downloads every key — 1.29MB of it — and then keeps
#    only the ld_* ones, discarding the flow:* keys from the same payload. The
#    pack then re-fetched six of those one at a time, about five seconds of
#    serial round-trips for data that was already on the wire. Keep the payload
#    so the pack can seed its cache from it.
src = once(src,
    "    const all = JSON.parse(xhr.responseText);",
    "    const all = JSON.parse(xhr.responseText);\n"
    "    window.__FLOW_ALL = all;   /* the pack seeds its cache from this */",
    'hydration payload')

src = once(src,
    "  try {\n    await Settings.load();",
    "  /* Seed DB from the payload hydrateFromDB already downloaded, using the\n"
    "     same parse rules as DB.get, so the gets below are cache hits instead\n"
    "     of one round-trip each. */\n"
    "  try {\n"
    "    const seed = window.__FLOW_ALL;\n"
    "    if (seed) Object.keys(seed).forEach((k) => {\n"
    "      if (DB._mem.has(k)) return;\n"
    "      let v = seed[k];\n"
    "      if (typeof v === 'string') {\n"
    "        const t = v.trim();\n"
    "        if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {\n"
    "          try { v = JSON.parse(t); } catch (e) { /* not JSON — keep the string */ }\n"
    "        }\n"
    "      }\n"
    "      DB._mem.set(k, v);\n"
    "    });\n"
    "  } catch (e) { console.warn('[Flow] seed', e); }\n\n"
    "  try {\n    await Settings.load();",
    'DB seeding')

# 3. The desktop layout shifted when the sidebar finally appeared, because the
#    padding that makes room for it is on body.fn-on and that class was added by
#    the same late JavaScript. Add it at parse time so the content column starts
#    in the right place — with a watchdog that takes it back off if the pack
#    never boots, rather than leaving an empty gutter.
src = once(src, "<body>",
    "<body>\n"
    "<script>/* Reserve the sidebar column before the pack boots so the layout "
    "does not jump; undone below if the pack never arrives. */\n"
    "try{document.body.classList.add('fn-on');setTimeout(function(){\n"
    "  if(!document.getElementById('flow-side')&&!document.getElementById('flow-tabbar'))\n"
    "    document.body.classList.remove('fn-on');\n"
    "},9000);}catch(e){}</script>",
    'layout reservation')

out = os.path.join(ROOT, 'out/life-dashboard.html')
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, 'w', encoding='utf-8').write(src)
print('built %s  %d bytes  sha256 %s\n%d media queries removed'
      % (out, len(src.encode('utf-8')),
         hashlib.sha256(src.encode('utf-8')).hexdigest()[:16], removed))
