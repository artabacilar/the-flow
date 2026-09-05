/* The Direction engine writes the panel a person reads first thing in the
   morning, so the things worth proving are the ones that would quietly make
   it lie: the zodiac boundaries, the metric roll-up that turns a ledger of
   days into a trend, the reply parser that has to survive a model wrapping
   its JSON in prose, and the caching that stops an open tab spending money.
   None of this calls the real API. */
const m = require('../flow-extras.js');
const I = m._internals;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

const reader = (data, log) => ({
  async get(k) { if (log) log.push(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
  async all() { return data; }
});

/* A ledger with one metric logged on known days. */
function ledgerFor(id, days) {
  const out = {};
  for (const [d, n] of days) { out[d] = out[d] || {}; out[d][id] = n; }
  return out;
}

(async () => {
  console.log('\n— star signs, including every boundary —');
  const cases = [
    ['1990-03-20', 'Pisces'], ['1990-03-21', 'Aries'],
    ['1990-04-19', 'Aries'],  ['1990-04-20', 'Taurus'],
    ['1990-12-21', 'Sagittarius'], ['1990-12-22', 'Capricorn'],
    ['1990-01-19', 'Capricorn'], ['1990-01-20', 'Aquarius'],
    ['1990-12-31', 'Capricorn'], ['1990-01-01', 'Capricorn'],
    ['1990-09-04', 'Virgo'], ['1990-07-23', 'Leo'], ['1990-07-22', 'Cancer']
  ];
  for (const [d, want] of cases) ok(d + ' → ' + want, I.sunSign(d) === want, I.sunSign(d));
  ok('rubbish gives no sign, rather than a wrong one', I.sunSign('not a date') === null);
  ok('empty gives no sign', I.sunSign('') === null && I.sunSign(null) === null);
  ok('an impossible month is refused', I.sunSign('1990-13-04') === null);

  console.log('\n— metric roll-up —');
  const NOW = new Date('2026-09-04T12:00:00Z');          /* a Friday, ISO week 36 */
  const metrics = [
    { id: 'm1', name: 'DJ sets', unit: 'sets', target: 2, period: 'week' },
    { id: 'm2', name: 'Demos sent out', unit: 'send-outs', target: 3, period: 'week' }
  ];
  /* Monday of that week is 2026-08-31. Two sets this week, one last week. */
  const log = ledgerFor('m1', [['2026-08-31', 1], ['2026-09-03', 1], ['2026-08-26', 1]]);
  const rolled = I.rollUpMetrics(metrics, log, 8, NOW);
  const djs = rolled[0], demos = rolled[1];
  ok('this week counts only this week', djs.thisWeek === 2, djs);
  ok('eight weeks come back as eight numbers', djs.last8Weeks.length === 8, djs.last8Weeks);
  ok('last week is the entry before this one', djs.last8Weeks[6] === 1, djs.last8Weeks);
  ok('the average excludes the unfinished week', djs.weeklyAverage === 0.1, djs.weeklyAverage);
  ok('a metric with entries is marked as logged', djs.everLogged === true);
  ok('a never-logged metric is flagged, not scored zero', demos.everLogged === false && demos.thisWeek === 0, demos);
  ok('the target and cadence survive the roll-up', djs.target === 2 && djs.per === 'week', djs);
  ok('no metrics is an empty list, not a crash', I.rollUpMetrics(null, null, 8, NOW).length === 0);
  ok('no ledger yet still returns the shape', I.rollUpMetrics(metrics, null, 8, NOW)[0].last8Weeks.length === 8);

  console.log('\n— the plans, newest first —');
  const plans = I.recentPlans({ '2026-W33': 'a', '2026-W36': 'd', '2026-W34': 'b', '2026-W35': 'c' }, 3);
  ok('newest week comes first', plans[0].week === '2026-W36', plans);
  ok('only the asked-for number come back', plans.length === 3, plans);
  ok('the words are carried, not just the id', plans[0].plan === 'd', plans);
  ok('no plans is an empty list', I.recentPlans(null).length === 0);

  console.log('\n— parsing what the model sends back —');
  const good = I.parseDirection('{"lede":"L","today":"T","trajectory":"J","actions":["a","b"],"watch":["w"]}');
  ok('clean JSON parses', good.lede === 'L' && good.actions.length === 2 && good.watch[0] === 'w', good);
  const fenced = I.parseDirection('Here you go:\n```json\n{"lede":"L2","actions":["x"]}\n```\nhope that helps');
  ok('JSON inside a code fence still parses', fenced.lede === 'L2' && fenced.actions[0] === 'x', fenced);
  const loose = I.parseDirection('Sure thing. {"lede":"L3","today":"T3"} — let me know.');
  ok('JSON buried in prose still parses', loose.lede === 'L3' && loose.today === 'T3', loose);
  const prose = I.parseDirection('I could not do that.');
  ok('plain prose degrades to a readable panel rather than an error',
     prose.today === 'I could not do that.' && Array.isArray(prose.actions), prose);
  const junk = I.parseDirection('{"lede":123,"actions":"not a list","watch":[1,2]}');
  ok('wrong types are dropped, never rendered',
     junk.lede === '' && junk.actions.length === 0 && junk.watch.length === 0, junk);
  ok('nothing at all is still an object', typeof I.parseDirection(null) === 'object');

  console.log('\n— the context it builds —');
  const seen = [];
  const built = await I.buildDirectionContext(reader({
    'flow:ns:birth': '1990-09-04',
    'flow:ns:principle': 'Protect my time.',
    'flow:ns:metrics': metrics,
    'flow:ns:log': log,
    'ld_compass': { mission: 'M', plans: { '2026-W36': 'ship the mixtape' }, rocks: { '2026-W36': [{ title: 'R', done: false }] } },
    'ld_quad': { items: [{ q: 1, txt: 'open one', done: false }, { q: 2, txt: 'closed', done: true }] },
    'ld_journal': new Array(120).fill(0).map((_, i) => 'entry ' + i)
  }, seen));
  ok('the sign is derived from the stored birth date', built.sign === 'Virgo', built.sign);
  ok('the weekly plan is carried in their own words',
     built.data.weeklyPlansInTheirOwnWords[0].plan === 'ship the mixtape', built.data.weeklyPlansInTheirOwnWords);
  ok('metrics arrive rolled up, not as a raw ledger',
     Array.isArray(built.data.metrics) && built.data.metrics[0].last8Weeks, built.data.metrics && built.data.metrics[0]);
  ok('done priorities are left out', built.data.priorities.length === 1, built.data.priorities);
  ok('the activity log is trimmed to a sane window', built.data.activityLog.length === 70, built.data.activityLog.length);
  ok('every read went through the caller-scoped reader', seen.length > 0 && seen.every(k => typeof k === 'string'));
  const empty = await I.buildDirectionContext(reader({}));
  ok('a brand-new account produces a context, not a crash', empty && empty.sign === null && Array.isArray(empty.data.metrics));

  console.log('\n— the money guards —');
  const cfg = I.directionConfig();
  ok('there is a daily cap on refreshes', cfg.cap > 0, cfg);

  /* No key, no spend — proved through the real handler. */
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete require.cache[require.resolve('../flow-extras.js')];
  const fresh = require('../flow-extras.js');
  let status = 0, payload = null;
  const res = {};
  const ctx = {
    json: (r, s, b) => { status = s; payload = b; },
    readBody: async () => '{}',
    mine: reader({}),
    counter: { get: async () => 0, set: async () => {} }
  };
  await fresh.handle('/api/flow/direction', { method: 'POST' }, res, ctx);
  ok('with no API key it refuses rather than half-working', status === 503, { status, payload });
  if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

  /* With a key but a cache hit, it must not call out at all. */
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  delete require.cache[require.resolve('../flow-extras.js')];
  const fresh2 = require('../flow-extras.js');
  const store = {};
  store['dir:' + new Date().toISOString().slice(0, 10)] = { lede: 'cached lede', today: 'T', actions: [], watch: [] };
  let s2 = 0, p2 = null, wrote = 0;
  await fresh2.handle('/api/flow/direction', { method: 'POST' }, {}, {
    json: (r, s, b) => { s2 = s; p2 = b; },
    readBody: async () => '{}',
    mine: reader({}),
    counter: { get: async (k) => store[k] || 0, set: async () => { wrote++; } }
  });
  ok('today\'s reading is served from cache', s2 === 200 && p2.cached === true && p2.lede === 'cached lede', p2);
  ok('a cache hit spends nothing', wrote === 0, wrote);

  /* Over the cap, an explicit refresh is refused. */
  let s3 = 0, p3 = null;
  await fresh2.handle('/api/flow/direction', { method: 'POST' }, {}, {
    json: (r, s, b) => { s3 = s; p3 = b; },
    readBody: async () => JSON.stringify({ refresh: true }),
    mine: reader({}),
    counter: { get: async (k) => (k.indexOf('dirn:') === 0 ? 99 : 0), set: async () => {} }
  });
  ok('past the daily cap a refresh is refused, not silently spent', s3 === 429, { s3, p3 });
  if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey; else delete process.env.ANTHROPIC_API_KEY;

  console.log('\n— it can only read —');
  const src = require('fs').readFileSync(require.resolve('../flow-extras.js'), 'utf8');
  const dirBlock = src.slice(src.indexOf('async function handleDirection'));
  ok('the handler never writes to the person\'s own store',
     !/mine\s*\.\s*set/.test(dirBlock) && !/mine\s*\.\s*put/.test(dirBlock));

  console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ all ' + pass + ' passed') + ' (' + (pass + fail) + ' checks)');
  process.exit(fail ? 1 : 0);
})();
