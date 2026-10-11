#!/bin/bash
# The Flow for macOS — built without opening Xcode.
#
#   bash build.sh          build, sign for this Mac only, and open it   (default)
#   bash build.sh app      build and sign for this Mac only; do not open
#   bash build.sh store    build, sign for the Mac App Store, and package a .pkg
#                       for Transporter. Needs the two distribution
#                       certificates and a Mac App Store provisioning profile —
#                       see README.md, "Shipping it".
#
# Needs only the Command Line Tools (`xcode-select --install`). Full Xcode is
# used if present — only to record its version in Info.plist, which App Store
# processing reads — and is never driven.
#
# Why a script and not an .xcodeproj: four Swift files and a plist do not need
# a project file, and a project file is two thousand lines of generated text
# that nobody reviews. Everything this does is visible below, in order.

set -euo pipefail
cd "$(dirname "$0")"

NAME="The Flow"
EXE="TheFlow"
BUNDLE_ID="com.abko.theflow"
TEAM="CFDZ32QZUR"
VERSION="${FLOW_VERSION:-1.0}"
BUILD="${FLOW_BUILD:-1}"
MIN_OS="13.0"

OUT="build"
APP="$OUT/$NAME.app"
MODE="${1:-run}"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

case "$MODE" in run|app|store) ;; *) fail "unknown mode '$MODE' (run, app or store)";; esac

# ---- preflight -------------------------------------------------------------
command -v swiftc >/dev/null || fail "no Swift compiler. Run: xcode-select --install"
SDK="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)" || fail "no macOS SDK found. Run: xcode-select --install"
SDK_VER="$(xcrun --sdk macosx --show-sdk-version)"
SDK_BUILD="$(xcrun --sdk macosx --show-sdk-build-version 2>/dev/null || echo "")"
[ -f Resources/AppIcon.icns ] || fail "Resources/AppIcon.icns is missing. Run: node scripts/make-mac-icon.js"

say "Swift: $(swiftc --version 2>&1 | head -1)"
say "SDK:   macOS $SDK_VER"

rm -rf "$OUT"
mkdir -p "$OUT"

