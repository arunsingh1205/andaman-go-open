"use client";

// Every booking on the platform, filterable four ways, with the traveller's
// contact details and the one write an admin can make on a booking.
//
// Expanding a row rather than opening a drawer is deliberate: the useful
// thing about a bookings table is comparing rows, and a drawer covers the
// table you were comparing against. The detail an admin actually needs —
// who to ring, which ticket, why it was cancelled — is four short lines, so
// it fits underneath.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  assignCabOperator,
  cancelBookingAsAdmin,
  getAdminBookingThread,
  getCabDispatchDetail,
  getDispatchableCabs,
  getFerryPassengers,
  placeFerryBooking,
  type AdminBooking,
  type AdminFerryPassenger,
  type AdminThreadMessage,
  type CabDispatchDetail,
  type DispatchableCab,
} from "@/lib/admin-bookings";
import { CATEGORY_LABEL } from "@/lib/cabs";
import { DirectionsIcon } from "@/app/icons";
import { islandLabel } from "@/lib/islands";
import { PlainAction, ReasonAction } from "../admin-action";
import {
  PageHeader,
  Panel,
  ChipRow,
  Chip,
  SearchBox,
  RowHead,
  Row,
  Cell,
  EmptyState,
  Pill,
  rupees,
  bookingStatePill,
} from "../admin-ui";

const TRIP_TYPE_LABEL: Record<"oneway" | "roundtrip" | "outstation", string> = {
  oneway: "One-way",
  roundtrip: "Round trip",
  outstation: "Multi-day",
};
const TRIP_TYPE_TONE: Record<"oneway" | "roundtrip" | "outstation", "live" | "waiting" | "down"> = {
  oneway: "live",
  roundtrip: "waiting",
  outstation: "down",
};

type Window = "today" | "upcoming" | "past" | "all";

const WINDOWS: { key: Window; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "all", label: "Everything" },
];

const STATES: { key: string; label: string }[] = [
  { key: "all", label: "Any status" },
  { key: "confirmed", label: "Confirmed" },
  { key: "refunded", label: "Cancelled" },
  { key: "ferry-to-place", label: "Ferry · to place" },
  { key: "cab-to-assign", label: "Cab · needs driver" },
];

const COLS =
  "md:grid-cols-[110px_minmax(0,1.7fr)_minmax(0,1.2fr)_minmax(0,1fr)_140px_90px_32px]";

