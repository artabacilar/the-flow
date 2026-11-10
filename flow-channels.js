/* =========================================================================
 * flow-channels.js — reaching the team from wherever you already are
 *
 * What this is
 * ------------
 * Telegram, WhatsApp, Slack, Discord, SMS and phone calls (Twilio), and
 * iMessage through a relay on a Mac: each one is an adapter with the same
 * three duties — prove the message really came from the provider, work out
 * whose Flow it belongs to, and send a reply. Everything in the middle (who
 * answers, what a "/yes 1" means, what J.A.R.V.I.S. can do from a text
 * message) is one piece of code shared by all of them.
 *
 * Honesty
 * -------
 * A channel is "awaiting configuration" until every environment variable it
 * needs is in Render — Artur types those himself; nothing here ever shows
 * one. It is "ready to link" once configured, "working" once this account
 * has linked a sender to it. Microsoft Teams is listed as not built, because
 * it is not. Nothing says a message was sent unless the provider accepted it.
 *
 * Whose Flow?
 * -----------
 * A webhook arrives with no session. The sender (a Telegram chat id, a
 * phone number, a Slack user id…) is looked up in the RAW store under
 * `__team:link:<channel>:<id>` → account id. Those live outside every
 * account's namespace, like push tokens, because they are the means of
 * reaching somebody and never belong in /api/all. The link is made once,
 * by the person: the command centre gives a six-digit code that lives ten
 * minutes, and the first message from the new sender carries it. An unknown
 * sender is told how to link and nothing else; it learns nothing about
 * anyone's Flow, not even whether one exists.
 *
 * Phone calls
 * -----------
 * Twilio's ConversationRelay turns a call into text over a websocket and
 * speaks our text back. Node has no websocket server built in and this
 * project avoids dependencies for the one credential that can reach every
 * device, so a small RFC 6455 server lives at the bottom of this file:
 * handshake, masked frames, ping/pong, close. Text only, which is all the
 * relay sends.
 * ====================================================================== */
'use strict';

const crypto = require('crypto');

let team = null;
try { team = require('./flow-team'); } catch (e) { team = null; }
let extras = null;
try { extras = require('./flow-extras'); } catch (e) { extras = null; }
let mcpMod = null;
try { mcpMod = require('./flow-mcp'); } catch (e) { mcpMod = null; }
let groups = null;
try { groups = require('./flow-groups'); } catch (e) { groups = null; }
let speech = null;
try { speech = require('./flow-speech'); } catch (e) { speech = null; }

const FAKE = process.env.FLOW_TEAM_FAKE === '1';
const env = (k) => String(process.env[k] || '').trim();
const ORIGIN = () => (env('PUBLIC_URL') || env('RENDER_EXTERNAL_URL') || '').replace(/\/+$/, '') || 'http://localhost:' + (process.env.PORT || 3000);
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);

/* ---------- the registry --------------------------------------------------- */
const CHANNELS = {
  telegram: { name: 'Telegram', env: ['TELEGRAM_BOT_TOKEN'], built: true,
    how: 'In Telegram, talk to @BotFather → /newbot → copy the token → add it in Render as TELEGRAM_BOT_TOKEN. The Flow registers the webhook itself. Then open the bot and send it your link code.' },
  whatsapp: { name: 'WhatsApp', env: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'], built: true,
    how: 'Meta for Developers → your app → WhatsApp → API setup: the phone-number ID and a permanent access token; the app secret is under App settings → Basic. Webhook: <origin>/api/channels/whatsapp with the verify token you choose; subscribe to "messages". Then message the number with your link code.' },
  wati: { name: 'WhatsApp (Wati)', env: ['WATI_API_ENDPOINT', 'WATI_API_TOKEN', 'WATI_WEBHOOK_KEY'], built: true,
    how: 'Wati → API Docs (left menu): copy the API Endpoint (https://live-mt-server.wati.io/<your id>) into WATI_API_ENDPOINT and the access token into WATI_API_TOKEN. Choose any long random string for WATI_WEBHOOK_KEY. Then Wati → Webhooks → Add: URL <origin>/api/channels/wati?key=<that string>, event "Message Received". WhatsApp only lets a business message you inside 24 hours of your last message, so results reach you there while the conversation is open. Then WhatsApp your Wati number your link code. Everyone else who writes to that number is ignored, so a business inbox keeps working as before.' },
  slack: { name: 'Slack', env: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'], built: true,
    how: 'api.slack.com → create an app → Bot token scopes chat:write, im:history, im:read, im:write → install → copy the bot token and the signing secret. Event Subscriptions → <origin>/api/channels/slack → subscribe to message.im. Then DM the app your link code.' },
  discord: { name: 'Discord', env: ['DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN', 'DISCORD_APP_ID'], built: true,
    how: 'discord.com/developers → application → General: the public key and application ID; Bot: the token. Interactions endpoint URL: <origin>/api/channels/discord. The Flow registers a /jarvis command; use it in any server the bot is in: "/jarvis link 123456", then "/jarvis what is left today".' },
  sms: { name: 'SMS', env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_NUMBER'], built: true,
    how: 'Twilio → a number → Messaging: "A message comes in" → <origin>/api/channels/twilio/sms (HTTP POST). Account SID and auth token are on the console home. Text the number your link code. Per-agent numbers: TWILIO_NUMBERS as JSON {"+1555…":"sarah"}.' },
  voice: { name: 'Phone calls', env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_NUMBER'], built: true,
    how: 'Same Twilio number → Voice: "A call comes in" → <origin>/api/channels/twilio/voice (HTTP POST). Link your mobile number by text first; then calling the number from it reaches J.A.R.V.I.S., and "call me when it is ready" rings you back. Save the number as a contact called Jarvis and "Hey Siri, call Jarvis" works.' },
  imessage: { name: 'iMessage', env: ['IMESSAGE_RELAY_SECRET'], built: true,
    how: 'Needs a Mac that stays on, signed into Messages with an Apple ID for J.A.R.V.I.S. Run scripts/imessage-relay.js there with the same secret (see the file). Then iMessage that Apple ID your link code from your phone.' },
  teams: { name: 'Microsoft Teams', env: [], built: false,
    how: 'Not built yet: Teams bots need an Azure Bot registration and the Bot Framework. It is on the list.' }
};
const ORDER = ['telegram', 'whatsapp', 'wati', 'imessage', 'sms', 'voice', 'slack', 'discord', 'teams'];
function configured(id) { const c = CHANNELS[id]; return !!(c && c.built && c.env.length && c.env.every((k) => env(k))); }

/* ---------- deps, set by start() ------------------------------------------ */
let D = null;      /* { raw, users, nsPrefix, log } */
const logLine = (m) => { try { (D && D.log ? D.log : console.error)('[channels] ' + m); } catch (e) {} };
const rawGet = async (k) => { const v = await D.raw.get(k); if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return v; } };
const rawSet = (k, v) => D.raw.set(k, JSON.stringify(v));

async function userRecord(uid) {
  try {
    const v = await D.raw.get(D.usersKey);
    const users = (typeof v === 'string' ? JSON.parse(v || '{}') : v) || {};
    return Object.values(users).find((u) => u && u.id === uid) || { id: uid };
  } catch (e) { return { id: uid }; }
}
/* An account's context, the shape flow-team expects. */
async function ctxFor(uid) {
  const pre = D.nsPrefix(uid);
  const user = await userRecord(uid);
  return {
    user, uid,
    get: async (k) => rawGet(pre + k),
    set: (k, v) => rawSet(pre + k, v),
    /* for J.A.R.V.I.S.'s own data: the reader flow-extras knows */
    mine: { get: async (k) => rawGet(pre + k) },
    /* the planner, in the app's own stored shapes (what flow-mcp reads and writes) */
    planner: { get: (k) => D.raw.get(pre + k), set: (k, v) => D.raw.set(pre + k, v) }
  };
}
async function links(ctx) { const v = await ctx.get('team:channels'); return v && typeof v === 'object' ? v : {}; }

/* ---------- link codes ----------------------------------------------------- */
const CODE_TTL = 10 * 60 * 1000;
async function newCode(uid) {
  const code = String(crypto.randomInt(100000, 1000000));
  await rawSet('__team:linkcode:' + code, { uid, at: Date.now() });
  return code;
}
async function takeCode(code) {
  const k = '__team:linkcode:' + code;
  const v = await rawGet(k); if (!v || !v.uid) return null;
  await rawSet(k, { used: true });
  if (Date.now() - v.at > CODE_TTL) return null;
  return v.uid;
}
async function link(channel, externalId, uid, name) {
  await rawSet('__team:link:' + channel + ':' + externalId, uid);
  const ctx = await ctxFor(uid);
  const l = await links(ctx);
  l[channel] = { id: String(externalId), name: str(name, 80), agent: 'jarvis', linkedAt: Date.now() };
  await ctx.set('team:channels', l);
  if (team) await team.log(ctx, 'team', CHANNELS[channel].name + ' linked' + (name ? ' (' + str(name, 40) + ')' : '') + '.');
  return ctx;
}
async function unlink(uid, channel) {
  const ctx = await ctxFor(uid);
  const l = await links(ctx);
  if (l[channel]) { try { await D.raw.set('__team:link:' + channel + ':' + l[channel].id, JSON.stringify(null)); } catch (e) {} delete l[channel]; }
  await ctx.set('team:channels', l);
  if (team) await team.log(ctx, 'team', CHANNELS[channel].name + ' unlinked.');
}
async function whose(channel, externalId) { const v = await rawGet('__team:link:' + channel + ':' + externalId); return typeof v === 'string' && v ? v : null; }

/* ---------- what a message does -------------------------------------------- */
const HELP = (names) => 'You are talking to J.A.R.V.I.S. Write to him as you would in the app. Also:\n' +
  '/team — who is on the team\n' + names.map((n) => '/' + n).join(' · ') + ' — talk to one of them (sticky; /jarvis to come back)\n' +
  '/tasks — what is in flight and what is done\n/yes 1 · /no 1 — approve or decline what is waiting\n/answer <text> — answer an agent\'s question\n' +
  '/ideas — what the team could take off your plate · /start 1 — put them on it\n/briefing — this morning\'s briefing, now · /skills — what the team has been taught\n/automations · /run 1 — the scripts that do routine work without a model\n/setup — the guided setup · /setup first — run the first task from here · /deliver here — make this the default channel\n/discover <topic> — five questions, then a workflow spec · /interview <topic> — he keeps asking until you say done · /request <text> · /feedback <text>\n' +
  '/whoami — your numeric id · /diag — how everything is doing · in a group: /mode mention|all · /allow <id> [name] · /deny <id> · /members · /groups\n' +
  'Voice notes are understood; /voice chooses the voice that answers (presets, your own ElevenLabs voice id, text/voice replies, 30 or 60 seconds)\n' +
  'Email review: /review — the next email, one at a time · /send · /revise <what to change> · /skip · /inbox here (a group: one topic per email) · /autosend — the bounded policy\n' +
  '"call me when it is ready" — he rings you (needs the phone channel)';

const UNKNOWN = (channel) => 'This ' + (channel === 'sms' || channel === 'voice' ? 'number' : 'account') + ' is not linked to a Flow. In The Flow, open the command centre → Channels → ' + CHANNELS[channel].name + ' → "Link", and send the six-digit code here.';

