/* =========================================================================
 * flow-browser.js — the team's eyes on the web
 *
 * Two honest modes, and the app says which one it is in.
 *
 *   reader   Always available. A page is fetched over plain HTTPS, scripts
 *            and styles are stripped, and the agent gets the text. Public
 *            pages only: nothing is clicked, nothing is typed, nothing that
 *            needs a sign-in can be reached. This is what Render gives us
 *            with no browser installed.
 *
 *   browser  When Playwright and a Chromium are on the host (or a hosted
 *            browser is given as BROWSER_WS_ENDPOINT), each agent gets its
 *            own profile directory — its cookies and sessions never mix with
 *            another agent's — and can click, type and scroll, a step at a
 *            time, with the model choosing each step from what the page
 *            shows. A small screenshot after every step goes into the task
 *            so the person can see what the agent saw.
 *
 * Human handoff. Sign-in pages, one-time codes and CAPTCHAs are not for an
 * agent: the moment the page shows one, the run stops and the task asks the
 * person to do that part themselves. No credential is ever typed by an
 * agent, and none is ever kept here.
 *
 * Private addresses are refused (the server's own network is not the
 * agent's business); in the test stand-in localhost is allowed so the
 * replica can serve the pages.
 * ====================================================================== */
'use strict';

const FAKE = process.env.FLOW_TEAM_FAKE === '1';
const WS = String(process.env.BROWSER_WS_ENDPOINT || '').trim();
const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_TEXT = 9000;

let pw = null, pwChecked = false, pwPath = '';
function playwright() {
  if (pwChecked) return pw;
  pwChecked = true;
  try {
    const p = require('playwright');
    if (p && p.chromium) {
      pw = p;
      try { pwPath = p.chromium.executablePath(); } catch (e) { pwPath = ''; }
      if (!WS && !(pwPath && require('fs').existsSync(pwPath))) pw = null;
    }
  } catch (e) { pw = null; }
  return pw;
}

/* What is possible here, in words the panel can show. */
function available() {
  const p = playwright();
  if (p && WS) return { mode: 'browser', status: 'working', note: 'A hosted browser (BROWSER_WS_ENDPOINT). Agents can open pages, click and type; you take over for any sign-in.' };
  if (p) return { mode: 'browser', status: 'working', note: 'Chromium on this host. Each agent has its own browser profile; you take over for any sign-in.' };
  return { mode: 'reader', status: 'awaiting', env: ['BROWSER_WS_ENDPOINT'], note: 'Reader only: agents can read public pages but not click, type or sign in. A full browser needs Chromium on the host or a hosted browser in BROWSER_WS_ENDPOINT (Browserless or similar).' };
}

