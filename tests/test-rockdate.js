/* A rock carries a date, and the date decides which week it is stored in.
   Getting that wrong is silent: the rock is saved, nothing errors, and it
   simply never appears on Today. These check the two functions that decide
   it — the ISO-week id and the Monday-based day index — against the dates
   that actually broke it, plus the boundaries where weeks change over. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'life-dashboard.html'), 'utf8');
const grab = (from, to) => {
  const a = src.indexOf(from); const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('not found: ' + from);
  return src.slice(a, b);
};

const weekId = new Function('return ' + grab('function weekId(', '\nfunction tOffDate'))();
const helpers = new Function(
  "const DAY_NAMES=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];" +
  grab('function rkIso(', 'function rkFillDates(') +
  '; return { rkIso, rkDayIndex, rkLabel, rkFeedOrder, rkFeedLate, rkFeedWhen };')();

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d) : ''))); };
const D = (s) => new Date(s + 'T00:00:00');

console.log('\n— the week a date belongs to —');
/* The exact case that lost a rock: Saturday 5 September 2026, picking the
   next day, while the planner was showing the week before. */
ok('Sat 5 Sep 2026 is week 36', weekId(D('2026-09-05')) === '2026-W36', weekId(D('2026-09-05')));
ok('Sun 6 Sep 2026 is still week 36', weekId(D('2026-09-06')) === '2026-W36', weekId(D('2026-09-06')));
ok('Mon 7 Sep 2026 rolls into week 37', weekId(D('2026-09-07')) === '2026-W37', weekId(D('2026-09-07')));
ok('Sun 30 Aug 2026 is week 35 — where the lost rock went',
   weekId(D('2026-08-30')) === '2026-W35', weekId(D('2026-08-30')));

console.log('\n— year boundaries, where ISO weeks are counter-intuitive —');
ok('Thu 31 Dec 2026 belongs to week 53 of 2026', weekId(D('2026-12-31')) === '2026-W53', weekId(D('2026-12-31')));
ok('Fri 1 Jan 2027 still belongs to 2026-W53', weekId(D('2027-01-01')) === '2026-W53', weekId(D('2027-01-01')));
ok('Mon 4 Jan 2027 starts 2027-W01', weekId(D('2027-01-04')) === '2027-W01', weekId(D('2027-01-04')));
ok('Sat 1 Jan 2022 belongs to the previous year, 2021-W52',
   weekId(D('2022-01-01')) === '2021-W52', weekId(D('2022-01-01')));

console.log('\n— Monday is day 0, every day of a week —');
const days = ['2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-06'];
days.forEach((iso, i) => ok(iso + ' → day ' + i, helpers.rkDayIndex(D(iso)) === i, helpers.rkDayIndex(D(iso))));
ok('every day of that run is in one week',
   new Set(days.map(d => weekId(D(d)))).size === 1, days.map(d => weekId(D(d))));

console.log('\n— the value the picker stores —');
ok('a date is stored as plain YYYY-MM-DD', helpers.rkIso(D('2026-09-06')) === '2026-09-06', helpers.rkIso(D('2026-09-06')));
ok('single digits are padded', helpers.rkIso(D('2026-01-02')) === '2026-01-02', helpers.rkIso(D('2026-01-02')));
ok('a date near midnight keeps its own day, not UTC\'s',
   helpers.rkIso(new Date(2026, 8, 6, 23, 30)) === '2026-09-06',
   helpers.rkIso(new Date(2026, 8, 6, 23, 30)));

console.log('\n— what the picker reads like —');
ok('the first option is Today', /^Today · /.test(helpers.rkLabel(D('2026-09-05'), 0)), helpers.rkLabel(D('2026-09-05'), 0));
ok('the second is Tomorrow', /^Tomorrow · /.test(helpers.rkLabel(D('2026-09-06'), 1)), helpers.rkLabel(D('2026-09-06'), 1));
ok('the rest carry a weekday and a real date',
   helpers.rkLabel(D('2026-09-07'), 2) === 'Mon 7 Sept', helpers.rkLabel(D('2026-09-07'), 2));
ok('no option is ever a bare weekday',
   [0,1,2,9].every(i => helpers.rkLabel(D('2026-09-05'), i).length > 4));

