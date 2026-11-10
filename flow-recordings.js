/* Recordings: a video, a call, a voice memo of a meeting — heard, understood
 * and acted on, then kept to answer questions later.
 *
 *   · The file is transcribed as it is (ElevenLabs Scribe takes audio and
 *     video, Turkish and English, and tells the speakers apart).
 *   · J.A.R.V.I.S. reads the transcript the way he reads a Fathom meeting
 *     (flow-projects): a summary, the project it belongs to, what is worth
 *     remembering, work handed to the team at once, ideas — and, because
 *     this one is his own recording, his own action items go on his week.
 *   · The transcript is kept. Asked later "how do we calculate the travel
 *     costs for the salon visits?", he answers from what was said, and says
 *     which recording it came from (recall()).
 *
 * GET  /api/team/recordings            → { recordings }
 * GET  /api/team/recordings?id=…       → { recording, transcript }
 * POST /api/team/recordings {name, data (base64), mime, note} → { id } (works in the background)
 * POST /api/team/recordings {op:'remove', id}
 */
const crypto = require('crypto');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');
const KEEP = 60, MAX_TEXT = 150000;
const MAX_BYTES = 60 * 1024 * 1024;
const MEDIA = /^(audio|video)\//;
const EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4|mov|m4v|mkv|mpeg|mpg|3gp|amr)$/i;

async function list(ctx) { const v = await ctx.get('team:recordings'); return Array.isArray(v) ? v : []; }
async function save(ctx, l) { await ctx.set('team:recordings', l.slice(-KEEP)); }
async function patch(ctx, id, fn) { const l = await list(ctx); const r = l.find((x) => x.id === id); if (r) { fn(r); await save(ctx, l); } return r; }
function isMedia(mime, name) { return MEDIA.test(String(mime || '')) || EXT.test(String(name || '')); }

/* Start: keep a record, answer at once; the hearing and reading go on in the background. */
async function ingest(ctx, deps, uid, input) {
  const buf = Buffer.isBuffer(input.data) ? input.data : Buffer.from(String(input.data || ''), 'base64');
  if (!buf.length) return { error: 'The file was empty.', status: 400 };
  if (buf.length > MAX_BYTES) return { error: 'That file is over 60 MB. Send the audio only, or a shorter part.', status: 413 };
  if (!isMedia(input.mime, input.name)) return { error: 'That is not an audio or video file.', status: 415 };
  if ((await ctx.get('team:paused')) === true) return { error: 'The team is paused. Resume it from the command centre.', status: 423 };
  const rec = { id: 'rc' + newId(), name: str(input.name || 'Recording', 120), at: Date.now(), via: str(input.via || 'app', 20), note: str(input.note, 600), bytes: buf.length, status: 'working', step: 'Listening' };
  const l = await list(ctx); l.push(rec); await save(ctx, l);
  const run = (async () => {
    try {
      const tr = await deps.transcribe(buf, input.mime, rec.name);
      if (tr.error) { await patch(ctx, rec.id, (r) => { r.status = 'failed'; r.error = tr.error; }); return; }
      const text = String(tr.text || '').trim();
      if (!text) { await patch(ctx, rec.id, (r) => { r.status = 'failed'; r.error = 'No speech was heard in it.'; }); return; }
      await ctx.set('team:rec:' + rec.id, text.slice(0, MAX_TEXT));
      await patch(ctx, rec.id, (r) => { r.step = 'Reading'; r.chars = text.length; r.seconds = tr.seconds || 0; r.speakers = tr.speakers || 0; r.lang = tr.lang || ''; });
      const m = { id: 'rec:' + rec.id, title: rec.name, at: new Date(rec.at).toISOString(), people: [], actions: [], summary: '', transcript: text, note: rec.note, kind: 'recording' };
      const out = await deps.read(ctx, uid, m);
      if (!out || out.error) { await patch(ctx, rec.id, (r) => { r.status = 'failed'; r.error = (out && out.error) || 'It could not be read.'; }); return; }
      await patch(ctx, rec.id, (r) => { r.status = 'done'; r.step = ''; r.summary = out.summary || ''; r.say = out.say || ''; r.tasks = (out.tasks || []).length; r.rocks = (out.rocks || []).map((x) => x.title); r.projects = (out.projects || []).map((p) => p.name); });
    } catch (e) { await patch(ctx, rec.id, (r) => { r.status = 'failed'; r.error = str(e.message, 200); }); }
  })();
  if (input.wait) await run;
  return { ok: true, id: rec.id, recording: rec };
}

