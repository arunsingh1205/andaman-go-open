// Reading the signed-in traveller's own bookings.
//
// This is the one part of lib/bookings.ts that touches the database, and it
// needs a client that knows who is asking — my_bookings is a security_invoker
// view keyed on auth.uid(), so the session-less catalogue client would just
// return nothing. Split out here so lib/bookings.ts stays importable from
// client components (KIND_LABEL, the derived helpers) without dragging
// next/headers into their bundles.

import { addDays, dayKey, fmtClock, fmtDateLabel, fmtDayLabel, todayIST } from "./date";
import type { PayMode } from "./pricing";
import { unwrap } from "./supabase";
import { supabaseServer } from "./supabase-server";
import type { Booking, BookingDay, BookingKind, BookingState, Directions } from "./bookings";

type Row = {
  item_id: string;
  booking_id: string;
  ref_code: string;
  on_date: string;
  island_name: string;
  kind: BookingKind;
  title: string | null;
  operator: string | null;
  starts_at: string;
  party: number;
  units: number;
  price_paise: number;
  pay_mode: PayMode | "partial";
  paid_online_paise: number;
  balance_paise: number;
  refunded_paise: number;
  refund_status: "processing" | "processed" | "failed" | null;
  state: BookingState;
  ticket_code: string | null;
  redeemed_at: string | null;
  maps_url: string | null;
  address: string | null;
  photo_path: string | null;
  unread_from_partner: number | null;
  my_rating: number | null;
  operator_phone: string | null;
};

