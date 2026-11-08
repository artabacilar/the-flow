/* ======================================================================
 * The Flow — the email review workflow
 * ======================================================================
 * Actionable emails come in (intake: a Resend inbound webhook, a pasted
 * thread, or — in tests — fixtures), a specialist drafts the exact reply,
 * and the owner reviews them ONE AT A TIME: sender, subject, the whole
 * thread, the exact reply, and three choices — Send this exact reply ·
 * Revise · Don't send. An approval is bound to the exact draft (its hash
 * and version): a draft revised after the yes is not the draft that was
 * approved, so it is not sent.
 *
 * States: draft → awaiting → (revised → awaiting)* → skipped
 *                                   ↘ submitting → accepted → delivered | bounced
 *                                                ↘ failed
 * "accepted" is the provider taking the message; "delivered" only arrives
 * from the provider's own event. Nothing is called delivered before that.
 *
 * Also: stale dates in a draft are flagged before it can be sent; the
 * owner's calendar (what the Flow knows of the week) is offered when the
 * draft proposes a time; a tone correction given with a revision is kept as
 * a skill the drafts follow from then on (with no invented source URLs);
 * a group can be the inbox — one topic per email; a bounded, revocable
 * auto-send policy for the narrow case the owner names; everything is
 * persisted and re-checked at boot (a send that was in flight is finished
 * once, never twice). Schedules in this file are examples only.
 * ====================================================================== */
'use strict';

const crypto = require('crypto');
const FAKE = process.env.FLOW_TEAM_FAKE === '1';
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hash = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16);
const STATES = ['draft', 'awaiting', 'revised', 'skipped', 'submitting', 'accepted', 'delivered', 'bounced', 'failed'];

/* ---------- store ---------------------------------------------------------- */
async function all(ctx) { const v = await ctx.get('team:mail'); return Array.isArray(v) ? v : []; }
async function saveAll(ctx, list) { await ctx.set('team:mail', list.slice(-200)); }
async function byId(ctx, id) { return (await all(ctx)).find((m) => m.id === id) || null; }
async function patch(ctx, id, fn) { const list = await all(ctx); const m = list.find((x) => x.id === id); if (!m) return null; fn(m); m.updatedAt = Date.now(); await saveAll(ctx, list); return m; }
async function policy(ctx) { const v = await ctx.get('team:mail:policy'); return v && typeof v === 'object' ? v : { enabled: false, maxPerDay: 3, senders: [], kinds: [], expiresAt: 0, sentToday: {}, log: [] }; }
async function savePolicy(ctx, p) { await ctx.set('team:mail:policy', p); }

/* ---------- intake ---------------------------------------------------------- */
/* Is this email something to act on? A newsletter or a notification is not. */
function actionable(mail) {
  const from = String(mail.from || '').toLowerCase(), subj = String(mail.subject || '').toLowerCase(), body = String(mail.text || '').toLowerCase();
  if (/no-?reply|noreply|donotreply|notifications?@|newsletter|mailer-daemon|postmaster/.test(from)) return { ok: false, why: 'automated sender' };
  if (/unsubscribe|view (this|in) browser|you are receiving this/.test(body) && !/\?/.test(body)) return { ok: false, why: 'newsletter' };
  if (/^(re|fwd?):?\s*$/i.test(subj) && !body.trim()) return { ok: false, why: 'empty' };
  if (/\?|please|could you|can you|would you|let me know|rica|lütfen|misiniz|mısınız|bekliyorum|teklif|fiyat|quote|invoice|fatura|refund|iade|complain|şikayet|meeting|toplantı|call|görüşme|deadline|urgent|acil/.test(subj + ' ' + body)) return { ok: true, why: 'asks for something' };
  return { ok: body.length > 40, why: body.length > 40 ? 'a person wrote' : 'nothing to answer' };
}
/* One email (or thread) becomes a review item with a draft from the drafting agent. */
async function intake(ctx, deps, mail, opts) {
  opts = opts || {};
  const list = await all(ctx);
  const key = hash((mail.id || '') + '|' + (mail.from || '') + '|' + (mail.subject || '') + '|' + String(mail.text || '').slice(0, 400));
  const dup = list.find((m) => m.key === key);
  if (dup) return { item: dup, duplicate: true };
  const act = actionable(mail);
  const item = {
    id: 'm' + newId(), key, createdAt: Date.now(), updatedAt: Date.now(),
    from: str(mail.from, 160), fromName: str(mail.fromName || String(mail.from || '').replace(/<.*$/, ''), 80), to: str(mail.to || '', 160), subject: str(mail.subject || '(no subject)', 200),
    thread: Array.isArray(mail.thread) && mail.thread.length ? mail.thread.map((t) => ({ from: str(t.from, 120), at: t.at || null, text: block(t.text, 6000) })) : [{ from: str(mail.from, 120), at: mail.at || Date.now(), text: block(mail.text, 6000) }],
    messageId: str(mail.messageId || mail.id || '', 200), source: str(opts.source || 'intake', 40),
    actionable: act.ok, why: act.why, state: act.ok ? 'draft' : 'skipped', skipReason: act.ok ? '' : act.why,
    draft: null, version: 0, versions: [], feedback: [], flags: [], approval: null, send: null, topic: null, agent: opts.agent || 'sarah', autoSent: false
  };
  list.push(item); await saveAll(ctx, list);
  if (act.ok) {
    try { await draft(ctx, deps, item.id, { why: 'new email' }); } catch (e) { await patch(ctx, item.id, (m) => { m.flags.push('draft failed: ' + str(e.message, 100)); }); }
    const fresh = await byId(ctx, item.id);
    if (deps.log) await deps.log(ctx, item.agent, 'Email to review: "' + item.subject + '" from ' + (item.fromName || item.from) + '.');
    /* the narrow case the owner allowed: sent without a yes, within the bounds */
    try { await autoSend(ctx, deps, fresh); } catch (e) {}
    try { if (deps.onNew) await deps.onNew(ctx, await byId(ctx, item.id)); } catch (e) {}
  }
  return { item: await byId(ctx, item.id), duplicate: false };
}

