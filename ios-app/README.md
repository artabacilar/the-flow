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

`npx cap add ios` generates the Xcode project into `ios/` beside these. That
generated folder is disposable: everything worth keeping is in `native/`, which
you copy in once during setup. Deliberately kept out of the repo root so that
Render, which only ever runs the server, never installs a build toolchain it
has no use for.

## Two values only you can supply

Everything below has a placeholder in it. Replace both before the first build:

    APP NAME        The name under the icon and on the store listing.
                    Placeholder: The Flow
    BUNDLE ID       Reverse-DNS, unique to you, and permanent — Apple will not
                    let you change it after the first upload.
                    Placeholder: com.example.theflow

    App Group       Derived from the bundle id: group.<bundle id>
                    Placeholder: group.com.example.theflow

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

## Getting it onto the store

    npm run sync
    Xcode → Product → Archive → Distribute App

First submission needs: an Apple Developer account (99 USD a year), a privacy
policy URL, a support URL, and a screenshot from a 6.7" phone. Review is
usually a day or two.

One thing to know going in: Apple rejects apps that are only a website in a
box, under guideline 4.2. This one has an argument — it holds your data, works
from the home screen, and ships a widget that is native and does something the
website cannot. Lead the review notes with the widget.
