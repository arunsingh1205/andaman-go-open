"use client";

// The console's shared vocabulary.
//
// Five screens that each invented their own idea of a page header, a stat
// tile and a table row would drift apart within a week — the old two-screen
// admin app was already halfway there, with the Partners and Listings tabs
// carrying near-identical copies of the same tab-button and reject-box code.
// Everything either screen would otherwise copy lives here once.
//
// The list primitives (Row/Cell) are a CSS grid rather than a <table>. A
// real table is the right element for tabular data, but it cannot reflow
// into stacked cards on a phone without duplicating the markup twice over.
// A grid row collapses to a block at small widths with the same DOM, which
// keeps one source of truth for what a row contains — the same
// "one codebase, responsive" call the partner app made.

import { ChevronIcon } from "@/app/icons";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] leading-tight font-bold tracking-tight md:text-[26px]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-[13px] font-medium text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A bordered white block — the console's one container shape. Same
 *  rounded-panel token the booking panels and popovers use elsewhere in the
 *  app, so this console reads as the same product instead of a separate,
 *  flatter tool bolted on beside it. */
export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-panel border border-line bg-surface ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
          {title && <h2 className="text-[13px] font-bold tracking-wide uppercase">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 py-10 text-center text-[13px] font-medium text-muted">{children}</p>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

// rupees() lives in ./admin-format now — this file is "use client", so a
// server component couldn't call it directly. Re-exported so the client
// views that already import it from here don't need to change.
export { rupees } from "./admin-format";

export function StatTile({
  label,
  value,
  hint,
  tone = "plain",
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "plain" | "attention" | "brand";
  href?: string;
}) {
  const toneClass =
    tone === "attention"
      ? "border-sandline bg-sandsoft"
      : tone === "brand"
        ? "border-brandsoft bg-brandsoft"
        : "border-line bg-surface";

  const body = (
    <>
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">{label}</p>
      <p
        className={`font-display mt-1.5 text-[28px] leading-none font-bold tracking-tight ${
          tone === "attention" ? "text-sandink" : tone === "brand" ? "text-brand" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11.5px] font-medium text-muted">{hint}</p>}
    </>
  );

  const shell = `block rounded-card border p-4 ${toneClass}`;

  if (href) {
    return (
      <Link href={href} className={`${shell} card-hover`}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type PillTone = "live" | "waiting" | "down" | "muted" | "done";

const PILL: Record<PillTone, string> = {
  live: "bg-brandsoft text-brand",
  waiting: "bg-sandsoft text-sandink2",
  down: "bg-[#FBE7DC] text-warn",
  done: "bg-brand text-white",
  muted: "bg-ground text-muted",
};

export function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${PILL[tone]}`}
    >
      {children}
    </span>
  );
}

/** partners.status -> a pill. One mapping, so five screens agree on colour.
 *  Call it from client components; a server component renders <PartnerStatusPill>
 *  instead, since it can't call a function out of a "use client" module. */
export function partnerStatusPill(status: string) {
  if (status === "approved") return <Pill tone="live">Live</Pill>;
  if (status === "pending") return <Pill tone="waiting">Waiting</Pill>;
  if (status === "suspended") return <Pill tone="down">Suspended</Pill>;
  if (status === "deleted") return <Pill tone="muted">Deleted</Pill>;
  return <Pill tone="down">Rejected</Pill>;
}

export function PartnerStatusPill({ status }: { status: string }) {
  return partnerStatusPill(status);
}

/** booking_items.state -> a pill. Same client/server rule as partnerStatusPill.
 *  refundStatus (067) only matters when state is 'refunded' — real gateway
 *  status once there was an online payment to actually reverse. */
export function bookingStatePill(
  state: string,
  redeemed: boolean,
  refundStatus?: "processing" | "processed" | "failed" | null,
) {
  if (redeemed) return <Pill tone="done">Checked in</Pill>;
  if (state === "confirmed") return <Pill tone="live">Confirmed</Pill>;
  if (state === "refunded") {
    if (refundStatus === "processing") return <Pill tone="waiting">Refund processing</Pill>;
    if (refundStatus === "failed") return <Pill tone="down">Refund failed</Pill>;
    return <Pill tone="down">Cancelled</Pill>;
  }
  if (state === "disrupted") return <Pill tone="down">Disrupted</Pill>;
  if (state === "missed") return <Pill tone="muted">No-show</Pill>;
  return <Pill tone="muted">{state}</Pill>;
}

export function BookingStatePill({
  state,
  redeemed,
  refundStatus,
}: {
  state: string;
  redeemed: boolean;
  refundStatus?: "processing" | "processed" | "failed" | null;
}) {
  return bookingStatePill(state, redeemed, refundStatus);
}

// ---------------------------------------------------------------------------
// Filter chips — the same control on four screens
// ---------------------------------------------------------------------------

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="no-bar flex gap-2 overflow-x-auto pb-1">{children}</div>;
}

export function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-bold transition-colors ${
        active
          ? "bg-brand text-white"
          : "border border-line bg-surface text-muted hover:border-brand hover:text-ink"
      }`}
    >
      {label}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 text-[10.5px] font-bold ${
            active ? "bg-white/25 text-white" : "bg-ground text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-full rounded-xl border border-line bg-surface px-3.5 text-[13px] font-medium outline-none placeholder:text-muted focus:border-brand md:w-72"
    />
  );
}

// ---------------------------------------------------------------------------
// Rows — a grid on desktop, a stacked card on a phone
// ---------------------------------------------------------------------------

/**
 * `cols` is a Tailwind grid-template applied only from md up, e.g.
 * "md:grid-cols-[2fr_1fr_1fr_auto]". Below that the row is a plain block and
 * each cell stacks, which is why every Cell carries its own `label`.
 */
export function RowHead({ cols, children }: { cols: string; children: React.ReactNode }) {
  return (
    <div
      className={`hidden border-b border-hairline px-5 py-2.5 text-[11px] font-bold tracking-wider text-muted uppercase md:grid md:items-center md:gap-4 ${cols}`}
    >
      {children}
    </div>
  );
}

export function Row({
  cols,
  children,
  href,
}: {
  cols: string;
  children: React.ReactNode;
  href?: string;
}) {
  const shell = `border-b border-hairline px-5 py-4 last:border-b-0 md:grid md:items-center md:gap-4 md:py-3 ${cols}`;

  if (href) {
    return (
      <Link href={href} className={`${shell} block transition-colors hover:bg-ground`}>
        {children}
      </Link>
    );
  }
  return <div className={shell}>{children}</div>;
}

/**
 * One cell. `label` is shown only on a phone, where the column header the
 * value belongs under is off-screen — on desktop the RowHead carries it.
 */
export function Cell({
  label,
  children,
  className = "",
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mt-2 min-w-0 first:mt-0 md:mt-0 ${className}`}>
      {label && (
        <span className="mr-2 text-[11px] font-bold tracking-wider text-muted uppercase md:hidden">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

export function Disclosure() {
  return (
    <span className="hidden text-muted md:block">
      <ChevronIcon size={16} />
    </span>
  );
}
