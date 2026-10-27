/* The first run — roles, three Big Rocks, Today.
 *
 * What would make it wrong: an account that inherited a Flow seeing it; a
 * person who chose Advanced seeing it; it coming back after it was done or
 * skipped; the rocks written not landing on this week; the seeded examples
 * staying next to the real thing; a role the person added not being a role
 * the Week Compass knows; or Skip losing anything. */
const submitAuth = require('./submit-auth.js');
const { chromium, devices } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const fresh = async (opts) => {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/api/flow/patterns**', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' }));
    await p.route('**/api/flow/ahead**', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' }));
    await p.route('**/api/connect/list', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: '{"connections":[]}' }));
    return { ctx, p };
  };
  const signup = async (p, email, name) => {
    await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
    await p.fill('#fa-email', email); await p.fill('#fa-name', name); await p.fill('#fa-pw', 'a properly long password');
    if (email !== process.env.FLOW_OWNER_EMAIL) await p.fill('#fa-inv', 'letmein').catch(() => {});
    await submitAuth(p); await p.waitForTimeout(4500);
  };

  console.log('\n— a new account, on a phone —');
  let { ctx, p } = await fresh(Object.assign({}, devices['iPhone 13']));
  await signup(p, process.env.FLOW_OWNER_EMAIL, 'Artur');
  /* the owner on an empty server is a template account too — the first
     person on a fresh Flow gets the same welcome as anybody */
  const fr = await p.evaluate(() => { const el = document.getElementById('flow-fr'); return el && { h: el.querySelector('.fr-h').textContent, chips: [...el.querySelectorAll('.fr-chip')].map((c) => c.textContent), on: [...el.querySelectorAll('.fr-chip.on')].map((c) => c.textContent), look: document.documentElement.getAttribute('data-flow-look') }; });
  ok('it opens in Simple with a welcome by name', fr && fr.look === 'new' && /Welcome, Artur/.test(fr.h), fr);
  ok('the roles the account already has are picked, with more to choose from', fr && fr.on.length >= 3 && fr.chips.length > fr.on.length && fr.chips.includes('Family'), fr && { on: fr.on, chips: fr.chips.length });
  ok('it fits the phone', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('#flow-fr .fr-card').getBoundingClientRect().right <= innerWidth));
  await p.click('#flow-fr .fr-chip[data-role="Money"]');
  await p.fill('#flow-fr .fr-add input', 'DJ sets'); await p.press('#flow-fr .fr-add input', 'Enter'); await p.waitForTimeout(200);
  ok('a role of your own joins the chips, picked', await p.evaluate(() => { const c = document.querySelector('#flow-fr .fr-chip[data-role="DJ sets"]'); return !!c && c.classList.contains('on'); }));
  await p.click('#flow-fr [data-fr="next"]'); await p.waitForTimeout(300);
  const step2 = await p.evaluate(() => { const s = document.querySelector('#flow-fr [data-step="2"]'); return { shown: !s.hidden, rows: s.querySelectorAll('.fr-rock').length, roles: [...s.querySelector('select').options].map((o) => o.value), ph: s.querySelector('input').placeholder }; });
  ok('then three Big Rocks, each with a role from the ones chosen and an example to go by', step2.shown && step2.rows === 3 && step2.roles.includes('DJ sets') && !step2.roles.includes('Money') && step2.ph.length > 5, step2);
  await p.click('#flow-fr [data-fr="done"]'); await p.waitForTimeout(300);
  ok('an empty week is not a week', await p.evaluate(() => !!document.getElementById('flow-fr')));
  const rows = await p.$$('#flow-fr .fr-rock');
  await rows[0].$eval('input', (i) => { i.value = 'Send the venue contract'; });
  await rows[0].$eval('select', (s) => { s.value = 'Work'; });
  await rows[1].$eval('input', (i) => { i.value = 'Two hours on the new set'; });
  await rows[1].$eval('select', (s) => { s.value = 'DJ sets'; });
  await p.click('#flow-fr [data-fr="done"]'); await p.waitForTimeout(1200);
  const after = await p.evaluate(async () => {
    const w = weekId(new Date()); const t = (new Date().getDay() + 6) % 7;
    const rocks = (cData.rocks[w] || []).map((r) => ({ t: r.title, role: r.role, day: r.day, ex: /An example to get you started/.test(r.note || '') }));
    const saved = await Flow.DB.get('ld_compass', {});
    return { gone: !document.getElementById('flow-fr'), rocks, t, roles: cData.roles, savedRocks: ((saved.rocks || {})[w] || []).length, mark: await Flow.DB.get('flow:firstrun', null), tab: (document.querySelector('.tab.active[data-tab]') || {}).getAttribute && document.querySelector('.tab.active[data-tab]').getAttribute('data-tab'), today: document.getElementById('today-feed').textContent };
  });
  ok('the two rocks land on this week, the first one today, with their roles', after.rocks.length === 2 && after.rocks[0].t === 'Send the venue contract' && after.rocks[0].day === after.t && after.rocks[1].role === 'DJ sets' && after.rocks[1].day === Math.min(6, after.t + 1), after.rocks);
  ok('the seeded examples are gone', after.rocks.every((r) => !r.ex));
  ok('the roles are the ones chosen, including the new one', after.roles.includes('DJ sets') && after.roles.includes('Work') && !after.roles.includes('Money'), after.roles);
  ok('and it is remembered as done', after.mark && after.mark.rocks === 2, after.mark);
  ok('the person is on Today, looking at their week', after.gone && after.tab === 'today' && /Send the venue contract/.test(after.today), { tab: after.tab });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(5000);
  const again = await p.evaluate(() => ({ fr: !!document.getElementById('flow-fr'), rocks: (cData.rocks[weekId(new Date())] || []).map((r) => r.title) }));
  ok('it does not come back', !again.fr);
  ok('and the week it wrote is the week on the account', again.rocks.length === 2 && again.rocks[0] === 'Send the venue contract', again.rocks);
  await ctx.close();

  console.log('\n— skipping keeps the tour —');
  ({ ctx, p } = await fresh());
  await signup(p, 'ali.friend@example.com', 'Ali');
  ok('a second new account sees it too', await p.evaluate(() => !!document.getElementById('flow-fr')));
  const before = await p.evaluate(() => Object.values(cData.rocks).flat().length);
  await p.click('#flow-fr [data-fr="skip"]'); await p.waitForTimeout(600);
  const sk = await p.evaluate(async () => ({ gone: !document.getElementById('flow-fr'), rocks: Object.values(cData.rocks).flat().length, mark: await Flow.DB.get('flow:firstrun', null) }));
  ok('Skip closes it, keeps the example week, and is remembered', sk.gone && sk.rocks === before && before > 0 && sk.mark && sk.mark.rocks === 0, sk);
  await ctx.close();

  console.log('\n— who never sees it —');
  ({ ctx, p } = await fresh());
  await signup(p, 'mina.friend@example.com', 'Mina');
  await p.evaluate(() => { const el = document.getElementById('flow-fr'); if (el) el.remove(); });
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(5000);
  ok('someone who chose Advanced: nothing — Advanced is as it was', await p.evaluate(() => !document.getElementById('flow-fr') && document.documentElement.getAttribute('data-flow-look') === 'classic'));
  ok('and a reload does not switch them back to Simple', await p.evaluate(async () => (await Flow.DB.get('flow:settings', {})).newLook === false));
  await ctx.close();
  ({ ctx, p } = await fresh());
  await signup(p, 'ece.friend@example.com', 'Ece');
  await p.evaluate(() => { const el = document.getElementById('flow-fr'); if (el) el.remove(); });
  const legacy = await p.evaluate(async () => { await Flow.DB.set('flow:firstrun', null); const asTemplate = await window.FlowFirstRun.due(); window.FlowAuthState.seed = 'legacy'; const asLegacy = await window.FlowFirstRun.due(); return { asTemplate, asLegacy }; });
  ok('an account that inherited a Flow (legacy) never sees it; a fresh one does', legacy.asTemplate === true && legacy.asLegacy === false, legacy);
  await ctx.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
