// Plan my day — the inventory a traveller builds their day from.
//
// This used to be a hand-written itinerary: five fixed slots (ferry, water,
// wheels, dinner, night) in a fixed order, with a fake catalogue and a phantom
// bundle discount. That told people how to spend the day. It didn't match how
// anyone actually plans one — a backpacker on Sri Vijaya Puram starts by
// grabbing a scooty, not by booking a ferry.
//
// Now the screen hands them the real listings for their island and they add
// what they want, when they want it. This file is the seam that flattens four
// different readers (rentals, activities, dining, events) into one shape the
// basket can hold. The "does this day fit" logic lives next door in
// lib/day-plan-conflicts.ts; the booking itself goes through lib/book.ts.
//
// The plan is always for tomorrow — that's when rentals and activities open,
// and it's the day the old screen assumed too.

import {
  addDays,
  dayKey as toDayKey,
  fmtClock,
  fmtDateLabel,
  fmtDayLabel,
  fmtDayNum,
  instantIso,
  todayIST,
} from "./date";
import { getActivities, seatsLeft as activitySeatsLeft } from "./activities";
import { getShops, rentalPickupOptions } from "./rentals";
import { getEvents, seatsLeft as eventSeatsLeft } from "./events";
import { parseClock } from "./day-plan-conflicts";
import type { PaymentMode } from "./payments";

export { rupees } from "./activities";

export const DEFAULT_GUESTS = 2;
export const MIN_GUESTS = 1;
export const MAX_GUESTS = 8;

export function clampGuests(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GUESTS;
  return Math.min(MAX_GUESTS, Math.max(MIN_GUESTS, Math.round(value)));
}

/** How many days out a plan can be made — day 1 is tomorrow, and this is the
 *  window activities publish slots for (see DAYS_AHEAD in lib/activities.ts). */
export const PLAN_DAYS_AHEAD = 6;

/** The days a traveller can plan — tomorrow through PLAN_DAYS_AHEAD out. */
export function planDayChoices(): { key: string; label: string; weekday: string }[] {
  const today = todayIST();
  return Array.from({ length: PLAN_DAYS_AHEAD }, (_, i) => {
    const d = addDays(today, i + 1);
    return {
      key: toDayKey(d),
      label: i === 0 ? "Tomorrow" : `${fmtDayLabel(d)} ${fmtDayNum(d)}`,
      weekday: d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    };
  });
}

/**
 * The day a plan is for. Pass a `?day=` key; anything outside the bookable
 * window (or missing) falls back to tomorrow.
 */
export function planDay(dayKey?: string): { key: string; label: string } {
  const choices = planDayChoices();
  const chosen = choices.find((c) => c.key === dayKey) ?? choices[0];
  const d = new Date(`${chosen.key}T00:00:00Z`);
  return { key: chosen.key, label: fmtDateLabel(d) };
}

export type PlanKind = "ride" | "activity" | "event";

export type PlanTime = {
  /** ISO instant the slot starts — what a booking is recorded against. */
  startsAt: string;
  timeLabel: string;
  /** Minutes past midnight IST, for the conflict check. */
  startMins: number;
  /** Infinity when the listing is uncapped. */
  seatsLeft: number;
  /** Set only for an event with an approximate end time — descriptive only. */
  endLabel?: string | null;
};

export type PlanOption = {
  /** Stable across a page load — the basket keys off this. */
  key: string;
  kind: PlanKind;
  /** Activity category — drives the duration the conflict engine uses. */
  subKind?: string;
  mark: string;
  title: string;
  operator: string;
  rating: string;
  reviews: number;
  /** Per person for an activity or event, per day for a ride. */
  pricePaise: number;
  priceUnit: "person" | "day";
  /** How lib/book.ts should book it. */
  bookKind: "activity" | "event" | "rental";
  bookSubject: string;
  bookVariant: string | null;
  paymentMode: PaymentMode;
  /** Rides only — how many people one vehicle carries, and that it runs all day. */
  seats?: number;
  allDay?: boolean;
  /** Timed kinds only — the starts available tomorrow. */
  times?: PlanTime[];
};

