/* MCP sign-in: the one-click way to connect a server that signs you in itself
 * (Notion, Linear, HubSpot, Wispr Flow, and anyone following the MCP
 * authorization spec).
 *
 *   1. Discover. The server's 401 names its protected-resource metadata
 *      (RFC 9728); that names the authorization server, whose metadata
 *      (RFC 8414, or OpenID's) gives the endpoints. An older server keeps
 *      them on its own origin.
 *   2. Who we are. A client id metadata document (our own URL, when the
 *      server accepts one), else dynamic registration (RFC 7591), else a
 *      client id and secret the owner made in that service and put in
 *      Render as <ID>_MCP_CLIENT_ID / <ID>_MCP_CLIENT_SECRET — HubSpot works
 *      that way. The secret is read from the environment, never stored.
 *   3. PKCE (S256), a 128-bit state good for ten minutes and spent on first
 *      sight. The state carries the account, so the round trip can finish
 *      in Safari or the default browser, outside the app's web view.
 *   4. Tokens are kept on the plugin, refreshed before they lapse and once
 *      more if the server refuses one. They are never shown to anyone.
 *
 * Routes (no session — the state is the proof):
 *   GET /api/mcp-oauth/callback?code&state
 *   GET /api/mcp-oauth/client.json   the client id metadata document
 */
'use strict';
const crypto = require('crypto');

const FAKE = process.env.FLOW_TEAM_FAKE === '1';
const env = (k) => String(process.env[k] || '').trim();
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TTL = 10 * 60 * 1000;
const ST = (s) => 'mcpoauth:st:' + s;
const CL = (k) => 'mcpoauth:client:' + crypto.createHash('sha256').update(k).digest('hex').slice(0, 24);

let store = null;   /* { raw, ctxFor(uid) } — set by flow-team at start */
function setStore(s) { store = s; }
async function rawGet(k) { if (!store) return null; const v = await store.raw.get(k); if (v == null || v === '') return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } }
async function rawSet(k, v) { if (store) await store.raw.set(k, v == null ? '' : JSON.stringify(v)); }

/* ---------- HTTP, with a stand-in for tests ---------- */
async function http(url, opts) {
  if (FAKE && /\.fake(\/|$|:)/.test(url)) return fakeHttp(url, opts || {});
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, Object.assign({ signal: ac.signal, redirect: 'follow' }, opts || {}));
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
    return { status: r.status, ok: r.ok, json: j, text, www: r.headers.get('www-authenticate') || '' };
  } catch (e) { return { status: 0, ok: false, json: null, text: '', error: str(e.message, 120) }; }
  finally { clearTimeout(t); }
}
function fakeHttp(url, o) {
  const u = new URL(url); const J = (status, json, www) => ({ status, ok: status < 400, json, text: JSON.stringify(json || {}), www: www || '' });
  const host = u.host; /* mcp.<kind>.fake: kind = dcr | cimd | env | legacy */
  const kind = host.split('.')[1] || 'dcr';
  if (u.pathname.indexOf('/.well-known/oauth-protected-resource') === 0) return kind === 'legacy' ? J(404, null) : J(200, { resource: 'https://' + host + '/mcp', authorization_servers: ['https://auth' + kind + '.fake'], scopes_supported: ['read'] });
  if (u.pathname.indexOf('/.well-known/oauth-authorization-server') === 0) {
    const base = 'https://' + host;
    if (kind === 'legacy' && !/^auth/.test(host)) return J(404, null);
    return J(200, { issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', registration_endpoint: /dcr|legacy/.test(host) ? base + '/register' : undefined, code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: /cimd/.test(host) });
  }
  if (u.pathname === '/register') { const b = JSON.parse(o.body || '{}'); return J(201, { client_id: 'fake-client-' + (b.redirect_uris || [''])[0].length }); }
  if (u.pathname === '/token') {
    const b = Object.fromEntries(new URLSearchParams(o.body || ''));
    if (b.grant_type === 'authorization_code') { if (b.code !== 'good' || !b.code_verifier) return J(400, { error: 'invalid_grant' }); return J(200, { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, token_type: 'Bearer' }); }
    if (b.grant_type === 'refresh_token') return b.refresh_token === 'fake-refresh' ? J(200, { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600 }) : J(400, { error: 'invalid_grant' });
    return J(400, { error: 'unsupported_grant_type' });
  }
  return J(404, null);
}

/* ---------- discovery ---------- */
function wellKnown(base, name) { const u = new URL(base); const path = u.pathname.replace(/\/$/, ''); return [u.origin + '/.well-known/' + name + (path && path !== '/' ? path : ''), u.origin + '/.well-known/' + name]; }
async function discover(serverUrl, www) {
  let prmUrl = ''; const m = /resource_metadata="([^"]+)"/i.exec(String(www || '')); if (m) prmUrl = m[1];
  let prm = null;
  for (const u of (prmUrl ? [prmUrl] : wellKnown(serverUrl, 'oauth-protected-resource'))) { const r = await http(u, { headers: { accept: 'application/json' } }); if (r.ok && r.json && Array.isArray(r.json.authorization_servers)) { prm = r.json; break; } }
  const issuer = prm ? String(prm.authorization_servers[0] || '') : new URL(serverUrl).origin;
  let as = null;
  for (const u of wellKnown(issuer, 'oauth-authorization-server').concat(wellKnown(issuer, 'openid-configuration'))) { const r = await http(u, { headers: { accept: 'application/json' } }); if (r.ok && r.json && r.json.authorization_endpoint && r.json.token_endpoint) { as = r.json; break; } }
  if (!as && !prm) { const o = new URL(serverUrl).origin; as = { issuer: o, authorization_endpoint: o + '/authorize', token_endpoint: o + '/token', registration_endpoint: o + '/register', legacy: true }; }
  if (!as) return { error: 'The server names a sign-in service that could not be read.' };
  return { prm, as, resource: prm && prm.resource ? String(prm.resource) : serverUrl, scopes: prm && Array.isArray(prm.scopes_supported) ? prm.scopes_supported : [] };
}

