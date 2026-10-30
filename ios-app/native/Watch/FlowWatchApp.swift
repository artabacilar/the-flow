import SwiftUI
import WatchKit
import AVFoundation

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

/// App Store screenshots, in DEBUG builds only: `-FlowShots` draws a sample
/// day without the network or a link; `-FlowShow late|write|timer|add`
/// opens that sheet; `-FlowScroll habits` scrolls down to the habits. A
/// release build has none of it.
enum Shots {
    #if DEBUG
    static let args = ProcessInfo.processInfo.arguments
    static var on: Bool { args.contains("-FlowShots") }
    static func value(_ key: String) -> String? {
        guard let i = args.firstIndex(of: key), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
    #else
    static var on: Bool { false }
    static func value(_ key: String) -> String? { nil }
    #endif
}

struct RootView: View {
    @State private var linked = WatchStore.isLinked

    var body: some View {
        Group {
            if Shots.on { TodayView(onUnlinked: {}) }
            else if linked { TodayView(onUnlinked: { linked = false }) }
            else { PairView(onLinked: { linked = true }) }
        }
    }
}

// MARK: - Linking

struct PairView: View {
    let onLinked: () -> Void
    @Environment(\.scenePhase) private var phase
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
        .onDisappear { task?.cancel(); task = nil }
        /* Raising the wrist again: ask straight away rather than waiting
           for a screen that may not reappear to call onAppear. */
        .onChange(of: phase) { p in if p == .active { start() } }
    }

