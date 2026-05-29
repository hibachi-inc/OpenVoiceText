import SwiftUI

struct FloatingHUDView: View {
    let status: HUDStatus
    let transcript: String
    let audioLevel: Float

    var body: some View {
        HStack(spacing: DS.Spacing.md) {
            Image(systemName: status.iconName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(status.color)
                .symbolEffect(.pulse, isActive: status == .listening)

            VStack(alignment: .leading, spacing: 2) {
                Text(status.title)
                    .font(DS.Font.hudStatus)
                    .foregroundStyle(.white)
                if !transcript.isEmpty {
                    Text(transcript.suffix(80))
                        .font(DS.Font.hudTranscript)
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                }
            }

            if status == .listening {
                AudioMeterView(level: audioLevel)
                    .frame(width: 40, height: 24)
            }
        }
        .padding(.horizontal, DS.Spacing.xl)
        .padding(.vertical, DS.Spacing.md)
        .background(.ultraThinMaterial.opacity(0.9))
        .background(status.color.opacity(0.3))
        .clipShape(Capsule())
        .shadow(
            color: DS.Shadow.hud.color,
            radius: DS.Shadow.hud.radius,
            y: DS.Shadow.hud.y
        )
    }
}

enum HUDStatus: Equatable {
    case listening
    case processing
    case copied
    case inserted
    case error(String)

    var iconName: String {
        switch self {
        case .listening: "mic.fill"
        case .processing: "sparkles"
        case .copied, .inserted: "checkmark.circle.fill"
        case .error: "exclamationmark.triangle.fill"
        }
    }

    var title: String {
        switch self {
        case .listening: "Listening..."
        case .processing: "Refining..."
        case .copied: "Copied — ⌘V to paste"
        case .inserted: "Inserted"
        case .error(let msg): msg
        }
    }

    var color: Color {
        switch self {
        case .listening: DS.Colors.recording
        case .processing: DS.Colors.processing
        case .copied, .inserted: DS.Colors.success
        case .error: DS.Colors.error
        }
    }
}

struct AudioMeterView: View {
    let level: Float
    private let weights: [Float] = [0.5, 0.8, 1.0, 0.75, 0.55]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1)
                    .fill(.white.opacity(0.8))
                    .frame(width: 3, height: barHeight(for: i))
            }
        }
    }

    private func barHeight(for index: Int) -> CGFloat {
        CGFloat(max(0.1, min(1.0, level * weights[index]))) * 20 + 4
    }
}
