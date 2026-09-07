/* Turning somebody's own text into markup is the one place an app can hurt
   itself, so most of this is about what linkify REFUSES to do: run a script,
   break out of an href, or trust anything it did not put there itself. The
   rest is the ordinary decency of not swallowing the full stop at the end of
   a sentence. */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'life-dashboard.html'), 'utf8');
const pack = fs.readFileSync(path.join(__dirname, '..', 'flow-pack.js'), 'utf8');
const grab = (src, from, to) => {
  const a = src.indexOf(from); const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('not found: ' + from);
  return src.slice(a, b);
};

/* Both copies are lifted and tested, because they are two implementations of
   one promise and only one of them is in the file you happen to be reading. */
const hostLink = new Function(
  grab(html, 'function tdEsc(', 'function hitLink(') + '; return linkify;')();
const packLink = new Function(
  "function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}" +
  grab(pack, 'function linkifyText(', '\n/* A row that is itself a control') + '; return linkifyText;')();

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d) : ''))); };
/* Every claim is checked against both implementations at once. */
const both = (name, input, check) => {
  const a = hostLink(input), b = packLink(input);
  const ra = check(a), rb = check(b);
  ok(name, ra && rb, ra ? (rb ? '' : { pack: b }) : { host: a });
};

console.log('\n— the meeting link he actually pasted —');
const REAL = 'Meeting link: https://teams.live.com/meet/9341078526722?p=HGPLZ3K3MtbZdPZUeH';
both('it becomes an anchor', REAL, o => /<a class="flow-link" href="https:\/\/teams\.live\.com\/meet\/9341078526722\?p=HGPLZ3K3MtbZdPZUeH"/.test(o));
both('that opens away from the app', REAL, o => /target="_blank"/.test(o) && /rel="noopener noreferrer"/.test(o));
both('with the URL still readable as the text', REAL, o => o.indexOf('>https://teams.live.com/meet/9341078526722?p=HGPLZ3K3MtbZdPZUeH</a>') > 0);
both('and the words around it left alone', REAL, o => o.indexOf('Meeting link: ') === 0);

console.log('\n— what it must never do —');
both('a javascript: URL is not a link', 'javascript:alert(1)', o => o.indexOf('<a') < 0);
both('nor is one dressed up as text', 'click javascript:alert(document.cookie) now', o => o.indexOf('<a') < 0);
both('a data: URL is not a link', 'data:text/html;base64,PHNjcmlwdD4=', o => o.indexOf('<a') < 0);
both('a file: URL is not a link', 'file:///etc/passwd', o => o.indexOf('<a') < 0);
both('a script tag is still just text', '<script>alert(1)</script>', o => o.indexOf('<script') < 0 && o.indexOf('&lt;script&gt;') === 0);
both('and so is one after a real link', 'https://ok.example <img src=x onerror=alert(1)>',
  o => o.indexOf('<img') < 0 && /<a class="flow-link"/.test(o));
both('a quote cannot close the href', 'https://x.example/a" onmouseover="alert(1)',
  o => !/onmouseover="alert/.test(o.split('</a>')[0]));
both('an apostrophe cannot either', "https://x.example/a' onmouseover='alert(1)",
  o => !/onmouseover='alert/.test(o.split('</a>')[0]));
both('a bare angle bracket never survives', 'see https://x.example/<b>bold</b>',
  o => o.indexOf('<b>') < 0);

console.log('\n— a query string keeps its ampersand —');
const Q = 'https://meet.google.com/abc-defg-hij?authuser=0&hs=187';
both('the href carries it as an entity, which is correct in an attribute', Q,
  o => o.indexOf('href="https://meet.google.com/abc-defg-hij?authuser=0&amp;hs=187"') > 0);
both('and the visible text reads normally', Q, o => o.indexOf('?authuser=0&amp;hs=187</a>') > 0);
both('the & does not cut the link short', Q, o => o.indexOf('hs=187') > o.indexOf('<a'));

console.log('\n— the punctuation around a link is the sentence’s —');
both('a trailing full stop stays outside', 'Join at https://x.example/a.',
  o => /<\/a>\.$/.test(o));
both('so does a comma', 'https://x.example/a, then call him',
  o => o.indexOf('</a>, then call him') > 0);
both('and a closing bracket', 'the deck (https://x.example/a) is ready',
  o => o.indexOf('</a>) is ready') > 0);
both('but a slash at the end is part of the URL', 'https://x.example/a/',
  o => o.indexOf('>https://x.example/a/</a>') > 0);
/* A semicolon is left alone on purpose: stripping it would break a URL that
   ends in an escaped entity. */
both('a path that ends in a digit is untouched', 'https://teams.live.com/meet/9341078526722',
  o => o.indexOf('>https://teams.live.com/meet/9341078526722</a>') > 0);

console.log('\n— more than one, and none at all —');
both('two links both work', 'a https://one.example b https://two.example c',
  o => (o.match(/<a class="flow-link"/g) || []).length === 2);
both('plain text is returned untouched', 'David x Arthur', o => o === 'David x Arthur');
both('empty text is empty, not "undefined"', '', o => o === '');
ok('and null is empty too', hostLink(null) === '' && packLink(null) === '');
both('an ampersand on its own is still escaped', 'Ömer & Yunus',
  o => o === 'Ömer &amp; Yunus');
both('a www link is given a scheme', 'see www.abko.com.tr for details',
  o => o.indexOf('href="https://www.abko.com.tr"') > 0 && o.indexOf('>www.abko.com.tr</a>') > 0);

console.log('\n— the YouTube link sitting in his priorities —');
const YT = 'Also a camera to record from up tap by the corner. https://www.youtube.com/shorts/P12-pdGdLzA Also check this for Good dj recording equipment.';
both('is linked in the middle of a paragraph', YT,
  o => o.indexOf('href="https://www.youtube.com/shorts/P12-pdGdLzA"') > 0);
both('and the sentence after it survives', YT, o => /Also check this for Good dj recording equipment\.$/.test(o));

console.log('\n— the row it sits in is still a control —');
ok('the rock toggle lets a link through', /if\(hitLink\(e\)\) return;/.test(html));
ok('so does the week-plan card', (html.match(/if\(hitLink\(e\)\) return;/g) || []).length >= 2);
ok('and the priority row', /if \(qr && !hitLink\(e\)\)/.test(pack));
ok('a link is styled blue, once, unscoped', /\.flow-link\{color:#63c2f7/.test(html));
ok('and a long one can break rather than push the card sideways', /\.flow-link\{[^}]*overflow-wrap:anywhere/.test(html));

console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ all ' + pass + ' passed') + ' (' + (pass + fail) + ' checks)');
process.exit(fail ? 1 : 0);
