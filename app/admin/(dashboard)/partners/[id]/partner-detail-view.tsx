"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  approvePartner,
  rejectPartner,
  suspendPartner,
  reactivatePartner,
  deletePartner,
  approveListing,
  rejectListing,
  unlistListing,
  deleteListing,
  type PendingPartner,
  type PartnerListing,
} from "@/lib/admin-review";
import { setPartnerCommission } from "@/lib/admin-commission";
// Cancelling a booking lives on the Bookings screen, not here — this panel
// is the business's track record, and a row of destructive buttons in a
// history list is an easy misclick.
import { type AdminBooking } from "@/lib/admin-bookings";
import type { AdminPartnerOverview } from "@/lib/admin-partner-overview";
import { partnerPhotoUrl } from "@/lib/partner-storage";
import { adminLicenseDocUrl } from "@/lib/admin-storage";
import { islandLabel } from "@/lib/islands";
import { ReasonAction, PlainAction } from "../../admin-action";
import {
  Panel,
  EmptyState,
  rupees,
  partnerStatusPill,
  bookingStatePill,
  Pill,
  RowHead,
  Row,
  Cell,
} from "../../admin-ui";
import { BackIcon, PinIcon, DownloadIcon, ClockIcon, PlusIcon } from "@/app/icons";

const LISTING_COLS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_120px_minmax(0,auto)]";
const BOOKING_COLS = "md:grid-cols-[110px_minmax(0,1.6fr)_minmax(0,1fr)_130px_90px]";

const KIND_LABEL: Record<string, string> = {
  activity: "Activity",
  rental: "Rental",
  cab: "Cab / car",
  stay: "Stay / homestay",
  event: "Event",
  trip: "Day trip",
  ferry: "Ferry sailing",
  community: "Community service",
  // Retired (095) — kept only so a historical restaurant booking still shows
  // a real label here instead of the raw db value.
  table: "Restaurant",
};

