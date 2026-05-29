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
    private var accumulatedTranscript = ""
    private var currentSegment = ""
    private let lock = NSLock()
    private weak var connection: NSXPCConnection?
    private var tapInstalled = false
    private var activeLocale: String?

    init(connection: NSXPCConnection) {
        self.connection = connection
    }

    private var client: STTClientProtocol? {
        connection?.remoteObjectProxy as? STTClientProtocol
    }

    func startRecording(locale localeID: String) {
        logger.info("Starting recording with locale: \(localeID)")
        activeLocale = localeID
        lock.lock()
        accumulatedTranscript = ""
        currentSegment = ""
        lock.unlock()

        startAudioEngineIfNeeded()
        startRecognitionTask(locale: localeID)
    }

    func stopRecording(reply: @escaping (String?) -> Void) {
        logger.info("Stopping recording")
        activeLocale = nil
        cleanupRecognition()
        stopAudioEngine()

        lock.lock()
        let full = fullTranscript
        accumulatedTranscript = ""
        currentSegment = ""
        lock.unlock()

        reply(full.isEmpty ? nil : full)
    }

    // MARK: - Audio Engine

    private func startAudioEngineIfNeeded() {
        guard !audioEngine.isRunning else { return }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        if !tapInstalled {
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
                self?.recognitionRequest?.append(buffer)
                self?.processAudioLevel(buffer: buffer)
            }
            tapInstalled = true
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

    private func stopAudioEngine() {
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        audioEngine.stop()
    }

    // MARK: - Recognition Task

    private func startRecognitionTask(locale localeID: String) {
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

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }

            if let result {
                let segment = result.bestTranscription.formattedString
                self.lock.lock()
                self.currentSegment = segment
                let display = self.fullTranscript
                self.lock.unlock()
                self.client?.didUpdateTranscript(display)

                if result.isFinal {
                    logger.info("Recognition segment finalized, restarting task")
                    self.lock.lock()
                    self.accumulatedTranscript = self.fullTranscript
                    self.currentSegment = ""
                    self.lock.unlock()

                    self.cleanupRecognition()
                    if let locale = self.activeLocale {
                        self.startRecognitionTask(locale: locale)
                    }
                }
            }

            if let error {
                let nsError = error as NSError
                // Ignore cancellation/session-end errors during normal operation
                guard nsError.code != 203 && nsError.code != 216 else { return }
                logger.error("Recognition error: \(nsError.code) \(error.localizedDescription)")
                self.client?.didEncounterError(error.localizedDescription)
            }
        }
    }

    private func cleanupRecognition() {
        recognitionRequest?.endAudio()
        recognitionTask?.finish()
        recognitionRequest = nil
        recognitionTask = nil
        recognizer = nil
    }

    private func cleanup() {
        cleanupRecognition()
        stopAudioEngine()
    }

    private var fullTranscript: String {
        if accumulatedTranscript.isEmpty {
            return currentSegment
        }
        if currentSegment.isEmpty {
            return accumulatedTranscript
        }
        return accumulatedTranscript + " " + currentSegment
    }

    // MARK: - Audio Level

    private func processAudioLevel(buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameLength = UInt(buffer.frameLength)
        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, frameLength)
        let level = max(0, min(1, rms * 10))
        client?.didUpdateAudioLevel(level)
    }
}
