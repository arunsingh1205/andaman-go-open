import { rupees } from "@/lib/activities";
import type { Delta, PartnerInsights } from "@/lib/partner-insights";
import { ACCENT_CHIP, IconChip } from "../stat-tile";
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  EarningsIcon,
  GraphIcon,
  StormIcon,
  TicketIcon,
} from "@/app/icons";

function deltaPct(d: Delta): number | null {
  if (d.prev === 0) return d.now === 0 ? 0 : null;
  return Math.round(((d.now - d.prev) / d.prev) * 100);
}

function DeltaTile({
  label,
  value,
  delta,
  vsLabel,
  accent,
  Icon,
}: {
  label: string;
  value: string;
  delta: Delta;
  vsLabel: string;
  accent: keyof typeof ACCENT_CHIP;
  Icon: typeof CheckIcon;
}) {
  const p = deltaPct(delta);
  const up = p !== null && p > 0;
  const down = p !== null && p < 0;

  return (
    <div className="rounded-[24px] border border-line bg-surface p-5 shadow-none desk:rounded-2xl desk:p-4 desk:shadow-sm">
      <IconChip accent={accent} Icon={Icon} />
      <p className="text-[11px] font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className="font-display mt-1.5 text-[26px] leading-none font-bold text-brand desk:text-[22px]">
        {value}
      </p>
      <p
        className={`mt-1.5 text-[11px] font-bold ${
          up ? "text-brand" : down ? "text-warn" : "text-muted"
        }`}
      >
        {p === null
          ? `Nothing in ${vsLabel}`
          : `${up ? "▲" : down ? "▼" : "="} ${Math.abs(p)}% vs ${vsLabel}`}
      </p>
    </div>
  );
}

function RateTile({
  label,
  value,
  hint,
  accent,
  Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: keyof typeof ACCENT_CHIP;
  Icon: typeof CheckIcon;
}) {
  return (
    <div className="rounded-[24px] border border-line bg-surface p-5 shadow-none desk:rounded-2xl desk:p-4 desk:shadow-sm">
      <IconChip accent={accent} Icon={Icon} />
      <p className="text-[11px] font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className="font-display mt-1.5 text-[26px] leading-none font-bold desk:text-[22px]">{value}</p>
      {hint && <p className="mt-1.5 text-[11px] font-medium text-muted">{hint}</p>}
    </div>
  );
}

export default function InsightsView({ insights }: { insights: PartnerInsights }) {
  const i = insights;
  const vs = i.lastMonthLabel;

  return (
    <>
      <h3 className="mt-6 text-[13.5px] font-bold">{i.thisMonthLabel} so far</h3>
      <div className="mt-2 grid grid-cols-2 gap-2.5 tablet:grid-cols-4 desk:grid-cols-4 desk:gap-4">
        <DeltaTile
          label="Bookings made"
          value={String(i.bookingsMade.now)}
          delta={i.bookingsMade}
          vsLabel={vs}
          accent="teal"
          Icon={TicketIcon}
        />
        <DeltaTile
          label="Booked value"
          value={rupees(i.grossPaise.now)}
          delta={i.grossPaise}
          vsLabel={vs}
          accent="orange"
          Icon={EarningsIcon}
        />
        <DeltaTile
          label="Checked in"
          value={String(i.checkedIn.now)}
          delta={i.checkedIn}
          vsLabel={vs}
          accent="purple"
          Icon={CheckIcon}
        />
        <DeltaTile
          label="Net earned"
          value={rupees(i.netPaise.now)}
          delta={i.netPaise}
          vsLabel={vs}
          accent="coral"
          Icon={GraphIcon}
        />
      </div>

      <h3 className="mt-7 text-[13.5px] font-bold">All time</h3>
      <div className="mt-2 grid grid-cols-2 gap-2.5 tablet:grid-cols-4 desk:grid-cols-4 desk:gap-4">
        <RateTile
          label="Fell through"
          value={i.fellThroughPct === null ? "—" : `${i.fellThroughPct}%`}
          hint="cancelled, declined or weather"
          accent="teal"
          Icon={StormIcon}
        />
        <RateTile
          label="No-shows"
          value={i.noShowPct === null ? "—" : `${i.noShowPct}%`}
          hint="of checked-in bookings"
          accent="orange"
          Icon={AlertIcon}
        />
        <RateTile
          label="Booked ahead"
          value={i.medianLeadDays === null ? "—" : `${i.medianLeadDays}d`}
          hint="typical, before the date"
          accent="purple"
          Icon={CalendarIcon}
        />
        <RateTile
          label="You confirm in"
          value={
            i.medianAcceptMins === null
              ? "—"
              : i.medianAcceptMins < 90
                ? `${i.medianAcceptMins}m`
                : `${Math.round(i.medianAcceptMins / 60)}h`
          }
          hint="typical, after a request"
          accent="coral"
          Icon={ClockIcon}
        />
      </div>

      {i.busiestWeekday && (
        <p className="mt-4 text-[12.5px] font-medium text-muted">
          Your busiest day is <span className="font-bold text-ink">{i.busiestWeekday}</span>.
        </p>
      )}

      <h3 className="mt-7 text-[13.5px] font-bold">By listing · last 30 days</h3>
      {i.listings.length === 0 ? (
        <p className="mt-2 text-[12.5px] font-medium text-muted">
          Nothing to show yet — this fills in as travellers view and book your listings.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {i.listings.map((l) => (
            <li
              key={l.subjectId}
              className="rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-[13px] font-bold">{l.title}</p>
                <p className="shrink-0 text-[12.5px] font-bold text-brand">
                  {l.conversionPct === null ? "—" : `${l.conversionPct}%`}
                </p>
              </div>
              <p className="mt-1 text-[11px] font-medium text-muted">
                {l.kindLabel} · {l.views30d} view{l.views30d === 1 ? "" : "s"} · {l.bookings30d}{" "}
                booking{l.bookings30d === 1 ? "" : "s"}
                {l.conversionPct !== null && " · viewed → booked"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
