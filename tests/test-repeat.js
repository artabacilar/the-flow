/* A Big Rock that comes back: every week, every two weeks, every month.
 *
 * What would make it wrong: the next one written before this one is done or
 * past; two of them ahead; a month of absence coming back as four overdue
 * copies; the 31st landing in a month that has no 31st and vanishing; two
 * devices writing the same next one twice; "Never" leaving the auto-written
 * one behind; the section showing in Advanced; the Turkish reading English. */
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

  console.log('\n— the arithmetic —');
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const nx = await p.evaluate(() => { const R = window.FlowRepeat; const f = (y, m, d, rule) => { const n = R.next(new Date(y, m - 1, d), rule); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); }; return { w: f(2026, 11, 1, 'week'), w2: f(2026, 11, 1, '2weeks'), m: f(2026, 11, 1, 'month'), jan31: f(2026, 1, 31, 'month'), mar31: f(2026, 3, 31, 'month'), dec: f(2026, 12, 15, 'month'), lbl: [R.label('month', new Date(2026, 10, 1)), R.label('week', new Date(2026, 10, 1)), R.label('month', new Date(2026, 10, 22)), R.label('month', new Date(2026, 10, 3))] }; });
  ok('a week is seven days on, two weeks fourteen', nx.w === '2026-11-08' && nx.w2 === '2026-11-15', nx);
  ok('a month is the same date next month', nx.m === '2026-12-01' && nx.dec === '2027-01-15', nx);
  ok('the 31st in a shorter month is its last day', nx.jan31 === '2026-02-28' && nx.mar31 === '2026-04-30', nx);
  ok('the rule reads as a sentence', nx.lbl.join('|') === 'Every month on the 1st|Every week on Sun|Every month on the 22nd|Every month on the 3rd', nx.lbl);

  console.log('\n— the chain —');
  /* a monthly rock on the 1st of this month, in the past, not done */
  const S = await p.evaluate(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const first = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    if (first.getDate() === today.getDate() && first.getMonth() === today.getMonth() && today.getDate() === 1) first.setMonth(first.getMonth() - 1);
    const w = weekId(first), day = (first.getDay() + 6) % 7;
    Object.keys(cData.rocks).forEach((k) => { cData.rocks[k] = (cData.rocks[k] || []).filter((r) => !/invoices|Water the plants|Pay the rent/.test(r.title)); });
    (cData.rocks[w] = cData.rocks[w] || []).push({ id: 'inv', title: 'Send ChatGPT + Claude invoices to the accountant', day, time: '10:00', prio: 'med', done: false, repeat: 'month', series: 'inv' });
    cSave();
    const wrote = window.FlowRepeat.materialize();
    const all = []; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => { if (r.series === 'inv') all.push({ id: r.id, w: k, day: r.day, done: r.done, time: r.time, repeat: r.repeat }); }));
    const next = new Date(first.getFullYear(), first.getMonth() + 1, 1, 12);
    return { wrote, all, firstIso: window.FlowRockActions.iso(first), nextIso: window.FlowRockActions.iso(next), nextW: weekId(next), nextDay: (next.getDay() + 6) % 7, again: window.FlowRepeat.materialize() };
  });
  ok('an occurrence whose day has passed gets the next one written, on the 1st of next month, with its time and rule', S.wrote === 1 && S.all.length === 2 && S.all.some((r) => r.id === 'inv@' + S.nextIso && r.w === S.nextW && r.day === S.nextDay && r.time === '10:00' && r.repeat === 'month' && !r.done), S);
  ok('and only one: a second pass writes nothing', S.again === 0 && (await p.evaluate(() => { let n = 0; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => { if (r.series === 'inv') n++; })); return n; })) === 2);
  ok('the one that passed stays where it was, still open — it is still to do', S.all.some((r) => r.id === 'inv' && !r.done));

  /* done early: the next one is written at once */
  const E = await p.evaluate(() => {
    const t = new Date(); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() + 2);
    const w = weekId(t), day = (t.getDay() + 6) % 7;
    (cData.rocks[w] = cData.rocks[w] || []).push({ id: 'plants', title: 'Water the plants', day, prio: 'low', done: false, repeat: 'week', series: 'plants' });
    cSave();
    const before = window.FlowRepeat.materialize();
    const r = window.FlowRockActions.find('plants').r; r.done = true; cSave();
    const after = window.FlowRepeat.materialize();
    const n = new Date(t); n.setDate(n.getDate() + 7);
    const got = window.FlowRockActions.find('plants@' + window.FlowRockActions.iso(n));
    return { before, after, got: got && { w: got.w, day: got.r.day, done: got.r.done }, want: { w: weekId(n), day: (n.getDay() + 6) % 7 } };
  });
  ok('a future occurrence writes nothing until it is done', E.before === 0, E);
  ok('done, the next week\'s is written a week on', E.after === 1 && E.got && E.got.w === E.want.w && E.got.day === E.want.day && !E.got.done, E);

  /* a long absence: a weekly rock last seen five weeks ago comes back once, not five times */
  const G = await p.evaluate(() => {
    const t = new Date(); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - 35);
    const w = weekId(t), day = (t.getDay() + 6) % 7;
    (cData.rocks[w] = cData.rocks[w] || []).push({ id: 'rent', title: 'Pay the rent', day, prio: 'high', done: true, repeat: 'week', series: 'rent' });
    cSave();
    const wrote = window.FlowRepeat.materialize();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const all = []; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => { if (r.series === 'rent') all.push({ id: r.id, d: window.FlowRockActions.iso(window.FlowRockActions.dateOf(k, r.day)) }); }));
    const next = all.filter((r) => r.id !== 'rent').map((r) => r.d);
    return { wrote, n: all.length, next, today: window.FlowRockActions.iso(today) };
  });
  ok('five weeks away: one next occurrence, on or after today — not five overdue copies', G.wrote === 1 && G.n === 2 && G.next.length === 1 && G.next[0] >= G.today, G);

  /* dropped: the chain goes on */
  const D = await p.evaluate(() => {
    const id = 'inv@' + window.FlowRockActions.iso(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1, 12));
    const hit = window.FlowRockActions.find(id); if (!hit) return { missing: id };
    window.FlowRockActions.setAside(id, 'dropped');
    const wrote = window.FlowRepeat.materialize();
    const after = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1, 12);
    return { wrote, next: !!window.FlowRockActions.find('inv@' + window.FlowRockActions.iso(after)) };
  });
  ok('dropping this month\'s does not end the chain: next month\'s is written (by the drop itself)', D.next, D);

  console.log('\n— the sheet, in Simple —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const t = new Date(); const w = weekId(t), day = (t.getDay() + 6) % 7; (cData.rocks[w] = cData.rocks[w] || []).push({ id: 'one', title: 'Call the landlord', day, prio: 'med', done: false }); cSave(); renderToday(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => window.FlowRockActions.open('one')); await p.waitForTimeout(300);
  const sh = await p.evaluate(() => { const el = document.getElementById('flow-ra'); return { on: el.classList.contains('on'), rep: !el.querySelector('.ra-repwrap').hidden, btns: [...el.querySelectorAll('[data-ra-rep]')].map((b) => b.textContent), never: el.querySelector('[data-ra-rep=""]').classList.contains('on') }; });
  ok('the ⋯ sheet has a Repeat row: Never, Every week, Every 2 weeks, Every month — Never on', sh.on && sh.rep && sh.btns.join() === 'Never,Every week,Every 2 weeks,Every month' && sh.never, sh);
  await p.click('#flow-ra [data-ra-rep="month"]'); await p.waitForTimeout(400);
  const set = await p.evaluate(() => { const el = document.getElementById('flow-ra'); const r = window.FlowRockActions.find('one').r; return { on: el.querySelector('[data-ra-rep="month"]').classList.contains('on'), note: (el.querySelector('.ra-repnote') || {}).textContent || '', repeat: r.repeat, series: r.series, mark: !!document.querySelector('#today-feed .td-rock[data-rockid="one"] .rk-rep') }; });
  ok('choosing Every month sets the rule, says so under the row, and the rock wears a ↻ on Today', set.on && /^Every month on the \d+(st|nd|rd|th)/.test(set.note) && set.repeat === 'month' && set.series === 'one' && set.mark, set);
  await p.evaluate(() => { const r = window.FlowRockActions.find('one').r; r.done = true; cSave(); renderToday(); }); await p.waitForTimeout(500);
  const chained = await p.evaluate(() => { let n = 0, ahead = 0; const today = new Date(); today.setHours(0, 0, 0, 0); Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => { if (r.series === 'one') { n++; if (window.FlowRockActions.dateOf(k, r.day) > today && !r.done) ahead++; } })); return { n, ahead }; });
  ok('ticking it done on Today writes next month\'s, without being asked', chained.n === 2 && chained.ahead === 1, chained);
  await p.evaluate(() => window.FlowRockActions.open('one')); await p.waitForTimeout(300);
  await p.click('#flow-ra [data-ra-rep=""]'); await p.waitForTimeout(400);
  const off = await p.evaluate(() => { let n = 0, rep = 0; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => { if (r.series === 'one') { n++; if (r.repeat) rep++; } })); return { n, rep, undo: document.getElementById('ra-undo').classList.contains('on') }; });
  ok('Never takes the rule off and removes the one ahead it had written; Undo is offered', off.n === 1 && off.rep === 0 && off.undo, off);
  await p.click('#ra-undo button'); await p.waitForTimeout(300);
  ok('Undo brings the rule and the next one back', await p.evaluate(() => { let n = 0, rep = 0; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => { if (r.series === 'one') { n++; if (r.repeat) rep++; } })); return n === 2 && rep === 2; }));
  await p.evaluate(() => window.FlowRockActions.close());

  console.log('\n— in Turkish —');
  await p.evaluate(async () => { await Flow.Lang.set('tr'); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.FlowRockActions.open('one')); await p.waitForTimeout(400);
  const tr = await p.evaluate(() => { const el = document.getElementById('flow-ra'); return { btns: [...el.querySelectorAll('[data-ra-rep]')].map((b) => b.textContent), k: [...el.querySelectorAll('.ra-k')].map((e) => e.textContent), note: el.querySelector('.ra-repnote').textContent, lbl: window.FlowRepeat.label('month', new Date(2026, 10, 1)) + ' / ' + window.FlowRepeat.label('week', new Date(2026, 10, 1)) }; });
  ok('the row is Turkish: Hiç, Her hafta, İki haftada bir, Her ay', tr.btns.join() === 'Hiç,Her hafta,İki haftada bir,Her ay' && tr.k.includes('Tekrar'), tr);
  ok('the sentence is Turkish, with the Turkish ordinal: "Her ay ayın 1\'i", "Her hafta Paz"', /Her ay ayın \d+'/.test(tr.note) && /Bu bitince/.test(tr.note) && tr.lbl === "Her ay ayın 1'i / Her hafta Paz", tr);
  await p.evaluate(async () => { window.FlowRockActions.close(); await Flow.Lang.set('en'); }); await p.waitForTimeout(600);

  console.log('\n— Advanced —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); renderToday(); }); await p.waitForTimeout(600);
  await p.evaluate(() => window.FlowRockActions.open('one')); await p.waitForTimeout(300);
  const adv = await p.evaluate(() => ({ rep: document.querySelector('#flow-ra .ra-repwrap').hidden, mark: !!document.querySelector('#today-feed .rk-rep') && getComputedStyle(document.querySelector('#today-feed .rk-rep')).display !== 'none' }));
  ok('no Repeat row, no ↻ — the sheet is the sheet it was; the chain still runs underneath', adv.rep && !adv.mark, adv);
  await p.evaluate(() => window.FlowRockActions.close());
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