# ---- compile ---------------------------------------------------------------
# Both architectures, always. An Intel Mac on macOS 13 is still a customer,
# and lipo'ing two small binaries costs seconds.
#
# -swift-version 5: the sources are written against Swift 5 semantics. Swift
# 6 mode turns the WebKit and UserNotifications callbacks into strict
# concurrency errors; moving to it is a deliberate change, not a side effect
# of whichever compiler happens to be installed.
for arch in arm64 x86_64; do
  say "compiling $arch"
  mkdir -p "$OUT/$arch"
  swiftc -O -swift-version 5 \
    -target "$arch-apple-macos$MIN_OS" \
    -sdk "$SDK" \
    -module-name "$EXE" \
    native/*.swift \
    -o "$OUT/$arch/$EXE"
done

# ---- bundle ----------------------------------------------------------------
say "assembling $NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create "$OUT/arm64/$EXE" "$OUT/x86_64/$EXE" -output "$APP/Contents/MacOS/$EXE"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# The DT* keys describe the toolchain that built the app. Xcode writes them;
# App Store processing reads them to check the SDK is current. Recorded here
# from the real SDK, never made up — and the Xcode pair only when Xcode is
# actually installed.
XCODE_KEYS=""
if XV="$(xcodebuild -version 2>/dev/null)"; then
  XCODE_VER="$(printf '%s\n' "$XV" | awk '/^Xcode/ {print $2}')"
  XCODE_BUILD="$(printf '%s\n' "$XV" | awk '/^Build version/ {print $3}')"
  # "16.2" -> "1620", "16.2.1" -> "1621", "27.0" -> "2700": Xcode's own format.
  IFS=. read -r XMAJ XMIN XPATCH <<< "$XCODE_VER"
  DTXCODE="$(printf '%d%d%d' "$XMAJ" "${XMIN:-0}" "${XPATCH:-0}")"
  XCODE_KEYS="	<key>DTXcode</key>
	<string>$DTXCODE</string>
	<key>DTXcodeBuild</key>
	<string>$XCODE_BUILD</string>"
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>$NAME</string>
	<key>CFBundleExecutable</key>
	<string>$EXE</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleIdentifier</key>
	<string>$BUNDLE_ID</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$NAME</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundleSupportedPlatforms</key>
	<array>
		<string>MacOSX</string>
	</array>
	<key>CFBundleVersion</key>
	<string>$BUILD</string>
	<key>DTCompiler</key>
	<string>com.apple.compilers.llvm.clang.1_0</string>
	<key>DTPlatformName</key>
	<string>macosx</string>
	<key>DTPlatformVersion</key>
	<string>$SDK_VER</string>
	<key>DTPlatformBuild</key>
	<string>$SDK_BUILD</string>
	<key>DTSDKName</key>
	<string>macosx$SDK_VER</string>
	<key>DTSDKBuild</key>
	<string>$SDK_BUILD</string>
$XCODE_KEYS
	<key>BuildMachineOSBuild</key>
	<string>$(sw_vers -buildVersion)</string>
	<key>ITSAppUsesNonExemptEncryption</key>
	<false/>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.productivity</string>
	<key>LSMinimumSystemVersion</key>
	<string>$MIN_OS</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSHumanReadableCopyright</key>
	<string>© ABKO</string>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
	<key>NSUserNotificationsUsageDescription</key>
	<string>The Flow uses notifications to remind you about your Big Rocks and habits.</string>
</dict>
</plist>
PLIST
plutil -lint -s "$APP/Contents/Info.plist" || fail "Info.plist did not validate"

# ---- entitlements ----------------------------------------------------------
# The sandbox is mandatory on the Mac App Store. Outgoing connections are the
# one hole it needs: without network.client the window sits on the offline
# page forever, and nothing else says why.
ENT="$OUT/TheFlow.entitlements"
STORE_KEYS=""
if [ "$MODE" = store ]; then
  # Xcode merges these in from the provisioning profile. Without Xcode they
  # have to be stated, and they must match the profile exactly.
  STORE_KEYS="	<key>com.apple.application-identifier</key>
	<string>$TEAM.$BUNDLE_ID</string>
	<key>com.apple.developer.team-identifier</key>
	<string>$TEAM</string>"
fi
cat > "$ENT" <<ENTS
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.app-sandbox</key>
	<true/>
	<key>com.apple.security.network.client</key>
	<true/>
$STORE_KEYS
</dict>
</plist>
ENTS
plutil -lint -s "$ENT" || fail "entitlements did not validate"

# ---- sign: this Mac only ---------------------------------------------------
if [ "$MODE" != store ]; then
  # "-" is an ad-hoc signature: no certificate, valid on this machine only.
  # Enough to run it, sandboxed, exactly as it will run from the store.
  say "signing for this Mac (ad hoc)"
  codesign --force --sign - --entitlements "$ENT" "$APP"
  codesign --verify --strict "$APP"
  say "built: $(pwd)/$APP"
  if [ "$MODE" = run ]; then
    # By exact process name — never a pattern that could match this script.
    pkill -x "$EXE" 2>/dev/null || true
    open "$APP"
  fi
  exit 0
fi

# ---- sign: Mac App Store ---------------------------------------------------
PROFILE="${2:-TheFlow_MacAppStore.provisionprofile}"
[ -f "$PROFILE" ] || fail "no provisioning profile at mac-app/$PROFILE — see README.md, \"Shipping it\", step 2"

# Read the profile before trusting it. The two ways this goes wrong are a
# profile for the wrong app, and a development profile, which signs fine and
# is then rejected at upload with a message that does not mention either.
PDEC="$OUT/profile.plist"
security cms -D -i "$PROFILE" > "$PDEC" 2>/dev/null || fail "could not read $PROFILE"
P_APPID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.application-identifier' "$PDEC" 2>/dev/null || true)"
[ "$P_APPID" = "$TEAM.$BUNDLE_ID" ] || fail "profile is for '$P_APPID', not '$TEAM.$BUNDLE_ID'"
if /usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "$PDEC" >/dev/null 2>&1; then
  fail "that is a development profile (it lists devices). Make a 'Mac App Store Connect' distribution profile."
fi
cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"

# Identities by team, not by the full display name: the team's legal name has
# Turkish characters in it, and matching on those is a quoting accident
# waiting to happen. Either current or legacy certificate names are accepted.
pick() { security find-identity -v "$@" | grep -E "$PATTERN" | grep "($TEAM)\"" | head -1 | sed -E 's/.*"(.*)"/\1/'; }
PATTERN='"(Apple Distribution|3rd Party Mac Developer Application): '
APP_ID="$(pick -p codesigning || true)"
[ -n "$APP_ID" ] || fail "no 'Apple Distribution' certificate for team $TEAM in your keychain — README.md, \"Shipping it\", step 1"
PATTERN='"(3rd Party Mac Developer Installer|Mac Installer Distribution): '
INST_ID="$(pick || true)"
[ -n "$INST_ID" ] || fail "no 'Mac Installer Distribution' certificate for team $TEAM in your keychain — README.md, \"Shipping it\", step 1"

say "signing with: $APP_ID"
codesign --force --sign "$APP_ID" --entitlements "$ENT" "$APP"
codesign --verify --strict --verbose=2 "$APP"

PKG="$OUT/TheFlow-$VERSION-$BUILD.pkg"
say "packaging with: $INST_ID"
productbuild --component "$APP" /Applications --sign "$INST_ID" "$PKG"
pkgutil --check-signature "$PKG" | head -3

say "ready: $(pwd)/$PKG"
say "upload it with the Transporter app (free, Mac App Store), signed in as the App Store Connect account holder."
