// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "OpenVoiceText-Pro",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(path: "OpenVoiceText"),
    ],
    targets: [
        .executableTarget(
            name: "ProRefiner",
            dependencies: [
                .product(name: "VoiceFlowProtocol", package: "OpenVoiceText"),
            ],
            path: "Sources/ProRefiner"
        ),
    ]
)
