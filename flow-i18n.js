/* =========================================================================
 * The Flow — translation
 *
 * The app was written in English with the words sitting in the markup, which
 * is the honest way to build something for yourself. Turning that into two
 * languages had two possible shapes.
 *
 * One was to replace every string in 800 KB of source with a key and a lookup.
 * That is the textbook answer and it is the wrong one here: thousands of edits
 * across files that render by adding strings together, shipped through a patch
 * pipeline, to produce a diff no human could review. Every one of those edits
 * is a chance to break a screen that currently works.
 *
 * The other is this. The dictionary is keyed on the English sentence itself,
 * and the translation happens to the rendered page — text nodes, placeholders,
 * labels, the document title — with an observer catching whatever the app
 * draws next. The source keeps saying what it says. Adding a language adds a
 * file and touches nothing else.
 *
 * The cost of that choice is a rule this file takes seriously: it must never
 * translate what a person wrote. A habit called "Read", a note that happens to
 * say "Done" — those are theirs, and a dictionary that rewrote them would be a
 * far worse bug than an untranslated button. So nothing is translated unless
 * it matches a known English string exactly, single words are only translated
 * inside things that are obviously furniture (a button, a tab, a table head),
 * and anything a person can type into is never touched at all.
 *
 *   FlowI18n.lang                 'en' | 'tr'
 *   FlowI18n.set('tr')            switch the live page, no reload
 *   FlowI18n.t('Saved {}', name)  translate inside code, before it renders
 *   FlowI18n.on(fn)               called whenever the language changes
 *   FlowI18n.missing()            English seen on screen with no translation
 * ====================================================================== */

