/* The assistant writes markdown. Rendering it as literal asterisks is the
   difference between a chat and a log file — but a renderer that reaches the
   DOM is also the one place a model reply could become live HTML, so the
   escaping is tested at least as hard as the formatting. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
const start = src.indexOf('function askMd(');
const end = src.indexOf('\nconst Ask = {');
if (start < 0 || end < 0) { console.log('  ✗ askMd not found in flow-pack.js'); process.exit(1); }

/* The same escape the pack uses, so this tests the real pairing. */
const escSrc = src.slice(src.indexOf('function esc(s) {'), src.indexOf('const norm ='));
const askMd = new Function(escSrc + '\n' + src.slice(start, end) + '\nreturn askMd;')();

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

console.log('\n— nothing a model returns becomes live HTML —');
ok('a script tag is inert text', !/<script/i.test(askMd('<script>alert(1)</script>')), askMd('<script>alert(1)</script>'));
/* The words "onerror=" survive as visible text, which is correct — what
   must not survive is a live tag, so that is what is asserted. */
ok('an img onerror never becomes a tag', !/<img/i.test(askMd('<img src=x onerror=alert(1)>')), askMd('<img src=x onerror=alert(1)>'));
ok('angle brackets are escaped', askMd('a < b').indexOf('&lt;') > 0, askMd('a < b'));
ok('quotes are escaped', askMd('say "hi"').indexOf('&quot;') > 0);
ok('escaping happens before markup, so <b>bold</b> stays text',
   !/<b>/.test(askMd('<b>x</b>')), askMd('<b>x</b>'));

console.log('\n— the formatting the model actually uses —');
ok('bold', askMd('**three** sets').indexOf('<strong>three</strong>') >= 0, askMd('**three** sets'));
ok('italic with asterisks', askMd('that is *not* logged').indexOf('<em>not</em>') >= 0, askMd('that is *not* logged'));
ok('italic with underscores', askMd('that is _not_ logged').indexOf('<em>not</em>') >= 0);
ok('inline code', askMd('the `ld_quad` key').indexOf('<code>ld_quad</code>') >= 0);
ok('a bullet list becomes a list',
   /<ul><li>one<\/li><li>two<\/li><\/ul>/.test(askMd('- one\n- two')), askMd('- one\n- two'));
ok('a numbered list becomes an ordered list',
   /<ol><li>one<\/li><li>two<\/li><\/ol>/.test(askMd('1. one\n2. two')), askMd('1. one\n2. two'));
ok('a heading becomes a heading', askMd('## This week').indexOf('<h4>This week</h4>') >= 0);
ok('paragraphs are separate', (askMd('one\n\ntwo').match(/<p>/g) || []).length === 2, askMd('one\n\ntwo'));
ok('a list ends when prose resumes',
   /<\/ul><p>after<\/p>/.test(askMd('- one\n\nafter')), askMd('- one\n\nafter'));
ok('a fenced block is code, not markup',
   /<pre><code>a \*b\* c\n<\/code><\/pre>/.test(askMd('```\na *b* c\n```')), askMd('```\na *b* c\n```'));
ok('markup inside a fence is escaped too',
   !/<script/i.test(askMd('```\n<script>x</script>\n```')));

console.log('\n— the shapes that break naive renderers —');
ok('a lone asterisk is left alone', askMd('2 * 3 = 6').indexOf('<em>') < 0, askMd('2 * 3 = 6'));
ok('an unclosed bold is not swallowed', askMd('**start only').indexOf('<strong>') < 0, askMd('**start only'));
ok('a snake_case word is not italicised',
   askMd('the ld_compass_key value').indexOf('<em>') < 0, askMd('the ld_compass_key value'));
ok('half-streamed text still renders', typeof askMd('**thre') === 'string');
ok('empty input is an empty string, not a crash', askMd('') === '' && askMd(null) === '');
ok('a bullet mid-stream renders as a list', /<ul>/.test(askMd('- one')), askMd('- one'));

console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ all ' + pass + ' passed') + ' (' + (pass + fail) + ' checks)');
process.exit(fail ? 1 : 0);
