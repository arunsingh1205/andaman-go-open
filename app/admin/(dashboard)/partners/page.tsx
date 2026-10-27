import { listPartners, listListings } from "@/lib/admin-review";
import PartnersView from "./partners-view";

// The directory, not the queue. The old version of this screen could only
// ever show two buckets — pending and rejected — because those were the only
// two an admin had anything to do with. Now that a live business can be
// suspended and brought back, "every business, filtered" is the honest shape,
// and "waiting on a decision" is one filter among several rather than the
// whole screen.
//
// ?status= is read from the URL so the Overview tiles can link straight into
// a filtered view.

export const dynamic = "force-dynamic";

export default async function AdminPartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  const [partners, listings] = await Promise.all([listPartners("all"), listListings("all")]);

  // How many listings each business has, counted once here rather than with
  // a query per row.
  const listingCounts: Record<string, number> = {};
  for (const listing of listings) {
    listingCounts[listing.partnerId] = (listingCounts[listing.partnerId] ?? 0) + 1;
  }

  return (
    <PartnersView
      partners={partners}
      listingCounts={listingCounts}
      initialStatus={status ?? "all"}
    />
  );
}