/* ---------- the address guard --------------------------------------------- */
function allowed(u) {
  let url; try { url = new URL(String(u || '')); } catch (e) { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const h = url.hostname.toLowerCase();
  if (FAKE && (h === 'localhost' || h === '127.0.0.1')) return true;
  if (h === 'localhost' || /\.local$|\.internal$/.test(h)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return false;
  }
  if (/^\[?[0-9a-f:]+\]?$/i.test(h) && /^(\[?::1\]?|\[?fe80|\[?fc|\[?fd)/i.test(h)) return false;
  return true;
}

/* ---------- reader -------------------------------------------------------- */
function htmlToText(html) {
  let s = String(html || '');
  const decode = (t) => String(t).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'');
  const title = decode((s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  s = s.replace(/<head[\s\S]*?<\/head>/i, ' ').replace(/<title[\s\S]*?<\/title>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article|header|footer|td|th|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ' '; } });
  s = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title: title.replace(/\s+/g, ' ').trim().slice(0, 200), text: s };
}

async function read(url) {
  if (!allowed(url)) return { error: 'That address cannot be read from here (only public http/https pages).', url };
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; TheFlowTeam/1.0; +https://theflow.today)', accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' } });
    if (!allowed(r.url)) return { error: 'That address redirected somewhere that cannot be read from here.', url };
    const type = String(r.headers.get('content-type') || '');
    const buf = Buffer.from(await r.arrayBuffer());
    const body = buf.slice(0, MAX_BYTES).toString('utf8');
    let out;
    if (/html|xml/.test(type) || /^\s*</.test(body)) out = htmlToText(body);
    else out = { title: '', text: body.replace(/\r/g, '').trim() };
    return { url: r.url, status: r.status, title: out.title, text: out.text.slice(0, MAX_TEXT), truncated: out.text.length > MAX_TEXT || buf.length > MAX_BYTES };
  } catch (e) {
    return { error: e && e.name === 'AbortError' ? 'That page took too long to answer.' : 'That page could not be fetched.', url };
  } finally { clearTimeout(t); }
}

/* ---------- browser ------------------------------------------------------- */
const NEEDS_HUMAN = /(sign in|log in|login|password|parola|şifre|giriş yap|verification code|one-time|2fa|two-factor|captcha|i am not a robot|verify you are human)/i;

/* What the page shows, small enough for a model to act on. */
async function look(page) {
  const title = await page.title().catch(() => '');
  const url = page.url();
  const snap = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const text = (document.body && document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 7000);
    const els = [...document.querySelectorAll('a[href], button, input, textarea, select, [role=button], [onclick]')].filter(vis).slice(0, 60);
    const items = els.map((el, i) => {
      el.setAttribute('data-flow-i', String(i));
      const tag = el.tagName.toLowerCase();
      const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.name || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const type = tag === 'input' ? (el.type || 'text') : tag;
      return i + ' | ' + type + ' | ' + label + (tag === 'a' ? ' | ' + String(el.href).slice(0, 80) : '');
    });
    const sensitive = !![...document.querySelectorAll('input[type=password], input[autocomplete*=one-time], iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')].filter(vis).length;
    return { text, items, sensitive };
  }).catch(() => ({ text: '', items: [], sensitive: false }));
  return { title, url, text: snap.text, items: snap.items, sensitive: snap.sensitive || NEEDS_HUMAN.test(title) };
}

async function shot(page) {
  try { const b = await page.screenshot({ type: 'jpeg', quality: 45, clip: { x: 0, y: 0, width: 1000, height: 700 } }); return 'data:image/jpeg;base64,' + b.toString('base64'); } catch (e) { return ''; }
}

const BROWSE_SYSTEM = (goal, agentName) => [
  'You are ' + agentName + ', using a web browser for one task: ' + goal,
  'You see the page as text plus a numbered list of things that can be clicked or typed into. Choose ONE next action.',
  'Return ONLY a JSON object: { "action": "click|type|goto|scroll|done|handoff", "i": 0, "text": "", "url": "", "found": "what you have learned so far, for the person", "why": "one short line" }',
  '· click: i is the number. type: i is an input and text is what to type, then Enter is pressed. goto: url. scroll: moves down a screen.',
  '· done: the goal is met or cannot be met on this site; put everything you found in "found", complete and specific.',
  '· handoff: the page wants a sign-in, a code, a payment or a CAPTCHA, or any personal detail — you never do those; say in "why" what the person should do themselves.',
  '· Never type passwords, codes, card numbers or personal data. Never buy, pay, send or post anything. Read-only unless the goal clearly asks for a form that is not a purchase.'
].join('\n');

/* One browsing run for one agent. deps.complete(opts) is the model call
   (flow-team's), deps.profileDir keeps the agent's cookies. */
