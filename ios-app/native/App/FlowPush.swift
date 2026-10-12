import UIKit
import UserNotifications

/// Getting this phone a device token, and giving it to the server.
///
/// The shape of the thing
/// ----------------------
/// Permission is asked once, by the person, from a switch on the Settings
/// screen — never on launch. An app that opens with a permission sheet before
/// it has shown you anything gets denied, and iOS only asks once: a "no" on
/// first launch is permanent until somebody goes into Settings.app and finds
/// the toggle, which nobody does.
///
/// After permission, iOS hands the app a token on EVERY launch, and it can
/// change without warning — reinstall, restore from backup, some OS updates.
/// So registration is not a one-off at sign-up; it happens whenever iOS gives
/// us one, and the server treats a token it already has as a refresh rather
/// than a second device.
///
/// Sandbox and production are different token namespaces at Apple, and a
/// token sent to the wrong host answers BadDeviceToken — which looks exactly
/// like a broken signing key and costs an afternoon. The device knows which
/// it is; the server does not; so the device says (see `env`).
enum FlowPush {

    /// Set by the AppDelegate the moment iOS answers, read when the page asks.
    static var deviceToken: String?
    static var lastError: String?

    /// Which APNs environment this build's tokens belong to — read from what
    /// the build was actually signed with, not guessed.
    ///
    /// A build installed from Xcode carries embedded.mobileprovision, and its
    /// aps-environment says which: `development` means sandbox. A build from
    /// App Store Connect — the App Store, and TestFlight too — carries no
    /// profile at all and is always production.
    ///
    /// An earlier version guessed from the receipt: TestFlight's is named
    /// "sandboxReceipt". That is the in-app-purchase sandbox, not APNs, and it
    /// labelled every TestFlight phone sandbox — so every send to one would
    /// have come back BadDeviceToken.
    static let env: String = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              /* The profile is a signed envelope around a plain-text plist.
                 Latin-1 maps every byte to a character, so this never fails,
                 and the plist part reads as itself. */
              let text = String(data: data, encoding: .isoLatin1),
              let key = text.range(of: "<key>aps-environment</key>") else { return "production" }
        let rest = text[key.upperBound...]
        guard let open = rest.range(of: "<string>"),
              let close = rest.range(of: "</string>"),
              open.upperBound <= close.lowerBound else { return "production" }
        return rest[open.upperBound..<close.lowerBound] == "development" ? "sandbox" : "production"
    }()

    /// What the page needs to draw the switch correctly: whether iOS has been
    /// asked, what it said, and whether the server has a token for us.
    static func status(_ done: @escaping ([String: Any]) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let granted = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
            DispatchQueue.main.async {
                done([
                    "supported": true,
                    "asked": s.authorizationStatus != .notDetermined,
                    "granted": granted,
                    /// Denied is worth telling apart from not-yet-asked: the
                    /// only way out of denied is Settings.app, and the page
                    /// should say so rather than offering a button that
                    /// silently does nothing.
                    "denied": s.authorizationStatus == .denied,
                    "token": FlowPush.deviceToken != nil,
                    "env": FlowPush.env
                ])
            }
        }
    }

    static func request(_ done: @escaping ([String: Any]) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, err in
            if granted {
                /// Must be on the main thread, and must happen every time —
                /// this is what produces the token.
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            }
            if let err { FlowPush.lastError = err.localizedDescription }
            FlowPush.status(done)
        }
    }

    /// Called once iOS has a token, and after every launch where permission
    /// already exists. Posts it to the server, which scopes it to whoever is
    /// signed in on that session.
    static func registerWithServer(_ done: ((Bool) -> Void)? = nil) {
        guard let token = deviceToken,
              let url = URL(string: "https://theflow.today/api/push/register") else { done?(false); return }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: [
            "token": token, "env": env, "platform": "ios"
        ])
        /// The session cookie lives in the shared store the web view uses, so
        /// this request is authenticated as the same person without the shell
        /// ever handling a credential.
        URLSession.shared.dataTask(with: r) { _, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code != 200 { FlowPush.lastError = "the server answered \(code)" }
            done?(code == 200)
        }.resume()
    }

    /// If permission already exists, ask iOS for the token again on launch.
    /// Cheap, and it is how a changed token ever reaches the server.
    static func refreshIfAlreadyAllowed() {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            guard s.authorizationStatus == .authorized || s.authorizationStatus == .provisional else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }
}
