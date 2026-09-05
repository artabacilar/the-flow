/* The routine audit. Everything here is arithmetic over dates, and every one
   of these numbers ends up on screen next to a decision about somebody's
   life — so it is worth being certain that "barely happened" means barely
   happened, and that a window called six months is six months. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
const grab = (from, to) => {
  const a = src.indexOf(from); const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('not found: ' + from);
  return src.slice(a, b);
};

/* The maths module is deliberately free of the DOM, so it lifts straight out. */
const M = new Function(
  'const pad=(n)=>String(n).padStart(2,"0");' +
  'const isoDate=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;' +
  'const parseISO=(s)=>{const [y,m,d]=String(s).split("-").map(Number);return new Date(y,(m||1)-1,d||1);};' +
  'const addDays=(d,n)=>{const x=new Date(d.getTime());x.setDate(x.getDate()+n);return x;};' +
  grab('const AuditMath = {', '\n/* ======================================================================\n * 20d-i · Friends') +
  '; return AuditMath;')();

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d) : ''))); };
const D = (s) => new Date(s + 'T00:00:00');

console.log('\n— six months means six months —');
let w = M.window(6, D('2026-09-05'));
ok('back to the same day in March', w.from === '2026-03-05' && w.to === '2026-09-05', w);
ok('and that is 184 days', w.days === 184, w.days);
/* Calendar months, not 183 days: an audit run in March must cover September,
   whatever the lengths of the months in between. */
w = M.window(6, D('2026-03-01'));
ok('March back to September, not "183 days ago"', w.from === '2025-09-01', w.from);
w = M.window(6, D('2026-08-31'));
ok('the 31st going back to a 30-day month does not vanish', w.from.slice(0, 7) === '2026-02' || w.from.slice(0, 7) === '2026-03', w.from);
ok('three months works too', M.window(3, D('2026-09-05')).from === '2026-06-05');
ok('and twelve', M.window(12, D('2026-09-05')).from === '2025-09-05');

console.log('\n— the days in a window —');
const days = M.daysIn('2026-09-01', '2026-09-07');
ok('inclusive at both ends', days.length === 7 && days[0] === '2026-09-01' && days[6] === '2026-09-07', days);
ok('a single day is one day', M.daysIn('2026-09-01', '2026-09-01').length === 1);
ok('backwards is empty, not infinite', M.daysIn('2026-09-07', '2026-09-01').length === 0);
ok('it crosses a month end', M.daysIn('2026-08-30', '2026-09-02').join() === '2026-08-30,2026-08-31,2026-09-01,2026-09-02');

console.log('\n— reading a record —');
const week = M.daysIn('2026-09-01', '2026-09-14');   /* 14 days, two halves of 7 */
let r = M.read(['2026-09-02', '2026-09-05', '2026-09-09', '2026-09-12'], week, 8);
ok('it counts what happened', r.done === 4, r.done);
ok('against what was expected', r.expected === 8 && r.rate === 0.5, [r.expected, r.rate]);
ok('and splits the window in half', r.first === 2 && r.second === 2, [r.first, r.second]);
ok('two equal halves are level', r.trend === 0, r.trend);
ok('it knows the last time', r.lastDone === '2026-09-12', r.lastDone);
ok('and how long it has been quiet', r.quietFor === 2, r.quietFor);

