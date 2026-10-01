/* The reminder goes off at nine where the person is, not where the server is.
 *
 * Render runs in UTC. Somebody in Istanbul who writes 09:00 means 09:00 where
 * they are, and a scheduler using the server's hour would fire at noon for
 * them — reliably, every day, with nothing in any log looking wrong. That is
 * the failure this file exists to prevent, so most of what follows is the
 * same rock seen from several timezones.
 *
 * Nothing here touches Apple. The sender is a function that records what it
 * was asked to do, which is the only way to assert "it did NOT send" at all.
 */
const path = require('path');
const remind = require(path.join(__dirname, '..', 'flow-remind.js'));
const mcp = require(path.join(__dirname, '..', 'flow-mcp.js'));
const flowAuth = require(path.join(__dirname, '..', 'flow-auth.js'));
const I = remind._internals;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

/* A raw store in a Map, and a sender that only remembers. */
function harness(seed) {
  const mem = Object.assign({}, seed || {});
  const sent = [];
  return {
    mem, sent,
    deps: {
      raw: {
        get: async (k) => (k in mem ? mem[k] : null),
        set: async (k, v) => { mem[k] = v; }
      },
      users: async () => ['u1'],
      nsPrefix: flowAuth.nsPrefix,
      sendToUser: async (raw, uid, note) => { sent.push({ uid, note }); return { ok: true, sent: 1 }; }
    }
  };
}

const account = (tz, rocks, extra) => Object.assign({
  '__push:dev:u1': JSON.stringify([{ token: 'a'.repeat(64), env: 'production' }]),
  [flowAuth.nsPrefix('u1') + 'flow:settings']: JSON.stringify(Object.assign({ timezone: tz }, extra || {})),
  [flowAuth.nsPrefix('u1') + 'ld_compass']: JSON.stringify({ rocks })
}, {});

