/* ======================================================================
 * The Flow — groups, topics, members and diagnostics for the chat channels
 * ======================================================================
 * A Telegram group (or a topic inside a forum group) is a workspace of its
 * own: its own conversation with J.A.R.V.I.S., its own sticky specialist,
 * its own mode, and work started there reports back there. The owner
 * attaches a group by sending a link code in it (or /attach, once their
 * own Telegram is linked). Members are authorised by their numeric id —
 * nothing a stranger says in a group starts work or gets an answer.
 *
 * Modes: mention-only (the default in a group — he answers commands, a
 * mention of the bot, a reply to him, or his name at the start) or
 * conversational (he answers everything from an authorised member).
 *
 * What survives a restart: workspaces, members and modes live in the
 * store; an inbound update is written down before it is acknowledged and
 * replayed at boot if the process died mid-reply; a reply that could not
 * be delivered waits in an outbox and is retried every minute for a day.
 * /diag says all of this plainly.
 * ====================================================================== */
'use strict';

const FAKE = process.env.FLOW_TEAM_FAKE === '1';
let C = null; /* set by flow-channels: { rawGet, rawSet, ctxFor, whose, send, logLine, configured, env, takeCode, team } */
const STARTED = Date.now();
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function init(deps) { C = deps; }

/* ---------- workspaces ------------------------------------------------- */
const wsId = (channel, chatId, threadId) => channel + ':' + chatId + (threadId ? ':' + threadId : '');
const toOf = (chatId, threadId) => String(chatId) + (threadId ? ':' + threadId : '');

