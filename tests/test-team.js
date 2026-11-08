/* The team — J.A.R.V.I.S. and the agents he manages, in the command centre.
 *
 * What would make it wrong: no team on a fresh account, or one that cannot
 * be added to; an agent that forgets its thread or its memory when its model
 * is switched; a model offered that no key here can use; an agent given
 * tools it does not have, or claiming them; shared knowledge not reaching a
 * new agent, or an agent's own notes leaking to the others; memory that
 * cannot be inspected, edited or removed; a pause that does not stop every
 * agent; "Hey Sarah" going to J.A.R.V.I.S.; or the team showing up in
 * Advanced, where nothing new belongs. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const T = require('../flow-team.js')._internals;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const FAKE = `
window.__voiceLog = [];
window.SpeechRecognition = function () {
  var self = this; self.lang = ''; self.continuous = false; self.interimResults = false; self.maxAlternatives = 1;
  self.start = function () { window.__rec = self; window.__voiceLog.push('start'); };
  self.stop  = function () { window.__voiceLog.push('stop'); if (self.onend) self.onend(); };
  self.abort = function () { window.__voiceLog.push('abort'); if (self.onend) self.onend(); };
};
window.__say = function (text, isFinal) {
  var r = window.__rec; if (!r || !r.onresult) return;
  var results = [[{ transcript: text }]]; results[0].isFinal = !!isFinal; results.length = 1; results[0].length = 1;
  r.onresult({ resultIndex: 0, results: results });
};`;

(async () => {
  console.log('\n— the server: what an agent is told —');
  const sarah = T.fromTemplate('sarah', 'sarah');
  const sys = T.agentSystem(sarah, 'Artur', [{ id: 'k1', text: 'ABKO sells audio gear' }], [{ id: 'k2', text: 'Refunds within 14 days' }], 'en', ['Bobby (advertising)']);
  ok('an agent knows who it is, who runs the team, and who it answers to', /You are Sarah, the customer support on Artur's team/.test(sys) && /run by J\.A\.R\.V\.I\.S\./.test(sys) && /Bobby \(advertising\)/.test(sys));
  ok('it carries the shared knowledge and its own notes, with ids', /k1 \| ABKO sells audio gear/.test(sys) && /k2 \| Refunds within 14 days/.test(sys));
  ok('it is told, in words, exactly which tools it has (web reading; email only after a yes) and must never claim to have done something', /TOOLS YOU HAVE/.test(sys) && /read public web pages/.test(sys) && /Never claim something was sent/.test(sys) && /no inbox, no calendar, no accounts/.test(sys));
  const pr = T.parseReply('```json\n{"say":"Drafted it.","remember":[{"scope":"shared","fact":"Office is in Şişli"},{"scope":"mine","fact":"card 4111 1111 1111 1111"},{"scope":"x","fact":"Likes brief replies"}]}\n```');
  ok('a reply keeps its words and its memory; a card number never gets kept; a bad scope becomes its own', pr.say === 'Drafted it.' && pr.remember.length === 2 && pr.remember[0].scope === 'shared' && pr.remember[1].scope === 'mine' && pr.remember[1].fact === 'Likes brief replies', pr);
  ok('a model that forgot the shape is still heard', T.parseReply('Just plain words.').say === 'Just plain words.');
  ok('the five starters and the chief of staff are templates; Add agent has more', T.STARTER_IDS.length === 6 && T.TEMPLATE_IDS.indexOf('general') === 0 && T.TEMPLATES.bobby.role === 'Advertising');

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  await ctx.addInitScript(FAKE);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  const dos = [];
  await p.route('**/api/flow/do', (rt) => { const j = JSON.parse(rt.request().postData() || '{}'); dos.push(j); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, say: 'Done that, sir.', actions: [] }) }); });
  await p.evaluate(async () => {
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false);
  });
  await p.waitForTimeout(1500);

  console.log('\n— the team is there —');
  const team = await p.evaluate(async () => { const r = await fetch('/api/team', { credentials: 'same-origin' }); return r.json(); });
  ok('a fresh account has J.A.R.V.I.S. and five starters', team.ok && team.agents.length === 6 && team.agents[0].id === 'jarvis' && team.agents.map((a) => a.name).join(',') === 'J.A.R.V.I.S.,Bobby,Sarah,Tom,Hiring assistant,Finance assistant', team.agents && team.agents.map((a) => a.name));
  ok('only providers with a key here offer models; the rest say what is missing', team.providers.filter((x) => x.configured).map((x) => x.id).join(',') === 'anthropic,openai' && team.providers.find((x) => x.id === 'xai').models.length === 0 && team.providers.find((x) => x.id === 'xai').env === 'XAI_API_KEY', team.providers);
  ok('nothing is known yet, and nothing is paused', team.knowledge.length === 0 && team.paused === false);
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  const rail = await p.evaluate(() => ({ chips: [...document.querySelectorAll('#flow-hud .hud-team .hud-ag[data-ag]')].map((x) => x.querySelector('.hud-agn').textContent), add: !!document.querySelector('#flow-hud .hud-add'), pause: !!document.querySelector('#flow-hud .hud-pause'), sel: (document.querySelector('#flow-hud .hud-ag.sel') || {}).getAttribute && document.querySelector('#flow-hud .hud-ag.sel').getAttribute('data-ag'), st: [...document.querySelectorAll('#flow-hud .hud-team .hud-st')].map((x) => x.getAttribute('data-st')) }));
  ok('the command centre shows the team under the clock: name, role, model, status', rail.chips.length === 6 && rail.add && rail.pause && rail.sel === 'jarvis' && rail.st.every((s) => s === 'available'), rail);
  ok('on his own view, his model and the shared knowledge sit under the day', await p.evaluate(() => !!document.querySelector('#flow-hud [data-k="jmodel"] select[data-team-model="jarvis"]') && !!document.querySelector('#flow-hud [data-k="know"] form[data-team="kadd"]')));

  console.log('\n— talking to one of them —');
  await p.click('#flow-hud .hud-ag[data-ag="sarah"]'); await p.waitForTimeout(700);
  const ws = await p.evaluate(() => ({ brand: document.querySelector('#flow-hud .hud-brand b').textContent, role: document.querySelector('#flow-hud .hud-brand span').textContent, k: document.querySelector('#flow-say .sy-k').textContent, agent: FlowSay.agent,
    panels: [...document.querySelectorAll('#flow-hud .hud-p')].map((x) => x.getAttribute('data-k')), tools: (document.querySelector('#flow-hud [data-k="tools"]') || {}).textContent || '', sel: document.querySelector('#flow-hud .hud-ag.sel').getAttribute('data-ag') }));
  ok('choosing Sarah makes the room hers and the console her conversation', ws.brand === 'Sarah' && ws.role === 'Customer support' && ws.k === 'Sarah' && ws.agent === 'sarah' && ws.sel === 'sarah', ws);
  ok('her workspace: agent, instructions, tools, memory, what the team knows, activity', ['agent', 'instr', 'tools', 'memory', 'know', 'activity'].every((k) => ws.panels.indexOf(k) >= 0), ws.panels);
  ok('tools are listed truthfully: web reading works, email goes only after a yes, each with its status', /read public web pages/.test(ws.tools) && /approve/.test(ws.tools) && /Web reader/.test(ws.tools) && /Working/.test(ws.tools), ws.tools);
  await p.fill('#flow-say #sy-text', 'Remember that the team answers support within one business day.');
  await p.click('#flow-say [data-say="send"]'); await p.waitForTimeout(1500);
  const t1 = await p.evaluate(() => ({ log: [...document.querySelectorAll('#flow-say .sy-log .sy-b')].map((x) => x.textContent), know: [...document.querySelectorAll('#flow-hud [data-k="know"] .hud-k > span:first-child')].map((x) => x.textContent), dos: 0 }));
  ok('she answers from her own model, not through his engine', t1.log.length === 2 && /^claude-sonnet-4-5 says: Remember that/.test(t1.log[1]) && dos.length === 0, t1);
  ok('what she was told to remember for the team is now shared knowledge, with its source', t1.know.indexOf('the team answers support within one business day') >= 0 && await p.evaluate(() => /Sarah/.test(document.querySelector('#flow-hud [data-k="know"] .hud-k small').textContent)), t1.know);
  await p.fill('#flow-say #sy-text', 'Remember that I prefer short replies.');
  await p.click('#flow-say [data-say="send"]'); await p.waitForTimeout(1500);
  const mem = await p.evaluate(() => [...document.querySelectorAll('#flow-hud [data-k="memory"] .hud-k > span:first-child')].map((x) => x.textContent));
  ok('a note for herself goes in her own memory, not the team\'s', mem.indexOf('I prefer short replies') >= 0 && await p.evaluate(() => ![...document.querySelectorAll('#flow-hud [data-k="know"] .hud-k > span:first-child')].some((x) => /short replies/.test(x.textContent))), mem);

  console.log('\n— switching the model keeps everything —');
  await p.selectOption('#flow-hud select[data-team-model="sarah"]', 'gpt-5'); await p.waitForTimeout(900);
  const sw = await p.evaluate(async () => { const r = await (await fetch('/api/team', { credentials: 'same-origin' })).json(); const s = r.agents.find((a) => a.id === 'sarah'); const th = await (await fetch('/api/team/thread?agent=sarah', { credentials: 'same-origin' })).json(); return { model: s.model, provider: s.provider, instr: s.instructions, msgs: th.messages.length, know: r.knowledge.length, chip: document.querySelector('#flow-hud .hud-ag[data-ag="sarah"] small').textContent, log: r.log.slice(-1)[0].what }; });
  ok('Sarah now thinks with gpt-5 (OpenAI), and the chip says so', sw.model === 'gpt-5' && sw.provider === 'openai' && /gpt-5/.test(sw.chip), sw);
  ok('her instructions, her thread and the knowledge are exactly as they were', /customers/.test(sw.instr) && sw.msgs === 4 && sw.know === 2, sw);
  ok('the switch is in the activity log', /model → gpt-5/.test(sw.log), sw.log);
  await p.fill('#flow-say #sy-text', 'And what did I ask you to keep in mind?');
  await p.click('#flow-say [data-say="send"]'); await p.waitForTimeout(1500);
  const t2 = await p.evaluate(async () => { const th = await (await fetch('/api/team/thread?agent=sarah', { credentials: 'same-origin' })).json(); return { last: th.messages.slice(-1)[0], n: th.messages.length, log: [...document.querySelectorAll('#flow-say .sy-log .sy-b')].length }; });
  ok('the next answer comes from the new model, on the same thread', /^gpt-5 says:/.test(t2.last.text) && t2.last.model === 'gpt-5' && t2.n === 6 && t2.log === 6, t2);
  const bad = await p.evaluate(async () => { const r = await fetch('/api/team/agent/update', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'sarah', model: 'grok-4' }) }); return { status: r.status, j: await r.json() }; });
  ok('a model whose provider has no key is refused, and says why', bad.status === 400 && /no key/.test(bad.j.error), bad);

  console.log('\n— memory you can see, change and remove —');
  await p.click('#flow-hud [data-k="memory"] [data-hud="kedit"]'); await p.waitForTimeout(300);
  await p.fill('#flow-hud [data-k="memory"] form[data-team="kedit"] input', 'I prefer replies of two lines');
  await p.click('#flow-hud [data-k="memory"] form[data-team="kedit"] button[type="submit"]'); await p.waitForTimeout(700);
  const ed = await p.evaluate(() => [...document.querySelectorAll('#flow-hud [data-k="memory"] .hud-k')].map((x) => x.querySelector('span').textContent + ' | ' + x.querySelector('small').textContent));
  ok('an edit takes, and the entry is now marked as yours', ed.length === 1 && /^I prefer replies of two lines \| you/.test(ed[0]), ed);
  await p.fill('#flow-hud [data-k="know"] form[data-team="kadd"] input', 'ABKO is in Istanbul');
  await p.click('#flow-hud [data-k="know"] form[data-team="kadd"] button'); await p.waitForTimeout(700);
  await p.click('#flow-hud [data-k="memory"] [data-hud="kdrop"]'); await p.waitForTimeout(700);
  const k3 = await p.evaluate(async () => { const r = await (await fetch('/api/team', { credentials: 'same-origin' })).json(); return r.knowledge.map((k) => k.scope + ':' + k.text + ':' + k.source); });
  ok('a fact added by hand is shared and yours; a removed note is gone', k3.length === 2 && k3.some((k) => k === 'shared:ABKO is in Istanbul:you') && !k3.some((k) => /two lines/.test(k)), k3);

  console.log('\n— a new agent, three steps —');
  await p.click('#flow-hud .hud-add'); await p.waitForTimeout(500);
  await p.fill('#flow-hud form[data-team="add"] input[name="name"]', 'Nadia');
  await p.selectOption('#flow-hud form[data-team="add"] select[name="template"]', 'research');
  await p.click('#flow-hud form[data-team="add"] button[type="submit"]'); await p.waitForTimeout(1200);
  const nw = await p.evaluate(() => ({ chips: [...document.querySelectorAll('#flow-hud .hud-team .hud-ag[data-ag]')].map((x) => x.querySelector('.hud-agn').textContent), brand: document.querySelector('#flow-hud .hud-brand b').textContent, role: document.querySelector('#flow-hud .hud-brand span').textContent, know: [...document.querySelectorAll('#flow-hud [data-k="know"] .hud-k > span:first-child')].map((x) => x.textContent), mem: document.querySelectorAll('#flow-hud [data-k="memory"] .hud-k').length }));
  ok('Nadia is in the strip and her workspace is open', nw.chips.indexOf('Nadia') === 6 && nw.brand === 'Nadia' && nw.role === 'Research', nw);
  ok('she already sees what the team knows, and nothing of Sarah\'s own notes', nw.know.length === 2 && nw.mem === 0, nw);
  await p.fill('#flow-say #sy-text', 'Where is the company?');
  await p.click('#flow-say [data-say="send"]'); await p.waitForTimeout(1500);
  ok('and she is told it when asked (the brief she is sent carries it)', await p.evaluate(async () => { const th = await (await fetch('/api/team/thread?agent=' + FlowSay.agent, { credentials: 'same-origin' })).json(); return th.messages.length === 2; }));

  console.log('\n— "Hey Sarah" —');
  await p.evaluate(async () => { await Flow.Settings.set('asstWake', true); FlowWake.tick(); }); await p.waitForTimeout(500);
  await p.evaluate(() => window.__say('hey sarah draft a reply to the refund question over', true)); await p.waitForTimeout(1800);
  const hs = await p.evaluate(() => ({ agent: FlowSay.agent, brand: document.querySelector('#flow-hud .hud-brand b').textContent, last: [...document.querySelectorAll('#flow-say .sy-log .sy-b')].slice(-1)[0].textContent }));
  ok('her name opens her, and "over" sends it to her', hs.agent === 'sarah' && hs.brand === 'Sarah' && /says: draft a reply to the refund question$/.test(hs.last), hs);
  await p.waitForTimeout(2800);
  await p.evaluate(() => window.__say('hey jarvis what is left today over', true)); await p.waitForTimeout(1500);
  ok('his name brings it back to him', await p.evaluate(() => FlowSay.agent === null && document.querySelector('#flow-hud .hud-brand b').textContent === 'J.A.R.V.I.S.') && dos.length === 1, { dos: dos.length });
  await p.evaluate(async () => { await Flow.Settings.set('asstWake', false); FlowWake.tick(); });

  console.log('\n— the emergency stop —');
  await p.click('#flow-hud .hud-pause'); await p.waitForTimeout(800);
  const pz = await p.evaluate(async () => { const r = await fetch('/api/team/say', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'sarah', text: 'hello' }) }); return { status: r.status, st: [...document.querySelectorAll('#flow-hud .hud-team .hud-st')].map((x) => x.getAttribute('data-st')) }; });
  ok('paused: no agent answers, and every chip says so', pz.status === 423 && pz.st.every((s) => s === 'paused'), pz);
  await p.click('#flow-hud .hud-pause'); await p.waitForTimeout(800);
  ok('resumed', await p.evaluate(() => [...document.querySelectorAll('#flow-hud .hud-team .hud-st')].every((x) => x.getAttribute('data-st') === 'available')));
  const noj = await p.evaluate(async () => { const r = await fetch('/api/team/agent/update', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'jarvis', archived: true }) }); return r.status; });
  ok('J.A.R.V.I.S. cannot be archived', noj === 400);

  console.log('\n— closing, and Advanced —');
  await p.evaluate(() => FlowHud.close()); await p.waitForTimeout(300);
  ok('closing the room hands the console back to him', await p.evaluate(() => FlowSay.agent === null));
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); FlowTodayLook.applyLook(); });
  await p.waitForTimeout(300);
  ok('no command centre, no team, in Advanced', await p.evaluate(() => { FlowHud.open(); return !FlowHud.on; }));

  ok('no page errors', errs.length === 0, errs);
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
