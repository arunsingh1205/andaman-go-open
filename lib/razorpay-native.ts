"use client";

// The JS half of capacitor-plugins/razorpay-native — Razorpay's native iOS
// checkout, used instead of the web modal when the app is the one asking.
//
// registerPlugin() is called here rather than in the plugin package, so the
// package itself ships only Swift and a Package.swift. There is no JS to
// build, publish or keep in step; `npx cap sync ios` reads its package.json
// for the native source and that is the whole contract.
//
// On the web this resolves to a proxy with no implementation, which is why
// every caller checks Capacitor.isNativePlatform() first — see
// lib/razorpay-client.ts.

import { registerPlugin } from "@capacitor/core";

/**
 * What the Swift side hands back. Only the payment id is promised: some SDK
 * builds call the short delegate method, which carries nothing else. That is
 * enough, because the server confirms the order with Razorpay directly rather
 * than trusting a signature carried back through the app.
 */
export type NativeCheckoutResult = {
  paymentId: string;
  orderId?: string;
  signature?: string;
};

export type RazorpayNativePlugin = {
  /**
   * Opens the native sheet. `optionsJson` is the checkout payload as JSON
   * text, not an object: the payload is open-ended (prefill, theme, notes,
   * method toggles) and handing Swift one string to JSONSerialization is
   * sturdier than converting arbitrary nested JSValues by hand.
   *
   * Rejects with a message fit to show a traveller — "Payment cancelled." if
   * they dismissed the sheet, the gateway's own reason otherwise.
   */
  open(options: { key: string; optionsJson: string }): Promise<NativeCheckoutResult>;

  /**
   * Gives up on the in-flight `open` call and dismisses whatever Razorpay
   * presented. For when the checkout screen has gone unresponsive — its own
   * WKWebView can freeze after the OS recycles its content process during
   * the UPI app-switch, with no callback ever following — and the caller
   * has already found the answer some other way (lib/razorpay-client.ts
   * asks the server, which asks Razorpay directly). Always resolves; there
   * is nothing left to fail once the screen is gone.
   */
  abandon(): Promise<void>;
};

export const RazorpayNative = registerPlugin<RazorpayNativePlugin>("RazorpayNative");
