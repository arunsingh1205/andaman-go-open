"use server";

// The partner's side of a booking's message thread — send, and mark read.
// Thin bridges to 022's RPCs, same shape as partner-actions.ts.

import { supabaseServer } from "./supabase-server";

export type MessageResult = { ok: boolean; message: string };

function firstRow(data: unknown): { ok: boolean; message: string } | null {
  return Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
}

export async function sendPartnerMessage(
  itemId: string,
  body: string,
): Promise<MessageResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("partner_send_message", {
    p_item_id: itemId,
    p_body: body,
  });
  if (error) return { ok: false, message: "Couldn't send that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't send that." };
}

/** Called when the partner opens a thread — clears the traveller's unread
 *  messages and any bell notifications for this booking. Failure is silent. */
export async function markPartnerThreadRead(itemId: string): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.rpc("mark_booking_messages_read", { p_item_id: itemId });
}

/** null = open, else who closed it (152) — only the side that blocked can
 *  reopen it, so this also tells the UI whose "Unblock" button to show. */
export async function getPartnerThreadStatus(
  itemId: string,
): Promise<"traveller" | "partner" | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("partner_thread_status", { p_item_id: itemId });
  const row = Array.isArray(data) ? (data[0] as { blocked_by: string | null }) : null;
  return (row?.blocked_by as "traveller" | "partner" | null) ?? null;
}

export async function blockPartnerThread(itemId: string): Promise<MessageResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("partner_block_thread", { p_item_id: itemId });
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't do that." };
}

export async function unblockPartnerThread(itemId: string): Promise<MessageResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("partner_unblock_thread", { p_item_id: itemId });
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't do that." };
}

export async function reportPartnerThread(
  itemId: string,
  reason: string,
): Promise<MessageResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("partner_report_thread", {
    p_item_id: itemId,
    p_reason: reason,
  });
  if (error) return { ok: false, message: "Couldn't send that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't send that." };
}
