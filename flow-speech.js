/* ======================================================================
 * The Flow — voice notes in and out, for the chat channels
 * ======================================================================
 * A voice note arriving on Telegram is transcribed (ElevenLabs Scribe or
 * OpenAI Whisper — whichever has a key; `FLOW_STT` picks when both do) and
 * then handled exactly like the same words typed. The reply can go back as
 * a voice note: a preset voice (British male by default — ElevenLabs
 * "Daniel"), or any ElevenLabs voice id the owner pastes, per channel or
 * per group/topic; spoken replies are kept to about 30 or 60 seconds by
 * telling the model the limit and trimming at a sentence if it overruns.
 *
 * Credentials live only in the environment (ELEVENLABS_API_KEY,
 * OPENAI_API_KEY); nothing here stores, logs or shows a key. Voice ids are
 * not secrets and live with the account's settings (`team:voice`).
 * ====================================================================== */
'use strict';

const FAKE = process.env.FLOW_TEAM_FAKE === '1';
const env = (k) => String(process.env[k] || '').trim();
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- presets ------------------------------------------------------ */
/* ElevenLabs premade voices. The ids are public (they are the library's). */
const PRESETS = {
  'british-male': { label: 'British male (Daniel)', provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } },
  'british-female': { label: 'British female (Lily)', provider: 'elevenlabs', voiceId: 'pFZP5JQG7iQjIQuC4Bku', settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } },
  'american-male': { label: 'American male (Brian)', provider: 'elevenlabs', voiceId: 'nPczCjzI2devNBz1zQrb', settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } },
  'american-female': { label: 'American female (Sarah)', provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL', settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } },
  'openai-male': { label: 'OpenAI male (Onyx)', provider: 'openai', voiceId: 'onyx' },
  'openai-female': { label: 'OpenAI female (Nova)', provider: 'openai', voiceId: 'nova' }
};
/* How long a spoken reply may run. ~2.5 words a second at a measured pace. */
const LENGTHS = { short: { seconds: 30, words: 75 }, medium: { seconds: 60, words: 150 }, long: { seconds: 120, words: 300 } };
const DEFAULT = { preset: 'british-male', voiceId: '', provider: '', replies: 'text', length: 'short' };

/* ---------- what is configured --------------------------------------------- */
function providers() {
  return {
    stt: { elevenlabs: !!env('ELEVENLABS_API_KEY'), openai: !!env('OPENAI_API_KEY') },
    tts: { elevenlabs: !!env('ELEVENLABS_API_KEY'), openai: !!env('OPENAI_API_KEY') }
  };
}
function sttProvider() {
  if (FAKE) return 'fake';
  const want = env('FLOW_STT').toLowerCase(); const p = providers().stt;
  if (want && p[want]) return want;
  return p.elevenlabs ? 'elevenlabs' : p.openai ? 'openai' : '';
}
function ttsProvider(pref) {
  if (FAKE) return 'fake';
  const p = providers().tts;
  if (pref && p[pref]) return pref;
  return p.elevenlabs ? 'elevenlabs' : p.openai ? 'openai' : '';
}
/* What to tell the owner is missing, without ever showing a key. */
function status() {
  const p = providers();
  return {
    in: FAKE ? 'working' : (p.stt.elevenlabs || p.stt.openai) ? 'working' : 'awaiting',
    out: FAKE ? 'working' : (p.tts.elevenlabs || p.tts.openai) ? 'working' : 'awaiting',
    stt: sttProvider() || null, tts: ttsProvider() || null,
    missing: (p.stt.elevenlabs || p.stt.openai || FAKE) ? [] : ['ELEVENLABS_API_KEY (or OPENAI_API_KEY)'],
    presets: Object.keys(PRESETS).map((id) => ({ id, label: PRESETS[id].label, provider: PRESETS[id].provider, available: FAKE || !!p.tts[PRESETS[id].provider] })),
    lengths: LENGTHS
  };
}

