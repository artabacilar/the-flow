/* Device reports — how a phone where nothing works can still say why.
 *
 * What would make it wrong: a report that never arrives from the device that
 * needs it (before sign-in, with the pack missing), one that carries what
 * somebody typed, anyone but the owner reading them, or a stranger filling
 * the log. */
const submitAuth = require('./submit-auth.js');
const { chromium, devices } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
(async () => {
  const b = await chromium.launch();
  console.log('\n— a phone where the pack never arrives —');
  const ctx = await b.newContext(Object.assign({}, devices['Pixel 7']));
  const p = await ctx.newPage();
  await p.route('**/flow-pack.js*', (r) => r.abort());
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  /* A layer that eats every tap, the way a stuck overlay would. */
  await p.evaluate(() => { const d = document.createElement('div'); d.id = 'eater'; d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;visibility:visible'; document.body.appendChild(d); window.addEventListener('click', (e) => { if (e.target === d) e.stopPropagation(); }, true); const i = document.createElement('input'); i.value = 'my secret diary line'; document.body.appendChild(i); });
  for (let i = 0; i < 4; i++) { await p.touchscreen.tap(100 + i * 40, 300); await p.waitForTimeout(1000); }
  const got = await p.evaluate(() => ({ taps: window.__flowDiag.taps.length, dead: window.__flowDiag.taps.filter((t) => !t.c).length }));
  ok('taps that bring no click are noticed', got.taps >= 3 && got.dead >= 3, got);
  await p.evaluate(() => window.__flowDiag.check()); await p.waitForTimeout(800);
  await ctx.close();

  console.log('\n— the owner reads them, nobody else —');
  const o = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await o.goto(H + '/', { waitUntil: 'load' }); await o.waitForTimeout(2500);
  await o.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await o.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await o.fill('#fa-name', 'Artur'); await o.fill('#fa-pw', 'a properly long password');
  await submitAuth(o); await o.waitForTimeout(3000);
  const rep = await o.evaluate(async () => (await fetch('/api/diag/client').then((r) => r.json())).reports);
  const r0 = rep && rep.find((r) => /Android/.test(r.ua));
  ok('leaving the sign-in screen is not a report', !rep.some((r) => r.who === 'owner' || /HeadlessChrome/.test(r.ua) && !/Android/.test(r.ua)), rep.map((r) => r.why + ' ' + r.who + ' ' + JSON.stringify(r.errs)));
  ok('the report arrived without anyone signed in', !!r0 && r0.who === null, r0);
  ok('it says the pack never came', r0 && r0.why === 'no-pack' && r0.flow === false, r0 && r0.why);
  ok('with the phone it came from', r0 && /Android/.test(r0.ua) && r0.w > 300, r0 && r0.ua);
  ok('and what was under the finger', r0 && r0.taps.length >= 3 && /#eater/.test(r0.taps[0].at) && r0.taps.every((t) => !t.c), r0 && r0.taps);
  ok('never what was typed', !JSON.stringify(rep).includes('secret diary'));
  const anon = await (await b.newPage()).request.get(H + '/api/diag/client');
  ok('a stranger cannot read them', anon.status() === 403, anon.status());
  const big = await o.request.post(H + '/api/diag/client', { data: 'x'.repeat(7000), headers: { 'Content-Type': 'application/json' } });
  ok('a large body is refused', big.status() === 413, big.status());
  let last = 0;
  for (let i = 0; i < 25; i++) last = (await o.request.post(H + '/api/diag/client', { data: { why: 'errors' } })).status();
  ok('and one address cannot flood the log', last === 429, last);
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
