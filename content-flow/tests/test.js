/* Content Flow — the plan from a picture.
 *
 * What would make it wrong: a plan the model wrote in prose instead of JSON
 * going through as nothing; a type or goal the page does not know; more or
 * fewer than fourteen days; a hashtag without its #; a picture that is not
 * a picture accepted; the page sending anything but the picture, the brief
 * and the language; the board not drawing; the sample plan not opening
 * without a key; Turkish not Turkish. The model is never called. */
const http = require('http');
const path = require('path');
const { chromium, devices } = require('playwright');
const S = require('../server.js');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };

const PLAN = { profile: { handle: '@demo', niche: 'coffee', audience: 'people', tone: 'warm', followers: '1.2k', strengths: ['a', 'b'], gaps: ['c'], cadence: '3/wk' },
  pillars: [{ name: 'Process', share: 50 }, { name: 'Taste', share: 50 }],
  days: Array.from({ length: 14 }, (_, i) => ({ d: i + 1, type: ['reel', 'carousel', 'post', 'story'][i % 4], goal: ['teach', 'entertain', 'sell', 'connect'][i % 4], title: 'Day ' + (i + 1) + ' thing', hook: 'Hook ' + (i + 1), idea: 'idea', frames: [{ t: '0-3s', text: 'open' }, { t: '3-10s', text: 'middle' }], caption: 'cap', cta: 'cta', hashtags: ['coffee', '#latte'], template: ['tutorial', 'listicle', 'before-after', 'poll'][i % 4], time: '19:00', howto: ['tripod'] })),
  templates: [{ id: 'tutorial', name: 'Step by step', when: 'when', steps: ['1', '2'] }] };

