import Link from "next/link";
import { getMyPhone, getMyPhoneVerified, getMyEmail } from "@/lib/profile";
import PhonePrompt from "@/app/phone-prompt";
import EmailPrompt from "@/app/email-prompt";
import PurchaseBeacon from "@/app/purchase-beacon";
import { rupees } from "@/lib/activities";
import { getActivity, seatsLeft as activitySeatsLeft } from "@/lib/activities";
import { depositPaise, paymentSplit, type PayMode } from "@/lib/payments";
import { getTrip, seatsLeft as tripSeatsLeft } from "@/lib/trips";
import { addDays, dayKey, fmtClock, fmtDateLabel, todayIST } from "@/lib/date";
import {
  cabPaymentSplit,
  getCabCommissionBps,
  getCabOperator,
  getCabPlaces,
  quoteFare,
  routeTouchesAirport,
  CAB_TRIP_LABEL,
  type CabCategory,
  type CabTripType,
} from "@/lib/cabs";
import { getCabRateCard, rateCardFare, RATE_TRIP_LABEL, type CabRateTripType } from "@/lib/cab-rate-card";
import { getShop, getRentalDates, DELIVERY_PAISE } from "@/lib/rentals";
import { getEvent, seatsLeft as eventSeatsLeft } from "@/lib/events";
import { getStay, stayPaymentSplit } from "@/lib/stays";
import { getSailings, getDays as getFerryDays, fmtTime, fmtDuration } from "@/lib/ferries";
import { getConfirmationExtras, type ConfirmationExtras } from "@/lib/my-bookings";
import type { BookingKind } from "@/lib/bookings";
import { qrCode } from "@/lib/qr";
import DirectionsButton from "@/app/directions-button";
import OperatorContact from "@/app/operator-contact";
import {
  BedIcon,
  BicycleIcon,
  BikeIcon,
  CalendarIcon,
  CarIcon,
  CheckIcon,
  ChevronIcon,
  DiveIcon,
  FerryIcon,
  MusicIcon,
  PinIcon,
  ScooterIcon,
} from "@/app/icons";

// Reads the traveller's own phone/email (lib/profile.ts) on every load, keyed
// only by the session cookie, not by anything in the URL — same reasoning as
// /profile's force-dynamic (see lib/supabase-server.ts for the actual fix).
export const dynamic = "force-dynamic";

type Params = {
  type?: string;
  id?: string;
  slot?: string;
  n?: string;
  /** Event pass name and how many were bought (153). */
  pass?: string;
  qty?: string;
  nights?: string;
  v?: string;
  d?: string;
  /** Rental pick-up time, minutes past midnight. Also the cab pickup time. */
  pt?: string;
  /** Rental pick-up date key ("YYYY-MM-DD") — today or tomorrow, whichever
   *  pickupWindow() placed it on (lib/rentals.ts). */
  pdk?: string;
  deliver?: string;
  /** How it was paid — "deposit" or "full"; for a cab, "partial" (commission
   *  online, rest to the driver) or "full". Absent means full. */
  pay?: string;
  /** The reference the database issued, once the booking is real. */
  ref?: string;
  /** Cab: car code, trip type, pickup date, from/to place ids, day count,
   *  return date + time. */
  cab?: string;
  tt?: string;
  pd?: string;
  from?: string;
  to?: string;
  days?: string;
  rd?: string;
  rt?: string;
  /** Rate-card cab (077/078): the island the fare belongs to, and the
   *  vehicle category it's priced for. */
  island?: string;
  cat?: string;
  /** Stay: room type code, and the check-in date ("YYYY-MM-DD"). */
  room?: string;
  checkin?: string;
};

type Confirmation = {
  Icon: typeof DiveIcon;
  title: string;
  operator: string;
  whenLabel: string;
  detail: string;
  payNowPaise: number;
  totalPaise: number;
  headline: string;
  body: string;
  /** Exact start instant, when the booking has one — drives "Add to calendar". */
  startsAtIso?: string;
  /** Roughly how long to block out on the calendar, in minutes. */
  calendarMinutes?: number;
};

