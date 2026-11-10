/* Plugins: MCP servers the team can use, the catalogue, and the yes between
 * an agent and an acting tool.
 *
 * What would make it wrong: a token stored or echoed anywhere; a directory
 * entry counted as working; a server that refused us shown as connected; an
 * acting tool run without the owner's yes; a reading tool on an "approve"
 * plugin run without it; a tool name the server never listed accepted; the
 * approved call running twice. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const P = require('../flow-plugins.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 420) : ''))); };
const mem = () => { const m = {}; return { get: async (k) => (k in m ? JSON.parse(JSON.stringify(m[k])) : null), set: async (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };

(async () => {
  console.log('\n— shapes —');
  ok('a tool is "reads" by its words: get/list/search yes; refund/delete/create no', P.looksRead({ name: 'search_orders', description: 'Search orders' }) && P.looksRead({ name: 'get_page' }) && !P.looksRead({ name: 'refund_order', description: 'Issue a refund' }) && !P.looksRead({ name: 'create_page' }) && !P.looksRead({ name: 'list_and_delete' }));
  ok('the directory is a directory: well-known servers to connect, none of them "working"', P.DIRECTORY.length >= 6 && P.DIRECTORY.every((d) => !d.status) && P.DIRECTORY.some((d) => d.id === 'notion') && P.PLATFORMS[0].id === 'composio');
  const c = mem(); const logs = []; const deps = { log: async (ctx, who, m) => logs.push(m) };
  const added = await P.add(c, deps, { name: 'Shop', url: 'https://mcp.fake.example/mcp', mode: 'read' });
  ok('adding a server connects, lists its tools and marks which read', added.ok && added.plugin.status === 'working' && added.plugin.tools.length === 2 && added.plugin.tools.find((t) => t.name === 'search_orders').reads === true && added.plugin.tools.find((t) => t.name === 'refund_order').reads === false && /connected: Shop \(2 tools\)/.test(logs[0]), added.plugin);
  const agent = { id: 'sarah', name: 'Sarah' };
  const r1 = await P.stepCall(c, deps, agent, { plugin: added.plugin.id, name: 'search_orders', args: { query: 'Ali' } });
  ok('a reading tool on a "read" plugin runs during the step and the result goes back to the agent', r1.called && /Orders matching "Ali"/.test(r1.text) && !r1.proposal, r1);
  const r2 = await P.stepCall(c, deps, agent, { plugin: added.plugin.id, name: 'refund_order', args: { order: '4471', amount: 12 } });
  ok('an acting tool is NOT run: it becomes a proposal for the owner\'s yes, and the agent is told it has not run', !r2.called && r2.proposal && r2.proposal.kind === 'tool' && /Call refund_order on Shop/.test(r2.proposal.summary) && /has NOT run/.test(r2.text) && JSON.parse(r2.proposal.body).args.order === '4471', r2);
  await P.act(c, deps, { op: 'mode', id: added.plugin.id, mode: 'approve' });
  const r3 = await P.stepCall(c, deps, agent, { plugin: added.plugin.id, name: 'search_orders', args: { query: 'x' } });
  ok('on an "approve" plugin even a reading tool waits for the yes', !r3.called && r3.proposal, r3);
  const r4 = await P.stepCall(c, deps, agent, { plugin: added.plugin.id, name: 'nuke_everything', args: {} });
  ok('a tool the server never listed is refused, with the real list', !r4.called && !r4.proposal && /has no tool called nuke_everything/.test(r4.text) && /search_orders, refund_order/.test(r4.text), r4.text);
  const ex = await P.executeApproved(c, deps, { agent: 'sarah', detail: { body: r2.proposal.body } });
  ok('the approved call runs — once — and its result is kept', ex.ok && /Refund of 12 issued for order 4471/.test(ex.text) && (await P.byId(c, added.plugin.id)).calls === 2, ex);
  await P.act(c, deps, { op: 'agents', id: added.plugin.id, agents: ['bobby'] });
  const r5 = await P.stepCall(c, deps, agent, { plugin: added.plugin.id, name: 'search_orders', args: {} });
  ok('a plugin limited to some agents is not available to the others', /not available to you/.test(r5.text));
  const noTok = await P.add(c, deps, { name: 'Private', url: 'https://mcp.private.example/mcp', envVar: 'FAKE_MCP_TOKEN' });
  ok('a server whose token variable is not in the environment is "awaiting", naming the variable — never an error about a value', noTok.ok && noTok.plugin.status === 'awaiting' && /Add FAKE_MCP_TOKEN in Render/.test(noTok.plugin.error) && !('token' in noTok.plugin), noTok.plugin);
  const pasted = await P.add(c, deps, { name: 'Oops', url: 'https://mcp.other.example/mcp', token: 'sk-live-123' });
  ok('a pasted token is refused outright', pasted.error && /Never paste a token/.test(pasted.error));
  const down = await P.add(c, deps, { name: 'Down', url: 'https://mcp.fail.example/mcp' });
  ok('a server that cannot be reached is "error", not working', down.ok && down.plugin.status === 'error' && /could not be reached/.test(down.plugin.error));
  const cat = await P.catalogue(c);
  ok('the catalogue counts honestly: 1 working, 2 awaiting/error, the directory as available, tools from working servers only; Composio awaiting its key', cat.counts.working === 1 && cat.counts.awaiting === 3 && cat.counts.tools === 2 && cat.counts.available >= 6 && cat.platforms[0].status === 'awaiting' && cat.platforms[0].env[0] === 'COMPOSIO_API_KEY', cat.counts);
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-plugins.js'), 'utf8');
  ok('the record keeps the variable\'s name, never a value', /envVar/.test(src) && !/ctx\.set\([^)]*token/i.test(src));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await ctx.newPage();
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

  console.log('\n— the API and the connections list —');
  const c0 = (await api('/api/team/connectors')).j;
  const notion0 = c0.connectors.find((x) => x.name === 'Notion');
  ok('before anything is connected, Notion and the others with an MCP server are "available — connect", not "not built"', notion0 && notion0.status === 'available' && /connect its MCP server in Plugins/.test(notion0.note) && c0.connectors.find((x) => x.name === 'Meta Ads').status === 'not_built' && c0.counts.available >= 4, { n: notion0, counts: c0.counts });
  const a1 = await api('/api/team/plugins', { op: 'add', name: 'Shop', url: 'https://mcp.fake.example/mcp', mode: 'read' });
  const cat2 = (await api('/api/team/plugins')).j;
  const c1 = (await api('/api/team/connectors')).j;
  ok('a connected plugin appears in Plugins as working with its tools, and in Connections as working — counted once, honestly', a1.j.ok && cat2.connected.length === 1 && cat2.counts.working === 1 && cat2.counts.tools === 2 && c1.connectors.find((x) => x.id === 'plugin:' + a1.j.plugin.id).status === 'working' && c1.counts.working === c0.counts.working + 1, { c: cat2.counts, w: c1.counts.working });
  const call = await api('/api/team/plugins', { op: 'call', id: a1.j.plugin.id, name: 'search_orders', args: { query: 'Ali' } });
  ok('the owner can try a tool from the app', call.j.ok && /#4471/.test(call.j.text), call.j);

  console.log('\n— the panel —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(2500);
  const ui = await p.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="plugins"]'); if (!g) return null; return { title: g.querySelector('.hud-ph').textContent, head: g.querySelector('.hud-sub').textContent, rows: [...g.querySelectorAll('.hud-chh > span')].map((x) => x.firstChild.textContent), dir: [...g.querySelectorAll('[data-hud="pluse"],[data-hud="plsign"]')].length, form: !!g.querySelector('form[data-team="pladd"] input[name="envVar"]'), platform: /Composio/.test(g.textContent), noToken: /never the token itself/i.test(g.textContent) }; });
  ok('Plugins on J.A.R.V.I.S.\'s view: the connected server, the directory with Connect buttons, Composio awaiting, and a form that asks for a variable NAME, never a token', ui && /Plugins · 1/.test(ui.title) && /1 connected · 2 tools/.test(ui.head) && ui.rows.join() === 'Shop' && ui.dir >= 6 && ui.form && ui.platform && ui.noToken, ui);
  await p.click('#flow-hud [data-k="plugins"] [data-hud="plopen"]'); await p.waitForTimeout(400);
  ok('opening it lists the tools, marked reads/acts, with the mode switch', await p.evaluate(() => { const g = document.querySelector('#flow-hud [data-k="plugins"] .hud-ch.open'); return !!g && g.querySelectorAll('.hud-k').length === 2 && /search_orders/.test(g.textContent) && /acts/.test(g.textContent) && !!g.querySelector('[data-hud="plmode"]'); }));
  await p.click('#flow-hud [data-k="plugins"] [data-hud="pluse"][data-name="Stripe"]'); await p.waitForTimeout(400);
  ok('Connect on a token directory entry prefills the form with its address and variable name; one that signs you in has Sign in instead', await p.evaluate(() => document.querySelector('#flow-hud form[data-team="pladd"] input[name="url"]').value === 'https://mcp.stripe.com' && document.querySelector('#flow-hud form[data-team="pladd"] input[name="envVar"]').value === 'STRIPE_MCP_TOKEN' && !!document.querySelector('#flow-hud [data-hud="plsign"][data-name="Notion"]')));

  ok('no page errors', errs.length === 0, errs);
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
