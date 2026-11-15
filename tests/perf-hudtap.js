/* Taps in the command centre on a slow device (a measurement, not a test).
   Run through profile.js:  PROBE=perf-hudtap.js node tests/profile.js
   A real-sized account in Advanced (the command centre is the app), the CPU
   slowed 4× (SLOW=n) to stand in for WebKit on the phone and the Mac app.
   Reports what is drawn behind the command centre, eight seconds idle, every
   rail tap and typing in the console: time to the next frame, and the style
   recalc and layout work behind it — what WebKit pays for in proportion to
   what a change touches. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
const SLOW = +process.env.SLOW || 4;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  /* a seeded account (profile.js) signs in; a fresh replica gets one made */
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-pw', 'a properly long password');
  if (process.env.FRESH && await p.isVisible('#fa-name').catch(() => false)) await p.fill('#fa-name', 'Artur');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    const S = { newLook: false, todayBeta: true, asstWake: true, asstHandsFree: true, asstSheen: true, upgradeVisuals: true, asstGreet: false, asstHands: true, showTimeChips: true, asstVoice: 'off' };
    for (const k in S) await Flow.Settings.set(k, S[k]);
    Flow.Settings.reflect(); try { FlowTodayLook.applyLook(); } catch (e) {}
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(7000);
  await p.evaluate(() => { try { if (!FlowHud.on) FlowHud.open(); } catch (e) {} });
  await p.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
  const m = async () => { const r = await cdp.send('Performance.getMetrics'); const o = {}; for (const x of r.metrics) o[x.name] = x.value; return o; };
  const d = (a, z, k) => z[k] - a[k];
  const shape = await p.evaluate(() => {
    const hud = document.getElementById('flow-hud'); let n = 0, vis = 0, behind = 0;
    for (const e of document.body.getElementsByTagName('*')) { n++; if (e.checkVisibility && !e.checkVisibility()) continue; vis++; if (!(hud && hud.contains(e))) behind++; }
    return { nodes: n, rendered: vis, renderedBehind: behind, merged: FlowHud.merged ? FlowHud.merged() : null, on: FlowHud.on };
  });
  console.log('dom', JSON.stringify(shape), 'cpu ×' + SLOW);
  if (process.env.WHO) console.log('behind by top block', JSON.stringify(await p.evaluate(() => { const hud = document.getElementById('flow-hud'); const o = {}; for (const e of document.body.getElementsByTagName('*')) { if (hud.contains(e) || (e.checkVisibility && !e.checkVisibility())) continue; let t = e; while (t.parentElement && t.parentElement !== document.body) t = t.parentElement; const k = t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (typeof t.className === 'string' && t.className ? '.' + t.className.split(' ').slice(0, 2).join('.') : ''); o[k] = (o[k] || 0) + 1; } return o; })));
  const tot = { ms: 0, style: 0, layout: 0, n: 0 };
  const watch = async (name, fn, settle) => {
    const a = await m();
    await p.evaluate(() => { window.__mut = 0; window.__mo = new MutationObserver((ms) => { window.__mut += ms.length; }); window.__mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); });
    const t = await fn();
    await p.waitForTimeout(settle || 600);
    const mut = await p.evaluate(() => { window.__mo.disconnect(); return window.__mut; });
    const z = await m();
    const st = Math.round(d(a, z, 'RecalcStyleDuration') * 1000), ly = Math.round(d(a, z, 'LayoutDuration') * 1000);
    if (/^tap /.test(name)) { tot.ms += t; tot.style += st; tot.layout += ly; tot.n++; (tot.all = tot.all || []).push(t); (tot.by = tot.by || {})[name] = (tot.by[name] || []).concat(t); }
    console.log((name + '                              ').slice(0, 30) + (t != null ? String(t).padStart(5) + ' ms' : '        ') +
      '  script ' + String(Math.round(d(a, z, 'ScriptDuration') * 1000)).padStart(5) +
      '  style ' + String(st).padStart(5) + ' (' + d(a, z, 'RecalcStyleCount') + ')' +
      '  layout ' + String(ly).padStart(5) + ' (' + d(a, z, 'LayoutCount') + ')' +
      '  mutations ' + mut);
  };
  await watch('idle 8 s', async () => null, 8000);
  const labels = await p.evaluate(() => [...document.querySelectorAll('#flow-hud .hud-rail .hud-ri')].map((x) => (x.getAttribute('data-page') || x.getAttribute('data-hud'))));
  const tap = (i) => p.evaluate((i) => new Promise((r) => { const x = document.querySelectorAll('#flow-hud .hud-rail .hud-ri')[i]; const t = performance.now(); x.click(); requestAnimationFrame(() => setTimeout(() => r(Math.round(performance.now() - t)), 0)); }), i);
  if (process.env.PROF) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const ROUNDS = +process.env.ROUNDS || 1;
  for (let r = 0; r < ROUNDS; r++) for (const i of labels.map((x, i) => i).concat([0])) await watch('tap ' + labels[i], () => tap(i), 900);
  if (process.env.PROF) {
    const { profile } = await cdp.send('Profiler.stop');
    const byId = {}; for (const n of profile.nodes) byId[n.id] = n;
    const self = {}; profile.samples.forEach((id, i) => { const n = byId[id]; const k = n.callFrame.functionName + ' ' + (n.callFrame.url || '').split('/').pop().split('?')[0] + ':' + (n.callFrame.lineNumber + 1); self[k] = (self[k] || 0) + (profile.timeDeltas[i] || 0) / 1000; });
    console.log('top self time over all taps (ms):\n' + Object.entries(self).filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => '  ' + v.toFixed(0).padStart(5) + '  ' + k).join('\n'));
  }
  const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
  console.log('TAPS: ' + tot.n + ' · median ' + med(tot.all) + ' ms · avg ' + Math.round(tot.ms / tot.n) + ' ms to frame · style ' + tot.style + ' ms · layout ' + tot.layout + ' ms in all');
  console.log('median per tap: ' + Object.entries(tot.by).map(([k, v]) => k.slice(4) + ' ' + med(v)).join(' · '));
  await watch('typing 21 keys', async () => { await p.focus('#sy-text').catch(() => {}); const t = Date.now(); await p.keyboard.type('call the supplier mon', { delay: 40 }); return Date.now() - t; }, 400);
  const after = await p.evaluate(() => { const hud = document.getElementById('flow-hud'); let vis = 0, behind = 0; for (const e of document.body.getElementsByTagName('*')) { if (e.checkVisibility && !e.checkVisibility()) continue; vis++; if (!(hud && hud.contains(e))) behind++; } return { nodes: document.getElementsByTagName('*').length, rendered: vis, renderedBehind: behind }; });
  console.log('dom after', JSON.stringify(after));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
