/* =========================================================================
 * flow-voice.js — say it instead of typing it
 *
 * What this is
 * ------------
 * A microphone that follows whatever field you are typing in. Focus the
 * journal, tap the mic, talk, tap it again. The words land at the cursor as
 * if you had typed them, which means every autosave, draft-keeper and
 * validator the app already has sees them arrive by the route it expects.
 *
 * Three backends, one behaviour
 * -----------------------------
 *   native  the iOS shell, via SFSpeechRecognizer over the bridge. WKWebView
 *           has no SpeechRecognition at all — not prefixed, not behind a flag
 *           — so inside the app this is the only path that exists.
 *   web     SpeechRecognition / webkitSpeechRecognition. Chrome, Edge and
 *           Safari have it; Firefox does not.
 *   none    Firefox, and anything older. The mic is simply never shown. A
 *           button that apologises when pressed is worse than no button.
 *
 * Which one is in play is decided by asking, never by sniffing the user
 * agent — a browser that gains the API tomorrow starts working tomorrow.
 *
 * The rule this file will not break
 * ---------------------------------
 * Provisional text never enters the field. Speech recognisers revise
 * themselves constantly: "for the record" arrives as "four", then "for the
 * wreck", then settles. Writing each guess into the textarea and correcting
 * it afterwards would mean the draft-keeper saves half-formed guesses, undo
 * fills with noise, and a recogniser that dies mid-sentence leaves fragments
 * in somebody's journal that they never said.
 *
 * So interim results live in a bubble docked to the edge of the screen, where
 * they are obviously provisional and cannot cover what is being written. Only
 * a segment the recogniser has marked final is committed, and committing is a
 * real edit at the caret — setRangeText plus an `input` event — so it undoes
 * in one press like any other typing.
 *
 * A turn belongs to one field
 * --------------------------
 * Leaving the field ends it. There is nowhere to put the words once the caret
 * has gone, and a recogniser still running with nothing to write into is how
 * a bubble ends up parked over somebody's journal saying "Listening…" long
 * after they moved on.
 *
 * Dictation that is not ours
 * --------------------------
 * Wispr Flow, macOS dictation and the iOS keyboard mic all type into the
 * field directly and never touch this file. They work because the app reads
 * values from `input` events rather than reconstructing text from keystrokes,
 * and because nothing re-renders a field while it has focus. tests/test-voice.js
 * holds both of those properties down; this comment is only here to say that
 * they are load-bearing.
 * ====================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined' || window.FlowVoice) return;

  /* ---------------------------------------------------------------------
   * Small helpers
   * ------------------------------------------------------------------ */

  var doc = document;

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* The engine may not have loaded — this file has to work on the sign-in
     screen too, where very little else has. */
  function t(en) {
    try {
      if (window.FlowI18n && typeof window.FlowI18n.t === 'function') {
        var out = window.FlowI18n.t(en);
        if (out) return out;
      }
    } catch (e) {}
    return en;
  }

  /* The recogniser wants a BCP-47 tag, and the app only knows 'en' or 'tr'.
     Ask the engine for the locale it already keeps per language rather than
     maintaining a second table that can disagree with the first. */
  function locale() {
    try {
      var e = window.FlowI18n;
      if (e) {
        var meta = (e.languages() || []).filter(function (l) { return l.code === e.lang; })[0];
        if (meta && meta.locale) return meta.locale;
      }
    } catch (err) {}
    try { return navigator.language || 'en-GB'; } catch (err) {}
    return 'en-GB';
  }

  /* ---------------------------------------------------------------------
   * Which fields get a microphone
   *
   * Anything a person writes prose into. Not passwords — obviously — and not
   * the fields where speech is the wrong instrument: a date, a number, a
   * colour. `data-voice="off"` opts a field out by hand; `data-voice="on"`
   * opts one in that these rules would otherwise skip.
   * ------------------------------------------------------------------ */

  var TEXT_TYPES = { text: 1, search: 1, '': 1, null: 1, undefined: 1 };

  function wants(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.disabled || node.readOnly) return false;
    var opt = node.getAttribute && node.getAttribute('data-voice');
    if (opt === 'off') return false;
    if (opt === 'on') return true;
    var tag = node.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    var type = (node.getAttribute('type') || 'text').toLowerCase();
    if (!TEXT_TYPES[type]) return false;
    /* A one-word field — a currency code, a display name — is not worth
       covering with a button; the keyboard is faster than the round trip. */
    if (node.getAttribute('data-type') === 'num') return false;
    return true;
  }

  /* ---------------------------------------------------------------------
   * Committing text
   *
   * The whole point: land the words the way typing would. setRangeText keeps
   * the browser's own undo stack intact where it exists, and the `input`
   * event is what every listener in flow-pack.js is actually bound to.
   * ------------------------------------------------------------------ */

  /* Speech arrives without the spacing that separates it from what is
     already there, and with capitals the recogniser guessed from a sentence
     start that may not be one. Join politely: a space unless we are at the
     very beginning, after an opening bracket, or already after whitespace. */
  function joined(before, text) {
    if (!text) return '';
    if (!before) return text;
    var last = before.charAt(before.length - 1);
    if (/\s/.test(last)) return text;
    if (last === '(' || last === '[' || last === '"' || last === '“') return text;
    if (/^[,.;:!?')\]]/.test(text)) return text;
    return ' ' + text;
  }

  function commit(field, text) {
    if (!field || !text) return;
    var start = field.selectionStart, end = field.selectionEnd;
    /* A field that has never been focused reports null for both, and some
       input types throw on reading them at all. Append in that case. */
    if (start == null || end == null || start !== start) { start = end = field.value.length; }
    var piece = joined(field.value.slice(0, start), text);

    try { field.focus({ preventScroll: true }); } catch (e) { try { field.focus(); } catch (e2) {} }
    try { field.setSelectionRange(start, end); } catch (e) {}

    if (typeof field.setRangeText === 'function') {
      field.setRangeText(piece, start, end, 'end');
    } else {
      field.value = field.value.slice(0, start) + piece + field.value.slice(end);
      try { field.setSelectionRange(start + piece.length, start + piece.length); } catch (e) {}
    }

    /* Bubbling, and of the type the app listens for. `change` follows on stop
       rather than here, so a field that commits on change does it once. */
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---------------------------------------------------------------------
   * Backends
   *
   * Each exposes the same four things, so the controller below never asks
   * which one it has: capable(), start(locale, handlers), stop(), cancel().
   * `handlers` gets { partial, final, error, end }.
   * ------------------------------------------------------------------ */

  /* --- the browser's own recogniser ---------------------------------- */

  var Web = (function () {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    var rec = null;

    return {
      name: 'web',
      capable: function () { return !!Ctor; },

      start: function (loc, h) {
        rec = new Ctor();
        rec.lang = loc;
        rec.continuous = true;
        rec.interimResults = true;
        /* One alternative is all we use, and asking for more makes some
           implementations noticeably slower to settle. */
        rec.maxAlternatives = 1;

        rec.onresult = function (ev) {
          var interim = '';
          for (var i = ev.resultIndex; i < ev.results.length; i++) {
            var r = ev.results[i];
            var said = (r[0] && r[0].transcript) || '';
            if (r.isFinal) { if (said.trim()) h.final(said.trim()); }
            else interim += said;
          }
          h.partial(interim.trim());
        };

        rec.onerror = function (ev) { h.error(ev.error || 'unknown'); };

        /* Chrome ends the session on its own after a stretch of silence even
           with continuous set. Treat that as the end of the turn rather than
           restarting behind the person's back — a mic that silently resumes
           listening is a mic nobody trusts. */
        rec.onend = function () { rec = null; h.end(); };

        try { rec.start(); } catch (e) { rec = null; h.error('start-failed'); h.end(); }
      },

      stop: function () { if (rec) { try { rec.stop(); } catch (e) {} } },
      cancel: function () { if (rec) { var r = rec; rec = null; try { r.abort(); } catch (e) {} } }
    };
  })();

  /* --- the iOS shell -------------------------------------------------- */

  var Native = (function () {
    function plugin() {
      try {
        var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FlowBridge;
        return (p && typeof p.voiceStart === 'function') ? p : null;
      } catch (e) { return null; }
    }

    var live = null;

    /* The bridge is request/response, and recognition is a stream, so the
       shell pushes results in through this instead of answering a promise. */
    window.__flowVoiceEvent = function (type, payload) {
      if (!live) return;
      payload = payload || {};
      if (type === 'partial') live.partial(String(payload.text || ''));
      else if (type === 'final') { var s = String(payload.text || '').trim(); if (s) live.final(s); }
      else if (type === 'error') live.error(String(payload.code || 'unknown'));
      else if (type === 'end') { var h = live; live = null; h.end(); }
    };

    return {
      name: 'native',
      capable: function () { return !!plugin(); },

      start: function (loc, h) {
        var p = plugin();
        if (!p) { h.error('unavailable'); h.end(); return; }
        live = h;
        p.voiceStart({ locale: loc }).then(function (res) {
          res = res || {};
          if (res.ok === false) {
            var had = live; live = null;
            if (had) { had.error(String(res.error || 'unavailable')); had.end(); }
          }
        });
      },

      stop: function () { var p = plugin(); if (p) p.voiceStop(); },
      cancel: function () { live = null; var p = plugin(); if (p) p.voiceCancel(); },

      /* Only the shell can answer these; the web backend has no equivalent
         and does not need one, because the browser prompts by itself. */
      permission: function () {
        var p = plugin();
        if (!p || typeof p.voicePermission !== 'function') return Promise.resolve(null);
        return p.voicePermission();
      },
      request: function () {
        var p = plugin();
        if (!p || typeof p.voiceRequest !== 'function') return Promise.resolve(null);
        return p.voiceRequest();
      }
    };
  })();

  function backend() {
    if (Native.capable()) return Native;
    if (Web.capable()) return Web;
    return null;
  }

  /* ---------------------------------------------------------------------
   * The button, and the bubble above it
   * ------------------------------------------------------------------ */

  var ui = {
    mic: null,
    bubble: null,
    field: null,       /* the field the mic is currently attached to */
    frame: 0
  };

  function build() {
    if (ui.mic) return;

    ui.mic = el('button', 'fv-mic');
    ui.mic.type = 'button';
    ui.mic.setAttribute('aria-label', t('Dictate'));
    ui.mic.setAttribute('title', t('Dictate'));
    ui.mic.innerHTML = '<span class="fv-ico" aria-hidden="true">🎤</span><span class="fv-ring" aria-hidden="true"></span>';

    /* Pressing the mic must not take focus off the field, or the caret — and
       with it the place the words are going — is lost before we start. */
    ui.mic.addEventListener('mousedown', function (e) { e.preventDefault(); });
    ui.mic.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
    ui.mic.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (Voice.listening) Voice.stop(); else Voice.start(ui.field);
    });

    ui.bubble = el('div', 'fv-bubble');
    ui.bubble.setAttribute('role', 'status');
    ui.bubble.setAttribute('aria-live', 'polite');
    ui.bubble.hidden = true;

    doc.body.appendChild(ui.mic);
    doc.body.appendChild(ui.bubble);
  }

  /* Fixed positioning against the field's own rectangle, re-measured on a
     frame rather than on every scroll event — the page has a lot of scrolling
     containers and this way none of them need to know the mic exists. */
  /* Runs every frame, and is the only thing that decides what is on screen.
     That matters more than it sounds: the first version of this let four
     different places — say(), the end handler, cancel() and detach() — each
     turn the bubble off, and one path that forgot left it sitting over
     somebody's journal saying "Listening…" indefinitely. State in, pixels
     out, every frame: there is no path that can forget. */
  function place() {
    if (!ui.mic || !ui.bubble) return;

    var r = null;
    if (ui.field) { try { r = ui.field.getBoundingClientRect(); } catch (e) { r = null; } }
    /* Scrolled out of view, collapsed, or removed from the page entirely —
       a field with no box is not somewhere a microphone belongs. */
    var live = !!(r && r.width && r.height && r.bottom > 8 && r.top < (window.innerHeight - 8));

    if (!live) {
      ui.mic.classList.remove('on');
      ui.bubble.hidden = true;
      return;
    }
    ui.mic.classList.add('on');

    var size = 34, pad = 8;
    var left = Math.min(r.right - size - pad, window.innerWidth - size - pad);
    var top = r.bottom - size - pad;
    /* In a short single-line input the button would cover the text; sit it
       just outside the right edge instead. */
    if (r.height < size + pad * 2) { top = r.top + (r.height - size) / 2; }

    ui.mic.style.left = Math.max(pad, left) + 'px';
    ui.mic.style.top = Math.max(pad, top) + 'px';

    /* The bubble is shown only when it has something to say, and it is never
       hung off the field. Anchoring it there was the whole problem: wherever
       it went it covered something — the words above the field, or the ones
       below it — and a person reading an old entry got a panel across it.
       Docked to the viewport it cannot cover the thing being written into. */
    if (ui.bubble.hidden) return;

    var bw = Math.min(520, window.innerWidth - pad * 2);
    ui.bubble.style.width = bw + 'px';
    ui.bubble.style.left = Math.round((window.innerWidth - bw) / 2) + 'px';

    var bh = ui.bubble.offsetHeight || 32;
    /* Bottom of the screen, unless that is where the field is — on a phone
       with the keyboard up, the field sits low and the bubble would land on
       top of it. */
    var low = r.bottom > window.innerHeight - (bh + 80);
    ui.bubble.style.top = low ? (pad + 'px')
                              : ((window.innerHeight - bh - 24) + 'px');
  }

  function follow() {
    place();
    ui.frame = window.requestAnimationFrame(follow);
  }

  function attach(field) {
    build();
    ui.field = field;
    if (!ui.frame) ui.frame = window.requestAnimationFrame(follow);
    place();
  }

  /* Leaving the field ends the turn.

     This used to return early while listening, on the theory that a turn in
     progress should be left alone. That was wrong twice over. The words have
     nowhere to go once the caret has gone — there is no field to commit them
     to — and nothing else ever stopped the recogniser, so it kept listening
     and the bubble kept being repositioned over whatever the person had
     navigated to. Closing the entry did not help, because closing an entry
     was never connected to it. That is the bug in the screenshot.

     stop() rather than cancel(), so a sentence already half-spoken still
     lands in the field it was meant for. */
  function detach() {
    if (Voice.listening) { Voice.stop(); }
    ui.field = null;
    if (ui.mic) ui.mic.classList.remove('on');
    if (ui.bubble) ui.bubble.hidden = true;
    if (ui.frame) { window.cancelAnimationFrame(ui.frame); ui.frame = 0; }
  }

  /* A pending "clear the error in a moment" timer. Held here so a new turn
     can cancel the last one — otherwise a timer from a previous attempt fires
     three seconds into this one and blanks a bubble that is now in use. */
  var clearTimer = 0;

  function say(text, kind) {
    if (!ui.bubble) return;
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = 0; }
    if (!text) { ui.bubble.hidden = true; place(); return; }
    ui.bubble.textContent = text;
    ui.bubble.className = 'fv-bubble' + (kind ? ' ' + kind : '');
    ui.bubble.hidden = false;
    place();
  }

  /* ---------------------------------------------------------------------
   * Errors worth explaining
   *
   * Recognisers report a dozen codes and most of them mean nothing to the
   * person holding the phone. These four are the ones with an action behind
   * them; everything else gets a plain "that did not work".
   * ------------------------------------------------------------------ */
  function explain(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'denied') {
      return t('The microphone is blocked. Allow it for this site and try again.');
    }
    if (code === 'no-speech') return t("I didn't hear anything.");
    if (code === 'network') return t('Dictation needs a connection right now.');
    if (code === 'audio-capture') return t('No microphone found.');
    if (code === 'unavailable') return t('Dictation is not available on this device.');
    return t('That did not work. Try again.');
  }

  /* ---------------------------------------------------------------------
   * The controller
   * ------------------------------------------------------------------ */

  var Voice = {
    listening: false,
    backend: null,
    field: null,
    subs: [],

    get available() { return !!backend(); },
    get backendName() { var b = backend(); return b ? b.name : 'none'; },

    on: function (fn) { if (typeof fn === 'function') Voice.subs.push(fn); },
    emit: function (state, extra) {
      for (var i = 0; i < Voice.subs.length; i++) {
        try { Voice.subs[i](state, extra || {}); } catch (e) {}
      }
    },

    start: function (field) {
      if (Voice.listening) return;
      field = field || ui.field || doc.activeElement;
      if (!wants(field)) return;

      var b = backend();
      if (!b) return;

      Voice.backend = b;
      Voice.field = field;
      Voice.listening = true;
      if (ui.mic) ui.mic.classList.add('live');
      /* Deliberately nothing on screen yet. The ring pulsing round the
         microphone already says it is listening, and a panel that says so in
         words as well is a panel sitting on top of something worth reading
         for no information at all. It appears when there are words. */
      say('');
      Voice.emit('listening');

      b.start(locale(), {
        partial: function (text) {
          say(text);
        },
        final: function (text) {
          /* Straight into the field, at the caret, as a real edit — and the
             bubble empties, because what it was holding is now in the field
             where the person can see it properly. */
          commit(Voice.field, text);
          say('');
        },
        error: function (code) {
          say(explain(code), 'bad');
          Voice.emit('error', { code: code });
        },
        end: function () {
          Voice.listening = false;
          Voice.backend = null;
          if (ui.mic) ui.mic.classList.remove('live');
          /* An error stays long enough to read. Anything else goes now — a
             half-heard guess is not worth leaving on screen once there is no
             longer a turn it belongs to. */
          var bad = ui.bubble && !ui.bubble.hidden && /\bbad\b/.test(ui.bubble.className);
          if (bad) { clearTimer = setTimeout(function () { clearTimer = 0; if (!Voice.listening) say(''); }, 3200); }
          else say('');

          /* The field's own commit-on-change handlers run now, once, rather
             than after every segment. */
          if (Voice.field) {
            try { Voice.field.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
          }
          Voice.field = null;
          Voice.emit('idle');
          if (!ui.field) detach();
        }
      });
    },

    stop: function () { if (Voice.listening && Voice.backend) Voice.backend.stop(); },

    /* Throw the turn away — nothing is committed. */
    cancel: function () {
      if (!Voice.listening) return;
      var b = Voice.backend;
      Voice.listening = false;
      Voice.backend = null;
      Voice.field = null;
      if (ui.mic) ui.mic.classList.remove('live');
      say('');
      if (b) b.cancel();
      Voice.emit('idle');
    },

    /* What Settings shows. On iOS the shell can answer properly; in a browser
       the honest answer is that the browser asks when you press the button,
       so there is nothing to report until then. */
    permission: function () {
      var b = backend();
      if (b && b.permission) return b.permission();
      if (!b) return Promise.resolve({ supported: false });
      return Promise.resolve({ supported: true, asks: 'on-use' });
    },
    request: function () {
      var b = backend();
      if (b && b.request) return b.request();
      return Promise.resolve(null);
    }
  };

  /* ---------------------------------------------------------------------
   * Wiring
   * ------------------------------------------------------------------ */

  function boot() {
    if (!backend()) return;          /* no mic, no button, no listeners */

    doc.addEventListener('focusin', function (e) {
      var f = e.target;
      if (wants(f)) attach(f);
      else if (f !== ui.mic && !(ui.mic && ui.mic.contains(f))) detach();
    });

    doc.addEventListener('focusout', function (e) {
      /* Focus moving to the mic itself is not leaving the field. */
      setTimeout(function () {
        var a = doc.activeElement;
        if (!wants(a) && a !== ui.mic) detach();
      }, 0);
    });

    /* Escape throws the turn away; the field keeps whatever was already
       committed, which is the same thing Escape does everywhere else. */
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && Voice.listening) { e.preventDefault(); Voice.cancel(); }
    });

    /* Backgrounding the app with the mic open is how a recogniser ends up
       listening to a conversation nobody meant to dictate. */
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden && Voice.listening) Voice.stop();
    });

    /* The labels are translated at build time from whatever language was
       loaded then, so they have to be redone when it changes. */
    try {
      if (window.FlowI18n && window.FlowI18n.on) {
        window.FlowI18n.on(function () {
          if (!ui.mic) return;
          ui.mic.setAttribute('aria-label', t('Dictate'));
          ui.mic.setAttribute('title', t('Dictate'));
        });
      }
    } catch (e) {}
  }

  window.FlowVoice = Voice;

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
