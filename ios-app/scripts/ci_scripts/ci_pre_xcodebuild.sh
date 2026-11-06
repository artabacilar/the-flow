#!/bin/sh
# Xcode Cloud runs this just before xcodebuild.
#
# Version and build number, from the two places they are decided:
#
#   version   ios-app/version.json, the one file a release edits. Written
#             into every target here so the project never has to be
#             regenerated for a version bump.
#   build     App Store Connect refuses a build whose number it has already
#             seen for that version, so every upload needs a new one. Xcode
#             Cloud counts its own builds (CI_BUILD_NUMBER, unique across this
#             product), so the build number is that count plus 100 — the 100
#             keeps it clear of the builds uploaded by hand before this
#             existed (1.0.4 reached build 8).
#
# Every target gets the same pair, because the app, the widget and the watch
# app must agree or the upload is refused (ITMS-90473).
set -eu

ROOT="${CI_PRIMARY_REPOSITORY_PATH:?not running on Xcode Cloud}"
PBX="$ROOT/ios-app/ios/App/App.xcodeproj/project.pbxproj"
V="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/ios-app/version.json")"
N=$((100 + ${CI_BUILD_NUMBER:-0}))

sed -i '' "s/MARKETING_VERSION = [0-9.]*;/MARKETING_VERSION = $V;/g" "$PBX"
sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9][0-9]*;/CURRENT_PROJECT_VERSION = $N;/g" "$PBX"
grep -q "MARKETING_VERSION = $V;" "$PBX"
grep -q "CURRENT_PROJECT_VERSION = $N;" "$PBX"
echo "ok: version $V, build $N"
