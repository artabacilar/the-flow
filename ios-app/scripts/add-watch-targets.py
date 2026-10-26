#!/usr/bin/env python3
"""Add the Apple Watch app and its complications to the iOS Xcode project.

    python3 ios-app/scripts/add-watch-targets.py <path to App.xcodeproj/..>

Two targets, written straight into project.pbxproj:

  FlowWatch          watchOS app (single target, watchOS 9+), embedded in the
                     iOS app under Watch/, runs without the iPhone app.
  FlowComplications  WidgetKit extension for the watch face, embedded in
                     FlowWatch.

Its files are copied next to the project: FlowWatch/ (FlowWatchApp.swift,
WatchStore.swift, Assets.xcassets with the app icon, entitlements) and
FlowComplications/ (FlowComplications.swift, Info.plist, entitlements). The
complications compile FlowWatch/WatchStore.swift too — one file, two targets.

Safe to run twice: when FlowWatch is already a target it only refreshes the
copied files. The untouched project is kept beside it as
project.pbxproj.before-watch.
"""
import hashlib, json, os, re, shutil, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
NATIVE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'native')
PBX = os.path.join(ROOT, 'App.xcodeproj', 'project.pbxproj')
GROUP = 'group.com.abko.theflow'
BUNDLE = 'com.abko.theflow'

src = open(PBX, encoding='utf-8').read()

# ---- identity read from the project itself, so the watch matches the app ----
def first(pattern, default=''):
    m = re.search(pattern, src)
    return m.group(1) if m else default
TEAM = first(r'DEVELOPMENT_TEAM = (\w+);')
VERSION = first(r'MARKETING_VERSION = ([\d.]+);', '1.0')
BUILD = first(r'CURRENT_PROJECT_VERSION = (\d+);', '1')
APP_TARGET = first(r'(\w{24}) /\* App \*/ = \{\s*isa = PBXNativeTarget;')
PROJECT_OBJ = first(r'rootObject = (\w{24})')
MAIN_GROUP = first(r'mainGroup = (\w{24});')
PRODUCTS = first(r'productRefGroup = (\w{24})')
assert APP_TARGET and PROJECT_OBJ and MAIN_GROUP and PRODUCTS, 'not the project this script expects'

# ---- files on disk (always refreshed) ----
def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)

ENT = ('<?xml version="1.0" encoding="UTF-8"?>\n'
       '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
       '<plist version="1.0">\n<dict>\n\t<key>com.apple.security.application-groups</key>\n'
       '\t<array>\n\t\t<string>' + GROUP + '</string>\n\t</array>\n</dict>\n</plist>\n')

fw = os.path.join(ROOT, 'FlowWatch')
fc = os.path.join(ROOT, 'FlowComplications')
shutil.copyfile(os.path.join(NATIVE, 'Watch', 'FlowWatchApp.swift'), os.path.join(os.makedirs(fw, exist_ok=True) or fw, 'FlowWatchApp.swift'))
shutil.copyfile(os.path.join(NATIVE, 'Watch', 'WatchStore.swift'), os.path.join(fw, 'WatchStore.swift'))
os.makedirs(fc, exist_ok=True)
shutil.copyfile(os.path.join(NATIVE, 'WatchWidget', 'FlowComplications.swift'), os.path.join(fc, 'FlowComplications.swift'))
write(os.path.join(fw, 'FlowWatch.entitlements'), ENT)
write(os.path.join(fc, 'FlowComplications.entitlements'), ENT)
write(os.path.join(fc, 'Info.plist'),
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      '<plist version="1.0">\n<dict>\n\t<key>NSExtension</key>\n\t<dict>\n'
      '\t\t<key>NSExtensionPointIdentifier</key>\n\t\t<string>com.apple.widgetkit-extension</string>\n'
      '\t</dict>\n</dict>\n</plist>\n')

# A single-target watch app says so in its Info.plist; the rest is generated.
write(os.path.join(fw, 'Info.plist'),
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      '<plist version="1.0">\n<dict>\n\t<key>WKApplication</key>\n\t<true/>\n</dict>\n</plist>\n')

