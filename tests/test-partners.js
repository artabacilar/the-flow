/* Partners — the Friends card made to do something.
 *
 * Two halves. The server half proves a shared task keeps a short, bounded
 * record of what happened on it (who moved it, who commented, who joined),
 * and that a patch that changes nothing writes nothing. The browser half
 * proves the card itself: a partner is listed, a task typed next to their
 * name lands in THEIR inbox, "work on together" makes one live task with both
 * of you on it, the status and a comment round-trip from the card, what they
 * handed you can be added as a Big Rock from the same card, and the invite
 * message carries a real pairing code. */
const keepCookies = require('./cookie-jar.js');
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 260) : ''))); };
const jar = {};
const call = async (p, o = {}, who = 'a') => {
  const h = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (jar[who]) h.Cookie = jar[who];
  const r = await fetch(H + p, Object.assign({}, o, { headers: h }));
  keepCookies(jar, who, r);
  let b = null; try { b = await r.json(); } catch (e) {}
  return { status: r.status, body: b };
};
const signup = (email, name, who, invite) => call('/api/auth/signup', { method: 'POST',
  body: JSON.stringify({ email, name, password: 'a properly long password', invite }) }, who);
const post = (p, body, who) => call(p, { method: 'POST', body: JSON.stringify(body || {}) }, who);
const kinds = (t) => (t.log || []).map(e => e.k);

