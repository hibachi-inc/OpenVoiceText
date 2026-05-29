import Foundation
import NaturalLanguage
import VoiceFlowProtocol

/// SimpleRefiner: lightweight text cleanup without AI.
/// Removes filler words and normalizes whitespace.
/// The Pro version replaces this with FoundationModels-powered refinement.
final class RefinerService: NSObject, RefinerServiceProtocol, @unchecked Sendable {
    func refine(text: String, category: String, reply: @escaping (String?) -> Void) {
        reply(SimpleRefiner.clean(text))
    }

    func translate(text: String, targetLanguage: String, reply: @escaping (String?) -> Void) {
        // Translation requires Pro version
        reply(text)
    }
}

enum SimpleRefiner {
    static func clean(_ text: String) -> String {
        var result = text

        let lang = detectLanguage(text)
        if lang == "ja" {
            for filler in ["えーと", "えっと", "あのー", "あの", "まあ", "えー", "そのー", "その", "なんか"] {
                result = result.replacingOccurrences(of: filler, with: "")
            }
        } else {
            let pattern = #"\b(um|uh|like|you know|I mean|so|well|basically|actually|literally)\b"#
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                result = regex.stringByReplacingMatches(
                    in: result, range: NSRange(result.startIndex..., in: result), withTemplate: ""
                )
            }
        }

        // Normalize whitespace
        result = result.replacingOccurrences(of: "  +", with: " ", options: .regularExpression)
        result = result.trimmingCharacters(in: .whitespacesAndNewlines)

        return result.isEmpty ? text : result
    }

    private static func detectLanguage(_ text: String) -> String {
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        return recognizer.dominantLanguage?.rawValue ?? "en"
    }
}
