/* The new Today, as a beta in Simple.
 *
 * What would make it wrong: the switch missing, or reachable in Advanced; the
 * old strip, hero, Priorities card or Coming up still showing beside it (the
 * same list twice is what it exists to end), or gone for good once it is off;
 * a day on the strip that counts the wrong things or is not the day it says;
 * a Priority added to the day you were looking at when you had chosen another
 * on the chip, or added to a past day; a tick that does not save or cannot be
 * undone; the review row missing something overdue, or its buttons doing the
 * wrong thing; the Focus pin surviving the Priority being done; links not
 * shown as links; the panel wider than a phone; or any of it in Advanced. */
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
  /* Today, tomorrow, and — when today is not Monday — yesterday, left open. */
  const T = await p.evaluate(async () => {
    const t = new Date(), w = weekId(t), d = (t.getDay() + 6) % 7;
    const tm = new Date(t); tm.setDate(t.getDate() + 1);
    cData.rocks = {};
    cData.rocks[w] = [
      { id: 'a', title: 'Update the agent script', day: d, prio: 'med', note: 'From Fathom: sales sync', done: false },
      { id: 'b', title: 'Send ad creatives for review', day: d, time: '15:00', prio: 'med', note: '', done: false, links: ['https://example.com/creatives/october'] },
      { id: 'c', title: 'Post the CRM requirements', day: d, prio: 'med', note: '', done: true }
    ];
    if (d > 0) cData.rocks[w].push({ id: 'late', title: 'Onboard Ali on lead qualification', day: d - 1, time: '14:00', prio: 'med', note: '', done: false });
    const wt = weekId(tm); if (!cData.rocks[wt]) cData.rocks[wt] = [];
    cData.rocks[wt].push({ id: 'tm', title: 'Cancel the popular-products discount', day: (tm.getDay() + 6) % 7, prio: 'med', note: '', done: false });
    cSave();
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    return { d, monday: d === 0, sunday: d === 6 };
  });
  await p.waitForTimeout(900);

  console.log('\n— the only Today in Simple —');
  ok('no "Try the new Today" chip, no Classic button, no switch in Settings: it simply is Today', await p.evaluate(() => !document.querySelector('[data-lk-act="beta"]') && !document.querySelector('[data-bt="classic"]') && !document.getElementById('todayBetaRow')));
  const on = await p.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
    return { attr: document.documentElement.getAttribute('data-today-beta'), saved: Flow.Settings.get('todayBeta'), panel: vis('#today-feed .lk-bt'),
      old: ['.lk-strip', '.lk-hero', '#today-feed > .td-rocks', '.flow-today-actions'].filter(vis), ahead: vis('#flow-td-ahead'),
      aheadAfter: (() => { const a = document.getElementById('flow-td-ahead'), b = document.querySelector('#today-feed .lk-bt'); return !!a && !!b && !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) && a.getBoundingClientRect().top >= b.getBoundingClientRect().bottom - 1; })(),
      lime: (() => { const m = document.querySelector('#today-feed .lk-bt-main'); return m && getComputedStyle(m).backgroundColor; })(),
      afterHead: (() => { const el = document.querySelector('#today-feed .lk-bt'); let x = el && el.previousElementSibling; while (x && getComputedStyle(x).display === 'none') x = x.previousElementSibling; return !!x && x.classList.contains('td-head'); })(),
      routines: (() => { const r = document.querySelector('#today-feed .lk-bt-routines'); return !!r && /Today’s routines/.test(r.textContent) && !!r.nextElementSibling && /td-group|flow-td-meals|flow-td-habits/.test(r.nextElementSibling.className + ' ' + r.nextElementSibling.id); })() };
  });
  ok('Simple shows it straight away', on.attr === 'on', on);
  ok('the plan wears the lime of the classic Priorities card', on.lime === 'rgb(200, 242, 107)', on.lime);
  ok('the panel sits right under the greeting', on.panel && on.afterHead, on);
  ok('the strip, the hero card, the Priorities card and the old buttons step aside', on.old.length === 0, on.old);
  ok('Coming up stays, right under the plan', on.ahead && on.aheadAfter, on);
  ok('"Today\'s routines" heads habits, training and meals', on.routines, on);
  const tl = await p.evaluate(() => { const rail = document.querySelector('#today-feed .lk-bt-rail'); const t = rail && rail.querySelector('.lk-bt-tiles > .flow-td-pulse'); const r = t && t.getBoundingClientRect(), c = rail && rail.querySelector('.lk-bt-cal').getBoundingClientRect(); return { inRail: !!t, n: t ? t.querySelectorAll('.flow-td-tile').length : 0, loose: !!document.querySelector('#today-feed > .flow-td-pulse'), above: !!r && r.bottom <= c.top + 1, cols: t ? getComputedStyle(t).gridTemplateColumns.split(' ').length : 0 }; });
  ok('Recovery, Meetings, Focus and Spend sit in the side column, 2 × 2, above the calendar — not beside the greeting', tl.inRail && tl.n === 4 && !tl.loose && tl.above && tl.cols === 2, tl);
  await p.evaluate(() => renderToday()); await p.waitForTimeout(700);
  ok('and stay there when Today redraws', await p.evaluate(() => document.querySelectorAll('.flow-td-pulse').length === 1 && !!document.querySelector('#today-feed .lk-bt-tiles > .flow-td-pulse')));

  console.log('\n— the day —');
  const day = await p.evaluate(() => {
    const el = document.querySelector('#today-feed .lk-bt');
    const sel = el.querySelector('.lk-bt-day[aria-selected="true"]');
    return { title: el.querySelector('.bt-title').textContent, want: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
      eyebrow: el.querySelector('.bt-eyebrow').textContent, counts: el.querySelector('.bt-counts').textContent,
      selToday: sel && sel.classList.contains('today'), selCount: sel && sel.querySelector('.c').textContent, days: el.querySelectorAll('.lk-bt-day').length,
      rows: [...el.querySelectorAll('.lk-bt-list .bt-task .bt-open')].map((x) => x.textContent), doneBar: (el.querySelector('.bt-donebar') || {}).textContent || '',
      link: (() => { const a = el.querySelector('.lk-bt-list a.bt-link'); return a && { href: a.getAttribute('href'), blank: a.target === '_blank' && /noopener/.test(a.rel), color: getComputedStyle(a).color }; })(),
      note: [...el.querySelectorAll('.lk-bt-list .bt-tt small')].map((x) => x.textContent) };
  });
  ok('it opens on today, by name and date', day.title === day.want && /Daily plan · Today/.test(day.eyebrow), day);
  ok('"2 planned · 1 done", and today\'s day says 2', /^2 planned · 1 done$/.test(day.counts) && day.selToday && day.selCount === '2' && day.days === 7, day);
  ok('the open two are listed, the done one is folded under "Done · 1"', day.rows.length === 2 && /Done · 1/.test(day.doneBar), day);
  ok('the note shows, and the link is a real link opening in a new tab', day.note.some((n) => /sales sync/.test(n)) && day.link && day.link.href === 'https://example.com/creatives/october' && day.link.blank, day);

  console.log('\n— another day, and adding —');
  if (!T.sunday) {
    await p.click('#today-feed .lk-bt-day.today + .lk-bt-day'); await p.waitForTimeout(400);
    const tm = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); return { eyebrow: el.querySelector('.bt-eyebrow').textContent, rows: [...el.querySelectorAll('.lk-bt-list .bt-open')].map((x) => x.textContent), chip: el.querySelector('.bt-date').textContent, back: !!el.querySelector('[data-bt="today"]'), ph: el.querySelector('.bt-comp input').placeholder }; });
    ok('tomorrow shows tomorrow\'s Priority, a way back, and a chip on tomorrow', /Tomorrow/.test(tm.eyebrow) && tm.rows.join() === 'Cancel the popular-products discount' && tm.back && /^Tomorrow · /.test(tm.chip) && /tomorrow/.test(tm.ph), tm);
    await p.fill('#today-feed .bt-comp input', 'Book the photographer');
    /* typing set the draft on tomorrow; now look at today: the draft keeps its day */
    await p.click('#today-feed [data-bt="today"]'); await p.waitForTimeout(300);
    const kept = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); return { chip: el.querySelector('.bt-date').textContent, moved: el.querySelector('.bt-date').classList.contains('moved'), hint: el.querySelector('.bt-hint').hidden ? '' : el.querySelector('.bt-hint').textContent, val: el.querySelector('.bt-comp input').value }; });
    ok('a draft started on tomorrow keeps tomorrow when you look at today, and says so', /^Tomorrow/.test(kept.chip) && kept.moved && /keeps its day/.test(kept.hint) && kept.val === 'Book the photographer', kept);
    await p.press('#today-feed .bt-comp input', 'Enter'); await p.waitForTimeout(700);
    const added = await p.evaluate(() => { const tm = new Date(); tm.setDate(tm.getDate() + 1); const r = (cData.rocks[weekId(tm)] || []).find((x) => x.title === 'Book the photographer'); const el = document.querySelector('#today-feed .lk-bt'); return { ok: !!r && r.day === (tm.getDay() + 6) % 7, onToday: [...el.querySelectorAll('.lk-bt-list .bt-open')].some((x) => /photographer/.test(x.textContent)), field: el.querySelector('.bt-comp input').value, chip: el.querySelector('.bt-date').textContent, focus: document.activeElement === el.querySelector('.bt-comp input'), undo: !!document.querySelector('#ra-undo.on') }; });
    ok('Enter puts it on tomorrow, not today', added.ok && !added.onToday, added);
    ok('then the field is empty, ready again, back on today\'s chip, with an Undo', added.field === '' && added.focus && /^Today/.test(added.chip) && added.undo, added);
    await p.click('#ra-undo button'); await p.waitForTimeout(500);
    ok('Undo takes it off again', await p.evaluate(() => !Object.values(cData.rocks).flat().some((x) => x && x.title === 'Book the photographer')));
  } else ok('(Sunday: tomorrow is next week — covered by the week arrows below)', true);
  await p.click('#today-feed .bt-date'); await p.waitForTimeout(200);
  const menu = await p.evaluate(() => [...document.querySelectorAll('#today-feed .bt-menu button')].map((x) => x.textContent));
  ok('the date chip offers today, tomorrow and on to next week', /^Today · /.test(menu[0]) && /^Tomorrow · /.test(menu[1]) && menu.length >= 5, menu);
  await p.click('#today-feed .bt-menu button >> nth=4'); await p.waitForTimeout(200);
  await p.fill('#today-feed .bt-comp input', 'Weekly review with the sales team'); await p.click('#today-feed .bt-add'); await p.waitForTimeout(600);
  const nw = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 7); const r = (cData.rocks[weekId(d)] || []).find((x) => x.title === 'Weekly review with the sales team'); return !!r && r.day === (d.getDay() + 6) % 7; });
  ok('a day chosen on the chip — a week ahead, in next week\'s list — is where it lands', nw);
  if (!T.monday) {
    await p.click('#today-feed .lk-bt-day.today'); await p.waitForTimeout(200);
    await p.evaluate(() => { const d = document.querySelector('#today-feed .lk-bt-day.today').previousElementSibling; d.click(); }); await p.waitForTimeout(300);
    const past = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); return { chip: el.querySelector('.bt-date').textContent, hint: el.querySelector('.bt-hint').textContent, late: el.querySelector('.lk-bt-day.today').previousElementSibling.classList.contains('late') }; });
    ok('looking at yesterday, a new one still goes on today, and it says so; yesterday is marked late', /^Today/.test(past.chip) && /Past days/.test(past.hint) && past.late, past);
    await p.click('#today-feed [data-bt="today"]'); await p.waitForTimeout(300);
  }

  console.log('\n— ticking, and the Focus —');
  await p.click('#today-feed .lk-bt-list .bt-task[data-btid="a"] .bt-pin'); await p.waitForTimeout(500);
  const f = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); const c = el.querySelector('.bt-focus'); return { card: c && c.getAttribute('data-btid'), saved: (Flow.Settings.get('todayFocus') || {}).ids, planned: [...el.querySelectorAll('.bt-rows .bt-task')].map((x) => x.getAttribute('data-btid')) }; });
  ok('◎ pins one as the Focus, on top, out of the Planned list', f.card === 'a' && f.saved && f.saved.join() === 'a' && f.planned.indexOf('a') < 0, f);
  await p.click('#today-feed .lk-bt-list .bt-task[data-btid="b"] .bt-pin'); await p.waitForTimeout(500);
  const f2 = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); return { cards: [...el.querySelectorAll('.bt-focus')].map((c) => c.getAttribute('data-btid')), head: el.querySelector('.bt-sec-f').textContent, saved: (Flow.Settings.get('todayFocus') || {}).ids, starts: el.querySelectorAll('.bt-focus .bt-start').length }; });
  ok('a second ◎ adds it to the Focus too — two cards, each with its own Start focus', f2.cards.join() === 'a,b' && /Focus · 2/.test(f2.head) && f2.saved.join() === 'a,b' && f2.starts === 2, f2);
  await p.click('#today-feed .bt-focus[data-btid="b"] .bt-unpin'); await p.waitForTimeout(500);
  ok('Unpin on one card takes only that one out', await p.evaluate(() => { const ids = (Flow.Settings.get('todayFocus') || {}).ids || []; return ids.join() === 'a' && document.querySelectorAll('#today-feed .bt-focus').length === 1; }));
  await p.click('#today-feed .lk-bt-list .bt-task[data-btid="b"] .bt-pin'); await p.waitForTimeout(500);
  ok('the Focus card stands out dark on the lime', await p.evaluate(() => getComputedStyle(document.querySelector('#today-feed .bt-focus')).backgroundColor === 'rgb(21, 25, 10)'));
  await p.click('#today-feed .bt-focus .bt-chk'); await p.waitForTimeout(600);
  const tk = await p.evaluate(() => ({ done: window.FlowRockActions.find('a').r.done, pin: (Flow.Settings.get('todayFocus') || {}).ids, cards: [...document.querySelectorAll('#today-feed .bt-focus')].map((c) => c.getAttribute('data-btid')), undo: !!document.querySelector('#ra-undo.on'), counts: document.querySelector('#today-feed .bt-counts').textContent }));
  ok('ticking one saves it done, takes only it out of the Focus, and offers Undo', tk.done === true && tk.pin && tk.pin.join() === 'b' && tk.cards.join() === 'b' && tk.undo && /2 done/.test(tk.counts), tk);
  await p.click('#today-feed .bt-focus[data-btid="b"] .bt-unpin'); await p.waitForTimeout(400);
  await p.click('#ra-undo button'); await p.waitForTimeout(500);
  ok('Undo makes it open again', await p.evaluate(() => window.FlowRockActions.find('a').r.done === false));
  await p.click('#today-feed .bt-donebar'); await p.waitForTimeout(300);
  ok('"Done ›" opens the done ones', await p.evaluate(() => [...document.querySelectorAll('#today-feed .bt-task.done .bt-open')].some((x) => /CRM requirements/.test(x.textContent))));
  await p.click('#today-feed .bt-task[data-btid="b"] .bt-open'); await p.waitForTimeout(400);
  ok('tapping a title opens its sheet — notes, links, move, repeat', await p.evaluate(() => document.getElementById('flow-ra').classList.contains('on') && /Send ad creatives/.test(document.querySelector('#flow-ra h4').textContent)));
  console.log('\n— editing it: name, importance, time —');
  const sh = await p.evaluate(() => { const el = document.getElementById('flow-ra'); return { edit: !el.querySelector('.ra-edit').hidden, name: el.querySelector('#ra-title').value, imp: [...el.querySelectorAll('[data-ra-imp]')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')) }; });
  ok('the sheet opens with the name editable, and High / Normal / Low on Normal', sh.edit && sh.name === 'Send ad creatives for review' && sh.imp.join() === 'High:false,Normal:true,Low:false', sh);
  await p.fill('#ra-title', 'Send the October ad creatives for review'); await p.waitForTimeout(800);
  await p.click('#flow-ra [data-ra-imp="high"]'); await p.waitForTimeout(200);
  await p.fill('#ra-time', '16:30'); await p.waitForTimeout(300);
  await p.evaluate(() => window.FlowRockActions.close()); await p.waitForTimeout(600);
  const ed = await p.evaluate(() => { const r = window.FlowRockActions.find('b').r; const rows = [...document.querySelectorAll('#today-feed .bt-rows .bt-task')]; const first = rows[0]; return { title: r.title, prio: r.prio, time: r.time, firstId: first && first.getAttribute('data-btid'), tag: first && (first.querySelector('.bt-imp') || {}).textContent, shown: first && first.querySelector('.bt-open').textContent }; });
  ok('renamed, set to High and given a time — all saved', ed.title === 'Send the October ad creatives for review' && ed.prio === 'high' && ed.time === '16:30', ed);
  ok('High goes to the top of the day with a tag', ed.firstId === 'b' && ed.tag === 'High' && /October ad creatives/.test(ed.shown), ed);
  await p.evaluate(() => { const r = window.FlowRockActions.find('b').r; r.prio = 'low'; cSave(); window.FlowTodayBeta.paint(); }); await p.waitForTimeout(300);
  ok('Low sinks to the bottom, tagged', await p.evaluate(() => { const rows = [...document.querySelectorAll('#today-feed .bt-rows .bt-task:not(.done)')]; const last = rows[rows.length - 1]; return last.getAttribute('data-btid') === 'b' && /Low/.test(last.textContent); }));
  await p.evaluate(() => { const r = window.FlowRockActions.find('b').r; r.prio = 'med'; r.title = 'Send ad creatives for review'; r.time = '15:00'; cSave(); window.FlowTodayBeta.paint(); });
  ok('Advanced\'s sheet is unchanged: no edit fields there', await p.evaluate(async () => { await Flow.Settings.set('newLook', false); window.FlowTodayLook.applyLook(); window.FlowRockActions.open('b'); const hidden = document.querySelector('#flow-ra .ra-edit').hidden; window.FlowRockActions.close(); await Flow.Settings.set('newLook', true); window.FlowTodayLook.applyLook(); renderToday(); return hidden; }));
  await p.waitForTimeout(600);

  console.log('\n— Coming up opens a day —');
  const cu = await p.evaluate(() => { const b = document.querySelector('#flow-td-ahead .ah-plan'); return b && { label: b.textContent, date: b.getAttribute('data-ah-plan'), vis: getComputedStyle(b).display !== 'none' }; });
  if (cu) {
    await p.click('#flow-td-ahead .ah-plan'); await p.waitForTimeout(500);
    const picked = await p.evaluate((iso) => { const t = document.querySelector('#today-feed .bt-title').textContent; const d = new Date(iso + 'T12:00:00'); return { t, want: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) }; }, cu.date);
    ok('"Plan this day ›" on a Coming up day opens it in the plan', cu.vis && /Plan this day/.test(cu.label) && picked.t === picked.want, { cu, picked });
    await p.click('#today-feed [data-bt="today"]').catch(() => {}); await p.waitForTimeout(300);
  } else ok('(nothing in Coming up to open)', true);

  console.log('\n— Needs review —');
  if (!T.monday) {
    const rv = await p.evaluate(() => (document.querySelector('#today-feed .bt-review') || {}).textContent || '');
    ok('yesterday\'s open one is under "Needs review · 1"', /Needs review · 1/.test(rv), rv);
    await p.click('#today-feed .bt-review button'); await p.waitForTimeout(300);
    await p.click('#today-feed .bt-triage [data-tr="today"]'); await p.waitForTimeout(600);
    const mv = await p.evaluate(() => { const h = window.FlowRockActions.find('late'); return { day: h && h.r.day, today: (new Date().getDay() + 6) % 7, review: !!document.querySelector('#today-feed .bt-review'), listed: [...document.querySelectorAll('#today-feed .lk-bt-list .bt-open')].some((x) => /Onboard Ali/.test(x.textContent)) }; });
    ok('"Today" moves it to today, it joins today\'s list, and the review row goes', mv.day === mv.today && !mv.review && mv.listed, mv);
  } else ok('(Monday: nothing can be late this week)', true);

  console.log('\n— the week —');
  await p.click('#today-feed .lk-bt [data-bt="vweek"]'); await p.waitForTimeout(400);
  const wk = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); return { eyebrow: el.querySelector('.bt-eyebrow').textContent, groups: [...el.querySelectorAll('.bt-daygrp')].map((g) => g.textContent), sel: el.querySelectorAll('.lk-bt-day[aria-selected="true"]').length }; });
  ok('Week groups this week by day, with today marked', /Week plan/.test(wk.eyebrow) && wk.groups.some((g) => /· today/.test(g)) && wk.sel === 0, wk);
  await p.click('#today-feed .lk-bt [data-bt="next"]'); await p.waitForTimeout(400);
  const nx = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); return { eyebrow: el.querySelector('.bt-eyebrow').textContent, rows: [...el.querySelectorAll('.bt-open')].map((x) => x.textContent) }; });
  ok('› shows next week, with the one added a week ahead', /next week/.test(nx.eyebrow) && nx.rows.indexOf('Weekly review with the sales team') >= 0, nx);
  await p.click('#today-feed .lk-bt [data-bt="today"]'); await p.waitForTimeout(300);
  ok('← Today comes back to today\'s day view', await p.evaluate(() => /Daily plan · Today/.test(document.querySelector('#today-feed .bt-eyebrow').textContent)));
  await p.keyboard.press('Escape');
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press('7'); await p.waitForTimeout(300);
  ok('the 7 key picks Sunday on the strip', await p.evaluate(() => { const s = document.querySelector('#today-feed .lk-bt-day[aria-selected="true"]'); return !!s && /Sun/.test(s.textContent); }));

  console.log('\n— in other themes, and on a phone —');
  for (const th of ['paper', 'bloom', 'aurora', 'calm', 'bold', 'operator']) {
    await p.evaluate((t) => Flow.Theme.apply(t, false), th); await p.waitForTimeout(300);
    const c = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); return { bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el.querySelector('.bt-title')).color }; });
    ok(th + ': the panel takes the theme\'s surface and ink', c.bg !== 'rgba(0, 0, 0, 0)' && c.bg !== c.ink, c);
  }
  await p.evaluate(() => Flow.Theme.apply('signature', false));
  await p.setViewportSize({ width: 375, height: 812 }); await p.waitForTimeout(500);
  const ph = await p.evaluate(() => { const el = document.querySelector('#today-feed .lk-bt'); const r = el.getBoundingClientRect(); const days = [...el.querySelectorAll('.lk-bt-day')].map((d) => d.getBoundingClientRect()); return { w: r.width, right: r.right, vw: innerWidth, docW: document.documentElement.scrollWidth, fit: days.every((d) => d.right <= r.right + 1 && d.width >= 38), input: el.querySelector('.bt-comp input').getBoundingClientRect().height }; });
  ok('on a 375-wide phone it fits: no sideways scroll, all seven days visible, a tall enough field', ph.right <= ph.vw && ph.docW <= ph.vw && ph.fit && ph.input >= 44, ph);
  await p.setViewportSize({ width: 1280, height: 900 });

  console.log('\n— Advanced —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); renderToday(); }); await p.waitForTimeout(800);
  const adv = await p.evaluate(() => { const bt = document.querySelector('#today-feed .lk-bt'); return { attr: document.documentElement.getAttribute('data-today-beta'), panel: !!bt && getComputedStyle(bt).display !== 'none', rocks: getComputedStyle(document.querySelector('#today-feed .td-rocks')).display !== 'none', row: !document.getElementById('todayBetaRow') || getComputedStyle(document.getElementById('todayBetaRow')).display === 'none' }; });
  ok('Advanced never shows it: its Today is as it was', adv.attr === 'off' && !adv.panel && adv.rocks, adv);
  ok('with the tiles back in their old place there', await p.evaluate(() => { const t = document.querySelector('#today-feed > .flow-td-pulse'); return !!t && getComputedStyle(t).display !== 'none' && document.querySelectorAll('.flow-td-pulse').length === 1; }));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
