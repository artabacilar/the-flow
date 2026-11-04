#!/bin/sh
# Xcode Cloud runs this right after it clones the repository, before it builds
# anything. (It looks for ci_scripts/ next to the project it is building;
# make-cloud.js puts this file there.)
#
# The iOS targets compile copies of ios-app/native/* that the generator put
# beside the project. A change to native/ that nobody regenerated for would
# otherwise ship the old file — so the copies are refreshed here, every build,
# from the folder that is actually edited. The Mac target needs none of this:
# it references mac-app/native/ where it lives.
set -eu

ROOT="${CI_PRIMARY_REPOSITORY_PATH:?not running on Xcode Cloud}"
IOS="$ROOT/ios-app"
P="$IOS/ios/App"

cp "$IOS"/native/App/*.swift                         "$P/App/"
cp "$IOS"/native/Shared/*.swift                      "$P/App/"
cp "$IOS/native/Widget/FlowWidget.swift"             "$P/FlowWidget/"
cp "$IOS/native/Shared/FlowStore.swift"              "$P/FlowWidget/"
cp "$IOS/native/Watch/FlowWatchApp.swift"            "$P/FlowWatch/"
cp "$IOS/native/Watch/WatchStore.swift"              "$P/FlowWatch/"
cp "$IOS/native/WatchWidget/FlowComplications.swift" "$P/FlowComplications/"

# Say what moved, so a build log answers "which version did this ship?".
cd "$ROOT" && { git status --short -- ios-app/ios | sed 's/^/refreshed: /' || true; }
echo "ok: native sources refreshed into the project"