(function (global) {
  'use strict';

  var DEFAULT = 'en';

  /* Languages register themselves by calling FlowI18n.add(). English is the
     source language and needs no dictionary — it is what the markup says. */
  var LANGS = {
    en: { code: 'en', name: 'English', native: 'English', locale: 'en-GB', dict: null },
    tr: { code: 'tr', name: 'Turkish', native: 'Türkçe', locale: 'tr-TR', dict: null, src: '/flow-lang-tr.js' }
  };

  /* ---------------------------------------------------------------- state */

  var lang = DEFAULT;
  var active = null;            // compiled dictionary for `lang`, or null for English
  var listeners = [];
  var observer = null;
  var started = false;
  var unknown = Object.create(null);

  /* What we wrote, and what it said before we wrote it. Restoring from here is
     exact; the reverse dictionary below is the fallback for nodes that were
     translated by a previous pass and then moved, or that arrived already
     translated from a cached render. */
  var MEM = new WeakMap();      // Text node  -> original English
  var AMEM = new WeakMap();     // Element    -> { attr: original English }

  /* ------------------------------------------------------- what to ignore */

  /* Anything a person can type into, anything holding code, and anything the
     app has explicitly marked as its own. `data-i18n="off"` on a container is
     the escape hatch for a region that turns out to hold user words. */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1, SVG: 1, NOSCRIPT: 1, TEMPLATE: 1 };

  /* Furniture. A single word is only translated inside one of these, because
     "Read" in a heading is a label and "Read" in a list is somebody's habit. */
  /* What counts as furniture. The test is not "is this ours" — it is "could a
     person's own word ever land here". A heading, a tab, a column label: no.
     A list row, a card title somebody named, a metric they added: yes, and
     those are deliberately absent.

     The class patterns matter more than they look. Half this app's labels are
     .flow-label and .fn-grouplbl, and while those were missing, single words
     like "Quality" and "Recovery" stayed in English on an otherwise Turkish
     screen — the translation was there, nothing was allowed to use it. */
  var CHROME = 'button,label,th,h1,h2,h3,h4,h5,h6,option,optgroup,summary,legend,' +
               'caption,nav,[role="button"],[role="tab"],[data-tab],.tab,.flow-btn,' +
               '.flow-sub,.flow-empty,.flow-chip,.fn-txt,.mg-lbl,.sw-sub,' +
               '[class*="lbl"],[class*="label"],[data-i18n="on"]';

  var ATTRS = ['placeholder', 'title', 'aria-label', 'aria-placeholder', 'alt', 'data-empty'];

  function skipped(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP_TAGS[n.nodeName]) return true;
      if (n.isContentEditable) return true;
      var f = n.getAttribute && n.getAttribute('data-i18n');
      if (f === 'off') return true;
      if (f === 'on') return false;
    }
    return false;
  }

  function isChrome(el) {
    try { return !!(el && el.closest && el.closest(CHROME)); } catch (e) { return false; }
  }

  /* --------------------------------------------------------- the dictionary */

  /* A dictionary is a flat object of English -> translation. Keys holding {}
     stand for a family of sentences with a value dropped in; those become
     patterns. Everything else is an exact match and goes in a Map, which is
     the only lookup that runs for the overwhelming majority of nodes.

     Patterns are bucketed by the first few characters of their opening
     literal, so a string that could never match them is never tested against
     them. The ones that begin with a value have nothing to bucket on and are
     tried last, and there are very few of those. */
  /* The same sentence reaches us two ways. A source file writes what's with a
     straight apostrophe; the page renders what&rsquo;s as a curly one, and the
     two are different strings to a Map. Normalising both sides is the
     difference between "keep what's working" being translated and sitting
     there in English on an otherwise Turkish screen — which is exactly where
     it sat until a screenshot showed it. The same goes for the three kinds of
     dash and the two kinds of double quote. */
  function norm(s) {
    return String(s)
      .replace(/[\u2018\u2019\u201B\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u00A0/g, ' ');
  }

  function compile(dict, rules) {
    var exact = new Map();
    var buckets = new Map();
    var open = [];
    var reverse = new Map();

    Object.keys(dict).forEach(function (key) {
      var val = dict[key];
      if (typeof val !== 'string' || !val) return;
      if (key.indexOf('{}') < 0) {
        exact.set(key, val);
        var n = norm(key);
        if (n !== key && !exact.has(n)) exact.set(n, val);
        if (!reverse.has(val)) reverse.set(val, key);
        var nv = norm(val);
        if (nv !== val && !reverse.has(nv)) reverse.set(nv, key);
        return;
      }
      var rule = { key: key, val: val, rx: toRegex(key), n: (key.match(/\{\}/g) || []).length,
                   marks: marksOf(key), cap: capOf(key) };
      var head = key.slice(0, key.indexOf('{}'));
      if (head.length >= 3) {
        var b = head.slice(0, 3);
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b).push(rule);
      } else {
        open.push(rule);
      }
      /* The reverse of a pattern is the same pattern read the other way, which
         only works when the translation keeps every value. It usually does. */
      if ((val.match(/\{\d*\}/g) || []).length === rule.n) {
        rule.back = { rx: toRegex(val.replace(/\{\d+\}/g, '{}')), val: key, order: orderOf(val) };
      }
    });

    return { exact: exact, buckets: buckets, open: open, reverse: reverse, rules: rules || [] };
  }

  /* The literal pieces between the values, as bare marks. "Week {} · {}{}"
     gives ["Week", "·"]. A capture that contains one of these has eaten a
     separator, which means the pattern matched something it was never meant
     to: the navigation strip "Week · Priorities · Training · …" fits that key
     perfectly and came out reordered into nonsense on a real screen. */
  function marksOf(key) {
    return key.split('{}')
      .map(function (p) { return p.trim(); })
      .filter(function (p) { return p.length >= 1 && /[^\s]/.test(p); });
  }

  /* How much text a key of this size is entitled to swallow. A key that is
     almost all value — "Week {}" — has no business matching eighty characters
     of navigation; a key that is a whole sentence can reasonably carry a long
     one. Six times the literal length, with a floor, draws that line without
     needing to know anything about either language. */
  function capOf(key) {
    var lit = key.split('{}').join('').length;
    return Math.max(60, lit * 6);
  }

  function clean(m, marks, cap) {
    for (var i = 1; i < m.length; i++) {
      var got = m[i];
      if (!got) continue;
      if (got.length > cap) return false;
      for (var j = 0; j < marks.length; j++) {
        if (got.indexOf(marks[j]) >= 0) return false;
      }
    }
    return true;
  }

  function toRegex(key) {
    var parts = key.split('{}').map(function (p) {
      return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    /* A value is never empty and never spans a sentence: lazy, but at least
       one character, and no newlines, so one rule cannot swallow the next. */
    return new RegExp('^' + parts.join('([^\\n]+?)') + '$');
  }

  /* "{2} kaldı, {1} gitti" -> [2, 1]; plain {} means keep the order it came in. */
  function orderOf(val) {
    var out = [], i = 0, m, rx = /\{(\d*)\}/g;
    while ((m = rx.exec(val))) { i++; out.push(m[1] ? parseInt(m[1], 10) : i); }
    return out;
  }

  function fill(template, vals) {
    var i = 0;
    return template.replace(/\{(\d*)\}/g, function (_, d) {
      var v = d ? vals[parseInt(d, 10) - 1] : vals[i];
      i++;
      return v == null ? '' : v;
    });
  }

  /* ------------------------------------------------------------ lookup */

  function translate(text) {
    if (!active) return null;
    var hit = active.exact.get(text);
    if (hit !== undefined) return hit;
    var flat = norm(text);
    if (flat !== text) {
      hit = active.exact.get(flat);
      if (hit !== undefined) return hit;
    }

    var tried = active.buckets.get(flat.slice(0, 3));
    text = flat;
    var m, r, i;
    if (tried) {
      for (i = 0; i < tried.length; i++) {
        r = tried[i];
        m = r.rx.exec(text);
        if (m && clean(m, r.marks, r.cap)) return fill(r.val, m.slice(1));
      }
    }
    for (i = 0; i < active.open.length; i++) {
      r = active.open[i];
      m = r.rx.exec(text);
      if (m && clean(m, r.marks, r.cap)) return fill(r.val, m.slice(1));
    }

    /* Last: the rules a language supplies for things no dictionary can hold —
       dates, month names inside a sentence, anything whose shape is fixed but
       whose content is not. Every rule is anchored to the whole string by
       construction, which is what keeps them off a person's own writing: a
       rule that matches "Thu 17 Sept" exactly cannot also match a note that
       happens to mention Thursday. */
    for (i = 0; i < active.rules.length; i++) {
      var rule = active.rules[i];
      m = rule.rx.exec(text);
      if (m) {
        var out = rule.to(m);
        if (out != null && out !== text) return out;
      }
    }
    return null;
  }

  /* Going back to English. The remembered original is always right; the
     reverse dictionary is for nodes we have no memory of. */
  function untranslate(text) {
    if (!active) return null;
    var hit = active.reverse.get(text);
    if (hit !== undefined) return hit;
    var flat = norm(text);
    if (flat !== text) {
      hit = active.reverse.get(flat);
      if (hit !== undefined) return hit;
    }
    var all = active.open.concat.apply(active.open, Array.from(active.buckets.values()));
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (!r.back) continue;
      var m = r.back.rx.exec(text);
      if (m) {
        var vals = m.slice(1), ordered = [];
        for (var j = 0; j < r.back.order.length; j++) ordered[r.back.order[j] - 1] = vals[j];
        return fill(r.back.val, ordered);
      }
    }
    return null;
  }

  /* ------------------------------------------------------- walking the page */

  function isSingleWord(s) { return !/\s/.test(s); }

  function doText(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var text = raw.trim();
    if (text.length < 2 || !/[A-Za-z]/.test(text)) return;

    var parent = node.parentNode;
    if (!parent || parent.nodeType !== 1 || skipped(parent)) return;

    /* What did this say in English? Either we remember, or it still is. */
    var src = MEM.has(node) ? MEM.get(node) : text;

    if (!active) {                                   // going back to English
      if (MEM.has(node)) {
        node.nodeValue = raw.replace(text, src);
        MEM.delete(node);
      } else {
        var back = untranslate(text);
        if (back) node.nodeValue = raw.replace(text, back);
      }
      return;
    }

    var out = translate(src);
    if (out == null) {
      /* Perhaps it is already in the target language from an earlier pass. */
      if (!MEM.has(node)) {
        var en = untranslate(text);
        if (en != null) return;                      // already translated, leave it
        note(text, parent);
      }
      return;
    }
    if (isSingleWord(src) && !isChrome(parent)) return;   // somebody's own word
    if (out === text) return;
    MEM.set(node, src);
    node.nodeValue = raw.replace(text, out);
  }

  function doAttrs(el) {
    if (skipped(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a);
      if (!cur || !/[A-Za-z]/.test(cur)) continue;
      var mem = AMEM.get(el);
      var src = mem && mem[a] !== undefined ? mem[a] : cur;

      if (!active) {
        if (mem && mem[a] !== undefined) { el.setAttribute(a, mem[a]); delete mem[a]; }
        else { var back = untranslate(cur); if (back) el.setAttribute(a, back); }
        continue;
      }
      var out = translate(src);
      if (out == null) { if (!mem || mem[a] === undefined) note(cur, el, a); continue; }
      if (out === cur) continue;
      if (!mem) { mem = {}; AMEM.set(el, mem); }
      mem[a] = src;
      el.setAttribute(a, out);
    }
    /* Buttons that carry their words in value= rather than between the tags. */
    if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) {
      var v = el.value;
      if (v && /[A-Za-z]/.test(v)) {
        var o = active ? translate(v) : untranslate(v);
        if (o) el.value = o;
      }
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;

    var doc = root.ownerDocument || document;
    if (root.nodeType === 1) doAttrs(root);

    var it = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return SKIP_TAGS[n.nodeName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = it.nextNode())) {
      if (n.nodeType === 1) doAttrs(n);
      else doText(n);
    }
  }

  /* Every English string that reached a screen with nothing to say for it.
     Kept with enough context for the coverage test to tell a button nobody
     translated from a word somebody typed: the first is a bug, the second is
     none of our business. */
  function note(text, parent, attr) {
    if (!text || text.length > 200) return;
    var e = unknown[text];
    if (!e) e = unknown[text] = { seen: 0, chrome: false, where: [] };
    e.seen++;
    if (attr) { e.chrome = true; if (e.where.indexOf('@' + attr) < 0) e.where.push('@' + attr); return; }
    if (parent && parent.nodeType === 1) {
      if (isChrome(parent)) e.chrome = true;
      var tag = parent.nodeName.toLowerCase() + (parent.className && typeof parent.className === 'string'
        ? '.' + parent.className.trim().split(/\s+/)[0] : '');
      if (e.where.length < 4 && e.where.indexOf(tag) < 0) e.where.push(tag);
    }
  }

  /* ------------------------------------------------------------- observing */

  /* The app redraws whole panels on every tab change, so a one-off pass would
     only ever be right for a second. The observer is the real mechanism; the
     pass on start is just the part of the page that was already there.

     Our own writes produce mutation records too. Draining them straight after
     a pass is what stops the observer from chasing its own tail. */
  var pending = null;

  function onMutations(records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'childList') {
        for (var j = 0; j < r.addedNodes.length; j++) queue(r.addedNodes[j]);
      } else if (r.type === 'characterData') {
        queue(r.target);
      } else if (r.type === 'attributes') {
        queue(r.target);
      }
    }
    flushSoon();
  }

  var q = [];
  function queue(n) { if (n) q.push(n); }

  function flushSoon() {
    if (pending) return;
    pending = (global.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(flush);
  }

  function flush() {
    pending = null;
    var batch = q;
    q = [];
    for (var i = 0; i < batch.length; i++) {
      var n = batch[i];
      if (!n.isConnected) continue;
      walk(n);
    }
    if (observer) observer.takeRecords();
  }

  function startObserving() {
    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  /* ------------------------------------------------------------ full pass */

  function repaint() {
    walk(document.documentElement);
    if (document.title) {
      var t = active ? translate(document.title) : untranslate(document.title);
      if (t) document.title = t;
    }
    document.documentElement.setAttribute('lang', lang);
    if (observer) observer.takeRecords();
  }

  /* ----------------------------------------------------------- formatting */

  function localeOf() { return (LANGS[lang] || LANGS.en).locale; }

  function fmtDate(d, opts) {
    try { return new Intl.DateTimeFormat(localeOf(), opts || { day: 'numeric', month: 'short', year: 'numeric' }).format(d); }
    catch (e) { return String(d); }
  }
  function fmtNum(n, opts) {
    try { return new Intl.NumberFormat(localeOf(), opts || {}).format(n); }
    catch (e) { return String(n); }
  }
  function fmtMoney(n, ccy) {
    try { return new Intl.NumberFormat(localeOf(), { style: 'currency', currency: ccy || 'TRY' }).format(n); }
    catch (e) { return String(n); }
  }

  /* ------------------------------------------------------------- loading */

  var loading = {};

  function need(code) {
    var L = LANGS[code];
    if (!L || L.dict || !L.src) return Promise.resolve(L);
    if (loading[code]) return loading[code];
    loading[code] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = L.src + (global.FLOW_PACK_V ? '?v=' + global.FLOW_PACK_V : '');
      s.onload = function () { resolve(L); };
      s.onerror = function () {
        /* A language that will not load is a page in English, not a broken
           page. Say so where somebody debugging will see it and carry on. */
        console.warn('[i18n] could not load ' + code + ' — staying in English');
        reject(new Error('load failed'));
      };
      document.head.appendChild(s);
    });
    return loading[code];
  }

  /* --------------------------------------------------------- first choice */

  /* Before anybody has chosen, follow the device. A phone set to Turkish opens
     in Turkish; everything else opens in English, because a half-translated
     language is worse than a language you can read. */
  function fromDevice() {
    var list = [];
    try { list = (navigator.languages || [navigator.language || '']).slice(); } catch (e) {}
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || '').toLowerCase().split('-')[0];
      if (LANGS[code]) return code;
    }
    return DEFAULT;
  }

  function remembered() {
    try { return localStorage.getItem('flowLang') || ''; } catch (e) { return ''; }
  }

  function remember(code) {
    try { localStorage.setItem('flowLang', code); } catch (e) {}
  }

  /* ---------------------------------------------------------------- api */

  var api = {
    get lang() { return lang; },
    get locale() { return localeOf(); },

    /* The list a picker draws itself from, so adding a language adds nothing
       to the Settings screen. */
    languages: function () {
      return Object.keys(LANGS).map(function (c) {
        return { code: c, name: LANGS[c].name, native: LANGS[c].native };
      });
    },

    /* Called by a language file as it loads. */
    add: function (code, meta, dict, rules) {
      LANGS[code] = Object.assign({ code: code }, LANGS[code] || {}, meta || {});
      LANGS[code].dict = dict;
      LANGS[code].rules = rules || [];
      LANGS[code].compiled = compile(dict, rules);
      if (code === lang) { active = LANGS[code].compiled; repaint(); }
      return api;
    },

    set: function (code, opts) {
      code = LANGS[code] ? code : DEFAULT;
      if (code === lang && started) return Promise.resolve(code);
      return need(code).then(function () {
        lang = code;
        active = code === DEFAULT ? null : (LANGS[code].compiled || null);
        if (!opts || opts.remember !== false) remember(code);
        repaint();
        listeners.forEach(function (f) { try { f(code); } catch (e) {} });
        return code;
      }, function () {
        lang = DEFAULT; active = null; repaint();
        return DEFAULT;
      });
    },

    t: function (key) {
      var vals = Array.prototype.slice.call(arguments, 1);
      if (!active) return vals.length ? fill(key, vals) : key;
      var out = translate(key);
      if (out == null) { note(key, null); out = key; }
      return vals.length ? fill(out, vals) : out;
    },

    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); return api; },

    /* Every English string this page put in front of somebody that the
       dictionary had nothing for. The coverage test reads this. */
    missing: function (opts) {
      var only = opts && opts.chrome;
      return Object.keys(unknown)
        .filter(function (k) { return !only || unknown[k].chrome; })
        .sort(function (a, b) { return unknown[b].seen - unknown[a].seen; })
        .map(function (k) {
          return { text: k, seen: unknown[k].seen, chrome: unknown[k].chrome, where: unknown[k].where };
        });
    },

    repaint: repaint,
    fmtDate: fmtDate, fmtNum: fmtNum, fmtMoney: fmtMoney,

    /* Used by the Settings picker once an account is known, so the choice
       follows the person to their other devices rather than living in one
       browser. Passing nothing means "whatever the device says". */
    adopt: function (code) {
      if (!code) { if (!remembered()) return api.set(fromDevice(), { remember: false }); return Promise.resolve(lang); }
      return api.set(code);
    },

    start: function () {
      if (started) return Promise.resolve(lang);
      started = true;
      startObserving();
      var want = remembered() || fromDevice();
      return api.set(want, { remember: false });
    }
  };

  global.FlowI18n = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.start, { once: true });
  else api.start();

})(typeof window !== 'undefined' ? window : globalThis);
