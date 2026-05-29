import Foundation
import Speech
import AVFAudio
import Accelerate
import VoiceFlowProtocol

final class STTService: NSObject, STTServiceProtocol {
    private var recognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()

    private var confirmedText = ""
    private var provisionalText = ""
    private let lock = NSLock()

    private weak var connection: NSXPCConnection?
    private var tapInstalled = false

    init(connection: NSXPCConnection) {
        self.connection = connection
    }

    private var client: STTClientProtocol? {
        connection?.remoteObjectProxy as? STTClientProtocol
    }

    func startRecording(locale localeID: String) {
        let locale = Locale(identifier: localeID)
        guard let recognizer = SFSpeechRecognizer(locale: locale),
              recognizer.isAvailable else {
            client?.didEncounterError("Speech recognizer is not available for \(localeID).")
            return
        }
        self.recognizer = recognizer

        lock.lock()
        confirmedText = ""
        provisionalText = ""
        lock.unlock()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        if #available(macOS 26, *) {
            request.addsPunctuation = true
        }
        self.recognitionRequest = request

        if !tapInstalled {
            let inputNode = audioEngine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                self?.recognitionRequest?.append(buffer)
                self?.processAudioLevel(buffer: buffer)
            }
            tapInstalled = true
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }

            if let result {
                let text = result.bestTranscription.formattedString

                lock.lock()
                // Detect segment reset: if new text is significantly shorter,
                // the recognizer started a new internal session.
                // Save the previous provisional text before overwriting.
                if !provisionalText.isEmpty && text.count < provisionalText.count / 2 {
                    confirmedText = fullTranscript
                    provisionalText = ""
                }
                provisionalText = text
                let display = fullTranscript
                lock.unlock()

                client?.didUpdateTranscript(display)

                if result.isFinal {
                    lock.lock()
                    confirmedText = fullTranscript
                    provisionalText = ""
                    lock.unlock()
                }
            }

            if let error {
                let code = (error as NSError).code
                if code == 216 || code == 203 || code == 1110 {
                    // Session ended — save whatever we have
                    lock.lock()
                    if !provisionalText.isEmpty {
                        confirmedText = fullTranscript
                        provisionalText = ""
                    }
                    lock.unlock()
                } else {
                    client?.didEncounterError(error.localizedDescription)
                }
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            cleanup()
            client?.didEncounterError(error.localizedDescription)
        }
    }

    func stopRecording(reply: @escaping (String?) -> Void) {
        recognitionRequest?.endAudio()
        recognitionTask?.finish()

        // Wait briefly for final callback
        nonisolated(unsafe) let sendableReply = reply
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self else { sendableReply(nil); return }

            self.cleanup()

            self.lock.lock()
            let result = self.fullTranscript
            self.confirmedText = ""
            self.provisionalText = ""
            self.lock.unlock()

            sendableReply(result.isEmpty ? nil : result)
        }
    }

    private func cleanup() {
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        audioEngine.stop()
        recognitionRequest = nil
        recognitionTask = nil
        recognizer = nil
    }

    private var fullTranscript: String {
        if confirmedText.isEmpty { return provisionalText }
        if provisionalText.isEmpty { return confirmedText }
        return confirmedText + " " + provisionalText
    }

    private func processAudioLevel(buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameLength = UInt(buffer.frameLength)
        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, frameLength)
        let level = max(0, min(1, rms * 10))
        client?.didUpdateAudioLevel(level)
    }
}
