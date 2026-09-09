import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import os

private let shotLogger = Logger(subsystem: "com.hibachi.voicelatte", category: "ScreenCapture")

/// 入力先ディスプレイのスクリーンショットを撮る。OpenWhispr方式。
/// 画面収録の権限がなければnilを返し、文脈なしで続行する。保存はしない。
enum ScreenCapture {
    static let maxEdge: CGFloat = 1568
    static let maxBase64Chars = 1_400_000

    static func captureDisplay(x: Double?, y: Double?) -> String? {
        var target = CGMainDisplayID()
        if let x, let y {
            var count: UInt32 = 0
            var displays = [CGDirectDisplayID](repeating: 0, count: 8)
            if CGGetDisplaysWithPoint(CGPoint(x: x, y: y), 8, &displays, &count) == .success,
               count > 0 {
                target = displays[0]
            }
        }
        guard let image = CGDisplayCreateImage(target) else { return nil }
        guard let scaled = scaled(image, maxEdge: maxEdge),
              let data = jpeg(scaled, quality: 0.7) else { return nil }
        let encoded = data.base64EncodedString()
        guard encoded.count <= maxBase64Chars else {
            shotLogger.notice("screenshot too large, skipping")
            return nil
        }
        return encoded
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
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data as CFMutableData,
            UTType.jpeg.identifier as CFString,
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
