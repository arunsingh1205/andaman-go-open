"use client";

// Every business on the platform, filterable, one row each.
//
// Deliberately no approve/reject buttons on this screen any more. The old
// version put them on the card, which meant approving a business without
// having opened its licence document was one tap away — the fastest path
// through the screen was also the least careful one. Acting on a business
// now happens on its own page, where the licence, the address, the listings
// and the bookings are all in front of you first.
//
// Filtering and search are in-memory: this is every partner Andaman Go has,
// which is a number in the dozens, and a round trip per keystroke would be a
// worse experience than sending a few extra rows once.

import { useMemo, useState } from "react";
import Image from "next/image";
import type { PendingPartner } from "@/lib/admin-review";
import { partnerPhotoUrl } from "@/lib/partner-storage";
import { islandLabel } from "@/lib/islands";
import {
  PageHeader,
  Panel,
  ChipRow,
  Chip,
  SearchBox,
  RowHead,
  Row,
  Cell,
  Disclosure,
  EmptyState,
  partnerStatusPill,
} from "../admin-ui";

type StatusFilter = "all" | "pending" | "approved" | "suspended" | "rejected" | "deleted";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Waiting" },
  { key: "approved", label: "Live" },
  { key: "suspended", label: "Suspended" },
  { key: "rejected", label: "Rejected" },
  { key: "deleted", label: "Deleted" },
];

const COLS = "md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_90px_110px_24px]";

export default function PartnersView({
  partners,
  listingCounts,
  initialStatus,
}: {
  partners: PendingPartner[];
  listingCounts: Record<string, number>;
  initialStatus: string;
}) {
  const [status, setStatus] = useState<StatusFilter>(
    (FILTERS.some((f) => f.key === initialStatus) ? initialStatus : "all") as StatusFilter,
  );
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = {
      all: partners.length,
      pending: 0,
      approved: 0,
      suspended: 0,
      rejected: 0,
      deleted: 0,
    };
    for (const partner of partners) out[partner.status] += 1;
    return out;
  }, [partners]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return partners.filter((partner) => {
      if (status !== "all" && partner.status !== status) return false;
      if (!term) return true;
      return (
        partner.name.toLowerCase().includes(term) ||
        partner.kindLabel.toLowerCase().includes(term) ||
        partner.islandSlug.toLowerCase().includes(term) ||
        islandLabel(partner.islandSlug).toLowerCase().includes(term) ||
        (partner.contactPhone ?? "").toLowerCase().includes(term)
      );
    });
  }, [partners, status, search]);

  return (
    <>
      <PageHeader
        title="Partners"
        subtitle={`${partners.length} ${partners.length === 1 ? "business" : "businesses"} on the platform`}
      >
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, island, phone…" />
      </PageHeader>

      <ChipRow>
        {FILTERS.map((filter) => (
          <Chip
            key={filter.key}
            label={filter.label}
            count={counts[filter.key]}
            active={status === filter.key}
            onClick={() => setStatus(filter.key)}
          />
        ))}
      </ChipRow>

      <Panel className="mt-4">
        <RowHead cols={COLS}>
          <span>Business</span>
          <span>Island</span>
          <span>Listings</span>
          <span>Status</span>
          <span />
        </RowHead>

        {rows.length === 0 ? (
          <EmptyState>
            {search.trim()
              ? "No business matches that search."
              : "Nothing in this bucket right now."}
          </EmptyState>
        ) : (
          rows.map((partner) => (
            <Row key={partner.id} cols={COLS} href={`/admin/partners/${partner.id}`}>
              <Cell>
                <span className="flex items-center gap-3">
                  {partner.coverPhotoPath ? (
                    <Image
                      src={partnerPhotoUrl(partner.coverPhotoPath)}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 shrink-0 rounded-xl border border-line object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-line text-[9px] font-medium text-muted">
                      No
                      <br />
                      photo
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-bold">{partner.name}</span>
                    <span className="block truncate text-[12px] font-medium text-muted">
                      {partner.kindLabel}
                    </span>
                  </span>
                </span>
              </Cell>

              <Cell label="Island">
                <span className="text-[13px] font-medium text-muted">
                  {islandLabel(partner.islandSlug)}
                </span>
              </Cell>

              <Cell label="Listings">
                <span className="text-[13px] font-bold">{listingCounts[partner.id] ?? 0}</span>
              </Cell>

              <Cell label="Status">{partnerStatusPill(partner.status)}</Cell>

              <Cell>
                <Disclosure />
              </Cell>
            </Row>
          ))
        )}
      </Panel>
    </>
  );
}