(async () => {
  console.log('\n— three accounts, two of them partners —');
  let r = await signup('artur.abacilar@abko.com.tr', 'Artur', 'artur');
  ok('owner created', r.status === 200, r.body);
  r = await signup('sami@example.com', 'Sami', 'sami', 'letmein');
  ok('Sami created', r.status === 200, r.body);
  r = await signup('third@example.com', 'Third', 'third', 'letmein');
  ok('a third account created', r.status === 200, r.body);
  r = await post('/api/friends/code', {}, 'artur');
  r = await post('/api/friends/redeem', { code: r.body.code }, 'sami');
  ok('Artur and Sami are paired', r.status === 200 && r.body.friend && r.body.friend.name === 'Artur', r.body);

  console.log('\n— a shared task remembers what happened on it —');
  r = await post('/api/shared/create', { title: 'Brief for the Vibe Show', ws: 'abko' }, 'artur');
  ok('created', r.status === 200 && r.body.task && r.body.task.token, r.body);
  const tok = r.body.task.token;
  ok('the record starts with its creation', kinds(r.body.task).join() === 'create' && r.body.task.log[0].v === 'Brief for the Vibe Show', r.body.task.log);
  r = await post('/api/shared/invite', { token: tok, to: 'sami@example.com' }, 'artur');
  ok('inviting Sami is recorded, with his name', kinds(r.body.task).join() === 'create,invite' && r.body.task.log[1].v === 'Sami', r.body.task.log);
  r = await post('/api/shared/update', { token: tok, patch: { status: 'in_progress' } }, 'sami');
  ok('Sami moving it is recorded as his', r.status === 200 && kinds(r.body.task).pop() === 'status' && r.body.task.log.slice(-1)[0].byName === 'Sami' && r.body.task.log.slice(-1)[0].v === 'in_progress', r.body.task.log);
  const n0 = r.body.task.log.length;
  r = await post('/api/shared/update', { token: tok, patch: { status: 'in_progress', title: 'Brief for the Vibe Show' } }, 'sami');
  ok('a patch that changes nothing writes nothing', r.body.task.log.length === n0, r.body.task.log.length);
  r = await post('/api/shared/update', { token: tok, patch: { notes: 'Models confirmed, hotel pending.' } }, 'artur');
  ok('editing the notes is noted without copying the notes', kinds(r.body.task).pop() === 'notes' && r.body.task.log.slice(-1)[0].v === '', r.body.task.log.slice(-1));
  r = await post('/api/shared/comment', { token: tok, text: 'Hotel is booked, two rooms. ' + 'x'.repeat(300) }, 'sami');
  const last = r.body.task.log.slice(-1)[0];
  ok('a comment is recorded by its first words', last.k === 'comment' && last.v.indexOf('Hotel is booked') === 0 && last.v.length <= 140, last);
  ok('while the comment itself is kept whole', r.body.task.comments[0].text.length > 300, r.body.task.comments[0].text.length);
  r = await post('/api/shared/join', { token: tok }, 'third');
  ok('joining by link is recorded', kinds(r.body.task).pop() === 'join' && r.body.task.log.slice(-1)[0].byName === 'Third', r.body.task.log.slice(-1));
  r = await post('/api/shared/delete', { token: tok }, 'third');
  r = await post('/api/shared/get', { token: tok }, 'artur');
  ok('and so is leaving', kinds(r.body.task).pop() === 'leave', kinds(r.body.task));
  for (let i = 0; i < 70; i++) await post('/api/shared/comment', { token: tok, text: 'c' + i }, 'artur');
  r = await post('/api/shared/get', { token: tok }, 'artur');
  ok('the record is bounded and keeps the newest', r.body.task.log.length === 60 && r.body.task.log.slice(-1)[0].v === 'c69', r.body.task.log.length);
  r = await post('/api/shared/delete', { token: tok }, 'artur');
  ok('cleaned up', r.status === 200 && r.body.deleted, r.body);

  console.log('\n— the card, in a browser —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.fill('#fa-email', 'artur.abacilar@abko.com.tr'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4000);
  ok('signed in', await p.evaluate(() => !!(Flow.Auth.user && Flow.Auth.user.email === 'artur.abacilar@abko.com.tr')));

  await p.evaluate(() => Flow.Nav.go('northstar')); await p.waitForTimeout(2500);
  const card = () => p.evaluate(() => {
    const c = document.querySelector('[data-foldcard="friends"]');
    if (!c) return null;
    c.classList.add('is-open');
    return { title: c.querySelector('.fold-head h3').textContent.trim(), chip: (c.querySelector('.flow-chip') || {}).textContent || '',
             people: [...c.querySelectorAll('.fr-person .fr-name')].map(e => e.textContent.trim()), html: c.innerHTML };
  });
  let c = await card();
  ok('the card is there and is called Partners', c && c.title === 'Partners', c && c.title);
  ok('Sami is on it', c && c.people.join() === 'Sami', c && c.people);
  ok('the chip counts him', c && /1 partner/.test(c.chip), c && c.chip);
  ok('with a line to hand him a task and one to work together', c && /data-fr-handin/.test(c.html) && /data-fr-togin/.test(c.html));
  ok('and a place to say what you work on', c && /data-fr-noteedit/.test(c.html));

  console.log('\n— hand over —');
  await p.fill('[data-fr-handin]', 'Send the price list to the Kemer salon');
  await p.press('[data-fr-handin]', 'Enter'); await p.waitForTimeout(1500);
  r = await call('/api/share/inbox', {}, 'sami');
  /* His inbox also holds the heads-up from the invite above; find ours. */
  const got = (r.body.items || []).find(it => it.task && it.task.txt === 'Send the price list to the Kemer salon');
  ok("it is in Sami's inbox", r.status === 200 && !!got, r.body.items);
  ok('from Artur', got && got.from.email === 'artur.abacilar@abko.com.tr', got && got.from);
  c = await card();
  ok('the card says you handed it over', /You handed over/.test(c.html) && /Send the price list/.test(c.html));
  ok('and the line is empty again', (await p.inputValue('[data-fr-handin]')) === '');
  const handed = await p.evaluate(() => Flow.DB.get('flow:friends:handed', null));
  ok('and that is kept in your own store, not theirs', handed && Object.values(handed)[0][0].txt === 'Send the price list to the Kemer salon', handed);

  console.log('\n— work on together —');
  await p.fill('[data-fr-togin]', 'Vibe Show stand plan');
  await p.click('[data-fr-together]'); await p.waitForTimeout(1800);
  r = await call('/api/shared/list', {}, 'sami');
  ok('Sami is on a live task with that title', r.body.items.length === 1 && r.body.items[0].title === 'Vibe Show stand plan' && r.body.items[0].members.length === 2, r.body.items);
  const token = r.body.items[0].token;
  c = await card();
  ok('the card lists it under Together', /Together · 1 open/.test(c.html) && /Vibe Show stand plan/.test(c.html), c.chip);
  ok('and the chip counts it', /1 together/.test(c.chip), c.chip);
  await p.selectOption('[data-fr-status="' + token + '"]', 'in_progress'); await p.waitForTimeout(1500);
  r = await post('/api/shared/get', { token }, 'sami');
  ok('moving it from the card moves it for Sami', r.body.task.status === 'in_progress', r.body.task.status);
  await p.fill('[data-fr-cin="' + token + '"]', 'Stand is 3×3, we need the roll-up.');
  await p.press('[data-fr-cin="' + token + '"]', 'Enter'); await p.waitForTimeout(1500);
  r = await post('/api/shared/get', { token }, 'sami');
  ok('a comment from the card reaches the task', r.body.task.comments.length === 1 && /roll-up/.test(r.body.task.comments[0].text), r.body.task.comments);
  c = await card();
  ok('and the card shows what happened lately, in your voice', /Lately/.test(c.html) && /You moved/.test(c.html) && /You on/.test(c.html), c.html.slice(c.html.indexOf('Lately'), c.html.indexOf('Lately') + 400));

  console.log('\n— what they hand you —');
  r = await post('/api/share/send', { to: 'artur.abacilar@abko.com.tr', task: { txt: 'Call the hotel about late check-out', due: '2026-12-01' } }, 'sami');
  ok('Sami hands Artur a task', r.status === 200, r.body);
  await p.evaluate(() => Flow.Friends.refresh()); await p.waitForTimeout(1500);
  c = await card();
  ok('it shows on the card as waiting', /From Sami · waiting for you/.test(c.html) && /late check-out/.test(c.html));
  ok('and the chip says so', /1 waiting/.test(c.chip), c.chip);
  await p.click('[data-fr-inbox="add"]'); await p.waitForTimeout(1500);
  const rock = await p.evaluate(() => { for (const w of Object.keys(cData.rocks)) { const x = (cData.rocks[w] || []).find(r => /late check-out/.test(r.title)); if (x) return { w, note: x.note }; } return null; });
  ok('Add makes it a Big Rock in your week', !!rock && /from Sami/.test(rock.note), rock);
  r = await call('/api/share/inbox', {}, 'artur');
  ok('and it is no longer waiting', r.body.items.length === 0, r.body.items);

  console.log('\n— their week, and what you say about them —');
  await post('/api/friends/card', { card: { checkin: { text: 'Antalya all day.', day: new Date().toISOString().slice(0, 10) }, rocks: { week: '2026-W45', done: 1, total: 3, items: [{ title: 'Stand build', done: true }] } } }, 'sami');
  await p.evaluate(() => Flow.Friends.refresh()); await p.waitForTimeout(1500);
  c = await card();
  ok("Sami's check-in is the first thing on his card", /Antalya all day/.test(c.html));
  ok('his week folds under Their week', /<details class="fr-week"/.test(c.html) && /Stand build/.test(c.html));
  await p.click('[data-fr-noteedit]'); await p.waitForTimeout(300);
  await p.fill('[data-fr-note]', 'Davines events'); await p.press('[data-fr-note]', 'Enter'); await p.waitForTimeout(1200);
  ok('and is shown as text again, not a field', await p.evaluate(() => { const b = document.querySelector('[data-fr-noteedit]'); return !!b && b.textContent === 'Davines events' && !document.querySelector('[data-fr-note]'); }));
  const notes = await p.evaluate(() => Flow.DB.get('flow:friends:notes', null));
  ok('the label is yours and stays with you', notes && Object.values(notes)[0] === 'Davines events', notes);

  console.log('\n— inviting somebody who is not here yet —');
  await p.click('#fr-invite'); await p.waitForTimeout(1500);
  const msg = await p.inputValue('#fr-invite-text').catch(() => '');
  ok('a message is written out', /Sign up at http:\/\/localhost:4222/.test(msg) && /Partners/.test(msg), msg);
  const m = /([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})/.exec(msg);
  ok('with a real pairing code in it', !!m, msg);
  r = await post('/api/friends/redeem', { code: m ? m[1] : 'ZZZZ-ZZZZ' }, 'third');
  ok('which pairs whoever uses it', r.status === 200 && r.body.friend && r.body.friend.name === 'Artur', r.body);

  console.log('\n— the Shared panel in Work knows your partners —');
  await p.evaluate(() => Flow.Friends.refresh()); await p.waitForTimeout(1200);
  await p.evaluate(() => Flow.Nav.go('abko')); await p.waitForTimeout(1200);
  const panel = await p.evaluate(() => { const el = document.querySelector('[data-flow-shared="abko"]'); return el ? el.innerHTML : null; });
  ok('the panel is on the Work tab', panel !== null && /Shared tasks/.test(panel));
  ok('and offers Third, who is not on the task, with one tap', /data-sinvitep="third@example.com"/.test(panel) && !/data-sinvitep="sami@example.com"/.test(panel));

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
