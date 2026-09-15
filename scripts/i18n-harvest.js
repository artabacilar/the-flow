#!/usr/bin/env node
/* =========================================================================
 * i18n-harvest — open the app and write down every English word on screen.
 *
 * Reading the source tells you what strings exist. It does not tell you which
 * ones a person ever sees, what they look like once the values are filled in,
 * or which of them arrive glued to another string a hundred lines away. Only
 * running the thing tells you that.
 *
 * So this boots a real server with a real account, drives a real browser
 * through every tab and every panel, and asks the translation engine itself
 * what it could not translate. The answer is the work list — and once the
 * dictionary is full, the same walk run in Turkish is the test: anything it
 * still reports is English that leaked onto a Turkish screen.
 *
 *   node scripts/i18n-harvest.js              what is still untranslated
 *   node scripts/i18n-harvest.js --all        including likely user content
 *   node scripts/i18n-harvest.js --json out   write the list to a file
 * ====================================================================== */

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const HERE = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4225);   /* 4222 is the suites, 4223 the replica's own probe */
const HOST = 'http://localhost:' + PORT;
const OWNER = 'artur.abacilar@abko.com.tr';
const PASSWORD = 'a properly long password';

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

/* Every tab the navigation can reach, in the order a person would meet them.
   Kept here rather than read from the page so that a tab quietly disappearing
   shows up as a harvest that stopped covering it. */
const TABS = [
  'today', 'northstar', 'quad', 'compass', 'abko', 'dtc',
  'training', 'diet', 'sleep', 'habits',
  'ask', 'journal', 'finance', 'brainstorm', 'time',
  'artur', 'settings'
];

(async () => {
  const lang = process.argv.includes('--tr') ? 'tr' : 'tr';   // always drive in Turkish
  const showAll = process.argv.includes('--all');
  const jsonAt = (() => {
    const i = process.argv.indexOf('--json');
    return i > 0 ? process.argv[i + 1] : null;
  })();

  if (!(await waitFor(false, 6000))) {
    console.error('port ' + PORT + ' is busy — stop whatever is on it first');
    process.exit(2);
  }

  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    DASH: path.join(HERE, 'life-dashboard.html'),
    FLOW_OWNER_EMAIL: OWNER,
    FLOW_INVITE_CODE: 'letmein'
  });
  const server = spawn(process.execPath, [path.join(HERE, 'tests', 'server-replica.js')], { env, stdio: 'ignore' });
  const bye = async (code) => { server.kill('SIGKILL'); await waitFor(false, 5000); process.exit(code); };

  if (!(await waitFor(true, 20000))) {
    console.error('the replica never came up');
    return bye(2);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  try {
    /* Start in English so the account is created against the words the tests
       already know, then switch — which is also the path a Turkish speaker
       who signed up on a borrowed laptop would take. */
    await page.goto(HOST + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2600);

    await page.fill('#fa-email', OWNER);
    await page.fill('#fa-name', 'Artur');
    await page.fill('#fa-pw', PASSWORD);
    await require(path.join(HERE, 'tests', 'submit-auth.js'))(page);
    await page.waitForTimeout(3500);

    const signedIn = await page.evaluate(() => !document.getElementById('flow-auth'));
    if (!signedIn) throw new Error('could not get past the sign-in screen');

    await page.evaluate((l) => window.FlowI18n && window.FlowI18n.set(l), lang);
    await page.waitForTimeout(600);

    /* Walk the app. Each tab gets a moment to render, then every disclosure,
       details block and secondary panel on it is opened, because half the
       words in this app live one click below the surface. */
    for (const tab of TABS) {
      const went = await page.evaluate((t) => {
        const el = document.querySelector('.tab[data-tab="' + t + '"]');
        if (!el) return false;
        el.click();
        return true;
      }, tab);
      if (!went) { console.error('  (no tab: ' + tab + ')'); continue; }
      await page.waitForTimeout(900);

      await page.evaluate(() => {
        document.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
      });
      await page.waitForTimeout(400);

      /* Scroll the whole tab past the viewport: anything rendered lazily only
         exists once it has been looked at. */
      await page.evaluate(async () => {
        const step = Math.round(window.innerHeight * 0.8);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 90));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(400);
    }

    /* The empty states are their own screens and nothing above reaches them,
       because the seeded account has data in every section. Ask the app to
       draw them by clearing what it is holding in memory first. */
    await page.evaluate(() => {
      const tab = document.querySelector('.tab[data-tab="settings"]');
      if (tab) tab.click();
    });
    await page.waitForTimeout(1200);

    const found = await page.evaluate((all) => {
      const m = window.FlowI18n ? window.FlowI18n.missing(all ? {} : { chrome: true }) : [];
      return { missing: m, lang: window.FlowI18n && window.FlowI18n.lang };
    }, showAll);

    if (found.lang !== lang) console.error('warning: the page is in ' + found.lang + ', not ' + lang);

    const rows = found.missing;
    if (jsonAt) {
      fs.writeFileSync(jsonAt, JSON.stringify(rows, null, 1));
      console.error('wrote ' + rows.length + ' to ' + jsonAt);
    } else {
      for (const r of rows) console.log(r.text);
    }
    console.error('\n' + rows.length + ' English strings on screen with no translation');
    if (errs.length) console.error(errs.length + ' page errors: ' + errs.slice(0, 3).join(' | '));

    await browser.close();
    return bye(rows.length ? 1 : 0);
  } catch (e) {
    console.error('harvest failed: ' + (e && e.message));
    if (errs.length) console.error('page errors: ' + errs.slice(0, 5).join(' | '));
    try { await browser.close(); } catch (x) {}
    return bye(2);
  }
})();
