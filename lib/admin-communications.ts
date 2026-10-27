"use server";

// The admin side of transactional notifications (106) — a log of every
// email/WhatsApp send, whichever of the two paths created it (the
// notify_booking_comms trigger, or a Node-direct call right after settlement
// RPCs succeed), plus a resend action. Same thin-wrapper discipline as
// lib/admin-settlements.ts: the RPCs re-check is_admin() themselves, this
// file is a translation layer. The partner welcome email itself — its
// content and its own backfill action — moved to lib/admin-broadcasts.ts
// (111), where it's edited as a Broadcasts campaign rather than here.

import { supabaseServer } from "./supabase-server";

export type NotificationChannel = "email" | "whatsapp";
export type NotificationRecipientType = "partner" | "customer";
export type NotificationKind =
  | "partner_welcome"
  | "booking_new"
  | "settlement_ready"
  | "settlement_paid"
  | "first_listing";
export type NotificationStatus = "pending" | "sent" | "failed";

export type NotificationLogRow = {
  id: string;
  channel: NotificationChannel;
  recipientType: NotificationRecipientType;
  recipientAddress: string;
  kind: NotificationKind;
  status: NotificationStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  retryOf: string | null;
};

export type NotificationFilter = {
  channel?: NotificationChannel;
  status?: NotificationStatus;
  kind?: NotificationKind;
};

export async function listNotifications(filter: NotificationFilter): Promise<NotificationLogRow[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("notification_log")
    .select("id, channel, recipient_type, recipient_address, kind, status, error, created_at, sent_at, retry_of")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter.channel) query = query.eq("channel", filter.channel);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.kind) query = query.eq("kind", filter.kind);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    channel: row.channel as NotificationChannel,
    recipientType: row.recipient_type as NotificationRecipientType,
    recipientAddress: row.recipient_address,
    kind: row.kind as NotificationKind,
    status: row.status as NotificationStatus,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    retryOf: row.retry_of,
  }));
}

export type CommunicationsResult = { ok: boolean; message: string };

/** Inserts a fresh 'pending' retry row; the Database Webhook on
 *  notification_log (send-notification Edge Function) does the actual send —
 *  same code path as the original, whichever kind or channel it is. */
export async function resendNotification(id: string): Promise<CommunicationsResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_resend_notification", { p_id: id });
  if (error) return { ok: false, message: "Couldn't queue a resend. Try again." };
  return { ok: true, message: "Resend queued." };
}
