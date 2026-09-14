import WidgetKit
import SwiftUI

/// The home-screen widget.
///
/// Design rule for everything below: a widget is read at a glance, usually
/// while walking, and it is never scrolled. So it shows what is *next* and
/// says how much it left out, rather than trying to show a day. And it never
/// lies about being current — if the fetch failed, it says so rather than
/// quietly leaving yesterday on the screen, because a stale day on a lock
/// screen is worse than an empty one.

struct FlowEntry: TimelineEntry {
    let date: Date
    let today: FlowToday?
    let problem: String?
}

struct FlowProvider: TimelineProvider {

    func placeholder(in context: Context) -> FlowEntry {
        FlowEntry(date: Date(), today: nil, problem: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (FlowEntry) -> Void) {
        Task { completion(await load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FlowEntry>) -> Void) {
        Task {
            let entry = await load()
            /// Fifteen minutes is about as often as iOS will honour anyway, and
            /// a day does not move faster than that. On a failure, come back
            /// sooner — the usual cause is a server still waking up.
            let next = Calendar.current.date(
                byAdding: .minute, value: entry.problem == nil ? 15 : 5, to: Date()
            ) ?? Date().addingTimeInterval(900)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func load() async -> FlowEntry {
        do {
            return FlowEntry(date: Date(), today: try await FlowFeed.today(), problem: nil)
        } catch FlowFeed.Failure.notConnected {
            return FlowEntry(date: Date(), today: nil, problem: "Open the app and connect")
        } catch FlowFeed.Failure.unauthorized {
            return FlowEntry(date: Date(), today: nil, problem: "Token no longer works")
        } catch {
            return FlowEntry(date: Date(), today: nil, problem: "Can’t reach The Flow")
        }
    }
}

struct FlowWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FlowEntry

    private var maxLines: Int {
        switch family {
        case .systemSmall: return 2
        case .systemMedium: return 3
        default: return 4
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let t = entry.today {
                if t.lines.isEmpty {
                    Text(t.total == 0 ? "Nothing set for today" : "That’s the day done")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(t.lines.prefix(maxLines).enumerated()), id: \.offset) { _, line in
                        row(line)
                    }
                    let hidden = t.lines.count - min(t.lines.count, maxLines) + t.more
                    if hidden > 0 {
                        Text("+\(hidden) more")
                            .font(.system(size: 11))
                            .foregroundStyle(.tertiary)
                    }
                }
            } else {
                Text(entry.problem ?? "—")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .containerBackground(for: .widget) { Color(red: 0.04, green: 0.05, blue: 0.06) }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(entry.today?.weekday.uppercased() ?? "THE FLOW")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.tertiary)
                .tracking(0.8)
            Spacer()
            if let t = entry.today {
                Text("\(t.done)/\(t.total)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(t.total > 0 && t.done == t.total
                                     ? Color(red: 0.09, green: 0.73, blue: 0.57)
                                     : .tertiary)
            }
        }
    }

    private func row(_ line: FlowToday.Line) -> some View {
        HStack(alignment: .top, spacing: 7) {
            /// A missed thing is marked, not hidden. Hiding it is how a day
            /// quietly gets away from somebody.
            Circle()
                .fill(line.overdue ? Color(red: 0.95, green: 0.45, blue: 0.42)
                                   : Color(red: 0.09, green: 0.73, blue: 0.57))
                .frame(width: 5, height: 5)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(line.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(family == .systemSmall ? 1 : 2)
                if let time = line.time, !time.isEmpty {
                    Text(time)
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }
}

@main
struct FlowWidget: Widget {
    let kind = "FlowWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FlowProvider()) { entry in
            FlowWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Your Big Rocks for today, and how the week stands.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
