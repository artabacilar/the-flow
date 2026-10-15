/* Connections — Google first.
 *
 * Two halves. The first runs against a real server: who may start, who may
 * finish, and what a state is good for. The second drives the module
 * directly with Google's two endpoints replaced, because the real ones need a
 * real Google account in a real browser, which in practice means the part
 * most worth testing — what is believed out of an ID token — would not be
 * tested at all.
 *
 * The question running through both: can a connection ever land on an
 * account that did not ask for it, and can anything from it reach a place it
 * is handed out from.
 */
const keepCookies = require('./cookie-jar.js');
const http = require('http');
const path = require('path');
const fs = require('fs');

const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

const rq = (p, opts = {}) => new Promise((resolve) => {
  const u = new URL(H + p);
  const body = opts.body || null;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search,
    method: opts.method || 'GET', headers }, (res) => {
    let b = '';
    res.on('data', (c) => b += c);
    res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json: j, text: b, headers: res.headers }); });
  });
  r.on('error', () => resolve({ status: 0, json: null, text: '' }));
  if (body) r.write(body);
  r.end();
});

const jar = {};
async function as(who, p, opts = {}) {
  const o = Object.assign({}, opts);
  o.headers = Object.assign({}, opts.headers || {});
  if (jar[who]) o.headers.Cookie = jar[who];
  const r = await rq(p, o);
  keepCookies(jar, who, r);
  return r;
}
const signUp = (who, email) => as(who, '/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email, name: who, password: 'a properly long password', invite: 'letmein' })
});
const post = (who, p, body) => as(who, p, { method: 'POST', body: JSON.stringify(body || {}) });
const stateOf = (url) => new URL(url).searchParams.get('state');

const conn = require(path.join(__dirname, '..', 'flow-connect.js'));
const I = conn._internals;

