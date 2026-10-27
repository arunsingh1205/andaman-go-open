"use client";

// The "Coming up" card on the home screen — the one thing here that's about
// this specific traveller, so it's fetched client-side with the authed browser
// client rather than on the server (lib/bookings.ts still reads the sessionless
// catalogue client). Renders nothing until there's a real upcoming booking.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  BedIcon,
  CarIcon,
  CheckIcon,
  ClockIcon,
  DiveIcon,
  FerryIcon,
  MusicIcon,
  ScooterIcon,
  SunSeaIcon,
} from "./icons";

type Next = {
  title: string;
  operator: string;
  startsAt: string;
  party: number;
  units: number;
  state: string;
  kind: string;
};

const KIND_ICON: Record<string, (p: { size?: number }) => React.JSX.Element> = {
  activity: DiveIcon,
  ferry: FerryIcon,
  stay: BedIcon,
  event: MusicIcon,
  cab: CarIcon,
  trip: SunSeaIcon,
  rental: ScooterIcon,
};

const IST = "Asia/Kolkata";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const key = dayKey(d);

  const day =
    key === today
      ? "Today"
      : key === tomorrow
        ? "Tomorrow"
        : d.toLocaleDateString("en-US", { timeZone: IST, weekday: "long", day: "numeric", month: "short" });

  const time = d.toLocaleTimeString("en-US", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${day} · ${time}`;
}

export default function HomeNextBooking() {
  const [next, setNext] = useState<Next | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await supabaseBrowser
        .from("my_bookings")
        .select("title, operator, starts_at, party, units, state, kind")
        .in("state", ["pending", "confirmed"])
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(1);

      const row = data?.[0];
      if (live && row) {
        setNext({
          title: row.title ?? "Booking",
          operator: row.operator ?? "",
          startsAt: row.starts_at,
          party: row.party ?? 1,
          units: row.units ?? 1,
          state: row.state,
          kind: row.kind,
        });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!next) return null;

  const Icon = KIND_ICON[next.kind] ?? DiveIcon;
  const confirmed = next.state === "confirmed";
  const guests =
    next.kind === "stay"
      ? `${next.units} ${next.units === 1 ? "night" : "nights"} · ${next.party} ${next.party === 1 ? "guest" : "guests"}`
      : `${next.party} ${next.party === 1 ? "guest" : "guests"}`;

  return (
    <>
      <h3 className="mt-7 text-[12px] font-bold tracking-wider text-muted uppercase lg:mt-5">
        Coming up
      </h3>

      <Link
        href="/bookings"
        className="card-hover mt-2.5 block rounded-card border border-line bg-surface p-4 transition active:scale-[0.985] lg:active:scale-100"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
            <Icon size={22} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold">{next.title}</p>
            <p className="mt-0.5 text-[12.5px] font-medium text-muted">
              {whenLabel(next.startsAt)} · {guests}
            </p>
          </div>
        </div>

        <div className="mt-3.5 flex items-center gap-2 border-t border-hairline pt-3">
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold ${
              confirmed ? "bg-brandsoft text-brand" : "bg-sandsoft text-sandink2"
            }`}
          >
            {confirmed ? <CheckIcon size={13} /> : <ClockIcon size={13} />}
            {confirmed ? "Confirmed" : "Awaiting confirmation"}
          </span>
          {next.operator && (
            <span className="truncate text-[11.5px] font-medium text-muted">{next.operator}</span>
          )}
        </div>
      </Link>
    </>
  );
}
