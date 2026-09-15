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
  ok('it mentions that Wispr Flow and the keyboard mic already work',
    card && /Wispr Flow/.test(card.text));

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

  ok('no page errors at any point', errs.length === 0, errs.slice(0, 4));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
