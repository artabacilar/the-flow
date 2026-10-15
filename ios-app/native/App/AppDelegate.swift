import UIKit

/// No storyboard, no framework, no dependency graph. The shell exists to put a
/// web view on screen and to carry one token across a process boundary — and a
/// build that resolves nothing is a build that still opens in two years.
///
/// The window is made in SceneDelegate: iOS 27 refuses to launch an app that
/// builds it here (see that file). What stays here is what belongs to the
/// process rather than to a window — push registration, above all.
@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        /* Not a permission prompt — only a token refresh for a phone that has
           already said yes. iOS hands out a new token after a reinstall or a
           restore without telling anybody, and a server holding the old one
           pushes into nothing, silently, forever. */
        FlowPush.refreshIfAlreadyAllowed()
        return true
    }

    /* The same configuration the Info.plist manifest declares, stated in
       code as well, so the scene still gets its delegate if the plist key is
       ever lost in a regeneration. Must agree with make-native.js. */
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    /* iOS answers registerForRemoteNotifications() here, asynchronously and
       possibly long after the call. */
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        FlowPush.deviceToken = token.map { String(format: "%02x", $0) }.joined()
        FlowPush.lastError = nil
        FlowPush.registerWithServer()
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        /* The common causes are no Push Notifications capability on the
           target, or a Simulator older than iOS 16 — neither of which the
           person can do anything about, so it is logged, not shown. */
        FlowPush.deviceToken = nil
        FlowPush.lastError = error.localizedDescription
        NSLog("[flow/push] registration failed: %@", error.localizedDescription)
    }
}

enum FlowTheme {
    /// Matches the page's own background, so the gap before first paint and the
    /// rubber-band overscroll are the same colour as the app rather than white.
    static let background = UIColor(red: 0x0a / 255.0,
                                    green: 0x0b / 255.0,
                                    blue: 0x0d / 255.0,
                                    alpha: 1)
}