/* ---------- drafting --------------------------------------------------------- */
const DRAFT_SYSTEM = (agent, owner, know, tone, calendar) => [
  'You are ' + agent.name + ' (' + agent.role + '), drafting an email reply that ' + owner + ' will review and send under your name on their behalf.',
  'Write the EXACT reply, ready to send: no placeholders, no [brackets], no options. Plain text. Match the language of the email (Turkish gets Turkish).',
  'Facts come only from THE THREAD and WHAT THE TEAM KNOWS. If something needed is not there, say in the reply that you will confirm it, rather than inventing it. Never invent prices, dates, links or names.',
  'Dates: today is ' + new Date().toISOString().slice(0, 10) + '. Never propose a date that has passed. If you propose a meeting time, use only the FREE TIMES given; if none are given, ask for their availability.',
  tone.length ? 'TONE AND STYLE RULES (the owner\'s corrections — follow every one): ' + tone.map((t) => '· ' + t).join(' ') : 'Tone: courteous, clear, brief.',
  know.length ? 'WHAT THE TEAM KNOWS: ' + know.map((k) => k.text).join(' · ') : '',
  calendar ? 'FREE TIMES (the owner\'s calendar, next days): ' + calendar : '',
  'Return ONLY JSON: {"subject": "Re: …", "reply": "the full reply text", "summary": "one line on what the email asks and what the reply does", "needs": ["anything you could not confirm"]}'
].filter(Boolean).join('\n');

