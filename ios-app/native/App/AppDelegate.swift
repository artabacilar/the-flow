import UIKit

/// No storyboard, no framework, no dependency graph. The shell exists to put a
/// web view on screen and to carry one token across a process boundary — and a
/// build that resolves nothing is a build that still opens in two years.
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = FlowViewController()
        w.backgroundColor = FlowTheme.background
        w.makeKeyAndVisible()
        window = w
        return true
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
