#!/usr/bin/env node
/* Add the Mac app as a macOS target of the same Xcode project.
 *
 * Why it lives here and not in mac-app/
 * -------------------------------------
 * mac-app/build.sh builds the Mac shell with nothing but the Command Line
 * Tools, and that stays the way to build it on a Mac you are sitting at. But
 * the store route — Xcode Cloud archiving it and TestFlight installing it on
 * every Mac that is signed in — needs an Xcode project and a shared scheme,
 * and it needs them in the repository. The iOS project already exists for
 * exactly that reason, so the Mac app becomes one more target in it: one
 * project, one App Store record (same bundle id on both platforms is what
 * Apple calls universal purchase), two schemes.
 *
 * Nothing is copied. The target references mac-app/native/*.swift, the icon
 * and the two files under mac-app/xcode/ where they live, so a change to the
 * Mac shell is picked up by the next Xcode Cloud build with no step to forget.
 * (The iOS targets copy their sources in; ci_scripts/ci_post_clone.sh
 * refreshes those copies on Xcode Cloud for the same reason.)
 *
 * Run after add-widget-target.js. Safe to run twice: a second run finds the
 * target and leaves it alone — the files are references, so there is nothing
 * to refresh. */
const fs = require('fs');
const path = require('path');
const xcode = require('xcode');

const TARGET  = 'TheFlowMac';           /* the target and scheme name */
const PRODUCT = 'The Flow';             /* The Flow.app, as build.sh names it */
const BUNDLE  = 'com.abko.theflow';     /* the iOS id: universal purchase */
const MIN_OS  = '13.0';                 /* build.sh: MIN_OS */

/** Same file as make-native.js — one place the version is written. */
const { version: VERSION, build: BUILD } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));

/** Same source as make-native.js: identity lives in capacitor.config.json. */
const TEAM = (() => {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'capacitor.config.json'), 'utf8'));
    return (cfg.ios || {}).developmentTeam || '';
  } catch (e) { return ''; }
})();

const projDir = path.join(__dirname, '..', 'ios', 'App');
const pbxPath = path.join(projDir, 'App.xcodeproj', 'project.pbxproj');
const MAC     = path.join(__dirname, '..', '..', 'mac-app');   /* on disk */
const REL     = '../../../mac-app';                            /* from the project folder */

if (!fs.existsSync(pbxPath)) {
  console.error('No project at ' + pbxPath + ' — run `npm run setup` first.');
  process.exit(1);
}
for (const must of ['native/main.swift', 'Resources/AppIcon.icns', 'xcode/Info.plist', 'xcode/TheFlow.entitlements']) {
  if (!fs.existsSync(path.join(MAC, must))) {
    console.error('mac-app/' + must + ' is missing');
    process.exit(1);
  }
}

const proj = xcode.project(pbxPath).parseSync();
const objects = proj.hash.project.objects;

/* ---- 1. stop if it is already there (see add-widget-target.js for why a
 *         second target is worse than no target) ---------------------------- */
