package com.andamango.app;

import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

import com.andamango.razorpaynative.RazorpayNativePlugin;
import com.razorpay.ExternalWalletListener;
import com.razorpay.PaymentData;
import com.razorpay.PaymentResultWithDataListener;

/**
 * The customer app's root Activity. Used to be a bare
 * `extends BridgeActivity {}` — this is the Android counterpart of
 * ios-app/App/App/AppRootViewController.swift, minus its floating back
 * button: a floating native tab bar on top of the one persistent WebView,
 * driven by the same event-shaped contract app/native-bridge.tsx already
 * speaks (see NativeChromePlugin and lib/native-chrome.ts).
 *
 * There used to be a floating back button here too, mirroring iOS's. Real-
 * device testing found it sitting on top of page header content no matter
 * how the reserved-space math was tuned - a translucent circle over a
 * title reads as a bug, not glass, without iOS's frame-pinning
 * (AppRootViewController.swift) to keep it off the WebView's content
 * entirely (@capawesome/capacitor-android-edge-to-edge-support actively
 * keeps this app's own WebView genuinely edge-to-edge, so Android has no
 * equivalent to pin against). Android now uses the web's own back element
 * instead (app/page-back.tsx) - app/globals.css only hides that element
 * for iOS.
 *
 * Also implements PaymentResultWithDataListener/ExternalWalletListener —
 * required by Razorpay's own Android SDK, which casts whichever Activity
 * was passed to Checkout.open() directly to these interfaces and calls
 * back on *it*, not on the plugin object that opened the checkout (see
 * capacitor-plugins/razorpay-native/android's own RazorpayNativePlugin.java
 * for the full reasoning — confirmed against Razorpay's own official
 * sample app and Flutter plugin source, not assumed). Both callbacks just
 * forward to whichever RazorpayNativePlugin instance the Bridge already
 * holds; this Activity has no payment logic of its own.
 */
public class MainActivity extends BridgeActivity implements PaymentResultWithDataListener, ExternalWalletListener {
    private static final String[] TAB_HREFS = { "/explore", "/bookings", "/help", "/profile" };
    private int[] tabContainerIds;
    private int[] tabIconIds;
    private int[] tabLabelIds;

    private View tabBarCapsule;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate() — that's what actually
        // creates the Bridge and inflates the WebView, and a plugin has to
        // be known to the bridge builder before that happens.
        registerPlugin(NativeChromePlugin.class);
        super.onCreate(savedInstanceState);

        tabContainerIds = new int[] { R.id.tab_home, R.id.tab_bookings, R.id.tab_help, R.id.tab_profile };
        tabIconIds = new int[] { R.id.tab_home_icon, R.id.tab_bookings_icon, R.id.tab_help_icon, R.id.tab_profile_icon };
        tabLabelIds = new int[] { R.id.tab_home_label, R.id.tab_bookings_label, R.id.tab_help_label, R.id.tab_profile_label };

        tabBarCapsule = findViewById(R.id.native_tab_bar_capsule);

        for (int i = 0; i < TAB_HREFS.length; i++) {
            String href = TAB_HREFS[i];
            View item = findViewById(tabContainerIds[i]);
            item.setOnClickListener(v -> navigate(href));
        }

