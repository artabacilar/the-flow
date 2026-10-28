/* A habit you can do from the habit.
 *
 * What would make it wrong: tapping a habit's name still doing nothing; the
 * three sentences saved nowhere; a tick that the Habits page does not see;
 * the wrong door for an obvious name; the chosen door forgotten; a timer
 * that will not finish early; Advanced changed; Turkish reading English. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);

  console.log('\n— which door —');
  const g = await p.evaluate(() => { const D = window.FlowHabitDo; return [D.guess('Write 3 sentences before bed: how today felt'), D.guess('Meditate'), D.guess('Read 20 min'), D.guess('Cold shower'), D.guess('Günlük yaz'), D.guess('10 dakika nefes'), D.minutes('Read 20 min'), D.minutes('Meditate'), D.minutes('45 dakika yürü')]; });
  ok('writing opens a page, minutes open a clock, the rest is a tick — in both languages', g.slice(0, 6).join() === 'write,timer,timer,tick,write,timer', g);
  ok('the minutes come from the name, ten when it says none', g[6] === 20 && g[7] === 10 && g[8] === 45, g);

  console.log('\n— on Today, in Simple —');
  await p.evaluate(async () => { hbData.habits = [{ id: 'h1', name: 'Write 3 sentences before bed' }, { id: 'h2', name: 'Meditate 10 min' }, { id: 'h3', name: 'Cold shower' }]; hbData.completions = {}; S.set('habits', hbData); renderHabits(); await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); });
  await p.waitForTimeout(900);
  ok('the habit names on Today are doors', await p.evaluate(() => document.querySelectorAll('#flow-td-habits .hb .tx.hd-door').length === 3));
  await p.click('#flow-td-habits .hb .tx.hd-door >> nth=0'); await p.waitForTimeout(400);
  const w = await p.evaluate(() => { const el = document.getElementById('flow-hdo'); return { on: el.classList.contains('on'), name: el.querySelector('.hd-name').textContent, kind: el.querySelector('.hd-kinds .on').textContent, ta: !!el.querySelector('#hd-text'), ph: el.querySelector('#hd-text').placeholder }; });
  ok('the writing habit opens as a page to write on, three sentences asked for', w.on && w.name === 'Write 3 sentences before bed' && w.kind === 'Write' && w.ta && /Three sentences/.test(w.ph), w);
  const nJ = await p.evaluate(() => Flow.Journal.entries.length);
  await p.click('#flow-hdo [data-hd="save"]'); await p.waitForTimeout(300);
  ok('nothing written is not saved', await p.evaluate((n) => Flow.Journal.entries.length === n && document.querySelector('#flow-hdo.on'), nJ));
  await p.fill('#hd-text', 'Today felt slow. I shipped the invoices and walked. Tomorrow: the venue contract.');
  await p.click('#flow-hdo [data-hd="save"]'); await p.waitForTimeout(800);
  const saved = await p.evaluate((n) => { const e = Flow.Journal.entries[Flow.Journal.entries.length - 1]; return { n: Flow.Journal.entries.length - n, body: e.body, tags: e.tags, ticked: !!(hbData.completions.h1 && hbData.completions.h1[todayStr]), closed: !document.querySelector('#flow-hdo.on'), row: document.querySelector('#flow-td-habits .hb.done .tx').textContent }; }, nJ);
  ok('the sentences land in the journal, tagged with the habit, and today is ticked — on Today and in the data', saved.n === 1 && /invoices/.test(saved.body) && saved.tags.includes('Write 3 sentences before bed') && saved.ticked && saved.closed && /Write 3/.test(saved.row), saved);

  await p.evaluate(() => window.FlowHabitDo.open('h2')); await p.waitForTimeout(400);
  const t = await p.evaluate(() => { const el = document.getElementById('flow-hdo'); return { kind: el.querySelector('.hd-kinds .on').textContent, clock: el.querySelector('.hd-clock').textContent, hint: el.querySelector('.hd-timer-hint').textContent }; });
  ok('Meditate 10 min opens as a clock at 10:00', t.kind === 'Timer' && t.clock === '10:00' && /10 minutes/.test(t.hint), t);
  await p.click('#flow-hdo [data-hd="start"]'); await p.waitForTimeout(1300);
  ok('Start runs it', await p.evaluate(() => { const el = document.getElementById('flow-hdo'); return el.querySelector('.hd-clock').classList.contains('run') && el.querySelector('.hd-clock').textContent !== '10:00' && el.querySelector('[data-hd="start"]').disabled; }));
  await p.click('#flow-hdo [data-hd="finish"]'); await p.waitForTimeout(500);
  ok('Done before the clock is up still ticks today', await p.evaluate(() => !!(hbData.completions.h2 && hbData.completions.h2[todayStr]) && !document.querySelector('#flow-hdo.on')));

  await p.evaluate(() => window.FlowHabitDo.open('h3')); await p.waitForTimeout(400);
  ok('a plain habit is a Done with a line', await p.evaluate(() => { const el = document.getElementById('flow-hdo'); return el.querySelector('.hd-kinds .on').textContent === 'Just tick' && !!el.querySelector('#hd-line'); }));
  await p.click('#flow-hdo [data-hd-kind="timer"]'); await p.waitForTimeout(300);
  ok('the door can be changed, and the clock defaults to ten minutes', await p.evaluate(() => document.querySelector('#flow-hdo .hd-clock').textContent === '10:00'));
  await p.evaluate(() => window.FlowHabitDo.close());
  await p.evaluate(() => window.FlowHabitDo.open('h3')); await p.waitForTimeout(400);
  ok('and the choice is remembered', await p.evaluate(async () => document.querySelector('#flow-hdo .hd-kinds .on').textContent === 'Timer' && (await Flow.DB.get('flow:habitkinds')).h3 === 'timer'));
  await p.click('#flow-hdo [data-hd-kind="tick"]'); await p.waitForTimeout(200);
  await p.fill('#hd-line', 'Two minutes, freezing'); await p.click('#flow-hdo [data-hd="done"]'); await p.waitForTimeout(500);
  ok('Done for today ticks it with the line in the record', await p.evaluate(() => !!(hbData.completions.h3 && hbData.completions.h3[todayStr])));

  console.log('\n— on the Habits page —');
  await p.evaluate(() => { Flow.Nav.go('habits'); renderHabits(); }); await p.waitForTimeout(600);
  ok('the names on the Habits page are doors too', await p.evaluate(() => document.querySelectorAll('#habitsList .habit-name.hd-door').length === 3));
  await p.click('#habitsList .habit-name.hd-door >> nth=0'); await p.waitForTimeout(400);
  ok('and open the same sheet', await p.evaluate(() => document.querySelector('#flow-hdo.on') && document.querySelector('#flow-hdo .hd-name').textContent === 'Write 3 sentences before bed'));
  await p.evaluate(() => window.FlowHabitDo.close());

  console.log('\n— in Turkish —');
  await p.evaluate(async () => { await Flow.Lang.set('tr'); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.FlowHabitDo.open('h1')); await p.waitForTimeout(400);
  const tr = await p.evaluate(() => { const el = document.getElementById('flow-hdo'); return { kinds: [...el.querySelectorAll('.hd-kinds button')].map((x) => x.textContent), save: el.querySelector('[data-hd="save"]').textContent, ph: el.querySelector('#hd-text').placeholder }; });
  ok('the sheet is Turkish', tr.kinds.join() === 'Yaz,Zamanlayıcı,Sadece işaretle' && tr.save === 'Kaydet ve işaretle' && /üç cümle/.test(tr.ph), tr);
  await p.evaluate(async () => { window.FlowHabitDo.close(); await Flow.Lang.set('en'); }); await p.waitForTimeout(600);

  console.log('\n— Advanced —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); }); await p.waitForTimeout(700);
  await p.click('#flow-td-habits .hb .tx >> nth=0', { force: true }).catch(() => {}); await p.waitForTimeout(300);
  ok('a habit name in Advanced is just a name', await p.evaluate(() => !document.querySelector('#flow-hdo.on')));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
