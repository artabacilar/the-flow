/* The week never disappears because one browser forgot it.
 *
 * What would make it wrong: a browser holding an empty Week Compass, marked
 * dirty (it wrote a default while cut off), pushing that empty week over the
 * server's real one on the next open; or the guard being so wide that a
 * person who genuinely cleared their week gets it back. */
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
  /* the real week, on the server */
  const wid = await p.evaluate(async () => { const w = weekId(new Date()); cData.rocks[w] = [{ id: 'k1', title: 'Send the venue contract', day: 0, prio: 'high', done: false }, { id: 'k2', title: 'Book the photographer', day: 2, prio: 'med', done: false }]; cSave(); await new Promise((r) => setTimeout(r, 1500)); return w; });
  const server = async () => { const g = await (await fetch(H + '/api/get?key=ld_compass', { headers: { Cookie: (await p.context().cookies()).map((c) => c.name + '=' + c.value).join('; ') } })).json(); const v = typeof g.value === 'string' ? JSON.parse(g.value) : g.value; return ((v && v.rocks) || {})[wid] || []; };
  ok('the week is on the server', (await server()).length === 2);

  console.log('\n— a browser that forgot the week —');
  /* this device: an empty compass, marked as its own edit */
  await p.evaluate((wid) => { const c = JSON.parse(localStorage.getItem('ld_compass')); c.rocks = {}; localStorage.setItem('ld_compass', JSON.stringify(c)); const d = JSON.parse(localStorage.getItem('ld__dirty') || '{}'); d.ld_compass = Date.now(); localStorage.setItem('ld__dirty', JSON.stringify(d)); }, wid);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(6000);
  ok('the server still has the week', (await server()).length === 2, await server());
  const after = await p.evaluate((wid) => ({ rocks: ((cData.rocks || {})[wid] || []).length, dirty: Object.keys(JSON.parse(localStorage.getItem('ld__dirty') || '{}')), bak: !!localStorage.getItem('bak2_ld_compass'), note: sessionStorage.getItem('__flowSyncNote') }), wid);
  ok('and this browser shows it again', after.rocks === 2, after);
  ok('the empty copy was kept aside, not pushed, and is no longer queued', after.bak && !after.dirty.includes('ld_compass'), after);
  ok('the sync says what it did', !!after.note && /empty week/.test(after.note), after.note);

  console.log('\n— a week someone really cleared —');
  await p.evaluate(async (wid) => { cData.rocks[wid] = [{ id: 'k9', title: 'Only this', day: 1, prio: 'med', done: false }]; cSave(); await new Promise((r) => setTimeout(r, 1500)); }, wid);
  ok('one rock left, by choice, reaches the server', (await server()).length === 1 && (await server())[0].id === 'k9', await server());
  await p.evaluate(async (wid) => { const old = cData.rocks[wid]; cData.rocks[wid] = []; cSave(); await new Promise((r) => setTimeout(r, 1500)); }, wid);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(6000);
  ok('clearing the week on purpose, while connected, is honoured', (await server()).length === 0 && (await p.evaluate((wid) => ((cData.rocks || {})[wid] || []).length, wid)) === 0, await server());
  ok('the guard function itself is narrow', await p.evaluate(() => window.__flowEmptierWeek(JSON.stringify({ rocks: {} }), JSON.stringify({ rocks: { '2020-W01': [{ id: 1 }] } })) === false));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
