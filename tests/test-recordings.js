/* Recordings: a video or a call, heard and acted on, then kept for questions.
 *
 * What would make it wrong: a file that is not audio or video accepted; a
 * transcript lost, or read with no transcript in the prompt; his own to-dos
 * not reaching his week; a recording that fails left "listening" for ever;
 * a question about how something is done answered without what was said; or
 * no way to add one in the command centre or on Telegram. All made up. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const R = require('../flow-recordings.js');
const P = require('../flow-projects.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const TALK = [
  'Speaker 1: For the salon visits we calculate travel as kilometres times 8 lira, plus tolls, and the rep claims it monthly.',
  'Speaker 2: And hotels only when the trip is over 300 kilometres.',
  'Speaker 1: I will send the new travel policy to Azize on 2026-11-20.',
  'Speaker 2: Bobby should prepare a comparison of fuel cards.'
].join('\n');

(async () => {
  console.log('\n— reading what was said —');
  const um = P._internals.userMsg({ id: 'rec:x', title: 'Rep call', at: '2026-11-10', transcript: TALK, note: 'about travel costs' }, [], [{ id: 'jarvis', name: 'J.A.R.V.I.S.', role: 'Chief of staff' }], []);
  ok('the whole transcript, with speakers, and what he said about it are in what J.A.R.V.I.S. reads', /TRANSCRIPT:\nSpeaker 1: For the salon visits/.test(um) && /He said about it: about travel costs/.test(um) && /TODAY: \d{4}/.test(um));
  ok('he is asked for his own to-dos too, and told a recording is read like a meeting', /"mine"/.test(P._internals.system('Artur')) && /recording or a video/.test(P._internals.system('Artur')));
  const cr = P._internals.cleanRead({ summary: 's', mine: [{ title: 'Send the travel policy', date: '2026-11-20', time: '9:30' }, { title: '' }, { title: 'Call Ali', date: 'friday' }] }, ['jarvis']);
  ok('his to-dos keep a real date and time, nothing else', cr.mine.length === 2 && cr.mine[0].date === '2026-11-20' && cr.mine[0].time === '9:30' && cr.mine[1].date === '', cr.mine);
  ok('only audio and video count as recordings', R.isMedia('video/mp4', 'x') && R.isMedia('', 'call.m4a') && !R.isMedia('application/pdf', 'a.pdf'));

  console.log('\n— asked later —');
  const mem = { 'team:recordings': [{ id: 'rc1', name: 'Rep call', at: Date.parse('2026-11-10'), status: 'done' }], 'team:rec:rc1': TALK, ld_meetings: [{ id: 'm1', title: 'ABKO sales', at: '2026-11-09', summary: 'Keras ürünlerinde fiyatlar Ocak ayında artıyor.', actions: [] }] };
  const ctx = { get: async (k) => mem[k] == null ? null : mem[k], set: async (k, v) => { mem[k] = v; } };
  const hits = await R.recall(ctx, 'How do we calculate the travel costs for the hair salon visits?');
  ok('a question about how something is done finds the passage that says it, and names the recording', hits.length >= 1 && /kilometres times 8 lira/.test(hits[0].text) && /Recording "Rep call" \(2026-11-10\)/.test(hits[0].from), hits);
  const tr = await R.recall(ctx, 'Keras fiyatları ne zaman artıyor?');
  ok('…in Turkish too, and from his meetings\' notes', tr.some((h) => /Meeting "ABKO sales"/.test(h.from)), tr);
  ok('a question about nothing said finds nothing', (await R.recall(ctx, 'what is the weather in Paris tomorrow')).length === 0);

  console.log('\n— through the server —');
  const b = await chromium.launch();
  const bc = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await bc.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => { await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false); });
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);
  ok('a PDF is not a recording', (await api('/api/team/recordings', { name: 'a.pdf', mime: 'application/pdf', data: Buffer.from('%PDF').toString('base64') })).status === 415);
  const up = await api('/api/team/recordings', { name: 'Rep call.m4a', mime: 'audio/mp4', data: Buffer.from(TALK).toString('base64'), note: 'travel costs', wait: true });
  ok('a recording is taken at once', up.status === 202 && /^rc/.test(up.j.id), up.j);
  const one = await api('/api/team/recordings?id=' + up.j.id);
  ok('it is heard, read, and its transcript kept', one.j.recording.status === 'done' && /kilometres times 8 lira/.test(one.j.transcript) && one.j.recording.summary, one.j.recording);
  ok('his own to-do from it is on his week, on the day that was said', (one.j.recording.rocks || []).some((t) => /Send the new travel policy to Azize/.test(t)), one.j.recording);
  const cmp = await api('/api/get?key=ld_compass'); let c = cmp.j.value; if (typeof c === 'string') c = JSON.parse(c);
  const rk = [].concat(...Object.values((c && c.rocks) || {})).find((r) => /travel policy/.test(r.title));
  ok('…as a Priority, with where it came from in the note', !!rk && /From "Rep call\.m4a"/.test(rk.note), rk);
  ok('it is listed under his recordings', (await api('/api/team/recordings')).j.recordings.some((r) => r.id === up.j.id));
  await p.evaluate(async () => { await FlowTeam.load(true); FlowHud.open(); }); await p.waitForTimeout(1500);
  await p.evaluate(async () => { await FlowTeam.loadRecs(true); FlowHud.paint(); }); await p.waitForTimeout(500);
  const panel = await p.evaluate(() => { const P = document.querySelector('#flow-hud [data-k="recordings"]'); return P && { input: !!P.querySelector('input[type=file][data-team-rec]'), rows: [...P.querySelectorAll('.hud-pjt')].map((x) => x.textContent) }; });
  ok('his room has Recordings, with a way to add one and what each said', !!panel && panel.input && panel.rows.some((r) => /Rep call\.m4a/.test(r) && /On your week/.test(r)), panel);
  const acc = await p.evaluate(() => (document.querySelector('#flow-say #sy-file') || {}).accept || '');
  ok('the console\'s Document button takes audio and video too', /audio\/\*/.test(acc) && /video\/\*/.test(acc), acc);
  ok('no page errors', errs.length === 0, errs);
  await b.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
