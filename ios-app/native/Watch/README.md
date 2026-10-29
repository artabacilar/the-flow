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

## What it does

- **Today**: the headline, what is next, today's Priorities (open first,
  then the ones that slipped, then what is done) and today's habits. A tap
  ticks; ↻ marks a Priority that repeats — ticking it writes the next one
  on the server, as the app does.
- **Overdue**: tapping a Priority that slipped offers Done, Today or Tomorrow.
- **Habits with a door**: a writing habit ("Write 3 sentences before bed")
  opens a field that takes dictation — saved to the journal under the habit,
  and today is ticked; a timed one ("Meditate 10 min") opens its clock, which
  survives the wrist going down and taps when it ends. The door is read from
  the name, or as chosen in the app.
- **Add by voice**: a Priority for today or tomorrow, or a note.
- **Language**: English or Turkish, following the watch's own language; the
  server writes the headline in the same one.
- **Complications**: circular, corner, inline and rectangular — Priorities
  left today and the next one.
