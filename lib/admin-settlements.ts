"use server";

// The admin side of the weekly settlement (101) — running a batch, seeing
// what's pending vs paid, and marking a batch paid once the bank transfer
// has actually happened outside the app. Covers every category that
// collects money online on a partner's behalf (not just stays) — same
// thin-wrapper discipline as lib/admin-commission.ts: the RPCs re-check
// is_admin() themselves, this file is a translation layer.

import { supabaseServer } from "./supabase-server";
import { KIND_LABEL, type BookingKind } from "./bookings";
import { sendSettlementPaidEmail } from "./email";
import { sendSettlementPaidWhatsApp } from "./whatsapp";

export type SettlementStatus = "pending" | "paid";
export type SettlementEvent = "delivered" | "cancelled_retained";

export type SettlementBatch = {
  id: string;
  partnerId: string;
  partnerName: string;
  periodStart: string;
  periodEnd: string;
  status: SettlementStatus;
  grossPaise: number;
  commissionPaise: number;
  cashCollectedPaise: number;
  netPayablePaise: number;
  itemCount: number;
  createdAt: string;
  paidAt: string | null;
  payoutReference: string | null;
  payoutNote: string | null;
};

export type SettlementItem = {
  id: string;
  bookingItemId: string;
  kind: string;
  kindLabel: string;
  event: SettlementEvent;
  grossPaise: number;
  commissionBps: number;
  commissionPaise: number;
  cashCollectedPaise: number;
  netPayablePaise: number;
  ticketCode: string | null;
  title: string | null;
  startsAt: string | null;
};

export type SettlementResult = { ok: boolean; message: string };

export async function listSettlementBatches(
  filter: "pending" | "paid" | "all",
): Promise<SettlementBatch[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("settlement_batches")
    .select(
      "id, partner_id, period_start, period_end, status, gross_paise, commission_paise, cash_collected_paise, net_payable_paise, item_count, created_at, paid_at, payout_reference, payout_note, partners ( name )",
    )
    .order("period_start", { ascending: false });

  if (filter !== "all") query = query.eq("status", filter);

  const { data, error } = await query;
  if (error || !data) return [];

  type PartnerJoin = { name: string } | { name: string }[] | null;
  const partnerName = (p: PartnerJoin): string => {
    if (!p) return "Unknown business";
    return Array.isArray(p) ? (p[0]?.name ?? "Unknown business") : p.name;
  };

  return data.map((row) => ({
    id: row.id,
    partnerId: row.partner_id,
    partnerName: partnerName(row.partners as PartnerJoin),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status as SettlementStatus,
    grossPaise: row.gross_paise,
    commissionPaise: row.commission_paise,
    cashCollectedPaise: row.cash_collected_paise,
    netPayablePaise: row.net_payable_paise,
    itemCount: row.item_count,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    payoutReference: row.payout_reference,
    payoutNote: row.payout_note,
  }));
}

export async function getSettlementItems(batchId: string): Promise<SettlementItem[]> {
  const supabase = await supabaseServer();

  const { data: items, error } = await supabase
    .from("settlement_items")
    .select(
      "id, booking_item_id, kind, event, gross_paise, commission_bps, commission_paise, cash_collected_paise, net_payable_paise",
    )
    .eq("batch_id", batchId);
  if (error || !items || items.length === 0) return [];

  // admin_bookings (079/097) is the already-proven, RLS-safe way an admin
  // reads booking_items — it resolves the title via subject_title() itself,
  // so there's no need to hand-roll a join through booking_items.subject_id
  // (which has no foreign key — it's polymorphic, keyed by kind, 093).
  const { data: bookings } = await supabase
    .from("admin_bookings")
    .select("item_id, ticket_code, starts_at, title")
    .in(
      "item_id",
      items.map((i) => i.booking_item_id),
    );
  const byItemId = new Map((bookings ?? []).map((b) => [b.item_id, b]));

  return items.map((row) => {
    const b = byItemId.get(row.booking_item_id);
    return {
      id: row.id,
      bookingItemId: row.booking_item_id,
      kind: row.kind,
      kindLabel: KIND_LABEL[row.kind as BookingKind] ?? row.kind,
      event: row.event as SettlementEvent,
      grossPaise: row.gross_paise,
      commissionBps: row.commission_bps,
      commissionPaise: row.commission_paise,
      cashCollectedPaise: row.cash_collected_paise,
      netPayablePaise: row.net_payable_paise,
      ticketCode: b?.ticket_code ?? null,
      startsAt: b?.starts_at ?? null,
      title: b?.title ?? null,
    };
  });
}

