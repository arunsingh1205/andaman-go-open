"use client";

// Every listing waiting on a decision, across every business and all seven
// catalogue kinds — plus, new this round, everything already live, so a
// listing that turns out to be wrong can come down without pretending it was
// never reviewed (admin_unlist_listing, 018).
//
// The kind filter matters more than it looks. "Approve everything waiting"
// is a different job depending on what you are approving — a ferry sailing
// needs its route checked, a cab needs its board number checked — and being
// able to do one kind at a time is how that stays quick.

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  approveListing,
  rejectListing,
  unlistListing,
  deleteListing,
  type PendingListing,
  type PendingPartner,
  type ListingKind,
} from "@/lib/admin-review";
import { islandLabel } from "@/lib/islands";
import { ReasonAction, PlainAction } from "../admin-action";
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
  partnerStatusPill,
} from "../admin-ui";
import {
  DiveIcon,
  ScooterIcon,
  CarIcon,
  BedIcon,
  MusicIcon,
  SunSeaIcon,
  FerryIcon,
  HandsIcon,
  ChevronIcon,
  PlusIcon,
} from "@/app/icons";

type Bucket = "pending" | "live" | "rejected";

const KIND_META: Record<
  ListingKind,
  { label: string; Icon: (p: { size?: number }) => React.JSX.Element }
> = {
  activity: { label: "Activity", Icon: DiveIcon },
  rental: { label: "Rental", Icon: ScooterIcon },
  cab: { label: "Cab / car", Icon: CarIcon },
  stay: { label: "Stay / homestay", Icon: BedIcon },
  event: { label: "Event", Icon: MusicIcon },
  trip: { label: "Day trip", Icon: SunSeaIcon },
  ferry: { label: "Ferry", Icon: FerryIcon },
  community: { label: "Community service", Icon: HandsIcon },
};

const KIND_ORDER: ListingKind[] = [
  "activity",
  "rental",
  "cab",
  "stay",
  "event",
  "trip",
  "ferry",
  "community",
];

const COLS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_100px_minmax(0,auto)]";

type View = "listings" | "business";

