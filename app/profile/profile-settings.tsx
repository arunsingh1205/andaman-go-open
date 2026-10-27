"use client";

// Notification toggles. There is no traveller-preferences table yet (only
// partner_notification_prefs), so these persist to localStorage — enough that
// they don't reset on every navigation, honest that they're device-local.

import { useMemo, useSyncExternalStore } from "react";

const PREFS = [
  { id: "updates", label: "Booking updates", sub: "Confirmations, changes, reminders" },
  { id: "weather", label: "Weather alerts", sub: "Rough seas, ferry cancellations" },
  { id: "offers", label: "Offers & promotions", sub: "Bundle deals, seasonal discounts" },
];

const STORAGE_KEY = "notif-prefs";
const CHANGE_EVENT = "notif-prefs-change";
const DEFAULTS: Record<string, boolean> = { updates: true, weather: true, offers: false };

function usePrefs(): Record<string, boolean> {
  const raw = useSyncExternalStore(
    (cb) => {
      window.addEventListener(CHANGE_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(CHANGE_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(STORAGE_KEY) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );

  return useMemo(() => {
    try {
      return { ...DEFAULTS, ...(JSON.parse(raw || "{}") as Record<string, boolean>) };
    } catch {
      return DEFAULTS;
    }
  }, [raw]);
}

export default function ProfileSettings() {
  const on = usePrefs();

  const toggle = (id: string) => {
    const next = { ...on, [id]: !on[id] };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // private window / blocked storage — nothing we can do
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <>
      <div className="mt-3 flex flex-col gap-2.5">
        {PREFS.map((p) => {
          const checked = on[p.id];
          return (
            <button
              key={p.id}
              type="button"
              role="switch"
              aria-checked={checked}
              onClick={() => toggle(p.id)}
              className="flex w-full items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold">{p.label}</span>
                <span className="mt-0.5 block text-[12px] font-medium text-muted">{p.sub}</span>
              </span>
              <span
                aria-hidden="true"
                className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                  checked ? "bg-brand" : "bg-line"
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    checked ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] font-medium text-muted">Saved on this device.</p>
    </>
  );
}
