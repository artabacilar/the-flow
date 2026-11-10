/* ======================================================================
 * The Flow — plugins: MCP servers the team can use, and the catalogue
 * ======================================================================
 * The "thousand plugins" question, answered honestly. Anyone who publishes
 * an MCP server (the Model Context Protocol, Streamable HTTP) becomes a
 * plugin here: the owner pastes the server's URL (and, if it needs one, the
 * NAME of the Render variable that holds its token — never the token), The
 * Flow connects, lists the tools, and the agents can call them from a task:
 *   mode "read"    — tools are called as the step runs (reading tools only);
 *   mode "approve" — every call is written up as a proposal and runs on the
 *                    owner's yes, like an email.
 * The catalogue lists what is connected (working), what waits for a
 * variable (awaiting configuration), and a directory of well-known MCP
 * servers to connect — directory entries are not "working" and are never
 * counted as such. A platform adapter (Composio) is listed the same way:
 * awaiting its key, then its apps appear as connect-with-one-click entries.
 *
 * Nothing here stores a secret: a plugin keeps the name of an environment
 * variable, and the value is read from the environment at call time.
 * ====================================================================== */
'use strict';

const FAKE = process.env.FLOW_TEAM_FAKE === '1';
const env = (k) => String(process.env[k] || '').trim();
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const PROTOCOL = '2025-06-18';
const auth = require('./flow-mcpauth');

/* ---------- the directory: well-known MCP servers, to connect, not "working" ---- */
const DIRECTORY = [
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', auth: 'oauth', note: 'Pages, databases, search.' },
  { id: 'stripe', name: 'Stripe', url: 'https://mcp.stripe.com', auth: 'bearer', envHint: 'STRIPE_MCP_TOKEN', note: 'Customers, payments, invoices.' },
  { id: 'github', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', auth: 'bearer', envHint: 'GITHUB_MCP_TOKEN', note: 'Issues, pull requests, code.' },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', auth: 'oauth', note: 'Issues and projects.' },
  { id: 'hubspot', name: 'HubSpot', url: 'https://mcp.hubspot.com/', auth: 'oauth', clientEnv: 'HUBSPOT_MCP_CLIENT_ID', note: 'Contacts, deals, tickets. HubSpot asks for an MCP connector first: Development → MCP Connectors, redirect https://theflow.today/api/mcp-oauth/callback, then HUBSPOT_MCP_CLIENT_ID and HUBSPOT_MCP_CLIENT_SECRET in Render.' },
  { id: 'wispr', name: 'Wispr Flow', url: '', paste: true, auth: 'oauth', note: 'Your meeting notes, transcripts and calendar, read-only. Copy the address from Wispr Flow → Settings → MCP and paste it here.' },
  { id: 'shopify', name: 'Shopify (Dev)', url: 'https://shopify.dev/mcp', auth: 'none', note: 'Shopify docs and schemas.' },
  { id: 'cloudflare', name: 'Cloudflare docs', url: 'https://docs.mcp.cloudflare.com/mcp', auth: 'none', note: 'Cloudflare documentation.' },
  { id: 'context7', name: 'Context7 (library docs)', url: 'https://mcp.context7.com/mcp', auth: 'none', note: 'Up-to-date docs for code libraries.' },
  { id: 'fetch', name: 'Fetch (web pages)', url: '', auth: 'none', note: 'Already built in: the web reader.', builtin: true }
];
const PLATFORMS = [
  { id: 'composio', name: 'Composio', env: 'COMPOSIO_API_KEY', url: 'https://backend.composio.dev', note: 'Hundreds of apps through one key: Gmail, Calendar, Drive, Slack, Notion, HubSpot, Salesforce… Each app connects with one click in Composio and then appears here as a plugin.' }
];

/* ---------- store ---------------------------------------------------------- */
async function all(ctx) { const v = await ctx.get('team:plugins'); return Array.isArray(v) ? v : []; }
async function saveAll(ctx, list) { await ctx.set('team:plugins', list.slice(-40)); }
async function byId(ctx, id) { return (await all(ctx)).find((p) => p.id === id) || null; }

