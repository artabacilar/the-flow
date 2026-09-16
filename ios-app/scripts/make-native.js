#!/usr/bin/env node
/**
 * Turn the Capacitor-generated iOS project into a plain native one.
 *
 * Why this exists
 * ---------------
 * Capacitor gives us a correct Xcode project in one command — targets, asset
 * catalogue, launch screen, signing scaffolding — and then makes it depend on
 * CocoaPods. `pod install` needs a shell on a Mac. That is one more thing that
 * has to be true on the machine doing the build, and the machine doing the
 * build is not always the machine with a Ruby toolchain on it.
 *
 * The only thing the CocoaPods half was buying us was `CAPPlugin`, so that the
 * web app could call a native method. That is a `WKScriptMessageHandler` and
 * about twenty lines of injected JavaScript — see FlowViewController.swift. The
 * web app's call site does not change: it still asks for
 * `window.Capacitor.Plugins.FlowBridge`, and the shim answers to that name.
 *
 * So: keep the scaffolding, drop the dependency. What comes out opens in Xcode
 * and builds with nothing to resolve, install, or check into the repo.
 *
 * Run after `npx cap add ios`, before `add-widget-target.js`.
 */

const fs = require('fs');
const path = require('path');
const xcode = require('xcode');

const root = path.resolve(__dirname, '..');
const iosDir = path.join(root, 'ios');
const appDir = path.join(iosDir, 'App');
const srcDir = path.join(appDir, 'App');
const pbxPath = path.join(appDir, 'App.xcodeproj', 'project.pbxproj');

/** Kept in one place because the widget target has to agree with it. */
const DEPLOYMENT_TARGET = '17.0';

/** Optional. Present, both targets sign automatically against it; absent,
 *  Xcode asks — which is the old behaviour, not a failure. */
const TEAM = (() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
    return (cfg.ios || {}).developmentTeam || '';
  } catch (e) { return ''; }
})();

if (!fs.existsSync(pbxPath)) {
  console.error('No project at ' + pbxPath + ' — run `npx cap add ios` first.');
  process.exit(1);
}

/* ---- 1 · the files the shell no longer has ------------------------------- */

/** Capacitor's own baggage: a bundled web app we never load (the page lives on
 *  the server), a Cordova compatibility shim, and the Pods integration. */
const DEAD_PATHS = [
  path.join(appDir, 'Podfile'),
  path.join(appDir, 'App.xcworkspace'),
  path.join(iosDir, 'capacitor-cordova-ios-plugins'),
  path.join(srcDir, 'public'),
  path.join(srcDir, 'config.xml'),
  path.join(srcDir, 'capacitor.config.json'),
  path.join(srcDir, 'Base.lproj', 'Main.storyboard'),
  path.join(srcDir, 'FlowBridge.swift'),
  path.join(srcDir, 'FlowBridge.m'),
];

for (const p of DEAD_PATHS) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

/* ---- 2 · the sources that replace them ---------------------------------- */

const COPY = [
  ['native/App/AppDelegate.swift', 'AppDelegate.swift'],
  ['native/App/FlowViewController.swift', 'FlowViewController.swift'],
  ['native/Shared/FlowStore.swift', 'FlowStore.swift'],
  ['native/App/FlowSpeech.swift', 'FlowSpeech.swift'],
  ['native/App/FlowHealth.swift', 'FlowHealth.swift'],
];

for (const [from, to] of COPY) {
  fs.copyFileSync(path.join(root, from), path.join(srcDir, to));
}

/* ---- 3 · the project file ----------------------------------------------- */

const proj = xcode.project(pbxPath).parseSync();
const objects = proj.hash.project.objects;

const section = (name) => objects[name] || {};
const real = (obj) => Object.keys(obj).filter((k) => !k.endsWith('_comment'));

/** node-xcode keeps a parallel `<uuid>_comment` key for readability. Removing
 *  one without the other leaves a comment pointing at nothing, which Xcode
 *  tolerates and a human reading the diff does not. */
function drop(sectionName, uuid) {
  const s = objects[sectionName];
  if (!s) return;
  delete s[uuid];
  delete s[uuid + '_comment'];
}

/** Find UUIDs in a section whose entry matches a predicate. */
function find(sectionName, test) {
  const s = section(sectionName);
  return real(s).filter((u) => {
    try { return test(s[u], u); } catch (e) { return false; }
  });
}

const doomed = new Set();

