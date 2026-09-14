/* The home-screen widget's feed.
 *
 * A widget is the one surface nobody chooses to open — it is just there, on the
 * lock screen, being read at a glance while walking. So two things matter more
 * here than anywhere else in this codebase. It must be someone's own day and
 * never anyone else's, because a widget is read in public. And it must not be
 * able to change anything, because the only gesture it has is a tap, and a tap
 * in a coat pocket must not tick a rock off.
 *
 * Everything below is one of those two. */
const http = require('http');
const path = require('path');
const M = require(path.join(__dirname, '..', 'flow-mcp.js'));

const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

const rq = (p, opts = {}) => new Promise((resolve) => {
  const u = new URL(H + p);
  const body = opts.body || null;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search,
    method: opts.method || 'GET', headers }, (res) => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      let j = null; try { j = JSON.parse(b); } catch (e) {}
      resolve({ status: res.statusCode, json: j, text: b, headers: res.headers });
    });
  });
  r.on('error', () => resolve({ status: 0, json: null, text: '' }));
  if (body) r.write(body);
  r.end();
});

const jar = {};
async function as(who, p, opts = {}) {
  const o = Object.assign({}, opts);
  o.headers = Object.assign({}, opts.headers || {});
  if (jar[who]) o.headers.Cookie = jar[who];
  const r = await rq(p, o);
  const sc = r.headers && r.headers['set-cookie'];
  if (sc) jar[who] = sc.map(c => c.split(';')[0]).join('; ');
  return r;
}
const signUp = (who, email, invite) => as(who, '/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email, name: who, password: 'a properly long password', invite })
});

const bearer = (tok, opts = {}) => rq('/api/widget',
  Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + tok }, opts.headers || {}) }));

