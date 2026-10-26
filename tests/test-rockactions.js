/* Drop, delegate, move — getting a Big Rock off the list without ticking it.
 *
 * What would make it wrong: the ⋯ ticking the rock it sits in, a dropped rock
 * still counted anywhere, a delegated one lost (it must wait on Today until
 * done or taken back), an undo that does not undo, a swipe on a phone that
 * turns the page instead, or any of it gone after a reload. */
const submitAuth = require('./submit-auth.js');
const { chromium, devices } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  const setup = async () => p.evaluate(async () => {
    const now = new Date(), t = (now.getDay() + 6) % 7, w = weekId(now);
    cData.rocks[w] = [
      { id: 'm1', title: 'Send the venue contract', day: t, time: '10:00', prio: 'high', done: false },
      { id: 'm2', title: 'Book the photographer', day: t, prio: 'med', done: false },
      { id: 'm3', title: 'Old idea nobody needs', day: t, prio: 'low', done: false }
    ];
    cData.aside = [];
    cSave(); Flow.Nav.go('today'); renderToday();
    await new Promise((r) => setTimeout(r, 900));
    return { t, w };
  });
  const S = await setup();
  const where = (id) => p.evaluate((id) => { for (const w of Object.keys(cData.rocks)) { const r = (cData.rocks[w] || []).find((x) => x.id === id); if (r) return { w, day: r.day, done: !!r.done }; } const a = (cData.aside || []).find((x) => x.id === id); return a ? { aside: a.status, to: a.to || null, follow: a.follow || null } : null; }, id);

  console.log('\n— the ⋯ on a rock —');
  ok('every Big Rock on Today has one', await p.evaluate(() => [...document.querySelectorAll('#today-feed .td-rocks:not(#td-cal) .td-rock')].every((r) => r.querySelector('.ra-more'))));
  await p.click('#today-feed .td-rock[data-rockid="m2"] .ra-more'); await p.waitForTimeout(400);
  ok('it opens the sheet for that rock', await p.evaluate(() => document.getElementById('flow-ra').classList.contains('on') && /Book the photographer/.test(document.querySelector('#flow-ra h4').textContent)));
  ok('and does not tick it', (await where('m2')).done === false);

  console.log('\n— move —');
  await p.click('#flow-ra [data-ra="tomorrow"]'); await p.waitForTimeout(600);
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const exp = await p.evaluate((iso) => { const d = new Date(iso); return { w: weekId(d), day: (d.getDay() + 6) % 7 }; }, tm.toISOString());
  const m2 = await where('m2');
  ok('Tomorrow puts it on tomorrow, in the right week', m2 && m2.w === exp.w && m2.day === exp.day, { m2, exp });
  ok('Today now lists it as tomorrow\'s', await p.evaluate(() => { const r = document.querySelector('#today-feed .td-rock[data-rockid="m2"]'); return !r || /Tomorrow|Mon/.test(r.querySelector('.rk-meta').textContent); }));
  ok('with an undo', await p.evaluate(() => document.getElementById('ra-undo').classList.contains('on') && /Moved to Tomorrow/.test(document.getElementById('ra-undo').textContent)));
  await p.click('#ra-undo button'); await p.waitForTimeout(500);
  const back = await where('m2');
  ok('undo puts it back where it was', back && back.w === S.w && back.day === S.t, back);

  console.log('\n— drop —');
  const lineBefore = await p.evaluate(() => (document.querySelector('.lk-line') || {}).textContent || '');
  await p.click('#today-feed .td-rock[data-rockid="m3"] .ra-more'); await p.waitForTimeout(300);
  await p.click('#flow-ra [data-ra="drop"]'); await p.waitForTimeout(600);
  ok('a dropped rock leaves the week but is kept', JSON.stringify(await where('m3')) === JSON.stringify({ aside: 'dropped', to: null, follow: null }), await where('m3'));
  ok('and every count with it', await p.evaluate(() => { const L = window.FlowTodayLook; const k = L.heroPick(L.rocks(), (new Date().getDay() + 6) % 7); return k.open.length === 2 && !L.rocks().some((r) => r.id === 'm3'); }));
  await p.evaluate(() => Flow.Nav.go('compass')); await p.waitForTimeout(600);
  ok('the week shows it under Dropped, with Put back', await p.evaluate(() => { const b = document.getElementById('ra-week'); return !!b && /Dropped · 1/.test(b.textContent) && /Old idea nobody needs/.test(b.textContent) && /Put back/.test(b.textContent); }));
  ok('every rock chip in the week has a ⋯', await p.evaluate(() => [...document.querySelectorAll('#cGrid .chip.rock')].every((c) => c.querySelector('.ra-more'))));
  await p.click('#cGrid .chip.rock[data-rid="m1"] .ra-more'); await p.waitForTimeout(400);
  ok('the ⋯ on a chip opens the sheet and does not tick the chip', await p.evaluate(() => document.getElementById('flow-ra').classList.contains('on')) && (await where('m1')).done === false);
  await p.click('#flow-ra .fn-capture-close'); await p.waitForTimeout(300);
  await p.click('#ra-week [data-ra-back="m3"]'); await p.waitForTimeout(600);
  const m3 = await where('m3');
  ok('Put back returns it to its day', m3 && m3.w === S.w && m3.day === S.t && !m3.done, m3);

  console.log('\n— delegate —');
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(600);
  await p.click('#today-feed .td-rock[data-rockid="m1"] .ra-more'); await p.waitForTimeout(300);
  await p.click('#flow-ra [data-ra="delegate"]'); await p.waitForTimeout(300);
  await p.fill('#ra-who', 'Selin'); await p.click('#flow-ra [data-ra="f3"]');
  await p.click('#flow-ra .ra-del button[type=submit]'); await p.waitForTimeout(700);
  const m1 = await where('m1');
  const in3 = new Date(); in3.setDate(in3.getDate() + 3);
  ok('it is handed to Selin with a day to check back', m1 && m1.aside === 'delegated' && m1.to === 'Selin' && m1.follow === in3.toISOString().slice(0, 10) || (m1 && m1.follow && m1.follow.length === 10), m1);
  ok('it waits on Today under Waiting on', await p.evaluate(() => { const w = document.getElementById('flow-td-waiting'); return !!w && /Waiting on/.test(w.textContent) && /Send the venue contract/.test(w.textContent) && /Selin/.test(w.textContent); }));
  ok('and is not one of your Big Rocks any more', await p.evaluate(() => !document.querySelector('#today-feed .td-rock[data-rockid="m1"]')));
  await p.click('#flow-td-waiting [data-ra-done="m1"]'); await p.waitForTimeout(700);
  const m1b = await where('m1');
  ok('when Selin has done it, a tick counts it done in its week', m1b && m1b.w === S.w && m1b.done === true, m1b);
  ok('and Waiting on is gone', await p.evaluate(() => !document.getElementById('flow-td-waiting')));

  console.log('\n— it stays —');
  await p.evaluate(() => { const r = cData.rocks[weekId(new Date())].find((x) => x.id === 'm2'); r.done = false; cSave(); renderToday(); });
  await p.click('#today-feed .td-rock[data-rockid="m2"] .ra-more'); await p.waitForTimeout(300);
  await p.click('#flow-ra [data-ra="delegate"]'); await p.fill('#ra-who', 'Mert'); await p.click('#flow-ra .ra-del button[type=submit]'); await p.waitForTimeout(1500);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(5500);
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(1200);
  ok('after a reload the delegated rock is still waiting', await p.evaluate(() => { const w = document.getElementById('flow-td-waiting'); return !!w && /Mert/.test(w.textContent); }));
  await p.click('#flow-td-waiting [data-ra-back="m2"]'); await p.waitForTimeout(600);
  const m2b = await where('m2');
  ok('Take back makes it yours again, open', m2b && m2b.w && !m2b.done && m2b.aside === undefined, m2b);

  console.log('\n— Simple and the day panel —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); Flow.Nav.go('today'); }); await p.waitForTimeout(800);
  await p.click('.lk-day[data-lk-day="' + S.t + '"]'); await p.waitForTimeout(500);
  ok('rows in the day panel have the ⋯ too', await p.evaluate(() => document.querySelectorAll('.lk-dv-row .ra-more').length >= 3));
  await p.click('.lk-dv-row[data-rid="m3"] .ra-more'); await p.waitForTimeout(300);
  await p.click('#flow-ra [data-ra="drop"]'); await p.waitForTimeout(600);
  ok('dropping from it takes it out of the panel', await p.evaluate(() => !document.querySelector('.lk-dv-row[data-rid="m3"]')));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await p.close();

  console.log('\n— a phone —');
  const ctx = await b.newContext(Object.assign({}, devices['Pixel 7']));
  const q = await ctx.newPage();
  const qerr = []; q.on('pageerror', (e) => qerr.push(e.message));
  const cdp = await ctx.newCDPSession(q);
  await q.goto(H + '/', { waitUntil: 'load' }); await q.waitForTimeout(2500);
  await q.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await q.fill('#fa-pw', 'a properly long password');
  await submitAuth(q); await q.waitForTimeout(4500);
  await q.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); Flow.Nav.go('today'); }); await q.waitForTimeout(900);
  const row = await q.evaluate(() => { const r = document.querySelector('#today-feed .td-rocks:not(#td-cal) .td-rock:not(.done)'); r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { id: r.getAttribute('data-rockid'), x: b.x + b.width * 0.7, y: b.y + b.height / 2 }; });
  await q.waitForTimeout(300);
  const tabBefore = await q.evaluate(() => Flow.Nav.current());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: row.x, y: row.y }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: row.x - i * 16, y: row.y + 1 }] }); await q.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await q.waitForTimeout(600);
  ok('a swipe to the left on a rock opens its sheet', await q.evaluate(() => document.getElementById('flow-ra') && document.getElementById('flow-ra').classList.contains('on')));
  ok('and does not turn the page', await q.evaluate(() => Flow.Nav.current()) === tabBefore);
  await q.tap('#flow-ra [data-ra="nextweek"]'); await q.waitForTimeout(600);
  const nw = await q.evaluate((id) => { for (const w of Object.keys(cData.rocks)) if ((cData.rocks[w] || []).some((x) => x.id === id)) return w; return null; }, row.id);
  ok('Next week moves it to next week', nw && nw > (await q.evaluate(() => weekId(new Date()))), nw);
  ok('no page errors on the phone', qerr.length === 0, qerr.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
