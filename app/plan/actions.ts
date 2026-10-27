"use server";

// Plan my day — the server side of "can this day happen" and "book it".
//
// The client runs the same conflict engine for instant feedback, but this is
// the authority: it re-reads the real catalogue, re-derives every slot time and
// every duration here, and refuses a day that doesn't fit no matter what the
// page sent. A packed-but-possible day needs the traveller's explicit consent
// before anything is charged.
//
// Booking is one call to lib/book.ts per stop, in time order. There is no
// linked "one reference" yet — each piece is its own booking, refundable on its
// own terms — so a later failure leaves the earlier bookings standing, and the
// result says exactly which went through.
//
// Charging happens per stop, not once for the whole day: booking_items has a
// unique constraint on razorpay_payment_id (one payment can only ever settle
// one booking), so a single combined charge for the day couldn't be split
// across several create_booking calls. preparePlanBooking() below does the
// validation and returns the resolved, priced stops; the client then charges
// and books each one in turn via bookPlanItem(), same as every other booking
// screen in the app — just looped, one stop at a time.

import { instantIso } from "@/lib/date";
import { bookNow, type BookingRequest } from "@/lib/book";
import { getPlannableInventory, indexInventory, planDay, type PlanOption } from "@/lib/day-plan";
import {
  checkPlan,
  istMinutes,
  type PlanIssue,
  type PlanLine,
} from "@/lib/day-plan-conflicts";
import { DEFAULT_PICKUP_MINS } from "@/lib/rentals";

export type PlanLineInput = {
  /** The PlanOption key. One line per option. */
  key: string;
  /** ISO start the traveller picked. Null for an all-day ride. */
  startsAt: string | null;
};

export type PlanValidateInput = {
  islandSlug: string;
  /** Which day the plan is for — a key from planDayChoices(). */
  dayKey: string;
  guests: number;
  lines: PlanLineInput[];
};

export type PlanBookResult = {
  key: string;
  title: string;
  ok: boolean;
  /** The traveller's reference for the day — shared across every stop. */
  ref?: string;
  /** This stop's own ticket code — unique, one QR each. */
  ticket?: string | null;
  pricePaise?: number;
  message?: string;
};

/** Resolve the client's line list against the live catalogue. Unknown or
 *  sold-out options come back as a synthetic block so the UI can flag them. */
function resolve(
  lines: PlanLineInput[],
  index: Map<string, PlanOption>,
  guests: number,
): { planLines: PlanLine[]; extraIssues: PlanIssue[]; matched: ResolvedLine[] } {
  const planLines: PlanLine[] = [];
  const extraIssues: PlanIssue[] = [];
  const matched: ResolvedLine[] = [];

  for (const line of lines) {
    const option = index.get(line.key);
    if (!option) {
      extraIssues.push({
        level: "block",
        code: "unavailable",
        message: "Something in your day is no longer being offered. Remove it and pick again.",
        keys: [line.key],
      });
      continue;
    }

    if (option.allDay) {
      // A ride carries a pick-up time (so the partner knows when), but it still
      // runs alongside everything — no start minute, so it never clashes.
      const slot = option.times?.find((t) => t.startsAt === line.startsAt);
      planLines.push({
        key: option.key,
        kind: option.kind,
        subKind: option.subKind,
        title: option.title,
        timeLabel: slot?.timeLabel ?? "all day",
        party: guests,
      });
      matched.push({ option, startsAt: slot?.startsAt ?? null });
      continue;
    }

    if (!line.startsAt) {
      extraIssues.push({
        level: "block",
        code: "unavailable",
        message: `Pick a time for ${option.title}.`,
        keys: [option.key],
      });
      continue;
    }

    const slot = option.times?.find((t) => t.startsAt === line.startsAt);
    if (!slot) {
      extraIssues.push({
        level: "block",
        code: "unavailable",
        message: `${option.title} isn't running at that time any more. Pick another start.`,
        keys: [option.key],
      });
      continue;
    }

    planLines.push({
      key: option.key,
      kind: option.kind,
      subKind: option.subKind,
      title: option.title,
      timeLabel: slot.timeLabel,
      startMins: istMinutes(slot.startsAt),
      party: guests,
    });
    matched.push({ option, startsAt: slot.startsAt });
  }

  return { planLines, extraIssues, matched };
}

type ResolvedLine = { option: PlanOption; startsAt: string | null };

