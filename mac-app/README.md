# The Flow, on macOS

The App Store already lists the iPhone build as **"Designed for iPad"**, so it
installs on an Apple silicon Mac. What that gives you is the iPad binary in an
iPad-shaped window. The page picks its layout from the viewport it is handed,
so at iPad width it draws the narrow layout — which is why the same site
installed from Chrome as a desktop window looks like a different product.

No setting in App Store Connect closes that gap. This folder does: a real Mac
app, which is a real resizable window, which is a desktop viewport.

It is the same trade the iOS shell makes. The app *is* the website. Every
server deploy reaches it with no new build and no review. Xcode is only
touched when the shell itself changes.

    native/main.swift               the entry point (see why it is not @main)
    native/AppDelegate.swift        the window, and the menu bar
    native/FlowWebController.swift  the web view, links, dialogs, offline
    native/FlowMacBridge.swift      what is injected before the page runs
    native/FlowNotifications.swift  reminders
    build.sh                        compile, bundle, sign, package
    Resources/AppIcon.icns          the icon (made by scripts/make-mac-icon.js)

## The one line that matters

The app already has a mode for *installed* rather than *visited*: it lands on
Today and rearranges its navigation. It decides by asking
`matchMedia('(display-mode: standalone)')`. Chrome answers yes for an
installed window. A bare `WKWebView` answers no, because nothing told it
otherwise — and that single `false` is most of the difference between the two
windows, at identical width.

`FlowMacBridge.standaloneShim` corrects that answer, for that query only.
Every other media query still reaches the real implementation, which matters:
the layout is driven by width queries, and breaking those would trade one
wrong answer for a dozen.

## Building it

No Xcode project, and Xcode is not needed. The Command Line Tools are enough
(`xcode-select --install`; it says so if they are already there):

    cd mac-app
    bash build.sh

(`bash build.sh`, not `./build.sh`: the file reaches GitHub through the web
uploader, which does not keep the executable bit, so on a fresh clone
`./build.sh` answers "permission denied".)

That compiles for Apple silicon and Intel, assembles `build/The Flow.app`,
signs it for this Mac only, and opens it. It runs on macOS 13.0 or later. You should get the same window as
the Chrome one, minus Chrome. `bash build.sh app` does the same without opening.

What it does, so none of it is magic: `swiftc` on `native/*.swift` once per
architecture; `lipo` to join them; an Info.plist and the icon into the bundle;
the sandbox entitlements (outgoing network only); `codesign`. Every step is in
`build.sh`, in that order.

Two things it does on purpose:

- **Swift 5 language mode, pinned.** The current compiler is Swift 6, whose
  strict concurrency turns the WebKit callbacks into errors. Moving to it is a
  change to make deliberately, not a side effect of an update.
- **Sandboxed even for the local build.** It runs exactly as it will from the
  store, so a sandbox problem shows up here rather than in review.

The icon is the iOS artwork on Apple's macOS grid — 824 points of rounded
square inside 1024, transparent margin. `node scripts/make-mac-icon.js` redraws
it; the result is committed so the build never needs Node.

## Shipping it

Once, to set up:

1. **Two certificates.** Xcode → Settings → Accounts → your Apple ID →
   Manage Certificates → **+** → **Apple Distribution**, then again for
   **Mac Installer Distribution**. (Without Xcode: developer.apple.com →
   Certificates → **+**, with a signing request from Keychain Access.) Check:

       security find-identity -v

   should list both, each ending `(CFDZ32QZUR)`.

2. **A provisioning profile.** developer.apple.com → Profiles → **+** →
   Distribution → **Mac App Store Connect** → App ID `com.abko.theflow` (the
   iOS one; App IDs are shared across platforms) → the Apple Distribution
   certificate → download. Save it here as
   `mac-app/TheFlow_MacAppStore.provisionprofile`. It is gitignored.

Every release:

    FLOW_BUILD=2 bash build.sh store

(`FLOW_BUILD` must go up each upload; `FLOW_VERSION` defaults to 1.0.) It
checks the profile is for this app and is not a development profile —
either mistake otherwise signs cleanly and fails at upload, with a message
that names neither — then signs and writes `build/TheFlow-1.0-2.pkg`.

Upload that with **Transporter** (free, Mac App Store), signed in as the
account holder. Then in App Store Connect, pick the build on the macOS
version and submit.

## Universal Purchase, and what it replaces

To ship this on the same App Store listing rather than as a second app:

- Same bundle id as iOS — `com.abko.theflow` — and in App Store Connect,
  **Add Platform → macOS** on the existing app record.
- This replaces "Designed for iPad"; it does not sit beside it. **But only
  when the macOS version is released**, not when the platform is added. From
  Apple's help: adding a macOS app *"…releasing it to the store will replace
  the iOS app on the Mac App Store. Existing users of the iOS app will be
  updated to the macOS app."* So the platform can be added and filled in
  while there is no Mac build yet, and the current Mac listing keeps working
  until the day the native one goes live.
- The **"Not verified for macOS"** label belongs to the Designed-for-iPad
  route and goes with it, on that same day.

## Reminders, and why they are not push

`FlowNotifications` schedules **local** notifications: the app asks the system
to show something at a time, and the system does, running or not. That covers
what a planner needs — the rock at 09:00, a bedtime, the Sunday review.

Push is a different thing: a server waking a device that asked for nothing. It
needs an APNs key, a device-token round trip, and a sender on the server. Worth
having; not needed for a reminder whose time the page already knows; and not
worth making reminders wait for.

From the page:

    await FlowMac.notifications.request();
    const { id } = await FlowMac.notifications.schedule({
      title: 'Two hours on the quarter plan',
      body:  'Phone in another room.',
      at:    '2026-10-01T09:00:00Z'
    });
    await FlowMac.notifications.cancel(id);

`FlowMac` is absent in a browser, so guard on it. An action this platform does
not implement answers `{supported: false}` rather than throwing, so the same
call can be written once for both shells.

## Not yet done here

- **Nothing in this folder has been compiled yet.** It was written without a
  Mac. What *has* been checked, from Linux: every file parses as Swift
  (tree-sitter), and `tests/test-mac.js` pins the things that fail silently —
  the entry point, menu wiring, both ends of the bridge, the plists, the
  bundle id, the icon. Type-checking happens on the first `bash build.sh`, and
  that is the real test.
- No widget. The iOS one is WidgetKit and would port, but it is not wired up.
- No HealthKit, deliberately: it does not exist on macOS. `FlowHealth` from
  the iOS shell must not be added to this target, and if the two are ever
  merged, `HKHealthStore()` has to move behind
  `#if !os(macOS)` — it is constructed as a stored property today, before any
  `isHealthDataAvailable()` guard runs.
- No speech input. `SFSpeechRecognizer` exists on macOS; the iOS
  `FlowSpeech.swift` is close to portable but uses `AVAudioSession`, which
  does not.
