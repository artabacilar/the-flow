import Foundation

/// The one thing the app and the widget both need to agree on: where the
/// server is, and which token to present.
///
/// A widget runs in its own process. It cannot read the app's cookies, its
/// web view, or its keychain items unless they are deliberately shared — so
/// this is the seam, and it is kept to one file on purpose. If the widget ever
/// shows "Not connected" while the app is plainly signed in, the App Group is
/// missing from one of the two targets and nothing else is wrong.
enum FlowStore {

    /// Must match the App Group enabled on BOTH targets in Signing &
    /// Capabilities. If the widget says "Not connected" while the app is
    /// plainly signed in, it is because one of the two is missing this.
    static let appGroup = "group.com.abko.theflow"

    static let origin = URL(string: "https://theflow.today")!

    private static let tokenKey = "flow.token"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    /// Written by the app after somebody makes a token in Settings.
    static var token: String? {
        get { defaults?.string(forKey: tokenKey) }
        set {
            guard let d = defaults else { return }
            if let v = newValue, !v.isEmpty { d.set(v, forKey: tokenKey) }
            else { d.removeObject(forKey: tokenKey) }
        }
    }

    static var isConnected: Bool { (token?.isEmpty == false) }
}

/// Today, in the shape the widget draws it.
struct FlowToday: Codable {
    struct Line: Codable {
        let title: String
        let time: String?
        let done: Bool
        let overdue: Bool
    }
    struct Week: Codable {
        let id: String
        let done: Int
        let total: Int
    }

    let date: String
    let weekday: String
    let now: String
    let done: Int
    let total: Int
    let lines: [Line]
    let more: Int
    let week: Week
    let updated: String
}

enum FlowFeed {

    enum Failure: Error {
        /// No token has been written yet — the person has not connected.
        case notConnected
        /// The token was rejected. Distinct from a network problem, because
        /// the widget should say something different about each.
        case unauthorized
        case server(Int)
    }

    static func today() async throws -> FlowToday {
        guard let token = FlowStore.token, !token.isEmpty else {
            throw Failure.notConnected
        }

        var request = URLRequest(url: FlowStore.origin.appendingPathComponent("api/widget"))
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        /// A widget gets woken far more often than a day changes, but a stale
        /// day is worse than a blank one, so revalidate rather than trust the
        /// URL cache.
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0

        if code == 401 { throw Failure.unauthorized }
        guard code == 200 else { throw Failure.server(code) }

        return try JSONDecoder().decode(FlowToday.self, from: data)
    }
}
