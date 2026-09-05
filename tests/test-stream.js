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

  console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ all ' + pass + ' passed') + ' (' + (pass + fail) + ' checks)');
  process.exit(fail ? 1 : 0);
})();