/* The reply to one inbound message, as text. Every adapter calls this. */
async function inbound(channel, externalId, text, meta) {
  meta = meta || {};
  text = block(text, 6000);
  if (!team) return 'The team is not switched on for this Flow.';
  /* 1. a link code */
  const code = text.match(/^\s*(?:\/?link\s*)?(\d{6})\s*$/i);
  if (code) {
    const uid = await takeCode(code[1]);
    if (!uid) return 'That code is not right or has expired. Get a fresh one in the command centre → Channels.';
    const ctx = await link(channel, externalId, uid, meta.name);
    const list = (await team.agents(ctx)).filter((a) => !a.archived && a.id !== 'jarvis');
    return 'Linked to ' + ((ctx.user && ctx.user.name) ? ctx.user.name + '\'s' : 'your') + ' Flow on ' + CHANNELS[channel].name + '. ' + HELP(list.map(firstName));
  }
  /* 2. whose Flow */
  const uid = await whose(channel, externalId);
  if (!uid) return UNKNOWN(channel);
  const ctx = await ctxFor(uid);
  if (!text) return 'Say something and I will take it from there.';
  /* the setup's two-way test: this reply is the proof */
  let ponged = false; try { if (team.setupPong) ponged = await team.setupPong(ctx, channel); } catch (e) {}
  if (ponged) return 'Confirmed: ' + CHANNELS[channel].name + ' works both ways. The setup in the command centre has moved on.';
  return await converse(ctx, uid, channel, text, meta);
}

/* The conversation itself, once we know whose Flow it is. meta.ws is the
   group or topic this came from (its own sticky agent, history and mode);
   without it, the person's own private chat on that channel. */
