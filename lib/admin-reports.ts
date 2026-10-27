"use server";

// The admin side of reported booking-message threads (152) — a list of
// every report filed by a traveller or a partner, and the one action there
// is to take on it: mark it resolved once a human has looked into it.

import { supabaseServer } from "./supabase-server";
import { istStampLabel } from "./partner-format";
import type { BookingKind } from "./bookings";

export type MessageReport = {
  id: string;
  itemId: string;
  refCode: string;
  kind: BookingKind;
  partnerId: string;
  partnerName: string;
  reportedBy: "traveller" | "partner";
  reason: string;
  status: "open" | "resolved";
  createdAtLabel: string;
};

export type ReportActionResult = { ok: boolean; message: string };

function firstRow(data: unknown): { ok: boolean; message: string } | null {
  return Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
}

export async function listMessageReports(): Promise<MessageReport[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("admin_message_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((r) => ({
    id: r.id as string,
    itemId: r.item_id as string,
    refCode: r.ref_code as string,
    kind: r.kind as BookingKind,
    partnerId: r.partner_id as string,
    partnerName: (r.partner_name as string) ?? "A business",
    reportedBy: r.reported_by as "traveller" | "partner",
    reason: r.reason as string,
    status: (r.status as "open" | "resolved") ?? "open",
    createdAtLabel: istStampLabel(r.created_at as string),
  }));
}

export async function resolveMessageReport(id: string): Promise<ReportActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_resolve_message_report", { p_id: id });
  if (error) return { ok: false, message: "Couldn't update that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't update that." };
}
