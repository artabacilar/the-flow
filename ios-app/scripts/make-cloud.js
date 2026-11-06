#!/usr/bin/env node
/* What Xcode Cloud needs from the repository, and nothing else does.
 *
 * 1. Shared schemes. Xcode makes a scheme for each target the first time a
 *    person opens the project — in their own xcuserdata, which is not in the
 *    repository. Xcode Cloud checks out the repository and nobody opens
 *    anything, so it can only build a scheme written under xcshareddata/.
 *    These two are:
 *
 *      App         the iPhone app, with the widget and the watch app inside it
 *      TheFlowMac  the Mac app
 *
 *    Plain XML, written from the target ids in project.pbxproj so they can
 *    never point at a target that is not there.
 *
 * 2. ci_scripts/. Xcode Cloud runs ci_post_clone.sh and ci_pre_xcodebuild.sh
 *    from a folder beside the project. They are kept in scripts/ci_scripts/
 *    (the project folder is regenerated from scratch, and anything only in it
 *    is lost) and copied in here, executable, which is the other thing Xcode
 *    Cloud silently requires of them.
 *
 * Run last, after every add-*-target script. */
const fs = require('fs');
const path = require('path');

const projDir = path.join(__dirname, '..', 'ios', 'App');
const pbxPath = path.join(projDir, 'App.xcodeproj', 'project.pbxproj');
const outDir  = path.join(projDir, 'App.xcodeproj', 'xcshareddata', 'xcschemes');
const ciSrc   = path.join(__dirname, 'ci_scripts');
const ciDst   = path.join(projDir, 'ci_scripts');

const src = fs.readFileSync(pbxPath, 'utf8');

/** The id of a native target, by name — quoted or not, as node-xcode and
 *  Xcode disagree on whether a plain word needs quotes. */
function targetId(name) {
  const re = new RegExp('(\\w{24}) /\\* "?' + name + '"? \\*/ = \\{\\s*isa = PBXNativeTarget;');
  const m = src.match(re);
  if (!m) { console.error('no target named ' + name + ' in the project'); process.exit(1); }
  return m[1];
}

function scheme(name, product) {
  const id = targetId(name);
  const ref = [
    '            <BuildableReference',
    '               BuildableIdentifier = "primary"',
    '               BlueprintIdentifier = "' + id + '"',
    '               BuildableName = "' + product + '"',
    '               BlueprintName = "' + name + '"',
    '               ReferencedContainer = "container:App.xcodeproj">',
    '            </BuildableReference>'].join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Scheme',
    '   LastUpgradeVersion = "1500"',
    '   version = "1.7">',
    '   <BuildAction',
    '      parallelizeBuildables = "YES"',
    '      buildImplicitDependencies = "YES">',
    '      <BuildActionEntries>',
    '         <BuildActionEntry',
    '            buildForTesting = "YES"',
    '            buildForRunning = "YES"',
    '            buildForProfiling = "YES"',
    '            buildForArchiving = "YES"',
    '            buildForAnalyzing = "YES">',
    ref,
    '         </BuildActionEntry>',
    '      </BuildActionEntries>',
    '   </BuildAction>',
    '   <TestAction',
    '      buildConfiguration = "Debug"',
    '      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"',
    '      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"',
    '      shouldUseLaunchSchemeArgsEnv = "YES">',
    '      <Testables>',
    '      </Testables>',
    '   </TestAction>',
    '   <LaunchAction',
    '      buildConfiguration = "Debug"',
    '      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"',
    '      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"',
    '      launchStyle = "0"',
    '      useCustomWorkingDirectory = "NO"',
    '      ignoresPersistentStateOnLaunch = "NO"',
    '      debugDocumentVersioning = "YES"',
    '      debugServiceExtension = "internal"',
    '      allowLocationSimulation = "YES">',
    '      <BuildableProductRunnable',
    '         runnableDebuggingMode = "0">',
    ref,
    '      </BuildableProductRunnable>',
    '   </LaunchAction>',
    '   <ProfileAction',
    '      buildConfiguration = "Release"',
    '      shouldUseLaunchSchemeArgsEnv = "YES"',
    '      savedToolIdentifier = ""',
    '      useCustomWorkingDirectory = "NO"',
    '      debugDocumentVersioning = "YES">',
    '      <BuildableProductRunnable',
    '         runnableDebuggingMode = "0">',
    ref,
    '      </BuildableProductRunnable>',
    '   </ProfileAction>',
    '   <AnalyzeAction',
    '      buildConfiguration = "Debug">',
    '   </AnalyzeAction>',
    '   <ArchiveAction',
    '      buildConfiguration = "Release"',
    '      revealArchiveInOrganizer = "YES">',
    '   </ArchiveAction>',
    '</Scheme>',
    ''].join('\n');
}

fs.mkdirSync(outDir, { recursive: true });
const wrote = [];
for (const [name, product] of [['App', 'App.app'], ['TheFlowMac', 'The Flow.app']]) {
  const file = path.join(outDir, name + '.xcscheme');
  fs.writeFileSync(file, scheme(name, product));
  wrote.push(name);
}
console.log('ok: shared schemes ' + wrote.join(', ') + ' -> ' + path.relative(path.join(__dirname, '..'), outDir));

fs.mkdirSync(ciDst, { recursive: true });
const scripts = fs.readdirSync(ciSrc).filter((f) => f.endsWith('.sh')).sort();
if (!scripts.includes('ci_post_clone.sh') || !scripts.includes('ci_pre_xcodebuild.sh')) {
  console.error('scripts/ci_scripts/ must hold ci_post_clone.sh and ci_pre_xcodebuild.sh');
  process.exit(1);
}
for (const f of scripts) {
  fs.copyFileSync(path.join(ciSrc, f), path.join(ciDst, f));
  fs.chmodSync(path.join(ciDst, f), 0o755);
}
console.log('ok: Xcode Cloud scripts ' + scripts.join(', ') + ' -> ' + path.relative(path.join(__dirname, '..'), ciDst));
