import SwiftUI
import AppKit

struct HistoryView: View {
    @State private var entries: [HistoryEntry] = []
    @State private var selectedEntry: HistoryEntry?

    var body: some View {
        Group {
            if entries.isEmpty {
                ContentUnavailableView(
                    "No history yet",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Voice input history will appear here.")
                )
            } else {
                List(entries, id: \.timestamp, selection: $selectedEntry) { entry in
                    HistoryRow(entry: entry)
                        .contextMenu {
                            Button("Copy to Clipboard") { copyToClipboard(entry.refinedText) }
                            Button("Copy Raw Transcript") { copyToClipboard(entry.rawTranscript) }
                            Divider()
                            Button("Delete", role: .destructive) { delete(entry) }
                        }
                }
                .listStyle(.inset)
            }
        }
        .navigationTitle("History")
        .toolbar {
            if !entries.isEmpty {
                ToolbarItem {
                    Button("Clear All", role: .destructive) {
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

    private func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

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

                Text(entry.timestamp, style: .relative)
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
}