console.log('\n— the markup no longer offers a bare weekday —');
ok('the old weekday options are gone', src.indexOf('<option value="0">Mon</option>') < 0);
ok('there is a date input for anything further out', src.indexOf('id="rkDate"') > 0);

/* ------------------------------------------------------------------------
   The order the Today feed puts them in. The bug: a week runs Mon–Sun, so on
   Saturday 5 September a plain day-index sort put three Monday rocks — the
   Monday five days earlier — above a meeting happening the next day.
   ---------------------------------------------------------------------- */
const { rkFeedOrder, rkFeedLate, rkFeedWhen } = helpers;
const rock = (id, day, opts) => Object.assign({ id, day, title: id, time: '' }, opts || {});
const ids = (list, todayIdx) => rkFeedOrder(list, todayIdx).map(r => r.id);

console.log('\n— Today orders from now forward, not from Monday —');
/* His real week: Mon 31 Aug is five days gone, Sun 6 Sep is tomorrow. */
const theWeek = [
  rock('yunus', 0, { time: '10:00' }),
  rock('salonboost', 0, { time: '10:00' }),
  rock('djset', 0, { time: '10:00' }),
  rock('omer', 6, { time: '10:00' })
];
ok('tomorrow comes before a Monday that has gone', ids(theWeek, 5)[0] === 'omer', ids(theWeek, 5));
ok('and the three passed ones follow it', ids(theWeek, 5).slice(1).length === 3, ids(theWeek, 5));

console.log('\n— but only once that day has actually passed —');
ok('on the Monday itself the Monday rocks lead', ids(theWeek, 0)[0] !== 'omer', ids(theWeek, 0));
ok('and Sunday is last, as the week runs', ids(theWeek, 0)[3] === 'omer', ids(theWeek, 0));

console.log('\n— ties and the unscheduled —');
const mixed = [
  rock('fri', 4, { time: '09:00' }),
  rock('none', -1),
  rock('sun-early', 6, { time: '08:00' }),
  rock('sun-late', 6, { time: '20:00' }),
  rock('sat', 5, { time: '12:00' })
];
ok('the same day sorts by time', ids(mixed, 5).indexOf('sun-early') < ids(mixed, 5).indexOf('sun-late'), ids(mixed, 5));
ok('today leads, then tomorrow', ids(mixed, 5).slice(0, 2).join() === 'sat,sun-early', ids(mixed, 5));
ok('unscheduled sinks below even the overdue', ids(mixed, 5)[4] === 'none', ids(mixed, 5));

console.log('\n— what counts as overdue —');
ok('a passed day, still open, is overdue', rkFeedLate(rock('a', 0), 5) === true);
ok('a passed day, done, is not', rkFeedLate(rock('a', 0, { done: true }), 5) === false);
ok('today is never overdue', rkFeedLate(rock('a', 5), 5) === false);
ok('nor is tomorrow', rkFeedLate(rock('a', 6), 5) === false);
ok('nor is anything unscheduled', rkFeedLate(rock('a', -1), 5) === false);

console.log('\n— how the day reads —');
ok('today says Today', rkFeedWhen(rock('a', 5, { time: '10:00' }), 5) === 'Today 10:00', rkFeedWhen(rock('a', 5, { time: '10:00' }), 5));
ok('tomorrow says Tomorrow', rkFeedWhen(rock('a', 6, { time: '10:00' }), 5) === 'Tomorrow 10:00', rkFeedWhen(rock('a', 6, { time: '10:00' }), 5));
ok('anything else keeps its day name', rkFeedWhen(rock('a', 0, { time: '10:00' }), 5) === 'Mon 10:00', rkFeedWhen(rock('a', 0, { time: '10:00' }), 5));
ok('a range keeps both ends', rkFeedWhen(rock('a', 0, { time: '10:00', end: '22:19' }), 5) === 'Mon 10:00–22:19');
ok('unscheduled says nothing at all', rkFeedWhen(rock('a', -1), 5) === '');
/* Sunday is index 6, so "tomorrow" would be day 7 — a day that does not exist. */
ok('on a Sunday nothing claims to be tomorrow', rkFeedWhen(rock('a', 0), 6) === 'Mon');

console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ all ' + pass + ' passed') + ' (' + (pass + fail) + ' checks)');
process.exit(fail ? 1 : 0);