/* The Pods framework, its two xcconfigs, and the leftovers of the web bundle
 * and the storyboard we no longer load. Matched by name so this keeps working
 * if Capacitor reshuffles its UUIDs. */
const DEAD_REFS = [
  'Pods_App.framework',
  'Pods-App.debug.xcconfig',
  'Pods-App.release.xcconfig',
  'config.xml',
  'capacitor.config.json',
  'public',
  'FlowBridge.swift',
  'FlowBridge.m',
];

/* A file reference may be identified by `name`, by `path`, or by a `path` that
 * is a whole directory deep — CocoaPods' xcconfigs are all three at once — so
 * match on the last segment of either. */
find('PBXFileReference', (o) => {
  const strip = (v) => String(v || '').replace(/^"|"$/g, '').split('/').pop();
  return DEAD_REFS.indexOf(strip(o.name)) >= 0 || DEAD_REFS.indexOf(strip(o.path)) >= 0;
}).forEach((u) => doomed.add(u));

/* Main.storyboard hides behind a variant group: the group is named
 * "Main.storyboard" and the file reference inside it is named "Base". */
find('PBXVariantGroup', (o) => /Main\.storyboard/.test(String(o.name || ''))).forEach((u) => {
  doomed.add(u);
  (section('PBXVariantGroup')[u].children || []).forEach((c) => doomed.add(c.value));
});
find('PBXFileReference', (o) => /Base\.lproj\/Main\.storyboard/.test(String(o.path || '')))
  .forEach((u) => doomed.add(u));

/* Every build file that points at something already doomed goes too. */
find('PBXBuildFile', (o) => doomed.has(o.fileRef)).forEach((u) => doomed.add(u));

/* CocoaPods' two script phases. They are the ones that fail loudly when there
 * is no Pods directory, which is exactly the failure this script removes. */
find('PBXShellScriptBuildPhase', (o) => /\[CP\]/.test(String(o.name || ''))).forEach((u) =>
  doomed.add(u)
);

