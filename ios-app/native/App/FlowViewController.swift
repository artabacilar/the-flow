import UIKit
import WebKit
import WidgetKit

/// The whole app, in one screen: the page on the server, plus the one native
/// capability the page cannot have — writing a token somewhere the widget's
/// separate process can read it.
///
/// Deliberately not a Capacitor app. The only thing Capacitor was providing was
/// the plugin bridge below, and buying it cost a CocoaPods install that nobody
/// can run without a Mac shell. Twenty lines of `WKScriptMessageHandler` is the
/// entire replacement, and the web app does not need to know the difference:
/// it still calls `window.Capacitor.Plugins.FlowBridge.setToken(...)`.
final class FlowViewController: UIViewController {

    private var webView: WKWebView!
    private let refresher = UIRefreshControl()
    private lazy var offline = OfflineView(retry: { [weak self] in self?.load() })

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = FlowTheme.background
        buildWebView()
        buildOfflineView()
        load()

        NotificationCenter.default.addObserver(
            self, selector: #selector(didBecomeActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    /// Coming back to the app after a while should not show yesterday. The page
    /// syncs on its own, but only if it is still alive — if iOS reclaimed the
    /// web content process we get a blank view and must reload.
    @objc private func didBecomeActive() {
        if webView.url == nil { load() }
    }

    // MARK: - Web view

    private func buildWebView() {
        let controller = WKUserContentController()
        controller.add(self, name: FlowBridge.channel)
        controller.addUserScript(WKUserScript(source: FlowBridge.shim,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = controller
        /// The default data store is the persistent one, which is what keeps the
        /// session cookie across launches. An ephemeral store would sign the
        /// person out every cold start.
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = FlowTheme.background
        webView.scrollView.backgroundColor = FlowTheme.background
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        refresher.tintColor = .white
        refresher.addTarget(self, action: #selector(pulled), for: .valueChanged)
        webView.scrollView.refreshControl = refresher

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func buildOfflineView() {
        offline.translatesAutoresizingMaskIntoConstraints = false
        offline.isHidden = true
        view.addSubview(offline)
        NSLayoutConstraint.activate([
            offline.topAnchor.constraint(equalTo: view.topAnchor),
            offline.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            offline.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            offline.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func load() {
        offline.isHidden = true
        var request = URLRequest(url: FlowStore.origin)
        request.cachePolicy = .useProtocolCachePolicy
        request.timeoutInterval = 30
        webView.load(request)
    }

    @objc private func pulled() {
        webView.reload()
    }
}

// MARK: - Navigation

extension FlowViewController: WKNavigationDelegate, WKUIDelegate {

    /// Anything that is not the app itself belongs in Safari, not inside the
    /// shell — a person who taps a link to their bank should land in their
    /// browser, with the address bar they can check.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow); return
        }
        let internalHost = url.host == FlowStore.origin.host
        let webScheme = url.scheme == "https" || url.scheme == "http"

        if internalHost || !webScheme {
            if !webScheme, UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel); return
            }
            decisionHandler(.allow); return
        }

        if navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    /// target="_blank" has no window to open into here, so load it in place
    /// rather than silently swallowing the tap.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, navigationAction.targetFrame == nil {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refresher.endRefreshing()
        offline.isHidden = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    private func failed(_ error: Error) {
        refresher.endRefreshing()
        /// A cancelled navigation is what every redirect and every fast second
        /// tap looks like. Showing "no connection" for those would be a lie.
        if (error as NSError).code == NSURLErrorCancelled { return }
        if webView.url == nil { offline.isHidden = false }
    }

    // MARK: - JavaScript dialogs
    //
    // WKWebView shows none of alert(), confirm() or prompt() on its own. With
    // these three methods missing — and they were — it does not fail loudly
    // either: alert() does nothing, confirm() returns false, and prompt()
    // returns nil. Silently.
    //
    // So every confirmation in the app answered "no" without asking anybody.
    // Sign out did nothing. Change password did nothing. And Delete account,
    // which Apple requires to work from inside the app, could never have run
    // at all. None of it showed up in the simulator because none of it was
    // ever tapped there.

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(dialog: a, otherwise: completionHandler)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(dialog: a, otherwise: { completionHandler(false) })
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { field in
            field.text = defaultText
            /// A prompt asking for a password should not print it across the
            /// screen. The web side no longer asks this way, but a browser
            /// dialog that leaks the thing it is asking for is worth closing
            /// off here too, for whatever asks next.
            if prompt.range(of: "password", options: .caseInsensitive) != nil {
                field.isSecureTextEntry = true
                field.textContentType = .password
            }
        }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { [weak a] _ in
            completionHandler(a?.textFields?.first?.text ?? "")
        })
        present(dialog: a, otherwise: { completionHandler(nil) })
    }

    /// A page can ask for a second dialog while one is already up, and
    /// presenting over a presented controller throws. Answering the handler is
    /// not optional: WKWebView blocks that frame's JavaScript until it is
    /// called, so dropping it hangs the page for good.
    private func present(dialog: UIAlertController, otherwise cancel: @escaping () -> Void) {
        guard presentedViewController == nil, view.window != nil else { cancel(); return }
        present(dialog, animated: true)
    }

    /// iOS kills the web content process under memory pressure. Without this the
    /// app comes back to a white rectangle and no way out of it.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load()
    }
}

// MARK: - The bridge

enum FlowBridge {
    static let channel = "flowBridge"

    /// Stands in for the Capacitor plugin the web app already knows how to call.
    /// Same shape, same promise, no framework: `SettingsUI.nativeToken` cannot
    /// tell which one it is talking to, and in a browser neither exists and the
    /// call quietly does nothing — which is the behaviour it was written for.
    static let shim = """
    (function () {
      var post = window.webkit && window.webkit.messageHandlers
                 && window.webkit.messageHandlers.\(channel);
      if (!post) return;
      var n = 0, waiting = {};
      window.__flowBridgeResolve = function (id, value) {
        var f = waiting[id]; delete waiting[id]; if (f) f(value || {});
      };
      function call(method, args) {
        return new Promise(function (resolve) {
          var id = 'b' + (++n);
          waiting[id] = resolve;
          post.postMessage({ id: id, method: method, args: args || {} });
        });
      }
      window.Capacitor = window.Capacitor || {};
      window.Capacitor.Plugins = window.Capacitor.Plugins || {};
      window.Capacitor.Plugins.FlowBridge = {
        setToken: function (a) { return call('setToken', a); },
        status:   function ()  { return call('status'); },
        clear:    function ()  { return call('clear'); }
      };
      window.__FLOW_NATIVE = 'ios';
    })();
    """
}

extension FlowViewController: WKScriptMessageHandler {

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let method = body["method"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]

        var result: [String: Any] = [:]

        switch method {
        case "setToken":
            let token = (args["token"] as? String) ?? ""
            FlowStore.token = token.isEmpty ? nil : token
            WidgetCenter.shared.reloadAllTimelines()
            result = ["connected": FlowStore.isConnected]

        case "status":
            result = ["connected": FlowStore.isConnected, "appGroup": FlowStore.appGroup]

        case "clear":
            /// Signing out has to take the widget's copy with it. A widget left
            /// showing a signed-out person's day is the worst version of this bug.
            FlowStore.token = nil
            WidgetCenter.shared.reloadAllTimelines()

        default:
            return
        }

        let json = (try? JSONSerialization.data(withJSONObject: result))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        webView.evaluateJavaScript("window.__flowBridgeResolve(\(quote(id)), \(json))")
    }

    private func quote(_ s: String) -> String {
        let escaped = s.replacingOccurrences(of: "\\", with: "\\\\")
                       .replacingOccurrences(of: "'", with: "\\'")
        return "'\(escaped)'"
    }
}

// MARK: - Offline

/// Shown only when there is nothing on screen at all. If the page already
/// loaded once, a failed reload leaves the person's day visible, which is far
/// more useful than replacing it with an apology.
private final class OfflineView: UIView {

    private let retry: () -> Void

    init(retry: @escaping () -> Void) {
        self.retry = retry
        super.init(frame: .zero)
        backgroundColor = FlowTheme.background

        let title = UILabel()
        title.text = "The Flow can't reach the server"
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        title.textColor = .white
        title.textAlignment = .center
        title.numberOfLines = 0

        let detail = UILabel()
        detail.text = "Your data is safe on the server. This is the connection, not the app."
        detail.font = .systemFont(ofSize: 14)
        detail.textColor = UIColor.white.withAlphaComponent(0.55)
        detail.textAlignment = .center
        detail.numberOfLines = 0

        let button = UIButton(type: .system)
        button.setTitle("Try again", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        button.addTarget(self, action: #selector(tapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, detail, button])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -32),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func tapped() { retry() }
}
