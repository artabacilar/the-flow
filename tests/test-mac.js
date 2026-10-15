/* The Mac app, checked from a machine that cannot build it.
 *
 * Nothing in mac-app/ is compiled by CI: there is no Mac there, and there was
 * no Mac where it was written. So every way it can fail silently on the Mac
 * is pinned here instead — a Dock icon with no window, a menu item wired to
 * nothing, a bridge call the native side never answers, a bundle id that
 * quietly makes a second app instead of joining the iOS one, an icon file a
 * byte off. Each of those builds and launches without a single error, and
 * each is invisible until someone is looking at the wrong thing on a Mac.
 *
 * What this cannot do is type-check Swift. That happens on the Mac, in
 * build.sh, and its first run is the real test.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAC = path.join(ROOT, 'mac-app');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

const delegateSrc = read(MAC, 'native', 'AppDelegate.swift');
const webSrc = read(MAC, 'native', 'FlowWebController.swift');
const bridgeSrc = read(MAC, 'native', 'FlowMacBridge.swift');
const notesSrc = read(MAC, 'native', 'FlowNotifications.swift');
const mainPath = path.join(MAC, 'native', 'main.swift');
const build = read(MAC, 'build.sh');
/* Checks of what the script DOES read it with comments removed. The first
   draft matched its own explanatory comment and passed with the flag deleted. */
const buildRun = build.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

console.log('\n— it starts at all —');
/* `@main` on an AppKit delegate is NSApplicationMain(), which takes the
   delegate from the main nib. There is no nib. The result launches cleanly
   and shows nothing, with nothing in any log. */
ok('the delegate is not @main (there is no nib to create it from)',
   !/@main\b|@NSApplicationMain\b/.test(code(delegateSrc)));
ok('main.swift exists', fs.existsSync(mainPath));
const mainSrc = fs.existsSync(mainPath) ? code(read(mainPath)) : '';
ok('it creates the delegate and hands it to the application',
   /let\s+delegate\s*=\s*AppDelegate\(\)/.test(mainSrc) && /app\.delegate\s*=\s*delegate/.test(mainSrc));
/* NSApplication holds its delegate weakly. Assigned inline, it is released on
   the next line and the app goes quiet again, the same way. */
ok('the delegate is kept alive by a top-level constant, not created inline',
   !/app\.delegate\s*=\s*AppDelegate\(\)/.test(mainSrc));
ok('and it runs the application', /app\.run\(\)/.test(mainSrc));
ok('nothing else in the target has top-level code that would compete',
   ['AppDelegate.swift', 'FlowWebController.swift', 'FlowMacBridge.swift', 'FlowNotifications.swift']
     .every((f) => !/^\s*(let|var)\s+\w+\s*=|^\s*\w+\.run\(\)/m.test(
       code(read(MAC, 'native', f)).replace(/\{[\s\S]*\}/g, ''))));

console.log('\n— the window opens somewhere sensible —');
/* setFrameAutosaveName's Bool means "the name was free", not "a frame was
   restored". Branching on it put the first launch in the bottom-left. */
const d = code(delegateSrc);
ok('it centres before naming the frame', d.indexOf('window.center()') > -1
   && d.indexOf('window.center()') < d.indexOf('setFrameAutosaveName'));
ok('and does not branch on what setFrameAutosaveName returns',
   !/if\s*!?\s*window\.setFrameAutosaveName/.test(d));

console.log('\n— every menu item reaches something —');
/* A selector with no method behind it builds, and the menu item is simply
   greyed out forever. */
