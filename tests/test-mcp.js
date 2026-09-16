/* The MCP server: what an assistant can see, what it can change, and — the
   part worth the most care — what it cannot.
 *
 * Three things are being defended here. That a token is a credential and
 * behaves like one. That one person's Claude can never reach another person's
 * Flow. And that nothing in this surface can delete: the whole point of a
 * record is that it survives being misread. */
const keepCookies = require('./cookie-jar.js');
const http = require('http');
const path = require('path');
const M = require(path.join(__dirname, '..', 'flow-mcp.js'));
const { weekId, parseDay, parseTime, datesOfWeek, dayIndex, localISO } = M._internals;

const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

const D = (s) => new Date(s + 'T12:00:00');

/* ---------- the parts that are pure, and easy to get quietly wrong ------- */

console.log('\n— the week a date belongs to —');
ok('a Sunday belongs to the week it ends', weekId(D('2026-09-13')) === '2026-W37', weekId(D('2026-09-13')));
ok('the Monday after starts a new one', weekId(D('2026-09-14')) === '2026-W38', weekId(D('2026-09-14')));
ok('it agrees with the app across a year boundary', weekId(D('2027-01-01')) === '2026-W53', weekId(D('2027-01-01')));
ok('a week id maps back to seven real dates', (datesOfWeek('2026-W38') || []).length === 7);
ok('and the first of them is the Monday',
   localISO(datesOfWeek('2026-W38')[0]) === '2026-09-14', localISO(datesOfWeek('2026-W38')[0]));
ok('the round trip holds', weekId(datesOfWeek('2026-W38')[3]) === '2026-W38');
ok('nonsense is refused rather than guessed at', datesOfWeek('later') === null);

console.log('\n— when somebody says when —');
const NOW = D('2026-09-13');            // a Sunday
ok('"today" is today', localISO(parseDay('today', NOW)) === '2026-09-13');
ok('"tomorrow" is tomorrow', localISO(parseDay('tomorrow', NOW)) === '2026-09-14');
ok('a bare date is taken as written', localISO(parseDay('2026-10-02', NOW)) === '2026-10-02');
ok('"friday" means the one coming, not the one gone',
   localISO(parseDay('friday', NOW)) === '2026-09-18', localISO(parseDay('friday', NOW)));
/* "next friday" means the Friday of the following week — not "seven days after
   whatever friday meant", which on a Sunday would skip a week nobody meant to
   skip. Said on a Sunday the two readings coincide, because the coming Friday
   already belongs to next week; said midweek they do not, and that is the case
   worth pinning. */
ok('"next friday" said on a Sunday is still the Friday coming, because that Friday is next week',
   localISO(parseDay('next friday', NOW)) === '2026-09-18', localISO(parseDay('next friday', NOW)));
const WED = D('2026-09-16');
ok('said midweek, "friday" is this one', localISO(parseDay('friday', WED)) === '2026-09-18', localISO(parseDay('friday', WED)));
ok('and "next friday" is the one after', localISO(parseDay('next friday', WED)) === '2026-09-25', localISO(parseDay('next friday', WED)));
ok('"this friday" never jumps a week', localISO(parseDay('this friday', WED)) === '2026-09-18', localISO(parseDay('this friday', WED)));
ok('the day you are already on means today, not a week away',
   localISO(parseDay('sunday', NOW)) === '2026-09-13', localISO(parseDay('sunday', NOW)));
ok('"tuesday" spelt out still lands', localISO(parseDay('Tuesday', NOW)) === '2026-09-15');
ok('"thurs" lands too', localISO(parseDay('thurs', NOW)) === '2026-09-17');
ok('a word nobody can place is refused, not guessed', parseDay('soonish', NOW) === null);
ok('an impossible date is refused', parseDay('2026-13-45', NOW) === null);

console.log('\n— and what time they meant —');
ok('24-hour passes through', parseTime('14:30') === '14:30');
ok('single digits are padded', parseTime('9:05') === '09:05');
ok('"2:30pm" is understood', parseTime('2:30pm') === '14:30');
ok('"9am" is understood', parseTime('9am') === '09:00');
ok('midnight is not noon', parseTime('12am') === '00:00', parseTime('12am'));
ok('noon is not midnight', parseTime('12pm') === '12:00', parseTime('12pm'));
ok('empty means no time, which is allowed', parseTime('') === '');
ok('an hour that does not exist is refused', parseTime('25:00') === null);
ok('a minute that does not exist is refused', parseTime('10:75') === null);
ok('half-read input is refused rather than half-applied', parseTime('half nine') === null);

