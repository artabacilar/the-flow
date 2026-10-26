/* Two interfaces: Advanced and Simple.
 *
 * What would make it wrong: someone landing in Simple without asking for it,
 * a page they need vanishing for good, the switch taking more than a click,
 * the choice not surviving a reload, or Simple stranding someone on a page
 * it leaves out. Advanced must be exactly the menu it always was. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const SIMPLE_OUT = ['northstar', 'quad', 'abko', 'dtc', 'training', 'ask'];

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
  ok('with every page in the sidebar', SIMPLE_OUT.every((t) => adv.indexOf(t) >= 0), adv);
  ok('and no extra Add button', !s0.add);

  console.log('\n— one click to Simple —');
  await p.evaluate(() => Flow.Nav.go('training')); await p.waitForTimeout(500);
  await p.click('[data-fn-ui="simple"]'); await p.waitForTimeout(800);
  const s1 = await state(); const simp = await side();
  ok('the switch flips it and saves it to the account', s1.look === 'new' && s1.simple === 'true' && s1.adv === 'false' && s1.saved === true, s1);
  ok('Simple leaves six places out of the menu', SIMPLE_OUT.every((t) => simp.indexOf(t) < 0), simp);
  ok('and keeps Today, Week, Sleep, Habits, Journal and Money', ['today', 'compass', 'sleep', 'habits', 'journal', 'finance'].every((t) => simp.indexOf(t) >= 0), simp);
  ok('switching while on a page Simple leaves out goes to Today', await p.evaluate(() => document.querySelector('.tab.active').getAttribute('data-tab')) === 'today');
  ok('the coral Add is there and opens the + menu', s1.add && await p.click('#fn-sideadd').then(() => p.waitForTimeout(300)).then(() => p.evaluate(() => document.getElementById('flow-capture').classList.contains('on'))));
  await p.keyboard.press('Escape'); await p.evaluate(() => Flow.Nav.closeCapture && Flow.Nav.closeCapture()); await p.waitForTimeout(200);
  await p.evaluate(() => Flow.Nav.openPalette()); await p.waitForTimeout(200);
  await p.fill('#fn-palin', 'train'); await p.waitForTimeout(200);
  ok('⌘K still reaches what Simple hides', await p.evaluate(() => /Training/.test(document.getElementById('flow-pal').textContent)));
  await p.keyboard.press('Escape'); await p.evaluate(() => Flow.Nav.closePalette()); await p.waitForTimeout(200);
  ok('Settings shows the same choice', await p.evaluate(() => { Flow.Nav.go('settings'); const i = document.querySelector('#newLookRow input[data-s="newLook"]'); return !!i && i.checked && /Simple interface/.test(document.getElementById('newLookRow').textContent); }));
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(400);

  console.log('\n— it stays chosen —');
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(5000);
  const s2 = await state(); const simp2 = await side();
  ok('after a reload it is still Simple', s2.look === 'new' && s2.simple === 'true' && SIMPLE_OUT.every((t) => simp2.indexOf(t) < 0), { s2, simp2 });

  console.log('\n— the phone menu has it too —');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  await p.click('#fn-avatar'); await p.waitForTimeout(400);
  ok('the profile menu offers Advanced', await p.evaluate(() => !!document.querySelector('[data-fn-act="ui-advanced"]') && !document.querySelector('[data-fn-act="ui-simple"]')));
  await p.click('[data-fn-act="ui-advanced"]'); await p.waitForTimeout(700);
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(500);
  const s3 = await state(); const back = await side();
  ok('one tap and it is Advanced again, every page back', s3.look === 'classic' && s3.adv === 'true' && s3.saved === false && back.join(',') === adv.join(','), { s3, back });

  console.log('\n— your own hidden pages are yours —');
  await p.evaluate(async () => { await Flow.Settings.set('hiddenTabs', ['journal']); Flow.Sections && Flow.Sections.apply ? Flow.Sections.apply() : null; });
  await p.click('[data-fn-ui="simple"]'); await p.waitForTimeout(500);
  await p.click('[data-fn-ui="advanced"]'); await p.waitForTimeout(500);
  const own = await side();
  ok('leaving Simple does not bring back what you hid yourself', own.indexOf('journal') < 0 && own.indexOf('training') >= 0, own);
  await p.evaluate(async () => { await Flow.Settings.set('hiddenTabs', []); });

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
