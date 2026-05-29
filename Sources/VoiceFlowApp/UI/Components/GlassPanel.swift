import AppKit
import SwiftUI

@MainActor
class GlassPanel<Content: View>: NSPanel {
    private var hostingView: NSHostingView<Content>?

    init(contentRect: NSRect, content: Content) {
        super.init(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        isOpaque = false
        backgroundColor = .clear
        level = .statusBar
        hasShadow = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        hidesOnDeactivate = false
        isMovableByWindowBackground = false
        titleVisibility = .hidden
        titlebarAppearsTransparent = true

        let hosting = NSHostingView(rootView: content)
        hosting.frame = contentView!.bounds
        hosting.autoresizingMask = [.width, .height]
        contentView?.addSubview(hosting)
        hostingView = hosting
    }

    func updateContent(_ content: Content) {
        hostingView?.rootView = content
    }

    func showAnimated() {
        alphaValue = 0
        orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.3
            ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.2, 1.0)
            self.animator().alphaValue = 1
        }
    }

    func hideAnimated(completion: (@MainActor () -> Void)? = nil) {
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.2
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            self.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            Task { @MainActor in
                self?.orderOut(nil)
                self?.alphaValue = 1
                completion?()
            }
        })
    }

    func positionBottomCenter(on screen: NSScreen? = .main) {
        guard let screen else { return }
        let visibleFrame = screen.visibleFrame
        let x = visibleFrame.midX - frame.width / 2
        let y = visibleFrame.minY + DS.Panel.hudBottomOffset
        setFrameOrigin(NSPoint(x: x, y: y))
    }

    func positionCenter(on screen: NSScreen? = .main) {
        guard let screen else { return }
        let visibleFrame = screen.visibleFrame
        let x = visibleFrame.midX - frame.width / 2
        let y = visibleFrame.midY - frame.height / 2
        setFrameOrigin(NSPoint(x: x, y: y))
    }
}
