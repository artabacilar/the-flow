import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// What the watch app and its complications share: the token the watch was
/// given when it was linked, and the last day it read — so a complication
/// can draw something the instant the face wakes, and the app can open on
/// the day it last saw while it asks for a fresh one.
///
/// Compiled into BOTH watch targets (the app and the complications). The App
/// Group must be enabled on both in Signing & Capabilities; without it the
/// complication reads nothing and says "Open The Flow".
enum WatchStore {
    static let appGroup = "group.com.abko.theflow"
    static let origin = URL(string: "https://theflow.today")!

    private static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    static var token: String? {
        get { defaults.string(forKey: "watch.token") }
        set { if let v = newValue, !v.isEmpty { defaults.set(v, forKey: "watch.token") } else { defaults.removeObject(forKey: "watch.token") } }
    }
    static var who: String {
        get { defaults.string(forKey: "watch.who") ?? "" }
        set { defaults.set(newValue, forKey: "watch.who") }
    }
    static var isLinked: Bool { !(token ?? "").isEmpty }

    static var lastDay: WatchDay? {
        get {
            guard let d = defaults.data(forKey: "watch.day") else { return nil }
            return try? JSONDecoder().decode(WatchDay.self, from: d)
        }
        set {
            if let v = newValue, let d = try? JSONEncoder().encode(v) { defaults.set(d, forKey: "watch.day") }
            else { defaults.removeObject(forKey: "watch.day") }
        }
    }

    static func unlink() {
        token = nil; who = ""; lastDay = nil
        reloadComplications()
    }

    static func reloadComplications() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    /// "Watch6,9" — enough to tell two watches apart in Settings, and nothing
    /// about the person wearing it.
    static var model: String {
        var u = utsname(); uname(&u)
        let m = Mirror(reflecting: u.machine).children.compactMap { $0.value as? Int8 }.filter { $0 != 0 }
        return String(decoding: m.map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }
}

// MARK: - The day, as /api/watch sends it

struct WatchDay: Codable, Equatable {
    struct Counts: Codable, Equatable { let today: Int; let todayDone: Int; let overdue: Int }
    struct Next: Codable, Equatable { let id: String; let title: String; let when: String }
    struct Rock: Codable, Equatable, Identifiable {
        let id: String; let title: String; let time: String?
        var done: Bool; let overdue: Bool; let prio: String?; let day: String?
    }
    struct Habit: Codable, Equatable, Identifiable { let id: String; let name: String; var done: Bool }
    struct Week: Codable, Equatable { let id: String; let done: Int; let total: Int; let more: Int }

    let date: String
    let weekday: String
    let now: String
    let counts: Counts
    let headline: String
    let next: Next?
    var rocks: [Rock]
    var habits: [Habit]
    let week: Week
    let updated: String

    var openToday: Int { counts.today }
    var progress: Double { week.total > 0 ? Double(week.done) / Double(week.total) : 0 }
}

// MARK: - The server

enum WatchAPI {
    enum Failure: LocalizedError {
        case notLinked, unlinked, offline, server(String)
        var errorDescription: String? {
            switch self {
            case .notLinked: return "This watch is not linked yet."
            case .unlinked: return "This watch was unlinked. Link it again."
            case .offline: return "No connection. Showing the last day it read."
            case .server(let m): return m
            }
        }
    }

    private static func call(_ path: String, method: String = "GET", body: [String: Any]? = nil, auth: Bool = true) async throws -> Data {
        var comps = URLComponents(url: WatchStore.origin.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if path == "api/watch" { comps.queryItems = [URLQueryItem(name: "tz", value: TimeZone.current.identifier)] }
        var req = URLRequest(url: comps.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        req.httpMethod = method
        req.setValue("watchOS", forHTTPHeaderField: "X-Flow-Device")
        if auth {
            guard let t = WatchStore.token, !t.isEmpty else { throw Failure.notLinked }
            req.setValue("Bearer " + t, forHTTPHeaderField: "Authorization")
        }
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: req) }
        catch { throw Failure.offline }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 && auth { WatchStore.token = nil; WatchStore.lastDay = nil; throw Failure.unlinked }
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure.server(msg ?? "The server said no (\(code)).")
        }
        return data
    }

    /// `redraw: false` from the complications themselves — asking WidgetKit
    /// to reload from inside a reload is a loop.
    static func today(redraw: Bool = true) async throws -> WatchDay {
        let d = try JSONDecoder().decode(WatchDay.self, from: try await call("api/watch"))
        WatchStore.lastDay = d
        if redraw { WatchStore.reloadComplications() }
        return d
    }

    /// One round trip: the change, and the day as it now is.
    static func act(_ body: [String: Any]) async throws -> WatchDay {
        var b = body; b["tz"] = TimeZone.current.identifier
        let d = try JSONDecoder().decode(WatchDay.self, from: try await call("api/watch", method: "POST", body: b))
        WatchStore.lastDay = d
        WatchStore.reloadComplications()
        return d
    }

    struct PairStart: Decodable { let id: String; let code: String; let expiresIn: Int; let poll: Int? }
    struct PairPoll: Decodable { let status: String; let token: String?; let who: String? }

    static func startPairing() async throws -> PairStart {
        try JSONDecoder().decode(PairStart.self, from: try await call("api/watch/pair", method: "POST", body: ["device": "watchos", "model": WatchStore.model], auth: false))
    }

    /// nil while waiting; throws when the code has expired.
    static func pollPairing(_ id: String) async throws -> PairPoll {
        var comps = URLComponents(url: WatchStore.origin.appendingPathComponent("api/watch/pair"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "id", value: id)]
        let (data, resp) = try await URLSession.shared.data(from: comps.url!)
        if (resp as? HTTPURLResponse)?.statusCode == 404 { return PairPoll(status: "expired", token: nil, who: nil) }
        return try JSONDecoder().decode(PairPoll.self, from: data)
    }
}
