'use strict';
/* ==========================================================================
 * Content Flow — a screenshot of an Instagram profile in, two weeks of
 * content out.
 * --------------------------------------------------------------------------
 * One Node process, no dependencies, one page. The person drops a screenshot
 * of a profile (theirs, or a client's) and says what they want from the next
 * two weeks; the assistant reads the profile from the picture — handle, bio,
 * what they post, how it looks — and writes a fourteen-day board: which day
 * is a Reel, a carousel, a post or a story; what it is for (teach, entertain,
 * sell, bring people closer); the hook, the frames, the caption, the
 * template to shoot it with. Nothing is stored: the picture goes to the model
 * once and is forgotten with the request.
 *
 *   ANTHROPIC_API_KEY   required for /api/plan; without it the page still
 *                       opens and says the assistant is not switched on.
 *   CONTENT_MODEL       default claude-sonnet-4-5
 *   PORT                default 4100
 *   CONTENT_HOURLY      plans per IP per hour, default 6
 * ======================================================================== */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 4100;
const MODEL = process.env.CONTENT_MODEL || 'claude-sonnet-4-5';
const HOURLY = Math.max(1, parseInt(process.env.CONTENT_HOURLY || '6', 10) || 6);
const MAX_IMAGE = 6 * 1024 * 1024;            /* bytes of base64 */
const TYPES = ['reel', 'carousel', 'post', 'story'];
const GOALS = ['teach', 'entertain', 'sell', 'connect'];
const TEMPLATES = ['before-after', 'listicle', 'talking-head', 'bts', 'myth', 'tutorial', 'qa', 'poll', 'day-in-life', 'transformation'];

/* ---- the brief ---------------------------------------------------------- */
function system(lang) {
  const tr = lang === 'tr';
  return [
    tr ? 'Sen bir Instagram içerik stratejistisin. Sana bir profilin ekran görüntüsü verilecek.' : 'You are an Instagram content strategist. You are given a screenshot of a profile.',
    tr ? 'Görselden okuyabildiğin her şeyi kullan: kullanıcı adı, biyografi, takipçi sayısı, paylaşım sayısı, öne çıkanlar, son gönderilerin konuları ve görsel dili.'
       : 'Use everything you can read from the picture: handle, bio, follower count, post count, highlights, the subjects and look of recent posts.',
    tr ? 'Okuyamadığın bir şeyi uydurma; "görselde yok" de.' : 'Never invent what you cannot read; say it is not in the picture.',
    '',
    tr ? 'SADECE şu JSON nesnesini döndür (markdown yok, açıklama yok):' : 'Return ONLY this JSON object (no markdown, no prose):',
    '{',
    '  "profile": { "handle": "", "niche": "", "audience": "", "tone": "", "followers": "", "strengths": ["", "", ""], "gaps": ["", "", ""], "cadence": "" },',
    '  "pillars": [ { "name": "", "share": 40 } ],',
    '  "days": [ { "d": 1, "type": "reel|carousel|post|story", "goal": "teach|entertain|sell|connect", "title": "", "hook": "", "idea": "",',
    '              "frames": [ { "t": "0-3s", "text": "" } ], "caption": "", "cta": "", "hashtags": ["", "", "", "", ""],',
    '              "template": "before-after|listicle|talking-head|bts|myth|tutorial|qa|poll|day-in-life|transformation", "time": "19:00", "howto": ["", ""] } ],',
    '  "templates": [ { "id": "listicle", "name": "", "when": "", "steps": ["", "", ""] } ]',
    '}',
    '',
    tr ? 'Kurallar:' : 'Rules:',
    tr ? '· Tam 14 gün (d: 1..14). Karışım: 5–7 Reel, 2–3 carousel, 2–3 post, 2–3 story. Hedefler dengeli: en az 4 eğitici, 3 eğlendirici, 2 satış, 2 topluluk.'
       : '· Exactly 14 days (d: 1..14). Mix: 5–7 Reels, 2–3 carousels, 2–3 posts, 2–3 stories. Balance goals: at least 4 teach, 3 entertain, 2 sell, 2 connect.',
    tr ? '· Her kanca (hook) ilk 3 saniyede söylenecek tek cümle, 12 kelimeyi geçmez. Klişe yok ("Bunu kimse söylemiyor" gibi).'
       : '· Every hook is one sentence said in the first 3 seconds, under 12 words. No clichés ("nobody tells you this").',
    tr ? '· Reel için 3–5 kare: her karede süre ve ekranda/sesli söylenecek şey. Carousel için kareler = slaytlar. Post için tek kare. Story için 2–4 kare.'
       : '· Reels get 3–5 frames with timing and what is said or shown. Carousel frames are slides. A post has one frame. A story has 2–4 frames.',
    tr ? '· "howto": nasıl çekilir, 2–4 kısa madde (açı, ışık, süre, araç). "time": o içerik türü için en iyi paylaşım saati, HH:MM.'
       : '· "howto": how to shoot it, 2–4 short bullets (angle, light, length, tools). "time": best posting hour for that type, HH:MM.',
    tr ? '· Caption 2–4 cümle, kişinin tonuyla; CTA tek cümle; 5 hashtag, niş olanlar.' : '· Caption 2–4 sentences in the person\'s tone; CTA one sentence; 5 niche hashtags.',
    tr ? '· "templates": planda kullandığın şablonlardan 4–6 tanesi, ne zaman kullanılacağı ve 3 adımı.' : '· "templates": 4–6 of the templates the plan uses, when to use each, and 3 steps.',
    tr ? '· Her şey Türkçe. Kısa, somut, bu profile özel — genel tavsiye yok.' : '· Everything in English. Short, concrete, specific to this profile — no generic advice.'
  ].join('\n');
}