async function converse(ctx, uid, channel, text, meta) {
  meta = meta || {};
  const l = await links(ctx);
  const ws = meta.ws || null;
  const mine = ws ? { agent: ws.agent || 'jarvis' } : (l[channel] || { agent: 'jarvis' });
  const setSticky = async (agentId) => { mine.agent = agentId; if (ws) { ws.agent = agentId; await groups.save(ctx, ws); } else { l[channel] = Object.assign({}, l[channel], mine); await ctx.set('team:channels', l); } };
  const list = await team.agents(ctx);
  const active = list.filter((a) => !a.archived);
  const names = active.filter((a) => a.id !== 'jarvis').map(firstName);
  if ((await ctx.get('team:paused')) === true && !/^\/(team|tasks|help|diag|whoami)\b/i.test(text)) return 'The team is paused. Resume it from the command centre.';

  /* 3. commands */
  const cmd = text.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
  if (cmd) {
    const c = cmd[1].toLowerCase(), rest = (cmd[2] || '').trim();
    if (c === 'help' || c === 'start') return HELP(names);
    if (c === 'team') return active.map((a) => (a.id === mine.agent ? '▶ ' : '· ') + a.name + ' — ' + a.role + (a.id === 'jarvis' ? '' : ' (/' + firstName(a) + ')')).join('\n');
    if (c === 'tasks') return await tasksText(ctx);
    if (c === 'yes' || c === 'approve' || c === 'no' || c === 'decline') {
      const n = parseInt(rest, 10) || 1;
      const pending = (await team.approvals(ctx)).filter((x) => x.status === 'pending');
      const item = pending[n - 1];
      if (!item) return pending.length ? 'There are ' + pending.length + ' waiting; say /yes 1 to /yes ' + pending.length + '.' : 'Nothing is waiting for your yes.';
      const r = await team.decide(ctx, item.id, (c === 'yes' || c === 'approve') ? 'approve' : 'reject');
      if (r.error) return r.error;
      return (c === 'yes' || c === 'approve') ? (r.approval && r.approval.status === 'executed' ? 'Sent: ' + item.summary + '. ' + (r.approval.note || '') : r.approval && r.approval.status === 'send_failed' ? 'Approved, but it could not be sent: ' + (r.approval.error || '') + ' Nothing went out; /yes ' + n + ' again to retry.' : 'Approved: ' + item.summary + '. ' + ((r.approval && r.approval.note) || 'Nothing is connected to send it yet, so it has not gone; it will, once, when the connection exists.')) : 'Declined: ' + item.summary + '.';
    }
    if (c === 'ideas' || c === 'suggest') {
      const sg = await team._work.suggestions(ctx, { fresh: /more|fresh|other/i.test(rest) });
      const open = (sg.items || []).filter((it) => it.status === 'open');
      if (sg.error && !open.length) return sg.error;
      return open.length ? 'What the team could take off your plate:\n' + open.map((it, i) => (i + 1) + '. ' + it.title + (it.why ? ' — ' + it.why : '')).join('\n') + '\n\n/start 1 to put them on it; /ideas more for others.' : 'Nothing worth suggesting from your record just now.';
    }
    if (c === 'start' && /^\d+$/.test(rest)) {
      const sg = await team._work.suggestions(ctx, {});
      const open = (sg.items || []).filter((it) => it.status === 'open');
      const it = open[parseInt(rest, 10) - 1];
      if (!it) return open.length ? 'Say /start 1 to /start ' + open.length + '.' : 'No suggestions are open; /ideas first.';
      const r = await team._work.suggestAct(ctx, uid, it.id, 'start', 'en');
      if (r.error) return r.error;
      return 'Started: ' + it.title + (r.task ? ' (' + r.task.steps.map((s) => (list.find((x) => x.id === s.agent) || {}).name || s.agent).join(', ') + ')' : '') + '. I will message you here when it is ready.';
    }
    if (c === 'skills' || c === 'skill') {
      const sk = team.skills ? (await team.skills.all(ctx)).filter((s) => s.status === 'active') : [];
      return sk.length ? 'Skills the team has:\n' + sk.map((s) => '· ' + s.name + ' (v' + s.version + (s.assignedTo.length ? ', ' + s.assignedTo.map((id) => (list.find((a) => a.id === id) || {}).name || id).join('/') : '') + ') — ' + str(s.purpose, 100)).join('\n') + '\n\nSay "use the <name> skill" in a request to invoke one.' : 'No skills yet. Teach one in the command centre → Skills, or say "turn that into a skill" after a task.';
    }
    if (c === 'automations' || c === 'scripts') {
      const sc = team.scripts ? (await team.scripts.all(ctx)).filter((x) => x.status !== 'archived') : [];
      return sc.length ? 'Automations:\n' + sc.map((x, i) => (i + 1) + '. ' + x.name + ' (v' + x.version + ', ' + x.status + (x.lastRun ? ', last ' + x.lastRun.status : '') + ') — ' + str(x.purpose, 90)).join('\n') + '\n\n/run 1 runs one now (inputs use their defaults).' : 'No automations yet. Make one in the command centre → Automations, or say "turn the repeatable parts of this workflow into an automation" after a task.';
    }
    if (c === 'run' && team.scripts) {
      const sc = (await team.scripts.all(ctx)).filter((x) => x.status !== 'archived');
      const pick = /^\d+$/.test(rest) ? sc[parseInt(rest, 10) - 1] : sc.find((x) => x.name.toLowerCase() === rest.toLowerCase()) || sc.find((x) => x.name.toLowerCase().indexOf(rest.toLowerCase()) >= 0);
      if (!pick) return sc.length ? 'Which one? /automations lists them; say /run 1.' : 'No automations yet.';
      if (pick.status !== 'active') return '"' + pick.name + '" is ' + pick.status + '. Enable it in the command centre first.';
      const run = await team.scripts.startRun(ctx, team.scriptDeps(), pick, { uid, trigger: 'channel ' + channel });
      return '"' + pick.name + '" v' + pick.version + ': ' + run.status + (run.error ? ' — ' + run.error : '') + (run.output ? '\n\n' + String(run.output).slice(0, 2500) : '') + (run.metrics ? '\n\n(' + run.metrics.items + ' items · ' + run.metrics.ms + ' ms · ' + run.metrics.modelCalls + ' model call' + (run.metrics.modelCalls === 1 ? '' : 's') + ')' : '');
    }
    if ((c === 'discover' || c === 'interview' || c === 'askme' || c === 'sor' || c === 'mulakat' || c === 'mülakat') && team.context) {
      const r = await team.context.discover(ctx, team.ctxDeps(), { op: 'start', mode: (c === 'interview' || c === 'mulakat' || c === 'mülakat') ? 'relentless' : 'ask', topic: rest, via: channel, lang: team.context.langOf(rest) });
      return r.error ? r.error : r.say;
    }
    if ((c === 'done' || c === 'writeup' || c === 'bitti' || c === 'yaz') && team.context) { const r = await team.context.discover(ctx, team.ctxDeps(), { op: 'finish' }); return r.error ? r.error : r.say; }
    if ((c === 'request' || c === 'feedback') && team.context) { if (!rest) return 'Say what you want after /' + c + '.'; const r = await team.context.addRequest(ctx, team.ctxDeps(), { text: rest, kind: c, via: channel }); return r.error ? r.error : (c === 'feedback' ? 'Noted — thank you. It is on the list in the command centre.' : 'Noted. It is on the request list in the command centre; I will say when it is done.'); }
    if (c === 'setup') {
      if (!team.setupText) return 'Setup is not available here.';
      if (/^first\b/i.test(rest)) { const which = (rest.split(/\s+/)[1] || 'today').toLowerCase(); const r = await team.setupAct(ctx, uid, { step: 'first', which, via: channel }); if (r.error) return r.error; return 'Started the first task: "' + r.task.title + '" — read-only; ' + ((list.find((a) => a.id === r.task.agent) || {}).name || 'an agent') + ' is on it and the result lands here.'; }
      return await team.setupText(ctx, uid);
    }
    if (c === 'deliver' || c === 'delivery') {
      if (!rest) { const cur = await ctx.get('team:delivery'); return 'Results and briefings go to ' + (cur ? (cur === 'app' ? 'the app' : cur === 'push' ? 'push notifications' : (CHANNELS[cur] || {}).name || cur) : 'every linked channel') + ' by default. Say /deliver here, /deliver app or /deliver push.'; }
      const where = /^here$/i.test(rest) ? channel : rest.toLowerCase();
      if (!(where === 'app' || where === 'push' || (l[where] && l[where].id))) return 'I can deliver here, to the app, to push, or to a channel that is linked.';
      await ctx.set('team:delivery', where);
      try { if (team.setupAct) await team.setupAct(ctx, uid, { step: 'delivery', where }); } catch (e) {}
      return 'Done: results and briefings go to ' + (where === 'app' ? 'the app' : where === 'push' ? 'push notifications' : CHANNELS[where].name) + ' by default.';
    }
    if (c === 'briefing' || c === 'brief') { const L = team._work.localParts(await team._work.userTz(ctx), new Date()); return await team._work.briefingText(ctx, L, 'en'); }
    if (c === 'answer') {
      const waiting = (await team.tasks(ctx)).filter((t) => t.status === 'awaiting_info');
      if (!waiting.length) return 'Nobody is waiting on an answer.';
      if (!rest) return waiting[0].question;
      await team.patchTask(ctx, waiting[0].id, (x) => { x.answer = rest; x.status = 'queued'; x.seen = true; });
      team.kick(uid, ctx);
      return 'Passed on. They are back on it.';
    }
    if (c === 'jarvis') { await setSticky('jarvis'); return 'J.A.R.V.I.S. here, sir. Go ahead.'; }
    const ag = active.find((a) => firstName(a) === c);
    if (ag) { await setSticky(ag.id); return rest ? await talk(ctx, uid, channel, ag, rest, meta) : 'You are talking to ' + ag.name + ' (' + ag.role + ')' + (ws ? ' here' : '') + '. /jarvis to come back.'; }
    if (groups) {
      const from = meta.from || null, owner = from ? await groups.isOwner(uid, channel, from.id) : !ws;
      if (c === 'whoami') return from ? 'Your ' + (CHANNELS[channel] || { name: channel }).name + ' id is ' + from.id + (owner ? ' — the owner of this Flow.' : (await groups.allowed(ctx, uid, channel, from)) ? ' — an authorised member.' : ' — not authorised yet; the owner can say /allow ' + from.id + '.') : 'This channel does not say who is writing.';
      if (c === 'diag' || c === 'diagnostics' || c === 'status') return await groups.diag(ctx, uid, { channel, chat: meta.chat || null, from, ws });
      if (c === 'members' || c === 'allow' || c === 'deny' || c === 'mode' || c === 'groups' || c === 'detach' || c === 'voice' || c === 'review' || c === 'send' || c === 'revise' || c === 'skip' || c === 'inbox' || c === 'autosend') {
        if (!owner) return 'Only the owner of this Flow can do that.';
        if (c === 'members') { const m = Object.values(await groups.members(ctx)); return m.length ? 'Members:\n' + m.map((x) => '· ' + (x.name || '(no name)') + ' — ' + x.channel + ' ' + x.id + (x.allowed ? '' : ' — removed')).join('\n') + '\n\n/allow <id> [name] · /deny <id>. Everyone finds their id with /whoami.' : 'No members yet. Ask them to send /whoami here, then /allow <id> <name>.'; }
        if (c === 'allow') { const mm = rest.match(/^(\d{3,20})\s*(.*)$/); if (!mm) return 'Say /allow <numeric id> [name] — they get their id with /whoami.'; const r = await groups.allow(ctx, channel, mm[1], mm[2], 'owner'); return r.error ? r.error : 'Authorised: ' + (r.member.name || r.member.id) + '. They can give the team instructions in any group attached to this Flow.'; }
        if (c === 'deny') { const r = await groups.deny(ctx, channel, rest.trim()); return r.error ? r.error : 'Removed: ' + (r.member.name || r.member.id) + '. Nothing they say here is acted on now.'; }
        if (c === 'mode') { if (!ws) return 'Modes are for groups and topics. In your own chat I answer everything.'; if (!/^(mention|all|conversational|everything|quiet)$/i.test(rest)) return 'This ' + (ws.threadId ? 'topic' : 'group') + ' is ' + (ws.mode === 'all' ? 'conversational' : 'mention-only') + '. Say /mode mention (I answer when addressed) or /mode all (I answer everything from authorised members).'; ws.mode = /^(all|conversational|everything)$/i.test(rest) ? 'all' : 'mention'; await groups.save(ctx, ws); return 'Done: this ' + (ws.threadId ? 'topic' : 'group') + ' is ' + (ws.mode === 'all' ? 'conversational — I answer everything from authorised members.' : 'mention-only — I answer when mentioned, replied to, or called by name.'); }
        if (c === 'detach') { if (!ws) return 'Only in a group.'; await groups.detach(ctx, groups.wsId(channel, ws.chatId, null)); return 'Detached. Nothing said here reaches your Flow now.'; }
        if ((c === 'review' || c === 'send' || c === 'revise' || c === 'skip' || c === 'inbox' || c === 'autosend') && team.mail) {
          const M = team.mail, D = team.mailDeps();
          if (c === 'inbox') {
            if (!ws) return 'Say /inbox here in the group that should receive emails — one topic per email.';
            if (!/^here\b/i.test(rest)) { const cur = await ctx.get('team:mail:inbox'); return cur ? 'Emails open as topics in "' + (cur.title || cur.chatId) + '". Say /inbox here in another group to move it.' : 'No inbox group yet. Say /inbox here in the group that should get one topic per email.'; }
            await ctx.set('team:mail:inbox', { channel, chatId: ws.chatId, title: ws.title, at: Date.now() });
            return 'Done: every actionable email opens as a topic here — sender, the thread, the exact reply, and /send · /revise · /skip inside it.';
          }
          if (c === 'autosend') {
            const pol = await M.policy(ctx);
            if (!rest) return 'Auto-send is ' + (pol.enabled ? 'ON: replies to ' + pol.senders.join(', ') + ', at most ' + pol.maxPerDay + ' a day' + (pol.expiresAt ? ', until ' + new Date(pol.expiresAt).toISOString().slice(0, 10) : '') : 'OFF') + '.\n/autosend off · /autosend on <sender or domain>[,…] <n per day> [<days>] — e.g. /autosend on abko-partner.example 2 7\nEverything else still waits for your yes; every auto-sent reply is logged with its exact text.';
            if (/^off\b/i.test(rest)) { const r = await M.setPolicy(ctx, D, { enabled: false }); return r.error || 'Auto-send is OFF. Every reply waits for your yes again.'; }
            const mm = rest.match(/^on\s+(\S+)\s+(\d+)(?:\s+(\d+))?/i); if (!mm) return 'Say /autosend on <sender or domain> <n per day> [<days>], or /autosend off.';
            const r = await M.setPolicy(ctx, D, { enabled: true, senders: mm[1], maxPerDay: mm[2], days: mm[3] || 7 }); return r.error || ('Auto-send is ON for ' + r.policy.senders.join(', ') + ': at most ' + r.policy.maxPerDay + ' a day until ' + new Date(r.policy.expiresAt).toISOString().slice(0, 10) + '. Only clean drafts (no flags, nothing unconfirmed) go; /autosend off revokes it at once.');
          }
          const v = await M.view(ctx);
          const bound = ws ? (v.items || []).find((it) => it.topic && it.topic.wsId === ws.id) : null;
          const item = bound || v.current;
          if (c === 'review') return bound ? M.reviewText(bound, 0) : M.reviewText(v.current, v.queue);
          if (!item) return 'Nothing is waiting to be sent.';
          if (c === 'send') { const r = await M.approve(ctx, D, item.id, item.draft ? item.draft.hash : '', { who: meta.name || 'owner', via: channel, override: /anyway|override/i.test(rest) }); if (r.error) return r.error + (r.flags ? '' : ''); const it = r.item; return 'Sent — accepted by the email provider (v' + it.approval.version + ' to ' + it.from + '). I will say when it is delivered; that is a separate confirmation.' + (v.queue > 1 && !bound ? '\n\nNext:\n' + M.reviewText((await M.view(ctx)).current, v.queue - 1) : ''); }
          if (c === 'revise') { if (!rest) return 'Say what to change: /revise <your words>.'; const r = await M.revise(ctx, D, item.id, rest, {}); if (r.error) return r.error; return (r.tone ? 'Noted as a rule for every email from now on: "' + r.tone + '".\n\n' : '') + M.reviewText(r.item, 0); }
          if (c === 'skip') { const r = await M.skip(ctx, D, item.id, rest); if (r.error) return r.error; const nv = await M.view(ctx); return 'Not sent: "' + item.subject + '".' + (nv.current && !bound ? '\n\nNext:\n' + M.reviewText(nv.current, nv.queue) : ''); }
        }
        if (c === 'voice' && speech) { const r = await speech.command(ctx, rest, channel, ws ? ws.id : ''); if (r && r.test) { meta.voiceTest = true; return 'This is the voice that answers here' + (ws ? ' in this ' + (ws.threadId ? 'topic' : 'group') : '') + '. Good evening, sir.'; } return r; }
        if (c === 'groups') { const w = Object.values(await groups.all(ctx)); return w.length ? 'Workspaces:\n' + w.map((x) => '· ' + (x.threadId ? '  topic ' + x.threadId + (x.topic ? ' "' + x.topic + '"' : '') + ' in ' : '') + '"' + x.title + '" — ' + (x.mode === 'all' ? 'conversational' : 'mention-only') + (x.agent !== 'jarvis' ? ' · ' + ((active.find((a) => a.id === x.agent) || {}).name || x.agent) : '') + ' · ' + x.handled + ' answered').join('\n') : 'No groups attached yet. Add the bot to a group and send your link code there, or /attach.'; }
      }
    }
    return 'I do not know /' + c + '. ' + HELP(names);
  }
  /* a discovery is running: this is the answer to its question */
  if (team.context) {
    try { const st = await team.context.discover(ctx, team.ctxDeps(), { op: 'status' }); if (st.discovery && st.discovery.status === 'active') { if (/turn (it|this|that) into a skill|beceriye dönüştür|beceri yap/i.test(text)) { const r = await team.context.discover(ctx, team.ctxDeps(), { op: 'skill', id: st.discovery.id }); return r.error ? r.error : r.say; } const r = await team.context.discover(ctx, team.ctxDeps(), { op: 'answer', id: st.discovery.id, text, via: channel }); return r.error ? r.error : r.say; } if (st.discovery && st.discovery.status === 'done' && !st.discovery.skill && /turn (it|this|that) into a skill|beceriye dönüştür|beceri yap/i.test(text)) { const r = await team.context.discover(ctx, team.ctxDeps(), { op: 'skill', id: st.discovery.id }); return r.error ? r.error : r.say; } } catch (e) {}
  }
  /* "@sarah …" for one message */
  const at = text.match(/^@(\w+)[\s,:]+([\s\S]+)$/);
  if (at) { const ag = active.find((a) => firstName(a) === at[1].toLowerCase()); if (ag) return await talk(ctx, uid, channel, ag, at[2].trim(), meta); }
  /* a bare answer while someone is waiting on one */
  const waiting = (await team.tasks(ctx)).filter((t) => t.status === 'awaiting_info');
  if (waiting.length && mine.agent === 'jarvis' && text.length < 400 && !/\?$/.test(text)) {
    await team.patchTask(ctx, waiting[0].id, (x) => { x.answer = text; x.status = 'queued'; x.seen = true; });
    team.kick(uid, ctx);
    return 'Passed on to ' + ((active.find((a) => a.id === waiting[0].asker) || {}).name || 'them') + '. They are back on it.';
  }
  const who = active.find((a) => a.id === mine.agent) || active.find((a) => a.id === 'jarvis');
  return await talk(ctx, uid, channel, who, text, meta);
}
function firstName(a) { return String(a.name || '').split(/\s+/)[0].toLowerCase().replace(/[^\p{L}]/gu, ''); }

async function tasksText(ctx) {
  const tl = await team.tasks(ctx);
  const open = tl.filter((t) => !/^(done|failed|cancelled)$/.test(t.status)).slice(-8).reverse();
  const done = tl.filter((t) => /^(done|failed|cancelled)$/.test(t.status)).slice(-4).reverse();
  const S = { queued: 'queued', running: 'working', awaiting_info: 'needs an answer', awaiting_approval: 'needs your yes', done: 'done', failed: 'did not finish', cancelled: 'cancelled' };
  const ap = (await team.approvals(ctx)).filter((x) => x.status === 'pending');
  let out = open.length ? 'In flight:\n' + open.map((t) => '· ' + t.title + ' — ' + S[t.status]).join('\n') : 'Nothing in flight.';
  if (done.length) out += '\n\nRecent:\n' + done.map((t) => '· ' + t.title + ' — ' + S[t.status]).join('\n');
  if (ap.length) out += '\n\nWaiting for your yes:\n' + ap.map((x, i) => '[' + (i + 1) + '] ' + x.summary).join('\n') + '\n/yes 1 or /no 1';
  return out;
}

