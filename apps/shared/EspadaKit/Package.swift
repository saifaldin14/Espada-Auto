// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "EspadaKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "EspadaProtocol", targets: ["EspadaProtocol"]),
        .library(name: "EspadaKit", targets: ["EspadaKit"]),
        .library(name: "EspadaChatUI", targets: ["EspadaChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "EspadaProtocol",
            path: "Sources/EspadaProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "EspadaKit",
            dependencies: [
                "EspadaProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/EspadaKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "EspadaChatUI",
            dependencies: [
                "EspadaKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/EspadaChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "EspadaKitTests",
            dependencies: ["EspadaKit", "EspadaChatUI"],
            path: "Tests/EspadaKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
