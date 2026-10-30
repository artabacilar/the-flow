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

    /// The code being shown, and the server's id for it, until it is linked
    /// or runs out. Kept so that the watch going dark while the person types
    /// the code on their phone does not throw it away: the screen comes back
    /// to the same code and goes on asking for that one, which is the one the
    /// server is holding the token for.
    struct Pending: Codable { let id: String; let code: String; let until: Date }
    static var pending: Pending? {
        get {
            guard let d = defaults.data(forKey: "watch.pair"),
                  let p = try? JSONDecoder().decode(Pending.self, from: d), p.until > Date() else { return nil }
            return p
        }
        set {
            if let v = newValue, let d = try? JSONEncoder().encode(v) { defaults.set(d, forKey: "watch.pair") }
            else { defaults.removeObject(forKey: "watch.pair") }
        }
    }

    /// When a habit's clock, started on the wrist, is due to end — kept so
    /// that lowering the wrist (and the app being suspended) does not lose it.
    static func timerEnd(_ habit: String) -> Date? {
        let t = defaults.double(forKey: "watch.timer." + habit)
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }
    static func setTimerEnd(_ habit: String, _ end: Date?) {
        if let e = end { defaults.set(e.timeIntervalSince1970, forKey: "watch.timer." + habit) }
        else { defaults.removeObject(forKey: "watch.timer." + habit) }
    }

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

// MARK: - Words

/// The app speaks English and Turkish; the watch follows the watch's own
/// language, and tells the server, so the headline the server writes is in
/// the same one. Titles are the person's own and are never translated.
enum Words {
    static var lang: String { (Locale.preferredLanguages.first ?? "en").lowercased().hasPrefix("tr") ? "tr" : "en" }
    static func t(_ en: String, _ tr: String) -> String { lang == "tr" ? tr : en }
}

// MARK: - The day, as /api/watch sends it

struct WatchDay: Codable, Equatable {
    struct Counts: Codable, Equatable { let today: Int; let todayDone: Int; let overdue: Int }
    struct Next: Codable, Equatable { let id: String; let title: String; let when: String }
    struct Rock: Codable, Equatable, Identifiable {
        let id: String; let title: String; let time: String?
        var done: Bool; let overdue: Bool; let prio: String?; let day: String?
        /// "week", "2weeks" or "month" when it repeats; the server writes the next one when it is ticked.
        let `repeat`: String?
    }
    /// `kind` is the door the habit opens — "write", "timer" or "tick" — read
    /// from its name the way the app reads it, or as chosen in the app.
    struct Habit: Codable, Equatable, Identifiable {
        let id: String; let name: String; var done: Bool
        let kind: String?; let minutes: Int?
        var door: String { kind ?? "tick" }
        var mins: Int { max(1, minutes ?? 10) }
    }
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
    let lang: String?

    var openToday: Int { counts.today }
    var progress: Double { week.total > 0 ? Double(week.done) / Double(week.total) : 0 }
}

// MARK: - The server

enum WatchAPI {
    enum Failure: LocalizedError {
        case notLinked, unlinked, offline, server(String)
        var errorDescription: String? {
            switch self {
            case .notLinked: return Words.t("This watch is not linked yet.", "Bu saat henüz bağlı değil.")
            case .unlinked: return Words.t("This watch was unlinked. Link it again.", "Bu saatin bağlantısı kaldırıldı. Yeniden bağla.")
            case .offline: return Words.t("No connection. Showing the last day it read.", "Bağlantı yok. Son okunan gün gösteriliyor.")
            case .server(let m): return m
            }
        }
    }

    private static func call(_ path: String, method: String = "GET", body: [String: Any]? = nil, auth: Bool = true) async throws -> Data {
        var comps = URLComponents(url: WatchStore.origin.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if path == "api/watch" { comps.queryItems = [URLQueryItem(name: "tz", value: TimeZone.current.identifier), URLQueryItem(name: "lang", value: Words.lang)] }
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
            throw Failure.server(msg ?? Words.t("The server said no (\(code)).", "Sunucu kabul etmedi (\(code))."))
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
        var b = body; b["tz"] = TimeZone.current.identifier; b["lang"] = Words.lang
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
        var req = URLRequest(url: comps.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.setValue("watchOS", forHTTPHeaderField: "X-Flow-Device")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if (resp as? HTTPURLResponse)?.statusCode == 404 { return PairPoll(status: "expired", token: nil, who: nil) }
        return try JSONDecoder().decode(PairPoll.self, from: data)
    }
}
