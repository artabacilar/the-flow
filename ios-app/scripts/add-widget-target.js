/* Add the FlowWidget extension target to the generated Capacitor project.
 *
 * Xcode's New Target wizard does this in a dialog. Doing it here instead means
 * the one genuinely fiddly step — the one where a mistyped App Group leaves a
 * widget that says "Not connected" forever and reports no error at all — is
 * made by something that cannot mistype it.
 *
 * If this ever produces a project Xcode refuses to open, the untouched original
 * is kept beside it as project.pbxproj.original: restore that and use the
 * wizard. */
const fs = require('fs');
const path = require('path');
const xcode = require('xcode');

const BUNDLE = 'com.abko.theflow';
const GROUP  = 'group.' + BUNDLE;
const WIDGET = 'FlowWidget';
const WIDGET_BUNDLE = BUNDLE + '.' + WIDGET;

const projDir  = path.join(__dirname, '..', 'ios', 'App');
const pbxPath  = path.join(projDir, 'App.xcodeproj', 'project.pbxproj');

fs.copyFileSync(pbxPath, pbxPath + '.original');

const proj = xcode.project(pbxPath).parseSync();

/* ---- 1. the widget's own files -------------------------------------------
   Written next to the project rather than inside App/, so the two targets do
   not quietly share a folder and drift into sharing membership. */
const wdir = path.join(projDir, WIDGET);
fs.mkdirSync(wdir, { recursive: true });

fs.copyFileSync(path.join(__dirname, '..', 'native', 'Widget', 'FlowWidget.swift'),
                path.join(wdir, 'FlowWidget.swift'));
/* FlowStore is the seam; both targets compile it. One source, two copies, two
   memberships. The App target's copy and its membership are make-native.js's
   job — this script only ever touches the widget side of the seam. */

const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.application-groups</key>
\t<array>
\t\t<string>${GROUP}</string>
\t</array>
</dict>
</plist>
`;
fs.writeFileSync(path.join(projDir, 'App', 'App.entitlements'), entitlements);
fs.writeFileSync(path.join(wdir, WIDGET + '.entitlements'), entitlements);

/* The extension point is what makes iOS treat this bundle as a widget rather
   than as an app that happens to contain one. */
fs.writeFileSync(path.join(wdir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>The Flow</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
\t<key>CFBundlePackageType</key>
\t<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
\t<key>CFBundleShortVersionString</key>
\t<string>1.0</string>
\t<key>CFBundleVersion</key>
\t<string>1</string>
\t<key>NSExtension</key>
\t<dict>
\t\t<key>NSExtensionPointIdentifier</key>
\t\t<string>com.apple.widgetkit-extension</string>
\t</dict>
</dict>
</plist>
`);

/* ---- 2. the target ------------------------------------------------------- */
const target = proj.addTarget(WIDGET, 'app_extension', WIDGET, WIDGET_BUNDLE);

/* addTarget gives a target with no phases at all; a target that compiles
   nothing builds green and ships an empty widget, which is the worst kind of
   pass. */
proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

const wgroup = proj.pbxCreateGroup(WIDGET, WIDGET);
const mainGroupId = proj.getFirstProject().firstProject.mainGroup;
proj.addToPbxGroup(wgroup, mainGroupId);

proj.addSourceFile(WIDGET + '/FlowWidget.swift', { target: target.uuid }, wgroup);
proj.addSourceFile(WIDGET + '/FlowStore.swift',  { target: target.uuid }, wgroup);
fs.copyFileSync(path.join(__dirname, '..', 'native', 'Shared', 'FlowStore.swift'),
                path.join(wdir, 'FlowStore.swift'));

const appTarget = (() => {
  const t = proj.pbxNativeTargetSection();
  for (const k in t) if (typeof t[k] === 'object' && t[k].name === 'App') return k;
  throw new Error('no App target');
})();

/* ---- 3. build settings --------------------------------------------------- */
const configs = proj.pbxXCBuildConfigurationSection();
const lists   = proj.pbxXCConfigurationList();

function settingsFor(targetUuid) {
  const t = proj.pbxNativeTargetSection()[targetUuid];
  const list = lists[t.buildConfigurationList];
  return list.buildConfigurations.map(c => configs[c.value].buildSettings);
}