/* One message to one agent. A specialist answers from their thread.
   J.A.R.V.I.S. answers from the Flow's own record and can start work,
   approve and decline — in words, from a text message. */
async function talk(ctx, uid, channel, agent, text, meta) {
  if (agent.id !== 'jarvis') {
    const r = await team.sayTo(ctx, agent.id, text, 'en', { via: channel, spoken: meta && meta.spoken ? meta.spoken : null });
    return r.error ? r.error : r.say + (team.context && !(meta && meta.spoken) ? team.context.footer(r.sources, team.context.langOf(text)) : '');
  }
  return await jarvis(ctx, uid, channel, text, meta);
}

const J_SYSTEM = (owner, agents, know, tasks, pending, snapshot, planner) => [
  'You are J.A.R.V.I.S., chief of staff to ' + str(owner, 60) + ', answering a text message from them (not in the app: a chat channel, so plain text, short, no markdown symbols, no lists longer than five lines).',
  'Manner: an impeccable British butler — composed, precise, courteous, a dry wit used sparingly. Address them as "sir" at most once per reply. Never claim to be a film character.',
  'You act on their word: you change their planner (Priorities on a day, habits), start work for the team, approve/decline — and you never claim something was done that your actions do not do. Questions get answers from THEIR DATA below.',
  '',
  'THE TEAM (id | name | role): ' + agents.filter((a) => a.id !== 'jarvis').map((a) => a.id + ' | ' + a.name + ' | ' + a.role).join('; '),
  know.length ? 'WHAT THE TEAM KNOWS (current): ' + know.map((k) => k.text).join(' · ') : '',
  tasks.length ? 'WORK IN FLIGHT / RECENT: ' + tasks.map((t) => t.title + ' (' + t.status.replace('_', ' ') + ')').join('; ') : 'No work in flight.',
  pending.length ? 'WAITING FOR THEIR YES: ' + pending.map((x, i) => '[' + (i + 1) + '] ' + x.summary).join('; ') : '',
  '',
  planner ? 'TODAY: ' + planner.today + '\nTHEIR WEEK (id | day date | time | title | done):\n' + (planner.rocks || '(nothing planned)') + '\nHABITS: ' + (planner.habits || '(none)') : '',
  '',
  'Return ONLY a JSON object:',
  '{ "say": "your reply", "ask": false, "actions": [ { "type": "rock", "title": "", "day": "friday | tomorrow | 2026-11-13", "time": "14:00 (optional)", "end": "", "priority": "high | medium | low", "note": "who, why, what to bring" }, { "type": "rock_update", "id": "from THEIR WEEK", "title": "", "day": "", "time": "", "note": "", "done": true }, { "type": "habit", "name": "" }, { "type": "habit_log", "habit": "name", "day": "today", "done": true }, { "type": "delegate", "title": "", "brief": "", "callMe": false }, { "type": "approve", "n": 1 }, { "type": "decline", "n": 1 } ] }',
  '· rock / rock_update / habit / habit_log: their planner. Telling you what they have to do, or who they want to meet, IS the request — add it at once, no confirmation. A meeting with someone is a Priority on that day titled "Meet <name> (<company>)", with who they are and why in the note. Two things to raise with the same person are ONE Priority. Waiting on someone is a follow-up Priority. Check THEIR WEEK first: change what is there (rock_update) rather than adding it twice; "done", "move", "rename" use rock_update with its id. Something done every day is a habit, not seven Priorities.',
  '· Ask only when it truly matters (which of two people, a day that cannot be guessed): then "ask": true, one short question, and NO actions. A missing time is not a reason to ask — leave it out.',
  '· "say" says what was done, in the past tense ("Added Kadir Yıldız (Noar) to Friday."), in the language they wrote in.',
  '· delegate: when they want work done by the team — drafting, replying, analysing, researching, checking, preparing. "brief" carries every detail; "callMe": true if they asked to be rung when it is ready. The team works in the background and they are messaged when it is done; say so.',
  '· approve / decline: only when they clearly say yes or no to a numbered item waiting for their yes.',
  '· A question about their day, week, habits, sleep, spend, or the team\'s work gets a real answer from the data, no actions. If the data does not show it, say so; invent nothing.',
  '',
  snapshot ? '# THEIR DATA\n' + snapshot.slice(0, 20000) : ''
].filter((x) => x !== '').join('\n');

async function jarvis(ctx, uid, channel, text, meta) {
  const list = await team.agents(ctx);
  const j = list.find((a) => a.id === 'jarvis');
  const which = await team.resolveModel(j.model);
  if (!which) return 'J.A.R.V.I.S. has no model available here yet.';
  const allKnow = await team.knowledge(ctx);
  const kb = team.memory.blocks(allKnow, 'jarvis');
  const know = kb.facts.concat(kb.rules).slice(-40);
  const tl = (await team.tasks(ctx)).slice(-8);
  const pending = (await team.approvals(ctx)).filter((x) => x.status === 'pending');
  let snapshot = '';
  try { if (extras && extras._internals && extras._internals.buildContext) snapshot = await extras._internals.buildContext(ctx.mine); } catch (e) {}
  const hkey = meta && meta.ws ? 'ws:' + meta.ws.id : channel;
  const hist = await histGet(ctx, hkey);
  const messages = hist.concat([{ role: 'user', content: text }]);
  const planner = await plannerView(ctx);
  const sys = J_SYSTEM(ctx.user && (ctx.user.name || ctx.user.email), list.filter((a) => !a.archived), know, tl, pending, snapshot, planner).replace('# THEIR DATA', (kb.historyText ? 'SUPERSEDED (no longer true; history only, with dates):\n' + kb.historyText + '\n\n' : '') + '# THEIR DATA') +
    (meta && meta.spoken ? '\n\nSPOKEN REPLY: "say" will be read aloud as a voice note of about ' + meta.spoken.seconds + ' seconds — at most ' + meta.spoken.words + ' words, plain sentences, no lists, no symbols, no URLs.' : '') + (meta && meta.voice ? '\n\nThe message was a voice note, transcribed; a word may be off — ask if something makes no sense.' : '');
  const r = await team.complete({ model: which.model, system: sys, messages, maxTokens: 1200, timeoutMs: 60000 });
  if (r.error) return r.error;
  await team.bumpUsage(ctx, 'jarvis', r.usage, which.model);
  let say = '', actions = [];
  const m = String(r.text || '').match(/\{[\s\S]*\}/);
  if (m) { try { const o = JSON.parse(m[0]); say = block(o.say, 3000); actions = Array.isArray(o.actions) && !o.ask ? o.actions.slice(0, 10) : []; } catch (e) {} }
  if (!say && !m) say = block(r.text, 3000);
  const extra = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    if (/^(rock|rock_update|habit|habit_log)$/.test(a.type)) {
      const r = await plannerDo(ctx, a);
      if (r) extra.push(r);
    } else if (a.type === 'delegate' && a.brief) {
      const d = await team.delegateText(ctx, uid, block(a.brief, 4000), 'en', { callMe: a.callMe === true && configured('voice'), via: channel, origin: meta && meta.ws ? { channel, to: meta.ws.to, ws: meta.ws.id } : null });
      if (d.error) extra.push(d.error); else if (d.task) extra.push('Started: ' + d.task.title + ' (' + d.task.steps.map((s) => (list.find((x) => x.id === s.agent) || {}).name || s.agent).join(', ') + '). I will message you here when it is ready' + (d.task.callMe ? ', and ring you' : '') + '.');
    } else if ((a.type === 'approve' || a.type === 'decline') && pending[(+a.n || 1) - 1]) {
      const item = pending[(+a.n || 1) - 1];
      const dr = await team.decide(ctx, item.id, a.type === 'approve' ? 'approve' : 'reject');
      if (!dr.error) extra.push((a.type === 'approve' ? 'Approved: ' : 'Declined: ') + item.summary + (a.type === 'approve' ? ' — not sent yet; nothing is connected to send it.' : ''));
    }
  }
  const reply = [say].concat(extra).filter(Boolean).join('\n\n') || 'Noted, sir.';
  let foot = ''; try { const rec = await team.provenance(ctx, { agent: 'jarvis', via: channel, model: which.model, said: text, reply, knowledge: know, superseded: kb.old, snapshot: !!snapshot, thread: hist.length }); if (team.context && rec) foot = team.context.footer(team.context.sourcesFor(know, rec.used), team.context.langOf(text)); } catch (e) {}
  await histSet(ctx, hkey, hist.concat([{ role: 'user', content: text }, { role: 'assistant', content: reply }]).slice(-12));
  return reply + foot;
}
/* ---------- the planner, from a chat channel ------------------------------
   The same writes Claude's MCP connector makes (flow-mcp), on this person's
   own stored planner, so the app shows them on its next sync. */
async function plannerView(ctx) {
  if (!mcpMod || !ctx.planner) return null;
  const I = mcpMod._internals.IMPL; const c = { store: ctx.planner, now: new Date() };
  const line = (r) => r.id + ' | ' + r.dayName + ' ' + r.date + ' | ' + (r.time || '-') + ' | ' + r.title + ' | ' + (r.done ? 'done' : 'open');
  const rows = [];
  for (const w of ['this', 'next']) {
    try { const wk = await I.get_week({ week: w }, c); for (const d of wk.days) for (const r of d.rocks) rows.push(line({ id: r.id, dayName: d.day.slice(0, 3), date: d.date, time: r.time, title: r.title, done: r.done })); } catch (e) {}
  }
  let habits = '';
  try { const hb = await c.store.get('ld_habits'); const h = typeof hb === 'string' ? JSON.parse(hb) : hb; habits = ((h && h.habits) || []).map((x) => x.name).join(', '); } catch (e) {}
  const now = new Date();
  return { today: now.toISOString().slice(0, 10) + ' (' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()] + ')', rocks: rows.slice(0, 80).join('\n'), habits };
}
async function plannerDo(ctx, a) {
  if (!mcpMod || !ctx.planner) return 'I could not reach your planner just now.';
  const I = mcpMod._internals.IMPL; const c = { store: ctx.planner, now: new Date() };
  const pick = (o, keys) => { const out = {}; for (const k of keys) if (o[k] != null && o[k] !== '') out[k] = typeof o[k] === 'string' ? str(o[k], k === 'note' ? 1000 : 300) : o[k]; return out; };
  try {
    if (a.type === 'rock') { if (!a.title) return null; await I.add_rock(pick(a, ['title', 'day', 'time', 'end', 'priority', 'note', 'role']), c); return null; }
    if (a.type === 'rock_update') { if (!a.id) return null; await I.update_rock(pick(a, ['id', 'title', 'day', 'time', 'end', 'priority', 'note', 'done']), c); return null; }
    if (a.type === 'habit') { if (!a.name) return null; await I.add_habit({ name: str(a.name, 120) }, c); return null; }
    if (a.type === 'habit_log') { if (!a.habit) return null; await I.log_habit(pick(a, ['habit', 'day', 'done']), c); return null; }
  } catch (e) { return 'Not done: ' + str(e.message, 200); }
  return null;
}
async function histGet(ctx, channel) { const v = await ctx.get('team:chan:hist:' + channel); return Array.isArray(v) ? v : []; }
async function histSet(ctx, channel, h) { await ctx.set('team:chan:hist:' + channel, h.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 2000) }))); }

