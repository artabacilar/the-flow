/* The committed Xcode project — ios-app/ios/ — is what Xcode Cloud builds, so
 * it is the one copy of the shells that reaches a device without a person at
 * a Mac. It is generated (ios-app: npm run setup) and committed, which means
 * it can be stale in ways nothing on a Linux CI runner would notice: a Swift
 * file edited in native/ that the project's copy no longer matches, a scheme
 * pointing at a target id that was regenerated, a ci script that lost its
 * executable bit on the way through a zip. Each of those fails only on Xcode
 * Cloud, ten minutes after a push, with a message about something else.
 *
 * No server, no browser: this reads files. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IOS = path.join(ROOT, 'ios-app');
const PROJ = path.join(IOS, 'ios', 'App');
const PBX = path.join(PROJ, 'App.xcodeproj', 'project.pbxproj');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n))
  : (fail++, console.log('  ✗ ' + n + (d !== undefined ? '  → ' + JSON.stringify(d).slice(0, 220) : ''))); };

console.log('\n— the project is there, with every target —');
ok('ios-app/ios/App/App.xcodeproj is committed', fs.existsSync(PBX));
const pbx = fs.existsSync(PBX) ? read(PBX) : '';
const targetId = (name) => {
  const m = pbx.match(new RegExp('(\\w{24}) /\\* "?' + name + '"? \\*/ = \\{\\s*isa = PBXNativeTarget;'));
  return m && m[1];
};
const TARGETS = ['App', 'FlowWidget', 'FlowWatch', 'FlowComplications', 'TheFlowMac'];
TARGETS.forEach((t) => ok('target ' + t, !!targetId(t)));
ok('nothing of Capacitor or CocoaPods is left in it',
   !/Pods|COCOAPODS|config\.xml|Main\.storyboard/.test(pbx));

console.log('\n— the copies the iOS targets compile are the files in native/ —');
/* The same list ci_post_clone.sh refreshes on Xcode Cloud. Here it has to
   already be true, so that what Xcode on a Mac opens is what Xcode Cloud
   builds. */
const COPIES = [
  ...fs.readdirSync(path.join(IOS, 'native', 'App')).filter((f) => f.endsWith('.swift')).map((f) => ['native/App/' + f, 'App/' + f]),
  ['native/Shared/FlowStore.swift', 'App/FlowStore.swift'],
  ['native/Widget/FlowWidget.swift', 'FlowWidget/FlowWidget.swift'],
  ['native/Shared/FlowStore.swift', 'FlowWidget/FlowStore.swift'],
  ['native/Watch/FlowWatchApp.swift', 'FlowWatch/FlowWatchApp.swift'],
  ['native/Watch/WatchStore.swift', 'FlowWatch/WatchStore.swift'],
  ['native/WatchWidget/FlowComplications.swift', 'FlowComplications/FlowComplications.swift'],
];
const stale = COPIES.filter(([from, to]) => {
  try { return read(IOS, from) !== read(PROJ, to); } catch (e) { return true; }
}).map(([from]) => from);
ok('every copied Swift file matches its source (else: cd ios-app && npm run native / widget / watch)', !stale.length, stale);
const post = fs.existsSync(path.join(IOS, 'scripts', 'ci_scripts', 'ci_post_clone.sh'))
  ? read(IOS, 'scripts', 'ci_scripts', 'ci_post_clone.sh') : '';
/* Named in the script outright, or covered by a glob over its folder. */
const covered = (from) => post.indexOf(from) > -1 || post.indexOf(path.dirname(from) + '/*.swift') > -1;
const uncopied = COPIES.map(([from]) => from).filter((f) => !covered(f));
ok('and ci_post_clone.sh refreshes each of them on Xcode Cloud', !!post && !uncopied.length, uncopied);

console.log('\n— the Mac target builds mac-app/native where it lives —');
const macSwift = fs.readdirSync(path.join(ROOT, 'mac-app', 'native')).filter((f) => f.endsWith('.swift'));
const unreferenced = macSwift.filter((f) => pbx.indexOf('path = "../../../mac-app/native/' + f + '"') < 0);
ok('every Swift file in mac-app/native is in the project', !unreferenced.length, unreferenced);
ok('it is a macOS target', /SDKROOT = macosx;/.test(pbx) && /SUPPORTED_PLATFORMS = macosx;/.test(pbx));
ok('with the same bundle id as the iPhone app (universal purchase)',
   (pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = "?com\.abko\.theflow"?;/g) || []).length >= 4);