const existing = (() => {
  const t = proj.pbxNativeTargetSection();
  for (const k in t) {
    if (k.endsWith('_comment')) continue;
    if (t[k] && String(t[k].name).replace(/"/g, '') === TARGET) return k;
  }
  return null;
})();
if (existing) {
  console.log('ok: ' + TARGET + ' target is already in this project — its files are');
  console.log('    referenced where they live, so there is nothing to refresh.');
  process.exit(0);
}

/* ---- 2. the target --------------------------------------------------------- */
const target = proj.addTarget(TARGET, 'application', TARGET, BUNDLE);

/* addTarget names the product after the target (TheFlowMac.app). The app is
   "The Flow.app" — PRODUCT_NAME below says so — and the reference under
   Products has to agree, or Xcode draws it in red and the scheme points at a
   name that is never built. It also leaves a build file for the product "in
   Copy Files" that no phase uses; gone, so nobody wonders what copies it. */
const productRef = proj.pbxNativeTargetSection()[target.uuid].productReference;
{
  const pf = objects.PBXFileReference[productRef];
  pf.name = '"' + PRODUCT + '.app"';
  pf.path = '"' + PRODUCT + '.app"';
  objects.PBXFileReference[productRef + '_comment'] = PRODUCT + '.app';
  proj.pbxNativeTargetSection()[target.uuid].productName = '"' + PRODUCT + '"';
  Object.keys(objects.PBXGroup).filter((k) => !k.endsWith('_comment')).forEach((k) => {
    (objects.PBXGroup[k].children || []).forEach((c) => { if (c.value === productRef) c.comment = PRODUCT + '.app'; });
  });
  Object.keys(objects.PBXBuildFile)
    .filter((k) => !k.endsWith('_comment') && objects.PBXBuildFile[k].fileRef === productRef)
    .forEach((k) => { delete objects.PBXBuildFile[k]; delete objects.PBXBuildFile[k + '_comment']; });
}

/* addTarget also makes the first target in the project (App, the iPhone
   app) depend on the new one. For an extension that is the point; for the
   Mac app it put "The Flow.app" into every iOS archive beside App.app, and an
   archive with two apps in it is a Generic Xcode Archive — Xcode Cloud then
   finds no way to send it anywhere ("expected one {} but found app-store").
   The Mac app has its own scheme; nothing should build it for the iPhone. */
{
  const deps = objects.PBXTargetDependency || {};
  const mine = Object.keys(deps).filter((k) => !k.endsWith('_comment') && deps[k].target === target.uuid);
  const nt = proj.pbxNativeTargetSection();
  Object.keys(nt).filter((k) => !k.endsWith('_comment')).forEach((k) => {
    if (nt[k].dependencies) nt[k].dependencies = nt[k].dependencies.filter((d) => mine.indexOf(d.value) < 0);
  });
  mine.forEach((k) => {
    const proxy = deps[k].targetProxy;
    delete deps[k]; delete deps[k + '_comment'];
    if (objects.PBXContainerItemProxy) { delete objects.PBXContainerItemProxy[proxy]; delete objects.PBXContainerItemProxy[proxy + '_comment']; }
  });
}

proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
const resources = proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

const group = proj.pbxCreateGroup(TARGET, TARGET);
proj.addToPbxGroup(group, proj.getFirstProject().firstProject.mainGroup);
/* A label in the navigator, not a folder: every path below is written in
   full, from the project folder. */
delete objects.PBXGroup[group].path;

/* Every Swift file in mac-app/native, taken from the folder so a file added
   there later is not left out of the build. */
const swift = fs.readdirSync(path.join(MAC, 'native')).filter((f) => f.endsWith('.swift')).sort();
swift.forEach((f) => proj.addSourceFile(REL + '/native/' + f, { target: target.uuid }, group));

/* The icon, as the one resource — written by hand because node-xcode's
   addResourceFile expects a "Resources" group this project does not have. */
{
  const fileRef = proj.generateUuid();
  const buildFile = proj.generateUuid();
  objects.PBXFileReference[fileRef] = {
    isa: 'PBXFileReference',
    lastKnownFileType: 'image.icns',
    name: 'AppIcon.icns',
    path: '"' + REL + '/Resources/AppIcon.icns"',
    sourceTree: '"<group>"',
  };
  objects.PBXFileReference[fileRef + '_comment'] = 'AppIcon.icns';
  objects.PBXBuildFile[buildFile] = { isa: 'PBXBuildFile', fileRef, fileRef_comment: 'AppIcon.icns' };
  objects.PBXBuildFile[buildFile + '_comment'] = 'AppIcon.icns in Resources';
  resources.buildPhase.files.push({ value: buildFile, comment: 'AppIcon.icns in Resources' });
  objects.PBXGroup[group].children.push({ value: fileRef, comment: 'AppIcon.icns' });
}

/* ---- 3. build settings ----------------------------------------------------- */
const configs = proj.pbxXCBuildConfigurationSection();
const lists   = proj.pbxXCConfigurationList();
const list    = lists[proj.pbxNativeTargetSection()[target.uuid].buildConfigurationList];

list.buildConfigurations.map((c) => configs[c.value].buildSettings).forEach((s) => {
  s.PRODUCT_BUNDLE_IDENTIFIER = BUNDLE;
  s.PRODUCT_NAME = '"' + PRODUCT + '"';
  /* The project's own settings are iOS all the way down — SDKROOT iphoneos,
     an iPhone signing identity. Each one is answered here for this target. */
  s.SDKROOT = 'macosx';
  s.SUPPORTED_PLATFORMS = 'macosx';
  s.MACOSX_DEPLOYMENT_TARGET = MIN_OS;
  s.CODE_SIGN_IDENTITY = '"Apple Development"';
  s.CODE_SIGN_STYLE = 'Automatic';
  if (TEAM) s.DEVELOPMENT_TEAM = TEAM;
  s.INFOPLIST_FILE = '"' + REL + '/xcode/Info.plist"';
  s.GENERATE_INFOPLIST_FILE = 'NO';
  s.CODE_SIGN_ENTITLEMENTS = '"' + REL + '/xcode/TheFlow.entitlements"';
  /* Swift 5 language mode, as build.sh pins it: Swift 6 mode turns the WebKit
     callbacks into strict-concurrency errors. */
  s.SWIFT_VERSION = '5.0';
  s.MARKETING_VERSION = VERSION;
  s.CURRENT_PROJECT_VERSION = BUILD;
  s.ENABLE_HARDENED_RUNTIME = 'YES';
  s.COMBINE_HIDPI_IMAGES = 'YES';
  s.LD_RUNPATH_SEARCH_PATHS = '"$(inherited) @executable_path/../Frameworks"';
  /* addTarget writes SKIP_INSTALL = YES, which is right for an extension and
     fatal for an app: the archive comes out with no app in it ("Generic Xcode
     Archive") and cannot be uploaded. */
  delete s.SKIP_INSTALL;
  delete s.IPHONEOS_DEPLOYMENT_TARGET;
  delete s.TARGETED_DEVICE_FAMILY;
});

/* Xcode records each target in the project's attributes; without it the new
   target has no provisioning style and signing silently falls back. */
const rootObj = objects.PBXProject[proj.hash.project.rootObject];
rootObj.attributes = rootObj.attributes || {};
rootObj.attributes.TargetAttributes = rootObj.attributes.TargetAttributes || {};
rootObj.attributes.TargetAttributes[target.uuid] = { CreatedOnToolsVersion: '15.0' };

/* node-xcode writes a property it never set as the word `undefined`
   (fileEncoding = undefined;). Xcode shrugs at it — the widget shipped that
   way — but a project file should not say things it does not mean. */
const scrub = (o) => Object.keys(o).forEach((k) => { if (o[k] === undefined || o[k] === 'undefined') delete o[k]; });
scrub(objects.PBXFileReference[productRef]);
Object.keys(objects.PBXFileReference).filter((k) => !k.endsWith('_comment'))
  .filter((k) => String(objects.PBXFileReference[k].path || '').indexOf(REL + '/') >= 0)
  .forEach((k) => scrub(objects.PBXFileReference[k]));

fs.writeFileSync(pbxPath, proj.writeSync());

/* ---- 4. does every file the target names exist? ----------------------------
   Relative paths that climb out of the project folder are exactly the kind
   that write cleanly and turn red in Xcode. */
const check = xcode.project(pbxPath).parseSync();
const refs = check.hash.project.objects.PBXFileReference;
const clean = (v) => String(v || '').replace(/"/g, '');
const missing = Object.keys(refs)
  .filter((k) => !k.endsWith('_comment'))
  .map((k) => clean(refs[k].path))
  .filter((p) => p.indexOf(REL + '/') === 0)
  .filter((p) => !fs.existsSync(path.join(projDir, p)));
if (missing.length) {
  console.error('the target names files that are not there:\n  ' + missing.join('\n  '));
  process.exit(1);
}

const named = Object.keys(refs).filter((k) => !k.endsWith('_comment'))
  .map((k) => clean(refs[k].path)).filter((p) => p.indexOf(REL + '/native/') === 0).length;
if (named !== swift.length) {
  console.error('expected ' + swift.length + ' Swift files in the target, found ' + named);
  process.exit(1);
}

console.log('ok: ' + TARGET + ' -> ' + BUNDLE + ' (macOS ' + MIN_OS + '+, ' + VERSION + ' (' + BUILD + ')' +
  (TEAM ? ', team ' + TEAM : '') + ')');
console.log('ok: ' + swift.length + ' sources and the icon referenced in mac-app/, not copied');