/* ---------- the MCP client (Streamable HTTP) -------------------------------- */
function headersFor(p) {
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (p.envVar) { const tok = env(p.envVar); if (tok) h.authorization = 'Bearer ' + tok; }
  else if (p.oauth && p.oauth.access) h.authorization = 'Bearer ' + p.oauth.access;
  if (p.session) h['mcp-session-id'] = p.session;
  h['mcp-protocol-version'] = PROTOCOL;
  return h;
}
/* One JSON-RPC call; the answer may be JSON or an SSE stream with the result in a data: line. */
async function rpc(p, method, params, id) {
  if (FAKE) return fakeRpc(p, method, params, id);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 25000);
  try {
    const body = id === null ? { jsonrpc: '2.0', method, params: params || {} } : { jsonrpc: '2.0', id: id || 1, method, params: params || {} };
    const r = await fetch(p.url, { method: 'POST', headers: headersFor(p), body: JSON.stringify(body), signal: ac.signal });
    const sess = r.headers.get('mcp-session-id'); if (sess) p.session = sess;
    if (id === null) return { ok: r.ok, status: r.status };
    if (r.status === 401 || r.status === 403) return { error: 'The server refused the credentials (' + r.status + ').', auth: true, status: r.status, www: String(r.headers.get('www-authenticate') || '') };
    if (!r.ok) return { error: 'The server answered ' + r.status + '.', status: r.status };
    const ct = String(r.headers.get('content-type') || '');
    const text = await r.text();
    let msg = null;
    if (/text\/event-stream/.test(ct)) {
      for (const line of text.split('\n')) { if (line.indexOf('data:') === 0) { try { const j = JSON.parse(line.slice(5).trim()); if (j && (j.result !== undefined || j.error)) msg = j; } catch (e) {} } }
    } else { try { msg = JSON.parse(text); } catch (e) {} }
    if (!msg) return { error: 'The server did not answer in JSON-RPC.' };
    if (msg.error) return { error: str(msg.error.message || 'error', 200), code: msg.error.code };
    return { result: msg.result };
  } catch (e) { return { error: /abort/i.test(String(e.message)) ? 'The server took too long.' : 'The server could not be reached: ' + str(e.message, 100) }; }
  finally { clearTimeout(t); }
}
/* The stand-in for tests: a tiny server with two tools, a token check, and a failure switch. */
function fakeRpc(p, method, params, id) {
  if (p.envVar && !env(p.envVar)) return { error: 'The server refused the credentials (401).', auth: true, status: 401 };
  if (/\.fake(\/|$)/.test(p.url) && !(p.oauth && p.oauth.access === 'fake-access')) return { error: 'The server refused the credentials (401).', auth: true, status: 401, www: 'Bearer resource_metadata="' + new URL(p.url).origin + '/.well-known/oauth-protected-resource"' };
  if (/fail/.test(p.url)) return { error: 'The server could not be reached: ECONNREFUSED' };
  if (id === null) return { ok: true, status: 202 };
  if (method === 'initialize') { p.session = 'fake-sess'; return { result: { protocolVersion: PROTOCOL, serverInfo: { name: 'Fake MCP', version: '1.0' }, capabilities: { tools: {} } } }; }
  if (method === 'tools/list') return { result: { tools: [
    { name: 'search_orders', description: 'Search orders by customer or status (reads).', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'refund_order', description: 'Issue a refund for an order (writes).', inputSchema: { type: 'object', properties: { order: { type: 'string' }, amount: { type: 'number' } }, required: ['order'] } }
  ] } };
  if (method === 'tools/call') {
    const n = params && params.name, a = (params && params.arguments) || {};
    if (n === 'search_orders') return { result: { content: [{ type: 'text', text: 'Orders matching "' + (a.query || '') + '": #4471 (premium, $12, charged twice on 2 Nov), #4470 (starter, $10).' }] } };
    if (n === 'refund_order') return { result: { content: [{ type: 'text', text: 'Refund of ' + (a.amount || 'the full amount') + ' issued for order ' + a.order + '.' }] } };
    return { error: 'Unknown tool ' + n, code: -32602 };
  }
  return { error: 'Method not found', code: -32601 };
}
/* Connect: initialize, say we are ready, list the tools. Writes what it learned on the plugin. */
async function connect(ctx, p) {
  const started = Date.now();
  const hello = { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'The Flow', version: '1.0' } };
  if (p.oauth) await auth.fresh(p);
  let init = await rpc(p, 'initialize', hello, 1);
  if (init.auth && p.oauth && p.oauth.refresh) { p.session = ''; if (await auth.fresh(p, true)) init = await rpc(p, 'initialize', hello, 1); }
  if (init.auth && !p.envVar) { p.status = 'signin'; p.www = str(init.www, 400); p.error = p.oauth ? 'The sign-in has lapsed — sign in again.' : 'Sign in to connect it.'; p.checkedAt = Date.now(); return p; }
  if (init.error) { p.status = init.auth ? (p.envVar ? 'awaiting' : 'error') : 'error'; p.error = init.error + (init.auth && p.envVar ? ' Add ' + p.envVar + ' in Render.' : ''); p.checkedAt = Date.now(); return p; }
  await rpc(p, 'notifications/initialized', {}, null);
  const tl = await rpc(p, 'tools/list', {}, 2);
  if (tl.error) { p.status = 'error'; p.error = tl.error; p.checkedAt = Date.now(); return p; }
  p.server = init.result && init.result.serverInfo ? { name: str(init.result.serverInfo.name, 60), version: str(init.result.serverInfo.version, 20) } : null;
  p.tools = ((tl.result && tl.result.tools) || []).slice(0, 80).map((t) => ({ name: str(t.name, 80), description: str(t.description, 300), schema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' }, reads: looksRead(t) }));
  p.status = 'working'; p.error = ''; p.checkedAt = Date.now(); p.ms = Date.now() - started;
  return p;
}
/* A reading tool, by its name and words: it is what a "read" plugin may call without a yes. */
function looksRead(t) {
  const s = (t.name + ' ' + (t.description || '')).toLowerCase().replace(/[_\-.\/]/g, ' ');
  if (/\b(delete|remove|create|update|write|send|post|issue|refund|pay|charge|cancel|set|put|patch|archive|publish|execute|run|move|rename|upload|add|insert)\b/.test(s) || /\(writes?\)/.test(s)) return false;
  return /\b(get|list|search|read|fetch|find|query|lookup|describe|show|retrieve|count|view)\b/.test(s) || /\(reads?\)/.test(s);
}
async function callTool(ctx, p, name, args) {
  const q = { name, arguments: args && typeof args === 'object' ? args : {} };
  if (p.oauth) await auth.fresh(p);
  let r = await rpc(p, 'tools/call', q, 3);
  if (r.auth && p.oauth && p.oauth.refresh && await auth.fresh(p, true)) r = await rpc(p, 'tools/call', q, 3);
  if (r.auth && p.oauth) { p.status = 'signin'; p.error = 'The sign-in has lapsed — sign in again.'; }
  if (p.oauth) { const list = await all(ctx); const pp = list.find((x) => x.id === p.id); if (pp && pp !== p) { pp.oauth = p.oauth; if (p.status === 'signin') { pp.status = 'signin'; pp.error = p.error; } await saveAll(ctx, list); } }
  if (r.error) return { error: r.error };
  const content = (r.result && r.result.content) || [];
  const text = content.map((c) => c.type === 'text' ? String(c.text || '') : c.type === 'image' ? '[image]' : c.type === 'resource' ? '[resource ' + str(c.resource && c.resource.uri, 100) + ']' : '').filter(Boolean).join('\n');
  return { ok: true, text: text.slice(0, 12000), isError: !!(r.result && r.result.isError) };
}

/* ---------- the owner's actions --------------------------------------------- */
async function add(ctx, deps, b) {
  const url = str(b.url, 500);
  if (!/^https:\/\/[^\s]+$/i.test(url) && !(FAKE && /^https?:\/\//.test(url))) return { error: 'An MCP server is an https:// address.', status: 400 };
  const envVar = str(b.envVar, 60).replace(/[^A-Z0-9_]/gi, '').toUpperCase();
  if (b.token || b.secret || b.apiKey) return { error: 'Never paste a token here. Put it in Render as a variable and give me the variable\'s NAME.', status: 400 };
  const list = await all(ctx);
  if (list.some((p) => p.url === url)) return { error: 'That server is already connected.', status: 409 };
  if (list.length >= 40) return { error: 'Forty plugins is the ceiling.', status: 400 };
  const dir = DIRECTORY.find((d) => d.url && d.url === url) || DIRECTORY.find((d) => d.id === String(b.dir || '') && d.paste);
  const p = { id: 'pl' + newId(), name: str(b.name || (dir && dir.name) || url.replace(/^https?:\/\//, '').split('/')[0], 60), url, envVar, mode: b.mode === 'read' ? 'read' : 'approve', agents: Array.isArray(b.agents) ? b.agents.map((x) => str(x, 40)).slice(0, 24) : [], status: 'connecting', tools: [], addedAt: Date.now(), calls: 0, directory: dir ? dir.id : '' };
  await connect(ctx, p);
  list.push(p); await saveAll(ctx, list);
  if (deps.log) await deps.log(ctx, 'team', 'Plugin ' + (p.status === 'working' ? 'connected' : 'added, ' + p.status) + ': ' + p.name + (p.tools.length ? ' (' + p.tools.length + ' tools)' : '') + '.');
  if (p.status === 'signin') return Object.assign({ ok: true, plugin: pub(p) }, await signin(ctx, p, deps));
  return { ok: true, plugin: pub(p) };
}
async function act(ctx, deps, b) {
  const op = String(b.op || '');
  if (op === 'add') return await add(ctx, deps, b);
  const list = await all(ctx); const p = list.find((x) => x.id === String(b.id || ''));
  if (!p) return { error: 'No such plugin.', status: 404 };
  if (op === 'check') { await connect(ctx, p); await saveAll(ctx, list); return Object.assign({ ok: true, plugin: pub(p) }, p.status === 'signin' ? await signin(ctx, p, deps) : {}); }
  if (op === 'signin') { if (!p.www && !p.oauth) await connect(ctx, p); await saveAll(ctx, list); const s = await signin(ctx, p, deps); return s.signinError ? { error: s.signinError, needs: s.needs || [], status: 400 } : Object.assign({ ok: true, plugin: pub(p) }, s); }
  if (op === 'mode') { p.mode = b.mode === 'read' ? 'read' : 'approve'; await saveAll(ctx, list); return { ok: true, plugin: pub(p) }; }
  if (op === 'agents') { p.agents = Array.isArray(b.agents) ? b.agents.map((x) => str(x, 40)).slice(0, 24) : []; await saveAll(ctx, list); return { ok: true, plugin: pub(p) }; }
  if (op === 'remove') { await saveAll(ctx, list.filter((x) => x.id !== p.id)); if (deps.log) await deps.log(ctx, 'team', 'Plugin removed: ' + p.name + '.'); return { ok: true }; }
  if (op === 'call') {
    /* the owner tries a tool from the app: always allowed, always logged */
    const r = await callTool(ctx, p, str(b.name, 80), b.args);
    p.calls++; p.lastCall = { at: Date.now(), name: str(b.name, 80), ok: !r.error, by: 'owner' }; await saveAll(ctx, list);
    if (deps.log) await deps.log(ctx, 'team', 'You called ' + b.name + ' on ' + p.name + (r.error ? ' — ' + r.error : '') + '.');
    return r.error ? { error: r.error } : { ok: true, text: r.text, isError: r.isError };
  }
  return { error: 'Unknown op.', status: 400 };
}
/* The sign-in link for a plugin that signs you in itself (flow-mcpauth). */
async function signin(ctx, p, deps) {
  const uid = ctx.user && ctx.user.id; if (!uid) return { signinError: 'Sign in to The Flow first.' };
  const r = await auth.begin(uid, p, p.www, deps.origin || 'https://theflow.today');
  return r.error ? { signinError: r.error, needs: r.needs || [] } : { signin: r.url, expires: r.expires };
}
/* The sign-in came back: keep the tokens on the plugin, list its tools. */
async function finish(ctx, deps, id, oauth) {
  const list = await all(ctx); const p = list.find((x) => x.id === id);
  if (!p) return { error: 'The plugin was removed while you were signing in.' };
  p.oauth = oauth; p.session = ''; p.www = '';
  await connect(ctx, p); await saveAll(ctx, list);
  if (deps && deps.log) await deps.log(ctx, 'team', 'Signed in to ' + p.name + (p.status === 'working' ? ' — ' + p.tools.length + ' tools ready' : ' — ' + (p.error || p.status)) + '.');
  return { plugin: pub(p) };
}
function pub(p) { return { id: p.id, name: p.name, url: p.url, envVar: p.envVar, mode: p.mode, agents: p.agents, status: p.status, error: p.error || '', tools: p.tools || [], server: p.server || null, checkedAt: p.checkedAt, calls: p.calls || 0, lastCall: p.lastCall || null, directory: p.directory || '', signedIn: !!(p.oauth && p.oauth.access), since: p.oauth ? p.oauth.since || 0 : 0 }; }

/* ---------- the catalogue ------------------------------------------------------ */
async function catalogue(ctx) {
  const list = await all(ctx);
  const connected = list.map(pub);
  const platforms = PLATFORMS.map((pf) => ({ id: pf.id, name: pf.name, status: env(pf.env) ? 'working' : 'awaiting', env: env(pf.env) ? [] : [pf.env], note: pf.note, apps: env(pf.env) ? 'Connect apps in Composio; they appear here on the next check.' : '' }));
  const directory = DIRECTORY.filter((d) => !d.builtin && !list.some((p) => (d.url && p.url === d.url) || p.directory === d.id)).map((d) => ({ id: d.id, name: d.name, url: d.url, auth: d.auth, envHint: d.envHint || '', note: d.note, paste: !!d.paste, needs: d.clientEnv && !env(d.clientEnv) ? [d.clientEnv, d.clientEnv.replace(/_ID$/, '_SECRET')] : [], status: 'available' }));
  return { connected, platforms, directory, counts: { working: connected.filter((p) => p.status === 'working').length, awaiting: connected.filter((p) => p.status !== 'working').length + platforms.filter((x) => x.status === 'awaiting').length, available: directory.length, tools: connected.reduce((n, p) => n + (p.status === 'working' ? p.tools.length : 0), 0) } };
}

/* ---------- for the agents ------------------------------------------------------- */
/* The tools an agent may use, as a prompt block, and how. */
async function forAgent(ctx, agentId) {
  const list = (await all(ctx)).filter((p) => p.status === 'working' && p.tools.length && (!p.agents.length || p.agents.indexOf(agentId) >= 0));
  if (!list.length) return { text: '', plugins: [] };
  const lines = ['PLUGINS (tools on connected servers). Call one with "tool": { "plugin": "<plugin id>", "name": "<tool>", "args": { } } and leave "result" empty; you are called again with what it returned. Reading tools on a "read" plugin run at once; anything else is written up for the person\'s yes and runs when they approve. Never invent a plugin id or a tool name.'];
  for (const p of list) lines.push(p.id + ' | ' + p.name + ' | mode ' + p.mode + ':\n' + p.tools.slice(0, 30).map((t) => '  · ' + t.name + (t.reads ? ' (reads)' : ' (acts)') + ' — ' + str(t.description, 140) + (t.schema && t.schema.properties ? ' · args: ' + Object.keys(t.schema.properties).slice(0, 8).join(', ') : '')).join('\n'));
  return { text: lines.join('\n'), plugins: list };
}
/* A step asked for a tool: run it now, or turn it into a proposal. */
async function stepCall(ctx, deps, agent, want) {
  const p = await byId(ctx, String(want.plugin || ''));
  if (!p || p.status !== 'working') return { text: 'PLUGIN ' + (want.plugin || '?') + ' is not connected. Do without it and say so.' };
  if (p.agents.length && p.agents.indexOf(agent.id) < 0) return { text: 'PLUGIN ' + p.name + ' is not available to you. Do without it and say so.' };
  const tool = p.tools.find((t) => t.name === want.name);
  if (!tool) return { text: 'PLUGIN ' + p.name + ' has no tool called ' + str(want.name, 60) + '. Its tools: ' + p.tools.map((t) => t.name).join(', ') + '.' };
  if (p.mode === 'read' && tool.reads) {
    const r = await callTool(ctx, p, tool.name, want.args);
    const list = await all(ctx); const pp = list.find((x) => x.id === p.id); if (pp) { pp.calls++; pp.lastCall = { at: Date.now(), name: tool.name, ok: !r.error, by: agent.id }; await saveAll(ctx, list); }
    if (deps.log) await deps.log(ctx, agent.id, agent.name + ' used ' + tool.name + ' on ' + p.name + (r.error ? ' — ' + r.error : '') + '.');
    return { text: 'PLUGIN ' + p.name + ' · ' + tool.name + (r.error ? ' failed: ' + r.error : ' returned:\n' + r.text), called: true };
  }
  /* anything that acts, or a plugin that always asks: a proposal the person approves */
  return { proposal: { kind: 'tool', summary: 'Call ' + tool.name + ' on ' + p.name + (want.args && Object.keys(want.args).length ? ' with ' + str(JSON.stringify(want.args), 160) : ''), to: p.name, subject: tool.name, body: JSON.stringify({ plugin: p.id, name: tool.name, args: want.args || {} }) }, text: 'PLUGIN ' + p.name + ' · ' + tool.name + ' was written up for the person\'s yes (mode ' + p.mode + (tool.reads ? '' : ', an acting tool') + '). It has NOT run. Finish your part without its result and say the call is waiting for approval.' };
}
/* The yes: run the call the proposal describes — once. */
async function executeApproved(ctx, deps, item) {
  let want = null; try { want = JSON.parse(item.detail && item.detail.body || '{}'); } catch (e) {}
  if (!want || !want.plugin) return { error: 'The approval does not describe a tool call.' };
  const p = await byId(ctx, want.plugin);
  if (!p || p.status !== 'working') return { error: 'The plugin is no longer connected.' };
  const r = await callTool(ctx, p, str(want.name, 80), want.args);
  const list = await all(ctx); const pp = list.find((x) => x.id === p.id); if (pp) { pp.calls++; pp.lastCall = { at: Date.now(), name: want.name, ok: !r.error, by: 'approval' }; await saveAll(ctx, list); }
  if (deps.log) await deps.log(ctx, item.agent, 'Approved and run: ' + want.name + ' on ' + p.name + (r.error ? ' — ' + r.error : '') + '.');
  return r.error ? { error: r.error } : { ok: true, text: r.text };
}

/* ---------- routes ---------------------------------------------------------- */
async function handle(p, req, res, ctx, deps) {
  if (p !== '/api/team/plugins') return false;
  const json = ctx.json;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket && req.socket.encrypted ? 'https' : 'http');
  deps = Object.assign({}, deps, { origin: proto + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'theflow.today') });
  if (req.method === 'GET') { json(res, 200, Object.assign({ ok: true }, await catalogue(ctx))); return true; }
  if (req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
    const r = await act(ctx, deps, b);
    json(res, r.error ? (r.status || 400) : 200, r);
    return true;
  }
  return false;
}

module.exports = { DIRECTORY, PLATFORMS, all, byId, connect, callTool, looksRead, add, act, catalogue, forAgent, stepCall, executeApproved, handle, pub, signin, finish };
