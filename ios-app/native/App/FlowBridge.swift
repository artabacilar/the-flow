import Foundation
import WidgetKit
import Capacitor

/// The one job the native shell has that the web app cannot do for itself:
/// take the token the person just made in Settings, put it somewhere the
/// widget's separate process can read, and tell iOS to redraw.
///
/// Everything else — the whole app — is the page on the server. That is the
/// point: the shell stays this small so that changing the app almost never
/// means shipping a build.
@objc(FlowBridge)
public class FlowBridge: CAPPlugin {

    /// Called from the web app once a token exists.
    @objc func setToken(_ call: CAPPluginCall) {
        let token = call.getString("token") ?? ""
        FlowStore.token = token.isEmpty ? nil : token
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve(["connected": FlowStore.isConnected])
    }

    /// So the app can show the truth in Settings rather than assuming.
    @objc func status(_ call: CAPPluginCall) {
        call.resolve([
            "connected": FlowStore.isConnected,
            "appGroup": FlowStore.appGroup
        ])
    }

    /// Signing out must take the widget's copy with it. A widget left showing
    /// a signed-out person's day is the worst version of this bug.
    @objc func clear(_ call: CAPPluginCall) {
        FlowStore.token = nil
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