    /// Picks up the code already on screen if there is one — the person may
    /// have typed it in while the watch was dark, and the token is waiting
    /// under that code's id, not a new one. Only a code that has run out, or
    /// none at all, asks the server for another.
    private func start(fresh: Bool = false) {
        task?.cancel()
        error = nil
        task = Task {
            do {
                var p: WatchStore.Pending
                if !fresh, let keep = WatchStore.pending {
                    p = keep
                } else {
                    await MainActor.run { code = "" }
                    let s = try await WatchAPI.startPairing()
                    /* The server keeps a linked code's token for five minutes past
                       its own expiry; keep asking for that long too. */
                    p = WatchStore.Pending(id: s.id, code: s.code, until: Date().addingTimeInterval(TimeInterval(max(60, s.expiresIn) + 300)))
                    WatchStore.pending = p
                }
                let shown = p.code
                await MainActor.run { code = shown }
                var misses = 0
                while !Task.isCancelled {
                    /* First ask at once (it may already be linked), then every
                       three seconds; a dropped request is retried, not fatal. */
                    let r: WatchAPI.PairPoll
                    do { r = try await WatchAPI.pollPairing(p.id); misses = 0 }
                    catch is CancellationError { return }
                    catch {
                        misses += 1
                        if misses >= 20 { throw error }
                        try await Task.sleep(nanoseconds: 3_000_000_000)
                        continue
                    }
                    if r.status == "linked", let t = r.token {
                        WatchStore.token = t
                        WatchStore.who = r.who ?? ""
                        WatchStore.pending = nil
                        WKInterfaceDevice.current().play(.success)
                        _ = try? await WatchAPI.today()
                        await MainActor.run { onLinked() }
                        return
                    }
                    if r.status == "expired" {
                        WatchStore.pending = nil
                        await MainActor.run { start(fresh: true) }
                        return
                    }
                    try await Task.sleep(nanoseconds: 3_000_000_000)
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
    @State private var day: WatchDay? = Shots.on ? WatchDay.demo : WatchStore.lastDay
    @State private var note: String?
    @State private var busy = Set<String>()
    @State private var adding = false
    /// What was just said into "Add by voice", waiting for Today, Tomorrow,
    /// Done or Note.
    @State private var heard: Heard?
    @State private var listenAgain = false
    /// A question for the assistant, waiting for its answer.
    @State private var question: Heard?
    @State private var askAgain = false
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
          ScrollViewReader { proxy in
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
                            label(Words.t("Habits", "Alışkanlıklar")).id("habits")
                            ForEach(day.habits) { h in habitRow(h) }
                        }
                        Button { askByVoice() } label: {
                            Label(askLabel(day), systemImage: "waveform").frame(maxWidth: .infinity)
                        }
                        .tint(.orange)
                        .padding(.top, 6)
                        Button { addByVoice() } label: {
                            Label(Words.t("Add by voice", "Sesle ekle"), systemImage: "mic.fill").frame(maxWidth: .infinity)
                        }
                        .tint(.green)
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
            /* Screenshot mode only: wait for the first frame, then scroll or
               open the sheet asked for — presenting during the first
               appearance is ignored on watchOS. */
            .task {
                guard Shots.on else { return }
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if let to = Shots.value("-FlowScroll") { withAnimation { proxy.scrollTo(to, anchor: .top) } }
                if let show = Shots.value("-FlowShow"), let d = day {
                    switch show {
                    case "late": late = d.rocks.first { $0.overdue }
                    case "write": writing = d.habits.first { $0.door == "write" }
                    case "timer": timing = d.habits.first { $0.door == "timer" }
                    case "add": adding = true
                    case "ask": question = Heard(text: Words.t("What is left today?", "Bugün ne kaldı?"))
                    case "heard": heard = Heard(text: Words.t("Call the dentist about Friday", "Cuma için dişçiyi ara"))
                    default: break
                    }
                }
            }
          }
            .navigationTitle("The Flow")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { addByVoice() } label: { Image(systemName: "plus") }.accessibilityLabel(Words.t("Add", "Ekle"))
                }
            }
            .sheet(isPresented: $adding) { AddView { d in day = d } }
            /* Dictation opens from Today, not from over a sheet: "Again"
               lets the sheet go all the way down, then listens again. */
            .sheet(item: $heard, onDismiss: {
                guard listenAgain else { return }
                listenAgain = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { addByVoice() }
            }) { h in
                HeardView(text: h.text, done: { d in day = d }, onUnlinked: { onUnlinked() }, again: { listenAgain = true })
            }
            .sheet(item: $question, onDismiss: {
                guard askAgain else { return }
                askAgain = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { askByVoice() }
            }) { q in
                AskView(question: q.text, name: day?.assistant, onUnlinked: { onUnlinked() }, again: { askAgain = true })
            }
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

    /// "Ask J.A.R.V.I.S." — or "Ask" until they name their assistant in the app.
    private func askLabel(_ d: WatchDay) -> String {
        if let n = d.assistant, !n.isEmpty { return Words.t("Ask ", "Sor: ") + n }
        return Words.t("Ask", "Sor")
    }

    /// Straight into dictation, then the answer.
    private func askByVoice() {
        if Shots.on { question = Heard(text: Words.t("What is left today?", "Bugün ne kaldı?")); return }
        let opened = Dictate.ask { said in
            if let said = said { question = Heard(text: said) }
        }
        if !opened { question = Heard(text: "") }
    }

    /// "Add by voice" goes straight to dictation — no field to tap, no mic
    /// to press. What was said then gets one tap: Today, Tomorrow, Done or
    /// Note. A watch that cannot open dictation here gets the field instead.
    private func addByVoice() {
        if Shots.on { adding = true; return }
        let opened = Dictate.ask { said in
            if let said = said { heard = Heard(text: said) }
        }
        if !opened { adding = true }
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
        if Shots.on { return }
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

// MARK: - Dictation, straight away

struct Heard: Identifiable {
    let id = UUID()
    let text: String
}

enum Dictate {
    /// Opens the watch's dictation screen at once. An empty list of
    /// suggestions with plain input skips the menu and starts listening.
    /// Returns false when there is no screen to open it from — the caller
    /// shows a field instead. `said` is nil when nothing was said.
    @discardableResult
    static func ask(_ said: @escaping (String?) -> Void) -> Bool {
        guard let vc = WKApplication.shared().visibleInterfaceController else { return false }
        vc.presentTextInputController(withSuggestions: [], allowedInputMode: .plain) { result in
            let text = (result?.first as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            DispatchQueue.main.async { said(text.isEmpty ? nil : text) }
        }
        return true
    }
}

/// What was said, and where it goes: one tap. Say it again or edit it if the
/// watch heard it wrong.
struct HeardView: View {
    let done: (WatchDay) -> Void
    let onUnlinked: () -> Void
    let again: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var editing = false
    @State private var busy = false
    @State private var error: String?

    init(text: String, done: @escaping (WatchDay) -> Void, onUnlinked: @escaping () -> Void, again: @escaping () -> Void) {
        _text = State(initialValue: text)
        self.done = done
        self.onUnlinked = onUnlinked
        self.again = again
    }

    private var empty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(Words.t("YOU SAID", "SÖYLEDİĞİN")).font(.caption2.weight(.bold)).foregroundStyle(.green)
                if editing {
                    TextField(Words.t("Say the Priority", "Önceliği söyle"), text: $text)
                } else {
                    Text(text).font(.headline).fixedSize(horizontal: false, vertical: true)
                        .onTapGesture { editing = true }
                }
                if let e = error { Text(e).font(.footnote).foregroundStyle(.orange) }
                Button { Task { await go(["action": "add", "text": text, "day": "today"]) } } label: {
                    Label(Words.t("Today", "Bugün"), systemImage: "sun.max.fill").frame(maxWidth: .infinity)
                }.tint(.green)
                Button { Task { await go(["action": "add", "text": text, "day": "tomorrow"]) } } label: {
                    Label(Words.t("Tomorrow", "Yarın"), systemImage: "arrow.right").frame(maxWidth: .infinity)
                }
                Button { Task { await go(["action": "add", "text": text, "day": "today", "done": true]) } } label: {
                    Label(Words.t("Done today", "Bugün yapıldı"), systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                Button { Task { await go(["action": "add", "text": text, "kind": "note"]) } } label: {
                    Label(Words.t("Note", "Not"), systemImage: "note.text").frame(maxWidth: .infinity)
                }
                HStack(spacing: 6) {
                    Button { again(); dismiss() } label: {
                        Label(Words.t("Again", "Tekrar"), systemImage: "mic.fill").font(.footnote).frame(maxWidth: .infinity)
                    }
                    Button { editing = true } label: {
                        Label(Words.t("Edit", "Düzenle"), systemImage: "pencil").font(.footnote).frame(maxWidth: .infinity)
                    }
                }
                .padding(.top, 2)
            }
            .disabled(busy)
        }
    }

    @MainActor private func go(_ body: [String: Any]) async {
        guard !empty else { editing = true; return }
        busy = true; error = nil
        do {
            let d = try await WatchAPI.act(body)
            WKInterfaceDevice.current().play(.success)
            done(d); dismiss()
        } catch WatchAPI.Failure.unlinked { dismiss(); onUnlinked() }
        catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? Words.t("Could not add that.", "Eklenemedi.")
            WKInterfaceDevice.current().play(.failure)
        }
        busy = false
    }
}

// MARK: - Ask the assistant

/// The question, then the answer — read aloud in the premium voice when the
/// account has one, in the watch's own British voice when not.
struct AskView: View {
    let question: String
    let name: String?
    let onUnlinked: () -> Void
    let again: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var answer: String?
    @State private var error: String?
    @State private var busy = false
    @StateObject private var voice = WatchVoice()

    init(question: String, name: String?, onUnlinked: @escaping () -> Void, again: @escaping () -> Void) {
        self.question = question; self.name = name; self.onUnlinked = onUnlinked; self.again = again
        _text = State(initialValue: question)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text((name?.isEmpty == false ? name! : Words.t("Assistant", "Asistan")).uppercased())
                    .font(.caption2.weight(.bold)).foregroundStyle(.orange)
                if question.isEmpty && answer == nil && !busy {
                    TextField(Words.t("Ask anything", "Bir şey sor"), text: $text)
                    Button { Task { await go() } } label: { Text(Words.t("Ask", "Sor")).frame(maxWidth: .infinity) }
                        .tint(.orange)
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                } else {
                    Text("“" + text + "”").font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if busy { HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 6) }
                if let a = answer {
                    Text(a).font(.body).fixedSize(horizontal: false, vertical: true)
                    if voice.speaking {
                        Button { voice.stop() } label: { Label(Words.t("Stop", "Durdur"), systemImage: "stop.fill").font(.footnote).frame(maxWidth: .infinity) }
                    }
                }
                if let e = error { Text(e).font(.footnote).foregroundStyle(.orange) }
                if answer != nil || error != nil {
                    HStack(spacing: 6) {
                        Button { voice.stop(); again(); dismiss() } label: {
                            Label(Words.t("Again", "Tekrar"), systemImage: "waveform").font(.footnote).frame(maxWidth: .infinity)
                        }
                        Button { voice.stop(); dismiss() } label: {
                            Text(Words.t("Done", "Tamam")).font(.footnote).frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .task { if !question.isEmpty { await go() } }
        .onDisappear { voice.stop() }
    }

    @MainActor private func go() async {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        busy = true; error = nil
        do {
            let a = try await WatchAPI.ask(q)
            answer = a.isEmpty ? Words.t("I could not find an answer to that.", "Buna bir cevap bulamadım.") : a
            WKInterfaceDevice.current().play(.click)
            busy = false
            await voice.say(answer ?? "")
        } catch WatchAPI.Failure.unlinked { busy = false; dismiss(); onUnlinked() }
        catch {
            busy = false
            self.error = (error as? LocalizedError)?.errorDescription ?? Words.t("Could not ask that.", "Sorulamadı.")
            WKInterfaceDevice.current().play(.failure)
        }
    }
}

/// Speaks an answer: the premium voice from the server when there is one,
/// otherwise the best British voice on the watch. A dotted name
/// ("J.A.R.V.I.S.") is said as the word.
@MainActor final class WatchVoice: NSObject, ObservableObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    @Published var speaking = false
    private var player: AVAudioPlayer?
    private let synth = AVSpeechSynthesizer()

    override init() { super.init(); synth.delegate = self }

    static func sayable(_ s: String) -> String {
        guard let re = try? NSRegularExpression(pattern: "\\b((?:[A-Za-z]\\.){3,}[A-Za-z]?\\.?)") else { return s }
        var out = s
        for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)).reversed() {
            guard let r = Range(m.range, in: out) else { continue }
            let w = out[r].replacingOccurrences(of: ".", with: "")
            out.replaceSubrange(r, with: w.prefix(1).uppercased() + w.dropFirst().lowercased())
        }
        return out
    }

    func say(_ text: String) async {
        let t = WatchVoice.sayable(text)
        guard !t.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        speaking = true
        if let data = await WatchAPI.voice(t), let p = try? AVAudioPlayer(data: data) {
            player = p; p.delegate = self
            if p.play() { return }
        }
        let u = AVSpeechUtterance(string: t)
        let lang = Words.lang == "tr" ? "tr-TR" : "en-GB"
        u.voice = AVSpeechSynthesisVoice.speechVoices().first { $0.language == lang && $0.quality == .enhanced }
            ?? AVSpeechSynthesisVoice.speechVoices().first { $0.language == lang && $0.name.contains("Daniel") }
            ?? AVSpeechSynthesisVoice(language: lang)
        synth.speak(u)
    }

    func stop() {
        player?.stop(); player = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        speaking = false
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.speaking = false }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.speaking = false }
    }
}

