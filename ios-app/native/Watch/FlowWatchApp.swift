import SwiftUI
import WatchKit

/// The Flow on Apple Watch.
///
/// A glance and a tap: today's Big Rocks (and the ones that slipped), what is
/// next, today's habits — tick any of them — and a Big Rock or a note said
/// into the watch. Planning a week stays on the phone and the Mac.
///
/// It talks to the server directly with a token of its own, so it works with
/// the iPhone in another room, and it does not need the iPhone app at all:
/// linking is a six-character code typed into The Flow anywhere you are
/// signed in.
@main
struct FlowWatchApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var linked = WatchStore.isLinked

    var body: some View {
        Group {
            if linked { TodayView(onUnlinked: { linked = false }) }
            else { PairView(onLinked: { linked = true }) }
        }
    }
}

// MARK: - Linking

struct PairView: View {
    let onLinked: () -> Void
    @State private var code = ""
    @State private var error: String?
    @State private var task: Task<Void, Never>?

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Link this watch").font(.headline)
                if !code.isEmpty {
                    Text(code)
                        .font(.system(.title2, design: .monospaced).weight(.bold))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .padding(.vertical, 4)
                        .accessibilityLabel(code.map { String($0) }.joined(separator: " "))
                    Text("On your phone or computer, open The Flow → Settings → Watch and type this code.")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Text("theflow.today/watch").font(.footnote.weight(.semibold)).foregroundStyle(.green)
                    ProgressView().padding(.top, 4)
                } else if let error = error {
                    Text(error).font(.footnote).multilineTextAlignment(.center)
                    Button("Try again") { start() }
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 4)
        }
        .onAppear { start() }
        .onDisappear { task?.cancel() }
    }

    private func start() {
        task?.cancel()
        error = nil; code = ""
        task = Task {
            do {
                let p = try await WatchAPI.startPairing()
                await MainActor.run { code = p.code }
                let every = UInt64(max(2, p.poll ?? 3)) * 1_000_000_000
                while !Task.isCancelled {
                    try await Task.sleep(nanoseconds: every)
                    let r = try await WatchAPI.pollPairing(p.id)
                    if r.status == "linked", let t = r.token {
                        WatchStore.token = t
                        WatchStore.who = r.who ?? ""
                        WKInterfaceDevice.current().play(.success)
                        _ = try? await WatchAPI.today()
                        await MainActor.run { onLinked() }
                        return
                    }
                    if r.status == "expired" { await MainActor.run { start() }; return }
                }
            } catch is CancellationError {
            } catch {
                await MainActor.run { self.error = "Could not reach The Flow. Check the watch is online." }
            }
        }
    }
}

// MARK: - Today

struct TodayView: View {
    let onUnlinked: () -> Void
    @Environment(\.scenePhase) private var phase
    @State private var day: WatchDay? = WatchStore.lastDay
    @State private var note: String?
    @State private var busy = Set<String>()
    @State private var adding = false
    @State private var askUnlink = false