console.log('\n— a routine that is quietly dying —');
r = M.read(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'], week, 14);
ok('all of it in the first half', r.first === 5 && r.second === 0, [r.first, r.second]);
ok('reads as fading', r.trend === -1, r.trend);
ok('and says how long since', r.quietFor === 9, r.quietFor);
/* The other way round is the point of the split: this is what "it is working
   now" looks like, and an average over six months would hide it. */
r = M.read(['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'], week, 14);
ok('the reverse reads as rising', r.trend === 1, r.trend);

console.log('\n— a nudge either way is not a trend —');
ok('4 then 5 is still level', M.trend(4, 5) === 0, M.trend(4, 5));
ok('a single extra day is noise', M.trend(10, 11) === 0, M.trend(10, 11));
ok('a real jump is not', M.trend(10, 20) === 1);
ok('and a real collapse is not', M.trend(20, 4) === -1);
ok('zero to zero is level, not a divide by zero', M.trend(0, 0) === 0);
ok('nothing to something is rising', M.trend(0, 3) === 1);

console.log('\n— counting the same day twice —');
/* The scoreboard ledger can hold three of a thing on one day; the window
   should count three, but only one day with it. */
r = M.read(['2026-09-02', '2026-09-02', '2026-09-02'], week, 6);
ok('three on one day counts three', r.done === 3, r.done);
ok('but one day had it', r.daysWithIt === 1, r.daysWithIt);

console.log('\n— nothing at all —');
r = M.read([], week, 14);
ok('done is zero, not NaN', r.done === 0 && r.rate === 0, r);
ok('there is no last time', r.lastDone === '', r.lastDone);
ok('and it has been quiet the whole window', r.quietFor === 14, r.quietFor);
ok('no target set does not divide by zero', M.read(['2026-09-02'], week, 0).rate === 1);

console.log('\n— the word for the number —');
ok('never once', M.verdict({ done: 0, rate: 0 }) === 'never happened');
ok('nearly every time', M.verdict({ done: 9, rate: 0.9 }) === 'holding');
ok('about half', M.verdict({ done: 7, rate: 0.6 }) === 'most weeks');
ok('here and there', M.verdict({ done: 3, rate: 0.3 }) === 'patchy');
ok('almost never', M.verdict({ done: 1, rate: 0.1 }) === 'barely happened');
/* Descriptive, never advisory — the app does not tell anyone what to cut. */
ok('no verdict tells you what to do', ['never happened', 'holding', 'most weeks', 'patchy', 'barely happened']
  .every(v => !/drop|cut|keep|should/i.test(v)));

console.log('\n— turning a target into an expectation —');
const halfYear = M.daysIn(M.window(6, D('2026-09-05')).from, '2026-09-05');
const sp = M.spans(halfYear);
/* A window from the 5th to the 5th is 184 days apart and 185 dates long —
   both ends are yours to fill in. The expectation is built from the dates,
   which is the generous reading and the one the rows are counted over. */
ok('the span is 184 days', M.window(6, D('2026-09-05')).days === 184);
ok('and it holds 185 dates', halfYear.length === 185, halfYear.length);
ok('six months is about 26 weeks', Math.round(sp.weeks) === 26, sp.weeks);
ok('and about 6 months', Math.round(sp.months) === 6, sp.months);
ok('4 workouts a week is about 106 over six months', Math.round(4 * sp.weeks) === 106, Math.round(4 * sp.weeks));
ok('1 performance a month is about 6', Math.round(1 * sp.months) === 6, Math.round(1 * sp.months));

console.log('\n— when the next one falls due —');
let d = M.due(null, 6, D('2026-09-05'));
ok('never run means due now', d.due === true && d.never === true, d);
d = M.due('2026-09-05T10:00:00.000Z', 6, D('2026-09-05'));
ok('just run is not due', d.due === false, d);
ok('and it names the date', d.on === '2027-03-05', d.on);
ok('about six months away', d.daysAway > 175 && d.daysAway < 190, d.daysAway);
d = M.due('2026-03-05T10:00:00.000Z', 6, D('2026-09-05'));
ok('six months later it is due', d.due === true, d);
d = M.due('2026-03-05T10:00:00.000Z', 6, D('2026-09-04'));
ok('the day before, it is not', d.due === false, d);
ok('a three-month cadence is honoured', M.due('2026-06-05T00:00:00.000Z', 3, D('2026-09-05')).due === true);
ok('and a twelve-month one', M.due('2026-06-05T00:00:00.000Z', 12, D('2026-09-05')).due === false);

console.log('\n— the window is capped, whatever it is asked for —');
ok('a decade does not build a million strings', M.daysIn('1990-01-01', '2026-09-05').length <= 4000);

console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ all ' + pass + ' passed') + ' (' + (pass + fail) + ' checks)');
process.exit(fail ? 1 : 0);
