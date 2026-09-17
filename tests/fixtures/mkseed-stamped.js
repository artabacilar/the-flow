/* An account exactly as the App Store demo account was.
 *
 * Created before the starter week existed. Signed into once, so the app
 * wrote a blank section for everything it found missing and pushed those up.
 * Then the FIRST version of the rescue looked at it, asked whether the
 * namespace was empty, found keys, and stamped it "not empty — nothing to
 * do" without a version number on the stamp.
 *
 * Every later fix then skipped this account, because a record of having
 * declined to act was being read as a record of being done. No suite ever
 * built this state, which is why every suite stayed green while the account
 * a reviewer was about to open stayed blank.
 */
const { _internals: { hashPassword } } = require('../../flow-auth.js');
const crypto = require('crypto');

const uid = 'deadbeef00112233445566';
const salt = crypto.randomBytes(16).toString('hex');
const pre = 'ld_u' + uid + ':';

const D = {};

/* What the app itself writes during boot when it finds nothing: present,
   and completely blank. This is the state the old check mistook for use. */
D[pre + 'ld_compass']  = JSON.stringify({ mission: '', roles: ['Work', 'Health & Body'], rocks: {}, saw: {}, reviews: {} });
D[pre + 'ld_habits']   = JSON.stringify({ habits: [], completions: {} });
D[pre + 'ld_training'] = JSON.stringify({ weeks: {}, times: {}, weights: [], plans: {}, workouts: {} });
D[pre + 'ld_journal']  = JSON.stringify([]);

D['__auth:users'] = JSON.stringify({
  'demo@example.com': {
    id: uid, email: 'demo@example.com', name: 'Demo',
    salt, hash: hashPassword('a properly long password', salt),
    owner: false, created: '2026-09-15T00:00:00Z'
  }
});
D['__auth:seed:' + uid] = JSON.stringify('template');

/* The stamp from the version that wrote nothing. No `v`, no `seeded`. */
D['__auth:started:' + uid] = JSON.stringify({ at: '2026-09-16T12:00:00Z', seeded: 0, reason: 'not empty' });

process.stdout.write(JSON.stringify(D));