(async () => {
  console.log('\n— reading the reply —');
  const p1 = S.parsePlan('Here you go:\n```json\n' + JSON.stringify(PLAN) + '\n```');
  ok('JSON inside a fence, with prose around it, is read', p1 && p1.days.length === 14 && p1.profile.handle === '@demo');
  ok('hashtags get their #', p1.days[0].hashtags.join() === '#coffee,#latte', p1.days[0].hashtags);
  const bad = JSON.parse(JSON.stringify(PLAN)); bad.days[0].type = 'tiktok'; bad.days[0].goal = 'vibes'; bad.days[0].template = 'magic'; bad.days[0].time = 'evening';
  const p2 = S.parsePlan(JSON.stringify(bad));
  ok('a type, goal, template or time the page does not know falls back', p2.days[0].type === 'post' && p2.days[0].goal === 'teach' && p2.days[0].template === 'talking-head' && p2.days[0].time === '19:00');
  const short = JSON.parse(JSON.stringify(PLAN)); short.days = short.days.slice(0, 9);
  ok('nine days become fourteen', S.parsePlan(JSON.stringify(short)).days.length === 14);
  ok('prose is nothing', S.parsePlan('I would post a reel on Monday.') === null);
  ok('the Turkish brief asks for Turkish, the English one for English', /Türkçe/.test(S.system('tr')) && /in English/.test(S.system('en')));

  console.log('\n— the endpoint —');
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let sent = null;
  S._internals.setPoster(async (url, headers, payload) => { sent = payload; return { status: 200, body: { content: [{ type: 'text', text: JSON.stringify(PLAN) }], usage: { input_tokens: 1, output_tokens: 1 } } }; });
  const srv = http.createServer((req, res) => S.handle(req, res)); await new Promise((r) => srv.listen(4111, r));
  const H = 'http://localhost:4111';
  const png = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
  const call = async (body) => { const r = await fetch(H + '/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  const a = await call({ image: png, lang: 'tr', brief: { goal: 'sell', tone: 'fun', notes: 'Kasım' } });
  ok('a picture and a brief come back as a plan', a.status === 200 && a.j.plan.days.length === 14, a.j);
  ok('the model gets the picture and the brief, nothing else', sent && sent.messages[0].content[0].type === 'image' && /Hedef: satış/.test(sent.messages[0].content[1].text) && /Kasım/.test(sent.messages[0].content[1].text) && !/test-key/.test(JSON.stringify(sent)), sent && sent.messages[0].content[1].text);
  ok('the system prompt is the Turkish one', /Türkçe/.test(sent.system));
  ok('not a picture is refused', (await call({ image: 'data:text/html;base64,PGI+', lang: 'tr' })).status === 400);
  ok('no picture is refused', (await call({ lang: 'en' })).status === 400);
  S._internals.setPoster(async () => ({ status: 200, body: { content: [{ type: 'text', text: 'Post a reel.' }] } }));
  ok('prose from the model is a 502, not a blank page', (await call({ image: png, lang: 'en' })).status === 502);
  delete process.env.ANTHROPIC_API_KEY;
  const off = await call({ image: png, lang: 'tr' });
  ok('no key says so', off.status === 503 && /açık değil/.test(off.j.error), off.j);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  S._internals.setPoster(async () => ({ status: 200, body: { content: [{ type: 'text', text: JSON.stringify(PLAN) }] } }));

  console.log('\n— the page —');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'tr-TR' }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(H + '/', { waitUntil: 'load' });
  ok('it opens in Turkish', await page.evaluate(() => document.documentElement.lang === 'tr' && /Profilini bırak/.test(document.querySelector('h1').textContent)));
  await page.click('#demo'); await page.waitForTimeout(400);
  const demo = await page.evaluate(() => ({ on: document.getElementById('out').classList.contains('on'), days: document.querySelectorAll('.day').length, counts: document.getElementById('counts').textContent, tpls: document.querySelectorAll('.tpl').length, handle: document.getElementById('pHandle').textContent }));
  ok('the sample plan draws fourteen days, the mix and the templates without a key', demo.on && demo.days === 14 && /Reel/.test(demo.counts) && demo.tpls >= 4 && /@nailbyderya/.test(demo.handle), demo);
  await page.click('.day[data-i="0"]'); await page.waitForTimeout(300);
  const det = await page.evaluate(() => { const p = document.getElementById('panel'); return { on: document.getElementById('sheet').classList.contains('on'), hook: p.querySelector('.hook').textContent, frames: p.querySelectorAll('.fr').length, mock: !!p.querySelector('.ph'), how: p.querySelectorAll('.how li').length }; });
  ok('a day opens with its hook, frames, how-to and the template drawn', det.on && /cilan değil/.test(det.hook) && det.frames === 4 && det.mock && det.how === 3, det);
  await page.keyboard.press('Escape');
  await page.click('[data-f="reel"]'); await page.waitForTimeout(200);
  ok('filtering keeps only the Reels', await page.evaluate(() => [...document.querySelectorAll('.day:not(.hide)')].every((d) => d.getAttribute('data-type') === 'reel') && document.querySelectorAll('.day:not(.hide)').length === 6));
  await page.click('[data-lang="en"]'); await page.waitForTimeout(300);
  ok('English switches the whole page, the sample included', await page.evaluate(() => document.documentElement.lang === 'en' && /Drop your profile/.test(document.querySelector('h1').textContent) && /Why gel lifts/.test(document.querySelector('.day[data-i="0"] .tt').textContent)));
  await page.click('[data-lang="tr"]'); await page.click('#again'); await page.waitForTimeout(300);
  /* the real path, with the model mocked on the server */
  await page.setInputFiles('#file', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('fakepng') }); await page.waitForTimeout(300);
  ok('a dropped picture is shown', await page.evaluate(() => !!document.querySelector('#drop img')));
  await page.click('#goal [data-v="sell"]');
  await page.click('#go'); await page.waitForFunction(() => document.getElementById('out').classList.contains('on'), null, { timeout: 10000 });
  ok('the plan from the server draws', await page.evaluate(() => document.querySelectorAll('.day').length === 14 && /@demo/.test(document.getElementById('pHandle').textContent)));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  ok('it fits a phone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('no page errors', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