const VEHICLE_ICON = { scooter: ScooterIcon, bike: BikeIcon, bicycle: BicycleIcon };

/** A "TEMPLATE" link that pre-fills a new Google Calendar event. Works on the
 *  web and hands off to the calendar app on a phone. */
function googleCalendarUrl(opts: {
  title: string;
  startIso: string;
  minutes: number;
  location: string | null;
  details: string;
}): string {
  const start = new Date(opts.startIso);
  const end = new Date(start.getTime() + opts.minutes * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${stamp(start)}/${stamp(end)}`,
    details: opts.details,
  });
  if (opts.location) p.set("location", opts.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

const secondaryAction =
  "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface text-[13px] font-bold text-brand transition active:scale-[0.985]";

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** A stable-looking reference code, derived from the booking's own params. */
function refCode(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  const chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[h % chars.length];
    h = Math.floor(h / chars.length);
  }
  return `AG-${code}`;
}

/** booking_items.kind for a given confirmation-screen type — "cabrc" (the
 *  rate-card desk) still books under kind 'cab' (create_ratecard_cab_booking). */
function bookingKindFor(type: string): BookingKind | null {
  if (type === "cabrc") return "cab";
  if (["activity", "cab", "trip", "rental", "event", "stay", "ferry"].includes(type)) {
    return type as BookingKind;
  }
  return null;
}

async function resolve(params: Params, extras: ConfirmationExtras): Promise<Confirmation | null> {
  const { type, id } = params;
  if (!type || !id) return null;

  const payMode: PayMode = params.pay === "deposit" ? "deposit" : "full";

  if (type === "activity") {
    const activity = await getActivity(id);
    const slot = activity?.slots.find((s) => s.id === params.slot);
    if (!activity || !slot) return null;
    const guests = clamp(Number(params.n), 1, Math.max(1, activitySeatsLeft(slot)));
    const total = activity.pricePaise * guests;
    // Prefer what the booking actually charged — this operator's own rate
    // can differ from any other's, so a recomputed estimate is only a
    // fallback for a link with no real booking behind it yet.
    const split =
      extras.paidOnlinePaise != null
        ? { paidNowPaise: extras.paidOnlinePaise, balancePaise: extras.balancePaise ?? 0 }
        : paymentSplit(total, payMode, activity.commissionBps);
    const operator = activity.operator.split(" · ")[0];
    return {
      Icon: DiveIcon,
      title: activity.name,
      operator: activity.operator,
      whenLabel: `${slot.dayLabel} ${slot.dayNum} · ${slot.timeLabel}`,
      detail: `${guests} guest${guests === 1 ? "" : "s"}`,
      payNowPaise: split.paidNowPaise,
      totalPaise: total,
      headline: "Booking confirmed",
      body:
        split.balancePaise > 0
          ? `${operator} has your booking. Pay ${rupees(split.balancePaise)} in person on the day.`
          : `${operator} has your booking — nothing left to pay.`,
      startsAtIso: slot.startsAt,
      calendarMinutes: 180,
    };
  }

  if (type === "cab") {
    const [operator, places] = await Promise.all([getCabOperator(id), getCabPlaces()]);
    const car = operator?.cabs.find((c) => c.code === params.cab);
    if (!operator || !car) return null;

    const tripType = (params.tt ?? "oneway") as CabTripType;
    const placeLabel = (pid?: string) => places.find((p) => p.id === pid)?.label ?? "";
    const days = clamp(Number(params.days) || 1, 1, 30);
    const pickupMins = clamp(Number(params.pt) || 9 * 60, 0, 1439);
    const total = quoteFare(car, {
      tripType,
      fromId: params.from,
      toId: params.to,
      days,
      pickupMins,
      airport: routeTouchesAirport(places, params.from, params.to),
    });
    // Prefer what the booking actually charged (persisted at booking time) —
    // this operator's own rate can differ from any other operator's, so a
    // recomputed estimate is only a fallback for a link with no real booking
    // behind it yet.
    const split =
      extras.paidOnlinePaise != null
        ? { paidNowPaise: extras.paidOnlinePaise, balancePaise: extras.balancePaise ?? 0 }
        : cabPaymentSplit(total, params.pay === "full" ? "full" : "partial", operator.commissionBps);

    const whenLabel =
      tripType === "fullday"
        ? `Full day · ${days} ${days === 1 ? "day" : "days"}`
        : `${placeLabel(params.from)} → ${placeLabel(params.to)}`;

    const pickupLabel = `Pickup ${fmtClock(pickupMins)}`;
    let returnLabel = "";
    if (tripType === "roundtrip" && params.rt) {
      const rtime = fmtClock(clamp(Number(params.rt), 0, 1439));
      returnLabel =
        params.rd && params.rd !== params.pd
          ? ` · return ${fmtDateLabel(new Date(`${params.rd}T00:00:00Z`))} ~${rtime}`
          : ` · return same day ~${rtime}`;
    }

    return {
      Icon: CarIcon,
      title: `${car.model} · ${CAB_TRIP_LABEL[tripType]}`,
      operator: operator.name,
      whenLabel,
      detail: `${pickupLabel}${returnLabel} · ${car.seats} seats`,
      payNowPaise: split.paidNowPaise,
      totalPaise: total,
      headline: "Cab booked",
      body:
        split.balancePaise > 0
          ? `${operator.name} has your booking. Pay ${rupees(split.balancePaise)} to the driver on the day.`
          : `${operator.name} has your booking — nothing left to pay.`,
    };
  }

  if (type === "cabrc") {
    const island = id;
    const [places, rateCard] = await Promise.all([getCabPlaces(), getCabRateCard(island)]);
    const tripType = (params.tt ?? "roundtrip") as CabRateTripType;
    const category = (params.cat ?? "suv") as CabCategory;
    const match = rateCardFare(rateCard, {
      tripType,
      fromPlaceId: params.from ?? null,
      toPlaceId: params.to ?? null,
      vehicleCategory: category,
    });
    if (!match) return null;

    const placeLabel = (pid?: string) => places.find((p) => p.id === pid)?.label ?? "";
    const pickupMins = clamp(Number(params.pt) || 9 * 60, 0, 1439);
    const total = match.farePaise;
    // Prefer the persisted split; only recompute (against the dispatch
    // desk's own rate) for a link with no real booking behind it yet.
    const split =
      extras.paidOnlinePaise != null
        ? { paidNowPaise: extras.paidOnlinePaise, balancePaise: extras.balancePaise ?? 0 }
        : cabPaymentSplit(
            total,
            params.pay === "full" ? "full" : "partial",
            await getCabCommissionBps(),
          );

    const whenLabel =
      tripType === "outstation"
        ? `${placeLabel(params.to)} · ${match.nights + 1} day${match.nights + 1 === 1 ? "" : "s"}`
        : `${params.from ? placeLabel(params.from) : "Standard city pickup"} → ${
            placeLabel(params.to) || "Local hop"
          }`;

    return {
      Icon: CarIcon,
      title: `${match.label} · ${RATE_TRIP_LABEL[tripType]}`,
      operator: "Andaman Go Cabs",
      whenLabel,
      detail: `Pickup ${fmtClock(pickupMins)}`,
      payNowPaise: split.paidNowPaise,
      totalPaise: total,
      headline: "Cab booked",
      body:
        split.balancePaise > 0
          ? `We're finding you a driver — you'll see their name and number here and in My bookings shortly. Pay ${rupees(split.balancePaise)} to them directly on the day.`
          : "We're finding you a driver — you'll see their name and number here and in My bookings shortly.",
    };
  }

  if (type === "trip") {
    const trip = await getTrip(id);
    if (!trip) return null;
    const seats = clamp(Number(params.n), 1, Math.max(1, tripSeatsLeft(trip)));
    const total = trip.pricePaise * seats;
    const split =
      extras.paidOnlinePaise != null
        ? { paidNowPaise: extras.paidOnlinePaise, balancePaise: extras.balancePaise ?? 0 }
        : paymentSplit(total, payMode, trip.commissionBps);
    return {
      Icon: PinIcon,
      title: trip.title,
      operator: `Hosted by ${trip.host}`,
      whenLabel: trip.nextDateLabel,
      detail: `${seats} ${seats === 1 ? "seat" : "seats"} · ${
        trip.meetAtHotel ? "hotel pickup" : trip.meetPoint
      }`,
      payNowPaise: split.paidNowPaise,
      totalPaise: total,
      headline: "Booking confirmed",
      body:
        split.balancePaise > 0
          ? `${trip.host} has your booking. Pay ${rupees(split.balancePaise)} in cash on the day.`
          : `${trip.host} has your booking — nothing left to pay.`,
    };
  }

  if (type === "rental") {
    const shop = await getShop(id);
    const vehicle = shop?.vehicles.find((v) => v.id === params.v);
    if (!shop || !vehicle) return null;
    const pickupMins = clamp(Number(params.pt) || 9 * 60, 0, 1439);
    // Older links (from before same-day pick-up) never sent pdk — tomorrow
    // was the only date pick-up ever landed on then, so that's the fallback.
    const pickupDateKey = params.pdk ?? dayKey(addDays(todayIST(), 1));
    const dates = await getRentalDates(pickupDateKey, pickupMins);
    const days = clamp(Number(params.d), 1, dates.returnLabels.length);
    const deliver = params.deliver === "1";
    const rentalPaise = vehicle.ratePaise * days;
    const total = rentalPaise + (deliver ? DELIVERY_PAISE : 0);
    // Same fallback shape shop-booking.tsx charges with — the delivery fee
    // is never commissionable (064/150), so a deposit is computed on the
    // rental alone. Only reached when extras.paidOnlinePaise came back null
    // (the real persisted split, from the row this ref actually booked, is
    // always preferred over recomputing one).
    const split =
      extras.paidOnlinePaise != null
        ? { paidNowPaise: extras.paidOnlinePaise, balancePaise: extras.balancePaise ?? 0 }
        : payMode === "deposit"
          ? {
              paidNowPaise: depositPaise(rentalPaise, shop.commissionBps),
              balancePaise: total - depositPaise(rentalPaise, shop.commissionBps),
            }
          : { paidNowPaise: total, balancePaise: 0 };
    const security = vehicle.securityDepositPaise;
    const counter = [
      split.balancePaise > 0
        ? `${rupees(split.balancePaise)} on ${deliver ? "delivery" : "pick-up"}`
        : null,
      security > 0 ? `a ${rupees(security)} refundable deposit` : null,
    ].filter(Boolean);
    return {
      Icon: VEHICLE_ICON[vehicle.type],
      title: vehicle.model,
      operator: shop.name,
      whenLabel: `${dates.pickupLabel} → ${dates.returnLabels[days - 1]}`,
      detail: `${days} ${days === 1 ? "day" : "days"}${deliver ? " · delivered to your hotel" : ""}`,
      payNowPaise: split.paidNowPaise,
      totalPaise: total,
      headline: "Booking confirmed",
      body:
        counter.length > 0
          ? `${shop.name} has the ${vehicle.model}. Bring ${counter.join(" and ")}, paid to the shop.`
          : `${shop.name} has the ${vehicle.model} ready for you.`,
    };
  }

  if (type === "event") {
    const event = await getEvent(id);
    if (!event) return null;
    // Whatever the booking actually charged, when we can read it — a pass
    // price isn't recoverable from the head count alone (153).
    const pass = event.tickets.length > 0 ? params.pass : undefined;
    const passQty = clamp(Number(params.qty), 1, 20);
    const guests = pass
      ? Math.max(1, Number(params.n) || 1)
      : clamp(Number(params.n), 1, Math.max(1, eventSeatsLeft(event)));
    const total = extras.pricePaise ?? event.entryPaise * guests;
    return {
      Icon: MusicIcon,
      title: event.name,
      operator: `${event.venue} · ${event.area}`,
      whenLabel: `${event.dayLabel} ${event.dayNum} · ${event.timeLabel}`,
      detail: pass
        ? `${passQty} × ${pass} · ${guests} ${guests === 1 ? "person" : "people"}`
        : `${guests} guest${guests === 1 ? "" : "s"}`,
      payNowPaise: total,
      totalPaise: total,
      startsAtIso: event.startsAt,
      calendarMinutes: 180,
      headline: event.entryPaise === 0 ? "You're on the list" : "Booked",
      body:
        event.entryPaise === 0
          ? "Show this screen at the door."
          : "Entry is confirmed — show this screen at the door.",
    };
  }

  if (type === "stay") {
    const stay = await getStay(id);
    if (!stay) return null;
    const room = stay.roomTypes.find((r) => r.code === params.room);
    if (!room) return null;
    const nights = clamp(Number(params.nights), 1, 180);
    const guests = clamp(Number(params.n), 1, room.maxGuests);
    const total = room.nightlyRatePaise * nights;
    const mode = params.pay === "full" ? "full" : "partial";
    // Prefer the persisted split; only recompute (against this property's
    // own rate) for a link with no real booking behind it yet.
    const split =
      extras.paidOnlinePaise != null
        ? { paidNowPaise: extras.paidOnlinePaise, balancePaise: extras.balancePaise ?? 0 }
        : stayPaymentSplit(total, mode, stay.commissionBps);
    const checkInKey = params.checkin && params.checkin.trim() !== "" ? params.checkin : new Date().toISOString().slice(0, 10);
    return {
      Icon: BedIcon,
      title: stay.name,
      operator: room.name,
      whenLabel: `${fmtDateLabel(new Date(`${checkInKey}T00:00:00Z`))} · ${nights} ${nights === 1 ? "night" : "nights"}`,
      detail: `${guests} guest${guests === 1 ? "" : "s"}`,
      payNowPaise: split.paidNowPaise,
      totalPaise: total,
      headline: "Booked",
      body:
        split.balancePaise > 0
          ? `Show this screen at check-in. ${rupees(split.balancePaise)} is owed to the property.`
          : "Show this screen at check-in — the stay is paid in full.",
      startsAtIso: `${checkInKey}T${String(Math.floor(stay.checkInMins / 60)).padStart(2, "0")}:${String(stay.checkInMins % 60).padStart(2, "0")}:00+05:30`,
      calendarMinutes: nights * 24 * 60,
    };
  }

  if (type === "ferry") {
    const sailings = await getSailings();
    const sailing = sailings.find((s) => s.id === id);
    if (!sailing) return null;
    const days = await getFerryDays();
    const day = days.find((dc) => dc.key === params.d);
    const from = sailing.fromName;
    const to = sailing.toName;
    const adults = clamp(Number(params.n), 1, 10);
    const total = sailing.farePaise * adults;
    return {
      Icon: FerryIcon,
      title: `${from} → ${to}`,
      operator: sailing.operator,
      whenLabel: `${day ? `${day.label} ${day.num} · ` : ""}${fmtTime(sailing.depMins)}`,
      detail: `${adults} ${adults === 1 ? "adult" : "adults"} · ${fmtDuration(sailing.durationMins)}`,
      payNowPaise: total,
      totalPaise: total,
      headline: "Seats held",
      body: `We're placing your booking with ${sailing.operator}. The e-ticket arrives on WhatsApp, usually within a few hours — every passenger carries the ID they booked with.`,
    };
  }

  return null;
}

