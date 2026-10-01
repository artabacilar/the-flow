import Foundation

/// What gets injected into the page before any of its own script runs.
enum FlowMacBridge {

    static let channel = "flowBridge"

    /// The one line that makes this window look like the Chrome one.
    ///
    /// The app already has a mode for "installed rather than visited": it
    /// lands on Today and rearranges its navigation. It decides by asking
    /// `matchMedia('(display-mode: standalone)')`. Chrome answers yes to an
    /// installed window; a WKWebView answers no, because nothing told it
    /// otherwise. That single false is most of the difference between the two
    /// screenshots — same site, same width, different mode.
    ///
    /// So the answer is corrected at the source, for that one query only.
    /// Every other media query still goes to the real implementation, which
    /// matters: the layout is driven by width queries and breaking those
    /// would trade one wrong answer for a dozen.
    static let standaloneShim = """
    (function () {
      var real = window.matchMedia.bind(window);
      window.matchMedia = function (q) {
        if (typeof q === 'string' && q.indexOf('display-mode') !== -1) {
          var standalone = q.indexOf('standalone') !== -1;
          var m = real(q);
          /* A MediaQueryList is not extensible in place, so hand back
             something that answers `matches` and forwards the rest. */
          return {
            media: q,
            matches: standalone ? true : m.matches,
            onchange: null,
            addListener: function (f) { m.addListener(f); },
            removeListener: function (f) { m.removeListener(f); },
            addEventListener: function (t, f) { m.addEventListener(t, f); },
            removeEventListener: function (t, f) { m.removeEventListener(t, f); },
            dispatchEvent: function (e) { return m.dispatchEvent(e); }
          };
        }
        return real(q);
      };
    })();
    """

    /// Reminders, for the page to call. Deliberately the same channel name
    /// the iOS shell uses, so the page has one bridge to learn rather than
    /// two — a call the running platform does not implement simply resolves
    /// with `supported: false` instead of throwing.
    static let shim = """
    (function () {
      var post = window.webkit && window.webkit.messageHandlers
                 && window.webkit.messageHandlers.\(channel);
      if (!post) return;
      var waiting = {}, n = 0;
      window.__flowMacReply = function (id, payload) {
        var f = waiting[id]; delete waiting[id];
        if (f) f(payload);
      };
      function call(action, args) {
        return new Promise(function (resolve) {
          var id = 'm' + (++n);
          waiting[id] = resolve;
          var msg = { action: action, id: id };
          for (var k in (args || {})) msg[k] = args[k];
          post.postMessage(msg);
        });
      }
      window.FlowMac = {
        platform: 'macos',
        notifications: {
          status:  function ()      { return call('notifyStatus'); },
          request: function ()      { return call('notifyRequest'); },
          /* at: an ISO-8601 instant. Returns {ok, id} so the page can cancel
             a reminder it later moves or removes. */
          schedule: function (o)    { return call('notifySchedule', o); },
          cancel:  function (id)    { return call('notifyCancel', { notifId: id }); },
          pending: function ()      { return call('notifyPending'); }
        }
      };
    })();
    """
}
