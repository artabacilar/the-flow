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
    private var turn = 0

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
        deviceName = FlowSpeech.useChosenInput(on: audio) ?? ""

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
        /// with the voice on one or two of them and silence on the rest. The
        /// recogniser is given one channel — the loudest in each buffer.
        let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.sampleRate, channels: 1, interleaved: false)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self else { return }
            let (out, level) = FlowSpeech.loudest(buffer, mono: mono)
            if level > self.peak { self.peak = level }
            if let out = out { self.request?.append(out) }
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
                    "default": id == def, "chosen": !chosen.isEmpty && uid == chosen]
        }
    }

    /// "" = the Mac's own input setting.
    static func choose(_ uid: String) {
        if uid.isEmpty { UserDefaults.standard.removeObject(forKey: inputKey) }
        else { UserDefaults.standard.set(uid, forKey: inputKey) }
    }

    /// Points the engine at the chosen microphone (if it is still plugged
    /// in) and returns the name of the one it will hear.
    static func useChosenInput(on engine: AVAudioEngine) -> String? {
        var dev = defaultInput()
        if let uid = UserDefaults.standard.string(forKey: inputKey), !uid.isEmpty,
           let id = allDevices().first(where: { string($0, kAudioDevicePropertyDeviceUID) == uid && inputChannels($0) > 0 }) {
            dev = id
            if let unit = engine.inputNode.audioUnit {
                var d = id
                AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &d, UInt32(MemoryLayout<AudioDeviceID>.size))
            }
        }
        return dev == 0 ? nil : string(dev, kAudioObjectPropertyName)
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
