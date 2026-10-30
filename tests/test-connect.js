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
/* The first account in a stored connection, whichever shape it was saved in. */
const first = (v) => { if (!v) return null; const o = JSON.parse(v); return Array.isArray(o.accounts) ? o.accounts[0] || null : o; };

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
  const sp = url ? url.searchParams : new URLSearchParams();
  ok('answers with a URL rather than redirecting (the apps open it in a browser)', S.status === 200 && !!url, S.json);
  ok('to Google', url && url.origin === 'https://accounts.google.com');
  ok('for this server\'s client', sp.get('client_id') === 'test-client.apps.googleusercontent.com');
  ok('asking for name, email and photo — and nothing else', sp.get('scope') === 'openid email profile');
  ok('for an ID token, posted back — so no client secret is needed anywhere',
     sp.get('response_type') === 'id_token' && sp.get('response_mode') === 'form_post');
  ok('coming back to /api/connect/google/callback', /\/api\/connect\/google\/callback$/.test(sp.get('redirect_uri') || ''));
  ok('with a nonce and a state of 128 bits or more', (sp.get('nonce') || '').length >= 20 && (sp.get('state') || '').length >= 20);
  ok('letting somebody choose between their Google accounts', sp.get('prompt') === 'select_account');

  console.log('\n— a state is good once, and only for ten minutes —');
  const st1 = stateOf(S.json.url);
  const den = await rq('/api/connect/google/callback?state=' + st1 + '&error=access_denied');
  ok('a refusal on a browser round trip goes home and says so',
     den.status === 302 && /connect=google:denied/.test(den.headers.location || ''), den.headers.location);
  const again = await rq('/api/connect/google/callback?state=' + st1 + '&error=access_denied');
  ok('the state was spent by that first sight — reusing it is "expired"',
     again.status === 302 && /connect=google:expired/.test(again.headers.location || ''), again.headers.location);
  const made = await rq('/api/connect/google/callback', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'state=madeup&id_token=x.y.z' });
  ok('a made-up state is "expired", not an error', made.status === 302 && /expired/.test(made.headers.location || ''));
  const fin = await as('ana', '/api/connect/google/finish?p=madeup');
  ok('so is a made-up finish', fin.status === 302 && /expired/.test(fin.headers.location || ''));
  const forged = await rq('/api/connect/google/callback', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'state=' + stateOf((await post('ana', '/api/connect/google/start', {})).json.url) + '&id_token=a.b.c' });
  ok('a forged token is refused before anything is stored', forged.status === 302 && /google:failed/.test(forged.headers.location || ''), forged.headers.location);

  console.log('\n— an app round trip finishes in a browser that is not signed in —');
  const A = await post('ana', '/api/connect/google/start', { app: true });
  const denied = await rq('/api/connect/google/callback?state=' + stateOf(A.json.url) + '&error=access_denied');
  ok('it gets a page, not a redirect into a sign-in screen', denied.status === 400 && /text\/html/.test(denied.headers['content-type'] || ''), denied.status);
  ok('the page says nothing was connected', /Not connected/.test(denied.text) && /Permission was not given/.test(denied.text));
  ok('and nothing was', !(await as('ana', '/api/connect/list')).json.connections.find((c) => c.id === 'google').connected);

  /* ================================================================ */
  console.log('\n— the token, believed only as far as it should be (module, Google replaced) —');
  const crypto = require('crypto');
  const KID = 'test-key-1';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: KID, alg: 'RS256', use: 'sig' });
  const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sign = (claims, o) => {
    o = o || {};
    const h = b64u(JSON.stringify({ alg: o.alg || 'RS256', kid: o.kid || KID, typ: 'JWT' }));
    const b = b64u(JSON.stringify(claims));
    const sig = o.alg === 'none' ? '' : b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + b), o.key || privateKey));
    return h + '.' + b + '.' + sig;
  };

  const raw = new Map();
  const store = { get: async (k) => raw.has(k) ? raw.get(k) : null, set: async (k, v) => { raw.set(k, v); } };
  const send = () => { const r = { status: 0, headers: {}, body: '' };
    r.writeHead = (s, h) => { r.status = s; Object.assign(r.headers, h || {}); }; r.end = (b) => { r.body = String(b || ''); }; return r; };
  const json = (res, s, obj) => { res.status = s; res.body = JSON.stringify(obj); };
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  let seen = [], photoOpts = {};
  const fakeFetch = async (u) => {
    seen.push(String(u));
    if (String(u) === 'https://www.googleapis.com/oauth2/v3/certs') {
      return { ok: true, status: 200, headers: { get: () => 'public, max-age=20000' }, json: async () => ({ keys: [jwk] }) };
    }
    const big = photoOpts.big ? Buffer.alloc(300 * 1024) : PNG;
    return { ok: true, status: 200, headers: { get: () => photoOpts.type || 'image/png' }, arrayBuffer: async () => big };
  };
  const me1 = { id: 'u1', email: 'a@x' };
  async function begin(app) {
    const r = send();
    await conn.handle({ method: 'POST', headers: { host: 'theflow.today', 'x-forwarded-proto': 'https' } }, r,
      { path: '/api/connect/google/start', query: new URLSearchParams(), me: me1, raw: store, json,
        readBody: async () => JSON.stringify({ app: !!app }) });
    const st = new URL(JSON.parse(r.body).url).searchParams;
    return { state: st.get('state'), nonce: st.get('nonce') };
  }
  async function back(state, idToken) {
    const r = send();
    await conn.handle({ method: 'POST', headers: {} }, r, {
      path: '/api/connect/google/callback', query: new URLSearchParams(), me: null, raw: store, json, fetch: fakeFetch,
      readBody: async () => new URLSearchParams({ state, id_token: idToken }).toString() });
    return r;
  }
  const good = (nonce) => ({ iss: 'https://accounts.google.com', aud: 'test-client.apps.googleusercontent.com',
    exp: Math.floor(Date.now() / 1000) + 600, nonce, sub: '1077', email: 'artur@gmail.com',
    email_verified: true, name: 'Artur', picture: 'https://lh3.googleusercontent.com/a/abc=s96-c' });
  const savedNow = () => first(raw.get(I.KEY('u1', 'google')));

  /* app round trip */
  I.resetKeys(); seen = [];
  let b0 = await begin(true);
  let r1 = await back(b0.state, sign(good(b0.nonce)));
  const saved1 = savedNow();
  ok('an app round trip with a good token, and no session: connected', r1.status === 200 && /Google connected/.test(r1.body), r1.status);
  ok('to the account that started it', saved1 && saved1.email === 'artur@gmail.com' && saved1.name === 'Artur');
  ok('the signature was checked against Google\'s published keys', seen[0] === 'https://www.googleapis.com/oauth2/v3/certs');
  ok('the photo is fetched at 128px, once, and kept as a data URL',
     seen.includes('https://lh3.googleusercontent.com/a/abc=s128-c') && /^data:image\/png;base64,/.test(saved1.photo || ''));
  ok('no token of any kind is kept', !/eyJ/.test(raw.get(I.KEY('u1', 'google'))));
  ok('and it is kept outside the data namespace, where /api/all cannot hand it out', !/^ld_/.test(I.KEY('u1', 'google')));
  seen = []; b0 = await begin(true); await back(b0.state, sign(good(b0.nonce)));
  ok('the keys are cached, not fetched on every connection', !seen.includes('https://www.googleapis.com/oauth2/v3/certs'));

  /* browser round trip */
  raw.delete(I.KEY('u1', 'google'));
  const bb = await begin(false);
  const r2 = await back(bb.state, sign(good(bb.nonce)));
  const to = (r2.body.match(/location\.replace\("([^"]+)"\)/) || [])[1] || '';
  ok('a browser round trip is parked, not attached, at the POST', r2.status === 200 && !savedNow() && /\/api\/connect\/google\/finish\?p=/.test(to), r2.body.slice(0, 200));
  const finish = async (who, path) => { const r = send();
    await conn.handle({ method: 'GET', headers: {} }, r, { path: '/api/connect/google/finish', query: new URL('http://x' + path).searchParams, me: who, raw: store, json });
    return r; };
  const f0 = await finish(null, to);
  ok('finishing without the session that started it is refused', f0.status === 302 && /mismatch/.test(f0.headers.Location) && !savedNow());
  const bb2 = await begin(false);
  const to2 = ((await back(bb2.state, sign(good(bb2.nonce)))).body.match(/location\.replace\("([^"]+)"\)/) || [])[1];
  const f1 = await finish({ id: 'someone-else' }, to2);
  ok('and so is finishing as somebody else', /mismatch/.test(f1.headers.Location) && !savedNow());
  const bb3 = await begin(false);
  const to3 = ((await back(bb3.state, sign(good(bb3.nonce)))).body.match(/location\.replace\("([^"]+)"\)/) || [])[1];
  const f2 = await finish(me1, to3);
  ok('the right session finishes it: connected', f2.status === 302 && /google:connected/.test(f2.headers.Location) && savedNow() && savedNow().email === 'artur@gmail.com');
  const f3 = await finish(me1, to3);
  ok('and a finish link is good once', /expired/.test(f3.headers.Location));

  const bad = async (name, claimsMut, signOpts) => {
    raw.delete(I.KEY('u1', 'google'));
    const b = await begin(true);
    const r = await back(b.state, sign(Object.assign(good(b.nonce), claimsMut(b)), signOpts));
    ok(name, r.status === 400 && !savedNow(), { status: r.status, saved: !!savedNow() });
  };
  await bad('a token signed by anybody but Google is refused', () => ({}), { key: other.privateKey });
  await bad('an unsigned token (alg none) is refused', () => ({}), { alg: 'none' });
  await bad('a token naming a key Google does not publish is refused', () => ({}), { kid: 'nope' });
  await bad('a token for another app is refused', () => ({ aud: 'someone-else.apps.googleusercontent.com' }));
  await bad('a token from another issuer is refused', () => ({ iss: 'https://evil.example' }));
  await bad('an expired token is refused', () => ({ exp: Math.floor(Date.now() / 1000) - 3600 }));
  await bad('a token answering a different request (nonce) is refused', () => ({ nonce: 'not-ours' }));

  const withPhoto = async (mut, opts) => {
    raw.delete(I.KEY('u1', 'google')); photoOpts = opts || {}; seen = [];
    const b = await begin(true);
    await back(b.state, sign(Object.assign(good(b.nonce), mut)));
    photoOpts = {};
    return savedNow();
  };
  let sv = await withPhoto({ picture: 'https://169.254.169.254/latest/meta-data' });
  ok('a photo URL that is not Google\'s image host is never fetched', !seen.some((u) => /169\.254/.test(u)) && sv && sv.photo === null);
  sv = await withPhoto({}, { big: true });
  ok('an oversized photo is dropped, not stored', sv && sv.photo === null);
  sv = await withPhoto({}, { type: 'text/html' });
  ok('a "photo" that is not an image is dropped', sv && sv.photo === null);
  sv = await withPhoto({ email_verified: false });
  ok('an unverified address is not shown as theirs', sv && sv.email === '');

  console.log('\n— the list, disconnecting, and deleting the account —');
  await withPhoto({});
  const lres = send();
  await conn.handle({ method: 'GET', headers: {} }, lres, { path: '/api/connect/list', query: new URLSearchParams(), me: me1, raw: store, json });
  const lg = JSON.parse(lres.body).connections.find((c) => c.id === 'google');
  ok('the list shows it connected, with the photo', lg.connected && /^data:image\/png/.test(lg.photo || '') && lg.email === 'artur@gmail.com');
  const dres = send();
  await conn.handle({ method: 'POST', headers: {} }, dres, { path: '/api/connect/google/disconnect', query: new URLSearchParams(), me: me1, raw: store, json });
  ok('disconnecting removes it', dres.status === 200 && !raw.get(I.KEY('u1', 'google')));
  await withPhoto({});
  ok('deleting the account removes it (purgeUser)', (await conn.purgeUser(store, 'u1')) === 1 && !raw.get(I.KEY('u1', 'google')));

  /* ================================================================ */
  console.log('\n— the wiring —');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'flow-auth.js'), 'utf8');
  const iConn = auth.indexOf("p.indexOf('/api/connect/') === 0");
  const iGate = auth.indexOf('---- everything else under /api needs a session ----');
  ok('the routes are mounted before the session check (the app callback has none)', iConn > 0 && iGate > 0 && iConn < iGate);
  const src = fs.readFileSync(path.join(__dirname, '..', 'flow-connect.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const gBlock = code.slice(code.indexOf('  google: {'), code.indexOf('  gcal: {'));
  ok('the profile connection still needs no client secret', gBlock.length > 100 && !/secret/i.test(gBlock));
  ok('the secret is read only from the environment, for Calendar and Gmail', (code.match(/GOOGLE_CLIENT_SECRET/g) || []).length === 2);
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
  ok('the privacy policy says what each connection keeps, and how Gmail is limited',
     /<b>Google<\/b> stores the name, email address and profile photo/.test(server) &&
     /never sends mail, never deletes or changes anything, and reads nothing else/.test(server) && /for an event brief/.test(server) && /<b>Fathom<\/b>/.test(server) && /<b>Notion<\/b>/.test(server) && /including the Limited Use requirements/.test(server) && /api-services-user-data-policy/.test(server));

  /* ================================================================ */
  console.log('\n— Google Calendar and Gmail: a token, kept and refreshed —');
  {
    const raw2 = new Map();
    const st2 = { get: async (k) => raw2.has(k) ? raw2.get(k) : null, set: async (k, v) => { raw2.set(k, v); } };
    const meX = { id: 'u9' };
    process.env.GOOGLE_CLIENT_SECRET = '';
    let lr = send();
    await conn.handle({ method: 'GET', headers: {} }, lr, { path: '/api/connect/list', query: new URLSearchParams(), me: meX, raw: st2, json });
    let lst = JSON.parse(lr.body).connections;
    ok('without a client secret, Calendar and Gmail are listed but not offered',
       lst.find((c) => c.id === 'gcal').configured === false && lst.find((c) => c.id === 'gmail').configured === false);
    ok('Fathom and Notion need nothing on the server', lst.find((c) => c.id === 'fathom').configured && lst.find((c) => c.id === 'notion').configured);
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    lr = send();
    await conn.handle({ method: 'GET', headers: {} }, lr, { path: '/api/connect/list', query: new URLSearchParams(), me: meX, raw: st2, json });
    ok('with it, they are', JSON.parse(lr.body).connections.find((c) => c.id === 'gcal').configured === true);

    const sr = send();
    await conn.handle({ method: 'POST', headers: { host: 'theflow.today', 'x-forwarded-proto': 'https' } }, sr,
      { path: '/api/connect/gcal/start', query: new URLSearchParams(), me: meX, raw: st2, json, readBody: async () => '{"app":true}' });
    const gu = new URL(JSON.parse(sr.body).url);
    ok('Calendar asks for a code, offline, read-only calendar and nothing more',
       gu.searchParams.get('response_type') === 'code' && gu.searchParams.get('access_type') === 'offline' &&
       gu.searchParams.get('scope') === 'openid email https://www.googleapis.com/auth/calendar.readonly');
    ok('and comes back through Google\'s already-registered callback',
       gu.searchParams.get('redirect_uri') === 'https://theflow.today/api/connect/google/callback');
    const gstate = gu.searchParams.get('state');

    let calls = [];
    let scopeBack = 'openid https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email';
    const idt = 'x.' + Buffer.from(JSON.stringify({ sub: '42', email: 'artur@gmail.com', email_verified: true })).toString('base64url') + '.y';
    const gFetch = async (u, o) => {
      calls.push({ u: String(u), o: o || {} });
      if (String(u) === 'https://oauth2.googleapis.com/token') {
        const b = new URLSearchParams(o.body);
        if (b.get('grant_type') === 'refresh_token') {
          return { ok: true, status: 200, json: async () => ({ access_token: 'acc-2', expires_in: 3600 }) };
        }
        return { ok: true, status: 200, json: async () => ({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600, scope: scopeBack, id_token: idt }) };
      }
      if (/calendar\/v3/.test(String(u))) {
        return { ok: true, status: 200, json: async () => ({ items: [
          { id: 'e1', summary: 'Standup', start: { dateTime: '2026-10-17T09:00:00+03:00' }, end: { dateTime: '2026-10-17T09:15:00+03:00' }, hangoutLink: 'https://meet.google.com/abc' },
          { id: 'e2', status: 'cancelled', summary: 'Gone', start: { dateTime: '2026-10-17T10:00:00+03:00' }, end: { dateTime: '2026-10-17T11:00:00+03:00' } },
          { id: 'e3', summary: 'Holiday', start: { date: '2026-10-17' }, end: { date: '2026-10-18' } }
        ] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const cb = send();
    await conn.handle({ method: 'GET', headers: {} }, cb, { path: '/api/connect/google/callback',
      query: new URLSearchParams({ state: gstate, code: 'the-code' }), me: null, raw: st2, json, fetch: gFetch, readBody: async () => '' });
    const tokCall = calls.find((c) => c.u === 'https://oauth2.googleapis.com/token');
    const tb = new URLSearchParams(tokCall ? tokCall.o.body : '');
    ok('the code is traded server-side with the secret, at the redirect it was issued for',
       tb.get('code') === 'the-code' && tb.get('client_secret') === 'test-secret' && tb.get('redirect_uri') === 'https://theflow.today/api/connect/google/callback');
    const recG = first(raw2.get(I.KEY('u9', 'gcal')));
    ok('saved under Calendar, not Google, with the account\'s address and a refresh token',
       cb.status === 200 && /Google Calendar connected/.test(cb.body) && recG && recG.email === 'artur@gmail.com' && recG.tok.refresh === 'ref-1' && !raw2.get(I.KEY('u9', 'google')));

    lr = send();
    await conn.handle({ method: 'GET', headers: {} }, lr, { path: '/api/connect/list', query: new URLSearchParams(), me: meX, raw: st2, json });
    ok('the list never carries a token or key', !/acc-1|ref-1|test-secret/.test(lr.body));

    const ev = send();
    await conn.handle({ method: 'GET', headers: {} }, ev, { path: '/api/connect/gcal/events',
      query: new URLSearchParams({ from: '2026-10-16T21:00:00.000Z', to: '2026-10-17T21:00:00.000Z' }), me: meX, raw: st2, json, fetch: gFetch });
    const evs = JSON.parse(ev.body).events || [];
    ok('today\'s events come back, cancelled ones dropped, all-day marked, the Meet link kept',
       ev.status === 200 && evs.length === 2 && evs[0].video === 'https://meet.google.com/abc' && evs[1].allDay === true, ev.body.slice(0, 200));
    const evCall = calls.find((c) => /calendar\/v3/.test(c.u));
    ok('with the access token, read-only, from the primary calendar',
       evCall && evCall.o.headers.Authorization === 'Bearer acc-1' && /calendars\/primary\/events\?/.test(evCall.u));
    const bad = send();
    await conn.handle({ method: 'GET', headers: {} }, bad, { path: '/api/connect/gcal/events',
      query: new URLSearchParams({ from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' }), me: meX, raw: st2, json, fetch: gFetch });
    ok('more than a month at once is refused', bad.status === 400);

    const r2 = JSON.parse(raw2.get(I.KEY('u9', 'gcal'))); r2.accounts[0].tok.exp = Date.now() - 1000; raw2.set(I.KEY('u9', 'gcal'), JSON.stringify(r2));
    calls = [];
    const ev2 = send();
    await conn.handle({ method: 'GET', headers: {} }, ev2, { path: '/api/connect/gcal/events',
      query: new URLSearchParams({ from: '2026-10-16T21:00:00Z', to: '2026-10-17T21:00:00Z' }), me: meX, raw: st2, json, fetch: gFetch });
    ok('an expired token is refreshed first, and the new one kept',
       ev2.status === 200 && calls[0].u === 'https://oauth2.googleapis.com/token' && first(raw2.get(I.KEY('u9', 'gcal'))).tok.access === 'acc-2');

    const other = send();
    await conn.handle({ method: 'GET', headers: {} }, other, { path: '/api/connect/gcal/events',
      query: new URLSearchParams({ from: '2026-10-16T21:00:00Z', to: '2026-10-17T21:00:00Z' }), me: { id: 'someone' }, raw: st2, json, fetch: gFetch });
    ok('another account cannot read it', other.status === 409);

    /* unticked permission */
    const sr2 = send();
    await conn.handle({ method: 'POST', headers: { host: 'theflow.today', 'x-forwarded-proto': 'https' } }, sr2,
      { path: '/api/connect/gmail/start', query: new URLSearchParams(), me: meX, raw: st2, json, readBody: async () => '{"app":true}' });
    const mu = new URL(JSON.parse(sr2.body).url);
    ok('Gmail asks for read-only mail', mu.searchParams.get('scope') === 'openid email https://www.googleapis.com/auth/gmail.readonly');
    scopeBack = 'openid email';
    const cb2 = send();
    await conn.handle({ method: 'GET', headers: {} }, cb2, { path: '/api/connect/google/callback',
      query: new URLSearchParams({ state: mu.searchParams.get('state'), code: 'c2' }), me: null, raw: st2, json, fetch: gFetch, readBody: async () => '' });
    ok('a sign-in with the mail permission unticked is not a connection', cb2.status === 400 && /read your email/.test(cb2.body) && !raw2.get(I.KEY('u9', 'gmail')));

    calls = [];
    const dc = send();
    await conn.handle({ method: 'POST', headers: {} }, dc, { path: '/api/connect/gcal/disconnect', query: new URLSearchParams(), me: meX, raw: st2, json, fetch: gFetch });
    ok('disconnecting forgets it and revokes it at Google', dc.status === 200 && !raw2.get(I.KEY('u9', 'gcal')) && calls.some((c) => c.u === 'https://oauth2.googleapis.com/revoke'));
  }

  console.log('\n— Fathom and Notion: a key the person pastes —');
  {
    const raw3 = new Map();
    const st3 = { get: async (k) => raw3.has(k) ? raw3.get(k) : null, set: async (k, v) => { raw3.set(k, v); } };
    const meK = { id: 'u7' };
    let calls = [];
    const kFetch = async (u, o) => {
      calls.push({ u: String(u), o: o || {} });
      const h = (o && o.headers) || {};
      if (/api\.fathom\.ai/.test(String(u))) {
        if (h['X-Api-Key'] !== 'fathom-good-key-123') return { ok: false, status: 401, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ next_cursor: null, items: [{
          recording_id: 77, title: 'Supplier call', share_url: 'https://fathom.video/share/x', created_at: '2026-10-16T10:00:00Z',
          recorded_by: { name: 'Artur', email: 'artur@abko.com.tr' },
          default_summary: { markdown_formatted: '## Notes\nAgreed MOQ.' },
          action_items: [{ description: 'Send samples', completed: false, assignee: { name: 'Artur', email: 'artur@abko.com.tr' } },
                         { description: 'Done already', completed: true, assignee: {} }] }] }) };
      }
      if (/api\.notion\.com/.test(String(u))) {
        if (h.Authorization !== 'Bearer ntn_good_secret_123') return { ok: false, status: 401, json: async () => ({}) };
        if (/\/users\/me$/.test(String(u))) return { ok: true, status: 200, json: async () => ({ name: 'The Flow', bot: { workspace_name: 'ABKO' } }) };
        if (/\/search$/.test(String(u))) return { ok: true, status: 200, json: async () => ({ results: [
          { id: '1234567890abcdef1234567890abcdef', properties: { title: { type: 'title', title: [{ plain_text: 'Weekly' }] } } }] }) };
        if (/\/pages$/.test(String(u))) return { ok: true, status: 200, json: async () => ({ url: 'https://notion.so/new-page' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const call = async (pth, method, body, q) => { const r = send();
      await conn.handle({ method, headers: {} }, r, { path: pth, query: new URLSearchParams(q || {}), me: meK, raw: st3, json, fetch: kFetch,
        readBody: async () => JSON.stringify(body || {}) });
      return { status: r.status, j: JSON.parse(r.body || '{}') }; };

    let r = await call('/api/connect/fathom/key', 'POST', { key: 'wrong-key-0000' });
    ok('a key Fathom refuses is not saved, and the person is told', r.status === 400 && /did not accept/.test(r.j.error) && !raw3.get(I.KEY('u7', 'fathom')));
    r = await call('/api/connect/fathom/key', 'POST', { key: 'has spaces in it' });
    ok('something that is not a key is refused before anybody is asked', r.status === 400 && !calls.some((c) => /has%20spaces|has spaces/.test(JSON.stringify(c))));
    r = await call('/api/connect/fathom/key', 'POST', { key: 'fathom-good-key-123' });
    const fr = first(raw3.get(I.KEY('u7', 'fathom')));
    ok('a good key is checked with Fathom and kept, with whose meetings they are', r.status === 200 && fr && fr.key === 'fathom-good-key-123' && fr.email === 'artur@abko.com.tr');
    r = await call('/api/connect/fathom/meetings', 'GET');
    const mt = (r.j.meetings || [])[0] || {};
    ok('meetings come back with the summary and only the open action items',
       r.status === 200 && mt.id === '77' && /Agreed MOQ/.test(mt.summary) && mt.actions.length === 1 && mt.actions[0].text === 'Send samples');
    const lastF = calls.filter((c) => /api\.fathom\.ai/.test(c.u)).pop();
    ok('asked with the key in a header, never in the URL', lastF.o.headers['X-Api-Key'] === 'fathom-good-key-123' && !/fathom-good-key/.test(lastF.u) && /include_summary=true/.test(lastF.u) && /include_action_items=true/.test(lastF.u));

    r = await call('/api/connect/notion/send', 'POST', { title: 'x', blocks: [] });
    ok('Notion is not used before it is connected', r.status === 409);
    r = await call('/api/connect/notion/key', 'POST', { key: 'ntn_good_secret_123' });
    ok('a Notion secret is checked and kept', r.status === 200 && first(raw3.get(I.KEY('u7', 'notion'))).name === 'ABKO');
    r = await call('/api/connect/notion/send', 'POST', { title: 'x', blocks: [] });
    ok('sending needs a chosen page', r.status === 400 && /Choose/.test(r.j.error));
    r = await call('/api/connect/notion/pages', 'GET');
    ok('the pages it can see are listed', r.status === 200 && r.j.pages[0].title === 'Weekly');
    r = await call('/api/connect/notion/target', 'POST', { id: '../../etc', title: 'x' });
    ok('a page id that is not one is refused', r.status === 400);
    r = await call('/api/connect/notion/target', 'POST', { id: '1234567890abcdef1234567890abcdef', title: 'Weekly' });
    ok('a page is chosen', r.status === 200 && first(raw3.get(I.KEY('u7', 'notion'))).target.title === 'Weekly');
    calls = [];
    r = await call('/api/connect/notion/send', 'POST', { title: 'The Flow — 2026 week 42', blocks: [
      { type: 'h', text: 'Big Rocks' }, { type: 'todo', text: 'Mon — Ship', done: true }, { type: 'li', text: 'wrote' },
      { type: 'script', text: 'not a block type' }] });
    const sent = JSON.parse((calls.find((c) => /\/pages$/.test(c.u)) || { o: { body: '{}' } }).o.body);
    ok('a page is made under the chosen one, with the week as blocks',
       r.status === 200 && r.j.url === 'https://notion.so/new-page' && sent.parent.page_id === '1234567890abcdef1234567890abcdef' &&
       sent.children[0].type === 'heading_2' && sent.children[1].to_do.checked === true && sent.children[2].type === 'bulleted_list_item');
    ok('anything that is not a known block becomes plain text', sent.children[3].type === 'paragraph');
    const lr = send();
    await conn.handle({ method: 'GET', headers: {} }, lr, { path: '/api/connect/list', query: new URLSearchParams(), me: meK, raw: st3, json });
    ok('the list never carries a pasted key', !/fathom-good-key|ntn_good_secret/.test(lr.body) && /"target":"Weekly"/.test(lr.body));
    r = await call('/api/connect/fathom/start', 'POST', {});
    ok('a key connection has no sign-in to start', r.status === 400);
    ok('deleting the account removes both', (await conn.purgeUser(st3, 'u7')) === 2 && !raw3.get(I.KEY('u7', 'fathom')) && !raw3.get(I.KEY('u7', 'notion')));
  }

  console.log('\n— several accounts, and Outlook —');
  {
    const raw4 = new Map();
    const st4 = { get: async (k) => raw4.has(k) ? raw4.get(k) : null, set: async (k, v) => { raw4.set(k, v); } };
    const meM = { id: 'u5' };
    process.env.MS_CLIENT_ID = '';
    process.env.MS_CLIENT_SECRET = '';
    const call = async (pth, method, body, q, f) => { const r = send();
      await conn.handle({ method, headers: { host: 'theflow.today', 'x-forwarded-proto': 'https' } }, r, { path: pth, query: new URLSearchParams(q || {}), me: meM, raw: st4, json, fetch: f,
        readBody: async () => JSON.stringify(body || {}) });
      return { status: r.status, body: r.body, j: (() => { try { return JSON.parse(r.body || '{}'); } catch (e) { return {}; } })() }; };
    let L = await call('/api/connect/list', 'GET');
    ok('without Microsoft credentials, Outlook is listed but not offered', L.j.connections.find((c) => c.id === 'outlook').configured === false);
    process.env.MS_CLIENT_ID = 'ms-client-id';
    process.env.MS_CLIENT_SECRET = 'ms-secret';
    L = await call('/api/connect/list', 'GET');
    ok('with them, it is', L.j.connections.find((c) => c.id === 'outlook').configured === true);

    /* a legacy single record reads as one account */
    raw4.set(I.KEY('u5', 'gcal'), JSON.stringify({ account: 'old', email: 'old@gmail.com', tok: { access: 'o', refresh: 'or', exp: Date.now() + 3600e3 } }));
    L = await call('/api/connect/list', 'GET');
    const lg = L.j.connections.find((c) => c.id === 'gcal');
    ok('a connection saved before accounts existed is read as one account', lg.connected && lg.accounts.length === 1 && lg.accounts[0].email === 'old@gmail.com');

    const mkTok = (sub, email) => ({ access_token: 'acc-' + sub, refresh_token: 'ref-' + sub, expires_in: 3600,
      scope: 'openid https://www.googleapis.com/auth/calendar.readonly',
      id_token: 'x.' + Buffer.from(JSON.stringify({ sub, email, email_verified: true })).toString('base64url') + '.y' });
    let nextTok = null, calls = [];
    const gF = async (u, o) => {
      calls.push({ u: String(u), o: o || {} });
      if (String(u) === 'https://oauth2.googleapis.com/token') return { ok: true, status: 200, json: async () => nextTok };
      if (/calendar\/v3/.test(String(u))) {
        const who = (o.headers.Authorization || '').replace('Bearer ', '');
        if (who === 'acc-bad') return { ok: false, status: 401, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'e-' + who, summary: 'From ' + who,
          start: { dateTime: '2026-10-21T09:00:00Z' }, end: { dateTime: '2026-10-21T10:00:00Z' } }] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const connectG = async (sub, email) => {
      const s1 = await call('/api/connect/gcal/start', 'POST', { app: true });
      const st = new URL(s1.j.url).searchParams.get('state');
      nextTok = mkTok(sub, email);
      const r = send();
      await conn.handle({ method: 'GET', headers: {} }, r, { path: '/api/connect/google/callback',
        query: new URLSearchParams({ state: st, code: 'c-' + sub }), me: null, raw: st4, json, fetch: gF, readBody: async () => '' });
      return r;
    };
    await connectG('work', 'artur@abko.com.tr');
    L = await call('/api/connect/list', 'GET');
    let acc = L.j.connections.find((c) => c.id === 'gcal').accounts;
    ok('connecting a second Google account adds it, keeping the first', acc.length === 2 && acc.map((a) => a.email).join() === 'old@gmail.com,artur@abko.com.tr', acc);
    await connectG('work', 'artur@abko.com.tr');
    acc = (await call('/api/connect/list', 'GET')).j.connections.find((c) => c.id === 'gcal').accounts;
    ok('connecting the same account again replaces it, no twin', acc.length === 2);
    ok('no account\'s token reaches the list', !/acc-|ref-|"tok"/.test((await call('/api/connect/list', 'GET')).body));

    calls = [];
    let ev = await call('/api/connect/gcal/events', 'GET', null, { from: '2026-10-20T21:00:00Z', to: '2026-10-21T21:00:00Z' }, gF);
    ok('today\'s events come from every account, each saying whose',
       ev.status === 200 && ev.j.events.length === 2 && ev.j.events.some((e) => e.account === 'old@gmail.com') && ev.j.events.some((e) => e.account === 'artur@abko.com.tr'), ev.j);

    /* one account failing does not hide the others */
    const allG = JSON.parse(raw4.get(I.KEY('u5', 'gcal')));
    allG.accounts[0].tok.access = 'acc-bad';
    raw4.set(I.KEY('u5', 'gcal'), JSON.stringify(allG));
    ev = await call('/api/connect/gcal/events', 'GET', null, { from: '2026-10-20T21:00:00Z', to: '2026-10-21T21:00:00Z' }, gF);
    ok('one account that fails does not hide the other, and is named',
       ev.status === 200 && ev.j.events.length === 1 && ev.j.problems && ev.j.problems[0].account === 'old@gmail.com', ev.j);

    calls = [];
    const off = await call('/api/connect/gcal/disconnect', 'POST', { aid: 'work' }, null, gF);
    acc = (await call('/api/connect/list', 'GET')).j.connections.find((c) => c.id === 'gcal').accounts;
    ok('disconnecting one account leaves the others', off.status === 200 && acc.length === 1 && acc[0].email === 'old@gmail.com');
    ok('and revokes only that one at Google', calls.filter((c) => /revoke/.test(c.u)).length === 1 &&
       new URLSearchParams(calls.find((c) => /revoke/.test(c.u)).o.body).get('token') === 'ref-work');

    /* Outlook */
    const s2 = await call('/api/connect/outlook/start', 'POST', { app: false });
    const mu = new URL(s2.j.url);
    ok('Outlook asks Microsoft (any account) for a code, offline, calendar and mail read-only',
       mu.origin + mu.pathname === 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' &&
       mu.searchParams.get('response_type') === 'code' && /offline_access/.test(mu.searchParams.get('scope')) &&
       /Calendars\.Read/.test(mu.searchParams.get('scope')) && /Mail\.Read/.test(mu.searchParams.get('scope')) &&
       !/ReadWrite|Send/.test(mu.searchParams.get('scope')));
    ok('on its own registered callback', mu.searchParams.get('redirect_uri') === 'https://theflow.today/api/connect/outlook/callback');
    let msScope = 'Calendars.Read Mail.Read User.Read openid profile email';
    const msF = async (u, o) => {
      calls.push({ u: String(u), o: o || {} });
      if (/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token/.test(String(u))) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'ms-acc', refresh_token: 'ms-ref', expires_in: 3600, scope: msScope,
          id_token: 'x.' + Buffer.from(JSON.stringify({ oid: 'oid-1', preferred_username: 'artur@abko.com.tr', name: 'Artur' })).toString('base64url') + '.y' }) };
      }
      if (/graph\.microsoft\.com\/v1\.0\/me\/calendarView/.test(String(u))) {
        return { ok: true, status: 200, json: async () => ({ value: [
          { id: 'm1', subject: 'Supplier call', start: { dateTime: '2026-10-21T08:00:00.0000000' }, end: { dateTime: '2026-10-21T08:30:00.0000000' },
            isAllDay: false, location: { displayName: 'Teams' }, onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/x' }, webLink: 'https://outlook.office.com/x' },
          { id: 'm2', subject: 'Cancelled', isCancelled: true, start: { dateTime: '2026-10-21T10:00:00' }, end: { dateTime: '2026-10-21T11:00:00' } }] }) };
      }
      if (/graph\.microsoft\.com\/v1\.0\/me\/messages/.test(String(u))) {
        return { ok: true, status: 200, json: async () => ({ value: [{ id: 'f1', subject: 'Invoice', from: { emailAddress: { name: 'Kaan', address: 'k@x' } }, webLink: 'https://outlook.office.com/mail/f1' }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    calls = [];
    const cbr = send();
    await conn.handle({ method: 'GET', headers: {} }, cbr, { path: '/api/connect/outlook/callback',
      query: new URLSearchParams({ state: mu.searchParams.get('state'), code: 'ms-code' }), me: null, raw: st4, json, fetch: msF, readBody: async () => '' });
    const parkTo = (cbr.body.match(/location\.replace\("([^"]+)"\)/) || [])[1] || '';
    const fin = send();
    await conn.handle({ method: 'GET', headers: {} }, fin, { path: '/api/connect/outlook/finish', query: new URL('http://x' + parkTo).searchParams, me: meM, raw: st4, json });
    const ol = first(raw4.get(I.KEY('u5', 'outlook')));
    const tokBody = new URLSearchParams((calls.find((c) => /oauth2\/v2\.0\/token/.test(c.u)) || { o: { body: '' } }).o.body);
    ok('the code is traded with Microsoft using the secret', tokBody.get('client_secret') === 'ms-secret' && tokBody.get('code') === 'ms-code');
    ok('a work account is connected under its sign-in address', /outlook:connected/.test(fin.headers.Location || '') && ol && ol.email === 'artur@abko.com.tr' && ol.aid === 'oid-1');
    const oe = await call('/api/connect/outlook/events', 'GET', null, { from: '2026-10-20T21:00:00Z', to: '2026-10-21T21:00:00Z' }, msF);
    const gv = calls.find((c) => /calendarView/.test(c.u));
    ok('Outlook events are read in UTC and come back with the zone stated, cancelled ones dropped, the Teams link kept',
       oe.status === 200 && oe.j.events.length === 1 && oe.j.events[0].start === '2026-10-21T08:00:00.000Z' &&
       oe.j.events[0].video === 'https://teams.microsoft.com/l/x' && gv.o.headers.Prefer === 'outlook.timezone="UTC"', oe.j);
    const fl = await call('/api/connect/outlook/flagged', 'GET', null, null, msF);
    ok('flagged mail comes back as sender and subject only', fl.status === 200 && fl.j.messages[0].subject === 'Invoice' && fl.j.messages[0].from === 'Kaan' && !('body' in fl.j.messages[0]));
    ok('read-only: Graph is only ever asked with GET', calls.filter((c) => /graph\.microsoft\.com/.test(c.u)).every((c) => !c.o.method || c.o.method === 'GET'));
    msScope = 'User.Read openid';
    const s3 = await call('/api/connect/outlook/start', 'POST', { app: true });
    const cb3 = send();
    await conn.handle({ method: 'GET', headers: {} }, cb3, { path: '/api/connect/outlook/callback',
      query: new URLSearchParams({ state: new URL(s3.j.url).searchParams.get('state'), code: 'c' }), me: null, raw: st4, json, fetch: msF, readBody: async () => '' });
    ok('an Outlook sign-in without the calendar and mail permissions is not a connection', cb3.status === 400 && /calendar and mail/.test(cb3.body));
    const dOut = send();
    await conn.handle({ method: 'POST', headers: {} }, dOut, { path: '/api/connect/outlook/disconnect', query: new URLSearchParams(), me: meM, raw: st4, json, fetch: msF, readBody: async () => '{}' });
    ok('disconnecting Outlook without naming an account removes them all', !raw4.get(I.KEY('u5', 'outlook')));
  }

  console.log('\n— in the app —');
  ok('pasted keys are typed into a password field and never painted back', /type="password" autocomplete="off"/.test(pack) && !/c\.key\b/.test(pack.slice(pack.indexOf('const Connect = {'), pack.indexOf('const Nav = {'))));
  ok('an import is remembered by id, so pressing it twice adds nothing twice',
     /markSeen\('fathom'/.test(pack) && /markSeen\(id, fresh/.test(pack) && /seen\.indexOf\(m\.id\) < 0/.test(pack));
  ok('imports land through addRock and J, the app\'s own saving path', /addRock\(String\(title\)/.test(pack) && /J\('meeting', body\)/.test(pack));
  ok('the calendar card is put back whenever Today is redrawn', /new MutationObserver\([\s\S]{0,120}#td-cal/.test(pack));
  ok('Today\'s calendar is every Google and Outlook account at once, without duplicates',
     /\['gcal', 'outlook'\]/.test(pack) && /if \(seen\[k\]\) return false/.test(pack));
  ok('each account can be disconnected on its own, and another added', /data-conn-off="' \+ esc\(c\.id\) \+ '" data-aid=/.test(pack) && /\+ Add another account/.test(pack));

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
