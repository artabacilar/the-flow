/* The pre-accounts world: ld_* keys sitting in the store with nobody owning
   them. This is what the migration has to claim exactly once, for exactly the
   owner, without handing any of it to anyone who signs up afterwards. */
const j = [];
for (let i = 0; i < 295; i++) j.push({ t: '2025-0' + (1 + (i % 9)) + '-01', txt: 'entry ' + i });
process.stdout.write(JSON.stringify({
  ld_journal: JSON.stringify(j),
  ld_training: JSON.stringify({ week: 1, done: [] }),
  ld_finance: JSON.stringify({ tx: [] }),
  ld_notes: JSON.stringify([])
}));
