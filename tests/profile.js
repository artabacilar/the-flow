#!/usr/bin/env node
/* Start a replica against a given dashboard and report time-to-navigation.
 *
 *   node tests/profile.js                       # the committed file
 *   node tests/profile.js path/to/other.html    # something to compare it to
 *   LAT=600 node tests/profile.js               # a slower network
 */
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const HERE = __dirname;
const PORT = 4222;
const DASH = process.argv[2] || path.join(HERE, '..', 'life-dashboard.html');
const SEED = path.join(HERE, 'fixtures', '.big.json');

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

(async () => {
  fs.writeFileSync(SEED, execFileSync(process.execPath,
    [path.join(HERE, 'fixtures', 'mkseed-big.js')], { maxBuffer: 64 * 1024 * 1024 }));

  if (!(await waitFor(false, 8000))) { console.error('port ' + PORT + ' is busy'); process.exit(2); }

  const env = Object.assign({}, process.env, {
    DASH, SEED_FILE: SEED, PORT: String(PORT),
    FLOW_INVITE_CODE: 'letmein', FLOW_OWNER_EMAIL: 'artur.abacilar@abko.com.tr'
  });
  const server = spawn(process.execPath, [path.join(HERE, 'server-replica.js')], { env, stdio: 'ignore' });
  if (!(await waitFor(true, 20000))) { console.error('the replica never came up'); process.exit(2); }

  const r = spawn(process.execPath, [path.join(HERE, process.env.PROBE || 'prof-open.js')], { env, stdio: 'inherit' });
  await new Promise((res) => r.on('close', res));

  server.kill('SIGKILL');
  await waitFor(false, 8000);
})();
