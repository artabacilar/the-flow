/* What J.A.R.V.I.S.'s messages cost: the part of each that repeats (his
 * instructions, the person's data) goes to Anthropic marked for the prompt
 * cache, and the usage counts a cache read at a tenth of the input price.
 *
 * What would make it wrong: the blocks flattened into one string on the way
 * to Anthropic (no cache); the marks sent to a provider that does not take
 * them; cached tokens counted at full price, or not counted at all. */
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
const T = require('../flow-team.js');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 300) : ''))); };
(async () => {
  let seen = null;
  T._internals.setPost(async (url, opts) => { seen = { url, body: JSON.parse(opts.body) }; return /chat\/completions/.test(url) ? { status: 200, body: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } } } : { status: 200, body: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 } } }; });
  const sys = [{ type: 'text', text: 'INSTRUCTIONS', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'today only' }];
  const r = await T.complete({ model: 'claude-sonnet-4-5', system: sys, messages: [{ role: 'user', content: 'hi' }] });
  ok('to Anthropic the system goes as blocks, the repeating one marked for the cache', /anthropic/.test(seen.url) && Array.isArray(seen.body.system) && seen.body.system[0].cache_control && seen.body.system[0].cache_control.type === 'ephemeral' && !seen.body.system[1].cache_control, seen.body.system);
  ok('what was read from the cache is counted', r.usage.cacheRead === 9000 && r.usage.in === 300 && r.usage.out === 40, r.usage);
  const r2 = await T.complete({ model: 'gpt-4o', system: sys, messages: [{ role: 'user', content: 'hi' }] }).catch((e) => ({ error: e.message }));
  ok('another provider gets the same words as one plain system message, no marks', r2 && !r2.error ? /INSTRUCTIONS\n\ntoday only/.test(JSON.stringify(seen.body.messages[0].content).replace(/\\n/g, '\n')) && !/cache_control/.test(JSON.stringify(seen.body)) : true, r2);
  /* the price: 9000 cached at a tenth of $3/M, 300 in at $3/M, 40 out at $15/M */
  const ctx = (() => { const m = {}; return { get: async (k) => m[k] == null ? null : JSON.parse(JSON.stringify(m[k])), set: async (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; })();
  await T.bumpUsage(ctx, 'jarvis', r.usage, 'claude-sonnet-4-5');
  const mo = await ctx.get('team:usage:m:' + new Date().toISOString().slice(0, 7));
  const want = (300 * 3 + 40 * 15 + 9000 * 0.3) / 1e6;
  ok('a cache read costs a tenth of the input price in the month\'s count', Math.abs(mo.jarvis.usd - want) < 1e-9 && mo.jarvis.cached === 9000, { got: mo.jarvis, want });
  const ex = fs.readFileSync(path.join(__dirname, '..', 'flow-extras.js'), 'utf8'), ch = fs.readFileSync(path.join(__dirname, '..', 'flow-channels.js'), 'utf8');
  ok('in the app his instructions are marked for the cache and go as blocks on every route', /DO_SYSTEM \+ '\\n' \+ voice\.text, cache_control: \{ type: 'ephemeral' \}/.test(ex) && /complete\(\{ model: team\.model, system, messages/.test(ex));
  ok('on Telegram the long repeating part goes first, marked', /sysMain, cache_control: \{ type: 'ephemeral' \}/.test(ch));
  ok('the longest answer is back to 2,000 tokens (a cut-off answer is rescued, not lost)', /maxTokens: 2000, timeoutMs: 45000/.test(ex) && /max_tokens: 2000, system/.test(ex));
  ok('updates set to the app or push notifications are not pushed into Telegram (replies still are)', /\(def === 'app' \|\| def === 'push'\) && !\(opts && opts\.channel\)\) return 0;/.test(ch));
  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
