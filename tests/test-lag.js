/* The command centre does not pay for what nobody sees (15 Nov).
 *
 * What would make it wrong: the app under the opaque command centre still
 * drawn; a repaint that changed nothing still rewriting class attributes
 * (each rewrite is a mutation every observer hears and, on Safari's engine,
 * a restyle); the clock replacing nodes every second; the translator
 * walking new panels in English; a forced scroll when a page opens inside
 * the command centre; the freeze log counting a window in the background
 * (timers slowed to one a second) or an app asleep as freezes. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4000);
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); await Flow.Settings.set('asstVoice', 'off'); Flow.Settings.reflect(); FlowTodayLook.applyLook(); });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (!FlowHud.on) FlowHud.open(); });
  await p.waitForTimeout(1500);

  console.log('\n— nothing drawn under the command centre —');
  const under = await p.evaluate(() => {
    const hud = document.getElementById('flow-hud'); let n = 0;
    for (const e of document.body.querySelectorAll(':scope > :is(.header, #flow-side, .section, #flow-ptr) *')) if (!hud.contains(e) && e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) n++;
    const side = document.getElementById('flow-side');
    return { n, side: side ? getComputedStyle(side).contentVisibility : 'none', hudOn: FlowHud.on };
  });
  ok('the header, side bar and pages under it are hidden and skipped', under.hudOn && under.n === 0 && under.side === 'hidden', under);
  await p.click('#flow-hud .hud-rail [data-hud="page"][data-page="today"]'); await p.waitForTimeout(1200);
  const pg = await p.evaluate(() => { const s = document.querySelector('#flow-hud .hud-page > .section'); return { in: !!s, shown: !!s && s.checkVisibility({ visibilityProperty: true }) && s.getBoundingClientRect().height > 50 }; });
  ok('a page opened inside the command centre is still drawn', pg.in && pg.shown, pg);
  await p.click('#flow-hud .hud-rail [data-hud="home"]'); await p.waitForTimeout(800);
  await p.evaluate(() => FlowHud.close(false, true)); await p.waitForTimeout(600);
  ok('closed, the app under it is drawn again', await p.evaluate(() => { const s = document.getElementById('flow-side'); return !!s && getComputedStyle(s).contentVisibility !== 'hidden' && getComputedStyle(s).visibility === 'visible'; }));
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);

  console.log('\n— a repaint that changes nothing changes nothing —');
  const quiet = await p.evaluate(async () => {
    const recs = []; const mo = new MutationObserver((ms) => ms.forEach((m) => recs.push(m.type + ':' + (m.target.id || m.target.className || m.target.nodeName).toString().slice(0, 30) + (m.attributeName ? '@' + m.attributeName : ''))));
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    for (let i = 0; i < 5; i++) { FlowHud.paintNow(); await new Promise((r) => setTimeout(r, 30)); }
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));
    mo.disconnect();
    return recs.filter((r) => !/hud-time|hud-date|characterData/.test(r));
  });
  ok('five repaints of the same room: no class rewrites, no new nodes', quiet.length === 0, quiet.slice(0, 8));
  const tick = await p.evaluate(async () => {
    const recs = []; const mo = new MutationObserver((ms) => ms.forEach((m) => recs.push(m.type))); mo.observe(document.querySelector('#flow-hud .hud-clock'), { childList: true, subtree: true, characterData: true });
    await new Promise((r) => setTimeout(r, 2300)); mo.disconnect();
    return { child: recs.filter((x) => x === 'childList').length, chars: recs.filter((x) => x === 'characterData').length, time: document.querySelector('#flow-hud .hud-clock .hud-time').textContent, date: document.querySelector('#flow-hud .hud-clock .hud-date').textContent };
  });
  ok('the clock ticks by changing one text node: no nodes replaced, the date left alone', tick.child === 0 && tick.chars >= 2 && tick.chars <= 3 && /^\d\d:\d\d:\d\d$/.test(tick.time) && /\w+day/.test(tick.date), tick);

  console.log('\n— the translator in English —');
  const tr = await p.evaluate(async () => { const box = document.createElement('div'); box.innerHTML = '<button class="flow-btn">Save</button>'; document.body.appendChild(box); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); const t = box.textContent; box.remove(); return t; });
  ok('new English text is left exactly as written', tr === 'Save');
  await p.evaluate(() => FlowI18n.set('tr')); await p.waitForTimeout(800);
  const trd = await p.evaluate(async () => { const box = document.createElement('div'); box.innerHTML = '<button class="flow-btn">Save</button>'; document.body.appendChild(box); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60))); const t = box.textContent; box.remove(); return t; });
  ok('in Turkish, new text is still translated as it arrives', trd && trd !== 'Save', trd);
  await p.evaluate(() => FlowI18n.set('en')); await p.waitForTimeout(800);
  ok('back in English, the page is English again', await p.evaluate(() => /Command centre/.test(document.querySelector('#flow-hud .hud-brand span').textContent)));

  console.log('\n— opening a page does not scroll the window —');
  const sc = await p.evaluate(async () => { let n = 0; const real = window.scrollTo; window.scrollTo = function () { n++; return real.apply(this, arguments); }; try { document.querySelector('#flow-hud .hud-rail [data-hud="page"][data-page="body"]').click(); await new Promise((r) => setTimeout(r, 600)); } finally { window.scrollTo = real; } return n; });
  ok('no forced scroll while a page is opened inside the command centre', sc === 0, sc);
  await p.click('#flow-hud .hud-rail [data-hud="home"]'); await p.waitForTimeout(600);
  ok('the console still sits on the orb\'s axis', await p.evaluate(() => document.documentElement.classList.contains('hud-axis') && /px$/.test(document.documentElement.style.getPropertyValue('--hud-cx'))));

  console.log('\n— the freeze log —');
  const fz = await p.evaluate(async () => {
    await Flow.DB.set('flow:diag:stalls', []);
    const block = (ms) => { const t = performance.now(); while (performance.now() - t < ms) {} };
    block(700); await new Promise((r) => setTimeout(r, 900));
    return true;
  });
  await p.waitForTimeout(16000);
  const log = await p.evaluate(() => Flow.DB.get('flow:diag:stalls', []));
  ok('a real freeze in front is still logged', fz && log.some((x) => x.kind === 'freeze' && x.ms >= 150), log.slice(-3));
  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