/* ---------- settings: per account, per channel, per workspace ------------- */
async function settings(ctx) { const v = await ctx.get('team:voice'); return v && typeof v === 'object' ? v : { default: Object.assign({}, DEFAULT), channels: {}, workspaces: {} }; }
async function saveSettings(ctx, v) { await ctx.set('team:voice', v); }
/* The voice to use for this reply: workspace → channel → account default. */
async function voiceFor(ctx, channel, wsId) {
  const v = await settings(ctx);
  const d = Object.assign({}, DEFAULT, v.default || {});
  const c = Object.assign({}, d, (v.channels && v.channels[channel]) || {});
  /* a topic inherits its group's settings, then its own */
  const parts = String(wsId || '').split(':'); const groupId = parts.length > 2 ? parts.slice(0, 2).join(':') : '';
  const g = groupId ? Object.assign({}, c, (v.workspaces && v.workspaces[groupId]) || {}) : c;
  const w = wsId ? Object.assign({}, g, (v.workspaces && v.workspaces[wsId]) || {}) : c;
  const preset = PRESETS[w.preset] || PRESETS[DEFAULT.preset];
  return { preset: w.preset, label: w.voiceId ? 'custom voice ' + w.voiceId.slice(0, 6) + '…' : preset.label, provider: w.voiceId ? (w.provider || 'elevenlabs') : preset.provider, voiceId: w.voiceId || preset.voiceId, settings: preset.settings, replies: w.replies || 'text', length: LENGTHS[w.length] ? w.length : 'short', limit: LENGTHS[LENGTHS[w.length] ? w.length : 'short'] };
}
/* Set something at one of the three levels. */
async function setVoice(ctx, level, key, patch) {
  const v = await settings(ctx);
  v.default = v.default || Object.assign({}, DEFAULT); v.channels = v.channels || {}; v.workspaces = v.workspaces || {};
  const clean = {};
  if (patch.preset != null) { if (!PRESETS[patch.preset]) return { error: 'No such preset. Presets: ' + Object.keys(PRESETS).join(', ') + '.' }; clean.preset = patch.preset; clean.voiceId = ''; }
  if (patch.voiceId != null) { const raw = String(patch.voiceId).trim(), id = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); if (raw && (!id || id !== raw)) return { error: 'A voice id is letters and digits (from ElevenLabs → Voices → ID).' }; clean.voiceId = id; clean.provider = id ? str(patch.provider || 'elevenlabs', 20) : ''; }
  if (patch.replies != null) { if (!/^(text|voice|both)$/.test(patch.replies)) return { error: 'Replies: text, voice or both.' }; clean.replies = patch.replies; }
  if (patch.length != null) { const l = /^\d+$/.test(String(patch.length)) ? (+patch.length <= 40 ? 'short' : +patch.length <= 80 ? 'medium' : 'long') : String(patch.length); if (!LENGTHS[l]) return { error: 'Length: short (about 30 s), medium (60 s) or long (2 min).' }; clean.length = l; }
  if (level === 'channel' && key) v.channels[key] = Object.assign({}, v.channels[key] || {}, clean);
  else if (level === 'workspace' && key) v.workspaces[key] = Object.assign({}, v.workspaces[key] || {}, clean);
  else v.default = Object.assign({}, v.default, clean);
  await saveSettings(ctx, v);
  return { ok: true, settings: v };
}

/* ---------- transcription (in) --------------------------------------------- */
async function fetchBuffer(url, headers) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(url, { headers: headers || {}, signal: ac.signal });
    if (!r.ok) throw new Error('download ' + r.status);
    const ab = await r.arrayBuffer();
    if (ab.byteLength > 6e6) throw new Error('voice note too large');
    return Buffer.from(ab);
  } finally { clearTimeout(t); }
}
/* Telegram: file_id → bytes. FAKE: "fake:<what was said>" carries the words. */
async function telegramVoice(fileId) {
  if (FAKE) return { buffer: Buffer.from('fake-audio'), mime: 'audio/ogg', fake: String(fileId).replace(/^fake:/, '') };
  const tok = env('TELEGRAM_BOT_TOKEN');
  const r = await fetch('https://api.telegram.org/bot' + tok + '/getFile?file_id=' + encodeURIComponent(fileId));
  const j = await r.json().catch(() => null);
  if (!j || !j.ok || !j.result || !j.result.file_path) throw new Error('telegram getFile failed');
  return { buffer: await fetchBuffer('https://api.telegram.org/file/bot' + tok + '/' + j.result.file_path), mime: 'audio/ogg' };
}
async function transcribe(audio, lang) {
  const started = Date.now();
  const p = sttProvider();
  if (!p) return { error: 'Voice notes need a speech-to-text key on the server: ELEVENLABS_API_KEY or OPENAI_API_KEY.', missing: true };
  if (p === 'fake') return { text: audio.fake || '', lang: lang || 'en', provider: 'fake', ms: 1 };
  try {
    const form = new FormData();
    const blob = new Blob([audio.buffer], { type: audio.mime || 'audio/ogg' });
    if (p === 'elevenlabs') {
      form.append('file', blob, 'note.ogg'); form.append('model_id', 'scribe_v1'); if (lang) form.append('language_code', lang === 'tr' ? 'tur' : 'eng');
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') }, body: form });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) return { error: 'Transcription failed (' + r.status + ').' };
      return { text: str(j.text, 6000), lang: j.language_code ? (String(j.language_code).indexOf('tur') === 0 ? 'tr' : 'en') : (lang || 'en'), provider: p, ms: Date.now() - started };
    }
    form.append('file', blob, 'note.ogg'); form.append('model', 'whisper-1'); if (lang) form.append('language', lang);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + env('OPENAI_API_KEY') }, body: form });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { error: 'Transcription failed (' + r.status + ').' };
    return { text: str(j.text, 6000), lang: lang || 'en', provider: p, ms: Date.now() - started };
  } catch (e) { return { error: 'Transcription failed: ' + str(e.message, 100) }; }
}