/* What was said, for a question: the passages that share most words with
   it, from his recordings and from his meetings' notes. */
const STOP = new Set('the and for that this with from have what when how does about into your our are was were will would could should them they then than there here just also very much more some only even want need make made like into over under after before ve bir bu şu ile için gibi daha çok ama veya ben sen biz siz onlar olan olarak nasıl neden niye hangi kadar mı mi mu mü ne var yok değil diye ise yani'.split(' '));
function terms(q) {
  return [...new Set(String(q || '').toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 6)))].slice(0, 24);
}
function score(text, ts) {
  /* a word that starts with the term ("fiyatl" finds "fiyatları"), not one that merely contains it ("paris" is not "comparison") */
  const t = ' ' + text.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' '); let s = 0;
  for (const w of ts) { let i = -1, n = 0; while ((i = t.indexOf(' ' + w, i + 1)) >= 0 && n < 5) n++; if (n) s += 1 + Math.log(n); }
  return s;
}
async function recall(ctx, question, opts) {
  const ts = terms(question); if (ts.length < 1) return [];
  const out = [];
  for (const r of (await list(ctx)).filter((x) => x.status === 'done').slice(-40)) {
    const text = String((await ctx.get('team:rec:' + r.id)) || ''); if (!text) continue;
    for (let i = 0; i < text.length; i += 600) {
      const piece = text.slice(Math.max(0, i - 150), i + 750); const s = score(piece, ts);
      if (s > 0) out.push({ s, from: 'Recording "' + r.name + '" (' + new Date(r.at).toISOString().slice(0, 10) + ')', text: piece.replace(/\s+/g, ' ').trim() });
    }
  }
  try {
    const ms = await ctx.get('ld_meetings');
    for (const m of (Array.isArray(ms) ? ms : []).slice(-60)) {
      const text = String(m.summary || '') + ' ' + (m.actions || []).map((a) => a.text).join(' '); const s = score(text, ts);
      if (s > 0) out.push({ s: s * 0.9, from: 'Meeting "' + m.title + '" (' + String(m.at || '').slice(0, 10) + ')', text: str(text, 900) });
    }
  } catch (e) {}
  const need = Math.max(1, Math.min(2, ts.length / 3));
  return out.filter((x) => x.s >= need).sort((a, b) => b.s - a.s).slice(0, (opts && opts.max) || 4);
}
function recallText(hits) { return hits.map((h) => '[' + h.from + '] …' + h.text + '…').join('\n'); }

async function handle(p, req, res, ctx, deps) {
  if (p !== '/api/team/recordings') return false;
  const json = ctx.json;
  if (req.method === 'GET') {
    const id = ctx.query && ctx.query.get ? ctx.query.get('id') : new URL(req.url, 'http://x').searchParams.get('id');
    if (id) { const r = (await list(ctx)).find((x) => x.id === id); if (!r) { json(res, 404, { error: 'No such recording.' }); return true; } json(res, 200, { ok: true, recording: r, transcript: String((await ctx.get('team:rec:' + id)) || '') }); return true; }
    json(res, 200, { ok: true, recordings: (await list(ctx)).slice().reverse() }); return true;
  }
  if (req.method !== 'POST') { json(res, 405, { error: 'GET or POST.' }); return true; }
  let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { json(res, 400, { error: 'That did not arrive in one piece.' }); return true; }
  if (b.op === 'remove') { await save(ctx, (await list(ctx)).filter((x) => x.id !== String(b.id || ''))); await ctx.set('team:rec:' + String(b.id || ''), null); json(res, 200, { ok: true }); return true; }
  const r = await ingest(ctx, deps, ctx.user && ctx.user.id, { name: b.name, data: b.data, mime: b.mime, note: b.text || b.note, via: 'app', wait: !!b.wait });
  if (r.error) { json(res, r.status || 400, r); return true; }
  json(res, 202, r); return true;
}

module.exports = { handle, ingest, recall, recallText, list, isMedia, terms, MAX_BYTES };
