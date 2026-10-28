/* Meals — a plate, photographed, as numbers.
 *
 * What would make it wrong: the model paid for by a free account past its
 * three a week; a desk or a screen accepted as a meal; prose from the model
 * going through as a blank card; the photo kept anywhere; numbers the person
 * could not change; the card on Today in Advanced; the + sheet's Meal still
 * sending Simple to the old checklist; Turkish reading English. The model is
 * never called. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const X = require('../flow-extras.js')._internals.meal;
const extras = require('../flow-extras.js');
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

const PLATE = { food: true, name: 'Grilled chicken with rice and salad', items: [{ name: 'chicken breast', amount: '150 g', kcal: 250 }, { name: 'rice', amount: '1 cup', kcal: 200 }, { name: 'salad', amount: 'side', kcal: 40 }], kcal: 490, protein_g: 45, carbs_g: 50, fat_g: 10, confidence: 'medium', note: 'The dressing is a guess.' };
const PNG = 'data:image/jpeg;base64,' + Buffer.from('not really a jpeg but the server does not look').toString('base64');

(async () => {
  console.log('\n— reading the reply —');
  const r1 = X.parseMeal('Sure:\n```json\n' + JSON.stringify(PLATE) + '\n```');
  ok('JSON inside prose is read; the names and the four numbers come through', r1 && r1.name === PLATE.name && r1.kcal === 490 && r1.protein === 45 && r1.carbs === 50 && r1.fat === 10 && r1.items.length === 3, r1);
  const r2 = X.parseMeal(JSON.stringify(Object.assign({}, PLATE, { kcal: 99999, confidence: 'sure', protein_g: -3 })));
  ok('absurd numbers are capped, a bad confidence becomes medium, a negative is zero', r2.kcal === 6000 && r2.confidence === 'medium' && r2.protein === 0, r2);
  ok('not food is said so', X.parseMeal('{"food": false, "note": "a laptop"}').food === false);
  ok('prose is nothing, not a blank meal', X.parseMeal('Looks like chicken, about 500 kcal.') === null);
  ok('a meal with items but no total gets the sum', X.parseMeal('{"name":"Toast","items":[{"name":"toast","kcal":120},{"name":"butter","kcal":80}]}').kcal === 200);
  ok('the prompt asks for JSON, forbids questions, and names the not-food case', /Return ONLY a JSON/.test(X.MEAL_SYSTEM) && /Never ask questions/.test(X.MEAL_SYSTEM) && /"food": false/.test(X.MEAL_SYSTEM));

  console.log('\n— the endpoint —');
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let sent = null, calls = 0;
  X.setPoster(async (url, headers, payload) => { calls++; sent = payload; return { status: 200, body: { content: [{ type: 'text', text: JSON.stringify(PLATE) }] } }; });
  const counter = {}; const C = { get: async (k) => counter[k] || 0, set: async (k, v) => { counter[k] = v; } };
  const call = async (body, plan) => {
    let out = null; const res = {};
    const ctx = { user: { id: 'u1' }, counter: C, plan: plan || { tier: 'plus' }, json: (r, code, o) => { out = { code, o }; }, readBody: async () => JSON.stringify(body || {}) };
    await extras.handle('/api/flow/meal', { method: 'POST', url: '/api/flow/meal', headers: {} }, res, ctx);
    return out;
  };
  const a = await call({ image: PNG, text: 'with a large portion of rice', lang: 'tr' });
  ok('a picture and a line come back as a meal', a.code === 200 && a.o.meal && a.o.meal.kcal === 490, a);
  ok('the model gets the picture, the line, and the language — and nothing else', sent && sent.messages[0].content[0].type === 'image' && /large portion of rice/.test(sent.messages[0].content[1].text) && /Turkish/.test(sent.messages[0].content[1].text) && !/test-key/.test(JSON.stringify(sent)), sent && sent.messages[0].content[1]);
  ok('a line alone is enough', (await call({ text: 'two eggs and toast' })).code === 200);
  ok('nothing is refused', (await call({})).code === 400);
  ok('not a picture is refused', (await call({ image: 'data:text/html;base64,PGI+' })).code === 400);
  X.setPoster(async () => ({ status: 200, body: { content: [{ type: 'text', text: '{"food": false, "note": "a laptop on a desk"}' }] } }));
  const nf = await call({ image: PNG });
  ok('a desk is not a meal: 422, said plainly, and it does not count', nf.code === 422 && nf.o.notFood && /laptop/.test(nf.o.error), nf);
  X.setPoster(async () => ({ status: 200, body: { content: [{ type: 'text', text: JSON.stringify(PLATE) }] } }));
  const free = { tier: 'free' };
  const f1 = await call({ text: 'soup' }, free), f2 = await call({ text: 'soup' }, free), f3 = await call({ text: 'soup' }, free), f4 = await call({ text: 'soup' }, free);
  ok('a free account gets three a week, then the Plus door', f1.code === 200 && f1.o.free.used === 1 && f3.code === 200 && f3.o.free.used === 3 && f4.code === 402 && f4.o.plus && f4.o.feature === 'meals', f4);
  ok('Plus is not counted against the week', (await call({ text: 'soup' })).code === 200);
  delete process.env.ANTHROPIC_API_KEY;
  ok('no key says so', (await call({ text: 'soup' })).code === 503);
  process.env.ANTHROPIC_API_KEY = 'test-key';

  console.log('\n— on Today, in Simple —');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let seen = null;
  await p.route('**/api/flow/meal', (rt) => { seen = JSON.parse(rt.request().postData() || '{}'); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, meal: X.parseMeal(JSON.stringify(PLATE)) }) }); });
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.evaluate(async () => { await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday(); }); await p.waitForTimeout(900);
  const card0 = await p.evaluate(() => { const c = document.getElementById('flow-td-meals'); return c && { vis: getComputedStyle(c).display !== 'none', head: c.querySelector('.c').textContent, add: !!c.querySelector('[data-meal-open]'), after: c.previousElementSibling && c.previousElementSibling.className }; });
  ok('a Meals card sits where the Diet list was, empty, with Log a meal', card0 && card0.vis && /nothing logged/.test(card0.head) && card0.add && /td-group/.test(card0.after), card0);
  await p.evaluate(() => Flow.Nav.openCapture()); await p.waitForTimeout(300);
  await p.click('#flow-capture [data-fn-cap="diet"]'); await p.waitForTimeout(400);
  ok('two doors to a picture: the camera (back, straight away) and the library', await p.evaluate(() => { const c = document.querySelector('#flow-meal #ml-cam'), f = document.querySelector('#flow-meal #ml-file'); return c && c.getAttribute('capture') === 'environment' && /image/.test(c.accept) && f && !f.hasAttribute('capture'); }));
  ok('the + sheet\'s Meal opens the photo sheet, not the old checklist', await p.evaluate(() => document.querySelector('#flow-meal.on') && !document.querySelector('#flow-capture.on') && document.querySelector('.tab.active').getAttribute('data-tab') === 'today'));
  await p.click('#flow-meal [data-ml="estimate"]'); await p.waitForTimeout(200);
  ok('nothing to go on is said in the sheet, not sent', await p.evaluate(() => !document.querySelector('#flow-meal .ml-err').hidden) && seen === null);
  /* a real photo: drawn here, so the shrink runs end to end */
  const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1800; const g = c.getContext('2d'); g.fillStyle = '#c8a060'; g.fillRect(0, 0, 2400, 1800); g.fillStyle = '#fff'; g.beginPath(); g.arc(1200, 900, 700, 0, 7); g.fill(); return c.toDataURL('image/png'); });
  await p.setInputFiles('#ml-file', { name: 'plate.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') }); await p.waitForTimeout(700);
  const ph = await p.evaluate(() => { const i = document.querySelector('#flow-meal .ml-photo img'); return { shown: !i.hidden && !!i.src, w: i.naturalWidth }; });
  ok('the photo is shown, shrunk to a thousand pixels on the device', ph.shown && ph.w === 1024, ph);
  await p.fill('#ml-text', 'with a large portion of rice');
  await p.click('#flow-meal [data-ml="estimate"]'); await p.waitForTimeout(800);
  ok('what left the browser: a jpeg under a megabyte, the line, the language — never the original', seen && /^data:image\/jpeg;base64,/.test(seen.image) && seen.image.length < 900 * 1024 && seen.text === 'with a large portion of rice' && seen.lang === 'en', seen && { len: seen.image && seen.image.length, text: seen.text });
  const out = await p.evaluate(() => { const el = document.getElementById('flow-meal'); return { name: el.querySelector('#ml-name').value, kcal: el.querySelector('#ml-kcal').value, prot: el.querySelector('#ml-protein').value, items: el.querySelectorAll('.ml-items li').length, conf: el.querySelector('.ml-conf').textContent }; });
  ok('the estimate is shown with every number in a field, the items, and how sure it is', out.name === PLATE.name && out.kcal === '490' && out.prot === '45' && out.items === 3 && /fair estimate/.test(out.conf) && /dressing/.test(out.conf), out);
  await p.fill('#ml-kcal', '520');
  await p.click('#flow-meal [data-ml="save"]'); await p.waitForTimeout(800);
  const saved = await p.evaluate(async () => { const d = await Flow.DB.get('flow:meals'); const t = new Date(); const k = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); const list = (d.days[k] || []); const c = document.getElementById('flow-td-meals'); return { n: list.length, kcal: list[0] && list[0].kcal, hasPhoto: JSON.stringify(d).indexOf('base64') >= 0, head: c.querySelector('.c').textContent, rows: c.querySelectorAll('.ml-row').length, sheet: !!document.querySelector('#flow-meal.on') }; });
  ok('saved with the changed number; the card on Today shows it; the photo is kept nowhere', saved.n === 1 && saved.kcal === 520 && !saved.hasPhoto && /520 kcal · 45 g protein/.test(saved.head) && saved.rows === 1 && !saved.sheet, saved);
  await p.evaluate(async () => { await Flow.Settings.set('mealKcal', 500); await Flow.Settings.set('mealProtein', 120); window.FlowMeals.paint(); }); await p.waitForTimeout(200);
  const tgt = await p.evaluate(() => { const c = document.getElementById('flow-td-meals'); return { over: !!c.querySelector('.ml-bar.over'), of: c.querySelector('.ml-of').textContent, late: c.querySelector('.c').classList.contains('late') }; });
  ok('with a target set: over it reads in coral, and says by how much', tgt.over && /20 kcal over 500/.test(tgt.of) && /75 g protein to go/.test(tgt.of) && tgt.late, tgt);
  await p.click('#flow-td-meals [data-meal-x]'); await p.waitForTimeout(400);
  ok('× removes it, with Undo', await p.evaluate(() => document.querySelectorAll('#flow-td-meals .ml-row').length === 0 && document.getElementById('ra-undo').classList.contains('on')));
  await p.click('#ra-undo button'); await p.waitForTimeout(400);
  ok('Undo brings it back', await p.evaluate(() => document.querySelectorAll('#flow-td-meals .ml-row').length === 1));
  /* the Plus door */
  await p.unroute('**/api/flow/meal');
  await p.route('**/api/flow/meal', (rt) => rt.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: 'This is part of Flow Plus.', plus: true, feature: 'meals', used: 3, cap: 3 }) }));
  await p.evaluate(() => window.FlowMeals.open()); await p.fill('#ml-text', 'soup'); await p.click('#flow-meal [data-ml="estimate"]'); await p.waitForTimeout(600);
  ok('past the free three, the Plus sheet opens and says why', await p.evaluate(() => !!document.querySelector('#flow-plus.on') && /Meals from a photo/.test(document.querySelector('#flow-plus').textContent) && !document.querySelector('#flow-meal.on')));
  await p.evaluate(() => window.FlowPlus.close());

  console.log('\n— in Turkish —');
  await p.evaluate(async () => { await Flow.Lang.set('tr'); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.FlowMeals.open()); await p.waitForTimeout(300);
  const tr = await p.evaluate(() => ({ card: document.querySelector('#flow-td-meals .l').textContent, h: document.querySelector('#flow-meal h4').textContent, est: document.querySelector('#flow-meal [data-ml="estimate"]').textContent, ph: document.querySelector('#flow-meal .ml-ph-empty b').textContent, btn: document.querySelector('#flow-td-meals .ml-add span').textContent }));
  ok('the card, the sheet and the button are Turkish', tr.card === 'Öğünler' && tr.h === 'Öğün kaydet' && tr.est === 'Tahmin et' && tr.ph === 'Fotoğraf ekle' && tr.btn === 'Öğün kaydet', tr);
  await p.evaluate(async () => { window.FlowMeals.close(); await Flow.Lang.set('en'); }); await p.waitForTimeout(600);

  console.log('\n— Advanced —');
  await p.evaluate(async () => { await Flow.Settings.set('newLook', false); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); renderToday(); }); await p.waitForTimeout(700);
  const adv = await p.evaluate(() => ({ card: !document.getElementById('flow-td-meals'), diet: !!document.querySelector('#today-feed .td-group:has([data-diet])') }));
  ok('no Meals card; the Diet checklist is there as it was', adv.card && adv.diet, adv);
  await p.evaluate(() => Flow.Nav.openCapture()); await p.waitForTimeout(300);
  await p.click('#flow-capture [data-fn-cap="diet"]'); await p.waitForTimeout(500);
  ok('the + sheet\'s Meal goes where it went: the body log', await p.evaluate(() => !document.querySelector('#flow-meal.on') && document.querySelector('.tab.active').getAttribute('data-tab') === 'sleep'));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
