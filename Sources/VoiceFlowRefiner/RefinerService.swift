import Foundation
import VoiceFlowProtocol

final class RefinerService: NSObject, RefinerServiceProtocol, @unchecked Sendable {
    func refine(text: String, category: String, reply: @escaping (String?) -> Void) {
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            nonisolated(unsafe) let sendableReply = reply
            Task {
                let refined = await FoundationModelsRefiner.refine(text: text, category: category)
                sendableReply(refined)
            }
            return
        }
        #endif
        reply(text)
    }
}
