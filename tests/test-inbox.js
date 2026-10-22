/* The universal inbox: a private URL anything can post to.
 *
 * Three things matter. The URL is the whole secret, so it must never show up
 * in the data the app hands to a browser, and rotating it must end the old one
 * at once. Posting needs no session, so what it accepts has to be tight —
 * bounded text, a real date, a cap per day. And what lands must be the same
 * shape as a task shared by a person, so the one inbox serves both. */
const keepCookies = require('./cookie-jar.js');
const http = require('http');

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
const post = (who, p, body) => as(who, p, { method: 'POST', body: JSON.stringify(body || {}) });
const anon = (p, body, ctype) => rq(p, { method: 'POST', body, headers: { 'Content-Type': ctype || 'application/json' } });

(async () => {
  console.log('\n— the address belongs to a signed-in person —');
  ok('asking for the address needs a session', (await rq('/api/inbox/key')).status === 401);
  const su = await post('artur', '/api/auth/signup', { email: 'artur.abacilar@abko.com.tr', name: 'Artur', password: 'a properly long password', invite: 'letmein' });
  ok('the first account signs up', su.status === 200, su.json);
  await post('sam', '/api/auth/signup', { email: 'sam@example.com', name: 'Sam', password: 'a properly long password', invite: 'letmein' });
  let k = await as('artur', '/api/inbox/key');
  ok('a signed-in person gets one', k.status === 200 && /\/api\/inbox\/[A-Za-z0-9_-]{16,}$/.test(k.json.url), k.json);
  const url1 = k.json.url;
  const path1 = new URL(url1).pathname;
  ok('asking again gives the same one', (await as('artur', '/api/inbox/key')).json.url === url1);
  ok("another person's is different", (await as('sam', '/api/inbox/key')).json.url !== url1);
  const all = await as('artur', '/api/all');
  ok('the key never appears in what the app hands to a browser', all.status === 200 && all.text.indexOf(path1.slice(-16)) < 0);

  console.log('\n— anything can post to it, no session needed —');
  let r = await anon(path1, JSON.stringify({ text: 'Call the accountant', due: '2026-10-28', time: '9:30', note: 'about Q4', source: 'Zapier' }));
  ok('a JSON post lands', r.status === 200 && r.json.ok && r.json.waiting === 1, r.json);
  r = await anon(path1, 'text=Buy+milk&source=Shortcut', 'application/x-www-form-urlencoded');
  ok('so does a form post', r.status === 200 && r.json.waiting === 2, r.json);
  r = await anon(path1, 'Just a line of text', 'text/plain');
  ok('and a plain line of text', r.status === 200 && r.json.waiting === 3, r.json);
  r = await anon(path1, JSON.stringify({ note: 'no text' }));
  ok('nothing without text', r.status === 400);
  r = await anon(path1, JSON.stringify({ text: 'x'.repeat(2000), due: 'next tuesday', time: 'noon' }));
  ok('long text is cut, and a date that is not a date is dropped', r.status === 200);

  const inbox = (await as('artur', '/api/share/inbox')).json.items;
  const first = inbox.find((i) => i.task.txt === 'Call the accountant');
  ok('it waits in the same inbox a shared task would', !!first && first.from.name === 'Zapier' && first.from.via === 'inbox', first);
  ok('with its date, time and note', first && first.task.due === '2026-10-28' && first.task.time === '09:30' && first.task.note === 'about Q4', first && first.task);
  const long = inbox.find((i) => i.task.txt.length === 300);
  ok('the long one was cut to 300 characters and has no date', !!long && !long.task.due && !long.task.time);
  ok("it is Artur's, not Sam's", (await as('sam', '/api/share/inbox')).json.items.length === 0);

  console.log('\n— and it can be taken away —');
  const rot = await post('artur', '/api/inbox/key/rotate');
  ok('rotating gives a new address', rot.status === 200 && rot.json.url !== url1, rot.json);
  ok('the old one stops at once', (await anon(path1, JSON.stringify({ text: 'late' }))).status === 404);
  ok('the new one works', (await anon(new URL(rot.json.url).pathname, JSON.stringify({ text: 'on time' }))).status === 200);
  ok('a made-up address is refused the same way', (await anon('/api/inbox/' + 'A'.repeat(24), JSON.stringify({ text: 'x' }))).status === 404);
  ok('and GET on it does nothing', (await rq(new URL(rot.json.url).pathname)).status !== 200);

  console.log('\n— deleting the account ends it —');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-auth.js'), 'utf8');
  ok('account deletion clears the key and the lookup', /INBOX_KEY\(uid\)/.test(src.slice(src.indexOf('5 · the odds and ends'))) && /INBOX_BYKEY\(k\)/.test(src));

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
