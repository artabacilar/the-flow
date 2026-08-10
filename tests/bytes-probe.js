/* What does a *repeat* open actually pull over the wire? That is the number the
   split is meant to move: the pack is content-addressed and immutable, so on
   every open after the first it should come from cache and not the network. */
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext();
  const p = await c.newPage();

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.click('#fa-alt').catch(() => {});
  await p.waitForTimeout(250);
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await p.fill('#fa-inv', 'letmein').catch(() => {});
  await Promise.all([p.waitForNavigation({ timeout: 20000 }).catch(() => {}), p.click('#fa-go')]);
  await p.waitForTimeout(4000);

  /* First open primes the cache; the one after it is the one people live in. */
  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  /* transferSize is the number that matters: it is what actually crossed the
     network. A cache hit reports 0 (or just the headers), a real fetch reports
     the body. Counting response events instead would count both the same. */
  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const res = await p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const rows = [['/', nav ? Math.round(nav.transferSize) : -1, nav ? Math.round(nav.decodedBodySize) : -1]];
    for (const e of performance.getEntriesByType('resource')) {
      const u = new URL(e.name).pathname;
      if (u.startsWith('/api')) continue;
      rows.push([u, Math.round(e.transferSize), Math.round(e.decodedBodySize)]);
    }
    return rows;
  });
  const wire = res.reduce((n, r) => n + Math.max(0, r[1]), 0);
  const total = res.reduce((n, r) => n + Math.max(0, r[2]), 0);
  console.log(JSON.stringify({ overTheWire: wire, contentSize: total, rows: res }));
  await b.close();
})();
