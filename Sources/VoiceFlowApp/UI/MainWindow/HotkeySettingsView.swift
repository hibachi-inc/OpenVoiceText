import SwiftUI

struct HotkeySettingsView: View {
    @State private var prefs = PreferencesStore.shared

    var body: some View {
        Form {
            Section("Recording") {
                ShortcutRecorder(
                    label: "Start / Stop Recording",
                    modifier: $prefs.hotkeyModifier,
                    key: $prefs.hotkeyKey,
                    onChange: reinstallHotkey
                )

                Text("Press this shortcut anywhere to start/stop voice input.")
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }

            Section("Translation") {
                ShortcutRecorder(
                    label: "Start / Stop Translation",
                    modifier: $prefs.translateHotkeyModifier,
                    key: $prefs.translateHotkeyKey,
                    onChange: reinstallHotkey
                )

                Text("Same as recording, but translates to your target language.")
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Hotkey")
    }

    private func reinstallHotkey() {
        guard let delegate = NSApp.delegate as? AppDelegate else { return }
        delegate.installHotkey()
    }
}
