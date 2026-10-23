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
      healthRead: async () => JSON.parse(JSON.stringify(window.__healthReply))
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
  ok('no page errors', errs.length === 0, errs.slice(0, 3));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
