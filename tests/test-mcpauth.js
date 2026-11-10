/* MCP sign-in: Notion, Linear, HubSpot, Wispr Flow — one click, no token pasted.
 *
 * What would make it wrong: a server that signs you in shown as an error; a
 * sign-in link without PKCE or a state; a state that works twice or after
 * ten minutes; tokens shown in the app; an expired token that silently
 * breaks the team instead of being refreshed; HubSpot (no self-registration)
 * failing without naming what to put in Render; the panel with no Sign in.
 * Every server here is a stand-in (*.fake). */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const P = require('../flow-plugins.js');
const A = require('../flow-mcpauth.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 360) : ''))); };
const memCtx = (uid) => { const m = {}; return { m, user: { id: uid }, get: async (k) => (k in m ? JSON.parse(JSON.stringify(m[k])) : null), set: async (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };
const fakeRes = () => { const r = { code: 0, body: '', headers: {} }; r.writeHead = (c, h) => { r.code = c; r.headers = h || {}; }; r.end = (b) => { r.body = String(b || ''); }; return r; };

(async () => {
  console.log('\n— signing in, in the module —');
  const raw = {}; const users = {};
  A.setStore({ raw: { get: async (k) => raw[k], set: async (k, v) => { raw[k] = v; } }, ctxFor: (uid) => users[uid] });
  const c = users.u1 = memCtx('u1'); const deps = { log: async () => {}, origin: 'https://theflow.example' };
  const add = await P.add(c, deps, { name: 'Notes', url: 'https://mcp.dcr.fake/mcp', mode: 'read' });
  ok('a server that signs you in is "Sign in needed", not an error, and comes with its sign-in link', add.ok && add.plugin.status === 'signin' && /^https:\/\/authdcr\.fake\/authorize\?/.test(add.signin || ''), add);
  const q = new URL(add.signin).searchParams;
  ok('the link is a proper one: our registered client, PKCE S256, a long state, the resource, our callback', /^fake-client-/.test(q.get('client_id')) && q.get('code_challenge_method') === 'S256' && q.get('code_challenge').length >= 43 && q.get('state').length >= 20 && q.get('resource') === 'https://mcp.dcr.fake/mcp' && q.get('redirect_uri') === 'https://theflow.example/api/mcp-oauth/callback' && q.get('scope') === 'read');
  const st = q.get('state');
  const bad = fakeRes(); await A.handle('/api/mcp-oauth/callback', { headers: {} }, bad, { query: new URLSearchParams({ state: 'nope', code: 'good' }) }, { finish: (cx, id, o) => P.finish(cx, deps, id, o) });
  ok('an unknown state connects nothing', bad.code === 400 && /expired/.test(bad.body));
  const res = fakeRes(); await A.handle('/api/mcp-oauth/callback', { headers: {} }, res, { query: new URLSearchParams({ state: st, code: 'good' }) }, { finish: (cx, id, o) => P.finish(cx, deps, id, o) });
  const pl = await P.byId(c, add.plugin.id);
  ok('coming back: the code is exchanged, the tokens kept on the plugin, the tools listed', res.code === 200 && /Notes connected/.test(res.body) && /2 tools/.test(res.body) && pl.status === 'working' && pl.tools.length === 2 && pl.oauth.access === 'fake-access' && pl.oauth.refresh === 'fake-refresh', { code: res.code, st: pl.status });
  const again = fakeRes(); await A.handle('/api/mcp-oauth/callback', { headers: {} }, again, { query: new URLSearchParams({ state: st, code: 'good' }) }, { finish: (cx, id, o) => P.finish(cx, deps, id, o) });
  ok('the same state a second time does nothing', again.code === 400 && /expired/.test(again.body));
  const shown = JSON.stringify(P.pub(pl)) + JSON.stringify(await P.catalogue(c));
  ok('the app is told it is signed in, never shown a token', P.pub(pl).signedIn === true && !/fake-access|fake-refresh/.test(shown));

  const list = await P.all(c); list[0].oauth.exp = Date.now() - 1000; list[0].oauth.access = 'stale'; await c.set('team:plugins', list);
  const call = await P.stepCall(c, deps, { id: 'jarvis', name: 'J.A.R.V.I.S.' }, { plugin: add.plugin.id, name: 'search_orders', args: { query: 'Ali' } });
  ok('an expired token is refreshed before the call and the call goes through', call.text && /Orders matching/.test(call.text) && (await P.byId(c, add.plugin.id)).oauth.access === 'fake-access', call);
  const l2 = await P.all(c); l2[0].oauth.access = 'stale'; l2[0].oauth.exp = Date.now() + 3600e3; await c.set('team:plugins', l2);
  const r2 = await P.act(c, deps, { op: 'call', id: add.plugin.id, name: 'search_orders', args: { query: 'x' } });
  ok('a token the server refuses is refreshed once and the call retried', r2.ok && (await P.byId(c, add.plugin.id)).oauth.access === 'fake-access', r2);
  const l3 = await P.all(c); l3[0].oauth.access = 'stale'; l3[0].oauth.refresh = 'revoked'; await c.set('team:plugins', l3);
  await P.act(c, deps, { op: 'check', id: add.plugin.id });
  ok('a sign-in that can no longer be refreshed says "sign in again" — it does not pretend to work', (await P.byId(c, add.plugin.id)).status === 'signin', (await P.byId(c, add.plugin.id)).error);
  const re = await P.act(c, deps, { op: 'signin', id: add.plugin.id });
  ok('…and a new sign-in link is one tap away', re.ok && /authdcr\.fake\/authorize/.test(re.signin || ''), re);

  const cimd = await A.begin('u1', { id: 'x', url: 'https://mcp.cimd.fake/mcp' }, '', 'https://theflow.example');
  ok('a server that accepts a client id document gets our own URL as the client id — nothing registered', new URL(cimd.url).searchParams.get('client_id') === 'https://theflow.example/api/mcp-oauth/client.json');
  const doc = A.clientDoc('https://theflow.example');
  ok('…and that document names our callback only', doc.client_id === 'https://theflow.example/api/mcp-oauth/client.json' && doc.redirect_uris.join() === 'https://theflow.example/api/mcp-oauth/callback' && doc.token_endpoint_auth_method === 'none');
  const legacy = await A.begin('u1', { id: 'y', url: 'https://mcp.legacy.fake/mcp' }, '', 'https://theflow.example');
  ok('an older server that keeps its sign-in on its own address still works', /^https:\/\/mcp\.legacy\.fake\/authorize\?/.test(legacy.url || ''), legacy);
  const hub = await A.begin('u1', { id: 'z', url: 'https://mcp.env.fake/mcp', directory: 'hubspot' }, '', 'https://theflow.example');
  ok('HubSpot-style (no self-registration): it names the two variables to put in Render, and the redirect to give HubSpot', hub.error && /HUBSPOT_MCP_CLIENT_ID/.test(hub.error) && /HUBSPOT_MCP_CLIENT_SECRET/.test(hub.error) && /theflow\.example\/api\/mcp-oauth\/callback/.test(hub.error) && hub.needs.length === 2, hub);
  process.env.HUBSPOT_MCP_CLIENT_ID = 'hub-app-1';
  const hub2 = await A.begin('u1', { id: 'z', url: 'https://mcp.env.fake/mcp', directory: 'hubspot' }, '', 'https://theflow.example');
  ok('…and with them there, it signs in with that app', new URL(hub2.url).searchParams.get('client_id') === 'hub-app-1');
  delete process.env.HUBSPOT_MCP_CLIENT_ID;
  const old = Object.keys(raw).find((k) => /^mcpoauth:st:/.test(k) && raw[k]); const rec = JSON.parse(raw[old]); rec.at = Date.now() - 11 * 60 * 1000; raw[old] = JSON.stringify(rec);
  const late = fakeRes(); await A.handle('/api/mcp-oauth/callback', { headers: {} }, late, { query: new URLSearchParams({ state: old.slice('mcpoauth:st:'.length), code: 'good' }) }, { finish: (cx, id, o) => P.finish(cx, deps, id, o) });
  ok('a state older than ten minutes is refused', late.code === 400 && /expired/.test(late.body));
  ok('the directory has Notion, Linear, HubSpot (sign in) and Wispr Flow (paste its address)', ['notion', 'linear', 'hubspot'].every((id) => P.DIRECTORY.find((d) => d.id === id).auth === 'oauth') && P.DIRECTORY.find((d) => d.id === 'wispr').paste === true);

  console.log('\n— through the server —');
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
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body]);
  await api('/api/team');
  const cd = await (await fetch(H + '/api/mcp-oauth/client.json')).json();
  ok('the client id document is served without a session', cd.client_id === H + '/api/mcp-oauth/client.json' && cd.redirect_uris[0] === H + '/api/mcp-oauth/callback', cd);

  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(2500);
  await p.evaluate(async () => { await FlowTeam.loadPlugins(true); FlowHud.paint(); }); await p.waitForTimeout(500);
  const dir = await p.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="plugins"]'); return g && { sign: [...g.querySelectorAll('[data-hud="plsign"]')].map((x) => x.getAttribute('data-name')), paste: [...g.querySelectorAll('[data-hud="pluse"][data-dir="wispr"]')].length, hubNeeds: /Missing in Render: HUBSPOT_MCP_CLIENT_ID/.test(g.textContent) }; });
  ok('the directory shows Sign in for Notion, Linear and HubSpot, "Paste its address" for Wispr Flow, and what HubSpot still needs', dir && ['Notion', 'Linear', 'HubSpot'].every((n) => dir.sign.indexOf(n) >= 0) && dir.paste === 1 && dir.hubNeeds, dir);
  await p.click('#flow-hud [data-k="plugins"] [data-hud="pluse"][data-dir="wispr"]'); await p.waitForTimeout(300);
  await p.fill('#flow-hud form[data-team="pladd"] input[name="url"]', 'https://mcp.dcr.fake/mcp');
  await p.click('#flow-hud form[data-team="pladd"] button[type="submit"]'); await p.waitForTimeout(1500);
  const go = await p.evaluate(() => ({ btn: !!document.querySelector('#flow-hud [data-k="plugins"] [data-hud="plgo"]'), sign: FlowTeam.plSign }));
  ok('pasting Wispr Flow\'s address gives an "Open its sign-in" button (a real tap, so app web views open it)', go.btn && go.sign && /authdcr\.fake/.test(go.sign.url), go);
  const cat = (await api('/api/team/plugins')).j; const wp = cat.connected.find((x) => x.directory === 'wispr');
  ok('it is kept as Wispr Flow, waiting for the sign-in, and gone from the directory', wp && wp.name === 'Wispr Flow' && wp.status === 'signin' && !cat.directory.some((d) => d.id === 'wispr'), { wp, d: cat.directory.map((d) => d.id) });
  await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await p.click('#flow-hud [data-k="plugins"] [data-hud="plgo"]'); await p.waitForTimeout(300);
  const opened = await p.evaluate(() => window.__opened[0] || '');
  const state = new URL(opened).searchParams.get('state');
  const cb = await fetch(H + '/api/mcp-oauth/callback?code=good&state=' + encodeURIComponent(state));
  const cbt = await cb.text();
  ok('the sign-in finishes in another browser with no session — the state is the proof', cb.status === 200 && /Wispr Flow connected/.test(cbt), cbt.slice(0, 200));
  await p.waitForTimeout(4000);
  const after = await p.evaluate(() => { const x = ((FlowTeam.pl && FlowTeam.pl.connected) || []).find((p) => p.directory === 'wispr'); return x && { st: x.status, tools: x.tools.length, signed: x.signedIn }; });
  ok('the panel notices by itself: working, with its tools', after && after.st === 'working' && after.tools === 2 && after.signed, after);
  ok('no page errors', errs.length === 0, errs);
  await b.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
