import WidgetKit
import SwiftUI

/// The Flow on the watch face: how many Big Rocks are left today, and the
/// next one. Read-only — a complication's only gesture is a tap, and a tap
/// opens the app, which is where ticking happens.
///
/// Reads the same /api/watch the app does, with the same token (shared through
/// the App Group in WatchStore.swift, which this target also compiles). When
/// the network is not there it draws the last day the app read rather than
/// going blank.
struct FlowEntry: TimelineEntry {
    let date: Date
    let day: WatchDay?
    let linked: Bool
}

struct FlowProvider: TimelineProvider {
    func placeholder(in context: Context) -> FlowEntry { FlowEntry(date: Date(), day: .sample, linked: true) }

    func getSnapshot(in context: Context, completion: @escaping (FlowEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        completion(FlowEntry(date: Date(), day: WatchStore.lastDay, linked: WatchStore.isLinked))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FlowEntry>) -> Void) {
        Task {
            var day = WatchStore.lastDay
            if WatchStore.isLinked, let fresh = try? await WatchAPI.today(redraw: false) { day = fresh }
            let entry = FlowEntry(date: Date(), day: day, linked: WatchStore.isLinked)
            /* Half an hour is often enough for a day's list; the app asks for
               a redraw itself whenever something is ticked. */
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60))))
        }
    }
}

struct FlowComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FlowEntry

    private var open: Int { entry.day?.counts.today ?? 0 }
    private var late: Int { entry.day?.counts.overdue ?? 0 }
    private var doneToday: Int { entry.day?.counts.todayDone ?? 0 }
    private var nextTitle: String { entry.day?.next?.title ?? "" }

    var body: some View {
        content.flowWidgetBackground()
    }

    @ViewBuilder private var content: some View {
        if !entry.linked {
            switch family {
            case .accessoryInline: Text("The Flow — link")
            default: Image(systemName: "link").font(.title3).widgetAccentable()
            }
        } else {
            switch family {
            case .accessoryCircular:
                let total = max(1, open + doneToday)
                Gauge(value: Double(doneToday), in: 0...Double(total)) {
                    Image(systemName: "circle.circle")
                } currentValueLabel: {
                    Text(open + late == 0 ? "✓" : "\(open + late)")
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .widgetAccentable()
            case .accessoryCorner:
                Text(open + late == 0 ? "✓" : "\(open + late)")
                    .font(.title2.weight(.bold))
                    .widgetLabel { Text(nextTitle.isEmpty ? "The Flow" : nextTitle) }
            case .accessoryInline:
                Text(open + late == 0 ? "Nothing left today" : (nextTitle.isEmpty ? "\(open + late) left today" : "\(open + late) left · \(nextTitle)"))
            default:
                VStack(alignment: .leading, spacing: 1) {
                    Text("THE FLOW").font(.system(size: 11, weight: .heavy)).widgetAccentable()
                    Text(entry.day?.headline ?? "Open The Flow").font(.headline).lineLimit(2).minimumScaleFactor(0.8)
                    if let n = entry.day?.next {
                        Text(n.title).font(.footnote).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

private extension View {
    /// watchOS 10 wants a container background; watchOS 9 has no such thing.
    @ViewBuilder func flowWidgetBackground() -> some View {
        if #available(watchOS 10.0, *) { self.containerBackground(for: .widget) { Color.clear } }
        else { self }
    }
}

@main
struct FlowComplications: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FlowToday", provider: FlowProvider()) { entry in
            FlowComplicationView(entry: entry)
        }
        .configurationDisplayName("The Flow")
        .description("Big Rocks left today and the next one.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

extension WatchDay {
    static let sample = WatchDay(
        date: "2026-10-27", weekday: "Tuesday", now: "09:00",
        counts: .init(today: 2, todayDone: 1, overdue: 0),
        headline: "2 Big Rocks for today.",
        next: .init(id: "s", title: "Send the venue contract", when: "Today 10:00"),
        rocks: [], habits: [],
        week: .init(id: "2026-W44", done: 3, total: 8, more: 3),
        updated: "")
}
