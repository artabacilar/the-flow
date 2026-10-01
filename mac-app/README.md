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

    native/AppDelegate.swift        the window, and the menu bar
    native/FlowWebController.swift  the web view, links, dialogs, offline
    native/FlowMacBridge.swift      what is injected before the page runs
    native/FlowNotifications.swift  reminders

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

## Building it the first time

1. **Xcode → File → New → Project → macOS → App.**
   - Product Name: `The Flow`
   - Team: **ABKO İÇ VE DIŞ TİCARET LİMİTED ŞİRKETİ (CFDZ32QZUR)**
   - Organization Identifier: `com.abko` → bundle id becomes `com.abko.theflow`
   - Interface: **AppKit** · Language: **Swift**

2. **Delete the storyboard**, or two windows open at launch and one is empty.
   - Delete `Main.storyboard`.
   - Target → Info → remove the **Main storyboard file base name** row
     (`NSMainStoryboardFile`).

3. **Replace the generated `AppDelegate.swift`** with the one in `native/`,
   and drag in the other three files. Tick *Copy items if needed*.

4. **Signing & Capabilities:**
   - **App Sandbox** → Network → tick **Outgoing Connections (Client)**.
     Without it the window is permanently on the offline page.
   - **Push Notifications** is *not* needed — these are local notifications.

5. **Info.plist** — add:

       NSUserNotificationsUsageDescription
       The Flow uses notifications to remind you about your Big Rocks and habits.

6. Set **Minimum Deployment** to macOS 13.0.

Run it. You should get the same window as the Chrome one, minus Chrome.

## Universal Purchase, and what it replaces

To ship this on the same App Store listing rather than as a second app:

- Same bundle id as iOS — `com.abko.theflow` — and in App Store Connect,
  **Add Platform → macOS** on the existing app record.
- Apple then stops offering the iOS build on the Mac App Store. From their
  own help: *"When an app supports universal purchase and already has a
  presence on the Mac App Store through the macOS platform, you won't have
  the option to offer the iOS app on the Mac App Store."* That is the point —
  this replaces "Designed for iPad", it does not sit beside it.
- The **"Not verified for macOS"** label on the listing belongs to the
  Designed-for-iPad route and goes with it.

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

- **Nothing in this folder has been compiled.** It was written without a Mac.
  Expect to fix something on first build.
- No widget. The iOS one is WidgetKit and would port, but it is not wired up.
- No HealthKit, deliberately: it does not exist on macOS. `FlowHealth` from
  the iOS shell must not be added to this target, and if the two are ever
  merged, `HKHealthStore()` has to move behind
  `#if !os(macOS)` — it is constructed as a stored property today, before any
  `isHealthDataAvailable()` guard runs.
- No speech input. `SFSpeechRecognizer` exists on macOS; the iOS
  `FlowSpeech.swift` is close to portable but uses `AVAudioSession`, which
  does not.
