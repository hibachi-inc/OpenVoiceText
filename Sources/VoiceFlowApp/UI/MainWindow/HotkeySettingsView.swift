import SwiftUI

struct HotkeySettingsView: View {
    @State private var prefs = PreferencesStore.shared

    var body: some View {
        Form {
            Section("Recording Hotkey") {
                Picker("Modifier", selection: $prefs.hotkeyModifier) {
                    ForEach(HotkeyModifier.allCases) { mod in
                        Text(mod.label).tag(mod)
                    }
                }
                .onChange(of: prefs.hotkeyModifier) { reinstallHotkey() }

                Picker("Key", selection: $prefs.hotkeyKey) {
                    ForEach(HotkeyKey.allCases) { key in
                        Text(key.label).tag(key)
                    }
                }
                .onChange(of: prefs.hotkeyKey) { reinstallHotkey() }

                HStack(spacing: DS.Spacing.sm) {
                    Text("Current shortcut:")
                        .foregroundStyle(DS.Colors.secondary)
                    Text("\(prefs.hotkeyModifier.symbol)\(prefs.hotkeyKey.label)")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.white.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                Text("Press this shortcut anywhere to start/stop recording.")
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }

            Section("Permissions") {
                HStack {
                    VStack(alignment: .leading) {
                        Text("Input Monitoring")
                            .font(DS.Font.bodyMedium)
                        Text("Required for global hotkey to work")
                            .font(DS.Font.caption)
                            .foregroundStyle(DS.Colors.secondary)
                    }
                    Spacer()
                    Button("Open Settings") {
                        NSWorkspace.shared.open(
                            URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")!
                        )
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Hotkey")
    }

    private func reinstallHotkey() {
        guard let delegate = NSApp.delegate as? AppDelegate else { return }
        delegate.installHotkeyMonitor()
    }
}
