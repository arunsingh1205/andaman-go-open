"use client";

// The dedicated listings screen: every activity, rental, table, event, trip,
// sailing and community service this partner has added, in one place with a
// quick filter — instead of scrolling past the whole Business profile to
// find it. The actual row rendering (and its resubmit/delete/schedule
// actions) lives in ../listings-section so this and the Business tab never
// drift into two different ideas of "what a listing row looks like."

import { useState } from "react";
import Link from "next/link";
import { type OwnListing } from "@/lib/partner-register";
import { PlusIcon } from "@/app/icons";
import ListingsSection from "../listings-section";

type Filter = "all" | "live" | "review" | "rejected";

function statusOf(item: OwnListing): Exclude<Filter, "all"> {
  if (item.isListed) return "live";
  if (item.rejectionReason) return "rejected";
  return "review";
}

export default function ListingsView({ listings }: { listings: OwnListing[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = {
    all: listings.length,
    live: listings.filter((l) => statusOf(l) === "live").length,
    review: listings.filter((l) => statusOf(l) === "review").length,
    rejected: listings.filter((l) => statusOf(l) === "rejected").length,
  };
  const filtered = filter === "all" ? listings : listings.filter((l) => statusOf(l) === filter);

  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: `All (${counts.all})` },
    { key: "live", label: `Live (${counts.live})` },
    { key: "review", label: `In review (${counts.review})` },
    { key: "rejected", label: `Not approved (${counts.rejected})` },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-[20px] font-bold tracking-tight desk:text-[24px]">
            My listings
          </h2>
          <p className="mt-0.5 text-[12px] font-medium text-muted">
            {counts.all} listing{counts.all === 1 ? "" : "s"} · {counts.live} live
          </p>
        </div>
        <Link
          href="/partner/business/new"
          className="flex items-center gap-1 rounded-full bg-brandsoft px-3 py-1.5 text-[12px] font-bold text-brand"
        >
          <PlusIcon size={12} />
          Add a listing
        </Link>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {chips
          .filter((c) => c.key === "all" || counts[c.key] > 0)
          .map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`h-8 shrink-0 rounded-full border px-3.5 text-[12px] font-bold whitespace-nowrap ${
                filter === c.key
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-muted"
              }`}
            >
              {c.label}
            </button>
          ))}
      </div>

      {filtered.length === 0 ? (
        <p className="mt-6 text-[13px] font-medium text-muted">Nothing in this filter.</p>
      ) : (
        <ListingsSection listings={filtered} />
      )}
    </>
  );
}
