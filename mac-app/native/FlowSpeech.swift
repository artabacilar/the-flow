import Foundation
import AVFoundation
import Speech
import CoreAudio
import AudioToolbox

/// Dictation on the Mac — the same thing the iPhone app does, so the mic in
/// the journal, Plan today and every other field works in both.
///
/// Why native: WKWebView on macOS has no `SpeechRecognition` either, so the
/// page's own recogniser never appears in this window. The page already knows
/// how to talk to a native recogniser (the iPhone one), through
/// `Capacitor.Plugins.FlowBridge.voice*` and `window.__flowVoiceEvent`; the
/// Mac bridge now answers the same calls with this.
///
/// Differences from iOS, and only these: macOS has no audio-session object to
/// configure (the input device is simply opened), and microphone permission
/// is asked through AVCaptureDevice. The stream contract is identical — partial
/// guesses that will change, then a final segment that will not.
final class FlowSpeech: NSObject {

    typealias Emit = (String, [String: Any]) -> Void

    /// A fresh engine for every turn, so a microphone chosen since the last
    /// one is the one opened.
    private var audio = AVAudioEngine()
    private var recogniser: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var emit: Emit?
    private var delivered = ""
    private(set) var listening = false
    /// Loudest level seen this turn, and whether any words came back — what
    /// tells "nothing reaches us from this microphone" from a quiet person.
    private var peak: Float = 0
    private var heard = false
    private var deviceName = ""
    private var deviceUID = ""
    private var turn = 0
    private var feed: VoiceFeed?
    private var sinceLevel = 0

    // MARK: - Permission

    static func permissions() -> [String: Any] {
        return ["supported": true, "mic": micState(), "speech": speechState()]
    }

