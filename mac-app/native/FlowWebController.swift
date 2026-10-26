import AppKit
import WebKit

/// The window's one and only content: the site, in a web view.
final class FlowWebController: NSViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    static let home = URL(string: "https://theflow.today")!
    /// The near-black the page starts on, before it has said anything.
    static let defaultBackground = NSColor(red: 0.039, green: 0.043, blue: 0.051, alpha: 1)

    private var webView: WKWebView!
    private let notes = FlowNotifications()
    /* Held here so a recognition that is running survives the call that started it. */
    private let speech = FlowSpeech()
    private var themeObservation: NSKeyValueObservation?

    /// Called with the page's theme colour whenever it changes — the
    /// `<meta name="theme-color">` the page rewrites when the person picks a
    /// theme. nil means the page has none; the window keeps the default.
    var onThemeColor: ((NSColor?) -> Void)?

    override func loadView() {
        let config = WKWebViewConfiguration()

        /* The session cookie lives here. Use the default store, not a
           non-persistent one, or the app signs itself out every launch. */
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = WKUserContentController()
        controller.add(self, name: FlowMacBridge.channel)
        /* Both at documentStart: the page reads display-mode while it is
           still parsing, and the bridge has to exist before anything calls
           it. */
        controller.addUserScript(WKUserScript(source: FlowMacBridge.standaloneShim,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(source: FlowMacBridge.shim,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        /* The page is near-black; the web view's own backdrop is white, and
           it shows for a frame on load and while over-scrolling. This is the
           public way to change it — setValue(false, forKey: "drawsBackground")
           is the widely copied alternative and it is undeclared API, which is
           not worth a rejection on an app that is already in review once. */
        webView.underPageBackgroundColor = FlowWebController.defaultBackground
        view = webView

        /* Chrome paints an installed site's title bar in the page's
           theme-color, which is why the same site there reads as one black
           slab and here had a grey system bar on top. WKWebView reports the
           same meta tag as `themeColor`, and it is observable — so the
           window can follow it, including when the person switches to one of
           the light themes. */
        themeObservation = webView.observe(\.themeColor, options: [.initial, .new]) { [weak self] web, _ in
            guard let self else { return }
            let color = web.themeColor
            web.underPageBackgroundColor = color ?? FlowWebController.defaultBackground
            self.onThemeColor?(color)
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        notes.attach(webView)
        webView.load(URLRequest(url: FlowWebController.home))
    }

    // MARK: - Menu actions

    @objc func reload() { webView.reloadFromOrigin() }
    @objc func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2.0) }
    @objc func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }
    @objc func zoomReset() { webView.pageZoom = 1.0 }

    // MARK: - Navigation

    /* Anything that is not the app itself belongs in the browser. Without
       this, clicking a link to a booking confirmation or a WHOOP page
       replaces the app with that page and there is no way back to it. */
    func webView(_ webView: WKWebView,
                 decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.allow); return }
        if url.host == FlowWebController.home.host || url.scheme == "about" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    /* window.open, target=_blank, and anything else that asks for a second
       window. A web view returns nil here to say "not made" — so the link
       would silently do nothing unless it is handed to the browser. */
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    /* WKWebView implements none of alert, confirm or prompt. The app uses all
       three, and without these they return instantly with the default — a
       confirm() that always answers "no", silently. */
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler done: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
        a.beginSheetModal(for: view.window!) { _ in done() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler done: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: view.window!) { r in done(r == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler done: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.beginSheetModal(for: view.window!) { r in
            done(r == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    /* <input type="file"> — a receipt photo, a bank CSV, a profile photo.
       WKWebView on the Mac shows no picker unless the app opens one itself;
       without this the button did nothing at all. */
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler done: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: view.window!) { r in
            done(r == .OK ? panel.urls : nil)
        }
    }

    /* Offline, or the server asleep. Showing WebKit's own error page would
       say "Safari cannot open the page", naming a browser this is not. */
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showOffline(error)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showOffline(error)
    }
    private func showOffline(_ error: Error) {
        /* -999 is "a newer navigation replaced this one", which is normal and
           not a failure anybody needs told about. */
        if (error as NSError).code == NSURLErrorCancelled { return }
        let html = """
        <html><body style="background:#0a0b0d;color:#8b8f98;font:15px -apple-system,sans-serif;
        display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
        <div><p style="color:#e8eaed;font-size:17px">The Flow could not be reached.</p>
        <p>Check your connection, then choose View → Reload.</p></div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - Bridge

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        let id = body["id"] as? String
        switch action {
        case "voiceStart":
            let tag = (body["locale"] as? String) ?? "en-GB"
            if let problem = speech.start(locale: tag, emit: { [weak self] type, payload in self?.emitVoice(type, payload) }) {
                answer(id, ["ok": false, "error": problem])
            } else {
                answer(id, ["ok": true])
            }
        case "voiceStop":
            speech.stop(); answer(id, ["ok": true])
        case "voiceCancel":
            speech.cancel(); emitVoice("end", [:]); answer(id, ["ok": true])
        case "voicePermission":
            answer(id, FlowSpeech.permissions())
        case "voiceRequest":
            FlowSpeech.request { [weak self] state in self?.answer(id, state) }
        default:
            notes.handle(action: action, body: body, id: id)
        }
    }

    /* Replies go back through the same door the notification calls use. */
    private func answer(_ id: String?, _ payload: [String: Any]) {
        guard let id,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8),
              let q = try? String(data: JSONSerialization.data(withJSONObject: [id]), encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("window.__flowMacReply(\(q.dropFirst().dropLast()), \(json))")
        }
    }

    /* Recognition is a stream: results are pushed, not answered. */
    private func emitVoice(_ type: String, _ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8),
              let q = try? String(data: JSONSerialization.data(withJSONObject: [type]), encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("window.__flowVoiceEvent && window.__flowVoiceEvent(\(q.dropFirst().dropLast()), \(json))")
        }
    }
}
