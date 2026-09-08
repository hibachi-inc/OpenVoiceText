import Foundation
import Speech
@preconcurrency import AVFAudio
import Accelerate
import CoreMedia
import AudioToolbox
import os

private let sttLogger = Logger(subsystem: "com.hibachi.voiceflow.stt", category: "STTService")

final class SpeechSession: NSObject, @unchecked Sendable {
    enum Event: Sendable {
        case engine(String)
        case transcript(String)
        case audioLevel(Float)
        case error(String)
    }

    private let emit: @Sendable (Event) -> Void
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
    private var _analyzerContinuation: Any?
    @available(macOS 26, *)
    private var analyzerContinuation: AsyncStream<AnalyzerInput>.Continuation? {
        get { _analyzerContinuation as? AsyncStream<AnalyzerInput>.Continuation }
        set { _analyzerContinuation = newValue }
    }

    private var confirmedText = ""
    private var provisionalText = ""
    private var stopped = false
    private var stopRequested = false
    private var stopReply: ((String?) -> Void)?
    private var stopFinalizationTask: Task<Void, Never>?
    private var warmUpTask: Task<Void, Never>?
    private var preparationTask: Task<Void, Never>?
    private var preparationTimeoutTask: Task<Void, Never>?
    private let lock = NSLock()

    private var tapInstalled = false
    private var pendingBuffers: [AVAudioPCMBuffer] = []
    private var fallbackBuffers: [AVAudioPCMBuffer] = []
    private var fallbackBufferDuration: TimeInterval = 0
    private var fallbackBufferStartTime: TimeInterval = 0
    private var isPreparing = false
    private var isFallingBack = false
    private var analyzerRunID: UUID?
    private var classicRunID: UUID?
    private var enhancedAudioHandler: ((AVAudioPCMBuffer) -> Void)?
    private var stopRequestedWhilePreparing = false
    private var currentVocabulary: [String] = []
    private var currentLocaleID = ""
    private var cloudAudioFile: AVAudioFile?
    private var cloudCaptureActive = false
    private var cloudWriteFailed = false
    // completeStop時に確定した、本文を作ったエンジン。final応答に載せる。
    private var completedEngine = ""
    // ponytail: 15 seconds bounds PCM memory; move capture to the app process if longer crash replay is required.
    private let maxFallbackBufferDuration: TimeInterval = 15

    init(emit: @escaping @Sendable (Event) -> Void) {
        self.emit = emit
    }

    func warmUp(locale localeID: String, engine: String) {
        warmUpTask?.cancel()
        guard engine == "enhanced", #available(macOS 26, *) else {
            _ = SFSpeechRecognizer(locale: Locale(identifier: localeID))
            return
        }