function user(brief, lang) {
  const tr = lang === 'tr';
  const g = { grow: tr ? 'takipçi büyütmek' : 'grow followers', sell: tr ? 'satış / müşteri' : 'sales / clients', brand: tr ? 'marka bilinirliği' : 'brand awareness', community: tr ? 'topluluk / etkileşim' : 'community / engagement' };
  const t = { warm: tr ? 'samimi' : 'warm', pro: tr ? 'profesyonel' : 'professional', fun: tr ? 'eğlenceli' : 'playful', bold: tr ? 'iddialı' : 'bold' };
  return (tr ? 'Hedef: ' : 'Goal: ') + (g[brief.goal] || g.grow) + '\n' + (tr ? 'Ton: ' : 'Tone: ') + (t[brief.tone] || t.warm) +
    (brief.notes ? '\n' + (tr ? 'Not: ' : 'Notes: ') + String(brief.notes).slice(0, 400) : '') +
    '\n' + (tr ? 'Bugün: ' : 'Today: ') + new Date().toISOString().slice(0, 10) +
    '\n' + (tr ? 'Ekran görüntüsü ekte. Planı yaz.' : 'The screenshot is attached. Write the plan.');
}

/* ---- the model ----------------------------------------------------------- */
let post = (url, headers, payload) => new Promise((resolve, reject) => {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const u = new URL(url);
  const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': body.length }, headers) }, (res) => {
    let out = ''; res.setEncoding('utf8');
    res.on('data', (c) => { out += c; if (out.length > 4e6) req.destroy(); });
    res.on('end', () => { let parsed = null; try { parsed = JSON.parse(out); } catch (e) {} resolve({ status: res.statusCode, body: parsed, raw: out.slice(0, 400) }); });
  });
  req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.end(body);
});

