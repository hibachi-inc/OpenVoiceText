import SwiftUI

struct GeneralSettingsView: View {
    @State private var prefs = PreferencesStore.shared

    private let locales: [(id: String, labelKey: LocalizedStringResource)] = [
        ("system", "general.locale.system"),
        ("en-US", "general.locale.en_us"),
        ("en-GB", "general.locale.en_gb"),
        ("ja-JP", "general.locale.ja"),
        ("zh-Hans", "general.locale.zh_hans"),
        ("zh-Hant", "general.locale.zh_hant"),
        ("ko-KR", "general.locale.ko"),
        ("de-DE", "general.locale.de"),
        ("fr-FR", "general.locale.fr"),
        ("es-ES", "general.locale.es"),
    ]

    private let appLanguages: [(id: String, labelKey: LocalizedStringResource)] = [
        ("system", "general.app_language.system"),
        ("en", "general.app_language.en"),
        ("ja", "general.app_language.ja"),
    ]

    var body: some View {
        Form {
            Section("general.app_language") {
                Picker("general.app_language", selection: $prefs.appLanguage) {
                    ForEach(appLanguages, id: \.id) { lang in
                        Text(String(localized: lang.labelKey)).tag(lang.id)
                    }
                }
                .pickerStyle(.menu)
                .onChange(of: prefs.appLanguage) {
                    restartApp()
                }
            }

            Section("general.speech_recognition") {
                Picker("general.language", selection: $prefs.locale) {
                    ForEach(locales, id: \.id) { locale in
                        Text(String(localized: locale.labelKey)).tag(locale.id)
                    }
                }
                .pickerStyle(.menu)

                Text("general.on_device")
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }

            Section("general.refinement") {
                Picker("general.mode", selection: $prefs.refinementMode) {
                    ForEach(RefinementMode.allCases) { mode in
                        VStack(alignment: .leading) {
                            Text(mode.label)
                        }
                        .tag(mode)
                    }
                }
                .pickerStyle(.radioGroup)

                Text(prefs.refinementMode.description)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }

            Section("general.startup") {
                Toggle("general.launch_at_login", isOn: $prefs.launchAtLogin)
                    .onChange(of: prefs.launchAtLogin) { syncLaunchAtLogin() }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(String(localized: "sidebar.general"))
    }

    private func syncLaunchAtLogin() {
        guard let delegate = NSApp.delegate as? AppDelegate else { return }
        delegate.syncLaunchAtLogin()
    }

    private func restartApp() {
        let url = Bundle.main.bundleURL
        let task = Process()
        task.launchPath = "/usr/bin/open"
        task.arguments = ["-n", url.path]
        try? task.run()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApplication.shared.terminate(nil)
        }
    }
}
