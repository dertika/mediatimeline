// swift-tools-version: 5.9
import PackageDescription

// Platform-independent logic of the iOS app (models, API, links, grouping),
// kept free of UIKit/SwiftUI so `swift test` runs it on macOS.
let package = Package(
    name: "MediaTimelineKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MediaTimelineKit", targets: ["MediaTimelineKit"]),
    ],
    targets: [
        .target(name: "MediaTimelineKit"),
        .testTarget(
            name: "MediaTimelineKitTests",
            dependencies: ["MediaTimelineKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
