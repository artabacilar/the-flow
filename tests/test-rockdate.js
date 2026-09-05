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
  '; return { rkIso, rkDayIndex, rkLabel };')();

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

console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ all ' + pass + ' passed') + ' (' + (pass + fail) + ' checks)');
process.exit(fail ? 1 : 0);
