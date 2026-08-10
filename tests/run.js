#!/usr/bin/env node
/* One entry point for every suite.
 *
 * This replaces the pile of shell runners that grew up alongside these tests.
 * They worked, but each one hard-coded a path, and killing stale servers with
 * `pkill -f server-replica` matched the shell that ran it often enough to be a
 * genuine nuisance. Here each suite gets its own replica as a child process,
 * addressed by pid, and the runner waits for the port instead of sleeping.
 *
 * Every suite needs a *fresh* server: the owner account can only be created
 * once, so a replica that survives into the next suite makes the next signup
 * fail in a way that looks like a product bug and is not one.
 *
 *   node tests/run.js              # everything
 *   node tests/run.js nav share    # just these
 *   DASH=path/to/other.html node tests/run.js
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const HERE = __dirname;
const PORT = 4222;
const OWNER = 'artur.abacilar@abko.com.tr';
const DASH = process.env.DASH || path.join(HERE, '..', 'life-dashboard.html');

/* A seed is a generator plus the environment that shapes it — `heal` wants the
   same fixture as `recover` but with the v2 claim marker already written, so
   the two cannot be told apart by filename alone. */
const SEEDS = {
  legacy:  ['mkseed-legacy.js', {}],
  claimed: ['mkseed.js',        {}],
  v2:      ['mkseed.js',        { V2: '1' }],
  pack:    ['mkseed-pack.js',   {}],
  strip:   ['mkseed-strip.js',  {}],
  big:     ['mkseed-big.js',    {}]
};

const seedFile = (name) => {
  const spec = SEEDS[name];
  if (!spec) throw new Error('no such seed: ' + name);
  const out = path.join(HERE, 'fixtures', '.' + name + '.json');
  const r = require('child_process').execFileSync(
    process.execPath, [path.join(HERE, 'fixtures', spec[0])],
    { env: Object.assign({}, process.env, spec[1]), maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(out, r);
  return out;
};

/* name, script, env. Anything with an owner email must sign that account up
   first; anything that creates several ordinary accounts must not set it. */
const SUITES = [
  ['auth',     'test-auth.js',     {}],
  ['migrate',  'test-migrate.js',  { seed: 'legacy' }],
  ['authui',   'test-authui.js',   { FLOW_INVITE_CODE: 'letmein' }],
  ['template', 'test-template.js', { SEED: JSON.stringify({ ld_journal: '[]' }) }],
  ['owner',    'test-owner.js',    { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein' }],
  ['heal',     'test-heal.js',     { FLOW_OWNER_EMAIL: OWNER, V2: '1', seed: 'v2' }],
  ['recover',  'test-recover.js',  { FLOW_OWNER_EMAIL: OWNER, seed: 'claimed' }],
  ['pack',     'test-pack.js',     { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein', seed: 'pack' }],
  ['cap',      'test-cap.js',      { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein', FLOW_MAX_ACCOUNTS: '3' }],
  ['strip',    'test-strip.js',    { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein', seed: 'strip' }],
  ['split',    'test-split.js',    {}],
  ['nav',      'test-nav.js',      { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein' }],
  ['chat',     'test-chat.js',     { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein' }],
  ['prices',   'test-prices.js',   { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein' }],
  ['qwrap',    'test-qwrap.js',    { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein' }],
  ['share',    'test-share.js',    { FLOW_OWNER_EMAIL: OWNER, FLOW_INVITE_CODE: 'letmein' }],
  /* test-client signs up three ordinary people, so the owner rule would
     reject the first of them. It deliberately runs without one. */
  ['client',   'test-client.js',   { FLOW_INVITE_CODE: 'letmein' }]
];

const listening = () => new Promise((res) => {
  const s = net.connect(PORT, '127.0.0.1');
  s.on('connect', () => { s.destroy(); res(true); });
  s.on('error', () => res(false));
});

const waitFor = async (want, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await listening() === want) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
};

const run = (cmd, args, env) => new Promise((res) => {
  const c = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
  c.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
  c.on('close', (code) => res({ code, out }));
});

(async () => {
  if (!fs.existsSync(DASH)) {
    console.error('no dashboard to test at ' + DASH);
    process.exit(2);
  }
  const only = process.argv.slice(2);
  const chosen = only.length ? SUITES.filter((s) => only.includes(s[0])) : SUITES;
  if (!chosen.length) {
    console.error('no suite matched: ' + only.join(', '));
    process.exit(2);
  }

  if (!(await waitFor(false, 8000))) {
    console.error('port ' + PORT + ' is already in use — stop whatever is on it first');
    process.exit(2);
  }

  let failed = 0, checks = 0, bad = 0;
  for (const [name, script, cfg] of chosen) {
    const env = Object.assign({}, process.env, { DASH, PORT: String(PORT) });
    for (const k of Object.keys(cfg)) if (k !== 'seed') env[k] = cfg[k];
    if (cfg.seed) env.SEED_FILE = seedFile(cfg.seed);

    const server = spawn(process.execPath, [path.join(HERE, 'server-replica.js')],
      { env, stdio: 'ignore', detached: false });

    if (!(await waitFor(true, 20000))) {
      console.log('\n=== ' + name + ' ===\n  the replica never came up');
      failed++; server.kill('SIGKILL');
      await waitFor(false, 5000);
      continue;
    }

    console.log('\n=== ' + name + ' ===');
    const r = await run(process.execPath, [path.join(HERE, script)], env);
    const m = /(\d+) passed, (\d+) failed/.exec(r.out);
    if (m) { checks += Number(m[1]) + Number(m[2]); bad += Number(m[2]); }
    if (r.code !== 0 || (m && Number(m[2]) > 0)) failed++;

    server.kill('SIGKILL');
    await waitFor(false, 8000);
  }

  console.log('\n' + '─'.repeat(52));
  console.log(chosen.length + ' suites · ' + checks + ' checks · ' + bad + ' failing');
  console.log(failed ? failed + ' SUITE(S) FAILED' : 'all green');
  process.exit(failed ? 1 : 0);
})();
