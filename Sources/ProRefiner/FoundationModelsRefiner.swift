import Foundation
import NaturalLanguage
import os
import VoiceFlowProtocol

#if canImport(FoundationModels)
import FoundationModels

private let logger = Logger(subsystem: "com.hibachi.voicelatte.refiner", category: "FoundationModels")

@available(macOS 26, *)
enum FoundationModelsRefiner {
    static func refine(text: String, context: [String: String]) async -> String {
        let model = SystemLanguageModel(
            guardrails: .permissiveContentTransformations
        )
        guard model.availability == .available else {
            logger.warning("FoundationModels not available")
            return text
        }

        let category = context[RefinerContextKey.category] ?? "generic"
        let customPrompt = context[RefinerContextKey.customPrompt]
        let lang = detectLanguage(text)
        let taskPrompt = refinePrompt(for: text, category: category, language: lang, customPrompt: customPrompt)
        let session = LanguageModelSession(model: model)

        do {
            let response = try await session.respond(to: taskPrompt)
            let refined = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
            logger.info("Refined: \(refined.prefix(50))...")
            return refined.isEmpty ? text : refined
        } catch {
            logger.error("Refine error: \(error.localizedDescription)")
            return text
        }
    }

    static func translate(text: String, targetLanguage: String) async -> String {
        let model = SystemLanguageModel(
            guardrails: .permissiveContentTransformations
        )
        guard model.availability == .available else { return text }

        let taskPrompt = translateTaskPrompt(for: text, targetLanguage: targetLanguage)
        let session = LanguageModelSession(model: model)

        do {
            let response = try await session.respond(to: taskPrompt)
            let translated = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
            return translated.isEmpty ? text : translated
        } catch {
            logger.error("Translate error: \(error.localizedDescription)")
            return text
        }
    }

    // MARK: - Prompts

    private static func refinePrompt(for text: String, category: String, language: String, customPrompt: String?) -> String {
        let rules: String
        if language == "ja" {
            rules = jaRules(for: category)
        } else {
            rules = enRules(for: category)
        }
        var prompt = rules
        if let customPrompt, !customPrompt.isEmpty {
            prompt += "\n[USER INSTRUCTION] \(customPrompt)"
        }
        return "\(prompt)\n\n[INPUT] \"\(text)\""
    }

    private static func jaRules(for category: String) -> String {
        let hint: String
        switch category {
        case "chat": hint = "チャット向け: 簡潔で会話的な文体。"
        case "email": hint = "メール向け: 丁寧で完全な文章。"
        case "code": hint = "コードエディタ向け: 技術用語・識別子をそのまま保持。"
        case "terminal": hint = "ターミナル向け: コマンド・フラグ・パスをそのまま保持。"
        case "notes": hint = "ノート向け: 箇条書きで構造化。"
        case "browser": hint = "ブラウザ向け: 簡潔な文体。"
        default: hint = "自然な日本語に整形。"
        }
        return """
        [TASK] 以下の音声入力テキストを整形してください。\(hint)
        フィラー（えーと、あの、まあ）を削除し、句読点を追加し、誤認識を文脈から修正してください。
        意味を変えないでください。整形後のテキストのみを返してください。説明や挨拶や前置きは絶対に不要です。
        """
    }

    private static func enRules(for category: String) -> String {
        let hint: String
        switch category {
        case "chat": hint = "For a chat app. Keep concise and conversational."
        case "email": hint = "For email. Use polished, complete sentences."
        case "code": hint = "For a code editor. Preserve identifiers and symbols exactly."
        case "terminal": hint = "For terminal. Preserve commands and flags exactly."
        case "notes": hint = "For notes. Structure with bullet points."
        case "browser": hint = "For browser. Concise for forms and comments."
        default: hint = "Produce natural, well-formatted text."
        }
        return """
        [TASK] Refine the following voice-input text. \(hint)
        Remove filler words, add punctuation, fix misrecognitions from context.
        Do NOT change the meaning. Return ONLY the refined text. No explanations, no greetings, no preamble.
        """
    }

    private static func translateTaskPrompt(for text: String, targetLanguage: String) -> String {
        let langName = languageName(targetLanguage)
        return """
        [TASK] Translate the following text into \(langName).
        Remove filler words before translating. Produce natural, fluent \(langName).
        Return ONLY the translated text. No explanations.

        [INPUT] "\(text)"
        """
    }

    private static func detectLanguage(_ text: String) -> String {
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        return recognizer.dominantLanguage?.rawValue ?? "en"
    }

    private static func languageName(_ code: String) -> String {
        switch code {
        case "en": "English"
        case "ja": "Japanese"
        case "zh-Hans": "Simplified Chinese"
        case "ko": "Korean"
        case "de": "German"
        case "fr": "French"
        case "es": "Spanish"
        case "pt": "Portuguese"
        case "it": "Italian"
        case "ru": "Russian"
        default: code
        }
    }
}
#endif