// MARK: - Add by voice (the field, where dictation cannot open directly)

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
                    choice([("today", Words.t("Today", "Bugün")), ("tomorrow", Words.t("Tomorrow", "Yarın")), ("done", Words.t("Done", "Yapıldı"))], $when)
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
            if kind == "rock" { b["day"] = when == "done" ? "today" : when; if when == "done" { b["done"] = true } }
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

// MARK: - The sample day for screenshots

extension WatchDay {
    /// What the App Store screenshots show: an ordinary Thursday, nobody's real list.
    static var demo: WatchDay {
        let tr = Words.lang == "tr"
        return WatchDay(
            date: "2026-10-29", weekday: tr ? "Perşembe" : "Thursday", now: "09:41",
            counts: .init(today: 2, todayDone: 1, overdue: 1),
            headline: tr ? "Bugün için 2 öncelik, 1 gecikmiş." : "2 Priorities for today, 1 overdue.",
            next: .init(id: "d1", title: tr ? "Mekân sözleşmesini gönder" : "Send the venue contract", when: tr ? "Bugün 10:00" : "Today 10:00"),
            rocks: [
                .init(id: "d1", title: tr ? "Mekân sözleşmesini gönder" : "Send the venue contract", time: "10:00", done: false, overdue: false, prio: "high", day: tr ? "Per" : "Thu", repeat: nil),
                .init(id: "d2", title: tr ? "Faturaları muhasebeciye gönder" : "Send the invoices to the accountant", time: nil, done: false, overdue: false, prio: "med", day: tr ? "Per" : "Thu", repeat: "month"),
                .init(id: "d3", title: tr ? "Sigortayı yenile" : "Renew the insurance", time: nil, done: false, overdue: true, prio: "med", day: tr ? "Pzt" : "Mon", repeat: nil),
                .init(id: "d4", title: tr ? "Fotoğrafçıyı ayarla" : "Book the photographer", time: nil, done: true, overdue: false, prio: "med", day: tr ? "Per" : "Thu", repeat: nil)
            ],
            habits: [
                .init(id: "h1", name: tr ? "Yatmadan 3 cümle yaz" : "Write 3 sentences before bed", done: false, kind: "write", minutes: 10),
                .init(id: "h2", name: tr ? "10 dakika meditasyon" : "Meditate 10 min", done: false, kind: "timer", minutes: 10),
                .init(id: "h3", name: tr ? "Soğuk duş" : "Cold shower", done: true, kind: "tick", minutes: 10)
            ],
            week: .init(id: "2026-W44", done: 3, total: 8, more: 3),
            updated: "", lang: Words.lang)
    }
}
