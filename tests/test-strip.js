/* The shipped file is now the generic template. Two things must hold:
   a stranger sees nothing of the owner's anywhere, and the owner — whose
   content now lives only in his account — gets every bit of it back. */
const { chromium } = require('playwright');
const H = 'http://localhost:4222';

const PERSONAL = /CRM lead generation|Meet with Burak|Mali Ne[sş]e|Kanye West|Seamless\.ai|Goldwell|DualSense|Sabah spor|Hidrolize kolajen|3 litre su|promoters ?\/ ?distributors|ABKO|DTC Business|buy my freedom|outlives me|Burak/i;

(async () => {
  const b = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
    : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

  /* ---------- 1 · the file itself, before anyone signs in ---------- */
  console.log('\n— the file served to the world —');
  const raw = await fetch(H + '/').then(r => r.text());
  const found = (raw.match(new RegExp(PERSONAL.source, 'gi')) || [])
    .filter(x => !/^abko$/i.test(x));           // internal element ids only
  ok('page source carries no personal content', found.length === 0, [...new Set(found)]);
  ok('no mission statement in the source', !/buy my freedom|outlives me/i.test(raw));
  ok('no Turkish meal plan in the source', !/Hidrolize|Takviye Planı|ana öğün/i.test(raw));
  ok('no personal priorities in the source', !/CRM lead generation|Kanye West|Mali Ne/i.test(raw));

  /* ---------- 2 · a stranger ---------- */
  console.log('\n— a stranger who has the link —');
  const c2 = await b.newContext(); const p2 = await c2.newPage();
  const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.goto(H + '/', { waitUntil: 'load' }); await p2.waitForTimeout(2500);
  await p2.click('#fa-alt').catch(() => {}); await p2.waitForTimeout(300);
  await p2.fill('#fa-email', 'stranger@example.com');
  await p2.fill('#fa-name', 'Stranger');
  await p2.fill('#fa-pw', 'a properly long password');
  await p2.fill('#fa-inv', 'letmein').catch(() => {});
  await Promise.all([p2.waitForNavigation({ timeout: 15000 }).catch(() => {}), p2.click('#fa-go')]);
  await p2.waitForTimeout(3500);

  const strangerLeak = await p2.evaluate(src => {
    const re = new RegExp(src, 'i'); const hits = [];
    document.querySelectorAll('.section, .tabs, #moreGrid').forEach(n =>
      (n.innerText || '').split('\n').forEach(l => { if (re.test(l)) hits.push(l.trim().slice(0, 70)); }));
    return [...new Set(hits)];
  }, PERSONAL.source);
  ok('nothing personal is rendered for them', strangerLeak.length === 0, strangerLeak);

  const gen = await p2.evaluate(() => ({
    ws: (typeof Flow !== 'undefined' ? Flow.Profile.data.workspaces.map(w => w.name) : []),
    pill: (document.querySelector('.tab[data-tab="abko"]') || {}).textContent,
    diet: (typeof DIET_COMMON !== 'undefined' ? DIET_COMMON.map(r => r[1]) : []),
    mission: (typeof DEFAULT_MISSION !== 'undefined' ? DEFAULT_MISSION : null),
    meals: (document.querySelector('#tab-diet .mealcards') || {}).innerText || '',
    planner: (document.querySelector('.tab[data-tab="artur"]') || {}).textContent
  }));
  ok('boards are Work / Side Project', gen.ws[0] === 'Work' && gen.ws[1] === 'Side Project', gen.ws);
  ok('tab pill is generic', /Work/.test(gen.pill || '') && !/ABKO/.test(gen.pill || ''), gen.pill);
  ok('diet checklist is generic English', gen.diet.some(d => /water/i.test(d)) && !gen.diet.some(d => /litre su|kolajen/i.test(d)), gen.diet.slice(0, 3));
  ok('mission starts empty', gen.mission === '', gen.mission);
  ok('meal plan is an empty state, not a diet', !/kolajen|öğün/i.test(gen.meals), gen.meals.slice(0, 60));
  ok('the planner tab is no longer named after the owner', !/Artur/i.test(gen.planner || ''), gen.planner);
  ok('no page errors for them', e2.length === 0, e2.slice(0, 2));

  /* ---------- 3 · the owner ---------- */
  console.log('\n— the owner, whose content lives in his account —');
  const c1 = await b.newContext(); const p1 = await c1.newPage();
  const e1 = []; p1.on('pageerror', e => e1.push(e.message));
  await p1.goto(H + '/', { waitUntil: 'load' }); await p1.waitForTimeout(2500);
  await p1.fill('#fa-email', 'artur.abacilar@abko.com.tr');
  await p1.fill('#fa-pw', 'a properly long password');
  await Promise.all([p1.waitForNavigation({ timeout: 15000 }).catch(() => {}), p1.click('#fa-go')]);
  await p1.waitForTimeout(4000);

  const mine = await p1.evaluate(() => ({
    isNew: Flow.Profile.isNew,
    ws: Flow.Profile.data.workspaces.map(w => w.name),
    pillA: (document.querySelector('.tab[data-tab="abko"]') || {}).textContent,
    hdrA: (document.querySelector('#tab-abko .section-header') || {}).textContent,
    diet: (typeof DIET_COMMON !== 'undefined' ? DIET_COMMON.map(r => r[1]) : []),
    saw: (typeof SAW_ITEMS !== 'undefined' ? SAW_ITEMS.map(r => r[1]) : []),
    quad: (typeof QUAD_DEFAULTS !== 'undefined' ? QUAD_DEFAULTS.map(r => r[1]) : []),
    plan: (typeof PLAN !== 'undefined' ? PLAN.map(d => d.title) : []),
    mission: (typeof cData !== 'undefined' && cData ? cData.mission : ''),
    dietHdr: (document.querySelector('#tab-diet .section-header') || {}).textContent,
    dietSub: (document.querySelector('#tab-diet .section-sub') || {}).textContent,
    meals: (document.querySelector('#tab-diet .mealcards') || {}).innerText || '',
    habit4: (document.querySelectorAll('.habits7 .h7')[3] || {}).innerText || ''
  }));
  ok('he is not treated as new', mine.isNew === false, mine.isNew);
  ok('his boards are back', mine.ws[0] === 'ABKO' && mine.ws[1] === 'DTC Business', mine.ws);
  ok('his tab pill says ABKO', /ABKO/.test(mine.pillA || ''), mine.pillA);
  ok('his section header says ABKO', /ABKO/.test(mine.hdrA || ''), mine.hdrA);
  ok('his Turkish diet checklist is back', mine.diet.some(d => /3 litre su/.test(d)), mine.diet.slice(0, 3));
  ok('his saw items are back', mine.saw.some(x => /Burak/.test(x)), mine.saw.filter(x => /Burak/.test(x)));
  ok('his five personal priorities are back', mine.quad.filter(q => PERSONAL.test(q)).length === 5, mine.quad.filter(q => PERSONAL.test(q)).length);
  ok('his own training plan is back', mine.plan.some(t => /Upper Body — Strength/.test(t)), mine.plan.slice(0, 2));
  ok('his mission statement is back', /buy my freedom/i.test(mine.mission || ''), (mine.mission || '').slice(0, 40));
  ok('his Turkish diet heading is back', /Kas Kütlesi/i.test(mine.dietHdr || ''), mine.dietHdr);
  ok('his Turkish diet blurb is back', /3 litre su/i.test(mine.dietSub || ''), (mine.dietSub || '').slice(0, 50));
  ok('his full Turkish meal plan is back', /Hidrolize kolajen/i.test(mine.meals), mine.meals.slice(0, 60));
  ok('his habit blurb naming Burak is back', /Burak/.test(mine.habit4), mine.habit4.slice(0, 60));
  ok('no page errors for him', e1.length === 0, e1.slice(0, 2));
  const mineTab = await p1.evaluate(() => ({
    pill: (document.querySelector('.tab[data-tab="artur"]') || {}).textContent,
    sheet: (document.querySelector('#moreGrid [data-flow-goto="artur"]') || {}).textContent
  }));
  ok("the planner tab shows the owner's own name", /Artur/.test(mineTab.pill || ''), mineTab.pill);

  /* ---------- 4 · they stay separate ---------- */
  console.log('\n— and the two never bleed into each other —');
  const after = await p2.evaluate(() => ({
    ws: Flow.Profile.data.workspaces.map(w => w.name),
    diet: (typeof DIET_COMMON !== 'undefined' ? DIET_COMMON.map(r => r[1]) : [])
  }));
  ok("the stranger's app is still generic", after.ws[0] === 'Work' && !after.diet.some(d => /litre su/.test(d)), after);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
