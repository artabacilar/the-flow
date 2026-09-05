/* Friend pairing. The code is the whole security boundary, so most of this
   is about what a code CANNOT do: work twice, pair you with yourself, be
   guessed at leisure, or survive being cancelled. The rest proves the link
   is mutual, that a stranger sees nothing, and that a card only ever carries
   the fields it is allowed to carry. */
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 240) : ''))); };
const jar = {};
const call = async (p, o = {}, who = 'a') => {
  const h = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (jar[who]) h.Cookie = jar[who];
  const r = await fetch(H + p, Object.assign({}, o, { headers: h }));
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  let b = null; try { b = await r.json(); } catch (e) {}
  return { status: r.status, body: b };
};
const signup = (email, name, who, invite) => call('/api/auth/signup', { method: 'POST',
  body: JSON.stringify({ email, name, password: 'a properly long password', invite }) }, who);
const post = (p, body, who) => call(p, { method: 'POST', body: JSON.stringify(body || {}) }, who);

(async () => {
  console.log('\n— three accounts —');
  let r = await signup('artur.abacilar@abko.com.tr', 'Artur', 'artur');
  ok('owner created', r.status === 200, r.body);
  r = await signup('sami@example.com', 'Sami', 'sami', 'letmein');
  ok('Sami created', r.status === 200, r.body);
  r = await signup('third@example.com', 'Third', 'third', 'letmein');
  ok('an uninvolved third account created', r.status === 200, r.body);

  console.log('\n— nobody starts with friends —');
  r = await call('/api/friends/list', {}, 'artur');
  ok('the list is empty', r.status === 200 && r.body.friends.length === 0, r.body);
  r = await call('/api/friends/list', {}, 'anon');
  ok('and signed out you get nothing at all', r.status === 401, r.status);

  console.log('\n— making a code —');
  r = await post('/api/friends/code', {}, 'artur');
  ok('a code comes back', r.status === 200 && !!r.body.code, r.body);
  const code = r.body.code;
  ok('it reads as XXXX-XXXX', /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code), code);
  ok('with no 0, O, 1 or I to mistype', !/[01OI]/.test(code), code);
  ok('and an expiry', !!r.body.exp && new Date(r.body.exp) > new Date(), r.body.exp);

  r = await call('/api/friends/codes', {}, 'artur');
  ok('it is listed as outstanding', r.body.codes.length === 1 && r.body.codes[0].code === code, r.body.codes);
  r = await call('/api/friends/codes', {}, 'sami');
  ok("and it is not in anyone else's list", r.body.codes.length === 0, r.body.codes);

  console.log('\n— a code you cannot use —');
  r = await post('/api/friends/redeem', { code }, 'artur');
  ok('your own code is refused', r.status === 400, r.status);
  r = await post('/api/friends/redeem', { code: 'ZZZZ-ZZZZ' }, 'sami');
  ok('a made-up code is refused', r.status === 404, r.status);
  r = await call('/api/friends/list', {}, 'artur');
  ok('and neither attempt paired anybody', r.body.friends.length === 0, r.body.friends);

  console.log('\n— redeeming it —');
  r = await post('/api/friends/redeem', { code: code.toLowerCase().replace('-', ' ') }, 'sami');
  ok('typed in lower case with a space, it still works', r.status === 200 && r.body.ok, r.body);
  ok('and it names who you paired with', r.body.friend && r.body.friend.email === 'artur.abacilar@abko.com.tr', r.body.friend);

  r = await call('/api/friends/list', {}, 'sami');
  ok('Sami now has Artur', r.body.friends.length === 1 && r.body.friends[0].name === 'Artur', r.body.friends);
  r = await call('/api/friends/list', {}, 'artur');
  ok('and Artur has Sami — the link is mutual', r.body.friends.length === 1 && r.body.friends[0].name === 'Sami', r.body.friends);
  r = await call('/api/friends/codes', {}, 'artur');
  ok('the code is no longer outstanding', r.body.codes.length === 0, r.body.codes);

  console.log('\n— once means once —');
  r = await post('/api/friends/redeem', { code }, 'third');
  ok('a second person cannot use the same code', r.status === 409, r.status);
  r = await call('/api/friends/list', {}, 'third');
  ok('and is paired with nobody', r.body.friends.length === 0, r.body.friends);

  console.log('\n— publishing a card —');
  const card = {
    metrics: [{ icon: '🏋️', name: 'Workouts', unit: 'sessions', period: 'week', target: 4, count: 3, streak: 6 }],
    plan: { week: '2026-W36', text: 'Finish the mixtape, three gym sessions.' },
    rocks: { week: '2026-W36', done: 2, total: 5, items: [{ title: 'Master the EP', done: true }] },
    checkin: { text: 'Two hours in the studio.', day: '2026-09-05' }
  };
  r = await post('/api/friends/card', { card }, 'artur');
  ok('Artur publishes his card', r.status === 200 && r.body.ok, r.body);

  r = await call('/api/friends/list', {}, 'sami');
  const c = r.body.friends[0].card;
  ok('Sami sees it', !!c, r.body.friends[0]);
  ok('with the streak', c.metrics[0].streak === 6 && c.metrics[0].count === 3, c.metrics);
  ok('the week plan', c.plan.text.indexOf('mixtape') > 0, c.plan);
  ok('the Big Rock count', c.rocks.done === 2 && c.rocks.total === 5, c.rocks);
  ok('and the check-in', c.checkin.text === 'Two hours in the studio.', c.checkin);

  r = await call('/api/friends/list', {}, 'third');
  ok('the third account sees none of it', r.body.friends.length === 0, r.body.friends);

  console.log('\n— a card cannot carry more than a card —');
  await post('/api/friends/card', { card: {
    name: 'Somebody Else',
    metrics: [{ name: 'x'.repeat(300), target: 99999999, streak: -5 }],
    plan: { text: 'y'.repeat(5000) },
    checkin: { text: 'z', day: '2026-13-45' },
    secret: 'ld_journal',
    ld_journal: [{ txt: 'PRIVATE' }]
  } }, 'artur');
  r = await call('/api/friends/list', {}, 'sami');
  const c2 = r.body.friends[0].card;
  ok('the name is the account name, not the one it claimed', c2.name === 'Artur', c2.name);
  ok('long text is cut', c2.metrics[0].name.length === 40 && c2.plan.text.length === 1200, [c2.metrics[0].name.length, c2.plan.text.length]);
  ok('numbers are clamped', c2.metrics[0].target === 9999 && c2.metrics[0].streak === 0, c2.metrics[0]);
  ok('an impossible date is dropped', c2.checkin.day === '', c2.checkin);
  ok('and unknown fields never arrive', c2.secret === undefined && c2.ld_journal === undefined, Object.keys(c2));

  console.log('\n— what pairing does NOT open up —');
  r = await call('/api/all', {}, 'sami');
  const keys = Object.keys(r.body || {});
  ok("a friend still cannot read the other's store", !JSON.stringify(r.body).includes('PRIVATE'), keys.slice(0, 8));
  r = await call('/api/get?key=ld_journal', {}, 'sami');
  ok('nor any single key of theirs', !JSON.stringify(r.body || '').includes('PRIVATE'), r.body);

  console.log('\n— cancelling a code —');
  r = await post('/api/friends/code', {}, 'artur');
  const code2 = r.body.code;
  r = await post('/api/friends/code/revoke', { code: code2 }, 'sami');
  ok('somebody else cannot cancel your code', r.status === 404, r.status);
  r = await post('/api/friends/code/revoke', { code: code2 }, 'artur');
  ok('you can cancel your own', r.status === 200, r.body);
  r = await post('/api/friends/redeem', { code: code2 }, 'third');
  ok('and a cancelled code no longer works', r.status === 404, r.status);

  console.log('\n— unpairing —');
  r = await post('/api/friends/unpair', { id: (await call('/api/friends/list', {}, 'sami')).body.friends[0].id }, 'sami');
  ok('Sami unpairs', r.status === 200, r.body);
  r = await call('/api/friends/list', {}, 'sami');
  ok('and no longer has Artur', r.body.friends.length === 0, r.body.friends);
  r = await call('/api/friends/list', {}, 'artur');
  ok('nor Artur him — it breaks both ways', r.body.friends.length === 0, r.body.friends);

  console.log('\n— and pairing again is a fresh code —');
  r = await post('/api/friends/redeem', { code }, 'sami');
  ok('the old, spent code stays spent', r.status === 409, r.status);
  r = await post('/api/friends/code', {}, 'artur');
  r = await post('/api/friends/redeem', { code: r.body.code }, 'sami');
  ok('a new one pairs them again', r.status === 200, r.body);

  console.log('\n— guessing is capped —');
  let refused = 0;
  for (let i = 0; i < 34; i++) {
    const g = await post('/api/friends/redeem', { code: 'AAAA-BBB' + (i % 9 + 2) }, 'third');
    if (g.status === 429) refused++;
  }
  ok('after enough wrong tries the door shuts for the day', refused > 0, refused);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
