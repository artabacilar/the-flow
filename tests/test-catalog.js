/* The plugin catalogue: thousands of MCP servers from the official registry,
 * searchable in the command centre, one click from being a plugin.
 *
 * What would make it wrong: a server that only runs on a computer offered as
 * if it ran here; an address with blanks to fill in offered as one click; a
 * key asked for in the app instead of a Render variable's name; a listed
 * server counted as working; search that finds nothing it should; the
 * panel with no way to get to it. The registry here is a stand-in (1,200
 * made-up servers). */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const C = require('../flow-catalog.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 360) : ''))); };

(async () => {
  console.log('\n— reading the registry —');
  const remote = C.shape({ server: { name: 'com.acme/books', title: 'Acme Books', description: 'Invoices and accounting', remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.com/mcp', headers: [{ name: 'X-API-Key', isRequired: true, isSecret: true, description: 'Your key' }] }] } });
  ok('a remote server is kept, with its address, what key it needs, and a shelf', remote && remote.url === 'https://mcp.acme.com/mcp' && remote.needs[0].header === 'X-API-Key' && remote.cat === 'Finance', remote);
  ok('one that has to be installed on a computer is not offered', C.shape({ server: { name: 'x/local', packages: [{ registryType: 'npm', identifier: 'x' }] } }) === null);
  ok('an address with blanks to fill in is not offered as one click', C.shape({ server: { name: 'x/tmpl', remotes: [{ type: 'streamable-http', url: 'https://{tenant}.x.com/mcp' }] } }) === null);
  ok('plain http is not offered', C.shape({ server: { name: 'x/http', remotes: [{ type: 'streamable-http', url: 'http://x.com/mcp' }] } }) === null);
  const all = await C.search('', 'All', 0, 40);
  ok('a thousand and more, forty at a time, with shelves counted', all.total >= 1000 && all.items.length === 40 && all.count === all.total && Object.keys(all.cats).length >= 5, { total: all.total, n: all.items.length, cats: all.cats });
  const inv = await C.search('invoices', 'All', 0, 40);
  ok('search finds by name and words', inv.count === 100 && inv.items.every((x) => /invoices/i.test(x.title + x.description)), inv.count);
  const page2 = await C.search('', 'All', 40, 40);
  ok('the next forty are the next forty', page2.items[0].id !== all.items[0].id && page2.offset === 40);
  const fin = await C.search('', 'Finance', 0, 100);
  ok('a shelf shows only its own', fin.count > 0 && fin.items.every((x) => x.cat === 'Finance'), fin.count);

  console.log('\n— in the command centre —');
  const b = await chromium.launch();
  const bc = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await bc.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); });
  await p.waitForTimeout(800);
  const api = (path) => p.evaluate(async (path) => { const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, path);
  await api('/api/team');
  const viaApi = await api('/api/team/plugins/catalog?q=weather&limit=5');
  ok('the catalogue answers signed in, saying where it comes from', viaApi.status === 200 && viaApi.j.items.length === 5 && /MCP Registry/.test(viaApi.j.source), viaApi.j.count);
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(2500);
  await p.evaluate(async () => { await FlowTeam.loadPlugins(true); FlowHud.paint(); }); await p.waitForTimeout(400);
  await p.click('#flow-hud [data-k="plugins"] [data-hud="catopen"]'); await p.waitForTimeout(1500);
  const v = await p.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="catalog"]'); return g && { title: g.querySelector('.hud-ph').textContent, rows: g.querySelectorAll('.hud-catr').length, more: !!g.querySelector('[data-hud="catmore"]'), search: !!g.querySelector('input[data-team-catq]'), shelf: g.querySelectorAll('select[data-team-catc] option').length }; });
  ok('"Browse all plugins" opens the catalogue: 1,200, forty showing, more to load, a search and shelves', v && /Plugin catalogue · 1,200/.test(v.title) && v.rows === 40 && v.more && v.search && v.shelf >= 5, v);
  await p.click('#flow-hud [data-hud="catmore"]'); await p.waitForTimeout(800);
  ok('"Show more" adds the next forty', await p.evaluate(() => document.querySelectorAll('#flow-hud [data-k="catalog"] .hud-catr').length === 80));
  await p.fill('#flow-hud input[data-team-catq]', 'recipes 7'); await p.waitForTimeout(1200);
  const s = await p.evaluate(() => [...document.querySelectorAll('#flow-hud [data-k="catalog"] .hud-catr b')].map((x) => x.textContent));
  ok('typing searches as you go', s.length >= 1 && s.every((t) => /Recipes/.test(t)), s.slice(0, 5));
  /* one that needs no key: connect → added (the stand-in server lists two tools) */
  await p.fill('#flow-hud input[data-team-catq]', 'weather 3'); await p.waitForTimeout(1200);
  const target = await p.evaluate(() => { const r = [...document.querySelectorAll('#flow-hud [data-k="catalog"] .hud-catr')].find((x) => !/needs a key/.test(x.textContent)); return r && r.querySelector('[data-hud="catadd"]').getAttribute('data-url'); });
  await p.click('#flow-hud [data-k="catalog"] [data-hud="catadd"][data-url="' + target + '"]'); await p.waitForTimeout(1500);
  const cat2 = (await api('/api/team/plugins')).j; const added = cat2.connected.find((x) => x.url === target);
  ok('Connect makes it a plugin — working with its tools, behind the yes', added && added.status === 'working' && added.tools.length === 2 && added.mode === 'approve' && added.source === 'registry', added);
  ok('…and it shows as Added in the catalogue', await p.evaluate((u) => { FlowHud.paint(); const r = [...document.querySelectorAll('#flow-hud [data-k="catalog"] .hud-catr')].find((x) => x.innerHTML.indexOf(u) >= 0 || /Added/.test(x.textContent)); return !!r && /Added/.test(r.textContent); }, target));
  /* one that needs a key: the form, with the variable's NAME and the header */
  await p.fill('#flow-hud input[data-team-catq]', 'invoices 26'); await p.waitForTimeout(1200);
  const keyed = await p.evaluate(() => { const r = [...document.querySelectorAll('#flow-hud [data-k="catalog"] .hud-catr')].find((x) => /needs a key \(X-API-Key\)/.test(x.textContent)); return r && r.querySelector('[data-hud="catadd"]').getAttribute('data-url'); });
  await p.click('#flow-hud [data-k="catalog"] [data-hud="catadd"][data-url="' + keyed + '"]'); await p.waitForTimeout(600);
  const form = await p.evaluate(() => { const f = document.querySelector('#flow-hud form[data-team="pladd"]'); return { url: f.url.value, env: f.envVar.value, header: f.header.value, state: (document.querySelector('#flow-say .sy-state') || {}).textContent || '' }; });
  ok('one that needs a key fills the form: its address, a variable NAME for Render, and the header — never a key box', form.url === keyed && /^[A-Z0-9_]+_MCP_KEY$/.test(form.env) && form.header === 'X-API-Key', form);
  ok('no page errors', errs.length === 0, errs);
  await b.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
