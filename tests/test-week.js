/* The weekly loop: the Sunday session, overdue rocks fixed on Today, and
 * sections taken out of the menu. Driven in a real browser against a real
 * server, with the one paid call (the suggestion) answered by the test, and
 * the clock set to a Sunday so the invitation shows.
 *
 * What matters most: nothing is added that was not ticked, the record of
 * last week is not rewritten by carrying things forward, and a moved rock
 * is moved — not copied.
 */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
    : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 260) : ''))); };

  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  /* Sunday 25 October 2026, 18:00 local. */
  await ctx.addInitScript(() => {
    const fixed = new Date(2026, 9, 25, 18, 0, 0).getTime();
    const RealDate = Date;
    const off = fixed - RealDate.now();
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); }
      static now() { return RealDate.now() + off; }
    }
    window.Date = FakeDate;
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let planReq = null;
  await p.route('**/api/flow/plan-week', async (route) => {
    planReq = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true,
      focus: 'Close the supplier deal and get back to training.',
      rocks: [
        { title: 'Supplier call prep', role: '', day: 'tue', time: '10:00', why: 'Last week it slipped.' },
        { title: 'Three gym sessions', role: '', day: 'wed', time: '', why: 'Training was 0 of 4.' },
        { title: 'Unwanted one', role: '', day: 'fri', time: '', why: 'x' }
      ] }) });
  });

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.waitForTimeout(250);
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p);
  await p.waitForTimeout(4200);

  /* Last week (19–25 Oct): three rocks, one done. Wednesday's is overdue. */
  const lastW = await p.evaluate(() => {
    const wid = weekId(new Date(2026, 9, 21));
    /* A new account starts with a few example rocks; this test wants its own. */
    Object.keys(cData.rocks || {}).forEach(k => { delete cData.rocks[k]; });
    addRock('Send samples', cData.roles[0], 2, '09:00', wid, { note: 'n' });
    addRock('Call accountant', cData.roles[0], 3, '', wid, {});
    addRock('Finished thing', cData.roles[0], 1, '', wid, {});
    cData.rocks[wid].find(r => r.title === 'Finished thing').done = true;
    cSave();
    return wid;
  });
  const nextW = await p.evaluate(() => weekId(new Date(2026, 9, 27)));
  await p.click('[data-fn-side="today"]').catch(() => {});
  await p.waitForTimeout(800);

  console.log('\n— the invitation —');
  ok('on a Sunday with next week empty, Today offers to plan it', await p.isVisible('#td-weekplan [data-weekplan]'));
  await p.click('#td-weekplan [data-weekplan]');
  await p.waitForTimeout(400);
  ok('the session opens', await p.isVisible('#wp-modal.on'));

  console.log('\n— 1 · last week, honestly —');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/wp-score.png' });
  const txt = await p.textContent('#wp-modal .wp-body');
  ok('it shows planned against done: 1 / 3', /1 \/ 3/.test(txt) && /33%/.test(txt), txt.slice(0, 300));
  ok('it says what each number is out of', /Days you wrote something/.test(txt));

  await p.click('[data-wp="next"]'); await p.waitForTimeout(200);
  console.log('\n— 2 · looking back —');
  await p.fill('[data-refl="well"]', 'Closed the Guangzhou dates');
  await p.fill('[data-refl="blocked"]', 'Travel');
  await p.click('[data-wp="next"]'); await p.waitForTimeout(200);
  const review = await p.evaluate((w) => cData.reviews && cData.reviews[w], lastW);
  ok('the reflection is saved as last week\'s review', /Closed the Guangzhou dates/.test(review || '') && /Travel/.test(review || ''), review);

  console.log('\n— 3 · carrying over —');
  const items = await p.$$eval('[data-carry]', els => els.length);
  ok('only the two unfinished rocks are offered', items === 2, items);
  /* untick "Call accountant" */
  await p.evaluate(() => { const el = [...document.querySelectorAll('[data-carry]')].find(i => i.closest('label').textContent.includes('Call accountant')); el.click(); });
  await p.click('[data-wp="next"]'); await p.waitForTimeout(300);
  const after = await p.evaluate(([a, n]) => ({ last: cData.rocks[a].map(r => [r.title, !!r.done, r.carried || null]), next: (cData.rocks[n] || []).map(r => [r.title, r.day, r.time]) }), [lastW, nextW]);
  ok('the ticked one is on next week, same weekday and time', after.next.length === 1 && after.next[0][0] === 'Send samples' && after.next[0][1] === 2 && after.next[0][2] === '09:00', after);
  ok('last week still shows it unfinished — the record is not rewritten', after.last.find(r => r[0] === 'Send samples')[1] === false && after.last.length === 3, after.last);
  ok('the unticked one is left where it was', !after.next.some(r => r[0] === 'Call accountant'));
  await p.click('[data-wp="back"]'); await p.waitForTimeout(200);
  await p.click('[data-wp="next"]'); await p.waitForTimeout(300);
  ok('going back and forward again does not carry twice', (await p.evaluate((n) => cData.rocks[n].length, nextW)) === 1);

  console.log('\n— 4 · the suggestion —');
  await p.click('[data-wp="suggest"]'); await p.waitForTimeout(600);
  ok('it sent last week\'s numbers, the reflection and what was carried', planReq && planReq.week === nextW && planReq.scorecard.rocks.planned === 3 &&
     planReq.reflection.well === 'Closed the Guangzhou dates' && planReq.carried.length === 1, planReq && { w: planReq.week, c: planReq.carried });
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/wp-plan.png' });
  ok('three suggestions, with the why', (await p.$$eval('.wp-rock', els => els.length)) === 3 && /Training was 0 of 4/.test(await p.textContent('#wp-modal')));
  ok('nothing is on the week until it is ticked and added', (await p.evaluate((n) => cData.rocks[n].length, nextW)) === 1);
  await p.uncheck('[data-pick="2"]');
  await p.fill('[data-rt="0"]', 'Supplier call prep — pricing');
  await p.click('[data-wp="add"]'); await p.waitForTimeout(500);
  const added = await p.evaluate((n) => cData.rocks[n].map(r => [r.title, r.day, r.time]), nextW);
  ok('the two ticked ones are added, as edited, on their days', added.length === 3 && added.some(r => r[0] === 'Supplier call prep — pricing' && r[1] === 1 && r[2] === '10:00') &&
     added.some(r => r[0] === 'Three gym sessions' && r[1] === 2), added);
  ok('the unticked one is not', !added.some(r => r[0] === 'Unwanted one'));
  ok('the week\'s focus line is set from the plan', await p.evaluate((n) => (cData.plans || {})[n], nextW) === 'Close the supplier deal and get back to training.');
  ok('the last step says what happened', /1 carried over, 2 new Big Rocks/.test(await p.textContent('#wp-modal')));
  await p.click('[data-wp="close"]');

  console.log('\n— the invitation goes away once the week is planned —');
  await p.evaluate(() => { try { renderToday(); } catch (e) {} });
  await p.waitForTimeout(300);
  ok('Today no longer asks', !(await p.isVisible('#td-weekplan')));

  console.log('\n— overdue rocks, fixed on Today —');
  const thisW = await p.evaluate(() => weekId(new Date()));
  await p.evaluate((w) => { addRock('Overdue thing', cData.roles[0], 2, '', w, {}); try { renderToday(); } catch (e) {} }, thisW);
  await p.waitForTimeout(500);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/wp-today.png' });
  const fix = await p.$('.td-rock[data-rockid] .td-fix');
  ok('an overdue rock gets Today / Tomorrow / Done', !!fix && /Today.*Tomorrow.*Done/.test(await fix.textContent()));
  await p.evaluate(() => { const row = [...document.querySelectorAll('.td-rock[data-rockid]')].find(r => r.textContent.includes('Overdue thing')); row.querySelector('[data-fix="tomorrow"]').click(); });
  await p.waitForTimeout(400);
  const moved = await p.evaluate(([w, n]) => ({ inThis: cData.rocks[w] ? cData.rocks[w].filter(r => r.title === 'Overdue thing').length : 0,
    inNext: cData.rocks[n].filter(r => r.title === 'Overdue thing').map(r => r.day) }), [thisW, nextW]);
  ok('"Tomorrow" on a Sunday moves it to Monday of next week — moved, not copied', moved.inThis === 0 && moved.inNext.length === 1 && moved.inNext[0] === 0, moved);

  console.log('\n— sections —');
  await p.click('[data-fn-side="settings"]'); await p.waitForTimeout(1200);
  ok('Settings has a Sections card', await p.isVisible('#secCard'));
  ok('Today and Settings cannot be hidden', !(await p.$('#secCard [data-sec="today"]')) && !(await p.$('#secCard [data-sec="settings"]')));
  await p.uncheck('#secCard [data-sec="finance"]'); await p.waitForTimeout(400);
  ok('unticking hides it from the menu', !(await p.isVisible('[data-fn-side="finance"]')));
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => document.documentElement.classList.contains('flow-ready'), null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  ok('and stays hidden after a reload', !(await p.isVisible('[data-fn-side="finance"]')));
  await p.click('[data-fn-side="settings"]'); await p.waitForSelector('#secCard [data-sec="finance"]', { timeout: 8000 });
  await p.check('#secCard [data-sec="finance"]'); await p.waitForTimeout(400);
  ok('ticking brings it back', await p.isVisible('[data-fn-side="finance"]'));

  console.log('\n— the Week Compass —');
  await p.click('[data-fn-side="compass"]'); await p.waitForTimeout(900);
  ok('it shows this week so far and the Plan button', await p.isVisible('#wp-compass [data-weekplan]'));

  console.log('\n— the trial: feedback —');
  /* Feedback has its own view, opened from the avatar menu. */
  await p.evaluate(() => Flow.SetView.open('help'));
  ok('the owner sees the trial view', !!(await p.waitForSelector('#fbOwner', { timeout: 8000 }).catch(() => null)));
  const c2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const q = await c2.newPage();
  await q.goto(H + '/', { waitUntil: 'load' }); await q.waitForTimeout(2500);
  await q.click('#fa-alt', { timeout: 2500 }).catch(() => {}); await q.waitForTimeout(250);
  await q.fill('#fa-email', 'friend@example.com'); await q.fill('#fa-name', 'Deniz');
  await q.fill('#fa-pw', 'a properly long password');
  await q.fill('#fa-inv', 'letmein').catch(() => {});
  await submitAuth(q); await q.waitForTimeout(4200);
  await q.evaluate(() => Flow.SetView.open('help'));
  ok('a trial user gets the feedback box', !!(await q.waitForSelector('#fbText', { timeout: 8000 }).catch(() => null)));
  ok('but not the owner\'s view', !(await q.$('#fbOwner')));
  await q.fill('#fbText', 'The Sunday thing is great, but where do I see last month?');
  await q.click('#fbSend'); await q.waitForTimeout(600);
  ok('sending says so', /thank you/.test(await q.textContent('#fbOut')));
  const peek = await q.evaluate(async () => (await fetch('/api/feedback', { credentials: 'same-origin' })).status);
  ok('a trial user cannot read anybody\'s notes', peek === 403, peek);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => document.documentElement.classList.contains('flow-ready'), null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => Flow.SetView.open('help')); await p.waitForSelector('#fbOwner h4', { timeout: 8000 });
  const ov = await p.textContent('#fbOwner');
  ok('the owner sees who joined and what they wrote', /1 of \d+ places used/.test(ov) && /Deniz/.test(ov) && /where do I see last month/.test(ov), ov.slice(0, 200));
  await c2.close();

  console.log('\n— reading the suggestion (server) —');
  const X = require('../flow-extras.js')._internals;
  const pp = X.parsePlan('Sure! {"focus":"F","rocks":[{"title":"A","role":"Work","day":"Wednesday","time":"7:30","why":"w"},{"title":"B","role":"Made up","day":"someday","time":"25:00"},{"title":""}]} hope that helps', ['Work']);
  ok('JSON is found inside whatever wraps it', pp && pp.focus === 'F' && pp.rocks.length === 2);
  ok('days, times and roles are made safe', pp.rocks[0].day === 'wed' && pp.rocks[0].time === '07:30' && pp.rocks[0].role === 'Work' &&
     pp.rocks[1].day === 'mon' && pp.rocks[1].time === '' && pp.rocks[1].role === '');
  ok('no list, no plan', X.parsePlan('I cannot help with that.', []) === null);
  ok('the prompt asks for few rocks and a Q2 one, and JSON only', /3 to 7 Big Rocks/.test(X.PLAN_SYSTEM) && /Q2/.test(X.PLAN_SYSTEM) && /JSON only/.test(X.PLAN_SYSTEM));

  ok('no page errors anywhere', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
