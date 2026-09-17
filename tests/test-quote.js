/* The line under "Today".
 *
 * It shipped as one fixed quote — the same words on the most personal screen
 * in the app, for everybody who ever signs up. This is about it being the
 * person's own: theirs to change, theirs to remove, and never rewritten by
 * anything else.
 *
 * The three that matter are the ones a person would actually hit: it changes
 * without a reload (the Today header is built by its own render, so a general
 * repaint does not reach it), blank means blank rather than the default
 * coming back, and there is a way home for somebody who cleared words they
 * never wrote down and then wanted them again.
 */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 240) : '')); }
  };

  const c = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p);
  await p.waitForTimeout(4200);
  ok('signed in', await p.evaluate(() => !document.getElementById('flow-auth')));

  const onScreen = () => p.evaluate(() => {
    const q = document.querySelector('.flow-td-quote');
    return q ? q.innerText.replace(/\s+/g, ' ').trim() : null;
  });

  console.log('\n— what it says before anybody changes it —');
  ok('the line that always shipped is still the one you get',
    /master of my fate/.test(await onScreen() || ''), await onScreen());

  const goto = async (tab) => {
    await p.evaluate((t) => window.Flow.Tabs.activate(t), tab);
    await p.waitForTimeout(800);
  };

  /* Typed into the real field on the real screen, because the thing most
     likely to break is the wiring between the two — the Today header is
     rebuilt only by its own render, so a setting saved without asking for
     that render changes nothing a person can see. */
  const setQuote = async (text, by) => {
    await goto('settings');
    await p.fill('[data-s="todayQuote"]', text);
    await p.dispatchEvent('[data-s="todayQuote"]', 'change');
    await p.fill('[data-s="todayQuoteBy"]', by);
    await p.dispatchEvent('[data-s="todayQuoteBy"]', 'change');
    await p.waitForTimeout(600);
    await goto('today');
  };

  console.log('\n— and then it is yours —');
  await setQuote('Discipline equals freedom.', 'Jocko');
  let seen = await onScreen();
  ok('it changes without a reload', /Discipline equals freedom/.test(seen || ''), seen);
  ok('and carries who said it', /Jocko/.test(seen || ''), seen);
  ok('the old line is gone, not sitting underneath it',
    !/master of my fate/.test(seen || ''), seen);

  console.log('\n— a line with no attribution —');
  await setQuote('Just start.', '');
  seen = await onScreen();
  ok('shows the words', /Just start/.test(seen || ''), seen);
  ok('and no empty dash under them', !/—/.test(seen || ''), seen);

  console.log('\n— blank means blank —');
  await setQuote('', '');
  ok('clearing it removes the line entirely', (await onScreen()) === null);
  /* The one that would be wrong in the obvious implementation: falling back
     to the default, so somebody who wants no quote cannot have none. */
  await goto('settings'); await goto('today');
  ok('and leaving and coming back does not bring the default back', (await onScreen()) === null);

  console.log('\n— and a way home —');
  await goto('settings');
  ok('Settings offers the field', await p.evaluate(() => !!document.querySelector('[data-s="todayQuote"]')));
  ok('and a way to put the original back', await p.evaluate(() => !!document.querySelector('#quote-default')));
  await p.click('#quote-default');
  await p.waitForTimeout(700);
  ok('the field is filled back in',
    await p.evaluate(() => /master of my fate/.test(document.querySelector('[data-s="todayQuote"]').value)));
  await goto('today');
  ok('and the line is back on Today', /master of my fate/.test(await onScreen() || ''), await onScreen());

  console.log('\n— what a person writes is never translated —');
  await setQuote('Training is the plan', 'Me');
  ok('the line is marked as not-for-translation', await p.evaluate(() => {
    const q = document.querySelector('.flow-td-quote');
    return !!q && [...q.children].every(ch => ch.getAttribute('data-i18n') === 'off');
  }));

  ok('no page errors at any point', errs.length === 0, errs.slice(0, 4));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
