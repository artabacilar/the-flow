/* The upgrade pack writes under `flow:*`. The store lists keys with
   `KEYS ld_*`, so all() never returns them — which means adoption, which walks
   all(), skipped every single one. Written journal entries, notes, settings,
   the schedule, expenses and receipt photos were all left behind in the
   un-namespaced space, invisible to the signed-in owner. They have to be
   claimed by name. */
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };
const jar = {};
const call = async (p, o = {}, who = 'a') => {
  const h = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (jar[who]) h.Cookie = jar[who];
  const r = await fetch(H + p, Object.assign({}, o, { headers: h }));
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  let b = null; try { b = await r.json(); } catch (e) {}
  return { status: r.status, body: b };
};
const get = async (k, who) => (await call('/api/get?key=' + encodeURIComponent(k), {}, who)).body.value;
const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };

(async () => {
  console.log('\n— the owner signs in —');
  let r = await call('/api/auth/login', { method: 'POST',
    body: JSON.stringify({ email: 'artur.abacilar@abko.com.tr', password: 'a properly long password' }) }, 'artur');
  ok('login succeeds', r.status === 200, r.body);

  console.log('\n— the pack keys are rescued by name —');
  r = await call('/api/auth/me', {}, 'artur');
  ok('me reports the pack rescue', r.body.packHealed === 7, r.body.packHealed);

  const j = parse(await get('flow:journal', 'artur'));
  ok('written journal entries are back', Array.isArray(j) && j.length === 3, j && j.length);
  ok('and they are the real ones', j && /first real entry/.test(JSON.stringify(j)), (j || [])[0]);
  const notes = parse(await get('flow:notes', 'artur'));
  ok('note brackets are back', Array.isArray(notes) && notes.length === 2, notes && notes.length);
  const set = parse(await get('flow:settings', 'artur'));
  ok('settings are back', set && set.displayName === 'Artur', set);
  const sch = parse(await get('flow:schedule', 'artur'));
  ok('the schedule is back', sch && sch.map && Object.keys(sch.map).length === 2, sch);

  console.log('\n— receipt photos are followed from the expenses that reference them —');
  const exp = parse(await get('flow:expenses', 'artur'));
  ok('expenses are back', Array.isArray(exp) && exp.length === 2, exp && exp.length);
  const photo = await get('flow:receipt:r1', 'artur');
  ok('the referenced receipt photo came with them', typeof photo === 'string' && photo.indexOf('data:image') === 0, String(photo).slice(0, 24));
  ok('a receipt that nothing references is left behind', (await get('flow:receipt:orphan', 'artur')) == null);

  console.log('\n— it never overwrites something newer —');
  const newer = parse(await get('flow:profile', 'artur'));
  ok('the profile written AFTER the fix is untouched', newer && newer.marker === 'newer', newer);

  console.log('\n— and it is inert from then on —');
  await call('/api/set', { method: 'POST',
    body: JSON.stringify({ key: 'flow:journal', value: JSON.stringify([{ txt: 'today only' }]) }) }, 'artur');
  r = await call('/api/auth/me', {}, 'artur');
  ok('a later load rescues nothing', r.body.packHealed === 0, r.body.packHealed);
  ok('and the newer journal survives', parse(await get('flow:journal', 'artur')).length === 1);

  console.log('\n— the diagnostic can now see unlistable keys —');
  r = await call('/api/auth/diag', {}, 'artur');
  ok('it reports both sides for each pack key', r.body.pack && r.body.pack['flow:journal'].legacy > 0, r.body.pack && r.body.pack['flow:journal']);
  ok('and records that the claim ran', !!r.body.packClaimed, r.body.packClaimed);

  console.log('\n— a family member gets none of it —');
  r = await call('/api/auth/signup', { method: 'POST',
    body: JSON.stringify({ email: 'brother@example.com', password: 'another long password', invite: 'letmein' }) }, 'bro');
  ok('second account created', r.status === 200, r.body);
  r = await call('/api/auth/me', {}, 'bro');
  ok('nothing is rescued for a non-owner', !r.body.packHealed, r.body.packHealed);
  ok("brother sees no journal of Artur's", (await get('flow:journal', 'bro')) == null);
  ok('brother sees no notes', (await get('flow:notes', 'bro')) == null);
  ok('brother sees no receipt photo', (await get('flow:receipt:r1', 'bro')) == null);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
