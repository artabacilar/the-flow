/* Light themes stay readable, everywhere.
 *
 * Every text element on every tab, in Paper and in Bloom, measured against the
 * background it actually sits on. A block drawn for the dark screen only (a
 * mission panel, a WHOOP card, a neon chip) shows up here as a number under
 * 3:1, rather than as a screenshot from somebody squinting at it. Finance
 * category names are excluded: they carry their own colour inline and are
 * darkened with a filter, which a computed colour cannot see. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL || 'owner@example.test'); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(() => { try { wsABKO && wsABKO.render(); } catch (e) {} });
  const out = {};
  for (const theme of ['paper', 'bloom']) {
    await p.evaluate(t => Flow.Theme.apply(t), theme);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.tab[data-tab]')].map(x => x.dataset.tab));
    for (const tab of tabs) {
      await p.evaluate(t => document.querySelector('.tab[data-tab="' + t + '"]').click(), tab);
      await p.waitForTimeout(700);
      const bad = await p.evaluate(() => {
        const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(',').map(x => parseFloat(x)); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
        const lum = (c) => [c.r, c.g, c.b].map(x => { x /= 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0);
        const bgOf = (el) => { while (el) { const cs = getComputedStyle(el); const c = parse(cs.backgroundColor); if (c && c.a > .5) return c; const g = cs.backgroundImage.match(/rgba?\([^)]+\)/); if (g) { const gc = parse(g[0]); if (gc && gc.a > .5) return gc; } el = el.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
        const sec = document.querySelector('.section.active, .flow-section.active');
        const res = []; const seen = new Set();
        sec.querySelectorAll('*').forEach(el => {
          if (el.closest('.fin-cat-name, .fin-cat-nums')) return;
          if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity < .3) return;
          const fg = parse(cs.color); if (!fg) return; const bg = bgOf(el);
          const a = lum(fg), bl = lum(bg); const ratio = (Math.max(a, bl) + .05) / (Math.min(a, bl) + .05);
          if (ratio < 3) { const key = (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName) + '|' + cs.color + '|' + Math.round(ratio * 10) / 10; if (seen.has(key)) return; seen.add(key); res.push({ el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').join('.') : ''), parent: el.parentElement && (el.parentElement.className || el.parentElement.id || el.parentElement.tagName), text: el.textContent.trim().slice(0, 30), ratio: Math.round(ratio * 10) / 10, fg: cs.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')' }); }
        });
        return res.slice(0, 25);
      });
      if (bad.length) out[theme + ':' + tab] = bad;
    }
  }
  let fail = 0, pass = 0;
  for (const theme of ['paper', 'bloom']) {
    const keys = Object.keys(out).filter(k => k.indexOf(theme + ':') === 0);
    if (keys.length) { fail++; console.log('  ✗ ' + theme + ': text under 3:1 on ' + keys.join(', ')); keys.forEach(k => out[k].slice(0, 6).forEach(x => console.log('      ' + x.ratio + '  ' + x.el.slice(0, 60) + '  "' + x.text + '"  ' + x.fg + ' on ' + x.bg))); }
    else { pass++; console.log('  ✓ ' + theme + ': every text on every tab reads at 3:1 or better'); }
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
