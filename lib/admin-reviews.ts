"use server";

// Every review on the platform, and the one write an admin can make on one:
// removing an abusive one (033). Removal re-blends the listing's rating.

import { supabaseServer } from "./supabase-server";
import type { BookingKind } from "./bookings";

export type AdminReview = {
  id: string;
  partnerId: string;
  partnerName: string;
  kind: BookingKind;
  listingTitle: string;
  rating: number;
  body: string | null;
  reply: string | null;
  dateLabel: string;
};

export type AdminReviewResult = { ok: boolean; message: string };

export async function listAdminReviews(): Promise<AdminReview[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("admin_reviews")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((r) => ({
    id: r.id as string,
    partnerId: r.partner_id as string,
    partnerName: (r.partner_name as string) ?? "A business",
    kind: r.kind as BookingKind,
    listingTitle: (r.listing_title as string) ?? "A listing",
    rating: r.rating as number,
    body: (r.body as string | null) ?? null,
    reply: (r.reply as string | null) ?? null,
    dateLabel: new Date(r.created_at as string).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }),
  }));
}

export async function removeReview(id: string): Promise<AdminReviewResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_remove_review", { p_id: id });
  if (error) return { ok: false, message: "Couldn't remove that. Try again." };
  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't remove that." };
}
