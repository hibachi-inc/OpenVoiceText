import Foundation

@MainActor
final class RecordingCoordinator {
    let session: RecordingStateMachine
    private var sttClient: STTClientProtocol_App
    private var refinerClient: RefinerClientProtocol
    private let hud: HUDProtocol
    private let injector: TextInjecting

    var onStateChanged: (() -> Void)?
    private var stopTask: Task<Void, Never>?
    var locale: Locale = .current

    var isRecording: Bool { session.state.isActive }

    init(
        session: RecordingStateMachine = RecordingStateMachine(),
        sttClient: STTClientProtocol_App = STTXPCClient(),
        refinerClient: RefinerClientProtocol = RefinerXPCClient(),
        hud: HUDProtocol = FloatingHUD(),
        injector: TextInjecting? = nil
    ) {
        self.session = session
        self.sttClient = sttClient
        self.refinerClient = refinerClient
        self.hud = hud
        #if DIRECT
        self.injector = injector ?? AccessibilityInjector()
        #else
        self.injector = injector ?? ClipboardInjector()
        #endif
    }

    func setup() {
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
        session.transition(.startRequested)
        hud.showListening()
        onStateChanged?()

        sttClient.startRecording(locale: locale.identifier)
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
            hud.showProcessing(transcript: rawTranscript)

            let (refined, timedOut) = await refinerClient.refine(
                text: rawTranscript,
                category: context?.category.rawValue ?? "generic"
            )

            guard !Task.isCancelled else { return }

            injector.inject(refined)
            session.transition(.refinementDone)

            if timedOut {
                hud.showError("Refinement skipped (timeout)")
            } else {
                #if DIRECT
                hud.showInserted()
                #else
                hud.showCopied()
                #endif
            }
            onStateChanged?()
        }
    }

    private func cancelRecording() {
        session.transition(.cancel)
        stopTask?.cancel()
        stopTask = nil
        Task { let _ = await sttClient.stopRecording() }
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
