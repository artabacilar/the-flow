/* Sharing is the one deliberate hole in an otherwise sealed system, so the
   test is mostly about what does NOT cross: only the task the sender typed,
   only to the person they named, and nothing else about either account. */
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };
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
const send = (to, task, who) => call('/api/share/send', { method: 'POST',
  body: JSON.stringify({ to, task }) }, who);

(async () => {
  console.log('\n— three accounts —');
  let r = await signup('artur.abacilar@abko.com.tr', 'Artur', 'artur');
  ok('owner created', r.status === 200, r.body);
  r = await signup('sami@example.com', 'Sami', 'sami', 'letmein');
  ok('Sami created', r.status === 200, r.body);
  r = await signup('third@example.com', 'Third', 'third', 'letmein');
  ok('a third, uninvolved account created', r.status === 200, r.body);

  /* Each puts something private in their own store. */
  await call('/api/set', { method: 'POST', body: JSON.stringify({ key: 'ld_journal', value: JSON.stringify([{ txt: 'ARTUR-PRIVATE' }]) }) }, 'artur');
  await call('/api/set', { method: 'POST', body: JSON.stringify({ key: 'ld_journal', value: JSON.stringify([{ txt: 'SAMI-PRIVATE' }]) }) }, 'sami');

  console.log('\n— sending one task —');
  r = await send('sami@example.com', { txt: 'Call the supplier', note: 'ask about lead times', due: '2026-08-10', time: '14:00' }, 'artur');
  ok('the send is accepted', r.status === 200 && r.body.ok, r.body);
  const id = r.body.id;

  r = await call('/api/share/inbox', {}, 'sami');
  ok('Sami has exactly one item waiting', r.body.items.length === 1, r.body.items);
  const item = r.body.items[0];
  ok('it carries the task text', item.task.txt === 'Call the supplier', item.task);
  ok('and the note, date and time', item.task.note === 'ask about lead times' && item.task.due === '2026-08-10' && item.task.time === '14:00', item.task);
  ok('and says who sent it', item.from.email === 'artur.abacilar@abko.com.tr' && item.from.name === 'Artur', item.from);

  console.log('\n— and nothing else crosses —');
  ok('the record holds only from/task/id/at', Object.keys(item).sort().join(',') === 'at,from,id,task', Object.keys(item));
  ok("it carries none of Artur's journal", !/ARTUR-PRIVATE/.test(JSON.stringify(item)), item);
  r = await call('/api/all', {}, 'sami');
  ok("Sami's own store still only has his own data", /SAMI-PRIVATE/.test(JSON.stringify(r.body)) && !/ARTUR-PRIVATE/.test(JSON.stringify(r.body)), Object.keys(r.body || {}));
  r = await call('/api/all', {}, 'artur');
  ok("Artur's store is unchanged by sharing", /ARTUR-PRIVATE/.test(JSON.stringify(r.body)) && !/SAMI-PRIVATE/.test(JSON.stringify(r.body)));

  console.log('\n— the third account sees none of it —');
  r = await call('/api/share/inbox', {}, 'third');
  ok('their inbox is empty', r.body.items.length === 0, r.body.items);
  r = await call('/api/share/accept', { method: 'POST', body: JSON.stringify({ id }) }, 'third');
  ok('and they cannot accept somebody else\'s item', r.status === 404, r.status);

  console.log('\n— accepting hands it over exactly once —');
  r = await call('/api/share/accept', { method: 'POST', body: JSON.stringify({ id }) }, 'sami');
  ok('accept returns the task', r.status === 200 && r.body.item.task.txt === 'Call the supplier', r.body);
  ok('and the inbox is now empty', r.body.remaining === 0, r.body.remaining);
  r = await call('/api/share/accept', { method: 'POST', body: JSON.stringify({ id }) }, 'sami');
  ok('accepting twice is a 404, not a duplicate', r.status === 404, r.status);
  r = await call('/api/all', {}, 'sami');
  ok('the server did NOT write it into his tasks for him', !/Call the supplier/.test(JSON.stringify(r.body)), Object.keys(r.body || {}));

  console.log('\n— declining drops it without handing it over —');
  r = await send('sami@example.com', { txt: 'Something he does not want' }, 'artur');
  const id2 = r.body.id;
  r = await call('/api/share/decline', { method: 'POST', body: JSON.stringify({ id: id2 }) }, 'sami');
  ok('decline succeeds', r.status === 200, r.status);
  ok('and returns no task body', r.body.item === null, r.body);
  r = await call('/api/share/inbox', {}, 'sami');
  ok('the inbox is empty again', r.body.items.length === 0, r.body.items);

  console.log('\n— rubbish input is refused —');
  r = await send('sami@example.com', { txt: '   ' }, 'artur');
  ok('an empty task is a 400', r.status === 400, r.body);
  r = await send('not-an-email', { txt: 'x' }, 'artur');
  ok('a bad address is a 400', r.status === 400, r.body);
  r = await send('artur.abacilar@abko.com.tr', { txt: 'x' }, 'artur');
  ok('sharing with yourself is refused', r.status === 400, r.body);
  r = await send('ghost@example.com', { txt: 'x' }, 'artur');
  ok('an unknown recipient is a 404', r.status === 404, r.body);
  r = await send('sami@example.com', { txt: 'x', due: 'whenever', time: '99:99', evil: 'DROP TABLE' }, 'artur');
  ok('a malformed date is dropped, not stored', r.status === 200, r.body);
  const inbox2 = (await call('/api/share/inbox', {}, 'sami')).body.items;
  ok('the bad date became empty', inbox2[0].task.due === '' && inbox2[0].task.time === '', inbox2[0].task);
  /* Shape-valid but impossible values are the ones that slip through a naive
     regex and then break the recipient's calendar export. */
  await send('sami@example.com', { txt: 'x2', due: '2026-13-45', time: '24:00' }, 'artur');
  await send('sami@example.com', { txt: 'x3', due: '2026-02-31', time: '12:60' }, 'artur');
  await send('sami@example.com', { txt: 'x4', due: '2026-08-10', time: '23:59' }, 'artur');
  const inbox3 = (await call('/api/share/inbox', {}, 'sami')).body.items;
  const byTxt = (t) => inbox3.find(i => i.task.txt === t).task;
  ok('month 13 and day 45 are rejected', byTxt('x2').due === '', byTxt('x2'));
  ok('hour 24 is rejected', byTxt('x2').time === '', byTxt('x2'));
  ok('31 February is rejected', byTxt('x3').due === '', byTxt('x3'));
  ok('minute 60 is rejected', byTxt('x3').time === '', byTxt('x3'));
  ok('a genuinely valid date and time survive', byTxt('x4').due === '2026-08-10' && byTxt('x4').time === '23:59', byTxt('x4'));
  ok('and unknown fields were stripped', inbox2[0].task.evil === undefined, Object.keys(inbox2[0].task));

  console.log('\n— an anonymous caller can do none of it —');
  const anonSend = await fetch(H + '/api/share/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'sami@example.com', task: { txt: 'x' } }) });
  ok('sending is refused', anonSend.status === 401, anonSend.status);
  const anonInbox = await fetch(H + '/api/share/inbox');
  ok('reading an inbox is refused', anonInbox.status === 401, anonInbox.status);

  console.log('\n— a long task is truncated, not rejected —');
  r = await send('sami@example.com', { txt: 'y'.repeat(2000) }, 'artur');
  ok('it is accepted', r.status === 200, r.status);
  const long = (await call('/api/share/inbox', {}, 'sami')).body.items.pop();
  ok('and capped at 500 characters', long.task.txt.length === 500, long.task.txt.length);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
