package com.andamango.razorpaynative;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.razorpay.Checkout;
import com.razorpay.PaymentData;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The bridge between lib/razorpay-client.ts and Razorpay's native Android
 * checkout — the Android counterpart of
 * ../../ios/Sources/RazorpayNativePlugin/RazorpayNativePlugin.swift, same
 * JS-facing contract (open/abandon, {orderId, paymentId, signature}).
 *
 * Why this exists at all: inside a WebView, Razorpay's web checkout can't
 * hand a upi:// URL off to a UPI app (Google Pay, PhonePe, ...) — the same
 * structural problem the iOS plugin's own header comment describes for its
 * WKWebView/iframe case, just Android's version of "there's a WebView in
 * the way." Razorpay's native SDK has no WebView to be inside, and
 * app-switches to the UPI app directly.
 *
 * The one real architecture difference from iOS: Razorpay's Android SDK
 * doesn't call back into whatever object opened the checkout — it casts the
 * *Activity* passed to Checkout.open() directly to PaymentResultWithDataListener
 * (and ExternalWalletListener) and invokes onPaymentSuccess/onPaymentError on
 * that Activity. So MainActivity implements those interfaces and forwards
 * both callbacks here via handlePaymentSuccess/handlePaymentError — confirmed
 * against Razorpay's own official sample app and their own Flutter plugin's
 * Android delegate (both fetched directly from GitHub while building this),
 * not assumed.
 */
@CapacitorPlugin(name = "RazorpayNative")
public class RazorpayNativePlugin extends Plugin {

    /** The one in-flight call — Razorpay's callbacks carry no correlation
     *  id, so only one checkout can be open at a time, same as the sheet
     *  itself and same as the iOS plugin's own `pending`. */
    private PluginCall pending;

    @PluginMethod
    public void open(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Razorpay key is missing.");
            return;
        }
        String optionsJson = call.getString("optionsJson");
        JSONObject options;
        try {
            options = new JSONObject(optionsJson);
        } catch (Exception e) {
            call.reject("Checkout options could not be read.");
            return;
        }
        if (pending != null) {
            call.reject("A payment is already open.");
            return;
        }

        pending = call;
        call.setKeepAlive(true);

        getActivity().runOnUiThread(() -> {
            Checkout checkout = new Checkout();
            checkout.setKeyID(key);
            try {
                checkout.open(getActivity(), options);
            } catch (Exception e) {
                settle(null, "Could not open the payment screen.");
            }
        });
    }

    /**
     * Gives up on the in-flight `open` call — mirrors the iOS plugin's
     * abandon(), for the same reason (lib/razorpay-client.ts's resume
     * handling: the JS side has already found the answer itself by asking
     * the server, and just wants whatever's on screen gone).
     *
     * Unlike iOS's UIViewController.dismiss(animated:), there is no
     * documented, supported Razorpay API to close CheckoutActivity from
     * outside it. The fallback used here — Activity.finishActivity() against
     * the SDK's own public Checkout.RZP_REQUEST_CODE, the same request code
     * Razorpay's own official Flutter plugin uses for this exact
     * startActivityForResult call — closes it in every version this was
     * checked against, but isn't a documented guarantee the way iOS's
     * dismiss is. If a future SDK version moves away from
     * startActivityForResult internally, this stops closing the screen; it
     * always still clears this plugin's own pending-call bookkeeping
     * either way, so a stuck *native* side is never possible, only
     * (rarely) a checkout screen the traveller has to back out of by hand.
     */
    @PluginMethod
    public void abandon(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pending != null) {
                pending.setKeepAlive(false);
            }
            pending = null;

            try {
                getActivity().finishActivity(Checkout.RZP_REQUEST_CODE);
            } catch (Exception e) {
                // Best-effort — see method comment. Nothing more to do.
            }
            call.resolve();
        });
    }

    /** Called from MainActivity.onPaymentSuccess(). */
    public void handlePaymentSuccess(String paymentId, PaymentData data) {
        JSObject result = new JSObject();
        result.put("paymentId", paymentId);
        if (data != null) {
            if (data.getOrderId() != null) result.put("orderId", data.getOrderId());
            if (data.getSignature() != null) result.put("signature", data.getSignature());
        }
        settle(result, null);
    }

    /** Called from MainActivity.onPaymentError(). `message` is Razorpay's
     *  own JSON-encoded error payload ({"error": {"description": ...}}),
     *  not a plain string — confirmed against Razorpay's own Flutter
     *  Android delegate, which parses it the same way. */
    public void handlePaymentError(int code, String message, PaymentData data) {
        // Checkout.PAYMENT_CANCELED — the real SDK constant, safe to
        // reference directly on Android (unlike iOS, which uses the literal
        // 2 because the enum's Swift name isn't stable across their Pod/SPM
        // builds; Gradle has no such instability).
        if (code == Checkout.PAYMENT_CANCELED) {
            settle(null, "Payment cancelled.");
            return;
        }

        String description = extractDescription(message);
        settle(null, description.isEmpty() ? "Payment failed. Nothing was charged." : description);
    }

    private String extractDescription(String message) {
        if (message == null) return "";
        try {
            JSONObject response = new JSONObject(message);
            JSONObject error = response.optJSONObject("error");
            if (error != null) {
                return error.optString("description", "");
            }
        } catch (JSONException e) {
            // Not JSON — some SDK paths do hand back a plain string. Use it
            // as-is rather than losing the only description available.
            return message;
        }
        return message;
    }

    private void settle(JSObject resolvePayload, String rejectMessage) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;

        if (rejectMessage != null) {
            call.reject(rejectMessage);
        } else {
            call.resolve(resolvePayload != null ? resolvePayload : new JSObject());
        }
        call.setKeepAlive(false);
    }
}
