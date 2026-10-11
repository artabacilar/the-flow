import AppKit

/* The entry point, spelled out — and why it cannot be `@main`.

   `@main` on an NSApplicationDelegate expands to a bare NSApplicationMain().
   That loads the main nib named in Info.plist and takes the delegate from the
   nib's connections. With no nib there is nothing to take it from: the app
   launches, the delegate is never created, applicationDidFinishLaunching never
   runs, and you get a Dock icon with no window and no menu bar. UIKit's
   equivalent passes the delegate's class name and so works without a
   storyboard; AppKit's does not, and this app has no nib on purpose.

   So: make the delegate, hand it over, run. `delegate` is a top-level constant
   in main.swift, which makes it a global that lives for the whole process —
   that matters, because NSApplication holds its delegate weakly. A delegate
   created inline here would be released on the next line. */
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
/* A regular app: Dock icon, menu bar, can be frontmost. This is the default
   for a bundle with an Info.plist, but setting it costs nothing and removes
   one way for a launch to come up invisible. */
app.setActivationPolicy(.regular)
app.run()