    private static func micState() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:            return "granted"
        case .denied, .restricted:   return "denied"
        default:                     return "undetermined"
        }
    }

    private static func speechState() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:            return "granted"
        case .denied, .restricted:   return "denied"
        default:                     return "undetermined"
        }
    }

    static func request(_ done: @escaping ([String: Any]) -> Void) {
        SFSpeechRecognizer.requestAuthorization { _ in
            AVCaptureDevice.requestAccess(for: .audio) { _ in
                DispatchQueue.main.async { done(permissions()) }
            }
        }
    }

    // MARK: - Listening

    /// nil on success, or a code the page knows how to explain.
    func start(locale tag: String, emit: @escaping Emit) -> String? {
        if listening { return nil }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else { return "denied" }
        guard FlowSpeech.micState() == "granted" else { return "denied" }

        teardown()
        audio = AVAudioEngine()
        peak = 0; heard = false; turn += 1
        let dev = FlowSpeech.useChosenInput(on: audio)
        deviceName = dev?.name ?? ""; deviceUID = dev?.uid ?? ""

        var rec = SFSpeechRecognizer(locale: Locale(identifier: tag))
        if rec == nil || rec?.isAvailable != true { rec = SFSpeechRecognizer() }
        guard let recogniser = rec, recogniser.isAvailable else { return "unavailable" }
        self.recogniser = recogniser

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        /// Not required on-device: a Mac without that language's on-device
        /// model would otherwise hear nothing at all, and say nothing either.
        request.requiresOnDeviceRecognition = false
        self.request = request
        self.emit = emit
        self.delivered = ""

        let input = audio.inputNode
        let format = input.outputFormat(forBus: 0)
        /// No input device, or one another app holds exclusively.
        guard format.sampleRate > 0 else { teardown(); return "audio-capture" }

        /// An audio interface offers many inputs (a UA Apollo: 18 or more),
        /// with the voice on one of them and silence or other sound on the
        /// rest. VoiceFeed follows the input the voice is on (or the one
        /// chosen), evens out a quiet preamp, and hands the recogniser
        /// 16 kHz mono — the format it is happiest with at any device rate.
        let fixed = FlowSpeech.channelChoice(deviceUID)
        let feed = VoiceFeed(format: format, fixed: fixed > 0 ? fixed - 1 : nil)
        self.feed = feed
        sinceLevel = 0
        let rate = format.sampleRate
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self, let feed = self.feed else { return }
            if let out = feed.process(buffer) { self.request?.append(out) }
            /// About four times a second: which input, and how loud — the
            /// meter in the panel, and the answer to "is it hearing me".
            self.sinceLevel += Int(buffer.frameLength)
            if Double(self.sinceLevel) >= rate / 4 {
                self.sinceLevel = 0
                let peaks = feed.takePeaks()
                let used = feed.used
                let p = used < peaks.count ? peaks[used] : 0
                if p > self.peak { self.peak = p }
                let db = { (x: Float) -> Int in x > 0 ? Int((20 * log10(x)).rounded()) : -120 }
                self.emit?("level", ["device": self.deviceName, "channels": feed.channels, "input": used + 1,
                                     "chosen": feed.fixed != nil, "db": db(p), "inputs": peaks.prefix(32).map { db($0) }])
            }
        }

        task = recogniser.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let whole = result.bestTranscription.formattedString
                if !whole.isEmpty { self.heard = true }
                if result.isFinal {
                    let fresh = self.newPart(of: whole)
                    if !fresh.isEmpty { self.emit?("final", ["text": fresh]) }
                    self.delivered = whole
                    self.finish()
                    return
                }
                self.emit?("partial", ["text": self.newPart(of: whole)])
                return
            }
            if let error = error as NSError? {
                let quiet: Set<Int> = [203, 216, 301, 1110]
                if !quiet.contains(error.code) {
                    self.emit?("error", ["code": "unknown", "message": error.localizedDescription])
                }
                self.finish()
            }
        }

        audio.prepare()
        do { try audio.start() } catch { teardown(); return "audio-capture" }
        listening = true

        /// Eight seconds, no words, and never louder than a whisper: the
        /// sound is not reaching us from this microphone. Say which one.
        let mine = turn
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self = self, self.turn == mine, self.listening, !self.heard else { return }
            if self.peak < 0.01 {
                let emit = self.emit
                emit?("error", ["code": "no-input", "device": self.deviceName, "peak": Double(self.peak)])
                self.task?.cancel()
                self.finish()
            }
        }
        return nil
    }

    /// One channel out of many: the loudest. Returns the buffer to give the
    /// recogniser and the level (RMS) it had.
    static func loudest(_ b: AVAudioPCMBuffer, mono: AVAudioFormat?) -> (AVAudioPCMBuffer?, Float) {
        let n = Int(b.frameLength), chs = Int(b.format.channelCount)
        guard n > 0 else { return (nil, 0) }
        guard let data = b.floatChannelData else { return (b, 1) }
        let inter = b.format.isInterleaved
        func sample(_ c: Int, _ i: Int) -> Float { return inter ? data[0][i * chs + c] : data[c][i] }
        var best = 0; var bestSum: Float = -1
        for c in 0..<chs {
            var sum: Float = 0
            for i in 0..<n { let v = sample(c, i); sum += v * v }
            if sum > bestSum { bestSum = sum; best = c }
        }
        let rms = (max(bestSum, 0) / Float(n)).squareRoot()
        if chs == 1 { return (b, rms) }
        guard let mono = mono, let out = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(n)), let dst = out.floatChannelData else { return (b, rms) }
        for i in 0..<n { dst[0][i] = sample(best, i) }
        out.frameLength = AVAudioFrameCount(n)
        return (out, rms)
    }

    // MARK: - Which microphone

    static let inputKey = "FlowVoiceInputUID"

    /// The microphones this Mac has: [{uid, name, channels, default}].
    static func inputs() -> [[String: Any]] {
        let def = defaultInput()
        let chosen = UserDefaults.standard.string(forKey: inputKey) ?? ""
        return allDevices().compactMap { id -> [String: Any]? in
            let ch = inputChannels(id)
            guard ch > 0 else { return nil }
            let uid = string(id, kAudioDevicePropertyDeviceUID) ?? ""
            return ["uid": uid, "name": string(id, kAudioObjectPropertyName) ?? "Microphone", "channels": ch,
                    "default": id == def, "chosen": !chosen.isEmpty && uid == chosen, "channel": channelChoice(uid)]
        }
    }

    /// Which input of a many-input device to listen to: 0 = follow the
    /// voice, k = input k. Remembered per device.
    static let channelKey = "FlowVoiceChannels"
    static func channelChoice(_ uid: String) -> Int {
        let all = UserDefaults.standard.dictionary(forKey: channelKey) as? [String: Int] ?? [:]
        return all[uid.isEmpty ? "default" : uid] ?? 0
    }
    static func chooseChannel(_ k: Int, uid: String?) {
        var all = UserDefaults.standard.dictionary(forKey: channelKey) as? [String: Int] ?? [:]
        let key = (uid ?? currentUID()) ?? "default"
        all[key.isEmpty ? "default" : key] = max(0, k)
        UserDefaults.standard.set(all, forKey: channelKey)
    }
    /// The device a turn would open now: the chosen one if plugged in, else the Mac's input.
    static func currentUID() -> String? {
        if let uid = UserDefaults.standard.string(forKey: inputKey), !uid.isEmpty,
           allDevices().contains(where: { string($0, kAudioDevicePropertyDeviceUID) == uid && inputChannels($0) > 0 }) { return uid }
        let d = defaultInput()
        return d == 0 ? nil : string(d, kAudioDevicePropertyDeviceUID)
    }

    /// "" = the Mac's own input setting.
    static func choose(_ uid: String) {
        if uid.isEmpty { UserDefaults.standard.removeObject(forKey: inputKey) }
        else { UserDefaults.standard.set(uid, forKey: inputKey) }
    }

    /// Points the engine at the chosen microphone (if it is still plugged
    /// in) and returns the name of the one it will hear.
    static func useChosenInput(on engine: AVAudioEngine) -> (name: String, uid: String)? {
        var dev = defaultInput()
        if let uid = UserDefaults.standard.string(forKey: inputKey), !uid.isEmpty,
           let id = allDevices().first(where: { string($0, kAudioDevicePropertyDeviceUID) == uid && inputChannels($0) > 0 }) {
            dev = id
            if let unit = engine.inputNode.audioUnit {
                var d = id
                AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &d, UInt32(MemoryLayout<AudioDeviceID>.size))
            }
        }
        guard dev != 0 else { return nil }
        return (string(dev, kAudioObjectPropertyName) ?? "Microphone", string(dev, kAudioDevicePropertyDeviceUID) ?? "")
    }

    private static func allDevices() -> [AudioDeviceID] {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
        return ids
    }

    private static func defaultInput() -> AudioDeviceID {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr else { return 0 }
        return id
    }

    private static func inputChannels(_ id: AudioDeviceID) -> Int {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, raw) == noErr else { return 0 }
        let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        return list.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    private static func string(_ id: AudioDeviceID, _ sel: AudioObjectPropertySelector) -> String? {
        var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr, let v = value else { return nil }
        return v.takeRetainedValue() as String
    }

    private func newPart(of whole: String) -> String {
        guard !delivered.isEmpty else { return whole.trimmingCharacters(in: .whitespaces) }
        guard whole.hasPrefix(delivered) else { return "" }
        return String(whole.dropFirst(delivered.count)).trimmingCharacters(in: .whitespaces)
    }

    func stop() {
        guard listening else { return }
        audio.inputNode.removeTap(onBus: 0)
        audio.stop()
        request?.endAudio()
    }

    func cancel() {
        guard listening else { return }
        task?.cancel()
        finish()
    }

    private func finish() {
        let emit = self.emit
        teardown()
        emit?("end", [:])
    }

    private func teardown() {
        listening = false
        feed = nil
        audio.inputNode.removeTap(onBus: 0)
        if audio.isRunning { audio.stop() }
        request?.endAudio()
        request = nil
        task = nil
        emit = nil
        recogniser = nil
        delivered = ""
    }
}


