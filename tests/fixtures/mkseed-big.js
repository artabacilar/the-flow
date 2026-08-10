/* A seed roughly the size of the real account: ~1.3MB across the keys the app
   actually reads at boot, so the profile measures a real payload, not an empty
   one. Deliberately spread across both ld_* and flow:* namespaces, because the
   point of the DB-seeding fix is that the flow:* half arrives in the same
   download and no longer needs its own round-trips. */
const { _internals: { hashPassword } } = require('../../flow-auth.js');
const crypto = require('crypto');
const uid = 'a1b2c3d4e5f60718293a', salt = crypto.randomBytes(16).toString('hex');

const journal = [];
for (let i = 0; i < 400; i++) {
  journal.push({ t: '2026-0' + (1 + (i % 9)) + '-1' + (i % 9), txt: 'A journal entry with a realistic amount of text in it, number ' + i + '. ' + 'x'.repeat(2200), prompts: {}, mood: 1 + (i % 5), energy: 1 + (i % 5) });
}
const log = [];
for (let i = 0; i < 396; i++) log.push({ t: '2026-07-' + (1 + (i % 28)), what: 'activity ' + i, detail: 'y'.repeat(600) });
const q = { items: [] };
for (let i = 0; i < 25; i++) q.items.push({ id: 'q' + i, q: 1 + (i % 4), txt: 'Priority number ' + i, done: false });

const data = {
  ld_journal: JSON.stringify(journal),
  ld_log: JSON.stringify(log),
  ld_quad: JSON.stringify(q),
  ld_training: JSON.stringify({ week: 1, done: [] }),
  ld_finance: JSON.stringify({ tx: [] }),
  ld_notes: JSON.stringify([]),
  'flow:settings': JSON.stringify({ displayName: 'Artur', lang: 'en' }),
  'flow:schedule': JSON.stringify({}),
  'flow:notes': JSON.stringify({}),
  'flow:expenses': JSON.stringify([]),
  'flow:markets': JSON.stringify({ watch: ['BTCUSD', 'USDTRY', 'EURTRY', 'GRAMGOLDTRY'] }),
  'flow:planner': JSON.stringify({})
};

const D = {};
for (const k in data) D['ld_u' + uid + ':' + k] = data[k];
D['__auth:users'] = JSON.stringify({
  'artur.abacilar@abko.com.tr': {
    id: uid, email: 'artur.abacilar@abko.com.tr', name: 'Artur',
    salt, hash: hashPassword('a properly long password', salt),
    owner: true, created: '2026-08-03T00:00:00Z'
  }
});
process.stdout.write(JSON.stringify(D));