async function draft(ctx, deps, id, opts) {
  opts = opts || {};
  const item = await byId(ctx, id); if (!item) return { error: 'No such email.' };
  const list = await deps.agents(ctx); const a = list.find((x) => x.id === item.agent) || list.find((x) => x.id !== 'jarvis') || list[0];
  const know = deps.knowledge ? (await deps.knowledge(ctx)).filter((k) => k.status !== 'superseded' && k.scope === 'shared').slice(-40) : [];
  const tone = await toneRules(ctx, deps);
  const cal = deps.freeTimes ? await deps.freeTimes(ctx) : '';
  const threadText = item.thread.map((t) => 'From ' + t.from + (t.at ? ' (' + new Date(t.at).toISOString().slice(0, 10) + ')' : '') + ':\n' + t.text).join('\n\n---\n\n');
  const user = 'SUBJECT: ' + item.subject + '\nTHE THREAD:\n' + threadText + (opts.revise ? '\n\nTHE OWNER\'S REVISION REQUEST (the previous draft follows; change it as asked, keep everything else):\n' + opts.revise + '\n\nPREVIOUS DRAFT:\n' + (item.draft ? item.draft.reply : '') : '');
  let out = null;
  if (FAKE) {
    /* the stand-in: a complete, deterministic reply so the workflow can be exercised end to end */
    const name = item.fromName.split(' ')[0] || 'there'; const tr = /[ğışçöüİ]|merhaba|misiniz|mısınız/i.test(item.subject + ' ' + item.thread.map((t) => t.text).join(' '));
    const ask = item.thread[item.thread.length - 1].text.replace(/\s+/g, ' ').trim();
    out = tr ? { subject: /^re:/i.test(item.subject) ? item.subject : 'Re: ' + item.subject, reply: 'Merhaba ' + name + ',\n\nMesajınız için teşekkürler. ' + (opts.revise ? '(' + str(opts.revise, 80) + ') ' : '') + 'Konuyu inceledim; ' + (cal ? 'şu zamanlar bize uyar: ' + cal + '. ' : '') + 'En kısa sürede dönüş yapacağım.\n\nSelamlar,\n' + a.name, summary: 'Answers the request in Turkish' + (opts.revise ? ', revised: ' + str(opts.revise, 60) : ''), needs: [] }
      : { subject: /^re:/i.test(item.subject) ? item.subject : 'Re: ' + item.subject, reply: 'Dear ' + name + ',\n\nThank you for your message' + (/refund|charged twice/i.test(ask) ? ' about the double charge. I have asked for the second charge to be refunded and will confirm once it is through' : /receipt|invoice/i.test(ask) ? '. The document you asked for is attached to my next message' : /demo|meeting|call/i.test(ask) ? '. ' + (cal ? 'We could do ' + cal.split(';')[0].trim() : 'Please let me know when suits you') : '. I will come back to you with a full answer shortly') + '.' + (opts.revise ? ' (' + str(opts.revise, 80) + ')' : '') + '\n\nKind regards,\n' + a.name, summary: 'Replies to: ' + str(ask, 80) + (opts.revise ? ' — revised: ' + str(opts.revise, 60) : ''), needs: [] };
  } else if (deps.modelJson) out = await deps.modelJson(ctx, DRAFT_SYSTEM(a, deps.ownerName(ctx), know, tone, cal), user, 1400, a.model);
  if (!out || !out.reply) {
    /* no model (or a bad answer): an honest, plain draft that commits to nothing */
    const name = item.fromName.split(' ')[0] || '';
    out = { subject: /^re:/i.test(item.subject) ? item.subject : 'Re: ' + item.subject, reply: 'Dear ' + (name || 'Sir/Madam') + ',\n\nThank you for your message. ' + (opts.revise ? 'Noted: ' + str(opts.revise, 120) + '. ' : '') + 'I will look into this and come back to you shortly with a full answer.\n\nKind regards,\n' + a.name, summary: 'A holding reply; the model was not available to draft the full answer.', needs: ['the full answer'] };
  }
  const reply = block(out.reply, 8000);
  const flags = checkDraft(reply, item);
  const v = { version: item.version + 1, subject: str(out.subject || item.subject, 200), reply, summary: str(out.summary, 240), needs: Array.isArray(out.needs) ? out.needs.map((x) => str(x, 120)).slice(0, 6) : [], hash: hash(reply), at: Date.now(), by: a.id, why: str(opts.why || (opts.revise ? 'revised: ' + opts.revise : 'first draft'), 200) };
  await patch(ctx, id, (m) => { m.draft = v; m.version = v.version; m.versions.push(v); m.flags = flags; m.state = m.state === 'skipped' ? 'skipped' : 'awaiting'; m.approval = null; });
  return { ok: true, item: await byId(ctx, id) };
}
/* Things that must not go out: a date already past, a placeholder, a link nobody gave. */
function checkDraft(reply, item) {
  const flags = [];
  const now = new Date(); const yr = now.getFullYear();
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11, ocak: 0, şubat: 1, mart: 2, nisan: 3, mayıs: 4, haziran: 5, temmuz: 6, ağustos: 7, eylül: 8, ekim: 9, kasım: 10, aralık: 11 };
  const re = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)[a-zşı]*\.?(?:\s+(\d{4}))?\b/gi;
  let m; while ((m = re.exec(reply))) {
    const d = new Date(m[3] ? +m[3] : yr, MON[m[2].toLowerCase().slice(0, 3)] != null ? MON[m[2].toLowerCase().slice(0, 3)] : MON[m[2].toLowerCase()], +m[1]);
    if (!isNaN(d) && d.getTime() < now.getTime() - 86400000) flags.push('stale date: "' + m[0] + '" is in the past');
  }
  const iso = /\b(20\d\d)-(\d\d)-(\d\d)\b/g; while ((m = iso.exec(reply))) { const d = new Date(+m[1], +m[2] - 1, +m[3]); if (d.getTime() < now.getTime() - 86400000) flags.push('stale date: "' + m[0] + '" is in the past'); }
  if (/\[[^\]]{2,40}\]|\{\{|<name>|<date>|TBD|TODO|XXX/.test(reply)) flags.push('placeholder left in the draft');
  const given = (item.thread || []).map((t) => t.text).join(' ');
  const links = reply.match(/https?:\/\/\S+/g) || [];
  for (const l of links) if (given.indexOf(l.replace(/[.,)]+$/, '')) < 0) flags.push('link not in the thread: ' + str(l, 60));
  return flags;
}