const sels = [...code(delegateSrc).matchAll(/#selector\(FlowWebController\.(\w+)\)/g)].map((m) => m[1]);
ok('the View menu targets the web controller', sels.length >= 4, sels);
const missing = sels.filter((s) => !new RegExp('@objc\\s+func\\s+' + s + '\\s*\\(').test(webSrc));
ok('each of those is an @objc method on it', missing.length === 0, missing);
ok('there is an Edit menu (without it ⌘C and ⌘V do nothing in the page)',
   /NSText\.copy/.test(delegateSrc) && /NSText\.paste/.test(delegateSrc));

console.log('\n— the bridge has two ends —');
/* The page calls FlowMac.notifications.*, which posts an action name. A name
   the Swift switch does not know falls to `default` and answers
   {supported:false} — so a typo here reads as "not on this platform". */
const posted = [...bridgeSrc.matchAll(/call\('(\w+)'/g)].map((m) => m[1]);
const handled = [...notesSrc.matchAll(/case\s+"(\w+)"/g)].map((m) => m[1]);
ok('the page side posts actions', posted.length >= 5, posted);
const unhandled = posted.filter((a) => !handled.includes(a));
ok('every one of them has a case on the native side', unhandled.length === 0, unhandled);
ok('the message channel is registered under the name the page posts to',
   /controller\.add\(self,\s*name:\s*FlowMacBridge\.channel\)/.test(webSrc)
   && /messageHandlers\.\\\(channel\)/.test(bridgeSrc));
ok('the standalone shim is injected before the page runs',
   /FlowMacBridge\.standaloneShim,\s*injectionTime:\s*\.atDocumentStart/.test(webSrc));

console.log('\n— it joins the iOS app instead of becoming a second one —');
const cap = JSON.parse(read(ROOT, 'ios-app', 'capacitor.config.json'));
const v = (name) => { const m = build.match(new RegExp('^' + name + '="([^"]*)"', 'm')); return m && m[1]; };
/* Universal Purchase is keyed on the bundle id. Off by one character and
   App Store Connect offers to create a brand-new app instead. */
ok('the bundle id is the iOS one', v('BUNDLE_ID') === cap.appId, [v('BUNDLE_ID'), cap.appId]);
ok('the team is ABKO', v('TEAM') === 'CFDZ32QZUR');
ok('the minimum macOS allows an arm64 build to ship (12 or later)', parseFloat(v('MIN_OS')) >= 12, v('MIN_OS'));
ok('and the README says the same minimum', read(MAC, 'README.md').includes('macOS ' + v('MIN_OS')));

console.log('\n— the build script —');
ok('builds both architectures', /for arch in arm64 x86_64/.test(buildRun) && /lipo -create/.test(buildRun));
/* Swift 6 language mode turns the WebKit callbacks into hard errors. The Mac
   has Swift 6.4; the sources are Swift 5. Pinned so the compiler that
   happens to be installed does not decide. */
ok('pins the Swift language mode', /swiftc -O -swift-version 5 \\/.test(buildRun));
ok('compiles every Swift file in native/, main.swift included', /native\/\*\.swift/.test(buildRun));
ok('stops at the first error rather than packaging a half-build', /^set -euo pipefail/m.test(buildRun));
/* The lesson tests/run.js was rewritten to learn. */
ok('kills an old copy by exact name, never by pattern', /pkill -x "\$EXE"/.test(buildRun) && !/pkill -f/.test(buildRun));
ok('refuses a development profile before signing with it', /ProvisionedDevices/.test(buildRun));
ok('refuses a profile for some other app', /P_APPID.*!=|\[ "\$P_APPID" = "\$TEAM\.\$BUNDLE_ID" \]/.test(buildRun));
{
  /* App Store Connect rejects any file carrying com.apple.quarantine (91109),
     and a folder unzipped from a download carries it on everything. Every
     copy into the bundle must be followed by a strip before the first sign. */
  const at = (re) => { const m = buildRun.match(re); return m ? m.index : -1; };
  const lastAt = (re) => { let i = -1; for (const m of buildRun.matchAll(new RegExp(re.source, 'g'))) i = m.index; return i; };
  const strips = [...buildRun.matchAll(/xattr -cr "\$APP"/g)].map((m) => m.index);
  const firstSign = at(/codesign --force/);
  const iconCp = at(/cp Resources\/AppIcon\.icns/);
  const profCp = at(/cp "\$PROFILE"/);
  const storeSign = lastAt(/codesign --force/);
  ok('strips quarantine from the bundle before the first signature',
     strips.some((i) => i > iconCp && i < firstSign));
  ok('strips again after the downloaded profile goes in, before the store signature',
     strips.some((i) => i > profCp && i < storeSign));
  /* Quarantine, specifically: macOS keeps com.apple.provenance on files no
     matter what, so failing on any attribute stops every build (it did). */
  const guard = buildRun.match(/case "\$LEFT" in\s*\*com\.apple\.quarantine\*\)\s*fail/);
  ok('refuses to sign a bundle that still carries quarantine',
     !!guard && /LEFT="\$\(xattr -lr "\$APP"/.test(buildRun) && !/xattr -lr[^\n]*\| *grep -q/.test(buildRun));
  ok('does not fail on attributes macOS will not let anyone remove',
     !/\[ -n "\$\(xattr -lr "\$APP"\)" \]\s*;\s*then\s*fail/.test(buildRun)
     && !!guard && guard.index > profCp && guard.index < storeSign);
}
ok('picks certificates by team, not by the legal name', /grep "\(\$TEAM\)\\""/.test(buildRun));

/* The two plists are heredocs. Render them the way bash would and read them
   back as a plist reader would — a stray character in a heredoc is an app
   that will not launch, and plutil only exists on the Mac. */
const heredoc = (tag) => {
  const m = build.match(new RegExp('<<' + tag + '\\n([\\s\\S]*?)\\n' + tag + '\\n'));
  return m && m[1];
};
const VARS = { NAME: 'The Flow', EXE: 'TheFlow', BUNDLE_ID: v('BUNDLE_ID'), TEAM: v('TEAM'),
  VERSION: '1.0', BUILD: '1', MIN_OS: v('MIN_OS'), SDK_VER: '27.0', SDK_BUILD: '27A100',
  XCODE_KEYS: '', STORE_KEYS: '' };
const render = (t, extra) => t
  .replace(/\$\(sw_vers -buildVersion\)/g, '25A1')
  .replace(/\$(\w+)/g, (_, k) => (Object.assign({}, VARS, extra)[k] ?? '<<UNSET ' + k + '>>'));

function plist(xml) {
  const toks = [...xml.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, '')
    .matchAll(/<(\/?)(\w+)[^>]*?(\/?)>|([^<]+)/g)].filter((t) => !(t[4] && !t[4].trim()));
  let i = 0;
  const val = () => {
    const t = toks[i++];
    if (!t || t[1]) throw new Error('expected a value at token ' + i);
    const tag = t[2];
    if (t[3]) { if (tag === 'true') return true; if (tag === 'false') return false; throw new Error('bad empty <' + tag + '/>'); }
    if (tag === 'string') {
      let s = ''; if (toks[i] && toks[i][4] !== undefined) s = toks[i++][4];
      if (!toks[i] || toks[i][1] !== '/' || toks[i][2] !== 'string') throw new Error('unclosed <string>');
      i++; return s;
    }
    if (tag === 'array') { const a = []; while (!(toks[i][1] && toks[i][2] === 'array')) a.push(val()); i++; return a; }
    if (tag === 'dict') {
      const o = {};
      while (!(toks[i][1] && toks[i][2] === 'dict')) {
        if (toks[i][2] !== 'key') throw new Error('expected <key> in dict, got ' + JSON.stringify(toks[i][0] || toks[i][4]));
        const k = toks[i + 1][4]; i += 3;
        if (k in o) throw new Error('duplicate key ' + k);
        o[k] = val();
      }
      i++; return o;
    }
    if (tag === 'plist') { const r = val(); i++; return r; }
    throw new Error('unknown tag ' + tag);
  };
  return val();
}

let info = null;
try { info = plist(render(heredoc('PLIST'))); } catch (e) { info = { __error: e.message }; }
ok('Info.plist renders to a well-formed plist', info && !info.__error, info && info.__error);
info = info && !info.__error ? info : {};
ok('with no variable left unset', !/UNSET/.test(JSON.stringify(info)), JSON.stringify(info).match(/<<UNSET \w+>>/));
ok('the executable it names is the one the script builds', info.CFBundleExecutable === VARS.EXE);
ok('the bundle id is the iOS one', info.CFBundleIdentifier === cap.appId);
ok('it is an application, run by NSApplication',
   info.CFBundlePackageType === 'APPL' && info.NSPrincipalClass === 'NSApplication');
ok('the icon it names is the one copied in', info.CFBundleIconFile === 'AppIcon'
   && /cp Resources\/AppIcon\.icns "\$APP\/Contents\/Resources\/AppIcon\.icns"/.test(buildRun));
/* Missing, the upload is rejected; these are the Mac App Store's own
   requirements, not style. */
ok('it has an App Store category', info.LSApplicationCategoryType === 'public.app-category.productivity');
ok('it states its minimum macOS', info.LSMinimumSystemVersion === v('MIN_OS'));
ok('it answers the encryption question up front', info.ITSAppUsesNonExemptEncryption === false);
ok('it records the SDK it was built against', info.DTSDKName === 'macosx27.0' && info.DTPlatformName === 'macosx');

/* And the Xcode pair, when Xcode is present, slotted into the same dict. */
let withXcode = null;
try {
  withXcode = plist(render(heredoc('PLIST'), {
    XCODE_KEYS: '\t<key>DTXcode</key>\n\t<string>2700</string>\n\t<key>DTXcodeBuild</key>\n\t<string>27A1</string>' }));
} catch (e) { withXcode = { __error: e.message }; }
ok('with Xcode present it still renders, and records Xcode', withXcode && withXcode.DTXcode === '2700', withXcode);

let ent = null, entStore = null;
try {
  ent = plist(render(heredoc('ENTS')));
  entStore = plist(render(heredoc('ENTS'), { STORE_KEYS: render(build.match(/\n  STORE_KEYS="(\t<key>[\s\S]*?)"\nfi/)[1]) }));
} catch (e) { ent = { __error: e.message }; }
ok('the entitlements render', ent && !ent.__error, ent && ent.__error);
ok('sandboxed — the Mac App Store requires it', ent && ent['com.apple.security.app-sandbox'] === true);
/* The one that, missing, leaves the window on the offline page for ever with
   no error anywhere. */
ok('and allowed out to the network', ent && ent['com.apple.security.network.client'] === true);
ok('the store build names the app and team the profile is for',
   entStore && entStore['com.apple.application-identifier'] === 'CFDZ32QZUR.' + cap.appId
   && entStore['com.apple.developer.team-identifier'] === 'CFDZ32QZUR', entStore);
ok('the build for this Mac does not claim an identity it has no profile for',
   ent && !('com.apple.application-identifier' in ent));

console.log('\n— the icon —');
const icnsPath = path.join(MAC, 'Resources', 'AppIcon.icns');
ok('AppIcon.icns is committed', fs.existsSync(icnsPath));
const icns = fs.existsSync(icnsPath) ? fs.readFileSync(icnsPath) : Buffer.alloc(8);
ok('it is an icns container whose length is its own size',
   icns.toString('ascii', 0, 4) === 'icns' && icns.readUInt32BE(4) === icns.length);
const entries = {};
for (let o = 8; o + 8 <= icns.length;) {
  const len = icns.readUInt32BE(o + 4);
  if (len < 8) break;
  entries[icns.toString('ascii', o, o + 4)] = icns.subarray(o + 8, o + len);
  o += len;
}
const { SLOTS, render: renderIcon } = require(path.join(MAC, 'scripts', 'make-mac-icon.js'));
const ihdr = (png) => png.length > 26 && png.readUInt32BE(0) === 0x89504E47
  ? { w: png.readUInt32BE(16), h: png.readUInt32BE(20), type: png[25] } : null;
const wrong = SLOTS.filter(([t, px]) => { const h = entries[t] && ihdr(entries[t]); return !h || h.w !== px || h.h !== px; });
ok('every slot is present and holds a PNG of exactly its size', wrong.length === 0, wrong);
/* The upload is refused without both of these — ITMS-90236. */
ok('including 512 and 512@2x, which the App Store requires',
   ihdr(entries.ic09 || Buffer.alloc(0))?.w === 512 && ihdr(entries.ic10 || Buffer.alloc(0))?.w === 1024);
ok('with an alpha channel — macOS draws the margin, so it must be clear',
   SLOTS.every(([t]) => entries[t] && ihdr(entries[t]).type === 6));

/* Decode the 1024 and look at it. The PNGs are written with filter 0 on every
   row, so decoding is inflate and stride. */
const big = entries.ic10;
let corner = -1, centre = -1;
if (big) {
  const chunks = []; let o = 8;
  while (o < big.length) {
    const len = big.readUInt32BE(o), type = big.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') chunks.push(big.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const at = (x, y) => raw[y * (1 + 1024 * 4) + 1 + x * 4 + 3];
  corner = at(4, 4); centre = at(512, 512);
}
ok('the corner is transparent (on the grid, not a full-bleed square)', corner === 0, corner);
ok('the centre is solid', centre === 255, centre);
/* Committed bytes and the script must agree, or the next person to run the
   script changes the icon without meaning to. */
const fresh = {};
const drift = SLOTS.filter(([t, px]) => !entries[t] || !(fresh[px] = fresh[px] || renderIcon(px)).equals(entries[t]))
  .map(([t]) => t);
ok('the committed icon is what the script draws, in every slot', drift.length === 0, drift);

/* Requiring the iOS drawer must not write over the iOS icons as a side
   effect — the Mac script requires it. */
const iosIcon = path.join(ROOT, 'ios-app', 'native', 'Assets', 'AppIcon', 'AppIcon-1024.png');
const before = fs.statSync(iosIcon).mtimeMs;
execFileSync(process.execPath, ['-e', "require(" + JSON.stringify(path.join(ROOT, 'ios-app', 'scripts', 'make-icons.js')) + ")"]);
ok('requiring the iOS icon drawer writes nothing', fs.statSync(iosIcon).mtimeMs === before);

/* The title bar. Chrome paints an installed site's title bar in the page's
   theme-color; the Mac app used to leave the system's grey bar on top of a
   black page, and it was the first thing anybody noticed side by side. */
console.log('\n— the title bar is the page\'s colour, as it is in Chrome —');
{
  const d = code(delegateSrc), w = code(webSrc);
  ok('the title bar is transparent, so the window colour shows through',
     /window\.titlebarAppearsTransparent\s*=\s*true/.test(d));
  ok('the web view\'s theme-color is observed, not read once',
     /\.observe\(\\\.themeColor/.test(w) && /themeObservation\s*=/.test(w));
  ok('the observation fires at once, for the first paint',
     /observe\(\\\.themeColor,\s*options:\s*\[\s*\.initial/.test(w));
  ok('the window follows it, and so does the overscroll backdrop',
     /onThemeColor\s*=/.test(d) && /window\.backgroundColor\s*=\s*bg/.test(d) && /underPageBackgroundColor\s*=\s*color/.test(w));
  ok('the title text and traffic lights switch appearance with it',
     /NSAppearance\(named:\s*Self\.isDark\(bg\)\s*\?\s*\.darkAqua\s*:\s*\.aqua\)/.test(d));
  /* The same luminance rule as isDark(), against every theme the page
     defines — the light ones must come out light, or their title would be
     white on cream. */
  const lum = (h) => { const n = parseInt(h.slice(1), 16);
    return 0.2126 * ((n >> 16) & 255) / 255 + 0.7152 * ((n >> 8) & 255) / 255 + 0.0722 * (n & 255) / 255; };
  const page = read(ROOT, 'life-dashboard.html');
  const m = page.match(/var T=\{([^}]*)\}/);
  const themes = m ? Object.fromEntries([...m[1].matchAll(/(\w+):'(#[0-9a-fA-F]{6})'/g)].map((x) => [x[1], x[2]])) : {};
  const wrong = Object.entries(themes).filter(([name, hex]) =>
    (lum(hex) < 0.5) !== !['bloom', 'paper'].includes(name)).map(([n]) => n);
  ok('every theme the page defines is read the right way round (' + Object.keys(themes).length + ' themes)',
     Object.keys(themes).length >= 7 && wrong.length === 0, wrong);
  ok('the luminance rule in the app is the one tested here',
     /0\.2126\s*\*\s*c\.redComponent\s*\+\s*0\.7152\s*\*\s*c\.greenComponent\s*\+\s*0\.0722\s*\*\s*c\.blueComponent/.test(d) && /l\s*<\s*0\.5/.test(d));
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
