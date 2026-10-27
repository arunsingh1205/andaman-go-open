package com.andamango.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The JS -> native half of the chrome-state channel app/native-bridge.tsx
 * drives (see lib/native-chrome.ts for the JS side). Mirrors what the
 * WKScriptMessageHandler "nativeChrome" channel does on iOS
 * (AppRootViewController.swift) — same {tabBar, back, path} payload, same
 * "posted on mount and on every DOM change" cadence — just via a Capacitor
 * plugin call instead of a raw WebView message handler, since a plugin is
 * already the one native-bridging pattern proven in this repo
 * (RazorpayNative) rather than a second, lower-level mechanism.
 *
 * App-local rather than a published plugin package, same as this app's own
 * MainActivity — this is chrome specific to the traveller app's own native
 * shell, not a reusable cross-app capability.
 */
@CapacitorPlugin(name = "NativeChrome")
public class NativeChromePlugin extends Plugin {
    @PluginMethod
    public void setState(PluginCall call) {
        boolean tabBar = call.getBoolean("tabBar", false);
        boolean back = call.getBoolean("back", false);
        String path = call.getString("path", "");

        MainActivity activity = (MainActivity) getActivity();
        activity.runOnUiThread(() -> activity.setNativeChromeState(tabBar, back, path));

        call.resolve();
    }
}
