// The JS half of the Android chrome-state channel — see
// android-app/app/src/main/java/com/andamango/app/NativeChromePlugin.java
// for the native side, and ios-app/App/App/AppRootViewController.swift's
// WKScriptMessageHandler "nativeChrome" channel for the iOS twin of this
// same {tabBar, back, path} contract.
//
// Importing this file is always safe (registerPlugin itself never throws),
// but calling NativeChrome.setState() is NOT safe unguarded — Capacitor's
// web/other-platform proxy throws "plugin is not implemented" the moment a
// method is actually invoked with no matching native implementation. The
// caller (app/native-bridge.tsx) must only call setState() once it has
// confirmed Capacitor.getPlatform() === "android".

import { registerPlugin } from "@capacitor/core";

export type NativeChromeState = { tabBar: boolean; back: boolean; path: string };

interface NativeChromePlugin {
  setState(state: NativeChromeState): Promise<void>;
}

export const NativeChrome = registerPlugin<NativeChromePlugin>("NativeChrome");