# The watch icon: the app's own 1024 artwork, opaque (the store refuses alpha).
cat = os.path.join(fw, 'Assets.xcassets')
icon_dir = os.path.join(cat, 'AppIcon.appiconset')
os.makedirs(icon_dir, exist_ok=True)
write(os.path.join(cat, 'Contents.json'), json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
src_icon = None
for cand in ['App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
             'App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png']:
    if os.path.exists(os.path.join(ROOT, cand)):
        src_icon = os.path.join(ROOT, cand); break
if src_icon is None:
    d = os.path.join(ROOT, 'App/Assets.xcassets/AppIcon.appiconset')
    pngs = sorted([p for p in os.listdir(d) if p.endswith('.png')], key=lambda p: -os.path.getsize(os.path.join(d, p))) if os.path.isdir(d) else []
    src_icon = os.path.join(d, pngs[0]) if pngs else None
if src_icon:
    shutil.copyfile(src_icon, os.path.join(icon_dir, 'AppIcon-1024.png'))
write(os.path.join(icon_dir, 'Contents.json'), json.dumps({
    'images': [{'filename': 'AppIcon-1024.png', 'idiom': 'universal', 'platform': 'watchos', 'size': '1024x1024'}],
    'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')

if re.search(r'/\* FlowWatch \*/ = \{\s*isa = PBXNativeTarget;', src):
    if 'INFOPLIST_FILE = FlowWatch/Info.plist;' not in src:
        src = src.replace('INFOPLIST_KEY_WKCompanionAppBundleIdentifier', 'INFOPLIST_FILE = FlowWatch/Info.plist;\n\t\t\t\tINFOPLIST_KEY_WKCompanionAppBundleIdentifier')
        open(PBX, 'w', encoding='utf-8').write(src)
        print('ok: FlowWatch now reads FlowWatch/Info.plist (WKApplication).')
    print('ok: FlowWatch is already in this project — refreshed its files, left the targets alone.')
    sys.exit(0)

if not os.path.exists(PBX + '.before-watch'):
    shutil.copyfile(PBX, PBX + '.before-watch')

# ---- ids: stable, so a re-generated project diffs cleanly ----
def uid(name):
    return hashlib.sha1(('theflow-watch:' + name).encode()).hexdigest()[:24].upper()
U = {k: uid(k) for k in [
    'fw.product', 'fc.product', 'fw.info', 'fw.app', 'fw.store', 'fw.assets', 'fw.ent', 'fc.src', 'fc.info', 'fc.ent',
    'bf.fw.app', 'bf.fw.store', 'bf.fw.assets', 'bf.fc.src', 'bf.fc.store', 'bf.embed.watch', 'bf.embed.fc',
    'fw.sources', 'fw.frameworks', 'fw.resources', 'fw.embedext', 'fc.sources', 'fc.frameworks', 'fc.resources', 'app.embedwatch',
    'g.fw', 'g.fc', 't.fw', 't.fc', 'cl.fw', 'cl.fc', 'c.fw.debug', 'c.fw.release', 'c.fc.debug', 'c.fc.release',
    'proxy.app.fw', 'dep.app.fw', 'proxy.fw.fc', 'dep.fw.fc']}

def section_add(name, body):
    global src
    end = '/* End ' + name + ' section */'
    if end in src:
        src = src.replace(end, body + end, 1)
    else:
        src = src.replace('\t};\n\trootObject', '/* Begin ' + name + ' section */\n' + body + end + '\n\t};\n\trootObject', 1)

def list_add(obj_id, key, items):
    """Append entries to a ( ... ) list inside one object."""
    global src
    m = re.search(re.escape(obj_id) + r'[^=]*= \{', src)
    assert m, obj_id
    start = m.end()
    k = src.index(key + ' = (', start)
    close = src.index(');', k)
    src = src[:close] + ''.join('\t\t\t\t' + it + ',\n' for it in items) + '\t\t\t' + src[close:]

section_add('PBXBuildFile', ''.join([
    f'\t\t{U["bf.fw.app"]} /* FlowWatchApp.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {U["fw.app"]} /* FlowWatchApp.swift */; }};\n',
    f'\t\t{U["bf.fw.store"]} /* WatchStore.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {U["fw.store"]} /* WatchStore.swift */; }};\n',
    f'\t\t{U["bf.fw.assets"]} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {U["fw.assets"]} /* Assets.xcassets */; }};\n',
    f'\t\t{U["bf.fc.src"]} /* FlowComplications.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {U["fc.src"]} /* FlowComplications.swift */; }};\n',
    f'\t\t{U["bf.fc.store"]} /* WatchStore.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {U["fw.store"]} /* WatchStore.swift */; }};\n',
    f'\t\t{U["bf.embed.watch"]} /* FlowWatch.app in Embed Watch Content */ = {{isa = PBXBuildFile; fileRef = {U["fw.product"]} /* FlowWatch.app */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};\n',
    f'\t\t{U["bf.embed.fc"]} /* FlowComplications.appex in Embed Foundation Extensions */ = {{isa = PBXBuildFile; fileRef = {U["fc.product"]} /* FlowComplications.appex */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};\n',
]))

section_add('PBXFileReference', ''.join([
    f'\t\t{U["fw.product"]} /* FlowWatch.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = FlowWatch.app; sourceTree = BUILT_PRODUCTS_DIR; }};\n',
    f'\t\t{U["fc.product"]} /* FlowComplications.appex */ = {{isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = FlowComplications.appex; sourceTree = BUILT_PRODUCTS_DIR; }};\n',
    f'\t\t{U["fw.app"]} /* FlowWatchApp.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = FlowWatchApp.swift; sourceTree = "<group>"; }};\n',
    f'\t\t{U["fw.store"]} /* WatchStore.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WatchStore.swift; sourceTree = "<group>"; }};\n',
    f'\t\t{U["fw.assets"]} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; }};\n',
    f'\t\t{U["fw.ent"]} /* FlowWatch.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = FlowWatch.entitlements; sourceTree = "<group>"; }};\n',
    f'\t\t{U["fw.info"]} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};\n',
    f'\t\t{U["fc.src"]} /* FlowComplications.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = FlowComplications.swift; sourceTree = "<group>"; }};\n',
    f'\t\t{U["fc.info"]} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};\n',
    f'\t\t{U["fc.ent"]} /* FlowComplications.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = FlowComplications.entitlements; sourceTree = "<group>"; }};\n',
]))

def phase(kind, pid, name, files, extra=''):
    return (f'\t\t{pid} /* {name} */ = {{\n\t\t\tisa = {kind};\n\t\t\tbuildActionMask = 2147483647;\n'
            f'{extra}\t\t\tfiles = (\n' + ''.join(f'\t\t\t\t{f},\n' for f in files) +
            '\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n')

section_add('PBXFrameworksBuildPhase', phase('PBXFrameworksBuildPhase', U['fw.frameworks'], 'Frameworks', []) +
            phase('PBXFrameworksBuildPhase', U['fc.frameworks'], 'Frameworks', []))
section_add('PBXResourcesBuildPhase', phase('PBXResourcesBuildPhase', U['fw.resources'], 'Resources', [f'{U["bf.fw.assets"]} /* Assets.xcassets in Resources */']) +
            phase('PBXResourcesBuildPhase', U['fc.resources'], 'Resources', []))
section_add('PBXSourcesBuildPhase',
            phase('PBXSourcesBuildPhase', U['fw.sources'], 'Sources', [f'{U["bf.fw.app"]} /* FlowWatchApp.swift in Sources */', f'{U["bf.fw.store"]} /* WatchStore.swift in Sources */']) +
            phase('PBXSourcesBuildPhase', U['fc.sources'], 'Sources', [f'{U["bf.fc.src"]} /* FlowComplications.swift in Sources */', f'{U["bf.fc.store"]} /* WatchStore.swift in Sources */']))
section_add('PBXCopyFilesBuildPhase',
            phase('PBXCopyFilesBuildPhase', U['app.embedwatch'], 'Embed Watch Content', [f'{U["bf.embed.watch"]} /* FlowWatch.app in Embed Watch Content */'],
                  '\t\t\tdstPath = "$(CONTENTS_FOLDER_PATH)/Watch";\n\t\t\tdstSubfolderSpec = 16;\n\t\t\tname = "Embed Watch Content";\n') +
            phase('PBXCopyFilesBuildPhase', U['fw.embedext'], 'Embed Foundation Extensions', [f'{U["bf.embed.fc"]} /* FlowComplications.appex in Embed Foundation Extensions */'],
                  '\t\t\tdstPath = "";\n\t\t\tdstSubfolderSpec = 13;\n\t\t\tname = "Embed Foundation Extensions";\n'))

section_add('PBXGroup',
    f'\t\t{U["g.fw"]} /* FlowWatch */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n'
    f'\t\t\t\t{U["fw.app"]} /* FlowWatchApp.swift */,\n\t\t\t\t{U["fw.store"]} /* WatchStore.swift */,\n'
    f'\t\t\t\t{U["fw.assets"]} /* Assets.xcassets */,\n\t\t\t\t{U["fw.ent"]} /* FlowWatch.entitlements */,\n\t\t\t\t{U["fw.info"]} /* Info.plist */,\n'
    f'\t\t\t);\n\t\t\tpath = FlowWatch;\n\t\t\tsourceTree = "<group>";\n\t\t}};\n'
    f'\t\t{U["g.fc"]} /* FlowComplications */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n'
    f'\t\t\t\t{U["fc.src"]} /* FlowComplications.swift */,\n\t\t\t\t{U["fc.info"]} /* Info.plist */,\n'
    f'\t\t\t\t{U["fc.ent"]} /* FlowComplications.entitlements */,\n'
    f'\t\t\t);\n\t\t\tpath = FlowComplications;\n\t\t\tsourceTree = "<group>";\n\t\t}};\n')
list_add(MAIN_GROUP, 'children', [f'{U["g.fw"]} /* FlowWatch */', f'{U["g.fc"]} /* FlowComplications */'])
list_add(PRODUCTS, 'children', [f'{U["fw.product"]} /* FlowWatch.app */', f'{U["fc.product"]} /* FlowComplications.appex */'])

def target(tid, name, product, ptype, cl, phases, deps):
    return (f'\t\t{tid} /* {name} */ = {{\n\t\t\tisa = PBXNativeTarget;\n'
            f'\t\t\tbuildConfigurationList = {cl} /* Build configuration list for PBXNativeTarget "{name}" */;\n'
            '\t\t\tbuildPhases = (\n' + ''.join(f'\t\t\t\t{p},\n' for p in phases) + '\t\t\t);\n'
            '\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n' + ''.join(f'\t\t\t\t{d},\n' for d in deps) + '\t\t\t);\n'
            f'\t\t\tname = {name};\n\t\t\tproductName = {name};\n\t\t\tproductReference = {product};\n'
            f'\t\t\tproductType = "{ptype}";\n\t\t}};\n')

section_add('PBXNativeTarget',
    target(U['t.fw'], 'FlowWatch', f'{U["fw.product"]} /* FlowWatch.app */', 'com.apple.product-type.application', U['cl.fw'],
           [f'{U["fw.sources"]} /* Sources */', f'{U["fw.frameworks"]} /* Frameworks */', f'{U["fw.resources"]} /* Resources */', f'{U["fw.embedext"]} /* Embed Foundation Extensions */'],
           [f'{U["dep.fw.fc"]} /* PBXTargetDependency */']) +
    target(U['t.fc'], 'FlowComplications', f'{U["fc.product"]} /* FlowComplications.appex */', 'com.apple.product-type.app-extension', U['cl.fc'],
           [f'{U["fc.sources"]} /* Sources */', f'{U["fc.frameworks"]} /* Frameworks */', f'{U["fc.resources"]} /* Resources */'], []))

list_add(APP_TARGET, 'buildPhases', [f'{U["app.embedwatch"]} /* Embed Watch Content */'])
list_add(APP_TARGET, 'dependencies', [f'{U["dep.app.fw"]} /* PBXTargetDependency */'])
list_add(PROJECT_OBJ, 'targets', [f'{U["t.fw"]} /* FlowWatch */', f'{U["t.fc"]} /* FlowComplications */'])

# TargetAttributes, so Xcode treats them as its own.
src = src.replace('\t\t\t\tTargetAttributes = {\n',
                  '\t\t\t\tTargetAttributes = {\n'
                  f'\t\t\t\t\t{U["t.fw"]} = {{\n\t\t\t\t\t\tCreatedOnToolsVersion = 16.0;\n\t\t\t\t\t}};\n'
                  f'\t\t\t\t\t{U["t.fc"]} = {{\n\t\t\t\t\t\tCreatedOnToolsVersion = 16.0;\n\t\t\t\t\t}};\n', 1)

section_add('PBXContainerItemProxy',
    f'\t\t{U["proxy.app.fw"]} /* PBXContainerItemProxy */ = {{\n\t\t\tisa = PBXContainerItemProxy;\n\t\t\tcontainerPortal = {PROJECT_OBJ} /* Project object */;\n'
    f'\t\t\tproxyType = 1;\n\t\t\tremoteGlobalIDString = {U["t.fw"]};\n\t\t\tremoteInfo = FlowWatch;\n\t\t}};\n'
    f'\t\t{U["proxy.fw.fc"]} /* PBXContainerItemProxy */ = {{\n\t\t\tisa = PBXContainerItemProxy;\n\t\t\tcontainerPortal = {PROJECT_OBJ} /* Project object */;\n'
    f'\t\t\tproxyType = 1;\n\t\t\tremoteGlobalIDString = {U["t.fc"]};\n\t\t\tremoteInfo = FlowComplications;\n\t\t}};\n')
section_add('PBXTargetDependency',
    f'\t\t{U["dep.app.fw"]} /* PBXTargetDependency */ = {{\n\t\t\tisa = PBXTargetDependency;\n\t\t\ttarget = {U["t.fw"]} /* FlowWatch */;\n\t\t\ttargetProxy = {U["proxy.app.fw"]} /* PBXContainerItemProxy */;\n\t\t}};\n'
    f'\t\t{U["dep.fw.fc"]} /* PBXTargetDependency */ = {{\n\t\t\tisa = PBXTargetDependency;\n\t\t\ttarget = {U["t.fc"]} /* FlowComplications */;\n\t\t\ttargetProxy = {U["proxy.fw.fc"]} /* PBXContainerItemProxy */;\n\t\t}};\n')

def settings(d):
    out = ''
    for k, v in d.items():
        out += f'\t\t\t\t{k} = {v};\n'
    return out

common = {
    'CODE_SIGN_STYLE': 'Automatic', 'CODE_SIGN_IDENTITY': '"Apple Development"',
    'CURRENT_PROJECT_VERSION': BUILD, 'MARKETING_VERSION': VERSION,
    'GENERATE_INFOPLIST_FILE': 'YES', 'INFOPLIST_KEY_CFBundleDisplayName': '"The Flow"',
    'PRODUCT_NAME': '"$(TARGET_NAME)"', 'SDKROOT': 'watchos', 'SKIP_INSTALL': 'YES',
    'SWIFT_EMIT_LOC_STRINGS': 'YES', 'SWIFT_VERSION': '5.0', 'TARGETED_DEVICE_FAMILY': '4',
    'WATCHOS_DEPLOYMENT_TARGET': '9.0',
}
if TEAM: common['DEVELOPMENT_TEAM'] = TEAM
fw_set = dict(common, **{
    'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon',
    'CODE_SIGN_ENTITLEMENTS': 'FlowWatch/FlowWatch.entitlements',
    'ENABLE_PREVIEWS': 'YES',
    'INFOPLIST_FILE': 'FlowWatch/Info.plist',
    'INFOPLIST_KEY_UISupportedInterfaceOrientations': '"UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown"',
    'INFOPLIST_KEY_WKCompanionAppBundleIdentifier': BUNDLE,
    'INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp': 'YES',
    'LD_RUNPATH_SEARCH_PATHS': '"$(inherited) @executable_path/Frameworks"',
    'PRODUCT_BUNDLE_IDENTIFIER': BUNDLE + '.watchkitapp',
})
fc_set = dict(common, **{
    'APPLICATION_EXTENSION_API_ONLY': 'YES',
    'CODE_SIGN_ENTITLEMENTS': 'FlowComplications/FlowComplications.entitlements',
    'INFOPLIST_FILE': 'FlowComplications/Info.plist',
    'LD_RUNPATH_SEARCH_PATHS': '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
    'PRODUCT_BUNDLE_IDENTIFIER': BUNDLE + '.watchkitapp.complications',
})
debug = {'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG', 'SWIFT_OPTIMIZATION_LEVEL': '"-Onone"', 'DEBUG_INFORMATION_FORMAT': 'dwarf'}
release = {'SWIFT_OPTIMIZATION_LEVEL': '"-O"', 'SWIFT_COMPILATION_MODE': 'wholemodule', 'VALIDATE_PRODUCT': 'YES', 'DEBUG_INFORMATION_FORMAT': '"dwarf-with-dsym"'}

def config(cid, name, s):
    return f'\t\t{cid} /* {name} */ = {{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {{\n{settings(s)}\t\t\t}};\n\t\t\tname = {name};\n\t\t}};\n'

section_add('XCBuildConfiguration',
    config(U['c.fw.debug'], 'Debug', dict(fw_set, **debug)) + config(U['c.fw.release'], 'Release', dict(fw_set, **release)) +
    config(U['c.fc.debug'], 'Debug', dict(fc_set, **debug)) + config(U['c.fc.release'], 'Release', dict(fc_set, **release)))

def clist(cl, name, d, r):
    return (f'\t\t{cl} /* Build configuration list for PBXNativeTarget "{name}" */ = {{\n\t\t\tisa = XCConfigurationList;\n'
            f'\t\t\tbuildConfigurations = (\n\t\t\t\t{d} /* Debug */,\n\t\t\t\t{r} /* Release */,\n\t\t\t);\n'
            '\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t};\n')
section_add('XCConfigurationList', clist(U['cl.fw'], 'FlowWatch', U['c.fw.debug'], U['c.fw.release']) +
            clist(U['cl.fc'], 'FlowComplications', U['c.fc.debug'], U['c.fc.release']))

with open(PBX, 'w', encoding='utf-8') as f:
    f.write(src)
print('ok: added FlowWatch and FlowComplications (watchOS ' + common['WATCHOS_DEPLOYMENT_TARGET'] + ', ' + VERSION + ' (' + BUILD + '), team ' + (TEAM or 'none') + ').')
print('    Open the project and pick the FlowWatch scheme with a watch simulator to run it.')
