import AppKit
import ApplicationServices
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import os

private let shotLogger = Logger(subsystem: "com.hibachi.voicelatte", category: "ScreenCapture")

/// 入力先アプリのウィンドウだけを撮影する（他アプリは写さない）。
/// 取れなければnilを返す（fail closed。全画面フォールバックはしない）。
/// 画面収録の権限がなければnilを返し、文脈なしで続行する。保存はしない。
enum ScreenCapture {
    static let maxEdge: CGFloat = 1568
    static let maxBase64Chars = 1_400_000

    static func captureDisplay(x: Double?, y: Double?, bundleID: String?) async -> String? {
        let fallbackDisplay = displayID(x: x, y: y)
        if let image = await appWindowsImage(bundleID: bundleID, fallbackDisplay: fallbackDisplay),
           let data = jpeg(image, quality: 0.7),
           let shot = validated(data) {
            return shot
        }
        // 対象窓が撮れないときは画像なしで続行する（AX文言に縮退）。
        // ディスプレイ全体のフォールバックはしない。他アプリの画面をAIに送らないため。
        shotLogger.notice("app window capture failed, continuing without image")
        return nil
    }

    private static func validated(_ data: Data) -> String? {
        let encoded = data.base64EncodedString()
        guard encoded.count <= maxBase64Chars else {
            shotLogger.notice("screenshot too large, skipping")
            return nil
        }
        return encoded
    }

