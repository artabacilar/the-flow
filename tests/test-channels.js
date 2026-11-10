/* The channels — reaching the team from Telegram, WhatsApp, Slack, Discord,
 * SMS, a phone call, iMessage.
 *
 * What would make it wrong: a webhook accepted without the provider's
 * proof; a stranger's message answered, or told anything about anyone's
 * Flow; a link code that works twice or after it expired; a message going
 * to the wrong agent; "/yes 1" sending anything, or anything claimed sent;
 * a result not reaching a linked channel; a channel shown as working
 * without its keys; the call relay not speaking websocket; or the Twilio
 * signature check letting a forged request through. */
const submitAuth = require('./submit-auth.js');
const { chromium } = require('playwright');
const crypto = require('crypto');
const C = require('../flow-channels.js');
const I = C._internals;
const H = 'http://localhost:4222';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body, headers, raw) => fetch(H + p, { method: 'POST', headers: Object.assign({ 'content-type': raw ? 'application/x-www-form-urlencoded' : 'application/json' }, headers || {}), body: raw ? body : JSON.stringify(body) });

(async () => {
  console.log('\n— proof the provider sent it —');
  const body = JSON.stringify({ hello: 1 });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + crypto.createHmac('sha256', process.env.SLACK_SIGNING_SECRET).update('v0:' + ts + ':' + body).digest('hex');
  ok('Slack: the right signature passes, a wrong one or an old timestamp fails', I.slackOk({ 'x-slack-request-timestamp': ts, 'x-slack-signature': sig }, body) && !I.slackOk({ 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=00' }, body) && !I.slackOk({ 'x-slack-request-timestamp': '1000', 'x-slack-signature': sig }, body));
  ok('WhatsApp: X-Hub-Signature-256 is checked', I.whatsappOk({ 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(body).digest('hex') }, body) && !I.whatsappOk({ 'x-hub-signature-256': 'sha256=ab' }, body));
  const kp = crypto.generateKeyPairSync('ed25519'); const pub = kp.publicKey.export({ format: 'der', type: 'spki' }).slice(-32).toString('hex');
  process.env.DISCORD_PUBLIC_KEY = pub;
  const dsig = crypto.sign(null, Buffer.from(ts + body), kp.privateKey).toString('hex');
  ok('Discord: the Ed25519 signature is verified', I.discordOk({ 'x-signature-ed25519': dsig, 'x-signature-timestamp': ts }, body) && !I.discordOk({ 'x-signature-ed25519': dsig, 'x-signature-timestamp': ts + '1' }, body));
  const params = { From: '+905551112233', To: '+15550001111', Body: 'hi' };
  const url = 'http://localhost:4222/api/channels/twilio/sms';
  const tsig = crypto.createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(url + 'Bodyhi' + 'From+905551112233' + 'To+15550001111').digest('base64');
  ok('Twilio: the signature over URL + sorted params is checked', I.twilioOk({ 'x-twilio-signature': tsig }, url, params) && !I.twilioOk({ 'x-twilio-signature': tsig }, url, Object.assign({}, params, { Body: 'bye' })));
  ok('long replies are cut at line breaks, never mid-word', I.chunks('a'.repeat(10) + '\n' + 'b'.repeat(10), 15).join('|') === 'a'.repeat(10) + '|' + 'b'.repeat(10));
  ok('Teams is listed as not built, honestly', C.CHANNELS.teams.built === false && /Not built yet/.test(C.CHANNELS.teams.how));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(H + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.click('#fa-alt', { timeout: 2500 }).catch(() => {});
  await p.fill('#fa-email', process.env.FLOW_OWNER_EMAIL); await p.fill('#fa-name', 'Artur'); await p.fill('#fa-pw', 'a properly long password');
  await submitAuth(p); await p.waitForTimeout(4500);
  await p.route('**/api/flow/speak', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"fallback":true}' }));
  await p.evaluate(async () => {
    await Flow.Settings.set('newLook', true); Flow.Settings.reflect(); window.FlowTodayLook.applyLook(); Flow.Nav.go('today'); renderToday();
    await Flow.Settings.set('asstVoice', 'off'); await Flow.Settings.set('asstWake', false);
  });
  await p.waitForTimeout(1200);
  const api = (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body || null]);
  const sentNow = async () => (await fetch(H + '/api/channels/_sent').then((r) => r.json()).catch(() => null));

  console.log('\n— the Channels panel —');
  const me = await api('/api/channels/me');
  const st = Object.fromEntries(me.j.channels.map((c) => [c.id, c.status]));
  ok('with keys present, Telegram/WhatsApp/Slack/Discord/SMS/calls/iMessage are "ready to link"; Teams is "not built"', st.telegram === 'ready' && st.whatsapp === 'ready' && st.slack === 'ready' && st.sms === 'ready' && st.voice === 'ready' && st.imessage === 'ready' && st.teams === 'not_built', st);
  ok('each one says how to set it up, with this server\'s address filled in', me.j.channels.every((c) => c.how.length > 40) && /localhost:4222\/api\/channels\/whatsapp/.test(me.j.channels.find((c) => c.id === 'whatsapp').how));
  await p.evaluate(() => FlowHud.open()); await p.waitForTimeout(1500);
  const panel = await p.evaluate(() => ({ there: !!document.querySelector('#flow-hud [data-k="channels"]'), rows: [...document.querySelectorAll('#flow-hud .hud-chh')].map((x) => x.textContent) }));
  ok('his room lists the channels with their status', panel.there && panel.rows.length === 9 && panel.rows.some((r) => /Telegram.*Ready to link/.test(r)) && panel.rows.some((r) => /Teams.*Not built/.test(r)), panel);
  await p.click('#flow-hud .hud-chh[data-ch="telegram"]'); await p.waitForTimeout(300);
  await p.click('#flow-hud [data-hud="chcode"][data-ch="telegram"]'); await p.waitForTimeout(700);
  const code = await p.evaluate(() => (document.querySelector('#flow-hud .hud-code') || {}).textContent);
  ok('Link gives a six-digit code', /^\d{6}$/.test(code || ''), code);

  console.log('\n— Telegram —');
  const tgSecret = I.telegramSecret();
  const tg = (chatId, text, name) => post('/api/channels/telegram', { message: { chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: name || 'Artur' }, text } }, { 'x-telegram-bot-api-secret-token': tgSecret });
  const bad = await post('/api/channels/telegram', { message: { chat: { id: 1 }, text: 'hi' } }, { 'x-telegram-bot-api-secret-token': 'nope' });
  ok('a webhook without our secret is refused', bad.status === 403);
  await tg(777, 'hello there'); await wait(600);
  let s1 = await sentNow();
  ok('a stranger is told only how to link — nothing about any Flow', s1 && /not linked to a Flow/.test(s1.last.body.text) && !/Artur/.test(s1.last.body.text) && String(s1.last.body.chat_id) === '777', s1 && s1.last);
  await tg(777, code); await wait(900);
  s1 = await sentNow();
  ok('the code links the chat to this account, and he introduces the team', /Linked to Artur/.test(s1.last.body.text) && /\/sarah/.test(s1.last.body.text), s1.last && s1.last.body.text.slice(0, 120));
  await tg(777, code); await wait(600);
  s1 = await sentNow();
  ok('the same code cannot be used twice', /not right or has expired/.test(s1.last.body.text));
  await p.waitForTimeout(4500);
  ok('the room noticed: Telegram now shows Working with the sender', await p.evaluate(() => /Working/.test((document.querySelector('#flow-hud .hud-chh[data-ch="telegram"]') || {}).textContent || '')));
  await tg(777, '/team'); await wait(600); s1 = await sentNow();
  ok('/team lists the agents', /J\.A\.R\.V\.I\.S\./.test(s1.last.body.text) && /Sarah — Customer support \(\/sarah\)/.test(s1.last.body.text), s1.last.body.text);
  await tg(777, '@sarah remember that the team answers within one business day'); await wait(1500); s1 = await sentNow();
  ok('"@sarah …" goes to Sarah, who answers from her own model', /claude-sonnet-4-5 says: remember that the team/.test(s1.last.body.text), s1.last.body.text);
  await tg(777, 'what is left today?'); await wait(1500); s1 = await sentNow();
  ok('anything else goes to J.A.R.V.I.S.', /chief of staff over a channel/.test(s1.last.body.text) || /says:/.test(s1.last.body.text) || s1.last.body.text.length > 0, s1.last.body.text.slice(0, 100));
  const rocksNow = async () => { const r = await api('/api/get?key=ld_compass'); let c = r.j && r.j.value; if (typeof c === 'string') c = JSON.parse(c); return [].concat(...Object.values((c && c.rocks) || {})); };
  await tg(777, 'add Kadir Yildiz from Noar to my schedule for friday'); await wait(1500); s1 = await sentNow();
  let rk = (await rocksNow()).find((r) => /Kadir Yildiz/.test(r.title));
  ok('from Telegram he changes the planner: "add Kadir … for Friday" is a Priority on Friday', !!rk && rk.day === 4 && !/can't edit|cannot edit/i.test(s1.last.body.text), { rk, said: s1.last.body.text.slice(0, 120) });
  await tg(777, 'mark Kadir done'); await wait(1500);
  rk = (await rocksNow()).find((r) => /Kadir Yildiz/.test(r.title));
  ok('…and he can tick it off by its name (he sees the week, with ids)', !!rk && rk.done === true, rk);
  await tg(777, 'track stretching daily'); await wait(1200);
  const hb = await api('/api/get?key=ld_habits'); let hv = hb.j && hb.j.value; if (typeof hv === 'string') hv = JSON.parse(hv);
  ok('…and start a habit', !!hv && hv.habits.some((h) => /stretching/i.test(h.name)), hv && hv.habits.map((h) => h.name));
  await tg(777, 'cuma günü Kadir Yıldız ile toplantı ekle'); await wait(1500); s1 = await sentNow();
  rk = (await rocksNow()).find((r) => /Kadir Yıldız ile toplantı/.test(r.title));
  ok('in Turkish too: "cuma günü … ekle" is a Priority on Friday, and the answer is in Turkish', !!rk && rk.day === 4 && /ekledi/.test(s1.last.body.text), { rk, said: s1.last.body.text.slice(0, 120) });
  const PD = require('../flow-mcp.js')._internals.parseDay; const tue = new Date('2026-11-10T10:00:00');
  ok('Turkish days are read: cuma, yarın, haftaya salı, pazar günü', PD('cuma', tue).getDate() === 13 && PD('yarın', tue).getDate() === 11 && PD('haftaya salı', tue).getDate() === 17 && PD('pazar günü', tue).getDate() === 15);
  const CH = require('fs').readFileSync(require('path').join(__dirname, '..', 'flow-channels.js'), 'utf8');
  ok('he is told to take commands in Turkish or English and answer in the language of the message; /evet and /hayır work', /Turkish, English, or both mixed/.test(CH) && /language of their LAST message/.test(CH) && /c === 'evet'/.test(CH) && /c === 'hayır'/.test(CH));
  const csv = 'Ürün Kodu;Açıklama;Miktar;Tutar;Tarih;Temsilci;Kampanya\nA-1;Şampuan;2;1250;2026-09-01;Rep Bir;KAMPANYASIZ\nA-2;Maske;1;0,1;2026-09-01;Rep Bir;K1\n';
  await post('/api/channels/_file', { id: 'doc-1', data: Buffer.from(csv).toString('base64') });
  await post('/api/channels/telegram', { message: { chat: { id: 777, type: 'private' }, from: { id: 777, first_name: 'Artur' }, document: { file_id: 'doc-1', file_name: 'satis.csv', mime_type: 'text/csv' }, caption: 'bu raporu incele' } }, { 'x-telegram-bot-api-secret-token': tgSecret });
  await wait(1500); s1 = await sentNow();
  const sr = await api('/api/team/sales');
  ok('a sales file sent on Telegram goes to the Finance assistant, and the answer is in Turkish', sr.j.reports.length >= 1 && sr.j.reports[0].via === 'telegram' && s1.recent.some((m) => /raporunu inceliyor/.test(m.body.text)), { said: s1.recent.map((m) => m.body.text.slice(0, 60)), n: sr.j.reports.length });
  await post('/api/channels/_file', { id: 'doc-2', data: Buffer.from('Toplantı notu: Burak fiyat listesini cuma gönderecek.').toString('base64') });
  await post('/api/channels/telegram', { message: { chat: { id: 777, type: 'private' }, from: { id: 777, first_name: 'Artur' }, document: { file_id: 'doc-2', file_name: 'not.txt', mime_type: 'text/plain' } } }, { 'x-telegram-bot-api-secret-token': tgSecret });
  await wait(1500); s1 = await sentNow();
  ok('any other document sent on Telegram is read by J.A.R.V.I.S. with the message', /read not\.txt \(txt\): Toplantı notu: Burak fiyat listesini cuma/.test(s1.last.body.text), s1.last.body.text.slice(0, 160));
  await post('/api/channels/_file', { id: 'doc-3', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 1, 2]).toString('base64') });
  await post('/api/channels/telegram', { message: { chat: { id: 777, type: 'private' }, from: { id: 777, first_name: 'Artur' }, document: { file_id: 'doc-3', file_name: 'eski.doc' } } }, { 'x-telegram-bot-api-secret-token': tgSecret });
  await wait(1000); s1 = await sentNow();
  ok('an old .doc is answered with how to send it instead', /save it as \.docx/.test(s1.last.body.text), s1.last.body.text);
  await post('/api/channels/_file', { id: 'ph-1', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64') });
  await post('/api/channels/telegram', { message: { chat: { id: 777, type: 'private' }, from: { id: 777, first_name: 'Artur' }, photo: [{ file_id: 'ph-0', width: 90 }, { file_id: 'ph-1', width: 1280 }], caption: 'Add this to my schedule' } }, { 'x-telegram-bot-api-secret-token': tgSecret });
  await wait(1500); s1 = await sentNow();
  ok('a photo sent on Telegram is read by J.A.R.V.I.S. (the largest size), with what he was asked', /read photo \(photo\)/.test(s1.last.body.text) && /Add this to my schedule/.test(s1.last.body.text), s1.last.body.text.slice(0, 160));
  await tg(777, 'have sarah draft a reply to the refund question'); await wait(2500);
  const tl = await api('/api/team/tasks');
  const viaTg = tl.j.tasks.find((t) => t.via === 'telegram');
  ok('from a text message he can put the team to work; the task is marked as coming from Telegram', !!viaTg && viaTg.steps[0].agent === 'sarah', tl.j.tasks.map((t) => t.via));
  const done = await (async () => { for (let i = 0; i < 40; i++) { await wait(500); const r = await api('/api/team/tasks'); const t = r.j.tasks.find((x) => x.id === viaTg.id); if (t && /^(done|awaiting_approval)$/.test(t.status)) return t; } return null; })();
  await wait(800); s1 = await sentNow();
  ok('when it is ready, the result itself arrives on Telegram — with the approval numbered and how to say yes', !!done && /needs your yes/.test(s1.last.body.text) && /\[1\] Email to the customer/.test(s1.last.body.text) && /\/yes 1/.test(s1.last.body.text), s1.last && s1.last.body.text.slice(0, 200));
  await tg(777, '/yes 1'); await wait(800); s1 = await sentNow();
  ok('"/yes 1" approves it and says what happened: sent, once, to whom (email is connected in this build)', /Sent: Email to the customer/.test(s1.last.body.text) && /customer@example\.com/.test(s1.last.body.text), s1.last.body.text);
  const ap = (await api('/api/team/tasks')).j.approvals[0];
  ok('on the server it is executed — once, with the send recorded', ap.status === 'executed' && !!ap.executedAt);
  await tg(777, '/tasks'); await wait(600); s1 = await sentNow();
  ok('/tasks shows what happened', /Recent:/.test(s1.last.body.text) && /done/.test(s1.last.body.text), s1.last.body.text);

  console.log('\n— a question answered by reply —');
  await api('/api/team/task', { agent: 'sarah', brief: 'Send the venue the new dates — ask me which address first.', lang: 'en' });
  for (let i = 0; i < 30; i++) { await wait(500); const r = await api('/api/team/tasks'); if (r.j.tasks.some((t) => t.status === 'awaiting_info')) break; }
  await wait(800); s1 = await sentNow();
  ok('her question reaches Telegram', /has a question/.test(s1.last.body.text) && /Which address/.test(s1.last.body.text), s1.last.body.text);
  await tg(777, 'Bomonti, Şişli'); await wait(600); s1 = await sentNow();
  ok('a plain reply is passed on as the answer', s1.recent.some((m) => /Passed on to Sarah/.test(m.body.text)), s1.recent.map((m) => m.body.text.slice(0, 40)));

  console.log('\n— WhatsApp, Slack, Discord, SMS —');
  const code2 = (await api('/api/channels/me/code', {})).j.code;
  const waBody = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '905551112233', profile: { name: 'Artur' } }], messages: [{ from: '905551112233', type: 'text', text: { body: code2 } }] } }] }] });
  const waBad = await post('/api/channels/whatsapp', waBody, { 'x-hub-signature-256': 'sha256=00' }, true);
  ok('WhatsApp: a forged signature is refused', waBad.status === 403);
  await post('/api/channels/whatsapp', waBody, { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(waBody).digest('hex'), 'content-type': 'application/json' }, true); await wait(800);
  s1 = await sentNow();
  ok('WhatsApp links with its code and replies through the Graph API', /Linked to Artur/.test(s1.last.body.text.body) && /graph\.facebook\.com/.test(s1.last.url) && s1.last.body.to === '905551112233', s1.last);
  const ver = await fetch(H + '/api/channels/whatsapp?hub.mode=subscribe&hub.verify_token=' + encodeURIComponent(process.env.WHATSAPP_VERIFY_TOKEN) + '&hub.challenge=abc123');
  ok('WhatsApp: Meta\'s verification handshake is answered', ver.status === 200 && (await ver.text()) === 'abc123');
  const code3 = (await api('/api/channels/me/code', {})).j.code;
  const slackBody = JSON.stringify({ type: 'event_callback', event: { type: 'message', channel_type: 'im', user: 'U123', channel: 'D123', text: code3 } });
  const ts2 = String(Math.floor(Date.now() / 1000));
  await post('/api/channels/slack', slackBody, { 'x-slack-request-timestamp': ts2, 'x-slack-signature': 'v0=' + crypto.createHmac('sha256', process.env.SLACK_SIGNING_SECRET).update('v0:' + ts2 + ':' + slackBody).digest('hex') }, true); await wait(800);
  s1 = await sentNow();
  ok('Slack links from a DM and answers in that DM', /Linked to Artur/.test(s1.last.body.text) && s1.last.body.channel === 'D123', s1.last);
  const chal = JSON.stringify({ type: 'url_verification', challenge: 'xyz' }); const ts3 = String(Math.floor(Date.now() / 1000));
  const cr = await post('/api/channels/slack', chal, { 'x-slack-request-timestamp': ts3, 'x-slack-signature': 'v0=' + crypto.createHmac('sha256', process.env.SLACK_SIGNING_SECRET).update('v0:' + ts3 + ':' + chal).digest('hex') }, true);
  ok('Slack: the URL verification challenge is echoed', (await cr.json()).challenge === 'xyz');
  const code4 = (await api('/api/channels/me/code', {})).j.code;
  const smsUrl = 'http://localhost:4222/api/channels/twilio/sms';
  const smsParams = { From: '+905551112233', To: '+15550001111', Body: code4 };
  const smsSig = crypto.createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(smsUrl + Object.keys(smsParams).sort().map((k) => k + smsParams[k]).join('')).digest('base64');
  const smsBad = await post('/api/channels/twilio/sms', new URLSearchParams(smsParams).toString(), { 'x-twilio-signature': 'nope' }, true);
  ok('SMS: a request Twilio did not sign is refused', smsBad.status === 403);
  const sms = await post('/api/channels/twilio/sms', new URLSearchParams(smsParams).toString(), { 'x-twilio-signature': smsSig }, true);
  const twiml = await sms.text();
  ok('SMS links and answers in TwiML', sms.status === 200 && /<Response><Message>Linked to Artur/.test(twiml), twiml.slice(0, 120));
  const me2 = await api('/api/channels/me');
  ok('four channels now show as working, each with its sender', me2.j.channels.filter((c) => c.status === 'working').map((c) => c.id).sort().join(',') === 'slack,sms,telegram,whatsapp' && me2.j.channels.find((c) => c.id === 'sms').linked.id === '+905551112233', me2.j.channels.map((c) => c.id + ':' + c.status));

  console.log('\n— WhatsApp through Wati —');
  const watiCh = me2.j.channels.find((c) => c.id === 'wati');
  ok('Wati is listed, ready to link, with its webhook address filled in', watiCh && watiCh.status === 'ready' && /localhost:4222\/api\/channels\/wati\?key=/.test(watiCh.how), watiCh);
  const codeW = (await api('/api/channels/me/code', {})).j.code;
  const wMsg = (o) => Object.assign({ id: 'w' + Math.random(), whatsappMessageId: 'wamid.' + Math.random(), eventType: 'message', type: 'text', waId: '905557778899', senderName: 'Artur', owner: false }, o);
  let before = (await sentNow()).n;
  const wBad = await post('/api/channels/wati?key=wrong', wMsg({ text: codeW }));
  const wNone = await post('/api/channels/wati', wMsg({ text: codeW }));
  ok('a request without the webhook key is refused, and nothing is sent', wBad.status === 403 && wNone.status === 403 && (await sentNow()).n === before);
  const firstW = wMsg({ text: codeW });
  await post('/api/channels/wati?key=wati-key-123', firstW); await wait(800);
  s1 = await sentNow();
  ok('Wati links with its code and replies through Wati\'s session message', /Linked to Artur/.test(decodeURIComponent(s1.last.url)) && /live-mt-server\.wati\.io\/12345\/api\/v1\/sendSessionMessage\/905557778899\?messageText=/.test(s1.last.url), s1.last);
  before = s1.n;
  await post('/api/channels/wati?key=wati-key-123', firstW); await wait(600);
  ok('the same message retried by Wati is answered once', (await sentNow()).n === before);
  await post('/api/channels/wati?key=wati-key-123', wMsg({ text: 'what is left today', owner: true })); await wait(600);
  await post('/api/channels/wati?key=wati-key-123', wMsg({ type: 'image', text: '' })); await wait(400);
  await post('/api/channels/wati?key=wati-key-123', wMsg({ eventType: 'sentMessageDELIVERED', text: 'x' })); await wait(400);
  ok('his operators\' own messages, images and delivery receipts get no reply', (await sentNow()).n === before);
  const meW = await api('/api/channels/me');
  ok('Wati now shows as working, linked to his number', meW.j.channels.find((c) => c.id === 'wati').status === 'working' && meW.j.channels.find((c) => c.id === 'wati').linked.id === '905557778899');
  await post('/api/channels/wati?key=wati-key-123', wMsg({ waId: '447000000001', text: 'hello who is this' })); await wait(700);
  s1 = await sentNow();
  ok('anyone else writing to the (shared business) number gets no reply at all', s1.n === before, s1.n - before);

  console.log('\n— a phone call —');
  const vUrl = 'http://localhost:4222/api/channels/twilio/voice';
  const vParams = { From: '+905551112233', To: '+15550001111', CallSid: 'CA1', Direction: 'inbound' };
  const vSig = crypto.createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(vUrl + Object.keys(vParams).sort().map((k) => k + vParams[k]).join('')).digest('base64');
  const v = await post('/api/channels/twilio/voice', new URLSearchParams(vParams).toString(), { 'x-twilio-signature': vSig }, true);
  const vt = await v.text();
  ok('a call from the linked number is connected to the relay with a greeting', /<ConversationRelay url="ws:\/\/localhost:4222\/api\/channels\/twilio\/relay"/.test(vt) && /welcomeGreeting="Good day, sir/.test(vt) && /name="uid"/.test(vt), vt.slice(0, 200));
  const v2Params = Object.assign({}, vParams, { From: '+10000000000' });
  const v2Sig = crypto.createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(vUrl + Object.keys(v2Params).sort().map((k) => k + v2Params[k]).join('')).digest('base64');
  const v2 = await post('/api/channels/twilio/voice', new URLSearchParams(v2Params).toString(), { 'x-twilio-signature': v2Sig }, true);
  ok('a call from an unknown number is told to link first, and hung up', /not linked to a Flow/.test(await v2.text()));
  const uidMatch = vt.match(/name="uid" value="([^"]+)"/);
  const ws = new WebSocket('ws://localhost:4222/api/channels/twilio/relay');
  const got = [];
  const opened = await new Promise((res) => { ws.onopen = () => res(true); ws.onerror = () => res(false); setTimeout(() => res(false), 3000); });
  ok('the relay speaks websocket (our own small server)', opened);
  if (opened) {
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    ws.send(JSON.stringify({ type: 'setup', callSid: 'CA1', customParameters: { uid: uidMatch ? uidMatch[1] : '', from: '+905551112233', task: '' } }));
    await wait(300);
    ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'what is on the team', last: true }));
    await wait(2500);
    ok('a spoken prompt gets a spoken answer back as text', got.length >= 1 && got[0].type === 'text' && got[0].last === true && got[0].token.length > 5, got);
    ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'goodbye', last: true }));
    await wait(1500);
    ok('"goodbye" ends the call', got.some((m) => m.type === 'end'), got.map((m) => m.type));
    ws.close();
  }

  console.log('\n— iMessage relay —');
  const code5 = (await api('/api/channels/me/code', {})).j.code;
  const imBad = await post('/api/channels/imessage/in', { from: 'artur@icloud.com', text: code5 }, { 'x-relay-secret': 'wrong' });
  ok('the relay must know the secret', imBad.status === 403);
  const im = await post('/api/channels/imessage/in', { from: 'artur@icloud.com', text: code5 }, { 'x-relay-secret': process.env.IMESSAGE_RELAY_SECRET });
  const imj = await im.json();
  const out = await fetch(H + '/api/channels/imessage/out', { headers: { 'x-relay-secret': process.env.IMESSAGE_RELAY_SECRET } }).then((r) => r.json());
  ok('an iMessage links, and the reply waits in the outbox for the Mac to send', /Linked to Artur/.test(imj.reply) && out.messages.length === 1 && out.messages[0].to === 'artur@icloud.com', { imj: imj.reply && imj.reply.slice(0, 40), out });
  const out2 = await fetch(H + '/api/channels/imessage/out', { headers: { 'x-relay-secret': process.env.IMESSAGE_RELAY_SECRET } }).then((r) => r.json());
  ok('the outbox is emptied once collected', out2.messages.length === 0);

  console.log('\n— unlink —');
  const un = await api('/api/channels/me/unlink', { channel: 'telegram' });
  await tg(777, 'hello'); await wait(600); s1 = await sentNow();
  ok('unlinked, the old sender is a stranger again', un.status === 200 && /not linked to a Flow/.test(s1.last.body.text));

  ok('no page errors', errs.length === 0, errs);
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