settingsFor(target.uuid).forEach(s => {
  s.PRODUCT_BUNDLE_IDENTIFIER = WIDGET_BUNDLE;
  s.PRODUCT_NAME = '"$(TARGET_NAME)"';
  s.INFOPLIST_FILE = WIDGET + '/Info.plist';
  s.CODE_SIGN_ENTITLEMENTS = WIDGET + '/' + WIDGET + '.entitlements';
  s.CODE_SIGN_STYLE = 'Automatic';
  /* containerBackground(for:) is iOS 17. The app itself still targets 13 so
     that Capacitor is happy; an extension may ask for more than its host. */
  s.IPHONEOS_DEPLOYMENT_TARGET = '17.0';
  s.SWIFT_VERSION = '5.0';
  s.TARGETED_DEVICE_FAMILY = '"1,2"';
  s.SKIP_INSTALL = 'YES';
  s.GENERATE_INFOPLIST_FILE = 'NO';
  s.MARKETING_VERSION = '1.0';
  s.CURRENT_PROJECT_VERSION = '1';
  s.SWIFT_EMIT_LOC_STRINGS = 'YES';
  s.ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = 'AccentColor';
});

settingsFor(appTarget).forEach(s => {
  s.CODE_SIGN_ENTITLEMENTS = 'App/App.entitlements';
});

/* ---- 4. embed it, so the app actually ships the widget ------------------- */
const embedPhase = proj.addBuildPhase(
  [], 'PBXCopyFilesBuildPhase', 'Embed Foundation Extensions', appTarget, 'app_extension'
);
const productFile = proj.pbxFileReferenceSection();
let widgetProduct = null;
for (const k in productFile) {
  const f = productFile[k];
  if (f && f.path && String(f.path).replace(/"/g, '') === WIDGET + '.appex') { widgetProduct = k; break; }
}
if (!widgetProduct) throw new Error('widget product reference not found');

const buildFileUuid = proj.generateUuid();
proj.hash.project.objects.PBXBuildFile[buildFileUuid] = {
  isa: 'PBXBuildFile',
  fileRef: widgetProduct,
  fileRef_comment: WIDGET + '.appex',
  settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] }
};
proj.hash.project.objects.PBXBuildFile[buildFileUuid + '_comment'] =
  WIDGET + '.appex in Embed Foundation Extensions';
embedPhase.buildPhase.files.push({ value: buildFileUuid, comment: WIDGET + '.appex in Embed Foundation Extensions' });

/* And build it first, or the copy phase copies something that is not there.
   addTargetDependency does not wire this up on a target it did not create, so
   the proxy and the dependency are written the way Xcode writes them. */
const objects = proj.hash.project.objects;
objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};
objects.PBXTargetDependency  = objects.PBXTargetDependency  || {};

const proxyUuid = proj.generateUuid();
objects.PBXContainerItemProxy[proxyUuid] = {
  isa: 'PBXContainerItemProxy',
  containerPortal: proj.hash.project.rootObject,
  containerPortal_comment: 'Project object',
  proxyType: 1,
  remoteGlobalIDString: target.uuid,
  remoteInfo: WIDGET
};
objects.PBXContainerItemProxy[proxyUuid + '_comment'] = 'PBXContainerItemProxy';

const depUuid = proj.generateUuid();
objects.PBXTargetDependency[depUuid] = {
  isa: 'PBXTargetDependency',
  target: target.uuid,
  target_comment: WIDGET,
  targetProxy: proxyUuid,
  targetProxy_comment: 'PBXContainerItemProxy'
};
objects.PBXTargetDependency[depUuid + '_comment'] = 'PBXTargetDependency';

const appNative = proj.pbxNativeTargetSection()[appTarget];
appNative.dependencies = appNative.dependencies || [];
appNative.dependencies.push({ value: depUuid, comment: 'PBXTargetDependency' });

/* Xcode also records each target in the project's attributes; without it the
   new target has no provisioning style and signing silently falls back. */
const rootObj = objects.PBXProject[proj.hash.project.rootObject];
rootObj.attributes = rootObj.attributes || {};
rootObj.attributes.TargetAttributes = rootObj.attributes.TargetAttributes || {};
rootObj.attributes.TargetAttributes[target.uuid] = { CreatedOnToolsVersion: '15.0' };

fs.writeFileSync(pbxPath, proj.writeSync());
console.log('ok: ' + WIDGET + ' -> ' + WIDGET_BUNDLE + ', group ' + GROUP);
