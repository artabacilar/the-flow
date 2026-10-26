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

    var body: some View {
        NavigationStack {
            List {
                if let day = day {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(day.weekday.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                            Text(day.headline).font(.headline).fixedSize(horizontal: false, vertical: true)
                            if let n = day.next {
                                HStack(alignment: .firstTextBaseline, spacing: 4) {
                                    Text("Next").font(.caption2.weight(.heavy)).foregroundStyle(.green)
                                    Text(n.title).font(.footnote).lineLimit(2)
                                }
                                Text(n.when).font(.caption2).foregroundStyle(.secondary)
                            }
                            if day.week.total > 0 {
                                ProgressView(value: day.progress).tint(.green)
                                    .accessibilityLabel("Week \(day.week.done) of \(day.week.total) done")
                            }
                        }
                        .listRowBackground(Color.clear)
                    }
                    if let note = note {
                        Text(note).font(.footnote).foregroundStyle(.orange)
                    }
                    Section(day.rocks.isEmpty ? "No Big Rocks today" : "Big Rocks") {
                        ForEach(day.rocks) { r in rockRow(r) }
                    }
                    if !day.habits.isEmpty {
                        Section("Habits") {
                            ForEach(day.habits) { h in habitRow(h) }
                        }
                    }
                    Section {
                        Button { adding = true } label: { Label("Add by voice", systemImage: "mic.fill") }
                        Button(role: .destructive) { askUnlink = true } label: { Text("Unlink this watch").font(.footnote) }
                    }
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }
                    if let note = note { Text(note).font(.footnote) }
                }
            }
            .navigationTitle("The Flow")
            .refreshable { await load() }
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
        .task { await load() }
        .onChange(of: phase) { p in if p == .active { Task { await load() } } }
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
            .opacity(busy.contains(r.id) ? 0.5 : 1)
        }
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
            .opacity(busy.contains("h:" + h.id) ? 0.5 : 1)
        }
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
                Picker("Kind", selection: $kind) {
                    Text("Big Rock").tag("rock")
                    Text("Note").tag("note")
                }
                if kind == "rock" {
                    Picker("When", selection: $when) {
                        Text("Today").tag("today")
                        Text("Tomorrow").tag("tomorrow")
                    }
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
