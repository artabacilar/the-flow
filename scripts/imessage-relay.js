#!/usr/bin/env node
/* The iMessage relay — runs on a Mac that stays on.
 *
 * Apple has no API for iMessage, so this is the honest way to text
 * J.A.R.V.I.S. from an iPhone: a Mac signed into Messages with an Apple ID
 * of his own watches its own Messages database for texts that arrive, posts
 * them to The Flow, and sends the replies back with AppleScript. Nothing
 * here reads anybody else's messages: only the chats of the Apple ID this
 * Mac is signed into, and only texts that arrive after it starts.
 *
 * Setting it up (once, on that Mac)
 * ---------------------------------
 *   1. Sign into Messages with the Apple ID you want J.A.R.V.I.S. to have.
 *   2. System Settings → Privacy & Security → Full Disk Access → add
 *      Terminal (the relay reads ~/Library/Messages/chat.db).
 *   3. The first run asks to let Terminal control Messages — allow it.
 *   4. In Render, add IMESSAGE_RELAY_SECRET (any long random string).
 *   5. Run it, with the same secret, and leave it running:
 *        FLOW_URL=https://theflow.today IMESSAGE_RELAY_SECRET=… node scripts/imessage-relay.js
 *      (launchd or `caffeinate -i node scripts/imessage-relay.js` keeps it alive.)
 *   6. From your iPhone, iMessage that Apple ID your six-digit link code
 *      (command centre → Channels → iMessage → Link).
 *
 * It needs only what macOS ships: node, sqlite3 and osascript. */
'use strict';
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const FLOW = (process.env.FLOW_URL || 'https://theflow.today').replace(/\/+$/, '');
const SECRET = String(process.env.IMESSAGE_RELAY_SECRET || '').trim();
const DB = process.env.CHAT_DB || path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const EVERY = Math.max(2000, parseInt(process.env.RELAY_EVERY_MS || '3000', 10) || 3000);
if (!SECRET) { console.error('Set IMESSAGE_RELAY_SECRET (the same value as in Render).'); process.exit(1); }

/* Messages stores dates as nanoseconds since 2001-01-01 on recent macOS. */
const APPLE_EPOCH = 978307200;
let since = Math.floor(Date.now() / 1000) - APPLE_EPOCH;   /* only what arrives from now on */
const seen = new Set();

function query(sql) {
  const out = execFileSync('sqlite3', ['-json', '-readonly', DB, sql], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  try { return JSON.parse(out || '[]'); } catch (e) { return []; }
}
function newMessages() {
  const rows = query(
    'SELECT m.ROWID AS id, m.text, h.id AS handle, (m.date/1000000000) AS at ' +
    'FROM message m JOIN handle h ON h.ROWID = m.handle_id ' +
    'WHERE m.is_from_me = 0 AND m.text IS NOT NULL AND m.text != \'\' AND (m.date/1000000000) > ' + since + ' ' +
    'ORDER BY m.date ASC LIMIT 20');
  return rows.filter((r) => r && r.id && !seen.has(r.id));
}
function sendIMessage(to, text) {
  const script = 'on run argv\n  tell application "Messages"\n    set targetService to 1st account whose service type = iMessage\n    set targetBuddy to participant (item 1 of argv) of targetService\n    send (item 2 of argv) to targetBuddy\n  end tell\nend run';
  execFileSync('osascript', ['-e', script, to, text], { encoding: 'utf8' });
}
async function postIn(from, text) {
  const r = await fetch(FLOW + '/api/channels/imessage/in', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-secret': SECRET }, body: JSON.stringify({ from, text }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('server ' + r.status));
  return j.reply;
}
async function drainOut() {
  const r = await fetch(FLOW + '/api/channels/imessage/out', { headers: { 'x-relay-secret': SECRET } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('server ' + r.status));
  for (const m of (j.messages || [])) { try { sendIMessage(m.to, m.text); log('→ ' + m.to + ': ' + String(m.text).slice(0, 60)); } catch (e) { log('could not send to ' + m.to + ': ' + e.message); } }
}
const log = (m) => console.log(new Date().toISOString().slice(11, 19) + ' ' + m);

async function tick() {
  try {
    for (const m of newMessages()) {
      seen.add(m.id); if (m.at > since) since = Math.floor(m.at);
      log('← ' + m.handle + ': ' + String(m.text).slice(0, 60));
      try { await postIn(m.handle, m.text); } catch (e) { log('server: ' + e.message); }
    }
    await drainOut();
  } catch (e) { log('tick: ' + e.message); }
}
log('relay up — ' + FLOW + ' — watching ' + DB);
tick(); setInterval(tick, EVERY);
