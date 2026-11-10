/* "Hey J.A.R.V.I.S." — no buttons.
 *
 * What would make it wrong: no ear on a fresh account (it is the default
 * since 8 Nov — "without touching the screen"); a Talk or Stop button
 * while it is on; a pause ending what he is listening to before "over"; words
 * typed into whatever field happens to have focus; his name missed, or the
 * request sent before "over" (or never); "over" sent along as part of the
 * request; the follow-up needing his name again; the ear left open while he
 * speaks (so he hears himself); Talk not taking over when pressed; the ear
 * still open in Advanced; or the microphone line under the box showing when
 * nothing is wrong. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const FAKE = `
window.__voiceLog = [];
window.SpeechRecognition = function () {
  var self = this; self.lang = ''; self.continuous = false; self.interimResults = false; self.maxAlternatives = 1;
  self.start = function () { window.__rec = self; window.__voiceLog.push('start'); };
  self.stop  = function () { window.__voiceLog.push('stop'); if (self.onend) self.onend(); };
  self.abort = function () { window.__voiceLog.push('abort'); if (self.onend) self.onend(); };
};
window.__say = function (text, isFinal) {
  var r = window.__rec; if (!r || !r.onresult) return;
  var results = [[{ transcript: text }]]; results[0].isFinal = !!isFinal; results.length = 1; results[0].length = 1;
  r.onresult({ resultIndex: 0, results: results });
};`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB' });
  await ctx.addInitScript(FAKE);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  const dos = [];
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.route('**/api/flow/do', (rt) => { const j = JSON.parse(rt.request().postData() || '{}'); dos.push(j); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, say: 'Done that, sir.', actions: [] }) }); });
  await p.evaluate(async () => {
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    await Flow.Settings.set('asstVoice', 'off');
  });
  await p.waitForTimeout(2600);

  console.log('\n— on by default, nothing to touch —');
  ok('a fresh account has it on', await p.evaluate(() => Flow.Settings.get('asstWake') === true && Flow.Settings.get('asstWakeV') === 1));
  ok('an account that saved it off before 8 Nov is switched on once', await p.evaluate(() => { const keep = Object.assign({}, Flow.Settings.data); Flow.Settings.data.asstWake = false; delete Flow.Settings.data.asstWakeV; Flow.Settings.migrate(); const a = Flow.Settings.data.asstWake === true; Flow.Settings.data.asstWake = false; Flow.Settings.migrate(); const b = Flow.Settings.data.asstWake === false; Flow.Settings.data = keep; return a && b; }));
  await p.evaluate(() => FlowWake.tick());
  await p.waitForTimeout(400);
  const on = await p.evaluate(() => ({ listening: FlowVoice.listening, sink: !!FlowVoice.sink, mine: FlowWake.mine, dot: !!document.querySelector('#today-feed .lk-say.ear'), say: !!(document.getElementById('flow-say') && document.getElementById('flow-say').classList.contains('on')) }));
  ok('the ear opens by itself, typing nowhere, with no sheet open', on.listening && on.sink && on.mine && !on.say, on);
  ok('Today shows a small live dot', on.dot, on);
  const tb = await p.evaluate(() => { const b = document.querySelector('#today-feed .lk-hello .lk-say:not(.lk-hud)'); return { hidden: !b || b.hidden, dot: !!document.querySelector('#today-feed .lk-hud.ear') }; });
  ok('there is no Talk button on Today at all; the Command centre button carries the listening dot', tb.hidden && tb.dot, tb);
  /* a field with focus must not receive what is heard */
  await p.evaluate(() => { const t = document.createElement('textarea'); t.id = 'other'; document.body.appendChild(t); t.focus(); });
  await p.evaluate(() => window.__say('we were saying the venue is nice', true)); await p.waitForTimeout(300);
  ok('ordinary talk in the room goes nowhere: not into the focused field, no sheet', await p.evaluate(() => document.getElementById('other').value === '' && !document.getElementById('flow-say')?.classList.contains('on') && FlowWake.phase === 'idle'));
  await p.evaluate(() => window.__say('hey Jarvis add milk to', false)); await p.waitForTimeout(300);
  const c1 = await p.evaluate(() => ({ phase: FlowWake.phase, open: document.getElementById('flow-say').classList.contains('on'), live: document.querySelector('#flow-say .sy-live').textContent, state: document.querySelector('#flow-say .sy-state').textContent }));
  ok('"Hey Jarvis" opens him, and what follows shows as it is heard', c1.phase === 'cmd' && c1.open && c1.live === 'add milk to' && /over/i.test(c1.state), c1);
  await p.waitForTimeout(900);
  ok('nothing is sent before "over"', dos.length === 0, dos.length);
  ok('no Talk or Stop button in the console', await p.evaluate(() => { const m = document.querySelector('#flow-say .sy-mic'); return !m || m.hidden; }));
  /* a long pause: he keeps listening */
  await p.waitForTimeout(10500); await p.evaluate(() => FlowWake.tick());
  ok('a ten-second pause ends nothing — still listening, words kept', await p.evaluate(() => FlowWake.phase === 'cmd' && FlowWake.until === 0 && FlowVoice.listening && !!FlowVoice.sink && /add milk to/.test(FlowWake.all())));
  await p.evaluate(() => window.__say('hey Jarvis add milk to tomorrow over', true)); await p.waitForTimeout(900);
  ok('"over" sends it — without the name and without "over"', dos.length === 1 && dos[0].text === 'add milk to tomorrow', dos.map((d) => d.text));
  ok('and the field in focus still has nothing in it', await p.evaluate(() => document.getElementById('other').value === ''));
  await p.waitForTimeout(2600);
  const f = await p.evaluate(() => ({ phase: FlowWake.phase, listening: FlowVoice.listening, sink: !!FlowVoice.sink }));
  ok('after he answers, the ear is back and the next thing needs no name', f.phase === 'cmd' && f.listening && f.sink, f);
  await p.evaluate(() => window.__say('and call mum on Sunday over', true)); await p.waitForTimeout(900);
  ok('a follow-up just goes', dos.length === 2 && dos[1].text === 'and call mum on Sunday', dos.map((d) => d.text));
  ok('it is a conversation: the follow-up carries the first', dos[1] && dos[1].history.length >= 2, dos[1] && dos[1].history.length);

  console.log('\n— he never hears himself —');
  await p.evaluate(() => { window.__sp = FlowSpeech.speaking; FlowSpeech.speaking = () => true; FlowWake.tick(); });
  ok('while he speaks, the ear is shut — or, with no request open, open for his name only', await p.evaluate(() => FlowWake.phase === 'idle' ? FlowWake.barge === true : (!(FlowVoice.listening && FlowVoice.sink) && !FlowWake.mine)));
  await p.evaluate(() => { FlowSpeech.speaking = window.__sp; FlowWake.tick(); }); await p.waitForTimeout(200);
  ok('and opens again when he stops', await p.evaluate(() => FlowVoice.listening && !!FlowVoice.sink));

  console.log('\n— talking over him —');
  await p.evaluate(() => { FlowSay.close(); FlowWake.reset(); window.__stops = 0; window.__st = FlowSpeech.stop; FlowSpeech.stop = () => { window.__stops++; }; window.__sp2 = FlowSpeech.speaking; FlowSpeech.speaking = () => true; FlowWake.tick(); });
  ok('while he speaks unasked, the ear stays open for his name only', await p.evaluate(() => FlowVoice.listening && !!FlowVoice.sink && FlowWake.mine && FlowWake.barge));
  await p.evaluate(() => window.__say('the weather today is fine sir', true)); await p.waitForTimeout(300);
  ok('his own words (or anything else) do not stop him', await p.evaluate(() => window.__stops === 0 && FlowWake.phase === 'idle'));
  await p.evaluate(() => window.__say('hey Jarvis skip the weather', false)); await p.waitForTimeout(300);
  const bi = await p.evaluate(() => ({ stops: window.__stops, phase: FlowWake.phase, live: (document.querySelector('#flow-say .sy-live') || {}).textContent }));
  ok('"Hey Jarvis" over him: he stops talking and listens to what follows', bi.stops >= 1 && bi.phase === 'cmd' && bi.live === 'skip the weather', bi);
  await p.evaluate(() => { FlowSpeech.speaking = window.__sp2; FlowSpeech.stop = window.__st; FlowSay.close(); FlowWake.reset(); FlowWake.tick(); });

  console.log('\n— the console by hand —');
  await p.evaluate(() => { FlowSay.close(); FlowWake.tick(); }); await p.waitForTimeout(300);
  ok('closing the console goes back to waiting for his name', await p.evaluate(() => FlowWake.phase === 'idle' && FlowVoice.listening && !!FlowVoice.sink));
  await p.evaluate(() => FlowSay.open()); await p.waitForTimeout(500);
  ok('opening the console (⌘⇧Space, Siri) listens at once — no name needed, until "over"', await p.evaluate(() => FlowWake.phase === 'cmd' && FlowWake.until === 0 && FlowVoice.listening && !!FlowVoice.sink));
  const bh = dos.length;
  await p.evaluate(() => window.__say('what is left today over', true)); await p.waitForTimeout(900);
  ok('and "over" sends it', dos.length === bh + 1 && dos[dos.length - 1].text === 'what is left today', dos.map((d) => d.text));
  await p.waitForTimeout(2600);
  ok('the unasked follow-up window lapses if nothing is said', await p.evaluate(async () => { FlowWake.until = Date.now() - 1; FlowWake.lastWords = 0; FlowWake.tick(); return FlowWake.phase === 'idle'; }));

  console.log('\n— with it off, Talk is back —');
  await p.evaluate(async () => { FlowSay.close(); await Flow.Settings.set('asstWake', false); FlowWake.tick(); FlowSay.open({ idle: true }); FlowSay.paintMic(); });
  await p.waitForTimeout(300);
  ok('Talk shows again, and so does the Today button', await p.evaluate(() => { const b = document.querySelector('#today-feed .lk-hello .lk-say:not(.lk-hud)'); return !document.querySelector('#flow-say .sy-mic').hidden && b && !b.hidden && /Talk/.test(b.textContent); }));
  await p.click('#flow-say .sy-mic'); await p.waitForTimeout(300);
  const t = await p.evaluate(() => ({ listening: FlowVoice.listening, sink: !!FlowVoice.sink, waiting: FlowSay.waiting, label: document.querySelector('#flow-say .sy-mic').textContent.trim() }));
  ok('pressing Talk: he listens to you, Stop showing', t.listening && !t.sink && t.waiting && t.label === 'Stop', t);
  const before = dos.length;
  await p.evaluate(() => window.__say('remind me to stretch at five over', true)); await p.waitForTimeout(1200);
  const t2 = await p.evaluate(() => ({ listening: FlowVoice.listening && !FlowVoice.sink, waiting: FlowSay.waiting }));
  ok('in Talk too, "over" ends the turn — no Stop needed — and is not sent along', !t2.waiting && dos.length === before + 1 && dos[dos.length - 1].text === 'remind me to stretch at five', { t2, sent: dos.map((d) => d.text) });
  await p.waitForTimeout(400);

  console.log('\n— the microphone line —');
  const mt = await p.evaluate(() => { FlowSay.meter({ db: -20, device: 'Universal Audio Thunderbolt', channels: 32, input: 25, chosen: false }); const m = document.querySelector('#flow-say .sy-meter'); const a = m.hidden; const d = document.querySelector('#flow-say .sy-set'); d.open = true; FlowSay.meter({ db: -20, device: 'Universal Audio Thunderbolt', channels: 32, input: 25 }); const b2 = m.hidden; d.open = false; return { hiddenNormally: a, shownInSettings: !b2 }; });
  ok('"Universal Audio Thunderbolt · input 25" is hidden — shown only with Voice and manners open', mt.hiddenNormally && mt.shownInSettings, mt);
  ok('the setting is there under Voice and manners', await p.evaluate(() => { FlowSay.prefsPaint(); const c = document.querySelector('#flow-say [data-say-pref="asstWake"]'); return !!c && !c.checked; }));
  await p.evaluate(async () => { await Flow.Settings.set('asstWake', true); FlowWake.tick(); });

  console.log('\n— Advanced —');
  await p.evaluate(async () => { FlowSay.close(); await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); FlowTodayLook.applyLook(); FlowWake.tick(); });
  await p.waitForTimeout(300);
  ok('no ear in Advanced', await p.evaluate(() => !FlowWake.mine && !(FlowVoice.listening && FlowVoice.sink)));

  ok('no page errors', errs.length === 0, errs);
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