    /// A plain scroll view, not a List: the Digital Crown scrolls it on
    /// every watch, rows keep their own look, and nothing depends on List's
    /// section chrome, which differs between watchOS versions.
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let day = day {
                        header(day)
                        if let note = note {
                            Text(note).font(.footnote).foregroundStyle(.orange)
                        }
                        label(day.rocks.isEmpty ? "No Big Rocks today" : "Big Rocks")
                        ForEach(day.rocks) { r in rockRow(r) }
                        if !day.habits.isEmpty {
                            label("Habits")
                            ForEach(day.habits) { h in habitRow(h) }
                        }
                        Button { adding = true } label: {
                            Label("Add by voice", systemImage: "mic.fill").frame(maxWidth: .infinity)
                        }
                        .tint(.green)
                        .padding(.top, 6)
                        Button(role: .destructive) { askUnlink = true } label: {
                            Text("Unlink this watch").font(.footnote).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                    } else {
                        HStack { Spacer(); ProgressView(); Spacer() }.padding(.top, 20)
                        if let note = note { Text(note).font(.footnote) }
                    }
                }
                .padding(.horizontal, 4)
            }
            .navigationTitle("The Flow")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add")
                }
            }
            .sheet(isPresented: $adding) { AddView { d in day = d } }
            .confirmationDialog("Unlink this watch?", isPresented: $askUnlink, titleVisibility: .visible) {
                Button("Unlink", role: .destructive) { WatchStore.unlink(); onUnlinked() }
            }
        }
        /* Read now, then every five minutes while the app is on screen — a
           watch left open past midnight should show the new day. */
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 300 * 1_000_000_000)
            }
        }
        .onChange(of: phase) { p in if p == .active { Task { await load() } } }
    }

    private func header(_ day: WatchDay) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(day.weekday.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            Text(day.headline).font(.headline).fixedSize(horizontal: false, vertical: true)
            if let n = day.next {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text("NEXT").font(.caption2.weight(.heavy)).foregroundStyle(.green)
                        Text(n.when).font(.caption2).foregroundStyle(.secondary)
                    }
                    Text(n.title).font(.footnote).lineLimit(2)
                }
                .padding(.top, 2)
            }
            if day.week.total > 0 {
                ProgressView(value: day.progress).tint(.green)
                    .accessibilityLabel("Week \(day.week.done) of \(day.week.total) done")
                    .padding(.top, 2)
            }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary).padding(.top, 6)
    }

    private func rockRow(_ r: WatchDay.Rock) -> some View {
        Button { Task { await toggleRock(r) } } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: r.done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(r.done ? .green : (r.overdue ? .orange : .primary))
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.title).font(.body).strikethrough(r.done).foregroundStyle(r.done ? .secondary : .primary).lineLimit(3)
                    if r.overdue { Text("Overdue · \(r.day ?? "")").font(.caption2).foregroundStyle(.orange) }
                    else if let t = r.time, !t.isEmpty { Text(t).font(.caption2).foregroundStyle(.secondary) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8).padding(.horizontal, 10)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.1)))
            .opacity(busy.contains(r.id) ? 0.5 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel((r.done ? "Done: " : "") + r.title)
        .accessibilityHint(r.done ? "Mark not done" : "Mark done")
    }

    private func habitRow(_ h: WatchDay.Habit) -> some View {
        Button { Task { await toggleHabit(h) } } label: {
            HStack(spacing: 8) {
                Image(systemName: h.done ? "checkmark.square.fill" : "square")
                    .foregroundStyle(h.done ? .green : .primary).font(.title3)
                Text(h.name).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8).padding(.horizontal, 10)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.1)))
            .opacity(busy.contains("h:" + h.id) ? 0.5 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel((h.done ? "Done: " : "") + h.name)
    }

    @MainActor private func load() async {
        do { day = try await WatchAPI.today(); note = nil }
        catch WatchAPI.Failure.unlinked { onUnlinked() }
        catch { note = (error as? LocalizedError)?.errorDescription ?? "Could not refresh." }
    }

    /// Ticked on the wrist at once; put back if the server says no.
    @MainActor private func toggleRock(_ r: WatchDay.Rock) async {
        guard var d = day, let i = d.rocks.firstIndex(where: { $0.id == r.id }), !busy.contains(r.id) else { return }
        let want = !r.done
        d.rocks[i].done = want; day = d; busy.insert(r.id)
        WKInterfaceDevice.current().play(want ? .success : .click)
        defer { busy.remove(r.id) }
        do { day = try await WatchAPI.act(["action": "rock", "id": r.id, "done": want]); note = nil }
        catch WatchAPI.Failure.unlinked { onUnlinked() }
        catch {
            if var back = day, let j = back.rocks.firstIndex(where: { $0.id == r.id }) { back.rocks[j].done = r.done; day = back }
            note = (error as? LocalizedError)?.errorDescription; WKInterfaceDevice.current().play(.failure)
        }
    }

    @MainActor private func toggleHabit(_ h: WatchDay.Habit) async {
        let key = "h:" + h.id
        guard var d = day, let i = d.habits.firstIndex(where: { $0.id == h.id }), !busy.contains(key) else { return }
        let want = !h.done
        d.habits[i].done = want; day = d; busy.insert(key)
        WKInterfaceDevice.current().play(want ? .success : .click)
        defer { busy.remove(key) }
        do { day = try await WatchAPI.act(["action": "habit", "id": h.id, "done": want]); note = nil }
        catch WatchAPI.Failure.unlinked { onUnlinked() }
        catch {
            if var back = day, let j = back.habits.firstIndex(where: { $0.id == h.id }) { back.habits[j].done = h.done; day = back }
            note = (error as? LocalizedError)?.errorDescription; WKInterfaceDevice.current().play(.failure)
        }
    }
}

// MARK: - Add by voice

struct AddView: View {
    let done: (WatchDay) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var kind = "rock"
    @State private var when = "today"
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                /// Tapping the field offers dictation first, then Scribble or
                /// the keyboard on the watches that have one.
                TextField(kind == "rock" ? "Say the Big Rock" : "Say the note", text: $text)
                choice([("rock", "Big Rock"), ("note", "Note")], $kind)
                if kind == "rock" {
                    choice([("today", "Today"), ("tomorrow", "Tomorrow")], $when)
                }
                if let e = error { Text(e).font(.footnote).foregroundStyle(.orange) }
                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView() } else { Text("Add").frame(maxWidth: .infinity) }
                }
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                .tint(.green)
            }
        }
    }

    /// Two side-by-side choices. A wheel picker is unreadable this small.
    private func choice(_ options: [(String, String)], _ sel: Binding<String>) -> some View {
        HStack(spacing: 6) {
            ForEach(options.indices, id: \.self) { i in
                let o = options[i]
                Button { sel.wrappedValue = o.0 } label: {
                    Text(o.1).font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity).padding(.vertical, 7)
                        .background(Capsule().fill(sel.wrappedValue == o.0 ? Color.green : Color.white.opacity(0.12)))
                        .foregroundStyle(sel.wrappedValue == o.0 ? Color.black : Color.white)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(sel.wrappedValue == o.0 ? .isSelected : [])
            }
        }
    }

    @MainActor private func save() async {
        saving = true; error = nil
        do {
            var b: [String: Any] = ["action": "add", "text": text, "kind": kind]
            if kind == "rock" { b["day"] = when }
            let d = try await WatchAPI.act(b)
            WKInterfaceDevice.current().play(.success)
            done(d); dismiss()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Could not add that."
        }
        saving = false
    }
}
