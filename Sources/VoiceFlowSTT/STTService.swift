import Foundation
import Speech
import AVFAudio
import Accelerate
import VoiceFlowProtocol
import CoreMedia

final class STTService: NSObject, STTServiceProtocol {
    private var recognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()

    @available(macOS 26, *)
    private var analyzer: SpeechAnalyzer? {
        get { _analyzer as? SpeechAnalyzer }
        set { _analyzer = newValue }
    }
    private var _analyzer: AnyObject?
    private var analyzerTask: Task<Void, Never>?

    private var confirmedText = ""
    private var provisionalText = ""
    private var stopped = false
    private let lock = NSLock()

    private weak var connection: NSXPCConnection?
    private var tapInstalled = false

    init(connection: NSXPCConnection) {
        self.connection = connection
    }

    private var client: STTClientProtocol? {
        connection?.remoteObjectProxy as? STTClientProtocol
    }

    func startRecording(locale localeID: String, engine: String) {
        if recognitionTask != nil || _analyzer != nil {
            cleanup()
        }

        if engine == "enhanced", #available(macOS 26, *) {
            startWithSpeechAnalyzer(locale: localeID)
            return
        }

        startWithClassic(locale: localeID)
    }

    // MARK: - Classic (SFSpeechRecognizer)

    private func startWithClassic(locale localeID: String) {
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
        stopped = false
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

        installTapIfNeeded { [weak self] buffer in
            self?.recognitionRequest?.append(buffer)
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }

            self.lock.lock()
            guard !self.stopped else { self.lock.unlock(); return }

            if let result {
                let text = result.bestTranscription.formattedString

                let threshold = max(self.provisionalText.count / 2, 1)
                if !self.provisionalText.isEmpty && text.count < threshold {
                    self.confirmedText = self.lockedFullTranscript
                }
                self.provisionalText = text
                let display = self.lockedFullTranscript
                self.lock.unlock()

                self.client?.didUpdateTranscript(display)

                if result.isFinal {
                    self.lock.lock()
                    self.confirmedText = self.lockedFullTranscript
                    self.provisionalText = ""
                    self.lock.unlock()
                }
                return
            }
            self.lock.unlock()

            if let error {
                let code = (error as NSError).code
                if code == 216 || code == 203 || code == 1110 {
                    self.lock.lock()
                    if !self.provisionalText.isEmpty {
                        self.confirmedText = self.lockedFullTranscript
                        self.provisionalText = ""
                    }
                    self.lock.unlock()
                } else {
                    self.client?.didEncounterError(error.localizedDescription)
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

    // MARK: - Enhanced (SpeechAnalyzer + SpeechTranscriber, macOS 26+)

    @available(macOS 26, *)
    private func startWithSpeechAnalyzer(locale localeID: String) {
        let locale = Locale(identifier: localeID)
        let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)

        nonisolated(unsafe) let unsafeSelf = self
        Task {
            let status = await AssetInventory.status(forModules: [transcriber])
            guard status >= .installed else {
                unsafeSelf.startWithClassic(locale: localeID)
                return
            }
            unsafeSelf.launchAnalyzer(transcriber: transcriber, locale: localeID)
        }
    }

    @available(macOS 26, *)
    private func launchAnalyzer(transcriber: SpeechTranscriber, locale localeID: String) {
        lock.lock()
        confirmedText = ""
        provisionalText = ""
        stopped = false
        lock.unlock()

        let sa = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = sa

        let inputStream = AsyncStream<AnalyzerInput> { [weak self] continuation in
            self?.installTapIfNeeded { buffer in
                continuation.yield(AnalyzerInput(buffer: buffer))
            }

            continuation.onTermination = { _ in
                Task { @MainActor in
                    // tap cleanup handled in cleanup()
                }
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            cleanup()
            client?.didEncounterError(error.localizedDescription)
            return
        }

        nonisolated(unsafe) let unsafeSelf = self
        analyzerTask = Task {
            do {
                try await sa.start(inputSequence: inputStream)

                for try await result in transcriber.results {
                    let shouldBreak = unsafeSelf.lock.withLock {
                        guard !unsafeSelf.stopped else { return true }
                        unsafeSelf.provisionalText = String(result.text.characters)
                        return false
                    }
                    if shouldBreak { break }
                    let display = unsafeSelf.lock.withLock { unsafeSelf.lockedFullTranscript }
                    unsafeSelf.client?.didUpdateTranscript(display)
                }
            } catch {
                let isStopped = unsafeSelf.lock.withLock { unsafeSelf.stopped }
                if !isStopped {
                    unsafeSelf.client?.didEncounterError(error.localizedDescription)
                }
            }
        }
    }

    // MARK: - Stop

    func stopRecording(reply: @escaping (String?) -> Void) {
        lock.lock()
        stopped = true
        let result = lockedFullTranscript
        confirmedText = ""
        provisionalText = ""
        lock.unlock()

        if #available(macOS 26, *), let sa = analyzer {
            analyzerTask?.cancel()
            analyzerTask = nil
            Task {
                try? await sa.finish(after: .zero)
            }
            self.analyzer = nil
        }

        recognitionRequest?.endAudio()
        recognitionTask?.finish()
        cleanup()

        reply(result.isEmpty ? nil : result)
    }

    // MARK: - Private

    private var audioTapHandler: ((AVAudioPCMBuffer) -> Void)?

    private func installTapIfNeeded(handler: @escaping (AVAudioPCMBuffer) -> Void) {
        audioTapHandler = handler
        guard !tapInstalled else { return }
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.audioTapHandler?(buffer)
            self?.processAudioLevel(buffer: buffer)
        }
        tapInstalled = true
    }

    private func cleanup() {
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        audioTapHandler = nil
        audioEngine.stop()
        recognitionRequest = nil
        recognitionTask = nil
        recognizer = nil
    }

    /// Must be called while lock is held.
    private var lockedFullTranscript: String {
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
