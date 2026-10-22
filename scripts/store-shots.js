#!/usr/bin/env node
/* Store screenshots: a fresh account on a replica, a believable week in it,
   and each main screen at phone, tablet and desktop sizes. */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const HERE = path.join(__dirname, '..');
const PORT = 4231;
const H = 'http://localhost:' + PORT;
const OUT = process.env.OUT || path.join(HERE, '.store-shots');
fs.mkdirSync(OUT, { recursive: true });

const up = () => new Promise((res) => { const s = net.connect(PORT, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });

(async () => {
  const srv = spawn(process.execPath, [path.join(HERE, 'tests', 'server-replica.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), FLOW_OWNER_EMAIL: 'owner@nowhere.invalid', FLOW_INVITE_CODE: 'letmein' }),
    stdio: ['ignore', 'ignore', 'inherit']
  });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  const b = await chromium.launch();
  const fixedInit = () => {
    const fixed = new Date(2026, 9, 21, 10, 40, 0).getTime();
    const RealDate = Date; const off = fixed - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
  };
  try {
    const ctx0 = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx0.addInitScript(fixedInit);
    const p = await ctx0.newPage();
    await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.evaluate(async () => {
      const su = (email, name) => fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ email, name, password: 'a properly long password', invite: 'letmein' }) });
      await su('owner@nowhere.invalid', 'Owner');
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      await su('alex@example.com', 'Alex');
    });
    await p.goto(H + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => document.documentElement.classList.contains('flow-ready'), null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const me = await p.evaluate(() => fetch('/api/auth/me').then((r) => r.json()).catch(() => null));
    console.log('signed in', JSON.stringify(me).slice(0, 120));
    await p.evaluate(() => {
      const wid = weekId(new Date(2026, 9, 21));
      Object.keys(cData.rocks || {}).forEach((k) => { delete cData.rocks[k]; });
      const R = cData.roles || [];
      const role = (i) => R[i % Math.max(1, R.length)];
      const add = (t, r, d, time, done, note) => { addRock(t, role(r), d, time, wid, note ? { note } : {}); if (done) cData.rocks[wid][cData.rocks[wid].length - 1].done = true; };
      add('Weekly planning', 0, 0, '08:30', true);
      add('Gym — upper body', 1, 0, '18:30', true);
      add('Supplier call: Q4 pricing', 0, 1, '10:00', true, 'Bring last quarter\'s numbers');
      add('Read 30 pages', 2, 1, '21:30', true);
      add('Ship the Android app', 0, 2, '09:00', true);
      add('Lunch with Deniz', 2, 2, '13:00', false);
      add('Gym — legs', 1, 2, '18:30', false);
      add('Draft the investor update', 0, 2, '16:00', false, 'Three wins, one miss, the ask');
      add('Call Mum', 2, 3, '19:00', false);
      add('Review the budget', 0, 4, '11:00', false);
      add('Long run, 10 km', 1, 5, '08:00', false);
      add('Plan next week', 0, 6, '18:00', false);
      cSave();
      try {
        const days = []; for (let i = 0; i < 28; i++) { const d = new Date(2026, 9, 21 - i); days.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')); }
        (hbData.habits || []).forEach((h, hi) => { hbData.completions[h.id] = hbData.completions[h.id] || {}; days.forEach((d, i) => { if ((i * 7 + hi * 3) % 10 < 8 && i > 0) hbData.completions[h.id][d] = true; }); });
        S.set('habits', hbData);
      } catch (e) {}
    });
    await p.waitForTimeout(1500);
    const sides = await p.evaluate(() => [...document.querySelectorAll('[data-fn-side]')].map((e) => e.getAttribute('data-fn-side')));
    console.log('sides', sides.join(','));
    const cookies = await ctx0.cookies();
    await ctx0.close();

    const want = (process.env.TABS || 'today,compass,habits,training,journal').split(',');
    const sizes = (process.env.ONLY ? (x) => x.filter((s) => process.env.ONLY.split(',').indexOf(s.tag) >= 0) : (x) => x)([
      { tag: 'phone', viewport: { width: 360, height: 640 }, dpr: 3, mobile: true },
      /* Play wants 16:9 for tablets and desktop. */
      { tag: 'tablet7', viewport: { width: 1280, height: 720 }, dpr: 1.5, mobile: false },
      { tag: 'tablet10', viewport: { width: 1280, height: 720 }, dpr: 2, mobile: false },
    ]);
    for (const s of sizes) {
      const ctx = await b.newContext({ viewport: s.viewport, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile });
      await ctx.addInitScript(fixedInit);
      await ctx.addCookies(cookies);
      const q = await ctx.newPage();
      await q.goto(H + '/', { waitUntil: 'load' });
      await q.waitForFunction(() => document.documentElement.classList.contains('flow-ready'), null, { timeout: 15000 }).catch(() => {});
      await q.waitForTimeout(1500);
      const shots = [
        ['today', null], ['today', 'BIG ROCKS'], ['compass', null], ['compass', 'jump to this week'],
        ['habits', 'Add a habit'], ['training', null], ['journal', null]
      ];
      let n = 0;
      for (const [t, anchor] of shots) {
        if (sides.indexOf(t) < 0) continue;
        await q.evaluate((t) => { const el = document.querySelector('[data-fn-side="' + t + '"]') || document.querySelector('[data-fn-seg="' + t + '"]'); el && el.click(); window.scrollTo(0, 0); }, t);
        await q.waitForTimeout(1200);
        if (anchor) {
          await q.evaluate((a) => {
            const all = [...document.querySelectorAll('h1,h2,h3,h4,div,span,a,button,input')].filter((e) => e.offsetParent && ((e.placeholder || '').indexOf(a) === 0 || (e.children.length === 0 && (e.textContent || '').trim().toUpperCase().indexOf(a.toUpperCase()) >= 0)));
            const el = all[0]; if (!el) return;
            const y = el.getBoundingClientRect().top + window.scrollY - 140;
            window.scrollTo(0, y);
            const sc = [...document.querySelectorAll('*')].find((x) => x.scrollHeight > x.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(x).overflowY) && x.contains(el));
            if (sc) sc.scrollTop += el.getBoundingClientRect().top - 140;
          }, anchor);
          await q.waitForTimeout(500);
        }
        await q.screenshot({ path: path.join(OUT, s.tag + '-' + (++n) + '-' + t + '.png') });
      }
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.kill();
  }
})();