(async () => {
  /* ================================================================ */
  console.log('\n— nothing happens without an account —');
  ok('the list needs a session', (await rq('/api/connect/list')).status === 401);
  ok('starting needs a session', (await rq('/api/connect/google/start', { method: 'POST', body: '{}' })).status === 401);
  ok('disconnecting needs a session', (await rq('/api/connect/google/disconnect', { method: 'POST', body: '{}' })).status === 401);
  ok('an unknown provider is a 404, not a crash',
     (await signUp('ana', 'artur.abacilar@abko.com.tr')).status === 200 &&
     (await post('ana', '/api/connect/nosuch/start', {})).status === 404);

  console.log('\n— what is on offer —');
  const L = await as('ana', '/api/connect/list');
  const g = (L.json && L.json.connections || []).find((c) => c.id === 'google');
  ok('Google is listed', !!g, L.json);
  ok('and configured, because this server has the credentials', g && g.configured === true, g);
  ok('and not connected yet', g && g.connected === false && g.photo === null, g);

  console.log('\n— starting —');
  const S = await post('ana', '/api/connect/google/start', {});
  const url = S.json && S.json.url ? new URL(S.json.url) : null;
  ok('answers with a URL rather than redirecting (the apps open it in a browser)', S.status === 200 && !!url, S.json);
  ok('to Google', url && url.origin === 'https://accounts.google.com');
  ok('for this server\'s client', url && url.searchParams.get('client_id') === 'test-client.apps.googleusercontent.com');
  ok('asking for name, email and photo — and nothing else', url && url.searchParams.get('scope') === 'openid email profile');
  ok('coming back to /api/connect/google/callback', url && /\/api\/connect\/google\/callback$/.test(url.searchParams.get('redirect_uri') || ''));
  ok('with PKCE', url && url.searchParams.get('code_challenge_method') === 'S256' && (url.searchParams.get('code_challenge') || '').length >= 43);
  ok('with a nonce and a state of 128 bits or more',
     url && (url.searchParams.get('nonce') || '').length >= 20 && (url.searchParams.get('state') || '').length >= 20);
  ok('letting somebody choose between their Google accounts', url && url.searchParams.get('prompt') === 'select_account');

  console.log('\n— a browser round trip must come back to whoever started it —');
  const st1 = stateOf(S.json.url);
  const noSess = await rq('/api/connect/google/callback?state=' + st1 + '&code=x');
  ok('no session → refused, and sent home rather than shown an error page',
     noSess.status === 302 && /connect=google:mismatch/.test(noSess.headers.location || ''), noSess.headers.location);
  const again = await as('ana', '/api/connect/google/callback?state=' + st1 + '&code=x');
  ok('the state is spent by that first sight — reusing it is "expired"',
     again.status === 302 && /connect=google:expired/.test(again.headers.location || ''), again.headers.location);

  await signUp('bea', 'bea@example.com');
  const S2 = await post('ana', '/api/connect/google/start', {});
  const other = await as('bea', '/api/connect/google/callback?state=' + stateOf(S2.json.url) + '&code=x');
  ok('somebody else\'s session cannot finish it', other.status === 302 && /mismatch/.test(other.headers.location || ''), other.headers.location);

  const made = await as('ana', '/api/connect/google/callback?state=madeup&code=x');
  ok('a made-up state is "expired", not an error', made.status === 302 && /expired/.test(made.headers.location || ''));

  console.log('\n— an app round trip finishes in a browser that is not signed in —');
  const A = await post('ana', '/api/connect/google/start', { app: true });
  const denied = await rq('/api/connect/google/callback?state=' + stateOf(A.json.url) + '&error=access_denied');
  ok('it gets a page, not a redirect into a sign-in screen', denied.status === 400 && /text\/html/.test(denied.headers['content-type'] || ''), denied.status);
  ok('the page says nothing was connected', /Not connected/.test(denied.text) && /Permission was not given/.test(denied.text));
  ok('and nothing was', !(await as('ana', '/api/connect/list')).json.connections.find((c) => c.id === 'google').connected);
  const A2 = await post('ana', '/api/connect/google/start', { app: true });
  const wrongWho = await as('bea', '/api/connect/google/callback?state=' + stateOf(A2.json.url) + '&code=x');
  ok('but a browser signed in as somebody else still cannot finish an app round trip',
     wrongWho.status === 400 && /different Flow account/.test(wrongWho.text));

  /* ================================================================ */
  console.log('\n— the token, believed only as far as it should be (module, Google replaced) —');
  const raw = new Map();
  const store = { get: async (k) => raw.has(k) ? raw.get(k) : null, set: async (k, v) => { raw.set(k, v); } };
  const send = () => { const r = { status: 0, headers: {}, body: '' };
    r.writeHead = (s, h) => { r.status = s; Object.assign(r.headers, h || {}); }; r.end = (b) => { r.body = String(b || ''); }; return r; };
  const json = (res, s, obj) => { res.status = s; res.body = JSON.stringify(obj); };
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = (claims) => b64u({ alg: 'RS256' }) + '.' + b64u(claims) + '.sig';

  async function round(claimsFor, opts) {
    opts = opts || {};
    const me = { id: 'u1', email: 'a@x' };
    const startRes = send();
    const startReq = { method: 'POST', headers: { host: 'theflow.today', 'x-forwarded-proto': 'https' } };
    await conn.handle(startReq, startRes, { path: '/api/connect/google/start', query: new URLSearchParams(), me, raw: store, json,
      readBody: async () => JSON.stringify({ app: true }) });
    const st = new URL(JSON.parse(startRes.body).url).searchParams;
    const rec = JSON.parse(raw.get(I.ST(st.get('state'))));
    const seen = [];
    const fakeFetch = async (u, init) => {
      seen.push({ u: String(u), init });
      if (String(u) === 'https://oauth2.googleapis.com/token') {
        return { ok: true, status: 200, json: async () => ({ id_token: jwt(claimsFor(rec, st)) }) };
      }
      const big = opts.bigPhoto ? Buffer.alloc(300 * 1024) : PNG;
      return { ok: true, status: 200, headers: { get: () => opts.photoType || 'image/png' }, arrayBuffer: async () => big };
    };
    const cbRes = send();
    await conn.handle({ method: 'GET', headers: {} }, cbRes, {
      path: '/api/connect/google/callback',
      query: new URLSearchParams({ state: st.get('state'), code: 'the-code' }),
      me: null, raw: store, json, fetch: fakeFetch });
    return { cbRes, seen, rec, saved: raw.get(I.KEY('u1', 'google')) };
  }
  const good = (rec, st) => ({ iss: 'https://accounts.google.com', aud: 'test-client.apps.googleusercontent.com',
    exp: Math.floor(Date.now() / 1000) + 600, nonce: rec.nonce, sub: '1077', email: 'artur@gmail.com',
    email_verified: true, name: 'Artur', picture: 'https://lh3.googleusercontent.com/a/abc=s96-c' });

  const r1 = await round(good);
  const saved1 = r1.saved ? JSON.parse(r1.saved) : null;
  ok('a good token, with no session, from an app state: connected', r1.cbRes.status === 200 && /Google connected/.test(r1.cbRes.body), r1.cbRes.status);
  ok('to the account that started it', saved1 && saved1.email === 'artur@gmail.com' && saved1.name === 'Artur');
  const tokCall = r1.seen.find((s) => s.u === 'https://oauth2.googleapis.com/token');
  const form = tokCall ? new URLSearchParams(tokCall.init.body) : new URLSearchParams();
  ok('the exchange sends the PKCE verifier and the same redirect it started with',
     form.get('code_verifier') === r1.rec.verifier && form.get('redirect_uri') === r1.rec.redirect && form.get('code') === 'the-code');
  ok('the photo is fetched at 128px, once, and kept as a data URL',
     r1.seen.some((s) => s.u === 'https://lh3.googleusercontent.com/a/abc=s128-c') && /^data:image\/png;base64,/.test(saved1.photo || ''));
  ok('no Google token is kept', saved1 && !('access' in saved1) && !('id_token' in saved1) && !/eyJ/.test(r1.saved));
  ok('and it is kept outside the data namespace, where /api/all cannot hand it out',
     I.KEY('u1', 'google').indexOf('ld_') !== 0 && !/^ld_/.test(I.KEY('u1', 'google')));

  const bad = async (name, mut, opts) => {
    raw.delete(I.KEY('u1', 'google'));
    const r = await round((rec, st) => Object.assign(good(rec, st), mut(rec)), opts);
    ok(name, r.cbRes.status === 400 && !r.saved, { status: r.cbRes.status, saved: !!r.saved });
  };
  await bad('a token for another app is refused', () => ({ aud: 'someone-else.apps.googleusercontent.com' }));
  await bad('a token from another issuer is refused', () => ({ iss: 'https://evil.example' }));
  await bad('an expired token is refused', () => ({ exp: Math.floor(Date.now() / 1000) - 3600 }));
  await bad('a token answering a different request (nonce) is refused', () => ({ nonce: 'not-ours' }));

  raw.delete(I.KEY('u1', 'google'));
  const r2 = await round((rec, st) => Object.assign(good(rec, st), { picture: 'https://169.254.169.254/latest/meta-data' }));
  ok('a photo URL that is not Google\'s image host is never fetched',
     !r2.seen.some((s) => /169\.254/.test(s.u)) && r2.saved && JSON.parse(r2.saved).photo === null);
  raw.delete(I.KEY('u1', 'google'));
  const r3 = await round(good, { bigPhoto: true });
  ok('an oversized photo is dropped, not stored', r3.saved && JSON.parse(r3.saved).photo === null);
  raw.delete(I.KEY('u1', 'google'));
  const r4 = await round(good, { photoType: 'text/html' });
  ok('a "photo" that is not an image is dropped', r4.saved && JSON.parse(r4.saved).photo === null);
  raw.delete(I.KEY('u1', 'google'));
  const r5 = await round((rec, st) => Object.assign(good(rec, st), { email_verified: false }));
  ok('an unverified address is not shown as theirs', r5.saved && JSON.parse(r5.saved).email === '');

  console.log('\n— the list, disconnecting, and deleting the account —');
  await round(good);
  const lres = send();
  await conn.handle({ method: 'GET', headers: {} }, lres, { path: '/api/connect/list', query: new URLSearchParams(), me: { id: 'u1' }, raw: store, json });
  const lg = JSON.parse(lres.body).connections.find((c) => c.id === 'google');
  ok('the list shows it connected, with the photo', lg.connected && /^data:image\/png/.test(lg.photo || '') && lg.email === 'artur@gmail.com');
  const dres = send();
  await conn.handle({ method: 'POST', headers: {} }, dres, { path: '/api/connect/google/disconnect', query: new URLSearchParams(), me: { id: 'u1' }, raw: store, json });
  ok('disconnecting removes it', dres.status === 200 && !raw.get(I.KEY('u1', 'google')));
  await round(good);
  ok('deleting the account removes it (purgeUser)', (await conn.purgeUser(store, 'u1')) === 1 && !raw.get(I.KEY('u1', 'google')));

  /* ================================================================ */
  console.log('\n— the wiring —');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'flow-auth.js'), 'utf8');
  const iConn = auth.indexOf("p.indexOf('/api/connect/') === 0");
  const iGate = auth.indexOf('---- everything else under /api needs a session ----');
  ok('the routes are mounted before the session check (the app callback has none)', iConn > 0 && iGate > 0 && iConn < iGate);
  ok('account deletion purges connections', /connect\.purgeUser\(raw, uid\)/.test(auth));
  ok('and WHOOP\'s refresh token, which it used to leave behind', /raw\.set\('whoop:tok:' \+ uid, ''\)/.test(auth));

  const pack = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
  const tap = pack.slice(pack.indexOf("const on = ev.target.closest('[data-conn-on]')"), pack.indexOf("if (off) {", pack.indexOf("const on = ev.target.closest('[data-conn-on]')")));
  const inAppBranch = tap.slice(tap.indexOf('if (Connect.inApp())'), tap.indexOf("window.open(ready.url, '_blank')"));
  ok('in the apps, the tap opens a URL prepared beforehand — no await between the tap and window.open',
     tap.indexOf("window.open(ready.url, '_blank')") > 0 && !/await/.test(inAppBranch.slice(inAppBranch.indexOf('delete Connect.ready'))));
  ok('a prepared URL is used once', /delete Connect\.ready\[id\];\s*\/\* a state is good once \*\/\s*window\.open/.test(tap));
  ok('the photo replaces the avatar letter and the sidebar icon', /fn-avatar/.test(pack) && /data-fn-side="artur"/.test(pack) && /img\.className = 'fn-face fn-i'/.test(pack));
  ok('relabelling after sign-in does not wipe the photo', /if \(av && !av\.classList\.contains\('has-face'\)\) av\.textContent = Nav\.initial\(\)/.test(pack));
  ok('coming back to the app re-reads the list', /visibilitychange[\s\S]{0,200}document\.visibilityState !== 'visible'/.test(pack));
  const server = fs.readFileSync(path.join(__dirname, '..', 'life-os-server.js'), 'utf8');
  ok('the privacy policy says what a Google connection stores, and that it reads no mail',
     /Connecting Google stores the\s+name, email address and profile photo/.test(server) && /cannot read, your mail/.test(server));

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
