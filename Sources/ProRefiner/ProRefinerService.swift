import Foundation
import VoiceFlowProtocol

final class ProRefinerService: NSObject, RefinerServiceProtocol, @unchecked Sendable {
    func refine(text: String, context: [String: String], reply: @escaping (String?) -> Void) {
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            nonisolated(unsafe) let sendableReply = reply
            Task {
                let refined = await FoundationModelsRefiner.refine(text: text, context: context)
                sendableReply(refined)
            }
            return
        }
        #endif
        reply(text)
    }

    func translate(text: String, targetLanguage: String, reply: @escaping (String?) -> Void) {
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            nonisolated(unsafe) let sendableReply = reply
            Task {
                let translated = await FoundationModelsRefiner.translate(text: text, targetLanguage: targetLanguage)
                sendableReply(translated)
            }
            return
        }
        #endif
        reply(text)
    }
}