export type PlanInventory = {
  rides: PlanOption[];
  activities: PlanOption[];
  events: PlanOption[];
};

/**
 * Everything a traveller can put in their plan for `dayKey` on `islandSlug`,
 * already normalised. Reads all four catalogues in parallel — same island-scoped
 * functions the standalone Rides / Activities / Events screens use.
 */
export async function getPlannableInventory(
  islandSlug: string,
  day?: string,
): Promise<PlanInventory> {
  const { key: dayKey } = planDay(day);

  const [shops, activities, events] = await Promise.all([
    getShops(islandSlug),
    getActivities(islandSlug),
    getEvents(islandSlug),
  ]);

  // The traveller picks a pick-up time within the shop's hours for the plan day
  // — a ride still runs alongside everything (allDay), it just isn't a mystery
  // to the partner when the customer will turn up.
  const rideDow = new Date(`${dayKey}T00:00:00Z`).getUTCDay();

  const rides: PlanOption[] = shops.flatMap((shop) => {
    const picks = rentalPickupOptions(shop.hours, rideDow);
    return shop.vehicles.map((v) => ({
      key: `ride:${shop.slug}:${v.id}`,
      kind: "ride" as const,
      mark: "🛵",
      title: v.model,
      operator: shop.name,
      rating: shop.rating,
      reviews: shop.reviews,
      pricePaise: v.ratePaise,
      priceUnit: "day" as const,
      bookKind: "rental" as const,
      bookSubject: shop.slug,
      bookVariant: v.id,
      paymentMode: shop.paymentMode,
      seats: v.seats,
      allDay: true,
      times: picks.map((p) => ({
        startsAt: instantIso(dayKey, p.mins),
        timeLabel: p.label,
        startMins: p.mins,
        seatsLeft: Math.max(1, v.available),
      })),
    }));
  });

  const activityOpts: PlanOption[] = activities.map((a) => ({
    key: `activity:${a.slug}`,
    kind: "activity",
    subKind: a.category,
    mark: a.mark,
    title: a.name,
    operator: a.operator,
    rating: a.rating,
    reviews: a.reviews,
    pricePaise: a.pricePaise,
    priceUnit: "person",
    bookKind: "activity",
    bookSubject: a.slug,
    bookVariant: null,
    paymentMode: a.paymentMode,
    times: a.slots
      .filter((s) => s.dayKey === dayKey && s.isOpen)
      .map((s) => ({
        startsAt: s.startsAt,
        timeLabel: s.timeLabel,
        startMins: parseClock(s.timeLabel),
        seatsLeft: activitySeatsLeft(s),
      })),
  }));

  const eventOpts: PlanOption[] = events
    .filter((e) => e.dayKey === dayKey)
    .map((e) => ({
      key: `event:${e.slug}`,
      kind: "event",
      mark: e.mark,
      title: e.name,
      operator: e.venue,
      rating: e.rating,
      reviews: e.reviews,
      pricePaise: e.entryPaise,
      priceUnit: "person",
      bookKind: "event",
      bookSubject: e.slug,
      bookVariant: null,
      paymentMode: "full",
      times: [
        {
          startsAt: e.startsAt,
          timeLabel: e.timeLabel,
          startMins: parseClock(e.timeLabel),
          seatsLeft: eventSeatsLeft(e),
          endLabel: e.endTimeLabel,
        },
      ],
    }));

  return {
    rides,
    activities: activityOpts.filter((a) => (a.times?.length ?? 0) > 0),
    events: eventOpts.filter((e) => (e.times?.[0]?.seatsLeft ?? 0) > 0),
  };
}

/** A flat lookup of every option, for the server action to re-check against. */
export function indexInventory(inv: PlanInventory): Map<string, PlanOption> {
  const all = [...inv.rides, ...inv.activities, ...inv.events];
  return new Map(all.map((o) => [o.key, o]));
}

export { fmtClock };
