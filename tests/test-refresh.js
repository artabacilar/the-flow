/* =========================================================================
 * Coming back to a tab that has been open a while.
 *
 * The app loads its data once and then has no way of hearing that anything
 * changed. A Big Rock added from Claude, a WHOOP sync, an edit made on the
 * phone, a second tab — none of it reaches a window that is already open, and
 * the only cure was knowing to press reload. Somebody watching their own week
 * not update reasonably concludes the thing that wrote it did not work.
 *
 * There was already a re-check wired to the tab coming back. Its guard was
 * `!window.__DB_ON` — re-check only while the connection is DOWN, which is
 * exactly the case where there is nothing new to fetch.
 *
 * The risk in inverting it
 * -----------------------
 * A sync that runs more often is a sync that can clobber more often. What
 * makes it safe is already in reconcile(): anything written locally and not
 * yet sent up is marked dirty and wins over the server's copy, and whatever
 * does get replaced is kept under bak2_ for a generation. The second half of
 * this file is about those two properties, because they are what stands
 * between "the app keeps up" and "the app eats what you just wrote".
 * ====================================================================== */

const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 240) : '')); }
  };

  const c = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  /* Count what the page asks the server for, so "did it re-check" is a fact
     rather than an inference from the screen. */
  let manifests = 0;
  p.on('request', (r) => { if (r.url().indexOf('/manifest') >= 0) manifests++; });

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);

  console.log('\n— signing in —');
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p);
  await p.waitForTimeout(3500);
  ok('signed in', await p.evaluate(() => !document.getElementById('flow-auth')));
  ok('and the app is mirroring writes upward', await p.evaluate(() => window.__DB_ON === true));

  /* Stand in for "something else changed this account". Writing straight to
     the server is exactly what Claude, the phone and the second tab all do —
     this window is not told, and that is the whole problem. */
  const writeElsewhere = (key, value) => p.evaluate(async ([k, v]) => {
    await fetch('/api/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ key: k, value: v })
    });
  }, [key, value]);

  const habitsWith = (name) => JSON.stringify({
    habits: [{ id: 'h1', name: name, target: 5 }], completions: {}
  });

  /* ------------------------------------------------------------------ *
   * The bug
   * ------------------------------------------------------------------ */
  console.log('\n— a change made somewhere else —');

  await p.evaluate((v) => localStorage.setItem('ld_habits', v), habitsWith('Before'));
  await writeElsewhere('ld_habits', habitsWith('Added from Claude'));

  ok('the open tab has not noticed, because nothing told it',
    await p.evaluate(() => (localStorage.getItem('ld_habits') || '')).then(v => /Before/.test(v)));

  /* Now bring the tab back. The real event fires on document and bubbles up to
     the window listener; a hand-made one does not bubble unless told to, and a
     test that forgets is testing nothing. */
  const before = manifests;
  await p.evaluate(() => {
    window.__FLOW_SYNC_GAP_MS = 1;           /* do not make the test wait twenty seconds */
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  await p.waitForTimeout(3000);

  ok('bringing it back asks the server what changed', manifests > before, { before, after: manifests });
  /* Finding a difference means a repaint, and the app's way of repainting is a
     reload. So settle first, then look. */
  await p.waitForLoadState('load').catch(() => {});
  await p.waitForTimeout(2000);
  ok('and the change is now on the device',
    await p.evaluate(() => (localStorage.getItem('ld_habits') || '')).then(v => /Added from Claude/.test(v)));

  /* ------------------------------------------------------------------ *
   * Not asking twelve times a minute
   * ------------------------------------------------------------------ */
  console.log('\n— but not on every flick between two tabs —');

  await p.waitForTimeout(1500);
  const quiet = manifests;
  await p.evaluate(() => {
    window.__FLOW_SYNC_GAP_MS = 60000;       /* the real guard, exercised */
    for (let i = 0; i < 5; i++) document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus'));
  });
  await p.waitForTimeout(1200);
  ok('ten returns inside the window cost nothing', manifests === quiet, { quiet, now: manifests });

  ok('while pressing the sync badge still works regardless', await p.evaluate(async () => {
    const before = performance.now();
    window.__flowSyncNow();
    return typeof window.__flowSyncNow === 'function' && before >= 0;
  }));
  await p.waitForTimeout(1500);
  ok('and that did reach the server', manifests > quiet, { quiet, now: manifests });

  /* ------------------------------------------------------------------ *
   * The half that must not go wrong
   * ------------------------------------------------------------------ */
  console.log('\n— what you wrote and have not sent up yet wins —');

  ok('a local edit the server has not seen survives the sync', await p.evaluate(async () => {
    /* Exactly the state a person is in after typing while the connection
       dropped: written here, marked dirty, not yet upstairs. */
    const mine = JSON.stringify({ habits: [{ id: 'h1', name: 'Mine, unsent', target: 5 }], completions: {} });
    localStorage.setItem('ld_habits', mine);
    window.__DB_ON = false;
    try { window.__flowDirtyMark ? window.__flowDirtyMark('ld_habits') : null; } catch (e) {}
    /* dirtyMark is internal; reproduce its record so the test does not depend
       on a private name staying exported. */
    try {
      const d = JSON.parse(localStorage.getItem('ld__dirty') || '{}');
      d['ld_habits'] = Date.now();
      localStorage.setItem('ld__dirty', JSON.stringify(d));
    } catch (e) {}

    window.__flowSyncNow();
    await new Promise(r => setTimeout(r, 2500));
    return localStorage.getItem('ld_habits');
  }).then(v => /Mine, unsent/.test(v || '')));

  ok('and it was pushed up rather than thrown away', await p.evaluate(async () => {
    const r = await fetch('/api/get?key=ld_habits', { cache: 'no-store' });
    const j = await r.json();
    return String(j && j.value || '');
  }).then(v => /Mine, unsent/.test(v)));

  console.log('\n— and nothing it replaces is unrecoverable —');
  /* Split across the reload: ask for the change, let the page come back, then
     look. Doing it inside one evaluate races the navigation and the context
     is torn down mid-sentence. */
  await p.evaluate(async () => {
    await fetch('/api/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ key: 'ld_habits',
        value: JSON.stringify({ habits: [{ id: 'h1', name: 'Server wins now', target: 5 }], completions: {} }) })
    });
  });
  await p.evaluate(() => { window.__FLOW_SYNC_GAP_MS = 1; window.__flowSyncNow(); }).catch(() => {});
  await p.waitForTimeout(3000);
  await p.waitForLoadState('load').catch(() => {});
  ok('the previous copy is kept aside for a generation',
    await p.evaluate(() => (localStorage.getItem('bak2_ld_habits') || '')).catch(() => '').then(v => v.length > 0));
  ok('and the server\'s version is what the app now holds',
    await p.evaluate(() => (localStorage.getItem('ld_habits') || '')).catch(() => '').then(v => /Server wins now/.test(v)));

  /* ------------------------------------------------------------------ *
   * Not mid-sentence
   * ------------------------------------------------------------------ */
  console.log('\n— and it does not reload while somebody is writing —');

  /* Observed by whether the page actually navigated, rather than by stubbing
     location.reload — which Chromium will not let anyone redefine. A value put
     on window survives everything except a reload, which makes it exactly the
     right witness. */
  await p.evaluate(() => {
    window.__probeAlive = true;
    const ta = document.createElement('textarea');
    ta.id = 'probe-write';
    ta.style.cssText = 'position:fixed;left:20px;top:200px;width:300px;height:100px;z-index:9999';
    document.body.appendChild(ta);
    ta.focus();
    ta.value = 'half a sentence';
  });
  ok('the cursor is in the field', await p.evaluate(() => document.activeElement.id === 'probe-write'));

  /* Something changed elsewhere, and the sync is about to want a repaint. */
  await p.evaluate(async () => {
    await fetch('/api/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ key: 'ld_habits',
        value: JSON.stringify({ habits: [{ id: 'h1', name: 'Changed while typing', target: 5 }], completions: {} }) })
    });
    window.__FLOW_SYNC_GAP_MS = 1;
    window.__flowSyncNow();
  });
  await p.waitForTimeout(3000);

  ok('it does not reload while somebody is writing',
    await p.evaluate(() => window.__probeAlive === true).catch(() => false));

  await p.evaluate(() => { const t = document.getElementById('probe-write'); if (t) t.blur(); }).catch(() => {});
  /* Long enough to cover the loop-guard window as well as the blur itself —
     a reload that arrives too soon after the previous one waits it out. */
  await p.waitForTimeout(6000);
  await p.waitForLoadState('load').catch(() => {});

  ok('and does it the moment they leave the field',
    await p.evaluate(() => window.__probeAlive === undefined).catch(() => true));
  ok('and the change is there when it comes back',
    await p.evaluate(() => (localStorage.getItem('ld_habits') || '')).catch(() => '')
      .then(v => /Changed while typing/.test(v)));

  ok('no page errors at any point', errs.length === 0, errs.slice(0, 4));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
