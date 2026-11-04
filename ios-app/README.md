# The Flow, on iOS

This folder turns the app you already have into something you install from the
App Store, plus a home-screen widget that shows today's Big Rocks without
opening anything.

Nothing here is a rewrite. The app on your phone loads the same page on the
same server — so every change we make from now on reaches your phone the moment
Render finishes deploying, with no App Store review and no new build. The only
time you touch Xcode again is when the native shell itself changes: the icon,
the launch screen, the widget's layout, or a new iOS permission. That is rare.

That is the whole trade, and it is the reason the app is built this way.

## What is here

    native/App/     the shell's one native piece — it hands the widget a token
    native/Widget/  the home-screen widget, written in SwiftUI
    native/Shared/  the one file both of them read, so a token is stored once
    www/            the offline fallback page, and nothing else

`npm run setup` generates the Xcode project into `ios/` beside these, from
`native/`, and `ios/` is committed. Not because it is precious — regenerate
it any time — but because Xcode Cloud builds what is in the repository, and
that is how a shell change reaches every device without anyone sitting at a
Mac (see "Every device, from one push" below). Everything worth editing is
still in `native/`; a Swift file edited there is copied in by `npm run native`
(or `widget`, `watch`), and Xcode Cloud copies it in itself before every
build. The folder is kept out of the repo root so that Render, which only
ever runs the server, never installs a build toolchain it has no use for.

## Its name and its identity

    APP NAME        The Flow — Life OS
    BUNDLE ID       com.abko.theflow
    App Group       group.com.abko.theflow

The bundle id is reverse-DNS off abko.com.tr, which is a domain you actually
own — that is the whole point of the convention, and it is why this is not
`artur.theflow`. A bare first name is not a namespace anybody controls, so it
can collide with a stranger's app, and Apple will not let you change it after
the first upload. If you want it different, change it in
`capacitor.config.json` and in `native/Shared/FlowStore.swift` (the App Group
is always `group.` plus the bundle id) — but do it before you submit, because
after that it is permanent.

The App Group is what lets the app hand the widget its token. Both targets must
have the same one enabled in Signing & Capabilities or the widget will show
"Not connected" forever, which is the single most common way this goes wrong.

## Building it the first time

1. From this folder, install the toolchain and generate the project, once:

       cd ios-app
       npm run setup

2. Open it:

       npm run open

3. In Xcode, on the App target: set the display name and bundle id, pick your
   team under Signing, and add the App Group capability.

4. Drag `native/App/FlowBridge.swift` and `native/App/FlowBridge.m` into the App
   target, and `native/Shared/FlowStore.swift` into both targets.

5. File → New → Target → Widget Extension. Name it `FlowWidget`, uncheck
   "Include Configuration Intent". Add the same App Group to it. Replace the
   generated Swift file with `native/Widget/FlowWidget.swift`.

6. Build to your own phone first. Open the app, sign in, go to
   Settings → Connect to Claude, and make a token. The app writes it to the App
   Group; long-press the home screen and add the widget.

## What the widget reads

One endpoint, `GET /api/widget`, with the token as a bearer. It returns today
in a few hundred bytes: what is next, what has no time on it, what was missed,
and how the week stands. It reads and nothing else — there is deliberately no
way to tick a rock from the widget, because the only gesture a widget has is a
tap, and a tap in a coat pocket must not mark a day done.

## Every device, from one push

The shells are built by **Xcode Cloud**, not by a Mac on a desk. A push to
`main` that touches `ios-app/` or `mac-app/` starts a build on Apple's side;
the archive goes to **TestFlight**, and every device signed in as an internal
tester with automatic updates on — iPhone, Apple Watch, and both Macs —
installs it by itself. The App Store release stays a deliberate step.

What the repository provides for that:

    ios/App/App.xcodeproj/xcshareddata/xcschemes/   the schemes Xcode Cloud can
                                                    see: App (iPhone + widget +
                                                    watch) and TheFlowMac
    ios/App/ci_scripts/ci_post_clone.sh             refreshes the copied Swift
                                                    files from native/ first
    ios/App/ci_scripts/ci_pre_xcodebuild.sh         version from version.json,
                                                    build number = 100 + Xcode
                                                    Cloud's own count
    scripts/add-mac-target.js                       the Mac app as a macOS
                                                    target of the same project
    scripts/make-cloud.js                           writes the first three

Both ci scripts live in `scripts/ci_scripts/` and are copied beside the
project by `make-cloud.js`; edit them there. `tests/test-xcode.js` checks all
of this on every push — stale copies, a scheme pointing at a regenerated
target, a script that lost its executable bit — because each of those fails
only on Xcode Cloud, ten minutes later, with a message about something else.

Releasing a new version is one edit: the `version` in `version.json`. The
build number is never edited — Xcode Cloud numbers its own builds.

The workflows themselves (which branch, which scheme, which TestFlight group)
are configured in App Store Connect → the app → Xcode Cloud, once, by the
account holder. The Mac app ships on the same App Store record as the
macOS platform (same bundle id, universal purchase) — see
`mac-app/README.md`, "Universal Purchase".

## Getting it onto the store by hand

    Xcode → Product → Archive → Distribute App

First submission needs: an Apple Developer account (99 USD a year), a privacy
policy URL, a support URL, and a screenshot from a 6.7" phone. Review is
usually a day or two.

One thing to know going in: Apple rejects apps that are only a website in a
box, under guideline 4.2. This one has an argument — it holds your data, works
from the home screen, and ships a widget that is native and does something the
website cannot. Lead the review notes with the widget.
