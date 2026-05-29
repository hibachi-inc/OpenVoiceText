import Foundation
import NaturalLanguage

#if canImport(FoundationModels)
import FoundationModels

@available(macOS 26, *)
enum FoundationModelsRefiner {
    static func refine(text: String, category: String) async -> String {
        let model = SystemLanguageModel(
            guardrails: .permissiveContentTransformations
        )
        guard model.availability == .available else { return text }

        let lang = detectLanguage(text)
        let instructions = systemPrompt(for: category, language: lang)
        let session = LanguageModelSession(model: model, instructions: instructions)

        do {
            let response = try await session.respond(to: text)
            let refined = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
            return refined.isEmpty ? text : refined
        } catch {
            return text
        }
    }

    private static func detectLanguage(_ text: String) -> String {
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        guard let lang = recognizer.dominantLanguage else { return "en" }
        return lang.rawValue
    }

    private static func systemPrompt(for category: String, language: String) -> String {
        if language == "ja" {
            return jaPrompt(for: category)
        } else {
            return enPrompt(for: category)
        }
    }

    private static func jaPrompt(for category: String) -> String {
        let base = """
        あなたは音声入力テキストの整形アシスタントです。
        音声認識で入力されたテキストを、自然で読みやすい日本語に整形してください。

        ルール:
        - フィラー（えーと、あの、まあ、えー）を削除
        - 句読点を適切に追加
        - 誤認識と思われる単語を文脈から修正
        - 意味を変えない
        - 整形後のテキストのみを返す（説明や前置き不要）
        - 日本語のまま出力（英語に翻訳しない）
        """

        let hint: String
        switch category {
        case "chat": hint = "チャット向け: 簡潔で会話的な文体。敬語は不要。"
        case "email": hint = "メール向け: 丁寧で完全な文章。適切な書き出しと結び。"
        case "code": hint = "コードエディタ向け: 技術用語・識別子・記号をそのまま保持。"
        case "terminal": hint = "ターミナル向け: コマンド・フラグ・パスをそのまま保持。"
        case "notes": hint = "ノート向け: 箇条書きで構造化。アクションアイテムを明示。"
        case "browser": hint = "ブラウザ向け: フォーム入力やコメントに適した簡潔な文体。"
        default: hint = "一般的な日本語テキストとして自然に整形。"
        }

        return "\(base)\n\n入力先: \(hint)"
    }

    private static func enPrompt(for category: String) -> String {
        let base = """
        You are a voice-input text refinement assistant.
        The user dictated text via speech recognition. Refine it into clean, natural text.

        Rules:
        - Remove filler words (um, uh, like, you know)
        - Add appropriate punctuation
        - Fix likely misrecognitions from context
        - Do NOT change the meaning
        - Return ONLY the refined text — no explanations, no preamble
        - Keep the same language as the input
        """

        let hint: String
        switch category {
        case "chat": hint = "Target: chat app. Keep it concise and conversational."
        case "email": hint = "Target: email. Use polished, complete sentences with appropriate greetings."
        case "code": hint = "Target: code editor. Preserve technical terms, identifiers, symbols, and casing exactly."
        case "terminal": hint = "Target: terminal. Preserve commands, flags, and paths exactly."
        case "notes": hint = "Target: note-taking app. Structure with bullet points. Highlight action items."
        case "browser": hint = "Target: browser. Concise text suitable for forms and comments."
        default: hint = "Target: general purpose. Produce natural, well-formatted text."
        }

        return "\(base)\n\nContext: \(hint)"
    }
}
#endif