(async () => {
  console.log('\n— the week this file computes is the week the app shows —');
  /* Two implementations of the ISO week is two different answers eventually,
     and the symptom is a reminder for a rock the person cannot see. */
  let agree = true, firstBad = null;
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i, 12, 0, 0));
    const iso = d.toISOString().slice(0, 10);
    const mine = I.weekIdFromDate(iso);
    const theirs = mcp._internals.weekId(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    if (mine !== theirs) { agree = false; firstBad = { iso, mine, theirs }; break; }
  }
  ok('every date for over a year agrees with flow-mcp', agree, firstBad);
  ok('and the namespace rule is the one flow-auth owns, not a copy',
     typeof flowAuth.nsPrefix === 'function' && flowAuth.nsPrefix('7') === 'ld_u7:', flowAuth.nsPrefix && flowAuth.nsPrefix('7'));

  console.log('\n— nine in the morning, where the person is —');
  /* 06:00 UTC is 09:00 in Istanbul and 07:00 in London. One instant, two
     answers, and only one of them should fire a 09:00 rock. */
  const instant = new Date('2026-10-01T06:00:00Z');   /* a Thursday */
  const rock = { id: 'r1', title: 'Two hours on the quarter plan', time: '09:00', day: 3, done: false };

  const ist = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  await remind.tick(ist.deps, instant);
  ok('Istanbul gets it at 09:00 local', ist.sent.length === 1, ist.sent);
  ok('and it carries the rock\'s own title',
     ist.sent[0] && ist.sent[0].note.title === 'Two hours on the quarter plan', ist.sent[0]);

  const lon = harness(account('Europe/London', { '2026-W40': [rock] }));
  await remind.tick(lon.deps, instant);
  ok('London does not, because it is only 07:00 there', lon.sent.length === 0, lon.sent);

  /* And two hours later London does. */
  const lon2 = harness(account('Europe/London', { '2026-W40': [rock] }));
  await remind.tick(lon2.deps, new Date('2026-10-01T08:00:00Z'));
  ok('London gets it at its own 09:00', lon2.sent.length === 1, lon2.sent);

  console.log('\n— and never twice —');
  const twice = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  await remind.tick(twice.deps, instant);
  await remind.tick(twice.deps, new Date('2026-10-01T06:01:00Z'));
  await remind.tick(twice.deps, new Date('2026-10-01T06:02:00Z'));
  ok('three ticks inside the window send once', twice.sent.length === 1, twice.sent.length);
  /* The marker is in the store, so a restart does not undo it. */
  const fresh = harness(twice.mem);
  await remind.tick(fresh.deps, new Date('2026-10-01T06:03:00Z'));
  ok('and a restart does not re-send it', fresh.sent.length === 0, fresh.sent);

  console.log('\n— a missed minute is still worth sending; an outage is not —');
  const late = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  await remind.tick(late.deps, new Date('2026-10-01T06:04:00Z'));   /* four minutes late */
  ok('four minutes late still arrives', late.sent.length === 1, late.sent);

  const tooLate = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  await remind.tick(tooLate.deps, new Date('2026-10-01T08:30:00Z')); /* hours later */
  ok('hours later does not — coming back up is not a reason to deliver the morning',
     tooLate.sent.length === 0, tooLate.sent);

  const early = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  await remind.tick(early.deps, new Date('2026-10-01T05:58:00Z'));
  ok('and it is never early', early.sent.length === 0, early.sent);

  console.log('\n— what it declines to send —');
  const done = harness(account('Europe/Istanbul', { '2026-W40': [Object.assign({}, rock, { done: true })] }));
  await remind.tick(done.deps, instant);
  ok('nothing for a rock already ticked', done.sent.length === 0, done.sent);

  const untimed = harness(account('Europe/Istanbul', { '2026-W40': [Object.assign({}, rock, { time: '' })] }));
  await remind.tick(untimed.deps, instant);
  ok('nothing for a rock with no time on it', untimed.sent.length === 0, untimed.sent);

  const otherDay = harness(account('Europe/Istanbul', { '2026-W40': [Object.assign({}, rock, { day: 0 })] }));
  await remind.tick(otherDay.deps, instant);
  ok('nothing for a rock planned for another day', otherDay.sent.length === 0, otherDay.sent);

  const off = harness(account('Europe/Istanbul', { '2026-W40': [rock] }, { pushRemindRocks: false }));
  await remind.tick(off.deps, instant);
  ok('nothing when the person turned reminders off', off.sent.length === 0, off.sent);

  const noDevice = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  delete noDevice.mem['__push:dev:u1'];
  await remind.tick(noDevice.deps, instant);
  ok('nothing when no phone is registered', noDevice.sent.length === 0, noDevice.sent);

  console.log('\n— one bad account does not silence the others —');
  const multi = harness(Object.assign(
    account('Europe/Istanbul', { '2026-W40': [rock] }),
    { [flowAuth.nsPrefix('u2') + 'ld_compass']: '{ this is not json',
      '__push:dev:u2': JSON.stringify([{ token: 'b'.repeat(64), env: 'production' }]) }
  ));
  multi.deps.users = async () => ['u2', 'u1'];
  const out = await remind.tick(multi.deps, instant);
  ok('the readable account still got its reminder', multi.sent.length === 1, multi.sent);
  ok('and the tick reported on both', out.length === 2, out);

  console.log('\n— an unknown timezone falls back rather than taking the tick down —');
  const bogus = harness(account('Mars/Olympus', { '2026-W40': [rock] }));
  let threw = false;
  try { await remind.tick(bogus.deps, instant); } catch (e) { threw = true; }
  ok('it does not throw', !threw);
  ok('and it used the default zone, which is Istanbul, so it sent',
     bogus.sent.length === 1, bogus.sent);

  console.log('\n— and it costs nothing at all when it cannot send —');
  /* Every tick that gets past this asks Upstash for the account list. Once a
     minute, for ever, to reach a conclusion that was already knowable for
     free. That is a bill somebody pays in their database quota rather than
     anywhere they would think to look. */
  const idle = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  let asked = 0;
  const realUsers = idle.deps.users;
  idle.deps.users = async () => { asked++; return realUsers(); };
  idle.deps.canSend = () => false;
  const idleOut = await remind.tick(idle.deps, instant);
  ok('it does not even ask who the accounts are', asked === 0, asked);
  ok('and sends nothing', idle.sent.length === 0, idle.sent);
  ok('returning an empty tick rather than throwing', Array.isArray(idleOut) && idleOut.length === 0, idleOut);

  const live = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  live.deps.canSend = () => true;
  await remind.tick(live.deps, instant);
  ok('and when it can send, it still does', live.sent.length === 1, live.sent);

  /* A deps object from before this existed must keep working, or the module
     is only correct when the caller remembers to pass something. */
  const noFlag = harness(account('Europe/Istanbul', { '2026-W40': [rock] }));
  delete noFlag.deps.canSend;
  await remind.tick(noFlag.deps, instant);
  ok('a caller that passes no such check is not silently switched off',
     noFlag.sent.length === 1, noFlag.sent);

  console.log('\n— the server actually starts it —');
  const fs = require('fs');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'life-os-server.js'), 'utf8');
  ok('life-os-server requires the module', /require\('\.\/flow-remind'\)/.test(srv));
  ok('and starts the tick', /remind\.start\(/.test(srv));
  ok('handing it the raw store and the shared namespace rule',
     /raw:\s*rawStore/.test(srv) && /nsPrefix:\s*flowAuth\.nsPrefix/.test(srv));
  /* Without both halves there is nothing to send with, and a tick that calls
     an absent sender every minute is just an error loop. */
  ok('only when the sender exists too', /if \(remind && push\)/.test(srv));
  ok('and hands it the question it can answer for free', /canSend:\s*push\.configured/.test(srv));

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
