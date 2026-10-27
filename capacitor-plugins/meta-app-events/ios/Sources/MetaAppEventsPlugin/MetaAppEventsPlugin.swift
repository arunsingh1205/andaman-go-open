import Foundation
import UIKit
import AppTrackingTransparency
import Capacitor
import FacebookCore

// The bridge between lib/meta-events.ts and Meta's App Events SDK.
//
// Why app events and not just the web pixel: the app is a WebView over the
// live site, so the pixel already fires inside it — but Meta files those as
// *website* events. An app-install ad needs the install, the first open and
// the booking reported by the app itself (with SKAdNetwork / AEM on iOS), or
// Meta can't connect a booking back to the ad that got the app installed.
//
// Switched on per app by Info.plist, not by code: the SDK only starts when
// FacebookAppID is present and non-empty. The customer app (ios-app) carries
// it; the Partner app (ios/) does not, so this plugin is linked there but
// stays inert — no SDK start, no events, no tracking prompt.
@objc(MetaAppEventsPlugin)
public class MetaAppEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MetaAppEventsPlugin"
    public let jsName = "MetaAppEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logPurchase", returnType: CAPPluginReturnPromise)
    ]

    private var enabled = false

    public override func load() {
        let appId = Bundle.main.object(forInfoDictionaryKey: "FacebookAppID") as? String ?? ""
        let token = Bundle.main.object(forInfoDictionaryKey: "FacebookClientToken") as? String ?? ""
        guard !appId.isEmpty, !token.isEmpty else { return }
        enabled = true

        DispatchQueue.main.async {
            // Until the person answers the tracking prompt, no IDFA. Meta
            // still gets the install through SKAdNetwork / AEM, which needs
            // no permission. requestTracking() turns IDFA on if they allow.
            Settings.shared.isAdvertiserIDCollectionEnabled =
                ATTrackingManager.trackingAuthorizationStatus == .authorized
            Settings.shared.isAutoLogAppEventsEnabled = true
            ApplicationDelegate.shared.application(
                UIApplication.shared, didFinishLaunchingWithOptions: nil)
            AppEvents.shared.activateApp()
        }
    }

    @objc func isEnabled(_ call: CAPPluginCall) {
        call.resolve(["enabled": enabled])
    }

    /// Shows Apple's "Allow … to track your activity" prompt once. iOS
    /// itself never shows it twice, so calling this on every launch is safe:
    /// after the first answer it resolves immediately with that answer.
    @objc func requestTracking(_ call: CAPPluginCall) {
        guard enabled else {
            call.resolve(["status": "disabled"])
            return
        }
        DispatchQueue.main.async {
            ATTrackingManager.requestTrackingAuthorization { status in
                DispatchQueue.main.async {
                    Settings.shared.isAdvertiserIDCollectionEnabled = status == .authorized
                    call.resolve(["status": Self.describe(status)])
                }
            }
        }
    }

    @objc func logEvent(_ call: CAPPluginCall) {
        guard enabled else { call.resolve(); return }
        guard let name = call.getString("name"), !name.isEmpty else {
            call.reject("Event name is missing.")
            return
        }
        let params = Self.parameters(call.getObject("params"))
        if let value = call.getDouble("valueToSum") {
            AppEvents.shared.logEvent(AppEvents.Name(name), valueToSum: value, parameters: params)
        } else {
            AppEvents.shared.logEvent(AppEvents.Name(name), parameters: params)
        }
        call.resolve()
    }

    @objc func logPurchase(_ call: CAPPluginCall) {
        guard enabled else { call.resolve(); return }
        guard let amount = call.getDouble("amount") else {
            call.reject("Purchase amount is missing.")
            return
        }
        let currency = call.getString("currency") ?? "INR"
        AppEvents.shared.logPurchase(
            amount: amount, currency: currency, parameters: Self.parameters(call.getObject("params")))
        // A purchase is the one event worth not losing if the app is closed
        // straight after the confirmation screen.
        AppEvents.shared.flush()
        call.resolve()
    }

    /// Only strings and numbers cross over — that is all App Events
    /// parameters accept, and all lib/meta-events.ts sends.
    private static func parameters(_ object: JSObject?) -> [AppEvents.ParameterName: Any] {
        var out: [AppEvents.ParameterName: Any] = [:]
        for (key, value) in object ?? [:] {
            if let s = value as? String {
                out[AppEvents.ParameterName(key)] = s
            } else if let n = value as? NSNumber {
                out[AppEvents.ParameterName(key)] = n
            }
        }
        return out
    }

    private static func describe(_ status: ATTrackingManager.AuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }
}
