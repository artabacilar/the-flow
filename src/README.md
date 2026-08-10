# src

The upgrade pack lives inside `life-dashboard.html`, appended before `</body>`.
That is what ships. These are the same modules as separate files, so they can be
read and reviewed without scrolling through nine thousand lines of host code.

- `nav/flow-nav.js` — the navigation: phone tab bar, segment row, capture sheet,
  command palette, desktop sidebar. Every destination routes through
  `.tab[data-tab="X"].click()`, so the host's own render callbacks still fire.
- `nav/flow-nav.css` — its stylesheet.
- `nav/flow-mood.js` — the Mood & Energy chart, rebuilt to match Sleep: one axis
  for both series rather than two, a legend plus end labels, and a backing store
  sized to the device pixel ratio instead of a stretched 800×140 bitmap.

## split.py

`split.py` lifted the pack out of `life-dashboard.html` into `flow-pack.js` and
`flow-pack.css`. It is a one-time operation and has already been run — it is
here as the record of exactly what moved and, more usefully, what did not.

It reorders nothing. The stylesheet link goes where the host's own stylesheet
ends, so the pack still wins the cascade exactly as it did as a `<style>` block
further down the body. The script is `defer`, which runs it after parsing and
before `DOMContentLoaded` — the same window it ran in as the last inline script
in `<body>`. `tests/test-split.js` holds that arrangement in place.

## build.py

`build.py` is the record of one pass, not a general build system. It reads the
file that was on `main` at the sha it pins, applies that pass's edits, and
writes the result. Every anchor is asserted to appear exactly once, because a
silently-missed anchor is how a half-applied edit ships.

It will refuse to run against any base but the one it pins, which means it does
not re-run after its own output is deployed — by then its edits are already in
the file. Keep it for the reasoning: each edit carries a comment explaining what
was wrong and why the fix is shaped the way it is. That is the part worth having
six months from now.

To run it against the version it pins, take that version out of git rather
than keeping a copy next to it:

```
mkdir -p src/base
git show ca9912f:life-dashboard.html > src/base/life-dashboard.html
python3 src/build.py
```

The output is byte-identical to the `life-dashboard.html` committed alongside
it, which is the point: the file that ships can be derived from the file it
replaced plus the edits described here, and nothing else.

The pass it records:

- ten viewport media queries replaced by intrinsic `auto-fit` grids, because the
  sidebar meant the content column was no longer the same width as the window
- the duplicated 🧠, which identified neither section it was used for
- `Schedule.set()`, a function that never existed — shared tasks with due dates
  had not reached the calendar since sharing shipped
- the Mood & Energy chart
- the context rail, removed: it duplicated Today and charged 324px of desktop
  width for the privilege
- the cold open: navigation installed before the network calls it does not
  depend on, the store seeded from the payload the page already downloaded, and
  the sidebar's column reserved at parse time so the layout stops jumping
- two bugs in the price strip that only surfaced once it stopped waiting behind
  the inbox: it inserted itself against a node that was not a child of the
  element it was inserting into, and it did not survive Today re-rendering
