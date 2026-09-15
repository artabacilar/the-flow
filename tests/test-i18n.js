/* =========================================================================
 * Translation.
 *
 * Two things are being proven here, and they are not equally important.
 *
 * The first is that the app speaks Turkish: tabs, buttons, empty states,
 * errors, the sign-in screen. That one is easy to check and easy to fix.
 *
 * The second is that it never speaks for the person. A habit called "Read", a
 * journal entry that says "Done", a scoreboard metric named "Work" — those are
 * theirs, and a dictionary keyed on English sentences is one careless rule
 * away from rewriting them. An untranslated button is a blemish; a translated
 * journal entry is data loss with a friendly face. Most of what follows is
 * about the second thing.
 * ====================================================================== */

const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 200) : '')); }
  };

  const c = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);

  console.log('\n— the engine is there before anybody signs in —');
  ok('the page carries a translator', await p.evaluate(() => !!window.FlowI18n));
  ok('an en-GB browser opens in English', await p.evaluate(() => window.FlowI18n.lang) === 'en');
  ok('and says so on <html>', await p.evaluate(() => document.documentElement.getAttribute('lang')) === 'en');

  console.log('\n— the sign-in screen, which renders before any account exists —');
  await p.evaluate(() => window.FlowI18n.set('tr'));
  await p.waitForTimeout(700);
  const auth = await p.evaluate(() => {
    const el = document.getElementById('flow-auth');
    return el ? { text: el.innerText, pw: (document.getElementById('fa-pw') || {}).placeholder || '' } : null;
  });
  ok('it is in Turkish before sign-in', auth && /Hesab|Giriş|Parola|Kurulum/i.test(auth.text), auth && auth.text.slice(0, 160));
  ok('the reveal toggle is translated too', auth && /Göster|Gizle/.test(auth.text), auth && auth.text.slice(0, 160));

  await p.evaluate(() => window.FlowI18n.set('en'));
  await p.waitForTimeout(500);
  ok('and switches back to English without a reload',
    await p.evaluate(() => /Sign in|Set up/i.test(document.getElementById('flow-auth').innerText)));

  console.log('\n— signing in —');
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p);
  await p.waitForTimeout(3500);
  ok('signed in', await p.evaluate(() => !document.getElementById('flow-auth')));

  /* Write things a person would write, with words that are also in the
     dictionary. This is the trap the whole design has to survive. */
  console.log('\n— a person writes things whose words are also ours —');
  await p.evaluate(async () => {
    await Flow.DB.set('ld_habits', JSON.stringify([
      { id: 'h1', name: 'Work', target: 5, log: {} },
      { id: 'h2', name: 'Training', target: 3, log: {} },
      { id: 'h3', name: 'Done', target: 1, log: {} }
    ]));
  });
  await p.evaluate(() => document.querySelector('.tab[data-tab="habits"]').click());
  await p.waitForTimeout(1200);

  await p.evaluate(() => window.FlowI18n.set('tr'));
  await p.waitForTimeout(900);

  const habits = await p.evaluate(() =>
    [...document.querySelectorAll('#tab-habits [class*="hb-name"], #tab-habits .flow-row b, #tab-habits input')]
      .map((el) => el.value !== undefined && el.tagName === 'INPUT' ? el.value : el.textContent.trim())
      .filter(Boolean));
  const body = await p.evaluate(() => document.body.innerText);

  ok('a habit called "Work" is still called Work', !/\bİş\b/.test(habits.join('|')) || habits.includes('Work'), habits.slice(0, 12));
  ok('the page did not rename "Training" to Antrenman inside the list',
    !habits.includes('Antrenman'), habits.slice(0, 12));

  console.log('\n— but the furniture around it is Turkish —');
  ok('the tab rail is translated', /Alışkanlıklar|Bugün|Ayarlar/.test(body), body.slice(0, 200));
  ok('and the page heading with it', /Alışkanlık/.test(body));

  console.log('\n— what a person types is never touched —');
  const MINE = 'Done. Training was good. Work is fine. Save the plan.';
  /* Typed into the box and saved with the button, because that is the path a
     person's words actually take — and a probe written straight into the store
     would prove nothing about what the page then does with them. */
  await p.evaluate(() => document.querySelector('.tab[data-tab="journal"]').click());
  await p.waitForTimeout(1400);
  await p.fill('#jr-body', MINE);
  await p.evaluate(() => document.querySelector('[data-j="save"]').click());
  await p.waitForTimeout(1600);
  const typed = await p.evaluate(() => document.getElementById('tab-journal').innerText);
  ok('a journal entry keeps every word the person wrote',
    typed.includes(MINE), (typed.match(/Done[^\n]*/) || [''])[0]);
  ok('including its title, which is one of our own words',
    !/^Bitti$/m.test(typed), (typed.match(/^Bitti$/m) || [''])[0]);

  /* The same guarantee, stated without going through a feature: an ordinary
     element holding a person's words, sitting in the page while the language
     changes underneath it. */
  const probe = await p.evaluate(async (mine) => {
    const d = document.createElement('div');
    d.id = 'i18n-probe';
    d.textContent = mine;
    document.body.appendChild(d);
    const single = document.createElement('div');
    single.id = 'i18n-probe-one';
    single.textContent = 'Training';          // one of ours, but not furniture
    document.body.appendChild(single);
    await new Promise((r) => setTimeout(r, 800));
    return {
      sentence: document.getElementById('i18n-probe').textContent,
      single: document.getElementById('i18n-probe-one').textContent
    };
  }, MINE);
  ok('a plain element holding a sentence of theirs is untouched', probe.sentence === MINE, probe.sentence);
  ok('and a lone word outside any button is left alone too', probe.single === 'Training', probe.single);

  console.log('\n— inputs are left alone entirely —');
  const inputSafe = await p.evaluate(() => {
    const i = document.createElement('input');
    i.value = 'Save';
    i.setAttribute('data-probe', '1');
    document.body.appendChild(i);
    return new Promise((r) => setTimeout(() => r(document.querySelector('[data-probe]').value), 600));
  });
  ok('the value of a text input is never rewritten', inputSafe === 'Save', inputSafe);

  console.log('\n— going back to English restores the original words —');
  await p.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
  await p.waitForTimeout(1000);
  const trSettings = await p.evaluate(() => document.body.innerText);
  await p.evaluate(() => window.FlowI18n.set('en'));
  await p.waitForTimeout(900);
  const enSettings = await p.evaluate(() => document.body.innerText);
  ok('Settings was Turkish', /Ayarlar|Görünüm|Dil/.test(trSettings), trSettings.slice(0, 160));
  ok('and is English again', /Settings|Appearance|Language/.test(enSettings), enSettings.slice(0, 160));
  ok('with nothing left behind in Turkish', !/Görünüm|Kaydet|Ayarlar/.test(enSettings), enSettings.slice(0, 400));

  console.log('\n— the choice belongs to the account, not the browser —');
  await p.evaluate(() => document.querySelector('[data-lang="tr"]').click());
  await p.waitForTimeout(1200);
  ok('picking Turkish in Settings applies it', await p.evaluate(() => window.FlowI18n.lang) === 'tr');
  const saved = await p.evaluate(() => Flow.DB.get('flow:lang', null));
  ok('and writes it to the account', saved === 'tr', saved);

  /* A second browser, same account, a device that has never been used. */
  const c2 = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  const p2 = await c2.newPage();
  await p2.goto(H + '/', { waitUntil: 'load' });
  await p2.waitForTimeout(2600);
  await p2.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p2.fill('#fa-pw', 'a properly long password');
  await p2.click('#fa-go');
  await p2.waitForTimeout(4000);
  ok('a fresh browser follows the account into Turkish',
    await p2.evaluate(() => window.FlowI18n.lang) === 'tr',
    await p2.evaluate(() => window.FlowI18n.lang));

  console.log('\n— a Turkish device opens in Turkish with no account at all —');
  const c3 = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'tr-TR' });
  const p3 = await c3.newPage();
  await p3.goto(H + '/', { waitUntil: 'load' });
  await p3.waitForTimeout(2800);
  ok('the device language decides before anybody has chosen',
    await p3.evaluate(() => window.FlowI18n.lang) === 'tr',
    await p3.evaluate(() => window.FlowI18n.lang));

  console.log('\n— dates are shapes, not strings —');
  const dates = await p.evaluate(() => {
    const t = (s) => window.FlowI18n.t(s);
    return {
      short: t('Thu 17 Sept'),
      long: t('Tuesday 15 September 2026'),
      month: t('September 2026'),
      dow: t('Mon — 0'),
      /* and a sentence that merely mentions a weekday must NOT be touched */
      prose: t('I train on Mon and I rest on Sun, mostly')
    };
  });
  ok('a short date is reordered the Turkish way', dates.short === '17 Eyl Per', dates.short);
  ok('a long one too', /15 Eylül 2026 Salı/.test(dates.long), dates.long);
  ok('a month and year', dates.month === 'Eylül 2026', dates.month);
  ok('a weekday label', dates.dow === 'Pzt — 0', dates.dow);
  ok('but a sentence mentioning a weekday is left alone',
    dates.prose === 'I train on Mon and I rest on Sun, mostly', dates.prose);

  console.log('\n— the dictionary itself —');
  const dict = await p.evaluate(() => {
    const d = window.FlowI18n && window.__TR_DICT ? window.__TR_DICT : null;
    return { size: (window.FlowI18n.missing({ chrome: true }) || []).length };
  });
  ok('little English is left on the screens this test walked', dict.size < 40, dict.size);

  ok('no page errors at any point', errs.length === 0, errs.slice(0, 4));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