/* ---------- the owner's three choices --------------------------------------- */
/* Send this exact reply: the yes is bound to this version's hash. */
async function approve(ctx, deps, id, boundHash, by) {
  const item = await byId(ctx, id); if (!item) return { error: 'No such email.' };
  if (!item.draft) return { error: 'There is no draft to send yet.' };
  if (item.state !== 'awaiting' && item.state !== 'revised' && item.state !== 'failed') return { error: 'This reply is ' + item.state + '; nothing to approve.' };
  if (boundHash && boundHash !== item.draft.hash) return { error: 'The draft changed since you saw it (version ' + item.draft.version + ' now). Read it again before sending.', stale: true, item };
  if (item.flags.some((f) => /stale date|placeholder/.test(f)) && !(by && by.override)) return { error: 'Not sent: ' + item.flags.join('; ') + '. Revise it first (or say "send anyway").', flags: item.flags, item };
  const approval = { hash: item.draft.hash, version: item.draft.version, at: Date.now(), by: str((by && by.who) || 'owner', 60), via: str((by && by.via) || 'app', 30) };
  await patch(ctx, id, (m) => { m.approval = approval; m.state = 'submitting'; m.send = { key: 'mail-' + m.id + '-v' + approval.version, startedAt: Date.now(), attempts: (m.send && m.send.attempts || 0) + 1 }; });
  return await submit(ctx, deps, id);
}
/* The send itself — once. A restart mid-send finds state=submitting and finishes it with the same key. */
async function submit(ctx, deps, id) {
  const item = await byId(ctx, id); if (!item || item.state !== 'submitting') return { error: 'Nothing to send.' };
  const list = await deps.agents(ctx); const a = list.find((x) => x.id === item.agent) || { name: 'The team' };
  const to = (String(item.from).match(/<([^>]+)>/) || [null, String(item.from).trim()])[1];
  const r = await deps.sendEmail({ to, subject: item.draft.subject, text: item.draft.reply, agent: a.name, owner: deps.ownerName(ctx), key: item.send.key, replyTo: deps.ownerEmail(ctx) });
  if (r.ok) {
    await patch(ctx, id, (m) => { m.state = 'accepted'; m.send.acceptedAt = Date.now(); m.send.providerId = r.id || ''; m.send.from = r.from || ''; });
    if (deps.log) await deps.log(ctx, item.agent, 'Reply accepted by the email provider: "' + item.draft.subject + '" to ' + to + ' (v' + item.draft.version + '). Delivery is confirmed separately.');
    return { ok: true, item: await byId(ctx, id) };
  }
  await patch(ctx, id, (m) => { m.state = 'failed'; m.send.error = str(r.error, 200); m.send.failedAt = Date.now(); });
  if (deps.log) await deps.log(ctx, item.agent, 'Reply NOT sent: "' + item.draft.subject + '" — ' + str(r.error, 120));
  return { error: str(r.error, 200), item: await byId(ctx, id) };
}
/* Revise: a new version from the owner's words. A tone correction is kept for every draft after this one. */
async function revise(ctx, deps, id, text, opts) {
  const item = await byId(ctx, id); if (!item) return { error: 'No such email.' };
  if (!text) return { error: 'Say what to change.' };
  await patch(ctx, id, (m) => { m.feedback.push({ at: Date.now(), text: str(text, 600), kind: 'revise', image: (opts && opts.image) || null }); m.state = 'revised'; });
  const tone = toneOf(text);
  let skill = null;
  if (tone) { try { skill = await rememberTone(ctx, deps, tone); } catch (e) {} }
  const r = await draft(ctx, deps, id, { revise: text, why: 'revised: ' + str(text, 120) });
  return Object.assign(r, { tone: tone || null, skill });
}
/* Don't send. */
async function skip(ctx, deps, id, why) {
  const item = await byId(ctx, id); if (!item) return { error: 'No such email.' };
  if (/^(submitting|accepted|delivered)$/.test(item.state)) return { error: 'This reply has already gone; it cannot be unsent.' };
  await patch(ctx, id, (m) => { m.state = 'skipped'; m.skipReason = str(why || 'the owner chose not to reply', 160); });
  if (deps.log) await deps.log(ctx, item.agent, 'Not replying to "' + item.subject + '"' + (why ? ' — ' + str(why, 80) : '') + '.');
  return { ok: true, item: await byId(ctx, id) };
}
/* A screenshot or photo sent as feedback: kept with the item, and the owner is asked for a line. */
async function attachFeedback(ctx, id, image, caption) {
  const item = await byId(ctx, id); if (!item) return { error: 'No such email.' };
  await patch(ctx, id, (m) => { m.feedback.push({ at: Date.now(), kind: 'image', image: str(image, 300), text: str(caption || '', 400) }); });
  return { ok: true, item: await byId(ctx, id) };
}

