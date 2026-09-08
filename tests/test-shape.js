/* Where things live.
 *
 * Two moves. Brainstorm and Time were sitting under Focus, which is meant to
 * be what you steer by — but one is where thinking gets put down and the
 * other is where hours get counted. Both are records, so that is where they
 * go.
 *
 * And Mood & Energy was a tab of its own, which made logging how you slept
 * and logging how you feel two separate errands on the same morning. They are
 * one question, so they are one page. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'life-dashboard.html'), 'utf8');
const pack = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 200) : ''))); };

/* Pull the three lists out of the pack and evaluate them for real, rather
   than pattern-matching source text that could drift. */
const grab = (from, to) => {
  const a = pack.indexOf(from); const b = pack.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('not found: ' + from);
  return pack.slice(a, b);
};
const nav = new Function('return {' + grab('GROUPS: [', 'ICON: {') + grab('SIDE: [', 'CAPTURE: [') +
  grab('CAPTURE: [', 'last: {') + '}')();
const groupOf = (t) => nav.GROUPS.find(g => g.tabs.indexOf(t) >= 0);
const sideOf = (t) => nav.SIDE.find(s => s.tabs.indexOf(t) >= 0);
const allSide = nav.SIDE.reduce((a, s) => a.concat(s.tabs), []);

console.log('\n— Brainstorm and Time are records, not steering —');
ok('Brainstorm sits under Record in the sidebar', (sideOf('brainstorm') || {}).head === 'Record', sideOf('brainstorm'));
ok('so does Time', (sideOf('time') || {}).head === 'Record', sideOf('time'));
ok('neither is under Focus any more', !nav.SIDE.find(s => s.head === 'Focus').tabs.some(t => t === 'brainstorm' || t === 'time'),
   nav.SIDE.find(s => s.head === 'Focus').tabs);
ok('Focus is left with the five things you actually steer by',
   nav.SIDE.find(s => s.head === 'Focus').tabs.join(',') === 'northstar,quad,compass,abko,dtc',
   nav.SIDE.find(s => s.head === 'Focus').tabs);

console.log('\n— the phone bar agrees with the sidebar —');
ok('the fourth slot is Record, not Ask', nav.GROUPS[3].label === 'Record', nav.GROUPS[3]);
ok('it still opens on Ask', nav.GROUPS[3].tabs[0] === 'ask', nav.GROUPS[3].tabs);
ok('Brainstorm has a slot to belong to', (groupOf('brainstorm') || {}).id === 'record', groupOf('brainstorm'));
ok('so does Time', (groupOf('time') || {}).id === 'record', groupOf('time'));
ok('and so do Journal and Finances, which had none before',
   (groupOf('journal') || {}).id === 'record' && (groupOf('finance') || {}).id === 'record');
ok('nothing is listed in two slots at once', (() => {
  const seen = {}; let dup = false;
  nav.GROUPS.forEach(g => g.tabs.forEach(t => { if (seen[t]) dup = true; seen[t] = 1; }));
  return !dup;
})());
ok('the avatar menu no longer repeats what now has a slot',
   /MENU: \['artur', 'settings'\]/.test(pack));
ok('every sidebar entry belongs to a slot', allSide.every(t => !!groupOf(t)),
   allSide.filter(t => !groupOf(t)));
ok('still exactly four slots for the bar to draw', nav.GROUPS.length === 4);

console.log('\n— Mood is part of Sleep now —');
ok('the mood tab is gone from the host', !/id="tab-mood"/.test(src));
ok('and so is its pill', !/data-tab="mood"/.test(src));
ok('the sleep pill says what it now holds', /data-tab="sleep">😴 Sleep &amp; Mood</.test(src));
ok('the page heading says it too', /😴 Sleep, Recovery &amp; Mood/.test(src));
ok('the sliders moved into the sleep section', (() => {
  const a = src.indexOf('id="tab-sleep"'), b = src.indexOf('id="tab-habits"');
  return a > 0 && b > a && src.slice(a, b).includes('id="moodSlider"');
})());
ok('so did the recent entries and the chart', (() => {
  const a = src.indexOf('id="tab-sleep"'), b = src.indexOf('id="tab-habits"');
  const chunk = src.slice(a, b);
  return chunk.includes('id="moodLog2"') && chunk.includes('id="mdChart"');
})());
ok('it reads as a second subject, not a pile', /<div class="sub-head">🧠 Mood &amp; Energy<\/div>/.test(src));
ok('opening Sleep paints the mood chart, which used to be its own hook',
   /if\(t\.dataset\.tab==='sleep'\)\{ renderSleepChart\(\); syncWhoop\(\); renderMood\(\); renderMoodChart\(\); \}/.test(src));
ok('no orphan hook is left looking for a mood tab', !/dataset\.tab==='mood'/.test(src));
ok('mood is out of the Body slot', !groupOf('mood'), groupOf('mood'));
ok('and out of the sidebar', !sideOf('mood'), sideOf('mood'));
ok('the phone More grid does not offer a page that is gone', !/'mood','🧠'/.test(src));
ok('the strip under the wordmark does not still list it',
   /Sleep &amp; Mood · Habits · Money/.test(src) && !/Habits · Mood ·/.test(src));
ok('capture offers one button for the one page',
   nav.CAPTURE.filter(c => c.id === 'sleep').length === 1 &&
   nav.CAPTURE.find(c => c.id === 'sleep').label === 'Sleep & mood',
   nav.CAPTURE.map(c => c.id + ':' + c.label));
ok('and no longer points at a mood tab that does not exist',
   !nav.CAPTURE.some(c => c.id === 'mood'), nav.CAPTURE.map(c => c.id));

console.log('\n— the data survives the move —');
ok('mood entries are still read from the same key', /S\.get\('mood', \[\]\)/.test(src));
ok('and still written to it', /S\.set\('mood',mdData\)/.test(src));
ok('the journal still records a mood line', /J\('mood','🧠 Mood '/.test(src));

console.log('\n— a grid collapses on its own width, not the window\'s —');
ok('the priorities grid is intrinsic', /\.qwrap\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(280px,1fr\)\)/.test(src));
ok('its viewport media query is gone', !/max-width:760px\)\{ \.qwrap/.test(src));

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
