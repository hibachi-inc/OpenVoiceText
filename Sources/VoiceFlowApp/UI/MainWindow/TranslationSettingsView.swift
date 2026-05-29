import SwiftUI

struct TranslationSettingsView: View {
    @State private var prefs = PreferencesStore.shared

    var body: some View {
        Form {
            Section("Translation Hotkey") {
                Picker("Modifier", selection: $prefs.translateHotkeyModifier) {
                    ForEach(HotkeyModifier.allCases) { mod in
                        Text(mod.label).tag(mod)
                    }
                }
                .onChange(of: prefs.translateHotkeyModifier) { reinstallHotkey() }

                Picker("Key", selection: $prefs.translateHotkeyKey) {
                    ForEach(HotkeyKey.allCases) { key in
                        Text(key.label).tag(key)
                    }
                }
                .onChange(of: prefs.translateHotkeyKey) { reinstallHotkey() }

                HStack(spacing: DS.Spacing.sm) {
                    Text("Current shortcut:")
                        .foregroundStyle(DS.Colors.secondary)
                    Text("\(prefs.translateHotkeyModifier.symbol)\(prefs.translateHotkeyKey.label)")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.white.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }

            Section("Target Language") {
                Picker("Translate to", selection: $prefs.translateTarget) {
                    ForEach(TranslateTarget.allCases) { target in
                        Text(target.label).tag(target)
                    }
                }

                Text("Speak in any language → get text in \(prefs.translateTarget.label)")
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }

            Section("How it works") {
                Text("Use the translation shortcut instead of the normal recording shortcut. Your speech will be transcribed and then translated to the target language using on-device AI.")
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Translation")
    }

    private func reinstallHotkey() {
        guard let delegate = NSApp.delegate as? AppDelegate else { return }
        delegate.installHotkey()
    }
}
