import SwiftUI

struct HistoryView: View {
    @State private var entries: [HistoryEntry] = []
    @State private var selectedEntry: HistoryEntry?
    private let injector = ClipboardInjector()

    private var coordinator: RecordingCoordinator? {
        (NSApp.delegate as? AppDelegate)?.recordingCoordinator
    }

    var body: some View {
        VStack(spacing: 0) {
            if let coordinator {
                RecordingControl(coordinator: coordinator, onComplete: reload)
                    .padding(.horizontal, DS.Spacing.lg)
                    .padding(.vertical, DS.Spacing.md)

                Divider()
            }

            if entries.isEmpty {
                ContentUnavailableView(
                    "history.empty",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("history.empty_desc")
                )
                .frame(maxHeight: .infinity)
            } else {
                List(entries, id: \.id, selection: $selectedEntry) { entry in
                    HistoryRow(entry: entry)
                        .contextMenu {
                            Button("history.copy") { injector.inject(entry.refinedText) }
                            Button("history.copy_raw") { injector.inject(entry.rawTranscript) }
                            Divider()
                            Button("history.delete", role: .destructive) { delete(entry) }
                        }
                }
                .listStyle(.inset)
            }
        }
        .navigationTitle(String(localized: "sidebar.history"))
        .toolbar {
            if !entries.isEmpty {
                ToolbarItem {
                    Button("history.clear_all", role: .destructive) {
                        HistoryStore.shared.clearAll()
                        reload()
                    }
                }
            }
        }
        .onAppear { reload() }
    }

    private func reload() {
        entries = HistoryStore.shared.fetchAll()
    }

    private func delete(_ entry: HistoryEntry) {
        HistoryStore.shared.delete(entry)
        reload()
    }
}

// MARK: - Recording Control

struct RecordingControl: View {
    let coordinator: RecordingCoordinator
    var onComplete: () -> Void = {}

    @State private var prevRecording = false

    var body: some View {
        HStack(spacing: DS.Spacing.md) {
            Button(action: { coordinator.toggle() }) {
                ZStack {
                    Circle()
                        .fill(coordinator.isRecording ? DS.Colors.recording : DS.Colors.accent)
                        .frame(width: 48, height: 48)
                        .shadow(color: (coordinator.isRecording ? DS.Colors.recording : DS.Colors.accent).opacity(0.4), radius: 8)

                    Image(systemName: coordinator.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                        .contentTransition(.symbolEffect(.replace))
                }
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                if coordinator.isRecording {
                    Text("history.recording")
                        .font(DS.Font.bodyMedium)
                        .foregroundStyle(DS.Colors.recording)

                    if !coordinator.currentTranscript.isEmpty {
                        Text(coordinator.currentTranscript)
                            .font(DS.Font.caption)
                            .foregroundStyle(DS.Colors.secondary)
                            .lineLimit(2)
                            .truncationMode(.tail)
                    }
                } else {
                    Text("history.tap_to_start")
                        .font(DS.Font.bodyMedium)
                        .foregroundStyle(DS.Colors.secondary)
                }
            }

            Spacer()
        }
        .animation(DS.Animation.content, value: coordinator.isRecording)
        .onChange(of: coordinator.isRecording) { old, new in
            if old && !new {
                Task {
                    try? await Task.sleep(for: .milliseconds(300))
                    onComplete()
                }
            }
        }
    }
}

// MARK: - History Row

struct HistoryRow: View {
    let entry: HistoryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Spacing.xs) {
            HStack {
                Text(entry.appName)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.accent)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(DS.Colors.accent.opacity(0.1))
                    .clipShape(Capsule())

                Text(entry.category)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)

                Spacer()

                Text(relativeTime(entry.timestamp))
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
            }

            Text(entry.refinedText)
                .font(DS.Font.body)
                .lineLimit(3)

            if entry.rawTranscript != entry.refinedText {
                Text(entry.rawTranscript)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, DS.Spacing.xs)
    }

    private func relativeTime(_ date: Date) -> String {
        let seconds = Int(-date.timeIntervalSinceNow)
        if seconds < 60 { return String(localized: "history.just_now") }
        let minutes = seconds / 60
        if minutes < 60 { return String(localized: "history.minutes_ago \(minutes)") }
        let hours = minutes / 60
        if hours < 24 { return String(localized: "history.hours_ago \(hours)") }
        let days = hours / 24
        return String(localized: "history.days_ago \(days)")
    }
}
