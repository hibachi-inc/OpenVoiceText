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
        let beforeText = context[RefinerContextKey.beforeText]
        let afterText = context[RefinerContextKey.afterText]
        let lang = detectLanguage(text)
        let taskPrompt = refinePrompt(for: text, category: category, language: lang,
                                      customPrompt: customPrompt, beforeText: beforeText, afterText: afterText)
        let session = LanguageModelSession(model: model)

        do {
            let response = try await session.respond(to: taskPrompt)
            let refined = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
            let sanitized = sanitizeRefineOutput(refined, original: text)
            logger.info("Refined: \(refined.prefix(50))...")
            return sanitized.isEmpty ? text : sanitized
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

    private static func refinePrompt(for text: String, category: String, language: String,
                                      customPrompt: String?, beforeText: String?, afterText: String?) -> String {
        let rules: String
        if language == "ja" {
            rules = jaRules(for: category)
        } else {
            rules = enRules(for: category)
        }
        var prompt = rules
        if let customPrompt, !customPrompt.isEmpty {
            prompt += "\n\n追加指示: \(customPrompt)"
        }
        if beforeText != nil || afterText != nil {
            prompt += "\n\nカーソル前後のテキスト:"
            if let before = beforeText {
                prompt += "\n前: \"\(before)\""
            }
            if let after = afterText {
                prompt += "\n後: \"\(after)\""
            }
        }
        return """
        \(prompt)

        "\(text)"
        """
    }

    private static func jaRules(for category: String) -> String {
        let categoryHint: String
        switch category {
        case "chat", "email", "browser", "notes": categoryHint = ""
        case "code": categoryHint = "コード、コマンド、URL、識別子は変えない。"
        case "terminal": categoryHint = "コマンド、フラグ、パスは変えない。"
        default: categoryHint = ""
        }

        return """
        以下の音声文字起こしを整形して。言い換え、要約、補足、文体変更、語順変更、推測による修正はしないで。フィラーを削除し、句読点を補い、数字・金額・日付・単位を文脈に合う表記へ整えるだけにして。\(categoryHint)
        整形後の本文だけを返して。
        """
    }

    private static func enRules(for category: String) -> String {
        let categoryHint: String
        switch category {
        case "chat", "email", "browser", "notes": categoryHint = ""
        case "code": categoryHint = "Do not alter code, commands, URLs, or identifiers."
        case "terminal": categoryHint = "Do not alter commands, flags, or paths."
        default: categoryHint = ""
        }

        return """
        Format the following voice transcript only. Do not paraphrase, summarize, add details, change tone, reorder wording, or make inferred corrections. Only remove filler words, add punctuation, and format numbers, money, dates, and units appropriately for the context. \(categoryHint)
        Return only the refined text.
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

    private static func sanitizeRefineOutput(_ output: String, original: String) -> String {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return trimmed }

        let lower = trimmed.lowercased()
        let originalLower = original.lowercased()
        let leakedInputTag = lower.contains("<input>") && !originalLower.contains("<input>")
        let looksLikeExplanation = [
            "テキストは以下の通り",
            "以下の通りです",
            "機能です",
            "デフォルト指示",
            "the text is as follows",
            "the transcript is as follows",
        ].contains { lower.contains($0) }

        if leakedInputTag || looksLikeExplanation {
            logger.warning("Model returned prompt/meta text; falling back to raw transcript")
            return original
        }

        return trimmed
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
