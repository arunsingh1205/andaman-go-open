package com.andamango.metaappevents;

import android.os.Bundle;

import com.facebook.FacebookSdk;
import com.facebook.appevents.AppEventsLogger;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.math.BigDecimal;
import java.util.Currency;
import java.util.Iterator;

/**
 * The bridge between lib/meta-events.ts and Meta's App Events SDK — the
 * Android counterpart of
 * ../../ios/Sources/MetaAppEventsPlugin/MetaAppEventsPlugin.swift, same
 * JS-facing contract (isEnabled / requestTracking / logEvent / logPurchase).
 *
 * Switched on per app by the manifest, not by code. Meta's SDK starts itself
 * at launch from its own ContentProvider, reading
 * com.facebook.sdk.ApplicationId / ClientToken from the app's manifest. The
 * customer app (android-app) declares both; the Partner app (android/) does
 * not, so the SDK's auto-start fails quietly there (it catches and logs) and
 * this plugin reports itself disabled — no events from the Partner app.
 *
 * Install, first open and every later open are logged by the SDK itself
 * (automatic app events + the Play Install Referrer); this plugin only adds
 * the booking funnel on top.
 */
@CapacitorPlugin(name = "MetaAppEvents")
public class MetaAppEventsPlugin extends Plugin {

    private AppEventsLogger logger;

    private boolean enabled() {
        if (logger != null) return true;
        try {
            if (!FacebookSdk.isInitialized()) return false;
            String appId = FacebookSdk.getApplicationId();
            if (appId == null || appId.isEmpty()) return false;
            logger = AppEventsLogger.newLogger(getContext());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", enabled());
        call.resolve(ret);
    }

    /** Android has no tracking prompt; the Advertising ID is governed by the
     *  person's own system setting. Resolves so callers needn't branch. */
    @PluginMethod
    public void requestTracking(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", enabled() ? "authorized" : "disabled");
        call.resolve(ret);
    }

    @PluginMethod
    public void logEvent(PluginCall call) {
        if (!enabled()) { call.resolve(); return; }
        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            call.reject("Event name is missing.");
            return;
        }
        Bundle params = toBundle(call.getObject("params"));
        Double value = call.getDouble("valueToSum");
        if (value != null) logger.logEvent(name, value, params);
        else logger.logEvent(name, params);
        call.resolve();
    }

    @PluginMethod
    public void logPurchase(PluginCall call) {
        if (!enabled()) { call.resolve(); return; }
        Double amount = call.getDouble("amount");
        if (amount == null) {
            call.reject("Purchase amount is missing.");
            return;
        }
        String currency = call.getString("currency", "INR");
        logger.logPurchase(
            BigDecimal.valueOf(amount), Currency.getInstance(currency), toBundle(call.getObject("params")));
        // The one event worth not losing if the app is closed straight
        // after the confirmation screen.
        logger.flush();
        call.resolve();
    }

    /** Only strings and numbers cross over — all App Events parameters
     *  accept, and all lib/meta-events.ts sends. */
    private static Bundle toBundle(JSObject object) {
        Bundle out = new Bundle();
        if (object == null) return out;
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object v = object.opt(key);
            if (v instanceof String) out.putString(key, (String) v);
            else if (v instanceof Integer || v instanceof Long) out.putLong(key, ((Number) v).longValue());
            else if (v instanceof Number) out.putDouble(key, ((Number) v).doubleValue());
        }
        return out;
    }
}
