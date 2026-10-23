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

console.log('\n— fewer sections: Brainstorm, Time and the planner tab are retired —');
const removed = new Function('return {' + grab('REMOVED: [', ']') + ']}')().REMOVED;
ok('Brainstorm is retired', removed.indexOf('brainstorm') >= 0, removed);
ok('so is Time', removed.indexOf('time') >= 0, removed);
ok('the planner keeps its tab — it carries the name and the photo', removed.indexOf('artur') < 0 && /Tabs\.add\('artur'/.test(pack), removed);
ok('none of them is still listed in the sidebar', !allSide.some(t => removed.indexOf(t) >= 0), allSide);
ok('nor given a phone slot', !nav.GROUPS.some(g => g.tabs.some(t => removed.indexOf(t) >= 0)));
ok('Focus is left with the five things you actually steer by',
   nav.SIDE.find(s => s.head === 'Plan').tabs.join(',') === 'northstar,quad,compass,abko,dtc',
   nav.SIDE.find(s => s.head === 'Plan').tabs);
ok('Record is Journal, Finances and Ask', nav.SIDE.find(s => s.head === 'Record').tabs.join(',') === 'journal,finance,ask');
ok('the pills are taken off the page at install', /retire\(\) \{/.test(pack) && /Nav\.retire\(\)/.test(pack));
ok('the sections stay, hidden, so the host can still render into them', /data-fn-retired/.test(pack) && /\[data-fn-retired\]\{display:none!important\}/.test(fs.readFileSync(path.join(__dirname, '..', 'flow-pack.css'), 'utf8')));

console.log('\n— the phone bar agrees with the sidebar —');
ok('the fourth slot is Record, not Ask', nav.GROUPS[3].label === 'Record', nav.GROUPS[3]);
ok('it still opens on Ask', nav.GROUPS[3].tabs[0] === 'ask', nav.GROUPS[3].tabs);
ok('Journal and Finances belong to it',
   (groupOf('journal') || {}).id === 'record' && (groupOf('finance') || {}).id === 'record');
ok('nothing is listed in two slots at once', (() => {
  const seen = {}; let dup = false;
  nav.GROUPS.forEach(g => g.tabs.forEach(t => { if (seen[t]) dup = true; seen[t] = 1; }));
  return !dup;
})());
ok('the avatar menu holds the planner and Settings', /MENU: \['artur', 'settings'\]/.test(pack));
ok('every sidebar entry belongs to a slot', allSide.every(t => !!groupOf(t)),
   allSide.filter(t => !groupOf(t)));
ok('still exactly four slots for the bar to draw', nav.GROUPS.length === 4);

console.log('\n— Diet is part of Body log now —');
ok('Body has three entries: training, sleep (the body log) and habits', nav.SIDE.find(s => s.head === 'Body').tabs.join(',') === 'training,sleep,habits');
ok('the diet elements are moved whole into the sleep section', /mergeBody\(\) \{/.test(pack) && /while \(diet\.firstChild\) block\.appendChild\(diet\.firstChild\)/.test(pack));
ok('the pill is renamed to say what it now holds', /sp\.textContent = '🫀 Body log'/.test(pack));
ok('opening it redraws the diet checklist, which lost its own pill', /renderDiet === 'function'\) renderDiet\(\)/.test(pack));
ok('capture still offers a Meal, landing on the diet part of the page',
   (nav.CAPTURE.find(c => c.id === 'diet') || {}).go === 'sleep' && /#fn-dietblock/.test((nav.CAPTURE.find(c => c.id === 'diet') || {}).at || ''));

console.log('\n— fewer things on by default —');
ok('nothing is hidden from the menu by default', /hiddenTabs: \[\],/.test(pack));
ok('the day Finances and Priorities were hidden is undone for everyone', /filter\(\(t\) => t !== 'finance' && t !== 'quad'\)/.test(pack) && /sectionsV', 4\)/.test(pack));
ok('prices on Today are a widget, off until asked for', /todayMarkets: false/.test(pack) && /enabled\(\) \{ return Settings\.get\('todayMarkets'\) === true; \}/.test(pack));
ok('an account older than the change keeps the strip it had', /WIDGET_DAY = Date\.parse\('2026-10-22T13:40:00Z'\)/.test(pack) && /existed = c === null \|\| \(!!c && Date\.parse\(c\) < WIDGET_DAY\)/.test(pack));
ok('and the account carries its creation time for that', /created: me\.created \|\| null/.test(fs.readFileSync(path.join(__dirname, '..', 'flow-auth.js'), 'utf8')));
ok('widgets are added and removed on Today itself', /widgetRow\(\) \{/.test(pack) && /data-widget="markets"/.test(pack) && /data-mkt-chip=/.test(pack));
ok('the person is in the sidebar, with the photo once Google is connected', /SIDE_FOOT: \['artur', 'settings'\]/.test(pack) && /querySelector\('\[data-fn-side="artur"\]'\)/.test(pack));
ok('Week Compass is one day per row on a phone', /body\.fn-on #tab-compass \.cgrid\{grid-template-columns:1fr/.test(fs.readFileSync(path.join(__dirname, '..', 'flow-pack.css'), 'utf8')));
ok('the strip is taken away when the widget is off', /if \(!Markets\.enabled\(\)\) \{\s*const old = feed && \$\('#flow-markets', feed\);\s*if \(old\) old\.remove\(\);/.test(pack));
ok('a shared task becomes a Big Rock, not a Q1 priority', /src: \{ k: 'inbox', id: item\.id \}/.test(pack) && !/q: 1,\n\s*txt: item\.task\.txt/.test(pack));
ok('the legacy Google Calendar card is gone', !/<h3>📆 Google Calendar<\/h3>/.test(pack));
ok('so is the iOS Reminders card', !/<h3>🔔 iOS Reminders<\/h3>/.test(pack));
ok('and the second Data card', !/<h3>💾 Data<\/h3>/.test(pack) && /<h3>💾 Your data<\/h3>/.test(pack));
ok('one backup covers the app and the pack', /pack\[SETTINGS_KEY\] = Settings\.data/.test(pack) && /restorePack\(obj\)/.test(pack));
ok('appearance, time chips, visuals and voice are one card', /id="lookCard"/.test(pack) && !/<h3>📊 Visuals<\/h3>/.test(pack) && !/<h3>🕘 Time chips<\/h3>/.test(pack) && !/<h3>🎤 Voice<\/h3>/.test(pack));
ok('a Mac shows the Apple Health card from what the iPhone read', /const HealthMirror = \{/.test(pack) && /window\.syncHealth = wrapped/.test(pack) && /Synced from your iPhone/.test(pack));
ok('Work and Side Project are untouched', (groupOf('abko') || {}).id === 'focus' && (groupOf('dtc') || {}).id === 'focus');

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
   /if\(t\.dataset\.tab==='sleep'\)\{[^}]*renderMood\(\);[^}]*renderMoodChart\(\);[^}]*\}/.test(src));
/* The same hook is where the two health sources are pulled in, because the
   moment somebody opens this tab is the moment those numbers should be
   current — not on a timer that runs while nobody is looking. */
ok('and asks both health sources for fresh numbers while it is there',
   /if\(t\.dataset\.tab==='sleep'\)\{[^}]*syncWhoop\(\);[^}]*syncHealth\([^)]*\);[^}]*\}/.test(src));
