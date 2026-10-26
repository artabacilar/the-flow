# The Flow on Wear OS

The watch app: today's Big Rocks (and the ones that slipped), what is next,
today's habits to tick, and a Big Rock or a note said into the watch. A
watch-face complication shows how many are left and the next one.

It is a standalone app. It reaches theflow.today itself and is linked with a
six-character code typed into The Flow on the phone or a computer
(Settings → Watch, or theflow.today/watch). It does not need the phone app,
which is a web app with no native side to hand a token across.

Wear OS 3 and later: Galaxy Watch 4 onwards, Pixel Watch, and every other Wear
watch sold since 2021.

## Build

Open this folder in Android Studio (File → Open → `wear-app`). It downloads
Gradle and the libraries the first time. Run on a Wear OS emulator (Device
Manager → Create device → Wear OS) or on a watch with ADB over Wi-Fi.

## Release — the same Play listing as the phone app

The package name is `com.abko.theflow`, the same as the phone app. Play only
puts a Wear OS app in the same listing when the package matches.

1. Build → Generate Signed App Bundle, with **the same upload key as the phone
   app** (the keystore PWABuilder or Bubblewrap made for it).
2. Play Console → the app → Release → Advanced settings → Form factors → add
   **Wear OS**.
3. Production (or a testing track) → choose **Wear OS only** and upload the
   `.aab`. The version code is 2000001, far above the phone's, because version
   codes are shared across the whole listing.
4. Add at least one Wear OS screenshot (the store listing asks for it).
