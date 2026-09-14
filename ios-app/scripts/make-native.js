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

['FlowViewController.swift', 'FlowStore.swift'].forEach(addSource);

fs.writeFileSync(pbxPath, proj.writeSync());

/* ---- 5 · Info.plist ------------------------------------------------------ */

const plistPath = path.join(srcDir, 'Info.plist');
let plist = fs.readFileSync(plistPath, 'utf8');

/* No storyboard: AppDelegate builds the window itself, so leaving this key in
 * would make iOS look for a Main.storyboard that is no longer in the bundle. */
plist = plist.replace(/\s*<key>UIMainStoryboardFile<\/key>\s*<string>Main<\/string>/, '');

/* Capacitor's template still asks for armv7, which no shipping iPhone has had
 * since 2017 and which Xcode now warns about. */
plist = plist.replace('<string>armv7</string>', '<string>arm64</string>');

fs.writeFileSync(plistPath, plist);

/* ---- 6 · say what happened ---------------------------------------------- */

const written = fs.readFileSync(pbxPath, 'utf8');
const leaks = ['Pods', 'COCOAPODS', 'Capacitor', 'config.xml', 'Main.storyboard']
  .filter((needle) => written.indexOf(needle) >= 0);

if (leaks.length) {
  console.error('still referenced in the project file: ' + leaks.join(', '));
  process.exit(1);
}

console.log('ok: native shell — no CocoaPods, no Capacitor, nothing to resolve');