ok('its Info.plist and entitlements are the committed ones under mac-app/xcode',
   /INFOPLIST_FILE = "\.\.\/\.\.\/\.\.\/mac-app\/xcode\/Info\.plist";/.test(pbx)
   && /CODE_SIGN_ENTITLEMENTS = "\.\.\/\.\.\/\.\.\/mac-app\/xcode\/TheFlow\.entitlements";/.test(pbx)
   && fs.existsSync(path.join(ROOT, 'mac-app', 'xcode', 'Info.plist'))
   && fs.existsSync(path.join(ROOT, 'mac-app', 'xcode', 'TheFlow.entitlements')));
ok('and the icon build.sh ships', /path = "\.\.\/\.\.\/\.\.\/mac-app\/Resources\/AppIcon\.icns"/.test(pbx)
   && fs.existsSync(path.join(ROOT, 'mac-app', 'Resources', 'AppIcon.icns')));
ok('the product is "The Flow.app", not the target name', /path = "The Flow\.app";/.test(pbx));
const macConfigs = [...pbx.matchAll(/buildSettings = \{\n([\s\S]*?)\n\t\t\t\};/g)].map((m) => m[1]).filter((b) => /SDKROOT = macosx;/.test(b));
ok('it is installed into the archive (an app with SKIP_INSTALL is a "Generic Xcode Archive")',
   macConfigs.length === 2 && macConfigs.every((b) => !/SKIP_INSTALL/.test(b)), macConfigs.length);
ok('Swift 5 language mode, as build.sh pins it', (pbx.match(/SWIFT_VERSION = 5\.0;/g) || []).length >= 2);

console.log('\n— the schemes Xcode Cloud can see —');
const SCHEMES = path.join(PROJ, 'App.xcodeproj', 'xcshareddata', 'xcschemes');
[['App', 'App.app'], ['TheFlowMac', 'The Flow.app']].forEach(([name, product]) => {
  const p = path.join(SCHEMES, name + '.xcscheme');
  const s = fs.existsSync(p) ? read(p) : '';
  ok('shared scheme ' + name + ' exists', !!s);
  ok('  it points at the ' + name + ' target in this project',
     s.indexOf('BlueprintIdentifier = "' + targetId(name) + '"') > -1 && s.indexOf('BuildableName = "' + product + '"') > -1);
  ok('  and archives Release', /<ArchiveAction[^>]*buildConfiguration = "Release"/.test(s));
});

console.log('\n— the Xcode Cloud scripts —');
['ci_post_clone.sh', 'ci_pre_xcodebuild.sh'].forEach((f) => {
  const src = path.join(IOS, 'scripts', 'ci_scripts', f);
  const dst = path.join(PROJ, 'ci_scripts', f);
  ok(f + ' is beside the project, identical to scripts/ci_scripts/',
     fs.existsSync(src) && fs.existsSync(dst) && read(src) === read(dst));
  ok('  and executable', fs.existsSync(dst) && (fs.statSync(dst).mode & 0o111) !== 0);
  ok('  and refuses to run anywhere but Xcode Cloud', fs.existsSync(dst) && /CI_PRIMARY_REPOSITORY_PATH:\?/.test(read(dst)));
});
const pre = fs.existsSync(path.join(PROJ, 'ci_scripts', 'ci_pre_xcodebuild.sh')) ? read(PROJ, 'ci_scripts', 'ci_pre_xcodebuild.sh') : '';
ok('the build number is Xcode Cloud\'s count, offset past the hand-made builds',
   /100 \+ \$\{CI_BUILD_NUMBER/.test(pre) && /CURRENT_PROJECT_VERSION = \[0-9\]/.test(pre));
ok('the version is read from version.json, not typed into the script',
   /version\.json/.test(pre) && /MARKETING_VERSION = \[0-9\.\]\*;/.test(pre));

console.log('\n— one version, everywhere —');
const vj = JSON.parse(read(IOS, 'version.json'));
const versions = [...new Set((pbx.match(/MARKETING_VERSION = [\d.]+;/g) || []))];
const builds = [...new Set((pbx.match(/CURRENT_PROJECT_VERSION = \d+;/g) || []))];
ok('every target carries version.json\'s version (' + vj.version + ')',
   versions.length === 1 && versions[0] === 'MARKETING_VERSION = ' + vj.version + ';', versions);
ok('and its build (' + vj.build + ')',
   builds.length === 1 && builds[0] === 'CURRENT_PROJECT_VERSION = ' + vj.build + ';', builds);
ok('the generator sequence in package.json ends with the Mac target and the Cloud files',
   /add-mac-target\.js && node scripts\/make-cloud\.js"/.test(read(IOS, 'package.json')));

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
