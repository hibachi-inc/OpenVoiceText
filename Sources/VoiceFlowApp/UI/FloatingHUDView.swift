import SwiftUI

struct FloatingHUDView: View {
    let status: HUDStatus
    let transcript: String
    let audioLevel: Float
    var onTap: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: DS.Spacing.md) {
                statusIndicator
                textContent
                if status == .listening {
                    Spacer(minLength: 0)
                    WaveformView(level: audioLevel)
                        .frame(width: 48, height: 28)
                        .transition(.scale.combined(with: .opacity))
                }
            }

            if status == .listening || status == .processing {
                HStack(spacing: DS.Spacing.xs) {
                    Text("⌥Space")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(.white.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                    Text("or click to stop")
                        .font(.system(size: 10, weight: .medium))
                }
                .foregroundStyle(.white.opacity(0.4))
                .padding(.top, DS.Spacing.xs)
            }
        }
        .padding(.horizontal, DS.Spacing.xl)
        .padding(.vertical, DS.Spacing.md)
        .background {
            ZStack {
                VisualEffectBackground(material: .hudWindow, blendingMode: .behindWindow)
                status.color.opacity(0.12)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.lg, style: .continuous)
                .strokeBorder(.white.opacity(0.15), lineWidth: 0.5)
        }
        .shadow(
            color: DS.Shadow.hud.color,
            radius: DS.Shadow.hud.radius,
            y: DS.Shadow.hud.y
        )
        .contentShape(Rectangle())
        .onTapGesture { onTap?() }
        .animation(DS.Animation.content, value: status)
        .animation(DS.Animation.content, value: transcript)
    }

    // MARK: - Status indicator

    private var statusIndicator: some View {
        ZStack {
            Circle()
                .fill(status.color.opacity(0.2))
                .frame(width: 32, height: 32)

            Image(systemName: status.iconName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(status.color)
                .symbolEffect(.pulse, isActive: status == .listening)
                .contentTransition(.symbolEffect(.replace))
        }
    }

    // MARK: - Text content

    private var textContent: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(status.title)
                .font(DS.Font.hudStatus)
                .foregroundStyle(.white.opacity(0.7))

            if !transcript.isEmpty {
                Text(transcript.suffix(80))
                    .font(DS.Font.hudTranscript)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .contentTransition(.numericText())
            }
        }
    }
}

// MARK: - Waveform visualizer

struct WaveformView: View {
    let level: Float
    private let barCount = 7
    private let weights: [Float] = [0.4, 0.65, 0.85, 1.0, 0.85, 0.65, 0.4]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<barCount, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(.white.opacity(0.75))
                    .frame(width: 3, height: barHeight(for: i))
                    .animation(
                        .spring(response: 0.15, dampingFraction: 0.6),
                        value: level
                    )
            }
        }
    }

    private func barHeight(for index: Int) -> CGFloat {
        let weighted = level * weights[index]
        return CGFloat(max(0.08, min(1.0, weighted))) * 24 + 3
    }
}

// MARK: - Status enum

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