export async function runSettlement(
  periodStart: string,
  periodEnd: string,
): Promise<SettlementResult & { partnersSettled: number }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("run_settlement", {
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) return { ok: false, message: "Couldn't run the settlement. Try again.", partnersSettled: 0 };

  const rows = (data ?? []) as { partner_id: string; items_settled: number; net_payable_paise: number }[];
  return {
    ok: true,
    message:
      rows.length === 0
        ? "Nothing eligible to settle in that window."
        : `Settled ${rows.length} business${rows.length === 1 ? "" : "es"}.`,
    partnersSettled: rows.length,
  };
}

export async function markSettlementPaid(
  batchId: string,
  reference: string,
  note: string,
): Promise<SettlementResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("mark_settlement_paid", {
    p_batch_id: batchId,
    p_reference: reference,
    p_note: note || null,
  });
  if (error) return { ok: false, message: "Couldn't mark that paid. Try again." };

  const row = Array.isArray(data)
    ? (data[0] as {
        ok: boolean;
        message: string;
        owner_email: string | null;
        whatsapp_number: string | null;
        partner_name: string | null;
        net_payable_paise: number | null;
        payout_reference: string | null;
      })
    : null;

  if (row?.ok && row.partner_name && row.net_payable_paise != null && row.payout_reference) {
    const netPayablePaise = row.net_payable_paise;
    const payoutReference = row.payout_reference;
    const partnerName = row.partner_name;

    // Awaited, not fire-and-forget: a Server Action's execution environment
    // can be frozen by the platform the instant its response is sent, which
    // silently kills any promise still in flight — including the send
    // itself and the record_notification call logging it (same class of
    // bug found in the ops partner-onboarding flow). A failed send still
    // never fails "Mark paid" itself — caught and logged below — this
    // payout confirmation is just guaranteed to actually attempt sending now.
    const sends: Promise<unknown>[] = [];

    if (row.owner_email) {
      const ownerEmail = row.owner_email;
      const batch = await supabase
        .from("settlement_batches")
        .select("period_start, period_end")
        .eq("id", batchId)
        .maybeSingle();
      if (batch.data) {
        sends.push(
          sendSettlementPaidEmail(ownerEmail, partnerName, {
            periodStart: batch.data.period_start,
            periodEnd: batch.data.period_end,
            netPayablePaise,
            payoutReference,
          })
            .then((sent) =>
              supabase.rpc("record_notification", {
                p_channel: "email",
                p_recipient_type: "partner",
                p_recipient_address: ownerEmail,
                p_kind: "settlement_paid",
                p_status: sent ? "sent" : "failed",
                p_payload: { partner_name: partnerName, net_payable_paise: netPayablePaise, payout_reference: payoutReference },
              }),
            )
            .catch((err) => console.error("sendSettlementPaidEmail failed:", err)),
        );
      }
    }

    if (row.whatsapp_number) {
      const whatsappNumber = row.whatsapp_number;
      sends.push(
        sendSettlementPaidWhatsApp(whatsappNumber, partnerName, { netPayablePaise, payoutReference })
          .then((sent) =>
            supabase.rpc("record_notification", {
              p_channel: "whatsapp",
              p_recipient_type: "partner",
              p_recipient_address: whatsappNumber,
              p_kind: "settlement_paid",
              p_status: sent ? "sent" : "failed",
              p_payload: { partner_name: partnerName, net_payable_paise: netPayablePaise, payout_reference: payoutReference },
            }),
          )
          .catch((err) => console.error("sendSettlementPaidWhatsApp failed:", err)),
      );
    }

    await Promise.all(sends);
  }

  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't mark that paid." };
}