(async () => {
  console.log('\n— it is a credential, the same as everything else —');
  await signUp('artur', 'artur.abacilar@abko.com.tr', 'letmein');
  await signUp('sam', 'sam@example.com', 'letmein');

  let r = await as('artur', '/api/flow/tokens', { method: 'POST', body: JSON.stringify({ name: 'The widget' }) });
  const TOK = r.json.token;
  r = await as('sam', '/api/flow/tokens', { method: 'POST', body: JSON.stringify({ name: 'Sam widget' }) });
  const SAMTOK = r.json.token;

  ok('no token is refused', (await rq('/api/widget')).status === 401);
  ok('and it says where to get one', /Settings/.test(((await rq('/api/widget')).json || {}).error || ''));
  ok('with the header a client needs to notice',
     /Bearer/.test((await rq('/api/widget')).headers['www-authenticate'] || ''));
  ok('a made-up token is refused', (await bearer('flow_nonsense')).status === 401);
  /* A cookie is the app's credential, not the widget's — the widget process has
     no browser to hold one, so accepting it here would only mean accepting
     something that arrived by accident. */
  ok('a session cookie alone is not enough', (await as('artur', '/api/widget')).status === 401);
  ok('a real token is let in', (await bearer(TOK)).status === 200);

  console.log('\n— it is your day, and nobody else’s —');
  /* Put a rock in Artur's week through the MCP surface, then check whose widget
     can see it. This is the check that matters most: a widget sits face-up on a
     table. */
  const rpc = (tok, name, args) => rq('/mcp', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  });
  await rpc(TOK, 'add_rock', { title: 'A thing only Artur knows about', day: 'today', time: '23:30' });

  const mine = (await bearer(TOK)).json;
  const theirs = (await bearer(SAMTOK)).json;
  ok('the rock shows on the owner’s widget',
     JSON.stringify(mine.lines).indexOf('only Artur knows') >= 0, mine.lines);
  ok('and on nobody else’s', JSON.stringify(theirs).indexOf('only Artur knows') < 0, theirs.lines);
  ok('the other person still gets their own empty day', theirs.total === 0, theirs);

  console.log('\n— it fits on a lock screen —');
  ok('it names the day', typeof mine.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(mine.date), mine.date);
  ok('and says which weekday that is', typeof mine.weekday === 'string' && mine.weekday.length > 2, mine.weekday);
  ok('it counts what is done out of what there is',
     typeof mine.done === 'number' && typeof mine.total === 'number' && mine.done <= mine.total, [mine.done, mine.total]);
  ok('it never returns more lines than a tile can hold', mine.lines.length <= 4, mine.lines.length);
  ok('and says how many it left out rather than making the widget count',
     typeof mine.more === 'number' && mine.more >= 0, mine.more);
  ok('every line carries the three things a glance needs',
     mine.lines.every(l => 'title' in l && 'time' in l && 'done' in l), mine.lines[0]);
  ok('it carries the week’s standing too', mine.week && typeof mine.week.total === 'number', mine.week);
  ok('and stamps when it was true', !isNaN(Date.parse(mine.updated)), mine.updated);
  /* The system redraws a widget far more often than a day changes, so the
     answer is allowed to be a minute old — but only privately, because it is
     one person's day. */
  const cc = (await bearer(TOK)).headers['cache-control'] || '';
  ok('it may be cached briefly', /max-age=\d+/.test(cc), cc);
  ok('but never by anything shared', /private/.test(cc) && !/public/.test(cc), cc);

  console.log('\n— and it cannot change a thing —');
  /* The feed is a GET. Everything else must come back as "no" rather than as a
     quiet success that wrote nothing — a silent 200 is how a bug hides. */
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const rr = await bearer(TOK, { method: m, body: '{}' });
    ok(m + ' is not a way in', rr.status !== 200, rr.status);
  }
  const before = (await bearer(TOK)).json;
  await bearer(TOK, { method: 'POST', body: JSON.stringify({ done: true }) });
  const after = (await bearer(TOK)).json;
  ok('nothing it was sent changed the day',
     JSON.stringify(before.lines) === JSON.stringify(after.lines), [before.lines, after.lines]);

  console.log('\n— the shape of a day, without a server —');
  /* Ordering is the whole design and it is pure, so pin it directly rather than
     through a week of fixtures. What is still ahead comes first, because it is
     the only part still a decision. */
  const store = (() => {
    const mem = {};
    return {
      async get(k) { return mem[k]; },
      async set(k, v) { mem[k] = v; },
      async all() { return Object.assign({}, mem); }
    };
  })();
  const NOW = new Date('2026-09-14T12:00:00');
  await store.set('ld_compass', JSON.stringify({
    rocks: { '2026-W38': [
      { id: 'a', title: 'Missed this morning', day: 0, time: '09:00', done: false },
      { id: 'b', title: 'Later today', day: 0, time: '18:00', done: false },
      { id: 'c', title: 'No time on it', day: 0, time: '', done: false },
      { id: 'd', title: 'Already done', day: 0, time: '08:00', done: true },
      { id: 'e', title: 'Tomorrow', day: 1, time: '10:00', done: false }
    ] }, saw: {}, roles: [], mission: ''
  }));
  const w = await M.widgetToday(store, NOW);
  const titles = w.lines.map(l => l.title);
  ok('only today is on it', titles.indexOf('Tomorrow') < 0, titles);
  ok('what is still ahead comes first', titles[0] === 'Later today', titles);
  ok('then what has no time on it', titles[1] === 'No time on it', titles);
  ok('then what was missed', titles[2] === 'Missed this morning', titles);
  ok('and what was missed says so', w.lines[2].overdue === true, w.lines[2]);
  ok('what is already done is not nagged about', titles.indexOf('Already done') < 0, titles);
  ok('but it still counts towards the day', w.done === 1 && w.total === 4, [w.done, w.total]);

  console.log('\n— the shell hands the widget its token, and only then —');
  /* The widget is a separate process with no view of the page, so a token only
     ever reaches it if the app passes it across at the moment one is made. In a
     browser there is no bridge at all, and the same code must do nothing rather
     than throw — Settings should not grow a broken button because the page also
     runs inside an app. */
  const fs = require('fs');
  const pack = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
  ok('making a token pushes it to the shell', /SettingsUI\.nativeToken\(r\.token\)/.test(pack));
  const fn = pack.slice(pack.indexOf('nativeToken(token)'), pack.indexOf('async mcpFetch'));
  ok('it goes through the native bridge', /Plugins\.FlowBridge/.test(fn) && /setToken\(\{ token \}\)/.test(fn), fn.length);
  ok('a browser with no bridge is left alone', /if \(!bridge \|\| !token\) return;/.test(fn));
  ok('and nothing it does can throw into the page', /try \{/.test(fn) && /catch/.test(fn));

  const swift = fs.readFileSync(path.join(__dirname, '..', 'ios-app', 'native', 'Shared', 'FlowStore.swift'), 'utf8');
  ok('the two processes meet in one App Group and nowhere else',
     (swift.match(/UserDefaults\(suiteName: appGroup\)/g) || []).length === 1, swift.indexOf('suiteName'));
  ok('the widget asks the endpoint built for it', /api\/widget/.test(swift));
  ok('and presents the token as a bearer', /Bearer \\\(token\)/.test(swift));
  ok('a rejected token is told apart from an unreachable server',
     /case notConnected/.test(swift) && /case unauthorized/.test(swift));

  /* The bridge used to be a Capacitor plugin. It is now a WKScriptMessageHandler
     plus an injected shim, because CocoaPods cannot be installed without a Mac
     shell and that was the only thing Capacitor was still buying us. The web
     app's call site did not change \u2014 which is the point, and what the first
     check below pins down. */
  const vc = fs.readFileSync(path.join(__dirname, '..', 'ios-app', 'native', 'App', 'FlowViewController.swift'), 'utf8');
  ok('the shim answers to the name the page already calls',
     /window\.Capacitor\.Plugins\.FlowBridge = \{/.test(vc) &&
     /setToken:/.test(vc) && /status:/.test(vc) && /clear:/.test(vc));
  ok('and it resolves, so the page\u2019s await does not hang forever',
     /return new Promise/.test(vc) && /__flowBridgeResolve/.test(vc) && /evaluateJavaScript/.test(vc));
  ok('signing out takes the widget\u2019s copy with it',
     /case "clear"/.test(vc) && /FlowStore\.token = nil/.test(vc));
  ok('and the widget is redrawn rather than left stale',
     (vc.match(/reloadAllTimelines/g) || []).length >= 2, vc.length);
  ok('the shell keeps the session cookie across launches',
     /websiteDataStore = \.default\(\)/.test(vc));
  ok('a killed web content process comes back instead of a white screen',
     /webViewWebContentProcessDidTerminate/.test(vc));

  /* The whole reason for the rewrite: a project that resolves nothing opens on
     any Mac with Xcode and no other tool installed. If a Podfile or an `import
     Capacitor` ever comes back, this is where it gets caught. */
  const nativeDir = path.join(__dirname, '..', 'ios-app', 'native');
  const swiftFiles = ['App/AppDelegate.swift', 'App/FlowViewController.swift',
                      'Shared/FlowStore.swift', 'Widget/FlowWidget.swift']
    .map((f) => fs.readFileSync(path.join(nativeDir, f), 'utf8'));
  ok('no Swift source imports a framework that has to be fetched',
     swiftFiles.every((s) => !/^import Capacitor$/m.test(s)));
  ok('the shell builds its own window, so no storyboard has to be found',
     /UIWindow\(frame: UIScreen\.main\.bounds\)/.test(swiftFiles[0]));

  const native = fs.readFileSync(path.join(__dirname, '..', 'ios-app', 'scripts', 'make-native.js'), 'utf8');
  ok('the conversion removes CocoaPods rather than trusting it to be absent',
     /PBXShellScriptBuildPhase/.test(native) &&
     /delete cfg\.baseConfigurationReference/.test(native) &&
     /Podfile/.test(native));
  ok('and it fails loudly if any of it survived',
     /still referenced in the project file/.test(native) && /process\.exit\(1\)/.test(native));
  ok('both targets are given the same deployment target',
     /DEPLOYMENT_TARGET = '17\.0'/.test(native));

  console.log('\n— the app and the widget agree on who they are —');
  /* One mismatched character between the bundle id and the App Group and the
     widget shows "Not connected" forever while the app is plainly signed in —
     with no error anywhere, because nothing failed: it simply read an empty
     store. It is the single most common way this goes wrong, so it is pinned
     here rather than left to whoever next edits one of the two files. */
  const cap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ios-app', 'capacitor.config.json'), 'utf8'));
  const group = (swift.match(/appGroup = "([^"]+)"/) || [])[1];
  ok('the bundle id is reverse-DNS off a domain, not a first name',
     /^[a-z][a-z0-9-]*\.[a-z0-9.-]+$/.test(cap.appId) && cap.appId.split('.').length >= 3, cap.appId);
  ok('the App Group is that bundle id and nothing else',
     group === 'group.' + cap.appId, [group, cap.appId]);
  ok('no placeholder survived into either of them',
     !/example/.test(cap.appId + ' ' + group), [cap.appId, group]);
  ok('the app has a name', typeof cap.appName === 'string' && cap.appName.length > 2, cap.appName);
  /* The phone loads the same server the browser does. If this ever points
     somewhere else, the app and the website quietly stop being the same app. */
  ok('and it loads the server rather than a copy of the page',
     /^https:\/\//.test((cap.server || {}).url || ''), (cap.server || {}).url);
  /* The phone and the widget must reach the same server. They are set in two
     different files, in two different languages, and nothing but this check
     notices when one of them is left behind — which is exactly what a URL
     change does. */
  ok('the widget reaches the same server the app does',
     swift.indexOf((cap.server || {}).url) > 0, [(cap.server || {}).url]);

  const srvSrc = fs.readFileSync(path.join(__dirname, '..', 'life-os-server.js'), 'utf8');
  ok('the installed web app calls itself the same thing',
     srvSrc.indexOf('name: "' + cap.appName + '"') > 0, cap.appName);

  console.log('\n— the widget target is built by something that cannot mistype —');
  /* Creating the widget target used to be a dialog somebody clicked through,
     and the App Group was a string somebody typed twice. Typed wrong, nothing
     errors: the widget reads an empty store and says "Open the app and connect"
     forever. So it is a script now, and these check the script agrees with the
     config it is supposed to follow. */
  const script = fs.readFileSync(path.join(__dirname, '..', 'ios-app', 'scripts', 'add-widget-target.js'), 'utf8');
  const sBundle = (script.match(/const BUNDLE = '([^']+)'/) || [])[1];
  const sGroup  = (script.match(/const GROUP  = '([^']+)' \+ BUNDLE/) || [])[1];

  ok('the script signs the same bundle the config declares', sBundle === cap.appId, [sBundle, cap.appId]);
  ok('and derives the group rather than repeating it', sGroup === 'group.', sGroup);
  ok('the widget is its own bundle under the app\u2019s', /WIDGET_BUNDLE = BUNDLE \+ '\.' \+ WIDGET/.test(script));
  /* A target with no Sources phase builds green and ships an empty widget,
     which is the worst kind of pass. */
  ok('the target gets a Sources phase', /'PBXSourcesBuildPhase'/.test(script));
  ok('and both files it needs are compiled into it',
     /addSourceFile\(WIDGET \+ '\/FlowWidget\.swift'/.test(script) &&
     /addSourceFile\(WIDGET \+ '\/FlowStore\.swift'/.test(script));
  /* Without the copy phase the widget builds and is never shipped; without the
     dependency the copy phase copies something that was not built yet. */
  ok('the extension is embedded in the app', /'Embed Foundation Extensions'/.test(script) && /'app_extension'\s*\n?\s*\)/.test(script.replace(/\r/g,'')));
  ok('and built before it is copied', /PBXTargetDependency/.test(script) && /PBXContainerItemProxy/.test(script));
  ok('both targets carry the entitlement file', /CODE_SIGN_ENTITLEMENTS/.test(script));
  /* containerBackground(for:) is iOS 17. Leaving the extension on the app's
     own floor is a build error nobody reads until the third time. */
  ok('the widget asks for the iOS it actually needs', /IPHONEOS_DEPLOYMENT_TARGET = '17\.0'/.test(script));
  ok('the original project is kept, so the wizard is still a way back',
     /project\.pbxproj.*\.original|pbxPath \+ '\.original'/.test(script));

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
