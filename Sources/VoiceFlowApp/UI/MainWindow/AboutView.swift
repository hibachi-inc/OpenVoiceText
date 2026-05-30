import SwiftUI

struct AboutView: View {
    private let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
    private let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"

    var body: some View {
        Form {
            Section {
                HStack(spacing: DS.Spacing.lg) {
                    Image(systemName: "mic.badge.xmark")
                        .font(.system(size: 40))
                        .foregroundStyle(DS.Colors.accent)

                    VStack(alignment: .leading, spacing: DS.Spacing.xs) {
                        Text("OpenVoiceText")
                            .font(DS.Font.title)
                        Text("about.version \(version) \(build)")
                            .font(DS.Font.caption)
                            .foregroundStyle(DS.Colors.secondary)
                        Text("about.tagline")
                            .font(DS.Font.body)
                            .foregroundStyle(DS.Colors.secondary)
                    }
                }
                .padding(.vertical, DS.Spacing.sm)
            }

            Section("about.links") {
                Link(destination: URL(string: "https://github.com/hibachi-inc/OpenVoiceText")!) {
                    Label("about.github", systemImage: "link")
                }

                Link(destination: URL(string: "https://github.com/hibachi-inc/OpenVoiceText/issues")!) {
                    Label("about.bug_report", systemImage: "ladybug")
                }

                Link(destination: URL(string: "https://rekinote.app/")!) {
                    Label("about.reki", systemImage: "doc.richtext")
                }
            }

            Section("about.license") {
                Text("about.license_text")
                    .font(DS.Font.body)
                Text("about.privacy")
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }
        }
        .formStyle(.grouped)
        .navigationTitle(String(localized: "sidebar.about"))
    }
}