/* ---------- tone corrections → a skill ---------------------------------------- */
const TONE = /\b(more|less|too)\s+(formal|casual|friendly|warm|direct|brief|short|long|polite|firm|apologetic|concise)|\b(shorter|longer|warmer|friendlier|firmer|softer|simpler)\b|\b(daha|çok)\s+(resmi|samimi|kısa|uzun|kibar|net|sıcak)|\bno (exclamation|emoji)|\balways (sign|start|end|open|close) with\b|\bnever (say|use|start|end)\b|\bdon'?t (say|use|start with|end with)\b|\buse (my|our|the) (name|first name)\b|\bsign (it )?as\b/i;
function toneOf(text) { const t = String(text || '').trim(); return TONE.test(t) ? str(t, 200) : ''; }
async function toneRules(ctx, deps) {
  const out = [];
  try { if (deps.skills) { const sk = (await deps.skills.all(ctx)).find((s) => s.name === 'Email tone and style' && s.status === 'active'); if (sk) out.push(...(sk.steps || []).map((s) => (typeof s === 'string' ? s : s.text || '')).filter(Boolean)); } } catch (e) {}
  try { if (deps.knowledge) out.push(...(await deps.knowledge(ctx)).filter((k) => k.kind === 'preference' && k.status !== 'superseded' && /email|reply|mail/i.test(k.text)).map((k) => k.text)); } catch (e) {}
  return out.slice(-12);
}
/* The skill "Email tone and style": one line per correction, no sources invented. */
async function rememberTone(ctx, deps, line) {
  if (!deps.skills) return null;
  const existing = (await deps.skills.all(ctx)).find((s) => s.name === 'Email tone and style');
  if (existing) {
    const steps = (existing.steps || []).map((s) => (typeof s === 'string' ? s : s.text || '')).filter(Boolean);
    if (steps.some((s) => s.toLowerCase() === line.toLowerCase())) return existing;
    const r = await deps.skills.edit(ctx, existing.id, { steps: steps.concat([line]).slice(-20), note: 'tone correction while reviewing an email' });
    return r && r.skill ? r.skill : existing;
  }
  const r = await deps.skills.create(ctx, { text: 'Email tone and style\nHow replies to emails should read, from the owner\'s corrections while reviewing drafts.\n1. ' + line, force: true, assignedTo: [], sources: [] });
  return r && r.skill ? r.skill : null;
}

/* ---------- provider events: accepted ≠ delivered -------------------------------- */
/* Resend webhooks: email.delivered, email.bounced, email.delivery_delayed, email.complained. Matched by the provider id. */
async function providerEvent(ctxForUid, users, ev) {
  const type = String(ev && ev.type || ''), pid = ev && ev.data && ev.data.email_id;
  if (!pid || !/^email\.(delivered|bounced|delivery_delayed|complained|failed)$/.test(type)) return { ignored: true };
  for (const uid of await users()) {
    const ctx = await ctxForUid(uid);
    const list = await all(ctx);
    const m = list.find((x) => x.send && x.send.providerId === pid);
    if (!m) continue;
    if (type === 'email.delivered') { m.state = 'delivered'; m.send.deliveredAt = Date.now(); }
    else if (type === 'email.bounced' || type === 'email.failed') { m.state = 'bounced'; m.send.bouncedAt = Date.now(); m.send.bounce = str(ev.data && (ev.data.bounce && ev.data.bounce.message || ev.data.reason), 200); }
    else if (type === 'email.delivery_delayed') { m.send.delayedAt = Date.now(); }
    else if (type === 'email.complained') { m.send.complainedAt = Date.now(); }
    m.updatedAt = Date.now();
    await saveAll(ctx, list);
    return { ok: true, uid, id: m.id, state: m.state };
  }
  return { unknown: true };
}

