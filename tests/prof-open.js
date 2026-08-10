/* How long until you can actually use the app?
 *
 * The complaint was "it opens slowly", so the number that matters is not
 * DOMContentLoaded — it is the moment navigation exists to be tapped, because
 * the pack's stylesheet hides the host's own bar the instant it parses. This
 * measures exactly that, against a replica seeded with a payload the size of
 * the real account. Run it once for the file on main and once for the build.
 */
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext();
  const p = await c.newPage();

  /* The replica answers instantly, which is exactly what Render and Upstash
     do not. Serial round-trips are free locally and expensive in production,
     so the whole cost of the fix would be invisible without this: add one
     round-trip's latency to every API call and the ordering starts to matter
     the way it does on the real thing. */
  const LAT = parseInt(process.env.LAT || '300', 10);
  await c.route('**/api/**', async (route) => {
    await new Promise((r) => setTimeout(r, LAT));
    route.continue();
  });

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  await p.click('#fa-alt').catch(() => {});
  await p.waitForTimeout(250);
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL || 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await p.fill('#fa-inv', 'letmein').catch(() => {});
  await Promise.all([p.waitForNavigation({ timeout: 20000 }).catch(() => {}), p.click('#fa-go')]);
  await p.waitForTimeout(5000);

  /* Now the interesting part: a cold-ish open with the account already there. */
  const runs = [];
  for (let i = 0; i < 3; i++) {
    await p.goto(H + '/', { waitUntil: 'commit' });
    const t = await p.evaluate(() => new Promise((res) => {
      const t0 = performance.now();
      const done = (what) => res({ what, ms: Math.round(performance.now() - t0) });
      const tick = () => {
        const nav = document.getElementById('flow-side') || document.getElementById('flow-tabbar');
        if (nav && nav.getClientRects().length) return done('navigation');
        if (performance.now() - t0 > 30000) return done('gave up');
        requestAnimationFrame(tick);
      };
      tick();
    }));
    runs.push(t.ms);
  }
  runs.sort((x, y) => x - y);
  console.log(JSON.stringify({ label: process.env.LABEL || '?', runs, median: runs[1] }));
  await b.close();
})();
