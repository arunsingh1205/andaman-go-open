"use client";

// Saves the next few days of tickets onto the phone, so they can be shown at
// a jetty with no signal.
//
// Why this needs native storage rather than localStorage: capacitor.config.ts
// points server.url at the live site, so the WebView is a browser tab on
// https://www.andamango.in. When that server can't be reached, Capacitor falls
// back to the bundled page at capacitor/www/index.html, which runs on a
// different origin (capacitor://localhost on iOS) — and localStorage is
// per-origin, so nothing the live site wrote would be readable there.
// @capacitor/preferences writes to native storage (UserDefaults on iOS,
// SharedPreferences on Android), which both origins reach through the plugin
// bridge. That bundled page is the offline ticket screen; this component is
// what fills it.
//
// It also answers App Store Review Guideline 4.2: an app that keeps your
// tickets working without a network is doing something a bookmark can't.
//
// A no-op in a normal browser tab — Capacitor.isNativePlatform() is false
// there — so /bookings on the web is unaffected.

import { useEffect } from "react";
import type { BookingDay } from "@/lib/bookings";
import type { QrCode } from "@/lib/qr";

/** Shared with capacitor/www/index.html — change both together. */
export const OFFLINE_TICKETS_KEY = "andamango.offline-tickets";
export const OFFLINE_ORIGIN_KEY = "andamango.server-url";

/** How many upcoming days to keep. Native key/value stores are not a place
 *  for unbounded data, and nobody needs last March's ferry offline. */
const MAX_DAYS = 10;

type StoredItem = {
  title: string;
  operator: string;
  timeLabel: string;
  detail: string;
  qr: QrCode;
};

type StoredDay = {
  label: string;
  dateLabel: string;
  place: string;
  refCode: string;
  items: StoredItem[];
};

export type OfflineSnapshot = {
  savedAt: string;
  days: StoredDay[];
};

export default function OfflineTickets({
  days,
  tickets,
}: {
  days: BookingDay[];
  tickets: Record<string, QrCode>;
}) {
  useEffect(() => {
    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const { Preferences } = await import("@capacitor/preferences");

      const stored: StoredDay[] = days
        .filter((d) => d.when === "upcoming")
        .slice(0, MAX_DAYS)
        .map((d) => ({
          label: d.label,
          dateLabel: d.dateLabel,
          place: d.place,
          refCode: d.refCode,
          items: d.items
            // Only a ticketed item is worth saving — the QR is the whole point.
            .filter((i) => i.ticket && tickets[i.id])
            .map((i) => ({
              title: i.title,
              operator: i.operator,
              timeLabel: i.timeLabel,
              detail: i.detail,
              qr: tickets[i.id],
            })),
        }))
        .filter((d) => d.items.length > 0);

      const snapshot: OfflineSnapshot = {
        savedAt: new Date().toISOString(),
        days: stored,
      };

      try {
        // The origin too, so the offline screen's "Try again" button knows
        // where to send the WebView back to. It is baked into the native
        // project at `cap sync` time and the bundled page can't see it.
        await Preferences.set({ key: OFFLINE_ORIGIN_KEY, value: window.location.origin });
        await Preferences.set({ key: OFFLINE_TICKETS_KEY, value: JSON.stringify(snapshot) });
      } catch (err) {
        // Storage full or plugin missing — the online screen is unaffected,
        // so there's nothing to tell the person about.
        console.warn("Couldn't save tickets for offline use:", err);
      }
    })();
  }, [days, tickets]);

  return null;
}