/* ---------- the bounded, revocable auto-send policy ------------------------------ */
/* The owner names the narrow case: senders (addresses or domains), at most N a day, until a date. Off at any moment. */
async function setPolicy(ctx, deps, b) {
  const p = await policy(ctx);
  if (b.enabled != null) p.enabled = !!b.enabled;
  if (b.maxPerDay != null) p.maxPerDay = Math.max(0, Math.min(20, parseInt(b.maxPerDay, 10) || 0));
  if (b.senders != null) p.senders = String(Array.isArray(b.senders) ? b.senders.join(',') : b.senders).split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  if (b.kinds != null) p.kinds = String(Array.isArray(b.kinds) ? b.kinds.join(',') : b.kinds).split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  if (b.days != null) p.expiresAt = Date.now() + Math.max(1, Math.min(30, parseInt(b.days, 10) || 1)) * 86400000;
  if (p.enabled && (!p.senders.length || !p.maxPerDay)) { p.enabled = false; await savePolicy(ctx, p); return { error: 'Auto-send needs at least one sender (address or domain) and a daily limit above zero. It stays off.', policy: p }; }
  await savePolicy(ctx, p);
  if (deps && deps.log) await deps.log(ctx, 'jarvis', 'Auto-send ' + (p.enabled ? 'ON for ' + p.senders.join(', ') + ', at most ' + p.maxPerDay + ' a day' + (p.expiresAt ? ', until ' + new Date(p.expiresAt).toISOString().slice(0, 10) : '') : 'OFF') + '.');
  return { ok: true, policy: p };
}
function policyAllows(p, item) {
  if (!p.enabled) return { ok: false, why: 'auto-send is off' };
  if (p.expiresAt && Date.now() > p.expiresAt) return { ok: false, why: 'the policy expired' };
  const from = String(item.from || '').toLowerCase(); const addr = (from.match(/<([^>]+)>/) || [null, from])[1].trim();
  const dom = addr.split('@')[1] || '';
  if (!p.senders.some((s) => s === addr || s === dom || (s.indexOf('@') < 0 && dom.endsWith(s)))) return { ok: false, why: 'sender not in the policy' };
  if (p.kinds && p.kinds.length && !p.kinds.some((k) => (item.subject + ' ' + item.why).toLowerCase().indexOf(k) >= 0)) return { ok: false, why: 'not one of the kinds allowed' };
  const day = new Date().toISOString().slice(0, 10); const n = (p.sentToday && p.sentToday[day]) || 0;
  if (n >= p.maxPerDay) return { ok: false, why: 'today\'s limit (' + p.maxPerDay + ') reached' };
  if (item.flags && item.flags.length) return { ok: false, why: 'the draft has flags: ' + item.flags.join('; ') };
  if (item.draft && item.draft.needs && item.draft.needs.length) return { ok: false, why: 'the draft could not confirm: ' + item.draft.needs.join(', ') };
  return { ok: true };
}
async function autoSend(ctx, deps, item) {
  if (!item || item.state !== 'awaiting' || !item.draft) return null;
  const p = await policy(ctx); const ok = policyAllows(p, item);
  if (!ok.ok) return ok;
  const day = new Date().toISOString().slice(0, 10);
  p.sentToday = { [day]: ((p.sentToday && p.sentToday[day]) || 0) + 1 }; p.log = (p.log || []).concat([{ at: Date.now(), id: item.id, subject: item.subject, to: item.from }]).slice(-50);
  await savePolicy(ctx, p);
  await patch(ctx, item.id, (m) => { m.autoSent = true; });
  const r = await approve(ctx, deps, item.id, item.draft.hash, { who: 'auto-send policy', via: 'policy' });
  if (deps.log) await deps.log(ctx, item.agent, 'Auto-sent under the policy: "' + item.subject + '" (' + p.senders.join(', ') + ').');
  return r;
}

