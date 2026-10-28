/* Click-through of the Simple interface: every control it adds or restyles
   must do its job, on a desktop and on a phone. */
const submitAuth = require('./submit-auth.js');
const { chromium, devices } = require('playwright');
const H = 'http://localhost:' + (process.env.PORT || 4222);
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const tab = (p) => p.evaluate(() => (document.querySelector('.tab.active') || {}).getAttribute && document.querySelector('.tab.active').getAttribute('data-tab'));
(async () => {
  const b = await chromium.launch();
  for (const kind of (process.env.KINDS || 'desktop,phone').split(',')) {
    console.log('\n===== ' + kind + ' =====');
    /* android: Chrome on a Pixel, as the Play Store app runs it — every
       press is a real tap (touch events first), not a mouse click. */
    const ctx = await b.newContext(kind === 'android' ? Object.assign({}, devices['Pixel 7'], process.env.LOCALE ? { locale: process.env.LOCALE } : {}) : kind !== 'desktop' ? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    if (kind === 'android') { const click = p.click.bind(p); p.click = (sel, o) => (/^#fa-/.test(sel) ? click(sel, o) : p.tap(sel, o)); }
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    p.on('dialog', (d) => d.accept());
    await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
    await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
    const code = await p.$('#fa-code'); if (code) await p.fill('#fa-code', 'letmein').catch(() => {});
    await submitAuth(p); await p.waitForTimeout(4500);
    await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); Flow.Nav.go('today'); }); await p.waitForTimeout(800);
    ok('Simple is on', await p.evaluate(() => document.documentElement.getAttribute('data-flow-look')) === 'new');
    const T = () => p.evaluate(() => Flow.Nav.go('today')).then(() => p.waitForTimeout(500));

    console.log('— Today —');
    await p.click('.lk-day[data-lk-day="2"]'); await p.waitForTimeout(500);
    const dv = await p.evaluate(() => { const v = document.querySelector('.lk-dayview'); return v && { n: v.querySelector('.lk-dv-n').textContent, rows: v.querySelectorAll('.lk-dv-row').length, sel: document.querySelector('.lk-day[data-lk-day="2"]').classList.contains('sel'), after: v.previousElementSibling.className }; });
    ok('a day in the strip opens that day right under it', !!dv && /Wednesday/.test(dv.n) && dv.sel && /lk-strip/.test(dv.after), dv);
    const wedRocks = await p.evaluate(() => Flow.TodayLook ? 0 : 0);
    await p.fill('.lk-dv-add input', 'Pack the mixer'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
    ok('a Big Rock typed there is added to that day', await p.evaluate(() => { const w = window.FlowTodayLook.rocks().find((r) => r.title === 'Pack the mixer'); return !!w && w.day === 2 && /Pack the mixer/.test(document.querySelector('.lk-dayview').textContent); }));
    ok('the box is ready for the next one', await p.evaluate(() => document.activeElement && document.activeElement.matches('.lk-dv-add input') && document.activeElement.value === ''));
    await p.click('.lk-dv-row:has-text("Pack the mixer") .lk-dv-bx'); await p.waitForTimeout(700);
    ok('ticking it there marks it done', await p.evaluate(() => window.FlowTodayLook.rocks().find((r) => r.title === 'Pack the mixer').done === true && document.querySelector('.lk-dv-row.done')));
    await p.click('.lk-dv-row:has-text("Pack the mixer") .lk-dv-bx'); await p.waitForTimeout(500);
    ok('and ticking again reopens it', await p.evaluate(() => window.FlowTodayLook.rocks().find((r) => r.title === 'Pack the mixer').done === false));
    await p.click('.lk-day[data-lk-day="2"]'); await p.waitForTimeout(400);
    ok('tapping the day again closes it', await p.evaluate(() => !document.querySelector('.lk-dayview')));
    await p.click('.lk-day[data-lk-day="5"]'); await p.waitForTimeout(400);
    await p.click('[data-dv="close"]'); await p.waitForTimeout(300);
    ok('and so does ×', await p.evaluate(() => !document.querySelector('.lk-dayview')));
    await p.click('.lk-day[data-lk-day="5"]'); await p.waitForTimeout(400);
    await p.click('[data-dv="week"]'); await p.waitForTimeout(600);
    ok('“Open the whole week” opens the week', await tab(p) === 'compass');
    await p.evaluate(() => { window.FlowTodayLook.sel = null; });
    await T();
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('.lk-hero'); await p.waitForTimeout(900);
    ok('the summary card takes you to the Big Rocks', await p.evaluate(() => { const r = document.querySelector('.td-rocks:not(#td-cal)').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
    const nextOk = await p.evaluate(() => { const n = (document.querySelector('.lk-next span') || {}).textContent || ''; const L = window.FlowTodayLook; const k = L.heroPick(L.rocks(), (new Date().getDay() + 6) % 7); return n.length > 3 && !!k.next && String(k.next.title).indexOf(n.replace('…', '').slice(0, 20)) === 0; });
    ok('Next names today\'s first open rock, else the one that slipped, else the next one', nextOk);
    const prog = () => p.evaluate(() => +((document.querySelector('.lk-prog') || { getAttribute: () => -1 }).getAttribute('aria-valuenow')));
    const p0 = await prog();
    const before = await p.evaluate(() => document.querySelectorAll('.td-rocks:not(#td-cal) .td-rock.done').length);
    await p.evaluate(() => { const d = document.querySelector('.td-rocks:not(#td-cal) .td-rock:not(.done) .dot'); d.scrollIntoView({ block: 'center' }); });
    await p.click('.td-rocks:not(#td-cal) .td-rock:not(.done) .dot'); await p.waitForTimeout(900);
    const after = await p.evaluate(() => document.querySelectorAll('.td-rocks:not(#td-cal) .td-rock.done').length);
    ok('ticking a Big Rock marks it done', after === before + 1, { before, after });
    ok('and the summary counts one more done', (await prog()) === p0 + 1, { p0, now: await prog() });
    const hb = await p.evaluate(() => { const r = document.querySelector('#flow-td-habits .flow-td-row:not(.done)'); return r ? r.textContent.trim().slice(0, 30) : null; });
    if (hb) {
      await p.evaluate(() => document.querySelector('#flow-td-habits .flow-td-row:not(.done) .flow-today-check').scrollIntoView({ block: 'center' }));
      await p.click('#flow-td-habits .flow-td-row:not(.done) .flow-today-check'); await p.waitForTimeout(800);
      ok('ticking a habit on Today counts it', await p.evaluate(() => /1 \/ \d/.test(document.querySelector('#flow-td-habits .flow-td-head .c').textContent)), await p.evaluate(() => document.querySelector('#flow-td-habits .flow-td-head .c').textContent));
    }
    for (const j of await p.evaluate(() => [...document.querySelectorAll('.flow-td-pulse [data-jump]')].map((x) => x.getAttribute('data-jump')))) {
      await T(); await p.evaluate(() => window.scrollTo(0, 0));
      await p.click('.flow-td-pulse [data-jump="' + j + '"]'); await p.waitForTimeout(700);
      const where = await tab(p);
      ok('the ' + j + ' tile goes somewhere useful', where !== 'today' || await p.evaluate(() => scrollY > 50 || !!document.querySelector('#flow-focus.on, .fn-sheetwrap.on, #flow-focus[open], .fc-on')), where);
      await p.keyboard.press('Escape'); await p.evaluate(() => { const f = document.querySelector('#flow-focus .fc-close, #flow-focus [data-fc="close"]'); if (f) f.click(); }); await p.waitForTimeout(200);
    }
    await T();
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('#today-feed .flow-today-primary'); await p.waitForTimeout(600);
    ok('Plan today opens', await p.evaluate(() => !!document.querySelector('.td-plan, #td-plan, .fn-sheetwrap.on, [id*="plan"].on')));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);

    /* Diet and Sharpen the Blade are not on Today in Simple: the first said
       nothing, the second is weekly and lives in the review. Advanced keeps
       both, exactly as they were. */
    await T();
    const groups = await p.evaluate(() => ['[data-diet]', '[data-saw]'].map((sel) => { const g = document.querySelector('#today-feed .td-group:has(' + sel + ')'); return g ? getComputedStyle(g).display : 'missing'; }));
    ok('Diet and Sharpen the Blade are off Today in Simple', groups.every((d) => d === 'none'), groups);
    /* which prices show is a setting: the Widgets row is off Today, the strip's note links to it */
    await p.evaluate(async () => { await Flow.Settings.set('todayMarkets', true); Flow.Markets.data = Flow.Markets.data || { quotes: {}, ageMs: 0, fxDate: '2026-10-27' }; Flow.Markets.paint(); }); await p.waitForTimeout(500);
    const wg = await p.evaluate(() => ({ row: getComputedStyle(document.querySelector('#td-widgets')).display, edit: !!document.querySelector('#flow-markets [data-mkt-edit]') && getComputedStyle(document.querySelector('#flow-markets .flow-mkt-editwrap')).display !== 'none' }));
    ok('the Widgets row is off Today; the price strip says "edit" instead', wg.row === 'none' && wg.edit, wg);
    await p.click('#flow-markets [data-mkt-edit]'); await p.waitForTimeout(900);
    ok('edit opens Settings, at the Today card', await p.evaluate(() => document.querySelector('.tab.active') && document.querySelector('.tab.active').getAttribute('data-tab') === 'settings' && !!document.querySelector('#todayCard [data-s="todayMarkets"]')));
    await p.evaluate(async () => { await Flow.Settings.set('todayMarkets', false); Flow.Markets.paint(); Flow.Nav.go('today'); }); await p.waitForTimeout(500);
    await p.evaluate(() => Flow.TodayPlus.reviewSheet()); await p.waitForTimeout(500);
    const saw0 = await p.evaluate(() => { const b = document.querySelectorAll('#rv-evidence [data-rv-saw]'); return { n: b.length, on: [...b].filter((x) => x.classList.contains('on')).length }; });
    ok('the week\'s review carries the Blade: eight ticks', saw0.n === 8, saw0);
    await p.click('#rv-evidence [data-rv-saw]:not(.on)'); await p.waitForTimeout(300);
    const saw1 = await p.evaluate(() => ({ on: document.querySelectorAll('#rv-evidence [data-rv-saw].on').length, data: Object.keys((cData.saw || {})[weekId(new Date())] || {}).length, sub: document.querySelector('#rv-evidence .ra-k small').textContent }));
    ok('a tick there counts for the week', saw1.on === saw0.on + 1 && saw1.data === saw1.on && saw1.sub === saw1.on + ' of 8 this week', saw1);
    await p.click('#rv-evidence [data-rv-saw].on'); await p.waitForTimeout(300);
    ok('and unticks', (await p.evaluate(() => document.querySelectorAll('#rv-evidence [data-rv-saw].on').length)) === saw0.on);
    await p.evaluate(() => document.getElementById('flow-review').classList.remove('on'));
    await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); Flow.Nav.go('today'); renderToday(); }); await p.waitForTimeout(700);
    ok('Advanced still has both groups on Today', await p.evaluate(() => ['[data-diet]', '[data-saw]'].every((sel) => { const g = document.querySelector('#today-feed .td-group:has(' + sel + ')'); return g && getComputedStyle(g).display !== 'none'; })));
    await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); Flow.Nav.go('today'); renderToday(); }); await p.waitForTimeout(700);

    console.log('— + / Add —');
    const openAdd = async () => { if (kind !== 'desktop') await p.click('#fn-capbtn'); else await p.click('#fn-sideadd'); await p.waitForTimeout(350); };
    await T(); await openAdd();
    ok('the + opens the add menu', await p.evaluate(() => document.getElementById('flow-capture').classList.contains('on')));
    const items = await p.evaluate(() => [...document.querySelectorAll('#flow-capture [data-fn-cap]')].map((x) => x.getAttribute('data-fn-cap')));
    ok('with every kind of entry', ['note', 'quad', 'finance', 'training', 'habits', 'diet', 'sleep'].every((x) => items.includes(x)), items);
    if (kind !== 'desktop') { await p.click('#fn-capbtn'); await p.waitForTimeout(300); ok('and the same + closes it', await p.evaluate(() => !document.getElementById('flow-capture').classList.contains('on'))); await openAdd(); }
    await p.click('#flow-capture [data-fn-cap="note"]'); await p.waitForTimeout(300);
    const nJ = await p.evaluate(() => Flow.Journal.entries.length);
    await p.fill('#fn-noteinput', 'A quick note from Simple');
    await p.click('#fn-notesave'); await p.waitForTimeout(800);
    ok('a note is saved to the journal', await p.evaluate((n) => Flow.Journal.entries.length === n + 1 && Flow.Journal.entries.some((e) => e.body === 'A quick note from Simple'), nJ));
    const go = { quad: 'compass', finance: 'finance', training: 'training', habits: 'habits', diet: 'sleep', sleep: 'sleep' };
    for (const id of Object.keys(go)) {
      await T(); await openAdd();
      await p.click('#flow-capture [data-fn-cap="' + id + '"]'); await p.waitForTimeout(600);
      ok('+ ' + id + ' opens ' + go[id], await tab(p) === go[id], await tab(p));
    }

    console.log('— pages —');
    await p.evaluate(() => Flow.Nav.go('finance')); await p.waitForTimeout(500);
    const amt = await p.$('#tab-finance input[type="number"]');
    await p.click('#fl-mask-btn'); await p.waitForTimeout(300);
    ok('Hide numbers blurs the figures', await p.evaluate(() => document.documentElement.classList.contains('fl-hide-money') && getComputedStyle(document.querySelector('#tab-finance [data-flm]')).filter.includes('blur')));
    await p.click('#fl-mask-btn'); await p.waitForTimeout(300);
    ok('and shows them again', await p.evaluate(() => !document.documentElement.classList.contains('fl-hide-money')));
    await p.evaluate(() => Flow.Nav.go('habits')); await p.waitForTimeout(500);
    const hin = await p.$('#tab-habits input[type="text"], #tab-habits input:not([type])');
    if (hin) { await hin.fill('Stretch 5 min'); await p.keyboard.press('Enter'); await p.waitForTimeout(600); }
    ok('a habit can be added', await p.evaluate(() => /Stretch 5 min/.test(document.getElementById('tab-habits').textContent)));
    await p.evaluate(() => Flow.Nav.go('quad')); await p.waitForTimeout(500);
    const qin = await p.$('#tab-quad input[type="text"], #tab-quad input:not([type])');
    if (qin) { await qin.fill('Call the venue'); await p.keyboard.press('Enter'); await p.waitForTimeout(600); }
    ok('a priority can be added', await p.evaluate(() => /Call the venue/.test(document.getElementById('tab-quad').textContent)));
    await p.evaluate(() => Flow.Nav.go('training')); await p.waitForTimeout(500);
    const md = await p.$('#tab-training button:has-text("Mark done")');
    if (md) { await md.click(); await p.waitForTimeout(600); }
    ok('a training day can be marked done', await p.evaluate(() => /1\/\d|1 \/ \d/.test(document.getElementById('tab-training').textContent.replace(/\s+/g, ' ').slice(0, 300))), await p.evaluate(() => document.getElementById('tab-training').textContent.replace(/\s+/g, ' ').slice(0, 80)));

    console.log('— moving around —');
    if (kind === 'desktop') {
      await p.keyboard.press('Meta+k'); await p.waitForTimeout(300);
      if (!await p.evaluate(() => document.getElementById('flow-pal').classList.contains('on'))) { await p.keyboard.press('Control+k'); await p.waitForTimeout(300); }
      ok('⌘K opens search', await p.evaluate(() => document.getElementById('flow-pal').classList.contains('on')));
      await p.keyboard.type('north'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
      ok('and Enter goes there', await tab(p) === 'northstar', await tab(p));
      for (const t of ['northstar', 'quad', 'compass', 'abko', 'dtc', 'training', 'sleep', 'habits', 'journal', 'finance', 'ask', 'today']) {
        await p.click('#flow-side [data-fn-side="' + t + '"]'); await p.waitForTimeout(250);
        if (await tab(p) !== t) ok('sidebar → ' + t, false, await tab(p));
      }
      ok('every sidebar link opens its page', true);
    } else {
      for (const g of ['focus', 'body', 'record', 'today']) {
        await p.click('#flow-tabbar [data-fn-group="' + g + '"]'); await p.waitForTimeout(400);
        const segs = await p.evaluate(() => [...document.querySelectorAll('#flow-seg [data-fn-seg]')].filter((x) => x.offsetParent).map((x) => x.getAttribute('data-fn-seg')));
        for (const s of segs) { await p.click('#flow-seg [data-fn-seg="' + s + '"]'); await p.waitForTimeout(250); if (await tab(p) !== s) ok('segment → ' + s, false, await tab(p)); }
        if (g !== 'today') ok('the ' + g + ' tab and its ' + segs.length + ' segments all open', segs.length >= 2, segs);
      }
    }
    await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(400);
    const rocksBefore = await p.evaluate(() => document.querySelectorAll('.td-rocks:not(#td-cal) .td-rock.done').length);
    if (kind === 'desktop') { await p.click('[data-fn-ui="advanced"]'); } else { await p.click('#fn-avatar'); await p.waitForTimeout(300); await p.click('[data-fn-act="ui-advanced"]'); }
    await p.waitForTimeout(700);
    ok('switching to Advanced keeps what you did', await p.evaluate(() => document.documentElement.getAttribute('data-flow-look') === 'classic' && Flow.Journal.entries.some((e) => e.body === 'A quick note from Simple')) && rocksBefore === await p.evaluate(() => document.querySelectorAll('#today-feed .td-rocks:not(#td-cal) .td-rock.done').length));
    ok('no page errors', errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