/* ---------- outbound: the task runner's results, to every linked channel --- */
const sent = [];   /* FAKE only: what would have gone out */
async function notify(uid, text, opts) {
  if (!D) return;
  const ctx = await ctxFor(uid);
  const l = await links(ctx);
  /* a default delivery channel narrows the fan-out to that channel; a reply
     to a message in another channel still goes where it was asked (opts.channel) */
  /* work started in a group or topic reports back there, nowhere else */
  const origin = opts && opts.task && opts.task.origin && opts.task.origin.to ? opts.task.origin : null;
  if (origin && groups) { const ok = await groups.deliver(origin.channel, origin.to, text); return ok ? 1 : 0; }
  const def = await ctx.get('team:delivery');
  const only = opts && opts.channel ? opts.channel : (typeof def === 'string' && l[def] && l[def].id ? def : null);
  if (def === 'app' && !(opts && opts.channel)) return 0;
  let n = 0;
  for (const ch of Object.keys(l)) {
    if (!l[ch] || !l[ch].id || ch === 'voice') continue;
    if (only && ch !== only) continue;
    try { await send(ch, l[ch].id, text, ctx); n++; } catch (e) { logLine(ch + ' send failed: ' + (e && e.message)); if (groups && ch === 'telegram') await groups.outboxPut(ch, l[ch].id, text, e.message); }
  }
  if (opts && opts.call && l.voice && l.voice.id && configured('voice') && opts.task) {
    try { await placeCall(l.voice.id, opts.task.id, uid); } catch (e) { logLine('call failed: ' + (e && e.message)); }
  }
  return n;
}

/* ---------- sending ------------------------------------------------------- */
async function post(url, headers, body, form) {
  if (FAKE) { if (global.__failNextSend) { global.__failNextSend = false; throw new Error('simulated network failure'); } sent.push({ url, body }); return { status: 200, body: { ok: true, result: { message_id: 1, message_thread_id: 1000 + sent.length }, messages: [{ id: 'wamid.1' }], ts: '1', channel: 'C1', sid: 'SM1' } }; }
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, headers || {}), body: form ? new URLSearchParams(body).toString() : JSON.stringify(body), signal: ac.signal });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  } finally { clearTimeout(t); }
}
const chunks = (text, n) => { const out = []; let s = String(text || ''); while (s.length > n) { let cut = s.lastIndexOf('\n', n); if (cut < n / 2) cut = n; out.push(s.slice(0, cut)); s = s.slice(cut).replace(/^\n/, ''); } if (s) out.push(s); return out; };

async function send(channel, to, text, ctx) {
  if (!configured(channel)) throw new Error(CHANNELS[channel].name + ' is not configured');
  if (channel === 'telegram') {
    const m = String(to).match(/^(-?\d+):(\d+)$/); const body0 = m ? { chat_id: m[1], message_thread_id: +m[2] } : { chat_id: to };
    for (const part of chunks(text, 3900)) { const r = await post('https://api.telegram.org/bot' + env('TELEGRAM_BOT_TOKEN') + '/sendMessage', {}, Object.assign({}, body0, { text: part })); if (r.status >= 300) throw new Error('telegram ' + r.status + (r.body && r.body.description ? ' ' + str(r.body.description, 100) : '')); }
  } else if (channel === 'whatsapp') {
    for (const part of chunks(text, 3900)) { const r = await post('https://graph.facebook.com/v21.0/' + env('WHATSAPP_PHONE_ID') + '/messages', { Authorization: 'Bearer ' + env('WHATSAPP_TOKEN') }, { messaging_product: 'whatsapp', to, type: 'text', text: { body: part } }); if (r.status >= 300) throw new Error('whatsapp ' + r.status + (r.body && r.body.error ? ' ' + str(r.body.error.message, 120) : '')); }
  } else if (channel === 'wati') {
    /* Wati's session message: the text rides in the query string; a 200 is "accepted", and ok:false in the body is a refusal (most often the 24-hour window has closed). */
    const base = env('WATI_API_ENDPOINT').replace(/\/+$/, '');
    for (const part of chunks(text, 4000)) {
      const r = await post(base + '/api/v1/sendSessionMessage/' + encodeURIComponent(String(to).replace(/[^\d]/g, '')) + '?messageText=' + encodeURIComponent(part), { Authorization: 'Bearer ' + env('WATI_API_TOKEN').replace(/^Bearer\s+/i, '') }, {});
      if (r.status >= 300 || (r.body && (r.body.result === false || r.body.ok === false))) throw new Error('wati ' + r.status + (r.body && (r.body.info || r.body.message) ? ' ' + str(r.body.info || r.body.message, 120) : ''));
    }
  } else if (channel === 'slack') {
    for (const part of chunks(text, 3900)) { const r = await post('https://slack.com/api/chat.postMessage', { Authorization: 'Bearer ' + env('SLACK_BOT_TOKEN') }, { channel: to, text: part }); if (r.status >= 300 || (r.body && r.body.ok === false)) throw new Error('slack ' + (r.body && r.body.error || r.status)); }
  } else if (channel === 'discord') {
    /* a DM needs the gateway; replies go through the interaction's follow-up webhook (see the handler). Unsolicited results go to the last interaction's channel. */
    const ch = ctx && (await links(ctx)).discord && (await links(ctx)).discord.channel;
    if (!ch) throw new Error('discord: no channel to post to yet');
    for (const part of chunks(text, 1900)) { const r = await post('https://discord.com/api/v10/channels/' + ch + '/messages', { Authorization: 'Bot ' + env('DISCORD_BOT_TOKEN') }, { content: part }); if (r.status >= 300) throw new Error('discord ' + r.status); }
  } else if (channel === 'sms') {
    const from = numberFor(ctx && (await links(ctx)).sms && (await links(ctx)).sms.agent) || env('TWILIO_NUMBER');
    for (const part of chunks(text, 1500)) { const r = await post('https://api.twilio.com/2010-04-01/Accounts/' + env('TWILIO_ACCOUNT_SID') + '/Messages.json', { Authorization: 'Basic ' + Buffer.from(env('TWILIO_ACCOUNT_SID') + ':' + env('TWILIO_AUTH_TOKEN')).toString('base64') }, { From: from, To: to, Body: part }, true); if (r.status >= 300) throw new Error('twilio ' + r.status); }
  } else if (channel === 'imessage') {
    const k = '__team:imsg:outbox'; const box = (await rawGet(k)) || []; box.push({ to, text, at: Date.now() }); await rawSet(k, box.slice(-50));
  }
}
/* A voice note out (Telegram). FAKE records it like everything else. */
async function sendVoice(channel, to, audio, caption) {
  if (channel !== 'telegram') throw new Error('voice notes go out on Telegram only for now');
  if (!configured(channel)) throw new Error('Telegram is not configured');
  const m = String(to).match(/^(-?\d+):(\d+)$/);
  const fields = m ? { chat_id: m[1], message_thread_id: String(m[2]) } : { chat_id: String(to) };
  if (caption) fields.caption = String(caption).slice(0, 1000);
  if (FAKE) { if (global.__failNextSend) { global.__failNextSend = false; throw new Error('simulated network failure'); } sent.push({ url: 'https://api.telegram.org/bot…/sendVoice', body: Object.assign({}, fields, { voice: '<' + audio.buffer.length + ' bytes ' + audio.mime + '>', bytes: audio.buffer.length, provider: audio.provider, voiceId: audio.voiceId, seconds: audio.seconds }) }); return; }
  const form = new FormData();
  for (const k of Object.keys(fields)) form.append(k, fields[k]);
  form.append('voice', new Blob([audio.buffer], { type: audio.mime || 'audio/ogg' }), 'reply.ogg');
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch('https://api.telegram.org/bot' + env('TELEGRAM_BOT_TOKEN') + '/sendVoice', { method: 'POST', body: form, signal: ac.signal });
    if (!r.ok) { let d = ''; try { d = String(((await r.json()) || {}).description || '').slice(0, 100); } catch (e) {} throw new Error('telegram sendVoice ' + r.status + (d ? ' ' + d : '')); }
  } finally { clearTimeout(t); }
}
/* The reply to a message, as text and/or a voice note, by the voice settings. */
async function replyOut(ctx, channel, to, text, meta) {
  if (!text) return;
  const wsId = meta && meta.ws ? meta.ws.id : '';
  const v = speech ? await speech.voiceFor(ctx, channel, wsId) : null;
  const asVoice = !!(speech && v && channel === 'telegram' && !(meta && meta.command && !meta.voiceTest) && (v.replies === 'voice' || v.replies === 'both' || (meta && meta.voice) || (meta && meta.voiceTest)));
  const asText = !asVoice || v.replies !== 'voice' || !!(meta && meta.command);
  let spokenOk = false;
  if (asVoice) {
    const spokenText = speech.trimForSpeech(text, v.limit);
    const a = await speech.synthesize(spokenText, v);
    if (a.error) { if (groups) await groups.noteError('voice: ' + a.error); }
    else { try { await sendVoice(channel, to, a, ''); spokenOk = true; } catch (e) { if (groups) await groups.outboxPut(channel, to, text, e.message); return; } }
  }
  if (asText || !spokenOk) {
    const heard = meta && meta.voice && meta.voice.text ? '“' + str(meta.voice.text, 140) + '”\n\n' : '';
    if (groups) await groups.deliver(channel, to, heard + text); else await send(channel, to, heard + text);
  }
}
function numberFor(agentId) { try { const m = JSON.parse(env('TWILIO_NUMBERS') || '{}'); for (const n in m) if (m[n] === agentId) return n; } catch (e) {} return ''; }
function agentForNumber(num) { try { const m = JSON.parse(env('TWILIO_NUMBERS') || '{}'); return m[num] || ''; } catch (e) { return ''; } }

