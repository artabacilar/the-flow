#!/usr/bin/env python3
"""Lift the upgrade pack out of life-dashboard.html into its own two files.

Why: the client is one 525KB file. Changing four lines of navigation meant
re-uploading all of it, every browser re-downloading all of it, and every diff
on GitHub being unreadable. The pack is ~40% of that file and it is the part
that actually changes.

What this does *not* do is reorder anything. The stylesheet link goes where the
host's own stylesheet ends, so the pack still wins the cascade exactly as it did
when it was a <style> block further down. The script is `defer`, which runs it
after parsing and before DOMContentLoaded — the same window it ran in as the
last inline script in <body>. Nothing about when the pack sees the DOM changes.

The version marker is deliberately left as a placeholder for the server to fill
in from the files' own hash. If the HTML carried a hard-coded version, then
shipping a pack change without also editing the HTML would serve a stale file
from a year-long cache, and that is exactly the mistake this is meant to make
impossible.

    python3 src/split.py life-dashboard.html
"""
import hashlib, os, re, sys

src_path = sys.argv[1] if len(sys.argv) > 1 else 'life-dashboard.html'
root = os.path.dirname(os.path.abspath(src_path)) or '.'
html = open(src_path, encoding='utf-8').read()

CSS_OPEN = '<style>\n/* ==========================================================================\n   The Flow — Upgrade Pack'
if html.count(CSS_OPEN) != 1:
    sys.exit('cannot find the pack stylesheet exactly once')

i = html.index(CSS_OPEN)
css_start = i + len('<style>\n')
css_end = html.index('</style>', css_start)

# The pack's script is the one immediately after its stylesheet, and it is the
# last script in the document.
js_open = html.index('<script>', css_end)
js_start = js_open + len('<script>')
js_end = html.rindex('</script>')
if js_end <= js_start:
    sys.exit('the pack script does not close after it opens')

css = html[css_start:css_end].strip() + '\n'
js = html[js_start:js_end].strip() + '\n'

open(os.path.join(root, 'flow-pack.css'), 'w', encoding='utf-8').write(css)
open(os.path.join(root, 'flow-pack.js'), 'w', encoding='utf-8').write(js)

# Replace both blocks with references, keeping everything between them intact.
between = html[css_end + len('</style>'):js_open].strip()
if between:
    sys.exit('unexpected markup between the pack stylesheet and its script: %r' % between[:80])

html = (html[:i]
        + '<script src="/flow-pack.js?v=__PACK_V__" defer></script>'
        + html[js_end + len('</script>'):])

# The stylesheet goes at the end of <head>, immediately after the host's own —
# same cascade order it had, but fetched early enough not to flash.
link = '<link rel="stylesheet" href="/flow-pack.css?v=__PACK_V__">\n</head>'
if html.count('</head>') != 1:
    sys.exit('expected exactly one </head>')
html = html.replace('</head>', link, 1)

open(src_path, 'w', encoding='utf-8').write(html)

h = hashlib.sha256((js + css).encode('utf-8')).hexdigest()[:12]
print('flow-pack.js   %7d bytes' % len(js.encode('utf-8')))
print('flow-pack.css  %7d bytes' % len(css.encode('utf-8')))
print('life-dashboard %7d bytes' % len(html.encode('utf-8')))
print('pack version   %s  (the server computes this itself at boot)' % h)
