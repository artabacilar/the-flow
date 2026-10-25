/* Apple Health, as the page sees it from the iPhone bridge.
 *
 * The bridge is faked: these checks are about what the page does with what
 * the phone hands it — a night it imported is refreshed when Health's total
 * changes, a night somebody wrote is never touched, a read cut short keeps
 * what was there, and each figure carries its own date. (Merging overlapping
 * sleep samples happens in the native reader, FlowHealth.swift.) */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 260) : ''))); };
const iso = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([d0, d1, d2]) => {
    window.__healthReply = { available: true, read: 3, days: [
      { date: d2, hours: 6.5, hrv: 40, rhr: 58 },
      { date: d1, hours: 7.0, rhr: 56 },
      { date: d0, hours: 7.5, hrv: 51 }] };
    window.Capacitor = { Plugins: { FlowBridge: {
      healthStatus: async () => ({ available: true, asked: true }),
      healthRequest: async () => ({ available: true, asked: true }),
      healthRead: async () => { window.__reads = (window.__reads || 0) + 1; return JSON.parse(JSON.stringify(window.__healthReply)); }
    } } };
  }, [iso(0), iso(1), iso(2)]);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);

  const first = await p.evaluate(async () => { await syncHealth(true); return slData.filter((e) => e.src === 'health' || e.note === 'from Apple Health').map((e) => ({ d: e.date, h: e.hrs })); });
  ok('three nights come in from Health', first.length === 3, first);

  console.log('\n— a night already imported is refreshed —');
  const r = await p.evaluate(async ([d1, d2]) => {
    slData.find((e) => e.date === d2).note = 'I wrote this myself'; delete slData.find((e) => e.date === d2).src; slData.find((e) => e.date === d2).hrs = 5;
    window.__healthReply.days.find((x) => x.date === d1).hours = 7.8;
    window.__healthReply.days.find((x) => x.date === d2).hours = 9.9;
    await syncHealth(true);
    return { d1: slData.find((e) => e.date === d1).hrs, d2: slData.find((e) => e.date === d2).hrs };
  }, [iso(1), iso(2)]);
  ok('Health\'s newer total replaces the one it wrote before', r.d1 === 7.8, r);
  ok('a night somebody wrote themselves is left alone', r.d2 === 5, r);

  console.log('\n— a read cut short keeps what was there —');
  const pr = await p.evaluate(async ([d0, d2]) => {
    window.__healthReply = { available: true, partial: true, read: 1, days: [{ date: d0, hours: 7.6 }] };
    await syncHealth(true);
    const h = JSON.parse(localStorage.getItem('ld_health'));
    return { n: h.days.length, d2: h.days.find((x) => x.date === d2), d0: h.days.find((x) => x.date === d0), foot: document.getElementById('healthFoot').textContent };
  }, [iso(0), iso(2)]);
  ok('days it did not get to are kept', pr.n === 3 && pr.d2 && pr.d2.hrv === 40, pr);
  ok('and a figure it did not re-read is kept for the day it did', pr.d0 && pr.d0.hours === 7.6 && pr.d0.hrv === 51, pr.d0);
  ok('the card says the read was cut short', /cut short/.test(pr.foot), pr.foot);

  console.log('\n— each figure with its own date —');
  ok('sleep, HRV and resting HR each name their day', /sleep 7\.6 h \(/.test(pr.foot) && /HRV 51 ms \(/.test(pr.foot) && /resting HR 56 \(/.test(pr.foot), pr.foot);
  const wd = await p.evaluate(() => whoopData.dates);
  ok('the panel keeps a date per figure', wd && wd.hrv && wd.rhr && wd.hours && wd.rhr !== wd.hrv, wd);

  console.log('\n— last night, first —');
  const t = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const bedIso = (() => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(23, 40, 0, 0); return d.toISOString(); })();
  await p.evaluate(() => Flow.Nav.go('sleep')); await p.waitForTimeout(700);
  const night = await p.evaluate(async ([d0, bed, wake, older]) => {
    window.__healthReply = { available: true, read: 8, days: older.map((d) => ({ date: d, hours: 7 })).concat([
      { date: d0, hours: 7.5, bedAt: bed, sleepAt: wake, deepMin: 70, coreMin: 250, remMin: 100, awakeMin: 20, hrv: 51, rhr: 55 }]) };
    await syncHealth(true);
    const box = document.getElementById('healthNight');
    const row = slData.find((e) => e.date === d0);
    return { text: box ? box.textContent.replace(/\s+/g, ' ') : '', bars: box ? box.querySelectorAll('.hn-bar i').length : 0, visible: !!(box && box.offsetHeight), bed: row && row.bed, wake: row && row.wake };
  }, [iso(0), bedIso, t(7, 10), [iso(3), iso(4), iso(5), iso(6), iso(7), iso(8), iso(9)]]);
  if (process.env.SHOT) await p.locator('#healthPanel').screenshot({ path: process.env.SHOT + '-health.png' });
  ok('the panel leads with last night', /Last night/.test(night.text) && night.visible, night.text);
  ok('hours asleep, written as hours and minutes', /7h 30m asleep/.test(night.text), night.text);
  ok('when sleep started and ended', /23:40\s*→\s*07:10/.test(night.text), night.text);
  ok('the stages, as a bar and in words', night.bars === 4 && /Deep 1h 10m/.test(night.text) && /REM 1h 40m/.test(night.text) && /Awake 20m/.test(night.text), night);
  /* The seven nights before: 7.8, 9.9 and five of 7.0 — an average of 7h 32m. */
  ok('compared with the week before', /−02m vs your 7-night average of 7h 32m/.test(night.text), night.text);
  ok('with that morning\'s HRV and resting heart rate', /HRV 51 ms/.test(night.text) && /resting HR 55/.test(night.text), night.text);
  ok('the Sleep log gets the bed and wake times too', night.bed === '23:40' && night.wake === '07:10', night);

  const stale = await p.evaluate(([d1, d2]) => FlowHealthNight.html([{ date: d2, hours: 6 }, { date: d1, hours: 6.2 }], false), [iso(1), iso(2)]);
  ok('a night that is not last night is named for what it is', /The night before last/.test(stale) && /6h 12m/.test(stale), stale.slice(0, 200));
  ok('and on a Mac it says how to get last night in', /Open The Flow on your iPhone/.test(stale));
  ok('no stages recorded means no empty bar', !/hn-bar/.test(stale));

  console.log('\n— coming back to the app reads again —');
  const fg = await p.evaluate(async () => {
    const r0 = window.__reads;
    healthData.updated = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 400));
    const r1 = window.__reads;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 400));
    return { stale: r1 - r0, fresh: window.__reads - r1 };
  });
  ok('after a while away, Health is read again', fg.stale === 1, fg);
  ok('but not again straight after', fg.fresh === 0, fg);

  ok('no page errors', errs.length === 0, errs.slice(0, 3));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
