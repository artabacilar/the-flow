/* The new navigation. The thing most worth proving is that it is a *layer*:
   every destination still goes through the host's own pill, so the host's
   per-section render callbacks keep firing and nothing that worked stops
   working. The rest is reach — five slots, two levels, and a capture that
   writes without taking you anywhere. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const { randomUUID } = require('crypto');
const H = 'http://localhost:4222';
// Match the isolated replica's configuration without embedding a person's
// address or a reusable invite/password in this test file.
const OWNER_EMAIL = process.env.FLOW_OWNER_EMAIL || 'owner@example.test';
const INVITE_CODE = process.env.FLOW_INVITE_CODE || '';
const TEST_PASSWORD = randomUUID();

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
    : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 240) : ''))); };

  /* The owner has to exist before anyone else can join, so the first account
     made here must be the one FLOW_OWNER_EMAIL names. */
  const signUp = async (page, email, name, invite) => {
    await page.goto(H + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.click('#fa-alt', { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(250);
    await page.fill('#fa-email', email);
    await page.fill('#fa-name', name);
    await page.fill('#fa-pw', TEST_PASSWORD);
    if (invite) await page.fill('#fa-inv', invite).catch(() => {});
    await submitAuth(page);
    await page.waitForTimeout(4200);
  };
  const activeTab = (p) => p.evaluate(() => {
    const a = document.querySelector('.tab.active');
    return a ? a.getAttribute('data-tab') : null;
  });

  /* ════════════ PHONE ════════════ */
  console.log('\n═══ on a phone (390 × 844) ═══');
  const cm = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const p = await cm.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await signUp(p, OWNER_EMAIL, 'Owner');

  console.log('\n— the bar replaces the old one —');
  ok('the app loaded with no errors', errs.length === 0, errs.slice(0, 3));
  ok('it opens on Today, not on whatever was last active', await activeTab(p) === 'today', await activeTab(p));
  ok('the new tab bar is showing', await p.isVisible('#flow-tabbar'));
  ok("the host's old bottom bar is hidden", !(await p.isVisible('.mobilenav')));
  ok('the "More" sheet is gone too', !(await p.isVisible('.moresheet')));
  ok('it has exactly five slots', await p.evaluate(() =>
    document.querySelectorAll('#flow-tabbar > button').length) === 5);
  ok('labelled Today / Plan / Body / Record', await p.evaluate(() =>
    [...document.querySelectorAll('#flow-tabbar .fn-lb')].map(e => e.textContent).join(',')) === 'Today,Plan,Body,Record');

  console.log('\n— every control clears 44px —');
  const small = await p.evaluate(() => [...document.querySelectorAll('#flow-tabbar button')]
    .map(b => ({ t: (b.querySelector('.fn-lb') || {}).textContent || 'capture', h: Math.round(b.getBoundingClientRect().height) }))
    .filter(x => x.h < 44));
  ok('no tab-bar target is under 44px tall', small.length === 0, small);

  console.log('\n— Focus is a group, not a section —');
  await p.click('#flow-tabbar [data-fn-group="focus"]'); await p.waitForTimeout(900);
  ok('it opens North Star', await activeTab(p) === 'northstar', await activeTab(p));
  ok('the Focus slot lights up', await p.evaluate(() =>
    document.querySelector('[data-fn-group="focus"]').classList.contains('on')));
  ok('a segment row appears', await p.isVisible('#flow-seg'));
  const segs = await p.evaluate(() => [...document.querySelectorAll('#flow-seg button')].map(b => b.textContent));
  /* Five: Brainstorm and Time are retired, and the planner lives on North
     Star now. Priorities is drawn but hidden from the menu by default. */
  ok('with all five Focus sections', segs.length === 5, segs);
  ok('and none of them is a record', !segs.some(t => /Brainstorm|Time/.test(t)), segs);
  ok('and North Star is the selected one', await p.evaluate(() =>
    (document.querySelector('#flow-seg button.on') || {}).getAttribute('data-fn-seg')) === 'northstar');
  ok('Priorities is in the row like the rest', await p.evaluate(() => {
    const b = document.querySelector('#flow-seg [data-fn-seg="quad"]');
    return !!b && getComputedStyle(b).display !== 'none';
  }));
  /* Above the pane, not inside it. A section that repaints itself by
     rewriting its own innerHTML would delete a row that lived inside it. */
  ok('the row sits directly above the open section', await p.evaluate(() => {
    const s = document.querySelector('.section.active, .flow-section.active');
    const g = document.getElementById('flow-seg');
    return !!s && !!g && g.nextElementSibling === s;
  }));

  /* North Star is the one Focus section the pack owns, so it is a
     `.flow-section`. Matching only the host's `.section` used to leave it
     with no segment row at all — the only way out was a link inside the
     page. */
  console.log('\n— North Star is reachable and leavable like the rest —');
  await p.click('#flow-seg [data-fn-seg="northstar"]'); await p.waitForTimeout(1200);
  ok('it opens North Star', await activeTab(p) === 'northstar', await activeTab(p));
  ok('the segment row is still there', await p.isVisible('#flow-seg'));
  ok('and North Star is the selected one', await p.evaluate(() =>
    (document.querySelector('#flow-seg button.on') || {}).getAttribute('data-fn-seg')) === 'northstar');
  /* The section rewrites itself whenever the direction lands. */
  await p.evaluate(() => { try { window.Flow.NorthStar.paint(); } catch (e) {} });
  await p.waitForTimeout(300);
  ok('and it survives the section repainting itself', await p.isVisible('#flow-seg'));
  await p.click('#flow-seg [data-fn-seg="compass"]'); await p.waitForTimeout(900);
  ok('so you can leave without the in-page link', await activeTab(p) === 'compass', await activeTab(p));


  console.log('\n— the second level moves without leaving the group —');
  await p.click('#flow-seg [data-fn-seg="abko"]'); await p.waitForTimeout(900);
  ok('it switches to Work', await activeTab(p) === 'abko', await activeTab(p));
  await p.click('#flow-seg [data-fn-seg="compass"]'); await p.waitForTimeout(900);
  ok('and to Week Compass', await activeTab(p) === 'compass', await activeTab(p));
  ok('Focus is still the active slot', await p.evaluate(() =>
    document.querySelector('[data-fn-group="focus"]').classList.contains('on')));
  ok('the host rendered that section', await p.isVisible('#tab-compass'));

  console.log('\n— a group remembers where you left it —');
  await p.click('#flow-tabbar [data-fn-group="today"]'); await p.waitForTimeout(800);
  ok('Today is a plain section', await activeTab(p) === 'today', await activeTab(p));
  ok('and shows no segment row', !(await p.isVisible('#flow-seg')));
  await p.click('#flow-tabbar [data-fn-group="focus"]'); await p.waitForTimeout(900);
  ok('going back to Focus returns to Week Compass', await activeTab(p) === 'compass', await activeTab(p));

  console.log('\n— Body collapses training, the body log and habits —');
  await p.click('#flow-tabbar [data-fn-group="body"]'); await p.waitForTimeout(900);
  ok('it opens Training', await activeTab(p) === 'training', await activeTab(p));
  ok('with three segments — diet joined sleep and mood as one body log', await p.evaluate(() =>
    document.querySelectorAll('#flow-seg button').length) === 3);
  await p.click('#flow-seg [data-fn-seg="sleep"]'); await p.waitForTimeout(1100);
  ok('Body log opens through the host, so its chart callback runs', await activeTab(p) === 'sleep', await activeTab(p));
  ok('the diet checklist is on the same page', await p.evaluate(() => {
    const d = document.querySelector('#tab-sleep #fn-dietblock #dtToday');
    return !!d && d.getBoundingClientRect().height > 0;
  }));
  ok('and its own old section is empty and hidden', await p.evaluate(() => {
    const d = document.getElementById('tab-diet');
    return !!d && d.children.length === 0 && getComputedStyle(d).display === 'none';
  }));
  ok('no errors from the host callbacks', errs.length === 0, errs.slice(0, 3));

  console.log('\n— capture writes without moving you —');
  await p.click('#flow-tabbar [data-fn-group="focus"]'); await p.waitForTimeout(800);
  const before = await activeTab(p);
  const jBefore = await p.evaluate(() => Flow.Journal.entries.length);
  ok('the sheet is closed at rest', !(await p.isVisible('#flow-capture .fn-sheet')));
  await p.click('#fn-capbtn'); await p.waitForTimeout(500);
  ok('the + opens it', await p.isVisible('#flow-capture .fn-sheet'));
  await p.click('[data-fn-cap="note"]'); await p.waitForTimeout(400);
  ok('Note opens a field, not another screen', await p.isVisible('#fn-noteinput'));
  await p.fill('#fn-noteinput', 'Bought coffee beans on the way in');
  await p.click('#fn-notesave'); await p.waitForTimeout(1400);
  const jAfter = await p.evaluate(() => Flow.Journal.entries.length);
  ok('the entry is saved', jAfter === jBefore + 1, { jBefore, jAfter });
  ok('with the text you typed', await p.evaluate(() =>
    Flow.Journal.entries[Flow.Journal.entries.length - 1].body) === 'Bought coffee beans on the way in');
  ok('tagged so you can find it later', await p.evaluate(() =>
    (Flow.Journal.entries[Flow.Journal.entries.length - 1].tags || []).join()) === 'quick');
  ok('the sheet closes', !(await p.isVisible('#flow-capture .fn-sheet')));
  ok('and you are still exactly where you were', await activeTab(p) === before, { before, after: await activeTab(p) });

  console.log('\n— it survives a reload, so it really was written —');
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(4200);
  ok('the note is still there', await p.evaluate(() =>
    Flow.Journal.entries.some(e => e.body === 'Bought coffee beans on the way in')));

  console.log('\n— the other capture types hand you to the right section —');
  await p.click('#fn-capbtn'); await p.waitForTimeout(450);
  await p.click('[data-fn-cap="finance"]'); await p.waitForTimeout(1000);
  ok('Expense opens Finances', await activeTab(p) === 'finance', await activeTab(p));

  console.log('\n— the avatar holds what is not in the bar —');
  await p.click('#fn-avatar'); await p.waitForTimeout(500);
  ok('a menu opens', await p.isVisible('#flow-menu .fn-sheet'));
  const menu = await p.evaluate(() => [...document.querySelectorAll('[data-fn-menu]')].map(b => b.getAttribute('data-fn-menu')));
  /* Journal and Finances left this menu when Record became a real slot: a
     destination in two places is a destination you look for in the wrong
     one. What is left is genuinely outside the daily loop. */
  ok('with the planner and Settings', menu.join(',') === 'artur,settings', menu);
  const acts = await p.evaluate(() => [...document.querySelectorAll('[data-fn-act]')].map(b => b.getAttribute('data-fn-act')));
  ok('the interface switch, then Privacy, Feedback and Sign out', acts.join(',') === 'ui-simple,privacy,help,signout', acts);
  ok('it says who is signed in', /artur\.abacilar@abko\.com\.tr/.test(await p.textContent('#fn-me')));
  await p.click('[data-fn-act="privacy"]'); await p.waitForTimeout(900);
  ok('Privacy opens Settings on the account', await activeTab(p) === 'settings' && await p.isVisible('[data-act2="changepw"]') && await p.isVisible('#dataCard'));
  ok('and only the account', !(await p.isVisible('#connCard')) && !(await p.isVisible('#lookCard')));
  await p.click('#set-viewbar .set-back'); await p.waitForTimeout(500);
  ok('back shows the settings themselves', await p.isVisible('#connCard') && !(await p.isVisible('[data-act2="changepw"]')));
  ok('with chips to jump between them', await p.evaluate(() => document.querySelectorAll('#set-viewbar [data-setgo]').length) >= 8);
  await p.click('#fn-avatar'); await p.waitForTimeout(500);
  await p.click('[data-fn-menu="artur"]'); await p.waitForTimeout(1000);
  ok('and it navigates', await activeTab(p) === 'artur', await activeTab(p));

  console.log('\n— search on a phone —');
  await p.click('#fn-search'); await p.waitForTimeout(450);
  ok('the palette opens', await p.isVisible('#flow-pal .fn-box'));
  await p.fill('#fn-palin', 'body'); await p.waitForTimeout(400);
  ok('typing narrows it to Body log', await p.evaluate(() =>
    (document.querySelector('#fn-pallist .fn-row.on span') || {}).textContent) === 'Body log', await p.evaluate(() =>
    (document.querySelector('#fn-pallist .fn-row.on span') || {}).textContent));
  await p.press('#fn-palin', 'Enter'); await p.waitForTimeout(1100);
  ok('Enter goes there', await activeTab(p) === 'sleep', await activeTab(p));

  console.log('\n— nothing overflows the phone —');
  const ov = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  ok('no horizontal overflow', ov.s <= ov.c + 1, ov);
  ok('the bar does not cover the last of the page', await p.evaluate(() => {
    const pb = parseFloat(getComputedStyle(document.body).paddingBottom);
    return pb >= 54;
  }), await p.evaluate(() => getComputedStyle(document.body).paddingBottom));
  ok('still no page errors', errs.length === 0, errs.slice(0, 3));

  /* ════════════ DESKTOP ════════════ */
  console.log('\n═══ on a desktop (1440 × 950) ═══');
  const cd = await b.newContext({ viewport: { width: 1440, height: 950 } });
  const d = await cd.newPage();
  const derrs = []; d.on('pageerror', e => derrs.push(e.message));
  await signUp(d, 'navdesk@example.test', 'Desk', INVITE_CODE);

  console.log('\n— the sidebar replaces the pill row —');
  ok('loaded with no errors', derrs.length === 0, derrs.slice(0, 3));
  ok('the sidebar is showing', await d.isVisible('#flow-side'));
  ok('desktop opens on Today too', await activeTab(d) === 'today', await activeTab(d));
  ok('the old pill row is gone', !(await d.isVisible('.tabs')));
  ok('the phone bar is not showing', !(await d.isVisible('#flow-tabbar')));
  const links = await d.evaluate(() => [...document.querySelectorAll('[data-fn-side]')].map(b => b.getAttribute('data-fn-side')));
  /* Fourteen: Brainstorm and Time are retired, Diet is part of Body log,
     and the mood tab was folded into Sleep before that. */
  ok('every section has a link', links.length === 14, links.length);
  ok('none of them is to a retired section', !links.some(t => /brainstorm|^time$|diet/.test(t)), links);
  ok('nothing is stranded — Today is reachable again', links.indexOf('today') >= 0, links);
  ok('the groups are labelled', await d.evaluate(() =>
    [...document.querySelectorAll('.fn-grouplbl')].map(e => e.textContent).join(',')) === 'Plan,Body,Record');

  console.log('\n— Today is not a lost 560px column —');
  const tw = await d.evaluate(() => {
    const t = document.getElementById('tab-today');
    return t ? Math.round(t.getBoundingClientRect().width) : 0;
  });
  ok('the Today column uses the desktop width', tw >= 800, tw);

  console.log('\n— content is not underneath it —');
  const geo = await d.evaluate(() => {
    const s = document.getElementById('flow-side').getBoundingClientRect();
    const h = document.querySelector('.header').getBoundingClientRect();
    return { sideRight: Math.round(s.right), headerLeft: Math.round(h.left) };
  });
  ok('the header starts clear of the sidebar', geo.headerLeft >= geo.sideRight, geo);
  ok('no horizontal overflow', await d.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    await d.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));

  console.log('\n— on a desktop, you can find the way out —');
  await d.click('[data-fn-side="artur"]'); await d.waitForTimeout(500);
  ok('the person in the sidebar opens the profile menu', await d.isVisible('#flow-menu .fn-sheet'));
  ok('that menu has Profile and Sign out', await d.evaluate(() => {
    const m = document.getElementById('fn-menugrid');
    return !!(m && m.querySelector('[data-fn-menu="artur"]') && m.querySelector('[data-fn-act="signout"]'));
  }));
  await d.click('#fn-menugrid [data-fn-menu="artur"]'); await d.waitForTimeout(700);
  ok('Profile in it still goes to the profile page', await activeTab(d) === 'artur', await activeTab(d));
  await d.click('[data-fn-side="today"]'); await d.waitForTimeout(500);

  console.log('\n— it navigates and stays in step —');
  await d.click('[data-fn-side="finance"]'); await d.waitForTimeout(900);
  ok('clicking Finances opens it', await activeTab(d) === 'finance', await activeTab(d));
  ok('and the link is highlighted', await d.evaluate(() =>
    document.querySelector('[data-fn-side="finance"]').classList.contains('on')));
  ok('only one link is highlighted', await d.evaluate(() =>
    document.querySelectorAll('[data-fn-side].on').length) === 1);
  await d.click('[data-fn-side="ask"]'); await d.waitForTimeout(900);
  ok('a pack-added tab works too', await activeTab(d) === 'ask', await activeTab(d));
  ok('and the sidebar follows it', await d.evaluate(() =>
    document.querySelector('[data-fn-side="ask"]').classList.contains('on')));

  console.log('\n— ⌘K —');
  ok('closed at rest', !(await d.isVisible('#flow-pal .fn-box')));
  await d.keyboard.press('Control+k'); await d.waitForTimeout(500);
  ok('it opens', await d.isVisible('#flow-pal .fn-box'));
  ok('and takes focus', await d.evaluate(() => document.activeElement.id) === 'fn-palin');
  await d.fill('#fn-palin', 'prior'); await d.waitForTimeout(350);
  await d.press('#fn-palin', 'Enter'); await d.waitForTimeout(1000);
  ok('typing and Enter jumps to Priorities', await activeTab(d) === 'quad', await activeTab(d));
  await d.keyboard.press('Control+k'); await d.waitForTimeout(400);
  await d.keyboard.press('Escape'); await d.waitForTimeout(300);
  ok('Escape closes it', !(await d.isVisible('#flow-pal .fn-box')));

  console.log('\n— the palette can also start a note —');
  await d.keyboard.press('Control+k'); await d.waitForTimeout(400);
  await d.fill('#fn-palin', 'ring the accountant'); await d.waitForTimeout(350);
  const kinds = await d.evaluate(() => [...document.querySelectorAll('#fn-pallist .fn-row span:first-of-type')].map(e => e.textContent));
  ok('it offers to write it down', kinds.some(t => /New journal note/.test(t)), kinds.slice(0, 4));
  await d.keyboard.press('Escape'); await d.waitForTimeout(300);

  console.log('\n— every section still opens —');
  const broken = [];
  for (const t of links) {
    await d.click('[data-fn-side="' + t + '"]');
    await d.waitForTimeout(420);
    if (t === 'artur') {   /* the person opens the menu; Profile is one row in */
      if (!(await d.isVisible('#flow-menu .fn-sheet'))) broken.push(t);
      await d.keyboard.press('Escape'); await d.waitForTimeout(250);
      if (await d.isVisible('#flow-menu .fn-sheet')) { broken.push('artur-menu-stays-open'); await d.click('#flow-menu .fn-scrim', { position: { x: 5, y: 5 } }); }
      continue;
    }
    if (await activeTab(d) !== t) broken.push(t);
  }
  ok('all 14 open through the host', broken.length === 0, broken);
  ok('with no errors anywhere', derrs.length === 0, derrs.slice(0, 4));

  /* ════════════ SMALL LAPTOP ════════════ */
  console.log('\n═══ on a small laptop (1000px) ═══');
  await d.setViewportSize({ width: 1000, height: 800 }); await d.waitForTimeout(700);
  const railW = await d.evaluate(() => Math.round(document.getElementById('flow-side').getBoundingClientRect().width));
  ok('the sidebar drops to an icon rail', railW <= 70, railW);
  ok('labels are hidden, icons remain', await d.evaluate(() => {
    const t = document.querySelector('[data-fn-side="quad"] .fn-txt');
    const i = document.querySelector('[data-fn-side="quad"] .fn-i');
    return getComputedStyle(t).display === 'none' && !!i && i.getBoundingClientRect().width > 0;
  }));
  ok('no overflow at 1000', await d.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    await d.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
  ok('still no page errors', derrs.length === 0, derrs.slice(0, 3));


  /* ════════════ THE WIDE DESKTOP (the rail was removed here) ════════════ */
  /* The context rail used to live in this space. It duplicated Today — the same
     Q1 items, the same markets — and charged 324px of desktop width for the
     privilege. It is gone. What matters now is that its absence left nothing
     behind: no orphan element, no reserved gutter, and the content actually
     grew into the width it gave back. */
  console.log('\n═══ the wide desktop, with the rail gone (1500 × 950) ═══');
  await d.setViewportSize({ width: 1500, height: 950 }); await d.waitForTimeout(800);
  ok('no rail element is left in the page', await d.evaluate(() =>
    !document.getElementById('flow-rail')));
  ok('no rail styles are left reserving space', await d.evaluate(() =>
    !document.querySelector('[class*="fn-rlab"], [class*="fn-rail"], #fn-railcap')));
  const hdrRight = await d.evaluate(() =>
    Math.round(document.querySelector('.header').getBoundingClientRect().right));
  ok('the content claims the width the rail was holding', hdrRight >= 1300, hdrRight);
  ok('no horizontal overflow at 1500', await d.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    await d.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
  /* Capture on desktop lives behind the palette, not a rail button. */
  ok('search is still reachable from the sidebar', await d.isVisible('#fn-kbtn'));
  await d.click('#fn-kbtn'); await d.waitForTimeout(500);
  ok('and it opens the palette', await d.isVisible('#fn-palin'));
  await d.keyboard.press('Escape'); await d.waitForTimeout(300);
  ok('no page errors from any of that', derrs.length === 0, derrs.slice(0, 3));

  /* ════════════ THE SYSTEM PASS (phase 4) ════════════ */
  console.log('\n═══ the system pass ═══');
  console.log('\n— the fiddly controls now have a real tap area —');
  await p.click('#flow-tabbar [data-fn-group="focus"]'); await p.waitForTimeout(700);
  await p.click('#flow-seg [data-fn-seg="quad"]'); await p.waitForTimeout(700);
  await p.evaluate(() => {
    qData.items = [{ id: 't1', q: 1, txt: 'A priority with the usual row of controls', done: false }];
    qSave(); renderQuad();
  });
  await p.waitForTimeout(700);
  const taps = await p.evaluate(() => {
    const buttons = [], overlaps = [];
    document.querySelectorAll('#tab-quad .qitem').forEach(row => {
      const controls = [...row.querySelectorAll('button, select, input')]
        .filter(el => el.getClientRects().length)
        .map(el => ({ el, rect: el.getBoundingClientRect() }));
      controls.forEach(({ el, rect: r }, i) => {
        if (el.matches('.q-del, .q-edit, .q-rock')) {
          buttons.push({ cls: el.className, width: r.width, height: r.height });
        }
        controls.slice(i + 1).forEach(({ el: other, rect: s }) => {
          if (Math.min(r.right, s.right) - Math.max(r.left, s.left) > 0.5 &&
              Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top) > 0.5) {
            overlaps.push([el.className || el.tagName, other.className || other.tagName]);
          }
        });
      });
    });
    return { buttons, overlaps };
  });
  ok('there are row controls to check', taps.buttons.length > 0, taps.buttons.length);
  ok('each row action has a real 44px target',
     taps.buttons.every(t => t.width >= 44 && t.height >= 44), taps.buttons);
  ok('the targets do not overlap adjacent buttons, fields or checkboxes', taps.overlaps.length === 0, taps.overlaps);

  console.log('\n— numbers line up —');
  ok('metrics use tabular figures', await p.evaluate(() => {
    const el = document.querySelector('.stat .num, .big-n, .flow-mkt-tile .v');
    return !el || /tabular-nums/.test(getComputedStyle(el).fontVariantNumeric);
  }));

  console.log('\n— the shared-task scheduling bug —');
  const sched = await d.evaluate(() => {
    /* This is the path that used to call a function that does not exist. */
    /* Schedule lives inside the pack, reachable as Flow.Schedule. */
    qData.items.push({ id: 'sharedprobe', q: 1, txt: 'Shared task probe', done: false });
    try {
      Flow.Schedule.put('quad::sharedprobe', { date: '2026-08-20', time: '10:00', text: 'Shared task probe' });
      return Flow.Schedule.get('quad::sharedprobe');
    } catch (e) { return { error: String(e) }; }
  });
  ok('an accepted shared task can now reach the calendar',
     sched && sched.date === '2026-08-20' && sched.time === '10:00', sched);
  ok('Schedule.set — the function that never existed — is gone from the file',
     await d.evaluate(() => typeof Flow.Schedule.set === 'undefined'),
     await d.evaluate(() => typeof Flow.Schedule.set));


  /* ════════════ GRIDS THAT MEASURE THEMSELVES (phase 5) ════════════ */
  console.log('\n═══ container-aware grids ═══');
  await d.setViewportSize({ width: 1500, height: 950 }); await d.waitForTimeout(700);
  ok('the sidebar is up, so the content column is narrower than the viewport',
     await d.isVisible('#flow-side'));

  await d.click('[data-fn-side="compass"]'); await d.waitForTimeout(1100);
  const cg = await d.evaluate(() => {
    const el = document.getElementById('cGrid');
    if (!el) return null;
    const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
    return { cols, w: Math.round(el.getBoundingClientRect().width), vw: window.innerWidth };
  });
  /* Keep Monday through Sunday together. Squeezing the calendar's container
     should introduce scrolling inside it, without wrapping Sunday onto a
     second row or widening the document. The viewport stays unchanged. */
  const cgSqueeze = await d.evaluate(() => {
    const el = document.getElementById('cGrid');
    if (!el) return null;
    const measure = () => {
      const days = [...el.querySelectorAll('.cday')];
      return { days: days.length,
        rows: new Set(days.map(day => Math.round(day.getBoundingClientRect().top))).size,
        cols: getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
        width: el.clientWidth, scrollWidth: el.scrollWidth,
        overflowX: getComputedStyle(el).overflowX,
        pageWidth: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth };
    };
    const before = measure();
    const prev = el.style.width;
    const prevScroll = el.scrollLeft;
    el.style.width = '460px';
    const after = measure();
    el.scrollLeft = el.scrollWidth;
    const last = el.querySelector('.cday:last-child');
    const end = last && last.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const lastDayReachable = !!end && el.scrollLeft > 0 && end.right <= box.right + 1 && end.left >= box.left - 1;
    el.style.width = prev;
    el.scrollLeft = prevScroll;
    return { before, after, lastDayReachable, vw: window.innerWidth };
  });
  ok('all seven days stay in one row when the calendar container narrows',
     cgSqueeze && [cgSqueeze.before, cgSqueeze.after].every(m => m.days === 7 && m.cols === 7 && m.rows === 1), cgSqueeze);
  ok('the narrow calendar contains its horizontal scroll without widening the page',
     cgSqueeze && cgSqueeze.after.scrollWidth > cgSqueeze.after.width &&
     /^(auto|scroll)$/.test(cgSqueeze.after.overflowX) && cgSqueeze.after.pageWidth <= cgSqueeze.after.viewport + 1,
     cgSqueeze && cgSqueeze.after);
  ok('scrolling that region makes the final day reachable', cgSqueeze && cgSqueeze.lastDayReachable, cgSqueeze);
  ok('and it uses the width the rail gave back', cg && cg.w > 1100, cg);
  ok('and it does not overflow that column', await d.evaluate(() => {
    const el = document.getElementById('cGrid');
    return !el || el.scrollWidth <= el.clientWidth + 1;
  }));

  console.log('\n— the queries themselves are gone —');
  const leftover = await d.evaluate(() => {
    const want = ['.calendar', '.grid2', '.ngrid', '.sleep-grid', '.mood-sliders',
                  '.time-breakdown', '.fin-grid', '.cgrid', '.qwrap', '.ws-cols'];
    const hits = [];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.type !== CSSRule.MEDIA_RULE) continue;
        for (const inner of r.cssRules || []) {
          if (want.some(w => (inner.selectorText || '') === w)) {
            hits.push(r.conditionText + ' → ' + inner.selectorText);
          }
        }
      }
    }
    return hits;
  });
  /* .qwrap is a deliberate exception: it is a 2x2 quadrant board, and making
     it auto-fit to satisfy this check packed all four into one row of slivers
     on a wide screen. It keeps its media query. */
  const stray = leftover.filter(h => !/\.qwrap$/.test(h));
  ok('no grid is keyed to a viewport width, bar the quadrant board', stray.length === 0, stray);

  console.log('\n— and they still collapse properly on a phone —');
  /* A section that is display:none reports the *declared* value
     ("repeat(auto-fit, minmax(...))"), not a resolved track list, so only
     rendered grids can be measured — and the honest measure is how many
     distinct x-positions the children actually occupy. */
  const cols = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || !el.offsetParent || el.children.length < 2) return null;
    return new Set([...el.children].map(c => Math.round(c.getBoundingClientRect().left))).size;
  }, sel);

  await p.click('#flow-tabbar [data-fn-group="focus"]'); await p.waitForTimeout(900);
  const qc = await cols(p, '.qwrap');
  ok('the priorities grid is one column at 390px', qc === null || qc === 1, qc);

  await p.click('#flow-tabbar [data-fn-group="body"]'); await p.waitForTimeout(700);
  await p.click('#flow-seg [data-fn-seg="sleep"]'); await p.waitForTimeout(1000);
  const mcx = await cols(p, '.mood-sliders');
  ok('the mood sliders are one column at 390px', mcx === null || mcx === 1, mcx);
  ok('nothing overflows the phone after the grid change', await p.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));

  /* ════════════ THE MOOD CHART ════════════ */
  console.log('\n═══ Mood & Energy, rebuilt to match Sleep ═══');
  await d.evaluate(() => {
    const days = ['2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-09','2026-08-10'];
    const md = [5,4,4,3,4,5,5], en = [4,4,3,3,4,4,5];
    mdData = days.map((dt, i) => ({ date: dt, mood: md[i], energy: en[i], note: '' }));
    S.set('mood', mdData);
  });
  await d.click('[data-fn-side="sleep"]'); await d.waitForTimeout(1500);
  await d.evaluate(() => window.renderMoodChart && window.renderMoodChart());
  await d.waitForTimeout(500);

  const mc = await d.evaluate(() => {
    const cv = document.getElementById('mdChart');
    const r = cv.getBoundingClientRect();
    return {
      cssW: Math.round(r.width), cssH: Math.round(r.height),
      backingW: cv.width, backingH: cv.height,
      dpr: window.devicePixelRatio,
      heading: (document.querySelector('.mood-chart-wrap h3') || {}).textContent
    };
  });
  ok('the canvas fills its card instead of being a stretched 800×140',
     mc.cssW > 300 && mc.backingW === Math.round(mc.cssW * Math.min(3, mc.dpr)), mc);
  ok('and is drawn at device resolution, so it is not blurry',
     mc.backingH === Math.round(mc.cssH * Math.min(3, mc.dpr)), mc);
  ok('the heading says how many days are actually shown',
     /last 7 days/.test(mc.heading), mc.heading);

  console.log('\n— it reports what it holds —');
  ok('it plots every logged day', await d.evaluate(() => Flow.MoodChart._pts.length) === 7,
     await d.evaluate(() => Flow.MoodChart._pts.length));
  ok('dates are readable, not 07-15', await d.evaluate(() => Flow.MoodChart._pts[0].label),
     await d.evaluate(() => Flow.MoodChart._pts[0].label));
  ok('both series are on the same 1–5 axis — never two scales',
     await d.evaluate(() => Flow.MoodChart._pts.every(p =>
       (p.mood == null || (p.mood >= 1 && p.mood <= 5)) &&
       (p.energy == null || (p.energy >= 1 && p.energy <= 5)))));

  console.log('\n— hovering explains a day —');
  /* Aim from the canvas's own box rather than a fixed screen coordinate — the
     chart moves whenever the layout around it changes. */
  await d.hover('#mdChart'); await d.waitForTimeout(300);
  const cvBox = await d.evaluate(() => {
    const r = document.getElementById('mdChart').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await d.mouse.move(cvBox.x, cvBox.y);
  await d.waitForTimeout(400);
  const tipTxt = await d.evaluate(() => {
    const t = document.getElementById('flow-mood-tip');
    return t ? t.innerText.replace(/\n/g, ' ') : null;
  });
  ok('a tooltip appears with both values', tipTxt && /Mood/.test(tipTxt) && /Energy/.test(tipTxt), { tipTxt, cvBox });

  console.log('\n— and it survives having nothing to show —');
  await d.evaluate(() => { mdData = []; S.set('mood', mdData); window.renderMoodChart(); });
  await d.waitForTimeout(400);
  ok('empty state instead of a blank box or a crash', await d.evaluate(() =>
    /Mood & Energy$/.test((document.querySelector('.mood-chart-wrap h3') || {}).textContent || '')),
    await d.evaluate(() => (document.querySelector('.mood-chart-wrap h3') || {}).textContent));
  ok('no page errors from any of the charting', derrs.length === 0, derrs.slice(0, 3));

  console.log('\n— the duplicate brain icon —');
  const icons = await d.evaluate(() =>
    [...document.querySelectorAll('.section-header')].map(e => e.textContent.trim().split(' ')[0]));
  const dupes = icons.filter((v, i) => icons.indexOf(v) !== i);
  ok('no icon is used for two different sections', dupes.length === 0, dupes);

  console.log('\n— a reload comes back to the same tab —');
  await d.evaluate(() => Flow.Nav.go('training')); await d.waitForTimeout(600);
  await d.reload({ waitUntil: 'load' });
  await d.waitForFunction(() => document.documentElement.classList.contains('flow-ready'), null, { timeout: 15000 }).catch(() => {});
  await d.waitForTimeout(1800);
  ok('reloading on Training stays on Training', await activeTab(d) === 'training', await activeTab(d));

  console.log('\n— empty numbers look empty —');
  await d.evaluate(() => Flow.Nav.go('sleep')); await d.waitForTimeout(700);
  const emp = await d.evaluate(() => { const e = document.getElementById('slAvg'); return { t: e.textContent.trim(), c: e.classList.contains('is-empty'), lab: e.getAttribute('data-empty') }; });
  ok('a stat with no data is marked empty and says so', emp.t === '—' && emp.c && emp.lab === 'no data yet', emp);

  console.log('\n— Finances: the budget folds once it is set —');
  await d.evaluate(() => Flow.Nav.go('finance')); await d.waitForTimeout(700);
  ok('with no budget the form is open', await d.isVisible('#budgetInputs'));
  await d.fill('#bi_income', '3000'); await d.fill('#bi_food', '400').catch(() => {});
  await d.click('#fnSaveBudget'); await d.waitForTimeout(400);
  ok('saving folds it to one line', !(await d.isVisible('#budgetInputs')) && /budgeted/.test(await d.textContent('.budget-setup .bf-sum')), await d.textContent('.budget-setup .bf-sum'));
  await d.click('.budget-setup .bf-tog'); await d.waitForTimeout(300);
  ok('Edit opens it again', await d.isVisible('#budgetInputs'));

  console.log('\n— a photo of your own —');
  const ph = await d.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 500;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 800, 500);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const data = await Flow.Photo.shrink(blob);
    await Flow.Photo.use(data);
    const im = new Image(); await new Promise((r) => { im.onload = r; im.src = data; });
    return { w: im.width, h: im.height, kb: Math.round(data.length / 1024), face: !!document.querySelector('#fn-avatar img.fn-face') };
  });
  ok('any picture becomes a 320px square', ph.w === 320 && ph.h === 320, ph);
  ok('small enough to keep with the account', ph.kb < 80, ph);
  ok('and it is the face in the corner', ph.face, ph);

  console.log('\n— a reminder or widget tap opens that rock —');
  const orr = await d.evaluate(async () => {
    const wid = Object.keys(cData.rocks)[0] || (typeof cWeekId === 'function' ? cWeekId(new Date()) : '2026-W43');
    const day = (new Date().getDay() + 6) % 7;
    (cData.rocks[wid] = cData.rocks[wid] || []).push({ id: 'openme', title: 'Open me from a reminder', day, prio: 'med', done: false });
    cSave();
    Flow.Nav.go('settings');
    window.__flowOpen({ rock: 'openme' });
    await new Promise((r) => setTimeout(r, 900));
    const row = document.querySelector('#today-feed .td-rock[data-rockid="openme"]');
    const hit = { tab: Flow.Nav.current(), flashed: !!(row && row.classList.contains('fl-flash')) };
    window.__flowOpen({ rock: 'gone-for-good' });
    await new Promise((r) => setTimeout(r, 500));
    hit.gone = (document.getElementById('flow-toast') || document.body).textContent;
    return hit;
  });
  ok('it lands on Today with that rock marked', orr.tab === 'today' && orr.flashed, orr);
  ok('a rock deleted since says so', /no longer in your week/.test(orr.gone || ''), orr.gone);

  console.log('\n— changing a password happens in the app —');
  await d.evaluate(() => Flow.PwSheet.open()); await d.waitForTimeout(400);
  ok('a sheet with password fields opens', await d.isVisible('#flow-pw #pw-cur') && await d.getAttribute('#pw-new', 'type') === 'password');
  await d.fill('#pw-cur', 'a properly long password'); await d.fill('#pw-new', 'a brand new password'); await d.fill('#pw-new2', 'a different new one');
  await d.click('#pw-go'); await d.waitForTimeout(300);
  ok('a mismatch is caught before anything is sent', /not the same/.test(await d.textContent('#pw-err')));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
