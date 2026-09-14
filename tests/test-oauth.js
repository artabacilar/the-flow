/* OAuth for the MCP endpoint.
 *
 * The thing worth defending here is not that the happy path works — it is that
 * every shortcut around it is closed. A code that can be spent twice, a
 * redirect that was never registered, a PKCE check that can be skipped, a
 * refresh token that survives being used: each one of those is somebody else's
 * Flow, handed over by a server that thought it was being helpful. */
const keepCookies = require('./cookie-jar.js');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const O = require(path.join(__dirname, '..', 'flow-oauth.js'));
const { redirectOk, originOf } = O._internals;

const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 200) : ''))); };

console.log('\n— which addresses a token may be sent to —');
ok('https is fine', redirectOk('https://claude.ai/api/mcp/auth_callback'));
ok('a private-use scheme is fine, which is how native apps come back',
   redirectOk('com.anthropic.claude://oauth/callback'));
ok('loopback on any port, because native clients pick one at runtime',
   redirectOk('http://127.0.0.1:51793/callback'));
ok('localhost too', redirectOk('http://localhost:8080/cb'));
ok('plain http on a public host is refused — that is a token in clear text',
   !redirectOk('http://evil.example.com/cb'));
ok('a fragment is refused', !redirectOk('https://ok.example.com/cb#x'));
ok('nonsense is refused', !redirectOk('not a url'));
ok('an empty one is refused', !redirectOk(''));

console.log('\n— the issuer it advertises —');
const fakeReq = (h) => ({ headers: h || {}, socket: {} });
ok('it trusts the forwarded protocol, or https would be advertised as http',
   originOf(fakeReq({ 'x-forwarded-proto': 'https', host: 'a.onrender.com' })) === 'https://a.onrender.com',
   originOf(fakeReq({ 'x-forwarded-proto': 'https', host: 'a.onrender.com' })));
ok('a forwarded host wins over the socket host',
   originOf(fakeReq({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'flow.app', host: 'internal:10000' })) === 'https://flow.app');
ok('a list of proxies takes the first',
   originOf(fakeReq({ 'x-forwarded-proto': 'https,http', host: 'a.b' })) === 'https://a.b');

/* ---------- over the wire ------------------------------------------------ */

const rq = (p, opts = {}) => new Promise((resolve) => {
  const u = new URL(H + p);
  const body = opts.body || null;
  const headers = Object.assign({}, opts.headers || {});
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search,
    method: opts.method || 'GET', headers }, (res) => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      let j = null; try { j = JSON.parse(b); } catch (e) {}
      resolve({ status: res.statusCode, json: j, text: b, headers: res.headers });
    });
  });
  r.on('error', () => resolve({ status: 0, json: null, text: '' }));
  if (body) r.write(body);
  r.end();
});
const jar = {};
async function as(who, p, opts = {}) {
  const o = Object.assign({}, opts);
  o.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (jar[who]) o.headers.Cookie = jar[who];
  const r = await rq(p, o);
  keepCookies(jar, who, r);
  return r;
}
const form = (o) => new URLSearchParams(o).toString();
const post = (p, o, headers) => rq(p, { method: 'POST', body: form(o),
  headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}) });

const verifier = 'a-verifier-long-enough-to-be-worth-something-43chars';
const challenge = Buffer.from(crypto.createHash('sha256').update(verifier).digest()).toString('base64url');