/** Minutes from midnight IST for an instant — the app shows island time. */
function istMinutes(iso: string): number {
  const parts = new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

/** "2 guests", "3 nights · 2 guests", "3 days" — the same fact, said the
 *  right way. */
function detailFor(kind: BookingKind, party: number, units: number): string {
  if (kind === "stay") {
    return `${units} ${units === 1 ? "night" : "nights"} · ${party} ${party === 1 ? "guest" : "guests"}`;
  }
  if (kind === "ferry") return `${party} ${party === 1 ? "adult" : "adults"}`;
  if (kind === "trip") return `${party} ${party === 1 ? "seat" : "seats"}`;
  if (kind === "cab") return "Cab";
  return `${party} ${party === 1 ? "guest" : "guests"}`;
}

// --- Directions -----------------------------------------------------------
//
// The trap here: a name-only Maps query ("Reef Riders") lands on whichever
// business the map ranks first worldwide — for a dive shop on Havelock that's
// a namesake in Cozumel, Mexico. So every query, even the name fallback, is
// pinned to "Andaman & Nicobar Islands, India" — a wrong pin then still lands
// on the right island rather than the wrong hemisphere.

const REGION_TAIL = "Andaman & Nicobar Islands, India";

/**
 * True only for a real Maps deep link. A partner can paste anything into the
 * "Maps link" box — their website, a plain Google search, their business name
 * — and following that verbatim is how "Directions" ends up on a web search
 * page. Anything that fails this falls through to the address instead.
 */
function looksLikeMapLink(url: string | null): url is string {
  if (!url) return false;
  return /^https?:\/\/(maps\.google\.|(www\.)?google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\.com)/i.test(
    url.trim(),
  );
}

/** A region-qualified place string, or null when there's nothing solid to go on. */
function mapsQuery(address: string | null, islandName: string | null): string | null {
  const addr = address?.trim();
  if (!addr) return null;

  const parts = [addr];
  if (islandName && !addr.toLowerCase().includes(islandName.toLowerCase())) parts.push(islandName);
  if (!addr.toLowerCase().includes("andaman")) parts.push(REGION_TAIL);
  return parts.join(", ");
}

type DirectionsRow = {
  title: string | null;
  operator: string | null;
  island_name: string | null;
  maps_url: string | null;
  address: string | null;
};

/**
 * Everything the Directions button needs. The button itself turns this into
 * whichever map app the phone runs, so nothing here is a finished URL.
 *
 * `query` is best-effort but never empty: the operator's address if they gave
 * one, otherwise their name — both region-qualified so a namesake elsewhere
 * can't win. Null only when there's no name and no island, which never really
 * happens for a real booking.
 */
export function directionsData(row: DirectionsRow): Directions | null {
  const address = mapsQuery(row.address, row.island_name);
  // The operator's name beats the listing's ("Reef Riders", not "Scuba diving").
  const nameFallback = [row.operator || row.title, row.island_name, REGION_TAIL]
    .filter(Boolean)
    .join(", ");
  const query = address ?? nameFallback;
  if (!query.trim() || query.trim() === REGION_TAIL) return null;

  return {
    addressLabel: row.address?.trim() || null,
    query,
    mapsUrl: looksLikeMapLink(row.maps_url) ? row.maps_url : null,
  };
}

export type ConfirmationExtras = {
  /** Where the place is, for the Directions button. Null if there's nothing to go on. */
  directions: Directions | null;
  /** The code a partner scans on the day. Present on every booking since 034. */
  ticketCode: string | null;
  /**
   * The operator's own number, for a post-booking WhatsApp / call. Null if
   * unset. For a rate-card cab booking (077/078) this is null until
   * admin_assign_cab_operator (082) re-points the booking at a real
   * operator — before that it's the house "Andaman Go Cabs" partner, which
   * carries no phone number, so the contact block simply doesn't show yet.
   */
  operatorPhone: string | null;
  /** The operator's current name — for a rate-card cab booking this can
   *  differ from the name the confirmation screen rendered with (the house
   *  partner, at booking time) once dispatch has since re-pointed it. */
  operator: string | null;
  /**
   * What the booking actually charged, as create_cab_booking/create_stay_booking
   * persisted it at the time — not recomputed from a live commission rate,
   * which since migration 137 differs by partner and can't be reliably
   * reconstructed from the URL alone. Null when no matching row was found
   * (e.g. a stale link from before the booking was real).
   */
  paidOnlinePaise: number | null;
  balancePaise: number | null;
  pricePaise: number | null;
};

/**
 * The bits the confirmation screen wants that aren't already in the URL: the
 * ticket code, the operator's location, their phone, and the split that was
 * actually charged — by reference code (and, when a booking can hold more
 * than one item under the same reference, narrowed to the right kind).
 * Reads the caller's own my_bookings row (same auth.uid() scoping as
 * everything else here), so none of it reaches someone who hasn't booked.
 */
export async function getConfirmationExtras(
  ref: string,
  kind?: BookingKind,
): Promise<ConfirmationExtras> {
  const supabase = await supabaseServer();

  // select("*"), not a column list: operator_phone only exists once migration
  // 046 has run, and a missing-column error here would take down the whole
  // confirmation screen. A row that predates the column just reads `undefined`.
  let query = supabase.from("my_bookings").select("*").eq("ref_code", ref);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.limit(1);

  const row = (!error && data?.[0]) as Record<string, string | number | null> | undefined;
  if (!row) {
    return {
      directions: null,
      ticketCode: null,
      operatorPhone: null,
      operator: null,
      paidOnlinePaise: null,
      balancePaise: null,
      pricePaise: null,
    };
  }

  return {
    directions: directionsData({
      title: (row.title as string) ?? null,
      operator: (row.operator as string) ?? null,
      island_name: (row.island_name as string) ?? null,
      maps_url: (row.maps_url as string) ?? null,
      address: (row.address as string) ?? null,
    }),
    ticketCode: (row.ticket_code as string) ?? null,
    operatorPhone: (row.operator_phone as string) ?? null,
    operator: (row.operator as string) ?? null,
    paidOnlinePaise: row.paid_online_paise != null ? Number(row.paid_online_paise) : null,
    balancePaise: row.balance_paise != null ? Number(row.balance_paise) : null,
    pricePaise: row.price_paise != null ? Number(row.price_paise) : null,
  };
}

/** "Today", "Tomorrow", "Thursday", or a date once it is further out. */
function labelFor(onDate: string, today: Date): string {
  if (onDate === dayKey(today)) return "Today";
  if (onDate === dayKey(addDays(today, 1))) return "Tomorrow";

  const date = new Date(`${onDate}T00:00:00Z`);
  const daysOut = Math.round((date.getTime() - today.getTime()) / 86400000);

  if (daysOut > 1 && daysOut < 7) {
    return date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  }
  if (daysOut === -1) return "Yesterday";
  return fmtDateLabel(date);
}

export async function getBookingDays(): Promise<BookingDay[]> {
  const supabase = await supabaseServer();

  // No session, no bookings — and, importantly, no query.
  //
  // my_bookings is a security_invoker view, so it runs as whoever asked. Its
  // operator_phone column calls partner_phone(), and migration 122 revoked
  // that from `anon` on purpose: it reads a partner's contact number. So a
  // session-less render of this doesn't come back empty, it comes back
  // "permission denied for function partner_phone" and unwrap() throws,
  // which takes the whole screen down to Next's server-error page.
  //
  // A logged-out /profile is exactly that request: signOut() drops the auth
  // cookie, router.refresh() re-renders on the server with no cookie to send,
  // and the view executes as `anon`. Checking first is also just true —
  // nobody who isn't signed in owns any bookings.
  //
  // getSession(), not getUser(): this only decides whether to run a query
  // that RLS already guards, so it doesn't need a round trip to the auth
  // server to confirm what the cookie says.
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return [];

  const rows = (await supabase
    .from("my_bookings")
    .select("*")
    .order("on_date", { ascending: false })
    .order("starts_at")
    .then((r) => unwrap(r, "your bookings"))) as unknown as Row[];

  const today = todayIST();
  const todayKey = dayKey(today);
  const days = new Map<string, BookingDay>();

  for (const row of rows) {
    let day = days.get(row.booking_id);

    if (!day) {
      const date = new Date(`${row.on_date}T00:00:00Z`);
      day = {
        id: row.booking_id,
        label: labelFor(row.on_date, today),
        dateLabel: `${fmtDayLabel(date)}, ${fmtDateLabel(date).replace(/^\w+,\s*/, "")}`,
        place: row.island_name,
        refCode: row.ref_code,
        when: row.on_date >= todayKey ? "upcoming" : "past",
        items: [],
        // Weather disruption is not modelled in the database yet, so nothing
        // can honestly claim to be disrupted. The move/refund flow stays in
        // the screen, waiting for something real to drive it.
        disruption: null,
      };
      days.set(row.booking_id, day);
    }

    const startMs = new Date(row.starts_at).getTime();
    const upcoming = (row.state === "pending" || row.state === "confirmed") && Date.now() < startMs;
    const moreThan24h = Date.now() < startMs - 24 * 3_600_000;
    // A deposit and a cab's part-payment are both non-refundable; a full
    // payment gets half back outside 24h. Mirrors cancel_my_booking_item (073).
    const refundIfCancelledPaise =
      row.pay_mode === "deposit" || row.pay_mode === "partial"
        ? 0
        : moreThan24h
          ? Math.round(row.price_paise * 0.5)
          : 0;

    const item: Booking = {
      id: row.item_id,
      kind: row.kind,
      title: row.title ?? "Booking",
      operator: row.operator ?? "",
      timeLabel: fmtClock(istMinutes(row.starts_at)),
      detail: detailFor(row.kind, row.party, row.units),
      pricePaise: row.price_paise,
      state: row.state,
      ticket: row.ticket_code,
      // Nothing caches tickets on the device yet. Saying otherwise would be a
      // promise the app cannot keep on a beach with no signal.
      savedOffline: false,
      redeemedAt: row.redeemed_at,
      directions: directionsData(row),
      partnerPhotoPath: row.photo_path,
      unreadFromPartner: row.unread_from_partner ?? 0,
      myRating: row.my_rating ?? null,
      payMode: row.pay_mode ?? "full",
      paidOnlinePaise: row.paid_online_paise ?? 0,
      balancePaise: row.balance_paise ?? 0,
      refundedPaise: row.refunded_paise ?? 0,
      refundStatus: row.refund_status ?? null,
      canCancel: upcoming,
      refundIfCancelledPaise,
      operatorPhone: row.operator_phone ?? null,
    };
    day.items.push(item);
  }

  return [...days.values()];
}
