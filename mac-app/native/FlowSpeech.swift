import Foundation
import AVFoundation
import Speech

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

    private let audio = AVAudioEngine()
    private var recogniser: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var emit: Emit?
    private var delivered = ""
    private(set) var listening = false

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

        var rec = SFSpeechRecognizer(locale: Locale(identifier: tag))
        if rec == nil || rec?.isAvailable != true { rec = SFSpeechRecognizer() }
        guard let recogniser = rec, recogniser.isAvailable else { return "unavailable" }
        self.recogniser = recogniser

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recogniser.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        self.emit = emit
        self.delivered = ""

        let input = audio.inputNode
        let format = input.outputFormat(forBus: 0)
        /// No input device, or one another app holds exclusively.
        guard format.sampleRate > 0 else { teardown(); return "audio-capture" }

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        task = recogniser.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let whole = result.bestTranscription.formattedString
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
        return nil
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
