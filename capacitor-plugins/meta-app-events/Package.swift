// swift-tools-version: 5.9
import PackageDescription

// Local plugin for the same reason as ../razorpay-native: the iOS project is
// pure SPM (that is what lets Codemagic build it without a Mac), and Meta's
// SDK publishes an SPM package, so we depend on it directly and write the
// thin bridge ourselves. Only FacebookCore — the App Events part — is
// linked; Login, Share and Gaming are not needed and not pulled in.
let package = Package(
    name: "MetaAppEvents",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "MetaAppEvents",
            targets: ["MetaAppEventsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        // 18.1.1 is the latest release as of 11 Oct 2026 (checked on the
        // GitHub releases page, not assumed).
        .package(url: "https://github.com/facebook/facebook-ios-sdk.git", from: "18.1.1")
    ],
    targets: [
        .target(
            name: "MetaAppEventsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "FacebookCore", package: "facebook-ios-sdk")
            ],
            path: "ios/Sources/MetaAppEventsPlugin")
    ]
)