    /// 指定アプリの表示中ウィンドウを写す。フォーカス窓が特定できればその1枚だけを
    /// 直接取り込み、だめならアプリ全体の外接矩形で切り詰める。それもだめならnil。
    @MainActor
    private static func appWindowsImage(bundleID: String?, fallbackDisplay: CGDirectDisplayID) async -> CGImage? {
        guard let bundleID, !bundleID.isEmpty else { return nil }
        guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else { return nil }
        let candidates = content.windows.filter {
            $0.isOnScreen && $0.owningApplication?.bundleIdentifier == bundleID
        }
        guard !candidates.isEmpty else { return nil }
        // フォーカス窓の1枚撮り（AXで特定→SCWindowに紐付け）
        if let focused = pickFocusedWindow(candidates: candidates, bundleID: bundleID),
           let single = try? await singleWindowImage(focused) {
            return single
        }
        // フォールバック：表示ディスプレイから他アプリを除外→外接矩形で切る
        guard let window = candidates.first else { return nil }
        let center = CGPoint(x: window.frame.midX, y: window.frame.midY)
        let display = displayID(point: center) ?? fallbackDisplay
        let others = content.applications.filter { $0.bundleIdentifier != bundleID }
        guard let scDisplay = content.displays.first(where: { $0.displayID == display }) else { return nil }
        let filter = SCContentFilter(display: scDisplay, excludingApplications: others, exceptingWindows: [])
        let bounds = CGDisplayBounds(display)
        let scale = min(1, maxEdge / max(bounds.width, bounds.height))
        let config = SCStreamConfiguration()
        config.width = Int((bounds.width * scale).rounded())
        config.height = Int((bounds.height * scale).rounded())
        config.showsCursor = false
        guard let full = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) else { return nil }
        // アプリ領域だけに切り詰める（切り詰め不可なら全体を返す）
        if let crop = appCropRect(bundleID: bundleID, content: content, display: display,
                                  imageSize: CGSize(width: full.width, height: full.height)),
           let cropped = full.cropping(to: crop) {
            return cropped
        }
        return full
    }

    /// 対象ウィンドウ1枚だけを取り込む。crop不要・黒埋めなし。
    @MainActor
    private static func singleWindowImage(_ window: SCWindow) async -> CGImage? {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let w = window.frame.width
        let h = window.frame.height
        guard w > 4, h > 4 else { return nil }
        let scale = min(1, maxEdge / max(w, h))
        let config = SCStreamConfiguration()
        config.width = Int((w * scale).rounded())
        config.height = Int((h * scale).rounded())
        config.showsCursor = false
        return try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }

    /// フォーカス窓を候補から選ぶ。1枚しかなければそれ。複数はタイトル→重なりで絞る。
    /// 特定できなければnil（呼び出し側が外接矩形にフォールバックする）。
    private static func pickFocusedWindow(candidates: [SCWindow], bundleID: String) -> SCWindow? {
        guard candidates.count > 1 else { return candidates.first }
        let info = focusedWindowInfo(bundleID: bundleID)
        if let title = info.title, !title.isEmpty {
            let titled = candidates.filter { $0.title == title }
            if titled.count == 1 { return titled.first }
            if titled.count > 1, let best = bestOverlap(titled, info.frame) { return best }
            if titled.isEmpty, let best = bestOverlap(candidates, info.frame) { return best }
            if !titled.isEmpty { return titled.first }
        } else if let best = bestOverlap(candidates, info.frame) {
            return best
        }
        return nil
    }

    /// AXフレームとの重なりが最大の候補を選ぶ。通常・上下反転の両方で試す。
    private static func bestOverlap(_ windows: [SCWindow], _ axFrame: CGRect?) -> SCWindow? {
        guard let ax = axFrame, !ax.isEmpty, ax.width > 4, ax.height > 4 else { return nil }
        let mainH = CGDisplayBounds(CGMainDisplayID()).height
        let flipped = CGRect(x: ax.minX, y: mainH - ax.maxY, width: ax.width, height: ax.height)
        var bestWindow: SCWindow?
        var bestRatio: CGFloat = 0.3
        for window in windows {
            let ratio = max(overlapRatio(window.frame, ax), overlapRatio(window.frame, flipped))
            if ratio > bestRatio {
                bestWindow = window
                bestRatio = ratio
            }
        }
        return bestWindow
    }

    private static func overlapRatio(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let inter = a.intersection(b)
        guard !inter.isNull, !inter.isEmpty else { return 0 }
        let denom = min(a.width * a.height, b.width * b.height)
        guard denom > 0 else { return 0 }
        return (inter.width * inter.height) / denom
    }

    /// AXからフォーカス窓のタイトルと枠を取る。許可なし・失敗時は空。
    private static func focusedWindowInfo(bundleID: String) -> (title: String?, frame: CGRect?) {
        guard AXIsProcessTrusted() else { return (nil, nil) }
        guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleID }) else { return (nil, nil) }
        let appRef = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(appRef, 0.15)
        var windowRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appRef, kAXFocusedWindowAttribute as CFString, &windowRef) == .success,
              let window = windowRef, CFGetTypeID(window) == AXUIElementGetTypeID() else { return (nil, nil) }
        let element = window as! AXUIElement
        return (stringAttribute(element, kAXTitleAttribute), frame(of: element))
    }

    private static func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private static func frame(of element: AXUIElement) -> CGRect? {
        var positionRef: CFTypeRef?
        var sizeRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
              let positionRef, let sizeRef,
              CFGetTypeID(positionRef) == AXValueGetTypeID(),
              CFGetTypeID(sizeRef) == AXValueGetTypeID() else { return nil }
        var position = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(positionRef as! AXValue, .cgPoint, &position),
              AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
        return CGRect(origin: position, size: size)
    }

    /// 対象アプリのウィンドウ外接矩形を画像ピクセル座標で求める。
    private static func appCropRect(bundleID: String, content: SCShareableContent,
                                    display: CGDirectDisplayID, imageSize: CGSize) -> CGRect? {
        let bounds = CGDisplayBounds(display)
        let frames = content.windows.compactMap { window -> CGRect? in
            guard window.isOnScreen, window.owningApplication?.bundleIdentifier == bundleID else { return nil }
            let clipped = window.frame.intersection(bounds)
            guard !clipped.isNull, !clipped.isEmpty else { return nil }
            return clipped
        }
        guard var union = frames.first else { return nil }
        for frame in frames.dropFirst() { union = union.union(frame) }
        let sx = imageSize.width / bounds.width
        let sy = imageSize.height / bounds.height
        let pixels = CGRect(x: (union.minX - bounds.minX) * sx,
                            y: (union.minY - bounds.minY) * sy,
                            width: union.width * sx,
                            height: union.height * sy)
        let clamped = pixels.intersection(CGRect(origin: .zero, size: imageSize))
        guard !clamped.isNull, clamped.width >= 4, clamped.height >= 4 else { return nil }
        return clamped.integral
    }

    private static func displayID(x: Double?, y: Double?) -> CGDirectDisplayID {
        if let x, let y {
            let point = CGPoint(x: x, y: y)
            if let display = displayID(point: point) { return display }
        }
        return CGMainDisplayID()
    }

    private static func displayID(point: CGPoint) -> CGDirectDisplayID? {
        var count: UInt32 = 0
        var displays = [CGDirectDisplayID](repeating: 0, count: 8)
        guard CGGetDisplaysWithPoint(point, 8, &displays, &count) == .success,
              count > 0 else { return nil }
        return displays[0]
    }

    private static func scaled(_ image: CGImage, maxEdge: CGFloat) -> CGImage? {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        let longEdge = max(width, height)
        guard longEdge > maxEdge else { return image }
        let scale = maxEdge / longEdge
        let newWidth = Int((width * scale).rounded())
        let newHeight = Int((height * scale).rounded())
        guard newWidth > 0, newHeight > 0,
              let context = CGContext(
                  data: nil,
                  width: newWidth,
                  height: newHeight,
                  bitsPerComponent: 8,
                  bytesPerRow: 0,
                  space: CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
              ) else { return nil }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: newWidth, height: newHeight))
        return context.makeImage()
    }

    private static func jpeg(_ image: CGImage, quality: CGFloat) -> Data? {
        encode(image, type: UTType.jpeg.identifier, quality: quality)
    }

    private static func encode(_ image: CGImage, type: String, quality: CGFloat) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data as CFMutableData,
            type as CFString,
            1,
            nil
        ) else { return nil }
        CGImageDestinationAddImage(destination, image, [
            kCGImageDestinationLossyCompressionQuality: quality,
        ] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }
}