/* ---------- who we are, to that sign-in service ---------- */
function envPrefix(dirId) { return String(dirId || '').toUpperCase().replace(/[^A-Z0-9]/g, '_'); }
async function clientFor(d, redirect, origin, dirId) {
  const pre = envPrefix(dirId);
  if (pre && env(pre + '_MCP_CLIENT_ID')) return { id: env(pre + '_MCP_CLIENT_ID'), secretEnv: env(pre + '_MCP_CLIENT_SECRET') ? pre + '_MCP_CLIENT_SECRET' : '', how: 'env' };
  if (d.as.client_id_metadata_document_supported) return { id: origin + '/api/mcp-oauth/client.json', how: 'cimd' };
  if (d.as.registration_endpoint) {
    const key = d.as.issuer + '|' + redirect; const have = await rawGet(CL(key)); if (have && have.id) return have;
    const r = await http(d.as.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ client_name: 'The Flow', client_uri: origin, redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
    if (r.ok && r.json && r.json.client_id) { const c = { id: String(r.json.client_id), secret: r.json.client_secret ? String(r.json.client_secret) : '', how: 'dcr' }; await rawSet(CL(key), c); return c; }
    return { error: 'The sign-in service would not register The Flow' + (r.json && r.json.error_description ? ': ' + str(r.json.error_description, 140) : '') + '.' };
  }
  return { error: 'This service needs an app made for The Flow first.' + (pre ? ' Make one in its developer settings with the redirect ' + redirect + ', then put ' + pre + '_MCP_CLIENT_ID and ' + pre + '_MCP_CLIENT_SECRET in Render.' : ''), needs: pre ? [pre + '_MCP_CLIENT_ID', pre + '_MCP_CLIENT_SECRET'] : [] };
}
function clientDoc(origin) {
  return { client_id: origin + '/api/mcp-oauth/client.json', client_name: 'The Flow', client_uri: origin, logo_uri: origin + '/icon-192.png', redirect_uris: [origin + '/api/mcp-oauth/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
}

/* ---------- 1–3: the sign-in link ---------- */
async function begin(uid, p, www, origin) {
  if (!store) return { error: 'Sign-in is not available on this server.' };
  const d = await discover(p.url, www); if (d.error) return d;
  const redirect = origin + '/api/mcp-oauth/callback';
  const c = await clientFor(d, redirect, origin, p.directory); if (c.error) return c;
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  await rawSet(ST(state), { uid: String(uid), plugin: p.id, at: Date.now(), verifier, redirect, client: c, as: { issuer: d.as.issuer, token: d.as.token_endpoint }, resource: d.resource });
  const q = new URLSearchParams({ response_type: 'code', client_id: c.id, redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: 'S256', resource: d.resource });
  if (d.scopes.length) q.set('scope', d.scopes.join(' '));
  const a = d.as.authorization_endpoint; return { url: a + (a.indexOf('?') >= 0 ? '&' : '?') + q.toString(), expires: Date.now() + TTL };
}

/* ---------- tokens ---------- */
async function tokenCall(o, form) {
  const body = new URLSearchParams(Object.assign({ client_id: o.client.id }, form));
  const sec = o.client.secretEnv ? env(o.client.secretEnv) : o.client.secret;
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (sec) headers.authorization = 'Basic ' + Buffer.from(encodeURIComponent(o.client.id) + ':' + encodeURIComponent(sec)).toString('base64');
  const r = await http(o.as.token, { method: 'POST', headers, body: body.toString() });
  if (!r.ok || !r.json || !r.json.access_token) return { error: (r.json && (r.json.error_description || r.json.error)) ? str(r.json.error_description || r.json.error, 160) : 'The sign-in service answered ' + r.status + '.' };
  return { access: String(r.json.access_token), refresh: r.json.refresh_token ? String(r.json.refresh_token) : '', exp: r.json.expires_in ? Date.now() + Number(r.json.expires_in) * 1000 : 0 };
}
/* The access token to send, refreshed first when it is about to lapse (force: it was just refused). */
async function fresh(p, force) {
  const o = p.oauth; if (!o || !o.access) return '';
  if (!force && (!o.exp || o.exp - Date.now() > 60000)) return o.access;
  if (!o.refresh) return force ? '' : o.access;
  const t = await tokenCall(o, { grant_type: 'refresh_token', refresh_token: o.refresh, resource: o.resource || p.url });
  if (t.error) { if (force) { o.access = ''; o.broken = t.error; } return force ? '' : o.access; }
  o.access = t.access; if (t.refresh) o.refresh = t.refresh; o.exp = t.exp; o.broken = '';
  return o.access;
}

/* ---------- 4: coming back ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function page(title, body, ok) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0a0b0d"><title>' + esc(title) + ' — The Flow</title>' +
    '<style>html,body{margin:0;height:100%;background:#0a0b0d;color:#e8eaee;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}main{max-width:420px;margin:0 auto;padding:18vh 24px 0;text-align:center}.mark{width:56px;height:56px;border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:28px;background:' + (ok ? 'rgba(52,211,153,.14);color:#34d399' : 'rgba(248,113,113,.14);color:#f87171') + '}h1{font-size:22px;margin:0 0 8px}p{color:#9aa1ad;margin:0 0 8px}a{color:#e8eaee}</style></head><body><main><div class="mark">' + (ok ? '&#10003;' : '!') + '</div><h1>' + esc(title) + '</h1>' + body + '<p><a href="/">Open The Flow</a></p></main></body></html>';
}
/* deps.finish(ctx, pluginId, oauth) → { plugin } saves the tokens on the plugin and lists its tools. */
async function handle(p, req, res, ctx, deps) {
  if (p === '/api/mcp-oauth/client.json') {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket && req.socket.encrypted ? 'https' : 'http'); const host = req.headers['x-forwarded-host'] || req.headers.host || 'theflow.today';
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }); res.end(JSON.stringify(clientDoc(proto + '://' + host))); return true;
  }
  if (p !== '/api/mcp-oauth/callback') return false;
  const out = (code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return true; };
  const q = ctx.query; const state = q.get('state') || '';
  const rec = state ? await rawGet(ST(state)) : null;
  if (state) await rawSet(ST(state), null);   /* single use, whatever happens next */
  if (!rec || Date.now() - rec.at > TTL) return out(400, page('Not connected', '<p>That sign-in link has expired. Go back to The Flow and press Sign in again.</p>', false));
  if (q.get('error')) return out(400, page('Not connected', '<p>Permission was not given' + (q.get('error_description') ? ': ' + esc(str(q.get('error_description'), 160)) : '') + '.</p>', false));
  const code = q.get('code'); if (!code) return out(400, page('Not connected', '<p>The sign-in did not finish.</p>', false));
  const t = await tokenCall(rec, { grant_type: 'authorization_code', code, redirect_uri: rec.redirect, code_verifier: rec.verifier, resource: rec.resource });
  if (t.error) return out(400, page('Not connected', '<p>' + esc(t.error) + '</p>', false));
  const oauth = { access: t.access, refresh: t.refresh, exp: t.exp, client: rec.client, as: rec.as, resource: rec.resource, since: Date.now() };
  const ctxU = store.ctxFor(rec.uid);
  const r = await deps.finish(ctxU, rec.plugin, oauth);
  if (!r || r.error || !r.plugin) return out(400, page('Not connected', '<p>' + esc((r && r.error) || 'The plugin was removed while you were signing in.') + '</p>', false));
  const pl = r.plugin;
  return out(200, page(pl.name + ' connected', '<p>' + (pl.status === 'working' ? pl.tools.length + ' tools are ready for the team.' : esc(pl.error || 'Signed in; the server did not list its tools yet.')) + '</p><p>You can close this and go back to The Flow.</p>', pl.status === 'working'));
}

module.exports = { setStore, discover, begin, fresh, handle, clientDoc, _internals: { http, wellKnown, clientFor, tokenCall, ST, TTL } };
