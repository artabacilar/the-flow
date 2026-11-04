import Foundation
import AVFoundation
import Speech

/// Turning what somebody says into text, on the phone, for the web app to use.
///
/// Why this is native at all
/// ------------------------
/// `SpeechRecognition` does not exist in WKWebView. Not prefixed, not behind a
/// flag — Safari has it and the web view Safari is built from does not. So
/// inside the app there is no web path to fall back to, and the twenty lines
/// of bridge that already exist grow four more methods instead.
///
/// What it promises the page
/// -------------------------
/// The same stream the browser's own recogniser produces: interim guesses that
/// will change, then a final segment that will not. `flow-voice.js` shows the
/// first kind in a bubble and only ever writes the second kind into a field,
/// so the important half of the contract is that `isFinal` means what it says.
///
/// On-device where the phone can
/// -----------------------------
/// `requiresOnDeviceRecognition` keeps the audio on the handset when the
/// locale has a downloaded model. That is worth asking for even though it is
/// only a hint: this is a journal, and a journal that quietly uploads what you
/// dictate is not one people should have to think about. Where the model is
/// absent the recogniser falls back to Apple's servers, which is the same
/// place the keyboard's own dictation sends it.
final class FlowSpeech: NSObject {

    /// Called with (type, payload) — "partial", "final", "error", "end".
    typealias Emit = (String, [String: Any]) -> Void

    private let audio = AVAudioEngine()
    private var recogniser: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var emit: Emit?

    /// Everything already handed over as final, so a restarted task never
    /// repeats a sentence into somebody's journal. `SFSpeechRecognitionTask`
    /// reports the whole utterance each time, not the delta.
    private var delivered = ""

    private(set) var listening = false

    // MARK: - What the system will let us do

    static func permissions() -> [String: Any] {
        return [
            "supported": true,
            "mic": micState(),
            "speech": speechState(),
        ]
    }

    private static func micState() -> String {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted:    return "granted"
            case .denied:     return "denied"
            default:          return "undetermined"
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "granted"
        case .denied:  return "denied"
        default:       return "undetermined"
        }
    }

    private static func speechState() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:  return "granted"
        case .denied:      return "denied"
        case .restricted:  return "denied"
        default:           return "undetermined"
        }
    }

    /// Ask for both, in order, and answer once with the state that resulted.
    /// Asking for speech first means the two system prompts arrive back to
    /// back rather than with the recording one orphaned in the middle.
    static func request(_ done: @escaping ([String: Any]) -> Void) {
        SFSpeechRecognizer.requestAuthorization { _ in
            let finish = { DispatchQueue.main.async { done(permissions()) } }
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { _ in finish() }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { _ in finish() }
            }
        }
    }

    // MARK: - Listening

    /// Returns nil on success, or a code the page knows how to explain.
    func start(locale tag: String, emit: @escaping Emit) -> String? {
        if listening { return nil }

        guard SFSpeechRecognizer.authorizationStatus() == .authorized else { return "denied" }
        guard FlowSpeech.micState() == "granted" else { return "denied" }

        /// An unsupported locale is a real possibility — Turkish is supported,
        /// but the set is Apple's and changes — and falling back to the device
        /// language beats refusing outright.
        var rec = SFSpeechRecognizer(locale: Locale(identifier: tag))
        if rec == nil || rec?.isAvailable != true { rec = SFSpeechRecognizer() }
        guard let recogniser = rec, recogniser.isAvailable else { return "unavailable" }
        self.recogniser = recogniser

        let session = AVAudioSession.sharedInstance()
        do {
            /// `.measurement` turns off the processing the system applies for
            /// voice calls, which is what the recogniser wants to hear.
            /// `.duckOthers` so dictating over music does not fight it.
            try session.setCategory(.playAndRecord, mode: .measurement,
                                    options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            return "audio-capture"
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recogniser.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        self.emit = emit
        self.delivered = ""

        let input = audio.inputNode
        let format = input.outputFormat(forBus: 0)
        /// A zero sample rate means the route is not ready — happens when a
        /// call or another recorder holds the microphone. Tapping it anyway
        /// throws inside CoreAudio, where it cannot be caught.
        guard format.sampleRate > 0 else {
            teardown()
            return "audio-capture"
        }

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

                /// Everything past what we have already committed is still
                /// provisional, and that is exactly what the bubble shows.
                self.emit?("partial", ["text": self.newPart(of: whole)])
                return
            }

            if let error = error as NSError? {
                /// 203 / 216 / 301 are "the session ended" dressed as failures
                /// — after a stop, or after silence. Anything the person said
                /// before that is already committed, so this is an end, not a
                /// thing to apologise for.
                let quiet: Set<Int> = [203, 216, 301, 1110]
                if !quiet.contains(error.code) {
                    self.emit?("error", ["code": "unknown", "message": error.localizedDescription])
                }
                self.finish()
            }
        }

        audio.prepare()
        do { try audio.start() } catch {
            teardown()
            return "audio-capture"
        }

        listening = true
        return nil
    }

    /// The tail of `whole` that has not been handed over yet.
    private func newPart(of whole: String) -> String {
        guard !delivered.isEmpty else { return whole.trimmingCharacters(in: .whitespaces) }
        guard whole.hasPrefix(delivered) else {
            /// The recogniser revised something it had already called final.
            /// Rare, and there is nothing honest to do about it — the words
            /// are in the field. Start from here rather than duplicating.
            return ""
        }
        return String(whole.dropFirst(delivered.count)).trimmingCharacters(in: .whitespaces)
    }

    /// Stop listening but let the recogniser finish what it heard — the last
    /// sentence usually lands a beat after the tap.
    func stop() {
        guard listening else { return }
        audio.inputNode.removeTap(onBus: 0)
        audio.stop()
        request?.endAudio()
    }

    /// Throw the turn away. Nothing further is emitted except the end.
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
        /// Hand the audio route back, or whatever was playing before stays
        /// ducked until the app is killed.
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
