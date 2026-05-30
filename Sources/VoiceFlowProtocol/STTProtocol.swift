import Foundation

@objc public protocol STTServiceProtocol {
    func startRecording(locale: String, engine: String)
    func stopRecording(reply: @escaping (String?) -> Void)
}

@objc public protocol STTClientProtocol {
    func didUpdateTranscript(_ text: String)
    func didUpdateAudioLevel(_ level: Float)
    func didEncounterError(_ description: String)
}

public enum STTXPCConstants {
    public static let serviceName = "com.hibachi.voiceflow.stt"
}