/* ---------- verifying the provider ---------------------------------------- */
function telegramSecret() { return crypto.createHash('sha256').update('tg:' + env('TELEGRAM_BOT_TOKEN')).digest('hex').slice(0, 40); }
function hmacHex(alg, key, data) { return crypto.createHmac(alg, key).update(data).digest('hex'); }
function safeEq(a, b) { const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || '')); return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B); }
function slackOk(headers, rawBody) {
  const ts = headers['x-slack-request-timestamp'], sig = headers['x-slack-signature'];
  if (!ts || !sig || Math.abs(Date.now() / 1000 - (+ts)) > 300) return false;
  return safeEq(sig, 'v0=' + hmacHex('sha256', env('SLACK_SIGNING_SECRET'), 'v0:' + ts + ':' + rawBody));
}
function whatsappOk(headers, rawBody) {
  const sig = headers['x-hub-signature-256']; if (!sig) return false;
  return safeEq(sig, 'sha256=' + hmacHex('sha256', env('WHATSAPP_APP_SECRET'), rawBody));
}
function discordOk(headers, rawBody) {
  try {
    const sig = headers['x-signature-ed25519'], ts = headers['x-signature-timestamp']; if (!sig || !ts) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(env('DISCORD_PUBLIC_KEY'), 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(ts + rawBody), key, Buffer.from(sig, 'hex'));
  } catch (e) { return false; }
}
/* Twilio: base64(HMAC-SHA1(auth token, full URL + the POST params sorted by key, concatenated)). */
function twilioOk(headers, url, params) {
  const sig = headers['x-twilio-signature']; if (!sig) return false;
  const keys = Object.keys(params).sort();
  const data = url + keys.map((k) => k + params[k]).join('');
  const want = crypto.createHmac('sha1', env('TWILIO_AUTH_TOKEN')).update(data).digest('base64');
  return safeEq(sig, want);
}
const twilioUrl = (p) => ORIGIN() + p;
const xml = (s) => String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/* One Telegram update, private chat or group, start to finish. */
async function telegramUpdate(u) {
  const msg = u.message || u.edited_message; const chat = msg.chat;
  const name = groups ? groups.nameOf(msg.from) : ([msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(' ') || (msg.from && msg.from.username) || '');
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  const threadId = isGroup && msg.is_topic_message && msg.message_thread_id ? String(msg.message_thread_id) : '';
  const to = groups ? groups.toOf(chat.id, threadId) : String(chat.id);
  const meta = { name, from: msg.from, chat, to };
  /* a voice note: understood first, then handled like the same words typed */
  if (msg.voice && speech) {
    const uidV = isGroup ? await groups.groupOwner('telegram', chat.id) : await whose('telegram', String(chat.id));
    if (!uidV) { if (!isGroup) await send('telegram', to, UNKNOWN('telegram')); return; }
    let audio; try { audio = await speech.telegramVoice(msg.voice.file_id); } catch (e) { await send('telegram', to, 'I could not fetch that voice note (' + str(e.message, 80) + '). Say it again, or type it.'); return; }
    const cV = await ctxFor(uidV); let lang = 'en'; try { const st = await cV.get('flow:settings'); const o = typeof st === 'string' ? JSON.parse(st) : st; lang = (o && o.lang) || 'en'; } catch (e) {}
    const tr = await speech.transcribe(audio, lang === 'tr' ? 'tr' : '');
    if (tr.error) { if (groups) await groups.noteError(tr.error); await send('telegram', to, tr.missing ? tr.error : 'I could not make out that voice note. ' + tr.error); return; }
    if (!tr.text) { await send('telegram', to, 'I heard nothing in that voice note. Say it again?'); return; }
    msg.text = tr.text; meta.voice = { text: tr.text, seconds: msg.voice.duration || 0, provider: tr.provider, lang: tr.lang };
    const v = await speech.voiceFor(cV, 'telegram', isGroup ? groups.wsId('telegram', chat.id, threadId) : ''); meta.spoken = v.limit;
  } else if (speech) {
    /* typed, but the reply will be spoken: tell the model the length */
    const uidT = isGroup ? await groups.groupOwner('telegram', chat.id) : await whose('telegram', String(chat.id));
    if (uidT) { const v = await speech.voiceFor(await ctxFor(uidT), 'telegram', isGroup ? groups.wsId('telegram', chat.id, threadId) : ''); if (v.replies === 'voice' || v.replies === 'both') meta.spoken = v.limit; }
  }
  meta.command = /^\s*\//.test(String(msg.text || ''));
  const uid = isGroup ? await groups.groupOwner('telegram', chat.id) : await whose('telegram', String(chat.id));
  const ctxR = uid ? await ctxFor(uid) : null;
  /* a screenshot in an email's topic is feedback on that draft */
  if (msg.photo && !msg.text) {
    if (!ctxR || !team || !team.mail || !isGroup) return;
    const wsId = groups.wsId('telegram', chat.id, threadId);
    const item = (await team.mail.all(ctxR)).find((m) => m.topic && m.topic.wsId === wsId);
    if (!item) return;
    const ph = msg.photo[msg.photo.length - 1] || {};
    await team.mail.attachFeedback(ctxR, item.id, 'telegram:' + (ph.file_id || ''), msg.caption || '');
    await groups.deliver('telegram', to, 'Got the screenshot' + (msg.caption ? ' and your note' : '') + '. Tell me in a line what to change — /revise <your words> — and I will redraft.');
    return;
  }
  if (!isGroup || !groups) {
    const reply = await inbound('telegram', String(chat.id), msg.text, meta);
    if (reply) { if (ctxR && speech) await replyOut(ctxR, 'telegram', to, reply, meta); else if (groups) await groups.deliver('telegram', to, reply); else await send('telegram', to, reply); }
    return;
  }
  const reply = await groupMessage('telegram', chat, threadId, msg, name, meta);
  if (reply) { if (ctxR && speech) await replyOut(ctxR, 'telegram', to, reply, meta); else await groups.deliver('telegram', to, reply); }
}

/* A message in a group or topic: whose Flow, is the sender allowed, is he
   being addressed — then the ordinary conversation, in that workspace. */
async function groupMessage(channel, chat, threadId, msg, name, meta0) {
  const text = block(msg.text, 6000); const from = msg.from || {};
  const bot = await groups.botName(channel);
  let uid = await groups.groupOwner(channel, chat.id);
  /* not attached yet: a link code, or /attach by a linked owner */
  if (!uid) {
    const code = text.match(/^\s*(?:\/?link\s*)?(\d{6})\s*$/i);
    if (code) {
      const u2 = await takeCode(code[1]);
      if (!u2) return 'That code is not right or has expired. Get a fresh one in the command centre → Channels.';
      const c2 = await ctxFor(u2);
      await groups.attach(c2, u2, channel, chat, { id: from.id, name });
      if (from.id && !(await groups.isOwner(u2, channel, from.id))) await groups.allow(c2, channel, from.id, name, 'link');
      return 'This group is attached to ' + ((c2.user && c2.user.name) ? c2.user.name + '\'s' : 'your') + ' Flow — mention-only: I answer when mentioned (@' + (bot || 'the bot') + '), replied to, or called by name. /mode all makes me answer everything from authorised members; /allow <id> <name> authorises a member (/whoami tells them their id); /diag shows how things stand.';
    }
    const ownerOf = from.id ? await whose(channel, String(from.id)) : null;
    if (ownerOf && /^\/(attach|start|link)\b/i.test(text)) {
      const c2 = await ctxFor(ownerOf);
      await groups.attach(c2, ownerOf, channel, chat, { id: from.id, name });
      return 'This group is attached to your Flow — mention-only. /mode all for everything, /allow <id> <name> for members, /diag for the state of things.';
    }
    if (groups.mentioned(msg, bot, '')) return 'This group is not attached to a Flow. The owner sends their six-digit link code here (command centre → Channels → Telegram → Link), or /attach if their own Telegram is already linked.';
    return null;
  }
  const ctx = await ctxFor(uid);
  const ws = await groups.workspace(ctx, channel, chat, threadId, true);
  if (threadId && msg.reply_to_message && msg.reply_to_message.forum_topic_created && !ws.topic) { ws.topic = str(msg.reply_to_message.forum_topic_created.name, 60); }
  let asst = ''; try { const st = await ctx.get('flow:settings'); const o = typeof st === 'string' ? JSON.parse(st) : st; asst = (o && o.asstName) || ''; } catch (e) {}
  const addressed = groups.mentioned(msg, bot, asst);
  const ok = await groups.allowed(ctx, uid, channel, from);
  if (!ok) {
    ws.refused++; ws.lastAt = Date.now(); await groups.save(ctx, ws);
    if (/^\s*\/whoami\b/i.test(text)) return 'Your ' + CHANNELS[channel].name + ' id is ' + from.id + ' — not authorised yet; the owner can say /allow ' + from.id + (name ? ' ' + name.split(' ')[0] : '') + '.';
    if (!addressed) return null;
    /* told once an hour at most, per person */
    const key = '__team:warned:' + channel + ':' + from.id; const w = await rawGet(key);
    if (w && Date.now() - w.at < 60 * 60 * 1000) return null;
    await rawSet(key, { at: Date.now() });
    return 'I only take instructions from authorised members here. Your id is ' + from.id + ' — the owner can say /allow ' + from.id + ' ' + (name ? name.split(' ')[0] : '') + '.';
  }
  await groups.touchMember(ctx, channel, from);
  if (ws.mode !== 'all' && !addressed) { ws.ignored++; ws.lastAt = Date.now(); await groups.save(ctx, ws); return null; }
  const clean = groups.stripMention(text, bot, asst) || text;
  ws.handled++; ws.lastAt = Date.now(); await groups.save(ctx, ws);
  if (!clean.trim()) return 'Yes' + (name ? ', ' + name.split(' ')[0] : '') + '?';
  const metaG = Object.assign({}, meta0 || {}, { name, from, chat, ws, command: /^\s*\//.test(clean) });
  if (meta0) { meta0.ws = ws; meta0.command = metaG.command; }
  const reply = await converse(ctx, uid, channel, clean, metaG);
  if (meta0 && metaG.voiceTest) meta0.voiceTest = true;
  return reply;
}

/* A new email to review: one topic per email in the inbox group, or the
   review text where results normally go. */
async function mailNew(ctx, item) {
  if (!team || !team.mail) return;
  const inbox = await ctx.get('team:mail:inbox');
  const text = team.mail.reviewText(item, 0);
  if (inbox && inbox.channel === 'telegram' && configured('telegram') && groups) {
    let threadId = '';
    try {
      const r = await post('https://api.telegram.org/bot' + env('TELEGRAM_BOT_TOKEN') + '/createForumTopic', {}, { chat_id: inbox.chatId, name: str(item.subject, 80) + ' — ' + str(item.fromName || item.from, 30) });
      threadId = r.body && r.body.ok && r.body.result ? String(r.body.result.message_thread_id || '') : '';
    } catch (e) { logLine('createForumTopic failed: ' + e.message); }
    const to = threadId ? inbox.chatId + ':' + threadId : String(inbox.chatId);
    const wsId = groups.wsId('telegram', inbox.chatId, threadId);
    try { const ws = await groups.workspace(ctx, 'telegram', { id: inbox.chatId, title: inbox.title, type: 'supergroup' }, threadId, true); ws.topic = str(item.subject, 60); ws.mode = 'all'; await groups.save(ctx, ws); } catch (e) {}
    await ctx.set('team:mail', (await team.mail.all(ctx)).map((m) => (m.id === item.id ? Object.assign(m, { topic: { channel: 'telegram', chatId: String(inbox.chatId), threadId, wsId, to } }) : m)));
    await groups.deliver('telegram', to, text);
    return;
  }
  try { await notify(ctx.uid || (ctx.user && ctx.user.id), text, {}); } catch (e) {}
}

/* ---------- the webhooks (no session) ------------------------------------- */
const watiSeen = new Set();
async function handle(p, req, res, ctx) {
  if (p.indexOf('/api/channels/') !== 0) return false;
  const headers = {}; for (const k in req.headers) headers[k.toLowerCase()] = String(req.headers[k]);
  const text = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' }); res.end(body); return true; };
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); return true; };

  /* tests only: what the stand-in would have sent */
  if (FAKE && p === '/api/channels/_sent') return json(200, { n: sent.length, last: sent[sent.length - 1] || null, recent: sent.slice(-6) });
  if (FAKE && p === '/api/channels/_failnext') { global.__failNextSend = true; return json(200, { ok: true }); }
  if (FAKE && p === '/api/channels/_replay' && groups) { const n = await groups.replayInbox((ch, u) => telegramUpdate(u)); const d = await groups.retryOutbox(); return json(200, { ok: true, replayed: n, delivered: d }); }

  /* Telegram */
  if (p === '/api/channels/telegram' && req.method === 'POST') {
    if (!configured('telegram')) return text(503, 'not configured');
    if (!safeEq(headers['x-telegram-bot-api-secret-token'], telegramSecret())) return text(403, 'no');
    const raw = await ctx.readBody(req); let u = {}; try { u = JSON.parse(raw); } catch (e) {}
    const msg = u.message || u.edited_message; const chat = msg && msg.chat;
    if (!msg || !chat || (typeof msg.text !== 'string' && !msg.voice && !msg.photo)) { json(200, { ok: true }); return true; }
    /* written down before it is acknowledged: a restart mid-reply replays it */
    let inId = null; try { if (groups) inId = await groups.inboxPut('telegram', u); } catch (e) {}
    json(200, { ok: true });
    if (FAKE && headers['x-flow-test-crash']) return true;   /* tests: the process "died" here */
    try { await telegramUpdate(u); } catch (e) { logLine('telegram: ' + (e && e.message)); if (groups) await groups.noteError('telegram: ' + (e && e.message)); }
    try { if (inId) await groups.inboxDone(inId); } catch (e) {}
    return true;
  }

  /* WhatsApp Cloud API */
  if (p === '/api/channels/whatsapp' && req.method === 'GET') {
    const q = ctx.query;
    if (configured('whatsapp') && q.get('hub.mode') === 'subscribe' && safeEq(q.get('hub.verify_token'), env('WHATSAPP_VERIFY_TOKEN'))) return text(200, q.get('hub.challenge') || '');
    return text(403, 'no');
  }
  if (p === '/api/channels/whatsapp' && req.method === 'POST') {
    if (!configured('whatsapp')) return text(503, 'not configured');
    const raw = await ctx.readBody(req);
    if (!whatsappOk(headers, raw)) return text(403, 'no');
    let u = {}; try { u = JSON.parse(raw); } catch (e) {}
    json(200, { ok: true });
    try {
      for (const e of (u.entry || [])) for (const c of (e.changes || [])) {
        const v = c.value || {}; const names = {}; (v.contacts || []).forEach((ct) => { if (ct && ct.wa_id) names[ct.wa_id] = ct.profile && ct.profile.name; });
        for (const m of (v.messages || [])) {
          if (!m || m.type !== 'text' || !m.text) continue;
          const reply = await inbound('whatsapp', String(m.from), m.text.body, { name: names[m.from] || '' });
          await send('whatsapp', String(m.from), reply);
        }
      }
    } catch (e) { logLine('whatsapp: ' + (e && e.message)); }
    return true;
  }

  /* Slack Events API */
  /* WhatsApp through Wati. Wati does not sign its webhooks, so the URL carries
     a secret only this server and his Wati workspace know. Only a contact's
     own text messages are answered — not what his operators or the API
     send (owner), and each message once, however often Wati retries it. */
  if (p === '/api/channels/wati' && req.method === 'POST') {
    if (!configured('wati')) return text(503, 'not configured');
    if (!safeEq(ctx.query && ctx.query.get('key'), env('WATI_WEBHOOK_KEY'))) return text(403, 'no');
    const raw = await ctx.readBody(req); let m = {}; try { m = JSON.parse(raw); } catch (e) {}
    json(200, { ok: true });
    try {
      const kind = String(m.eventType || m.event || 'message');
      if (kind !== 'message' || m.owner === true || String(m.type || 'text') !== 'text' || typeof m.text !== 'string' || !m.waId) return true;
      const mid = String(m.whatsappMessageId || m.id || '');
      if (mid) { if (watiSeen.has(mid)) return true; watiSeen.add(mid); if (watiSeen.size > 500) watiSeen.delete(watiSeen.values().next().value); }
      const from = String(m.waId).replace(/[^\d]/g, '');
      /* A Wati number is usually a business's shared inbox: its customers
         write to it too. Only his own linked number — or a link code — is
         answered; everyone else is left to his team, untouched. */
      if (!(await whose('wati', from)) && !/^\s*(?:\/?link\s*)?\d{6}\s*$/i.test(m.text)) return true;
      const reply = await inbound('wati', from, m.text, { name: str(m.senderName, 60) });
      if (reply) await send('wati', from, reply);
    } catch (e) { logLine('wati: ' + (e && e.message)); }
    return true;
  }

  if (p === '/api/channels/slack' && req.method === 'POST') {
    if (!configured('slack')) return text(503, 'not configured');
    const raw = await ctx.readBody(req);
    let u = {}; try { u = JSON.parse(raw); } catch (e) {}
    if (u.type === 'url_verification' && slackOk(headers, raw)) return json(200, { challenge: u.challenge });
    if (!slackOk(headers, raw)) return text(403, 'no');
    json(200, { ok: true });
    const ev = u.event || {};
    if (u.type !== 'event_callback' || ev.type !== 'message' || ev.bot_id || ev.subtype || ev.channel_type !== 'im' || typeof ev.text !== 'string') return true;
    try { const reply = await inbound('slack', String(ev.user), ev.text, { name: '' }); await send('slack', String(ev.channel), reply); const uid = await whose('slack', String(ev.user)); if (uid) { const c2 = await ctxFor(uid); const l = await links(c2); if (l.slack && l.slack.id !== String(ev.channel)) { l.slack.id = String(ev.channel); l.slack.user = String(ev.user); await c2.set('team:channels', l); } } } catch (e) { logLine('slack: ' + (e && e.message)); }
    return true;
  }

  /* Discord interactions (slash command /jarvis) */
  if (p === '/api/channels/discord' && req.method === 'POST') {
    if (!configured('discord')) return text(503, 'not configured');
    const raw = await ctx.readBody(req);
    if (!discordOk(headers, raw)) return text(401, 'invalid request signature');
    let u = {}; try { u = JSON.parse(raw); } catch (e) {}
    if (u.type === 1) return json(200, { type: 1 });
    if (u.type === 2 && u.data && u.data.name === 'jarvis') {
      const opt = (u.data.options || []).find((o) => o.name === 'text'); const said = opt ? String(opt.value || '') : '';
      const user = (u.member && u.member.user) || u.user || {}; const id = String(user.id || '');
      json(200, { type: 5 });
      (async () => {
        try {
          const reply = await inbound('discord', id, said, { name: user.global_name || user.username || '' });
          const uid = await whose('discord', id);
          if (uid && u.channel_id) { const c2 = await ctxFor(uid); const l = await links(c2); if (l.discord) { l.discord.channel = String(u.channel_id); await c2.set('team:channels', l); } }
          await post('https://discord.com/api/v10/webhooks/' + env('DISCORD_APP_ID') + '/' + u.token, {}, { content: reply.slice(0, 1900) });
        } catch (e) { logLine('discord: ' + (e && e.message)); }
      })();
      return true;
    }
    return json(200, { type: 4, data: { content: 'Use /jarvis <text>.' } });
  }

  /* Twilio SMS */
  if (p === '/api/channels/twilio/sms' && req.method === 'POST') {
    if (!configured('sms')) return text(503, 'not configured');
    const raw = await ctx.readBody(req); const params = Object.fromEntries(new URLSearchParams(raw));
    if (!twilioOk(headers, twilioUrl(p), params)) return text(403, 'no');
    const from = String(params.From || ''), to = String(params.To || ''), body = String(params.Body || '');
    /* a number of one specialist's: that one answers */
    let reply;
    try {
      const ag = agentForNumber(to);
      const uid = await whose('sms', from);
      if (ag && uid && !/^\s*\/|^\s*\d{6}\s*$/.test(body)) { const c2 = await ctxFor(uid); const list = await team.agents(c2); const a = list.find((x) => x.id === ag); reply = a ? await talk(c2, uid, 'sms', a, body, {}) : await inbound('sms', from, body, {}); }
      else reply = await inbound('sms', from, body, {});
    } catch (e) { logLine('sms: ' + (e && e.message)); reply = 'Something went wrong on my side. Try again shortly.'; }
    const parts = chunks(reply, 1500);
    return text(200, '<?xml version="1.0" encoding="UTF-8"?><Response>' + parts.map((x) => '<Message>' + xml(x) + '</Message>').join('') + '</Response>', 'text/xml; charset=utf-8');
  }

  /* Twilio Voice: the call becomes a websocket conversation */
  if (p === '/api/channels/twilio/voice' && req.method === 'POST') {
    if (!configured('voice')) return text(503, 'not configured');
    const raw = await ctx.readBody(req); const params = Object.fromEntries(new URLSearchParams(raw));
    const fullUrl = twilioUrl(p) + (req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '');
    if (!twilioOk(headers, fullUrl, params)) return text(403, 'no');
    const from = String(params.Direction || '').indexOf('outbound') === 0 ? String(params.To || '') : String(params.From || '');
    const uid = await whose('sms', from) || await whose('voice', from);
    const taskId = ctx.query.get('task') || '';
    if (!uid) return text(200, '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Google.en-GB-Neural2-B">This number is not linked to a Flow. Text it your link code first.</Say><Hangup/></Response>', 'text/xml; charset=utf-8');
    const c2 = await ctxFor(uid); const call = (await c2.get('team:channels')) || {};
    if (!call.voice || call.voice.id !== from) { call.voice = { id: from, agent: 'jarvis', linkedAt: Date.now() }; await c2.set('team:channels', call); }
    const wss = ORIGIN().replace(/^http/, 'ws') + '/api/channels/twilio/relay';
    const hello = taskId ? 'Good day, sir. J.A.R.V.I.S. The work you asked for is ready; shall I read it to you?' : 'Good day, sir. J.A.R.V.I.S. here. How may I help?';
    return text(200, '<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay url="' + xml(wss) + '" welcomeGreeting="' + xml(hello) + '" voice="en-GB-Neural2-B" ttsProvider="google" interruptible="true"><Parameter name="uid" value="' + xml(uid) + '"/><Parameter name="from" value="' + xml(from) + '"/><Parameter name="task" value="' + xml(taskId) + '"/></ConversationRelay></Connect></Response>', 'text/xml; charset=utf-8');
  }

  /* iMessage relay (a Mac that stays on) */
  if (p === '/api/channels/imessage/in' && req.method === 'POST') {
    if (!configured('imessage')) return json(503, { error: 'not configured' });
    const raw = await ctx.readBody(req); let b = {}; try { b = JSON.parse(raw); } catch (e) {}
    if (!safeEq(headers['x-relay-secret'] || b.secret, env('IMESSAGE_RELAY_SECRET'))) return json(403, { error: 'no' });
    const from = str(b.from, 120), body = block(b.text, 6000);
    if (!from) return json(400, { error: 'from' });
    try { const reply = await inbound('imessage', from, body, { name: str(b.name, 80) }); await send('imessage', from, reply); return json(200, { ok: true, reply }); } catch (e) { return json(502, { error: e && e.message }); }
  }
  if (p === '/api/channels/imessage/out' && req.method === 'GET') {
    if (!configured('imessage')) return json(503, { error: 'not configured' });
    if (!safeEq(headers['x-relay-secret'] || ctx.query.get('secret'), env('IMESSAGE_RELAY_SECRET'))) return json(403, { error: 'no' });
    const k = '__team:imsg:outbox'; const box = (await rawGet(k)) || []; await rawSet(k, []);
    return json(200, { ok: true, messages: box });
  }
  return false;
}

/* ---------- signed in: the Channels panel ---------------------------------- */
/* Every channel's state for one account: the panel, and the connectors list. */
async function statusList(uid, c) {
  c = c || await ctxFor(uid);
  const l = await links(c);
  return ORDER.map((id) => {
    const ch = CHANNELS[id]; const conf = configured(id); const lk = l[id] || null;
    const status = !ch.built ? 'not_built' : !conf ? 'awaiting' : lk ? 'working' : 'ready';
    return { id, name: ch.name, status, env: ch.env.filter((k) => !env(k)), how: ch.how.replace(/<origin>/g, ORIGIN()), linked: lk ? { id: lk.id, name: lk.name || '', agent: lk.agent || 'jarvis', at: lk.linkedAt } : null };
  });
}
async function linkedCount(uid) { const c = await ctxFor(uid); const l = await links(c); return Object.keys(l).filter((k) => l[k] && l[k].id && k !== 'voice' && configured(k)).length; }

async function handleUser(p, req, res, ctx) {
  if (p.indexOf('/api/channels/me') !== 0) return false;
  const json = ctx.json;
  const uid = ctx.user && ctx.user.id;
  const c = await ctxFor(uid);
  if (p === '/api/channels/me' && req.method === 'GET') {
    json(res, 200, { ok: true, channels: await statusList(uid, c), origin: ORIGIN(), voice: speech ? Object.assign(speech.status(), { settings: await speech.settings(c), current: await speech.voiceFor(c, '', ''), telegram: await speech.voiceFor(c, 'telegram', '') }) : null });
    return true;
  }
  if (p === '/api/channels/me/voice' && speech) {
    if (req.method === 'GET') { json(res, 200, Object.assign({ ok: true }, speech.status(), { settings: await speech.settings(c), current: await speech.voiceFor(c, '', ''), telegram: await speech.voiceFor(c, 'telegram', '') })); return true; }
    if (req.method === 'POST') {
      let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
      if (b.op === 'test') {
        const l = await links(c); if (!l.telegram || !l.telegram.id) { json(res, 400, { error: 'Link Telegram first; the test is a voice note sent there.' }); return true; }
        const v = await speech.voiceFor(c, 'telegram', b.ws || '');
        const a = await speech.synthesize('This is the voice that answers on Telegram. Good evening, sir.', v);
        if (a.error) { json(res, 502, { error: a.error }); return true; }
        try { await sendVoice('telegram', b.ws ? String(b.ws).split(':').slice(1).join(':') : l.telegram.id, a, ''); json(res, 200, { ok: true, voice: v.label, provider: a.provider, seconds: a.seconds }); } catch (e) { json(res, 502, { error: e.message }); }
        return true;
      }
      const r = await speech.setVoice(c, b.level || 'default', b.key || '', b.patch || b);
      json(res, r.error ? 400 : 200, r.error ? r : Object.assign(r, { current: await speech.voiceFor(c, '', '') }));
      return true;
    }
  }
  if (p === '/api/channels/me/code' && req.method === 'POST') {
    const code = await newCode(uid);
    json(res, 200, { ok: true, code, minutes: 10 });
    return true;
  }
  if (p === '/api/channels/me/unlink' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
    if (!CHANNELS[b.channel]) { json(res, 400, { error: 'Which channel?' }); return true; }
    await unlink(uid, String(b.channel));
    json(res, 200, { ok: true });
    return true;
  }
  if (p === '/api/channels/me/groups' && groups) {
    if (req.method === 'GET') { json(res, 200, Object.assign({ ok: true }, await groups.view(c, uid))); return true; }
    if (req.method === 'POST') {
      let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
      const r = await groups.act(c, uid, b);
      json(res, r.error ? 400 : 200, r);
      return true;
    }
  }
  if (p === '/api/channels/me/test' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) {}
    const l = await links(c); const lk = l[b.channel];
    if (!lk) { json(res, 400, { error: 'Not linked.' }); return true; }
    try { await send(String(b.channel), lk.id, 'J.A.R.V.I.S. here. This channel works.', c); json(res, 200, { ok: true }); } catch (e) { json(res, 502, { error: e.message }); }
    return true;
  }
  return false;
}