export default function ListingsView({
  pending,
  rejected,
  live,
  partners,
  initialView,
}: {
  pending: PendingListing[];
  rejected: PendingListing[];
  live: PendingListing[];
  partners: PendingPartner[];
  initialView: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [search, setSearch] = useState("");

  return (
    <>
      <PageHeader
        title="Listings"
        subtitle={
          pending.length === 0
            ? "Nothing waiting on a decision."
            : `${pending.length} waiting on a decision.`
        }
      >
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={view === "business" ? "Search business or listing…" : "Search listing or business…"}
        />
      </PageHeader>

      <ChipRow>
        <Chip label="By listing" active={view === "listings"} onClick={() => setView("listings")} />
        <Chip
          label="By business"
          count={partners.filter((p) => p.status !== "deleted").length}
          active={view === "business"}
          onClick={() => setView("business")}
        />
      </ChipRow>

      {view === "business" ? (
        <BusinessesPanel
          partners={partners}
          pending={pending}
          live={live}
          rejected={rejected}
          search={search}
        />
      ) : (
        <ListingsQueue pending={pending} live={live} rejected={rejected} search={search} />
      )}
    </>
  );
}

function ListingsQueue({
  pending,
  rejected,
  live,
  search,
}: {
  pending: PendingListing[];
  rejected: PendingListing[];
  live: PendingListing[];
  search: string;
}) {
  const [bucket, setBucket] = useState<Bucket>("pending");
  const [kind, setKind] = useState<ListingKind | "all">("all");

  const source = bucket === "pending" ? pending : bucket === "live" ? live : rejected;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return source.filter((listing) => {
      if (kind !== "all" && listing.kind !== kind) return false;
      if (!term) return true;
      return (
        listing.title.toLowerCase().includes(term) ||
        listing.partnerName.toLowerCase().includes(term) ||
        listing.detail.toLowerCase().includes(term)
      );
    });
  }, [source, kind, search]);

  const kindCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const listing of source) out[listing.kind] = (out[listing.kind] ?? 0) + 1;
    return out;
  }, [source]);

  return (
    <>
      <div className="mt-2.5">
        <ChipRow>
          <Chip
            label="Waiting"
            count={pending.length}
            active={bucket === "pending"}
            onClick={() => setBucket("pending")}
          />
          <Chip
            label="Live"
            count={live.length}
            active={bucket === "live"}
            onClick={() => setBucket("live")}
          />
          <Chip
            label="Sent back"
            count={rejected.length}
            active={bucket === "rejected"}
            onClick={() => setBucket("rejected")}
          />
        </ChipRow>
      </div>

      <div className="mt-2.5">
        <ChipRow>
          <Chip label="All kinds" active={kind === "all"} onClick={() => setKind("all")} />
          {KIND_ORDER.filter((k) => (kindCounts[k] ?? 0) > 0).map((k) => (
            <Chip
              key={k}
              label={KIND_META[k].label}
              count={kindCounts[k]}
              active={kind === k}
              onClick={() => setKind(k)}
            />
          ))}
        </ChipRow>
      </div>

      <Panel className="mt-4">
        <RowHead cols={COLS}>
          <span>Listing</span>
          <span>Business</span>
          <span>Kind</span>
          <span />
        </RowHead>

        {rows.length === 0 ? (
          <EmptyState>
            {bucket === "pending"
              ? "Nothing waiting on you here."
              : bucket === "live"
                ? "Nothing live in this filter."
                : "Nothing sent back."}
          </EmptyState>
        ) : (
          rows.map((listing) => {
            const { Icon, label } = KIND_META[listing.kind];
            return (
              <Row key={`${listing.kind}-${listing.id}`} cols={COLS}>
                <Cell>
                  <span className="flex items-center gap-3">
                    {listing.photos.length > 0 ? (
                      <span className="flex shrink-0 gap-1">
                        {listing.photos.slice(0, 4).map((url, n) => (
                          <Image
                            key={url}
                            src={url}
                            alt=""
                            width={40}
                            height={40}
                            className={`h-10 w-10 rounded-xl border border-line object-cover ${
                              n > 0 ? "hidden sm:block" : ""
                            }`}
                          />
                        ))}
                      </span>
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brandsoft text-brand">
                        <Icon size={17} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <Link
                        href={`/admin/listings/${listing.kind}/${listing.id}`}
                        className="block truncate text-[14px] font-bold hover:text-brand hover:underline"
                      >
                        {listing.title}
                      </Link>
                      <span className="block truncate text-[12px] font-medium text-muted">
                        {listing.detail}
                      </span>
                    </span>
                  </span>
                </Cell>

                <Cell label="Business">
                  <Link
                    href={`/admin/partners/${listing.partnerId}`}
                    className="block truncate text-[13px] font-bold text-brand hover:underline"
                  >
                    {listing.partnerName}
                  </Link>
                </Cell>

                <Cell label="Kind">
                  <Pill tone="muted">{label}</Pill>
                </Cell>

                <Cell className="md:flex md:justify-end">
                  <div className="flex flex-wrap items-start gap-2 md:justify-end">
                    {bucket === "pending" && (
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
                          prompt="The partner reads this on their Business tab and can fix it and resubmit."
                          placeholder="What needs to change?"
                          onConfirm={(reason) => rejectListing(listing.kind, listing.id, reason)}
                        />
                      </>
                    )}

                    {bucket === "live" && (
                      <ReasonAction
                        size="sm"
                        label="Take down"
                        confirmLabel="Confirm take down"
                        busyLabel="Taking down…"
                        prompt="This hides the listing from travellers now. The partner sees this reason and can fix it and resubmit."
                        placeholder="What is wrong with this listing?"
                        onConfirm={(reason) => unlistListing(listing.kind, listing.id, reason)}
                      />
                    )}

                    {bucket === "rejected" && listing.rejectionReason && (
                      <p className="text-[11.5px] font-medium text-sandink2 md:max-w-[260px] md:text-right">
                        {listing.rejectionReason}
                      </p>
                    )}

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
                </Cell>
              </Row>
            );
          })
        )}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// By business — every registered business, with its listings underneath.
//
// The queue above can only ever show a business that already has a listing, so
// a partner who registered and never added one (or couldn't work out the
// forms) is invisible there. This flips the axis: businesses first, listings
// tucked under each, and an "Add listing" button that opens the same forms the
// partner uses, on their behalf (136). Businesses with something waiting sort
// to the top, since that is what needs a decision.
// ---------------------------------------------------------------------------

type ListingRow = { listing: PendingListing; state: Bucket };

const STATE_PILL: Record<Bucket, { tone: "waiting" | "live" | "down"; label: string }> = {
  pending: { tone: "waiting", label: "Waiting" },
  live: { tone: "live", label: "Live" },
  rejected: { tone: "down", label: "Sent back" },
};

function BusinessesPanel({
  partners,
  pending,
  live,
  rejected,
  search,
}: {
  partners: PendingPartner[];
  pending: PendingListing[];
  live: PendingListing[];
  rejected: PendingListing[];
  search: string;
}) {
  const [only, setOnly] = useState<"all" | "empty">("all");
  const [open, setOpen] = useState<string | null>(null);

  const listingsByPartner = useMemo(() => {
    const map = new Map<string, ListingRow[]>();
    const add = (list: PendingListing[], state: Bucket) => {
      for (const listing of list) {
        const rows = map.get(listing.partnerId) ?? [];
        rows.push({ listing, state });
        map.set(listing.partnerId, rows);
      }
    };
    add(pending, "pending");
    add(live, "live");
    add(rejected, "rejected");
    return map;
  }, [pending, live, rejected]);

  // Deleted businesses are gone for good — nothing to add to or approve.
  const active = useMemo(() => partners.filter((p) => p.status !== "deleted"), [partners]);

  const emptyCount = useMemo(
    () => active.filter((p) => !listingsByPartner.has(p.id)).length,
    [active, listingsByPartner],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const waitingOf = (id: string) =>
      (listingsByPartner.get(id) ?? []).filter((r) => r.state === "pending").length;

    return active
      .filter((partner) => {
        const listings = listingsByPartner.get(partner.id) ?? [];
        if (only === "empty" && listings.length > 0) return false;
        if (!term) return true;
        return (
          partner.name.toLowerCase().includes(term) ||
          partner.kindLabel.toLowerCase().includes(term) ||
          islandLabel(partner.islandSlug).toLowerCase().includes(term) ||
          (partner.contactPhone ?? "").toLowerCase().includes(term) ||
          listings.some((r) => r.listing.title.toLowerCase().includes(term))
        );
      })
      .sort((a, b) => waitingOf(b.id) - waitingOf(a.id) || a.name.localeCompare(b.name));
  }, [active, listingsByPartner, only, search]);

  return (
    <>
      <div className="mt-2.5">
        <ChipRow>
          <Chip
            label="All businesses"
            count={active.length}
            active={only === "all"}
            onClick={() => setOnly("all")}
          />
          <Chip
            label="No listings yet"
            count={emptyCount}
            active={only === "empty"}
            onClick={() => setOnly("empty")}
          />
        </ChipRow>
      </div>

      <Panel className="mt-4">
        {rows.length === 0 ? (
          <EmptyState>
            {search.trim()
              ? "No business or listing matches that search."
              : only === "empty"
                ? "Every business has at least one listing."
                : "No businesses yet."}
          </EmptyState>
        ) : (
          rows.map((partner) => {
            const listings = listingsByPartner.get(partner.id) ?? [];
            const counts = {
              live: listings.filter((r) => r.state === "live").length,
              pending: listings.filter((r) => r.state === "pending").length,
              rejected: listings.filter((r) => r.state === "rejected").length,
            };
            const isOpen = open === partner.id;

            return (
              <div key={partner.id} className="border-b border-hairline last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : partner.id)}
                    className="flex min-w-0 flex-1 basis-[220px] items-center gap-3 text-left"
                  >
                    <ChevronIcon
                      size={15}
                      className={`shrink-0 text-muted transition ${isOpen ? "rotate-90" : ""}`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold">{partner.name}</span>
                      <span className="block truncate text-[12px] font-medium text-muted">
                        {partner.kindLabel} · {islandLabel(partner.islandSlug)}
                      </span>
                    </span>
                  </button>

                  <span className="flex flex-wrap items-center gap-1.5">
                    {partnerStatusPill(partner.status)}
                    {listings.length === 0 ? (
                      <Pill tone="muted">No listings yet</Pill>
                    ) : (
                      <>
                        {counts.pending > 0 && <Pill tone="waiting">{counts.pending} waiting</Pill>}
                        {counts.live > 0 && <Pill tone="live">{counts.live} live</Pill>}
                        {counts.rejected > 0 && <Pill tone="down">{counts.rejected} sent back</Pill>}
                      </>
                    )}
                  </span>

                  <span className="flex items-center gap-2">
                    <Link
                      href={`/admin/partners/${partner.id}`}
                      className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[12px] font-bold text-ink hover:border-brand hover:text-brand"
                    >
                      Business
                    </Link>
                    <Link
                      href={`/admin/partners/${partner.id}/add`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-bold text-white hover:opacity-90"
                    >
                      <PlusIcon size={13} />
                      Add listing
                    </Link>
                  </span>
                </div>

                {isOpen && (
                  <div className="border-t border-hairline bg-ground/50 px-5 py-1.5">
                    {listings.length === 0 ? (
                      <p className="py-4 text-[12.5px] font-medium text-muted">
                        Nothing here yet — use &ldquo;Add listing&rdquo; to add the first one for them.
                      </p>
                    ) : (
                      listings.map(({ listing, state }) => {
                        const { label } = KIND_META[listing.kind];
                        const pill = STATE_PILL[state];
                        return (
                          <div
                            key={`${listing.kind}-${listing.id}`}
                            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline py-2.5 last:border-b-0"
                          >
                            <span className="min-w-0 flex-1 basis-[200px]">
                              <Link
                                href={`/admin/listings/${listing.kind}/${listing.id}`}
                                className="block truncate text-[13.5px] font-bold hover:text-brand hover:underline"
                              >
                                {listing.title}
                              </Link>
                              <span className="block truncate text-[12px] font-medium text-muted">
                                {label} · {listing.detail}
                              </span>
                            </span>

                            <Pill tone={pill.tone}>{pill.label}</Pill>

                            <span className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/admin/listings/${listing.kind}/${listing.id}/edit`}
                                className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[12px] font-bold text-ink hover:border-brand hover:text-brand"
                              >
                                Edit
                              </Link>
                              {state === "pending" && (
                                <PlainAction
                                  size="sm"
                                  label="Approve"
                                  busyLabel="Approving…"
                                  onRun={() => approveListing(listing.kind, listing.id)}
                                />
                              )}
                              {state === "live" && (
                                <ReasonAction
                                  size="sm"
                                  label="Take down"
                                  confirmLabel="Confirm take down"
                                  busyLabel="Taking down…"
                                  prompt="This hides the listing from travellers now. The partner sees this reason and can fix it and resubmit."
                                  placeholder="What is wrong with this listing?"
                                  onConfirm={(reason) => unlistListing(listing.kind, listing.id, reason)}
                                />
                              )}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}
