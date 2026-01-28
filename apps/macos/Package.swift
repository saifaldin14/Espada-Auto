// swift-tools-version: 6.2
// Package manifest for the Espada macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Espada",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "EspadaIPC", targets: ["EspadaIPC"]),
        .library(name: "EspadaDiscovery", targets: ["EspadaDiscovery"]),
        .executable(name: "Espada", targets: ["Espada"]),
        .executable(name: "espada-mac", targets: ["EspadaMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/EspadaKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "EspadaIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "EspadaDiscovery",
            dependencies: [
                .product(name: "EspadaKit", package: "EspadaKit"),
            ],
            path: "Sources/EspadaDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Espada",
            dependencies: [
                "EspadaIPC",
                "EspadaDiscovery",
                .product(name: "EspadaKit", package: "EspadaKit"),
                .product(name: "EspadaChatUI", package: "EspadaKit"),
                .product(name: "EspadaProtocol", package: "EspadaKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Espada.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "EspadaMacCLI",
            dependencies: [
                "EspadaDiscovery",
                .product(name: "EspadaKit", package: "EspadaKit"),
                .product(name: "EspadaProtocol", package: "EspadaKit"),
            ],
            path: "Sources/EspadaMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "EspadaIPCTests",
            dependencies: [
                "EspadaIPC",
                "Espada",
                "EspadaDiscovery",
                .product(name: "EspadaProtocol", package: "EspadaKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
