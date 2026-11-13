/* =========================================================================
 * Voice.
 *
 * Two promises, and as with translation they are not equally important.
 *
 * The first is that dictation works: a microphone shows up on the fields you
 * write prose into, what you say arrives at the caret, and the app's own
 * autosave notices. Easy to check, easy to fix.
 *
 * The second is that a recogniser's guesses never reach the page. Speech
 * recognition revises itself constantly — the same three seconds of audio can
 * be "for the record", then "four the wreck", then settle. If those passes
 * are written into the textarea and corrected afterwards, then the draft
 * keeper saves half-formed guesses, undo fills with noise, and a recogniser
 * that dies mid-sentence leaves words in somebody's journal that they never
 * said. Only a segment marked final may be committed, and it is committed
 * once.
 *
 * Underneath both sits the thing that makes Wispr Flow, the iOS keyboard mic
 * and macOS dictation work without a line of code: the app reads values from
 * `input` events rather than reconstructing text from keystrokes, and never
 * re-renders a field while somebody is in it. Those are load-bearing, so they
 * are tested here even though no part of this feature implements them.
 *
 * The recogniser itself is faked. A real one needs a microphone, a network
 * and a person talking, and none of those belong in a test — what is being
 * tested is what the page does with results, not Google's or Apple's
 * accuracy.
 * ====================================================================== */

const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

/* A stand-in for SpeechRecognition, installed before any page script runs.
   Headless Chromium has no real one, and a real one would need a voice. It
   keeps the surface the spec defines and nothing else: the page cannot tell
   it apart, and the test can make it say whatever a recogniser might. */
