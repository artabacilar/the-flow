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
  const url = await p.evaluate(() => window.__opened[window.__opened.length - 1] || '');
  const rideLine = await p.evaluate(() => [...document.querySelectorAll('#flow-say .sy-did li')].map((x) => x.textContent).join(' | '));
  ok('a ride opens Uber at once with the route filled in, from where you are — he books nothing himself', url.indexOf('https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=') === 0 && decodeURIComponent(url).indexOf('Bomonti Studio, Şişli') > 0 && /Uber ready to confirm/.test(rideLine), { url, rideLine });
  await p.evaluate(() => FlowHud.close()); await p.waitForTimeout(200);

  console.log('\n— a phone, and Advanced —');
  const q = await ctx.newPage(); await q.setViewportSize({ width: 390, height: 844 });
  await q.goto(H + '/?jarvis=1', { waitUntil: 'load' }); await q.waitForTimeout(6000);
  const m = await q.evaluate(() => ({ on: !!(window.FlowHud && FlowHud.on), wide: document.getElementById('flow-hud') ? document.getElementById('flow-hud').scrollWidth : 0, vw: innerWidth,
    orbFirst: (() => { const c = document.querySelector('#flow-hud .hud-core'), t = document.querySelector('#flow-hud [data-k="today"]'); return !!c && !!t && c.getBoundingClientRect().top < t.getBoundingClientRect().top; })() }));
  ok('/?jarvis=1 opens it (what a wall screen points at); on a phone it fits the width, orb first', m.on && m.wide <= m.vw && m.orbFirst, m);
  /* The console on a phone: a dock, not a sheet over the day. */
  const dk = await q.evaluate(() => { const sh = document.querySelector('#flow-say .fn-sheet').getBoundingClientRect(); const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
    return { dock: document.documentElement.classList.contains('hud-dock'), h: sh.height, bottom: Math.round(innerHeight - sh.bottom), text: vis('#flow-say #sy-text'), log: vis('#flow-say .sy-log'), talk: vis('#flow-say .sy-mic'), live: vis('#flow-say .sy-golive'), kb: vis('#flow-say .sy-kb'), go: vis('#flow-say [data-say="send"]'), pad: parseInt(getComputedStyle(document.getElementById('flow-hud')).paddingBottom, 10) }; });
  ok('on a phone the console is a dock at the foot of the screen — one row (Document, Type, Live, Talk), under 90 px, nothing over the dashboard; the text box, the log and Go are put away, and the room leaves it space', dk.dock && dk.h < 90 && dk.bottom <= 1 && !dk.text && !dk.log && dk.talk && dk.live && dk.kb && !dk.go && dk.pad >= dk.h, dk);
  await q.evaluate(() => { FlowSay.history = [{ role: 'user', text: 'Tomorrow at ten call the venue' }, { role: 'assistant', text: 'Done, sir. The venue call is on tomorrow at 10:00.' }]; FlowSay.logPaint(); });
  const cp = await q.evaluate(() => { const c = document.querySelector('#flow-hud .hud-cap'), o = document.querySelector('#flow-hud .hud-orb').getBoundingClientRect(), r = c.getBoundingClientRect(); return { u: c.querySelector('.hud-cap-u').textContent, a: c.querySelector('.hud-cap-a').textContent, underOrb: r.top >= o.bottom - 2, shown: r.height > 0, dock: document.documentElement.classList.contains('hud-dock') }; });
  ok('the words live with the orb: what was said and what he answered appear under it, on the dashboard, while the dock stays a dock', cp.u === 'Tomorrow at ten call the venue' && /Done, sir/.test(cp.a) && cp.underOrb && cp.shown && cp.dock, cp);
  await q.evaluate(() => { try { window.FlowVoice && window.__flowVoiceEvent && 0; } catch (e) {} FlowSay.waiting = true; FlowHud.caption('live', 'start reading twenty'); });
  ok('while he is being spoken to, the live words show under the orb as they come', await q.evaluate(() => { const u = document.querySelector('#flow-hud .hud-cap-u'); return u.classList.contains('live') && u.textContent === 'start reading twenty'; }));
  await q.click('#flow-say .sy-kb'); await q.waitForTimeout(400);
  const op = await q.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }; return { dock: document.documentElement.classList.contains('hud-dock'), text: vis('#flow-say #sy-text'), log: vis('#flow-say .sy-log'), label: document.querySelector('#flow-say .sy-kb span').textContent, focused: document.activeElement && document.activeElement.id === 'sy-text' }; });
  ok('Type opens the dock into the sheet — the text box and the log — with the cursor in the box, and the button now says Hide', !op.dock && op.text && op.log && op.label === 'Hide' && op.focused, op);
  await q.click('#flow-say .sy-kb'); await q.waitForTimeout(300);
  ok('Hide puts it away again', await q.evaluate(() => document.documentElement.classList.contains('hud-dock')));
  await q.evaluate(() => { document.querySelector('#flow-say .sy-plan').hidden = false; }); await q.waitForTimeout(300);
  const pl = await q.evaluate(() => document.documentElement.classList.contains('hud-dock'));
  await q.evaluate(() => { document.querySelector('#flow-say .sy-plan').hidden = true; }); await q.waitForTimeout(300);
  ok('a plan to review opens the sheet by itself and it settles back to the dock when the plan is gone', !pl && await q.evaluate(() => document.documentElement.classList.contains('hud-dock')), pl);
  await q.click('#flow-hud .hud-cap'); await q.waitForTimeout(300);
  ok('tapping the words under the orb opens the whole conversation', await q.evaluate(() => !document.documentElement.classList.contains('hud-dock') && FlowSay.kbOpen));
  await q.evaluate(() => FlowSay.kb(false));
  /* Sending feels like a chat: instant echo, a pulse, then the answer flows in. */
  await q.route('**/api/flow/do', async (rt) => { await new Promise((r) => setTimeout(r, 900)); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, say: 'Done, sir. The venue call is on tomorrow at ten and reading is a daily habit now.', actions: [] }) }); });
  await q.evaluate(async () => { await Flow.Settings.set('asstVoice', 'off'); });
  await q.evaluate(() => { document.getElementById('sy-text').value = 'call the venue tomorrow at ten'; FlowSay.typed = true; FlowSay.send(); });
  await q.waitForTimeout(150);
  const echo = await q.evaluate(() => ({ u: document.querySelector('#flow-hud .hud-cap-u').textContent, thinking: document.querySelector('#flow-hud .hud-cap-a').classList.contains('thinking') }));
  ok('the moment it is sent, what was said is under the orb with his thinking pulse — before the answer comes back', echo.u === 'call the venue tomorrow at ten' && echo.thinking, echo);
  await q.waitForTimeout(1000);
  const half = await q.evaluate(() => document.querySelector('#flow-hud .hud-cap-a').textContent.length);
  await q.waitForTimeout(1500);
  const full = await q.evaluate(() => ({ t: document.querySelector('#flow-hud .hud-cap-a').textContent, thinking: document.querySelector('#flow-hud .hud-cap-a').classList.contains('thinking') }));
  ok('the answer flows in a few words at a time, then stands whole, and the pulse is gone', half > 0 && half < full.t.length + 1 && /reading is a daily habit now\.$/.test(full.t) && !full.thinking, { half, full });
  await q.unroute('**/api/flow/do');
  /* Streamed: the app asks for it, shows each piece as it is written, and ends on the same answer. */
  let askedStream = null;
  const sseBody = ['open', 'Right, ', 'the venue ', 'is on ', 'tomorrow.'].map((v, i) => 'data: ' + JSON.stringify(i ? { t: 'd', v } : { t: 'open' }) + '\n\n').join('') +
    'data: ' + JSON.stringify({ t: 'done', status: 200, body: { ok: true, say: 'Right, the venue is on tomorrow.', actions: [] } }) + '\n\n';
  await q.route('**/api/flow/do', (rt) => { askedStream = JSON.parse(rt.request().postData() || '{}').stream; rt.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sseBody }); });
  await q.evaluate(() => { window.__st = []; const H = window.FlowHud; H.__cap = H.caption; H.caption = function (k, t) { if (k === 'stream') window.__st.push(t); return H.__cap.apply(this, arguments); }; });
  await q.evaluate(() => { document.getElementById('sy-text').value = 'when is the venue'; FlowSay.typed = true; FlowSay.send(); });
  await q.waitForTimeout(900);
  const st = await q.evaluate(() => ({ seen: window.__st.slice(), cap: document.querySelector('#flow-hud .hud-cap-a').textContent, streaming: !!document.querySelector('#flow-hud .hud-cap-a.streaming, #flow-say .sy-b.streaming'), last: (FlowSay.history[FlowSay.history.length - 1] || {}).text }));
  ok('the app asks for a streamed reply, shows it as it is written, and ends with the whole answer in the log', askedStream === true && st.seen.length >= 1 && st.seen[st.seen.length - 1] === 'Right, the venue is on tomorrow.' && st.cap === 'Right, the venue is on tomorrow.' && !st.streaming && st.last === 'Right, the venue is on tomorrow.', st);
  await q.unroute('**/api/flow/do');
  await q.route('**/api/flow/do', (rt) => rt.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'data: {"t":"open"}\n\ndata: {"t":"d","v":"Half an ans"}\n\n' }));
  await q.evaluate(() => { document.getElementById('sy-text').value = 'cut me off'; FlowSay.typed = true; FlowSay.send(); });
  await q.waitForTimeout(700);
  const cut = await q.evaluate(() => ({ state: (document.querySelector('#flow-say .sy-state') || {}).textContent || '', bubble: !!document.querySelector('#flow-say .sy-b.streaming'), last: (FlowSay.history[FlowSay.history.length - 1] || {}).text }));
  ok('a stream cut off half way says so and leaves no half answer behind', /cut off/.test(cut.state) && !cut.bubble && cut.last === 'Right, the venue is on tomorrow.', cut);
  await q.unroute('**/api/flow/do');
  const sse2 = ['open', 'Right. ', 'The venue is ', 'booked for ', 'tomorrow. And the ', 'band confirmed.'].map((v, i) => 'data: ' + JSON.stringify(i ? { t: 'd', v } : { t: 'open' }) + '\n\n').join('') +
    'data: ' + JSON.stringify({ t: 'done', status: 200, body: { ok: true, say: 'Right. The venue is booked for tomorrow. And the band confirmed.', actions: [] } }) + '\n\n';
  await q.route('**/api/flow/do', (rt) => rt.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse2 }));
  await q.evaluate(() => { window.__fed = []; window.__said = []; const S = window.FlowSpeech; S.__f = S.streamFeed; S.__s = S.say; S.__m = S.mode; S.mode = () => 'device'; S.streamFeed = function (st, t) { window.__fed.push(t); }; S.say = function (t) { window.__said.push(t); return Promise.resolve(); }; });
  await q.evaluate(() => { document.getElementById('sy-text').value = 'is the venue sorted'; FlowSay.typed = true; FlowSay.send(); });
  await q.waitForTimeout(900);
  const fd = await q.evaluate(() => ({ fed: window.__fed.slice(), said: window.__said.slice() }));
  ok('he starts speaking at the first full stop: sentences go to the voice as they arrive, not the whole answer at the end', fd.fed[0] === 'Right.' && fd.fed.length >= 3 && fd.fed.join(' ').replace(/\s+/g, ' ').trim() === 'Right. The venue is booked for tomorrow. And the band confirmed.' && fd.said.length === 0, fd);
  await q.evaluate(() => { const S = window.FlowSpeech; S.streamFeed = S.__f; S.say = S.__s; S.mode = S.__m; });
  await q.unroute('**/api/flow/do');
  await q.evaluate(() => { const H = window.FlowHud; H.caption = H.__cap; delete H.__cap; });
  const px = await q.evaluate(() => { const cv = document.querySelector('#flow-hud .hud-orb'); return { square: Math.abs(cv.clientWidth - cv.clientHeight) <= 1, px: cv.width * cv.height, layer: getComputedStyle(cv).willChange }; });
  ok('the orb\'s canvas is square, within its pixel budget, and on its own layer', px.square && px.px <= 520000 * 1.05 && /transform/.test(px.layer), px);
  /* The columns are rewritten only when they change; the orb's clock is one chain and rests when hidden. */
  const wr = await q.evaluate(() => { const l = document.querySelector('#flow-hud .hud-left'); const before = l.firstChild; FlowHud.paintNow(); FlowHud.paintNow(); const same = l.firstChild === before; const raf = FlowHud.raf; return { same, oneChain: typeof raf === 'number', idleRate: FlowHud.FRAME_IDLE >= 40, points: FlowHud.pts ? FlowHud.pts.length : 0 }; });
  ok('a repaint that changes nothing leaves the DOM alone; the orb turns on one chain, at 20 frames a second when idle, with 420 points on a phone', wr.same && wr.oneChain && wr.idleRate && wr.points === 420, wr);
  await q.close();
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); FlowTodayLook.applyLook(); });
  await p.waitForTimeout(1500);
  const mid = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
  const adv = await p.evaluate(() => {
    const h = document.getElementById('flow-hud'), vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
    return { on: FlowHud.on, merge: h.classList.contains('hud-merge'), rail: [...h.querySelectorAll('.hud-ri span')].map((x) => x.firstChild.textContent), heads: [...h.querySelectorAll('.hud-rh')].map((x) => x.textContent),
      strip: [...h.querySelectorAll('.hud-team .hud-agn')].map((x) => x.textContent), x: vis('#flow-hud .hud-x'), orb: vis('#flow-hud .hud-core'), say: document.getElementById('flow-say').classList.contains('on'), sideUnder: (() => { const s = document.getElementById('flow-side'); return !s || +getComputedStyle(h).zIndex > +(getComputedStyle(s).zIndex || 0); })() };
  });
  ok('Advanced is the command centre: it opens by itself, the rail on the left holds J.A.R.V.I.S., the team\'s rooms and the pages of your life, the strip keeps the assistants only, the console is docked, and there is no × to close it', adv.on && adv.merge && adv.rail.join() === 'J.A.R.V.I.S.,Projects,Setup,Memory,Skills,Automations,Efficiency,Today,Plan,Body,Record,Settings' && adv.heads.join() === 'The team,Your life' && adv.strip.join() === 'J.A.R.V.I.S.,Bobby,Sarah,Tom,Hiring assistant,Finance assistant,Add agent,Pause all' && !adv.x && adv.orb && adv.say && adv.sideUnder, adv);
  const centred = async () => p.evaluate(() => { const h = document.getElementById('flow-hud'), c = h.querySelector('.hud-core').getBoundingClientRect(), l = (h.classList.contains('hud-pagemode') ? h.querySelector('.hud-pagecol') : h.querySelector('.hud-left')).getBoundingClientRect(), r = h.querySelector('.hud-right').getBoundingClientRect(); return { vis: getComputedStyle(h.querySelector('.hud-core')).display !== 'none' && c.width > 200 && c.height > 200, off: Math.abs((c.left + c.width / 2) - (l.left + r.right) / 2), round: Math.abs(c.width - c.height) < c.width }; });
  await p.click('#flow-hud [data-hud="page"][data-page="focus"]'); await p.waitForTimeout(900);
  const pg = await p.evaluate(() => ({ page: FlowHud.page, moved: !!document.querySelector('#flow-hud .hud-pagecol .hud-page #tab-northstar'), shown: getComputedStyle(document.getElementById('tab-northstar')).display === 'block', tabs: [...document.querySelectorAll('#flow-hud .hud-pgt .hud-tab')].map((x) => x.textContent), sel: document.querySelector('#flow-hud .hud-ri.sel span').firstChild.textContent, cur: Flow.Nav.current() }));
  const c1 = await centred();
  ok('the orb and the console share one centre line', await p.evaluate(() => { const o = document.querySelector('#flow-hud .hud-orb').getBoundingClientRect(), sh = document.querySelector('#flow-say .fn-sheet').getBoundingClientRect(); return Math.abs((o.left + o.width / 2) - (sh.left + sh.width / 2)) < 2; }));
  ok('Plan opens down the left: the app\'s own North Star page, moved whole, with the group\'s pages as pills — and the orb stays in the middle, a circle', pg.page && pg.page.group === 'focus' && pg.page.tab === 'northstar' && pg.moved && pg.shown && pg.tabs.join() === 'North Star,Priorities,Week Compass,Work,Side Project' && pg.sel === 'Plan' && pg.cur === 'northstar' && c1.vis && c1.off < 3, { pg, c1 });
  await p.click('#flow-hud .hud-pgt .hud-tab[data-tab="quad"]'); await p.waitForTimeout(700);
  ok('a pill switches the page within the group; the one before goes back where it lives', await p.evaluate(() => FlowHud.page.tab === 'quad' && !!document.querySelector('#flow-hud .hud-page #tab-quad') && document.getElementById('tab-northstar').parentElement === document.body));
  await p.evaluate(() => Flow.Nav.go('finance')); await p.waitForTimeout(700);
  ok('anything that navigates to a page lands in the command centre, not behind it', await p.evaluate(() => FlowHud.on && FlowHud.page && FlowHud.page.group === 'record' && FlowHud.page.tab === 'finance' && !!document.querySelector('#flow-hud .hud-page #tab-finance')));
  const ax = await p.evaluate(() => { const o = document.querySelector('#flow-hud .hud-orb').getBoundingClientRect(), sh = document.querySelector('#flow-say .fn-sheet').getBoundingClientRect(), card = document.querySelector('#flow-hud .hud-page .flow-card, #flow-hud .hud-page .panel'); return { d: Math.abs((o.left + o.width / 2) - (sh.left + sh.width / 2)), glass: card ? /gradient/.test(getComputedStyle(card).backgroundImage) : null }; });
  ok('the console stands on the orb\'s axis with a page open, and the page wears the command centre\'s glass, not the old grey cards', ax.d < 2 && ax.glass !== false, ax);
  await p.click('#flow-hud [data-hud="pageclose"]'); await p.waitForTimeout(600);
  ok('× on the page goes back to J.A.R.V.I.S.: the page is home again, the day is round the orb', await p.evaluate(() => !FlowHud.page && document.getElementById('tab-finance').parentElement === document.body && !!document.querySelector('#flow-hud .hud-left [data-k="today"]') && document.querySelector('#flow-hud .hud-ri.sel span').firstChild.textContent === 'J.A.R.V.I.S.'));
  await p.click('#flow-hud .hud-ri[data-hud="memory"]'); await p.waitForTimeout(1500);
  const c2 = await centred();
  ok('Memory in Advanced: the room takes the side columns and the orb stays in the middle', await p.evaluate(() => document.getElementById('flow-hud').classList.contains('hud-memview') && !!document.querySelector('#flow-hud [data-k="memlist"]')) && c2.vis && c2.off < 3, c2);
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  ok('Esc leaves the room for J.A.R.V.I.S.; the command centre itself stays', await p.evaluate(() => FlowHud.on && !document.getElementById('flow-hud').classList.contains('hud-memview') && !!document.querySelector('#flow-hud .hud-left [data-k="today"]')));
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); FlowTodayLook.applyLook(); }); await p.waitForTimeout(800);
  ok('back to Simple: the command centre closes and Simple is as it was — a room one steps into, Memory on the strip, no rail', await p.evaluate(() => !FlowHud.on && !document.getElementById('flow-hud').classList.contains('on') && !!document.querySelector('#today-feed .lk-hud')) && await p.evaluate(async () => { FlowHud.open(); await new Promise((r) => setTimeout(r, 700)); const h = document.getElementById('flow-hud'); const r = !h.classList.contains('hud-merge') && h.querySelectorAll('.hud-ri').length === 0 && !!h.querySelector('.hud-team [data-hud="memory"]') && getComputedStyle(h.querySelector('.hud-x')).display !== 'none'; FlowHud.close(); return r; }));

  ok('no page errors', errs.length === 0, errs);
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
