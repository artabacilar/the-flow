/* Where the CPU goes with the owner's real settings and a real-sized account
   (a measurement, not a test). Run through profile.js: PROBE=perf-real.js. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    const S = { newLook: true, todayBeta: true, asstWake: true, asstHandsFree: true, asstSheen: true, upgradeVisuals: true, asstGreet: false, asstHands: true, showTimeChips: true, remindersEnabled: true };
    for (const k in S) await Flow.Settings.set(k, S[k]);
    Flow.Settings.reflect(); try { FlowTodayLook.applyLook(); } catch (e) {}
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(7000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  const m = async () => { const r = await cdp.send('Performance.getMetrics'); const o = {}; for (const x of r.metrics) o[x.name] = x.value; return o; };
  const phase = async (name, fn, secs) => {
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
    await p.evaluate(() => { window.__fr = []; let last = performance.now(); const f = (t) => { window.__fr.push(t - last); last = t; if (window.__frOn) requestAnimationFrame(f); }; window.__frOn = true; requestAnimationFrame(f); });
    const a = await m(); const t0 = Date.now();
    await fn(); await p.waitForTimeout(secs * 1000);
    const fr = await p.evaluate(() => { window.__frOn = false; const f = (window.__fr || []).slice(1); f.sort((x, y) => x - y); return { n: f.length, p50: Math.round(f[f.length >> 1]), p95: Math.round(f[Math.floor(f.length * .95)]), max: Math.round(f[f.length - 1]), over50: f.filter((x) => x > 50).length }; });
    const z = await m(); const dt = (Date.now() - t0) / 1000;
    const { profile } = await cdp.send('Profiler.stop');
    const self = {}; const byId = {}; for (const n of profile.nodes) byId[n.id] = n;
    const dts = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId[id]; const k = n.callFrame.functionName + ' ' + (n.callFrame.url || '').split('/').pop().split('?')[0] + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + (dts[i] || 0) / 1000; });
    const top = Object.entries(self).filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => '   ' + (v / dt).toFixed(1) + 'ms/s ' + k);
    console.log('\n## ' + name + ' — busy ' + ((z.TaskDuration - a.TaskDuration) / dt * 100).toFixed(0) + '%  script ' + ((z.ScriptDuration - a.ScriptDuration) / dt * 100).toFixed(0) + '%  layout ' + ((z.LayoutDuration - a.LayoutDuration) / dt * 100).toFixed(0) + '%  style ' + ((z.RecalcStyleDuration - a.RecalcStyleDuration) / dt * 100).toFixed(0) + '%  layouts ' + (z.LayoutCount - a.LayoutCount) + ' styles ' + (z.RecalcStyleCount - a.RecalcStyleCount) + ' nodes ' + z.Nodes + '  frames ' + JSON.stringify(fr));
    console.log(top.join('\n'));
  };
  const click = async (sel) => { const t = Date.now(); await p.click(sel, { timeout: 4000 }).catch((e) => console.log('click fail', sel, e.message.split('\n')[0])); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return Date.now() - t; };
  const scroll = async (x) => { await p.mouse.move(x, 500); for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, i % 20 < 10 ? 150 : -150); await p.waitForTimeout(100); } };
  console.log('dom nodes', await p.evaluate(() => document.getElementsByTagName('*').length), 'anims', await p.evaluate(() => document.getAnimations().map((a) => a.animationName + '@' + (a.effect.target.id || String(a.effect.target.className).split(' ')[0])).join(' ')));
  await phase('Today idle', async () => {}, 8);
  await phase('Today scroll', async () => scroll(700), 1);
  const tabs = await p.evaluate(() => [...document.querySelectorAll('#flow-side [data-fn-side]')].filter((b) => b.offsetParent).map((b) => b.getAttribute('data-fn-side')));
  console.log('side tabs', tabs.join(' '));
  for (const pg of tabs.concat(tabs[0])) {
    const ms = await p.evaluate((pg) => new Promise((r) => { const t = performance.now(); document.querySelector('#flow-side [data-fn-side="' + pg + '"]').click(); requestAnimationFrame(() => requestAnimationFrame(() => r(Math.round(performance.now() - t)))); }), pg);
    const lt = await p.evaluate(() => new Promise((r) => { const out = []; const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => out.push(Math.round(e.duration)))); po.observe({ type: 'longtask', buffered: true }); setTimeout(() => { po.disconnect(); r(out); }, 50); }));
    console.log('switch to ' + pg + ': ' + ms + 'ms, nodes ' + (await p.evaluate(() => document.getElementsByTagName('*').length)));
    await p.waitForTimeout(800);
    if (process.env.EACH) { await phase(pg + ' idle', async () => {}, 3); await phase(pg + ' scroll', async () => scroll(700), 1); }
  }
  await phase('typing in Talk box', async () => { await p.focus('#sy-text').catch(() => {}); await p.keyboard.type('remind me to call the supplier tomorrow about the delivery', { delay: 60 }); }, 1);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
