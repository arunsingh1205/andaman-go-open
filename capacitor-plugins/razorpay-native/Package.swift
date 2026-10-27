// swift-tools-version: 5.9
import PackageDescription

// A local Capacitor plugin, not an npm one, for a specific reason: Razorpay's
// own published wrapper (capacitor-razorpay) ships a .podspec and the legacy
// ios/Plugin layout with no Package.swift, so it can only be consumed by a
// CocoaPods project. This app's iOS project is pure SPM — that is what lets
// Codemagic build it without a Mac and without an .xcworkspace — and
// CocoaPods trunk is being frozen anyway. Razorpay's actual iOS SDK
// (razorpay-pod) does support SPM, so we depend on that directly and write
// the thin bridge ourselves.
//
// It lives in the repo and is wired in through package.json as
// "razorpay-native": "file:./capacitor-plugins/razorpay-native", because
// `npx cap sync ios` regenerates ios-app/App/CapApp-SPM/Package.swift from
// node_modules on every CI build — anything hand-edited there is lost.
let package = Package(
    name: "RazorpayNative",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "RazorpayNative",
            targets: ["RazorpayNativePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/razorpay/razorpay-pod.git", from: "1.4.1")
    ],
    targets: [
        .target(
            name: "RazorpayNativePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "RazorpayCheckout", package: "razorpay-pod")
            ],
            path: "ios/Sources/RazorpayNativePlugin")
    ]
)
