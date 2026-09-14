/* =========================================================================
 * The Flow — OAuth 2.1 for the MCP endpoint
 *
 * A pasted token works, but only for somebody willing to paste a token. This
 * is what turns that into a Connect button: the client discovers where to ask,
 * registers itself, sends the person here to say yes, and gets back a
 * credential scoped to that one account. It is what ChatGPT requires before it
 * will talk to a custom connector at all, and what makes Claude's own setup a
 * click rather than an errand.
 *
 * The shape is OAuth 2.1 as the MCP specification asks for it:
 *
 *   /.well-known/oauth-protected-resource   where the resource says who guards it
 *   /.well-known/oauth-authorization-server  what the guard supports
 *   /oauth/register                          a client introduces itself (RFC 7591)
 *   /oauth/authorize                         the person says yes, in their browser
 *   /oauth/token                             the code becomes a token
 *   /oauth/revoke                            and can be handed back
 *
 * Three rules this file does not bend.
 *
 * PKCE is required, not offered. Every authorization carries a code challenge
 * and every exchange proves the verifier. An authorization code intercepted in
 * transit is then worth nothing on its own, which is the entire point.
 *
 * Nothing readable is stored. Codes, access tokens and refresh tokens are kept
 * as SHA-256 of themselves, exactly as the personal tokens are. A dump of this
 * store is not a set of keys.
 *
 * Consent is a person, in a browser, signed in. There is no path here that
 * issues a token to somebody who has not seen a screen saying what they are
 * about to hand over, and no way for a token to mint another token.
 * ====================================================================== */

const crypto = require('crypto');

const CODE_TTL = 60 * 1000;                 /* one minute: long enough to redirect */
const ACCESS_TTL = 60 * 60 * 1000;          /* an hour */
const REFRESH_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 500;

const K_CLIENT = (id) => '__oauth:client:' + id;
const K_CODE = (h) => '__oauth:code:' + h;
const K_TOKEN = (h) => '__oauth:tok:' + h;
const K_REFRESH = (h) => '__oauth:ref:' + h;
const K_GRANTS = (uid) => '__oauth:grants:' + uid;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const b64url = (b) => Buffer.from(b).toString('base64url');
const rand = (n) => crypto.randomBytes(n || 32).toString('base64url');

/* The public origin. Behind Render's proxy the socket says http, so the
   forwarded header is the only honest answer — and an https issuer that
   advertises http endpoints is one a strict client will refuse outright.

   PUBLIC_URL is checked first on purpose. Render sets RENDER_EXTERNAL_URL to
   the onrender.com name it gave the service, and keeps setting it after a
   custom domain is added — so with the old order, a client arriving at the
   real domain was handed discovery documents issued by a different host. That
   is not a cosmetic mismatch: a strict OAuth client compares the issuer it
   asked for against the one it got back, and refuses. PUBLIC_URL is the
   operator saying which name is the real one, so it wins. */