export default async function BookedPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const extras = params.ref
    ? await getConfirmationExtras(params.ref, bookingKindFor(params.type ?? "") ?? undefined)
    : {
        directions: null,
        ticketCode: null,
        operatorPhone: null,
        operator: null,
        paidOnlinePaise: null,
        balancePaise: null,
        pricePaise: null,
      };
  const confirmation = await resolve(params, extras);

  if (!confirmation) {
    return (
      <main className="page-flow flex flex-col items-center pt-24 pb-16 text-center">
        <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">
          We couldn&apos;t find that booking
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          The link may be out of date. Head back and try again.
        </p>
        <Link
          href="/explore"
          className="mt-6 flex h-12 items-center justify-center rounded-2xl bg-brand px-6 text-[14px] font-bold text-white"
        >
          Back to home
        </Link>
      </main>
    );
  }

  const { Icon, title, operator, whenLabel, detail, payNowPaise, totalPaise, headline, body } =
    confirmation;
  // Prefer the reference the database actually issued. The derived one is
  // only a fallback, for links made before bookings were real.
  const code = params.ref || refCode(JSON.stringify(params));
  const phone = await getMyPhone();
  const phoneVerified = await getMyPhoneVerified();
  const email = await getMyEmail();
  const balancePaise = totalPaise - payNowPaise;

  // A ferry drops you at a jetty, not the operator's office; its real e-ticket
  // is issued by the operator later, not the code we hold. Everything else is
  // somewhere you go, with a code the partner scans on arrival.
  //
  // A trip used to be excluded here too — the partner's registered business
  // address isn't where the day starts, and Directions would point somewhere
  // wrong. That's no longer the risk: subject_address/subject_maps_url (076,
  // restored by 129 after 096 accidentally dropped the case) already prefer
  // the trip's own meet_point/maps_url over the partner's address, so
  // extras.directions here resolves to the actual meeting point, not the
  // office — same as an activity's own address does.
  const isFerry = params.type === "ferry";
  const isCabRateCard = params.type === "cabrc";
  const directions = isFerry || isCabRateCard ? null : extras.directions;
  // The DB value if we have it; otherwise rebuild it the way create_booking
  // does ("<ref>-<kind initial>"), so a fresh booking always shows its ticket.
  // A rate-card cab has no ticket until admin_assign_cab_operator issues one
  // (082) — there's no "rebuild it" fallback for that, it just stays null.
  const ticketCode =
    isFerry || !params.ref
      ? null
      : isCabRateCard
        ? extras.ticketCode
        : (extras.ticketCode ?? `${params.ref}-${(params.type ?? "x").charAt(0).toUpperCase()}`);
  const ticketQr = ticketCode ? qrCode(`https://andamango.app/t/${ticketCode}`) : null;
  // For a rate-card cab, extras.operator reflects dispatch as of right now —
  // "Andaman Go Cabs" (the house partner, 077) until admin_assign_cab_operator
  // (082) re-points it at a real operator, at which point both this and
  // operatorPhone flip together.
  const operatorShort =
    isCabRateCard && extras.operator ? extras.operator.split(" · ")[0] : operator.split(" · ")[0];
  const operatorPhone = isFerry ? null : extras.operatorPhone;

  // WhatsApp opens pre-typed so the operator knows which booking it is.
  const whatsappText = [
    `Hi ${operatorShort}, about my Andaman Go booking.`,
    ``,
    ticketCode ? `Ticket: ${ticketCode}` : `Reference: ${code}`,
    `${title} — ${whenLabel}`,
    detail,
    phone ? `My number: ${phone}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const calendarUrl =
    confirmation.startsAtIso &&
    googleCalendarUrl({
      title: `${title} — ${operatorShort}`,
      startIso: confirmation.startsAtIso,
      minutes: confirmation.calendarMinutes ?? 120,
      location: directions?.addressLabel ?? operatorShort,
      details: `Andaman Go booking ${code}${ticketCode ? ` · ticket ${ticketCode}` : ""}`,
    });

  const hasSecondaryRow = Boolean(directions || calendarUrl);

  return (
    <main className="page-flow flex flex-col items-center pt-14 pb-16">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white">
        <CheckIcon size={30} />
      </span>

      <h1 className="font-display mt-4 text-center text-[22px] lg:text-page font-bold tracking-tight">
        {headline}
      </h1>
      <p className="mt-1.5 text-center text-[13px] leading-relaxed font-medium text-muted">
        {body}
      </p>

      {/* The ticket — one card: what you booked, the price, then the scan code. */}
      <div className="mt-6 w-full overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
              <Icon size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-tight font-bold">{title}</p>
              <p className="mt-1 text-[12px] font-medium text-muted">{operator}</p>
              <p className="mt-1.5 text-[12.5px] font-semibold text-ink">{whenLabel}</p>
              <p className="text-[12px] font-medium text-muted">{detail}</p>
            </div>
            <span className="shrink-0 rounded-full bg-ground px-2.5 py-1 text-[11px] font-bold tracking-wide text-muted">
              {code}
            </span>
          </div>

          {totalPaise > 0 && (
            <div className="mt-3.5 flex flex-col gap-1.5 border-t border-hairline pt-3">
              {balancePaise > 0 && (
                <>
                  <div className="flex justify-between text-[13px]">
                    <span className="font-medium text-muted">Paid now</span>
                    <span className="font-semibold">{rupees(payNowPaise)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="font-medium text-muted">Balance due</span>
                    <span className="font-semibold">{rupees(balancePaise)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-[14px] font-bold">
                <span>Total</span>
                <span>{rupees(totalPaise)}</span>
              </div>
            </div>
          )}
        </div>

        {ticketQr && (
          <div className="border-t border-dashed border-line bg-ground px-4 pt-5 pb-4 text-center">
            <div className="mx-auto w-fit rounded-[14px] border border-line bg-white p-3">
              <svg
                viewBox={`0 0 ${ticketQr.size} ${ticketQr.size}`}
                shapeRendering="crispEdges"
                className="block h-[116px] w-[116px] text-ink"
                role="img"
                aria-label={`Ticket ${ticketCode}`}
              >
                <path d={ticketQr.path} fill="currentColor" />
              </svg>
            </div>
            <p className="font-display mt-3 text-[17px] font-bold tracking-[0.14em]">{ticketCode}</p>
            <p className="mt-1 text-[11.5px] font-medium text-muted">
              Show this to {operatorShort} on the day
            </p>
          </div>
        )}
      </div>

      {(operatorPhone || hasSecondaryRow) && (
        <div className="mt-3 flex w-full flex-col gap-2">
          {directions?.addressLabel && (
            <p className="text-center text-[12px] font-medium text-muted">
              {directions.addressLabel}
            </p>
          )}

          {operatorPhone && (
            <OperatorContact phone={operatorPhone} whatsappText={whatsappText} className="flex gap-2" />
          )}

          {hasSecondaryRow && (
            <div className="flex gap-2">
              {directions && (
                <DirectionsButton directions={directions} className={secondaryAction} />
              )}
              {calendarUrl && (
                <a
                  href={calendarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={secondaryAction}
                >
                  <CalendarIcon size={16} />
                  Add to calendar
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {params.ref && (
        <PurchaseBeacon
          bookingRef={params.ref}
          kind={bookingKindFor(params.type ?? "") ?? "booking"}
          paidPaise={payNowPaise}
        />
      )}

      <PhonePrompt initialPhone={phone} initialVerified={phoneVerified} />
      <EmailPrompt initialEmail={email} />

      <div className="mt-8 flex w-full flex-col gap-2.5">
        <Link
          href="/bookings"
          className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-white"
        >
          View my bookings
          <ChevronIcon size={18} />
        </Link>
        <Link
          href="/explore"
          className="flex h-12 w-full items-center justify-center rounded-2xl border border-line bg-surface text-[14px] font-bold text-ink"
        >
          Book something else
        </Link>
      </div>
    </main>
  );
}
