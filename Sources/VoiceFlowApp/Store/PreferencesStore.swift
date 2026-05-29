import Foundation
import SwiftUI

@MainActor
@Observable
final class PreferencesStore {
    static let shared = PreferencesStore()

    // Recording hotkey
    var hotkeyModifier: HotkeyModifier {
        didSet { defaults.set(hotkeyModifier.rawValue, forKey: "hotkeyModifier") }
    }
    var hotkeyKey: HotkeyKey {
        didSet { defaults.set(hotkeyKey.rawValue, forKey: "hotkeyKey") }
    }

    // Translation hotkey
    var translateHotkeyModifier: HotkeyModifier {
        didSet { defaults.set(translateHotkeyModifier.rawValue, forKey: "translateHotkeyModifier") }
    }
    var translateHotkeyKey: HotkeyKey {
        didSet { defaults.set(translateHotkeyKey.rawValue, forKey: "translateHotkeyKey") }
    }

    var locale: String {
        didSet { defaults.set(locale, forKey: "locale") }
    }
    var refinementMode: RefinementMode {
        didSet { defaults.set(refinementMode.rawValue, forKey: "refinementMode") }
    }
    var translateTarget: TranslateTarget {
        didSet { defaults.set(translateTarget.rawValue, forKey: "translateTarget") }
    }
    var launchAtLogin: Bool {
        didSet { defaults.set(launchAtLogin, forKey: "launchAtLogin") }
    }

    private let defaults = UserDefaults.standard

    private init() {
        hotkeyModifier = HotkeyModifier(rawValue: defaults.string(forKey: "hotkeyModifier") ?? "") ?? .option
        hotkeyKey = HotkeyKey(rawValue: defaults.string(forKey: "hotkeyKey") ?? "") ?? .space
        translateHotkeyModifier = HotkeyModifier(rawValue: defaults.string(forKey: "translateHotkeyModifier") ?? "") ?? .control
        translateHotkeyKey = HotkeyKey(rawValue: defaults.string(forKey: "translateHotkeyKey") ?? "") ?? .space
        locale = defaults.string(forKey: "locale") ?? "system"
        refinementMode = RefinementMode(rawValue: defaults.string(forKey: "refinementMode") ?? "") ?? .refine
        translateTarget = TranslateTarget(rawValue: defaults.string(forKey: "translateTarget") ?? "") ?? .english
        launchAtLogin = defaults.bool(forKey: "launchAtLogin")
    }
}

// MARK: - Hotkey enums

enum HotkeyModifier: String, CaseIterable, Identifiable {
    case option = "option"
    case control = "control"
    case command = "command"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .option: "⌥ Option"
        case .control: "⌃ Control"
        case .command: "⌘ Command"
        }
    }
    var symbol: String {
        switch self {
        case .option: "⌥"
        case .control: "⌃"
        case .command: "⌘"
        }
    }
    var eventModifier: NSEvent.ModifierFlags {
        switch self {
        case .option: .option
        case .control: .control
        case .command: .command
        }
    }
}

enum HotkeyKey: String, CaseIterable, Identifiable {
    case space = "space"
    case d = "d"
    case r = "r"
    case t = "t"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .space: "Space"
        case .d: "D"
        case .r: "R"
        case .t: "T"
        }
    }
    var keyCode: UInt16 {
        switch self {
        case .space: 49
        case .d: 2
        case .r: 15
        case .t: 17
        }
    }
}

// MARK: - Mode enums

enum RefinementMode: String, CaseIterable, Identifiable {
    case off = "off"
    case refine = "refine"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .off: "Off (raw transcript)"
        case .refine: "AI Refinement"
        }
    }
    var description: String {
        switch self {
        case .off: "Insert speech-to-text output as-is"
        case .refine: "Clean up with Apple Intelligence based on active app"
        }
    }
}

enum TranslateTarget: String, CaseIterable, Identifiable {
    case english = "en"
    case japanese = "ja"
    case chinese = "zh-Hans"
    case korean = "ko"
    case german = "de"
    case french = "fr"
    case spanish = "es"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .english: "English"
        case .japanese: "Japanese"
        case .chinese: "Chinese"
        case .korean: "Korean"
        case .german: "German"
        case .french: "French"
        case .spanish: "Spanish"
        }
    }
}