async function browse(opts, deps) {
  const p = playwright();
  if (!p) return { error: 'No browser here: reader mode only.', mode: 'reader' };
  if (!allowed(opts.url)) return { error: 'That address cannot be opened from here.' };
  const maxSteps = Math.max(1, Math.min(12, opts.maxSteps || 8));
  let browser = null, context = null;
  const shots = []; const log = [];
  try {
    if (WS) { browser = await p.chromium.connect(WS, { timeout: 15000 }); context = await browser.newContext({ viewport: { width: 1000, height: 700 } }); }
    else context = await p.chromium.launchPersistentContext(deps.profileDir, { headless: true, viewport: { width: 1000, height: 700 }, args: ['--no-sandbox'] });
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(12000);
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    let found = '';
    for (let step = 0; step < maxSteps; step++) {
      await page.waitForTimeout(600);
      const L = await look(page);
      const img = await shot(page); if (img) shots.push({ at: Date.now(), url: L.url, title: L.title, img });
      if (L.sensitive) { log.push('Stopped at ' + L.url + ': the page asks for a sign-in or a code.'); return { handoff: true, url: L.url, title: L.title, found, shots: shots.slice(-6), log, why: 'This page wants a sign-in or a verification. Please do that part yourself in your own browser, then tell me to continue.' }; }
      if (deps.fakeAction) { const a = deps.fakeAction(L, step); if (a.action === 'done') return { done: true, found: a.found || L.text.slice(0, 2000), url: L.url, shots: shots.slice(-6), log }; }
      const r = await deps.complete({ model: opts.model, system: BROWSE_SYSTEM(opts.goal, opts.agentName || 'an agent'), messages: [{ role: 'user', content: 'URL: ' + L.url + '\nTITLE: ' + L.title + '\n\nPAGE TEXT:\n' + L.text.slice(0, 6000) + '\n\nTHINGS YOU CAN ACT ON (i | kind | label | href):\n' + L.items.join('\n') + (found ? '\n\nFOUND SO FAR:\n' + found : '') }], maxTokens: 700, timeoutMs: 45000 });
      if (r.error) { log.push('The model could not decide: ' + r.error); return { error: r.error, found, url: L.url, shots: shots.slice(-6), log }; }
      let a = null; const m = String(r.text || '').match(/\{[\s\S]*\}/); if (m) { try { a = JSON.parse(m[0]); } catch (e) {} }
      if (!a || typeof a !== 'object') { log.push('An unreadable decision; stopping.'); return { done: true, found: found || L.text.slice(0, 2000), url: L.url, shots: shots.slice(-6), log }; }
      if (a.found) found = String(a.found).slice(0, 6000);
      log.push((a.action || '?') + (a.why ? ' — ' + String(a.why).slice(0, 120) : ''));
      if (a.action === 'done') return { done: true, found: found || L.text.slice(0, 2000), url: L.url, shots: shots.slice(-6), log };
      if (a.action === 'handoff') return { handoff: true, url: L.url, title: L.title, found, shots: shots.slice(-6), log, why: String(a.why || 'This needs you.').slice(0, 300) };
      try {
        if (a.action === 'click') await page.click('[data-flow-i="' + (+a.i || 0) + '"]', { timeout: 6000 });
        else if (a.action === 'type') { if (/password|passcode|card|cvv|iban|ssn|tc kimlik|\b\d{6}\b/i.test(String(a.text || ''))) { return { handoff: true, url: L.url, title: L.title, found, shots: shots.slice(-6), log, why: 'The next step would have typed something private; that is yours to do.' }; } await page.fill('[data-flow-i="' + (+a.i || 0) + '"]', String(a.text || '').slice(0, 300)); await page.keyboard.press('Enter'); }
        else if (a.action === 'goto') { if (allowed(a.url)) await page.goto(String(a.url), { waitUntil: 'domcontentloaded' }); }
        else if (a.action === 'scroll') await page.mouse.wheel(0, 600);
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      } catch (e) { log.push('That did not work: ' + String(e && e.message || e).slice(0, 100)); }
    }
    const L = await look(page);
    return { done: true, found: found || L.text.slice(0, 2000), url: L.url, shots: shots.slice(-6), log, note: 'Stopped after ' + maxSteps + ' steps.' };
  } catch (e) {
    return { error: 'The browser failed: ' + String(e && e.message || e).slice(0, 160), shots: shots.slice(-6), log };
  } finally {
    try { if (context) await context.close(); } catch (e) {}
    try { if (browser) await browser.close(); } catch (e) {}
  }
}

module.exports = { available, read, browse, allowed, htmlToText, _internals: { NEEDS_HUMAN, BROWSE_SYSTEM, playwright } };
