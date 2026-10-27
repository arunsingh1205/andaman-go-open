"use client";

// One position lookup — native GPS on native platforms, the browser's own
// navigator.geolocation on plain web. These have to stay separate: a
// WKWebView's navigator.geolocation, without @capacitor/geolocation bridging
// it to CoreLocation, only ever gets WebKit's own website-style "Allow Once"
// permission — ephemeral, asked again on every fresh app open — instead of
// the persistent "while using the app" grant a native app is supposed to
// get exactly once. That's what made location permission look like it was
// asking twice: once for the island-detection bootstrap and again later for
// a cab pickup pin, both on the web-style ephemeral grant. The plugin gives
// native platforms the real, persistent OS permission (asked once, shown in
// iOS Settings > Privacy > Location Services like any other app); plain web
// keeps using navigator.geolocation, which is the correct and only option
// there.
export async function currentPosition(
  opts: { timeoutMs?: number; enableHighAccuracy?: boolean } = {},
): Promise<{ latitude: number; longitude: number } | null> {
  const { timeoutMs = 10_000, enableHighAccuracy = false } = opts;
  const { Capacitor } = await import("@capacitor/core");

  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    try {
      const pos = await Geolocation.getCurrentPosition({ timeout: timeoutMs, enableHighAccuracy });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      return null;
    }
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: timeoutMs, enableHighAccuracy },
    );
  });
}
