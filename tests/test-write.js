/* A write is written down before it is sent, not only when one comes back broken.
 *
 * The app told the person "✓ saved" the instant the DEVICE copy succeeded —
 * before the server had been asked, and whatever it went on to answer. And a
 * write was recorded as pending only inside the request's .catch(). So the
 * whole guarantee rested on that handler running. A request still in flight
 * when the tab is closed, the phone reclaims the app, or the browser is quit
 * has no handler left to run: nothing was written down, the section looked
 * clean to the next open, and a reconcile that found the server's signature
 * had moved pulled the server's OLDER bytes down over the edit.
 *
 * That is not hypothetical. Four edits to the Priorities screen came back as
 * the old placeholders on the next load of a live account, with the header
 * reading "saved" throughout, and the overwritten copy left in bak2_ld_quad.
 *
 * Be straight about what is and is not proved here. The end-to-end loss needs
 * that .catch() to NOT run, and neither a reload nor closing the page reliably
 * denies it inside a driven browser — the rejection still lands and the old
 * code rescues itself. What these checks pin down instead is the invariant
 * that makes the handler stop mattering: the queue is written BEFORE the
 * request, cleared only by an acknowledgement, and only by the newest write's
 * acknowledgement. Three of them fail on the old order and pass on the new;
 * the rest hold the recovery path still while that changes.
 */
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

  const EMAIL = 'artur.abacilar@abko.com.tr';
  const PW = 'a properly long password';

  async function signedIn(ctx) {
    const p = await ctx.newPage();
    await p.goto(H + '/', { waitUntil: 'load' });
    await p.waitForTimeout(2600);
    if (await p.$('#fa-email')) {
      await p.fill('#fa-email', EMAIL);
      /* A second browser signing IN to an existing account still has the
         name field in the DOM, just hidden. Filling it would hang. */
      const nameBox = await p.$('#fa-name');
      if (nameBox && await nameBox.isVisible()) await p.fill('#fa-name', 'Artur');
      await p.fill('#fa-pw', PW);
      await submitAuth(p);
      await p.waitForTimeout(4200);
    }
    return p;
  }

  const c1 = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  let p = await signedIn(c1);
  ok('signed in', await p.evaluate(() => !document.getElementById('flow-auth')));

  console.log('\n— a write is written down before it is sent, not after it fails —');
  /* Hold every /api/set open. Nothing errors, nothing resolves — the shape of
     a request that is still travelling when the tab closes. */
  let holding = true;
  const hang = route => { if (holding) { /* never settles */ } else route.continue(); };

  const MARK = 'Interrupted write marker 4RT';
  /* The account has to hold a copy this device's signature map does not know
     about — the ordinary two-device situation, and the one the real loss
     happened in: the phone had written Priorities the laptop had never seen.
     Sent straight past dbSet on purpose, so the device's recorded signature
     for this section goes stale exactly the way it does in life. */
  await p.evaluate(async () => {
    await fetch('/api/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ key: 'ld_quad', value: JSON.stringify({ items: [{ id: 'q0', q: 1, txt: 'the copy the account already had', done: false }] }) })
    });
  });

  /* Only /api/set is held. The reconcile's own push goes through /api/bulk and
     must stay open — recovering through it is the behaviour being proved. */
  await p.route('**/api/set', hang);
  await p.evaluate((mark) => {
    const v = JSON.stringify({ items: [{ id: 'q9', q: 1, txt: mark, done: false }] });
    localStorage.setItem('ld_quad', v);
    window.dbSet('ld_quad', v);
  }, MARK);
  await p.waitForTimeout(600);

  ok('the section is queued while the request is still in the air',
    await p.evaluate(() => !!JSON.parse(localStorage.getItem('ld__dirty') || '{}').ld_quad),
    await p.evaluate(() => localStorage.getItem('ld__dirty')));

  console.log('\n— and the person is not told it is safe while it is not —');
  ok('the indicator does not claim "saved" with a write still pending',
    await p.evaluate(() => {
      const el = document.getElementById('saveInd') || document.getElementById('saveInd2');
      return !!el && !/saved/.test(el.textContent);
    }),
    await p.evaluate(() => (document.getElementById('saveInd') || {}).textContent));

  console.log('\n— the edit survives the page going away under it —');
  /* The tab is CLOSED, not reloaded. A reload is too gentle: the aborted
     request still rejects, the old .catch() still runs, and the write is
     rescued by the very handler whose absence is the bug. Closing the page
     destroys the JavaScript context outright — the rejection has nowhere to
     land and nothing can be written down after the fact. That is a person
     swiping the app away, the phone killing it for memory, or the browser
     being quit, and it is the case the old order had no answer for.
     localStorage belongs to the context, not the page, so it survives. */
  await p.close();
  p = await c1.newPage();
  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(6000);
  ok('the reconcile does not pull the server\u2019s older copy down over it',
    (await p.evaluate(() => localStorage.getItem('ld_quad') || '')).includes(MARK),
    await p.evaluate(() => ({
      now: (localStorage.getItem('ld_quad') || '').slice(0, 120),
      shunted: (localStorage.getItem('bak2_ld_quad') || '').slice(0, 120)
    })));

  console.log('\n— and it reaches the server on its own —');
  holding = false;
  await p.unroute('**/api/set');
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(5000);
  ok('the queue drains once the writes can land',
    await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ld__dirty') || '{}')).length === 0),
    await p.evaluate(() => localStorage.getItem('ld__dirty')));
  ok('and the indicator says saved again',
    await p.evaluate(() => {
      const el = document.getElementById('saveInd') || document.getElementById('saveInd2');
      return !!el && /saved/.test(el.textContent);
    }));

  console.log('\n— which is the only proof that counts: another browser sees it —');
  const c2 = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  const p2 = await signedIn(c2);
  await p2.waitForTimeout(3000);
  ok('a device that has never held this account gets the edit, not the old copy',
    (await p2.evaluate(() => localStorage.getItem('ld_quad') || '')).includes(MARK),
    await p2.evaluate(() => (localStorage.getItem('ld_quad') || '').slice(0, 160)));

  console.log('\n— an older answer does not clear a newer edit —');
  /* Two writes to one section, the FIRST answered first. If the flag is dropped
     by whichever reply arrives, the second edit is left looking synced while it
     is still in the air — the original bug, one layer down. */
  ok('the queue waits for the newest write, not the first answer',
    await p.evaluate(async () => {
      let n = 0;
      const real = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/set') >= 0) {
          n++;
          const d = n === 1 ? 0 : 1400;      /* first fast, second slow */
          return new Promise(r => setTimeout(() => r(real(u, o)), d));
        }
        return real(u, o);
      };
      const q = () => !!JSON.parse(localStorage.getItem('ld__dirty') || '{}').ld_quad;
      window.dbSet('ld_quad', JSON.stringify({ items: [{ id: 'q9', q: 1, txt: 'first', done: false }] }));
      await new Promise(r => setTimeout(r, 60));
      window.dbSet('ld_quad', JSON.stringify({ items: [{ id: 'q9', q: 1, txt: 'second', done: false }] }));
      await new Promise(r => setTimeout(r, 700));   /* first has answered, second has not */
      const heldOpen = q();
      await new Promise(r => setTimeout(r, 1600));  /* now the second lands */
      const cleared = !q();
      window.fetch = real;
      return heldOpen && cleared;
    }));

  await b.close();
  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
