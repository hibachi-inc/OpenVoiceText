import Foundation

#if canImport(FoundationModels)
import FoundationModels

@available(macOS 26, *)
enum FoundationModelsRefiner {
    static func refine(text: String, category: String) async -> String {
        let model = SystemLanguageModel(
            guardrails: .permissiveContentTransformations
        )
        guard model.availability == .available else { return text }

        let instructions = systemPrompt(for: category)
        let session = LanguageModelSession(model: model, instructions: instructions)

        do {
            let response = try await session.respond(to: text)
            let refined = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
            return refined.isEmpty ? text : refined
        } catch {
            return text
        }
    }

    private static func systemPrompt(for category: String) -> String {
        let base = """
        You are a voice-input text refinement assistant.
        The user dictated text via speech recognition. Refine it into clean, natural text.

        Rules:
        - Remove filler words (um, uh, like, えーと, あの, まあ)
        - Add appropriate punctuation
        - Fix likely misrecognitions from context
        - Do NOT change the meaning
        - Return ONLY the refined text — no explanations, no preamble
        - Preserve the original language (do not translate)
        """

        let categoryHint: String
        switch category {
        case "chat":
            categoryHint = "Target: chat app. Keep it concise and conversational."
        case "email":
            categoryHint = "Target: email. Use polished, complete sentences with appropriate greetings."
        case "code":
            categoryHint = "Target: code editor. Preserve technical terms, identifiers, symbols, and casing exactly."
        case "terminal":
            categoryHint = "Target: terminal. Preserve commands, flags, and paths exactly."
        case "notes":
            categoryHint = "Target: note-taking app. Structure with bullet points. Highlight action items."
        case "browser":
            categoryHint = "Target: browser. Concise text suitable for forms and comments."
        default:
            categoryHint = "Target: general purpose. Produce natural, well-formatted text."
        }

        return "\(base)\n\nContext: \(categoryHint)"
    }
}
#endif
