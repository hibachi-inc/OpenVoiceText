import SwiftUI

struct TranslationSettingsView: View {
    @State private var prefs = PreferencesStore.shared

    var body: some View {
        Form {
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
                VStack(alignment: .leading, spacing: DS.Spacing.sm) {
                    Text("Use the translation shortcut (set in Hotkey tab) instead of the normal recording shortcut.")
                        .font(DS.Font.body)
                    Text("Your speech will be transcribed and translated to the target language using on-device AI. No data leaves your Mac.")
                        .font(DS.Font.caption)
                        .foregroundStyle(DS.Colors.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Translation")
    }
}
