// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "VoiceLatteSpeechBridge",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "voicelatte-speech", targets: ["VoiceLatteSpeechBridge"]),
    ],
    targets: [
        .executableTarget(name: "VoiceLatteSpeechBridge"),
    ]
)