/* A whole recording — a meeting, a call, a video — not a voice note: no
   length cap, the language detected (Turkish, English or both), and who
   spoke when the provider can tell (ElevenLabs Scribe diarises). The file
   goes up as it is: Scribe takes audio and video alike. */
const EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/mpeg': 'mpeg' };
async function transcribeFile(buffer, mime, name) {
  const started = Date.now();
  const p = sttProvider();
  if (!p) return { error: 'Recordings need a speech-to-text key on the server: ELEVENLABS_API_KEY or OPENAI_API_KEY.', missing: true };
  if (p === 'fake') { const t = buffer.toString('utf8'); return { text: /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(t) ? t : 'fake transcript', lang: 'en', provider: 'fake', ms: 1 }; }
  const ext = EXT[String(mime || '').toLowerCase()] || (String(name || '').match(/\.([a-z0-9]{2,5})$/i) || [])[1] || 'mp4';
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), 'recording.' + ext);
    if (p === 'elevenlabs') {
      form.append('model_id', 'scribe_v1'); form.append('diarize', 'true'); form.append('tag_audio_events', 'false');
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') }, body: form });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) return { error: 'Transcription failed (' + r.status + (j && j.detail && j.detail.message ? ': ' + str(j.detail.message, 120) : '') + ').' };
      /* who said what, when there was more than one voice */
      let text = String(j.text || '');
      const words = Array.isArray(j.words) ? j.words.filter((w) => w && w.type !== 'spacing' && w.text) : [];
      const speakers = new Set(words.map((w) => w.speaker_id).filter(Boolean));
      if (speakers.size > 1) {
        const lines = []; let cur = null, buf = [];
        const label = (id) => 'Speaker ' + (String(id).replace(/\D+/g, '') ? Number(String(id).replace(/\D+/g, '')) + 1 : id);
        for (const w of words) { if (w.speaker_id !== cur) { if (buf.length) lines.push(label(cur) + ': ' + buf.join(' ')); cur = w.speaker_id; buf = []; } buf.push(w.text); }
        if (buf.length) lines.push(label(cur) + ': ' + buf.join(' '));
        text = lines.join('\n').replace(/ ([.,!?;:])/g, '$1');
      }
      const last = words.length ? words[words.length - 1].end : 0;
      return { text, lang: j.language_code ? (String(j.language_code).indexOf('tur') === 0 ? 'tr' : 'en') : '', speakers: speakers.size, seconds: Math.round(Number(last) || 0), provider: p, ms: Date.now() - started };
    }
    if (buffer.length > 25 * 1024 * 1024) return { error: 'That recording is over 25 MB, the most OpenAI transcribes at once. Add ELEVENLABS_API_KEY for long recordings, or send a shorter part.' };
    form.append('model', 'whisper-1');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + env('OPENAI_API_KEY') }, body: form });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { error: 'Transcription failed (' + r.status + ').' };
    return { text: String(j.text || ''), lang: '', provider: p, ms: Date.now() - started };
  } catch (e) { return { error: 'Transcription failed: ' + str(e.message, 100) }; }
}

