/* The command centre, the loose manner, and "get me a car".
 *
 * What would make it wrong: no way in from Today, or a way in from Advanced;
 * the room opening already listening (Talk is the start); the day round the
 * orb not matching the day (open Priorities, training, habits, spend); the
 * orb not following what he is doing; the console not docked, or its scrim
 * swallowing taps on the panels; Esc, × or the console's close leaving half
 * of it behind; the page wider than a phone; the manner not sent, not
 * changeable by asking, or the loose voice missing its licence to swear; a
 * ride claimed as booked, sent to Uber without the destination, or with an
 * address made up from nothing. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const X = require('../flow-extras.js')._internals.say;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  console.log('\n— the server: manner and rides —');
  const loose = X.doPersona({ persona: 'loose', call: 'sir' }), butler = X.doPersona({ call: 'sir' });
  ok('loose is its own voice: casual, hype, and allowed to swear', loose.persona === 'loose' && /Swearing is allowed/.test(loose.text) && /levelled the fuck up/.test(loose.text) && !/impeccable British butler/.test(loose.text), loose.text.slice(0, 200));
  ok('the butler stays the default', butler.persona === 'butler' && /British butler/.test(butler.text) && !/Swearing/.test(butler.text));
  ok('loose still drops the jokes for bad news, and never slurs', /stressed, drop the jokes/.test(loose.text) && /never slurs/.test(loose.text));
  const pr = X.parseDo(JSON.stringify({ say: 'Uber is ready — just confirm.', actions: [{ type: 'ride', to: 'Bomonti Studio, Şişli, İstanbul' }, { type: 'ride', to: '' }, { type: 'style', style: 'loose' }, { type: 'style', style: 'pirate' }] }), { today: '2026-11-07' });
  ok('a ride keeps its destination; one without a destination is dropped', pr.actions.filter((a) => a.type === 'ride').length === 1 && pr.actions[0].to === 'Bomonti Studio, Şişli, İstanbul' && pr.actions[0].from === '', pr.actions);
  ok('style takes loose or butler only', pr.actions.filter((a) => a.type === 'style').length === 1 && pr.actions[1].style === 'loose', pr.actions);
  const sys = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-extras.js'), 'utf8');
  ok('he is told the ride is confirmed in Uber, never that a car is booked', /never that a car is booked/.test(sys) && /resolved from WHAT YOU KNOW/.test(sys));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    const t = new Date(), w = weekId(t), d = (t.getDay() + 6) % 7;
    cData.rocks = {}; cData.rocks[w] = [{ id: 'a', title: 'Write the brief', day: d, prio: 'med', done: false, time: '11:00' }, { id: 'b', title: 'Call the venue', day: d, prio: 'med', done: false }, { id: 'c', title: 'Old one', day: d, prio: 'med', done: true }];
    cSave();
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    await Flow.Settings.set('asstWake', false); /* Talk is tested here; "Hey J.A.R.V.I.S." (on by default) in test-wake */
    window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; };
  });
  await p.waitForTimeout(900);

  console.log('\n— the way in —');
  ok('"Command centre" sits beside Talk on Today', await p.evaluate(() => { const h = document.querySelector('#today-feed .lk-hello .lk-hud'); return !!h && !!h.previousElementSibling && h.previousElementSibling.classList.contains('lk-say'); }));
  await p.evaluate(() => { window.__starts = 0; const f = FlowVoice.start; FlowVoice.start = function () { window.__starts++; return f.apply(this, arguments); }; });
  await p.click('#today-feed .lk-hud'); await p.waitForTimeout(900);
  const o = await p.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
    const sheet = document.querySelector('#flow-say .fn-sheet').getBoundingClientRect();
    return { on: FlowHud.on && vis('#flow-hud'), say: document.getElementById('flow-say').classList.contains('on'), starts: window.__starts,
      scrim: vis('#flow-say .fn-scrim'), docked: sheet.bottom <= innerHeight && sheet.top > innerHeight * 0.45 && sheet.width <= 730,
      today: (document.querySelector('#flow-hud [data-k="today"] .hud-ph') || {}).textContent, rows: [...document.querySelectorAll('#flow-hud [data-k="today"] .hud-r span')].map((x) => x.textContent),
      train: !!document.querySelector('#flow-hud [data-k="train"]'), habits: (document.querySelector('#flow-hud [data-k="habits"] .hud-big') || {}).textContent,
      spend: !!document.querySelector('#flow-hud [data-k="money"]'), time: document.querySelector('#flow-hud .hud-time').textContent, st: document.getElementById('flow-hud').getAttribute('data-st') };
  });
  ok('it opens full screen, with his console docked at the bottom and no scrim over the room', o.on && o.say && !o.scrim && o.docked, o);
  ok('and does not start listening by itself — Talk is the start', o.starts === 0 && o.st === 'idle', o);
  ok('Today shows what is open, by name, with times', /2 open/.test(o.today) && o.rows.join('|') === 'Write the brief|Call the venue', o);
  ok('training, habits and spend are there, and the clock runs', o.train && /\d+\s*\/\s*\d+/.test(o.habits) && o.spend && /^\d\d:\d\d:\d\d$/.test(o.time), o);
  await p.waitForTimeout(1100);
  ok('the clock ticks', await p.evaluate((t0) => document.querySelector('#flow-hud .hud-time').textContent !== t0, o.time));

  console.log('\n— the orb follows him —');
  await p.click('#flow-say .sy-mic'); await p.waitForTimeout(400);
  const l = await p.evaluate(() => ({ st: document.getElementById('flow-hud').getAttribute('data-st'), status: document.querySelector('#flow-hud .hud-status').textContent, starts: window.__starts }));
  ok('Talk in the console: he listens, and the room says so', l.starts === 1 && l.st === 'listening' && /Listening/.test(l.status), l);
  await p.evaluate(() => { FlowVoice.cancel(); window.__sp = FlowSpeech.speaking; FlowSpeech.speaking = () => true; }); await p.waitForTimeout(300);
  ok('speaking: the orb moves with his voice', await p.evaluate(() => document.getElementById('flow-hud').getAttribute('data-st') === 'speaking'));
  await p.evaluate(() => { FlowSpeech.speaking = window.__sp; }); await p.waitForTimeout(300);
  ok('and back to standing by', await p.evaluate(() => document.getElementById('flow-hud').getAttribute('data-st') === 'idle'));
  const goTo = await p.evaluate(async () => { document.querySelector('#flow-hud [data-k="habits"] .hud-go').click(); await new Promise((r) => setTimeout(r, 400)); return { tab: document.querySelector('.tab.active[data-tab]').getAttribute('data-tab'), hud: FlowHud.on, say: document.getElementById('flow-say').classList.contains('on') }; });
  ok('a panel\'s › takes you to that page and closes the room and the console', goTo.tab === 'habits' && !goTo.hud && !goTo.say, goTo);

  console.log('\n— ways out, and back in —');
  await p.evaluate(() => Flow.Nav.go('today')); await p.waitForTimeout(300);
  await p.keyboard.press('Meta+Shift+J'); await p.waitForTimeout(500);
  if (!(await p.evaluate(() => FlowHud.on))) { await p.keyboard.press('Control+Shift+J'); await p.waitForTimeout(500); }
  ok('⌘⇧J opens it', await p.evaluate(() => FlowHud.on));
  await p.click('#flow-hud .hud-x'); await p.waitForTimeout(300);
  ok('× closes the room and the console together', await p.evaluate(() => !FlowHud.on && !document.getElementById('flow-say').classList.contains('on') && !document.documentElement.classList.contains('hud-on')));

  console.log('\n— manner and rides, in the app —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(500);
  let sent = null;
  await p.route('**/api/flow/do', (rt) => { sent = JSON.parse(rt.request().postData() || '{}'); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, say: 'Fuck yes. Loose it is.', actions: [{ type: 'style', style: 'loose' }] }) }); });
  await p.evaluate(async () => { document.getElementById('sy-text').value = 'talk loose with me'; await FlowSay.send(); });
  await p.waitForTimeout(600);
  ok('the manner goes with every request (butler by default)', sent && sent.persona === 'butler', sent && sent.persona);
  ok('asking for it switches him to loose at once, no "Do it"', await p.evaluate(() => Flow.Settings.get('asstStyle') === 'loose' && FlowSay.style() === 'loose' && document.querySelector('#flow-say [data-say-pref="asstStyle"]').value === 'loose'));
  await p.unroute('**/api/flow/do');
  await p.route('**/api/flow/do', (rt) => { sent = JSON.parse(rt.request().postData() || '{}'); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, say: 'Uber is ready to take you to the studio — just confirm.', actions: [{ type: 'ride', to: 'Bomonti Studio, Şişli', from: '' }] }) }); });
  await p.evaluate(async () => { document.getElementById('sy-text').value = 'get me a car to the studio'; await FlowSay.send(); });
  await p.waitForTimeout(500);
  ok('now it is sent as loose', sent && sent.persona === 'loose', sent && sent.persona);
  const card = await p.evaluate(() => ({ kind: (document.querySelector('#flow-say .sy-card .sy-kind') || {}).textContent, to: (document.querySelector('#flow-say .sy-card input[data-sy-edit="to"]') || {}).value }));
  ok('a ride is a card to confirm, with the destination editable', /Uber/.test(card.kind) && card.to === 'Bomonti Studio, Şişli', card);
  await p.fill('#flow-say .sy-card input[data-sy-edit="to"]', 'Bomonti Studio, Şişli, İstanbul');
  await p.click('#flow-say [data-say="do"]'); await p.waitForTimeout(400);
  const url = await p.evaluate(() => window.__opened[window.__opened.length - 1] || '');
  ok('Do it opens Uber with the route filled in, from where you are', url.indexOf('https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=') === 0 && decodeURIComponent(url).indexOf('Bomonti Studio, Şişli, İstanbul') > 0, url);
  await p.evaluate(() => FlowHud.close()); await p.waitForTimeout(200);

  console.log('\n— a phone, and Advanced —');
  const q = await ctx.newPage(); await q.setViewportSize({ width: 390, height: 844 });
  await q.goto(H + '/?jarvis=1', { waitUntil: 'load' }); await q.waitForTimeout(6000);
  const m = await q.evaluate(() => ({ on: !!(window.FlowHud && FlowHud.on), wide: document.getElementById('flow-hud') ? document.getElementById('flow-hud').scrollWidth : 0, vw: innerWidth,
    orbFirst: (() => { const c = document.querySelector('#flow-hud .hud-core'), t = document.querySelector('#flow-hud [data-k="today"]'); return !!c && !!t && c.getBoundingClientRect().top < t.getBoundingClientRect().top; })() }));
  ok('/?jarvis=1 opens it (what a wall screen points at); on a phone it fits the width, orb first', m.on && m.wide <= m.vw && m.orbFirst, m);
  await q.close();
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); FlowTodayLook.applyLook(); FlowHud.open(); });
  await p.waitForTimeout(400);
  ok('Advanced: no command centre', await p.evaluate(() => !FlowHud.on));

  ok('no page errors', errs.length === 0, errs);
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
