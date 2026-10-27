// The public "what offers do we have right now" read (160) — the
// Zomato-coupons shape: a traveller browses this without already knowing a
// code. Only active, is_public promo codes come back; see
// list_public_offers in supabase/160-promo-code-scope-percent-public.sql
// for what's deliberately left out (redemption counts, anything not
// flagged public).

import { supabase, unwrap } from "./supabase";

export type Offer = {
  code: string;
  discountType: "flat" | "percent";
  discountPaise: number | null;
  discountPercentBps: number | null;
  minOrderPaise: number;
  headline: string | null;
  /** Empty = applies to any Activity/Trip booking. */
  scopes: { kind: "activity" | "trip"; slug: string }[];
};

type Row = {
  code: string;
  discount_type: "flat" | "percent";
  discount_paise: number | null;
  discount_percent_bps: number | null;
  min_order_paise: number;
  headline: string | null;
  scope_kinds: ("activity" | "trip")[];
  scope_slugs: string[];
};

export async function getPublicOffers(): Promise<Offer[]> {
  const rows = (await supabase
    .rpc("list_public_offers")
    .then((r) => unwrap(r, "offers"))) as unknown as Row[];

  return rows.map((r) => ({
    code: r.code,
    discountType: r.discount_type,
    discountPaise: r.discount_paise,
    discountPercentBps: r.discount_percent_bps,
    minOrderPaise: r.min_order_paise,
    headline: r.headline,
    scopes: r.scope_kinds.map((kind, i) => ({ kind, slug: r.scope_slugs[i] })),
  }));
}

/** "₹200 off" / "10% off". */
export function offerDiscountLabel(o: Pick<Offer, "discountType" | "discountPaise" | "discountPercentBps">) {
  if (o.discountType === "percent" && o.discountPercentBps != null) {
    return `${o.discountPercentBps / 100}% off`;
  }
  if (o.discountPaise != null) return `₹${Math.round(o.discountPaise / 100).toLocaleString("en-IN")} off`;
  return "Discount";
}

/** slug → listing name, for the handful of scoped offers that name
 *  specific listings rather than applying everywhere. Only ever looked up
 *  for the slugs list_public_offers actually returned, so this stays cheap
 *  even as the catalogue grows. */
export async function resolveScopeLabels(
  scopes: { kind: "activity" | "trip"; slug: string }[],
): Promise<Map<string, string>> {
  const activitySlugs = [...new Set(scopes.filter((s) => s.kind === "activity").map((s) => s.slug))];
  const tripSlugs = [...new Set(scopes.filter((s) => s.kind === "trip").map((s) => s.slug))];
  const out = new Map<string, string>();
  if (activitySlugs.length === 0 && tripSlugs.length === 0) return out;

  const [activities, trips] = await Promise.all([
    activitySlugs.length === 0
      ? Promise.resolve([])
      : supabase
          .from("activities")
          .select("slug, name")
          .in("slug", activitySlugs)
          .then((r) => unwrap(r, "activities") as unknown as { slug: string; name: string }[]),
    tripSlugs.length === 0
      ? Promise.resolve([])
      : supabase
          .from("trips")
          .select("slug, title")
          .in("slug", tripSlugs)
          .then((r) => unwrap(r, "trips") as unknown as { slug: string; title: string }[]),
  ]);

  for (const a of activities) out.set(`activity:${a.slug}`, a.name);
  for (const t of trips) out.set(`trip:${t.slug}`, t.title);
  return out;
}