export default function PartnerDetailView({
  partner,
  listings,
  bookings,
  overview,
}: {
  partner: PendingPartner;
  listings: PartnerListing[];
  bookings: AdminBooking[];
  overview: AdminPartnerOverview;
}) {
  const upcoming = bookings.filter((b) => b.when !== "past");
  const delivered = bookings.filter((b) => b.redeemedAt !== null);
  const grossPaise = delivered.reduce((sum, b) => sum + b.pricePaise, 0);

  return (
    <>
      <Link
        href="/admin/partners"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted hover:text-ink"
      >
        <BackIcon size={15} />
        All partners
      </Link>

      <PartnerHeader partner={partner} />

      {partner.rejectionReason && (
        <div className="mt-4 rounded-2xl border border-sandline bg-sandsoft px-4 py-3 text-[13px] font-medium text-sandink2">
          <span className="font-bold">
            {partner.status === "suspended"
              ? "Suspended: "
              : partner.status === "deleted"
                ? "Deleted: "
                : "Rejected: "}
          </span>
          {partner.rejectionReason}
        </div>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <ContactPanel partner={partner} />
          <CommissionPanel partner={partner} />
          <Panel title="Track record">
            <dl className="grid grid-cols-2 gap-px bg-hairline">
              <Figure label="Delivered" value={String(delivered.length)} />
              <Figure label="Gross" value={rupees(grossPaise)} />
              <Figure label="Upcoming" value={String(upcoming.length)} />
              <Figure label="Listings" value={String(listings.length)} />
            </dl>
          </Panel>
          <TeamPolicyPanel overview={overview} />
        </div>

        <div className="flex flex-col gap-4">
          <ListingsPanel partner={partner} listings={listings} />
          <BookingsPanel bookings={bookings} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function PartnerHeader({ partner }: { partner: PendingPartner }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start gap-4">
        {partner.coverPhotoPath ? (
          <Image
            src={partnerPhotoUrl(partner.coverPhotoPath)}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-2xl border border-line object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-dashed border-line text-[10px] font-medium text-muted">
            No photo
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[22px] leading-tight font-bold tracking-tight">
              {partner.name}
            </h1>
            {partnerStatusPill(partner.status)}
          </div>
          <p className="mt-1 text-[13px] font-medium text-muted capitalize">
            {partner.kindLabel} · {islandLabel(partner.islandSlug)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
            <ClockIcon size={11} />
            Joined{" "}
            {new Date(partner.createdAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        <PartnerActions partner={partner} />
        <Link
          href={`/admin/partners/${partner.id}/edit`}
          className="inline-flex h-9 items-center rounded-xl border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink hover:border-brand hover:text-brand"
        >
          Edit details
        </Link>
      </div>
    </div>
  );
}

function PartnerActions({ partner }: { partner: PendingPartner }) {
  // What you can do depends entirely on where the business already is, and
  // the database agrees — admin_suspend_partner refuses anything that isn't
  // live, admin_reactivate_partner refuses anything that isn't suspended,
  // admin_delete_partner refuses a business that's already deleted. So these
  // branches are a convenience, never the enforcement.
  if (partner.status === "deleted") {
    return (
      <p className="text-[12.5px] font-medium text-muted">
        Deleted. There is no way back from here — a business that should be selling again needs a
        fresh signup.
      </p>
    );
  }

  let statusAction: React.ReactNode;

  if (partner.status === "pending") {
    statusAction = (
      <>
        {partner.commissionBps == null ? (
          <p className="self-center text-[12.5px] font-medium text-muted">
            Set a commission rate below before you can approve this business.
          </p>
        ) : (
          <PlainAction
            label="Approve this business"
            busyLabel="Approving…"
            onRun={() => approvePartner(partner.id)}
          />
        )}
        <ReasonAction
          label="Reject"
          confirmLabel="Confirm reject"
          busyLabel="Rejecting…"
          prompt="The partner reads this on their own Business tab, and can fix it and resubmit."
          placeholder="What needs to change before this can be approved?"
          onConfirm={(reason) => rejectPartner(partner.id, reason)}
        />
      </>
    );
  } else if (partner.status === "approved") {
    statusAction = (
      <ReasonAction
        label="Suspend this business"
        confirmLabel="Confirm suspend"
        busyLabel="Suspending…"
        prompt="This hides the business and every one of its listings from travellers straight away. The partner sees this reason."
        placeholder="Why is this business coming off the app?"
        onConfirm={(reason) => suspendPartner(partner.id, reason)}
      />
    );
  } else if (partner.status === "suspended") {
    statusAction = (
      <>
        <PlainAction
          label="Bring back online"
          busyLabel="Restoring…"
          onRun={() => reactivatePartner(partner.id)}
        />
        <p className="self-center text-[12px] font-medium text-muted">
          Listings return in whatever state they were already in.
        </p>
      </>
    );
  } else {
    // Rejected. There is deliberately no "un-reject" button: the partner's
    // own resubmit is what moves this along, so the next look is at
    // something they have actually changed.
    statusAction = (
      <p className="self-center text-[12.5px] font-medium text-muted">
        Rejected. This business comes back to the queue when the partner resubmits it themselves.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {statusAction}
      <ReasonAction
        label="Delete this business"
        confirmLabel="Confirm delete"
        busyLabel="Deleting…"
        prompt="This removes the business and every one of its listings from the app for good — there is no bringing it back online afterwards. Bookings already made are left as they are."
        placeholder="Why is this business being deleted?"
        onConfirm={(reason) => deletePartner(partner.id, reason)}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-5 py-3.5">
      <dt className="text-[11px] font-bold tracking-wider text-muted uppercase">{label}</dt>
      <dd className="font-display mt-1 text-[20px] leading-none font-bold tracking-tight">
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TeamPolicyPanel({ overview }: { overview: AdminPartnerOverview }) {
  return (
    <Panel title="Team & policy">
      <div className="flex flex-col gap-4 px-5 py-4 text-[12.5px]">
        <div>
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Team</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {overview.team.map((m) => (
              <li key={m.email ?? m.role} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{m.email ?? "—"}</span>
                <Pill tone={m.role === "owner" ? "live" : "muted"}>{m.role}</Pill>
              </li>
            ))}
            {overview.invites.map((i) => (
              <li key={`inv-${i.email}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-muted">{i.email}</span>
                <Pill tone="waiting">invited</Pill>
              </li>
            ))}
            {overview.team.length === 0 && overview.invites.length === 0 && (
              <li className="font-medium text-muted">No one linked.</li>
            )}
          </ul>
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[11px] font-bold tracking-wider text-muted uppercase">
              Cancellation
            </dt>
            <dd className="mt-1 font-medium">Platform policy</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold tracking-wider text-muted uppercase">Payout</dt>
            <dd className="mt-1 font-medium">
              {overview.hasPayoutAccount ? "On file" : "Not set"}
            </dd>
          </div>
        </dl>

        {overview.closures.length > 0 && (
          <div>
            <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
              Upcoming closures
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {overview.closures.map((c, idx) => (
                <li key={idx} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-bold">
                    {new Date(`${c.onDate}T00:00:00Z`).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      timeZone: "UTC",
                    })}
                  </span>
                  <span className="min-w-0 truncate font-medium text-muted">{c.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function ContactPanel({ partner }: { partner: PendingPartner }) {
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const viewLicense = async () => {
    if (!partner.licenseDocPath) return;
    setBusy(true);
    const url = await adminLicenseDocUrl(partner.licenseDocPath);
    setBusy(false);
    if (url) setLicenseUrl(url);
  };

  return (
    <Panel title="Contact & licence">
      <dl className="flex flex-col gap-3 px-5 py-4 text-[13px]">
        <Field label="Phone" value={partner.contactPhone} />
        <Field label="Address" value={partner.address} />

        <div>
          <dt className="text-[11px] font-bold tracking-wider text-muted uppercase">Directions</dt>
          <dd className="mt-1">
            {partner.mapsUrl ? (
              <a
                href={partner.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-bold text-brand"
              >
                <PinIcon size={13} />
                Open in Maps
              </a>
            ) : (
              <span className="font-medium text-muted">Not set</span>
            )}
          </dd>
        </div>

        <Field label="Licence number" value={partner.licenseNumber} />

        <div>
          <dt className="text-[11px] font-bold tracking-wider text-muted uppercase">
            Licence document
          </dt>
          <dd className="mt-1">
            {!partner.licenseDocPath ? (
              <span className="font-medium text-muted">Not uploaded</span>
            ) : licenseUrl ? (
              <a
                href={licenseUrl}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-brand underline"
              >
                Open document
              </a>
            ) : (
              <button
                type="button"
                onClick={viewLicense}
                disabled={busy}
                className="inline-flex items-center gap-1.5 font-bold text-brand disabled:opacity-50"
              >
                <DownloadIcon size={13} />
                {busy ? "Fetching…" : "View licence document"}
              </button>
            )}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Commission — this business's own agreed rate (137), not a category default.
// Required before the business can be approved (the RPC is the real gate;
// PartnerActions above just hides the Approve button until it's set).
// ---------------------------------------------------------------------------

function CommissionPanel({ partner }: { partner: PendingPartner }) {
  const router = useRouter();
  const current = partner.commissionBps != null ? partner.commissionBps / 100 : null;
  const [draft, setDraft] = useState(current != null ? String(current) : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");

  const dirty = draft.trim() !== "" && Number(draft) !== current;

  // Just a scratch calculator — nothing here reads or writes a real booking.
  // Lets Arun sanity-check a rate against a price before saving it: type
  // what the service costs, see the split at whatever % is currently typed
  // above (saved or not).
  const pricePaise = Math.round((Number(priceInput) || 0) * 100);
  const calcPct = Number(draft);
  const showCalc = priceInput.trim() !== "" && pricePaise > 0 && !Number.isNaN(calcPct) && calcPct >= 0;
  const andamanGoesPaise = showCalc ? Math.round((pricePaise * calcPct) / 100) : 0;
  const partnerGetsPaise = showCalc ? pricePaise - andamanGoesPaise : 0;

  const save = async () => {
    const pct = Number(draft);
    if (draft.trim() === "" || Number.isNaN(pct) || pct < 0 || pct > 100) {
      setProblem("Enter a percentage between 0 and 100.");
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await setPartnerCommission(partner.id, Math.round(pct * 100));
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <Panel title="Commission">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={current == null ? "Not set" : undefined}
            inputMode="decimal"
            className="h-9 w-16 rounded-lg border border-line bg-surface px-2 text-right text-[13px] font-bold outline-none focus:border-brand"
          />
          <span className="text-[12.5px] font-bold text-muted">%</span>
        </div>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={save}
          className="h-9 shrink-0 rounded-lg bg-brand px-3 text-[11.5px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "…" : "Save"}
        </button>
        <span className="text-[11.5px] font-medium text-muted">
          {current == null ? "Agree a rate with this business before approving it." : "of the full price"}
        </span>
      </div>
      {problem && <p className="px-5 pb-4 text-[11.5px] font-medium text-warn">{problem}</p>}

      <div className="border-t border-hairline px-5 py-4">
        <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
          Quick check — reference only
        </p>
        <p className="mt-1 text-[11.5px] font-medium text-muted">
          Type a service price to see the split at the % above, whether it&apos;s saved yet or not.
          Doesn&apos;t touch any booking.
        </p>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="text-[13px] font-bold text-muted">₹</span>
          <input
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="3000"
            inputMode="decimal"
            className="h-9 w-24 rounded-lg border border-line bg-surface px-2 text-[13px] font-bold outline-none focus:border-brand"
          />
          <span className="text-[11.5px] font-medium text-muted">
            at {draft.trim() === "" ? "—" : `${draft}%`}
          </span>
        </div>
        {showCalc && (
          <dl className="mt-2.5 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <dt className="text-[10.5px] font-bold tracking-wide text-muted uppercase">You get</dt>
              <dd className="mt-0.5 text-[14px] font-bold text-brand">{rupees(andamanGoesPaise)}</dd>
            </div>
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <dt className="text-[10.5px] font-bold tracking-wide text-muted uppercase">Partner gets</dt>
              <dd className="mt-0.5 text-[14px] font-bold">{rupees(partnerGetsPaise)}</dd>
            </div>
          </dl>
        )}
      </div>
    </Panel>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-bold tracking-wider text-muted uppercase">{label}</dt>
      <dd className={`mt-1 ${value ? "font-medium" : "font-medium text-muted"}`}>
        {value ?? "Not set"}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ListingsPanel({
  partner,
  listings,
}: {
  partner: PendingPartner;
  listings: PartnerListing[];
}) {
  return (
    <Panel
      title={`Listings (${listings.length})`}
      action={
        partner.status === "deleted" ? undefined : (
          <Link
            href={`/admin/partners/${partner.id}/add`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-bold text-white hover:opacity-90"
          >
            <PlusIcon size={13} />
            Add listing
          </Link>
        )
      }
    >
      {listings.length === 0 ? (
        <EmptyState>
          This business hasn&apos;t added any listings yet — use &ldquo;Add listing&rdquo; to add
          the first one for them.
        </EmptyState>
      ) : (
        <>
          <RowHead cols={LISTING_COLS}>
            <span>Listing</span>
            <span>Detail</span>
            <span>Status</span>
            <span />
          </RowHead>
          {listings.map((listing) => (
            <Row key={`${listing.kind}-${listing.id}`} cols={LISTING_COLS}>
              <Cell>
                <span className="block truncate text-[13.5px] font-bold">{listing.title}</span>
                <span className="block text-[11.5px] font-medium text-muted">
                  {KIND_LABEL[listing.kind] ?? listing.kind}
                </span>
              </Cell>

              <Cell label="Detail">
                <span className="block truncate text-[12.5px] font-medium text-muted">
                  {listing.detail}
                </span>
              </Cell>

              <Cell label="Status">
                {listing.isListed ? (
                  <Pill tone="live">Live</Pill>
                ) : listing.rejectionReason ? (
                  <Pill tone="down">Sent back</Pill>
                ) : (
                  <Pill tone="waiting">Waiting</Pill>
                )}
              </Cell>

              <Cell className="md:flex md:justify-end md:gap-2">
                <Link
                  href={`/admin/listings/${listing.kind}/${listing.id}/edit`}
                  className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[12px] font-bold text-ink hover:border-brand hover:text-brand"
                >
                  Edit
                </Link>
                <ListingActions listing={listing} />
              </Cell>
            </Row>
          ))}
        </>
      )}
    </Panel>
  );
}

function ListingActions({ listing }: { listing: PartnerListing }) {
  let statusAction: React.ReactNode;

  if (listing.isListed) {
    statusAction = (
      <ReasonAction
        size="sm"
        label="Take down"
        confirmLabel="Confirm take down"
        busyLabel="Taking down…"
        prompt="This hides the listing from travellers now. The partner sees this reason and can fix it and resubmit."
        placeholder="What is wrong with this listing?"
        onConfirm={(reason) => unlistListing(listing.kind, listing.id, reason)}
      />
    );
  } else if (listing.rejectionReason) {
    statusAction = (
      <p className="self-center text-[11.5px] font-medium text-muted md:max-w-[220px] md:text-right">
        Waiting on the partner to resubmit.
      </p>
    );
  } else {
    statusAction = (
      <>
        <PlainAction
          size="sm"
          label="Approve"
          busyLabel="Approving…"
          onRun={() => approveListing(listing.kind, listing.id)}
        />
        <ReasonAction
          size="sm"
          label="Reject"
          confirmLabel="Confirm reject"
          busyLabel="Rejecting…"
          prompt="The partner reads this and can fix it and resubmit."
          placeholder="What needs to change?"
          onConfirm={(reason) => rejectListing(listing.kind, listing.id, reason)}
        />
      </>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-2 md:justify-end">
      {statusAction}
      <ReasonAction
        size="sm"
        label="Delete"
        confirmLabel="Confirm delete"
        busyLabel="Deleting…"
        prompt="This removes the listing everywhere, for good — no resubmitting it back. Any bookings already made are left as they are."
        placeholder="Why is this being deleted?"
        onConfirm={(reason) => deleteListing(listing.kind, listing.id, reason)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function BookingsPanel({ bookings }: { bookings: AdminBooking[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? bookings : bookings.slice(0, 10);

  return (
    <Panel
      title={`Bookings (${bookings.length})`}
      action={
        bookings.length > 10 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[12px] font-bold text-brand"
          >
            {showAll ? "Show less" : `Show all ${bookings.length}`}
          </button>
        ) : null
      }
    >
      {bookings.length === 0 ? (
        <EmptyState>Nothing has been booked with this business yet.</EmptyState>
      ) : (
        <>
          <RowHead cols={BOOKING_COLS}>
            <span>When</span>
            <span>What</span>
            <span>Traveller</span>
            <span>Status</span>
            <span className="text-right">Price</span>
          </RowHead>
          {shown.map((booking) => (
            <Row key={booking.itemId} cols={BOOKING_COLS}>
              <Cell label="When">
                <span className="block text-[12.5px] font-bold">{booking.dateLabel}</span>
                <span className="block text-[11.5px] font-medium text-muted">
                  {booking.timeLabel}
                </span>
              </Cell>
              <Cell label="What">
                <span className="block truncate text-[13px] font-bold">{booking.title}</span>
                <span className="block text-[11.5px] font-medium text-muted">
                  {booking.refCode} · {booking.detail}
                </span>
              </Cell>
              <Cell label="Traveller">
                <span className="block truncate text-[12.5px] font-medium text-muted">
                  {booking.contactPhone ?? booking.contactEmail ?? "—"}
                </span>
              </Cell>
              <Cell label="Status">
                {bookingStatePill(booking.state, booking.redeemedAt !== null)}
              </Cell>
              <Cell label="Price" className="md:text-right">
                <span className="text-[13px] font-bold">{rupees(booking.pricePaise)}</span>
              </Cell>
            </Row>
          ))}
        </>
      )}
    </Panel>
  );
}