/* The "Pods" group in the navigator. */
find('PBXGroup', (o) => String(o.name || '').replace(/"/g, '') === 'Pods').forEach((u) =>
  doomed.add(u)
);

/* Remove the objects themselves. */
['PBXBuildFile', 'PBXFileReference', 'PBXGroup', 'PBXVariantGroup', 'PBXShellScriptBuildPhase']
  .forEach((s) => doomed.forEach((u) => drop(s, u)));

/* Remove every reference to them: group children, build-phase file lists,
 * and target build-phase lists. */
const prune = (list) => (list || []).filter((e) => !doomed.has(e.value));

['PBXGroup', 'PBXVariantGroup'].forEach((s) => {
  real(section(s)).forEach((u) => {
    section(s)[u].children = prune(section(s)[u].children);
  });
});

['PBXSourcesBuildPhase', 'PBXResourcesBuildPhase', 'PBXFrameworksBuildPhase', 'PBXCopyFilesBuildPhase']
  .forEach((s) => {
    real(section(s)).forEach((u) => {
      section(s)[u].files = prune(section(s)[u].files);
    });
  });

real(section('PBXNativeTarget')).forEach((u) => {
  section('PBXNativeTarget')[u].buildPhases = prune(section('PBXNativeTarget')[u].buildPhases);
});

/* The build settings CocoaPods wrote into the App target. Without the xcconfig
 * there is nothing to inherit from, and -DCOCOAPODS would be a lie. */
real(section('XCBuildConfiguration')).forEach((u) => {
  const cfg = section('XCBuildConfiguration')[u];
  if (cfg.baseConfigurationReference) {
    delete cfg.baseConfigurationReference;
    delete cfg.baseConfigurationReference_comment;
  }
  const s = cfg.buildSettings || {};
  if (s.OTHER_SWIFT_FLAGS && /COCOAPODS/.test(s.OTHER_SWIFT_FLAGS)) delete s.OTHER_SWIFT_FLAGS;
  if (s.LIBRARY_SEARCH_PATHS && /Pods/.test(String(s.LIBRARY_SEARCH_PATHS))) {
    delete s.LIBRARY_SEARCH_PATHS;
  }

  /* Capacitor's template still says iOS 13, which predates WidgetKit — the app
   * cannot call `WidgetCenter` at all below 14, and a host app older than the
   * extension it embeds is a build failure rather than a warning. Both targets
   * sit at 17 so the widget can use `containerBackground` without a maze of
   * availability guards, and so there is only ever one number to change. */
  if (s.IPHONEOS_DEPLOYMENT_TARGET) s.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;

  /* Signing, written down rather than chosen from a menu. Picking a team by
   * hand is the step that has to be repeated on every machine, in every clone,
   * and forgotten once on the extension — which fails as "no profile for
   * com.abko.theflow.FlowWidget" long after the app itself is signing fine.
   * The id comes from capacitor.config.json so that identity lives in one
   * file; leave it out there and this does nothing, and the menu is still
   * waiting. */
  if (TEAM) {
    s.DEVELOPMENT_TEAM = TEAM;
    s.CODE_SIGN_STYLE = 'Automatic';
  }
});

/* ---- 4 · add what the shell now needs ----------------------------------- */

const appTarget = find('PBXNativeTarget', (o) => String(o.name).replace(/"/g, '') === 'App')[0];
if (!appTarget) throw new Error('Could not find the App target.');

const sourcesPhase = (section('PBXNativeTarget')[appTarget].buildPhases || [])
  .map((e) => e.value)
  .find((u) => section('PBXSourcesBuildPhase')[u]);
if (!sourcesPhase) throw new Error('The App target has no Sources phase.');

const appGroup = find('PBXGroup', (o) => String(o.name || o.path || '').replace(/"/g, '') === 'App')[0];

function addSource(fileName) {
  const already = find('PBXFileReference', (o) =>
    String(o.path || '').replace(/"/g, '') === fileName
  ).length;
  if (already) return false;

  const fileRef = proj.generateUuid();
  const buildFile = proj.generateUuid();

  objects.PBXFileReference[fileRef] = {
    isa: 'PBXFileReference',
    lastKnownFileType: 'sourcecode.swift',
    path: fileName,
    sourceTree: '"<group>"',
  };
  objects.PBXFileReference[fileRef + '_comment'] = fileName;

  objects.PBXBuildFile[buildFile] = { isa: 'PBXBuildFile', fileRef, fileRef_comment: fileName };
  objects.PBXBuildFile[buildFile + '_comment'] = fileName + ' in Sources';

  section('PBXSourcesBuildPhase')[sourcesPhase].files.push({
    value: buildFile,
    comment: fileName + ' in Sources',
  });
  if (appGroup) {
    section('PBXGroup')[appGroup].children.push({ value: fileRef, comment: fileName });
  }
  return true;
}

['FlowViewController.swift', 'FlowStore.swift', 'FlowSpeech.swift', 'FlowHealth.swift'].forEach(addSource);

fs.writeFileSync(pbxPath, proj.writeSync());

/* ---- 4b · the app icon --------------------------------------------------- *
 * Capacitor ships a placeholder icon, and a placeholder icon is a rejected
 * build. These are drawn by make-icons.js at 1024 with no alpha channel and
 * no corner rounding of their own, which is what App Store Connect and iOS
 * respectively insist on. Three appearances: normal, dark and tinted.        */

const iconSrc = path.join(root, 'native', 'Assets', 'AppIcon');
const iconDst = path.join(srcDir, 'Assets.xcassets', 'AppIcon.appiconset');

/* Generated, not committed — the generator needs nothing but Node, so the
   icons are cheaper to rebuild than to carry, and they can never drift from
   the script that describes them. */
if (!fs.existsSync(iconSrc)) {
  console.log('drawing the app icons...');
  require('child_process').execFileSync(
    process.execPath, [path.join(__dirname, 'make-icons.js')], { stdio: 'inherit' });
}

fs.mkdirSync(iconDst, { recursive: true });
/* Clear the placeholders out rather than leaving them beside ours — a stale
   AppIcon-512@2x.png that nothing references is the sort of thing that gets
   picked up by the next person to open the catalogue. */
for (const f of fs.readdirSync(iconDst)) fs.unlinkSync(path.join(iconDst, f));
for (const f of fs.readdirSync(iconSrc)) {
  fs.copyFileSync(path.join(iconSrc, f), path.join(iconDst, f));
}

/* ---- 5 · Info.plist ------------------------------------------------------ */

const plistPath = path.join(srcDir, 'Info.plist');
let plist = fs.readFileSync(plistPath, 'utf8');

/* No storyboard: AppDelegate builds the window itself, so leaving this key in
 * would make iOS look for a Main.storyboard that is no longer in the bundle. */
plist = plist.replace(/\s*<key>UIMainStoryboardFile<\/key>\s*<string>Main<\/string>/, '');

/* Capacitor's template still asks for armv7, which no shipping iPhone has had
 * since 2017 and which Xcode now warns about. */
plist = plist.replace('<string>armv7</string>', '<string>arm64</string>');

/* Dictation. Both keys are required and neither is optional in the way it
 * sounds: without NSMicrophoneUsageDescription the app is killed — not
 * refused, killed — the instant it touches the microphone, and without
 * NSSpeechRecognitionUsageDescription SFSpeechRecognizer does the same. The
 * strings are what the person reads in the system prompt, so they say what
 * the app does with it rather than asking for a capability by name. */
const USAGE = {
  NSMicrophoneUsageDescription:
    'The Flow uses the microphone so you can dictate journal entries and notes instead of typing them.',
  NSSpeechRecognitionUsageDescription:
    'Speech recognition turns what you dictate into text. On iPhones that support it this happens on the device.',
  NSHealthShareUsageDescription:
    'The Flow reads your sleep, heart rate variability, resting heart rate and workouts from Apple Health so your day is filled in without you typing it. It never writes anything back.',
  /* Required even though nothing is ever written.
   *
   * This key was deliberately left out, with a comment saying the app asks
   * for no write permission so the key does not belong. That reasoning is
   * sound and Apple does not accept it: an app carrying the HealthKit
   * entitlement must carry BOTH purpose strings, and App Store Connect
   * refuses the upload with error 90683 if either is missing. The refusal
   * happens at validation, long after the archive, and it names the key
   * rather than the rule — so the way you find out is by being turned away.
   *
   * The string still has to be true, and iOS will show it if anything ever
   * does ask to write. So it says what is actually the case. */
  NSHealthUpdateUsageDescription:
    'The Flow does not write anything to Apple Health. It only reads what your watch or ring has already recorded, and Apple requires this text to be present either way.',
};

for (const [key, text] of Object.entries(USAGE)) {
  /* Replace rather than append if it is already there, so re-running the
   * generator over an existing project updates the wording instead of
   * producing a plist with the key twice — which parses, and then uses
   * whichever one it reached first. */
  const existing = new RegExp('\\s*<key>' + key + '</key>\\s*<string>[\\s\\S]*?</string>');
  plist = plist.replace(existing, '');
  plist = plist.replace('</dict>\n</plist>',
    '\t<key>' + key + '</key>\n\t<string>' + text + '</string>\n</dict>\n</plist>');
}

fs.writeFileSync(plistPath, plist);

const WHY_REQUIRED = {
  NSMicrophoneUsageDescription: 'the app is killed the instant it touches the microphone',
  NSSpeechRecognitionUsageDescription: 'SFSpeechRecognizer kills the app on first use',
  NSHealthShareUsageDescription: 'reading Health would crash on first use',
  NSHealthUpdateUsageDescription: 'App Store Connect refuses the upload with error 90683'
};

for (const key of Object.keys(USAGE)) {
  if (plist.indexOf('<key>' + key + '</key>') < 0) {
    console.error('the Info.plist has no ' + key + ' — ' + (WHY_REQUIRED[key] || 'the build is not shippable'));
    process.exit(1);
  }
}

/* ---- 6 · say what happened ---------------------------------------------- */

const written = fs.readFileSync(pbxPath, 'utf8');
const leaks = ['Pods', 'COCOAPODS', 'Capacitor', 'config.xml', 'Main.storyboard']
  .filter((needle) => written.indexOf(needle) >= 0);

if (leaks.length) {
  console.error('still referenced in the project file: ' + leaks.join(', '));
  process.exit(1);
}

/* The icon is the one asset that cannot be checked by reading the project
   file, so check the bytes: 1024 square, and — the rule that actually trips
   people at upload — no alpha channel on the one that becomes the marketing
   icon. PNG colour type 6 and 4 carry alpha; 2 and 0 do not. */
const iconAny = path.join(iconDst, 'AppIcon-1024.png');
if (!fs.existsSync(iconAny)) {
  console.error('the app icon did not make it into the catalogue');
  process.exit(1);
}
const png = fs.readFileSync(iconAny);
const w = png.readUInt32BE(16), h = png.readUInt32BE(20), colourType = png[25];
if (w !== 1024 || h !== 1024) {
  console.error('the app icon is ' + w + '×' + h + ', and it has to be 1024×1024');
  process.exit(1);
}
if (colourType === 6 || colourType === 4) {
  console.error('the app icon carries an alpha channel — App Store Connect rejects that');
  process.exit(1);
}

console.log('ok: native shell — no CocoaPods, no Capacitor, nothing to resolve');
console.log('ok: app icon 1024×1024, no alpha, three appearances');
