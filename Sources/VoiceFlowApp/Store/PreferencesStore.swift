import Foundation
import SwiftUI

@MainActor
@Observable
final class PreferencesStore {
    static let shared = PreferencesStore()

    var hotkeyModifier: HotkeyModifier {
        didSet { defaults.set(hotkeyModifier.rawValue, forKey: "hotkeyModifier") }
    }
    var hotkeyKey: HotkeyKey {
        didSet { defaults.set(hotkeyKey.rawValue, forKey: "hotkeyKey") }
    }
    var locale: String {
        didSet { defaults.set(locale, forKey: "locale") }
    }
    var refinementMode: RefinementMode {
        didSet { defaults.set(refinementMode.rawValue, forKey: "refinementMode") }
    }
    var launchAtLogin: Bool {
        didSet { defaults.set(launchAtLogin, forKey: "launchAtLogin") }
    }

    private let defaults = UserDefaults.standard

    private init() {
        hotkeyModifier = HotkeyModifier(rawValue: defaults.string(forKey: "hotkeyModifier") ?? "") ?? .option
        hotkeyKey = HotkeyKey(rawValue: defaults.string(forKey: "hotkeyKey") ?? "") ?? .space
        locale = defaults.string(forKey: "locale") ?? Locale.current.identifier
        refinementMode = RefinementMode(rawValue: defaults.string(forKey: "refinementMode") ?? "") ?? .refine
        launchAtLogin = defaults.bool(forKey: "launchAtLogin")
    }
}

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

    var id: String { rawValue }

    var label: String {
        switch self {
        case .space: "Space"
        case .d: "D"
        case .r: "R"
        }
    }

    var keyCode: UInt16 {
        switch self {
        case .space: 49   // kVK_Space
        case .d: 2        // kVK_ANSI_D
        case .r: 15       // kVK_ANSI_R
        }
    }
}

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
