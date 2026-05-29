import SwiftUI

struct ScaleAppearModifier: ViewModifier {
    let isVisible: Bool

    func body(content: Content) -> some View {
        content
            .scaleEffect(isVisible ? 1.0 : 0.92)
            .opacity(isVisible ? 1.0 : 0.0)
            .animation(isVisible ? DS.Animation.appear : DS.Animation.disappear, value: isVisible)
    }
}

extension View {
    func scaleAppear(_ isVisible: Bool) -> some View {
        modifier(ScaleAppearModifier(isVisible: isVisible))
    }
}
