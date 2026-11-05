/* From a document — a PDF, a photo of a page or a text, read into a to-do list.
 *
 * What would make it wrong: a file the model never saw (sent as prose instead
 * of a document block); a list that lands in the planner without the person
 * looking at it; an action other than "add this" slipping through (the
 * document route must never move, tick or delete anything); a date invented
 * rather than copied; a file type the app cannot read being sent anyway; the
 * free allowance refusing with an error instead of the Plus sheet; the door
 * missing from the + menu in Simple. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const X = require('../flow-extras.js')._internals.document;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

/* The smallest PDF that is one: a header, one empty page, a trailer. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const dataUrl = (type, buf) => 'data:' + type + ';base64,' + buf.toString('base64');
const isoWeek = () => { const d = new Date(); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0'); };

(async () => {
  console.log('\n— the file is looked at before anything else —');
  const pdf = X.unpack({ data: dataUrl('application/pdf', PDF), name: 'plan.pdf' });
  ok('a PDF goes up as a document block, as the model reads it', pdf.kind === 'document' && pdf.block.type === 'document' && pdf.block.source.media_type === 'application/pdf' && pdf.block.source.data === PDF.toString('base64'));
  const img = X.unpack({ data: dataUrl('image/jpeg', Buffer.from('notreallyajpeg')) });
  ok('a photo of the page goes up as an image', img.kind === 'image' && img.block.type === 'image' && img.block.source.media_type === 'image/jpeg');
  const txt = X.unpack({ data: dataUrl('text/plain', Buffer.from('1. Call the venue\n2. Send the deck')) });
  ok('a text file is read into the prompt as text', txt.kind === 'text' && /Call the venue/.test(txt.block.text) && /THE DOCUMENT/.test(txt.block.text));
  ok('a bare base64 body with a type works too', X.unpack({ data: PDF.toString('base64'), type: 'application/pdf' }).kind === 'document');
  const refuse = (body) => { try { X.unpack(body); return null; } catch (e) { return e.code; } };
  ok('nothing is a 400', refuse({ data: '' }) === 400 && refuse({}) === 400);
  ok('a kind the app cannot read is a 415, named', refuse({ data: dataUrl('application/zip', PDF) }) === 415 && refuse({ data: PDF.toString('base64'), type: 'application/msword' }) === 415);
  ok('over the limit is a 413', refuse({ data: dataUrl('application/pdf', Buffer.alloc(X.config().maxBase64, 1)) }) === 413);
  ok('an empty text file is a 400', refuse({ data: dataUrl('text/plain', Buffer.from('   ')) }) === 400);

  console.log('\n— what the model says is checked before anyone sees it —');
  const known = { today: '2026-11-05', rocks: [{ id: 'r1', title: 'Renew the insurance', date: '2026-11-03' }], habits: [{ id: 'h1', name: 'Cold shower' }] };
  const many = X.parse(JSON.stringify({ say: 'Lots.', actions: Array.from({ length: 50 }, (_, i) => ({ type: 'rock', title: 'Step ' + (i + 1), date: '2026-11-1' + (i % 9) })) }), known);
  ok('a document may run to thirty items, not twelve', many.actions.length === X.config().maxActions && X.config().maxActions === 30, many.actions.length);
  ok('and they keep the document\'s order', many.actions[0].title === 'Step 1' && many.actions[29].title === 'Step 30');
  const dated = X.parse(JSON.stringify({ actions: [{ type: 'rock', title: 'Undated' }, { type: 'rock', title: 'Bad', date: '5 November' }, { type: 'rock', title: 'Timed', date: '2026-11-12', time: '9:30', note: 'p. 2' }] }), known);
  ok('no date, or a date that is not one, is today — never a guess; a note and a time survive', dated.actions[0].date === '2026-11-05' && dated.actions[1].date === '2026-11-05' && dated.actions[2].time === '09:30' && dated.actions[2].note === 'p. 2', dated.actions);

  console.log('\n— the endpoint —');
  const calls = [];
  const reply = (text) => ({ status: 200, body: { content: [{ type: 'text', text }] } });
  X.setPoster(async (url, h, payload) => { calls.push(payload); return reply('{"say":"Three things; two undated went on today.","actions":[{"type":"rock","title":"Send the signed contract","date":"2026-11-12","note":"p. 2 · before launch"},{"type":"rock","title":"Book the hall"},{"type":"done","rock":"r1"},{"type":"move","rock":"r1","date":"2026-11-20"},{"type":"habit","name":"Stretch 10 minutes"},{"type":"open","page":"habits"}]}'); });
  const mk = (tier) => { const out = {}; return { out, res: {}, ctx: { json: (r, s, b) => { out.status = s; out.body = b; }, readBody: async () => out.req, plan: { tier: tier || 'plus' }, user: { id: 'u1' }, counter: { m: {}, get(k) { return this.m[k] || 0; }, set(k, v) { this.m[k] = v; } } } }; };
  process.env.ANTHROPIC_API_KEY = 'test';
  const a = mk(); a.out.req = JSON.stringify({ data: dataUrl('application/pdf', PDF), name: 'launch-plan.pdf', text: 'only the November items', lang: 'en', ctx: { today: '2026-11-05', rocks: [{ id: 'r1', title: 'Renew the insurance', date: '2026-11-03', note: 'SECRET NOTE' }], habits: [{ id: 'h1', name: 'Cold shower' }] } });
  await X.handle('/api/flow/document', { method: 'POST' }, a.res, a.ctx);
  ok('a document starts a job rather than holding the request', a.out.status === 202 && typeof a.out.body.job === 'string' && a.out.body.job.length === 24, a.out);
  await new Promise((r) => setTimeout(r, 30));
  ok('the model is sent the file itself, as a document block, then the ask', calls.length === 1 && Array.isArray(calls[0].messages[0].content) && calls[0].messages[0].content[0].type === 'document' && calls[0].messages[0].content[0].source.data === PDF.toString('base64') && calls[0].messages[0].content[1].type === 'text', calls[0] && calls[0].messages[0].content.map((c) => c.type));
  const sent = calls[0].messages[0].content[1].text;
  ok('with the calendar to copy dates from, the existing Priorities by title, and their instruction', /CALENDAR/.test(sent) && /Thursday 2026-11-05 \(today\)/.test(sent) && /Renew the insurance/.test(sent) && /only the November items/.test(sent) && /launch-plan\.pdf/.test(sent), sent.slice(0, 400));
  ok('never their notes', !/SECRET NOTE/.test(sent));
  ok('and a system prompt that forbids everything but adding', /Never use tick, move, done, open/.test(calls[0].system) && calls[0].max_tokens >= 2000);
  const g = mk(); g.ctx.user = { id: 'u1' };
  await X.handle('/api/flow/document', { method: 'GET', url: '/api/flow/document?job=' + a.out.body.job }, g.res, g.ctx);
  ok('the job answers done, with what to say and the list', g.out.status === 200 && g.out.body.status === 'done' && /Three things/.test(g.out.body.say) && g.out.body.name === 'launch-plan.pdf', g.out.body);
  const types = (g.out.body.actions || []).map((x) => x.type).join(',');
  ok('only rock and habit survive — done, move and open are dropped', types === 'rock,rock,habit', types);
  ok('a dated item keeps its date and note; an undated one is today', g.out.body.actions[0].date === '2026-11-12' && g.out.body.actions[0].note === 'p. 2 · before launch' && g.out.body.actions[1].date === '2026-11-05', g.out.body.actions);
  const other = mk(); other.ctx.user = { id: 'someone-else' };
  await X.handle('/api/flow/document', { method: 'GET', url: '/api/flow/document?job=' + a.out.body.job }, other.res, other.ctx);
  ok('another account cannot read the job', other.out.status === 404);
  const bad = mk(); bad.out.req = JSON.stringify({ data: dataUrl('application/zip', PDF) });
  await X.handle('/api/flow/document', { method: 'POST' }, bad.res, bad.ctx);
  ok('a file it cannot read is refused before any cost', bad.out.status === 415 && calls.length === 1 && bad.ctx.counter.m['docn:' + new Date().toISOString().slice(0, 10)] === undefined, bad.out);
  const f = mk('free'); f.ctx.counter.m['docw:' + isoWeek()] = X.config().free; f.out.req = JSON.stringify({ data: dataUrl('application/pdf', PDF) });
  await X.handle('/api/flow/document', { method: 'POST' }, f.res, f.ctx);
  ok('the free allowance ends in the Plus sheet, not an error', f.out.status === 402 && f.out.body.plus === true && f.out.body.feature === 'document', f.out);
  X.setPoster(async () => ({ status: 400, body: { error: { message: 'Could not process PDF: the document has more than 100 pages' } } }));
  const big = mk(); big.out.req = JSON.stringify({ data: dataUrl('application/pdf', PDF), name: 'book.pdf' });
  await X.handle('/api/flow/document', { method: 'POST' }, big.res, big.ctx);
  await new Promise((r) => setTimeout(r, 30));
  const bg = mk(); await X.handle('/api/flow/document', { method: 'GET', url: '/api/flow/document?job=' + big.out.body.job }, bg.res, bg.ctx);
  ok('a PDF the model cannot open is explained, not an upstream code', bg.out.body.status === 'error' && /scanned, locked, or over 100 pages/.test(bg.out.body.error), bg.out.body);
  X.setPoster(null);
  ok('other paths are not taken', (await X.handle('/api/flow/documents', { method: 'POST' }, {}, mk().ctx)) === false);

  console.log('\n— in the app —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  const errs = []; p.on('pageerror', (er) => errs.push(er.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => {
    const t = new Date(); const w = weekId(t), d = (t.getDay() + 6) % 7;
    cData.rocks[w] = (cData.rocks[w] || []).concat([{ id: 'ins1', title: 'Renew the insurance', day: d, prio: 'med', done: false }]);
    cSave();
    hbData.habits = [{ id: 'cs1', name: 'Cold shower' }]; hbData.completions = {}; S.set('habits', hbData);
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
  });
  await p.waitForTimeout(900);
  await p.evaluate(() => Flow.Nav.openCapture ? Flow.Nav.openCapture() : document.querySelector('#flow-tabbar .fn-cap').click()); await p.waitForTimeout(400);
  const caps = await p.evaluate(() => [...document.querySelectorAll('#fn-capgrid [data-fn-cap]')].slice(0, 2).map((x) => x.getAttribute('data-fn-cap') + ':' + x.textContent.trim()));
  ok('the + menu offers From a document, right after Say it', caps[0] === 'say:Say it' && caps[1] === 'doc:From a document', caps);
  await p.evaluate(() => { const w = document.getElementById('flow-capture'); if (w) w.classList.remove('on'); });

  const tomorrow = await p.evaluate(() => FlowSay.plusDays(1));
  const todayIso = await p.evaluate(() => FlowSay.plusDays(0));
  let posted = null, polls = 0;
  await p.route('**/api/flow/document**', async (rt) => {
    if (rt.request().method() === 'POST') {
      posted = JSON.parse(rt.request().postData() || '{}');
      return rt.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, job: 'j1' }) });
    }
    polls++;
    if (polls === 1) return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'working', seconds: 2 }) });
    rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'done', name: 'plan.pdf', say: 'Three Priorities and a habit; one undated went on today.', actions: [
      { type: 'rock', title: 'Send the signed contract', date: tomorrow, time: '10:00', note: 'p. 2 · before the launch' },
      { type: 'rock', title: 'Book the hall', date: todayIso, time: '', note: '' },
      { type: 'rock', title: 'Renew the insurance', date: todayIso, time: '', note: 'already in the app' },
      { type: 'habit', name: 'Stretch 10 minutes' }
    ] }) });
  });
  await p.evaluate(() => FlowSay.open({ quiet: true })); await p.waitForTimeout(400);
  ok('the sheet has a Document door and a file input that takes a PDF, a photo or a text', await p.evaluate(() => { const i = document.querySelector('#flow-say #sy-file'); const d = document.querySelector('#flow-say [data-say="doc"]'); return !!i && !!d && /pdf/.test(i.accept) && /image/.test(i.accept) && i.hidden; }));
  await p.setInputFiles('#flow-say #sy-file', { name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') }); await p.waitForTimeout(300);
  ok('a file it cannot read is turned away on the device, with no request', posted === null && /PDF, a photo of the page, or a text file/.test(await p.evaluate(() => document.querySelector('#flow-say .sy-state').textContent)));
  await p.fill('#sy-text', 'only the launch items');
  await p.setInputFiles('#flow-say #sy-file', { name: 'plan.pdf', mimeType: 'application/pdf', buffer: PDF });
  await p.waitForTimeout(600);
  ok('it says what it is doing while the job runs', /Reading plan\.pdf/.test(await p.evaluate(() => document.querySelector('#flow-say .sy-state').textContent)) && posted !== null);
  ok('what it sends: the file as a data URL, its name and type, the words in the box, and the context Say it sends', posted && /^data:application\/pdf;base64,/.test(posted.data) && posted.name === 'plan.pdf' && posted.type === 'application/pdf' && posted.text === 'only the launch items' && posted.lang === 'en' && posted.ctx.today === todayIso && posted.ctx.rocks.some((r) => r.id === 'ins1'), posted && Object.keys(posted));
  await p.waitForTimeout(4200);
  const cards = await p.evaluate(() => [...document.querySelectorAll('#flow-say .sy-card')].map((c) => c.querySelector('.sy-kind').textContent + '|' + (c.querySelector('.sy-note') ? c.querySelector('.sy-note').textContent : '')));
  ok('four cards: three Priorities with their notes, one habit', cards.length === 4 && /Priority · 10:00\|p\. 2/.test(cards[0]) && /^Priority\|$/.test(cards[1]) && /already in the app/.test(cards[2]) && /New habit/.test(cards[3]), cards);
  ok('the file is named above the list, and nothing has gone in yet', await p.evaluate(() => /plan\.pdf/.test(document.querySelector('#flow-say .sy-heard').textContent) && !cData.rocks[weekId(new Date())].some((r) => r.title === 'Book the hall') && !hbData.habits.some((h) => h.name === 'Stretch 10 minutes')));
  /* The person leaves out the one already there, and corrects a title. */
  await p.evaluate(() => { document.querySelectorAll('#flow-say .sy-card')[2].querySelector('[data-say="drop"]').click(); });
  await p.fill('#flow-say .sy-card input[data-sy-edit="title"]', 'Send the signed contract to Kao');
  ok('a card can be left out', await p.evaluate(() => document.querySelectorAll('#flow-say .sy-card').length === 3 && /\(3\)/.test(document.querySelector('[data-say="do"]').textContent)));
  await p.click('#flow-say [data-say="do"]'); await p.waitForTimeout(900);
  const after = await p.evaluate(() => {
    const all = []; Object.keys(cData.rocks).forEach((k) => (cData.rocks[k] || []).forEach((r) => all.push(Object.assign({ w: k }, r))));
    const c = all.find((r) => r.title === 'Send the signed contract to Kao'); const h = all.find((r) => r.title === 'Book the hall');
    return { contract: c && { time: c.time, note: c.note, day: c.day, w: c.w }, hall: !!h, dup: all.filter((r) => r.title === 'Renew the insurance').length,
      habit: hbData.habits.some((x) => x.name === 'Stretch 10 minutes'), sheet: !!document.querySelector('#flow-say.on'), tomorrowDay: (new Date(Date.now() + 864e5).getDay() + 6) % 7 };
  });
  ok('the Priorities land with their day, time and the note from the document', after.contract && after.contract.time === '10:00' && after.contract.note === 'p. 2 · before the launch' && after.contract.day === after.tomorrowDay && after.hall, after);
  ok('the one left out was not added twice, and the habit is there', after.dup === 1 && after.habit, after);
  ok('and the sheet is gone', !after.sheet);

  console.log('\n— from the + menu it opens straight into the picker, and only in Simple —');
  const fromMenu = await p.evaluate(() => {
    let clicked = 0;
    FlowSay.build(); const i = document.querySelector('#flow-say #sy-file'); const orig = i.click; i.click = () => { clicked++; };
    FlowSay.open({ file: true });
    const r = { open: !!document.querySelector('#flow-say.on'), clicked, listening: !!(window.FlowVoice && FlowVoice.listening) };
    i.click = orig; FlowSay.close();
    return r;
  });
  ok('the sheet opens with the picker, not the microphone', fromMenu.open && fromMenu.clicked === 1 && !fromMenu.listening, fromMenu);
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); });
  await p.evaluate(() => Flow.Nav.openCapture ? Flow.Nav.openCapture() : document.querySelector('#flow-tabbar .fn-cap').click()); await p.waitForTimeout(300);
  ok('Advanced has neither door', await p.evaluate(() => !document.querySelector('#fn-capgrid [data-fn-cap="doc"], #fn-capgrid [data-fn-cap="say"]')));

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
