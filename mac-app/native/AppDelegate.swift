import AppKit
import WebKit

/// The Flow, as a Mac app.
///
/// Why this exists, when the iPhone app already runs on Apple silicon
/// ------------------------------------------------------------------
/// It does run — the App Store lists it as "Designed for iPad" — but what you
/// get is the iPad binary in an iPad-shaped window. The page decides its
/// layout from the viewport it is given, so at iPad width it draws the narrow
/// layout with the bottom bar. Side by side with the same site installed from
/// Chrome as a desktop window, the difference is not subtle, and no setting in
/// App Store Connect closes it.
///
/// So this is the other half: a real Mac app, which is a real resizable
/// window, which is a desktop viewport, which is the layout you actually
/// wanted. It is deliberately thin — the app is the website, exactly as the
/// iOS shell is, and every server deploy still reaches it with no new build.
@main
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var window: NSWindow!
    private var web: FlowWebController!

    func applicationDidFinishLaunching(_ note: Notification) {
        web = FlowWebController()

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)

        window.title = "The Flow — Life OS"
        /* Below this the sidebar collapses and the layout starts fighting
           itself. Letting somebody drag to 300pt wide only produces a window
           they then have to fix. */
        window.minSize = NSSize(width: 960, height: 640)
        window.contentViewController = web
        /* The page is near-black. Without this the window flashes white for
           the length of one frame on every launch, which is the single most
           obvious tell that something is a web view in a box. */
        window.backgroundColor = NSColor(red: 0.039, green: 0.043, blue: 0.051, alpha: 1)
        window.isReleasedWhenClosed = false

        /* Remembers where it was and how big, per the standard AppKit
           mechanism, so it opens where you left it rather than centred every
           time. setFrameAutosaveName returns false when it restored nothing,
           which is the first launch — that is when centring is right. */
        if !window.setFrameAutosaveName("FlowMainWindow") {
            window.center()
        }

        buildMenu()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /* Clicking the dock icon with no window open should bring it back, not sit
       there doing nothing. */
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    /* macOS 14 logs a warning on every launch without this, and the answer
       for an app whose entire state lives on a server is yes. */
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: - Menus

    /* A window with no menu bar has no Copy, no Paste, no Select All and no
       ⌘Q — AppKit does not supply them, the menu items are what wire the
       responder chain up. An app that cannot paste into its own text fields is
       the other obvious tell, so this is not decoration. */
    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About The Flow", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide The Flow", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit The Flow", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(redo)
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(FlowWebController.reload), keyEquivalent: "r")
        view.addItem(.separator())
        view.addItem(withTitle: "Actual Size", action: #selector(FlowWebController.zoomReset), keyEquivalent: "0")
        view.addItem(withTitle: "Zoom In", action: #selector(FlowWebController.zoomIn), keyEquivalent: "+")
        view.addItem(withTitle: "Zoom Out", action: #selector(FlowWebController.zoomOut), keyEquivalent: "-")
        view.addItem(.separator())
        let full = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        view.addItem(full)
        viewItem.submenu = view

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }
}