/* ---------- synthesis (out) ------------------------------------------------- */
/* Trim to the preset's length at a sentence end, so a long answer is not cut mid-word. */
function trimForSpeech(text, limit) {
  let t = String(text || '').replace(/\s+/g, ' ').replace(/https?:\/\/\S+/g, 'a link').replace(/[*_#>`]/g, '').trim();
  const words = t.split(' ');
  if (words.length <= limit.words) return t;
  const cut = words.slice(0, limit.words).join(' ');
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (end > cut.length * 0.5 ? cut.slice(0, end + 1) : cut + '…');
}
async function synthesize(text, voice) {
  const p = ttsProvider(voice.provider);
  if (!p) return { error: 'Spoken replies need a text-to-speech key on the server: ELEVENLABS_API_KEY or OPENAI_API_KEY.', missing: true };
  if (p === 'fake') return { buffer: Buffer.from('OggS-fake-' + text.length), mime: 'audio/ogg', provider: 'fake', voiceId: voice.voiceId, seconds: Math.round(text.split(' ').length / 2.5) };
  try {
    if (p === 'elevenlabs') {
      const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voice.voiceId) + '?output_format=opus_48000_64', { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'content-type': 'application/json', accept: 'audio/ogg' }, body: JSON.stringify({ text, model_id: env('FLOW_TTS_MODEL') || 'eleven_multilingual_v2', voice_settings: voice.settings || PRESETS['british-male'].settings }) });
      if (!r.ok) return { error: 'The voice could not be made (' + r.status + ').' };
      return { buffer: Buffer.from(await r.arrayBuffer()), mime: 'audio/ogg', provider: p, voiceId: voice.voiceId, seconds: Math.round(text.split(' ').length / 2.5) };
    }
    const r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + env('OPENAI_API_KEY'), 'content-type': 'application/json' }, body: JSON.stringify({ model: 'tts-1', voice: voice.voiceId || 'onyx', input: text, response_format: 'opus' }) });
    if (!r.ok) return { error: 'The voice could not be made (' + r.status + ').' };
    return { buffer: Buffer.from(await r.arrayBuffer()), mime: 'audio/ogg', provider: p, voiceId: voice.voiceId, seconds: Math.round(text.split(' ').length / 2.5) };
  } catch (e) { return { error: 'The voice could not be made: ' + str(e.message, 100) }; }
}

/* ---------- the owner's /voice command ------------------------------------ */
function describe(v) { return v.label + ' · replies ' + (v.replies === 'both' ? 'as text and voice' : v.replies === 'voice' ? 'as voice notes' : 'as text' + (v.replies === 'text' ? ' (a voice note gets a voice note back)' : '')) + ' · spoken length ' + v.length + ' (about ' + v.limit.seconds + ' s)'; }
async function command(ctx, rest, channel, wsId) {
  const level = wsId ? 'workspace' : 'channel', key = wsId || channel;
  const where = wsId ? 'this ' + (wsId.split(':').length > 2 ? 'topic' : 'group') : 'this channel';
  if (!rest) {
    const v = await voiceFor(ctx, channel, wsId); const st = status();
    return 'Voice for ' + where + ': ' + describe(v) + '.\nIn: ' + (st.in === 'working' ? 'voice notes are understood (' + st.stt + ')' : 'voice notes need ' + st.missing.join(' / ') + ' on the server') + ' · Out: ' + (st.out === 'working' ? st.tts : 'awaiting a key') + '.\n/voice british-male · british-female · american-male · american-female · openai-male · openai-female — presets\n/voice id <ElevenLabs voice id> — your own cloned or chosen voice\n/voice replies text|voice|both · /voice length 30|60|120 · /voice test';
  }
  const m = rest.match(/^(\S+)\s*(.*)$/); const a = m[1].toLowerCase(), b = (m[2] || '').trim();
  if (PRESETS[a]) { const r = await setVoice(ctx, level, key, { preset: a }); return r.error ? r.error : 'Done: ' + PRESETS[a].label + ' speaks for ' + where + '.'; }
  if (a === 'id' || a === 'voiceid') { if (!b) return 'Say /voice id <the voice id from ElevenLabs → Voices>.'; const r = await setVoice(ctx, level, key, { voiceId: b, provider: 'elevenlabs' }); return r.error ? r.error : 'Done: ElevenLabs voice ' + b.slice(0, 6) + '… speaks for ' + where + '. The key stays on the server; the id is all that is kept here.'; }
  if (a === 'replies' || a === 'reply') { const r = await setVoice(ctx, level, key, { replies: b.toLowerCase() }); return r.error ? r.error : 'Done: replies ' + (b === 'both' ? 'as text and voice' : b === 'voice' ? 'as voice notes' : 'as text; a voice note still gets a voice note back') + ' for ' + where + '.'; }
  if (a === 'length' || a === 'seconds') { const r = await setVoice(ctx, level, key, { length: b.toLowerCase() }); if (r.error) return r.error; const v = await voiceFor(ctx, channel, wsId); return 'Done: spoken replies for ' + where + ' run about ' + v.limit.seconds + ' seconds (' + v.limit.words + ' words at most).'; }
  if (a === 'test') return { test: true };
  if (a === 'reset') { const v = await settings(ctx); if (wsId && v.workspaces) delete v.workspaces[wsId]; else if (v.channels) delete v.channels[channel]; await saveSettings(ctx, v); return 'Done: ' + where + ' uses the account\'s default voice again.'; }
  return 'I do not know /voice ' + a + '. /voice on its own shows the choices.';
}

module.exports = { PRESETS, LENGTHS, DEFAULT, providers, sttProvider, ttsProvider, status, settings, saveSettings, voiceFor, setVoice, telegramVoice, transcribe, transcribeFile, trimForSpeech, synthesize, command, describe };
