// Meta events for the booking funnel. Two routes, never both for one event:
//
// - Website: the Meta Pixel (loaded by app/meta-pixel.tsx).
// - Native app: Meta's App Events SDK (capacitor-plugins/meta-app-events).
//   The pixel is deliberately not loaded inside the app, so a booking made
//   in the app is counted once, as an app event — which is what lets an
//   app-install ad get credit for it.
//
// The pixel script loads after the page is interactive, so an event fired
// from an early effect can find window.fbq not defined yet — wait for it
// briefly rather than lose the event. Staff screens never load the pixel, so
// there the wait just runs out and nothing is sent.

type Fbq = (...args: unknown[]) => void;
type MetaEvent = "ViewContent" | "InitiateCheckout" | "Purchase" | "Lead";

/** True inside an app build that has the MetaAppEvents plugin — the same
 *  test the pixel snippet uses to stay out. An older install without the
 *  plugin answers false and keeps using the pixel, so it never goes dark.
 *  Capacitor's bridge is injected before any page script runs. */
export function usesAppEvents(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; isPluginAvailable?: (name: string) => boolean };
    }
  ).Capacitor;
  return cap?.isNativePlatform?.() === true && cap.isPluginAvailable?.("MetaAppEvents") === true;
}

export function trackMeta(
  event: MetaEvent,
  params: Record<string, unknown> = {},
  eventId?: string,
): void {
  if (typeof window === "undefined") return;
  if (usesAppEvents()) {
    void trackAppEvent(event, params, eventId);
    return;
  }
  let tries = 0;
  const send = () => {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq;
    if (fbq) {
      if (eventId) fbq("track", event, params, { eventID: eventId });
      else fbq("track", event, params);
      return;
    }
    if (++tries < 20) setTimeout(send, 500);
  };
  send();
}

// Web pixel names → App Events names and parameters. The app-side names are
// Meta's standard mobile events, so they line up with the standard events
// an app-install campaign can optimise for. Lead has no mobile standard
// equivalent, so it goes as a custom event of the same name.
async function trackAppEvent(
  event: MetaEvent,
  params: Record<string, unknown>,
  eventId?: string,
): Promise<void> {
  try {
    const { MetaAppEvents } = await import("./meta-app-events");
    const p: Record<string, string | number> = {};
    if (typeof params.content_type === "string") p.fb_content_type = params.content_type;
    if (Array.isArray(params.content_ids)) p.fb_content_id = JSON.stringify(params.content_ids);
    if (typeof params.currency === "string") p.fb_currency = params.currency;
    if (eventId) p.fb_order_id = eventId;
    const value = typeof params.value === "number" ? params.value : undefined;

    switch (event) {
      case "Purchase":
        if (value === undefined) return;
        await MetaAppEvents.logPurchase({
          amount: value,
          currency: typeof params.currency === "string" ? params.currency : "INR",
          params: p,
        });
        return;
      case "ViewContent":
        await MetaAppEvents.logEvent({ name: "fb_mobile_content_view", valueToSum: value, params: p });
        return;
      case "InitiateCheckout":
        await MetaAppEvents.logEvent({ name: "fb_mobile_initiated_checkout", valueToSum: value, params: p });
        return;
      case "Lead":
        await MetaAppEvents.logEvent({ name: "Lead", params: p });
        return;
    }
  } catch {
    // Analytics must never break a booking.
  }
}