function parsePlan(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t); if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b < a) return null;
  let j; try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  if (!j || !Array.isArray(j.days) || !j.days.length) return null;
  const s = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 300);
  const list = (v, n, m) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => s(x, m || 160)).filter(Boolean);
  const p = j.profile || {};
  const out = {
    profile: { handle: s(p.handle, 60), niche: s(p.niche, 120), audience: s(p.audience, 200), tone: s(p.tone, 120), followers: s(p.followers, 40), strengths: list(p.strengths, 4), gaps: list(p.gaps, 4), cadence: s(p.cadence, 160) },
    pillars: (Array.isArray(j.pillars) ? j.pillars : []).slice(0, 6).map((x) => ({ name: s(x && x.name, 60), share: Math.max(0, Math.min(100, +(x && x.share) || 0)) })).filter((x) => x.name),
    days: j.days.slice(0, 14).map((d, i) => ({
      d: i + 1,
      type: TYPES.indexOf(d.type) >= 0 ? d.type : 'post',
      goal: GOALS.indexOf(d.goal) >= 0 ? d.goal : 'teach',
      title: s(d.title, 120), hook: s(d.hook, 160), idea: s(d.idea, 400),
      frames: (Array.isArray(d.frames) ? d.frames : []).slice(0, 6).map((f) => ({ t: s(f && f.t, 20), text: s(f && f.text, 220) })).filter((f) => f.text),
      caption: s(d.caption, 600), cta: s(d.cta, 160), hashtags: list(d.hashtags, 6, 40).map((h) => h.replace(/^#?/, '#').replace(/\s+/g, '')),
      template: TEMPLATES.indexOf(d.template) >= 0 ? d.template : 'talking-head',
      time: /^\d{1,2}:\d{2}$/.test(String(d.time || '')) ? String(d.time) : '19:00',
      howto: list(d.howto, 4, 160)
    })).filter((d) => d.title),
    templates: (Array.isArray(j.templates) ? j.templates : []).slice(0, 8).map((t2) => ({ id: TEMPLATES.indexOf(t2 && t2.id) >= 0 ? t2.id : 'talking-head', name: s(t2 && t2.name, 60), when: s(t2 && t2.when, 200), steps: list(t2 && t2.steps, 4, 160) })).filter((t2) => t2.name)
  };
  /* a board short of fourteen days is padded with the last few repeated as "your call" slots */
  while (out.days.length && out.days.length < 14) out.days.push(Object.assign({}, out.days[out.days.length % Math.max(1, out.days.length)], { d: out.days.length + 1 }));
  return out.days.length ? out : null;
}

async function plan(body, lang) {
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) return { status: 503, error: lang === 'tr' ? 'Asistan bu sunucuda henüz açık değil.' : 'The assistant is not switched on for this server yet.' };
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m) return { status: 400, error: lang === 'tr' ? 'Bir ekran görüntüsü yükle (PNG veya JPG).' : 'Upload a screenshot (PNG or JPG).' };
  if (m[2].length > MAX_IMAGE) return { status: 413, error: lang === 'tr' ? 'Görsel çok büyük (en fazla ~4 MB).' : 'The image is too big (about 4 MB at most).' };
  const r = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
    model: MODEL, max_tokens: 6000, system: system(lang),
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data: m[2] } },
      { type: 'text', text: user(body.brief || {}, lang) }
    ] }]
  });
  if (r.status !== 200) {
    const msg = (r.body && r.body.error && r.body.error.message) || ('HTTP ' + r.status);
    return { status: 502, error: (lang === 'tr' ? 'Asistana ulaşılamadı: ' : 'The assistant could not be reached: ') + msg };
  }
  const text = ((r.body && r.body.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const out = parsePlan(text);
  if (!out) return { status: 502, error: lang === 'tr' ? 'Plan okunamadı. Bir daha dene.' : 'The plan could not be read. Try again.' };
  return { status: 200, plan: out, usage: r.body.usage || null };
}

/* ---- the server ---------------------------------------------------------- */
const HITS = new Map();
function allowed(ip) {
  const hour = Math.floor(Date.now() / 3600e3);
  HITS.forEach((v, k) => { if (v.h !== hour) HITS.delete(k); });
  const h = HITS.get(ip) || { h: hour, n: 0 };
  h.n++; HITS.set(ip, h);
  return h.n <= HOURLY;
}
const readBody = (req, max) => new Promise((ok, no) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > max) { req.destroy(); no(new Error('too big')); } }); req.on('end', () => ok(b)); req.on('error', no); });
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
let PAGE = null;
const page = () => PAGE || (PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));

async function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/healthz') return json(res, 200, { ok: true });
  if (u.pathname === '/api/plan' && req.method === 'POST') {
    const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '').trim();
    let body = {};
    try { body = JSON.parse(await readBody(req, 9 * 1024 * 1024) || '{}'); } catch (e) { return json(res, 413, { error: 'That upload is too big.' }); }
    const lang = body.lang === 'en' ? 'en' : 'tr';
    if (!allowed(ip)) return json(res, 429, { error: lang === 'tr' ? 'Bu saat için yeterince plan yazıldı. Biraz sonra tekrar dene.' : 'Enough plans for this hour. Try again a little later.' });
    try {
      const out = await plan(body, lang);
      return json(res, out.status, out.status === 200 ? { ok: true, plan: out.plan } : { error: out.error });
    } catch (e) {
      return json(res, 502, { error: lang === 'tr' ? 'Asistana şu anda ulaşılamıyor.' : 'The assistant cannot be reached right now.' });
    }
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(process.env.NODE_ENV === 'production' ? page() : fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
}

if (require.main === module) {
  http.createServer((req, res) => handle(req, res).catch((e) => { try { json(res, 500, { error: 'Something went wrong.' }); } catch (x) {} })).listen(PORT, () => console.log('content-flow on ' + PORT));
}

module.exports = { handle, parsePlan, plan, system, _internals: { setPoster(fn) { post = fn || post; }, TYPES, GOALS, TEMPLATES } };