export default function BookingsView({
  bookings,
  partners,
  window,
  initialState,
}: {
  bookings: AdminBooking[];
  partners: { id: string; name: string }[];
  window: Window;
  initialState: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(
    STATES.some((s) => s.key === initialState) ? initialState : "all",
  );
  const [partnerId, setPartnerId] = useState("all");
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      if (state === "ferry-to-place") {
        if (booking.kind !== "ferry" || booking.ticket || booking.state === "refunded") return false;
      } else if (state === "cab-to-assign") {
        if (booking.kind !== "cab" || booking.cabId || booking.state === "refunded") return false;
      } else if (state !== "all" && booking.state !== state) {
        return false;
      }
      if (partnerId !== "all" && booking.partnerId !== partnerId) return false;
      if (!term) return true;
      return (
        booking.refCode.toLowerCase().includes(term) ||
        booking.title.toLowerCase().includes(term) ||
        booking.partnerName.toLowerCase().includes(term) ||
        (booking.contactPhone ?? "").toLowerCase().includes(term) ||
        (booking.contactEmail ?? "").toLowerCase().includes(term) ||
        (booking.ticket ?? "").toLowerCase().includes(term)
      );
    });
  }, [bookings, state, partnerId, search]);

  const gross = rows.reduce((sum, b) => sum + b.pricePaise, 0);

  // Only businesses that actually appear in this window are worth offering —
  // a dropdown of every partner on the platform, most of which would return
  // nothing, is a worse control than a short one that always finds something.
  const relevantPartners = useMemo(() => {
    const seen = new Set(bookings.map((b) => b.partnerId));
    return partners.filter((p) => seen.has(p.id));
  }, [bookings, partners]);

  const setWindow = (next: Window) => {
    router.push(`/admin/bookings?window=${next}`);
  };

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle={`${rows.length} ${rows.length === 1 ? "booking" : "bookings"} · ${rupees(gross)} at booked prices`}
      >
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Reference, ticket, phone, listing…"
        />
      </PageHeader>

      <ChipRow>
        {WINDOWS.map((w) => (
          <Chip
            key={w.key}
            label={w.label}
            active={window === w.key}
            onClick={() => setWindow(w.key)}
          />
        ))}
      </ChipRow>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <ChipRow>
          {STATES.map((s) => (
            <Chip
              key={s.key}
              label={s.label}
              active={state === s.key}
              onClick={() => setState(s.key)}
            />
          ))}
        </ChipRow>

        {relevantPartners.length > 1 && (
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="h-9 rounded-xl border border-line bg-surface px-3 text-[12.5px] font-bold text-ink outline-none focus:border-brand"
          >
            <option value="all">Every business</option>
            {relevantPartners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <Panel className="mt-4">
        <RowHead cols={COLS}>
          <span>When</span>
          <span>What</span>
          <span>Business</span>
          <span>Traveller</span>
          <span>Status</span>
          <span className="text-right">Price</span>
          <span />
        </RowHead>

        {rows.length === 0 ? (
          <EmptyState>
            {search.trim() || state !== "all" || partnerId !== "all"
              ? "No booking matches those filters."
              : "Nothing in this window."}
          </EmptyState>
        ) : (
          rows.map((booking) => {
            const open = openRow === booking.itemId;
            return (
              <div key={booking.itemId} className="border-b border-hairline last:border-b-0">
                <Row cols={COLS}>
                  <Cell label="When">
                    <span className="block text-[12.5px] font-bold">{booking.dateLabel}</span>
                    <span className="block text-[11.5px] font-medium text-muted">
                      {booking.timeLabel}
                    </span>
                  </Cell>

                  <Cell label="What">
                    <span className="block truncate text-[13.5px] font-bold">{booking.title}</span>
                    <span className="block truncate text-[11.5px] font-medium text-muted">
                      {booking.refCode} · {booking.detail}
                    </span>
                  </Cell>

                  <Cell label="Business">
                    <Link
                      href={`/admin/partners/${booking.partnerId}`}
                      className="block truncate text-[12.5px] font-bold text-brand hover:underline"
                    >
                      {booking.partnerName}
                    </Link>
                  </Cell>

                  <Cell label="Traveller">
                    <span className="block truncate text-[12.5px] font-medium text-muted">
                      {booking.contactPhone ?? booking.contactEmail ?? "—"}
                    </span>
                  </Cell>

                  <Cell label="Status">
                    {bookingStatePill(booking.state, booking.redeemedAt !== null, booking.refundStatus)}
                  </Cell>

                  <Cell label="Price" className="md:text-right">
                    <span className="text-[13px] font-bold">{rupees(booking.pricePaise)}</span>
                  </Cell>

                  <Cell className="md:flex md:justify-end">
                    <button
                      type="button"
                      onClick={() => setOpenRow(open ? null : booking.itemId)}
                      aria-expanded={open}
                      className="text-[12px] font-bold text-brand"
                    >
                      {open ? "Less" : "More"}
                    </button>
                  </Cell>
                </Row>

                {open && <BookingDetail booking={booking} />}
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}

function BookingDetail({ booking }: { booking: AdminBooking }) {
  const canCancel = booking.state === "pending" || booking.state === "confirmed";

  return (
    <div className="border-t border-hairline bg-ground px-5 py-4">
      <dl className="grid gap-3 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Reference" value={booking.refCode} />
        <Detail label="Ticket" value={booking.ticket ?? "Not issued yet"} />
        {booking.contactName && <Detail label="Name" value={booking.contactName} />}
        <Detail label="Phone" value={booking.contactPhone ?? "Not given"} />
        <Detail label="Email" value={booking.contactEmail ?? "Not given"} />
        <Detail
          label="Island"
          value={islandLabel(booking.islandSlug)}
          className="capitalize"
        />
        <Detail
          label="Checked in"
          value={
            booking.redeemedAt
              ? new Date(booking.redeemedAt).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "Asia/Kolkata",
                })
              : "Not yet"
          }
        />
        {booking.cancelledNote && (
          <div className="sm:col-span-2">
            <dt className="text-[11px] font-bold tracking-wider text-muted uppercase">
              Cancelled by an admin
            </dt>
            <dd className="mt-1 font-medium text-warn">{booking.cancelledNote}</dd>
          </div>
        )}
      </dl>

      {booking.kind === "ferry" && <FerryPlacement booking={booking} />}
      {booking.kind === "cab" && !booking.cabId && <CabDispatch booking={booking} />}

      <BookingThread itemId={booking.itemId} />

      {canCancel && (
        <div className="mt-4 border-t border-line pt-4">
          <ReasonAction
            size="sm"
            label="Cancel this booking"
            confirmLabel="Confirm cancel"
            busyLabel="Cancelling…"
            prompt={`This frees the slot and the traveller sees it as refunded. ${booking.partnerName} will find a booking they didn't cancel, so say why — they can read this.`}
            placeholder="Why is Andaman Go cancelling this?"
            onConfirm={(reason) => cancelBookingAsAdmin(booking.itemId, reason)}
          />
        </div>
      )}
    </div>
  );
}

const ID_LABEL: Record<string, string> = {
  aadhaar: "Aadhaar",
  passport: "Passport",
  "driving-licence": "Driving licence",
};

function FerryPlacement({ booking }: { booking: AdminBooking }) {
  const [passengers, setPassengers] = useState<AdminFerryPassenger[] | null>(null);

  useEffect(() => {
    let alive = true;
    getFerryPassengers(booking.itemId).then((p) => {
      if (alive) setPassengers(p);
    });
    return () => {
      alive = false;
    };
  }, [booking.itemId]);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
        Passengers to book with {booking.partnerName}
      </p>

      {passengers === null ? (
        <p className="mt-2 text-[12px] font-medium text-muted">Loading…</p>
      ) : passengers.length === 0 ? (
        <p className="mt-2 text-[12px] font-medium text-warn">
          No passenger details were saved — chase the traveller before placing this.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {passengers.map((p, i) => (
            <li key={i} className="text-[12px] leading-relaxed font-medium">
              <span className="font-bold">{p.fullName}</span> · {p.age} · {p.gender} ·{" "}
              {p.nationality} · {ID_LABEL[p.idType] ?? p.idType} {p.idNumber}
            </li>
          ))}
        </ul>
      )}

      {booking.ticket ? (
        <p className="mt-3 text-[12.5px] font-semibold text-brand">
          Placed · PNR {booking.ticket}
        </p>
      ) : (
        booking.state !== "refunded" && (
          <div className="mt-3">
            <ReasonAction
              size="sm"
              variant="quiet"
              label="Enter PNR"
              confirmLabel="Save PNR"
              busyLabel="Saving…"
              prompt="Book it with the operator, then paste the PNR / ticket reference here. The traveller sees it on their booking."
              placeholder="e.g. MK-2384719"
              onConfirm={(pnr) => placeFerryBooking(booking.itemId, pnr)}
            />
          </div>
        )
      )}
    </div>
  );
}

/**
 * A rate-card cab booking (077/078) is paid and confirmed but has no car
 * yet — cab_id is null, and it needs a person to actually go find one. This
 * only ever renders in that state (BookingDetail gates it on !cabId):
 * assigning a car hands the booking to that operator for good, the same way
 * a car chosen at booking time in the marketplace flow is — so there's no
 * "reassign" here, only "assign".
 */
function CabDispatch({ booking }: { booking: AdminBooking }) {
  const [detail, setDetail] = useState<CabDispatchDetail | null>(null);
  const [cabs, setCabs] = useState<DispatchableCab[] | null>(null);
  const [pick, setPick] = useState("");

  useEffect(() => {
    let alive = true;
    getCabDispatchDetail(booking.itemId).then((d) => {
      if (alive) setDetail(d);
    });
    getDispatchableCabs(booking.islandSlug).then((rows) => {
      if (alive) setCabs(rows);
    });
    return () => {
      alive = false;
    };
  }, [booking.itemId, booking.islandSlug]);

  const routeLabel = detail
    ? detail.tripType === "outstation"
      ? `${detail.toLabel ?? "—"} · ${detail.days} day${detail.days === 1 ? "" : "s"}`
      : `${detail.fromLabel ?? "Standard city pickup"} → ${detail.toLabel ?? "Local hop"}`
    : null;

  const sorted = useMemo(() => {
    if (!cabs) return [];
    return [...cabs].sort((a, b) => Number(b.category === "suv") - Number(a.category === "suv"));
  }, [cabs]);

  const assign = async () => {
    if (!pick) return { ok: false, message: "Pick a car first." };
    const result = await assignCabOperator(booking.itemId, pick);
    if (result.ok) setPick("");
    return result;
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Needs a car</p>

      {detail === null ? (
        <p className="mt-2 text-[12px] font-medium text-muted">Loading…</p>
      ) : (
        <>
          <Pill tone={TRIP_TYPE_TONE[detail.tripType]}>{TRIP_TYPE_LABEL[detail.tripType]}</Pill>
          <p className="mt-1.5 text-[12.5px] font-semibold">
            {routeLabel}
            {detail.pickupNote && (
              <span className="block text-[11.5px] font-medium text-muted">{detail.pickupNote}</span>
            )}
          </p>
          {detail.pinMapsUrl && (
            <a
              href={detail.pinMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[11.5px] font-bold text-brand"
            >
              <DirectionsIcon size={13} />
              Traveller&apos;s exact pin
            </a>
          )}
        </>
      )}

      {booking.state !== "refunded" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {cabs === null ? (
            <p className="text-[12px] font-medium text-muted">Loading listed cars…</p>
          ) : cabs.length === 0 ? (
            <p className="text-[12px] font-medium text-warn">
              No approved, listed cab operator on this island yet.
            </p>
          ) : (
            <>
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="h-9 rounded-xl border border-line bg-surface px-3 text-[12.5px] font-bold text-ink outline-none focus:border-brand"
              >
                <option value="">Pick a car…</option>
                {sorted.map((c) => (
                  <option key={c.cabId} value={c.cabId}>
                    {c.operatorName} · {c.model} ({CATEGORY_LABEL[c.category]})
                  </option>
                ))}
              </select>
              <PlainAction size="sm" variant="primary" label="Assign" busyLabel="Assigning…" onRun={assign} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BookingThread({ itemId }: { itemId: string }) {
  const [messages, setMessages] = useState<AdminThreadMessage[] | null>(null);

  useEffect(() => {
    let alive = true;
    getAdminBookingThread(itemId).then((m) => {
      if (alive) setMessages(m);
    });
    return () => {
      alive = false;
    };
  }, [itemId]);

  if (messages === null || messages.length === 0) return null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
        Traveller ↔ partner messages
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {messages.map((m, i) => (
          <li key={i} className="text-[12px] leading-relaxed">
            <span className="font-bold">{m.fromPartner ? "Partner" : "Traveller"}: </span>
            <span className="font-medium">{m.body}</span>
            <span className="ml-1.5 text-[10.5px] font-semibold text-muted">{m.stampLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] font-bold tracking-wider text-muted uppercase">{label}</dt>
      <dd className={`mt-1 font-medium ${className}`}>{value}</dd>
    </div>
  );
}
