"use server";

// The traveller leaving (or editing) a review, after being checked in.
// Thin bridge to leave_review (024), which enforces "must be your own,
// checked-in booking" in the database. Uses the per-user server client, like
// lib/book.ts.

import { supabaseServer } from "./supabase-server";

export type LeaveReviewResult = { ok: boolean; message: string };

export async function leaveReview(
  itemId: string,
  rating: number,
  body: string,
): Promise<LeaveReviewResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("leave_review", {
    p_item_id: itemId,
    p_rating: rating,
    p_body: body,
  });
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't save that." };
}
