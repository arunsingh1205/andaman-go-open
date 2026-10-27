"use client";

import Link from "next/link";
import {
  approveListing,
  rejectListing,
  unlistListing,
  type ListingReview,
} from "@/lib/admin-review";
import { ReasonAction, PlainAction } from "../../../admin-action";
import { Panel, Pill } from "../../../admin-ui";
import PhotoCarousel from "@/app/photo-carousel";
import { BackIcon } from "@/app/icons";

const KIND_LABEL: Record<string, string> = {
  activity: "Activity",
  rental: "Rental vehicle",
  cab: "Cab / car",
  stay: "Stay / homestay",
  event: "Event",
  trip: "Day trip",
  ferry: "Ferry sailing",
  community: "Community service",
};

export default function ListingReviewView({ listing }: { listing: ListingReview }) {
  const bucket = listing.isListed
    ? "live"
    : listing.rejectionReason
      ? "rejected"
      : "pending";
  const noTimes = listing.schedule !== null && listing.schedule.length === 0;

  return (
    <>
      <Link
        href="/admin/listings"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted hover:text-ink"
      >
        <BackIcon size={15} />
        All listings
      </Link>

      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-[22px] leading-tight font-bold tracking-tight">
            {listing.title || "Untitled listing"}
          </h1>
          {bucket === "live" && <Pill tone="live">Live</Pill>}
          {bucket === "pending" && <Pill tone="waiting">Waiting</Pill>}
          {bucket === "rejected" && <Pill tone="down">Sent back</Pill>}
        </div>
        <p className="mt-1 text-[13px] font-medium text-muted">
          {KIND_LABEL[listing.kind] ?? listing.kind} ·{" "}
          <Link
            href={`/admin/partners/${listing.partner.id}`}
            className="font-bold text-brand hover:underline"
          >
            {listing.partner.name}
          </Link>
        </p>

        {listing.rejectionReason && (
          <div className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] font-medium text-sandink2">
            <span className="font-bold">Sent back: </span>
            {listing.rejectionReason}
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="flex flex-col gap-4">
          {listing.photos.length > 0 ? (
            <div className="mx-auto w-full max-w-[430px] xl:mx-0">
              <PhotoCarousel photos={listing.photos} alt={listing.title} />
            </div>
          ) : (
            <Panel title="Photos">
              <p className="px-5 py-4 text-[13px] font-medium text-muted">
                No photos — the traveller will only see the two-letter tile.
              </p>
            </Panel>
          )}

          <Panel title="Details">
            <dl className="divide-y divide-hairline">
              {listing.rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-5 py-3">
                  <dt className="text-[12px] font-bold text-muted">{r.label}</dt>
                  <dd className="text-[13px] leading-relaxed font-medium whitespace-pre-wrap">
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          {listing.schedule !== null && (
            <Panel title="Time slots">
              {noTimes ? (
                <p className="px-5 py-4 text-[13px] font-medium text-warn">
                  None set yet. Travellers can&apos;t book this, and it can&apos;t be approved
                  until the partner adds some.
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {listing.schedule.map((s, n) => (
                    <li key={n} className="flex items-center gap-3 px-5 py-2.5 text-[13px] font-medium">
                      <span className="w-14 font-bold">{s.time}</span>
                      <span className="text-muted">{s.days}</span>
                      <span className="ml-auto text-muted">
                        {s.capacity == null ? "Uncapped" : `${s.capacity} seats`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <Panel title="Decision">
            <div className="flex flex-col gap-3 px-5 py-4">
              <Link
                href={`/admin/listings/${listing.kind}/${listing.id}/edit`}
                className="flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-[13px] font-bold text-ink hover:border-brand hover:text-brand"
              >
                Edit listing on their behalf
              </Link>

              {bucket !== "live" &&
                (noTimes ? (
                  <button
                    type="button"
                    disabled
                    className="h-10 rounded-xl bg-line px-4 text-[13px] font-bold text-muted"
                  >
                    Approve — add times first
                  </button>
                ) : (
                  <PlainAction
                    label="Approve"
                    busyLabel="Approving…"
                    onRun={() => approveListing(listing.kind, listing.id)}
                  />
                ))}

              {bucket !== "live" ? (
                <ReasonAction
                  label="Send back"
                  confirmLabel="Confirm"
                  busyLabel="Sending…"
                  prompt="The partner reads this on their Business tab and can fix it and resubmit."
                  placeholder="What needs to change?"
                  onConfirm={(reason) => rejectListing(listing.kind, listing.id, reason)}
                />
              ) : (
                <ReasonAction
                  label="Take down"
                  confirmLabel="Confirm take down"
                  busyLabel="Taking down…"
                  prompt="This hides the listing from travellers now. The partner sees this reason and can fix it and resubmit."
                  placeholder="What is wrong with this listing?"
                  onConfirm={(reason) => unlistListing(listing.kind, listing.id, reason)}
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