ok('no orphan hook is left looking for a mood tab', !/dataset\.tab==='mood'/.test(src));
ok('mood is out of the Body slot', !groupOf('mood'), groupOf('mood'));
ok('and out of the sidebar', !sideOf('mood'), sideOf('mood'));
ok('the phone More grid does not offer a page that is gone', !/'mood','🧠'/.test(src));
ok('the strip under the wordmark lists what is actually there',
   /Today · North Star · Week · Training · Body log · Habits · Journal/.test(src) && !/Habits · Mood ·/.test(src) && !/Diet ·|· Time ·|Priorities ·/.test(src.slice(src.indexOf('class="sub">'), src.indexOf('class="sub">') + 120)));
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

console.log('\n— the quadrant is left exactly as it was —');
/* I made this an auto-fit grid to satisfy a test, and on a wide screen it
   packed all four quadrants into one row of slivers. It is a 2x2 board; the
   layout was right before I touched it. The nav suite's "no grid is keyed to
   a viewport width" check stays red here on purpose — a red check is cheaper
   than a broken page. */
ok('two fixed columns, the way it was drawn',
   /\.qwrap\{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;align-items:stretch;\}/.test(src));
ok('and the phone rule that collapses it is back',
   /@media\(max-width:760px\)\{ \.qwrap\{grid-template-columns:1fr;\} \}/.test(src));
ok('no auto-fit is left on it', !/\.qwrap\{[^}]*auto-fit/.test(src));

console.log('\n— the service worker keeps its hands off the handshake —');
/* There is one service worker and the server writes it inline; the loose sw.js
   that used to sit in the repo was served by nothing and only made it look like
   the fix had landed. Read the real one.

   Its old rule treated every navigation as the app shell, so a click on Connect
   was answered with the cached dashboard whatever the address bar said — the
   button appeared to do nothing at all. Only the shell is the shell now, and the
   pages the server composes per request are never kept on the device. */
const srv = fs.readFileSync(path.join(__dirname, '..', 'life-os-server.js'), 'utf8');
const sw  = srv.slice(srv.indexOf('const SW = `'), srv.indexOf('// ── Login page'));
const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
const bypass = fetchHandler.slice(0, fetchHandler.indexOf('const isHTML'));

ok('there is no second service worker left to mislead anyone',
   !fs.existsSync(path.join(__dirname, '..', 'sw.js')));
ok('only the shell path is treated as the shell',
   /const isHTML = u\.pathname==='\/' \|\| u\.pathname==='\/index\.html';/.test(sw));
ok('a bare navigation no longer qualifies on its own', !/isHTML = req\.mode==='navigate'/.test(sw));
ok('the consent and token endpoints are handed to the network', /startsWith\('\/oauth\/'\)/.test(bypass));
ok('so is discovery', /startsWith\('\/\.well-known\/'\)/.test(bypass));
ok('and so is the assistant endpoint', /u\.pathname==='\/mcp'/.test(bypass));
ok('the sign-in gate is never served from the device', /u\.pathname==='\/login'/.test(bypass));
ok('each one returns before anything can answer for it',
   !/respondWith/.test(bypass) && (bypass.match(/return;/g) || []).length >= 3);
ok('the API stays exempt too, as it always was', /startsWith\('\/api'\)/.test(bypass));
/* The manifest and icons are cache-first, so a change to either reaches an
   installed copy only when the worker itself changes. Bumping the name is
   how a new manifest (screenshots, the Play listing) and the push handler
   get onto every device that already has The Flow installed. */
ok('the cache name moved on, so the old worker is replaced',
   /const CACHE='life-os-v7';/.test(sw));

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
