import Foundation

@MainActor
protocol STTClientProtocol_App {
    var onTranscript: ((String) -> Void)? { get set }
    var onAudioLevel: ((Float) -> Void)? { get set }
    var onError: ((String) -> Void)? { get set }
    var onConnectionInvalidated: (() -> Void)? { get set }

    func startRecording(locale: String)
    func stopRecording() async -> String?
    func disconnect()
}

@MainActor
protocol RefinerClientProtocol {
    var onError: ((String) -> Void)? { get set }

    func refine(text: String, category: String) async -> (String, Bool)
    func disconnect()
}

@MainActor
protocol HUDProtocol {
    func showListening()
    func showProcessing(transcript: String)
    func showCopied()
    func showInserted()
    func showError(_ message: String)
    func updateTranscript(_ text: String)
    func updateAudioLevel(_ level: Float)
    func hide()
}
