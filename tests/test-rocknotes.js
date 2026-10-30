/* A Priority's notes and links, and adding a Priority right on the card.
 *
 * What would make it wrong: a note typed and lost because the sheet was
 * closed before it saved; a link stored as "example.com" and opening as a
 * relative path; javascript: accepted as a link; links not shown on the row,
 * or shown in the card's own ink instead of as links; the add field missing,
 * adding to the wrong day, or adding an empty Priority; a repeating Priority
 * losing its links on the next one; any of it showing in Advanced. */
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
    const t = new Date(); const w = weekId(t);
    cData.rocks[w] = [{ id: 'inv', title: 'Send the invoices to the accountant', day: (t.getDay() + 6) % 7, time: '10:00', prio: 'med', note: '', done: false }];
    cSave();
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
  });
  await p.waitForTimeout(900);

  console.log('\n— adding a Priority on the card —');
  const form = await p.evaluate(() => { const f = document.querySelector('#today-feed .td-rocks:not(#td-cal) .lk-rk-add'); return f && { last: f === f.parentNode.lastElementChild, ph: f.querySelector('input').placeholder, days: [...f.querySelectorAll('option')].map((o) => o.textContent).slice(0, 2), vis: getComputedStyle(f).display !== 'none' }; });
  ok('the Priorities card ends with an "Add a Priority…" field, Today first, then Tomorrow', form && form.last && form.vis && form.ph === 'Add a Priority…' && form.days.join() === 'Today,Tomorrow', form);
  await p.click('#today-feed .lk-rk-add button'); await p.waitForTimeout(300);
  ok('an empty one is not added', await p.evaluate(() => (cData.rocks[weekId(new Date())] || []).length === 1));
  await p.fill('#today-feed .lk-rk-add input', 'Book the venue');
  await p.press('#today-feed .lk-rk-add input', 'Enter'); await p.waitForTimeout(700);
  const added = await p.evaluate(() => { const t = new Date(); const r = (cData.rocks[weekId(t)] || []).find((x) => x.title === 'Book the venue'); return { r: r && { day: r.day, prio: r.prio }, today: (t.getDay() + 6) % 7, row: [...document.querySelectorAll('#today-feed .td-rocks:not(#td-cal) .td-rock .rk-title')].some((e) => /Book the venue/.test(e.textContent)), field: document.querySelector('#today-feed .lk-rk-add input').value, focused: document.activeElement && document.activeElement.closest && !!document.activeElement.closest('.lk-rk-add') }; });
  ok('Enter adds it to today, it shows on the card, and the field is empty and ready for the next', added.r && added.r.day === added.today && added.row && added.field === '' && added.focused, added);
  await p.fill('#today-feed .lk-rk-add input', 'Pick up the suit');
  await p.selectOption('#today-feed .lk-rk-add select', { index: 1 });
  await p.click('#today-feed .lk-rk-add button'); await p.waitForTimeout(700);
  const tm = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); const r = (cData.rocks[weekId(d)] || []).find((x) => x.title === 'Pick up the suit'); return { ok: !!r && r.day === (d.getDay() + 6) % 7 }; });
  ok('Tomorrow puts it on tomorrow — in next week\'s list when today is Sunday', tm.ok, tm);

  console.log('\n— notes and links in the sheet —');
  await p.evaluate(() => window.FlowRockActions.open('inv')); await p.waitForTimeout(400);
  const sh = await p.evaluate(() => { const el = document.getElementById('flow-ra'); return { notes: !el.querySelector('.ra-notes').hidden, k: [...el.querySelectorAll('.ra-notes .ra-k')].map((e) => e.textContent) }; });
  ok('the sheet has Notes and Links', sh.notes && sh.k.join() === 'Notes,Links', sh);
  await p.fill('#ra-note', 'Window: 1st–10th of the month.\nSend both to kaan@example.com');
  await p.waitForTimeout(900);
  ok('a note saves itself while typing', await p.evaluate(() => /1st–10th/.test(window.FlowRockActions.find('inv').r.note)));
  await p.fill('#ra-link', 'javascript:alert(1)'); await p.click('[data-ra="addlink"]'); await p.waitForTimeout(200);
  await p.fill('#ra-link', 'just words'); await p.press('#ra-link', 'Enter'); await p.waitForTimeout(200);
  ok('javascript: and plain words are not links', await p.evaluate(() => !(window.FlowRockActions.find('inv').r.links || []).length));
  await p.fill('#ra-link', 'platform.openai.com/settings/organization/billing?tab=invoices&x=1'); await p.press('#ra-link', 'Enter'); await p.waitForTimeout(300);
  await p.fill('#ra-link', 'https://claude.ai/settings/billing'); await p.click('[data-ra="addlink"]'); await p.waitForTimeout(300);
  const L = await p.evaluate(() => { const el = document.getElementById('flow-ra'); const a = [...el.querySelectorAll('.ra-links a')]; return { stored: window.FlowRockActions.find('inv').r.links, shown: a.map((x) => x.textContent), href: a.map((x) => x.getAttribute('href')), blank: a.every((x) => x.target === '_blank' && /noopener/.test(x.rel)), color: a[0] && getComputedStyle(a[0]).color, field: el.querySelector('#ra-link').value }; });
  ok('a link without https:// gets it, & and all, and is listed', L.stored && L.stored[0] === 'https://platform.openai.com/settings/organization/billing?tab=invoices&x=1' && L.stored[1] === 'https://claude.ai/settings/billing' && L.href[0] === L.stored[0] && L.field === '', L);
  ok('links in the sheet are blue and open in a new tab', L.blank && /rgb\(125, 180, 255\)/.test(L.color), L.color);
  await p.fill('#ra-note', 'Window: 1st–10th of the month.\nSend both to kaan@example.com\nAsk Kaan about the VAT line.');
  await p.evaluate(() => window.FlowRockActions.close()); await p.waitForTimeout(600);
  const row = await p.evaluate(() => { const r = document.querySelector('#today-feed .td-rock[data-rockid="inv"]'); const a = r ? [...r.querySelectorAll('.rk-links a')] : []; return { note: r && (r.querySelector('.td-rk-note') || {}).textContent, saved: window.FlowRockActions.find('inv').r.note, n: a.length, txt: a.map((x) => x.textContent.trim()), color: a[0] && getComputedStyle(a[0]).color, blank: a.every((x) => x.target === '_blank') }; });
  ok('closing right after typing keeps the last words', /VAT line/.test(row.saved), row.saved);
  ok('the row shows the note', row.note && /1st–10th/.test(row.note), row.note);
  ok('and the links, in blue, opening in a new tab', row.n === 2 && /^platform\.openai\.com\/settings/.test(row.txt[0]) && /claude\.ai\/settings\/billing/.test(row.txt[1]) && row.color === 'rgb(29, 78, 216)' && row.blank, row);
  await p.evaluate(() => window.FlowRockActions.open('inv')); await p.waitForTimeout(300);
  const back = await p.evaluate(() => ({ note: document.getElementById('ra-note').value, n: document.querySelectorAll('#flow-ra .ra-links a').length }));
  ok('opening it again shows the note and the links', /VAT line/.test(back.note) && back.n === 2, back);
  await p.click('#flow-ra [data-ra-unlink="1"]'); await p.waitForTimeout(300);
  ok('× takes a link off', await p.evaluate(() => window.FlowRockActions.find('inv').r.links.length === 1 && document.querySelectorAll('#flow-ra .ra-links a').length === 1));
  await p.evaluate(() => window.FlowRockActions.close()); await p.waitForTimeout(400);
  ok('and off the row', await p.evaluate(() => document.querySelectorAll('#today-feed .td-rock[data-rockid="inv"] .rk-links a').length === 1));

  console.log('\n— a repeating one keeps them —');
  const R = await p.evaluate(() => {
    const h = window.FlowRockActions.find('inv'); h.r.repeat = 'month'; h.r.series = 'inv'; h.r.done = true; cSave();
    window.FlowRepeat.materialize();
    let next = null; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => { if (r.series === 'inv' && r.id !== 'inv') next = r; }));
    return next && { links: next.links, note: next.note };
  });
  ok('next month\'s copy carries the note and the links', R && R.links && R.links.length === 1 && /VAT line/.test(R.note), R);

  console.log('\n— on a light theme —');
  await p.evaluate(() => Flow.Theme.apply('paper', false)); await p.waitForTimeout(300);
  await p.evaluate(() => window.FlowRockActions.open('inv')); await p.waitForTimeout(300);
  ok('sheet links are a darker blue on paper', await p.evaluate(() => getComputedStyle(document.querySelector('#flow-ra .ra-links a')).color === 'rgb(29, 78, 216)'));
  await p.evaluate(() => { window.FlowRockActions.close(); Flow.Theme.apply('signature', false); }); await p.waitForTimeout(300);

  console.log('\n— Advanced —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); renderToday(); }); await p.waitForTimeout(600);
  await p.evaluate(() => window.FlowRockActions.open('inv')); await p.waitForTimeout(300);
  const adv = await p.evaluate(() => { const f = document.querySelector('#today-feed .lk-rk-add'); return { notes: document.querySelector('#flow-ra .ra-notes').hidden, add: !f || getComputedStyle(f).display === 'none', links: !document.querySelector('#today-feed .rk-links') }; });
  ok('no Notes section, no add field, no link row — Advanced is as it was', adv.notes && adv.add && adv.links, adv);
  await p.evaluate(() => window.FlowRockActions.close());
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
