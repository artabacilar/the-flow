/* Streaming is what makes the assistant feel fast, and the two places it can
   quietly go wrong are invisible in normal use: a network chunk that splits a
   frame in half (a word disappears out of the middle of an answer), and a
   guard that is checked after the stream has opened (an error that can no
   longer be sent). Both are tested here. None of it calls the real API. */
const m = require('../flow-extras.js');
const I = m._internals;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

const reader = (data) => ({
  async get(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
  async all() { return data; }
});
const D = (o) => 'data: ' + JSON.stringify(o) + '\n\n';

(async () => {
  console.log('\n— frames out of a byte stream —');
  let r = I.sseFrames(D({ t: 'd', v: 'one' }) + D({ t: 'd', v: 'two' }));
  ok('two whole frames come back as two events', r.events.length === 2, r);
  ok('nothing is left over', r.rest === '', r.rest);

  r = I.sseFrames(D({ t: 'd', v: 'one' }) + 'data: {"t":"d","v":"tw');
  ok('a half-arrived frame is not parsed', r.events.length === 1, r.events);
  ok('and is kept for the next chunk', r.rest === 'data: {"t":"d","v":"tw', r.rest);

  /* The real test: feed one payload a byte at a time and see whether the
     answer that comes out is the answer that went in. */
  const wire = D({ t: 'open' }) + D({ t: 'd', v: 'Three ' }) + D({ t: 'd', v: 'DJ sets ' }) +
               D({ t: 'd', v: 'this week.' }) + D({ t: 'meta', used: 4, cap: 40 }) + D({ t: 'end' });
  let buf = '', got = '', kinds = [];
  for (const ch of wire) {
    const cut = I.sseFrames(buf + ch);
    buf = cut.rest;
    for (const ev of cut.events) { kinds.push(ev.t); if (ev.t === 'd') got += ev.v; }
  }
  ok('a byte-at-a-time stream reassembles exactly', got === 'Three DJ sets this week.', got);
  ok('every event arrives, in order', kinds.join(',') === 'open,d,d,d,meta,end', kinds);
  ok('nothing is stranded at the end', buf === '', buf);

  /* Awkward but legal shapes. */
  ok('a comment-only frame is skipped', I.sseFrames(': keep-alive\n\n').events.length === 0);
  ok('a [DONE] sentinel is not an event', I.sseFrames('data: [DONE]\n\n').events.length === 0);
  ok('unparseable JSON is dropped, not thrown', I.sseFrames('data: {oops\n\n').events.length === 0);
  ok('a frame split across two data: lines is joined',
     I.sseFrames('data: {"t":"d",\ndata: "v":"x"}\n\n').events[0].v === 'x');
  ok('an empty buffer is safe', I.sseFrames('').events.length === 0 && I.sseFrames(null).rest === '');
  ok('text containing a blank line survives',
     I.sseFrames(D({ t: 'd', v: 'a\n\nb' })).events[0].v === 'a\n\nb');

  console.log('\n— every refusal happens before the stream opens —');
  const call = async (env, body, counter) => {
    const saved = process.env.ANTHROPIC_API_KEY;
    if (env === null) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = env;
    delete require.cache[require.resolve('../flow-extras.js')];
    const fresh = require('../flow-extras.js');
    let status = 0, payload = null, wroteHead = false;
    const res = { writeHead: () => { wroteHead = true; }, write: () => {}, end: () => {} };
    await fresh.handle('/api/flow/chat/stream', { method: 'POST', on: () => {} }, res, {
      json: (r, s, b) => { status = s; payload = b; },
      readBody: async () => JSON.stringify(body),
      mine: reader({}),
      counter: counter || { get: async () => 0, set: async () => {} }
    });
    if (saved) process.env.ANTHROPIC_API_KEY = saved; else delete process.env.ANTHROPIC_API_KEY;
    return { status, payload, wroteHead };
  };

  let out = await call(null, { messages: [{ role: 'user', content: 'hi' }] });
  ok('no API key is a plain 503, not a broken stream', out.status === 503 && !out.wroteHead, out);

  out = await call('test-key', { messages: [{ role: 'user', content: 'hi' }] },
                   { get: async (k) => (k.indexOf('chat:') === 0 ? 9999 : 0), set: async () => {} });
  ok('over the daily cap is a 429 before any bytes go out', out.status === 429 && !out.wroteHead, out);

  out = await call('test-key', { messages: [] });
  ok('an empty conversation is refused', out.status === 400 && !out.wroteHead, out);

  out = await call('test-key', { messages: [{ role: 'assistant', content: 'hello' }] });
  ok('a history not ending in a question is refused', out.status === 400, out);

  console.log('\n— the record is sent as a cacheable block —');
  const big = I.systemBlocks('x'.repeat(9000));
  ok('the prompt is split into instructions and record', big.length === 2, big.length);
  ok('the instructions come first and are not marked', !big[0].cache_control);
  ok('a large record is marked cacheable', big[1].cache_control && big[1].cache_control.type === 'ephemeral', big[1].cache_control);
  const small = I.systemBlocks('tiny');
  ok('a record too small to cache is not marked', !small[1].cache_control);
  ok('an empty record still produces a valid prompt',
     I.systemBlocks('')[1].text.indexOf('no data yet') > 0 && I.systemBlocks(null).length === 2);
  ok('the record block carries the data, not the instructions',
     big[1].text.indexOf('own data') >= 0 && big[1].text.indexOf('thinking partner') < 0);

  console.log('\n— it still only reads —');
  const src = require('fs').readFileSync(require.resolve('../flow-extras.js'), 'utf8');
  const block = src.slice(src.indexOf('async function handleChatStream'), src.indexOf('/* =====', src.indexOf('async function handleChatStream')));
  ok('the streaming handler never writes to the person\'s store',
     !/mine\s*\.\s*set/.test(block) && !/mine\s*\.\s*put/.test(block));
  ok('it sends the anti-buffering header proxies need',
     /X-Accel-Buffering/.test(block));
  ok('a stream that produced nothing is not charged to the day',
     /if \(any\)/.test(block));

  console.log('\n— the spoken sentence, read out of a half-written answer —');
  const P = I.sayPrefix;
  ok('nothing before the say field', P('{"act').text === '' && !P('{"act').closed);
  ok('a partial sentence comes out as far as it goes', P('{"say":"Three DJ se').text === 'Three DJ se');
  ok('closed once its quote arrives', P('{"say":"Done.","actions":[]}').closed && P('{"say":"Done.","actions":[]}').text === 'Done.');
  ok('escapes are decoded', P('{"say":"He said \\"go\\"\\nnow"').text === 'He said "go"\nnow');
  ok('a half escape is held back', P('{"say":"a\\').text === 'a' && P('{"say":"a\\u00').text === 'a');
  ok('unicode escapes are decoded', P('{"say":"Merhaba \\u00e7"').text === 'Merhaba ç');
  ok('spaces around the colon are fine', P('{ "say" : "x').text === 'x');
  const full = '{"say":"Added \\"Call the venue\\" for tomorrow.","actions":[{"type":"rock","title":"Call the venue","date":"2026-10-31"}]}';
  let prev = '', mono = true;
  for (let i = 0; i <= full.length; i++) { const t = P(full.slice(0, i)).text; if (t.indexOf(prev) !== 0) mono = false; prev = t; }
  ok('it only ever grows as the answer arrives', mono && prev === 'Added "Call the venue" for tomorrow.', prev);

  console.log('\n— Say streams when asked —');
  const S = I.say;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const parts = full.match(/[\s\S]{1,7}/g);
  S.setStreamer(async (url, h, payload, onEvent) => {
    if (!payload.stream) return { status: 500 };
    onEvent({ type: 'message_start', message: { usage: { input_tokens: 10 } } });
    for (const t of parts) onEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } });
    onEvent({ type: 'message_delta', usage: { output_tokens: 30 } });
    return { status: 200 };
  });
  let plainCalls = 0;
  S.setPoster(async () => { plainCalls++; return { status: 200, body: { content: [{ type: 'text', text: full }] } }; });
  const mkS = (body) => {
    const o = { frames: [], head: null, ended: false, json: null };
    const res = { writeHead: (s, hh) => { o.head = { s, hh }; }, write: (b) => { o.frames.push(...I.sseFrames(b).events); }, end: () => { o.ended = true; } };
    const ctx = { json: (r, s, b) => { o.json = { s, b }; }, readBody: async () => JSON.stringify(body), plan: { tier: 'plus' }, counter: { m: {}, get(k) { return this.m[k] || 0; }, set(k, v) { this.m[k] = v; } } };
    return { o, res, ctx };
  };
  const ctxBody = { text: 'tomorrow call the venue', lang: 'en', stream: true, ctx: { today: '2026-10-30', rocks: [], habits: [] } };
  let s1 = mkS(ctxBody);
  await S.handle('/api/flow/do', { method: 'POST' }, s1.res, s1.ctx);
  const ds = s1.o.frames.filter((f) => f.t === 'd').map((f) => f.v).join('');
  const done = s1.o.frames.find((f) => f.t === 'done');
  ok('it opens as an event stream', s1.o.head && /event-stream/.test(s1.o.head.hh['Content-Type']) && s1.o.frames[0] && s1.o.frames[0].t === 'open', s1.o);
  ok('the deltas add up to exactly the spoken sentence', ds === 'Added "Call the venue" for tomorrow.', ds);
  ok('more than one delta (it really streams)', s1.o.frames.filter((f) => f.t === 'd').length > 3);
  ok('it ends with done: the same body a plain reply has', done && done.status === 200 && done.body.say === ds && done.body.actions.length === 1 && s1.o.ended, done);
  ok('nothing went out as plain JSON as well', s1.o.json === null && plainCalls === 0);

  s1 = mkS(Object.assign({}, ctxBody, { watch: true }));
  await S.handle('/api/flow/do', { method: 'POST' }, s1.res, s1.ctx);
  ok('the watch never streams (plain JSON, as before)', s1.o.head === null && s1.o.json && s1.o.json.s === 200 && plainCalls === 1, s1.o);

  s1 = mkS(Object.assign({}, ctxBody, { stream: false }));
  await S.handle('/api/flow/do', { method: 'POST' }, s1.res, s1.ctx);
  ok('an older app that does not ask gets plain JSON', s1.o.head === null && s1.o.json && s1.o.json.b.say === 'Added "Call the venue" for tomorrow.', s1.o);

  S.setStreamer(async () => ({ status: 429 }));
  s1 = mkS(ctxBody);
  await S.handle('/api/flow/do', { method: 'POST' }, s1.res, s1.ctx);
  const d429 = s1.o.frames.find((f) => f.t === 'done');
  ok('an upstream refusal after the stream opened arrives as a done frame', d429 && d429.status === 429 && d429.body.error, s1.o.frames);

  S.setStreamer(async (u, h, p, on) => { on({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'not json at all' } }); return { status: 200 }; });
  s1 = mkS(ctxBody);
  await S.handle('/api/flow/do', { method: 'POST' }, s1.res, s1.ctx);
  const dbad = s1.o.frames.find((f) => f.t === 'done');
  ok('an unreadable answer ends the stream with an error, not silence', dbad && dbad.status === 502 && s1.o.ended, s1.o.frames);

  S.setStreamer(async () => { throw new Error('socket hang up'); });
  s1 = mkS(ctxBody);
  await S.handle('/api/flow/do', { method: 'POST' }, s1.res, s1.ctx);
  const dthrow = s1.o.frames.find((f) => f.t === 'done');
  ok('a dropped connection still ends the stream', dthrow && dthrow.status === 502 && s1.o.ended, s1.o.frames);

  s1 = mkS(Object.assign({}, ctxBody, { text: '  ' }));
  await S.handle('/api/flow/do', { method: 'POST' }, s1.res, s1.ctx);
  ok('an empty request is refused before the stream opens', s1.o.head === null && s1.o.json && s1.o.json.s === 400);
  S.setStreamer(null); S.setPoster(null);

  console.log('\n— a model chosen in the command centre streams too —');
  const T = require('../flow-team.js');
  const realFetch = global.fetch; const seen = [];
  const sseResp = (lines) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const l of lines) c.enqueue(e.encode(l)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  global.fetch = async (url, init) => {
    const b = init && init.body ? JSON.parse(init.body) : {}; seen.push({ url, stream: b.stream, so: b.stream_options });
    if (/\/models$/.test(url)) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (/messages$/.test(url)) return sseResp(['event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"say\\":\\"Hel"}}\n', '\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo there.\\"}"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\n']);
    if (/chat\/completions$/.test(url)) return sseResp(['data: {"choices":[{"delta":{"content":"{\\"say\\":\\"Gro"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"k here.\\"}"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\ndata: [DONE]\n\n']);
    return new Response('{}', { status: 404 });
  };
  process.env.ANTHROPIC_API_KEY = 'k'; process.env.OPENAI_API_KEY = 'k';
  let pieces = [];
  let rc = await T.complete({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'hi' }], onText: (x) => pieces.push(x) });
  ok('Anthropic: asked to stream, pieces arrive as written, whole text and usage at the end', seen.some((x) => /messages$/.test(x.url) && x.stream === true) && pieces.length === 2 && rc.text === '{"say":"Hello there."}' && rc.usage.in === 7 && rc.usage.out === 5, { pieces, rc });
  pieces = [];
  rc = await T.complete({ model: 'gpt-5', system: 's', messages: [{ role: 'user', content: 'hi' }], onText: (x) => pieces.push(x) });
  ok('OpenAI-style: the same, with usage asked for and read from the last chunk', seen.some((x) => /completions$/.test(x.url) && x.stream === true && x.so && x.so.include_usage) && pieces.join('') === '{"say":"Grok here."}' && rc.usage.out === 4, { pieces, rc });
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  rc = await T.complete({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'hi' }], onText: () => {} });
  ok('a refused key while streaming is the same error as before', rc.status === 401 && /refused/.test(rc.error), rc);
  global.fetch = realFetch;

  console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ all ' + pass + ' passed') + ' (' + (pass + fail) + ' checks)');
  process.exit(fail ? 1 : 0);
})();