async function groupOwner(channel, chatId) { const v = await C.rawGet('__team:ws:' + channel + ':' + chatId); return typeof v === 'string' && v ? v : null; }
async function all(ctx) { const v = await ctx.get('team:workspaces'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
async function saveAll(ctx, w) { await ctx.set('team:workspaces', w); }

async function attach(ctx, uid, channel, chat, by) {
  await C.rawSet('__team:ws:' + channel + ':' + chat.id, uid);
  const ws = await workspace(ctx, channel, chat, null, true);
  ws.attachedBy = by ? { id: String(by.id), name: str(by.name, 60) } : null;
  await save(ctx, ws);
  if (C.team) await C.team.log(ctx, 'team', 'Group attached: "' + (ws.title || chat.id) + '" on ' + channel + ' (mention-only).');
  return ws;
}
async function detach(ctx, id) {
  const w = await all(ctx); const ws = w[id]; if (!ws) return false;
  /* removing the group removes its topics too */
  for (const k of Object.keys(w)) if (w[k].channel === ws.channel && String(w[k].chatId) === String(ws.chatId) && (!ws.threadId || k === id)) delete w[k];
  if (!ws.threadId) { try { await C.rawSet('__team:ws:' + ws.channel + ':' + ws.chatId, null); } catch (e) {} }
  await saveAll(ctx, w);
  return true;
}
/* Get or make the record for this chat (and topic). */
async function workspace(ctx, channel, chat, threadId, make) {
  const w = await all(ctx);
  const id = wsId(channel, chat.id, threadId);
  let ws = w[id];
  if (!ws && make === false) return null;
  if (!ws) {
    const group = w[wsId(channel, chat.id, null)];
    ws = { id, channel, chatId: String(chat.id), threadId: threadId ? String(threadId) : '', to: toOf(chat.id, threadId), title: str(chat.title || chat.username || chat.id, 80), topic: '',
      mode: group && group.mode ? group.mode : 'mention', agent: 'jarvis', createdAt: Date.now(), lastAt: 0, handled: 0, ignored: 0, refused: 0, kind: chat.type || 'group' };
    w[id] = ws; await saveAll(ctx, w);
  } else if (chat.title && ws.title !== str(chat.title, 80)) { ws.title = str(chat.title, 80); await saveAll(ctx, w); }
  return ws;
}
async function save(ctx, ws) { const w = await all(ctx); w[ws.id] = ws; await saveAll(ctx, w); }
async function byId(ctx, id) { const w = await all(ctx); return w[id] || null; }

/* ---------- members ---------------------------------------------------- */
async function members(ctx) { const v = await ctx.get('team:members'); return v && typeof v === 'object' ? v : {}; }
async function allow(ctx, channel, id, name, by) {
  if (!/^\d{3,20}$/.test(String(id))) return { error: 'A member is authorised by their numeric id (ask them to send /whoami).' };
  const m = await members(ctx); const key = channel + ':' + id;
  m[key] = Object.assign({}, m[key] || {}, { channel, id: String(id), name: str(name || (m[key] && m[key].name) || '', 60), allowed: true, addedAt: (m[key] && m[key].addedAt) || Date.now(), by: str(by, 40) });
  await ctx.set('team:members', m);
  if (C.team) await C.team.log(ctx, 'team', 'Member authorised: ' + (m[key].name ? m[key].name + ' ' : '') + '(' + channel + ' ' + id + ').');
  return { ok: true, member: m[key] };
}
async function deny(ctx, channel, id) {
  const m = await members(ctx); const key = channel + ':' + id;
  if (!m[key]) return { error: 'Nobody with that id is on the list.' };
  m[key].allowed = false; m[key].deniedAt = Date.now();
  await ctx.set('team:members', m);
  if (C.team) await C.team.log(ctx, 'team', 'Member removed: ' + (m[key].name ? m[key].name + ' ' : '') + '(' + channel + ' ' + id + ').');
  return { ok: true, member: m[key] };
}
async function isOwner(uid, channel, fromId) { return !!fromId && (await C.whose(channel, String(fromId))) === uid; }
async function allowed(ctx, uid, channel, from) {
  if (!from || from.id == null) return false;
  if (await isOwner(uid, channel, from.id)) return true;
  const m = await members(ctx); const rec = m[channel + ':' + from.id];
  return !!(rec && rec.allowed);
}
async function touchMember(ctx, channel, from) {
  if (!from || from.id == null) return;
  const m = await members(ctx); const key = channel + ':' + from.id; if (!m[key]) return;
  m[key].lastAt = Date.now(); if (!m[key].name) m[key].name = str(nameOf(from), 60);
  await ctx.set('team:members', m);
}
const nameOf = (from) => from ? ([from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || '') : '';

/* ---------- should he answer this? ------------------------------------- */
function mentioned(msg, botName, asstName) {
  const t = String(msg.text || '');
  if (/^\s*\//.test(t)) return true;
  if (botName && new RegExp('@' + botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t)) return true;
  if (Array.isArray(msg.entities) && msg.entities.some((e) => e.type === 'mention' && botName && t.substr(e.offset, e.length).toLowerCase() === '@' + botName.toLowerCase())) return true;
  if (msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.is_bot) return true;
  const names = ['jarvis'].concat(asstName ? [String(asstName).replace(/\./g, '').toLowerCase()] : []);
  if (new RegExp('^\\s*(?:hey|hi|ok|okay|yo|hello)?[\\s,]*(?:' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i').test(t.replace(/\./g, ''))) return true;
  return false;
}
function stripMention(text, botName, asstName) {
  let t = String(text || '');
  if (botName) t = t.replace(new RegExp('@' + botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[,:]?\\s*', 'ig'), '');
  const names = ['J\\.?A\\.?R\\.?V\\.?I\\.?S\\.?', 'jarvis'].concat(asstName ? [String(asstName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] : []);
  t = t.replace(new RegExp('^\\s*(?:hey|hi|ok|okay|yo|hello)?[\\s,]*(?:' + names.join('|') + ')\\b[\\s,:!.]*', 'i'), '');
  return t.trim();
}

/* ---------- the bot's own name, the webhook's state -------------------- */
async function botName(channel) {
  if (channel !== 'telegram') return '';
  if (FAKE) return 'flow_test_bot';
  const v = await C.rawGet('__team:tg:me'); return v && v.username ? v.username : '';
}
async function learnBot() {
  if (FAKE || !C.configured('telegram')) return;
  try {
    const r = await fetch('https://api.telegram.org/bot' + C.env('TELEGRAM_BOT_TOKEN') + '/getMe');
    const j = await r.json().catch(() => null);
    if (j && j.ok && j.result) await C.rawSet('__team:tg:me', { username: j.result.username || '', id: j.result.id, at: Date.now() });
  } catch (e) { C.logLine('telegram getMe failed: ' + e.message); }
}
async function noteWebhook(ok, description) { await C.rawSet('__team:tg:webhook', { ok: !!ok, description: str(description, 160), at: Date.now() }); }

/* ---------- what survives a restart ------------------------------------ */
/* inbox: an update is written down before it is acknowledged */
async function inboxPut(channel, update) {
  const box = (await C.rawGet('__team:inbox')) || [];
  const rec = { id: 'in' + newId(), channel, update, at: Date.now() };
  box.push(rec); await C.rawSet('__team:inbox', box.slice(-40));
  return rec.id;
}
async function inboxDone(id) {
  const box = (await C.rawGet('__team:inbox')) || [];
  await C.rawSet('__team:inbox', box.filter((r) => r.id !== id));
}
async function replayInbox(process_) {
  const box = (await C.rawGet('__team:inbox')) || [];
  const fresh = box.filter((r) => Date.now() - r.at < 60 * 60 * 1000).slice(-20);
  await C.rawSet('__team:inbox', []);
  let n = 0;
  for (const r of fresh) { try { await process_(r.channel, r.update); n++; } catch (e) { C.logLine('replay failed: ' + e.message); } }
  if (n) C.logLine('replayed ' + n + ' inbound message' + (n === 1 ? '' : 's') + ' from before the restart');
  return n;
}
/* outbox: a reply that could not be delivered */
async function outboxPut(channel, to, text, why) {
  const box = (await C.rawGet('__team:outbox')) || [];
  box.push({ id: 'out' + newId(), channel, to: String(to), text: String(text || '').slice(0, 4000), at: Date.now(), tries: 1, why: str(why, 120) });
  await C.rawSet('__team:outbox', box.slice(-60));
  await noteError(why);
}
async function retryOutbox() {
  const box = (await C.rawGet('__team:outbox')) || [];
  if (!box.length) return 0;
  const keep = []; let n = 0;
  for (const r of box) {
    if (Date.now() - r.at > 24 * 60 * 60 * 1000 || r.tries > 60) continue;
    try { await C.send(r.channel, r.to, r.text); n++; }
    catch (e) { r.tries++; r.why = str(e.message, 120); r.lastTry = Date.now(); keep.push(r); }
  }
  await C.rawSet('__team:outbox', keep);
  if (n) C.logLine('outbox: delivered ' + n + ' waiting message' + (n === 1 ? '' : 's'));
  return n;
}
async function deliver(channel, to, text) {
  try { await C.send(channel, to, text); return true; }
  catch (e) { await outboxPut(channel, to, text, e.message); return false; }
}
async function noteError(m) { try { await C.rawSet('__team:lasterr', { m: str(m, 200), at: Date.now() }); } catch (e) {} }

/* ---------- diagnostics ------------------------------------------------- */
const ago = (t) => { if (!t) return 'never'; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const upFor = () => { const s = Math.round((Date.now() - STARTED) / 1000); return s < 3600 ? Math.round(s / 60) + ' min' : Math.round(s / 360) / 10 + ' h'; };
async function diag(ctx, uid, where) {
  /* where: { channel, chat, threadId, from, ws } or null (from the app) */
  const hook = (await C.rawGet('__team:tg:webhook')) || null;
  const me = await botName('telegram');
  const inbox = ((await C.rawGet('__team:inbox')) || []).filter((r) => Date.now() - r.at > 20000), outbox = (await C.rawGet('__team:outbox')) || [];
  const err = (await C.rawGet('__team:lasterr')) || null;
  const w = await all(ctx); const m = await members(ctx);
  const tl = C.team ? await C.team.tasks(ctx) : [];
  const open = tl.filter((t) => !/^(done|failed|cancelled)$/.test(t.status));
  const ap = C.team ? (await C.team.approvals(ctx)).filter((x) => x.status === 'pending') : [];
  const version = str(C.env('RENDER_GIT_COMMIT') || '', 7) || 'local';
  const lines = ['J.A.R.V.I.S. diagnostics', 'Server: up ' + upFor() + ' · build ' + version + ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'];
  lines.push('Telegram: ' + (C.configured('telegram') ? ('webhook ' + (hook ? (hook.ok ? 'set ' + ago(hook.at) : 'NOT set (' + hook.description + ')') : 'not confirmed yet') + (me ? ' · bot @' + me : '')) : 'awaiting configuration (TELEGRAM_BOT_TOKEN)'));
  if (where && where.ws) {
    const ws = where.ws;
    lines.push('This chat: ' + (ws.threadId ? 'topic ' + ws.threadId + (ws.topic ? ' "' + ws.topic + '"' : '') + ' in ' : '') + '"' + ws.title + '" (id ' + ws.chatId + ') · ' + (ws.mode === 'all' ? 'conversational' : 'mention-only') + ' · talking to ' + (ws.agent === 'jarvis' ? 'J.A.R.V.I.S.' : ws.agent));
    lines.push('Here: ' + ws.handled + ' answered · ' + ws.ignored + ' not addressed to him · ' + ws.refused + ' from unauthorised members');
    const mine = open.filter((t) => t.origin && t.origin.to === ws.to);
    lines.push('Work from here: ' + mine.length + ' in flight' + (ap.length ? ' · ' + ap.length + ' waiting for a yes (whole account)' : ''));
  } else if (where && where.chat && where.chat.type !== 'private') {
    lines.push('This chat: "' + str(where.chat.title, 60) + '" (id ' + where.chat.id + '), not attached to this Flow');
  }
  if (where && where.from) lines.push('You: id ' + where.from.id + (await isOwner(uid, where.channel, where.from.id) ? ' (owner)' : (m[where.channel + ':' + where.from.id] && m[where.channel + ':' + where.from.id].allowed) ? ' (authorised member)' : ' (not authorised)'));
  const groups = Object.values(w).filter((x) => !x.threadId), topics = Object.values(w).filter((x) => x.threadId);
  lines.push('Workspaces: ' + groups.length + ' group' + (groups.length === 1 ? '' : 's') + ', ' + topics.length + ' topic' + (topics.length === 1 ? '' : 's') + ' · members authorised: ' + Object.values(m).filter((x) => x.allowed).length);
  lines.push('Work: ' + open.length + ' in flight · ' + ap.length + ' waiting for a yes' + (open.length ? ' · ' + open.filter((t) => t.status === 'running').length + ' running now' : ''));
  lines.push('Queues: inbox ' + inbox.length + ' · outbox ' + outbox.length + (outbox.length ? ' (retried every minute; oldest ' + ago(outbox[0].at) + ': ' + outbox[0].why + ')' : ' — nothing waiting to be resent'));
  lines.push('Last delivery error: ' + (err ? err.m + ' (' + ago(err.at) + ')' : 'none'));
  lines.push('Restart: tasks resume, workspaces and members are kept, unanswered messages are replayed, waiting replies are resent.');
  return lines.join('\n');
}

/* ---------- the app's view and actions ---------------------------------- */
async function view(ctx, uid) {
  const w = await all(ctx); const m = await members(ctx);
  const hook = (await C.rawGet('__team:tg:webhook')) || null;
  const inbox = ((await C.rawGet('__team:inbox')) || []).filter((r) => Date.now() - r.at > 20000), outbox = (await C.rawGet('__team:outbox')) || [];
  return {
    workspaces: Object.values(w).sort((a, b) => (a.chatId === b.chatId ? (a.threadId ? 1 : 0) - (b.threadId ? 1 : 0) : (b.lastAt || b.createdAt) - (a.lastAt || a.createdAt))),
    members: Object.values(m).sort((a, b) => (b.lastAt || b.addedAt || 0) - (a.lastAt || a.addedAt || 0)),
    bot: await botName('telegram'), webhook: hook, queues: { inbox: inbox.length, outbox: outbox.length }, up: upFor(), diag: await diag(ctx, uid, null)
  };
}
async function act(ctx, uid, b) {
  const op = String(b.op || '');
  if (op === 'mode') { const ws = await byId(ctx, String(b.id || '')); if (!ws) return { error: 'No such workspace.' }; ws.mode = b.mode === 'all' ? 'all' : 'mention'; await save(ctx, ws); return { ok: true, workspace: ws }; }
  if (op === 'agent') { const ws = await byId(ctx, String(b.id || '')); if (!ws) return { error: 'No such workspace.' }; ws.agent = str(b.agent || 'jarvis', 40); await save(ctx, ws); return { ok: true, workspace: ws }; }
  if (op === 'remove') { const ok = await detach(ctx, String(b.id || '')); return ok ? { ok: true } : { error: 'No such workspace.' }; }
  if (op === 'allow') return await allow(ctx, str(b.channel || 'telegram', 20), String(b.id || '').trim(), b.name, 'app');
  if (op === 'deny') return await deny(ctx, str(b.channel || 'telegram', 20), String(b.id || '').trim());
  return { error: 'Unknown op.' };
}

module.exports = { init, wsId, toOf, groupOwner, attach, detach, workspace, save, byId, all, members, allow, deny, allowed, isOwner, touchMember, nameOf, mentioned, stripMention, botName, learnBot, noteWebhook, inboxPut, inboxDone, replayInbox, outboxPut, retryOutbox, deliver, noteError, diag, view, act, STARTED };
