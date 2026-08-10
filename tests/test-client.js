/* The visible half: the price strip, the guest button, the shared-task inbox
   and the Ask tab. Driven in a real browser against the replica server. */
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
    : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 200) : ''))); };

  const signUp = async (page, email, name, invite) => {
    await page.goto(H + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.click('#fa-alt').catch(() => {});
    await page.waitForTimeout(250);
    await page.fill('#fa-email', email);
    await page.fill('#fa-name', name);
    await page.fill('#fa-pw', 'a properly long password');
    if (invite) await page.fill('#fa-inv', invite).catch(() => {});
    await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => {}), page.click('#fa-go')]);
    await page.waitForTimeout(3800);
  };

  /* The shipped navigation replaces the host's pill row and hides it, so
     "is the app usable" means "is there navigation", not "is .tabs visible".
     Each candidate has to be tested on its own: a comma selector resolves to
     the first match in document order, which is the hidden row every time. */
  const usable = (page) => page.evaluate(() => {
    const shown = (s) => {
      const e = document.querySelector(s);
      return !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    };
    return shown('#flow-side') || shown('#flow-tabbar') || shown('.tabs') || shown('#moreGrid');
  });

  /* The host's own pills are hidden, so drive them the way the navigation does. */
  const goto = (page, tab) => page.evaluate((t) => {
    const el = document.querySelector('.tab[data-tab="' + t + '"]');
    if (el) el.click();
  }, tab);

  /* ---------- guest ---------- */
  console.log('\n— looking around as a guest —');
  const cg = await b.newContext(); const pg = await cg.newPage();
  const eg = []; pg.on('pageerror', e => eg.push(e.message));
  const guestCalls = [];
  await pg.route('**/api/**', (route) => { guestCalls.push(route.request().url()); route.continue(); });
  await pg.goto(H + '/', { waitUntil: 'load' }); await pg.waitForTimeout(2500);
  ok('the sign-in screen offers a look around', await pg.isVisible('#fa-guest'));
  await pg.click('#fa-guest'); await pg.waitForTimeout(2500);
  ok('the sign-in screen goes away', !(await pg.isVisible('#flow-auth').catch(() => false)));
  ok('a banner says nothing is being saved', await pg.isVisible('#flow-guestbar'));
  ok('the app itself is usable', await usable(pg));

  guestCalls.length = 0;
  await pg.evaluate(async () => { await Flow.Settings.set('displayName', 'Guest Person'); });
  await pg.waitForTimeout(900);
  const wrote = guestCalls.filter(u => /\/api\/(set|bulk)/.test(u));
  ok('nothing a guest types is sent to the server', wrote.length === 0, wrote);
  const stored = await pg.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('flowguest:') === 0));
  ok('it is kept in the browser instead', stored.length > 0, stored);
  ok('no page errors as a guest', eg.length === 0, eg.slice(0, 2));

  console.log('\n— and the offer to keep that work —');
  await pg.click('#fg-signup'); await pg.waitForTimeout(900);
  ok('it returns to the sign-up form', await pg.isVisible('#flow-auth'));
  const carried = await pg.evaluate(() => JSON.parse(sessionStorage.getItem('flow:carry') || 'null'));
  ok('their work is staged for the new account', carried && Object.keys(carried).length > 0, carried && Object.keys(carried));

  /* ---------- prices ---------- */
  console.log('\n— the price strip —');
  const c1 = await b.newContext(); const p1 = await c1.newPage();
  const e1 = []; p1.on('pageerror', e => e1.push(e.message));
  await p1.route('**/api/flow/prices', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true, at: new Date().toISOString(), ageMs: 20000, stale: false, fxDate: '2026-07-31',
      quotes: { BTCUSD: 59977.99, USDTRY: 47.525, EURTRY: 54.58, GRAMGOLDTRY: 6213.4 },
      errors: {}, known: []
    })
  }));
  await signUp(p1, 'prices@example.com', 'Pricer', 'letmein');
  await goto(p1, 'today');
  await p1.waitForTimeout(1500);
  const mkt = await p1.evaluate(() => {
    const el = document.getElementById('flow-markets');
    return el ? { text: el.innerText, tiles: [...el.querySelectorAll('.flow-mkt-tile .v')].map(n => n.textContent) } : null;
  });
  ok('the strip is on the Today screen', !!mkt, mkt);
  ok('it shows four watched pairs by default', mkt && mkt.tiles.length === 4, mkt && mkt.tiles);
  ok('big numbers lose their decimals', mkt && /59,?978/.test(mkt.tiles.join(' ')), mkt && mkt.tiles);
  ok('a rate keeps them', mkt && /47\.5/.test(mkt.tiles.join(' ')), mkt && mkt.tiles);
  ok('gram gold is shown in lira', mkt && /6,?213/.test(mkt.tiles.join(' ')), mkt && mkt.tiles);
  ok('it says how old the numbers are', mkt && /ago|just now/.test(mkt.text), mkt && mkt.text);
  ok('and that gram gold is derived', mkt && /derived/.test(mkt.text), mkt && mkt.text);

  console.log('\n— when the server has nothing to give —');
  const c3 = await b.newContext(); const p3 = await c3.newPage();
  await p3.route('**/api/flow/prices', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await signUp(p3, 'noprice@example.com', 'NoPrice', 'letmein');
  await p3.waitForTimeout(1200);
  const none = await p3.evaluate(() => {
    const el = document.getElementById('flow-markets');
    return { present: !!el, text: el ? el.innerText : '', errors: [] };
  });
  ok('the app still loads with no prices', await usable(p3));
  ok('and says so plainly rather than showing a spinner', !none.present || /wakes up/.test(none.text), none);

  /* ---------- sharing, end to end in the UI ---------- */
  console.log('\n— a task shared between two people —');
  const c2 = await b.newContext(); const p2 = await c2.newPage();
  const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await signUp(p2, 'recip@example.com', 'Recipient', 'letmein');

  /* Signing the other accounts up moved the session this page was holding, so
     pick it up again before asking it to send anything. */
  await p1.reload({ waitUntil: 'load' }); await p1.waitForTimeout(3000);
  await p1.evaluate(async () => {
    await Flow.Inbox.send('recip@example.com', { txt: 'Book the venue', note: 'before Friday', due: '2026-08-14', time: '10:00' });
  });
  await p2.reload({ waitUntil: 'load' }); await p2.waitForTimeout(3800);
  await goto(p2, 'artur');
  await p2.waitForTimeout(1200);
  const box = await p2.evaluate(() => {
    const el = document.getElementById('flow-inbox');
    return el ? el.innerText : null;
  });
  ok('the shared task appears in their inbox', box && /Book the venue/.test(box), box);
  ok('it names who sent it', box && /Pricer/.test(box), box);
  ok('and it is not in their priorities yet', await p2.evaluate(() =>
    !(typeof qData !== 'undefined' && JSON.stringify(qData.items || []).includes('Book the venue'))));

  await p2.click('#flow-inbox [data-inbox="add"]');
  await p2.waitForTimeout(2000);
  const filed = await p2.evaluate(() => ({
    inQuad: typeof qData !== 'undefined' && JSON.stringify(qData.items || []).includes('Book the venue'),
    creditsSender: typeof qData !== 'undefined' && JSON.stringify(qData.items || []).includes('Pricer'),
    inboxNow: (document.getElementById('flow-inbox') || {}).innerText || ''
  }));
  ok('pressing Add files it into their own priorities', filed.inQuad, filed);
  ok('and it says who it came from', filed.creditsSender, filed);
  ok('the inbox empties', /Nothing waiting/.test(filed.inboxNow), filed.inboxNow);
  ok('no page errors for the recipient', e2.length === 0, e2.slice(0, 2));

  console.log('\n— and the sender got none of their data —');
  const senderSees = await p1.evaluate(() => JSON.stringify(typeof qData !== 'undefined' ? qData.items : []));
  ok("the sender's own priorities are untouched", !/Book the venue/.test(senderSees), senderSees.slice(0, 120));

  /* ---------- the Ask tab ---------- */
  console.log('\n— the assistant —');
  await p1.route('**/api/flow/chat', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, reply: 'Your Q1 list has two items open.', used: 3, cap: 40 })
  }));
  await goto(p1, 'ask');
  await p1.waitForTimeout(900);
  ok('the Ask tab exists', await p1.isVisible('#ask-in'));
  ok('it says up front that it cannot change anything', await p1.evaluate(() =>
    /cannot add or edit|NEVER CHANGES/i.test(document.getElementById('tab-ask').innerText)));
  await p1.fill('#ask-in', 'What should I focus on?');
  await p1.click('#ask-go');
  await p1.waitForTimeout(1200);
  const log = await p1.evaluate(() => document.getElementById('ask-log').innerText);
  ok('the question is shown', /What should I focus on/.test(log), log);
  ok('and the answer', /two items open/.test(log), log);
  ok('the daily count is visible', await p1.evaluate(() => /3 of 40/.test(document.getElementById('ask-meta').innerText)));

  console.log('\n— when the assistant is switched off —');
  await p2.route('**/api/flow/chat', (route) => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: 'The assistant is not switched on. Add ANTHROPIC_API_KEY in Render to enable it.' })
  }));
  await goto(p2, 'ask'); await p2.waitForTimeout(700);
  await p2.fill('#ask-in', 'hello'); await p2.click('#ask-go'); await p2.waitForTimeout(1200);
  const offLog = await p2.evaluate(() => document.getElementById('ask-log').innerText);
  ok('it explains rather than failing silently', /not switched on/.test(offLog), offLog);
  ok('no page errors', e1.length === 0 && e2.length === 0, [e1.slice(0, 2), e2.slice(0, 2)]);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
