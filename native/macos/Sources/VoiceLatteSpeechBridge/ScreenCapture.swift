import AppKit
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import os

private let shotLogger = Logger(subsystem: "com.hibachi.voicelatte", category: "ScreenCapture")

/// 入力先アプリのウィンドウだけを撮影する（他アプリは写さない）。
/// 取れなければディスプレイ全体にフォールバックする。
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
        // フォールバック：ディスプレイ全体
        guard let image = CGDisplayCreateImage(fallbackDisplay),
              let scaled = scaled(image, maxEdge: maxEdge),
              let data = jpeg(scaled, quality: 0.7),
              let shot = validated(data) else { return nil }
        return shot
    }

    private static func validated(_ data: Data) -> String? {
        let encoded = data.base64EncodedString()
        guard encoded.count <= maxBase64Chars else {
            shotLogger.notice("screenshot too large, skipping")
            return nil
        }
        return encoded
    }

    /// 指定アプリの表示中ウィンドウだけを写す。黒埋め部分は切り落とす。
    @MainActor
    private static func appWindowsImage(bundleID: String?, fallbackDisplay: CGDirectDisplayID) async -> CGImage? {
        guard let bundleID, !bundleID.isEmpty else { return nil }
        guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else { return nil }
        guard let window = content.windows.first(where: {
            $0.isOnScreen && $0.owningApplication?.bundleIdentifier == bundleID
        }) else {
            fputs("SCK: no window for \(bundleID)\n", stderr); return nil
        }
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
