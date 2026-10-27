// Which night of a recurring event (157) the detail page is showing —
// plain links, not client state, since picking a different date means a
// genuinely different EventItem (its own seatsLeft/startsAt) that only the
// server read knows how to resolve. Server-rendered on purpose: nothing
// here needs a hook.

import Link from "next/link";
import type { EventItem } from "@/lib/events";

export default function EventDateChips({
  slug,
  occurrences,
  selectedDayKey,
}: {
  slug: string;
  occurrences: EventItem[];
  selectedDayKey: string;
}) {
  if (occurrences.length <= 1) return null;

  return (
    <div className="mt-4">
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Pick a night</p>
      <div className="no-bar mt-2 flex gap-2 overflow-x-auto pb-1">
        {occurrences.map((o) => {
          const on = o.dayKey === selectedDayKey;
          return (
            <Link
              key={o.dayKey}
              href={`/events/${slug}?date=${o.dayKey}`}
              scroll={false}
              className={`flex h-14 shrink-0 flex-col items-center justify-center rounded-xl border px-3.5 text-center ${
                on ? "border-brand bg-brand text-white" : "border-line bg-surface"
              }`}
            >
              <span className="text-[10px] font-bold tracking-wide uppercase opacity-70">
                {o.dayLabel}
              </span>
              <span className="mt-0.5 text-[13.5px] font-bold">{o.dayNum}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
