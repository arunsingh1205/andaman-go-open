import { listListings, listPartners } from "@/lib/admin-review";
import ListingsView from "./listings-view";

// Still a queue by default, unlike Partners — a listing has no life of its own
// outside "is it good enough to show a traveller", so there is nothing to put
// on a detail page that this row doesn't already carry. What changed the
// round before this was the third bucket: listings that are live, so one that
// turned out to be wrong can be taken down from the same screen it was
// approved on.
//
// The second view, "By business" (136), flips the axis: every registered
// business — including the ones with no listings yet, which the queue can't
// show at all — with its listings underneath and an "Add listing" button, for
// adding a listing on a partner's behalf. ?view=business opens it directly.

export const dynamic = "force-dynamic";

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;

  const [pending, rejected, all, partners] = await Promise.all([
    listListings("pending"),
    listListings("rejected"),
    listListings("all"),
    listPartners("all"),
  ]);

  const down = new Set([...pending, ...rejected].map((l) => `${l.kind}-${l.id}`));
  const live = all.filter((l) => !down.has(`${l.kind}-${l.id}`));

  return (
    <ListingsView
      pending={pending}
      rejected={rejected}
      live={live}
      partners={partners}
      initialView={view === "business" ? "business" : "listings"}
    />
  );
}
