/* The new look on Today (Signature theme).
 *
 * The parts added to Today read the week the feed already shows, so these
 * check they say the same thing it does: the greeting uses your name, the
 * strip is this week with today marked and a dot on days that still have a
 * Big Rock, the summary counts what is open and overdue, and it all follows
 * a change. Then the + menu opens and the same + closes it, and switching to
 * another theme takes every added piece away. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur Abacilar'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);

  console.log('\n— off unless you switch it on —');
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(800);
  const before = await p.evaluate(() => ({
    look: document.documentElement.getAttribute('data-flow-look'),
    pieces: [...document.querySelectorAll('.lk-hello, .lk-strip, .lk-hero')].every((e) => getComputedStyle(e).display === 'none'),
    title: getComputedStyle(document.querySelector('#today-feed .td-title')).display,
    fab: getComputedStyle(document.querySelector('#flow-tabbar .fn-cap .fn-knob')).borderRadius
  }));
  ok('a new account gets the previous design', before.look === 'classic' && before.pieces && before.title !== 'none', before);
  ok('including the old square + button', before.fab === '16px', before.fab);
  await p.evaluate(() => Flow.Nav.go('settings')); await p.waitForTimeout(900);
  ok('Settings → Appearance has the switch, off', await p.evaluate(() => { const i = document.querySelector('#newLookRow input[data-s="newLook"]'); return !!i && !i.checked; }));
  await p.evaluate(() => { const i = document.querySelector('#newLookRow input[data-s="newLook"]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(700);
  ok('switching it on takes effect straight away', await p.evaluate(() => document.documentElement.getAttribute('data-flow-look') === 'new'));
  ok('and is saved to the account', await p.evaluate(() => Flow.Settings.get('newLook') === true));

  /* A known week: one rock yesterday (overdue unless today is Monday), two today, one done. */
  const setup = await p.evaluate(async () => {
    const now = new Date(), t = (now.getDay() + 6) % 7, w = weekId(now);
    const y = Math.max(0, t - 1);
    cData.rocks[w] = [
      { id: 'r1', title: 'Send the Q4 plan', day: y, prio: 'high', done: false },
      { id: 'r2', title: 'Record the DJ set demo', day: t, prio: 'med', done: false },
      { id: 'r3', title: 'Leg day', day: t, prio: 'med', done: false },
      { id: 'r4', title: 'Book the studio', day: t, prio: 'med', done: true }
    ];
    cSave(); Flow.Nav.go('today');
    await new Promise((r) => setTimeout(r, 1200));
    return { t, overdueExpected: t > 0 ? 1 : 0, theme: document.documentElement.getAttribute('data-flow-theme') };
  });
  ok('Signature is the theme in use', setup.theme === 'signature', setup.theme);

  const v = await p.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const txt = (s) => (q(s) || {}).textContent ? q(s).textContent.replace(/\s+/g, ' ').trim() : '';
    const days = [...document.querySelectorAll('.lk-day')];
    return {
      greet: txt('.lk-greet'), date: txt('.lk-date'),
      days: days.length, on: days.findIndex((d) => d.classList.contains('on')),
      busy: days.map((d) => d.classList.contains('busy')),
      line: txt('.lk-line'), next: txt('.lk-next'), pills: txt('.lk-pills'),
      titleHidden: getComputedStyle(q('#today-feed .td-title')).display === 'none',
      rocksBg: getComputedStyle(q('#today-feed .td-rocks')).backgroundColor,
      fab: getComputedStyle(q('#flow-tabbar .fn-cap .fn-knob')).backgroundColor
    };
  });
  ok('the greeting uses your first name', /^(Morning|Afternoon|Evening|Good night), Artur$/.test(v.greet), v.greet);
  ok('with today\'s date above it', /\d{1,2} [A-Z][a-z]+/.test(v.date), v.date);
  ok('the page title is replaced, not doubled', v.titleHidden);
  ok('the strip is the seven days of this week, today marked', v.days === 7 && v.on === setup.t, v);
  ok('days with an open Big Rock carry a dot, a day with only a done one does not', v.busy[setup.t] === true && v.busy.filter(Boolean).length === (setup.t > 0 ? 2 : 1), v.busy);
  ok('the summary counts today\'s open rocks, not the week\'s', setup.overdueExpected ? /^2 Big Rocks for today/.test(v.line) : /^3 Big Rocks for today/.test(v.line), v.line);
  ok('and the overdue one', setup.overdueExpected ? /1 overdue/.test(v.line) : !/overdue/.test(v.line), v.line);
  ok('next is today\'s first open rock', /^Next\s*/.test(v.next) && (setup.overdueExpected ? /Record the DJ set demo/ : /Send the Q4 plan/).test(v.next) && /Today/.test(v.next), v.next);
  ok('the week pill shows how much is done', /Week \d+ · 25%/.test(v.pills), v.pills);
  ok('Big Rocks sit on the lime card', v.rocksBg === 'rgb(200, 242, 107)', v.rocksBg);
  ok('the + is coral', v.fab === 'rgb(255, 107, 61)', v.fab);

  console.log('\n— a week with most of it still ahead —');
  const ahead = await p.evaluate(async () => {
    const now = new Date(), t = (now.getDay() + 6) % 7, w = weekId(now);
    const saved = cData.rocks[w];
    /* Ten open rocks, none of them today: the week is busy, today is not. */
    const later = t < 6 ? t + 1 : -1;
    cData.rocks[w] = Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i, title: 'Later thing ' + i, day: later, time: i === 0 ? '09:00' : '', prio: 'med', done: false }));
    cSave(); renderToday(); await new Promise((r) => setTimeout(r, 700));
    const txt = (s) => ((document.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const out = { t, line: txt('.lk-line'), next: txt('.lk-next'), pills: txt('.lk-pills') };
    /* Two today, one of them done, plus eight later. */
    cData.rocks[w] = cData.rocks[w].slice(0, 8).concat([
      { id: 'b1', title: 'Today first', day: t, time: '08:00', prio: 'med', done: true },
      { id: 'b2', title: 'Today second', day: t, time: '15:30', prio: 'med', done: false }
    ]);
    cSave(); renderToday(); await new Promise((r) => setTimeout(r, 700));
    out.line2 = txt('.lk-line'); out.next2 = txt('.lk-next'); out.pills2 = txt('.lk-pills');
    cData.rocks[w].forEach((r) => { if (r.day === t) r.done = true; });
    cSave(); renderToday(); await new Promise((r) => setTimeout(r, 700));
    out.line3 = txt('.lk-line');
    cData.rocks[w] = saved; cSave(); renderToday(); await new Promise((r) => setTimeout(r, 400));
    return out;
  });
  ok('ten rocks later in the week are not ten for today', /^Nothing due today\./.test(ahead.line) && !/10 Big Rocks/.test(ahead.line), ahead.line);
  ok('they show as more this week', /10 more this week/.test(ahead.pills), ahead.pills);
  ok('next is the earliest one, with its day', ahead.t < 6 ? /Later thing 0/.test(ahead.next) && /Tomorrow 09:00/.test(ahead.next) : /No day set/.test(ahead.next), ahead.next);
  ok('one open today is one for today', /^1 Big Rock for today\.$/.test(ahead.line2), ahead.line2);
  ok('next is today\'s, at its time', /Today second/.test(ahead.next2) && /Today 15:30/.test(ahead.next2), ahead.next2);
  ok('the rest of the week is the pill', /8 more this week/.test(ahead.pills2), ahead.pills2);
  ok('today finished says so', /^Today’s Big Rocks are done\./.test(ahead.line3), ahead.line3);

  console.log('\n— it follows a change —');
  const after = await p.evaluate(async () => {
    const w = weekId(new Date());
    cData.rocks[w].forEach((r) => { r.done = true; }); cSave();
    if (typeof renderToday === 'function') renderToday();
    await new Promise((r) => setTimeout(r, 600));
    return { line: document.querySelector('.lk-line').textContent, next: !!document.querySelector('.lk-next'), n: document.querySelectorAll('.lk-hero').length };
  });
  ok('when everything is done it says so', /All 4 Big Rocks done/.test(after.line), after);
  ok('with no next item', after.next === false, after);
  ok('and the summary is not added twice', after.n === 1, after);

  console.log('\n— the + menu —');
  await p.click('#flow-tabbar .fn-cap'); await p.waitForTimeout(500);
  const menu = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#flow-capture .fn-grid [data-fn-cap]')];
    return { open: document.getElementById('flow-capture').classList.contains('on'), pills: items.every((b) => getComputedStyle(b).borderRadius === '999px'), dots: new Set(items.map((b) => getComputedStyle(b, '::before').backgroundColor)).size, n: items.length,
      barOnTop: +getComputedStyle(document.getElementById('flow-tabbar')).zIndex > +getComputedStyle(document.getElementById('flow-capture')).zIndex };
  });
  ok('it opens as a stack of pills', menu.open && menu.pills, menu);
  ok('each with its own colour', menu.dots === menu.n, menu);
  ok('the bar stays above it', menu.barOnTop, menu);
  await p.click('#flow-tabbar .fn-cap'); await p.waitForTimeout(400);
  ok('and the same + closes it', await p.evaluate(() => !document.getElementById('flow-capture').classList.contains('on')));
  await p.click('#flow-tabbar .fn-cap'); await p.waitForTimeout(400);
  await p.click('#flow-capture [data-fn-cap="note"]'); await p.waitForTimeout(400);
  ok('writing a note still gets a proper sheet', await p.evaluate(() => {
    const s = document.querySelector('#flow-capture .fn-sheet'); return document.getElementById('flow-capture').classList.contains('note') && getComputedStyle(s).backgroundColor !== 'rgba(0, 0, 0, 0)';
  }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  console.log('\n— other themes keep their own Today —');
  await p.evaluate(async () => { Flow.Theme.apply('paper', false); });
  await p.waitForTimeout(500);
  const paper = await p.evaluate(() => ({
    hidden: [...document.querySelectorAll('.lk-hello, .lk-strip, .lk-hero')].every((e) => getComputedStyle(e).display === 'none'),
    title: getComputedStyle(document.querySelector('#today-feed .td-title')).display
  }));
  ok('the added pieces disappear', paper.hidden, paper);
  ok('and the page title comes back', paper.title !== 'none', paper);
  await p.evaluate(async () => { Flow.Theme.apply('signature', false); });

  console.log('\n— and back —');
  await p.evaluate(() => Flow.Nav.go('settings')); await p.waitForTimeout(900);
  await p.evaluate(() => { const i = document.querySelector('#newLookRow input[data-s="newLook"]'); i.checked = false; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(600);
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(800);
  const back = await p.evaluate(() => ({
    look: document.documentElement.getAttribute('data-flow-look'),
    pieces: [...document.querySelectorAll('.lk-hello, .lk-strip, .lk-hero')].every((e) => getComputedStyle(e).display === 'none'),
    rocksBg: getComputedStyle(document.querySelector('#today-feed .td-rocks')).backgroundColor,
    fab: getComputedStyle(document.querySelector('#flow-tabbar .fn-cap .fn-knob')).borderRadius
  }));
  ok('turning it off restores the previous Today', back.look === 'classic' && back.pieces && back.rocksBg !== 'rgb(200, 242, 107)', back);
  ok('and the previous tab bar', back.fab === '16px', back.fab);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(4500);
  ok('it stays off after a reload', await p.evaluate(() => document.documentElement.getAttribute('data-flow-look') === 'classic'));

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
