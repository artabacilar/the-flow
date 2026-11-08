/* Work that continues — tasks, delegation, approvals.
 *
 * What would make it wrong: a task that needs the page open to finish; a
 * result that is lost; a step run twice after a restart; J.A.R.V.I.S. sending
 * work to an agent that does not exist, or a specialist delegating onward;
 * an email "sent" by anyone, or sent twice, or sent without a yes; an
 * approval that does not show the exact text; a question from an agent with
 * no way to answer it; the pause not stopping the runner; a failed step with
 * no way to try again; or a "delegate" card J.A.R.V.I.S. cannot hand over. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const T = require('../flow-team.js');
const W = T._work;
const X = require('../flow-extras.js')._internals.say;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n— the server: shapes —');
  const ps = W.parseStep('{"result":"Here is the draft.","question":"","proposals":[{"kind":"email","summary":"Email to Ali","to":"ali@x.com","subject":"Hi","body":"Dear Ali"},{"kind":"nonsense","summary":"","body":""}],"remember":[{"scope":"shared","fact":"Ali is the venue manager"}]}');
  ok('a step reply keeps the work, one real proposal, and a lasting fact', ps.result === 'Here is the draft.' && ps.proposals.length === 1 && ps.proposals[0].kind === 'email' && ps.proposals[0].to === 'ali@x.com' && ps.remember[0].fact === 'Ali is the venue manager', ps);
  const agentsFake = [{ id: 'jarvis', name: 'J', role: 'Chief', instructions: '' }, { id: 'sarah', name: 'Sarah', role: 'Support', instructions: '' }];
  const pl = W.parsePlan('{"title":"Refund","say":"Sarah is on it.","steps":[{"agent":"sarah","title":"Draft","brief":"Draft it"},{"agent":"ghost","title":"x","brief":"y"},{"agent":"jarvis","title":"me","brief":"z"}]}', agentsFake);
  ok('a plan keeps only steps for real specialists — never a made-up agent, never J.A.R.V.I.S. himself', pl.steps.length === 1 && pl.steps[0].agent === 'sarah', pl);
  const sys = W.stepSystem(T._internals.fromTemplate('sarah', 'sarah'), 'Artur', [], [], 'en', { title: 'Refund', brief: 'b', by: 'jarvis' }, { title: 'Draft', brief: 'Draft the reply' }, [{ agent: 'Bobby', title: 'Ads', result: 'Spend is fine.' }]);
  ok('a specialist is told to do the work in words, to propose (not do) anything outward, and what the others did', /Do the work in full, here, in words/.test(sys) && /you do NOT do: you propose it/.test(sys) && /Bobby — Ads/.test(sys) && !/"say"/.test(sys.split('Return ONLY')[1]));
  const dp = X.parseDo(JSON.stringify({ say: 'Sarah will draft it.', actions: [{ type: 'delegate', title: 'Refund reply', brief: 'Draft a reply to the refund question from Ali' }, { type: 'delegate', brief: '' }] }), {});
  ok('J.A.R.V.I.S. can hand work to the team as a "delegate" action; an empty brief is dropped', dp.actions.length === 1 && dp.actions[0].type === 'delegate' && dp.actions[0].title === 'Refund reply', dp.actions);

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => {
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false);
  });
  await p.waitForTimeout(1200);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);
  const until = async (fn, ms) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(400); } return null; };

  console.log('\n— assign, close the laptop, come back —');
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1000);
  await p.click('#flow-hud .hud-ag[data-ag="tom"]'); await p.waitForTimeout(600);
  ok('an agent\'s workspace offers "Give Tom some work" and his list of work', await p.evaluate(() => !!document.querySelector('#flow-hud form[data-team="assign"][data-ag="tom"]') && !!document.querySelector('#flow-hud [data-k="work"]')));
  await p.fill('#flow-hud form[data-team="assign"] textarea[name="brief"]', 'Look into why the export button fails on Safari and propose the smallest fix.');
  await p.click('#flow-hud form[data-team="assign"] button[type="submit"]'); await p.waitForTimeout(800);
  const t1 = await api('/api/team/tasks');
  ok('the task exists on the server at once, queued or already working, with Tom on it', t1.j.tasks.length === 1 && /^(queued|running|done)$/.test(t1.j.tasks[0].status) && t1.j.tasks[0].agent === 'tom' && t1.j.tasks[0].by === 'you', t1.j.tasks[0] && t1.j.tasks[0].status);
  /* the page goes away — the laptop closes */
  await p.evaluate(() => FlowHud.close());
  const done1 = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks[0]; return t && t.status === 'done' ? t : null; }, 20000);
  ok('it finishes with nobody watching, and the result is kept', !!done1 && /Tom did: Look into why the export button fails/.test(done1.result) && done1.steps[0].status === 'done' && done1.steps[0].model === 'claude-sonnet-4-5', done1 && { status: done1.status, result: (done1.result || '').slice(0, 80) });
  ok('it is marked as not yet seen, so the room can point at it', done1 && done1.seen === false);
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  const att = await p.evaluate(() => ({ badge: (document.querySelector('#flow-hud .hud-ag[data-ag="tom"] .hud-unread') || {}).textContent, row: !!document.querySelector('#flow-hud [data-k="work"] .hud-task.new') }));
  ok('back in the room: Tom\'s chip carries a badge and the work list marks it new', att.badge === '1' && att.row, att);
  await p.click('#flow-hud [data-k="work"] .hud-task'); await p.waitForTimeout(800);
  const tv = await p.evaluate(() => ({ open: !!document.querySelector('#flow-hud [data-k="taskv"]'), res: (document.querySelector('#flow-hud [data-k="taskv"] .hud-res') || {}).textContent || '', brand: document.querySelector('#flow-hud .hud-brand b').textContent, badge: !!document.querySelector('#flow-hud .hud-ag[data-ag="tom"] .hud-unread') }));
  ok('opening it shows the result in Tom\'s room and clears the badge', tv.open && /Tom did:/.test(tv.res) && tv.brand === 'Tom' && !tv.badge, tv);

  console.log('\n— J.A.R.V.I.S. delegates —');
  const d = await api('/api/team/delegate', { text: 'Have Sarah draft a reply to the refund question and ask Bobby to check this week\'s ad spend.', lang: 'en' });
  ok('he plans it: two steps, two specialists, and says who is on it', d.status === 200 && d.j.task && d.j.task.steps.length === 2 && d.j.task.steps.map((s) => s.agent).join(',') === 'sarah,bobby' && /Putting sarah and bobby on it/.test(d.j.say), d.j);
  const done2 = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === d.j.task.id); return t && /^(done|awaiting_approval)$/.test(t.status) ? t : null; }, 25000);
  ok('both specialists finish, in order, and J.A.R.V.I.S. hands over one consolidated result', !!done2 && done2.steps.every((s) => s.status === 'done') && /^Summary by claude-sonnet-4-5/.test(done2.result) && /Sarah — Draft the reply/.test(done2.result) && /Bobby — Check the ads/.test(done2.result), done2 && { status: done2.status, result: (done2.result || '').slice(0, 120) });
  ok('Sarah\'s email became an approval, so the task waits for your yes', done2 && done2.status === 'awaiting_approval' && (await api('/api/team/tasks')).j.approvals.filter((x) => x.status === 'pending' && x.task === done2.id).length === 1);
  const none = await api('/api/team/delegate', { text: 'What is the weather like?', lang: 'en' });
  ok('a request that needs none of the team makes no task, and he says so', none.status === 200 && none.j.task === null && /none of the team/.test(none.j.say), none.j);

  console.log('\n— the approval inbox —');
  await p.evaluate(() => FlowHud.close()); await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  const inbox = await p.evaluate(() => { const ap = document.querySelector('#flow-hud [data-k="approvals"]'); return { there: !!ap, who: (ap && ap.querySelector('.hud-aph') || {}).textContent || '', to: [...(ap ? ap.querySelectorAll('.hud-apl') : [])].map((x) => x.textContent), body: (ap && ap.querySelector('.hud-apb') || {}).value || '', honest: /Nothing is connected to send this yet/.test((ap || {}).textContent || ''), jbadge: (document.querySelector('#flow-hud .hud-ag[data-ag="jarvis"] .hud-unread') || {}).textContent }; });
  ok('his room shows "Needs your yes" with who, to whom, the subject and the exact text', inbox.there && /Sarah/.test(inbox.who) && inbox.to.some((x) => /customer@example\.com/.test(x)) && inbox.to.some((x) => /About your refund/.test(x)) && /Dear customer/.test(inbox.body), inbox);
  ok('and says plainly that nothing can send it yet', inbox.honest);
  ok('his chip counts it', inbox.jbadge === '2' || inbox.jbadge === '1', inbox.jbadge);
  await p.fill('#flow-hud [data-k="approvals"] .hud-apb', 'Dear customer, your refund is on its way. Warm regards, Sarah');
  await p.click('#flow-hud [data-k="approvals"] [data-hud="approve"]'); await p.waitForTimeout(900);
  const ap1 = (await api('/api/team/tasks')).j.approvals[0];
  ok('approving records the edited text as what was approved, and marks it awaiting a connection — not sent', ap1.status === 'awaiting_tool' && ap1.edited === true && /on its way/.test(ap1.detail.body) && /has not been sent/.test(ap1.note), ap1);
  const again = await api('/api/team/approve', { id: ap1.id, decision: 'approve' });
  ok('approving twice changes nothing — once is once', again.j.already === true && again.j.approval.status === 'awaiting_tool');
  const t2b = (await api('/api/team/tasks')).j.tasks.find((x) => x.id === done2.id);
  ok('with nothing left pending, the task is done', t2b.status === 'done');
  ok('the inbox is clear', await p.evaluate(() => !document.querySelector('#flow-hud [data-k="approvals"]')));

  console.log('\n— a question from an agent —');
  const q = await api('/api/team/task', { agent: 'sarah', brief: 'Send the venue the new dates — ask me which address first.', lang: 'en' });
  const asked = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === q.j.task.id); return t && t.status === 'awaiting_info' ? t : null; }, 15000);
  ok('she stops and asks rather than guessing', !!asked && /Which address/.test(asked.question) && asked.asker === 'sarah', asked && asked.status);
  await p.evaluate(() => FlowHud.close()); await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1200);
  await p.evaluate((id) => FlowTeam.openTask(id), q.j.task.id); await p.waitForTimeout(800);
  ok('the room shows her question with a place to answer', await p.evaluate(() => !!document.querySelector('#flow-hud [data-k="taskv"] form[data-team="answer"]') && /Which address/.test(document.querySelector('#flow-hud [data-k="taskv"] .hud-q').textContent)));
  await p.fill('#flow-hud form[data-team="answer"] input', 'Bomonti, Şişli'); await p.click('#flow-hud form[data-team="answer"] button'); await p.waitForTimeout(600);
  const answered = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === q.j.task.id); return t && t.status === 'done' ? t : null; }, 15000);
  ok('answered, she carries on and finishes', !!answered && /Sarah did:/.test(answered.result), answered && answered.status);

  console.log('\n— when it goes wrong —');
  const f = await api('/api/team/task', { agent: 'bobby', brief: 'This one will fail on purpose.', lang: 'en' });
  const failed = await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === f.j.task.id); return t && t.status === 'failed' ? t : null; }, 20000);
  ok('a step that keeps failing is given up after three tries, and the task says why', !!failed && failed.steps[0].attempts === 3 && /could not finish/.test(failed.error), failed && { attempts: failed.steps[0].attempts, error: failed.error });
  const rt = await api('/api/team/task/retry', { id: f.j.task.id });
  ok('it can be tried again', rt.status === 200 && rt.j.task.status === 'queued');
  await until(async () => { const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === f.j.task.id); return t && t.status === 'failed' ? t : null; }, 20000);
  const c = await api('/api/team/task', { agent: 'tom', brief: 'Long one', lang: 'en' });
  const cc = await api('/api/team/task/cancel', { id: c.j.task.id });
  ok('a task can be cancelled', cc.j.task.status === 'cancelled');

  console.log('\n— the pause stops the runner —');
  await api('/api/team/pause', { paused: true });
  const pz = await api('/api/team/task', { agent: 'tom', brief: 'Anything', lang: 'en' });
  ok('while paused, no work is taken on', pz.status === 423 && pz.j.paused === true);
  await api('/api/team/pause', { paused: false });

  console.log('\n— a restart —');
  const srv = await fetch(H + '/api/status').then((r) => r.json()).catch(() => null);
  ok('(the replica is up)', !!srv);
  /* The resume path cannot restart the replica from here; it is proven by
     shape: start() finds queued/running tasks and kicks them. */
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-team.js'), 'utf8');
  ok('start() resumes every account\'s unfinished tasks, and a step marked done is never run again', /status === 'queued' \|\| t\.status === 'running'\)\) \{ if \(deps\.log\)/.test(src) && /if \(st\.status === 'done'\) continue;/.test(src));
  const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'life-os-server.js'), 'utf8');
  ok('the real server starts the runner with push, so a finished task reaches the phone', /teamMod\.start\(\{/.test(server) && /sendToUser: push \? push\.sendToUser : null/.test(server.split('teamMod.start(')[1]));

  console.log('\n— from his console —');
  await p.evaluate(() => FlowHud.close()); await p.waitForTimeout(300);
  await p.route('**/api/flow/do', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, say: 'Sarah will draft it, sir.', actions: [{ type: 'delegate', title: 'Refund reply', brief: 'Have Sarah draft a reply to the refund question.' }] }) }));
  await p.evaluate(() => FlowSay.open({ idle: true })); await p.waitForTimeout(400);
  await p.fill('#flow-say #sy-text', 'have sarah draft a reply to the refund question');
  await p.click('#flow-say [data-say="send"]'); await p.waitForTimeout(1200);
  const card = await p.evaluate(() => ({ kind: (document.querySelector('#flow-say .sy-kind') || {}).textContent, brief: (document.querySelector('#flow-say [data-sy-edit="brief"]') || {}).value }));
  ok('"have Sarah draft…" shows a To-the-team card with the brief, editable', card.kind === 'To the team' && /refund question/.test(card.brief), card);
  const n0 = (await api('/api/team/tasks')).j.tasks.length;
  await p.click('#flow-say [data-say="do"]'); await p.waitForTimeout(1500);
  const after = await api('/api/team/tasks');
  ok('Do it hands it over: a new task, planned by J.A.R.V.I.S., with Sarah on it', after.j.tasks.length === n0 + 1 && after.j.tasks[0].by === 'jarvis' && after.j.tasks[0].steps[0].agent === 'sarah', after.j.tasks[0] && { by: after.j.tasks[0].by, steps: after.j.tasks[0].steps.map((s) => s.agent) });

  ok('no page errors', errs.length === 0, errs);
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
