# The Flow on Apple Watch

Two targets in the iOS project, added once in Xcode:

| Target | Type | Bundle id | Files |
| --- | --- | --- | --- |
| **FlowWatch** | watchOS App (for the existing iOS app) | `com.abko.theflow.watchkitapp` | `Watch/FlowWatchApp.swift`, `Watch/WatchStore.swift` |
| **FlowComplications** | watchOS Widget Extension, embedded in FlowWatch | `com.abko.theflow.watchkitapp.complications` | `WatchWidget/FlowComplications.swift`, `Watch/WatchStore.swift` |

Both targets: deployment target **watchOS 9.0** (Series 4 and later, SE,
Ultra — every case size), and the App Group **group.com.abko.theflow** in
Signing & Capabilities. In FlowWatch's Info: *Supports Running Without iOS App
Installation* = YES — the watch links itself with a code and talks to the
server directly.

Linking: the watch shows a six-character code; type it in The Flow →
Settings → Watch (or theflow.today/watch).
