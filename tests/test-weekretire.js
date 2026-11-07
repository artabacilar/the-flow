/* Simple without the Week Compass.
 *
 * What would make it wrong: the Compass still in Simple's menu, or gone from
 * Advanced; something that asks for the Compass in Simple opening a hidden
 * page instead of Today's Week view; a day's training missing from the Week
 * view; no way to the weekly review from the week; the review sheet still
 * offering to open the Compass, or losing what was dropped and delegated
 * with no way to put it back; the week in words not saved; the mission and
 * roles nowhere to be edited, or edited into a copy Advanced does not see;
 * the calendar file unreachable, or its panel left stranded outside the
 * Compass afterwards; or any page error. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    const t = new Date(), w = weekId(t), d = (t.getDay() + 6) % 7;
    cData.rocks = {}; cData.rocks[w] = [{ id: 'a', title: 'Write the brief', day: d, prio: 'med', done: false }, { id: 'gone', title: 'Old idea to drop', day: d, prio: 'med', done: false }];
    cData.mission = ''; cSave();
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
  });
  await p.waitForTimeout(900);
  const vis = (s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }, s);

  console.log('\n— the menu —');
  ok('Simple\'s menu has no Week Compass', !(await vis('[data-fn-side="compass"]')));
  ok('North Star and Open loops are still there', (await vis('[data-fn-side="northstar"]')) && (await vis('[data-fn-side="quad"]')));

  console.log('\n— asking for the Compass in Simple —');
  const go = await p.evaluate(() => { const r = Flow.Nav.go('compass'); return { r, tab: document.querySelector('.tab.active[data-tab]').getAttribute('data-tab'), view: window.FlowTodayBeta && FlowTodayBeta.view, wk: window.FlowTodayBeta && FlowTodayBeta.week }; });
  ok('lands on Today, in the Week view of this week', go.tab === 'today' && go.view === 'week' && go.wk === 0, go);
  ok('and tells a caller that wanted the Compass\'s own form that it is not on screen', go.r === false, go);
  await p.waitForTimeout(400);
  await p.evaluate(() => Flow.Nav.openCapture()); await p.waitForTimeout(300);
  await p.click('#flow-capture [data-fn-cap="quad"]'); await p.waitForTimeout(600);
  const task = await p.evaluate(() => ({ tab: document.querySelector('.tab.active[data-tab]').getAttribute('data-tab'), field: !!document.activeElement && document.activeElement.matches('#today-feed .lk-bt .bt-comp input'), view: FlowTodayBeta.view }));
  ok('+ Task puts the cursor in Today\'s Add field, on today', task.tab === 'today' && task.field && task.view === 'day', task);
  await p.evaluate(() => Flow.Nav.go('compass')); await p.waitForTimeout(400);

  console.log('\n— the Week view —');
  const wk = await p.evaluate(() => {
    const el = document.querySelector('#today-feed .lk-bt');
    const t = new Date(); const d = (t.getDay() + 6) % 7; const w = weekId(t);
    const want = []; for (let i = 0; i < 7; i++) { try { const tp = getDayPlan(w, DAY_KEYS[i]); if (tp && tp.type !== 'rest' && tp.title) want.push(tp.title); } catch (e) {} }
    return { trains: [...el.querySelectorAll('.bt-train span')].map((x) => x.textContent), want,
      review: !!el.querySelector('.bt-ctrls [data-bt="weekreview"]'), compassLink: !!el.querySelector('[data-bt="compass"]'),
      railReview: !!el.querySelector('.lk-bt-rail [data-bt="weekreview"]') };
  });
  ok('every training day of the plan shows its session, in day order', wk.want.length > 0 && JSON.stringify(wk.trains) === JSON.stringify(wk.want), wk);
  ok('"Review the week" sits in the Week view\'s controls, and in the side column', wk.review && wk.railReview, wk);
  ok('no "Open Week Compass" link anywhere on Today', !wk.compassLink, wk);
  await p.click('[data-bt="vday"]'); await p.waitForTimeout(300);
  ok('the Day view does not carry the review button in its controls', !(await p.evaluate(() => !!document.querySelector('#today-feed .lk-bt .bt-ctrls [data-bt="weekreview"]'))));

  console.log('\n— the review sheet —');
  await p.evaluate(() => { FlowRockActions.setAside('gone', 'dropped'); });
  await p.waitForTimeout(400);
  await p.click('#today-feed .lk-bt-rail [data-bt="weekreview"]'); await p.waitForTimeout(700);
  const rv = await p.evaluate(() => { const w = document.getElementById('flow-review'); const k = w.querySelector('[data-rv="week"]');
    return { on: w.classList.contains('on'), compassHidden: !k || k.hidden || getComputedStyle(k).display === 'none',
      aside: [...w.querySelectorAll('.rv-aside li .ra-wt')].map((x) => x.textContent), plan: !!w.querySelector('#rv-plan') }; });
  ok('opens', rv.on, rv);
  ok('does not offer to open the Week Compass', rv.compassHidden, rv);
  ok('lists what was dropped this week', rv.aside.length === 1 && /Old idea to drop/.test(rv.aside[0]) && /Dropped/.test(rv.aside[0]), rv);
  await p.click('#flow-review [data-rv-back]'); await p.waitForTimeout(500);
  const back = await p.evaluate(() => ({ list: document.querySelectorAll('#flow-review .rv-aside li').length, onDay: (cData.rocks[weekId(new Date())] || []).some((r) => r.id === 'gone') }));
  ok('"Put back" puts it back on its day and off the list', back.list === 0 && back.onDay, back);
  await p.fill('#rv-plan', 'Ship the brief. No new projects.');
  await p.click('#flow-review .rv-next button[type="submit"]'); await p.waitForTimeout(700);
  const plan = await p.evaluate(() => { const m = new Date(); m.setHours(12, 0, 0, 0); m.setDate(m.getDate() + (7 - (m.getDay() + 6) % 7)); return (cData.plans || {})[weekId(m)] || ''; });
  ok('"Next week in words" is saved as next week\'s plan — the same box the Compass and Direction read', plan === 'Ship the brief. No new projects.', plan);

  console.log('\n— North Star —');
  await p.evaluate(() => Flow.Nav.go('northstar')); await p.waitForTimeout(1500);
  ok('has the mission and the roles', await p.evaluate(() => { const c = document.getElementById('ns-mission'); return !!c && /Mission/.test(c.textContent) && c.querySelectorAll('.ns-roles li').length === cData.roles.length; }));
  await p.click('#ns-mission [data-nsm="edit"]'); await p.waitForTimeout(300);
  await p.fill('#ns-mis-ta', 'I build things that last.');
  await p.fill('#ns-roles-ta', 'Founder\nMusic\n\nfounder\nHealth');
  await p.click('#ns-mission [data-nsm="save"]'); await p.waitForTimeout(500);
  const ms = await p.evaluate(() => ({ m: cData.mission, roles: cData.roles, shown: (document.querySelector('#ns-mission .ns-mis-text') || {}).textContent, compass: (document.getElementById('missionText') || {}).textContent }));
  ok('editing saves the mission into the record Advanced\'s Compass shows', ms.m === 'I build things that last.' && ms.shown === ms.m && ms.compass === ms.m, ms);
  ok('roles: one per line, blanks and repeats left out', JSON.stringify(ms.roles) === JSON.stringify(['Founder', 'Music', 'Health']), ms);

  console.log('\n— the calendar file —');
  await p.evaluate(() => Flow.Nav.go('settings')); await p.waitForTimeout(1500);
  ok('Settings → Connections has a Calendar file row', await vis('#connCard #setIcsOpen'));
  await p.click('#setIcsOpen'); await p.waitForTimeout(500);
  const ics = await p.evaluate(() => ({ on: document.getElementById('flow-ics').classList.contains('on'), inSheet: !!document.querySelector('#flow-ics #icsPanel #icsExport') }));
  ok('it opens the calendar panel, with its download button', ics.on && ics.inSheet, ics);
  await p.click('#flow-ics .fn-capture-close'); await p.waitForTimeout(300);
  ok('closing puts the panel back in the Compass, where Advanced keeps it', await p.evaluate(() => !!document.querySelector('#tab-compass #icsPanel') && !document.getElementById('flow-ics').classList.contains('on')));

  console.log('\n— Advanced is as it was —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); FlowTodayLook.applyLook(); });
  await p.waitForTimeout(600);
  ok('the Week Compass is in the menu', await vis('[data-fn-side="compass"]'));
  const adv = await p.evaluate(() => ({ r: Flow.Nav.go('compass'), tab: document.querySelector('.tab.active[data-tab]').getAttribute('data-tab') }));
  ok('and opens', adv.r === true && adv.tab === 'compass', adv);
  await p.evaluate(() => Flow.Nav.go('northstar')); await p.waitForTimeout(1200);
  ok('North Star has no mission card (the Compass has it)', !(await p.evaluate(() => !!document.getElementById('ns-mission'))));
  await p.evaluate(() => Flow.Nav.go('settings')); await p.waitForTimeout(1200);
  ok('Settings has no calendar-file row (the Compass has it)', !(await p.evaluate(() => !!document.getElementById('setIcsOpen'))));

  ok('no page errors', errs.length === 0, errs);
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
