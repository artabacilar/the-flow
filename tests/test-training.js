/* Two things the training tab used to get wrong.
 *
 * A time field that arrives already saying 18:00 reads as a decision somebody
 * made. Nobody did — it was a constant in the file, shared across every week
 * forever. So times moved into the week they belong to, and a week starts
 * blank.
 *
 * And Type was a menu of four words from a book. Artur's own week is Push,
 * Pull, Legs, Upper — none of which were on the menu, so editing a day
 * relabelled it with a word he does not use. It takes free text now, with the
 * rest-day rule made explicit instead of guessed from the label. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'life-dashboard.html'), 'utf8');
const pack = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
const grab = (from, to) => {
  const a = src.indexOf(from); const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('not found: ' + from);
  return src.slice(a, b);
};

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d) : ''))); };

/* The helpers, lifted out with a tData they can see. */
function mk(tData) {
  const PLAN = [
    { key: 'mon', tag: 'Push' }, { key: 'wed', tag: 'Rest' }, { key: 'sat', tag: 'Cardio' }
  ];
  const body = grab('function tTimes(wid)', 'function tSave()');
  return new Function('tData', 'PLAN', body +
    '; return { tTimes, tTimeFor, tTypeOf, tTypeLabels, TYPE_ALIASES };')(tData, PLAN);
}

console.log('\n— nothing is filled in for you —');
const PLAN_BLOCK = grab('const PLAN = [', '];');
ok('no training day ships with a time on it', !/time:'\d/.test(PLAN_BLOCK), (PLAN_BLOCK.match(/time:'[^']*'/g) || []));
ok('every day still declares an empty time', (PLAN_BLOCK.match(/time:''/g) || []).length === 7,
   (PLAN_BLOCK.match(/time:''/g) || []).length);
ok('the profile template carries no times either', !/time: '18:00'/.test(pack));
ok('and a profile can no longer hand one back', /d\.time = '';/.test(pack));

console.log('\n— a time belongs to one week —');
{
  const t = mk({ times: {}, timesW: {}, plans: {} });
  ok('an untouched week is blank', t.tTimeFor('2026-W37', 'mon') === '', t.tTimeFor('2026-W37', 'mon'));
  t.tTimes('2026-W37').mon = '18:00';
  ok('what you type is kept', t.tTimeFor('2026-W37', 'mon') === '18:00');
  ok('next week is still blank', t.tTimeFor('2026-W38', 'mon') === '', t.tTimeFor('2026-W38', 'mon'));
  ok('last week is still blank', t.tTimeFor('2026-W36', 'mon') === '', t.tTimeFor('2026-W36', 'mon'));
  ok('a different day of the same week is blank', t.tTimeFor('2026-W37', 'tue') === '');
  ok('clearing a time leaves it cleared, not defaulted', (t.tTimes('2026-W37').mon = '', t.tTimeFor('2026-W37', 'mon') === ''));
}

console.log('\n— the render reads the week, and only the week —');
ok('the card reads the week it is showing', /const time=tTimeFor\(wid,key\);/.test(src));
ok('typing into a card writes to that week', /tTimes\(wid\)\[inp\.dataset\.key\]=inp\.value/.test(src));
ok('the compass chip reads the week it is showing', /tTimeFor\(wid,DAY_KEYS\[i\]\)/.test(src));
ok('the calendar export reads the week it is exporting', /tTimeFor\(wid,key\)\|\|plan\.time/.test(src));
/* The old map is read exactly once more, by the one-time migration. Anywhere
   else is a reader that would still be showing last week's time. */
{
  const a = src.indexOf('if(!tData.timesW){'), b = src.indexOf('function tTimes(wid)', a);
  const rest = src.slice(0, a) + src.slice(b);
  ok('no reader is left on the old shared map',
     !/tData\.times\[/.test(rest), (rest.match(/tData\.times\[[^\]]*\]/g) || []));
}

console.log('\n— times you already typed are not thrown away —');
{
  const body = grab('if(!tData.timesW){', 'function tTimes(wid)');
  const run = (tData) => { new Function('tData', 'WK', body)(tData, '2026-W37'); return tData; };
  let d = run({ times: { mon: '19:30', tue: '' }, plans: {} });
  ok('an edit you made lands in the current week', d.timesW['2026-W37'].mon === '19:30', d.timesW);
  ok('an empty one is not carried over', !('tue' in d.timesW['2026-W37']), d.timesW['2026-W37']);
  ok('no other week is seeded', Object.keys(d.timesW).length === 1, Object.keys(d.timesW));
  d = run({ times: {}, plans: {} });
  ok('nothing to carry means nothing is written', Object.keys(d.timesW).length === 0, d.timesW);
  d = run({ times: { mon: '08:00' }, timesW: { '2026-W37': { mon: '20:00' } }, plans: {} });
  ok('a migration never runs twice over what you have since typed',
     d.timesW['2026-W37'].mon === '20:00', d.timesW);
}

console.log('\n— Type takes your own word for it —');
ok('the menu of four is gone', !/<select id="edType">/.test(src));
ok('it is a text field now', /id="edType" list="edTypeList"/.test(src));
ok('with your past labels offered as suggestions', /<datalist id="edTypeList">/.test(src));
ok('and rest is a tick box, not a word to guess at', /id="edRest"/.test(src));
ok('what you typed is what the badge says', /tag:label\|\|\(isRest\?'Rest':TAG_LABELS\[type\]\)/.test(src));

console.log('\n— what a typed label means —');
{
  const t = mk({ times: {}, timesW: {}, plans: {} });
  ok('Push is a training day', t.tTypeOf('Push', false) === 'hyper', t.tTypeOf('Push', false));
  ok('Legs is a training day', t.tTypeOf('Legs', false) === 'hyper');
  ok('a word nobody has seen before is still a training day', t.tTypeOf('Sauna & sled', false) === 'hyper');
  ok('Strength keeps its colour', t.tTypeOf('Strength', false) === 'strength');
  ok('Hypertrophy keeps its colour', t.tTypeOf('Hypertrophy', false) === 'hyper');
  ok('Conditioning keeps its colour', t.tTypeOf('Conditioning', false) === 'cond');
  ok('so does Cardio, which is the same thing', t.tTypeOf('Cardio', false) === 'cond');
  ok('case and spacing do not matter', t.tTypeOf('  cONDITIONING ', false) === 'cond');
  ok('an empty label is a training day, not a rest day', t.tTypeOf('', false) === 'hyper');
  ok('the tick box is what makes a rest day', t.tTypeOf('Push', true) === 'rest');
  ok('and it wins over any label', t.tTypeOf('Conditioning', true) === 'rest');
  ok('typing Rest day works too', t.tTypeOf('Rest day', false) === 'rest');
  ok('so does Rest on its own', t.tTypeOf('rest', false) === 'rest');
}

console.log('\n— the suggestions you get —');
{
  const t = mk({ times: {}, timesW: {}, plans: { '2026-W36': { thu: { tag: 'Sauna & sled' } }, '2026-W37': { mon: { tag: 'Push' } } } });
  const l = t.tTypeLabels();
  ok('the four presets are there', ['Strength', 'Hypertrophy', 'Conditioning', 'Rest day'].every(x => l.includes(x)), l);
  ok('so are the labels your plan already uses', l.includes('Push') && l.includes('Cardio'), l);
  ok('so is one you invented in an earlier week', l.includes('Sauna & sled'), l);
  ok('nothing is listed twice', new Set(l.map(x => x.toLowerCase())).size === l.length, l);
  ok('a day with no override does not add a blank', l.every(Boolean), l);
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
