import Foundation

@MainActor
final class RecordingCoordinator {
    let session: RecordingStateMachine
    private var sttClient: STTClientProtocol_App
    private var refinerClient: RefinerClientProtocol
    private var hud: HUDProtocol
    private let injector: TextInjecting
    private let prefs: PreferencesStore
    private let history: HistoryStore

    var onStateChanged: (() -> Void)?
    private var stopTask: Task<Void, Never>?

    var isRecording: Bool { session.state.isActive }

    init(
        session: RecordingStateMachine = RecordingStateMachine(),
        sttClient: STTClientProtocol_App = STTXPCClient(),
        refinerClient: RefinerClientProtocol = RefinerXPCClient(),
        hud: HUDProtocol = FloatingHUD(),
        injector: TextInjecting? = nil,
        prefs: PreferencesStore = .shared,
        history: HistoryStore = .shared
    ) {
        self.session = session
        self.sttClient = sttClient
        self.refinerClient = refinerClient
        self.hud = hud
        self.prefs = prefs
        self.history = history
        #if DIRECT
        self.injector = injector ?? AccessibilityInjector()
        #else
        self.injector = injector ?? ClipboardInjector()
        #endif
    }

    func setup() {
        hud.onTap = { [weak self] in self?.toggle() }
        sttClient.onTranscript = { [weak self] text in
            guard let self, case .recording = self.session.state else { return }
            self.hud.updateTranscript(text)
        }
        sttClient.onAudioLevel = { [weak self] level in
            guard let self, case .recording = self.session.state else { return }
            self.hud.updateAudioLevel(level)
        }
        sttClient.onError = { [weak self] message in
            self?.handleError(message)
        }
        sttClient.onConnectionInvalidated = { [weak self] in
            guard let self, self.session.state.isActive else { return }
            self.handleError("Speech service connection lost.")
        }
        refinerClient.onError = { [weak self] message in
            self?.handleError(message)
        }
    }

    func toggle() {
        switch session.state {
        case .idle:
            startRecording()
        case .recording:
            stopRecording()
        case .starting, .processing:
            cancelRecording()
        default:
            break
        }
    }

    func disconnect() {
        sttClient.disconnect()
        refinerClient.disconnect()
    }

    func showPermissionError(_ message: String) {
        hud.showError(message)
    }

    // MARK: - Private

    private func startRecording() {
        if let cancelTask {
            Task {
                await cancelTask.value
                self.startRecording()
            }
            return
        }
        session.transition(.startRequested)
        hud.showListening()
        onStateChanged?()

        let rawLocale = prefs.locale == "system" ? Locale.current.identifier : prefs.locale
        let localeID = Locale(identifier: rawLocale).identifier
        sttClient.startRecording(locale: localeID)
        session.transition(.micReady)
    }

    private func stopRecording() {
        session.transition(.stopRequested)
        onStateChanged?()

        stopTask = Task {
            let rawTranscript = await sttClient.stopRecording() ?? ""

            guard !Task.isCancelled else { return }

            if rawTranscript.isEmpty {
                session.transition(.refinementDone)
                hud.hide()
                onStateChanged?()
                return
            }

            let context = AppContext.current
            let refined: String
            var timedOut = false

            if prefs.refinementMode == .refine {
                hud.showProcessing(transcript: rawTranscript)
                let result = await refinerClient.refine(
                    text: rawTranscript,
                    category: context?.category.rawValue ?? "generic"
                )
                refined = result.0
                timedOut = result.1
            } else {
                refined = rawTranscript
            }

            guard !Task.isCancelled else { return }

            injector.inject(refined)
            session.transition(.refinementDone)

            history.add(
                rawTranscript: rawTranscript,
                refinedText: refined,
                appName: context?.appName ?? "Unknown",
                category: context?.category.rawValue ?? "generic"
            )

            if timedOut {
                hud.showError("Refinement skipped (timeout)")
            } else {
                #if DIRECT
                hud.showInserted(text: refined)
                #else
                hud.showCopied(text: refined)
                #endif
            }
            onStateChanged?()
        }
    }

    private var cancelTask: Task<Void, Never>?

    private func cancelRecording() {
        session.transition(.cancel)
        stopTask?.cancel()
        stopTask = nil
        cancelTask = Task {
            let _ = await sttClient.stopRecording()
            cancelTask = nil
        }
        hud.hide()
        onStateChanged?()
    }

    private func handleError(_ message: String) {
        guard session.state.isActive else { return }
        stopTask?.cancel()
        stopTask = nil
        session.transition(.failed(message))
        hud.showError(message)
        onStateChanged?()

        Task {
            try? await Task.sleep(for: .seconds(3))
            guard case .error = session.state else { return }
            session.transition(.reset)
            onStateChanged?()
        }
    }
}
