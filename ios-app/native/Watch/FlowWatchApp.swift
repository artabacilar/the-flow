import SwiftUI
import WatchKit

/// The Flow on Apple Watch.
///
/// A glance and a tap: today's Priorities (and the ones that slipped, which
/// can be put on today or tomorrow), what is next, today's habits — a writing
/// habit is written by voice, a timed one has its clock — and a Priority or a
/// note said into the watch. Planning a week stays on the phone and the Mac.
/// English or Turkish, as the watch is set.
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
                Text(Words.t("Link this watch", "Bu saati bağla")).font(.headline)
                if !code.isEmpty {
                    Text(code)
                        .font(.system(.title2, design: .monospaced).weight(.bold))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .padding(.vertical, 4)
                        .accessibilityLabel(code.map { String($0) }.joined(separator: " "))
                    Text(Words.t("On your phone or computer, open The Flow → Settings → Watch and type this code.", "Telefonunda ya da bilgisayarında The Flow → Ayarlar → Saat'i aç ve bu kodu yaz."))
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Text("theflow.today/watch").font(.footnote.weight(.semibold)).foregroundStyle(.green)
                    ProgressView().padding(.top, 4)
                } else if let error = error {
                    Text(error).font(.footnote).multilineTextAlignment(.center)
                    Button(Words.t("Try again", "Tekrar dene")) { start() }
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
                await MainActor.run { self.error = Words.t("Could not reach The Flow. Check the watch is online.", "The Flow'a ulaşılamadı. Saatin çevrimiçi olduğunu kontrol et.") }
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
    /// An overdue Priority tapped: Done, Today or Tomorrow.
    @State private var late: WatchDay.Rock?
    /// A habit with a door: written by voice, or timed.
    @State private var writing: WatchDay.Habit?
    @State private var timing: WatchDay.Habit?

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
                        label(day.rocks.isEmpty ? Words.t("No Priorities today", "Bugün öncelik yok") : Words.t("Priorities", "Öncelikler"))
                        ForEach(day.rocks) { r in rockRow(r) }
                        if !day.habits.isEmpty {
                            label(Words.t("Habits", "Alışkanlıklar"))
                            ForEach(day.habits) { h in habitRow(h) }
                        }
                        Button { adding = true } label: {
                            Label(Words.t("Add by voice", "Sesle ekle"), systemImage: "mic.fill").frame(maxWidth: .infinity)
                        }
                        .tint(.green)
                        .padding(.top, 6)
                        Button(role: .destructive) { askUnlink = true } label: {
                            Text(Words.t("Unlink this watch", "Bu saatin bağlantısını kaldır")).font(.footnote).frame(maxWidth: .infinity)
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
                    Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel(Words.t("Add", "Ekle"))
                }
            }
            .sheet(isPresented: $adding) { AddView { d in day = d } }
            .sheet(item: $late) { r in LateView(rock: r) { d in day = d } onUnlinked: { onUnlinked() } }
            .sheet(item: $writing) { h in WriteView(habit: h) { d in day = d } onUnlinked: { onUnlinked() } }
            .sheet(item: $timing) { h in TimerView(habit: h) { d in day = d } onUnlinked: { onUnlinked() } }
            .confirmationDialog(Words.t("Unlink this watch?", "Bu saatin bağlantısı kaldırılsın mı?"), isPresented: $askUnlink, titleVisibility: .visible) {
                Button(Words.t("Unlink", "Kaldır"), role: .destructive) { WatchStore.unlink(); onUnlinked() }
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
                        Text(Words.t("NEXT", "SIRADA")).font(.caption2.weight(.heavy)).foregroundStyle(.green)
                        Text(n.when).font(.caption2).foregroundStyle(.secondary)
                    }
                    Text(n.title).font(.footnote).lineLimit(2)
                }
                .padding(.top, 2)
            }
            if day.week.total > 0 {
                ProgressView(value: day.progress).tint(.green)
                    .accessibilityLabel(Words.t("Week \(day.week.done) of \(day.week.total) done", "Hafta: \(day.week.total) içinden \(day.week.done) tamam"))
                    .padding(.top, 2)
            }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary).padding(.top, 6)
    }

    private func rockRow(_ r: WatchDay.Rock) -> some View {
        Button { if r.overdue && !r.done { late = r } else { Task { await toggleRock(r) } } } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: r.done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(r.done ? .green : (r.overdue ? .orange : .primary))
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.title).font(.body).strikethrough(r.done).foregroundStyle(r.done ? .secondary : .primary).lineLimit(3)
                    if r.overdue { Text(Words.t("Overdue", "Gecikmiş") + " · \(r.day ?? "")").font(.caption2).foregroundStyle(.orange) }
                    else if let t = r.time, !t.isEmpty {
                        HStack(spacing: 3) {
                            Text(t).font(.caption2).foregroundStyle(.secondary)
                            if r.`repeat` != nil { Image(systemName: "arrow.clockwise").font(.system(size: 9)).foregroundStyle(.secondary) }
                        }
                    } else if r.`repeat` != nil {
                        Image(systemName: "arrow.clockwise").font(.system(size: 9)).foregroundStyle(.secondary)
                            .accessibilityLabel(Words.t("Repeats", "Tekrarlıyor"))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8).padding(.horizontal, 10)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.1)))
            .opacity(busy.contains(r.id) ? 0.5 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel((r.done ? Words.t("Done: ", "Tamam: ") : "") + r.title)
        .accessibilityHint(r.overdue && !r.done ? Words.t("Done, today or tomorrow", "Tamam, bugün ya da yarın") : (r.done ? Words.t("Mark not done", "Tamamlanmadı yap") : Words.t("Mark done", "Tamamlandı yap")))
    }

    /// Tapping a habit that is not done yet opens its door — a page to say
    /// the sentences into, or its clock; a plain habit, or one already done,
    /// ticks (or unticks) at once, as before.
    private func habitRow(_ h: WatchDay.Habit) -> some View {
        Button {
            if !h.done && h.door == "write" { writing = h }
            else if !h.done && h.door == "timer" { timing = h }
            else { Task { await toggleHabit(h) } }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: h.done ? "checkmark.square.fill" : "square")
                    .foregroundStyle(h.done ? .green : .primary).font(.title3)
                Text(h.name).lineLimit(2)
                Spacer(minLength: 0)
                if !h.done && h.door != "tick" {
                    Image(systemName: h.door == "write" ? "mic.fill" : "timer").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8).padding(.horizontal, 10)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.1)))
            .opacity(busy.contains("h:" + h.id) ? 0.5 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel((h.done ? Words.t("Done: ", "Tamam: ") : "") + h.name)
    }

    @MainActor private func load() async {
        do { day = try await WatchAPI.today(); note = nil }
        catch WatchAPI.Failure.unlinked { onUnlinked() }
        catch { note = (error as? LocalizedError)?.errorDescription ?? Words.t("Could not refresh.", "Yenilenemedi.") }
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
                TextField(kind == "rock" ? Words.t("Say the Priority", "Önceliği söyle") : Words.t("Say the note", "Notu söyle"), text: $text)
                choice([("rock", Words.t("Priority", "Öncelik")), ("note", Words.t("Note", "Not"))], $kind)
                if kind == "rock" {
                    choice([("today", Words.t("Today", "Bugün")), ("tomorrow", Words.t("Tomorrow", "Yarın"))], $when)
                }
                if let e = error { Text(e).font(.footnote).foregroundStyle(.orange) }
                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView() } else { Text(Words.t("Add", "Ekle")).frame(maxWidth: .infinity) }
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
            self.error = (error as? LocalizedError)?.errorDescription ?? Words.t("Could not add that.", "Eklenemedi.")
        }
        saving = false
    }
}

