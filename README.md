# The Flow

A personal life dashboard. One Node server, one HTML application, Redis behind
it. It runs at https://the-flow-noq1.onrender.com and it is not a product —
it is one person's system, kept small enough to understand in an afternoon.

## What is here

`life-os-server.js` is the server. It serves the app, holds the API, and talks
to Upstash Redis. `life-dashboard.html` is the client's markup and its original
behaviour. `flow-pack.js` and `flow-pack.css` are the upgrade pack — navigation,
capture, the command palette, the charts, sharing, the assistant.

The pack is worth understanding before changing anything. It is one IIFE that
runs after the host application has defined itself, and it never rewrites the
host's markup — it decorates at runtime. Every piece of navigation it adds ends
up calling `.tab[data-tab="X"].click()`, the host's own primitive, so the host's
per-section render callbacks fire exactly as they always did. That constraint is
what has kept two quite different codebases inside one file from fighting.

The pack used to be pasted inside `life-dashboard.html`. Splitting it out means
a navigation change is a diff you can read rather than a half-megabyte blob, and
means the 307KB of pack is fetched once instead of on every open: the page asks
for it by content hash and the server serves it immutable, so a repeat open
pulls 218KB over the wire instead of 531KB.

The hash is computed by the server from the files themselves, not written into
the HTML. Change `flow-pack.js` alone and the URL in the page changes with it.
There is deliberately no second place to remember to edit, because the failure
that would cause — a browser holding a year-old pack against a new shell — looks
like the app randomly reverting and is close to impossible to diagnose from the
outside.

`src/` holds the pack's modules as separate, readable files, and the scripts
that produced this version. `tests/` holds the suites.
`.github/workflows/ci.yml` runs them.

## Running it

```
npm install
npm start                 # http://localhost:4000
```

The server needs `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to use
Redis; without them it falls back to a JSON file on disk, which is fine locally.
`FLOW_OWNER_EMAIL` decides which account owns the pre-accounts data, and
`FLOW_INVITE_CODE` gates everyone else.

## Testing

```
npm test                  # all 16 suites, ~420 checks
node tests/run.js nav     # one suite
```

Each suite gets its own replica of the server on port 4222, started fresh,
because the owner account can only be created once and a server that survives
into the next suite makes the next signup fail in a way that looks like a
product bug and isn't one. The replica mimics the parts of production that have
actually caused problems — in particular `all()` behaves like Upstash's
`KEYS ld_*`, which is why every key is namespaced `ld_u<uid>:<key>` and why a
key that escapes that pattern silently disappears from the listing.

The tests drive a real Chromium through Playwright and assert on what is on the
screen, not on internal state. They are slow — three or four minutes for the
lot — and that is the correct trade for a codebase where the failure mode is
"a section four screens away stopped rendering".

## Measuring how fast it opens

```
npm run profile          # time until there is navigation to tap
npm run bytes            # what a repeat open actually pulls over the wire
```

This reports time-to-navigation rather than DOMContentLoaded, because the pack's
stylesheet hides the host's own bar as soon as it parses: until the pack has
installed its navigation there is nothing to tap, whatever the page-load events
say. It adds latency to every API call by default, since the replica answers
instantly and production does not — without that, the cost of a serial
round-trip is invisible locally and obvious to whoever is using the app.

## Known and deliberate

The synchronous `XMLHttpRequest` near the top of `life-dashboard.html` blocks
parsing until the whole store has downloaded. It is slow and it is not an
oversight: everything after it reads `localStorage` synchronously at module
scope, so making it asynchronous means deferring the entire application's
initialisation. Worth doing, not worth doing carelessly.

Nothing here is minified. The pack is 307KB of readable JavaScript and CSS with
its comments intact, and since it is now fetched once and cached for a year, the
cost of that is paid once per version rather than per open. Readability is worth
more here than the bytes.
