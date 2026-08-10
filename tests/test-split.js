/* The pack now lives outside the HTML, and that arrangement has one failure
   mode worth guarding: a version marker that does not track the files it names.
   If it ever stops tracking them, the symptom is a browser holding a year-old
   pack against a new shell — which looks like the app randomly reverting, and
   is very hard to recognise from the inside.

   Everything else about the split is already covered: if the pack did not load
   at all, the 102 checks in test-nav would collapse. These are the checks that
   only make sense once the pack is a separate file. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const H = 'http://localhost:4222';

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
    : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 200) : ''))); };

  const root = path.dirname(process.env.DASH || path.join(__dirname, '..', 'life-dashboard.html'));

  console.log('\n— the shell asks for the pack by version —');
  const html = await (await fetch(H + '/')).text();
  ok('no unreplaced placeholder reaches the browser', !/__PACK_V__/.test(html));
  const js = /src="\/flow-pack\.js\?v=([a-f0-9]+)"/.exec(html);
  const css = /href="\/flow-pack\.css\?v=([a-f0-9]+)"/.exec(html);
  ok('the script is referenced with a version', !!js, js && js[1]);
  ok('the stylesheet is referenced with a version', !!css, css && css[1]);
  ok('both name the same version', js && css && js[1] === css[1],
     { js: js && js[1], css: css && css[1] });

  /* The version has to be a function of the bytes, not a number someone
     remembers to bump. Recompute it here the way the server does. */
  const want = require('crypto').createHash('sha256');
  for (const f of ['flow-pack.js', 'flow-pack.css']) want.update(fs.readFileSync(path.join(root, f)));
  ok('and it is the hash of the files themselves',
     js && js[1] === want.digest('hex').slice(0, 12), js && js[1]);

  console.log('\n— the pack is actually served —');
  for (const [file, type] of [['flow-pack.js', 'javascript'], ['flow-pack.css', 'css']]) {
    const r = await fetch(H + '/' + file + '?v=' + (js ? js[1] : ''));
    ok(file + ' is served', r.status === 200, r.status);
    ok('  as ' + type, (r.headers.get('content-type') || '').includes(type), r.headers.get('content-type'));
    const body = await r.text();
    ok('  and matches the file on disk',
       body === fs.readFileSync(path.join(root, file), 'utf8'));
  }

  console.log('\n— the script still runs in the window it used to —');
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  ok('the pack has defined itself by load', await p.evaluate(() => typeof window.Flow === 'object'));
  ok('it is deferred, not blocking the parser', /<script src="\/flow-pack\.js\?v=[a-f0-9]+" defer><\/script>/.test(html));
  ok('the stylesheet is in the head, after the app\'s own',
     html.indexOf('flow-pack.css') < html.indexOf('</head>') &&
     html.indexOf('</style>') < html.indexOf('flow-pack.css'));
  ok('and the pack still wins the cascade', await p.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'flow-x';
    document.body.appendChild(el);
    const surf = getComputedStyle(el).getPropertyValue('--f-surface').trim();
    el.remove();
    return surf.length > 0;
  }));
  ok('no page errors from any of that', errs.length === 0, errs.slice(0, 3));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
