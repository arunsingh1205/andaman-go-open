// The Insights tab's numbers. Everything here is derived from data the
// partner app already holds — the bookings list, the delivered history, and
// the view counts from 028. No figure is invented; where there isn't enough
// data yet (no no-shows recorded, a listing with zero views) the metric is
// null and the screen shows a dash.

import { getPartnerBookings, type PartnerBooking } from "./partner-bookings";
import { getPartnerDelivered, type DeliveredBooking } from "./partner-delivered";
import { supabaseServer } from "./supabase-server";
import { istDayKey, istMonthKey } from "./partner-format";
import { todayIST } from "./date";
import { KIND_LABEL, type BookingKind } from "./bookings";

export type Delta = { now: number; prev: number };

export type ListingInsight = {
  subjectId: string;
  title: string;
  kindLabel: string;
  bookings30d: number;
  views30d: number;
  viewsAll: number;
  /** bookings30d / views30d, as a percentage — null when nobody's looked. */
  conversionPct: number | null;
};

export type PartnerInsights = {
  thisMonthLabel: string;
  lastMonthLabel: string;
  bookingsMade: Delta;
  grossPaise: Delta;
  checkedIn: Delta;
  netPaise: Delta;
  /** (cancelled + declined + weather) ÷ all bookings, %. */
  fellThroughPct: number | null;
  /** no-shows ÷ (checked in + no-shows), %. */
  noShowPct: number | null;
  /** median days between a booking being made and the date it's for. */
  medianLeadDays: number | null;
  /** median minutes you take to accept a booking that needs confirming. */
  medianAcceptMins: number | null;
  busiestWeekday: string | null;
  listings: ListingInsight[];
};

type ViewRow = {
  subject_id: string;
  kind: BookingKind;
  listing_title: string | null;
  views_all: number;
  views_30d: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pct(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100);
}

function monthLabelOf(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

export async function getPartnerInsights(): Promise<PartnerInsights> {
  const [bookings, delivered, viewsResult] = await Promise.all([
    getPartnerBookings(),
    getPartnerDelivered(),
    supabaseServer().then((s) =>
      s.from("partner_view_counts").select("subject_id, kind, listing_title, views_all, views_30d"),
    ),
  ]);

  const viewRows = (viewsResult.data ?? []) as ViewRow[];

  const today = todayIST();
  const thisMK = istMonthKey(today.toISOString());
  const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const prevMK = prev.toISOString().slice(0, 7);

  const madeIn = (mk: string) => bookings.filter((b) => istMonthKey(b.bookedAtIso) === mk);
  const grossOf = (list: PartnerBooking[]) =>
    list.filter((b) => b.state !== "refunded").reduce((s, b) => s + b.pricePaise, 0);
  const deliveredIn = (mk: string) =>
    delivered.filter((d) => istMonthKey(d.redeemedAtIso) === mk);
  const netOf = (list: DeliveredBooking[]) => list.reduce((s, d) => s + d.netPaise, 0);

  const madeThis = madeIn(thisMK);
  const madePrev = madeIn(prevMK);
  const delThis = deliveredIn(thisMK);
  const delPrev = deliveredIn(prevMK);

  // Rates over all-time bookings.
  const fellThrough = bookings.filter(
    (b) => b.state === "refunded" || b.state === "disrupted",
  ).length;
  const missed = bookings.filter((b) => b.state === "missed").length;
  const completed = bookings.filter((b) => b.redeemedAt !== null).length;

  const leadDays = bookings.map((b) => {
    const made = new Date(b.bookedAtIso).getTime();
    const starts = new Date(b.startsAtIso).getTime();
    return Math.max(0, (starts - made) / 86_400_000);
  });

  const acceptMins = bookings
    .filter((b) => b.confirmedAtIso !== null)
    .map((b) => {
      const made = new Date(b.bookedAtIso).getTime();
      const ok = new Date(b.confirmedAtIso as string).getTime();
      return Math.max(0, (ok - made) / 60_000);
    });

  const weekdayCounts = new Array(7).fill(0) as number[];
  for (const b of bookings) {
    const d = new Date(`${istDayKey(b.startsAtIso)}T00:00:00Z`).getUTCDay();
    weekdayCounts[d] += 1;
  }
  const busiestIdx = weekdayCounts.reduce((best, n, i) => (n > weekdayCounts[best] ? i : best), 0);

  // Per-listing: union of everything with a booking and everything with a view.
  const byListing = new Map<string, ListingInsight>();
  const cutoff = Date.now() - 30 * 86_400_000;

  for (const v of viewRows) {
    byListing.set(v.subject_id, {
      subjectId: v.subject_id,
      title: v.listing_title ?? "A listing",
      kindLabel: KIND_LABEL[v.kind] ?? v.kind,
      bookings30d: 0,
      views30d: v.views_30d,
      viewsAll: v.views_all,
      conversionPct: null,
    });
  }
  for (const b of bookings) {
    const recent = new Date(b.bookedAtIso).getTime() >= cutoff;
    const existing = byListing.get(b.subjectId);
    if (existing) {
      if (recent) existing.bookings30d += 1;
    } else {
      byListing.set(b.subjectId, {
        subjectId: b.subjectId,
        title: b.title,
        kindLabel: KIND_LABEL[b.kind] ?? b.kind,
        bookings30d: recent ? 1 : 0,
        views30d: 0,
        viewsAll: 0,
        conversionPct: null,
      });
    }
  }
  const listings = [...byListing.values()]
    .map((l) => ({ ...l, conversionPct: pct(l.bookings30d, l.views30d) }))
    .sort((a, b) => b.views30d - a.views30d || b.bookings30d - a.bookings30d);

  return {
    thisMonthLabel: monthLabelOf(thisMK),
    lastMonthLabel: monthLabelOf(prevMK),
    bookingsMade: { now: madeThis.length, prev: madePrev.length },
    grossPaise: { now: grossOf(madeThis), prev: grossOf(madePrev) },
    checkedIn: { now: delThis.length, prev: delPrev.length },
    netPaise: { now: netOf(delThis), prev: netOf(delPrev) },
    fellThroughPct: pct(fellThrough, bookings.length),
    noShowPct: pct(missed, completed + missed),
    medianLeadDays: leadDays.length ? Math.round(median(leadDays) ?? 0) : null,
    medianAcceptMins: acceptMins.length ? Math.round(median(acceptMins) ?? 0) : null,
    busiestWeekday: bookings.length ? WEEKDAYS[busiestIdx] : null,
    listings,
  };
}
