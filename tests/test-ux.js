/* The current-screen UX pass. These checks follow the daily workflow and
 * protect work in progress: a convenient shortcut must not silently reschedule
 * an edit, and a readable task must not complete just because its text was
 * tapped. Every account and entry below exists only in the local replica.
 *
 * UX_CAPTURE_ONLY=1 UX_SHOTS_DIR=/tmp/flow-before DASH=/tmp/base/life-dashboard.html
 *   node tests/run.js ux
 * captures an unmodified snapshot with the same demo entries as the new UI.
 * Repeat with the current DASH and another output directory for comparisons.
 */
const { chromium } = require('playwright');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const submitAuth = require('./submit-auth');

const H = 'http://localhost:4222';
const SHOTS = process.env.UX_SHOTS_DIR;
const CAPTURE_ONLY = process.env.UX_CAPTURE_ONLY === '1';

(async () => {
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  const errors = [];
  const ok = (name, condition, detail) => {
    if (condition) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail).slice(0, 300))); }
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'en-GB', timezoneId: 'Europe/Istanbul', reducedMotion: 'reduce'
  });
  const p = await context.newPage();
  p.setDefaultTimeout(10000);
  p.on('pageerror', e => errors.push(e.message));
  // At 01:30 in Istanbul the local date is already the 23rd, while a UTC
  // toISOString() shortcut still says the 22nd. Let time advance normally
  // from this boundary: the host also uses Date.now() to give entries IDs.
  await p.clock.install({ time: new Date('2026-10-22T22:30:00Z') });
  const go = async (tab) => {
    // The same host primitive as the app's sidebar and mobile navigation.
    await p.evaluate(t => document.querySelector('.tab[data-tab="' + t + '"]').click(), tab);
    await p.locator('#tab-' + tab).waitFor({ state: 'visible' });
  };
  const current = () => p.evaluate(() => document.querySelector('.tab.active').getAttribute('data-tab'));
  const date = (offset = 0) => p.evaluate(offset => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }, offset);
  const focusIs = async (id) => {
    await p.waitForFunction(id => document.activeElement && document.activeElement.id === id, id);
    return p.evaluate(id => document.activeElement.id === id, id);
  };
  const form = () => p.evaluate(() => Object.fromEntries(
    ['rkTitle', 'rkDay', 'rkTime', 'rkEnd', 'rkNote', 'rkPrio'].map(id => [id, document.getElementById(id).value])
  ));
  const action = async (name) => p.locator('[data-flow-today-action="' + name + '"]').click();
  const noOverflow = () => p.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));

  try {
    await p.goto(H, { waitUntil: 'load' });
    await p.locator('#fa-email').waitFor({ state: 'visible' });
    if (!(await p.locator('#fa-name').isVisible())) await p.locator('#fa-alt').click();
    await p.locator('#fa-email').fill('ux-review@example.test');
    await p.locator('#fa-name').fill('UX Review');
    await p.locator('#fa-pw').fill(randomUUID());
    await submitAuth(p);
    await p.locator('#flow-auth').waitFor({ state: 'detached' });
    await p.locator('#flow-side').waitFor({ state: 'visible' });

    // Realistic, reproducible demo content, entered through existing controls.
    await go('quad');
    for (const text of ['Send the revised project plan', 'Review week']) {
      await p.locator('#qin1').fill(text);
      await p.locator('#qin1 + button').click();
    }
    await p.locator('#qin2').fill('Protect a focused hour for creative work');
    await p.locator('#qin2 + button').click();
    await go('habits');
    await p.locator('#hbInput').fill('Read for 20 minutes');
    await p.locator('#hbAdd').click();
    await go('compass');
    await p.locator('#rkTitle').fill('Finish the week’s most important deliverable');
    await p.locator('#rkDay').selectOption(await date());
    await p.locator('#rkTime').fill('15:00');
    await p.locator('#rkAdd').click();
    await go('today');

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const theme of ['signature', 'paper', 'bloom']) {
        await p.evaluate(t => Flow.Theme.apply(t), theme);
        for (const width of [390, 1440]) {
          await p.setViewportSize({ width, height: width < 760 ? 844 : 960 });
          for (const tab of ['today', 'compass']) {
            await go(tab);
            // The host shows the pane before its entry animation and the
            // navigation observer finish. Capture their settled state on
            // both the unchanged baseline and the revised source.
            await p.waitForFunction(tab => {
              const pane = document.getElementById('tab-' + tab);
              const group = tab === 'today' ? 'today' : 'focus';
              const host = document.querySelector('.tab.active');
              const side = document.querySelector('[data-fn-side="' + tab + '"]');
              const bar = document.querySelector('#flow-tabbar [data-fn-group="' + group + '"]');
              const segmentReady = tab !== 'compass' ||
                !!document.querySelector('#flow-seg [data-fn-seg="compass"].on');
              return pane && pane.classList.contains('active') &&
                Number(getComputedStyle(pane).opacity) === 1 &&
                host && host.getAttribute('data-tab') === tab &&
                side && side.classList.contains('on') && bar && bar.classList.contains('on') && segmentReady;
            }, tab);
            await p.evaluate(async () => {
              await document.fonts.ready;
              window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            });
            if (tab === 'today') {
              await p.locator('#flow-markets .flow-mkt-row').waitFor({ state: 'attached' });
              await p.locator('#flow-dbline').waitFor({ state: 'attached' });
            }
            await p.waitForFunction(() => window.scrollY === 0 && window.scrollX === 0);
            await p.screenshot({ path: path.join(SHOTS, theme + '-' + width + '-' + tab + '.png'),
              fullPage: false, animations: 'disabled' });
          }
        }
      }
      console.log('  Screenshots: ' + SHOTS);
    }
    if (CAPTURE_ONLY) {
      ok('baseline/demo capture completed without page errors', errors.length === 0, errors);
      return;
    }

    await p.evaluate(() => Flow.Theme.apply('signature'));
    await p.setViewportSize({ width: 1440, height: 960 });
    await go('today');
    console.log('\n— a useful action is available on Today —');
    ok('the action strip is visible', await p.locator('.flow-today-actions').isVisible());
    ok('planning, capture and review are each offered once', await p.locator('.flow-today-actions > button').count() === 3);
    await p.locator('#flow-markets').waitFor({ state: 'attached' });
    ok('daily commitments come before secondary market information', await p.evaluate(() =>
      !!(document.querySelector('#today-feed .td-rocks').compareDocumentPosition(document.getElementById('flow-markets')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    await go('compass');
    await p.locator('#wkNext').click();
    await p.locator('#wkNext').click();
    await go('today');
    await action('plan');
    ok('Plan today opens the host Week Compass', await current() === 'compass');
    ok('it returns to this week after viewing a future week', /this week/i.test(await p.locator('#cWeekLabel').innerText()));
    ok('a blank form is dated to the local today', await p.locator('#rkDay').inputValue() === await date());
    ok('the title field receives keyboard focus', await focusIs('rkTitle'));

    console.log('\n— shortcuts preserve unfinished work —');
    await p.locator('#rkTitle').fill('Draft with an intentional date');
    await p.locator('#rkDay').selectOption(await date(1));
    await p.locator('#rkTime').fill('16:30');
    await p.locator('#rkNote').fill('Keep these details while I check Today.');
    const draft = await form();
    await go('today');
    await action('plan');
    ok('a draft keeps its title, date, time and notes', JSON.stringify(await form()) === JSON.stringify(draft), await form());
    await p.locator('#rkAdd').click();
    const rock = p.locator('#rockList .rockrow').filter({ hasText: draft.rkTitle });
    await rock.locator('.rk-edit').click();
    const edit = await form();
    await go('today');
    await action('plan');
    ok('an existing rock remains an edit', await p.locator('#rkCancel').isVisible());
    ok('the shortcut never silently reschedules the edit', JSON.stringify(await form()) === JSON.stringify(edit), await form());
    await p.locator('#rkCancel').click();

    console.log('\n— an unscheduled rock keeps the week it belongs to —');
    await p.locator('#wkNext').click();
    await p.locator('#wkNext').click();
    const futureWeek = await p.locator('#cWeekLabel').innerText();
    const futureTitle = 'An unscheduled commitment for a future week';
    await p.locator('#rkTitle').fill(futureTitle);
    await p.locator('#rkDay').selectOption('-1');
    await p.locator('#rkTime').fill('');
    await p.locator('#rkNote').fill('This belongs to the week I was planning.');
    const futureDraft = await form();
    await go('today');
    await action('review');
    ok('Review week respects the week of an unfinished draft', await p.locator('#cWeekLabel').innerText() === futureWeek);
    ok('reviewing does not change the unscheduled draft', JSON.stringify(await form()) === JSON.stringify(futureDraft));
    ok('reviewing an unfinished week still focuses its review', await focusIs('wkReview'));
    await go('today');
    await action('plan');
    ok('Plan today preserves the future week of an unscheduled draft', await p.locator('#cWeekLabel').innerText() === futureWeek);
    ok('the draft remains unscheduled with all details intact', JSON.stringify(await form()) === JSON.stringify(futureDraft));
    await p.locator('#rkAdd').click();
    const futureRock = p.locator('#rockList .rockrow').filter({ hasText: futureTitle });
    await futureRock.waitFor({ state: 'visible' });
    ok('the draft is saved in the intended future week', await p.locator('#cWeekLabel').innerText() === futureWeek && await futureRock.count() === 1);
    await futureRock.locator('.rk-edit').click();
    await p.locator('#rkNote').fill('Edited without moving this commitment to this week.');
    const futureEdit = await form();
    await go('today');
    await action('plan');
    ok('an unscheduled edit keeps its original displayed week', await p.locator('#cWeekLabel').innerText() === futureWeek);
    ok('the future-week rock is still an edit with the same date and details', await p.locator('#rkCancel').isVisible() && JSON.stringify(await form()) === JSON.stringify(futureEdit));
    await p.locator('#rkAdd').click();
    await p.locator('#wkToday').click();
    ok('saving did not move or duplicate that rock into the current week', await futureRock.count() === 0);
    await p.locator('#wkNext').click();
    await p.locator('#wkNext').click();
    ok('the edited rock remains exactly once in its original week', await p.locator('#cWeekLabel').innerText() === futureWeek && await futureRock.count() === 1);
    ok('the original week contains the saved edit', (await futureRock.locator('.rk-note').innerText()).includes(futureEdit.rkNote));
    await p.locator('#wkToday').click();

    await p.locator('#wkPrev').click();
    await go('today');
    await action('review');
    ok('Review week opens the current week', await current() === 'compass' && /this week/i.test(await p.locator('#cWeekLabel').innerText()));
    ok('the existing weekly review receives focus', await focusIs('wkReview'));
    await go('today');
    console.log('\n— capture keeps keyboard focus inside the sheet —');
    const captureTrigger = p.locator('.flow-today-actions [data-flow-today-action="capture"]');
    await captureTrigger.press('Enter');
    ok('Quick add opens the existing capture sheet', await p.locator('#flow-capture .fn-sheet').isVisible());
    const captureClose = p.locator('#flow-capture .fn-capture-close');
    const captureChoices = p.locator('#flow-capture [data-fn-cap]');
    ok('opening capture focuses the first entry choice', await captureChoices.first().evaluate(el => el === document.activeElement));
    await captureClose.focus();
    await p.keyboard.press('Shift+Tab');
    ok('Shift+Tab from Close wraps to the last capture choice', await captureChoices.last().evaluate(el => el === document.activeElement));
    await p.keyboard.press('Tab');
    ok('Tab from the last choice wraps to Close', await captureClose.evaluate(el => el === document.activeElement));
    await p.locator('#flow-capture [data-fn-cap="note"]').press('Enter');
    ok('the quick-note pane focuses its writing field', await focusIs('fn-noteinput'));
    await p.locator('#fn-noteinput').press('Shift+Tab');
    ok('hidden capture choices are skipped when moving back from the note', await captureClose.evaluate(el => el === document.activeElement));
    await p.keyboard.press('Shift+Tab');
    ok('Shift+Tab wraps to Save in the note pane', await p.locator('#fn-notesave').evaluate(el => el === document.activeElement));
    await p.keyboard.press('Tab');
    ok('Tab wraps from Save to Close in the note pane', await captureClose.evaluate(el => el === document.activeElement));
    await p.locator('#fn-notecancel').press('Enter');
    ok('Back returns focus to the note entry choice', await p.locator('#flow-capture [data-fn-cap="note"]').evaluate(el => el === document.activeElement));
    await p.keyboard.press('Escape');
    ok('Escape dismisses capture', !(await p.locator('#flow-capture .fn-sheet').isVisible()));
    ok('Escape restores focus to the Today Quick add action', await captureTrigger.evaluate(el => el === document.activeElement));
    await captureTrigger.press('Enter');
    await captureClose.press('Enter');
    ok('the visible Close button also restores the original focus', !(await p.locator('#flow-capture .fn-sheet').isVisible()) && await captureTrigger.evaluate(el => el === document.activeElement));
    await p.locator('[data-jump="recovery"]').click();
    ok('Recovery opens Sleep & Mood', await current() === 'sleep');

    console.log('\n— completion is explicit and keyboard accessible —');
    await go('today');
    const priority = p.locator('#flow-td-priorities .flow-td-row').filter({ hasText: 'Send the revised project plan' });
    await priority.locator('.tx').click();
    ok('clicking priority text does not complete it', await priority.isVisible());
    const priorityCheck = priority.locator('.flow-today-check');
    ok('priority completion exposes an unchecked checkbox', await priorityCheck.getAttribute('role') === 'checkbox' && await priorityCheck.getAttribute('aria-checked') === 'false');
    ok('the checkbox names the priority it completes', (await priorityCheck.getAttribute('aria-label') || '').includes('Send the revised project plan'));
    await priorityCheck.press('Space');
    await priority.waitFor({ state: 'detached' });
    ok('Space completes the chosen priority', await priority.count() === 0);
    ok('focus stays on a meaningful Today control after the row disappears', await p.evaluate(() =>
      !!document.activeElement.closest('.flow-today-check, .flow-today-actions')));

    const habit = p.locator('#flow-td-habits .flow-td-row').filter({ hasText: 'Read for 20 minutes' });
    const habitCheck = habit.locator('.flow-today-check');
    ok('habit completion starts with an unchecked checkbox', await habitCheck.getAttribute('role') === 'checkbox' && await habitCheck.getAttribute('aria-checked') === 'false');
    await habit.locator('.tx').click();
    ok('habit text does not toggle completion', await habitCheck.getAttribute('aria-checked') === 'false');
    await habitCheck.press('Enter');
    await p.waitForFunction(() => [...document.querySelectorAll('#flow-td-habits .flow-td-row')]
      .some(row => row.textContent.includes('Read for 20 minutes') && row.querySelector('button').getAttribute('aria-checked') === 'true'));
    ok('Enter completes the habit', await habitCheck.getAttribute('aria-checked') === 'true');
    ok('focus returns to the same habit after repaint', await habitCheck.evaluate(el => el === document.activeElement));
    await habitCheck.press('Space');
    ok('Space can undo that completion', await habitCheck.getAttribute('aria-checked') === 'false');
    await habitCheck.press('Space');

    console.log('\n— changes survive a real reload —');
    await p.reload({ waitUntil: 'load' });
    await p.locator('.flow-today-actions').waitFor({ state: 'visible' });
    ok('the completed priority remains completed', await priority.count() === 0);
    ok('the habit retains its saved checked state', await habitCheck.getAttribute('aria-checked') === 'true');

    console.log('\n— new controls translate, the person’s words do not —');
    await p.evaluate(() => FlowI18n.set('tr'));
    await p.waitForFunction(() => FlowI18n.lang === 'tr' &&
      document.querySelector('[data-flow-today-action="review"]').textContent.trim() !== 'Review week');
    for (const [name, english] of [['plan', 'Plan today'], ['capture', 'Quick add'], ['review', 'Review week']]) {
      const translated = await p.locator('.flow-today-actions [data-flow-today-action="' + name + '"]').innerText();
      ok('the ' + name + ' action is translated to Turkish', translated.trim() !== english, translated);
    }
    const ownWords = p.locator('#flow-td-priorities .tx').filter({ hasText: /^Review week$/ });
    ok('a user priority named Review week is left unchanged', await ownWords.count() === 1);
    await p.evaluate(() => FlowI18n.set('en'));
    await p.waitForFunction(() => FlowI18n.lang === 'en' &&
      document.querySelector('[data-flow-today-action="review"]').textContent.trim() === 'Review week');

    console.log('\n— the reviewed light-theme surfaces retain readable contrast —');
    // Focused regressions for four affected surfaces, not a full accessibility audit.
    await p.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['paper', 'bloom']) {
      await p.evaluate(t => Flow.Theme.apply(t), theme);
      for (const tab of ['today', 'compass']) {
        await go(tab);
        await p.waitForFunction(tab => !!document.querySelector('#flow-tabbar [data-fn-group="' +
          (tab === 'today' ? 'today' : 'focus') + '"].on'), tab);
        const readings = await p.evaluate(async tab => {
          const surfaces = [...document.querySelectorAll('#flow-tabbar button, .flow-td-tile')];
          await Promise.all(surfaces.flatMap(el => el.getAnimations()).map(a => a.finished.catch(() => {})));
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const luminance = color => {
            if (!CSS.supports('color', color)) return null;
            ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
            const rgba = ctx.getImageData(0, 0, 1, 1).data;
            if (rgba[3] !== 255) return null; // These fixes promise opaque surfaces.
            return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
              const c = rgba[i] / 255;
              return sum + weight * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
            }, 0);
          };
          const style = selector => getComputedStyle(document.querySelector(selector));
          const cases = tab === 'today' ? [
            ['Big Rock title', style('.td-rock:not(.done) .rk-title').color,
              style('.td-rocks').backgroundImage.match(/rgba?\([^)]*\)/g) || []],
            ['active bottom-tab label', style('#flow-tabbar button.on .fn-lb').color, [style('#flow-tabbar').backgroundColor]],
            ['warning pulse value', style('[data-jump="priorities"].warn .v').color, [style('[data-jump="priorities"].warn').backgroundColor]]
          ] : [['unfinished Compass rock', style('#cGrid .chip.rock:not(.done)').color, [style('#cGrid .chip.rock:not(.done)').backgroundColor]]];
          return cases.map(([name, ink, backgrounds]) => ({ name, ink, backgrounds,
            ratios: backgrounds.map(bg => {
              const a = luminance(ink), b = luminance(bg);
              return a === null || b === null ? 0 : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            }) }));
        }, tab);
        for (const r of readings) ok(theme + ': ' + r.name + ' has at least 4.5:1 contrast',
          r.ratios.length === (r.name === 'Big Rock title' ? 2 : 1) && r.ratios.every(n => n >= 4.5), r);
      }
    }

    console.log('\n— finishing the last checkbox keeps a useful focus target —');
    // A starred Planner task appears in Today priorities without a Q checkbox.
    // Keep one visible while completing every Q item through its actual button.
    const pinnedText = 'Pinned task that remains after the final checkbox';
    await go('artur');
    await p.locator('#ar-new').fill(pinnedText);
    await p.locator('#ar-time').fill('10:00');
    await p.locator('#tab-artur [data-a="add"]').click();
    const pinnedPlannerRow = p.locator('#tab-artur .flow-tl > li').filter({ hasText: pinnedText });
    await pinnedPlannerRow.locator('[data-star]').click();
    await pinnedPlannerRow.locator('[data-star]').filter({ hasText: '★' }).waitFor({ state: 'visible' });
    await go('today');
    const pinnedTodayRow = p.locator('#flow-td-priorities .flow-td-row').filter({ hasText: pinnedText });
    ok('the pinned priority remains visible without a Q completion button', await pinnedTodayRow.isVisible() && await pinnedTodayRow.locator('[data-q]').count() === 0);
    const qChecks = p.locator('#flow-td-priorities .flow-today-check[data-q]');
    ok('there are Q checkboxes left to complete', await qChecks.count() > 0);
    for (let n = 0; n < 20 && await qChecks.count(); n++) {
      const id = await qChecks.first().getAttribute('data-q');
      await qChecks.first().press('Space');
      await p.waitForFunction(id => ![...document.querySelectorAll('#flow-td-priorities [data-q]')]
        .some(el => el.getAttribute('data-q') === id), id);
    }
    ok('all Q priorities are complete and the pinned task remains', await qChecks.count() === 0 && await pinnedTodayRow.isVisible());
    ok('focus falls back to an always-present Today action', await p.evaluate(() =>
      document.activeElement.matches('.flow-today-actions [data-flow-today-action]') && document.activeElement.getClientRects().length > 0));

    console.log('\n— readable, reachable layouts in both light and dark —');
    for (const theme of ['signature', 'paper']) {
      await p.evaluate(t => Flow.Theme.apply(t), theme);
      for (const width of [320, 390, 768, 1280, 1440]) {
        await p.setViewportSize({ width, height: width < 760 ? 844 : 960 });
        await go('today');
        const actions = await p.locator('.flow-today-actions > button').evaluateAll(els => els.map(el => {
          const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right };
        }));
        ok(theme + ' ' + width + ': Today actions remain real 44px targets', actions.length === 3 && actions.every(r => r.height >= 44 && r.width >= 44), actions);
        const checks = await p.locator('.flow-today-check').evaluateAll(els => els.map(el => {
          const r = el.getBoundingClientRect(); return { width: r.width, height: r.height };
        }));
        ok(theme + ' ' + width + ': completion controls remain real 44px targets', checks.length > 0 && checks.every(r => r.height >= 44 && r.width >= 44), checks);
        let bounds = await noOverflow();
        ok(theme + ' ' + width + ': Today stays inside the viewport', bounds.page <= bounds.viewport + 1, bounds);
        await go('compass');
        const week = await p.locator('#cGrid').evaluate(el => {
          const days = [...el.querySelectorAll('.cday')].map(day => day.getBoundingClientRect());
          return { count: days.length, rows: new Set(days.map(r => Math.round(r.top))).size,
            width: el.clientWidth, scrollWidth: el.scrollWidth, tabindex: el.getAttribute('tabindex'),
            role: el.getAttribute('role'), label: el.getAttribute('aria-label') };
        });
        ok(theme + ' ' + width + ': all seven days stay on one row', week.count === 7 && week.rows === 1, week);
        bounds = await noOverflow();
        ok(theme + ' ' + width + ': the calendar cannot widen the page', bounds.page <= bounds.viewport + 1, bounds);
        const overflow = week.scrollWidth > week.width + 1;
        const hint = await p.locator('#flow-week-scrollhint').isVisible();
        ok(theme + ' ' + width + ': the scroll hint matches actual overflow', hint === overflow, { hint, overflow });
        if (width >= 1280) ok(theme + ' ' + width + ': the whole week fits at desktop width', !overflow, week);
        if (width === 390) {
          ok(theme + ': the narrow calendar is a labelled keyboard region', week.tabindex === '0' && week.role === 'region' && !!week.label, week);
          await p.locator('#cGrid').focus();
          await p.locator('#cGrid').press('ArrowRight');
          await p.waitForFunction(() => document.getElementById('cGrid').scrollLeft > 0);
          ok(theme + ': arrow keys reveal later days', await p.locator('#cGrid').evaluate(el => el.scrollLeft > 0));
        }
      }
    }
    ok('the full workflow raises no page errors', errors.length === 0, errors);
  } catch (e) {
    ok('the workflow completes', false, e.message);
  } finally {
    await browser.close();
    console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  }
})();