        let locale = Locale(identifier: localeID)
        let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        warmUpTask = Task {
            guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]),
                  !Task.isCancelled else { return }
            try? await analyzer.prepareToAnalyze(in: format)
            sttLogger.notice("[STTService] speech model warmed for \(localeID, privacy: .public)")
        }
    }

    func startRecording(
        locale localeID: String,
        engine: String,
        deviceID: UInt32,
        vocabulary: [String],
        reply: @escaping () -> Void
    ) {
        sttLogger.notice("[STTService] startRecording locale=\(localeID, privacy: .public) engine=\(engine, privacy: .public)")
        warmUpTask?.cancel()
        warmUpTask = nil
        if recognitionTask != nil || _analyzer != nil || audioEngine.isRunning || isPreparing {
            sttLogger.notice("[STTService] startRecording: cleaning up previous session")
            cleanup()
        }

        resetSession()
        currentLocaleID = localeID
        currentVocabulary = vocabulary
        configureInputDevice(deviceID)
        sttLogger.notice("[STTService] startRecording: input configured")

        if engine == "enhanced", #available(macOS 26, *) {
            startWithSpeechAnalyzer(locale: localeID, onCaptureReady: reply)
            return
        }

        startWithClassic(locale: localeID, onCaptureReady: reply)
    }

    func startCloudCapture(path: String, provider: String, deviceID: UInt32, reply: @escaping () -> Void) {
        warmUpTask?.cancel()
        warmUpTask = nil
        if recognitionTask != nil || _analyzer != nil || audioEngine.isRunning || isPreparing {
            cleanup()
        }

        resetSession()
        configureInputDevice(deviceID)
        let format = audioEngine.inputNode.outputFormat(forBus: 0)
        do {
            cloudAudioFile = try AVAudioFile(forWriting: URL(fileURLWithPath: path), settings: format.settings)
            cloudCaptureActive = true
            installTapIfNeeded { [weak self] buffer in
                guard let self, !self.cloudWriteFailed else { return }
                do {
                    try self.cloudAudioFile?.write(from: buffer)
                } catch {
                    self.cloudWriteFailed = true
                    self.emit(.error("録音を保存できませんでした"))
                }
            }
            audioEngine.prepare()
            try startAudioEngineWithWatchdog()
            emit(.engine(provider))
            reply()
        } catch {
            emit(.error("録音を開始できません: \(error.localizedDescription)"))
            cleanup()
        }
    }

    // MARK: - Classic (SFSpeechRecognizer)

    private func startWithClassic(
        locale localeID: String,
        initialBuffers: [AVAudioPCMBuffer] = [],
        initialTranscript: String = "",
        onCaptureReady: (() -> Void)? = nil
    ) {
        emit(.engine("classic"))

        let runID = UUID()
        let shouldCapture = lock.withLock {
            isPreparing = true
            analyzerRunID = nil
            classicRunID = runID
            confirmedText = initialTranscript
            provisionalText = ""
            pendingBuffers.insert(contentsOf: initialBuffers, at: 0)
            return !stopRequested && !stopped
        }
        preparationTimeoutTask?.cancel()
        preparationTimeoutTask = nil
        stopFinalizationTask?.cancel()
        stopFinalizationTask = nil

        if shouldCapture {
            // Buffer until the classic request is ready. During fallback this also
            // replaces the enhanced tap handler without interrupting the microphone.
            installTapIfNeeded { [weak self] buffer in
                guard let self else { return }
                self.lock.lock()
                if let request = self.recognitionRequest {
                    self.lock.unlock()
                    request.append(buffer)
                } else {
                    if let copied = self.copyAudioBuffer(buffer) {
                        self.pendingBuffers.append(copied)
                    }
                    self.lock.unlock()
                }
            }
            if !audioEngine.isRunning {
                do {
                    audioEngine.prepare()
                    try startAudioEngineWithWatchdog()
                } catch {
                    emit(.error(error.localizedDescription))
                    cleanup()
                    return
                }
            }
        }

        let locale = Locale(identifier: localeID)
        guard let recognizer = SFSpeechRecognizer(locale: locale),
              recognizer.isAvailable else {
            cleanup()
            emit(.error("この言語では音声認識を利用できません"))
            return
        }
        self.recognizer = recognizer

        guard recognizer.supportsOnDeviceRecognition else {
            cleanup()
            emit(.error("オンデバイス音声認識を利用できません"))
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.contextualStrings = currentVocabulary
        if #available(macOS 26, *) {
            request.addsPunctuation = true
        }

        // Flush buffered audio, then switch to direct append
        lock.lock()
        for buffer in pendingBuffers { request.append(buffer) }
        pendingBuffers.removeAll()
        self.recognitionRequest = request
        lock.unlock()

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }

            self.lock.lock()
            guard !self.stopped, self.classicRunID == runID else {
                self.lock.unlock()
                return
            }

            if let result {
                let text = result.bestTranscription.formattedString

                let threshold = max(self.provisionalText.count / 2, 1)
                if !self.provisionalText.isEmpty && text.count < threshold {
                    self.confirmedText = self.lockedFullTranscript
                }
                self.provisionalText = text
                let display = self.lockedFullTranscript
                self.lock.unlock()

                guard self.lock.withLock({ self.classicRunID == runID && !self.stopped }) else { return }
                self.emit(.transcript(display))

                if result.isFinal {
                    self.lock.lock()
                    guard !self.stopped, self.classicRunID == runID else {
                        self.lock.unlock()
                        return
                    }
                    self.confirmedText = self.lockedFullTranscript
                    self.provisionalText = ""
                    let shouldCompleteStop = self.stopRequested
                    self.lock.unlock()
                    if shouldCompleteStop {
                        self.completeStop()
                    }
                }
                return
            }
            self.lock.unlock()

            if let error {
                let code = (error as NSError).code
                if code == 216 || code == 203 || code == 1110 {
                    self.lock.lock()
                    guard !self.stopped, self.classicRunID == runID else {
                        self.lock.unlock()
                        return
                    }
                    if !self.provisionalText.isEmpty {
                        self.confirmedText = self.lockedFullTranscript
                        self.provisionalText = ""
                    }
                    let shouldCompleteStop = self.stopRequested
                    self.lock.unlock()
                    if shouldCompleteStop {
                        self.completeStop()
                    }
                } else {
                    guard self.lock.withLock({ self.classicRunID == runID && !self.stopped }) else { return }
                    self.emit(.error(error.localizedDescription))
                    if self.lock.withLock({ self.stopRequested }) {
                        self.completeStop()
                    }
                }
            }
        }

        let shouldContinueCapture = lock.withLock {
            guard !stopped, classicRunID == runID else { return false }
            isPreparing = false
            isFallingBack = false
            return !stopRequested
        }
        if shouldCapture && shouldContinueCapture {
            onCaptureReady?()
        } else {
            stopAudioCapture()
            request.endAudio()
            recognitionTask?.finish()
            scheduleStopFinalization(after: stopRequestedWhilePreparing ? .seconds(8) : .seconds(4))
        }
    }

    // MARK: - Enhanced (SpeechAnalyzer + SpeechTranscriber, macOS 26+)

    @available(macOS 26, *)
    private func startWithSpeechAnalyzer(locale localeID: String, onCaptureReady: @escaping () -> Void) {
        lock.withLock {
            isPreparing = true
            enhancedAudioHandler = nil
        }
        stopFinalizationTask?.cancel()
        stopFinalizationTask = nil

        // Start audio capture immediately — buffer while checking model availability
        installTapIfNeeded { [weak self] buffer in
            self?.routeEnhancedAudioBuffer(buffer)
        }
        sttLogger.notice("[STTService] enhanced: tap installed")
        do {
            audioEngine.prepare()
            // engine.startが戻らない機種・状態があるため番犬タイマーを付ける
            try startAudioEngineWithWatchdog()
            sttLogger.notice("[STTService] enhanced: engine started")
        } catch {
            // 先に失敗を返す。cleanupのstop()はwedgedしたstartに引きずられ
            // 戻らないことがあり、後回しにすると10秒沈黙になる。
            emit(.error(error.localizedDescription))
            cleanup()
            return
        }
        onCaptureReady()

        preparationTimeoutTask?.cancel()
        nonisolated(unsafe) let unsafeSelf = self
        preparationTimeoutTask = Task {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled,
                  unsafeSelf.lock.withLock({ unsafeSelf.isPreparing }) else { return }
            sttLogger.notice("[STTService] enhanced preparation timed out, falling back to classic")
            unsafeSelf.fallbackToClassicPreservingBufferedAudio(
                locale: localeID,
                onlyWhilePreparing: true
            )
        }

        preparationTask = Task {
            guard !Task.isCancelled else { return }
            // 地域なしロケール(例: ja)でも対応タグ(例: ja-JP)に寄せる
            guard let match = await bestSupportedSpeechLocaleID(for: localeID) else {
                sttLogger.notice("[STTService] locale=\(localeID, privacy: .public) not supported, falling back to classic")
                unsafeSelf.fallbackToClassicPreservingBufferedAudio(
                    locale: localeID,
                    onlyWhilePreparing: true
                )
                return
            }
            let transcriber = SpeechTranscriber(locale: Locale(identifier: match), preset: .progressiveTranscription)
            sttLogger.notice("[STTService] enhanced: transcriber created for \(match, privacy: .public)")
            let installed = await SpeechTranscriber.installedLocales
            guard !Task.isCancelled else { return }
            let isInstalled = installed.contains { $0.identifier(.bcp47) == match }
            sttLogger.notice("[STTService] locale=\(match, privacy: .public) installed=\(isInstalled)")
            if isInstalled {
                let runID = UUID()
                guard !Task.isCancelled,
                      unsafeSelf.lock.withLock({
                          guard unsafeSelf.isPreparing,
                                !unsafeSelf.isFallingBack,
                                unsafeSelf.analyzerRunID == nil else { return false }
                          unsafeSelf.analyzerRunID = runID
                          return true
                      }) else {
                    return
                }
                unsafeSelf.preparationTask = nil
                unsafeSelf.launchAnalyzer(transcriber: transcriber, locale: match, runID: runID)
                return
            }
            sttLogger.notice("[STTService] Model not installed, falling back to classic")
            unsafeSelf.fallbackToClassicPreservingBufferedAudio(
                locale: localeID,
                onlyWhilePreparing: true
            )
        }
    }

    @available(macOS 26, *)
    private func launchAnalyzer(
        transcriber: SpeechTranscriber,
        locale localeID: String,
        runID: UUID
    ) {
        emit(.engine("enhanced"))

        let sa = SpeechAnalyzer(modules: [transcriber])
        guard lock.withLock({
            guard isPreparing, !isFallingBack, analyzerRunID == runID else { return false }
            analyzer = sa
            return true
        }) else { return }

        let inputNode = audioEngine.inputNode
        let micFormat = inputNode.outputFormat(forBus: 0)

        nonisolated(unsafe) let unsafeSelf = self
        let task = Task {
            var resultsTask: Task<Void, Error>?
            do {
                guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]),
                      !Task.isCancelled,
                      unsafeSelf.lock.withLock({
                          unsafeSelf.isPreparing
                              && !unsafeSelf.isFallingBack
                              && unsafeSelf.analyzerRunID == runID
                      }) else {
                    if Task.isCancelled || unsafeSelf.lock.withLock({ unsafeSelf.isFallingBack }) { return }
                    sttLogger.notice("[STTService] No compatible audio format, falling back to classic")
                    unsafeSelf.fallbackToClassicPreservingBufferedAudio(locale: localeID)
                    return
                }
                sttLogger.notice("[STTService] format: mic=\(micFormat, privacy: .public) analyzer=\(analyzerFormat, privacy: .public)")
                let converter: AVAudioConverter?
                if micFormat != analyzerFormat {
                    guard let c = AVAudioConverter(from: micFormat, to: analyzerFormat) else {
                        sttLogger.notice("[STTService] Cannot create converter, falling back to classic")
                        unsafeSelf.fallbackToClassicPreservingBufferedAudio(locale: localeID)
                        return
                    }
                    c.primeMethod = .none
                    converter = c
                } else {
                    converter = nil
                }

                let (inputStream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
                guard unsafeSelf.lock.withLock({
                    guard unsafeSelf.isPreparing,
                          !unsafeSelf.isFallingBack,
                          unsafeSelf.analyzerRunID == runID else { return false }
                    unsafeSelf.analyzerContinuation = continuation
                    return true
                }) else {
                    continuation.finish()
                    return
                }

                // Flush buffered audio, then switch tap to analyzer feed
                let convertAndYield: (AVAudioPCMBuffer) -> Void = { buffer in
                    if let converter {
                        let ratio = analyzerFormat.sampleRate / micFormat.sampleRate
                        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up))
                        guard let converted = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity) else {
                            Task {
                                guard unsafeSelf.lock.withLock({ unsafeSelf.analyzerRunID == runID }) else { return }
                                unsafeSelf.fallbackToClassicPreservingBufferedAudio(locale: localeID)
                            }
                            return
                        }
                        var error: NSError?
                        converter.convert(to: converted, error: &error) { _, outStatus in
                            outStatus.pointee = .haveData
                            return buffer
                        }
                        if error == nil {
                            continuation.yield(AnalyzerInput(buffer: converted))
                        } else {
                            Task {
                                guard unsafeSelf.lock.withLock({ unsafeSelf.analyzerRunID == runID }) else { return }
                                unsafeSelf.fallbackToClassicPreservingBufferedAudio(locale: localeID)
                            }
                        }
                    } else {
                        continuation.yield(AnalyzerInput(buffer: buffer))
                    }
                }

                // Keep routing capture into pendingBuffers until every earlier buffer
                // has been flushed. The empty-check and live-handler switch are atomic.
                while true {
                    let buffered: [AVAudioPCMBuffer]? = unsafeSelf.lock.withLock {
                        guard unsafeSelf.analyzerRunID == runID,
                              !unsafeSelf.isFallingBack else { return nil }
                        guard !unsafeSelf.pendingBuffers.isEmpty else {
                            unsafeSelf.enhancedAudioHandler = convertAndYield
                            unsafeSelf.isPreparing = false
                            return []
                        }
                        let batch = unsafeSelf.pendingBuffers
                        unsafeSelf.pendingBuffers.removeAll()
                        unsafeSelf.appendFallbackBuffersLocked(batch)
                        return batch
                    }
                    guard let buffered else { return }
                    if buffered.isEmpty { break }
                    for buffer in buffered { convertAndYield(buffer) }
                }
                unsafeSelf.preparationTimeoutTask?.cancel()
                unsafeSelf.preparationTimeoutTask = nil

                let shouldCapture = unsafeSelf.lock.withLock { !unsafeSelf.stopRequested }
                if !shouldCapture {
                    continuation.finish()
                    unsafeSelf.scheduleStopFinalization(after: .seconds(8))
                }
                sttLogger.notice("[STTService] enhanced engine started, flushed buffered audio")

                resultsTask = Task {
                    for try await result in transcriber.results {
                        let outcome: (display: String?, shouldBreak: Bool, shouldComplete: Bool) = unsafeSelf.lock.withLock {
                            guard !unsafeSelf.stopped,
                                  !unsafeSelf.isFallingBack,
                                  unsafeSelf.analyzerRunID == runID else { return (nil, true, false) }
                            let text = String(result.text.characters)
                            let isFinal = result.isFinal
                            unsafeSelf.trimFallbackBuffersLocked(
                                through: CMTimeGetSeconds(CMTimeRangeGetEnd(result.range))
                            )
                            if isFinal {
                                sttLogger.notice("[STTService] final: \(text, privacy: .public)")
                                if unsafeSelf.confirmedText.isEmpty {
                                    unsafeSelf.confirmedText = text
                                } else {
                                    unsafeSelf.confirmedText = Self.joinTranscriptParts(unsafeSelf.confirmedText, text)
                                }
                                unsafeSelf.provisionalText = ""
                            } else {
                                unsafeSelf.provisionalText = text
                            }
                            let shouldComplete = isFinal && unsafeSelf.stopRequested
                            return (unsafeSelf.lockedFullTranscript, shouldComplete, shouldComplete)
                        }
                        if let display = outcome.display {
                            unsafeSelf.emit(.transcript(display))
                        }
                        if outcome.shouldComplete {
                            unsafeSelf.completeStop()
                        }
                        if outcome.shouldBreak {
                            break
                        }
                    }
                }

                try await sa.start(inputSequence: inputStream)
                try await resultsTask?.value
                if unsafeSelf.lock.withLock({ unsafeSelf.analyzerRunID == runID && unsafeSelf.stopRequested }) {
                    unsafeSelf.finishStopOrFallback()
                }
            } catch {
                resultsTask?.cancel()
                sttLogger.notice("[STTService] SpeechAnalyzer error: \(error), falling back to classic")
                if unsafeSelf.lock.withLock({ unsafeSelf.analyzerRunID == runID && !unsafeSelf.stopped }) {
                    unsafeSelf.fallbackToClassicPreservingBufferedAudio(locale: localeID)
                }
            }
        }
        let accepted = lock.withLock {
            guard isPreparing, !isFallingBack, analyzerRunID == runID else { return false }
            analyzerTask = task
            return true
        }
        if !accepted { task.cancel() }
    }

    // MARK: - Stop

    func stopRecording(reply: @escaping (String?) -> Void) {
        var duplicateStopResult: String?
        var wasPreparing = false
        let didRequestStop = lock.withLock {
            guard stopReply == nil else {
                duplicateStopResult = lockedFullTranscript
                return false
            }
            stopRequested = true
            wasPreparing = isPreparing
            stopRequestedWhilePreparing = isPreparing
            stopReply = reply
            return true
        }

        guard didRequestStop else {
            let result = duplicateStopResult ?? ""
            reply(result.isEmpty ? nil : result)
            return
        }

        if cloudCaptureActive {
            stopAudioCapture()
            cloudAudioFile = nil
            cloudCaptureActive = false
            completeStop()
            return
        }

        let shouldReplyImmediately = recognitionTask == nil && _analyzer == nil && !wasPreparing
        if shouldReplyImmediately {
            completeStop()
            return
        }

        stopAudioCapture()

        // Preparation continues against the buffered audio. Its eventual analyzer
        // or classic fallback owns completion and the longer safety timeout.
        if wasPreparing { return }

        if #available(macOS 26, *), let sa = analyzer {
            analyzerContinuation?.finish()
            analyzerContinuation = nil
            Task {
                try? await sa.finish(after: .zero)
            }
        }

        recognitionRequest?.endAudio()
        recognitionTask?.finish()

        scheduleStopFinalization(after: .milliseconds(900))
    }

    // MARK: - Private

    private var audioTapHandler: ((AVAudioPCMBuffer) -> Void)?

    // engine.start()が戻らない機種・状態に備えた番犬付き開始。呼び出し側がcatchしてcleanupする。
    private struct EngineStartTimeout: LocalizedError {
        var errorDescription: String? { "マイクの開始がタイムアウトしました" }
    }

    private func startAudioEngineWithWatchdog(timeout: TimeInterval = 5) throws {
        final class Box: @unchecked Sendable { var error: Error? }
        let box = Box()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            defer { group.leave() }
            guard let self else { return }
            do {
                try self.audioEngine.start()
            } catch {
                box.error = error
            }
        }
        if group.wait(timeout: .now() + timeout) == .timedOut {
            sttLogger.error("[STTService] engine.start timed out")
            throw EngineStartTimeout()
        }
        if let error = box.error { throw error }
    }

    private func installTapIfNeeded(handler: @escaping (AVAudioPCMBuffer) -> Void) {
        audioTapHandler = handler
        // installTap は二重呼び出しで ObjC 例外→クラッシュするため、判定から設置までロック内で行う
        lock.lock()
        defer { lock.unlock() }
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
        stopFinalizationTask?.cancel()
        stopFinalizationTask = nil
        preparationTask?.cancel()
        preparationTask = nil
        preparationTimeoutTask?.cancel()
        preparationTimeoutTask = nil
        if #available(macOS 26, *) {
            analyzerContinuation?.finish()
            analyzerContinuation = nil
            analyzerTask?.cancel()
            analyzerTask = nil
            analyzer = nil
        }
        lock.lock()
        let shouldRemoveTap = tapInstalled
        tapInstalled = false
        pendingBuffers.removeAll()
        clearFallbackBuffersLocked()
        isPreparing = false
        isFallingBack = false
        analyzerRunID = nil
        classicRunID = nil
        enhancedAudioHandler = nil
        cloudAudioFile = nil
        cloudCaptureActive = false
        cloudWriteFailed = false
        stopRequestedWhilePreparing = false
        recognitionRequest = nil
        lock.unlock()

        if shouldRemoveTap {
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        audioTapHandler = nil
        audioEngine.stop()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognizer = nil
    }

    private func stopAudioCapture() {
        let shouldRemoveTap = lock.withLock {
            let installed = tapInstalled
            tapInstalled = false
            return installed
        }
        if shouldRemoveTap {
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        audioTapHandler = nil
        audioEngine.stop()
    }

    private func completeStop() {
        let completion = lock.withLock { () -> (((String?) -> Void), String)? in
            guard let reply = stopReply else { return nil }
            let result = lockedFullTranscript
            stopped = true
            stopRequested = false
            stopRequestedWhilePreparing = false
            stopReply = nil
            confirmedText = ""
            provisionalText = ""
            // 実際に本文を作ったエンジンを確定させる。onEngineイベント由来の
            // 推測に頼ると別セッションの古い値が混入する。
            if classicRunID != nil {
                completedEngine = "apple-speech-classic"
            } else if analyzerRunID != nil {
                completedEngine = "apple-speech-analyzer"
            }
            return (reply, result)
        }

        cleanup()

        guard let (reply, result) = completion else { return }
        reply(result.isEmpty ? nil : result)
    }

    /// Must be called while lock is held.
    private var lockedFullTranscript: String {
        if confirmedText.isEmpty { return provisionalText }
        if provisionalText.isEmpty { return confirmedText }
        return Self.joinTranscriptParts(confirmedText, provisionalText)
    }

    private static func joinTranscriptParts(_ left: String, _ right: String) -> String {
        guard !left.isEmpty else { return right }
        guard !right.isEmpty else { return left }
        guard let last = left.last, let first = right.first else { return left + right }

        if last.isWhitespace || first.isWhitespace || isJapanese(last) || isJapanese(first) {
            return left + right
        }
        return left + " " + right
    }

    private static func isJapanese(_ character: Character) -> Bool {
        character.unicodeScalars.contains { scalar in
            switch scalar.value {
            case 0x3040...0x30FF, 0x3400...0x4DBF, 0x4E00...0x9FFF:
                true
            default:
                false
            }
        }
    }

    private func processAudioLevel(buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameLength = UInt(buffer.frameLength)
        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, frameLength)
        let level = max(0, min(1, rms * 10))
        emit(.audioLevel(level))
    }

    private func configureInputDevice(_ requestedID: UInt32) {
        guard let audioUnit = audioEngine.inputNode.audioUnit else { return }
        var deviceID = AudioDeviceID(requestedID)
        if deviceID == 0 {
            guard let defaultID = defaultInputDeviceID() else { return }
            deviceID = defaultID
        }
        // 既に目的のデバイスなら何もしない。無条件の再設定はHALのIOProcを
        // 作り直させ、直後のengine.startが番犬(5秒)を超えて wedged する。
        // 起動ごとの初回録音が確定失敗する主因だった。
        if let current = currentInputDeviceID(audioUnit), current == deviceID { return }
        var status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &deviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        if status != noErr, requestedID != 0, var defaultID = defaultInputDeviceID() {
            status = AudioUnitSetProperty(
                audioUnit,
                kAudioOutputUnitProperty_CurrentDevice,
                kAudioUnitScope_Global,
                0,
                &defaultID,
                UInt32(MemoryLayout<AudioDeviceID>.size)
            )
            sttLogger.warning("[STTService] selected input device unavailable; fell back to system default")
        }
        if status != noErr {
            sttLogger.error("[STTService] unable to configure an input device")
        }
    }

    private func currentInputDeviceID(_ audioUnit: AudioUnit) -> AudioDeviceID? {
        var deviceID = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioUnitGetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &deviceID,
            &size
        ) == noErr else { return nil }
        return deviceID
    }

    private func defaultInputDeviceID() -> AudioDeviceID? {
        var deviceID = AudioDeviceID(0)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID
        ) == noErr else { return nil }
        return deviceID
    }

    private func fallbackToClassicPreservingBufferedAudio(
        locale localeID: String,
        onlyWhilePreparing: Bool = false
    ) {
        let shouldCapture = lock.withLock { () -> Bool? in
            guard !stopped,
                  !isFallingBack,
                  !onlyWhilePreparing || isPreparing else { return nil }
            isFallingBack = true
            analyzerRunID = nil
            classicRunID = nil
            enhancedAudioHandler = nil
            return !stopRequested
        }
        guard let shouldCapture else { return }

        if shouldCapture {
            installTapIfNeeded { [weak self] buffer in
                guard let self, let copied = self.copyAudioBuffer(buffer) else { return }
                self.lock.withLock { self.pendingBuffers.append(copied) }
            }
        }

        preparationTask?.cancel()
        preparationTask = nil
        preparationTimeoutTask?.cancel()
        preparationTimeoutTask = nil
        if #available(macOS 26, *) {
            analyzerContinuation?.finish()
            analyzerContinuation = nil
            analyzerTask?.cancel()
            analyzerTask = nil
            analyzer = nil
        }
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        recognizer = nil

        let (replayBuffers, transcript) = lock.withLock {
            let buffers = fallbackBuffers
            let text = lockedFullTranscript
            clearFallbackBuffersLocked()
            confirmedText = text
            provisionalText = ""
            isPreparing = false
            return (buffers, text)
        }

        startWithClassic(
            locale: localeID,
            initialBuffers: replayBuffers,
            initialTranscript: transcript
        )
    }

    private func resetSession() {
        stopFinalizationTask?.cancel()
        stopFinalizationTask = nil
        lock.withLock {
            confirmedText = ""
            provisionalText = ""
            stopped = false
            stopRequested = false
            stopRequestedWhilePreparing = false
            stopReply = nil
            pendingBuffers.removeAll()
            clearFallbackBuffersLocked()
            isPreparing = false
            isFallingBack = false
            analyzerRunID = nil
            classicRunID = nil
            enhancedAudioHandler = nil
            cloudWriteFailed = false
            completedEngine = ""
        }
    }

    /// 直近に確定した本文のエンジンを返す。startごとにリセットされる。
    func completedEngineName() -> String {
        lock.withLock { completedEngine }
    }

    private func scheduleStopFinalization(after duration: Duration) {
        stopFinalizationTask?.cancel()
        nonisolated(unsafe) let unsafeSelf = self
        stopFinalizationTask = Task {
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled else { return }
            unsafeSelf.finishStopOrFallback()
        }
    }

    private func finishStopOrFallback() {
        let shouldFallback = lock.withLock {
            stopRequested && !isFallingBack && (!fallbackBuffers.isEmpty || !pendingBuffers.isEmpty)
        }
        if shouldFallback {
            fallbackToClassicPreservingBufferedAudio(locale: currentLocaleID)
        } else {
            completeStop()
        }
    }

    private func retainFallbackBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let copied = copyAudioBuffer(buffer) else { return }
        lock.withLock {
            appendFallbackBuffersLocked([copied])
        }
    }

    private func routeEnhancedAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        let handler: ((AVAudioPCMBuffer) -> Void)? = lock.withLock {
            if let handler = enhancedAudioHandler { return handler }
            if let copied = copyAudioBuffer(buffer) {
                pendingBuffers.append(copied)
            }
            return nil
        }
        guard let handler else { return }
        retainFallbackBuffer(buffer)
        handler(buffer)
    }

    /// Must be called while lock is held.
    private func appendFallbackBuffersLocked(_ buffers: [AVAudioPCMBuffer]) {
        fallbackBuffers.append(contentsOf: buffers)
        fallbackBufferDuration += buffers.reduce(0) { $0 + Self.duration(of: $1) }
        while fallbackBufferDuration > maxFallbackBufferDuration,
              let first = fallbackBuffers.first {
            let duration = Self.duration(of: first)
            fallbackBufferDuration -= duration
            fallbackBufferStartTime += duration
            fallbackBuffers.removeFirst()
        }
    }

    /// Must be called while lock is held.
    private func trimFallbackBuffersLocked(through time: TimeInterval) {
        guard time.isFinite, time >= 0 else { return }
        while let first = fallbackBuffers.first {
            let duration = Self.duration(of: first)
            guard fallbackBufferStartTime + duration <= time else { break }
            fallbackBufferStartTime += duration
            fallbackBufferDuration -= duration
            fallbackBuffers.removeFirst()
        }
    }

    /// Must be called while lock is held.
    private func clearFallbackBuffersLocked() {
        fallbackBuffers.removeAll()
        fallbackBufferDuration = 0
        fallbackBufferStartTime = 0
    }

    private static func duration(of buffer: AVAudioPCMBuffer) -> TimeInterval {
        guard buffer.format.sampleRate > 0 else { return 0 }
        return Double(buffer.frameLength) / buffer.format.sampleRate
    }

    private func copyAudioBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let copied = AVAudioPCMBuffer(
            pcmFormat: buffer.format,
            frameCapacity: buffer.frameLength
        ) else {
            return nil
        }
        copied.frameLength = buffer.frameLength

        let sourceBuffers = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
        let copiedBuffers = UnsafeMutableAudioBufferListPointer(copied.mutableAudioBufferList)
        for index in 0..<min(sourceBuffers.count, copiedBuffers.count) {
            guard let source = sourceBuffers[index].mData,
                  let destination = copiedBuffers[index].mData else {
                continue
            }
            let byteCount = Int(sourceBuffers[index].mDataByteSize)
            memcpy(destination, source, byteCount)
            copiedBuffers[index].mDataByteSize = sourceBuffers[index].mDataByteSize
        }

        return copied
    }
}
