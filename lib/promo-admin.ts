"use server";

// Admin-only CRUD for promo codes (159, scope/percent/minimum-order 160) —
// promo_codes/promo_code_scopes carry no select policy and have every
// grant revoked, so unlike cab_rate_card's admin screen this can't just
// select the table; every read and write here goes through an
// is_admin()-gated RPC instead.

import { supabaseServer } from "./supabase-server";
import { supabase, unwrap } from "./supabase";

export type PromoScope = { kind: "activity" | "trip"; slug: string };

export type AdminPromoCode = {
  id: string;
  code: string;
  discountType: "flat" | "percent";
  /** Set when discountType is 'flat', else null. */
  discountPaise: number | null;
  /** Basis points (1000 = 10%) when discountType is 'percent', else null. */
  discountPercentBps: number | null;
  minOrderPaise: number;
  isPublic: boolean;
  headline: string | null;
  active: boolean;
  createdAt: string;
  redemptionCount: number;
  /** Empty = applies to any Activity/Trip booking. */
  scopes: PromoScope[];
};

type Row = {
  id: string;
  code: string;
  discount_type: "flat" | "percent";
  discount_paise: number | null;
  discount_percent_bps: number | null;
  min_order_paise: number;
  is_public: boolean;
  headline: string | null;
  active: boolean;
  created_at: string;
  redemption_count: number;
  scope_kinds: ("activity" | "trip")[];
  scope_slugs: string[];
};

function toPromo(row: Row): AdminPromoCode {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountPaise: row.discount_paise,
    discountPercentBps: row.discount_percent_bps,
    minOrderPaise: row.min_order_paise,
    isPublic: row.is_public,
    headline: row.headline,
    active: row.active,
    createdAt: row.created_at,
    redemptionCount: row.redemption_count,
    scopes: row.scope_kinds.map((kind, i) => ({ kind, slug: row.scope_slugs[i] })),
  };
}

export async function getAdminPromoCodes(): Promise<AdminPromoCode[]> {
  const supabaseAdmin = await supabaseServer();
  const { data, error } = await supabaseAdmin.rpc("admin_list_promo_codes");
  if (error) throw new Error(`Supabase: could not load promo codes — ${error.message}`);
  return ((data ?? []) as Row[]).map(toPromo);
}

export type ScopeOption = { kind: "activity" | "trip"; slug: string; label: string };

/** Every live Activity and Trip, for the scope picker — plain public
 *  catalogue data (same is_listed reads lib/activities.ts and lib/trips.ts
 *  already do), not something that needs its own RPC. */
export async function getPromoScopeOptions(): Promise<ScopeOption[]> {
  const [activities, trips] = await Promise.all([
    supabase
      .from("activities")
      .select("slug, name")
      .eq("is_listed", true)
      .order("name")
      .then((r) => unwrap(r, "activities") as unknown as { slug: string; name: string }[]),
    supabase
      .from("trips")
      .select("slug, title")
      .eq("is_listed", true)
      .order("title")
      .then((r) => unwrap(r, "trips") as unknown as { slug: string; title: string }[]),
  ]);

  return [
    ...activities.map((a) => ({ kind: "activity" as const, slug: a.slug, label: a.name })),
    ...trips.map((t) => ({ kind: "trip" as const, slug: t.slug, label: t.title })),
  ];
}

export type AdminActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function upsertPromoCode(input: {
  id?: string;
  code: string;
  discountType: "flat" | "percent";
  discountPaise: number | null;
  discountPercentBps: number | null;
  minOrderPaise: number;
  isPublic: boolean;
  headline: string;
  active: boolean;
  scopes: PromoScope[];
}): Promise<AdminActionResult> {
  const supabaseAdmin = await supabaseServer();
  const { data, error } = await supabaseAdmin.rpc("admin_upsert_promo_code", {
    p_id: input.id ?? null,
    p_code: input.code,
    p_discount_type: input.discountType,
    p_discount_paise: input.discountPaise,
    p_discount_percent_bps: input.discountPercentBps,
    p_min_order_paise: input.minOrderPaise,
    p_is_public: input.isPublic,
    p_headline: input.headline,
    p_active: input.active,
    p_scope_kinds: input.scopes.map((s) => s.kind),
    p_scope_slugs: input.scopes.map((s) => s.slug),
  });
  if (error) return { ok: false, message: "Something went wrong. Try again." };
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as { ok: boolean; message: string }) : null;
  if (!row?.ok) return { ok: false, message: row?.message ?? "Something went wrong. Try again." };
  return { ok: true, message: row.message };
}

export async function setPromoCodeActive(id: string, active: boolean): Promise<AdminActionResult> {
  const supabaseAdmin = await supabaseServer();
  const { data, error } = await supabaseAdmin.rpc("admin_set_promo_code_active", {
    p_id: id,
    p_active: active,
  });
  if (error) return { ok: false, message: "Something went wrong. Try again." };
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as { ok: boolean; message: string }) : null;
  if (!row?.ok) return { ok: false, message: row?.message ?? "Something went wrong. Try again." };
  return { ok: true, message: row.message };
}
