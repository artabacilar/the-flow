import UIKit

/// The window lives here, not in AppDelegate.
///
/// iOS 27 stops any app built against its SDK that has not adopted the scene
/// lifecycle — at launch, before a single line of ours runs, with
/// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` at the top
/// of the crash. Version 1.0.1 was rejected for exactly that on 13 October
/// 2026: built with the new Xcode, it never opened on App Review's phones.
/// 1.0 had been built with the iOS 26 SDK and was let off.
///
/// Adopting it costs one file. The window is made from the scene iOS hands
/// over instead of from the screen, and everything else — the web view, push,
/// the widget — is unchanged. Info.plist names this class in its
/// UIApplicationSceneManifest; make-native.js writes that key.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: windowScene)
        w.rootViewController = FlowViewController()
        w.backgroundColor = FlowTheme.background
        w.makeKeyAndVisible()
        window = w
    }
}