// MARK: - An overdue Priority: done, today or tomorrow

/// The Overdue sheet of the app, on the wrist: the Priority that slipped,
/// and the three answers that fit a watch. Drop and hand-off stay on the
/// phone — they need more than a tap to be undone.
struct LateView: View {
    let rock: WatchDay.Rock
    let done: (WatchDay) -> Void
    let onUnlinked: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(Words.t("OVERDUE", "GECİKMİŞ") + (rock.day.map { " · " + $0 } ?? "")).font(.caption2.weight(.bold)).foregroundStyle(.orange)
                Text(rock.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                if let e = error { Text(e).font(.footnote).foregroundStyle(.orange) }
                Button { Task { await go(["action": "rock", "id": rock.id, "done": true]) } } label: {
                    Label(Words.t("Done", "Tamam"), systemImage: "checkmark").frame(maxWidth: .infinity)
                }.tint(.green)
                Button { Task { await go(["action": "move", "id": rock.id, "to": "today"]) } } label: {
                    Text(Words.t("Today", "Bugün")).frame(maxWidth: .infinity)
                }
                Button { Task { await go(["action": "move", "id": rock.id, "to": "tomorrow"]) } } label: {
                    Text(Words.t("Tomorrow", "Yarın")).frame(maxWidth: .infinity)
                }
            }
            .disabled(busy)
        }
    }

    @MainActor private func go(_ body: [String: Any]) async {
        busy = true; error = nil
        do {
            let d = try await WatchAPI.act(body)
            WKInterfaceDevice.current().play(.success)
            done(d); dismiss()
        } catch WatchAPI.Failure.unlinked { dismiss(); onUnlinked() }
        catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? Words.t("Could not do that.", "Yapılamadı.")
            WKInterfaceDevice.current().play(.failure)
        }
        busy = false
    }
}

