import Foundation
import Speech
import AVFAudio
import Accelerate
import os
import VoiceFlowProtocol

private let logger = Logger(subsystem: "com.hibachi.voiceflow.stt", category: "STTService")

final class STTService: NSObject, STTServiceProtocol {
    private var recognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    private var latestTranscript = ""
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
        logger.info("Starting recording with locale: \(localeID)")
        let locale = Locale(identifier: localeID)
        guard let recognizer = SFSpeechRecognizer(locale: locale),
              recognizer.isAvailable else {
            logger.error("Speech recognizer unavailable for locale: \(localeID)")
            client?.didEncounterError("Speech recognizer is not available for \(localeID).")
            return
        }
        self.recognizer = recognizer

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        if #available(macOS 26, *) {
            request.addsPunctuation = true
        }
        self.recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            request.append(buffer)
            self?.processAudioLevel(buffer: buffer)
        }
        tapInstalled = true

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let text = result.bestTranscription.formattedString
                self.lock.lock()
                self.latestTranscript = text
                self.lock.unlock()
                self.client?.didUpdateTranscript(text)
            }
            if let error {
                // Ignore cancellation errors from finish() during normal stop
                let nsError = error as NSError
                guard nsError.code != 203 && nsError.code != 216 else { return }
                self.client?.didEncounterError(error.localizedDescription)
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            logger.error("Audio engine failed to start: \(error.localizedDescription)")
            cleanup()
            client?.didEncounterError(error.localizedDescription)
        }
    }

    func stopRecording(reply: @escaping (String?) -> Void) {
        logger.info("Stopping recording")
        cleanup()

        lock.lock()
        let transcript = latestTranscript
        latestTranscript = ""
        lock.unlock()

        reply(transcript.isEmpty ? nil : transcript)
    }

    private func cleanup() {
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        audioEngine.stop()
        recognitionRequest?.endAudio()
        recognitionTask?.finish()
        recognitionRequest = nil
        recognitionTask = nil
        recognizer = nil
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
