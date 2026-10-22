/* Meetings, filed on their own.
 *
 * In process: the date reader, the shape a meeting takes, and one tick with
 * Fathom replaced — what lands where, what is skipped, what is never filed
 * twice. In a browser: a meeting the server left in ld_meetings becomes a
 * Big Rock on the right day, with the meeting folded under it on Today. */
const keepCookies = require('./cookie-jar.js');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 240) : ''))); };

const rq = (p, opts = {}) => new Promise((resolve) => {
  const u = new URL(H + p);
  const body = opts.body || null;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers }, (res) => {
    let b = ''; res.on('data', (c) => b += c);
    res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json: j, text: b, headers: res.headers }); });
  });
  r.on('error', () => resolve({ status: 0, json: null, text: '' }));
  if (body) r.write(body); r.end();
});
const jar = {};
async function as(who, p, opts = {}) {
  const o = Object.assign({}, opts); o.headers = Object.assign({}, opts.headers || {});
  if (jar[who]) o.headers.Cookie = jar[who];
  const r = await rq(p, o); keepCookies(jar, who, r); return r;
}
const post = (who, p, body) => as(who, p, { method: 'POST', body: JSON.stringify(body || {}) });

function memStore() { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); } }; }

(async () => {
  const M = require('../flow-meetings.js');
  const I = M._internals;

  console.log('\n— reading the date out of a sentence —');
  const wed = '2026-10-21T10:00:00Z';
  const cases = [
    ['send the deck by Friday', '2026-10-23'], ['call them tomorrow', '2026-10-22'], ['revert the form before 24 Oct', '2026-10-24'],
    ['ship on 2026-11-02', '2026-11-02'], ['follow up next week', '2026-10-26'], ['finish by end of week', '2026-10-23'],
    ['Pazartesi raporu gönder', '2026-10-26'], ['3.11 toplantı ayarla', '2026-11-03'], ['yarın ara', '2026-10-22'],
    ['end of month', '2026-10-31'], ['Monday', '2026-10-26'], ['the Oct 5 review notes', ''], ['nothing here', ''],
    ['update CRM', ''], ['Sally meeting recap', '']
  ];
  cases.forEach(([t, want]) => ok('"' + t + '" → ' + (want || 'no date'), I.dueFrom(t, wed) === want, I.dueFrom(t, wed)));
  ok('a weekday said on that weekday means next week, not today', I.dueFrom('Wednesday', wed) === '2026-10-28');
  ok('"sat" inside a word is not Saturday', I.dueFrom('satisfy the client', wed) === '');

  console.log('\n— one tick, with Fathom replaced —');
  const raw = memStore();
  const ME = 'artur@abko.com.tr';
  await raw.set('conn:u1:fathom', JSON.stringify({ v: 2, accounts: [{ aid: 'a1', key: 'k', email: ME }] }));
  await raw.set('u:u1:ld_connSeen', JSON.stringify({ fathom: ['old-1'] }));
  const fathom = {
    items: [
      { recording_id: 'old-1', title: 'Imported by hand already', recording_start_time: wed, share_url: 'https://fathom.video/share/old',
        default_summary: { markdown_formatted: 'Notes of the old one' },
        action_items: [{ description: 'Send ad creatives to Artur for review', assignee: { email: ME }, completed: false }] },
      { recording_id: 'm-1', title: 'Davines with Climboost', recording_start_time: wed, share_url: 'https://fathom.video/share/abc',
        calendar_invitees: [{ name: 'Artur', email: ME }, { name: 'Ozcan', email: 'ozcan@x.com', is_external: true }],
        default_summary: { markdown_formatted: '## Summary\n- Slow sellers to be discounted\n- **TikTok** next' },
        action_items: [
          { description: 'Cancel 15% popular-products discount by Friday', assignee: { name: 'Artur', email: ME }, completed: false },
          { description: 'Send slow-sellers list to Artur', assignee: { name: 'Ozcan', email: 'ozcan@x.com' }, completed: false },
          { description: 'Add TikTok to marketing plan', completed: false },
          { description: 'Already done thing', assignee: { email: ME }, completed: true }
        ] },
      { recording_id: 'm-2', title: 'Still being summarised', recording_start_time: wed, action_items: [] }
    ]
  };
  let calls = 0;
  const fetchFn = async (url) => { calls++; return { ok: true, status: 200, json: async () => fathom, url }; };
  const sent = [];
  const deps = {
    raw, users: async () => ['u1', 'u2'], connect: require('../flow-connect.js')._internals,
    nsPrefix: (uid) => 'u:' + uid + ':', fetch: fetchFn,
    sendToUser: async (r, uid, note) => { sent.push({ uid, note }); return { ok: true, sent: 1 }; }, log: () => {}
  };
  let out = await M.tick(deps, Date.parse('2026-10-21T12:00:00Z'));
  const r1 = out.find((x) => x.uid === 'u1');
  ok('the person with Fathom was pulled, the one without was skipped', r1 && r1.added === 1 && out.find((x) => x.uid === 'u2').skipped === 'no fathom', out);
  const kept = JSON.parse(raw.m.get('u:u1:ld_meetings'));
  ok('the meeting is kept in their own namespace, with summary and people', kept.length === 2 && kept[1].id === 'm-1' && /Slow sellers/.test(kept[1].summary) && kept[1].people.length === 2, kept.map((k) => k.id));
  const oldOne = kept.find((k) => k.id === 'old-1');
  ok('one imported by hand before is on record, marked as such, so its notes can show', !!oldOne && oldOne.legacy === true && /old one/.test(oldOne.summary), oldOne);
  ok('but it is not counted as new', r1.added === 1);
  ok('one whose summary is not written yet is left for the next tick', !kept.some((k) => k.id === 'm-2'));
  const acts = kept[1].actions;
  ok("the person's own item is marked mine, with its date read", acts[0].mine && acts[0].due === '2026-10-23', acts[0]);
  ok("somebody else's is kept but is not mine", !acts[1].mine && acts[1].who === 'Ozcan');
  const inbox = JSON.parse(raw.m.get('__share:inbox:u1'));
  ok('the item nobody owns went to the inbox, one tap from being theirs', inbox.length === 1 && inbox[0].task.txt === 'Add TikTok to marketing plan' && /Fathom/.test(inbox[0].from.name), inbox);
  ok('a completed item went nowhere', !inbox.some((i) => /Already done/.test(i.task.txt)) && acts[3].done);
  ok('the person was told', sent.length === 1 && /Davines/.test(sent[0].note.title) && /1 action item for you/.test(sent[0].note.body) && /1 unassigned/.test(sent[0].note.body), sent[0] && sent[0].note);
  ok('and the cursor moved', !!JSON.parse(raw.m.get('__meet:cursor:u1')).at);

  sent.length = 0; calls = 0;
  out = await M.tick(deps, Date.parse('2026-10-21T12:10:00Z'));
  ok('the next tick asks Fathom again but files nothing twice', calls === 1 && out.find((x) => x.uid === 'u1').added === 0 && JSON.parse(raw.m.get('u:u1:ld_meetings')).length === 2 && sent.length === 0);
  ok('and the first pass reached back a month, once', JSON.parse(raw.m.get('__meet:cursor:u1')).backfilled === true);
  ok('and the inbox did not grow', JSON.parse(raw.m.get('__share:inbox:u1')).length === 1);

  fathom.items[2].default_summary = { markdown_formatted: 'Now written' };
  out = await M.tick(deps, Date.parse('2026-10-21T12:20:00Z'));
  ok('once the summary exists, that meeting comes in', out.find((x) => x.uid === 'u1').added === 1 && JSON.parse(raw.m.get('u:u1:ld_meetings')).length === 3);

  const bad = Object.assign({}, deps, { fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  out = await M.tick(bad, Date.parse('2026-10-21T12:30:00Z'));
  ok('Fathom having a bad minute is reported, not fatal', out.find((x) => x.uid === 'u1').problems.length === 1 && !out.find((x) => x.uid === 'u1').error, out);

  console.log('\n— the route —');
  ok('checking now needs a session', (await rq('/api/meetings/pull', { method: 'POST', body: '{}' })).status === 401);
  const su = await post('artur', '/api/auth/signup', { email: 'artur.abacilar@abko.com.tr', name: 'Artur', password: 'a properly long password', invite: 'letmein' });
  ok('signed up', su.status === 200);
  const pr = await post('artur', '/api/meetings/pull');
  ok('with no Fathom connected it says so rather than failing', pr.status === 200 && pr.json.skipped === 'no fathom', pr.json);

  console.log('\n— in the app: a meeting the server left becomes a Big Rock —');
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      const fixed = new Date(2026, 9, 21, 10, 0, 0).getTime();
      const RealDate = Date; const off = fixed - RealDate.now();
      class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
      window.Date = FakeDate;
    });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
    /* The account exists (made over HTTP above), so this is a sign-in. */
    await p.fill('#fa-email', 'artur.abacilar@abko.com.tr'); await p.fill('#fa-pw', 'a properly long password');
    await require('./submit-auth.js')(p);
    await p.waitForTimeout(4200);
    await p.waitForFunction(() => typeof window.FlowMeetings !== 'undefined', null, { timeout: 15000 }).catch(() => {});
    const warn = []; p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warn.push(m.text()); });
    const stored = JSON.parse(raw.m.get('u:u1:ld_meetings'));
    const r = await p.evaluate(([legacy, meeting]) => {
      Object.keys(cData.rocks || {}).forEach((k) => { delete cData.rocks[k]; });
      /* A rock the earlier, hand-run import left: the meeting only as a line of text. */
      cData.rocks['2026-W43'] = [{ id: 'legacy1', title: 'Send ad creatives to Artur for review', role: '', day: 2, time: '', end: '', prio: 'med',
        note: 'From Fathom: Imported by hand already — https://fathom.video/share/old', done: false }];
      cSave();
      localStorage.setItem('ld_meetings', JSON.stringify([legacy, meeting]));
      const filed = FlowMeetings.apply();
      const all = [].concat(...Object.values(cData.rocks || {}));
      const twice = FlowMeetings.apply();
      return { filed, twice, rocks: all.map((x) => ({ title: x.title, day: x.day, src: x.src })), weeks: Object.keys(cData.rocks), journal: jData.slice(-1)[0] && jData.slice(-1)[0].cat, applied: cData.meetApplied };
    }, [Object.assign({ me: ME }, stored.find((m) => m.id === 'old-1')), Object.assign({ me: ME }, stored.find((m) => m.id === 'm-1'))]);
    ok('one meeting filed, one rock made', r.filed.meetings === 1 && r.filed.rocks === 1, r.filed);
    const fresh = r.rocks.find((x) => /Cancel 15%/.test(x.title));
    ok('the rock is the item that was mine, on the day its wording named (Friday)', r.rocks.length === 2 && fresh && fresh.day === 4, r.rocks);
    ok('it remembers which meeting and item it came from', fresh.src && fresh.src.mid === 'm-1' && fresh.src.n === 0, fresh);
    ok('the summary went to the journal', r.journal === 'meeting');
    const old = r.rocks.find((x) => /ad creatives/.test(x.title));
    ok('the meeting on record made no new rock, even for an item that was mine', r.rocks.length === 2 && r.applied['old-1'] === true, r.rocks);
    ok('and the rock filed by hand before now knows its meeting and its item', old && old.src && old.src.k === 'fathom' && old.src.mid === 'old-1' && old.src.n === 0, old);
    ok('filing again does nothing', r.twice.meetings === 0 && r.twice.rocks === 0, r.twice);

    /* Make it today's, so Today shows it, then look for the fold. */
    await p.evaluate(() => { const all = [].concat(...Object.values(cData.rocks)); all.forEach((x) => { x.day = 2; }); cSave(); });
    await p.click('[data-fn-side="today"]').catch(() => {}); await p.waitForTimeout(1200);
    ok('the rock filed by hand shows its meeting too', await p.evaluate(() => {
      const row = document.querySelector('#today-feed .td-rock[data-rockid="legacy1"]');
      const meet = row && row.querySelector('.td-meet');
      return !!meet && /Imported by hand already/.test(meet.textContent) && /Notes of the old one/.test(meet.innerHTML);
    }));
    const ui = await p.evaluate(() => {
      const row = document.querySelector('#today-feed .td-rock[data-rockid]:not([data-rockid="legacy1"])');
      const meet = row && row.querySelector('.td-meet');
      const tg = meet && meet.querySelector('.td-meet-tg'); if (tg) tg.click();
      const body = meet && meet.querySelector('.td-meet-body');
      return { line: meet && meet.querySelector('.td-meet-line').textContent, open: body && !body.hidden, html: body && body.innerHTML.slice(0, 600) };
    });
    ok('Today shows the meeting under the rock', ui.line && /Davines with Climboost/.test(ui.line) && /Open recording/.test(ui.line), ui.line);
    ok('and the notes unfold: who was there, the summary, the other items', ui.open && /Ozcan/.test(ui.html) && /Slow sellers/.test(ui.html) && /Send slow-sellers list/.test(ui.html) && /<b>TikTok<\/b>/.test(ui.html), ui.html);
    const btn = await p.evaluate(() => ({ refresh: !!document.getElementById('fn-refresh'), drop: !!document.querySelector('.td-fix [data-fix="drop"]') || true }));
    ok('there is a refresh button in the header', btn.refresh);
    ok('no page errors', errs.length === 0, errs.concat(warn));
    await ctx.close();
  } finally { await b.close(); }

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
