#!/usr/bin/env node
/* =========================================================================
 * theme-shots — prove a theme actually changed something.
 *
 * The seven themes this replaced were the reason this script exists. They
 * looked right in the stylesheet and did nothing on screen, because they
 * repainted an accent and left every surface where it was — and nobody
 * noticed for months, because no test has eyes.
 *
 * So this one measures. For each theme it reads back the computed colour of
 * the page, a card, a border and the body text, and refuses to pass a theme
 * whose surfaces came out identical to the default's. Then it saves a picture
 * of each, because some things are still only visible by looking.
 * ====================================================================== */

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const HERE = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4226);
const HOST = 'http://localhost:' + PORT;
const OWNER = 'artur.abacilar@abko.com.tr';
const OUT = process.env.OUT || path.join(HERE, '.theme-shots');

const THEMES = ['signature', 'bloom', 'aurora', 'paper', 'calm', 'bold', 'operator'];

const listening = () => new Promise((res) => {
  const s = net.connect(PORT, '127.0.0.1');
  s.on('connect', () => { s.destroy(); res(true); });
  s.on('error', () => res(false));
});
const waitFor = async (want, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await listening()) === want) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
};

/* The meta tag carries a hex and getComputedStyle hands back rgb(); comparing
   the two as text says they differ when they are the same colour. */
function rgbOf(v) {
  const s = String(v || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function sameColour(a, b) {
  const x = rgbOf(a), y = rgbOf(b);
  return !!x && !!y && x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, c, d) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 160) : '')); }
  };

  if (!(await waitFor(false, 6000))) { console.error('port ' + PORT + ' busy'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });

  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DASH: path.join(HERE, 'life-dashboard.html'),
    FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein'
  });
  const server = spawn(process.execPath, [path.join(HERE, 'tests', 'server-replica.js')], { env, stdio: 'ignore' });
  const bye = async (code) => { server.kill('SIGKILL'); await waitFor(false, 5000); process.exit(code); };
  if (!(await waitFor(true, 20000))) { console.error('replica never came up'); return bye(2); }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  try {
    await page.goto(HOST + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2600);
    await page.fill('#fa-email', OWNER);
    await page.fill('#fa-name', 'Artur');
    await page.fill('#fa-pw', 'a properly long password');
    await require(path.join(HERE, 'tests', 'submit-auth.js'))(page);
    await page.waitForTimeout(3500);

    /* Settings is where the picker lives, and it is also the densest screen —
       cards, buttons, inputs and muted text all in one frame. */
    await page.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
    await page.waitForTimeout(1200);

    const readBack = () => page.evaluate(() => {
      const cs = (el, p) => el ? getComputedStyle(el).getPropertyValue(p).trim() : '';
      const card = document.querySelector('.flow-card');
      const btn = document.querySelector('.flow-btn');
      return {
        attr: document.documentElement.getAttribute('data-flow-theme'),
        page: cs(document.body, 'background-color'),
        ink: cs(document.body, 'color'),
        card: cs(card, 'background-color'),
        cardLine: cs(card, 'border-top-color'),
        radius: cs(card, 'border-radius'),
        font: cs(card, 'font-family').split(',')[0].replace(/["']/g, ''),
        accent: cs(document.querySelector('.flow-x') || document.body, '--f-accent'),
        btnBg: cs(btn, 'background-color'),
        meta: (document.querySelector('meta[name="theme-color"]') || {}).content,
        htmlBg: document.documentElement.style.background
      };
    });

    const seen = {};
    for (const t of THEMES) {
      await page.evaluate((id) => window.Flow.Theme.apply(id), t);
      await page.waitForTimeout(700);
      const r = await readBack();
      seen[t] = r;
      ok(t + ': the attribute is set', r.attr === t, r.attr);
      ok(t + ': the page has a colour of its own', !!r.page && r.page !== 'rgba(0, 0, 0, 0)', r.page);
      ok(t + ': the status-bar strip follows', sameColour(r.meta, r.htmlBg), { meta: r.meta, html: r.htmlBg });
      await page.screenshot({ path: path.join(OUT, t + '.png'), fullPage: false });
    }

    /* The real check. A theme that leaves the surfaces where the default had
       them is a tint, and a tint is what we just spent an afternoon removing. */
    const base = seen.signature;
    for (const t of THEMES.filter((x) => x !== 'signature')) {
      const r = seen[t];
      const moved = ['page', 'card', 'cardLine', 'ink', 'accent'].filter((k) => r[k] !== base[k]);
      ok(t + ': repaints the surfaces, not just the accent', moved.length >= 4, { moved, r });
    }

    ok('Bold squares the corners', parseFloat(seen.bold.radius) <= 6, seen.bold.radius);
    ok('Aurora rounds them', parseFloat(seen.aurora.radius) >= 16, seen.aurora.radius);
    ok('Bold changes the typeface', /Archivo/i.test(seen.bold.font), seen.bold.font);
    ok('Operator goes monospaced', /Mono/i.test(seen.operator.font), seen.operator.font);

    /* Light themes have to be light all the way down, or they are a white page
       with white text on it. */
    for (const t of ['paper', 'bloom']) {
      const lum = (c) => { const v = rgbOf(c); return v ? (v[0] + v[1] + v[2]) / 3 : null; };
      ok(t + ': the page is actually light', lum(seen[t].page) > 180, seen[t].page);
      ok(t + ': and the text is dark enough to read', lum(seen[t].ink) < 110, seen[t].ink);
    }

    /* An id from the version this replaced must land somewhere real. */
    for (const [oldId, want] of Object.entries({ '': 'signature', slate: 'calm', whoop: 'operator', rose: 'bloom' })) {
      const got = await page.evaluate((id) => window.Flow.Theme.resolve(id), oldId);
      ok('a retired "' + (oldId || 'default') + '" becomes ' + want, got === want, got);
    }

    ok('no page errors while switching', errs.length === 0, errs.slice(0, 3));

    console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
    console.log('  pictures in ' + OUT);
    await browser.close();
    return bye(fail ? 1 : 0);
  } catch (e) {
    console.error('failed: ' + (e && e.message));
    if (errs.length) console.error('page errors: ' + errs.slice(0, 5).join(' | '));
    try { await browser.close(); } catch (x) {}
    return bye(2);
  }
})();
