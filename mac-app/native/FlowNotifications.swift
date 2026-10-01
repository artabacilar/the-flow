import Foundation
import UserNotifications
import WebKit

/// Reminders that arrive when the app is not in front.
///
/// What this is, and what it is not
/// --------------------------------
/// These are LOCAL notifications: the app asks the system to show something
/// at a time, and the system does, whether or not the app is running. That
/// covers what a planner actually needs — the rock at 09:00, the bedtime, the
/// weekly review on Sunday evening.
///
/// It is not push. Push means a server waking a device that asked for
/// nothing, and that needs an APNs key, a device-token round trip, and a
/// sender on the server side. Worth having eventually; not needed for a
/// reminder the page already knows the time of, and not worth blocking
/// reminders on.
final class FlowNotifications: NSObject, UNUserNotificationCenterDelegate {

    private weak var web: WKWebView?
    private let centre = UNUserNotificationCenter.current()

    func attach(_ webView: WKWebView) {
        web = webView
        centre.delegate = self
    }

    /* A notification that arrives while the app is frontmost is still worth
       showing — the window may be behind something, or on another Space. */
    func userNotificationCenter(_ c: UNUserNotificationCenter,
                                willPresent n: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound, .list])
    }

    func handle(action: String, body: [String: Any], id: String?) {
        switch action {

        case "notifyStatus":
            centre.getNotificationSettings { s in
                self.reply(id, ["supported": true,
                                "granted": s.authorizationStatus == .authorized,
                                "asked": s.authorizationStatus != .notDetermined])
            }

        case "notifyRequest":
            centre.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                self.reply(id, ["supported": true, "granted": granted])
            }

        case "notifySchedule":
            guard let title = body["title"] as? String,
                  let atString = body["at"] as? String,
                  let at = FlowNotifications.iso.date(from: atString) else {
                reply(id, ["ok": false, "error": "title and an ISO-8601 'at' are required"]); return
            }
            /* A reminder for a moment that has passed would fire instantly,
               which reads as a bug rather than a reminder. */
            guard at.timeIntervalSinceNow > 0 else {
                reply(id, ["ok": false, "error": "that time has already passed"]); return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            if let b = body["body"] as? String, !b.isEmpty { content.body = b }
            content.sound = .default

            let notifId = (body["notifId"] as? String) ?? UUID().uuidString
            let parts = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second], from: at)
            let req = UNNotificationRequest(
                identifier: notifId,
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))

            centre.add(req) { err in
                self.reply(id, err == nil ? ["ok": true, "id": notifId]
                                          : ["ok": false, "error": err!.localizedDescription])
            }

        case "notifyCancel":
            guard let notifId = body["notifId"] as? String else {
                reply(id, ["ok": false, "error": "notifId is required"]); return
            }
            centre.removePendingNotificationRequests(withIdentifiers: [notifId])
            reply(id, ["ok": true])

        case "notifyPending":
            centre.getPendingNotificationRequests { reqs in
                let out: [[String: Any]] = reqs.map { r in
                    var when = ""
                    if let t = r.trigger as? UNCalendarNotificationTrigger,
                       let d = t.nextTriggerDate() { when = FlowNotifications.iso.string(from: d) }
                    return ["id": r.identifier, "title": r.content.title, "at": when]
                }
                self.reply(id, ["ok": true, "pending": out])
            }

        default:
            /* The page shares one bridge across platforms. An action this
               platform does not have is an answer, not an error. */
            reply(id, ["supported": false])
        }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private func reply(_ id: String?, _ payload: [String: Any]) {
        guard let id,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.web?.evaluateJavaScript("window.__flowMacReply(\(FlowNotifications.quote(id)), \(json))")
        }
    }

    private static func quote(_ s: String) -> String {
        (try? String(data: JSONSerialization.data(withJSONObject: [s]), encoding: .utf8))
            .map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }
}