function originOf(req) {
  const envUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';
  if (envUrl) return envUrl.replace(/\/+$/, '');
  const h = req.headers || {};
  const proto = (h['x-forwarded-proto'] || '').split(',')[0].trim() ||
                (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = (h['x-forwarded-host'] || h.host || 'localhost').split(',')[0].trim();
  return proto + '://' + host;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* A redirect_uri is the one field an attacker most wants to bend, because a
   registered client plus somebody else's redirect is a token delivered to the
   wrong door. Loopback is allowed on any port because native clients pick one
   at runtime; everything else must be https and must match exactly. */
function redirectOk(uri) {
  let u;
  try { u = new URL(String(uri)); } catch (e) { return false; }
  if (u.hash) return false;
  const host = u.hostname;
  if (host === '127.0.0.1' || host === '::1' || host === 'localhost') return u.protocol === 'http:' || u.protocol === 'https:';
  /* Claude, ChatGPT and the desktop clients all register a custom scheme or an
     https callback. A bare http one on a public host is a token in clear text. */
  if (u.protocol === 'https:') return true;
  if (/^[a-z][a-z0-9+.-]*:$/i.test(u.protocol) && u.protocol !== 'http:') return true;
  return false;
}

function build(deps) {
  const { raw, getJSON, setJSON, currentUser, json, readBody, USERS_KEY } = deps;

  /* ---- discovery ------------------------------------------------------- */

  function protectedResource(req) {
    const o = originOf(req);
    return {
      resource: o + '/mcp',
      authorization_servers: [o],
      bearer_methods_supported: ['header'],
      scopes_supported: ['flow.read', 'flow.write'],
      resource_name: 'The Flow',
      resource_documentation: o + '/'
    };
  }

  function authServerMeta(req) {
    const o = originOf(req);
    return {
      issuer: o,
      authorization_endpoint: o + '/oauth/authorize',
      token_endpoint: o + '/oauth/token',
      registration_endpoint: o + '/oauth/register',
      revocation_endpoint: o + '/oauth/revoke',
      scopes_supported: ['flow.read', 'flow.write'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      /* Public clients only. A secret shipped inside a desktop app or a browser
         is not a secret, so this server does not pretend one is. */
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      service_documentation: o + '/'
    };
  }

  /* ---- dynamic client registration (RFC 7591) --------------------------- */

  async function register(req, res) {
    const body = safeJSON(await readBody(req));
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (!uris.length) return oerr(res, 400, 'invalid_redirect_uri', 'At least one redirect_uri is required.');
    if (uris.length > 10) return oerr(res, 400, 'invalid_redirect_uri', 'That is more redirect URIs than any client needs.');
    for (const u of uris) {
      if (!redirectOk(u)) return oerr(res, 400, 'invalid_redirect_uri', 'Redirect URIs must be https, a private-use scheme, or loopback: ' + u);
    }
    const name = String(body.client_name || 'An assistant').trim().slice(0, 80) || 'An assistant';
    const id = 'flowc_' + rand(16);
    await setJSON(K_CLIENT(id), {
      client_id: id,
      client_name: name,
      redirect_uris: uris,
      created: Date.now(),
      client_uri: String(body.client_uri || '').slice(0, 300)
    });
    res.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      client_id: id,
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(Date.now() / 1000)
    }));
  }

  /* ---- authorize -------------------------------------------------------- */

  /* Errors before the redirect_uri is trusted must be shown, not redirected:
     bouncing an error to an unvalidated URI is itself the open redirect. */
  async function authorize(req, res, u) {
    const q = u.searchParams;
    const clientId = q.get('client_id') || '';
    const redirect = q.get('redirect_uri') || '';
    const state = q.get('state') || '';
    const challenge = q.get('code_challenge') || '';
    const method = q.get('code_challenge_method') || '';
    const scope = q.get('scope') || 'flow.read flow.write';
    const resource = q.get('resource') || '';

    const client = clientId ? await getJSON(K_CLIENT(clientId), null) : null;
    if (!client) return page(res, 400, 'That app is not registered', 'The client_id in this link is not one this server knows about. Ask the app to connect again from the start.');
    if (!redirect || client.redirect_uris.indexOf(redirect) < 0) {
      return page(res, 400, 'That redirect address is not registered',
        'For safety this server only ever sends you back to an address the app registered up front, and this is not one of them.');
    }

    const back = (params) => {
      const r = new URL(redirect);
      Object.keys(params).forEach(k => r.searchParams.set(k, params[k]));
      if (state) r.searchParams.set('state', state);
      res.writeHead(302, { Location: r.toString(), 'Cache-Control': 'no-store' });
      res.end();
    };

    if ((q.get('response_type') || '') !== 'code') return back({ error: 'unsupported_response_type' });
    /* No PKCE, no authorization. Not negotiable, and not silently downgraded. */
    if (!challenge || method !== 'S256') {
      return back({ error: 'invalid_request', error_description: 'This server requires PKCE with S256.' });
    }

    const me = await currentUser(req);
    if (!me) {
      /* Send them to sign in, and bring them straight back here afterwards. */
      const next = encodeURIComponent(u.pathname + u.search);
      res.writeHead(302, { Location: '/?next=' + next + '#connect', 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      if (form.get('decision') !== 'allow') return back({ error: 'access_denied' });
      const code = rand(32);
      await setJSON(K_CODE(sha(code)), {
        uid: me.id, client_id: clientId, redirect_uri: redirect,
        challenge, scope, resource, expires: Date.now() + CODE_TTL
      });
      return back({ code });
    }

    return consentPage(res, { client, me, scope });
  }

  function consentPage(res, { client, me, scope }) {
    const writes = /flow\.write/.test(scope);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect ${esc(client.client_name)} — The Flow</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
 background:#0b0e13;color:#e9eef5;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.card{width:100%;max-width:460px;background:#131922;border:1px solid rgba(255,255,255,.10);
 border-radius:18px;padding:30px 28px}
h1{font-size:21px;margin:0 0 6px;letter-spacing:-.01em}
.sub{color:#93a2b4;font-size:14px;margin:0 0 22px}
.who{display:flex;gap:10px;align-items:center;font-size:13px;color:#93a2b4;
 border-top:1px solid rgba(255,255,255,.08);padding-top:16px;margin-top:22px}
ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:11px}
li{display:flex;gap:11px;align-items:flex-start;font-size:14px}
.i{flex:none;width:20px;text-align:center;line-height:1.5}
.no{color:#93a2b4}
.acts{display:flex;gap:10px;margin-top:26px}
button{flex:1;font:600 15px/1 inherit;padding:13px;border-radius:11px;cursor:pointer;border:1px solid transparent}
.allow{background:#17bb92;color:#04130e}
.deny{background:transparent;color:#93a2b4;border-color:rgba(255,255,255,.14)}
.allow:hover{filter:brightness(1.07)} .deny:hover{color:#e9eef5}
.warn{margin-top:18px;font-size:12.5px;color:#93a2b4;line-height:1.55}
</style></head><body>
<form class="card" method="POST">
  <h1>Connect ${esc(client.client_name)}?</h1>
  <p class="sub">It is asking to reach your Flow.</p>
  <ul>
    <li><span class="i">📖</span><span>Read your week, today, your habits and your scoreboard</span></li>
    ${writes ? '<li><span class="i">✍️</span><span>Add and change Big Rocks, tick habits, and reword your own lists</span></li>' : ''}
    <li><span class="i no">🚫</span><span class="no">Delete anything — nothing it can do removes a rock, a habit or an entry</span></li>
    <li><span class="i no">🚫</span><span class="no">See any account but yours</span></li>
  </ul>
  <div class="acts">
    <button class="deny" name="decision" value="deny" type="submit">Cancel</button>
    <button class="allow" name="decision" value="allow" type="submit">Connect</button>
  </div>
  <div class="who">Signed in as ${esc(me.email)}</div>
  <p class="warn">You can disconnect this at any time in Settings → Connect to Claude. Doing so stops it working immediately and changes nothing you have saved.</p>
</form></body></html>`);
  }

  /* ---- token ------------------------------------------------------------ */

  async function token(req, res) {
    const form = new URLSearchParams(await readBody(req));
    const grant = form.get('grant_type') || '';

    if (grant === 'authorization_code') {
      const code = form.get('code') || '';
      const verifier = form.get('code_verifier') || '';
      const clientId = form.get('client_id') || '';
      const redirect = form.get('redirect_uri') || '';
      if (!code || !verifier) return oerr(res, 400, 'invalid_request', 'code and code_verifier are both required.');

      const h = sha(code);
      const rec = await getJSON(K_CODE(h), null);
      /* Single use, always: a code that can be spent twice is a code worth
         stealing. It is burned before anything else is checked. */
      await raw.set(K_CODE(h), '');
      if (!rec) return oerr(res, 400, 'invalid_grant', 'That code is not valid, or it has already been used.');
      if (Date.now() > rec.expires) return oerr(res, 400, 'invalid_grant', 'That code has expired. Start the connection again.');
      if (rec.client_id !== clientId) return oerr(res, 400, 'invalid_grant', 'That code was issued to a different app.');
      if (rec.redirect_uri !== redirect) return oerr(res, 400, 'invalid_grant', 'The redirect address does not match the one the code was issued for.');
      if (b64url(crypto.createHash('sha256').update(verifier).digest()) !== rec.challenge) {
        return oerr(res, 400, 'invalid_grant', 'The PKCE verifier does not match.');
      }
      return issue(res, rec.uid, rec.client_id, rec.scope);
    }

    if (grant === 'refresh_token') {
      const rt = form.get('refresh_token') || '';
      const h = sha(rt);
      const rec = await getJSON(K_REFRESH(h), null);
      if (!rec || Date.now() > rec.expires) return oerr(res, 400, 'invalid_grant', 'That refresh token is not valid any more.');
      /* Rotated on every use, so a stolen refresh token is good for one turn at
         most and the theft shows up as the real client being logged out. */
      await raw.set(K_REFRESH(h), '');
      return issue(res, rec.uid, rec.client_id, rec.scope);
    }

    return oerr(res, 400, 'unsupported_grant_type', 'This server does authorization_code and refresh_token.');
  }

  async function issue(res, uid, clientId, scope) {
    const access = 'flowa_' + rand(32);
    const refresh = 'flowr_' + rand(32);
    const now = Date.now();
    await setJSON(K_TOKEN(sha(access)), { uid, client_id: clientId, scope, expires: now + ACCESS_TTL });
    await setJSON(K_REFRESH(sha(refresh)), { uid, client_id: clientId, scope, expires: now + REFRESH_TTL });
    /* An index per person, so Settings can show what is connected and take it
       back. Without this a grant is invisible and therefore unrevocable. */
    try {
      const g = await getJSON(K_GRANTS(uid), []);
      if (g.indexOf(clientId) < 0) { g.push(clientId); await setJSON(K_GRANTS(uid), g); }
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    res.end(JSON.stringify({
      access_token: access, token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TTL / 1000),
      refresh_token: refresh, scope
    }));
  }

  async function revoke(req, res) {
    const form = new URLSearchParams(await readBody(req));
    const t = form.get('token') || '';
    /* RFC 7009: always 200, whether or not it was a real token. Saying "that
       was not valid" tells a stranger which of their guesses was closer. */
    if (t) { await raw.set(K_TOKEN(sha(t)), ''); await raw.set(K_REFRESH(sha(t)), ''); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end('{}');
  }

  /* ---- what the MCP endpoint calls -------------------------------------- */

  /* Resolve an OAuth access token to an account, or null. Expiry is enforced
     here rather than trusted from the token, because the token says nothing —
     it is an opaque string and every fact about it lives in the store. */
  async function userForAccessToken(tok) {
    const t = String(tok || '');
    if (t.indexOf('flowa_') !== 0) return null;
    const rec = await getJSON(K_TOKEN(sha(t)), null);
    if (!rec || !rec.uid) return null;
    if (Date.now() > rec.expires) { await raw.set(K_TOKEN(sha(t)), ''); return null; }
    const users = await getJSON(USERS_KEY, {});
    const u = Object.values(users).find(x => x.id === rec.uid);
    if (!u) return null;
    return { id: u.id, email: u.email, name: u.name, client_id: rec.client_id, scope: rec.scope };
  }

  async function listGrants(uid) {
    const ids = await getJSON(K_GRANTS(uid), []);
    const out = [];
    for (const id of ids) {
      const c = await getJSON(K_CLIENT(id), null);
      if (c) out.push({ client_id: id, name: c.client_name, connected: c.created });
    }
    return out;
  }

  /* Disconnecting has to reach the tokens themselves, not just the index —
     an entry removed from a list while the credential still works is a lie
     told to somebody who thinks they have revoked access. */
  async function revokeGrant(uid, clientId) {
    const g = await getJSON(K_GRANTS(uid), []);
    await setJSON(K_GRANTS(uid), g.filter(x => x !== clientId));
    await setJSON('__oauth:dead:' + uid + ':' + clientId, { at: Date.now() });
    return true;
  }
  async function grantIsDead(uid, clientId) {
    if (!clientId) return false;
    const d = await getJSON('__oauth:dead:' + uid + ':' + clientId, null);
    return !!d;
  }

  /* ---- routing ---------------------------------------------------------- */

  async function handle(req, res, p, u) {
    if (p === '/.well-known/oauth-protected-resource' ||
        p === '/.well-known/oauth-protected-resource/mcp') {
      return sendJSON(res, protectedResource(req));
    }
    if (p === '/.well-known/oauth-authorization-server' ||
        p === '/.well-known/openid-configuration') {
      return sendJSON(res, authServerMeta(req));
    }
    if (p === '/oauth/register' && req.method === 'POST') return register(req, res), true;
    if (p === '/oauth/authorize') return authorize(req, res, u), true;
    if (p === '/oauth/token' && req.method === 'POST') return token(req, res), true;
    if (p === '/oauth/revoke' && req.method === 'POST') return revoke(req, res), true;
    return false;
  }

  function sendJSON(res, obj) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(obj));
    return true;
  }

  return { handle, userForAccessToken, listGrants, revokeGrant, grantIsDead, originOf, redirectOk, _rand: rand };

  function oerr(res, code, err, desc) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: err, error_description: desc }));
    return true;
  }
  function page(res, code, title, body) {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e13;color:#e9eef5;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px">
<div style="max-width:420px"><h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1>
<p style="color:#93a2b4;margin:0">${esc(body)}</p></div></body>`);
    return true;
  }
  function safeJSON(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }
}

module.exports = { build, _internals: { redirectOk, originOf, sha } };
