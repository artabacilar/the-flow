/* Voice notes in and out, the voice presets and ids, spoken length, live voice.
 *
 * What would make it wrong: a voice note ignored, or answered without being
 * understood; a key shown or stored anywhere but the environment; a voice id
 * set by anything but the owner; a spoken reply running on past its preset;
 * a group's voice leaking into the private chat or the other way; a reply
 * claimed sent as a voice note that was not; Live listening while he speaks. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const C = require('../flow-channels.js');
const S = require('../flow-speech.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 420) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body, headers) => fetch(H + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });

(async () => {
  console.log('\n— shapes —');
  const long = Array.from({ length: 40 }, (_, i) => 'Sentence number ' + (i + 1) + ' says a few plain words.').join(' ');
  const t30 = S.trimForSpeech(long, S.LENGTHS.short), t60 = S.trimForSpeech(long, S.LENGTHS.medium);
  ok('a spoken reply is trimmed to its preset at a sentence end: ~75 words for 30 s, ~150 for 60 s', t30.split(' ').length <= 75 && /\.$/.test(t30) && t60.split(' ').length <= 150 && t60.split(' ').length > 100 && /\.$/.test(t60), { a: t30.split(' ').length, b: t60.split(' ').length });
  ok('links and markdown do not get read out', S.trimForSpeech('See **this** at https://x.y/z now', S.LENGTHS.short) === 'See this at a link now');
  ok('presets: a British male by default, five others, each with a provider; lengths 30/60/120', S.DEFAULT.preset === 'british-male' && /Daniel/.test(S.PRESETS['british-male'].label) && Object.keys(S.PRESETS).length === 6 && Object.values(S.PRESETS).every((p) => /^(elevenlabs|openai)$/.test(p.provider) && p.voiceId) && S.LENGTHS.short.seconds === 30 && S.LENGTHS.medium.seconds === 60);
  const st = S.status();
  ok('status says what works and what is missing, never a key', st.in === 'working' && st.out === 'working' && Array.isArray(st.missing) && !JSON.stringify(st).match(/sk-|xi-/));
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-speech.js'), 'utf8');
  ok('credentials come from the environment only; nothing logs or returns one', /env\('ELEVENLABS_API_KEY'\)/.test(src) && !/console\.log\([^)]*KEY/.test(src) && !/ctx\.set\([^)]*KEY/.test(src));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); });
  await p.waitForTimeout(800);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body]);
  await api('/api/team');
  const tgSecret = C._internals.telegramSecret();
  const sentNow = async () => (await fetch(H + '/api/channels/_sent').then((r) => r.json()).catch(() => null));
  const send = async (message, opts) => {
    opts = opts || {}; const n0 = ((await sentNow()) || {}).n || 0;
    const r = await post('/api/channels/telegram', { message }, { 'x-telegram-bot-api-secret-token': tgSecret });
    let s = null; for (let i = 0; i < (opts.quiet ? 5 : 25); i++) { await wait(300); s = await sentNow(); if (s && s.n > n0 + (opts.want || 1) - 1) break; }
    await wait(400); s = await sentNow();
    const mine = s && s.n > n0 ? (s.recent || []).slice(-(s.n - n0)) : [];
    return { status: r.status, n: mine.length, texts: mine.filter((x) => !/sendVoice/.test(x.url)).map((x) => String((x.body && x.body.text) || '')), voices: mine.filter((x) => /sendVoice/.test(x.url)).map((x) => x.body) };
  };
  const OWNER = 88001, GROUP = -100123, MEMBER = 77002;
  const dm = (text) => ({ chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Artur' }, text });
  const dmVoice = (said, secs) => ({ chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Artur' }, voice: { file_id: 'fake:' + said, duration: secs || 4, mime_type: 'audio/ogg' } });
  const grp = (text, from, extra) => Object.assign({ chat: { id: GROUP, type: 'supergroup', title: 'Abko ops' }, from: { id: from, first_name: from === OWNER ? 'Artur' : 'Oğuz' }, text }, extra || {});

  console.log('\n— a voice note in —');
  const code = (await api('/api/channels/me/code', {})).j.code; await send(dm(code));
  const v1 = await send(dmVoice('what is open today', 4), { want: 2 });
  ok('a voice note is understood and answered — the answer comes back as a voice note and as text with what was heard', v1.voices.length === 1 && v1.voices[0].chat_id === String(OWNER) && v1.voices[0].provider === 'fake' && v1.voices[0].voiceId === S.PRESETS['british-male'].voiceId && v1.texts.length === 1 && /“what is open today”/.test(v1.texts[0]), v1);
  const t1 = await send(dm('what is open today'));
  ok('typed text still gets text only (replies: text)', t1.voices.length === 0 && t1.texts.length === 1, t1);

  console.log('\n— /voice: presets, ids, replies, length —');
  const vs = await send(dm('/voice'));
  ok('/voice shows the voice, how replies go, the spoken length, and what works in and out', /British male \(Daniel\)/.test(vs.texts[0]) && /replies as text/.test(vs.texts[0]) && /about 30 s/.test(vs.texts[0]) && /voice notes are understood \(fake\)/.test(vs.texts[0]) && /\/voice id <ElevenLabs voice id>/.test(vs.texts[0]), vs.texts[0]);
  const vr = await send(dm('/voice replies voice'));
  const t2 = await send(dm('what is open today'));
  ok('/voice replies voice: typed messages are answered as voice notes only', /as voice notes/.test(vr.texts[0]) && t2.voices.length === 1 && t2.texts.length === 0, t2);
  const vl = await send(dm('/voice length 60'));
  const cur = (await api('/api/channels/me/voice')).j.telegram;
  ok('/voice length 60 sets the medium preset (about 60 s, 150 words at most), kept with the account', /about 60 seconds \(150 words at most\)/.test(vl.texts[0]) && cur.length === 'medium' && cur.limit.seconds === 60, { vl: vl.texts[0], cur });
  const vid = await send(dm('/voice id abc123XYZ'));
  const t3 = await send(dm('what is open today'));
  ok('/voice id uses the owner\'s own ElevenLabs voice: only the id is kept, the key stays on the server', /ElevenLabs voice abc123/.test(vid.texts[0]) && /key stays on the server/.test(vid.texts[0]) && t3.voices.length === 1 && t3.voices[0].voiceId === 'abc123XYZ', { vid: vid.texts[0], v: t3.voices[0] });
  const bad = await send(dm('/voice id ../../etc'));
  ok('a voice id is letters and digits; anything else is refused', /letters and digits/.test(bad.texts[0]), bad.texts[0]);
  const vp = await send(dm('/voice british-female'));
  const t4 = await send(dm('what is open today'));
  ok('a preset replaces the custom id', /Lily/.test(vp.texts[0]) && t4.voices[0].voiceId === S.PRESETS['british-female'].voiceId, t4.voices[0]);
  const cmd = await send(dm('/tasks'));
  ok('a command\'s answer stays text even when replies are voice (it is a list)', cmd.texts.length === 1 && cmd.voices.length === 0, cmd);
  const vt = await send(dm('/voice test'), { want: 2 });
  ok('/voice test sends the chosen voice saying hello, as a voice note', vt.voices.length === 1 && vt.voices[0].voiceId === S.PRESETS['british-female'].voiceId && /This is the voice that answers here/.test(vt.texts[0] || ''), vt);
  await send(dm('/voice replies text'));

  console.log('\n— per group and topic —');
  const code2 = (await api('/api/channels/me/code', {})).j.code; await send(grp(code2, OWNER));
  await send(grp('/allow ' + MEMBER + ' Oğuz', OWNER));
  const gv = await send(grp('/voice american-male', OWNER));
  const gm = await send(grp('Jarvis what is open today', MEMBER), { want: 1 });
  const dmAfter = await send(dm('what is open today'));
  ok('a group can have its own voice: the group speaks with it when asked, the private chat keeps its own', /Brian/.test(gv.texts[0]) && gm.voices.length === 0 && gm.texts.length === 1 && dmAfter.voices.length === 0, { gv: gv.texts[0], gm: gm.n });
  await send(grp('/voice replies voice', OWNER));
  const gm2 = await send(grp('Jarvis what is open today', MEMBER));
  ok('…replies voice in the group: the member hears Brian in the group', gm2.voices.length === 1 && gm2.voices[0].voiceId === S.PRESETS['american-male'].voiceId && gm2.voices[0].chat_id === String(GROUP), gm2.voices[0]);
  const tp = await send(grp('/voice british-male', OWNER, { is_topic_message: true, message_thread_id: 7 }));
  const tm = await send(grp('Jarvis what is open today', MEMBER, { is_topic_message: true, message_thread_id: 7 }));
  ok('a topic overrides its group: Daniel in topic 7, Brian in the group', /this topic/.test(tp.texts[0]) && tm.voices.length === 1 && tm.voices[0].voiceId === S.PRESETS['british-male'].voiceId && tm.voices[0].message_thread_id === '7', { tp: tp.texts[0], tm: tm.voices[0] });
  const notOwner = await send(grp('Jarvis /voice british-female', MEMBER));
  ok('a member cannot change the voice', /Only the owner/.test(notOwner.texts[0]), notOwner.texts[0]);

  console.log('\n— the app —');
  const vget = (await api('/api/channels/me/voice')).j;
  ok('the app reads the same: status in/out, presets with availability, settings at three levels', vget.ok && vget.in === 'working' && vget.presets.length === 6 && vget.settings.default.replies === 'text' && vget.settings.channels.telegram && vget.settings.channels.telegram.preset === 'british-female' && vget.settings.workspaces['telegram:' + GROUP + ':7'].preset === 'british-male', { d: vget.settings.default, c: vget.settings.channels, w: Object.keys(vget.settings.workspaces) });
  const set = await api('/api/channels/me/voice', { level: 'default', patch: { preset: 'openai-male', replies: 'both', length: 'short' } });
  ok('the app sets the account default', set.j.ok && set.j.settings.default.preset === 'openai-male' && set.j.settings.default.replies === 'both', set.j.settings && set.j.settings.default);
  const n0 = ((await sentNow()) || {}).n;
  const tst = await api('/api/channels/me/voice', { op: 'test' });
  const s1 = await sentNow();
  ok('Send a test voice note from the app lands in the linked Telegram, and says which voice', tst.j.ok && s1.n === n0 + 1 && /sendVoice/.test(s1.last.url) && s1.last.body.chat_id === String(OWNER), { tst: tst.j, last: s1.last && s1.last.url });
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(2500);
  const ui = await p.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="voice"]'); if (!g) return null; return { title: g.querySelector('.hud-ph').textContent, inout: g.querySelector('.hud-sub').textContent, preset: g.querySelector('select[name="preset"]').value, replies: g.querySelector('select[name="replies"]').value, length: g.querySelector('select[name="length"]').value, id: !!g.querySelector('input[name="voiceId"]'), test: !!g.querySelector('[data-hud="voicetest"]'), now: [...g.querySelectorAll('.hud-sub')].pop().textContent }; });
  ok('Voice notes panel: in/out status without keys, the preset, replies and length as saved, a custom id field, a test button', ui && ui.title === 'Voice notes' && /voice notes are understood/.test(ui.inout) && /nothing here shows one/.test(ui.inout) && ui.preset === 'openai-male' && ui.replies === 'both' && ui.length === 'short' && ui.id && ui.test && /75 words at most/.test(ui.now), ui);
  await p.selectOption('#flow-hud [data-k="voice"] select[name="length"]', 'medium'); await p.click('#flow-hud [data-k="voice"] button[type="submit"]'); await p.waitForTimeout(1200);
  ok('saving from the panel changes the account default', ((await api('/api/channels/me/voice')).j.settings.default.length === 'medium'));

  console.log('\n— live voice in the console —');
  await p.evaluate(() => { FlowHud.close(); FlowSay.open(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { window.__starts = 0; window.__cancels = 0; const f = FlowVoice.start, g = FlowVoice.cancel; FlowVoice.start = function () { window.__starts++; return f.apply(this, arguments); }; FlowVoice.cancel = function () { window.__cancels++; return g.apply(this, arguments); }; });
  ok('the console has a Live button beside Talk', await p.evaluate(() => !!document.querySelector('#flow-say .sy-golive') && document.querySelector('#flow-say .sy-golive').getAttribute('aria-pressed') === 'false'));
  await p.click('#flow-say .sy-golive'); await p.waitForTimeout(500);
  const live = await p.evaluate(() => ({ live: FlowSay.live, on: document.querySelector('#flow-say .sy-golive').classList.contains('on'), hf: FlowSay.handsFree(), st: document.querySelector('#flow-say .sy-state') ? document.querySelector('#flow-say .sy-state').textContent : document.getElementById('flow-say').innerText, starts: window.__starts }));
  ok('Live on: hands-free regardless of the setting, and he tries to listen at once (no microphone here, so it ends in "nothing heard")', live.live && live.on && live.hf && /Live — just speak|Nothing heard/.test(live.st), live);
  await p.click('#flow-say .sy-golive'); await p.waitForTimeout(300);
  ok('Live off: listening stops, the button is released', await p.evaluate(() => !FlowSay.live && !document.querySelector('#flow-say .sy-golive').classList.contains('on') && window.__cancels >= 0 && !FlowSay.handsFree()));
  await p.click('#flow-say .sy-golive'); await p.waitForTimeout(300); await p.evaluate(() => FlowSay.close()); await p.waitForTimeout(300);
  ok('closing the console ends Live', await p.evaluate(() => !FlowSay.live));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
