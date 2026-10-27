import Foundation
import Capacitor

// The SDK's module name differs between its SPM product (RazorpayCheckout)
// and its CocoaPods one (Razorpay), and the SPM package re-exports through a
// source target, so which one carries the symbols isn't worth guessing at
// from here. Import whichever is present rather than losing a build cycle to
// "no such module".
#if canImport(RazorpayCheckout)
import RazorpayCheckout
#endif
#if canImport(Razorpay)
import Razorpay
#endif

// The bridge between lib/razorpay-client.ts and Razorpay's native iOS
// checkout.
//
// Why this exists at all: inside a WKWebView, Razorpay's web checkout runs in
// an iframe, and a tap on "pay with Google Pay" is a navigation *inside that
// iframe* to a upi:// URL. Capacitor only hands non-http URLs to iOS when the
// navigation is top-level (WebViewDelegationHandler.swift, the
// `!isApplicationNavigation, toplevelNavigation` branch), so the scheme is
// swallowed by the WebView and nothing opens. The web checkout therefore
// falls back to asking for a typed UPI ID. The native SDK has no iframe and
// no WebView, switches to the UPI app itself, and brings its own sheet — so
// the "checkout doesn't fit the frame" problem disappears with it.
//
// Options arrive as a JSON string rather than a JSObject on purpose: the
// checkout payload is an open-ended dictionary (prefill, theme, notes,
// method toggles) and JSValue -> Any conversion for arbitrary nesting is
// where this kind of bridge usually goes wrong. One JSONSerialization call
// gives the [String: Any] the SDK wants, exactly as the caller built it.
@objc(RazorpayNativePlugin)
public class RazorpayNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RazorpayNativePlugin"
    public let jsName = "RazorpayNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abandon", returnType: CAPPluginReturnPromise)
    ]

    private var razorpay: RazorpayCheckout?

    /// The one in-flight call. Razorpay's delegate callbacks carry no
    /// correlation id, so only one checkout can be open at a time — which is
    /// also true of the sheet itself.
    private var pending: CAPPluginCall?

    @objc func open(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Razorpay key is missing.")
            return
        }
        guard let optionsJson = call.getString("optionsJson"),
              let data = optionsJson.data(using: .utf8),
              let options = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            call.reject("Checkout options could not be read.")
            return
        }
        if pending != nil {
            call.reject("A payment is already open.")
            return
        }

        pending = call
        // Without this the call is released as soon as open() returns, and
        // the delegate callback lands on a dead promise.
        call.keepAlive = true

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let controller = self.bridge?.viewController else {
                self.settle(reject: "Could not open the payment screen.")
                return
            }

            let checkout = RazorpayCheckout.initWithKey(key, andDelegate: self)
            self.razorpay = checkout
            checkout.open(options, displayController: controller)
        }
    }

    /// Called when the JS side has given up waiting on `open` — see
    /// lib/razorpay-client.ts's resume handling. Razorpay's checkout screen
    /// is itself a WKWebView, and iOS can recycle its content process while
    /// this app is backgrounded for the UPI app-switch; when that happens,
    /// Razorpay's SDK doesn't re-inject its own JS bridge on return, so the
    /// screen sits frozen and never calls onPaymentSuccess/onPaymentError at
    /// all — a known issue in their SDK, not something a delegate fix here
    /// can work around. Once the JS side has confirmed the outcome for
    /// itself (asking our server, which asks Razorpay directly), the only
    /// thing left to do here is get the dead screen off the traveller's
    /// phone.
    @objc func abandon(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.resolve()
                return
            }

            // The original `open` call's promise is orphaned, not rejected:
            // the JS side already has its own answer and isn't awaiting this
            // one any more. Clearing the slot just stops a late delegate
            // callback (should the frozen screen ever recover on its own)
            // from calling settle() on a call nobody is listening to.
            if let pending = self.pending {
                pending.keepAlive = false
            }
            self.pending = nil
            self.razorpay = nil

            if let presented = self.bridge?.viewController?.presentedViewController {
                presented.dismiss(animated: true) {
                    call.resolve()
                }
            } else {
                call.resolve()
            }
        }
    }

    /// Resolve or reject whichever call is in flight, and clear the slot so
    /// the next payment can start. Every exit path goes through here.
    private func settle(resolve payload: [String: Any]? = nil, reject message: String? = nil) {
        let call = pending
        pending = nil
        razorpay = nil

        guard let call = call else { return }
        if let message = message {
            call.reject(message)
        } else {
            call.resolve(payload ?? [:])
        }
        call.keepAlive = false
    }
}

// @objc on every one of these, and it is not decoration.
//
// The first version of this file declared them as plain Swift methods in this
// extension. The sheet opened, the payment went through, and the delegate was
// never called - the app sat on "Booking..." forever and the money was gone
// with nothing recorded. /api/pay-trace caught it precisely: one
// "native:opening" line and then silence.
//
// The SDK is Objective-C era and finds its callbacks by selector at runtime.
// A Swift method in an extension has no Objective-C selector unless it says
// so, so the SDK looked for onPaymentSuccess:andData:, found nothing, and
// failed silently rather than complaining. Both spellings are implemented
// because the SDK picks whichever the delegate answers to, and the short one
// hands back only a payment id - which is fine now, because the server
// re-checks the order with Razorpay directly instead of trusting a receipt
// carried back through the app.
extension RazorpayNativePlugin: RazorpayPaymentCompletionProtocolWithData {
    @objc public func onPaymentSuccess(_ payment_id: String, andData response: [AnyHashable: Any]?) {
        // A missing order id or signature is no longer fatal. The server
        // confirms the order with Razorpay itself, so "this payment id
        // succeeded" is enough to go on — and losing a booking over a
        // half-filled dictionary, after the money has already moved, is the
        // one outcome most worth bending to avoid.
        var payload: [String: Any] = ["paymentId": payment_id]
        if let orderId = response?["razorpay_order_id"] as? String {
            payload["orderId"] = orderId
        }
        if let signature = response?["razorpay_signature"] as? String {
            payload["signature"] = signature
        }
        settle(resolve: payload)
    }

    /// The short form of the same callback, for SDK builds that prefer it.
    @objc public func onPaymentSuccess(_ payment_id: String) {
        settle(resolve: ["paymentId": payment_id])
    }

    /// The short form of the error callback, likewise.
    @objc public func onPaymentError(_ code: Int32, description str: String) {
        onPaymentError(code, description: str, andData: nil)
    }

    @objc public func onPaymentError(_ code: Int32, description str: String, andData response: [AnyHashable: Any]?) {
        // Razorpay reports a dismissed sheet through the same channel as a
        // declined card. The web path already distinguishes them (ondismiss
        // vs payment.failed) and every booking screen shows the message it
        // gets, so keep the wording identical to the web one for a
        // cancellation and pass the real reason through otherwise.
        // 2 is Razorpay's PAYMENT_CANCELLED across their SDKs (0 network,
        // 1 invalid options, 2 cancelled). Written as the literal rather than
        // the SDK's enum on purpose — the enum's Swift name isn't stable
        // across their SPM and Pod builds, and a wrong symbol costs a whole
        // build cycle to discover.
        if code == 2 {
            settle(reject: "Payment cancelled.")
            return
        }

        let reason = str.isEmpty ? "Payment failed. Nothing was charged." : str
        settle(reject: reason)
    }
}