/* ---------- over the wire ------------------------------------------------ */

const rq = (path, opts = {}) => new Promise((resolve) => {
  const u = new URL(H + path);
  const body = opts.body || null;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
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
async function as(who, path, opts = {}) {
  const o = Object.assign({}, opts);
  o.headers = Object.assign({}, opts.headers || {});
  if (jar[who]) o.headers.Cookie = jar[who];
  const r = await rq(path, o);
  keepCookies(jar, who, r);
  return r;
}
const signUp = (who, email, invite) => as(who, '/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email, name: who, password: 'a properly long password', invite })
});

(async () => {
  console.log('\n— a token is a credential —');
  await signUp('artur', 'artur.abacilar@abko.com.tr', 'letmein');   // the owner, first
  await signUp('sam', 'sam@example.com', 'letmein');

  let r = await as('artur', '/api/flow/tokens', { method: 'POST', body: JSON.stringify({ name: 'Claude on my laptop' }) });
  ok('a signed-in person can make one', r.status === 200 && !!r.json.token, r.status);
  const TOK = r.json.token;
  const TOKID = r.json.id;
  ok('it is recognisable as a credential if it ever leaks', /^flow_/.test(TOK), TOK && TOK.slice(0, 6));
  ok('it is long enough not to be guessed', TOK.length > 40, TOK.length);

  r = await as('artur', '/api/flow/tokens');
  ok('it appears in their list', r.json.tokens.length === 1 && r.json.tokens[0].name === 'Claude on my laptop', r.json.tokens);
  ok('the list never hands the secret back',
     JSON.stringify(r.json).indexOf(TOK) < 0 && !r.json.tokens[0].token, r.json.tokens[0]);
  ok('but shows enough to tell two apart', /^flow_.+…/.test(r.json.tokens[0].hint), r.json.tokens[0].hint);
  ok("it is on nobody else's list", (await as('sam', '/api/flow/tokens')).json.tokens.length === 0);
  ok('making one needs a session, not a token',
     (await rq('/api/flow/tokens', { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: '{}' })).status === 401);

  console.log('\n— and the endpoint asks for one —');
  const raw = (opts) => rq('/mcp', Object.assign({ method: 'POST' }, opts));
  r = await raw({ body: '{}' });
  ok('no token is refused', r.status === 401, r.status);
  ok('and it says how to fix that', /Settings/.test((r.json && r.json.error) || ''), r.json);
  ok('with the header a client needs to notice', /Bearer/.test(r.headers['www-authenticate'] || ''), r.headers['www-authenticate']);
  ok('a made-up token is refused', (await raw({ headers: { Authorization: 'Bearer flow_nonsense' }, body: '{}' })).status === 401);
  ok('a session cookie alone is not enough',
     (await as('artur', '/mcp', { method: 'POST', body: '{}' })).status === 401);

  const mcp = async (method, params, tok) => {
    const res = await raw({
      headers: { Authorization: 'Bearer ' + (tok || TOK) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} })
    });
    return res.json;
  };
  const call = async (name, args, tok) => {
    const j = await mcp('tools/call', { name, arguments: args || {} }, tok);
    return j && j.result;
  };

  console.log('\n— it speaks the protocol —');
  let j = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  ok('initialize answers', j && j.result && j.result.serverInfo.name === 'the-flow', j);
  ok('and agrees a version', j.result.protocolVersion === '2025-06-18', j.result.protocolVersion);
  ok('it meets an older client where it is',
     (await mcp('initialize', { protocolVersion: '2024-11-05' })).result.protocolVersion === '2024-11-05');
  ok('it does not claim a version it has never heard of',
     (await mcp('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion === '2025-06-18');
  ok('it tells the assistant how to behave',
     /Read before you write/i.test(j.result.instructions), j.result.instructions.slice(0, 80));
  ok('and that it must not try to delete',
     /Nothing here can delete/i.test(j.result.instructions) &&
     /do not\s+approximate/i.test(j.result.instructions),
     j.result.instructions.slice(-320));
  ok('ping answers', !!(await mcp('ping')).result);
  ok('a notification gets no reply', (await mcp('notifications/initialized')) === null);
  ok('an unknown method is a proper error, not a crash',
     (await mcp('sorcery')).error.code === -32601);

  j = await mcp('tools/list');
  const tools = j.result.tools;
  ok('every tool is listed', tools.length === 10, tools.length);
  ok('each one says what it is for', tools.every(t => t.description && t.description.length > 40));
  ok('each one has a schema', tools.every(t => t.inputSchema && t.inputSchema.type === 'object'));
  ok('nothing in the surface is named like a deletion',
     !tools.some(t => /delete|remove|clear|wipe|reset/i.test(t.name)), tools.map(t => t.name));

  console.log('\n— adding what somebody meant to do —');
  let res = await call('add_rock', { title: 'Call Ömer', day: 'tomorrow', time: '2pm', priority: 'high', note: 'https://meet.google.com/abc' });
  ok('a rock is added', !res.isError && !!res.structuredContent.added.id, res.content && res.content[0].text);
  const rock = res.structuredContent.added;
  ok('it says which day it landed on', /^\d{4}-\d{2}-\d{2}$/.test(rock.date), rock.date);
  ok('and which week, because "tomorrow" can be next week', /^\d{4}-W\d{2}$/.test(rock.week), rock.week);
  ok('the time was understood', rock.time === '14:00', rock.time);
  ok('the priority came back in words, not the stored code', rock.priority === 'high', rock.priority);
  ok('a meeting link is kept whole', rock.note === 'https://meet.google.com/abc', rock.note);

  res = await call('add_rock', { title: 'No day given' });
  ok('a rock with no day goes on today', !res.isError && res.structuredContent.added.date === localISO(new Date()), res.structuredContent);

  res = await call('add_rock', { title: 'x', day: 'blurgh' });
  ok('a day nobody can read is an error the model can act on', res.isError === true);
  ok('and the error says what would work', /tomorrow|friday|2026/.test(res.content[0].text), res.content[0].text);
  ok('an empty title is refused', (await call('add_rock', { title: '   ' })).isError === true);
  ok('an end before a start is refused',
     (await call('add_rock', { title: 'y', time: '15:00', end: '14:00' })).isError === true);
  ok('a priority that is not one of the three is refused',
     (await call('add_rock', { title: 'y', priority: 'urgent' })).isError === true);

  console.log('\n— and changing it afterwards —');
  res = await call('update_rock', { id: rock.id, done: true, priority: 'low' });
  ok('it changes', !res.isError && res.structuredContent.updated.done === true, res.content && res.content[0].text);
  ok('and reports only what actually changed',
     res.structuredContent.changed.indexOf('marked done') >= 0 && res.structuredContent.changed.indexOf('title') < 0,
     res.structuredContent.changed);
  res = await call('update_rock', { id: rock.id, done: true });
  ok('setting something to what it already is changes nothing', res.structuredContent.unchanged === true, res.structuredContent);
  res = await call('update_rock', { id: rock.id, day: '2026-12-24' });
  ok('moving it to another week moves it', res.structuredContent.updated.week === '2026-W52', res.structuredContent.updated.week);
  const wk52 = (await call('get_week', { week: '2026-W52' })).structuredContent;
  const allWeeks = await Promise.all(['2026-W37', '2026-W38', '2026-W52'].map(w => call('get_week', { week: w })));
  const copies = allWeeks.reduce((n, r2) => n + r2.structuredContent.days
    .reduce((m, d) => m + d.rocks.filter(x => x.id === rock.id).length, 0), 0);
  ok('and leaves no copy behind in the old one', copies === 1, copies);
  ok('it is on Christmas Eve, a Thursday',
     wk52.days.find(d => d.day === 'Thursday').rocks.some(x => x.id === rock.id),
     wk52.days.filter(d => d.rocks.length).map(d => d.day));
  ok('an id that does not exist is an error, not a new rock',
     (await call('update_rock', { id: 'made-up' })).isError === true);

  console.log('\n— it cannot delete, whatever it is asked —');
  ok('a title cannot be emptied to fake a deletion',
     (await call('update_rock', { id: rock.id, title: '' })).isError === true);
  ok('and the refusal says where removing actually happens',
     /in the app/i.test((await call('update_rock', { id: rock.id, title: '' })).content[0].text));
  ok('the weekly list cannot be emptied',
     (await call('set_blade_lines', { lines: [] })).isError === true);
  ok('roles cannot be emptied', (await call('set_mission', { roles: [] })).isError === true);
  ok('a rock survives all of that', (await call('get_week', { week: '2026-W52' }))
     .structuredContent.days.some(d => d.rocks.some(x => x.id === rock.id)));

  console.log('\n— reading the week —');
  const wk = (await call('get_week', {})).structuredContent;
  ok('it names the week it is showing', /^\d{4}-W\d{2}$/.test(wk.week), wk.week);
  ok('and says whether that is the current one', wk.is_current === true);
  ok('there are seven days, named', wk.days.length === 7 && wk.days[0].day === 'Monday');
  ok('each carries a real date', wk.days.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date)));
  ok('the weekly commitments come with it', wk.weekly_commitments.length === 8, wk.weekly_commitments.length);
  ok('each says whether it is done this week', wk.weekly_commitments.every(c => typeof c.done === 'boolean'));
  ok('"next" is understood', (await call('get_week', { week: 'next' })).structuredContent.is_current === false);
  ok('an ISO week is understood', (await call('get_week', { week: '2026-W52' })).structuredContent.week === '2026-W52');
  ok('a week nobody can read is refused', (await call('get_week', { week: 'sometime' })).isError === true);

  const today = (await call('get_today', {})).structuredContent;
  ok('today knows what day it is', today.date === localISO(new Date()));
  ok('and hands back dates, not nulls', today.next.concat(today.unscheduled, today.earlier).every(r => !!r.date),
     today.next.concat(today.unscheduled, today.earlier).map(r => r.date));

  console.log('\n— habits, which are the other kind of thing —');
  res = await call('add_habit', { name: 'Read 20 minutes' });
  ok('a habit is added', !res.isError && !!res.structuredContent.added.id);
  res = await call('add_habit', { name: 'read 20 MINUTES' });
  ok('the same habit twice is one habit, not two streaks', res.structuredContent.already_there === true, res.structuredContent);
  /* "read" now fits two habits — the one just added and the one the starter
     week came with — and an ambiguous partial must ask rather than guess. */
  ok('a partial that fits two habits asks which, instead of ticking one',
     /matches more than one habit/.test(((await call('log_habit', { habit: 'read' })).content || [{}])[0].text || ''),
     ((await call('log_habit', { habit: 'read' })).content || [{}])[0].text);
  res = await call('log_habit', { habit: '20 MINUTES' });
  ok('it can be ticked by a part of its name', !res.isError && res.structuredContent.done === true, res.content && res.content[0].text);
  ok('a habit nobody has is an error that lists the real ones',
     /Read 20 minutes/.test((await call('log_habit', { habit: 'juggling' })).content[0].text));
  ok('a day that has not happened cannot be ticked',
     (await call('log_habit', { habit: 'read', day: '2030-01-01' })).isError === true);
  const sc = (await call('get_scoreboard', {})).structuredContent;
  /* By name, not by position. A new account now arrives with habits of its
     own, so habits[0] is whichever one the starter template put first, and
     an index here was only ever a guess that happened to be right. */
  const readHabit = sc.habits.find(h => /Read 20 minutes/i.test(h.name));
  ok('the scoreboard counts the streak', !!readHabit && readHabit.streak === 1, sc.habits);
  ok('and knows the training target is five, not seven',
     sc.training.sessions_planned === 5, sc.training);

  console.log('\n— making it theirs —');
  res = await call('set_blade_lines', { lines: [{ area: 'Body', text: 'Lift three times' }, { text: 'Call my mother' }] });
  ok('the weekly list can be rewritten', !res.isError && res.structuredContent.lines.length === 2, res.content && res.content[0].text);
  ok('a line with no area still gets one', res.structuredContent.lines[1].area === 'Week', res.structuredContent.lines);
  ok('and the week reads back what was written',
     (await call('get_week', {})).structuredContent.weekly_commitments[0].text === 'Lift three times');
  res = await call('set_mission', { mission: 'Build the thing properly', roles: ['Work', 'Family'] });
  ok('mission and roles can be set', !res.isError && res.structuredContent.roles.length === 2);
  ok('and come back on the week', (await call('get_week', {})).structuredContent.mission === 'Build the thing properly');
  res = await call('set_training_day', { day: 'monday', title: 'Push', type: 'Push', exercises: [{ name: 'Bench', sets: '4 × 8' }] });
  ok('a training day can be shaped', !res.isError && res.structuredContent.title === 'Push', res.content && res.content[0].text);
  ok('and it keeps their own word for the type', res.structuredContent.type === 'Push', res.structuredContent.type);
  const plannedBefore = (await call('get_scoreboard', {})).structuredContent.training.sessions_planned;
  res = await call('set_training_day', { day: 'wednesday', title: 'Off', rest: true });
  ok('a rest day is a rest day', res.structuredContent.rest_day === true);
  /* Relative, because the number it starts from is whatever the person's
     week actually says. Asserting a fixed 5 on both sides of this — which is
     what it used to do — proved nothing at all about rest days: it passed
     while Wednesday was a training day and would have passed if the rest day
     had been ignored entirely. */
  ok('and the scoreboard stops counting that day',
     (await call('get_scoreboard', {})).structuredContent.training.sessions_planned === plannedBefore - 1,
     { before: plannedBefore });

  console.log('\n— every change leaves a line in the record —');
  const jr = await as('artur', '/api/get?key=ld_journal');
  const lines = JSON.parse(jr.json.value || '[]');
  ok('the journal grew', lines.length > 5, lines.length);
  ok('and says the changes came from Claude',
     lines.filter(l => /via Claude/.test(l.txt)).length >= 5,
     lines.slice(-3).map(l => l.txt));

  console.log('\n— one person\'s Claude cannot reach another person\'s Flow —');
  const r2 = await as('sam', '/api/flow/tokens', { method: 'POST', body: JSON.stringify({ name: 'Sam' }) });
  const SAMTOK = r2.json.token;
  const samWeek = (await call('get_week', {}, SAMTOK)).structuredContent;
  /* Sam's week is not empty — his account was given a first week like
     everybody's — so what has to hold is that none of it is Artur's. */
  const samRocks = samWeek.days.reduce((a, d) => a.concat(d.rocks), []);
  ok("Sam's week is Sam's",
     samRocks.length > 0 && !samRocks.some(r => /Ship|Artur|only Artur knows/i.test(r.title)),
     samRocks.map(r => r.title));
  ok('and carries none of the other mission', !samWeek.mission, samWeek.mission);
  await call('add_rock', { title: "Sam's own thing" }, SAMTOK);
  const arturToday = (await call('get_today', {})).structuredContent;
  ok("what Sam adds does not appear on Artur's day",
     !arturToday.next.concat(arturToday.unscheduled).some(x => /Sam/.test(x.title)),
     arturToday.next.concat(arturToday.unscheduled).map(x => x.title));

  console.log('\n— revoking really revokes —');
  r = await as('artur', '/api/flow/tokens/revoke', { method: 'POST', body: JSON.stringify({ id: TOKID }) });
  ok('the owner can revoke their own', r.status === 200, r.json);
  ok('and it stops working straight away', (await raw({ headers: { Authorization: 'Bearer ' + TOK }, body: '{}' })).status === 401);
  ok('it leaves the list', (await as('artur', '/api/flow/tokens')).json.tokens.length === 0);
  ok('but destroys nothing that was saved',
     (await call('get_week', { week: '2026-W52' }, SAMTOK)).structuredContent.week === '2026-W52');
  r = await as('sam', '/api/flow/tokens/revoke', { method: 'POST', body: JSON.stringify({ id: TOKID }) });
  ok("and nobody can revoke somebody else's", r.status === 404, r.status);

  console.log('\n— the awkward requests —');
  ok('malformed JSON is an error, not a crash',
     (await raw({ headers: { Authorization: 'Bearer ' + SAMTOK }, body: '{oh no' })).json.error.code === -32700);
  const batch = await raw({ headers: { Authorization: 'Bearer ' + SAMTOK },
    body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]) });
  ok('a batch comes back as a batch', Array.isArray(batch.json) && batch.json.length === 2, batch.json);
  const onlyNotes = await raw({ headers: { Authorization: 'Bearer ' + SAMTOK },
    body: JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/initialized' }]) });
  ok('a batch of nothing but notifications gets no body', onlyNotes.status === 202 && onlyNotes.text === '', onlyNotes.status);
  ok('a GET says plainly that it is the wrong verb',
     (await rq('/mcp', { headers: { Authorization: 'Bearer ' + SAMTOK } })).status === 405);
  ok('preflight is answered without a credential',
     (await rq('/mcp', { method: 'OPTIONS' })).status === 204);

  /* Every tool says what kind of thing it is before anybody calls it.
     A client that cannot tell set_mission from get_today is one bad guess away
     from replacing somebody's year with a sentence — and the Connectors
     Directory rejects a server whose tools do not say. */
  console.log('\n— the tools declare themselves —');
  {
    const T = require('../flow-mcp.js').TOOLS;
    const READ = ['get_week', 'get_today', 'get_scoreboard'];
    const REPLACES = ['set_blade_lines', 'set_mission', 'set_training_day'];

    ok('every tool has a title', T.every(t => typeof t.title === 'string' && !!t.title),
       T.filter(t => !t.title).map(t => t.name));
    ok('and annotations', T.every(t => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'),
       T.filter(t => !t.annotations).map(t => t.name));
    ok('the three that only look are marked read-only',
       T.filter(t => t.annotations.readOnlyHint).map(t => t.name).sort().join(',') === READ.slice().sort().join(','),
       T.filter(t => t.annotations.readOnlyHint).map(t => t.name));
    ok('every writing tool says whether it destroys what was there',
       T.filter(t => !t.annotations.readOnlyHint).every(t => typeof t.annotations.destructiveHint === 'boolean'),
       T.filter(t => !t.annotations.readOnlyHint && typeof t.annotations.destructiveHint !== 'boolean').map(t => t.name));
    ok('the ones that replace a whole list admit it',
       REPLACES.every(n => T.find(t => t.name === n).annotations.destructiveHint === true),
       REPLACES.map(n => n + ':' + T.find(t => t.name === n).annotations.destructiveHint));
    ok('adding something is not destructive',
       ['add_rock', 'add_habit'].every(n => T.find(t => t.name === n).annotations.destructiveHint === false));
    /* Adding twice adds twice. Saying otherwise invites a retry that duplicates. */
    ok('and adding is not idempotent, because calling it twice adds two',
       ['add_rock', 'add_habit'].every(n => T.find(t => t.name === n).annotations.idempotentHint === false));
    ok('nothing here reaches outside this one account',
       T.every(t => t.annotations.openWorldHint === false));

    /* The icon a client would draw, if it drew one. Advertised whether or not
       today's clients honour it — most show a generic letter for anything
       that is not a built-in integration, and that is their end, not ours.

       Driven through dispatch rather than over HTTP because by this point in
       the suite every token has been deliberately revoked, and what is being
       checked is what initialize answers, not who may ask it. */
    const D = require('../flow-mcp.js')._internals.dispatch;
    const init = await D({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
                         { store: null, now: new Date(), origin: 'https://theflow.today' });
    const info = ((init || {}).result || {}).serverInfo || {};
    ok('the server offers an icon', Array.isArray(info.icons) && info.icons.length > 0, init);
    ok('by absolute URL, because whatever fetches it is not this browser',
       info.icons.every(i => /^https:\/\/theflow\.today\//.test(i.src || '')), info.icons);
    ok('and says what it is', info.icons.every(i => i.mimeType === 'image/png'), info.icons);
    ok('it points at the site too', info.websiteUrl === 'https://theflow.today', info.websiteUrl);

    /* A server that does not know its own address must not advertise a
       relative one — whatever fetches the icon is not this browser and has
       nothing to resolve it against. */
    const bare = await D({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
                         { store: null, now: new Date(), origin: '' });
    ok('and offers none at all when it cannot know its own address',
       bare.result.serverInfo.icons === undefined, bare.result.serverInfo);
  }

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n✗ the suite itself fell over:', e); process.exit(1); });