// MARK: - A writing habit, said into the watch

/// "Write 3 sentences before bed": the field offers dictation first. What is
/// said goes to the journal under the habit's name and ticks today — the
/// same as writing it in the app.
struct WriteView: View {
    let habit: WatchDay.Habit
    let done: (WatchDay) -> Void
    let onUnlinked: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(habit.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                TextField(Words.t("How today felt, what you did", "Bugün nasıldı, ne yaptın"), text: $text)
                Text(Words.t("Saved to your journal; ticks today.", "Günlüğüne kaydedilir; bugünü işaretler."))
                    .font(.caption2).foregroundStyle(.secondary)
                if let e = error { Text(e).font(.footnote).foregroundStyle(.orange) }
                Button { Task { await save(text) } } label: {
                    if saving { ProgressView() } else { Text(Words.t("Save and tick", "Kaydet ve işaretle")).frame(maxWidth: .infinity) }
                }
                .tint(.green)
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                Button { Task { await save("") } } label: {
                    Text(Words.t("Just tick", "Sadece işaretle")).font(.footnote).frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
                .disabled(saving)
            }
        }
    }

    @MainActor private func save(_ said: String) async {
        saving = true; error = nil
        do {
            var b: [String: Any] = ["action": "habit", "id": habit.id, "done": true]
            let t = said.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { b["text"] = t }
            let d = try await WatchAPI.act(b)
            WKInterfaceDevice.current().play(.success)
            done(d); dismiss()
        } catch WatchAPI.Failure.unlinked { dismiss(); onUnlinked() }
        catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? Words.t("Could not save that.", "Kaydedilemedi.")
            WKInterfaceDevice.current().play(.failure)
        }
        saving = false
    }
}

// MARK: - A timed habit

/// "Meditate 10 min": a clock with the minutes from the name. The end time is
/// kept, so lowering the wrist does not lose it; when it is reached the watch
/// taps and the habit is ticked. Done ticks it either way — the clock is a
/// help, not a judge.
struct TimerView: View {
    let habit: WatchDay.Habit
    let done: (WatchDay) -> Void
    let onUnlinked: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var end: Date?
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 6) {
            Text(habit.name).font(.footnote.weight(.semibold)).lineLimit(2).multilineTextAlignment(.center)
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let left = remaining(at: ctx.date)
                Text(clock(left))
                    .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(end == nil ? Color.primary : Color.green)
                    .onChange(of: left) { v in if v <= 0, end != nil, !saving { Task { await finish() } } }
            }
            if let e = error { Text(e).font(.caption2).foregroundStyle(.orange) }
            HStack(spacing: 6) {
                if end == nil {
                    Button(Words.t("Start", "Başlat")) { begin() }.tint(.green)
                }
                Button(Words.t("Done", "Bitti")) { Task { await finish() } }.disabled(saving)
            }
        }
        .onAppear { end = WatchStore.timerEnd(habit.id) }
        .onChange(of: phase) { p in if p == .active { end = WatchStore.timerEnd(habit.id) } }
    }

    private func remaining(at now: Date) -> Int {
        guard let e = end else { return habit.mins * 60 }
        return max(0, Int(e.timeIntervalSince(now).rounded(.up)))
    }
    private func clock(_ s: Int) -> String { String(format: "%d:%02d", s / 60, s % 60) }

    private func begin() {
        let e = Date().addingTimeInterval(TimeInterval(habit.mins * 60))
        WatchStore.setTimerEnd(habit.id, e)
        end = e
        WKInterfaceDevice.current().play(.start)
    }

    @MainActor private func finish() async {
        guard !saving else { return }
        saving = true; error = nil
        WatchStore.setTimerEnd(habit.id, nil)
        do {
            let d = try await WatchAPI.act(["action": "habit", "id": habit.id, "done": true])
            WKInterfaceDevice.current().play(.success)
            done(d); dismiss()
        } catch WatchAPI.Failure.unlinked { dismiss(); onUnlinked() }
        catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? Words.t("Could not save that.", "Kaydedilemedi.")
            WKInterfaceDevice.current().play(.failure)
        }
        saving = false
    }
}