/* ---------- boot: finish what was in flight ---------------------------------------- */
async function recover(ctx, deps) {
  const list = await all(ctx); let n = 0;
  for (const m of list) {
    if (m.state === 'submitting' && m.send && m.send.key) {
      /* the same idempotency key: the provider sends once however many times we ask */
      const r = await submit(ctx, deps, m.id); n++;
      if (deps.log) await deps.log(ctx, m.agent, 'After a restart: the reply to "' + m.subject + '" was ' + (r.ok ? 'completed (same key, sent once)' : 'not completed: ' + r.error) + '.');
    }
  }
  return n;
}

/* ---------- the view, one at a time ------------------------------------------------- */
function queue(list) { return list.filter((m) => m.state === 'awaiting' || m.state === 'revised' || m.state === 'failed').sort((a, b) => a.createdAt - b.createdAt); }
async function view(ctx) {
  const list = await all(ctx); const q = queue(list);
  const p = await policy(ctx);
  const counts = {}; for (const s of STATES) counts[s] = list.filter((m) => m.state === s).length;
  return { current: q[0] || null, queue: q.length, items: list.slice(-40).reverse(), counts, policy: Object.assign({}, p, { log: (p.log || []).slice(-10) }), states: STATES };
}
/* The review, as text for a chat. */
function reviewText(item, n) {
  if (!item) return 'Nothing to review. New actionable emails appear here as they come in.';
  const d = item.draft;
  const thread = item.thread.map((t) => '— ' + t.from + (t.at ? ', ' + new Date(t.at).toISOString().slice(0, 10) : '') + ':\n' + block(t.text, 1500)).join('\n\n');
  return 'EMAIL TO REVIEW' + (n ? ' (' + n + ' waiting)' : '') + '\nFrom: ' + item.from + '\nSubject: ' + item.subject + '\n\nTHE THREAD\n' + thread +
    '\n\nTHE EXACT REPLY (v' + (d ? d.version : 0) + ')' + (d && d.summary ? '\n' + d.summary : '') + '\n\n' + (d ? d.reply : '(no draft yet)') +
    (d && d.needs && d.needs.length ? '\n\nCould not confirm: ' + d.needs.join('; ') : '') + (item.flags.length ? '\n\n⚠ ' + item.flags.join('\n⚠ ') : '') +
    '\n\n/send — send this exact reply (v' + (d ? d.version : 0) + ')\n/revise <what to change> — a new version\n/skip — don\'t send';
}
function stateLine(item) {
  const s = item.state;
  return s === 'accepted' ? 'accepted by the email provider — delivery not yet confirmed' : s === 'delivered' ? 'delivered' : s === 'bounced' ? 'bounced: ' + ((item.send && item.send.bounce) || 'the address refused it') : s === 'failed' ? 'not sent: ' + ((item.send && item.send.error) || '') : s === 'skipped' ? 'not sent (' + (item.skipReason || 'skipped') + ')' : s;
}

/* ---------- fixtures (tests, and the honest demo) ---------------------------------------- */
const FIXTURES = [
  { id: 'fx1', from: 'Ali Demir <ali@northwindtrading.example>', subject: 'Refund for order 4471', text: 'Hello Sarah,\n\nThe premium plan was charged twice this month (order 4471). Could you refund the second charge and confirm by Friday?\n\nThanks,\nAli', at: Date.now() - 3600000 },
  { id: 'fx2', from: 'Weekly Digest <noreply@newsletter.example>', subject: 'Your weekly digest', text: 'Top stories this week… You are receiving this because you subscribed. Unsubscribe here.', at: Date.now() - 7200000 },
  { id: 'fx3', from: 'Burak Şahin <burak@abko-partner.example>', subject: 'Toplantı için uygun zaman', text: 'Merhaba,\n\nÖnümüzdeki hafta demo için uygun bir zamanınız var mı? Salı veya Çarşamba öğleden sonra bize uyar.\n\nSelamlar,\nBurak', at: Date.now() - 1800000 }
];

module.exports = { STATES, all, byId, policy, actionable, intake, draft, checkDraft, approve, submit, revise, skip, attachFeedback, toneOf, toneRules, rememberTone, providerEvent, setPolicy, policyAllows, autoSend, recover, view, queue, reviewText, stateLine, FIXTURES, hash };
