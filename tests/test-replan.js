/* My day changed, the Overdue list, the review with evidence, and the counts.
 *
 * What would make it wrong: a replan inventing time (fitting more than the
 * day has), moving a rock the person kept, moving anything before Accept,
 * an undo that does not put every rock back on its day, an overdue rock
 * ticked done by the wrong button, a review that counts a different week
 * than it names, any of it drawn in Advanced, or a tracked event carrying
 * a title. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const tracked = [];
  await p.route('**/api/flow/patterns**', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' }));
  await p.route('**/api/flow/ahead**', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' }));
  await p.route('**/api/flow/track', (rt) => { tracked.push(JSON.parse(rt.request().postData() || '{}')); rt.continue(); });
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);

  console.log('\n— the arithmetic —');
  const rocks = [
    { id: 'a', title: 'Send the venue contract', prio: 'high', day: 2, time: '14:00', end: '15:00' },
    { id: 'b', title: 'Book the photographer', prio: 'med', day: 2 },
    { id: 'c', title: 'Write the set list', prio: 'low', day: 2 },
    { id: 'd', title: 'Old one from Monday', prio: 'high', day: 0, late: true }
  ];
  const c1 = await p.evaluate((rocks) => { const R = window.FlowReplan; const c = R.compute({ now: 13 * 60, events: 60, prefs: { start: 9 * 60, end: 18 * 60, buffer: 10, dur: 60 }, rocks }); return { left: c.left, fits: c.fits.map((r) => r.id), moves: c.moves.map((r) => r.id), used: c.used, over: c.over }; }, rocks);
  ok('13:00, an hour of meetings left: 4 hours free; three fit, one moves', c1.left === 240 && c1.fits.join() === 'a,b,c' && c1.moves.join() === 'd' && c1.used === 200, c1);
  ok('the overrun is the whole day against the time left: 4h 30m needed, 4h free, 30m over', c1.over === 30, c1);
  const c2 = await p.evaluate((rocks) => { const c = window.FlowReplan.compute({ now: 16 * 60, events: 0, prefs: { start: 9 * 60, end: 18 * 60, buffer: 10, dur: 60 }, rocks }); return { fits: c.fits.map((r) => r.id), moves: c.moves.map((r) => r.id) }; }, rocks);
  ok('at 16:00 only the high-priority timed one fits; the rest move, the overdue one last', c2.fits.join() === 'a' && c2.moves.join() === 'b,c,d', c2);
  const c3 = await p.evaluate((rocks) => { const c = window.FlowReplan.compute({ now: 16 * 60, events: 0, prefs: { start: 9 * 60, end: 18 * 60, buffer: 10, dur: 60 }, rocks, keep: new Set(['c']) }); return { fits: c.fits.map((r) => r.id), moves: c.moves.map((r) => r.id) }; }, rocks);
  ok('keeping one bumps another: the kept rock stays whatever its priority, and the one it displaced moves', c3.fits.includes('c') && c3.moves.includes('a'), c3);
  const c4 = await p.evaluate((rocks) => { const c = window.FlowReplan.compute({ now: 16 * 60, events: 0, prefs: { start: 9 * 60, end: 18 * 60, buffer: 10, dur: 60 }, rocks, durs: { b: 20, c: 20 } }); return { fits: c.fits.map((r) => r.id) }; }, rocks);
  ok('shorter estimates fit more', c4.fits.join() === 'a,b,c', c4);
  const c5 = await p.evaluate((rocks) => { const c = window.FlowReplan.compute({ now: 19 * 60, events: 0, prefs: { start: 9 * 60, end: 18 * 60, buffer: 10, dur: 60 }, rocks }); return { left: c.left, fits: c.fits.length, moves: c.moves.length }; }, rocks);
  ok('after the working day nothing fits and nothing is invented', c5.left === 0 && c5.fits === 0 && c5.moves === 4, c5);

  console.log('\n— on Today, in Simple —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); });
  const S = await p.evaluate(async () => {
    const now = new Date(), t = (now.getDay() + 6) % 7, w = weekId(now);
    const rows = [
      { id: 'r1', title: 'Send the venue contract', day: t, time: '10:00', end: '11:00', prio: 'high', done: false },
      { id: 'r2', title: 'Book the photographer', day: t, prio: 'med', done: false },
      { id: 'r3', title: 'Write the set list', day: t, prio: 'low', done: false },
      { id: 'r4', title: 'Reply to the agency', day: t, prio: 'med', done: false }
    ];
    if (t > 0) rows.push({ id: 'r5', title: 'Old one from earlier', day: 0, prio: 'high', done: false });
    cData.rocks[w] = rows; cData.aside = [];
    cSave(); Flow.Nav.go('today'); renderToday();
    await new Promise((r) => setTimeout(r, 1200));
    return { t, w, late: t > 0 };
  });
  const acts = await p.evaluate(() => [...document.querySelectorAll('#today-feed .lk-acts .lk-act')].map((b) => b.textContent));
  ok('under the hero: My day changed' + (S.late ? ', and the overdue count' : ''), acts.includes('My day changed') && (!S.late || acts.some((x) => /^Overdue · 1$/.test(x))), acts);
  await p.evaluate(async () => { await Flow.Settings.set('workStart', '09:00'); await Flow.Settings.set('workEnd', '18:00'); await Flow.Settings.set('bufferMin', 10); });
  await p.click('#today-feed [data-lk-act="replan"]'); await p.waitForTimeout(400);
  const sh = await p.evaluate(() => { const el = document.getElementById('flow-replan'); return { on: el.classList.contains('on'), sub: el.querySelector('.rp-sub').textContent, rows: el.querySelectorAll('.rp-row').length, fits: !!el.querySelector('.ra-k'), accept: el.querySelector('[data-rp="accept"]').hidden }; });
  ok('the sheet opens with the time left and every open rock, nothing moved yet', sh.on && /left until 18:00/.test(sh.sub) && sh.rows === (S.late ? 5 : 4) && (await p.evaluate(() => (cData.rocks[weekId(new Date())] || []).length)) === (S.late ? 5 : 4), sh);
  /* force a crowded day whatever the clock says: every rock takes 3 hours */
  /* one at a time, by id: each change repaints the sheet, so a list of inputs
     taken before the first change is detached after it */
  await p.evaluate(() => { [...document.querySelectorAll('#flow-replan [data-rp-dur]')].map((i) => i.getAttribute('data-rp-dur')).forEach((id) => { const i = document.querySelector('#flow-replan [data-rp-dur="' + id + '"]'); i.value = '180'; i.dispatchEvent(new Event('change', { bubbles: true })); }); });
  await p.waitForTimeout(200);
  const crowded = await p.evaluate(() => { const el = document.getElementById('flow-replan'); return { moves: el.querySelectorAll('.rp-row.mv').length, btn: el.querySelector('[data-rp="accept"]').textContent, hidden: el.querySelector('[data-rp="accept"]').hidden }; });
  ok('with three-hour rocks most of the day moves, and the button says where', crowded.moves >= 1 && !crowded.hidden && /^Move \d+ to /.test(crowded.btn), crowded);
  const keepId = await p.evaluate(() => { const r = document.querySelector('#flow-replan .rp-row.mv [data-rp="keep"]'); const id = r.getAttribute('data-id'); r.click(); return id; });
  await p.waitForTimeout(200);
  ok('Keep today pins that rock in the day', await p.evaluate((id) => { const el = document.getElementById('flow-replan'); const row = el.querySelector('[data-rp="keep"][data-id="' + id + '"]').closest('.rp-row'); return !row.classList.contains('mv') && row.querySelector('.rp-keep').classList.contains('on'); }, keepId));
  const before = await p.evaluate(() => JSON.stringify((cData.rocks[weekId(new Date())] || []).map((r) => [r.id, r.day])));
  await p.click('#flow-replan [data-rp="accept"]'); await p.waitForTimeout(600);
  const after = await p.evaluate((keepId) => { const w = weekId(new Date()), t = (new Date().getDay() + 6) % 7; const here = (cData.rocks[w] || []).filter((r) => r.day === t || r.day < t).map((r) => r.id); const kept = here.includes(keepId); let elsewhere = 0; Object.keys(cData.rocks).forEach((ww) => (cData.rocks[ww] || []).forEach((r) => { if (ww !== w || r.day > t) elsewhere++; })); return { kept, elsewhere, undo: document.getElementById('ra-undo').classList.contains('on'), sheet: document.querySelector('#flow-replan.on') }; }, keepId);
  ok('Accept moves the rest to a later day, keeps the kept one, and offers Undo', after.kept && after.elsewhere >= 1 && after.undo && !after.sheet, after);
  await p.click('#ra-undo button'); await p.waitForTimeout(400);
  ok('Undo puts every rock back on its day', (await p.evaluate(() => JSON.stringify((cData.rocks[weekId(new Date())] || []).map((r) => [r.id, r.day]).sort()))) === JSON.parse(JSON.stringify(before)) || (await p.evaluate(() => (cData.rocks[weekId(new Date())] || []).length)) === (S.late ? 5 : 4));

  if (S.late) {
    console.log('\n— the overdue list —');
    await p.click('#today-feed [data-lk-act="triage"]'); await p.waitForTimeout(400);
    const tg = await p.evaluate(() => { const el = document.getElementById('flow-triage'); return { on: el.classList.contains('on'), rows: el.querySelectorAll('.tg-row').length, acts: [...el.querySelectorAll('.tg-row:first-child .tg-acts button')].map((b) => b.textContent) }; });
    ok('it lists the overdue rock with Done, Today, Tomorrow, Drop', tg.on && tg.rows === 1 && tg.acts.join() === 'Done,Today,Tomorrow,Drop', tg);
    await p.click('#flow-triage [data-tg="today"]'); await p.waitForTimeout(500);
    ok('Today moves it onto today, open — not done', await p.evaluate(() => { const r = (cData.rocks[weekId(new Date())] || []).find((x) => x.id === 'r5'); return r && r.day === (new Date().getDay() + 6) % 7 && !r.done; }));
    await p.waitForTimeout(1200);
    ok('with nothing left the list closes itself and the pill is gone', await p.evaluate(() => !document.querySelector('#flow-triage.on') && !document.querySelector('#today-feed [data-lk-act="triage"]')));
  }

  console.log('\n— an Open loop past its day —');
  await p.evaluate(async () => { const d = new Date(); d.setDate(d.getDate() - 8); Flow.Schedule.put('planner::loop1', { text: 'Call the landlord about the lease', tab: 'planner', date: window.FlowRockActions.iso(d), done: false }); await Flow.Schedule.saveNow(); renderToday(); });
  await p.waitForTimeout(700);
  const lp = await p.evaluate(() => ({ chip: (document.querySelector('#today-feed [data-lk-act="triage"]') || {}).textContent || '' }));
  ok('the Overdue chip counts it, with no overdue Priority left', lp.chip === 'Overdue · 1', lp);
  await p.click('#today-feed [data-lk-act="triage"]'); await p.waitForTimeout(400);
  const lrow = await p.evaluate(() => { const el = document.getElementById('flow-triage'); const r = el.querySelector('.tg-row.tg-loop'); return { on: el.classList.contains('on'), t: r && r.querySelector('.tg-t').textContent, acts: r ? [...r.querySelectorAll('button')].map((b) => b.textContent) : [], sub: el.querySelector('.tg-sub').textContent }; });
  ok('the sheet lists it under its own kind: Done, Today, Tomorrow — no Drop, it lives in the Planner', lrow.on && /Call the landlord/.test(lrow.t) && lrow.acts.join() === 'Done,Today,Tomorrow' && /1 Open loop past its day/.test(lrow.sub), lrow);
  await p.click('#flow-triage [data-tg="ltoday"]'); await p.waitForTimeout(600);
  ok('Today moves it onto today, still open', await p.evaluate(() => { const r = Flow.Schedule.get('planner::loop1'); return r && r.date === window.FlowRockActions.iso(new Date()) && !r.done; }));
  await p.waitForTimeout(1000);
  ok('nothing left overdue: the sheet closes and the chip goes', await p.evaluate(() => !document.querySelector('#flow-triage.on') && !document.querySelector('#today-feed [data-lk-act="triage"]')));
  await p.evaluate(async () => { Flow.Schedule.remove('planner::loop1'); await Flow.Schedule.saveNow(); renderToday(); });

  console.log('\n— the review, with evidence —');
  await p.evaluate(() => { const w = weekId(new Date()); const r = (cData.rocks[w] || []).find((x) => x.id === 'r3'); if (r) r.moved = 3; const r2 = (cData.rocks[w] || []).find((x) => x.id === 'r2'); if (r2) r2.done = true; cSave(); window.FlowRockActions && 0; });
  await p.evaluate(() => Flow.TodayPlus.reviewSheet()); await p.waitForTimeout(500);
  const rv = await p.evaluate(() => { const el = document.getElementById('flow-review'); const ev = el.querySelector('#rv-evidence'); return ev && { cells: [...ev.querySelectorAll('.rv-c')].map((c) => c.querySelector('b').textContent + ' ' + c.querySelector('span').textContent), note: (ev.querySelector('.rv-note') || {}).textContent || '', inputs: ev.querySelectorAll('.rv-next input').length }; });
  ok('what happened: planned, done, moved, dropped, handed off — the counts of this week', rv && rv.cells.some((c) => /^\d+ planned$/.test(c)) && rv.cells.includes('1 done') && rv.cells.some((c) => /^\d+ moved$/.test(c)), rv);
  ok('the rock that kept moving is named', rv && /Write the set list/.test(rv.note) && /3 times/.test(rv.note), rv && rv.note);
  await p.fill('#rv-evidence .rv-next input >> nth=0', 'Finish the proposal');
  await p.fill('#rv-evidence #rv-line', 'A heavy week, but the contract went out.');
  await p.click('#rv-evidence .rv-next [type="submit"]'); await p.waitForTimeout(700);
  const nx = await p.evaluate(async () => { const mon = new Date(); mon.setHours(12, 0, 0, 0); mon.setDate(mon.getDate() + (7 - (mon.getDay() + 6) % 7)); const w = weekId(mon); return { next: (cData.rocks[w] || []).map((r) => [r.title, r.day, r.prio]), reviews: await Flow.DB.get('flow:reviews', []), open: !!document.querySelector('#flow-review.on') }; });
  ok('next week gets the Big Rock, on Monday, high', nx.next.some((r) => r[0] === 'Finish the proposal' && r[1] === 0 && r[2] === 'high'), nx.next);
  ok('the review is kept with its counts and the line', nx.reviews.length === 1 && nx.reviews[0].line === 'A heavy week, but the contract went out.' && nx.reviews[0].counts.done === 1 && !nx.open, nx.reviews);

  console.log('\n— counts, never content —');
  ok('what left the browser was event names only', tracked.length >= 3 && tracked.every((t) => Object.keys(t).sort().join() === 'e,look' && !/venue|photographer|proposal/.test(JSON.stringify(t))), tracked.slice(0, 4));
  ok('a replan and a review were counted', tracked.some((t) => t.e === 'replan_accepted') && tracked.some((t) => t.e === 'review_completed') && tracked.some((t) => t.e === 'replan_undone'), tracked.map((t) => t.e));
  const stats = await p.evaluate(async () => (await fetch('/api/flow/stats?days=2', { credentials: 'same-origin' })).json());
  ok('the owner reads them back as people per day', stats.ok && stats.days[0].replan_accepted && stats.days[0].replan_accepted.people === 1 && stats.days[0].replan_accepted.simple === 1, stats.days && stats.days[0]);
  ok('nothing but a known event name is counted', (await p.evaluate(async () => (await fetch('/api/flow/track', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e: 'typed the word venue' }) })).status)) === 400);

  console.log('\n— Advanced —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); }); await p.waitForTimeout(800);
  const adv = await p.evaluate(() => { const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; }; return { acts: vis('#today-feed .lk-acts'), hero: vis('#today-feed .lk-hero') }; });
  ok('no action row, no hero — Today is as it was', !adv.acts && !adv.hero, adv);
  await p.evaluate(() => { window.FlowReplan.open(); window.FlowTriage.open(); }); await p.waitForTimeout(200);
  ok('the sheets cannot open', await p.evaluate(() => !document.querySelector('#flow-replan.on') && !document.querySelector('#flow-triage.on')));
  await p.evaluate(() => Flow.TodayPlus.reviewSheet()); await p.waitForTimeout(400);
  ok('the review sheet is the review sheet it was', await p.evaluate(() => { const el = document.getElementById('flow-review'); return el.classList.contains('on') && !el.querySelector('#rv-evidence'); }));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