/// One input out of many, evened out, at 16 kHz mono.
final class VoiceFeed {
    let channels: Int
    let fixed: Int?
    private(set) var used = 0
    private var energy: [Float]
    private var peaks: [Float]
    private var gain: Float = 1
    private let mono: AVAudioFormat
    private let target: AVAudioFormat
    private let converter: AVAudioConverter?

    init?(format: AVAudioFormat, fixed: Int?) {
        channels = max(1, Int(format.channelCount))
        if let f = fixed, f >= 0, f < channels { self.fixed = f; used = f } else { self.fixed = nil }
        energy = Array(repeating: 0, count: channels)
        peaks = Array(repeating: 0, count: channels)
        guard let m = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.sampleRate, channels: 1, interleaved: false),
              let t = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else { return nil }
        mono = m; target = t
        converter = AVAudioConverter(from: m, to: t)
    }

    /// The loudest moment of each input since the last call.
    func takePeaks() -> [Float] { let p = peaks; peaks = Array(repeating: 0, count: channels); return p }

    func process(_ b: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        let n = Int(b.frameLength)
        guard n > 0, let data = b.floatChannelData else { return nil }
        let chs = min(channels, Int(b.format.channelCount))
        let inter = b.format.isInterleaved
        let stride = Int(b.format.channelCount)
        func s(_ c: Int, _ i: Int) -> Float { return inter ? data[0][i * stride + c] : data[c][i] }

        for c in 0..<chs {
            var e: Float = 0, p: Float = 0
            for i in 0..<n { let v = s(c, i); e += v * v; let a = abs(v); if a > p { p = a } }
            energy[c] = energy[c] * 0.92 + e / Float(n)
            if p > peaks[c] { peaks[c] = p }
        }
        /// Follow the voice: move to another input only when it is clearly
        /// louder, so a breath on the wrong one does not steal the turn.
        if fixed == nil && chs > 1 {
            var top = 0
            for c in 1..<chs where energy[c] > energy[top] { top = c }
            if top != used && energy[top] > energy[min(used, chs - 1)] * 2 && energy[top] > 1e-8 { used = top }
        }
        let ch = min(used, chs - 1)

        guard let m = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(n)), let dst = m.floatChannelData else { return nil }
        var p: Float = 0
        for i in 0..<n { let v = s(ch, i); dst[0][i] = v; let a = abs(v); if a > p { p = a } }
        m.frameLength = AVAudioFrameCount(n)
        /// A slow automatic gain, so a preamp set low still reaches the
        /// recogniser at a level it can use. At most 30x.
        if p > 0.0003 { let want = min(30, max(1, 0.3 / p)); gain = gain * 0.97 + want * 0.03 }
        if gain > 1.01 { for i in 0..<n { dst[0][i] = max(-1, min(1, dst[0][i] * gain)) } }

        guard let conv = converter else { return m }
        let cap = AVAudioFrameCount(Double(n) * 16000 / mono.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: cap) else { return m }
        var fed = false
        var err: NSError?
        let status = conv.convert(to: out, error: &err) { _, st in
            if fed { st.pointee = .noDataNow; return nil }
            fed = true; st.pointee = .haveData; return m
        }
        if status == .error || err != nil || out.frameLength == 0 { return m }
        return out
    }
}
