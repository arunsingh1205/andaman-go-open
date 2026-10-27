"use client";

// The JS half of capacitor-plugins/meta-app-events — Meta's App Events SDK,
// used instead of the web pixel when the traveller app is the one running.
// Registered here rather than in the plugin package, same as
// lib/razorpay-native.ts: the package ships only native code.
//
// Every method resolves harmlessly when the SDK isn't configured (the
// Partner app, or the customer app before its Meta App ID is filled in), so
// callers don't need to check isEnabled() first.

import { registerPlugin } from "@capacitor/core";

export type TrackingStatus =
  | "authorized"
  | "denied"
  | "restricted"
  | "notDetermined"
  | "unknown"
  | "disabled";

type Params = Record<string, string | number>;

export type MetaAppEventsPlugin = {
  isEnabled(): Promise<{ enabled: boolean }>;
  /** iOS: Apple's tracking prompt, shown once ever. Android: resolves at once. */
  requestTracking(): Promise<{ status: TrackingStatus }>;
  logEvent(options: { name: string; valueToSum?: number; params?: Params }): Promise<void>;
  logPurchase(options: { amount: number; currency: string; params?: Params }): Promise<void>;
};

export const MetaAppEvents = registerPlugin<MetaAppEventsPlugin>("MetaAppEvents");
