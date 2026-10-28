/* Two interfaces: Advanced and Simple.
 *
 * What would make it wrong: someone landing in Simple without asking for it,
 * the switch taking more than a click, the choice not surviving a reload, or
 * Simple being able to do less than Advanced — a page, a button, a field
 * that one has and the other does not. Simple is a design, not a cut. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const ALL = ['today', 'northstar', 'quad', 'compass', 'abko', 'dtc', 'training', 'sleep', 'habits', 'journal', 'finance', 'ask'];
/* Every control a page shows, by what it is and what it says. */
const controls = (p) => p.evaluate(() => {
  const sec = document.querySelector('.section.active, .flow-section.active') || document.body;
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return (e.offsetParent || cs.position === 'fixed') && r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
  const out = new Set();
  sec.querySelectorAll('button, a, input, select, textarea, [role=button], [data-jump]').forEach((e) => {
    if (!vis(e) || e.closest('.lk-strip, .lk-hero')) return;
    out.add(e.tagName.toLowerCase() + '|' + (e.getAttribute('data-s') || e.getAttribute('data-jump') || '') + '|' + (e.placeholder || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40));
  });
  return [...out].sort();
});

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  const side = () => p.evaluate(() => [...document.querySelectorAll('#flow-side [data-fn-side]')].filter((x) => x.offsetParent).map((x) => x.getAttribute('data-fn-side')));
  const state = () => p.evaluate(() => ({
    look: document.documentElement.getAttribute('data-flow-look'),
    adv: document.querySelector('[data-fn-ui="advanced"]').getAttribute('aria-pressed'),
    simple: document.querySelector('[data-fn-ui="simple"]').getAttribute('aria-pressed'),
    add: !!document.querySelector('#fn-sideadd').offsetParent,
    saved: Flow.Settings.get('newLook')
  }));

  console.log('\n— Advanced unless you choose otherwise —');
  const adv = await side();
  const s0 = await state();
  ok('a new account is in Advanced', s0.look === 'classic' && s0.adv === 'true' && s0.simple === 'false' && !s0.saved, s0);
  ok('with every page in the sidebar', ALL.every((t) => adv.indexOf(t) >= 0), adv);
  const before = {};
  for (const t of ALL) { await p.evaluate((t) => Flow.Nav.go(t), t); await p.waitForTimeout(350); before[t] = await controls(p); }
  ok('and no extra Add button', !s0.add);

  console.log('\n— one click to Simple —');
  await p.evaluate(() => Flow.Nav.go('training')); await p.waitForTimeout(500);
  await p.click('[data-fn-ui="simple"]'); await p.waitForTimeout(800);
  const s1 = await state(); const simp = await side();
  ok('the switch flips it and saves it to the account', s1.look === 'new' && s1.simple === 'true' && s1.adv === 'false' && s1.saved === true, s1);
  ok('Simple has the same sidebar, every page', simp.join(',') === adv.join(','), simp);
  ok('and stays on the page you were on', await p.evaluate(() => document.querySelector('.tab.active').getAttribute('data-tab')) === 'training');
  const gaps = {};
  /* Simple says a few of the app's own words differently (Big Rocks are
     Priorities, the quadrant list is Open loops). The same control with the
     Simple word is the same control. */
  const vocab = await p.evaluate(() => window.FlowVocab.list().filter((r) => typeof r.to === 'string').map((r) => [r.rx.source, r.rx.flags, r.to]));
  const simpleWord = (x) => vocab.reduce((acc, [src, flags, to]) => acc.replace(new RegExp(src, flags), to), x);
  for (const t of ALL) {
    await p.evaluate((t) => Flow.Nav.go(t), t); await p.waitForTimeout(350);
    const now = new Set(await controls(p));
    const miss = before[t].filter((x) => !now.has(x) && !now.has(simpleWord(x)));
    if (miss.length) gaps[t] = miss.slice(0, 6);
  }
  ok('every page has every control it has in Advanced', !Object.keys(gaps).length, gaps);
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(300);
  ok('the coral Add is there and opens the + menu', s1.add && await p.click('#fn-sideadd').then(() => p.waitForTimeout(300)).then(() => p.evaluate(() => document.getElementById('flow-capture').classList.contains('on'))));
  await p.keyboard.press('Escape'); await p.evaluate(() => Flow.Nav.closeCapture && Flow.Nav.closeCapture()); await p.waitForTimeout(200);
  await p.evaluate(() => Flow.Nav.openPalette()); await p.waitForTimeout(200);
  await p.fill('#fn-palin', 'train'); await p.waitForTimeout(200);
  ok('⌘K finds pages the same way', await p.evaluate(() => /Training/.test(document.getElementById('flow-pal').textContent)));
  await p.keyboard.press('Escape'); await p.evaluate(() => Flow.Nav.closePalette()); await p.waitForTimeout(200);
  ok('Settings shows the same choice', await p.evaluate(() => { Flow.Nav.go('settings'); const i = document.querySelector('#newLookRow input[data-s="newLook"]'); return !!i && i.checked && /Simple interface/.test(document.getElementById('newLookRow').textContent); }));
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(400);

  console.log('\n— it stays chosen —');
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(5000);
  const s2 = await state(); const simp2 = await side();
  ok('after a reload it is still Simple', s2.look === 'new' && s2.simple === 'true' && simp2.join(',') === adv.join(','), { s2, simp2 });
  ok('the summary\'s Next is the rock\'s title, not the lines under it', await p.evaluate(() => {
    const t = (document.querySelector('.lk-next span') || {}).textContent || '';
    const el = document.querySelector('.td-rocks:not(#td-cal) .td-rock:not(.done) .rk-title');
    const note = el && el.querySelector('.td-rk-note');
    return !!t && (!note || t.indexOf(note.textContent.trim().slice(0, 12)) < 0);
  }));
  await p.setViewportSize({ width: 1440, height: 766 }); await p.waitForTimeout(300);
  ok('the whole sidebar fits a 766px-high window', await p.evaluate(() => { const s = document.getElementById('flow-side'); return s.scrollHeight <= s.clientHeight + 1; }));
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(300);

  console.log('\n— the phone menu has it too —');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  await p.click('#fn-avatar'); await p.waitForTimeout(400);
  ok('the profile menu offers Advanced', await p.evaluate(() => !!document.querySelector('[data-fn-act="ui-advanced"]') && !document.querySelector('[data-fn-act="ui-simple"]')));
  await p.click('[data-fn-act="ui-advanced"]'); await p.waitForTimeout(700);
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(500);
  const s3 = await state(); const back = await side();
  ok('one tap and it is Advanced again', s3.look === 'classic' && s3.adv === 'true' && s3.saved === false && back.join(',') === adv.join(','), { s3, back });

  console.log('\n— your own hidden pages are yours —');
  await p.evaluate(async () => { await Flow.Settings.set('hiddenTabs', ['journal']); Flow.Sections && Flow.Sections.apply ? Flow.Sections.apply() : null; });
  await p.click('[data-fn-ui="simple"]'); await p.waitForTimeout(500);
  await p.click('[data-fn-ui="advanced"]'); await p.waitForTimeout(500);
  const own = await side();
  ok('what you hid yourself stays hidden in both', own.indexOf('journal') < 0 && own.indexOf('training') >= 0, own);
  await p.evaluate(async () => { await Flow.Settings.set('hiddenTabs', []); });

  console.log('\n— Simple without the decoration —');
  await p.click('[data-fn-ui="simple"]'); await p.waitForTimeout(500);
  await p.evaluate(() => Flow.Nav.go('finance')); await p.waitForTimeout(600);
  const head = await p.evaluate(() => { const h = document.querySelector('#tab-finance .section-header'); return { text: h.innerText.split('\n')[0].trim(), emo: !!h.querySelector('.lk-emo') }; });
  ok('page titles lose the emoji in Simple', head.emo && head.text === 'Finances', head);
  ok('an emoji-only button keeps its emoji', await p.evaluate(() => [...document.querySelectorAll('.section.active button')].filter((b) => b.offsetParent && /^\p{Extended_Pictographic}/u.test(b.textContent.trim()) && !/\p{L}{2}/u.test(b.textContent)).every((b) => !b.querySelector('.lk-emo'))));
  await p.evaluate(async () => { await Flow.Lang.set('tr', false); }); await p.waitForTimeout(800);
  ok('and still translate — "Finances" reads "Finans"', await p.evaluate(() => document.querySelector('#tab-finance .section-header').innerText.split('\n')[0].trim()) === 'Finans', await p.evaluate(() => document.querySelector('#tab-finance .section-header').innerText));
  await p.evaluate(async () => { await Flow.Lang.set('en', false); }); await p.waitForTimeout(500);
  await p.click('[data-fn-ui="advanced"]'); await p.waitForTimeout(400);
  ok('Advanced shows the emoji as before', await p.evaluate(() => document.querySelector('#tab-finance .section-header').innerText.trim().startsWith('💰')));

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
