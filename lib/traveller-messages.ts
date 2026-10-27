"use server";

// The traveller's side of a booking's message thread. Reads and writes both
// go through the per-user server client (cookie auth), same as lib/book.ts —
// the catalogue client has no session and RLS would hand back nothing.

import { supabaseServer } from "./supabase-server";
import { istStampLabel } from "./partner-format";

export type TravellerMessage = {
  id: string;
  fromTraveller: boolean;
  body: string;
  stampLabel: string;
};

export type SendResult = { ok: boolean; message: string };

function firstRow(data: unknown): { ok: boolean; message: string } | null {
  return Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
}

export async function getTravellerThread(itemId: string): Promise<TravellerMessage[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("booking_messages")
    .select("id, sender, body, created_at")
    .eq("item_id", itemId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    fromTraveller: row.sender === "traveller",
    body: row.body as string,
    stampLabel: istStampLabel(row.created_at as string),
  }));
}

export async function sendTravellerMessage(
  itemId: string,
  body: string,
): Promise<SendResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("traveller_send_message", {
    p_item_id: itemId,
    p_body: body,
  });
  if (error) return { ok: false, message: "Couldn't send that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't send that." };
}

/** Called when the traveller opens a thread — clears the operator's unread
 *  messages. Failure is silent. */
export async function markTravellerThreadRead(itemId: string): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.rpc("mark_traveller_messages_read", { p_item_id: itemId });
}

/** null = open, else who closed it (152) — only the side that blocked can
 *  reopen it, so this also tells the UI whose "Unblock" button to show. */
export async function getTravellerThreadStatus(
  itemId: string,
): Promise<"traveller" | "partner" | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("traveller_thread_status", { p_item_id: itemId });
  const row = Array.isArray(data) ? (data[0] as { blocked_by: string | null }) : null;
  return (row?.blocked_by as "traveller" | "partner" | null) ?? null;
}

export async function blockTravellerThread(itemId: string): Promise<SendResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("traveller_block_thread", { p_item_id: itemId });
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't do that." };
}

export async function unblockTravellerThread(itemId: string): Promise<SendResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("traveller_unblock_thread", { p_item_id: itemId });
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't do that." };
}

export async function reportTravellerThread(
  itemId: string,
  reason: string,
): Promise<SendResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("traveller_report_thread", {
    p_item_id: itemId,
    p_reason: reason,
  });
  if (error) return { ok: false, message: "Couldn't send that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't send that." };
}
