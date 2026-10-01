import AppKit
import WebKit

/// The window's one and only content: the site, in a web view.
final class FlowWebController: NSViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    static let home = URL(string: "https://theflow.today")!
    private var webView: WKWebView!
    private let notes = FlowNotifications()

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
        webView.underPageBackgroundColor = NSColor(red: 0.039, green: 0.043, blue: 0.051, alpha: 1)
        view = webView
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
        notes.handle(action: action, body: body, id: body["id"] as? String)
    }
}