/* ---------- outbound calls -------------------------------------------------- */
async function placeCall(to, taskId, uid) {
  const r = await post('https://api.twilio.com/2010-04-01/Accounts/' + env('TWILIO_ACCOUNT_SID') + '/Calls.json',
    { Authorization: 'Basic ' + Buffer.from(env('TWILIO_ACCOUNT_SID') + ':' + env('TWILIO_AUTH_TOKEN')).toString('base64') },
    { To: to, From: env('TWILIO_NUMBER'), Url: ORIGIN() + '/api/channels/twilio/voice?task=' + encodeURIComponent(taskId) }, true);
  if (r.status >= 300) throw new Error('twilio call ' + r.status);
  return r;
}

/* ---------- the call itself: ConversationRelay over our websocket --------- */
const calls = new Map();   /* socket → { uid, from, task, ctx, hist } */
function relayUpgrade(req, socket, head) {
  const ws = new MiniWS(socket, head);
  const st = { uid: '', from: '', task: '', hist: [], busy: false };
  calls.set(ws, st);
  ws.onmessage = async (txt) => {
    let m = {}; try { m = JSON.parse(txt); } catch (e) { return; }
    try {
      if (m.type === 'setup') {
        const cp = m.customParameters || {}; st.uid = String(cp.uid || ''); st.from = String(cp.from || ''); st.task = String(cp.task || '');
        if (!st.uid) { ws.send(JSON.stringify({ type: 'text', token: 'This number is not linked to a Flow.', last: true })); ws.send(JSON.stringify({ type: 'end' })); return; }
        st.ctx = await ctxFor(st.uid);
        return;
      }
      if (m.type === 'prompt' && m.voicePrompt && st.ctx) {
        if (st.busy) return; st.busy = true;
        let reply;
        const said = String(m.voicePrompt || '').trim();
        if (st.task && /^(yes|yeah|please|go ahead|read it|sure|ok|okay)\b/i.test(said)) {
          const t = (await team.tasks(st.ctx)).find((x) => x.id === st.task); st.task = '';
          reply = t ? (t.result || t.error || 'It is done.').slice(0, 2500) : 'I cannot find that piece of work any more.';
        } else {
          reply = await inbound('voice', st.from, said, {});
          if (/not linked to a Flow/.test(reply)) reply = await inbound('sms', st.from, said, {});
        }
        reply = String(reply).replace(/\/(yes|no|team|tasks|jarvis|answer)\b/g, (x) => '"' + x.slice(1) + '"').replace(/[\[\]*_#]/g, '');
        ws.send(JSON.stringify({ type: 'text', token: reply.slice(0, 3000), last: true }));
        st.busy = false;
        if (/\b(goodbye|that is all|that's all|bye for now)\b/i.test(said)) { setTimeout(() => { try { ws.send(JSON.stringify({ type: 'end' })); } catch (e) {} }, 500); }
      }
      if (m.type === 'interrupt') st.busy = false;
    } catch (e) { logLine('relay: ' + (e && e.message)); try { ws.send(JSON.stringify({ type: 'text', token: 'Something went wrong on my side.', last: true })); } catch (x) {} st.busy = false; }
  };
  ws.onclose = () => calls.delete(ws);
}
function upgrade(req, socket, head) {
  const url = String(req.url || '');
  if (url.indexOf('/api/channels/twilio/relay') !== 0) return false;
  if (!configured('voice')) { socket.destroy(); return true; }
  try { relayUpgrade(req, socket, head); } catch (e) { try { socket.destroy(); } catch (x) {} }
  return true;
}

/* A websocket server small enough to read: RFC 6455, text frames, masked
   client → unmasked server, ping/pong, close. */
class MiniWS {
  constructor(socket, head) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = []; this.open = true; this.onmessage = null; this.onclose = null;
    const key = socket._wsKey;
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);
    if (head && head.length) this.feed(head);
    socket.on('data', (d) => this.feed(d));
    socket.on('close', () => { this.open = false; if (this.onclose) this.onclose(); });
    socket.on('error', () => { this.open = false; });
  }
  feed(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (masked && this.buf.length < off + 4) return;
      const mask = masked ? this.buf.slice(off, off + 4) : null; if (masked) off += 4;
      if (this.buf.length < off + len) return;
      const payload = Buffer.from(this.buf.slice(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.slice(off + len);
      if (op === 8) { this.close(); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0 || op === 2) {
        this.frag.push(payload);
        if (fin) { const whole = Buffer.concat(this.frag).toString('utf8'); this.frag = []; if (this.onmessage) { try { this.onmessage(whole); } catch (e) {} } }
      }
    }
  }
  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length; let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e) {}
  }
  send(text) { this.frame(1, Buffer.from(String(text), 'utf8')); }
  close() { if (!this.open) return; this.frame(8, Buffer.alloc(0)); this.open = false; try { this.socket.end(); } catch (e) {} if (this.onclose) this.onclose(); }
}

/* ---------- start ----------------------------------------------------------- */
function start(deps) {
  D = { raw: deps.raw, users: deps.users, nsPrefix: deps.nsPrefix, usersKey: deps.usersKey, log: deps.log };
  if (team && team.start && deps.wireTeam !== false) { /* the team runner's results come here */ }
  if (groups) groups.init({ rawGet, rawSet, ctxFor, whose, send, logLine, configured, env, takeCode, team });
  /* Telegram: tell it where to deliver, with a secret only we know. */
  if (configured('telegram') && !FAKE) {
    post('https://api.telegram.org/bot' + env('TELEGRAM_BOT_TOKEN') + '/setWebhook', {}, { url: ORIGIN() + '/api/channels/telegram', secret_token: telegramSecret(), allowed_updates: ['message', 'edited_message'] })
      .then((r) => { logLine('telegram webhook ' + (r.body && r.body.ok ? 'set' : 'NOT set: ' + str(r.body && r.body.description, 120))); if (groups) groups.noteWebhook(r.body && r.body.ok, r.body && r.body.description).catch(() => {}); })
      .catch((e) => { logLine('telegram webhook failed: ' + e.message); if (groups) groups.noteWebhook(false, e.message).catch(() => {}); });
    if (groups) groups.learnBot().catch(() => {});
  }
  /* What was in flight when the process stopped: unanswered messages are
     replayed, undelivered replies resent — and resent every minute after. */
  if (groups && !FAKE) {
    setTimeout(() => { groups.replayInbox((ch, u) => telegramUpdate(u)).catch(() => {}); groups.retryOutbox().catch(() => {}); }, 3000);
    const t = setInterval(() => { groups.retryOutbox().catch(() => {}); }, 60 * 1000); if (t.unref) t.unref();
  }
  /* Discord: the one slash command. */
  if (configured('discord') && !FAKE) {
    (async () => {
      try {
        const r = await fetch('https://discord.com/api/v10/applications/' + env('DISCORD_APP_ID') + '/commands', { method: 'PUT', headers: { Authorization: 'Bot ' + env('DISCORD_BOT_TOKEN'), 'content-type': 'application/json' }, body: JSON.stringify([{ name: 'jarvis', description: 'Talk to J.A.R.V.I.S. and the team', options: [{ type: 3, name: 'text', description: 'What to say', required: true }] }]) });
        logLine('discord command ' + (r.ok ? 'registered' : 'NOT registered: ' + r.status));
      } catch (e) { logLine('discord command failed: ' + e.message); }
    })();
  }
}

function wsKeyFromReq(req) { return String(req.headers['sec-websocket-key'] || ''); }
module.exports = {
  statusList, linkedCount,
  start, handle, handleUser, notify, send, inbound,
  upgrade: (req, socket, head) => { socket._wsKey = wsKeyFromReq(req); return upgrade(req, socket, head); },
  configured, CHANNELS, ORDER,
  groups, speech, sendVoice, mailNew, converse,
  _internals: { telegramSecret, slackOk, whatsappOk, discordOk, twilioOk, chunks, MiniWS, sent, newCode, takeCode, whose, inbound, xml, telegramUpdate, groupMessage }
};
