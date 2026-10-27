"use client";

import Link from "next/link";
import { ageLimitLabel, type CommunityService } from "@/lib/community";
import { CalendarIcon, PinIcon } from "@/app/icons";

export default function CommunityList({ services }: { services: CommunityService[] }) {
  if (services.length === 0) {
    return (
      <p className="mt-10 text-center text-[13.5px] text-muted">
        Nothing coming up on this island yet. Check back soon.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:grid lg:grid-cols-2 lg:gap-5">
      {services.map((s) => {
        const ages = ageLimitLabel(s);
        return (
          <li key={s.slug}>
            <Link
              href={`/community/${s.slug}`}
              className="card-hover block overflow-hidden rounded-panel border border-line bg-surface transition active:scale-[0.985] lg:h-full lg:active:scale-100"
            >
              <div className="flex gap-3 p-4">
                <div className="font-display flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-brandsoft text-[17px] font-bold text-brand">
                  {s.mark}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[16px] leading-tight font-bold">{s.name}</p>
                    <span className="shrink-0 rounded-full bg-brandsoft px-2.5 py-1 text-[11px] font-bold text-brand">
                      Free
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] font-semibold text-brand">{s.organizerName}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] font-medium text-muted">{s.about}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline px-4 py-3 text-[12px] font-semibold text-muted">
                <span className="flex items-center gap-1.5">
                  <CalendarIcon size={14} className="shrink-0" />
                  {s.dayLabel} {s.dayNum} · {s.timeLabel}
                  {s.endTimeLabel && `–${s.endTimeLabel}`}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <PinIcon size={14} className="shrink-0" />
                  <span className="truncate">{s.meetingPoint}</span>
                </span>
                {ages && <span className="text-brand">{ages}</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
