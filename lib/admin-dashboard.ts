"use server";

// The numbers on the console's Overview screen.
//
// Same principle as lib/partner-dashboard.ts: nothing new is tracked. Every
// figure here is derived from rows the other screens already read — pending
// partners, pending listings, today's bookings, this month's delivered
// work. If a number here disagrees with the screen it summarises, the bug
// is here, not in a second source of truth, because there isn't one.
//
// Deliberately no "revenue" figure that includes bookings nobody has turned
// up for yet. Money is counted the same way the partner Earnings screen
// counts it — once a booking has actually been checked in — because a
// confirmed booking is a promise, not a delivery.

import { instantIso, dayKey, todayIST, addDays } from "./date";
import { supabaseServer } from "./supabase-server";
import { istDayKey, istMonthKey } from "./partner-format";

export type OverviewStats = {
  /** Waiting on a decision from you, right now. */
  pendingPartners: number;
  pendingListings: number;
  /** Today's confirmed bookings a partner hasn't checked anyone in for yet. */
  toCheckInToday: number;

  bookingsToday: number;
  checkedInToday: number;

  deliveredThisMonth: number;
  grossThisMonthPaise: number;

  livePartners: number;
  suspendedPartners: number;
  liveListings: number;
};

type StateRow = {
  starts_at: string;
  state: string;
  price_paise: number;
  redeemed_at: string | null;
};

export async function getOverviewStats(): Promise<OverviewStats> {
  const supabase = await supabaseServer();
  const today = todayIST();
  const todayKey = dayKey(today);
  const monthKey = todayKey.slice(0, 7);

  // One window covers everything the tiles need: this calendar month so far,
  // plus the rest of today. Anything older than the 1st can't affect a
  // "today" or "this month" number, so it never has to be fetched.
  const monthStart = instantIso(`${monthKey}-01`, 0);
  const tomorrowStart = instantIso(dayKey(addDays(today, 1)), 0);

  const [bookings, partners, waitingPartners] = await Promise.all([
    supabase
      .from("admin_bookings")
      .select("starts_at, state, price_paise, redeemed_at")
      .gte("starts_at", monthStart)
      .lt("starts_at", tomorrowStart),
    supabase.from("partners").select("status"),
    supabase.from("partners").select("id").eq("status", "pending"),
  ]);

  const rows = (bookings.data ?? []) as unknown as StateRow[];

  let toCheckInToday = 0;
  let bookingsToday = 0;
  let checkedInToday = 0;
  let deliveredThisMonth = 0;
  let grossThisMonthPaise = 0;

  for (const row of rows) {
    const onKey = istDayKey(row.starts_at);

    if (onKey === todayKey) {
      bookingsToday += 1;
      if (row.redeemed_at) checkedInToday += 1;
      else if (row.state === "confirmed") toCheckInToday += 1;
    }
    // Delivered = actually checked in, the same test partner Earnings uses.
    // Counted by when it was REDEEMED, not when it was due, so a booking
    // checked in late doesn't land in the wrong month.
    if (row.redeemed_at && istMonthKey(row.redeemed_at) === monthKey) {
      deliveredThisMonth += 1;
      grossThisMonthPaise += row.price_paise;
    }
  }

  const statuses = (partners.data ?? []) as unknown as { status: string }[];

  return {
    pendingPartners: (waitingPartners.data ?? []).length,
    pendingListings: await countPendingListings(),
    toCheckInToday,
    bookingsToday,
    checkedInToday,
    deliveredThisMonth,
    grossThisMonthPaise,
    livePartners: statuses.filter((p) => p.status === "approved").length,
    suspendedPartners: statuses.filter((p) => p.status === "suspended").length,
    liveListings: await countLiveListings(),
  };
}

// The seven catalogue tables again (095/096: restaurants swapped for stays —
// a legacy restaurant row can't newly go live, so it's not counted as one).
// These two count with `head: true` and an exact count rather than pulling
// rows back — the Overview only ever shows the number, and seven full table
// reads to render two integers would be a silly amount of data to move.
const CATALOGUE = ["activities", "vehicles", "cabs", "stays", "events", "trips", "sailings"] as const;

async function countLiveListings(): Promise<number> {
  const supabase = await supabaseServer();
  const counts = await Promise.all(
    CATALOGUE.map((table) =>
      supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("is_listed", true)
        .is("deleted_at", null),
    ),
  );
  return counts.reduce((sum, c) => sum + (c.count ?? 0), 0);
}

async function countPendingListings(): Promise<number> {
  const supabase = await supabaseServer();
  const counts = await Promise.all(
    CATALOGUE.map((table) =>
      supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("is_listed", false)
        .is("rejection_reason", null)
        .is("deleted_at", null),
    ),
  );
  return counts.reduce((sum, c) => sum + (c.count ?? 0), 0);
}