(async () => {
  console.log('\n— a client can find its way in —');
  let r = await rq('/.well-known/oauth-protected-resource');
  ok('the resource says who guards it', r.status === 200 && /\/mcp$/.test(r.json.resource), r.json);
  ok('and names an authorization server', Array.isArray(r.json.authorization_servers) && r.json.authorization_servers.length === 1);
  r = await rq('/.well-known/oauth-authorization-server');
  const meta = r.json;
  ok('the server describes itself', r.status === 200 && !!meta.issuer, meta);
  ok('it offers the authorization code grant', meta.grant_types_supported.indexOf('authorization_code') >= 0);
  ok('and refresh', meta.grant_types_supported.indexOf('refresh_token') >= 0);
  ok('S256 is the only challenge method offered',
     JSON.stringify(meta.code_challenge_methods_supported) === '["S256"]', meta.code_challenge_methods_supported);
  ok('it does not pretend a public client can hold a secret',
     JSON.stringify(meta.token_endpoint_auth_methods_supported) === '["none"]', meta.token_endpoint_auth_methods_supported);
  ok('every endpoint it advertises is on its own issuer',
     [meta.authorization_endpoint, meta.token_endpoint, meta.registration_endpoint]
       .every(x => x.indexOf(meta.issuer) === 0), meta);
  ok('discovery needs no credential at all', !r.headers['www-authenticate']);

  console.log('\n— and introduce itself —');
  r = await rq('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) });
  ok('registration works', r.status === 201 && /^flowc_/.test(r.json.client_id), r.json);
  const CLIENT = r.json.client_id;
  ok('it is told no secret is expected', r.json.token_endpoint_auth_method === 'none');
  r = await rq('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Bad', redirect_uris: ['http://evil.example.com/cb'] }) });
  ok('a client cannot register a cleartext redirect', r.status === 400, r.json);
  r = await rq('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Bad' }) });
  ok('nor none at all', r.status === 400);

  console.log('\n— the person has to be there, and has to say yes —');
  const authQ = (over) => '/oauth/authorize?' + new URLSearchParams(Object.assign({
    response_type: 'code', client_id: CLIENT, redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'flow.read flow.write'
  }, over || {})).toString();

  r = await rq(authQ());
  ok('a stranger is sent to sign in, not shown a consent screen', r.status === 302 && /next=/.test(r.headers.location || ''), r.headers.location);

  await as('artur', '/api/auth/signup', { method: 'POST',
    body: JSON.stringify({ email: 'artur.abacilar@abko.com.tr', name: 'Artur', password: 'a properly long password', invite: 'letmein' }) });

  r = await as('artur', authQ());
  ok('a signed-in person gets a consent screen', r.status === 200 && /Connect Claude\?/.test(r.text), r.status);
  ok('it says what will be read', /Read your week/.test(r.text));
  ok('it says what will be changed', /Add and change Big Rocks/.test(r.text));
  ok('and is honest that nothing can be deleted', /nothing it can do removes/i.test(r.text));
  ok('it names the account, so nobody connects the wrong one', /artur\.abacilar@abko\.com\.tr/.test(r.text));

  console.log('\n— the shortcuts are closed —');
  r = await as('artur', authQ({ code_challenge: '', code_challenge_method: '' }));
  ok('no PKCE, no authorization', /error=invalid_request/.test(r.headers.location || ''), r.headers.location);
  r = await as('artur', authQ({ code_challenge_method: 'plain' }));
  ok('and plain is not accepted as a downgrade', /error=invalid_request/.test(r.headers.location || ''));
  r = await as('artur', authQ({ redirect_uri: 'https://evil.example.com/cb' }));
  ok('an unregistered redirect is refused on a page, never redirected to',
     r.status === 400 && !r.headers.location, { s: r.status, l: r.headers.location });
  r = await as('artur', authQ({ client_id: 'flowc_madeup' }));
  ok('an unknown client is refused the same way', r.status === 400 && !r.headers.location);
  r = await as('artur', authQ({ response_type: 'token' }));
  ok('the implicit grant is not on offer', /error=unsupported_response_type/.test(r.headers.location || ''));

  console.log('\n— saying no means no —');
  r = await as('artur', authQ(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ decision: 'deny' }) });
  ok('denying comes back as access_denied', /error=access_denied/.test(r.headers.location || ''), r.headers.location);
  ok('and carries the state, so the client knows which attempt it was', /state=xyz/.test(r.headers.location || ''));

  console.log('\n— saying yes gets a code, and the code gets a token —');
  r = await as('artur', authQ(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ decision: 'allow' }) });
  const loc = new URL(r.headers.location);
  const CODE = loc.searchParams.get('code');
  ok('a code comes back', !!CODE, r.headers.location);
  ok('with the state intact', loc.searchParams.get('state') === 'xyz');
  ok('and it goes to the registered address', loc.origin + loc.pathname === 'https://claude.ai/api/mcp/auth_callback');

  r = await post('/oauth/token', { grant_type: 'authorization_code', code: CODE, code_verifier: verifier,
    client_id: CLIENT, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });
  ok('the exchange works', r.status === 200 && /^flowa_/.test(r.json.access_token || ''), r.json);
  const ACCESS = r.json.access_token, REFRESH = r.json.refresh_token;
  ok('it is a Bearer token', r.json.token_type === 'Bearer');
  ok('it expires', r.json.expires_in > 0 && r.json.expires_in <= 3600, r.json.expires_in);
  ok('and comes with a refresh token', /^flowr_/.test(REFRESH || ''));
  ok('the response is never cached', /no-store/.test(r.headers['cache-control'] || ''), r.headers['cache-control']);

  console.log('\n— a code is worth exactly one use —');
  r = await post('/oauth/token', { grant_type: 'authorization_code', code: CODE, code_verifier: verifier,
    client_id: CLIENT, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });
  ok('spending it twice fails', r.status === 400 && r.json.error === 'invalid_grant', r.json);

  const fresh = async () => {
    const a = await as('artur', authQ(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ decision: 'allow' }) });
    return new URL(a.headers.location).searchParams.get('code');
  };
  r = await post('/oauth/token', { grant_type: 'authorization_code', code: await fresh(), code_verifier: 'the-wrong-verifier-entirely-padded-to-length',
    client_id: CLIENT, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });
  ok('a stolen code without the verifier is worthless', r.status === 400 && r.json.error === 'invalid_grant', r.json);
  r = await post('/oauth/token', { grant_type: 'authorization_code', code: await fresh(), code_verifier: verifier,
    client_id: 'flowc_someoneelse', redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });
  ok('nor can another client spend it', r.status === 400 && r.json.error === 'invalid_grant');
  r = await post('/oauth/token', { grant_type: 'authorization_code', code: await fresh(), code_verifier: verifier,
    client_id: CLIENT, redirect_uri: 'https://claude.ai/elsewhere' });
  ok('nor can it be redeemed against a different redirect', r.status === 400 && r.json.error === 'invalid_grant');
  r = await post('/oauth/token', { grant_type: 'password', username: 'a', password: 'b' });
  ok('no other grant type is entertained', r.status === 400 && r.json.error === 'unsupported_grant_type', r.json);

  console.log('\n— the token actually opens the door —');
  const mcp = async (tok, method, params) => {
    const res = await rq('/mcp', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} }) });
    return res;
  };
  r = await mcp(ACCESS, 'tools/list');
  ok('an OAuth token reaches the tools', r.status === 200 && r.json.result.tools.length === 10, r.json && r.json.error);
  r = await mcp(ACCESS, 'tools/call', { name: 'get_week', arguments: {} });
  ok('and the week it reads is the right person\'s',
     r.json.result.structuredContent && /^\d{4}-W\d{2}$/.test(r.json.result.structuredContent.week), r.json);
  r = await mcp('flowa_invented', 'tools/list');
  ok('an invented one does not', r.status === 401);
  ok('and the refusal says where to get a real one',
     /resource_metadata/.test(r.headers['www-authenticate'] || ''), r.headers['www-authenticate']);
  r = await rq('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok('so does asking with nothing at all', /resource_metadata/.test(r.headers['www-authenticate'] || ''));

  console.log('\n— refreshing rotates, so a stolen refresh token is good once —');
  r = await post('/oauth/token', { grant_type: 'refresh_token', refresh_token: REFRESH, client_id: CLIENT });
  ok('a refresh gets a new pair', r.status === 200 && !!r.json.access_token && !!r.json.refresh_token, r.json);
  const ACCESS2 = r.json.access_token;
  ok('the new access token differs from the old', ACCESS2 !== ACCESS);
  r = await post('/oauth/token', { grant_type: 'refresh_token', refresh_token: REFRESH, client_id: CLIENT });
  ok('the old refresh token is dead the moment it is used', r.status === 400, r.json);
  ok('the new access token works', (await mcp(ACCESS2, 'tools/list')).status === 200);

  console.log('\n— and it can all be taken back —');
  r = await as('artur', '/api/flow/connections');
  ok('what is connected is visible', r.status === 200 && r.json.connections.length === 1, r.json);
  ok('by name, not by an id nobody recognises', r.json.connections[0].name === 'Claude', r.json.connections);
  r = await as('artur', '/api/flow/connections/revoke', { method: 'POST', body: JSON.stringify({ client_id: CLIENT }) });
  ok('disconnecting works', r.status === 200);
  ok('and the live access token stops working inside its hour',
     (await mcp(ACCESS2, 'tools/list')).status === 401);
  r = await as('artur', '/api/flow/connections');
  ok('it leaves the list', r.json.connections.length === 0, r.json);
  r = await post('/oauth/revoke', { token: 'flowa_nothing' });
  ok('revoking something that never existed still answers 200, so it tells a stranger nothing',
     r.status === 200, r.status);

  console.log('\n— and the panel says so in two lists, not one —');
  const fs = require('fs');
  const pack = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
  ok('connected apps have their own list', /id="mcpConns"/.test(pack));
  ok('so do access tokens', /Access tokens<\/div>/.test(pack));
  ok('the instructions lead with signing in, not with copying a token',
     /add a custom connector and give it the server URL/.test(pack));
  ok('and say a token is the fallback, not the route', /manual way in/.test(pack));
  ok('an app can be disconnected from there', /data-mcp="disconnect"/.test(pack));

  console.log('\n— none of this is reachable without being signed in —');
  r = await rq('/api/flow/connections');
  ok('the connection list needs a session', r.status === 401);
  r = await rq('/api/flow/connections/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok('so does disconnecting', r.status === 401);

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n✗ the suite itself fell over:', e); process.exit(1); });