export async function validatePlan(input: PlanValidateInput): Promise<PlanIssue[]> {
  const inv = await getPlannableInventory(input.islandSlug, input.dayKey);
  const { planLines, extraIssues } = resolve(input.lines, indexInventory(inv), input.guests);
  return [...extraIssues, ...checkPlan(planLines)];
}

/** One stop, resolved against the live catalogue and priced — everything the
 *  client needs to charge it via Razorpay and then book it. */
export type PreparedPlanItem = {
  key: string;
  title: string;
  bookKind: "activity" | "event" | "rental";
  bookSubject: string;
  bookVariant: string | null;
  startsAt: string;
  guests: number;
  /** The exact amount to charge for this stop — per person for an activity
   *  or event, per day (flat) for a ride, same as lib/day-plan.ts's
   *  PlanOption.priceUnit already means everywhere else in this screen. */
  chargePaise: number;
};

export type PlanPrepareOutcome =
  | { ok: false; issues: PlanIssue[]; needsConsent?: boolean }
  | { ok: true; issues: PlanIssue[]; items: PreparedPlanItem[] };

/** Validates the day exactly like bookPlan() used to, but stops short of
 *  booking anything — it hands back the resolved, priced, time-ordered stops
 *  so the client can charge and book each one in turn (see the header
 *  comment for why charging can't happen as one combined payment). */
export async function preparePlanBooking(
  input: PlanValidateInput,
  opts: { consented: boolean },
): Promise<PlanPrepareOutcome> {
  const day = planDay(input.dayKey);
  const inv = await getPlannableInventory(input.islandSlug, day.key);
  const { planLines, extraIssues, matched } = resolve(
    input.lines,
    indexInventory(inv),
    input.guests,
  );
  const issues = [...extraIssues, ...checkPlan(planLines)];

  const blocks = issues.filter((i) => i.level === "block");
  if (blocks.length > 0) return { ok: false, issues };

  const warns = issues.filter((i) => i.level === "warn");
  if (warns.length > 0 && !opts.consented) {
    return { ok: false, issues, needsConsent: true };
  }

  // Book in the order the day runs.
  const order = [...matched].sort((a, b) => {
    const am = a.startsAt ? Date.parse(a.startsAt) : -1;
    const bm = b.startsAt ? Date.parse(b.startsAt) : -1;
    return am - bm;
  });

  // Fallback pick-up if a ride somehow arrived without a chosen time.
  const rentalFallback = instantIso(day.key, DEFAULT_PICKUP_MINS);

  const items: PreparedPlanItem[] = order.map(({ option, startsAt }) => ({
    key: option.key,
    title: option.title,
    bookKind: option.bookKind,
    bookSubject: option.bookSubject,
    bookVariant: option.bookVariant,
    startsAt: startsAt ?? rentalFallback,
    guests: input.guests,
    chargePaise: option.priceUnit === "day" ? option.pricePaise : option.pricePaise * input.guests,
  }));

  return { ok: true, issues: warns, items };
}

/** Books one already-prepared stop, with the Razorpay receipt for it (if the
 *  charge was above the ₹1 minimum — see lib/razorpay-client.ts's
 *  MIN_CHARGE_PAISE, same free-item exception every other booking screen
 *  uses). Called once per stop, right after that stop's own charge clears —
 *  same shape as a single-item booking screen, just looped from the plan. */
export async function bookPlanItem(input: {
  bookKind: "activity" | "event" | "rental";
  bookSubject: string;
  bookVariant: string | null;
  startsAt: string;
  guests: number;
  razorpay?: BookingRequest["razorpay"];
}): Promise<
  | { ok: true; ref: string; ticket: string | null; pricePaise: number }
  | { ok: false; message: string }
> {
  // A day plan is paid in full, upfront — every ticket is issued now, so
  // there's no "pay the rest in person" left hanging over the day.
  const res =
    input.bookKind === "rental"
      ? await bookNow({
          kind: "rental",
          subject: input.bookSubject,
          startsAt: input.startsAt,
          units: 1,
          variant: input.bookVariant,
          extras: false,
          payMode: "full",
          razorpay: input.razorpay,
        })
      : await bookNow({
          kind: input.bookKind,
          subject: input.bookSubject,
          startsAt: input.startsAt,
          party: input.guests,
          payMode: "full",
          razorpay: input.razorpay,
        });

  return res.ok
    ? { ok: true, ref: res.ref, ticket: res.ticket, pricePaise: res.pricePaise }
    : { ok: false, message: res.message };
}