        applyInsets();
        installChromeHideScript();
    }

    /** Android analog of iOS's userContentController(_:didReceive:) handler
     *  for the "nativeChrome" channel — called from
     *  NativeChromePlugin.setState() on the UI thread. Takes "back" as a
     *  parameter (unused here) rather than dropping it from the plugin call
     *  itself, since iOS's own nativeChrome channel still needs it and both
     *  platforms are driven from the same postChromeState() call in
     *  app/native-bridge.tsx. */
    void setNativeChromeState(boolean tabBar, boolean back, String path) {
        tabBarCapsule.setVisibility(tabBar ? View.VISIBLE : View.GONE);

        for (int i = 0; i < TAB_HREFS.length; i++) {
            boolean selected = TAB_HREFS[i].equals(path);
            ImageView icon = findViewById(tabIconIds[i]);
            TextView label = findViewById(tabLabelIds[i]);
            int color = ContextCompat.getColor(this, selected ? R.color.brand : R.color.ink_55pct);
            icon.setColorFilter(color);
            label.setTextColor(color);
            label.setTypeface(null, selected ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
            View item = findViewById(tabContainerIds[i]);
            item.setBackgroundResource(selected ? R.drawable.active_tab_pill_bg : 0);
        }
    }

    /** Native -> JS: a tab tap. Mirrors iOS's bridgeViewController.bridge?.eval(js:)
     *  exactly — same event name, same detail shape — so
     *  app/native-bridge.tsx's existing listener needs no Android-specific
     *  branch for this direction. */
    private void navigate(String href) {
        Bridge b = getBridge();
        if (b == null || b.getWebView() == null) return;
        String js = "window.dispatchEvent(new CustomEvent('native-tab-navigate',{detail:{href:'" + href + "'}}))";
        b.getWebView().evaluateJavascript(js, null);
    }

    /** Margins the tab bar off the gesture-nav strip — the Android analog
     *  of iOS's safeAreaLayoutGuide anchors. The WebView itself needs no
     *  equivalent adjustment (see class comment). */
    private void applyInsets() {
        View root = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());

            ViewGroup.MarginLayoutParams tabParams = (ViewGroup.MarginLayoutParams) tabBarCapsule.getLayoutParams();
            tabParams.bottomMargin = dp(16) + bars.bottom;
            tabBarCapsule.setLayoutParams(tabParams);

            return insets;
        });
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    /** Hides the web's own .glass-nav / [data-page-back] before first paint,
     *  the same job a WKUserScript injected atDocumentStart does on iOS
     *  (see AppRootViewController.swift) — without it, the web chrome
     *  flashes for a frame before app/native-bridge.tsx's own effect gets a
     *  chance to hide it via the :root[data-native-chrome] CSS rule.
     *  Feature-checked: unsupported on old on-device WebView builds, which
     *  just means that one frame of flash isn't prevented there — never a
     *  functional break either way. */
    private void installChromeHideScript() {
        Bridge b = getBridge();
        if (b == null || b.getWebView() == null) return;
        WebView webView = b.getWebView();

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                "document.documentElement.dataset.nativeChrome = '1';",
                java.util.Collections.singleton("*")
            );
        }
    }

    /** The instance registerPlugin(NativeChromePlugin.class)-style
     *  registration produced, looked up by the same name RazorpayNativePlugin
     *  declares via @CapacitorPlugin(name = "RazorpayNative") — confirmed
     *  against Capacitor's own Bridge.java source (pluginId() resolves to
     *  that annotation's name; getPlugin(id).getInstance() is the documented
     *  way to retrieve it). Null only if the bridge hasn't finished
     *  initializing yet, which can't happen by the time Razorpay's SDK is
     *  calling back — a checkout can't be open without open() having already
     *  run on this same plugin instance. */
    private RazorpayNativePlugin razorpayPlugin() {
        Bridge b = getBridge();
        if (b == null) return null;
        PluginHandle handle = b.getPlugin("RazorpayNative");
        if (handle == null) return null;
        Plugin instance = handle.getInstance();
        return (instance instanceof RazorpayNativePlugin) ? (RazorpayNativePlugin) instance : null;
    }

    @Override
    public void onPaymentSuccess(String razorpayPaymentId, PaymentData data) {
        RazorpayNativePlugin plugin = razorpayPlugin();
        if (plugin != null) plugin.handlePaymentSuccess(razorpayPaymentId, data);
    }

    @Override
    public void onPaymentError(int code, String description, PaymentData data) {
        RazorpayNativePlugin plugin = razorpayPlugin();
        if (plugin != null) plugin.handlePaymentError(code, description, data);
    }

    /** Not used for anything today — Razorpay's SDK requires the Activity to
     *  implement this alongside PaymentResultWithDataListener regardless
     *  (confirmed against their own official sample app, which implements
     *  both even though its own onExternalWalletSelected only logs). A
     *  traveller picking an external wallet still resolves through the
     *  normal onPaymentSuccess/onPaymentError flow once that wallet's own
     *  flow finishes, so there's nothing this needs to forward. */
    @Override
    public void onExternalWalletSelected(String walletName, PaymentData data) {}
}
