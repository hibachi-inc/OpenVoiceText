import SwiftUI

struct CardSection<Content: View>: View {
    let header: String?
    @ViewBuilder let content: Content

    init(header: String? = nil, @ViewBuilder content: () -> Content) {
        self.header = header
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let header {
                Text(header.uppercased())
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Colors.secondary)
                    .padding(.horizontal, DS.Spacing.md)
                    .padding(.bottom, DS.Spacing.xs)
            }

            VStack(spacing: 1) {
                content
            }
            .background(.white.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
        }
    }
}
