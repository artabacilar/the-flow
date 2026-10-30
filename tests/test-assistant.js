/* The assistant: a conversation, in a voice.
 *
 * What would make it wrong: the premium voice called with no key, for a free
 * account, past the day's budget, or twice for the same short line; a refusal
 * leaving it silent instead of falling back to the device's voice; it talking
 * back to someone who typed; a question answered without their data, or a
 * follow-up without the conversation; "yes" doing anything other than the
 * plan on screen, "no" changing anything; the title it uses for them being
 * anything but what they chose; markup or an impression of a real character
 * in its instructions. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const E = require('../flow-extras.js')._internals;
const X = E.say, T = E.speak;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

/* 0.25 s of silence as a WAV: something Web Audio can really decode. */
function wav() {
  const n = 11025 / 4, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(11025, 24); b.writeUInt32LE(22050, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

(async () => {
  console.log('\n— its manner —');
  const sir = X.doPersona({ call: 'sir' }), odd = X.doPersona({ call: '<b>Sir</b>; DROP' }), plain = X.doPersona({ persona: 'plain', call: '' });
  ok('a composed British butler, addressing them as they chose', sir.persona === 'butler' && /butler/i.test(sir.text) && /"sir"/.test(sir.text), sir.text);
  ok('it is told not to claim to be, or quote, any character', /Do not claim to be any film or comic character/.test(sir.text));
  ok('what they asked to be called is cleaned of anything but letters', odd.call === 'bSirb DROP', odd.call);
  const named = X.doPersona({ call: 'sir', name: 'J.A.R.V.I.S.' });
  ok('a name they give it is used, as a name only — no backstory', named.name === 'J.A.R.V.I.S.' && /named you "J\.A\.R\.V\.I\.S\."/.test(named.text) && /no backstory, maker or film/.test(named.text), named.text);
  ok('plain is plain, and no title when none was chosen', plain.persona === 'plain' && /Do not use a title/.test(plain.text));
  ok('the reply is written to be spoken: no markdown, no lists, short, the point first', /spoken aloud by a voice: plain sentences, no markdown/.test(X.DO_SYSTEM) && /the point first, in at most three or four short sentences/.test(X.DO_SYSTEM));
  const long = X.parseDo(JSON.stringify({ say: 'x'.repeat(2000), actions: [], end: true }), {});
  ok('an answer may run to a few sentences, and "end" closes the conversation', long.say.length === 900 && long.end === true);

  console.log('\n— Sunday is Sunday —');
  const cal = X.doCalendar('2026-10-30').split('\n');
  ok('the model gets a calendar to copy dates from, each with its weekday and week', cal[0] === 'Friday 2026-10-30 (today) · this week' && cal[2] === 'Sunday 2026-11-01 · this week' && cal[3] === 'Monday 2026-11-02 · next week', cal.slice(0, 4));
  ok('and is told never to work a date out, and that Sunday is never a Monday', /never work a date out yourself/.test(X.DO_SYSTEM) && /Sunday is never a Monday/.test(X.DO_SYSTEM));
  const fx = (said, date) => X.fixWeekdays(said, [{ type: 'rock', title: 'x', date }], '2026-10-30')[0].date;
  ok('"Sunday" put on Monday by the model is moved back to Sunday', fx('call mum on Sunday', '2026-11-02') === '2026-11-01');
  ok('"Sunday next week" keeps the model\'s week, on the Sunday', fx('Sunday next week call mum', '2026-11-09') === '2026-11-08');
  ok('a correct Sunday is left alone', fx('Sunday', '2026-11-01') === '2026-11-01');
  ok('Turkish too: "pazar günü" lands on Sunday, "pazartesi" stays Monday', fx('pazar günü annemi ara', '2026-11-02') === '2026-11-01' && fx('pazartesi toplantı', '2026-11-02') === '2026-11-02');
  ok('two weekdays in one sentence are not guessed at; "sat"/"sunny" are not days', fx('Saturday and Sunday', '2026-11-02') === '2026-11-02' && X.weekdaysSaid('I sat on the sunny side').length === 0 && X.weekdaysSaid('FRIDAY')[0] === 5);

  console.log('\n— questions, with their data and the conversation —');
  const calls = [];
  X.setPoster(async (url, h, payload) => { calls.push(payload); return { status: 200, body: { content: [{ type: 'text', text: '{"say":"Seven hours on average this week, sir.","actions":[]}' }] } }; });
  const mk = (tier) => { const out = {}; return { out, res: { writeHead(s, h) { out.status = s; out.headers = h; }, end(b) { out.bytes = b; } },
    ctx: { json: (r, s, b) => { out.status = s; out.body = b; }, readBody: async () => out.req, plan: { tier: tier || 'plus' },
      mine: { get: async (k) => (k === 'ld_sleep' ? { log: [{ d: '2026-10-29', h: 7 }] } : null) },
      counter: { m: {}, get(k) { return this.m[k] || 0; }, set(k, v) { this.m[k] = v; } } } }; };
  process.env.ANTHROPIC_API_KEY = 'test';
  const q = mk(); q.out.req = JSON.stringify({ text: 'and how did I sleep?', lang: 'en', call: 'sir', ctx: { today: '2026-10-30', rocks: [], habits: [] },
    history: [{ role: 'user', text: 'what is left today?' }, { role: 'assistant', text: 'Two Priorities, sir.' }] });
  await X.handle('/api/flow/do', { method: 'POST' }, q.res, q.ctx);
  const sent = calls[0] || {};
  const sys = (sent.system || []).map((b) => b.text).join('\n');
  ok('the answer comes back as "say", with no actions', q.out.status === 200 && /Seven hours/.test(q.out.body.say) && q.out.body.actions.length === 0, q.out.body);
  ok('their own record is read for it', /THEIR DATA/.test(sys) && /ld_sleep|Sleep/.test(sys) && /"h":7/.test(sys), sys.slice(-300));
  ok('the conversation so far goes with the question', /Conversation so far:\nThey: what is left today\?\nYou: Two Priorities, sir\./.test(sent.messages[0].content), sent.messages && sent.messages[0].content);
  ok('and the manner, with "sir"', /butler/.test(sys) && /"sir"/.test(sys));

  X.setPoster(async (url, h, payload) => { calls.push(payload); return { status: 200, body: { content: [{ type: 'text', text: '{"say":"Shall I add it, sir?","actions":[{"type":"habit","name":"Floss"}]}' }] } }; });
  const wq = mk(); wq.out.req = JSON.stringify({ text: 'add flossing', watch: true, call: 'sir', ctx: { rocks: [], habits: [] } });
  await X.handle('/api/flow/do', { method: 'POST' }, wq.res, wq.ctx);
  ok('asked on a watch it answers only — no actions, and it is told so', wq.out.status === 200 && wq.out.body.actions.length === 0 && /Asked on their Apple Watch/.test(calls[calls.length - 1].messages[0].content), wq.out.body);

  console.log('\n— the premium voice —');
  delete process.env.ELEVENLABS_API_KEY;
  const g0 = mk(); await T.handle('/api/flow/speak', { method: 'GET' }, g0.res, g0.ctx);
  ok('without a key it says so, and the app uses the device voice', g0.out.body && g0.out.body.premium === false);
  const n0 = mk(); n0.out.req = JSON.stringify({ text: 'Very good, sir.' }); await T.handle('/api/flow/speak', { method: 'POST' }, n0.res, n0.ctx);
  ok('a request without a key is refused, marked fallback', n0.out.status === 503 && n0.out.body.fallback === true);
  process.env.ELEVENLABS_API_KEY = 'el-test';
  const tts = [];
  T.setPoster(async (url, h, payload) => { tts.push({ url, h, payload }); return { status: 200, type: 'audio/mpeg', body: Buffer.from('ID3fakeaudio') }; });
  const fr = mk('free'); fr.out.req = JSON.stringify({ text: 'Hello.' }); await T.handle('/api/flow/speak', { method: 'POST' }, fr.res, fr.ctx);
  ok('a free account hears the device voice (402, fallback), and nothing is paid for', fr.out.status === 402 && fr.out.body.fallback && tts.length === 0);
  const g1 = mk(); await T.handle('/api/flow/speak', { method: 'GET' }, g1.res, g1.ctx);
  ok('with a key, Plus is told the premium voice is on', g1.out.body.premium === true && g1.out.body.voice === 'onwK4e9ZLuTAKqWW03F9');
  const s1 = mk(); s1.out.req = JSON.stringify({ text: '  Very   good, sir. ' }); await T.handle('/api/flow/speak', { method: 'POST' }, s1.res, s1.ctx);
  const c1 = tts[0] || {};
  ok('it asks ElevenLabs for the British voice, high quality, with the key in the header', /api\.elevenlabs\.io\/v1\/text-to-speech\/onwK4e9ZLuTAKqWW03F9\?output_format=mp3_44100_128/.test(c1.url) && c1.h['xi-api-key'] === 'el-test' && c1.payload.model_id === 'eleven_multilingual_v2' && c1.payload.text === 'Very good, sir.', c1);
  ok('and sends the audio back as audio', s1.out.status === 200 && s1.out.headers['Content-Type'] === 'audio/mpeg' && String(s1.out.bytes) === 'ID3fakeaudio');
  ok('the characters are counted against the day', s1.ctx.counter.m[Object.keys(s1.ctx.counter.m)[0]] === 15, s1.ctx.counter.m);
  const s2 = mk(); s2.out.req = JSON.stringify({ text: 'Very good, sir.' }); await T.handle('/api/flow/speak', { method: 'POST' }, s2.res, s2.ctx);
  ok('the same short line again comes from the cache — paid for once', tts.length === 1 && s2.out.status === 200);
  const cap = mk(); cap.ctx.counter.m['tts:' + new Date().toISOString().slice(0, 10)] = T.config().cap; cap.out.req = JSON.stringify({ text: 'Something new to say.' });
  await T.handle('/api/flow/speak', { method: 'POST' }, cap.res, cap.ctx);
  ok('past the day\'s budget it falls back rather than spending', cap.out.status === 429 && cap.out.body.fallback && tts.length === 1);
  T.setPoster(async () => ({ status: 401, type: 'application/json', body: Buffer.from('{"detail":"bad key"}') }));
  const bad = mk(); bad.out.req = JSON.stringify({ text: 'Another line.' }); await T.handle('/api/flow/speak', { method: 'POST' }, bad.res, bad.ctx);
  ok('an upstream refusal is a fallback, never silence', bad.out.status === 502 && bad.out.body.fallback === true);
  T.cache.clear(); delete process.env.ELEVENLABS_API_KEY;

  console.log('\n— in the app —');
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  const errs = []; p.on('pageerror', (er) => errs.push(er.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    const t = new Date(); cData.rocks[weekId(t)] = []; cSave();
    await Flow.Settings.set('displayName', 'Artur Abacilar');
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    /* What the device voice would have said, and what the microphone was asked to do. */
    window.__said = []; window.__listen = 0;
    if (window.speechSynthesis) speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 30); };
    const st = FlowVoice.start; FlowVoice.start = function () { window.__listen++; };
  });
  await p.waitForTimeout(700);
  const speak = [], dos = [];
  let premium = true, doReply = { ok: true, say: 'Seven hours on average this week, Artur.', actions: [] };
  await p.route('**/api/flow/speak', async (rt) => {
    const req = rt.request();
    if (req.method() === 'GET') return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ premium }) });
    speak.push(JSON.parse(req.postData() || '{}').text);
    if (!premium) return rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' });
    return rt.fulfill({ status: 200, contentType: 'audio/wav', body: wav() });
  });
  await p.route('**/api/flow/do', (rt) => { dos.push(JSON.parse(rt.request().postData() || '{}')); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doReply) }); });
  const ask = async (text, spoken) => p.evaluate(async ({ text, spoken }) => {
    document.getElementById('sy-text').value = text; FlowSay.typed = !spoken; FlowSay.spoken = !!spoken;
    await FlowSay.send(); await new Promise((r) => setTimeout(r, 900));
  }, { text, spoken });

  await p.click('#today-feed .lk-say'); await p.waitForTimeout(400);
  const pre = await p.evaluate(() => ({ k: document.querySelector('#flow-say .sy-k').textContent, call: document.querySelector('#flow-say [data-say-pref="asstCall"]').value, voice: document.querySelector('#flow-say [data-say-pref="asstVoice"]').value, hands: document.querySelector('#flow-say [data-say-pref="asstHands"]').checked, st: document.querySelector('#flow-say .sy-state').textContent, listened: window.__listen }));
  ok('Talk opens the assistant, listening at once, with the voice settings at hand', pre.k === 'Assistant' && pre.voice === 'premium' && pre.call === 'name' && pre.hands && pre.listened >= 1, pre);
  speak.length = 0;
  await ask('how did I sleep this week?', true);
  const a1 = await p.evaluate(() => ({ log: [...document.querySelectorAll('#flow-say .sy-log .sy-b')].map((x) => x.className + ':' + x.textContent), open: document.querySelector('#flow-say').classList.contains('on'), askv: !document.querySelector('#flow-say .sy-ask').hidden, listened: window.__listen }));
  ok('a spoken question is answered in the conversation, and the sheet stays', a1.open && a1.askv && a1.log.length === 2 && /sy-b u:how did I sleep/.test(a1.log[0]) && /sy-b a:Seven hours/.test(a1.log[1]), a1);
  ok('the answer is spoken in the premium voice', speak.length === 1 && /Seven hours/.test(speak[0]), speak);
  ok('the request carries the manner, the title (their first name) and the language', dos[0] && dos[0].persona === 'butler' && dos[0].call === 'Artur' && dos[0].lang === 'en', dos[0]);
  ok('hands-free: when it has finished speaking, it listens again', a1.listened >= 2, a1.listened);

  doReply = { ok: true, say: 'A Priority for tomorrow: call the venue. Shall I?', actions: [{ type: 'rock', title: 'Call the venue', date: await p.evaluate(() => FlowSay.plusDays(1)) }] };
  await ask('and remind me to call the venue tomorrow', true);
  ok('a follow-up goes with the conversation so far', dos[1] && dos[1].history.length === 2 && /how did I sleep/.test(dos[1].history[0].text), dos[1] && dos[1].history);
  const pl = await p.evaluate(() => ({ cards: document.querySelectorAll('#flow-say .sy-card').length, confirming: FlowSay.confirming, hint: /Say “yes”/.test(document.querySelector('#flow-say .sy-plan').textContent) }));
  ok('a plan waits for a spoken yes, and says so', pl.cards === 1 && pl.confirming && pl.hint, pl);
  speak.length = 0;
  await p.evaluate(async () => { FlowSay.confirmBy('yes please'); await new Promise((r) => setTimeout(r, 900)); });
  const y = await p.evaluate(() => { const w = cData.rocks; let hit = null; Object.keys(w).forEach((k) => (w[k] || []).forEach((r) => { if (r.title === 'Call the venue') hit = r; })); return { hit: !!hit, open: document.querySelector('#flow-say').classList.contains('on'), last: FlowSay.history[FlowSay.history.length - 1].text }; });
  ok('"yes" does exactly the plan on screen', y.hit, y);
  ok('and it answers in kind, by name, and carries on', y.open && /(Done|done|taken care of|in hand), Artur\. Anything else\?/.test(y.last) && speak.length === 1 && speak[0] === y.last, { y, speak });

  doReply = { ok: true, say: 'Shall I mark the insurance done?', actions: [{ type: 'habit', name: 'Floss' }] };
  await ask('add flossing', true);
  await p.evaluate(async () => { FlowSay.confirmBy('no, leave it'); await new Promise((r) => setTimeout(r, 700)); });
  const no = await p.evaluate(() => ({ floss: (hbData.habits || []).some((h) => h.name === 'Floss'), last: FlowSay.history[FlowSay.history.length - 1].text }));
  ok('"no" changes nothing, and says so', !no.floss && /Very well, Artur\. Nothing has been changed\./.test(no.last), no);

  doReply = { ok: true, say: 'Flossing, daily. Shall I?', actions: [{ type: 'habit', name: 'Floss' }] };
  await ask('add flossing', true);
  const before = dos.length;
  doReply = { ok: true, say: 'Flossing on weekdays instead.', actions: [{ type: 'habit', name: 'Floss on weekdays' }] };
  await p.evaluate(async () => { FlowSay.confirmBy('make it weekdays only'); await new Promise((r) => setTimeout(r, 900)); });
  ok('anything else is a correction, sent with the conversation', dos.length === before + 1 && dos[dos.length - 1].text === 'make it weekdays only' && dos[dos.length - 1].history.some((t) => /Flossing, daily/.test(t.text)), dos[dos.length - 1]);

  console.log('\n— typed, silent, and the device voice —');
  speak.length = 0; await p.evaluate(() => { window.__said.length = 0; });
  doReply = { ok: true, say: 'Two Priorities left.', actions: [] };
  await ask('what is left today?', false);
  ok('typed (or dictated with Wispr Flow), he still answers out loud', speak.length === 1 && /Two Priorities left/.test(speak[0]), { speak });
  ok('but he does not start listening after a typed question', await p.evaluate(() => !FlowSay.waiting));
  await p.evaluate(() => { document.querySelector("#flow-say .sy-set").open = true; });
  await p.selectOption('#flow-say [data-say-pref="asstCall"]', 'sir'); await p.waitForTimeout(500);
  ok('"Call me: Sir" is saved, and it now says "sir"', await p.evaluate(() => Flow.Settings.get('asstCall') === 'sir' && FlowSay.call() === 'sir'));
  premium = false; await p.evaluate(() => { FlowSpeech.premium = null; window.__said.length = 0; });
  doReply = { ok: true, say: 'Nothing else today, sir.', actions: [] };
  await ask('anything else today?', true);
  const dev = await p.evaluate(() => window.__said.slice());
  ok('when the premium voice is refused, the device voice says it — never silence', dev.includes('Nothing else today, sir.'), dev);
  await p.selectOption('#flow-say [data-say-pref="asstVoice"]', 'off'); await p.waitForTimeout(300);
  await p.evaluate(() => { window.__said.length = 0; }); speak.length = 0;
  await ask('and tomorrow?', true);
  ok('Silent means silent', speak.length === 0 && (await p.evaluate(() => window.__said.length)) === 0);
  await p.selectOption('#flow-say [data-say-pref="asstVoice"]', 'premium'); premium = true; await p.evaluate(() => { FlowSpeech.premium = null; });
  doReply = { ok: true, say: 'Very good, sir. Until later.', actions: [], end: true };
  await ask('thanks, that is all', true);
  await p.waitForTimeout(600);
  ok('"that is all" signs off and closes', await p.evaluate(() => !document.querySelector('#flow-say').classList.contains('on')));
  console.log('\n— a name —');
  await p.evaluate(() => FlowSay.open()); await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#flow-say .sy-set').open = true; });
  speak.length = 0;
  await p.fill('#sy-name', 'J.A.R.V.I.S.'); await p.press('#sy-name', 'Tab'); await p.waitForTimeout(900);
  const nm = await p.evaluate(() => ({ set: Flow.Settings.get('asstName'), k: document.querySelector('#flow-say .sy-k').textContent, aria: (document.querySelector('#today-feed .lk-say') || {}).getAttribute && document.querySelector('#today-feed .lk-say').getAttribute('aria-label') }));
  ok('naming it J.A.R.V.I.S. shows the name on the sheet', nm.set === 'J.A.R.V.I.S.' && nm.k === 'J.A.R.V.I.S.', nm);
  ok('and the button on Today says "Talk to J.A.R.V.I.S."', await p.evaluate(() => { const b = document.querySelector('#today-feed .lk-say span'); return !!b && b.textContent === 'Talk to J.A.R.V.I.S.'; }));
  ok('and the voice says the name as a word, not letter by letter', speak.some((t) => /^Jarvis, at your service\.$/.test(t)), speak);
  doReply = { ok: true, say: 'J.A.R.V.I.S. here, sir.', actions: [] };
  await ask('who are you?', true);
  ok('the request carries the name; spoken replies say "Jarvis"', dos[dos.length - 1].name === 'J.A.R.V.I.S.' && speak.includes('Jarvis here, sir.'), { name: dos[dos.length - 1].name, speak });
  await p.evaluate(() => FlowSay.close());
  await p.evaluate(async () => { await Flow.Settings.set('asstCall', 'name'); await Flow.Settings.set('asstVoice', 'premium'); await Flow.Settings.set('asstName', ''); });

  console.log('\n— Siri —');
  const siri = await p.evaluate(async () => { FlowSay.close(); window.__flowPendingTalk = true; FlowSay.boot(); await new Promise((r) => setTimeout(r, 900)); return { open: document.querySelector('#flow-say').classList.contains('on'), left: window.__flowPendingTalk }; });
  ok('"Talk to The Flow" from Siri, before the page was ready, opens the assistant once it is', siri.open && siri.left === false, siri);
  await p.evaluate(() => FlowSay.close());
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
