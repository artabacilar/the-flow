import UIKit
import UserNotifications
import WebKit

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
                    "registered": FlowPush.registered,
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
    ///
    /// The session is the web view's, and the web view does NOT share its
    /// cookies with URLSession. WKWebsiteDataStore keeps its own jar in the
    /// web content process; HTTPCookieStorage.shared, which URLSession.shared
    /// reads, never sees flow_sid. Versions up to 1.0.1 assumed otherwise, so
    /// every registration arrived signed out, the server answered 401, and no
    /// phone was ever registered — while the Settings card said "On". So the
    /// cookie is read from the web view's own store and attached by hand.
    static func registerWithServer(_ done: ((Bool) -> Void)? = nil) {
        guard let token = deviceToken else { done?(false); return }
        DispatchQueue.main.async {
            /* httpCookieStore must be used on the main thread. */
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { all in
                let host = FlowStore.origin.host ?? "theflow.today"
                let ours = all.filter { c in
                    let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
                    return host == d || host.hasSuffix("." + d)
                }
                post(token: token, cookies: ours, done: done)
            }
        }
    }

    private static func post(token: String, cookies: [HTTPCookie], done: ((Bool) -> Void)?) {
        let url = FlowStore.origin.appendingPathComponent("api/push/register")
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (k, v) in HTTPCookie.requestHeaderFields(with: cookies) { r.setValue(v, forHTTPHeaderField: k) }
        /* Never let URLSession add or store cookies of its own on top. */
        r.httpShouldHandleCookies = false
        r.httpBody = try? JSONSerialization.data(withJSONObject: [
            "token": token, "env": env, "platform": "ios"
        ])
        URLSession.shared.dataTask(with: r) { _, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            FlowPush.lastError = code == 200 ? nil : "the server answered \(code)"
            FlowPush.registered = code == 200
            done?(code == 200)
        }.resume()
    }

    /// Whether the server accepted this phone's token on the last attempt.
    static var registered = false

    /// If permission already exists, ask iOS for the token again on launch.
    /// Cheap, and it is how a changed token ever reaches the server.
    static func refreshIfAlreadyAllowed() {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            guard s.authorizationStatus == .authorized || s.authorizationStatus == .provisional else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }
}