const FAKE = `
window.__voiceLog = [];
window.SpeechRecognition = function () {
  var self = this;
  self.lang = ''; self.continuous = false; self.interimResults = false;
  self.maxAlternatives = 1;
  self.start = function () { window.__rec = self; window.__voiceLog.push('start:' + self.lang); };
  self.stop  = function () { window.__voiceLog.push('stop'); if (self.onend) self.onend(); };
  self.abort = function () { window.__voiceLog.push('abort'); if (self.onend) self.onend(); };
};
/* What a recogniser would push at the page. */
window.__say = function (text, isFinal) {
  var r = window.__rec; if (!r || !r.onresult) return;
  var results = [[{ transcript: text }]];
  results[0].isFinal = !!isFinal;
  results.length = 1; results[0].length = 1;
  r.onresult({ resultIndex: 0, results: results });
};
window.__fail = function (code) {
  var r = window.__rec; if (r && r.onerror) r.onerror({ error: code });
};
`;

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : '')); }
  };

  const c = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  await c.addInitScript(FAKE);
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);

  console.log('\n— it finds a way to listen —');
  ok('the page carries a voice module', await p.evaluate(() => !!window.FlowVoice));
  ok('it found the browser recogniser', await p.evaluate(() => window.FlowVoice.backendName) === 'web');
  ok('and says it is available', await p.evaluate(() => window.FlowVoice.available === true));

  console.log('\n— signing in —');
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p.fill('#fa-name', 'Artur');
  await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p);
  await p.waitForTimeout(3500);
  ok('signed in', await p.evaluate(() => !document.getElementById('flow-auth')));

  /* ------------------------------------------------------------------ *
   * The microphone shows up where writing happens, and nowhere else
   * ------------------------------------------------------------------ */
  console.log('\n— the microphone follows the field you are in —');

  await p.evaluate(() => { const b = document.querySelector('[data-tab="journal"]'); if (b) b.click(); });
  await p.waitForTimeout(1200);

  await p.evaluate(() => { const el = document.getElementById('jr-body'); if (el) el.focus(); });
  await p.waitForTimeout(300);
  const onJournal = await p.evaluate(() => {
    const m = document.querySelector('.fv-mic');
    return m ? { shown: m.classList.contains('on'), fixed: getComputedStyle(m).position } : null;
  });
  ok('it appears on the journal body', onJournal && onJournal.shown === true, onJournal);
  ok('positioned against the viewport, not wrapped around the field',
    onJournal && onJournal.fixed === 'fixed', onJournal);

  ok('it sits over the field it belongs to', await p.evaluate(() => {
    const m = document.querySelector('.fv-mic'), f = document.getElementById('jr-body');
    const a = m.getBoundingClientRect(), r = f.getBoundingClientRect();
    return a.left >= r.left - 2 && a.right <= r.right + 2 && a.bottom <= r.bottom + 2;
  }));

  /* A password field is the one place a microphone must never appear: it
     would be offering to say a secret out loud. */
  ok('never on a password field', await p.evaluate(() => {
    const i = document.createElement('input'); i.type = 'password';
    document.body.appendChild(i); i.focus();
    const on = document.querySelector('.fv-mic').classList.contains('on');
    i.remove(); return on === false;
  }));

  ok('never on a field that opted out', await p.evaluate(() => {
    const i = document.createElement('textarea'); i.setAttribute('data-voice', 'off');
    document.body.appendChild(i); i.focus();
    const on = document.querySelector('.fv-mic').classList.contains('on');
    i.remove(); return on === false;
  }));

  ok('nor on a number field', await p.evaluate(() => {
    const i = document.createElement('input'); i.type = 'number';
    document.body.appendChild(i); i.focus();
    const on = document.querySelector('.fv-mic').classList.contains('on');
    i.remove(); return on === false;
  }));

  /* ------------------------------------------------------------------ *
   * The invariant
   * ------------------------------------------------------------------ */
  console.log('\n— a guess never reaches the page —');

  await p.evaluate(() => {
    const el = document.getElementById('jr-body');
    el.value = ''; el.focus();
    window.FlowVoice.start(el);
  });
  await p.waitForTimeout(200);

  await p.evaluate(() => window.__say('four the wreckered', false));
  await p.waitForTimeout(150);
  let mid = await p.evaluate(() => ({
    field: document.getElementById('jr-body').value,
    bubble: (document.querySelector('.fv-bubble') || {}).textContent || '',
    hidden: (document.querySelector('.fv-bubble') || {}).hidden
  }));
  ok('an interim guess stays out of the field', mid.field === '', mid);
  ok('and is shown where it is obviously provisional',
    /wreckered/.test(mid.bubble) && mid.hidden === false, mid);
  /* Docked to the viewport, not hung off the field. Anchored to the field it
     always covered something — which is exactly what went wrong. */
  ok('and it does not sit on top of the field being written into', await p.evaluate(() => {
    const bub = document.querySelector('.fv-bubble'), f = document.getElementById('jr-body');
    const a = bub.getBoundingClientRect(), r = f.getBoundingClientRect();
    return a.bottom <= r.top + 1 || a.top >= r.bottom - 1;
  }));

  await p.evaluate(() => window.__say('changed its mind again', false));
  await p.waitForTimeout(150);
  ok('a revised guess still has not touched the field',
    await p.evaluate(() => document.getElementById('jr-body').value) === '');

  await p.evaluate(() => window.__say('For the record, today went well.', true));
  await p.waitForTimeout(250);
  const after = await p.evaluate(() => document.getElementById('jr-body').value);
  ok('only the final segment lands', after === 'For the record, today went well.', after);

  /* ------------------------------------------------------------------ *
   * Landing like typing
   * ------------------------------------------------------------------ */
  console.log('\n— the words arrive the way typed ones do —');

  ok('it fires the input event the app listens for', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.value = ''; el.focus();
    let seen = 0;
    const count = () => seen++;
    el.addEventListener('input', count);
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 120));
    window.__say('one sentence', true);
    await new Promise(r => setTimeout(r, 120));
    el.removeEventListener('input', count);
    return seen === 1;
  }));

  ok('it lands at the caret, not at the end', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.value = 'start  end'; el.focus();
    el.setSelectionRange(6, 6);
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 120));
    window.__say('middle', true);
    await new Promise(r => setTimeout(r, 150));
    return el.value;
  }) === 'start middle end');

  ok('it spaces itself against what is already there', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.value = 'Ran 5k'; el.focus(); el.setSelectionRange(6, 6);
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 120));
    window.__say('and felt fine', true);
    await new Promise(r => setTimeout(r, 150));
    return el.value;
  }) === 'Ran 5k and felt fine');

  ok('two finals in one turn both land, in order', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.value = ''; el.focus();
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 120));
    window.__say('First thing.', true);
    await new Promise(r => setTimeout(r, 120));
    window.__say('Second thing.', true);
    await new Promise(r => setTimeout(r, 150));
    return el.value;
  }) === 'First thing. Second thing.');

  /* ------------------------------------------------------------------ *
   * Stopping, cancelling, failing
   * ------------------------------------------------------------------ */
  console.log('\n— stopping, and giving up —');

  ok('Escape throws the turn away and keeps what was committed', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.value = ''; el.focus();
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 120));
    window.__say('this is committed', true);
    await new Promise(r => setTimeout(r, 120));
    window.__say('this is only a guess', false);
    await new Promise(r => setTimeout(r, 80));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    return { v: el.value, listening: window.FlowVoice.listening };
  }).then(r => r.v === 'this is committed' && r.listening === false));

  ok('a refused microphone is explained, not swallowed', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.value = ''; el.focus();
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 120));
    window.__fail('not-allowed');
    await new Promise(r => setTimeout(r, 150));
    const bub = document.querySelector('.fv-bubble');
    return /blocked|Mikrofon/i.test(bub.textContent) && /bad/.test(bub.className);
  }));

  ok('and a failure leaves the field exactly as it was',
    await p.evaluate(() => document.getElementById('jr-body').value) === '');

  ok('hiding the app stops it listening', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.focus(); window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 120));
    const was = window.FlowVoice.listening;
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 200));
    const now = window.FlowVoice.listening;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    return was === true && now === false;
  }));

  /* ------------------------------------------------------------------ *
   * Language
   * ------------------------------------------------------------------ */
  console.log('\n— it listens in the language the app is set to —');

  await p.evaluate(() => window.FlowI18n.set('tr'));
  await p.waitForTimeout(800);
  ok('Turkish app, Turkish recogniser', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.focus(); window.__voiceLog = [];
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 150));
    window.FlowVoice.cancel();
    return window.__voiceLog.join(',');
  }).then(l => /start:tr-TR/.test(l)));

  ok('the button says so too', await p.evaluate(() =>
    (document.querySelector('.fv-mic') || {}).title) === 'Dikte et');

  await p.evaluate(() => window.FlowI18n.set('en'));
  await p.waitForTimeout(700);
  ok('English app, English recogniser', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.focus(); window.__voiceLog = [];
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 150));
    window.FlowVoice.cancel();
    return window.__voiceLog.join(',');
  }).then(l => /start:en-GB/.test(l)));

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */
  console.log('\n— what Settings says about it —');

  await p.evaluate(() => { const b = document.querySelector('[data-tab="settings"]'); if (b) b.click(); });
  await p.waitForTimeout(1400);
  const card = await p.evaluate(() => {
    const el = document.getElementById('voice-card');
    return el ? { text: el.innerText, dot: (el.querySelector('.vc-dot') || {}).className } : null;
  });
  ok('there is a Voice card', !!card, card);
  ok('it reports the browser will ask on first use',
    card && /ask for the microphone/i.test(card.text), card && card.text.slice(0, 200));
  ok('and marks it ready rather than broken',
    card && /\bok\b/.test(card.dot || ''), card && card.dot);
  ok('it says it listens in the language the app is set to',
    card && /language the app is set to/.test(card.text));

  /* ------------------------------------------------------------------ *
   * A turn belongs to one field
   *
   * The bug this section exists for: leaving the field did not stop the
   * recogniser, so it kept listening with nowhere to put the words, and the
   * bubble kept being repositioned over whatever the person had moved on to.
   * Closing the entry did not help, because closing an entry was never
   * connected to it. It sat there saying "Listening…" indefinitely.
   * ------------------------------------------------------------------ */
  console.log('\n— leaving the field ends the turn —');

  ok('clicking away stops it listening', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.value = ''; el.focus();
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 150));
    const was = window.FlowVoice.listening;

    /* Exactly what happens when somebody closes the editor or opens an old
       entry: focus goes somewhere that is not a writing surface. */
    const btn = document.createElement('button');
    document.body.appendChild(btn); btn.focus();
    await new Promise(r => setTimeout(r, 400));
    const now = window.FlowVoice.listening;
    btn.remove();
    return was === true && now === false;
  }));

  ok('and nothing is left on the screen', await p.evaluate(async () => {
    await new Promise(r => setTimeout(r, 400));
    const bub = document.querySelector('.fv-bubble');
    const mic = document.querySelector('.fv-mic');
    return (!bub || bub.hidden === true) && (!mic || !mic.classList.contains('on'));
  }));

  /* The half-spoken sentence should still land — stop, not cancel. */
  ok('a sentence already under way still reaches the field', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.value = ''; el.focus();
    window.FlowVoice.start(el);
    await new Promise(r => setTimeout(r, 150));
    window.__say('the last thing I said', true);
    await new Promise(r => setTimeout(r, 120));
    const btn = document.createElement('button');
    document.body.appendChild(btn); btn.focus();
    await new Promise(r => setTimeout(r, 400));
    btn.remove();
    return el.value;
  }).then(v => /the last thing I said/.test(v || '')));

  /* A field that is scrolled away, or gone from the page entirely, must take
     its microphone with it — the other way this ended up floating over
     something unrelated. */
  ok('a field removed from the page takes the mic with it', await p.evaluate(async () => {
    const ta = document.createElement('textarea');
    ta.style.cssText = 'position:fixed;left:20px;top:120px;width:300px;height:90px';
    document.body.appendChild(ta); ta.focus();
    await new Promise(r => setTimeout(r, 300));
    const shown = document.querySelector('.fv-mic').classList.contains('on');
    ta.remove();
    await new Promise(r => setTimeout(r, 400));
    const after = document.querySelector('.fv-mic').classList.contains('on');
    return shown === true && after === false;
  }));

  /* ------------------------------------------------------------------ *
   * The properties that make other people's dictation work
   * ------------------------------------------------------------------ */
  console.log('\n— system dictation, which goes through none of the above —');

  /* Wispr Flow and the iOS keyboard mic set the value and fire `input`. They
     never produce keydown, so anything reconstructing text from keys would
     lose every word. This is that exact path. */
  await p.evaluate(() => { const b = document.querySelector('[data-tab="journal"]'); if (b) b.click(); });
  await p.waitForTimeout(1200);

  const dictated = await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.focus();
    el.value = 'Dictated without a single keystroke, exactly as Wispr Flow does it.';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    /* Still there, still focused, not rebuilt underneath the cursor. */
    return {
      value: document.getElementById('jr-body').value,
      sameNode: document.activeElement === el,
      draft: (function () { try { return localStorage.getItem('flow:journal:draft') || ''; } catch (e) { return ''; } })()
    };
  });
  ok('text set without keystrokes survives', /Wispr Flow does it/.test(dictated.value), dictated.value);
  ok('the field is not re-rendered under the cursor', dictated.sameNode === true, dictated);

  ok('and saving it keeps every word', await p.evaluate(async () => {
    const el = document.getElementById('jr-body');
    el.focus();
    el.value = 'Spoken, not typed: nothing here should be rewritten.';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const save = document.querySelector('[data-j="save"]');
    if (save) save.click();
    await new Promise(r => setTimeout(r, 1500));
    const raw = await Flow.DB.get('flow:journal', []);
    return JSON.stringify(raw);
  }).then(s => /Spoken, not typed: nothing here should be rewritten\./.test(s)));

  /* ------------------------------------------------------------------ *
   * Where there is nothing to listen with
   * ------------------------------------------------------------------ */
  console.log('\n— a browser with no recogniser at all —');

  const c2 = await b.newContext({ viewport: { width: 1280, height: 950 }, locale: 'en-GB' });
  await c2.addInitScript(`
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
  `);
  const p2 = await c2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(H + '/', { waitUntil: 'load' });
  await p2.waitForTimeout(2600);

  ok('the module still loads without throwing', await p2.evaluate(() => !!window.FlowVoice));
  ok('it reports no backend', await p2.evaluate(() => window.FlowVoice.backendName) === 'none');
  ok('and says it is unavailable', await p2.evaluate(() => window.FlowVoice.available === false));
  ok('no microphone is drawn anywhere', await p2.evaluate(() => {
    const t = document.createElement('textarea');
    document.body.appendChild(t); t.focus();
    const m = document.querySelector('.fv-mic');
    t.remove();
    return m === null;
  }));
  ok('and nothing broke on that page either', errs2.length === 0, errs2.slice(0, 3));

  console.log('\n— the iPhone app: the first tap asks, it does not say "blocked" —');
  const c3 = await b.newContext();
  await c3.addInitScript(`
    window.__asked = 0; window.__perm = { mic: 'undetermined', speech: 'undetermined' };
    window.Capacitor = { Plugins: { FlowBridge: {
      voiceStart: async () => (window.__perm.mic === 'granted' && window.__perm.speech === 'granted') ? { ok: true } : { ok: false, error: 'denied' },
      voiceStop: async () => ({}), voiceCancel: async () => ({}),
      voicePermission: async () => window.__perm,
      voiceRequest: async () => { window.__asked++; window.__perm = window.__grant || { mic: 'granted', speech: 'granted' }; return window.__perm; }
    } } };
  `);
  const p3 = await c3.newPage();
  await p3.goto(H + '/', { waitUntil: 'load' }); await p3.waitForTimeout(2600);
  const first = await p3.evaluate(async () => {
    const t = document.createElement('textarea'); document.body.appendChild(t); t.focus();
    window.FlowVoice.start(t); await new Promise((r) => setTimeout(r, 300));
    const bub = document.querySelector('.fv-bubble');
    return { asked: window.__asked, listening: window.FlowVoice.listening, said: bub && !bub.hidden ? bub.textContent : '' };
  });
  ok('the first tap shows the system prompts', first.asked === 1, first);
  ok('and once allowed, it is listening — no "blocked" message', first.listening === true && !/blocked/i.test(first.said), first);
  const refused = await p3.evaluate(async () => {
    window.FlowVoice.cancel && window.FlowVoice.cancel();
    window.__perm = { mic: 'undetermined', speech: 'undetermined' }; window.__grant = { mic: 'denied', speech: 'granted' };
    const t = document.querySelector('textarea'); t.focus();
    window.FlowVoice.start(t); await new Promise((r) => setTimeout(r, 300));
    const bub = document.querySelector('.fv-bubble');
    return bub ? bub.textContent : '';
  });
  ok('a refusal says where to turn it on, on an iPhone', /iPhone Settings/.test(refused) && !/this site/.test(refused), refused);
  await c3.close();

  console.log('\n— the Mac app —');
  /* a build from before 26 Oct: FlowMac, but no microphone bridge — WebKit refuses */
  const c4 = await b.newContext();
  await c4.addInitScript(FAKE); await c4.addInitScript(`window.FlowMac = { platform: 'macos' };`);
  const p4 = await c4.newPage();
  await p4.goto(H + '/', { waitUntil: 'load' }); await p4.waitForTimeout(2600);
  const oldMac = await p4.evaluate(async () => {
    if (window.FlowVoice.backendName !== 'web') return 'backend: ' + window.FlowVoice.backendName;
    const t = document.createElement('textarea'); document.body.appendChild(t); t.focus();
    window.FlowVoice.start(t); await new Promise((r) => setTimeout(r, 120));
    window.__fail && window.__fail('not-allowed'); await new Promise((r) => setTimeout(r, 150));
    const bub = document.querySelector('.fv-bubble'); return bub ? bub.textContent : '';
  });
  ok('an old Mac build says the build is the problem, not "this site"', /new Mac build/.test(oldMac) && !/this site/.test(oldMac), oldMac);
  await c4.close();
  /* the current Mac build: a refusal points at System Settings, not iPhone Settings */
  const c5 = await b.newContext();
  await c5.addInitScript(`
    window.FlowMac = { platform: 'macos' };
    window.Capacitor = { Plugins: { FlowBridge: {
      voiceStart: async () => ({ ok: false, error: 'denied' }), voiceStop: async () => ({}), voiceCancel: async () => ({}),
      voicePermission: async () => ({ mic: 'denied', speech: 'granted' }), voiceRequest: async () => ({ mic: 'denied', speech: 'granted' })
    } } };
  `);
  const p5 = await c5.newPage();
  await p5.goto(H + '/', { waitUntil: 'load' }); await p5.waitForTimeout(2600);
  const newMac = await p5.evaluate(async () => {
    const t = document.createElement('textarea'); document.body.appendChild(t); t.focus();
    window.FlowVoice.start(t); await new Promise((r) => setTimeout(r, 300));
    const bub = document.querySelector('.fv-bubble'); return bub ? bub.textContent : '';
  });
  ok('the Mac app says where to turn it on: System Settings → Privacy & Security', /System Settings → Privacy & Security → Microphone/.test(newMac) && !/iPhone/.test(newMac), newMac);
  await c5.close();
  /* the Mac app hears nothing from the chosen input (an audio interface with no voice on it) */
  const c6 = await b.newContext();
  await c6.addInitScript(`
    window.FlowMac = { platform: 'macos' };
    window.__inputs = [{ uid: 'ua', name: 'Universal Audio Thunderbolt', channels: 18, default: true, chosen: false }, { uid: 'cam', name: 'HD Pro Webcam C920', channels: 1, default: false, chosen: false }];
    window.__set = [];
    window.Capacitor = { Plugins: { FlowBridge: {
      voiceStart: async () => { setTimeout(() => window.__flowVoiceEvent('error', { code: 'no-input', device: 'Universal Audio Thunderbolt' }), 50); return { ok: true }; },
      voiceStop: async () => ({}), voiceCancel: async () => ({}),
      voicePermission: async () => ({ mic: 'granted', speech: 'granted' }), voiceRequest: async () => ({ mic: 'granted', speech: 'granted' }),
      voiceInputs: async () => ({ inputs: window.__inputs }), voiceSetInput: async (a) => { window.__set.push(a.uid); return { ok: true }; }
    } } };
  `);
  const p6 = await c6.newPage();
  await p6.goto(H + '/', { waitUntil: 'load' }); await p6.waitForTimeout(2600);
  const ni = await p6.evaluate(async () => {
    const t = document.createElement('textarea'); document.body.appendChild(t); t.focus();
    window.FlowVoice.start(t); await new Promise((r) => setTimeout(r, 300));
    const bub = document.querySelector('.fv-bubble');
    const list = await window.FlowVoice.inputs(); await window.FlowVoice.setInput('cam');
    return { said: bub ? bub.textContent : '', list: (list || []).map((x) => x.name), set: window.__set };
  });
  ok('no sound from the input: it names the device and points at Voice and manners → Microphone', /Universal Audio Thunderbolt/.test(ni.said) && /Voice and manners → Microphone/.test(ni.said), ni);
  ok('the Mac app lists its microphones and remembers the one chosen', ni.list.length === 2 && ni.set[0] === 'cam', ni);
  await c6.close();
  /* the iPhone/Mac recogniser never ends a turn by itself: a pause does, when asked */
  const c7 = await b.newContext();
  await c7.addInitScript(`
    window.__stops = 0;
    window.Capacitor = { Plugins: { FlowBridge: {
      voiceStart: async () => { setTimeout(() => window.__flowVoiceEvent('partial', { text: 'call the' }), 50); setTimeout(() => window.__flowVoiceEvent('partial', { text: 'call the venue' }), 150); return { ok: true }; },
      voiceStop: async () => { window.__stops++; setTimeout(() => { window.__flowVoiceEvent('final', { text: 'call the venue' }); window.__flowVoiceEvent('end', {}); }, 30); return {}; },
      voiceCancel: async () => ({}),
      voicePermission: async () => ({ mic: 'granted', speech: 'granted' }), voiceRequest: async () => ({ mic: 'granted', speech: 'granted' })
    } } };
  `);
  const p7 = await c7.newPage();
  await p7.goto(H + '/', { waitUntil: 'load' }); await p7.waitForTimeout(2600);
  const pz = await p7.evaluate(async () => {
    const seen = []; window.FlowVoice.on((st, x) => { if (st === 'partial') seen.push(x.text); });
    const t = document.createElement('textarea'); document.body.appendChild(t); t.focus();
    window.FlowVoice.start(t, { pauseEnd: 400 });
    await new Promise((r) => setTimeout(r, 300));
    const mid = { listening: window.FlowVoice.listening, stops: window.__stops };
    await new Promise((r) => setTimeout(r, 600));
    const after = { listening: window.FlowVoice.listening, stops: window.__stops, value: t.value }; const seen1 = seen.slice();
    /* a plain field is never ended by a pause */
    const t2 = document.createElement('textarea'); document.body.appendChild(t2); t2.focus();
    window.FlowVoice.start(t2); await new Promise((r) => setTimeout(r, 900));
    const plain = { listening: window.FlowVoice.listening, stops: window.__stops };
    window.FlowVoice.cancel();
    return { seen: seen1, mid, after, plain };
  });
  ok('the words as they come are passed on (the assistant shows them in its panel)', pz.seen.join('|') === 'call the|call the venue', pz.seen);
  ok('after a pause it ends the turn itself and the words land in the field', pz.mid.listening && pz.mid.stops === 0 && !pz.after.listening && pz.after.stops === 1 && pz.after.value === 'call the venue', pz);
  ok('ordinary dictation is not ended by a pause', pz.plain.listening && pz.plain.stops === 1, pz.plain);
  await c7.close();
  /* English or Türkçe: the language the phone's recogniser is asked for */
  const c8 = await b.newContext({ locale: 'en-GB' });
  await c8.addInitScript(`
    window.__locs = [];
    window.Capacitor = { Plugins: { FlowBridge: {
      voiceStart: async (a) => { window.__locs.push(a && a.locale); return { ok: true }; },
      voiceStop: async () => { setTimeout(() => window.__flowVoiceEvent('end', {}), 20); return {}; },
      voiceCancel: async () => ({}),
      voicePermission: async () => ({ mic: 'granted', speech: 'granted' }), voiceRequest: async () => ({ mic: 'granted', speech: 'granted' })
    } } };
  `);
  const p8 = await c8.newPage();
  await p8.goto(H + '/', { waitUntil: 'load' }); await p8.waitForTimeout(2600);
  const lang = await p8.evaluate(async () => {
    const V = window.FlowVoice; const t = document.createElement('textarea'); document.body.appendChild(t); t.focus();
    const before = V.hear();
    V.start(t); await new Promise((r) => setTimeout(r, 200)); V.cancel();
    V.setHear('tr'); const mid = V.hear();
    V.start(t); await new Promise((r) => setTimeout(r, 200)); V.cancel();
    V.setHear('en');
    V.start(t); await new Promise((r) => setTimeout(r, 200)); V.cancel();
    let stored = null; try { stored = localStorage.getItem('flow:hear'); } catch (e) {}
    return { before, mid, locs: window.__locs.slice(), stored };
  });
  ok('English by default; Türkçe asks the phone for tr-TR; back to English after', lang.before === 'en' && lang.mid === 'tr' && lang.locs[0] !== 'tr-TR' && lang.locs[1] === 'tr-TR' && /^en/.test(lang.locs[2]) && lang.stored === 'en', lang);
  await c8.close();

  console.log('\n— press to talk, press to stop —');
  const man = await p.evaluate(async () => {
    const V = window.FlowVoice; const t = document.createElement('textarea'); document.body.appendChild(t); t.focus();
    const starts0 = window.__voiceLog.filter((x) => /^start/.test(x)).length;
    V.start(t, { manual: true, pauseEnd: 300 });
    window.__say('book the', false); window.__say('book the studio', true);
    await new Promise((r) => setTimeout(r, 500));
    /* Chrome closing by itself after silence, with its "no-speech" */
    window.__fail('no-speech'); window.__rec.onend();
    await new Promise((r) => setTimeout(r, 100));
    const bub = document.querySelector('.fv-bubble');
    const mid = { listening: V.listening, starts: window.__voiceLog.filter((x) => /^start/.test(x)).length - starts0, said: bub && !bub.hidden ? bub.textContent : '' };
    window.__say('for Friday', true);
    V.stop(); await new Promise((r) => setTimeout(r, 100));
    return { mid, after: { listening: V.listening, value: t.value } };
  });
  ok('a pause or the browser closing by itself does not end the turn — it keeps listening, quietly', man.mid.listening && man.mid.starts === 2 && !/hear/i.test(man.mid.said), man);
  ok('Stop ends it, and everything said across the gap is in the field', !man.after.listening && /book the studio/.test(man.after.value) && /for Friday/.test(man.after.value), man);
  const sayMan = await p.evaluate(async () => {
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    await Flow.Settings.set('asstWake', false); /* Talk is tested here; "Hey J.A.R.V.I.S." (on by default) in test-wake */
    await new Promise((r) => setTimeout(r, 900));
    const talk = document.querySelector('#today-feed .lk-say'); if (talk) talk.click();
    await new Promise((r) => setTimeout(r, 400));
    const on = window.FlowVoice.listening;
    window.__rec.onend(); await new Promise((r) => setTimeout(r, 150));
    const still = window.FlowVoice.listening;
    const box = document.querySelector('#flow-say [data-say-pref="asstHandsFree"]');
    const mic = document.querySelector('#flow-say .sy-mic'); const label = mic ? mic.textContent.trim() : '';
    if (mic) mic.click(); await new Promise((r) => setTimeout(r, 200));
    const r = { talk: !!talk, on, still, label, stopped: !window.FlowVoice.listening, handsOff: !!box && !box.checked, line: (document.querySelector('#flow-say .sy-state') || {}).textContent || '' };
    try { window.FlowVoice.cancel(); } catch (e) {}
    const w = document.getElementById('flow-say'); if (w) w.classList.remove('on');
    return r;
  });
  ok('Talk on Today starts J.A.R.V.I.S. listening, and silence does not stop him', sayMan.talk && sayMan.on && sayMan.still, sayMan);
  ok('his button says Stop while he listens, and Stop stops him', sayMan.label === 'Stop' && sayMan.stopped, sayMan);
  ok('hands-free is off unless chosen', sayMan.handsOff, sayMan);

  ok('no page errors at any point', errs.length === 0, errs.slice(0, 4));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
